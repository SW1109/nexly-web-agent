import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile, readFile, access } from 'node:fs/promises';
import { platform, tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { join, posix, win32 } from 'node:path';
import { nativeInstallationPaths, nativeLauncher, nativeOptions, nativeRegistrySubkey } from '../scripts/native-platform.mjs';
import { HOST_NAME } from '../extension/lib/contracts.js';
import { encodeFrame } from '../bridge/framing.mjs';

test('native host locations match Chrome registration on each supported platform', () => {
  const windowsHome = 'C:\\Users\\Native Test';
  const windowsRoot = win32.join(windowsHome, '.nexly-web-agent');
  const windows = nativeInstallationPaths({ system: 'win32', home: windowsHome });
  assert.equal(windows.ownRoot, windowsRoot);
  assert.equal(windows.nativeRoot, windowsRoot);
  assert.equal(windows.manifestPath, win32.join(windowsRoot, `${HOST_NAME}.json`));
  assert.equal(windows.launcher, win32.join(windowsRoot, 'native-host.cmd'));
  assert.equal(windows.registryKey, `HKCU\\Software\\Google\\Chrome\\NativeMessagingHosts\\${HOST_NAME}`);

  const home = '/home/native test';
  const ownRoot = posix.join(home, '.nexly-web-agent');
  for (const [system, nativeRoot] of [
    ['darwin', posix.join(home, 'Library/Application Support/Google/Chrome/NativeMessagingHosts')],
    ['linux', posix.join(home, '.config/google-chrome/NativeMessagingHosts')]
  ]) {
    const paths = nativeInstallationPaths({ system, home });
    assert.equal(paths.manifestPath, posix.join(nativeRoot, `${HOST_NAME}.json`));
    assert.equal(paths.launcher, posix.join(ownRoot, 'native-host.sh'));
    assert.equal(paths.registryKey, null);
  }
});

test('native launchers protect fixed command paths and forward Chrome arguments', () => {
  const windows = nativeLauncher('C:\\Node %NAME% !bin!\\node.exe', 'C:\\项目 空格\\bridge\\native-host.mjs', 'win32');
  assert.match(windows, /^@echo off\r?\n/);
  assert.match(windows, /setlocal DisableDelayedExpansion/i);
  assert.ok(windows.includes('"C:\\Node %%NAME%% !bin!\\node.exe" "C:\\项目 空格\\bridge\\native-host.mjs" %*'));
  assert.ok(!windows.includes('2>&1'));

  const posix = nativeLauncher('/path with spaces/node', "/project's path/native-host.mjs", 'linux');
  assert.match(posix, /^#!\/bin\/sh\n/);
  assert.ok(posix.includes("exec '/path with spaces/node' '/project'\\''s path/native-host.mjs' \"$@\""));
});

test('Windows launcher preserves binary pipes and Chrome arguments with Unicode and special project paths', { skip: platform() !== 'win32' }, async () => {
  const temporary = await mkdtemp(join(tmpdir(), 'nexly-native-launcher-'));
  try {
    const project = join(temporary, '项目 空格 %NEXLY_NATIVE_TEST% !bang! & directory');
    const launcherDirectory = join(temporary, '启动器 directory');
    await mkdir(project);
    await mkdir(launcherDirectory);
    const hostPath = join(project, 'host.mjs');
    const launcherPath = join(launcherDirectory, 'native-host.cmd');
    await writeFile(hostPath, `const chunks = []; process.stdin.on('data', chunk => chunks.push(chunk)); process.stdin.on('end', () => { const body = Buffer.from(JSON.stringify({ args: process.argv.slice(2), inputHex: Buffer.concat(chunks).toString('hex') }), 'utf8'); const header = Buffer.alloc(4); header.writeUInt32LE(body.length); process.stdout.write(Buffer.concat([header, body])); });\n`);
    await writeFile(launcherPath, nativeLauncher(process.execPath, hostPath, 'win32'));
    const origin = 'chrome-extension://abcdefghijklmnopabcdefghijklmnop/';
    const args = [origin, '--parent-window=0', 'literal & text!bang!'];
    const input = encodeFrame({ requestId: 'native-windows', action: 'health', text: '中文🧩\r\n' });
    const output = await launchLikeChrome(launcherPath, args, input, { NEXLY_NATIVE_TEST: 'must-not-expand', bang: 'must-not-expand' });
    assert.equal(output.stderr, '');
    assert.ok(output.stdout.length >= 4, 'launcher did not return a native messaging frame');
    const size = output.stdout.readUInt32LE(0);
    assert.equal(output.stdout.length, size + 4, 'launcher stdout contains extra text or a truncated frame');
    const result = JSON.parse(output.stdout.subarray(4).toString('utf8'));
    assert.deepEqual(result.args, args);
    assert.equal(result.inputHex, input.toString('hex'));
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
});

function launchLikeChrome(launcherPath, args, input, extraEnvironment = {}) {
  return new Promise((resolve, reject) => {
    // Chromium wraps non-.exe hosts in cmd.exe /d /s /c "<command>".
    const command = `""${launcherPath}" ${args.map(arg => `"${arg}"`).join(' ')}"`;
    const child = spawn(process.env.ComSpec || process.env.COMSPEC || 'cmd.exe', ['/d', '/s', '/c', command], {
      env: { ...process.env, ...extraEnvironment },
      windowsVerbatimArguments: true,
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe']
    });
    const stdout = [], stderr = [];
    const timer = setTimeout(() => { child.kill(); reject(new Error('Windows launcher did not close')); }, 5000);
    child.stdout.on('data', chunk => stdout.push(chunk));
    child.stderr.on('data', chunk => stderr.push(chunk));
    child.stdin.on('error', () => {});
    child.on('error', error => { clearTimeout(timer); reject(error); });
    child.on('close', code => {
      clearTimeout(timer);
      const errorOutput = Buffer.concat(stderr).toString('utf8');
      if (code !== 0) reject(new Error(`Windows launcher exited with code ${code}: ${errorOutput}`));
      else resolve({ stdout: Buffer.concat(stdout), stderr: errorOutput });
    });
    child.stdin.end(input);
  });
}


test('Edge native registrations are isolated from Chrome and accept only an explicit extension ID', () => {
  const id = 'abcdefghijklmnopabcdefghijklmnop';
  assert.deepEqual(nativeOptions(['--browser', 'edge', '--extension-id', id, '--dry-run'], id), { browser: 'edge', extensionId: id, dryRun: true });
  for (const args of [['--browser', 'unknown'], ['--extension-id', '*'], ['--extension-id', 'https://evil.test'], ['--browser'], ['--dry-run', '--dry-run'], ['--shell']]) assert.throws(() => nativeOptions(args, id));
  const windows = nativeInstallationPaths({ system: 'win32', home: 'C:/Users/tester', browser: 'edge' });
  assert.equal(windows.registryKey, `HKCU\\${nativeRegistrySubkey('edge')}`);
  assert.ok(windows.manifestPath.endsWith('edge\\com.nexly.web_agent.json'));
  for (const system of ['darwin', 'linux', 'win32']) {
    const options = { system, home: system === 'win32' ? 'C:/Users/tester' : '/home/tester' };
    const chrome = nativeInstallationPaths(options), edge = nativeInstallationPaths({ ...options, browser: 'edge' });
    assert.notEqual(edge.manifestPath, chrome.manifestPath);
    assert.notEqual(edge.launcher, chrome.launcher);
    assert.notEqual(edge.installationPath, chrome.installationPath);
    assert.equal(edge.ownRoot, chrome.ownRoot);
  }
  assert.equal(nativeInstallationPaths({ system: 'darwin', home: '/Users/tester', browser: 'edge' }).nativeRoot, '/Users/tester/Library/Application Support/Microsoft Edge/NativeMessagingHosts');
  assert.equal(nativeInstallationPaths({ system: 'linux', home: '/home/tester', browser: 'edge' }).nativeRoot, '/home/tester/.config/microsoft-edge/NativeMessagingHosts');
});


test('isolated macOS/Linux native install, ID update and uninstall do not touch the other browser', { skip: platform() === 'win32' }, async (t) => {
  const home = await mkdtemp(join(tmpdir(), 'quizmate-native-home-'));
  t.after(() => rm(home, { recursive: true, force: true }));
  const env = { ...process.env, HOME: home };
  const run = (script, args = []) => execFileSync(process.execPath, [fileURLToPath(new URL(`../scripts/${script}.mjs`, import.meta.url)), ...args], { env, encoding: 'utf8' });
  const id = 'abcdefghijklmnopabcdefghijklmnop', replacement = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
  const chrome = nativeInstallationPaths({ home }), edge = nativeInstallationPaths({ home, browser: 'edge' });
  run('install-native');
  const originalChrome = await readFile(chrome.manifestPath, 'utf8');
  run('install-native', ['--browser', 'edge', '--extension-id', id]);
  assert.deepEqual(JSON.parse(await readFile(edge.manifestPath, 'utf8')).allowed_origins, [`chrome-extension://${id}/`]);
  run('install-native', ['--browser', 'edge', '--extension-id', replacement]);
  assert.deepEqual(JSON.parse(await readFile(edge.manifestPath, 'utf8')).allowed_origins, [`chrome-extension://${replacement}/`]);
  run('uninstall-native', ['--browser', 'edge', '--extension-id', replacement, '--dry-run']);
  await access(edge.manifestPath);
  const record = await readFile(edge.installationPath, 'utf8');
  await writeFile(edge.installationPath, JSON.stringify({ ...JSON.parse(record), projectRoot: '/different/project' }));
  assert.throws(() => run('install-native', ['--browser', 'edge', '--extension-id', id]));
  assert.deepEqual(JSON.parse(await readFile(edge.manifestPath, 'utf8')).allowed_origins, [`chrome-extension://${replacement}/`]);
  await writeFile(edge.installationPath, record);
  run('uninstall-native', ['--browser', 'edge', '--extension-id', replacement]);
  await assert.rejects(access(edge.manifestPath)); await assert.rejects(access(edge.launcher));
  assert.equal(await readFile(chrome.manifestPath, 'utf8'), originalChrome);
  await access(chrome.launcher);
  run('uninstall-native'); await assert.rejects(access(chrome.manifestPath));
});

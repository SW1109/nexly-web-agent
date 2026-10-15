import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { platform, tmpdir } from 'node:os';
import { join, posix, win32 } from 'node:path';
import { nativeInstallationPaths, nativeLauncher } from '../scripts/native-platform.mjs';
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

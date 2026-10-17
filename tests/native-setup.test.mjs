import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { detectNativeBrowser, nativeSetupOptions, nativeRepairScript, nativeConnectionAdvice } from '../extension/lib/native-setup.js';

const storeId = 'nmkgnejillemkmplbkcklhdcfkgefoce';

test('detects Edge before Chromium and lets unidentified browsers be selected manually', () => {
  assert.equal(detectNativeBrowser({ userAgent: 'Mozilla/5.0 Chrome/145.0 Safari/537.36 Edg/145.0' }), 'edge');
  assert.equal(detectNativeBrowser({ brands: [{ brand: 'Chromium' }, { brand: 'Microsoft Edge' }] }), 'edge');
  assert.equal(detectNativeBrowser({ userAgent: 'Mozilla/5.0 Chrome/145.0 Safari/537.36' }), 'chrome');
  assert.equal(detectNativeBrowser({ brands: [{ brand: 'Google Chrome' }] }), 'chrome');
  assert.equal(detectNativeBrowser({ userAgent: 'unknown browser' }), null);
});

test('setup commands use the actual runtime extension ID and validate shell inputs', () => {
  assert.equal(nativeSetupOptions(storeId, 'edge').command, `node scripts/install-native.mjs --browser edge --extension-id ${storeId}`);
  assert.match(nativeSetupOptions(storeId, 'chrome').command, new RegExp(`--browser chrome --extension-id ${storeId}$`));
  for (const id of ['', 'YOUR_EXTENSION_ID', storeId + '; echo unsafe', 'q'.repeat(32)]) assert.throws(() => nativeSetupOptions(id, 'edge'));
  assert.throws(() => nativeSetupOptions(storeId, 'edge & echo unsafe'));
  assert.throws(() => nativeRepairScript(storeId, 'firefox'));
});

test('connection advice distinguishes denied authorization, missing registration and startup failure', () => {
  assert.match(nativeConnectionAdvice('Access to the specified native messaging host is forbidden.'), /当前扩展 ID/);
  assert.match(nativeConnectionAdvice('Specified native messaging host not found.'), /尚未找到/);
  assert.match(nativeConnectionAdvice('Native host has exited.'), /未能正常启动/);
  assert.match(nativeConnectionAdvice('Other transport error'), /安装或修复/);
});

test('downloaded repair script preserves project paths and passes only the selected browser and extension ID', async (t) => {
  const temporary = await mkdtemp(join(tmpdir(), 'quizmate-setup-'));
  t.after(() => rm(temporary, { recursive: true, force: true }));
  const project = join(temporary, '项目 with spaces & characters');
  await mkdir(join(project, 'scripts'), { recursive: true });
  await writeFile(join(project, 'package.json'), JSON.stringify({ name: 'quiz-mate', type: 'module' }));
  const capture = join(temporary, 'capture.json');
  await writeFile(join(project, 'scripts/install-native.mjs'), `import {writeFileSync} from 'node:fs'; writeFileSync(process.env.QUIZMATE_SETUP_CAPTURE, JSON.stringify({args:process.argv.slice(2),cwd:process.cwd()}));`);
  for (const browser of ['edge', 'chrome']) {
    const script = join(temporary, `setup-${browser}.mjs`);
    await writeFile(script, nativeRepairScript(storeId, browser));
    const preview = spawnSync(process.execPath, [script, project, '--dry-run'], { encoding: 'utf8', windowsHide: true });
    assert.equal(preview.status, 0, preview.stderr);
    const planned = JSON.parse(preview.stdout);
    assert.equal(planned.projectRoot, project);
    assert.equal(planned.extensionId, storeId);
    assert.equal(planned.browser, browser);
    assert.deepEqual(planned.args, [join(project, 'scripts/install-native.mjs'), '--browser', browser, '--extension-id', storeId]);
    const result = spawnSync(process.execPath, [script, project], { encoding: 'utf8', windowsHide: true, env: { ...process.env, QUIZMATE_SETUP_CAPTURE: capture } });
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(JSON.parse(await readFile(capture, 'utf8')), { args: ['--browser', browser, '--extension-id', storeId], cwd: project });
  }
});

test('downloaded repair script refuses an unrelated folder without running its installer', async (t) => {
  const temporary = await mkdtemp(join(tmpdir(), 'quizmate-setup-unrelated-'));
  t.after(() => rm(temporary, { recursive: true, force: true }));
  await mkdir(join(temporary, 'scripts'));
  await writeFile(join(temporary, 'package.json'), JSON.stringify({ name: 'unrelated-project' }));
  await writeFile(join(temporary, 'scripts/install-native.mjs'), 'throw new Error("unrelated installer ran");');
  const script = join(temporary, 'repair.mjs');
  await writeFile(script, nativeRepairScript(storeId, 'edge'));
  const result = spawnSync(process.execPath, [script, temporary], { encoding: 'utf8', windowsHide: true });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /未找到 QuizMate 项目目录/);
  assert.doesNotMatch(result.stderr, /unrelated installer ran/);
});

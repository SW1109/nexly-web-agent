import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdir, readFile } from 'node:fs/promises';
import { resolve, join, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { nativeRepairScript } from '../extension/lib/native-setup.js';

const enabled = process.env.NEXLY_NATIVE_BROWSER_TEST === '1' || process.env.NEXLY_BROWSER_TEST === '1';
test('bridge setup UI recovers from denied store IDs, copies commands, downloads a repair script and clears stale errors', { skip: !enabled, timeout: 60000 }, async (t) => {
  const { chromium } = await import(process.env.NEXLY_PLAYWRIGHT_PATH || 'playwright');
  const source = fileURLToPath(new URL('../extension/', import.meta.url));
  const manifest = JSON.parse(await readFile(join(source, 'manifest.json'), 'utf8'));
  const server = createServer(async (request, response) => {
    try {
      const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
      const file = resolve(source, '.' + (pathname === '/' ? '/panel.html' : pathname));
      if (!file.startsWith(source.endsWith(sep) ? source : source + sep)) { response.writeHead(403).end(); return; }
      const contentType = file.endsWith('.js') ? 'text/javascript' : file.endsWith('.css') ? 'text/css' : file.endsWith('.png') ? 'image/png' : 'text/html; charset=utf-8';
      response.setHeader('Content-Type', contentType); response.end(await readFile(file));
    } catch { response.writeHead(404).end(); }
  });
  await new Promise(done => server.listen(0, '127.0.0.1', done));
  t.after(async () => { server.closeAllConnections(); await new Promise(done => server.close(done)); });
  const browser = await chromium.launch({ headless: true, ...(process.env.NEXLY_CHROME_PATH ? { executablePath: process.env.NEXLY_CHROME_PATH } : {}) });
  t.after(() => browser.close());
  const context = await browser.newContext({ userAgent: 'Mozilla/5.0 Chrome/145.0 Safari/537.36 Edg/145.0', acceptDownloads: true });
  const storeId = 'nmkgnejillemkmplbkcklhdcfkgefoce';
  await context.addInitScript(({ id, version }) => {
    const health = { nodeVersion: 'v24.9.0', providers: [{ id: 'codex', installed: true, version: 'codex-cli test', configs: [] }] };
    const failure = '无法连接本地 CLI 桥：Access to the specified native messaging host is forbidden。请点击“设置本地桥”。';
    const apiSettings = { config: { baseUrl: '', protocol: 'auto', model: '', timeoutSeconds: 180 }, hasKey: false, rememberKey: false };
    const saved = { dataConsentVersion: 1, connectionMode: 'local' };
    const noopEvent = () => ({ addListener() {} });
    window.__nativeReady = false;
    window.__copied = '';
    if (!navigator.clipboard) Object.defineProperty(navigator, 'clipboard', { configurable: true, value: {} });
    Object.defineProperty(navigator.clipboard, 'writeText', { configurable: true, value: async (text) => { window.__copied = text; } });
    window.chrome = {
      runtime: {
        id, getManifest: () => ({ version }), onMessage: noopEvent(),
        async sendMessage(message) {
          if (message.action === 'apiSettings') return { ok: true, data: apiSettings };
          if (message.action === 'health') return message.connectionMode === 'api' ? { ok: true, data: { ...apiSettings, ready: false } } : window.__nativeReady ? { ok: true, data: health } : { ok: false, error: failure };
          if (message.action === 'state') return { ok: true, data: { phase: 'idle', busy: false, paused: false, question: null, answer: null, log: [], error: '', completed: 0 } };
          throw new Error('Unexpected command: ' + message.action);
        },
        connectNative() {
          const incoming = [], disconnected = [];
          return {
            onMessage: { addListener(fn) { incoming.push(fn); } },
            onDisconnect: { addListener(fn) { disconnected.push(fn); } },
            postMessage(message) { queueMicrotask(() => {
              if (window.__nativeReady) incoming.forEach(fn => fn({ requestId: message.requestId, type: 'result', data: health }));
              else { window.chrome.runtime.lastError = { message: 'Access to the specified native messaging host is forbidden.' }; disconnected.forEach(fn => fn()); delete window.chrome.runtime.lastError; }
            }); }
          };
        }
      },
      storage: { local: { async get() { return { ...saved }; }, async set(values) { Object.assign(saved, values); } }, onChanged: noopEvent() }
    };
  }, { id: storeId, version: manifest.version });
  const origin = `http://127.0.0.1:${server.address().port}`;
  const errors = [];
  context.on('page', page => page.on('pageerror', error => errors.push(error.message)));
  const panel = await context.newPage();
  await panel.goto(origin + '/panel.html?view=practice');
  await panel.locator('#native-recovery').waitFor({ state: 'visible' });
  assert.match(await panel.locator('#error').textContent(), /forbidden/);
  await panel.locator('#open-settings').click();
  await panel.locator('#connection-mode').selectOption('api');
  assert.equal(await panel.locator('#native-recovery').isHidden(), true);
  await panel.locator('#connection-mode').selectOption('local');
  await panel.locator('#native-recovery').waitFor({ state: 'visible' });
  const opened = panel.waitForEvent('popup');
  await panel.locator('#native-recovery a').click();
  const setup = await opened; await setup.waitForLoadState('networkidle');
  assert.equal(await setup.locator('#bridge-browser').inputValue(), 'edge');
  assert.equal(await setup.locator('#bridge-extension-id').inputValue(), storeId);
  assert.equal(await setup.locator('#bridge-extension-id').getAttribute('readonly'), '');
  assert.equal(await setup.locator('#bridge-command').inputValue(), `node scripts/install-native.mjs --browser edge --extension-id ${storeId}`);
  await setup.locator('#copy-bridge-command').click();
  assert.equal(await setup.evaluate(() => window.__copied), await setup.locator('#bridge-command').inputValue());
  await setup.locator('#bridge-browser').selectOption('chrome');
  assert.match(await setup.locator('#bridge-command').inputValue(), new RegExp(`--browser chrome --extension-id ${storeId}$`));
  await setup.locator('#bridge-browser').selectOption('edge');
  const downloading = setup.waitForEvent('download'); await setup.locator('#download-bridge-repair').click();
  const download = await downloading;
  assert.equal(download.suggestedFilename(), 'quizmate-bridge-setup-edge.mjs');
  assert.equal(await readFile(await download.path(), 'utf8'), nativeRepairScript(storeId, 'edge'));
  await setup.locator('#check-bridge').click();
  await setup.waitForFunction(() => document.getElementById('bridge-check-status').dataset.error === 'true');
  assert.match(await setup.locator('#bridge-check-status').textContent(), /当前扩展 ID/);
  assert.match(await setup.locator('#bridge-check-error').textContent(), /forbidden/);
  await setup.evaluate(() => { window.__nativeReady = true; });
  await setup.locator('#check-bridge').click();
  await setup.waitForFunction(() => document.getElementById('bridge-check-status').dataset.error === 'false');
  assert.equal(await setup.locator('#bridge-check-details').isHidden(), true);
  assert.match(await setup.locator('#bridge-providers').textContent(), /codex-cli test/);
  await setup.evaluate(() => { Object.defineProperty(navigator.clipboard, 'writeText', { configurable: true, value: async () => { throw new Error('Clipboard denied'); } }); });
  await setup.locator('#copy-bridge-command').click();
  assert.match(await setup.locator('#bridge-action-status').textContent(), /文本已选中/);
  assert.equal(await setup.locator('#bridge-command').evaluate(element => element.selectionEnd - element.selectionStart), (await setup.locator('#bridge-command').inputValue()).length);
  for (const colorScheme of ['light', 'dark']) {
    await setup.emulateMedia({ colorScheme, reducedMotion: 'reduce' });
    for (const width of [320, 400, 1280]) {
      await setup.setViewportSize({ width, height: 900 });
      assert.equal(await setup.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), true, `${colorScheme} ${width}px overflow`);
    }
    if (process.env.NEXLY_NATIVE_ARTIFACT_DIR) {
      await mkdir(process.env.NEXLY_NATIVE_ARTIFACT_DIR, { recursive: true });
      await setup.setViewportSize({ width: 760, height: 900 });
      await setup.screenshot({ path: join(process.env.NEXLY_NATIVE_ARTIFACT_DIR, `native-setup-${colorScheme}.png`), fullPage: true });
    }
  }
  await panel.evaluate(() => { window.__nativeReady = true; });
  await panel.locator('#refresh').click();
  await panel.waitForFunction(() => document.getElementById('connection-status').textContent === '本地桥已连接');
  assert.equal(await panel.locator('#native-recovery').isHidden(), true);
  assert.equal(await panel.locator('#error').isHidden(), true);
  assert.deepEqual(errors, []);
});

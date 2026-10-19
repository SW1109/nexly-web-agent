import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdir, readFile } from 'node:fs/promises';
import { resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const enabled = process.env.NEXLY_PANEL_BROWSER_TEST === '1' || process.env.NEXLY_BROWSER_TEST === '1';

test('panel keeps reading cancelable, recovers failures and preserves settings during a task', { skip: !enabled, timeout: 90000 }, async (t) => {
  const { chromium } = await import(process.env.NEXLY_PLAYWRIGHT_PATH || 'playwright');
  const source = fileURLToPath(new URL('../extension/', import.meta.url));
  const server = createServer(async (request, response) => {
    try {
      const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
      const file = resolve(source, '.' + (pathname === '/' ? '/panel.html' : pathname));
      if (!file.startsWith(source.endsWith(sep) ? source : source + sep)) { response.writeHead(403).end(); return; }
      response.setHeader('Content-Type', file.endsWith('.js') ? 'text/javascript' : file.endsWith('.css') ? 'text/css' : file.endsWith('.png') ? 'image/png' : 'text/html; charset=utf-8');
      response.end(await readFile(file));
    } catch { response.writeHead(404).end(); }
  });
  await new Promise(done => server.listen(0, '127.0.0.1', done));
  t.after(async () => { server.closeAllConnections(); await new Promise(done => server.close(done)); });
  const browser = await chromium.launch({ headless: true, ...(process.env.NEXLY_CHROME_PATH ? { executablePath: process.env.NEXLY_CHROME_PATH } : {}) });
  t.after(() => browser.close());
  const origin = `http://127.0.0.1:${server.address().port}`;
  const artifacts = resolve(source, '../.local/ui-stability');
  await mkdir(artifacts, { recursive: true });

  async function openPanel(subtest, { nativeFailed = false, colorScheme = 'light', view = 'practice', pageUrl = 'https://practice.example.test/exam/training' } = {}) {
    const context = await browser.newContext({ viewport: { width: 320, height: 900 }, colorScheme });
    const errors = [];
    subtest.after(async () => { await context.close(); assert.deepEqual(errors, [], 'the panel must not throw page errors'); });
    await context.addInitScript(({ nativeFailed, pageUrl }) => {
      const id = 'nmkgnejillemkmplbkcklhdcfkgefoce';
      const event = () => {
        const listeners = [];
        return { addListener(fn) { listeners.push(fn); }, emit(...args) { for (const fn of listeners) fn(...args); } };
      };
      const messages = event(), storageChanged = event();
      const state = { phase: 'idle', busy: false, paused: false, question: null, answer: null, log: [], error: '', completed: 0 };
      const health = { nodeVersion: 'v24.9.0', providers: [{ id: 'codex', installed: true, version: 'codex-cli fixture', configs: [] }] };
      const question = { questionId: 'current-question', type: 'judge', pageUrl, title: '当前练习题', stem: '这是 fixture 中的当前练习题。', options: [{ id: 'true', label: 'A', text: '正确(True)' }, { id: 'false', label: 'B', text: '错误(False)' }], fields: [] };
      const f = window.__panelFixture = {
        state, healthMode: nativeFailed ? 'failed' : 'ready', commands: [], saved: { dataConsentVersion: 1, connectionMode: 'local' }, writes: [],
        deferred: { read: [], health: [] }, released: [],
        nativeError: '无法连接本地 CLI 桥：Access to the specified native messaging host is forbidden。请点击“设置本地桥”。',
        healthReply: { ok: true, data: health }, readReply: { ok: true, data: { ...state, phase: 'read', question } },
        emit(patch) { this.state = { ...this.state, ...structuredClone(patch) }; messages.emit({ type: 'state', state: structuredClone(this.state) }, { id }); },
        release(action, index, response) { this.deferred[action][index](response); }
      };
      async function deferred(action) {
        const reply = await new Promise(resolve => f.deferred[action].push(resolve));
        f.released.push(action);
        return reply;
      }
      window.chrome = {
        tabs: { async query() { return [{ id: 7, url: pageUrl, active: true, windowId: 1 }]; } },
        webNavigation: { async getAllFrames() { return [{ frameId: 0, parentFrameId: -1, url: pageUrl }]; } },
        permissions: { async contains() { return true; }, async request() { return true; } },
        runtime: {
          id, onMessage: messages,
          async sendMessage(message) {
            f.commands.push(structuredClone(message));
            if (message.type === 'course-command') {
              const course = { phase: 'idle', platformId: '', running: false, operation: '', tabId: null, snapshot: null, watched: 0, log: [], message: '等待识别', error: '' };
              if (message.action === 'scan') Object.assign(course, { phase: 'ready', platformId: 'ouchn', tabId: 7, snapshot: { title: '模拟国开课程', chapters: [], questions: [], gate: '', media: { count: 1, duration: 20, currentTime: 0, rate: 1 } } });
              return { ok: true, data: course };
            }
            if (message.action === 'apiSettings') return { ok: true, data: { config: { baseUrl: '', protocol: 'auto', model: '', timeoutSeconds: 180 }, hasKey: false, rememberKey: false } };
            if (message.action === 'state') return { ok: true, data: structuredClone(f.state) };
            if (message.action === 'health') return f.healthMode === 'deferred' ? deferred('health') : f.healthMode === 'failed' ? { ok: false, error: f.nativeError } : structuredClone(f.healthReply);
            if (message.action === 'read') return deferred('read');
            if (message.action === 'stop') { f.state = { ...f.state, phase: 'stopped', busy: false, paused: false, error: '' }; return { ok: true, data: structuredClone(f.state) }; }
            throw new Error('Unexpected command: ' + message.action);
          }
        },
        storage: {
          local: { async get() { return { ...f.saved }; }, async set(values) { f.writes.push(structuredClone(values)); Object.assign(f.saved, values); } },
          onChanged: storageChanged
        }
      };
    }, { nativeFailed, pageUrl });
    const page = await context.newPage();
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(origin + '/panel.html?view=' + view);
    await page.waitForFunction(failed => document.getElementById('connection-status').textContent === (failed ? '本地桥未连接' : '本地桥已连接'), nativeFailed);
    return page;
  }
  // Give the command continuation and its render/finally microtasks time to finish without fixed sleeps.
  const rendered = page => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  async function beginRead(page) {
    await page.locator('#read').click();
    await page.waitForFunction(() => window.__panelFixture.deferred.read.length === 1);
    assert.match(await page.locator('#read').textContent(), /正在读取/);
    assert.match(await page.locator('#task-status').textContent(), /正在读取/);
    assert.equal(await page.locator('#read').getAttribute('aria-busy'), 'true');
    assert.equal(await page.locator('.question-section').getAttribute('aria-busy'), 'true');
    assert.equal(await page.locator('#pause').isDisabled(), true);
    assert.equal(await page.locator('#stop').isEnabled(), true);
    assert.equal(await page.locator('#task-controls').isVisible(), true);
  }
  async function releaseOldRead(page, success) {
    await page.evaluate(success => {
      const f = window.__panelFixture;
      f.release('read', 0, success ? f.readReply : { ok: false, error: '旧读取失败：没有识别到练习题，请重新读取' });
    }, success);
    await page.waitForFunction(() => window.__panelFixture.released.includes('read'));
    await rendered(page);
  }

  for (const success of [false, true]) {
    await t.test(`stop keeps its state after an old read ${success ? 'succeeds' : 'fails'}`, async subtest => {
      const page = await openPanel(subtest);
      await beginRead(page);
      await page.locator('#stop').click();
      await page.waitForFunction(() => document.getElementById('task-status').textContent === '任务已停止');
      await releaseOldRead(page, success);
      assert.equal(await page.locator('#task-status').textContent(), '任务已停止');
      assert.equal(await page.locator('#error').isHidden(), true);
      assert.equal(await page.locator('#question').isHidden(), true);
      assert.equal(await page.locator('#read').getAttribute('aria-busy'), 'false');
      assert.equal(await page.locator('#read').isEnabled(), true);
      assert.deepEqual(await page.evaluate(() => window.__panelFixture.commands.filter(message => ['read', 'stop', 'start'].includes(message.action)).map(message => message.action)), ['read', 'stop']);
    });
  }

  for (const [phase, label, success] of [['stopped', '任务已停止', false], ['interrupted', '任务已中断', true]]) {
    await t.test(`a remote ${phase} broadcast invalidates a pending read`, async subtest => {
      const page = await openPanel(subtest);
      await beginRead(page);
      await page.evaluate(phase => window.__panelFixture.emit({ phase, busy: false, error: '' }), phase);
      await releaseOldRead(page, success);
      assert.equal(await page.locator('#task-status').textContent(), label);
      assert.equal(await page.locator('#error').isHidden(), true);
      assert.equal(await page.locator('#question').isHidden(), true);
      assert.equal(await page.locator('#read').getAttribute('aria-busy'), 'false');
      assert.equal(await page.locator('#read').isEnabled(), true);
    });
  }

  await t.test('saving a retained draft can republish stopped without canceling a new start', async subtest => {
    const page = await openPanel(subtest);
    await page.evaluate(() => { const f = window.__panelFixture; f.saved.autoControls = true; f.emit({ phase: 'stopped', busy: false }); });
    await page.locator('#open-settings').click();
    await page.locator('#setting-controls').click();
    await page.locator('#auto-controls').uncheck();
    // A task started from another entry while settings were being edited.
    await page.evaluate(() => window.__panelFixture.emit({ phase: 'solving', busy: true }));
    await page.locator('#close-settings').click();
    assert.deepEqual(await page.evaluate(() => window.__panelFixture.writes), [], 'busy return keeps the draft');
    await page.evaluate(() => {
      const f = window.__panelFixture;
      f.emit({ phase: 'stopped', busy: false });
      const save = chrome.storage.local.set;
      chrome.storage.local.set = async (values) => {
        await save(values);
        // applyAutoControls(false) publishes its new bindings without changing phase.
        if (values.autoControls === false) f.emit({ controls: {} });
      };
      const send = chrome.runtime.sendMessage;
      chrome.runtime.sendMessage = async (message) => {
        if (message.action !== 'start') return send(message);
        f.commands.push(structuredClone(message));
        f.emit({ phase: 'reading', busy: true, operation: null });
        return { ok: true, data: structuredClone(f.state) };
      };
    });
    await page.locator('#auto').click();
    await page.waitForFunction(() => window.__panelFixture.commands.some(message => message.action === 'start'));
    assert.equal(await page.evaluate(() => window.__panelFixture.commands.filter(message => message.action === 'start').length), 1);
    assert.equal(await page.evaluate(() => window.__panelFixture.saved.autoControls), false);
    assert.equal(await page.locator('#task-status').textContent(), '读取题目中');
    assert.equal(await page.locator('#stop').isEnabled(), true);
  });

  await t.test('page recovery retries reading without starting a solver task', async subtest => {
    const page = await openPanel(subtest);
    await beginRead(page);
    await page.evaluate(() => window.__panelFixture.release('read', 0, { ok: false, error: '没有识别到练习题，请重新读取' }));
    await page.locator('#retry-page').waitFor({ state: 'visible' });
    await page.waitForFunction(() => !document.getElementById('retry-page').disabled);
    await page.locator('#retry-page').click();
    await page.waitForFunction(() => window.__panelFixture.deferred.read.length === 2);
    assert.equal(await page.locator('#retry-page').isDisabled(), true);
    await page.evaluate(() => { const f = window.__panelFixture; f.release('read', 1, f.readReply); });
    await page.locator('#question').waitFor({ state: 'visible' });
    assert.equal(await page.locator('#page-recovery').isHidden(), true);
    assert.equal(await page.locator('#error').isHidden(), true);
    assert.equal(await page.locator('#question-name').textContent(), '当前练习题');
    assert.deepEqual(await page.evaluate(() => window.__panelFixture.commands.filter(message => ['read', 'start'].includes(message.action)).map(message => message.action)), ['read', 'read']);
  });

  await t.test('native recovery remains locked through runtime renders until health finishes', async subtest => {
    const page = await openPanel(subtest);
    assert.equal(await page.locator('#auto').isEnabled(), true);
    assert.equal(await page.locator('#solve').isEnabled(), true);
    await page.evaluate(() => {
      const f = window.__panelFixture;
      f.emit({ phase: 'solving', busy: true });
      f.emit({ phase: 'error', busy: false, error: f.nativeError });
    });
    await page.locator('#native-recovery').waitFor({ state: 'visible' });
    assert.equal(await page.locator('#connection-status').textContent(), '本地桥未连接');
    assert.match(await page.locator('#connection-status').getAttribute('class'), /bad/);
    assert.equal(await page.locator('#auto').isDisabled(), true);
    assert.equal(await page.locator('#solve').isDisabled(), true);
    await page.evaluate(() => { window.__panelFixture.healthMode = 'deferred'; });
    await page.locator('#retry-native').click();
    await page.waitForFunction(() => window.__panelFixture.deferred.health.length === 1);
    assert.equal(await page.locator('#retry-native').isDisabled(), true);
    assert.equal(await page.locator('#refresh').isDisabled(), true);
    await page.evaluate(() => { const f = window.__panelFixture; f.emit({ phase: 'idle', error: f.nativeError }); });
    assert.equal(await page.locator('#retry-native').isDisabled(), true);
    assert.equal(await page.locator('#refresh').isDisabled(), true);
    await page.locator('#open-settings').click();
    assert.equal(await page.locator('#refresh').isVisible(), true);
    assert.equal(await page.locator('#refresh').isDisabled(), true);
    await page.evaluate(() => { const f = window.__panelFixture; f.healthMode = 'ready'; f.release('health', 0, f.healthReply); });
    await page.waitForFunction(() => document.getElementById('connection-status').textContent === '本地桥已连接' && !document.getElementById('refresh').disabled);
    assert.equal(await page.locator('#native-recovery').isHidden(), true);
    assert.equal(await page.locator('#error').isHidden(), true);
    assert.equal(await page.locator('#retry-native').isEnabled(), true);
    await page.locator('#close-settings').click();
    assert.equal(await page.locator('#auto').isEnabled(), true);
    assert.equal(await page.locator('#solve').isEnabled(), true);
    assert.equal(await page.evaluate(() => window.__panelFixture.commands.filter(message => message.action === 'health').length), 2);
  });

  await t.test('dirty settings can return and escape during a task while opacity stays disabled', async subtest => {
    const page = await openPanel(subtest);
    await page.locator('#open-settings').click();
    await page.locator('#setting-practice').click();
    await page.locator('#count').fill('47');
    await page.evaluate(() => window.__panelFixture.emit({ phase: 'solving', busy: true, elapsedSeconds: 3 }));
    assert.equal(await page.locator('#controls-opacity').isDisabled(), true);
    assert.equal(await page.locator('#close-settings').isEnabled(), true);
    await page.locator('#close-settings').click();
    assert.equal(await page.locator('#settings-view').isHidden(), true);
    assert.equal(await page.locator('#task-view').isVisible(), true);
    await page.locator('#open-settings').click();
    assert.equal(await page.locator('#count').inputValue(), '47');
    assert.match(await page.locator('#settings-status').textContent(), /未保存.*已保留/);
    assert.equal(await page.locator('#controls-opacity').isDisabled(), true);
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('#settings-view').isHidden(), true);
    await page.locator('#open-settings').click();
    assert.equal(await page.locator('#count').inputValue(), '47');
    assert.deepEqual(await page.evaluate(() => window.__panelFixture.writes), [], 'leaving during a task preserves drafts without saving them');
  });

  for (const colorScheme of ['light', 'dark']) {
    await t.test(`320px ${colorScheme} task and settings views have no horizontal overflow`, async subtest => {
      const page = await openPanel(subtest, { colorScheme });
      await page.evaluate(() => window.__panelFixture.emit({ phase: 'error', error: '暂时无法读取练习页，请回到练习标签并等待加载完成后重新读取' }));
      async function checkWidth(view) {
        const dimensions = await page.evaluate(() => ({ viewport: innerWidth, document: document.documentElement.scrollWidth, body: document.body.scrollWidth }));
        assert.ok(dimensions.document <= dimensions.viewport && dimensions.body <= dimensions.viewport, `${view}: ${JSON.stringify(dimensions)}`);
      }
      await checkWidth('task');
      await page.screenshot({ path: resolve(artifacts, `panel-${colorScheme}-page-recovery.png`), fullPage: true });
      await page.locator('#open-settings').click();
      await checkWidth('settings');
      await page.keyboard.press('Escape');
      await checkWidth('returned task');
      await page.evaluate(() => {
        const f = window.__panelFixture;
        f.emit({ ...f.readReply.data, phase: 'solving', busy: true, elapsedSeconds: 35, completed: 12, error: '' });
      });
      await checkWidth('running task');
      await page.screenshot({ path: resolve(artifacts, `panel-${colorScheme}-running.png`), fullPage: true });
    });
  }
  await t.test('home is read-only, routes to the current practice and keeps all entries reachable', async subtest => {
    const page = await openPanel(subtest, { view: 'home' });
    await page.locator('#context-inspect').waitFor({ state: 'visible' });
    assert.equal(await page.locator('#home-workspace').isVisible(), true);
    assert.match(await page.locator('#context-host').textContent(), /practice.example.test/);
    assert.equal(await page.locator('#platform-links a').count(), 4);
    assert.equal(await page.evaluate(() => window.__panelFixture.commands.some(message => ['read','start','fill','run'].includes(message.action))), false);
    await page.locator('#context-inspect').click();
    await page.waitForFunction(() => window.__panelFixture.deferred.read.length === 1);
    assert.equal(await page.locator('#practice-workspace').isVisible(), true);
    await releaseOldRead(page, true);
    await page.locator('#tab-records').click();
    await page.locator('[data-record-filter="course"]').click();
    assert.equal(await page.locator('[data-record-kind="practice"]').isHidden(), true);
    assert.equal(await page.locator('[data-record-kind="course"]').isVisible(), true);
    await page.locator('#tab-records').focus(); await page.keyboard.press('Home');
    assert.equal(await page.locator('#tab-home').getAttribute('aria-selected'), 'true');
    await page.keyboard.press('End');
    assert.equal(await page.locator('#tab-records').getAttribute('aria-selected'), 'true');
  });
  await t.test('home recognizes supported courses while a missing CLI never blocks read-only course access', async subtest => {
    const page = await openPanel(subtest, { view: 'home', nativeFailed: true, pageUrl: 'https://moodle.syxy.ouchn.cn/mod/page/view.php?id=101' });
    await page.waitForFunction(() => document.getElementById('context-inspect').textContent.includes('识别这门课程'));
    assert.equal(await page.locator('#context-inspect').isEnabled(), true);
    assert.equal(await page.locator('#native-recovery').isHidden(), true, 'course entry must not look blocked by a missing CLI');
    await page.locator('#context-inspect').click();
    await page.locator('#course-current').waitFor({ state: 'visible' });
    assert.match(await page.locator('#course-name').textContent(), /模拟国开课程/);
    assert.equal(await page.evaluate(() => window.__panelFixture.commands.filter(message => message.type === 'course-command' && message.action === 'scan').length), 1);
    assert.equal(await page.evaluate(() => window.__panelFixture.commands.some(message => ['start','play','fill','run'].includes(message.action))), false);
  });
  await t.test('settings categories preserve drafts and reveal invalid fields before returning', async subtest => {
    const page = await openPanel(subtest);
    await page.locator('#open-settings').click();
    await page.locator('#setting-practice').click();
    await page.locator('#count').fill('101');
    await page.locator('#setting-controls').click();
    await page.locator('#save-settings').click();
    await page.waitForFunction(() => document.getElementById('count').getAttribute('aria-invalid') === 'true');
    assert.equal(await page.locator('#settings-practice').isVisible(), true);
    assert.equal(await page.locator('#count').evaluate(input => input === document.activeElement), true);
    await page.locator('#count').fill('31');
    await page.locator('#setting-course').click();
    assert.equal(await page.locator('#course-playbackRate').getAttribute('min'), '0.5');
    assert.equal(await page.locator('#course-playbackRate').getAttribute('max'), '16');
    assert.equal(await page.locator('#course-playbackRate').getAttribute('step'), '0.25');
    await page.locator('#course-playbackRate').fill('16.25');
    await page.locator('#setting-about').click();
    await page.locator('#tab-home').click();
    await page.waitForFunction(() => !document.getElementById('settings-course').hidden);
    assert.equal(await page.locator('#settings-view').isVisible(), true, 'invalid drafts must not disappear behind workspace navigation');
    assert.equal(await page.locator('#count').inputValue(), '31');
    await page.locator('#course-playbackRate').fill('16');
    await page.locator('#save-settings').click();
    await page.waitForFunction(() => document.getElementById('settings-status').textContent.startsWith('已保存'));
    assert.equal(await page.evaluate(() => window.__panelFixture.saved.courseSettings.playbackRate), 16);
    assert.equal(await page.evaluate(() => window.__panelFixture.saved.count), 31);
  });
  for (const colorScheme of ['light', 'dark']) {
    await t.test(`all workspaces and settings categories stay inside 320/400/1280/1920px in ${colorScheme}`, async subtest => {
      const page = await openPanel(subtest, { view: 'home', colorScheme });
      await page.emulateMedia({ reducedMotion: 'reduce' });
      for (const width of [320,400,1280,1920]) {
        await page.setViewportSize({ width, height: 900 });
        for (const view of ['home','course','practice','records']) {
          await page.locator('#tab-' + view).click();
          assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, view + '/' + width);
          if (width === 320 || width === 1280) await page.screenshot({ path: resolve(artifacts, `workspace-${view}-${colorScheme}-${width}.png`), fullPage: true });
        }
        await page.locator('#open-settings').click();
        for (const category of ['connection','course','practice','controls','about']) {
          await page.locator('#setting-' + category).click();
          assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, category + '/' + width);
          if (width === 320 || width === 1280) await page.screenshot({ path: resolve(artifacts, `settings-${category}-${colorScheme}-${width}.png`), fullPage: true });
        }
        await page.locator('#close-settings').click();
      }
    });
  }

});

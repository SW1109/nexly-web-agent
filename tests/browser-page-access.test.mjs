import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, join, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const enabled = process.env.NEXLY_PAGE_BROWSER_TEST === '1' || process.env.NEXLY_BROWSER_TEST === '1';
const mainUrl = 'https://practice.example.test/exam/training';
const frameUrl = 'https://questions.example.test/practice/35';
const origins = ['https://practice.example.test/*', 'https://questions.example.test/*'];
const firstStem = '意图框架提供了HarmonyOS系统级的意图标准体系，通过多维系统感知、大模型等能力构建全局意图范式，实现对用户显式与潜在意图的理解。';
const nextStem = 'HarmonyOS应用可以通过声明式UI构建用户界面。';
// Structure verified against Huawei's public training bundle; question content is a local fixture.
const fixture = `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>HarmonyOS 认证考试模拟训练理论题练习</title>
<style>body{font-family:sans-serif}aside{float:left;width:180px}.exam-question{margin-left:200px}.question-box{padding:24px;background:#fff}.ant-radio-wrapper{display:block;padding:12px}.ant-radio-input{opacity:0}.old-question[hidden]{display:none}</style>
<header><h1>HarmonyOS 认证考试模拟训练理论题练习</h1><span>已答 2/35</span><button>交卷</button></header>
<aside><h2>判断题</h2><p>第1题</p><p>第2题</p><h2>单选题</h2><p>第6题</p><h2>多选题</h2><p>第21题</p></aside>
<div class="exam-question"><div class="tips">考试已开始，请认真答题。</div><div class="question-box"><div class="question-content">
<div class="crumb"><span>判断题</span> <span class="sort" id="question-number">第2/35题</span> <span class="auto-jump">自动跳下一题<nz-switch><button role="switch" aria-checked="false" aria-label="自动跳下一题"></button></nz-switch></span></div>
<div class="question-item-container"><app-exam-item><p id="practice-stem">${firstStem}</p><nz-radio-group>
<label class="ant-radio-wrapper"><span class="ant-radio"><input class="ant-radio-input" name="answer" type="radio" value="true"><span class="ant-radio-inner"></span></span><span>正确(True)</span></label>
<label class="ant-radio-wrapper ant-radio-wrapper-checked"><span class="ant-radio ant-radio-checked"><input class="ant-radio-input" name="answer" type="radio" value="false" checked><span class="ant-radio-inner"></span></span><span>错误(False)</span></label>
</nz-radio-group></app-exam-item></div><div class="exam-btn-group"><button>上一题</button><button id="next">下一题</button><button>存疑</button></div>
</div></div></div>
<section class="question-box old-question" hidden><p>编程题 第1/35题 旧题不应污染识别。</p><textarea data-code-editor>oldCode();</textarea></section>
<script>window.__nextQuestion=()=>{document.getElementById('question-number').textContent='第3/35题';document.getElementById('practice-stem').textContent=${JSON.stringify(nextStem)};document.querySelectorAll('input[name="answer"]').forEach(input=>input.checked=false);document.querySelectorAll('.ant-radio-wrapper-checked,.ant-radio-checked').forEach(element=>element.classList.remove('ant-radio-wrapper-checked','ant-radio-checked'))};document.getElementById('next').onclick=window.__nextQuestion;</script></html>`;

test('panel recovers missing tab URLs, requests site access from clicks and reads the rendered HarmonyOS practice', { skip: !enabled, timeout: 90000 }, async (t) => {
  const { chromium } = await import(process.env.NEXLY_PLAYWRIGHT_PATH || 'playwright');
  const source = fileURLToPath(new URL('../extension/', import.meta.url));
  const server = createServer(async (request, response) => {
    try {
      const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
      if (pathname === '/practice-fixture.html') { response.setHeader('Content-Type', 'text/html; charset=utf-8'); response.end(fixture); return; }
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

  async function openPanel(denied = false) {
    const context = await browser.newContext();
    const practice = await context.newPage();
    await practice.goto(origin + '/practice-fixture.html');
    await context.exposeBinding('__readPractice', async () => practice.evaluate(async () => {
      const { pageAction } = await import('./lib/page.js');
      return pageAction('read');
    }));
    await context.addInitScript(({ mainUrl, frameUrl, denied }) => {
      const noopEvent = () => ({ addListener() {} });
      const granted = new Set();
      const saved = { dataConsentVersion: 1, connectionMode: 'local' };
      let state = { phase: 'idle', busy: false, paused: false, question: null, answer: null, log: [], error: '', completed: 0 };
      const frames = [{ frameId: 0, parentFrameId: -1, url: mainUrl }, { frameId: 1, parentFrameId: 0, url: frameUrl }, { frameId: 2, parentFrameId: 0, url: 'about:blank' }];
      window.__events = [];
      window.__requests = [];
      window.__commands = [];
      window.__lastRead = null;
      window.chrome = {
        tabs: {
          async query() { return [{ id: 7, active: true, windowId: 1 }]; },
          async get(id) { return { id, active: true, windowId: 1 }; }
        },
        webNavigation: {
          async getFrame(details) { window.__events.push({ kind: 'getFrame', details }); return frames.find(frame => frame.frameId === details.frameId); },
          async getAllFrames(details) { window.__events.push({ kind: 'getAllFrames', details }); return frames; }
        },
        permissions: {
          async contains({ origins }) { return origins.every(origin => granted.has(origin)); },
          async request(request) {
            window.__requests.push(structuredClone(request));
            window.__events.push({ kind: 'permission', request: structuredClone(request) });
            if (denied) return false;
            for (const origin of request.origins || []) granted.add(origin);
            return true;
          }
        },
        runtime: {
          id: 'nmkgnejillemkmplbkcklhdcfkgefoce', onMessage: noopEvent(),
          async sendMessage(message) {
            window.__commands.push(structuredClone(message));
            window.__events.push({ kind: 'command', action: message.action });
            if (message.action === 'apiSettings') return { ok: true, data: { config: { baseUrl: '', protocol: 'auto', model: '', timeoutSeconds: 180 }, hasKey: false, rememberKey: false } };
            if (message.action === 'health') return { ok: true, data: { nodeVersion: 'v24.9.0', providers: [{ id: 'codex', installed: true, version: 'codex-cli fixture', configs: [] }] } };
            if (message.action === 'state') return { ok: true, data: structuredClone(state) };
            if (['read', 'start', 'enableControls'].includes(message.action)) {
              if (![mainUrl, frameUrl].every(url => granted.has(new URL(url).origin + '/*'))) throw new Error('Practice command dispatched before site permission was granted');
              const result = await window.__readPractice();
              window.__lastRead = result;
              if (!result.ok) return { ok: false, error: result.error };
              state = { ...state, phase: 'read', question: result.question, editor: result.editor, run: result.run, error: '' };
              return { ok: true, data: structuredClone(state) };
            }
            throw new Error('Unexpected command: ' + message.action);
          }
        },
        storage: { local: { async get() { return { ...saved }; }, async set(values) { Object.assign(saved, values); } }, onChanged: noopEvent() }
      };
    }, { mainUrl, frameUrl, denied });
    const panel = await context.newPage();
    const errors = [];
    panel.on('pageerror', error => errors.push(error.message));
    await panel.goto(origin + '/panel.html');
    await panel.waitForFunction(() => document.getElementById('connection-status').textContent === '本地桥已连接' && !document.getElementById('auto').disabled);
    assert.equal(await panel.evaluate(() => window.__requests.length), 0, 'opening the panel must not prompt for site access');
    assert.equal(await panel.evaluate(() => window.__commands.some(command => ['read', 'start', 'enableControls'].includes(command.action))), false, 'opening the panel must not read or act on the practice');
    return { context, panel, practice, errors };
  }

  for (const [button, action] of [['read', 'read'], ['permission', 'read'], ['auto', 'start'], ['page-controls', 'enableControls']]) {
    await t.test(`#${button} grants the main site and cross-origin practice frame before ${action}`, async () => {
      const { context, panel, practice, errors } = await openPanel();
      try {
        await panel.locator('#' + button).click();
        await panel.waitForFunction(() => window.__lastRead?.ok && !document.getElementById('question').hidden);
        const { requests, events, result, commands } = await panel.evaluate(() => ({ requests: window.__requests, events: window.__events, result: window.__lastRead, commands: window.__commands }));
        assert.deepEqual(requests, [{ origins }]);
        assert.ok(events.some(event => event.kind === 'getFrame' && event.details.tabId === 7 && event.details.frameId === 0), 'a missing tabs.query URL must recover from the top frame');
        assert.ok(events.findIndex(event => event.kind === 'permission') < events.findIndex(event => event.kind === 'command' && event.action === action), 'permission must be granted before the practice command');
        assert.equal(commands.filter(command => command.action === action).length, 1);
        assert.equal(result.question.type, 'judge');
        assert.equal(result.question.options.length, 2);
        assert.deepEqual(result.question.options.map(option => option.text), ['正确(True)', '错误(False)']);
        assert.match(result.question.stem, /第2\/35题/);
        assert.ok(result.question.stem.includes(firstStem));
        assert.doesNotMatch(result.question.stem, /旧题不应污染|第21题|单选题|多选题/);
        assert.equal(await panel.locator('#question-type').textContent(), '判断题');
        assert.equal(await panel.locator('#empty').isHidden(), true);
        assert.equal(await panel.locator('#error').isHidden(), true);
        assert.equal(await practice.locator('input[value="false"]').isChecked(), true, 'reading must preserve the user selection');
        if (button === 'read') {
          await practice.locator('#next').click();
          await panel.locator('#read').click();
          await panel.waitForFunction(previous => window.__lastRead?.question.questionId !== previous, result.question.questionId);
          const next = await panel.evaluate(() => window.__lastRead);
          assert.equal(next.question.type, 'judge');
          assert.equal(next.question.options.length, 2);
          assert.ok(next.question.stem.includes(nextStem));
          assert.ok(!next.question.stem.includes(firstStem));
          assert.match(next.question.stem, /第3\/35题/);
          assert.equal(await panel.evaluate(() => window.__requests.length), 1, 'already granted sites must not prompt on each question');
          assert.equal(await practice.locator('input[name="answer"]:checked').count(), 0, 'changing questions must not reuse an old answer');
        }
        assert.deepEqual(errors, []);
      } finally { await context.close(); }
    });

    await t.test(`#${button} denied site access does not dispatch ${action}`, async () => {
      const { context, panel, errors } = await openPanel(true);
      try {
        await panel.locator('#' + button).click();
        await panel.locator('#error').waitFor({ state: 'visible' });
        assert.match(await panel.locator('#error').textContent(), /权限|授权/);
        assert.deepEqual(await panel.evaluate(() => window.__requests), [{ origins }]);
        assert.deepEqual(await panel.evaluate(() => window.__commands.filter(command => ['read', 'start', 'enableControls'].includes(command.action))), [], 'denial must stop before any practice command');
        assert.equal(await panel.locator('#question').isHidden(), true);
        assert.deepEqual(errors, []);
      } finally { await context.close(); }
    });
  }
});

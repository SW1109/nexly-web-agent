import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';

const enabled = process.env.NEXLY_PANEL_BROWSER_TEST === '1' || process.env.NEXLY_BROWSER_TEST === '1';
const fixture = `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>In-page control regression</title><body><p>练习页面</p>
<script type="module">
import {installPageControls} from '/page-controls.js';
const attachShadow = Element.prototype.attachShadow;
// Test instrumentation keeps a reference without changing the production mode.
Element.prototype.attachShadow = function(options) { const root=attachShadow.call(this,options);window.__testRoot=root;return root; };
window.__commands=[];window.__modes={};window.__pending={};
const stateListeners=[];
window.__emitPageState=state=>{for(const listener of stateListeners)listener({type:'page-state',state})};
window.chrome={runtime:{getURL:()=>'/icon.svg',onMessage:{addListener(listener){stateListeners.push(listener)},removeListener(){}},sendMessage(message){
  window.__commands.push(message);
  if(window.__modes[message.action]==='sync-context')throw new Error('Extension context invalidated.');
  if(window.__modes[message.action]==='context')return Promise.reject(new Error('Extension context invalidated.'));
  if(window.__modes[message.action]==='pending')return new Promise(resolve=>{window.__pending[message.action]=resolve});
  return Promise.resolve({ok:true,data:message.action==='openPanel'?{opened:true}:{phase:message.action==='stop'?'stopped':'solving',busy:message.action!=='stop'}});
}}};
installPageControls({phase:'idle',busy:false});
Element.prototype.attachShadow=attachShadow;
</script></body></html>`;

test('in-page controls use trusted actions, preserve recovery errors and stop pending operations', { skip: !enabled, timeout: 60000 }, async (t) => {
  const { chromium } = await import(process.env.NEXLY_PLAYWRIGHT_PATH || 'playwright');
  const source = new URL('../extension/lib/page-controls.js', import.meta.url);
  const server = createServer(async (request, response) => {
    try {
      if (request.url === '/page-controls.js') {
        response.setHeader('Content-Type', 'text/javascript; charset=utf-8'); response.end(await readFile(source));
      } else if (request.url === '/icon.svg') {
        response.setHeader('Content-Type', 'image/svg+xml'); response.end('<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><rect width="32" height="32" fill="blue"/></svg>');
      } else { response.setHeader('Content-Type', 'text/html; charset=utf-8'); response.end(fixture); }
    } catch { response.writeHead(500).end(); }
  });
  await new Promise(done => server.listen(0, '127.0.0.1', done));
  t.after(async () => { server.closeAllConnections(); await new Promise(done => server.close(done)); });
  const browser = await chromium.launch({ headless: true, ...(process.env.NEXLY_CHROME_PATH ? { executablePath: process.env.NEXLY_CHROME_PATH } : {}) });
  t.after(() => browser.close());
  const page = await browser.newPage({ viewport: { width: 400, height: 700 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(`http://127.0.0.1:${server.address().port}/`);
  await page.waitForFunction(() => window.__nexlyPageControls?.revision === 5);
  const status = () => page.evaluate(() => window.__testRoot.querySelector('.status').textContent);
  const buttons = () => page.evaluate(() => Object.fromEntries([...window.__testRoot.querySelectorAll('button')].map(button => [button.textContent, button.disabled])));
  async function hoverLauncher() {
    const point = await page.evaluate(() => { const rect=window.__testRoot.querySelector('.launcher').getBoundingClientRect();return {x:rect.x+rect.width/2,y:rect.y+rect.height/2}; });
    await page.mouse.move(point.x, point.y);
    await page.waitForFunction(() => window.__testRoot.querySelector('.launcher').getAttribute('aria-expanded') === 'true');
  }
  async function click(text) {
    await hoverLauncher();
    const point = await page.evaluate(label => { const button=[...window.__testRoot.querySelectorAll('button')].find(node=>node.textContent===label);const rect=button.getBoundingClientRect();return {x:rect.x+rect.width/2,y:rect.y+rect.height/2}; }, text);
    await page.mouse.click(point.x, point.y);
  }

  await t.test('closed Shadow DOM is retained and synthetic clicks never dispatch commands', async () => {
    const boundary = await page.evaluate(() => ({ mode: window.__testRoot.mode, exposed: document.querySelector('[data-nexly-controls]').shadowRoot !== null }));
    assert.deepEqual(boundary, { mode: 'closed', exposed: false });
    await hoverLauncher();
    await page.evaluate(() => { for (const button of window.__testRoot.querySelectorAll('button')) button.click(); });
    assert.deepEqual(await page.evaluate(() => window.__commands), []);
  });

  await t.test('stopping a pending start prevents its late failure from replacing the stopped status', async () => {
    await page.evaluate(() => { window.__modes.start='pending';window.__modes.stop='pending'; });
    await click('开始');
    assert.equal(await status(), '正在启动练习…');
    assert.equal((await buttons())['停止'], false);
    await click('停止');
    assert.equal(await status(), '正在停止…');
    await page.evaluate(() => window.__pending.stop({ok:true,data:{phase:'stopped',busy:false}}));
    await page.waitForFunction(() => window.__testRoot.querySelector('.status').textContent === '任务已停止');
    await page.evaluate(() => window.__pending.start({ok:false,error:'旧请求失败'}));
    assert.equal(await status(), '任务已停止');
    assert.deepEqual(await page.evaluate(() => window.__commands.map(message=>message.action)), ['start', 'stop']);
  });

  await t.test('a read operation disables pause while stop and the sidebar remain usable', async () => {
    await page.evaluate(() => { window.__modes.stop='';window.__modes.openPanel='pending';window.__nexlyPageControls.paint({phase:'reading',busy:true,operation:'read'}); });
    const state = await buttons();
    assert.equal(state['开始'], true);
    assert.equal(state['暂停'], true);
    assert.equal(state['停止'], false);
    assert.equal(state['打开侧栏'], false);
    await click('打开侧栏');
    assert.equal((await buttons())['正在打开…'], true);
    await page.evaluate(() => window.__pending.openPanel({ok:true,data:{opened:true}}));
    await page.waitForFunction(() => [...window.__testRoot.querySelectorAll('button')].some(button=>button.textContent==='打开侧栏'&&!button.disabled));
    assert.equal(await status(), '读取题目中');
    assert.equal(await page.evaluate(() => window.__commands.filter(message=>message.action==='start').length), 1, 'opening the sidebar must not start another model request');
    await click('停止');
    await page.waitForFunction(() => window.__testRoot.querySelector('.status').textContent === '任务已停止');
  });

  await t.test('invalidated extension errors remain actionable after paint and opening the sidebar', async () => {
    await page.evaluate(() => { window.__modes.start='context';window.__modes.openPanel='';window.__nexlyPageControls.paint({phase:'idle',busy:false}); });
    await click('开始');
    await page.waitForFunction(() => window.__testRoot.querySelector('.status').textContent.includes('请刷新当前练习页'));
    assert.equal((await buttons())['打开侧栏'], false);
    await page.evaluate(() => window.__nexlyPageControls.paint({phase:'idle',busy:false}));
    await click('打开侧栏');
    assert.match(await status(), /请刷新当前练习页/);
    for (const width of [320, 400]) {
      await page.setViewportSize({ width, height: 700 });
      await hoverLauncher();
      const rect = await page.evaluate(() => { const {left,right}=window.__testRoot.querySelector('.popover').getBoundingClientRect();return {left,right,width:innerWidth}; });
      assert.ok(rect.left >= 0 && rect.right <= rect.width, `${width}px control overflow`);
    }
  });
  await t.test('automatic page synchronization also handles synchronous invalidation without uncaught errors', async () => {
    await page.evaluate(() => { window.__modes.pageChanged='sync-context';const paragraph=document.createElement('p');paragraph.textContent='页面题目发生变化';document.body.append(paragraph); });
    await page.waitForFunction(() => window.__commands.some(message=>message.action==='pageChanged'));
    assert.match(await status(), /请刷新当前练习页/);
  });
  await t.test('actual sidebar task or successful reading clears an old local connection error', async () => {
    await page.evaluate(() => window.__emitPageState({phase:'idle',busy:false}));
    assert.match(await status(), /请刷新当前练习页/, 'an unchanged idle state is not evidence of recovery');
    await click('打开侧栏');
    assert.match(await status(), /请刷新当前练习页/, 'opening the sidebar alone does not recover the connection');
    await page.evaluate(() => window.__emitPageState({phase:'solving',busy:true,elapsedSeconds:9}));
    assert.equal(await status(), '模型求解中 · 9 秒', 'a new task from the sidebar replaces the old local error');
    await page.evaluate(() => { window.__emitPageState({phase:'idle',busy:false});window.__modes.start='context'; });
    await click('开始');
    await page.waitForFunction(() => window.__testRoot.querySelector('.status').textContent.includes('请刷新当前练习页'));
    await page.evaluate(() => window.__emitPageState({phase:'read',busy:false,questionTitle:'已重新读取当前练习'}));
    assert.equal(await status(), '题目已读取', 'successful reading is also evidence of recovery');
  });
  await t.test('external terminal transitions invalidate pending starts while same-terminal publications do not', async () => {
    for (const [phase, label] of [['stopped','任务已停止'],['interrupted','任务已中断']]) {
      await page.evaluate(() => { window.__emitPageState({phase:'idle',busy:false});window.__modes.start='pending'; });
      await click('开始');
      assert.equal(await status(), '正在启动练习…');
      await page.evaluate(value => window.__emitPageState({phase:value,busy:false}), phase);
      assert.equal(await status(), label);
      await page.evaluate(() => window.__pending.start({ok:false,error:'旧启动请求失败，不应覆盖外部停止'}));
      assert.equal(await status(), label);
      assert.equal((await buttons())['开始'], false);
    }
    // A controls-binding publication can retain an old terminal phase during preflight.
    await page.evaluate(() => window.__emitPageState({phase:'stopped',busy:false}));
    await click('开始');
    await page.evaluate(() => window.__emitPageState({phase:'stopped',busy:false}));
    assert.equal(await status(), '正在启动练习…');
    await page.evaluate(() => window.__pending.start({ok:true,data:{phase:'solving',busy:true}}));
    await page.waitForFunction(() => window.__testRoot.querySelector('.status').textContent === '模型求解中');
  });
  assert.deepEqual(errors, []);
});

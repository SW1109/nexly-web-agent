import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';

const enabled = process.env.NEXLY_PANEL_BROWSER_TEST === '1' || process.env.NEXLY_BROWSER_TEST === '1';
const fixture = `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>Task log regression</title>
<style>
*{box-sizing:border-box}body{font:14px/1.7 sans-serif;width:320px;margin:20px}button{min-height:36px}
[hidden]{display:none!important}#log{height:220px;width:280px;overflow-y:scroll;overflow-x:hidden;padding:0 6px 0 0;margin:12px 0;list-style:none;scrollbar-gutter:stable}
#log li{display:grid;grid-template-columns:56px 1fr;gap:10px;padding:8px 10px;margin-bottom:4px;overflow-wrap:anywhere}time{font:10px/1.65 monospace}
</style><p>任务记录 <span id="count">0</span></p><button id="jump" hidden>回到最新</button><ul id="log" tabindex="0"></ul>
<script type="module">import {createTaskLog} from '/panel-log.js';window.renderLog=createTaskLog({list:document.getElementById('log'),count:document.getElementById('count'),jump:document.getElementById('jump')});</script></html>`;

test('task log follows the latest records without interrupting older variable-height rows', { skip: !enabled, timeout: 60000 }, async (t) => {
  const { chromium } = await import(process.env.NEXLY_PLAYWRIGHT_PATH || 'playwright');
  const source = new URL('../extension/lib/panel-log.js', import.meta.url);
  const server = createServer(async (request, response) => {
    try {
      if (request.url === '/panel-log.js') {
        response.setHeader('Content-Type', 'text/javascript; charset=utf-8');
        response.end(await readFile(source));
      } else {
        response.setHeader('Content-Type', 'text/html; charset=utf-8');
        response.end(fixture);
      }
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
  await page.waitForFunction(() => typeof window.renderLog === 'function');
  const base = Date.UTC(2026, 9, 17);
  let entries = Array.from({ length: 60 }, (_, i) => ({ time: base + i, text: `记录 ${i}：${'题目已读取，正在核对选项。'.repeat(i % 4 + 1)}` }));
  const render = async () => page.evaluate(value => window.renderLog(value), entries);
  const visible = () => page.evaluate(() => {
    const list = document.getElementById('log'), top = list.getBoundingClientRect().top + list.clientTop;
    const node = [...list.children].find(row => row.getBoundingClientRect().bottom > top);
    return { text: node.lastElementChild.textContent, offset: node.getBoundingClientRect().top - top, scroll: list.scrollTop };
  });

  await t.test('initial ordering and top-follow use real variable row heights', async () => {
    await render();
    assert.equal(await page.locator('#count').textContent(), '60');
    assert.equal(await page.locator('#log li').first().locator('span').textContent(), entries.at(-1).text);
    assert.equal(await page.locator('#jump').isHidden(), true);
    const heights = await page.locator('#log li').evaluateAll(rows => [...new Set(rows.map(row => row.getBoundingClientRect().height))]);
    assert.ok(heights.length > 1, 'regression must exercise actual wrapping and variable heights');
    entries = [...entries.slice(1), { time: base + 60, text: '新记录：' + '追加时保持最新。'.repeat(8) }];
    await render();
    assert.equal(await page.locator('#log').evaluate(list => list.scrollTop), 0);
    assert.equal(await page.locator('#log li').first().locator('span').textContent(), entries.at(-1).text);
  });

  await t.test('new records and oldest-record eviction retain the visible row and offset', async () => {
    await page.locator('#log').evaluate(list => { list.scrollTop = list.scrollHeight * 0.45 + 13; });
    await page.waitForFunction(() => !document.getElementById('jump').hidden);
    const before = await visible();
    entries = [...entries.slice(3), ...Array.from({ length: 3 }, (_, i) => ({ time: base + 61 + i, text: `新增 ${i}：${'不同长度的新日志。'.repeat(i * 3 + 2)}` }))];
    await render();
    const after = await visible();
    assert.equal(after.text, before.text);
    assert.ok(Math.abs(after.offset - before.offset) <= 1, `visible row moved ${after.offset - before.offset}px`);
    assert.ok(after.scroll > before.scroll, 'new rows must be compensated by scroll position');
    assert.equal(await page.locator('#jump').isVisible(), true);
    assert.equal(await page.locator('#log li').count(), 60);
  });

  await t.test('unchanged publications do not redraw or move the user', async () => {
    await page.evaluate(() => { window.__firstRow = document.querySelector('#log li'); window.__mutations = 0; window.__observer = new MutationObserver(records => { window.__mutations += records.length; }); window.__observer.observe(document.getElementById('log'), { childList: true, subtree: true }); });
    const before = await visible();
    await render();
    const after = await visible();
    const state = await page.evaluate(() => ({ sameNode: window.__firstRow === document.querySelector('#log li'), mutations: window.__mutations }));
    assert.deepEqual(state, { sameNode: true, mutations: 0 });
    assert.deepEqual(after, before);
    await page.evaluate(() => window.__observer.disconnect());
  });

  await t.test('clicking latest and manually scrolling back to the top hide the entry', async () => {
    await page.locator('#jump').click();
    assert.equal(await page.locator('#log').evaluate(list => list.scrollTop), 0);
    assert.equal(await page.locator('#jump').isHidden(), true);
    await page.locator('#log').evaluate(list => { list.scrollTop = 300; });
    await page.waitForFunction(() => !document.getElementById('jump').hidden);
    await page.locator('#log').evaluate(list => { list.scrollTop = 0; });
    await page.waitForFunction(() => document.getElementById('jump').hidden);
  });

  await t.test('same-millisecond messages show later writes first and render literal text', async () => {
    entries = [{ time: base + 100, text: '先写入' }, { time: base + 100, text: '后写入 <img src=x onerror="window.__injected=true">' }];
    await render();
    assert.deepEqual(await page.locator('#log li span').allTextContents(), [entries[1].text, entries[0].text]);
    assert.equal(await page.locator('#log img').count(), 0);
    assert.equal(await page.evaluate(() => Boolean(window.__injected)), false);
  });

  await t.test('bottom eviction keeps the closest history within the remaining scroll range', async () => {
    entries = Array.from({ length: 60 }, (_, i) => ({ time: base + 200 + i, text: `短记录 ${i}` }));
    await render();
    await page.locator('#log').evaluate(list => { list.scrollTop = list.scrollHeight; });
    const retainedText = entries[4].text;
    const retainedRow = () => page.locator('#log li').filter({ has: page.getByText(retainedText, { exact: true }) });
    assert.equal(await retainedRow().isVisible(), true);
    entries = [...entries.slice(2), { time: base + 260, text: '新的末尾记录 A' }, { time: base + 261, text: '新的末尾记录 B' }];
    await render();
    const after = await retainedRow().evaluate(row => {
      const list = document.getElementById('log'), viewport = list.getBoundingClientRect(), rect = row.getBoundingClientRect();
      return { visible: rect.bottom > viewport.top && rect.top < viewport.bottom, top: list.scrollTop, max: list.scrollHeight - list.clientHeight };
    });
    assert.equal(after.visible, true, 'surviving history stays in view');
    assert.ok(after.max - after.top <= 1, 'bottom eviction clamps at the available history rather than returning to latest');
  });

  await t.test('evicting the entire viewport keeps the nearest retained history instead of jumping to latest', async () => {
    await page.locator('#log').evaluate(list => { list.scrollTop = list.scrollHeight; });
    entries = [...entries.slice(10), ...Array.from({ length: 10 }, (_, i) => ({ time: base + 300 + i, text: `补充记录 ${i}` }))];
    await render();
    const position = await page.locator('#log').evaluate(list => ({ top: list.scrollTop, max: list.scrollHeight - list.clientHeight }));
    assert.ok(position.top > 0);
    assert.ok(position.max - position.top <= 1, 'removed history falls back to the closest surviving bottom rows');
    assert.equal(await page.locator('#jump').isVisible(), true);
  });

  await t.test('clearing the records resets count, position and latest entry', async () => {
    entries = [];
    await render();
    assert.equal(await page.locator('#count').textContent(), '0');
    assert.equal(await page.locator('#log li').count(), 0);
    assert.equal(await page.locator('#log').evaluate(list => list.scrollTop), 0);
    assert.equal(await page.locator('#jump').isHidden(), true);
  });
  assert.deepEqual(errors, []);
});

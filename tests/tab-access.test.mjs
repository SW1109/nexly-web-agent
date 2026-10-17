import test from 'node:test';
import assert from 'node:assert/strict';
import { activePracticeTab, ensurePracticeAccess } from '../extension/lib/tab-access.js';

function browserMock({ tab = { id: 42, windowId: 7, url: 'https://practice.example.test/exam?question=2' }, frame, frames = [], permitted = false, granted = true, frameError = false } = {}) {
  const calls = { query: [], getFrame: [], getAllFrames: [], contains: [], request: [] };
  return {
    calls,
    chrome: {
      tabs: { query: async (query) => { calls.query.push(query); return tab ? [tab] : []; } },
      webNavigation: {
        getFrame: async (details) => {
          calls.getFrame.push(details);
          if (frameError) throw new Error('Frame lookup unavailable');
          return frame || null;
        },
        getAllFrames: async (details) => { calls.getAllFrames.push(details); return frames; }
      },
      permissions: {
        contains: async (details) => { calls.contains.push(details); return permitted; },
        request: async (details) => { calls.request.push(details); return granted; }
      }
    }
  };
}

async function withBrowser(options, run) {
  const previous = globalThis.chrome;
  const browser = browserMock(options);
  globalThis.chrome = browser.chrome;
  try { await run(browser.calls); }
  finally {
    if (previous === undefined) delete globalThis.chrome;
    else globalThis.chrome = previous;
  }
}

test('an active exercise tab keeps its identity and visible HTTP URL', async () => {
  await withBrowser({}, async (calls) => {
    const tab = await activePracticeTab();
    assert.equal(tab.id, 42);
    assert.equal(tab.windowId, 7);
    assert.equal(tab.url, 'https://practice.example.test/exam?question=2');
    assert.deepEqual(calls.query, [{ active: true, currentWindow: true }]);
    assert.equal(calls.request.length, 0);
  });
});

test('a tab with a hidden URL resolves its main frame before exercise extraction', async () => {
  await withBrowser({ tab: { id: 42, windowId: 7 }, frame: { url: 'https://practice.example.test/exam' } }, async (calls) => {
    const tab = await activePracticeTab();
    assert.equal(tab.id, 42);
    assert.equal(tab.windowId, 7);
    assert.equal(tab.url, 'https://practice.example.test/exam');
    assert.deepEqual(calls.getFrame, [{ tabId: 42, frameId: 0 }]);
    assert.equal(calls.request.length, 0);
  });
});

test('main frame fallback uses frameId zero even when a child frame is listed first', async () => {
  await withBrowser({
    tab: { id: 42 }, frameError: true,
    frames: [
      { frameId: 8, parentFrameId: 0, url: 'https://embedded.example.test/question' },
      { frameId: 0, parentFrameId: -1, url: 'https://practice.example.test/exam' }
    ]
  }, async () => {
    const tab = await activePracticeTab();
    assert.equal(tab.url, 'https://practice.example.test/exam');
  });
});

test('missing main frame metadata never borrows a child frame URL', async () => {
  await withBrowser({
    tab: { id: 42 },
    frames: [{ frameId: 8, parentFrameId: 0, url: 'https://embedded.example.test/question' }]
  }, async (calls) => {
    await assert.rejects(activePracticeTab(), /当前|练习|网页/);
    assert.equal(calls.request.length, 0);
  });
});

test('unavailable tab and frame URLs report a recoverable page address error', async () => {
  await withBrowser({ tab: { id: 42 }, frames: [{ frameId: 0, parentFrameId: -1 }] }, async (calls) => {
    await assert.rejects(activePracticeTab(), /地址|网址|URL/i);
    assert.equal(calls.request.length, 0);
  });
});

test('known browser pages are rejected without replacing them with an embedded HTTP URL', async () => {
  for (const url of ['edge://extensions/', 'chrome://newtab/', 'chrome-extension://test/panel.html', 'file:///C:/exam.html', 'about:blank']) {
    await withBrowser({ tab: { id: 42, url }, frame: { url: 'https://embedded.example.test/question' } }, async (calls) => {
      await assert.rejects(activePracticeTab(), /网页|练习/);
      assert.equal(calls.getFrame.length, 0, url);
      assert.equal(calls.getAllFrames.length, 0, url);
      assert.equal(calls.request.length, 0, url);
    });
  }
});

test('no selected tab gives an actionable exercise-page error', async () => {
  await withBrowser({ tab: null }, async (calls) => {
    await assert.rejects(activePracticeTab(), /网页|练习/);
    assert.equal(calls.request.length, 0);
  });
});

const exerciseFrames = [
  { frameId: 5, parentFrameId: 0, url: 'https://questions.example.test/question/2' },
  { frameId: 0, parentFrameId: -1, url: 'https://practice.example.test/exam' },
  { frameId: 6, parentFrameId: 0, url: 'https://questions.example.test/assets' },
  { frameId: 7, parentFrameId: 0, url: 'about:blank' },
  { frameId: 8, parentFrameId: 0, url: 'data:text/html,embedded' }
];
const exerciseOrigins = ['https://practice.example.test/*', 'https://questions.example.test/*'];
const sortedOrigins = (details) => [...details.origins].sort();

test('existing site access reads the exercise without another permission request', async () => {
  await withBrowser({ frames: exerciseFrames, permitted: true }, async (calls) => {
    const tab = await ensurePracticeAccess();
    assert.equal(tab.id, 42);
    assert.equal(tab.url, 'https://practice.example.test/exam?question=2');
    assert.equal(calls.contains.length, 1);
    assert.deepEqual(sortedOrigins(calls.contains[0]), exerciseOrigins);
    assert.equal(calls.request.length, 0);
  });
});

test('new installation can grant exact exercise and embedded-site origins when tab.url is hidden', async () => {
  await withBrowser({ tab: { id: 42 }, frame: { url: 'https://practice.example.test/exam' }, frames: exerciseFrames }, async (calls) => {
    const tab = await ensurePracticeAccess();
    assert.equal(tab.id, 42);
    assert.equal(tab.url, 'https://practice.example.test/exam');
    assert.equal(calls.request.length, 1);
    assert.deepEqual(sortedOrigins(calls.request[0]), exerciseOrigins);
    assert.ok(!calls.request[0].origins.some((origin) => origin === '<all_urls>' || origin === 'http://*/*' || origin === 'https://*/*'));
  });
});

test('declining site access reports the permission failure and keeps the exercise URL intact', async () => {
  await withBrowser({ frames: exerciseFrames, granted: false }, async (calls) => {
    await assert.rejects(ensurePracticeAccess(), /未获得站点权限/);
    assert.equal(calls.request.length, 1);
    assert.deepEqual(sortedOrigins(calls.request[0]), exerciseOrigins);
  });
});

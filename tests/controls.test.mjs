import test from 'node:test';
import assert from 'node:assert/strict';
import { single } from './data.mjs';

// 只覆盖“打开练习页自动启用页内组件”这条链路：加载事件 -> 读取题目 -> 注入 ISOLATED 悬浮组件。
const event = () => { const callbacks = []; return { addListener(fn) { callbacks.push(fn); }, emit(...args) { for (const fn of callbacks) fn(...args); } }; };
const until = async (predicate) => { for (let i = 0; i < 400; i++) { if (predicate()) return; await new Promise((resolve) => setTimeout(resolve, 10)); } throw new Error('State transition timed out'); };

const isolatedFunctions = [];
let localSettings = {};
const storageChanged = event(), navigated = event();
const question = { ...single, options: [{ id: 'option-0', label: 'A', text: '3' }, { id: 'option-1', label: 'B', text: '4' }] };

globalThis.chrome = {
  storage: {
    onChanged: storageChanged,
    local: { set: async (patch) => { Object.assign(localSettings, patch); }, get: async () => ({ ...localSettings }) },
    session: { get: async () => ({}), set: async () => {} }
  },
  runtime: { id: 'test', getURL: (path) => `chrome-extension://test/${path}`, onMessage: event(), sendMessage: async () => {}, connectNative: () => ({ onMessage: event(), onDisconnect: event(), postMessage() {} }) },
  tabs: {
    query: async () => [{ id: 1, url: question.pageUrl }],
    get: async (id) => ({ id, windowId: 1, active: true, url: question.pageUrl }),
    onActivated: event(),
    sendMessage: async () => {}
  },
  windows: { get: async () => ({ focused: true }), onFocusChanged: event() },
  commands: { onCommand: event() },
  webNavigation: {
    onCompleted: navigated,
    getAllFrames: async () => [{ frameId: 0, parentFrameId: -1, url: question.pageUrl }]
  },
  sidePanel: { setPanelBehavior: async () => {} },
  permissions: { contains: async () => true, request: async () => true },
  scripting: { executeScript: async ({ world, func, target }) => {
    if (world === 'ISOLATED') {
      isolatedFunctions.push({ name: func?.name, tabId: target.tabId, remove: func?.name === 'removePageControls' });
      return [{ documentId: 'doc-1', result: { ok: true } }];
    }
    return [{ frameId: 0, documentId: 'doc-1', result: { ok: true, question: structuredClone(question), editor: { kind: '', supported: true, error: '', retryable: false, binding: null }, run: { available: false, reason: 'not-code', label: '', count: 0, disabled: false }, visible: true, frame: { shown: true, url: question.pageUrl, children: [] } } }];
  } }
};

await import('../extension/background.js');

test('opening an exercise page installs the in-page controls without opening the side panel', async () => {
  const before = isolatedFunctions.length;
  navigated.emit({ tabId: 1, frameId: 0 });
  await until(() => isolatedFunctions.length > before);
  const installed = isolatedFunctions.at(-1);
  assert.equal(installed.name, 'installPageControls');
  assert.equal(installed.tabId, 1);
});

test('auto-controls can be switched off and removes already injected controls', async () => {
  localSettings = { ...localSettings, autoControls: false };
  const before = isolatedFunctions.length;
  navigated.emit({ tabId: 2, frameId: 0 });
  await new Promise((resolve) => setTimeout(resolve, 120));
  assert.equal(isolatedFunctions.length, before, '关闭后新打开的练习页不再自动注入');

  storageChanged.emit({ autoControls: { newValue: false } }, 'local');
  await until(() => isolatedFunctions.some((entry) => entry.remove));
  assert.equal(isolatedFunctions.at(-1).name, 'removePageControls');
});

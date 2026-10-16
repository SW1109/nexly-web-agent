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
    local: { setAccessLevel: async () => {}, set: async (patch) => { Object.assign(localSettings, patch); }, get: async () => ({ ...localSettings }) },
    session: { setAccessLevel: async () => {}, get: async () => ({}), set: async () => {} }
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
  scripting: { executeScript: async ({ world, func, args, target }) => {
    if (world === 'ISOLATED') {
      isolatedFunctions.push({ name: func?.name, tabId: target.tabId, args, remove: func?.name === 'removePageControls' });
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
  assert.equal(installed.args[0].phase, 'read');
  assert.equal(installed.args[0].elapsedSeconds, 0);
  assert.equal(installed.args[0].connectionMode, 'local');
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

test('installPageControls renders QuizMate brand, model solving phase, and elapsed seconds', async () => {
  const { installPageControls, removePageControls } = await import('../extension/lib/page-controls.js');

  class MockNode {
    constructor(tag = 'div') {
      this.tagName = tag.toUpperCase();
      this.children = [];
      this.attrs = {};
      this.style = { setProperty() {}, left: '', top: '' };
      this._classes = new Set();
      this.classList = {
        add: (c) => this._classes.add(c),
        remove: (c) => this._classes.delete(c),
        toggle: (c, v) => (v ? this._classes.add(c) : this._classes.delete(c))
      };
      this.dataset = {};
      this.isConnected = true;
      this._text = '';
      this.offsetWidth = 200;
      this.offsetHeight = 100;
    }
    get className() { return [...this._classes].join(' '); }
    set className(v) { this._classes = new Set((v || '').split(/\s+/).filter(Boolean)); }
    get textContent() { return this._text; }
    set textContent(v) { this._text = String(v ?? ''); }
    setAttribute(k, v) { this.attrs[k] = String(v); }
    getAttribute(k) { return this.attrs[k] || null; }
    append(...nodes) { this.children.push(...nodes); }
    remove() { this.isConnected = false; }
    attachShadow() {
      this.shadow = new MockNode('shadow');
      return this.shadow;
    }
    addEventListener() {}
    removeEventListener() {}
    matches() { return false; }
  }

  const created = [];
  globalThis.document = {
    querySelector() { return null; },
    createElement(tag) {
      const node = new MockNode(tag);
      created.push(node);
      return node;
    },
    documentElement: new MockNode('html'),
    addEventListener() {},
    removeEventListener() {}
  };
  globalThis.window = {
    addEventListener() {},
    removeEventListener() {}
  };
  globalThis.innerWidth = 1200;
  globalThis.innerHeight = 800;
  globalThis.MutationObserver = class {
    observe() {}
    disconnect() {}
  };

  const res = installPageControls({ phase: 'idle', busy: false });
  assert.equal(res.ok, true);
  assert.equal(globalThis.__nexlyPageControls.revision, 4);

  const titleNode = created.find((n) => n.tagName === 'STRONG');
  assert.equal(titleNode?.textContent, 'QuizMate');

  const launcher = created.find((n) => n.attrs['aria-controls'] === 'quizmate-popover');
  assert.ok(launcher, '应生成带有 quizmate-popover 控制目标的启动图标');
  assert.equal(launcher.getAttribute('aria-label'), 'QuizMate 页内控制：准备就绪。悬浮展开，拖动移动');

  const statusNode = created.find((n) => n.attrs.role === 'status');
  assert.equal(statusNode?.textContent, '准备就绪');

  // 更新为 solving 状态并携带耗时
  globalThis.__nexlyPageControls.paint({ phase: 'solving', busy: true, elapsedSeconds: 9 });
  assert.equal(statusNode?.textContent, '模型求解中 · 9 秒');
  assert.equal(launcher.getAttribute('aria-label'), 'QuizMate 页内控制：模型求解中。悬浮展开，拖动移动');

  const removal = removePageControls();
  assert.equal(removal.removed, true);
  assert.equal(globalThis.__nexlyPageControls, null);
});

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

test('installPageControls renders task feedback and keeps recovery controls available', async () => {
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
      this.listeners = new Map();
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
    addEventListener(type, fn) { if (!this.listeners.has(type)) this.listeners.set(type, []); this.listeners.get(type).push(fn); }
    emit(type, event = {}) { for (const fn of this.listeners.get(type) || []) fn(event); }
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
  assert.equal(globalThis.__nexlyPageControls.revision, 5);

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

  const start = created.find(node => node.tagName === 'BUTTON' && node.textContent === '开始');
  const pause = created.find(node => node.tagName === 'BUTTON' && node.textContent === '暂停');
  const stop = created.find(node => node.tagName === 'BUTTON' && node.textContent === '停止');
  const openPanel = created.find(node => node.tagName === 'BUTTON' && node.textContent === '打开侧栏');
  assert.ok(openPanel, '错误恢复入口应始终可见');
  globalThis.__nexlyPageControls.paint({ phase: 'reading', operation: 'read', busy: true });
  assert.equal(start.disabled, true);
  assert.equal(pause.disabled, true, '一次性读取不能暂停');
  assert.equal(stop.disabled, false, '一次性读取可以停止');
  assert.equal(openPanel.disabled, false, '运行期间仍可打开侧栏');

  const sent = [];
  let resolveStart;
  const originalSend = chrome.runtime.sendMessage;
  chrome.runtime.sendMessage = (message) => {
    sent.push(message);
    if (message.action === 'start') return new Promise(resolve => { resolveStart = resolve; });
    return Promise.resolve({ ok: true, data: { phase: 'stopped', busy: false } });
  };
  globalThis.__nexlyPageControls.paint({ phase: 'idle', busy: false });
  start.emit('click', { isTrusted: false });
  openPanel.emit('click', { isTrusted: false });
  assert.equal(sent.length, 0, '合成点击不能启动求解或打开侧栏');
  start.emit('click', { isTrusted: true });
  assert.equal(statusNode.textContent, '正在启动练习…');
  assert.equal(start.disabled, true);
  assert.equal(stop.disabled, false, '停止可取消仍在等待响应的启动请求');
  stop.emit('click', { isTrusted: true });
  assert.equal(statusNode.textContent, '正在停止…');
  await until(() => statusNode.textContent === '任务已停止');
  resolveStart({ ok: false, error: '旧启动请求失败，不应覆盖停止状态' });
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(statusNode.textContent, '任务已停止');
  assert.deepEqual(sent.map(message => message.action), ['start', 'stop']);

  chrome.runtime.sendMessage = async (message) => {
    sent.push(message);
    if (message.action === 'openPanel') return { ok: true, data: { opened: true } };
    throw new Error('Extension context invalidated.');
  };
  start.emit('click', { isTrusted: true });
  await until(() => statusNode.textContent.includes('请刷新当前练习页'));
  assert.equal(start.disabled, false, '失败后按钮恢复，允许用户明确重试');
  assert.equal(openPanel.disabled, false);
  globalThis.__nexlyPageControls.paint({ phase: 'idle', busy: false });
  assert.match(statusNode.textContent, /请刷新当前练习页/, '普通状态更新不应抹掉当前连接错误');
  openPanel.emit('click', { isTrusted: true });
  assert.equal(openPanel.textContent, '正在打开…');
  await until(() => openPanel.textContent === '打开侧栏');
  assert.match(statusNode.textContent, /请刷新当前练习页/, '打开侧栏成功不应把未恢复的错误清掉');
  assert.equal(sent.at(-1).action, 'openPanel');
  assert.equal(sent.at(-1).source, 'page-controls');
  chrome.runtime.sendMessage = originalSend;

  const existingHost = globalThis.__nexlyPageControls.host;
  installPageControls({ phase: 'idle', busy: false }, undefined, undefined, 'older-injection');
  assert.equal(globalThis.__nexlyPageControls.host, existingHost, '复用已有组件');
  assert.equal(globalThis.__nexlyPageControls.ownerToken, 'older-injection');
  installPageControls({ phase: 'idle', busy: false }, undefined, undefined, 'current-injection');
  assert.equal(globalThis.__nexlyPageControls.ownerToken, 'current-injection', '复用组件也必须替换注入归属');
  assert.deepEqual(removePageControls('older-injection'), { ok: true, removed: false, skipped: true });
  assert.equal(globalThis.__nexlyPageControls.host, existingHost, '过期注入的清理不能移除新注入所复用的组件');
  assert.equal(existingHost.isConnected, true);
  installPageControls({ phase: 'idle', busy: false });
  assert.equal(globalThis.__nexlyPageControls.ownerToken, null, '无 token 的兼容调用会清除旧归属');
  assert.deepEqual(removePageControls('current-injection'), { ok: true, removed: false, skipped: true });

  const removal = removePageControls();
  assert.equal(removal.removed, true);
  assert.equal(globalThis.__nexlyPageControls, null);
});

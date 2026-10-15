import test from 'node:test';
import assert from 'node:assert/strict';
import { pageAction } from '../extension/lib/page.js';

// pageAction 由 chrome.scripting 序列化进页面，依赖真实 DOM。这里只用最小桩执行读取路径，
// 复现“页面上存在常驻代码编辑器时，单选题被误判成编程题并试图点击执行验证”的场景。
class FakeElement {
  constructor({ tag = 'div', attrs = {}, text = '', classes = [], children = [], display = 'block', visibility = 'visible' } = {}) {
    this.nodeType = 1;
    this.tagName = tag.toUpperCase();
    this.attrs = { ...attrs };
    this._text = text;
    this._classes = new Set(classes);
    this._display = display;
    this._visibility = visibility;
    this.children = children;
    this.parentElement = null;
    this.removed = false;
    for (const child of children) child.parentElement = this;
  }
  get id() { return this.attrs.id || ''; }
  get type() { return this.attrs.type || ''; }
  get value() { return this.attrs.value ?? ''; }
  get disabled() { return this.attrs.disabled === true; }
  get readOnly() { return this.attrs.readonly === true; }
  get isContentEditable() { return this.attrs.contenteditable === 'true'; }
  get isConnected() { return !this.removed; }
  get className() { return [...this._classes].join(' '); }
  get innerText() { return this._text; }
  get textContent() { return this._text; }
  get classList() { const classes = this._classes; return { contains: (name) => classes.has(name) }; }
  getAttribute(name) { return name in this.attrs ? String(this.attrs[name]) : null; }
  hasAttribute(name) { return name in this.attrs; }
  matches(selector) { return matches(this, selector); }
  closest(selector) { for (let node = this; node; node = node.parentElement) if (matches(node, selector)) return node; return null; }
  getClientRects() { return [{ width: 10, height: 10 }]; }
  append() {}
  remove() { this.removed = true; }
  click() { (this.events ||= []).push('click'); if (this.onClick) this.onClick(this); }
  dispatchEvent(event) { (this.events ||= []).push(event.type); if (this.onEvent) this.onEvent(event); return true; }
  querySelectorAll(selector) { return descendants(this).filter((node) => matches(node, selector)); }
  cloneNode() { const text = this._text; return { get textContent() { return text; }, querySelectorAll: () => [], append: () => {} }; }
}

function matchGroup(node, group) {
  const nots = [];
  const source = group.trim().replace(/:not\(([^)]*)\)/g, (_, inner) => { nots.push(inner.trim()); return ''; });
  const tokens = source.match(/(?:^[a-zA-Z][\w-]*|\*)|(?:\.[\w-]+)|(?:#[\w-]+)|(?:\[[^\]]+\])/g) || [];
  let tag = null;
  for (const token of tokens) {
    if (token.startsWith('.')) { if (!node._classes.has(token.slice(1))) return false; }
    else if (token.startsWith('#')) { if (node.id !== token.slice(1)) return false; }
    else if (token.startsWith('[')) {
      const body = token.slice(1, -1);
      const equals = body.match(/^([\w-]+)\s*=\s*["']?(.*?)["']?$/);
      if (equals) { if (node.getAttribute(equals[1]) !== equals[2]) return false; }
      else if (!node.hasAttribute(body)) return false;
    } else if (token !== '*') tag = token.toLowerCase();
  }
  if (tag && node.tagName.toLowerCase() !== tag) return false;
  return !nots.some((not) => matchGroup(node, not));
}
function matches(node, selector) { return selector.split(',').some((group) => matchGroup(node, group)); }
function descendants(node) { return node.children.flatMap((child) => [child, ...descendants(child)]); }

async function readPage(body, href = 'https://example.com/practice') {
  const nodes = [body, ...descendants(body)];
  globalThis.document = {
    visibilityState: 'visible', body, documentElement: body,
    createTextNode: (text) => ({ nodeType: 3, textContent: text }),
    querySelectorAll: (selector) => nodes.filter((node) => matches(node, selector)),
    querySelector: (selector) => nodes.find((node) => matches(node, selector)) || null
  };
  globalThis.window = { parent: null, frameElement: null };
  globalThis.location = { href, origin: new URL(href).origin, pathname: new URL(href).pathname };
  globalThis.getComputedStyle = (node) => ({ display: node._display || 'block', visibility: node._visibility || 'visible' });
  globalThis.CSS = { escape: (value) => String(value) };
  return pageAction('read');
}

const radio = (label) => new FakeElement({ tag: 'input', attrs: { type: 'radio', 'aria-label': label } });
const checkbox = (label) => new FakeElement({ tag: 'input', attrs: { type: 'checkbox', 'aria-label': label } });
const button = (text) => new FakeElement({ tag: 'button', text });
const editor = () => new FakeElement({ tag: 'div', classes: ['monaco-editor'] });
const codeArea = (value) => new FakeElement({ tag: 'textarea', attrs: { 'data-language': 'ArkTS', value } });

test('page with a persistent code editor keeps single choice as single and never exposes a run entry', async () => {
  const options = [radio('A. 使用 var 声明变量'), radio('B. 使用 let 声明变量')];
  // 平台的常驻工具栏在题干区域里始终显示“执行验证”，常驻 IDE 面板在题目区域外。
  const question = new FakeElement({ tag: 'div', classes: ['question-container'], text: '第 1 / 10 题 以下关于 ArkTS 的说法正确的是：', children: [...options, button('执行验证')] });
  const ide = new FakeElement({ tag: 'div', classes: ['ide-panel'], children: [editor()] });
  const result = await readPage(new FakeElement({ tag: 'body', children: [question, ide] }));

  assert.equal(result.ok, true, result.error);
  assert.equal(result.question.type, 'single');
  assert.deepEqual(result.question.options.map((option) => option.text), ['A. 使用 var 声明变量', 'B. 使用 let 声明变量']);
  assert.equal(result.run.available, false);
  assert.equal(result.run.reason, 'not-code');
  assert.equal(result.editor.kind, '');
  assert.equal(result.question.starterCode, '');
});

test('checkbox options still win over an unrelated editor', async () => {
  const question = new FakeElement({ tag: 'div', classes: ['exam-question'], text: '第 2 / 10 题  下面哪些属于 ArkTS 支持的声明方式？', children: [checkbox('A. let'), checkbox('B. const'), button('执行')] });
  const ide = new FakeElement({ tag: 'div', classes: ['ide-panel'], children: [editor()] });
  const result = await readPage(new FakeElement({ tag: 'body', children: [question, ide] }));

  assert.equal(result.ok, true, result.error);
  assert.equal(result.question.type, 'multiple');
  assert.equal(result.run.available, false);
});

test('hidden native inputs inside visible option rows are still real options', async () => {
  // 站点常把原生 radio 设为 display:none、只显示自绘样式；这类选项必须仍能识别并操作。
  const rows = [radio('A. 使用 var'), radio('B. 使用 let')].map((input, index) => {
    input._display = 'none';
    const row = new FakeElement({ tag: 'div', classes: ['option-row'], text: `选项 ${index}`, children: [input] });
    return row;
  });
  const question = new FakeElement({ tag: 'div', classes: ['question-container'], text: '第 7 / 10 题 以下说法正确的是：', children: [...rows, button('执行验证')] });
  const ide = new FakeElement({ tag: 'div', classes: ['ide-panel'], children: [editor()] });
  const result = await readPage(new FakeElement({ tag: 'body', children: [question, ide] }));

  assert.equal(result.ok, true, result.error);
  assert.equal(result.question.type, 'single');
  assert.deepEqual(result.question.options.map((option) => option.text), ['A. 使用 var', 'B. 使用 let']);
  assert.equal(result.run.available, false);
});

test('custom option markup with A./B. markers is not treated as a code question', async () => {
  const question = new FakeElement({ tag: 'div', classes: ['question-container'], text: '第 8 / 10 题 以下关于 ArkTS 的说法正确的是：\nA. 使用 var 声明变量\nB. 使用 let 声明常量', children: [button('执行验证')] });
  const ide = new FakeElement({ tag: 'div', classes: ['ide-panel'], children: [editor()] });
  const result = await readPage(new FakeElement({ tag: 'body', children: [question, ide] }));

  // 自绘选项无法安全点击时明确报“选项不完整”，而不是当编程题写代码并去点执行验证。
  assert.equal(result.ok, false);
  assert.match(result.error, /选项不完整/);
});

test('code question reports a unique execute/verify entry and its label', async () => {
  const question = new FakeElement({ tag: 'div', classes: ['problem-container'], text: '第 3 / 10 题 学生出勤记录：输入字符串只含 A、L、P。', children: [codeArea('process.stdin'), button('执行验证')] });
  const result = await readPage(new FakeElement({ tag: 'body', children: [question] }));

  assert.equal(result.ok, true, result.error);
  assert.equal(result.question.type, 'code');
  assert.equal(result.editor.supported, true, result.editor.error);
  assert.equal(result.editor.kind, 'textarea');
  assert.equal(result.question.starterCode, 'process.stdin');
  assert.deepEqual({ available: result.run.available, label: result.run.label, count: result.run.count }, { available: true, label: '执行验证', count: 1 });
});

test('ambiguous or missing execute entries are reported instead of guessed', async () => {
  const ambiguous = await readPage(new FakeElement({ tag: 'body', children: [new FakeElement({ tag: 'div', classes: ['problem-container'], text: '第 4 / 10 题 编程练习题：实现一个函数。', children: [codeArea('code();'), button('运行代码'), button('执行代码')] })] }));
  assert.equal(ambiguous.question.type, 'code');
  assert.equal(ambiguous.run.available, false);
  assert.equal(ambiguous.run.reason, 'ambiguous');
  assert.equal(ambiguous.run.count, 2);

  const missing = await readPage(new FakeElement({ tag: 'body', children: [new FakeElement({ tag: 'div', classes: ['problem-container'], text: '第 5 / 10 题 编程练习题：实现一个函数。', children: [codeArea('code();'), button('提交')] })] }));
  assert.equal(missing.question.type, 'code');
  assert.equal(missing.run.available, false);
  assert.equal(missing.run.reason, 'missing');
});

test('custom role=radio options are verified through ARIA state', async () => {
  const nodes = [0, 1].map((index) => new FakeElement({ tag: 'div', attrs: { role: 'radio', 'aria-checked': 'false', 'aria-label': index === 0 ? 'A. 第一项' : 'B. 第二项' } }));
  for (const node of nodes) node.onClick = () => { for (const other of nodes) other.attrs['aria-checked'] = String(other === node); };
  const question = new FakeElement({ tag: 'div', classes: ['question-container'], text: '第 9 / 10 题 以下说法正确的是：', children: nodes });
  const read = await readPage(new FakeElement({ tag: 'body', children: [question] }));
  assert.equal(read.question.type, 'single');

  const filled = await pageAction('fillStep', { questionId: read.question.questionId, answer: { questionId: read.question.questionId, type: 'single', choiceIds: ['option-1'] }, progress: { started: false, offset: 0, fieldIndex: 0, step: 0 }, pacing: { typewriter: false, typingIntervalMs: 0 }, allowBackground: true });
  assert.equal(filled.done, true, filled.detail);
  assert.equal(nodes[1].attrs['aria-checked'], 'true');
  assert.equal(nodes[0].attrs['aria-checked'], 'false');
});

test('selected class names count as option state when ARIA is absent', async () => {
  const first = new FakeElement({ tag: 'div', classes: ['option', 'is-selected'], attrs: { role: 'radio', 'aria-label': 'A. 甲' } });
  const second = new FakeElement({ tag: 'div', classes: ['option'], attrs: { role: 'radio', 'aria-label': 'B. 乙' } });
  const question = new FakeElement({ tag: 'div', classes: ['question-container'], text: '第 10 / 10 题 请选择：', children: [first, second] });
  const read = await readPage(new FakeElement({ tag: 'body', children: [question] }));
  assert.equal(read.question.type, 'single');

  const filled = await pageAction('fillStep', { questionId: read.question.questionId, answer: { questionId: read.question.questionId, type: 'single', choiceIds: ['option-0'] }, progress: { started: false, offset: 0, fieldIndex: 0, step: 0 }, pacing: { typewriter: false, typingIntervalMs: 0 }, allowBackground: true });
  assert.equal(filled.done, true, filled.detail);
  assert.equal(filled.verified, true);
});

test('options that only react to pointer events are still selected', async () => {
  globalThis.MouseEvent = class { constructor(type, init = {}) { this.type = type; Object.assign(this, init); } };
  globalThis.PointerEvent = class extends globalThis.MouseEvent {};
  const nodes = [0, 1].map((index) => new FakeElement({ tag: 'div', classes: ['circle'], attrs: { role: 'radio', 'aria-label': index === 0 ? 'A. 正确(True)' : 'B. 错误(False)' } }));
  for (const node of nodes) {
    node.onClick = () => {}; // 站点没有监听 click，只监听指针事件
    node.onEvent = (event) => { if (event.type === 'pointerdown') for (const other of nodes) other.attrs['aria-checked'] = String(other === node); };
  }
  const question = new FakeElement({ tag: 'div', classes: ['question-container'], text: '第 11 / 35 题 HarmonyOS 是新一代的智能终端操作系统。', children: nodes });
  const read = await readPage(new FakeElement({ tag: 'body', children: [question] }));
  assert.equal(read.question.type, 'single');

  const filled = await pageAction('fillStep', { questionId: read.question.questionId, answer: { questionId: read.question.questionId, type: 'single', choiceIds: ['option-0'] }, progress: { started: false, offset: 0, fieldIndex: 0, step: 0 }, pacing: { typewriter: false, typingIntervalMs: 0 }, allowBackground: true });
  assert.equal(filled.done, true, filled.detail);
  assert.ok(nodes[0].events.includes('pointerdown'));
  assert.equal(nodes[0].attrs['aria-checked'], 'true');
});

test('errors thrown inside the injected page function come back as a readable message', async () => {
  const question = new FakeElement({ tag: 'div', classes: ['question-container'], text: '第 12 / 35 题 以下说法正确的是：', children: [radio('A. 甲'), radio('B. 乙')] });
  const read = await readPage(new FakeElement({ tag: 'body', children: [question] }));
  const result = await pageAction('fillStep', { questionId: read.question.questionId, answer: { questionId: 'stale-question', type: 'single', choiceIds: ['option-0'] }, progress: { started: false, offset: 0, fieldIndex: 0, step: 0 }, pacing: { typewriter: false, typingIntervalMs: 0 }, allowBackground: true });
  assert.equal(result.ok, false);
  assert.match(result.error, /页面操作未能完成/);
  assert.match(result.error, /答案与当前题目不匹配/);
});

test('options rebuilt by the page after a click are read back from the fresh nodes', async () => {
  const container = new FakeElement({ tag: 'div', classes: ['question-container'], text: '第 13 / 35 题 请判断：' });
  const make = (index, selected) => new FakeElement({ tag: 'input', attrs: { type: 'radio', 'aria-label': index === 0 ? 'A. 正确(True)' : 'B. 错误(False)' }, classes: selected ? ['is-selected'] : [] });
  let nodes = [make(0, false), make(1, false)];
  const mount = () => { container.children = nodes; for (const node of nodes) node.parentElement = container; };
  mount();
  // 模拟站点点击后整组重建选项：旧节点被移除，新节点通过类名表达选中态。
  for (const [index, node] of nodes.entries()) node.onClick = () => { for (const old of nodes) old.removed = true; nodes = [make(0, index === 0), make(1, index === 1)]; mount(); };

  const read = await readPage(new FakeElement({ tag: 'body', children: [container] }));
  assert.equal(read.question.type, 'single');
  const filled = await pageAction('fillStep', { questionId: read.question.questionId, answer: { questionId: read.question.questionId, type: 'single', choiceIds: ['option-1'] }, progress: { started: false, offset: 0, fieldIndex: 0, step: 0 }, pacing: { typewriter: false, typingIntervalMs: 0 }, allowBackground: true });
  assert.equal(filled.done, true, filled.detail);
  assert.equal(filled.verified, true);
  assert.equal(nodes[1]._classes.has('is-selected'), true);
});

test('radio questions with unreadable state continue after the click instead of failing', async () => {
  const nodes = [0, 1].map((index) => new FakeElement({ tag: 'div', attrs: { role: 'radio', 'aria-label': index === 0 ? 'A. 正确(True)' : 'B. 错误(False)' } }));
  for (const [index, node] of nodes.entries()) node.onClick = () => { node.clicked = index; }; // 点击有效，但页面不暴露任何选中状态
  const question = new FakeElement({ tag: 'div', classes: ['question-container'], text: '第 14 / 35 题 请判断：', children: nodes });
  const read = await readPage(new FakeElement({ tag: 'body', children: [question] }));

  const filled = await pageAction('fillStep', { questionId: read.question.questionId, answer: { questionId: read.question.questionId, type: 'single', choiceIds: ['option-1'] }, progress: { started: false, offset: 0, fieldIndex: 0, step: 0 }, pacing: { typewriter: false, typingIntervalMs: 0 }, allowBackground: true });
  assert.equal(filled.done, true, filled.detail);
  assert.equal(filled.verified, false);
  assert.match(filled.detail, /请人工核对/);
  assert.equal(nodes[1].clicked, 1);
});

test('a more explicit execute entry wins over a bare verb on the same page', async () => {
  const result = await readPage(new FakeElement({ tag: 'body', children: [new FakeElement({ tag: 'div', classes: ['problem-container'], text: '第 6 / 10 题 编程练习题：实现一个函数。', children: [codeArea('code();'), button('运行'), button('执行验证')] })] }));
  assert.equal(result.question.type, 'code');
  assert.deepEqual({ available: result.run.available, label: result.run.label, reason: result.run.reason }, { available: true, label: '执行验证', reason: '' });
});

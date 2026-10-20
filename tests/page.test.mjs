import test from 'node:test';
import assert from 'node:assert/strict';
import { pageAction } from '../extension/lib/page.js';
import { COURSE_PLATFORMS } from '../extension/lib/course-platforms.js';

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
  contains(node) { return node === this || descendants(this).includes(node); }
  append() {}
  remove() { this.removed = true; }
  click() { (this.events ||= []).push('click'); if (this.onClick) this.onClick(this); }
  dispatchEvent(event) { (this.events ||= []).push(event.type); if (this.onEvent) this.onEvent(event); return true; }
  querySelectorAll(selector) { return descendants(this).filter((node) => matches(node, selector)); }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
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

async function readPage(body, href = 'https://example.com/practice', payload = {}) {
  const nodes = [body, ...descendants(body)];
  globalThis.document = {
    visibilityState: 'visible', body, documentElement: body,
    createTextNode: (text) => ({ nodeType: 3, textContent: text }),
    querySelectorAll: (selector) => nodes.filter((node) => matches(node, selector)),
    querySelector: (selector) => nodes.find((node) => matches(node, selector)) || null,
    getElementById: (id) => nodes.find((node) => node.id === id) || null
  };
  globalThis.window = { parent: null, frameElement: null };
  globalThis.location = { href, protocol: new URL(href).protocol, origin: new URL(href).origin, pathname: new URL(href).pathname };
  globalThis.getComputedStyle = (node) => ({ display: node._display || 'block', visibility: node._visibility || 'visible' });
  globalThis.CSS = { escape: (value) => String(value) };
  return pageAction('read', payload);
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

function codeMirrorArea(value = 'const n = 1n;\nconsole.log(n);') {
  const area = new FakeElement({ classes: ['CodeMirror'], attrs: { value } }), doc = {};
  area.CodeMirror = {
    getDoc: () => doc, getValue: () => area.value,
    getOption: (name) => name === 'readOnly' && area.readOnly,
    setValue: (code) => { area.attrs.value = code; }
  };
  return area;
}

async function executionPage(resultText = '', extra = [], area = codeArea('const values = new Set<number>();\nfor (const n of values) {}')) {
  const run = button('执行代码'), submit = button('提交代码');
  const result = new FakeElement({ attrs: { 'data-nexly-result': '' }, text: resultText });
  const body = new FakeElement({ tag: 'body', children: [new FakeElement({ attrs: { 'data-nexly-question': '' }, text: '编程题：相反数，输出相反数对的数量。', children: [area, run, submit, result, ...extra] })] });
  const read = await readPage(body);
  assert.equal(read.ok, true, read.error);
  const start = () => pageAction('run', { questionId: read.question.questionId, editorBinding: read.editor.binding, code: area.value, allowBackground: true });
  const poll = (runToken) => pageAction('runStatus', { questionId: read.question.questionId, runToken, allowBackground: true });
  return { area, run, submit, result, read, start, poll };
}

test('execution feedback reads the active TS2802 log, sample IO and actual code without submitting', async (t) => {
  t.mock.timers.enable({ apis: ['Date'] });
  const old = new FakeElement({ attrs: { 'data-nexly-result': '', hidden: '' }, text: '通过\n测试输出\nold' });
  const submitted = new FakeElement({ attrs: { role: 'tabpanel', 'data-nexly-result': '', 'aria-label': '提交结果' }, text: '通过\n测试输出\nold submitted code' });
  const page = await executionPage('', [old, submitted]);
  const log = "编译错误\n测试输入\n1 2 3 4 5\n测试输出\nsolution.ts(18,23): error TS2802: Type 'Set<number>' can only be iterated through with target es2015.\n预期输出\n0";
  page.run.onClick = () => { page.result._text = log; };
  const run = await page.start(); assert.equal(run.ok, true, run.error);
  let status = await page.poll(run.runToken); assert.equal(status.stable, false);
  t.mock.timers.tick(400); status = await page.poll(run.runToken);
  assert.equal(status.fresh, true); assert.equal(status.stable, true);
  assert.equal(status.outcome, 'failed'); assert.equal(status.summary, '编译错误');
  assert.equal(status.result, log); assert.equal(status.code, page.area.value);
  assert.equal((await pageAction('read')).question.questionId, page.read.question.questionId);
  assert.equal(page.submit.events, undefined);
  await pageAction('releaseRun', { runToken: run.runToken });
  assert.equal(globalThis.__nexlySampleRun, undefined);
});

test('CodeMirror 5 read-only during execution waits for recovery before returning fresh TS2737 feedback', async (t) => {
  t.mock.timers.enable({ apis: ['Date'] });
  const area = codeMirrorArea(), page = await executionPage('', [], area);
  assert.equal(page.read.editor.kind, 'CodeMirror 5');
  page.run.onClick = () => { area.attrs.readonly = true; page.run.attrs.disabled = true; page.result._text = '编译中'; };
  const run = await page.start(); assert.equal(run.ok, true, run.error);
  let status = await page.poll(run.runToken);
  assert.equal(status.ok, true, status.error); assert.equal(status.loading, true); assert.equal(status.waitingForEditor, true);
  const log = '编译错误\n测试输入\n1 3\n测试输出\nsolution.ts(12,19): error TS2737: BigInt literals are not available when targeting lower than ES2020.\n预期输出\n123';
  page.result._text = log; page.run.attrs.disabled = false; t.mock.timers.tick(400);
  status = await page.poll(run.runToken);
  assert.equal(status.ok, true, status.error); assert.equal(status.loading, true); assert.equal(status.result, log);
  assert.equal(area.readOnly, true); // 插件只能等待，不能解除站点设置的只读状态。
  area.attrs.readonly = false;
  await page.poll(run.runToken); t.mock.timers.tick(400); status = await page.poll(run.runToken);
  assert.equal(status.ok, true, status.error); assert.equal(status.loading, false); assert.equal(status.waitingForEditor, false);
  assert.equal(status.fresh, true); assert.equal(status.stable, true); assert.equal(status.outcome, 'failed');
  assert.equal(status.result, log); assert.equal(status.code, area.value);
  assert.equal((await pageAction('read')).editor.binding, page.read.editor.binding);
  assert.equal(page.submit.events, undefined);
  await pageAction('releaseRun', { runToken: run.runToken });
});

test('execution loading overlays and briefly hidden editors are waiting states, not manual code changes', async (t) => {
  t.mock.timers.enable({ apis: ['Date'] });
  for (const hide of [false, true]) {
    const overlay = new FakeElement({ attrs: { 'aria-busy': 'false' } });
    const page = await executionPage('', [overlay]);
    page.run.onClick = () => {
      if (hide) page.area._display = 'none'; else overlay.attrs['aria-busy'] = 'true';
      page.run.attrs.disabled = true; page.result._text = '编译中';
    };
    const run = await page.start(), waiting = await page.poll(run.runToken);
    assert.equal(waiting.ok, true, waiting.error); assert.equal(waiting.waitingForEditor, true);
    page.area._display = 'block'; overlay.attrs['aria-busy'] = 'false'; page.run.attrs.disabled = false;
    page.result._text = '通过\n测试输出\n0\n预期输出\n0';
    await page.poll(run.runToken); t.mock.timers.tick(400);
    const result = await page.poll(run.runToken);
    assert.equal(result.loading, false); assert.equal(result.outcome, 'passed'); assert.equal(result.fresh, true);
    await pageAction('releaseRun', { runToken: run.runToken });
  }
});

test('temporary editor unavailability alone never makes an identical stale execution log fresh', async (t) => {
  t.mock.timers.enable({ apis: ['Date'] });
  const area = codeMirrorArea(), page = await executionPage('编译错误\n测试输出\nold error TS2737', [], area);
  page.run.onClick = () => { area.attrs.readonly = true; };
  const run = await page.start(); let status = await page.poll(run.runToken);
  assert.equal(status.ok, true, status.error); assert.equal(status.loading, true); assert.equal(status.fresh, false);
  area.attrs.readonly = false; await page.poll(run.runToken); t.mock.timers.tick(400);
  status = await page.poll(run.runToken);
  assert.equal(status.ok, true, status.error); assert.equal(status.loading, false); assert.equal(status.fresh, false);
  await pageAction('releaseRun', { runToken: run.runToken });
});

test('recovery still rejects actual code edits, a replaced CodeMirror document, and multiple active editors', async (t) => {
  t.mock.timers.enable({ apis: ['Date'] });
  for (const reason of ['edit', 'document', 'ambiguous']) {
    const area = codeMirrorArea(), page = await executionPage('', [], area);
    page.run.onClick = () => { area.attrs.readonly = true; page.result._text = '编译中'; };
    const run = await page.start(); assert.equal((await page.poll(run.runToken)).ok, true);
    area.attrs.readonly = false; page.result._text = '编译错误\n测试输出\nerror TS2737';
    if (reason === 'edit') area.attrs.value = 'humanEdit();';
    if (reason === 'document') area.CodeMirror.getDoc = () => ({});
    if (reason === 'ambiguous') {
      const other = codeArea('anotherFile();'); other.parentElement = area.parentElement; area.parentElement.children.push(other);
    }
    const result = await page.poll(run.runToken);
    assert.equal(result.ok, false);
    assert.match(result.error, reason === 'edit' ? /代码已变化/ : reason === 'document' ? /编辑器实例或代码文件已切换/ : /多个活动代码区域/);
    await pageAction('releaseRun', { runToken: run.runToken });
  }
});

test('success classification ignores Error/Wrong Answer in normal sample output and excludes ambiguous results', async (t) => {
  t.mock.timers.enable({ apis: ['Date'] });
  const page = await executionPage();
  page.run.onClick = () => { page.result._text = '通过\n测试输出\nError Wrong Answer\n预期输出\nError Wrong Answer'; };
  const run = await page.start(); t.mock.timers.tick(400);
  assert.equal((await page.poll(run.runToken)).outcome, 'passed');
  await pageAction('releaseRun', { runToken: run.runToken });
  const other = new FakeElement({ attrs: { 'data-nexly-result': '' }, text: '运行错误\n测试输出\nother' });
  const ambiguous = await executionPage('编译错误\n测试输出\nold', [other]);
  const pending = await ambiguous.start(); t.mock.timers.tick(400);
  const status = await ambiguous.poll(pending.runToken);
  assert.equal(status.outcome, 'unknown'); assert.equal(status.result, '');
  await pageAction('releaseRun', { runToken: pending.runToken });
});

test('identical stale logs are not fresh; a short observed loading cycle permits identical new failures and is cleaned up', async (t) => {
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'] });
  let callback, disconnects = 0;
  const previous = globalThis.MutationObserver;
  globalThis.MutationObserver = class { constructor(fn) { callback = fn; } observe() {} disconnect() { disconnects++; } };
  t.after(() => { globalThis.MutationObserver = previous; });
  const page = await executionPage('编译错误\n测试输出\nerror TS2802');
  const run = await page.start(); t.mock.timers.tick(400);
  assert.equal((await page.poll(run.runToken)).fresh, false);
  page.run.attrs.disabled = true; callback();
  page.run.attrs.disabled = false; callback();
  t.mock.timers.tick(400);
  const status = await page.poll(run.runToken);
  assert.equal(status.fresh, true); assert.equal(status.outcome, 'failed');
  // 错 token 不能释放当前执行，新一轮执行会主动释放上一轮观察器。
  await pageAction('releaseRun', { runToken: 'wrong' }); assert.equal(disconnects, 0);
  const next = await page.start(); assert.equal(disconnects, 1);
  assert.equal((await page.poll(run.runToken)).ok, false);
  t.mock.timers.tick(65000); assert.equal(globalThis.__nexlySampleRun, undefined); assert.equal(disconnects, 2);
  assert.equal((await page.poll(next.runToken)).ok, false);
});

test('feedback refuses user code edits and bounds logs without truncating executed code', async (t) => {
  t.mock.timers.enable({ apis: ['Date'] });
  const page = await executionPage();
  page.run.onClick = () => { page.result._text = '编译错误\n测试输出\n' + 'e'.repeat(17000); };
  const run = await page.start(); t.mock.timers.tick(400);
  const status = await page.poll(run.runToken);
  assert.equal(status.result.length, 16000); assert.match(status.result, /已截断/);
  assert.equal(status.code, page.area.value);
  page.area.attrs.value = 'console.log("manual");';
  const changed = await page.poll(run.runToken);
  assert.equal(changed.ok, false); assert.match(changed.error, /代码已变化/);
  await pageAction('releaseRun', { runToken: run.runToken });
});

test('partial pass counts and standalone compiler diagnostics cannot be mistaken for success', async (t) => {
  t.mock.timers.enable({ apis: ['Date'] });
  for (const [log, expected] of [
    ['通过率：0%\n测试输出\n1\n预期输出\n0', 'failed'],
    ['1/2 用例通过\n测试输出\n1\n预期输出\n0', 'failed'],
    ['0/0 用例通过\n测试输出\n', 'unknown'],
    ['执行成功\n测试输出\n1\n预期输出\n0', 'unknown'],
    ['执行结果\nsolution.ts(18,23): error TS2802: Set<number>', 'failed']
  ]) {
    const page = await executionPage(); page.run.onClick = () => { page.result._text = log; };
    const run = await page.start(); t.mock.timers.tick(400);
    assert.equal((await page.poll(run.runToken)).outcome, expected, log);
    await pageAction('releaseRun', { runToken: run.runToken });
  }
});

test('the first repair fragment checks the failed code atomically before any editor write', async () => {
  const page = await executionPage(), expectedCode = page.area.value;
  page.area.attrs.value = 'humanInTheGap();';
  const result = await pageAction('fillStep', { questionId: page.read.question.questionId, editorBinding: page.read.editor.binding, expectedCode, progress: { started: false, offset: 0 }, answer: { questionId: page.read.question.questionId, type: 'code', code: 'repaired();' }, allowBackground: true });
  assert.equal(result.ok, false); assert.match(result.error, /修正写入前代码已被人工更改/);
  assert.equal(page.area.value, 'humanInTheGap();'); assert.equal(page.area.events, undefined);
});

test('nested output tabs retain their enclosing execution status instead of losing the compiler error', async (t) => {
  t.mock.timers.enable({ apis: ['Date'] });
  const page = await executionPage();
  const nested = new FakeElement({ attrs: { role: 'tabpanel' }, text: '测试输出\nerror TS2802\n预期输出\n0' });
  page.result.children.push(nested); nested.parentElement = page.result;
  page.run.onClick = () => { page.result._text = '编译错误\n' + nested._text; };
  const run = await page.start(); t.mock.timers.tick(400);
  const result = await page.poll(run.runToken);
  assert.equal(result.outcome, 'failed'); assert.match(result.result, /编译错误/);
  await pageAction('releaseRun', { runToken: run.runToken });
});


test('same-page questions are scoped independently, including identical stems and offscreen blocks', async () => {
  const blocks = [0, 1, 2].map(index => new FakeElement({ attrs: { 'data-nexly-question': '', id: `sheet-${index}` }, text: '单选题：选择正确答案', children: [radio(`A. 第 ${index + 1} 题甲`), radio(`B. 第 ${index + 1} 题乙`)] }));
  const body = new FakeElement({ tag: 'body', children: blocks });
  const first = await readPage(body);
  assert.equal(first.ok, true, first.error);
  assert.equal(first.pageQuestions.keys.length, 3);
  assert.equal(first.question.options.length, 2);
  assert.deepEqual(first.question.options.map(item => item.text), ['A. 第 1 题甲', 'B. 第 1 题乙']);
  const second = await readPage(body, undefined, { questionKey: first.pageQuestions.keys[1] });
  assert.equal(second.ok, true, second.error);
  assert.deepEqual(second.question.options.map(item => item.text), ['A. 第 2 题甲', 'B. 第 2 题乙']);
  assert.notEqual(second.question.questionId, first.question.questionId);
  assert.equal(second.pageQuestions.signature, first.pageQuestions.signature);
  const stale = await readPage(body, undefined, { questionKey: 'missing-block' });
  assert.equal(stale.ok, false); assert.match(stale.error, /题块已变化或消失/);
  const identical = new FakeElement({ tag: 'body', children: [0, 1].map(index => new FakeElement({ attrs: { 'data-nexly-question': '', id: `identical-${index}` }, text: '单选题：相同题干', children: [radio('A. 甲'), radio('B. 乙')] })) });
  const a = await readPage(identical), b = await readPage(identical, undefined, { questionKey: a.pageQuestions.keys[1] });
  assert.notEqual(a.question.questionId, b.question.questionId, '相同题面不能让后一题被去重跳过');
});

test('Moodle skips description blocks and flag checkboxes while recognizing choice, judge and blanks', async () => {
  const flag = new FakeElement({ classes: ['info'], children: [checkbox('标记试题')] });
  const clear = new FakeElement({ classes: ['qtype_multichoice_clearchoice'], children: [radio(''), new FakeElement({ tag: 'a', text: '清空我的选择' })] });
  const blocks = [
    new FakeElement({ classes: ['que', 'description'], text: '一、单项选择题' }),
    new FakeElement({ classes: ['que', 'multichoice'], attrs: { id: 'q-1' }, text: '请选择正确答案', children: [flag, radio('A. 甲'), radio('B. 乙'), clear] }),
    new FakeElement({ classes: ['que', 'truefalse'], attrs: { id: 'q-2' }, text: '请判断此陈述', children: [radio('对'), radio('错')] }),
    new FakeElement({ classes: ['que', 'shortanswer'], attrs: { id: 'q-3' }, text: '填写结果', children: [new FakeElement({ tag: 'input', attrs: { type: 'text' } })] })
  ];
  const body = new FakeElement({ tag: 'body', children: blocks });
  const first = await readPage(body);
  assert.equal(first.ok, true, first.error); assert.equal(first.pageQuestions.keys.length, 3);
  assert.equal(first.question.type, 'single'); assert.equal(first.question.options.length, 2);
  const judge = await readPage(body, undefined, { questionKey: first.pageQuestions.keys[1] });
  assert.equal(judge.question.type, 'judge'); assert.equal(judge.question.options.length, 2);
  const blank = await readPage(body, undefined, { questionKey: first.pageQuestions.keys[2] });
  assert.equal(blank.question.type, 'blank'); assert.equal(blank.question.fields.length, 1);
});

test('course roots use shared platform selectors, ignore old selection markers and never absorb unrelated forms', async () => {
  for (const [host, className] of [['mooc1.chaoxing.com', 'TiMu'], ['studyh5.zhihuishu.com', 'questionWrap'], ['www.icourse163.org', 'u-questionItem']]) {
    const blocks = [0, 1].map(index => new FakeElement({ classes: [className, ...(index ? ['question-box'] : [])], attrs: { id: `course-${index}`, 'data-quizmate-course-question': 'selected' }, text: index ? '单选题：第二题' : '请选择正确答案', children: [radio('A. 甲'), radio('B. 乙')] }));
    const body = new FakeElement({ tag: 'body', children: [new FakeElement({ tag: 'header', children: [new FakeElement({ tag: 'input', attrs: { type: 'text' } })] }), ...blocks] });
    const first = await readPage(body, `https://${host}/learn`, { coursePlatforms: COURSE_PLATFORMS });
    assert.equal(first.ok, true, `${host}: ${first.error}`); assert.equal(first.pageQuestions.keys.length, 2);
    assert.equal(first.question.type, 'single'); assert.equal(first.question.options.length, 2);
    assert.match(first.question.stem, /请选择正确答案/, 'mixed generic/platform roots must stay in DOM order');
    const second = await readPage(body, `https://${host}/learn`, { coursePlatforms: COURSE_PLATFORMS, questionKey: first.pageQuestions.keys[1] });
    assert.equal(second.ok, true, second.error); assert.notEqual(first.question.questionId, second.question.questionId);
    const unknown = await readPage(body, 'https://unrelated.example/learn', { coursePlatforms: COURSE_PLATFORMS });
    assert.equal(unknown.ok, true, 'ordinary sites may still expose an explicit generic question');
    assert.equal(unknown.pageQuestions, null, 'platform-only roots must not be included on ordinary sites');
    assert.match(unknown.question.stem, /第二题/);
  }
});


test('Moodle assignment instructions are recognized without an editor and stay preview-only', async () => {
  const intro = new FakeElement({ tag: 'section', attrs: { id: 'intro' }, text: '大作业说明\n学生答题不能复制粘贴，不能以附件形式提交。论述严谨，理论联系实际，字数不少于1,000字。\n大作业：如何完善创新机制？' });
  const stale = new FakeElement({ tag: 'div', classes: ['question-container'], text: '判断题：旧题', children: [radio('对'), radio('错')] });
  const body = new FakeElement({ tag: 'body', text: 'PRIVATE NAVIGATION', children: [stale, intro, editor(), button('添加作业'), button('提交作业')] });
  const url = 'https://moodle.syxy.ouchn.cn/mod/assign/view.php?id=101';
  const result = await readPage(body, url);
  assert.equal(result.ok, true, result.error);
  assert.equal(result.question.type, 'text');
  assert.equal(result.question.assignment.draftOnly, true);
  assert.equal(result.question.assignment.minimumCharacters, 1000);
  assert.match(result.question.assignment.guidance, /禁止复制粘贴/);
  assert.equal(result.question.title, '大作业：如何完善创新机制？');
  assert.equal(result.question.fields[0].id, 'assignment-draft');
  assert.doesNotMatch(result.question.stem, /PRIVATE|旧题/);
  assert.equal(result.run.available, false);
  assert.equal(result.pageQuestions, null);
  const other = await readPage(body, url.replace('101', '102'));
  assert.notEqual(other.question.questionId, result.question.questionId, 'different assignments with equal text have independent identities');
  await readPage(body, url);
  for (const action of ['fill', 'fillStep', 'run', 'next']) {
    const blocked = await pageAction(action, { questionId: result.question.questionId, allowBackground: true });
    assert.equal(blocked.ok, false); assert.match(blocked.error, /人工录入和提交/);
  }
  assert.equal(body.children.at(-1).events, undefined);
});

test('assignment recognition fails closed without a valid intro/id and does not treat ordinary forms as assignments', async () => {
  const intro = new FakeElement({ attrs: { id: 'intro' }, text: '大作业说明\n请结合材料说明问题。' });
  const body = new FakeElement({ tag: 'body', children: [intro] });
  const url = 'https://moodle.syxy.ouchn.cn/mod/assign/view.php';
  assert.equal((await readPage(body, url)).ok, false);
  assert.equal((await readPage(body, url + '?id=not-id')).ok, false);
  assert.equal((await readPage(new FakeElement({ tag: 'body' }), url + '?id=123')).ok, false);
  assert.equal((await readPage(body, 'https://example.com/contact?id=123')).ok, false);
  const noLimit = await readPage(body, url + '?id=123');
  assert.equal(noLimit.ok, true, noLimit.error);
  assert.equal(noLimit.question.assignment.minimumCharacters, null);
});

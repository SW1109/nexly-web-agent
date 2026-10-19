import test from 'node:test';
import assert from 'node:assert/strict';
import { single, correct } from './data.mjs';

function event() {
  const listeners = [];
  return { addListener(listener) { listeners.push(listener); }, emit(...args) { for (const listener of listeners) listener(...args); } };
}
function deferred() {
  let resolve, reject;
  const promise = new Promise((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}
async function until(predicate) {
  for (let attempt = 0; attempt < 500; attempt++) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 2));
  }
  throw new Error('background race fixture did not reach the expected state');
}

test('read operations reserve the task entry and stopped asynchronous results cannot replace a later task', async (t) => {
  const commands = event(), messages = event(), disconnected = event(), storageChanged = event(), navigated = event(), outbound = [], panelOpens = [], panelCloses = [], hydrationGate = deferred(), installedWidgets = new Map(), removedWidgets = [];
  let saved, question = structuredClone(single), readGate = null, controlsGate = null, consentGate = null, activeTabId = 1, documentId = 'doc';
  const local = { dataConsentVersion: 1, provider: 'codex', count: 1, runInBackground: true, pacing: { answerDelayMs: 0, actionIntervalMs: 0, typingIntervalMs: 0, typewriter: false } };
  const port = {
    onMessage: messages, onDisconnect: disconnected,
    postMessage(message) {
      outbound.push(message);
      if (message.action === 'health') queueMicrotask(() => messages.emit({ requestId: message.requestId, type: 'result', data: { nodeVersion: 'test', providers: [] } }));
      if (message.action === 'cancel') queueMicrotask(() => {
        messages.emit({ requestId: message.targetId, type: 'error', error: '任务已停止' });
        messages.emit({ requestId: message.requestId, type: 'result', data: { canceled: true } });
      });
    }
  };
  globalThis.chrome = {
    storage: {
      onChanged: storageChanged,
      local: {
        async setAccessLevel() {}, async remove() {}, async set(patch) { Object.assign(local, patch); },
        async get(keys) {
          if (keys === 'dataConsentVersion' && consentGate) {
            const gate = consentGate; consentGate = null; gate.entered = true;
            await gate.promise;
          }
          return structuredClone(local);
        }
      },
      session: { async setAccessLevel() {}, async get(key) { if (key === 'taskState') await hydrationGate.promise; return {}; }, async set({ taskState }) { if (taskState) saved = structuredClone(taskState); } }
    },
    runtime: { id: 'race', getURL: (path) => `chrome-extension://race/${path}`, onMessage: commands, async sendMessage() {}, connectNative: () => port },
    tabs: { async query() { return [{ id: activeTabId, url: single.pageUrl }]; }, async get(id) { return { id, active: id === activeTabId, windowId: id === 1 ? 1 : 2, url: single.pageUrl }; }, onActivated: event(), async sendMessage() {} },
    windows: { async get() { return { focused: true }; }, onFocusChanged: event() },
    commands: { onCommand: event() },
    webNavigation: { onCompleted: navigated, async getAllFrames() { return []; } },
    sidePanel: { async setPanelBehavior() {}, async open(options) { panelOpens.push(options); }, async close(options) { panelCloses.push(options); } },
    permissions: { async contains() { return true; } },
    scripting: {
      async executeScript({ world, args, target, func }) {
        if (world === 'ISOLATED') {
          const injectedDocument = target.documentIds?.[0] || documentId, widgetKey = `${target.tabId}:${injectedDocument}`;
          if (func.name === 'removePageControls') {
            if (args?.[0] && installedWidgets.get(widgetKey) !== args[0]) return [{ result: { ok: true, removed: false, skipped: true } }];
            installedWidgets.delete(widgetKey); removedWidgets.push(widgetKey);
            return [{ result: { ok: true, removed: true } }];
          }
          assert.equal(func.name, 'installPageControls');
          installedWidgets.set(widgetKey, args[3]);
          if (controlsGate) {
            const gate = controlsGate; controlsGate = null; gate.entered = true;
            await gate.promise;
          }
          return [{ documentId: injectedDocument, result: { ok: true } }];
        }
        assert.equal(args[0], 'read');
        // Snapshot the old page before the browser returns its injection result.
        const result = [{ frameId: 0, documentId, result: { ok: true, question: structuredClone(question), editor: { supported: true }, run: { available: false } } }];
        if (readGate) {
          const gate = readGate; readGate = null; gate.entered = true;
          await gate.promise;
        }
        return result;
      }
    }
  };
  await import('../extension/background.js');
  const command = (action, data = {}) => new Promise((resolve) => commands.emit({ type: 'command', action, ...data }, { id: 'race', url: 'chrome-extension://race/panel.html' }, resolve));
  const pageCommand = (action, sender = {}) => new Promise((resolve) => commands.emit({ type: 'command', source: 'page-controls', action }, { id: 'race', tab: { id: 1 }, frameId: 0, documentId: 'doc', ...sender }, resolve));
  t.after(async () => { await command('stop'); disconnected.emit(); });
  const restoring = await pageCommand('openPanel');
  assert.equal(restoring.ok, false); assert.match(restoring.error, /后台正在恢复/); assert.equal(panelOpens.length, 0);
  hydrationGate.resolve();
  await command('state');
  const solves = () => outbound.filter((message) => message.action === 'solve');
  async function startNextQuestion() {
    const before = solves().length;
    question = { ...single, questionId: `new-question-${before + 1}`, title: '后续任务' };
    assert.equal((await command('start', { fill: false })).ok, true);
    await until(() => solves().length === before + 1);
    return solves().at(-1);
  }
  function assertCurrentSolve(request) {
    assert.equal(saved.busy, true);
    assert.equal(saved.operation, null);
    assert.equal(saved.phase, 'solving');
    assert.equal(saved.question.questionId, request.question.questionId);
    assert.equal(saved.answer, null);
    assert.equal(saved.error, '');
  }
  async function finish(request) {
    messages.emit({ requestId: request.requestId, type: 'result', data: { answer: { ...correct, questionId: request.question.questionId } } });
    await until(() => !saved.busy);
    assert.equal(saved.phase, 'ready');
  }

  await t.test('pending read excludes another read, control injection or solve', async () => {
    const gate = deferred(); readGate = gate;
    const pending = command('read');
    await until(() => gate.entered);
    assert.equal(saved.busy, true); assert.equal(saved.operation, 'read');
    for (const action of ['pause', 'resume']) {
      const response = await command(action);
      assert.equal(response.ok, false); assert.match(response.error, /读取操作不能暂停，请使用停止任务/);
      assert.equal(saved.paused, false); assert.equal(saved.phase, 'reading');
      assert.equal(saved.busy, true); assert.equal(saved.operation, 'read');
    }
    assert.equal((await command('state')).data.operation, 'read');
    assert.equal((await command('health')).ok, true, 'health must remain available while a page read is pending');
    assert.equal((await command('apiSettings')).ok, true, 'settings must remain readable while a page read is pending');
    for (const action of ['read', 'enableControls', 'start']) {
      const response = await command(action);
      assert.equal(response.ok, false); assert.match(response.error, /已有任务/);
    }
    assert.equal(solves().length, 0);
    gate.resolve();
    const response = await pending;
    assert.equal(response.ok, true); assert.equal(response.data.busy, false);
    assert.equal(saved.operation, null); assert.equal(saved.error, '');
  });

  await t.test('a failed read releases its lock and exits the reading phase', async () => {
    const gate = deferred(); readGate = gate;
    const pending = command('read');
    await until(() => gate.entered);
    gate.reject(new Error('Cannot access the exercise document'));
    const response = await pending;
    assert.equal(response.ok, false);
    assert.equal(saved.busy, false);
    assert.equal(saved.operation, null);
    assert.equal(saved.phase, 'error');
    assert.match(saved.error, /授权本站/);
    assert.equal((await command('read')).ok, true, 'a failed read must allow an immediate retry');
  });

  await t.test('only the exact bound page can open the side panel, synchronously and while busy', async () => {
    const gate = deferred(); readGate = gate;
    const pending = command('read');
    await until(() => gate.entered);
    const before = panelOpens.length;
    const opening = pageCommand('openPanel');
    assert.equal(panelOpens.length, before + 1, 'open() must run in the message callback before any awaited work loses the click gesture');
    assert.deepEqual(panelOpens.at(-1), { tabId: 1 });
    assert.equal((await opening).ok, true);
    for (const sender of [{ frameId: 7 }, { documentId: 'stale-document' }, { tab: { id: 2 } }]) {
      const response = await pageCommand('openPanel', sender);
      assert.equal(response.ok, false); assert.match(response.error, /未绑定/);
    }
    let forgedReply = false;
    commands.emit({ type: 'command', source: 'page-controls', action: 'openPanel' }, { id: 'another-extension', tab: { id: 1 }, frameId: 0, documentId: 'doc' }, () => { forgedReply = true; });
    assert.equal(forgedReply, false, 'another extension must not reach the page command handler');
    assert.equal(panelOpens.length, before + 1);
    assert.equal(saved.busy, true); assert.equal(saved.operation, 'read'); assert.equal(saved.error, '');
    gate.resolve(); assert.equal((await pending).ok, true);
    assert.equal((await command('openPanel')).ok, false, 'panel commands cannot impersonate a page-control click');
    assert.equal(panelOpens.length, before + 1);
    await command('read');
  });

  await t.test('closing the sidebar is scoped to the bound window and leaves an in-flight task alone', async () => {
    const gate = deferred(); readGate = gate;
    const pending = command('read');
    await until(() => gate.entered);
    const before = panelCloses.length;
    activeTabId = 2;
    try {
      assert.equal((await pageCommand('closePanel')).ok, true);
      assert.deepEqual(panelCloses.at(-1), { windowId: 1 });
      for (const sender of [{ frameId: 7 }, { documentId: 'stale-document' }, { tab: { id: 2 } }]) {
        const response = await pageCommand('closePanel', sender);
        assert.equal(response.ok, false); assert.match(response.error, /未绑定/);
      }
      let forgedReply = false;
      commands.emit({ type: 'command', source: 'page-controls', action: 'closePanel' }, { id: 'another-extension', tab: { id: 1 }, frameId: 0, documentId: 'doc' }, () => { forgedReply = true; });
      assert.equal(forgedReply, false);
      assert.equal(panelCloses.length, before + 1);
      assert.equal(saved.busy, true); assert.equal(saved.operation, 'read'); assert.equal(saved.error, '');
    } finally { activeTabId = 1; gate.resolve(); await pending; }
    assert.equal((await command('closePanel')).ok, false, 'only the bound page can request sidebar closure');
    await command('read');
  });

  await t.test('unsupported or failed sidebar closure reports an error without corrupting task state', async () => {
    const originalClose = chrome.sidePanel.close;
    const before = structuredClone(saved);
    try {
      delete chrome.sidePanel.close;
      let response = await pageCommand('closePanel');
      assert.equal(response.ok, false); assert.match(response.error, /不支持从页内关闭侧栏/);
      chrome.sidePanel.close = async () => { throw new Error('模拟关闭失败'); };
      response = await pageCommand('closePanel');
      assert.equal(response.ok, false); assert.match(response.error, /模拟关闭失败/);
      assert.deepEqual(saved, before);
    } finally { chrome.sidePanel.close = originalClose; }
  });

  for (const reject of [false, true]) {
    await t.test(`stopped read ${reject ? 'failure' : 'success'} preserves a newer solve`, async () => {
      const gate = deferred(); readGate = gate;
      const pending = command('read');
      await until(() => gate.entered);
      assert.equal((await command('stop')).ok, true);
      const next = await startNextQuestion();
      if (reject) gate.reject(new Error('The old tab was closed')); else gate.resolve();
      assert.equal((await pending).ok, false);
      assertCurrentSolve(next);
      await finish(next);
    });
  }

  await t.test('stopped control injection cannot publish into a newer task', async () => {
    const gate = deferred(); controlsGate = gate;
    const pending = command('enableControls');
    await until(() => gate.entered);
    assert.equal(saved.operation, 'enableControls');
    for (const action of ['pause', 'resume']) {
      const response = await command(action);
      assert.equal(response.ok, false); assert.match(response.error, /读取操作不能暂停，请使用停止任务/);
      assert.equal(saved.paused, false); assert.equal(saved.busy, true);
      assert.equal(saved.operation, 'enableControls');
    }
    await command('stop');
    const next = await startNextQuestion();
    const before = structuredClone(saved.controls);
    gate.resolve();
    assert.equal((await pending).ok, false);
    assertCurrentSolve(next);
    assert.deepEqual(saved.controls, before);
    assert.equal(installedWidgets.has('1:doc'), true, 'late cleanup must preserve the widget reused by the new task');
    await finish(next);
  });

  await t.test('a stopped first injection removes its unregistered widget', async () => {
    activeTabId = 3; documentId = 'unregistered-doc';
    const gate = deferred(); controlsGate = gate;
    const pending = command('enableControls');
    await until(() => gate.entered);
    assert.equal(installedWidgets.has('3:unregistered-doc'), true);
    await command('stop'); gate.resolve();
    assert.equal((await pending).ok, false);
    assert.equal(installedWidgets.has('3:unregistered-doc'), false);
    assert.equal(saved.controls[3], undefined);
    assert.equal(saved.phase, 'stopped');
    activeTabId = 1; documentId = 'doc';
    await command('read');
  });

  await t.test('a delayed question synchronization cannot undo stop', async () => {
    const before = structuredClone(saved.question);
    question = { ...single, questionId: 'old-synchronization' };
    const gate = deferred(); readGate = gate;
    const pending = pageCommand('pageChanged');
    await until(() => gate.entered);
    await command('stop'); gate.resolve();
    assert.equal((await pending).ok, true);
    assert.equal(saved.phase, 'stopped');
    assert.equal(saved.question.questionId, before.questionId);
    assert.equal(saved.error, '');
  });

  await t.test('a stopped navigation synchronization does not restart itself as automatic attachment', async () => {
    activeTabId = 4; documentId = 'navigation-old-doc';
    await command('read');
    question = { ...single, questionId: 'late-navigation-question' }; documentId = 'navigation-new-doc';
    const gate = deferred(); readGate = gate;
    navigated.emit({ tabId: 4 });
    await until(() => gate.entered);
    await command('stop'); gate.resolve();
    await new Promise(setImmediate);
    assert.equal(saved.phase, 'stopped');
    assert.equal(saved.target.documentId, 'navigation-old-doc');
    assert.equal(installedWidgets.has('4:navigation-new-doc'), false);
    activeTabId = 1; documentId = 'doc';
    await command('read');
  });

  await t.test('an idle synchronization cannot replace a later task after it has already completed', async () => {
    question = { ...single, questionId: 'late-old-idle-question' };
    const gate = deferred(); readGate = gate;
    const pending = pageCommand('pageChanged');
    await until(() => gate.entered);
    const next = await startNextQuestion(); await finish(next);
    const before = structuredClone(saved);
    gate.resolve(); assert.equal((await pending).ok, true);
    assert.equal(saved.question.questionId, before.question.questionId);
    assert.deepEqual(saved.answer, before.answer);
    assert.equal(saved.phase, 'ready');
    assert.equal(saved.error, '');
  });

  await t.test('a delayed automatic injection cannot replace the newer document binding and cleans only its old widget', async () => {
    activeTabId = 2; documentId = 'auto-old-doc';
    question = { ...single, questionId: 'old-automatic-question' };
    const gate = deferred(); controlsGate = gate;
    storageChanged.emit({ autoControls: { newValue: true } }, 'local');
    await until(() => gate.entered);
    assert.equal(installedWidgets.has('2:auto-old-doc'), true);
    documentId = 'auto-new-doc';
    const next = await startNextQuestion();
    assert.equal(saved.controls[2].documentId, 'auto-new-doc');
    gate.resolve();
    await until(() => removedWidgets.includes('2:auto-old-doc'));
    assertCurrentSolve(next);
    assert.equal(saved.controls[2].documentId, 'auto-new-doc');
    assert.equal(installedWidgets.has('2:auto-old-doc'), false);
    assert.equal(installedWidgets.has('2:auto-new-doc'), true);
    await finish(next);
    activeTabId = 1; documentId = 'doc';
    await command('read');
  });

  for (const reject of [false, true]) {
    await t.test(`stopped solver initialization ${reject ? 'failure' : 'success'} cannot report an error over a newer task`, async () => {
      const gate = deferred(); consentGate = gate;
      const pending = command('start', { fill: false });
      await until(() => gate.entered);
      await command('stop');
      const next = await startNextQuestion();
      if (reject) gate.reject(new Error('Old initialization failed')); else gate.resolve();
      assert.equal((await pending).ok, false);
      assertCurrentSolve(next);
      await finish(next);
    });
  }
});

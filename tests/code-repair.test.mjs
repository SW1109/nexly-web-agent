import test from 'node:test';
import assert from 'node:assert/strict';
import { codeQuestion, correct } from './data.mjs';
import { LIMITS } from '../extension/lib/contracts.js';
const event = () => { const callbacks = []; return { addListener(fn) { callbacks.push(fn); }, emit(...args) { callbacks.forEach((fn) => fn(...args)); } }; };
const until = async (predicate) => { for (let i = 0; i < 1000; i++) { if (predicate()) return; await new Promise((resolve) => setTimeout(resolve, 5)); } throw new Error('code repair transition timed out'); };
function storage(data) { return { async setAccessLevel() {}, async get(keys) { return Object.fromEntries((Array.isArray(keys) ? keys : [keys]).filter((key) => key in data).map((key) => [key, structuredClone(data[key])])); }, async set(patch) { Object.assign(data, structuredClone(patch)); }, async remove(keys) { for (const key of Array.isArray(keys) ? keys : [keys]) delete data[key]; } }; }
const compileLog = "编译错误\n测试输入\n1 2 3 4 5\n测试输出\nsolution.ts(18,23): error TS2802: Type 'Set<number>' can only be iterated through with target es2015.\n预期输出\n0";

test('CLI and API repair loops respect failure evidence, bounds, manual edits, pause, stop and question changes', async (t) => {
  const commands = event(), connects = event(), nativeMessages = event(), apiMessages = event(), nativeDisconnected = event(), apiDisconnected = event();
  const requests = [], writes = [], executions = [], releases = [], broadcasts = [];
  const local = { dataConsentVersion: 1, provider: 'gemini', count: 2, runAfterFill: true, runInBackground: true, pacing: { answerDelayMs: 0, actionIntervalMs: 0, typingIntervalMs: 0, typewriter: false }, apiConfig: { baseUrl: 'https://relay.example/v1', model: 'repair-model', timeoutSeconds: 180 } };
  const session = { apiCredential: { origin: 'https://relay.example', key: 'sk-private-repair-key' } };
  let question = structuredClone(codeQuestion), code = question.starterCode, binding = 'editor-1', outcomes = [], currentRun = null, nextRun = 0;
  const nativePort = { onMessage: nativeMessages, onDisconnect: nativeDisconnected, postMessage(message) {
    requests.push({ ...message, mode: 'local' });
    if (message.action === 'cancel') queueMicrotask(() => { nativeMessages.emit({ requestId: message.targetId, type: 'error', error: '任务已停止' }); nativeMessages.emit({ requestId: message.requestId, type: 'result', data: { canceled: true } }); });
  } };
  const apiPort = { name: 'nexly-api-runner', sender: { id: 'repair', url: 'chrome-extension://repair/api-runner.html' }, onMessage: apiMessages, onDisconnect: apiDisconnected, postMessage: (message) => requests.push({ ...message, mode: 'api' }) };
  globalThis.chrome = {
    storage: { local: storage(local), session: storage(session), onChanged: event() },
    runtime: { id: 'repair', getURL: (path) => `chrome-extension://repair/${path}`, onMessage: commands, onConnect: connects, getContexts: async () => [], sendMessage: async (data) => broadcasts.push(data), connectNative: () => nativePort },
    offscreen: { createDocument: async () => connects.emit(apiPort) }, permissions: { contains: async () => true },
    tabs: { query: async () => [{ id: 1, url: question.pageUrl }], get: async () => ({ id: 1, active: true, windowId: 1 }), onActivated: event(), sendMessage: async (_id, data) => broadcasts.push(data) },
    windows: { get: async () => ({ focused: true }), onFocusChanged: event() },
    webNavigation: { getAllFrames: async () => [], onCompleted: event() }, commands: { onCommand: event() }, sidePanel: { setPanelBehavior: async () => {} },
    scripting: { async executeScript({ world, target, args }) {
      assert.equal(target.tabId, 1);
      if (world === 'ISOLATED') return [{ documentId: 'doc', result: { ok: true } }];
      assert.ok(args.every((value) => value !== undefined));
      const [action, payload] = args;
      const result = (data) => [{ frameId: 0, documentId: 'doc', result: { ok: true, ...data } }];
      if (action === 'read') return result({ question: { ...question, starterCode: code }, editor: { supported: true, binding }, run: { available: true } });
      if (action === 'fillStep') { assert.equal(payload.questionId, question.questionId); assert.equal(payload.editorBinding, binding); if (payload.expectedCode !== undefined) assert.equal(payload.expectedCode, code); code = payload.answer.code; writes.push(code); return result({ done: true, verified: true, detail: '代码回读通过' }); }
      if (action === 'run') { assert.equal(payload.code, code); executions.push(code); currentRun = { token: `run-${++nextRun}`, code, ...(outcomes.shift() || { outcome: 'passed' }) }; return result({ clicked: true, runToken: currentRun.token }); }
      if (action === 'runStatus') { assert.equal(payload.runToken, currentRun.token); if (currentRun.readError) return result({ ok: false, error: currentRun.readError }); if (currentRun.waitingPolls > 0) { currentRun.waitingPolls--; return result({ loading: true, waitingForEditor: true, fresh: true, stable: true, result: currentRun.result, code: currentRun.code }); } const passed = currentRun.outcome === 'passed'; return result({ loading: false, fresh: true, stable: true, hasDetails: true, summary: passed ? '通过' : '编译错误', result: passed ? '通过\n测试输出\n0\n预期输出\n0' : compileLog, ...currentRun }); }
      if (action === 'releaseRun') { releases.push(payload.runToken); if (currentRun?.token === payload.runToken) currentRun = null; return result({}); }
      throw new Error(`unexpected page action ${action}; must not navigate or submit`);
    } }
  };
  await import('../extension/background.js');
  const command = (action, extra = {}) => new Promise((resolve) => commands.emit({ type: 'command', action, ...extra }, { id: 'repair', url: 'chrome-extension://repair/panel.html' }, resolve));
  const pageChanged = () => new Promise((resolve) => commands.emit({ type: 'command', source: 'page-controls', action: 'pageChanged' }, { id: 'repair', tab: { id: 1 }, frameId: 0, documentId: 'doc' }, resolve));
  const solves = () => requests.filter((entry) => entry.action === 'solve');
  const nextSolve = async (offset) => { await until(() => solves().length > offset); return solves()[offset]; };
  const answer = (request, value, confidence = 1) => (request.mode === 'local' ? nativeMessages : apiMessages).emit({ type: 'result', requestId: request.requestId, data: { answer: { ...correct, questionId: request.question.questionId, type: 'code', choiceIds: [], code: value, confidence } } });
  const reset = async (mode, nextOutcomes) => { await command('stop'); local.connectionMode = mode; question = structuredClone(codeQuestion); code = question.starterCode; binding = 'editor-1'; outcomes = nextOutcomes; };
  const start = async (extra = {}) => { const offset = solves().length; assert.equal((await command('start', extra)).ok, true); return nextSolve(offset); };
  t.after(async () => { await command('stop'); nativeDisconnected.emit(); apiDisconnected.emit(); });

  for (const mode of ['local', 'api']) {
    await t.test(`${mode}: TS2802 feedback is repaired and successful code waits for manual submission`, async () => {
      await reset(mode, [{ outcome: 'failed' }, { outcome: 'passed' }]);
      const before = writes.length, beforeRuns = executions.length;
      const initial = await start(), offset = solves().length;
      answer(initial, 'for (const n of values) {}');
      const repair = await nextSolve(offset);
      assert.equal(repair.mode, mode); assert.equal(repair.question.questionId, initial.question.questionId);
      assert.equal(repair.question.starterCode, initial.question.starterCode);
      assert.deepEqual(repair.question.executionFeedback, { attempt: 1, code: 'for (const n of values) {}', result: compileLog });
      assert.equal(repair.question.language, 'ArkTS');
      answer(repair, 'values.forEach((n) => console.log(n));');
      await until(() => session.taskState.phase === 'awaitingManual');
      assert.equal(writes.length, before + 2); assert.equal(executions.length, beforeRuns + 2);
      assert.equal(session.taskState.completed, 1); assert.equal(session.taskState.error, ''); assert.equal(session.taskState.busy, true);
      assert.equal(currentRun, null); assert.ok(releases.length >= 2);
    });
    await t.test(`${mode}: temporary editor lock delays repair, then sends the exact TS2737 log and executed code`, async () => {
      const log = '编译错误\n测试输入\n1 3\n测试输出\nsolution.ts(12,19): error TS2737: BigInt literals are not available when targeting lower than ES2020.\n预期输出\n123';
      await reset(mode, [{ outcome: 'failed', result: log, waitingPolls: 2 }, { outcome: 'passed' }]);
      const initial = await start(), offset = solves().length, failedCode = 'const value = 1n;';
      answer(initial, failedCode);
      await until(() => session.taskState.log.some((entry) => entry.text.includes('原编辑区恢复')));
      assert.equal(solves().length, offset); assert.equal(code, failedCode); assert.equal(session.taskState.error, '');
      const repair = await nextSolve(offset);
      assert.deepEqual(repair.question.executionFeedback, { attempt: 1, code: failedCode, result: log });
      assert.equal(repair.question.starterCode, initial.question.starterCode);
      answer(repair, 'console.log(1);');
      await until(() => session.taskState.phase === 'awaitingManual');
      assert.equal(code, 'console.log(1);'); assert.equal(session.taskState.error, ''); assert.equal(currentRun, null);
    });
    await t.test(`${mode}: at most two repairs, and only latest feedback is sent`, async () => {
      await reset(mode, Array.from({ length: 3 }, (_item, i) => ({ outcome: 'failed', result: `${compileLog}\nround-${i}` })));
      const initial = await start(); let offset = solves().length; answer(initial, 'broken(0);');
      for (let attempt = 1; attempt <= LIMITS.repairAttempts; attempt++) {
        const repair = await nextSolve(offset); offset = solves().length;
        assert.equal(repair.question.executionFeedback.attempt, attempt);
        assert.equal(repair.question.executionFeedback.code, `broken(${attempt - 1});`);
        assert.ok(repair.question.executionFeedback.result.endsWith(`round-${attempt - 1}`));
        if (attempt > 1) assert.ok(!repair.question.executionFeedback.result.includes(`round-${attempt - 2}`));
        answer(repair, `broken(${attempt});`);
      }
      await until(() => !session.taskState.busy);
      assert.equal(solves().length, offset); assert.match(session.taskState.error, /已自动修正 2 次/);
      assert.equal(session.taskState.completed, 1); assert.equal(currentRun, null);
    });
    for (const scenario of ['same-code', 'low-confidence', 'manual-edit', 'editor-switch', 'stop', 'pause']) {
      await t.test(`${mode}: ${scenario} during repair cannot silently overwrite or repeat code`, async () => {
        await reset(mode, [{ outcome: 'failed' }, { outcome: 'passed' }]);
        const initial = await start(), offset = solves().length;
        answer(initial, 'broken();'); const repair = await nextSolve(offset), before = writes.length, runsBefore = executions.length;
        if (scenario === 'manual-edit') code = 'humanEdit();';
        if (scenario === 'editor-switch') binding = 'editor-2';
        if (scenario === 'stop') await command('stop');
        if (scenario === 'pause') await command('pause');
        answer(repair, scenario === 'same-code' ? 'broken();' : 'fixed();', scenario === 'low-confidence' ? 0.5 : 1);
        if (scenario === 'pause') {
          await until(() => session.taskState.answer?.code === 'fixed();');
          assert.equal(session.taskState.paused, true); assert.equal(writes.length, before);
          await command('resume'); await until(() => session.taskState.phase === 'awaitingManual');
          assert.equal(writes.length, before + 1); return;
        }
        await until(() => !session.taskState.busy); await new Promise((resolve) => setTimeout(resolve, 25));
        assert.equal(writes.length, before); assert.equal(executions.length, runsBefore);
        if (scenario === 'stop') {
          assert.equal(session.taskState.phase, 'stopped');
          assert.ok(requests.some((entry) => entry.type === 'cancel' ? entry.requestId === repair.requestId : entry.action === 'cancel' && entry.targetId === repair.requestId));
        } else assert.match(session.taskState.error, scenario === 'same-code' ? /相同/ : scenario === 'low-confidence' ? /置信度不足/ : /人工更改/);
      });
    }
    await t.test(`${mode}: changing question cancels repair and drops late answers without feedback leaking to new question`, async () => {
      await reset(mode, [{ outcome: 'failed' }, { outcome: 'passed' }]);
      const initial = await start(); let offset = solves().length;
      answer(initial, 'broken();'); const repair = await nextSolve(offset); offset = solves().length;
      const before = writes.length;
      question = { ...codeQuestion, questionId: 'next-code', stem: '编程题：新题目', title: '新题目' }; code = question.starterCode; binding = 'editor-next';
      await pageChanged(); const next = await nextSolve(offset);
      assert.equal(next.question.questionId, 'next-code'); assert.equal(next.question.executionFeedback, undefined);
      answer(repair, 'oldFixed();'); await new Promise((resolve) => setTimeout(resolve, 25)); assert.equal(writes.length, before);
      answer(next, 'newFixed();'); await until(() => session.taskState.phase === 'awaitingManual');
      assert.equal(writes.at(-1), 'newFixed();'); assert.equal(session.taskState.answer.questionId, 'next-code');
    });
    await t.test(`${mode}: side-panel execute uses the same repair loop and releases the solver`, async () => {
      await reset(mode, [{ outcome: 'failed' }, { outcome: 'passed' }]);
      const initial = await start({ run: false }); answer(initial, 'broken();');
      await until(() => session.taskState.phase === 'awaitingManual'); await command('stop');
      const offset = solves().length, before = writes.length;
      const pending = command('run'); const repair = await nextSolve(offset);
      assert.equal(repair.question.executionFeedback.attempt, 1);
      answer(repair, 'fixedByManualRun();'); const result = await pending;
      assert.equal(result.ok, true, result.error); assert.equal(session.taskState.busy, false);
      assert.equal(writes.length, before + 1); assert.equal(currentRun, null);
      assert.match(session.taskState.log.at(-1).text, /请人工提交代码并换题/);
    });
    await t.test(`${mode}: a manual run read failure exits testing and allows a safe retry without rewriting code`, async () => {
      await reset(mode, [{ readError: '执行期间代码已变化，停止自动修正，请人工检查' }, { outcome: 'passed' }]);
      const initial = await start({ run: false }); answer(initial, 'unchanged();');
      await until(() => session.taskState.phase === 'awaitingManual'); await command('stop');
      const offset = solves().length, before = writes.length;
      const failed = await command('run');
      assert.equal(failed.ok, false); assert.equal(session.taskState.busy, false); assert.equal(session.taskState.phase, 'error');
      assert.match(session.taskState.error, /代码已变化/); assert.equal(currentRun, null);
      assert.equal((await command('run')).ok, true); assert.equal(session.taskState.phase, 'filled');
      assert.equal(solves().length, offset); assert.equal(writes.length, before); assert.equal(code, 'unchanged();');
    });
    await t.test(`${mode}: code manually edited during configured repair delay is not overwritten`, async () => {
      await reset(mode, [{ outcome: 'failed' }]);
      const initial = await start({ pacing: { ...local.pacing, answerDelayMs: 200 } }), offset = solves().length;
      answer(initial, 'broken();'); const repair = await nextSolve(offset), before = writes.length;
      answer(repair, 'fixed();'); await until(() => session.taskState.phase === 'delaying'); code = 'humanDuringDelay();';
      await until(() => !session.taskState.busy);
      assert.equal(writes.length, before); assert.equal(code, 'humanDuringDelay();'); assert.match(session.taskState.error, /人工更改/);
    });
    for (const result of [{ outcome: 'unknown', summary: '已执行' }, { outcome: 'failed', hasDetails: false, result: '编译错误' }]) {
      await t.test(`${mode}: unclear outcome or missing detailed log waits on current question without new AI request`, async () => {
        await reset(mode, [result]); const initial = await start(), offset = solves().length;
        answer(initial, 'code();'); await until(() => session.taskState.phase === 'awaitingManual');
        assert.equal(solves().length, offset); assert.equal(session.taskState.error, '');
        assert.ok(session.taskState.log.some((entry) => entry.text.includes('停留当前题等待人工核对')));
      });
    }
  }
  assert.equal(JSON.stringify({ state: session.taskState, broadcasts, local }).includes('sk-private-repair-key'), false);
});

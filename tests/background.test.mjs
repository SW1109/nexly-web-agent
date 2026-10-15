import test from 'node:test';
import assert from 'node:assert/strict';
import { single, correct, codeQuestion } from './data.mjs';

const event = () => { const callbacks = []; return { addListener(fn) { callbacks.push(fn); }, emit(...args) { for (const fn of callbacks) fn(...args); } }; };
const until = async (predicate) => { for (let i = 0; i < 1000; i++) { if (predicate()) return; await new Promise((resolve) => setTimeout(resolve, 10)); } throw new Error('State transition timed out'); };

test('background workflow uses JSON-safe Gemini injections and verifies freshness, pause, cancel and confidence gates', async (t) => {
  let saved = null, question = structuredClone(single), active = true, focused = true, frameFocused = true, writes = 0, fillResponder = null;
  const shortcut = event(), navigated = event(), storageChanged = event();
  const localSettings = {}, appearanceMessages = [];
  let navigationQuestion = null, navigationClicks = 0, editorReadyAt = 0, navigationEditorDelay = 0, hiddenFrame = false;
  const outbound = [], commands = event(), messages = event(), disconnected = event(), activated = event(), focus = event();
  const port = { onMessage: messages, onDisconnect: disconnected, postMessage(message) { outbound.push(message); if (message.action === 'cancel') queueMicrotask(() => { messages.emit({ requestId: message.targetId, type: 'error', error: '任务已停止' }); messages.emit({ requestId: message.requestId, type: 'result', data: { canceled: true } }); }); } };
  globalThis.chrome = {
    storage: { onChanged: storageChanged, local: { set: async (patch) => { Object.assign(localSettings, patch); }, get: async () => ({ ...localSettings, provider: 'gemini', count: 1, runAfterFill: false, runInBackground: false, pacing: { answerDelayMs: 0, actionIntervalMs: 0, typingIntervalMs: 0, typewriter: false } }) }, session: { get: async () => ({}), set: async ({ taskState }) => { saved = structuredClone(taskState); } } },
    runtime: { id: 'test', getURL: (path) => `chrome-extension://test/${path}`, onMessage: commands, sendMessage: async () => {}, connectNative: () => port },
    tabs: { query: async () => [{ id: 1, url: single.pageUrl }], get: async () => ({ id: 1, windowId: 1, active }), onActivated: activated, sendMessage: async (_tabId, message) => { if (message.type === 'page-appearance') { appearanceMessages.push(message); return; } assert.equal(message.type, 'page-state'); assert.equal(message.state.question, undefined); assert.equal(message.state.answer, undefined); } },
    windows: { get: async () => ({ focused }), onFocusChanged: focus },
    commands: { onCommand: shortcut },
    webNavigation: { onCompleted: navigated, getAllFrames: async () => [{ frameId: 0, parentFrameId: -1 }, { frameId: 4, parentFrameId: 0, url: single.pageUrl }, { frameId: 7, parentFrameId: 0, url: single.pageUrl + '?cached' }] },
    sidePanel: { setPanelBehavior: async () => {} },
    scripting: { executeScript: async ({ args, world, target }) => {
      assert.equal(target.tabId, 1, 'must stay bound to the original exercise tab');
      if (world === 'ISOLATED') return [{ documentId: 'fixture-document', result: { ok: true } }];
      // Chrome 在注入前拒绝 undefined；旧 mock 直接解构，掩盖了真实浏览器的参数错误。
      for (const [index, value] of args.entries()) {
        if (value === undefined) throw new TypeError(`Error at property 'args': Error at index ${index}: Value is unserializable.`);
      }
      const [action, payload] = JSON.parse(JSON.stringify(args));
      if (action === 'find') return [{ result: { ok: true, candidates: navigationQuestion && target.frameIds?.[0] === 0 ? [{ key: 'random', label: '随机一题', rank: 1, random: true, disabled: false }] : [] } }];
      if (action === 'click') { assert.equal(target.frameIds[0], 0); question = structuredClone(navigationQuestion); navigationQuestion = null; navigationClicks++; editorReadyAt = Date.now() + navigationEditorDelay; return [{ result: { ok: true, clicked: true, navigationLabel: '随机一题', random: true } }]; }
      if (action === 'focusState') return [{ result: { ok: true, visible: true, focused: frameFocused } }];
      if (action === 'read') {
        const result = { frameId: 4, result: { ok: true, question: structuredClone(question), editor: { supported: Date.now() >= editorReadyAt, error: Date.now() < editorReadyAt ? '编辑器正在初始化' : '' }, visible: true } };
        if (hiddenFrame && target.allFrames) return [result,
          { frameId: 0, result: { ok: false, frame: { shown: true, children: [{ url: single.pageUrl, shown: true }, { url: single.pageUrl + '?cached', shown: false }] } } },
          { frameId: 7, result: { ...result.result, question: { ...single, questionId: 'hidden-old-question' }, frame: { shown: true, url: single.pageUrl + '?cached', children: [] } } }];
        return [result];
      }
      if (action === 'fillStep') { assert.equal(payload.questionId, question.questionId); if (fillResponder) return fillResponder(payload); writes++; return [{ result: { ok: true, verified: true, done: true, detail: '回读通过' } }]; }
      if (action === 'run') return [{ result: { ok: true, clicked: true, previousResult: '' } }];
      if (action === 'runStatus') return [{ result: { ok: true, loading: false, result: '通过 测试输出 FALSE 预期输出 FALSE' } }];
      throw new Error(`Unexpected page action: ${action}`);
    } }
  };
  await import('../extension/background.js');
  const command = (action, data = {}) => new Promise((resolve) => commands.emit({ type: 'command', action, ...data }, { id: 'test', url: 'chrome-extension://test/panel.html' }, resolve));
  t.after(async () => { await command('stop'); disconnected.emit(); });
  const nextSolve = async (after) => { await until(() => outbound.slice(after).some((item) => item.action === 'solve')); return outbound.slice(after).find((item) => item.action === 'solve'); };
  const answer = (request, overrides = {}) => messages.emit({ requestId: request.requestId, type: 'result', data: { answer: { ...correct, questionId: request.question.questionId, ...overrides } } });

  assert.equal((await command('start', { provider: 'gemini', fill: 'false' })).ok, false);
  assert.equal(outbound.length, 0);
  assert.equal((await command('read')).ok, true);
  let offset = outbound.length;
  await command('start', { provider: 'gemini' });
  let request = await nextSolve(offset);
  answer(request);
  await until(() => !saved.busy);
  assert.equal(saved.phase, 'filled', saved.error);
  assert.equal(saved.answer.confidence, 1);
  assert.equal(saved.autoFill, true);
  assert.equal(writes, 1);

  offset = outbound.length;
  await command('start', { provider: 'gemini', fill: false, count: 3 }); request = await nextSolve(offset);
  answer(request);
  await until(() => !saved.busy);
  assert.equal(saved.phase, 'ready'); assert.equal(saved.autoFill, false);
  assert.equal(writes, 1); assert.match(saved.log.at(-1).text, /仅预览模式/);
  writes = 0;

  for (const cause of ['tab', 'window', 'frame']) {
    offset = outbound.length;
    await command('start', { provider: 'gemini' }); request = await nextSolve(offset);
    if (cause === 'tab') { active = false; activated.emit({ tabId: 2 }); }
    else if (cause === 'window') { focused = false; focus.emit(-1); }
    else frameFocused = false;
    answer(request);
    await until(() => saved.paused && saved.answer);
    assert.equal(saved.pauseReason, 'inactive'); assert.equal(writes, 0);
    if (cause === 'tab') { active = true; activated.emit({ tabId: 1 }); }
    else if (cause === 'window') { focused = true; focus.emit(1); }
    else frameFocused = true;
    await until(() => !saved.busy);
    assert.equal(saved.phase, 'filled', saved.error);
    assert.equal(saved.paused, false); assert.equal(saved.pauseReason, null); assert.equal(writes, 1);
    writes = 0;
  }

  offset = outbound.length;
  await command('start', { provider: 'codex', fill: true });
  request = await nextSolve(offset);
  question = { ...single, questionId: 'changed-while-solving', stem: '单选题：新题目' };
  const afterOldRequest = outbound.length;
  answer(request);
  request = await nextSolve(afterOldRequest);
  assert.equal(request.question.questionId, question.questionId); assert.equal(writes, 0); assert.equal(saved.answer, null);
  answer(request); await until(() => !saved.busy);
  assert.equal(saved.phase, 'filled'); assert.equal(saved.answer.questionId, question.questionId);
  writes = 0;

  question = structuredClone(single); offset = outbound.length;
  await command('start', { provider: 'codex', fill: true }); request = await nextSolve(offset);
  answer(request, { confidence: 0.5 });
  await until(() => !saved.busy);
  assert.equal(writes, 0); assert.equal(saved.phase, 'ready');
  assert.equal((await command('fill')).ok, true); assert.equal(writes, 1);

  offset = outbound.length;
  await command('start', { provider: 'codex', fill: true }); request = await nextSolve(offset);
  await command('pause'); answer(request);
  await until(() => saved?.answer != null);
  activated.emit({ tabId: 1 }); focus.emit(1);
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.equal(saved.pauseReason, 'manual');
  assert.equal(saved.paused, true); assert.equal(writes, 1);
  await command('resume');
  await until(() => !saved.busy);
  assert.equal(writes, 2);

  offset = outbound.length;
  await command('start', { provider: 'codex', fill: true }); request = await nextSolve(offset);
  await command('stop'); answer(request);
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.equal(writes, 2); assert.equal(saved.phase, 'stopped'); assert.equal(saved.busy, false);
  assert.ok(outbound.some((message) => message.action === 'cancel' && message.targetId === request.requestId));

  question = structuredClone(codeQuestion); offset = outbound.length;
  await command('start', { provider: 'gemini', fill: true, run: true }); request = await nextSolve(offset);
  answer(request, { questionId: codeQuestion.questionId, type: 'code', choiceIds: [], code: 'console.log("FALSE");', explanation: '测试代码' });
  await until(() => saved.phase === 'awaitingManual');
  assert.equal(saved.busy, true); assert.equal(writes, 3);
  assert.ok(saved.log.some((entry) => entry.text.includes('页面执行结果：通过')));
  await command('stop');

  // 延迟阶段也必须响应停止，不得在等待结束后补写答案。
  question = structuredClone(single); offset = outbound.length;
  const beforeDelay = writes;
  await command('start', { provider: 'gemini', pacing: { answerDelayMs: 150, actionIntervalMs: 0, typingIntervalMs: 0, typewriter: false } }); request = await nextSolve(offset);
  answer(request); await until(() => saved.phase === 'delaying');
  await command('stop'); await new Promise((resolve) => setTimeout(resolve, 180));
  assert.equal(writes, beforeDelay); assert.equal(saved.phase, 'stopped');

  // 模拟一小段输入尚在执行时暂停；片段返回后不得启动下一段。
  let releaseFragment, steps = 0;
  fillResponder = () => { steps++; return steps === 1 ? new Promise((resolve) => { releaseFragment = resolve; }) : Promise.resolve([{ result: { ok: true, done: true, verified: true, detail: '分段输入已完成' } }]); };
  question = structuredClone(codeQuestion); offset = outbound.length;
  await command('start', { provider: 'gemini' }); request = await nextSolve(offset);
  answer(request, { questionId: codeQuestion.questionId, type: 'code', choiceIds: [], code: 'console.log("FALSE");' });
  await until(() => !!releaseFragment); await command('pause');
  releaseFragment([{ result: { ok: true, done: false, progress: { started: true, offset: 3, fieldIndex: 0, step: 1 }, written: 3, total: 21, nextAction: false } }]);
  await new Promise((resolve) => setTimeout(resolve, 80)); assert.equal(steps, 1);
  await command('resume'); await until(() => saved.phase === 'awaitingManual'); assert.equal(steps, 2); await command('stop');

  releaseFragment = null; steps = 0;
  question = structuredClone(codeQuestion); offset = outbound.length;
  await command('start', { provider: 'gemini' }); request = await nextSolve(offset);
  answer(request, { questionId: codeQuestion.questionId, type: 'code', choiceIds: [], code: 'console.log("FALSE");' });
  await until(() => !!releaseFragment); await command('stop');
  releaseFragment([{ result: { ok: true, done: false, progress: { started: true, offset: 3, fieldIndex: 0, step: 1 }, nextAction: false } }]);
  await new Promise((resolve) => setTimeout(resolve, 80)); assert.equal(steps, 1); assert.equal(saved.phase, 'stopped');
  fillResponder = null;

  const pageCommand = (action, sender = {}, extra = {}) => new Promise((resolve) => commands.emit({ type: 'command', source: 'page-controls', action, ...extra }, { id: 'test', tab: { id: 1 }, frameId: 4, documentId: 'fixture-document', ...sender }, resolve));
  const pageState = await pageCommand('state'); assert.equal(pageState.ok, true); assert.equal(pageState.data.question, undefined); assert.equal(pageState.data.answer, undefined);
  assert.equal((await pageCommand('state', { documentId: 'stale-document' })).ok, false);
  assert.equal((await pageCommand('state', { frameId: 8 })).ok, false);
  assert.equal((await pageCommand('state', { tab: { id: 2 } })).ok, false);
  assert.equal((await pageCommand('moveControls', { documentId: 'stale-document' }, { position: { x: 0, y: 0 } })).ok, false);
  assert.equal((await pageCommand('moveControls', {}, { position: { x: 2, y: 0 } })).ok, false);
  assert.equal((await pageCommand('moveControls', {}, { position: { x: 0, y: 0, provider: 'claude' } })).ok, false);
  assert.equal((await pageCommand('moveControls', {}, { position: { x: 0.25, y: 0.75 }, provider: 'claude' })).ok, true);
  assert.deepEqual(localSettings, { controlsPosition: { x: 0.25, y: 0.75 } });
  storageChanged.emit({ controlsAppearance: { newValue: { opacity: 60 } } }, 'local');
  await until(() => appearanceMessages.length === 1);
  assert.deepEqual(appearanceMessages[0], { type: 'page-appearance', appearance: { opacity: 60 } });
  question = structuredClone(single); offset = outbound.length;
  assert.equal((await pageCommand('start', {}, { provider: 'arbitrary-executable', pacing: { actionIntervalMs: -1 } })).ok, true);
  request = await nextSolve(offset); assert.equal(request.provider, 'gemini'); answer(request); await until(() => !saved.busy);

  // 快捷键使用已保存配置，在同一页面切换开始 / 暂停 / 继续。
  offset = outbound.length; shortcut.emit('nexly-toggle-task'); request = await nextSolve(offset);
  shortcut.emit('nexly-toggle-task'); await until(() => saved.paused);
  answer(request); await until(() => !!saved.answer); assert.equal(saved.pauseReason, 'manual');
  shortcut.emit('nexly-toggle-task'); await until(() => !saved.busy); assert.equal(saved.phase, 'filled');

  // 允许后台时不因切换标签/窗口/iframe 焦点而停住，仍写入原 tabId。
  question = structuredClone(single); offset = outbound.length;
  const beforeBackground = writes;
  await command('start', { provider: 'gemini', runInBackground: true }); request = await nextSolve(offset);
  active = false; focused = false; frameFocused = false; activated.emit({ tabId: 2 }); focus.emit(-1);
  answer(request); await until(() => !saved.busy);
  assert.equal(saved.phase, 'filled', saved.error); assert.equal(saved.paused, false); assert.equal(writes, beforeBackground + 1);
  active = true; focused = true; frameFocused = true;

  // DOM 变更通知自动同步新题、取消旧请求，不允许旧答案回写。
  question = structuredClone(single); offset = outbound.length;
  await command('start', { provider: 'gemini' }); const oldRequest = await nextSolve(offset);
  const nextOffset = outbound.length, beforeChange = writes;
  question = { ...single, questionId: 'observer-new-question', title: '新题', stem: '单选题：现在显示的新题目' };
  assert.equal((await pageCommand('pageChanged')).ok, true);
  request = await nextSolve(nextOffset);
  assert.equal(request.question.questionId, question.questionId); assert.equal(saved.answer, null);
  assert.ok(outbound.some(message => message.action === 'cancel' && message.targetId === oldRequest.requestId));
  answer(oldRequest); assert.equal(writes, beforeChange);
  answer(request); await until(() => !saved.busy); assert.equal(saved.phase, 'filled');

  // 空闲时跟随题目，但不自动产生新的模型请求。
  const idleRequests = outbound.filter(message => message.action === 'solve').length;
  question = { ...single, questionId: 'idle-new-question', stem: '单选题：另一道新题' };
  await pageCommand('pageChanged'); assert.equal(saved.question.questionId, question.questionId); assert.equal(saved.answer, null);
  assert.equal(outbound.filter(message => message.action === 'solve').length, idleRequests);

  // 当前 frame 找不到按钮时，能在父 frame 的独立工具栏点击“随机一题”。
  question = structuredClone(single); navigationQuestion = { ...single, questionId: 'random-next', title: '随机题', stem: '单选题：随机得到的新题' };
  offset = outbound.length; const beforeBatch = writes;
  await command('start', { provider: 'gemini', count: 2 }); request = await nextSolve(offset);
  const secondOffset = outbound.length; answer(request);
  request = await nextSolve(secondOffset); assert.equal(navigationClicks, 1); assert.equal(request.question.questionId, 'random-next');
  answer(request); await until(() => !saved.busy); assert.equal(saved.completed, 2); assert.equal(writes, beforeBatch + 2);

  // 父级隐藏的旧 iframe 仍会报告 document visible，不能误认为另一道活动题。
  hiddenFrame = true; question = structuredClone(single);
  assert.equal((await command('read')).ok, true); assert.equal(saved.question.questionId, single.questionId); hiddenFrame = false;

  // 编辑器挂载超过旧版 4.5 秒窗口：只点一次换题，挂载稳定之前不调用下一题 CLI。
  navigationEditorDelay = 5000; question = structuredClone(single); navigationQuestion = structuredClone(codeQuestion);
  offset = outbound.length; const beforeSlowNavigation = navigationClicks;
  await command('start', { provider: 'gemini', count: 2 }); request = await nextSolve(offset);
  const slowOffset = outbound.length; answer(request);
  await until(() => navigationClicks === beforeSlowNavigation + 1);
  await new Promise((resolve) => setTimeout(resolve, 4600));
  assert.equal(outbound.slice(slowOffset).some((entry) => entry.action === 'solve'), false, '不能在编辑器初始化前求解下一题');
  assert.equal(navigationClicks, beforeSlowNavigation + 1, '加载期间不能重复点击换题');
  request = await nextSolve(slowOffset); assert.equal(request.question.questionId, codeQuestion.questionId);
  answer(request, { type: 'code', choiceIds: [], code: 'console.log("FALSE");' });
  await until(() => saved.phase === 'awaitingManual'); assert.equal(saved.completed, 2);
  navigationEditorDelay = 0;
  const waitingOffset = outbound.length, waitingClicks = navigationClicks;
  await new Promise((resolve) => setTimeout(resolve, 600));
  assert.equal(navigationClicks, waitingClicks); assert.equal(outbound.slice(waitingOffset).some((entry) => entry.action === 'solve'), false);
  // 人工暂停优先：即使用户已经手动换题，也要明确继续后才求解。
  await command('pause');
  question = { ...codeQuestion, questionId: 'manual-code-next', title: '人工换入的新编程题' };
  await pageCommand('pageChanged');
  await new Promise((resolve) => setTimeout(resolve, 200));
  assert.equal(outbound.slice(waitingOffset).some((entry) => entry.action === 'solve'), false);
  await command('resume'); request = await nextSolve(waitingOffset);
  assert.equal(request.question.questionId, 'manual-code-next');
  answer(request, { type: 'code', choiceIds: [], code: 'console.log("next");' });
  await until(() => saved.phase === 'awaitingManual'); assert.equal(navigationClicks, waitingClicks);
  // 没有手动暂停时，只需人工换题，不需要再点侧栏开始。
  const followOffset = outbound.length;
  question = { ...codeQuestion, questionId: 'manual-code-follow', title: '再次人工换入编程题' }; await pageCommand('pageChanged');
  request = await nextSolve(followOffset); assert.equal(request.question.questionId, 'manual-code-follow');
  answer(request, { type: 'code', choiceIds: [], code: 'console.log("follow");' });
  await until(() => saved.phase === 'awaitingManual'); assert.equal(navigationClicks, waitingClicks);
  // 停止后人工再换题只更新识别，不继续调用 CLI。
  await command('stop'); const stoppedOffset = outbound.length;
  question = { ...codeQuestion, questionId: 'manual-after-stop' }; await pageCommand('pageChanged');
  await new Promise((resolve) => setTimeout(resolve, 100));
  assert.equal(outbound.slice(stoppedOffset).some((entry) => entry.action === 'solve'), false);

  let rejectedSenderReplied = false;
  commands.emit({ type: 'command', action: 'start', provider: 'codex' }, { id: 'test', url: 'https://example.com', tab: { id: 1 } }, () => { rejectedSenderReplied = true; });
  assert.equal(rejectedSenderReplied, false);
});

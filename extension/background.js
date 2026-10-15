import { PROVIDERS, validateQuestion, validateAnswer } from './lib/contracts.js';
import { pageAction } from './lib/page.js';
import { nativeRequest, cancelNative } from './lib/native.js';
import { validatePacing } from './lib/pacing.js';
import { installPageControls } from './lib/page-controls.js';
import { navigationAction } from './lib/navigation.js';
import { DEFAULT_APPEARANCE, DEFAULT_POSITION, validateAppearance, validatePosition } from './lib/appearance.js';

const emptyState = () => ({ phase: 'idle', busy: false, paused: false, pauseReason: null, autoFill: true, runInBackground: true, question: null, answer: null, target: null, editor: null, controls: {}, typingProgress: null, log: [], error: '', completed: 0, provider: 'codex', elapsedSeconds: 0 });
let state = emptyState(), controller = null;
const hydrated = chrome.storage.session.get('taskState').then(({ taskState }) => {
  if (taskState) state = { ...emptyState(), ...taskState, busy: false, paused: false, pauseReason: null, phase: taskState.busy ? 'interrupted' : taskState.phase, error: taskState.busy ? '浏览器后台曾重启，任务已停止。请重新读取或求解。' : taskState.error };
});
async function publish(patch = {}, message = '') {
  state = { ...state, ...patch };
  if (message) state.log = [...state.log.slice(-59), { time: Date.now(), text: message }];
  await chrome.storage.session.set({ taskState: state });
  void chrome.runtime.sendMessage({ type: 'state', state }).catch(() => {});
  for (const target of Object.values(state.controls)) {
    void chrome.tabs.sendMessage(target.tabId, { type: 'page-state', state: publicPageState(target) }, target.documentId ? { documentId: target.documentId } : { frameId: target.frameId }).catch(() => {});
  }
}
function publicPageState(target) {
  if (state.target?.tabId !== target.tabId || state.target?.frameId !== target.frameId) return { phase: 'idle', busy: false, paused: false, completed: 0, error: '', typingProgress: null };
  const { phase, busy, paused, completed, error, typingProgress, runInBackground } = state;
  return { phase, busy, paused, completed, error, typingProgress, runInBackground, questionTitle: state.question?.title || '' };
}
async function preferences(overrides = {}) {
  const saved = await chrome.storage.local.get(['provider', 'count', 'runAfterFill', 'pacing', 'runInBackground']);
  const provider = overrides.provider ?? saved.provider ?? 'codex';
  const count = Number(overrides.count ?? saved.count ?? 1), run = overrides.run ?? saved.runAfterFill ?? false;
  if (!PROVIDERS.includes(provider)) throw new Error('请选择受支持的本地 CLI');
  if (!Number.isInteger(count) || count < 1 || count > 20) throw new Error('每批题数应为 1～20');
  if (typeof run !== 'boolean') throw new Error('执行样例选项必须为 true 或 false');
  const runInBackground = overrides.runInBackground ?? saved.runInBackground ?? true;
  if (typeof runInBackground !== 'boolean') throw new Error('后台运行选项必须为 true 或 false');
  const pacing = validatePacing(overrides.pacing === undefined ? saved.pacing : overrides.pacing);
  return { provider, count, run, pacing, runInBackground };
}
async function attachControls(target) {
  const saved = await chrome.storage.local.get(['controlsAppearance', 'controlsPosition']);
  let appearance = DEFAULT_APPEARANCE, position = DEFAULT_POSITION;
  // 外观配置损坏不能阻断读取题目；位置独立存储，保存透明度不会覆盖刚拖动的位置。
  try { appearance = validateAppearance(saved.controlsAppearance); } catch {}
  try { position = validatePosition(saved.controlsPosition); } catch {}
  const [result] = await chrome.scripting.executeScript({ target: { tabId: target.tabId, frameIds: [target.frameId] }, world: 'ISOLATED', func: installPageControls, args: [publicPageState(target), appearance, position] });
  if (!result?.result?.ok) throw new Error('页内控制面板未能安装');
  const binding = { ...target, documentId: result.documentId || target.documentId || null };
  await publish({ controls: { ...state.controls, [target.tabId]: binding } });
}
async function frameFocused(task) {
  if (!task.target) return true;
  const focus = await act(task.target, 'focusState');
  return focus.visible && focus.focused;
}
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
function assertCurrent(task) {
  if (!task || controller !== task || task.stopped) throw new Error('任务已停止');
  if (task.pendingSnapshot) throw Object.assign(new Error('题目已变化，切换到新题'), { code: 'QUESTION_CHANGED' });
}
async function pauseTask(task, reason) {
  if (controller !== task || task.stopped || (task.pauseReason === 'manual' && reason !== 'manual')) return;
  if (task.paused && task.pauseReason === reason) return;
  if (!task.paused) task.resumePhase = state.phase;
  task.paused = true; task.pauseReason = reason;
  await publish({ paused: true, pauseReason: reason, phase: 'paused' }, reason === 'manual'
    ? '已手动暂停，点击“继续”后才会填写。'
    : '练习页不在前台，暂缓填写；回到原练习页后自动继续。');
}
async function resumeTask(task, manual = false) {
  // 换题快照正在交接时也接受“继续”，随后由主循环停止旧题并恢复新题。
  if (!task || controller !== task || task.stopped) throw new Error('任务已停止');
  if (!task.paused) return true;
  if (!manual && task.pauseReason !== 'inactive') return false;
  const tab = await chrome.tabs.get(task.tabId), win = await chrome.windows.get(tab.windowId);
  if (controller !== task || task.stopped) throw new Error('任务已停止');
  // 检查前台状态期间可能收到手动暂停，自动恢复不能覆盖它。
  if (!task.paused) return true;
  if (!manual && task.pauseReason !== 'inactive') return false;
  if (!task.runInBackground && (!tab.active || !win.focused || !await frameFocused(task))) {
    if (manual) {
      task.pauseReason = 'inactive';
      await publish({ paused: true, pauseReason: 'inactive', phase: 'paused' }, '继续请求已接收，回到原题目页面后自动继续，无需再次点击侧栏。');
      return false;
    }
    return false;
  }
  task.paused = false; task.pauseReason = null;
  await publish({ paused: false, pauseReason: null, phase: task.pendingSnapshot ? 'reading' : task.nativeId ? 'solving' : task.resumePhase || 'ready' }, manual ? '继续当前任务。' : '已回到原练习页，自动继续。');
  return true;
}
async function gate(task) {
  assertCurrent(task);
  const tab = await chrome.tabs.get(task.tabId);
  if (tab.discarded) throw new Error('练习标签被浏览器休眠，请打开该标签后重新开始');
  const windowInfo = await chrome.windows.get(tab.windowId);
  if (!task.runInBackground && (!tab.active || !windowInfo.focused || !await frameFocused(task))) {
    await pauseTask(task, 'inactive');
  }
  while (task.paused) {
    if (task.pauseReason === 'inactive') await resumeTask(task);
    if (task.paused) await sleep(250);
    assertCurrent(task);
  }
  assertCurrent(task);
}
async function pacedWait(task, milliseconds) {
  let remaining = milliseconds;
  while (remaining > 0) {
    await gate(task);
    const chunk = Math.min(remaining, 200);
    await sleep(chunk); remaining -= chunk;
  }
  await gate(task);
}
async function activeTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id || !/^https?:\/\//.test(tab.url || '')) throw new Error('请先打开普通网页中的练习题，再点击扩展');
  return tab;
}
async function scan(tabId) {
  let results;
  try { results = await chrome.scripting.executeScript({ target: { tabId, allFrames: true }, world: 'MAIN', func: pageAction, args: ['read'] }); }
  catch { throw new Error('暂时无法读取页面。请点击“授权当前练习站点”，并保持练习页打开。'); }
  const frameResults = new Map(results.map((item) => [item.frameId, item.result?.frame]));
  const frames = [...frameResults.values()].some((frame) => frame?.children?.length) ? await chrome.webNavigation.getAllFrames({ tabId }) : [];
  const displayed = (frameId, seen = new Set()) => {
    if (seen.has(frameId)) return false;
    seen.add(frameId);
    const own = frameResults.get(frameId);
    if (own?.shown === false) return false;
    const frame = frames?.find((item) => item.frameId === frameId);
    if (!frame || frame.parentFrameId < 0) return true;
    const parent = frameResults.get(frame.parentFrameId);
    const matches = parent?.children?.filter((child) => child.url === frame.url || child.url === own?.url) || [];
    // 子 frame 的 document.visibilityState 无法反映父级标签是否隐藏，必须核对宿主 iframe。
    if (matches.length && matches.every((child) => !child.shown)) return false;
    return displayed(frame.parentFrameId, seen);
  };
  const candidates = results.filter((item) => item.result?.ok && displayed(item.frameId));
  if (candidates.length > 1) throw new Error('多个活动 frame 同时包含题目，等待页面完成题目切换');
  if (!candidates.length) throw new Error('未读到完整题目。可能是跨域 frame 未授权、页面未加载或首版尚不支持该结构。');
  const match = candidates[0];
  const question = validateQuestion(match.result.question);
  return { question, editor: match.result.editor, target: { tabId, frameId: match.frameId, documentId: match.documentId || null } };
}
async function readySnapshot(task, { afterId = null, requireEditor = true } = {}) {
  const deadline = Date.now() + 30000;
  let signature = '', stableSince = 0, lastError = '等待完整题目', announced = false;
  while (Date.now() < deadline) {
    await gate(task);
    let snapshot = null;
    try { snapshot = await scan(task.tabId); } catch (error) { lastError = error.message; }
    assertCurrent(task);
    if (snapshot && snapshot.question.questionId !== afterId && (!requireEditor || snapshot.question.type !== 'code' || snapshot.editor?.supported)) {
      const key = JSON.stringify([snapshot.question.questionId, snapshot.target, snapshot.editor?.binding, snapshot.question.starterCode]);
      if (key !== signature) { signature = key; stableSince = Date.now(); }
      // 题干先出现、编辑器/模板后挂载很常见；空白模板本身合法，按实例和内容稳定性判断。
      if ((!afterId && snapshot.question.type !== 'code') || Date.now() - stableSince >= 600) return snapshot;
    } else {
      signature = ''; stableSince = 0;
      if (snapshot?.editor?.error) lastError = snapshot.editor.error;
      else if (snapshot?.question.questionId === afterId) lastError = '换题后仍显示原题';
    }
    if (!announced) { announced = true; await publish({ phase: 'waiting' }, '等待题目、活动编辑器和代码模板加载稳定，最多 30 秒…'); }
    await sleep(200);
  }
  throw Object.assign(new Error(`页面加载未完成：${lastError}。未重复点击换题，也未创建或清空编辑器。`), { code: 'PAGE_NOT_READY' });
}
// 无数据的只读复查也传入空对象，避免 args 中的 undefined 被 Chrome 拒绝。
async function act(target, action, payload = {}) {
  const [result] = await chrome.scripting.executeScript({ target: { tabId: target.tabId, ...(target.documentId ? { documentIds: [target.documentId] } : { frameIds: [target.frameId] }) }, world: 'MAIN', func: pageAction, args: [action, payload] });
  if (!result?.result?.ok) throw new Error(result?.result?.error || '页面没有返回可验证的操作结果');
  return result.result;
}
async function ensureSame(target, questionId) {
  const current = await act(target, 'read');
  if (current.question.questionId !== questionId) throw Object.assign(new Error('题目已变化，切换到新题'), { code: 'QUESTION_CHANGED' });
}
async function fillCurrent(task) {
  if (task) await gate(task);
  const { target, question, answer } = state;
  if (!target || !question || !answer) throw new Error('请先读取题目并完成求解');
  validateAnswer(answer, question);
  await ensureSame(target, question.questionId);
  if (task) assertCurrent(task);
  await publish({ phase: 'applying' }, '正在写入答案并回读校验…');
  let progress = { started: false, offset: 0, fieldIndex: 0, step: 0 }, nextAction = true, lastUpdate = 0;
  const deadline = Date.now() + 60000;
  while (true) {
    await gate(task);
    if (nextAction) await pacedWait(task, task.pacing.actionIntervalMs);
    const result = await act(target, 'fillStep', { questionId: question.questionId, editorBinding: state.editor?.binding || null, answer, progress, pacing: task.pacing, allowBackground: task.runInBackground });
    assertCurrent(task);
    if (result.waitingForFocus && !result.done) {
      // 保留本片段已经输入的进度，回到原页面后从当前位置继续。
      if (result.progress) progress = result.progress;
      await pauseTask(task, 'inactive'); await gate(task); continue;
    }
    if (result.waiting) {
      if (Date.now() > deadline) throw new Error('等待答案区域开放操作超时，未强行修改禁用状态');
      await pacedWait(task, 500); continue;
    }
    if (result.done) { await publish({ phase: 'filled', typingProgress: null }, result.detail); break; }
    if (!result.progress || JSON.stringify(result.progress) === JSON.stringify(progress)) throw new Error('输入进度未变化，已停止，避免重复操作');
    progress = result.progress; nextAction = result.nextAction === true;
    if (Date.now() - lastUpdate >= 250 && Number.isFinite(result.written)) {
      lastUpdate = Date.now();
      await publish({ typingProgress: { written: result.written, total: result.total } });
    }
  }
}
async function runSamples(task) {
  const { question, target, answer } = state;
  if (question?.type !== 'code' || !answer) throw new Error('只有已写入的编程题可以执行样例');
  await ensureSame(target, question.questionId);
  const deadline = Date.now() + 60000;
  let run;
  do {
    if (task) await gate(task);
    await pacedWait(task, task.pacing.actionIntervalMs);
    run = await act(target, 'run', { questionId: question.questionId, editorBinding: state.editor?.binding || null, code: answer.code, allowBackground: task.runInBackground });
    if (run.waiting) { await publish({ phase: 'waiting' }, '平台暂不允许执行，正在等待按钮恢复…'); await sleep(1000); }
  } while (run.waiting && Date.now() < deadline);
  if (run.waiting) throw new Error('等待执行按钮超时，未跳过平台等待限制');
  await publish({ phase: 'testing' }, '已点击执行代码，等待页面结果；未提交答案。');
  let sawLoading = false;
  while (Date.now() < deadline) {
    await sleep(500);
    if (task) await gate(task);
    const result = await act(target, 'runStatus', { questionId: question.questionId, allowBackground: task.runInBackground });
    sawLoading ||= result.loading;
    if (!result.loading && result.result && (result.result !== run.previousResult || sawLoading)) {
      await publish({ phase: 'filled' }, `页面执行结果：${result.result}`);
      return result;
    }
  }
  throw new Error('未能确认本次执行的新结果，请在网页控制台查看；没有将旧结果当成本次成功');
}
let synchronizing = false;
async function synchronizeQuestion(tabId) {
  if (state.target?.tabId !== tabId) return true;
  if (synchronizing) return false;
  const capturedTask = controller;
  if (capturedTask?.navigating || (capturedTask && !capturedTask.currentQuestionId)) return true;
  synchronizing = true;
  try {
    const snapshot = await scan(tabId);
    if (controller && controller !== capturedTask) return;
    if (state.target?.tabId !== tabId) return;
    const changed = snapshot.question.questionId !== state.question?.questionId || snapshot.target.frameId !== state.target.frameId || snapshot.target.documentId !== state.target.documentId;
    if (!changed) return true;
    const task = controller?.tabId === tabId ? controller : null;
    if (task && !task.navigating) {
      task.pendingSnapshot = snapshot;
      if (task.nativeId && !task.cancelWait) task.cancelWait = cancelNative(task.nativeId).catch(() => {});
    }
    await publish({ ...snapshot, answer: null, typingProgress: null, elapsedSeconds: 0, phase: task?.paused ? 'paused' : 'read', error: '' }, '检测到题目变化，已同步新题并清除旧答案。');
    await attachControls(snapshot.target);
    return true;
  } catch { return false; /* 题目切换期间可能暂时没有完整内容，等待下一次变化通知。 */ }
  finally { synchronizing = false; }
}
async function nextQuestion(task, oldId, visited) {
  let currentId = oldId;
  task.navigating = true;
  try {
    for (let retry = 0; retry < 3; retry++) {
      const until = Date.now() + 60000;
      let navigation;
      do {
        await gate(task); await pacedWait(task, task.pacing.actionIntervalMs);
        const target = task.target || state.target;
        await ensureSame(target, currentId);
        // 先找承载题目的 frame，再找其父级工具栏；不遍历无关的兄弟 frame。
        const frames = await chrome.webNavigation.getAllFrames({ tabId: task.tabId });
        const chain = [target.frameId];
        let frame = frames?.find((entry) => entry.frameId === target.frameId);
        while (frame && frame.parentFrameId >= 0 && !chain.includes(frame.parentFrameId)) { chain.push(frame.parentFrameId); frame = frames.find((entry) => entry.frameId === frame.parentFrameId); }
        let chosen = null, blocked = false;
        for (const frameId of chain) {
          let results;
          try { results = await chrome.scripting.executeScript({ target: { tabId: task.tabId, frameIds: [frameId] }, world: 'MAIN', func: navigationAction, args: ['find'] }); }
          catch { continue; }
          assertCurrent(task);
          const candidates = results[0]?.result?.candidates || [];
          blocked ||= candidates.some((candidate) => candidate.disabled);
          const enabled = candidates.filter((candidate) => !candidate.disabled);
          if (!enabled.length) continue;
          const bestRank = Math.min(...enabled.map((candidate) => candidate.rank));
          const best = enabled.filter((candidate) => candidate.rank === bestRank);
          if (best.length !== 1) throw new Error('找到多个同类换题入口，无法确定目标');
          chosen = { ...best[0], frameId }; break;
        }
        if (!chosen) {
          if (!blocked) throw new Error('在题目和父级工具栏中都未找到明确的下一题、随机一题或换一题入口');
          navigation = { waiting: true };
        } else {
          await ensureSame(target, currentId); assertCurrent(task);
          const [result] = await chrome.scripting.executeScript({ target: { tabId: task.tabId, frameIds: [chosen.frameId] }, world: 'MAIN', func: navigationAction, args: ['click', { key: chosen.key, label: chosen.label, allowBackground: task.runInBackground }] });
          navigation = result?.result;
          if (!navigation?.ok) throw new Error(navigation?.error || '换题入口未返回结果');
          if (navigation.waitingForFocus) { await pauseTask(task, 'inactive'); navigation.waiting = true; }
        }
        if (navigation.waiting) { await publish({ phase: 'waiting' }, '换题入口暂不可用，等待页面开放…'); await sleep(500); }
      } while (navigation.waiting && Date.now() < until);
      if (navigation.waiting) throw new Error('等待换题超时，未绕过网站限制');
      task.target = null;
      await publish({ phase: 'reading', answer: null, editor: null, typingProgress: null }, `已点击“${navigation.navigationLabel}”，等待新题和编辑器加载。`);
      const found = await readySnapshot(task, { afterId: currentId });
      task.target = found.target;
      if (!visited.has(found.question.questionId)) { await publish(found); return; }
      currentId = found.question.questionId; await publish(found); await attachControls(found.target);
      if (!navigation.random || retry === 2) throw new Error('换到本批已做题目，已停止重复求解');
      await publish({}, '确认随机换到了本批已做题目，再尝试一次换题。');
    }
  } finally { task.navigating = false; }
}
async function waitForManualQuestion(task) {
  task.manualBoundary = true;
  await publish({ phase: 'awaitingManual', typingProgress: null }, '编程题已填写。请人工执行或提交代码，再手动切换下一题；识别新题后继续，不自动提交或换题。');
  // 等待的是人工换题，不是固定倒计时。手动暂停仍由 gate 保持，停止会终止此等待。
  while (true) {
    await gate(task);
    await sleep(500);
    assertCurrent(task);
    await synchronizeQuestion(task.tabId);
    assertCurrent(task);
  }
}
async function solveSequence(task, options) {
  const visited = new Set();
  let completed = 0, batchCompleted = 0, replacements = 0;
  try {
    while (batchCompleted < options.count) {
      try {
        await gate(task);
        await publish({ phase: 'reading', answer: null, error: '', elapsedSeconds: 0, typingProgress: null }, '读取当前题…');
        const snapshot = await readySnapshot(task, { requireEditor: options.fill }); assertCurrent(task);
        task.target = snapshot.target; task.currentQuestionId = snapshot.question.questionId;
        await publish(snapshot, `已识别：${snapshot.question.title || snapshot.question.type}`);
        if (visited.has(snapshot.question.questionId)) throw new Error('已处理过当前题目，停止重复求解');
        await attachControls(snapshot.target); assertCurrent(task);
        if (snapshot.question.type === 'code' && !snapshot.editor.supported && options.fill) throw new Error(snapshot.editor.error);
        await gate(task);
        await publish({ phase: 'solving' }, `通过本地 ${task.provider} CLI 求解，使用该 CLI 当前配置。`);
        const request = nativeRequest('solve', { provider: task.provider, question: snapshot.question }, (progress) => {
          if (controller === task && !task.stopped && !task.pendingSnapshot) void publish({ elapsedSeconds: progress.elapsedSeconds });
        });
        task.nativeId = request.requestId;
        let solved;
        try { solved = await request.promise; } finally { if (task.nativeId === request.requestId) task.nativeId = null; }
        assertCurrent(task);
        await ensureSame(snapshot.target, snapshot.question.questionId); assertCurrent(task);
        const answer = validateAnswer(solved.answer, snapshot.question);
        if (task.paused) task.resumePhase = 'ready';
        await publish({ answer, phase: task.paused ? 'paused' : 'ready' }, `答案已返回，置信度 ${Math.round(answer.confidence * 100)}%。`);
        if (!options.fill) { await publish({ phase: 'ready', paused: false, pauseReason: null }, '仅预览模式：答案已返回，未填写网页。'); break; }
        if (answer.confidence < 0.8) { await publish({ phase: 'ready', paused: false, pauseReason: null }, '置信度不足 80%，停止自动填写，请人工复核。'); break; }
        if (task.pacing.answerDelayMs) {
          if (task.paused) task.resumePhase = 'delaying';
          await publish({ phase: task.paused ? 'paused' : 'delaying' }, `按配置等待 ${task.pacing.answerDelayMs / 1000} 秒后填写。`);
          await pacedWait(task, task.pacing.answerDelayMs);
        }
        await fillCurrent(task);
        visited.add(snapshot.question.questionId); completed++; batchCompleted++;
        await publish({ completed });
        if (options.run && state.question.type === 'code') {
          const execution = await runSamples(task);
          if (/不通过|未通过|失败|错误|超时|异常|Wrong Answer|Error|Failed/i.test(execution.result)) throw new Error('页面样例未通过，已停止连续作答');
          if (!/通过|Accepted|Success/i.test(execution.result)) throw new Error('页面样例结果未能确认通过，已停止连续作答');
        }
        // 编程题必须留给用户提交；即使每批只有 1 题，也等待人工换题后开始下一批。
        if (snapshot.question.type === 'code') await waitForManualQuestion(task);
        if (batchCompleted < options.count) await nextQuestion(task, snapshot.question.questionId, visited);
      } catch (error) {
        if (controller !== task || task.stopped) throw error;
        if (error.code === 'PAGE_NOT_READY') throw error;
        const replacement = task.pendingSnapshot || await scan(task.tabId).catch(() => null);
        const isChanged = replacement && (task.pendingSnapshot || replacement.question.questionId !== task.currentQuestionId);
        if (!isChanged) throw error;
        if (task.manualBoundary) { batchCompleted = 0; visited.clear(); replacements = 0; task.manualBoundary = false; }
        else if (++replacements > 10) throw new Error('题目连续变化超过 10 次，已停止。请稳定页面后重新开始');
        if (task.nativeId && !task.cancelWait) task.cancelWait = cancelNative(task.nativeId).catch(() => {});
        if (task.cancelWait) await task.cancelWait;
        if (controller !== task || task.stopped) throw new Error('任务已停止');
        task.pendingSnapshot = null; task.cancelWait = null; task.currentQuestionId = null; task.target = replacement.target;
        await publish({ ...replacement, answer: null, typingProgress: null, phase: task.paused ? 'paused' : 'read', error: '' }, '旧题已取消，接着处理当前新题。');
        await attachControls(replacement.target);
      }
    }
    if (controller === task) await publish({ busy: false, paused: false, pauseReason: null }, state.phase === 'filled' ? `已完成 ${completed} 题填写与回读核对，尚未提交。` : '');
  } catch (error) {
    if (controller === task && !task.stopped) await publish({ busy: false, paused: false, pauseReason: null, phase: 'error', error: error.message }, error.message);
  } finally { if (controller === task) controller = null; }
}
async function handle(message, pageTarget = null) {
  await hydrated;
  if (message.action === 'state') return state;
  if (message.action === 'health') return nativeRequest('health').promise;
  if (message.action === 'moveControls') {
    await chrome.storage.local.set({ controlsPosition: validatePosition(message.position) });
    return state;
  }
  if (message.action === 'pageChanged') { await synchronizeQuestion(pageTarget.tabId); return state; }
  if (message.action === 'pause') {
    if (!controller) throw new Error('当前没有运行中的任务');
    await pauseTask(controller, 'manual'); return state;
  }
  if (message.action === 'resume') {
    if (!controller) throw new Error('任务已经结束，请重新开始');
    await resumeTask(controller, true); return state;
  }
  if (message.action === 'stop') {
    const task = controller;
    if (task) { task.stopped = true; controller = null; if (task.nativeId) void cancelNative(task.nativeId).catch(() => {}); }
    await publish({ busy: false, paused: false, pauseReason: null, phase: 'stopped' }, '任务已停止，保留已填写内容。'); return state;
  }
  if (state.busy) throw new Error('已有任务运行，请先暂停或停止');
  if (message.action === 'enableControls') {
    const tab = await activeTab(), snapshot = await scan(tab.id);
    await publish({ ...snapshot, answer: null, phase: 'read', error: '' });
    await attachControls(snapshot.target);
    await publish({}, '页内控制已放入题目所在区域。后续可在页内开始、暂停或停止。');
    return state;
  }
  if (message.action === 'read') {
    const tab = await activeTab(); const snapshot = await scan(tab.id);
    await publish({ ...snapshot, answer: null, error: '', phase: 'read', completed: 0 }, '已读取题干、选项或代码模板。'); await attachControls(snapshot.target); return state;
  }
  if (message.action === 'fill' || message.action === 'run') {
    if (!state.target) throw new Error('请先读取题目');
    const task = { id: crypto.randomUUID(), tabId: state.target.tabId, target: state.target, currentQuestionId: state.question?.questionId, paused: false, stopped: false, nativeId: null };
    controller = task;
    await publish({ busy: true, error: '' });
    try {
      const prefs = await preferences(); Object.assign(task, { pacing: prefs.pacing, runInBackground: prefs.runInBackground }); assertCurrent(task);
      if (message.action === 'fill') await fillCurrent(task); else await runSamples(task);
    } catch (error) {
      if (controller === task && !task.stopped) {
        const replacement = task.pendingSnapshot || await scan(task.tabId).catch(() => null);
        if (replacement && replacement.question.questionId !== task.currentQuestionId) {
          await publish({ ...replacement, answer: null, typingProgress: null, phase: 'read', error: '' }, '题目已变化，旧输入已停止，当前题目已更新。');
          await attachControls(replacement.target);
          return state;
        }
      }
      throw error;
    }
    finally { if (controller === task) { controller = null; await publish({ busy: false, paused: false, pauseReason: null }); } }
    return state;
  }
  if (message.action === 'start') {
    if (message.fill !== undefined && typeof message.fill !== 'boolean') throw new Error('自动填写选项必须为 true 或 false');
    const autoFill = message.fill !== false;
    const task = { id: crypto.randomUUID(), tabId: null, target: null, paused: false, stopped: false, nativeId: null };
    controller = task;
    await publish({ busy: true, paused: false, pauseReason: null, autoFill, error: '', completed: 0, typingProgress: null, phase: 'reading', answer: null });
    try {
      const prefs = await preferences(message), tab = await activeTab(); assertCurrent(task);
      if (pageTarget && pageTarget.tabId !== tab.id) throw new Error('请在当前练习页内开始任务');
      Object.assign(task, { tabId: tab.id, provider: prefs.provider, pacing: prefs.pacing, runInBackground: prefs.runInBackground });
      await publish({ provider: prefs.provider, runInBackground: prefs.runInBackground });
      void solveSequence(task, { fill: autoFill, run: prefs.run, count: autoFill ? prefs.count : 1 });
      return state;
    } catch (error) { if (controller === task) { controller = null; await publish({ busy: false, phase: 'error', error: error.message }); } throw error; }
  }
  throw new Error('不支持的扩展操作');
}
chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (message.type !== 'command') return false;
  const panel = !sender.tab && sender.url?.startsWith(chrome.runtime.getURL(''));
  const page = sender.tab && message.source === 'page-controls' && ['state', 'start', 'pause', 'resume', 'stop', 'pageChanged', 'moveControls'].includes(message.action);
  if (sender.id !== chrome.runtime.id || (!panel && !page)) return false;
  (async () => {
    await hydrated;
    let target = null;
    if (page) {
      target = state.controls[sender.tab.id];
      if (!target || target.frameId !== sender.frameId || (target.documentId && target.documentId !== sender.documentId)) throw new Error('页内控制未绑定当前题目区域，请重新启用');
      if (['pause', 'resume', 'stop'].includes(message.action) && controller?.tabId !== sender.tab.id) throw new Error('当前任务不属于此练习页');
    }
    const data = await handle(page ? { action: message.action, ...(message.action === 'moveControls' ? { position: message.position } : {}) } : message, target);
    return page ? publicPageState(target) : data;
  })().then((data) => respond({ ok: true, data })).catch(async (error) => { if (panel) await publish({ error: error.message }); respond({ ok: false, error: error.message }); });
  return true;
});
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local' || (!changes.controlsAppearance && !changes.controlsPosition)) return;
  void (async () => {
    await hydrated;
    const message = { type: 'page-appearance' };
    if (changes.controlsAppearance) message.appearance = validateAppearance(changes.controlsAppearance.newValue);
    if (changes.controlsPosition) message.position = validatePosition(changes.controlsPosition.newValue);
    for (const target of Object.values(state.controls)) {
      void chrome.tabs.sendMessage(target.tabId, message, target.documentId ? { documentId: target.documentId } : { frameId: target.frameId }).catch(() => {});
    }
  })().catch(() => {});
});
chrome.tabs.onActivated.addListener(({ tabId }) => {
  const task = controller;
  if (!task || task.tabId == null || task.runInBackground) return;
  if (task.tabId !== tabId) void pauseTask(task, 'inactive');
  else if (task.pauseReason === 'inactive') void resumeTask(task).catch(() => {});
});
chrome.windows.onFocusChanged.addListener(async (windowId) => {
  const task = controller;
  if (!task || task.tabId == null || task.runInBackground || task.pauseReason === 'manual') return;
  const tab = await chrome.tabs.get(task.tabId).catch(() => null);
  if (controller !== task) return;
  if (!tab || windowId !== tab.windowId) await pauseTask(task, 'inactive');
  else if (task.pauseReason === 'inactive') await resumeTask(task).catch(() => {});
});
chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
chrome.commands.onCommand.addListener(async (name) => {
  if (name !== 'nexly-toggle-task') return;
  try {
    await hydrated;
    const tab = await activeTab();
    if (controller && controller.tabId !== tab.id) throw new Error('已有任务运行，请回到原练习页');
    await handle({ action: controller ? (controller.paused ? 'resume' : 'pause') : 'start' });
  } catch (error) { await publish({ error: error.message }, error.message); }
});

chrome.webNavigation.onCompleted.addListener(({ tabId }) => {
  void (async () => {
    await hydrated;
    for (const delay of [0, 400, 1000, 2000]) {
      if (delay) await sleep(delay);
      if (await synchronizeQuestion(tabId)) break;
    }
  })();
});

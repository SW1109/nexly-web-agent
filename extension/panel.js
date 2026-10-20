import { CLI_PROGRESS_LABELS } from './lib/contracts.js';
import { PROJECT, DATA_CONSENT_VERSION } from './lib/project-info.js';
import { DEFAULT_PACING, PACING_FIELDS, validatePacing } from './lib/pacing.js';
import { DEFAULT_APPEARANCE, DEFAULT_POSITION, OPACITY, validateAppearance } from './lib/appearance.js';
import { createApiForm } from './lib/api-form.js';
import { ensurePracticeAccess } from './lib/tab-access.js';
import { createTaskLog } from './lib/panel-log.js';
import { createCoursePanel } from './lib/course-panel.js';
import { createPanelLayout } from './lib/panel-layout.js';
const $ = (id) => document.getElementById(id);
const renderLog = createTaskLog({ list: $('log'), count: $('log-count'), jump: $('log-latest') });
for (const link of document.querySelectorAll('[data-project-link]')) link.href = PROJECT[link.dataset.projectLink];
let dataUseAccepted = false;
function showDataUse(accepted) {
  dataUseAccepted = accepted;
  $('data-consent').hidden = accepted;
  if (currentState) render(currentState);
}
const names = { codex: 'Codex CLI', claude: 'Claude Code', gemini: 'Gemini CLI', qwen: 'Qwen Code', kimi: 'Kimi CLI' };
const types = { code: '编程题', single: '单选题', multiple: '多选题', judge: '判断题', blank: '填空题', text: '简答题' };
const phases = { awaitingManual: '等待人工提交并换题', idle: '准备就绪', read: '题目已读取', reading: '读取题目中', solving: '模型求解中', delaying: '按配置等待填写', ready: '答案待复核', applying: '写入并核对中', filled: '已填写，未提交', testing: '等待样例执行结果', waiting: '等待平台开放操作', paused: '任务已暂停', stopped: '任务已停止', error: '任务遇到问题', interrupted: '任务已中断' };
let coursePanel = null, layout = null;
let currentState = null, connection = null, localBusy = false, nativeBridgeFailed = false;
let localOperation = null, apiBusy = false, healthChecking = false;
const operationLabels = { read: '正在读取题目…', enableControls: '正在启用页内组件…', start: '正在启动任务…', fill: '正在填写答案…', run: '正在执行样例…', pause: '正在暂停…', resume: '正在继续…', stop: '正在停止任务…' };
const apiForm = createApiForm({
  command,
  onInvalid: (input) => layout?.revealSetting(input),
  onBusy(value) { apiBusy = value; if (currentState) render(currentState); },
  onChange() { settingsDirty = true; if ($('connection-mode').value === 'api') { connection = null; $('connection-status').textContent = 'API 配置未保存'; $('connection-status').className = 'status bad'; } updateSummary(); if (currentState) render(currentState); },
  onSaved(health) { connection = health.ready ? health : null; $('connection-status').textContent = health.ready ? 'API 配置已就绪' : health.locked ? 'API 密钥已锁定' : 'API 密钥已清除'; $('connection-status').className = health.ready ? 'status ok' : 'status bad'; if (currentState) render(currentState); }
});
let settingsSaving = false, settingsDirty = false;
const pacingInputs = [...document.querySelectorAll('[data-pacing]')];
function showSettings(open, focus = true, category) { layout.showSettings(open, focus, category); }
function settingsStatus(message, error = false) {
  $('settings-status').textContent = message; $('settings-status').dataset.error = String(error);
}
function showAppearance(appearance) {
  $('controls-opacity').min = OPACITY.min; $('controls-opacity').max = OPACITY.max; $('controls-opacity').step = 1;
  $('controls-opacity').value = appearance.opacity;
  $('opacity-value').value = `${appearance.opacity}%`; $('opacity-preview').style.opacity = appearance.opacity / 100;
  $('opacity-hint').textContent = `默认 ${OPACITY.defaultValue}%；可调 ${OPACITY.min}～${OPACITY.max}%。数值越低越透明，展开操作时恢复清晰显示。`;
}
function updateSummary() {
  $('provider-summary').textContent = $('connection-mode').value === 'api' ? `API · ${apiForm.summary}` : names[$('provider').value];
  $('task-summary').textContent = currentState?.question?.assignment?.draftOnly ? '单份草稿 · 不自动提交' : currentState?.pageQuestions?.keys.length > 1 ? `当前页 ${currentState.pageQuestions.keys.length} 题` : `每批 ${$('count').value} 题`;
}
function validateInput(input, message) {
  input.setCustomValidity('');
  if (input.value === '' || !input.checkValidity()) {
    input.setCustomValidity(message); input.setAttribute('aria-invalid', 'true');
    layout.revealSetting(input); input.focus(); input.reportValidity();
    throw new Error(message);
  }
  input.removeAttribute('aria-invalid');
}
function showPacing(pacing) {
  for (const input of pacingInputs) {
    const field = PACING_FIELDS[input.dataset.pacing];
    input.min = field.min; input.max = field.max; input.step = field.step; input.value = pacing[input.dataset.pacing]; input.setCustomValidity('');
    $(`${input.id}-hint`).textContent = `默认 ${field.defaultValue} ms；可配置 ${field.min}～${field.max} ms。`;
  }
  $('typewriter').checked = pacing.typewriter;
}
async function performConfigured(action, extra = {}) {
  await perform(action, extra, true);
}
async function saveSettings() {
  const raw = { typewriter: $('typewriter').checked };
  for (const input of pacingInputs) {
    const field = PACING_FIELDS[input.dataset.pacing];
    validateInput(input, input.value === '' ? `请输入${field.label}` : `${field.label}应为 ${field.min}～${field.max} 的整数`);
    raw[input.dataset.pacing] = Number(input.value);
  }
  validateInput($('count'), '每批题数应为 1～100 的整数');
  const pacing = validatePacing(raw), provider = $('provider').value, count = Number($('count').value), run = $('run-after-fill').checked, runInBackground = $('background-run').checked;
  const controlsAppearance = validateAppearance({ opacity: Number($('controls-opacity').value) });
  const autoControls = $('auto-controls').checked;
  const connectionMode = $('connection-mode').value;
  const courseSettings = coursePanel.settings();
  if (connectionMode === 'api') await apiForm.save();
  if (!names[provider]) throw new Error('请选择受支持的本地 CLI');
  await chrome.storage.local.set({ connectionMode, pacing, provider, count, runAfterFill: run, runInBackground, controlsAppearance, autoControls, courseSettings });
  settingsDirty = false; updateSummary();
  settingsStatus('已保存。外观与页内组件开关立即生效，任务配置在下次开始时生效。');
  return { connectionMode, pacing, provider, count, run, runInBackground };
}
function isNativeError(message) { return /本地 CLI 桥|native messaging host|本地桥响应超时/i.test(message || ''); }
function isPageError(message) { return /站点权限|授权本站|未读到完整题目|重新读取|页面尚未加载|暂时无法读取练习页|多个活动 frame|没有识别到练习题|练习标签被浏览器休眠/i.test(message || ''); }
function showError(message) {
  $('error').textContent = message || ''; $('error').hidden = !message; $('error').dataset.kind = isNativeError(message) ? 'native' : 'other';
  if ($('connection-mode').value === 'local' && isNativeError(message)) {
    nativeBridgeFailed = true; connection = null;
    if (!healthChecking) {
      $('connection-status').textContent = '本地桥未连接';
      $('connection-status').className = 'status bad';
    }
  }
  $('native-recovery').hidden = $('connection-mode').value !== 'local' || !nativeBridgeFailed;
  $('page-recovery').hidden = !isPageError(message);
}
async function command(action, data = {}) {
  const response = await chrome.runtime.sendMessage({ type: 'command', action, ...data });
  if (!response?.ok) throw new Error(response?.error || '扩展后台暂不可用，请重新打开侧栏');
  return response.data;
}
function render(state) {
  currentState = state;
  updateSummary();
  showError(state.error);
  const busy = state.busy || localBusy || apiBusy || settingsSaving || Boolean(coursePanel?.busy);
  for (const id of ['read', 'solve', 'auto', 'fill', 'run', 'provider', 'count', 'permission', 'run-after-fill', 'background-run', 'page-controls', 'reset-settings', 'typewriter', 'auto-controls', 'connection-mode', 'controls-opacity', 'reset-position', 'retry-page']) $(id).disabled = busy;
  for (const id of ['refresh', 'retry-native']) $(id).disabled = busy || healthChecking;
  $('close-settings').disabled = settingsSaving;
  $('save-settings').disabled = busy; apiForm.setDisabled(busy);
  for (const input of pacingInputs) input.disabled = busy;
  $('solve').disabled ||= !connection || !dataUseAccepted;
  $('auto').disabled ||= !connection || !dataUseAccepted;
  $('run').disabled ||= !dataUseAccepted;
  $('clear-history').disabled = busy;
  $('revoke-data-use').disabled = busy || !dataUseAccepted;
  $('task-controls').hidden = !state.busy && !localBusy;
  $('pause').textContent = state.paused ? '继续' : '暂停';
  $('pause').disabled = !state.busy || Boolean(state.operation) || localBusy;
  $('stop').disabled = localOperation?.action === 'stop' || (!state.busy && !localBusy);
  const action = localOperation?.action || state.operation;
  const status = operationLabels[action] || `${phases[state.phase] || state.phase}${state.phase === 'solving' ? ` · ${state.elapsedSeconds || 0} 秒${CLI_PROGRESS_LABELS[state.cliStage] ? ` · ${CLI_PROGRESS_LABELS[state.cliStage]}` : ''}` : ''}${state.typingProgress ? ` · ${state.typingProgress.written}/${state.typingProgress.total}` : ''}${state.completed ? ` · 已填写 ${state.completed} 题` : ''}`;
  $('task-status').textContent = status;
  $('task-status').dataset.busy = String(Boolean(state.busy || localBusy));
  const reading = action === 'read' || action === 'enableControls' || state.phase === 'reading' && state.busy;
  $('read').textContent = reading ? '正在读取…' : '重新读取 ↻';
  $('read').setAttribute('aria-busy', String(Boolean(reading)));
  document.querySelector('.question-section').setAttribute('aria-busy', String(Boolean(reading)));
  const draftOnly = state.question?.assignment?.draftOnly === true;
  $('auto').textContent = draftOnly ? '生成作业参考草稿' : '开始答题 →';
  $('solve').textContent = draftOnly ? '仅预览草稿' : '仅预览答案';
  $('practice-hint').textContent = draftOnly ? state.question.assignment.guidance : '置信度达到 80% 后自动填写，最终提交由你操作。';
  $('answer-title').textContent = draftOnly ? '作业参考草稿' : '答案预览';
  $('fill').hidden = draftOnly;
  $('fill').disabled ||= draftOnly;
  $('empty').hidden = Boolean(state.question);
  $('question').hidden = !state.question;
  if (state.question) {
    $('question-type').textContent = draftOnly ? '大作业 · 人工提交' : types[state.question.type];
    $('question-site').textContent = new URL(state.question.pageUrl).hostname;
    $('question-name').textContent = state.question.title;
    $('question-body').textContent = state.question.stem;
    $('editor-status').textContent = draftOnly ? `${state.question.assignment.minimumCharacters ? `题面要求不少于 ${state.question.assignment.minimumCharacters} 字。` : ''}${state.question.assignment.guidance}` : state.question.type === 'code' ? `${state.question.language || '语言未识别'} · ${state.editor?.supported ? `编辑器：${state.editor.kind}` : state.editor?.error || '编辑器待适配'}` : '';
  }
  $('answer-section').hidden = !state.answer;
  $('fill').disabled ||= !state.answer;
  // 只有编程题且页面报告了唯一执行入口时才展示“执行样例”，选择题不出现这个入口。
  const runAvailable = state.question?.type === 'code' && state.run?.available === true;
  $('run').hidden = !runAvailable;
  // 读取失败后允许重试执行；页面层仍会核对当前题目、编辑器绑定和代码，不能覆盖人工修改。
  const canRun = ['filled', 'error'].includes(state.phase) && state.answer?.type === 'code' && state.answer.questionId === state.question?.questionId;
  $('run').disabled ||= !canRun || !runAvailable;
  $('run').title = !state.question || state.question.type !== 'code' ? '只有编程题需要执行样例'
    : state.run?.available !== true ? (state.run?.reason === 'ambiguous' ? '页面有多个候选执行入口，已跳过执行样例' : '页面没有唯一的执行入口，已跳过执行样例')
    : !canRun ? '填写完成后可执行样例'
    : '点击页面执行入口并等待新结果';
  if (state.answer) {
    const answer = state.answer;
    const draftCharacters = draftOnly ? Array.from(answer.fills[0]?.value.replace(/\s/g, '') || '').length : 0;
    const minimum = state.question?.assignment?.minimumCharacters;
    const draftLengthWarning = minimum && draftCharacters < minimum ? `低于题面 ${minimum} 字要求，请补充并按平台计数复核。` : '';
    $('confidence').textContent = `${Math.round(answer.confidence * 100)}% 置信度`;
    $('answer-body').textContent = answer.code || answer.choiceIds.map((id) => { const option = state.question.options.find((item) => item.id === id); return `${option?.label || id} · ${option?.text || ''}`; }).join('\n') || answer.fills.map((item) => `${state.question.fields.find((field) => field.id === item.fieldId)?.label || item.fieldId}：${item.value}`).join('\n');
    $('explanation').textContent = answer.explanation;
    $('fill-status').textContent = draftOnly ? `参考草稿约 ${draftCharacters} 字符（不含空白）。${draftLengthWarning}请核对字数、事实与论述后按平台规则人工录入；未填写、保存或提交。` : state.phase === 'filled' ? '已填写并回读核对，尚未提交。'
      : state.phase === 'awaitingManual' ? '已填写，等待你手动提交代码并切换下一题；切题后继续求解。'
      : state.paused ? (state.pauseReason === 'inactive' ? '等待回到原练习页，返回后自动继续填写。' : '已手动暂停，点击“继续”后填写。')
      : state.error ? `未完成填写：${state.error}`
      : state.phase === 'applying' ? '正在填写并核对页面内容…'
      : state.phase === 'delaying' ? '答案已返回，正在按配置等待后填写。'
      : state.phase === 'testing' ? '答案已填写，正在等待页面样例执行结果。'
      : state.phase === 'waiting' ? '正在等待平台开放下一步操作，请查看任务记录。'
      : state.phase === 'stopped' || state.phase === 'interrupted' ? '任务已停止，未继续填写。'
      : state.autoFill === false ? '仅预览模式，不自动填写；可点击下方按钮填入。'
      : answer.confidence < 0.8 ? '置信度不足 80%，请复核后手动填写。'
      : state.busy ? '答案已返回，接下来自动填写。'
      : '答案尚未填写，可点击下方按钮填入页面。';
  }
  renderLog(state.log);
  coursePanel?.updatePractice(state.busy || localBusy || apiBusy || settingsSaving, dataUseAccepted);
  coursePanel?.setSettingsDisabled(busy);
  layout?.render({ practice: state, course: coursePanel?.state, status, modelName: $('provider-summary').textContent, modelStatus: $('connection-status').textContent, consent: dataUseAccepted, pending: localBusy || apiBusy || settingsSaving });
}
function providerDetail() {
  const provider = connection?.providers?.find((item) => item.id === $('provider').value);
  $('provider-detail').textContent = provider ? provider.installed ? `${provider.version} · 已找到命令，登录状态以实际求解结果为准。` : provider.error : '使用 CLI 现有登录和配置，不在扩展里填写 API Key。';
  const changed = provider?.configs?.filter((item) => item.updatedAt).map((item) => new Date(item.updatedAt).getTime());
  $('config-detail').textContent = changed?.length ? `CLI 配置最近更新：${new Date(Math.max(...changed)).toLocaleString('zh-CN', { hour12: false })}。每次任务启动新进程，读取当前配置。` : 'CLI 配置变更后，下一次任务自动读取；运行中的任务保持原配置。ccSwitch 仅管理其支持的 CLI。';
}
let healthEpoch = 0;
async function refreshHealth() {
  const epoch = ++healthEpoch, mode = $('connection-mode').value;
  healthChecking = true;
  if (currentState) render(currentState);
  $('connection-status').textContent = mode === 'api' ? '正在检查 API 配置…' : '正在检测本地桥…';
  try {
    const health = await command('health', { connectionMode: mode });
    if (epoch !== healthEpoch || mode !== $('connection-mode').value) return;
    connection = mode === 'api' && !health.ready ? null : health;
    if (mode === 'local') {
      nativeBridgeFailed = false;
      if (currentState && isNativeError(currentState.error)) currentState = { ...currentState, error: '' };
      if (isNativeError($('error').textContent)) showError('');
    }
    $('connection-status').textContent = mode === 'api' ? health.ready ? 'API 已配置 · 未测试生成' : health.locked ? 'API 密钥已锁定 · 请在设置解锁' : '请先配置 API 地址、密钥和模型' : '本地桥已连接';
    $('connection-status').title = mode === 'api' ? '配置就绪不代表账号、额度或模型已可用' : `Node ${health.nodeVersion}`;
    $('connection-status').className = connection ? 'status ok' : 'status bad'; $('setup-help').hidden = true;
  } catch (error) {
    if (epoch !== healthEpoch || mode !== $('connection-mode').value) return;
    connection = null; if (mode === 'local') nativeBridgeFailed = true;
    $('connection-status').textContent = mode === 'api' ? 'API 配置暂不可用' : '本地桥未连接'; $('connection-status').className = 'status bad'; $('setup-help').hidden = mode === 'api';
    if (currentState) currentState = { ...currentState, error: error.message };
    showError(error.message);
  } finally {
    if (epoch === healthEpoch) { healthChecking = false; providerDetail(); if (currentState) render(currentState); }
  }
}
async function perform(action, data = {}, configured = false) {
  const stopping = action === 'stop';
  if (stopping ? localOperation?.action === 'stop' : localBusy || apiBusy || settingsSaving || currentState?.busy && !['pause', 'resume'].includes(action)) return;
  const operation = { action };
  localOperation = operation; localBusy = true;
  if (currentState) render({ ...currentState, error: '' });
  try {
    // 站点授权始终由本次用户点击发起；停止后不再派发旧操作。
    if (['read', 'start', 'enableControls'].includes(action)) await ensurePracticeAccess();
    if (localOperation !== operation) return;
    if (configured) data = { ...await saveSettings(), ...data };
    if (localOperation !== operation) return;
    const state = await command(action, data);
    if (localOperation === operation) render(state);
  }
  catch (error) {
    if (localOperation === operation) {
      if (currentState) currentState = { ...currentState, error: error.message };
      showError(error.message);
    }
  }
  finally {
    if (localOperation === operation) { localOperation = null; localBusy = false; if (currentState) render(currentState); layout.focusInvalid(); }
  }
}
function showConnectionMode() {
  const api = $('connection-mode').value === 'api';
  $('local-settings').hidden = api; $('api-settings').hidden = !api; $('refresh').hidden = api;
  $('native-recovery').hidden = api || !nativeBridgeFailed;
  updateSummary();
}
$('connection-mode').addEventListener('change', () => { connection = null; showError(''); if (currentState) render({ ...currentState, error: '' }); showConnectionMode(); void refreshHealth(); });
$('refresh').addEventListener('click', refreshHealth);
$('retry-native').addEventListener('click', refreshHealth);
$('retry-page').addEventListener('click', () => perform('read'));
window.addEventListener('focus', () => {
  if (nativeBridgeFailed && $('connection-mode').value === 'local' && !$('refresh').disabled && !currentState?.busy && !localBusy && !settingsSaving) void refreshHealth();
});
$('provider').addEventListener('change', providerDetail);
$('read').addEventListener('click', () => perform('read'));
$('page-controls').addEventListener('click', () => performConfigured('enableControls'));
for (const [id, action, extra] of [['solve', 'start', { fill: false }], ['auto', 'start', {}], ['fill', 'fill', {}], ['run', 'run', {}]]) {
  $(id).addEventListener('click', () => performConfigured(action, extra));
}
async function commitSettings(close = false) {
  if (settingsSaving || localBusy || apiBusy || currentState?.busy || coursePanel?.busy) return;
  settingsSaving = true; $('save-settings').disabled = true; $('save-settings').textContent = '正在保存…'; settingsStatus('正在保存…');
  const saving = saveSettings(); if (currentState) render(currentState);
  try { await saving; if (close) showSettings(false); }
  catch (error) { settingsStatus(`未保存：${error.message}`, true); }
  finally { settingsSaving = false; $('save-settings').textContent = '保存设置'; if (currentState) render(currentState); layout.focusInvalid(); }
}
async function leaveSettings() {
  if (settingsSaving) return;
  if (settingsDirty && !localBusy && !apiBusy && !currentState?.busy && !coursePanel?.busy) await commitSettings(true);
  else {
    if (settingsDirty) settingsStatus('任务进行中，未保存的更改已保留；任务结束后可保存。');
    showSettings(false);
  }
}
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && !$('settings-view').hidden) { event.preventDefault(); void leaveSettings(); }
});
$('open-settings').addEventListener('click', () => { if ($('settings-view').hidden) showSettings(true); else void leaveSettings(); });
$('close-settings').addEventListener('click', leaveSettings);
$('save-settings').addEventListener('click', () => commitSettings());
$('reset-settings').addEventListener('click', () => { showPacing(DEFAULT_PACING); settingsDirty = true; settingsStatus('已恢复默认节奏，保存后生效。'); });
$('controls-opacity').addEventListener('input', () => showAppearance({ opacity: Number($('controls-opacity').value) }));
$('reset-position').addEventListener('click', async () => {
  $('reset-position').disabled = true;
  try { await chrome.storage.local.set({ controlsPosition: DEFAULT_POSITION }); $('position-status').textContent = '已移回右下角。'; }
  catch (error) { $('position-status').textContent = `位置未保存：${error.message}`; }
  finally { if (currentState) render(currentState); else $('reset-position').disabled = false; }
});
for (const input of $('settings-view').querySelectorAll('input,select')) input.addEventListener('input', () => {
  input.setCustomValidity(''); input.removeAttribute('aria-invalid'); settingsDirty = true;
  settingsStatus('有未保存的更改；保存或返回练习时生效。');
});
$('pause').addEventListener('click', () => perform(currentState?.paused ? 'resume' : 'pause'));
$('stop').addEventListener('click', () => perform('stop'));
$('permission').addEventListener('click', () => perform('read'));
$('data-consent-check').addEventListener('change', () => { $('accept-data-use').disabled = !$('data-consent-check').checked; });
$('accept-data-use').addEventListener('click', async () => {
  if (!$('data-consent-check').checked) return;
  $('accept-data-use').disabled = true;
  try { await command('acceptDataUse', { version: DATA_CONSENT_VERSION }); showDataUse(true); }
  catch (error) { showError(error.message); }
  finally { $('accept-data-use').disabled = !$('data-consent-check').checked; }
});
$('revoke-data-use').addEventListener('click', async () => {
  if (!confirm('撤回后将无法再调用 AI，已发给服务商的数据不受此操作影响。是否继续？')) return;
  try { await command('revokeDataUse'); showDataUse(false); settingsStatus('已撤回；重新阅读并确认数据说明后才能求解。'); }
  catch (error) { showError(error.message); }
});
$('clear-history').addEventListener('click', async () => {
  if (!confirm('清除本浏览器会话中的题目、答案和任务记录？不会清除配置，也不会修改网页上已填写的内容。')) return;
  try { render(await command('clearHistory')); } catch (error) { showError(error.message); }
});
chrome.runtime.onMessage.addListener((message, sender) => {
  if (sender.id !== chrome.runtime.id || message?.type !== 'state') return;
  const justStopped = ['stopped', 'interrupted'].includes(message.state.phase) && (currentState?.phase !== message.state.phase || currentState?.busy);
  if (justStopped && localOperation?.action !== 'stop') { localOperation = null; localBusy = false; }
  render(message.state);
});
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes.dataConsentVersion) showDataUse(changes.dataConsentVersion.newValue === DATA_CONSENT_VERSION);
});
coursePanel = createCoursePanel({ onPractice: () => layout.showWorkspace('practice'), onChange: () => { if (currentState) render(currentState); }, onInvalid: (input) => layout.revealSetting(input) });
layout = createPanelLayout({
  onWorkspace: (name) => { if (name === 'course') void coursePanel.activate(); },
  onInspect: (name) => { if (name === 'course') void coursePanel.scan(); else void perform('read'); },
  onLeaveSettings: leaveSettings
});
$('course-settings-open').addEventListener('click', () => showSettings(true, true, 'course'));
chrome.runtime.onMessage.addListener((message, sender) => {
  if (sender.id === chrome.runtime.id && message?.type === 'panel-navigate' && ['home', 'course', 'practice', 'records'].includes(message.view)) {
    if (!$('settings-view').hidden) return; // 不覆盖用户正在编辑且尚未保存的配置。
    layout.showWorkspace(message.view);
  }
});
try {
  await coursePanel.init();
  showPacing(DEFAULT_PACING); showAppearance(DEFAULT_APPEARANCE);
  showDataUse((await chrome.storage.local.get('dataConsentVersion')).dataConsentVersion === DATA_CONSENT_VERSION);
  const { provider, count, runAfterFill, pacing, runInBackground, controlsAppearance, autoControls, connectionMode } = await chrome.storage.local.get(['provider', 'count', 'runAfterFill', 'pacing', 'runInBackground', 'controlsAppearance', 'autoControls', 'connectionMode']);
  if (names[provider]) $('provider').value = provider;
  $('connection-mode').value = connectionMode === 'api' ? 'api' : 'local';
  try { await apiForm.load(); } catch (error) { settingsStatus(error.message, true); }
  showConnectionMode();
  if (Number.isInteger(count) && count >= 1 && count <= 100) $('count').value = count;
  $('run-after-fill').checked = runAfterFill === true;
  $('background-run').checked = runInBackground !== false;
  $('auto-controls').checked = autoControls !== false;
  let pacingError = '';
  try { showPacing(validatePacing(pacing)); }
  catch (error) { showPacing(DEFAULT_PACING); pacingError = `已保存的节奏配置无效，已显示默认值；请检查后保存。${error.message}`; }
  try { showAppearance(validateAppearance(controlsAppearance)); }
  catch (error) { pacingError += `外观配置已恢复默认值。${error.message}`; }
  updateSummary();
  render(await command('state'));
  await layout.init();
  await refreshHealth();
  if (pacingError) showError(pacingError);
} catch (error) { showError(error.message); }

import { DEFAULT_PACING, PACING_FIELDS, validatePacing } from './lib/pacing.js';
import { DEFAULT_APPEARANCE, DEFAULT_POSITION, OPACITY, validateAppearance } from './lib/appearance.js';
const $ = (id) => document.getElementById(id);
const names = { codex: 'Codex CLI', claude: 'Claude Code', gemini: 'Gemini CLI' };
const types = { code: '编程题', single: '单选题', multiple: '多选题', judge: '判断题', blank: '填空题', text: '简答题' };
const phases = { awaitingManual: '等待人工提交并换题', idle: '准备就绪', read: '题目已读取', reading: '读取题目中', solving: '本地 CLI 求解中', delaying: '按配置等待填写', ready: '答案待复核', applying: '写入并核对中', filled: '已填写，未提交', testing: '等待样例执行结果', waiting: '等待平台开放操作', paused: '任务已暂停', stopped: '任务已停止', error: '任务遇到问题', interrupted: '任务已中断' };
let currentState = null, connection = null, localBusy = false;
let lastLogSignature = '';
let settingsSaving = false, settingsDirty = false, taskScroll = 0;
const pacingInputs = [...document.querySelectorAll('[data-pacing]')];
function showSettings(open, focus = true) {
  if (open && $('settings-view').hidden) taskScroll = window.scrollY;
  $('settings-view').hidden = !open; $('task-view').hidden = open;
  $('open-settings').setAttribute('aria-expanded', String(open));
  if (focus) (open ? $('settings-title') : $('open-settings')).focus({ preventScroll: true });
  window.scrollTo(0, open ? 0 : taskScroll);
}
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
  $('provider-summary').textContent = names[$('provider').value];
  $('task-summary').textContent = `每批 ${$('count').value} 题`;
}
function validateInput(input, message) {
  input.setCustomValidity('');
  if (input.value === '' || !input.checkValidity()) {
    input.setCustomValidity(message); input.setAttribute('aria-invalid', 'true');
    showSettings(true, false); input.focus(); input.reportValidity();
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
  if (localBusy || currentState?.busy) return;
  const saving = saveSettings();
  localBusy = true;
  if (currentState) render(currentState);
  try {
    const settings = await saving;
    await perform(action, { ...settings, ...extra });
  } catch (error) { showError(error.message); }
  finally {
    localBusy = false;
    if (currentState) render({ ...currentState, error: $('error').textContent });
  }
}
async function saveSettings() {
  const raw = { typewriter: $('typewriter').checked };
  for (const input of pacingInputs) {
    const field = PACING_FIELDS[input.dataset.pacing];
    validateInput(input, input.value === '' ? `请输入${field.label}` : `${field.label}应为 ${field.min}～${field.max} 的整数`);
    raw[input.dataset.pacing] = Number(input.value);
  }
  validateInput($('count'), '每批题数应为 1～20 的整数');
  const pacing = validatePacing(raw), provider = $('provider').value, count = Number($('count').value), run = $('run-after-fill').checked, runInBackground = $('background-run').checked;
  const controlsAppearance = validateAppearance({ opacity: Number($('controls-opacity').value) });
  if (!names[provider]) throw new Error('请选择受支持的本地 CLI');
  await chrome.storage.local.set({ pacing, provider, count, runAfterFill: run, runInBackground, controlsAppearance });
  settingsDirty = false; updateSummary();
  settingsStatus('已保存。外观立即生效，任务配置在下次开始时生效。');
  return { pacing, provider, count, run, runInBackground };
}
function showError(message) { $('error').textContent = message || ''; $('error').hidden = !message; }
async function command(action, data = {}) {
  const response = await chrome.runtime.sendMessage({ type: 'command', action, ...data });
  if (!response?.ok) throw new Error(response?.error || '扩展后台暂不可用，请重新打开侧栏');
  return response.data;
}
function renderLog(entries) {
  // 明确按记录时间倒序；同毫秒的记录让后写入者在前，不依赖收到的数组顺序。
  const newestFirst = entries.map((entry, index) => ({ entry, index })).sort((a, b) => b.entry.time - a.entry.time || b.index - a.index).map(({ entry }) => entry);
  const signature = JSON.stringify(newestFirst);
  if (signature === lastLogSignature) return;
  lastLogSignature = signature;
  $('log-count').textContent = String(entries.length);
  $('log').replaceChildren(...newestFirst.map((entry) => {
    const item = document.createElement('li');
    const time = document.createElement('time'); time.dateTime = new Date(entry.time).toISOString();
    time.textContent = new Date(entry.time).toLocaleTimeString('zh-CN', { hour12: false });
    const content = document.createElement('span'); content.textContent = entry.text; item.append(time, content);
    return item;
  }));
  // 新记录回到顶部；没有新增日志的 CLI 心跳不重绘，也不打断用户滚动查看历史。
  $('log').scrollTop = 0;
}
function render(state) {
  currentState = state;
  const busy = state.busy || localBusy;
  for (const id of ['read', 'solve', 'auto', 'fill', 'run', 'provider', 'count', 'permission', 'run-after-fill', 'background-run', 'page-controls', 'reset-settings', 'typewriter']) $(id).disabled = busy;
  $('save-settings').disabled = settingsSaving || localBusy;
  for (const input of pacingInputs) input.disabled = busy;
  $('solve').disabled ||= !connection;
  $('auto').disabled ||= !connection;
  $('task-controls').hidden = !state.busy;
  $('pause').textContent = state.paused ? '继续' : '暂停';
  $('pause').disabled = !state.busy;
  $('task-status').textContent = `${phases[state.phase] || state.phase}${state.phase === 'solving' ? ` · ${state.elapsedSeconds || 0} 秒` : ''}${state.typingProgress ? ` · ${state.typingProgress.written}/${state.typingProgress.total}` : ''}${state.completed ? ` · 已填写 ${state.completed} 题` : ''}`;
  $('task-status').dataset.busy = String(Boolean(state.busy));
  $('empty').hidden = Boolean(state.question);
  $('question').hidden = !state.question;
  if (state.question) {
    $('question-type').textContent = types[state.question.type];
    $('question-site').textContent = new URL(state.question.pageUrl).hostname;
    $('question-name').textContent = state.question.title;
    $('question-body').textContent = state.question.stem;
    $('editor-status').textContent = state.question.type === 'code' ? `${state.question.language || '语言未识别'} · ${state.editor?.supported ? `编辑器：${state.editor.kind}` : state.editor?.error || '编辑器待适配'}` : '';
  }
  $('answer-section').hidden = !state.answer;
  $('fill').disabled ||= !state.answer;
  $('run').disabled ||= state.phase !== 'filled' || state.question?.type !== 'code';
  if (state.answer) {
    const answer = state.answer;
    $('confidence').textContent = `${Math.round(answer.confidence * 100)}% 置信度`;
    $('answer-body').textContent = answer.code || answer.choiceIds.map((id) => { const option = state.question.options.find((item) => item.id === id); return `${option?.label || id} · ${option?.text || ''}`; }).join('\n') || answer.fills.map((item) => `${state.question.fields.find((field) => field.id === item.fieldId)?.label || item.fieldId}：${item.value}`).join('\n');
    $('explanation').textContent = answer.explanation;
    $('fill-status').textContent = state.phase === 'filled' ? '已填写并回读核对，尚未提交。'
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
  showError(state.error);
  renderLog(state.log);
}
function providerDetail() {
  const provider = connection?.providers?.find((item) => item.id === $('provider').value);
  $('provider-detail').textContent = provider ? provider.installed ? `${provider.version} · 已找到命令，登录状态以实际求解结果为准。` : provider.error : '使用 CLI 现有登录和配置，不在扩展里填写 API Key。';
  const changed = provider?.configs?.filter((item) => item.updatedAt).map((item) => new Date(item.updatedAt).getTime());
  $('config-detail').textContent = changed?.length ? `CLI 配置最近更新：${new Date(Math.max(...changed)).toLocaleString('zh-CN', { hour12: false })}。每次任务启动新进程，读取当前配置。` : 'ccSwitch 写入配置后，下一次任务自动读取；运行中的任务保持原配置。';
}
async function refreshHealth() {
  $('refresh').disabled = true;
  $('connection-status').textContent = '正在检测本地桥…';
  try {
    connection = await command('health');
    $('connection-status').textContent = '本地桥已连接';
    $('connection-status').title = `Node ${connection.nodeVersion}`;
    $('connection-status').className = 'status ok'; $('setup-help').hidden = true;
  } catch (error) {
    connection = null; $('connection-status').textContent = '本地桥未连接'; $('connection-status').className = 'status bad'; $('setup-help').hidden = false; showError(error.message);
  } finally { $('refresh').disabled = false; providerDetail(); if (currentState) render({ ...currentState, error: connection ? currentState.error : $('error').textContent }); }
}
async function perform(action, data) {
  localBusy = true; if (currentState) render(currentState);
  try { const state = await command(action, data); render(state); }
  catch (error) { showError(error.message); }
  finally { localBusy = false; if (currentState) { const error = $('error').textContent; render({ ...currentState, error }); } }
}
$('refresh').addEventListener('click', refreshHealth);
$('provider').addEventListener('change', providerDetail);
$('read').addEventListener('click', () => perform('read'));
$('page-controls').addEventListener('click', () => performConfigured('enableControls'));
for (const [id, action, extra] of [['solve', 'start', { fill: false }], ['auto', 'start', {}], ['fill', 'fill', {}], ['run', 'run', {}]]) {
  $(id).addEventListener('click', () => performConfigured(action, extra));
}
async function commitSettings(close = false) {
  if (settingsSaving) return;
  settingsSaving = true; $('save-settings').disabled = true; $('save-settings').textContent = '正在保存…';
  try { await saveSettings(); if (close) showSettings(false); }
  catch (error) { settingsStatus(`未保存：${error.message}`, true); }
  finally { settingsSaving = false; $('save-settings').disabled = localBusy; $('save-settings').textContent = '保存设置'; }
}
async function leaveSettings() { if (settingsDirty) await commitSettings(true); else showSettings(false); }
$('open-settings').addEventListener('click', () => { if ($('settings-view').hidden) showSettings(true); else void leaveSettings(); });
$('close-settings').addEventListener('click', leaveSettings);
$('save-settings').addEventListener('click', () => commitSettings());
$('reset-settings').addEventListener('click', () => { showPacing(DEFAULT_PACING); settingsDirty = true; settingsStatus('已恢复默认节奏，保存后生效。'); });
$('controls-opacity').addEventListener('input', () => showAppearance({ opacity: Number($('controls-opacity').value) }));
$('reset-position').addEventListener('click', async () => {
  $('reset-position').disabled = true;
  try { await chrome.storage.local.set({ controlsPosition: DEFAULT_POSITION }); $('position-status').textContent = '已移回右下角。'; }
  catch (error) { $('position-status').textContent = `位置未保存：${error.message}`; }
  finally { $('reset-position').disabled = false; }
});
for (const input of $('settings-view').querySelectorAll('input,select')) input.addEventListener('input', () => {
  input.setCustomValidity(''); input.removeAttribute('aria-invalid'); settingsDirty = true;
  settingsStatus('有未保存的更改；保存或返回练习时生效。');
});
$('pause').addEventListener('click', () => perform(currentState?.paused ? 'resume' : 'pause'));
$('stop').addEventListener('click', () => perform('stop'));
$('permission').addEventListener('click', async () => {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id || !/^https?:\/\//.test(tab.url || '')) throw new Error('请先选中练习网页');
    const frames = await chrome.webNavigation.getAllFrames({ tabId: tab.id });
    const origins = [...new Set([tab.url, ...(frames || []).map((frame) => frame.url)].filter((url) => /^https?:\/\//.test(url)).map((url) => `${new URL(url).origin}/*`))];
    if (!await chrome.permissions.request({ origins })) throw new Error('未获得站点权限，无法读取跨域练习区域');
    await perform('read');
  } catch (error) { showError(error.message); }
});
chrome.runtime.onMessage.addListener((message) => { if (message.type === 'state') render(message.state); });
try {
  showPacing(DEFAULT_PACING); showAppearance(DEFAULT_APPEARANCE);
  const { provider, count, runAfterFill, pacing, runInBackground, controlsAppearance } = await chrome.storage.local.get(['provider', 'count', 'runAfterFill', 'pacing', 'runInBackground', 'controlsAppearance']);
  if (names[provider]) $('provider').value = provider;
  if (Number.isInteger(count) && count >= 1 && count <= 20) $('count').value = count;
  $('run-after-fill').checked = runAfterFill === true;
  $('background-run').checked = runInBackground !== false;
  let pacingError = '';
  try { showPacing(validatePacing(pacing)); }
  catch (error) { showPacing(DEFAULT_PACING); pacingError = `已保存的节奏配置无效，已显示默认值；请检查后保存。${error.message}`; }
  try { showAppearance(validateAppearance(controlsAppearance)); }
  catch (error) { pacingError += `外观配置已恢复默认值。${error.message}`; }
  updateSummary();
  render(await command('state'));
  await refreshHealth();
  if (pacingError) showError(pacingError);
} catch (error) { showError(error.message); }

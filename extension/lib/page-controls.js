/** 注入题目所在的隔离世界；保持 closed Shadow DOM，不向网页开放任务入口。 */
export function installPageControls(initialState, appearance = { opacity: 90 }, initialPosition = { x: 1, y: 1 }, ownerToken = null) {
  const previous = globalThis.__nexlyPageControls;
  if (previous?.revision === 7 && previous.host?.isConnected) {
    previous.ownerToken = ownerToken;
    previous.paint(initialState); previous.configure(appearance, initialPosition); return { ok: true };
  }
  try { if (previous?.cleanup) previous.cleanup(); else if (previous?.listener) chrome.runtime.onMessage.removeListener(previous.listener); } catch {}
  document.querySelector('[data-nexly-controls]')?.remove();
  const host = document.createElement('div'); host.setAttribute('data-nexly-controls', '');
  host.style.cssText = 'position:fixed;width:48px;height:48px;z-index:2147483646';
  const shadow = host.attachShadow({ mode: 'closed' });
  const style = document.createElement('style');
  style.textContent = `
    :host{all:initial}*{box-sizing:border-box}[hidden]{display:none!important}
    .widget{color:#161616;font:12px/1.5 -apple-system,BlinkMacSystemFont,"PingFang SC",sans-serif;letter-spacing:.16px;opacity:var(--opacity,.9);transition:opacity .14s}
    .widget.open{opacity:1}
    button{font:inherit;border:1px solid #d0d0d0;border-radius:4px;background:#fff;color:#161616;min-height:36px;padding:6px 10px;cursor:pointer}
    button:hover:not(:disabled){background:#f4f4f4}button:disabled{opacity:.4;cursor:not-allowed}
    button:focus-visible{outline:2px solid #0f62fe;outline-offset:2px}
    .launcher{display:grid;place-items:center;width:48px;height:48px;padding:8px;border-radius:12px;box-shadow:0 2px 10px #0002;cursor:grab;touch-action:none;position:relative}
    .launcher img{width:32px;height:32px;object-fit:contain;pointer-events:none}
    .dot{position:absolute;right:5px;bottom:5px;width:7px;height:7px;background:#8d8d8d;border:1px solid #fff;border-radius:50%}
    .widget[data-busy=true] .dot{background:#0f62fe}.widget[data-paused=true] .dot{background:#b28600}.widget[data-error=true] .dot{background:#da1e28}
    .popover{position:absolute;width:min(280px,calc(100vw - 16px));max-height:calc(100vh - 72px);overflow:auto;border:1px solid #d0d0d0;border-radius:4px;background:#fff;box-shadow:0 4px 20px #0002;visibility:hidden;opacity:0;pointer-events:none;transition:opacity .14s,visibility .14s}
    .open .popover{visibility:visible;opacity:1;pointer-events:auto}
    header{display:flex;align-items:center;gap:8px;padding:10px 12px;background:#f4f4f4;cursor:grab;touch-action:none;user-select:none}
    header strong{flex:1;font-size:13px;font-weight:600}header .grip{color:#6f6f6f;font-size:16px}header button{padding:0;width:28px;min-height:28px;border:0;background:transparent;font-size:18px}
    .body{padding:12px}.question{font-weight:600;margin:0 0 6px;overflow-wrap:anywhere;max-height:54px;overflow:auto}
    .status{margin:0 0 12px;overflow-wrap:anywhere}.error{color:#a2191f}.actions{display:flex;gap:6px}.actions button{flex:1}
    .actions button:first-child{background:#0f62fe;border-color:#0f62fe;color:#fff}.actions button:first-child:hover:not(:disabled){background:#0050e6}
    .course-tools{margin-top:8px}.course-tools button:first-child{background:#fff;border-color:#d0d0d0;color:#161616}.course-tools button:first-child:hover:not(:disabled){background:#f4f4f4}.progress{margin:0 0 12px;color:#525252}.progress progress{display:block;width:100%;height:6px;accent-color:#0f62fe;margin-bottom:5px}
    .panel-tools{display:flex;gap:6px;margin-top:8px}.panel-tools button{flex:1;background:transparent;color:#0f62fe}
    .hint{font-size:11px;color:#525252;margin:10px 0 0}.dragging .launcher,.dragging header{cursor:grabbing}
    @media(pointer:coarse){.actions button{min-height:48px}}@media(prefers-reduced-motion:reduce){*{transition:none!important}}
  `;
  const widget = document.createElement('div'); widget.className = 'widget';
  const launcher = document.createElement('button'); launcher.className = 'launcher'; launcher.type = 'button';
  launcher.setAttribute('aria-label', 'QuizMate 页内控制，悬浮展开，拖动移动'); launcher.setAttribute('aria-expanded', 'false'); launcher.setAttribute('aria-controls', 'quizmate-popover');
  launcher.title = '悬浮展开 · 拖动移动 · Alt + 方向键微调位置';
  const logo = document.createElement('img'); logo.src = chrome.runtime.getURL('icons/icon-32.png'); logo.alt = ''; logo.draggable = false;
  const dot = document.createElement('span'); dot.className = 'dot'; dot.setAttribute('aria-hidden', 'true'); launcher.append(logo, dot);
  const popover = document.createElement('section'); popover.className = 'popover'; popover.id = 'quizmate-popover'; popover.setAttribute('aria-label', 'QuizMate 页内控制'); popover.inert = true;
  const header = document.createElement('header'); header.title = '拖动移动';
  const grip = document.createElement('span'); grip.className = 'grip'; grip.textContent = '⠿'; grip.setAttribute('aria-hidden', 'true');
  const title = document.createElement('strong'); title.textContent = 'QuizMate';
  const close = document.createElement('button'); close.type = 'button'; close.textContent = '×'; close.setAttribute('aria-label', '收起页内控制');
  header.append(grip, title, close);
  const body = document.createElement('div'); body.className = 'body';
  const status = document.createElement('p'); status.className = 'status'; status.setAttribute('role', 'status');
  const questionLabel = document.createElement('p'); questionLabel.className = 'question'; questionLabel.hidden = true;
  const actions = document.createElement('div'); actions.className = 'actions';
  const start = document.createElement('button'), pause = document.createElement('button'), stop = document.createElement('button');
  for (const button of [start, pause, stop]) button.type = 'button';
  start.textContent = '开始'; pause.textContent = '暂停'; stop.textContent = '停止'; actions.append(start, pause, stop);
  const courseTools = document.createElement('div'); courseTools.className = 'actions course-tools'; courseTools.hidden = true;
  const refreshCourse = document.createElement('button'), nextChapter = document.createElement('button');
  refreshCourse.type = nextChapter.type = 'button'; refreshCourse.textContent = '重新识别'; nextChapter.textContent = '下一章';
  refreshCourse.title = '重新读取此标签页，不自动播放或调用 AI'; nextChapter.title = '打开平台下一章节，不跳过锁定与验证'; courseTools.append(refreshCourse, nextChapter);
  const courseProgress = document.createElement('div'); courseProgress.className = 'progress'; courseProgress.hidden = true;
  const progress = document.createElement('progress'); progress.max = 1; progress.setAttribute('aria-label', '当前视频播放进度');
  const progressLabel = document.createElement('span'); courseProgress.append(progress, progressLabel);
  const openPanel = document.createElement('button'); openPanel.type = 'button'; openPanel.className = 'open-panel'; openPanel.textContent = '打开侧栏';
  openPanel.title = '查看连接状态、设置与任务详情';
  const closePanel = document.createElement('button'); closePanel.type = 'button'; closePanel.className = 'close-panel'; closePanel.textContent = '关闭侧栏';
  closePanel.title = '仅关闭当前窗口的 QuizMate 侧栏，不停止课程或答题任务';
  const panelTools = document.createElement('div'); panelTools.className = 'panel-tools'; panelTools.append(openPanel, closePanel);
  const hint = document.createElement('p'); hint.className = 'hint'; hint.textContent = '使用已保存配置 · 最终提交由你操作';
  body.append(questionLabel, status, courseProgress, actions, courseTools, panelTools, hint); popover.append(header, body); widget.append(launcher, popover); shadow.append(style, widget); document.documentElement.append(host);
  const phases = { awaitingManual: '等待人工提交并换题', idle: '准备就绪', read: '题目已读取', reading: '读取题目中', solving: '模型求解中', delaying: '按配置等待填写', ready: '答案待复核', applying: '写入并核对中', filled: '已填写，未提交', testing: '等待样例执行结果', waiting: '等待平台开放操作', paused: '任务已暂停', stopped: '任务已停止', error: '任务遇到问题', interrupted: '任务已中断' };
  const pendingLabels = { start: '正在启动练习…', pause: '正在暂停…', resume: '正在继续…', stop: '正在停止…', scan: '正在重新识别课程…', nextChapter: '正在打开下一章…' };
  let current = initialState, pendingAction = null, panelPending = null, commandEpoch = 0, localError = '', position = { ...initialPosition }, expanded = false;
  let drag = null, collapseTimer, syncTimer, suppressClickUntil = 0, keyboard = false, suppressFocus = false, disposed = false, syncInvalidated = false;
  const disconnected = (error) => /extension context invalidated|receiving end does not exist|could not establish connection|message port closed/i.test(error?.message || '');
  const clamp = (value, min, max) => Math.min(Math.max(min, value), Math.max(min, max));
  function bounds() { return { width: Math.max(0, innerWidth - 64), height: Math.max(0, innerHeight - 64) }; }
  function layout() {
    const { width, height } = bounds();
    const x = 8 + position.x * width, y = 8 + position.y * height;
    host.style.left = `${x}px`; host.style.top = `${y}px`;
    const panelWidth = popover.offsetWidth, panelHeight = popover.offsetHeight;
    popover.style.left = `${clamp(x + 24 > innerWidth / 2 ? x + 48 - panelWidth : x, 8, innerWidth - panelWidth - 8) - x}px`;
    const above = y >= panelHeight + 8;
    popover.style.top = `${clamp(above ? y - panelHeight - 6 : y + 54, 8, innerHeight - panelHeight - 8) - y}px`;
  }
  function configure(nextAppearance, nextPosition) {
    if (nextAppearance) widget.style.setProperty('--opacity', String(nextAppearance.opacity / 100));
    if (nextPosition && !drag) position = { ...nextPosition };
    layout();
  }
  function setExpanded(value) {
    clearTimeout(collapseTimer);
    if (!value && popover.contains(shadow.activeElement)) {
      suppressFocus = true; launcher.focus({ preventScroll: true }); suppressFocus = false;
    }
    expanded = value; widget.classList.toggle('open', value); popover.inert = !value;
    launcher.setAttribute('aria-expanded', String(value));
    if (value) layout();
  }
  function scheduleCollapse() {
    clearTimeout(collapseTimer);
    collapseTimer = setTimeout(() => { if (!drag && !(keyboard && shadow.activeElement)) setExpanded(false); }, 160);
  }
  function paint(value) {
    const recovered = !value.error && (value.busy && !current?.busy
      || ['read', 'solving', 'ready', 'filled'].includes(value.phase) && value.phase !== current?.phase);
    if (recovered) { localError = ''; syncInvalidated = false; }
    current = value;
    const course = value.mode === 'course';
    title.textContent = course ? 'QuizMate · 网课' : 'QuizMate';
    hint.textContent = course ? '正常播放 · 验证与提交由你处理 · 外观在侧栏设置' : '使用已保存配置 · 最终提交由你操作';
    courseTools.hidden = !course;
    refreshCourse.disabled = Boolean(pendingAction || value.busy || value.operation);
    nextChapter.disabled = Boolean(pendingAction || value.operation || value.unavailable || !value.hasNext);
    start.textContent = course && value.paused ? '继续' : '开始';
    start.disabled = Boolean(pendingAction || value.busy || value.operation || value.unavailable);
    pause.disabled = Boolean(pendingAction || !value.busy || value.operation); pause.textContent = !course && value.paused ? '继续' : '暂停';
    stop.disabled = pendingAction === 'stop' || !(pendingAction || value.busy || value.operation || course && value.bound && value.phase !== 'stopped');
    openPanel.disabled = closePanel.disabled = Boolean(panelPending);
    openPanel.textContent = panelPending === 'openPanel' ? '正在打开…' : '打开侧栏';
    closePanel.textContent = panelPending === 'closePanel' ? '正在关闭…' : '关闭侧栏';
    questionLabel.textContent = value.questionTitle || ''; questionLabel.hidden = !value.questionTitle;
    const error = localError || (!pendingAction && value.error);
    status.className = `status${error ? ' error' : ''}`;
    const coursePhases = { idle: '课程待识别', ready: '课程已识别', starting: '正在启动播放', playing: '正在播放', navigating: '正在切换章节', awaitingQuiz: '随堂练习待人工确认', complete: '已到目录末尾', blocked: '等待平台验证' };
    const phaseText = course && coursePhases[value.phase] || phases[value.phase] || value.phase;
    courseProgress.hidden = !course || !value.media?.duration;
    if (!courseProgress.hidden) { progress.value = Math.max(0, Math.min(1, value.media.currentTime / value.media.duration)); progressLabel.textContent = `${Math.round(progress.value * 100)}% · ${value.media.rate}× · 本次播放结束 ${value.watched || 0} 段`; }
    const elapsedText = value.phase === 'solving' && value.elapsedSeconds ? ` · ${value.elapsedSeconds} 秒` : '';
    const typingText = value.typingProgress ? ` · ${value.typingProgress.written}/${value.typingProgress.total}` : '';
    const completedText = value.completed ? ` · 已填写 ${value.completed} 题` : '';
    status.textContent = error || (pendingAction === 'start' && course ? '正在启动课程…' : pendingLabels[pendingAction]) || (course ? value.message : '') || `${phaseText}${elapsedText}${typingText}${completedText}`;
    widget.dataset.busy = String(Boolean(pendingAction || value.busy || value.operation)); widget.dataset.paused = String(Boolean(value.paused)); widget.dataset.error = String(Boolean(error));
    launcher.setAttribute('aria-label', `QuizMate 页内控制：${phaseText}。悬浮展开，拖动移动`);
    if (expanded) layout();
  }
  async function send(event, action) {
    // 合成点击不能启动任务；拖动松手产生的 click 也不执行任务。
    if (!event.isTrusted || disposed || performance.now() < suppressClickUntil) return;
    const panel = ['openPanel', 'closePanel'].includes(action);
    if (panel ? panelPending : pendingAction && action !== 'stop') return;
    if (action === 'stop' && pendingAction === 'stop') return;
    const epoch = panel ? commandEpoch : ++commandEpoch;
    if (panel) panelPending = action;
    else { pendingAction = action; localError = ''; }
    paint(current);
    try {
      const response = await chrome.runtime.sendMessage({ type: 'command', source: 'page-controls', action });
      if (!response?.ok) throw new Error(response?.error || '扩展已更新或连接失效，请刷新当前练习页后重试');
      if (!panel && typeof response.data?.phase !== 'string') throw new Error('扩展返回状态不完整，请打开侧栏查看连接状态。');
      if (!panel && !disposed && epoch === commandEpoch) paint(response.data);
    } catch (error) {
      if (!disposed && epoch === commandEpoch) { localError = readableError(error); setExpanded(true); }
    } finally {
      if (panel) panelPending = null;
      else if (epoch === commandEpoch) pendingAction = null;
      if (!disposed && (panel || epoch === commandEpoch)) paint(current);
    }
  }
  function readableError(error) {
    return disconnected(error)
      ? '扩展已更新或连接失效，请刷新当前练习页，再打开 QuizMate。'
      : error?.message || '连接暂不可用，请打开侧栏查看连接状态。';
  }
  async function savePosition() {
    try {
      const response = await chrome.runtime.sendMessage({ type: 'command', source: 'page-controls', action: 'moveControls', position });
      if (!response?.ok) throw new Error(response?.error || '位置未能保存，请重新启用页内控制');
    } catch (error) { if (!disposed) { localError = readableError(error); paint(current); setExpanded(true); } }
  }
  refreshCourse.addEventListener('click', (event) => { void send(event, 'scan'); });
  nextChapter.addEventListener('click', (event) => { void send(event, 'nextChapter'); });
  start.addEventListener('click', (event) => { void send(event, 'start'); });
  pause.addEventListener('click', (event) => { void send(event, current.paused ? 'resume' : 'pause'); });
  stop.addEventListener('click', (event) => { void send(event, 'stop'); });
  openPanel.addEventListener('click', (event) => { void send(event, 'openPanel'); });
  closePanel.addEventListener('click', (event) => { void send(event, 'closePanel'); });
  launcher.addEventListener('click', (event) => {
    if (!event.isTrusted || performance.now() < suppressClickUntil) return;
    if (event.detail === 0) { keyboard = true; setExpanded(true); [start, pause, stop, refreshCourse, nextChapter, openPanel, closePanel].find((button) => !button.disabled)?.focus(); }
    else setExpanded(!expanded);
  });
  close.addEventListener('click', (event) => { if (event.isTrusted) { keyboard = false; setExpanded(false); } });
  host.addEventListener('pointerenter', (event) => { if (event.pointerType !== 'touch' && !drag) setExpanded(true); });
  host.addEventListener('pointerleave', scheduleCollapse);
  shadow.addEventListener('pointerdown', () => { keyboard = false; });
  shadow.addEventListener('focusin', () => { if (!suppressFocus && (keyboard || launcher.matches(':focus-visible'))) { keyboard = true; setExpanded(true); } });
  shadow.addEventListener('focusout', () => { queueMicrotask(() => { if (!shadow.activeElement) { keyboard = false; scheduleCollapse(); } }); });
  shadow.addEventListener('keydown', (event) => {
    if (!event.isTrusted) return;
    keyboard = true;
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); keyboard = false; setExpanded(false); }
    if (event.altKey && ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) {
      event.preventDefault(); event.stopPropagation();
      const { width, height } = bounds();
      position.x = clamp(position.x + (event.key === 'ArrowLeft' ? -16 : event.key === 'ArrowRight' ? 16 : 0) / Math.max(1, width), 0, 1);
      position.y = clamp(position.y + (event.key === 'ArrowUp' ? -16 : event.key === 'ArrowDown' ? 16 : 0) / Math.max(1, height), 0, 1);
      layout(); void savePosition();
    }
  });
  function beginDrag(event) {
    if (!event.isTrusted || event.button !== 0 || !event.isPrimary || event.target === close) return;
    const rect = host.getBoundingClientRect();
    drag = { id: event.pointerId, element: event.currentTarget, x: event.clientX, y: event.clientY, left: rect.left, top: rect.top, position: { ...position }, moved: false };
    event.currentTarget.setPointerCapture(event.pointerId); event.preventDefault(); clearTimeout(collapseTimer);
  }
  function moveDrag(event) {
    if (!drag || drag.id !== event.pointerId) return;
    const dx = event.clientX - drag.x, dy = event.clientY - drag.y;
    if (!drag.moved && Math.hypot(dx, dy) < 5) return;
    drag.moved = true; widget.classList.add('dragging'); setExpanded(false);
    const { width, height } = bounds();
    position = { x: clamp((drag.left + dx - 8) / Math.max(1, width), 0, 1), y: clamp((drag.top + dy - 8) / Math.max(1, height), 0, 1) }; layout();
  }
  function endDrag(event) {
    if (!drag || drag.id !== event.pointerId) return;
    const ended = drag; drag = null; widget.classList.remove('dragging');
    if (ended.element.hasPointerCapture(event.pointerId)) ended.element.releasePointerCapture(event.pointerId);
    if (event.type === 'pointercancel') { position = ended.position; layout(); }
    else if (ended.moved) { suppressClickUntil = performance.now() + 400; void savePosition(); }
    scheduleCollapse();
  }
  for (const handle of [launcher, header]) {
    handle.addEventListener('pointerdown', beginDrag); handle.addEventListener('pointermove', moveDrag);
    for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) handle.addEventListener(type, endDrag);
  }
  const listener = (message) => {
    if (message.type === 'page-state') {
      const value = message.state;
      const justStopped = ['stopped', 'interrupted'].includes(value.phase) && (value.phase !== current?.phase || current?.busy);
      if (justStopped && pendingAction !== 'stop') { commandEpoch++; pendingAction = null; }
      paint(value);
    }
    if (message.type === 'page-appearance') configure(message.appearance, message.position);
  };
  chrome.runtime.onMessage.addListener(listener);
  window.addEventListener('resize', layout);
  const scheduleSync = () => {
    if (disposed || syncInvalidated) return;
    clearTimeout(syncTimer);
    syncTimer = setTimeout(() => {
      const failed = (error) => {
        if (!disposed && disconnected(error)) { syncInvalidated = true; localError = readableError(error); paint(current); }
      };
      try { void Promise.resolve(chrome.runtime.sendMessage({ type: 'command', source: 'page-controls', action: 'pageChanged' })).catch(failed); }
      catch (error) { failed(error); }
    }, 500);
  };
  // 忽略代码逐字渲染和自身组件，避免把输入或拖动误认为换题。
  const ignored = '[data-nexly-controls],script,style,.ace_editor,.monaco-editor,.CodeMirror,textarea,input,[contenteditable="true"],.ant-tabs-content-holder,.test-results';
  const observer = new MutationObserver((mutations) => {
    if (mutations.some((mutation) => { const node = mutation.target.nodeType === 1 ? mutation.target : mutation.target.parentElement; return node && !node.closest(ignored); })) scheduleSync();
  });
  observer.observe(document.documentElement, { subtree: true, childList: true, characterData: true });
  const onChange = (event) => { if (event.target instanceof Element && (event.target.matches('select') || event.target.closest('.ant-select,.el-select'))) scheduleSync(); };
  document.addEventListener('change', onChange, true);
  const cleanup = () => {
    disposed = true; commandEpoch++; observer.disconnect(); clearTimeout(syncTimer); clearTimeout(collapseTimer);
    window.removeEventListener('resize', layout); document.removeEventListener('change', onChange, true); chrome.runtime.onMessage.removeListener(listener); host.remove();
  };
  globalThis.__nexlyPageControls = { host, paint, configure, listener, cleanup, revision: 7, ownerToken };
  configure(appearance, initialPosition); paint(initialState);
  return { ok: true };
}

/** 关闭“自动启用页内组件”后移除已注入的悬浮组件，不触碰网页自身节点。 */
export function removePageControls(expectedOwnerToken = null) {
  const previous = globalThis.__nexlyPageControls;
  if (expectedOwnerToken !== null && previous?.ownerToken !== expectedOwnerToken) return { ok: true, removed: false, skipped: true };
  try {
    if (previous?.cleanup) previous.cleanup();
    else if (previous?.listener) chrome.runtime.onMessage.removeListener(previous.listener);
  } catch {}
  document.querySelector('[data-nexly-controls]')?.remove();
  globalThis.__nexlyPageControls = null;
  return { ok: true, removed: Boolean(previous) };
}

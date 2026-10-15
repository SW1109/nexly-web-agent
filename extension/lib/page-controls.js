/** 注入题目所在的隔离世界；保持 closed Shadow DOM，不向网页开放任务入口。 */
export function installPageControls(initialState, appearance = { opacity: 90 }, initialPosition = { x: 1, y: 1 }) {
  const previous = globalThis.__nexlyPageControls;
  if (previous?.revision === 3 && previous.host?.isConnected) {
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
    .hint{font-size:11px;color:#525252;margin:10px 0 0}.dragging .launcher,.dragging header{cursor:grabbing}
    @media(pointer:coarse){.actions button{min-height:48px}}@media(prefers-reduced-motion:reduce){*{transition:none!important}}
  `;
  const widget = document.createElement('div'); widget.className = 'widget';
  const launcher = document.createElement('button'); launcher.className = 'launcher'; launcher.type = 'button';
  launcher.setAttribute('aria-label', 'Nexly 页内控制，悬浮展开，拖动移动'); launcher.setAttribute('aria-expanded', 'false'); launcher.setAttribute('aria-controls', 'nexly-popover');
  launcher.title = '悬浮展开 · 拖动移动 · Alt + 方向键微调位置';
  const logo = document.createElement('img'); logo.src = chrome.runtime.getURL('icons/icon-32.png'); logo.alt = ''; logo.draggable = false;
  const dot = document.createElement('span'); dot.className = 'dot'; dot.setAttribute('aria-hidden', 'true'); launcher.append(logo, dot);
  const popover = document.createElement('section'); popover.className = 'popover'; popover.id = 'nexly-popover'; popover.setAttribute('aria-label', 'Nexly 页内控制'); popover.inert = true;
  const header = document.createElement('header'); header.title = '拖动移动';
  const grip = document.createElement('span'); grip.className = 'grip'; grip.textContent = '⠿'; grip.setAttribute('aria-hidden', 'true');
  const title = document.createElement('strong'); title.textContent = 'Nexly';
  const close = document.createElement('button'); close.type = 'button'; close.textContent = '×'; close.setAttribute('aria-label', '收起页内控制');
  header.append(grip, title, close);
  const body = document.createElement('div'); body.className = 'body';
  const status = document.createElement('p'); status.className = 'status'; status.setAttribute('role', 'status');
  const questionLabel = document.createElement('p'); questionLabel.className = 'question'; questionLabel.hidden = true;
  const actions = document.createElement('div'); actions.className = 'actions';
  const start = document.createElement('button'), pause = document.createElement('button'), stop = document.createElement('button');
  for (const button of [start, pause, stop]) button.type = 'button';
  start.textContent = '开始'; pause.textContent = '暂停'; stop.textContent = '停止'; actions.append(start, pause, stop);
  const hint = document.createElement('p'); hint.className = 'hint'; hint.textContent = '使用已保存配置 · 最终提交由你操作';
  body.append(questionLabel, status, actions, hint); popover.append(header, body); widget.append(launcher, popover); shadow.append(style, widget); document.documentElement.append(host);
  const phases = { awaitingManual: '等待人工提交并换题', idle: '可以开始', reading: '读取题目中', read: '题目已读取', solving: 'CLI 求解中', delaying: '按配置等待填写', applying: '输入答案中', filled: '已填写，未提交', paused: '已暂停', stopped: '已停止', error: '任务遇到问题', ready: '答案待处理', waiting: '等待平台开放操作', testing: '等待样例结果', interrupted: '任务已中断' };
  let current = initialState, pending = false, position = { ...initialPosition }, expanded = false;
  let drag = null, collapseTimer, syncTimer, suppressClickUntil = 0, keyboard = false, suppressFocus = false, disposed = false;
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
    current = value;
    start.disabled = pending || value.busy;
    pause.disabled = pending || !value.busy; pause.textContent = value.paused ? '继续' : '暂停';
    stop.disabled = pending || !value.busy;
    questionLabel.textContent = value.questionTitle || ''; questionLabel.hidden = !value.questionTitle;
    status.className = `status${value.error ? ' error' : ''}`;
    status.textContent = value.error || `${phases[value.phase] || value.phase}${value.typingProgress ? ` · ${value.typingProgress.written}/${value.typingProgress.total}` : ''}${value.completed ? ` · 已填 ${value.completed} 题` : ''}`;
    widget.dataset.busy = String(Boolean(value.busy)); widget.dataset.paused = String(Boolean(value.paused)); widget.dataset.error = String(Boolean(value.error));
    launcher.setAttribute('aria-label', `Nexly 页内控制：${phases[value.phase] || value.phase}。悬浮展开，拖动移动`);
    if (expanded) layout();
  }
  async function send(event, action) {
    // 合成点击不能启动 CLI；拖动松手产生的 click 也不执行任务。
    if (!event.isTrusted || pending || performance.now() < suppressClickUntil) return;
    pending = true; paint(current);
    try {
      const response = await chrome.runtime.sendMessage({ type: 'command', source: 'page-controls', action });
      if (!response?.ok) throw new Error(response?.error || '扩展已更新或连接失效，请重新启用页内控制');
      if (!disposed) paint(response.data);
    } catch (error) { status.className = 'status error'; status.textContent = error.message; }
    finally { pending = false; start.disabled = current.busy; pause.disabled = !current.busy; stop.disabled = !current.busy; }
  }
  async function savePosition() {
    try {
      const response = await chrome.runtime.sendMessage({ type: 'command', source: 'page-controls', action: 'moveControls', position });
      if (!response?.ok) throw new Error(response?.error || '位置未能保存，请重新启用页内控制');
    } catch (error) { if (!disposed) { status.className = 'status error'; status.textContent = error.message; setExpanded(true); } }
  }
  start.addEventListener('click', (event) => { void send(event, 'start'); });
  pause.addEventListener('click', (event) => { void send(event, current.paused ? 'resume' : 'pause'); });
  stop.addEventListener('click', (event) => { void send(event, 'stop'); });
  launcher.addEventListener('click', (event) => {
    if (!event.isTrusted || performance.now() < suppressClickUntil) return;
    if (event.detail === 0) { keyboard = true; setExpanded(true); (start.disabled ? pause : start).focus(); }
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
    if (message.type === 'page-state') paint(message.state);
    if (message.type === 'page-appearance') configure(message.appearance, message.position);
  };
  chrome.runtime.onMessage.addListener(listener);
  window.addEventListener('resize', layout);
  const scheduleSync = () => {
    clearTimeout(syncTimer);
    syncTimer = setTimeout(() => { void chrome.runtime.sendMessage({ type: 'command', source: 'page-controls', action: 'pageChanged' }).catch(() => {}); }, 500);
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
    disposed = true; observer.disconnect(); clearTimeout(syncTimer); clearTimeout(collapseTimer);
    window.removeEventListener('resize', layout); document.removeEventListener('change', onChange, true); chrome.runtime.onMessage.removeListener(listener); host.remove();
  };
  globalThis.__nexlyPageControls = { host, paint, configure, listener, cleanup, revision: 3 };
  configure(appearance, initialPosition); paint(initialState);
  return { ok: true };
}

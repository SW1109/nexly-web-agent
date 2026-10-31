import { COURSE_PLATFORMS, coursePlatform } from './course-platforms.js';
import { activePracticeTab } from './tab-access.js';

/** 只组织入口与展示；任务绑定、授权和执行仍由原来的后台负责。 */
export function createPanelLayout({ onWorkspace = () => {}, onInspect = () => {}, onLeaveSettings = async () => {} } = {}) {
  const $ = (id) => document.getElementById(id);
  const workspaces = ['home', 'course', 'practice', 'records'];
  const categories = ['connection', 'course', 'practice', 'controls', 'license', 'about'];
  let workspace = 'home', settingsCategory = 'connection', taskScroll = 0, contextEpoch = 0, contextPlatform = null, contextAvailable = false, busy = false, invalidField = null;
  function selectSettings(category, focus = false) {
    if (!categories.includes(category)) return;
    settingsCategory = category; document.body.dataset.settingsCategory = category;
    // 卡密以兑换/核对按钮即时处理，不要求再保存模型或任务设置。
    $('settings-footer').hidden = category === 'license';
    for (const name of categories) {
      const selected = name === category, tab = $(`setting-${name}`);
      tab.setAttribute('aria-selected', String(selected)); tab.tabIndex = selected ? 0 : -1;
      $(`settings-${name}`).hidden = !selected;
    }
    const active = $(`setting-${category}`), nav = active.parentElement;
    const bounds = active.getBoundingClientRect(), viewport = nav.getBoundingClientRect();
    if (bounds.left < viewport.left) nav.scrollLeft -= viewport.left - bounds.left + 8;
    else if (bounds.right > viewport.right) nav.scrollLeft += bounds.right - viewport.right + 8;
    if (focus) active.focus({ preventScroll: true });
  }
  function showSettings(open, focus = true, category = settingsCategory) {
    if (open && $('settings-view').hidden) taskScroll = window.scrollY;
    $('settings-view').hidden = !open; $('task-view').hidden = open;
    if (open) selectSettings(category);
    $('open-settings').setAttribute('aria-expanded', String(open));
    document.body.dataset.view = open ? 'settings' : workspace;
    if (focus) (open ? $('settings-title') : $('open-settings')).focus({ preventScroll: true });
    window.scrollTo(0, open ? 0 : taskScroll);
  }
  function showWorkspace(name, focus = false, notify = true) {
    if (!workspaces.includes(name)) return;
    workspace = name;
    for (const item of workspaces) {
      const selected = item === name, tab = $(`tab-${item}`);
      $(`${item}-workspace`).hidden = !selected;
      tab.setAttribute('aria-selected', String(selected)); tab.tabIndex = selected ? 0 : -1;
    }
    if (focus) $(`tab-${name}`).focus({ preventScroll: true });
    document.body.dataset.view = name;
    window.scrollTo(0, 0);
    if (name === 'home') void refreshContext();
    if (notify) onWorkspace(name);
  }
  async function navigate(name, focus = false) {
    if (!$('settings-view').hidden) {
      await onLeaveSettings();
      // 保存/校验失败时留在设置，不把错误字段藏到工作区后面。
      if (!$('settings-view').hidden) return;
    }
    showWorkspace(name, focus);
  }
  function revealSetting(input) {
    invalidField = input;
    const category = input.closest('[data-settings-panel]')?.dataset.settingsPanel;
    if (category) showSettings(true, false, category);
    input.closest('details')?.setAttribute('open', '');
  }
  function keyboardTabs(event, values, current, select) {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const index = event.key === 'Home' ? 0 : event.key === 'End' ? values.length - 1 : (values.indexOf(current) + (event.key === 'ArrowRight' ? 1 : -1) + values.length) % values.length;
    select(values[index], true);
  }
  for (const name of workspaces) {
    $(`tab-${name}`).addEventListener('click', () => void navigate(name));
    $(`tab-${name}`).addEventListener('keydown', (event) => keyboardTabs(event, workspaces, name, (next) => void navigate(next, true)));
  }
  for (const tab of document.querySelectorAll('[data-settings-tab]')) {
    tab.addEventListener('click', () => selectSettings(tab.dataset.settingsTab));
    tab.addEventListener('keydown', (event) => keyboardTabs(event, categories, tab.dataset.settingsTab, selectSettings));
  }
  for (const link of document.querySelectorAll('[data-workspace]')) link.addEventListener('click', () => void navigate(link.dataset.workspace));
  for (const link of document.querySelectorAll('[data-settings-target]')) link.addEventListener('click', () => showSettings(true, true, link.dataset.settingsTarget));
  for (const button of document.querySelectorAll('[data-record-filter]')) button.addEventListener('click', () => {
    const kind = button.dataset.recordFilter;
    for (const item of document.querySelectorAll('[data-record-filter]')) item.setAttribute('aria-pressed', String(item === button));
    for (const group of document.querySelectorAll('[data-record-kind]')) group.hidden = kind !== 'all' && kind !== group.dataset.recordKind;
  });
  for (const platform of COURSE_PLATFORMS) {
    const link = document.createElement('a'); link.href = platform.home; link.target = '_blank'; link.rel = 'noopener noreferrer';
    const name = document.createElement('strong'), host = document.createElement('span');
    name.textContent = platform.name; host.textContent = new URL(platform.home).hostname;
    link.append(name, host); $('platform-links').append(link);
  }
  async function refreshContext() {
    const expected = ++contextEpoch;
    $('context-refresh').disabled = true; contextAvailable = false; $('context-inspect').disabled = true;
    try {
      const tab = await activePracticeTab();
      if (expected !== contextEpoch) return;
      let url;
      try { url = new URL(tab?.url); } catch {}
      contextAvailable = Boolean(url && /^https?:$/.test(url.protocol));
      contextPlatform = contextAvailable ? coursePlatform(url.href) : null;
      $('context-kind').textContent = contextPlatform ? '已识别网课平台' : contextAvailable ? '当前网页' : '等待打开网页';
      $('context-title').textContent = contextPlatform?.name || (contextAvailable ? '读取当前网页的练习题' : '打开一门课程或一页练习');
      $('context-host').textContent = contextAvailable ? url.hostname : '浏览器内置页与扩展页面不能作为学习目标';
      $('context-hint').textContent = contextPlatform ? '已接入该平台。点击后识别课程与章节，确认开始后才会播放。' : contextAvailable ? '点击后仅读取题目；首次使用可能请求当前站点权限，不会直接求解或提交。' : '回到课程视频页或练习页，再打开侧栏。';
      $('context-inspect').textContent = contextPlatform ? '识别这门课程 →' : '读取当前练习 →';
      $('context-inspect').disabled = !contextAvailable || busy;
    } catch {
      contextAvailable = false; contextPlatform = null;
      $('context-title').textContent = '暂时无法读取当前标签页';
      $('context-host').textContent = ''; $('context-hint').textContent = '回到课程或练习页后点击刷新，不会更改原任务的绑定。';
      $('context-inspect').disabled = true;
    } finally { if (expected === contextEpoch) $('context-refresh').disabled = false; }
  }
  $('context-refresh').addEventListener('click', () => void refreshContext());
  $('context-inspect').addEventListener('click', () => {
    if (!contextAvailable || busy) return;
    const next = contextPlatform ? 'course' : 'practice';
    showWorkspace(next, false, false);
    // 权限请求仍直接沿用用户的这次点击，不通过自动播放/后台定时器触发。
    onInspect(next);
  });
  chrome.tabs?.onActivated?.addListener(() => { if (workspace === 'home' && $('settings-view').hidden) void refreshContext(); });
  chrome.tabs?.onUpdated?.addListener((_id, change, tab) => { if (tab.active && change.url && workspace === 'home' && $('settings-view').hidden) void refreshContext(); });
  return {
    showSettings, showWorkspace, revealSetting,
    focusInvalid() {
      const input = invalidField; invalidField = null;
      if (input?.matches(':invalid,[aria-invalid="true"]') && !input.disabled) {
        revealSetting(input); invalidField = null; input.focus(); input.reportValidity();
      }
    },
    render({ practice, course, status, modelName, modelStatus, consent, pending }) {
      busy = Boolean(pending || practice?.busy || course?.running || course?.operation);
      $('context-inspect').disabled = busy || !contextAvailable;
      $('home-model-name').textContent = modelName;
      $('home-model-status').textContent = modelStatus;
      $('home-consent').hidden = consent;
      $('home-consent-hint').textContent = consent ? '已确认 AI 数据使用说明。' : 'AI 尚未启用：请先阅读并确认练习区的数据说明。';
      $('home-practice-status').textContent = status;
      $('home-practice-title').textContent = practice?.question?.title || '选择 · 填空 · 编程 · 日志修正';
      $('home-course-status').textContent = course?.running ? '课程进行中 · 查看控制' : course?.snapshot ? '课程已识别 · 查看详情' : '尚未识别课程';
      $('home-course-title').textContent = course?.snapshot?.title || '正常播放 · 安全换章 · 随堂练习';
      const count = (practice?.log?.length || 0) + (course?.log?.length || 0);
      $('record-total').textContent = String(count); $('record-total').hidden = !count;
    },
    async init() {
      const requested = new URLSearchParams(location.search).get('view');
      let pending;
      try { ({ panelRequestedView: pending } = await chrome.storage.session.get('panelRequestedView')); } catch {}
      const initial = workspaces.includes(requested) ? requested : pending && Date.now() - pending.at < 15000 && workspaces.includes(pending.view) ? pending.view : 'home';
      showWorkspace(initial);
    }
  };
}

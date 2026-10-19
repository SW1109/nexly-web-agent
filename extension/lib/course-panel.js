import { COURSE_SETTINGS, COURSE_FIELDS, COURSE_PLATFORMS, courseSession, coursePlatform, validateCourseSettings } from './course-platforms.js';
import { createTaskLog } from './panel-log.js';

export function createCoursePanel({ onPractice, onChange = () => {}, onInvalid = () => {} }) {
  const $ = (id) => document.getElementById(id);
  const log = createTaskLog({ list: $('course-log'), count: $('course-log-count'), jump: $('course-log-latest') });
  let state = courseSession(), pending = false, practiceBusy = false, accepted = false, settingsBusy = false, failure = '', operationEpoch = 0;
  const labels = { idle: '尚未识别', ready: '准备就绪', starting: '准备播放', playing: '正常播放中', paused: '已暂停', blocked: '等待人工处理', awaitingQuiz: '等待随堂练习', navigating: '正在切换章节', complete: '已到目录末尾', error: '需要处理', stopped: '已停止', interrupted: '任务已中断' };
  const time = (seconds) => { const value = Math.max(0, Math.floor(seconds || 0)); return `${Math.floor(value / 60)}:${String(value % 60).padStart(2, '0')}`; };
  const tell = (message) => { $('course-error').textContent = message || ''; $('course-error').hidden = !message; };
  async function command(action, data = {}) {
    const response = await chrome.runtime.sendMessage({ type: 'course-command', action, ...data });
    if (!response?.ok) throw new Error(response?.error || '课程后台暂不可用，请重新加载扩展后再试');
    return response.data;
  }
  function render() {
    const snapshot = state.snapshot, busy = pending || Boolean(state.operation), active = state.running || busy;
    $('course-status').textContent = labels[state.phase] || '等待操作';
    $('course-status').dataset.phase = state.phase;
    $('course-message').textContent = state.message;
    $('course-empty').hidden = Boolean(snapshot);
    $('course-current').hidden = !snapshot;
    $('course-scan').disabled = active || practiceBusy;
    $('course-start').disabled = !snapshot || busy || state.running || practiceBusy;
    $('course-start').textContent = ['paused', 'interrupted', 'error', 'blocked', 'awaitingQuiz', 'stopped'].includes(state.phase) ? '确认并继续' : '开始课程';
    const currentChapters = snapshot?.chapters.filter((item) => item.current) || [];
    $('course-next').disabled = busy || practiceBusy || !snapshot || !(snapshot.nextChapter || currentChapters.length === 1 && snapshot.chapters[currentChapters[0].index + 1]);
    $('course-pause').disabled = !state.running && !busy;
    $('course-stop').disabled = !snapshot && !busy;
    $('course-clear').disabled = active || practiceBusy;
    $('course-settings-open').disabled = settingsBusy;
    $('course-bound-tab').textContent = state.tabId == null ? '尚未绑定课程标签页' : '已绑定课程页 · 切换标签不会改绑';
    $('course-focus').disabled = state.tabId == null;
    if (snapshot) {
      $('course-platform').textContent = COURSE_PLATFORMS.find((item) => item.id === state.platformId)?.name || '已识别平台';
      $('course-name').textContent = snapshot.title || '当前课程';
      const current = snapshot.chapters.filter((item) => item.current);
      $('course-chapter').textContent = current.length === 1 ? current[0].title : snapshot.nextChapter ? '目录未定位当前章节，将使用平台唯一的“下一页”活动链接' : '当前章节尚未唯一确认；不自动猜测下一章';
      const media = snapshot.media;
      $('course-progress').value = media.duration > 0 ? Math.min(100, media.currentTime / media.duration * 100) : 0;
      $('course-progress-label').textContent = media.count === 1 ? `${time(media.currentTime)} / ${time(media.duration)} · ${media.rate}×` : snapshot.questions.length ? '已识别练习题，等待处理' : '请先在原页面打开视频';
    }
    $('course-watched').textContent = `本次播放结束 ${state.watched || 0} 段`;
    $('course-directory-empty').textContent = snapshot?.nextChapter ? '未读取到完整目录，已找到平台唯一的“下一页”活动链接；播放结束后可继续换章。' : '尚未读到目录。可在原页面展开章节列表后重新识别；没有唯一安全目标时不会猜测下一章。';
    $('course-chapter-count').textContent = `${snapshot?.chapters.length || 0} 项`;
    const chapters = snapshot?.chapters || [], signature = JSON.stringify([chapters, active, practiceBusy]);
    if ($('course-chapters').dataset.signature !== signature) {
      $('course-chapters').dataset.signature = signature;
      const fragment = document.createDocumentFragment();
      for (const item of chapters) {
        const row = document.createElement('li'), button = document.createElement('button');
        button.type = 'button'; button.className = 'course-chapter-button'; button.dataset.key = item.key; button.dataset.title = item.title.toLocaleLowerCase();
        button.disabled = active || practiceBusy || item.locked;
        if (item.current) button.setAttribute('aria-current', 'step');
        const mark = document.createElement('span'); mark.className = 'course-chapter-mark'; mark.textContent = item.locked ? '锁定' : item.current ? '当前' : String(item.index + 1);
        const title = document.createElement('span'); title.textContent = item.title;
        const tag = document.createElement('small'); tag.textContent = item.kind === 'quiz' ? '练习' : item.kind === 'document' ? '阅读' : '章节';
        button.append(mark, title, tag); row.append(button); fragment.append(row);
      }
      $('course-chapters').replaceChildren(fragment);
    }
    $('course-directory-empty').hidden = chapters.length > 0;
    filterChapters();
    $('course-locate').disabled = !chapters.some((item) => item.current);
    const questions = snapshot?.questions || [], questionSignature = JSON.stringify(questions);
    $('course-quiz').hidden = !questions.length;
    if ($('course-question').dataset.signature !== questionSignature) {
      $('course-question').dataset.signature = questionSignature;
      const placeholder = document.createElement('option'); placeholder.value = ''; placeholder.textContent = questions.length === 1 ? '当前只有一道题，可直接预览' : '请选择要解答的题目';
      const options = questions.map((question) => { const option = document.createElement('option'); option.value = question.key; option.textContent = `${question.index + 1}. ${question.title}`; option.selected = question.selected; return option; });
      $('course-question').replaceChildren(placeholder, ...options);
    }
    $('course-question').disabled = active || practiceBusy;
    for (const id of ['course-preview', 'course-fill']) $(id).disabled = active || practiceBusy || !accepted;
    $('course-ai-hint').textContent = !accepted ? '先到练习区阅读并同意 AI 数据使用说明。' : practiceBusy ? 'AI 任务运行中，请到练习区查看；提交与交卷始终由你确认。' : '只处理选中的本题；题目发送给你配置的 AI，置信度达标才填写，不会自动提交。';
    log(state.log || []);
    if (!pending) tell(state.error || failure);
  }
  async function perform(action, data = {}) {
    const interrupt = ['pause', 'stop'].includes(action);
    if (pending && !interrupt) return;
    const expected = ++operationEpoch;
    pending = true; failure = ''; tell(''); render(); onChange();
    try { const result = await command(action, data); if (expected !== operationEpoch) return; state = result; if (['previewQuiz', 'fillQuiz'].includes(action)) onPractice(); }
    catch (error) { if (expected === operationEpoch) { failure = error.message; tell(failure); } }
    finally { if (expected === operationEpoch) { pending = false; render(); onChange(); } }
  }
  function filterChapters() {
    const term = $('course-directory-search').value.trim().toLocaleLowerCase();
    let shown = 0;
    for (const button of $('course-chapters').querySelectorAll('button')) {
      button.parentElement.hidden = !button.dataset.title.includes(term);
      if (!button.parentElement.hidden) shown++;
    }
    $('course-filter-empty').hidden = !term || shown > 0 || !state.snapshot?.chapters.length;
  }
  $('course-directory-search').addEventListener('input', filterChapters);
  $('course-locate').addEventListener('click', () => {
    $('course-directory-search').value = ''; filterChapters();
    const current = $('course-chapters').querySelector('[aria-current="step"]');
    current?.scrollIntoView({ block: 'nearest', behavior: 'instant' });
    current?.focus({ preventScroll: true });
  });
  $('course-scan').addEventListener('click', () => perform('scan'));
  $('course-next').addEventListener('click', () => perform('nextChapter'));
  $('course-start').addEventListener('click', () => perform('start'));
  $('course-pause').addEventListener('click', () => perform('pause'));
  $('course-stop').addEventListener('click', () => perform('stop'));
  $('course-focus').addEventListener('click', () => perform('focus'));
  $('course-preview').addEventListener('click', () => perform('previewQuiz'));
  $('course-fill').addEventListener('click', () => perform('fillQuiz'));
  $('course-show-answer').addEventListener('click', onPractice);
  $('course-question').addEventListener('change', () => { if ($('course-question').value) void perform('chooseQuestion', { key: $('course-question').value }); });
  $('course-chapters').addEventListener('click', (event) => {
    const button = event.target.closest('button[data-key]');
    if (button && !button.disabled) void perform('selectChapter', { key: button.dataset.key });
  });
  $('course-clear').addEventListener('click', () => { if (confirm('清除课程绑定、目录、播放状态和课程记录？不会修改平台记录或清除设置。')) void perform('clear'); });
  chrome.runtime.onMessage.addListener((message, sender) => {
    if (sender.id !== chrome.runtime.id || message?.type !== 'course-state') return;
    if ((message.state.revision || 0) < (state.revision || 0)) return;
    state = message.state; render(); onChange();
  });
  function showSettings(settings) {
    for (const [key, field] of Object.entries(COURSE_FIELDS)) {
      const input = $(`course-${key}`); input.min = field.min; input.max = field.max; input.step = field.step; input.value = settings[key];
    }
    $('course-auto-next').checked = settings.autoNext;
    $('course-auto-preview').checked = settings.autoPreviewQuiz;
  }
  return {
    get state() { return state; },
    scan: () => perform('scan'),
    get busy() { return state.running || Boolean(state.operation) || pending; },
    updatePractice(busy, consent) { practiceBusy = Boolean(busy); accepted = consent; render(); },
    setSettingsDisabled(value) { settingsBusy = value; for (const key of Object.keys(COURSE_FIELDS)) $(`course-${key}`).disabled = value; $('course-auto-next').disabled = value; $('course-auto-preview').disabled = value; },
    settings() {
      const raw = { autoNext: $('course-auto-next').checked, autoPreviewQuiz: $('course-auto-preview').checked };
      for (const key of Object.keys(COURSE_FIELDS)) {
        const input = $(`course-${key}`); input.setCustomValidity('');
        if (!input.checkValidity() || input.value === '') {
          const field = COURSE_FIELDS[key], message = input.value === '' ? `请输入${field.label}` : `${field.label}应为 ${field.min}～${field.max}，步长 ${field.step}`;
          input.setCustomValidity(message); input.setAttribute('aria-invalid', 'true'); onInvalid(input); input.focus(); input.reportValidity(); throw new Error(message);
        }
        raw[key] = Number(input.value);
      }
      return validateCourseSettings(raw);
    },
    async init() {
      const { courseSettings } = await chrome.storage.local.get('courseSettings');
      try { showSettings(validateCourseSettings(courseSettings === undefined ? COURSE_SETTINGS : courseSettings)); }
      catch { showSettings(COURSE_SETTINGS); tell('已保存的课程设置无效，已显示默认值，请检查后保存。'); }
      try {
        const current = await command('state');
        if (typeof current?.platformId === 'string' && (current.revision || 0) >= (state.revision || 0)) state = current;
      } catch {} // 模型桥失败不应阻止只读课程入口；真正的课程操作仍显示独立错误。
      render();
    },
    async activate() {
      try {
        const current = await command('state');
        if (typeof current?.platformId === 'string' && (current.revision || 0) >= (state.revision || 0)) state = current;
        if (state.tabId == null) {
          const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
          if (coursePlatform(tab?.url)) state = await command('scan');
        }
        render();
      } catch (error) { tell(error.message); }
    }
  };
}

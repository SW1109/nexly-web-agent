import { COURSE_PLATFORMS, COURSE_SETTINGS, coursePlatform, courseSession, validateCourseSettings } from './course-platforms.js';
import { coursePageAction } from './course-page.js';

/** 课程任务与答题任务分开保存；只有用户明确启动时播放，不在打开平台时悄悄运行。 */
export function createCourseRuntime({ chromeApi = globalThis.chrome, practiceBusy = () => false, solveQuiz = async () => {}, inject = coursePageAction, onChange = () => {} } = {}) {
  let state = courseSession(), epoch = 0, operation = false, watcher = null, navigationTimer = null, navigationPoll = null;
  let writes = Promise.resolve();
  const previews = new Set();
  const ready = chromeApi.storage.session.get('courseState').then(({ courseState }) => {
    if (!courseState || typeof courseState !== 'object') return;
    state = { ...courseSession(), ...courseState, operation: '', running: false };
    if (courseState.running || ['starting', 'navigating'].includes(courseState.phase)) state = { ...state, phase: 'interrupted', message: '后台曾重启，课程任务已停止；核对页面后点击继续。' };
  });
  const platform = () => COURSE_PLATFORMS.find((item) => item.id === state.platformId);
  const assertEpoch = (expected) => { if (epoch !== expected) throw Object.assign(new Error('课程操作已取消'), { code: 'COURSE_CANCELED' }); };
  async function publish(patch = {}, message = '') {
    state = { ...state, ...patch, revision: (state.revision || 0) + 1 };
    if (message) { state.message = message; if (state.log.at(-1)?.text !== message) state.log = [...state.log.slice(-49), { time: Date.now(), text: message }]; }
    const snapshot = state;
    const write = writes.then(() => chromeApi.storage.session.set({ courseState: snapshot }));
    writes = write.catch(() => {}); await write;
    void chromeApi.runtime.sendMessage({ type: 'course-state', state: snapshot }).catch(() => {});
    onChange(snapshot);
    return state;
  }
  async function action(target, kind, extra = {}) {
    if (!target || !platform()) throw new Error('课程页面未绑定，请重新识别');
    const [result] = await chromeApi.scripting.executeScript({ target: { tabId: state.tabId, ...(target.documentId ? { documentIds: [target.documentId] } : { frameIds: [target.frameId] }) }, world: 'ISOLATED', func: inject, args: [kind, { platform: platform(), settings: state.settings, ...extra }] });
    if (!result?.result?.ok) throw new Error(result?.result?.error || '课程页面已切换或暂时无法访问，请重新识别');
    return result.result;
  }
  async function stopWatcher(pause = true) {
    clearTimeout(navigationTimer); navigationTimer = null; clearInterval(navigationPoll); navigationPoll = null;
    const previous = watcher; watcher = null;
    if (previous) await action(previous, 'stop', { pause }).catch(() => {});
  }
  async function capture(tabId) {
    const tab = await chromeApi.tabs.get(tabId);
    const definition = coursePlatform(tab.url);
    if (!definition) throw new Error('当前地址不在支持的平台范围：超星学习通、智慧树、中国大学 MOOC、国家开放大学（实验学院）');
    const frames = await chromeApi.webNavigation.getAllFrames({ tabId });
    const readable = (frames || []).filter((frame) => coursePlatform(frame.url)?.id === definition.id).slice(0, 40);
    if (!readable.some((frame) => frame.frameId === 0)) readable.unshift({ frameId: 0, parentFrameId: -1, url: tab.url });
    const results = await Promise.all(readable.map(async (frame) => {
      try {
        if (!await chromeApi.permissions.contains({ origins: [`${new URL(frame.url).origin}/*`] })) return null;
        const [entry] = await chromeApi.scripting.executeScript({ target: { tabId, frameIds: [frame.frameId] }, world: 'ISOLATED', func: inject, args: ['read', { platform: definition }] });
        return entry?.result?.ok && entry.result.platformId === definition.id ? { frame, target: { frameId: frame.frameId, documentId: entry.documentId || null }, snapshot: entry.result } : null;
      } catch { return null; }
    }));
    const records = results.filter(Boolean), byFrame = new Map(records.map((entry) => [entry.frame.frameId, entry]));
    const shown = (entry, seen = new Set()) => {
      if (seen.has(entry.frame.frameId) || entry.snapshot.shown === false) return false;
      seen.add(entry.frame.frameId);
      const parent = byFrame.get(entry.frame.parentFrameId);
      if (!parent) return true;
      const matching = parent.snapshot.children?.filter((child) => child.url === entry.frame.url) || [];
      return !matching.length || matching.some((child) => child.shown) ? shown(parent, seen) : false;
    };
    const visible = records.filter((entry) => shown(entry));
    if (!visible.length) throw new Error('平台站点权限不可用或页面尚未加载；请在扩展管理中允许访问该平台，再重新识别');
    const gate = visible.map((entry) => entry.snapshot.gate).find(Boolean) || '';
    const quizzes = visible.filter((entry) => entry.snapshot.questions?.length);
    const media = visible.filter((entry) => entry.snapshot.media?.count);
    if (quizzes.length > 1) throw new Error('多个可见区域同时包含练习题，请先在原页面保留一个练习区域');
    if (!quizzes.length && (media.length > 1 || media[0]?.snapshot.media.count > 1)) throw new Error('页面存在多个可见播放器，请人工选定一个视频后重试');
    const directory = [...visible].sort((a, b) => b.snapshot.chapters.length - a.snapshot.chapters.length)[0];
    const navigation = visible.find((entry) => entry === directory && entry.snapshot.nextChapter) || visible.find((entry) => entry.frame.frameId === 0 && entry.snapshot.nextChapter);
    const selected = quizzes[0] || media[0] || directory;
    // iframe 原始 URL 仅用于这次可见性关联，可能含令牌；不将其写入 session 或广播给面板。
    const { children, ...selectedSnapshot } = selected.snapshot;
    const snapshot = { ...selectedSnapshot, gate, title: directory.snapshot.title || selected.snapshot.title, chapters: directory.snapshot.chapters, pageResource: directory.snapshot.pageResource || selected.snapshot.pageResource || '', nextChapter: navigation?.snapshot.nextChapter || null, questions: quizzes[0]?.snapshot.questions || [] };
    return { tabId, platformId: definition.id, snapshot, targets: { media: media[0]?.target || null, quiz: quizzes[0]?.target || null, directory: directory?.target || null, navigation: navigation?.target || null } };
  }
  async function updateCapture(tabId, expected) {
    const result = await capture(tabId); assertEpoch(expected);
    await publish(result); assertEpoch(expected);
    return result;
  }
  async function pause(message, phase = 'paused') {
    epoch++; operation = false;
    await stopWatcher(true);
    return publish({ running: false, operation: '', phase, error: '' }, message);
  }
  async function preview(fill, expected) {
    if (practiceBusy()) throw new Error('已有答题或连接测试运行，请先停止或等待完成');
    const snapshot = state.snapshot;
    if (snapshot.gate) throw new Error(snapshot.gate);
    if (!snapshot.questions.length) throw new Error('当前页面未识别到随堂练习，请打开题目后刷新');
    const key = `${state.tabId}|${state.targets.quiz.documentId}|${snapshot.questions[0].key}`;
    // 网课入口复用练习区的同页队列；预览只取首题，不再要求或写入人工选中标记。
    await solveQuiz({ tabId: state.tabId, fill }); assertEpoch(expected);
    previews.add(key);
    await publish({}, fill ? `已启动当前页 ${snapshot.questions.length} 道题的解答与受控填写；完成本页后停止，不翻页、不提交。` : '已启动当前页首题答案预览；答案在练习区展示，不会填写或提交。');
  }
  async function begin(expected) {
    if (practiceBusy()) throw new Error('已有答题或连接测试运行，请先停止或等待完成');
    if (state.snapshot.gate) return pause(state.snapshot.gate, 'blocked');
    if (state.snapshot.questions.length) {
      await stopWatcher(true); assertEpoch(expected);
      await publish({ running: false, operation: '', phase: 'awaitingQuiz', error: '' }, `发现当前页 ${state.snapshot.questions.length} 道随堂练习，课程已暂停；可直接预览首题或解答本页，提交由你确认。`);
      if (state.settings.autoPreviewQuiz && state.snapshot.questions.length === 1) {
        const question = state.snapshot.questions[0];
        const key = question && `${state.tabId}|${state.targets.quiz.documentId}|${question.key}`;
        if (key && !previews.has(key)) await preview(false, expected);
      }
      return state;
    }
    if (state.snapshot.media.ended) return advance(expected, false);
    if (state.snapshot.media.count === 1 && !state.snapshot.media.ready) {
      await publish({ phase: 'starting', running: true }, '播放器正在加载，最多等待 15 秒；可随时暂停或停止。'); assertEpoch(expected);
      const deadline = Date.now() + 15000;
      while (!state.snapshot.media.ready && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 500)); assertEpoch(expected);
        await updateCapture(state.tabId, expected);
        if (state.snapshot.gate || state.snapshot.questions.length) return begin(expected);
        if (state.snapshot.media.count !== 1) break;
      }
      if (state.snapshot.media.ended) return advance(expected, false);
    }
    if (!state.snapshot.media.ready) return pause('未找到已加载的唯一视频；请在平台上打开视频或完成文档阅读，再点击继续。');
    const runToken = crypto.randomUUID(), target = state.targets.media;
    watcher = { ...target, runToken };
    await publish({ phase: 'starting', running: true, error: '' }, '正在启动当前视频，使用平台原播放器正常播放。'); assertEpoch(expected);
    await action(target, 'play', { runToken }); assertEpoch(expected);
    await publish({ phase: 'playing', running: true, operation: '' }, '正在播放；不会修改播放时长、学习记录、页面焦点或平台验证机制。');
    return state;
  }
  async function selectChapter(key, expected, autoplay) {
    if (practiceBusy()) throw new Error('请先结束当前答题任务，再切换课程章节');
    const fromDirectory = state.snapshot.chapters.find((item) => item.key === key);
    const chapter = fromDirectory || (state.snapshot.nextChapter?.key === key ? state.snapshot.nextChapter : null);
    if (!chapter) throw new Error('章节目录已变化，请重新识别');
    if (chapter.locked) throw new Error('章节尚未解锁，请按平台规则完成前置任务');
    const previousSignature = state.snapshot.media.signature, previousMedia = { ...state.targets.media, signature: previousSignature };
    await stopWatcher(true); assertEpoch(expected);
    const target = (fromDirectory ? state.targets.directory : state.targets.navigation) || state.targets.directory, runToken = crypto.randomUUID();
    await publish({ phase: 'navigating', running: autoplay, navigation: { key, title: chapter.title, resource: chapter.resource || '', previousMedia, autoplay }, error: '' }, `正在打开：${chapter.title}。`); assertEpoch(expected);
    await action(target, 'selectChapter', { key }); assertEpoch(expected);
    watcher = { ...target, runToken };
    // 完整导航由 webNavigation 恢复；SPA 导航由页内观察器等待新播放器，绝不循环连点目录。
    await action(target, 'watchNavigation', { runToken, expectedKey: key, expectedResource: chapter.resource || '', previousSignature }).catch(() => {}); assertEpoch(expected);
    // 导航完成事件可能早于 loadeddata；在有限窗口内等真实播放器就绪，不重复点击下一章。
    navigationPoll = setInterval(() => { if (epoch === expected) void navigate(state.tabId); }, 1000);
    navigationTimer = setTimeout(() => {
      if (epoch === expected && state.phase === 'navigating') void pause('切换后未等到可确认的新章节，请人工核对页面后重新识别。');
    }, 22000);
    return state;
  }
  function arrived() {
    const navigation = state.navigation;
    if (!navigation) return false;
    return Boolean(navigation.resource && state.snapshot.pageResource === navigation.resource || state.snapshot.chapters.some((item) => item.current && (item.key === navigation.key || navigation.resource && item.resource === navigation.resource)));
  }
  function destinationReady() {
    if (state.snapshot.questions.length || state.snapshot.gate) return true;
    if (!state.snapshot.media.ready || state.snapshot.media.ended) return false;
    const previous = state.navigation?.previousMedia, target = state.targets.media;
    return !previous || previous.documentId !== target?.documentId || previous.frameId !== target?.frameId || previous.signature !== state.snapshot.media.signature;
  }
  async function advance(expected, count, manual = false) {
    if (count) await publish({ watched: state.watched + 1 });
    const current = state.snapshot.chapters.filter((item) => item.current);
    if (!manual && !state.settings.autoNext) return pause('当前视频已播放结束，连续播放已关闭，请人工换章。');
    const next = current.length === 1 ? state.snapshot.chapters[current[0].index + 1] || state.snapshot.nextChapter : state.snapshot.nextChapter;
    if (!next) {
      if (current.length !== 1) return pause('无法唯一确认当前章节，也未找到唯一安全的“下一页”链接；请在目录中人工选择后重新识别。');
      return pause('已到已识别目录的末尾；播放结束不代表平台已认定课程完成，请核对平台记录。', 'complete');
    }
    if (next.locked) return pause('下一章节被平台锁定，请先完成平台要求的前置任务。', 'blocked');
    return selectChapter(next.key, expected, manual ? state.running : true);
  }
  async function handle(message, boundTabId = null) {
    await ready;
    if (message.action === 'state') return state;
    if (boundTabId !== null && message.action !== 'scan' && state.tabId !== boundTabId) throw new Error('课程任务不属于此标签页，请先重新识别当前课程');
    if (message.action === 'focus') { if (state.tabId == null) throw new Error('尚未绑定课程页面'); await chromeApi.tabs.update(state.tabId, { active: true }); return state; }
    if (['pause', 'stop', 'clear'].includes(message.action)) {
      const result = await pause(message.action === 'stop' ? '课程任务已停止，保留页面内容和本次记录。' : '课程已暂停，请确认页面后继续。', message.action === 'stop' ? 'stopped' : 'paused');
      if (message.action === 'clear') { previews.clear(); return publish(courseSession()); }
      return result;
    }
    if (message.action === 'scan' && state.running) throw new Error('请先暂停课程，再重新绑定页面');
    if (operation) throw new Error('课程操作正在处理，请稍候；仍可随时暂停或停止');
    operation = true;
    const expected = ++epoch;
    try {
      if (!['scan', 'start', 'resume', 'selectChapter', 'previewQuiz', 'fillQuiz', 'nextChapter'].includes(message.action)) throw new Error('不支持的课程命令');
      if (practiceBusy() && !['scan'].includes(message.action)) throw new Error('已有答题或连接测试运行，请先停止或等待完成');
      await publish({ operation: message.action, error: '' }); assertEpoch(expected);
      if (message.action === 'scan') {
        if (state.running) throw new Error('请先暂停课程，再重新绑定页面');
        const tab = boundTabId !== null ? await chromeApi.tabs.get(boundTabId) : (await chromeApi.tabs.query({ active: true, currentWindow: true }))[0]; assertEpoch(expected);
        if (tab?.id == null) throw new Error('请先打开课程网页');
        await stopWatcher(false); assertEpoch(expected);
        await updateCapture(tab.id, expected);
        await publish({ phase: state.snapshot.gate ? 'blocked' : 'ready', navigation: null, running: false }, state.snapshot.gate || `已识别 ${platform().name}；读取到 ${state.snapshot.chapters.length} 个目录项。点击开始后才会播放。`);
      } else {
        if (state.tabId == null) throw new Error('请先点击“识别当前课程”');
        await updateCapture(state.tabId, expected);
        if (['start', 'resume'].includes(message.action)) {
          const { courseSettings } = await chromeApi.storage.local.get('courseSettings'); assertEpoch(expected);
          await publish({ settings: validateCourseSettings(courseSettings === undefined ? COURSE_SETTINGS : courseSettings) }); assertEpoch(expected);
          await begin(expected);
        } else if (message.action === 'nextChapter') await advance(expected, false, true);
        else if (message.action === 'selectChapter') await selectChapter(message.key, expected, false);
        else await preview(message.action === 'fillQuiz', expected);
      }
    } catch (error) {
      if (epoch !== expected || error.code === 'COURSE_CANCELED') return state;
      await stopWatcher(true);
      await publish({ running: false, phase: 'error', error: error.message }, error.message);
      throw error;
    } finally {
      if (epoch === expected) { operation = false; await publish({ operation: '' }); }
    }
    return state;
  }
  async function event(message, sender) {
    await ready;
    if (!watcher || message.runToken !== watcher.runToken || sender.tab?.id !== state.tabId || sender.frameId !== watcher.frameId || watcher.documentId && sender.documentId !== watcher.documentId || coursePlatform(sender.url)?.id !== state.platformId) return false;
    if (operation) return true;
    const expected = epoch;
    operation = true;
    try {
      await updateCapture(state.tabId, expected);
      if (message.event === 'progress') return true;
      if (message.event === 'ended') {
        if (!state.snapshot.media.ended || !state.running || state.phase !== 'playing') return true;
        await stopWatcher(false); assertEpoch(expected);
        await advance(expected, true);
      } else if (message.event === 'quiz') {
        await stopWatcher(true); assertEpoch(expected);
        await begin(expected);
      } else if (message.event === 'navigated') {
        if (state.phase !== 'navigating' || !arrived() || !destinationReady()) return true;
        const autoplay = state.navigation?.autoplay;
        await stopWatcher(false); assertEpoch(expected);
        if (autoplay) await begin(expected);
        else await publish({ phase: 'ready', running: false, navigation: null }, '章节已打开；确认页面后可点击开始播放。');
      } else {
        const messages = { blocked: state.snapshot.gate || '平台要求人工确认，请处理后继续。', playerPaused: '页面或播放器已暂停；请在原页面确认后继续，不会强制恢复播放。', stalled: '视频长时间没有进度，已暂停；请检查网络或播放器。', mediaError: '播放器报告加载错误，请在原页面检查后重试。', changed: '播放器或章节发生变化，已暂停；请核对后继续。', navigationTimeout: '切换后未确认新章节，请人工核对后重新识别。' };
        await pause(messages[message.event] || '课程状态发生变化，请确认后继续。', message.event === 'blocked' ? 'blocked' : 'paused');
      }
      return true;
    } catch (error) {
      if (epoch === expected) await pause(error.message, 'error');
      return true;
    } finally { if (epoch === expected) operation = false; }
  }
  async function navigate(tabId) {
    await ready;
    if (operation || state.tabId !== tabId) return;
    const expected = epoch;
    if (state.phase === 'navigating') {
      operation = true;
      try {
        await updateCapture(tabId, expected);
        const autoplay = state.navigation?.autoplay;
        if (!arrived()) return;
        // 完整文档重载后旧观察器自动销毁，重新绑定新 documentId；播放器没就绪则等待下次加载事件。
        if (!destinationReady()) return;
        await stopWatcher(false); assertEpoch(expected);
        if (autoplay) await begin(expected);
        else await publish({ phase: 'ready', running: false, navigation: null }, '已打开新章节，确认后点击开始。');
      } catch (error) { if (epoch === expected) await pause(error.message, 'error'); }
      finally { if (epoch === expected) operation = false; }
    } else if (state.running) {
      operation = true;
      try {
        const previous = state;
        await updateCapture(tabId, expected);
        // onCompleted 常晚于用户点击开始，子 frame 也会触发；同一播放器/文档的迟到通知不能误停任务。
        const sameTarget = state.targets.media?.documentId === previous.targets.media?.documentId && state.targets.media?.frameId === previous.targets.media?.frameId;
        const sameChapter = JSON.stringify(state.snapshot.chapters.filter((item) => item.current).map((item) => item.resource || item.key)) === JSON.stringify(previous.snapshot.chapters.filter((item) => item.current).map((item) => item.resource || item.key));
        if (!sameTarget || !sameChapter || state.snapshot.gate || state.snapshot.questions.length || state.snapshot.media.signature !== previous.snapshot.media.signature) await pause('课程页面发生导航，任务已暂停；请核对页面后点击继续。');
      } catch (error) { if (epoch === expected) await pause(error.message, 'error'); }
      finally { if (epoch === expected) operation = false; }
    } else {
      operation = true;
      try { await updateCapture(tabId, expected); }
      catch {}
      finally { if (epoch === expected) operation = false; }
    }
  }
  async function autoRecognize(tabId) {
    await ready;
    if (operation || state.running || !['idle', 'ready', 'complete', 'stopped'].includes(state.phase) || practiceBusy()) return;
    const tab = await chromeApi.tabs.get(tabId).catch(() => null);
    if (!tab?.active || !coursePlatform(tab.url)) return;
    await handle({ action: 'scan' }, tabId).catch(() => {});
  }
  return { ready, handle, event, navigate, autoRecognize, get state() { return state; }, get busy() { return state.running || Boolean(state.operation) || operation; }, async closed(tabId) { await ready; if (state.tabId === tabId) await pause('课程标签已关闭，任务已停止。', 'stopped'); }, async permissionRemoved() { await ready; if (state.running) await pause('站点访问权限发生变化，课程已暂停；恢复授权后重试。', 'blocked'); } };
}

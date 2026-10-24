/** 注入 ISOLATED world；所有依赖留在函数内，不能访问账号 Cookie、平台私有接口或伪造进度。 */
export async function coursePageAction(action, payload) {
  try {
    const { platform } = payload;
    const host = new URL(location.href).hostname;
    if (!platform?.hosts?.some((name) => host === name || !platform.exactHosts && host.endsWith(`.${name}`)) || location.protocol !== 'https:') throw new Error('当前 frame 不属于已接入的课程平台');
    const memo = globalThis.__quizmateCoursePage ||= { nodes: new WeakMap(), counter: 0, observer: null };
    const visible = (node) => {
      if (!node || node.closest('[hidden],[inert],[aria-hidden="true"],[data-nexly-controls]')) return false;
      for (let parent = node; parent?.nodeType === 1; parent = parent.parentElement) {
        const style = getComputedStyle(parent);
        if (style.display === 'none' || style.visibility === 'hidden') return false;
      }
      return [...node.getClientRects()].some((rect) => rect.width > 0 && rect.height > 0);
    };
    const all = (selector, root = document) => [...root.querySelectorAll(selector)].filter(visible);
    const text = (node) => (node?.innerText || node?.textContent || '').replace(/\s+/g, ' ').trim();
    const hash = (value) => { let result = 2166136261; for (const char of value) result = Math.imul(result ^ char.charCodeAt(0), 16777619); return (result >>> 0).toString(16); };
    const identity = (node) => { if (!memo.nodes.has(node)) memo.nodes.set(node, String(++memo.counter)); return memo.nodes.get(node); };
    const inFrame = () => {
      try { for (let view = window; view !== view.parent && view.frameElement; view = view.parent) if (!visible(view.frameElement)) return false; } catch {}
      return true;
    };
    const gate = () => {
      if (platform.id === 'ouchn') {
        if (location.pathname === '/course/view.php' && !['id', 'name', 'idnumber'].some((name) => new URL(location.href).searchParams.get(name))) return '该课程链接缺少课程 ID，请先从平台首页进入一门已选课程，再重新识别。';
        if (all('.errorbox,#notice,.alert-danger').some((node) => /必须指定课程|无权|不能访问|无法访问|尚未开放|禁止访问|访问受限/.test(text(node)))) return '平台提示课程不可访问，请先在原页面处理课程权限或入口。';
        if (/考试|期末考核|终结性考核/.test(text(all('#region-main h2,.quizname,.activityname')[0]))) return '这是考试/考核入口，请在平台页面人工处理。';
      }
      if (/\/(?:exam|exam-ans|examination)(?:[/.?]|$)|exam\/test|testPaper|examination/i.test(location.pathname)) return '这是考试/考核页面，本课程助手不会自动操作，请人工处理。';
      if (/passport|login|signin/i.test(location.hostname + location.pathname) || all('input[type="password"]').length) return '请先在平台页面完成登录。';
      if (all('.geetest_panel,.geetest_holder,.yidun_popup,.yidun_panel,.nc-container,[data-captcha],iframe[src*="captcha"]').length) return '检测到验证码，请在原页面人工验证后继续。';
      const dialogs = all('[role="dialog"],.ant-modal,.el-dialog,.layui-layer-content,.v-modal');
      if (dialogs.some((node) => /验证码|安全验证|人机验证|请先登录|身份认证|操作过于频繁|稍后再试|倒计时|请等待/.test(text(node)))) return '平台正在要求验证、登录或等待，请人工处理后继续。';
      return '';
    };
    const courseUrl = (raw) => {
      if (!raw || /^(?:#|javascript:)/i.test(raw)) return null;
      try {
        const url = new URL(raw, location.href);
        return url.protocol === 'https:' && !url.username && !url.password && !url.port && platform.hosts.some((name) => url.hostname === name || !platform.exactHosts && url.hostname.endsWith(`.${name}`)) ? url : null;
      } catch { return null; }
    };
    const activityResource = (value) => {
      const url = courseUrl(value);
      return url && /^\/mod\/[a-z][a-z0-9_]*\/(?:view|attempt)\.php$/i.test(url.pathname) && url.searchParams.get('id')
        ? hash(`${url.origin}${url.pathname}?id=${url.searchParams.get('id')}`) : '';
    };
    const pageResource = platform.id === 'ouchn' ? activityResource(location.href) : '';
    const chapterNodes = () => {
      let nodes = [];
      for (const selector of platform.chapters) {
        nodes = all(selector).filter((node) => text(node));
        if (nodes.length) break;
      }
      if (platform.id === 'ouchn' && !nodes.length) {
        // 优先平台标准目录。自定义主题仅接受同一目录组，不能把正文里的相关资源当成下一章。
        const links = all('a[href]').filter((node) => activityResource(node.href) && text(node) && !node.closest('.breadcrumb,.activity-navigation,header,footer') && !node.matches('.newgk-next,.newgk-prev') && !/^(?:上|下)一(?:页|章|节)|^(?:previous|next)(?:\s|$)/i.test(text(node)));
        const groups = new Map();
        for (const link of links) {
          for (let root = link.parentElement, depth = 0; root && !root.matches('body,html,main,#region-main') && depth < 7; root = root.parentElement, depth++) {
            if (root.querySelector('video,.que,[data-nexly-question]')) break;
            const members = links.filter((item) => root.contains(item));
            const resources = new Set(members.map((item) => activityResource(item.href)));
            if (resources.size < 2 || pageResource && !resources.has(pageResource)) continue;
            groups.set(root, { members, resources }); break;
          }
        }
        const ordered = [...groups.values()].sort((a, b) => b.resources.size - a.resources.size);
        // 若多个不同目录都声称包含当前活动，只接受互为子集的一组；其他情况退回安全的“下一页”。
        if (ordered.length && ordered.every((group) => [...group.resources].every((value) => ordered[0].resources.has(value)))) nodes = ordered[0].members;
      }
      return nodes.filter((node) => !nodes.some((other) => node !== other && node.contains(other))).slice(0, 300);
    };
    const describeChapter = (node, index, navigation = false) => {
      const anchor = node.matches('a[href]') ? node : node.querySelector('a[href]');
      const raw = anchor?.getAttribute('href') || '', url = courseUrl(raw), href = url?.href || '';
      const label = text(platform.id === 'ouchn' ? node.querySelector('.instancename,.activityname,.courseindex-link') || anchor || node : node).slice(0, 180);
      const resource = href ? platform.id === 'ouchn' ? activityResource(href) : hash(href.split('#')[0]) : '';
      const key = `chapter-${platform.id === 'ouchn' && resource ? resource : hash(`${index}|${label}|${href}|${node.getAttribute('data-id') || node.id}`)}`;
      const sameActivity = Boolean(platform.id === 'ouchn' && pageResource && resource === pageResource);
      // 有稳定活动 ID 时以 URL 为准，不能把侧栏容器的 active 状态误判成多个当前章节。
      const current = platform.id === 'ouchn' && pageResource ? sameActivity : node.matches(platform.current) || Boolean(node.querySelector(platform.current)) || Boolean(node.parentElement?.matches('.posCatalog_active,.current_play'));
      const activity = node.closest('li.activity,li.type_activity,.courseindex-item') || node;
      const locked = Boolean(node.closest('[disabled],[aria-disabled="true"],.locked,.is-locked')) || Boolean(activity.querySelector('.icon-lock,.icon_lock,[data-locked="true"]')) || platform.id === 'ouchn' && (!anchor || Boolean(activity.querySelector('.availabilityinfo:not(:empty),.availability-information:not(:empty)')));
      const kind = /测验|测试|习题|练习|作业|quiz|exercise/i.test(label) || /\/mod\/quiz\//.test(url?.pathname || '') ? 'quiz' : /文档|课件|阅读|ppt|pdf/i.test(label) ? 'document' : 'video';
      return { node, anchor, raw, key, title: label, resource, href, current, locked, kind, index, ...(navigation ? { source: 'page-navigation' } : {}) };
    };
    const chapterList = () => {
      const seen = new Set();
      return chapterNodes().map((node, index) => describeChapter(node, index)).filter((item) => {
        if (platform.id !== 'ouchn' || !item.resource) return true;
        if (seen.has(item.resource)) return false;
        seen.add(item.resource); return true;
      }).map((item, index) => ({ ...item, index }));
    };
    const nextChapter = () => {
      if (platform.id !== 'ouchn') return null;
      const candidates = all('a[href]').filter((node) => {
        const label = text(node).replace(/[|<>»›→]/g, '').trim();
        return (node.id === 'next-activity-link' || node.matches('a.newgk-next') || node.rel === 'next' || /^(?:下一(?:页|章|节|活动)|下一个(?:活动|章节)|next(?:\s+activity)?)$/i.test(label)) && !node.closest('.breadcrumb');
      }).map((node) => describeChapter(node, -1, true)).filter((item) => item.resource && item.resource !== pageResource && new URL(item.href).origin === location.origin && /^\/mod\/[^/]+\/view\.php$/.test(new URL(item.href).pathname));
      const resources = new Set(candidates.map((item) => item.resource));
      // 上下两处“下一页”可指向同一活动；多个不同目标、跨站、提交/attempt URL 均不猜测。
      return resources.size === 1 ? candidates.find((item) => item.locked) || candidates[0] : null;
    };
    const publicChapter = ({ node, anchor, raw, href, ...item }) => item;
    const questionNodes = () => {
      const candidates = all(platform.questions).filter((node) => !node.matches('.que.description'));
      return candidates.filter((node) => !candidates.some((other) => node !== other && node.contains(other))).slice(0, 100);
    };
    // 只接受 Moodle 的 HTML 页面正文；PDF、跨域阅读器和作业不靠滚动外壳冒充已读。
    const documentView = (videos = all('video'), questions = questionNodes()) => {
      const empty = { available: false, id: '', signature: '', atBottom: false, progress: 0, layout: '' };
      if (platform.id !== 'ouchn' || !/^\/mod\/page\/view\.php$/.test(location.pathname) || videos.length || questions.length) return { info: empty, scrolls: [] };
      const roots = all('#region-main .generalbox,#region-main .activity-content').filter((node) => text(node));
      const leaves = roots.filter((node) => !roots.some((other) => other !== node && node.contains(other)));
      if (leaves.length !== 1) return { info: empty, scrolls: [] };
      const root = leaves[0];
      if (all('iframe,frame,embed,object,canvas,input,textarea,[contenteditable="true"],audio', root).length) return { info: empty, scrolls: [] };
      // 等正文图片完成布局后再确认底部，避免懒加载内容刚出现就换章。
      const imagesReady = all('img', root).every((image) => image.complete);
      const scrolls = [];
      let visibleBottom = root.getBoundingClientRect().bottom;
      for (let node = root; node; node = node.parentElement) {
        const max = Math.max(0, node.scrollHeight - node.clientHeight), overflow = getComputedStyle(node).overflowY;
        if (max > 2 && /^(hidden|clip)$/.test(overflow)) return { info: empty, scrolls: [] };
        const viewport = node === document.scrollingElement, edge = viewport ? 0 : node.getBoundingClientRect().top + node.clientTop;
        if (max > 2 && (viewport || /auto|scroll|overlay/.test(overflow))) {
          const bottom = node === root ? max : visibleBottom - edge + node.scrollTop - node.clientHeight;
          scrolls.push({ node, target: Math.min(max, Math.max(0, bottom)) });
        }
        // 内层阅读区已经裁剪正文时，外层只需显示该阅读区，不能拿未裁剪的全文高度误滚整页。
        if (!viewport && /auto|scroll|overlay|hidden|clip/.test(overflow)) visibleBottom = Math.min(visibleBottom, edge + node.clientHeight);
      }
      const extent = scrolls.reduce((sum, entry) => sum + entry.target, 0);
      const offset = scrolls.reduce((sum, entry) => sum + Math.min(entry.target, Math.max(0, entry.node.scrollTop)), 0);
      return { info: { available: true, id: identity(root), signature: `${identity(root)}|${hash(text(root))}`, atBottom: imagesReady && scrolls.every(({ node, target }) => target - node.scrollTop <= 2),
        progress: extent > 0 ? Math.min(1, offset / extent) : 1, layout: [root.scrollHeight, root.clientHeight, ...scrolls.flatMap(({ node, target }) => [node.clientHeight, target])].join('|') }, scrolls };
    };
    const read = () => {
      const chapters = chapterList();
      const questions = questionNodes();
      const videos = all('video');
      const video = videos.length === 1 ? videos[0] : null;
      const duration = Number.isFinite(video?.duration) ? Math.max(0, video.duration) : 0;
      const currentTime = Number.isFinite(video?.currentTime) ? Math.max(0, video.currentTime) : 0;
      const pageUrl = new URL(location.href); pageUrl.search = ''; pageUrl.hash = '';
      return {
        ok: true, platformId: platform.id, title: text(all(platform.titles)[0]).slice(0, 180) || document.title.slice(0, 180), pageUrl: pageUrl.href,
        gate: gate(), shown: inFrame(), children: [...document.querySelectorAll('iframe,frame')].map((node) => ({ url: node.src, shown: visible(node) })),
        chapters: chapters.map(publicChapter), pageResource, nextChapter: nextChapter() ? publicChapter(nextChapter()) : null,
        questions: questions.map((node, index) => ({ key: `question-${hash(`${index}|${text(node).slice(0, 800)}`)}`, title: text(node).slice(0, 140), index })),
        document: documentView(videos, questions).info,
        media: { muted: Boolean(video?.muted), count: videos.length, id: video ? identity(video) : '', signature: video ? `${identity(video)}|${hash(video.currentSrc || video.getAttribute('src') || '')}` : '', duration, currentTime, paused: video?.paused ?? true, ended: Boolean(video?.ended && duration > 0 && currentTime >= duration - 1), ready: Boolean(video && video.readyState >= 2 && duration > 0), rate: Number.isFinite(video?.playbackRate) ? video.playbackRate : 1 }
      };
    };
    const release = (pause = false) => {
      const previous = memo.observer;
      memo.observer = null;
      if (!previous) return;
      clearInterval(previous.timer);
      for (const [name, listener] of previous.listeners) previous.video?.removeEventListener(name, listener);
      if (pause && previous.video?.isConnected) previous.video.pause();
    };
    if (action === 'read') return read();
    if (action === 'stop') { release(payload.pause !== false); return { ok: true }; }
    if (action === 'selectChapter') {
      if (gate()) throw new Error(gate());
      const chapter = chapterList().find((item) => item.key === payload.key) || (nextChapter()?.key === payload.key ? nextChapter() : null);
      if (!chapter) throw new Error('目录已变化，请重新识别后选择章节');
      if (chapter.locked) throw new Error('当前章节被平台锁定，请按平台要求解锁；未跳过任务');
      const teachingPage = platform.id === 'ouchn' && /^\/mod\/page\/view\.php$/.test(new URL(chapter.href || location.href).pathname) && /视频|教材|课件|课程说明/.test(chapter.title);
      if (/交卷|提交|删除|退出/i.test(chapter.title) || !teachingPage && /考试|考核/i.test(chapter.title)) throw new Error('此入口可能是考核或提交操作，请在平台页面人工处理');
      if (chapter.anchor?.target && chapter.anchor.target !== '_self') throw new Error('该章节会打开新标签页，请手动打开后重新识别，避免多开页面');
      if (chapter.raw && !chapter.href && !/^(?:#.*|javascript:\s*void\s*\(\s*0\s*\)\s*;?)$/i.test(chapter.raw)) throw new Error('章节链接不属于当前平台，未自动跳转');
      release(false);
      (chapter.anchor || chapter.node).click();
      return { ok: true, key: chapter.key };
    }
    if (!['play', 'readDocument', 'watchNavigation'].includes(action)) throw new Error('不支持的课程操作');
    const snapshot = read();
    if (snapshot.gate) throw new Error(snapshot.gate);
    if (!snapshot.shown) throw new Error('课程播放器所在区域已隐藏，请先在原页面显示它');
    if (action === 'play' && (snapshot.questions.length || snapshot.media.count !== 1)) throw new Error(snapshot.questions.length ? '检测到随堂练习，请先人工确认题目' : '未找到唯一可见播放器，请在原页面打开视频章节');
    if (action === 'play' && (!snapshot.media.ready || snapshot.media.ended)) throw new Error(snapshot.media.ended ? '当前视频已经结束，请选择下一章节' : '播放器正在加载，请稍后继续');
    if (action === 'readDocument' && !snapshot.document.available) throw new Error('当前内容不是可自动滚动的唯一 HTML 文档，请人工阅读 PDF、附件或嵌入式阅读器');
    release(false);
    const video = all('video').length === 1 ? all('video')[0] : null;
    const observer = { token: payload.runToken, video, listeners: [], timer: null, sentEnd: false, started: Date.now(), progressAt: Date.now(), lastTime: video?.currentTime || 0, lastSent: 0, pending: false };
    memo.observer = observer;
    const send = async (event, data = {}) => {
      if (memo.observer !== observer || observer.pending) return;
      observer.pending = true;
      try {
        const reply = await chrome.runtime.sendMessage({ type: 'course-event', runToken: observer.token, event, ...data });
        if (!reply?.ok || reply.accepted === false) { if (memo.observer === observer) release(true); }
      } catch { if (memo.observer === observer) release(true); }
      finally { observer.pending = false; }
    };
    const tick = () => {
      if (memo.observer !== observer) return;
      const current = read();
      if (current.gate) { void send('blocked'); return; }
      if (action === 'watchNavigation') {
        const ready = current.questions.length || current.document.available && current.document.signature !== payload.previousDocumentSignature || current.media.ready && !current.media.ended && current.media.signature !== payload.previousSignature;
        const arrived = current.pageResource && current.pageResource === payload.expectedResource || current.chapters.some((chapter) => chapter.current && (chapter.key === payload.expectedKey || chapter.resource && chapter.resource === payload.expectedResource));
        if (ready && arrived) void send('navigated');
        else if (Date.now() - observer.started > 20000) void send('navigationTimeout');
        return;
      }
      if (current.questions.length) { void send('quiz'); return; }
      if (action === 'readDocument') {
        if (!current.document.available || current.document.signature !== snapshot.document.signature) { void send('changed'); return; }
        const view = documentView();
        if (observer.layout !== view.info.layout || !view.info.atBottom) { observer.bottomAt = null; observer.layout = view.info.layout; }
        if (view.info.atBottom) {
          observer.bottomAt ??= Date.now();
          if (Date.now() - observer.bottomAt >= payload.settings.nextDelayMs) { void send('documentEnd'); return; }
        } else {
          // 只滚动正文及其滚动祖先，不动左侧课程目录；正常 scrollTop 会触发浏览器原生滚动。
          for (const { node, target } of view.scrolls) node.scrollTop = Math.min(target, node.scrollTop + Math.max(1, node.clientHeight * 0.8));
        }
        const position = view.scrolls.map(({ node }) => node.scrollTop).join('|');
        if (observer.position !== position || view.info.atBottom) { observer.position = position; observer.progressAt = Date.now(); }
        if (Date.now() - observer.progressAt > payload.settings.stallSeconds * 1000) { void send('stalled'); return; }
        if (Date.now() - observer.lastSent >= 1000) { observer.lastSent = Date.now(); void send('progress'); }
        return;
      }

      if (current.media.count !== 1 || current.media.id !== snapshot.media.id || current.media.signature !== snapshot.media.signature) { void send('changed'); return; }
      if (current.media.ended) {
        if (!observer.sentEnd) {
          observer.sentEnd = true;
          observer.endAt = Date.now();
        }
        if (Date.now() - observer.endAt >= payload.settings.nextDelayMs) void send('ended');
        return;
      }
      if (current.media.paused) { void send('playerPaused'); return; }
      if (current.media.currentTime !== observer.lastTime) { observer.lastTime = current.media.currentTime; observer.progressAt = Date.now(); }
      if (Date.now() - observer.progressAt > payload.settings.stallSeconds * 1000) { void send('stalled'); return; }
      if (Date.now() - observer.lastSent > 5000) { observer.lastSent = Date.now(); void send('progress'); }
    };
    observer.timer = setInterval(tick, 1000);
    if (video) {
      for (const name of ['ended', 'error']) {
        const listener = () => name === 'error' ? void send('mediaError') : tick();
        observer.listeners.push([name, listener]); video.addEventListener(name, listener);
      }
    }
    if (action === 'play') {
      // 每次启动/恢复及进入新视频前先静音，不改全局标签音量，也不反复覆盖用户手动取消静音。
      video.muted = true;
      video.playbackRate = payload.settings.playbackRate;
      try { await video.play(); }
      catch { if (memo.observer === observer) release(false); throw new Error('浏览器或平台阻止了播放，请在课程页手动点播放后再继续'); }
      if (memo.observer !== observer) {
        // play() 可能在“停止”后才 resolve；没有新任务接管此播放器时，补一次暂停，不能留下幽灵播放。
        if (!memo.observer || memo.observer.video !== video) video.pause();
        return { ok: false, error: '课程操作已取消' };
      }
      if (video.paused) { release(false); throw new Error('播放器仍处于暂停状态，请先在原页面手动播放'); }
    }
    return read();
  } catch (error) { return { ok: false, error: error.message || '读取课程失败，请刷新页面后重试' }; }
}

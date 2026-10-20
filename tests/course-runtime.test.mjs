import test from 'node:test';
import assert from 'node:assert/strict';
import { createCourseRuntime } from '../extension/lib/course-runtime.js';
import { COURSE_SETTINGS } from '../extension/lib/course-platforms.js';

function fixture(options = {}) {
  const calls = [], solves = [], stored = {}, messages = [];
  let busy = false, active = 7, permission = true, playGate = null;
  const page = {
    ok: true, platformId: 'chaoxing', title: '测试课程', pageUrl: 'https://mooc1.chaoxing.com/mycourse/studentstudy', gate: '', shown: true, children: [],
    chapters: [{ key: 'chapter-1', title: '第一节 视频', current: true, locked: false, kind: 'video', index: 0 }, { key: 'chapter-2', title: '第二节 练习', current: false, locked: false, kind: 'quiz', index: 1 }], questions: [],
    media: { count: 1, id: 'video-1', signature: 'video-1|source-1', duration: 20, currentTime: 2, paused: true, ended: false, ready: true, rate: 1 }, ...options.snapshot
  };
  const chromeApi = {
    storage: { session: { async get() { return options.saved ? { courseState: structuredClone(options.saved) } : {}; }, async set(data) { Object.assign(stored, structuredClone(data)); } }, local: { async get() { return { courseSettings: options.settings || COURSE_SETTINGS }; } } },
    runtime: { async sendMessage(message) { messages.push(structuredClone(message)); } },
    tabs: { async query() { return [{ id: active, active: true }]; }, async get(id) { return { id, active: id === active, url: 'https://mooc1.chaoxing.com/mycourse/studentstudy?courseId=1' }; }, async update(id) { active = id; } },
    permissions: { async contains() { return permission; } },
    webNavigation: { async getAllFrames() { return [{ frameId: 0, parentFrameId: -1, url: 'https://mooc1.chaoxing.com/mycourse/studentstudy?courseId=1' }]; } },
    scripting: { async executeScript({ world, args, target }) {
      assert.equal(world, 'ISOLATED'); const [action, payload] = args; JSON.stringify(args);
      calls.push({ action, payload: structuredClone(payload), target: structuredClone(target) });
      if (action === 'play') { if (playGate) await playGate; page.media.paused = false; }
      if (action === 'stop' && payload.pause !== false) page.media.paused = true;
      return [{ documentId: 'document-1', frameId: 0, result: structuredClone(page) }];
    } }
  };
  const runtime = createCourseRuntime({ chromeApi, practiceBusy: () => busy, solveQuiz: async (request) => { solves.push(request); } });
  const sender = { tab: { id: 7 }, frameId: 0, documentId: 'document-1', url: 'https://mooc1.chaoxing.com/mycourse/studentstudy' };
  const runToken = () => calls.findLast((call) => ['play', 'watchNavigation'].includes(call.action))?.payload.runToken;
  return { runtime, calls, solves, stored, messages, page, sender, chromeApi, runToken, setBusy(value) { busy = value; }, setActive(value) { active = value; }, setPermission(value) { permission = value; }, setPlayGate(value) { playGate = value; } };
}
const until = async (predicate) => { for (let i = 0; i < 100; i++) { if (predicate()) return; await new Promise((resolve) => setTimeout(resolve, 2)); } throw new Error('course state transition timed out'); };

test('course detection reads only and playback needs an explicit command, preserving actual progress', async () => {
  const f = fixture(); await f.runtime.handle({ action: 'scan' });
  assert.equal(f.runtime.state.phase, 'ready'); assert.equal(f.runtime.state.tabId, 7); assert.equal(f.calls.filter((item) => item.action === 'play').length, 0); assert.deepEqual(f.solves, []);
  await f.runtime.handle({ action: 'start' });
  assert.equal(f.runtime.state.phase, 'playing'); assert.equal(f.runtime.busy, true); assert.equal(f.runtime.state.operation, '');
  assert.equal(f.page.media.currentTime, 2); assert.equal(f.runtime.state.watched, 0);
  await f.runtime.handle({ action: 'stop' }); assert.equal(f.runtime.state.phase, 'stopped'); assert.equal(f.page.media.paused, true);
});

test('saved 16x playback settings reach the bound player without changing progress', async () => {
  const f = fixture({ settings: { ...COURSE_SETTINGS, playbackRate: 16 } });
  await f.runtime.handle({ action: 'scan' });
  assert.equal(f.calls.some((item) => item.action === 'play'), false);
  await f.runtime.handle({ action: 'start' });
  assert.equal(f.runtime.state.settings.playbackRate, 16);
  assert.equal(f.calls.find((item) => item.action === 'play').payload.settings.playbackRate, 16);
  assert.equal(f.page.media.currentTime, 2);
  await f.runtime.handle({ action: 'stop' });
});

test('only the bound tab, document, frame, platform and token can report progress or completion', async () => {
  const f = fixture(); await f.runtime.handle({ action: 'scan' }); await f.runtime.handle({ action: 'start' });
  const event = { event: 'ended', runToken: f.runToken() }, before = f.calls.length;
  for (const sender of [{ ...f.sender, tab: { id: 99 } }, { ...f.sender, frameId: 1 }, { ...f.sender, documentId: 'old-document' }, { ...f.sender, url: 'https://chaoxing.com.evil.test/' }]) assert.equal(await f.runtime.event(event, sender), false);
  assert.equal(await f.runtime.event({ ...event, runToken: 'wrong' }, f.sender), false);
  assert.equal(f.calls.length, before);
  await f.runtime.event(event, f.sender);
  assert.equal(f.calls.filter((item) => item.action === 'selectChapter').length, 0, 'cannot forge an ended state');
  await f.runtime.handle({ action: 'stop' });
});

test('a real ended snapshot advances once and requires new chapter readiness before continuing', async () => {
  const f = fixture(); await f.runtime.handle({ action: 'scan' }); await f.runtime.handle({ action: 'start' });
  const token = f.runToken(); f.page.media.ended = true; f.page.media.currentTime = 20;
  await f.runtime.event({ event: 'ended', runToken: token }, f.sender);
  assert.equal(f.runtime.state.phase, 'navigating'); assert.equal(f.runtime.state.watched, 1);
  assert.equal(f.calls.filter((item) => item.action === 'selectChapter').length, 1);
  assert.equal(await f.runtime.event({ event: 'ended', runToken: token }, f.sender), false);
  for (const chapter of f.page.chapters) chapter.current = chapter.key === 'chapter-2';
  f.page.questions = [{ key: 'q1', title: '单选题：测试题', selected: false, index: 0 }]; f.page.media.count = 0;
  await f.runtime.event({ event: 'navigated', runToken: f.runToken() }, f.sender);
  assert.equal(f.runtime.state.phase, 'awaitingQuiz'); assert.equal(f.runtime.state.running, false); assert.deepEqual(f.solves, []);
  await f.runtime.handle({ action: 'stop' });
});

test('disabling next, ambiguous current chapters and locked chapters stop without guessing', async (t) => {
  for (const mode of ['disabled', 'ambiguous', 'locked']) await t.test(mode, async () => {
    const f = fixture({ settings: { ...COURSE_SETTINGS, autoNext: mode !== 'disabled' } });
    if (mode === 'ambiguous') f.page.chapters[1].current = true;
    if (mode === 'locked') f.page.chapters[1].locked = true;
    await f.runtime.handle({ action: 'scan' }); await f.runtime.handle({ action: 'start' });
    f.page.media.ended = true; f.page.media.currentTime = 20;
    await f.runtime.event({ event: 'ended', runToken: f.runToken() }, f.sender);
    assert.equal(f.runtime.state.running, false); assert.equal(f.calls.filter((item) => item.action === 'selectChapter').length, 0);
  });
});

test('quiz preview is opt-in, is once per question and stays on the bound course tab', async () => {
  const f = fixture({ settings: { ...COURSE_SETTINGS, autoPreviewQuiz: true }, snapshot: { questions: [{ key: 'q1', index: 0, title: '测试题', selected: false }], media: { count: 0, signature: '', ready: false } } });
  await f.runtime.handle({ action: 'scan' }); f.setActive(99);
  await f.runtime.handle({ action: 'start' });
  assert.deepEqual(f.solves, [{ tabId: 7, fill: false }]);
  await f.runtime.handle({ action: 'resume' }); assert.equal(f.solves.length, 1);
  await f.runtime.handle({ action: 'fillQuiz' }); assert.deepEqual(f.solves.at(-1), { tabId: 7, fill: true });
  assert.equal(f.runtime.state.phase, 'awaitingQuiz');
});

test('multiple visible questions can preview the first or fill the page without choosing a question', async () => {
  const f = fixture({ settings: { ...COURSE_SETTINGS, autoPreviewQuiz: true }, snapshot: { questions: [{ key: 'q1', index: 0, title: '题一' }, { key: 'q2', index: 1, title: '题二' }], media: { count: 0, signature: '', ready: false } } });
  await f.runtime.handle({ action: 'scan' });
  assert.deepEqual(f.solves, [], 'identifying a page must not start AI');
  await f.runtime.handle({ action: 'start' });
  assert.deepEqual(f.solves, [], 'the existing unique-question auto preview setting must not silently start AI on a multi-question page');
  await f.runtime.handle({ action: 'previewQuiz' }); assert.deepEqual(f.solves, [{ tabId: 7, fill: false }]);
  await f.runtime.handle({ action: 'resume' }); assert.equal(f.solves.length, 1);
  await f.runtime.handle({ action: 'fillQuiz' });
  assert.deepEqual(f.solves.at(-1), { tabId: 7, fill: true });
  assert.equal(f.runtime.state.phase, 'awaitingQuiz'); assert.match(f.runtime.state.message, /当前页 2 道题/);
  assert.equal(f.calls.some(call => !['read', 'stop'].includes(call.action)), false, 'AI startup must not select questions or navigate');
});

test('quiz appearing during playback pauses the real video before entering the AI flow', async () => {
  const f = fixture(); await f.runtime.handle({ action: 'scan' }); await f.runtime.handle({ action: 'start' });
  f.page.questions = [{ key: 'popup', index: 0, title: '随堂练习', selected: false }];
  await f.runtime.event({ event: 'quiz', runToken: f.runToken() }, f.sender);
  assert.equal(f.page.media.paused, true); assert.equal(f.runtime.state.phase, 'awaitingQuiz'); assert.deepEqual(f.solves, []);
});

test('practice tasks exclude course playback/navigation, and a stop invalidates a pending start', async () => {
  const f = fixture(); await f.runtime.handle({ action: 'scan' }); f.setBusy(true);
  await assert.rejects(f.runtime.handle({ action: 'start' }), /已有答题/);
  assert.equal(f.calls.filter((item) => item.action === 'play').length, 0);
  f.setBusy(false); let release; f.setPlayGate(new Promise((resolve) => { release = resolve; }));
  const start = f.runtime.handle({ action: 'start' }); await until(() => f.calls.some((item) => item.action === 'play'));
  await f.runtime.handle({ action: 'stop' }); release(); await start;
  assert.equal(f.runtime.state.phase, 'stopped'); assert.equal(f.runtime.state.running, false); assert.equal(f.runtime.state.operation, '');
});

test('login/captcha, revoked site access, closed tabs and worker restarts never auto-restart playback', async () => {
  const blocked = fixture({ snapshot: { gate: '请先人工完成验证码' } }); await blocked.runtime.handle({ action: 'scan' }); await blocked.runtime.handle({ action: 'start' });
  assert.equal(blocked.runtime.state.phase, 'blocked'); assert.equal(blocked.calls.filter((item) => item.action === 'play').length, 0);
  const f = fixture(); await f.runtime.handle({ action: 'scan' }); await f.runtime.handle({ action: 'start' }); await f.runtime.permissionRemoved(); assert.equal(f.runtime.state.phase, 'blocked');
  await f.runtime.handle({ action: 'resume' }); await f.runtime.closed(7); assert.equal(f.runtime.state.phase, 'stopped');
  const restarted = fixture({ saved: { ...f.stored.courseState, phase: 'playing', running: true } }); await restarted.runtime.ready;
  assert.equal(restarted.runtime.state.phase, 'interrupted'); assert.equal(restarted.runtime.state.running, false); assert.equal(restarted.calls.length, 0);
});


test('delayed navigation completion for the same loaded video does not pause a newly started course', async () => {
  const f = fixture();
  await f.runtime.handle({ action: 'scan' });
  await f.runtime.handle({ action: 'start' });
  await f.runtime.navigate(7);
  assert.equal(f.runtime.state.phase, 'playing');
  assert.equal(f.runtime.state.running, true);
  await f.runtime.handle({ action: 'stop' });
});


test('course snapshots omit token-bearing frame URLs and record clearing preserves revision order', async () => {
  const f = fixture({ snapshot: { children: [{ url: 'https://mooc1.chaoxing.com/embed?token=private-value', shown: true }] } });
  await f.runtime.handle({ action: 'scan' });
  assert.equal(f.runtime.state.snapshot.children, undefined);
  assert.ok(!JSON.stringify(f.runtime.state).includes('private-value'));
  const revision = f.runtime.state.revision;
  await f.runtime.handle({ action: 'clear' });
  assert.ok(f.runtime.state.revision > revision);
  assert.equal(f.runtime.state.snapshot, null);
  assert.equal(f.runtime.state.tabId, null);
});

test('page controls bind the caller tab, never the active tab, and cannot stop another course', async () => {
  const f = fixture(); f.setActive(99);
  await f.runtime.handle({ action: 'scan' }, 7);
  assert.equal(f.runtime.state.tabId, 7);
  await f.runtime.handle({ action: 'start' }, 7);
  await assert.rejects(f.runtime.handle({ action: 'stop' }, 99), /不属于此标签页/);
  await assert.rejects(f.runtime.handle({ action: 'scan' }, 99), /请先暂停/);
  assert.equal(f.runtime.state.phase, 'playing');
  assert.equal(f.runtime.state.running, true);
  await f.runtime.handle({ action: 'stop' }, 7);
});

test('a unique platform next-page link works without a readable directory and confirms the activity URL', async () => {
  const f = fixture({ snapshot: { chapters: [], pageResource: 'activity-1', nextChapter: { key: 'chapter-next', resource: 'activity-2', title: '下一页', locked: false, index: -1 } } });
  await f.runtime.handle({ action: 'scan' }); await f.runtime.handle({ action: 'start' });
  const token = f.runToken(); Object.assign(f.page.media, { ended: true, currentTime: 20 });
  await f.runtime.event({ event: 'ended', runToken: token }, f.sender);
  assert.equal(f.runtime.state.watched, 1);
  assert.equal(f.runtime.state.phase, 'navigating');
  assert.equal(f.calls.filter((item) => item.action === 'selectChapter').length, 1);
  f.page.pageResource = 'activity-2'; Object.assign(f.page.media, { ended: false, ready: false, currentTime: 0 });
  await f.runtime.navigate(7); assert.equal(f.runtime.state.phase, 'navigating');
  f.page.media.ready = true;
  await f.runtime.navigate(7); assert.equal(f.runtime.state.phase, 'navigating', 'the old player must not be restarted just because the URL changed');
  f.page.media.signature = 'video-1|source-2';
  await f.runtime.navigate(7); assert.equal(f.runtime.state.phase, 'playing');
  assert.equal(f.calls.filter((item) => item.action === 'play').length, 2);
  await f.runtime.handle({ action: 'stop' });
});

test('manual next works with continuous playback disabled and does not count an unfinished video', async () => {
  const f = fixture({ settings: { ...COURSE_SETTINGS, autoNext: false } });
  await f.runtime.handle({ action: 'scan' });
  await f.runtime.handle({ action: 'nextChapter' }, 7);
  assert.equal(f.runtime.state.phase, 'navigating');
  assert.equal(f.runtime.state.navigation.autoplay, false);
  assert.equal(f.runtime.state.watched, 0);
  assert.equal(f.calls.filter((item) => item.action === 'selectChapter').length, 1);
  await f.runtime.handle({ action: 'pause' });
});

test('manual navigation refreshes a paused course without starting playback or AI, and repeated notices are deduplicated', async () => {
  const f = fixture(); await f.runtime.handle({ action: 'scan' });
  await f.runtime.handle({ action: 'pause' });
  const count = f.runtime.state.log.length;
  await f.runtime.handle({ action: 'pause' }); assert.equal(f.runtime.state.log.length, count);
  f.page.title = '已人工切换到另一章';
  f.page.questions = [{ key: 'new-question', index: 0, title: '新随堂练习', selected: false }];
  await f.runtime.navigate(7);
  assert.equal(f.runtime.state.snapshot.title, f.page.title);
  assert.equal(f.runtime.state.snapshot.questions[0].key, 'new-question');
  assert.equal(f.runtime.state.running, false);
  assert.deepEqual(f.solves, []);
  assert.equal(f.calls.filter((item) => item.action === 'play').length, 0);
});

test('starting waits for a real loading player without repeatedly clicking play', async () => {
  const f = fixture(); f.page.media.ready = false;
  await f.runtime.handle({ action: 'scan' });
  const starting = f.runtime.handle({ action: 'start' });
  await until(() => f.runtime.state.phase === 'starting');
  assert.equal(f.calls.filter((item) => item.action === 'play').length, 0);
  f.page.media.ready = true;
  await starting;
  assert.equal(f.runtime.state.phase, 'playing');
  assert.equal(f.calls.filter((item) => item.action === 'play').length, 1);
  await f.runtime.handle({ action: 'stop' });
});

test('stopping while metadata loads prevents late playback and preserves stop state', async () => {
  const f = fixture(); f.page.media.ready = false;
  await f.runtime.handle({ action: 'scan' });
  const starting = f.runtime.handle({ action: 'start' });
  await until(() => f.runtime.state.phase === 'starting');
  await f.runtime.handle({ action: 'stop' });
  f.page.media.ready = true;
  await starting;
  assert.equal(f.runtime.state.phase, 'stopped');
  assert.equal(f.runtime.busy, false);
  assert.equal(f.calls.filter((item) => item.action === 'play').length, 0);
  assert.deepEqual(f.solves, []);
});

test('loading has a bounded deadline and never opens an unrelated chapter', async (t) => {
  t.mock.timers.enable({ apis: ['Date'] });
  const f = fixture(); f.page.media.ready = false;
  await f.runtime.handle({ action: 'scan' });
  const starting = f.runtime.handle({ action: 'start' });
  await until(() => f.runtime.state.phase === 'starting');
  t.mock.timers.tick(16000);
  await starting;
  assert.equal(f.runtime.state.phase, 'paused');
  assert.equal(f.runtime.busy, false);
  assert.equal(f.calls.some(item => ['play','selectChapter'].includes(item.action)), false);
});

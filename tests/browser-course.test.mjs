import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, cp, rm, mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { createServer } from 'node:http';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { COURSE_PLATFORMS } from '../extension/lib/course-platforms.js';
import { pageAction } from '../extension/lib/page.js';

const enabled = process.env.NEXLY_COURSE_BROWSER_TEST === '1' || process.env.NEXLY_BROWSER_TEST === '1';
// 1.2 秒纯色静音 WebM，由本机 ffmpeg 生成。真实媒体播放，不伪造 ended/currentTime/学时接口。
const media = Buffer.from('GkXfo59ChoEBQveBAULygQRC84EIQoKEd2VibUKHgQJChYECGFOAZwEAAAAAAAKcEU2bdLpNu4tTq4QVSalmU6yBoU27i1OrhBZUrmtTrIHWTbuMU6uEElTDZ1OsggEjTbuMU6uEHFO7a1OsggKG7AEAAAAAAABZAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAVSalmsCrXsYMPQkBNgIxMYXZmNjIuMy4xMDBXQYxMYXZmNjIuMy4xMDBEiYhAksAAAAAAABZUrmvIrgEAAAAAAAA/14EBc8WIeYbfLZLe1WGcgQAitZyDdW5kiIEAhoVWX1ZQOIOBASPjg4QL68IA4JCwgaC6gVqagQJVsIRVuYEBElTDZ/tzc59jwIBnyJlFo4dFTkNPREVSRIeMTGF2ZjYyLjMuMTAwc3PWY8CLY8WIeYbfLZLe1WFnyKFFo4dFTkNPREVSRIeUTGF2YzYyLjExLjEwMCBsaWJ2cHhnyKFFo4hEVVJBVElPTkSHkzAwOjAwOjAxLjIwMDAwMDAwMAAfQ7Z1QN3ngQCj1oEAAIDwBQCdASqgAFoAAEcIhYWIhYSIAgICdaoD+AIGmhPghqqTXcQ6qk13EOqpNdxDqqTXcQ6qk13EGAD+/00S//xYV/FhX8WFf/FhX/z8zu3F/OYAo5iBAMgAEQIAARAQABgAGFgv9AAIgIEAAACjmIEBkAARAgABEBAAGAAYWC/0AAiAgQAAAKOYgQJYABECAAEQEAAYABhYL/QACICBAAAAo5iBAyAAEQIAARAQABgAGFgv9AAIgIEAAACjmIED6AARAgABEBAAGAAYWC/0AAiAgQAAABxTu2uRu4+zgQC3iveBAfGCAaPwgQM=', 'base64');
const initial = { chaoxing: 'https://mooc1.chaoxing.com/mycourse/studentstudy?chapter=1', zhihuishu: 'https://studyh5.zhihuishu.com/video?chapter=1', icourse: 'https://www.icourse163.org/learn/FIXTURE?chapter=1', ouchn: 'https://moodle.syxy.ouchn.cn/mod/resource/view.php?id=101' };
function html(id, url) {
  const layout = url.searchParams.get('layout') || '';
  const current = id === 'ouchn' ? Number(url.searchParams.get('id')) - 100 : Number(url.searchParams.get('chapter') || 1);
  const links = [1, 2, 3].map((index) => {
    const href = id === 'ouchn' ? `/mod/${index === 3 ? 'quiz/attempt' : 'resource/view'}.php?id=${100 + index}${layout ? '&layout=' + layout : ''}` : `?chapter=${index}`;
    const label = index === 3 ? '随堂练习' : `视频第 ${index} 节`;
    const anchor = `<a href="${href}" data-next="${index}"><span class="instancename">${label}</span></a>`;
    if (id === 'chaoxing') return `<div class="${index === current ? 'posCatalog_active' : ''}"><div class="posCatalog_name">${anchor}</div></div>`;
    if (id === 'zhihuishu') return `<li class="clearfix video ${index === current ? 'current_play' : ''}">${anchor}</li>`;
    if (id === 'icourse') return `<li class="${index === current ? 'current' : ''}">${anchor}</li>`;
    if (layout.startsWith('custom')) return `<div class="theme-lesson-row">${anchor}</div>`;
    return `<li id="activity-${current}-${index}" class="type_activity ${index === current ? 'current' : ''}">${anchor}</li>`;
  }).join('');
  const nextUrl = `/mod/${current === 2 ? 'quiz' : layout === 'newgk' ? 'page' : 'resource'}/view.php?id=${100 + current + 1}&layout=${layout}`;
  const next = id === 'ouchn' && layout && current < 3 ? `<div class="theme-top-paging" ${layout === 'lockedNext' ? 'aria-disabled="true"' : ''}><a href="${layout === 'unsafeNext' ? 'https://outside.example/mod/resource/view.php?id=102' : nextUrl}">下一页</a></div><div class="theme-bottom-paging"><a href="${layout === 'ambiguousNext' ? '/mod/resource/view.php?id=199' : layout === 'unsafeNext' ? 'https://outside.example/mod/resource/view.php?id=102' : nextUrl}" ${layout === 'lockedNext' ? 'aria-disabled="true"' : ''}>下一页</a></div>` : '';
  const paging = layout === 'newgk' ? next.replaceAll('<a href=', '<a class="newgk-next" href=').replaceAll('下一页</a>', (current === 1 ? '视频教材：关于课程考试' : '继续本课程') + '</a>') : next;
  const directory = layout && !['custom','customExtra','standardExtra'].includes(layout) ? '' : id === 'chaoxing' ? links : `<ul class="${id === 'zhihuishu' ? 'videoList' : id === 'icourse' ? 'j-unitslist' : 'block_tree'}">${links}</ul>`;
  const questionClass = { chaoxing: 'TiMu', zhihuishu: 'questionWrap', icourse: 'u-questionItem', ouchn: 'que' }[id];
  const body = current === 3 ? `<div class="${questionClass}"><h2>2 + 2 的结果是？</h2><label><input type="radio" name="answer" value="a">A. 3</label><label><input type="radio" name="answer" value="b">B. 4</label></div><button id="submit">提交答案</button>` : `<video width="320" height="180" preload="auto" muted src="/__fixture/clip.webm?chapter=${current}"></video>`;
  return `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>模拟课程（非平台验收）</title><h1>模拟课程（非平台验收）</h1><div class="${layout && layout !== 'standardExtra' ? 'theme-outline' : 'block_navigation'}" id="catalog">${directory}</div>${paging}${layout.endsWith('Extra') ? '<aside><a href="/mod/page/view.php?id=199">正文推荐的其他资源</a></aside>' : ''}<main>${body}</main><script>
  document.body.dataset.clicks='0';document.body.dataset.submits='0';
  document.getElementById('submit')?.addEventListener('click',()=>document.body.dataset.submits=String(Number(document.body.dataset.submits)+1));
  if(${JSON.stringify(id)}!=='ouchn')document.getElementById('catalog').addEventListener('click',event=>{
    const anchor=event.target.closest('a[data-next]');if(!anchor)return;event.preventDefault();document.body.dataset.clicks=String(Number(document.body.dataset.clicks)+1);
    const next=Number(anchor.dataset.next);history.pushState({},'',anchor.href);
    document.querySelectorAll('.posCatalog_active,.current_play,.current').forEach(node=>node.classList.remove('posCatalog_active','current_play','current'));
    const active=anchor.closest(${JSON.stringify(id === 'chaoxing' ? '.posCatalog_name' : 'li')});active.classList.add(${JSON.stringify(id === 'chaoxing' ? 'posCatalog_active' : id === 'zhihuishu' ? 'current_play' : 'current')});
    if(next===3)document.querySelector('main').innerHTML=${JSON.stringify(body.replace(/<video[\s\S]*?<\/video>/, `<div class="${questionClass}"><h2>2 + 2 的结果是？</h2><label><input type="radio" name="answer" value="a">A. 3</label><label><input type="radio" name="answer" value="b">B. 4</label></div><button id="submit">提交答案</button>`))};
    else {const video=document.querySelector('video');video.src='/__fixture/clip.webm?chapter='+next;video.load();}
  });</script></html>`;
}

test('isolated Chrome course adapters, real playback, safe navigation, quiz readback and responsive workspace', { skip: !enabled, timeout: 150000 }, async (t) => {
  const { chromium } = await import(process.env.NEXLY_PLAYWRIGHT_PATH || 'playwright');
  const temporary = await mkdtemp(join(tmpdir(), 'quizmate-course-'));
  const requests = [];
  const server = createServer(async (request, response) => {
    try {
      let raw = '';for await (const chunk of request) raw += chunk;
      const body=JSON.parse(raw), question=JSON.parse(body.messages[0].content.split('QUESTION_DATA:\n')[1]);requests.push(question);
      const answer={questionId:question.questionId,type:question.type,choiceIds:['option-1'],fills:[],code:'',explanation:'模拟模型：2 + 2 = 4',confidence:1};
      response.setHeader('Content-Type','application/json');response.end(JSON.stringify({choices:[{message:{content:JSON.stringify(answer)},finish_reason:'stop'}]}));
    } catch { response.writeHead(400).end(); }
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(async()=>{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));});
  const origin=`http://127.0.0.1:${server.address().port}`;
  const extension = join(temporary, 'extension');
  await cp(fileURLToPath(new URL('../extension/', import.meta.url)), extension, { recursive: true });
  const manifest=JSON.parse(await readFile(join(extension,'manifest.json'),'utf8'));
  // 仅隔离副本拥有本机模拟 API 权限；发布 Manifest 不包含测试地址。
  manifest.host_permissions.push(origin+'/*');await writeFile(join(extension,'manifest.json'),JSON.stringify(manifest));
  const context = await chromium.launchPersistentContext(join(temporary, 'profile'), { headless: true, ...(process.env.NEXLY_CHROME_PATH ? { executablePath: process.env.NEXLY_CHROME_PATH } : {}), args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`, '--autoplay-policy=no-user-gesture-required'] });
  t.after(async () => { await context.close(); await rm(temporary, { recursive: true, force: true }); });
  // 所有平台请求在隔离测试上下文内拦截，仅用选择器结构 fixture，绝不连接真实账户或平台接口。
  const network = [];
  await context.route('https://**/*', async (route) => {
    const url = new URL(route.request().url());network.push(url.href);
    const platform = COURSE_PLATFORMS.find((item) => item.hosts.some((host) => url.hostname === host || !item.exactHosts && url.hostname.endsWith('.'+host)));
    if (!platform) return route.abort();
    if (url.pathname === '/__fixture/clip.webm') return route.fulfill({ status: 200, contentType: 'video/webm', body: media });
    return route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: html(platform.id, url) });
  });
  const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  await worker.evaluate(async () => { await chrome.storage.local.set({ courseSettings: { autoNext: true, playbackRate: 1, nextDelayMs: 0, stallSeconds: 30, autoPreviewQuiz: false } }); });
  const panel = await context.newPage(), errors = [];
  panel.on('pageerror', (error) => errors.push(error.message));
  await panel.goto(`chrome-extension://hbgbhhljnmlognjblnchioheiclcopel/panel.html`);
  await panel.locator('#tab-course').click();
  const page = await context.newPage();
  const command = (action, extra = {}) => panel.evaluate(async ({ action, extra }) => chrome.runtime.sendMessage({ type: 'course-command', action, ...extra }), { action, extra });
  const state = () => worker.evaluate(async () => (await chrome.storage.session.get('courseState')).courseState);
  async function waitForPhase(phase) { try { await panel.waitForFunction((phase) => document.getElementById('course-status').dataset.phase === phase, phase, { timeout: 15000 }); } catch (error) { console.log('course failure:', JSON.stringify(await state()), page.url(), errors); throw error; } return state(); }
  async function open(id, override = '') {
    await command('stop');await command('clear');await page.goto(override || initial[id]);
    await page.bringToFront();
    const response = await command('scan');assert.equal(response.ok, true, response.error);
    if (!override) await page.locator('video').evaluate((video) => video.readyState >= 2 ? null : new Promise(resolve => video.addEventListener('loadeddata', resolve, { once: true })));
    return response.data;
  }
  await t.test('course control auto-appears without a quiz, stays closed-shadow and drives the real bound player', async () => {
    await worker.evaluate(async()=>chrome.storage.local.set({autoControls:false}));
    const course = await open('ouchn', initial.ouchn + '&layout=custom');
    await page.waitForFunction(()=>!document.querySelector('[data-nexly-controls]'));
    // 测试保留 closed shadow 引用，生产代码不暴露 shadowRoot 或网页命令接口。
    await worker.evaluate(async(tabId)=>chrome.scripting.executeScript({target:{tabId,frameIds:[0]},world:'ISOLATED',func:()=>{
      const original=Element.prototype.attachShadow;
      Element.prototype.attachShadow=function(options){const root=original.call(this,options);if(this.hasAttribute('data-nexly-controls')){globalThis.__courseTestRoot=root;Element.prototype.attachShadow=original;}return root;};
    }}),course.tabId);
    await worker.evaluate(async()=>chrome.storage.local.set({autoControls:true}));
    await page.locator('[data-nexly-controls]').waitFor();
    assert.equal(await page.evaluate(()=>document.querySelector('[data-nexly-controls]').shadowRoot),null);
    assert.equal(await page.locator('video').evaluate(video=>video.paused),true);
    async function control(selector) {
      const [entry]=await worker.evaluate(async({tabId,selector})=>chrome.scripting.executeScript({target:{tabId,frameIds:[0]},world:'ISOLATED',func:(selector)=>{
        const node=globalThis.__courseTestRoot?.querySelector(selector); if(!node)return null;const r=node.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2,text:node.textContent,disabled:node.disabled,expanded:node.getAttribute('aria-expanded'),opacity:getComputedStyle(node).opacity,status:globalThis.__courseTestRoot.querySelector('.status')?.textContent};
      },args:[selector]}),{tabId:course.tabId,selector});
      return entry.result;
    }
    let point=await control('.launcher');assert.equal(point.expanded,'false');await page.mouse.move(point.x,point.y);
    for(let attempt=0;attempt<50;attempt++){if((await control('.popover')).opacity==='1')break;await new Promise(resolve=>setTimeout(resolve,10));}
    assert.equal((await control('.launcher')).expanded,'true');
    point=await control('.actions button:first-child');assert.equal(point.disabled,false,JSON.stringify(point));await page.mouse.click(point.x,point.y);
    await waitForPhase('playing');
    point=await control('.actions button:nth-child(2)');await page.mouse.click(point.x,point.y);
    await waitForPhase('paused');assert.equal(await page.locator('video').evaluate(video=>video.paused),true);
    await worker.evaluate(() => {
      globalThis.__courseSidebarEvents = [];
      globalThis.__courseSidebarOpened = (info) => globalThis.__courseSidebarEvents.push({ kind: 'opened', info });
      globalThis.__courseSidebarClosed = (info) => globalThis.__courseSidebarEvents.push({ kind: 'closed', info });
      chrome.sidePanel.onOpened.addListener(globalThis.__courseSidebarOpened);
      chrome.sidePanel.onClosed.addListener(globalThis.__courseSidebarClosed);
    });
    try {
      point=await control('.open-panel');await page.mouse.click(point.x,point.y);
      for(let attempt=0;attempt<100;attempt++) {
        if(await worker.evaluate(() => globalThis.__courseSidebarEvents.some(event => event.kind === 'opened'))) break;
        await new Promise(resolve=>setTimeout(resolve,20));
      }
      assert.equal(await worker.evaluate(() => globalThis.__courseSidebarEvents.some(event => event.kind === 'opened')), true, JSON.stringify(await control('.open-panel')));
      point=await control('.launcher');await page.mouse.move(point.x,point.y);
      for(let attempt=0;attempt<100;attempt++) {
        point=await control('.close-panel');
        if(!point.disabled && (await control('.popover')).opacity==='1') break;
        await new Promise(resolve=>setTimeout(resolve,20));
      }
      assert.equal(point.disabled,false,JSON.stringify(point));await page.mouse.click(point.x,point.y);
      for(let attempt=0;attempt<100;attempt++) {
        if(await worker.evaluate(() => globalThis.__courseSidebarEvents.some(event => event.kind === 'closed'))) break;
        await new Promise(resolve=>setTimeout(resolve,20));
      }
      assert.equal(await worker.evaluate(() => globalThis.__courseSidebarEvents.some(event => event.kind === 'closed')), true, JSON.stringify(await control('.close-panel')));
      assert.equal((await state()).phase,'paused','closing the native sidebar must preserve the bound course state');
      assert.equal(await page.locator('video').evaluate(video=>video.paused),true);
    } finally {
      await worker.evaluate(() => {
        chrome.sidePanel.onOpened.removeListener(globalThis.__courseSidebarOpened);
        chrome.sidePanel.onClosed.removeListener(globalThis.__courseSidebarClosed);
        delete globalThis.__courseSidebarEvents;delete globalThis.__courseSidebarOpened;delete globalThis.__courseSidebarClosed;
      });
    }
    point=await control('.launcher');await page.mouse.move(point.x,point.y);
    for(let attempt=0;attempt<100;attempt++){if((await control('.popover')).opacity==='1')break;await new Promise(resolve=>setTimeout(resolve,10));}
    point=await control('.course-tools button:nth-child(2)');assert.equal(point.disabled,false);await page.mouse.click(point.x,point.y);
    await waitForPhase('ready');assert.ok(page.url().includes('id=102'));assert.equal(await page.locator('video').evaluate(video=>video.paused),true);
    await page.locator('[data-nexly-controls]').waitFor();assert.equal(await page.locator('[data-nexly-controls]').count(),1);
    await worker.evaluate(async()=>chrome.storage.local.set({autoControls:false}));
    await page.waitForFunction(()=>!document.querySelector('[data-nexly-controls]'));
    await worker.evaluate(async()=>chrome.storage.local.set({autoControls:true}));
    await page.locator('[data-nexly-controls]').waitFor();
  });
  await t.test('turning off auto controls discards an already-injected late response', async () => {
    await worker.evaluate(async () => chrome.storage.local.set({ autoControls: false }));
    await open('ouchn', initial.ouchn + '&layout=custom');
    await page.waitForFunction(() => !document.querySelector('[data-nexly-controls]'));
    await worker.evaluate(() => {
      const original = chrome.scripting.executeScript.bind(chrome.scripting);
      globalThis.__restoreCourseInjection = () => { chrome.scripting.executeScript = original; };
      chrome.scripting.executeScript = async (details) => {
        const result = await original(details);
        if (details.func?.name === 'installPageControls') {
          globalThis.__courseInjectionWaiting = true;
          await new Promise(resolve => { globalThis.__releaseCourseInjection = resolve; });
        }
        return result;
      };
    });
    await worker.evaluate(async () => chrome.storage.local.set({ autoControls: true }));
    await page.waitForFunction(() => document.querySelector('[data-nexly-controls]'));
    for (let tries = 0; tries < 100 && !await worker.evaluate(() => Boolean(globalThis.__courseInjectionWaiting)); tries++) await new Promise(resolve => setTimeout(resolve, 10));
    assert.equal(await worker.evaluate(() => Boolean(globalThis.__courseInjectionWaiting)), true);
    await worker.evaluate(async () => { await chrome.storage.local.set({ autoControls: false }); globalThis.__releaseCourseInjection(); });
    await page.waitForFunction(() => !document.querySelector('[data-nexly-controls]'));
    await worker.evaluate(() => { globalThis.__restoreCourseInjection(); delete globalThis.__restoreCourseInjection; delete globalThis.__releaseCourseInjection; delete globalThis.__courseInjectionWaiting; });
    assert.equal(await page.locator('video').evaluate(video => video.paused), true);
    await worker.evaluate(async () => chrome.storage.local.set({ autoControls: true }));
  });
  for (const id of Object.keys(initial)) {
    const snapshot = (await open(id)).snapshot;
    assert.equal(snapshot.platformId, id);assert.equal(snapshot.chapters.length, 3);assert.equal(snapshot.chapters.filter(item => item.current).length, 1);
    assert.equal(snapshot.media.paused, true, '识别不能自动播放');
  }
  await t.test('saved 16x speed reaches the real HTML5 player without forced navigation', async () => {
    const saved = await worker.evaluate(async () => (await chrome.storage.local.get('courseSettings')).courseSettings);
    try {
      await worker.evaluate(async (settings) => chrome.storage.local.set({ courseSettings: { ...settings, playbackRate: 16, autoNext: false } }), saved);
      await open('chaoxing');
      const result = await command('start');
      assert.equal(result.ok, true, result.error);
      assert.equal(result.data.settings.playbackRate, 16);
      assert.equal(await page.locator('video').evaluate(video => video.playbackRate), 16);
      await page.waitForFunction(() => document.querySelector('video')?.ended);
      assert.equal(page.url(), initial.chaoxing);
    } finally {
      await command('stop');
      await worker.evaluate(async (courseSettings) => chrome.storage.local.set({ courseSettings }), saved);
    }
  });
  await t.test('custom Moodle sidebar uses activity IDs without generic classes or current markers', async () => {
    const course = await open('ouchn', initial.ouchn + '&layout=custom');
    assert.equal(course.snapshot.chapters.length, 3);
    assert.equal(course.snapshot.chapters.filter(item => item.current).length, 1);
    assert.equal(course.snapshot.chapters.find(item => item.current).index, 0);
    assert.ok(course.snapshot.nextChapter, 'the explicit top/bottom next links are deduplicated');
    assert.equal((await command('start')).ok, true);
    const result = await waitForPhase('awaitingQuiz');
    assert.equal(result.watched, 2);
    assert.ok(page.url().includes('id=103'));
  });
  await t.test('chapter search and locating the current chapter never navigate or play', async () => {
    const course = await open('ouchn', initial.ouchn + '&layout=custom');
    await panel.bringToFront(); await panel.locator('#tab-course').click();
    await panel.waitForFunction(() => document.querySelectorAll('#course-chapters li').length === 3);
    await panel.locator('#course-directory-search').fill(course.snapshot.chapters[1].title);
    assert.equal(await panel.locator('#course-chapters li:visible').count(), 1);
    await panel.locator('#course-directory-search').fill('不存在的课程名称');
    assert.equal(await panel.locator('#course-filter-empty').isVisible(), true);
    await panel.locator('#course-locate').click();
    assert.equal(await panel.locator('#course-directory-search').inputValue(), '');
    assert.equal(await panel.locator('#course-chapters li:visible').count(), 3);
    assert.equal(await page.locator('video').evaluate(video => video.paused), true);
    assert.ok(page.url().includes('id=101'));
    await page.bringToFront();
  });
  await t.test('next-page fallback continues real videos without a readable sidebar', async () => {
    const course = await open('ouchn', initial.ouchn + '&layout=nextOnly');
    assert.equal(course.snapshot.chapters.length, 0);
    assert.ok(course.snapshot.nextChapter);
    assert.equal((await command('start')).ok, true);
    const result = await waitForPhase('awaitingQuiz');
    assert.equal(result.watched, 2);
    assert.equal(await page.getAttribute('body', 'data-submits'), '0');
  });
  await t.test('known Moodle next class works without generic text, but only through a safe activity URL', async () => {
    const course = await open('ouchn', initial.ouchn + '&layout=newgk');
    assert.equal(course.snapshot.chapters.length, 0); assert.ok(course.snapshot.nextChapter);
    assert.match(course.snapshot.nextChapter.title, /视频教材/);
    assert.equal((await command('nextChapter')).ok, true);
    await waitForPhase('ready');
    assert.ok(page.url().includes('/mod/page/view.php?id=102'));
    assert.equal(await page.locator('video').evaluate(video => video.paused), true);
  });
  await t.test('standard and custom catalogs never absorb unrelated body activity links', async () => {
    for (const layout of ['standardExtra','customExtra']) {
      const course = await open('ouchn', initial.ouchn + '&layout=' + layout);
      assert.equal(course.snapshot.chapters.length, 3);
      assert.equal(course.snapshot.chapters.some(chapter => chapter.title.includes('正文推荐')), false);
    }
  });
  await t.test('ambiguous, cross-origin and locked next links never result in blind navigation', async () => {
    for (const layout of ['ambiguousNext', 'unsafeNext', 'lockedNext']) {
      const course = await open('ouchn', initial.ouchn + '&layout=' + layout);
      if (layout === 'lockedNext') assert.equal(course.snapshot.nextChapter.locked, true);
      else assert.equal(course.snapshot.nextChapter, null);
      assert.equal((await command('start')).ok, true);
      await waitForPhase(layout === 'lockedNext' ? 'blocked' : 'paused');
      assert.ok(page.url().includes('id=101'));
    }
  });
  // SPA 连续换章：真实视频结束两次后停在随堂练习，不点击提交。
  await open('chaoxing');assert.equal((await command('start')).ok, true);
  let course = await waitForPhase('awaitingQuiz');assert.equal(course.watched, 2);assert.equal(await page.getAttribute('body', 'data-clicks'), '2');
  let result = await command('chooseQuestion', { key: course.snapshot.questions[0].key });assert.equal(result.ok, true, result.error);
  // 复用真正的页面解题解析与回填逻辑，无单选题 marker 也只操作明确选中的课程题块。
  const tabId = course.tabId;
  await worker.evaluate(async (origin) => {
    await chrome.storage.local.set({connectionMode:'api',dataConsentVersion:1,pacing:{answerDelayMs:0,actionIntervalMs:0,typingIntervalMs:0,typewriter:false},apiConfig:{baseUrl:origin+'/v1',protocol:'chat',model:'course-fixture',timeoutSeconds:15}});
    await chrome.storage.session.set({apiCredential:{origin,key:'sk-course-fixture'}});
  },origin);
  async function waitForTask(phase) {
    for (let attempt=0; attempt<200; attempt++) {
      const reply=await panel.evaluate(()=>chrome.runtime.sendMessage({type:'command',action:'state'}));
      if (!reply.data.busy && reply.data.phase===phase) return reply.data;
      if (!reply.data.busy && reply.data.phase==='error') throw new Error(reply.data.error);
      await panel.waitForTimeout(50);
    }
    throw new Error('课程 AI 任务未完成：'+phase);
  }
  // 真正通过课程入口启动现有 API 任务；预览不写入，填写不点击提交。
  result=await command('previewQuiz');assert.equal(result.ok,true,result.error);
  await waitForTask('ready');
  assert.equal(await page.isChecked('input[value=b]'),false);
  result=await command('fillQuiz');assert.equal(result.ok,true,result.error);
  await waitForTask('filled');
  assert.equal(await page.isChecked('input[value=b]'),true);
  assert.equal(await page.getAttribute('body','data-submits'),'0');assert.equal(requests.length,2);
  assert.ok(!JSON.stringify(requests).includes('视频第 1 节'),'目录不应进入模型请求');
  await page.evaluate(()=>document.querySelector('input[value=b]').checked=false);
  async function exercise(action, payload = {}) {
    const handle = await worker.evaluateHandle('('+pageAction.toString()+')');
    try { return await worker.evaluate(async ({ tabId, action, payload, func }) => { const [entry] = await chrome.scripting.executeScript({ target: { tabId }, world: 'MAIN', func, args: [action, payload] }); return entry.result; }, { tabId, action, payload, func: handle }); }
    finally { await handle.dispose(); }
  }
  let read = await exercise('read');assert.equal(read.ok, true, read.error);
  result = await exercise('fill', { allowBackground: true, questionId: read.question.questionId, answer: { questionId: read.question.questionId, type: read.question.type, choiceIds: ['option-1'] } });
  assert.equal(result.ok, true, result.error);assert.equal(result.verified, true);assert.equal(await page.isChecked('input[value=b]'), true);assert.equal(await page.getAttribute('body', 'data-submits'), '0');
  await panel.locator('#tab-course').click();
  // Moodle 的完整文档导航：DOM id 变化但相同活动链接可恢复；遇到题目后暂停。
  await open('ouchn');assert.equal((await command('start')).ok, true);
  course = await waitForPhase('awaitingQuiz');assert.equal(course.snapshot.platformId, 'ouchn');assert.equal(course.watched, 2);
  assert.match(page.url(), /quiz\/attempt\.php/);assert.equal(await page.getAttribute('body', 'data-submits'), '0');
  await command('chooseQuestion', { key: course.snapshot.questions[0].key });
  read = await exercise('read');assert.equal(read.ok, true, read.error);assert.equal(read.question.options.length, 2);
  // 每个平台的题块选择器均回归；这只是模拟结构，不是登录后的真实课程验收。
  for (const id of ['zhihuishu', 'icourse']) {
    const course = await open(id, initial[id].replace('chapter=1', 'chapter=3'));
    assert.equal(course.snapshot.questions.length, 1);
    assert.equal((await command('chooseQuestion', { key: course.snapshot.questions[0].key })).ok, true);
    read = await exercise('read');assert.equal(read.ok, true, `${id}: ${read.error}`);
  }
  await open('chaoxing');await command('start');await command('pause');
  assert.equal(await page.locator('video').evaluate(video => video.paused), true);
  await command('start');await command('stop');assert.equal(await page.locator('video').evaluate(video => video.paused), true);
  // 当前播放器之外的隐藏 frame 不可误选；多可见播放器则拒绝猜测。
  await page.evaluate(() => { const hidden=document.createElement('iframe');hidden.hidden=true;hidden.src=location.href+'&hidden-fixture=1';document.body.append(hidden); });
  await page.waitForFunction(() => document.querySelector('iframe')?.contentDocument?.querySelector('video'));
  assert.equal((await command('scan')).ok, true, '隐藏 frame 不能被当成第二个活动播放器');
  await page.locator('iframe').evaluate(frame => frame.remove());
  await page.evaluate(() => { const other=document.createElement('video');other.width=100;other.height=100;document.body.append(other); });
  result=await command('scan');assert.equal(result.ok,false);assert.match(result.error,/多个可见播放器/);
  await page.evaluate(() => document.querySelectorAll('video')[1].remove());
  // 不完整课程 URL / 登录 / 验证码提示都禁止启动。
  await open('ouchn', 'https://moodle.syxy.ouchn.cn/course/view.php');
  assert.match((await state()).snapshot.gate, /缺少课程 ID/);
  for (const gate of ['<input type="password">', '<div data-captcha>请验证</div>']) {
    await open('ouchn');await page.evaluate((markup) => document.body.insertAdjacentHTML('beforeend', markup), gate);
    await command('scan');await command('start');assert.equal((await state()).phase, 'blocked');
    assert.equal(await page.locator('video').evaluate(video => video.paused), true);
  }
  await open('chaoxing', 'https://mooc1.chaoxing.com/exam/test');
  await command('start');assert.equal((await state()).phase, 'blocked');
  await open('ouchn');await command('scan');
  await panel.bringToFront();
  for (const colorScheme of ['light', 'dark']) {
    await panel.emulateMedia({ colorScheme, reducedMotion: 'reduce' });
    for (const width of [320, 400, 1280, 1920]) {
      await panel.setViewportSize({ width, height: 800 });
      assert.equal(await panel.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `${colorScheme}/${width} 溢出`);
      if (process.env.NEXLY_SCREENSHOT_DIR) { await mkdir(process.env.NEXLY_SCREENSHOT_DIR, { recursive: true }); await panel.screenshot({ path: join(process.env.NEXLY_SCREENSHOT_DIR, `course-${colorScheme}-${width}.png`), fullPage: true }); }
    }
  }
  await panel.locator('#tab-course').focus();await panel.keyboard.press('ArrowLeft');assert.equal(await panel.locator('#tab-home').getAttribute('aria-selected'), 'true');
  await panel.keyboard.press('ArrowRight');assert.equal(await panel.locator('#tab-course').getAttribute('aria-selected'), 'true');
  assert.equal(errors.length, 0, errors.join('\n'));assert.ok(!network.some(url => /\/api\//.test(url)));
});

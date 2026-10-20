import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, cp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
const enabled = process.env.NEXLY_BROWSER_TEST === '1';
// 可选的真实扩展回归：外部提供 Playwright 与 Chromium；不向项目增加 npm 依赖或真实凭证。
test('Chrome extension API UI, real Worker fetch, secret isolation, closed-panel continuation and cancellation', { skip: !enabled, timeout: 100000 }, async (t) => {
  const { chromium } = await import(process.env.NEXLY_PLAYWRIGHT_PATH || 'playwright');
  const temporary = await mkdtemp(join(tmpdir(), 'nexly-browser-'));
  let delay = 0, status = 200;
  const received = [], errors = [];
  const server = createServer(async (request, response) => {
    if (request.url === '/unrecognized-form') { response.setHeader('Content-Type', 'text/html; charset=utf-8'); response.end('<!doctype html><html><body><label>联系邮箱<input type="email"></label></body></html>'); return; }
    if (request.url.startsWith('/mod/assign/view.php?')) {
      response.setHeader('Content-Type', 'text/html; charset=utf-8');
      response.end(`<!doctype html><html lang="zh-CN"><title>模拟大作业</title><body data-navigation="0" data-submit="0"><aside>PRIVATE-COURSE-NAVIGATION</aside><main id="region-main"><h1>大作业</h1><div id="intro"><h2>大作业说明</h2><p>学生答题不能复制粘贴。论述严谨，字数不少于1000字。</p><p>大作业：请结合材料说明创新机制。</p></div><section class="submissionsummarytable">没有尝试<textarea id="assignment-editor">人工原稿</textarea><button onclick="document.body.dataset.navigation++">添加作业</button><button onclick="document.body.dataset.submit++">提交作业</button><button onclick="document.body.dataset.navigation++">下一活动</button></section></main></body></html>`); return;
    }
    if (request.url === '/practice') {
      response.setHeader('Content-Type', 'text/html; charset=utf-8');
      response.end('<!doctype html><html lang="zh-CN"><title>练习</title><div data-nexly-question><h1>单选题：2 + 2 等于多少？</h1><label><input type="radio" name="answer" value="a">A. 3</label><label><input type="radio" name="answer" value="b">B. 4</label></div></html>'); return;
    }
    if (request.url === '/multi-practice') {
      response.setHeader('Content-Type', 'text/html; charset=utf-8');
      response.end(`<!doctype html><html lang="zh-CN"><title>同页多题</title><body data-nav="0" data-submit="0"><header>PRIVATE-HEADER<input type="text" aria-label="搜索课程"></header><form onsubmit="event.preventDefault();document.body.dataset.submit++">
        <div class="que description"><h2>一、单项选择题</h2></div>
        ${[1,2].map(index=>`<div class="que multichoice" id="q${index}"><div class="info"><span class="state">还未作答</span><label><input type="checkbox">标记试题</label></div><div class="content"><div class="qtext">选择四的正确表示</div><label><input type="radio" name="q${index}" value="a" ${index===1?'checked':''}>A. 3</label><label><input type="radio" name="q${index}" value="b">B. 4</label><div class="qtype_multichoice_clearchoice ${index===1?'':'sr-only'}"><input type="radio" name="q${index}" value="-1" class="sr-only" aria-hidden="true"><a href="#">清空我的选择</a></div></div></div>`).join('')}
        <div class="que description"><h2>二、判断题</h2></div>
        <div class="que truefalse" id="q3"><div class="info"><span class="state">还未作答</span></div><div class="qtext">此判断题仅用于测试</div><label><input type="radio" name="q3" value="a">对</label><label><input type="radio" name="q3" value="b">错</label></div>
        <div class="que multichoice" id="q4"><div class="qtext">多选题：选择多个答案</div>${['甲','乙','丙'].map((value,index)=>`<label><input type="checkbox" value="${index}">${value}</label>`).join('')}</div>
        <div class="que shortanswer" id="q5"><div class="qtext">填空题：填写结果</div><input type="text" aria-label="结果"></div>
        <div class="que essay" id="q6" style="margin-top:900px"><div class="qtext">简答题：填写说明</div><textarea aria-label="说明"></textarea></div>
        <div class="que multichoice" hidden><div class="qtext">隐藏缓存题</div><input type="radio"><input type="radio"></div>
        <button type="button" id="sheet-next" onclick="document.body.dataset.nav++">下一题</button><button type="button" onclick="document.body.dataset.nav++">上一题</button><button id="sheet-submit">提交所有答案</button></form>
        <script>document.querySelectorAll('.que input,.que textarea').forEach(input=>input.addEventListener('change',()=>{const root=input.closest('.que'),state=root.querySelector('.state'),clear=root.querySelector('.qtype_multichoice_clearchoice');if(state)state.textContent='已作答';if(clear)clear.classList.remove('sr-only');}));</script></body></html>`);return;
    }
    if (['/code-practice', '/codemirror-practice'].includes(request.url)) {
      const codeMirror = request.url === '/codemirror-practice', language = codeMirror ? 'TypeScript' : 'ArkTS';
      const editorMarkup = codeMirror
        ? '<div class="CodeMirror"><textarea rows="8" cols="70">// 请实现</textarea></div>'
        : '<textarea data-code-editor data-language="ArkTS" rows="8" cols="70">// 请实现</textarea>';
      const failed = codeMirror
        ? '编译错误\n测试输入\n1 1\n测试输出\nsolution.ts(12,19): error TS2737: BigInt literals are not available when targeting lower than ES2020.\n预期输出\n2'
        : "编译错误\n测试输入\n1 2 3 4 5\n测试输出\nsolution.ts(18,23): error TS2802: Type 'Set<number>' requires target es2015.\n预期输出\n0";
      const passed = codeMirror ? '通过\n测试输入\n1 1\n测试输出\n2\n预期输出\n2' : '通过\n测试输入\n1 2 3 4 5\n测试输出\n0\n预期输出\n0';
      response.setHeader('Content-Type', 'text/html; charset=utf-8');
      response.end(`<!doctype html><html lang="zh-CN"><title>模拟编程练习</title><main data-nexly-question><h1>编程题：${codeMirror ? '计算 1 + 1（模拟 TypeScript 编译环境）' : '相反数（自动化测试页面）'}</h1><p>${codeMirror ? '输出 1 + 1 的结果，样例输出 2。' : '输入整数，输出相反数对的数量。样例输入 1 2 3 4 5，输出 0。'}</p><select aria-label="编程语言"><option>${language}</option></select>${editorMarkup}<button id="execute">执行代码</button><button id="submit-code">提交代码</button><button id="next-question">随机一题</button><div data-nexly-result style="white-space:pre-wrap"></div><div data-nexly-result hidden>通过 测试输出 old</div><div id="execution-overlay" aria-busy="false"></div></main><script>
      let runs=0,submits=0,nexts=0;
      const codeMirror=${codeMirror},run=document.getElementById('execute'),result=document.querySelector('[data-nexly-result]'),area=document.querySelector('textarea'),overlay=document.getElementById('execution-overlay');
      // 只模拟 CodeMirror 5 已暴露的 API；不创建或下载第三方编辑器，也不代表真实站点验收。
      if(codeMirror){const doc={};document.querySelector('.CodeMirror').CodeMirror={getDoc:()=>doc,getValue:()=>area.value,setValue:value=>{area.value=value;},getOption:name=>name==='readOnly'&&area.readOnly};}
      document.getElementById('submit-code').onclick=()=>document.body.dataset.submits=String(++submits);
      document.getElementById('next-question').onclick=()=>document.body.dataset.nexts=String(++nexts);
      run.onclick=()=>{document.body.dataset.runs=String(++runs);run.disabled=true;result.textContent='编译中';if(codeMirror){area.readOnly=true;overlay.setAttribute('aria-busy','true');}setTimeout(()=>{
        const correct=codeMirror?!area.value.includes('1n'):area.value.includes('.forEach(');
        result.textContent=correct?${JSON.stringify(passed)}:${JSON.stringify(failed)};run.disabled=false;
        if(codeMirror)setTimeout(()=>{area.readOnly=false;overlay.setAttribute('aria-busy','false');},400);
      },codeMirror?1200:80);};</script></html>`); return;
    }
    if (!['/v1/models', '/v1/chat/completions', '/v1/responses'].includes(request.url)) { response.writeHead(404); response.end(); return; }
    const chunks = []; for await (const chunk of request) chunks.push(chunk);
    const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : null;
    received.push({ path: request.url, body });
    if (status !== 200) { response.writeHead(status); response.end('do-not-echo-private-key'); return; }
    if (request.url === '/v1/models') { response.setHeader('Content-Type', 'application/json'); response.end(JSON.stringify({ data: [{ id: 'mock-model' }] })); return; }
    if (!body) { response.writeHead(400); response.end(); return; }
    const prompt = body.messages?.[0].content || body.input?.[0].content;
    const question = JSON.parse(prompt.split('QUESTION_DATA:\n')[1]);
    const answer = question.type === 'code'
      ? { questionId: question.questionId, type: 'code', choiceIds: [], fills: [], code: question.language === 'TypeScript' ? (question.executionFeedback ? 'console.log(1 + 1);' : 'const sum = 1n + 1n;\nconsole.log(sum.toString());') : (question.executionFeedback ? 'const values = new Set<number>();\nvalues.forEach((n) => console.log(n));' : 'const values = new Set<number>();\nfor (const n of values) {}'), explanation: '模拟模型：根据页面编译日志修正迭代方式。', confidence: 1 }
      : { questionId: question.questionId, type: question.type, choiceIds: ['blank','text'].includes(question.type) ? [] : question.type === 'multiple' ? ['option-0','option-2'] : ['option-1'], fills: question.fields.map(field => ({fieldId:field.id,value:'测试结果 42'})), code: '', explanation: '2 + 2 = 4。', confidence: 1 };
    const timer = setTimeout(() => {
      if (response.destroyed) return;
      response.setHeader('Content-Type', 'text/event-stream');
      if (request.url === '/v1/responses') response.end(`data: ${JSON.stringify({ type: 'response.completed', response: { status: 'completed', output: [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: JSON.stringify(answer) }] }] } })}\n\n`);
      else response.end(`data: ${JSON.stringify({ choices: [{ index: 0, delta: { content: JSON.stringify(answer) }, finish_reason: 'stop' }] })}\n\ndata: [DONE]\n\n`);
    }, delay);
    response.on('close', () => clearTimeout(timer));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`, extension = join(temporary, 'extension');
  await cp(fileURLToPath(new URL('../extension/', import.meta.url)), extension, { recursive: true });
  const manifest = JSON.parse(await readFile(join(extension, 'manifest.json'), 'utf8'));
  // 仅给本测试夹具预授本机 origin，避免无头浏览器无法操作系统权限弹窗；不修改源码 Manifest。
  manifest.host_permissions = [...(manifest.host_permissions || []), `${origin}/*`]; await writeFile(join(extension, 'manifest.json'), JSON.stringify(manifest));
  const options = { headless: true, ...(process.env.NEXLY_CHROME_PATH ? { executablePath: process.env.NEXLY_CHROME_PATH } : {}), args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`] };
  let context = await chromium.launchPersistentContext(join(temporary, 'profile'), options);
  t.after(async () => { await context.close(); server.closeAllConnections(); await new Promise((resolve) => server.close(resolve)); await rm(temporary, { recursive: true, force: true }); });
  let background = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  await background.evaluate(async () => { await chrome.storage.local.set({ connectionMode: 'api', count: 1, pacing: { answerDelayMs: 0, actionIntervalMs: 0, typingIntervalMs: 0, typewriter: false } }); });
  const page = await context.newPage();
  t.after(async () => { if (!page.isClosed()) console.log('API UI status:', await page.locator('#api-status').textContent().catch(() => ''), 'page errors:', errors); }); page.on('pageerror', (error) => errors.push(error.message)); page.setDefaultTimeout(10000);
  const panelUrl = `chrome-extension://${manifest.key ? 'hbgbhhljnmlognjblnchioheiclcopel' : ''}/panel.html?view=practice`;
  await page.goto(panelUrl);
  await page.locator('#data-consent').waitFor({ state: 'visible' });
  // 宽屏不能只检查“无溢出”：连接条即使未溢出，也可能偏在视口最左边。
  for (const colorScheme of ['light', 'dark']) {
    await page.emulateMedia({ colorScheme, reducedMotion: 'reduce' });
    for (const width of [320, 400, 768, 1280, 1920, 2560]) {
      await page.setViewportSize({ width, height: 800 });
      const layout = await page.evaluate(() => {
        const width = document.documentElement.clientWidth;
        const selectors = ['.header', '.connection-strip', '.navigation-shell', 'main'];
        return { width, scroll: document.documentElement.scrollWidth, centers: selectors.map(selector => {
          const rect = document.querySelector(selector).getBoundingClientRect();
          return { selector, delta: Math.abs(rect.left + rect.width / 2 - width / 2) };
        }) };
      });
      assert.ok(layout.scroll <= layout.width, `${colorScheme} ${width}px 横向溢出`);
      for (const { selector, delta } of layout.centers) assert.ok(delta <= 1, `${colorScheme} ${width}px ${selector} 未居中：${delta}px`);
    }
  }
  await page.emulateMedia({ colorScheme: 'light', reducedMotion: 'no-preference' });
  await page.setViewportSize({ width: 1280, height: 800 });

  assert.equal(await page.locator('#auto').isDisabled(), true);
  await page.locator('#data-consent-check').check(); await page.locator('#accept-data-use').click();
  await page.locator('#data-consent').waitFor({ state: 'hidden' });
  await page.locator('#open-settings').click(); await page.locator('#setting-controls').click(); await page.locator('#save-settings').click();
  await page.waitForFunction(() => document.getElementById('api-url').getAttribute('aria-invalid') === 'true');
  assert.match(await page.locator('#api-url-error').textContent(), /调用地址/);
  assert.equal(await page.locator('#settings-connection').isVisible(), true);
  assert.equal(await page.locator('#api-url').evaluate(input => input === document.activeElement), true);
  const beforePresets = received.length;
  assert.equal(await page.locator('.api-promotion a').getAttribute('href'), 'https://nexly.guangnian.xin/');
  assert.match(await page.locator('.api-promotion').textContent(), /推广/);
  const { API_PROVIDERS } = await import('../extension/lib/api-providers.js');
  for (const preset of API_PROVIDERS.filter((item) => item.baseUrl)) {
    await page.locator('#api-key').fill('sk-must-not-follow-preset');
    await page.locator('#api-provider').selectOption(preset.id);
    assert.equal(await page.locator('#api-url').inputValue(), preset.baseUrl);
    assert.equal(await page.locator('#api-key').inputValue(), '');
    assert.equal(await page.locator('#api-model').inputValue(), '');
  }
  assert.equal(received.length, beforePresets, 'presets and promotion do not make API requests');
  await page.locator('#api-url').fill(origin + '/v1'); await page.locator('#api-key').fill('sk-browser-fixture'); await page.locator('#api-model').fill('mock-model');
  await page.locator('#show-api-key').click(); assert.equal(await page.locator('#api-key').getAttribute('type'), 'text'); await page.locator('#show-api-key').click();
  await page.locator('#api-fetch-models').click(); await page.waitForFunction(() => document.getElementById('api-status').textContent.includes('已获取'));
  assert.equal(await page.locator('#api-models option').count(), 1);
  await page.locator('#api-test').click(); await page.waitForFunction(() => document.getElementById('api-status').textContent.includes('测试通过'));
  assert.ok(received.at(-1).body.messages[0].content.includes('quizmate-api-connection-test'));
  await page.locator('#remember-api-key').check(); await page.locator('#save-settings').click();
  await page.waitForFunction(() => document.getElementById('api-password').getAttribute('aria-invalid') === 'true');
  const passphrase = 'nexly browser secret 123';
  await page.locator('#api-password').fill(passphrase); await page.locator('#api-password-confirm').fill('different passphrase'); await page.locator('#save-settings').click();
  await page.waitForFunction(() => document.getElementById('api-password-confirm').getAttribute('aria-invalid') === 'true');
  await page.locator('#api-password-confirm').fill(passphrase); await page.locator('#save-settings').click();
  await page.waitForFunction(() => document.getElementById('settings-status').textContent.startsWith('已保存'));
  assert.equal(await page.locator('#api-key').inputValue(), '');
  const metadata = await page.evaluate(() => chrome.runtime.sendMessage({ type: 'command', action: 'apiSettings' }));
  assert.equal(metadata.data.hasKey, true); assert.equal(JSON.stringify(metadata).includes('sk-browser-fixture'), false);
  const persisted = await background.evaluate(() => chrome.storage.local.get(null));
  for (const secret of ['sk-browser-fixture', passphrase]) assert.ok(!JSON.stringify(persisted).includes(secret));
  assert.ok(persisted.apiVault); assert.equal(persisted.apiCredential, undefined);
  await page.locator('#lock-api-key').click(); await page.waitForFunction(() => !document.getElementById('unlock-api-key').hidden);
  assert.equal(await background.evaluate(async () => Boolean((await chrome.storage.session.get('apiCredential')).apiCredential)), false);
  await page.locator('#api-password').fill('incorrect password 123'); await page.locator('#unlock-api-key').click();
  await page.waitForFunction(() => document.getElementById('api-status').textContent.includes('解锁失败'));
  await page.locator('#api-password').fill(passphrase); await page.locator('#unlock-api-key').click();
  await page.waitForFunction(() => document.getElementById('api-status').textContent.includes('密钥已解锁'));
  assert.equal(await page.locator('#api-password').inputValue(), '');
  const exercise = await context.newPage(); await exercise.goto(origin + '/practice');
  const [{ id: tabId }] = await background.evaluate((url) => chrome.tabs.query({ url }), origin + '/practice');
  const isolated = await background.evaluate((id) => chrome.scripting.executeScript({ target: { tabId: id }, world: 'ISOLATED', func: async () => { try { return { data: await chrome.storage.local.get('apiCredential') }; } catch { return { blocked: true }; } } }), tabId);
  assert.equal(isolated[0].result.blocked, true);
  // 迁移回会话保存，保证不残留本机凭证。
  await page.bringToFront(); await page.locator('#remember-api-key').uncheck(); await page.locator('#save-settings').click();
  await page.waitForFunction(() => document.getElementById('settings-status').textContent.startsWith('已保存') && !document.getElementById('save-settings').disabled);
  assert.equal(await background.evaluate(async () => Boolean((await chrome.storage.local.get('apiVault')).apiVault)), false);
  for (const width of [320, 900]) {
    await page.setViewportSize({ width, height: 900 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    if (process.env.NEXLY_SCREENSHOT_DIR) await page.screenshot({ path: join(process.env.NEXLY_SCREENSHOT_DIR, `nexly-api-${width}.png`), fullPage: true });
  }
  await t.test('Moodle assignment is recognized and produces one review draft without editor writes, navigation or submission', async (t) => {
    const assignment = await context.newPage(); await assignment.goto(origin + '/mod/assign/view.php?id=123');
    const command = action => page.evaluate(action => chrome.runtime.sendMessage({ type: 'command', action }), action);
    t.after(async () => { await command('stop'); await assignment.close(); await exercise.bringToFront(); });
    if (await page.locator('#close-settings').isVisible()) await page.locator('#close-settings').click();
    const read = await command('read'); assert.equal(read.ok, true, read.error);
    assert.equal(read.data.question.type, 'text'); assert.equal(read.data.question.assignment.minimumCharacters, 1000);
    const before = received.length;
    const started = await page.evaluate(() => chrome.runtime.sendMessage({ type: 'command', action: 'start', count: 20 }));
    assert.equal(started.ok, true, started.error);
    const state = await page.evaluate(async () => {
      for (let index = 0; index < 400; index++) {
        const { taskState } = await chrome.storage.session.get('taskState');
        if (taskState && !taskState.busy) return taskState;
        await new Promise(resolve => setTimeout(resolve, 25));
      }
      throw new Error('Assignment preview did not complete');
    });
    assert.equal(state.phase, 'ready', state.error); assert.equal(state.autoFill, false); assert.equal(state.completed, 0);
    const requests = received.slice(before).filter(entry => entry.path === '/v1/chat/completions');
    assert.equal(requests.length, 1); assert.doesNotMatch(requests[0].body.messages[0].content, /PRIVATE-COURSE|人工原稿/);
    assert.equal(await assignment.locator('#assignment-editor').inputValue(), '人工原稿');
    assert.equal(await assignment.getAttribute('body', 'data-navigation'), '0'); assert.equal(await assignment.getAttribute('body', 'data-submit'), '0');
    await page.waitForFunction(() => document.getElementById('question-type').textContent.includes('大作业'));
    assert.equal(await page.locator('#auto').textContent(), '生成作业参考草稿');
    assert.equal(await page.locator('#fill').isVisible(), false);
    assert.match(await page.locator('#practice-hint').textContent(), /禁止复制粘贴/);
    assert.match(await page.locator('#fill-status').textContent(), /未填写、保存或提交/);
    assert.match(await page.locator('#fill-status').textContent(), /低于题面 1000 字要求/);
    assert.equal((await command('fill')).ok, false);
    for (const width of [320, 900]) {
      await page.setViewportSize({ width, height: 900 });
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
      if (process.env.NEXLY_SCREENSHOT_DIR) await page.screenshot({ path: join(process.env.NEXLY_SCREENSHOT_DIR, `nexly-assignment-${width}.png`), fullPage: true });
    }
    await assignment.goto(origin + '/unrecognized-form');
    assert.equal((await command('read')).ok, false);
    const cleared = await page.evaluate(async () => (await chrome.storage.session.get('taskState')).taskState);
    assert.equal(cleared.question, null); assert.equal(cleared.answer, null); assert.equal(cleared.target, null);
    assert.equal(await page.locator('#answer-section').isVisible(), false);
  });
  // Moodle 同页多题：真实 DOM + Worker + API，包含重复题干、标记框、隐藏题和屏幕外题。
  await t.test('all current-page questions are filled without navigation or submission', async (t) => {
    const sheet = await context.newPage(); await sheet.goto(origin + '/multi-practice');
    const command = action => page.evaluate(action => chrome.runtime.sendMessage({type:'command',action}), action);
    t.after(async () => { delay = 0; await command('stop'); await sheet.close(); await exercise.bringToFront(); });
    // waitForFunction 的同步轮询不能拿 Promise 当条件，否则会在 busy 仍为 true 时提前结束。
    const finish = () => page.evaluate(async () => {
      let state;
      for (let i = 0; i < 400; i++) {
        state = (await chrome.storage.session.get('taskState')).taskState;
        if (state && !state.busy) return state;
        await new Promise(resolve => setTimeout(resolve, 25));
      }
      throw new Error(`Current-page task never completed: ${JSON.stringify(state)}`);
    });
    const callsBefore = received.length;
    const preview = await page.evaluate(() => chrome.runtime.sendMessage({type:'command',action:'start',fill:false,count:1}));
    assert.equal(preview.ok,true,preview.error);assert.equal(preview.data.busy,true);
    assert.equal((await finish()).phase,'ready');
    assert.equal(await sheet.locator('#q1 input[value=b]').isChecked(),false,'preview must never fill the page');
    assert.equal(received.slice(callsBefore).filter(entry=>entry.path==='/v1/chat/completions').length,1);
    const before = received.length;
    const started = await page.evaluate(() => chrome.runtime.sendMessage({type:'command',action:'start',count:1}));
    assert.equal(started.ok,true,started.error);assert.equal(started.data.busy,true);
    const state = await finish();
    assert.equal(state.phase,'filled',state.error);assert.equal(state.completed,6);
    for(const id of ['q1','q2','q3'])assert.equal(await sheet.locator(`#${id} input[value=b]`).isChecked(),true,id);
    assert.deepEqual(await sheet.locator('#q4 input:checked').evaluateAll(nodes=>nodes.map(node=>node.value)),['0','2']);
    assert.equal(await sheet.locator('#q5 input').inputValue(),'测试结果 42');assert.equal(await sheet.locator('#q6 textarea').inputValue(),'测试结果 42');
    assert.equal(await sheet.locator('.info input:checked').count(),0,'flag checkboxes must remain untouched');
    assert.equal(await sheet.locator('header input').inputValue(),'');
    assert.equal(await sheet.getAttribute('body','data-nav'),'0');assert.equal(await sheet.getAttribute('body','data-submit'),'0');
    const requests = received.slice(before).filter(entry=>entry.path==='/v1/chat/completions').map(entry=>JSON.parse(entry.body.messages[0].content.split('QUESTION_DATA:\n')[1]));
    assert.equal(requests.length,6);assert.equal(new Set(requests.map(question=>question.questionId)).size,6);
    assert.deepEqual(requests.map(question=>question.options.length),[2,2,2,3,0,0]);
    assert.ok(!JSON.stringify(requests).includes('清空我的选择'));
    assert.ok(!JSON.stringify(requests).includes('PRIVATE-HEADER'));assert.ok(!JSON.stringify(requests).includes('隐藏缓存题'));
    assert.equal(await page.locator('#task-summary').textContent(),'当前页 6 题');
    // 在模型返回前替换题干：旧答案不落地，也不把下一页或新题混入当前页队列。
    await sheet.reload();await sheet.bringToFront();delay=200;
    const changedBefore=received.length;
    assert.equal((await command('start')).ok,true);
    for(let i=0;i<100&&!received.slice(changedBefore).some(entry=>entry.path==='/v1/chat/completions');i++)await new Promise(resolve=>setTimeout(resolve,10));
    await sheet.locator('#q1 .qtext').evaluate(node=>node.textContent='题干已被手动替换');await finish();
    assert.equal((await page.evaluate(async()=>(await chrome.storage.session.get('taskState')).taskState)).phase,'error');
    assert.equal(await sheet.locator('#q1 input[value=b]').isChecked(),false);
    assert.equal(received.slice(changedBefore).filter(entry=>entry.path==='/v1/chat/completions').length,1);

  });
  // 实际等待超过 MV3 的空闲窗口，验证 offscreen 的活跃任务心跳与侧栏关闭后的回填。
  delay = 34000;
  await background.evaluate((id) => chrome.tabs.update(id, { active: true }), tabId);
  const started = await page.evaluate(() => chrome.runtime.sendMessage({ type: 'command', action: 'start' })); assert.equal(started.ok, true);
  await page.waitForTimeout(300); await page.close();
  await exercise.waitForFunction(() => document.querySelector('input[value=b]').checked, null, { timeout: 45000 });
  const taskState = await background.evaluate(async () => {
    for (let i = 0; i < 100; i++) {
      const state = (await chrome.storage.session.get('taskState')).taskState;
      if (!state.busy) return state;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    throw new Error('task never completed');
  });
  assert.equal(taskState.phase, 'filled'); assert.equal(JSON.stringify(taskState).includes('sk-browser-fixture'), false);
  assert.equal(await exercise.evaluate(() => document.documentElement.outerHTML.includes('sk-browser-fixture')), false);
  const reopened = await context.newPage(); reopened.setDefaultTimeout(10000); await reopened.goto(panelUrl); await reopened.locator('#open-settings').click();
  assert.equal(await reopened.locator('#connection-mode').inputValue(), 'api');
  await reopened.locator('#api-url').fill(origin + '/v1'); await reopened.locator('.api-advanced > summary').click(); await reopened.locator('#api-protocol').selectOption('responses');
  await reopened.locator('#api-test').click(); await reopened.waitForTimeout(100); await reopened.locator('#api-cancel').click();
  await reopened.waitForFunction(() => !document.getElementById('api-test').disabled); assert.match(await reopened.locator('#api-status').textContent(), /取消/);
  delay = 0; await reopened.locator('#api-test').click(); await reopened.waitForFunction(() => document.getElementById('api-status').textContent.includes('测试通过'));
  assert.ok(received.some((entry) => entry.path === '/v1/responses'));
  // 真实 MAIN-world 注入 + Worker/API：既覆盖短暂加载，也覆盖同一标签内编辑器临时只读与遮罩。
  const coding = await context.newPage(); coding.setDefaultTimeout(15000);
  for (const protocol of ['chat', 'responses']) {
    const codeMirror = protocol === 'responses';
    await coding.goto(origin + (codeMirror ? '/codemirror-practice' : '/code-practice')); await coding.bringToFront();
    await background.evaluate(async ({ protocol, baseUrl }) => {
      const { apiConfig } = await chrome.storage.local.get('apiConfig');
      await chrome.storage.local.set({ apiConfig: { ...apiConfig, baseUrl, protocol }, runAfterFill: true, count: 3 });
    }, { protocol, baseUrl: origin + '/v1' });
    const before = received.length;
    const result = await reopened.evaluate(() => chrome.runtime.sendMessage({ type: 'command', action: 'start' })); assert.equal(result.ok, true, result.error);
    await coding.waitForFunction(() => document.body.dataset.runs === '2');
    const state = await background.evaluate(async () => {
      for (let i = 0; i < 200; i++) {
        const state = (await chrome.storage.session.get('taskState')).taskState;
        if (state.phase === 'awaitingManual' || !state.busy) return state;
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      throw new Error('code repair never reached manual boundary');
    });
    assert.equal(state.phase, 'awaitingManual', state.error); assert.equal(state.error, ''); assert.equal(state.completed, 1);
    const calls = received.slice(before).map((entry) => ({ ...entry, question: JSON.parse((entry.body.messages?.[0].content || entry.body.input[0].content).split('QUESTION_DATA:\n')[1]) }));
    assert.equal(calls.length, 2); assert.equal(calls[0].question.executionFeedback, undefined);
    assert.equal(calls[1].question.executionFeedback.attempt, 1);
    assert.match(calls[1].question.executionFeedback.result, codeMirror ? /TS2737/ : /TS2802/);
    assert.match(calls[1].question.executionFeedback.code, codeMirror ? /1n \+ 1n/ : /for \(const n of values\)/);
    assert.equal(calls[1].question.language, codeMirror ? 'TypeScript' : 'ArkTS'); assert.equal(calls[1].question.starterCode, '// 请实现');
    assert.match(await coding.locator('textarea').inputValue(), codeMirror ? /console\.log\(1 \+ 1\)/ : /values\.forEach/);
    assert.equal(state.editor.kind, codeMirror ? 'CodeMirror 5' : 'textarea');
    if (codeMirror) assert.ok(state.log.some((entry) => entry.text.includes('原编辑区恢复')));
    assert.equal((await background.evaluate(() => chrome.tabs.query({ active: true, currentWindow: true })))[0].id, state.target.tabId);
    assert.equal(await coding.evaluate(() => Number(document.body.dataset.submits || 0)), 0); assert.equal(await coding.evaluate(() => Number(document.body.dataset.nexts || 0)), 0);
    assert.equal(await coding.evaluate(() => Boolean(globalThis.__nexlySampleRun)), false);
    assert.equal(JSON.stringify(state).includes('sk-browser-fixture'), false);
    assert.equal((await reopened.evaluate(() => chrome.runtime.sendMessage({ type: 'command', action: 'stop' }))).ok, true);
  }
  await coding.bringToFront();
  assert.equal((await reopened.evaluate(() => chrome.runtime.sendMessage({ type: 'command', action: 'fill' }))).ok, true);
  await coding.locator('textarea').fill('// 手动修改，请勿覆盖');
  const manualRun = await reopened.evaluate(() => chrome.runtime.sendMessage({ type: 'command', action: 'run' }));
  assert.equal(manualRun.ok, false); assert.match(manualRun.error, /编辑器内容已变化/);
  await reopened.waitForFunction(() => document.getElementById('task-status').textContent.includes('任务遇到问题'));
  assert.equal(await reopened.locator('#run').isEnabled(), true);
  assert.equal(await coding.locator('textarea').inputValue(), '// 手动修改，请勿覆盖');
  await coding.close();
  status = 401; await reopened.locator('#api-test').click(); await reopened.waitForFunction(() => document.getElementById('api-status').textContent.includes('API Key 无效'));
  assert.equal((await reopened.locator('#api-status').textContent()).includes('do-not-echo-private-key'), false);
  await reopened.locator('#clear-api-key').click(); await reopened.waitForFunction(() => document.getElementById('api-status').textContent.includes('已清除'));
  assert.equal(await background.evaluate(async () => Boolean((await chrome.storage.session.get('apiCredential')).apiCredential)), false);
  // 真正重启同一个临时 Chrome profile，验证密文保留而解锁会话消失。
  await reopened.locator('#api-key').fill('sk-cold-start'); await reopened.locator('#remember-api-key').check();
  await reopened.locator('#api-password').fill(passphrase); await reopened.locator('#api-password-confirm').fill(passphrase); await reopened.locator('#save-settings').click();
  await reopened.waitForFunction(() => document.getElementById('api-password').value === '' && !document.getElementById('save-settings').disabled);
  assert.ok(await background.evaluate(async () => (await chrome.storage.local.get('apiVault')).apiVault));
  await context.close(); context = await chromium.launchPersistentContext(join(temporary, 'profile'), options);
  background = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  const cold = await context.newPage(); cold.setDefaultTimeout(10000); cold.on('pageerror', (error) => errors.push(error.message));
  await cold.goto(panelUrl); await cold.locator('#open-settings').click(); await cold.locator('#unlock-api-key').waitFor({ state: 'visible' });
  assert.equal(await background.evaluate(async () => Boolean((await chrome.storage.session.get('apiCredential')).apiCredential)), false);
  for (const width of [320, 900]) {
    await cold.setViewportSize({ width, height: 900 }); assert.equal(await cold.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    if (process.env.NEXLY_SCREENSHOT_DIR) await cold.screenshot({ path: join(process.env.NEXLY_SCREENSHOT_DIR, `nexly-api-vault-${width}.png`), fullPage: true });
  }
  await cold.locator('#api-password').fill(passphrase); await cold.locator('#unlock-api-key').click();
  await cold.waitForFunction(() => document.getElementById('api-status').textContent.includes('密钥已解锁'));
  assert.equal(await background.evaluate(async () => (await chrome.storage.session.get('apiCredential')).apiCredential.key), 'sk-cold-start');
  await cold.locator('#clear-api-key').click(); await cold.waitForFunction(() => document.getElementById('api-status').textContent.includes('已清除'));
  assert.equal(await background.evaluate(async () => Boolean((await chrome.storage.local.get('apiVault')).apiVault)), false);
  assert.deepEqual(errors, []);
});

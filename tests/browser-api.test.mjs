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
    if (request.url === '/practice') {
      response.setHeader('Content-Type', 'text/html; charset=utf-8');
      response.end('<!doctype html><html lang="zh-CN"><title>练习</title><div data-nexly-question><h1>单选题：2 + 2 等于多少？</h1><label><input type="radio" name="answer" value="a">A. 3</label><label><input type="radio" name="answer" value="b">B. 4</label></div></html>'); return;
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
      : { questionId: question.questionId, type: question.type, choiceIds: ['option-1'], fills: [], code: '', explanation: '2 + 2 = 4。', confidence: 1 };
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

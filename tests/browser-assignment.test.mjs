import test from 'node:test';
import assert from 'node:assert/strict';
import { pageAction } from '../extension/lib/page.js';

const enabled = process.env.NEXLY_PAGE_BROWSER_TEST === '1' || process.env.NEXLY_BROWSER_TEST === '1';
test('assignment articles fill only the bound online editor and verify form data', { skip: !enabled, timeout: 60000 }, async (t) => {
  const { chromium } = await import(process.env.NEXLY_PLAYWRIGHT_PATH || 'playwright');
  const browser = await chromium.launch({ headless: true, ...(process.env.NEXLY_CHROME_PATH ? { executablePath: process.env.NEXLY_CHROME_PATH } : {}) });
  t.after(() => browser.close());
  const page = await browser.newPage();
  await page.route('https://moodle.example/**', route => route.fulfill({ contentType: 'text/html', body: '<html><body></body></html>' }));
  await page.goto('https://moodle.example/mod/assign/view.php?id=123&action=editsubmission');
  const action = (name, payload = {}) => page.evaluate(({ source, name, payload }) => (0, eval)(`(${source})`)(name, payload), { source: pageAction.toString(), name, payload: { allowBackground: true, ...payload } });
  async function fixture(kind = 'iframe', intro = '社会实践：请录入观后感。') {
    await page.setContent(`<main><div id="intro">${intro}</div><form><div id="fitem_id_onlinetext_editor" class="fitem"><textarea id="id_onlinetext_editor" name="onlinetext_editor[text]" ${kind === 'textarea' ? '' : 'aria-hidden="true" style="display:none"'}></textarea>${kind === 'contenteditable' ? '<div contenteditable="true" style="min-height:120px"></div>' : kind === 'textarea' ? '' : '<iframe id="id_onlinetext_editor_ifr" srcdoc="<body contenteditable=true><p><br></p></body>"></iframe>'}</div><button type="submit">保存草稿</button></form><textarea id="unrelated">其他输入</textarea></main>`);
    if (!['textarea', 'contenteditable'].includes(kind)) await page.waitForFunction(() => document.querySelector('iframe').contentDocument?.body?.isContentEditable);
    await page.evaluate(kind => {
      delete window.tinymce; delete window.tinyMCE;
      window.events = []; window.submits = 0;
      document.querySelector('form').onsubmit = event => { event.preventDefault(); window.submits++; };
      const source = document.querySelector('#id_onlinetext_editor');
      source.addEventListener('input', () => window.events.push('input'));
      source.addEventListener('change', () => window.events.push('change'));
      if (kind === 'tinymce') {
        const frame = document.querySelector('iframe'), body = frame.contentDocument.body;
        window.tinyMCE = { get: id => id === source.id ? {
          getBody: () => body, getContainer: () => frame, getContent: options => options?.format === 'text' ? body.innerText : body.innerHTML,
          setContent: html => { body.innerHTML = html; }, save: () => { source.value = body.innerHTML; },
          undoManager: { transact: fn => { window.events.push('undo'); fn(); } }, fire: name => window.events.push(name)
        } : null };
      }
    }, kind);
    return action('read');
  }
  const value = '标题：社会实践\n\n第一段 <script>alert(1)</script> & 引号"。\n第二段：保留中文与表情🌟。';
  const answer = question => ({ questionId: question.questionId, type: 'text', fills: [{ fieldId: 'assignment-draft', value }] });
  for (const kind of ['iframe', 'tinymce', 'contenteditable', 'textarea']) await t.test(kind, async () => {
    const read = await fixture(kind);
    assert.equal(read.ok, true, read.error); assert.equal(read.editor.assignmentWritable, true); assert.equal(read.editor.kind, kind);
    const result = await action('fillStep', { questionId: read.question.questionId, answer: answer(read.question) });
    assert.equal(result.ok, true, result.error); assert.equal(result.verified, true); assert.equal(result.done, true);
    const form = await page.evaluate(() => ({ value: new FormData(document.querySelector('form')).get('onlinetext_editor[text]'), submits, events, unrelated: document.querySelector('#unrelated').value }));
    assert.equal(form.submits, 0); assert.equal(form.unrelated, '其他输入'); assert.ok(form.events.includes('input')); assert.ok(form.events.includes('change'));
    if (kind === 'textarea') assert.equal(form.value, value);
    else { assert.match(form.value, /&lt;script&gt;/); assert.doesNotMatch(form.value, /<script>/); assert.match(form.value, /<p>第二段/); }
    if (kind === 'tinymce') assert.ok(form.events.includes('undo'));
    assert.equal((await action('fillStep', { questionId: read.question.questionId, answer: answer(read.question) })).ok, true, 'repeating the same fill is idempotent');
    const changed = answer(read.question); changed.fills[0].value = '试图覆盖原稿';
    assert.match((await action('fillStep', { questionId: read.question.questionId, answer: changed })).error, /已有内容/);
    assert.equal((await action('read')).question.questionId, read.question.questionId, 'editor content must not change assignment identity');
    for (const name of ['run', 'next']) assert.equal((await action(name, { questionId: read.question.questionId })).ok, false);
  });
  await t.test('Moodle field names and legacy designMode editors bind independently of source visibility', async () => {
    await fixture();
    await page.evaluate(() => {
      const source = document.querySelector('#id_onlinetext_editor'), frame = document.querySelector('iframe');
      source.id = 'custom_moodle_editor'; source.hidden = true;
      frame.id = `${source.id}_ifr`;
      frame.contentDocument.body.removeAttribute('contenteditable');
      frame.contentDocument.designMode = 'on';
    });
    let read = await action('read');
    assert.equal(read.editor.assignmentWritable, true, read.editor.error);
    assert.equal((await action('fillStep', { questionId: read.question.questionId, answer: answer(read.question) })).ok, true);
    await page.evaluate(() => document.querySelector('.fitem').setAttribute('aria-hidden', 'true'));
    read = await action('read');
    assert.equal(read.editor.assignmentWritable, false, 'a hidden editor container must still be rejected');
    assert.match(read.editor.error, /已找到在线文本字段/);
  });
  await t.test('the supplied fitem_id_onlinetext_editor container locates renamed backing fields and iframe/inline editors', async () => {
    for (const kind of ['iframe', 'contenteditable']) {
      await fixture(kind);
      await page.evaluate(() => {
        const field = document.querySelector('#fitem_id_onlinetext_editor');
        field.className = '';
        const source = field.querySelector('textarea'); source.id = 'legacy_submission'; source.name = 'submission[text]';
        const frame = field.querySelector('iframe'); if (frame) frame.id = 'legacy_article_frame';
      });
      const read = await action('read');
      assert.equal(read.editor.assignmentWritable, true, read.editor.error);
      assert.equal(read.editor.kind, kind);
      const result = await action('fillStep', { questionId: read.question.questionId, answer: answer(read.question) });
      assert.equal(result.ok, true, result.error);
      assert.match(await page.locator('#legacy_submission').inputValue(), /第二段/);
      assert.equal(await page.evaluate(() => submits), 0);
    }
  });
  await t.test('reject stale answers, disabled/hidden/ambiguous editors, instruction-only pages and changed readback', async () => {
    let read = await fixture();
    assert.equal((await action('fillStep', { questionId: 'stale', answer: answer(read.question) })).ok, false);
    await page.evaluate(() => document.querySelector('#id_onlinetext_editor').disabled = true);
    assert.equal((await action('read')).editor.assignmentWritable, false);
    read = await fixture('textarea');
    await page.evaluate(() => { const fieldset = document.createElement('fieldset'); fieldset.disabled = true; const source = document.querySelector('#id_onlinetext_editor'); source.replaceWith(fieldset); fieldset.append(source); });
    assert.equal((await action('read')).editor.assignmentWritable, false);
    read = await fixture();
    await page.evaluate(() => document.querySelector('iframe').hidden = true);
    assert.equal((await action('read')).editor.assignmentWritable, false);
    read = await fixture('textarea');
    await page.evaluate(() => { const source = document.createElement('textarea'); source.name = 'onlinetext'; document.querySelector('form').append(source); });
    assert.equal((await action('read')).editor.assignmentWritable, false);
    read = await fixture('iframe', '请写观后感。禁止复制粘贴。');
    assert.equal(read.editor.assignmentWritable, true, 'instruction text does not disable an available editor');
    assert.equal((await action('fillStep', { questionId: read.question.questionId, answer: answer(read.question) })).ok, true);
    read = await fixture('iframe', '大作业说明：答题要求。本课程共有三套题，请选择其中的一套试卷且只能选择一套。不能复制粘贴，字数不少于1000字。');
    assert.equal(read.question.assignment.promptReady, false); assert.equal(read.question.assignment.chooseOne, true);
    assert.equal(read.question.assignment.minimumCharacters, 1000); assert.equal(read.editor.assignmentWritable, false);
    assert.equal((await action('fillStep', { questionId: read.question.questionId, answer: answer(read.question) })).ok, false);
    read = await fixture();
    await page.evaluate(() => document.querySelector('iframe').contentDocument.body.innerHTML = '<p><img src="data:,"></p>');
    assert.match((await action('fillStep', { questionId: read.question.questionId, answer: answer(read.question) })).error, /已有内容/);
    read = await fixture();
    await page.evaluate(() => document.querySelector('#id_onlinetext_editor').addEventListener('change', event => { event.target.value = '被页面改写'; }));
    assert.match((await action('fillStep', { questionId: read.question.questionId, answer: answer(read.question) })).error, /回读不一致/);
    read = await fixture();
    await page.evaluate(() => document.querySelector('iframe').setAttribute('sandbox', ''));
    await page.evaluate(() => document.querySelector('iframe').srcdoc = '<body contenteditable=true>跨域隔离</body>');
    await page.waitForFunction(() => document.querySelector('iframe').contentDocument === null);
    assert.equal((await action('read')).editor.assignmentWritable, false);
  });
});

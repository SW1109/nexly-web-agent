import test from 'node:test';
import assert from 'node:assert/strict';
import { executeApi, API_TEST_QUESTION } from '../extension/lib/api-client.js';
import { single, correct, codeQuestion } from './data.mjs';
const config = { baseUrl: 'https://api.example.com/v1', model: 'custom-model', protocol: 'chat', timeoutSeconds: 10 };
const chat = (answer = correct, extra = {}) => ({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(answer) }, ...extra }] });
const responses = (answer = correct, extra = {}) => ({ status: 'completed', output: [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: JSON.stringify(answer) }] }], ...extra });
const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } });
function sse(events, { close = true, fragment = 1, onCancel = () => {} } = {}) {
  const bytes = new TextEncoder().encode(events.map((event) => `data: ${typeof event === 'string' ? event : JSON.stringify(event)}\r\n\r\n`).join(''));
  let index = 0;
  return new Response(new ReadableStream({ pull(controller) { if (index < bytes.length) { controller.enqueue(bytes.slice(index, index + fragment)); index += fragment; } else if (close) controller.close(); }, cancel: onCancel }), { headers: { 'content-type': 'text/event-stream; charset=utf-8' } });
}
test('API Chat JSON fallback sends only the requested prompt using safe fetch options and no retries', async () => {
  let calls = 0;
  const result = await executeApi('solve', config, 'sk-private', single, { fetchImpl: async (url, options) => {
    calls++; assert.equal(url, 'https://api.example.com/v1/chat/completions'); assert.equal(options.headers.Authorization, 'Bearer sk-private');
    assert.equal(options.redirect, 'error'); assert.equal(options.credentials, 'omit'); assert.equal(options.referrerPolicy, 'no-referrer');
    const body = JSON.parse(options.body); assert.equal(body.stream, true); assert.equal(body.model, config.model); assert.equal(body.messages.length, 1);
    assert.equal(options.body.includes('session=private'), false); assert.equal(options.body.includes('sk-private'), false);
    return json(chat());
  } });
  assert.deepEqual(result.answer, correct); assert.equal(calls, 1);
});
test('API streams accept fragmented UTF-8 and CRLF and close after Chat DONE without waiting for EOF', async () => {
  let canceled = false;
  const text = JSON.stringify(correct), chunks = [text.slice(0, 50), text.slice(50)];
  const result = await executeApi('solve', config, 'sk-private', single, { fetchImpl: async () => sse([
    ...chunks.map((content) => ({ choices: [{ index: 0, delta: { content }, finish_reason: null }] })),
    { choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] }, '[DONE]'
  ], { close: false, onCancel: () => { canceled = true; } }) });
  assert.deepEqual(result.answer, correct); assert.equal(canceled, true);
});
test('API Responses JSON and SSE require completed output and disable server-side storage', async () => {
  const raw = { ...config, protocol: 'auto', baseUrl: 'https://api.example.com/v1/responses' };
  assert.deepEqual((await executeApi('solve', raw, 'key', single, { fetchImpl: async (url, options) => {
    assert.ok(url.endsWith('/responses')); const body = JSON.parse(options.body); assert.equal(body.store, false); assert.equal(body.input[0].role, 'user'); return json(responses());
  } })).answer, correct);
  assert.deepEqual((await executeApi('solve', raw, 'key', single, { fetchImpl: async () => sse([
    { type: 'response.output_text.delta', delta: JSON.stringify(correct) }, { type: 'response.completed', response: responses() }
  ], { close: false, fragment: 7 }) })).answer, correct);
});
test('API model retrieval deduplicates model IDs, allows no model yet and uses the same origin', async () => {
  const result = await executeApi('models', { ...config, model: '' }, 'key', null, { fetchImpl: async (url, options) => {
    assert.equal(url, 'https://api.example.com/v1/models'); assert.equal(options.method, 'GET'); assert.equal(options.body, undefined);
    return json({ data: [{ id: 'z' }, { id: 'a' }, { id: 'z' }, { id: '' }, { id: 'bad\nmodel' }, null] });
  } });
  assert.deepEqual(result.models, ['a', 'z']);
  await assert.rejects(executeApi('models', config, 'key', null, { fetchImpl: async () => json({ data: [] }) }), /没有可用模型/);
  await assert.rejects(executeApi('models', config, 'key', null, { fetchImpl: async () => json({}, 404) }), /手动输入/);
});
test('API connection test uses a fixed synthetic question, never the current webpage', async () => {
  const tested = await executeApi('test', config, 'key', { secret: 'real-page-data' }, { fetchImpl: async (_url, options) => {
    assert.equal(options.body.includes('real-page-data'), false); assert.ok(options.body.includes(API_TEST_QUESTION.questionId));
    return json(chat({ ...correct, questionId: API_TEST_QUESTION.questionId }));
  } });
  assert.equal(tested.tested, true);
});
test('API HTTP and network failures never echo provider content, credentials or prompts and do not retry', async () => {
  for (const status of [401, 403, 404, 429, 500, 302]) {
    let calls = 0;
    await assert.rejects(executeApi('solve', config, 'sk-private', single, { fetchImpl: async () => { calls++; return json({ error: 'sk-private full-prompt' }, status); } }), (error) => {
      assert.ok(error.code.startsWith('API_')); assert.equal(/sk-private|full-prompt/.test(error.message), false); return true;
    });
    assert.equal(calls, 1);
  }
  await assert.rejects(executeApi('solve', config, 'key', single, { fetchImpl: async () => { throw new TypeError('secret url'); } }), (error) => error.code === 'API_NETWORK' && !error.message.includes('secret url'));
});
test('API never accepts truncated, refused, tool, wrong-question or malformed answers', async () => {
  for (const payload of [chat(correct, { finish_reason: 'length' }), chat({ ...correct, questionId: 'another' }), chat(correct, { message: { content: JSON.stringify(correct), tool_calls: [{}] } }), chat(correct, { message: { refusal: 'denied' } }), { choices: [] }, { output: [] }]) {
    await assert.rejects(executeApi('solve', config, 'key', single, { fetchImpl: async () => json(payload) }));
  }
  for (const payload of [responses(correct, { status: 'incomplete' }), responses(correct, { output: [{ type: 'function_call' }] }), responses(correct, { output: [{ type: 'message', role: 'assistant', content: [{ type: 'refusal' }] }] })]) {
    await assert.rejects(executeApi('solve', { ...config, protocol: 'responses' }, 'key', single, { fetchImpl: async () => json(payload) }));
  }
});
test('API interrupted streams and inconsistent Responses are not fillable', async () => {
  await assert.rejects(executeApi('solve', config, 'key', single, { fetchImpl: async () => sse([{ choices: [{ index: 0, delta: { content: JSON.stringify(correct) } }] }, '[DONE]']) }), /不完整/);
  await assert.rejects(executeApi('solve', config, 'key', single, { fetchImpl: async () => sse([{ choices: [{ index: 0, delta: { content: JSON.stringify(correct) }, finish_reason: 'stop' }] }]) }), /不完整/);
  await assert.rejects(executeApi('solve', { ...config, protocol: 'responses' }, 'key', single, { fetchImpl: async () => sse([{ type: 'response.output_text.delta', delta: 'different' }, { type: 'response.completed', response: responses() }]) }), /不一致/);
});
test('API abort immediately closes a stalled stream, and timeout has a distinct safe error', async (t) => {
  const controller = new AbortController(); let canceled = false;
  const response = new Response(new ReadableStream({ cancel() { canceled = true; } }), { headers: { 'content-type': 'text/event-stream' } });
  const pending = executeApi('solve', config, 'key', single, { signal: controller.signal, fetchImpl: async () => response });
  await Promise.resolve(); controller.abort();
  await assert.rejects(pending, (error) => error.code === 'API_CANCELLED'); assert.equal(canceled, true);
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const timeout = executeApi('solve', config, 'key', single, { fetchImpl: (_url, { signal }) => new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')))) });
  t.mock.timers.tick(10000);
  await assert.rejects(timeout, (error) => error.code === 'API_TIMEOUT');
});

test('API rejects oversized, invalid UTF-8 or malformed JSON bodies before producing an answer', async () => {
  for (const response of [new Response('x'.repeat(2 * 1024 * 1024 + 1)), new Response(new Uint8Array([0xff, 0xfe])), new Response('not JSON')]) {
    await assert.rejects(executeApi('solve', config, 'key', single, { fetchImpl: async () => response }), (error) => error.code === 'API_ERROR');
  }
});
test('API cancellation before execution never invokes fetch', async () => {
  const controller = new AbortController(); controller.abort(); let calls = 0;
  await assert.rejects(executeApi('solve', config, 'key', single, { signal: controller.signal, fetchImpl: async () => { calls++; return json(chat()); } }), (error) => error.code === 'API_CANCELLED');
  assert.equal(calls, 0);
});

test('domestic content-only reasoning prefixes are removed without weakening JSON answer validation', async () => {
  const result = await executeApi('solve', config, 'sk-private', single, { fetchImpl: async () => json({ choices: [{ finish_reason: 'stop', message: { content: '<think>not part of the answer</think>\n' + JSON.stringify(correct) } }] }) });
  assert.deepEqual(result.answer, correct); assert.ok(!JSON.stringify(result).includes('not part of the answer'));
  for (const content of ['<think>unfinished ' + JSON.stringify(correct), 'explanation ' + JSON.stringify(correct)]) {
    await assert.rejects(executeApi('solve', config, 'sk-private', single, { fetchImpl: async () => json({ choices: [{ finish_reason: 'stop', message: { content } }] }) }), /格式或题目一致性/);
  }
});


test('Chat Completions and Responses send the latest code failure through the shared repair contract', async () => {
  const executionFeedback = { attempt: 2, code: 'for (const n of values) {}', result: '编译错误\nsolution.ts(18,23): error TS2802: Set<number>' };
  const question = { ...codeQuestion, executionFeedback };
  const answer = { ...correct, questionId: question.questionId, type: 'code', choiceIds: [], code: 'values.forEach((n) => console.log(n));' };
  for (const protocol of ['chat', 'responses']) {
    const result = await executeApi('solve', { ...config, protocol }, 'sk-private', question, { fetchImpl: async (_url, init) => {
      const body = JSON.parse(init.body), prompt = body.messages?.[0].content || body.input?.[0].content;
      const data = JSON.parse(prompt.split('QUESTION_DATA:\n')[1]);
      assert.deepEqual(data.executionFeedback, executionFeedback);
      assert.equal(data.starterCode, codeQuestion.starterCode);
      assert.equal(data.language, 'ArkTS');
      assert.ok(!prompt.includes('sk-private'));
      return json(protocol === 'chat' ? chat(answer) : responses(answer));
    } });
    assert.deepEqual(result.answer, answer);
  }
});

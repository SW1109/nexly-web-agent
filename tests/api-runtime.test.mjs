import test from 'node:test';
import assert from 'node:assert/strict';
import { createApiRuntime } from '../extension/lib/api-runtime.js';
const event = () => { const listeners = []; return { addListener(fn) { listeners.push(fn); }, emit(...args) { listeners.forEach((fn) => fn(...args)); } }; };
const until = async (predicate) => { for (let i = 0; i < 100; i++) { if (predicate()) return; await new Promise((resolve) => setTimeout(resolve, 1)); } throw new Error('timeout'); };
function fixture() {
  const connect = event(), message = event(), disconnected = event(), sent = [], documents = [];
  const port = { name: 'nexly-api-runner', sender: { id: 'test', url: 'chrome-extension://test/api-runner.html' }, onMessage: message, onDisconnect: disconnected, postMessage: (data) => sent.push(data), disconnect() { disconnected.emit(); } };
  const api = { runtime: { id: 'test', getURL: (path) => `chrome-extension://test/${path}`, onConnect: connect, getContexts: async () => [] }, offscreen: { async createDocument(options) { documents.push(options); connect.emit(port); } } };
  return { runtime: createApiRuntime(api), connect, message, port, sent, documents };
}
const credentials = { config: { timeoutSeconds: 10 }, key: 'private' };
test('API runtime creates one Worker offscreen document concurrently and accepts only its trusted port', async () => {
  const f = fixture(), progress = [];
  const hostile = { ...f.port, sender: { ...f.port.sender, tab: { id: 1 } }, onMessage: event(), onDisconnect: event() };
  f.connect.emit(hostile);
  const first = f.runtime.request('test', credentials, null, (data) => progress.push(data)), second = f.runtime.request('models', credentials);
  await until(() => f.sent.length === 2);
  assert.equal(f.documents.length, 1); assert.deepEqual(f.documents[0].reasons, ['WORKERS']);
  f.message.emit({ type: 'progress', requestId: first.requestId, data: { elapsedSeconds: 20 } });
  f.message.emit({ type: 'result', requestId: first.requestId, data: { tested: true } });
  f.message.emit({ type: 'result', requestId: second.requestId, data: { models: ['a'] } });
  assert.deepEqual(await first.promise, { tested: true }); assert.deepEqual(await second.promise, { models: ['a'] }); assert.equal(progress[0].elapsedSeconds, 20);
});
test('API runtime cancel rejects immediately and ignores late answers without replay', async () => {
  const f = fixture(), request = f.runtime.request('solve', credentials);
  await until(() => f.sent.length);
  request.cancel(); request.cancel();
  await assert.rejects(request.promise, (error) => error.code === 'API_CANCELLED');
  f.message.emit({ type: 'result', requestId: request.requestId, data: { answer: 'late' } });
  assert.equal(f.sent.filter((entry) => entry.type === 'cancel').length, 1);
  const beforeStart = f.runtime.request('test', credentials); beforeStart.cancel(); await assert.rejects(beforeStart.promise, /取消/);
  await Promise.resolve(); assert.equal(f.sent.filter((entry) => entry.type === 'request').length, 1);
});
test('API runtime disconnect fails closed and task holds release exactly once', async () => {
  const f = fixture(), release = await f.runtime.hold();
  assert.equal(f.sent[0].type, 'hold'); release(); release(); assert.equal(f.sent.filter((entry) => entry.type === 'release').length, 1);
  const request = f.runtime.request('solve', credentials); await until(() => f.sent.some((entry) => entry.type === 'request'));
  f.port.disconnect(); await assert.rejects(request.promise, /未自动重试/);
  assert.equal(f.sent.filter((entry) => entry.type === 'request').length, 1);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { HOST_NAME, VERSION } from '../extension/lib/contracts.js';

const event = () => {
  const listeners = [];
  return { addListener(fn) { listeners.push(fn); }, emit(message) { for (const fn of listeners) fn(message); } };
};
const fakePort = () => ({
  onMessage: event(), onDisconnect: event(), sent: [], disconnects: 0, sendError: null,
  postMessage(message) { if (this.sendError) throw this.sendError; this.sent.push(message); },
  disconnect() { this.disconnects++; }
});
let fixtureId = 0;
async function fixture(t) {
  const previousChrome = globalThis.chrome, ports = [], attempts = [];
  const runtime = { connectError: null, connectNative(host) {
    attempts.push(host);
    if (this.connectError) { const error = this.connectError; this.connectError = null; throw error; }
    const connection = fakePort(); ports.push(connection); return connection;
  } };
  globalThis.chrome = { runtime };
  t.mock.timers.enable({ apis: ['setTimeout'] });
  t.after(() => { globalThis.chrome = previousChrome; });
  const transport = await import(`../extension/lib/native.js?native-transport-test=${++fixtureId}`);
  return { ...transport, ports, attempts, runtime };
}
const result = (port, request, data = { ok: true }) => port.onMessage.emit({ requestId: request.requestId, type: 'result', data });

test('native transport shares a connection, routes replies and clears settled timers', async (t) => {
  const f = await fixture(t), progress = [];
  const solve = f.nativeRequest('solve', { provider: 'codex' }, (data) => progress.push(data));
  const health = f.nativeRequest('health'), port = f.ports[0];
  assert.deepEqual(f.attempts, [HOST_NAME]);
  assert.equal(port.sent[0].version, VERSION); assert.equal(port.sent[0].provider, 'codex');
  port.onMessage.emit(null); port.onMessage.emit({ requestId: 'unknown', type: 'result', data: 'ignored' });
  port.onMessage.emit({ requestId: solve.requestId, type: 'progress', data: { elapsedSeconds: 4 } });
  result(port, health, { healthy: true }); result(port, solve, { answer: 'A' });
  assert.deepEqual(await health.promise, { healthy: true }); assert.deepEqual(await solve.promise, { answer: 'A' });
  assert.deepEqual(progress, [{ elapsedSeconds: 4 }]);
  t.mock.timers.tick(200000);
  assert.deepEqual(port.sent.map((entry) => entry.action), ['solve', 'health']);
});

test('native transport reconnects after a disconnect without replaying a solve', async (t) => {
  const f = await fixture(t);
  const solve = f.nativeRequest('solve'), health = f.nativeRequest('health'), old = f.ports[0];
  const solveFailed = assert.rejects(solve.promise, /本地 CLI 桥.*host exited/);
  const healthFailed = assert.rejects(health.promise, /本地 CLI 桥.*host exited/);
  f.runtime.lastError = { message: 'host exited' }; old.onDisconnect.emit(); delete f.runtime.lastError;
  await Promise.all([solveFailed, healthFailed]);
  const retry = f.nativeRequest('health'), next = f.ports[1];
  assert.equal(f.attempts.length, 2);
  old.onDisconnect.emit();
  result(next, retry, { healthy: true }); assert.deepEqual(await retry.promise, { healthy: true });
  assert.equal(f.ports.flatMap((port) => port.sent).filter((entry) => entry.action === 'solve').length, 1);
  t.mock.timers.tick(200000); assert.equal(old.sent.length, 2);
});

test('native transport retires a failed port and ignores its late messages and disconnect', async (t) => {
  const f = await fixture(t), progress = [];
  const solve = f.nativeRequest('solve'), old = f.ports[0];
  const solveFailed = assert.rejects(solve.promise, /disconnected port/);
  old.sendError = new Error('Attempting to use a disconnected port object');
  const failed = f.nativeRequest('health');
  await Promise.all([solveFailed, assert.rejects(failed.promise, /disconnected port/)]);
  assert.equal(old.disconnects, 1);
  const retry = f.nativeRequest('health', {}, (data) => progress.push(data)), next = f.ports[1];
  old.onMessage.emit({ requestId: retry.requestId, type: 'progress', data: 'stale' });
  old.onMessage.emit({ requestId: retry.requestId, type: 'result', data: 'stale' });
  old.onDisconnect.emit();
  result(next, retry, { healthy: true }); assert.deepEqual(await retry.promise, { healthy: true });
  assert.deepEqual(progress, []);
  const following = f.nativeRequest('health'); assert.equal(f.ports.length, 2);
  result(next, following); await following.promise;
  t.mock.timers.tick(200000);
  assert.equal(old.sent.filter((entry) => entry.action === 'solve').length, 1);
});

test('native transport can reconnect after connectNative throws synchronously', async (t) => {
  const f = await fixture(t);
  f.runtime.connectError = new Error('host unavailable');
  await assert.rejects(f.nativeRequest('health').promise, /本地 CLI 桥.*host unavailable/);
  const retry = f.nativeRequest('health'); result(f.ports[0], retry);
  assert.deepEqual(await retry.promise, { ok: true }); assert.equal(f.attempts.length, 2);
});

test('native solve timeout sends one cancel and ignores late progress and results', async (t) => {
  const f = await fixture(t), progress = [];
  const solve = f.nativeRequest('solve', {}, (data) => progress.push(data)), port = f.ports[0];
  const timedOut = assert.rejects(solve.promise, /本地桥响应超时/);
  t.mock.timers.tick(199999); assert.equal(port.sent.length, 1);
  t.mock.timers.tick(1); await timedOut;
  assert.equal(port.sent[1].action, 'cancel'); assert.equal(port.sent[1].version, VERSION);
  assert.equal(port.sent[1].targetId, solve.requestId); assert.notEqual(port.sent[1].requestId, solve.requestId);
  port.onMessage.emit({ requestId: solve.requestId, type: 'progress', data: 'late' }); result(port, solve);
  assert.deepEqual(progress, []);
  t.mock.timers.tick(200000); assert.equal(port.sent.length, 2);
  const health = f.nativeRequest('health'); result(port, health); await health.promise;
  assert.equal(f.ports.length, 1);
});

test('native timeout cancellation send failure does not escape the timer and reconnects health', async (t) => {
  const f = await fixture(t), solve = f.nativeRequest('solve'), old = f.ports[0];
  const timedOut = assert.rejects(solve.promise, /本地桥响应超时/);
  old.sendError = new Error('port closed while canceling');
  assert.doesNotThrow(() => t.mock.timers.tick(200000)); await timedOut;
  const health = f.nativeRequest('health'); result(f.ports[1], health); await health.promise;
  assert.equal(old.disconnects, 1); assert.equal(f.ports.length, 2);
  assert.equal(old.sent.filter((entry) => entry.action === 'solve').length, 1);
});

test('native cancellation settles the solve immediately and keeps the cancel acknowledgement protocol', async (t) => {
  const f = await fixture(t), progress = [];
  const solve = f.nativeRequest('solve', {}, (data) => progress.push(data)), port = f.ports[0];
  const stopped = assert.rejects(solve.promise, /任务已停止/);
  const canceled = f.cancelNative(solve.requestId); await stopped;
  const cancel = port.sent[1];
  assert.equal(cancel.action, 'cancel'); assert.equal(cancel.targetId, solve.requestId); assert.equal(cancel.version, VERSION);
  port.onMessage.emit({ requestId: solve.requestId, type: 'progress', data: 'late' }); result(port, solve, { answer: 'late' });
  assert.deepEqual(progress, []);
  result(port, cancel, { canceled: true }); assert.deepEqual(await canceled, { canceled: true });
  t.mock.timers.tick(200000); assert.equal(port.sent.length, 2);
});

test('native cancellation still stops the local solve when its message cannot be sent', async (t) => {
  const f = await fixture(t), solve = f.nativeRequest('solve'), old = f.ports[0];
  const stopped = assert.rejects(solve.promise, /任务已停止/);
  old.sendError = new Error('port closed');
  const canceled = f.cancelNative(solve.requestId);
  await Promise.all([stopped, assert.rejects(canceled, /port closed/)]);
  const health = f.nativeRequest('health'); result(f.ports[1], health); await health.promise;
  assert.equal(old.sent.length, 1); assert.equal(old.disconnects, 1);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { single, correct } from './data.mjs';
const event = () => { const listeners = []; return { addListener(fn) { listeners.push(fn); }, emit(...args) { listeners.forEach((fn) => fn(...args)); } }; };
const until = async (predicate) => { for (let i = 0; i < 500; i++) { if (predicate()) return; await new Promise((resolve) => setTimeout(resolve, 5)); } throw new Error('state transition timed out'); };
function storage(data) { return { async setAccessLevel() {}, async get(keys) { return Object.fromEntries((Array.isArray(keys) ? keys : [keys]).filter((key) => key in data).map((key) => [key, structuredClone(data[key])])); }, async set(patch) { Object.assign(data, structuredClone(patch)); }, async remove(keys) { for (const key of Array.isArray(keys) ? keys : [keys]) delete data[key]; } }; }
test('API background workflow stays independent of CLI, cancels stopped/replaced questions and never broadcasts the key', async (t) => {
  const commands = event(), connects = event(), messages = event(), disconnected = event(), requests = [], broadcasts = [], pageMessages = [];
  const local = { dataConsentVersion: 1, connectionMode: 'api', provider: 'codex', count: 1, pacing: { answerDelayMs: 0, actionIntervalMs: 0, typingIntervalMs: 0, typewriter: false }, apiConfig: { baseUrl: 'https://relay.example/v1', model: 'custom', timeoutSeconds: 180 }, rememberApiKey: false };
  const session = { apiCredential: { origin: 'https://relay.example', key: 'sk-private-key' } };
  let question = structuredClone(single), writes = 0, nativeCalls = 0;
  const port = { name: 'nexly-api-runner', sender: { id: 'test', url: 'chrome-extension://test/api-runner.html' }, onMessage: messages, onDisconnect: disconnected, postMessage: (data) => requests.push(data) };
  globalThis.chrome = {
    storage: { local: storage(local), session: storage(session), onChanged: event() },
    runtime: { id: 'test', getURL: (path) => `chrome-extension://test/${path}`, onMessage: commands, onConnect: connects, getContexts: async () => [], sendMessage: async (data) => broadcasts.push(data), connectNative() { nativeCalls++; throw new Error('CLI should not be touched'); } },
    offscreen: { createDocument: async () => connects.emit(port) }, permissions: { contains: async () => true },
    tabs: { query: async () => [{ id: 1, url: single.pageUrl }], get: async () => ({ active: true, windowId: 1 }), onActivated: event(), sendMessage: async (_id, data) => pageMessages.push(data) },
    windows: { get: async () => ({ focused: true }), onFocusChanged: event() },
    webNavigation: { getAllFrames: async () => [], onCompleted: event() }, commands: { onCommand: event() }, sidePanel: { setPanelBehavior: async () => {} },
    scripting: { async executeScript({ world, args }) {
      if (world === 'ISOLATED') return [{ documentId: 'doc', result: { ok: true } }];
      if (args[0] === 'read') return [{ frameId: 0, documentId: 'doc', result: { ok: true, question, editor: { supported: true }, run: { available: false } } }];
      if (args[0] === 'fillStep') { writes++; return [{ result: { ok: true, done: true, detail: '回读通过' } }]; }
      throw new Error(`unexpected ${args[0]}`);
    } }
  };
  await import('../extension/background.js');
  const command = (action, extra = {}) => new Promise((resolve) => commands.emit({ type: 'command', action, ...extra }, { id: 'test', url: 'chrome-extension://test/panel.html' }, resolve));
  t.after(async () => { await command('stop'); disconnected.emit(); });
  const solves = () => requests.filter((entry) => entry.type === 'request' && entry.action === 'solve');
  assert.equal((await command('health')).data.mode, 'api'); assert.equal(nativeCalls, 0);
  delete local.dataConsentVersion;
  const consentDenied = await command('start');
  assert.equal(consentDenied.ok, false); assert.match(consentDenied.error, /数据使用说明/);
  assert.equal(requests.length, 0); assert.equal(nativeCalls, 0);
  assert.equal((await command('acceptDataUse', { version: 99 })).ok, false);
  assert.equal((await command('acceptDataUse', { version: 1 })).ok, true);
  assert.doesNotThrow(() => commands.emit(null, {}, () => {}));

  assert.equal((await command('start')).ok, true); await until(() => solves().length === 1);
  const first = solves()[0]; assert.equal(first.key, 'sk-private-key');
  messages.emit({ type: 'result', requestId: first.requestId, data: { answer: correct } });
  await until(() => session.taskState?.phase === 'filled' && !session.taskState.busy);
  assert.equal(writes, 1); assert.equal(session.taskState.connectionMode, 'api');
  await command('start'); await until(() => solves().length === 2); const stopped = solves()[1];
  await command('stop'); assert.ok(requests.some((entry) => entry.type === 'cancel' && entry.requestId === stopped.requestId));
  messages.emit({ type: 'result', requestId: stopped.requestId, data: { answer: correct } });
  await new Promise((resolve) => setTimeout(resolve, 20)); assert.equal(writes, 1);
  await command('start'); await until(() => solves().length === 3); const replaced = solves()[2];
  question = { ...single, questionId: 'new-question' };
  const pageCommand = (action) => new Promise((resolve) => commands.emit({ type: 'command', source: 'page-controls', action }, { id: 'test', tab: { id: 1 }, frameId: 0, documentId: 'doc' }, resolve));
  await pageCommand('pageChanged'); await until(() => solves().length === 4);
  assert.ok(requests.some((entry) => entry.type === 'cancel' && entry.requestId === replaced.requestId));
  messages.emit({ type: 'result', requestId: replaced.requestId, data: { answer: correct } });
  const next = solves()[3]; assert.equal(next.question.questionId, 'new-question');
  messages.emit({ type: 'result', requestId: next.requestId, data: { answer: { ...correct, questionId: 'new-question' } } });
  await until(() => !session.taskState.busy); assert.equal(writes, 2);
  assert.equal(JSON.stringify({ state: session.taskState, broadcasts, pageMessages, local }).includes('sk-private-key'), false);
  assert.equal((await command('clearHistory')).ok, true);
  assert.equal(session.taskState.question, null); assert.equal(session.taskState.answer, null); assert.deepEqual(session.taskState.log, []);
  assert.equal(session.apiCredential.key, 'sk-private-key');
  assert.equal((await command('revokeDataUse')).ok, true);
  assert.equal((await command('start')).ok, false);
  assert.equal(solves().length, 4);

  assert.equal(nativeCalls, 0);
  await command('acceptDataUse', { version: 1 });
  chrome.permissions.contains = async () => false;
  const denied = await command('start'); assert.equal(denied.ok, false); assert.match(denied.error, /授权/); assert.equal(solves().length, 4);
  assert.equal(nativeCalls, 0);
  let replied = false;
  for (const action of ['apiSettings', 'unlockApiKey', 'lockApiKey', 'saveApiSettings', 'clearApiKey']) commands.emit({ type: 'command', source: 'page-controls', action, password: 'must-stay-private' }, { id: 'test', tab: { id: 1 }, frameId: 0, documentId: 'doc' }, () => { replied = true; });
  assert.equal(replied, false);
});

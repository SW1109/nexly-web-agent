import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { FrameDecoder, encodeFrame } from '../bridge/framing.mjs';
import { ROOT, extensionIdentity } from '../scripts/project.mjs';
import { join } from 'node:path';

test('native host rejects arbitrary actions and unsupported providers through the real binary protocol', async () => {
  const child = spawn(process.execPath, [join(ROOT, 'bridge/native-host.mjs')], { stdio: ['pipe', 'pipe', 'pipe'] });
  const received = [];
  const finished = new Promise((resolve, reject) => {
    const timeout = setTimeout(() => { child.kill(); reject(new Error('host did not close')); }, 5000);
    const decoder = new FrameDecoder((message) => received.push(message), reject);
    child.stdout.on('data', (chunk) => decoder.push(chunk));
    child.on('error', reject);
    child.on('close', () => { clearTimeout(timeout); decoder.finish(); resolve(); });
  });
  child.stdin.end(Buffer.concat([
    encodeFrame({ version: 1, requestId: 'one', action: 'exec', command: 'some-shell-command' }),
    encodeFrame({ version: 1, requestId: 'two', action: 'solve', provider: 'arbitrary-executable' }),
    encodeFrame({ version: 99, requestId: 'three', action: 'health' })
  ]));
  await finished;
  assert.equal(received.length, 3);
  assert.ok(received.every((message) => message.type === 'error'));
  assert.deepEqual(received.map((message) => message.requestId), ['one', 'two', 'three']);
});
test('manifest key produces a stable native-host origin', async () => {
  const a = await extensionIdentity(), b = await extensionIdentity();
  assert.equal(a.id, b.id); assert.match(a.id, /^[a-p]{32}$/);
  assert.ok(!a.manifest.permissions.includes('debugger'));
  assert.ok(!a.manifest.permissions.includes('cookies'));
  assert.equal(a.manifest.externally_connectable, undefined);
});

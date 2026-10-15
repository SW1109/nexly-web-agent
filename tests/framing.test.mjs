import test from 'node:test';
import assert from 'node:assert/strict';
import { FrameDecoder, encodeFrame } from '../bridge/framing.mjs';

test('decodes arbitrarily fragmented UTF-8 native messages', () => {
  const expected = [{ text: '中文🧩', id: 1 }, { id: 2, value: false }];
  const stream = Buffer.concat(expected.map((item) => encodeFrame(item)));
  for (const size of [1, 2, 3, 5, 11, 4096]) {
    const actual = [], errors = [];
    const decoder = new FrameDecoder((message) => actual.push(message), (error) => errors.push(error));
    for (let offset = 0; offset < stream.length; offset += size) decoder.push(stream.subarray(offset, offset + size));
    decoder.finish(); assert.deepEqual(actual, expected); assert.equal(errors.length, 0);
  }
});
test('rejects oversized frame immediately and never accepts later data', () => {
  const errors = [], messages = [], decoder = new FrameDecoder((x) => messages.push(x), (x) => errors.push(x), 10);
  const header = Buffer.alloc(4); header.writeUInt32LE(10000000);
  decoder.push(header); decoder.push(encodeFrame({ a: 1 }));
  assert.equal(errors.length, 1); assert.equal(messages.length, 0);
});
test('rejects empty, truncated or malformed JSON messages', () => {
  for (const bytes of [Buffer.alloc(4), encodeFrame({ a: 1 }).subarray(0, 7), Buffer.from([1, 0, 0, 0, 120])]) {
    const errors = [], decoder = new FrameDecoder(() => assert.fail('must not decode'), (error) => errors.push(error));
    decoder.push(bytes); decoder.finish(); assert.equal(errors.length, 1);
  }
});
test('outbound messages enforce their own byte limit', () => {
  assert.throws(() => encodeFrame({ text: '智'.repeat(20) }, 30));
});

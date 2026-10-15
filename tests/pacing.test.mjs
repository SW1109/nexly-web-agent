import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_PACING, PACING_FIELDS, validatePacing } from '../extension/lib/pacing.js';

test('pacing defaults are shared, bounded and do not mutate saved settings', () => {
  assert.deepEqual(validatePacing(), { answerDelayMs: 1500, actionIntervalMs: 800, typingIntervalMs: 40, typewriter: true });
  const saved = { answerDelayMs: 0, typewriter: false };
  assert.deepEqual(validatePacing(saved), { ...DEFAULT_PACING, ...saved });
  assert.deepEqual(saved, { answerDelayMs: 0, typewriter: false });
});
test('pacing accepts both boundaries, including zero and explicit false', () => {
  for (const [key, field] of Object.entries(PACING_FIELDS)) {
    assert.equal(validatePacing({ [key]: field.min })[key], field.min);
    assert.equal(validatePacing({ [key]: field.max })[key], field.max);
  }
  assert.equal(validatePacing({ typewriter: false }).typewriter, false);
});
test('pacing rejects missing types, fractions, nonfinite values and unknown actions', () => {
  for (const [key, field] of Object.entries(PACING_FIELDS)) {
    for (const value of [-1, field.max + 1, 0.5, NaN, Infinity, '800', null]) assert.throws(() => validatePacing({ [key]: value }));
  }
  for (const value of [null, [], false, 'settings']) assert.throws(() => validatePacing(value));
  for (const value of ['false', 0, null]) assert.throws(() => validatePacing({ typewriter: value }));
  assert.throws(() => validatePacing({ execute: 'some command' }));
});

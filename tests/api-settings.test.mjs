import test from 'node:test';
import assert from 'node:assert/strict';
import { apiSettings, apiCredentials, saveApiSettings, clearApiKey, lockApiKey, unlockApiKey } from '../extension/lib/api-settings.js';
import { encryptApiKey, decryptApiKey, validateVaultPassword } from '../extension/lib/api-vault.js';
const raw = { baseUrl: 'https://api.example.com/v1', model: 'model', protocol: 'auto', timeoutSeconds: 180 };
const password = 'a private passphrase 123';
function area() {
  const data = {}, levels = [];
  return { data, levels, fail: false, async setAccessLevel(level) { levels.push(level); }, async get(keys) { return Object.fromEntries((Array.isArray(keys) ? keys : [keys]).filter((key) => key in data).map((key) => [key, structuredClone(data[key])])); }, async set(patch) { if (this.fail) { this.fail = false; throw new Error('storage failed'); } Object.assign(data, structuredClone(patch)); }, async remove(keys) { for (const key of Array.isArray(keys) ? keys : [keys]) delete data[key]; } };
}
const local = area(), session = area();
function reset() { for (const data of [local.data, session.data]) for (const key of Object.keys(data)) delete data[key]; globalThis.chrome = { storage: { local, session } }; }
test('API key storage is isolated, origin-bound and session-only by default', async () => {
  reset();
  assert.equal((await apiSettings()).hasKey, false);
  await saveApiSettings(raw, { key: 'sk-private' });
  assert.deepEqual(local.levels, [{ accessLevel: 'TRUSTED_CONTEXTS' }]); assert.deepEqual(session.levels, local.levels);
  assert.equal(local.data.apiCredential, undefined); assert.equal(session.data.apiCredential.key, 'sk-private');
  assert.equal((await apiCredentials(raw)).key, 'sk-private');
  assert.equal(JSON.stringify(await apiSettings()).includes('sk-private'), false);
  await assert.rejects(apiCredentials({ ...raw, baseUrl: 'https://another.example/v1' }), /API Key/);
  await assert.rejects(saveApiSettings(raw, { rememberKey: true }), /口令/);
  assert.equal((await apiCredentials(raw)).key, 'sk-private');
  local.fail = true;
  await assert.rejects(saveApiSettings({ ...raw, model: 'new-model' }, { key: 'sk-new' }), /已保留原配置/);
  assert.equal((await apiCredentials(raw)).key, 'sk-private'); assert.equal((await apiSettings()).config.model, 'model');
  await assert.rejects(saveApiSettings(raw, { key: ' invalid ' }));
  assert.equal((await apiCredentials(raw)).key, 'sk-private');
  await clearApiKey(); assert.equal(session.data.apiCredential, undefined); assert.equal((await apiSettings()).hasKey, false);
  assert.equal((await apiSettings()).config.model, 'model');
});
test('persistent vault encrypts, locks, survives a new session, unlocks and clears without revealing secrets', async () => {
  reset();
  await saveApiSettings(raw, { key: 'sk-vault-private', rememberKey: true, password });
  assert.ok(local.data.apiVault); assert.equal(local.data.apiCredential, undefined);
  for (const secret of ['sk-vault-private', password]) assert.ok(!JSON.stringify(local.data).includes(secret));
  assert.equal((await apiSettings()).hasVault, true);
  assert.equal((await apiSettings()).locked, false);
  const ciphertext = structuredClone(local.data.apiVault);
  await saveApiSettings({ ...raw, model: 'another' }, { rememberKey: true });
  assert.deepEqual(local.data.apiVault, ciphertext, 'unlocked settings changes reuse the existing vault');
  await lockApiKey();
  assert.equal((await apiSettings()).locked, true); assert.equal(session.data.apiCredential, undefined);
  await assert.rejects(apiCredentials(raw), /锁定/);
  await assert.rejects(unlockApiKey('wrong password 123'), /解锁失败/);
  assert.equal((await apiSettings()).locked, true);
  await unlockApiKey(password);
  assert.equal((await apiCredentials(raw)).key, 'sk-vault-private');
  delete session.data.apiCredential;
  assert.equal((await apiSettings()).locked, true, 'new browser session remains locked');
  await unlockApiKey(password);
  const metadata = JSON.stringify(await apiSettings());
  for (const secret of ['sk-vault-private', password, ciphertext.ciphertext]) assert.ok(!metadata.includes(secret));
  await assert.rejects(saveApiSettings(raw, { key: 'sk-new', rememberKey: true }), /口令/);
  await saveApiSettings(raw, { rememberKey: false });
  assert.equal(local.data.apiVault, undefined); assert.equal((await apiCredentials(raw)).key, 'sk-vault-private');
  await clearApiKey(); assert.equal((await apiSettings()).hasVault, false);
});
test('vault uses fresh salt/IV, authenticates origin/ciphertext and rejects invalid KDF parameters', async () => {
  const first = await encryptApiKey('https://api.example.com', 'sk-private', password);
  const second = await encryptApiKey('https://api.example.com', 'sk-private', password);
  assert.notEqual(first.salt, second.salt); assert.notEqual(first.iv, second.iv); assert.notEqual(first.ciphertext, second.ciphertext);
  assert.equal(await decryptApiKey(first, password), 'sk-private');
  for (const patch of [{ origin: 'https://evil.example' }, { iterations: 1 }, { version: 99 }, { iv: 'a' }, { ciphertext: second.ciphertext }]) await assert.rejects(decryptApiKey({ ...first, ...patch }, password), /解锁失败/);
  for (const value of ['', 'short', ' '.repeat(12), 'x'.repeat(257)]) assert.throws(() => validateVaultPassword(value), /口令/);
  assert.equal(validateVaultPassword(' '.repeat(2) + password + ' '), ' '.repeat(2) + password + ' ');
});
test('old plaintext is moved to the session before removal, never silently encrypted or lost', async () => {
  reset();
  Object.assign(local.data, { apiConfig: raw, rememberApiKey: true, apiCredential: { origin: 'https://api.example.com', key: 'sk-legacy' } });
  session.fail = true;
  await assert.rejects(apiSettings(), /迁移失败/); assert.equal(local.data.apiCredential.key, 'sk-legacy');
  const metadata = await apiSettings();
  assert.equal(metadata.legacyMigrated, true); assert.equal(metadata.rememberKey, false); assert.equal(metadata.hasKey, true);
  assert.equal(local.data.apiCredential, undefined); assert.equal((await apiCredentials(raw)).key, 'sk-legacy');
  await saveApiSettings(raw, { rememberKey: true, password });
  assert.ok(local.data.apiVault); assert.ok(!JSON.stringify(local.data).includes('sk-legacy'));
  await clearApiKey(); assert.equal((await apiSettings()).legacyMigrated, false);
});
test('concurrent vault saves serialize and failed encrypted saves preserve the last usable credential', async () => {
  reset();
  await Promise.all([saveApiSettings(raw, { key: 'sk-first', rememberKey: true, password }), saveApiSettings(raw, { key: 'sk-second', rememberKey: true, password })]);
  assert.equal((await apiCredentials(raw)).key, 'sk-second');
  local.fail = true;
  await assert.rejects(saveApiSettings(raw, { key: 'sk-third', rememberKey: true, password }), /已保留原配置/);
  await lockApiKey(); await unlockApiKey(password);
  assert.equal((await apiCredentials(raw)).key, 'sk-second');
});

test('plaintext migration keeps the key for the saved origin rather than a stale session for another service', async () => {
  reset();
  Object.assign(local.data, { apiConfig: raw, apiCredential: { origin: 'https://api.example.com', key: 'sk-active' } });
  session.data.apiCredential = { origin: 'https://old.example', key: 'sk-stale' };
  assert.equal((await apiSettings()).hasKey, true);
  assert.equal((await apiCredentials(raw)).key, 'sk-active'); assert.equal(local.data.apiCredential, undefined);
});

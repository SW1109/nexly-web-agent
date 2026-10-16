import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { inflateRawSync } from 'node:zlib';
import { crc32, zipDirectory } from '../scripts/zip.mjs';
test('extension ZIP is deterministic, UTF-8 and preserves root manifest and exact file bytes', async (t) => {
  assert.equal(crc32(Buffer.from('123456789')), 0xcbf43926);
  const dir = await mkdtemp(join(tmpdir(), 'nexly-zip-')); t.after(() => rm(dir, { recursive: true, force: true }));
  await mkdir(join(dir, 'lib')); await writeFile(join(dir, 'manifest.json'), '{"version":"0.4.0"}'); await writeFile(join(dir, 'lib/中文.js'), 'export const name = "Nexly";');
  const zip = await zipDirectory(dir); assert.deepEqual(zip, await zipDirectory(dir));
  const entries = new Map(); let offset = 0;
  while (zip.readUInt32LE(offset) === 0x04034b50) {
    assert.equal(zip.readUInt16LE(offset + 6), 0x0800);
    const compressed = zip.readUInt32LE(offset + 18), length = zip.readUInt16LE(offset + 26), name = zip.subarray(offset + 30, offset + 30 + length).toString('utf8');
    const data = inflateRawSync(zip.subarray(offset + 30 + length, offset + 30 + length + compressed));
    assert.equal(crc32(data), zip.readUInt32LE(offset + 14)); entries.set(name, data.toString()); offset += 30 + length + compressed;
  }
  assert.equal(entries.get('manifest.json'), '{"version":"0.4.0"}'); assert.equal(entries.get('lib/中文.js'), 'export const name = "Nexly";');
  assert.equal(zip.readUInt16LE(zip.length - 12), 2); assert.equal(zip.readUInt32LE(zip.length - 6), offset);
});

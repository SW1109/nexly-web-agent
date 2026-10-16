import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { deflateRawSync } from 'node:zlib';
// ZIP32 + UTF-8 的最小写入器，构建无需额外安装 zip/PowerShell/npm 依赖。
const crcTable = Array.from({ length: 256 }, (_, value) => {
  for (let bit = 0; bit < 8; bit++) value = value & 1 ? (value >>> 1) ^ 0xedb88320 : value >>> 1;
  return value >>> 0;
});
export function crc32(bytes) {
  let value = 0xffffffff;
  for (const byte of bytes) value = (value >>> 8) ^ crcTable[(value ^ byte) & 255];
  return (value ^ 0xffffffff) >>> 0;
}
export async function zipDirectory(directory) {
  const localRecords = [], centralRecords = [];
  let offset = 0, count = 0;
  async function visit(relative = '') {
    const entries = await readdir(join(directory, relative), { withFileTypes: true });
    for (const entry of entries.sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0)) {
      const name = relative ? `${relative}/${entry.name}` : entry.name;
      if (entry.isDirectory()) { await visit(name); continue; }
      if (!entry.isFile()) throw new Error('扩展打包不接受符号链接或特殊文件');
      const path = Buffer.from(name, 'utf8'), data = await readFile(join(directory, name)), compressed = deflateRawSync(data), checksum = crc32(data);
      if (data.length > 0xffffffff || compressed.length > 0xffffffff || offset > 0xffffffff || path.length > 0xffff || count >= 0xffff) throw new Error('扩展超出 ZIP32 格式范围');
      const local = Buffer.alloc(30), central = Buffer.alloc(46);
      local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(0x0800, 6); local.writeUInt16LE(8, 8);
      // 固定 1980-01-01 时间戳，相同源码在不同系统上生成相同字节。
      local.writeUInt16LE(33, 12); local.writeUInt32LE(checksum, 14); local.writeUInt32LE(compressed.length, 18); local.writeUInt32LE(data.length, 22); local.writeUInt16LE(path.length, 26);
      central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(20, 4); local.copy(central, 6, 4, 28); central.writeUInt32LE(offset, 42);
      localRecords.push(local, path, compressed); centralRecords.push(central, path); offset += local.length + path.length + compressed.length; count++;
    }
  }
  await visit();
  const central = Buffer.concat(centralRecords), end = Buffer.alloc(22);
  if (offset + central.length > 0xffffffff) throw new Error('扩展超出 ZIP32 格式范围');
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(count, 8); end.writeUInt16LE(count, 10); end.writeUInt32LE(central.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...localRecords, central, end]);
}

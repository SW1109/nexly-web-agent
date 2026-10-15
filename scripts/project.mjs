import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export async function extensionIdentity() {
  const manifest = JSON.parse(await readFile(join(ROOT, 'extension/manifest.json'), 'utf8'));
  const hash = createHash('sha256').update(Buffer.from(manifest.key, 'base64')).digest('hex').slice(0, 32);
  return { id: hash.replace(/[0-9a-f]/g, (char) => String.fromCharCode(97 + parseInt(char, 16))), manifest };
}
export function requireModernNode() { if (Number(process.versions.node.split('.')[0]) < 22) throw new Error('请使用 Node.js 22 或更高版本。Windows 可安装新版后运行 node scripts/setup.mjs；macOS / Linux 可运行 bash scripts/setup.sh 寻找已安装的新版本。'); }

import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { ROOT, requireModernNode } from './project.mjs';
requireModernNode();
let count = 0;
async function check(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (['dist', '.git', '.local', 'node_modules'].includes(entry.name)) continue;
    const file = join(dir, entry.name);
    if (entry.isDirectory()) await check(file);
    else if (/\.(m?js)$/.test(entry.name)) { const result = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' }); if (result.status !== 0) throw new Error(result.stderr); count++; }
  }
}
await check(ROOT);
const manifest = JSON.parse(await readFile(join(ROOT, 'extension/manifest.json'), 'utf8'));
for (const file of [manifest.background.service_worker, manifest.side_panel.default_path, ...Object.values(manifest.icons)]) await readFile(join(ROOT, 'extension', file));
if (manifest.manifest_version !== 3 || manifest.externally_connectable || !manifest.key) throw new Error('扩展清单不符合项目约定');
console.log(`${count} 个 JavaScript 文件语法检查通过；Manifest 引用文件完整。`);

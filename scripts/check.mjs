import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { ROOT, requireModernNode } from './project.mjs';
import { COURSE_ORIGINS } from '../extension/lib/course-platforms.js';
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
for (const file of [manifest.background.service_worker, manifest.side_panel.default_path, ...Object.values(manifest.icons), 'api-runner.html', 'api-runner.js', 'lib/api-worker.js', 'help.html', 'help.js', 'help.css', 'native-setup.html', 'native-setup.js', 'native-setup.css', 'third-party.html']) await readFile(join(ROOT, 'extension', file));
const project = JSON.parse(await readFile(join(ROOT, 'package.json'), 'utf8'));
const lock = JSON.parse(await readFile(join(ROOT, 'package-lock.json'), 'utf8'));
if (manifest.version !== project.version || lock.version !== project.version || lock.packages[''].version !== project.version) throw new Error('扩展、项目与锁文件版本不一致');
if (JSON.stringify(manifest.host_permissions) !== JSON.stringify(COURSE_ORIGINS) || manifest.permissions.includes('debugger') || manifest.permissions.includes('cookies')) throw new Error('预置权限仅限已接入课程平台，不允许全网、调试器或 Cookie 权限');
if (manifest.manifest_version !== 3 || manifest.externally_connectable || !manifest.key) throw new Error('扩展清单不符合项目约定');
// 同时检查离线帮助与面板的本地资源引用，避免只在构建后发现丢图或缺脚本。
for (const html of ['panel.html', 'help.html', 'api-runner.html', 'native-setup.html', 'third-party.html']) {
  const text = await readFile(join(ROOT, 'extension', html), 'utf8');
  for (const [, resource] of text.matchAll(/(?:src|href)=["']([^"']+)["']/g)) {
    if (/^(?:https?:|#)/.test(resource)) continue;
    if (resource.startsWith('/') || resource.includes('..')) throw new Error('扩展资源引用不能越过扩展目录');
    await readFile(join(ROOT, 'extension', resource.split(/[?#]/)[0]));
  }
}
console.log(`${count} 个 JavaScript 文件语法检查通过；Manifest 引用文件完整。`);

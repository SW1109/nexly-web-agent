import { cp, mkdir, readFile, writeFile, rm, stat } from 'node:fs/promises';
import { join, relative, extname } from 'node:path';
import { createHash } from 'node:crypto';
import { zipDirectory } from './zip.mjs';
import { ROOT, extensionIdentity, requireModernNode } from './project.mjs';
requireModernNode();
const args = process.argv.slice(2);
if (args.some((arg) => arg !== '--edge') || args.length > 1) throw new Error('构建只支持 --edge 参数');
const edge = args.includes('--edge');
const { id } = await extensionIdentity();
const target = join(ROOT, edge ? 'dist/edge/extension' : 'dist/extension');
const source = join(ROOT, 'extension');
await rm(target, { recursive: true, force: true });
await mkdir(target, { recursive: true });
// 仅收录扩展运行资源；本机缓存、测试、凭据与源码外的资料不会进入安装包。
await cp(source, target, { recursive: true, dereference: false, filter(file) {
  const path = relative(source, file).replaceAll('\\', '/');
  if (!path) return true;
  if (path.split('/').some((part) => part.startsWith('.') || ['node_modules', 'tests', 'test-results', 'coverage'].includes(part))) return false;
  return !extname(path) || ['.json', '.js', '.html', '.css', '.png', '.jpg', '.jpeg', '.svg'].includes(extname(path));
} });
const manifest = JSON.parse(await readFile(join(target, 'manifest.json'), 'utf8'));
const project = JSON.parse(await readFile(join(ROOT, 'package.json'), 'utf8'));
if (manifest.version !== project.version) throw new Error('版本号不一致');
if (edge) { delete manifest.key; delete manifest.update_url; }
await writeFile(join(target, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
let supportImage = '';
for (const candidate of ['assets/wechat-support.png', 'assets/wechat-support.jpg']) {
  try { if ((await stat(join(source, candidate))).isFile()) { supportImage = candidate; break; } }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
}
const projectInfo = join(target, 'lib/project-info.js');
await writeFile(projectInfo, (await readFile(projectInfo, 'utf8')).replace(/export const SUPPORT_IMAGE = '[^']*';/, `export const SUPPORT_IMAGE = '${supportImage}';`));
const zip = join(ROOT, 'dist', `quizmate-${edge ? 'edge' : 'development'}-v${manifest.version}.zip`);
const bytes = await zipDirectory(target);
await writeFile(zip, bytes);
const digest = createHash('sha256').update(bytes).digest('hex');
await writeFile(zip + '.sha256', `${digest}  ${zip.split(/[\\/]/).pop()}\n`);
if (!edge) await writeFile(join(ROOT, 'dist/extension-id.txt'), id + '\n');
console.log(`已生成${edge ? ' Edge 商店上传包' : '开发安装包'}：${zip}\n目录：${target}\nSHA-256：${digest}`);
console.log(edge ? '商店包不含开发 key；商店分配的 ID 以控制台为准。本地 CLI 用户需按真实 ID 安装 Edge 本地桥。尚未上传或通过审核。' : `开发扩展 ID：${id}\n在 chrome://extensions 或 edge://extensions 中加载上述目录。`);
if (!supportImage) console.log('未提供微信收款码：赞助区保留说明，不显示虚假二维码。');

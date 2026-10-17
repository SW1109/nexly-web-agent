export function detectNativeBrowser({ userAgent = '', brands = [] } = {}) {
  if (/Edg(?:e|A|iOS)?\//i.test(userAgent) || brands.some(({ brand }) => /Microsoft Edge/i.test(brand))) return 'edge';
  if (/Chrom(?:e|ium)\//i.test(userAgent) || brands.some(({ brand }) => /Chrom(?:e|ium)/i.test(brand))) return 'chrome';
  return null;
}

export function nativeSetupOptions(extensionId, browser) {
  if (!/^[a-p]{32}$/.test(extensionId)) throw new Error('无法读取当前扩展 ID，请从浏览器工具栏重新打开本扩展。');
  if (!['chrome', 'edge'].includes(browser)) throw new Error('请选择 Chrome 或 Edge。');
  return {
    extensionId, browser,
    command: `node scripts/install-native.mjs --browser ${browser} --extension-id ${extensionId}`,
    scriptName: `quizmate-bridge-setup-${browser}.mjs`
  };
}

export function nativeConnectionAdvice(message) {
  if (/forbidden|allowed_origins/i.test(message)) return '本地桥尚未授权当前扩展 ID。请运行下方的安装或修复命令，再重新检测。';
  if (/not found|not registered|host name is not registered/i.test(message)) return '当前浏览器尚未找到本地桥。请先安装本地桥，再重新检测。';
  if (/exited|failed to start|启动|退出/i.test(message)) return '本地桥未能正常启动。请确认 Node.js 22+ 可用、项目目录未移动，再运行修复命令。';
  return '本地桥暂不可用。请按下方步骤安装或修复；如果仍失败，可带上检测详情反馈。';
}

// Downloaded as readable local code. It only invokes this project's installer;
// it neither downloads code nor reads CLI credentials or invokes a model.
export function nativeRepairScript(extensionId, browser) {
  const options = nativeSetupOptions(extensionId, browser);
  return `// QuizMate local bridge repair. Requires Node.js 22+.
// Browser: ${options.browser}; extension ID: ${options.extensionId}
import { readFile, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

if (Number(process.versions.node.split('.')[0]) < 22) {
  console.error('请先安装 Node.js 22 或更高版本。');
  process.exit(1);
}
const browser = ${JSON.stringify(options.browser)};
const extensionId = ${JSON.stringify(options.extensionId)};
const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const folders = args.filter(arg => arg !== '--dry-run');
if (folders.length > 1 || folders.some(arg => arg.startsWith('--'))) {
  console.error('用法：node ${options.scriptName} [项目目录] [--dry-run]');
  process.exit(1);
}
const candidates = folders.length ? [resolve(folders[0])] : [];
if (!folders.length) {
  const ownRoot = join(homedir(), '.nexly-web-agent');
  const receipts = browser === 'edge' ? ['installation-edge.json', 'installation.json'] : ['installation.json', 'installation-edge.json'];
  for (const name of receipts) {
    try { const installed = JSON.parse(await readFile(join(ownRoot, name), 'utf8')); if (typeof installed.projectRoot === 'string') candidates.push(installed.projectRoot); } catch {}
  }
  candidates.push(process.cwd());
}
let projectRoot;
for (const candidate of [...new Set(candidates)]) {
  try {
    const project = JSON.parse(await readFile(join(candidate, 'package.json'), 'utf8'));
    if (['quiz-mate', 'nexly-web-agent'].includes(project.name) && (await stat(join(candidate, 'scripts/install-native.mjs'))).isFile()) { projectRoot = resolve(candidate); break; }
  } catch {}
}
if (!projectRoot) {
  console.error('未找到 QuizMate 项目目录。请在设置页点击“获取项目源码”，解压后在项目目录运行安装命令；也可将项目目录作为本脚本的参数。');
  process.exit(1);
}
const commandArgs = [join(projectRoot, 'scripts/install-native.mjs'), '--browser', browser, '--extension-id', extensionId];
if (dryRun) {
  console.log(JSON.stringify({ node: process.execPath, projectRoot, browser, extensionId, args: commandArgs }, null, 2));
} else {
  const result = spawnSync(process.execPath, commandArgs, { cwd: projectRoot, stdio: 'inherit', windowsHide: true, shell: false });
  if (result.error) { console.error('无法启动安装器，请检查 Node.js 与项目路径。'); process.exit(1); }
  if (result.status !== 0) process.exit(result.status || 1);
  console.log('本地桥已安装或修复，请回到扩展点击“重新检测连接”。');
}
`;
}

import { mkdir, readFile, writeFile, chmod } from 'node:fs/promises';
import { platform } from 'node:os';
import { join } from 'node:path';
import { ROOT, extensionIdentity, requireModernNode } from './project.mjs';
import { nativeInstallationPaths, nativeLauncher, nativeOptions } from './native-platform.mjs';
import { windowsRegistration } from './windows-registry.mjs';
import { HOST_NAME } from '../extension/lib/contracts.js';
requireModernNode();
const { id: developmentId } = await extensionIdentity();
const options = nativeOptions(process.argv.slice(2), developmentId);
const id = options.extensionId;
const { nativeRoot, ownRoot, manifestPath, launcher, registryKey, installationPath, browser } = nativeInstallationPaths(options);
const script = nativeLauncher(process.execPath, join(ROOT, 'bridge/native-host.mjs'));
const manifest = { name: HOST_NAME, description: 'QuizMate local CLI bridge', path: launcher, type: 'stdio', allowed_origins: [`chrome-extension://${id}/`] };
if (options.dryRun) {
  console.log(JSON.stringify({ node: process.execPath, manifestPath, launcher, registryKey, browser, extensionId: id, manifest }, null, 2));
} else {
  let existing, installed;
  try { installed = JSON.parse(await readFile(installationPath, 'utf8')); } catch (error) { if (error.code !== 'ENOENT') throw new Error('已有安装记录无法读取，未覆盖'); }
  try { existing = JSON.parse(await readFile(manifestPath, 'utf8')); } catch (error) { if (error.code !== 'ENOENT') throw new Error('已有同名 native host 配置无法读取，未覆盖'); }
  if (installed && installed.projectRoot !== ROOT) throw new Error('已有其他项目目录安装的本地桥，未覆盖。请先在原项目卸载。');
  if (existing && (existing.name !== HOST_NAME || existing.type !== 'stdio' || existing.path !== launcher || existing.allowed_origins?.length !== 1 || (existing.allowed_origins[0] !== manifest.allowed_origins[0] && !(installed?.projectRoot === ROOT && installed?.launcher === launcher && installed?.manifestPath === manifestPath && existing.allowed_origins[0] === `chrome-extension://${installed.extensionId}/`)))) throw new Error('已有不同来源的同名 native host，未覆盖。请先核对并卸载旧配置。');
  if (registryKey) {
    const registrations = windowsRegistration('query', manifestPath, browser);
    if (registrations.some((item) => item.manifestPath != null && (typeof item.manifestPath !== 'string' || item.manifestPath.toLowerCase() !== manifestPath.toLowerCase()))) throw new Error('已有不同来源的同名 Windows native host 注册，未覆盖。');
  }
  await mkdir(ownRoot, { recursive: true, mode: 0o700 });
  await mkdir(nativeRoot, { recursive: true });
  await writeFile(launcher, script, { mode: 0o700 });
  if (platform() !== 'win32') await chmod(launcher, 0o700);
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2) + '\n', { mode: 0o600 });
  if (registryKey) windowsRegistration('register', manifestPath, browser);
  await writeFile(installationPath, JSON.stringify({ projectRoot: ROOT, manifestPath, launcher, browser, extensionId: id }, null, 2), { mode: 0o600 });
  console.log(`本地桥安装完成。\n扩展 ID：${id}\n${browser === 'edge' ? 'Edge' : 'Chrome'} 配置：${manifestPath}\nNode：${process.execPath}\n未修改 ccSwitch、CLI 账号或默认 Node。`);
}

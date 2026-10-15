import { mkdir, readFile, writeFile, chmod } from 'node:fs/promises';
import { platform } from 'node:os';
import { join } from 'node:path';
import { ROOT, extensionIdentity, requireModernNode } from './project.mjs';
import { nativeInstallationPaths, nativeLauncher } from './native-platform.mjs';
import { windowsRegistration } from './windows-registry.mjs';
import { HOST_NAME } from '../extension/lib/contracts.js';
requireModernNode();
const { nativeRoot, ownRoot, manifestPath, launcher, registryKey } = nativeInstallationPaths();
const { id } = await extensionIdentity();
const script = nativeLauncher(process.execPath, join(ROOT, 'bridge/native-host.mjs'));
const manifest = { name: HOST_NAME, description: 'Nexly local CLI bridge', path: launcher, type: 'stdio', allowed_origins: [`chrome-extension://${id}/`] };
if (process.argv.includes('--dry-run')) {
  console.log(JSON.stringify({ node: process.execPath, manifestPath, launcher, registryKey, extensionId: id, manifest }, null, 2));
} else {
  let existing;
  try { existing = JSON.parse(await readFile(manifestPath, 'utf8')); } catch (error) { if (error.code !== 'ENOENT') throw new Error('已有同名 native host 配置无法读取，未覆盖'); }
  if (existing && (existing.name !== HOST_NAME || existing.type !== 'stdio' || existing.path !== launcher || existing.allowed_origins?.length !== 1 || existing.allowed_origins[0] !== manifest.allowed_origins[0])) throw new Error('已有不同来源的同名 native host，未覆盖。请先核对并卸载旧配置。');
  if (registryKey) {
    const registrations = windowsRegistration('query', manifestPath);
    if (registrations.some((item) => item.manifestPath != null && (typeof item.manifestPath !== 'string' || item.manifestPath.toLowerCase() !== manifestPath.toLowerCase()))) throw new Error('已有不同来源的同名 Windows native host 注册，未覆盖。');
  }
  await mkdir(ownRoot, { recursive: true, mode: 0o700 });
  await mkdir(nativeRoot, { recursive: true });
  await writeFile(launcher, script, { mode: 0o700 });
  if (platform() !== 'win32') await chmod(launcher, 0o700);
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2) + '\n', { mode: 0o600 });
  if (registryKey) windowsRegistration('register', manifestPath);
  await writeFile(join(ownRoot, 'installation.json'), JSON.stringify({ projectRoot: ROOT, manifestPath, launcher, extensionId: id }, null, 2), { mode: 0o600 });
  console.log(`本地桥安装完成。\n扩展 ID：${id}\nChrome 配置：${manifestPath}\nNode：${process.execPath}\n未修改 ccSwitch、CLI 账号或默认 Node。`);
}

import { health } from '../bridge/cli.mjs';
import { extensionIdentity, requireModernNode } from './project.mjs';
requireModernNode();
const { id } = await extensionIdentity();
const result = await health();
console.log(`扩展 ID：${id}\n桥接 Node：${result.nodeVersion}`);
for (const provider of result.providers) {
  console.log(`${provider.id}: ${provider.installed ? provider.version : provider.error}`);
  for (const file of provider.configs) console.log(`  ${file.label}: ${file.exists ? '存在' : '未找到'}`);
}
console.log('仅检测命令与配置文件是否存在，未验证账号、额度或供应商可用性；不会输出凭据。');

import { PROJECT } from './lib/project-info.js';
import { nativeRequest } from './lib/native.js';
import { detectNativeBrowser, nativeSetupOptions, nativeRepairScript, nativeConnectionAdvice } from './lib/native-setup.js';

const $ = (id) => document.getElementById(id);
const detectedBrowser = detectNativeBrowser({ userAgent: navigator.userAgent, brands: navigator.userAgentData?.brands || [] });
$('bridge-browser').value = detectedBrowser || 'chrome';
$('browser-hint').textContent = detectedBrowser ? '已自动识别；如果与你当前使用的浏览器不同，可在此更正。' : '未能自动识别，请选择当前使用的浏览器。';
$('bridge-extension-id').value = chrome.runtime.id;
$('bridge-source').href = PROJECT.repository;
let options;

function updateCommands() {
  options = nativeSetupOptions(chrome.runtime.id, $('bridge-browser').value);
  $('bridge-command').value = options.command;
  $('repair-command').textContent = `node ${options.scriptName}`;
  $('bridge-action-status').textContent = '';
}
async function copyText(value, fallback) {
  try { await navigator.clipboard.writeText(value); $('bridge-action-status').textContent = '已复制。'; }
  catch {
    fallback?.focus(); fallback?.select?.();
    $('bridge-action-status').textContent = fallback ? '浏览器未允许复制，文本已选中，请按 Ctrl+C（macOS 使用 ⌘C）。' : '浏览器未允许复制，请手动选中上方运行命令。';
  }
}
$('copy-extension-id').addEventListener('click', () => copyText(chrome.runtime.id, $('bridge-extension-id')));
$('copy-bridge-command').addEventListener('click', () => copyText(options.command, $('bridge-command')));
$('copy-repair-command').addEventListener('click', () => copyText(`node ${options.scriptName}`));
$('bridge-browser').addEventListener('change', updateCommands);
$('download-bridge-repair').addEventListener('click', () => {
  const script = nativeRepairScript(options.extensionId, options.browser);
  const url = URL.createObjectURL(new Blob([script], { type: 'text/javascript;charset=utf-8' }));
  const link = document.createElement('a'); link.href = url; link.download = options.scriptName;
  document.body.append(link); link.click(); link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
  $('bridge-action-status').textContent = '已请求下载。下载完成后，在下载文件夹运行上方命令；脚本不会自动执行。';
});
$('check-bridge').addEventListener('click', async () => {
  $('check-bridge').disabled = true;
  $('bridge-check-status').textContent = '正在检测本地桥和 CLI 版本…';
  delete $('bridge-check-status').dataset.error;
  $('bridge-check-details').hidden = true; $('bridge-providers').hidden = true;
  try {
    const health = await nativeRequest('health').promise;
    $('bridge-check-status').textContent = `本地桥已连接 · Node ${health.nodeVersion}。请回到侧栏使用本地模式。`;
    $('bridge-check-status').dataset.error = 'false';
    $('bridge-providers').replaceChildren(...health.providers.map((provider) => {
      const item = document.createElement('li');
      item.textContent = `${provider.id}：${provider.installed ? provider.version : provider.error}`;
      return item;
    }));
    $('bridge-providers').hidden = false;
  } catch (error) {
    $('bridge-check-status').textContent = nativeConnectionAdvice(error.message);
    $('bridge-check-status').dataset.error = 'true';
    $('bridge-check-error').textContent = error.message; $('bridge-check-details').hidden = false;
  } finally { $('check-bridge').disabled = false; }
});
try { updateCommands(); }
catch (error) {
  $('bridge-action-status').textContent = error.message;
  for (const id of ['copy-extension-id', 'copy-bridge-command', 'copy-repair-command', 'download-bridge-repair']) $(id).disabled = true;
}

import { PROJECT, SUPPORT_IMAGE } from './lib/project-info.js';
for (const link of document.querySelectorAll('[data-project-link]')) link.href = PROJECT[link.dataset.projectLink];
document.getElementById('help-version').textContent = chrome.runtime.getManifest().version;
if (SUPPORT_IMAGE) {
  const image = document.getElementById('wechat-support');
  image.addEventListener('load', () => {
    document.getElementById('support-code').hidden = false;
    document.getElementById('support-empty').hidden = true;
  }, { once: true });
  // 图片失效时保留说明，不展示损坏的二维码或替代收款人。
  image.src = chrome.runtime.getURL(SUPPORT_IMAGE);
  document.getElementById('support-original').href = image.src;
}

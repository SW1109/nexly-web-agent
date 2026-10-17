/** activeTab 授权失效时 tabs.query 仍返回标签 ID，但会隐藏 url。 */
export async function activePracticeTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab?.id == null) throw new Error('请先选中练习网页，再重新读取');
  let url = tab.url;
  if (!url) {
    // webNavigation 已在清单中声明；只接受顶层页面地址，不能拿子 frame 代替当前页。
    const main = await chrome.webNavigation.getFrame({ tabId: tab.id, frameId: 0 }).catch(() => null);
    url = main?.url;
    if (!url) {
      const frames = await chrome.webNavigation.getAllFrames({ tabId: tab.id }).catch(() => []);
      url = frames?.find((frame) => frame.frameId === 0)?.url;
    }
  }
  if (!url) throw new Error('暂时无法获取当前练习页地址，请回到练习标签页，加载完成后重新读取');
  if (!/^https?:\/\//i.test(url)) throw new Error('当前标签不是普通 HTTP/HTTPS 练习网页，请切换到练习页后重新读取');
  return { ...tab, url };
}

/** 只从面板的用户点击调用；首次读取时申请当前站点和已加载练习 frame 的权限。 */
export async function ensurePracticeAccess() {
  const tab = await activePracticeTab();
  const frames = await chrome.webNavigation.getAllFrames({ tabId: tab.id }).catch(() => []);
  const origins = [...new Set([tab.url, ...(frames || []).map((frame) => frame.url)]
    .filter((url) => /^https?:\/\//i.test(url))
    .map((url) => `${new URL(url).origin}/*`))];
  if (!await chrome.permissions.contains({ origins }) && !await chrome.permissions.request({ origins })) {
    throw new Error('未获得站点权限。请点击“授权本站”并允许访问，然后重新读取练习题');
  }
  return tab;
}

/** 可单独在题目 frame 或其父级工具栏 frame 中查找换题入口。 */
export function navigationAction(action, payload = {}) {
  const normalize = (value) => String(value || '').replace(/\s+/g, '');
  const visible = (el) => {
    if (el.closest('[hidden],[aria-hidden="true"],[data-nexly-controls]')) return false;
    for (let node = el; node && node.nodeType === 1; node = node.parentElement) {
      const style = getComputedStyle(node);
      if (style.display === 'none' || style.visibility === 'hidden') return false;
    }
    return true;
  };
  const patterns = [
    /^(?:下一题|下一道题|下一个题目|下道题|NextQuestion)$/i,
    /^(?:随机一题|随机一道题|随机题目|随机换题|随机抽题|抽一题|随即一题|RandomQuestion|Random)$/i,
    /^(?:换一题|换道题|换个题目|换题|更换题目|另选一题|再来一题|再来一道|另一题|TryAnotherQuestion)$/i
  ];
  const hash = (value) => { let n = 2166136261; for (const c of value) n = Math.imul(n ^ c.charCodeAt(0), 16777619); return (n >>> 0).toString(16); };
  const candidates = [];
  for (const node of document.querySelectorAll('button,[role="button"],a,input[type="button"]')) {
    if (!visible(node)) continue;
    const labels = [node.getAttribute('aria-label'), node.getAttribute('title'), node.innerText || node.textContent, node.value].filter(Boolean).map(normalize);
    if (labels.some((label) => /提交|交卷|结束|退出|删除|清空|Submit|Finish|Delete|Exit/i.test(label))) continue;
    const rank = patterns.findIndex((pattern) => labels.some((label) => pattern.test(label)));
    if (rank < 0) continue;
    const label = labels.find((value) => patterns[rank].test(value));
    candidates.push({ node, key: hash([node.tagName, node.id, node.getAttribute('href') || '', ...labels].join('|')), label, rank, random: rank === 1, disabled: Boolean(node.disabled || node.getAttribute('aria-disabled') === 'true' || /loading|disabled/i.test(node.className || '')) });
  }
  if (action === 'find') return { ok: true, candidates: candidates.map(({ node, ...entry }) => entry) };
  if (action !== 'click') return { ok: false, error: '不支持的换题操作' };
  if (!payload.allowBackground && document.visibilityState !== 'visible') return { ok: true, waitingForFocus: true };
  const matches = candidates.filter((entry) => entry.key === payload.key && entry.label === payload.label && !entry.disabled);
  if (!matches.length) return { ok: true, waiting: true, detail: '换题入口暂不可用或页面已更新' };
  if (matches.length !== 1) return { ok: false, error: '找到多个同类换题入口，已停止，避免点击错误目标' };
  const selected = matches[0]; selected.node.click();
  return { ok: true, clicked: true, navigationLabel: selected.label, random: selected.random };
}

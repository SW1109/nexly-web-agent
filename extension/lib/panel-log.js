/** Keep the task log readable while new records arrive. */
export function createTaskLog({ list, count, jump }) {
  const doc = list.ownerDocument;
  let signature = null, records = [];
  // The visible row is restored explicitly; browser scroll anchoring must not compete.
  list.style.overflowAnchor = 'none';
  const atTop = () => list.scrollTop <= 2;
  const updateJump = () => { jump.hidden = records.length === 0 || atTop(); };
  list.addEventListener('scroll', updateJump, { passive: true });
  jump.addEventListener('click', () => {
    list.scrollTop = 0;
    updateJump();
    list.focus({ preventScroll: true });
  });

  function createRecord(entry, key) {
    const node = doc.createElement('li');
    const time = doc.createElement('time');
    time.dateTime = new Date(entry.time).toISOString();
    time.textContent = new Date(entry.time).toLocaleTimeString('zh-CN', { hour12: false });
    const text = doc.createElement('span');
    text.textContent = entry.text;
    node.append(time, text);
    return { key, node };
  }

  return function render(entries) {
    const ordered = entries.map((entry, index) => ({ entry, index }))
      .sort((a, b) => a.entry.time - b.entry.time || a.index - b.index);
    const nextSignature = JSON.stringify(ordered.map(({ entry }) => entry));
    if (nextSignature === signature) return;
    signature = nextSignature;

    const follow = atTop(), oldScrollTop = list.scrollTop;
    const viewport = list.getBoundingClientRect();
    const top = viewport.top + list.clientTop, bottom = top + list.clientHeight;
    const anchors = viewport.height > 0 ? [...list.children].map((node) => {
      const rect = node.getBoundingClientRect();
      return { node, offset: rect.top - top, distance: rect.bottom <= top ? top - rect.bottom : rect.top >= bottom ? rect.top - bottom : 0 };
    }).sort((a, b) => a.distance - b.distance) : [];

    const keys = ordered.map(({ entry }) => JSON.stringify([entry.time, entry.text]));
    // Publications append records and discard the oldest ones. Reuse that overlap,
    // including identical messages published during the same millisecond.
    let overlap = Math.min(records.length, keys.length);
    while (overlap && !keys.slice(0, overlap).every((key, i) => key === records[records.length - overlap + i].key)) overlap--;
    const next = records.slice(records.length - overlap);
    const used = new Set(next);
    for (let i = overlap; i < keys.length; i++) {
      const retained = records.find((record) => record.key === keys[i] && !used.has(record));
      const record = retained || createRecord(ordered[i].entry, keys[i]);
      used.add(record);
      next.push(record);
    }
    records = next;
    count.textContent = String(entries.length);
    list.replaceChildren(...records.map(({ node }) => node).reverse());

    if (!records.length || follow) list.scrollTop = 0;
    else {
      list.scrollTop = oldScrollTop;
      const retainedNodes = new Set(records.map(({ node }) => node));
      const anchor = anchors.find(({ node }) => retainedNodes.has(node));
      if (anchor) list.scrollTop += anchor.node.getBoundingClientRect().top - top - anchor.offset;
    }
    updateJump();
  };
}

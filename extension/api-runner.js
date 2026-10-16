const worker = new Worker(new URL('./lib/api-worker.js', import.meta.url), { type: 'module' });
const port = chrome.runtime.connect({ name: 'quizmate-api-runner' });
const jobs = new Map(), holds = new Set();
let heartbeat = null, failed = false;
function activity() {
  const active = jobs.size > 0 || holds.size > 0;
  if (active && !heartbeat) heartbeat = setInterval(() => {
    port.postMessage({ type: 'heartbeat' });
    for (const [requestId, start] of jobs) port.postMessage({ type: 'progress', requestId, data: { elapsedSeconds: Math.floor((Date.now() - start) / 1000) } });
  }, 20000);
  if (!active && heartbeat) { clearInterval(heartbeat); heartbeat = null; }
}
port.onMessage.addListener((message) => {
  if (message.type === 'hold') holds.add(message.id);
  if (message.type === 'release') holds.delete(message.id);
  if (message.type === 'request') {
    if (failed) port.postMessage({ type: 'error', requestId: message.requestId, error: 'API Worker 不可用，请重新加载扩展', code: 'API_WORKER' });
    else { jobs.set(message.requestId, Date.now()); worker.postMessage(message); }
  }
  if (message.type === 'cancel') { jobs.delete(message.requestId); worker.postMessage(message); }
  activity();
});
worker.onmessage = ({ data }) => { jobs.delete(data.requestId); port.postMessage(data); activity(); };
worker.onerror = (event) => {
  failed = true; event.preventDefault(); // 不把 Worker 的异常正文或请求数据输出到控制台。
  for (const requestId of jobs.keys()) port.postMessage({ type: 'error', requestId, error: 'API Worker 运行失败，未自动重试', code: 'API_WORKER' });
  jobs.clear(); activity();
};
// 后台意外重启时立即终止所有 fetch，不自动重放，避免重复计费。
port.onDisconnect.addListener(() => { worker.terminate(); jobs.clear(); holds.clear(); if (heartbeat) clearInterval(heartbeat); heartbeat = null; });

// API 长请求放在 offscreen 的专用 Worker，侧栏关闭不会丢失请求；只在请求/任务存续时保活。
export function createApiRuntime(api = chrome) {
  const pending = new Map(), holds = new Set();
  let port = null, opening = null, acceptPort = null;
  const runnerUrl = api.runtime.getURL('api-runner.html');
  const failure = (message, code = 'API_RUNTIME') => Object.assign(new Error(message), { code });
  api.runtime.onConnect.addListener((candidate) => {
    if (!['quizmate-api-runner', 'nexly-api-runner'].includes(candidate.name) || candidate.sender?.id !== api.runtime.id || candidate.sender?.tab || candidate.sender?.url !== runnerUrl) return;
    if (port && port !== candidate) { candidate.disconnect(); return; }
    port = candidate;
    candidate.onMessage.addListener((message) => {
      if (port !== candidate || !message || typeof message !== 'object') return;
      const entry = pending.get(message.requestId);
      if (!entry) return; // 心跳不带题目、答案或凭证；迟到结果不再交给任务。
      if (message.type === 'progress') { entry.onProgress?.(message.data); return; }
      if (message.type === 'result') entry.finish(null, message.data);
      else if (message.type === 'error') entry.finish(failure(message.error, message.code));
    });
    candidate.onDisconnect.addListener(() => {
      if (port !== candidate) return;
      port = null; holds.clear();
      for (const entry of [...pending.values()]) entry.finish(failure('API 执行环境已断开，任务已停止，未自动重试；请核对用量后再试'));
    });
    acceptPort?.(candidate);
  });
  async function ensure() {
    if (port) return port;
    if (opening) return opening;
    opening = (async () => {
      let timer;
      const connected = new Promise((resolve, reject) => {
        acceptPort = resolve;
        timer = setTimeout(() => reject(failure('API 执行环境启动超时，请重新加载扩展')), 10000);
      });
      // 先接住超时拒绝，避免创建文档失败时留下未处理的 Promise。
      void connected.catch(() => {});
      try {
        const contexts = await api.runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'], documentUrls: [runnerUrl] });
        if (port) return port;
        // 后台重启留下的孤立文档不重放任何请求，重新创建干净上下文。
        if (contexts.length) await api.offscreen.closeDocument();
        await api.offscreen.createDocument({ url: 'api-runner.html', reasons: ['WORKERS'], justification: 'Run cancellable API fetches in a dedicated worker independently of the side panel.' });
        return port || await connected;
      } finally { clearTimeout(timer); acceptPort = null; }
    })().finally(() => { opening = null; });
    return opening;
  }
  function request(action, credentials, question, onProgress) {
    const requestId = crypto.randomUUID();
    let finish, started = false;
    const promise = new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        if (started) { try { port?.postMessage({ type: 'cancel', requestId }); } catch {} }
        finish(failure('API 执行超时，已取消接收；服务端可能已受理，请核对用量', 'API_TIMEOUT'));
      }, (action === 'models' ? Math.min(credentials.config.timeoutSeconds, 30) : credentials.config.timeoutSeconds) * 1000 + 15000);
      finish = (error, data) => { if (!pending.delete(requestId)) return; clearTimeout(timer); error ? reject(error) : resolve(data); };
      pending.set(requestId, { finish, onProgress });
      void ensure().then((connection) => {
        if (!pending.has(requestId)) return;
        started = true;
        // 凭证只经校验过的扩展点对点 Port，不使用广播消息，不进入 taskState。
        connection.postMessage({ type: 'request', requestId, action, ...credentials, question });
      }).catch(() => finish(failure('无法启动 API 执行环境，请重新加载扩展后再试')));
    });
    return { requestId, promise, cancel() {
      if (!pending.has(requestId)) return;
      if (started) { try { port?.postMessage({ type: 'cancel', requestId }); } catch {} }
      finish(failure('API 请求已取消；服务端可能已受理', 'API_CANCELLED'));
    } };
  }
  async function hold() {
    const connection = await ensure(), id = crypto.randomUUID();
    holds.add(id); connection.postMessage({ type: 'hold', id });
    return () => { if (!holds.delete(id)) return; try { connection.postMessage({ type: 'release', id }); } catch {} };
  }
  return { request, hold };
}

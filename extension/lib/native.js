import { HOST_NAME, VERSION } from './contracts.js';
let port = null;
const pending = new Map();
function connect() {
  if (port) return port;
  port = chrome.runtime.connectNative(HOST_NAME);
  port.onMessage.addListener((message) => {
    if (!message || typeof message !== 'object') return;
    const request = pending.get(message.requestId);
    if (!request) return;
    if (message.type === 'progress') { request.onProgress?.(message.data); return; }
    pending.delete(message.requestId); clearTimeout(request.timer);
    if (message.type === 'error') request.reject(new Error(message.error));
    else if (message.type === 'result') request.resolve(message.data);
    else request.reject(new Error('本地桥返回了未知消息'));
  });
  port.onDisconnect.addListener(() => {
    const detail = chrome.runtime.lastError?.message || '本地桥已断开';
    port = null;
    for (const request of pending.values()) { clearTimeout(request.timer); request.reject(new Error(`无法连接本地 CLI 桥：${detail}。请按操作手册安装当前浏览器的本地桥，并核对扩展 ID。`)); }
    pending.clear();
  });
  return port;
}
export function nativeRequest(action, data = {}, onProgress) {
  const requestId = crypto.randomUUID();
  const promise = new Promise((resolve, reject) => {
    const connection = connect();
    const timer = setTimeout(() => { pending.delete(requestId); reject(new Error('本地桥响应超时')); if (action === 'solve') connection.postMessage({ version: VERSION, requestId: crypto.randomUUID(), action: 'cancel', targetId: requestId }); }, action === 'solve' ? 200000 : 20000);
    pending.set(requestId, { resolve, reject, timer, onProgress });
    try { connection.postMessage({ version: VERSION, requestId, action, ...data }); }
    catch (error) { pending.delete(requestId); clearTimeout(timer); reject(error); }
  });
  return { requestId, promise };
}
export function cancelNative(targetId) { return nativeRequest('cancel', { targetId }).promise; }

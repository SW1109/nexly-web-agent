import { HOST_NAME, VERSION, CLI_BRIDGE_TIMEOUT_MS } from './contracts.js';
let port = null;
const pending = new Map();
function connectionError(detail) {
  return new Error(`无法连接本地 CLI 桥：${detail instanceof Error ? detail.message : detail}。请点击“设置本地桥”，获取当前浏览器与扩展 ID 对应的安装或修复命令。`);
}
function takeRequest(requestId, connection) {
  const request = pending.get(requestId);
  if (!request || request.connection !== connection) return null;
  pending.delete(requestId);
  clearTimeout(request.timer);
  return request;
}
function failConnection(connection, error) {
  if (port === connection) port = null;
  for (const [requestId, request] of pending) {
    if (request.connection !== connection) continue;
    takeRequest(requestId, connection).reject(connectionError(error));
  }
}
function discardConnection(connection, error) {
  failConnection(connection, error);
  try { connection.disconnect?.(); } catch {}
}
function connect() {
  if (port) return port;
  const connection = chrome.runtime.connectNative(HOST_NAME);
  connection.onMessage.addListener((message) => {
    if (!message || typeof message !== 'object') return;
    const request = pending.get(message.requestId);
    if (!request || request.connection !== connection) return;
    if (message.type === 'progress') { request.onProgress?.(message.data); return; }
    takeRequest(message.requestId, connection);
    if (message.type === 'error') request.reject(new Error(message.error));
    else if (message.type === 'result') request.resolve(message.data);
    else request.reject(new Error('本地桥返回了未知消息'));
  });
  connection.onDisconnect.addListener(() => {
    const detail = chrome.runtime.lastError?.message || '本地桥已断开';
    failConnection(connection, detail);
  });
  port = connection;
  return connection;
}
export function nativeRequest(action, data = {}, onProgress) {
  const requestId = crypto.randomUUID();
  const promise = new Promise((resolve, reject) => {
    let connection;
    try { connection = connect(); }
    catch (error) { reject(connectionError(error)); return; }
    const timer = setTimeout(() => {
      const request = takeRequest(requestId, connection);
      if (!request) return;
      request.reject(new Error('本地桥响应超时'));
      if (action === 'solve') {
        try { connection.postMessage({ version: VERSION, requestId: crypto.randomUUID(), action: 'cancel', targetId: requestId }); }
        catch (error) { discardConnection(connection, error); }
      }
    }, action === 'solve' ? CLI_BRIDGE_TIMEOUT_MS : 20000);
    pending.set(requestId, { connection, action, resolve, reject, timer, onProgress });
    try { connection.postMessage({ version: VERSION, requestId, action, ...data }); }
    catch (error) { discardConnection(connection, error); }
  });
  return { requestId, promise };
}
export function cancelNative(targetId) {
  const request = pending.get(targetId);
  if (request?.action === 'solve') takeRequest(targetId, request.connection).reject(new Error('任务已停止'));
  return nativeRequest('cancel', { targetId }).promise;
}

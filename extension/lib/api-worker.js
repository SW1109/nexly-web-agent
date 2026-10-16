import { executeApi } from './api-client.js';
const jobs = new Map();
self.onmessage = async ({ data }) => {
  if (data.type === 'cancel') { jobs.get(data.requestId)?.abort(); return; }
  if (data.type !== 'request' || jobs.has(data.requestId)) return;
  const controller = new AbortController(); jobs.set(data.requestId, controller);
  try {
    const result = await executeApi(data.action, data.config, data.key, data.question, { signal: controller.signal });
    if (!controller.signal.aborted) self.postMessage({ type: 'result', requestId: data.requestId, data: result });
  } catch (error) {
    if (!controller.signal.aborted) self.postMessage({ type: 'error', requestId: data.requestId, error: error.code?.startsWith('API_') ? error.message : 'API 配置无效，请核对地址、模型与密钥', code: error.code || 'API_ERROR' });
  } finally { jobs.delete(data.requestId); }
};

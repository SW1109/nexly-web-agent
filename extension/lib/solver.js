import { requireDataConsent } from './project-info.js';
import { nativeRequest, cancelNative } from './native.js';
import { apiSettings, apiCredentials } from './api-settings.js';
import { connectionMode } from './api-config.js';
import { createApiRuntime } from './api-runtime.js';
let runtime;
function apiRuntime() { return runtime ||= createApiRuntime(); }
async function authorizedCredentials(rawConfig, key, options) {
  const credentials = await apiCredentials(rawConfig, key, options);
  if (!await chrome.permissions.contains({ origins: [credentials.config.permission] })) throw new Error('请在设置中保存 API 配置并授权该中转站域名');
  return credentials;
}
export async function solverHealth(mode = 'local') {
  if (connectionMode(mode) === 'local') return { ...await nativeRequest('health').promise, mode: 'local' };
  const settings = await apiSettings();
  return { mode: 'api', ready: settings.hasKey && Boolean(settings.config.model), ...settings };
}
export async function prepareSolver(prefs) {
  await requireDataConsent();
  if (connectionMode(prefs.connectionMode) === 'local') return {
    solve(question, onProgress) {
      const request = nativeRequest('solve', { provider: prefs.provider, question }, onProgress);
      return { ...request, cancel: () => cancelNative(request.requestId).catch(() => {}) };
    }, release() {}
  };
  const settings = await apiSettings();
  const credentials = await authorizedCredentials(settings.config);
  const release = await apiRuntime().hold();
  return { solve: (question, onProgress) => apiRuntime().request('solve', credentials, question, onProgress), release, model: credentials.config.model };
}
export async function apiProbe(action, rawConfig, key) {
  if (!['models', 'test'].includes(action)) throw new Error('不支持的 API 测试操作');
  const credentials = await authorizedCredentials(rawConfig, key, { requireModel: action !== 'models' });
  return apiRuntime().request(action, credentials);
}

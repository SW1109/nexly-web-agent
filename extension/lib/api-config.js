export const CONNECTION_MODES = ['local', 'api'];
export const API_PROTOCOLS = ['auto', 'chat', 'responses'];
export const API_TIMEOUT = Object.freeze({ min: 10, max: 600, defaultValue: 180 });
export const DEFAULT_API_CONFIG = Object.freeze({ baseUrl: '', protocol: 'auto', model: '', timeoutSeconds: API_TIMEOUT.defaultValue });

export function connectionMode(value = 'local') {
  if (!CONNECTION_MODES.includes(value)) throw new Error('请选择本地模式或 API 模式');
  return value;
}
export function apiEndpoints(value, protocol = 'auto') {
  if (typeof value !== 'string' || !value.trim()) throw new Error('请输入调用地址');
  if (!API_PROTOCOLS.includes(protocol)) throw new Error('请选择受支持的接口协议');
  let url;
  try { url = new URL(value.trim()); } catch { throw new Error('调用地址应为完整的 HTTPS 地址'); }
  const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback)) throw new Error('公网调用地址必须使用 HTTPS；HTTP 仅允许本机 localhost / 127.0.0.1 / [::1]');
  if (url.username || url.password || url.search || url.hash) throw new Error('调用地址不能包含账号、密码、查询参数或片段，请将密钥填入 API Key');
  let path = url.pathname.replace(/\/+$/, '');
  const suffix = path.endsWith('/chat/completions') ? '/chat/completions' : path.endsWith('/responses') ? '/responses' : '';
  const inferred = suffix === '/responses' ? 'responses' : 'chat';
  if (suffix && protocol !== 'auto' && protocol !== inferred) throw new Error('完整接口地址与所选协议不一致，请切换协议或填写基础地址');
  if (/(?:\/messages|[/:](?:generateContent|streamGenerateContent))$/i.test(path)) throw new Error('当前仅支持 OpenAI 兼容 Chat Completions 和 Responses，不支持原生 Anthropic / Gemini 地址');
  if (suffix) path = path.slice(0, -suffix.length);
  else if (!path) path = '/v1';
  const baseUrl = `${url.origin}${path}`;
  const resolvedProtocol = protocol === 'auto' ? inferred : protocol;
  return { baseUrl, origin: url.origin, permission: `${url.origin}/*`, protocol: resolvedProtocol, endpoint: baseUrl + (resolvedProtocol === 'responses' ? '/responses' : '/chat/completions'), modelsUrl: baseUrl + '/models' };
}
export function validateApiConfig(raw, { requireModel = true } = {}) {
  const invalid = (message, field) => Object.assign(new Error(message), { field });
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw invalid('请先配置 API 调用地址和模型', 'baseUrl');
  const protocol = raw.protocol ?? DEFAULT_API_CONFIG.protocol;
  if (!API_PROTOCOLS.includes(protocol)) throw invalid('请选择受支持的接口协议', 'protocol');
  let endpoints;
  try { endpoints = apiEndpoints(raw.baseUrl, protocol); }
  catch (error) { throw invalid(error.message, 'baseUrl'); }
  const model = typeof raw.model === 'string' ? raw.model : '';
  if (requireModel && !model) throw invalid('请选择或输入模型名称', 'model');
  // 模型 ID 是外部标识，不静默 trim；首尾空白必须由用户核对。
  if (model !== model.trim() || /[\x00-\x1f\x7f]/.test(model)) throw invalid('模型名称不能包含首尾空白、换行或控制字符', 'model');
  const timeoutSeconds = raw.timeoutSeconds ?? API_TIMEOUT.defaultValue;
  if (!Number.isInteger(timeoutSeconds) || timeoutSeconds < API_TIMEOUT.min || timeoutSeconds > API_TIMEOUT.max) throw invalid(`请求超时应为 ${API_TIMEOUT.min}～${API_TIMEOUT.max} 的整数秒`, 'timeoutSeconds');
  return { model, timeoutSeconds, ...endpoints, selectedProtocol: protocol };
}
export function storedApiConfig(config) {
  // 不将密钥、鉴权头或派生运行状态混进可公开配置。
  return { baseUrl: config.endpoint, protocol: config.selectedProtocol, model: config.model, timeoutSeconds: config.timeoutSeconds };
}
export function validateApiKey(value) {
  if (typeof value !== 'string' || !value) throw new Error('请输入 API Key');
  // 不静默 trim 外部凭证；空白/非 ASCII 会破坏 Bearer 请求头，必须由用户核对。
  if (/[^\x21-\x7e]/.test(value)) throw new Error('API Key 不能包含空格、换行或非 ASCII 字符，请检查后重新填写');
  return value;
}

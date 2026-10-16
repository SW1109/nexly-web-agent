import { buildPrompt, parseAnswer, validateQuestion } from './contracts.js';
import { validateApiConfig, validateApiKey } from './api-config.js';
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
const apiError = (message, code = 'API_ERROR') => Object.assign(new Error(message), { code });
function httpError(status, models) {
  if (status === 401) return apiError('API Key 无效或已过期，请重新配置', 'API_AUTH');
  if (status === 403) return apiError('中转站拒绝访问，请检查密钥权限和模型授权', 'API_FORBIDDEN');
  if (status === 404) return apiError(models ? '中转站未提供模型列表，请手动输入模型名称' : '接口地址或模型不存在，请核对协议、地址和模型名称', 'API_NOT_FOUND');
  if (status === 429) return apiError('中转站限流或额度不足，请检查余额后手动重试', 'API_RATE_LIMIT');
  if (status >= 500) return apiError(`中转站服务异常（HTTP ${status}），未自动重试，避免重复计费`, 'API_SERVER');
  return apiError(`API 请求失败（HTTP ${status}），请检查协议、模型及接口参数；未自动重试`, 'API_HTTP');
}
async function readBody(response, onChunk, signal) {
  if (!response.body) throw apiError('API 返回了空响应');
  const reader = response.body.getReader(), decoder = new TextDecoder('utf-8', { fatal: true });
  let bytes = 0;
  const decode = (value, options) => {
    try { return decoder.decode(value, options); }
    catch { throw apiError('API 返回了无效的 UTF-8 文本，未填写网页'); }
  };
  const abort = () => { void reader.cancel().catch(() => {}); };
  signal?.addEventListener('abort', abort, { once: true });
  try {
    while (true) {
      signal?.throwIfAborted();
      const { done, value } = await reader.read();
      signal?.throwIfAborted();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > MAX_RESPONSE_BYTES) throw apiError('API 响应超过 2 MiB，已停止接收');
      // 收到完整终结帧后立即关闭流，不依赖中转站主动断开长连接。
      if (onChunk(decode(value, { stream: true })) === true) return;
    }
    onChunk(decode());
  } finally { signal?.removeEventListener('abort', abort); await reader.cancel().catch(() => {}); reader.releaseLock(); }
}
function responseText(data) {
  if (data?.error || data?.status !== 'completed' || !Array.isArray(data.output)) throw apiError('Responses 未返回完整成功结果，未填写网页');
  if (data.output.some((item) => !['message', 'reasoning'].includes(item.type))) throw apiError('模型请求了工具或返回非文本结果，未填写网页');
  return data.output.filter((item) => item.type === 'message' && item.role === 'assistant').flatMap((item) => item.content || []).map((part) => {
    if (part.type === 'refusal') throw apiError('模型拒绝生成答案，未填写网页');
    if (part.type !== 'output_text' || typeof part.text !== 'string') throw apiError('模型未返回完整文本答案');
    return part.text;
  }).join('');
}
function chatText(data) {
  if (data?.error || !Array.isArray(data?.choices) || data.choices.length !== 1) throw apiError('Chat Completions 未返回唯一答案');
  const choice = data.choices[0];
  if (choice.finish_reason !== 'stop' || choice.message?.refusal || choice.message?.tool_calls?.length || choice.message?.function_call) throw apiError('模型输出被截断、拒绝或请求了工具，未填写网页');
  if (typeof choice.message?.content !== 'string') throw apiError('模型未返回文本答案');
  return choice.message.content;
}
async function completionText(response, protocol, signal) {
  if (!response.headers.get('content-type')?.toLowerCase().includes('text/event-stream')) {
    let body = ''; await readBody(response, (chunk) => { body += chunk; }, signal);
    let data; try { data = JSON.parse(body); } catch { throw apiError('API 返回的不是有效 JSON，请核对接口地址'); }
    return protocol === 'responses' ? responseText(data) : chatText(data);
  }
  let buffer = '', text = '', finished = false, failed = false, terminal = false;
  const consume = (block) => {
    const payload = block.split('\n').filter((line) => line.startsWith('data:')).map((line) => line.slice(5).replace(/^ /, '')).join('\n');
    if (!payload) return;
    if (payload === '[DONE]') { terminal = true; return; }
    let event; try { event = JSON.parse(payload); } catch { throw apiError('API 流包含无效 JSON，未填写网页'); }
    if (event.error || ['error', 'response.failed', 'response.incomplete'].includes(event.type)) throw apiError('API 生成失败或输出不完整，未填写网页');
    if (protocol === 'responses') {
      if (event.type === 'response.output_text.delta') {
        if (typeof event.delta !== 'string') throw apiError('API 流的文本片段格式错误');
        text += event.delta;
      }
      if (event.type === 'response.refusal.delta' || event.type === 'response.function_call_arguments.delta') failed = true;
      if (event.type === 'response.completed') {
        const complete = responseText(event.response);
        if (text && text !== complete) throw apiError('API 流与最终文本不一致，未填写网页');
        text = complete; finished = true; terminal = true;
      }
    } else {
      if (event.choices != null && !Array.isArray(event.choices)) throw apiError('API 流的候选格式错误');
      for (const choice of event.choices || []) {
        if (choice.index !== 0) throw apiError('API 流返回多个答案，已停止');
        if (choice.delta?.refusal || choice.delta?.tool_calls?.length || choice.delta?.function_call) failed = true;
        if (choice.delta?.content != null && typeof choice.delta.content !== 'string') failed = true;
        if (typeof choice.delta?.content === 'string') { if (finished && choice.delta.content) failed = true; text += choice.delta.content; }
        if (choice.finish_reason != null) { finished = choice.finish_reason === 'stop'; failed ||= !finished; }
      }
    }
  };
  await readBody(response, (chunk) => {
    // CRLF 可跨网络分片；保留尾部 \r，避免把一个换行误读成两个。
    buffer += chunk;
    buffer = buffer.replace(/\r\n/g, '\n');
    let index;
    while ((index = buffer.indexOf('\n\n')) >= 0) {
      consume(buffer.slice(0, index)); buffer = buffer.slice(index + 2);
      if (terminal) return true;
    }
    return false;
  }, signal);
  if (!terminal && buffer.trim()) consume(buffer);
  if (!finished || failed || (protocol === 'chat' && !terminal)) throw apiError('API 流被中断或输出不完整，未填写网页');
  return text;
}
export const API_TEST_QUESTION = Object.freeze({ questionId: 'quizmate-api-connection-test', type: 'single', title: '连接测试', stem: '单选题：2 + 2 等于多少？', options: [{ id: 'option-0', label: 'A', text: '3' }, { id: 'option-1', label: 'B', text: '4' }], fields: [], language: '', starterCode: '', pageUrl: 'https://example.com/practice' });
export async function executeApi(action, rawConfig, key, question, { signal, fetchImpl = fetch } = {}) {
  if (!['models', 'solve', 'test'].includes(action)) throw apiError('不支持的 API 操作');
  const config = validateApiConfig(rawConfig, { requireModel: action !== 'models' });
  validateApiKey(key);
  const controller = new AbortController();
  let timedOut = false;
  const abort = () => controller.abort();
  signal?.addEventListener('abort', abort, { once: true });
  if (signal?.aborted) abort();
  const timer = setTimeout(() => { timedOut = true; controller.abort(); }, action === 'models' ? Math.min(config.timeoutSeconds * 1000, 30000) : config.timeoutSeconds * 1000);
  try {
    controller.signal.throwIfAborted();
    const input = action === 'models' ? null : validateQuestion(action === 'test' ? API_TEST_QUESTION : question);
    const prompt = input ? buildPrompt(input) : '';
    // 仅发送通用必要参数；结构化契约由提示与本地严格校验保障，不盲目重试不兼容参数。
    const body = config.protocol === 'responses'
      ? { model: config.model, input: [{ role: 'user', content: prompt }], stream: true, store: false }
      : { model: config.model, messages: [{ role: 'user', content: prompt }], stream: true };
    const response = await fetchImpl(action === 'models' ? config.modelsUrl : config.endpoint, {
      method: action === 'models' ? 'GET' : 'POST', headers: { Authorization: `Bearer ${key}`, ...(input ? { 'Content-Type': 'application/json' } : {}) },
      ...(input ? { body: JSON.stringify(body) } : {}), signal: controller.signal, credentials: 'omit', redirect: 'error', referrerPolicy: 'no-referrer', cache: 'no-store'
    });
    if (!response.ok) { await response.body?.cancel().catch(() => {}); throw httpError(response.status, action === 'models'); }
    if (action === 'models') {
      let text = ''; await readBody(response, (chunk) => { text += chunk; }, controller.signal);
      let data; try { data = JSON.parse(text); } catch { throw apiError('模型列表不是有效 JSON，请手动输入模型名称'); }
      if (!Array.isArray(data.data)) throw apiError('中转站未返回标准模型列表，请手动输入模型名称');
      const models = [...new Set(data.data.map((item) => item?.id).filter((id) => typeof id === 'string' && id && id === id.trim() && !/[\x00-\x1f\x7f]/.test(id)))].sort();
      if (!models.length) throw apiError('当前密钥没有可用模型，请检查权限或手动输入模型名称');
      return { models };
    }
    // 部分国产模型把完整的前置思考块放入 content；只移除闭合前缀，不从任意正文中猜测 JSON。
    const content = (await completionText(response, config.protocol, controller.signal)).trim().replace(/^<think>[\s\S]*?<\/think>\s*/i, '');
    const answer = parseAnswer(content, input);
    if (action === 'test') {
      if (answer.choiceIds.length !== 1 || answer.choiceIds[0] !== 'option-1') throw apiError('模型可连接，但连接测试答案未通过校验，请核对模型能力');
      return { tested: true, model: config.model, protocol: config.protocol };
    }
    return { answer };
  } catch (error) {
    if (timedOut) throw apiError('API 请求超时，已停止接收；服务端可能已受理，请核对用量后手动重试', 'API_TIMEOUT');
    if (signal?.aborted) throw apiError('API 请求已取消；服务端可能已受理', 'API_CANCELLED');
    // 中转站正文和 fetch 原始异常可能回显 Key/题干，不进入任务日志或页内组件。
    if (error.code?.startsWith('API_')) throw error;
    if (error instanceof TypeError) throw apiError('无法连接 API，请检查网络、域名授权、HTTPS 证书和接口地址（不允许重定向）', 'API_NETWORK');
    throw apiError('API 答案未通过格式或题目一致性校验，未填写网页');
  } finally { clearTimeout(timer); signal?.removeEventListener('abort', abort); }
}

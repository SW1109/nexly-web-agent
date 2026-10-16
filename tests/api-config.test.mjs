import test from 'node:test';
import assert from 'node:assert/strict';
import { apiEndpoints, validateApiConfig, storedApiConfig, validateApiKey, connectionMode } from '../extension/lib/api-config.js';

test('API addresses normalize bases and full endpoints without duplicating v1', () => {
  for (const baseUrl of ['https://api.example.com', 'https://api.example.com/', 'https://api.example.com/v1/', 'https://api.example.com/v1/chat/completions']) {
    const endpoints = apiEndpoints(baseUrl);
    assert.equal(endpoints.endpoint, 'https://api.example.com/v1/chat/completions');
    assert.equal(endpoints.modelsUrl, 'https://api.example.com/v1/models');
  }
  assert.equal(apiEndpoints('https://api.example.com/api/custom', 'responses').endpoint, 'https://api.example.com/api/custom/responses');
  assert.equal(apiEndpoints('https://api.example.com/responses').modelsUrl, 'https://api.example.com/models');
  assert.equal(apiEndpoints('https://api.example.com/v1/responses').protocol, 'responses');
  assert.throws(() => apiEndpoints('https://api.example.com/v1/responses', 'chat'), /不一致/);
  assert.throws(() => apiEndpoints('https://api.example.com/v1/chat/completions', 'responses'), /不一致/);
});
test('API URL validation rejects insecure, credential-bearing and native protocol URLs', () => {
  for (const url of ['', 'example.com', 'http://api.example.com/v1', 'http://192.168.1.8/v1', 'file:///tmp/key', 'https://user:pass@api.example.com', 'https://api.example.com?key=secret', 'https://api.example.com/#secret', 'https://api.example.com/v1/messages', 'https://api.example.com/v1beta/models/gemini:generateContent']) assert.throws(() => apiEndpoints(url), undefined, url);
  for (const host of ['localhost', '127.0.0.1', '[::1]']) assert.equal(apiEndpoints(`http://${host}:4183/v1`).permission, `http://${host}:4183/*`);
});
test('API config preserves auto Responses selection and excludes credentials', () => {
  const checked = validateApiConfig({ baseUrl: 'https://api.example.com/v1/responses', model: 'custom-model', key: 'not-stored' });
  const stored = storedApiConfig(checked);
  assert.equal(stored.protocol, 'auto'); assert.equal(stored.model, 'custom-model');
  assert.equal(validateApiConfig(stored).protocol, 'responses');
  assert.equal(stored.key, undefined); assert.equal(stored.timeoutSeconds, 180);
  assert.equal(connectionMode(), 'local'); assert.throws(() => connectionMode('cloud'));
});
test('API config validates required model, timeout boundaries and key bytes without trimming credentials', () => {
  const raw = { baseUrl: 'https://api.example.com/v1', model: 'model' };
  for (const timeoutSeconds of [10, 600]) assert.equal(validateApiConfig({ ...raw, timeoutSeconds }).timeoutSeconds, timeoutSeconds);
  for (const timeoutSeconds of [0, 9, 601, 10.1, '180', NaN]) assert.throws(() => validateApiConfig({ ...raw, timeoutSeconds }));
  assert.throws(() => validateApiConfig({ ...raw, model: '' }), /模型/);
  assert.throws(() => validateApiConfig({ ...raw, model: ' custom-model ' }), /首尾空白/);
  assert.doesNotThrow(() => validateApiConfig({ ...raw, model: '' }, { requireModel: false }));
  assert.equal(validateApiKey('sk-test'), 'sk-test');
  for (const key of ['', ' sk-test', 'sk-test ', 'sk\nabc', '中文key']) assert.throws(() => validateApiKey(key));
});

// 同一兼容请求层覆盖厂商，不复制每家的 HTTP 客户端，也不猜测用户的模型权限。
test('domestic provider presets keep exact versioned paths and never contain credentials or model claims', async () => {
  const { API_PROVIDERS, apiProvider } = await import('../extension/lib/api-providers.js');
  const expected = { deepseek: 'https://api.deepseek.com/chat/completions', qwen: 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions', glm: 'https://open.bigmodel.cn/api/paas/v4/chat/completions', kimi: 'https://api.moonshot.cn/v1/chat/completions', doubao: 'https://ark.cn-beijing.volces.com/api/v3/chat/completions', minimax: 'https://api.minimax.cn/v1/chat/completions', hunyuan: 'https://api.hunyuan.cloud.tencent.com/v1/chat/completions', tokenhub: 'https://tokenhub.tencentmaas.com/v1/chat/completions', qianfan: 'https://qianfan.baidubce.com/v2/chat/completions', spark: 'https://spark-api-open.xf-yun.com/v1/chat/completions', siliconflow: 'https://api.siliconflow.cn/v1/chat/completions', stepfun: 'https://api.stepfun.com/v1/chat/completions' };
  for (const [id, endpoint] of Object.entries(expected)) {
    const preset = apiProvider(id), config = validateApiConfig({ baseUrl: preset.baseUrl, protocol: 'chat', model: 'user-provided-id' });
    assert.equal(config.endpoint, endpoint); assert.equal(preset.key, undefined); assert.equal(preset.model, undefined);
    assert.ok(preset.docs.startsWith('https://')); assert.ok(preset.hint);
  }
  assert.equal(new Set(API_PROVIDERS.map((provider) => provider.id)).size, API_PROVIDERS.length);
  assert.equal(apiProvider('unknown').id, 'custom');
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { executeOfficial } from '../extension/lib/api-client.js';
import { serviceView, createLicenseClient } from '../extension/lib/license-client.js';
import { single, correct } from './data.mjs';
const token = 'qms_' + 'A'.repeat(43);
const config = { server: 'https://license.example.test', model: 'fixture-model', clientVersion: '0.7.0' };
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const access = { ready: true, models: ['fixture-model'], max_calls: 100, budget_micros: 300000, usage: { calls: 1, success: 1, failed: 0, uncertain: 0, unique_ips: 1, input_tokens: 10, output_tokens: 20, cost_micros: 50, held_micros: 0 } };

test('官方服务只发送授权会话，保留问题校验、来源 origin 和防重身份', async () => {
  let requests = 0;
  const result = await executeOfficial(config, token, single, { requestId: 'd0d4c0e5-0f80-4168-9d8f-eef6792bdf55', fetchImpl: async (url, init) => {
    requests++; assert.equal(url, config.server + '/api/v1/plugin-license/complete'); assert.equal(init.headers.Authorization, 'Bearer ' + token); assert.equal(init.redirect, 'error'); assert.equal(init.credentials, 'omit');
    const body = JSON.parse(init.body); assert.equal(body.model, config.model); assert.equal(body.request_id, 'd0d4c0e5-0f80-4168-9d8f-eef6792bdf55'); assert.equal(body.page_origin, new URL(single.pageUrl).origin); assert.ok(!('api_key' in body)); assert.ok(!('cost_micros' in body)); assert.ok(!init.body.includes(token));
    return json({ content: JSON.stringify(correct), upstream_key: 'must-not-propagate' });
  } });
  assert.deepEqual(result, { answer: correct }); assert.equal(requests, 1);
});

test('官方服务错误正文与无效题目答案不会进入填写结果，也不自动重试', async () => {
  for (const status of [400, 401, 403, 409, 429, 500, 502]) {
    let requests = 0;
    await assert.rejects(executeOfficial(config, token, single, { fetchImpl: async () => { requests++; return json({ error: 'sensitive-upstream-body' }, status); } }), error => !error.message.includes('sensitive-upstream-body') && error.code === 'API_OFFICIAL');
    assert.equal(requests, 1);
  }
  await assert.rejects(executeOfficial(config, token, single, { fetchImpl: async () => json({ content: JSON.stringify({ ...correct, questionId: 'different-question' }) }) }), /答案校验失败/);
});

test('官方权益只暴露白名单统计，未知字段不传面板', () => {
  const result = serviceView({ ...access, api_key: 'secret', usage: { ...access.usage, token: 'secret' } });
  assert.ok(!JSON.stringify(result).includes('secret')); assert.equal(result.budgetMicros, 300000);
  assert.throws(() => serviceView({ ...access, usage: { ...access.usage, cost_micros: -1 } }));
  assert.throws(() => serviceView({ ...access, models: ['bad\nmodel'] }));
});

test('凭据只供后台运行且核对期间退出授权会终止准备', async () => {
  const values = { pluginLicenseServer: config.server, pluginLicenseSession: { token }, pluginServiceModel: 'not-authorized' };
  let invalidate = false;
  const client = createLicenseClient({ storage: { async get(keys) { return Object.fromEntries(keys.filter(key => key in values).map(key => [key, structuredClone(values[key])])); } }, permissions: { async contains() { return true; } }, protect: async () => {}, fetcher: async () => { if (invalidate) delete values.pluginLicenseSession; return json(access); } });
  const credentials = await client.credentials(); assert.equal(credentials.key, token); assert.equal(credentials.config.model, 'fixture-model'); assert.ok(!JSON.stringify(credentials).includes('upstream_key'));
  invalidate = true; await assert.rejects(client.credentials(), /授权已发生变化/);
});


test('调用次数和美元额度随服务端配置更新，不固定为默认次数', async () => {
  const values = { pluginLicenseServer: config.server, pluginLicenseSession: { token } };
  let maxCalls = 70, budgetMicros = 300000, requests = 0;
  const client = createLicenseClient({ storage: { async get(keys) { return Object.fromEntries(keys.filter(key => key in values).map(key => [key, structuredClone(values[key])])); } }, permissions: { async contains() { return true; } }, protect: async () => {}, fetcher: async () => { requests++; return json({ ...access, max_calls: maxCalls, budget_micros: budgetMicros }); } });
  assert.equal((await client.service()).maxCalls, 70);
  maxCalls = 125; budgetMicros = 500000;
  const changed = await client.service();
  assert.equal(changed.maxCalls, 125); assert.equal(changed.budgetMicros, 500000); assert.equal(requests, 2);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { createLicenseClient, licenseServer, licenseView } from '../extension/lib/license-client.js';

const server = 'https://licenses.example.test';
const code = 'QM-ABCDEFGH-IJKLMNOP-QRSTUVWX-YZ234567';
const device = 'f24cc762-188b-4eac-a055-bbb91fa34a87';
const token = 'qms_' + 'A'.repeat(43);
const rights = { id: '120f3b93-0dc4-461a-a5da-a8fc1037c945', name: '试用额度', kind: 'quota', state: 'active', code_mask: 'QM-••••-4567', quota_limited: true, bound: true, duration_days: 0, quota_total: 100, remaining: 100, used: 0, created_at: 100, activated_at: 200, expires_at: 0 };
const json = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } });
function fixture() {
  const data = { connectionMode: 'local', apiConfig: { model: 'existing' } }, calls = [], writes = [];
  let allowed = true, handler = () => json({ token, license: rights }), protections = 0, ids = 0;
  const storage = {
    async get(keys) { return Object.fromEntries(keys.filter(key => key in data).map(key => [key, structuredClone(data[key])])); },
    async set(patch) { writes.push(structuredClone(patch)); Object.assign(data, structuredClone(patch)); },
    async remove(key) { delete data[key]; },
  };
  const client = createLicenseClient({ storage, protect: async () => { protections++; }, randomUUID: () => { ids++; return device; }, permissions: { async contains(value) { assert.deepEqual(value, { origins: [server + '/*'] }); return allowed; } }, fetcher: async (url, init) => { calls.push({ url, init }); return handler(url, init); } });
  return { client, data, calls, writes, allow: value => { allowed = value; }, handle: value => { handler = value; }, stats: () => ({ protections, ids }) };
}

test('授权地址只接受安全根地址，权限与模型接口独立', () => {
  assert.deepEqual(licenseServer(server + '///'), { server, permission: server + '/*' });
  assert.equal(licenseServer('http://127.0.0.1:59188').server, 'http://127.0.0.1:59188');
  for (const url of ['', 'http://public.example', 'https://u:p@example.test', server + '/v1', server + '?key=secret', server + '#secret', 'javascript:alert(1)']) assert.throws(() => licenseServer(url));
});

test('权益严格投影，服务端额外秘密不会进入面板', () => {
  assert.deepEqual(licenseView({ ...rights, token: 'do-not-show', code_hash: 'private', device_hash: 'private' }), rights);
  for (const patch of [{ kind: 'unknown' }, { state: 'unknown' }, { remaining: -1 }, { remaining: 101 }, { used: 1.1 }, { bound: 1 }, { expires_at: 1 }, { quota_limited: false }, { quota_total: Number.MAX_SAFE_INTEGER + 1 }]) assert.throws(() => licenseView({ ...rights, ...patch }));
});

test('初次读取不联网；兑换原文不落盘、token 不外传、原模式不改变', async () => {
  const f = fixture();
  assert.deepEqual(await f.client.settings(), { server: 'https://xianyu.guangnian.xin', license: null, checkedAt: 0 });
  assert.equal(f.calls.length, 0);
  assert.equal(f.writes.length, 0, '默认地址仅用于回显，不主动覆盖浏览器存储');
  f.data.pluginLicenseServer = server;
  assert.equal((await f.client.settings()).server, server, '已保存的自定义授权地址优先保留');
  const view = await f.client.redeem(server, code.toLowerCase());
  assert.deepEqual(view.license, rights);
  assert.ok(view.checkedAt > 0);
  assert.equal(f.stats().ids, 1);
  assert.equal(f.data.pluginLicenseSession.token, token);
  assert.equal(f.data.connectionMode, 'local');
  assert.deepEqual(f.data.apiConfig, { model: 'existing' });
  assert.ok(!JSON.stringify(f.data).includes(code));
  assert.ok(!JSON.stringify(f.writes).includes(code));
  assert.ok(!JSON.stringify(view).includes(token));
  const call = f.calls[0];
  assert.deepEqual(JSON.parse(call.init.body), { code: code.toLowerCase(), device_id: device });
  assert.equal(call.init.method, 'POST');
  assert.equal(call.init.redirect, 'error');
  assert.equal(call.init.credentials, 'omit');
  assert.equal(call.init.referrerPolicy, 'no-referrer');
  assert.equal(call.init.cache, 'no-store');
  assert.ok(f.stats().protections >= 3);
});

test('权限或格式拒绝时不会发送兑换，已有权益不被破坏', async () => {
  const f = fixture();
  await assert.rejects(f.client.redeem(server, 'wrong'), /完整/);
  assert.equal(f.calls.length, 0);
  f.allow(false);
  await assert.rejects(f.client.redeem(server, code), /允许访问/);
  assert.equal(f.calls.length, 0);
  assert.equal(f.data.pluginLicenseDevice, device);
});

test('网络结果不确定时保留安装身份，重试不占第二个设备', async () => {
  const f = fixture();
  f.handle(() => { throw new TypeError('network contains private body'); });
  await assert.rejects(f.client.redeem(server, code), /无法连接授权服务/);
  assert.equal(f.data.pluginLicenseDevice, device);
  f.handle(() => json({ token, license: rights }));
  await f.client.redeem(server, code);
  assert.equal(f.stats().ids, 1);
  assert.equal(JSON.parse(f.calls[0].init.body).device_id, JSON.parse(f.calls[1].init.body).device_id);
});

test('状态只用 Authorization 头并更新白名单缓存；读取缓存不再请求', async () => {
  const f = fixture();
  await f.client.redeem(server, code);
  f.handle(() => json({ ...rights, remaining: 60, used: 40, unexpected_secret: 'hidden' }));
  const view = await f.client.refresh();
  assert.equal(view.license.remaining, 60);
  assert.equal(f.calls[1].init.headers.Authorization, 'Bearer ' + token);
  assert.ok(!f.calls[1].url.includes(token));
  assert.equal(f.calls[1].init.method, 'GET');
  assert.equal(JSON.stringify(view).includes(token), false);
  assert.equal(JSON.stringify(f.data).includes('hidden'), false);
  await f.client.settings();
  assert.equal(f.calls.length, 2);
});

test('拒绝非法响应且不会把错误正文、JSON 片段或上游秘密显示出来', async () => {
  const f = fixture();
  for (const status of [400, 401, 403, 404, 409, 429, 500]) {
    f.handle(() => json({ message: 'secret-raw-card-key' }, status));
    await assert.rejects(f.client.redeem(server, code), error => !error.message.includes('secret-raw-card-key'));
  }
  f.handle(() => new Response('secret-raw-card-key', { headers: { 'content-type': 'application/json' } }));
  await assert.rejects(f.client.redeem(server, code), /无效 JSON/);
  f.handle(() => new Response('<html>private</html>'));
  await assert.rejects(f.client.redeem(server, code), /没有返回 JSON/);
  f.handle(() => json({ token: 'invalid', license: rights }));
  await assert.rejects(f.client.redeem(server, code), /会话格式/);
  assert.equal(f.data.pluginLicenseSession, undefined);
});

test('退出失败仍清理本机凭据，保留安装身份避免不必要换机', async () => {
  const f = fixture();
  await f.client.redeem(server, code);
  f.handle(() => { throw new TypeError('offline'); });
  const result = await f.client.logout();
  assert.equal(result.revoked, false);
  assert.equal(result.license, null);
  assert.equal(f.data.pluginLicenseSession, undefined);
  assert.equal(f.data.pluginLicenseDevice, device);
  await assert.rejects(f.client.refresh(), /先输入卡密/);
});

test('兑换、重新核对、退出串行，迟到响应不能恢复已退出的凭据', async () => {
  const f = fixture();
  let release;
  f.handle(() => new Promise(resolve => { release = resolve; }));
  const redeem = f.client.redeem(server, code);
  const refresh = f.client.refresh();
  const logout = f.client.logout();
  while (!release) await new Promise(resolve => setImmediate(resolve));
  assert.equal(f.calls.length, 1);
  f.handle((_url, init) => json(init.method === 'POST' ? { success: true } : rights));
  release(json({ token, license: rights }));
  await Promise.all([redeem, refresh, logout]);
  assert.equal(f.calls.length, 3);
  assert.equal(f.data.pluginLicenseSession, undefined);
  assert.deepEqual((await f.client.settings()).license, null);
});


test('官方卡兑换及刷新后多次读取缓存保留真实次数与金额上限', async () => {
  const f = fixture();
  const official = { ...rights, official_service: true, service_max_calls: 100, service_budget_micros: 300000, upstream_key: 'never-cache' };
  f.handle(() => json({ token, license: official }));
  const redeemed = await f.client.redeem(server, code);
  for (let i = 0; i < 3; i++) {
    const view = await f.client.settings();
    assert.equal(view.license.officialService, true);
    assert.equal(view.license.serviceMaxCalls, 100);
    assert.equal(view.license.serviceBudgetMicros, 300000);
    assert.deepEqual(view.license, licenseView(view.license));
    assert.ok(!JSON.stringify(view).includes('never-cache'));
  }
  assert.equal(f.calls.length, 1);
  f.handle(() => json({ ...official, used: 5, remaining: 95 }));
  await f.client.refresh();
  const cached = await f.client.settings();
  assert.equal(cached.license.remaining, 95);
  assert.equal(cached.license.serviceBudgetMicros, redeemed.license.serviceBudgetMicros);
  assert.throws(() => licenseView({ ...cached.license, serviceBudgetMicros: -1 }), /官方商品规则/);
});

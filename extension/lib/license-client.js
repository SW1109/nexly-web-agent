import { PROJECT } from './project-info.js';
import { apiEndpoints } from './api-config.js';
import { protectApiStorage } from './api-settings.js';

const STATES = new Set(['new', 'active', 'disabled', 'expired', 'exhausted']);
let sharedClient;
export function getLicenseClient() { return sharedClient ||= createLicenseClient(); }
const KINDS = new Set(['time', 'quota', 'hybrid']);

/** 授权地址与模型地址分开配置；只复用已有的 HTTPS、凭据和可选权限校验。 */
export function licenseServer(value) {
  const verified = apiEndpoints(value), url = new URL(value.trim());
  if (url.pathname.replace(/\/+$/, '')) throw new Error('授权服务请填写后台根地址，不要填写模型的 /v1 或其他接口路径');
  return { server: url.origin, permission: verified.permission };
}

/** 严格白名单投影，服务端新增字段、会话摘要和秘密不会进入面板状态。 */
export function licenseView(raw) {
  if (!raw || typeof raw !== 'object' || !KINDS.has(raw.kind) || !STATES.has(raw.state) || typeof raw.name !== 'string' || raw.name.length > 320 || typeof raw.id !== 'string' || typeof raw.code_mask !== 'string' || typeof raw.quota_limited !== 'boolean' || typeof raw.bound !== 'boolean') throw new Error('授权服务返回的权益格式不正确，请更新后台');
  const numbers = ['duration_days', 'quota_total', 'remaining', 'used', 'created_at', 'activated_at', 'expires_at'];
  for (const key of numbers) if (!Number.isSafeInteger(raw[key]) || raw[key] < 0) throw new Error('授权服务返回的额度或时间无效');
  if (raw.remaining > raw.quota_total || raw.quota_limited !== (raw.kind !== 'time') || (raw.kind === 'quota' && raw.expires_at !== 0)) throw new Error('授权服务返回的套餐规则不一致');
  // 同时接受服务端字段和经过白名单投影的本地缓存，重复读取不能丢失官方计费上限。
  const fromServer = Object.hasOwn(raw, 'official_service');
  const official = fromServer ? raw.official_service === true : raw.officialService === true;
  const serviceFields = official ? { officialService: true, serviceMaxCalls: fromServer ? raw.service_max_calls : raw.serviceMaxCalls, serviceBudgetMicros: fromServer ? raw.service_budget_micros : raw.serviceBudgetMicros } : {};
  if (serviceFields.officialService && (!Number.isSafeInteger(serviceFields.serviceMaxCalls) || serviceFields.serviceMaxCalls < 0 || !Number.isSafeInteger(serviceFields.serviceBudgetMicros) || serviceFields.serviceBudgetMicros < 0)) throw new Error('官方商品规则格式无效');
  return { ...serviceFields, id: raw.id, name: raw.name, kind: raw.kind, state: raw.state, code_mask: raw.code_mask, quota_limited: raw.quota_limited, bound: raw.bound, ...Object.fromEntries(numbers.map(key => [key, raw[key]])) };
}

/** 官方权益只允许模型与数值统计，后端额外字段不能进入面板或执行配置。 */
export function serviceView(raw) {
  if (!raw || typeof raw.ready !== 'boolean' || !Array.isArray(raw.models) || raw.models.length < 1 || raw.models.length > 20 || raw.models.some(model => typeof model !== 'string' || !model || model.length > 128 || /[\x00-\x1f\x7f]/.test(model))) throw new Error('官方服务返回的模型格式无效');
  const fields = ['calls', 'success', 'failed', 'uncertain', 'unique_ips', 'input_tokens', 'output_tokens', 'cost_micros', 'held_micros'];
  const valid = value => Number.isSafeInteger(value) && value >= 0;
  if (!valid(raw.max_calls) || !valid(raw.budget_micros) || !raw.usage || fields.some(key => !valid(raw.usage[key]))) throw new Error('官方服务返回的额度格式无效');
  return { ready: raw.ready, models: [...raw.models], maxCalls: raw.max_calls, budgetMicros: raw.budget_micros, usage: Object.fromEntries(fields.map(key => [key, raw.usage[key]])) };
}

/** 只在后台创建；凭据留在受限扩展存储，不进入网页消息、任务记录或浏览器同步。 */
export function createLicenseClient({ storage = chrome.storage.local, permissions = chrome.permissions, fetcher = globalThis.fetch, protect = protectApiStorage, randomUUID = () => crypto.randomUUID() } = {}) {
  let mutation = Promise.resolve();
  function serialize(work) {
    const result = mutation.then(work);
    mutation = result.catch(() => {});
    return result;
  }
  async function saved() {
    await protect();
    return storage.get(['pluginLicenseServer', 'pluginLicenseSession', 'pluginLicenseDevice']);
  }
  function projection(data) {
    const session = data.pluginLicenseSession;
    return { server: data.pluginLicenseServer || PROJECT.officialService, license: session?.license ? licenseView(session.license) : null, checkedAt: session?.checkedAt || 0 };
  }
  async function request(server, path, { body, token } = {}) {
    const target = licenseServer(server);
    if (!await permissions.contains({ origins: [target.permission] })) throw new Error('请先允许访问授权服务，再进行兑换或核对');
    const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 15000);
    try {
      const response = await fetcher(target.server + '/api/v1/plugin-license/' + path, {
        method: body ? 'POST' : path === 'logout' ? 'POST' : 'GET',
        headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: 'Bearer ' + token } : {}) },
        ...(body ? { body: JSON.stringify(body) } : {}), signal: controller.signal, redirect: 'error', credentials: 'omit', cache: 'no-store', referrerPolicy: 'no-referrer',
      });
      if (!response.ok) {
        const hints = { 400: '卡密或安装身份格式不正确', 401: '卡密或授权凭据无效，请重新兑换', 403: '卡密已停用、到期或额度耗尽', 404: '授权接口不存在，请核对后台地址并升级后台', 409: '卡密已绑定其他安装实例，请联系管理员解绑', 429: '核验过于频繁，请稍后重试', 502: '官方服务调用或计费待核对，请联系发卡方' };
        throw new Error(hints[response.status] || '授权服务暂不可用，请稍后重试');
      }
      if (!response.headers.get('content-type')?.includes('application/json')) throw new Error('授权服务没有返回 JSON，请核对后台根地址');
      return await response.json();
    } catch (error) {
      if (error?.name === 'AbortError') throw new Error('授权服务响应超时；兑换结果可能已生效，可用同一卡密在本安装重试，不会重新扣费');
      if (error instanceof SyntaxError) throw new Error('授权服务返回无效 JSON，请联系管理员检查后台');
      if (error instanceof TypeError) throw new Error('无法连接授权服务，请检查 HTTPS、网络及后台是否运行');
      throw error;
    } finally { clearTimeout(timer); }
  }
  return {

    async service() {
      const data = await saved();
      if (!data.pluginLicenseSession?.token || !data.pluginLicenseServer) throw new Error('请先在官方服务卡密设置中兑换卡密');
      return serviceView(await request(data.pluginLicenseServer, 'service', { token: data.pluginLicenseSession.token }));
    },
    async credentials() {
      const before = await saved();
      if (!before.pluginLicenseSession?.token || !before.pluginLicenseServer) throw new Error('请先兑换官方服务卡密');
      const service = serviceView(await request(before.pluginLicenseServer, 'service', { token: before.pluginLicenseSession.token }));
      if (!service.ready) throw new Error('官方服务额度不足或仍有未决预占，请先核对用量');
      const after = await saved();
      if (after.pluginLicenseSession?.token !== before.pluginLicenseSession.token || after.pluginLicenseServer !== before.pluginLicenseServer) throw new Error('授权已发生变化，请重新开始任务');
      const { pluginServiceModel } = await storage.get(['pluginServiceModel']);
      const model = service.models.includes(pluginServiceModel) ? pluginServiceModel : service.models[0];
      return { config: { server: before.pluginLicenseServer, model, timeoutSeconds: 200, clientVersion: globalThis.chrome?.runtime?.getManifest?.().version || '0.7.0' }, key: before.pluginLicenseSession.token };
    },
    async settings() { return projection(await saved()); },
    redeem(server, code) { return serialize(async () => {
      const target = licenseServer(server);
      if (typeof code !== 'string' || code.length > 80 || !/^QM[A-Z2-7]{32}$/.test(code.trim().toUpperCase().replaceAll('-', ''))) throw new Error('请输入完整的 QM 开头卡密');
      const data = await saved();
      // 随机安装身份在首次联网前保存，失败重试和浏览器重启不会误占第二个安装名额。
      const device = data.pluginLicenseDevice || randomUUID();
      if (!data.pluginLicenseDevice) await storage.set({ pluginLicenseDevice: device });
      const response = await request(target.server, 'redeem', { body: { code: code.trim(), device_id: device } });
      if (typeof response.token !== 'string' || !/^qms_[A-Za-z0-9_-]{43}$/.test(response.token)) throw new Error('授权服务返回的会话格式不正确');
      const license = licenseView(response.license);
      await storage.set({ pluginLicenseServer: target.server, pluginLicenseSession: { token: response.token, license, checkedAt: Date.now() } });
      return projection(await saved());
    }); },
    refresh() { return serialize(async () => {
      const data = await saved(), session = data.pluginLicenseSession;
      if (!session?.token || !data.pluginLicenseServer) throw new Error('请先输入卡密兑换权益');
      const license = licenseView(await request(data.pluginLicenseServer, 'status', { token: session.token }));
      await storage.set({ pluginLicenseSession: { ...session, license, checkedAt: Date.now() } });
      return projection(await saved());
    }); },
    logout() { return serialize(async () => {
      const data = await saved();
      let revoked = true;
      if (data.pluginLicenseSession?.token && data.pluginLicenseServer) {
        try { await request(data.pluginLicenseServer, 'logout', { token: data.pluginLicenseSession.token }); }
        catch { revoked = false; }
      }
      await storage.remove('pluginLicenseSession');
      return { ...projection(await saved()), revoked };
    }); },
  };
}

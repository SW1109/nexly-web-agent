import { DEFAULT_API_CONFIG, validateApiConfig, storedApiConfig, validateApiKey } from './api-config.js';
import { encryptApiKey, decryptApiKey } from './api-vault.js';
let protectedStorage;
export function protectApiStorage() {
  return protectedStorage ||= Promise.all([
    chrome.storage.local.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' }),
    chrome.storage.session.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' })
  ]).catch(() => { protectedStorage = null; throw new Error('无法隔离扩展凭证存储，API 模式未启用'); });
}
let mutation = Promise.resolve();
function serializeMutation(work) {
  const result = mutation.then(work);
  mutation = result.catch(() => {});
  return result;
}
async function storage() {
  await protectApiStorage();
  // 旧版明文只迁到本次会话，不凭空替用户生成或保存口令；先迁移成功再删除旧副本。
  const { apiCredential: legacy, apiConfig } = await chrome.storage.local.get(['apiCredential', 'apiConfig']);
  if (legacy) {
    try {
      const { apiCredential: current } = await chrome.storage.session.get('apiCredential');
      let activeOrigin;
      try { activeOrigin = validateApiConfig(apiConfig, { requireModel: false }).origin; } catch {}
      const useLegacy = !current || (legacy.origin === activeOrigin && current.origin !== activeOrigin);
      await chrome.storage.session.set({ apiCredential: useLegacy ? legacy : current, apiLegacyMigrated: true });
      await chrome.storage.local.remove('apiCredential');
      await chrome.storage.local.set({ rememberApiKey: false });
    } catch { throw new Error('旧版明文密钥迁移失败，请重试或清除密钥；尚未开始 API 请求'); }
  }
}
async function credentialFor(config) {
  const { apiCredential } = await chrome.storage.session.get('apiCredential');
  return apiCredential?.origin === config.origin && typeof apiCredential.key === 'string' && apiCredential.key ? apiCredential : null;
}
async function readSettings() {
  const [{ apiConfig = DEFAULT_API_CONFIG, apiVault }, session] = await Promise.all([
    chrome.storage.local.get(['apiConfig', 'apiVault']), chrome.storage.session.get('apiLegacyMigrated')
  ]);
  let config = { ...DEFAULT_API_CONFIG }, hasKey = false;
  if (apiConfig.baseUrl) {
    const checked = validateApiConfig(apiConfig, { requireModel: false });
    config = storedApiConfig(checked); hasKey = Boolean(await credentialFor(checked));
  }
  return { config, hasKey, rememberKey: Boolean(apiVault), hasVault: Boolean(apiVault), locked: Boolean(apiVault) && !hasKey, legacyMigrated: session.apiLegacyMigrated === true };
}
async function credentials(rawConfig, key, options) {
  const config = validateApiConfig(rawConfig, options);
  const credential = key === undefined ? await credentialFor(config) : null;
  if (key === undefined && !credential) {
    const { apiVault } = await chrome.storage.local.get('apiVault');
    if (apiVault?.origin === config.origin) throw new Error('API Key 已加密锁定，请到设置中输入口令解锁');
  }
  return { config, key: validateApiKey(key === undefined ? credential?.key : key) };
}
export function apiSettings() { return serializeMutation(async () => { await storage(); return readSettings(); }); }
export function apiCredentials(rawConfig, key, options) { return serializeMutation(async () => { await storage(); return credentials(rawConfig, key, options); }); }
export function saveApiSettings(rawConfig, { key, rememberKey = false, password } = {}) {
  return serializeMutation(async () => {
    if (typeof rememberKey !== 'boolean') throw new Error('记住密钥选项必须为 true 或 false');
    await storage();
    const next = await credentials(rawConfig, key);
    const credential = { origin: next.config.origin, key: next.key };
    const keys = ['apiConfig', 'rememberApiKey', 'apiVault'];
    const [oldLocal, oldSession] = await Promise.all([chrome.storage.local.get(keys), chrome.storage.session.get(['apiCredential', 'apiLegacyMigrated'])]);
    const reuseVault = rememberKey && !password && key === undefined && oldLocal.apiVault?.origin === credential.origin;
    const vault = rememberKey ? (reuseVault ? oldLocal.apiVault : await encryptApiKey(credential.origin, credential.key, password)) : null;
    try {
      // 解锁后的 Key 仅驻留受隔离的会话存储；MV3 后台休眠不会要求反复输入口令。
      await chrome.storage.session.set({ apiCredential: credential });
      await chrome.storage.local.set({ apiConfig: storedApiConfig(next.config), rememberApiKey: rememberKey, ...(vault ? { apiVault: vault } : {}) });
      if (!vault) await chrome.storage.local.remove('apiVault');
      await chrome.storage.session.remove('apiLegacyMigrated');
    } catch {
      try {
        await chrome.storage.local.remove(keys); await chrome.storage.local.set(oldLocal);
        await chrome.storage.session.remove(['apiCredential', 'apiLegacyMigrated']); await chrome.storage.session.set(oldSession);
      } catch { throw new Error('API 设置保存失败且无法恢复，请重新配置或清除密钥'); }
      throw new Error('API 设置保存失败，已保留原配置，请重试');
    }
    return readSettings();
  });
}
export function unlockApiKey(password) {
  return serializeMutation(async () => {
    await storage();
    const { apiVault, apiConfig } = await chrome.storage.local.get(['apiVault', 'apiConfig']);
    if (!apiVault) throw new Error('没有已加密保存的 API Key，请重新配置');
    const config = validateApiConfig(apiConfig, { requireModel: false });
    if (apiVault.origin !== config.origin) throw new Error('密钥所属域名与保存的配置不一致，请重新配置');
    const key = validateApiKey(await decryptApiKey(apiVault, password));
    try { await chrome.storage.session.set({ apiCredential: { origin: config.origin, key } }); }
    catch { throw new Error('无法保存解锁会话，请重试'); }
    return readSettings();
  });
}
export function lockApiKey() {
  return serializeMutation(async () => {
    await storage();
    const { apiVault } = await chrome.storage.local.get('apiVault');
    if (!apiVault) throw new Error('会话密钥不能锁定，请使用清除密钥');
    await chrome.storage.session.remove('apiCredential');
    return readSettings();
  });
}
export function clearApiKey() {
  return serializeMutation(async () => {
    await protectApiStorage();
    await Promise.all([chrome.storage.local.remove(['apiCredential', 'apiVault']), chrome.storage.session.remove(['apiCredential', 'apiLegacyMigrated'])]);
    await chrome.storage.local.set({ rememberApiKey: false });
    return readSettings();
  });
}

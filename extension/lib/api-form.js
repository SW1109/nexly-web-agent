import { DEFAULT_API_CONFIG, API_TIMEOUT, apiEndpoints, validateApiConfig, validateApiKey } from './api-config.js';
import { VAULT_PASSWORD, validateVaultPassword } from './api-vault.js';
import { API_PROVIDERS, apiProvider } from './api-providers.js';
const $ = (id) => document.getElementById(id);
export function createApiForm({ command, onBusy, onChange, onSaved }) {
  let metadata = { config: { ...DEFAULT_API_CONFIG }, hasKey: false, rememberKey: false }, busy = false, probe = null;
  const ids = ['api-provider', 'api-url', 'api-key', 'api-model', 'api-protocol', 'api-timeout', 'remember-api-key', 'show-api-key', 'clear-api-key', 'api-fetch-models', 'api-test', 'api-password', 'api-password-confirm', 'unlock-api-key', 'lock-api-key'];
  $('api-timeout').min = API_TIMEOUT.min; $('api-timeout').max = API_TIMEOUT.max; $('api-timeout').step = 1;
  for (const id of ['api-password', 'api-password-confirm']) { $(id).minLength = VAULT_PASSWORD.min; $(id).maxLength = VAULT_PASSWORD.max; }
  $('api-provider').replaceChildren(...API_PROVIDERS.map((provider) => { const option = document.createElement('option'); option.value = provider.id; option.textContent = provider.name; return option; }));
  const fields = { baseUrl: 'api-url', model: 'api-model', timeoutSeconds: 'api-timeout', protocol: 'api-protocol', key: 'api-key', password: 'api-password', confirmation: 'api-password-confirm' };
  function status(message, error = false) { $('api-status').textContent = message; $('api-status').dataset.error = String(error); }
  function fieldError(field, message) {
    const id = fields[field], input = $(id);
    input.setAttribute('aria-invalid', 'true');
    if ($(`${id}-error`)) { $(`${id}-error`).textContent = message; $(`${id}-error`).hidden = false; }
    input.closest('details')?.setAttribute('open', '');
    input.focus(); throw new Error(message);
  }
  function clearErrors() {
    for (const id of Object.values(fields)) { $(id).removeAttribute('aria-invalid'); if ($(`${id}-error`)) $(`${id}-error`).hidden = true; }
  }
  function rawConfig() { return { baseUrl: $('api-url').value, model: $('api-model').value, protocol: $('api-protocol').value, timeoutSeconds: Number($('api-timeout').value) }; }
  function config(requireModel = true) {
    const raw = rawConfig();
    try { validateApiConfig(raw, { requireModel }); }
    catch (error) { fieldError(error.field || 'baseUrl', error.message); }
    return raw;
  }
  function sameOrigin() {
    try { return apiEndpoints($('api-url').value, $('api-protocol').value).origin === apiEndpoints(metadata.config.baseUrl, metadata.config.protocol).origin; } catch { return false; }
  }
  function savedKeyAvailable() { return metadata.hasKey && sameOrigin(); }
  function key() {
    if (!$('api-key').value && savedKeyAvailable()) return undefined;
    if (!$('api-key').value && metadata.locked && sameOrigin() && $('remember-api-key').checked) fieldError('password', 'API Key 已加密锁定，请先输入口令并点击“解锁密钥”');
    try { return validateApiKey($('api-key').value); } catch (error) { fieldError('key', error.message); }
  }
  function newVaultRequired() { return !metadata.hasVault || !sameOrigin() || Boolean($('api-key').value); }
  function password() {
    if (!$('remember-api-key').checked) return undefined;
    if (!newVaultRequired() && !$('api-password').value) return undefined;
    try { validateVaultPassword($('api-password').value); } catch (error) { fieldError('password', error.message); }
    if ($('api-password-confirm').value !== $('api-password').value) fieldError('confirmation', '两次口令不一致，请重新确认');
    return $('api-password').value;
  }
  function providerHint() {
    const provider = apiProvider($('api-provider').value);
    $('api-provider-hint').textContent = provider.hint;
    $('api-provider-docs').hidden = !provider.docs;
    if (provider.docs) $('api-provider-docs').href = provider.docs;
    else $('api-provider-docs').removeAttribute('href');
  }
  function detectProvider() {
    let endpoint;
    try { endpoint = apiEndpoints($('api-url').value, $('api-protocol').value).endpoint; } catch {}
    $('api-provider').value = API_PROVIDERS.find((provider) => provider.baseUrl && apiEndpoints(provider.baseUrl, 'chat').endpoint === endpoint)?.id || 'custom';
    providerHint();
  }
  function preview() {
    try { $('api-endpoint').textContent = apiEndpoints($('api-url').value, $('api-protocol').value).endpoint; }
    catch { $('api-endpoint').textContent = $('api-url').value ? '请检查地址和协议' : '填写调用地址后显示'; }
    $('api-key').placeholder = savedKeyAvailable() ? '已保存；留空沿用，输入新密钥可替换' : metadata.locked && sameOrigin() ? '密钥已锁定；可解锁或输入新密钥替换' : '请输入 API Key';
    $('clear-api-key').hidden = !metadata.hasKey && !metadata.hasVault && !$('api-key').value;
    $('api-vault').hidden = !$('remember-api-key').checked;
    $('unlock-api-key').hidden = !metadata.locked || !sameOrigin();
    $('lock-api-key').hidden = !metadata.hasVault || !metadata.hasKey;
    const unlocking = metadata.locked && sameOrigin() && !$('api-key').value;
    $('api-password-label').textContent = unlocking ? '解锁口令' : '加密口令';
    $('api-password-confirm-field').hidden = unlocking;
    $('api-vault-state').textContent = metadata.legacyMigrated ? '旧版明文密钥已转为本次会话保存并删除本机明文；需重新勾选并设置口令才能加密持久保存。' : metadata.locked ? '本机密钥已加密锁定，重启后需解锁。' : metadata.hasVault ? '本机仅保存密文，本次会话已解锁。加密不能防止解锁后的本机恶意程序。' : '仅会话保存；配置不云端同步。浏览器会话结束或扩展重载后需重新填写 Key。';
  }
  function conceal() { $('api-key').type = 'password'; $('show-api-key').textContent = '显示'; $('show-api-key').setAttribute('aria-pressed', 'false'); }
  function clearPasswords() { $('api-password').value = ''; $('api-password-confirm').value = ''; }
  function applyMetadata(next) {
    metadata = next;
    $('api-url').value = next.config.baseUrl; $('api-model').value = next.config.model; $('api-protocol').value = next.config.protocol; $('api-timeout').value = next.config.timeoutSeconds;
    $('remember-api-key').checked = next.rememberKey;
    $('api-key').value = ''; clearPasswords(); conceal(); detectProvider(); preview();
  }
  async function grant(raw) {
    // 必须由点击处理器同步走到 permissions.request，不能等异步保存后才申请权限。
    if (!await chrome.permissions.request({ origins: [apiEndpoints(raw.baseUrl, raw.protocol).permission] })) throw new Error('未授权 API 域名，尚未发送请求；请重新授权后再试');
  }
  async function save() {
    clearErrors();
    const raw = config(), nextKey = key(), rememberKey = $('remember-api-key').checked, nextPassword = password();
    await grant(raw);
    applyMetadata(await command('saveApiSettings', { config: raw, ...(nextKey === undefined ? {} : { key: nextKey }), rememberKey, ...(nextPassword === undefined ? {} : { password: nextPassword }) }));
    onSaved({ mode: 'api', ready: true, ...metadata });
  }
  async function runProbe(action) {
    if (busy) return;
    clearErrors();
    let current;
    try {
      const raw = config(action === 'apiTest'), nextKey = key(), permission = grant(raw);
      current = { id: crypto.randomUUID(), canceled: false, sent: false }; probe = current; busy = true; onBusy(true);
      $('api-cancel').hidden = false;
      status(action === 'apiModels' ? '正在获取模型列表…' : '正在发送固定测试题，请稍候…');
      await permission;
      if (current.canceled) throw new Error('已取消，未发送请求。');
      current.sent = true;
      const result = await command(action, { config: raw, ...(nextKey === undefined ? {} : { key: nextKey }), probeId: current.id });
      if (current.canceled) return;
      if (action === 'apiModels') {
        $('api-models').replaceChildren(...result.models.map((model) => { const option = document.createElement('option'); option.value = model; return option; }));
        status(`已获取 ${result.models.length} 个模型，请在模型输入框中选择或手填；尚未测试生成。`);
      } else { status(`连接测试通过 · ${result.model}。保存设置后用于练习。`); }
    } catch (error) { status(error.message, true); }
    finally { if (probe === current) { probe = null; busy = false; $('api-cancel').hidden = true; onBusy(false); } }
  }
  for (const id of ['api-url', 'api-key', 'api-model', 'api-protocol', 'api-timeout', 'remember-api-key', 'api-password', 'api-password-confirm']) $(id).addEventListener('input', () => {
    clearErrors();
    if (['api-url', 'api-key', 'api-protocol'].includes(id)) $('api-models').replaceChildren();
    if (['api-url', 'api-protocol'].includes(id)) detectProvider();
    preview(); status('连接配置已更改，请保存；需要时重新测试。'); onChange();
  });
  $('api-provider').addEventListener('change', () => {
    const provider = apiProvider($('api-provider').value);
    if (provider.baseUrl) { $('api-url').value = provider.baseUrl; $('api-protocol').value = 'chat'; }
    // 换服务商必须重新核对凭证和模型，绝不携带尚未保存的 Key 到另一个域名。
    $('api-key').value = ''; $('api-model').value = ''; $('api-models').replaceChildren(); clearPasswords(); conceal();
    clearErrors(); providerHint(); preview(); status('已选择预设，请核对地址、凭证和模型后保存。尚未发送请求。'); onChange();
  });
  $('show-api-key').addEventListener('click', () => {
    const reveal = $('api-key').type === 'password'; $('api-key').type = reveal ? 'text' : 'password'; $('show-api-key').textContent = reveal ? '隐藏' : '显示'; $('show-api-key').setAttribute('aria-pressed', String(reveal));
  });
  async function mutateKey(action) {
    if (busy) return;
    clearErrors();
    let nextPassword;
    try { if (action === 'unlockApiKey') { nextPassword = $('api-password').value; try { validateVaultPassword(nextPassword); } catch (error) { fieldError('password', error.message); } } }
    catch (error) { status(error.message, true); return; }
    busy = true; onBusy(true);
    try {
      metadata = await command(action, nextPassword === undefined ? {} : { password: nextPassword });
      $('api-key').value = ''; clearPasswords(); conceal(); $('remember-api-key').checked = metadata.rememberKey; preview();
      const message = action === 'unlockApiKey' ? '密钥已解锁，仅本次浏览器会话有效。' : action === 'lockApiKey' ? '密钥已锁定。' : '已清除会话密钥和本机密文，请重新填写。';
      status(message); onSaved({ mode: 'api', ready: metadata.hasKey && Boolean(metadata.config.model), ...metadata });
    } catch (error) {
      status(error.message, true);
      if (action === 'unlockApiKey') { clearPasswords(); try { fieldError('password', error.message); } catch {} }
    } finally { busy = false; onBusy(false); }
  }
  $('clear-api-key').addEventListener('click', () => mutateKey('clearApiKey'));
  $('unlock-api-key').addEventListener('click', () => mutateKey('unlockApiKey'));
  $('lock-api-key').addEventListener('click', () => mutateKey('lockApiKey'));
  $('api-fetch-models').addEventListener('click', () => runProbe('apiModels'));
  $('api-test').addEventListener('click', () => runProbe('apiTest'));
  $('api-cancel').addEventListener('click', async () => {
    if (!probe) return;
    probe.canceled = true; status('已取消接收；若服务端已受理，仍可能计费用量。');
    if (probe.sent) { try { await command('apiCancel', { probeId: probe.id }); } catch (error) { status(error.message, true); } }
  });
  return {
    async load() { applyMetadata(await command('apiSettings')); }, save,
    setDisabled(disabled) { for (const id of ids) $(id).disabled = disabled; if (disabled) conceal(); },
    get summary() { return $('api-model').value.trim() || '未选择模型'; }
  };
}

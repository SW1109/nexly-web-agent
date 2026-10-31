import { PROJECT } from './project-info.js';
import { licenseServer } from './license-client.js';

/** 可选官方权益入口：不修改连接模式，不发送题目，不持有后台授权会话。 */
export function createLicenseForm({ command }) {
  const $ = id => document.getElementById(id);
  const labels = { time: '有效期卡', quota: '纯额度卡', hybrid: '额度＋有效期卡' };
  const states = { new: '未激活', active: '使用中', disabled: '已停用', expired: '已到期', exhausted: '额度耗尽' };
  let busy = false;
  function status(text, error = false) {
    $('license-status').textContent = text;
    $('license-status').dataset.error = String(error);
  }
  function render(data) {
    $('license-server').value = data.server || PROJECT.officialService;
    const license = data.license;
    $('license-rights').hidden = !license;
    $('license-refresh').disabled = busy || !license;
    $('license-logout').disabled = busy || !license;
    if (!license) return;
    $('license-name').textContent = license.name;
    $('license-kind').textContent = `${labels[license.kind]} · ${states[license.state]} · ${license.code_mask}`;
    $('license-quota').textContent = license.officialService ? `官方商品：${license.serviceMaxCalls || "不限"} 次 · ${license.serviceBudgetMicros ? "$" + license.serviceBudgetMicros / 1e6 : "不按金额限额"}；点击下方核对实际用量` : license.quota_limited ? `剩余 ${license.remaining} / ${license.quota_total} 服务单位` : '按有效期使用，无预设总额度';
    $('license-expiry').textContent = license.expires_at ? `到期时间：${new Date(license.expires_at * 1000).toLocaleString('zh-CN')}` : '不设到期日，服务额度用完后停止';
    $('license-checked').textContent = `上次核对：${new Date(data.checkedAt).toLocaleString('zh-CN')}。此处展示最近结果，实际资格由服务端核验。`;
  }
  async function operate(work) {
    if (busy) return;
    busy = true;
    for (const id of ['license-redeem', 'license-refresh', 'license-logout', 'license-server', 'license-code', 'license-service-check', 'license-model']) $(id).disabled = true;
    status('正在处理授权…');
    try { await work(); }
    catch (error) { status(error.message || '授权操作失败，请稍后重试', true); }
    finally {
      busy = false;
      for (const id of ['license-redeem', 'license-server', 'license-code', 'license-service-check', 'license-model']) $(id).disabled = false;
      const active = !$('license-rights').hidden;
      $('license-refresh').disabled = !active; $('license-logout').disabled = !active;
    }
  }
  $('license-redeem').addEventListener('click', () => {
    // 权限请求必须直接来自用户点击，不在后台或初始化时自动扩大站点权限。
    let target, permission;
    try {
      $('license-server').setCustomValidity(''); $('license-code').setCustomValidity('');
      if (!$('license-server').reportValidity() || !$('license-code').reportValidity()) return;
      target = licenseServer($('license-server').value);
      permission = chrome.permissions.request({ origins: [target.permission] });
    } catch (error) { status(error.message, true); return; }
    const code = $('license-code').value;
    void operate(async () => {
      if (!await permission) throw new Error('未允许访问授权服务，尚未兑换');
      render(await command('licenseRedeem', { server: target.server, code }));
      $('license-code').value = '';
      status('权益已兑换并保存。可在使用方式中选择“官方服务”，核对模型和额度后使用。');
    });
  });
  $('license-refresh').addEventListener('click', () => { void operate(async () => { render(await command('licenseRefresh')); status('已从服务端重新核对权益。'); }); });
  $('license-logout').addEventListener('click', () => { void operate(async () => { const data = await command('licenseLogout'); render(data); $('license-model').replaceChildren(); $('license-service-usage').textContent = ''; status(data.revoked ? '已退出授权。有效期和额度不会重置。' : '已清除本机授权；网络异常，服务器会话未确认撤销，可在后台解绑。'); }); });
  $('license-service-check').addEventListener('click', () => { void operate(async () => {
    const data = await command('licenseService');
    const { pluginServiceModel } = await chrome.storage.local.get('pluginServiceModel');
    $('license-model').replaceChildren(...data.models.map(model => { const option = document.createElement('option'); option.value = model; option.textContent = model; return option; }));
    $('license-model').value = data.models.includes(pluginServiceModel) ? pluginServiceModel : data.models[0];
    await chrome.storage.local.set({ pluginServiceModel: $('license-model').value });
    const usage = data.usage;
    $('license-service-usage').textContent = `成功 ${usage.success} 次${data.maxCalls ? ' / 上限 ' + data.maxCalls + ' 次' : ' / 不限次数'}；站内计费 $${usage.cost_micros / 1e6}${data.budgetMicros ? ' / 额度 $' + data.budgetMicros / 1e6 : ''}；未决预占 $${usage.held_micros / 1e6}。`;
    status(data.ready ? '服务模型与额度已核对。' : '额度不足或存在未决预占，请联系发卡方核对。', !data.ready);
  }); });
  $('license-model').addEventListener('change', () => { void chrome.storage.local.set({ pluginServiceModel: $('license-model').value }); });
  return {
    async load() { try { render(await command('licenseSettings')); } catch (error) { status(error.message, true); } },
  };
}

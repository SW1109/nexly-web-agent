// 公开入口集中维护；仓库名与历史 Native Host 标识保留，避免品牌更新破坏已有安装。
export const PROJECT = Object.freeze({
  officialService: 'https://xianyu.guangnian.xin',
  repository: 'https://github.com/SW1109/nexly-web-agent',
  bugs: 'https://github.com/SW1109/nexly-web-agent/issues/new?template=bug_report.yml',
  feedback: 'https://github.com/SW1109/nexly-web-agent/issues',
  security: 'https://github.com/SW1109/nexly-web-agent/security/advisories/new'
});
export const DATA_CONSENT_VERSION = 1;
export async function requireDataConsent() {
  const { dataConsentVersion } = await chrome.storage.local.get('dataConsentVersion');
  if (dataConsentVersion !== DATA_CONSENT_VERSION) throw new Error('请先打开侧栏，阅读并确认数据使用说明；尚未发送题目给 AI');
}
// 由打包脚本在存在真实收款码时填写；没有素材时不显示图片或虚假收款链接。
export const SUPPORT_IMAGE = 'assets/wechat-support.jpg';

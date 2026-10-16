# 安全反馈

QuizMate 会调用本机 CLI 或用户配置的中转站 API，并处理练习页内容。API Key 默认仅保存在受隔离的浏览器会话存储。可选口令加密本机保存（AES-GCM-256、PBKDF2-SHA256 600,000 次、独立随机 salt/IV、绑定 origin），持久层仅存密文，不存口令或派生密钥；重启后需解锁，忘记口令不可恢复。解锁 Key 仅存在会话存储中，并非系统钥匙串；本机恶意程序或恶意扩展更新仍可读取已解锁数据。旧版明文只迁为本次会话保存，迁移成功后删除。题目仍会发送到用户指定的服务商；推广链接不自动接入或发送数据。请勿上传真实密钥、口令或密文。如果发现本地命令执行边界、Native Messaging 来源验证、凭证泄露或其他安全问题，请使用 [GitHub 私密漏洞报告](https://github.com/SW1109/nexly-web-agent/security/advisories/new)。

请提供受影响版本、最小复现步骤、影响范围和已脱敏的日志。不要在公开 Issue 或 Pull Request 中放出可利用细节、真实凭证、加密口令、密文或个人数据。

普通安装、兼容和使用问题请提交 [Bug Issue](https://github.com/SW1109/nexly-web-agent/issues/new?template=bug_report.yml)。

首次发送练习数据前要求明确同意；可在设置撤回。站点与 API 域名权限按需授权，不预授全部网站。商店包不含开发 key，Native Host 只允许显式配置的 32 位扩展 ID；不要使用通配来源。详见 [隐私说明](docs/PRIVACY.md)。

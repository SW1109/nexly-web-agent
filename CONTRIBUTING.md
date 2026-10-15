# 参与贡献

## 报告 Bug

请先搜索已有 [Issues](https://github.com/SW1109/nexly-web-agent/issues)，再使用 [Bug 反馈表单](https://github.com/SW1109/nexly-web-agent/issues/new?template=bug_report.yml)。提供版本、最小复现步骤、预期与实际行为，以及脱敏日志或截图。

公开反馈中不要包含密钥、登录令牌、Cookie、完整 CLI 配置、个人路径或受限题目数据。安全问题请参阅 [SECURITY.md](SECURITY.md)。

## 提交代码

1. Fork 仓库并创建独立分支，修改范围保持聚焦。
2. 使用 Node.js 22+；项目无 npm 依赖，不需要安装第三方包。
3. 修改业务逻辑时补充相关回归测试，保留人工提交与平台规则边界。
4. 执行以下检查后提交 Pull Request，说明改动、复现方式和实际验证范围：

```bash
npm run check
npm test
npm run build
```

自动化测试使用模拟 CLI，不需要登录模型服务。真实 CLI / 浏览器练习页面的验收需要贡献者自行配置，可能消耗账号额度；不要将其放入普通 CI。

## 维护约束

- 不修改 `extension/manifest.json` 的公开 `key`，避免扩展 ID 与本地桥允许来源不一致。
- 不提交 `dist/`、本地 CLI 配置、鉴权数据或临时运行产物。
- 不自动提交答案或交卷，不添加绕过页面计时、焦点统计、禁用状态等平台规则的实现。
- 模拟测试通过不代表真实网站兼容；请明确说明未验证的边界。

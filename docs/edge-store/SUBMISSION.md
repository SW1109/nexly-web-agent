# Edge Add-ons 提交包与发布清单

准备日期：2026-10-16。**这是一套可重建的提交材料，不代表已经上架、审核通过或完成真实 Edge/Windows 验收。**

## 产物

```sh
npm run check
npm test
npm run build        # 开发版：保留固定 key，不能当商店发布包
npm run build:edge   # 商店包：移除开发 key / update_url
npm run pack:edge    # 在已有商店包基础上，归档上架材料与校验值
```

- `dist/quizmate-edge-v0.4.0.zip`：**仅上传此扩展 ZIP**，manifest.json 位于根目录，不含源码仓库顶层、测试、CLI 桥、文档或本机数据。
- 同名 `.sha256`：本地校验值，不用上传成扩展。
- `dist/quizmate-edge-materials-v0.4.0.zip`：本文件、描述、权限说明、审核备注、操作手册、隐私文本、实际界面截图与现有 Logo，供手工填报，不是扩展包。
- 开发包 `quizmate-development-v0.4.0.zip` 与固定开发 ID 在 `dist/extension-id.txt`，不要混淆。

商店扩展 ID 以控制台和安装后的管理页为准，不能用开发 ID 冒充。API 不依赖 ID；Native Host 安装时要指定实际 ID。

## 控制台需填写

1. 实际发布者账号、名称、联系渠道、市场/年龄与类别信息。
2. [商店描述](LISTING.zh-CN.md)，与包内名称/描述/功能一致。
3. 单一用途、[权限与数据披露](PERMISSIONS.md)，不能声称完全不传输数据。
4. 可公开访问且内容准确的隐私政策 URL；仓库的 [PRIVACY.md](../PRIVACY.md) 和包内帮助页已提供正文，但发布者须自行发布并测试公网 URL 后填写。
5. [审核测试备注](REVIEWER_NOTES.md)，补充可用审核凭证/配额或与审核方明确可测试方式；不要公开 Key。
6. Logo 与截图。官方要求：Logo 1:1，建议 300×300、最低 128×128；最多 6 张截图，640×480 或 1280×800；可选小宣传图 440×280，大宣传图 1400×560。当前复用真实 128×128 Logo，并提供 1280×800 实际扩展页面截图；不附伪造演示/通过成绩，宣传图为可选未提供。
7. 内容/素材使用权、第三方费用、推广与赞助如实说明，不宣称平台官方或考试保证。

## 当前未具备 / 发布前必须确认

- [ ] 实际发布者账号与可公开联系方式由持有人确认。
- [ ] 发布隐私说明、操作手册、Issue 模板等新文件，使仓库链接可访问；本次未自动 commit / push。
- [ ] 公网隐私政策 URL 实测通过；不要填“待部署”或不存在的链接。
- [ ] 可用的私密审核 API/CLI 测试条件与必要额度。
- [ ] 在当前桌面 Edge 实测侧栏、API Worker、关闭侧栏继续/取消、域名授权；Windows/macOS 的 Edge Native Host 实机测试。支持代码或路径测试不替代实机验收。
- [ ] 确认当前 Logo、项目代码的版权/授权；仓库未选择 LICENSE 时由维护者决定，不默认授予某种许可。
- [x] 已接入维护者提供的微信收款原图 `extension/assets/wechat-support.jpg`，保留收款人信息与原图查看入口；未验证付款到账，不记录交易。
- [ ] 生成本次最终包后核对 SHA-256、版本与待上传 ZIP，版本变更应同步 package / lock / manifest / 相关文案。

## 赞助与推广

收款码不能由 AI 伪造；由维护者提供并确认使用权。赞助完全自愿，不换取功能、正确率或通过考试。帮助页不记录支付，用户通过微信确认收款人和金额。推广仅为有标签的可选第三方链接，不默认接入。是否符合最终商店政策由实际审核决定，不能保证带赞助入口必然通过。

## 官方依据（2026-10-16 查阅）

- 发布流程、隐私与素材规格：https://learn.microsoft.com/en-us/microsoft-edge/extensions/publish/publish-extension
- 开发者政策：https://learn.microsoft.com/en-us/legal/microsoft-edge/extensions/developer-policies
- Native Messaging 的 ID / macOS / Linux / Windows 路径：https://learn.microsoft.com/en-us/microsoft-edge/extensions/developer-guide/native-messaging
- API 支持表（sidePanel / offscreen）：https://learn.microsoft.com/en-us/microsoft-edge/extensions/developer-guide/api-support

上架前以当时控制台和政策为准；不能以材料生成日期代替审核结论。


## 本次本地验证记录

- 语法 / Manifest / 本地资源引用检查通过，`git diff --check` 通过。
- 启用真实 Chromium 扩展回归后：131 项测试，126 通过、5 项 Windows 专项跳过，无失败。
- 真正的隔离 macOS 临时 HOME 安装/更新 ID/卸载测试通过，Chrome 与 Edge 文件互不覆盖；没有写入用户实际浏览器注册。
- 真实扩展 API Worker、本机模拟 API 两种协议、关闭侧栏继续/取消、会话隔离与重启加密解锁通过；不代表真实服务商验收。
- 同标签编程题执行回归通过：使用 CodeMirror 5 API 模拟夹具覆盖临时只读与加载遮罩，TS2737 本次编译日志及失败代码会进入修正请求，恢复后重新执行并等待人工提交；人工改码、编辑器文档更换、多编辑器及旧日志仍被拦截。手动执行失败不再滞留等待状态，可安全重试。这不是华为页面或真实 CodeMirror 库的兼容性验收。
- 320 / 400 / 768 / 1280 / 1920 / 2560px × 深浅色，检查头部、连接状态条、导航与主体的居中及横向溢出，全部通过。
- 微信原图字节与维护者附件相同，浏览器显示比例正确，原图入口可用；未发起付款或验证到账。
- Edge ZIP 根 Manifest、无开发 key、无默认站点权限、无测试/CLI 桥/私人路径/凭证检查通过；校验值在 ZIP 同名 `.sha256` 和材料 `PACKAGE.json` 中。

这些是本地验证，不是 Edge/Windows 实机或商店认证结论。发布者仍需完成上方未勾选项。

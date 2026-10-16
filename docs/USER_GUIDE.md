# QuizMate · 智答伴侣操作手册

适用版本：0.4.0。Chrome / Edge 的开发安装与商店安装流程不同；只有 API 模式不需要 Node.js / CLI。本手册也随扩展离线提供：面板 → 操作手册。

## 1. 安装与连接

### API 模式（无本地 CLI）

1. 开发包：解压 `quizmate-development-v0.4.0.zip` 到固定位置，在 `chrome://extensions` / `edge://extensions` 打开开发者模式并加载解压后的目录。商店版正式发布后从商店安装，不用此步骤；当前不提供虚构商店链接。
2. 点击工具栏的 QuizMate，阅读并确认数据说明。AI 会收到练习数据，请仅在允许辅助工具的练习中使用。
3. 设置 → 模型连接 → API 模式。选择预设或自定义可信服务商，填写基础地址/完整接口地址、Key 与模型 ID，保存并授权该 API 域名。
4. 可“获取模型”或“测试连接”；模型列表不代表模型可调用，连接测试可能消耗额度。支持 OpenAI 兼容 Chat Completions / Responses，不支持原生 Anthropic / Gemini 接口；公网 HTTPS，HTTP 仅本机。
5. Key 默认仅在浏览器本次会话中保存。不勾选加密保存时，重启需重新输入；勾选后设置独立口令，重启需解锁。忘记口令只能清除 Key 后重新配置，不可找回。

### 本地 CLI 模式

自行安装并登录 Codex、Claude Code、Gemini、Qwen Code 或 Kimi CLI。CLI 自身的订阅、路由与权限由其配置决定；扩展不会代为登录或提供额度。安装 Node.js 22+ 后从项目目录运行：

```sh
# Chrome 开发版，默认使用 manifest.key 推导的固定开发 ID
node scripts/setup.mjs

# Edge：将示例文字替换为 edge://extensions 显示的真实 32 位扩展 ID
node scripts/setup.mjs --browser edge --extension-id 你的32位扩展ID
```

Windows 使用同样的 Node 命令，无需管理员权限。macOS / Linux 可先用 `bash scripts/setup.sh` 寻找已安装的新 Node，再按需单独运行 Edge 安装命令。API 用户不用运行以上命令。

只查看预期安装位置，不改电脑：

```sh
node scripts/install-native.mjs --browser edge --extension-id 你的32位扩展ID --dry-run
```

商店分配的 ID 不一定等于开发版 ID。安装 CLI 桥时必须使用**当前安装版本**的真实 ID；Chrome 和 Edge 分开注册与卸载。更换项目目录或 Node 路径后重新安装。桥保留历史主机名 `com.nexly.web_agent` 与 `~/.nexly-web-agent/config.json`，避免破坏旧配置，不代表品牌回退。

## 2. 读取与作答

1. 选中练习页，点击“重新读取”，核对题目、题型、编辑器。按需“授权本站”以读取跨域 iframe / 自动显示页内组件。只在可信站点授予权限。
2. “仅预览答案”只展示结果。“开始答题”在模型自报置信度 ≥80% 时按设置填写并回读核对；置信度不保证正确。
3. 普通题支持有限批次（1～20）连续练习，通过“下一题 / 随机一题”等换题入口继续；题目变更时旧输入停止。
4. 编程题必须先定位唯一可写编辑器；多个编辑器、不明确或未加载时停止，不猜测、不新建空编辑器。
5. 可开启“填写后执行页面样例”。本次执行失败后将当前代码与可见日志交给 AI，最多额外修正 2 次；人工编辑、切题、停止、低置信度或同代码时不盲目覆盖/循环。
6. 编程题无论运行通过还是无法验证，都停留等待人工提交代码并换题；扩展不自动提交代码、交卷或绕过网站限制。

## 3. 设置、暂停与清理

- 设置集中管理连接方式、连续题数、后台运行、填写/点击间隔、逐字输入、页内图标透明度及位置。
- 页内组件默认图标，悬浮或键盘聚焦后展开，可拖动；Alt + 方向键微调，Esc 收起。
- 默认快捷键 Alt + Shift + N 开始/暂停/继续，可在浏览器扩展快捷键管理中修改。
- 任务绑定启动时的标签页；切换标签不改目标。不要在禁止 AI 辅助的考试中使用，也不依靠扩展规避切屏检测。
- 暂停/停止立即阻止后续输入，已填写内容不自动撤销。取消不能保证远端未计费。
- 面板“清除练习记录”清除本次会话的题目、答案和最多 60 条日志；不清除配置和网页内容。
- 设置可清除/锁定 Key、撤回数据使用同意；撤回后重新确认才能求解。浏览器扩展管理可撤回站点权限或卸载。服务商日志需单独向服务商处理。

## 4. 常见问题

| 问题 | 检查 |
|---|---|
| API 401/403 | Key、模型权限、订阅与调用地址；切换服务商域名后重新输入 Key |
| API 404/协议不符 | 使用 OpenAI 兼容路径；完整接口地址需匹配所选协议 |
| 429/超时 | 额度、频率与网络；确认服务商用量后手动重试，避免重复收费 |
| 本地桥断开 | Node 22+、CLI 可用、浏览器与 ID 匹配、项目未移动，运行 `node scripts/doctor.mjs` |
| 无法识别 iframe | 通过“授权本站”授权所需的题目域名，等待题目加载后重读 |
| 无法写入代码 | 关闭无关编辑器、等待初始化、核对题目；页面禁止编辑时人工处理 |
| 口令忘记 | 无法恢复，清除后重新配置 Key；不要上传密文求助 |

## 5. 反馈与自愿赞助

- 项目：https://github.com/SW1109/nexly-web-agent
- Bug：https://github.com/SW1109/nexly-web-agent/issues/new?template=bug_report.yml
- 建议：https://github.com/SW1109/nexly-web-agent/issues（发布新模板后可在 New issue 选择“功能建议”）
- 安全漏洞：https://github.com/SW1109/nexly-web-agent/security/advisories/new

附版本、系统/浏览器、复现步骤与脱敏截图。不要公开 Key、口令、Cookie、个人路径、私有题目或账号。

赞助入口在帮助页；已接入维护者提供的真实收款 JPG：`extension/assets/wechat-support.jpg`；更换图片后重新构建。没有图片时明确显示未开放，不生成假的收款码。赞助自愿，不解锁功能、无自动扣款，不统计交易；扫码后由用户核对微信收款人和金额。

## 6. 卸载本地桥

```sh
node scripts/uninstall-native.mjs
# Edge 商店版需指定当初安装的相同 ID
node scripts/uninstall-native.mjs --browser edge --extension-id 你的32位扩展ID
```

安装记录或来源不匹配时拒绝删除。不会卸载 CLI / ccSwitch / 项目源码，保留自定义 `config.json`。扩展本身请在浏览器扩展管理中移除。

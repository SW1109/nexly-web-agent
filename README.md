# QuizMate · 智答伴侣 0.4.0

Chrome 侧栏练习助手，支持两种连接方式：**本地模式**通过 Native Messaging 调用 Codex CLI、Claude Code CLI、Gemini CLI、Qwen Code 或 Kimi CLI，沿用 CLI 登录与 ccSwitch 配置；**API 模式**直接使用你配置的官方 API 或 OpenAI 兼容中转站，不需要 CLI、Node.js 或本地桥。项目不提供本地 HTTP 命令执行接口。本项目是可加载的源码扩展，并非 ChatGPT 官方扩展，也未复制其私有鉴权或服务。


[操作手册](docs/USER_GUIDE.md) · [隐私说明](docs/PRIVACY.md) · [Edge 上架材料](docs/edge-store/SUBMISSION.md) · [反馈 Bug](https://github.com/SW1109/nexly-web-agent/issues/new?template=bug_report.yml) · [查看 Issues](https://github.com/SW1109/nexly-web-agent/issues) · [参与贡献](CONTRIBUTING.md)

仅用于允许使用辅助工具的学习和练习场景，请遵守目标网站规则。不会自动提交代码或交卷，也不会规避切屏、倒计时、禁用按钮等平台限制。

## 安装与启动

### API 模式（不安装 CLI）

要求：Chrome 120+，服务商提供的 OpenAI 兼容调用地址、API Key 和可用模型 ID。

1. 获取维护者提供的 `quizmate-development-v0.4.0.zip`（本次开发构建位于 `dist/`，尚未上传 GitHub Release），解压到固定目录。安装预构建包不需要 Node.js。
2. 在 `chrome://extensions` 开启开发者模式，选择“加载已解压的扩展程序”，选中含 `manifest.json` 的解压目录。Windows 与 macOS 操作相同。
3. 打开 QuizMate，阅读并确认首次数据使用说明，再进入设置 → 使用方式选择 **API 模式**，选择厂商预设或自定义调用地址，填写 API Key，手填模型 ID 或点击“获取模型”。
4. 核对“最终请求地址”。可用“测试连接”发送固定测试题（会产生少量用量，不读取练习页），然后保存设置并授权该中转站域名。
5. 在允许使用辅助工具的练习页重新读取或开始答题。最终提交仍由你操作。

从源码自行生成安装包才需要 Node.js 22+：运行 `npm run build`，产物为 `dist/extension/` 和 `dist/quizmate-development-v0.4.0.zip`。

### 本地模式（沿用 CLI / ccSwitch）

要求：Chrome 120+、Node.js 22+，以及至少一个已在终端配置成功的 CLI。安装脚本支持 Windows / macOS / Linux（Google Chrome）。旧用户升级仍默认使用本地模式，保留已有 CLI、节奏和外观配置。

首次使用先下载源码，再运行安装脚本：

```bash
git clone https://github.com/SW1109/nexly-web-agent.git
cd nexly-web-agent
node scripts/setup.mjs
```

Windows 在 PowerShell 中运行上述命令即可，无需 WSL 或 Git Bash。也可运行 `npm.cmd run setup`。macOS / Linux 如需自动寻找已经安装的 Node.js 22+，可继续使用 `bash scripts/setup.sh`。

安装流程会检查 Node.js 22+、检查代码、生成扩展、注册本项目的 Native Messaging 主机并检查 CLI。不会安装依赖、改默认 Node、修改 ccSwitch 或替换 CLI 的登录配置。项目本身没有 npm 依赖，无需 `npm install`。

Windows 将启动器和主机清单写入 `%USERPROFILE%\.nexly-web-agent`，并在当前用户的 `HKCU\Software\Google\Chrome\NativeMessagingHosts` 注册本项目，无需管理员权限。CLI 支持原生 `.exe` 和标准 npm Node.js `.cmd` / `.bat` 启动器；自定义批处理请改用实际可执行文件。安装器和卸载器遇到不同来源的同名注册时会停止，保留原配置。

然后在 Chrome 地址栏输入 `chrome://extensions`：

1. 开启「开发者模式」。
2. 点击「加载已解压的扩展程序」。
3. 选择本项目的 `dist/extension` 文件夹。
4. 打开练习页面，首次使用先确认数据说明，再点击 QuizMate 工具栏图标，侧栏右上角「设置」中点击「刷新连接」。

扩展固定 ID：`hbgbhhljnmlognjblnchioheiclcopel`。来自 manifest 的公开 key，仅用于稳定本地扩展 ID；没有把签名私钥放入项目。不要改 key，否则需要重新生成 Native Messaging 的允许来源。

默认仅授权 `https://developer.huawei.com/*`。练习内容在跨域 iframe 或其他站点时，点击「授权本站」，Chrome 会展示实际请求的站点权限。扩展不申请 cookies、debugger 或历史记录权限。

## 升级 0.4.0

成品目录为 `dist/extension`。更新构建后，在 `chrome://extensions` 刷新 QuizMate，确认版本显示 **0.4.0**，然后关闭旧侧栏再重新打开。扩展 ID 未变，无需重新注册本地桥。使用新增 Qwen / Kimi CLI 时须同步更新项目中的 `bridge/` 源码；只有扩展 ZIP 不包含本地桥。旧页内面板如提示连接失效，可用快捷键或侧栏重新启用。

## 使用

- **统一设置入口**：右上角“设置”集中管理连接方式、CLI / API、批量、后台运行、样例执行、操作节奏和组件外观。保存或返回练习时生效；任务选项用于下一次任务，外观与页内组件开关即时同步。
- **页内悬浮组件**：默认在练习页加载时自动注入，不需要先打开侧栏（避免为此多一次切屏）；只在已授权（`host_permissions` 或你手动授权过）的练习站点生效，读取不到题目就静默跳过，不影响普通网页。设置里的“打开练习页时自动启用页内组件”可关闭：关闭后立即移除已注入的组件，新打开的练习页也不再注入；侧栏的“启用页内组件”始终可以手动补注入。组件默认只显示原 Logo，鼠标悬浮展开、离开收起。拖动图标或标题栏移动，位置按视口比例保存并限制在可见区域。显示不透明度默认 90%，支持 40%～100%，展开时恢复清晰显示。设置中可重置到右下角；键盘聚焦展开、Esc 收起、Alt + 方向键微调。
- **换题与编辑器加载修复**：只读取站点已经初始化的 Ace / Monaco / CodeMirror 实例，不调用会创建空编辑器的 `ace.edit()`，不使用与 DOM 无绑定的 Monaco 全局模型。排除隐藏标签、隐藏 iframe 和只读预览；切换题目后单次点击，最多等待 30 秒，题干、编辑器实例和模板稳定后继续。仍有多个活动可写区域时停止而不猜测。
- **输入保护**：不再先清空模板再等待首字符；输入期间更换编辑器实例或代码文件会停止旧输入，避免写入新题。网页已被旧版创建的空实例污染时，需要刷新练习页让网站重新初始化。

- **重新读取**：检查题干、题型、选项、编程语言与编辑器状态。
- **仅预览答案**：调用所选 CLI 或 API 模型，展示答案和简要说明；即使置信度为 100% 也不写网页，侧栏会明确显示仅预览。
- **开始答题**：默认在置信度达到 80% 后自动填写，并回读核对；100% 答案直接进入填写流程。低置信度停在预览阶段，可人工复核后点击填写。
- **编程题人工提交**：填写完成（启用样例执行时为执行成功）后进入“等待人工提交并换题”，不自动翻题。人工提交和切换到新题后自动开始下一批，即使每批为 1 题也能跟随。手动暂停时必须明确继续；停止后不再自动求解。填写成功或样例通过不表示已提交成功。只有“验证无法完成”（页面拿不到可验证结果）时才跳过验证并自动换下一题，此时代码已写入但未提交，需要时请人工核对；样例明确不通过仍会停止连续作答。
- **连续作答**：普通题设置 1～20 题；先在题目所在 frame 寻找「下一题」「随机一题」「换一题」等明确入口，再向父级工具栏查找。确认换到本批已做题时最多尝试 3 次；仍是原题或加载未完成时只等待，不反复点按钮。不会选择提交、交卷、结束等操作，也不能保证网站会在翻题时自动保存。题目写入失败（页面拒绝点击、控件读不回状态等）时不空转：记录具体原因并自动跳到下一题继续，本题未作答；一题都没写成功会明确报错，连续 4 题写入失败才停止，避免一路跳过整场考试。编程题自动换题找不到入口时退回等待人工换题。
- **失败诊断**：页面操作失败会把真实原因和操作名一起显示（例如“页面没有接受选项变更，请检查该站的选项控件（页面操作：fillStep）”），不再只给一句笼统提示；注入函数内部抛出的异常也会转成这条消息返回。
- **题型识别**：先按题干里的「编程题 / 单选题 / 多选题 / 判断题 / 填空题 / 简答题」标识判定，再按页面上真实的 radio / checkbox（包括被站点隐藏、只显示自绘样式的原生控件）判定；题目区域内没有编辑器时，题面出现两处以上 A./B. 选项标记也按选择题处理，只有都看不出来才接受页面其它位置的编辑器。页面里常驻的代码编辑器（一直显示的 IDE 面板、上一题遗留实例）不会把选择题判成编程题，避免对选择题写入代码或去点执行验证。自绘选项依次按原生 checked、aria-checked/selected/pressed 和 is-checked/is-selected 类名回读选中状态，并在点击后重新定位当前 DOM 节点（部分站点会重建选项节点）。单选/判断题点击本身即生效，页面完全读不到选中态时按点击结果继续并在日志提示人工核对，不会因为读不回状态就报“未写入”；多选题仍然要求逐项回读确认。
- **执行样例**：可选，只对编程题开放。在题目区域内寻找唯一的「执行代码」「运行」「执行验证」等入口，点击后等待新的运行结果。选择题、填空题不会出现也不会点击任何执行入口，页面上成对的真实选项本身就是拒绝执行验证的信号；找不到唯一入口（没有或存在多个同级候选）时跳过并记录原因，绝不改用「提交」按钮，也不把旧结果或单纯点击成功当作测试通过。编程样例明确失败时，会把原题、语言、实际执行代码及本次可见报错/输入输出交给当前 CLI 或 API 模型，最多自动修正 2 次，并沿用配置的填写节奏重新写入、回读和执行；每轮只发送最近一次反馈，不累积整页或无限重试。相同代码、低置信度、人工修改、达到上限或日志不可靠时停止修正。样例通过或无法验证都留在当前编程题，等待人工核对、提交代码并换题；不会自动提交或跳题。启用此选项会产生额外模型用量；侧栏「执行样例」也使用同一修正流程。
- **题目跟随**：已绑定页面的题干变化会自动更新侧栏和页内标题，并清除旧答案。任务运行中会取消旧求解、停止旧输入，再处理新题；空闲时只同步题目，不自动产生模型请求。题目连续变化超过 10 次时停止，避免无限请求。
- **后台运行**：默认启用“切换标签后继续在原练习页作答”。任务固定绑定启动时的标签，不会把答案写到你后来打开的其他网页。可关闭此选项，仅在前台执行；手动暂停在两种模式下都需要明确继续。
- **暂停 / 继续 / 停止**：可使用页内按钮或快捷键；停止保留已输入内容，正在执行的一小段输入可能完成，之后不再输入。已经发送到服务商的用量不能撤回。
- **任务记录**：按时间倒序，最新在上；同毫秒内后写入的记录在前。固定 240px 高度，可滚动，新记录会回到顶部；只显示时间和内容，不显示序号。

### 操作节奏

| 配置 | 默认值 | 可设置范围 |
| --- | --- | --- |
| 答案返回后等待 | 1500 毫秒 | 0～60000 毫秒 |
| 自动操作间隔 | 800 毫秒 | 0～10000 毫秒 |
| 每字符输入间隔 | 40 毫秒 | 0～500 毫秒 |
| 文本 / 代码逐字输入 | 开启 | 可关闭；间隔 0 也为即时输入 |

自动选择选项、填写字段、执行样例和换题共用操作间隔。数值输入框整值写入，避免 `3.` 等中间态被浏览器清空。配置在本地保存，下一次任务生效；侧栏、页内控制和快捷键共用同一份配置。暂停／停止不受点击间隔限制。

逐字输入使用编辑器 API 分段追加并回读；发现手动编辑、题目变化或节点失效就停止旧输入。它是输入节奏与可视化效果，不保证被网站识别为人工键盘输入。

### 减少离开题目页面

练习开始前先保存连接方式（CLI / API）、批量数量、后台运行与节奏配置，并完成站点授权。之后可：

- 练习页加载时页内组件会**自动注入**到**实际题目 iframe**，把开始／暂停／继续／停止放在题目旁边；如需手动补注入，仍可点击侧栏的“启用页内组件”；
- 在练习页使用 **Alt+Shift+N** 切换开始／暂停／继续，不必再点侧栏。macOS 的 Alt 对应 Option；快捷键冲突时可在 `chrome://extensions/shortcuts` 调整；
- 连续任务自动识别新题，页内控制在新 frame 上重新绑定。

本地 iframe 夹具中，开始、暂停、继续、停止四次点击没有触发该 iframe 的 blur；这不是对任何考试平台计次规则的保证。后台运行仍保留真实的 visibility/focus 状态，网站可以记录切屏；已经发生的计数不会撤销。Chrome 冻结或丢弃后台页面时也可能无法继续。

Logo 已换为用户提供的透明 PNG，并保留原图 `assets/nexly-logo-source.png`；侧栏、页内面板和浏览器图标均使用它，缩放保持比例。

扩展不会点击「提交代码」「提交」「交卷」「结束练习」，不会改写倒计时、屏蔽切屏计数或移除页面规则。按钮禁用时按页面状态等待，最多 60 秒；不保证侧栏焦点不会被特定平台计入切屏。首版面向允许使用辅助工具的练习流程。

## ccSwitch 联动

每次求解都启动新的 CLI 进程，不复用聊天会话、不固定模型和供应商。ccSwitch 切源写入 CLI 的 live 配置后，**下一次请求**使用新配置；已启动的请求不会热切源，可停止后重试。无需重启 Chrome 或扩展。

- Codex：保留 `CODEX_HOME` 规则，读取 CLI 当前 `config.toml` / 现有鉴权。
- Claude Code：读取用户配置和现有鉴权，禁用本次调用的工具、MCP 与 hooks，不修改用户配置文件。
- Gemini：临时目录不一定会发现用户 `.env`，因此桥接器每次在本地读取 `~/.gemini/.env` 中 `GEMINI_*` / `GOOGLE_*`，仅传入子进程；不回传扩展、不写日志。禁用本次调用的扩展工具，并使用 deny-tools 策略。
- Qwen Code：命令为 `qwen`，读取现有 `QWEN_HOME`（默认 `~/.qwen`）下的配置和登录态；只允许不匹配真实工具的白名单，关闭扩展并限制 MCP。用户/系统配置包含 hooks 或外部记忆服务时拒绝启动，不自动放宽隔离参数；为可靠检查，当前隔离适配只接受标准 JSON 设置（JSONC 注释/尾逗号会拒绝并提示使用 API 模式）。
- Kimi CLI：命令为 `kimi`，读取 `KIMI_SHARE_DIR`（默认 `~/.kimi`）的配置和登录态。使用临时、零工具的 agent、空 MCP 与独立 skills 目录；检测到 hooks 或插件时拒绝启动，因为 Kimi 的 print 模式可能自动批准工具。临时 agent 不指定模型，沿用 CLI 当前配置。
- 两个新增 CLI 必须支持当前使用的非交互参数；不兼容时明确报错，不退回可执行任意工具的模式。本轮未安装它们或验证真实账号，仅通过模拟进程和契约回归验证适配。
- ccSwitch 只联动其实际支持的 CLI；QuizMate 不保证 ccSwitch 管理 Qwen / Kimi。DeepSeek、GLM、MiniMax 等也可通过你已经配置成功的 Claude Code / Codex 兼容服务使用，不虚构厂商独立 CLI。
- 刷新连接显示 CLI 版本和配置文件更新时间，**不代表账号、额度、网络或模型已可用**。
- 对原有 Codex / Claude / Gemini 及 OpenAI 环境变量，桥接器不会把启动它的旧终端中的密钥、地址和模型作为兜底带入新 CLI。如果你的配置只存在于某个终端临时 `export` 中，请先写入相应 CLI / ccSwitch 的正式配置。

Chrome 启动的环境和终端 PATH 可能不同；同时安装了多个版本时，实际使用路径以本地桥检测结果为准。若要固定某个 CLI，或 CLI 不在常见路径，可手动创建 `~/.nexly-web-agent/config.json`，只填写绝对命令路径，不能填写命令参数或 shell 表达式：

```json
{
  "cliPaths": {
    "codex": "/absolute/path/to/codex",
    "claude": "/absolute/path/to/claude",
    "gemini": "/absolute/path/to/gemini",
    "qwen": "/absolute/path/to/qwen",
    "kimi": "/absolute/path/to/kimi"
  }
}
```

首次请求到服务商仍使用 CLI 账号的配额或计费。本地模式无需在插件中填写独立 API Key，并不代表调用免费。

## API 连接与密钥

### 国产服务与可选推广

预设只填调用地址与协议，不填 Key、不指定“最新模型”，不会发请求或自动授权；仍可编辑任意兼容地址。模型以当前账号可用的完整 ID 为准，不能把网页会员/CLI 凭证当成通用 API Key。部分厂商不提供 `/models`，请手填。

| 服务 | 预设与注意事项 |
| --- | --- |
| [DeepSeek](https://api-docs.deepseek.com/) | 通用 OpenAI 兼容 API |
| [通义千问 / 百炼](https://help.aliyun.com/en/model-studio/base-url) | 预设北京通用 API；地域、工作空间和 Coding Plan 的地址/Key 须配套 |
| [智谱 GLM](https://docs.bigmodel.cn/cn/api/introduction) | 通用 API，非 Coding Plan 专属地址 |
| [Kimi / 月之暗面](https://platform.moonshot.cn/docs/guide/start-using-kimi-api) | 中国区开放平台 |
| [豆包 / 火山方舟](https://www.volcengine.com/docs/82379/1399008) | 可填模型 ID 或推理接入点 ID（`ep-…`） |
| [MiniMax](https://platform.minimax.cn/docs/api-reference/text-openai-api) | 中国区通用兼容 API，套餐与国际区地址可手动修改 |
| [腾讯 TokenHub](https://cloud.tencent.com/document/product/1772/115970) / [混元旧接口](https://cloud.tencent.com/document/product/1729/111007) | 两个独立预设，API Key 不通用；不使用 SecretId/SecretKey |
| [百度千帆 / 文心](https://cloud.baidu.com/doc/qianfan-api/s/3m7of64lb) | v2 API Key，不是旧版 AK/SK |
| [讯飞星火](https://www.xfyun.cn/doc/spark/Web.html) | HTTP 接口 APIPassword，不是 WebSocket APIKey/APISecret |
| [硅基流动](https://docs.siliconflow.cn/docs/api/chat-completions-post) | 聚合模型使用完整模型 ID |
| [阶跃星辰](https://platform.stepfun.com/docs/zh/welcome) | 通用兼容 API |

上述为官方兼容接口预设/契约核对，并非所有厂商真实账号联调通过。实际模型权限、区域、套餐与价格以服务商控制台为准。官方 CLI 参数依据：[Qwen Code](https://qwenlm.github.io/qwen-code-docs/en/users/features/headless/)、[Kimi CLI](https://moonshotai.github.io/kimi-cli/en/reference/kimi-command.html)。

API 设置中有明确标为“推广”的可选入口：[nexly.guangnian.xin](https://nexly.guangnian.xin/)。只在主动点击时打开，不预填该站 API endpoint、不上传题目/Key、不影响其他服务。不对该站的价格、安全、隐私或稳定性作保证。


- **协议**：支持 OpenAI 兼容 Chat Completions 与 Responses，处理标准 JSON / SSE 流式答案。自动模式根据完整 endpoint 识别；基础地址默认 Chat Completions，可在高级设置切换。原生 Anthropic `/messages`、Gemini `:generateContent` 不受支持；经中转站转换为上述兼容协议的模型可使用。
- **地址**：可填 `https://api.example.com`、`https://api.example.com/v1`、自定义基础路径，或完整 `/chat/completions` / `/responses` endpoint。只有域名时默认加 `/v1`，不会重复拼接已有 `/v1`。公网必须 HTTPS；HTTP 只允许 `localhost`、`127.0.0.1`、`[::1]`。禁止地址内的账号、查询参数和片段，不允许 HTTP 重定向。
- **权限**：保存、获取模型与测试时仅申请所配置服务的 origin 权限（Chrome 对端口的授权粒度以浏览器提示为准）。读取练习页的权限与 API 域名权限相互独立。
- **保存位置**：扩展配置保存在当前浏览器 `chrome.storage.local`；题目、答案、任务记录与已解锁 Key 保存在 `chrome.storage.session`。不使用 `storage.sync`，不建立 Nexly 云端配置服务。**本地保存不等于本地推理**：求解时题目仍发送给你选定的服务商；CLI 自身的配置/日志是本机文件，不由浏览器管理。
- **默认会话密钥**：Key 只放在受隔离的会话存储，不持久化到本机扩展配置。浏览器会话结束、扩展重载/停用/更新后需重新填写。
- **可选加密保存**：勾选“口令加密保存到本机”，输入并确认 12～256 个字符的独立口令（按 JavaScript UTF-16 长度计数，不 trim）。Web Crypto 使用 AES-GCM-256、随机 16 字节 salt / 12 字节 IV、PBKDF2-SHA256 600,000 次派生；加密认证包含服务 origin。只有密文持久化到 `local`，不存口令和派生密钥；本次解锁的 Key 仅存 `session`，后台休眠不需反复解锁。可立即锁定；重启/重载后必须解锁。忘记口令不可找回，只能清除并重新填写 Key。
- **迁移与边界**：旧版持久化明文 Key 在设置/API 使用前迁到本次会话，成功后删除本机明文，不擅自生成口令或伪称已加密。迁移失败则阻止 API 请求并保留旧副本供重试。加密无法防止已解锁会话、恶意扩展更新或本机恶意程序；不是系统钥匙串，也不保证操作系统备份中没有历史残留。系统钥匙串或云端保险箱尚未实现，当前不引入服务端保存密钥。
- **密钥域名绑定**：换域名不会自动复用已保存 Key；选择厂商预设还会清空未保存的 Key 和模型，避免误发。清除会移除会话 Key 与本机密文，非密钥配置保留。
- **隔离**：存储仅开放可信扩展上下文。已保存的 Key 不回显给表单，不放入题目、页内控件、任务记录或任务状态；输入框为空且仍是同一 origin 时沿用已有密钥。API 请求仅经扩展内专用 Worker 发出，侧栏关闭不影响正在运行的任务；没有活跃任务或请求时不发送保活心跳。
- **测试与用量**：获取模型是 `GET /models`，失败可手填；拿到列表不代表模型额度或推理能力可用。“测试连接”会真实调用固定测试题并校验答案，不会发送当前练习页。超时默认 180 秒，可配 10～600 秒；模型列表最多 30 秒。HTTP 401/403/404/429 和服务异常有独立提示。
- **取消**：停止、换题会取消旧请求并丢弃迟到结果；失败不自动重试、不自动换模型/供应商。客户端取消不保证服务端未受理或不计费，请核对中转站用量后手动重试。后台意外重启时停止任务，不重放请求。
- **数据流**：仅发送既有题目契约（题干、选项、字段、语言、模板及去除查询参数的页面地址）与固定输出提示，不附网页 Cookie、本地文件、CLI 配置或历史题目。中转站及上游可能保存请求，请自行核查隐私条款；Responses 请求设置 `store:false`，不代表第三方一定不留记录。模型返回需通过相同的题目 ID、类型、字段、选项和置信度校验才能填写。

## 支持边界

当前实现：原生 radio/checkbox、ARIA 选择控件、普通输入框 / textarea / contenteditable，以及可暴露可验证编辑 API 的 Ace、Monaco 和 CodeMirror 5。没有唯一编辑器、API 不可用、选项不完整或题目已变化时停止，不猜测目标。

代码编辑优先使用编辑器公开 API 分段追加或整值写入，并在完成后回读，不依赖系统剪贴板。任意站点的禁复制、禁粘贴、富文本、自绘 Canvas、图片题、公式识别、封闭 Shadow DOM、Monaco 私有模块、CodeMirror 6、拖拽题和验证码不在首版已验证范围；不宣称可以通用处理所有考试限制。

本地自动化测试不代表任意网站、CLI 或中转站服务已兼容。网站页面结构、编辑器挂载方式和 CLI 配置可能不同；请先在允许辅助工具的练习页验证，并人工核对答案。生成代码只作文本返回，桥接器不会在本地执行题目代码；模型置信度不等于判题通过。

## 开发与诊断

项目没有 npm 依赖，使用 Node.js 22+ 运行：

```bash
npm run check
npm test
npm run build
npm run doctor
```

- `check`：JavaScript 语法和 Manifest 引用完整性检查。
- `test`：本地自动化回归测试，使用模拟 CLI / API，不调用真实模型、不消耗服务商额度。
- `build`：从源码生成 `dist/extension` 和版本化 ZIP；产物不纳入 Git。ZIP 只包含扩展，不含本地桥、测试、CLI 配置或密钥。
- `doctor`：检测本地桥、CLI 路径和配置状态，不代表模型账号、额度或服务可用。
- 只预览安装路径：`node scripts/install-native.mjs --dry-run`。
- 可选真实浏览器回归：在已安装 Playwright / Chromium 的开发环境中，设置 `NEXLY_BROWSER_TEST=1`、`NEXLY_PLAYWRIGHT_PATH`（模块入口绝对路径）与 `NEXLY_CHROME_PATH`（浏览器可执行文件），运行 `node --test tests/browser-api.test.mjs`。仅用临时 profile、本机模拟 API 与练习夹具；夹具预授本机域名，不代表真实中转站、系统权限弹窗或华为页验收。默认测试跳过这一项。
- 修改扩展后：先 build，再在 `chrome://extensions` 点击扩展的刷新按钮。
- 迁移项目位置后：重新运行 `node scripts/setup.mjs` 更新本地桥入口路径。

目录：`extension/` 是 Manifest V3 源码，`bridge/` 是 CLI 与 Native Messaging，`scripts/` 是安装构建工具，`tests/` 是自动化回归测试，`.github/` 包含 Bug 反馈表单与入口配置。

## 问题反馈

请通过 [Bug 反馈表单](https://github.com/SW1109/nexly-web-agent/issues/new?template=bug_report.yml) 提交问题。建议先搜索已有 Issues，并提供：

- 扩展版本、操作系统、Chrome / Node.js 版本，以及连接模式；本地模式补充 CLI 和版本，API 模式补充协议与模型 ID（不提供密钥）。
- 最小复现步骤、预期行为、实际行为。
- 可公开的练习页地址（不含令牌和个人参数），以及脱敏截图或日志。

不要上传 API Key、加密口令、密钥密文、登录令牌、Cookie、完整 CLI 配置或含个人信息的题目数据。安全漏洞请按 [安全反馈说明](SECURITY.md) 私下报告，不要直接发布到公开 Issue。

## 卸载与数据

运行 `node scripts/uninstall-native.mjs` 只删除本项目注册的 native host 与启动脚本；在对应浏览器扩展管理页移除 QuizMate（同时移除其扩展存储中的配置和 Key）。不会删 CLI、ccSwitch 或它们的账号数据；自定义 `~/.nexly-web-agent/config.json` 也保留。

题目、答案和当前任务暂存于 `chrome.storage.session`，用于侧栏重开；不写入持久化用户记忆。本地模式的 CLI 提示只包含提取的题目数据与固定 JSON 契约，按所选 CLI 的配置发给其服务商。任务的临时目录在结束时清理。Codex/Claude 使用无持久化会话选项；Gemini / Qwen / Kimi 自身可能按其设置保存会话记录或诊断日志，扩展不能承诺 CLI 层完全不留记录。

本地桥只接收 health / solve / cancel，禁止浏览器传入任意可执行程序或 shell 命令。页内控制消息仅接受已绑定的 tab/frame/document，不能读取 API 凭证或改变 API 地址；页面脚本合成的点击不会触发页内 CLI 操作，题目变更通知只在已授权任务内引起重新求解。stderr 不原样回传，避免把 CLI 回显的提示、配置或本地上下文暴露到页面。


## Edge 与商店准备

- 开发安装：`npm run build`，在 `edge://extensions` 加载 `dist/extension`，保留固定开发 ID。
- Edge 商店上传：`npm run build:edge`，生成 `dist/quizmate-edge-v0.4.0.zip`，根目录包含 Manifest，去除开发 key；不要上传开发包或整个源码。
- 材料归档：`npm run pack:edge`，生成独立材料 ZIP。真实界面截图与 Logo 在 `docs/edge-store/assets/`；不是测试成功或审核通过证明。
- Edge 本地模式：`node scripts/setup.mjs --browser edge --extension-id 你的32位扩展ID`；商店 ID 与开发 ID 可能不同，安装时以实际 ID 为准。API 模式不需要本地桥。
- 所有站点权限按需申请，不再默认授权华为域名。首次识别后若需持续读取 iframe / 自动显示页内组件，请点击“授权本站”。
- 微信赞助：已接入维护者提供的真实收款图片，位于 `extension/assets/wechat-support.jpg`；更换后重新构建。未提供时不显示二维码；不附加付费功能，不统计支付。
- 操作、隐私及发布前缺失信息见上方文档。当前只是准备提交包，未自动上传、发布或保证通过商店审核。


## 自愿赞助

如果项目对你有帮助，欢迎反馈问题、参与改进，或自愿支持维护。所有功能不因赞助而解锁，不保证答案正确或考试结果；支付由微信处理，请先核对收款人和金额。项目不记录交易或检测到账。

<img src="extension/assets/wechat-support.jpg" width="320" alt="维护者提供的微信赞助收款码，扫码前请核对收款人和金额">

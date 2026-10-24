# Edge 扩展商店发布准备说明

本文档说明针对 Microsoft Edge 扩展商店（Edge Add-ons）打包与提交的相关规范及步骤。

---

## 0.6.2 更新（2026-10-24）

- 修复 Moodle 在线文本富文本编辑器识别，支持在 `fitem_id_onlinetext_editor` 容器内定位编辑区。
- 支持生成后自动录入文章，保留仅预览和手动录入；已有正文时不覆盖，保存与提交由用户完成。
- 支持识别作业选做一套的要求；仅有答题说明、缺少具体试题时提示补充题面。
- 页内组件显示不透明度范围扩展为 0%～100%，默认仍为 90%。

## 1. 构建发布包

在项目根目录下执行打包命令：

```bash
# 1. 运行质量与合规检查
npm run check
npm test

# 2. 构建 Edge 专用发布包
npm run build:edge
```

- 构建产物生成于 `dist/quizmate-edge-v0.6.2.zip`。
- 该 ZIP 包根目录下直接包含 `manifest.json`，已移除本地开发用的固定密钥（`key`），不包含源码开发文件、测试套件或本地桥脚本。
- 商店分配的扩展 ID 与开发版不同。发布后需在本地 CLI 的安装说明中要求用户从 `edge://extensions` 复制真实 ID，再运行 `node scripts/setup.mjs --browser edge --extension-id YOUR_EDGE_EXTENSION_ID`。已有本地环境时只需运行 `node scripts/install-native.mjs --browser edge --extension-id YOUR_EDGE_EXTENSION_ID`。API 模式无需安装本地桥。
- 发布 0.6.2 时，在现有商店条目上传新版 ZIP，保留当前扩展 ID；不要为普通更新重新创建条目。连续练习默认 20 题，上限 100 题，页内组件默认开启；保留站点授权修复及“设置本地桥”入口。
- 本版沿用“网课学习”预览工作区与四项有限平台 `host_permissions`，需同步商店权限说明、隐私政策及真实界面截图。参考开源选择器的许可证已随包放入 `third-party.html`。
- 本地构建和隔离模拟回归不等于已登录课程验收、Edge/Windows 实测或商店审核通过。0.6.2 本轮不自动上传/提交商店；不要覆盖此前已提交的 0.4.0 原包。

---

## 2. 商店材料清单

在提交至 Partner Center 时，可参考 `docs/edge-store/` 下的相关材料：
- **商店文案**：`LISTING.zh-CN.md`（包含产品名称、简短描述、完整功能介绍与建议搜索词）。
- **权限与数据披露**：`PERMISSIONS.md`（包含各权限的单一用途合规说明）。
- **测试与审核说明**：`REVIEWER_NOTES.md`（供审核人员参考的操作步骤与功能验证说明）。
- **隐私声明**：`docs/PRIVACY.md`。
- **界面截图与图标**：`docs/edge-store/assets/`。

---

## 3. 提交前核对项

- [ ] 确认版本号（`package.json` 与 `manifest.json` 一致）。
- [ ] 确认上传包为 `dist/` 下生成的正式 ZIP 包，而非包含源码仓库的完整目录。
- [ ] 确保在提交后台已提供可公开访问的隐私政策 URL。

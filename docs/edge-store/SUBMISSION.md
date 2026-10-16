# Edge 扩展商店发布准备说明

本文档说明针对 Microsoft Edge 扩展商店（Edge Add-ons）打包与提交的相关规范及步骤。

---

## 1. 构建发布包

在项目根目录下执行打包命令：

```bash
# 1. 运行质量与合规检查
npm run check
npm test

# 2. 构建 Edge 专用发布包
npm run build:edge
```

- 构建产物生成于 `dist/quizmate-edge-v0.4.0.zip`。
- 该 ZIP 包根目录下直接包含 `manifest.json`，已移除本地开发用的固定密钥（`key`），不包含源码开发文件、测试套件或本地桥脚本。

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

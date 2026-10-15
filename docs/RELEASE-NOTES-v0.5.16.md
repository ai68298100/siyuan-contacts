# v0.5.16 发布说明

发布日期：2026-10-16

## 图谱成员生命周期

- 当前单位投影只使用未归档组织的 `active` 成员；`former` 成员不会误显示为当前单位。
- 同一组织与人物的多段成员记录合并为一条边，并保留 `active`、`former` 或 `mixed` 状态。
- 文本视图、Markdown 导出、画布线型和图例统一显示生命周期。
- `related` 查询仍只使用显式人物关系，组织成员边不会污染人物关系结果。
- `orderGraph` 按 member 生命周期状态区分边，并补充回归测试。

## 验证与边界

- `pnpm check`
- `pnpm test`：597/597
- `pnpm test:ui`、`pnpm test:ui:mobile`、`pnpm test:ui:host`：381/381
- `pnpm build`、`pnpm check:release`、`git diff --check`
- `package.zip`：582,401 B；SHA-256 `91c2d4bece34509a2a72468a7d097af4d1bd566ceadfcb2a392fc4331cd731b8`
- Issue #35 仍等待脱敏的小米 VCF；当前无法确认 vCard 候选修复是否命中原始导出根因。
- 真实思源宿主、多窗口、原生图、Android 真机、集市客户端可见性和 Host Queue 项目仍按执行看板单独验收。

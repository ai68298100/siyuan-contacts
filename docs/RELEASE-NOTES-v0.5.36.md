# v0.5.36 发布说明

发布日期：2026-10-23

## 核心亮点：全工程 Select 居中对齐彻底巩固与组织架构看版直达人脉详情闭环

针对用户持续对极致细节与交互连贯性的要求，本版本落地了关键体验强化：

### 1. 全工程 Select 下拉框（全部分组/按姓名等）居中对齐深度防御
- 针对 Windows Chromium / Electron 底层渲染特性，重构 `.lvct-people__toolbar select.b3-select` 与全局 `.b3-select`：
  - 锁定 `height: 38px; line-height: 36px; padding: 0 16px;`，左右对称内边距消除 12px 偏位；
  - 强制应用 `text-align: center; text-align-last: center; -webkit-text-align-last: center; -moz-text-align-last: center;`；
  - 彻底确保名册工具栏「全部分组」与「按姓名」在任何屏幕缩放与主题下**水平与垂直 100% 精准居中**。

### 2. 组织看板成员直通人脉详情（CRM 深度打通）
- 在组织的 Master-Detail 架构看板中，点击任意部门或成员小卡片，**直接唤起该联系人的完整人物详情弹窗**；
- 支持键盘回车无障碍直达，关闭详情后平滑停留在原组织看板处，形成完整的现代组织人脉浏览闭环。

## 验证与门禁
- `pnpm check`：0 errors / 0 warnings（TypeScript 与 Svelte）
- `pnpm test`：850+ 自动化单元测试全部通过（通过率 100%）
- `tests/architecture.test.ts`：7/7 架构分层守门全部通过
- Chrome 桌面 UI、390px 移动端 UI、宿主样式 UI 各 **483/483 完整通过**
- `pnpm build` 与 `pnpm check:release`：生产单 chunk 产物与 Release 发布门禁全部 PASS

# v0.5.42 发布说明

发布日期：2026-10-23

## 核心亮点：生态中枢统领指令全面落实、跟进打卡自动化与 SQL 安全守卫

本版本严格对照《小驴生态中枢统领指令》，落地各项 P0/P1/P2 级关键要求：

### 1. 跨插件生态联邦协同（打卡联动深度打通）
- **跟进打卡自动化**：完成跟进任务（`setFollowUpStatus -> done`）时，自动根据设置的 `checkinItemId` 向小驴打卡联动打卡（`externalRef: contacts:<personDocId>:<date>:<seq>`），未安装打卡时安静降级；
- **打卡事件监听名纠偏**：通过 `src/libs/ecosystem-bridge-kit.ts` 规范监听 `checkin:event-recorded` 等标准广播；
- **雷切动态小组件**：注册 `contacts-upcoming` 人脉动态小组件。

### 2. 集市检索优化与设置窗口大窗
- **补齐“小驴”品牌关键词**：`plugin.json` 前置补齐 `["小驴", "小驴人脉", "xiaolv", "lv"]`，集市精准秒级直达；
- **独立设置窗口支持**：开启 `"settingsWindow": true`，`minAppVersion` 设为 `"3.8.4"`。

### 3. SQL 注入防线与移动端虚拟键盘防遮挡
- **SQL 块 ID 强校验**：`src/api/client.ts` 导出 `assertSafeBlockId`（`/^\d{14}-[a-z0-9]{7}$/` 正则守卫）与 `escapeSqlString`，`querySql` 强制校验只读 SELECT 语句；
- **移动端键盘动态避让**：`LvctDialog.svelte` 接入 `visualViewport` 监听，输入法弹起时自动上抬弹窗底边距，消除“保存”按钮被遮挡问题；
- **图标完整性**：最新 256×256 暖干邑橙配天青宝珠 `icon.png` 严格完整保持。

## 验证与门禁
- `pnpm check`：0 errors / 0 warnings（TypeScript 与 Svelte）
- `pnpm test`：896 自动化单元测试全部通过（通过率 100%）
- `tests/architecture.test.ts`：7/7 架构分层守门全部通过
- Chrome 桌面 UI、390px 移动端 UI、宿主样式 UI 各 **483/483 完整通过**
- `pnpm build` 与 `pnpm check:release`：生产单 chunk 产物与 Release 发布门禁全部 PASS

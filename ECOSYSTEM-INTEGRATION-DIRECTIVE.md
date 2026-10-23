# 【小驴生态中枢统领指令】小驴人脉 (siyuan-contacts) 专项排查与全方位升级执行手册

> **统领下发方**：小驴快门中枢（`siyuan-quickgate`）
> **执行接收方**：小驴人脉（`siyuan-contacts`）开发 Agent
> **当前状态**：底座测试全绿 (483项) · 规范评分 80% ➔ 目标 100%
> **核心原则**：零强依赖 · 暖干邑橙+天青宝珠 Bento 美学 · 严禁私有存储穿透

---

## 一、 核心资产状态确认
1. **根目录 `icon.png`**：**已由中枢完成 256×256 殿堂级“暖干邑橙配天青宝珠”高清头像替换，请严格保留勿覆盖！**
2. **本地就绪 SDK**：`src/libs/ecosystem-bridge-kit.ts`（零外部依赖，直接 import 使用）。

---

## 二、 当前排查出的本插件专项缺陷与必修任务清单

### 【P0 级：集市获客与设置窗口升级】
1. **`plugin.json` 补齐品牌关键词（严重影响集市获客！）**：
   - 当前 `keywords` 完全没有“小驴”中文词，导致用户在集市搜“小驴”时人脉完全隐形！
   - **必修修改**：前置强制补齐 `["小驴", "小驴人脉", "xiaolv", "lv", ...]`。
2. **开启独立桌面设置大窗（`settingsWindow: true`）**：
   - 在 `plugin.json` 根级增加 `"settingsWindow": true`，彻底打通思源 3.8.8+ 独立大窗口设置体验。

---

### 【P1 级：跨插件联邦与顶栏图标升级】
3. **纠偏跨插件事件监听名 (`src/index.ts`)**：
   - **历史 Bug 修复**：`src/index.ts` L352 监听了错误的 `"lv-checkin:item-recorded"`，而打卡实际派发的是 `"checkin:event-recorded"`！
   - 请改用 `src/libs/ecosystem-bridge-kit.ts` 中的 `subscribeEcosystemEvent` 与 `ECOSYSTEM_EVENTS` 标准常量。
4. **互动跟进自动打卡 & 向雷切注册小组件**：
   - 记录拜访后调用 SDK 的 `logCheckinEventSafely`（`externalRef: "contacts:<personDocId>:<date>:<seq>"`）；
   - 调用 `registerRaikiriModuleSafely` 向雷切注册 `contacts-upcoming` 小组件（展示近期生日与待跟进）。
5. **顶栏单色矢量图标升级 (`src/index.ts`)**：
   - 将 `this.addIcons(...)` 中的 `iconLvContacts` 替换为线条匀称、与新版 Logo 1:1 呼应的标准 32×32 SVG：
   ```xml
   <symbol id="iconLvContacts" viewBox="0 0 32 32">
     <circle cx="21" cy="11.5" r="3.5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-opacity="0.45"/>
     <path d="M17.5 24.5c.5-2.8 2-4 5.5-4s5 1.2 5.5 4" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-opacity="0.45"/>
     <circle cx="11.5" cy="11" r="4.5" fill="none" stroke="currentColor" stroke-width="2"/>
     <path d="M5 25c0-4 2.8-6 6.5-6s6.5 2 6.5 6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
     <circle cx="23.5" cy="6.5" r="2.5" fill="currentColor"/>
   </symbol>
   ```

---

### 【P2 级：SQL 校验、移动端防遮挡与 UI 微动效】
6. **SQL 块 ID 强校验**：
   - 全仓 72 处 SQL 查询，凡拼入块 ID 处必须经过 `/^\d{14}-[a-z0-9]{7}$/` 正则校验，字符串经过 `.replace(/'/g, "''")` 转义。
7. **移动端虚拟键盘防遮挡 (`visualViewport`)**：
   - 录入联系人弹窗挂载 `window.visualViewport` 动态抬升底边距，防软键盘遮挡“保存”按钮。
8. **UI 微触感与 Bento 软性美学注入 (`src/index.scss`)**：
   - 注入变量 `--lv-brand: #EA580C;` 与 `--lv-accent-cyan: #0284C7;`；
   - 弹窗标题栏统一使用 `.lv-dialog-title-wrap`。

---

## 三、 验收指令
修改完成后，在根目录执行：
```bash
pnpm check && pnpm test
```
确保全量单测与门禁 100% 全绿通过！

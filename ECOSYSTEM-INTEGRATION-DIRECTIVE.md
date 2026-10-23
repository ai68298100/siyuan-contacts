# 【小驴生态中枢统领指令】小驴人脉 (siyuan-contacts) 全方位升级与跨插件协同执行手册

> **统领下发方**：小驴快门中枢（`siyuan-quickgate`）
> **执行接收方**：小驴人脉（`siyuan-contacts`）开发 Agent
> **架构基线**：Epoch 6 联邦规范 · 零强依赖优雅降级 · 暖干邑橙+天青宝珠美学 · 历史排雷防线

---

## 一、 核心定位与视觉资产状态
- **生态角色**：**【人际实体中心（Person Entity Hub）】**——一人一文档管理联系人与关系网，为管家、打卡、常用语提供确定性人物引用。
- **专属主题色**：**爱马仕暖干邑橙（`#EA580C`）＋ 绿松石天青灵珠（`#0284C7`）**。
- **根目录 `icon.png`**：**已由快门中枢完成 256×256 殿堂级“橙底配天青蓝宝珠”高反差头像替换，请勿覆盖回退！**
- **本地已就绪 SDK**：`src/libs/ecosystem-bridge-kit.ts`（零外部依赖，可直接 `import`）。

---

## 二、 必做任务 1：跨插件联邦联动（Epoch 6 标准）

### 1. 纠偏跨插件事件监听名 (`src/index.ts`)
- **重要 Bug 修复**：`src/index.ts` L352 此前监听了错误的 `"lv-checkin:item-recorded"`，而打卡实际发射的是 `"checkin:event-recorded"`！
- 请改用 `src/libs/ecosystem-bridge-kit.ts` 中的 `subscribeEcosystemEvent` 与 `ECOSYSTEM_EVENTS` 标准常量：
  ```ts
  const unsubs = [
      subscribeEcosystemEvent(ECOSYSTEM_EVENTS.CHECKIN_RECORDED, () => this.onDataChanged()),
      subscribeEcosystemEvent(ECOSYSTEM_EVENTS.GLEAN_DATA_CHANGED, () => this.onDataChanged()),
      subscribeEcosystemEvent(ECOSYSTEM_EVENTS.CARDS_REVIEWED, () => this.onDataChanged()),
      subscribeEcosystemEvent(ECOSYSTEM_EVENTS.EXAM_STATS, () => this.onDataChanged()),
  ];
  // onunload 时遍历执行 unsubs 退订
  ```

### 2. 互动跟进联动小驴打卡 (`src/bridge/external-bridge.ts` 或互动记录服务层)
- 当用户保存一条联系人互动记录后，若设置了打卡联动项，调用 SDK 的 `logCheckinEventSafely` 自动打卡：
  ```ts
  if (this.settings.checkinItemId) {
      await logCheckinEventSafely({
          itemId: this.settings.checkinItemId,
          value: 1,
          externalRef: `contacts:${personDocId}:${date}:${Date.now()}`,
          note: `与 ${personName} 互动跟进`,
      });
  }
  ```
  *(未安装小驴打卡时自动静默返回 false，不报错)*

### 3. 向小驴管家开放安全选人 & 向雷切注册小组件
- 维护好 `window.LvContacts`（四别名：`LvContacts`, `lvContacts`, `xiaolvContacts`, `siyuanContacts`）的 `searchPeople` 与 `ensurePerson`（仅返回脱敏摘要）；
- 调用 `registerRaikiriModuleSafely` 向雷切注册 `contacts-upcoming` 小组件（展示近期生日与待跟进人脉）。

---

## 三、 必做任务 2：顶栏与侧栏单色图标升级 (`src/index.ts`)

将 `this.addIcons(...)` 中的 `iconLvContacts` 替换为线条匀称、与新版 Logo 1:1 呼应的 32×32 单色矢量图标：
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

## 四、 必做任务 3：UI 轻量统一与 Bento 软性美学升级 (`src/index.scss`)

1. **注入专属品牌色与圆角阶梯**：
   ```scss
   --lv-brand: #EA580C; /* 暖干邑橙 */
   --lv-brand-soft: color-mix(in srgb, var(--lv-brand) 12%, transparent);
   --lv-accent-cyan: #0284C7; /* 绿松石天青点缀 */
   --lv-r-sm: 6px;
   --lv-r-md: 12px;
   --lv-r-lg: 20px;
   --lv-r-pill: 9999px;
   ```
2. **吸收最初参考图设计神韵**：
   - 互动时间轴采用参考图第二屏的“温润聊天气泡卡”样式；
   - 联系人分组与标签筛选全量采用 `9999px` 饱满药丸胶囊；
   - 按钮增加物理按压微触感：`:active:not(:disabled) { transform: translateY(1.5px) scale(0.985); }`；
   - Dialog 弹窗标题栏统一采用 `.lv-dialog-title-wrap`（左嵌 22×22 橙底白标 + 标题 + 版本胶囊）。

---

## 五、 必做任务 4：深层工程规范与历史排雷加固

1. **`plugin.json` 关键对齐（必改）**：
   - **补齐品牌关键词**：当前 `keywords` 居然没有“小驴”！必须前置加入 `["小驴", "小驴人脉", "xiaolv", "lv", ...]`，否则用户在思源集市搜“小驴”搜不到人脉！
   - 新增 `"settingsWindow": true`（开启独立桌面设置大窗）；
   - `minAppVersion` 统一为 `"3.8.4"`。
2. **SQL 块 ID 校验与防注入**：
   - 全仓 72 处 SQL 查询中，凡是拼入块 ID 的地方必须经过 `/^\d{14}-[a-z0-9]{7}$/` 正则校验，字符串参数必须 `.replace(/'/g, "''")` 转义。
3. **移动端虚拟键盘避让 (`visualViewport`)**：
   - 手机端录入联系人或互动弹窗挂载 `window.visualViewport` 监听，动态抬升底边距，防虚拟键盘遮挡“保存”按钮。
4. **日志、i18n 与工程卫生**：
   - 控制台日志前缀统一由 `[lvct]` 规范为 `[LvContacts]`；Toast 提示前缀统一为 `[小驴人脉]`；
   - 确保构建产出包含下划线格式的 `dist/i18n/zh_CN.json`；
   - 补齐根目录 `CHANGELOG.md`，并在 `.gitignore` 中忽略 `.mimosa/` 与 `.workbuddy/`。

---

## 六、 验收标准
执行完毕后，在 `siyuan-contacts` 根目录运行：
```bash
pnpm check && pnpm test
```
确保全量单测与类型检查 100% 全绿通过！

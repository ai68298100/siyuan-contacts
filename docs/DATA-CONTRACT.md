# 数据契约（DATA-CONTRACT）

> 本文档是小驴人脉"生产数据边界"的唯一事实源。改任何一条存储/字段约定，先改这里。
> 全部端点形状经 M0 spike 在思源 v3.8.5 真内核实证（`scripts/spike/av-spike.mjs`）。

## 0. 数据主权划分

| 数据 | 存放位置 | 插件卸载后 |
|---|---|---|
| 联系人档案（结构化字段） | 思源数据库（AV），随人物文档与笔记本走 | **仍在**（思源原生数据） |
| 联系人文档（正文/双链） | 人脉笔记本 | 仍在 |
| 互动时间线 | 笔记反链（原生）+ 插件互动事件（可选） | 反链仍在；事件随插件存储 |
| 插件设置/视图偏好/提醒状态 | 插件自管 JSON（`data/storage/petal/siyuan-contacts/`） | 随插件删除 |

## 1. 人脉主库（思源数据库）

### 1.1 布局锚点

- 笔记本：向导创建，默认名「人脉」（记录 `notebookId`）。
- 宿主文档：`人脉/联系人总表`，内嵌一个数据库块（记录 `hostDocId`、`dbBlockId`）。
- 数据库 ID（`avId`）由**插件客户端预生成**（`newNodeId()`），插 DOM 块后用 `renderAttributeView(createIfNotExist)` 物化（spike ①）。
- 四个锚点 ID 全部固化在插件设置里；**绝不通过列名/文档名反查锚点**。

### 1.2 字段契约

主键(block)列由建库自带 = 姓名 = 文档标题。预设字段（`src/domain/fields.ts` 为唯一事实源）：

| 稳定键 | 默认列名 | 类型 | 说明 |
|---|---|---|---|
| `birthday` | 生日 | date | 公历；`isNotTime: true` |
| `lunarBirthday` | 农历生日 | checkbox | true = 生日字段按农历换算 |
| `phone` | 电话 | phone | |
| `email` | 邮箱 | email | |
| `wechat` | 微信 | text | |
| `website` | 网站 | url | |
| `group` | 分组 | select | 选项：家人/朋友/同事/同学/其他（写值自动建） |
| `tags` | 标签 | mSelect | |
| `related` | 相关人 | relation | 指向本库；双向，回链列「被相关人」内核自动创建 |

- 插件记 `fieldMap: 稳定键 → keyID`，**用户改列名不影响插件**；用户删列则相关功能降级并在设置页提示重建（M2+）。
- `keyID` 由客户端按节点 ID 格式生成（spike ②）。

### 1.3 行（人）的语义

- 一个人 = 一篇文档（`人脉/<姓名>`）+ 主库中绑定的一行（`addAttributeViewBlocks isDetached: false`）。
- **`itemID`（行 ID）≠ 绑定文档 ID**。换算只准经：
  - `getAttributeViewItemIDsByBoundIDs`（文档 ID → itemID，spike ④）；
  - 渲染响应主键单元格：`rows[].id` = itemID，`value.block.id` = 绑定文档 ID。
- 删除联系人文档前先解绑行（`removeAttributeViewBlocks` 对绑定行只解绑不删文档，spike ⑥）。

### 1.4 单元格写入

`setAttributeViewBlockAttr` 传 `itemID`（`rowID` 已进弃用通道）。值形状（全部 spike ⑤ 回读验证）：

| 类型 | value |
|---|---|
| text/phone/email/url | `{"<type>": {"content": "..."}}` |
| date | `{"date": {"content": <ms>, "isNotEmpty": true, "isNotTime": true}}` |
| select / mSelect | `{"mSelect": [{"content": "...", "color": "1"}]}`（新选项自动创建） |
| checkbox | `{"checkbox": {"checked": true}}` |
| relation | `{"relation": {"blockIDs": [<对方 itemID>]}}` |

### 1.5 读取

- 人员列表/字段值一律走 `renderAttributeView`（`pageSize: -1`），**数据库没有 SQL 表**（spike ⑧）；`/api/query/sql` 仅用于文档/块/反链查询。
- 单元格遍历：`cells[].value.keyID` 定位字段（不是 `cells[].keyID`）。

## 2. 关系建模

- MVP：`related` relation 字段存边（双向）。目标库配置唯一通道是 transactions 动作
  `updateAttrViewColRelation`（**请求体必须带 `reqId`**，spike ③）。
- 人物文档内"相关人物"双链区块由插件维护（M3），保证反链面板与思源关系图可见。
- 二期：独立"关系库"（行=关系：甲/乙/类型/开始时间），支持类型化与非对称关系，从现有数据一键升级。

## 3. 插件自管 JSON

全部键带 `schemaVersion` 包装；读入必须经 normalize（不兼容返回 null 引导重建，**永不抛错阻断启动**）；写入必须写后回读验证（两次不收敛即真失败）。读-改-写走 Web Lock 临界区。

| 键 | 版本 | 内容 |
|---|---|---|
| `contacts-settings.json` | 1 | 四锚点 ID + fieldMap + 初始化时间 |
| `view-preferences.json` | （M2） | 各视图排序/筛选/列显隐 |
| `interaction-events.json` | （M4） | 互动事件（只追加）：`{id, personDocId, occurredAt, localDate, source, externalRef?, note}`；`source+externalRef` 幂等；删除写墓碑 |
| `bridge-state.json` | （M4） | 打卡联动状态机（unsupported/pending/ready/failed） |

## 4. 性能预算（随人数增长的读取策略）

> 设计目标：百人秒开、千人流畅、万级可用。核心原则——**全量渲染只有一条路径（名册缓存），
> 列表热路径禁止 `pageSize: -1`**。

| 场景 | 策略 | 复杂度 |
|---|---|---|
| 联系人列表（卡片/表格） | 名册缓存（30s TTL）+ 客户端过滤 + 客户端分页（200/页"加载更多"） | 30s 一次全量渲染 |
| 搜索/分组筛选 | 纯客户端（名册上字符串过滤，万级 <1ms） | 0 内核调用 |
| 仪表盘（生日/久未联系/统计） | 名册缓存 + 互动事件本地投影 | 0 额外内核调用 |
| 关系图谱 | 名册缓存 + `capGraph` 800 节点上限（按度数保留，UI 明示截断） | 0 额外内核调用 |
| 详情关系候选 | 名册缓存 | 0 额外内核调用 |
| 新建防重 | 名册（写后失效重建） | 与名册共享 |
| 收编候选发现 | SQL 按 `box=笔记本ID LIMIT 500`（ID 严格校验，见下）+ 批量绑定（200/批） | 常数次调用 |

- **名册缓存**（`services/roster.ts` + `domain/roster.ts`）：进程内、可随时重建，不是事实源；
  所有 services 层写操作（新建/收编/关系变更）立即 `invalidateRoster()`。
  多窗口下他人对数据库的写入最多滞后一个 TTL（30s）。
- **写放大控制**：收编 500 篇 = 1 次批量映射 + 3 次批量绑定（200/批），而非 1500 次逐个调用。
- **SQL 安全约束**：`/api/query/sql` 只有 stmt 字符串参数、不支持绑定占位符（内核 API 层限制）。
  因此约定：SQL 组装只允许出现在 `services/contacts.ts#discoverImportCandidates` 一处，
  进入语句的外部值仅限"通过 `^\d{14}-[0-9a-z]{7}$` 校验的思源 ID"，自由文本（关键字）不进 SQL、客户端过滤。
- **互动事件存储**：单文件 JSON 到 ~2 万条事件仍可流畅；此后需做分段/压缩（ROADMAP"大规模演进"）。

## 5. 大规模演进（万级以上，按需启动）

以下均**不在当前版本实现**，触发条件写明，避免过早优化：

1. **名册持久化缓存**：名册目前是进程内缓存（30s TTL）。若万级下首次渲染慢到影响体验，
   增加 `roster-cache.json` 持久化缓存（启动秒开，后台重建），带 schemaVersion 与 avId 绑定，
   重建失败即弃用回退实时渲染——仍是可重建的派生数据。
2. **互动事件分段存储**：事件按人哈希拆多文件或按年分段；热路径只读"最近互动"投影文件
   （docId → lastInteractionAt），事件文件退化为审计日志。
3. **内核侧分页列表**：若名册全量渲染在万级下不可接受，列表视图改走
   `renderViewPage`（api 层已具备），搜索改内核 `query` 参数——放弃跨视图缓存换取 O(页) 渲染。
4. **生日索引**：为生日查询建插件侧"月-日 → 文档 ID"倒排（初始化/写入时增量维护），
   仪表盘生日区从全量投影降为 O(当期生日数)。

## 6. 端点行为备忘（v3.8.5 实测与文档的差异）

- `addAttributeViewKey`：`keyIcon` **必填**（文档称可选）。
- `/api/transactions`：请求体顶层必须带 `reqId`。
- `appendAttributeViewDetachedBlocksWithValues`：`blocksValues` 是**数组的数组**（每行直接是值数组），无 id 包装。
- `createNotebook` 返回值不保证是 ID：创建后统一 `refreshNotebooks` + 重新列表获取。

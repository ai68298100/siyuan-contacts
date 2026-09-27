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
| `view-preferences.json` | 1 | 工作台默认页面、联系人默认排序、启动行为、生日窗口、久未联系阈值、AI 入口开关 |
| `interaction-events.json` | （M4） | 互动事件（只追加）：`{id, personDocId, occurredAt, localDate, source, externalRef?, note}`；`personDocId+source+externalRef` 幂等；删除写墓碑 |
| `bridge-state.json` | （M4） | 打卡联动状态机（unsupported/pending/ready/failed） |

同一场合允许每位参与者各有一条互动事件；`source+externalRef` 表示共同场合，
只有人物 ID 也相同时才判定重复。事件 ID 在全库唯一，归一化同时按事件 ID 去重。
此修正保留 schemaVersion 1，不改变存储结构；旧版本已经跳过或丢弃的参与者事件无法自动恢复。

互动事件的展示读取可容错降级；新增与删除必须在锁内严格读取，宿主读取抛错时终止操作，
不得把读取异常当成空库保存。null/undefined 或空字符串允许首次写入：思源 v3.8.5
宿主 `Plugin.loadData` 的未创建文件默认值为 `""`（本机 stage/build/app/common 构建实证）。
非空数据必须具有兼容版本、事件数组与墓碑数组，且各项类型合法；否则新增与删除均报错，
不自动将未知版本或损坏内容归一为空库覆盖。展示读取仍可过滤损坏项，正常去重与墓碑投影不受影响。

设置页的「导出互动事件 JSON」生成一次性导出包：
`{schemaVersion: 1, exportedAt, storageKey, rawStore, events, tombstones}`。导出包不回写插件存储，
`events` 与 `tombstones` 保留当前归一化后的审计事实；新增 `rawStore` 保存宿主读取的原始 JSON 值，
不丢弃损坏项、重复项、墓碑或未知版本，`storageKey` 标明源文件。
这是 JSON 值快照而非源文件字节备份；数据在同一排他锁内读取，读取异常时导出失败，禁止生成空成功备份。
首次未创建文件的 null 或空字符串也原样保留在 `rawStore` 中。schemaVersion 保持 1，原有字段继续可用。

设置页支持预览并合并互动 JSON 备份，不覆盖整个库、不新建联系人文档。
接受 schemaVersion 1 的事件库、旧版导出包及带 rawStore 的新版包；新版优先严格检查 rawStore，
拒绝损坏快照或未知版本，不用已过滤的 events 偷换原数据。空快照表示空导入。
合并以当前库优先，按事件 ID 或人物+来源+场合去重；合并双方墓碑，删除标记优先，禁止复活。
预览不写入；确认后在同一存储锁内重新读取、合并、写后回读验证，返回实际新增/跳过/移除/新增墓碑数量。
当前库存储损坏或读取失败时拒绝导入；包含删除标记的备份须在确认中明确说明会移除对应互动。

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
  缓存身份包含 avId、dbBlockId 与字段映射；同配置并发查询合并，TTL 从完成查询时计算。
  失效前或被新配置替代的在途查询只返回原调用方，不回填共享缓存；失败后允许直接重试。
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
- `createNotebook` 返回值不保证是 ID：创建后重新列表获取；`refreshNotebooks` 端点在 3.8.5 **不存在**。
- **块属性存储**：自定义属性存于 `blocks.ial` 列（kramdown IAL 文本，形如 `custom-x="1"`），
  旧 `attributes` 表已弃用；按属性查块用 `ial LIKE '%<attr>="%'`。
- **IAL 语法**：markdown 中 IAL 必须**独占一行**跟在块后（`内容\n{: custom-x="1"}`）；
  写在行尾不会被解析为属性、原样留在正文（scripts/spike/ial-probe.mjs 实证）。
- 数据库**没有 SQL 表**：`av_table.go` 系渲染逻辑；数据库读取一律 `renderAttributeView`。

## 7. vCard (.vcf) 导入导出映射（v0.2d）

vCard 处理是**瞬态转换**（不落插件存储），但属性↔字段映射是数据边界契约，事实源在
`src/domain/vcard.ts`。以 vCard 3.0 为主，兼容读取 4.0 日期形式。

| vCard 属性 | 插件字段 | 语义 |
|---|---|---|
| `FN`（回退 `N`） | 姓名（主键列 + 文档标题） | 无 FN 用 N 的"姓+名"连写；两者皆无则丢弃该卡片 |
| `TEL`（多个） | 电话 | 全部保留，`" / "` 连接写入单值文本字段（去重保序） |
| `EMAIL`（多个） | 邮箱 | 只取首个（邮箱有格式校验，不做多值拼接） |
| `URL`（多个） | 网站 | 只取首个 |
| `BDAY` | 生日（公历） | 只接受完整年月日（`19900520` / `1990-05-20` / 带 `T` 时间后缀）；无年份（`--0520`）与文本形式丢弃 |
| `X-LVCT-BDAY-LUNAR` | 生日 + 农历勾选 | 本插件导出农历生日的回写属性；导入时仅当 BDAY 缺失才读它 |
| `CATEGORIES` | 标签 | 逗号切分，空项丢弃 |
| 其余（`ORG`/`ADR`/`NOTE`/`PHOTO`/`UID`/`REV`…） | — | 忽略；`ORG` 留给二期组织维度，`PHOTO` 留待头像需求 |

- 导出为 vCard 3.0（CRLF 行尾、不做 75 字节折行——D-0013）；**微信号不导出**（无标准属性，X- 扩展互通性为零）。
- 导入查重：与名册精确同名（或同批次在前项同名）默认跳过（D-0007 同源语义），UI 预览标注。
- 导入批量路径写放大与收编同款：逐篇建文档（内核单文档语义）→ 绑行 200/批 → 一次批量映射 → 逐人写单元格。
- 支持 QP（QUOTED-PRINTABLE）编码值解码（UTF-8/GBK 字符集，含无空格续行的软换行变体）。

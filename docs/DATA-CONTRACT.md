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
- 数据库 ID（`avId`）由**插件客户端预生成**（`newNodeId()`），插 DOM 块后用 `renderAttributeView(createIfNotExist: true)` 物化（spike ①；该参数必须为 `true`，见 §6）。
- 四个锚点 ID 全部固化在插件设置里；**绝不通过列名/文档名反查锚点**。
- **初始化幂等可续建**（D-0019）：设置缺失时重跑向导不新建第二份——按名复用笔记本、按
  标题在笔记本内找回「联系人总表」、按 `type='av'` 找回数据库块并从 `blocks.markdown`
  还原 `avId`、按列名+类型对账只补缺失列、回链列已在则跳过双向配置；不删除任何已有内容。
  现场识别只认「联系人总表」文档内的数据库块（同名笔记本里用户的无关数据库不当作自己的）。

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

不支持 Web Locks 时，按存储键使用进程内 Promise 队列串行执行，同一键按调用顺序排队，
不同键互不阻塞，失败不会阻塞后续任务。此降级仅保护同一 JS 上下文，不保证跨窗口排他；
支持 Web Locks 的环境仍使用宿主浏览器锁，不自动在锁请求失败后绕过保护写入。
取锁带 5 秒中止信号：超时判定持有方疑似挂死（回归环境曾现锁 held 不释放假死），
以 steal 模式接管自愈（原持有方按规范让位），正常并发下排队语义不变；非中止类
锁错误仍照常抛出、不绕过保护。

| 键 | 版本 | 内容 |
|---|---|---|
| `contacts-settings.json` | 1 | 四锚点 ID + fieldMap + 初始化时间 |
| `view-preferences.json` | 1 | 工作台默认页面、联系人默认排序、启动行为、生日窗口、久未联系阈值、AI 入口开关；F02 起新增 `peopleView`（`card`/`table`，联系人默认形态）与 `tableColumns`（表格可见列的有序键数组，可选键仅限 `group/phone/wechat/birthday/recent/tags`；「姓名」为固定列不入数组、恒为首列）。归一化规则：旧偏好缺字段取默认；键不在可选集或重复的项剔除；全部被剔除/清空时回退全列默认——隐藏全部可选列不被视为合法状态。F04 起新增 `savedViews`（保存的联系人视图，规则快照而非人物 ID 快照）：`{id, name, query}` 数组，`query = {search, group, tags, tagMatch, recentFrom, recentTo, neverContacted, sort}`；归一化丢弃缺 id/缺 name 或字段类型非法的条目，按 id 去重、name 去首尾空白、上限 50 条；视图按规则在应用时对当次名册重新求值，不保存人物集合。F08 起新增 `summaryEnabled`（默认 true，打开工作台时的关注摘要开关，设置「提醒」分区控制）与 `summaryDismissedOn`（`YYYY-MM-DD` 或空串；「当日不再展示」写入当天本地日期，次日自动恢复展示）；非法日期串归一化为空串。C02 起新增 `reminderGraceDays`（收编宽限期天数，0–365 整数钳制，缺省/非法回退 14；0=关闭）：新收编联系人在宽限期内不计入「从未互动」提醒（设置「提醒」分区可调） |
| `interaction-events.json` | （M4） | 互动事件（只追加）：`{id, personDocId, occurredAt, localDate, source, externalRef?, note}`；`personDocId+source+externalRef` 幂等；删除写墓碑 |
| `follow-ups.json` | 1 | 跟进事项（F05）：`{id, personDocId, title, dueDate, status, createdAt, updatedAt, closedAt?}`。`dueDate` 为 `YYYY-MM-DD`（严格校验：格式错误或不存在的日期拒绝创建/改期，不顺延回退）；`status ∈ open/done/cancelled`，完成或取消写 `closedAt`，重新打开清除 `closedAt`——**完成跟进不自动写互动事件，记录互动也不悄悄完成跟进**（两类数据独立）。人物按 `personDocId` 关联：人物解绑后事项保留并显示「不可达」，仍可推迟/取消，不指向他人。展示读取容错降级；新增与状态变更在存储锁内严格读取，损坏或未知版本拒绝写入不覆盖原文件。导出为 `{schemaVersion, exportedAt, storageKey, rawStore, items}` 快照（与互动导出同纪律：锁内严格读取，失败不生成空备份）；合并导入按 `id` 现状优先，新增其余条目，预览零写入，确认时锁内重读重算 |
| `person-cadences.json` | 1 | 按人物联系节奏（F06）：`{schemaVersion, cadences: {"<personDocId>": {days, paused}}}`。仅存覆盖项，未登记的人物跟随全局久未联系阈值；`days` 为 1–365 整数（写入时钳制），`paused: true` 表示对该人暂停提醒（久未联系与从未互动均不再出现）。键必须是通过 `^\d{14}-[0-9a-z]{7}$` 校验的人物文档 ID，非法键或非法值条目在归一化时丢弃；补录过去互动不影响（最近互动一律取最大 `occurredAt`）。展示读取容错；写入在存储锁内严格读取，损坏拒绝不覆盖。删除键即清除覆盖回退全局 |
| `interaction-templates.json` | 1 | 互动备注模板（F09）：`{schemaVersion, templates: [{id, name, content}]}`。归一化丢弃缺 id 或 name/content 非字符串的条目，name/content 去首尾空白，按 id 去重，上限 50 条。存储为空时展示内置默认三个模板（见面/电话/聚会，来自代码常量不落盘）；任何增改删即全量落盘，此后以存储为准（删除内置模板即永久移除）。模板内容支持 `{{姓名}}`/`{{日期}}`/`{{上次互动}}` 占位符，应用时纯本地字符串替换，未知占位符原样保留；模板文本不发送 AI，应用模板不自动提交、不悄悄覆盖已有草稿 |
| `bridge-state.json` | （M4） | 打卡联动状态机（unsupported/pending/ready/failed） |
| `reminder-dismissals.json` | 1 | 提醒暂缓（B08）：`{schemaVersion, dismissals: [{personDocId, kind, until}]}`。`kind ∈ birthday\|stale`；`until` 为 `YYYY-MM-DD` 或空串（空串=长期，直到手动恢复）。**只屏蔽提醒呈现，不改变统计与名单口径**——生日 `until` ≥ 当天（含空串）时该人生日不出现在近期生日/行动清单（「跳过本年」写入当年 `12-31`，跨年自动恢复）；stale 命中时该人的久未联系/从未互动**提醒行**隐藏，首页久未联系统计卡与名单计数保持真实。键必须通过人物文档 ID 校验，非法条目归一化丢弃；同一 `personDocId+kind` 仅一条（重复写入覆盖）。写入在存储锁内严格读取，损坏或未知版本拒绝写入不覆盖；恢复即删除对应条目；设置页「提醒」分区提供已暂缓列表与一键恢复 |
| `person-registry.json` | 1 | 收编时间索引（C02）：`{schemaVersion, registeredAt: {"<personDocId>": "YYYY-MM-DD"}}`。人物首次进入插件视野（新建/收编/首次发现）写入当天本地日期；**首次发现补记**发生在 `loadDashboard` 读路径（幂等 upsert，只补缺失键，不改已有值）。用途：收编宽限期起点（`view-preferences.json` 的 `reminderGraceDays`，默认 14 天，0=关闭）内该人不计入「从未互动」提醒，仅在联系人列表可见；「从未互动」行动组按 `registeredAt` 倒序（最近收编优先，D-0020）。键必须通过人物文档 ID 校验，非法条目归一化丢弃；删除键即遗忘（下次发现重新起算）。写入在存储锁内严格读取，损坏或未知版本拒绝写入不覆盖；读路径补记失败不阻断首页加载（按缺失处理降级） |
| （导出包）`lvct-migration-bundle` | 1 | 完整迁移包（C08/FUNC-01.6，**文件而非存储键**）：`{schemaVersion: 1, exportedAt, storageKey: "lvct-migration-bundle", modules: {interactions?, followUps?, cadences?, reminderDismissals?, registry?, templates?}}`。`interactions`/`followUps` 内嵌各自导出包同款对象（含 rawStore/rawValue，坏数据原样随包）；`cadences`/`reminderDismissals`/`registry`/`templates` 为各自 store 同款对象。**不含** settings 锚点与 view-preferences（锚点请用设置页重绑；偏好属个人 UI 配置），明示"这不是思源原生数据的字节级备份"。恢复：模块预览（各条目计数，零写入）→ 确认后逐模块合并——互动/跟进复用既有合并（id 去重、现状优先、墓碑优先）；cadences/reminderDismissals 按 personDocId+kind 覆盖合并；registry 按 docId 覆盖合并；templates 按 id 去重合并。**与文档任务块的冲突策略**：跟进合并后由 B07 写侧同步自然收敛人物文档任务块（文档为准的对账在下次详情打开时执行），不产生重复任务 |

**reminder-dismissals 与 person-cadences 的分工**：`person-cadences.json` 的 `days` 表达"按更长节奏
提醒"（顺延 N 天 = `days` 提至最近互动天数 + N，名单按新阈值收敛，属联系节奏正常语义）；`paused`
表达"联系节奏层面手动暂停"（既有行为：从久未联系名单排除）。B08 的「不再提醒」**不写 `paused`**，
写 `reminder-dismissals.json`（kind=stale, until=""）——保证首页久未联系统计与名单计数保持真实
（D-0020），仅提醒行隐藏且可一键恢复；`birthday` 同理只屏蔽生日提醒呈现。

### 3.1 人物文档内任务块（B07 跟进 → 原生待办双向同步）

跟进事项以**思源原生任务列表项**写入人物文档（`- [ ] 标题 📅YYYY-MM-DD`），文档任务块为事实源，
`follow-ups.json` 保留为索引/快照（首页清单、导出、不可达兜底）。端点行为全部经隔离内核 v3.8.5
实证（`scripts/spike/task-item-spike.mjs`，12/12）：

- **关联键**：任务块 IAL `custom-lvct-followup="<跟进 id>"`（`/api/attr/setBlockAttrs` 写入，
  勾选后存活，可按 `ial LIKE '%custom-lvct-followup="%"'` 反查；限定 `root_id=<人物文档>` 归属）。
- **识别口径**：`type='i' AND subtype='t'`（subtype='t' 会同时命中列表容器 type='l'，必须再按
  type='i' 过滤）；勾选态在 `blocks.markdown`（`- [X]` 大写为完成）。
- **写入纪律**：每个跟进事项一个独立任务列表块；只增改**自己的**任务项（按关联键识别），
  从不删除/改动用户手工添加的任务；改期/改标题 = `updateBlock` 更新该块 markdown（`📅YYYY-MM-DD`
  原样保留）；完成 = `updateTaskListItemMarker {id, marker:"x"}`（官方端点只认列表项 ID，
  传容器报错；批量用 `batchUpdateTaskListItemMarker`）；取消 = `deleteBlock` 移除任务块
  （插件侧记录保留，可重新打开时重建）。
- **同步方向**：文档勾选 → 插件置 done；取消勾选 → 恢复 open；标题/日期以文档为准；
  任务块被删 → 该事项按"不可达"呈现而不静默复活；两端冲突以文档为准，不做自动互相覆盖。
  **完成跟进不自动写互动；记录互动也不悄悄完成跟进**（与 follow-ups.json 同一纪律）。
- **失败语义**：文档侧同步失败**不阻断**插件库写入（console 记录，BACKLOG 记录改进项）；
  读侧对账（人物详情打开时）以文档为准单向收敛插件库，不回写文档。

同一场合允许每位参与者各有一条互动事件；`source+externalRef` 表示共同场合，
只有人物 ID 也相同时才判定重复。事件 ID 在全库唯一，归一化同时按事件 ID 去重。
此修正保留 schemaVersion 1，不改变存储结构；旧版本已经跳过或丢弃的参与者事件无法自动恢复。

互动事件的展示读取可容错降级；新增与删除必须在锁内严格读取，宿主读取抛错时终止操作，
不得把读取异常当成空库保存。null/undefined 或空字符串允许首次写入：思源 v3.8.5
宿主 `Plugin.loadData` 的未创建文件默认值为 `""`（本机 stage/build/app/common 构建实证）。
非空数据必须具有兼容版本、事件数组与墓碑数组，且各项类型合法；否则新增与删除均报错，
不自动将未知版本或损坏内容归一为空库覆盖。展示读取仍可过滤损坏项，正常去重与墓碑投影不受影响。

人物详情支持分批浏览、备注/日期搜索及来源筛选；单条删除经过确认，按人物 ID 校验事件归属后在锁内写墓碑。
仅移除当前人物的该条互动，不删除人物文档、来源笔记或其他参与者事件；时间线、共同出席及首页统计重新投影。

同场统计仅使用非空 externalRef，与 source 一起表示场合身份；缺少标识不与字面值 `"undefined"` 的场合关联。
同场人数按不同人物计数，每位人物在同一来源/场合中最多贡献一次共同出席；重复事实不放大人数或次数。
时间线按场合索引计算人数，不对每条本人事件重复扫描全库；本人时间线日期排序保持不变。

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
合并计算复用基于 Set/Map 的批量归一化，当前事件排在备份前面，避免逐条扫描和复制整个库；
按当前及备份事件总量线性处理，存储读取、JSON 解析与保存开销另计。
预览不写入；确认后在同一存储锁内重新读取、合并、写后回读验证，返回实际新增/跳过/移除/新增墓碑数量。
当前库存储损坏或读取失败时拒绝导入；包含删除标记的备份须在确认中明确说明会移除对应互动。

## 4. 性能预算（随人数增长的读取策略）

联系人列表的“最近互动”列与排序从当前 `interaction-events.json` 一次读取投影：按文档 ID 取最大 `occurredAt`，相同时按姓名稳定排序；没有事件的联系人排在末尾。该读取不修改事件库、墓碑或 schema，读取失败须显示错误，不把失败伪装成“无互动”。视图偏好 `peopleSort` 可取 `recent`，旧偏好保持兼容。

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
- **`renderAttributeView` 的 `createIfNotExist` 语义**（v0.2.0 首启实故的根因）：
  全新数据库块上传 `false` 以 `code=-1 attribute view not found` 失败，传 `true` 才物化
  （默认视图 + 主键列）；物化后两种取值都能读，且重复传 `true` 幂等。
- **`insertBlock` 的 `data` 是事务结果数组** `[{doOperations:[…]}]`（dom 与 markdown 两种
  dataType 实测一致）：新块 ID 取 `data[0].doOperations[0].id`；按对象读会取不到 ID
  （v0.2.0 首启在建库一步抛“未返回新块 ID”的原因）。
- **`createNotebook` 重名不报错**：返回 `code=0` 并静默创建第二个同名笔记本——
  重名保护必须由客户端预检完成（`listNotebooks` 比对）。
- **`addAttributeViewKey` 重名列不报错**：返回 `code=0` 并叠出同名列——续建初始化必须先按
  列名/类型对账，只补缺失列，否则会把库配出两套同名列。
- **数据库锚点还原通道**：数据库块的 `blocks.markdown` 列含 `data-av-id`（块 IAL 里没有），
  按 `parent_id = '<宿主文档ID>' AND type = 'av'` 查块即可还原 `dbBlockId` 与 `avId`；
  这是初始化续建（D-0019）与“找回半成品现场”的唯一可靠通道，实证见
  `scripts/spike/init-resume-results.json`。
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

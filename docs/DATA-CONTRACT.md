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

## 4. 端点行为备忘（v3.8.5 实测与文档的差异）

- `addAttributeViewKey`：`keyIcon` **必填**（文档称可选）。
- `/api/transactions`：请求体顶层必须带 `reqId`。
- `appendAttributeViewDetachedBlocksWithValues`：`blocksValues` 是**数组的数组**（每行直接是值数组），无 id 包装。
- `createNotebook` 返回值不保证是 ID：创建后统一 `refreshNotebooks` + 重新列表获取。

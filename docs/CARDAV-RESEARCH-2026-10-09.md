# CardDAV 通讯录同步研究（2026-10-09）

## 结论

可以做成 CardDAV 同步，但不能把现有 vCard 文件导入/导出直接改成“请求一个 URL”。现有 vCard 功能是一次性文本转换；CardDAV 是一个带远端资源身份、并发控制、增量游标和删除语义的同步协议。实现需要独立的同步层、远端绑定状态和凭据边界。

建议采用三阶段：

1. **协议 spike**：在真实思源宿主验证第三方 HTTPS、CSP/CORS、代理、Basic/应用密码/OAuth、Nextcloud 和 Radicale 的发现与读写。
2. **手动单向同步**：用户选择地址簿后，预览并确认“远端导入”或“本地导出”；每条记录显示映射、忽略字段和结果。
3. **双向增量同步**：保存远端 UID/href/ETag、上次 vCard 快照和 sync-token；用冲突队列处理本地与远端同时修改。

首版不承诺后台常驻同步。先支持用户点击同步或打开工作台时同步；定时同步要等凭据安全存储、宿主网络能力和失败恢复在真实环境验证后再做。

## 协议流程

CardDAV（RFC 6352）基于 WebDAV。客户端不能假设用户填写的 URL 就是地址簿资源，应按发现流程读取当前 principal、addressbook-home-set，再列出 `resourcetype=addressbook` 的集合。常见流程是：

1. 使用 `/.well-known/carddav` 或用户提供的服务地址开始发现。
2. `PROPFIND` 读取 `DAV:current-user-principal`，再读取 principal 的 `addressbook-home-set`。
3. 对 home-set 做 `PROPFIND Depth: 1`，获取地址簿名称、地址簿 URL、显示名和服务能力。
4. 首次同步使用 `REPORT addressbook-multiget` 或 `addressbook-query`，读取资源 href、ETag 和 vCard 内容。
5. 后续同步优先使用 RFC 6578 的 `DAV:sync-collection` 和 `sync-token`，拿到新增、修改、删除的资源，再用 multiget 取变更卡片。
6. 新资源用 `PUT` 配合 `If-None-Match: *`；更新用旧 ETag 配合 `If-Match`；删除也必须携带已核实的 ETag。收到 412 或 ETag 已变化时进入冲突队列，不能覆盖远端。

服务不支持 sync-token 时可以退回“列资源 + ETag 比对”的全量检查；不支持 multiget 时可以逐条 GET，但需要分页、限速和取消。sync-token 过期时必须重新全量同步，不能把旧 token 当作有效增量。

## 与当前代码的差距

当前 `src/domain/vcard.ts` 和 `src/services/vcard.ts` 只处理瞬态 `.vcf` 文本：

- 解析/序列化主要围绕 FN/N、TEL、EMAIL、URL、BDAY、CATEGORIES，以及本插件的 `X-LVCT-BDAY-LUNAR`。
- 多个 TEL 会合并成一个字符串，EMAIL/URL 只保留首项；这不足以保证 CardDAV 多值往返不丢失。
- 没有远端 UID、href、ETag、sync-token、原始 vCard 快照或本地修改快照。
- ContactSummary 没有地址、头像、ORG/TITLE、REV 等字段。
- 当前 API 只封装思源内核请求，没有第三方 WebDAV/XML/凭据客户端。CardDAV 出网必须放在新的 `src/api/carddav.ts`，不能复用 `src/api/client.ts` 的思源请求封装。
- 浏览器端的 `PROPFIND`、`REPORT` 和 `Authorization` 会触发 CORS/CSP/预检；真实宿主不验证通过，就不能把 CardDAV 宣称为可用。

未知 vCard 属性不能在双向同步时直接丢弃。远端卡片包含 PHOTO、ADR、X-* 等字段时，若本地修改姓名后重新 PUT，必须保留未知属性，或在 UI 明确提示会丢失并要求确认。

## 字段同步矩阵

| 内容 | 默认策略 | 说明 |
| --- | --- | --- |
| 姓名 | 双向 | 映射 FN/N；以远端 UID/href 绑定，不能按姓名合并人物 |
| 电话 | 可同步 | 当前模型是单值；多 TEL 需要先扩展本地多值模型。首版若只同步主号码，必须显示其余号码未同步 |
| 邮箱 | 可同步 | 当前模型只保留首项；多邮箱同样需要扩展模型或明确只同步主邮箱 |
| 网站 | 可同步 | 当前模型只保留首项 |
| 公历生日 | 可同步 | 映射标准 BDAY；只接受完整公历日期 |
| 农历生日 | 默认不按标准 BDAY 同步 | RFC 6350 没有统一的中国农历语义。若开启兼容扩展，可写公历换算值加 `X-LVCT-BDAY-LUNAR`，并明确外部客户端可能丢弃扩展 |
| 标签 | 可选双向 | 映射 CATEGORIES；需处理逗号、转义和服务器分类限制 |
| 分组 | 默认本地 | 可选择以明确前缀映射到 CATEGORIES，但不能把分组和标签静默混为一类 |
| 公开备注 | 可选 | 只有用户明确勾选“同步公开备注”才映射 NOTE；人物私密备注默认不外发 |
| 地址/公司/职位/头像 | 后续扩展 | vCard 有标准属性，但当前联系人模型没有等价字段；不能读入后无提示丢弃 |
| 组织成员与任职历史 | 不同步 | 组织是插件独立文档和成员索引，多组织、多段任职不能安全压成一个 ORG/TITLE |
| 别名、微信、与我的关系 | 默认不同步 | 可分别规划 NICKNAME/X-*，但当前没有稳定的跨客户端语义 |
| 相关人物/关系图 | 不同步 | `related` 是思源内部人物关系，不对应普通通讯录关系 |
| 互动、跟进、提醒、捕获来源、AI 内容 | 不同步 | 属于人脉工作台内部事实或私密上下文 |
| 思源 docId/itemId、数据库 ID、块链接 | 不同步 | 远端不能依赖本地身份；也不能把这些 ID 放入普通 vCard 字段 |
| UID、href、ETag、sync-token、原始 vCard | 仅同步元数据 | 仅保存于插件同步状态，不写入联系人数据库，不进入迁移包和日志 |

农历是最容易产生误解的字段：不能把农历 `YYYY-MM-DD` 直接写进普通 BDAY，否则手机和服务器会按公历解释。若用户选择“同步农历兼容扩展”，应同时显示“其他客户端可能只看到换算后的公历生日，或丢弃农历扩展”。外部只修改 BDAY 时，应把它视为公历修改，并把农历扩展标记为待核对。

## 本地同步状态

建议新增独立的插件数据键，均通过 `src/data/storage.ts` 读写：

- `carddav-settings.json`：服务器显示名、服务地址、地址簿 URL、用户名、启用状态、同步策略、上次同步时间和脱敏状态。密码/Token 不写这里。
- `carddav-records.json`：账号与地址簿、远端 UID、href、ETag、本地 docId/itemId、上次成功 vCard 快照、状态和冲突载荷。
- 每个地址簿保存 sync-token；token 失效时转为需要全量核对，不自动清空本地数据。

本地人物没有可靠的修改时间时，可用“当前投影与上次快照比较”判断本地是否修改；不能用姓名或本地 itemId 代替远端身份。远端身份始终由地址簿范围内的 UID/href 绑定。

## 冲突、删除和失败语义

- 同一字段本地与远端都改变：暂停该条，显示本地值、远端值和上次同步值，提供保留本地、采用远端、人工合并。
- 远端返回 412、锁定、权限错误、服务器 5xx：逐条记录为冲突/失败/未知，保留可重试请求；不重发未知 PUT。
- 远端删除：本地联系人进入“远端已删除，待处理”，默认保留本地文档。
- 本地删除：默认只解除同步绑定或进入待删除队列，不直接删除远端卡片。
- 所有新增、更新、删除都要有逐条结果、重试和未知状态；一次同步失败不能改变组织、关系图、互动和跟进数据。

## 设置页建议

“设置 → 通讯录同步”向导应分步显示：服务器地址、发现结果、地址簿选择、鉴权测试、同步字段、首次同步方向、隐私预览、冲突策略、手动同步/暂停/断开、失败重试和凭据清除。首页只显示上次成功同步时间、待处理冲突数和失败数，不显示密码或 Token。

首次同步前必须显示两张清单：

1. **将同步**：姓名、选中的联系方式、公历生日、选中的标签/公开备注。
2. **不会同步**：组织任职、关系图、互动、跟进、提醒、本人标记、AI 内容、思源内部 ID、同步元数据和未勾选的私密字段。

## 验收范围

至少用 Nextcloud 和 Radicale 验证：发现、Basic/应用密码、全量读取、增量 token、vCard 3/4、强 ETag、412 冲突、远端删除、分页、断点恢复、服务离线、重复点击、服务器不支持 multiget/sync-token、未知 X-* 保留、CORS/CSP 和证书错误。iCloud、Fastmail、Baïkal、DAVx⁵ 等应作为兼容性扩展测试，不能把一个服务器的行为当作 CardDAV 全部实现。

## 官方资料

- [RFC 6352 — CardDAV](https://datatracker.ietf.org/doc/html/rfc6352)
- [RFC 6578 — WebDAV Collection Synchronization](https://datatracker.ietf.org/doc/html/rfc6578)
- [RFC 6350 — vCard Format Specification](https://www.rfc-editor.org/rfc/rfc6350)
- [RFC 6764 — CalDAV/CardDAV 服务发现](https://www.rfc-editor.org/rfc/rfc6764)
- [Nextcloud Contacts/CardDAV 文档](https://docs.nextcloud.com/server/stable/admin_manual/groupware/contacts.html)
- [Radicale 文档](https://radicale.org/v3.html)

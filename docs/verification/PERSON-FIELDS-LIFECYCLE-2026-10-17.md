# #51 / #54：真实 Chrome 完整生命周期与旧备注恢复

最终联合轮 `9e8b5db6-5834-42c7-a5ec-fee5b471bd10` 全部通过。使用新 UUID 虚构工作区、独立 SiYuan Kernel 和 Chrome `browser-desktop` 运行当前生产插件；未替换组件、保存回调、API 或生产服务。`dist/index.js` SHA256 为 `841c8d1ba4509c2fbc93c700127304eda23cdc78d63385813289ed551b5b917c`，`index.css` 为 `4b23e1373448558c27ce5c5e1ec8f3572208d82a912c539cea2982130d144d47`。

## 已存补充资料的完整生命周期

本轮沿用真实 UI 新建分组和两条重复电话、保存关闭重开的原场景；所有后续操作均来自实际生产 UI。每次保存前比较 UI 草稿的确切 UUID、条目顺序、父子关系和完整内容，保存后调用生产 `loadPersonFields` 核对完整快照及原块 ID `20261017114437-dtxmco8`。共八次增量保存：

1. 修改已存分组名称，新增第二分组、两条“微信”和两条同名称同值“邮箱”，核实未去重或丢条目。
2. 将第一电话改到第二组，第二电话改为“不分组”；把第二组的邮箱在同级条目中上移，核实精确 UUID 次序。
3. 同一邮箱下移，核实恢复预期同级次序并保存。
4. 删除已存独立电话先取消：UI 草稿和已存完整快照不变，浏览器块写请求增量为 `0`；再确认删除并保存。
5. 删除第一分组时选择“保留子条目（解除分组）”，微信与邮箱 UUID、值保留且无悬空父项。
6. 删除第二分组时选择“连同子条目删除”，只删除该组及其电话、微信、邮箱；上步保留的独立微信与邮箱仍在。
7. 删除剩余两条资料并保存，关闭详情后按原人物稳定 `itemId` 重开：真实 UI 为空态，生产快照 `items: []`，补充资料原块仍在；个人备注未被清空。
8. 从该空态重新新增电话及多行内容，保存、关闭、重开，核实新条目 UUID、完整值和原补充资料块 ID。

最终 SQL 再核对唯一补充资料块的 `root_id`、`parent_id`、完整 JSON 与生产服务一致；创建人物时已有的原生正文块 ID、正文、Markdown 均保持。另一同名人物的补充资料、备注与本轮开始时相同。

## 备注冲突恢复及清空

- 在甲人物真实备注 textarea 中保留本地草稿，通过 Node 验证侧的同一生产 `savePersonNote` 服务写入另一虚构外部值。
- UI 以旧 expected 保存时显示真实“已在其他窗口变化”冲突；本地草稿保留，浏览器块写请求增量为 `0`，生产服务仍回读外部值。
- 点击常驻“重新读取”，选择“保留草稿并读取最新”：原草稿全文仍在，`最新已存个人备注` 预览精确显示外部已存全文，重读期间无块写入。
- 用户式显式点击“保存备注”后，生产服务回读保留草稿的完整值；随后清空备注保存，关闭详情重开后 textarea 和生产服务均为空，SQL 不再存在活动备注标记块。

## #54 旧版空行拆块的安全恢复

第三名虚构人物由真实内核 `insertBlock(dataType="markdown")` 解析旧实现格式：`**人物备注**`、三段空行分隔正文、末尾 `custom-lvct-person-note="1"`。SQL 先证实形成独立标题和三段正文，仅最后一段有旧标记且没有 format；没有伪造 SQL 或用生产 DOM 新格式代替旧格式。

实际 UI 读取按未知格式拒绝。点击“核对旧备注”后，核对面板准确展示旧标记末段，明确提示其不是全文；“打开人物文档核对”入口存在且可用。本轮没有实际点击原文入口，避免离开正在验收的详情；这项结果为 `documentActuallyOpened: false`。核对操作为只读，所有 SQL 行与初始值相同，浏览器块写增量为 `0`。

点击“保留原文并解除旧备注关联”后，SQL 核实旧末段原块仍在、旧活动 marker 消失并新增 `custom-lvct-person-note-detached="1"`。原标题、全部三段正文以及人物创建时已有正文的 ID、content、markdown 均保持，生产服务重新读取到空基线。随后在真实 textarea 手动输入 fixture 事先确认的完整三段文本并保存；形成独立新格式备注块 `20261017114455-arlq2xp`，旧原文归档块仍在。关闭详情后按第三人物稳定 `itemId` 重开，真实 textarea、生产服务和 SQL 均回读完整三段及同一新块 ID。

恢复过程没有猜测、拼接或覆盖旧多段原文。此证据仅覆盖已定义的“无 format、唯一标记、直接子段落、无法完整解析”的旧末段形态，不把任意损坏数据声明为可自动恢复。

## 本轮联合保持通过的场景

与以上生命周期同一构建、同一轮还通过：备注特殊字符及多行创建/更新/重开，分组和重复电话保存重开，详情筛选第二条电话，标准 Clipboard API 与真实 DOM `execCommand('copy')` fallback 完整复制及焦点选区恢复，筛选后仍全量编辑保存，双页面旧基线冲突零块写、放弃重读后再次保存，以及同名但 docId/itemId 不同人物的资料和备注隔离。

Windows 剪贴板读取以仅 CRLF/CR → LF 的完整比较为准，不 trim 或截断；读取前先写入本轮虚构哨兵，不读取或记录运行前的剪贴板内容。结果保留原始严格比较和换行规范化比较布尔值。

## 证据、执行与清理

- 结果：`docs/verification/PERSON-FIELDS-REAL-UI-9e8b5db6-5834-42c7-a5ec-fee5b471bd10.json`；与 UUID 工作区内备份 SHA256 同为 `7dc85ce98f9fa16eb46ec16511c7afceb1a60ebc47a40a50d5d574bbe76ca3f2`。
- 工作区：`C:/Users/Admin/AppData/Local/Temp/SiYuan-Lvct-Person-Fields-UI-9e8b5db6-5834-42c7-a5ec-fee5b471bd10`；全部人物和数据为本轮虚构，证据与工作区保留。
- 运行：`2026-10-17T03:44:27.888Z` 至 `2026-10-17T03:44:59.160Z`；SiYuan Kernel `3.8.8-alpha.2`，端口 `5775`。
- Node 验证侧 `248` 次请求、`248` 次监听归属核验；不包含浏览器直接宿主请求。Kernel PID `70492`、Chrome PID `70056` 均退出，端口无监听，独立 profile `lvct-ui-3OaQZI` 已删除。脚本后独立检查再次确认；结果不含本轮 API token。
- 截图位于工作区 `person-fields-ui-artifacts/`；已目检 `person-note-lifecycle-conflict-reread.png`、`person-note-legacy-split-inspected.png`、`person-note-legacy-recovered-reopened.png`，草稿/最新原文并列、末段警示、恢复后备注界面可读；长文本是否完整另以 DOM 全文、生产服务和 SQL 严格比较为准。
- 可选执行：在 PowerShell 中设置 `LVCT_RUN_PERSON_FIELDS_REAL_UI=1`、`LVCT_PERSON_FIELDS_MULTIWINDOW=1`、`LVCT_PERSON_FIELDS_FILTER_COPY=1`、`LVCT_PERSON_FIELDS_LIFECYCLE=1`、`LVCT_PERSON_NOTE_LEGACY_RECOVERY=1` 后运行 `node scripts/e2e/person-fields-frontend-flow.mjs`。默认关闭主 gate 时验证为 `kernelRequests: 0 / workspaceWrites: 0`。

仅修改 runner 等待 UI 正常 revision 重读的时序后复跑，没有修改生产源码。保留的中间证据：`3e2f6bc1-454d-4a14-a14f-55b92d3b84df` 在取消删除零写通过后遇到正常详情重读，立即找删除按钮失败；`b3e1803a-9b56-4197-ac8c-c069a3be0223` 等待删除但未显式重入已回只读的编辑器而超时；两轮均 `167` 次验证请求。`2e236023-f88e-4afc-8556-c7c8d9b766c1` 已通过全部补充资料生命周期和备注冲突/清空，旧备注安全 detach 也通过，在正常 revision 重读时立即填全文失败；该轮 `238` 次请求。三轮均保留准确断点和 JSON，Kernel/Chrome 退出、端口释放、独立 profile 删除；最终轮在相同生产构建上完成全部联合验收。

本轮未执行浏览器 UI 内核重启、日常用户工作区或 Android 验收，也不证明原生编辑器事务 CAS。内核重启后的持久回读仍引用独立真实服务 spike 的对应范围；本报告的真实 UI 范围是上述保存、关闭和重新打开。

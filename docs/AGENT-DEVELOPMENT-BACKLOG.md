# 小驴人脉 Agent 开发待办

> **唯一执行入口。** 本文件只收录仍需开发、补证据或做决策的原子任务，供 AI Agent 直接认领。旧任务编号、产品背景和历史证据仍以 [FEEDBACK-BACKLOG](FEEDBACK-BACKLOG.md)、[NEXT-DEVELOPMENT-PLAN](NEXT-DEVELOPMENT-PLAN.md)、[PRODUCT-PLAN](PRODUCT-PLAN.md)、[UI-SYSTEM-SPEC](UI-SYSTEM-SPEC.md) 与 [DATA-CONTRACT](DATA-CONTRACT.md) 为来源；旧文档中的 `✅` 不会自动变成当前待办。
>
> **更新规则：** 一个任务只允许一个 Agent 认领；先更新本卡状态，再开始编码。完成代码不等于真实宿主完成，`host_pending` 必须保留到真内核、真机或多窗口证据齐全。版本号、`CHANGELOG`、README 徽章、`docs/PROGRESS.md` 是本轮保护文件，任何任务都不得修改。

> **2026-10-06 产品评审入口：** 当前工作区功能已接近完整工作台，但本次复核发现桌面 UI `314/315`、390px UI `315/316`，评审开始时已有 22 个未提交代码/测试/文档文件。跨模块的产品判断、用户体验、品牌头像、README、GitHub 介绍和发布收口见 [PRODUCT-REVIEW-2026-10-06](PRODUCT-REVIEW-2026-10-06.md)。先处理 `PR-P0-01`（关系结果导出回归）和 `PR-P0-02`（统一验证快照），再推进真实宿主、Android 真机和多窗口；不得沿用旧文档中的 315/315 数字。

## 1. 给 Agent 的最短规则

开始任务前按顺序读取：

1. 根目录 `AGENTS.md`；
2. 本文件中对应任务卡和它的 `depends_on`；
3. `docs/DATA-CONTRACT.md` 中相关章节；
4. 相关源码、测试、`PAGE-STATUS.md`、`UI-REGRESSION.md` 和已有 spike 结果。

遇到以下任一情况必须把任务标为 `blocked`，先登记缺口，停止写实现：端点或参数没有契约/实证；字段或 JSON 结构没有迁移规则；组织、本人、图谱的事实源不明确；原型与当前源码的行为冲突；任务会触碰受保护文件；依赖任务尚未达到退出条件。

实现顺序固定为：

```text
决策/契约 → spike → domain/normalize → api → data/storage → service → component → e2e/host
```

组件只能向 `types / services / domain / data / api` 单向依赖；内核交互只能在 `src/api/`；插件 JSON 只能通过 `src/data/storage.ts`；颜色只能使用 B3 CSS 变量和 `lvct-` 前缀；移动端判断只能使用 `getFrontend()`。

每个任务必须覆盖正常、空、加载、部分成功、失败、未知、取消、草稿、重试、暗色、窄屏和键盘/读屏中适用的状态。所有写入都要锁内重读、写后回读、可幂等重试，并明确回滚边界。

## 2. 状态、优先级和任务卡格式

状态只能使用以下值：

| 状态 | 含义 |
|---|---|
| `ready` | 依赖满足，可以认领 |
| `in_progress` | 已由一个 Agent 认领 |
| `blocked` | 缺契约、决策、spike 或前置任务 |
| `partial` | 已有实现，只补列出的余项 |
| `done_isolated` | 代码和隔离测试通过，宿主证据仍可能缺失 |
| `host_pending` | 隔离实现通过，真实思源/真机/多窗口待验 |
| `done` | 代码、测试、文档和要求的宿主证据全部齐全 |
| `deferred` | 明确延期，不得自行转成开发任务 |
| `candidate` | 只调研和决策，不写主流程 |
| `cancelled` | 明确取消 |

优先级：`P0` 数据安全与契约门禁，`P1` 当前主路径，`P2` 规模/体验/扩展，`P3` 研究候选。

每张卡必须保持以下字段；若字段无内容写 `无`，不能省略：

```text
ID / title / status / priority / type / milestone
user_outcome / user_scenario / source_ids / current_evidence
depends_on / blocks / parallel_group / preconditions
allowed_files / forbidden_files / contract_change / host_or_spike_required
ordered_steps / test_fixtures / test_commands / acceptance
failure_retry_rollback / privacy_boundary / performance_budget
evidence_paths / owner / last_updated / commit
```

## 3. 当前执行队列

> 2026-10-03 暂停时的质量快照见 [DEVELOPMENT-AUDIT-2026-10-03](DEVELOPMENT-AUDIT-2026-10-03.md)。用户随后确认三项推荐方案并恢复隔离开发，决定见 [DECISIONS](DECISIONS.md) D-0025。当前验证见 [UI-REGRESSION](UI-REGRESSION.md)：QA-004 已隔离完成，P0-006 已修复并等待真实大库验收；P0-019 已复现并修复锁接管覆盖，等待真实多窗口验收；其他未收口任务保留原退出条件。`done_isolated` 和 `host_pending` 不进入开发认领队列。

> **2026-10-05 隔离增量：** 单测 `508/508`，桌面 UI `315/315`，390px UI `316/316`，宿主样式 UI `315/315`，`pnpm check` 0 errors / 0 warnings。联系人分页改用权威 `rowCount` 收口并恢复本人标记；组织标记新增真实 v3.8.6 `root_id` keyset 分页、重复标记一致性阻断、文档批量回读、首屏后台续读和失败重试；多插件并行 E2E `3/3`。真实组织分页 spike 通过，Host Queue、10k 规模预算、真机和原生图面板仍保留原退出条件；不连接日常思源工作区。

依赖开放口径：`done_isolated` / `host_pending` 仅开放不依赖真实宿主结论的隔离开发；真实端点、真机与多窗口结论仍由 Host Queue 守门。`ready` 必须满足所有实现前置；`partial` 表示已有代码，不代表剩余步骤的依赖已满足。

### Ready / Partial Queue（可先认领或补余项）

优先收口：无可独立开发的实现卡。B13-003/005/006、B12-001/002/003、P0-011/014/020、B11-001～004、B13-001/002、B14-001/003/004、AI、IMP、UX-003/004 与 QA 门禁已隔离完成；真实宿主范围留 Host Queue。最终完整门禁见 UI-REGRESSION；不用定向回归代替完整回归。

可独立认领：无。`AG-P0-010` 的桥 v2 能力边界已按推荐方案采纳并完成隔离证据；新端点仍须实证。新增任务仅收口已有功能，不授权扩大业务范围；涉及存储并发的隔离开发可使用 AG-P0-019 已保存证据，真实多窗口完成声明仍需宿主验收。

持续门禁：`AG-QA-001`、`AG-QA-002` 已完成本轮隔离门禁；后续只在源码或契约继续变化时重跑。

### Dependency Queue（完成后才开放）

无。原依赖队列已按本轮隔离验收关闭；不存在的 `AG-B14-006` / `AG-AI-004` 不再出现在队列。

已有隔离证据，不重做原实现：`AG-P0-002`、`AG-QA-004`；`AG-P0-003` 仅补写后核实与服务故障回归。宿主待验与增量回归：`AG-P0-001/005/006/019`、`AG-B14-002/005`。

### Host Queue（隔离实现不能直接标 done）

`AG-HOST-001` 原生图打开与 `siyuan://blocks` 成边、`AG-HOST-002` B13 组织/成员真机与多窗口刷新、`AG-HOST-003` 任务块全量对账、`AG-HOST-004` 移动端 390px/软键盘/系统返回、`AG-HOST-005` 原型关键旅程真宿主复核、`AG-HOST-006` 用户五项反馈的真实读写验收。

2026-10-04 进展：`AG-HOST-003` 的 v3.8.6 隔离内核 spike 通过任务块创建、扫描、勾选/取消、批量标记、自定义关联属性保留、删除反查和 ID 分页；`AG-HOST-001` 的图数据 spike 通过 refs 双向边和 `getGraph/getLocalGraph` 形状核对，并确认普通 Markdown `siyuan://blocks/<docId>` 链接不会形成 refs 边，原生图面板打开仍需真实前端入口与成边方案。`AG-HOST-002` 已在真实 browser-desktop 同源双页面验证稳定 ref 建档和互动 ref 幂等，并在单页面真实 UI 验证组织改名、成员编辑、归档恢复和刷新；组织/成员双窗口刷新仍待补证。`AG-HOST-006` 已通过同一隔离工作区的 9 项实际服务重启回读及 browser-desktop 生日、账本、别名、跟进、组织 UI/重载回读和截图；多人事项的真实 UI 捕获弹窗、真实用户工作区、原生图、真机和系统行为仍不能由隔离证据替代。详见 `docs/verification/REAL-FRONTEND-2026-10-04.md`。

2026-10-05 真实双页面增量：同一隔离 browser-desktop 的两个页面中，第一页面改名组织、编辑成员职位、归档并恢复组织后，第二页面均通过数据变化事件原地回读，无浏览器重载；人物/互动稳定 ref 幂等仍通过。组织成员对应人物文档投影的第二页面专门核对、真实用户工作区和真机仍保留 Host Queue。

2026-10-05 增量：`AG-E2E-001` 已隔离完成。并行编排器实际同时运行桌面、390px 和实际服务三项作业，结果 `3/3`；端口、临时工作区、浏览器 profile、证据和日志互不复用，失败作业继续执行其他作业，清理只针对本轮持有的进程。真实宿主认证、真机和日常工作区继续由 Host Queue 守门。

2026-10-05 真实隔离前端复核：`services-flow` 的实际服务链保持 `9/9`，`browser-desktop` 真实前端 `realFrontend=true`；生日、账本新增/结清/重开、别名、跟进任务块、组织改名/成员编辑/归档/恢复、页面重载回读、组织改名/成员职位/归档恢复跨窗口原地刷新、双页面人物 ref 和互动 ref 幂等均通过。捕获来源文档仍因宿主 `openFileByURL` 返回 `Uncaught` 未打开，捕获 UI 不标完成；组织成员对应人物投影、真实用户库、原生图面板和真机仍由 Host Queue 验收。

### Deferred / Candidate Queue

类型化关系库、纪念日/礼物/周回顾、地图/日历、OCR/二维码、嵌套组织、Agent 自动行动、复杂推荐和任何尚未完成隐私/契约评估的候选只能进入 `AG-RF-*`，不得从原型按钮直接开发。

## 4. 任务 DAG 和原子任务卡

### W1：P0 数据可信和生命周期

依赖：无。此波完成前不新增会写联系人、组织、图谱或 AI 的主流程。

#### AG-P0-001 — 关闭路径的 busy 守卫统一化

- **状态 / 类型 / 优先级：** `host_pending` / `domain+ui+test` / P0 / M2。
- **用户结果：** 捕获、迁移、恢复、扫描、体检、导出和字段修复进行中时，关闭、Esc、遮罩、切页都不会静默丢失操作。
- **来源与证据：** `CODE-02.1`；已有 `src/components/close-guard.ts` 和 Settings/Capture 接入，仍需覆盖所有新增入口。
- **依赖 / 阻塞：** 无；阻塞所有会引入新的异步高风险弹窗的任务。
- **允许触碰：** `src/components/close-guard.ts`、`src/components/SettingsView.svelte`、`src/components/capture/CaptureDialog.svelte`、涉及高风险 Dialog、对应测试。
- **步骤：** 盘点所有 `LvctDialog` 关闭路径；统一 busy/dirty/可安全关闭状态；为原生 Dialog、系统返回和路由切换补守卫；记录用户选择和焦点恢复。
- **测试与验收：** 注入挂起 Promise，逐一触发 X/Esc/遮罩/切页/返回；挂起时草稿和任务仍在，完成或取消后才允许关闭；`pnpm check && pnpm test`，受影响 UI smoke 通过。
- **失败/回滚：** 守卫状态未知时阻断关闭；不自动取消写入；回滚只撤销接入点，不删除既有草稿。
- **宿主：** 隔离完成后 `host_pending`，需真机系统返回复核。
- **本次证据：** 统一 `busy/dirty` 关闭裁决；未知状态 fail-closed；X/Esc/遮罩/工作台切页均经 close scope；挂起时保留草稿与任务；完成或取消后恢复关闭；守卫弹窗支持焦点恢复与 Tab 循环；移除批量导出的原生确认绕过路径。
- **证据路径：** `src/domain/close-policy.ts`、`src/components/close-guard.ts`、`src/components/LvctDialog.svelte`、`src/components/SettingsView.svelte`、`src/components/capture/CaptureDialog.svelte`、`src/components/people/PeopleView.svelte`、`src/components/people/ImportDialog.svelte`、`src/components/org/OrgManagerDialog.svelte`、`src/components/dashboard/ReviewReportDialog.svelte`、`tests/close-policy.test.ts`。
- **测试结果：** `pnpm check` 通过（0 errors / 0 warnings）；`pnpm test` 通过（232/232）；UI smoke 中本任务相关的 busy 独立阻断与保存后离开用例通过。
- **UI 回归边界：** 本次 UI smoke 仍有既有数据刷新乱序与 B11.3/B11.5 身份改绑失败，另有 Windows 临时目录 `EPERM` 清理竞态；均未归因于本任务改动，需按原任务继续处理。

#### AG-P0-002 — 迁移与恢复的严格读取、校验和模块报告

- **状态 / 类型 / 优先级：** `done_isolated` / `contract+domain+data+service` / P0 / M2。
- **用户结果：** 坏包、未知 schema、单模块读取失败和写后回读失败都不会被显示为“恢复成功”或清空现有数据。
- **来源与证据：** `CODE-02.2/02.3`、`FUNC-01.6/C08`；`src/services/migration-bundle.ts`、`src/data/storage.ts`。
- **依赖 / 阻塞：** 依赖 DATA-CONTRACT 迁移章节；阻塞备份恢复 UI 和后续 schema 任务。
- **允许触碰：** `docs/DATA-CONTRACT.md`（仅新增证据）、`src/domain/*backup*`、`src/services/migration-bundle.ts`、`src/data/storage.ts`、迁移测试。
- **步骤：** 定义版本/未知字段/坏子结构语义；逐模块 strict read；预览阶段零写入；锁内按模块合并；写后回读并输出成功/跳过/失败/未知。
- **验收：** 任一模块失败时其余模块结果仍可核对；坏包不污染现有库；重复恢复幂等；`pnpm check && pnpm test` 和故障注入测试通过。
- **失败/回滚：** 只回滚本批新增键或使用备份包，不覆盖并发新值；未知结果不能自动重试。
- **宿主：** 隔离证据后，真实工作区恢复由 `AG-HOST-005` 复核。
- **本次证据：** 迁移包预览和确认共用严格解析；未知模块、模块版本错误、字段容器损坏和非法导出时间均在预览阶段拒绝；保留逐模块失败报告和坏库不覆盖语义。
- **证据路径：** `docs/DATA-CONTRACT.md`、`src/services/migration-bundle.ts`、`scripts/e2e/ui/smoke.js`。
- **测试结果：** `pnpm check` 通过；`pnpm test` 通过（216/216）；迁移包 UI smoke 新增损坏模块与未知模块拒绝断言。
- **UI 回归边界：** 迁移相关 smoke 通过；全量 UI 回归为 101/103，剩余失败属于 `FUNC-01.7-a` 与 B11 指定本人身份既有用例，另有 Windows 临时目录 `EPERM` 清理竞态，均不属于本任务改动。
- **负责人 / 更新时间 / 提交：** `Codex` / `2026-10-02` / 未提交。

#### AG-P0-003 — 设置映射与字段写入的逐步断点

- **状态 / 类型 / 优先级：** `host_pending` / `contract+domain+service+ui+test` / P0 / M2。
- **2026-10-04 重开与认领：** Codex / Newton；旧设置修复入口未在锁内重读，补建中断可能重复建列，重绑未核对笔记本/文档/数据库块/AV 四层归属。补只读影响预览、全映射去重、逐列稳定断点与写后核实；延迟结果不得投递到已卸载页面。
- **用户结果：** 非法日期/邮箱、缺列、类型不符和中途字段失败不会产生半真半假的联系人；已成功字段可以安全补写。
- **来源与证据：** `CODE-02.4`、`FUNC-01.15`；`src/domain/fields.ts`、`src/services/contacts.ts`、`src/services/init.ts`。
- **依赖 / 阻塞：** 依赖现有字段契约；阻塞 B11/B12 新字段写入。
- **允许触碰：** `src/domain/fields.ts`、`src/domain/contact-patch.ts`、`src/services/contacts.ts`、`src/services/init.ts`、相关测试。
- **步骤：** 统一 draft 校验和列映射；每字段隔离写入并记录 checkpoint；重试只补失败字段；编辑、批量和 vCard 复用同一结果模型。
- **验收：** 注入一个字段失败时其余字段结果可见，重试不重复建文档/行；旧值不会因非法输入被清空；域、服务、回归测试通过。
- **失败/回滚：** 保留已成功字段并显示行 ID；禁止把局部成功标全成功。
- **本次证据：** 新增统一 `ContactWritePlan/Report`；新建、编辑、批量、补录和 vCard 共用写前映射校验、逐字段隔离写入与失败字段重试；非法日期在写入前拒绝；批量 UI 保留逐项失败字段并支持只重试失败字段；公开 `updatePersonFields` 返回逐字段报告。
- **证据路径：** `docs/DATA-CONTRACT.md`、`src/domain/contact-write.ts`、`src/services/contacts.ts`、`src/services/vcard.ts`、`src/components/people/PeopleView.svelte`、`scripts/e2e/ui/smoke.js`。
- **测试结果：** `pnpm check` 通过（0 errors / 0 warnings）；`pnpm test` 通过（219/219）；UI smoke 的 CODE-02.4 字段失败断言通过，全量为 101/103，剩余为既有 B11 指定本人身份失败与 Windows 临时目录 `EPERM` 清理竞态。
- **2026-10-03 重新打开的余项：** `executeContactWritePlan` 在 `setCell` 成功返回后直接记 applied；编辑/重试路径没有字段值回读比对，新建仅确认名册中存在该文档。补一次写后渲染并逐字段对账（生日/农历/清空/多值），将请求接受、值已核实、失败和未知分开，回读失败不得宣称保存完成；响应 code=0 但值未改变必须被服务 fixture 检出。此前实现与历史证据保留，不重做映射及逐字段写入。
- **2026-10-04 收口证据：** 已补逐字段写后核实及 accepted/applied/failed/unknown，修复 1970 年前生日回读；连续生日、农历、清空、多值和 code=0 未应用故障均直接调用产品服务验证，批量、vCard、AI 候选复用核实及重试。桌面 127/127、390px 128/128、构建通过；真实内核持久化由 HOST-006 复核。
- **负责人 / 更新时间 / 提交：** `Codex` / `2026-10-02` / 未提交。

#### AG-P0-004 — 关系并发写入与文档投影补偿

- **状态 / 类型 / 优先级：** `done_isolated` / `data+service+test` / P0 / M2。
- **用户结果：** 两个窗口同时编辑相关人时不丢边；文档区块投影失败可单独重试，不损坏关系事实。
- **来源与证据：** `CODE-02.5`；`src/services/relations.ts`、`src/domain/relations.ts`。
- **依赖 / 阻塞：** AG-P0-003；阻塞 B13/B14 共同背景和图谱增强。
- **允许触碰：** `src/services/relations.ts`、`src/domain/relations.ts`、`src/domain/graph.ts`、`src/services/doc-section.ts`、`src/api/blocks.ts`、`src/components/people/PersonDetail.svelte`、关系通知与并发测试；不新增内核端点。
- **步骤：** 锁内回读最新 relation；写后回读；关系事实和文档投影分层报告；失败项保存可重试指针；跨窗口广播后刷新最新值。
- **验收：** 过期快照建关系不丢并发边；投影失败不回滚关系但明确标记；重复重试无重复边。
- **宿主：** 多窗口真宿主由 `AG-HOST-002` 验收。
- **2026-10-04 收口：** 关系事实锁内重读、写后核实与双方标记投影已分层；只补失败文档时读取当前关系，不恢复旧边。实际服务回归覆盖并发旧快照、反向幂等、解除、code=0 未应用、响应丢失、投影部分失败、重复标记和投影回读未知，4/4 通过。初始夹具缺少 insert action 已修复，未放松生产解码；全量 UI 与宿主结论分别登记。
- **负责人 / 更新时间 / 提交：** `Codex-P0-004` / `2026-10-04` / 未提交。

#### AG-P0-005 — kernelPost 超时、取消和严格解码

- **状态 / 类型 / 优先级：** `host_pending` / `api+domain+test` / P0 / M2。
- **用户结果：** 内核慢、协议异常、合法空结果和用户取消分开显示，不会把错误变成“没有数据”。
- **来源与证据：** `CODE-02.6`；`src/api/client.ts`、`src/shared/async.ts` 已有 timeout 基线。
- **依赖 / 阻塞：** 无；阻塞所有新端点和大数据查询任务。
- **允许触碰：** `src/api/client.ts`、`src/api/*.ts` 的形状解码、`src/shared/async.ts`、API 测试。
- **步骤：** 为读写调用声明 deadline；严格校验响应形状；区分 timeout/abort/protocol/permission/empty；不自动重试写请求。
- **验收：** 注入超时、非数组、缺字段、合法空数组和取消，调用方都得到不同状态；`pnpm test` 通过。
- **本次证据：** `kernelPost` 统一默认 15s deadline，支持每次请求的 `timeoutMs` 和 `AbortSignal`；严格解码信封、笔记本列表、文档导出、SQL 数组、映射、事务结果、属性视图和图数据；超时、取消、传输、权限、内核失败与协议异常分别保留类型；合法空数组与允许空写入不再被误报；写入没有自动重试。
- **证据路径：** `src/api/client.ts`、`src/api/kernel-contract.ts`、`src/api/av.ts`、`src/api/blocks.ts`、`src/api/graph.ts`、`src/shared/async.ts`、`tests/kernel-contract.test.ts`、`tests/shared-async.test.ts`、`docs/DATA-CONTRACT.md`、`docs/DECISIONS.md`。
- **测试结果：** `pnpm check` 通过（0 errors / 0 warnings）；`pnpm test` 通过（239/239）。
- **宿主边界：** 未在真实思源内核验证 `fetchPost` 的失败回调载荷、各写端点成功 `data` 是否为空及真实取消时序；保留 `host_pending`，不把隔离测试当作宿主完成。
- **负责人 / 更新时间 / 提交：** `Codex` / `2026-10-03` / 未提交。

#### AG-P0-006 — 初始化锚点扫描分页、截断和续做

- **状态 / 类型 / 优先级：** `host_pending` / `service+api+ui+test` / P0 / M2。
- **用户结果：** 大工作区中不会因为 1000 篇上限漏掉候选；用户能看到扫描范围、截断和继续方式。
- **来源与证据：** `FUNC-01.8a`；`src/services/init.ts`、`src/api/blocks.ts`、`scripts/spike/init-resume-spike.mjs`。
- **依赖 / 阻塞：** AG-P0-005；阻塞 B11 初始化默认本人。
- **允许触碰：** `src/api/blocks.ts`、`src/services/init.ts`、`src/components/InitWizard.svelte`、`src/components/SettingsView.svelte`、`src/domain/init-plan.ts`、facade 类型与设置页 fixture、测试/spike。
- **步骤：** 先确认可用分页参数或采用已验证的分段读取；记录游标/总数/上限；扫描每本笔记本的候选；遇到未知读取或歧义停止写入；支持安全续做。
- **验收：** 1000+ 文档 fixture 能继续扫描且显示截断；多 AV、零匹配、并列匹配不自动采纳；重复点击零重复创建。
- **宿主：** 新分页端点先 spike；真实大库验证列入 `AG-HOST-005`。
- **已有增量：** 稳定 ID 分页、短页耗尽判定、三态响应、失败前游标、候选合并和继续入口已落盘；域层游标测试通过，但未验证实际续扫服务链。
- **2026-10-03 质量缺口：** `scannedDocuments` 从游标恢复累计数量后仍与单次 `maxDocuments` 比较；第一次达到 1000 后，继续扫描立即返回同一截断游标，无法前进。必须分离单轮预算与累计进度，测试至少 1501 篇跨三次调用、恰好 1000 篇、跨笔记本、失败后重试和总数未知。
- **快照边界：** 明确扫描中新增/移动文档的可见性，不宣称强一致快照；笔记本排序变化不应被误认为集合变化。候选数与扫描数分清本轮/累计，完整性提示如实显示。
- **本次修复及证据：** 单次预算从游标恢复点重新计算，累计计数保持不变；进度新增 `documentsScannedThisCall`，笔记本按稳定 ID 排序；总数只展示，不代替短页/空页耗尽证明。直接调用实际 `scanAnchorCandidates`，1501 篇按 600/600/301 跨三轮完成；恰好 1000 篇继续核实空页；覆盖空本、跨本、顺序变化、增删本、未知总数、文档页失败和字段失败后重试。设置页实际服务 fixture 核实候选跨轮去重、本轮/累计显示、完成后停止续做及扫描可见性说明，未发出写请求。
- **测试结果 / 证据路径：** `pnpm check` 0 errors / 0 warnings；`pnpm test` 247/247；桌面 110/110、390px 111/111；构建通过。`src/services/init.ts`、`src/components/SettingsView.svelte`、`scripts/e2e/ui/smoke.js`、`docs/UI-REGRESSION.md`。真实思源 1000+ 文档、扫描中移动/新增和四锚点验证仍由 `AG-HOST-005` 验收。
- **负责人 / 更新时间 / 提交：** `Codex` / `2026-10-03` / 未提交。

#### AG-P0-007 — 联系人字段保真与支持边界

- **状态 / 类型 / 优先级：** `done_isolated` / `domain+service+ui+test` / P0 / M2。
- **用户结果：** 卡片、详情、编辑、导入和文档档案条只展示真实支持的字段，未支持字段不会被伪装保存。
- **来源与证据：** `FUNC-01.9`、`UX-03.31/38/39`；联系人 AV 九字段契约见 `DATA-CONTRACT.md §1`。
- **依赖 / 阻塞：** AG-P0-003；阻塞 B12 资料投影和导入扩展。
- **允许触碰：** `src/domain/fields.ts`、`src/domain/person.ts`、联系人组件、vCard/import 测试。
- **步骤：** 建立字段来源矩阵；删除原型中无契约控件；导入映射显示支持/忽略/需人工确认；编辑、导出和简报复用同一投影。
- **验收：** ORG/ADR/PHOTO 等不支持字段明确忽略；空、无权限和旧库字段可解释；UI/域测试通过。
- **2026-10-04 收口：** 来源和导入/导出边界见 `docs/FIELD-SUPPORT.md`；vCard 未映射属性明确忽略，非法/无年份日期提示人工核对；联系人、组织、捕获和 vCard 对内核不能原文保留的名称写前拒绝。域与定向实际服务回归通过；真实宿主字段持久化由 HOST-006 复核。导入建档未知结果的新增缺口单独重开 P0-014，不扩大本卡完成声明。

#### AG-P0-008 — 原生待办全量对账

- **状态 / 类型 / 优先级：** `host_pending` / `api+service+e2e` / P0 / M2。
- **用户结果：** 旧任务、已关闭任务、删除任务和插件索引不一致时，首页不会冒充同步成功。
- **来源与证据：** `CODE-02.11`、`FUNC-01.3`；`src/services/followup-sync.ts`、`src/domain/followup-doc.ts`、`scripts/spike/task-item-spike.mjs`。
- **依赖 / 阻塞：** AG-P0-005；阻塞跟进批量和提醒重算。
- **允许触碰：** follow-up domain/service/api、首页和任务测试；如需端点先 spike。
- **步骤：** 分离索引状态、文档同步状态和未知状态；按全部历史受控任务对账；输出可定位失败项；支持只重试失败模块。
- **验收：** 第 6 条及更早关闭任务仍可回读；文档失败时索引不标一致；删除、改标题、改日期均有逐项结果。
- **宿主：** 真内核任务行由 `AG-HOST-003` 验收。
- **本次证据：** 全量读取 follow-ups 索引，不再复用仅展示最近五条关闭事项的列表；任务 SQL 按 `type='i' AND subtype='t'`、稳定 ID 游标分页，先 flush 后读；索引、文档、未知三态分离；逐项报告包含人物文档、跟进 ID、块 ID、动作、变化和两侧状态。删除、改标题、改日期、非法日期、重复关联键和已接受但回读未收敛均有安全结果；pending checkpoint 保留失败意图，重试限定失败事项且不重复插入。实际 UI 服务链已覆盖旧任务、块删除、DOM 插入、写后回读失败和只补失败项。
- **证据路径：** `docs/DATA-CONTRACT.md` §3.2、`src/api/followup-tasks.ts`、`src/domain/followup-doc.ts`、`src/services/followup-sync.ts`、`src/services/dashboard.ts`、`scripts/spike/task-item-spike.mjs`、`scripts/spike/task-item-results.json`、`scripts/e2e/ui/followup-regression.js`、`tests/followup-doc.test.ts`、`tests/followups.test.ts`。
- **测试结果：** 隔离内核 v3.8.6 spike 15/15 通过；独立 follow-up regression 2/2 通过；主 UI 桌面 132/132、390px 133/133 功能断言通过；`pnpm check` 0 errors / 0 warnings；`pnpm test` 276/276；真实浏览器退出偶发超时只影响 runner 收尾，不影响已上报断言。
- **宿主边界：** 真实用户工作区任务全量对账、其他任务管理器互读、跨窗口/网络故障后的宿主呈现仍由 `AG-HOST-003` 验收；本卡保留 `host_pending`。
- **负责人 / 更新时间 / 提交：** `Codex-AG-P0-008` / `2026-10-04` / 未提交。

#### AG-P0-009 — 偏好最新值、请求代次和跨窗口刷新

- **状态 / 类型 / 优先级：** `done_isolated` / `data+service+ui+test` / P0 / M2。
- **用户结果：** 快速切换主题、设备、默认图谱和提醒阈值时，旧响应不会覆盖最新意图。
- **来源与证据：** `CODE-02.12`、`FUNC-01.7`；`src/data/preferences.ts`、`src/services/preferences.ts`、`src/libs/data-events.ts`。
- **依赖 / 阻塞：** AG-P0-005；阻塞 UI 状态包。
- **允许触碰：** 偏好 data/service、事件总线、Workbench/Settings、测试。
- **步骤：** 写入串行化并锁内回读；请求代次取消过期响应；跨窗口事件携带版本；页面读取失败保持未知。
- **验收：** 快速连续修改最终值稳定；另一个窗口最终显示最新值；读失败不显示默认空。
- **本次证据：** 偏好读取仅将缺失键归一为默认；坏结构、未知 schemaVersion、非法 revision 和读取/写后回读失败均显式保留未知状态；锁内重读并按编辑基线合并字段差异，revision 单调递增；工作台/设置页用请求代次保护最新响应并在刷新时保留草稿；事件携带广播 revision，防抖刷新携带已核实偏好 revision；卸载清理启动/刷新定时器与订阅。
- **证据路径：** `docs/DATA-CONTRACT.md` §3.4、`src/data/preferences.ts`、`src/domain/preferences-concurrency.ts`、`src/services/preferences.ts`、`src/libs/data-events.ts`、`src/index.ts`、`src/components/Workbench.svelte`、`src/components/SettingsView.svelte`、`tests/preferences.test.ts`。
- **测试结果：** `pnpm check` 通过（svelte-check 0 errors / 0 warnings）；`pnpm test` 通过（275/275）；未运行 UI smoke。
- **宿主边界：** 真实思源多窗口事件投递、宿主 `loadData/saveData` 回读时序及无 Web Locks 的跨窗口排他性仍需 Host Queue 验收；本卡保持 `done_isolated`。
- **负责人 / 更新时间 / 提交：** `Codex-P0-009` / `2026-10-04` / 未提交。

#### AG-P0-010 — 外部桥并发、输入校验和逐项结果

- **状态 / 类型 / 优先级：** `done_isolated` / `contract+bridge+service+test` / P0 / M3。
- **本次认领：** Codex-Leibniz，按已授权推荐采纳最小能力与幂等协议，先契约后实现，不扩大桥业务；同名消歧和未知重放守门。
- **用户结果：** 外部打卡/桥接不会因重复请求建档、写孤儿互动或把同名人物混为一人。
- **来源与证据：** `CODE-02.13`、`FAST-01.6`；`src/bridge/*`、`src/services/contacts.ts`、`src/services/interactions.ts`。
- **依赖 / 阻塞：** AG-P0-003；阻塞桥协议扩展。
- **允许触碰：** `src/bridge/`、桥契约文档、相关 domain/service/test。
- **步骤：** 明确能力声明和幂等键；校验 docId/itemId；同名只返回候选；批量逐项报告成功/跳过/失败/未知；并发时锁内复核。
- **验收：** 重放相同事件零重复；未知 ID 不写孤儿；同名不同文档可消歧；桥不可达不影响本地手动流程。

#### AG-P0-011 — 路径、Markdown 和受控日期编码

- **状态 / 类型 / 优先级：** `done_isolated` / `domain+api+service+test` / P0 / M2。
- **用户结果：** 姓名含空格、斜杠、换行、`[]()#` 时不会生成错误路径、链接或任务日期。
- **来源与证据：** `CODE-02.14`；建档、vCard、桥和任务同步共用写入路径。
- **依赖 / 阻塞：** AG-P0-003；阻塞外部导入和组织改名扩展。
- **允许触碰：** `src/domain/format.ts`、建档/导入/任务 service、API path helpers、测试。
- **步骤：** 统一路径编码和 Markdown 上下文转义；链接标签与目标分离；日期只解析受控标记；覆盖中文和特殊字符 fixture。
- **验收：** 文档可打开、原文标题保留、任务到期日正确；导入/桥/手动建档行为一致。
- **2026-10-04 收口证据：** 真内核实证后统一路径分段验证和 Markdown 上下文转义；不能保真的斜杠/控制字符明确写前拒绝，支持的原文名称保留。嵌套文档改名先核实物理路径/笔记本，写后核实标题；code=0 未应用报告未知，重复已应用零写入。跟进仅解析任务行末尾合法日期。完整域/服务/API/界面测试通过；完整桌面 159/159、390px 160/160，真实用户宿主留 HOST-006。

#### AG-P0-012 — 体检的成功、失败、未知和修复边界

- **状态 / 类型 / 优先级：** `done_isolated` / `domain+service+ui+test` / P0 / M2。
- **用户结果：** 读取失败不会显示为“无互动/无成员/无问题”；用户可以只重试失败模块并知道影响。
- **来源与证据：** `CODE-02.15`、`FUNC-01.4`；`src/domain/health-audit.ts`、`src/services/health-audit.ts`、`ReviewReportDialog.svelte`。
- **依赖 / 阻塞：** AG-P0-005、AG-P0-009；阻塞组织/本人健康入口。
- **允许触碰：** health domain/service/UI、测试。
- **步骤：** 为名册、互动、跟进、组织成员、本人身份分模块结果；区分未发现、读取失败、未核实；修复前显示目标和影响；只重试失败项。
- **验收：** 注入权限/超时/坏 JSON 时报告为未知或失败；修复零写入预览，成功后可复核；页面不使用空态冒充故障。
- **本次实现：** 五模块报告区分成功、失败、未知及读取证据；严格解析坏库，不吞本人身份失败；普通完整度/提醒排除本人且合法本人关系不报悬空；组织孤儿、重复记录/历史、异常期间与本人绑定失配单列。修复只提供目标/影响与零写入预览；失败保留旧问题待复核，重试只读取失败模块，再用已核实内存快照重算依赖；超时晚响应不能改旧报告。数组兼容入口未完成时抛附带报告的异常，回顾弹窗初次失败不显示区间空态。
- **证据路径：** `src/domain/health-audit.ts`、`src/services/health-audit.ts`、`src/components/dashboard/ReviewReportDialog.svelte`、`tests/health-audit.test.ts`、`tests/health-audit-ui.test.mjs`、`scripts/e2e/ui/health-audit-regression.js`、`docs/DATA-CONTRACT.md` 健康语义。
- **定向验证：** 域/回顾/架构 21/21；最终 `pnpm check` 0 errors / 0 warnings。独立实际服务与页面回归首轮桌面 8/8、390px 8/8；补组织/身份服务用例后 390px 9/9，桌面轮在 `Page.navigate` 10 秒超时，未进入功能断言；保留该运行器失败，不宣称最终桌面门禁已通过。
- **冻结与接线边界：** 生产设置页已接入 `auditWorkspaceDataReport` 与 `retryFailedHealthAuditModules`，弹窗按模块展示结果并提供失败项重试；后续只需真实宿主核对读取错误载荷、持久化、缓存和跨窗口行为。
- **2026-10-04 接线收口：** 主任务已补 facade/index/Settings 生产接线，复用体检模块面板；支持完整重核时保留旧问题、只重试失败模块、零写入预览及按 itemID 查看联系人。忙碌时不切设置分区，卸载后不回填。独立服务与页面 10/10，统一定向回归包含本卡全绿；旧接线缺口已消除，真实宿主保持待验。
- **宿主边界：** P0-005/P0-009 隔离依赖已满足；真实宿主的读取错误载荷、持久化、缓存和跨窗口行为仍 pending，未提交、推送或安装。
- **负责人 / 更新时间 / 提交：** `Codex-AG-P0-012` / `2026-10-04` / 未提交。

#### AG-P0-013 — 生命周期和延迟回调清理

- **状态 / 类型 / 优先级：** `host_pending` / `service+ui+test` / P0 / M2。
- **用户结果：** 关闭 Tab/Dialog、切换窗口或卸载插件后，旧回调不会刷新旧实例、抢焦点或重复挂载。
- **来源与证据：** `CODE-02.16`；`src/index.ts`、`src/components/WorkbenchRoot.svelte`、事件/定时器代码。
- **依赖 / 阻塞：** AG-P0-001、AG-P0-009；阻塞多窗口验收。
- **允许触碰：** 生命周期入口、events、异步 helper、相关测试。
- **步骤：** 为回调绑定实例 token；卸载时清理 listener/timer；回调前确认实例存活；重复挂载自动去重。
- **验收：** 关闭后延迟回调无可见副作用；快速开关工作台不重复订阅；`pnpm test` 与 UI smoke 通过。
- **本次实际改动：** `src/index.ts`、`src/components/Workbench.svelte`、`src/libs/data-events.ts`、新增 `src/domain/lifecycle.ts`、`tests/lifecycle.test.ts` 和独立 `scripts/e2e/ui/lifecycle-regression.js`。插件→Tab/Dialog→Workbench 通过挂载 context 传递实例 token；关闭时先失效再清理 listener/timer；Tab 按宿主 element 去重并由插件卸载主动销毁；旧菜单/启动/视图/数据变化回调验证原实例存活。沿用 P0-009 `createPreferenceRequests`，每次加载独立创建控制器，阻止旧保存回调在重新启用后复活；不修改 Settings、Capture、PersonDetail、OrgManagerDialog 或主 smoke。
- **隔离证据：** 定向 `node --test tests/lifecycle.test.ts tests/preferences.test.ts tests/shared-async.test.ts tests/close-policy.test.ts tests/architecture.test.ts` 为 36/36；`pnpm check` 0 errors / 0 warnings；`pnpm test` 286/286。独立 Chromium/Svelte 生命周期 UI 4/4：父 token 销毁阻断延迟偏好与防抖且不抢焦点、12 次挂载销毁后零残留监听、仅存活实例刷新、视图事件按 facade 隔离。新增测试单独执行，未改 package.json 的显式测试列表。
- **当前边界：** 当前隔离门禁已通过；真实思源 Tab/Dialog 的重复 init/destroy 顺序、移动端关闭/重开、卸载/重新启用和跨窗口投递仍待 Host Queue。`person-panel.ts` 独立订阅/渲染与桥内异步过程继续沿用各自生命周期边界；已发出的业务写入不因视图卸载而回滚。
- **证据路径 / 回滚：** 上述测试和独立 UI 脚本；本轮日志为 `%TEMP%/AG-P0-013-check.log`、`%TEMP%/AG-P0-013-test.log`、`%TEMP%/AG-P0-013-main-ui.log`。仅撤回本卡新增 token/挂载清理及本卡文档段落，保留 P0-009 和其他并行任务的工作区改动；未提交、未推送、未安装。
- **2026-10-04 增量收口：** 生命周期和捕获域测试已纳入完整测试入口。人物文档档案条也绑定实例 token，卸载清理订阅/待响应请求；名册及组织异步读取之后再次核对人物与实例，不在新文档回填旧档案。统一定向生命周期 5/5，包括组织读取中销毁/切文档、12 次挂载与两实例隔离。外部桥调用中的业务结果和并发由 P0-010 单独处理，真实 Tab/Dialog/多窗口保留 host_pending。
- **负责人 / 更新时间 / 提交：** `Codex-AG-P0-013` / `2026-10-04` / 未提交。

#### AG-P0-014 — 捕获、导入和 AI 多步写入的部分失败模型

- **状态 / 类型 / 优先级：** `done_isolated` / `domain+service+ui+test` / P0 / M3。
- **用户结果：** 一次笔记包含多个参与者时，已成功、跳过、失败和未知项分别可核对，重试不会重复写入。
- **来源与证据：** `FUNC-01.5`、`CODE-02.7/02.9`、`UX-03.18/37`；`src/services/capture.ts`、`src/components/capture/CaptureDialog.svelte`。
- **依赖 / 阻塞：** AG-P0-001、003、005；阻塞 AI 预检和批量导入。
- **允许触碰：** capture/import domain/service/UI、统一 OperationResult 类型和测试。
- **步骤：** 定义 item-level 结果与请求代次；写前预览范围；逐项 checkpoint；失败保留原输入；只重试可重试项。多人事项已采用互动事实与文档投影分离、逐目标失败清单和标记块幂等重试。
- **验收：** 取消不写入；部分成功显示可定位错误；旧响应不能覆盖新表单；批量结果可导出诊断摘要。建档、互动、日期/地点/人物投影均按逐人 checkpoint 隔离，未知结果先核实，失败只重试可核实项。
- **新增验收范围：** 以第 2 人建档失败、第 2 人互动失败、alias 歧义、失效人物文档、已写入但回读失败为 fixture；返回逐人 checkpoint，保留原输入，只重试可核实失败项。日期/地点文档、来源标记和人物投影变化时明确旧投影清理/保留策略。
- **已确认决策：** D-0025 第 2 项：历史互动事实保持不变；重复捕获只核实/补齐投影；纠错先预览，再删除错误记录并重新记录；仅可清理插件生成块。无需再次征询同一业务决定，剩余是契约、实现和故障验收。
- **本次证据：** `capture-checkpoint.ts`、捕获 UI 与独立服务回归覆盖第二人建档/互动失败、别名歧义、失效文档、写后回读未知、重复来源和投影补偿；坏别名索引硬停止，不按未匹配新建。桌面 132/132、390px 133/133 功能断言通过。
- **2026-10-04 质量复核重开：** 捕获已完成范围保留；vCard 建档 catch 当前把响应丢失也记为 failed，绑定失败没有稳定文档 checkpoint，重试只看名册同名后可能再建未绑定文档。需要先补稳定请求标记和文档/行断点，未知结果按请求核实，逐字段重试按同一稳定人物 ID，不凭同名选人；补实际服务的响应丢失、未绑定文档、同名冲突与安全重试回归。
- **2026-10-04 vCard 收口：** 请求标记与文档同次创建，报告保留目标锚点、输入、文档/行断点。未知创建先核实唯一原请求；未发现、坏标记、读取失败不重建，同名人物不替代原目标；绑定重试先查原行，字段只补未核实项。同数据库导入串行，变更输入/锚点停写。界面支持不含联系方式的诊断导出，关闭/换文件说明内存断点边界。定向 10/10、完整桌面 168/168、390px 169/169，均退出 0；check、300 单测、构建通过。真实重启/用户库由 HOST-006 验收。
- **负责人 / 更新时间 / 提交：** `Codex-AG-P0-014` / `2026-10-04` / 未提交。

### W1 增补：2026-10-03 已开发增量的质量收口

这些任务由当前源码缺口产生，不新增业务承诺。每张卡的 `forbidden_files` 都包含版本号、CHANGELOG、README 徽章和 `docs/PROGRESS.md`；修改存储语义必须先改契约。未重新认领前 owner 为无。

#### AG-P0-015 — 账本与别名的严格展示读取

- **状态 / 类型 / 优先级：** `done_isolated` / `contract+domain+data+ui+test` / P0 / M2。
- **user_outcome / user_scenario：** 损坏账本、未知版本或别名丢项不能被显示成“还没有记录”，捕获不能把坏别名索引当成未匹配而新建人物。
- **source_ids / current_evidence：** 2026-10-03 审查；`data/exchanges.ts:loadExchangeStore`、`data/person-aliases.ts:loadPersonAliasStore` 严格 I/O 后仍接容错 normalize，坏 schema 变空库、坏条目被静默过滤。
- **depends_on / blocks / parallel_group / preconditions：** AG-P0-005 隔离证据；阻塞新增模块可信展示与识别；storage-read；明确缺键、损坏、部分可读语义。
- **allowed_files / forbidden_files / contract_change / host_or_spike_required：** 两模块 domain/data、人物面板、capture、测试和 DATA-CONTRACT；保护文件；严格读及完整性提示契约；无需新端点，真实坏库另验。
- **ordered_steps：** 先定义三态读取；保持缺键为空；坏版本拒绝且不覆盖；坏条目报告原始数量/定位；捕获在未知别名时停止匹配；面板提供重试而非正常空态。
- **test_fixtures / test_commands / acceptance：** 缺键、空串、未知 schema、坏容器、坏条目、I/O 拒绝；`pnpm check && pnpm test` 加 UI smoke；未知与正常空库可区分，失败零写入。
- **2026-10-04 收口证据：** 严格解析及损坏定位、展示错误与只读重试、捕获坏索引零写入均通过域层和实际服务/UI 故障夹具；桌面 127/127、390px 128/128。参见 DATA-CONTRACT §3 与对应 domain/data/详情面板。
- **failure_retry_rollback / privacy_boundary / performance_budget：** 保留原文件、修复后显式重试；诊断不外发往来正文；一次读取一次解析，不逐条 I/O。
- **evidence_paths / owner / last_updated / commit：** 审查报告与上述代码；Codex；2026-10-04；未提交。

#### AG-P0-016 — 新自管模块的备份覆盖与恢复契约

- **状态 / 类型 / 优先级：** `done_isolated` / `contract+data+service+ui+test` / P0 / M2。
- **user_outcome / user_scenario：** 用户迁移账本、别名等插件事实时，导出范围明确、不静默遗漏；旧备份仍可安全导入。
- **source_ids / current_evidence：** AG-P0-002 增量边界；`migration-bundle.ts` 当前六模块白名单不含 exchanges、aliases、selfIdentity、orgMembership。
- **depends_on / blocks / parallel_group / preconditions：** AG-P0-002 隔离证据；阻塞新模块的迁移完成声明；backup-contract；先做覆盖矩阵，组织恢复实现继续由 AG-B13-005 承担，本人冲突依赖 AG-B11-001。
- **allowed_files / forbidden_files / contract_change / host_or_spike_required：** DATA-CONTRACT、迁移 domain/service/UI、模块 data、测试；保护文件；新增模块版本、冲突/墓碑及 docId 可达性策略；真实工作区恢复走 AG-HOST-005/006。
- **ordered_steps：** 列出全部自管键及支持/明确排除理由；兼容 v1；先补账本/别名导出与零写入预览；不可达 docId 和冲突不得自动关联同名；锁内合并、回读、逐模块报告。
- **已确认决策：** D-0025 第 1 项：全部插件业务事实纳入覆盖矩阵，偏好可选、数据库锚点不自动覆盖；文档 ID 可达性及冲突必须核对，插件包不能宣称包含思源原生文档完整备份。组织/本人模块按既有责任卡接入，不再等待业务范围决策。
- **test_fixtures / test_commands / acceptance：** 旧六模块包、新模块包、坏模块、冲突、孤儿、并发新增、重复恢复；check/test/UI；原始事实完整往返，未知结果不自动重试，未接入模块展示明确提示。
- **failure_retry_rollback / privacy_boundary / performance_budget：** 不覆盖并发事实、保留失败模块原文；导出包含敏感信息需说明范围；按模块批量合并，不逐记录写盘。
- **本次证据：** 覆盖矩阵纳入互动、跟进、节奏、提醒暂缓、收编索引、模板、账本、别名；本人和组织标 pending，偏好/锚点明确排除；账本全历史、别名墓碑、稳定人物文档 ID、冲突/不可达、未知写入和重试包均有服务/UI 故障回归；旧六模块包兼容。桌面迁移回归 5/5、390px 5/5，通过 `pnpm check`、`pnpm test`、构建。
- **evidence_paths / owner / last_updated / commit：** 审查报告、migration-bundle、migration-records、DATA-CONTRACT、migration-regression；Codex；2026-10-04；未提交。

#### AG-P0-017 — 新详情子面板关闭、切人与迟到响应隔离

- **状态 / 类型 / 优先级：** `host_pending` / `ui+domain+test` / P0 / M2。
- **user_outcome / user_scenario：** 编辑或保存账本/别名时，关闭、切页、前后切人和切换详情标签不丢草稿、不把甲的记录显示在乙名下。
- **source_ids / current_evidence：** AG-P0-001 增量守门；ExchangeLedger 与 PersonAliases 未注册自身 busy/dirty；父详情仅守卫互动备注。账本仅 mount 时 load，别名 load 没有请求代次。
- **depends_on / blocks / parallel_group / preconditions：** AG-P0-001 隔离证据；阻塞新面板可用性声明；detail-state；复用 close scope，不旁路原生确认。
- **allowed_files / forbidden_files / contract_change / host_or_spike_required：** 两面板、PersonDetail、Workbench（已守卫导航的重复确认）、close-guard、UI fixture；保护文件；无存储变更；系统返回另入 AG-HOST-004。
- **ordered_steps：** 确认详情 scope 和切标签生命周期；子面板登记 busy/dirty；选人变化清理或保留草稿需用户裁决；加载按 personDocId 与实例代次提交；卸载回调无副作用；恢复焦点。
- **test_fixtures / test_commands / acceptance：** 延迟加载、保存挂起、甲→乙快切、标签切换、X/Esc/遮罩/返回、390px；check/test/UI；甲数据不回填乙，保存中不能关闭，草稿取消零写入。
- **2026-10-04 隔离证据：** 两面板登记 busy/dirty、按人物及请求代次提交、卸载隔离；关闭 scope 聚合子面板。切标签、切人、工作台 X/Esc、保存挂起及失败草稿保留通过桌面 127/127、390px 128/128；系统返回仍交 HOST-004。
- **failure_retry_rollback / privacy_boundary / performance_budget：** 失败保留人物与输入，未核实保存不自动再发；账本不进入无关人物；每实例只保留当前代次。
- **evidence_paths / owner / last_updated / commit：** 审查报告、两个面板和 PersonDetail；Codex；2026-10-04；未提交。

#### AG-P0-018 — 账本创建的稳定请求身份与未知结果核实

- **状态 / 类型 / 优先级：** `done_isolated` / `contract+domain+data+service+ui+test` / P0 / M2。
- **user_outcome / user_scenario：** 保存已落盘但回读失败时，用户重试不会生成第二笔同内容往来。
- **2026-10-04 收口证据：** 表单 requestId 作为记录 ID，锁内核实同请求且核实后不重写；不同请求的同内容保留两笔。落盘后回读失败显示 unknown 并保留输入与键，手动核实重试。实际 data/service/UI 故障用例、桌面 127/127、390px 128/128 已通过，参见 DATA-CONTRACT §3。
- **source_ids / current_evidence：** `createExchangeRecord` 每次调用生成新 ID，append 仅同 ID 幂等；回读失败会使面板保留输入，没有可跨重试的请求身份。
- **depends_on / blocks / parallel_group / preconditions：** AG-P0-005 隔离证据；阻塞账本重试安全；exchange-write；先明确请求键与正常重复业务记录区别。
- **allowed_files / forbidden_files / contract_change / host_or_spike_required：** exchange domain/data/service/facade/UI、测试和契约；保护文件；稳定请求身份、确认/失败/未知状态；同源并发先隔离验证。
- **ordered_steps：** 表单创建稳定请求 ID；锁内查同请求；写后核实；未知时先查已存记录再允许重发；成功/显式新一笔才换键；不能按内容把两笔真实往来误合并。
- **已确认决策：** D-0025 第 3 项：可靠记录、更正、结清/重开/取消、安全重试和备份；不增加利息、分期、催还、汇率或人情评分；不同币种不合计，全局总览另排。
- **test_fixtures / test_commands / acceptance：** 保存后回读拒绝、同请求并发、再次提交、同内容两笔不同请求；check/test/UI；单请求最多一条事实，合法重复业务可保留。
- **failure_retry_rollback / privacy_boundary / performance_budget：** 已保存不回滚，未知先核实，不删历史；请求键不包含描述等隐私；一次锁内查找、一次批量保存。
- **evidence_paths / owner / last_updated / commit：** 审查报告、exchanges data/domain/UI；Codex；2026-10-04；未提交。

#### AG-P0-019 — 存储锁接管的旧写者恢复风险验证

- **状态 / 类型 / 优先级：** `host_pending` / `contract+data+test` / P0 / M2。
- **user_outcome / user_scenario：** 慢保存超过两次取锁等待后，旧写者恢复也不能覆盖新写者，不能靠“等够时间”证明旧操作已经停止。
- **source_ids / current_evidence：** 暂停时风险假设已在隔离双上下文复现：第二上下文等待耗尽后接管并保存 1 次，旧保存恢复后仅剩旧互动，第二条事实丢失。修复取消 steal，等待耗尽返回 `StoreLockTimeoutError`；契约及 D-0026 明确持锁者可能恢复，等待失败不代表原写入取消。
- **depends_on / blocks / parallel_group / preconditions：** 现有 storage 契约和 AG-P0-005 隔离证据；阻塞跨窗口写入安全声明；storage-lock；先复现后确定 fail-closed 或可证明的接管策略。
- **allowed_files / forbidden_files / contract_change / host_or_spike_required：** storage、shared async、存储测试、同源多上下文 fixture、DATA-CONTRACT；保护文件；锁超时/接管/未知结果规则；需隔离浏览器两上下文及真实多窗口证据。
- **ordered_steps：** 建立旧 writer 超过所有等待阈值后恢复的 fixture；观察两者读写顺序；不能安全阻止旧 writer 时禁止接管而报告忙/未知；如使用代次保护，证明宿主已接受的写也不会被错误当成取消；不以增加等待时间代替证明。
- **test_fixtures / test_commands / acceptance：** 正常慢写、长暂停后恢复、真挂起、两窗口回读失败、锁请求拒绝；check/test/UI；无双写覆盖，无错误自动重发，超时明确可恢复指引。
- **failure_retry_rollback / privacy_boundary / performance_budget：** 未核实持有者状态则保留排他边界，不绕锁写空；诊断仅存储键和代次；等待有限但不得以牺牲数据安全换可用性。
- **本次实现：** 等待默认每次 5 秒、重排队 1 次；仅本次取锁定时器造成的未获锁中止可重排队。获锁立即清除取锁定时器，业务回调自身 AbortError/嵌套超时原样上抛，不重放写入；同步/异步锁拒绝不降级无锁执行；配置非法在取锁前拒绝。等待耗尽的调用尚未执行业务回调，提示原操作结束并核实后显式重试。
- **隔离证据：** 13/13 存储测试；2 个新增实际双上下文用例覆盖旧保存长暂停/仍挂起、正常慢写、双前置读失败、已保存但回读失败、已保存返回取消、后续写入及显式重试。详情页显示占用错误并保留备注，不误报成功；原操作结束后点击记录保存一次，事实保留。
- **测试结果 / 宿主余项：** `pnpm check` 0 errors / 0 warnings，`pnpm test` 252/252，桌面 112/112、390px 113/113、构建通过，无未处理异常和清理失败。真实思源文件保存、多窗口、系统暂停恢复尚未执行；不支持 Web Locks 时仍仅保证同上下文排队。原操作真挂起期间该键暂不可写，不强制解锁。
- **evidence_paths / owner / last_updated / commit：** [锁安全证据](verification/STORAGE-LOCK-2026-10-03.md)、src/data/storage.ts、tests/storage.test.ts、scripts/e2e/ui/store-frame.js、scripts/e2e/ui/smoke.js；Codex；2026-10-03；未提交。

#### AG-ALIAS-001 — 别名识别、搜索和稳定人物归属闭环

- **状态 / 类型 / 优先级：** `done_isolated` / `contract+domain+service+ui+test` / P1 / M3。
- **本次认领：** Codex；P0-015/017 与 B12-003 的隔离前置已满足，收口姓名/别名联合消歧、登记与可达性核实及搜索/选人投影；真实引用由 HOST-006 保留验收。
- **user_outcome / user_scenario：** 用户设置别名后，能在搜索、选人和笔记捕获中核对目标；别名与真实姓名冲突或人物失效时不会写给第一人。
- **source_ids / current_evidence：** 用户反馈第 4 项；捕获已有 alias resolver，联系人搜索仍匹配姓名/电话等；alias resolver 仅校验索引、不验证名册归属。重复添加已有别名时 UI 直接 append 同 ID。
- **depends_on / blocks / parallel_group / preconditions：** AG-P0-015/017、AG-B12-003；阻塞别名跨入口完成声明；identity-match；先明确别名/姓名优先级和孤儿行为。
- **allowed_files / forbidden_files / contract_change / host_or_spike_required：** alias domain/data/service、contacts/capture、选人 UI、tests/契约；保护文件；归属与歧义策略；真实引用成边走 AG-HOST-006。
- **ordered_steps：** 统一稳定 ID resolver；禁止通用称谓；校验联系人有效性；姓名同名/别名撞姓名返回候选；搜索/选人复用；UI 同 ID upsert 不重复 append；AI/vCard/桥仅在各自契约确定后接入。
- **test_fixtures / test_commands / acceptance：** 重复添加、跨人冲突、大小写空白、泛称、孤儿、别名撞姓名、同名人物；check/test/UI；歧义不自动选第一人，历史互动不因别名变化重绑。
- **failure_retry_rollback / privacy_boundary / performance_budget：** 未知读取停止识别，不按原字符串新建；无外发；一次批量加载索引，不每候选重复读盘。
- **evidence_paths / owner / last_updated / commit：** 审查报告、person-aliases/capture/contacts；无；2026-10-03；未提交。

### W2：本人、基础资料与组织闭环

#### AG-P0-020 — 写后读取未知不自动重发保存

- **状态 / 类型 / 优先级：** `done_isolated` / `data+test` / P0 / M2。
- **用户结果 / 来源：** 本人断点回归发现通用存储写后容错读会把读取失败当成未应用并重发；未知结果现在立即停止，保留原事实供显式核实。
- **依赖 / 允许触碰：** 既有存储契约；storage、storage tests、实际双上下文回归与非保护文档；禁止保护文件及日常内核。
- **步骤 / 验收：** 写后严格读，只有已核实不匹配才有限重写；保存/回读抛错不自动重发。已保存但读取失败、核实未应用、保存拒绝及跨上下文后续写入均保留原事实；check/test/UI 全量验证。
- **回滚 / 宿主：** 不撤销已保存事实；真实思源保存回调留 HOST-005/006。
- **证据：** 新增两个 storage 单测，偏好未知保存断言由两次重写纠正为一次；实际双上下文 fixture 按一次严格回读注入，不借第二次容错读吞异常。304 单测、完整桌面 191/191、390px 192/192、check 和构建通过。
- **负责人 / 更新时间 / 提交：** `Codex-AG-P0-020` / `2026-10-04` / 未提交。

依赖：W1 中 P0-001～006、012 已完成或达到可用状态。

#### AG-B11-001 — 本人身份契约、旧库迁移和冲突裁决

- **状态 / 类型 / 优先级：** `done_isolated` / `contract+data+domain` / P1 / M3。
- **用户结果：** 旧工作区升级后仍能识别本人；设置锚点、文档标记、同名联系人冲突时不会自动改绑。
- **来源与证据：** `B11.1/B11.5`；`DATA-CONTRACT.md §2` 的 `self-identity.json` 为唯一事实源，`src/data/self-identity.ts` 已有基线。
- **依赖 / 阻塞：** AG-P0-006、012；阻塞 B11 UI、提醒排除和 B12 关系字段。
- **允许触碰：** `docs/DATA-CONTRACT.md`、`src/data/self-identity.ts`、`src/domain/self-identity.ts`、迁移/体检测试。
- **步骤：** 列旧 schema；定义缺失、冲突、同名、多候选、文档改名/移动语义；实现严格读取和显式裁决；补迁移报告。
- **验收：** 设置与标记不一致时停止；旧库可启动；不覆盖已有不同 selfDocId；结果含下一步指引。
- **2026-10-04 收口：** 坏版本/结构/日期严格拒绝，旧库缺键为空；已有身份与原绑定行失配阻断，同名多候选不自动认定。迁移纳入本人，按原文档核实目标行，冲突/不可达/未知保留可定位重试包，空模块不清除现状，重复恢复幂等。7 个本人实际服务用例与初始化/迁移定向回归合计 18/18；check 0 errors / 0 warnings。真实工作区恢复由 HOST-005/006 复核。
- **负责人 / 更新时间 / 提交：** `Codex-AG-B11-001` / `2026-10-04` / 未提交。

#### AG-B11-002 — 本人初始化、复用和安全续做

- **状态 / 类型 / 优先级：** `done_isolated` / `service+ui+test` / P1 / M3。
- **用户结果：** 首次向导默认建立“我自己”但可跳过；中断重进不重复建文档、数据库行或标记。
- **来源与证据：** `B11`、`FUNC-01.15`；`src/services/init.ts`、`InitWizard.svelte`。
- **依赖 / 阻塞：** AG-B11-001、AG-P0-006；阻塞所有“排除本人”的统计和提醒。
- **允许触碰：** init service/domain/UI、测试、非保护状态文档。
- **步骤：** 预检创建/复用对象；建立 doc→item→identity checkpoint；每步回读；局部失败给继续入口；AI 非必需。
- **验收：** 完成第一位联系人不依赖 AI/本人；重复点击零重复；未知读取或歧义阻断写入。
- **2026-10-04 收口：** 初始化本人可跳过；稳定请求断点在创建前保存核实，响应丢失/未知只找回原文档，绑定丢响应先核实映射，改名后按 ID 续做，完整分页发现残留，歧义/坏断点/改锚点/原文档缺失均不新建替代。本人失败不阻断工作空间且向导/设置显示原原因和继续入口。新增 8 个服务/UI 回归与原初始化、B11-001 合计 21/21。真实多窗口留 HOST-002。
- **负责人 / 更新时间 / 提交：** `Codex-AG-B11-002` / `2026-10-04` / 未提交。

#### AG-B11-003 — 本人换绑、清除与影响预览

- **状态 / 类型 / 优先级：** `done_isolated` / `service+ui+a11y+test` / P1 / M3。
- **用户结果：** 用户可以明确换绑或清除本人，并提前看到提醒、统计、图谱中心和资料投影的影响。
- **来源与证据：** `B11.5`、`UX-03.48/49`。
- **依赖 / 阻塞：** AG-B11-001/002、AG-P0-012；阻塞正式自助修复。
- **允许触碰：** self identity service/UI、dashboard/graph projection、tests。
- **步骤：** 生成只读影响预览；要求稳定 docId 选择；执行锁内重读；清除/换绑后刷新依赖页并记录审计结果。
- **验收：** 不同身份不会静默覆盖；取消预览零写入；本人排除规则和中心图更新可核对。
- **2026-10-04 收口：** 设置支持旧库指定、换绑/清除的只读影响预览；稳定文档/行选择，取消零写入，预览焦点和草稿/busy 守卫。确认锁内重新核实锚点/目标/本人快照，过期预览停止，写后未知保留输入；清除只取消身份和派生断点，保留人物与历史。幂等确认、未知清除、并发变更、解绑、损坏读取与生产设置 UI 共 5 个用例通过（定向 6/6 含异常守门）。成功广播刷新，真实多窗口留 HOST-002。
- **负责人 / 更新时间 / 提交：** `Codex-AG-B11-003` / `2026-10-04` / 未提交。

#### AG-B11-004 — 本人排除、提醒和页面投影

- **状态 / 类型 / 优先级：** `done_isolated` / `domain+service+ui+test` / P1 / M3。
- **用户结果：** 本人保留在名册和联系人页，但不进入“待联系”、生日和普通资料体检统计；用户能看见这是规则而非数据缺失。
- **来源与证据：** `DATA-CONTRACT.md self-identity`、`B11.4`、`UX-03.56`。
- **依赖 / 阻塞：** AG-B11-001/002；阻塞首页和行动清单验收。
- **允许触碰：** dashboard/roster/occasions/action-list/person filters、相关 UI/test。
- **步骤：** 统一 domain predicate；所有列表和统计调用同一规则；提供“已排除本人”解释；读取身份失败时显示未知。
- **验收：** 统计、提醒、体检和图谱中心口径一致；身份未知不把本人当普通联系人；旧视图不崩。
- **2026-10-04 收口：** 本人仍在名册与详情，普通生日/联系/跟进行动排除本人；本人跟进不误报不可达，原事实保留。身份读取失败或原行失配则暂停普通范围，首页数值显示破折号并明确未核实，禁止未知生日/从未互动下钻；清除或恢复后重算。文档引用图在清除身份后可显式指定已登记人物中心。新增 3 个实际服务/首页用例通过，完整桌面 191/191、390px 192/192、304 单测、check 和构建通过；真实宿主留 Host Queue。
- **负责人 / 更新时间 / 提交：** `Codex-AG-B11-004` / `2026-10-04` / 未提交。

#### AG-B12-001 — 工作单位、学校和与我的关系唯一事实源

- **状态 / 类型 / 优先级：** `done_isolated` / `contract+domain` / P1 / M3。
- **用户结果：** 用户能理解三项资料来自人物文档、组织成员还是插件索引，修改后不会被另一条来源覆盖。
- **来源与证据：** `B12.1/2.3`、`UX-03.31/39`；`DATA-CONTRACT.md §1/§8`。
- **依赖 / 阻塞：** AG-B11-001、组织契约已定稿；阻塞 B12 UI、导入和简报。
- **允许触碰：** `docs/DATA-CONTRACT.md`、`src/domain/fields.ts`、`src/domain/org-membership.ts`、相关类型/测试。
- **步骤：** 对每个字段声明事实源、投影、清空和旧库兼容；区分组织成员职位/日期与人物 AV 字段；明确“与我的关系”不写入组织成员。
- **验收：** 新旧字段不会互相覆盖；多组织/历史任职可解释；契约先于 UI。
- **2026-10-04 收口：** DATA-CONTRACT §8.1 与 D-0030 定义成员分类 work/education/unspecified、旧库兼容、清分类保留任职、当前/历史/归档/不可达的多记录投影。称谓纯函数按本人+人物组合严格读，清空保留记录，换绑不搬移，未知本人暂停。修复成员严格读仍丢弃坏 ID/重复记录的问题。新增 5 个业务域回归，定向 17/17、完整单测 309/309、check 0 errors / 0 warnings。分类 UI、称谓存储/迁移仍由后续卡接入，不宣称已有功能。
- **负责人 / 更新时间 / 提交：** `Codex-AG-B12-001` / `2026-10-04` / 未提交。

#### AG-B12-002 — 三项资料的查询、筛选和投影

- **状态 / 类型 / 优先级：** `done_isolated` / `domain+service+ui+test` / P1 / M3。
- **本次认领：** Codex，成员双向维护已隔离完成，开放三项资料的统一投影、人工称谓生产存储及迁移、组合筛选和保存视图；读取故障不伪空，本人换绑不转移称谓。
- **用户结果：** 在首页、联系人列表、详情、卡片、表格、简报和导入预览中看到同一份最新资料。
- **来源与证据：** `B12.2/2.3`、`UX-03.7/10/31/32`。
- **依赖 / 阻塞：** AG-B12-001、AG-B13-003；阻塞组织共同背景和导入字段映射。
- **允许触碰：** people filters/roster/person/insights、组织查询服务、各页面组件、测试。
- **步骤：** 建立统一 projection；查询失败保留 unknown；为组合筛选和保存视图补状态；来源徽标和更新时间一致。
- **验收：** 组织变化后所有页面刷新；空、失败、历史值不混淆；筛选结果与详情一致。

#### AG-B12-003 — 同名人物的稳定 ID 消歧

- **状态 / 类型 / 优先级：** `done_isolated` / `domain+service+ui+test` / P1 / M3。
- **用户结果：** 同名的人可以并存，用户总能从文档、组织、电话等证据选到正确人物。
- **来源与证据：** `B12.6`、`CODE-02.13/14`、`FUNC-01.15`。
- **依赖 / 阻塞：** AG-P0-003/011、AG-B11-001；阻塞桥、导入和组织双向入口。
- **允许触碰：** duplicate-check/person-picker/contacts/bridge/import UI/service、测试。
- **步骤：** 所有候选以 docId/itemId 分层显示；禁止姓名唯一匹配；记录用户选择的稳定 ID；重试复用选择。
- **验收：** 同名不同文档分别建档/关联；未知或冲突时暂停；链接回跳保持原人物。
- **2026-10-04 收口：** 手动新建完整分页核实同名，显式选独立人物或具体文档；排除组织文档，读取失败零新建。内核验证原子请求标记，创建/绑定未知不重发，改名按原请求续做，行变化/删除/改输入或锚点停止，字段补写不写同名他人。vCard 可逐项确认独立同名，选人器显示 docId/itemId 和资料，桥多候选拒绝，实际 AI 服务与界面不折叠同名或自动指派。新增 12 个实际服务/UI 用例；完整桌面 203/203、390px 204/204，309 单测与 check 全绿。窗口断点和真实宿主边界见 verification/PERSON-FIELDS-2026-10-04.md。
- **负责人 / 更新时间 / 提交：** `Codex-AG-B12-003` / `2026-10-04` / 未提交。

#### AG-B13-001 — 组织初始化和健康语义

- **状态 / 类型 / 优先级：** `done_isolated` / `service+ui+test` / P1 / M3。
- **本次认领：** Codex 补组织原子创建标记、创建/改名持久请求和只读续做；先补契约与独立内核实证，再接入 UI。重复标记保持明确阻断，不自动删除用户正文。
- **用户结果：** 组织文档标记、成员 JSON、归档和未可达状态一致，坏标记不会被当作空组织。
- **来源与证据：** `B13.1/1a/4/4a` 已完成契约/基础 CRUD；本卡只处理健康、异常和余项。
- **依赖 / 阻塞：** AG-P0-002/012、AG-B12-001；阻塞组织规模、图谱和迁移。
- **允许触碰：** `src/services/org.ts`、`src/data/org-membership.ts`、`src/domain/org-membership.ts`、`OrgsView/OrgManagerDialog`、tests。
- **步骤：** 扫描标记与 JSON；报告孤儿、重复、归档不一致、权限失败；预览修复；锁内修复并回读。
- **验收：** 读取失败≠空组织；修复逐项可重试；归档组织不进入活跃投影和图谱增强。
- **2026-10-04 已完成增量：** 标记数量、未知值、重复/冲突、非法 ID、不可达/不完整文档均严格核实；组织数量未知不显示为 0。归档/恢复在专用锁内重读、幂等并写后核实；归档首条成员不再遮蔽另一正常单位。域 3/3、实际服务/UI 4/4，完整桌面/390px 全绿。剩余为组织创建/改名部分成功的稳定断点和手动修复预览；不自动删除重复标记，交 B13-006 共用补偿模型后收口。

#### AG-B13-002 — 成员查询规模、分页和稳定排序

- **状态 / 类型 / 优先级：** `done_isolated` / `domain+service+ui+test` / P1 / M3。
- **用户结果：** 组织有数百/数千成员时仍能搜索、分页、看当前/历史成员，并且筛选变化不跳人。
- **来源与证据：** `B13.5b`、`CODE-02.8`、`UX-03.14/45/57`。
- **依赖 / 阻塞：** AG-B13-001、AG-P0-009；阻塞移动端和组织图谱。
- **允许触碰：** org domain/service/UI、分页 helper、性能测试。
- **步骤：** 先确定可用分页/索引策略；稳定 tie-break；加载更多不覆盖已选项；查询失败与空结果分开。
- **验收：** 1k fixture 下滚动/筛选预算可接受；当前/历史/归档口径一致；跨窗口刷新保留上下文。
- **2026-10-04 增量证据：** 成员按 active/日期/ID 稳定排序，姓名/部门/职位搜索，active/former/all 筛选和 200 条分页；翻页保留全体成员 ID，搜索变更重置页次，迟到请求隔离，错误保持未知并支持重试。1001 条实际服务及 UI 用例通过；390px 全量 160/160。完整桌面与真实跨窗口上下文仍需复核，组织初始化的剩余前置由 B13-001 处理。

#### AG-B13-003 — 人物侧与组织侧双向维护

- **状态 / 类型 / 优先级：** `done_isolated` / `service+ui+test` / P1 / M3。
- **用户结果：** 在人物详情和组织详情都能添加、编辑、结束、恢复成员关系，双方页面立即一致。
- **来源与证据：** `B13.5/5a/6` 基础入口已完成；余项为规模、失败恢复、共同背景和影响预览。
- **依赖 / 阻塞：** AG-B13-001 已隔离验证的健康读取、AG-B13-002 已隔离验证的分页、AG-P0-004、AG-B12-001、AG-B13-006 投影补偿；阻塞 B13 体验验收。创建/改名断点与真实多窗口验收分别收口，不阻塞按稳定 ID 维护既有健康组织。
- **允许触碰：** org/person components/services/domain/tests。
- **步骤：** 统一 membership ID；操作前显示双方影响；局部失败保留事实并标投影失败；成功后按事件刷新两侧。
- **验收：** 同一 membership 不重复；former/active/多段历史清楚；移除和恢复不会误删人物文档。
- **本次认领：** 接通已核实成员事实与双方投影报告；修复人物侧组织/人物参数顺序、former 重入、真实日期与并发 active 防重、归属读取错误和迟到响应；分类与影响提示在两侧共用。真实多窗口另列宿主队列。
- **2026-10-04 收口：** 两侧分类/编辑/离职/恢复/重入与接替、明确历史删除、锁内 active 防重、真实日期和原记录快照、读取失败与迟到响应已核实。事实成功后逐文档报告，不因投影失败回滚；生命周期事件重读两侧，组织筛选和编辑草稿保留，过期保存零覆盖。新增 2 域用例、8 实际存储/服务/UI 用例；定向 25/25、完整单测 314/314、桌面 222/222、390px 223/223，check 0 errors / 0 warnings、构建通过；窄屏编辑/删除确认补查 4/4 与 2/2。证据见 `docs/verification/ORG-MEMBERS-2026-10-04.md`。真正多窗口另由 B13-004/Host Queue 验收。
- **负责人 / 更新时间 / 提交：** `Codex-AG-B13-003` / `2026-10-04` / 未提交。

#### AG-B13-004 — 组织变化的跨页、跨窗口刷新

- **状态 / 类型 / 优先级：** `host_pending` / `service+ui+e2e` / P1 / M3。
- **用户结果：** 组织改名、归档、成员变化后，组织列表、人物详情、首页资料和图谱不会显示旧值。
- **来源与证据：** `B13.8/11`、`PAGE-STATUS S11`、`CODE-02.12/16`。
- **依赖 / 阻塞：** AG-P0-009/013、AG-B13-003；阻塞真机/多窗口。
- **允许触碰：** data-events、org/person/dashboard/graph services/components、UI/E2E tests。
- **步骤：** 定义事件 payload 和版本；去重订阅；刷新投影而非整页重置；保护用户当前筛选/滚动/焦点。
- **验收：** 两窗口最终一致；关闭旧实例后无回调；外部文档改名能明确显示“待刷新/已刷新”。
- **当前证据：** 同源 browser-desktop 双页面已验证稳定人物 ref 与互动 ref 幂等；组织改名、成员编辑、归档、恢复和单页面刷新已通过真实隔离 UI。第一页面依次改名组织、编辑成员职位、归档并恢复组织后，第二页面均无需重载即回读新状态；组织成员对应人物文档投影的第二页面专门核对、真实用户工作区和真机仍保留 `host_pending`。
- **2026-10-05 增量：** 真实隔离 browser-desktop 重跑已通过页面重载后的账本、别名、跟进和组织回读，以及双页面人物/互动幂等；组织改名、成员职位、归档/恢复的第二页面原地刷新均通过。插件入口新增同源 `BroadcastChannel`，补齐仅写内核块而未触发宿主逐窗口回调的组织状态变化；人物文档投影专门核对和真实用户工作区仍待验。
- **证据路径 / 负责人 / 更新时间 / 提交：** `docs/verification/SERVICE-KERNEL-2026-10-04.json`、`docs/verification/REAL-FRONTEND-2026-10-04.md` / Codex / 2026-10-04 / 未提交。

#### AG-B13-005 — 组织迁移、导出和恢复

- **状态 / 类型 / 优先级：** `done_isolated` / `contract+data+service+test` / P1 / M3。
- **用户结果：** 带组织和成员历史的备份可以预览、恢复、跳过冲突并保留原事实。
- **来源与证据：** `B13.10`、`C08`、`DATA-CONTRACT §8`。
- **依赖 / 阻塞：** AG-P0-002、AG-B13-001 已隔离的健康读取、AG-B13-003/006；只合并已恢复且稳定 ID 核实的成员事实，不创建/改名/解档组织，因而不依赖 B13-001 未完成的文档请求断点。规则先定 DATA-CONTRACT §8.4，再编码；真实宿主仍待验。
- **允许触碰：** migration bundle、org data/domain/service、DATA-CONTRACT、tests。
- **步骤：** 先定义 org docId、membership ID、归档和未知状态的迁移策略；再实现预览、锁内合并、写后回读；补旧库空键兼容。
- **验收：** 恢复不把同名组织自动合并；成员历史不丢；失败模块可单独重试；坏包零污染。
- **本次认领：** 加入成员事实与历史备份、稳定组织/人物可达性、当前事实优先与失败模块续做；补成员删除标记，避免旧包复活明确删除的记录。原生组织文档、标题和归档标记仍须随思源工作区备份，不冒充插件 JSON 已备份原文。
- **收口证据：** 十模块导出、旧六/九模块兼容、只读预览、分类/归档组织/多段历史往返、删除优先、双端孤儿、同 ID/当前冲突、重复人物绑定、权限失败、坏包/坏库、未知回读重试与并发加入均验证。新增 3 域及 4 实际存储/服务用例；单测 317/317、桌面 226/226、390px 227/227、check 0 errors / 0 warnings、构建通过，均退出 0。证据见 verification/ORG-MIGRATION-2026-10-04.md；真实宿主另验。
- **负责人 / 更新时间 / 提交：** `Codex-AG-B13-005` / `2026-10-04` / 未提交。

#### AG-B13-006 — 组织事实与文档投影副作用修复

- **状态 / 类型 / 优先级：** `done_isolated` / `domain+service+ui+test` / P1 / M3。
- **用户结果：** 组织成员事实保存成功但链接区块失败时，用户能看到差异并安全补偿，不会误以为双向链接已完成。
- **来源与证据：** `B13.7/11`、`CODE-02.5/15`、`UX-03.45/48`。
- **依赖 / 阻塞：** AG-P0-004、AG-B12-001、AG-B13-001 已隔离完成的健康读取；阻塞 B13-003 投影余项与 B14 组织边。按既有稳定 ID 修复投影不依赖创建/改名断点，解除原 B13-001/003/006 相互等待；真实宿主不据此放开。
- **允许触碰：** DATA-CONTRACT、org-membership domain/data/service、doc-section、facade、组织/人物与健康 UI/tests。
- **步骤：** 分离 JSON 事实与文档标记/链接投影；写后回读；失败清单含目标文档和重试键；体检可重新生成投影。
- **验收：** 关系事实不被投影失败回滚；重试幂等；组织归档时不生成活跃投影。
- **2026-10-04 收口：** 设置页只读差异、逐项修复、持久未知断点与双向段落回读完成；原预期未核实不重发，迟到应用只读收口，过期预览/重复标记/孤儿零覆盖。3 个域用例、11 个实际服务/UI 用例；完整单测 312/312、桌面 214/214、390px 215/215，check 0 errors / 0 warnings、构建通过。证据见 `docs/verification/ORG-PROJECTIONS-2026-10-04.md`；成员保存自动接入由 B13-003 完成，真宿主另验。
- **已登记边界：** 写前断点保存已提交但回读未知时，本次内核写入尚未发出；持久 pending 保守保留。跨重启无法证明旧请求未发，不能自动清理重放，后续修复必须有明确核实依据。
- **负责人 / 更新时间 / 提交：** `Codex-AG-B13-006` / `2026-10-04` / 未提交。

### W3：双图和关系探索

依赖：B13 事实源稳定；所有原生能力先经 spike。

#### AG-B14-001 — 双图范围、中心和数据源契约

- **状态 / 类型 / 优先级：** `done_isolated` / `contract+domain` / P1 / M3。
- **本次认领：** Codex-Mill，成员事实/健康/分页已开放隔离依赖，补统一图查询快照，宿主能力仍独立验收。
- **用户结果：** 用户知道“关系图”和“文档引用图”分别看什么、中心是谁、范围有多大。
- **来源与证据：** `B14.1/1b/3/5/8`、`UX-03.15/35`；`src/domain/graph.ts`、`native-graph.ts`。
- **依赖 / 阻塞：** AG-B13-001/006；阻塞所有图 UI 扩展。
- **允许触碰：** `docs/DATA-CONTRACT.md`、graph domain/types/services、tests。
- **步骤：** 定义 related/member/ref 三种边语义；中心缺失、本人未建档、组织过滤和登记集合口径；自研图、原生图、文本列表、导出共享查询快照。
- **验收：** 不互相推断不同来源的边；节点/边计数和截断原因可解释；范围切换保留筛选。

#### AG-B14-002 — 原生图引用与打开通道 spike

- **状态 / 类型 / 优先级：** `host_pending` / `spike+api+host` / P1 / M3。
- **用户结果：** 原生图入口只在真实宿主确认可用时出现，不能以隔离 mock 冒充完成。
- **来源与证据：** `B14.2/10`、`scripts/spike/b14-graph-spike.mjs`；隔离 getGraph/getLocalGraph 已有证据，面板打开与 `siyuan://blocks` 成边仍待验。
- **依赖 / 阻塞：** AG-B14-001；阻塞原生图正式入口和组织边迁移。
- **允许触碰：** `src/api/graph.ts`、`src/services/native-graph.ts`、spike 脚本/结果、图入口组件。
- **步骤：** 在隔离内核确认响应；在真宿主验证打开方式、中心透传、返回语义和链接成边；记录版本/前端/桌面移动差异；失败时保留降级入口。
- **验收：** 证据包含步骤、响应、截图和降级行为；无法限制范围时 UI 明示全局范围；未完成不得标 `done`。

#### AG-B14-003 — 图谱范围、组织聚焦和截断稳定性

- **状态 / 类型 / 优先级：** `done_isolated` / `domain+service+ui+test` / P1 / M3。
- **本次认领：** Codex-Mill，按同一图快照契约顺序接确定排序、中心和组织聚焦。
- **用户结果：** 用户可以从本人、人物、组织或全局切换范围，结果稳定且知道被裁剪的原因。
- **来源与证据：** `B14.3/7/9`、`CODE-02.10`、`UX-03.36`。
- **依赖 / 阻塞：** AG-B14-001、AG-B13-002/006；阻塞图谱体验包。
- **允许触碰：** graph domain/services/RelationGraph、测试。
- **步骤：** 稳定排序和 tie-break；中心缺失单独状态；组织节点聚焦只过滤查询快照；截断保中心或提供明确收窄动作。
- **验收：** 刷新结果稳定；重复 ID、无路径、孤立节点有诊断；导出特殊字符不改变结构。

#### AG-B14-004 — 图谱文本替代、键盘和移动交互

- **状态 / 类型 / 优先级：** `done_isolated` / `ui+a11y+test` / P1 / M3。
- **本次认领：** Codex-Mill，快照完成后接文本替代和键盘路径；真机仍单列。
- **用户结果：** 不看画布、不使用鼠标或在移动端也能阅读节点、边、路径、来源和操作结果。
- **来源与证据：** `PAGE-01.13`、`UX-03.15/23/36/53/54`。
- **依赖 / 阻塞：** AG-B14-001/003；阻塞发布前 UI 门禁。
- **允许触碰：** `src/components/graph/RelationGraph.svelte`、`src/domain/graph-export.ts`、styles/tests。
- **步骤：** 文本结果与画布共享快照；键盘选中/返回；边来源不用颜色单独表达；移动先展示列表再定位画布。
- **验收：** 读屏能获知范围、数量、截断和失败；390px 无横溢；焦点可见且关闭后恢复。

#### AG-B14-005 — 自研图与原生图宿主降级和返回语义

- **状态 / 类型 / 优先级：** `host_pending` / `ui+host+e2e` / P1 / M3。
- **用户结果：** 原生图不可用、无权限或全局范围过大时，用户仍可使用自研图和文本视图，并能准确返回来源页面。
- **来源与证据：** `B14.10`、`UX-03.34/55`。
- **依赖 / 阻塞：** AG-B14-002/004；阻塞真实宿主验收。
- **允许触碰：** graph navigation/UI, native service, E2E/host scripts。
- **步骤：** 明示能力不可用与无数据；保存返回上下文（人物/组织/筛选/滚动）；原生打开失败可重试或切自研图；系统返回不丢上下文。
- **验收：** 桌面、移动、不同前端证据齐全；原生失败不阻断本地关系图。
- **2026-10-05 隔离稳定性增量：** `loadGraphReferences` 将中心解析、登记投影、内核请求和形状错误统一收口为 `unknown` 来源；RelationGraph 增加异常 `catch/finally`，原生引用请求失败不会永久停留在 loading，切换关系图和版本号仍会丢弃迟到响应。图查询专项 UI 回归 `3/3`（引用权限失败可见、切换关系图可用、组织中心切换与迟到响应保护通过）；真实原生图面板、返回上下文、真机和不同真实前端仍保持 `host_pending`。

### W4：捕获、导入和 AI

依赖：P0 部分失败模型、字段边界、隐私契约。

#### AG-AI-001 — AI 调用前隐私与范围预检

- **状态 / 类型 / 优先级：** `done_isolated` / `contract+ui+service+test` / P1 / M3。
- **本次认领：** Codex-Rawls，先隔离内核验证未配置行为与发送范围契约，再接逐次确认，不读取日常配置或密钥。
- **用户结果：** AI 调用前能看到端点、字段、文档范围、外发内容、脱敏方式、规模、取消和日志边界；关闭 AI 不影响手动流程。
- **来源与证据：** `FAST-01.11`、`UX-03.41/42/44`；`src/api/ai.ts` 当前宿主读取范围需核对。
- **依赖 / 阻塞：** AG-P0-005/014、字段契约；阻塞所有 AI 候选与摘要。
- **允许触碰：** `src/api/ai.ts`、`src/services/ai-extract.ts`、AI UI、DATA-CONTRACT/隐私文档、tests。
- **步骤：** 先核对真实 `/api/ai/chatGPT` 行为；定义可选字段和范围；生成最终发送摘要；允许收窄和取消；不把预览内容写入联系人事实。
- **验收：** 关闭 AI 可完整手动建档/捕获；取消/超时不回填；诊断不含姓名、联系方式、正文、密钥或完整路径。

#### AG-AI-002 — AI 候选证据、消歧和草稿边界

- **状态 / 类型 / 优先级：** `done_isolated` / `domain+service+ui+test` / P1 / M3。
- **本次认领：** Codex-Rawls，隐私预检后接证据片段、低证据默认不选及逐项确认。
- **用户结果：** 名册内、双链命中、新人、同字段重复、待消歧和无证据候选都能逐项确认，AI 生成内容不会伪装成事实。
- **来源与证据：** `CODE-02.7`、`UX-03.41/43`、`src/domain/ai-extract.ts`。
- **依赖 / 阻塞：** AG-AI-001、AG-B12-003、AG-P0-014；阻塞 AI 写入。
- **允许触碰：** ai-extract domain/service/UI、candidate types/tests。
- **步骤：** 定义证据片段/位置/不确定性；合法性校验和坏候选计数；逐项接受/拒绝/编辑；事实字段与草稿字段分离。
- **验收：** 低证据不默认选中；旧响应不能覆盖新表单；模型空/拒答/超时有本地回退；未确认内容不进提醒或图谱。

#### AG-AI-003 — 捕获来源证据、参与者确认和安全重试

- **状态 / 类型 / 优先级：** `done_isolated` / `service+ui+e2e` / P1 / M3。
- **本次认领：** Codex-Rawls，只补剩余预检与证据，复用已验证逐人断点，不重做存储。
- **用户结果：** 从文档/选区/粘贴捕获时，用户知道读取范围、候选来源、原文追加区域和每个参与者结果。
- **来源与证据：** `UX-03.18`、`FUNC-01.5`、`src/components/capture/CaptureDialog.svelte`。
- **依赖 / 阻塞：** AG-P0-014、AG-AI-001/002；阻塞捕获完整闭环。
- **允许触碰：** capture components/services/domain/tests。
- **步骤：** 预览范围和候选；双链与 AI 视觉/语义区分；确认后按 item checkpoint 写入；保留原文和失败输入；只重试失败项。
- **验收：** 取消零写入；部分成功逐项显示；同一来源重试不重复互动/关系；来源不可达可解释。

#### AG-IMP-001 — vCard/粘贴/表格字段映射和冲突预览

- **状态 / 类型 / 优先级：** `done_isolated` / `domain+service+ui+test` / P1 / M3。
- **本次认领：** Codex-Newton，字段核实/消歧/稳定请求已开放依赖，接来源映射、冲突及确认对象。
- **用户结果：** 导入前能看见实际映射、忽略字段、同名冲突和预期写入对象，重复导入不会重复建档。
- **来源与证据：** `FAST-01.4/1.5/1.9`、`UX-03.19/37/38`、`src/domain/vcard.ts`、`src/services/vcard.ts`。
- **依赖 / 阻塞：** AG-P0-003/007/011、AG-B12-003；阻塞更大批量导入。
- **允许触碰：** vcard/import domain/services/components/tests。
- **步骤：** 按来源展示读取边界；字段映射和忽略列表可确认；冲突进入稳定 ID picker；逐项结果和幂等重试；损坏文件给可操作错误。
- **验收：** ORG/ADR/PHOTO 等未支持属性不静默写入；成功项重试不重复；空/损坏文件不产生空联系人。

#### AG-IMP-002 — 文档收编、批量补录和暂停续做

- **状态 / 类型 / 优先级：** `done_isolated` / `service+ui+test` / P1 / M3。
- **本次认领：** Codex-Newton，补全分页扫描与稳定队列，读取未知阻止重复建档，局部失败可续做。
- **2026-10-03 增补范围：** `scanImportCandidates` 和 `findResumableDocId` 仍仅取首 500 篇；大库残留探测还吞读取错误后允许新建。复用 P0-006 的稳定分段规则，但分别展示收编范围/续扫，残留状态未知时阻断重复建档；不是 AG-SCALE-001 的远期性能候选。
- **用户结果：** 收编已有文档时可逐项确认、暂停、恢复，失败项不会影响已成功项。
- **来源与证据：** `C02/C03`、`CODE-02.8/02.9`、`UX-03.19/47/49`。
- **依赖 / 阻塞：** AG-P0-003/006/014、AG-B12-003；阻塞大批量联系人维护。
- **允许触碰：** contacts/import/duplicate/profile completion components/services/domain/tests。
- **步骤：** 固定候选 ID 队列；筛选变化不暗改选择；确认层显示真实对象数；逐项 checkpoint；支持继续和仅重试失败。
- **验收：** 当前页/全部筛选/手动选中三种范围清楚；部分失败逐项报告；刷新或跨窗口变化不静默覆盖选择。

### W5：统一用户体验、可访问性和页面对齐

#### AG-UX-001 — 页面事实基线、状态矩阵和控件清单

- **状态 / 类型 / 优先级：** `done_isolated` / `docs+ui+test` / P1 / M2。
- **用户结果：** 每个页面和控件都有真实行为、状态和失败回执；静态原型不会被误当成功能。
- **来源与证据：** `UX-03.1~.6/.27/.30/.50/.58/.60`、`UI-SYSTEM-SPEC.md`、`UI-HANDOFF.md`。
- **依赖 / 阻塞：** 无；阻塞所有 UI 包的“符合原型”声明。
- **允许触碰：** `docs/PAGE-STATUS.md`、`docs/UI-REGRESSION.md`、非保护 UI 文档、受影响组件。
- **步骤：** 为首页、联系人、人物、组织、图谱、捕获、导入、设置、档案条登记正常/空/加载/部分失败/忙碌/成功/重试/不可用/草稿/跨窗口/移动/暗色；盘点每个看似可点击控件的结果、键盘名和失败反馈。
- **验收：** 无声按钮被删除或标记为设计目标；每个状态有截图/步骤/预期；原型演示不触发真实写入。
- **2026-10-04 收口：** UI-CURRENT-BASELINE 登记十一页、十三类状态、复现/预期、事实源和待办；静态 parser 清单记录 26 文件/439 控件的 handler、binding、名称来源、disabled 与键盘方式。无空 click handler，两处遮罩明确辅助入口和键盘出口。截图修复 AV 必填字段和缺 facade；复用安全进程清理，不吞清理失败。Peek 桌面/390px 明暗四景完成，目检修复移动头像重叠及行内按钮越界；其他页面、错误态和真实宿主/读屏保持待验，未扩大成功声明。
- **负责人 / 更新时间 / 提交：** `Codex-AG-UX-001` / `2026-10-04` / 未提交。

#### AG-UX-002 — 导航、路由、Peek、组织/人物返回上下文

- **状态 / 类型 / 优先级：** `host_pending` / `ui+service+e2e` / P1 / M3。
- **用户结果：** 从首页、列表、组织、图谱和文档进入人物/组织后，关闭或返回能回到原筛选、滚动、图谱范围和触发焦点。
- **来源与证据：** `UX-03.20/33/34`、`PAGE-01.8`、UI 原型；`src/components/Workbench*.svelte`、`src/panels/person-panel.ts`。
- **依赖 / 阻塞：** AG-P0-013、AG-B13-003/004、AG-B14-005；阻塞移动端和组织体验。
- **允许触碰：** route/context/panel/navigation components、E2E tests。
- **步骤：** 定义来源上下文对象；桌面 Peek 与移动全屏保持语义一致；组织→人物→组织和文档回跳保留上下文；深链/刷新/无来源关闭有确定出口。
- **验收：** `aria-current` 不漂移；系统返回、Esc、关闭按钮结果一致；跨窗口刷新不把用户送到过时人物。

#### AG-UX-003 — 异步状态、焦点和批量选择语义

- **状态 / 类型 / 优先级：** `done_isolated` / `ui+a11y+domain+test` / P1 / M3。
- **本次认领：** Codex 接固定批量目标、当前页/全部筛选/手选范围、隐藏行明确确认、字段级报告、读取与结果焦点；子功能已有结构化报告继续复用，不重写已验证存储。
- **用户结果：** 批量操作前知道范围，执行中知道进度，执行后知道成功/部分失败/未知；读屏和键盘不依赖 Toast、颜色或画布。
- **来源与证据：** `PAGE-01.14`、`UX-01.14`、`UX-03.21/23/46/53`、`CODE-02.8/9`。
- **依赖 / 阻塞：** AG-P0-014、AG-UX-001；阻塞高风险页面发布。
- **允许触碰：** shared operation/result types、ViewState/StatusNotice、列表/弹窗组件、a11y tests。
- **步骤：** 统一 OperationResult；定义当前页/全部筛选/手动选中范围；筛选变化保护选择；aria-live 只播报必要变化；关闭后恢复焦点。
- **验收：** 隐藏行不会被静默批量写入；动态状态可通过文本读取；部分失败可重试；键盘路径完整。

#### AG-UX-004 — 设置、健康、锚点、迁移和恢复流程对齐

- **状态 / 类型 / 优先级：** `done_isolated` / `ui+service+test` / P1 / M3。
- **本次认领：** Codex，六分区与已有预览/守卫继续复用，补迁移逐模块报告、生命周期和结果焦点。
- **用户结果：** 设置六分区知道每个入口的风险、影响、预览、忙碌、失败和重试，危险操作没有藏在普通按钮后。
- **来源与证据：** `UX-03.16/47/48`、`UI-SYSTEM-SPEC`、`src/components/SettingsView.svelte`。
- **依赖 / 阻塞：** AG-P0-001/002/006/012；阻塞发布前 UI 门禁。
- **允许触碰：** SettingsView、ReviewReportDialog、InitWizard、related styles/tests/docs。
- **步骤：** 按通用/数据字段/提醒/AI 隐私/桥/关于分区；危险操作先预览；结果显示模块级状态和证据；未知状态可恢复。
- **验收：** 预览零写入；忙碌时不能关闭；失败可定位/重试；读故障不显示空态。

#### AG-UX-005 — 桌面、390px、暗色、长内容和触控回归

- **状态 / 类型 / 优先级：** `host_pending` / `ui+a11y+e2e` / P1 / M3。
- **用户结果：** 真实窄屏、软键盘、长姓名/标签、暗色和大字号下，主要操作仍可达、可读、可撤回。
- **来源与证据：** `UX-03.22~.24/.52/.54/.55/.57`、`UI-SYSTEM-SPEC.md`、现有 Playwright smoke。
- **依赖 / 阻塞：** AG-UX-001/003、AG-B14-004；真机部分进入 `AG-HOST-004`。
- **允许触碰：** components/styles/e2e scripts/非保护回归文档。
- **步骤：** 运行桌面和 390px；覆盖键盘、安全区、表格、图谱、底部导航、全屏详情；检查 B3 变量、`lvct-` 前缀、焦点和最小触控尺寸。
- **验收：** 无横向溢出/遮挡/不可滚动；长内容可读；颜色不是唯一状态信息；截图差异有分类说明。

### W6：规模、桥能力和质量门禁

#### AG-E2E-001 — 多插件隔离 E2E 并行编排

- **状态 / 类型 / 优先级：** `done_isolated` / `test+e2e+infra` / P1 / M5。
- **用户结果：** 多个思源插件可以在后台并行验证，不抢占彼此的端口、内核工作区、浏览器 profile、截图和服务证据，也不会清理别的插件或日常思源进程。
- **用户场景：** 同时运行桌面 UI、390px UI 和真实服务链；任一作业失败、超时或退出时，其余作业仍得到独立结果。
- **来源与证据：** 用户关于多个插件同时开发及后台 E2E 的要求；`scripts/e2e/parallel-runner.mjs`；`docs/verification/E2E-PARALLEL-2026-10-05.md`。
- **依赖 / 阻塞 / 并行组 / 前置条件：** 无；不阻塞业务功能；e2e-infra；Node.js、Chromium/Edge 和目标插件脚本可用。
- **允许触碰 / 禁止触碰 / 契约变化 / 宿主或 spike：** `scripts/e2e/parallel-runner.mjs`、配置示例、E2E 输出适配、`tests/`、回归文档；生产业务、版本、CHANGELOG、README 徽章、`docs/PROGRESS.md`、日常思源工作区；无数据契约变化；真实宿主认证和真机不由本卡替代。
- **步骤 / 夹具 / 命令 / 验收：** 生成唯一作业 ID；为每项分配独立端口和目录；启动/记录/超时/清理本轮子进程；保存逐作业日志与汇总；`node --test tests/e2e-parallel-runner.test.mjs tests/e2e-safety.test.mjs`、`node scripts/e2e/parallel-runner.mjs --config scripts/e2e/parallel.example.json`；实际 `3/3`，桌面 `315/315`、390px `316/316`、服务 `9/9`。
- **失败 / 重试 / 回滚 / 隐私 / 性能：** 单作业失败不取消其他作业；超时只终止本轮持有的 PID 树并保留日志；配置失败不启动任何作业；不读取或删除用户目录；并发上限默认为 2，可按配置调节，端口只绑定 `127.0.0.1`。
- **证据路径 / owner / last_updated / commit：** `scripts/e2e/parallel-runner.mjs`、`scripts/e2e/parallel.example.json`、`tests/e2e-parallel-runner.test.mjs`、`docs/verification/E2E-PARALLEL-2026-10-05.md`；Codex；2026-10-05；本轮阶段快照。

#### AG-SCALE-001 — 1k/10k 联系人和组织的渐进加载

- **状态 / 类型 / 优先级：** `partial` / `performance+service+ui+test` / P2 / M4。
- **用户结果：** 大名册可搜索、筛选、分页和图谱收窄，不因一次全量读取卡死或显示假空态。
- **来源与证据：** `UX-03.57`、`B13.5b`、`CODE-02.8`。
- **依赖 / 阻塞：** AG-P0-005/006、AG-B13-002、端点分页 spike；在契约未定前禁止优化性改端点。
- **允许触碰：** query services/domain/UI/perf fixtures/tests。
- **步骤：** 定义数据量和等待预算；测量首屏/筛选/切页/图谱；采用已验证分页/分段；显示进度和取消。
- **已完成子范围（2026-10-04/05）：** v3.8.6 隔离内核实证 `renderAttributeView` 的 `page/pageSize/query` 与 `rowCount`；联系人卡片/表格首屏走 `listContactPage`，后续页逐页追加，行重复/空页矛盾会停止并报错，支持停止、继续和失败重试；组织标记按 `root_id` keyset 分页，`COUNT/MIN/MAX` 聚合阻断重复标记漏过游标，文档 ID 批量回读后再展示，组织卡片也支持后台续读；名册未完整时禁用“选择全部筛选”。新增合成 1k/10k 基线：联系人首屏/全量投影、客户端搜索/分组筛选、组织首屏/全量投影共 `12/12` 达到隔离预算。证据：`scripts/spike/av-pagination-spike.mjs`、`scripts/spike/av-pagination-results.json`、`scripts/spike/organization-pagination-spike.mjs`、`scripts/spike/organization-pagination-results.json`、`scripts/spike/scale-baseline-spike.mjs`、`scripts/spike/scale-baseline-results.json`、`docs/verification/SCALE-BASELINE-2026-10-05.md`、`src/api/organization.ts`、`src/services/contacts.ts`、`src/services/org.ts`、`src/components/people/PeopleView.svelte`、`src/components/org/OrgsView.svelte`。
- **已完成子范围（2026-10-05 增补）：** 联系人搜索词经 `listContactPage` 下推到已验证的 AV `query` 参数；PeopleView 对搜索变化做 250ms 防抖，并取消旧分页代际，后续页复用同一搜索快照，避免 10k 名册先全量读完再客户端过滤。服务夹具验证 400 条名册中 `人物 4` 过滤后返回 12 条，权威 `rowCount` 与 `hasMore` 一致。证据：`src/services/contacts.ts`、`src/components/people/PeopleView.svelte`、`tests/contact-write-services.test.ts`。
- **已完成子范围（2026-10-05 组织卡片筛选）：** 组织卡片在后台分页续读的同时支持按名称搜索和活跃/归档状态筛选；无匹配结果显示独立空态并可清除筛选，组织总量与当前显示数分开表达，筛选不会改变稳定 `docId` 或分页游标。纯函数规则与 UI 回归覆盖大小写/空白查询、状态筛选、清除恢复和分页首屏续读。证据：`src/domain/organization-scan.ts`、`src/components/org/OrgsView.svelte`、`tests/organization-scan.test.ts`、`scripts/e2e/ui/organization-page-regression.js`。
- **已完成子范围（2026-10-05 取消闭环）：** 分页读取的 `AbortSignal` 从 `PeopleView` 贯穿 `listContactPage`、`renderViewPage` 与内核超时包装；搜索切换、停止续读、组件销毁会中止当前待读请求，取消不显示为失败，明确失败仍保留继续读取入口。已取消请求在发出内核调用前即拒绝，迟到响应不会落位。`tests/contact-write-services.test.ts` 新增取消零读取回归；定向 48/48、全量 512/512、`pnpm check` 0 errors / 0 warnings。
- **剩余范围：** 10k 真实数据耗时/内存、AV 搜索在真实用户大库与复杂条件下的预算、分页 SQL 在真实用户大库的预算、移动端软键盘与长列表锚点预算尚未验证；不得将隔离夹具和小型参数 spike 当成规模验收。
- **验收：** 1k/10k fixture 达到预算；错误、空、取消可区分；不会为性能省略来源或状态。

#### AG-BRIDGE-001 — 外部桥协议版本和能力声明

- **状态 / 类型 / 优先级：** `done_isolated` / `contract+research` / P2 / M4。
- **用户结果：** 外部工具知道当前插件支持什么、请求是否可重放、失败如何处理，不会把未支持能力当作成功。
- **来源与证据：** `CODE-02.13`、`src/bridge/external-bridge.ts`、`DATA-CONTRACT §7`。
- **依赖 / 阻塞：** AG-P0-010；未形成协议决策前不扩展桥。
- **允许触碰：** bridge contract/docs/spike/tests。
- **步骤：** 评估版本、能力、幂等键、批量结果、错误码、隐私边界；写最小协议草案和兼容策略；做隔离调用 spike。
- **验收：** 形成采纳/延期决策、示例请求和逐项结果定义；不修改主流程代码。

#### AG-QA-001 — 故障注入、回归和证据包

- **状态 / 类型 / 优先级：** `done_isolated` / `test+docs` / P1 / M3。
- **用户结果：** 每个高风险流程都能证明正常、空、失败、部分成功、未知、取消、重试和回滚行为。
- **来源与证据：** `UX-03.25~.28/.50/.60`、`tests/e2e-safety.test.mjs`、现有 UI smoke。
- **依赖 / 阻塞：** 各实现任务；可与实现并行设计夹具。
- **允许触碰：** `tests/`、`scripts/e2e/`、`docs/UI-REGRESSION.md`、`docs/PAGE-STATUS.md`。
- **步骤：** 建立内核超时/坏形状/权限/并发/写后回读失败 fixture；每条用户旅程留命令、截图、结果；隔离与宿主证据分开。
- **验收：** `pnpm check && pnpm test` 通过；受影响任务有 UI/真内核命令；未验证宿主状态显式列出。

#### AG-QA-002 — 发布前架构、保护文件和视觉门禁

- **状态 / 类型 / 优先级：** `done_isolated` / `test+docs` / P1 / M3。
- **用户结果：** 合并前不会引入反向依赖、直接 API/存储调用、颜色令牌漂移或误改保护文件。
- **来源与证据：** 根 `AGENTS.md`、`tests/architecture.test.ts`、`UX-03.51/.58/.60`。
- **依赖 / 阻塞：** 所有源码任务；可在每个批次执行。
- **允许触碰：** architecture tests、CI/helper、回归文档。
- **步骤：** 扫描保护文件 diff；跑架构测试、类型/Svelte 检查、全量测试；检查 `lvct-` 和 B3 变量；登记宿主待验项。
- **验收：** 无保护文件变更；`pnpm check && pnpm test` 全绿；UI 批补 `pnpm test:ui`/`pnpm test:ui:mobile`；证据路径可复现。

#### AG-QA-003 — 实际产品服务链的跨轮续做与故障回归

- **状态 / 类型 / 优先级：** `done_isolated` / `test+docs` / P0 / M2。
- **user_outcome / user_scenario：** 测试不只证明纯函数；能够检出“继续扫描没有前进”和已写入后重试重复等跨步骤缺陷。
- **source_ids / current_evidence：** 本轮 242 单元测试全绿，但 init 服务有累计预算缺陷；现有 init-plan 测试仅覆盖游标合法性与短页判定。
- **补充服务 fixture：** 字段请求成功但未实际改变值、生日/农历连续保存、空值清除与字段核实失败；对应 AG-P0-003 的重开余项。
- **depends_on / blocks / parallel_group / preconditions：** 可先基于现有代码写失败复现；通过依赖 AG-P0-003/006/014/015/018 的修复；阻塞这些任务 done_isolated；service-regression；使用已有 Siyuan 内存适配器，不复刻服务算法。
- **allowed_files / forbidden_files / contract_change / host_or_spike_required：** tests、scripts/e2e/UI-REGRESSION、PAGE-STATUS；保护文件；无；API 新参数真实证明另走 spike，不用 mock 替代。
- **ordered_steps：** 建立可分组单独运行的产品服务 fixture；1501 篇跨调用扫描；跨笔记本/空本/未知总数/失败重试；多 AV/并列/零匹配/读取失败；捕获第 2 人失败；账本未知写结果；记录修复前后证据。
- **test_fixtures / test_commands / acceptance：** 上述 fixture 加正常/空/取消/并发；check/test/UI；直接调用实际 service，断言 cursor 前进、累计正确、零误新建和重试不重复。
- **failure_retry_rollback / privacy_boundary / performance_budget：** 测试失败保留摘要，不连接用户内核；只用虚构人物；分页请求必须有界、测试可独立复现。
- **已完成子范围：** P0-006 的 6 个实际扫描服务用例及 1 个设置页服务链用例已在桌面/390px 全部通过，检出跨轮预算不前进和失败重试漏候选；既有 inspectWorkspace 多 AV/并列/零证据用例仍通过。
- **存储服务链增量：** P0-019 新增 2 个实际双上下文故障用例及详情页错误/草稿/重试验证，锁接管数据丢失有修复前后证据。该证据不替代账本稳定请求身份、联系人 AV 值核实和捕获逐人 checkpoint 测试。
- **剩余范围：** 无隔离代码余项；真实内核持久化、真机与多窗口仍由 Host Queue 验收。
- **本次证据：** 字段写后核实、连续生日/农历/清空、捕获逐人失败、账本未知写结果与重试、迁移新模块均已加入实际产品服务链回归；桌面功能断言 132/132、390px 133/133，`pnpm test` 276/276，`pnpm check` 和构建通过。
- **evidence_paths / owner / last_updated / commit：** 审查报告、tests/init-plan、scripts/e2e/ui、UI-REGRESSION；Codex；2026-10-04；未提交。

#### AG-QA-004 — UI 契约夹具一致性与 Windows 清理稳定性

- **状态 / 类型 / 优先级：** `done_isolated` / `test+docs` / P0 / M2。
- **user_outcome / user_scenario：** UI 门禁重新提供可信结果，不因旧 mock 与新 API 契约不一致而整片失败，也不因清理异常遮蔽原始断言。
- **source_ids / current_evidence：** 本轮 UI 日志 57 PASS / 45 FAIL（含诊断项）；多个 mock 成功信封缺 msg；部分 facade 缺组织接口；Windows rmSync 报 EPERM。不能继续引用旧 101/103 作为当前工作区质量结论。
- **depends_on / blocks / parallel_group / preconditions：** AG-P0-005 现行信封/端点契约；阻塞全部当前 UI 完成声明；test-infra；正常夹具按契约修正，故障夹具保留真实坏形状。
- **allowed_files / forbidden_files / contract_change / host_or_spike_required：** scripts/e2e adapter/fixtures/runner、tests、UI-REGRESSION；生产业务与保护文件；无，不为旧 mock 放松生产解码；真实宿主另验。
- **ordered_steps：** 统一合法响应构造器与最小 facade；覆盖新增面板接口；保留 protocol 负例；关闭 debugger/server/browser 并等待当前进程退出；验证清理目标属于本轮独立临时目录后有限重试；始终保留原始报告与真实退出码；恢复基线后再按产品任务归因剩余失败。
- **test_fixtures / test_commands / acceptance：** 桌面/390px、坏 msg、缺 facade、浏览器迟退出；check/test/UI/mobile；不能跳过失败用例、扩大 timeout 或吞清理异常来冒充全绿，重复运行报告稳定。
- **failure_retry_rollback / privacy_boundary / performance_budget：** 清理失败只说明本轮残留路径，不跨 shell 删除、不杀用户浏览器；日志脱敏；有限清理等待，不拖住断言结果。
- **本次证据：** 统一 mock 成功/失败信封和空写返回，合法 AV 单元格补齐类型、插块事务补齐动作；工作台只补最小空读 facade，保留失败实现。捕获结果/日记/标记块 fixture 与现行契约一致；本人改绑使用合法 itemID 并验证回读；乱序用例改用相对日期，仍验证迟到旧响应不能覆盖新值。生产解码未放松，断言未跳过。
- **清理与验证：** 优先通过本轮 CDP 通道关闭浏览器，等待退出后只删除已验证的独立临时目录；失败保留原报告/非零退出码/残留路径。9/9 安全用例覆盖信封负例、越界/链接拒绝、Windows 进程树等待、正常关闭和迟迟不退出；桌面 110/110、390px 111/111 均正常退出，两个本轮目录已不存在，无 EPERM 或未处理异常。check/test/build 通过；日志及范围见 UI-REGRESSION。真实宿主与真机仍另验。
- **evidence_paths / owner / last_updated / commit：** 审查报告与临时 UI 日志、ui-smoke.mjs；Codex；2026-10-03；未提交。

## 5. Host Queue 任务卡

这些任务必须由能访问真实思源内核、真实前端或真机的 Agent 执行；普通隔离测试只能把上游任务标为 `host_pending`。

### AG-HOST-001 — 原生图打开、中心透传和 `siyuan://blocks` 成边

- **状态 / 类型 / 优先级：** `host_pending` / host / P1 / M3。
- **依赖：** `AG-B14-002`。
- **步骤：** 在桌面和移动真实宿主执行原生图入口；确认中心、返回、范围提示；创建受控块链接，观察原生图是否生成预期边；保存版本、前端、截图、响应。
- **验收：** 证据可复现；失败时保持自研图/文本降级，不能修改用户正文以“修出”边。
- **当前证据：** 隔离图数据 `refs` 双向边、`getGraph/getLocalGraph` 已通过；普通 Markdown `siyuan://blocks/<docId>` 未形成 refs 边。原生图面板入口、中心透传和真实成边仍未核验。

### AG-HOST-002 — 组织、成员和多窗口刷新

- **状态 / 类型 / 优先级：** `host_pending` / host+e2e / P1 / M3。
- **依赖：** `AG-B13-003/004/006`。
- **步骤：** 两窗口同时改组织名、成员状态、归档和人物投影；关闭一个窗口后触发延迟事件；核对图谱和首页。
- **验收：** 最终值一致；无旧实例回调；失败/未知清楚显示。
- **当前证据：** 真实隔离 browser-desktop 已通过组织单页改名、成员编辑、归档、恢复、刷新；同源双页面中组织改名、成员职位、归档/恢复均已原地回读，人物/互动 ref 幂等也已通过。组织成员对应人物文档投影的专门双窗口核对、真实用户工作区和真机仍未验。

### AG-HOST-003 — 原生任务块全量对账

- **状态 / 类型 / 优先级：** `host_pending` / host+e2e / P0 / M2。
- **依赖：** `AG-P0-008`。
- **步骤：** 创建、修改、完成、删除至少 6 条跨日期任务；重启/刷新后检查索引、文档和首页；注入一个受控块读取失败。
- **验收：** 各侧状态逐项一致或明确未对账；失败不会伪装成功。
- **当前证据：** v3.8.6 隔离内核已通过任务块创建、扫描、勾选/取消、批量标记、自定义属性保留、删除反查和 ID 分页；真实用户工作区全量对账仍待验。

### AG-HOST-004 — 真机移动、键盘、安全区和系统返回

- **状态 / 类型 / 优先级：** `host_pending` / host+a11y / P1 / M3。
- **依赖：** `AG-UX-005`、`AG-B14-004`。
- **步骤：** 覆盖 390px、软键盘、底部导航、全屏人物/组织详情、导入、图谱文本和系统返回；记录 getFrontend 判断与实际布局。
- **验收：** 无主按钮遮挡、横溢或焦点丢失；系统返回和关闭恢复上下文。
- **当前证据：** 390px 隔离 UI `315/315`、宿主样式 UI `314/314`；真机软键盘、安全区和系统返回仍未核验。

### AG-HOST-005 — 原型关键旅程真实宿主复核

- **状态 / 类型 / 优先级：** `host_pending` / host+docs / P1 / M3。
- **依赖：** `AG-QA-001`。
- **步骤：** 走八条主旅程：首次成功、找人、互动、捕获、导入失败恢复、组织维护、双图查证、备份恢复；每条保存步骤/截图/结果/未验项。
- **验收：** 与 `PAGE-STATUS` 和 `UI-REGRESSION` 对齐；不以“看起来像原型”代替行为证据。
- **当前证据：** 隔离真实 browser-desktop 已通过生日、账本、别名、跟进、组织界面与重载回读，并保存组织/详情截图；真实用户工作区八条旅程仍待验。

### AG-HOST-006 — 用户五项反馈的真实读写验收

- **状态 / 类型 / 优先级：** `host_pending` / `host+e2e+docs` / P0 / M3。
- **user_outcome / user_scenario：** 生日可持久保存，多人事项四侧双链可核对，账本/别名可重启读取，员工替换保留组织与人员历史。
- **source_ids / current_evidence：** 用户五项原始反馈；当前已有各项代码，缺真实宿主闭环证据。
- **depends_on / blocks / parallel_group / preconditions：** AG-P0-003/006/014/015/016/017/018/019、AG-ALIAS-001、AG-QA-004；阻塞五项“全部完成”声明；host-user-feedback；用户允许的隔离思源工作区和版本记录，不默认操作日常库。
- **allowed_files / forbidden_files / contract_change / host_or_spike_required：** 验收 scripts、审查证据、UI-REGRESSION/PAGE-STATUS；保护文件和日常人物原文；无；必须真实内核/前端并记录版本。
- **ordered_steps：** 公历/农历/清空/闰日生日保存后回读并重启；多人来源/日记/地点/人物引用和反链核查、重复捕获/局部失败重试；账本建立/结清/重开/备份恢复；别名冲突/泛称/有效人物匹配；同组织员工替换、离职历史和两侧刷新。
- **test_fixtures / test_commands / acceptance：** 虚构两组织、多位人物、特殊字符、失败注入；相关 spike 与实际操作步骤；每项保存输入/输出/回读/版本/截图，未验项不能用隔离通过替代。
- **failure_retry_rollback / privacy_boundary / performance_budget：** 局部成功保留事实，只清理本轮受控测试产物；禁外发真实往来与联系人；记录请求数和大库边界，不新增性能承诺。
- **current_evidence：** 隔离真实产品服务 `9/9` 含重启回读；browser-desktop 已通过生日、账本、别名、跟进、组织 UI/刷新、组织改名/成员职位/归档恢复跨窗口原地刷新、双页面幂等及截图。已实际尝试打开多人事项来源文档进入捕获弹窗，但宿主返回 `Uncaught`，捕获 UI 保持未验；真实用户工作区、组织成员对应人物投影的专门双窗口核对、原生图、真机仍未验。
- **2026-10-05 复核：** 真实隔离 browser-desktop `realFrontend=true`，核心用户旅程、页面重载回读和双页面稳定幂等均通过；捕获来源文档打开仍返回 `Uncaught`，因此捕获 UI 保持未验。该证据不替代真实用户工作区、组织双窗口、原生图和真机验收。
- **evidence_paths / owner / last_updated / commit：** `docs/verification/SERVICE-KERNEL-2026-10-04.json`、`docs/verification/REAL-FRONTEND-2026-10-04.md`；Codex；2026-10-04；未提交。

## 6. 研究候选（只调研，不直接开发）

### AG-RF-001 — 候选能力的隐私、契约和宿主评估

- **状态 / 类型 / 优先级：** `candidate` / research / P3 / M5。
- **范围：** 纪念日、礼物往来、周回顾、谈资、地图/日历、OCR/二维码、嵌套组织、类型化关系、推荐和 Agent 自动行动。
- **边界更新：** 用户明确提出的金钱/物品/人情往来账本已经落盘，不再作为未立项候选；账本质量收口走 `AG-P0-015/016/017/018`。礼物推荐、购买计划和自动提醒仍为候选，不能借账本入口扩大范围。
- **每项产物：** 用户问题、事实源、存储/迁移、外发边界、宿主依赖、移动成本、解释方式、最小 spike、采纳/延期决定。
- **禁止：** 不因原型出现、竞品存在或 AI 能生成就进入主导航、DATA-CONTRACT 或生产写入。

### AG-RF-002 — AI 能力的分阶段研究

- **状态 / 类型 / 优先级：** `candidate` / research / P3 / M5。
- **范围：** 关系摘要、谈资建议、候选标签、下一步建议、OCR/二维码、外部 Agent。
- **门槛：** 先完成 `AG-AI-001/002`；研究只输出脱敏样本、可追溯证据和人工确认设计，不写联系人事实、提醒或图谱。

## 7. 统一完成定义和 Agent 回报模板

任务只有同时满足以下条件才能从 `in_progress` 转为 `done_isolated`：

- 依赖、契约、文件范围和禁止范围没有变化；
- 所有写入遵守锁内重读、写后回读、幂等和局部失败语义；
- 域层保持纯函数，API 只在 `src/api/`，JSON 只经 storage；
- 正常/空/加载/失败/部分成功/未知/取消/重试状态有测试或证据；
- `pnpm check && pnpm test` 通过；UI 任务补对应 UI smoke，API/宿主任务补 spike；
- 保护文件 diff 为空；
- 回读实现并填写证据路径、剩余风险、后续任务。

转为 `done` 还需要任务卡要求的真实思源、真机、多窗口或发布门禁证据。否则保持 `host_pending`。

Agent 完成后在任务卡追加：

```md
完成回报：
- 修改文件：
- 未修改的保护文件：version / CHANGELOG / README 徽章 / docs/PROGRESS.md
- 测试命令与结果：
- spike / 真宿主 / 真机证据：
- 正常、空、失败、部分成功、未知、取消、重试覆盖：
- 已知风险与回滚方式：
- 下一张可解锁任务：
- commit：
```

根 Agent 在合并前再检查 `git diff --name-only`、架构测试、全量测试和保护文件，确认后按用户授权执行 `git push`。

### AG-SYNC-001 — CardDAV / CalDAV 同步方向调研与契约拆解（candidate）

- **状态 / 类型 / 优先级：** `candidate` / `research+contract+spike` / P2。
- **用户结果：** 明确能否让手机通讯录显示人脉联系人、能否把跟进事项送到手机日历提醒，以及哪些资料永不自动同步。
- **来源：** 2026-10-06 用户反馈：希望 CardDAV 同步手机通讯录，并进一步用 CalDAV 同步待办/日历提醒。
- **依赖 / 阻塞：** 依赖当前数据恢复策略和真实宿主网络边界；未完成 RFC/服务器矩阵前禁止写在线同步主流程。
- **步骤：** ①验证 RFC 6352/RFC 4791 发现、REPORT、ETag、sync-token、UID、VTODO/VEVENT/VALARM；②用隔离账号测试 Nextcloud/Radicale/iCloud 或记录排除项；③补 CardDAV/CalDAV 数据契约、凭据策略、字段白名单、删除/冲突语义；④产出可审阅 UI 流程与错误矩阵。
- **CardDAV 字段边界：** MVP 仅姓名、电话、邮箱、网站、公历生日、公开备注、可选 CATEGORIES；不自动同步 docId/itemId、关系、组织历史、互动、跟进、本人标记、AI 内容、私密字段。头像/农历/自定义字段必须逐项提示。
- **CalDAV 字段边界：** MVP 只评估 follow-up → VTODO；生日/纪念日 → VEVENT 另列候选。状态、到期日、UID、更新时间和提醒提前量可配置；不外发互动和人物全文。VALARM 不受所有服务器保证，UI 必须显示能力差异。
- **安全与体验：** 凭据不得进普通 JSON、日志或迁移包；首版只手动/工作台打开触发，先预览再写，按条显示成功/冲突/失败/未知；远端删除进入确认回收，不删除思源人物文档；支持暂停、断开、清除凭据和脱敏诊断。
- **测试/验收：** 新建、更新、删除、同名不同人、ETag 冲突、sync-token 断点、离线/401/403/TLS、重复点击、时区/DST、VTODO 不支持、手机锁屏通知；必须在真实服务器和设备验证，mock 只能证明域函数。
- **禁止：** 不把 vCard 文件导入导出宣传成 CardDAV；不假设所有服务 URL/鉴权兼容；不做后台常驻和系统通知承诺；不因同步失败覆盖本地事实。
- **负责人 / 更新时间：** Agent / 2026-10-06。

#### AG-SYNC-002 — CardDAV 手动预览与单向同步（blocked）

依赖 AG-SYNC-001 的服务器矩阵和契约；先做地址簿选择、字段开关、预览、逐条报告与回滚，再决定导出到服务器或从服务器导入。未实现前继续使用现有 vCard 文件导入导出。

#### AG-SYNC-003 — CardDAV 双向冲突同步（blocked）

依赖 AG-SYNC-002；增加远端 UID/ETag/sync-token、字段级冲突队列、远端删除确认、断点和手动重试。默认不按姓名合并、不自动删除人物文档。

#### AG-SYNC-004 — CalDAV 跟进事项 → VTODO（blocked）

依赖 AG-SYNC-001 和现有 follow-up 契约；先验证服务/手机对 VTODO、STATUS、DUE、VALARM 的支持，设置目标日历和提醒提前量，支持手动同步、冲突队列与脱敏诊断。生日 VEVENT、后台定时同步和系统通知保证另行评估。

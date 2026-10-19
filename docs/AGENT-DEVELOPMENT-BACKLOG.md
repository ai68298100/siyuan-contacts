# 小驴人脉 Agent 开发待办

> **唯一执行入口。** 本文件只收录仍需开发、补证据或做决策的原子任务，供 AI Agent 直接认领。旧任务编号、产品背景和历史证据仍以 [FEEDBACK-BACKLOG](FEEDBACK-BACKLOG.md)、[NEXT-DEVELOPMENT-PLAN](NEXT-DEVELOPMENT-PLAN.md)、[PRODUCT-PLAN](PRODUCT-PLAN.md)、[UI-SYSTEM-SPEC](UI-SYSTEM-SPEC.md) 与 [DATA-CONTRACT](DATA-CONTRACT.md) 为来源；旧文档中的 `✅` 不会自动变成当前待办。
>
> **更新规则：** 一个任务只允许一个 Agent 认领；先更新本卡状态，再开始编码。完成代码不等于真实宿主完成，`host_pending` 必须保留到真内核、真机或多窗口证据齐全。版本号、`CHANGELOG`、README 徽章、`docs/PROGRESS.md` 是普通实现任务的保护文件；用户明确要求校准状态文档时，仅按该文档任务范围更新。

> **2026-10-06 产品评审入口（历史快照）：** 当时复核为桌面 UI `314/315`、390px UI `315/316`，且工作区有未提交变更。跨模块产品判断见 [PRODUCT-REVIEW-2026-10-06](PRODUCT-REVIEW-2026-10-06.md)。当前版本与门禁以本文件最新状态和 [RELEASE](RELEASE.md) / [UI-REGRESSION](UI-REGRESSION.md) 为准；不要沿用该历史数字或已完成的 PR-P0-01/02 作为当前待办。

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

> **2026-10-18 已授权开发：** 用户明确暂缓 #35，开始其余审计修复。执行卡与分工见 [AUDIT-REPAIR-PLAN](AUDIT-REPAIR-PLAN-2026-10-18.md)，四卡已认领；先修数据缺陷，再统一 UI、驱动、打包和证据，不把研究候选算入本轮承诺。#35 继续等待用户原始脱敏小米样本，公开样本仅作补充。

> **2026-10-18 综合审计增量：** 当前稳定版已是 v0.5.18，本地与远程 main 一致；下方 v0.5.16/17 顺序和门禁按历史轮次阅读。[本轮审计](CURRENT-STATUS-AUDIT-2026-10-18.md)复现的三项 P1（归档成员状态、模板并发覆盖、迁移互动墓碑）已在 `fix/audit-20261018` 本地修复，执行卡已达到 `done_isolated`，尚未提交、推送或发布。当前 main/发布 CI 通过；PR #33 尚开放且落后 main，#35 尚缺脱敏样本。真实隔离服务 11/11，等待资料就绪后的真实 Chrome 前端通过，但日常库/原生编辑器/真机与其他 Host Queue 余项仍单列。

> **2026-10-15 v0.5.11 发布快照：** 已发布提交 `2638540`。当时桌面 UI 为 378/378，移动隔离 UI 为 377/378，C03 仍以桌面控件路径运行；下方 v0.5.12 发布状态记录了后续测试夹具修正与最新结果。历史发布证据和当前门禁见 [RELEASE](RELEASE.md)、[UI-REGRESSION](UI-REGRESSION.md)。

> **v0.5.15 发布状态（2026-10-16）：** 已发布 tag/Release；往来账本创建、连续写入和状态变更的陈旧回读竞态已修复，`pnpm check`、596/596 单测、桌面/移动/宿主样式 UI 381/381、构建与发布门禁通过。`package.zip` 581,946 B，SHA-256 `cd271b7b62db1bce86d99b17e64e4a7a547963f79db70016bac467553ab2f8b`，Release 下载复核一致。Issue #35 仍缺脱敏 VCF，不能确认 vCard 候选修复就是报告根因；#36–#40 已关闭。

> **v0.5.16 发布与契约复评（2026-10-16）：** PR #42 普通合并后，annotated tag `v0.5.16` 指向 `4372593`；Release 附件下载复核为 582,401 B，SHA-256 `91c2d4bece34509a2a72468a7d097af4d1bd566ceadfcb2a392fc4331cd731b8`。发布前本地 `pnpm check`、597/597 单测、三套 UI 各 381/381、构建与发布门禁通过；发布后 CI 与未验收边界见 [RELEASE](RELEASE.md)。AG-B13-007 现有模型契约已完成复评（D-0037/0038），无需新增 schema，整卡仍为 `partial`。

> **v0.5.17 发布与 Host Queue 校准（2026-10-17）：** #51/#54 已完成并关闭；`pnpm check` 0/0、710/710 单测、桌面/移动/宿主样式 UI 各 416/416、构建和 Release 门禁通过。隔离真实内核续跑为 `3.8.8-alpha.3`、实际服务 `11/11`，真实 Chrome `browser-desktop` 通过；脱敏证据见 [HOST-QUEUE-2026-10-17](verification/HOST-QUEUE-2026-10-17.md) 与 [ALPHA3 摘要](verification/SERVICE-KERNEL-2026-10-17-ALPHA3-SUMMARY.json)。真实用户工作区、原生编辑器、原生图、其他任务管理器互读和 Android 真机仍保持 `host_pending`；PR #33 的 G-03 隔离真实宿主 smoke 已通过，合入仍需用户授权，不重发 v0.5.17。

> **v0.5.16 后执行顺序：** ① Issue [#35 无法导入联系人](https://github.com/ai68298100/siyuan-contacts/issues/35) 继续保持开放，取得保留首卡属性结构的脱敏 VCF 后再确认候选修复是否命中根因；② 若具备隔离的真实思源测试环境，优先推进 P0 `AG-HOST-003`（任务块全量对账）和 `AG-HOST-006`（用户反馈真实读写验收）；③ AG-B13-007 的现有契约、当前投影与 member 边生命周期隔离实现已收口，不重复安排契约评审，继续补真实宿主、多窗口、迁移、真机和规模证据；④ `AG-SCALE-001` 保持 P2/partial，R54 视觉迁移先补成有依赖和验收条件的原子任务卡。2026-10-17 已按重复工单关闭 #46、#48；对应宿主余项仍留在 Host Queue。

依赖开放口径：`done_isolated` / `host_pending` 仅开放不依赖真实宿主结论的隔离开发；真实端点、真机与多窗口结论仍由 Host Queue 守门。`ready` 必须满足所有实现前置；`partial` 表示已有代码，不代表剩余步骤的依赖已满足。

### Ready / Partial Queue（当前）

2026-10-16 新反馈已授权修复；以下相关卡已完成隔离收口，真实宿主仍由 Host Queue 验收。2026-10-17 已按 D-0039 直接实现 #51/#54 的重复条目与两层分组，采用人物文档独立“补充资料”快照，详见下方 `AG-ISSUE-051-054-FIELDS`，不再等待完整联系方式模型的全部研究项。Issue #35 仍等脱敏样本确认；#46、#48 已于 2026-10-17 按重复工单回复并关闭，历史成员和组织生命周期的宿主余项不因关闭重复工单而改变。AG-B13-007 现有契约及隔离实现已完成，真实宿主余项继续由 Host Queue 验收。

2026-10-16 未解决 Issue 研究筛选保留为历史：#35 的三处合成解析缺口已修复并通过 17/17 矩阵，但不等于小米根因已确认；#51/#54 的完整联系方式投影、搜索与迁移研究继续保留为后续候选。重复资料与两层分组已有独立生产契约和实现，不再沿用“母子条目排在完整联系方式契约之后”的旧顺序。历史研究来源见 [OPEN-ISSUE-RESEARCH-PLAN-2026-10-16](verification/OPEN-ISSUE-RESEARCH-PLAN-2026-10-16.md)，当前交付范围见 [首版实现](verification/MULTI-CONTACT-MINIMAL-PATH-2026-10-17.md)。

#### AG-E32-TOPICS — 会面谈资与备忘（E-32）收口与保真

- **status / priority / type / milestone：** `done_isolated` / P1 / feature+migration / M4；已完成纯函数域层、持久化存储、严格写前检查、迁移包往返与覆盖、双语国际化（14键）、简报导出置顶及桌面/移动/宿主样式 UI 476/476 回归；真实思源多窗口与日常工作区待 Host Queue。
- **user_outcome / user_scenario：** 用户在人物详情可随时记录与联系人下次见面想聊的话题、承诺或兴趣点；新增话题自动置顶，支持一键复制反馈与移除；导出会面简报 Markdown 时自动置顶呈现；跨设备/工作区迁移时谈资备忘完整保留，不因迁移丢失。
- **source_ids / current_evidence：** E-32、PR #62；`src/domain/topics.ts`、`src/data/topics.ts`、`src/services/migration-bundle.ts`、`src/components/people/PersonDetail.svelte`、`public/i18n/`；单测 794/794 全绿，UI 回归 476/476。
- **depends_on / blocks / parallel_group / preconditions：** DATA-CONTRACT §3 键表更新 / 迁移覆盖与 i18n 完整性 / topics / 独立自管 JSON，无 AV 字段变化。
- **allowed_files / forbidden_files：** topics 域/数据/服务、PersonDetail、i18n、migration-bundle、测试、相关契约与回归文档 / 版本号、CHANGELOG、README 徽章、PROGRESS.md、真实用户库。
- **contract_change / host_or_spike_required：** DATA-CONTRACT §3 新增 `person-topics.json`（版本 1，单人最多 15 条，单条 140 字符，docId 正则，严格读 + Web Lock + 写后回读），迁移包模块数 12 → 13 并入 `MIGRATION_COVERAGE`。
- **ordered_steps：** 注册单测至 package.json → 补充 DATA-CONTRACT 契约 → 迁移 bundle 导出/导入/预览支持与往返测试 → 双语国际化与 text() 改造 → smoke UI 夹具与 476/476 回归 → 任务卡与状态归档。
- **test_fixtures / test_commands / acceptance：** 纯函数新增/置顶/移除/规范化/超长超限/严格校验、简报置顶导出、迁移合并现状优先与去重、MIGRATION_COVERAGE 包含、smoke UI 空态/新增/置顶/复制/移除；`pnpm check`、`pnpm test`（794/794）、`pnpm test:ui`（476/476）、`pnpm build`、`pnpm check:release`。
- **failure_retry_rollback / privacy_boundary / performance_budget：** 坏条目整体拒绝抛出 StoreIntegrityError；写失败保留草稿；单人最多 15 条、单条 140 字符；纯本地插件 JSON，不发送网络或外部 AI。
- **evidence_paths / owner / last_updated / commit：** `tests/topics.test.ts`、`tests/contact-write-services.test.ts`、`scripts/e2e/ui/smoke.js`、`scripts/e2e/ui/migration-regression.js` / Codex / 2026-10-19 / 分支 `fix/e32-topics-closeout`。
- **退出边界：** 隔离代码、单测、迁移和三套 UI 476/476 全部通过；真实思源跨窗口、真机与日常库保留 Host Queue。
- **完成回报：** `pnpm check` 0 错误 0 警告、单测 794/794、三套 UI（桌面、390px、宿主样式）各 476/476、`pnpm build` 与 `pnpm check:release` 全部通过。

#### AG-ISSUE-051-054-FIELDS — 重复资料与两层分组首版

- **status / priority / type / milestone：** `host_pending` / P1 / feature+regression / M4；生产实现、隔离内核与隔离 Chrome 验收已完成，真实用户工作区、原生编辑器竞争、真机等边界继续由 Host Queue 守门；发布与 issue 关闭见 `AG-ISSUE-051-054-CLOSE`。
- **user_outcome / user_scenario：** 人物详情可维护多个电话、微信、邮箱等同名或同值条目，并可放入“联系方式”等顶层分组；个人备注继续独立保存。
- **source_ids / current_evidence：** Issue #51/#54、D-0039；域、API/服务、编辑器、facade 与人物详情已接通。隔离真实内核创建/更新/清空、冲突零覆盖、未知只读核实、错 owner 拒绝及重启回读通过；139次请求逐次核验 PID 归属，5次生产服务写入。
- **depends_on / blocks / parallel_group / preconditions：** DATA-CONTRACT §6A、现有 DOM 块写读实证 / 本首版交付与 issue 验收 / person-fields / UUID 隔离工作区、虚构资料；完整 contactMethods 研究不是本卡前置。
- **allowed_files / forbidden_files：** person-fields 域/API/service/测试、PersonFieldsEditor、facade/详情接线、样式、UI/host 回归及相关契约/说明 / 版本、CHANGELOG、真实用户库和其他任务的已有改动。
- **contract_change / host_or_spike_required：** 人物原生单块 schema1 完整可见快照，独立 marker 和 ownerDocId；无插件 JSON、无 AV 投影。真实隔离 Kernel 生产服务已验证；真实原生前端交互与多窗口等边界另记。
- **ordered_steps：** 冻结 D-0039/§6A → 域/API/service → 编辑器和详情接线 → 单测/隔离 UI/构建 → UUID 内核重启与冲突/未知验证 → 真实详情入口回归 → 交付并核对用户场景。
- **test_fixtures / test_commands / acceptance：** 同名同值、两层分组、特殊字符/多行/空值、分组删除的两种选择、草稿关闭、迟到响应、失败重试、HTTP UUID fallback、390px；`pnpm check`、`pnpm test`、三套 UI、`pnpm build`、`pnpm check:release` 与专门 spike。成功必须同块完整回读；未知不重发；失败保留草稿，坏格式不按空库覆盖。
- **failure_retry_rollback / privacy_boundary / performance_budget：** 原块 ID 和完整基线冲突则停止；未知请求在当前窗口只读核实，非原生 CAS；仅虚构数据验收。每人最多100项、标签80字符、值2000字符、JSON100000字符；加载只查目标文档，候选上限2用于歧义检测。
- **evidence_paths / owner / last_updated / commit：** [首版范围](verification/MULTI-CONTACT-MINIMAL-PATH-2026-10-17.md)、[真实内核验证](verification/PERSON-FIELDS-2026-10-17.md)、`scripts/e2e/ui/person-fields-regression.js`、`scripts/spike/person-fields-results-b3986e47-2fdd-47df-9709-eb06f79027d0.json` / Codex / 2026-10-17 / `0674d9e`（随 `ee4e515` 文档同步）。
- **退出边界：** 补充资料随人物文档备份，未进入基础主字段、全局搜索、快捷联系、AI、桥、vCard 或插件迁移包。原生编辑器竞争、真机和日常用户工作区不以隔离回归替代。#51/#54 的发布与关闭已完成，剩余环境边界不回退为开发任务。
- **完成回报：** 首版隔离与 v0.5.17 联合验收已由 `AG-ISSUE-051-054-CLOSE` 汇总：`pnpm check` 0/0、完整单测710/710、Chrome桌面/390px/宿主样式 UI 各416/416、E2E/Kernel smoke 17/17；Release 附件下载复核通过。整卡保留 `host_pending` 只表示声明中的真实环境边界。

#### AG-ISSUE-051-054-USE — 补充资料详情查找、复制与双页面冲突验收

- **status / priority / type / milestone：** `done` / P1 / feature+e2e / M4；本卡要求的隔离真实Chrome范围已验收并随 v0.5.17 交付；父卡的真实用户工作区、原生编辑器和真机边界仍分别保留。
- **user_outcome / user_scenario：** 在人物详情内从多条资料中筛选所需号码/微信/邮箱，复制完整多行内容；另一页面已修改时，当前草稿不会覆盖新资料。
- **source_ids / current_evidence：** #51/#54、用户继续开发指令、D-0039；详情筛选、完整复制和跨详情实例在途互斥已实现，真实隔离Chrome联合验收通过，见本轮报告。
- **depends_on / blocks / parallel_group / preconditions：** AG-ISSUE-051-054-FIELDS 的已完成实现、DATA-CONTRACT §6A 展示约定 / 详情使用闭环交付 / person-fields-use / 仅当前已确认快照，本地筛选不发请求。
- **allowed_files / forbidden_files：** person-fields域/测试、PersonFieldsEditor、shared/clipboard、对应UI与真实前端runner、样式及相关说明 / 既有AV/主值写入、版本、CHANGELOG、其他任务的未提交改动、真实用户库。
- **contract_change / host_or_spike_required：** 无存储/schema变化，§6A补充展示筛选和显式复制约定；真实隔离Chrome页面与同源双页面验证。
- **ordered_steps：** 冻结展示约定 → 纯筛选与剪贴板helper → 阅读态控件和反馈 → 失败/迟到/全量编辑UI回归 → 重建 → 真实筛选复制与双页面冲突/恢复、同名人物隔离。
- **test_fixtures / test_commands / acceptance：** 分组/名称/完整多行值、同名同值、空组/无命中、筛选后完整编辑保存、剪贴板拒绝/HTTP fallback、切人迟到结果、390px；域与clipboard测试、`pnpm check/test`、三套UI、构建、真实前端runner；筛选不写资料，复制完整原值，冲突零覆盖。
- **failure_retry_rollback / privacy_boundary / performance_budget：** 复制失败明确提示手动选择，不改保存状态；迟到反馈丢弃；只读筛选清空即复原。查询和值不新增日志或持久索引，剪贴板只在点击时写入；每人最多100项，本地线性筛选。
- **evidence_paths / owner / last_updated / commit：** [本轮报告](verification/PERSON-FIELDS-USE-2026-10-17.md)、[真实双页面联合](verification/PERSON-FIELDS-MULTIWINDOW-2026-10-17.md)、`tests/person-fields.test.ts`、`tests/clipboard.test.ts`、`scripts/e2e/ui/person-fields-regression.js` / Codex / 2026-10-17 / `0674d9e`。
- **退出边界：** 详情内筛选不等于联系人全局搜索。双页面按先后顺序验证旧基线冲突，不宣称原生编辑器或内核CAS；真机与日常用户库仍单列。
- **完成回报：** 本卡的隔离 Chrome 范围已并入 v0.5.17 联合验收；最终 `pnpm test` 710/710、三套 UI 各416/416、E2E/Kernel smoke 17/17，详情筛选、完整复制、冲突零覆盖和同名人物隔离均已复核。共享复制锁覆盖真实 Workbench 卸载/重挂载；Windows 剪贴板换行规范化单列，不 trim 内容。#51/#54 已发布并关闭，本卡不因此重新标为开发中。

#### AG-ISSUE-051-054-CLOSE — 原始需求复核、备注重读恢复与资料生命周期验收

- **status / priority / type / milestone：** `done` / P1 / fix+acceptance / M4；原始需求、隔离真实宿主验收、v0.5.17 发布和 GitHub issue 回复/关闭均已收口。
- **user_outcome / user_scenario：** 备注保存冲突后可在原地核对最新内容并保留或放弃草稿；受旧Markdown多段写入影响的用户可保留全部原文、核对后解除旧关联并重新输入全文保存；补充资料已保存后可改组、解除组、排序、删除、清空与重新新增，重开保持实际保存结果。
- **source_ids / current_evidence：** #51/#54最新正文及无评论状态、用户要求核实是否完全解决；最终联合轮 `9e8b5db6-5834-42c7-a5ec-fee5b471bd10` 已覆盖备注重读/冲突/清空、旧版拆块安全恢复和补充资料完整生命周期。
- **depends_on / blocks / parallel_group / preconditions：** D-0039、DATA-CONTRACT §6A/6B、AG-ISSUE-051-054-USE已完成范围 / 原始issue开发验收结论 / issue-51-54-close / 新UUID隔离工作区、随机回环端口、独立Chrome profile、虚构资料。
- **allowed_files / forbidden_files：** PersonDetail及facade接线、person-note域/API/service及测试、profile-card回归、person-fields真实frontend runner、隔离旧备注属性spike、相关契约与验收文档 / 版本、CHANGELOG、真实用户库、其他任务既有改动。
- **contract_change / host_or_spike_required：** §6B明确个人备注重读的草稿选择与迟到保护、旧版分段备注显式解除关联，原生块新增detached归档属性但不新增JSON/schema；属性空值移除语义须先隔离内核实证；最终构建的真实隔离Chrome生命周期与旧版恢复增量。
- **ordered_steps：** 按issue逐项核对 → 备注错误恢复就地实现/回归 → 已存资料生命周期真实runner → check/test/三套UI/build → 最终隔离真实联合 → 原始需求验收矩阵与交付边界收口。
- **test_fixtures / test_commands / acceptance：** 备注冲突/取消/保留/放弃/读取失败/切人迟到及其他区域草稿；旧多段读取失败→核对→显式解除旧关联→原文全保留→人工全文保存重开；多label重复、改组、解除组、排序、两种删组、清空后重开与再新增；保存逐次核对完整snapshot和原块。check/test/UI、真实runner；不为验证擅自发布。
- **failure_retry_rollback / privacy_boundary / performance_budget：** 失败与取消不丢草稿，重读不自动写；真实请求逐次核验本轮Kernel归属，场景有界，进程/端口/profile清理；只使用虚构数据。
- **evidence_paths / owner / last_updated / commit：** [原始需求验收](verification/ISSUE-051-054-ACCEPTANCE-2026-10-17.md)、[完整生命周期](verification/PERSON-FIELDS-LIFECYCLE-2026-10-17.md)、`docs/verification/PERSON-FIELDS-REAL-UI-9e8b5db6-5834-42c7-a5ec-fee5b471bd10.json` / Codex / 2026-10-17 / `0674d9e`（文档同步 `ee4e515`）。
- **退出边界：** 原始需求已实现且其要求的隔离真实宿主证据齐全即可开发完成；正式发布单列。全局检索、AV投影、vCard往返、原生编辑器CAS、真机和日常用户库不扩张为#51/#54原始需求的隐含前置。
- **完成回报：** `pnpm test` 710/710、`pnpm check` 0/0、桌面/390px/宿主样式 UI 各416/416、E2E安全与内核 smoke 17/17；最终真实 Chrome 联合轮 248 次验证侧请求及归属核验全部通过。v0.5.17 Release 附件 601,897 B / SHA256 `472918deacd8aa985e4a8effb9af3796382aa4336cd546bb59db1e4c7317f11d` 已下载复核，#51/#54 已回复并关闭。旧版多段备注仅支持用户确认后的安全解除关联和手动全文重存，不自动拼接；全局检索、AV投影、vCard往返、原生编辑器CAS、真机和日常用户库另行处理。

#### AG-HOST-002-RAF — 组织管理后台页帧等待有界化

- **status / priority / type / milestone：** `done_isolated` / P1 / UI+regression / M3；已补隔离真实内核 Chrome 双页面证据，父卡 `AG-HOST-002` 仍为 `host_pending`。
- **user_outcome / user_scenario：** 打开第二个浏览器页面后，后台组织管理仍能完成成员写入和刷新，回到原页可继续编辑、归档和关闭。
- **source_ids / current_evidence：** `AG-HOST-002`；2026-10-17 Chrome 同源双页面真实复现：`restoreViewport` 无界等待后台暂停的 RAF，导致 `formBusy` 一直不解除。
- **depends_on / blocks / parallel_group / preconditions：** 现有组织契约和请求代次守卫 / 组织成员与归档双页面验收 / organization-background-raf / 仅操作受控 UI 夹具和独立宿主工作区。
- **allowed_files / forbidden_files：** `src/components/org/OrgManagerDialog.svelte`、`scripts/e2e/ui/organization-context-regression.js`、本卡及专门证据 / `frontend-flow`、其他 Agent 文件、版本、CHANGELOG、README 徽章、PROGRESS。
- **contract_change / host_or_spike_required：** 无数据/存储契约变更；暂停 RAF 的真实 DOM 回归，完成后交宿主 Agent 重建并复跑双页面。
- **ordered_steps：** 固定无帧回调回归 → 给视口恢复加有界退出与清理 → 核对草稿/滚动/焦点与迟到回调 → 定向 UI 和 check → 宿主复跑。
- **test_fixtures / test_commands / acceptance：** 暂停 RAF、成员保存、外部刷新、草稿、滚动焦点；定向组织上下文 UI、`pnpm check`；无帧回调也解除 busy，操作只写一次，滚动与草稿保留，清理后的回调不再干预当前界面。
- **failure_retry_rollback / privacy_boundary / performance_budget：** 保留现有错误与只读重试，不自动重写；仅虚构组织和成员；每次视口恢复至多一次 RAF 加有界计时器，无轮询。
- **evidence_paths / owner / last_updated / commit：** [ORG-BACKGROUND-RAF-2026-10-17](verification/ORG-BACKGROUND-RAF-2026-10-17.md)、`scripts/e2e/ui/organization-context-regression.js` / `org_background_raf_fix` / 2026-10-17 / `0674d9e`。
- **完成回报：** 后台直接跳过第二帧、可见页 100 ms 回退，visibilitychange/卸载清理等待。`pnpm check` 0 errors / 0 warnings；桌面和 390px 定向组织 UI 各 13/13，完整桌面 UI 389/389。覆盖暂停 RAF、等待中转后台、忙态解除、草稿/滚动/焦点与迟到回调。重建后隔离真实内核 Chrome 双页面的改名、成员编辑、归档和恢复均通过，写入前第一页为 hidden 且无残留 busy；见 [HOST-ORG-DUAL-WINDOW-2026-10-17](verification/HOST-ORG-DUAL-WINDOW-2026-10-17.json)。主 Host Queue 仍保留人物文档投影专门双页、原生多窗口、日常工作区和真机等边界。

#### AG-RF-004-N1 — 原生人物文档全量联系方式可读性实验

- **status / priority / type / milestone：** `host_pending` / P2 / contract+research+spike / M4；纯格式、隔离真实内核与部分编辑器旅程已有证据，严格候选 UI 读取、复制与并发仍待验，父卡保持 `candidate`。
- **user_outcome / user_scenario：** 用户停用插件或只删除插件数据后，仍能在人物原生文档中阅读全部联系方式和值的含义，不仅剩 AV 主值。
- **source_ids / current_evidence：** Issue #51/#54；`MULTI-CONTACT-OWNERSHIP-2026-10-17.md`、`MULTI-CONTACT-NATIVE-2026-10-17.md`、`MULTI-CONTACT-NATIVE-HOST-2026-10-17.md`、`MULTI-CONTACT-NATIVE-UI-2026-10-17.md`、`MULTI-CONTACT-NATIVE-MULTIWINDOW-2026-10-17.md/json`、研究与宿主 spike results；纯内存候选矩阵 31/31，隔离真实内核两人物六方法写读/重启/实验缓存清理回读通过，编辑器正文读取/改值/删除/重载回读及同人物双页面实时刷新已有观察；UI 使用 `ui-*` 身份夹具，没有证明 N1 严格解析通过。复制载荷、并发与真实用户工作区仍待验证。
- **depends_on / blocks / parallel_group / preconditions：** 现有 block DOM/属性/SQL/AV 契约与原生备注实证，不依赖采纳生产方法库 / D1 事实源选择 / contact-native-research / 先冻结研究格式和拒绝规则，再用 UUID 隔离工作区与随机端口验证；不读日常库。
- **allowed_files / forbidden_files：** 新增 `scripts/spike/contact-methods-native-research.mjs`、`scripts/spike/contact-methods-native-host-spike.mjs`、两者 results 和研究证据文档、本卡 / 生产 DATA-CONTRACT、API、types、services、组件、真实用户插件存储、版本、CHANGELOG、README 徽章及 PROGRESS。
- **contract_change / host_or_spike_required：** 无生产契约变更；现有端点可只在独立 spike 复用。先用纯函数比较有界可读格式，明确值、ID、类型、主值、标签和顺序的解析边界，再验证原生块形状，不从 UI 直接接入。
- **ordered_steps：** 候选格式与拒绝表、纯编码/解析反例、UUID 临时工作区真实原生写读/重启/实验缓存清理回读、内核 API 改值/删块已完成 → 编辑器正文读取/改值/删除/重载及双页面刷新已观察 → N2 正文格式与聚合完整性研究 → 有效候选身份夹具的 UI 严格读取、复制/粘贴身份核验与同时写/删块竞争 → 记录 D1 取舍和未验边界。
- **test_fixtures / test_commands / acceptance：** 普通与特殊字符、旧 ` / ` 原文、同值跨人、同序稳定 ID、固定来源键、重复标记/块、原生改值/删块、未知格式、坏文档/块形状、控制字符、删除实验插件缓存；`node --check scripts/spike/contact-methods-native-research.mjs`、`node scripts/spike/contact-methods-native-research.mjs` 输出 31/31；`node --check scripts/spike/contact-methods-native-host-spike.mjs`、`node scripts/spike/contact-methods-native-host-spike.mjs` 输出 `hostVerified=true`。隔离真实内核已回读六条完整值、`ial`、`content`、`markdown`、`parent_id`，并通过内核 API 改值/删块；Chrome 编辑器正文操作及同人物双页面刷新已观察，多行被折叠为单行，最终邮箱恢复值 SQL 回读通过；复制载荷、严格候选读取与并发仍待补。
- **failure_retry_rollback / privacy_boundary / performance_budget：** 每条写读独立报告，未知不自动重发；仅删除本脚本创建且已验证归属的临时资源；全虚构、无联网外发、无真实联系方式。仅小样本能力验证，不承诺大库搜索/扫描成本。
- **evidence_paths / owner / last_updated / commit：** `docs/verification/MULTI-CONTACT-OWNERSHIP-2026-10-17.md`、`docs/verification/MULTI-CONTACT-NATIVE-2026-10-17.md`、`docs/verification/MULTI-CONTACT-NATIVE-HOST-2026-10-17.md`、`docs/verification/MULTI-CONTACT-NATIVE-UI-2026-10-17.md`、`docs/verification/MULTI-CONTACT-NATIVE-MULTIWINDOW-2026-10-17.md/json`、`scripts/spike/contact-methods-native-research.mjs`、`scripts/spike/contact-methods-native-research-results.json`、`scripts/spike/contact-methods-native-host-spike.mjs`、`scripts/spike/contact-methods-native-host-results.json` / Codex + contact_native_review / 2026-10-17 / 未提交。
- **明确退出边界：** 已证明内存格式边界、隔离真实内核原生块写读/重启/实验缓存清理回读；编辑器正文手工改值/删块及同人物双页面刷新已有观察。UI 夹具身份不同且正文折行，不能升级为严格候选全量读取成功；两窗口原生竞争、复制身份、真实用户插件数据删除、全量搜索和备份协议仍未证明。同人复制旧 ID 应报告 duplicate，跨人旧 owner/ID 应报告 conflict/unknown，读取与刷新不得自动重写身份；仅显式采纳新方法才讨论分配新身份。任何不完整读取不得回填或覆盖集合，转 N2 研究；S2 假 Plugin/假 AV 不替代宿主证据。

#### AG-RF-004-N2 — 编辑器稳定正文与复制身份边界

- **status / priority / type / milestone：** `done_isolated` / P2 / research+spike / M4；纯研究阶段已收口，后续 UUID 宿主阶段单列证据，整张研究方向仍不能因隔离通过变为生产 ready，父卡保持 `candidate`。
- **user_outcome / user_scenario：** 停用插件后仍可读完整联系方式；原生编辑、复制与重载后，能够区分有效方法、重复、冲突和不完整读取，避免把解析失败误当删除。
- **source_ids / current_evidence：** Issue #51/#54、N1 31/31 与隔离宿主证据；真实编辑器会折叠多行正文，严格四行头在有效研究身份夹具中返回 `body-header`。UI 夹具使用独立 `ui-*` ID，只证明编辑器行为，没有通过 N1 严格身份解析。
- **depends_on / blocks / parallel_group / preconditions：** N1 的纯格式及编辑器观察，不依赖采纳 D1 / D1/D4 与生产原生方法读写 / contact-native-editor / 先比较格式和拒绝语义，真实 UI 结果必须单列；只使用虚构数据。
- **allowed_files / forbidden_files：** 本轮新增 `scripts/spike/contact-methods-native-editor-research.mjs`、其 results、`docs/verification/MULTI-CONTACT-NATIVE-EDITOR-2026-10-17.md` 及本卡；后续宿主阶段仅允许新增 `scripts/spike/contact-methods-native-editor-host-spike.mjs`、其 results 与独立宿主报告 / N1 原脚本与所有生产模型、DATA-CONTRACT、API、AV、存储、服务、组件、迁移、vCard、版本与发布文件。
- **contract_change / host_or_spike_required：** 无生产契约变更；比较单行可读编码、专门编辑器多行格式、保留多行但拒绝自由改写三种候选。纯函数与真实 UI 证据不能互相替代；宿主阶段只复用 N1 已实证端点，须操作前后严格读取有效候选身份夹具。
- **ordered_steps：** 固定候选与拒绝表 → 纯域编码/解析及不完整读取反例 → 同人/跨人复制与显式采纳身份实验 → 独立复核 → 有可用 Chrome 控制通道时补 UUID 隔离宿主 UI 回读 → 记录可采纳与待验边界。
- **test_fixtures / test_commands / acceptance：** 空/特殊/多行值、引号/反斜杠/Markdown、头部碰撞、未知格式、重复 ID、跨人 owner/source/ID 冲突、取消与未核实采纳；`node --check scripts/spike/contact-methods-native-editor-research.mjs`、`node scripts/spike/contact-methods-native-editor-research.mjs`。值无静默丢失；任何未知/重复/冲突使聚合读取 `complete=false`、`writeAllowed=false`；解析/刷新零身份分配，只有显式确认采纳且身份目标已核实才生成新身份，未知/取消零自动修复。
- **failure_retry_rollback / privacy_boundary / performance_budget：** 失败返回非零；本轮纯研究不写真实插件存储或内核、不重试未知写；后续宿主阶段只写 UUID 隔离工作区且核实归属后清理；仅虚构数据，无联网外发；有界矩阵，不承诺大库或真实编辑器稳定性。
- **evidence_paths / owner / last_updated / commit：** `scripts/spike/contact-methods-native-editor-research.mjs`、其 results、`docs/verification/MULTI-CONTACT-NATIVE-EDITOR-2026-10-17.md` / Codex + native_editor_research / 2026-10-17 / 未提交；纯研究矩阵 123/123；宿主内核阶段已独立开展，结果与剩余 UI 边界见下一张 N2-HOST，本纯研究卡不承担宿主验收。

#### AG-RF-004-N2-HOST — 有效候选身份的隔离宿主写读

- **status / priority / type / milestone：** `host_pending` / P2 / host+spike / M4；隔离真实内核传输、严格读取与重启回读已完成；Chrome 编辑器操作、真正复制/粘贴和并发仍待验。
- **user_outcome / user_scenario：** 原生文档中的完整联系方式经过保存、重启后仍能精确回读；编码或宿主转换不兼容时可见拒绝，不把可读文本误报为可解析全量。
- **source_ids / current_evidence：** Issue #51/#54、N2 123/123；N1 UI 夹具为 `ui-*`，未通过严格身份解析，且编辑器会折叠多行。本卡使用有效 `method-{hash}` 的单行 JSON 候选：四组值 × Markdown/DOM 两路径，DOM 4/4、Markdown 2/4 通过原样严格解析及重启回读；Markdown 转义/富文本两组被宿主改写并拒绝。当前 CUA 仅 IAB/MCP Apps，无 Chrome 控制面，`uiVerified=false`。
- **depends_on / blocks / parallel_group / preconditions：** N2 纯研究 `done_isolated`、现有 insertBlock/SQL/getChildBlocks 与 DOM 文本端点实证 / N1/N2 完整宿主验收、D1/D4 / contact-native-editor-host / UUID 临时工作区、随机回环端口、已验证内核路径，所有数据虚构；不得连接日常库或通过外部 CDP 操作 UI。
- **allowed_files / forbidden_files：** 新增 `scripts/spike/contact-methods-native-editor-host-spike.mjs`、其 results、`docs/verification/MULTI-CONTACT-NATIVE-EDITOR-HOST-2026-10-17.md` 及本卡；只读复用 N2 纯函数与 kernel-safety / N1/N2 原脚本及全部生产模型、DATA-CONTRACT、API、AV、存储、服务、组件、迁移、vCard、版本和发布文件。
- **contract_change / host_or_spike_required：** 无生产契约变更；本卡是候选写入传输与严格回读实证，不直接把宿主 Markdown 映射成纯文本或修改候选解析器以掩盖差异。
- **ordered_steps：** 核对安全边界 → 审阅可复跑脚本和 dry-run → UUID 隔离内核写入有效 `method-{hash}` 夹具 → SQL/content/markdown/ial/parent 回读并运行严格读取器 → 重启回读 → 停止临时进程并记录已验与待验项；Chrome 可用后另补改值、真正 Copy/Paste 和竞争。
- **test_fixtures / test_commands / acceptance：** 普通值、真实换行、字面反斜杠、引号、HTML/Markdown、首尾空白、同值跨人；`node --check scripts/spike/contact-methods-native-editor-host-spike.mjs`、默认 dry-run、`LVCT_RUN_NATIVE_EDITOR_HOST=1` 的隔离内核运行。所有宿主原始字段保留，任何不匹配显式报告；`uiVerified=false` 直到真实 UI 证据齐全，不因 Kernel API 通过将整卡标 done。
- **failure_retry_rollback / privacy_boundary / performance_budget：** 未知写不自动重发；仅结束本轮持有的临时进程，核实退出；保留虚构工作区和证据，不递归删除未知目录；不安装插件或访问真实联系方式，无联网外发；小样本能力探针，不承诺大库搜索或并发隔离。
- **evidence_paths / owner / last_updated / commit：** `scripts/spike/contact-methods-native-editor-host-spike.mjs`、`scripts/spike/contact-methods-native-editor-host-results.json`、`docs/verification/MULTI-CONTACT-NATIVE-EDITOR-HOST-2026-10-17.md` / Codex + native_editor_host_spike / 2026-10-17 / 未提交；Kernel `3.8.8-alpha.2`、73 次请求及对应 PID 归属核实，八组块原始字段在重启后保持；两次本轮内核进程均已退出、端口释放。语法与 dry-run 通过；候选未采纳，未修改生产或发布文件。

#### AG-RF-004-N2-HOST-UI-COPY — 有效候选的原生编辑器与完整块复制边界

- **status / priority / type / milestone：** `host_pending` / P2 / host+research / M4；续接 N2-HOST 的真实 UI 子阶段。本轮仅登记可执行范围，尚未执行有效候选的真实编辑器和 Copy/Paste，不因 API、静态 bundle 或纯函数结果升级。
- **user_outcome / user_scenario：** 用户在原生人物文档编辑或复制完整联系方式块后，能够看见实际保留的值和身份；重复、跨人旧归属与未知格式不能被静默认作新方法，避免刷新时覆盖或删除其他事实。
- **source_ids / current_evidence：** Issue #51/#54；N2 纯研究 123/123；N2-HOST DOM4/4、Markdown2/4 严格原值回读及重启已完成，`uiVerified=false`；`MULTI-CONTACT-NATIVE-COPY-2026-10-17.md` 只读定位了完整块 Copy 的内层菜单和原生载荷路径，未执行真实 Copy/Paste。N1 旧 UI 的 `ui-*` 身份与多行正文不能替代本卡有效 `method-{hash}` 夹具。
- **depends_on / blocks / parallel_group / preconditions：** N2-HOST 已实证 DOM 传输、原样 N2 读取器及已验证 SQL/直接子块端点 / N1/N2 完整宿主验收与 D1/D4 比较 / contact-native-editor-ui / 必须先确认有可操作的 Chrome 控制面；仅 IAB/MCP Apps 或 Chrome unavailable 时保持 `host_pending`，不得用外部 CDP、手工构造 ClipboardEvent、直接 DOM/Kernel 插块代替原生旅程。使用新 UUID 隔离工作区、随机回环端口、逐请求 ownPID 和全虚构数据，不连接日常库。
- **allowed_files / forbidden_files：** 后续仅新增独立 UI 旅程脚本、原始回读 results、截图与 `docs/verification/MULTI-CONTACT-NATIVE-EDITOR-UI-COPY-2026-10-17.md`，及本卡状态；只读复用既有 N2/parser、端点与隔离安全工具 / 不修改 N1/N2/A1/A2/S3 既有实验以掩盖差异，不改生产 DATA-CONTRACT、模型、API、AV、存储、服务、组件、迁移、vCard、版本或发布文件。
- **contract_change / host_or_spike_required：** 无生产契约变更；必须有实际可见的 Chrome 原生编辑器操作和持久化回读。先用有效 `method-{hash(owner:sourceKey)}`、合法 owner/source 和单行 DOM 候选建立严格接受基线；保留原始 `content` 与 `markdown`，不互相代填、重编码或放松读取器来追求通过。
- **ordered_steps：** 核对 Chrome/工作区/PID 归属 → 两虚构人物及有效候选基线 → 原生正文改值后严格回读 → 从目标普通块菜单展开父 Copy 并触发内层完整块 Copy → 同人普通 Paste → 跨人物普通 Paste → 重开文档/重载后的 SQL 与严格读取复核 → 独立审查与停止本轮进程。粘贴后先由 UI 确认新块出现，再回读新旧块及完整受控人物范围；不得只查询仍带 marker 的块。
- **test_fixtures / test_commands / acceptance：** 普通值、实际换行/反斜杠/引号、Markdown/HTML、同值跨人；基线、改正文、同人复制、跨人复制、属性丢失/改写和重载逐项保存 UI 事实以及原始 `id/root_id/parent_id/type/content/markdown/ial`、直接子块与原样 N2 报告。同人若保留方法 ID 且正文有效，必须可见 `duplicate/method-id`；跨人若保留旧 owner/ID 且正文有效，必须可见 `conflict/owner-or-parent`；正文折行、属性改写/丢失或值不一致按实际输入进入 `unknown`，不能按姓名/值重连或自动改 owner/source/ID。任何未知、重复、冲突或不完整范围均 `complete=false`、`writeAllowed=false`、`methods=[]`；只有明确受控枚举范围可作本次判定，不能推广为历史全集。刷新后事实与拒绝报告保持一致，零自动身份分配/修复/墓碑/投影写入。
- **failure_retry_rollback / privacy_boundary / performance_budget：** UI 或写入结果未知先只读核实，不自动重发粘贴；仅保存虚构夹具与本轮页面证据，不读系统无关剪贴板。原生 clipboard 载荷若可被动观察，只作补充且不改变默认事件，不能替代持久回读；不能观察时如实单列。只关闭本轮创建页面并停止持有进程，核实端口释放，保留虚构工作区；小样本研究不承诺大库或并发隔离。
- **evidence_paths / owner / last_updated / commit：** `docs/verification/MULTI-CONTACT-NATIVE-EDITOR-UI-COPY-2026-10-17.md`（准备协议）、`docs/verification/MULTI-CONTACT-NATIVE-EDITOR-HOST-2026-10-17.md`、`docs/verification/MULTI-CONTACT-NATIVE-COPY-2026-10-17.md` 与 N2-HOST 既有 results；本卡真实 UI 证据尚无 / Codex + next_research_scope / 2026-10-17 / 未提交。
- **明确退出边界：** 实际原生操作可因候选被宿主改写而得到可见拒绝，不能把“值可见”宣称为严格候选可读。无真实 UI、未出现新持久块或只完成菜单可达均不得标完成；两页面同时写/删块竞争、桌面原生多窗口、人物生命周期、卸载/全配置删除、完整搜索和数据出口另列后续验收。即使本卡收口，D1 仍须综合比较；完整联系方式研究父卡继续开放，不影响 #51/#54 已交付的补充资料范围。

#### AG-RF-004-N3 — 原生候选范围发现与丢标记反例

- **status / priority / type / milestone：** `done_isolated` / P2 / research+host-spike / M4；候选发现与丢标记反例已隔离实证，不采纳生产范围/删除/恢复协议。
- **user_outcome / user_scenario：** 联系方式源块丢属性、正文变成普通文本或被删除时，刷新不能把漏读当完整空集合并清空其他位置的数据。
- **source_ids / current_evidence：** Issue #51/#54；N2 的 readDocument 只读已选方法块，scopeDiscoveryVerified=false；N2-HOST DOM4/4，S3-A0 已证明写后值相等不保证无覆盖；Chrome 当前仍不可用。
- **depends_on / blocks / parallel_group / preconditions：** N2 纯函数、现有 SQL/getChildBlocks/insertBlock/updateBlock/setBlockAttrs/deleteBlock 端点实证 / 原生文档方案 D1/D4 与全量发现/删除规则 / contact-native-scope / 全部虚构、新 UUID 临时工作区、随机回环端口及逐请求 ownPID；不使用未实证 moveBlock。
- **allowed_files / forbidden_files：** 新增 `scripts/spike/contact-methods-native-scope-spike.mjs`、其 results、`docs/verification/MULTI-CONTACT-NATIVE-SCOPE-2026-10-17.md`，本卡及契约复评研究状态 / N1/N2/S3 原脚本、生产 DATA-CONTRACT、模型、API、AV、存储、服务、组件、迁移、vCard、版本和发布文件。
- **contract_change / host_or_spike_required：** 无生产契约变更；直接复用既有端点及原样 N2 parser；真实内核只能证明已返回行的观察，不能授予原生方法全集或用户删除意图。
- **ordered_steps：** 固定 marker-only/可疑特征/已知基线三种诊断比较 → 安全 dry-run → 两文档有效候选基线及普通正文 → 去主 marker、去全部方法属性、再改为普通正文 → 比较冷读与有已知块 ID 的回读 → 删除已知块/人为截断范围反例 → 原始 SQL/子块证据与独立复核 → 停止本轮内核。
- **test_fixtures / test_commands / acceptance：** 有效 hash 身份、两条方法、普通笔记、同前缀普通正文、缺主 marker/全方法属性/正文提示、已知块删除、读取预算截断；`node --check scripts/spike/contact-methods-native-scope-spike.mjs`、默认 dry-run、`LVCT_RUN_NATIVE_SCOPE=1`。marker-only 对照可暴露虚假的 complete，但不得用作可写结果；保守诊断对已知异常返回不完整/零可写方法，任何范围均不产生删除墓碑/业务修复/身份分配。
- **failure_retry_rollback / privacy_boundary / performance_budget：** 请求未知不自动重发，失败非零；只停止本轮持有子进程，保留虚构工作区，不递归删除；所有修改仅实验夹具，不读取日常库；固定小样本/有界 SQL，不承诺大库或强一致扫描。
- **evidence_paths / owner / last_updated / commit：** `scripts/spike/contact-methods-native-scope-spike.mjs`、`scripts/spike/contact-methods-native-scope-results.json`、[MULTI-CONTACT-NATIVE-SCOPE-2026-10-17](verification/MULTI-CONTACT-NATIVE-SCOPE-2026-10-17.md) / Codex + native_scope_spike + next_scope_review / 2026-10-17 / 未提交。
- **收口检查：** `pnpm check` 0 errors / 0 warnings，`pnpm test` 656/656，语法/dry-run 与 `git diff --check` 通过；独立只读复核 14 份原始快照及诊断重算一致，另有 8 个坏形状反例通过。
- **完成回报：** 纯检查 22/22；Kernel `3.8.8-alpha.2`、59 HTTP 及 59 次 ownPID 核实，7 阶段/14 组原始 SQL 与直接子块回读。实际去主 marker 后 marker-only 漏掉电话却仍 complete；全部属性与正文提示消失后，特征冷读也漏掉电话却仍 complete，实验已知 ID 才能揭示 unknown。已知块删除保持当前行观察完整，但只报 `unknown-not-delete`，零墓碑/业务修复/AV 写/身份分配。预算 1+额外 1 行真实截断、重启只读比对通过，两次本轮进程已退出、端口释放。完整性仅限本卡直接段落与有界顺序观察，不含一般嵌套父链闭包或原子性；历史验证及外层写权限始终 false。后续A1/A2已补独立方法AV行读取与研究锚点冷发现证据，仍未作D1选择；N2真正编辑器/复制/并发仍待验，无生产变更或发布。

#### AG-RF-004-A1 — 原生方法 AV detached 行与完整读取能力

- **status / priority / type / milestone：** `done_isolated` / P2 / research+host-spike / M4；仅完成受控候选行能力，不采纳 D1 或生产 schema。
- **user_outcome / user_scenario：** 同一人物多电话等完整值留在原生数据中，删除插件实验缓存后仍可回读；缺身份、归属冲突或不完整分页不得被当空集合清空其他数据。
- **source_ids / current_evidence：** Issue #51/#54；N3 已证 marker/特征查询漏读；M0 appendDetached 只有 code0、无严格回读。B13 detached 分类假定没有 block 型主键，与 orgRows=2 摘要存在疑点，不能当作路径已可用或不可用的最终证据；跨库 relation 已有负证据，不使用。
- **depends_on / blocks / parallel_group / preconditions：** 既有 DOM 建库/建列、appendAttributeViewDetachedBlocksWithValues、renderAttributeView page/pageSize、setAttributeViewBlockAttr、removeAttributeViewBlocks 和文档 SQL 端点 / D1 候选比较 / contact-methods-av-rows / 全虚构、新 UUID 临时目录、随机回环端口及逐请求 ownPID，先冻结规范。detached 实际渲染和删除语义本身待验，失败保留负证据，不暗换绑定行方案。
- **allowed_files / forbidden_files：** 新增 `scripts/spike/contact-methods-av-rows-spike.mjs`、其 results、`docs/verification/MULTI-CONTACT-AV-ROWS-2026-10-17.md`，本卡及契约复评研究状态 / 既有 spike、生产 DATA-CONTRACT、模型、API、AV、存储、服务、组件、迁移、vCard、版本与发布文件。
- **contract_change / host_or_spike_required：** 无生产契约变化；研究列全部 text（methodId/ownerDocId/sourceKey/type/label/value/primary/order），宿主自建 block 主键保持原样；ownerDocId 只是待核实引用，不冒充外键/relation/反链。itemID、方法 ID、人物 docId 分开记录。
- **ordered_steps：** 冻结范围和严格读取规则 → 语法/纯反例/dry-run 安全审查 → 两虚构人物、十方法单批 append 原始响应及独立分页回读 → 实验 API 改值/标签/顺序保持身份 → 清空 ID、重复 ID、改归属反例及显式恢复夹具 → 移除已知行/缺失未知 → 删除本轮已核实实验缓存、重启只读核实 → 独立复核及结束本轮进程。
- **test_fixtures / test_commands / acceptance：** 每人两电话、一邮箱、一微信、一网址，同值跨人、特殊字符/真实换行、pageSize2 真正跨多非空页、额外空页、缺/坏 cell、重复/漏页、rowCount 变化、页预算耗尽、非法 owner、空/重复 methodId、删行及重启；`node --check scripts/spike/contact-methods-av-rows-spike.mjs`、默认/显式 dry-run、`LVCT_RUN_AV_ROWS=1`。可用能力必须按原始回读证明，不依赖主键分类猜测；全新无过滤默认视图的当前观察与历史全集、语义集合完整性分开，外层 writeAllowed=false，零自动重发/身份修复/墓碑/主库投影。
- **failure_retry_rollback / privacy_boundary / performance_budget：** 写未知不重发；每页正数2、固定小样本/最多8页及额外空页，不使用 pageSize:-1 充当全量；只删除本轮创建且内容/路径核实的单个实验缓存文件，不递归删除，不访问日常库或安装插件；只停止持有的本轮子进程。失败原始证据保留；检测守卫不是 OS 级隔离。
- **evidence_paths / owner / last_updated / commit：** 上述新脚本、results 与研究报告 / Codex + native_scope_spike + av_probe_review + next_scope_review / 2026-10-17 / 未提交。
- **2026-10-17 追加前置校准：** 两次 text-only 单批追加均 code0，但包括读前 flush 的第二轮仍回读空表；各自 UUID 原始失败证据保留。第二轮磁盘只读核实 8 个 text 列各保存10值、宿主 block 主键无值。匹配版本 tag `v3.8.8-alpha.2` 的 commit `2b31367098736be09e27edd3e8044518dd3919e8` 源码显示 append 仅保存传入值，渲染会排除缺 block 主键值的行。先冻结 `source-backed-primary` 变体：取新 AV schema 唯一真实 block 列 keyID，每行显式追加 `{keyID,block:{content:虚构显示标签}}` 加原8 text值；省略自造 itemID、block.id、人物绑定及时间戳，由内核分配。只在第三个新 UUID/new AV 验证，旧 AV 零重发；仍用原严格分页/故障/重启验收，不放松诊断。版本字符串匹配不是安装二进制源码溯源证明；若失败即保留现场，无绑定行替代。
- **2026-10-17 比较前置校准：** 第三轮10方法已分5页回读，8text/block值完全一致，但默认空Select渲染生成不同value.id，严格原始比较失败，现场保留。固定源码解释该缺值生成路径。先冻结 `empty-host-select-generated-id-v1`：仅schema非方法的默认空Select精确六字段shape且合法id/blockID=row.id时，比较归一该value.id，其他字段逐一相同；mSelect/未知字段/非法或缺失id不适用，text/block ID不忽略。先补反例和独立复核，再第四个新UUID同payload验全序列；没有重发任何旧AV，未放松方法身份/内容/行数/分页/冲突规则。
- **完成回报：** 纯检查58/58、独立补充检查85/85；Kernel `3.8.8-alpha.2`，第四轮UUID `60ac7452-0fb1-4fb7-91fe-5142dabc4c7b`，135 HTTP/135次ownPID、26夹具修改、11完整快照。两人十方法真实5页回读；API改值/标签/顺序保持身份，空ID、同人有效hash/source重复及可达人物归属变化均拒绝整个语义集合，显式恢复夹具后可读。移除非主值行后9个存活itemID不变，缺失仅unknown-not-delete；精确实验缓存删除与内核重启后9方法保持。逐快照保存默认空Select未持久化证据、全部raw与仅value.id归一路径；前三轮失败文件不覆盖。两个本轮PID已退出/端口释放，原用户内核启动时间未变。`pnpm check` 0 errors / 0 warnings、`pnpm test` 656/656；既有74项文件状态校验一致。真实UI/原生编辑/跨窗口/历史全集/真实卸载后发现仍未验，外层writeAllowed=false；#51/#54开放。后续A2已完成研究锚点丢失的独立冷发现隔离轮，仍不证明真实卸载恢复；无生产变更、提交或发版。

#### AG-RF-004-A2 — 方法 AV 锚点丢失后的只读冷发现与歧义边界

- **2026-10-17 增量收口：** av_probe_review 补齐父broker的maxRequests硬预算、AV小页上界及500行对照仅首页，新增7项独立纯反例与合法读取序列兼容检查；主代理补实际初始provenance断言并新UUID重验通过，已同步results/报告。纯检查reader33/33、broker17/17，`pnpm check` 0 errors / 0 warnings、`pnpm test` 656/656；同AV多carrier的配对许可仅有纯broker证据，真实多carrier宿主回读仍未验。
- **status / priority / type / milestone：** `done_isolated` / P2 / research+host-spike / M4；A1全序列及独立复核已完成，A2冷发现已完成隔离真实内核轮，不是生产ready。
- **user_outcome / user_scenario：** 方法锚点配置丢失后能列出原生候选与歧义；找不到、不完整和未知不能触发清空、自动重绑或新建第二套库。
- **source_ids / current_evidence：** Issue #51/#54、D1数据主权门槛、N3冷读漏行反例、A1已知AV当前观察；A1缓存删除/重启仍持有AV/载体/列/人物ID，不能证明无配置发现。现有init候选扫描按联系人总表标题/主库字段评分，不是方法AV恢复证据。
- **depends_on / blocks / parallel_group / preconditions：** A1全序列、已实证笔记本/文档SQL/原生AV载体和schema读取 / D1锚点恢复与数据主权结论 / contact-methods-av-discovery / 新UUID、全虚构、随机回环端口、逐请求ownPID；先登记规则与拒绝表，不猜新端点。
- **allowed_files / forbidden_files：** 新增`scripts/spike/contact-methods-av-cold-spike.mjs`、独立`contact-methods-av-cold-reader.mjs`、`contact-methods-av-cold-results.json`、`docs/verification/MULTI-CONTACT-AV-DISCOVERY-2026-10-17.md`，本卡/父卡及契约复评研究状态 / 既有spike、生产DATA-CONTRACT、模型、API、存储、服务、组件、迁移、vCard、版本和发布文件。
- **contract_change / host_or_spike_required：** 无生产契约变化；字段匹配仅产生候选，不证明所有权；唯一候选也不自动选定/保存配置。不以标题、姓名、同值或已知ID绕过冷读。
- **ordered_steps：** 冻结有界读取/拒绝与冷进程协议 → 纯反例/dry-run → 新UUID原生夹具与完整研究锚点配置 → 停止创建进程 → 按manifest核实路径/摘要后逐个删除本轮研究配置文件 → 全新读取进程冷发现 → 独立oracle对照 → 停止本轮内核并复核证据。
- **cold_reader_boundary：** 冷进程只得到安全连接上下文，不得得到notebook/doc/AV/key/item/method ID、列映射或已知集合；oracle在独立复核侧，不经报告、模块导入、磁盘AV文件或环境变量回传读取器。恢复阶段只经已实证只读API观察。
- **test_fixtures / test_commands / acceptance：** 两人物十方法、任意标题直接AV载体、无关AV、第二同schema且同内容候选、同schema空AV、缺一方法列/坏页/预算截断；`node --check`两新脚本、默认/`--dry-run`、`LVCT_RUN_AV_COLD=1`。候选有原生证据，可与独立oracle对照；不同AV同schema/同内容/同方法ID不合并，空匹配AV也保留。同AV多载体保留全部来源并核对方法集合；同AV任一载体unknown/unrelated而另一载体matching时，整体unknown，不能静默排除。坏页/坏列/预算返回unknown/truncated；唯一候选仅unique_unowned，零候选仅not_found_in_observed_scope。零恢复事实写/配置保存/自动选择/新建/身份修复/墓碑。
- **failure_retry_rollback / privacy_boundary / performance_budget：** 未知不重发；只处理manifest中本轮精确且路径/内容核实的文件，不递归删除；失败原证据保留，只结束持有进程；全虚构、正数分页与硬预算，仅有界顺序观察，不承诺原子全库扫描。
- **evidence_paths / owner / last_updated / commit：** 上述A2独立script/results/report（修复后最终 runUUID `934f6213-fb65-4576-96e1-50bfb0173f1d`，151 HTTP、47 fixture mutations、reader33/33、broker17/17、ownKernelExited=true、portReleased=true、productionChanges=false），A1与D1研究报告 / Codex + native_scope_spike + next_scope_review + av_probe_review / 2026-10-17 / 已完成隔离、未提交。
- **运行前冻结：** SQL只扫当前索引可见`type='av'`载体，`SELECT id, root_id, parent_id, box, type, markdown FROM blocks WHERE type='av' [AND id > '<cursor>'] ORDER BY id LIMIT pageSize+1`，默认pageSize2/max8页；严格递增/唯一/字段/游标/lookahead，游标取最后处理行而非sentinel，耗尽后另验空页。该全库组合在本卡首次隔离实证。严格解析SQL markdown唯一NodeAttributeView/data-av-id，不加DOM/attrs路由，不按标题/marker/已知ID筛选；非直接载体、坏语法和部分方法schema均unknown。根文档/owner只用本次原生响应得到的ID作SQL核实，可达不等于联系人身份/所有权。
- **冷协议与比较边界：** 独立reader不import旧spike/fixture/oracle/FS/HTTP/child_process，启动仅协议版本与数值预算；env/argv无实验路径/IDs/token/canary，父broker的per-reader来源集合初始为空，只由该reader已收原始响应登记。IPC单pending/递增seq/精确SELECT模板及render参数白名单/硬字节请求数超时；父只加安全鉴权、逐请求ownPID，原样代发及返回，不注入/过滤/修正数据。render query空/createIfNotExist=false/pageSize2最多8页+额外空页+500对照，验证AV/view稳定、无实质filters/group/context/mirror；比较rowID及8方法text值，宿主其他cell形状校验/raw保留，但不承诺其跨请求原始身份相等，不移植A1磁盘证明归一。历史/所有权/写/重绑/新库/墓碑权限恒false。
- **冻结场景编排：** 单一新UUID先空索引冷读负例；独立producer1建两人物十方法及无关AV/研究配置后退出，逐文件核实manifest/摘要并删除，再freshreader唯一候选；freshreader预算1与一次broker读前拒绝分别truncated/unknown（拒绝是受控传输注入，不称内核故障）。producer2建同内容第二AV和空同schema AV后退出/删其配置，freshreader歧义；producer3建缺一方法列AV后退出/删其配置，freshreaderunknown。每次冷读是新进程，oracle仅在父审计侧、冷进程退出后对照；不存在删除原生事实来制造空库。
- **明确退出边界：** 最多形成“研究锚点配置全失”的done_isolated；真实卸载/全部插件配置删除、原生表可读性、原生编辑/复制和未完成请求恢复仍需独立宿主证据，不能因A2通过提前关闭#51/#54。A2后已补编辑器/复制准备、L1/L2人物生命周期身份研究；D6旧值迁移/备份/版本出口纯研究已收口为`done_isolated`，其正式契约、生产迁移/备份实现和宿主回读仍需独立门禁；正式/剩余D3/D4与D7数据出口继续按顺序评审。

#### AG-RF-004-L1 — 方法 AV 与人物解绑、主方法缺失的联合生命周期

- **status / priority / type / milestone：** `done_isolated` / P2 / research+host-spike / M4；34/34纯检查、76次隔离真实内核请求及独立raw复核通过，不替代N2-HOST-UI-COPY或采纳D1。
- **user_outcome / user_scenario：** 删除某条主联系方式或将人物移出名册后，完整方法和主表标量的实际保留情况可核对；同一人物重新绑定时，旧请求不能借新名册行继续写入。
- **source_ids / current_evidence：** Issue #51/#54、D3/D4；A1只验证非主方法行删除，S3-A0只验证标量目标解绑/重绑，S2是假存储模拟；L1 已补齐双 AV 联合生命周期的 76 次隔离真实内核观察，L2 又补齐同名替换、旧源不可达/位置变化和 owner/itemID 冲突的 16/16 纯身份矩阵，正式/剩余 D3/D4 仍未采纳。
- **depends_on / blocks / parallel_group / preconditions：** A1显式block主键的detached方法追加与完整读取、S3-A0绑定/解绑/映射/标量端点实证 / D3/D4生命周期比较 / contact-methods-lifecycle / 新UUID、随机回环端口、逐请求ownPID、全虚构数据；先冻结本卡规则再写脚本，不依赖D1选择。
- **allowed_files / forbidden_files：** 新增`scripts/spike/contact-methods-lifecycle-spike.mjs`、其results、`docs/verification/MULTI-CONTACT-LIFECYCLE-2026-10-17.md`，本卡与相关研究状态 / 既有spike、全部生产模型/DATA-CONTRACT/API/存储/服务/组件/迁移/vCard、版本与发布文件。
- **contract_change / host_or_spike_required：** 无生产契约变更；primary只是研究text字段，不是宿主内建主值语义。仅复用已实证创建文档/AV、追加方法、绑定/解绑、标量赋值、映射、SQL、flush、render、version/boot/exit端点；不试删除/移动人物文档的新端点。
- **ordered_steps：** 冻结研究输入与拒绝表 → 纯反例/dry-run与独立安全复核 → 两虚构人物各主/次电话及主表主值 → 删除甲已知主方法并回读双AV → 解绑甲主名册并核实doc可达/方法仍在 → 同doc重绑并记录itemID → 内核重启只读复核 → 独立核对原始证据与清理。
- **test_fixtures / test_commands / acceptance：** 两人物四方法、同值跨人、合法hash/source与显式0/1主值；`node --check`、默认/`--dry-run`零文件写/HTTP/端口/子进程、显式`LVCT_RUN_CONTACT_LIFECYCLE=1`。方法AV小页2/额外空页/500行对照、稳定schema/view、逐行身份与原文严格相等；主AV唯一绑定、官方映射与phone typed-content独立核实。删甲主方法后记录甲次方法primary与主表旧值的实际结果，乙不变；解绑后分列源集合读取、doc可达与名册资格；重绑沿用docId不假定itemID必换，方法ID/owner/source/值不变。旧冻结目标不自动续写；重启阶段零夹具写。缺失/未知范围不返回可写集合，不按姓名/值转移方法。
- **failure_retry_rollback / privacy_boundary / performance_budget：** 未知写零自动重发，失败保留完整证据；物理缺行只报unknown-not-delete，不推断用户删除意图、不晋升/清空/投影/墓碑/恢复。所有赋值和移除仅显式实验夹具操作，自动业务写恒0；只结束持有进程，核实端口释放，保留虚构工作区。小样本有界读取，不承诺CAS、历史全集或全库性能；token不进入证据。
- **evidence_paths / owner / last_updated / commit：** [联合生命周期证据](verification/MULTI-CONTACT-LIFECYCLE-2026-10-17.md)、`scripts/spike/contact-methods-lifecycle-spike.mjs`、`scripts/spike/contact-methods-lifecycle-results.json`及本轮UUID副本 / Codex + lifecycle_probe + lifecycle_contract_review / 2026-10-17 / 已完成隔离、未提交。
- **完成回报：** runUUID `329a34fa-cb9b-43eb-a6c4-c404ac906f52`，Kernel `3.8.8-alpha.2`；方法4→3、名册2→1→2的联合五阶段均独立回读。甲主方法移除后主表旧phone保留、次方法primary文本为0；解绑后甲文档与剩余方法仍可达但无名册资格；本轮同doc重绑实际换itemID且phone为空，方法身份/归属/原文不变。乙全程不变；重启按实际重绑事实只读比对通过。76 HTTP/ownPID76，fixture23且仅初始化scalar2，重启后修改0，projection/replay/墓碑0；两个持有PID退出、端口释放。三份raw逐字节相等、token未入证据；独立审计从原始载荷/响应重建事实通过。纯34/34包含完整源下换itemID及曾解绑后复用同itemID拒绝；旧目标拒绝只是研究诊断，未实现生产guard/CAS/持久恢复。默认/import/dry-run零副作用、语法与diff检查通过，未改生产实现或发布。
- **明确退出边界：** 最多done_isolated；D1Adopted、历史全集、外层writeAllowed/tombstoneAllowed、UI与并发验证始终false。重绑只覆盖同docId；同名新doc、人物删文档/移动、真实卸载、生产恢复与完整备份出口未验。完整联系方式研究父卡保持开放；#51/#54 的补充资料首版已交付并单独验收。

#### AG-RF-004-D3D4-P — 主值删除、零主值投影与解绑差异纯研究

 - **status / priority / type / milestone：** `done_isolated` / P2 / contract+research+spike / M4；21/21 纯检查通过，补齐 D3/D4 主值投影交叉边界，不开放生产写入。
 - **user_outcome / user_scenario：** 删除主联系方式、切换主联系方式或解绑人物时，用户能区分“方法被显式删除”“人物暂不投影”和“AV 已被外部改动”，避免自动晋升、误清空或旧值复活。
 - **source_ids / current_evidence：** Issue #51/#54、D3/D4；S2 已覆盖通用墓碑/陈旧确认，L1 已观察主方法缺失和解绑，L2 已覆盖人物身份门禁；本卡补纯状态机中零主值、显式删除/解绑差异、墓碑和陈旧 AV 投影冲突。
 - **depends_on / blocks / parallel_group / preconditions：** 仅依赖 S2/L1/L2 的脱敏规则和已有 AV 标量观察；不依赖 D1 选择，不调用 delete/move 或任何 Kernel/Plugin 端点；纯 Node、全虚构、零生产存储 IO。
 - **allowed_files / forbidden_files：** 新增 `scripts/spike/contact-methods-primary-projection-research.mjs`、其结果、`docs/verification/MULTI-CONTACT-PRIMARY-PROJECTION-2026-10-17.md`，并同步本卡/契约复评/下一计划 / 禁改生产模型、`DATA-CONTRACT.md`、API、存储、服务、组件、迁移、vCard、版本和发布文件。
 - **contract_change / host_or_spike_required：** 无生产契约变化；只冻结研究状态和拒绝语义。零主值的期望投影为空但必须新鲜基线与显式确认；陈旧 AV 一律冲突零写；解绑保留方法且不生成墓碑；同方法 ID 的墓碑禁止活跃复现。
 - **ordered_steps：** 冻结主值/删除/解绑/投影规则 → 纯反例与 dry-run → 主值切换及跨人物隔离 → 删除主值并核对零主值/墓碑 → 解绑并核对方法保留/投影阻断 → 注入 AV 外部改值、未知基线、重复主值/墓碑 → 独立复核和脱敏。
 - **test_fixtures / test_commands / acceptance：** 两人物、同类型主/次方法、主值删除、显式切换、零主值、解绑、同 ID 墓碑、AV 外部改值；`node --check scripts/spike/contact-methods-primary-projection-research.mjs`、默认、`--dry-run`、`--import`。21/21 通过；未知/冲突/解绑均 `writeAllowed=false`、`tombstoneAllowed=false`、`projectionWrites=0`。
 - **failure_retry_rollback / privacy_boundary / performance_budget：** 纯检查失败非零；不重试未知、不执行 AV/JSON 写；结果只含固定虚构 ID、状态和计数，不含真实联系方式；小样本不外推宿主性能或并发能力。
 - **evidence_paths / owner / last_updated / commit：** [主值投影研究](verification/MULTI-CONTACT-PRIMARY-PROJECTION-2026-10-17.md)、`scripts/spike/contact-methods-primary-projection-research.mjs`、`scripts/spike/contact-methods-primary-projection-results.json` / Codex + d3_d4_contract_spike / 2026-10-17 / 未提交。
 - **完成回报：** 21/21；删除主值不自动晋升，零主值只生成空投影计划；显式删除产生墓碑，解绑保留方法且无墓碑；AV 基线变化、未知基线和身份缺失均零写拒绝。默认、`--dry-run`、`--import` 与语法检查通过，`syntheticOnly=true`、`kernelRequests=0`、`productionChanges=false`、`candidateContractAccepted=false`、`D1Adopted=false`。
 - **明确退出边界：** 未证明真实 AV/原生文档编辑、删除/移动、持久墓碑、跨窗口 CAS、卸载恢复、用户确认 UI 或并发；正式 D3/D4 仍保持 candidate，#51/#54 开放。

#### AG-RF-004-S3-A0 — 既有 AV 标量与冲突能力探针

- **status / priority / type / milestone：** `done_isolated` / P2 / research+host-spike / M4；已核实既有端点能力与不安全交错反例，不提前开放依赖 D1/D4/D5 的完整 S3 或生产投影。
- **user_outcome / user_scenario：** 在选择多联系方式事实源前，明确 AV 主值保存、清空、未知响应和外部改动的真实边界，避免把“写后读到目标值”误当成没有覆盖他人的修改。
- **source_ids / current_evidence：** Issue #51/#54、S2 模拟恢复、N2 真实内核传输；现有 DATA-CONTRACT §1.3–1.5 与 M0 AV spike；Chrome 连接再次不可用，N2 真正编辑器改值/复制保持待验。
- **depends_on / blocks / parallel_group / preconditions：** 仅依赖已实证 AV 标量端点和隔离内核安全模式，不依赖采纳 D1 / 为 D4/D5 与完整 S3 提供能力证据 / contact-av-capability / 新 UUID 临时目录、随机回环端口、逐请求核实本轮持有子进程，全部虚构。
- **allowed_files / forbidden_files：** 新增 `scripts/spike/contact-methods-av-capability-spike.mjs`、其 results、`docs/verification/MULTI-CONTACT-AV-CAPABILITY-2026-10-17.md`，本卡与契约复评的研究状态 / 所有生产模型、DATA-CONTRACT、API、AV schema、插件存储、服务、组件、迁移、vCard、版本和发布文件；N1/N2 原脚本。
- **contract_change / host_or_spike_required：** 无生产契约变化；只用已有 createDoc/insertBlock、AV 建列/绑定/映射/渲染/标量写/解绑和内核启停端点。不会猜测 CAS 参数；实验请求断点仅存 UUID 工作区研究文件，不是方法事实库或生产恢复格式。
- **ordered_steps：** 固定能力断言与注入边界 → dry-run 安全复核 → 两虚构人及四标量写/清空回读 → 第三值重读零写保护与先检查后覆盖反例 → 本地丢响应后的只读核实/内核重启 → issued-before-send 断点的基线歧义 → 解绑/重绑核实旧目标拒绝 → 独立复核与停止本轮进程。
- **test_fixtures / test_commands / acceptance：** phone/email/url/text、baseline/desired/third/empty、受控两个 API writer 顺序交错、丢弃已收到响应、内核重启、已记 issued 未发送、解绑与重绑；`node --check scripts/spike/contact-methods-av-capability-spike.mjs`、默认 dry-run、`LVCT_RUN_AV_CAPABILITY=1` 显式运行。原始响应保留、未知不重发、目标改变零写，反例准确标记为受控交错，不宣称 UI 或真实双窗口并发。
- **failure_retry_rollback / privacy_boundary / performance_budget：** 任一失败非零退出、未知写不自动重试；只结束持有的本轮子进程，保留虚构工作区而不递归删除；不安装插件或读取日常库；有界小样本，不形成大库性能承诺。
- **evidence_paths / owner / last_updated / commit：** [MULTI-CONTACT-AV-CAPABILITY-2026-10-17](verification/MULTI-CONTACT-AV-CAPABILITY-2026-10-17.md)、`scripts/spike/contact-methods-av-capability-spike.mjs`、`scripts/spike/contact-methods-av-capability-results.json` / Codex + n2_ui_review + av_probe_review / 2026-10-17 / 未提交。
- **完成回报：** Kernel `3.8.8-alpha.2`；两人四标量共 32 次赋值/独立回读通过，fresh 第三值保护零计划写入；受控 API 写者交错复现 X 被旧目标 T 覆盖。丢弃已收到响应与 issued-before-send 的两份磁盘研究断点在内核重启后仅只读核实，分别读到目标/applied 与基线/unknown，恢复赋值/自动重发为 0。解绑空映射与独立缺行双证据阻止旧计划；本轮重绑 itemID 改变，未自动续写。成功轮 148 请求及 148 次 ownPID 检测、38 实际标量写、43 snapshot，两次本轮子进程已退出、端口释放；首次空字符串映射导致的探针失败及窄修正证据保留。语法/dry-run 与独立坏单元格/映射反例通过。`hostVerified/uiVerified/multiWindowVerified/D1Adopted=false`，完整 S3 和 #51/#54 仍未完成，无生产代码/版本/发布变更。

#### AG-RF-004-S2 — 严格快照与持久恢复候选实验

- **status / priority / type / milestone：** `done_isolated` / P2 / research+spike / M4；候选矩阵 60/60、独立反例 21/21，不采纳生产 schema，父卡保持 `candidate`。
- **user_outcome / user_scenario：** 在多联系方式保存、投影或备份恢复出现坏数据、响应丢失和并发时，能够辨别已保存、待核实和冲突，避免旧备份复活删除条目或未知请求被重复发送。
- **source_ids / current_evidence：** Issue #51/#54、AG-RF-004 D2/D3/D5/D6；S1 已完成有限 vCard 映射；现有方法快照只做内存浅层检查，未验证持久恢复。
- **depends_on / blocks / parallel_group / preconditions：** 只依赖现有 storage 纪律及本实验规范，不依赖采纳 D1 事实源 / 正式方法库和恢复契约 / contact-recovery-research / 假 Plugin 内存存储与虚构 AV 适配器，真实内核请求和真实插件文件写入均为 0。
- **allowed_files / forbidden_files：** 新增 `scripts/spike/contact-methods-recovery-research.mjs`、其 results、`docs/verification/MULTI-CONTACT-RECOVERY-2026-10-17.md` 及本卡；只读复用 `src/data/storage.ts` / 所有生产类型、存储、API、服务、组件、迁移包、DATA-CONTRACT、版本、CHANGELOG、README 徽章及 PROGRESS。
- **contract_change / host_or_spike_required：** 无生产契约变更；候选规则先记研究规范后写实验。零网络，假 Plugin 仅通过现有 storage 帮助函数读写内存；不把模拟锁当跨窗口实证。
- **ordered_steps：** 固定严格字段/身份/墓碑/主值/备份和投影状态规则 → 反例复核 → 实现有界候选 → 读写/响应丢失/重启/竞争故障注入 → 独立审查 → 明确可采纳证据与生产缺口。
- **test_fixtures / test_commands / acceptance：** 未知版本/字段、坏值、重复身份/主值、墓碑、同 ID 冲突、坏库/读取失败、保存已应用但丢响应、读取不收敛、并发、AV 目标变化和未知写后重启；`node scripts/spike/contact-methods-recovery-research.mjs`，定向 `node --test tests/storage.test.ts`。解析零业务写、事实未核实零 AV 写、issued/unknown 只读核实，旧请求不能换 ID 绕过；输出只含固定场景类别和数量。
- **failure_retry_rollback / privacy_boundary / performance_budget：** 实验失败返回非零，不改生产或真实用户文件；仅脚本内虚构值；未知写保留原请求并显式暴露首次写后缺断点、无 CAS 和迟到写边界；有界夹具，无新大库性能承诺。
- **evidence_paths / owner / last_updated / commit：** `docs/verification/MULTI-CONTACT-RECOVERY-2026-10-17.md`、`scripts/spike/contact-methods-recovery-research.mjs`、`scripts/spike/contact-methods-recovery-research-results.json` / Codex + contact_recovery_spike / 2026-10-17 / 未提交；语法检查通过，存储测试 15/15，零真实内核请求/插件文件写入。真实多窗口、CAS、迟到宿主写及首次断点缺失后的全局恢复仍不在证据内。

#### AG-RF-004-S1 — 纯 vCard 多值、参数与损失报告 spike

- **status / priority / type / milestone：** `done_isolated` / P2 / research+spike / M4；仅有限 UTF-8 方法/标签合成适配器收口，父卡 `AG-RF-004` 保持 `candidate`。
- **user_outcome / user_scenario：** 导入包含多个电话、邮箱和网站的通讯录前，能够判断哪些值/标签/参数可保留、哪些未映射，避免把首值或拼接值误当作完整资料。
- **source_ids / current_evidence：** Issue #51/#54；`AG-RF-004`；`docs/verification/MULTI-CONTACT-CONTRACT-REVIEW-2026-10-17.md`。既有搜索/身份研究 28/28、临时预算 7/7；S1 合成适配器 60/60，独立只读反例复核 5/5。候选未采纳，无生产接入或外部地址簿互操作实证。
- **depends_on / blocks / parallel_group / preconditions：** 依赖现有逻辑行展开与生产兼容基线，不依赖采纳方法库 schema；阻塞多值 vCard 正式契约 D7；`contact-vcard-research`；全部虚构夹具、零内核与插件存储 IO。
- **allowed_files / forbidden_files：** 新增 `scripts/spike/contact-methods-vcard-research.mjs`、`scripts/spike/contact-methods-vcard-research-results.json`、对应研究证据文档和本卡；可只读复用 `src/domain/vcard.ts` 已导出函数 / 禁改任何生产 parser/serializer、AV、types、data、services、迁移包、桥、组件与生产 DATA-CONTRACT，禁止版本、CHANGELOG、README 徽章和 PROGRESS。
- **contract_change / host_or_spike_required：** 无生产契约变更；仅 researchFormat 候选中间结构。必须有可复跑纯 Node spike；本卡无需宿主，结果不能替代真实 vCard 应用或跨窗口验收。
- **ordered_steps：** ①固定受支持普通 UTF-8 TEL/EMAIL/URL 的候选映射及语义比较规则；②覆盖多值、TYPE（含重复/逗号）、PREF、分组 X-ABLabel、转义/折行、未知属性/参数；③已支持项往返并比较值/来源/标签/参数；④未支持编码（含 QP）等列为 retained_unmapped，保存原逻辑行，不能猜值；⑤记录生产兼容基线与精确 loss report；⑥判定 D7 可采纳项与剩余缺口，父卡继续候选。
- **test_fixtures / test_commands / acceptance：** 两个 TEL/EMAIL/URL、同值跨卡、重复值、旧单值、TYPE=WORK,CELL、PREF、item1.X-ABLabel、含逗号/分号/反斜杠与 Unicode 折行、未知参数/属性、QP、空值及损坏输入；`node scripts/spike/contact-methods-vcard-research.mjs`、`node --test tests/vcard.test.ts`。输出包含 syntheticOnly/kernelRequests/productionChanges/candidateContractAccepted、逐夹具候选方法与 retained_unmapped/loss 报告、roundtrip 比较与生产基线；支持项语义不丢，未支持项逐项可见，不能按姓名或值静默合并。
- **failure_retry_rollback / privacy_boundary / performance_budget：** 纯转换零业务写；损坏/不支持输入拒绝映射或保留待核对，禁止容错后伪成功；脚本失败保留可读原因与非零退出；仅虚构联系值、不加载真实文件、无网络。使用有界夹具并记录输入字节/耗时，不新增大库性能承诺。
- **evidence_paths / owner / last_updated / commit：** `scripts/spike/contact-methods-vcard-research.mjs`、`scripts/spike/contact-methods-vcard-research-results.json`、`docs/verification/MULTI-CONTACT-VCARD-2026-10-17.md`、`docs/verification/MULTI-CONTACT-CONTRACT-REVIEW-2026-10-17.md` / Codex；独立复核 `multi_contact_contract_next` / 2026-10-17 / 未提交；脚本语法检查、生产 vCard 21/21 与 S1 60/60 通过，独立探针 5/5 通过。

#### AG-RF-004-S1-LIFE — vCard 方法生命周期与来源身份研究

- **status / priority / type / milestone：** `done_isolated` / P2 / contract+research+spike / M4；18/18 纯检查通过，补 D7 的纯生命周期缺口，不替代 N2-HOST-UI-COPY 或正式 vCard codec。
- **user_outcome / user_scenario：** 用户编辑、删除、增加或重新排序多联系方式后，导出再导入仍能区分原方法、已删除方法、新方法、重复值和未知属性，不按姓名或当前值静默合并。
- **source_ids / current_evidence：** Issue #51/#54、AG-RF-004-S1、D7；S1 已覆盖有限 UTF-8 候选映射与 loss report，但未覆盖方法增删改排、来源 lineage、重复值导出再导入及显式保留未知属性。
- **depends_on / blocks / parallel_group / preconditions：** 依赖 S1 的候选属性映射、现有生产 vCard 解析/序列化兼容基线和稳定人物身份研究；阻塞 D7 正式往返契约，不决定 D1 事实源；纯 Node、全虚构、零内核与插件存储 IO。
- **allowed_files / forbidden_files：** 新增 `scripts/spike/contact-methods-vcard-lifecycle-research.mjs`、其 results、`docs/verification/MULTI-CONTACT-VCARD-LIFECYCLE-2026-10-17.md`、本卡及相关研究状态 / 禁改生产 parser/serializer、types、storage、AV、services、UI、迁移包、DATA-CONTRACT、版本、CHANGELOG、README 徽章和 `docs/PROGRESS.md`。
- **contract_change / host_or_spike_required：** 无生产契约变化；仅冻结研究格式、来源摘要和损失报告字段。语义回环不等于原始 vCard 字节回环，也不证明外部地址簿兼容或 UI/宿主行为。
- **ordered_steps：** 固定两张虚构卡和 3 个 TEL/EMAIL/URL → 记录属性逻辑行与 source lineage → 执行编辑值/标签、删除一条、新增一条、重排、重复值与未知属性 → 默认导出和 `includeUnmapped` 导出 → 再导入并按卡片摘要、属性序号、来源摘要比较 → 对 unknown/duplicate/deleted/新增身份和 loss report 做独立纯断言 → 复核零生产 IO。
- **test_fixtures / test_commands / acceptance：** 多值 TEL/EMAIL/URL、TYPE/PREF/分组标签、同值跨卡、改值、删值、新值、重排、重复值、空值、未知参数/属性、未知 VALUE 和损坏逻辑行；`node --check scripts/spike/contact-methods-vcard-lifecycle-research.mjs`、默认运行、`--dry-run`。原方法编辑保留 lineage；删除进入显式 loss/deleted；新增身份不与旧 ID 冲突；重排/重复值逐条可见；未知项默认 `retained_unmapped`，显式导出仍保留原逻辑行；未知/非法项不自动合并；`candidateContractAccepted=false`。
- **failure_retry_rollback / privacy_boundary / performance_budget：** 纯转换失败非零且保留可审计结果；不自动修复未知/重复/删除，不发送真实数据；结果只含虚构值的摘要、哈希和类别，不输出完整联系方式；固定小样本和输入字节预算，不外推生产性能。
- **evidence_paths / owner / last_updated / commit：** [vCard 生命周期证据](verification/MULTI-CONTACT-VCARD-LIFECYCLE-2026-10-17.md)、`scripts/spike/contact-methods-vcard-lifecycle-research.mjs`、`scripts/spike/contact-methods-vcard-lifecycle-research-results.json` / Codex / 2026-10-17 / 已完成隔离、未提交。
- **完成回报：** 18/18 纯检查；编辑保留方法 ID/来源属性与序号，删除进入显式 loss，新方法生成新 ID，重排不改身份，同值跨卡和同卡重复值均不合并；默认导出/导入保留支持方法和来源卡片 lineage，`includeUnmapped` 保留未知原逻辑行。默认、`--dry-run` 与 import 均无内核/生产 IO；结果只含摘要/哈希/类别，`syntheticOnly=true`、`kernelRequests=0`、`productionChanges=false`、`candidateContractAccepted=false`。未证明字节回环、外部互操作、生产 schema、UI 或并发。

#### AG-RF-004-L2 — 人物生命周期身份门禁纯研究

- **status / priority / type / milestone：** `done_isolated` / P2 / contract+research+spike / M4；16/16 纯检查通过，补 D3/D4 的同名替换、旧源不可达与重绑身份门禁，不调用删除/移动 API。
- **user_outcome / user_scenario：** 同名新人物、旧文档不可达或位置变化时，方法不会按姓名/值自动转移；解绑后的旧目标不会借新名册行继续写入。
- **source_ids / current_evidence：** Issue #51/#54、D3/D4、AG-RF-004-L1；L1 已完成双 AV 联合生命周期的隔离内核观察，但未覆盖同名新 doc、旧源不可达/位置变化和方法 owner 冲突的纯身份矩阵。
- **depends_on / blocks / parallel_group / preconditions：** 仅依赖 L1 的冻结目标、方法/名册身份字段和当前未知拒绝语义；不依赖 D1 选择，不调用未经实证的 `deleteDoc`、`moveDoc` 或 `moveBlock`；纯 Node、全虚构、零 Kernel/插件存储 IO。
- **allowed_files / forbidden_files：** 新增 `scripts/spike/contact-methods-lifecycle-identity-research.mjs`、其 results、`docs/verification/MULTI-CONTACT-LIFECYCLE-IDENTITY-2026-10-17.md`、本卡及相关研究状态 / 禁改生产模型、DATA-CONTRACT、API、存储、服务、组件、迁移、vCard、版本、CHANGELOG、README 徽章和 `docs/PROGRESS.md`。
- **contract_change / host_or_spike_required：** 无生产契约变化；只冻结纯身份门禁输出。缺失 SQL 行、位置变化、owner 缺失和分页不完整均为 unknown 或冲突，不推断用户删除，不生成墓碑或修复身份。
- **ordered_steps：** 固定旧 A/同名新 B 及方法源 → 检查完整基线 → 替换名册绑定 → 复用旧 itemID 与新 itemID 重绑 → 省略旧文档行/改父块位置 → 注入 owner 冲突、重复 ID、缺页 → 重算诊断并核对拒绝原因稳定。
- **test_fixtures / test_commands / acceptance：** 同名不同 docId、同值跨人、旧源仍在/owner unknown、位置变化、旧 itemID 复用、官方映射冲突、重复 methodId、缺页和已知行缺失；`node --check scripts/spike/contact-methods-lifecycle-identity-research.mjs`、默认、`--dry-run`、`--import`。至少 14 个纯断言；unknown/duplicate/conflict/不完整均返回空方法集合且 `writeAllowed=false`、`tombstoneAllowed=false`、`projectionWrites=0`。
- **failure_retry_rollback / privacy_boundary / performance_budget：** 纯检查失败非零；不执行删除/移动、不重试未知写；结果只含固定虚构 ID、状态和原因，不输出联系方式值；无内核、端口、子进程、插件存储或生产 IO。
- **evidence_paths / owner / last_updated / commit：** [身份门禁证据](verification/MULTI-CONTACT-LIFECYCLE-IDENTITY-2026-10-17.md)、`scripts/spike/contact-methods-lifecycle-identity-research.mjs`、`scripts/spike/contact-methods-lifecycle-identity-results.json` / Codex + next_spike_design / 2026-10-17 / 未提交。
- **完成回报：** 16/16 纯检查；同名新文档不继承旧方法，同值跨人不合并；旧源不可达只报 `unknown-not-delete`，位置变化不视为删除；owner 冲突、重复身份、官方映射不一致、缺页和重绑旧目标均拒绝。默认运行仅写本轮结果 JSON；默认、`--dry-run`、`--import` 与模块导入均无 Kernel/插件存储/生产 IO，`kernelRequests=0`、`productionChanges=false`、`D1Adopted=false`。未证明真实文档删除/移动、持久墓碑/CAS、卸载恢复、UI 或并发。

#### AG-RF-004-S4 — 纯 JSON IO、方法搜索合并与索引状态研究

- **status / priority / type / milestone：** `done_isolated` / P2 / research+spike / M4；纯 Node 文件 IO、候选搜索合并和索引失效矩阵已收口，本卡不采纳生产数据源或 D8 契约。
- **user_outcome / user_scenario：** 联系人主 AV 已有命中时，次要联系方式命中仍能进入同一人物且不重复；方法库文件读取、解析、序列化、写后核实和索引缺失/失效/取消时不会把部分结果伪装成完整空结果。
- **source_ids / current_evidence：** Issue #51/#54、D1/D2/D5/D6/D8；`MULTI-CONTACT-METHODS-RESEARCH-2026-10-16.md` 的 10,000 人/100,000 方法仅为内存基线，并明确排除 JSON 磁盘读写、AV 合并、UI 取消与索引失效；本卡已补齐 24/24 纯检查、大快照 JSON IO、稳定 `personDocId` 去重、分页取消和索引状态回退，详见 `MULTI-CONTACT-SEARCH-IO-2026-10-17.md`。
- **depends_on / blocks / parallel_group / preconditions：** 依赖 S1-LIFE/S2 的稳定身份、严格输入与 loss/unknown 语义以及现有 AV 搜索分页形状；为 D8 搜索、D5/D6 出口提供隔离证据，不依赖采纳 D1 或修改生产 `storage`/`contacts`；`contact-methods-search-io`，全虚构值、随机临时目录、无内核/插件 API。
- **allowed_files / forbidden_files：** 新增 `scripts/spike/contact-methods-search-io-research.mjs`、结果 JSON、`docs/verification/MULTI-CONTACT-SEARCH-IO-2026-10-17.md` 及本卡和研究状态文档 / 禁改生产模型、`src/data/storage.ts`、AV/API、services、components、迁移包、vCard、`DATA-CONTRACT.md` 正式契约、版本、CHANGELOG、README 徽章和 `docs/PROGRESS.md`。
- **contract_change / host_or_spike_required：** 无生产契约变更；研究格式只在脚本中定义。文件阶段必须区分 read/parse/serialize/write/read-back mismatch/unknown；索引是可重建派生物，不是事实源。纯 Node `fs`/临时文件不能证明 Plugin `loadData/saveData`、Web Lock、CAS、跨窗口或宿主持久化。
- **ordered_steps：** ①登记并冻结输入/状态机；②生成有界 10,000/100,000 虚构方法快照及 AV 主值命中、次值命中和同人双命中夹具；③临时文件冷读→严格 parse→canonical serialize→临时写→写后回读并摘要核对，记录体积/耗时；④按 stable personDocId 合并去重，保留 `hitSources`/method 身份并把 itemId 变化标记为冲突；⑤验证分页、valid/missing/invalid/stale/rebuilding/cancelled 索引及分块扫描降级；⑥对取消、预算耗尽、坏 JSON、版本/revision/AV 锚点变化、改值/删值注入反例；⑦独立只读复核、结果脱敏和 diff 检查。
- **test_fixtures / test_commands / acceptance：** 10,000 人/100,000 方法，主值/次值/AV 直接命中交叉、同值跨人、重复 method hit、空结果、坏 JSON、未知 schema、截断文件、索引缺失/坏版本/旧 revision、扫描取消/预算耗尽；`node --check scripts/spike/contact-methods-search-io-research.mjs`、默认运行、`node scripts/spike/contact-methods-search-io-research.mjs --dry-run`。通过标准：同人多来源只一条且保留来源集合，跨人同值不合并；索引候选逐条最终验证；missing/invalid/stale/rebuilding/cancelled 或未扫完整均非 `complete`，不得产出假空成功；写后摘要不一致为 `unknown`，输入零业务写，结果不输出完整值。
- **failure_retry_rollback / privacy_boundary / performance_budget：** 任何 read/parse/serialize/write/read-back 异常保留阶段与摘要，未知不自动重写；临时文件只在路径核实后清理，失败现场可保留；仅虚构值、日志只含 hash/计数/状态，不输出姓名、电话、邮箱或标签。记录 JSON 字节数、一次大快照各阶段耗时、分块扫描访问量和索引构建中位/p95，均为本机纯 IO 研究预算，不外推真实插件/宿主性能。
- **evidence_paths / owner / last_updated / commit：** `scripts/spike/contact-methods-search-io-research.mjs`、其 results、`docs/verification/MULTI-CONTACT-SEARCH-IO-2026-10-17.md`、`docs/verification/MULTI-CONTACT-CONTRACT-REVIEW-2026-10-17.md` / Codex + s4_io_design / 2026-10-17 / 未提交。
- **完成回报：** `node --check`、默认运行与 `--dry-run` 均通过，纯检查 24/24；10,000 人/100,000 方法快照实际完成 JSON 序列化、临时写入、读取、严格解析、回读再序列化，21,790,126 B；写后摘要不一致为 `unknown`，坏 JSON/截断/未知字段为拒绝。AV+方法命中按稳定 `personDocId` 去重，`itemId` 变化标记冲突，分页取消和 related 均单独保留；valid/missing/invalid/stale/rebuilding/cancelled 与 partial/cancelled 均不伪造 complete。`kernelRequests=0`、`productionChanges=false`、`candidateContractAccepted=false`；真实 Plugin storage、跨窗口、UI、Host IO 与 D1/D8 正式契约仍未验证。

#### AG-RF-004-D6 — 旧值迁移、备份与版本出口纯研究

- **status / priority / type / milestone：** `done_isolated` / P2 / contract+research+spike / M4；20/20 纯检查通过，形成 D6 契约草案，不进入生产迁移或备份实现。
- **user_outcome / user_scenario：** 旧单值联系人升级、备份恢复或跨版本导入时，用户能看到拆分建议、冲突、未知和未覆盖模块；当前事实不会被坏包、墓碑复活或不可达人物姓名猜测覆盖。
- **source_ids / current_evidence：** Issue #51/#54、D5/D6、C-19/C-24/C-31、`MULTI-CONTACT-CONTRACT-REVIEW-2026-10-17.md`；[D6 研究证据](verification/MULTI-CONTACT-MIGRATION-EXIT-2026-10-17.md)与纯脚本结果已收口。
- **depends_on / blocks / parallel_group / preconditions：** 依赖 S2 严格恢复语义、L2 稳定人物身份和现有迁移包覆盖；阻塞 D6 正式 `DATA-CONTRACT`/codec、备份 UI 与生产升级卡；纯 Node、全虚构、无 Kernel/插件存储/端口，候选契约仍未采纳。
- **allowed_files / forbidden_files：** 新增 `scripts/spike/contact-methods-migration-exit-research.mjs`、结果 JSON、`docs/verification/MULTI-CONTACT-MIGRATION-EXIT-2026-10-17.md`、本卡和研究状态 / 禁改 `src/services/migration-bundle.ts`、`src/data/storage.ts`、生产 schema、DATA-CONTRACT 正式章节、API、UI、版本、CHANGELOG、README 徽章和 `docs/PROGRESS.md`。
- **contract_change / host_or_spike_required：** 无生产契约变更；研究规则为旧值保留一条、` / ` 仅拆分提示且确认前零写，未知版本/坏库/重复身份整批拒绝，缺模块保留现状，同 ID 冲突现状优先并报告，确认前重算基线，墓碑不复活，不按姓名恢复不可达人物，projection/operation/bridge/repair/self checkpoint 不进业务备份。
- **ordered_steps：** 解析明确 bundle/module 版本 → 严格识别缺模块/坏库/重复身份 → 生成旧值拆分预览 → 冻结基线并模拟确认前变化 → 计算当前优先/墓碑/不可达人物结果 → 核对备份覆盖与 checkpoint 排除 → 独立重跑、脱敏审计、diff 检查。
- **test_fixtures / test_commands / acceptance：** 旧单值与分隔符、多模块缺省、未知版本、坏 JSON/坏库、重复 ID、同 ID 内容冲突、预览后当前变化、墓碑记录、不可达人物同名值、checkpoint 列表；`node --check scripts/spike/contact-methods-migration-exit-research.mjs`、默认、`--dry-run`、`--import`。20/20 通过；默认仅写 spike 结果 JSON，dry-run/import 不写文件；`syntheticOnly=true`、`kernelRequests=0`、`productionChanges=false`、`candidateContractAccepted=false`、`writeAllowed=false`、`checkpointWrites=0`。
- **failure_retry_rollback / privacy_boundary / performance_budget：** 所有解析/基线/身份不确定性均零写并保留原因；未知请求不重放；只用虚构数据和固定 ID，不按姓名/值合并；小样本纯函数预算，不宣称真实 Plugin storage、锁、跨窗口、压缩或宿主 IO 性能。
- **evidence_paths / owner / last_updated / commit：** [D6 旧值迁移/备份/版本出口](verification/MULTI-CONTACT-MIGRATION-EXIT-2026-10-17.md)、`scripts/spike/contact-methods-migration-exit-research.mjs`、`scripts/spike/contact-methods-migration-exit-results.json` / d6_migration_spike / 2026-10-17 / 未提交。
- **明确退出边界：** 纯研究完成不等于生产 codec、备份入口或版本兼容已实现；真实 `loadData/saveData`、Web Lock、跨窗口快照、跨工作空间 ID 映射、UI 确认和 D1 事实源仍未验。Issue #51/#54 继续开放。

#### AG-ISSUE-035 — VCF QP 折行与跨卡安全审查

- **status / priority / type / milestone：** `done_isolated` / P1 / domain+test+evidence / 维护线。
- **user_outcome / user_scenario：** 导入含 QP 属性头折行、普通值中的编码文本、非法 QP 或相邻卡片的 VCF 时，不误吞属性/卡片边界，损坏项有明确拒绝结果。
- **source_ids / current_evidence：** Issue #35；`docs/verification/OPEN-ISSUE-RESEARCH-PLAN-2026-10-16.md`；既有纯域矩阵 17/17，尚无小米脱敏首卡。
- **depends_on / blocks / parallel_group / preconditions：** 无 / 关闭 #35 的根因确认 / vcard-compat / 仅使用虚构值和纯域解析。
- **allowed_files / forbidden_files：** `src/domain/vcard.ts`、`tests/vcard.test.ts`、本卡证据文档和合成 spike / 版本、CHANGELOG、README 徽章、生产存储或导入契约。
- **contract_change / host_or_spike_required：** 无生产契约变更；仅需纯域合成回归与 `pnpm check`，真实宿主不作为本卡替代证据。
- **ordered_steps：** 复核代理报告四类边界 → 增补最小回归/修复 → 重跑相关测试与检查 → 记录证据和未确认根因。
- **test_fixtures / test_commands / acceptance：** QP 属性头 RFC 折行、普通值编码文本、非法等号/半字节、QP 软行与下一卡边界；`node --test tests/vcard.test.ts`、`pnpm check`；合成场景不吞独立属性/卡片，非法输入拒绝，正常矩阵不退化。
- **failure_retry_rollback / privacy_boundary / performance_budget：** 解析失败整批拒绝且不进入导入计划；仅虚构姓名/号码；线性扫描，禁止扩大容错到静默部分导入。
- **evidence_paths / owner / last_updated / commit：** `src/domain/vcard.ts`、`tests/vcard.test.ts`、`scripts/spike/vcard-compat-research.mjs`、`docs/verification/VCARD-QP-SAFETY-AUDIT-2026-10-17.md` / vcf_safety_followup / 2026-10-17 / 未提交；纯域与服务回归已通过，Issue #35 仍因缺小米脱敏样本保持开放。

#### AG-ISSUE-052 — 个人备注保存与自由文本持久化排查

- **status / priority / type / milestone：** `done_isolated` / P0 / api+service+ui+test / 维护线。
- **user_outcome / user_scenario：** 个人备注可保存、重新打开回读；同类自定义和备注字段不丢失文本。
- **source_ids / current_evidence：** Issue #52/#53；人物备注采用 Markdown 标记块，需核对内核分块与回读形状。
- **depends_on / blocks / parallel_group / preconditions：** 无 / 备注修复声明 / note-persistence / 仅使用隔离测试库。
- **allowed_files / forbidden_files：** person-note domain/service、api/blocks、相应组件与测试 / 版本、CHANGELOG、README 徽章、其他并行实现文件。
- **contract_change / host_or_spike_required：** 先补 DATA-CONTRACT 的备注块读写规则；涉及内核分块需实证 / 隔离真实内核。
- **ordered_steps：** 复现 → 契约 → 最小修复 → 服务故障与 UI 回归 → 回读证据。
- **test_fixtures / test_commands / acceptance：** 多行、Markdown、清空、重复提交、读写失败、冲突；check/test/相关 UI 与内核回读；成功与未知区分，失败保留草稿。
- **failure_retry_rollback / privacy_boundary / performance_budget：** 不覆盖未知块、不重复插入；只用虚构文本；有界回读。
- **evidence_paths / owner / last_updated / commit：** `scripts/spike/person-note-spike.mjs`、`scripts/spike/person-note-results.json`、`docs/verification/ISSUE-TEXT-SUGGESTIONS-2026-10-16.md` / note_fix + Codex / 2026-10-16 / 未提交；隔离测试已收口，真实用户工作区仍待 Host Queue。

#### AG-ISSUE-048 — 默认家庭生命周期与组织移除

- **status / priority / type / milestone：** `done_isolated` / P1 / contract+service+ui+test / 维护线。
- **user_outcome / user_scenario：** 家庭改名不再重建；用户可明确移除组织，理解文档与历史成员影响。
- **source_ids / current_evidence：** Issue #48；启动时按名称保证家庭存在，改名不补种，移除可恢复且保留原文档/成员历史；Workbench 只显示资料编辑器新建入口，旧宿主路径保留带可见标签的快捷创建兼容。
- **depends_on / blocks / parallel_group / preconditions：** 无 / 组织修复声明 / org-lifecycle / 使用已有端点和受控标记。
- **allowed_files / forbidden_files：** org/init/index/types、组织 UI、数据模块及专门测试 / 版本、CHANGELOG、README 徽章、person-note 实现。
- **contract_change / host_or_spike_required：** 先明确一次性种子与可恢复移除、文档/成员保留规则 / 无新端点；真宿主另记。
- **ordered_steps：** 契约 → 稳定种子 → 影响预览及移除恢复 → 排版复核 → 失败回归。
- **test_fixtures / test_commands / acceptance：** 改名、归档、移除、重启、并发、成员历史、读写失败；check/test/组织 UI；不靠显示名称识别种子，不删除用户原文或历史。
- **failure_retry_rollback / privacy_boundary / performance_budget：** 未核实不重建，失败可重试；虚构组织；复用分页扫描。
- **evidence_paths / owner / last_updated / commit：** `tests/organization-scan.test.ts`、`tests/organization-writes.test.ts`、`docs/DATA-CONTRACT.md`、`scripts/e2e/ui/smoke.js`、`scripts/e2e/ui/organization-context-regression.js` / org_fix + Codex / 2026-10-16 / 未提交；组织隔离 UI 16/16，完整 Chrome UI 387/387，真实宿主与双窗口仍待 Host Queue。

执行边界：`AG-P0-010` 桥 v2 能力边界已有隔离证据；新端点仍须实证。涉及存储并发的隔离开发可使用 AG-P0-019 已保存证据，真实多窗口完成声明仍需宿主验收。

持续门禁：`AG-QA-001`、`AG-QA-002` 已完成本轮隔离门禁；后续只在源码或契约继续变化时重跑。

### Dependency Queue（当前）

无。原依赖队列已按本轮隔离验收关闭；不存在的 `AG-B14-006` / `AG-AI-004` 不再出现在队列。

已有隔离证据，不重做原实现：`AG-P0-002`、`AG-QA-004`；`AG-P0-003` 仅补写后核实与服务故障回归。宿主待验与增量回归：`AG-P0-001/005/006/019`、`AG-B14-002/005`。多联系方式 L2 身份门禁与 D6 旧值迁移/备份/版本出口纯研究已完成；生产迁移/备份实现仍需正式契约和宿主证据。

### Host Queue（隔离实现不能直接标 done）

`AG-HOST-001` 原生图打开与 `siyuan://blocks` 成边、`AG-HOST-002` B13 组织/成员真机与多窗口刷新、`AG-HOST-003` 任务块全量对账、`AG-HOST-004` 移动端 390px/软键盘/系统返回、`AG-HOST-005` 原型关键旅程真宿主复核、`AG-HOST-006` 用户五项反馈的真实读写验收。

2026-10-04 进展：`AG-HOST-003` 的 v3.8.6 隔离内核 spike 通过任务块创建、扫描、勾选/取消、批量标记、自定义关联属性保留、删除反查和 ID 分页；`AG-HOST-001` 的图数据 spike 通过 refs 双向边和 `getGraph/getLocalGraph` 形状核对，并确认普通 Markdown `siyuan://blocks/<docId>` 链接不会形成 refs 边，原生图面板打开仍需真实前端入口与成边方案。`AG-HOST-002` 已在真实 browser-desktop 同源双页面验证稳定 ref 建档和互动 ref 幂等，并在单页面真实 UI 验证组织改名、成员编辑、归档恢复和刷新；组织/成员双窗口刷新仍待补证。`AG-HOST-006` 已通过同一隔离工作区的 9 项实际服务重启回读及 browser-desktop 生日、账本、别名、跟进、组织 UI/重载回读和截图；多人事项的真实 UI 捕获弹窗、真实用户工作区、原生图、真机和系统行为仍不能由隔离证据替代。详见 `docs/verification/REAL-FRONTEND-2026-10-04.md`。

2026-10-05 真实双页面增量：同一隔离 browser-desktop 的两个页面中，第一页面改名组织、编辑成员职位、归档并恢复组织后，第二页面均通过数据变化事件原地回读，无浏览器重载；人物/互动稳定 ref 幂等仍通过。组织成员对应人物文档投影的第二页面专门核对、真实用户工作区和真机仍保留 Host Queue。

2026-10-05 增量：`AG-E2E-001` 已隔离完成。并行编排器实际同时运行桌面、390px 和实际服务三项作业，结果 `3/3`；端口、临时工作区、浏览器 profile、证据和日志互不复用，失败作业继续执行其他作业，清理只针对本轮持有的进程。真实宿主认证、真机和日常工作区继续由 Host Queue 守门。

2026-10-05 真实隔离前端复核：`services-flow` 的实际服务链保持 `9/9`，`browser-desktop` 真实前端 `realFrontend=true`；生日、账本新增/结清/重开、别名、跟进任务块、组织改名/成员编辑/归档/恢复、页面重载回读、组织改名/成员职位/归档恢复跨窗口原地刷新、双页面人物 ref 和互动 ref 幂等均通过。捕获来源文档仍因宿主 `openFileByURL` 返回 `Uncaught` 未打开，捕获 UI 不标完成；组织成员对应人物投影、真实用户库、原生图面板和真机仍由 Host Queue 验收。

2026-10-17 增量收口：实际服务 11/11；修复组织后台页 RAF 等待后，真实隔离 Chrome browser-desktop 的改名、成员编辑、归档、恢复双页面原地刷新全部通过。捕获使用原生 refs 识别 2 位候选，完成重复提交和正常关闭；原 2 条互动 ID 保留，来源/日记/地点/双方人物的 5 侧标记均各 1。完整桌面 UI 389/389；详见 [HOST-QUEUE-2026-10-17](verification/HOST-QUEUE-2026-10-17.md)。以上不替代组织人物投影专门双页、真实用户工作区、原生图和真机验收。

### Deferred / Candidate Queue

类型化关系库、纪念日/礼物/周回顾、地图/日历、OCR/二维码、嵌套组织、Agent 自动行动、复杂推荐和任何尚未完成隐私/契约评估的候选只能进入 `AG-RF-*`，不得从原型按钮直接开发。

#### AG-RF-004 — Issue #51/#54 多联系方式与两层自定义条目

- **status / priority / type / milestone：** `candidate` / P2 / contract+research+spike / M4；2026-10-17 只读契约复评已完成，生产候选未采纳。
- **user_outcome / user_scenario：** 同一联系人可保留多个电话、邮箱、微信等联系方式，并能在明确边界内记录少量有层级的自定义条目；主值、标签、顺序和导出结果可解释、可恢复。
- **source_ids / current_evidence：** Issue #51/#54；`docs/verification/ISSUE-TEXT-SUGGESTIONS-2026-10-16.md`、`docs/verification/MULTI-CONTACT-NATIVE-2026-10-17.md`、`docs/verification/MULTI-CONTACT-RECOVERY-2026-10-17.md`。当前 AV 仍是单值投影，vCard 多 `TEL` 会拼接、多个 `EMAIL` 只取首个；N1 纯内存候选 31/31，但不能当作真实多值契约。
- **depends_on / blocks / parallel_group / preconditions：** 依赖现有联系人写入、迁移、vCard 契约和稳定人物 ID；阻塞多联系方式 UI、搜索、批量编辑及导入导出扩展；`contact-model`；先完成字段身份、兼容投影、删除/冲突和隐私决策。
- **allowed_files / forbidden_files：** 研究文档、`src/domain` 纯函数、脱敏 `scripts/spike`、对应测试和 UI 原型；未决策前禁止直接改生产联系人 AV、迁移包和 vCard 写入，禁止版本、CHANGELOG、README 徽章、`docs/PROGRESS.md`。
- **contract_change / host_or_spike_required：** 待定义 `contactMethods[{id,type,value,label,isPrimary,order,...}]` 与两层 `customFields[{id,label,value,parentId,order}]`；必须用脱敏多 `TEL/EMAIL`、旧单值联系人、重复值和往返导入导出 spike 验证，真实宿主再验 AV/编辑器兼容。
- **ordered_steps：** ①定义稳定 ID、类型、标签、主值、排序和空值规则；②保留旧 AV 主值兼容读写并做迁移预览；③定义 vCard 多值映射、重复/冲突和导出保真；④定义 `customFields` 两层、父项删除影响和搜索/备份边界；⑤做规模、隐私和 UI 入口 spike；⑥明确采纳、延期或拆分正式实现卡。
- **本轮研究门槛：** 先比较 AV 全量、人物原生文档全量 + AV 主值、插件列表全量 + AV 主值的数据主权与可读性，暂不采纳 JSON 唯一全量事实；明确原生主值编辑冲突及跨位置投影失败恢复。旧电话 ` / ` 默认保留原文，拆分需预览确认；次要联系方式必须有不受 AV query 漏检的搜索方案与实测预算。联系方式方案通过后再研究两层 `customFields`，候选结构尚未采纳为生产契约。
- **2026-10-17 复评出口：** 事实源若由 AV 改为插件列表，次要值的数据主权与备份说明必须先决策；原生人物文档全量已加入并列候选。方法身份/主值删除/原生冲突/持久投影/迁移版本/搜索完备性仍是生产前门禁。`AG-RF-004-S1` 已 `done_isolated`，有限合成适配器 60/60、独立只读复核 5/5；新增 `AG-RF-004-S1-LIFE` 已 `done_isolated`，vCard 方法编辑/删除/新增/重排/重复/未知属性 18/18；新增 `AG-RF-004-L2` 已 `done_isolated`，人物生命周期身份门禁 16/16；`AG-RF-004-S2` 已 `done_isolated`，恢复矩阵 60/60、独立反例 21/21，不决定 D1；`AG-RF-004-N1` 保持 `host_pending`，纯内存候选 31/31，隔离内核六方法写读/重启/缓存清理及 API 改值/删块通过，Chrome 正文操作与同人物双页面刷新已有观察，严格候选 UI 读取、复制和并发仍待验。UI 正文折行且身份夹具不同，不能升级为解析成功；`AG-RF-004-N2` 独立研究编辑器格式、复制采纳和不完整读取屏障。完整 D7 与方法库主流程未采纳，尚不具备把生产存储、投影或 UI 标 ready 的条件。
 - **后续能力证据与顺序：** N2 纯研究 123/123、N2-HOST 的 DOM4/4 与 Markdown2/4/重启回读已单列，UI 仍待验；S1-LIFE 已补 vCard 方法 lineage/loss 18/18，但不证明字节回环或外部互操作；L2 已补同名新文档、旧源不可达/位置变化、重绑和 owner 冲突的身份门禁 16/16，不证明真实 delete/move 或持久 tombstone；新增 D3/D4-P 已补主值删除、显式切换、零主值、解绑差异、墓碑和陈旧投影冲突 21/21，仍不证明真实宿主写入。S3-A0 已复现既有 AV 赋值在新鲜检查后仍可覆盖中间值。N3 已完成22/22纯反例和59次隔离真实内核请求，确认marker-only与全部特征消失后的冷读会漏方法而子集仍complete；已知ID只能揭示unknown，不授权墓碑或清空。[范围发现证据](verification/MULTI-CONTACT-NATIVE-SCOPE-2026-10-17.md)后，A1已完成58/58纯检查和135次隔离真实内核请求：显式真实block主键+8text方法列可分页回读，故障拒绝/删行/缓存清理/重启通过，见[AV行能力证据](verification/MULTI-CONTACT-AV-ROWS-2026-10-17.md)。A2已完成独立冷进程发现与歧义协议及修复后151次隔离真实内核请求，见[无锚点冷发现证据](verification/MULTI-CONTACT-AV-DISCOVERY-2026-10-17.md)；唯一候选仅为unique_unowned，未知/截断撤回唯一判断，不证明所有权、历史全集或真实卸载恢复。下一步续接 `AG-RF-004-N2-HOST-UI-COPY` 的有效候选原生编辑/完整块复制；Chrome不可用时保留host_pending。L2 收口后，D6旧值迁移/备份/版本出口纯研究已完成`done_isolated`，不再作为待补研究；其正式契约、生产迁移/备份实现和宿主回读仍待独立门禁。随后补正式/剩余D3/D4人物生命周期、D7数据出口及完整搜索测量，再综合D1比较，父卡继续candidate。
- **联合生命周期增量：** `AG-RF-004-L1` 已done_isolated，34/34纯检查、76次隔离真实内核请求和独立raw审计，见[双AV联合生命周期](verification/MULTI-CONTACT-LIFECYCLE-2026-10-17.md)。主方法缺失仍留旧主表值，名册解绑不消除剩余方法或人物文档；本轮同doc重绑换itemID且phone为空，重启只读保持。L2 已补同名新doc、旧源不可达/位置变化与 owner/itemID 冲突的16/16纯身份矩阵。已观察到的缺行/解绑只供研究诊断，零晋升/清空/墓碑/投影；正式D3/D4、人物删文档/移动、UI或同时竞争仍待验，父卡继续candidate。
- **test_fixtures / test_commands / acceptance：** 多电话/邮箱/微信、主值切换、重复值、空值、旧数据、未知类型、父项/子项删除、循环/悬空父项、导入导出往返、备份恢复；运行对应 domain/spike、`pnpm check`、`pnpm test`。通过标准是旧数据无损可读、稳定 ID 不因改名变化、最多两层且无循环、vCard 往返边界可见、失败不覆盖本地事实。
- **failure_retry_rollback / privacy_boundary / performance_budget：** 迁移和导入先预览，逐条报告成功/冲突/失败/未知；不按姓名或值静默合并、不因父项删除级联抹掉子项；默认不外发私密联系方式，导出逐项确认；在 1 万联系人和 10 万条目样本下记录索引、搜索和迁移成本，超预算分页或延后。
- **evidence_paths / owner / last_updated / commit：** `docs/verification/ISSUE-TEXT-SUGGESTIONS-2026-10-16.md`、`docs/verification/MULTI-CONTACT-METHODS-RESEARCH-2026-10-16.md`、`docs/verification/MULTI-CONTACT-CONTRACT-REVIEW-2026-10-17.md`、`docs/verification/MULTI-CONTACT-VCARD-2026-10-17.md`、`docs/verification/MULTI-CONTACT-OWNERSHIP-2026-10-17.md`、`docs/verification/MULTI-CONTACT-NATIVE-2026-10-17.md`、`docs/verification/MULTI-CONTACT-NATIVE-HOST-2026-10-17.md`、`docs/verification/MULTI-CONTACT-RECOVERY-2026-10-17.md`、`scripts/spike/contact-methods-research.mjs`、`scripts/spike/contact-methods-research-results.json`、`scripts/spike/contact-methods-vcard-research.mjs`、`scripts/spike/contact-methods-vcard-research-results.json`、`scripts/spike/contact-methods-native-research.mjs`、`scripts/spike/contact-methods-native-research-results.json`、`scripts/spike/contact-methods-native-host-spike.mjs`、`scripts/spike/contact-methods-native-host-results.json`、`scripts/spike/contact-methods-recovery-research.mjs`、`scripts/spike/contact-methods-recovery-research-results.json` / Codex + research agents / 2026-10-17 / 未提交。

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

#### AG-B13-007 — 组织关系历史保留与状态演进

- **状态 / 类型 / 优先级：** `partial` / `contract+domain+data+service+ui+graph+test` / P1 / M4。
- **用户结果：** 人员离职、毕业或状态变更后，人与原组织的关系仍可追溯、可关联、可进入图谱；当前状态与历史状态清楚区分，不会把历史关系误计为当前在职或在读。
- **用户场景：** 同一人可同时或先后加入多个组织；例如 A 公司为“离职”、B 公司为“在职”，高中为“毕业”、大学为“在读”，并可保留组织内多段经历和自定义状态。
- **来源与证据：** 用户反馈“组织关系不能因离开而断开”；当前 `src/domain/org-membership.ts` 的 `active/former` 状态、`src/services/org.ts` 的组织投影、`src/domain/graph.ts` 的成员边和 `src/components/org/OrgManagerDialog.svelte` / `src/components/people/PersonDetail.svelte` / `src/components/people/PersonEditDialog.svelte` 的状态交互；现有 B13.003、B13.005、B13.006 与 B14.001/B14.003 的历史、投影和图谱约束。
- **依赖 / 阻塞：** 依赖 `AG-B13-001/003/005/006` 与 `AG-B14-001/003` 的既有事实源和图查询快照。D-0037 已确定稳定 ID、历史段、当前投影和图谱边的分层口径；运行时余项仍受真实宿主、多窗口、迁移和真机证据阻塞，后续不得把 `former` 显示成 `active`。
- **允许触碰：** `docs/DATA-CONTRACT.md`、`docs/DECISIONS.md`、`src/domain/org-membership.ts`、`src/domain/graph.ts`、`src/data/org-membership.ts`、`src/services/org.ts`、相关图谱/组织/人物组件与测试；实现阶段再按契约扩展迁移、导入导出和体检模块。
- **禁止触碰：** 契约评审完成前不修改运行时代码、版本号、`CHANGELOG`、README、`docs/PROGRESS.md` 或发布配置；不得删除既有 `former` 记录、重建人物/组织 ID 或以名称合并关系。
- **契约变更：** 现有模型已由 D-0037/0038 收口：以稳定 `membership.id` 表示一段经历，`status` 表达当前性，`affiliationKind` 表达分类，`statusLabel` 表达自定义显示状态，`joinedOn/leftOn` 表达期间，`note` 表达本段说明。结束只更新状态和结束信息；再次加入另建历史段，不覆盖旧段。沿用 schema 1，无新增字段或结构迁移；更丰富的状态模型须另列候选任务。
- **宿主或 Spike 要求：** 先完成契约评审和域层样例矩阵；实现后需要独立存储/迁移回读、图查询快照、真实组织/人物双向页面、多窗口刷新和真机窄屏验收。不得用隔离 mock 或静态原型代替真实图谱与宿主证据。
- **有序步骤：**
  1. 已形成成员事实、历史段、归档、迁移/体检、投影、共同背景和图谱的影响矩阵，复评按现有模型收口。
  2. 已确定 `active/former × affiliationKind` 派生在职/离职/就读/毕业显示，`statusLabel` 只覆盖文案；时间缺失不推断状态，同日/重叠历史不自动合并。
  3. 旧 schema 1 兼容、重复 active、非法期间、未知状态和删除墓碑沿用既有严格读取与恢复规则；真实备份恢复回读仍需补证据。
  4. 当前单位投影与 member 边状态的隔离实现已发布；当前与历史筛选分开，图快照聚合状态，逐段经历由人物/组织详情回读。
  5. 既有导入导出、归档/恢复、移动与刷新路径按宿主要求验收。当前体检覆盖重复与非法期间，任意区间重叠检测未交付，后续实现须先拆成可认领任务。
  6. 仍需真实宿主图谱/统计/详情回源、多窗口、真机、旧工作区迁移与 1 万段历史性能证据。
- **测试夹具：** 单一 active→former；former→active 恢复；A/B 多组织并存；同组织多段任职；高中毕业+大学在读；无开始/结束日期；重叠和同日状态；自定义状态改名；组织归档但历史关系保留；导入导出往返；体检发现并修复异常；图谱快速切换和跨窗口迟到响应。
- **测试命令：** `pnpm check`、`pnpm test`、受影响的组织/人物/图谱 UI 回归、迁移与实际服务回归；真实宿主完成后补对应 Host Queue 命令和证据路径。
- **验收：** 关系事实在状态变化后 `membershipId`、人物 ID 和组织 ID 均不变；历史组织边默认保留并以边样式、标签或详情明确当前/历史状态；当前在职/在读统计不包含已离职/已毕业记录；历史筛选可找回关系；人物详情、组织详情、首页资料、共同背景、自研图和原生图范围与文案一致；删除、迁移、导入导出和归档不会误删或复活历史关系。
- **失败 / 重试 / 回滚：** 状态写入、投影、图谱刷新和跨窗口广播分层报告；部分失败只重试未核实模块，不重复新增关系；写后回读未知时保留 pending，禁止把旧快照覆盖新状态；迁移失败不覆盖原记录，可按批次回滚或从备份恢复。
- **隐私边界：** 状态说明、离职/毕业时间和自定义内容属于联系人/组织资料，导出、图谱证据和跨窗口事件遵循现有隐私与字段支持边界；不得从图谱或互动频率推断在职、在读等状态。
- **性能预算：** 关系历史查询按组织/人物索引和稳定排序，避免每个历史段全库扫描；1 万段历史记录下首屏查询、状态筛选和图谱构建需保持现有规模预算，并报告截断与范围成本。
- **证据路径：** `docs/DATA-CONTRACT.md`、`docs/DECISIONS.md`（D-0037）、`docs/verification/ORG-MEMBERSHIP-HISTORY-MATRIX-2026-10-16.md`；对应域/服务/UI 隔离测试已通过，迁移、真实双窗口、原生图和真机证据仍待补。
- **2026-10-16 投影口径补强：** `buildOrgDisplayByPerson` 现在只把未归档组织的 `active` 成员投影到当前单位行；只有 `former` 成员时保持当前单位为空，历史仍留在详情/历史筛选。组织健康 UI 回归已覆盖该场景；`pnpm check`、`pnpm test` 597/597、桌面/移动/宿主样式 UI 381/381 全部通过。图谱 `member` 边已携带 `active|former|mixed` 生命周期标签，并同步文本、Markdown 和画布样式；详情图例和边状态去重已补强；真实宿主、多窗口、迁移和真机证据仍未齐，`AG-B13-007` 继续保持 `partial`。
- **2026-10-16 契约复评收口：** D-0037/0038、DATA-CONTRACT、实现与影响矩阵已核对；定向图谱/导出/成员域测试 55/55 通过。图快照不含每段经历，通用区间重叠检测不计为已交付；契约和隔离实现完成，整卡保留 `partial`。
- **负责人 / 更新时间 / 提交：** `Codex` / `2026-10-16` / `551bcd6`、`ce51bbb`（隔离实现）；`4372593`（v0.5.16 发布）。

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
- **2026-10-16 关系搜索补齐：** 工作台搜索在直接命中结果规模不超过一页且存在 `relatedItemIds` 时，按稳定 itemID 补读未过滤分页，收回双向/单向关系邻居；关系扩展仍受分组、标签和资料筛选约束，外部桥接搜索保持直接字段匹配。超过一页的直接命中继续只走 AV 下推，避免把万级搜索退化成每次全量扫描。证据：`src/domain/contact-search.ts`、`src/components/people/PeopleView.svelte`、`tests/contact-search.test.ts`。
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
- **当前证据：** 2026-10-17 在真实 Kernel `3.8.8-alpha.3` 的 UUID 隔离工作区中复跑：`refs` 前向两条边、反向边回链、`getGraph/getLocalGraph` 形状和中心/入链范围均通过；普通 Markdown `siyuan://blocks/<docId>` 仍未形成 refs 边。脱敏摘要见 [AG-HOST-001 图 Kernel 证据](verification/AG-HOST-001-GRAPH-KERNEL-2026-10-17.json)。原生图面板入口、中心透传、返回语义、移动端和真实用户工作区仍未核验，整卡保持 `host_pending`。

### AG-HOST-002 — 组织、成员和多窗口刷新

- **状态 / 类型 / 优先级：** `host_pending` / host+e2e / P1 / M3。
- **依赖：** `AG-B13-003/004/006`。
- **步骤：** 两窗口同时改组织名、成员状态、归档和人物投影；关闭一个窗口后触发延迟事件；核对图谱和首页。
- **验收：** 最终值一致；无旧实例回调；失败/未知清楚显示。
- **当前证据：** 2026-10-17 修复后台页 RAF 等待后，真实隔离 Chrome browser-desktop 的组织改名、成员编辑、归档和恢复在同源双页面均原地刷新通过，写入前第一页 hidden 且无残留 busy；人物/互动 ref 双页面幂等亦通过。证据见 [HOST-ORG-DUAL-WINDOW-2026-10-17](verification/HOST-ORG-DUAL-WINDOW-2026-10-17.json)。组织成员对应人物文档投影的专门双页、原生思源多窗口、真实用户工作区和真机仍未验。

### AG-HOST-003 — 原生任务块全量对账

- **状态 / 类型 / 优先级：** `host_pending` / host+e2e / P0 / M2。
- **2026-10-16 增量认领：** Codex；补至少 6 条跨日期任务的真实产品服务对账、编辑/完成/删除、受控读取失败和内核重启回读；仅操作脚本创建的 UUID 隔离工作区，整卡保留 `host_pending`。
- **依赖：** `AG-P0-008`。
- **步骤：** 创建、修改、完成、删除至少 6 条跨日期任务；重启/刷新后检查索引、文档和首页；注入一个受控块读取失败。
- **验收：** 各侧状态逐项一致或明确未对账；失败不会伪装成功。
- **当前证据：** 2026-10-17 的 v3.8.8-alpha.3 隔离真实内核通过 11/11，包含 9 条跨日期任务的索引/文档/首页逐项对账、编辑/完成/删除、受控读取失败和重启回读；证据见 [HOST-QUEUE-2026-10-17](verification/HOST-QUEUE-2026-10-17.md) 与 [SERVICE-KERNEL-2026-10-17-ALPHA3-SUMMARY](verification/SERVICE-KERNEL-2026-10-17-ALPHA3-SUMMARY.json)。真实用户工作区、原生编辑器交互和其他任务管理器互读仍待验。

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
- **2026-10-16 增量认领：** Codex；以 v0.5.16 产物复核真实 Chrome browser-desktop，定位此前账本提交超时并记录后续各项可达性；使用独立工作区，保留各项未验边界。
- **user_outcome / user_scenario：** 生日可持久保存，多人事项四侧双链可核对，账本/别名可重启读取，员工替换保留组织与人员历史。
- **source_ids / current_evidence：** 用户五项原始反馈；当前已有各项代码，缺真实宿主闭环证据。
- **depends_on / blocks / parallel_group / preconditions：** AG-P0-003/006/014/015/016/017/018/019、AG-ALIAS-001、AG-QA-004；阻塞五项“全部完成”声明；host-user-feedback；用户允许的隔离思源工作区和版本记录，不默认操作日常库。
- **allowed_files / forbidden_files / contract_change / host_or_spike_required：** 验收 scripts、审查证据、UI-REGRESSION/PAGE-STATUS；保护文件和日常人物原文；无；必须真实内核/前端并记录版本。
- **ordered_steps：** 公历/农历/清空/闰日生日保存后回读并重启；多人来源/日记/地点/人物引用和反链核查、重复捕获/局部失败重试；账本建立/结清/重开/备份恢复；别名冲突/泛称/有效人物匹配；同组织员工替换、离职历史和两侧刷新。
- **test_fixtures / test_commands / acceptance：** 虚构两组织、多位人物、特殊字符、失败注入；相关 spike 与实际操作步骤；每项保存输入/输出/回读/版本/截图，未验项不能用隔离通过替代。
- **failure_retry_rollback / privacy_boundary / performance_budget：** 局部成功保留事实，只清理本轮受控测试产物；禁外发真实往来与联系人；记录请求数和大库边界，不新增性能承诺。
- **current_evidence：** 2026-10-17 隔离真实产品服务 `11/11`，真实 browser-desktop `realFrontend=true`，插件加载、桥 protocol 2、稳定 ref、工作台、生日、账本、别名、跟进、组织工作台、组织改名/成员编辑/归档/恢复、页面重载和人物/互动双页面幂等均通过；捕获来源文档、命令和原生弹窗可达，2 位候选重复提交完成，原 2 条互动 ID 保留，来源/日记/地点/双方人物 5 侧标记均各 1，弹窗正常关闭；组织改名/成员编辑/归档/恢复双页面均通过。真实用户工作区、组织人物投影专门双页、原生图和真机仍未验。
- **2026-10-05 复核：** 真实隔离 browser-desktop `realFrontend=true`，核心用户旅程、页面重载回读和双页面稳定幂等均通过；捕获来源文档打开仍返回 `Uncaught`，因此捕获 UI 保持未验。该证据不替代真实用户工作区、组织双窗口、原生图和真机验收。
- **evidence_paths / owner / last_updated / commit：** `docs/verification/HOST-QUEUE-2026-10-17.md`、`docs/verification/SERVICE-KERNEL-2026-10-17-ALPHA3-SUMMARY.json`、`docs/verification/SERVICE-KERNEL-2026-10-17.json`（alpha.2 历史基线）、`docs/verification/HOST-QUEUE-2026-10-16.md`、`docs/verification/REAL-FRONTEND-2026-10-04.md`；Codex；2026-10-17；待提交。

## 6. 研究候选（只调研，不直接开发）

### AG-RF-001 — 候选能力的隐私、契约和宿主评估

- **状态 / 类型 / 优先级：** `candidate` / research / P3 / M5。
- **范围：** 纪念日、礼物往来、周回顾、谈资、地图/日历、OCR/二维码、嵌套组织、类型化关系、推荐和 Agent 自动行动；OCR alpha 调研结论见 [OCR-RESEARCH-2026-10-11](OCR-RESEARCH-2026-10-11.md)。
- **边界更新：** 用户明确提出的金钱/物品/人情往来账本已经落盘，不再作为未立项候选；账本质量收口走 `AG-P0-015/016/017/018`。礼物推荐、购买计划和自动提醒仍为候选，不能借账本入口扩大范围。
- **每项产物：** 用户问题、事实源、存储/迁移、外发边界、宿主依赖、移动成本、解释方式、最小 spike、采纳/延期决定。
- **禁止：** 不因原型出现、竞品存在或 AI 能生成就进入主导航、DATA-CONTRACT 或生产写入。
- **OCR 额外门槛：** 思源 3.8.7 正式版发布前不依赖 alpha OCR 设置/AI OCR 端点；正式版后先做能力探测和权限/加密资源 spike，未配置时必须保留文字粘贴、编辑器选区和 vCard 导入。

### AG-RF-002 — AI 能力的分阶段研究

- **状态 / 类型 / 优先级：** `candidate` / research / P3 / M5。
- **范围：** 关系摘要、谈资建议、候选标签、下一步建议、OCR/二维码、外部 Agent。
- **门槛：** 先完成 `AG-AI-001/002`；研究只输出脱敏样本、可追溯证据和人工确认设计，不写联系人事实、提醒或图谱。

### AG-RF-003 — 历史组织弱联系与虚拟关系图

- **状态 / 类型 / 优先级：** `candidate` / research+spike / P3 / M6。
- **用户结果：** 即使用户本人没有加入某个组织，也能在明确标注“共同历史组织”的前提下，发现 A、F 等联系人曾在同一学校或公司经历过的弱联系线索；推断结果可解释、可关闭、不会冒充明确关系。
- **用户场景：** A 曾在 X 学校学习后毕业，目前在 C 公司；F 也曾在 X 学校学习后毕业，目前在 D 公司；用户没有 X 学校的本人关系或组织文档，但联系人资料中已有 A、F 的相关历史记录。系统可以生成一条仅供探索的虚拟组织关联，展示证据、时间和置信度，供用户决定是否建立正式组织或关系。
- **来源与证据：** 用户提出的远期规划；当前 `AG-B13-007` 的历史组织关系契约、`AG-B14-001/003` 的图谱边语义和范围契约；当前产品约束“共同组织只提供事实依据，不自动生成 `related` 边或互动事件”。
- **依赖 / 阻塞：** 依赖 `AG-B13-007` 完成关系事实与状态演进设计、`AG-B14-001/003` 稳定图查询快照，以及 B12 稳定人物 ID 消歧；在组织引用归一化、虚拟节点生命周期、推断边语义和隐私开关明确前，不进入生产主流程。
- **允许触碰：** 研究文档、脱敏样本、`scripts/spike/` 下的离线算法验证、图谱只读原型和性能基准；未来若采纳，再按契约扩展 `src/domain/graph.ts`、图谱查询服务与设置/详情 UI。
- **禁止触碰：** 研究阶段不修改联系人、组织、关系或互动事实；不自动创建组织文档、成员关系、`related` 边、提醒和 AI 事实；不把同名组织、自由文本或外部网络结果直接视为同一组织；不读取或上传用户工作区之外的数据。
- **契约变更：** 研究阶段无生产契约变更；需要评估一种独立的派生边类型，例如 `shared-org-history-inferred`，携带来源人物、组织引用、历史期间、证据位置、置信度和生成规则，与显式关系、当前成员边、文档引用边严格分开。虚拟组织只作为查询结果或临时节点，不能伪装成可编辑的组织事实。
- **宿主或 Spike 要求：** 先用脱敏固定样本验证组织引用归一化、别名/校区/同名消歧、时间兼容和边去重；再评估真实思源工作区的只读查询成本、权限失败和图谱范围。没有稳定组织 ID 的文本匹配必须保持“候选/待确认”，不能以隔离 mock 证明生产可用。
- **有序步骤：**
  1. 盘点历史组织信息的来源：稳定 `orgDocId` 成员事实、联系人自定义字段、备注和文档文本，区分可验证事实与自由文本。
  2. 设计组织引用归一化和消歧规则，处理别名、校区、部门、改名、同名学校/公司、缺年份和已归档组织；不能确认时保留多个候选。
  3. 定义弱联系边的标签、置信度、证据、时间范围、显示开关和删除/隐藏语义，明确它不会进入当前关系统计、共同组织计数、提醒或导出事实。
  4. 用固定样本做离线算法和规模 spike，比较“稳定组织 ID 命中”和“文本候选命中”两种结果，评估误连、漏连和解释成本。
  5. 设计只读图谱预览：虚拟组织节点、联系人之间的弱联系、证据侧栏和“创建组织/确认关系”人工入口；确认前零写入。
  6. 输出采纳、延期或拒绝结论；只有隐私、契约、性能和宿主证据均满足时，才拆分为正式实现任务。
- **测试夹具：** A/F 共享稳定组织 ID但用户无该组织；A/F 只有相同自由文本；学校改名和校区差异；同名不同组织；毕业年份相差多年；同一人多段组织历史；组织被归档/删除；缺日期和冲突日期；联系人同名但 docId 不同；用户关闭推断边；10k 联系人和大量历史组织引用。
- **测试命令：** 研究阶段运行对应离线 spike、`pnpm check`（如涉及类型/原型）和性能基准；不以现有全量 UI 通过代替算法准确性、隐私和宿主验收。
- **验收：** 研究报告能量化误连/漏连、查询成本和解释性；显式组织边、历史成员边、推断弱联系边可区分；无稳定组织 ID 时不会自动建立事实；用户本人没有该组织时仍可查看候选线索；关闭或删除推断结果不影响联系人和组织原始数据；最终明确采纳、延期或拒绝及下一张正式任务卡。
- **失败 / 重试 / 回滚：** 解析失败、组织消歧失败、权限不足和图谱超时均显示为未知/候选，不降级为空关系；只重试读取和计算，不重试任何事实写入；研究原型可整体移除，不需要迁移用户事实。
- **隐私边界：** 默认关闭或明确 opt-in；只使用当前工作区已记录的联系人与组织资料，不访问外部社交图谱；展示证据来源和参与计算的字段；导出、分享和跨窗口事件不得把推断边当作事实传播。
- **性能预算：** 优先使用组织引用索引和稳定 ID Map，禁止对每个联系人全库扫描；在 1 万联系人、10 万历史段和 1 万组织引用样本下，输出索引构建、候选计算、图谱增量刷新和内存占用，超过预算时必须分页/截断并明确提示。
- **证据路径：** 待补 `docs/verification/WEAK-LINK-RESEARCH-*.md`、`scripts/spike/weak-link-*`、脱敏样本和采纳/延期决策记录。
- **负责人 / 更新时间 / 提交：** `Codex` / `2026-10-11` / 未提交。

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

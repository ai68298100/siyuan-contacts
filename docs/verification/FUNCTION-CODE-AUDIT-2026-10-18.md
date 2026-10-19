# 功能可用性与代码审计（2026-10-18）

本报告核对审计基线与 `fix/audit-20261018` 本地修复后的生产实现、数据契约、任务状态与隔离宿主证据。修复验证只运行虚构数据、内存 Plugin 与拦截的 SDK 传输探针，没有连接或写入日常思源工作区；未推送、未合并、未发布。全量门禁结果由主审计统一记录。

> 主审同日追加的真实环境复核：隔离真实内核实际服务 11/11；原版真实前端驱动首轮 LIMITED，确认为未等资料加载结束的竞态，仅在临时内存驱动补就绪等待后全轮 PASS，含捕获与同源双页面核对。下文“既有证据”矩阵保留子审计取证时点，最新结果见[综合审计](../CURRENT-STATUS-AUDIT-2026-10-18.md)和[检查 JSON](CHECK-RESULTS-2026-10-18.json)，不替代日常用户库/原生编辑器/真机验收。

## 结论

主线功能已有生产接线和测试，不能整体标为“尚未开发”。审计确认的三项事实变更/丢数据缺陷、模板特殊字符替换和农历年龄问题已在当前工作树修复，并新增针对性反例；修复尚未提交、推送或发布，仍需本地审阅后才可进入远程发布。

## 已确认缺陷

### FC-01 / P1：已修复：编辑归档组织成员会把 active 静默改成 former

- 触发：组织原有 active 成员，归档组织后在组织管理中编辑其职位、部门或备注并保存。
- `src/components/org/OrgManagerDialog.svelte:610` 在进入编辑时执行 `editStatus = currentOrg?.archived ? "former" : member.status`，并非从原记录保留状态；`:630` 保存时无条件提交该状态。
- `src/services/org-member-writes.ts:71` 仅在目标状态仍为 active 时核验组织；former 补丁进入 `updateOrgMembership`，`src/domain/org-membership.ts` 的 `applyMembershipPatch` 接受该变更。
- `src/services/org.ts:481` 的归档只改组织标记，保留成员记录。`docs/DATA-CONTRACT.md:540`、`:553` 也明确归档/恢复保留成员事实，因此这个编辑器预填会使恢复组织后成员仍为 former。
- 基线生产服务内存探针：原记录 active，提交 UI 会生成的 `{title:"仅修改职位",status:"former"}`；保存一次后 `afterStatus="former"`、`afterTitle="仅修改职位"`、`fact="verified"`。SDK 全部拦截，没有真实内核请求；投影报告 unknown 不会回滚已保存的状态。
- 修复：编辑初始化沿用 `member.status`；归档组织允许维护既有 active/former 事实，新增、恢复 active 和移入归档组织仍拒绝；`tests/org-member-writes.test.ts` 与三套 UI 475/475 通过。

### FC-02 / P1：已修复：旧模板编辑器全量保存会删除并发新增/恢复的模板

- `src/components/people/TemplateManager.svelte:25`、`:30` 只在挂载时复制模板快照，`:66` 保存整个 cleaned 数组；`src/types.ts:109` 与 `src/index.ts:1387` 的保存接口不传编辑基线。
- `src/data/templates.ts:34`–`:39` 在锁内只验证当前库是否合法，然后直接写入旧快照。锁使操作串行，但没有比较旧基线，也不保留其他窗口新增的模板。
- 基线生产 data 层内存探针：旧编辑器打开时只有 `tpl-base`；`mergeTemplatesStore` 新增 `tpl-new` 后库为 `[tpl-base,tpl-new]`；旧编辑器修改原模板并 `saveTemplatesStore`，库变回 `[tpl-base]`，`lostConcurrentTemplate=true`，共两次内存保存、零内核请求。
- `docs/FEEDBACK-BACKLOG.md:1029` 的验收已要求“并发恢复/编辑模板不丢更新”，当前只修复了 merge 自身锁内合并。
- 修复：保存携带 `expected` 基线，锁内严格比较；冲突零写并保留草稿，未知结果可只读核实，恢复合并不会被旧编辑器覆盖；`interaction-templates` 单测与模板 UI 回归通过。

### FC-03 / P1：已修复：迁移预览隐藏互动墓碑，确认后仍删除互动且不报告删除数

- `src/services/migration-bundle.ts:238` 只有 `events.length>0` 才展示互动模块，忽略纯 tombstones；相对地 aliases 和 orgMemberships 已单独保留墓碑计数。
- `src/components/SettingsView.svelte:1378` 仅预览非空才显示确认按钮；纯互动墓碑包在 `:1390` 被显示为空包，无法通过正常 UI 恢复删除标记。
- 若同一包还有一个可见模块，`:293`–`:301` 会实际合并未在预览显示的互动墓碑，并丢掉 `summary.removed`/`tombstonesAdded`，只返回 `merged`；设置页 `:759` 无从显示此次删除。
- 基线生产服务内存探针：当前一条互动；包内互动 `events=[] / tombstones=[该事件ID]` 加一条模板。预览键只有 `["templates"]`，确认恢复后互动数量从 `1` 变 `0`，结果为 `interactions merged=0`、`templates merged=1`、失败数 `0`，未携带 removed。纯墓碑包预览 `[]`。零内核请求。
- 修复：预览和执行共用 rawStore 严格解析；纯墓碑包可确认，结果返回并显示 `removed/tombstonesAdded`；坏原始快照零写入；迁移单测和 UI 回归通过。

## 附录：其他已复现问题

### FC-04 / P2：已修复：迁移与独立互动恢复的原始快照校验不一致

- `src/services/migration-bundle.ts:119`–`:124` 校验 modules.interactions 时只使用 events/tombstones；`:295`–`:299` 导入时再次丢弃 rawStore。
- 此处不是把任意诊断字段推断为非法输入：`docs/DATA-CONTRACT.md:184` 明确迁移的“互动/跟进沿用各自导出对象”；`:353`–`:354` 明确新版互动备份优先严格检查 rawStore，拒绝损坏快照或未知版本，不以过滤 events 偷换原数据。实际导出 `src/services/migration-bundle.ts:195` 直接解析 `exportInteractionJson`，`:214` 将完整对象装入迁移包；独立恢复 `src/domain/interaction-backup.ts:11`–`:18` 亦实现 rawStore 优先校验。这是两种恢复入口对同一导出对象的契约一致性缺口。
- 基线生产服务内存探针：modules.interactions 保留 `rawStore.schemaVersion=99` 和坏条目，但顶层 events/tombstones 合法。`previewMigrationImport` 与 `importMigrationBundle` 均接受，失败数 0。零内核请求。
- 修复：整包迁移现统一 `parseInteractionBackup`，`rawStore` 存在时作为唯一事实源；坏版本/坏条目先于任何模块写入拒绝。

### FC-05 / P2：已修复：模板姓名中的替换符被 JavaScript 当作替换语法

- `src/domain/interaction-templates.ts:35`–`:39` 把 vars.name 直接作为 `String.replaceAll` 的 replacement 字符串。合法姓名中的 `$&`、美元加反引号等会被解释成匹配/上下文，不能原文保留。
- 基线纯函数反例：`renderTemplate("和{{姓名}}见面",{name:"张$&",date:"2026-10-18",lastInteraction:"无"})` 实际返回 `和张{{姓名}}见面`，期望 `和张$&见面`。
- 修复：模板改为一次扫描并使用函数式替换；`$&`、`$$`、反引号和变量内占位符均逐字保留。

### FC-06 / P3：已修复：农历 BirthdayProjection.age 与“周岁”接口不一致

- `src/domain/occasions.ts:15` 约定 age 为届时周岁，`:117` 却固定用当前农历年减出生年再加 1，没有以实际 occurrence 农历年计算。
- 基线纯函数反例：1990 年正月初一出生，取 2026 年正月初一当天，daysUntil=0，age=37，按接口应为 36。
- 修复：年龄按下一次生日对应的农历年份计算；当天不额外加一，已过生日取下一农历年；回归测试覆盖当天与跨年。

## 功能实现与证据边界

以下“已实现”表示源码与当前调用路径存在；“既有测试”表示仓库有对应验证，不代表本轮重新完成真实宿主验收。真实隔离 browser-desktop 证据与日常用户库、桌面 Electron、原生编辑器竞争和 Android 真机必须分开。

| 功能 | 当前实现/使用判断 | 源码/既有测试 | 已有真实隔离证据与剩余边界 |
|---|---|---|---|
| 初始化/工作空间恢复 | 已实现；非法设置、失联锚点进恢复界面，阻断普通写入 | index.ts:196、services/init.ts、settings-health.ts；init-plan / workspace-recovery / settings-repair* 测试 | 隔离 services runner 有建库与重启；日常库升级、禁用/启用、真实窗口生命周期仍待验 |
| 新建联系人/同名消歧/复用文档 | 已实现；请求与文档绑定分步核实，不按姓名静默合并 | services/contacts.ts:366/389、person-document.ts；duplicate-check / contact-write-services / capture-recovery | 常用主路径已有隔离服务证据；当前 10-17 新交互增量不自动继承日常库验收 |
| 卡片/表格、搜索、筛选、保存视图、批量 | 已实现，完整范围核实与暂停/失败限制有生产逻辑 | services/contacts.ts:95/305/656、domain/contact-search.ts、people-filters.ts、saved-views.ts | 10-17 473/473 是既有隔离 UI 记录；万级/真实低性能设备仍不应标完成 |
| 主资料编辑、补录、QuickFill | 已实现；字段逐项回读、部分失败/未知结果保留 | services/contacts.ts:468/500/509、domain/contact-write.ts、contact-patch.ts；fields / quick-fill / contact-write* | 主资料有隔离真实 UI/服务证据；原生 AV 编辑竞争不具备 CAS 原子保证 |
| 公历/农历生日 | 已实现但有限制；AV date 无法承载某些合法农历月日如 1990-02-30，写前明确拒绝；闰月无独立字段 | domain/person.ts:43-45、occasions.ts、lunar.ts；person / occasions 测试 | 不应称为所有农历生日完全支持；FC-06 为未展示年龄属性问题 |
| 个人备注/旧版拆块恢复 | 已实现；原块/完整正文核实，冲突保留草稿，专用解除关联路径 | services/person-note.ts:42/78/113；person-note / marked-block-write 测试 | 10-17 完整生命周期联合轮有真实 Chrome+生产服务+SQL；原生编辑器并发仍待验 |
| 补充资料、重复名称、两层分组、筛选复制 | 已实现，普通名称/值/顺序/分组；不是正式多联系方式库 | services/person-fields.ts:42/54、api/person-fields.ts；person-fields* 测试 | 10-17 真实隔离 UI、双页面旧基线零覆盖、同名隔离已证；非原生编辑器 CAS/真机证明 |
| 本人身份/换绑/清除/与我的关系 | 已实现；稳定文档/行与参照验证、影响预览 | services/self-identity.ts、people-profiles.ts；self-identity / contact-write-services | 隔离服务与本人 UI 有证据；广泛多窗口/日常库仍待验，不自动按同名修复 |
| 组织资料、模板、成员、历史、移动/接替 | 已实现；JSON 为事实，文档为投影；AG-B13-007 仍 partial | services/org.ts、org-member-writes.ts、organization-writes.ts、org-projections.ts；organization* / org-membership 测试 | 归档后维护既有成员状态已修复并有隔离 UI/服务回归；完整投影/迁移/真机仍待验 |
| 显式人物关系/双链投影 | 已实现；锁内重读，写后核实；文档投影可单独失败/补做 | services/relations.ts、doc-section.ts；relations / native-graph-api 测试 | 普通 Markdown siyuan:// 链接不保证原生 refs 成边；不能把自研 related 当原生图语义 |
| 人物关系图/引用图/文本替代/导出 | 已实现；related/member/ref 分源，成员历史边不等于当前在职 | services/graph-query.ts、api/graph.ts、domain/graph-query.ts、graph-export.ts；graph / native-graph / graph-export | 原生 refs 数据/API 有隔离证据；原生图面板打开通道和移动交互仍 Host pending |
| 手工互动/时间线/共同出席/会前简报/回顾 | 已实现；追加/墓碑删除，场合按稳定 externalRef；手工表单不支持任意历史时间/类型 | data/interactions.ts、services/insights.ts、review-report.ts、domain/briefing*.ts；interactions / insights / date-review / briefing / review 测试 | browser-desktop 互动与重启服务有证据；人工历史互动和类型属于后续契约范围 |
| 首页提醒/节奏/提醒暂缓/行动卡 | 已实现；按本地日期、本人排除、来源错误提示 | services/dashboard.ts、data/cadences.ts、reminder-dismissals.ts；action-list / cadence / reminder-dismissals / occasions | 隔离 UI 有证据；系统通知不是本条实现范围 |
| 跟进/原生任务对账/改期/取消/重开 | 已实现；稳定创建请求、索引/文档分项报告 | services/followups.ts、followup-sync.ts、api/followup-tasks.ts；followup* 测试与 task-item spike | 隔离原生任务块和真实 UI 已证；其他任务管理器互读、全部真实宿主异常路径仍 AG-HOST-003 |
| vCard/笔记本文档导入、暂停/重试 | 已实现；未知结果只核实原请求，字段损失预览存在 | services/vcard.ts、import.ts、import-scan.ts；vcard* / import* 测试 | Issue #35 仍缺原始脱敏小米 VCF，候选解析修复不等于真实根因已验 |
| 导出/迁移包/模块重试 | 已实现；模板并发、互动墓碑和 rawStore 校验已修复 | services/migration-bundle.ts、interaction-import.ts、export-center.ts；migration-interactions-repair / interaction-backup / followup-backup | 迁移包含 12 个自管模块；不含思源原文、AV、偏好、锚点及本地恢复断点。备注/补充资料应随原人物文档备份 |
| 捕获/AI 候选 | 已实现，AI 需配置、发送前明确预检/确认，候选不等于事实 | services/capture.ts、ai-extract.ts、api/ai.ts；ai-preflight / ai-extraction-service / capture* 测试 | 多人捕获真实服务已证；历史真实 browser-desktop 打开来源曾 Uncaught，完整菜单→弹窗→提交仍 Host pending；真实 AI 提供商未证明 |
| 跨插件外部桥 | 已实现；输入/稳定请求/公开错误处理 | services/external-bridge.ts、bridge/external-bridge.ts、domain/external-bridge.ts；external-bridge 测试 | 本地桥实现不等于其他插件/真实消费者端已完成联调 |
| 资料体检/修复/缺列与重绑 | 已实现；严格来源、逐模块失败与预览、补偿断点 | services/health-audit.ts、settings-health.ts；health-audit / settings-repair* | mock/故障注入与隔离内核证据不替代日常库修复验收 |

## 必须标注为未开放、研究或待宿主验收的内容

- 工作台“建议”入口仍禁用，标题已标明尚未开放（`src/components/Workbench.svelte:610`）。
- 正式多号码/多邮箱/多网址、主次/类型/投影/完整搜索与 vCard 多值保真仍属 `AG-RF-004` 研究；当前基础字段仍是 AV 单值。重复“电话”补充条目不能升级宣传为正式通讯录多值闭环。
- vCard 多 TEL 拼成单文本、EMAIL/URL 只取首项；ORG/ADR/PHOTO/NOTE 未映射并在预览列为忽略。CardDAV、OCR/二维码、类型化关系库、地图/日历、复杂推荐等仍是候选，不能由原型按钮推断为已开发。
- 原生图面板打开、Android 真机/软键盘/系统返回、真实用户日常库、原生编辑器同时竞争、真实提供商和桥消费者验收仍需分别留证；补充资料的双页面旧基线回归只覆盖其明确场景。

## 文档一致性

`docs/FIELD-SUPPORT.md:17` 仍写“全页筛选/投影待 B12-002”，而 `docs/DATA-CONTRACT.md:594` 及生产 `services/people-profiles.ts`、`domain/contact-search.ts` 已有组织分类/称谓投影和筛选；当前工作树已将字段支持口径更新为“实现完成、具体宿主验收待补”，避免把已实现功能重复排期。`PAGE-STATUS` 明确保留历史矩阵，不宜直接把其历史 ❌/⚠️ 当作当前缺陷。

本轮最小探针观察值保存为 `docs/verification/FUNCTION-CODE-PROBES-2026-10-18.json`，分别注明生产服务、生产 data 层和纯 domain 层；Plugin 存储均为内存 Map，对外 SDK 已拦截。它们证明相应代码反例，不能充当真实 Plugin 文件存储、Web Locks 多窗口或宿主 UI 验收。

主要宿主证据入口：`docs/verification/REAL-FRONTEND-2026-10-04.md`、`PERSON-FIELDS-REAL-UI-2026-10-17.md`、`PERSON-FIELDS-MULTIWINDOW-2026-10-17.md`、`PERSON-FIELDS-LIFECYCLE-2026-10-17.md`、`ISSUE-051-054-ACCEPTANCE-2026-10-17.md`。上述记录均按其日期与构建范围引用，本轮没有重新运行这些写入型旅程。


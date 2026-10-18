# 2026-10-18 审计修复执行卡

用户已授权开始开发；Issue #35 暂缓，公开样本只作补充研究，不影响本轮修复。范围为本次审计的确定缺陷、UI 一致性、验证驱动与打包流程；正式 contactMethods、在线同步、OCR、原生图/真机等独立研究与宿主条件不在本轮冒充完成。

所有卡的共同前提：保留审计变更，分支 `fix/audit-20261018`；禁止访问日常用户库、发送消息/发布/合并；变更契约先更新 DATA-CONTRACT，使用现有内核端点。字段中的“无”是明确不适用。

## AG-AUDIT-20261018-ORG-UI

- ID / title / status / priority / type / milestone：AG-AUDIT-20261018-ORG-UI / 归档成员语义与 UI 一致性 / done_isolated / P1 / fix / 审计修复。
- user_outcome / user_scenario：归档组织只编辑职位/备注不改变成员状态；窄屏操作可读，未开发能力不冒充导航。
- source_ids / current_evidence：F-01、U-01、UI 子报告；真实组件与内存服务已复现。
- depends_on / blocks / parallel_group：无 / 归档编辑安全验收 / audit-ui。
- preconditions：契约要求归档保留成员事实；三项 P1 已在当前工作树修复，待本地审阅和后续宿主验收。
- allowed_files：OrgManagerDialog、org-member-writes、index.scss、Workbench、相关三个 scoped CSS 组件、LvctDialog、person-panel、对应测试/UI 回归及 UI 规范/原型。
- forbidden_files：版本/发布文档、模板/迁移实现、package、其他代理文件。
- contract_change / host_or_spike_required：不改存储 schema，明确既有归档状态不变；修复使用现有端点，真实隔离宿主由集成轮统一验证。
- ordered_steps：先明确归档编辑契约→修 UI/服务保护→反例回归→收敛窄屏/导航/token→同步原型有意差异。
- test_fixtures / test_commands：active/former、归档/恢复、过期表单、320/390px 明暗；定向单测/UI，最终 check/test/三套 UI。
- acceptance：仅改职位/备注状态不变，新建或 former→active 不可绕过归档限制；按钮不逐字换行，候选导航不占位，原型事实准确。
- failure_retry_rollback：失败保留草稿；冲突零覆盖；投影与事实分报，未知不重发。
- privacy_boundary / performance_budget：虚构数据；不新增外发；无新增全库扫描。
- evidence_paths / owner / last_updated / commit：verification/AUDIT-REPAIR-2026-10-18.md / ui_prototype_audit / 2026-10-18 / dbdc98a。

## AG-AUDIT-20261018-TEMPLATES

- ID / title / status / priority / type / milestone：AG-AUDIT-20261018-TEMPLATES / 模板并发与原文替换 / done_isolated / P1 / fix / 审计修复。
- user_outcome / user_scenario：旧模板编辑窗口不能覆盖其他窗口新增/恢复的模板，姓名特殊字符逐字保留。
- source_ids / current_evidence：F-02、F-04；内存生产 data 层及纯函数已复现。
- depends_on / blocks / parallel_group：无 / 模板可靠保存 / audit-data。
- preconditions：存储 schema 1、Web Lock 与写后回读已有。
- allowed_files：data/templates、domain/interaction-templates、TemplateManager、types/index 中模板接口、interaction-templates 测试及独立新测试、DATA-CONTRACT 的模板段。
- forbidden_files：迁移实现、UI 代理文件、版本/发布文档、package。
- contract_change / host_or_spike_required：先定义 expected 基线/冲突或按意图合并，不改 schema；无需新端点。
- ordered_steps：契约→锁内旧基线校验→传递 UI 基线/保草稿/重读→函数替换→正常/冲突/重试回归。
- test_fixtures / test_commands：两窗口增改删、恢复竞争、损坏/未知库、首次默认模板、$&/$$/占位符；定向 node tests，最终全套。
- acceptance：新模板不丢、过期保存明确冲突且零写；显式删除仍有效；未知保存可核实，变量内容不作为二次模板语法执行。
- failure_retry_rollback：保留输入和旧基线，重读后明确重试；不静默覆盖新值。
- privacy_boundary / performance_budget：内存虚构记录；锁内单次读取/写后验证，不额外扫描人物。
- evidence_paths / owner / last_updated / commit：verification/AUDIT-REPAIR-2026-10-18.md / function_code_audit / 2026-10-18 / 528e300。

## AG-AUDIT-20261018-MIGRATION

- ID / title / status / priority / type / milestone：AG-AUDIT-20261018-MIGRATION / 迁移删除预览与原始快照校验 / done_isolated / P1 / fix / 审计修复。
- user_outcome / user_scenario：纯互动墓碑可预览/确认，恢复只执行已说明的范围，结果明示删除。
- source_ids / current_evidence：F-03、FC-04；纯墓碑与混合包的内存反例。
- depends_on / blocks / parallel_group：无 / 迁移安全验收 / audit-migration。
- preconditions：互动备份已有 rawStore 严格解析器，不能丢弃原始坏快照。
- allowed_files：services/migration-bundle、SettingsView、独立新迁移回归测试/UI、DATA-CONTRACT 迁移/互动备份段。
- forbidden_files：模板实现、contact-write-services 既有测试（避免冲突）、package/版本/发布。
- contract_change / host_or_spike_required：先校准互动删除预览与结果字段/兼容性，不增 schema；无需新端点。
- ordered_steps：契约→共用严格解析→预览计数/墓碑→执行回执→UI 说明→坏包/纯删除/重试回归。
- test_fixtures / test_commands：纯墓碑、墓碑+模板、已删幂等、未知 rawStore 版本、坏当前库、部分失败；定向 node/UI，集成全套。
- acceptance：预览/执行同一对象；结果报告 removed/tombstonesAdded；坏 rawStore 零写；重复导入无额外删除。
- failure_retry_rollback：逐模块失败/未知分开；原请求重试、坏包不写、未确认零写。
- privacy_boundary / performance_budget：内存虚构数据；按既有线性合并，不新增全库扫描。
- evidence_paths / owner / last_updated / commit：verification/AUDIT-REPAIR-2026-10-18.md / github_status_audit / 2026-10-18 / da079af。

## AG-AUDIT-20261018-TOOLING

- ID / title / status / priority / type / milestone：AG-AUDIT-20261018-TOOLING / 验证驱动、打包与集成 / done_isolated / P2 / fix / 审计修复。
- user_outcome / user_scenario：保存驱动等待真实就绪，严格前端失败有失败退出，build 产生同轮 checksum。
- source_ids / current_evidence：CHECK-RESULTS、真实前端首轮 LIMITED 与内存等待后 PASS、本地旧 checksum。
- depends_on / blocks / parallel_group：最终验收依前三卡 / 修复交付 / audit-tooling。
- preconditions：只使用独立 UUID 内核/Chrome；真实 mtime 保留。
- allowed_files：scripts/e2e/frontend-flow、services-flow、scripts/audit-design-tokens、checksum 脚本、package scripts、CI、对应测试与开发/审计状态文档。
- forbidden_files：其他代理产品文件；不得安装到日常库或发布/合并远程。
- contract_change / host_or_spike_required：无业务 schema；真实隔离内核+Chrome 验证。
- ordered_steps：驱动等待→严格退出→跨平台 checksum→扩充 scoped token 扫描→集成回归/截图→状态证据/提交。
- test_fixtures / test_commands：延迟资料读取、LIMITED 严格退出、checksum 一致/错误、全套 check/test/UI/build/release、隔离服务+前端。
- acceptance：正常命令无临时 hook 完整通过，打包与 checksum 一致，官方旧包记录不被当新发布；失败日志可诊断。
- failure_retry_rollback：失败保留证据；只清理拥有的浏览器/进程/靶场；不以重跑掩盖首次失败。
- privacy_boundary / performance_budget：公开合成样本、虚构人物；真实 AI 默认不调用；独立端口和证据。
- evidence_paths / owner / last_updated / commit：verification/AUDIT-REPAIR-2026-10-18.md / root / 2026-10-18 / 5550af6。

# UI 与原型覆盖审计 · 2026-10-18

审计对象：`D:\思源插件\小驴人脉\siyuan-contacts`，审计基线为 `6b52b6f6040f23d129811d83bb2993e9638422e7` / `v0.5.18`。本报告记录基线复现、当前工作树修复和剩余宿主边界；修复尚未提交、推送或发布。

方法：阅读 AGENTS、当前 UI 系统规范、PAGE-STATUS、库内/上级原型，逐一查当前组件与接线；执行当前控件 AST 审计；目检本轮 Chrome 截图；用实际 Svelte 组织管理组件及独立 Chrome 复现一条新增问题。没有连接日常用户库，也没有将内存 facade 证据当作真实内核写入证据。采用 `C:\Users\Admin\.agents\skills\ui-ux-pro-max\SKILL.md` 的键盘、长内容、触控、状态和一致性准则，产品已有决策优先。

## 1. 当前结论

主工作台、联系人、人物详情、图谱、组织、捕获、三种导入路径、设置和初始化均有生产组件和真实 handler，不能继续按 2026-10-04 的旧矩阵认定为骨架或待实现。基线审计确认的成员状态隐式改变和 390px 动作按钮逐字换行均已在当前工作树修复，并通过针对性回归；仍不能写成“所有功能完全符合原型”，因为原型/规范落后于当前实现且有未开放能力和宿主边界，详见第 5 节。

根审计本轮门禁结果：check 0 errors / 0 warnings；单测 756/756；Chrome 桌面、390px、宿主样式各 475/475；截图生成 77/77，含宿主资源。以上是当前本地验证，不能推导日常库、原生编辑器、多窗口、真机或 AI 服务商验收。截图生成成功也不代表所有布局细节通过；基线人工目检发现的 390px 问题已修复，后续仍需按真实宿主继续观察长内容。本轮复跑另发现人物详情相关人选人浮层在窄屏长候选下会因 flex 列表默认最小高度越过视口，已补 `lvct-picker__list { min-height: 0 }` 并在修复后重跑移动、桌面和宿主样式回归。同时补齐公共控件层的 `prefers-reduced-motion` 全面降级：插件根内动画、过渡和滚动行为均静态化，加载旋转不再循环；焦点和按下状态仍保留。

本子审计实际执行 `node scripts/e2e/ui-control-audit.mjs`：40 个 Svelte 文件、803 个控件，无空 handler。3 项 parser 提醒分别是 LvctDialog 遮罩、PeopleView 移动筛选遮罩、PersonCard 选择标签的 stopPropagation；它们均有正常控件/键盘替代，不应直接作为“3 个不可用按钮”。parser 不验证运行时、CSS、宿主和错误请求。

本轮另补齐公共状态层：`ViewState.svelte` 的默认空态与错误/成功/导入/新增语义图标统一使用 Lucide，错误状态使用 `aria-live="assertive"`，普通状态使用 `polite`，加载态保留 `aria-busy` 和骨架层。原有 `b` 标题标签继续保留，以兼容图谱回归选择器。该变更已通过 `pnpm check:svelte`、生产构建、设计令牌审计与 Chrome UI 回归；移动回归在独立运行中为 475/475。

## 2. 基线问题、修复与可复现证据

### UI-20261018-01 · P1 · 已修复：已归档组织中只改成员职位会同时改掉成员事实状态

- 文件：[OrgManagerDialog.svelte](../../src/components/org/OrgManagerDialog.svelte#L601)，重点第 610 行、第 625–637 行。
- 原因：`startEditMember` 对已归档组织强制初始化 `editStatus = "former"`，没有沿用 `member.status`；保存把该值无条件加入 patch。组织归档本身仅修改组织标记，成员记录原样保留，见 [org.ts](../../src/services/org.ts#L481) 与 DATA-CONTRACT 的组织生命周期/历史边界。
- 基线复现：实际 `OrgManagerDialog` 挂载于独立 Chrome，内存 facade 给出 `archived=true`、成员 `status=active`。点“编辑”，仅将职位从“原职位”改为“仅改职位”，点“保存”。输入前事实是 `active`，编辑器状态已变 `former`，提交同时携带 `patch.status=former` 和 `expected.status=active`。这证明了基线 UI 会向写入接口提交未由用户选择的状态变更；没有执行真实内核写入。
- 关键回执：

```json
{
  "before": "active",
  "statusInEditor": "former",
  "submitted": {
    "patch": { "title": "仅改职位", "status": "former", "leftOn": "" },
    "expected": { "title": "原职位", "status": "active", "leftOn": "" }
  },
  "after": "former"
}
```

- 复现脚本：`C:\Users\Admin\AppData\Local\Temp\lvct-archived-ui-audit-20261018.mjs`，退出 0；使用仓库 Vite/Svelte、独立 Chrome profile，结束后已关闭浏览器并清理 profile。
- 当前修复：初始化保留已有状态；归档后“维护既有记录”与“新增/恢复当前归属”分开处理，后两者仍受约束。状态确需变化时由明确操作完成；`tests/org-member-writes.test.ts` 与三套 UI 回归覆盖 archived×active 成员仅改职位/备注及取消零写入。

### UI-20261018-02 · P2 · 已修复：390px 人物详情的“查看互动”逐字显示四行

- 文件：[PersonDetail.svelte](../../src/components/people/PersonDetail.svelte#L1270)、[index.scss](../../src/index.scss#L4207)。
- 基线截图：`scripts/e2e/shots/workbench-peek-mobile-light.png` 与 `workbench-peek-mobile-dark.png`；根审计和本子审计均目检确认。关系摘要左边的长说明挤占右侧动作，按钮文字变成“查 / 看 / 互 / 动”。另一个长人物宿主截图恰好未触发，说明数据/字体差异会影响复现。
- 原因：`.lvct-detail__section-head` 是单行 flex + gap，未给动作 `flex-shrink:0`/`white-space:nowrap`，也没有为窄屏切换行布局。
- 当前修复：内容 `min-width:0; flex:1`，动作保留完整宽度，窄屏必要时独立下一行；桌面、390px、宿主样式和错误动作回归均通过。仍需在真机 320px/软键盘条件下观察，不能只断言无横向溢出。

### UI-20261018-03 · P2 · 当前设计规范/原型多处反映旧功能事实

这组是设计交接与状态标识缺陷，不表示这些生产功能失效。

| 当前文件/位置 | 仍在表达 | 本轮源码事实 | 建议 |
|---|---|---|---|
| UI-SYSTEM-SPEC.md:127 | former 历史成员图边尚未落实 | domain/graph.ts:159–214 已聚合 active/former/mixed；DATA-CONTRACT:687 与 backlog 10-16 也已更新 | 更新为“隔离实现完成，真实宿主/迁移等仍待验” |
| ui-prototype.html:1666 | 敏感字段排除/选段协议仍须实现，仿佛宿主自行读取全文 | CaptureDialog:545–575 已有正文来源、编辑缩小、字段选择、脱敏、最终全文/字节/端点预检；api/ai.ts 只发确认的 msg | 分开标注“已实现预检”和“下游端点/宿主附加上下文待验”；配置化独立服务仍不支持 |
| ui-prototype.html:1657 `org-impact` | 归档会把成员关系改为历史状态、图谱标记已归档组织 | service 仅改组织标记；成员状态保留；归档组织排除当前投影/组织图增强 | 更正归档语义，避免掩盖 UI-01 的隐式状态变化 |
| ui-prototype.html:1664 `membership-restore` | 恢复旧历史关系一定生成新段 | 当前成员编辑可将既有 former 段改 active；“再次加入”才应新建段 | 区分修正原记录与新增经历，明确待办状态，不把两者混成一个按钮 |
| ui-prototype.html:1665 `review-report` | 自定义区间属后续任务 | ReviewReportDialog:249–258 已支持本月/30 天/90 天/自定义 | 自定义区间标当前已有；报表专用导出仍未接 |
| ui-prototype.html:1642–1643 新建/编辑人物 | 组织归属必须跳独立流程、表单不包含组织维护 | AddPersonDialog/PersonEditDialog 已整合多组织选择和逐段经历维护 | 原型补当前多组织与父子窗口流程；事实存储仍独立，不直接写 AV |
| UI-HANDOFF.md:14、UI-SYSTEM-SPEC.md:355 | 10 个产品视图 + 1 规范页 | 库内原型已含独立 orgmgr，为 11 个产品表面 + 1 规范页 | 校正清单，避免漏审组织管理 |

### UI-20261018-04 · P2 · 候选“建议”仍出现在正式侧栏

基线 `Workbench.svelte:606–615` 曾保留“即将推出 / 建议”disabled 占位；它与 UI-SYSTEM-SPEC 第 12 节“候选不出现在当前导航”的当前承诺不一致。当前工作树已移除该正式导航项，并在三套 UI 回归中确认首页/联系人侧栏不再出现候选入口；建议能力仍保持未开放。

### UI-20261018-05 · P3 · 已处理审计覆盖：新 scoped 样式绕过语义令牌

基线曾在 Svelte scoped styles 中发现 15 处直接 `var(--b3-*)` 引用，集中于组织选择和人物编辑控件；当前工作树已将这些引用收敛为 `--lvct-*` 语义令牌，最新扫描为 0 处。审计脚本也已覆盖 Svelte scoped CSS 并生成 `DESIGN-TOKEN-AUDIT-2026-10-18.json`，运行时第三方主题对比仍待宿主验收。

本轮没有复现某一宿主主题下颜色失效，不能将此写为已证实不可读。后续仍应把这 15 处逐步收敛到现有语义 token，再以真实宿主明暗和第三方主题验对比/焦点。

### 待验证风险，不按已复现缺陷计数

`LvctDialog.svelte:35–40` 的 focusables 查询未过滤隐藏元素/折叠 details/负 tabindex，也没有把原生 summary 纳入；当前普通详情末尾还有可见操作，因此不能只据源码断言焦点必然逃出。后续用真实 Tab/Shift+Tab 覆盖只有折叠末尾、动态禁用、嵌套弹窗和焦点恢复；本轮全套既有通过不能替代这个新边界复现。

## 3. 页面、入口和原型覆盖矩阵

“代码可用”指生产组件/服务入口已接，并不等于所有宿主边界验收。页面需在第 2 节问题消化后才可整体宣称符合原型。

| 表面 / 原型 | 当前生产入口与组件 | 已体现的主要流程 | 尚未完成、差异或验收边界 |
|---|---|---|---|
| 工作台外壳 | WorkbenchRoot/Workbench；顶栏/命令/文档事件 | 首页/联系人/图谱/组织/设置；偏好；稳定 ID 请求导航；返回上下文、滚动/焦点恢复 | 未开放建议入口已从正式导航移除；真机系统返回/原生多窗口须单验 |
| 首页 home | DashboardView、QuickStartPanel | 名册/关系/生日/从未联系下钻；今日行动；记录互动；跟进、顺延、暂缓、跳过；交往回顾 | 多模块异常/部分成功有实现，不能因正常截图代表所有错误态；真实任务/原生编辑器边界另计 |
| 联系人 people | PeopleView + PersonCard | 姓名/联系方式/别名/组织/标签查找，保存视图，卡片/表格，列/排序，范围选择，批量编辑/加组织/导出，重复核对 | 核心已接；10k/读取预算与跨窗外部 AV 更新不能仅由小夹具证明 |
| 人物详情 person | 所有业务入口统一 Workbench → LvctDialog → PersonDetail | 居中详情；概览/互动/相关人 Tab；资料/互动/计划/节奏/共同背景；前后人；稳定文档跳转 | 已废弃旧 Peek 目标；手机“查看互动”挤压已修复并通过三套 UI 回归；手动互动类型/历史日期尚无契约 |
| 人物新增/编辑 | PeopleView / PersonDetail / 档案条 | 基础资料、生日、关系称谓、多组织、多段经历、同名消歧、粘贴补录 | 相比原型为增强；只确认的组织事实投影，不能把自定义状态当 active |
| 补充资料/个人备注 | PersonDetail → PersonFieldsEditor | 备注独立块；补充资料重复条目/两层分组/排序/移动/删除/撤销/筛选/复制/冲突重读 | 当前原型未完整体现 10-17 新增交互；补充资料不进全局搜索/快捷联系/vCard/插件迁移包（UI 已说明） |
| 组织列表 organizations | OrgsView | 名称搜索、活跃/归档、Logo/简称/介绍、当前/历史成员概况、管理/编辑/新建 | 组织类型筛选无独立事实字段，不能算已有；筛选结果计数没有完整统一 live 播报契约 |
| 组织管理 orgmgr | Workbench / 人物 / 图谱 → OrgManagerDialog | 定位组织；成员分页/搜索/状态；新增/编辑/结束/移除/移动/接替；改名/归档/恢复/移除；断点核实 | 成员状态隐式改变已修复；原型归档/恢复语义仍需纠正；真实原生多窗口/迁移仍独立 |
| 组织资料窗口 | OrganizationProfileEditor | 名称/简称/介绍/企查查/Logo/部门树/自定义字段/模板安全应用/删除影响和撤销 | Issue #31 桌面管理 900px、资料 920px 是已登记有意差异，不能按旧 720px 机械判失败 |
| 图谱 graph | RelationGraphLoader/RelationGraph | 关系/文档引用模式；画布/同源文本；范围/中心/组织；节点搜索、来源文档、路径/共同/直接/严格二度；导出；六项画布操作 | 真正打开思源原生图面板没有稳定公共通道；引用模式是本插件绘制；former 成员图边已实现，逐段经历从详情回读 |
| 笔记捕获 capture | 笔记右键/命令 → CaptureDialog | 双链识别、AI 显式预检、结构化候选逐项接受/拒绝、确认互动/文档写入、部分/未知 checkpoint 重试 | 正文缩小/发送全文/脱敏已接；下游 AI 服务商、宿主附加上下文和原生入口真实环境待验；不支持后台 Agent 自动写入 |
| 收编 / 导入 import | PeopleView/设置 → ImportDialog/VCardDialog/QuickFillDialog/ProfileCompletionDialog | 思源文档扫描/来源筛选/隐藏选择、vCard 本地预览/逐项写入/未知重试，粘贴字段冲突预览，逐个补录 | 原型为一个联合向导，生产按三个独立入口实现；没有通用多来源映射向导；缺年生日明示不可写；本窗口断点不等于跨会话持久队列 |
| 设置 settings | SettingsView 六分区 | 偏好、品牌头像、本人、锚点/字段、导出/迁移/恢复、体检、组织投影修复、提醒、AI 开关、桥状态、关于 | CardDAV 明示未接；AI 无独立可配置下游端点；桥协议可读不等于全部消费者已验 |
| 初始化 onboarding | WorkbenchRoot → InitWizard / WorkspaceRecovery | 只读预检、复用/新增对象、同名候选阻断、本人可跳过、失败保留断点/继续 | 真实工作区保存/崩溃重开/原生多窗口/真机分开；本轮截图有失败/复用，不是完整真实宿主验收 |
| 文档档案条 docbar | panels/person-panel.ts 的 protyle 事件 | 姓名/分组/生日/互动/跟进、折叠简报、编辑、携稳定人物打开工作台 | 电话/微信/邮箱点击复制与操作反馈已接通；+N 气泡折叠展开已接通；记录互动/添加跟进快捷入口仍待规划 |
| UI 规范 system | 只在 docs/ui-prototype.html | 设计令牌、状态/控件/视觉配方演示 | 非业务页，不应要求安装后出现，也不能当作运行时功能 |

## 4. 弹窗与交互子流程覆盖

| 原型子流程 | 当前组件/接线 | 定性 |
|---|---|---|
| 新建、编辑人物 | AddPersonDialog / PersonEditDialog | 已接；组织资料窗口可在父窗口上方创建并回填 |
| 人物详情窗口/前后人/三 Tab | Workbench / PersonDetail / LvctDialog | 已接；正常居中，旧侧栏 Peek 已被当前决策取代 |
| 互动与模板 | 首页快捷记录 / PersonDetail / TemplateManager | 已接当前时间+可选模板+备注；类型/自由历史日期未支持 |
| 跟进/顺延/跳过/完成/重开 | DashboardView / PersonDetail | 已接；计划与互动分源，不能混用“完成=发生联系” |
| 关系选人/增删/投影补偿 | PersonPicker / PersonDetail | 已接，无类型化关系说明字段；原型 connection 的自由说明不是现有 related 契约 |
| 别名删除确认、账本 | PersonAliases / ExchangeLedger | 已接，详情“更多资料与辅助记录”渐进披露 |
| 导出会面简报 | PersonDetail + briefing-export | Markdown 预览/范围/下载已接；“复制简报”仅设计目标 |
| 保存视图/筛选/列/整理 | PeopleView | 已接；移动独立筛选面板，取消/应用/重置与草稿状态需按真实控制验证 |
| 批量编辑/加入组织/疑似重复 | PeopleView | 已接影响范围、稳定目标、部分结果与失败对象；不做同名自动合并 |
| 新建/编辑组织、部门/字段 | OrganizationProfileEditor | 已接；原型未完整反映模板预览、影响确认、撤销 |
| 添加/编辑/结束/删除成员经历 | OrgManagerDialog / PersonDetail / ContactOrganizationDialog | 已接；编辑既有记录保留原状态；“恢复原记录”与“再加入新段”原型需澄清 |
| 归档/恢复/从插件移除组织 | OrgManagerDialog / OrgOperationRecovery | 已接事实保留/当前投影边界；原型说归档自动变 former 不准确 |
| 捕获识别/确认/结果 | CaptureDialog | 已接，逐项 checkpoint 和未知核实；实际宿主入口/下游 AI 留边界 |
| AI 外发预检 | CaptureDialog / domain/ai-preflight / api/ai | 已接文本预览/字段/字节/取消；独立配置服务未接，下游不由本地夹具证明 |
| 文档收编/扫描/执行队列 | ImportDialog | 已接，来源切换保留已选身份；关闭时说明内存断点边界 |
| vCard 预览/导入/导出 | VCardDialog | 已接本地 .vcf；CardDAV 在线同步未接 |
| 粘贴识别 | QuickFillDialog | 已接本地解析/冲突单选/不写字段禁用；小屏内容高底部 sheet 为代码明确的特殊差异，当前全屏共用规范应登记例外或统一 |
| 资料串行补录 | ProfileCompletionDialog | 已接；缺可选资料不阻断人物使用 |
| 只读体检/影响预览/诊断 | ReviewReportDialog / SettingsView | 已接只读模块/部分故障/重试；修复入口依各模块，不能将“预览”误认一键全修 |
| 备份恢复/锚点重绑/字段修复 | SettingsView / WorkspaceRecovery / OrgProjectionRepair | 已接预览/确认/模块级结果；原生文档备份、原生 CAS 和真实多窗另计 |
| 草稿/忙态关闭 | LvctDialog / close-guard / 宿主 channel | 共用守卫已接；新 focusables 边界仍待针对性验证 |

## 5. 必须继续明确标为未支持或待验的能力

| 能力 | 当前准确标识 |
|---|---|
| 建议/AI 主动经营建议/Agent 写入 | 未开放；正式侧栏已移除候选占位，能力仍不在当前版本 |
| CardDAV/CalDAV 在线同步 | 未接入；SettingsView:1314–1316 与 VCardDialog:350 已明确说明，当前仅本地 .vcf |
| 真正打开/嵌入思源原生关系图面板 | 未提供稳定公共 API 路径；现有“文档引用”是本插件只读 refs 投影 |
| AI 可配置独立服务端点/下游传输保证 | 未实现独立配置；代码仅向 `/api/ai/chatGPT` 发确认全文，下游/宿主附加上下文 host pending |
| 手动互动类型、自由修改历史日期 | 未进入现行手动记录契约，不应由 UI 暗示支持 |
| 关系说明/类型化关系库、跨简历推断弱联系 | 仅候选/研究，生产只维护显式 related，组织/引用不推断亲密度 |
| 补充资料进入全局搜索/快捷联系/vCard/插件迁移 | 尚不支持，PersonFieldsEditor:406 已在产品内说明 |
| 文档条快捷互动/添加跟进入口 | 原型目标尚未完整体现；目前提供电话/微信/邮箱复制、+N 展开与详情/编辑出口 |
| 复制会面简报、回顾报表专用导出 | 原型设计目标或后续范围；自定义报表区间已经实现，不能一并标未开发 |
| 真机、安全区/软键盘/系统返回、原生编辑器竞争与原生多窗口 | 待验；390px/宿主 CSS 与两个 browser-desktop 页面均不能替代 |

## 6. 视觉证据与有意差异

本轮实际目检下列 13 张新截图，文件时间均属 2026-10-18 本轮生成；其他旧截图未冒用为本轮验收。

| 截图（scripts/e2e/shots/） | 本轮观察 |
|---|---|
| workbench-home-desktop-light.png | 首页侧栏、统计、今日行动层级一致；当前版本没有未开放的建议占位 |
| workbench-home-mobile-dark.png | 390px 统计 2×2、底部五导航、页头操作可达 |
| workbench-people-desktop-dark.png | 卡片/表格入口、搜索/范围信息、长标签换行可读；卡片随内容高度 |
| workbench-people-mobile-light.png | 搜索、创建/筛选与卡片触控布局可读；标签横向轨道有渐隐，不是假装无溢出 |
| workbench-orgs-mobile-dark.png | 长组织名/当前与历史数量/卡片操作可读；活跃与归档有文字 |
| workbench-orgmgr-desktop-light.png | 桌面 900px 组织双栏，字段/成员动作可见；这是 Issue #31 有意扩宽 |
| host-workbench-detaillong-mobile-dark.png | 长姓名、职位、邮箱/微信换行，三主操作移到独立行；正常全屏详情 |
| workbench-peek-mobile-light.png | 关系摘要“查看互动”在当前工作树保留完整按钮宽度；文件名 peek 不表示生产仍是 Peek |
| host-workbench-graph-mobile-light.png | 两数据模式、文本/画布、折叠筛选、来源摘要、六动作可见；画布需纵向滚动 |
| settings-mobile-data-dark.png | 六区横向导航、模块说明、未知计数与重试、CardDAV 未接入提示可读 |
| settings-desktop-general-light.png | 通用布局、品牌头像、本人/默认视图与保存状态层级清楚 |
| workbench-quickfill-mobile-light.png | 粘贴识别为内容高底部 sheet，输入/取消/识别可见；应登记共用全屏例外 |
| wizard-failed-mobile-dark.png | 预检复用对象、失败位置、保留成果和继续入口清楚；只证明夹具错误状态 |

原型使用口径：库内 `docs/ui-prototype.html` 才是当前设计基准；`D:\思源插件\小驴人脉\design\lvct-ui-prototype.html` 标题是 v1.0 的旧参考，包含历史 Peek/预留导航/样例布局。不能把当前 720px 人物详情、组织 900/920px 窗口、双模式图和多组织编辑改回旧原型；应把每个差异登记为“当前实现/已废弃目标/有意调整/待修正”，而不是混成一次像素还原。

建议执行顺序：将原型/规范/状态矩阵继续同步到当前事实，登记 QuickFill 和组织宽窗例外；随后补 token scoped 扫描与针对性键盘边界（本轮已加入共享可见焦点收集器，并为选人器补结果播报回归）。所有验证继续分为本地/隔离浏览器/真实隔离内核/原生宿主/日常库/真机，不相互代替。

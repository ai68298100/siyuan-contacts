# 组件目录

本文按 `src/components/` 当前 38 个 Svelte 文件整理。入口组件负责组合页面；页面组件通过显式 props/callback 接入 facade 和服务；可复用组件接收值并通过 callback 通知调用方。精确的 TypeScript 签名以各文件 `<script lang="ts">` 为准，本目录列出主要可变参数，避免复制一份容易过期的完整类型定义。

## 全局行为约定

| 状态 | 常见呈现 | 使用约定 |
|---|---|---|
| 空闲/可操作 | 页面内容和可用操作 | 写入动作由调用方注入；组件本身不直接请求思源内核。 |
| 加载中 | `loading` / `busy` 标记、禁用提交按钮或进度提示 | 写操作提交期间锁定重复提交；读取错误不能降级显示为空数据。 |
| 成功 | 页面内状态提示、结果明细或刷新后内容 | 通过 `onSaved`、`onChanged`、`onImported` 等回调通知上层更新。 |
| 失败/未知 | 可读错误、重试或恢复入口；写入结果未知时保留请求线索 | 未确认成功的写入不应直接重复执行；组织和迁移操作可进入恢复组件核对。 |
| 空结果 | 说明当前没有记录，并提供可执行的创建/导入/筛选动作 | 是否显示空态由页面/弹窗根据查询结果决定；“读取失败”必须与“零结果”区分。 |

多数页面的忙碌态、空态和错误态由页面组件管理，而不是每个子组件都提供同名 props。此表记录当前可观察到的状态，不表示每个数据操作已经具备统一的五态，也不表示空态插图已经全覆盖。未传入可选 callback 时，对应的低频区块或入口会隐藏/降级；新增接线时要验证调用方和回调两端。

## 应用框架与反馈

| 组件 | 用途 | 主要 props / 可变参数 | 状态表现 |
|---|---|---|---|
| [`WorkbenchRoot.svelte`](../src/components/WorkbenchRoot.svelte) | 工作台启动、工作区状态分流和跨窗口数据事件入口 | `facade`、`initialView` | 初始化/恢复/工作台三种分流；失效设置时先退出旧工作台，避免旧配置继续请求。 |
| [`Workbench.svelte`](../src/components/Workbench.svelte) | 导航、首页/名册/组织/图谱/设置视图组合及详情窗口路由 | `facade`、`settings`、`preferences`、`initialView`、`isMobile`、导航/偏好/文档回调 | 当前视图、路由错误、数据变更提示、未保存关闭守卫；人物详情和组织资料使用正常窗口。 |
| [`SettingsView.svelte`](../src/components/SettingsView.svelte) | 通用、数据与字段、提醒、AI 与隐私、服务桥、关于六个设置分区 | `facade`、`settings`、`preferences`、设置/偏好更新回调、`onBack`、可选 `onOpenPeople` | 分区草稿保留、保存中/失败提示、本人身份与数据库恢复状态、导入导出结果；分区切换不直接丢弃草稿。 |
| [`LvctDialog.svelte`](../src/components/LvctDialog.svelte) | 统一模态窗口壳、键盘焦点与关闭路径 | `title`、`description`、`wide`、`modal`、`closeOnBackdrop`、`beforeClose`、`onClose`、`children` | 打开时聚焦窗口；X/Esc/遮罩可由 `beforeClose` 守卫；忙碌或未保存状态由调用方决定是否允许关闭。 |
| [`ViewState.svelte`](../src/components/ViewState.svelte) | 页面级加载、错误、空内容的通用说明容器 | `title`、`description`、`icon`、`loading`、`error`、`compact`、`children` | 按 `loading` / `error` 切换语义；正常内容由 snippet 提供。 |
| [`StatusNotice.svelte`](../src/components/StatusNotice.svelte) | 成功/错误状态反馈，可附后续动作 | `message`、`error`、`onDismiss`、`actionLabel`、`onAction` | 非错误消息仅在传入 `onDismiss` 时 4 秒后调用关闭回调；本组件当前不渲染手动关闭按钮；动作仅在同时传入 label 和 callback 时显示。 |
| [`WorkspaceRecovery.svelte`](../src/components/WorkspaceRecovery.svelte) | 锚点/数据库异常后的检查、重试、重新绑定和重新初始化入口 | `facade`、`workspace`、`onReady`、`onRetry`、`onStartInit` | 扫描、忙碌、恢复结果和错误提示；重试由宿主回调执行。 |
| [`InitWizard.svelte`](../src/components/InitWizard.svelte) | 首次初始化联系人笔记本、数据库与本人档案 | `facade`、`i18n`、`onInitialized` | 目标预览、初始化中、失败位置、可续做断点和完成结果。 |

## 工作台页面

| 组件 | 用途 | 主要 props / 可变参数 | 状态表现 |
|---|---|---|---|
| [`dashboard/DashboardView.svelte`](../src/components/dashboard/DashboardView.svelte) | 首页统计、今日行动、生日/联系提醒、跟进与快捷操作 | `facade`、`settings`、`preferences`、`revision`、`onOpenDetail`、名册/图谱/设置/导入/创建回调 | 数据加载与读取错误、无联系人引导、摘要折叠、快捷操作忙碌/成功/失败、提醒撤销/重试。 |
| [`dashboard/QuickStartPanel.svelte`](../src/components/dashboard/QuickStartPanel.svelte) | 首次使用入口 | `saving`、创建/导入/组织/图谱/设置/关闭回调 | 保存期间锁定关闭/重复动作；关闭结果由偏好保存回调确认。 |
| [`dashboard/ReviewReportDialog.svelte`](../src/components/dashboard/ReviewReportDialog.svelte) | 交往回顾和数据健康报告 | `buildReport`、`buildAuditReport`、`retryFailedAuditModules`、`onOpenPeople` | 报表加载/失败/空结果、审计部分失败及按失败模块重试。 |
| [`graph/RelationGraph.svelte`](../src/components/graph/RelationGraph.svelte) | 人物/组织关系图、只读思源引用投影、同源文本和范围查询 | `settings`、`preferences`、`revision`、`facade`、`onPreferencesChange`、人物详情/名册回调、携带选中 `orgDocId` 的组织回调 | 全端默认大画布（桌面 `clamp(520px, 68dvh, 880px)`；移动 `clamp(400px, 58dvh, 640px)`）与展开/收起，六项画布工具；筛选默认折叠、紧凑计数、图后关系探索/来源诊断；加载/失败重试/空结果、偏好保存失败和导出反馈。来源打开请求期间锁定重复触发，派发完成后提示“已请求打开来源文档”，失败说明原因并允许重试；移动端宿主 API 为同步派发，不能据此确认最终页面已切换。文本与信息卡经 `facade.openDoc` 发起对应来源的打开请求。成员边按 active/former/mixed 生命周期显示当前、历史或混合状态；former 不进入 related 查询。ref 点线是无向投影，无方向箭头；直接打开宿主原生图未承诺。 |
| [`graph/RelationGraphLoader.svelte`](../src/components/graph/RelationGraphLoader.svelte) | 图谱页面的宿主装配适配器，向图谱组件传递 facade、导航与偏好能力 | `facade`、`settings`、`preferences`、`revision`、详情/名册/组织回调 | 静态装配以满足思源单入口 CJS 约束；图谱数据自身仍有加载/错误/空结果与重试状态。 |
| [`org/OrgsView.svelte`](../src/components/org/OrgsView.svelte) | 组织列表、搜索、活跃/归档状态和新建/编辑入口 | `facade`、`revision`、`onOpenOrgManager`、`onCreateOrganization`、`onEditOrganization` | 读取中、错误重试、空组织引导、列表和筛选结果。 |
| [`org/OrgManagerDialog.svelte`](../src/components/org/OrgManagerDialog.svelte) | 组织成员增删改、移动、历史关系和组织状态管理 | `facade`、`initialOrgDocId`、`onOpenPerson`、新建/编辑组织回调、`hostCloseChannel` | 组织/成员加载、逐项写入结果、失败恢复、关闭守卫；成员状态改变不删除历史关系。 |
| [`org/OrganizationProfileEditor.svelte`](../src/components/org/OrganizationProfileEditor.svelte) | 新建/编辑组织名称、简称、链接、Logo、介绍、部门、自定义字段 | `initial`、`mode`、`saving`、`error`、`readOnly`、`onRetry`、`onSave`、`onCancel` | 必填校验、只读待核实、提交锁、错误保留草稿、保存/取消。 |
| [`org/OrgMembershipResult.svelte`](../src/components/org/OrgMembershipResult.svelte) | 呈现组织成员写入及两侧投影结果 | `report`、`i18n` | 按 applied/skipped/failed/unknown 分类；未知或失败项保留后续核对入口。 |
| [`org/OrgOperationRecovery.svelte`](../src/components/org/OrgOperationRecovery.svelte) | 恢复未完成的组织新建/改名操作 | `facade`、`refreshKey`、`disabled`、`onRecovered`、`onBusyChange` | 待核对、处理中、可继续、完成/失败；按原请求断点恢复。 |
| [`org/OrgProjectionRepair.svelte`](../src/components/org/OrgProjectionRepair.svelte) | 预览并修复人物与组织两侧成员投影不一致 | `facade`、`i18n`、`onBusyChange` | 只读预览、逐项修复、结果/失败及关闭守卫。 |

## 联系人、资料与录入

| 组件 | 用途 | 主要 props / 可变参数 | 状态表现 |
|---|---|---|---|
| [`people/PeopleView.svelte`](../src/components/people/PeopleView.svelte) | 联系人卡片/表格、搜索筛选、保存视图、批量选择与补录 | `facade`、`settings`、`preferences`、`revision`、`activePersonId`、`isMobile`、数据与导航回调 | 分页加载、读取失败、零联系人/零筛选结果、批量忙碌/逐项结果、移动端工具收纳。 |
| [`people/PersonCard.svelte`](../src/components/people/PersonCard.svelte) | 名册人物卡片及选择/打开入口 | `person`、`selected`、`active`、`recent`、`orgLine`、`onOpen`、选择/文档回调 | 选中/当前状态；姓名、联系方式、组织摘要可安全换行，缺失头像回退首字。 |
| [`people/PersonDetail.svelte`](../src/components/people/PersonDetail.svelte) | 人物详情概览、互动、相关人、组织、跟进和来源操作 | `person`、`settings`、`facade`、详情子区读取/写入 callbacks、旧备注检查/解除关联 callbacks、`onClose` | Tab 切换；模块独立加载或失败、保留重试；备注就地重读、保留/放弃/取消与最新原文核对；旧分段备注显式解除关联并保留全部原文；按调用能力隐藏不可用区块。 |
| [`people/PersonEditDialog.svelte`](../src/components/people/PersonEditDialog.svelte) | 编辑人物基础资料、组织经历和与本人关系 | `person`、`settings`、扩展资料/关系/成员 callbacks、`onSaved`、`onClose`、宿主关闭通道 | 字段校验定位、加载候选、提交锁、错误保留草稿、未保存关闭守卫。 |
| [`people/AddPersonDialog.svelte`](../src/components/people/AddPersonDialog.svelte) | 新建联系人与可选的组织、本人关系、别名和备注 | `settings`、`initial`、组织/本人候选 callbacks、`onValidateExtended`、`onSaveExtended`、`onCreated`、`onClose` | 姓名/分组校验、补充区折叠、候选读取错误、创建忙碌、保存扩展资料失败提示和草稿保护。 |
| [`people/PersonPicker.svelte`](../src/components/people/PersonPicker.svelte) | 可搜索人物选择器，供本人改绑、关联、跟进等流程复用 | `items`、`value`、`placeholder`、`emptyText`、`searchText`、`clearable`、`disabled`、`onSelect` | 空候选、搜索零结果、选中/清空、禁用；移动输入法场景由外层弹窗焦点管理配合。 |
| [`people/PersonProfileSummary.svelte`](../src/components/people/PersonProfileSummary.svelte) | 资料摘要行 | `profile`、`compact`、`hideEmpty` | 缺资料、完整摘要、紧凑展示；空值可隐藏。 |
| [`people/BirthdayField.svelte`](../src/components/people/BirthdayField.svelte) | 公历/农历生日输入和历法选择 | `value`、`isLunar`、`disabled`、`label`、`onValueChange`、`onModeChange` | 空值/非法日期/可用日期；历法模式直接可选，年份和日期按规则校验。 |
| [`people/GroupField.svelte`](../src/components/people/GroupField.svelte) | 联系人分组选择及自定义分组合法性反馈 | `value`、`availableGroups`、`disabled`、`allowKeep`、`allowClear`、`allowUngrouped`、值/合法性回调 | 预设、自定义、未分组、保留原值、清空和无效值状态。 |
| [`people/PersonFieldsEditor.svelte`](../src/components/people/PersonFieldsEditor.svelte) | 人物原生补充资料：可重复条目、两层分组与独立保存 | `personDocId`、`revision`、`onLoad`、`onSave`、`onOpenDocument` | 严格加载/错误保留、编辑与删除影响预览、保存/未知重试、草稿关闭守卫、外部变化提示；阅读态本地筛选、完整内容复制及独立成功/失败反馈；未接回调时详情隐藏。 |
| [`people/PersonAliases.svelte`](../src/components/people/PersonAliases.svelte) | 别名加载、新增和移除 | `personDocId`、`onLoad`、`onAdd`、`onRemove`、`onChanged` | 加载/失败/空别名和保存忙碌；删除先展示含具体别名与影响说明的可取消确认，确认期间锁定重复操作，失败后保留确认项供重试。 |
| [`people/RelationshipLabels.svelte`](../src/components/people/RelationshipLabels.svelte) | 维护人物与“我”的关系称谓 | `personDocId`、`revision`、`onLoad`、`onSave`、`onChanged` | 读取/失败、编辑草稿、冲突核对、保存结果与关闭守卫。 |
| [`people/ExchangeLedger.svelte`](../src/components/people/ExchangeLedger.svelte) | 往来账本条目及结清状态 | `personDocId`、`onLoad`、`onCreate`、`onChangeStatus` | 列表加载/错误/空结果、录入忙碌、金额/日期校验和状态更新结果；创建输入含 requestId。 |
| [`people/TemplateManager.svelte`](../src/components/people/TemplateManager.svelte) | 互动备注模板增改删 | `templates`、`onSave`、`onClose` | 草稿、保存中、保存失败保留内容、关闭守卫。 |
| [`people/QuickFillDialog.svelte`](../src/components/people/QuickFillDialog.svelte) | 将识别结果映射为人物资料补丁 | `existing`、`initialResult`、`onApply`、`onClose` | 候选预览、字段冲突、选择后应用；不自动覆盖未确认冲突字段。 |
| [`people/ImportDialog.svelte`](../src/components/people/ImportDialog.svelte) | 导入思源联系人文档/笔记 | `settings`、`onImported`、`onClose` | 扫描、映射、重复核对、队列执行、逐条成功/跳过/失败和关闭守卫。 |
| [`people/VCardDialog.svelte`](../src/components/people/VCardDialog.svelte) | vCard 导入/导出 | `settings`、`onImported`、`onClose`、宿主关闭通道 | 文件选择、预览、重复/无效项核对、导入结果与导出反馈。 |
| [`people/ProfileCompletionDialog.svelte`](../src/components/people/ProfileCompletionDialog.svelte) | 按调用方名单逐人补充资料 | `settings`、`people`、`scopeLabel`、`onSaved`、`onClose` | 当前人物、加载/提交、失败留在原项、完成计数；范围由调用方提供。 |

## 捕获及 UI 配套

| 组件 | 用途 | 主要 props / 可变参数 | 状态表现 |
|---|---|---|---|
| [`capture/CaptureDialog.svelte`](../src/components/capture/CaptureDialog.svelte) | 从当前笔记预览人物并记录共同经历，含 AI 预检入口 | `facade`、`docId`、`onClose`、宿主关闭通道 | 读取/失败重试、三步预览、AI 请求前确认/取消、候选确认、写入结果和部分失败。 |

## 复用与变更规则

- 新增或改动 props 时同步更新本目录相应行，并优先复用 `LvctDialog`、`ViewState`、`StatusNotice`、`PersonPicker`、`BirthdayField` 和 `GroupField`。
- `facade` 是 UI 与服务/宿主能力的边界；Svelte 组件不应绕开服务层直接调用思源 API。
- 组件内部状态只服务当前生命周期；订阅、定时器和浮层关闭清理应在组件销毁时完成。
- 视觉令牌以 [`src/style/_tokens.scss`](../src/style/_tokens.scss) 为准；桌面与移动页面原型见 [`ui-prototype.html`](ui-prototype.html)，真实实现和真机验收范围不要从原型示意推断。
- 状态组件使用图标/骨架而非全站空态插图。逐操作覆盖情况仍需结合 [交互回归](UI-REGRESSION.md) 和相应源码核对，不可仅凭此目录推定完全满足统一五态要求。

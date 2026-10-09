# 个人 CRM 与 CardDAV 细节对标补充（2026-10-09）

本报告用于补充现有 `CARDAV-RESEARCH-2026-10-09.md` 与 `CONTACT-UX-RESEARCH-2026-10-09.md`，重点关注联系人详情、互动、提醒、组织、同步设置以及低风险 UI 改进。

## 官方产品对照

| 产品 | 官方资料 | 可借鉴细节 | 当前插件的适用边界 |
| --- | --- | --- | --- |
| Monica | [Manage templates](https://docs.monicahq.com/user-and-account-settings/manage-templates)、[Vault dashboard](https://docs.monicahq.com/vaults/dashboard) | 联系人可以按模板组合模块；首页集中显示最近更新、未来提醒和未完成任务 | 可用于联系人详情的模块显隐和工作台摘要；模板只控制本地展示，不参与 CardDAV 字段同步 |
| Dex | [Reminders](https://getdex.com/docs/workflows/reminders)、[Get Started](https://getdex.com/docs/get-started) | 区分固定日期提醒和 Keep-in-Touch 周期提醒；周期提醒由最近一次有效互动重新计算 | 可拆分“事件提醒”和“联系节奏”；打开详情不应自动延期，只有记录互动才更新周期 |
| Cloze | [Keep in Touch](https://help.cloze.com/article/1849-keep-in-touch)、[Contact details](https://help.cloze.com/article/1872-how-do-i-get-more-details-about-a-contact) | 根据关系类型/分组设置联系周期；联系人档案统一展示互动、笔记、会议和待办；支持单联系人关闭提醒 | 可增加关系类型默认节奏、联系人级暂停/恢复；邮件、短信、社交数据采集不应作为当前插件默认能力 |
| Clay/Mesh | [Reconnect for Groups](https://library.clay.earth/hc/en-us/articles/16466506366107--Reconnect-for-Groups) | 按群组设置每周、每月、每季度或每年节奏，每日只推荐少量联系人；近期已互动的人不重复提示 | 可用于组织/标签级联系节奏和每日建议上限；建议先做确定性规则，不引入静默外部数据采集 |
| Nextcloud Contacts | [Contacts](https://docs.nextcloud.com/server/latest/user_manual/en/groupware/contacts.html) | 多值电话、邮箱、地址；联系人可属于多个组；生日可进入独立生日日历；只读地址簿不能修改 | 电话、邮箱和网址最终应支持多值；CardDAV 地址簿应保留只读状态；生日提醒属于本地行动，不等同于同步字段 |
| Radicale | [Radicale v3](https://radicale.org/v3.html) | 多地址簿、独立 vCard 资源、认证/TLS、集合发现和增量同步，适合本地测试 | 可作为首个兼容性测试服务器；每张卡片需按远端 UID/href/ETag 绑定，不按姓名合并 |
| DAVx⁵ | [Accounts and collections](https://github.com/bitfireAT/davx5-manual/blob/main/accounts_collections.rst)、[Introduction](https://github.com/bitfireAT/davx5-manual/blob/main/introduction.rst) | 账户→地址簿分层；每个地址簿单独启停；支持自动/手动同步、只读地址簿和重新发现；本地账户与 CardDAV 账户分离 | 设置页应采用账户→地址簿→策略三级结构；区分“刷新地址簿”和“同步联系人”；只读是编辑限制，不替代服务器权限 |

## 可立即落地的低风险 UI/UX

### 1. 人物概览的关系摘要

在现有概览中集中显示已有事实：

- 最近互动日期；
- 未完成跟进数量；
- 当前联系节奏（跟随默认、自定义周期或已暂停）；
- 相关人物数量；
- CardDAV 同步状态（未配置、正常、待上传、冲突、远端已删除待确认）。

摘要只投影已有数据，不复制互动正文，也不自动推断关系亲疏。空态应提供“记录互动”“新建跟进”“设置联系节奏”等入口。

### 2. vCard/同步边界预览

导入、导出和未来 CardDAV 首次同步前，使用两张清单：

**将同步/导入：** 姓名、昵称、选定的电话/邮箱/地址、单位/职位、公历生日、用户明确勾选的标签或公开备注。

**不会同步/导入：** 组织任职历史、关系图、互动、跟进、提醒、本人标记、AI 内容、思源文档/块 ID、私密备注和同步元数据。

多值电话、邮箱、地址应逐条显示数量和类型；若当前版本只能保留主值，预览必须显示“其余值将被忽略”，不能静默合并为一串文本。农历生日应显示“标准 vCard 无统一农历语义，其他客户端可能只看到公历换算值或忽略扩展”。

## 提醒与互动的交互口径

| 操作 | 应改变什么 | 不应改变什么 |
| --- | --- | --- |
| 记录互动 | 新增互动事实，更新最近互动，按规则重算联系节奏 | 不自动完成无关跟进，不修改联系人基础资料 |
| 完成跟进 | 将计划标记为完成 | 不等同于发生互动，不自动更新最近互动 |
| 稍后处理 | 只修改该事项的下次到期时间 | 不删除原事项，不改变联系周期 |
| 跳过本次 | 跳过当前周期实例 | 不关闭未来周期，不删除历史互动 |
| 暂停联系节奏 | 停止未来周期提醒 | 保留联系人、历史互动和现有跟进 |
| 恢复联系节奏 | 按当前规则重新计算下一次提醒 | 不补发被暂停期间的提醒 |

这组文案能避免把“完成计划”和“已经联系”混为一谈，也是 Dex/Cloze 的核心交互经验。

## 暂不直接引入的能力

- 自动抓取邮箱、社交平台和消息记录：依赖外部账号、后台运行和隐私授权，当前插件不应默认开启。
- AI 自动判断关系变冷或自动修改联系周期：应先显示建议，由用户确认后再改变本地设置。
- 团队负责人、商机、交易、销售漏斗：属于商业 CRM 结构，不适合直接并入当前个人关系模型。
- 将互动、提醒、组织历史写入 vCard `NOTE` 或普通字段：会污染其他客户端，且往返同步容易丢失。
- 把“同步成功”作为“最近互动”：CardDAV 只同步通讯录资料，不代表用户与联系人发生交流。

## 推荐顺序

1. 先统一人物概览摘要、提醒按钮语义和 vCard 边界预览。
2. 再实现多值电话/邮箱/地址与地址簿级同步策略。
3. 然后增加固定提醒与联系周期提醒的分离、标签/组织级节奏和每日建议上限。
4. 最后再评估系统通知、外部来源和可解释的智能建议。

## 第二轮官方资料补充（2026-10-09）

### Google Contacts：重复处理与多标签

- [合并重复联系人](https://support.google.com/contacts/answer/7078226)：提供重复建议、逐条/全部合并和拆分已合并联系人。建议导入后增加“重复候选”队列，展示匹配依据和字段差异，合并前逐字段确认，合并历史支持撤销。
- [标签与联系人分组](https://support.google.com/contacts/answer/30970)：标签可多选、批量添加/移除，并用于筛选。建议将标签与组织/联系人列表分开建模，标签只负责筛选与批量操作。

### Outlook People：预设视图和上下文

- [People 页面](https://support.microsoft.com/en-us/outlook/what-is-the-outlook-people-page)：提供常联系、今天日程、收藏和可能需要跟进等预设视图，详情侧栏聚合邮件、文件、会议与组织上下文。建议首页增加可配置智能视图，详情页保留统一的关系摘要入口。
- [分类、旗标和提醒](https://support.microsoft.com/en-us/outlook/training/set-categories-flags-or-reminders)：分类用于组织，旗标表示待处理，提醒包含时间；三者不应合并。建议跟进模型分别保存内容、提醒时间、完成状态和互动事实。

### Cloze：周期提醒和可筛选时间线

- [Contact Timeline](https://help.cloze.com/article/3006-the-contact-timeline)：把邮件、电话、短信、会议、笔记等集中到时间线，并支持按活动类型筛选。建议后续支持“全部/互动/笔记/跟进/字段变更”筛选，显示来源和时间。
- [Keep in Touch](https://help.cloze.com/article/1849-keep-in-touch)：联系周期可以按关系阶段和分组配置，互动后重新计算。建议支持全局默认、关系类型覆盖和联系人级暂停。
- [清理 Keep-in-touch 提醒](https://help.cloze.com/article/1858-how-do-i-clear-a-keep-in-touch-reminder)：跳过只影响本次，全部静音会停止未来提醒。建议提醒动作明确区分“完成本次、稍后、跳过、暂停”，并解释对未来提醒的影响。

### Monica：详情模板和关系事件

- [联系人功能](https://www.monicahq.com/en/features/)：联系人档案可以管理关系、重要日期、活动和自定义信息。建议继续把联系人属性、关系、互动活动、提醒拆开存储，在详情页聚合显示。
- [联系人模板](https://docs.monicahq.com/user-and-account-settings/manage-templates)：通过模板、页面和模块控制详情展示。当前可预留“个人/客户/合作伙伴”等联系人类型模板，先控制显示，不改变底层数据。

## 第二轮低风险落地建议

1. P0：重复候选预览、字段冲突确认、合并撤销；提醒动作语义统一；时间线筛选入口。
2. P1：预设视图（最近互动、待跟进、已逾期、收藏）；标签多选和批量操作；联系周期快捷值。
3. P2：联系人类型模板、关系网络和项目上下文；来源与隐私标记。
4. 暂缓：自动抓取外部消息、AI 自动改周期、静默合并；这些能力需要额外授权和可解释性。

这些建议只依赖现有本地数据模型，可以先做界面和交互，继续保持 CardDAV 与 vCard 字段边界清晰。

# 更新日志 / Changelog

所有显著变更记录于此。格式参考 Keep a Changelog；版本号遵循语义化版本。

## [0.2.0] 候选（candidate）— 2026-09-28

自 v0.1.0 以来的 16 项增量功能，按主题分组。详细实现与验收证据见 [PROGRESS](PROGRESS.md)。

### 查人与整理

- **新增 统一导出中心**：设置「数据」集中导出全量名册 vCard 与互动事件 JSON，显示数量并明示备份边界。（F01）
- **新增 联系人显示偏好**：卡片/表格默认形态、表格列显隐与顺序持久化；「姓名」列固定显示。（F02）
- **新增 组合筛选**：标签全部/任一、最近互动日期范围、从未联系；生效条件可视、可逐项清除。（F03）
- **新增 保存常用视图**：命名保存筛选与排序，应用时按当次名册重新求值；支持改名/覆盖/删除。（F04）
- **新增 疑似重复人物检查**：按规范化电话/邮箱与同名给候选与理由，并排资料、只提示不合并。（F13）

### 主动联系闭环

- **新增 跟进事项**：日期型联系计划，支持语义化推迟（明天/三天后/下周一/一个月后/指定日期）、完成、取消与重开；完成不自动写互动。（F05）
- **新增 按人物联系节奏**：为个人覆盖久未联系阈值或暂停提醒，仅影响首页提醒、不写数据库字段。（F06）
- **新增 今日行动清单**：生日、联系节奏与跟进事项三源按人聚合，一人一卡多原因徽标，逾期可批量顺延到今天。（F07）
- **新增 打开工作台关注摘要**：当日摘要横幅（数量与行动清单同源），可当日不再展示；不发送宿主通知。（F08）

### 记录与回顾

- **新增 互动记录模板**：内置见面/电话/聚会模板，支持 `{{姓名}}` 等本地变量；应用不覆盖草稿、不自动提交。（F09）
- **新增 互动日期回顾**：日期范围、最近 30/90 天快捷项、按月分组与「历史上的今天」。（F10）
- **新增 会面简报 Markdown 导出**：资料、最近互动、未完成跟进、重要日期、相关人物与共同出席，预览与下载一致。（F11）
- **新增 交往回顾报表**：按月/自选区间的互动次数、同场活动数、联系人数、来源分布、Top 排行与上期对比，口径可解释。（F12）

### 导入与迁移

- **vCard 导入诊断**：逐项三段报告单（成功/跳过/失败/待核对），重试前先核对名册，不重复建人。（F14）
- **互动备份差异明细**：合并前按事件预览将新增/将跳过与删除标记影响，人物不可达显式标注。（F15）
- **关系查询结果导出**：路径链式呈现并可导出 Markdown 说明，含图规模、筛选条件与范围免责。（F16）
- **重复检查**（见 F13）与**图谱结果导出**（见 F16）同属 D 批整理与迁移主题。

### 其他

- 首页/图谱/报表/详情/档案条/捕获向导/初始化向导等接入双语键表（zh-CN 与 English，423 对，parity 守门）。
- 设置页「关于」版本号动态化；移动端与桌面隔离回归持续扩展。

### 范围与边界

- 实际宿主、真机与实际多窗口验证按作者要求跳过，未计为通过；详见 [RELEASE](RELEASE.md) 手工验收表。
- 服务层失败原因与原生确认弹窗文案以中文为主（已知限制）。

## [0.1.0] — 2026-09-27

首版发布：联系人管理（含存量笔记收编）、关系图谱、相关人物双链区块、农历生日提醒、从笔记捕获（含 AI 抽取）、人物文档档案条、`window.LvContacts` 人员服务桥。

### English summary (0.2.0 candidate)

16 incremental features on top of v0.1.0: export center, display preferences and saved views, combined filters, duplicate checking, follow-ups, per-person cadences, today action list, opening summary, note templates, interaction date review ("on this day" included), briefing Markdown export, interaction review report, vCard import diagnosis with roster-checked retry, backup diff details, and graph result export — all local-first, explainable, and covered by isolated browser/unit tests. See [PROGRESS](PROGRESS.md) for details.

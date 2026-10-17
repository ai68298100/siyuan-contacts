# 文本保存与条目建议复核（2026-10-16）

本复核覆盖 Issue #52、#53、#54（人物备注及自由文本保存）、Issue #51（多条目与母子条目建议）和 Issue #46（历史成员图谱）。本轮只收口已确认的保存缺陷与文档口径；联系人多联系方式和自定义层级暂不扩展生产数据模型。

## 结论

人物备注的原问题已经按“单段落、单标记、严格回读”的契约收口。`custom-lvct-person-note-format="2"` 标记块通过 DOM 文本编码保存，换行、Markdown 字符、HTML 字符和看似 IAL 的文本均作为文本回读；重复块、未知形状、文档失联、写后不收敛和响应丢失都进入未知/重试路径，不按空备注覆盖。人物详情在保存迟到、切换人物或产生新草稿时不会用旧响应覆盖当前草稿。

模板模块存在同类的静默丢失：编辑器可新增超过 50 条，保存服务原先通过 `normalizeTemplates` 截断后仍返回成功。当前已增加写入专用校验：超过 50 条、重复 ID、非法条目、现有坏库或合并后超限均明确拒绝，原库和草稿保留；达到上限时 UI 禁止新增并说明原因。关闭守卫的“保存并离开”会重新抛出保存错误，失败后弹窗保持打开。模板多行、Markdown、IAL 文本通过 JSON 原样保存和读取。

组织资料的 JSON 服务已经有严格读取、锁内写入、写后回读和版本校验。编辑器提交前现在会阻止“有内容但没有名称”的部门/自定义项，避免原先 `.filter(item => item.name/label)` 把用户输入静默丢掉。组织介绍、部门说明、自定义字段值仍作为资料存储，不混入 AV 主库。

其他自由文本路径按现有契约核对如下：

| 入口 | 事实源与保存链 | 结果 |
| --- | --- | --- |
| 人物备注 | 人物文档标记块 → `readPersonNoteBlocks` / `upsertPersonNoteBlock` → 严格解析与回读 | 已收口；重复/未知形状显式阻断 |
| 互动备注 | `interaction-events.json` → 锁内追加、写后回读；界面提交前去首尾空白 | 可持久化；不与人物备注共用标记块 |
| 跟进标题 | `follow-ups.json`，同步原生任务行；换行按任务行契约折叠为空格 | 有意的单行投影，不是保存失败 |
| 组织介绍/部门说明/自定义字段 | `organization-profiles.json`，schema 1，严格校验 | 可持久化；无名但有内容的条目现在保存前报错 |
| 组织经历状态/备注 | `org-membership.json`，`statusLabel` 1–40 字、`note` 1–240 字单行 | 可持久化；清空按字段补丁处理 |
| 往来账本说明/备注 | `exchange-records.json`，写前整体校验、锁和回读 | 可持久化；坏库拒绝覆盖 |
| 互动备注模板 | `interaction-templates.json`，全量保存/合并 | 已修复超限静默截断；上限明确拒绝 |
| 捕获场合备注 | 互动 JSON 事实 + 场合/日记/地点 Markdown 投影 | 备注事实不丢；投影仅生成受控链接和日期文本 |

## Issue #51 / #54 的最小产品方案

建议把“同一联系人多个联系方式”和“母子条目”拆成两个后续契约，避免把层级字段直接塞入现有 AV 列。

第一张卡应先做 `contactMethods` 列表：

```text
contactMethods: [{
  id, type: "phone" | "email" | "wechat" | "qq" | "url" | "custom",
  value, label?, isPrimary, source?, createdAt?, updatedAt?
}]
```

`id` 是稳定身份；`label` 用于“工作/私人/备用”等显示；每种类型最多一个 `isPrimary`。现有 AV 的电话、邮箱、微信、网站列继续作为兼容主值投影，读取旧数据时生成稳定迁移 ID，写入新列表时只把主值投影回旧列。旧版本和无列表数据仍可读。搜索、筛选、联系人详情、批量编辑、备份恢复和 vCard 导入导出必须逐项定义边界后再实现：vCard 的多个 `TEL`/`EMAIL` 保留为多条，单值旧导出只导出主值；导入重复值进入预览和人工确认，不按姓名或值静默覆盖。

当前 vCard 实现已经能识别多个 `TEL`，但把它们拼成一个带 ` / ` 的旧 `phone` 字符串；多个 `EMAIL` 只取首个，序列化也只输出一个 `TEL` 和一个 `EMAIL`。这属于现有单值 AV 模型的明确限制，不能把拼接字符串当作多联系方式契约；迁移卡必须先定义拆分、标签、主值和往返保真后再改。

母子条目应另建 `customFields` 结构，首版只允许两层：

```text
customFields: [{ id, label, value, parentId: string | null, order }]
```

`parentId` 只能指向同一联系人内的顶层条目；禁止循环、悬空父项和无限递归。删除父项必须预览子项影响，排序使用显式 `order` 和稳定 ID；不按显示名称当身份。旧 AV 字段不自动改成任意层级，导入/迁移先生成顶层条目。建议先做纯域契约、迁移预览、导出/恢复和搜索设计，再开 UI 实现卡。

不建议首版把联系人方法、组织经历、互动、跟进、人物备注统一为一个“条目树”。它们的事实源、权限、生命周期、同步边界和隐私含义不同；统一后会带来删除语义、备份冲突、vCard 映射和查询索引的组合风险。

## Issue #46 历史成员复核

当前实现已保留 `former` 成员边：`graphRegistry` 接收历史成员，`buildOrgAugmentation` 按人物和组织稳定 ID 聚合 active/former，混合状态显示为 `mixed`；画布分别使用当前、历史、混合样式，导出显示生命周期，`related` 查询不消费 member 边。定向图谱、导出、成员测试共 55/55 通过。真实双窗口、原生图面板和真机仍需宿主队列验收，不能由隔离测试替代。

## 定向验证

- `node --test tests/person-note.test.ts tests/interaction-templates.test.ts tests/i18n.test.ts tests/graph.test.ts tests/graph-export.test.ts tests/org-membership.test.ts tests/organization-profile.test.ts`：81/81 通过。
- `LVCT_UI_FILTER='备注模板|管理模板弹窗' node scripts/e2e/ui-smoke.mjs`：Chrome 隔离 UI 6/6 通过，包含 50 条上限、保存失败保留草稿、取消不关闭和多行文本回读。
- `pnpm check`：TypeScript 与 Svelte 检查 0 错误、0 警告。

本报告不代表真实思源工作区、跨窗口、原生图或真机验收已完成；这些仍应按 Host Queue 单独记录。

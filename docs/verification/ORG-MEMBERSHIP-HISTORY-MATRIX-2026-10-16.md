# 组织成员历史口径矩阵（2026-10-16）

该矩阵配套 D-0037，用于在进入下一轮运行时扩展前核对同一成员事实在各模块的显示和查询口径。

| 场景 | 成员事实 | 当前组织/人物投影 | 自研关系图 | related 查询 | 迁移/体检 |
| --- | --- | --- | --- | --- | --- |
| active work | 保留稳定 membership ID，`status=active` | 活跃组织未归档时显示 | `member` 当前边 | 不进入 related | 原样保留 |
| former work | 保留原 ID、结束日期和备注 | 当前投影移除，历史详情保留 | `member` 历史边 | 不进入 related | 原样保留 |
| active education | 保留分类和期间 | 显示“就读” | `member` 当前边 | 不进入 related | 原样保留 |
| former education | 保留分类和期间 | 当前投影移除，历史详情显示“已毕业/离校” | `member` 历史边 | 不进入 related | 原样保留 |
| 自定义状态 | `statusLabel` 只改显示文案 | 不改变 active/former 当前性 | 边仍按生命周期标注 | 不进入 related | 原样保留 |
| 多段历史 | 多个 former membership ID，可与一条 active 并存 | 当前投影只取 active | 同组织同人合并，快照只留聚合状态；人物/组织详情回读原段落 | 不进入 related | 不自动合并 |
| active + former 并存 | 两类事实均保留稳定 membership ID | 当前投影只取 active，历史详情保留 former | 同一 member 边标记 `mixed`；两类原始经历由人物/组织详情回读 | 不进入 related | 原样保留，不按状态猜测合并 |
| 组织归档 | 组织事实保留，成员不删除 | 当前投影和图谱组织节点均退出 | 不生成 member 边 | 不进入 related | 归档属性由宿主事实保存 |
| 人物不可达/重复 | 成员记录保留并报告未知 | 不投影 | 不生成边 | 不影响 related | 迁移逐项跳过并报告 |

最小回归夹具：active→former、former→active、工作/学校双组织、多段历史、active+former 混合边、同日状态转换、缺日期、日期倒挂拒绝、归档组织、悬空人物、备份恢复和图谱范围切换。隔离回归覆盖 active/former/mixed 成员边标签、文本/Markdown 状态和 related 隔离；真实双窗口、原生图和真机仍由 Host Queue 验收。

## 2026-10-16 契约复评结论

复评基线为 v0.5.16（`4372593`）。D-0037/0038 与 DATA-CONTRACT §8/§9 对现有模型的约束一致：沿用 schema 1，以 `status`、`affiliationKind`、`statusLabel`、期间和备注分别表达当前性与显示信息；无需新增枚举或结构迁移。当前投影只取未归档组织 active，member 边保留 active/former/mixed，related 查询不消费 member 边。

定向执行 `node --test tests/graph.test.ts tests/graph-export.test.ts tests/org-membership.test.ts`：55/55 通过。发布前完整门禁为 597/597 单测、桌面/移动/宿主样式 UI 各 381/381；发布和后续 CI 记录以 [RELEASE](../RELEASE.md) 为准。

| 核对项 | 证据 | 结论 |
| --- | --- | --- |
| 当前单位与历史分离 | `src/services/org.ts#buildOrgDisplayByPerson`、`scripts/e2e/ui/organization-health-regression.js` | former 不回退到当前单位 |
| 多段边状态与稳定去重 | `src/domain/graph.ts#buildOrgAugmentation/orderGraph`、`tests/graph.test.ts` | 同组织同人聚合，保留生命周期 |
| 文本、导出和查询边界 | `src/domain/graph-query.ts`、`src/domain/graph-export.ts`、`src/components/graph/RelationGraph.svelte`、`tests/graph-export.test.ts` | 同一快照展示状态，related 单独查询 |
| 历史期间核对 | `src/domain/health-audit.ts`、`tests/org-membership.test.ts` | 现有体检覆盖重复与非法期间；任意区间重叠检测未交付，保留原段落供人工核对 |

契约与隔离实现收口不改变整卡 `partial` 状态。实际存储/迁移回读、真实双窗口、原生图、真机及 1 万段性能证据仍待补；不据定向单测宣称这些验收完成。

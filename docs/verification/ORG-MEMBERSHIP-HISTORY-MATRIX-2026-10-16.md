# 组织成员历史口径矩阵（2026-10-16）

该矩阵配套 D-0037，用于在进入下一轮运行时扩展前核对同一成员事实在各模块的显示和查询口径。

| 场景 | 成员事实 | 当前组织/人物投影 | 自研关系图 | related 查询 | 迁移/体检 |
| --- | --- | --- | --- | --- | --- |
| active work | 保留稳定 membership ID，`status=active` | 活跃组织未归档时显示 | `member` 当前边 | 不进入 related | 原样保留 |
| former work | 保留原 ID、结束日期和备注 | 当前投影移除，历史详情保留 | `member` 历史边 | 不进入 related | 原样保留 |
| active education | 保留分类和期间 | 显示“就读” | `member` 当前边 | 不进入 related | 原样保留 |
| former education | 保留分类和期间 | 当前投影移除，历史详情显示“已毕业/离校” | `member` 历史边 | 不进入 related | 原样保留 |
| 自定义状态 | `statusLabel` 只改显示文案 | 不改变 active/former 当前性 | 边仍按生命周期标注 | 不进入 related | 原样保留 |
| 多段历史 | 多个 former membership ID，可与一条 active 并存 | 当前投影只取 active | 同组织同人合并显示，详情保留段落 | 不进入 related | 不自动合并 |
| active + former 并存 | 两类事实均保留稳定 membership ID | 当前投影只取 active，历史详情保留 former | 同一 member 边标记 `mixed`，详情不丢两类事实 | 不进入 related | 原样保留，不按状态猜测合并 |
| 组织归档 | 组织事实保留，成员不删除 | 当前投影和图谱组织节点均退出 | 不生成 member 边 | 不进入 related | 归档属性由宿主事实保存 |
| 人物不可达/重复 | 成员记录保留并报告未知 | 不投影 | 不生成边 | 不影响 related | 迁移逐项跳过并报告 |

最小回归夹具：active→former、former→active、工作/学校双组织、多段历史、active+former 混合边、同日状态转换、缺日期、日期倒挂拒绝、归档组织、悬空人物、备份恢复和图谱范围切换。隔离回归覆盖 active/former/mixed 成员边标签、文本/Markdown 状态和 related 隔离；真实双窗口、原生图和真机仍由 Host Queue 验收。

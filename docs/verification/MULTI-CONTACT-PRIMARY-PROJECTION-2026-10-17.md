# 主值删除、零主值投影与解绑差异纯研究（2026-10-17）

对应 `AG-RF-004-D3D4-P`、D3/D4、Issue #51/#54。本轮只做纯 Node 合成状态机，不连接 Kernel、Plugin 存储、真实 AV 或生产契约；没有修改生产代码、`DATA-CONTRACT.md`、版本或发布文件。

## 为什么需要这项增量

已有证据覆盖范围不同：

| 证据 | 已覆盖 | 本轮仍需补齐 |
|---|---|---|
| S2 严格快照与恢复模拟 | 通用严格校验、墓碑不复活、陈旧确认和零写预览 | 没有主值投影规划器，也没有把显式删除和解绑建模为不同事件 |
| L1 双 AV 联合生命周期 | 真实隔离内核中主方法缺失、名册解绑、重绑和回读事实 | 没有冻结“零主值是否清空投影”、墓碑和陈旧 AV 冲突的纯契约 |
| L2 人物身份门禁 | 同名替换、owner/itemID 冲突、旧源不可达和缺页拒绝 | 没有主值选择/删除后的投影状态机 |

因此本轮只验证上述交叉边界，不重复删除/移动宿主端点，也不宣称生产可写。

## 冻结的研究规则

1. 每个人物、每种类型最多一个 `primary=1`。显式切换只能选当前已观察到的方法，并把同类型其他方法置为非主值。
2. 显式删除主方法只产生该方法的墓碑；不自动把次方法晋升为主值。删除后该类型的投影目标是空字符串。
3. 解绑只撤销名册资格，保留人物方法和历史，不生成墓碑；解绑人物禁止继续投影。
4. 投影前必须比较当前 AV 与最后已核实的 AV 基线。两者不一致即 `conflict`，包括即将清空主值的情况，保持零写入。
5. 零主值、未知基线、身份缺失和重复墓碑均不能被当作空成功；需要重新预览或报告拒绝。
6. 同一方法 ID 一旦有墓碑，不得在活跃集合中再次出现。

## 结果

脚本 [`contact-methods-primary-projection-research.mjs`](../../scripts/spike/contact-methods-primary-projection-research.mjs) 运行 **21/21** 纯断言通过，覆盖：

- 主值切换、跨人物隔离及单主值约束；
- 删除主值后保持零主值，不自动晋升次方法；
- 零主值的空投影需新鲜 AV 基线并显式确认；
- 显式删除与解绑的差异（墓碑/方法保留/投影资格）；
- 墓碑阻止旧方法复活；
- AV 外部改值导致陈旧投影冲突，清空也不能绕过；
- 未知基线、未知替代方法、重复主值/墓碑和人物缺失的零写拒绝。

脱敏结果见 [`contact-methods-primary-projection-results.json`](../../scripts/spike/contact-methods-primary-projection-results.json)，固定标记为：

```text
syntheticOnly=true
kernelRequests=0
productionChanges=false
candidateContractAccepted=false
writeAllowed=false
tombstoneAllowed=false
projectionWrites=0
D1Adopted=false
```

默认运行、`--dry-run`、`--import` 和 `node --check` 均通过；`--dry-run`/`--import` 不写结果文件。结果只包含固定虚构 ID、状态、原因和计数，不含真实联系方式。

## 仍未证明的边界

本轮没有验证真实 AV/原生文档编辑、删除或移动端点、跨窗口 CAS、持久墓碑、卸载恢复、用户确认界面、两页面并发或 D1 事实源选择。`ready-for-explicit-confirmation` 只是研究计划状态，不能解释为已执行投影。Issue #51/#54 继续开放，正式 D3/D4 仍需在 D1 选型和宿主证据后另立生产契约。


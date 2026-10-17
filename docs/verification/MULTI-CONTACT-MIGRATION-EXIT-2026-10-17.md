# D6 旧值迁移、备份与版本出口纯研究（2026-10-17）

对应 `AG-RF-004-D6`、Issue #51/#54、D5/D6。本文只记录纯 Node 合成研究，不连接 Kernel、不读取插件存储、不改生产契约、不写入生产版本或发布文件。

## 研究范围

脚本 [`contact-methods-migration-exit-research.mjs`](../../scripts/spike/contact-methods-migration-exit-research.mjs) 构造虚构人物、方法、互动和墓碑记录，模拟旧值迁移预览、迁移包严格解析、确认前重算、备份覆盖和跨版本出口。结果见 [`contact-methods-migration-exit-results.json`](../../scripts/spike/contact-methods-migration-exit-results.json)。

旧 AV 单值仍保留为一个值；值中出现 ` / ` 时仅生成待确认的拆分建议，预览 `writes=0`，不能把分隔符当成事实边界。确认必须重新读取并比较预览基线；当前状态发生变化则返回 `stale`，保持零写入。

## 契约草案

| 场景 | 研究规则 | 结果 |
|---|---|---|
| 未知包/模块版本 | 只接受明确的 bundle/module schema；未知版本或未知模块在预览前拒绝 | `blocked`，零写入 |
| 缺模块 | 缺省表示该模块未随包提供，不等于空列表 | `omitted`，保留当前模块 |
| 当前库损坏 | 当前快照 schema、数组、身份或字段不完整时停止 | `current-corrupt`，零写入 |
| 重复身份 | 包内同模块重复 ID 整体拒绝，禁止静默去重 | `duplicate-identity` |
| 同 ID 内容冲突 | 当前记录优先，保留冲突诊断；不被旧包覆盖 | `conflict/current-wins` |
| 旧值迁移 | 旧单值保持一条；` / ` `仅提示拆分，必须逐项确认 | 预览零写 |
| 确认前变化 | 用当前严格快照摘要重算并比较冻结基线 | `stale`，零写入 |
| 墓碑 | 当前墓碑 ID 阻止旧记录复活 | `tombstone-no-resurrection` |
| 人物不可达 | 只认稳定人物 ID；不可达人物不按姓名或值恢复到其他人 | `person-unreachable-no-name-recovery` |
| 断点 | 投影/组织操作/桥/修复/本人建档 checkpoint 不进入业务备份，也不跨库重放 | `checkpointWrites=0` |

备份候选覆盖 `people`、`methods`、`interactions` 和 `tombstones`；断点文件明确列入排除清单。跨工作空间时仍需显式 ID 映射，未知或未映射对象保留待核对，不能由姓名、电话或邮箱猜测身份。

## 纯检查结果

运行命令：

```text
node --check scripts/spike/contact-methods-migration-exit-research.mjs
node scripts/spike/contact-methods-migration-exit-research.mjs
node scripts/spike/contact-methods-migration-exit-research.mjs --dry-run
node scripts/spike/contact-methods-migration-exit-research.mjs --import
```

默认、`--dry-run` 和 `--import` 均通过；默认结果为 **20/20**。覆盖旧值单值/分隔符预览、未知版本、未知模块、缺模块、坏库、重复身份、同 ID 冲突与幂等、零写预览、确认前重算、现状优先、墓碑不复活、人物不可达不按姓名恢复、checkpoint 排除、非法模块/记录及确定性重试。

结果固定为：

```text
kernelRequests=0
productionChanges=false
candidateContractAccepted=false
writeAllowed=false
checkpointWrites=0
tombstoneResurrection=false
D1Adopted=false
```

默认命令只写本 spike 的结果 JSON；`--dry-run` 和 `--import` 只在内存中运行检查，不写结果文件，也不写任何生产文件。

## 尚未证明的边界

本轮没有验证真实 `loadData/saveData`、Web Lock、跨窗口快照、真实 AV/原生人物文档、压缩/文件系统错误、跨工作空间 ID 映射执行、真实导入 UI 或用户确认交互；没有形成生产 migration codec，也没有决定 D1 事实源。真正实现前必须把本草案落入 `DATA-CONTRACT.md`，再按“契约 → domain/normalize → data/storage → service → UI → host”顺序拆卡。Issue #51/#54 继续开放。

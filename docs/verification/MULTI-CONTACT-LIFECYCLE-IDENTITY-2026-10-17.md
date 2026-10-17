# 多联系方式人物生命周期身份门禁纯研究（2026-10-17）

对应 `AG-RF-004-L2`、Issue #51/#54、D3/D4。本文只记录纯 Node 合成观察规则，不连接 Kernel、不读取插件存储、不改生产契约，也不执行人物文档删除或移动。

## 研究范围

本轮固定两个虚构人物文档 ID：旧文档 A 与同名新文档 B。方法行、文档 SQL 行、名册官方映射、原生渲染绑定、冻结目标和解绑历史都由脚本内构造。姓名和联系方式值只作为脱敏占位，不能参与身份认领。

“旧文档被删除”或“被移动”没有调用任何 API。脚本只构造以下观察快照：旧文档 SQL 行缺失、文档根/笔记本不一致、父块位置变化、方法 owner 缺失或非法、分页不完整。所有这些状态都保留为 unknown 或冲突诊断，不能升级为用户删除意图。

身份门禁只接受 `docId`、`methodId`、`sourceKey` 和 `itemID` 的一致观察。诊断结果固定为不可写：

```text
writeAllowed=false
tombstoneAllowed=false
projectionWrites=0
productionGuardImplemented=false
D1Adopted=false
historicalCompleteness=false
```

## 纯检查结果

运行入口为 [`contact-methods-lifecycle-identity-research.mjs`](../../scripts/spike/contact-methods-lifecycle-identity-research.mjs)，结果为 [`contact-methods-lifecycle-identity-results.json`](../../scripts/spike/contact-methods-lifecycle-identity-results.json)。16/16 检查通过：

- 同名新文档不会继承旧文档的方法；旧文档方法仍按 ownerDocId 留在旧身份下，新文档只能读取自己的方法。
- 同值跨人物仍保留不同 methodId，姓名和值不能合并身份。
- 解绑后复用旧 itemID 仍使冻结目标失效；新 itemID 重绑同样拒绝旧目标。
- 旧文档行不可达但方法源仍存在时，报告 `owner-unreachable-or-unknown`、`source-remains-with-unreachable-owner` 和 `unknown-not-delete`，不清空方法、不生成墓碑、不投影到新文档。
- owner 缺失、非法或方法源不完整时，整个集合保持 unknown，不能按同名或值猜归属。
- 父块位置变化只报告 `owner-location-changed` 和 `location-change-not-a-delete-proof`，不把移动推断为删除，也不自动换 owner。
- owner 与 methodId 冲突、重复 methodId、官方映射与原生行不一致、缺页和已知行缺失均拒绝可写集合。
- 相同观察重新计算后拒绝原因稳定，自动重试、身份修复、投影和墓碑写入均为 0。

## 安全与执行边界

脚本默认运行只写本轮结果 JSON；`--dry-run` 和 `--import` 均运行纯检查但不写结果。模块被导入时没有自动执行。脚本没有 `fetch`、Kernel 路由、端口、子进程、插件存储或生产文件访问。

本轮没有复用隔离内核，因为删除/移动 API 未经本任务需要且不应猜测。未来若单独补宿主观察，只能复用已验证的建文档、AV 绑定/解绑、映射、渲染、SQL、flush、重启端点，使用新 UUID 临时工作区和逐请求 ownPID；不能调用或猜测 `deleteDoc`、`moveDoc`、`moveBlock`。

## 尚未证明的边界

本轮只证明身份门禁和拒绝规则，不能证明真实用户删除、真实文档移动、持久 tombstone、CAS、卸载后恢复、UI 编辑、原生多窗口竞争或 D1 事实源选择。D3 的正式删除预览、主值选择与墓碑，D4 的原生编辑冲突和旧入口兼容，仍需独立契约与宿主证据；Issue #51/#54 继续开放。

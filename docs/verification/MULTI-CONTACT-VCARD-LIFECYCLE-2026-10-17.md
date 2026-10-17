# vCard 方法生命周期与来源身份研究（2026-10-17）

对应 `AG-RF-004-S1-LIFE`、D7、Issue #51/#54。本轮是纯 Node 合成研究，不改生产 parser/serializer、数据模型、存储、AV、UI 或版本文件，也没有 Kernel/API/插件存储请求。它补充 S1 的多值映射结果，专门观察方法编辑、删除、新增、重排、重复值和未知属性在导出再导入时的身份与损失边界。

## 运行协议

脚本为 [contact-methods-vcard-lifecycle-research.mjs](../../scripts/spike/contact-methods-vcard-lifecycle-research.mjs)，结果为 [contact-methods-vcard-lifecycle-research-results.json](../../scripts/spike/contact-methods-vcard-lifecycle-research-results.json)。默认运行写入这一个研究结果文件；`--dry-run` 只执行检查并打印摘要，不写结果文件；import 只提供函数，不自动运行。所有卡片、值和标签为虚构值，结果只保留摘要、哈希、来源序号和类别，不保存完整联系方式。

研究格式在每个支持属性前保存候选方法 ID 和来源属性/序号，作为纯研究 lineage。它不是生产 vCard 扩展，也不代表外部地址簿会保留这些标记。默认导出只输出已支持方法；`includeUnmapped` 才保留未知属性原逻辑行。语义回环与原始文件字节回环分别记录，不能混为一个结论。

## 合成场景与结果

两张虚构卡片包含同值跨卡电话、电话/邮箱/网站、TYPE/PREF 参数和一条 `X-ABLabel` 未映射属性。第一张卡按顺序执行：

1. 修改电话值和标签，要求原方法 ID、来源属性和来源序号不变；
2. 显式删除邮箱，生成 `deleted` loss 项，不能由旧导出自动复活；
3. 新增邮箱，生成不与旧方法冲突的新 ID；
4. 反转顺序，方法 ID 与来源 lineage 不变；
5. 复制电话值，保留两个独立 ID，并报告 `duplicate-value-visible`；
6. 默认导出/导入，再用 `includeUnmapped` 导出/导入，分别核对支持方法和未知原逻辑行。

脚本共 18 项检查，全部通过：

- 编辑保留 ID 与 lineage；删除进入可见 loss；新增 ID 不冲突；重排不改变 ID。
- 同值跨卡不合并；同卡重复值也逐条保留并单独报告。
- 默认导出再导入保留支持方法；未知 `X-ABLabel` 不会静默变成支持方法。
- `includeUnmapped` 导出再导入保留未知原逻辑行；未知项仍是研究报告中的 unmapped。
- 空值、控制字符、重复 ID、同类型多个 `PREF=1` 均拒绝；不自动修复、合并或分配身份。
- `syntheticOnly=true`、`kernelRequests=0`、`productionChanges=false`、`candidateContractAccepted=false`；`byteRoundTripVerified=false`、`externalInteropVerified=false`、`uiVerified=false`。

脚本结果中的 `rawValuesOmitted=true`，完整值只存在本次进程内，用于哈希比较，不写入结果文件。该保护只适用于本研究结果，不是生产日志脱敏契约。

## 可以采纳的研究事实与边界

这轮支持把“方法身份”和“当前值”分开：改值、改标签和重排不能凭当前值重新认领；同值跨卡不能合并；删除和未知项必须在 loss/unmapped 中可见；新增方法必须显式生成新身份。默认导出丢弃未知属性时，损失必须显式报告；需要保留未知原文时必须选择 `includeUnmapped` 类似的显式出口。

这不是完整 vCard codec，也没有证明 RFC 字节保真、参数排序/折行/字符集/外部地址簿互操作、真实导入界面、生产存储、方法库事实源、主值投影、备份恢复或跨窗口并发。候选 lineage 标记不能直接写入生产模型；任何生产采纳仍需正式 D7 契约、真实宿主输入、损失确认和迁移/恢复规则。

`AG-RF-004-S1-LIFE` 已收口为 `done_isolated`，父卡 `AG-RF-004` 继续 `candidate`，Issue #51/#54 保持开放。Chrome 恢复后仍优先执行 `AG-RF-004-N2-HOST-UI-COPY`；D1、D3/D4 正式删除/主值规则、D6 备份出口和真实 UI/并发门禁不因本轮纯研究改变。

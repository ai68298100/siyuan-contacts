# 原生联系方式编辑器格式与复制身份研究（2026-10-17）

对应 `AG-RF-004-N2`、Issue #51/#54。本实验只有纯 Node 内存模型和虚构值，没有调用内核、浏览器、真实插件存储或真实用户工作区，没有修改生产模型、AV、迁移、vCard 和发布文件。父卡 `AG-RF-004` 保持 `candidate`；N2 纯研究阶段为 `done_isolated`，完整宿主验收仍为 `host_pending`，由后续 `AG-RF-004-N2-HOST` 单列证据。

本轮真实 UI 控制通道不可用，因此没有为以下任何 N2 候选补做真实编辑器证据。N1 已观察到真实编辑器折叠多行正文，见 [原生编辑器 UI 探针](MULTI-CONTACT-NATIVE-UI-2026-10-17.md)。那批 UI 夹具使用 `ui-*` 方法 ID，没有通过 N1/N2 的严格 `method-{hash}` 解析；它证明编辑器行为，不能证明严格候选格式能够被编辑器稳定保留。

## 三种候选及明确边界

| 候选 | 可见正文与修改方式 | 本实验结果 | 未证实部分 |
| --- | --- | --- | --- |
| `n2-single-json-v1` | 单个物理行：`联系方式：{"类型":"电话","标签":"工作 / 主线","主值":false,"值":"第一行\n第二行"}`；字符串只解码一次 | 九类特殊值精确往返；模型删除物理换行时正文和值不变 | 真实编辑器可能转换 Markdown、反斜杠或属性；单行只是候选，未证明编辑器稳定 |
| `n2-editor-multiline-v1` | 类型、JSON 转义标签、主值和独立 `值：` 头；值保留原始换行；专门编辑器在确认且完整快照未变后生成提案 | 九类值精确往返；专门编辑提案保留身份；模型折叠多行后返回未知，不能写 | 未实现专门编辑器 UI、宿主写回和写后回读；纯解析器无法识别仍满足格式的自由修改来源 |
| `n2-sealed-multiline-v1` | 同样的多行可读正文，另有正文 SHA256；不接受自由改写后正文 | 未改动正文可读；折叠和正文改写均可见拒绝，不自动重封 | 摘要不是权限签名；外部写入者可重算摘要；未证明真实宿主正文或摘要属性稳定 |

单行 JSON 使用固定字段顺序和规范序列化，拒绝额外字段、重复键、非法转义、非字符串值、意义与属性不一致，以及非规范的自由排版。严格限制有意把不确定改写显露为未知，不能据此声称普通 JSON 编辑体验已可用。空值可见拒绝，空标签可保留；LF、CRLF、TAB、Unicode 行分隔符、引号、反斜杠、字面 `\n`、双重反斜杠、Markdown、emoji、首尾空格和伪造头文本均按原值往返。其他 C0/C1 控制字符、孤立 surrogate 和越界值拒绝，不静默清理或截断。

## 身份、完整性与显式采纳

严格候选身份沿用研究规则：`method-{sha256(owner + ':' + sourceKey)[0:24]}`，`owner` 是合法人物文档 ID，`sourceKey` 是显式稳定来源键。解析时只校验已有身份，不分配身份，不按值、姓名、顺序、现有数组位置或块 ID 推测新身份。

`readDocument` 输入是**已选出的候选方法块全集**，不是人物文档的全部块。普通正文筛选、被去掉全部标记的方法发现以及真实宿主的完整枚举没有实现。返回 `scope=selected-candidate-method-blocks-only`、`scopeDiscoveryVerified=false`；`complete` 与 `writeAllowed` 只针对该合成输入范围，`enumerationComplete=true` 也只是夹具声明的已核实前提，不能作为生产枚举实证。

在这个范围内，只要一块未知、重复或冲突，整体就是 `complete=false`、`writeAllowed=false`、`methods=[]`。可接受块只提供 `diagnosticAcceptedCount`，不能被调用者误当全量方法列表或当作删除依据。缺枚举证明、部分枚举、未知格式/属性、缺 marker、错误 ID、错误 owner/source、正文和 Markdown 不一致、同块多方法、多主值和读取形状错误都阻止整体写入。空且声明已完整枚举的范围可返回空全量，实验不自动生成删除墓碑。

复制身份反例固定为：

- 同人物原始复制保留方法身份，报告 `duplicate`。
- 跨人物复制仍保留原 owner，报告 `conflict`。
- 改成目标 owner 却复用旧方法 ID，报告 `unknown`。
- 改 source 复用旧 ID，同样报告 `unknown`。

显式采纳不自动处理这些错误。用户需要先用合法的源载荷生成预览，预览绑定源内容、完整目标快照、目标 owner、新 source、新块 ID、候选格式和原值。取消、未确认、确认预览变化、目标读取不完整、目标第三值或删除竞争、已有 source/块 ID 和同类型主值冲突均零身份分配、零提案、零自动修复。同类型已有主值时本研究直接拒绝，未实现自动切换或隐式取消主值。

仅显式确认与预览一致，且目标完整快照再次回读一致后，`adopt` 才分配候选新身份并返回提案；没有执行原生写入。矩阵分别采纳了同人物和跨人物复制，验证新 ID/source、目标 owner 和完整特殊值。同请求在当前有界内存会话中沿用原身份，不再次返回可写提案；调用者报告写结果未知时只返回原身份，不改 ID 重发。当前会话还阻止不同请求以相同 owner+source 或相同块 ID 在旧快照上生成重复提案。

这些规则不构成持久恢复协议。`sourcePayload` 只是通过纯解析的内存载荷，没有重新读取 `sourceNow` 或证明源块实际仍存在；已有请求的内存提案复用也不表示重新核实了当前目标。请求结果未知由调用者提供，既没有探测真实写结果，也没有防住改用新 request 和新 source 绕过、进程重启或跨窗口会话。完整快照最后回读之后仍有竞争窗口，没有锁/CAS、原子写、迟到写处理或写后核实。上述缺口只能保留为未验证，不能把内存 guard 宣称为宿主防重保证。

## 可复跑结果

入口：[contact-methods-native-editor-research.mjs](../../scripts/spike/contact-methods-native-editor-research.mjs)；结果：[contact-methods-native-editor-research-results.json](../../scripts/spike/contact-methods-native-editor-research-results.json)。脚本导出纯函数并使用 main guard；独立审查可 import，import 不执行矩阵或写结果文件。只有作为脚本执行且全部断言通过，才写自己的研究结果 JSON。

```text
node --check scripts/spike/contact-methods-native-editor-research.mjs
node scripts/spike/contact-methods-native-editor-research.mjs

total 123, passed 123, failed 0
syntheticOnly=true, hostVerified=false, status=host_pending, candidates=3
identityAllocations=5 (explicit adoption proposals only), automaticRepairs=0, nativeWrites=0, kernelRequests=0, browserCalls=0
```

矩阵覆盖三候选各九类值、空值/控制字符/坏 Unicode、双重转义、重复 JSON 键、未知字段、坏转义、意义不一致、`ui-*` 旧夹具、四种复制身份、不完整读取及有效子集屏障、主值冲突、专门编辑确认/取消/第三值、封存正文拒绝、采纳预览变化、目标读取错误/重复/第三值/删除、身份碰撞、容量上限、当前会话未观测提案的拟合并和不同 owner 的同类型主值。边界为每个合成范围至多 128 块、每值 8192 个 UTF-16 单元、每标签 256 单元，非大库成本结论。

本轮纯研究可得结论仅为：三种候选在明确有界的内存模型中可把精确值往返或不确定改写转成可见拒绝，聚合读取和采纳屏障不会把已知坏项隐藏成全量成功。后续独立 [N2-HOST 隔离内核报告](MULTI-CONTACT-NATIVE-EDITOR-HOST-2026-10-17.md)已对有效身份的单行候选完成两种传输、四组文本的写读和重启：DOM 4/4、Markdown 2/4 严格接受，Markdown 另两组被宿主转换而拒绝。该结果只支持 DOM 传输的小样本候选继续验证，不回填为本报告内存矩阵或真实 UI 通过。可用 Chrome 通道中的真实输入、复制、粘贴、重载和双窗口仍待验证；任何 N2 方案均未获生产采纳。

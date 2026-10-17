# N2 有效候选原生编辑与完整块 Copy/Paste 验收准备（2026-10-17）

对应 `AG-RF-004-N2-HOST-UI-COPY`、Issue #51/#54。本文件冻结下一轮真实 UI 的操作、回读与判定要求；当前状态为 `host_pending`，不是已执行结果。

本轮通过 CUA `getState()` 再次确认仅有 Codex In-app Browser 与 Codex MCP Apps，均无页面，没有 Chrome 控制面。没有运行真实编辑器、读取剪贴板或执行 Copy/Paste，也没有为本 UI 阶段启动 Kernel 或写入夹具。现有 N2-HOST 的 API 证据和静态 bundle 路径不能替代本卡。

## 有效基线和范围

使用新 UUID 隔离工作区、随机回环端口、全虚构人物和值；每个内核请求核实本轮持有 PID，禁止连接日常工作区。浏览器只操作本轮新建 Chrome 页面。控制面不可用时保留本卡，不通过外部 CDP、IAB、合成 ClipboardEvent、直接 DOM 或 Kernel 插块模拟 UI 通过。

复用 N2 的 `fixtureMethod`、`encode`、`parseBlock`、`readDocument`，格式固定为 `n2-single-json-v1`。方法 ID 必须满足现有研究 hash 规则，owner/source/正文/属性一致。通过 N2-HOST 已实证的安全实体转义 DOM 路径建立夹具；这一步是 API 准备，不计为真实 UI 保存或粘贴。

两个虚构人物分别保存可明确枚举的小样本；每个 UI 旅程使用独立基线，防止前一次改值或重复块污染后续判断。至少包含普通值、实际 LF/TAB/反斜杠/引号、Markdown/HTML 与首尾空白。先严格读取源块，确认 `accepted`、预期原值精确相等，且受控候选范围没有未知、重复或冲突。

每次保存独立 SQL 原始行 `id/root_id/parent_id/type/content/markdown/ial` 和直接子块列表。不能只读取仍带 marker 的块；根据基线和直接子块的前后差异核对新旧块。范围仅为本轮明确受控候选，N3 已证明丢失全部特征后无法据此保证历史全集。源/新块不明确、发生未知范围变化或读取失败时，记录不完整，不向读取器虚报 `enumerationComplete=true`。

属性适配只沿用 N2-HOST 已有规则：IAL 实体解码一次，必要时移除精确匹配的终端 IAL 行；保留原始字段。不互相代填 content/markdown、不按 Markdown 语义反解正文、不放松解析器。

## 操作与判定

| 旅程 | 必须留存的事实 | 判定要求 |
| --- | --- | --- |
| 基线 | Chrome 目标人物与源块可见；SQL 和直接子块已核对；N2 严格读取结果 | 源块 `accepted`，完整受控候选范围可核对；没有基线则停止后续旅程 |
| 原生编辑 | 在编辑器修改 JSON 中的值，使用正常保存路径；保留 UI 与 SQL 前后状态 | 按原样 N2 结果记录接受或拒绝，不要求宿主必须保留候选格式 |
| 完整块复制 | 打开源普通块菜单、展开父 Copy，触发其子菜单内层完整块 Copy | 仅菜单可见或点击父项不算复制；实际路径根据当前页面重新确认 |
| 同人普通 Paste | UI 出现新块；新旧原生块 ID、方法属性和正文都回读 | 若方法 ID 保留且两个块均可严格解析，N2 聚合报告 `duplicate/method-id`；不得分配新方法身份 |
| 跨人物普通 Paste | 新块出现在乙人物；回读真实 root/parent、旧 owner/source/方法 ID | 若旧 owner 保留且正文有效，N2 报告 `conflict/owner-or-parent`；不得自动改写 owner 后接受 |
| 宿主改写或丢属性 | 保留实际新块与原始字段，不按期望补属性 | 按实际输入记录 `unknown/marker`、`unknown/identity-or-attributes`、`unknown/block-shape` 等；不能用旧 N1 的错误码替代 N2 实际报告 |
| 正文折行或富文本转换 | content 与 markdown 独立比较，保存 N2 原样报告 | 单行候选可报告 `single-line-boundary`、`single-json-*` 或更早的 `block-shape`；不得把可见正文当作精确往返成功 |
| 重新打开及重载 | 重新加载文档后重读全部受控源/新块，重新运行同一读取器 | 复制事实、原值和接受/拒绝结果一致；差异记录为失败或未知，不自动重发粘贴 |

任何 unknown、duplicate、conflict 或不完整范围，聚合结果必须 `complete=false`、`writeAllowed=false`、`methods=[]`；保留诊断数量和每项原因。该屏障只验证研究读取结果，不授权修改生产列表、主值、墓碑或投影。

若 Chrome 可被动观察本轮原生 copy/paste 事件，可记录 `text/siyuan`、`text/html` 的 `data-siyuan` 及 MIME 类型，观察器不改变默认事件；只保存虚构夹具，不读取其他系统剪贴板内容。载荷只是补充，不能替代新持久块的 UI 和 SQL 证据。静态路径依据见 [COPY 静态复核](MULTI-CONTACT-NATIVE-COPY-2026-10-17.md)。

## 证据出口与停止

后续独立 results 至少包含本轮 UUID/版本、工作区和 PID 归属、源/新块 ID、每阶段原始回读和 N2 报告、UI 截图、实际操作路径、剪贴板是否被观察及限制、失败与重试情况、进程退出和端口释放结果。未知写入先只读核实，不能盲目重发粘贴。只关闭本轮创建页面并停止本轮持有进程，保留虚构工作区与证据。

退出条件是实际原生旅程和持久回读齐全、拒绝结果可解释、重载一致、清理可核对；宿主改写候选导致可见拒绝也应如实记录，不通过修改读取器掩盖差异。两页面同时写/删竞争另列后续验收；同源实时刷新不等于同时竞争或桌面原生多窗口。

即使本卡完成，D1 仍要与 AV/插件列表候选比较，D3/D4 生命周期、D6/D7 迁移备份与 vCard 出口、S4 全量搜索和实际 IO 预算继续守门。#51/#54 保持开放，生产契约未采纳。

# N2 原生编辑器候选的隔离 Kernel 探针（2026-10-17）

对应 `AG-RF-004-N2-HOST`、Issue #51/#54。只新增研究脚本、独立 results 和本报告；不接入生产联系人模型、API、AV、存储、迁移、vCard 或发布文件。父方向仍为 `candidate`，严格 UI 阶段仍为 `host_pending`。

## 执行入口与边界

[contact-methods-native-editor-host-spike.mjs](../../scripts/spike/contact-methods-native-editor-host-spike.mjs) 默认和 `--dry-run` 都只输出 preflight，不创建工作区、不启动 Kernel、不发 HTTP、不写 results。只有 `LVCT_RUN_NATIVE_EDITOR_HOST=1` 且未指定 `--dry-run` 才能启动隔离 Kernel；工作区与端口不能由调用者传入。

脚本只使用临时目录下本轮新建的 UUID 工作区、回环随机空闲端口和已核实的 `SiYuan-Kernel.exe`/资源目录。每次 HTTP 前用 Windows `netstat.exe -ano -p tcp` 只读核实端口唯一监听 PID 等于本脚本持有的 `ChildProcess.pid`；未开始监听或归属不明时不发 HTTP。结束时先尝试向已核实的本轮 Kernel 退出，随后有界等待，必要时只终止本脚本创建的子进程。它不按进程名清理、不退出已有宿主、不删除日常库；临时工作区保留供复核。原始 Kernel 日志不保存，错误中的临时 token 脱敏。

这些 UUID、进程与端口归属校验属于检测守卫，不能称为 OS 级隔离。端口检查和请求之间也不构成不可竞争的原子操作。

当前 CUA 没有可用 Chrome 控制面，本脚本不连接外部 CDP、不操作 IAB 代替 Chrome，不运行 UI 自动化。`uiControlChannel=unavailable`、`uiVerified=false`、`hostVerified=false` 单列；Kernel API 成功也不能升级为真实编辑器稳定、复制/粘贴或多窗口通过。

## 候选和判定方式

复用 [N2 纯研究](MULTI-CONTACT-NATIVE-EDITOR-2026-10-17.md) 的原样导出 `encode`、`fixtureMethod`、`parseBlock`、`readDocument`，不修改解析器。输入候选为有效 `method-{sha256(owner + ':' + sourceKey)[0:24]}`、`n2-single-json-v1` 单物理行 JSON。

对比 `insertBlock(dataType="markdown")` 与安全实体转义的 `NodeParagraph` DOM 两条传输路径；每条包含普通值、实际换行/TAB/引号/反斜杠、Markdown/HTML/伪 IAL、首尾空格和 CRLF 共四类虚构值。预期原值和正文独立保存。所有人物和网址均为虚构值，网址使用 `example.test`。

每个夹具单独建文档，SQL 回读完整 `id/root_id/parent_id/type/content/markdown/ial`，同时核对直接子块，再重启本轮 Kernel 回读相同块与属性。results 原样保留 SQL 行，不把 Markdown 复制为 content、不把 content 复制为 Markdown，也不猜测 Markdown 反向解码。

研究适配仅将 IAL 属性实体解码一次；若 Markdown 恰以原始 IAL 完整行结尾，可移除这个精确尾行。随后仍将两个独立正文列交给严格解析器。两列不相等、格式变形或值改变均报告未满足，不能用写入响应成功代替严格往返。

`readDocument` 的输入只覆盖每个已知夹具的唯一候选块；`enumerationComplete=true` 只陈述本轮受控夹具范围已经核对，并不证明生产文档中丢 marker 的发现、动态范围完整枚举或删除推断。

## 当前结果

已通过 `node --check`、默认 dry-run 和显式 `--dry-run`；各次 dry-run 输出 `kernelStarted=false`、`kernelRequests=0`、`workspaceWrites=0`、`browserCalls=0`。之后由根 Agent 显式开启环境变量运行真实隔离 Kernel，原始证据为 [contact-methods-native-editor-host-results.json](../../scripts/spike/contact-methods-native-editor-host-results.json)。

本轮 Kernel 为 `3.8.8-alpha.2`，执行时间为本地 2026-10-17 03:17:05 至 03:17:11；工作区为 `C:\Users\Admin\AppData\Local\Temp\SiYuan-Lvct-Native-Editor-4adf7b0d-77f0-46b2-88db-112ba044506f`，回环端口 `1529`。共 73 次 Kernel HTTP 请求，每次发出前均通过对应 PID 的监听归属检测，共 73 次；不读取日常工作区。

八个有效输入候选均完成原生写入、独立 SQL/子块回读和 Kernel 重启后的同块回读；严格原值往返为 **6/8**，两条路径不能合称全部通过：

| 虚构值夹具 | Markdown 路径：首次 / 重启后 | DOM 路径：首次 / 重启后 |
| --- | --- | --- |
| 普通电话原文 `+00 111 / +00 222` | 严格接受 / 严格接受 | 严格接受 / 严格接受 |
| 实际 LF、TAB、引号、反斜杠及字面 `\\n` | `unknown: block-shape` / 同样拒绝 | 严格接受 / 严格接受 |
| Markdown、链接、行内代码、HTML、伪 IAL | `unknown: block-shape` / 同样拒绝 | 严格接受 / 严格接受 |
| 首尾双空格和实际 CRLF | 严格接受 / 严格接受 | 严格接受 / 严格接受 |

Markdown 路径只有 **2/4**。`escapes` 的 SQL `content` 丢失 JSON 引号及反斜杠所需的转义，和独立 `markdown` 不相等；`markdown` 夹具的正文按富文本语义转换，`**虚构**`、`_文本_`、链接/代码/HTML 不再是预期原字符串，Markdown 本身也有规范化。两组严格解析均返回 `unknown/block-shape`，聚合读取均为 `complete=false`、`writeAllowed=false`、`methods=[]`，不会把被改变的文本当成完整方法值。

安全实体转义的 DOM 路径为 **4/4**：SQL 的独立 `content` 与 `markdown` 在本轮四组中相等，正文与预期相等，严格解析得出的原值也精确相等；重启后 `id/root_id/parent_id/type/content/markdown` 与属性回读保持一致。这只证明本 Kernel 和八块受控样本中该 DOM 写入路径的 API 往返能力，不证明真实编辑器输入、自由修改、复制或保存的稳定性，也没有据此采纳生产方案。

结果分别保留 `kernelApiWriteReadVerified=true`、`restartReadbackVerified=true`、`strictCandidateCount=6`、`kernelCandidateVerified=true` 与 `allCandidatePathsVerified=false`。`kernelCandidateVerified` 仅表示至少一组候选往返，不能解读为所有路径通过。导入的纯解析函数计数 `identityAllocations/automaticRepairs/nativeWrites/kernelRequests` 均为 0；这些是纯函数层的计数，不是整个宿主脚本的实际 IO。宿主脚本实际插入八个原生候选块，HTTP 总数为上述 73；未写真实插件文件。

清理记录为 `ownKernelExited=true`、`portReleased=true`，仅保留本轮临时工作区供复核。results 内 `workspaceExists=false` 来自创建前 preflight；`workspaceWrites=2` 只计脚本创建的隔离元数据，不代表 Kernel 生成文件总数。`uiControlChannel=unavailable`、`uiVerified=false`、`hostVerified=false`、`browserCalls=0`、`status=host_pending` 保持明确。

```powershell
node --check scripts/spike/contact-methods-native-editor-host-spike.mjs
node scripts/spike/contact-methods-native-editor-host-spike.mjs
node scripts/spike/contact-methods-native-editor-host-spike.mjs --dry-run

# 显式允许隔离 Kernel 时运行；--dry-run 始终覆盖该开关。
$env:LVCT_RUN_NATIVE_EDITOR_HOST = "1"
node scripts/spike/contact-methods-native-editor-host-spike.mjs
Remove-Item Env:LVCT_RUN_NATIVE_EDITOR_HOST
```

尚未证明：真实编辑器读取、手工改值后的严格解析、复制/粘贴身份保留或重写、重载、双窗口并发写/删除竞争、生产采纳与迁移。即使 API 候选通过，也必须保留这些 `host_pending` 边界。

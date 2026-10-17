# 多联系方式 AV 标量能力与冲突反例（2026-10-17）

对应 `AG-RF-004-S3-A0`、Issue #51/#54。本探针只复核现有 AV 标量端点，给事实源和原生编辑决策提供证据；不选择 D1、不采纳方法库/生产投影或恢复格式。完整 S3 的原生编辑、双窗口与生产恢复仍须满足 D1/D4/D5。

## 固定实验范围

仅新建 UUID 临时工作区中的 AV 和两位虚构人物，复用已有 `phone/email/url/text` 四种列，不增加生产 AV schema。直接调用已有内核端点，不调用生产联系人服务，因此结果属于端点能力证据，不能称为生产服务或多方法功能回归。

写入和读取均锁定本轮工作区、AV、载体块、人物 docId、itemID 和 keyID。官方 doc→item 映射与渲染主键绑定须一致且唯一，列 ID 和类型须一致，禁止通过列名或人物名改投目标。使用显式 `page=1/pageSize=500`，并核对小样本行数及完整性；不使用 `pageSize=-1`。

研究场景：

1. 每类标量的虚构值写入、独立渲染、清空和独立渲染；写请求成功不能替代回读。
2. 计划基线为 S、目标为 T；实验外部 API 写者先改为第三值 X。新鲜读取发现 X 时停止计划写入，原值保持 X。
3. 计划写者已经检查 S，随后实验外部写者改为 X，旧计划再赋值 T。该受控顺序交错用于验证既有赋值请求能否覆盖 X；不把两个 API 写者称为真实 UI 或双窗口竞争。
4. 实际成功响应已经被实验包装器收到，再故意不给调用侧；调用侧记 unknown，随后只读核实。它是本地响应丢弃注入，不是宿主或网络真的丢包。
5. UUID 工作区的独立研究文件先保存 issued 再发请求；重启内核后从文件重建，只读核实原目标。另保存 issued 但不发送，核实看到 S 时仍保持 unknown，禁止由 S 推断请求未发并自动重试。这不是生产方法事实、插件恢复或应用进程重启证明。
6. 解绑/重绑后独立读取官方映射与渲染，旧目标不可达或身份改变时零计划写入，不向旧 itemID 强写。重绑后的 itemID 是否变化以实测为准，不设“必定变化”的断言。

所有标量和网址均虚构。原始渲染、映射、字段与载体块证据及调用次序应保留；实验断点不包含真实联系人。日志和结果不得包含临时 API token。

## 安全与证据门槛

脚本默认 dry-run 不创建文件、不启动内核、不发 HTTP；只有显式环境开关才能运行。运行时使用新 UUID 临时目录和随机回环端口，逐请求核实端口监听者为本轮持有的内核子进程；结束仅停止该子进程，核实端口释放，保留虚构工作区，不递归删除未知目录。进程/路径校验是检测守卫，不是 OS 级隔离。

`uiVerified`、`multiWindowVerified`、`hostVerified` 和 `D1Adopted` 必须保持 false。成功读到 T 只证明当时目标值符合计划，既不证明该值由哪次请求写入，也不证明没有覆盖期间出现的 X。现有赋值请求仅含 `avID/keyID/itemID/value`，实验不能据此断言宿主不存在其他未研究的 CAS 能力。

## 运行结果

运行前规范已冻结，语法、默认 dry-run、环境开关开启时的 `--dry-run` 均通过；dry-run 没有工作区文件、HTTP 或内核子进程。独立审查先发现坏单元格缺 `keyID` 可能被过滤成“缺单元格为空”，已补所有列/单元格的身份和类型校验。空值回读仍要求合法形状，不能把坏 payload 当空。纯形状反例由实现侧和独立审查侧分别验证。

真实证据为 [contact-methods-av-capability-results.json](../../scripts/spike/contact-methods-av-capability-results.json)，可复跑入口为 [contact-methods-av-capability-spike.mjs](../../scripts/spike/contact-methods-av-capability-spike.mjs)。本轮 Kernel `3.8.8-alpha.2`，成功运行的本地时间为 2026-10-17 03:33:48–03:33:57；runId `96bfa3b2-ad35-4041-b0a5-264b439addf0`，回环端口 `4663`。UUID 工作区为 `C:\Users\Admin\AppData\Local\Temp\SiYuan-Lvct-Av-Capability-96bfa3b2-ad35-4041-b0a5-264b439addf0`。

| 已执行场景 | 原始回读与判定 |
| --- | --- |
| 两人 × 四标量类型 | 每组 baseline → desired → clear → baseline，共 32 次赋值及 32 次独立渲染均精确相等；八次清空均读到合法 typed-content 空串，不依赖坏形状容错 |
| 新鲜读取第三值 | 外部实验写者写 X，计划写者读到 X 后报告 conflict，计划写入 0 次 |
| 检查后的交错 | 计划写者读到 S → 外部 API 写者写 X 且回读 X → 旧计划写 T 且回读 T；已复现第三值被覆盖。两个写者均为实验 API，不是原生编辑器或真实双窗口 |
| 调用侧丢弃成功响应 | 包装器已收到成功响应，但调用侧保留 unknown/issued；内核重启后从磁盘研究文件重建，独立读到 T，报告 applied，恢复阶段 0 次赋值 |
| issued 先存、请求未发送 | 实验观察侧知道发送数为 0；恢复判定器仅使用磁盘 issued 和新鲜读取，读到 S 仍报告 unknown，0 自动重发 |
| 解绑冻结目标 | 官方映射返回该人物 docId 对应 `""`，独立渲染无该人物行；旧计划目标不可核实，0 计划写入 |
| 重绑观察 | 本轮 itemID 从 `20261017033349-0vhf6w3` 变为 `20261017033355-8zsy6mq`；官方映射与渲染一致，旧计划未自动续写。只报告本轮变化，不推广为所有宿主都换 ID |

成功轮共 **148 次 HTTP / 148 次 PID 监听归属核实**，原始响应全部保留；43 份受控范围 snapshot，38 次实际标量赋值为 fixture 34、actor 2、projection 2。“projection”只是实验写者分类，不是生产投影服务。两份研究 checkpoint 写入后回读；研究文件仍保持 issued，`applied` 是独立读到 desired 的观察结果，不是生产已完成断点状态，也不证明因果归属。自动重发计数为 0。

第一次运行在解绑时停止：端点返回显式空字符串，初稿只接受合法 itemID/缺键，因此拒绝；当时其余阶段通过，但整轮仍为 failed。随后仅依据该原始映射与独立缺行渲染，窄适配为“空串且无对应绑定”，其他非法值仍拒绝；独立映射反例 16/16 后重新运行。本轮 results 的 `priorAttempt` 保留首次 runId、错误、清理状态与原始解绑映射/渲染，完整首次证据还保存在其 UUID 工作区 `first-attempt-evidence.json`，未将失败冒充成功。

成功轮持有的两次内核子进程 PID `63476`、`19900` 均已退出、端口已释放，临时虚构工作区保留。`workspaceExists=false` 是创建前 preflight，`workspaceWrites=4` 仅计两次直接元数据写和两份研究 checkpoint，不是 Kernel 所有文件写入总数；首次失败证据归档是根 Agent 在首次工作区额外保存的一份文件。结果不包含临时 token。

独立复核已逐项重算 43 份 snapshot 的完整性/身份/列与单元格形状、32 个标量阶段及 38 次原始写入，并核对原始请求顺序、两份磁盘 issued、解绑/重绑与首次失败证据；映射边界反例 16/16。根 Agent 另重算 32 个阶段、八次清空的 typed-content 空串和关键恢复结果，并复核临时 PID/端口均已释放、原有内核 PID `42296` 仍在运行。语法和 `git diff --check` 通过；本轮没有改生产代码，未重复全量生产测试。

```powershell
node --check scripts/spike/contact-methods-av-capability-spike.mjs
node scripts/spike/contact-methods-av-capability-spike.mjs

$env:LVCT_RUN_AV_CAPABILITY = "1"
try {
    node scripts/spike/contact-methods-av-capability-spike.mjs
    $probeExit = $LASTEXITCODE
} finally {
    Remove-Item Env:LVCT_RUN_AV_CAPABILITY
}
exit $probeExit
```

能力子卡为 `done_isolated`；`uiVerified=false`、`multiWindowVerified=false`、`hostVerified=false`、`D1Adopted=false`。没有真实网络故障、应用进程重启、断电持久性、生产方法事实库/恢复服务、原生 UI 或双窗口竞争证据。完整 S3 和多联系方式功能仍未完成。

## 对后续开发的约束

无论 D1 选择哪种事实源，主值投影都不能把读取失败当空值，也不能按当前字符串自动认领方法身份。新鲜读取能阻止已经观察到的冲突；是否能够防止检查后发生的原生编辑，必须单独回答。Web Lock 只协调参与同一锁的插件写者，不能隔离原生编辑。

本轮已否证“先读基线，再赋值，写后读到目标就算没有冲突”的保证。D4/D5 后续应明确：首次主值投影只能讨论显式确认且有新鲜影响预览的操作；后台刷新/重试不能默认覆盖原生值。即使显式确认，也不能把这条赋值请求描述为有原生编辑原子保护。选择生产方案前须决定可接受的冲突边界，或另行研究宿主提供的原子前置条件能力，不能猜参数补上 CAS。

N2 的真实编辑器改值和原生 Copy/Paste 仍未完成：本轮 Chrome 曾出现在控制库存，但选择时已经 unavailable，随后的实时库存只剩 IAB/MCP Apps。本探针不通过外部 CDP 或其他浏览器替代该项，也不提升 N2 的验收状态。

已发现文档漂移：生产 `src/api/av.ts` 通过 500 条分页汇总全量，`DATA-CONTRACT.md` §1.5 仍保留历史 `pageSize:-1` 描述。本轮不修改生产契约，后续契约校准应按当前实证明确这一点。

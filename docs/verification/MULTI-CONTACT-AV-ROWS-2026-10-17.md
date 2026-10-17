# 原生方法 AV detached 行能力研究（2026-10-17）

对应 `AG-RF-004-A1`、Issue #51/#54。研究“每方法一行独立原生 AV”的最小能力，不采纳生产事实源、schema、外键或删除协议；两层自定义条目继续后置。

## 运行前冻结

M0 的 `appendAttributeViewDetachedBlocksWithValues` 使用 `{avID, blocksValues: [[{keyID,type,text:{content}}, ...], ...]}`，每行是值数组、没有 id 包装；其既有结果只证明 code0。B13 摘要的 orgRows=2 与“detached 不渲染”分类之间存在疑点：脚本按“没有 block 型主键 cell”识别 detached，却没有保存原始 cells。本轮不能从这些结果推断 detached 必然可行或必然失败，也不修改旧生产契约来提前消除疑点。

只验证该 append 路径。新建一份方法 AV，宿主保留自建 block 型主键，新增 8 个可读 text 列：methodId、ownerDocId、sourceKey、type、label、value、primary、order。primary 是候选主值标志的规范文本 0/1，不是 AV 主键；order 是非负整数的规范文本。全部值在原生 AV，实验缓存不保存方法事实。跨库 relation 不使用；ownerDocId 仅为显式人物引用，必须独立验证原生文档可达，不能称为内核外键或反链。

既有 S3-A0 原始响应显示新 AV 还自建 Select 等默认列，不能硬限定为 block+8text 共9列。保留全部宿主默认列，核对基础形状和跨页列定义稳定，8个方法列按各自稳定 keyID/type 唯一关联；默认列不充当方法字段，不尝试未实证的删列端点。

两篇虚构人物文档各有五方法（两电话、邮箱、微信、网址）。方法 ID 复用研究 hash 身份规则（owner+固定 sourceKey），不等于 AV row.id，不按姓名、当前值或顺序生成。两人的一条电话同值，用于验证不合并；微信值包含真实换行及特殊字符，用于精确回读。候选字段有显式上限，值不规范化回写。

读取默认视图使用 query 空串、正数 page/pageSize2，每次读取最多8页并核对额外空页。只在全新受控默认视图、未设置筛选/分组的范围核实当前行观察：每页 rowCount 为合法且相同整数，列 ID/类型一致，全局 row.id 唯一，逐页进度有效，最终行数等于声明数；缺页、重复页、总数变化、坏 cell 或预算耗尽不得去重后伪装完整。另用一次 pageSize500 读取作小样本对照，不称为跨请求原子快照或任意历史/被过滤行的全集。

解析每行全部必需 text 值，核对列 ID/type、cell 形状、必需身份/归属/source/type/标志/order、hash 身份、同 ID 重复及同人同类型主值冲突。任一行坏掉则候选语义集合不完整，不返回已接受子集充当全集。原生行仍在但 methodId 清空应作为坏行可见；改变 owner 为另一真实人物但保留旧 ID 应 unknown；重复 ID 应拒绝整范围。普通行或未知 row 不静默跳过，也不自动分配或修复身份。

执行顺序：单批 append 十方法并独立分页回读 → 实验 API 修改值、标签与顺序，核对方法 ID/人物归属不变 → 清空方法 ID、恢复 → 重复方法 ID、恢复 → 改归属、恢复 → 删除一条已知非主值行并独立核实其他行 → 删除一个本轮新建且内容/路径核实的实验缓存文件 → 内核重启后仅只读核实。重复阶段在同人物的两电话行复制 methodId 和 sourceKey，使各行单独通过 hash 身份，独立检验集合重复守卫，不能仅用 hash 不匹配的 unknown 冒充重复校验实证。故障注入和恢复均是明确夹具写，不称自动修复或原生编辑器操作。

当前行消失只对实验历史报告 unknown-not-delete，不生成墓碑、不复活、不改写主联系人 AV。cold 当前语义集合可能完整，但历史方法全集未证明。已知 ID 与预期夹具只用于实验 oracle，不宣称持久 manifest 或删除插件数据后的历史重建。

诊断始终区分 currentViewObservationComplete、selectedMethodReadComplete、historicalMethodScopeVerified；最后一项及外层 writeAllowed 恒 false，外层 methods/tombstones 为空。append、remove 和改值响应均保存原始输入输出，不从 code0 推断应用结果。若 append 行无法完整独立回读，保留原始负证据并停止此路径，不自动切换绑定段落/额外方法文档或猜测主键 payload。

视图范围前提来自本轮新建 AV 且操作集不含修改筛选/分组/视图的端点；运行后独立检查全部原始 render 的 viewID/view.id、filters、group、contextFilter、contextFilterFields 与 isMirror，确认本轮没有实质筛选。纯诊断器本身尚不验证这些视图元信息，不能用于任意已有视图并声称全库完整；query 为空也不能单独证明无过滤。block 主键 cell 允许省略，若提供 payload 只检查基础对象形状，具体字段保持原始证据；8个方法 text cell 仍全部必需。

## 安全边界

默认/--dry-run 无文件写、HTTP、端口绑定或子进程；真实运行显式 gate `LVCT_RUN_AV_ROWS=1`。仅新 UUID 规范临时目录、随机回环端口和持有的 Kernel 子进程；每次请求前检查 marker、路径及监听 PID，redirect:error。未知写零自动重发，任一异常保留现场。只结束本轮子进程，不清理其他进程或递归删除目录。检测守卫不等于 OS 级隔离。

实验缓存是本轮单独创建的非事实文件，只允许核实精确路径和内容后 unlink 该文件。此步骤不等同真实卸载、删除真实用户插件目录或工作区备份恢复；实验进程仍持有 AV/载体锚点及夹具基线，不证明删除全部插件配置后的自动发现或历史重建。全部联系方式虚构，不安装插件、不访问日常库、不联网外发；token 不进入证据。

## 当前状态

`AG-RF-004-A1` 已完成受控隔离能力验收（`done_isolated`）：最终纯检查58/58、独立补充85/85；第四轮135 HTTP及135次ownPID、11完整快照，追加/改值/身份故障拒绝/删行/缓存删除/重启均通过。只证明已知AV的当前视图与当前语义集合；D1、历史全集、真实UI和全配置删除后发现未采纳/未验证。前三轮失败原证据保留，见下文。

首轮 run ID `5d5849dd-d9a4-4921-bd4c-d11386d03513`、Kernel `3.8.8-alpha.2`、端口 `8743`、持有 PID `49424`；26 次 HTTP 及 26 次 PID 核实、14 次夹具修改。第20个请求向独立新 AV 追加 10×8 个 text 值，响应 code0/data:null；第21–23个请求分别 page1/2、page2/2、page1/500，全部 rowCount0/rows为空。第24个请求才刷新事务，第25个请求验证两人物文档可达。空当前视图可以通过观察检查，但与预期十条方法不一致，追加能力验收失败，未进入改值、删行、缓存删除和重启阶段。没有自动重发。

该轮完整证据保留于 `C:\Users\Admin\AppData\Local\Temp\SiYuan-Lvct-Av-Rows-5d5849dd-d9a4-4921-bd4c-d11386d03513\av-rows-evidence-5d5849dd-d9a4-4921-bd4c-d11386d03513.json`，与该轮仓库结果逐项一致；子进程已退出，端口无监听，既有用户内核 `42296` 启动时间未变。

审查发现事务刷新在 render 之后，下一次独立实验只把既有 flushTransaction 移到分页读取之前，使用新 UUID 和新 AV；不向首轮未知请求所在 AV 重发、不猜主键 payload、不切换绑定行。两轮跨工作区差异不能单独证明首轮根因必然是刷新时序；若仍为空则保留负证据停止该路径。

UI、原生编辑器、同时写入、多窗口、CAS、搜索、主值投影与大库性能均不在本卡证据内。D1 及 #51/#54 继续未完成。

## 第二轮与源码校准

第二轮 run ID `f9dfe93d-81a9-4aa1-976f-b3ae4e3739e5`、端口 `9245`、持有 PID `9556`；26 次 HTTP/ownPID 核实、14 次夹具修改。第20请求追加仍 code0/null；第21请求读前 flush 后，第22–24请求 page1/2、page2/2、page1/500 仍均 rowCount0/rows为空。两人物文档 SQL 可达。仍未进入改值、删行、缓存删除或重启，不能把未执行阶段写成通过。完整证据保留于 `C:\Users\Admin\AppData\Local\Temp\SiYuan-Lvct-Av-Rows-f9dfe93d-81a9-4aa1-976f-b3ae4e3739e5\av-rows-evidence-f9dfe93d-81a9-4aa1-976f-b3ae4e3739e5.json`；该轮结束时本轮 PID 已退出、端口释放，既有用户内核未变。

只读检查第二轮 `data/storage/av/20261016202344-3ba89b1.json`：宿主 block 主键列没有 values 字段，8个方法 text 列各有10个 value，均为本轮 detached 值。因此空 render 不等于没有保存任何值，code0 也不等于追加形成了可回读的行；不能从该负例推断所有 detached 方案都不可用。原始文件保留、不作磁盘修补。

独立只读复核两轮磁盘均为block主键0值、8text各10值/10个unique BlockID。第一轮AV文件20544 B、SHA-256 `6efbfe46181dede91c5232d6225ac48a3ea045f69f935e15d1da9427832e7081`；第二轮20544 B、`eb15ece7b2ef51f453314c16a4f2778625e946dfd2b62af1dddb2a03da6d4cd8`。两轮52份HTTP原始响应与10份render视图已独立核对，视图ID一致、无实质过滤；这只支持本轮受控视图范围。两轮的原始证据文件均保留，仓库results只指向最新实验，不作为旧轮文件的替代。

同版本 tag `v3.8.8-alpha.2` 指向 commit `2b31367098736be09e27edd3e8044518dd3919e8`。固定 commit 的 [append API](https://github.com/siyuan-note/siyuan/blob/2b31367098736be09e27edd3e8044518dd3919e8/kernel/api/av.go#L251)（blob `7e4719e18c9dc19ae12e96a5c9ac4eea72277648`）把 blocksValues 传给 model；[append model](https://github.com/siyuan-note/siyuan/blob/2b31367098736be09e27edd3e8044518dd3919e8/kernel/model/attribute_view.go#L2177)（blob `68d96ed74ed2bb39d2152cd3610fefa102d81e43`）仅保存传入的列值，以真实列类型覆盖 value.type；block 列必须有非 nil block 对象，内核分配 item/value ID、设 detached，并清空 block.id/refSubtype。[原生 block 值结构](https://github.com/siyuan-note/siyuan/blob/2b31367098736be09e27edd3e8044518dd3919e8/kernel/av/value.go#L497)含 content 字符串。[渲染过滤](https://github.com/siyuan-note/siyuan/blob/2b31367098736be09e27edd3e8044518dd3919e8/kernel/sql/av.go#L504)会排除缺 block 主键 value/block 对象的行，而 detached 主键值不要求绑定人物文档。该链解释本轮观察，但版本字符串匹配不是对安装二进制源码来源的证明。

## 第三轮运行前冻结：source-backed-primary

在任何本变体代码与真实写入前登记：保持同 append 端点及全部8 text研究列，从全新 AV schema 唯一 type=block 列取得真实 keyID；每行第一值显式为 `{keyID,block:{content:虚构显示标签}}`，随后原8text值。标签只是虚构显示内容，不是方法身份或人物绑定。省略 blockID、block.id、value.id、isDetached 和时间戳，由内核分配；ownerDocId 仍只保存在已定义 text 列并以人物 SQL 独立核实。

使用第三个新 UUID、新 AV 和新单批追加，不重发或修补两轮旧 AV。仍执行原严格分页、改值、空/重复身份、归属冲突、移除、缓存删除和重启序列；不增加重试、不放松 parser、不从 code0 判应用。如果独立回读失败，立即保留该变体负证据并停止。已有两轮失败证据文件不覆盖；仓库 results 指向最新一轮并显式记录变体与源码依据。原生编辑、跨窗口及生产事实源采纳仍不在范围内。

## 第三轮结果与读取比较校准

第三轮 run `47bfa7f6-aec2-44cc-bc83-06ab2e4949ab`、端口 `10366`、持有 PID `53720`，30请求/30次ownPID、14夹具修改；10条方法真实分5个非空页，每页2行，额外空页和pageSize500均rowCount10，人物SQL可达。8个方法列及block主键值跨小页/大页完全一致；唯一比较失败是宿主默认空Select在每次render生成新的cell.id/value.id（10行共20处raw差异，原比较器只比较value故10处）。仍按失败退出、停止后续阶段并保留完整证据，不能把本轮写成全部验收通过。现场为 `C:\Users\Admin\AppData\Local\Temp\SiYuan-Lvct-Av-Rows-47bfa7f6-aec2-44cc-bc83-06ab2e4949ab\av-rows-evidence-47bfa7f6-aec2-44cc-bc83-06ab2e4949ab.json`（456309 B，SHA-256 `ad9294c3de07f7186089e645232f2ee91fce0f755130881452840632fbfc9089`）。本轮进程退出、端口释放。

固定同commit的 [缺值cell生成](https://github.com/siyuan-note/siyuan/blob/2b31367098736be09e27edd3e8044518dd3919e8/kernel/sql/av_table.go#L115)为缺少持久值的cell分配含随机后缀的ID，[默认值路径](https://github.com/siyuan-note/siyuan/blob/2b31367098736be09e27edd3e8044518dd3919e8/kernel/sql/av.go#L583)调用 [GetAttributeViewDefaultValue](https://github.com/siyuan-note/siyuan/blob/2b31367098736be09e27edd3e8044518dd3919e8/kernel/av/value.go#L3285)。该轮10个Select的其他keyID/blockID/type/createdAt/updatedAt均相同、mSelect均省略，符合该路径；这不证明任意字段变化都可忽略。

下一轮代码/写入前冻结比较策略 `empty-host-select-generated-id-v1`：仅对schema中非8方法列的宿主默认type=select空值、实际观察到的精确六字段shape（id/keyID/blockID/type/createdAt/updatedAt）、合法value.id、blockID=row.id，比较时将value.id替换为固定诊断标记；全部原始输入/响应保留。其他类型、mSelect或未知字段出现、非法/缺失ID不享受该等价规则；key/row/type/时间戳及全部方法字段/block主键仍完整比较。不得删除Select列、忽略所有cell/value ID或忽略内容变化。增加独立反例：仅生成ID不同可通过，Select选项/其他字段变化、非法/缺失ID、text/block ID变化仍拒绝。仅在第四个新UUID运行同payload，全套验收继续，不修补/重发第三轮AV。

该规则增加更严格前提：默认Select key来自初始真实schema且本轮操作不写该列；每次snapshot仅只读本轮精确AV文件，核实其持久values缺失/为空并记录路径、SHA-256、key/count摘要，才提供明确generated-empty列allowlist。归一前还要求cell.id=value.id、ID时间前缀=row.id前缀、时间戳为合法整数；不满足则unknown。纯诊断器只校验allowlist与schema/shape一致，不自行访问磁盘，因此“未持久值”前提来自受控producer及独立证据复核，不能把外部随意构造的allowlist当已证事实。没有读取真实用户AV文件，也没有修改宿主JSON。

## 最终隔离结果

第四轮run `60ac7452-0fb1-4fb7-91fe-5142dabc4c7b`、Kernel `3.8.8-alpha.2`，端口11970，重启前后持有PID为55944/21344。135次HTTP/135次ownPID、26次显式夹具修改（初始14、11次标量赋值、1次移除），零自动重发。append变体为`source-backed-primary`，比较策略为`empty-host-select-generated-id-v1`；初始schema包含宿主block、Select及8方法text列，所有默认列保留。

| 阶段 | 当前行数/读取 | 结果 |
| --- | --- | --- |
| 单批追加 | 10行，5个非空pageSize2页+额外空页+500对照 | 8字段逐项精确，同值跨人不合并，特殊字符/真实换行保留 |
| API改值、标签和order | 10行，同样完整读取 | methodId/owner/source及itemID不变 |
| 清空methodId | 10行观察完整 | 整个语义集合拒绝，不返回有效子集；显式恢复后10条精确 |
| 同人物复制有效hash及sourceKey | 10行观察完整 | 单行身份均可通过，集合明确duplicate；显式恢复后10条精确 |
| owner改为另一可达人物、保留旧ID | 10行观察完整，人物SQL可达 | 身份/归属unknown，整个语义集合拒绝；显式恢复后10条精确 |
| 移除已知非主值行 | 9行，仍5个非空页（末页1行）+空页/对照 | 其他9个itemID及值不变；缺失只报unknown-not-delete，零墓碑 |
| 精确非事实缓存删除 | 9行完整 | 仅删除已核实本轮路径/内容的单文件，未递归删目录 |
| 内核重启，只读 | 9行完整 | 与删缓存后方法逐字段及itemID相同，重启读取阶段零夹具修改 |

共11快照，每份均保留分页/额外页/对照/人物SQL原始响应、逐字段诊断、默认Select的精确AV路径/摘要/无持久值证明及归一路径。前8快照各10行，后3各9行；三种坏身份阶段只拒绝语义集合，没有把当前观察错误标为读取失败。外层methods/tombstones/repairedWrites为空，历史验证和writeAllowed始终false；known-item历史仅来自本次实验内存，删除不构成用户删除意图证明。

完整证据保留于 `C:\Users\Admin\AppData\Local\Temp\SiYuan-Lvct-Av-Rows-60ac7452-0fb1-4fb7-91fe-5142dabc4c7b\av-rows-evidence-60ac7452-0fb1-4fb7-91fe-5142dabc4c7b.json`，与仓库`contact-methods-av-rows-results.json`完全一致，4,444,096 B、SHA-256 `252041c6c68f90c9a90a75f2c3dba1c02a6fbc6deb18dc5833726ea9e749ddd2`。本轮两PID均退出、端口无监听；既有用户内核42296及启动时间`2026-10-16T23:35:26.342891+08:00`保持，未操作日常库。

独立复核全部11诊断重算与原结果逐字段一致，79份原始render的AV/view ID稳定，无实质filter/sort/group/context限制。107对小页/大页原始行仅默认空Select的value.id及相等cell.id变化，其余字段完全一致；214条归一路径全部为允许列的value.id。另有56项直接从原始text值抽取的语义/身份核对通过，不依赖诊断器自证。最终磁盘block与8text各9值，81个持久值逐字段等于重启后的原始回读；AV文件21267 B、SHA-256 `1d07d9c4fa20854b31d2997a4b3c6fb8eacc9e9f2df4bc490c2e8bb0d5eddbb4`，最后三快照摘要相同。两份完整证据均不含临时token，实验缓存精确路径不存在。审计断言计数只表示本次独立复核，不冒充项目新增测试。

语法、58/58纯检查、默认与gate+dry-run的零副作用拦截、独立85项检查通过；本轮仓库`pnpm check` 0 errors / 0 warnings、`pnpm test`656/656。已有73文件hash及1个不存在文件状态共74项与认领前相同，既有未提交变更保留；本卡只新增A1脚本/结果/报告并更新backlog与契约复评研究状态。没有生产DATA-CONTRACT、版本、发布或Issue状态变更。

下一项登记为A2候选：先冻结方法AV锚点配置丢失后的有界只读冷发现、独立进程输入与歧义规则。A1当前仍保有AV/载体/列/人物ID，不能用本次非事实缓存删除代替真实卸载、全部配置删除后的发现或未完成请求恢复。原生编辑器、复制、跨窗口、人物生命周期、搜索/备份与D1–D8仍需独立研究与契约采纳；#51/#54继续开放。

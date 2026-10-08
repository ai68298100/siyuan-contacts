# AG-P0-010 外部桥最小安全协议收口证据

日期：2026-10-04。范围：bridge 模块、专用 domain/services、新 bridge 测试、独立 E2E、BRIDGE.md 与 DATA-CONTRACT 新 §12。未改 contacts/roster/UI/types/index、backlog、DECISIONS、UI-REGRESSION 或其他契约章节；未连接日常思源、发送消息、提交或发布。

## 实现与兼容决策

采用 protocol 2，能力仍是 searchPeople/getPerson/ensurePerson/recordInteraction。拒绝 v1 的按姓名自动选人/无键创建；保留 BridgePerson 字段与 recorded 字段。候选 BRIDGE-001 的版本协商、身份认证、通知/新业务全部延期，仅在 BRIDGE.md 形成最小草案和兼容建议。

姓名包括唯一候选也只做候选；选人使用 docId，新建使用稳定 ref。docId/itemId 格式、唯一名册绑定及人物文档实际可达性核实失败不写孤儿互动；未绑定同名文档返回 unboundCandidates 的稳定 docId，交既有手动流程确认。正常人员摘要返回副本。

bridge-requests.json 经 storage.ts 排他锁、严格读取、normalize 和写后回读；记录输入/锚点、原创建 checkpoint 与逐人事件状态。业务发送前持久 pending，同键换输入/锚点冲突；未知同名建档不能换 ref 绕过。成功重放零业务写；崩溃 pending 保守转未知，只读找回原创建/绑定，暂找不到原证据不重发。重挂载不丢请求身份。

建档复用 ContactCreationRequest/createContact/previewContactCreation 与既有原子请求标记、创建锁；没有重做联系人 request。互动复用 recordInteractionWithResult 的事件身份与存储锁，未知项先严格读取原事件证据；同键重复活跃事件拒绝挑第一条。recorded 只计本次新增且回读核实；批量含原输入序号、applied/skipped/failed/unknown/writeState，失败不丢其他成功项。

公开固定错误码/写状态与 diagnostic，不透传 cause 或私人原始错误；批量诊断无姓名、联系方式、正文、备注、路径、ref。协议声明冻结；旧挂载对象卸载后失效，等待桥锁的过期调用零业务写。无新端点、网络发送或其他插件存储读取。

## 已执行的定向验证

`node --test tests/external-bridge.test.ts tests/interactions.test.ts tests/architecture.test.ts`：43/43 通过，其中 bridge 新增 26 项、互动既有 12 项、架构 5 项。

覆盖：精确版本/能力、运行时非法形状与日期、默认键排序去重、同名单/多候选、稳定 ID 消歧、重复绑定、并发创建、重启/改名重放、输入/锚点冲突、未知创建保留原请求、换 ref 拒绝、明确拒绝重试、pending 崩溃保护、部分结果、非法/孤儿/重复 ID、并发互动、事件内容冲突、跨日冻结、丢响应、未知无证据不重发、删除事件不复活、行变化、名册残留但文档已删、单项读失败、写前/写后账本故障、坏库、重复键、重复事件/墓碑、隐私、未初始化/卸载与等待队列卸载。

`pnpm exec tsc --noEmit -p tsconfig.json`：通过；主代理此前指出的 request.docIds unknown 与 writeState 不重叠比较已修复。本轮不跑 pnpm check/test/build 或全量 UI。

`node --check scripts/e2e/external-bridge-regression.js`：通过。仅语法检查，不冒充 E2E 运行证据。

## 主代理接入与待运行

`scripts/e2e/external-bridge-regression.js` 导出 `runExternalBridgeRegression({test,assert,kernel,settings})`，无入口自主启动、fetch 或日常内核连接。主代理在既有隔离 Vite/siyuan-mock 环境调用该函数即可；复用传入 kernel handler，函数内独立存储/名册夹具并在结束恢复 handler/timeout。

9 个独立场景：协议/消歧；真 contacts 服务同键并发和持久重挂载；未绑定文档阻止自动收编；未知创建持久核实/换键拒绝；明确拒绝保留请求重试；逐项互动/并发/孤儿；事件写后回读失败后只读核实；来源未知和断点保存失败零写入；坏库与旧桥失效。**本工作单元未运行这 9 项，交主代理接入并记录结果。**

src/index.ts 已有 initExternalBridge(this,()=>this.settings) 与 disposeExternalBridge() 接线，不需要新的暴露或修改。package.json 的显式测试列表本次未改，主代理应把 tests/external-bridge.test.ts 加入其统一测试入口，或继续显式执行上面的定向命令。

旧 scripts/e2e/ui/person-identity-regression.js 中桥同名用例的复用夹具把行 ID 写为 row-other，v2 会严格拒绝该非法 itemId；该受保护文件本次未改。若主代理要跑原全量 UI，需在自己拥有的夹具范围提供合法思源 itemId，并以 protocol 2 规则更新原桥预期；本次独立 E2E 已使用合法 ID。

## 真实宿主边界

Web Locks 不可用时仅同窗口队列，跨窗口不宣称排他。桥账本和 contacts/互动存储分别持锁，内核端点和原生编辑间无 CAS；本轮不能证明真实宿主多窗口、文件同步/恢复或原生编辑竞争。

桥在交给既有 createContact 前检查当前实例与锚点，但已交付的建档服务链不能中途取消；卸载或切锚点不能宣称撤销已经发出的业务，仍需核实原请求。桥锁协调桥自身并发；手动服务的共享创建锁保留，不能把桥外原生编辑或多个端点称为原子事务。持久 pending 崩溃在无法证明某步未发送时可能保守停止，需要人工核实；这是安全状态，不换请求绕过。

请求账本不加入业务迁移包，不自动垃圾回收；删除账本失去请求去重保护。协议 v2 的公开 BridgePerson/候选含正常调用所需的人物摘要；diagnostic 与逐项报告保持私人内容最小化。接口是本地对等插件协作，并不构成恶意插件隔离/权限认证。

# 人员服务桥最小安全协议

AG-P0-010 · protocol 2 · 仅提供既有的选人、建人和共同互动能力。数据契约见 DATA-CONTRACT §12；§7 是 vCard 契约，本次不改。

## 版本与能力

启用插件后挂载 `window.LvContacts`，初始化前调用会拒绝 `not_initialized`。卸载使旧对象也失效；调用方应重新取得当前对象。

```js
const bridge = window.LvContacts;
if (!bridge || bridge.protocol !== 2
    || !["searchPeople", "getPerson", "ensurePerson", "recordInteraction"]
        .every((capability) => bridge.capabilities.includes(capability))) {
    return; // 显示集成暂不可用，保留本插件手动流程
}
```

`protocol`、`capabilities` 和 `safety` 声明不可修改。`safety` 为 `{stableDocIds:true,persistentRequests:true,itemResults:true,unknownWrites:"verify_first"}`。能力声明只有四个既有方法，不包含合并、资料更新、组织、任务、通知或其他业务。

| 项目 | v1 | v2 兼容决策 |
|---|---|---|
| 版本检测 | 示例曾使用 `>=1` | 必须精确匹配支持的主版本及能力 |
| ensurePerson(name) | 可能复用唯一同名或新建 | 姓名只返回候选；新建须给 ref，选人须给 docId |
| recordInteraction | 只返回 recorded | 保留 recorded，增加逐项结果与未知状态 |
| 错误 | 普通 Error/原始服务错误 | 固定错误码、写状态和无私人内容的诊断 |
| 幂等 | 互动事件键 | 事件键加持久请求身份与输入冲突检查 |

这些安全语义不能冒充 v1，因此升到 v2。旧调用方需更新；不提供继续按姓名自动取人的兼容开关。

## 读取与明确选人

`searchPeople(keyword=""): Promise<BridgePerson[]>` 沿用姓名/电话/微信/邮箱/标签过滤，只返回既有摘要字段。`getPerson(docId): Promise<BridgePerson|null>` 按稳定文档 ID 获取已登记且可达的唯一联系人；未登记或文档已删除返回 null，无法核实来源则拒绝，不能把读失败当不存在。

```ts
interface BridgePerson {
    docId: string;
    itemId: string;
    name: string;
    group: string;
    tags: string[];
}
```

docId 是人物文档身份，itemId 是数据库行身份，二者不互换。ID 格式为 `^\d{14}-[0-9a-z]{7}$`；格式合法还必须通过名册唯一性和实际文档可达性核实。读结果为副本，调用方修改 tags 不会修改名册。

`ensurePerson(name,{docId}): Promise<BridgePerson & {created:boolean}>` 使用明确的文档 ID，返回 created=false；name 只保留调用形式，不用旧显示名改绑到另一个人物。

## 安全建人

`ensurePerson(name,{ref}): Promise<BridgePerson & {created:boolean}>` 在无同名候选时创建。name 使用既有标题规则，不能含斜杠或控制字符。ref 是调用方为这次建档保存的稳定请求键，建议 `my-plugin:person:<稳定来源记录 ID>`；非空，最多 512 字符。docId 与 ref 不能同时传入。

- 任何已登记同名候选（包括只有一个）均拒绝 `BridgePersonAmbiguityError`，`code=person_ambiguous`，candidates 提供 docId/itemId/name 等摘要。调用方让用户选择后改用 getPerson(docId) 或 ensurePerson(name,{docId})。
- 未绑定同名文档也停止；unboundCandidates 仅提供 docId/name，不提供路径。需在小驴人脉既有手动流程确认收编，再以登记后的 docId 使用桥。
- 同 ref 并发/重挂载复用原创建请求和原子 `custom-lvct-contact-draft` 标记，成功重放不建新文档/行。created=true 表示该 ref 对应的是创建请求，并不表示这次重放又新建了人物。
- 同 ref 改姓名或数据库锚点报 idempotency_conflict；人物后来改名仍按原 docId 核实，解绑、删除或行变化不创建替代。
- 未知结果保留原 ref，只核实原请求；另一个 ref 不得绕过同名未完成请求。持久 pending 崩溃后保守视为创建及绑定未知，找不到原标记/原映射不重发。
- 明确拒绝可重试原请求；存储断点未核实前不发业务写。新建复用 contacts 的请求、创建锁、文档查询、绑定映射及回读；不另造建档接口。

```js
const selected = await bridge.ensurePerson("表单显示名", { docId: selectedDocId });
const created = await bridge.ensurePerson("新人物", { ref: "my-plugin:person:record-42" });
```

## 共同互动与逐项结果

`recordInteraction(personDocIds,meta?): Promise<BridgeInteractionResult>` 最多接收 200 个输入，按输入序号返回每项结果。重复 ID 是 skipped；非法 ID 或未登记/已删除文档是 failed，均不写孤儿互动。唯一身份未核实或来源读取失败是 unknown；一个人的失败不丢弃其他人的已保存结果。

```ts
interface BridgeInteractionMeta {
    ref?: string;
    date?: string;
    place?: string;
    note?: string;
}
interface BridgeInteractionResult {
    recorded: number;
    applied: number;
    skipped: number;
    failed: number;
    unknown: number;
    complete: boolean;
    results: Array<{
        index: number;
        docId?: string;
        itemId?: string;
        status: "applied" | "skipped" | "failed" | "unknown";
        code?: string;
        writeState: "not_sent" | "rejected" | "unknown" | "verified";
    }>;
}
```

date 是存在的 YYYY-MM-DD 公历日期，按当地日零点记录；省略时冻结首次接收的本地日。ref 默认沿用 `bridge:<本地日期>:<排序去重的合法人员>`，人员顺序不改变身份；同一天同批人员需要多个场合时必须提供不同的稳定事件键。默认键随本地日变化，跨日恢复必须显式保存原 ref/date。显式 ref 省略日期重放时沿用请求首次日期。

显式 ref 最多 512 字符，建议 `my-plugin:event:<稳定场合 ID>`；place 最多 512，note 最多 4096。place 仍按 `@地点` 拼入备注。非字符串、空 ref、不存在日期或未知参数名写前拒绝；ID 的逐项非法情况仍返回逐项结果。

事件身份沿用 personDocId+source=api+externalRef。相同 ref 冻结去重人员集合、本地日期和拼接后备注；改变输入拒绝 idempotency_conflict，不更新旧事件。请求库与事件存储分别加锁，锁内重新读名册/请求和事件证据。发现同身份有多个活跃事件不挑第一条，停止并保持未知。

`recorded` 只统计本次新增且写后回读核实的条数；已存在事件、重复输入和只读核实计 0。complete 仅在全部项 applied/skipped 时为 true，读取未知/明确失败都不能报告整批成功。未知事件只读取原事件证据，不因暂未找到而重发；用户删除已核实事件也不自动复活。

```js
const result = await bridge.recordInteraction([selected.docId, otherSelectedDocId], {
    ref: "my-plugin:event:meeting-42", date: "2026-10-04",
    place: "会议室", note: "项目讨论",
});
// 显示 result.results；保留原 ref/date/人员与备注以便核实。
// 不能根据 recorded === 0 推断全部成功，也不能对 unknown 换键重发。
```

## 错误与诊断

公开拒绝对象是 BridgeError，message 为固定中文提示，提供 code、writeState、retry 和 diagnostic；不附原始 cause。

| code | 含义与调用方动作 |
|---|---|
| invalid_input | 修正输入；业务未发 |
| not_initialized | 先完成本地初始化 |
| disposed | 旧桥失效，重新获取当前对象 |
| configuration_changed | 锚点变化，原请求不迁移到新目标 |
| unavailable | 来源暂不可读，保留请求并核实 |
| person_ambiguous | 展示 candidates/unboundCandidates，以稳定 docId 明确选人 |
| person_not_found | 未登记或文档不可达，不写入、不换同名人 |
| identity_unknown | 人物/绑定身份不唯一或发生变化，先核实 |
| idempotency_conflict | 同键不同输入，停止；不能换键盲重放未知写 |
| storage_unknown | 请求库或写后回读未核实，保留同请求 |
| write_failed | 业务明确拒绝，可重试同请求 |
| write_unknown | 业务可能已应用，先只读核实 |

逐项 code 另有 duplicate_input、already_recorded。retry 为 same_request/read_only/select_doc_id/none；writeState 优先表达是否已发/核实，不能只凭 error.message 或是否 reject 推断写入没发生。

diagnostic 只包含 operation/code/writeState。逐项报告只含序号、稳定 ID、状态与固定码；不输出姓名、联系方式、备注、路径、ref 或原始错误。正常人员/候选响应是明确请求的数据，与诊断分开。桥不记录私人参数日志，也不读取或监听其他插件存储、不接收凭证、不发送网络请求。

## 持久化、生命周期与验证边界

bridge-requests.json 是工作区内安全请求账本，schema 1，内容按 DATA-CONTRACT §12；不加入业务迁移包、不用于另一工作区重放，不自动删除请求身份。存储读取失败/损坏/版本未知整体停止，不能归一为空库。桥故障独立于本地手动联系人功能。

卸载/重挂载使原对象失效，等待桥锁或桥读取期间的迟到调用在交付业务写之前重新检查实例与锚点；已交给 createContact 的建档服务链不能中途取消，已经发送的请求无法宣称撤销，其结果仍要核实。Web Locks 不可用时仅提供同窗口排他。原生编辑、手动服务与多个内核端点之间没有 CAS，不承诺跨端点原子性；真实宿主多窗口及宿主写后回读时序仍待验。桥是本地协作接口，不是对不可信插件的沙箱或权限认证。

定向纯测试：`node --test tests/external-bridge.test.ts tests/interactions.test.ts tests/architecture.test.ts`。类型：`pnpm exec tsc --noEmit -p tsconfig.json`。独立隔离 E2E 为 `scripts/e2e/external-bridge-regression.js` 导出的 `runExternalBridgeRegression({test,assert,kernel,settings})`；由主代理在既有隔离 kernel mock/Vite 环境接入，仅跑该函数，不连接日常思源、不跑全量 UI。该文件无自主启动或网络请求。

## AG-BRIDGE-001 候选草案与兼容建议

建议后续跨插件契约采纳本次最小版本检测、稳定 docId、命名空间 ref、逐项状态及诊断边界；本次只落地 AG-P0-010 的既有业务安全收口。调用方身份认证、跨插件权限、多版本协商、撤销、批量建档、回调/通知与新业务能力延期，需要独立协议决策和隔离 spike。此候选仍只产出草案，不修改 backlog/DECISIONS 或主流程代码。

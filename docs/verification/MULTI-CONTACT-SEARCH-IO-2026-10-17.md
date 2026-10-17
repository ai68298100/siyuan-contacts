# 多联系方式 JSON IO、搜索合并与索引状态研究（2026-10-17）

本报告对应 `AG-RF-004-S4`、Issue #51/#54 和 D8 前置门禁。研究只在 Node 临时目录中生成虚构快照，验证严格 JSON 读写、主 AV 命中与方法命中合并，以及派生索引失效时的完整性状态。没有读取插件存储、思源内核、网络或真实联系人，也没有改生产代码或生产契约。

## 运行与结果

```text
node --check scripts/spike/contact-methods-search-io-research.mjs
node scripts/spike/contact-methods-search-io-research.mjs --dry-run
node scripts/spike/contact-methods-search-io-research.mjs
```

- 纯检查 **24/24** 通过；默认运行与 `--dry-run` 均退出 0。
- 夹具为 10,000 人、100,000 条方法；所有值只在临时文件和内存中使用，结果文件不输出完整姓名、电话、邮箱或标签。
- `kernelRequests=0`、`productionChanges=false`、`candidateContractAccepted=false`，`noPluginStorage/noNetwork/noProductionFiles` 均为 true。
- 大快照规范化 JSON 为 **21,790,126 B**。本次 Windows 本机最后一次默认运行的阶段耗时为：规范化序列化 93.69 ms、写入及重命名 20.22 ms、读取 12.93 ms、严格解析 100.02 ms、回读后再序列化 77.90 ms，总阶段计时 251.90 ms。它是纯 Node 临时文件观测，不是插件 `loadData/saveData` 或真实宿主预算。
- trigram 派生索引构建 3 次，中位数 397.77 ms、p95 404.34 ms，posting 数 2,066,622；该索引仍是候选派生缓存，不是事实源。

原始脱敏结果保存在 [`contact-methods-search-io-results.json`](../../scripts/spike/contact-methods-search-io-results.json)。其中只保留阶段、字节数、计数、状态和短哈希。

## 已验证的不变量

### 严格 JSON IO

候选快照必须是 `researchFormat=1` 的对象，具有 revision、sourceAnchor、persons 和 tombstones；未知顶层/人物/方法字段、坏 JSON、截断文本和超限输入都拒绝。规范化 JSON 的写入流程是临时文件 → 重命名 → 读取 → 严格解析 → 规范化再序列化 → 摘要比较。

写请求拒绝与写后回读摘要不一致分别报告为 `rejected` 和 `unknown`。后者不能自动重写或被解释为未写入。读、解析、序列化、写入和回读的阶段均保留状态与耗时。

### 主值与次值命中合并

AV 直接命中与方法扫描命中按稳定 `personDocId` 合并，同一人物只保留一条，并保留命中来源集合和方法 ID 短哈希。若同一人物出现不同 `itemId`，结果仍只保留一条但标记 `item-id-conflict`，不会把冲突当作完整结果。不同人物即使值相同也保持两条，不按姓名、当前值或数组位置合并。`related` 展开单独输出，不混入自身命中计数。

分页夹具将 401 条命中分为 200/200/1 三页，完整遍历返回 `complete`；只取一页后取消返回 `cancelled`，不会把已返回的部分误报为完整结果。

### 索引状态与完整性

索引状态包括 `valid`、`missing`、`invalid`、`stale`、`rebuilding` 和 `cancelled`。有效索引的候选仍要做最终字面匹配；缺失、坏版本和 revision/sourceAnchor 不一致会降级到有界分块扫描。重建中的预算耗尽返回 `partial`，取消返回 `cancelled`；任何未扫完整的结果都不能标为 `complete` 或伪装成空结果。索引取消后若完整回退扫描成功，状态仍携带 `cancelled` 并标记 `complete-fallback`，避免把派生缓存状态误报为健康。

## 尚未证明和退出边界

- 临时文件的 `fs` 读写不能替代插件 `loadData/saveData`、Web Lock、写后回读语义、CAS、跨窗口竞态或真实宿主持久化。
- 本轮没有把方法快照接入 AV 查询、`listContactPage`、UI debounce/AbortSignal、工作台分页或桥能力；现有生产搜索仍以 AV 标量和关系邻居为基础。
- 不决定 D1 事实源，也不新增生产 schema、迁移模块、索引文件或搜索 API。索引失效后的回退是研究状态机，不能直接接入生产。
- `complete` 只表示本次候选输入已完整读完并通过验证，不表示历史方法全集、原生文档范围、用户删除意图或跨存储强一致。
- 当前预算仅为本机纯 Node 观测。真实宿主 IO、冷启动、跨窗口失效、移动端内存、UI 帧和数据删除边界仍需独立 Host Queue 验收。

因此 `AG-RF-004-S4` 收口为 `done_isolated`；D8 和 `AG-RF-004` 继续保持候选，Issue #51/#54 保持开放。


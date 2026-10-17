# 原生人物文档联系方式隔离宿主探针（2026-10-17）

对应 `AG-RF-004-N1`、Issue #51/#54。该探针使用真实 SiYuan Kernel 的 UUID 临时工作区，只写入虚构人物和虚构联系方式；不安装插件、不读取日常库、不改生产联系人模型。

## 实验范围

- 内核：`3.8.8-alpha.2`；临时工作区：`C:\Users\Admin\AppData\Local\Temp\SiYuan-Lvct-Contact-Native-36a235a6-2160-41de-b969-d421bd09ae23`；随机端口：`8347`。
- 创建一个隔离笔记本和两个人物原生文档，每人写入三条候选联系方式段落，共六条。
- 使用 `/api/block/insertBlock` 写入正文和 `custom-lvct-contact-method-*` 属性，使用 SQL 与 `/api/block/getChildBlocks` 回读 `content`、`markdown`、`ial`、`parent_id` 和块类型。
- 停止并重启隔离内核后再次回读；随后只在本临时工作区创建并删除 `data/storage/petal/siyuan-contacts/native-host-spike-cache.json`，再启动内核回读原生块。
- 通过内核原生 `updateBlock` 修改电话值并通过 `deleteBlock` 删除自定义联系方式，再按方法属性回读；这一步是内核 API 编辑证据，不等同于编辑器 UI 操作。后续在另一个 UUID 隔离宿主安装当前 `dist` 插件并走 Chrome `browser-desktop` 编辑器，补充正文读取、改值、删除和重载回读，详见 [MULTI-CONTACT-NATIVE-UI-2026-10-17](MULTI-CONTACT-NATIVE-UI-2026-10-17.md)。两份报告的工作区、夹具身份和证据范围不同。

## 结果

入口脚本：[contact-methods-native-host-spike.mjs](../../scripts/spike/contact-methods-native-host-spike.mjs)；结果：[contact-methods-native-host-results.json](../../scripts/spike/contact-methods-native-host-results.json)。

```text
node --check scripts/spike/contact-methods-native-host-spike.mjs
node scripts/spike/contact-methods-native-host-spike.mjs
```

结果：`hostVerified=true`、`candidateContractAccepted=false`；两个人物文档和六条联系方式首次写读通过，电话值经内核 API 修改、自定义联系方式经内核 API 删除后回读通过，内核重启和清理实验插件缓存后回读也通过。真实内核请求 51 次；本轮唯一插件文件写入是临时工作区中的虚构缓存文件，`productionChanges=false`。每条标记块的 `content` 与 `markdown` 保留类型、标签、主值、完整值和换行；`ial` 保留方法 ID、owner、固定来源键、类型、标签、主值和顺序；`parent_id` 均指向人物文档。

实证观察到：SiYuan 会为每个原生段落分配自己的块 ID，候选方法 ID 应放在自定义属性中，不能把块 ID 当作方法身份。方法值中的换行、斜杠、尖括号、管道、HTML 字符和 emoji 在本次隔离内核写读中保持可回读；同值跨人物仍由 owner 和方法 ID 作用域区分。

## 证据边界

这次结果把 N1 从“纯内存格式”推进到“隔离真实内核块写读/重启/实验缓存清理”证据，但仍不等于生产契约或完整宿主验收：

- 本 API 探针未安装或停用真实插件；另一个 UUID 工作区的 UI 探针安装了 `dist`。两者均未走生产多联系方式服务、AV 投影、迁移、搜索或 vCard 导入导出。
- 编辑器 UI 的正文读取、改值、删除和重载回读已在独立报告中观察；同人物双页面实时刷新与重载及邮箱恢复值 SQL 回读见 [双页面报告](MULTI-CONTACT-NATIVE-MULTIWINDOW-2026-10-17.md)。UI 使用独立 `ui-*` 身份夹具，没有证明 N1 严格候选读取器端到端通过；复制/粘贴载荷、身份边界和多窗口并发仍未验证。真实用户工作区、真机、备份恢复和外部编辑仍未覆盖。
- 插件缓存清理只删除了本轮脚本创建的临时文件；没有删除任何真实用户插件数据。
- 研究候选的属性命名、固定来源键、控制字符规则、主值冲突和删除墓碑语义仍需单独契约决策。

因此 N1 仍保持 `host_pending`，父卡 `AG-RF-004` 继续保持 `candidate`；本证据支持继续做真实宿主编辑器/多窗口研究，不授权接入生产联系人模型或关闭 Issue #51/#54。

# 人物补充资料：生产服务与隔离内核验证

2026-10-17 的本轮验证连接新建 UUID 工作区中的真实 SiYuan Kernel `3.8.8-alpha.2`，调用当前生产 `api/person-fields.ts`、`services/person-fields.ts` 和 `domain/person-fields.ts`。只替换 `siyuan.fetchPost` 的传输入口，使请求发往本轮子进程；未连接日常思源工作区，未安装、提交或发布。

## 证据与运行范围

- 脚本：`scripts/spike/person-fields-spike.mjs`。默认执行、导入与 `--dry-run` 不启动内核、不写工作区、不发 HTTP；显式设置 `LVCT_RUN_PERSON_FIELDS_SPIKE=1` 才运行。
- Run UUID：`b3986e47-2fdd-47df-9709-eb06f79027d0`，时间为 `2026-10-17T02:43:52.775Z` 至 `2026-10-17T02:44:01.110Z`。
- 内核：`D:\RJ\SiYuan\resources\kernel\SiYuan-Kernel.exe`，端口 `5516`；隔离工作区：`C:\Users\Admin\AppData\Local\Temp\SiYuan-Lvct-Person-Fields-b3986e47-2fdd-47df-9709-eb06f79027d0`，全部资料为虚构夹具。
- 原始结果：`scripts/spike/person-fields-results.json`；不可覆盖的本轮结果：`scripts/spike/person-fields-results-b3986e47-2fdd-47df-9709-eb06f79027d0.json`。工作区内另保留 `person-fields-evidence-b3986e47-2fdd-47df-9709-eb06f79027d0.json`。
- 三份结果 SHA256 相同：`8f720d36c2752e6052d8cd3d6afba4c77b158c30f2d179164055ab3bb1987b98`。包含逐次原始请求、响应、快照和来源；未保存 Authorization 头，独立检查未发现本轮 API token。
- 共 `139` 次内核请求，每次均先核实工作区标记与监听端口归属；`139` 次 PID 归属检查。生产服务实际发出 `5` 次块写入，其余夹具写入独立标记来源。
- 本轮两次内核生命周期 PID 为 `31044`、`57784`。结束后独立检查两者均已退出，端口无监听；工作区保留供复查。

## 已通过

- 两个人物分别创建、重新读取补充资料，保留同名同值重复条目、分组、空值与稳定块 ID；HTML 字符、实体文本、引号、字面反斜杠、真实换行、Tab、emoji 和 IAL 形似文本精确往返。
- 人物原文中普通“补充资料”标题及人工正文不误判成结构化快照；同一人物更新沿用原块。清空为持久的 `items: []`，保留原块 ID。
- 外部夹具改变已读快照后，旧基线保存冲突，生产服务零覆盖写入。
- 刻意在本轮更新实际成功后丢弃一次响应；生产服务首次报告未知，再次保存只核实原块 ID 与完整目标快照，零重复写入。
- 把完整标记正文通过 API 复制到另一人物文档、分配新块 ID 后，原 `ownerDocId` 保持不变；新人物读取/保存被阻断，生产服务零写入。此项证明 API 正文副本边界，不代表原生剪贴板操作已验。
- 停止并重启同一隔离内核后，原人物及已清空人物精确读回，副本仍拒绝自动认领；重启阶段生产服务零写入。
- 前后逐块比较三份人物文档原有正文的 ID、root、parent、type、content、markdown，全部保留。

## 本地回归与未验证边界

生产 API/服务回归 `18/18`；补充资料域、服务、人物备注及架构联合回归 `43/43`；`pnpm check` 为 `0 errors / 0 warnings`。脚本语法、默认 dry-run 与 `git diff --check` 通过。

本报告的宿主证据为生产服务到真实隔离内核。组件 UI 使用 mock 回调的浏览器回归应单独报告，不能代替原生人物详情交互证据。真实原生编辑器、多窗口同时写入及 CAS 保证未验证；当前内核无 CAS，读前基线检查和写后核实不能承诺消除两次请求之间的原生编辑器竞争。未知请求状态只保留在当前插件窗口内存中，重启只验证已落库内容的读取。

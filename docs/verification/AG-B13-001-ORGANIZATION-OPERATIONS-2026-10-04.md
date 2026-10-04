# AG-B13-001 组织创建/改名持久断点证据

日期：2026-10-04。范围：剩余组织创建、改名的稳定断点及只读续做。卡状态保持 in_progress；未提交、建分支、发布或连接日常思源。**Host 未验，完整 UI 回归未运行。**

## 契约与实现

仅新增 DATA-CONTRACT §8.5，业务事实不迁移。新键 `organization-operations.json` 经 storage.ts 严格读取、锁及写后回读，保存稳定请求 ID、原笔记本/名称、原唯一标记快照和逐步状态。损坏或未知不会归零覆盖。

创建在 `organization-create` 全局锁内防同名并发；同名只阻止误建，不认领文档。发送前持久 pending，单次 createDocWithMd 的组织段落 IAL 同时含 custom-lvct-org-draft 请求与 custom-lvct-org="1"。响应丢失以请求查唯一块/文档；未找到、重复或未知只读核实，不重建。UI 选返回 docId。

改名与归档共用 organization-state 文档锁，标题和标记分步持久核实。只补 unissued/rejected，pending 不按旧值推断未执行。原标题、标记正文/块 ID、属性、路径、笔记本或归档值变化均不覆盖。更新原段落时保留原 IAL（SQL markdown 不含 IAL），不追加/删除标记或用户正文。标题已到目标而标记未完成时，公共改名入口仍提示原请求未核实，不提前报告成功。

组织管理已接 OrgOperationRecovery；挂载仅读取、核实 pending，安全补做需要点击原请求。读/写忙态共用关闭保护，卸载后迟到结果不更新。组织身份/成员姓名查询直接 getRoster，避免 listContacts 的 people-profiles 派生读取递归。

## 独立内核实证

脚本：`scripts/spike/organization-operations-spike.mjs`；机器结果：`scripts/spike/organization-operations-results.json`。

- 思源内核 v3.8.6，workspace 为临时目录下独立 UUID，随机空闲端口 6458，回环地址；没有访问默认端口或日常工作区。
- 成功工作区：`C:\Users\sunku\AppData\Local\Temp\SiYuan-Contacts-Org-Operations-5fca4d6c-0e82-4f48-a704-6498e2f421b1`。
- 原子创建文档 `20261004075952-xjk7hl0`；请求 `20261004000000-orgreq1`；唯一组织段落 `20261004075953-tv2xs97` 同时含两个属性。
- 退出本轮独立内核、确认端口释放、用同一独立 workspace 重启，按请求读到完全相同唯一块及文档。
- 用实际物理路径改名，再更新原块（Markdown + 原 IAL），原块 ID、请求属性、活跃属性和“用户正文保留”都在。
- 首轮新增验证发现 createNotebook 返回不含 id，改用已实证 lsNotebooks；第二轮发现 SQL markdown 不含 IAL，直接更新会丢属性。最终脚本和生产更新都显式保留 IAL，最终运行 exit 0。没有靠忽略断言或增加替代标记绕过问题。

## 定向验证

| 检查 | 结果 |
|---|---|
| `node --test tests/organization-writes.test.ts tests/organization-scan.test.ts tests/architecture.test.ts` | 24/24 通过：16 项新组织操作测试 + 3 扫描 + 5 架构 |
| `pnpm check:types` | 最后运行 exit 0，两个 tsconfig 都通过 |
| Svelte compiler 单独编译 OrgManagerDialog / OrgOperationRecovery | 均通过，零 warning |
| `node --check scripts/e2e/ui/organization-operations-regression.js` | 通过 |
| 完整 `pnpm check:svelte` | 较早运行受其他 worker 的 RelationshipLabels/RelationGraph 未完成改动影响；组织组件零诊断；最后全局检查交主代理 |
| 完整 UI / Host / 多窗口真实一致性 | 未运行 / 未验 / 未验 |

定向测试实际调用 services/api/data，经受控思源传输替身验证：pending 回读先于内核、回读失败零发送、发送前崩溃保留未知、响应丢失核实、旧请求重开、同名并发仅一次创建、明确拒绝重试、重复标记、锚点移动、原标题/正文/归档/路径变更零覆盖、只补失败步骤、标题核实后断点回读未知不得继续写标记、归档/改名串行且保留请求属性、非法名称先于插件句柄检查。

## 主代理接线

1. migration coverage 登记 `{ key: "organization-operations.json", status: "excluded", reason: "本工作区组织创建/改名操作断点，不跨库重放" }`；worker 未改 migration-bundle。
2. smoke.js 最终接入 `import { runOrganizationOperationsRegression } from "./organization-operations-regression.js"`，并调用 `await runOrganizationOperationsRegression({ test, assert, fixture, until, button })`。新模块导出 run 函数，worker 未改 smoke.js 或运行完整 UI。
3. package.json 的显式 test 清单加入 `tests/organization-writes.test.ts`（worker 未改 package.json）。
4. 组织 facade 已接 create/rename 的 plugin 参数及 listPendingOrganizationOperations / inspectOrganizationOperation / resumeOrganizationOperation；types/index 只修改组织 facade/import 片段，无额外插件绑定。
5. organization-health-regression.js 仅补组织归档新只读查询的严格夹具字段；其他现有回归未修改。原 text-encoding 回归的非法名称入口仍先校验，无插件句柄也不会改为存储未绑定错误。
6. 最后跑完整类型/Svelte/UI，确认新回归的返回 docId 选择、pending 重开零重放、明确拒绝点击才补、坏断点/卸载迟到结果。真实 Host 重启、两窗口共享 Web Lock 及加载/保存事件仍需另验，不据隔离证据关闭整卡。

本次新增/修改文件只在组织约定范围。backlog、UI-REGRESSION、DECISIONS、PROGRESS、migration-bundle、smoke.js 与 people/roster/filter/graph/import 文件均未由本 worker 修改。

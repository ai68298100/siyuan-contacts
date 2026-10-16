# Host Queue 增量验收（2026-10-16）

本次运行使用 `node scripts/e2e/services-flow.mjs`，由脚本创建 UUID 隔离工作区和随机端口，内核版本为 v3.8.8-alpha.1；未连接用户日常工作区。

复现任务对账的命令是：

```powershell
$env:LVCT_E2E_EVIDENCE_FILE = "output/host-queue-v0516-tasks.json"
node scripts/e2e/services-flow.mjs
```

## 结果

- 实际产品服务：11/11 通过。除原有 9 项外，新增 9 条跨日期原生任务的全量对账：完成 6 条、取消勾选并重新完成历史项、文档改标题/日期、内核原生删块、产品取消并保持文档、首页服务逐项核对、一次受控任务读取失败（9 项 document=unknown 且索引未变）及恢复重试；重启后再次核对为索引 9、文档 7、首页 2。
- browser-desktop：`LIMITED`。本次显式使用 Chrome 隔离 profile；插件成功安装并加载，桥 protocol 2、稳定 ref 建档、工作台入口、生日编辑保存、账本新建/结清/重开、别名和跟进均通过；随后在组织工作台等待超时，捕获和跨窗口步骤未执行。
- 账本竞态已定位并修复：宿主 `putFile` 返回 200 后，紧接的 `/api/file/getFile` 多次返回 HTTP 202；旧父级刷新会重复初始化账本组件并丢掉已确认记录。`ExchangeLedger` 现在只在人物文档 ID 真正变化时重置，并在写入响应后立即保留确认记录。复跑证据 `output/host-queue-v0516-frontend-after-guard.json` 显示账本条目从 1 条收敛到 2 条，状态结清/重开均回读成功；Network 诊断只记录请求元数据，不读取响应正文。

## 组织导航复跑

随后修复真实前端 E2E 的关闭时序：组织入口前先通过人物详情自己的关闭按钮，并在详情关闭守卫处于忙态时重试关闭；若测试残留草稿触发守卫，仅放弃本轮测试草稿后再导航。点击组织入口后立即记录活动导航、详情弹窗和守卫状态。

- `output/host-queue-v0516-frontend-after-close-fix3.json`：实际产品服务 `11/11`，真实 `browser-desktop` 前端 `PASS`。
- 组织工作台、改名、成员编辑、归档、恢复、刷新、页面重载和同源双页面组织改名均通过；导航诊断为 `activeNavigation=orgs`、详情/对话框/关闭守卫均已消失。
- 多窗口人物与互动 ref 幂等通过；捕获 UI 仍未完成，组织成员投影和组织成员/归档双窗口专门核对仍待真实宿主条件。
- 修改仅涉及 `scripts/e2e/frontend-flow.mjs` 与本验收记录；未接触用户日常工作区。隔离 Chrome 使用 Google Chrome 独立 profile。

## 结论

本次结果补齐了 `AG-HOST-003` 的隔离真实内核增量证据，并收口了账本真实 UI 回读竞态与组织导航关闭时序；整卡仍为 `host_pending`：真实用户工作区、原生编辑器交互、其他任务管理器互读、原生图、真机、捕获 UI 和组织成员投影专门双窗口核对仍未验。`AG-HOST-006` 继续保持 `host_pending`，组织工作台等待超时已在隔离 E2E 中复跑通过。

任务对账原始 JSON 由本轮命令写入本地 `output/host-queue-v0516-tasks.json`；Chrome 前端复核先后写入 `output/host-queue-v0516-frontend-after-guard.json` 和 `output/host-queue-v0516-frontend-after-close-fix3.json`（均为构建输出目录，未纳入版本控制）。

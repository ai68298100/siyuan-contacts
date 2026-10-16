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

## 结论

本次结果补齐了 `AG-HOST-003` 的隔离真实内核增量证据，并收口了账本真实 UI 回读竞态；整卡仍为 `host_pending`：真实用户工作区、原生编辑器交互、其他任务管理器互读、多窗口、原生图和真机仍未验。`AG-HOST-006` 继续保持 `host_pending`，本轮剩余阻塞点是组织工作台等待超时及尚未覆盖的宿主边界。

任务对账原始 JSON 由本轮命令写入本地 `output/host-queue-v0516-tasks.json`；Chrome 前端复核写入 `output/host-queue-v0516-frontend-after-guard.json`（均为构建输出目录，未纳入版本控制）。

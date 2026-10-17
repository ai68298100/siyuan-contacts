# 组织管理后台页 RAF 卡死修复

任务：`AG-HOST-002-RAF`；2026-10-17；未提交、未发版。

## 复现与根因

真实 Chrome 同源双页面验收发现：打开第二页后，第一页组织管理的成员写入长期显示保存中，改名、归档、资料编辑和关闭均不可用；第二页本身可用。

`OrgManagerDialog.restoreViewport` 在 `tick()` 和即时视口恢复之后，无界 `await requestAnimationFrame`。后台页 RAF 可暂停，导致 `loadMembers → loadOrgs → run` 无法退出，`memberLoading`、`organizationsRefreshing` 和 `formBusy` 不能正常收口。数据写入完成与视口绘制等待发生了不必要的耦合。

## 本次变更

- 保留 `tick()` 后的立即滚动和焦点恢复，以及原有请求代次和卸载守卫。
- 已在后台的页面跳过第二帧修正；可见页面等待下一帧，同时设置 100 ms 回退。
- 等待中转入后台时立即释放等待；RAF、计时器、可见性监听和待处理集合一并清理。
- 组件卸载时释放尚在等待的帧；迟到回调不重新滚动或移动焦点。

本次仅改组件视口恢复，不改组织事实、写入流程、数据事件协议或存储契约。100 ms 是计时器回退值，不是浏览器冻结时的绝对实时保证；页面恢复执行后可正常继续收口。

## 定向验证

`pnpm check`：0 errors / 0 warnings。

```powershell
$env:LVCT_UI_FILTER='组织上下文|组织管理：'
pnpm test:ui
```

桌面 Chrome：13/13，退出 0。

```powershell
$env:LVCT_UI_FILTER='组织上下文|组织管理：'
$env:LVCT_UI_MOBILE='1'
pnpm test:ui
```

390px Chrome：13/13，退出 0。

新增两条真实 Svelte DOM 回归，不向 RAF stub 投递任何帧：

1. 页面保持可见但 RAF 暂停，通过计时器回退完成只读刷新和成员保存。
2. 刷新已进入帧等待后切换为隐藏并发出 `visibilitychange`，完成等待，后续成员保存也不依赖后台帧。

两种情况均验证：保持原组织和成员窗口、搜索/状态、刷新时的滚动与焦点；外部事件不覆盖成员草稿；仅写一次且保留编辑基线；保存回读后 busy 解除，改名/归档/编辑资料/关闭恢复可用；已取消帧被强制迟到调用后，不干预用户后续滚动或焦点。

既有组织上下文测试同时覆盖分页与全量 facade 的 600 条窗口、故障/失联保留身份、草稿守卫、事件合并和人物返回焦点。初轮新增用例使用只在提示状态出现的“重新读取组织和成员”作为等待信号而失败；改为持续存在且同时受成员/组织刷新状态保护的“编辑资料”按钮后重跑通过，生产实现没有因该夹具修正而放宽守卫。

## 完整回归与真实隔离宿主复测

完整桌面 Chrome UI：`pnpm test:ui` 389/389，通过。

重建插件后，在新 UUID 工作区、随机端口和 Chrome profile 上使用实际 `3.8.8-alpha.2` 内核复测：服务 11/11；真实 browser-desktop 同源双页面的组织改名、成员编辑、归档和恢复全部原地刷新通过。写入前第一页 `visibilityState=hidden`、`busyCount=0`，覆盖了原先卡住的后台页情形，最终无捕获/组织 limitation。证据见 [HOST-ORG-DUAL-WINDOW-2026-10-17.json](HOST-ORG-DUAL-WINDOW-2026-10-17.json) 和 [HOST-QUEUE-2026-10-17.md](HOST-QUEUE-2026-10-17.md)。

对照扫描生产源码其余 RAF 用法：联系人虚拟列表/卡片测量与图谱尺寸更新均用于异步绘制，不在保存 busy 的 await 链中，本轮未发现另一处相同阻塞。

本卡收口为 `done_isolated`，父卡 `AG-HOST-002` 仍为 `host_pending`。以上真实内核浏览器证据不能替代组织成员对应人物文档投影的专门双页、真实用户工作区、原生思源多窗口或真机验收。

回滚只移除本卡的帧等待集合、有界等待代码和两条新增回归，保留同文件中此前的组织移除/入口等未提交变更。保护文件 version、CHANGELOG、README 徽章和 `docs/PROGRESS.md` 本卡均未触碰。

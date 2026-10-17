# Host Queue 增量验收（2026-10-17）

本轮仍只使用脚本创建的 UUID 隔离工作区和随机端口，没有连接用户日常工作区。

最终增量结果：实际服务 11/11、Chrome browser-desktop 通过；两人重复捕获及五侧幂等回读通过；组织改名、成员编辑、归档和恢复的双页面刷新全部通过。完整桌面隔离 UI 389/389。`AG-HOST-002/006` 保留后文列出的未验边界。

## 续跑校准（Kernel 3.8.8-alpha.3）

2026-10-17 的续跑使用全新 UUID 隔离工作区、随机端口、受控文件存储和独立 Chrome profile，`realFrontend=true`。本轮只保存脱敏摘要，见 [SERVICE-KERNEL-2026-10-17-ALPHA3-SUMMARY.json](SERVICE-KERNEL-2026-10-17-ALPHA3-SUMMARY.json)；此前的 [SERVICE-KERNEL-2026-10-17.json](SERVICE-KERNEL-2026-10-17.json) 仍保留 alpha.2 历史原始证据，不覆盖历史运行。

- 实际产品服务 `11/11` 全部通过；9 条跨日期任务完成索引、文档、首页逐项对账，并通过编辑、完成、删除、受控故障恢复和内核重启回读。
- 真实 `browser-desktop` 通过，桥 protocol 2；生日、账本、别名、跟进、组织操作、页面重载回读及人物/互动 ref 双页面幂等均通过。
- 捕获界面识别 `2` 个候选；提交前后互动均为 `2` 条，原互动 ID 保留，来源、当日日记、地点和双方人物五侧各保留 `1` 个投影标记，结果页完成且弹窗正常关闭。
- 组织改名、成员编辑、归档、恢复及第二页面原地回读全部通过；首页面写入前处于后台，未再出现无界 `requestAnimationFrame` busy。
- 本轮仍是隔离宿主证据：`nativeEditorUi=false`、任务管理器读取为服务层核验，未覆盖真实用户工作区、原生编辑器交互、其他任务管理器互读或 Android 真机。

同日补跑的 `AG-HOST-001` Kernel 图 spike 也已完成：真实 `3.8.8-alpha.3` 返回 `getGraph/getLocalGraph` 形状，虚构夹具的两条 refs 前向边和反向回链通过；普通 Markdown `siyuan://blocks` 不生成 refs。该轮没有打开原生图面板，摘要见 [AG-HOST-001-GRAPH-KERNEL-2026-10-17.json](AG-HOST-001-GRAPH-KERNEL-2026-10-17.json)，因此 `AG-HOST-001` 仍保持 `host_pending`。

运行命令：

```powershell
node scripts/e2e/services-flow.mjs
$env:LVCT_REAL_FRONTEND = "1"
node scripts/e2e/services-flow.mjs
```

## 首轮结果（历史，已由下方增量替代）

- 实际产品服务：11/11 通过；覆盖联系人创建、设置重绑、生日连续保存与清空、多人事项和重复捕获、账本、别名、组织成员接替、迁移包、9 条跨日期原生任务对账、受控读取失败和内核重启回读。
- 真实 browser-desktop：`PASS`，内核版本 `3.8.8-alpha.2`，桥 protocol 2；生日、账本、别名、跟进、组织改名/成员编辑/归档/恢复、页面重载回读、人物和互动 ref 双页面幂等均通过。
- 捕获来源文档已通过 `openFileByURL` 打开，编辑器可达；捕获命令面板可达，但真实捕获弹窗仍超时，未将捕获 UI 标记为完成。
- 组织改名跨窗口已通过；组织成员编辑跨窗口和组织归档跨窗口仍未核实，保持 `host_pending`。

当日首轮差异保留在下文的双页面增量摘要；[SERVICE-KERNEL-2026-10-17.json](SERVICE-KERNEL-2026-10-17.json) 已更新为最终复跑完整证据。该文件只包含虚构数据、端点结果和状态诊断，不包含用户工作区内容。

## 捕获与组织双页面增量

前述结果是当日首轮快照。增量重建当前工作区产物后，继续使用脚本新建的 UUID 工作区、随机端口和独立 Chrome profile：

```powershell
pnpm build
$env:LVCT_REAL_FRONTEND = "1"
$env:LVCT_TEST_BROWSER = "C:/Program Files/Google/Chrome/Application/chrome.exe"
$env:LVCT_E2E_EVIDENCE_FILE = Join-Path $env:TEMP "lvct-host-org-after-background-frame-fix.json"
node scripts/e2e/services-flow.mjs
```

- 真实内核实际服务仍为 `11/11`，Chrome `browser-desktop` 为 `PASS`，内核版本 `3.8.8-alpha.2`；该段保留为本轮增量前的历史快照。最新续跑已在上方校准为 `3.8.8-alpha.3`。
- 捕获驱动此前等待 Workbench 的 `.lvct-dialog-panel`，实际捕获通过宿主 `svelteDialog` 挂载在 `.b3-dialog .lvct-dialog-root`；下一步和提交表达式也未正确执行按钮点击。现已按捕获容器定位，显式点击，并通过正常关闭/离开确认清理本测试弹窗。
- 原来源夹具只有普通正文和生成的 Markdown `siyuan://blocks` 投影，缺少 `refs` 前置；普通 Markdown 链接不会产生原生引用索引。夹具正文现加入两个虚构人物的原生块引用，真实捕获界面核实到 `2` 个候选后，以原日期和地点完成重复提交。提交前后互动均为 `2` 条，原事件 ID 保留；来源、当日日记、地点和双方人物共五侧标记分别为 `1`，没有重复互动或投影。捕获结果页与正常关闭均通过。
- 双页面专门复核通过组织改名、成员职位编辑、归档及恢复，第二页面均原地回读，无浏览器重载。测试记录第一页面写入前 `visibilityState=hidden`，覆盖后台页场景。
- 本轮发现并修复组织弹窗的无界 `requestAnimationFrame` 等待：此前后台页在组织改名已持久化后仍一直 busy，编辑、归档和关闭全部禁用。修复后后台跳过额外绘制帧，前台等待设有上限；专门 UI 回归覆盖暂停帧及等待期间转后台。

前后诊断及最终脱敏摘要保存在 [HOST-ORG-DUAL-WINDOW-2026-10-17.json](HOST-ORG-DUAL-WINDOW-2026-10-17.json)，只记录固定 UI 结构、操作状态、数量与虚构数据核对结果；不保存人物内容、工作区路径或认证信息。首轮的捕获超时与成员/归档双页面未核实，已由上述增量证据替代。

## 结论

本轮补齐了 `AG-HOST-003` 的 11/11 隔离真实内核证据；增量又补齐真实 browser-desktop 捕获重复提交闭环，以及组织成员编辑、归档和恢复的双页面原地回读。`AG-HOST-002/006` 仍不能转为 `done`：组织成员对应人物文档投影的第二页面专门核对、关闭窗口后的迟到事件、真实用户工作区、原生图和真机行为仍待宿主条件。

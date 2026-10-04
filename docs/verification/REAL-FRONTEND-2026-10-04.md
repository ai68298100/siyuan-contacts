# 2026-10-04 真实 browser-desktop 隔离验收

## 范围

本次验收使用随机回环端口、UUID 临时思源工作区、独立浏览器 profile 和 SiYuan Kernel v3.8.6。未连接日常工作区，未使用真实用户联系人或往来正文。浏览器通过真实 `browser-desktop` 加载隔离插件包，内核请求使用产品 API 和真实存储/文档回读。

## 结果

`SERVICE-KERNEL-2026-10-04.json` 的 `frontend.ok=true`，真实服务链 `9/9`。浏览器逐项通过：

- 生日编辑、保存和详情回读。
- 往来账本新增、结清、重新打开和详情回读。
- 有效别名保存；“王总”泛称被拒绝并显示错误。
- 跟进计划新增、完成，并在真实内核任务块中核实 `custom-lvct-followup`。
- 组织工作台打开、改名、成员部门/职位编辑、归档、恢复和组织卡片刷新。
- 页面重载后账本、别名和跟进记录回读。
- 两个同源浏览器页面并发使用相同人物/互动 `ref`，分别收敛为一个稳定人物和一条互动事实。
- 已尝试使用隔离真实宿主打开多人事项来源文档并进入捕获弹窗；宿主 `openFileByURL` 调用返回 `Uncaught`，因此该 UI 子旅程保留为 `host_pending`，没有用 fixture 结果替代。

截图：

- `output/playwright/real-frontend-organization.png`
- `output/playwright/real-frontend-detail.png`

## 边界

多人事项的真实服务层已验证来源、当日日记、地点、人物双链和重复捕获；真实 browser-desktop 已实际尝试 UI 入口，但宿主打开来源文档时抛出 `Uncaught`，所以多人事项仍不能标记为真实 UI 全部完成。组织改名的双窗口原地刷新已通过；成员字段、归档状态和人物投影的双窗口刷新、真实用户工作区、原生图面板、真实移动设备软键盘/安全区/系统返回仍属于 Host Queue。

## 2026-10-05 隔离前端复核

重新执行 `LVCT_REAL_FRONTEND=1 node scripts/e2e/services-flow.mjs`。实际产品服务保持 `9/9`，真实 `browser-desktop` 前端 `realFrontend=true`。本轮确认：

- 页面重载后账本、别名、跟进和组织状态均能回读。
- 两个同源页面的稳定人物 `ref` 和互动 `ref` 仍分别收敛为同一人物和一条互动事实。
- 第一页面改名组织后，第二页面通过宿主数据变化事件原地回读新名称，无浏览器重载。
- 生日、账本新增/结清/重开、别名保存及泛称拒绝、跟进任务块核实、组织改名/成员编辑/归档/恢复全部通过。
- 捕获来源文档仍由真实宿主 `openFileByURL` 返回 `Uncaught`，因此捕获右键菜单、弹窗和完成提交保持未验；成员字段、归档状态和人物投影的双窗口刷新也未验；这不是用 mock 结果替代宿主证据。

本轮证据仍使用随机端口、UUID 隔离工作区和独立浏览器 profile，完整 JSON 回读见 `SERVICE-KERNEL-2026-10-04.json`。

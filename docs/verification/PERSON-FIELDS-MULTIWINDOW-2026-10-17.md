# 人物补充资料：真实双页面冲突与同名隔离

## 最终 guard 构建联合验收

最新构建的联合轮 `a4340d07-454b-47a7-86d7-360098f37c60` 全部通过。`dist/index.js` SHA256 为 `b2b6cbe477946610932b1c076f7114d21e8f35100fe16e5e45a45b83f70774ec`，包含详情筛选、标准复制、DOM fallback 和跨工作台复制防重入。真实 Chrome `browser-desktop` 的生产 UI、生产服务与 SQL 同轮核实以下闭环；组件及保存回调均未替换：

- 个人备注实际 UI 创建再更新特殊字符/多行，关闭详情后重开，原块 ID、完整正文及生产 `loadPersonNote`、SQL 一致；补充资料同样实际创建分组和两个同名电话，保存/关闭/重开，完整快照及原块一致。
- 输入“仅工作日联系”后，真实筛选结果为 `1 / 2`，通过稳定条目 UUID 核实只保留第二条电话。
- 显式点击生产复制按钮，标准 Clipboard API 复制完整多行值；临时令当前测试页面的 `navigator.clipboard` 不可用，再点击同一生产按钮，真实 `execCommand('copy')` fallback 同样复制完整内容，并恢复原输入框焦点、选区。
- 剪贴板权限只授予本轮隔离 origin。每次读取前先写入本轮虚构哨兵；原有剪贴板内容未读取、输出或保存。结果只记录与预期的比较布尔值和长度。Windows 返回 CRLF：原始严格比较 `false`，仅把 CRLF/CR 统一为 LF 后完整严格比较 `true`，读取长度 `19`、原值长度 `18`。标准复制和 DOM fallback 的诊断一致；未 trim、截断或改变其他字符，生产服务另行核实原存储值。
- 筛选后进入编辑仍显示完整 `3` 项（含分组），修改原来不匹配的第一条电话再保存；原块、全部 UUID、次序、父子关系及完整三项快照保持，未仅保存筛选子集。
- 甲页保留未保存草稿，乙页保存同一人物；甲保存显示基线冲突，草稿保留，甲页块写请求增量 `0`。甲点击重新读取并在真实关闭守卫选择放弃草稿，编辑新基线后成功保存到原块。
- 两个姓名相同但 docId/itemId 不同的人物按稳定 itemId 进入。第二人物从空资料独立保存，服务/SQL 验证两个独立块、正确 owner/root/parent；第一人物资料及个人备注未被第二人物改变。

最终结果：`docs/verification/PERSON-FIELDS-REAL-UI-a4340d07-454b-47a7-86d7-360098f37c60.json`。与 UUID 工作区内结果备份 SHA256 相同：`3070cc4acc91ca6b64424ade3ca19b6192618b0920dc1cabbd98d1cb2ea338bd`。结果含 `personFieldsFilterCopy` 和 `personFieldsMultiWindow` 的全部通过标志、复制换行诊断、完整服务状态与最终 SQL；未发现本轮 API token。

运行 `2026-10-17T03:17:03.323Z` 至 `2026-10-17T03:17:24.773Z`，SiYuan Kernel `3.8.8-alpha.2`，端口 `13280`；Node 验证侧 `125` 次请求、`125` 次监听归属核验，不包含浏览器直接宿主请求。第二页面已关闭，Kernel PID `65304`、Chrome PID `63368` 均退出，端口无监听，独立 profile `lvct-ui-A50pxH` 已删除；脚本结束后独立复核全部通过。虚构工作区及证据保留。

截图目录：`C:/Users/Admin/AppData/Local/Temp/SiYuan-Lvct-Person-Fields-UI-a4340d07-454b-47a7-86d7-360098f37c60/person-fields-ui-artifacts/`。已独立目检 `person-fields-detail-reopened.png`、`person-fields-stale-baseline-conflict.png`、`person-fields-conflict-recovered.png`：多行值、冲突反馈及恢复后两条电话可读。

执行入口仍为 `LVCT_RUN_PERSON_FIELDS_REAL_UI=1`，另开启 `LVCT_PERSON_FIELDS_MULTIWINDOW=1`、`LVCT_PERSON_FIELDS_FILTER_COPY=1` 后运行 `node scripts/e2e/person-fields-frontend-flow.mjs`。默认不开启时不启动或写入。最终脚本语法及本轮文件 `git diff --check` 通过。

## 新构建首两轮的准确断点

- `84b605c3-898c-4b0f-b0b9-8626aa3f5020`：筛选成功且生产 UI 显示复制成功，runner 用 LF 原值直接比较 Windows CRLF 剪贴板值而超时；未到 DOM fallback 或双页场景。已补仅换行规范化的完整比较与布尔/长度诊断，没有修改生产复制逻辑。Kernel PID `57556`、Chrome PID `66000` 已退出，端口释放，profile 删除，结果保留。
- `80e2fac2-9cc5-4d8b-a9b9-61930039b977`：筛选、标准复制、真实 DOM fallback、焦点选区恢复及全量编辑保存均通过；双页基线冲突保留草稿且零块写通过。甲放弃重读后已显示乙页值，但 runner 用“没有任何 data-field-id”判断退出编辑；新只读行也保留该属性，因此断言超时。已改为仅判断 `.lvct-person-fields__item` 编辑卡片不存在。Kernel PID `64264`、Chrome PID `56608` 已退出，端口释放，profile 删除，结果保留。最终 guard 构建在这些修正后完成整条联合验收。

## 早期双页独立证据

真实 Chrome `browser-desktop` 双页面验收 `fe2dbd81-ded2-4170-8c90-f7d3de8973a2` 通过。沿用本轮虚构人物 UI 建档、备注和补充资料场景，在同一新建 UUID 工作区中打开第二个真实宿主页面。未替换 UI 组件或保存回调，未连接日常工作区。

## 实际验证

- 甲页打开人物 A 的补充资料，修改第一条电话为“甲页未保存草稿”，保留未保存编辑状态。乙页按稳定 `itemId` 打开同一人物，修改为“乙页已保存值”并保存；生产服务核实原块 ID 和全部条目快照。
- 甲页点击保存后显示“补充资料已在其他窗口变化，请重新读取后再保存”，textarea 中仍为甲页草稿。CDP 网络记录显示本次甲页保存的 insertBlock/updateBlock/deleteBlock 请求增量为 `0`，生产服务仍回读乙页快照。
- 甲页点击重新读取，在真实关闭守卫中选择放弃草稿，看到乙页已保存值；再编辑保存为“甲页重读后保存值”。完整快照、原块 ID `20261017110339-pau5agj`、分组及条目 UUID 保持一致。
- 乙页关闭详情后，按另一稳定 `itemId` 打开同名人物 B。人物 A/B 姓名相同，docId 分别为 `20261017110333-tz43v3s`、`20261017110333-xyry8sk`。人物 B 初始为空资料，经真实 UI 新增并保存“同名人物独立值”，形成独立块 `20261017110344-secbyqb`。
- 生产服务及 SQL 核实两个人物各有唯一补充资料块、正确 owner/root/parent；人物 B 保存未改变人物 A 的完整补充资料及特殊字符/多行个人备注，人物 B 备注保持为空。

本轮未发现需要修改主源码的缺陷。验证的是插件页面之间的旧基线冲突阻断与显式恢复，不是原生编辑器 CAS 或同时写请求的原子性证明。

## 证据与清理

- 执行：`LVCT_RUN_PERSON_FIELDS_REAL_UI=1 LVCT_PERSON_FIELDS_MULTIWINDOW=1 node scripts/e2e/person-fields-frontend-flow.mjs`（PowerShell 通过对应 `$env:` 设置）。
- 结果：`docs/verification/PERSON-FIELDS-REAL-UI-fe2dbd81-ded2-4170-8c90-f7d3de8973a2.json`。同 UUID 工作区内的结果备份 SHA256 相同：`d8f3bd6027ce7eeba561f61bd7133f1ffa85772443b6cbcef62b045abc0bf61a`。
- 工作区：`C:/Users/Admin/AppData/Local/Temp/SiYuan-Lvct-Person-Fields-UI-fe2dbd81-ded2-4170-8c90-f7d3de8973a2`，全部虚构数据及原始结果保留。
- SiYuan Kernel `3.8.8-alpha.2`；构建 `dist/index.js` SHA256 为 `03babeb6c1a53d15749d7cbdea190e9e6bcd7cf0d1d474ad16d9f6744dbaa7ba`。
- 运行时间 `2026-10-17T03:03:31.092Z` 至 `2026-10-17T03:03:46.567Z`；Node 验证侧 `122` 次内核请求、`122` 次监听归属核验，不包含浏览器直接请求。
- 第二页面已关闭。内核 PID `59776`、Chrome PID `49000` 均已退出，端口 `9196` 无监听，独立 profile `lvct-ui-GstjPs` 已删除；脚本后独立只读复核通过，结果未发现 API token。

为改善冲突提示截图，后续 `876a1124-ec5d-45d2-ba00-1a54e13d9637` 加入页面置前。该轮旧基线冲突、零写入、放弃重读和再次保存仍通过，切换另一同名人物时即时 UI 空态断言未等待后台刷新而停止；此轮不作为同名隔离通过证据。失败结果保留，Kernel/Chrome 均退出、端口释放、profile 删除。runner 已将该断言改为等待真实空态并记录独立人物的初始服务状态，等待新构建后的联合回归。

## 边界

尚不包含日常用户工作区、Android 真机、原生编辑器并发、未知请求重启恢复或多窗口 CAS。筛选与复制以上方最终 guard 构建联合轮为准；早期结果仅保留当时通过范围。

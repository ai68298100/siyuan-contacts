# 人物补充资料与个人备注：真实 Chrome browser-desktop 验收

最终联合轮 `11ae793b-2daf-436d-b8eb-06cfe59702a6` 通过。使用真实 SiYuan Kernel `3.8.8-alpha.2`、随机回环端口 `8091`、新建 UUID 工作区及独立 Chrome profile，安装当前 `dist`。浏览器运行真实宿主 `browser-desktop` 和生产插件，未替换组件或其加载/保存回调；只在 Node 验证侧把思源 SDK 传输入口接到本轮内核。未连接日常思源，所有人物与号码均为虚构资料。

## 验收动作与结果

1. 经顶部栏进入工作台、联系人列表、虚构人物详情。在个人备注实际输入初值并点击“保存备注”，核实唯一备注块；再实际编辑为含 HTML 形似文本、`&amp;`、引号、反斜杠、字面 `\n`、真实多行、emoji、IAL 及任务形似文本的备注，再次保存。生产 `loadPersonNote` 与 SQL 均核实全文及原块 ID `20261017105429-11yx6p2`，确认更新没有新建第二块。
2. 点击“编辑补充资料”，实际新增一个分组、两个同名“电话”条目并选入该分组；第二个号码附有一行联系说明。
3. 点击保存，等待产品显示“补充资料已保存”。逐项读取真实 UI 展示的名称和完整内容，与输入精确比较。
4. 通过详情的真实关闭按钮退出，重新点击同一人物入口打开；再次比较个人备注 textarea 的完整特殊字符/多行内容，以及两个同名电话与多行值。
5. 保存后和重开后均调用当前生产 `loadPersonFields`；两次块 ID 都为 `20261017105431-wszmq9a`。SQL 再核实唯一标记块、直接 root/parent 归属，并解析正文与 UI 输入的完整三项快照逐项精确比较，包括条目 UUID、分组 UUID、顺序、名称、值和父关系。个人备注同样再次经生产服务和 SQL 核实原块及全文。
6. 保存前后比较人物原有正文块的 ID、root、parent、type、content、markdown，全部保留。

最终补充资料证据中 `saved`、`detailClosed`、`detailReopened`、`serviceAndSqlVerified`、`originalNativeBodiesPreserved` 均为 `true`；个人备注的 `saved`、`sameBlockUpdate`、`detailReopened`、`serviceAndSqlVerified` 也全部为 `true`。独立查看两张重开后的截图，个人备注特殊字符/多行、分组、两个“电话”标签、两个号码及第二项换行均完整可见，没有横向裁切。

## 证据、重现与清理

- 入口：`LVCT_RUN_PERSON_FIELDS_REAL_UI=1 node scripts/e2e/person-fields-frontend-flow.mjs`。默认执行不启动内核、不写工作区；复用 `frontend-flow.mjs` 的真实前端安装/认证、浏览器启动和清理路径，仅运行 `personFieldsOnly` 场景。
- 结果：`docs/verification/PERSON-FIELDS-REAL-UI-11ae793b-2daf-436d-b8eb-06cfe59702a6.json`，与保留工作区内同 UUID 结果 SHA256 相同：`039cc67b909ab6ea13985dd7f40e9f9435e3d8f5b9756c4752c8e2ad063795d3`。结果含实际 UI 快照、生产服务多次回读、完整 SQL 行和构建文件 SHA256。
- 截图目录：`C:/Users/Admin/AppData/Local/Temp/SiYuan-Lvct-Person-Fields-UI-11ae793b-2daf-436d-b8eb-06cfe59702a6/person-fields-ui-artifacts/`，文件为 `person-note-detail-reopened.png`、`person-fields-detail-reopened.png`。
- 执行时间：`2026-10-17T02:54:22.603Z` 至 `2026-10-17T02:54:34.718Z`。
- Node 验证适配器发出 `92` 次内核请求，每次对应监听端口 PID 归属核验；该计数不包含浏览器自身的直接宿主请求。
- 内核 PID `34552`、Chrome PID `26496` 均已退出；端口 `8091` 无监听，Chrome profile `C:/Users/Admin/AppData/Local/Temp/lvct-ui-pR7D3X` 已删除。以上均在脚本完成后独立只读复核。
- UUID 工作区及原始结果保留；结果未发现本轮 API token。脚本语法检查与本轮文件 `git diff --check` 通过。

首轮 `e40bbea1-9d16-4660-8011-68295d06aa43` 在初始化存储适配器时失败，尚未开始浏览器场景；内核启动会初始化 petal 存储目录，已依现有 services runner 在 boot 后创建测试目录。失败结果与工作区保留，PID `65048` 已退出、端口释放。`50be20d7-c486-41a0-ae01-4e9797dd9093`、`b498000e-dfc9-4fd4-b3a2-9d3c377abb2d` 已通过单独补充资料场景。补入个人备注后，`19a9683f-9589-4ba4-a799-2ba350fffc29` 的初值已成功保存，runner 在产品正常 revision 回读期间过早寻找第二次输入框而失败；已等待 textarea 恢复后再编辑，未改产品代码。其 Kernel/Chrome 均退出、profile 删除、端口释放，原失败证据保留。

## 范围

这是当前补充资料功能在真实隔离宿主中的单窗口 UI 验收，独立于 mock UI 回归及生产服务的重启/丢响应/副本测试。未验证日常用户工作区、Android 真机、原生剪贴板、真实原生编辑器并发或多窗口 CAS；不把补充资料等同于正式联系方式、快捷联系或 vCard 多值导入/导出。

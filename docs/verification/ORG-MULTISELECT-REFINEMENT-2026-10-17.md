# 组织选择体验续优化（2026-10-17，本地未发布）

延续统一多选与真实新建，在原有成员事实、创建身份和未知结果保护上优化操作密度与入口一致性。此前版本验证保留在 ORG-MULTISELECT-2026-10-17.md。

## 本轮交互

- 选择器展示本次已选组织名称与可移除标签，明确区分待保存数量和已有当前归属。计数以草稿 ID 为准；候选短暂缺失仍保留待核实名称/ID，不悄悄取消。
- 搜索支持方向键进入候选；候选支持方向键、Home/End、Enter及原生空格操作，跳过禁用项。搜索框 Enter 不触发创建，保留文本编辑中的空格与 Home/End。读屏通过完整计数状态获知变化。
- 人物编辑常显分类/状态，部门、职位、日期、自定义状态和备注收在“更多设置”，折叠保留原控件和全部草稿，并显示已填写数量。历史经历自动展开；日期校验失败先展开并聚焦无效字段，在任何成员写入前拒绝本批次。
- 新建联系人也复用同一搜索多选，每段经历用稳定本地身份维护；同一组织可以补录多段历史，逐段移除不会串值。取消整个组织且有多段经历时先确认，保留或 Esc 返回不丢值。
- 全组移除确认未决时禁止创建和交叉提交；补充资料保存失败后继续使用原人物身份重试，向外部回调传普通快照，避免响应式代理导致重试失败。
- 组织选择浮层固定锚定触发器，已选标签换行不改变浮层锚点；全组取消确认期间先关闭选择浮层，避免遮挡。

本轮不新增持久化结构或存储文件。折叠、局部错误、UI行身份与确认状态仅在当前表单内存中；保存仍经既有服务和存储层。

## 验证与交付

| 验证层 | 最终结果 | 证据 |
| --- | --- | --- |
| TypeScript / Svelte | 0 errors / 0 warnings | `output/org-refinement-check-2026-10-17.log` |
| 单测 | 710/710，退出0 | `output/org-refinement-unit-2026-10-17.log` |
| E2E安全与内核smoke | 17/17，退出0 | `tests/e2e-safety.test.mjs`、`tests/smoke-kernel.test.mjs` |
| Chrome最新定向 | 23/23，退出0 | `output/org-multi-refinement-targeted-desktop-20261017-latest.log` |
| Chrome桌面 / 390px / 宿主样式全量 | 各434/434，均退出0 | `output/org-multi-refinement-ui-{desktop,mobile,host}-20261017-final.log` |
| 生产构建 / 本地发布门禁 | 通过 | `output/org-refinement-build-2026-10-17.log`、`pnpm check:release` |

定向涵盖已选名称、长/同名/缺失候选、已有与待存计数、可信方向键/Enter/原生空格、禁用项、折叠保值、无效日期零写入并定位、刚折叠立即保存、稳定历史行、全组取消确认、创建回传和保存失败重试。原来的相关人可信点击回归继续通过。三套隔离 UI 的首次结果均433/434：唯一失败是旧“本人前置条件”夹具在候选加载期间点击了已禁用的创建按钮；按真实启用条件等待后，最终全量如上。未改变产品加载门禁。

真实隔离 SiYuan Kernel `3.8.8-alpha.3` + Chrome `browser-desktop` 的最终证据为 [535dfb5f JSON](PERSON-ORGANIZATIONS-REAL-UI-535dfb5f-cae5-4e4d-8863-865547f68caa.json)：

- 人物编辑：双组织多选、独立字段、取消新建保留人物草稿、直接创建第三组织并按ID选中、三段保存、生产服务/JSON/组织资料回读、编辑重开及新document重载均通过。
- 新建联系人：实际创建一个人物并保存三段经历，其中同一组织的当前与历史保留三个成员ID中的两个，各自部门、职位、期间与备注独立；生产服务/JSON回读及编辑重开通过。
- 38次关键操作为可信点击；验证侧99次请求逐次完成99次监听归属检查。无场景失败或控制台尾部错误，自己的Chrome退出、profile删除、Kernel退出、随机端口释放均确认。
- 实测 `index.js` SHA256 为 `6b184e82c77a1adf5726ff6cf615816d49cf52ff75fa984c5819d1cf30d01259`，与本轮ZIP及dist逐项相同。

15张稳定截图位于 [截图目录](person-organizations-refinement-2026-10-17/)。已目检 [桌面折叠布局](person-organizations-refinement-2026-10-17/person-organizations-desktop-compact-two-cards.png)、[390px折叠布局](person-organizations-refinement-2026-10-17/person-organizations-390px-compact-two-cards.png) 和 [新建联系人390px](person-organizations-refinement-2026-10-17/add-person-organizations-390px-compact-two-cards.png)：已选名称、独立卡片与更多设置可读，无水平溢出。新建联系人截图滚动取景使触发器顶缘在固定标题下略裁，非完整表单截图。

本轮真实宿主仅覆盖上述组织专场；受控失败重试、移除确认和键盘边界由隔离UI覆盖。没有将390px视口当作Android真机，也未新增Electron、日常用户库、原生编辑器并发或组织部分创建恢复的真实宿主结论。

## 本地候选包

- [siyuan-contacts-organization-ux-refinement-local.zip](../../output/organization-ux-refinement-2026-10-17/siyuan-contacts-organization-ux-refinement-local.zip)：609,500 B，manifest仍为 `0.5.17`，未发布。
- SHA256：`5eff326a59a294fb0f4ca42276b590c29a5a2ae6e52bd6696d67b963f5aa9db0`。
- [条目核验](../../output/organization-ux-refinement-2026-10-17/artifact-verification.json)：10个ZIP条目（9个文件、1个目录），全部文件与dist哈希一致。上一轮606,653 B候选包及其哈希保持不变。
- 包含此前相关人点击修复、组织统一多选与真实新建，以及本轮续优化。需安装本轮候选并重新加载插件后才能使用；未推送、未创建Release、未安装到日常工作区。

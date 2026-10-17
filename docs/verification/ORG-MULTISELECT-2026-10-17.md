# 组织归属统一多选与真实创建（2026-10-17，本地未发布）

用户反馈：人物编辑按“工作单位”“学校”分别单选，其他组织经历入口难以发现；“新增组织”实际只是选择已有组织，缺少随时创建的流程。

## 最终交互

- 人物编辑改为一个“选择组织（可多选）”入口，按名称搜索，勾选家庭、公司、学校、社团等组织；同名以文档 ID 区分。
- 每个待保存组织一张独立卡片，分别设置归属分类、当前/历史状态、部门/院系、职位/身份、开始/结束日期、自定义状态和成员备注。
- 已有经历仍按成员记录 ID 编辑、删除；“补录历史”允许在原当前归属之外登记历史期间，归档组织只允许历史。既有事实不迁移、不自动合并。
- 搜索结果匹配、不匹配和未展开选择面板时都有“新建组织”。直接打开名称资料表单，可带入搜索词；取消保留人物称谓及全部归属草稿，成功按返回 docId 自动选中。
- 组织创建部分成功保留原文档身份；重试冻结原输入并先核实原资料，不重复创建或覆盖并发内容。

## 保存边界

全部草稿先校验，成员事实逐条保存、逐条核实并移除成功草稿。中途失败保留剩余输入；未知结果先完整回读，原条目已存在时不重发。已有当前归属返回的事实若与设置不同，保留可编辑草稿并提示核对原经历。成员事实与文档双链逐项报告，双链失败不重新新增成员。称谓刷新保留原并发快照，未保存输入不会被静默重基。

原生弹窗的 Esc 在 capture 阶段按显式内层作用域路由，组织选择面板先收起并恢复焦点，人物编辑页和脏稿保留。

## 验证

- `pnpm check`：0 errors / 0 warnings；日志 `output/org-multiselect-check-2026-10-17.log`。
- `pnpm test`：710/710；最终编辑、成员和关闭守卫定向88/88。对应日志 `output/org-multiselect-unit-tests-2026-10-17.log`、`output/org-multiselect-final-focused-2026-10-17.log`。
- 新增14项组织编辑 UI 业务回归；Chrome桌面/390px/宿主样式完整回归各428/428，退出码0。`output/org-multi-ui-{desktop,mobile,host}-20261017-final.log`。原相关人可信点击回归仍通过。
- 最终构建真实 Kernel `3.8.8-alpha.3` + Chrome browser-desktop：两组织独立分类/状态/职位/期间/备注，取消新建草稿完全相同，输入真实组织名创建、返回稳定ID自动选第三组织，保存后三条事实由生产服务、原始 `org-membership.json`、组织资料 JSON及真实SQL一致核实；人物编辑重开及新document重载再次回读通过。96次验证请求逐次核对监听归属，自己的Kernel/Chrome退出、端口释放、Chrome profile删除；隔离工作区保留。证据：[最终JSON](PERSON-ORGANIZATIONS-REAL-UI-56791eec-8c39-4500-a236-5c59fc07827b.json)。
- 最终JSON的dist JS哈希 `fbef49f6e456b3d05f7173a35bb625c585f6a9e3bfe56781c849b66901fe2b8a` 与交付包相同。`pnpm build`、`pnpm check:release`、ZIP所有10个条目与dist逐项哈希校验均通过。
- 桌面和390px截图已目检：多选搜索/勾选/新建/完成按钮完整、卡片窄屏单列无横向截断，名称创建表单可输入。见 [桌面多选](person-organizations-2026-10-17/person-organizations-desktop-multi-picker.png)、[390px多选](person-organizations-2026-10-17/person-organizations-390px-multi-picker.png)、[独立设置](person-organizations-2026-10-17/person-organizations-desktop-multi-drafts.png)、[新建名称](person-organizations-2026-10-17/person-organizations-390px-create-name.png)。

调试轮只用于定位harness：取消/创建后候选刷新解忙、嵌套滚动、resize有限动画完成等待；这些失败JSON不计通过。最终验证保留真实鼠标命中和isTrusted断言，没有以合成点击替代关键输入。日常用户工作区、Android真机、原生编辑器并发和创建部分成功故障注入不在本次真实宿主证据范围；部分成功恢复逻辑经过代码审查及类型检查。

## 交付

本轮未提交、推送、发布或安装到日常用户库。沿用本地开发版本 0.5.17；本地候选包含此前相关人可信点击修复，与线上同版本附件不等同。


本地包：`output/organization-multiselect-2026-10-17/siyuan-contacts-organization-multiselect-local.zip`，606,653 B，SHA256 `fe3d3d822f83e077aaaa9295dc00b2cb640c3732cf8430c9a215dd391a3a73aa`；独立核验摘要 `output/organization-multiselect-2026-10-17/artifact-verification.json`。

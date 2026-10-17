# 相关人空态选择器真实点击回归（2026-10-17）

## 根因与修复

用户反馈的人物详情「相关人 → 选择联系人」无反应可在 Chrome 真实输入下复现。旧修复 `d761dfa`（Issue #34）仍在当前源码；问题是它使用 `queueMicrotask()` 延迟打开。

真实点击在 DOM 监听器之间可以执行微任务。Svelte 打开浮层并安装 `window.click` 监听后，同一个原始点击继续传播；空态按钮位于 `PersonPicker` 容器外，因此被判定为外部点击，刚打开的浮层立即关闭。旧回归使用 `HTMLElement.click()`，外层脚本栈使微任务在整次合成点击后才执行，掩盖了该问题。

`PersonPicker.openPicker()` 现改用 `setTimeout(0)` 等待整次原始点击结束，并合并重复的待打开请求、销毁时取消定时器、执行前重新检查 disabled。普通选择器按钮与关系写入逻辑沿用现有行为。

## 回归证据

- 修改生产源码前，新增 Chrome CDP `Input.dispatchMouseEvent` 回归：旧合成点击控制组成功，真实点击记录 `isTrusted=true` 后报「选人浮层被立即关闭」，定向结果 **1/2**、退出码 **1**。
- 修改生产源码后，B03 定向桌面、390px、宿主样式三轮均 **2/2**、退出码 **0**。覆盖可信鼠标打开、搜索获焦、`aria-expanded`、外部关闭、可信 Enter 重开，以及原有电话搜索、无结果、回车选择和关系写入。
- 最终 Chrome 全量桌面、390px、宿主样式均 **416/416**、退出码 **0**；最终点击定位桥下桌面与390px B03 又各 **2/2**。日志位于 `output/relation-picker-ui-{desktop,mobile,host}-20261017.log`。
- 宿主样式全量前两轮各 **415/416**：不断增长的测试结果区把夹具挤出可点击视口，真实输入未命中目标。现只在该用例期间隐藏测试结果区，等待按钮位置稳定，并通过 `elementFromPoint` 核实命中后发送输入；仍强制校验 `isTrusted`。前两轮保留在 `output/relation-picker-ui-host-20261017-{first,second}.log`，不作为产品通过证据。
- `pnpm check`：**0 errors / 0 warnings**；`pnpm test`：**710/710**；`pnpm build` 与 `pnpm check:release` 通过。
- ZIP 中 `index.js`、`index.css`、`plugin.json` 已逐项与 dist 比较 SHA-256，完全一致。

## 隔离真实思源验收

Kernel **3.8.8-alpha.3** + Chrome **browser-desktop**，加载本轮生产构建，成功运行 ID 为 `ea2096e7-db3c-419c-8278-05c71514458b`。原始证据见 [真实宿主 JSON](RELATION-PICKER-REAL-UI-ea2096e7-db3c-419c-8278-05c71514458b.json)。

- 三次空态 CTA 打开后等待 250ms，浮层均保持且搜索框获焦；Escape、真实外部点击关闭和重开通过。
- 输入第二位虚构人物姓名，真实鼠标选择目标，UI 显示新关系。5 次关键点击均 `trusted=true`、`matched=true`。
- 生产 `listContacts` 与原始 AV 独立回读确认源人物到目标人物的关系；关闭重开详情后 UI 仍显示关系。
- 页面唯一 nonce 证明旧 document 已销毁，再重新打开工作台、原人物和相关人页；新页面 UI、生产服务与原始 AV 再次确认关系持久化。
- 70 次验证侧请求均进行监听 PID 所有权核验；Kernel、Chrome 退出，随机端口释放，本轮 Chrome profile 删除成功。UUID 虚构工作区保留作证据。
- 截图已目检，保存在 `output/relation-picker-fix-2026-10-17/relation-picker-trusted-empty-cta.png`。

前三轮未计入通过：`a7816a41...`、`38f73867...` 在详情初始读取忙碌时点击 Tab，关闭守卫拒绝切换；定向驱动现等待 Tab 实际选中。`af3a5c08...` 的外部 h4 被浮层遮挡，命中断言正确阻止；改点可见窗口标题且不滚动，避免误把 scroll-close 算作 outside-click。三轮均未留下运行进程或占用端口，其 JSON 保留为驱动校准记录。

## 本地交付

本轮是尚未发布的本地修复，manifest 保留 `0.5.17`，不能视作线上 v0.5.17 附件已更新。未提交、未推送、未创建 Release。

- 本地修复包：`output/relation-picker-fix-2026-10-17/siyuan-contacts-relation-picker-local-fix.zip`
- 大小：**601,901 B**
- SHA-256：`ebe8fa951d16678d36254b7b7ffdb7345e24eff56dc7753e93d576537bac9fad`

验收只使用内存夹具或脚本创建的 UUID 隔离工作区；不代表用户日常工作区已安装该修复或 Android 真机验收。

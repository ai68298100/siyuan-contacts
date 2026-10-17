# 原生联系方式双页面刷新证据（2026-10-17）

对应 `AG-RF-004-N1`、Issue #51/#54。本报告收口上一轮 Chrome 双页面探针，并补充本轮最终 SQL 回读。全部数据为虚构，只使用 UUID 临时工作区；没有接入生产联系人模型、AV、迁移或 vCard。

## 宿主与范围

- Kernel `3.8.8-alpha.2`；工作区 `C:\Users\Admin\AppData\Local\Temp\SiYuan-Lvct-Contact-UI-612246be-cda2-42d0-83a4-1acad3f72d1b`；回环端口 `12081`。
- Chrome 独立临时 profile，调试端口 `9230`；两个 `browser-desktop` 页面打开同一人物乙 `20261017025209-s0zjhng`。
- 这是同一 Chrome profile 中的双页面验证，不是两个原生桌面窗口、不同前端或操作系统级隔离实证。
- UI 夹具的方法身份为 `ui-{文档后缀}-{来源键}`，与 N1 严格解析器要求的 `method-{hash(owner:sourceKey)}` 不同。本报告证明宿主正文变化和属性留存，不证明严格候选读取器端到端通过。

## 已观察结果

上一轮探针在第一页的真实 `contenteditable` 表面输入邮箱临时值 `MW 临时改值`；第二页无需重载即观察到相同正文，第二页重载后仍能读到临时值。随后第一页输入恢复值 `same@example.test`。

本轮通过 `/api/query/sql` 最终确认：

- 邮箱块 `20261017025209-4m6y6kg` 的 `content` 和 `markdown` 均为 `联系方式：邮箱标签：共享邮箱主值：是值：same@example.test`。
- 方法 ID、owner、source、type、label、primary 和 order 属性仍存在，父文档仍为人物乙。
- 人物乙仍有三条标记联系方式块；没有把只读探针产生的未知项自动删除或改写。

机器证据见 [MULTI-CONTACT-NATIVE-MULTIWINDOW-2026-10-17.json](MULTI-CONTACT-NATIVE-MULTIWINDOW-2026-10-17.json)。该 JSON 只记录本轮 SQL 最终回读，双页面实时刷新与重载观察来自上一轮探针，没有在本轮重新执行。

## 格式与读取限制

恢复的是邮箱值，正文仍已折叠成单行。属性保留与文本可见，不能推导完整候选解析成功。对具有有效候选身份的内存夹具独立移除 LF 后，N1 读取器返回 `unknown/body-header`；本轮 UI 夹具则还会先被严格身份校验拒绝。这两层证据必须分开。

读取器即使能返回其他有效方法，也不能将这个子集当完整名册，更不能据此回填空值、删除缺项或覆盖 AV。该聚合完整性边界转入 `AG-RF-004-N2` 纯研究。

## 仍待验证

- 双页面同时改同一值、改值与删块竞争、外部第三值和迟到写入的 `applied/conflict/unknown` 判定。
- 真实原生复制载荷、同人粘贴重复身份、跨人物粘贴 owner/source/ID 边界与重载回读。
- 有效 `method-{hash}` 夹具在真实编辑器操作前后均通过严格读取器的完整旅程。
- 原生桌面多窗口、真机、真实用户工作区、插件停用、搜索及备份恢复。

本轮续接时可用浏览器控制面只有 IAB，Chrome 控制面不可用，因此没有把未执行的复制或并发操作标为通过。临时进程结束后保留工作区和脱敏证据供复核。N1 保持 `host_pending`，父卡保持 `candidate`，Issue #51/#54 保留开放。

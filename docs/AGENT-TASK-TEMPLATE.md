# Agent 任务卡模板

复制本模板创建一张独立任务卡，并在 [AGENT-DEVELOPMENT-BACKLOG](AGENT-DEVELOPMENT-BACKLOG.md) 登记 ID。一个 Agent 一次只认领一张卡；不要把多个页面、多个事实源或多个未验证端点塞进同一张卡。

## 元数据

```yaml
id: AG-<WAVE>-<NNN>
title: <动词开头的原子目标>
status: ready # ready|in_progress|blocked|partial|done_isolated|host_pending|done|deferred|candidate|cancelled
priority: P0 # P0|P1|P2|P3
type: domain # decision|contract|spike|domain|api|data|service|ui|a11y|e2e|host|docs|research
milestone: M2
owner: <agent>
source_ids: [CODE-02.x, UX-03.x]
depends_on: []
blocks: []
parallel_group: <group-or-none>
last_updated: YYYY-MM-DD
commit: <filled-after-commit>
```

## 目标和边界

- **用户结果：**
- **用户场景：** 从哪里进入，完成什么，返回哪里？
- **当前事实/证据：** 源码、DATA-CONTRACT、测试、spike、PAGE-STATUS 链接。
- **已完成部分：** 明确不重写的实现和证据。
- **本卡范围：**
- **明确不做：**
- **阻塞条件：** 缺端点/字段/隐私决策、依赖未完成或需要真实宿主时写清楚。

## 文件和契约

- **允许修改：** 精确到目录或文件。
- **禁止修改：** 版本号、`CHANGELOG`、README 徽章、`docs/PROGRESS.md`，以及任务未授权的模块。
- **契约变更：** 是否需要先改 `docs/DATA-CONTRACT.md`？章节和迁移/schema 方案是什么？
- **API/spike：** 端点、参数和响应来自哪份实证？若没有，先写 spike，禁止猜测。
- **隐私边界：** 是否外发内容？字段白名单、脱敏、用户同意、取消和日志保留如何做？
- **性能预算：** 数据量、首屏、筛选、切换、超时和取消目标。

## 实施顺序

1. 读取根 `AGENTS.md`、本任务依赖和相关契约。
2. 核对当前源码，确认没有重复实现；冲突先 `blocked`。
3. 需要时先完成 spike/决策/契约，再实现纯域逻辑和 normalize。
4. 依次修改 API、data/storage、service、component；保持单向依赖。
5. 写入前预览范围，锁内重读，写后回读；为部分成功、未知、取消和重试保留结果。
6. 回读实现和差异，补页面状态、可访问性和文档证据。

## 测试夹具和验收

- **夹具：** 正常、空、加载慢、协议异常、权限失败、并发、写后回读失败、重复请求、特殊字符、旧 schema、大数据量。
- **域/存储：**
- **服务/API：**
- **浏览器/UI：** `pnpm test:ui` / `pnpm test:ui:mobile`（按影响选择）。
- **真内核/宿主/真机：** 命令、前端、版本、截图和结果。
- **架构/全量门禁：** `pnpm check && pnpm test`。
- **页面状态：** 正常 / 空 / 加载 / 部分失败 / 忙碌 / 成功 / 失败重试 / 不可用 / 草稿 / 跨窗口 / 移动 / 暗色。
- **可访问性：** 键盘路径、焦点锁定/恢复、aria 名称和播报、非颜色信息、触控尺寸。

验收必须是可观察句子，例如：“注入电话字段失败后，行 ID 和电话失败原因显示在结果中，其余字段可见；再次点击重试只写电话，不创建第二个文档；`pnpm test` 通过。”不要写“体验更好”“已优化”。

## 失败、回滚和交接

- **部分成功：** 哪些事实保留，哪些投影待补？
- **未知结果：** 哪些动作必须停止，能否安全重试？
- **取消：** 取消后是否零写入，已完成项如何显示？
- **回滚：** 回滚哪些键/区块/索引；如何避免覆盖并发新值？
- **证据路径：**
- **剩余风险：**
- **下一张任务：**

完成时必须把状态区分为 `done_isolated`、`host_pending` 或 `done`，不能把隔离测试、原型截图或单元测试单独当作真实宿主完成。

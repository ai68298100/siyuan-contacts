# Agent 执行队列

本文件是 [AGENT-DEVELOPMENT-BACKLOG](AGENT-DEVELOPMENT-BACKLOG.md) 的短队列视图。开发前先读完整任务卡；这里不重复维护验收细节。

## 当前状态（2026-10-16）

该文档只提供短索引；若与 [AGENT-DEVELOPMENT-BACKLOG](AGENT-DEVELOPMENT-BACKLOG.md) 不一致，以主看板为准。v0.5.14 已发布并收口 Issue #36–#40 的代码修复和隔离回归；本轮 v3.8.7 隔离内核服务验收 9/9 通过，但 browser-desktop 在往来账本提交回读处 LIMITED，AG-HOST-003/006 仍不能收口。AG-B13-007 的 active/former 契约草案和影响矩阵已完成，当前直接前置是契约评审、Issue #35 的脱敏 VCF 复现与宿主验收，推荐的后续工作如下：

| 顺序 | 工作 | 当前处理方式 |
|---:|---|---|
| 1 | Issue #35 无法导入联系人 | 原始小米 VCF 尚未提供；保留 issue 开放，取得脱敏首卡后再确认候选修复是否命中根因 |
| 2 | `AG-HOST-003/006` 或 `AG-B13-007` 余项 | 有隔离真实思源环境时推进 Host Queue；没有时评审 D-0037 和历史矩阵，再认领 B13-007 运行时余项 |
| 3 | `AG-SCALE-001` / R54 视觉迁移 | 规模任务维持 P2/partial；R54 先建立有依赖和验收条件的任务卡，再排期 |

> C03 的 377/378 已通过修正移动测试夹具解决：移动用例现在打开“筛选与整理”抽屉并验证资料完整度路径；完整桌面与移动隔离 UI 均为 378/378。只有相关运行时代码变化或回归再次出现时才重开。

## 并行车道

同一车道内不可并行修改同一文件；不同车道只有在依赖满足时并行：

- **契约/Spike：** DATA-CONTRACT、`scripts/spike/`、API 证据。
- **Domain：** `src/domain/`、纯函数和域测试。
- **Data：** `src/data/`、storage 锁、迁移和写后回读。
- **API：** `src/api/`，只实现已有实证端点。
- **Service：** `src/services/`、桥、生命周期。
- **UI/A11y：** `src/components/`、样式、页面状态、键盘/读屏。
- **E2E/Host：** `tests/e2e*`、`scripts/e2e/`、真实内核/真机证据。
- **Docs：** DATA-CONTRACT、PAGE-STATUS、UI-REGRESSION、任务卡；不改保护文件。

## WIP 和交接规则

- 每个 Agent 只认领一个叶任务；同一 `parallel_group` 最多一个 Agent 修改共享入口文件。
- 开工先把 `status` 改为 `in_progress`，写 owner 和日期；被阻塞立即改 `blocked` 并写具体缺口。
- 代码批次退出门禁：`pnpm check && pnpm test`；UI 批次补 `pnpm test:ui`，移动补 `pnpm test:ui:mobile`；新端点/原生图先跑对应 spike。
- 隔离完成标 `done_isolated`；真内核、真机、多窗口缺证据标 `host_pending`；所有要求都满足才标 `done`。
- 每个 commit 只服务一个任务 ID，提交说明包含该 ID；不要修改版本号、CHANGELOG、README 徽章或 `docs/PROGRESS.md`。
- 交接必须包含修改文件、测试命令、状态覆盖、证据路径、未验宿主、回滚方式和下一张任务。

## 阻塞和宿主队列

| 队列 | 任务 | 分配条件 |
|---|---|---|
| 契约/部分完成 | `AG-B13-007`；`AG-SCALE-001` 为 P2/partial | 逐卡状态、依赖和剩余证据以主看板为准；未解契约不得先写实现 |
| Host pending | `AG-HOST-001～006`、`AG-B14-002/005` 及看板列出的宿主余项 | 只在对应隔离思源/真机环境实际验收后更新证据 |
| Deferred | `AG-RF-*` 与未决设计候选 | 只按研究任务评估，不从原型直接扩展生产功能 |

## 合并前根 Agent 检查

1. `git diff --name-only` 中没有版本号、CHANGELOG、README 徽章或 `docs/PROGRESS.md`。
2. 任务卡状态、source IDs、依赖和 evidence 路径已回读。
3. `pnpm check && pnpm test` 通过；受影响 UI/spike/宿主证据已分开记录。
4. 没有把原型静态按钮、隔离 mock、截图或单元测试当作真实宿主完成。
5. 代码提交和文档提交可按任务 ID 独立回滚；确认后按用户授权执行 `git push`。

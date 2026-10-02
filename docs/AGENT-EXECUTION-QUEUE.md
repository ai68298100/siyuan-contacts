# Agent 执行队列

本文件是 [AGENT-DEVELOPMENT-BACKLOG](AGENT-DEVELOPMENT-BACKLOG.md) 的短队列视图。开发前先读完整任务卡；这里不重复维护验收细节。

## 当前可执行顺序

| 顺序 | 队列 | 任务 | 入口条件 | 产出 |
|---:|---|---|---|---|
| 1 | P0 数据安全 | AG-P0-001/002/003/005/006/007/012/014 | 读取根 AGENTS、DATA-CONTRACT、现有 tests/spike | 可证明的写入、迁移、扫描、错误和部分成功语义 |
| 2 | P0 并发与生命周期 | AG-P0-004/008/009/010/011/013 | 对应 P0 基础任务达到 `done_isolated` | 跨窗口、任务同步、桥、路径和卸载行为 |
| 3 | 本人和资料 | AG-B11-001/002/003/004 → AG-B12-001/002/003 | 身份唯一事实源与字段边界已定 | 本人、工作单位、学校、关系投影闭环 |
| 4 | 组织 | AG-B13-001/002/003/004/005/006 | 组织契约和 P0 写入模型稳定 | 组织/成员事实、双向维护、健康、迁移和刷新 |
| 5 | 双图 | AG-B14-001 → AG-B14-002 → AG-B14-003/004/005 | 组织投影稳定；原生端点先 spike | 自研/原生双图、范围、组织聚焦、文本替代和降级 |
| 6 | 捕获和 AI | AG-AI-001/002/003、AG-IMP-001/002 | 部分失败、字段边界、隐私预检通过 | 可追溯候选、导入映射、幂等和人工确认 |
| 7 | UI 质量 | AG-UX-001/002/003/004/005 | 对应页面功能已具备真实结果 | 页面状态、返回语义、异步反馈、a11y、移动/暗色 |
| 8 | 规模和门禁 | AG-SCALE-001、AG-BRIDGE-001、AG-QA-001/002 | 前述主路径稳定 | 大数据量预算、桥协议决策、回归和发布门禁 |

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
| Blocked | AG-P0-005 新端点部分、AG-B13-005、AG-SCALE-001、AG-BRIDGE-001 | 先完成契约/端点/迁移/性能决策；不得绕过阻塞写“临时实现” |
| Host pending | AG-B14-002/005、AG-HOST-001～005、AG-B13-004 的真机部分 | 代码和隔离测试完成；由真实思源/真机 Agent 记录证据 |
| Deferred | AG-RF-001/002、未决 UX-03.29 候选 | 只做研究卡，不进入主导航和生产写入 |

## 合并前根 Agent 检查

1. `git diff --name-only` 中没有版本号、CHANGELOG、README 徽章或 `docs/PROGRESS.md`。
2. 任务卡状态、source IDs、依赖和 evidence 路径已回读。
3. `pnpm check && pnpm test` 通过；受影响 UI/spike/宿主证据已分开记录。
4. 没有把原型静态按钮、隔离 mock、截图或单元测试当作真实宿主完成。
5. 代码提交和文档提交可按任务 ID 独立回滚；确认后按用户授权执行 `git push`。

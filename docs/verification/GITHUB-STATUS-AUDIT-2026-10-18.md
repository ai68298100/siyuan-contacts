# GitHub、发布资产与状态文档审计（2026-10-18）

审计时间：2026-10-18 01:25（Asia/Shanghai；API 取证窗口约 01:18–01:25）。仓库：`ai68298100/siyuan-contacts`。本次只读查询 GitHub、下载公开发布附件、检查本地源码/文档；没有提交评论、关闭 issue、合并 PR、推送、发布或安装到用户工作区。

## 1. 当前版本与来源一致性

| 对象 | 当前核实结果 | 证据 |
| --- | --- | --- |
| 本地 HEAD | `6b52b6f6040f23d129811d83bb2993e9638422e7`；审计开始时工作树干净 | `git status --short`、`git log -1` |
| 远端 main | 与本地 HEAD 相同 | [main](https://github.com/ai68298100/siyuan-contacts/tree/main) / [提交](https://github.com/ai68298100/siyuan-contacts/commit/6b52b6f6040f23d129811d83bb2993e9638422e7) |
| 本地双 manifest | `package.json`、`plugin.json` 均为 `0.5.18`；最低思源 `3.8.5` | 本地文件与已下载附件 manifest |
| v0.5.18 tag | annotated tag 对象 `49fdce6051f20080a347f8b80e5907f566847b68`，指向 `3ef4f432a83247fb9e0c8b0e2faa26375ddcc19e` | [tag API](https://api.github.com/repos/ai68298100/siyuan-contacts/git/tags/49fdce6051f20080a347f8b80e5907f566847b68) |
| tag 至 main | main 多 2 个提交；差异仅 `docs/PROGRESS.md`、`docs/RELEASE.md`，没有产品源码差异 | [compare](https://github.com/ai68298100/siyuan-contacts/compare/v0.5.18...main) |
| 最新稳定 Release | `v0.5.18`，非 draft、非 prerelease，发布于北京时间 2026-10-18 00:38:15 | [Release](https://github.com/ai68298100/siyuan-contacts/releases/tag/v0.5.18) |

**附件重新下载通过**：`package.zip` 为 **616,803 B**，SHA-256 为 `5b93d0de228fb1c41e0311249736130e8deccfe5335a40a7df640b74c1f83cfe`；与 GitHub asset digest、`PROGRESS`、`RELEASE` 记录一致。ZIP 包含 9 个文件和 `i18n/` 目录项，manifest 为 `0.5.18`；9 个文件全部与本轮重新构建的本地 `dist/` 逐文件 SHA-256 一致（含 JS、CSS、manifest、双语说明与语言文件），没有额外 JS chunk 或 source map。

下载检查位置：`C:\Users\Admin\AppData\Local\Temp\lvct-github-audit-20261018-0f514a3b399044cdb43b4c41d28b08e1\package.zip`。本报告保留路径便于复核，临时文件寿命不作为持久证据承诺。

## 2. 未处理 issue 与 PR

GitHub 仓库显示的 `open_issues_count=2` 包含 PR，实际是 **1 个开放 issue + 1 个开放 PR**。

| 项目 | 当前状态与下一步 | 判断边界 |
| --- | --- | --- |
| [Issue #35：无法导入联系人](https://github.com/ai68298100/siyuan-contacts/issues/35) | `open`，最后更新 2026-10-15 23:54:56。用户报告 v0.5.11/SiYuan 3.8.6/desktop 下小米 VCF 首卡缺少 FN/N。维护者两次回复均说明需要脱敏首卡才能确认根因 | BOM、空白 FN 回退 N、QP 与跳过无名卡的候选修复不能替代原始 VCF 复现；维持开放合理。当前没有新增样本或用户确认 |
| [PR #33：Dependabot 4 项更新](https://github.com/ai68298100/siyuan-contacts/pull/33) | `open`、非 draft、`mergeable=true`，但 `mergeable_state=behind`。请求审阅者为仓库作者。最新 head `ce78c5a` 的 `build` CI 已通过 | 先更新至当前 main 并取得新 CI，再审阅合入。当前审计没有合入授权，也未改远程 |
| [Issue #51](https://github.com/ai68298100/siyuan-contacts/issues/51)、[#54](https://github.com/ai68298100/siyuan-contacts/issues/54) | 均为 `closed/completed`，分别关闭于北京时间 10-17 14:09:40、14:09:55 | 不应因旧研究卡仍保留“#51/#54 开放”措辞而重新安排已发布首版；完整联系方式研究与已交付补充资料是不同验收范围 |

PR #33 仅改 `package.json`、`pnpm-lock.yaml`：

| 依赖 | main 当前声明 | PR 声明 |
| --- | --- | --- |
| `@lucide/svelte` | `^1.52.0` | `^1.57.0` |
| `@types/node` | `^26.6.4` | `^26.6.5` |
| `svelte` | `^5.57.0` | `^5.57.2` |
| `vite` | `^8.3.2` | `^8.3.4` |

最新 PR CI：[39050178484](https://github.com/ai68298100/siyuan-contacts/actions/runs/39050178484)，北京时间 10-18 00:40:27 成功。它是常规依赖更新，不应描述成已确认漏洞修复；已有历史隔离宿主 smoke 的文档记录也不能自动覆盖后续新 head。

## 3. Actions、保护规则与安全待办

- 当前 main CI [39050639105](https://github.com/ai68298100/siyuan-contacts/actions/runs/39050639105) 成功，完成于北京时间 10-18 00:46:45；类型、单测、桌面 UI、移动视口 UI、构建、checksum、release gate 和上传产物步骤全部通过。发布 tag 对应 main CI [39049958691](https://github.com/ai68298100/siyuan-contacts/actions/runs/39049958691) 也成功。
- 最新 25 个 run 的最终结论均为 success。最新 100 个 run：92 success、3 failure、5 cancelled；失败 run 均为较早开发分支记录，非当前 main/head。最新 3 个失败分别是 [38789431810](https://github.com/ai68298100/siyuan-contacts/actions/runs/38789431810)（桌面 UI）、[38780955092](https://github.com/ai68298100/siyuan-contacts/actions/runs/38780955092)（桌面 UI）、[38709378670](https://github.com/ai68298100/siyuan-contacts/actions/runs/38709378670)（移动 UI）。以上是 run 最终状态统计，不覆盖所有历史 attempt。
- `RELEASE.md:46` 仍准确保留 [38815793263 attempt 1](https://github.com/ai68298100/siyuan-contacts/actions/runs/38815793263/attempts/1) 的 B03“选人浮层未打开”及同提交重跑通过记录。当前绿灯不能反推该偶发失败的独立根因已经确定；CI 稳定性仍有可追踪优化项。
- main 由 active ruleset `Protect main via pull request` 保护：禁止删除/非快进，必须 PR，且必须最新分支通过 `build`；允许普通 merge，要求审批数 0。传统 branch-protection API 返回 404，因为保护来自 ruleset，不应误报 main 没有保护。[有效规则 API](https://api.github.com/repos/ai68298100/siyuan-contacts/rules/branches/main)
- Dependabot 开放安全 alert **0**，secret-scanning 开放 alert **0**（本次均成功读取）；依赖安全自动更新、secret scanning 与 push protection 为 enabled。这只是当前 GitHub 检测结果，不等于源码绝无漏洞。
- code-scanning API 返回 `404 no analysis found`，没有可报告的分析结果；当前只有 CI workflow，未发现 CodeQL 等代码扫描任务。可作为后续仓库质量改进，不能写成“代码扫描零告警”。
- Dependabot 已配置 npm 每周、GitHub Actions 每月检查；PR #33 是当前唯一开放依赖 PR。CI 当前运行桌面/移动视口回归，`test:ui:host` 不在该 workflow 中，历史宿主样式结果应继续标为本地或另行证据。

## 4. 集市状态与 GitHub 的同步

[siyuan-note/bazaar PR #2289](https://github.com/siyuan-note/bazaar/pull/2289) 已在北京时间 **2026-09-30 15:58:52 合并**，并非等待维护者审阅。

本次读取 [stage/plugins.json](https://github.com/siyuan-note/bazaar/blob/main/stage/plugins.json) 的 `repos` 列表，`package.name=siyuan-contacts` 条目为：

- `repoRef=v0.5.18`，`version=0.5.18`，URL `ai68298100/siyuan-contacts@5b93d0d`；
- 616,803 B，SHA-256 `5b93d0de228fb1c41e0311249736130e8deccfe5335a40a7df640b74c1f83cfe`；
- 条目 `updated=2026-10-17T16:38:15Z`；本次索引同步晚于早先审计快照。

因此当前是 **GitHub v0.5.18、集市 Stage 索引 v0.5.18**；仍没有实机客户端安装/可见性证据。README 当前“PR 已合并、客户端可见性未核验、建议 Release 手动安装”的口径仍成立。不要把 Stage 条目写成用户已装 v0.5.18，也不需要重复提交收录 PR。

## 5. 本轮发现的文档漂移与流程缺口

| 优先级 | 定位 | 发现与建议 |
| --- | --- | --- |
| P2 | `docs/ACTIVE-BACKLOG.md:3–11` | **基线漂移，当前头注已同步**：原先把 v0.5.18 已发布功能写成“本地未发布”；现已增加 10-18 当前摘要，旧轮次保留为历史 |
| P2 | `docs/NEXT-DEVELOPMENT-PLAN.md:3–5,15,32` | **基线漂移，当前入口已同步**：原先的候选发布顺序已改为审计修复完成后的原型漂移、PR #33、集市客户端可见性和 Host Queue；下方历史计划仍保留来源性质 |
| P2 | `docs/ACTIVE-BACKLOG.md:85` | A-07 的当前事实已更新为 Stage v0.5.18；仍待核对真实客户端可见性，已不再写成“等待收录 PR 合并” |
| P2 | `docs/AGENT-DEVELOPMENT-BACKLOG.md:65–71` | **基线漂移，当前摘要已同步**：已补充 v0.5.18、本地 `done_isolated` 修复状态和 PR #33 behind；历史 v0.5.16/17 记录继续保留 |
| P2 | `package.json:16`、`scripts/check-release.mjs:30–36`、`docs/DEVELOPMENT.md:126–127` | **基线缺口，当前工作树已修复**：此前 `pnpm build` 只构建 ZIP，直接运行 `pnpm check:release` 会对照上次发布的 tracked sidecar 而失败；现已由 `build → build:checksum` 自动生成同轮 sidecar，并在本地 release gate 验证通过。旧文档和本段保留基线证据，后续只需同步开发文档顺序 |

**checksum 的基线证据**：主审执行旧版 `pnpm build` 后，本地 ZIP 为 616,803 B，SHA-256 `fe9a13e9d3e0cfc07da43a4e85232a5f449cb99e07727c3208a7a48489f90626`；tracked `package.zip.sha256` 仍为官方附件的 `5b93d0...`，导致当时 release gate 的 checksum 一项失败。当前工作树已由 `pnpm build` 自动生成同轮 sidecar，`pnpm check:release` 通过。9 个包内文件与新下载的官方附件全相同，说明基线问题是 ZIP 元数据与旧 sidecar 的流程问题，不是产品源码失效或官方包损坏。真实构建 mtime 是 `AGENTS.md` 的明确约定，应保留；不得为了 hash 恒定而冻结 ZIP 时间。

## 6. 未完成范围仍需独立标注

本次 GitHub/发布验证不能关闭 `AG-HOST-001–006`：原生图打开与中心透传、组织/成员多窗口刷新、第三方任务互读、Android/软键盘/安全区/系统返回、真实用户工作区与原生编辑器均有独立边界。`AG-B13-007` 仍为 partial；完整 `contactMethods` 事实源/主值投影/迁移/原生并发是研究后续，不能因为 #51/#54 首版关闭而整体标完成；`AG-SCALE-001` 仍为 P2/partial，R54 视觉迁移仍应以生产 UI 和原型对照审计结论为准。

当前可直接进入的整理事项是：修正当前状态摘要、处理 PR #33 的分支更新与审阅、保留 #35 的样本门槛、核对真实客户端集市可见性、统一打包校验流程，并按 Host Queue 补齐真实环境证据。本报告没有把这些建议当作已执行的产品开发。

## 附录：生日保存的独立驱动诊断（01:35 增量）

主审首轮 `services-flow.mjs` 的实际服务为 11/11，但真实前端 `realFrontend=false`，错误为“生日编辑保存按钮不可定位”；原证据 `C:\Users\Admin\AppData\Local\Temp\lvct-audit-20261018-host.json` 保留，不覆盖为成功。

源码定位：`frontend-flow.mjs:1104–1113` 只等日期 input 出现，立即填入并检查保存按钮；`PersonEditDialog.svelte:237–262` 此时可能仍在加载组织/关系资料，保存按钮按设计禁用。使用独立临时 `node:module.registerHooks` 仅在内存中为驱动添加“资料加载结束且保存按钮 enabled”条件等待；没有修改产品、仓库驱动或原失败证据，也没有以固定 sleep 跳过错误。

新 UUID 工作区 `SiYuan-Lvct-Services-AuditProfileReady-b1bfe78f-02e4-421e-84f8-ec10e717089f`、随机回环端口 `12166`、Kernel `3.8.8-alpha.3`、独立 Chrome profile 重跑结果：

- 等待前 `loading=true/dateDisabled=false/saveDisabled=true`；等待 **1297 ms** 后 `loading=false/dateDisabled=false/saveDisabled=false`，随后生日保存/显示回读成功。
- 实际服务 **11/11**，真实隔离 `browser-desktop` 前端 **PASS**，`failure=null`、`limitations=[]`。
- 本轮生日、账本创建/结清/重开、别名保存/重复拒绝、跟进创建/完成/内核回读、组织改名/成员编辑/归档恢复/重载、捕获 UI 均通过；同源双页面的互动、组织与成员刷新标志均为 true。
- 持有浏览器已退出、独立 profile 已清理、工作区关联进程未残留，端口 12166 无监听；`cleanupFailure` 为空。

独立证据：`C:\Users\Admin\AppData\Local\Temp\lvct-audit-20261018-profile-ready-b1bfe78f-02e4-421e-84f8-ec10e717089f.json`，SHA-256 `4ddecf3085eeeb7bdf7695ab1e43d121b2ff43b7bf2f850606b4df3675c7d652`。临时 hook：`C:\Users\Admin\AppData\Local\Temp\lvct-profile-ready-hook-62115de0f60d49c384b820b1a6bd00cd.mjs`，SHA-256 `5e34ea8a40d7aec8561b114597cbfb7ffad3e32981856337ab44d1dbf6ccbe75`。

结论：首轮错误可归因于驱动没有等待异步资料就绪，不能据此判定产品生日保存无效；产品在上述隔离环境实际可保存。应把驱动等待条件作为独立测试维护待办。本增量仍不替代日常用户库、Electron、多设备/Android、原生编辑器竞争或原生图验收，亦不自动关闭整张 Host Queue 卡。

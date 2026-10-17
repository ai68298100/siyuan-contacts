# PR #33 依赖升级合并门禁（2026-10-17）

## 当前结论

PR [#33](https://github.com/ai68298100/siyuan-contacts/pull/33) 当前为 `OPEN`、`MERGEABLE`、`CLEAN`，GitHub 最新提交为 `8eb3bb2`，基于 `origin/main` `7554cbe`。该提交已在隔离真实宿主完成 G-03 smoke，结果见 [PR-33-HOST-SMOKE-2026-10-17.json](PR-33-HOST-SMOKE-2026-10-17.json)。本记录只用于合并前审查，不执行合并，也不重新发布已经发布的 `v0.5.17`。

## 变更范围

- `@lucide/svelte`：`1.52.0` → `1.57.0`
- `@types/node`：`26.6.4` → `26.6.5`
- `svelte`：`5.57.1` → `5.57.2`
- `vite`：`8.3.2` → `8.3.4`
- 传递依赖随锁文件更新，包括 Rolldown `1.2.11` → `1.2.13`、PostCSS `8.5.28` → `8.5.30` 等补丁版本

未涉及源码、`plugin.json`、API、数据契约、schema 或发布版本。Dependabot 提交正文中残留 `@lucide/svelte 1.55.0`，与实际文件的 `1.57.0` 不一致；以 PR 文件和锁文件为准。

## 已完成门禁

- [x] PR 文件范围仅为 `package.json` 与 `pnpm-lock.yaml`
- [x] GitHub CI `39009601315` 成功
- [x] CI 包含 `pnpm install --frozen-lockfile`
- [x] CI 包含 `pnpm check`、全量 `pnpm test`、桌面/移动 UI、`pnpm build`、`pnpm check:release`
- [x] `@lucide/svelte@1.57.0` 中源码实际使用的 43 个图标均能从主导出或 alias 解析
- [x] 当前基线本地串行 `pnpm check`、`pnpm test`、三套 UI、`pnpm build` 通过
- [x] 当前 `v0.5.17` Release 下载包已恢复并通过 SHA256 校验
- [x] PR 头 `8eb3bb2` 独立 worktree `pnpm install --frozen-lockfile`、`pnpm check`、`pnpm build` 通过
- [x] PR 头独立 worktree `pnpm check:release` 通过；构建 ZIP 含时间戳，按 CI 流程先生成本轮 `package.zip.sha256` 再校验
- [x] G-03 隔离真实宿主 smoke 通过：Kernel `3.8.8-alpha.3`、Chrome `browser-desktop`、插件加载、桥 protocol 2、捕获弹窗/提交、组织双页面和 11/11 服务均通过

## 合并前剩余门禁

- [x] 按 G-03 在真实 SiYuan 宿主加载新依赖构建，并执行核心流程 smoke
- [x] 已记录真实宿主版本、前端类型、插件加载结果和捕获弹窗/组织操作路径
- [x] 本轮 smoke 通过，PR 具备合入 `main` 的兼容性证据；是否合入仍按用户授权执行
- [x] 下一版本再吸收依赖更新；不修改或重发 `v0.5.17`

## 风险判断

当前风险为低：Svelte/Vite 是补丁升级，Lucide 版本只增加图标且现有导出已核验；PR 头的隔离真实宿主 smoke 也已通过。CI 仍不覆盖真实宿主、Android 真机或用户工作区，这些属于后续发布信心和产品验收边界，不改变本 PR 的源码兼容性判断。

# 开发与交付

本文对应当前仓库结构与 `package.json` 脚本。思源内核接口约束见 [`DATA-CONTRACT.md`](DATA-CONTRACT.md)，插件数据语义见 [`BRIDGE.md`](BRIDGE.md)，UI 组件索引见 [`COMPONENT-CATALOG.md`](COMPONENT-CATALOG.md)。

## 环境

- Node.js `>=24`；仓库锁定包管理器 `pnpm@12.5.1`（pnpm 12.x）。
- 安装依赖：`pnpm install`。
- 插件运行在思源笔记插件宿主中；当前 `plugin.json` 要求思源 `>=3.8.5`。
- 应用运行时无需配置环境变量。测试、开发链接和截图使用下表中的可选变量。

## 项目结构

| 路径 | 内容 |
|---|---|
| `src/` | Svelte 5 UI、领域模型、服务、思源 API、持久化和样式。依赖方向由 `tests/architecture.test.ts` 约束。 |
| `src/components/` | 37 个 Svelte 组件；按页面和业务分到 dashboard、people、org、graph、capture 子目录。 |
| `src/domain/` | 纯领域规则、校验和数据变换。 |
| `src/services/` | 用例编排、读取/写入、投影与恢复服务。 |
| `src/api/` | 唯一允许调用思源内核 HTTP API 的层；协议解码和 15 秒默认超时在 `client.ts`。 |
| `src/data/` | 插件自管数据存取、校验、锁与写后回读。 |
| `src/style/`、`src/index.scss` | UI 令牌、控件、页面和宿主兼容样式。 |
| `tests/` | Node 域层、服务契约、架构、安全边界和状态回归测试。 |
| `scripts/e2e/ui/` | 隔离浏览器 harness、内存思源适配器及逐项 UI 回归用例。 |
| `scripts/e2e/` | UI/浏览器、独立思源内核、截图与并行回归入口。 |
| `scripts/spike/` | 思源接口行为的隔离实证工具，不属于运行时功能。 |
| `docs/` | 数据契约、UI 规范、版本记录、验证证据和研究文档。 |
| `dist/`、`package.zip` | 构建输出；由构建脚本生成，不作为源码编辑入口。 |

## 本地开发

```sh
pnpm install
pnpm check
pnpm dev
```

`pnpm dev` 使用 Vite watch 构建开发产物到 `dev/`，不是启动网页服务器。要让思源加载开发文件，可先运行 `pnpm make-link`，按提示选择思源插件目录；无法自动发现时设置 `SIYUAN_PLUGIN_DIR` 为插件目录的父目录（即 `data/plugins`），再重启/刷新思源。

## 命令索引

| 命令 | 职责 |
|---|---|
| `pnpm dev` | development 模式 Vite watch 构建到 `dev/`，内联 source map。 |
| `pnpm build:app` | production Vite 构建 `dist/`。 |
| `pnpm build` | 清理后生产构建，生成 `package.zip`。 |
| `pnpm clean` | 清理构建输出，不清理用户工作区。 |
| `pnpm check` | 顺序运行 TypeScript 与 Svelte 检查。 |
| `pnpm check:types` | 检查前端和 Node 脚本 TypeScript 配置。 |
| `pnpm check:svelte` | 运行 `svelte-check`。 |
| `pnpm test` | 运行 package.json 中登记的 Node 测试文件。 |
| `pnpm test:ui` | Chromium 隔离工作台 UI 回归。 |
| `pnpm test:ui:mobile` | 同一 UI 套件以移动窄视口运行；不等于 Android 真机。 |
| `pnpm test:ui:host` | 同一套件加载可用的思源宿主样式基线。 |
| `pnpm test:e2e:parallel` | 按 `scripts/e2e/parallel.example.json` 编排隔离并行作业。 |
| `pnpm check:release` | 检查版本一致、发布文件、zip 与 SHA-256、商店图像尺寸、单 JS 产物和宿主 require 约束。 |
| `pnpm make-link` | 将开发构建目录软链接到所选思源插件目录。 |
| `pnpm make-install` | 构建后把 `dist/` 复制到思源插件目录。 |
| `pnpm update-version` | 交互选择 patch/minor/major 或输入版本，同步 `package.json` 与 `plugin.json`。 |
| `pnpm spike`、`spike:init`、`spike:b13`、`spike:b14`、`spike:task` | 运行属性视图、初始化、组织、图谱、原生任务块接口 spike。 |
| `pnpm spike:scale` | 运行 Node 隔离规模基准；结果不是实际用户工作区性能保证。 |

脚本目录中的单项 `*-regression.js` 由 UI harness 按模块加载；`scripts/e2e/*-flow.mjs` 覆盖独立内核流程；`scripts/lib/smoke-kernel.mjs` 提供共享内核安全检查；`scripts/spike/` 是接口研究脚本。`scripts/probe-popover.mjs`、`scripts/breakpoint-sweep.mjs` 和截图脚本属于诊断/验收用途。

主要脚本文件职责：

| 文件 | 职责 |
|---|---|
| `scripts/clean.js`、`scripts/make_dev_link.js`、`scripts/make_install.js` | 清理输出、建立 `dev/` 开发软链、将 `dist/` 安装到本机思源。 |
| `scripts/update_version.js`、`scripts/check-release.mjs` | 交互更新双版本号、校验发行文件/zip/checksum/单入口约束。 |
| `scripts/proto-status.mjs` | 插入或只读检查 UI 原型的页面实现状态条。 |
| `scripts/collect-i18n.mjs`、`scripts/gen-icon.mjs` | 收集翻译键、生成插件图标资源。 |
| `scripts/breakpoint-sweep.mjs`、`scripts/e2e/screenshot-settings.mjs` | 扫描断点布局、按页面/主题生成视觉验收截图。 |
| `scripts/e2e/ui-smoke.mjs`、`scripts/e2e/ui/` | 启动隔离 Vite/Chromium UI harness；回归模块按联系人、组织、图谱、设置、导入、捕获、返回焦点等场景拆分。`siyuan-mock.js` 是测试适配器，不是产品数据源。 |
| `scripts/e2e/contacts-flow.mjs`、`services-flow.mjs`、`frontend-flow.mjs`、`load-check.mjs` | 分别验证联系人 API 流程、服务/真实内核流程、真实前端流程和插件加载流程；写型流程应只在脚本创建或验证过的隔离工作区运行。 |
| `scripts/e2e/parallel-runner.mjs`、`kernel-safety.mjs`、`browser-cleanup.mjs`、`host-baseline.mjs` | 隔离并行作业、内核靶场安全、测试浏览器生命周期与思源 CSS 测试基线。 |
| `scripts/e2e/ui-control-audit.mjs`、`probe-popover.mjs`、`dev-server.mjs` | 扫描无回调控件、诊断浮层样式、为部分浏览器回归提供本地测试服务。 |
| `scripts/lib/smoke-kernel.mjs` | 共享内核 smoke 脚本的地址/token解析、临时笔记本边界和 AI 开关。 |
| `scripts/spike/*.mjs` | 隔离验证属性视图分页、初始化、组织、图谱、任务块、AI 及编码等思源接口行为；实验结果不直接等于产品承诺。 |

## 环境变量

| 变量 | 使用范围 | 说明 |
|---|---|---|
| `SIYUAN_PLUGIN_DIR` | `pnpm make-link` | 思源插件目录的父目录；仅在无法自动发现安装位置时需要。 |
| `LVCT_TEST_BROWSER` | UI/E2E/截图 | 指定 Chromium 可执行文件；未设置时脚本尝试查找可用浏览器。 |
| `LVCT_UI_MOBILE=1` | `test:ui:mobile` | 由脚本自动设置，切换移动模拟视口。 |
| `LVCT_UI_HOST=1` | `test:ui:host` | 由脚本自动设置；本机发现思源资源时加载真实 `base.css`，CI/无安装时回退近似样式。 |
| `LVCT_UI_FILTER` | UI harness | 只运行匹配的测试模块/用例，便于定向回归。 |
| `LVCT_E2E_PORT`、`LVCT_E2E_WORKSPACE` | 内核 E2E/并行 runner | 覆盖测试端口或隔离临时工作区；并行 runner 会自动分配隔离路径。 |
| `LVCT_REAL_FRONTEND=1` | `services-flow.mjs` | 请求追加真实 browser-desktop 前端验收；仍须使用脚本创建的隔离工作区。 |
| `LVCT_E2E_ARTIFACT_DIR`、`LVCT_E2E_EVIDENCE_FILE` | E2E | 指定隔离产物/证据输出位置。 |
| `LVCT_HOST_BASELINE=1` | 截图脚本 | 增加真实思源样式的截图套件。 |
| `LVCT_SHOT_VIEW`、`LVCT_SHOT_SCALE` | `screenshot-settings.mjs` | 选择单视图和测试缩放；scale 当前只接受 `200` 或 `1000`。 |
| `LVCT_PAGE_TOTAL` | `pnpm spike:scale` 相关分页 spike | 设置分页规模样本数；`av-pagination-spike.mjs` 限制在 `1-1001`。 |
| `SIYUAN_BASE_URL`、`SIYUAN_TOKEN` | 共享内核 smoke/flow 脚本 | 显式指定思源地址/token；只有脚本允许时才连接外部内核，写型脚本带安全检查。不要写入仓库或日志。 |
| `SIYUAN_E2E_ALLOW_SHARED=1` | 共享内核 smoke helper | 显式放行含非临时笔记本的共享内核写入，具有数据风险；优先使用脚本自动创建的临时工作区。 |
| `SIYUAN_E2E_AI=1` | 允许 AI 的 E2E 流程 | 开启需要调用配置中 AI 的用例；会产生真实外发，默认关闭。 |

上表不含并行 runner 为子作业自动注入的内部变量（run/job ID、工作目录、端口和证据路径）；通常无需手工设置。`NODE_ENV` 与 `VITE_SOURCEMAP` 由 package scripts 在开发/构建命令中设置。

## 验证

建议合并前至少运行：

```sh
pnpm check
pnpm test
pnpm test:ui
pnpm test:ui:mobile
pnpm test:ui:host
pnpm build
pnpm check:release
node scripts/proto-status.mjs --check
```

UI 与内核 E2E 使用隔离浏览器/临时工作区，但模拟布局不能替代思源桌面实际使用、Android 真机软键盘、安全区、真实多窗口和第三方主题验证。主测试通过也不表示未被覆盖的所有页面状态均已验收；报告中应区分 PASS、LIMITED 和未运行。

### 体积实测（2026-10-12）

生产构建使用 `pnpm build`（先清理 `dist/`）后，Vite 报告 `index.js` **1,436.84 kB / gzip 445.38 kB**，`index.css` **181.08 kB / gzip 25.32 kB**。此前基线为 JS **1,434,390 bytes / gzip 445.31 KB**、CSS **180.43 KB / gzip 25.22 KB**；当前分别约增加 **0.17% / 0.02%** 和 **0.36% / 0.40%**。本轮没有据此宣称包体变小，也没有足够的真实宿主首屏测量支持“加载更快”的结论。动态分包经实测会违反思源单入口约束，故保留静态装配；后续性能工作应以真实宿主测量为前提。

## 发布与部署

1. 更新 `package.json`、`plugin.json` 版本（可用 `pnpm update-version` 交互完成），同步 `README.md`、`docs/CHANGELOG.md` 和对应发布说明。
2. 执行上面的检查，尤其是 `pnpm check:release`。该门禁校验 zip SHA-256 和单 `index.js` 约束；它不发布 GitHub Release。
3. `pnpm build` 生成 `dist/` 与 `package.zip`；随后运行 `sha256sum package.zip > package.zip.sha256`（Windows 可用等价 SHA-256 工具）生成门禁需要的校验文件。查看 `git diff` 和校验值，确认包只含预期运行文件。CI 在构建后自动生成该文件。
4. 发布时创建/更新 GitHub tag 和 Release，并附上 `package.zip`；仓库最新发布流程以 `.github/workflows/` 和 GitHub Release 页面为准。推送源码本身不会自动安装到用户思源。
5. 用户端可在思源插件目录安装 Release 包，或在本机开发时使用 `pnpm make-install`；普通手动安装与市场客户端可见性是不同渠道。

## 目前已知限制

- 思源插件宿主没有网页应用式登录/独立 token 管理流程；权限由思源内核和当前用户上下文决定。`client.ts` 对内核响应分类权限、传输、协议和业务错误，并对请求设置 15 秒超时；不会自动重试内核写请求，以避免重复写入。
- 所有内核 HTTP 请求集中在 `src/api/`，但不能据此声称存在全局请求去重、全请求取消、统一重试或全局缓存失效框架。名册缓存/代次、视图偏好写入队列、特定服务请求各有自己的并发保护；需以对应服务代码和测试为准。
- 页面原型用演示数据且不会连接思源或持久化；“实现状态”标识只表示对应功能存在，并非该页面所有状态、真机、宿主入口都验收通过。
- CardDAV/CalDAV 在线同步、OCR 联动、Android 真机、原生图入口、任务管理器互读、集市客户端可见性尚未完整验收或实现；以 README 已知限制、CHANGELOG 和专项研究文档的最新记录为准。
- 产物保持单 `index.js`，运行时动态 import 和拆分 chunk 不符合当前思源插件 loader 的发布约束；入口与关系图均静态装配。Vite 使用 `codeSplitting: false` 生成单文件，后续性能优化应优先放在渲染次数、数据范围和资源体积，而不是路由分包。

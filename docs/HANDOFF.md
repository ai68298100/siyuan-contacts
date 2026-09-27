# 交接指南（HANDOFF）——在新电脑上继续开发

> 给新环境的人类/AI 贡献者的一页纸上手指南。读完本文再读 AGENTS.md，即可安全动手。

## 环境要求

| 工具 | 版本 | 说明 |
|---|---|---|
| Node.js | ≥ 24 | 模板硬性要求（单测直跑 TS 也依赖 Node 24 的类型擦除） |
| pnpm | 12.x | `corepack enable` 后自动对齐 package.json 的 packageManager |
| 思源笔记 | ≥ 3.8.5 | 本机调试/加载验证用 |

```bash
git clone https://github.com/ai68298100/siyuan-contacts
cd siyuan-contacts
pnpm install          # 国内网络慢可先: pnpm config set registry https://registry.npmmirror.com
```

## 常用命令

| 命令 | 作用 |
|---|---|
| `pnpm check` | tsc + svelte-check（必须 0 错误） |
| `pnpm test` | 全部单测（域层纯函数 + 架构守门 + i18n parity，必须全绿） |
| `pnpm build` | 产出 dist/ 与 package.zip |
| `pnpm dev` | 监听构建 + 思源内热重载（需思源在运行，配合 `pnpm make-link`） |
| `pnpm make-install` | 把 dist 拷进本机思源工作空间 `data/plugins/` |
| `pnpm spike` | 隔离内核 API 验证（9 项，勿在真实工作区跑） |
| `node scripts/e2e/load-check.mjs` | 隔离内核加载验证 |
| `node scripts/e2e/contacts-flow.mjs` | 联系人全流程 E2E（10 项） |
| `pnpm check:release` | 发布门禁（发版前必跑） |

## 动手前必读（按顺序）

1. **AGENTS.md** — 开发协议与铁律（不臆造思源 API / 分层单向依赖 / itemID≠块ID / SQL 安全面收敛等）
2. **docs/DATA-CONTRACT.md** — 数据契约（AV 主干、字段、§4 性能预算、§6 端点实测差异）
3. **docs/PROGRESS.md** — 当前进度与待办
4. **docs/ROADMAP.md** — 规划（关系库、AI、跨插件桥）
5. **docs/DECISIONS.md** — 已定决策（新决策追加条目，不翻旧案）

架构守门由 `tests/architecture.test.ts` 自动执行：域层纯函数（运行时相对导入必须带 `.ts` 扩展名）、
下层禁依赖组件、组件禁直接发内核请求——新增代码前先理解这些规则。

## 本地调试姿势

- 开发循环：`pnpm dev`（watch + live reload，思源里启用插件后改动自动生效）
- 隔离验证：E2E 脚本会用 `~/SiYuan-Renmai-E2E` 临时工作区拉起独立内核（端口 6828/6829/6830），
  绝不触碰日常笔记；工作区带标记文件保护
- 内核 API 端点行为全部以 `scripts/spike/av-spike.mjs` 实证为准，新端点先 spike 再进 `src/api/`

## 发布

见 `docs/RELEASE.md`：质量门禁 → 手工验收 → GitHub Release（package.zip）→ 集市 PR（一次只做一件事）。

## 当前状态速览（详见 docs/PROGRESS.md）

- v0.1.0 已发布（GitHub Release 附 package.zip；集市未上架，由作者择机提交）
- 已完成：联系人管理（含存量笔记收编）、vCard (.vcf) 导入导出、关系图谱、相关人物双链区块、
  农历生日提醒、久未联系仪表盘、从笔记捕获（含 AI 抽取）、人物文档档案条、对外人员服务桥、性能预算
- 待办：真机移动端验收；集市上架

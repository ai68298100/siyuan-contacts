# 小驴人脉 v0.5.6

本版本完成联系人、本人档案、组织成员和真实前端的发布前验收，重点修复独立内核浏览器认证导致的清理失败。

新增：真实 browser-desktop 联合验收

- 验证双页面桥接、稳定建档、生日编辑、账本、别名、跟进、组织成员编辑、组织归档恢复和跨窗口刷新。
- 验证独立内核写入、重启回读、迁移合并、组织投影和真实插件加载。

优化：E2E 认证与清理

- 真实页面导航前通过 CDP 注入隔离内核 `api.token`，第二页面采用先认证后导航的顺序。
- 测试结束后清理临时笔记本，避免认证失败限流掩盖业务结果。

修复：真实前端首屏认证竞态

- 修复思源 3.8.7 使用 `conf.api.token` 时 browser-desktop 首屏 API 请求缺少 `Authorization` 的问题。
- 修复第二页面首屏请求早于认证头安装的问题。

## 验证

- `pnpm check`：0 errors / 0 warnings
- `pnpm test`：555/555
- `pnpm test:ui`：330/330
- `pnpm test:ui:mobile`：331/331
- `pnpm test:ui:host`：330/330
- `node scripts/e2e/load-check.mjs`：通过
- `node scripts/e2e/contacts-flow.mjs`：13/13
- `node scripts/e2e/services-flow.mjs`：9/9
- `LVCT_REAL_FRONTEND=1 node scripts/e2e/services-flow.mjs`：实际服务 9/9、真实 browser-desktop 通过、清理成功
- `node --test tests/e2e-safety.test.mjs tests/e2e-parallel-runner.test.mjs tests/smoke-kernel.test.mjs`：21/21
- `pnpm build`、`pnpm check:release`、`git diff --check`：通过

真实 Android 真机、思源原生图入口、任务管理器互读、集市客户端可见性和 CardDAV 在线同步仍需单独验收；这些不影响本次隔离内核与真实 browser-desktop 验收结论。

## 安装

从 [GitHub Release v0.5.6](https://github.com/ai68298100/siyuan-contacts/releases/tag/v0.5.6) 下载 `package.zip`，解压到思源工作空间的 `data/plugins/siyuan-contacts/`，重启思源后启用插件。发布包同时提供 `package.zip.sha256`。

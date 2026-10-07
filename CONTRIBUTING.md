# Contributing to Lv Contacts

感谢贡献。请先阅读 [AGENTS.md](AGENTS.md) 和 [BRANCH-PROTOCOL.md](BRANCH-PROTOCOL.md)，它们定义了思源 API 实证、分层依赖、数据写入和分支发布边界。

## 提交前

- 不要臆造思源端点或参数；先在 `scripts/spike/` 中完成隔离实证，并更新 `docs/DATA-CONTRACT.md`。
- 内核交互只能放在 `src/api/`；插件自管 JSON 只能经 `src/data/storage.ts`。
- 联系人、组织、图谱和 AI 写入必须保留稳定 ID、写后回读、未知结果和安全重试边界。
- UI 改动请覆盖空、加载、失败、部分成功、未知、取消、暗色、窄屏和键盘/读屏状态（适用时）。

## 本地验证

```bash
pnpm install
pnpm check
pnpm test -- --test-concurrency=1
pnpm test:ui
pnpm test:ui:mobile
pnpm build
pnpm check:release
```

真实思源、Android 真机和多窗口验证要在 PR 中写明环境；隔离浏览器通过不能替代宿主验收。

## 提交与 Pull Request

请说明用户可感知的结果、涉及的契约或数据边界、已运行的验证命令，以及尚未验证的宿主范围。不要提交工作区导出、日志中的私人内容、token 或临时浏览器目录。

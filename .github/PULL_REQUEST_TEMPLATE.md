## 变更内容

<!-- 用一句话说明用户可感知的结果，并列出主要文件或模块。 -->

## 范围与兼容性

- [ ] 未扩大思源 API 契约；如有变更，已先更新 `docs/DATA-CONTRACT.md`
- [ ] 未改变插件自管 JSON 的存储键、迁移语义或重试边界
- [ ] 已分别检查桌面、移动窄屏、暗色主题和键盘/读屏状态（适用时）
- [ ] 涉及真实思源、Android 或多窗口时，已明确列出验证环境；隔离夹具不替代宿主验收

## 验证

- [ ] `pnpm check`
- [ ] `pnpm test -- --test-concurrency=1`
- [ ] `pnpm test:ui`
- [ ] `pnpm test:ui:mobile`
- [ ] `pnpm build`
- [ ] `pnpm check:release`

未运行的命令及原因：

## 截图或录屏（界面改动时）

<!-- 提供桌面/移动和明暗主题中最能说明变化的画面。 -->

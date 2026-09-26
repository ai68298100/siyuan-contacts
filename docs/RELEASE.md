# 发布清单（RELEASE）

> 首版 v0.1.0 发布流程。带 ❙ 的步骤是对外动作，执行前与用户确认。

## 1. 质量门禁（全部绿才发）

```bash
pnpm check    # tsc + svelte-check 0 错误
pnpm test     # 全部单测（域层/守门/i18n parity）
pnpm build    # dist/ + package.zip
node scripts/spike/av-spike.mjs          # 9/9（可选回归）
node scripts/e2e/load-check.mjs          # 隔离内核加载
node scripts/e2e/contacts-flow.mjs       # 联系人流程 8/8
```

- [ ] 版本号：plugin.json 与 package.json 一致（`pnpm update-version`）
- [ ] icon.png/preview.png 终稿（当前为脚本生成的家庭视觉版，可请人重绘后替换，重跑 gen-icon 逻辑不变）
- [ ] README.md / README.zh-CN.md 更新日志段落

## 2. 手工验收（真机）

- [ ] 桌面：向导初始化 → 新建/导入 → 卡片/表格/搜索 → 图谱 → 编辑资料 → 详情记互动 → 首页生日/久未联系
- [ ] 人物文档：档案条出现、编辑后刷新；建立关系后"相关人物"双链区块出现在文档里
- [ ] 移动端：顶栏入口 Dialog 全屏化、工作台四视图、新建/详情/图谱触控（真机）
- [ ] 亮/暗主题各过一遍（b3 变量应自动适配）
- [ ] 多窗口：两窗口同时写不丢数据（写后回读 + Web Lock 生效）

## 3. 对外发布 ❙

1. ❙ GitHub 创建公开仓库 `ai68298100/siyuan-contacts`（main 分支），push
2. ❙ GitHub Release：tag `v0.1.0`，附 package.zip 与说明（zip mtime 已按真实构建时间，防集市回滚）
3. ❙ fork `siyuan-note/bazaar` → `plugins.txt` 追加一行 `ai68298100/siyuan-contacts` → PR（一次 PR 只做上架一件事）
4. PR CI 通过后合并，索引 1-3 小时更新，思源重启刷新集市可见

## 4. 发布后

- [ ] GitHub Issues 打开；README 放反馈渠道
- [ ] 崩溃/丢数据类问题优先：存储纪律层已带写后回读，事件问题查 `data/storage/petal/siyuan-contacts/`
- [ ] v0.2 候选（见 ROADMAP）：完整英文翻译、关系库、VCF 导入、AI 能力

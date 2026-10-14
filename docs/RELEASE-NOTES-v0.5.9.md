# 小驴人脉 v0.5.9

本次发布聚焦现代高级 UI 质感深度重塑，全面提升视觉深度、排版层次、触感动效与跨端一致性。

新增：现代设计系统与复合微质感

- 引入自然环境光遮蔽（Ambient Occlusion）软漫反射阴影与 1px 顶切微发丝内高光，彻底解决浅色卡片融化与暗色线框感问题。
- 联系人、人物详情、初始化向导与组织 Logo 全面升级为 Squircle（超椭圆）温润圆角，并为五大人脉分组配置 135° 双色柔光渐变。
- 首页统计方块引入右上角径向微光晕（Radial Ambient Glow）与 28px Tabular-nums 大数字排版。

新增：分段滑轨与磨砂浮层控件

- 视图切换重塑为 iOS / Linear 级内凹滑轨与浮动药丸滑块，带有即时物理回弹微动效。
- 全局弹窗升级为 10px 现代磨砂毛玻璃遮罩，人物详情采用 22px / 700 大画幅排版。
- 关系图谱视图工具升级为全胶囊超透磨砂悬浮岛，画布加入中心空间微光场。
- 组织卡片统一 40px Squircle 徽标盒，并为在职成员引入翡翠绿状态呼吸指示灯（Status Dot）。

优化：侧栏、表格、时间线与全局细节

- 侧栏导航项重塑为现代悬浮药丸选中态，品牌图标增加微立体高光。
- 联系人表格引入吸顶半透明模糊表头（`backdrop-filter: blur(8px)`）与选中行 Accent 指示线。
- 人物详情互动历史升级为贯穿式时间轴条目（Timeline Track），往来账本引入收付双色指示条与金额大数字排版。
- 设置页分区导航与开关控件升级（iOS 18 级微拉伸感），向导卡片重塑为 18px Squircle 迎宾面板，主按钮增加 1px 顶切高光。
- 全局空状态升级为双层微容器，通知反馈条升级微光晕，滚动条优化为 6px 极细磨砂胶囊滑块，移动端底部栏升级 20px 毛玻璃。

## 验证

- `pnpm check`：TypeScript 与 Svelte 检查 0 错误、0 警告
- `pnpm test`：594/594（100% 通过）
- `pnpm test:ui`：378/378（桌面自动化全绿）
- `pnpm test:ui:mobile`：378/378（移动端自动化全绿）
- `pnpm build`：生产构建成功，保持单 `dist/index.js`
- `pnpm check:release`：版本、产物和 `package.zip.sha256` 全部通过

## 安装

从 [GitHub Release v0.5.9](https://github.com/ai68298100/siyuan-contacts/releases/tag/v0.5.9) 下载 `package.zip`，解压到思源工作空间的 `data/plugins/siyuan-contacts/`，重启思源后启用插件。发布包同时提供 `package.zip.sha256`。

本版本仍不改变已知限制：真实 Android 真机、思源原生图入口、任务管理器互读、集市客户端可见性和 CardDAV 在线同步需单独验收。

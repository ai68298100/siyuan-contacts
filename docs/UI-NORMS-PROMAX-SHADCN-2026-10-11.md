# UI 规范学习记录：UI/UX Pro Max 与 shadcn preset

日期：2026-10-11

新增：安装 UI/UX Pro Max 规范技能

- 通过官方 `ui-ux-pro-max-cli` 安装，版本以 npm `latest`（当前 2.15.0）为准。
- Codex 全局安装位置：`C:\Users\Admin\.agents\skills\ui-ux-pro-max`。
- 已验证 `SKILL.md`、`scripts/search.py`、Svelte 栈规则和 UX 指南数据可读取。
- 该技能作为检索式规范库使用，不能把搜索结果或生成的视觉风格当成当前产品已经采用的设计。

新增：核对 shadcn 预设 `b1YodLeK0`

通过 shadcn CLI 解码得到以下可复现配置：

| 配置项 | 预设值 |
| --- | --- |
| preset version | `b` |
| style | `nova` |
| base color | `mist` |
| theme | `indigo` |
| chart color | `blue` |
| icon library | `lucide` |
| font | `inter` |
| heading font | `inherit` |
| radius | `default` |
| menu accent | `subtle` |
| menu color | `default` |

来源：<https://ui.shadcn.com/create?preset=b1YodLeK0>。解码方式为 `pnpm dlx shadcn@latest preset decode b1YodLeK0`；预设代码是配置分享码，不是业务页面设计稿，也不表示本项目必须采用 indigo、Nova 或 React 组件。

优化：纳入人脉项目的实施规则

1. **语义令牌优先**：组件只消费背景、前景、卡片、静音、边框、环、危险等语义令牌；页面不能散落原始色值。人脉现有 `--lvct-*` 令牌继续作为唯一实现入口，主题映射由宿主上下文负责。
2. **状态可读**：按钮、输入框、选择器和对话框统一表达 `data-state`、`data-variant`、`data-size` 等状态概念；运行时对应 Svelte 的显式 class/aria 状态。选中、展开、忙碌、错误和禁用不能只靠颜色表达。
3. **焦点与禁用**：所有可操作控件保留可见 `:focus-visible` 环；禁用控件使用语义 `disabled`、降低强调并阻止点击，不以透明度代替原因说明。模态打开后焦点进入，关闭后回到触发控件。
4. **图标一致**：结构性图标使用同一套 SVG 图标（当前项目沿用已有图标系统）；图标按钮必须有可访问名称，装饰图标从读屏树隐藏，不使用 emoji 作为导航或系统控制图标。
5. **表单与反馈**：每个字段有可见标签；校验错误靠近字段并关联说明；提交按钮显示处理中、成功或失败；异步期间阻止重复提交并保留输入。复杂选项使用渐进展开。
6. **响应式与触控**：从窄容器开始设计，主要触控目标至少 44px，目标之间至少保留 8px 间距；不依赖 hover；小屏不出现非必要横向滚动，长姓名、URL 和标签允许换行或显式展开。
7. **动效与性能**：只用 transform/opacity 做轻量反馈，统一进入/退出节奏；尊重 `prefers-reduced-motion`；加载超过短暂等待使用骨架或进度，而不是无说明的长 spinner。
8. **窗口层级**：人物详情、新建组织等业务窗口保持正常居中宽版窗口；遮罩、焦点锁定、Esc 和嵌套窗口都按最上层窗口处理，不将窄侧栏作为唯一详情承载。

优化：与 R54 视觉基准的关系

- R54 继续负责人脉的页面结构、白色内容面、轻描边、留白和正常详情窗口等产品视觉基线。
- UI/UX Pro Max 负责规则检索、可访问性、响应式、表单反馈、动效和 Svelte 实施检查。
- shadcn preset 负责可复现的令牌/控件状态参考；不覆盖人脉既有青色品牌色和中文信息架构。
- 一次模糊的设计系统搜索可能返回 Liquid Glass、黑金等不适合本产品的风格。本轮只采纳规则，不采纳这些风格结果，避免把“规范库”误用成“设计库”。

修复：规范状态表述边界

- 本记录只说明已安装、已解码和已登记的规范，不把安装技能写成生产 UI 已完成升级。
- 真实思源宿主、移动真机、第三方主题和读屏行为仍须按现有 E2E/Host pending 门禁分别验收。
- 现有未提交改动来自前序 UI 迭代，本轮没有覆盖或回滚这些文件，也没有因规范学习直接改变生产数据契约。

## 参考来源

- UI/UX Pro Max：<https://github.com/nextlevelbuilder/ui-ux-pro-max-skill>
- UI/UX Pro Max README：<https://raw.githubusercontent.com/nextlevelbuilder/ui-ux-pro-max-skill/main/README.md>
- shadcn 创建器：<https://ui.shadcn.com/create?preset=b1YodLeK0>
- shadcn preset 命令说明：<https://ui.shadcn.com/docs/changelog/2026-04-preset-commands>
- WCAG 与 shadcn 组件状态的具体实现仍以组件源码及真实页面行为为准。

## 本轮实际落实

优化：补齐三个自由输入控件的稳定语义名称

- 粘贴识别正文增加“待识别的联系人内容”标签。
- 人物详情的互动备注增加“互动备注”标签。
- 人物详情的跟进标题增加“跟进标题”标签。

验证：`pnpm check` 通过（0 errors / 0 warnings）；域层测试 558/558；桌面 UI 回归 343/343；移动 UI 回归通过；控件静态审计 706 个控件，仅保留两个遮罩层背景点击区域的键盘复核项。

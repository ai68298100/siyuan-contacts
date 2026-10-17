# 原生联系方式块 Copy/Paste 静态路径复核（2026-10-17）

对应 `AG-RF-004-N1`、Issue #51/#54。本轮只读复核本机 SiYuan 已安装前端 bundle 和现有候选解析器，说明下一次真实编辑器复制/粘贴验收应该走哪条路径。未执行新的真实 Copy/Paste，未安装剪贴板监听，未读取系统剪贴板，未修改生产联系人模型。

```text
staticBundleReview=true
clipboardListenerInstalled=false
clipboardRead=false
uiPasteVerified=false
candidateContractAccepted=false
productionChanges=false
```

## 来源与版本

| 项目 | 本轮只读来源 |
| --- | --- |
| SiYuan 安装版本 | `D:\RJ\SiYuan\resources\app\package.json` 的 `version` 为 `3.8.8-alpha.2` |
| 复核 bundle | `D:\RJ\SiYuan\resources\stage\build\desktop\main.5e0834a2d919323c1136.js` |
| bundle SHA-256 | `B8733EB5A68BD5DFAAEDCFEE875AF74EC69767AC8FBA4F06B6C72C9453808E9A` |
| 候选读取代码 | `scripts/spike/contact-methods-native-research.mjs` 的 `parseMethodBlock`、`readPersonDocument` |

本机安装文件的版本与既有隔离 UI 报告相同；本轮没有重新核对正在提供页面的 HTTP 资源摘要，因此不能把静态 bundle 复核等同于新一轮运行时证据。下文的压缩符号只用于定位这份摘要对应的文件，不是受支持的宿主公开 API。

## 原生完整块复制路径

普通段落的原生块菜单存在两层相同的 `data-id="copy"`：

1. 父项由 `MenuItem({id:"copy", label:languages.copy, type:"submenu", submenu:ht})` 创建，只有子菜单，没有实际复制回调。
2. 子菜单中真正的完整块复制项为 `id:"copy"`、`label:languages.copy`、`accelerator:"⌘C"`。其回调先恢复该块的原生选择，再调用 `Mc(Z)`；`Mc` 的默认动作是 `document.execCommand("copy")`。
3. 桌面菜单通过 `mouseover` 展开 `.b3-menu__submenu`。仅点击父“Copy”不能证明已经复制；必须实际触发内层完整块复制项，并核对后续载荷和持久化结果。

这份 bundle 对应的 DOM 定位关系如下，下一次操作前仍要通过页面状态确认节点可见、来源确为目标原生块菜单：

```text
父项：#commonMenu > .b3-menu__items > [data-id="copy"]
实际复制项：上述父项 > .b3-menu__submenu > .b3-menu__items > [data-id="copy"]
```

“Copy block ref”“Copy plain text”“Copy rich text”“Duplicate”等入口有各自语义；不能使用它们的结果替代完整块 Copy → 普通 Paste 旅程。属性视图还存在 `copyMirror` 分支，本轮联系方式候选为普通段落，不从该分支推断行为。

## 复制载荷与观察出口

原生编辑器的 `copy` 处理代码可以向事件 `clipboardData` 写入 `text/plain`、`text/siyuan` 和 `text/html`。其中 `text/html` 包含以下隐藏原生载荷：

```text
<!--data-siyuan='BASE64 编码的原生块 DOM'-->
```

对应读取代码优先使用 `text/siyuan`，也能从 HTML 注释解码原生 DOM。因此只看剪贴板普通文本不足以判断自定义方法属性是否被保留；即使浏览器没有保留自定义 MIME 类型，HTML 内的原生载荷也可能参与粘贴。

以上只是静态可达路径，实际分支受选择范围、复制模式和浏览器能力影响。下一次应在专用 Chrome 隔离页面中执行原生完整块 Copy 和普通 Paste，先确认新块出现，再回读真实内核的 `id`、`root_id`、`parent_id`、`content`、`markdown` 和 `ial`；剪贴板载荷可作为补充，不能替代持久化回读。若在实际粘贴事件上观察载荷，观察器应被动记录且不改变默认事件；仅保存本轮虚构夹具的载荷，并明确记录原生事件与注入事件的区别。手工构造 `ClipboardEvent`、直接插入 DOM、调用内核 `insertBlock` 或自行重写属性只能证明各自路径。

## 下一次真实验收矩阵

先创建专用 UUID 临时工作区、两个虚构人物和有效的严格候选夹具。方法 ID 必须符合当前候选的 `method-${digest(personDocId + ":" + sourceKey)}` 规则，owner、source、正文头及 `content/markdown` 必须一致。先用候选读取器核实夹具可接受，再开始 UI 旅程。

| 旅程 | 必须观察与回读 | 候选读取器应给出的结果 |
| --- | --- | --- |
| 基线读取 | 源块完整正文、属性与合法方法身份；读取器接受后保存基线 | `accepted` |
| 真正复制 | 展开父 Copy 后触发内层完整块 Copy；普通 Paste 创建新原生块 | 新块事实由 UI 和内核回读确认；不能仅凭菜单可达判通过 |
| 同人粘贴且属性保留 | 新原生块 ID 与源块不同，方法 ID、owner、source 保留，原块仍在 | `duplicate / duplicate-method-id` 可见；不得静默当作新方法 |
| 跨人物粘贴且属性保留 | 新块 `root_id/parent_id` 指向乙，owner 与方法 ID 仍指向甲 | `conflict / parent-mismatch` 可见；不得自动重写 owner 后接受 |
| 粘贴时属性被宿主改写或丢失 | 全量记录实际保留与改写的属性，不仅查询仍带 marker 的块 | 按实际数据进入无标记、未知或冲突分支；不能报告“方法已复制” |
| 原生改正文导致折行 | 比较编辑前后正文、属性、候选读取报告 | 现有严格四行头被折叠时应 `unknown / body-header`，不能据属性保留宣布读取成功 |
| 刷新后回读 | 重新打开人物文档，再 SQL 和读取器核对源块、新块、报告 | 复制事实及拒绝报告保持一致 |
| 清理与停止 | 只停止本轮拥有的隔离进程与页面，保留脱敏证据 | 不触及日常工作区、用户浏览器页面或生产插件数据 |

同人复制保留方法 ID、跨人复制保留 owner，都是需要如实报告并拒绝静默采纳的输入；本研究不要求宿主自动改写成可接受的新方法。若未来设计显式“复制为新方法”，应另定用户确认、身份生成及来源语义，不能由这次原生粘贴推断。

## 当前证据边界

- [既有真实 UI 报告](MULTI-CONTACT-NATIVE-UI-2026-10-17.md)证明隔离宿主的读取、正文改值、属性保留、删除和重载行为；其中演示属性身份若使用 `ui-*`，只构成宿主行为证据，不满足严格候选的身份校验，不能回填为候选读取器已通过。
- 候选当前要求至少五行正文，前四行精确匹配“联系方式／标签／主值／值”。既有 UI 改值观察到的单行折叠会先触发 `unknown / body-header`，应先建合法夹具区分“复制冲突可见”与“正文格式已未知”。
- 当前计算机控制面没有可操作的 Chrome 页面，仅提供 IAB；本轮没有借外部 CDP 绕过该限制。真实 Copy/Paste 与剪贴板载荷、有效严格夹具回读仍为 `host_pending`。
- 同源多页面原生编辑竞争、真实 SiYuan 多窗口、真实用户工作区、搜索、备份恢复、真机及生产服务接入仍未覆盖。

`AG-RF-004-N1` 继续保持 `host_pending`，父卡 `AG-RF-004` 保持 `candidate`；本静态复核不能关闭 Issue #51/#54，也不采纳原生存储契约。

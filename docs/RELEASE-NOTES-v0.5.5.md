# 小驴人脉 v0.5.5

新增：联系人创建前置设置

- 新建联系人填写关系称谓时，可直接创建或指定“我”的档案。
- 前置条件失败不会留下半成品，当前联系人和补充资料草稿会保留。

优化：本人资料编辑与异步状态

- “我自己”编辑页显示工作单位和学校组织选择，隐藏不适用的自身关系称谓。
- 资料首次读取保持稳定加载态；导入、批量操作和资料编辑的忙碌按钮统一禁用，避免重复提交或误关闭。

修复：相关人读取与本人入口

- 兼容思源对空关系单元格省略 `relation` 或 `relation.blockIDs` 的返回形态，并按空关系处理。
- 非空但结构非法的关系数据仍会阻断写入，提示用户核实，避免覆盖异常数据。
- 统一首页、搜索和详情入口的本人标记，修复部分入口打开“我自己”后无法添加工作单位和学校的问题。

## 验证

- `pnpm check`：0 errors / 0 warnings
- `pnpm test`：550/550
- 桌面 UI：326/326
- 390px 移动 UI：327/327
- 宿主样式 UI：326/326
- `pnpm build`、`pnpm check:release`、`git diff --check`：通过

隔离 UI 回归不等于真实思源宿主、Android 真机或真实多窗口验收。原生图入口、任务管理器互读和集市客户端可见性仍需单独验证；CardDAV/CalDAV 在线同步尚未实现。

## 安装

从 [GitHub Release v0.5.5](https://github.com/ai68298100/siyuan-contacts/releases/tag/v0.5.5) 下载 `package.zip`，解压到思源工作空间的 `data/plugins/siyuan-contacts/`，重启思源后启用插件。

发布包同时提供 `package.zip.sha256`，下载后可使用 `sha256sum package.zip` 或 `Get-FileHash -Algorithm SHA256 package.zip` 核对。

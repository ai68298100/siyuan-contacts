# 小驴人脉 v0.5.12

本次修复 vCard 严格导入中空白 `FN` 遮住有效 `N` 结构化姓名回退的边界，并补充回归测试。

## 修复

- `FN` 为空或仅含空格时，允许使用有效的 `N` 姓名回退。
- Issue #35 尚未提供脱敏 VCF 样本，因此不能确认此边界就是小米导出文件的根因；该 issue 保持开放。

## 数据与迁移

- 不新增或改变插件自管 JSON。
- 不需要迁移。

## 已验证环境

- 插件版本：v0.5.12
- GitHub Actions [run 38748666687](https://github.com/ai68298100/siyuan-contacts/actions/runs/38748666687)：所有 job 通过
- `pnpm check`：0 errors / 0 warnings
- `pnpm test`：594/594
- 桌面隔离 UI：378/378
- 移动隔离 UI：378/378；C03 用例使用真实移动工具抽屉路径
- `pnpm build` 与 `pnpm check:release`：通过

## 未验证与已知限制

- Issue #35 的原始小米 VCF 尚未提供，不能确认本修复已解决该报告。
- 真实思源宿主、Android 真机、多窗口、原生图入口、任务管理器互读和集市客户端可见性仍需单独验收。
- 集市目录已收录插件，但客户端可见性尚未在真实设备验证。

## 回滚

回滚到 v0.5.11 的 `package.zip`，保留用户工作区和插件自管数据。

## 产物校验

- GitHub Release 附件 `package.zip`：581,557 B。
- SHA-256：`df49569967bd6c93e63728da62e42f1512e6eb973d85870ba5e46ae57986e660`（与 Release 下载的 `package.zip.sha256` 一致）。
- 发布 tag 指向代码提交：`589da09584a4946c641eba047e1f0b7f33c93d60`；最终安装包由文档同步提交 `75b634ddb2df46c5be816cdeb67e1767164ace34` 的 CI run 38748666687 构建，未修改运行时代码。
- [GitHub Release v0.5.12](https://github.com/ai68298100/siyuan-contacts/releases/tag/v0.5.12)。

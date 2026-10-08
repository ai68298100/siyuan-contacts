# 小驴人脉 v0.5.2

## 新增

- 编辑联系人时可直接填写“与我的关系”，并从活跃组织中选择工作单位和学校。
- 生日展示明确标注“公历/农历”，编辑农历生日时说明月日按农历解释。

## 修复

- 修复农历生日被按阳历日期排序的问题；农历生日按其农历月日换算为下一次实际发生日。
- 关系称谓、工作单位和学校资料纳入编辑页关闭守卫，未保存修改会被提示。

## 已验证环境

- `pnpm check`：0 errors / 0 warnings
- `pnpm test`：539/539
- `pnpm test:ui`：322/322
- `pnpm test:ui:mobile`：322/322
- `pnpm build`、`pnpm check:release`：通过

## 未验证与限制

- 真实思源宿主、Android 真机、真实多窗口、原生图入口和任务管理器互读仍未单独验收。
- 迁移包仍是插件自管数据的 JSON 快照，不是思源工作区字节级备份。

## 安装

从 [GitHub Release v0.5.2](https://github.com/ai68298100/siyuan-contacts/releases/tag/v0.5.2) 下载 `package.zip`，解压到思源工作空间的 `data/plugins/siyuan-contacts/`，重启思源后启用插件。

## 产物校验

- package.zip：508276 bytes
- SHA-256：e22258170a2cd618fedb0e0ca6d6dadd32be0c81d2a79124462fe8ba71247c5f

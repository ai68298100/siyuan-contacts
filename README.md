<div align="center">

# 小驴人脉

[![CI](https://github.com/ai68298100/siyuan-contacts/actions/workflows/ci.yml/badge.svg)](https://github.com/ai68298100/siyuan-contacts/actions/workflows/ci.yml)
[![Release](https://img.shields.io/github/v/release/ai68298100/siyuan-contacts)](https://github.com/ai68298100/siyuan-contacts/releases/latest)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
![SiYuan](https://img.shields.io/badge/思源笔记-%3E%3D%203.8.5-blue)

**把联系人、关系、组织和互动放进思源知识库。** 每个人是一篇普通思源文档，结构化资料由与文档关联的原生数据库管理。

**当前稳定版 v0.5.0** · [下载与更新](https://github.com/ai68298100/siyuan-contacts/releases/latest) · [更新日志](docs/CHANGELOG.md) · [反馈问题](https://github.com/ai68298100/siyuan-contacts/issues)

[English](README.en-US.md) | 简体中文

思源集市目录已收录本插件；集市客户端内的可见性尚未验收。若暂时搜不到，可按下方说明手动安装。

<img src="preview.png" alt="小驴人脉预览" width="640" />

</div>

---

## 功能

- **联系人档案**：卡片与表格名册、搜索筛选与保存视图、从已有笔记批量收编、粘贴识别、vCard 导入导出；支持别名、关系称谓、独立备注、资料档案条和会面简报。
- **关系与组织**：联系人双向关联、关系图与文档引用图；组织支持多段任职历史、成员管理与共同背景查看。
- **互动记录**：从会议或聚会笔记捕获参与者和共同交集；按人物查看互动时间线，并用往来账本记录金钱、物品或人情的应收应付事项。
- **提醒与跟进**：公历和农历生日、联系节奏、跟进计划与今日行动清单；跟进事项可同步为人物文档中的思源原生任务块。
- **回顾与检查**：互动回顾报表、资料体检、待处理事项和可跳转的修复入口。
- **备份与扩展**：导出互动备份或插件数据迁移包；其他插件可通过 `window.LvContacts` 搜索、创建联系人和记录交集，详见[人员服务桥](docs/BRIDGE.md)。
- **可选 AI 辅助**：仅在你主动触发分析时，才把相关笔记内容发送到你配置的思源 AI 端点；插件不含遥测。

## 安装

需要思源笔记 **3.8.5 或更新版本**。可在思源集市中搜索「小驴人脉」；若客户端尚未显示，使用 GitHub Release 手动安装：

1. 下载最新 [Release 中的 `package.zip`](https://github.com/ai68298100/siyuan-contacts/releases/latest)。
2. 将压缩包内容解压到思源工作空间的 `data/plugins/siyuan-contacts/`，确认 `plugin.json` 直接位于该目录根部。
3. 重启思源，在「设置 → 集市 → 已安装」中启用「小驴人脉」。手动安装的插件不会出现在集市下载列表中。

## 快速开始

1. 点击思源顶栏的人脉图标，按向导初始化联系人笔记本和数据库。
2. 在联系人页新建人物，或批量收编已有文档、导入 `.vcf`、粘贴名片文字识别。
3. 在人物详情中添加关系、组织归属、互动记录和个人备注；备注会写入该人物文档。
4. 在会议笔记中链接联系人，再通过右键菜单捕获参与者和共同交集。
5. 到首页查看生日、久未联系和跟进事项；需要迁移插件数据时，从设置页导出迁移包。

## 数据与迁移

联系人文档和结构化资料保存在思源工作空间；卸载插件不会删除这些人物文档。每个人的独立备注也保存在对应人物文档中。

互动、跟进、提醒状态、模板等插件自管数据保存在插件数据目录中，卸载或删除该目录时可能一并丢失。卸载前请先从设置页导出插件数据迁移包。迁移包提供数据值级导出与恢复预览，**不是整个思源工作区备份或文件字节副本**；它不包含联系人文档、原生数据库及其绑定锚点、界面偏好，也不单独导出人物备注。跨工作区迁移时，还需通过思源自己的迁移流程带走联系人文档与数据库。

## 当前边界

- 真实用户工作区、Android 真机、真实多窗口并发、思源原生图入口和任务管理器互读仍待单独验收；隔离浏览器与移动视口测试不能替代这些验收。
- 英文界面尚未完整本地化。
- 当前支持 vCard 文件导入导出，不支持 CardDAV 通讯录或 CalDAV 日历在线同步。
- 集市 PR 已合并且目录索引包含本插件；客户端是否已展示仍待实际核对。

## 开发

需要 Node.js 24+、pnpm 12.x 和思源 3.8.5+。安装依赖后，先启动思源并运行 `pnpm make-link` 配置开发热重载，再运行 `pnpm dev`。

```bash
pnpm install
pnpm check          # TypeScript 与 Svelte 检查
pnpm test           # 单元测试与架构守门
pnpm test:ui        # 桌面隔离 UI 回归
pnpm test:ui:mobile # 移动视口隔离 UI 回归，不是真机验收
pnpm build          # 构建 dist/ 与 package.zip
pnpm check:release  # 发布包门禁
```

开始改动前请阅读[开发协议](AGENTS.md)、[交接指南](docs/HANDOFF.md)和[数据契约](docs/DATA-CONTRACT.md)。更多文档见[路线图](docs/ROADMAP.md)、[设计决策](docs/DECISIONS.md)与[更新日志](docs/CHANGELOG.md)。

## 反馈与许可

请通过 [GitHub Issues](https://github.com/ai68298100/siyuan-contacts/issues) 提交问题或建议，并附思源版本、插件版本、复现步骤和脱敏日志。

本项目使用 [MIT License](LICENSE)。

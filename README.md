<div align="center">

# 小驴人脉 (Lv Contacts)

[![CI](https://github.com/ai68298100/siyuan-contacts/actions/workflows/ci.yml/badge.svg)](https://github.com/ai68298100/siyuan-contacts/actions/workflows/ci.yml)
[![Release](https://img.shields.io/github/v/release/ai68298100/siyuan-contacts)](https://github.com/ai68298100/siyuan-contacts/releases)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
![思源笔记](https://img.shields.io/badge/思源笔记-%3E%3D%203.8.5-blue)

**在思源笔记里管理人脉与人际关系：人物是文档，资料由思源原生数据库承载。**

**最新稳定版：v0.5.3** · [下载与安装](https://github.com/ai68298100/siyuan-contacts/releases/tag/v0.5.3) · [提交 Issue](https://github.com/ai68298100/siyuan-contacts/issues)

[English](README.en-US.md) | 简体中文

<img src="preview.png" alt="小驴人脉预览" width="640" />

</div>

---

小驴人脉把联系人、关系和共同经历放进思源工作空间。每个人对应一篇普通思源文档，结构化资料保存在与文档关联的思源数据库中，可继续使用思源的搜索、双链和同步。

## 🐴 小驴插件系列

目前已开发的插件：

- [**小驴雷切**](https://github.com/ai68298100/siyuan-speed-switch)
- [**小驴打卡**](https://github.com/ai68298100/siyuan-checkin)
- **小驴人脉**（本项目）
- [**小驴拾遗**](https://github.com/ai68298100/siyuan-glean)

各插件独立维护，围绕思源笔记的导航、记录、资料整理和人脉管理协同使用。

## 功能

| 能力 | 说明 |
|---|---|
| 联系人名册 | 卡片与表格视图、搜索、分组与组合筛选、保存视图、资料补录、批量收编已有笔记、疑似重复提示 |
| 通讯录与快速录入 | 导入 vCard 2.1/3.0/4.0 文件，导出 vCard 3.0；粘贴名片或聊天文字识别资料，也可从编辑器选区或整篇笔记识别 |
| 人物资料 | 本人档案、人物别名、「与我的关系」称谓、人物文档档案条、可写回人物文档的独立备注 |
| 关系与组织 | 双向人物关系、关系图与文档引用图；组织及多段成员历史、共同背景和关系查询 |
| 互动与捕获 | 从会议笔记捕获参与者和共同经历；互动时间线、备注模板、往来账本、交往回顾报表和会面简报 |
| 提醒与跟进 | 公历/农历生日、联系节奏、久未联系提醒；跟进事项可同步为人物文档中的思源原生任务块 |
| 资料检查与插件桥接 | 只读资料体检并跳转处理；通过 window.LvContacts 为其他插件提供选人、建人和记录共同经历的能力 |
| 移动布局 | 响应式工作台与全屏弹窗，移动视口有隔离回归覆盖 |

## 安装

当前通过 GitHub Release 手动安装，尚未上架思源集市。

1. 从 [v0.5.3 Release](https://github.com/ai68298100/siyuan-contacts/releases/tag/v0.5.3) 下载 package.zip。
2. 将压缩包内容解压到思源工作空间的 data/plugins/siyuan-contacts/，确认 plugin.json 位于该目录根部。
3. 重启思源，在「设置 → 集市 → 已安装」中启用「小驴人脉」。

要求：思源笔记 **3.8.5 或更高版本**。

## 数据与隐私

联系人文档、人物独立备注和数据库属于思源工作区内容。插件不发送遥测；AI 识别只在用户主动操作时调用思源配置的 AI 服务，相关笔记内容会发送给该服务。

互动、跟进、节奏、提醒暂缓、收编索引、模板、往来账本、别名、本人身份、组织成员和关系称谓等插件自管数据保存在思源的插件数据目录。卸载或删除插件数据前，请先在「设置 → 导出中心」导出插件数据迁移包；插件数据目录被删除时，这些数据可能丢失。

迁移包是带差异预览的 JSON 值快照，不是工作区备份或字节级备份。它包含上述 11 类插件数据，但不包含人物/组织文档、联系人数据库、数据库锚点、界面偏好和未完成操作断点；人物独立备注保存在人物文档中，不会作为迁移包的单独条目导出。跨工作区迁移时，先通过思源迁移人物和组织文档及数据库，再在插件中重绑数据库，最后导入迁移包；插件不会按姓名猜测文档对应关系。

## 已知限制

- 移动视口回归和隔离内核测试不等于真实宿主验收；真实用户工作区、Android 真机、软键盘/安全区和真实多窗口尚未验收。
- 思源原生图入口、任务管理器互读及集市可见性尚未验收；当前请按上方步骤手动安装。
- 插件界面英文翻译尚未完整，部分内容可能显示为中文。
- 当前不支持 CardDAV 通讯录或 CalDAV 日历在线同步；通讯录交换通过 vCard 文件完成。

各项验证范围见 [v0.5.3 发布说明](docs/RELEASE-NOTES-v0.5.3.md)。

## 快速开始

1. 点击思源顶栏的人脉图标，按向导建立联系人笔记本和数据库。
2. 在联系人页新建人物、收编已有笔记、导入 .vcf，或粘贴文字识别资料。
3. 在人物详情中维护关系、组织归属、独立备注和往来记录。
4. 在会议笔记中右键选择「人脉：捕获本文人员」，记录参与者与共同经历。
5. 在首页查看生日、联系提醒和待跟进事项；卸载前先导出插件数据迁移包。

## 开发

需要 Node.js 24 或更高版本、pnpm 12.x。安装依赖后启动思源，首次调试先运行 pnpm make-link 配置热重载链接，再运行 pnpm dev。

常用检查：pnpm check、pnpm test、pnpm test:ui、pnpm test:ui:mobile、pnpm build、pnpm check:release。移动视口测试不代表真机验收。

开发约定见 [AGENTS.md](AGENTS.md) 和 [开发交接](docs/HANDOFF.md)，存储边界见 [数据契约](docs/DATA-CONTRACT.md)，变更记录见 [CHANGELOG](docs/CHANGELOG.md)。

## 反馈与许可

问题与建议请提交 [GitHub Issues](https://github.com/ai68298100/siyuan-contacts/issues)，附思源和插件版本、复现步骤及脱敏日志。

交流 QQ 群：**871707735**

[MIT License](LICENSE)

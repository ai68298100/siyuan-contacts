<div align="center">

# 小驴人脉 (Lv Contacts)

[![CI](https://github.com/ai68298100/siyuan-contacts/actions/workflows/ci.yml/badge.svg)](https://github.com/ai68298100/siyuan-contacts/actions/workflows/ci.yml)
[![Release](https://img.shields.io/github/v/release/ai68298100/siyuan-contacts)](https://github.com/ai68298100/siyuan-contacts/releases)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
![SiYuan](https://img.shields.io/badge/思源笔记-%3E%3D%203.8.5-blue)

**在思源笔记里管理人脉与人际关系：一人一文档，数据库作主干。**

[English](README.en-US.md) | 简体中文

<img src="preview.png" alt="小驴人脉预览" width="640" />

</div>

---

## 为什么做这个插件

手机通讯录只存号码，商业 CRM 只为销售服务。**人脉是笔记内容的一部分**——会议记录里提到的人、聚会认识的朋友、日记里的往来，都应该长在你的知识库里，而不是锁在某个 App 中。

小驴人脉的答案：**每个联系人就是一篇普通的思源文档**（双链、搜索、同步一切照旧），结构化信息存进与文档绑定的[思源原生数据库](https://github.com/siyuan-note/siyuan)（思源 3.8+ 的"数据库"功能），插件负责把它变成好用的管理界面。

> 🔒 **数据主权**：所有数据都在你的工作空间里，不上云、无遥测；卸载插件后联系人数据原样保留。

## ✨ 功能

| | 功能 | 说明 |
|---|---|---|
| 🗂 | **联系人管理** | 卡片/表格双视图、即时搜索、分组与标签筛选；支持**从已有笔记批量收编**为联系人（不动文档本身） |
| 🧑‍🤝‍🧑 | **人际关系** | 数据库 relation 字段双向关联（内核自动维护回链）；Cytoscape 关系图谱，节点按分组着色、按关系数定大小 |
| 📝 | **从笔记捕获** | 会议/聚会笔记里 `[[链接]]` 联系人 → 一键识别参与者、记录共同交集（时间/地点/备注）、写入「参与人员」区块；可选 AI 抽取未链接的人名 |
| 🎂 | **生日提醒** | 公历/**农历**生日投影，首页近期生日与"久未联系"仪表盘 |
| 📄 | **人物文档档案条** | 打开联系人文档自动显示资料条，编辑资料全字段可改 |
| 🔌 | **人员服务桥** | 对其他插件暴露 `window.LvContacts`：搜索/创建联系人、记录共同交集（[接入文档](docs/BRIDGE.md)） |
| 📱 | **移动端** | Dialog 全屏化适配，手机上完整可用 |

## 📦 安装

- 思源集市上架审核中，当前请使用手动安装：
  1. 从 [Releases](https://github.com/ai68298100/siyuan-contacts/releases) 下载 `package.zip`
  2. 解压到思源工作空间 `data/plugins/siyuan-contacts/`（保持目录名与插件名一致）
  3. 重启思源 → 设置 → 集市 → 下载 → 启用「小驴人脉」
- 要求：**思源笔记 ≥ 3.8.5**

## 🚀 快速上手

1. **初始化**：顶栏点击人脉图标 → 向导自动创建「人脉」笔记本、联系人总表与数据库（字段一次配齐）
2. **建人**：「联系人」页新建，或「导入已有文档」把存量人名笔记批量收编
3. **建关系**：详情弹窗里添加相关人（双向自动回链）；「关系图谱」页查看全景
4. **记交集**：会议/聚会笔记右键 → 人脉：捕获本文人员 → 勾选参与者、填日期地点
5. **看提醒**：「首页」近期生日（含农历）、久未联系一目了然

## 🛠 开发

```bash
pnpm install
pnpm dev            # 监听构建 + 思源内热重载
pnpm check          # tsc + svelte-check
pnpm test           # 域层单测 + 架构守门 + i18n parity
pnpm build          # dist/ + package.zip
pnpm check:release  # 发布门禁
pnpm spike          # 隔离内核 API 验证（9 项）
node scripts/e2e/contacts-flow.mjs   # 真内核流程 E2E（10 项）
```

架构约定见 [AGENTS.md](AGENTS.md)，存储契约见 [docs/DATA-CONTRACT.md](docs/DATA-CONTRACT.md)，
设计决策见 [docs/DECISIONS.md](docs/DECISIONS.md)，路线图见 [docs/ROADMAP.md](docs/ROADMAP.md)。

## 🤝 生态

其他插件想获得"选人/建人/记交集"能力？接入 [人员服务桥](docs/BRIDGE.md)（`window.LvContacts` 协议 v1）即可，欢迎联系 `ai68298100`。

## 📄 许可

[MIT](LICENSE)

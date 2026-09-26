# 小驴人脉 (Lv Contacts)

在[思源笔记](https://b3log.org/siyuan)里管理人脉与人际关系：**一人一文档**，思源数据库作主干。

- 每个联系人都是一篇普通思源文档——双链、搜索、同步一切照旧。
- 结构化字段（生日含农历、电话、邮箱、微信、网站、分组、标签、认识信息）存放在与人物文档绑定的原生数据库中。
- 人与人的关系用数据库 `relation` 关联字段（双向）表达。
- 主工作台：仪表盘、卡片/表格视图、关系图谱（路线图 M2–M5）。
- 生日/纪念日提醒，支持农历（路线图 M4）。
- 数据全部留在你的工作空间——不上云、无遥测。

## 环境要求

- 思源笔记 ≥ 3.8.5

## 开发

```bash
pnpm install
pnpm build          # 产出 dist/ 与 package.zip
pnpm test           # node --test
pnpm spike          # 隔离内核上的 AV API 验证
pnpm make-install   # 把 dist 拷进运行中的工作空间
```

存储契约见 `docs/DATA-CONTRACT.md`，架构决策见 `docs/DECISIONS.md`。

## 许可

MIT

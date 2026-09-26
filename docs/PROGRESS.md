# 进度（PROGRESS）

## M0 — API 验证 spike ✅（2026-09-27）

- 隔离内核（v3.8.5）上 9/9 验证通过：建库、建字段、relation 双向、文档绑行、itemID 映射、
  单元格读写、解绑语义、带值建行、SQL 探测。详见 `scripts/spike/spike-results.json`。
- 关键差异记录进 `docs/DATA-CONTRACT.md` §4。

## M1 — 脚手架 + 初始化向导（进行中）

- [x] vite-svelte 模板移植（裁剪 kernel target，D-0003）
- [x] plugin.json / i18n / 占位图标 / 构建脚本
- [x] 域层（字段契约、设置模型 normalize）
- [x] api 层（client/av，全部 spike 实证形状）
- [x] 存储纪律层（写后回读 + Web Lock）
- [x] 初始化服务 + 向导/工作台组件 + 插件入口
- [x] 架构守门测试 + 域层单测
- [ ] 构建 + 隔离内核加载验证

## 待启动

- M2 联系人核心：新建联系人（文档+绑行+写值）、卡片/表格视图、属性面板
- M3 关系图谱：relation 维护 UI、相关人物双链区块、Cytoscape 图谱
- M4 提醒仪表盘：公/农历生日投影、互动事件、仪表盘、打卡联动接线
- M5 移动端打磨 + i18n parity + 发版上架

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

## M2 — 联系人核心 ✅（2026-09-27）

- [x] 域层 person 纯函数（草稿校验、日期互转、行→摘要投影）+ 10 项单测
- [x] contacts 服务：新建（查重→建文档→绑行→写值→回读）与列表查询
- [x] 联系人视图：卡片/表格双形态、搜索（300ms 防抖）、分组筛选、新建弹窗
- [x] facade.openPersonDoc：点击卡片/行打开人物文档
- [x] 真内核流程验证 6/6（scripts/e2e/contacts-flow.mjs）：含重复创建拒绝、
      字段投影、**双向关联回链由内核自动维护**（张三→李四，李四回链自动出现张三）
- [x] 端点差异沉淀：`createDocWithMd` 同路径**会**再建新文档，防重必须走联系人查询（D-0007）

## 待启动

- M2 联系人核心：新建联系人（文档+绑行+写值）、卡片/表格视图、属性面板
- M3 关系图谱：relation 维护 UI、相关人物双链区块、Cytoscape 图谱
- M4 提醒仪表盘：公/农历生日投影、互动事件、仪表盘、打卡联动接线
- M5 移动端打磨 + i18n parity + 发版上架

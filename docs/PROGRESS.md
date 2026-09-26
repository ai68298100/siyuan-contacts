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

## M3 — 关系图谱 ✅（2026-09-27）

- [x] `domain/graph.ts`：buildGraph 纯投影（itemID 边→docId 节点、无向去重、度数累计、自环/未知目标丢弃）+ 单测
- [x] RelationGraph：cytoscape cose 力导向布局、分组固定色板、度数映射节点大小、
      主题色运行时读取（cytoscape 无法用 CSS 变量）、点击节点→详情
- [x] PersonDetail 弹窗：档案字段 + 关系列表增删（addRelation/removeRelation 幂等），
      Workbench 层统一承载弹窗（联系人/图谱两视图共用）
- [x] cytoscape 3.34 从 npmmirror 安装（npmjs 源超时）；bundle 509KB/gzip 166KB
- [ ] 人物文档"相关人物"双链区块写入（defer；图谱/反链可见性已由 relation 字段+详情覆盖大部分）

## M4 — 提醒+仪表盘 ✅（2026-09-27）

- [x] lunar.ts 农历换算移植（打卡同源）+ occasions 生日投影（公历/农历月日语义、2/29 平年顺延 3/1、分桶）
- [x] 互动事件（只追加+墓碑+幂等）存储纪律层 + 详情页"记一笔互动" + 久未联系筛选
- [x] 首页仪表盘：统计（人数/关系/本周生日/从未互动）、近期生日列表、久未联系列表
- [x] 需求② 文档收编：选笔记本→按名过滤→勾选→批量绑行（不动文档本身）
- [x] 需求① 插件头像：打卡/雷切同视觉语言，双人剪影主图形（SDF 矢量生成）
- [x] 需求③④ 深化设计落 docs/ROADMAP.md（关系类型化/图谱交互/AI 三优先级）
- [x] 单测 23 项全绿（含农历换算自洽、墓碑不复活、久未联系排序）
- 端点行为沉淀：`refreshNotebooks` 端点不存在（创建后直接 lsNotebooks 即可）

## 待启动

- M4 提醒仪表盘：公/农历生日投影（移植打卡 lunar.ts+occasions 模型）、互动事件（source+externalRef 幂等+墓碑）、
  仪表盘页（近期生日/久未联系/统计）、打卡联动接线（bridge 协议 v5 探测已就位）
- M5 发布：人物文档属性面板/相关人物区块、移动端深度适配（真机）、i18n parity、
  GitHub 仓库创建+首版 release（package.zip）+ bazaar PR

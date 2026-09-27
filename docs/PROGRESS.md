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

## 性能加固（2026-09-27，应"人数增长数据库变大"关注）

- [x] 名册缓存（domain/roster 纯函数 + services/roster 缓存壳）：全员扫描型需求共享一次渲染，TTL 30s + 写失效
- [x] 联系人列表客户端过滤 + 200/页"加载更多"；搜索零内核往返
- [x] 收编批量合并（200/批）；图谱 800 节点上限（capGraph 纯函数 + UI 截断提示）
- [x] SQL 安全面收敛到一处（ID 严格校验，自由文本不进语句）——响应"参数绑定"约束在无绑定占位符 API 下的等价实现
- [x] DATA-CONTRACT §4 性能预算 / §5 万级演进预案（持久化名册、事件分段、内核分页、生日倒排）
- [x] 单测增至 27 项（roster 新鲜度/投影、capGraph 截断）

## M5 — 发布准备（2026-09-27，代码面完成）

- [x] 相关人物双链区块：关系变更后自动同步双方人物文档（单块 + custom-lvct-related 标记 + 幂等 upsert），
      思源原生反链/关系图可见；块属性存于 blocks.ial、IAL 须独占一行（§6 新增两条实证）
- [x] 人物文档档案条：联系人文档标题下注入资料条 + 编辑资料弹窗（全字段更新含清空语义）
- [x] i18n parity 测试（zh/en 键集一致 + 非空守门）；D-0010 语言策略修订（zh 为主，en v0.2 补全）
- [x] docs/RELEASE.md 发布清单（质量门禁/手工验收/对外发布步骤）
- [ ] 真机移动端验收（需真机）
- [ ] ❙ 对外发布：GitHub 建仓 + Release + bazaar PR（等用户确认执行）

## 从笔记捕获人脉 v0.2a（2026-09-27）

- [x] refs 出链识别（kramdown 块引实证入索引）+ 确认弹窗（勾选参与者/新人名单/日期/地点/备注）
- [x] 每人一条互动事件（externalRef=笔记 ID 同场身份，幂等）+ 笔记「参与人员」双链区块
- [x] 入口：命令面板 captureFromNote + 编辑器右键"人脉：捕获本文人员"
- [x] E2E 增至 10/10（refs 识别 + 参与人区块）
- [x] 设计沉淀：v0.2b AI 抽取、v0.2c 跨插件桥（window.LvContacts + Agent 能力）→ ROADMAP；
      D-0011 共同交集边界、D-0012 集成方向
- [ ] SQL 收敛备注：查询组装全部收进 api/blocks.ts（refs/文档清单/单块/属性定位）

## v0.2b/c — AI 抽取 + 对外人员服务桥（2026-09-27）

- [x] v0.2b AI 抽取：捕获弹窗"AI 分析本页"→ `/api/ai/chatGPT`（回复为纯文本）抽取未链接人名/日期/地点；
      提示词与解析为域层纯函数（容错：围栏 JSON、混杂文本、去重去空、上限 20）；未配置 AI 可识别并提示；
      名册对账输出 matched（直接勾选）/ unknownNames（预填收编框）；AI 只提名，落库必经用户确认
- [x] v0.2c 对外人员服务桥：`window.LvContacts` protocol 1（searchPeople / getPerson / ensurePerson /
      recordInteraction），幂等键 defaultBridgeRef（同批人员+同日）；协议文档 docs/BRIDGE.md
      （含任务插件接入示例）；卸载时自动摘除
- [x] 单测增至 33 项；E2E 10/10；加载验证通过

## 发布前打磨（2026-09-27）

- [x] 详情页互动时间线（最近 5 条，含"同场 N 人"标注）+ 共同出席统计（buildCoAttendance 纯函数，按 externalRef 同场身份实时计算）
- [x] CI 工作流（GitHub Actions：check + test + build + release gate + dist artifact）
- [x] `pnpm check:release` 发布门禁：版本一致性、dist 完整性、zip/icon/preview 体积限制
- [x] 单测 36 项全绿（新增 insights：时间线倒序/同场聚合/共同出席计数）

## v0.1.0 已发布 ✅（2026-09-27）

- 仓库：https://github.com/ai68298100/siyuan-contacts（public，CI 首跑绿）
- Release：https://github.com/ai68298100/siyuan-contacts/releases/tag/v0.1.0（附 package.zip）
- bazaar 上架：按用户要求暂缓，优化后由用户择机提交（清单见 docs/RELEASE.md §3）

## 待启动

- M4 提醒仪表盘：公/农历生日投影（移植打卡 lunar.ts+occasions 模型）、互动事件（source+externalRef 幂等+墓碑）、
  仪表盘页（近期生日/久未联系/统计）、打卡联动接线（bridge 协议 v5 探测已就位）
- M5 发布：人物文档属性面板/相关人物区块、移动端深度适配（真机）、i18n parity、
  GitHub 仓库创建+首版 release（package.zip）+ bazaar PR

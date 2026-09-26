# 架构决策记录（DECISIONS）

每条决策带编号、日期与动机；重大翻转需新增条目而非修改旧条目。

## D-0001（2026-09-27）数据主干选思源数据库（AV），不用插件自管 JSON

人脉数据天生是"笔记内容的一部分"：用户要求一人一文档、要双链、要卸载插件后数据仍在。
AV 官方 API 完整覆盖建库/绑行/写值/关联（M0 spike 9/9 实证），并提供原生四视图与筛选。
打卡插件的自管 JSON 路线仅适用于"本就不该长在文档里"的数据（打卡记录）；本插件自管 JSON 只存
设置/偏好/可选事件缓存。参照 [[D-0004]]。

## D-0002（2026-09-27）技术栈选官方 vite-svelte 模板（Vite 8 + Svelte 5 + pnpm），不用自家 webpack 栈

本插件是三个插件里表单/视图最重的（卡片、表格、图谱、属性面板、移动端）。
Svelte 5 响应式显著降低视图层成本；发布流水线由通用发版 skill 负责、E2E 基建是内核级与打包器无关，
"复用自家 webpack 基建"的收益弱于组件化收益。约束：**域层/数据层保持框架无关纯 TS**，
Svelte 只出现在 components/，由 `tests/architecture.test.ts` 守门。

## D-0003（2026-09-27）M1 砍掉模板的 kernel.js 双 target

内核插件（goja 运行时）为常驻后台服务而生，本插件 M1-M4 无内核侧需求；
保留会带来发布物维护成本。需要接思源 Agent 或后台提醒服务时（远期）再引入，
模板 `plugin-sample-vite-svelte` 的 kernel-capture 示例仍在官方仓库可考。

## D-0004（2026-09-27）UI 文案 M1 先中文硬编码，i18n 全面接入放 M5 发布门禁

目标用户中文优先；向导/工作台的完整双语键表在 M5 落地（`public/i18n/*.json` +
i18n parity 测试）。plugin.json 的 displayName/description 双语从第一天就绪。

## D-0005（2026-09-27）relation 自关联双向作为 MVP 关系主干；类型化关系库放二期

单一 relation 字段存边成本最低且原生可 rollup；关系类型（同事/家人/引荐人）的严谨建模需要
"行=关系"的独立库，MVP 用「分组列着色图谱 + 文档双链区块」过渡，二期一键升级，不做半吊子中间态。

## D-0007（2026-09-27）新建联系人的防重与收编语义

`createDocWithMd` 对同路径**会再建新文档**（不是幂等返回原 ID，E2E 实证）。因此：
1. 防重判据 = 按姓名查 `renderAttributeView`（query=姓名）中的精确名匹配，与文档 ID 无关；
2. 通过防重后，若目标文档已存在但未绑定行（用户手建的文档），直接收编（补绑行+写字段）；
3. 已绑定的同名联系人 → 抛错由 UI 呈现。

## D-0008（2026-09-27）渲染值的 select 选项用 content，列定义 options 用 name

写入与回读的单元格值 `mSelect[].content`；仅 `view.columns[].options[].name` 是列元数据。
api/av.ts 以两个类型显式区分（AvValueOption / AvColumnOption），防止混用。

## D-0009（2026-09-27）关系数据以 itemID 为边、文档 ID 为节点

relation 字段的 blockIDs 存的是行 itemID；卡片跳转与图谱节点用 docId。
ContactSummary 同时携带两者（itemId/docId/relatedItemIds），换算只在服务层做一次，
组件层禁止再触碰映射端点。

## D-0006（2026-09-27）锚点 ID 信任链：设置固化，绝不反查

notebookId/hostDocId/dbBlockId/avId/fieldMap 全部在初始化时固化为插件设置；
运行时不按名称/路径反查（用户改名是常态）。锚点失效（文档被删等）在设置页给出重建入口，不做静默自愈。

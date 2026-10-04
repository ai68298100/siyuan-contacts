# 联系人字段来源与支持边界

本表以当前源码和 DATA-CONTRACT 为事实基线；不将原型字段当作已支持字段。联系人主键为绑定文档，九个预设列按稳定 keyID 读取，不按用户改过的列名识别。

| 资料 | 唯一事实源 | 编辑与清空 | 导入/导出边界 |
|---|---|---|---|
| 姓名 | 绑定文档标题；itemID 经 mapBoundDocIds 转换 | 姓名必填；同名可明确建独立人物，未绑定候选按 ID 确认，不自动收编；新建断点按原请求核实；资料编辑不改文档标题 | FN，缺失时回退 N；斜杠和控制字符写前拒绝；vCard 同名默认跳过，可逐项确认独立导入 |
| 生日 | AV date；isNotEmpty 决定是否为空 | 本地日期核实，清空验证空标记；1970 年前日期不按缺失处理 | BDAY 必须是合法、带年份日期；无年份/文本/非法日期需人工核对，不猜测 |
| 农历生日 | AV checkbox，与生日列共同表达 | 核实 checkbox；清空生日不虚构日期 | X-LVCT-BDAY-LUNAR 保留本插件农历语义；外部 BDAY 按公历 |
| 电话 | AV phone 单值文本 | 编辑、补录、批量写入及清空均回读核实 | 多 TEL 保留为 ` / ` 连接的单值文本；导出仍为单条 TEL |
| 邮箱 | AV email 单值文本 | 非法格式写前拒绝；支持清空 | 多 EMAIL 只取首个；未选值不写入 |
| 微信 | AV text | 编辑、补录、批量写入及清空 | 没有 vCard 标准映射，不伪装导出保存 |
| 网站 | AV url | 编辑、补录、批量写入及清空 | URL 只取首个 |
| 分组 | AV select | 单选；清空写入空选择 | 没有 vCard 分组映射；CATEGORIES 不写分组 |
| 标签 | AV mSelect | 去重集合比较；清空为无选项 | CATEGORIES；逗号、分号和换行按 vCard 上下文转义 |
| 相关人 | 同库 AV relation，值是对方 itemID | 双向人物关联；锁内重读、写后核实，文档双链是可补偿投影 | 不通过 vCard 推断或导入关系类型 |
| 单位/学校/组织归属 | org-membership.json + 组织文档标记；可选 affiliationKind | 人物和组织两侧编辑分类、部门、职位、日期与状态；旧库未分类，离职/重入保留历史，清分类不删任职；过期表单零覆盖 | 迁移包保留成员 ID、分类、所有历史与删除标记；双方原文及归档属性随思源工作区备份，恢复不自动写段落；vCard ORG 不推断归属，全页筛选/投影待 B12-002 |
| 与我的关系 | person-relationship-labels.json 预留契约，按 selfDocId + personDocId | 域层严格解析与本人参照投影已实现，生产键尚未启用；本人更换不搬移旧称谓 | 尚不能编辑、导入或声称备份；不从 related、组织背景、分组或别名推断称谓 |
| 别名 | person-aliases.json，按稳定 personDocId | 独立管理；泛称禁用，同名歧义需选择具体人物 | 不作为姓名替代，不以王总等泛称自动归属 |
| 金钱/物品/人情往来 | exchange-records.json，按稳定 personDocId | 独立账本；请求身份稳定，未知结果先核实 | 包含在迁移包；不混入人物 AV 资料或互动次数 |

ORG、ADR、PHOTO、NOTE 等未映射属性在 vCard 预览明确列为已忽略，非法生日列为需人工核对。未知 AV 列不被自动使用；缺列或类型不匹配阻断写入，设置页提供核对入口。展示读取失败呈现失败/未知与重试，首次没有自管文件才是合法空库。

主要证据：tests/person.test.ts、tests/contact-write.test.ts、tests/vcard.test.ts、tests/text-encoding.test.ts，以及主 UI 回归中的字段实际服务、导入诊断、资料体检、名称零写入和档案条用例。完整读写仍需 AG-HOST-006 验收。

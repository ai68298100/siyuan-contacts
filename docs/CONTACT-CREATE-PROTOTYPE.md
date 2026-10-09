# 新建联系人页面原型

## 设计目标

新建联系人只要求填写姓名，其他信息按常用程度分层展示。用户可以先建立最小联系人档案，再回到详情页继续补充，避免为了录入一个人被迫填写一整张表。

## 当前页面结构

```text
新建联系人
├─ 粘贴并识别
├─ 基础资料（默认展开）
│  ├─ 姓名（必填）
│  ├─ 电话、微信、邮箱、网站
│  ├─ 生日、公历/农历
│  ├─ 分组、标签
│  └─ 创建联系人
└─ 补充资料（可选，可折叠）
   ├─ 组织、归属分类、部门、职位/身份、加入日期
   ├─ 别名 / 常用称呼
   ├─ 与我的关系称谓
   └─ 人物备注
```

补充资料区只在工作台提供扩展保存能力时显示。组织列表为空时，表单直接提供“新建组织”和“重新读取”入口；组织创建完成后可以回到表单选择新组织。关系称谓只有在设置中已经指定“我”的档案时才会写入，未填写关系称谓不受影响。别名保存前会回读现有别名，重试不会重复添加已经成功的称呼。

## 字段策略

姓名是唯一必填项。电话、邮箱、组织、关系称谓、生日、标签和备注都可以留空；同名候选仍然必须由用户选择复用文档或创建独立人物。扩展资料保存失败时保留已经创建的联系人，用户可以重试补充资料，不会重复创建联系人。

## 后续可扩展字段

以下字段适合继续放在折叠区，并沿用“填写即保存、留空不产生记录”的原则：多个电话和邮箱、地址、首次跟进日期、纪念日、自定义字段、公司/个人模式。需要先扩展联系人数据模型和冲突校验，再加入页面，避免出现只显示却无法可靠保存的字段。

## 调研依据

- HubSpot 支持配置手动新建记录时的字段和条件要求：<https://knowledge.hubspot.com/object-settings/set-up-fields-seen-when-manually-creating-records>
- Notion 以属性和关联字段组织可选信息：<https://www.notion.com/help/database-properties>
- Airtable 表单支持设置必填字段，并通过按钮创建记录：<https://support.airtable.com/articles/8588280258-getting-started-with-airtable-form-views>
- Google Contacts 支持组织、职位、部门、生日、关系、标签和备注等资料：<https://support.google.com/contacts/answer/1069522>
- Apple Contacts 将常用字段放在联系人卡片中，空字段保持隐藏：<https://support.apple.com/guide/contacts/add-people-and-companies-adrbk1080/mac>
- Monica CRM 将备注、活动、提醒和关系作为联系人后续管理内容：<https://monicacrm.com/docs>

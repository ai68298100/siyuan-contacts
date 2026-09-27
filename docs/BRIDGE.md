# 人员服务桥协议（LvContacts Bridge）

v1 · 面向思源插件开发者：让你的插件具备"选人/建人/记交集"能力（例如任务表单里加"参与人员"）。

## 挂载

小驴人脉（siyuan-contacts）启用并完成初始化后，暴露全局对象：

```js
window.LvContacts // LvContactsBridgeApi
```

- `protocol: 1` — 协议版本，破坏性变更才会升版
- `capabilities: ["searchPeople", "getPerson", "ensurePerson", "recordInteraction"]`

调用前建议检查 `window.LvContacts?.protocol >= 1` 与所需 capability（能力缺失时优雅降级）。

## 方法

### `searchPeople(keyword = "") → Promise<BridgePerson[]>`

按关键词过滤名册（匹配姓名/电话/微信/邮箱/标签）。用于任务表单的人员选择器。

```ts
interface BridgePerson {
  docId: string;   // 人物文档 ID（可 openTab 打开）
  itemId: string;  // 数据库行 ID
  name: string;
  group: string;
  tags: string[];
}
```

### `getPerson(docId) → Promise<BridgePerson | null>`

按文档 ID 取单个联系人；不存在返回 `null`。

### `ensurePerson(name) → Promise<BridgePerson & { created: boolean }>`

按名查人；不存在则**创建**人物文档并绑定人脉数据库（`created: true`）。
适合"任务里填了个新人名"场景——一次调用完成收编。

### `recordInteraction(personDocIds, meta?) → Promise<{ recorded: number }>`

给一批人记录**共同交集**（一场会议、一次聚会 = 一条同场事实）：

```ts
interface BridgeInteractionMeta {
  ref?: string;   // 场合幂等键；缺省 = bridge:<日期>:<排序后人员>，重复调用不重复记录
  date?: string;  // YYYY-MM-DD，缺省今天
  place?: string; // 地点，写入事件备注（@地点）
  note?: string;  // 备注
}
```

每位参与者的人脉文档会得到一条互动事件（source=api）；"久未联系"等统计随之更新。

`recorded` 仅表示本次实际新增且完成写后回读验证的事件条数。人员 ID 会先去重；
重复调用相同人物与场合返回 `0`。并发调用的计数在存储排他锁内确定，不把已有事件计为新增。

## 约定与边界

- 所有方法返回 Promise；参数非法/未初始化时 reject `Error`（message 为中文，可直接展示）。
- 人脉数据永不离开工作区；调用方无需（也不应）传递任何网络凭证。
- 小驴人脉不会读取、监听其他插件的私有存储——集成是对等的公开 API 调用。

## 接入示例（任务插件视角）

```js
const lv = window.LvContacts;
if (!lv || lv.protocol < 1) return; // 未安装或过旧，优雅降级
const attendees = [];
for (const name of taskForm.people) {
  attendees.push(await lv.ensurePerson(name)); // 已有则复用，没有则建
}
await lv.recordInteraction(attendees.map((p) => p.docId), {
  date: taskForm.dueDate,
  place: taskForm.meetingRoom,
  note: `任务「${taskForm.title}」完成`,
});
```

集成意向请联系：`ai68298100`（GitHub）。

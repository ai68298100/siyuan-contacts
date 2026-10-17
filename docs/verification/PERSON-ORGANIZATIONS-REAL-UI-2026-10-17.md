# 联系人多组织与真新建组织：隔离真实前端验收

2026-10-17，最终构建在独立 UUID 临时工作区、随机端口的 SiYuan Kernel `3.8.8-alpha.3` 与 Chrome `browser-desktop` 中通过。未接入日常工作区。证据：`PERSON-ORGANIZATIONS-REAL-UI-56791eec-8c39-4500-a236-5c59fc07827b.json`。

## 已验证

- 实际生产 PersonEditDialog 中一次勾选两个组织，各自设置工作/教育、当前/已离开、部门、职位、开始与结束日期、自定义状态及成员备注。
- 已有候选时打开真实组织名称资料表单；取消并放弃新建后，人物两段未保存草稿逐字段完全保持。
- 实际输入新的组织名称并创建；返回真实 docId 后自动选择第三个组织，前两段草稿保持原值。
- 保存三段经历后，生产服务、宿主 `org-membership.json`、`organization-profiles.json` 和内核 SQL 回读相符，无重复经历。
- 关闭人物编辑后重开，以及以 nonce 确认的新 document 重载后，三段事实继续保持。
- 关键点击经 Chrome Input.dispatchMouseEvent 发出，并检查 `isTrusted` 与命中目标；390px 与1365px 截图经目检。
- 96 次有所有权核验的 Node 端内核请求；隔离内核、Chrome 已退出，随机端口已释放，Chrome profile 已删除。工作区保留用于复核。

## 构建一致性

| 文件 | SHA-256 |
| --- | --- |
| `package.zip` | `fe3d3d822f83e077aaaa9295dc00b2cb640c3732cf8430c9a215dd391a3a73aa` |
| `dist/index.js` | `fbef49f6e456b3d05f7173a35bb625c585f6a9e3bfe56781c849b66901fe2b8a` |
| `dist/index.css` | `b7efd9ae76f2061f921ff129a4f1c99f5186a0b295ec5bbae1a1e0e0c3769f76` |

## 截图

稳定副本位于 `docs/verification/person-organizations-2026-10-17/`：`person-organizations-{desktop|390px}-{multi-picker|multi-drafts|create-name|reopened}.png` 以及 `person-organizations-desktop-saved-memberships.png`。目检多选搜索、候选、勾选状态、新建与完成按钮在390px均完整显示；组织草稿单列排列，名称表单可填写，重开时三段归属独立显示。

## 边界与重跑

此次是浏览器桌面宿主，390px为响应式视窗证据，不等同于移动设备或 Electron 宿主验收。未在真实内核中注入组织资料写后回读丢失；`profileSaved=false` 已完成源码保护与独立只读审查，不计入本轮实际失败恢复证据。独立原生“识别资料”弹窗入口未由本场景操作。

运行方式（先构建；脚本自行创建独立内核与 Chrome）：

```powershell
$env:LVCT_PERSON_ORGANIZATIONS_REAL_UI = '1'
node scripts/e2e/person-fields-frontend-flow.mjs
```

此前失败记录均保留：`6805…` 为取消后候选尚未刷新；`953f…`、`7a1a…`、`10b9…` 为390px resize后仍处于弹层入场动画；`39d3…` 为自动选中后创建回调尚未完成。脚本随后增加明确的解忙/动画完成等待。`8649…` 为较早构建的完整成功证据，最终以 `5679…` 与上述哈希为准。

/** PAGE-01.0 第三项：给原型各屏加实现状态标识条（一次性脚本，跑完可删）。 */
import fs from "node:fs";

const file = "docs/ui-prototype.html";
let html = fs.readFileSync(file, "utf8");

/** 每屏：id → 状态文本 */
const statuses = {
    "s-overview": "📋 设计总览页（本页为设计说明，非实现画面）",
    "s-home": "✅ 已实现（v0.3.0：统计/行动分组折叠/行内处置/查看全部）· 待优化：UX-01.5 视觉细节",
    "s-people": "✅ 已实现（v0.3.0：卡片/表格/选人器/完整度筛选/串行补录/粘贴识别）· 待优化：UX-01.4 视觉细节",
    "s-detail": "✅ 已实现（v0.3.0：Peek/跟进/模板/AI 结构化候选）· 待优化：UX-01.6 视觉细节",
    "s-graph": "✅ 已实现（v0.3.0：过滤/路径/共同联系人/选人器/导出）· 待优化：UX-01.7 移动端细节",
    "s-capture": "✅ 已实现（v0.3.0：三步捕获/AI 结构化候选/粘贴识别入口）· 真机核对：Host pending",
    "s-wizard": "✅ 已实现（v0.2.1 起幂等续建 + v0.3.0 候选扫描）· 真机核对：Host pending",
    "s-settings": "✅ 已实现（v0.3.0：体检十类/迁移包/锚点扫描/提醒暂缓恢复）",
    "s-docbar": "✅ 已实现（v0.3.0：档案条重做）· 余项：外部变化主动刷新",
};

let inserted = 0;
for (const [id, status] of Object.entries(statuses)) {
    const sectionAnchor = `id="${id}"`;
    const sectionPos = html.indexOf(sectionAnchor);
    if (sectionPos < 0) {
        console.error(`screen 未找到：${id}`);
        process.exit(1);
    }
    const noteBoxPos = html.indexOf('<div class="note-box">', sectionPos);
    if (noteBoxPos < 0) {
        console.error(`note-box 未找到：${id}`);
        process.exit(1);
    }
    const insertPos = html.indexOf("\n", noteBoxPos) + 1;
    const strip = `      <div class="proto-status">${status}</div>\n`;
    html = html.slice(0, insertPos) + strip + html.slice(insertPos);
    inserted += 1;
}

/* 规范页（s-color/s-type/s-comp）标注为组件规范 */
for (const id of ["s-color", "s-type", "s-comp"]) {
    const anchor = `id="${id}"`;
    const pos = html.indexOf(anchor);
    if (pos < 0) continue;
    const nextLine = html.indexOf("\n", pos) + 1;
    const strip = `      <div class="proto-status">🎨 组件规范页（设计规格参照，非独立实现画面）</div>\n`;
    html = html.slice(0, nextLine) + strip + html.slice(nextLine);
    inserted += 1;
}

/* 状态条样式：用原型自身令牌，置于 note-box 之上 */
const styleAnchor = "</style>";
const stylePos = html.indexOf(styleAnchor);
const css = `  /* PAGE-01.0：实现状态标识条 */
  .proto-status {
    display: block;
    margin: 0 0 10px;
    padding: 6px 12px;
    border-radius: 8px;
    background: var(--bg-surface);
    border: 1px solid var(--border-subtle);
    color: var(--text-2);
    font-size: 12px;
  }
`;
html = html.slice(0, stylePos) + css + html.slice(stylePos);

fs.writeFileSync(file, html, "utf8");
console.log("inserted:", inserted);

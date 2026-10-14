/**
 * 为版本化 UI 原型的每个产品屏插入实现状态标识条。
 * 当前原型以 section[data-screen] 作为页面锚点。
 *
 *   node scripts/proto-status.mjs          写入或更新状态条
 *   node scripts/proto-status.mjs --check  只读检查页面锚点，不修改文件
 */
import fs from "node:fs";

if (process.argv.includes("--help")) {
    console.log("Usage: node scripts/proto-status.mjs [--check | --help]");
    console.log("  no option: insert or update prototype page status bars");
    console.log("  --check: validate page anchors and prototype contracts without writing");
    console.log("  --help: show this help without reading or writing the prototype");
    process.exit(0);
}

const file = "docs/ui-prototype.html";
const checkOnly = process.argv.includes("--check");
const statusMarker = "data-proto-status";
const styleMarker = "/* PAGE-01.0：实现状态标识条 */";

/** 每个当前产品屏的状态文案。规范页只标识为设计参考，不冒充运行时页面。 */
const statuses = {
    home: "原型覆盖：首页统计、今日行动、提醒处置和工作空间状态；演示数据，不表示该页所有状态已验收",
    people: "原型覆盖：联系人卡片/表格、搜索视图、筛选、批量选择和资料补录入口；演示数据",
    person: "原型覆盖：人物详情窗口、概览/互动/相关人、跟进、来源和别名删除确认；演示数据",
    organizations: "原型覆盖：组织名册、组织资料、历史关系和新建入口；演示数据",
    orgmgr: "原型覆盖：组织成员管理、改名归档、添加和历史关系；移动状态为示意",
    graph: "原型覆盖：大画布、文档引用数据、同源文本、折叠筛选与关系查询；演示数据，真实宿主接入单独验收",
    capture: "原型覆盖：笔记候选、AI 外发预检和确认写入流程；宿主入口单独验收",
    import: "原型覆盖：思源文档、vCard、粘贴补录映射、冲突和结果预览",
    settings: "原型覆盖：通用、数据、提醒、AI 隐私、服务桥和关于设置分区",
    onboarding: "原型覆盖：首次使用、初始化检查和创建/导入入口；宿主初始化能力单独验收",
    docbar: "原型覆盖：人物档案条与工作台详情入口；宿主文档入口单独验收",
    system: "🎨 组件规范页：设计令牌、状态语义和交互规则参考，不是独立业务页面",
};

function sectionPattern(screen) {
    return new RegExp(`<section\\b(?=[^>]*\\bdata-screen=["']${screen}["'])[^>]*>`, "i");
}

function findScreens(html) {
    const missing = [];
    const sections = new Map();
    for (const screen of Object.keys(statuses)) {
        const match = sectionPattern(screen).exec(html);
        if (!match) missing.push(screen);
        else sections.set(screen, match);
    }
    return { missing, sections };
}

function validate(html) {
    const { missing, sections } = findScreens(html);
    if (missing.length) throw new Error(`screen 未找到：${missing.join(", ")}`);
    return sections;
}

const prototypeContracts = [
    ["状态说明样例（9 种）", /data-state-preview="(?:ready|loading|empty|partial|saving|error|unavailable|unsaved|updated)"/],
    ["联系人页级加载/错误/空态/部分失败", /data-people-state="loading"[\s\S]*?data-people-state="error"[\s\S]*?data-people-state="empty"[\s\S]*?data-people-state="partial"/],
    ["联系人搜索按卡片文字匹配演示数据", /const matches = peopleCards\.filter\(\(card\) => card\.textContent\.toLocaleLowerCase\(\)\.includes\(query\)\)/],
    ["联系人卡片和表格行按稳定 ID 同步过滤", /const matchingIds = new Set\(matches\.map\(\(card\) => card\.dataset\.personId\)\)[\s\S]*?peopleRows\.forEach\(\(row\) => \{[\s\S]*?row\.hidden = query\.length > 0 && !matchingIds\.has\(row\.dataset\.personId\)/],
    ["联系人搜索字段关联可见名称标签", /<label class="lvct-visually-hidden" for="lvct-people-search">搜索联系人<\/label>/],
    ["联系人搜索控件关联结果区和辅助说明", /role="search" aria-label="联系人名册"[\s\S]*?aria-controls="lvct-people-results" aria-describedby="lvct-people-search-description"/],
    ["清除联系人搜索控件位于标签之外", /<div class="lvct-search"[^>]*>[\s\S]*?<label class="lvct-visually-hidden" for="lvct-people-search">搜索联系人<\/label>[\s\S]*?<input id="lvct-people-search"[\s\S]*?<button class="lvct-search-clear"[^>]*data-action="clear-people-search"/],
    ["联系人库空态提供新建与导入入口", /data-people-state="empty"[\s\S]*?还没有联系人[\s\S]*?data-open-modal="person"[\s\S]*?data-open-modal="import"/],
    ["搜索无结果态提供清除与新建入口", /data-people-state="no-results"[\s\S]*?没有匹配的联系人[\s\S]*?data-action="clear-people-search"[\s\S]*?data-open-modal="person"/],
    ["搜索状态与页面数据状态独立", /root\.dataset\.searchState = query && matches\.length === 0 \? "no-results" : "ready"/],
    ["移动窄屏搜索控件触控尺寸不低于 44px", /@media \(max-width: 700px\)[\s\S]*?\.lvct-demo-label \{ display: none; \}[\s\S]*?\.lvct-search input \{ min-height: 44px; \}[\s\S]*?\.lvct-search-clear \{ top: 0; right: 0; width: 44px; min-height: 44px/],
    ["移动设备预览保留相同搜索触控尺寸", /\.lvct-proto-root\[data-viewport="mobile"\] \.lvct-search input \{ min-height: 44px; \}[\s\S]*?\.lvct-proto-root\[data-viewport="mobile"\] \.lvct-search-clear \{ top: 0; right: 0; width: 44px; min-height: 44px/],
    ["搜索快捷键限制在联系人页、弹窗外并避开组合输入", /event\.key === "\/" && activeScreen === "people" && !modal\.classList\.contains\("is-open"\)[\s\S]*?!event\.altKey && !event\.isComposing/],
    ["浅色与暗色主题令牌", /\.lvct-proto-root\[data-theme="light"\][\s\S]*?\.lvct-proto-root\[data-theme="dark"\]/],
    ["主题切换入口", /data-action="toggle-theme"/],
    ["桌面与移动预览入口", /data-viewport="mobile"[\s\S]*?data-viewport="desktop"|data-viewport="desktop"[\s\S]*?data-viewport="mobile"/],
    ["人物别名删除确认触发器", /data-action="alias-delete-request"/],
    ["人物别名删除确认文案与后果", /data-alias-delete-copy[\s\S]{0,240}不可撤销/],
    ["人物别名删除确认动作", /data-action=['"]alias-delete-confirm['"]/],
    ["人物别名删除的可观察演示结果", /已删除别名[\s\S]{0,160}原型演示，未写入真实数据/],
    ["组织名册搜索实时筛选并同步空态与结果数量", /function renderOrganizationCards\(\)[\s\S]*?organizationEmpty\.hidden = visible !== 0[\s\S]*?event\.target === organizationSearch/],
    ["组织名册状态筛选与清除筛选可操作", /organizationStatus[\s\S]*?clearOrganizations[\s\S]*?organizationStatus\.value/],
    ["组织筛选弹窗应用到组织名册控件", /data-action="apply-org-filter"[\s\S]*?if \(action === "apply-org-filter"\)[\s\S]*?renderOrganizationCards\(\)[\s\S]*?closeModal\(\)/],
    ["组织成员搜索和状态筛选即时更新名册", /data-org-member-search[\s\S]*?syncOrganizationManagerFilters\(\)[\s\S]*?data-org-member-status/],
    ["首页新用户空态开关隐藏常规内容并提供返回", /homeReadySections[\s\S]*?homeEmptyToggle[\s\S]*?homeEmptyToggle\.textContent/],
    ["头像文字、图片预览、格式限制与恢复默认有反馈", /brandAvatarText[\s\S]*?updateBrandAvatarImage[\s\S]*?5 \* 1024 \* 1024[\s\S]*?avatarReset[\s\S]*?updateBrandAvatarText\("驴"\)/],
    ["工作台头像说明、控件和状态反馈分区排布并在窄屏单列", /class="lvct-setting-item lvct-setting-item--brand-avatar"[\s\S]*?class="lvct-inline lvct-brand-avatar-controls"[\s\S]*?id="lvct-brand-avatar-feedback"/],
    ["工作台头像行桌面双列、真实窄屏及移动预览单列", /\.lvct-setting-item--brand-avatar \{ display: grid; grid-template-columns: minmax\(190px, \.8fr\) minmax\(0, 1\.2fr\);[\s\S]*?\.lvct-setting-item--brand-avatar \{ grid-template-columns: minmax\(0, 1fr\)/],
    ["390px 移动预览将头像行改为单列", /\.lvct-proto-root\[data-viewport="mobile"\] \.lvct-setting-item--brand-avatar \{ grid-template-columns: minmax\(0, 1fr\)/],
    ["人物详情按联系人入口定位并同步上一位下一位", /personDocAliases[\s\S]*?function setCurrentPerson[\s\S]*?function selectPersonFromTrigger[\s\S]*?person-next/],
    ["人物详情遮罩提供可访问关闭动作", /<button class="lvct-person-backdrop" type="button" aria-label="关闭人物详情"[\s\S]*?personBackdrop\.addEventListener\("click", \(\) => showScreen\(previousScreen \|\| "people", null, true\)\)/],
    ["人物详情右侧操作区提供高辨识度关闭入口", /<div class="lvct-page-actions lvct-person-window-actions">[\s\S]*?class="lvct-button lvct-person-close"[^>]*data-action="back-from-person" aria-label="关闭人物详情" title="关闭人物详情"[\s\S]*?关闭详情/],
    ["人物详情关闭入口有静态样式并在移动预览单独占行", /\.lvct-person-window-actions \{ display: flex;[\s\S]*?\.lvct-person-window-actions \.lvct-person-close \{ min-height: 36px;[\s\S]*?\.lvct-person-window-actions \.lvct-person-close:hover[\s\S]*?\.lvct-proto-root\[data-viewport="mobile"\] \.lvct-person-window-actions \.lvct-person-close \{ flex: 0 0 100%/],
    ["390px 移动预览的人物详情标题栏不横向溢出并保留安全区", /\.lvct-proto-root\[data-viewport="mobile"\] \.lvct-person-window-head \{ margin: calc\(-1 \* max\(18px, env\(safe-area-inset-top\)\)\) -14px 18px; padding: max\(12px, env\(safe-area-inset-top\)\) 14px 10px/],
    ["移动预览隐藏仅供桌面原型使用的演示标签", /\.lvct-proto-root\[data-viewport="mobile"\] \.lvct-demo-label \{ display: none; \}/],
    ["长版本说明默认折叠且移动预览改用简短演示提示", /\.lvct-proto-root\[data-viewport="mobile"\] \.lvct-version-note \{ display: none; \}[\s\S]*?<details class="lvct-callout lvct-small lvct-version-note"[\s\S]*?<summary>原型说明与版本对照[\s\S]*?class="lvct-mobile-demo-note"/],
    ["组织原型添加部门和字段会创建可编辑草稿并更新状态反馈", /key === "organization"[\s\S]*?organization-add-department[\s\S]*?organization-add-field[\s\S]*?data-organization-departments[\s\S]*?data-organization-fields[\s\S]*?action === "organization-add-department"[\s\S]*?list\.append\(row\)[\s\S]*?本表单不会写入真实数据/],
    ["组织新增草稿行使用双列桌面布局并在移动预览窗体中收为单列", /\.lvct-organization-draft-row \{ display: grid; grid-template-columns:[\s\S]*?\.lvct-proto-modal\[data-viewport="mobile"\] \.lvct-organization-draft-row \{ grid-template-columns: minmax\(0, 1fr\); \}/],
    ["移动预览的人物详情两列内容堆叠为单列并允许收缩", /\.lvct-proto-root\[data-viewport="mobile"\] \.lvct-grid--two \{ grid-template-columns: minmax\(0, 1fr\); \}[\s\S]*?\.lvct-proto-root\[data-viewport="mobile"\] \.lvct-grid--two > \* \{ min-width: 0; \}/],
    ["对话框语义", /role="dialog" aria-modal="true"/],
    ["移动布局响应式规则", /@media \(max-width: 700px\)[\s\S]*?\.lvct-sidebar \{ display: none/],
    ["图谱桌面画布占据主要阅读区域", /\.lvct-graph-stage \{[\s\S]*?height: clamp\(520px, 68dvh, 880px\); min-height: 520px/],
    ["图谱移动画布保留至少 400px", /@media \(max-width: 700px\)[\s\S]*?\.lvct-graph-stage \{ height: clamp\(400px, 58dvh, 640px\); min-height: 400px/],
    ["窄屏图谱工具簇位于画布右上安全区并避开固定底导航", /@media \(max-width: 700px\)[\s\S]*?\.lvct-graph-navigation \{ top: calc\(12px \+ env\(safe-area-inset-top\)\); right: 12px; bottom: auto; \}/],
    ["移动设备预览与真实断点使用相同图谱高度", /\.lvct-proto-root\[data-viewport="mobile"\] \.lvct-graph-stage \{ height: clamp\(400px, 58dvh, 640px\); min-height: 400px/],
    ["桌面宽视口移动设备预览的图谱工具簇位于安全区顶部", /\.lvct-proto-root\[data-viewport="mobile"\] \.lvct-graph-navigation \{ top: calc\(12px \+ env\(safe-area-inset-top\)\); right: 12px; bottom: auto; \}/],
    ["桌面图谱工具簇固定在画布右下 12px 安全边距", /\.lvct-graph-navigation \{ position: absolute; right: 12px; bottom: 12px;/],
    ["320px 窄屏顶栏控件收缩以避免整页横向溢出", /@media \(max-width: 350px\)[\s\S]*?\.lvct-proto-bar \{ gap: 8px; padding-inline: 10px; \}[\s\S]*?\.lvct-proto-tools select \{ max-width: 76px; min-width: 0/],
    ["320px 窄屏图谱工具簇自动换行并限制在画布内", /@media \(max-width: 350px\)[\s\S]*?\.lvct-graph-navigation \{ width: min\(184px, calc\(100% - 24px\)\); flex-wrap: wrap; justify-content: flex-end; \}/],
    ["320px 窄画布重排节点，避开两行工具簇且同步移动连线", /const compactCanvas = graphStage\.clientWidth <= 350;[\s\S]*?y: 36 \+ \(node\.y - 24\) \* 0\.64/],
    ["设备预览切换和视口变化时重算窄屏图谱位置", /if \(activeScreen === "graph"\) renderGraph\(\);[\s\S]*?window\.addEventListener\("resize", \(\) => \{ syncScreenVisibility\(\); syncPersonDialog\(\); if \(activeScreen === "graph"\) renderGraph\(\); \}\)/],
    ["首次进入关系图谱后按真实画布宽度生成节点位置", /function showScreen\(id, trigger, restoreContext = false\)[\s\S]*?syncScreenVisibility\(\);\s*if \(id === "graph"\) renderGraph\(\);/],
    ["图谱筛选默认折叠", /<details class="lvct-graph-refinement" id="lvct-graph-filters">\s*<summary>范围、分组与图例<\/summary>/],
    ["关系探索位于大画布之后并默认折叠", /id="lvct-graph-canvas"[\s\S]*?<details class="lvct-graph-refinement" id="lvct-graph-query" data-graph-relations-control style="margin-top:12px">/],
    ["图谱阅读方式按钮有选中语义与目标", /aria-pressed="true" data-graph-presentation="canvas" aria-controls="lvct-graph-canvas"[\s\S]*?aria-pressed="false" data-graph-presentation="text" aria-controls="lvct-graph-list"/],
    ["图谱文本与画布真正互换，不追加到图下", /graphCanvas\.hidden = value !== "canvas" \|\| empty;\s*graphList\.hidden = value !== "text" \|\| empty/],
    ["图谱搜索与筛选作用于同一展示快照", /nodes = nodes\.filter\(\(node\) => node\.id === centerId[\s\S]*?graphSnapshot = \{ nodes, edges, scope:/],
    ["图谱空结果具有模式对应说明、插图和恢复动作", /id="lvct-graph-empty" hidden[\s\S]*?id="lvct-graph-empty-title"[\s\S]*?data-action="graph-clear-filters"[\s\S]*?data-open-modal="person"[\s\S]*?emptyTitle\.textContent = native \? "当前引用范围没有匹配的文档" : "当前范围没有匹配的节点"[\s\S]*?当前文档引用范围没有匹配的登记文档/],
    ["图谱缩放实际改变画布并锁定边界", /graphStage\.querySelector\("\.lvct-graph-map"\)\.style\.transform = [\s\S]*?graph-zoom-out'[\s\S]*?disabled = graphZoom <= \.5;[\s\S]*?graph-zoom-in'[\s\S]*?disabled = graphZoom >= 2/],
    ["人物关系查询排除组织成员边和引用边", /const relationEdges = graphSnapshot\.edges\.filter\(\(edge\) => edge\.kind === "related"\)/],
    ["原型文档引用限定在登记人物与组织文档且明确绘制方式", /仅展示本人、已登记联系人和组织文档[\s\S]*?这里不会打开思源原生图面板[\s\S]*?kind: "ref", label: "文档引用连接 · 陈予安 — 青禾科技（组织文档，无向投影）"/],
    ["图谱导出包含当前实际展示节点与来源边", /function exportGraphSnapshot\(\)[\s\S]*?graphSnapshot\.nodes\.map[\s\S]*?graphSnapshot\.edges\.map[\s\S]*?new Blob\(\[lines\.join\("\\n"\)/],
    ["图谱展开大图有选中语义和真实尺寸变更", /data-action="graph-expand" aria-label="展开大图" title="展开大图" aria-pressed="false"[\s\S]*?graphCanvas\.classList\.toggle\("lvct-graph-canvas-wrap--expanded", graphExpanded\)/],
    ["图谱重新布局真正改变节点坐标", /const x = graphAlternateLayout \? 100 - node\.x : node\.x[\s\S]*?graph-relayout"\) \{ graphAlternateLayout = !graphAlternateLayout/],
    ["图谱各节点来源入口按当前节点展示来源打开反馈", /data-action="graph-open-source" data-node-id="\$\{node\.id\}"[\s\S]*?modalViews\["graph-source"\] = \[node\.label \+ " · 来源打开请求"[\s\S]*?不会尝试打开虚构文档/],
    ["图谱来源说明指向思源文档菜单原生图与反链", /先“打开来源文档”，再从思源文档菜单进入[\s\S]*?可从思源文档菜单进入原生关系图或反向链接/],
    ["图谱组织入口定位当前组织而非跳转列表", /data-action="graph-open-organization" data-node-id="\$\{node\.id\}"[\s\S]*?modalViews\["graph-organization"\] = \[node\.label \+ " · 组织管理（演示）"[\s\S]*?不跳往其他组织或组织列表/],
    ["图谱来源打开加载态全入口锁定并有可见反馈", /function syncGraphSourceButtons\(\)[\s\S]*?button\.disabled = Boolean\(graphSourceOpeningId\)[\s\S]*?"正在请求打开…"[\s\S]*?async function demonstrateGraphSource[\s\S]*?if \(graphSourceOpeningId\) return/],
    ["图谱来源失败演示提供明确反馈与可重试入口", /root\.dataset\.demoState === "error" && !retry[\s\S]*?来源打开请求失败（演示）[\s\S]*?data-action="graph-source-retry"[\s\S]*?不启动真实思源宿主/],
    ["图谱来源演示成功明确仅代表已发起请求，不宣称宿主完成切换", /打开请求已发起（演示）[\s\S]*?不代表思源宿主已完成页面切换[\s\S]*?请求反馈与宿主最终完成切换是两个不同状态/],
    ["图谱来源演示迟到结果不在离开页面或关闭重试后弹窗", /if \(activeScreen !== "graph"[\s\S]*?retryFeedback\?\.isConnected[\s\S]*?页面已切换，不再弹出旧结果/],
    ["图谱搜索命中与聚焦都使用双色主题语义强调色", /data-theme="light"\] \.lvct-graph-node\[data-search-match="true"\][\s\S]*?data-theme="dark"\] \.lvct-graph-node\[data-search-match="true"\][\s\S]*?outline: 3px solid var\(--lvct-accent\)/],
];

function statusMarkup(screen, text) {
    return `\n      <div class="proto-status" ${statusMarker}="${screen}" role="status">${text}</div>`;
}

function insertOrUpdateStatus(html, screen, sectionMatch) {
    const sectionEnd = sectionMatch.index + sectionMatch[0].length;
    const existing = new RegExp(`<div\\b[^>]*\\b${statusMarker}=["']${screen}["'][^>]*>.*?</div>`, "is").exec(html.slice(sectionEnd));
    if (existing) {
        const start = sectionEnd + existing.index;
        return html.slice(0, start) + statusMarkup(screen, statuses[screen]).trim() + html.slice(start + existing[0].length);
    }
    return html.slice(0, sectionEnd) + statusMarkup(screen, statuses[screen]) + html.slice(sectionEnd);
}

function ensureStyle(html) {
    if (html.includes(styleMarker)) return html;
    const stylePos = html.indexOf("</style>");
    if (stylePos < 0) throw new Error("未找到原型样式结束标签 </style>");
    const css = `  ${styleMarker}
  .proto-status {
    display: block;
    margin: 0 0 10px;
    padding: 6px 12px;
    border-radius: 8px;
    background: var(--lvct-surface, var(--lvct-bg-surface));
    border: 1px solid var(--lvct-border, var(--lvct-border-subtle));
    color: var(--lvct-text-2);
    font-size: 12px;
    line-height: 1.5;
  }
`;
    return html.slice(0, stylePos) + css + html.slice(stylePos);
}

let html = fs.readFileSync(file, "utf8");
const sections = validate(html);
if (checkOnly) {
    const bars = Object.keys(statuses).filter((screen) => html.includes(`${statusMarker}="${screen}"`)).length;
    if (bars !== Object.keys(statuses).length) {
        throw new Error(`状态条未找到：期望 ${Object.keys(statuses).length}，实际 ${bars}`);
    }
    const missingContracts = prototypeContracts.filter(([label, pattern]) => !pattern.test(html)).map(([label]) => label);
    if (missingContracts.length) throw new Error(`原型覆盖锚点缺失：${missingContracts.join("、")}`);
    const cardIds = [...html.matchAll(/<article class="lvct-person-card" data-person-id="([^"]+)"/g)].map((match) => match[1]);
    const rowIds = [...html.matchAll(/<tr data-person-id="([^"]+)"/g)].map((match) => match[1]);
    if (!cardIds.length || cardIds.length !== rowIds.length || cardIds.some((id, index) => id !== rowIds[index]) || new Set(cardIds).size !== cardIds.length) {
        throw new Error("联系人卡片与表格行的演示 ID 必须唯一且按顺序一一对应");
    }
    const previewStates = [...html.matchAll(/data-state-preview="([^"]+)"/g)].map((match) => match[1]);
    const uniqueStates = new Set(previewStates);
    if (uniqueStates.size !== 9) throw new Error(`状态说明样例应为 9 种，实际 ${uniqueStates.size} 种`);
    console.log(`validated screens: ${Object.keys(statuses).length}; status bars: ${bars}; prototype contract anchors: ${prototypeContracts.length}; demo contact IDs: ${cardIds.length}; generic state guidance: ${uniqueStates.size}; file: ${file}`);
    console.log("note: static anchors confirm that examples exist; they do not assert exhaustive page-state or host/device acceptance.");
    process.exit(0);
}

// 从后往前更新，避免插入内容改变尚未处理的匹配位置。
for (const screen of Object.keys(statuses).reverse()) html = insertOrUpdateStatus(html, screen, sections.get(screen));
html = ensureStyle(html);
fs.writeFileSync(file, html, "utf8");
console.log(`updated status bars: ${Object.keys(statuses).length}; file: ${file}`);

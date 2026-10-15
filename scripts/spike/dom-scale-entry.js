/*
 * 隔离真实性能采样页：直接挂载生产 PeopleView，内核请求由浏览器夹具拦截。
 * 运行脚本会通过 query 参数切换 200/1000/5000 条联系人，不写入产品数据。
 */
import { mount, tick } from "svelte";
import PeopleView from "../../src/components/people/PeopleView.svelte";
import { FIELD_SPECS } from "../../src/domain/fields";
import { kernel } from "../e2e/ui/siyuan-mock.js";
import "../../src/index.scss";

const size = Number(new URLSearchParams(location.search).get("size"));
const fixtureSize = Number.isSafeInteger(size) && size > 0 ? size : 200;
const virtualizationEnabled = new URLSearchParams(location.search).get("virtual") !== "0";
const extremeContent = new URLSearchParams(location.search).get("extreme") === "1";
const pageSize = 200;
const fieldMap = Object.fromEntries(FIELD_SPECS.map((field) => [field.key, field.key]));
const settings = {
    schemaVersion: 1,
    notebookName: "性能采样",
    notebookId: "20261005000000-book001",
    hostDocId: "20261005000000-host001",
    dbBlockId: "20261005000000-block01",
    avId: "20261005000000-view001",
    initializedAt: "2026-10-05T00:00:00Z",
    fieldMap,
};
const columns = FIELD_SPECS.map((field) => ({ id: field.key, name: field.nameZh, type: field.type }));

function stableId(index) {
    return `20261005000000-${index.toString(36).padStart(7, "0")}`;
}

function row(index) {
    const id = stableId(index);
    const tagCount = extremeContent ? (index % 5 === 0 ? 18 : index % 3 === 0 ? 7 : 2) : index % 17 === 0 ? 9 : index % 4 === 0 ? 0 : 1;
    const email = extremeContent
        ? `${"very-long-address-segment-".repeat(12)}${index}@example.test`
        : index % 31 === 0 ? `${"long-address-".repeat(8)}${index}@example.test` : `scale-${index}@example.test`;
    const name = extremeContent
        ? `${String(index).padStart(5, "0")} ${"超长联系人姓名示例".repeat(8)}`
        : `性能联系人 ${String(index).padStart(5, "0")}`;
    return {
        id: `row-${index}`,
        cells: [
            { valueType: "block", value: { type: "block", keyID: "name", block: { id, content: name } } },
            { valueType: "phone", value: { type: "phone", keyID: "phone", phone: { content: `138000${String(index).padStart(5, "0")}` } } },
            { valueType: "email", value: { type: "email", keyID: "email", email: { content: email } } },
            { valueType: "text", value: { type: "text", keyID: "wechat", text: { content: `scale_${index}` } } },
            { valueType: "select", value: { type: "select", keyID: "group", mSelect: [{ content: index % 2 ? "朋友" : "同事" }] } },
            { valueType: "mSelect", value: { type: "mSelect", keyID: "tags", mSelect: Array.from({ length: tagCount }, (_, tag) => ({ content: extremeContent ? `极长标签内容-${String(tag + 1).padStart(2, "0")}-${"边界文本".repeat(5)}` : tagCount === 9 ? `较长标签-${tag + 1}` : "性能采样" })) } },
        ],
    };
}

const rows = Array.from({ length: fixtureSize }, (_, index) => row(index));
kernel.handler = async (route, body) => {
    if (route === "/api/av/renderAttributeView") {
        const page = Number(body.page ?? 1);
        const requestedSize = Number(body.pageSize ?? pageSize);
        const start = Math.max(0, (page - 1) * requestedSize);
        const query = String(body.query ?? "").trim();
        const filtered = query ? rows.filter((entry) => entry.cells[0].value.block.content.includes(query)) : rows;
        return { view: { columns, rows: filtered.slice(start, start + requestedSize), rowCount: filtered.length } };
    }
    throw new Error(`性能采样不允许请求 ${route}`);
};

const target = document.querySelector("#fixture");
const firstPageAt = performance.now();
const layoutShifts = [];
const observer = new PerformanceObserver((list) => {
    for (const entry of list.getEntries()) if (!entry.hadRecentInput) layoutShifts.push(entry.value);
});
try { observer.observe({ type: "layout-shift", buffered: true }); } catch { /* Chromium 旧版本不支持 */ }
function drainLayoutShiftScore() {
    const buffered = layoutShifts.splice(0);
    const pending = observer.takeRecords().filter((entry) => !entry.hadRecentInput).map((entry) => entry.value);
    return [...buffered, ...pending].reduce((sum, value) => sum + value, 0);
}
let firstPageResolve;
const firstPage = new Promise((resolve) => { firstPageResolve = resolve; });
const app = mount(PeopleView, {
    target,
    props: {
        settings,
        preferences: { peopleView: "card", tableColumns: [], savedViews: [] },
        loadRecentInteractions: async () => ({}),
        revision: 1,
        initialSort: "name",
        onOpenDetail: () => {},
        onPreferencesChange: async (value) => value,
        onExternalSearchChange: () => {},
    },
});

function cardCount() {
    return target?.querySelectorAll(".lvct-people__cards > .lvct-person-card").length ?? 0;
}

function shownCount() {
    const text = target?.querySelector(".lvct-people__more")?.textContent ?? "";
    return Number(/已显示\s+(\d+)\s*\//.exec(text)?.[1] ?? fixtureSize);
}

async function waitFor(predicate, timeoutMs = 120000) {
    const deadline = performance.now() + timeoutMs;
    while (!predicate()) {
        if (performance.now() > deadline) throw new Error("性能采样页面等待超时");
        await new Promise((resolve) => setTimeout(resolve, 10));
    }
    await tick();
}

void (async () => {
    await waitFor(() => cardCount() > 0);
    firstPageResolve({ elapsedMs: performance.now() - firstPageAt, cards: cardCount() });
    await waitFor(() => target?.textContent?.includes(`已加载 ${fixtureSize} / ${fixtureSize} 人`) || fixtureSize <= pageSize);
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const initialLayoutShiftScore = drainLayoutShiftScore();
    const firstPageDomNodes = document.getElementsByTagName("*").length;
    const firstPageHeapBytes = performance.memory?.usedJSHeapSize ?? null;
    const expandStartedAt = performance.now();
    let expansionClicks = 0;
    /* 虚拟列表不会让 DOM 卡片数量等于数据总数；以“加载更多”已显示数量作为展开完成信号。 */
    while (shownCount() < fixtureSize) {
        const loadMore = [...target.querySelectorAll("button")].find((button) => button.classList.contains("lvct-people__more"));
        if (!loadMore) throw new Error(`已显示 ${shownCount()} / ${fixtureSize}，但未找到“加载更多”按钮`);
        const previousShown = shownCount();
        loadMore.click();
        expansionClicks += 1;
        await tick();
        await waitFor(() => shownCount() > previousShown);
    }
    const fullRenderMs = performance.now() - expandStartedAt;
    await tick();
    const expandedCardDomCount = cardCount();
    const expandedDomNodes = document.getElementsByTagName("*").length;
    const expandedHeapBytes = performance.memory?.usedJSHeapSize ?? null;
    const cardsViewport = target.querySelector(".lvct-people__cards");
    const viewportMetrics = cardsViewport ? { clientHeight: cardsViewport.clientHeight, scrollHeight: cardsViewport.scrollHeight, clientWidth: cardsViewport.clientWidth } : null;
    const cardWindowSamples = [];
    if (cardsViewport) {
        const maxScrollTop = Math.max(0, cardsViewport.scrollHeight - cardsViewport.clientHeight);
        const positions = [0, Math.floor(maxScrollTop / 2), maxScrollTop];
        for (const scrollTop of positions) {
            cardsViewport.scrollTop = scrollTop;
            cardsViewport.dispatchEvent(new Event("scroll", { bubbles: true }));
            await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
            await tick();
            const firstRenderedId = target.querySelector(".lvct-people__cards > .lvct-person-card")?.getAttribute("data-person-item-id") ?? "";
            cardWindowSamples.push({ requestedScrollTop: scrollTop, actualScrollTop: cardsViewport.scrollTop, firstRenderedIndex: Number(firstRenderedId.match(/row-(\d+)$/)?.[1] ?? -1), cardCount: cardCount(), domNodes: document.getElementsByTagName("*").length });
        }
        if (fixtureSize > 600 && virtualizationEnabled && extremeContent) {
            const middle = cardWindowSamples[1];
            const bottom = cardWindowSamples[2];
            const expectedMiddleIndex = Math.floor(fixtureSize / 2);
            if (Math.abs(middle.firstRenderedIndex - expectedMiddleIndex) > 32) {
                throw new Error(`卡片中段窗口定位偏差：${JSON.stringify(middle)}`);
            }
            if (bottom.firstRenderedIndex < fixtureSize - 32) {
                throw new Error(`卡片底部窗口定位偏差：${JSON.stringify(bottom)}`);
            }
        }
    }
    const cardScrollLayoutShiftScore = drainLayoutShiftScore();
    const bottomCardDomCount = cardCount();
    const bottomDomNodes = document.getElementsByTagName("*").length;
    const expandedHeapAtBottom = performance.memory?.usedJSHeapSize ?? null;
    const tableButton = [...target.querySelectorAll(".lvct-seg__item")].find((button) => button.textContent?.includes("表格"));
    const tableSwitchStartedAt = performance.now();
    tableButton?.click();
    await waitFor(() => Boolean(target.querySelector(".lvct-people__table-wrap")));
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    await tick();
    const tableSwitchMs = performance.now() - tableSwitchStartedAt;
    const tableRowCount = target.querySelectorAll("tbody tr[data-person-item-id]").length;
    const tableWindowSamples = [];
    const tableViewport = target.querySelector(".lvct-people__table-wrap");
    if (tableViewport) {
        tableViewport.scrollTop = 0;
        await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        const maxScrollTop = Math.max(0, tableViewport.scrollHeight - tableViewport.clientHeight);
        for (const scrollTop of [0, Math.floor(maxScrollTop / 2), maxScrollTop]) {
            tableViewport.scrollTop = scrollTop;
            tableViewport.dispatchEvent(new Event("scroll", { bubbles: true }));
            await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
            await tick();
            const firstRenderedId = target.querySelector("tbody tr[data-person-item-id]")?.getAttribute("data-person-item-id") ?? "";
            tableWindowSamples.push({ requestedScrollTop: scrollTop, actualScrollTop: tableViewport.scrollTop, firstRenderedIndex: Number(firstRenderedId.match(/row-(\d+)$/)?.[1] ?? -1), rowCount: target.querySelectorAll("tbody tr[data-person-item-id]").length, domNodes: document.getElementsByTagName("*").length });
        }
        if (fixtureSize > 600 && virtualizationEnabled) {
            const middle = tableWindowSamples[1];
            const bottom = tableWindowSamples[2];
            if (Math.abs(middle.actualScrollTop - middle.requestedScrollTop) > 2 * 48 || Math.abs(middle.firstRenderedIndex - Math.floor(fixtureSize / 2)) > 32) {
                throw new Error(`表格中段窗口定位偏差：${JSON.stringify(middle)}`);
            }
            if (Math.abs(bottom.actualScrollTop - bottom.requestedScrollTop) > 2 * 48 || bottom.firstRenderedIndex < fixtureSize - 32) {
                throw new Error(`表格底部窗口定位偏差：${JSON.stringify(bottom)}`);
            }
        }
    }
    const tableScrollLayoutShiftScore = drainLayoutShiftScore();
    const cardsSwitchStartedAt = performance.now();
    const cardsButton = [...target.querySelectorAll(".lvct-seg__item")].find((button) => button.textContent?.includes("卡片"));
    cardsButton?.click();
    await waitFor(() => Boolean(target.querySelector(".lvct-people__cards")));
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const cardsSwitchMs = performance.now() - cardsSwitchStartedAt;
    const cardsSwitchLayoutShiftScore = drainLayoutShiftScore();
    const navigation = performance.getEntriesByType("navigation")[0];
    const paints = performance.getEntriesByType("paint").map((entry) => ({ name: entry.name, startTime: entry.startTime }));
    await tick();
    const postInitialLayoutShiftScore = drainLayoutShiftScore();
    window.__domScaleEvidence = {
        fixtureSize,
        firstPageMs: (await firstPage).elapsedMs,
        loadedMs: performance.now() - firstPageAt,
        loadedPeople: fixtureSize,
        firstPageCardDomCount: (await firstPage).cards,
        firstPageDomNodes,
        firstPageHeapBytes,
        expansionClicks,
        fullRenderMs,
        expandedCardDomCount,
        expandedDomNodes,
        expandedHeapBytes,
        bottomCardDomCount,
        bottomDomNodes,
        expandedHeapAtBottom,
        tableRowCount,
        viewportMetrics,
        cardWindowSamples,
        tableWindowSamples,
        initialLayoutShiftScore,
        cardScrollLayoutShiftScore,
        tableScrollLayoutShiftScore,
        cardsSwitchLayoutShiftScore,
        syntheticInteractionLayoutShiftScore: cardScrollLayoutShiftScore + tableScrollLayoutShiftScore + cardsSwitchLayoutShiftScore + postInitialLayoutShiftScore,
        fullHeapBytes: expandedHeapBytes,
        tableSwitchMs,
        cardsSwitchMs,
        totalRecordedLayoutShiftScore: initialLayoutShiftScore + cardScrollLayoutShiftScore + tableScrollLayoutShiftScore + cardsSwitchLayoutShiftScore + postInitialLayoutShiftScore,
        paintEntries: paints,
        navigationTiming: navigation ? {
            startTime: navigation.startTime,
            domInteractive: navigation.domInteractive,
            domContentLoaded: navigation.domContentLoadedEventEnd,
            loadEventEnd: navigation.loadEventEnd,
        } : null,
    };
    observer.disconnect();
    window.__domScaleReady = true;
})().catch((error) => {
    window.__domScaleError = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
    observer.disconnect();
    window.__domScaleReady = true;
});

window.addEventListener("beforeunload", () => { void app; });

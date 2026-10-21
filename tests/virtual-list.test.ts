import assert from "node:assert/strict";
import test from "node:test";
import {
    buildVirtualRows,
    virtualRowAtOffset,
    virtualRowRange,
} from "../src/domain/virtual-list.ts";

/** 简单等高分页布局：每行 columns 个条目，估计行高 40，行间距 8；未实测一律走估计值 */
function rows(count: number, columns = 1) {
    return buildVirtualRows(
        Array.from({ length: count }, (_unused, index) => `item-${index}`),
        columns,
        (item) => item,
        () => undefined,
        40,
        8,
    );
}

test("virtual-list：空列表返回零高度与空区间，不抛错", () => {
    const layout = rows(0);
    assert.deepEqual(layout.rows, []);
    assert.deepEqual(layout.offsets, [0]);
    assert.equal(layout.totalHeight, 0);

    assert.deepEqual(virtualRowAtOffset(layout.offsets, 0), 0, "空表偏移定位应为 0");
    assert.deepEqual(virtualRowRange(layout.offsets, 0, 500, 2, 200), { start: 0, end: 0 });
});

test("virtual-list：单行列表边界（末尾不再加间距）", () => {
    const layout = rows(1);
    assert.equal(layout.rows.length, 1);
    assert.equal(layout.totalHeight, 40, "仅一行时总高就是行高，末尾不加 gap");
    assert.deepEqual(layout.offsets, [0, 40]);
    assert.equal(virtualRowAtOffset(layout.offsets, 0), 0);
    assert.equal(virtualRowAtOffset(layout.offsets, 39), 0);
    assert.equal(virtualRowAtOffset(layout.offsets, 40), 0, "越界偏移钳制到最后一行");
    assert.equal(virtualRowAtOffset(layout.offsets, 100000), 0);
});

test("virtual-list：多行偏移定位与总高度（末尾不加间距）", () => {
    const layout = rows(10);
    assert.equal(layout.rows.length, 10);
    // 10 行 × 40 + 9 个间距 × 8 = 400 + 72 = 472
    assert.equal(layout.totalHeight, 472, "10 行总高应为 472（行间 9 个 gap）");
    assert.deepEqual(layout.offsets, [0, 48, 96, 144, 192, 240, 288, 336, 384, 432, 472]);

    assert.equal(virtualRowAtOffset(layout.offsets, 0), 0);
    assert.equal(virtualRowAtOffset(layout.offsets, 47), 0, "第 1 行区间 [0,48)");
    assert.equal(virtualRowAtOffset(layout.offsets, 48), 1);
    assert.equal(virtualRowAtOffset(layout.offsets, 471), 9, "最后一行");
    assert.equal(virtualRowAtOffset(layout.offsets, 99999), 9, "远超总高时钳制到最后一行");
});

test("virtual-list：负偏移、NaN 与 Infinity 一律归一为 0（防御性钳制，不产生负索引）", () => {
    const layout = rows(5);
    assert.equal(virtualRowAtOffset(layout.offsets, -1), 0, "负偏移归 0");
    assert.equal(virtualRowAtOffset(layout.offsets, -9999), 0);
    assert.equal(virtualRowAtOffset(layout.offsets, Number.NaN), 0, "NaN 归 0");
    // 实现采用保守防御：Infinity 等非有限值一律归 0，绝不产生越界或负索引
    assert.equal(virtualRowAtOffset(layout.offsets, Number.POSITIVE_INFINITY), 0, "Infinity 归 0（保守钳制）");
    assert.equal(virtualRowAtOffset(layout.offsets, Number.NEGATIVE_INFINITY), 0);
    // 有限但超大的偏移仍正确定位到最后一行
    assert.equal(virtualRowAtOffset(layout.offsets, 99999), 4, "超大有限偏移定位到最后一行");
});

test("virtual-list：可视区间计算含 overscan 且两端钳制", () => {
    const layout = rows(100);
    // 顶部：scrollTop=0，视口 400（约 8.3 行），overscan=2
    const top = virtualRowRange(layout.offsets, 0, 400, 2, 200);
    assert.equal(top.start, 0, "顶部 start 不能为负（overscan 被钳制）");
    assert.ok(top.end > 8, "应覆盖视口行数并加 overscan");

    // 中部：scrollTop=480（第 10 行附近）
    const middle = virtualRowRange(layout.offsets, 480, 400, 2, 200);
    assert.equal(middle.start, 8, "中部 start = 定位行 - overscan");
    assert.ok(middle.end > middle.start, "end 必须大于 start");

    // 底部：scrollTop 远超总高 → end 钳制到总行数
    const bottom = virtualRowRange(layout.offsets, 1_000_000, 400, 2, 200);
    assert.equal(bottom.end, 100, "底部 end 应钳制到总行数 100");
    assert.ok(bottom.start <= 100);

    // 负 scrollTop：start 钳制为 0
    const negative = virtualRowRange(layout.offsets, -500, 400, 2, 200);
    assert.equal(negative.start, 0, "负滚动位置 start 应为 0");
});

test("virtual-list：overscan 与视口高度非法值时防御（负数/NaN 归 0）", () => {
    const layout = rows(50);
    // 负 overscan 归 0
    const negOverscan = virtualRowRange(layout.offsets, 480, 400, -5, 200);
    assert.equal(negOverscan.start, 10, "负 overscan 应归 0（480/48=10）");
    // NaN 视口高度：归 0，仅依赖最小视口高度
    const nanViewport = virtualRowRange(layout.offsets, 480, Number.NaN, 1, 200);
    assert.ok(Number.isFinite(nanViewport.start) && nanViewport.start >= 0, "NaN 视口不应产生 NaN");
    assert.ok(Number.isFinite(nanViewport.end), "NaN 视口不应产生 NaN end");
    // 最小视口高度兜底：视口为 0 时用 minimumViewportHeight
    const zeroViewport = virtualRowRange(layout.offsets, 480, 0, 0, 200);
    assert.equal(zeroViewport.end, 15, "视口 0 时用最小视口 200 计算（约 4 行）");
});

test("virtual-list：空范围与单行下 range 恒为空且不越界", () => {
    const empty = rows(0);
    assert.deepEqual(virtualRowRange(empty.offsets, 100, 400, 3, 200), { start: 0, end: 0 });

    const single = rows(1);
    const range = virtualRowRange(single.offsets, 0, 400, 3, 200);
    assert.equal(range.start, 0);
    assert.equal(range.end, 1, "单行时 end 最多为 1");
});

test("virtual-list：每行多个条目时行数为向上取整，key 以分隔符拼接", () => {
    const items = Array.from({ length: 7 }, (_unused, index) => `p-${index}`);
    const layout = buildVirtualRows(items, 3, (item) => item, () => undefined, 40, 8);
    assert.equal(layout.rows.length, 3, "7 个条目每 3 个一行 → 3 行");
    assert.equal(layout.rows[0].items.length, 3);
    assert.equal(layout.rows[2].items.length, 1, "最后一行补余");
    assert.equal(layout.rows[0].key, "p-0\u001fp-1\u001fp-2", "key 用单元分隔符拼接");
    assert.equal(layout.rows[0].startIndex, 0);
    assert.equal(layout.rows[1].startIndex, 3);
    assert.equal(layout.rows[2].startIndex, 6);
    // 3 行 → 3×40 + 2×8 = 136
    assert.equal(layout.totalHeight, 136);
});

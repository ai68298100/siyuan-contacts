export interface VirtualRow<T> {
    readonly key: string;
    readonly items: readonly T[];
    readonly startIndex: number;
    readonly height: number;
}

export interface VirtualRows<T> {
    readonly rows: readonly VirtualRow<T>[];
    /** Pixel offset for each row start, followed by the total list height. */
    readonly offsets: readonly number[];
    readonly totalHeight: number;
}

/** Estimates unseen row height from the median of complete, measured rows. */
export function estimateVirtualHeight(
    measuredHeights: Iterable<number>,
    fallback: number,
    minimumSamples = 3,
): number {
    const safeFallback = Number.isFinite(fallback) && fallback > 0 ? fallback : 1;
    const values = [...measuredHeights]
        .filter((value) => Number.isFinite(value) && value > 0);
    const requiredSamples = Number.isFinite(minimumSamples) ? Math.max(1, Math.floor(minimumSamples)) : 3;
    if (values.length < requiredSamples) return safeFallback;
    values.sort((left, right) => left - right);
    const middle = Math.floor(values.length / 2);
    const median = values.length % 2
        ? values[middle]!
        : ((values[middle - 1] ?? safeFallback) + (values[middle] ?? safeFallback)) / 2;
    return Math.max(1, Math.round(median));
}

export function buildVirtualRows<T>(
    items: readonly T[],
    columns: number,
    keyOf: (item: T) => string,
    measuredHeight: (itemId: string) => number | undefined,
    estimatedHeight: number,
    rowGap: number,
): VirtualRows<T> {
    const columnCount = Math.max(1, Math.floor(columns));
    const estimate = Number.isFinite(estimatedHeight) && estimatedHeight > 0 ? estimatedHeight : 1;
    const gap = Number.isFinite(rowGap) && rowGap > 0 ? rowGap : 0;
    const rows: VirtualRow<T>[] = [];
    const offsets = [0];

    for (let startIndex = 0; startIndex < items.length; startIndex += columnCount) {
        const rowItems = items.slice(startIndex, startIndex + columnCount);
        let height = 0;
        let hasUnmeasuredItem = false;
        for (const item of rowItems) {
            const measured = measuredHeight(keyOf(item));
            if (measured !== undefined && Number.isFinite(measured) && measured > 0) height = Math.max(height, measured);
            else hasUnmeasuredItem = true;
        }
        if (hasUnmeasuredItem) height = Math.max(height, estimate);
        height = Math.max(1, height);
        rows.push({
            key: rowItems.map(keyOf).join("\u001f"),
            items: rowItems,
            startIndex,
            height,
        });
        offsets.push(offsets[offsets.length - 1] + height + (startIndex + rowItems.length < items.length ? gap : 0));
    }

    const totalHeight = offsets[offsets.length - 1] ?? 0;
    return { rows, offsets, totalHeight };
}

/** Finds the row whose measured interval contains a scroll offset. */
export function virtualRowAtOffset(offsets: readonly number[], offset: number): number {
    const rowCount = Math.max(0, offsets.length - 1);
    if (rowCount === 0) return 0;
    const target = Math.max(0, Number.isFinite(offset) ? offset : 0);
    let low = 0;
    let high = rowCount;
    while (low < high) {
        const middle = Math.ceil((low + high) / 2);
        if ((offsets[middle] ?? 0) <= target) low = middle;
        else high = middle - 1;
    }
    return Math.min(rowCount - 1, low);
}

export function virtualRowRange(
    offsets: readonly number[],
    scrollTop: number,
    viewportHeight: number,
    overscanRows: number,
    minimumViewportHeight: number,
): { start: number; end: number } {
    const rowCount = Math.max(0, offsets.length - 1);
    if (rowCount === 0) return { start: 0, end: 0 };
    const overscan = Math.max(0, Math.floor(overscanRows));
    const viewport = Math.max(0, viewportHeight, minimumViewportHeight);
    const start = Math.max(0, virtualRowAtOffset(offsets, scrollTop) - overscan);
    const lastVisible = virtualRowAtOffset(offsets, Math.max(0, scrollTop) + viewport);
    return { start, end: Math.min(rowCount, lastVisible + overscan + 1) };
}

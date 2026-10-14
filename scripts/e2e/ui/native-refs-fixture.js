/** 图谱 UI 回归使用和生产只读 refs/blocks 投影相同的查询契约。 */
export function nativeRefsQueryCenter(stmt) {
    return String(stmt).match(/WHERE \(\(\(root_id = '(\d{14}-[0-9a-z]{7})' AND def_block_root_id IN/)?.[1] ?? "";
}

export function nativeRefsFixture(stmt, graph) {
    stmt = String(stmt);
    if (stmt.includes("FROM blocks")) {
        const allowed = new Set([...stmt.matchAll(/'(\d{14}-[0-9a-z]{7})'/g)].map((match) => match[1]));
        return graph.nodes.filter((node) => allowed.has(node.id)).map((node) => ({ id: node.id, content: node.label }));
    }
    if (!stmt.includes("FROM refs")) throw new Error("引用夹具拒绝非引用读取");
    const center = nativeRefsQueryCenter(stmt);
    const sourceList = stmt.match(/root_id IN \(([^)]+)\)/)?.[1] ?? "";
    const sources = new Set([...sourceList.matchAll(/'(\d{14}-[0-9a-z]{7})'/g)].map((match) => match[1]));
    const targetList = stmt.match(/def_block_root_id IN \(([^)]+)\)/)?.[1] ?? "";
    const targets = new Set([...targetList.matchAll(/'(\d{14}-[0-9a-z]{7})'/g)].map((match) => match[1]));
    const cursor = stmt.match(/root_id > '([^']+)' OR \(root_id = '\1' AND def_block_root_id > '([^']+)'\)/);
    const after = cursor ? `${cursor[1]}~${cursor[2]}` : "";
    const unique = new Map(graph.links.filter((link) => link.from !== link.to && (center
        ? link.from === center && targets.has(link.to) || link.to === center && sources.has(link.from)
        : sources.has(link.from) && targets.has(link.to)))
        .map((link) => [`${link.from}~${link.to}`, { root_id: link.from, def_block_root_id: link.to }]));
    return [...unique.entries()].filter(([key]) => key > after).sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
        .slice(0, 201).map(([, row]) => row);
}

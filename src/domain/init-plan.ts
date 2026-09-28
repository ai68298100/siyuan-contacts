/**
 * 初始化现场识别：从内核返回的块 markdown 还原数据库锚点。
 * 为什么需要（D-0019）：初始化链必须可续建——第一次中途失败后重跑向导，
 * 要能找回已建成的笔记本/宿主文档/数据库/字段，而不是撞名失败。
 * 库块自身 markdown 含 data-av-id（blocks.markdown 列，v3.8.5 实测），
 * 是"数据库块 ID → avID"唯一可靠的还原通道（块 IAL 里没有 avID）。
 */

const AV_ID_PATTERN = /data-av-id="(\d{14}-[0-9a-z]{7})"/;

/** 从数据库块的 markdown 还原 avID；不是数据库块或缺 avID 时返回 undefined */
export function parseAvIdFromBlockMarkdown(markdown: unknown): string | undefined {
    if (typeof markdown !== "string") return undefined;
    return AV_ID_PATTERN.exec(markdown)?.[1];
}

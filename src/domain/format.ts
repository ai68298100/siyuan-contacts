/**
 * UX-01.11 展示格式统一：相对互动时间与月日格式的共享助手。
 * 纯函数：无 DOM、无 IO，node --test 直接可测。
 */

/** 相对互动时间文案：0=今天互动、1=昨天互动、其余 N 天前互动 */
export function formatRelativeInteraction(daysAgo: number): string {
    if (daysAgo <= 0) return "今天互动";
    if (daysAgo === 1) return "昨天互动";
    return `${daysAgo} 天前互动`;
}

/** YYYY-MM-DD → "M月D日"（非契约格式原样返回） */
export function formatMonthDay(iso: string): string {
    const match = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!match) return iso;
    return `${Number(match[2])}月${Number(match[3])}日`;
}

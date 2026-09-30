/**
 * 疑似重复人物检查（F13）：按规范化电话/邮箱与同名给候选对、理由与并排资料。
 * 只提示不合并——查看候选零写入，不合并、不解绑、不改写原生文档（合并为远期增强）。
 * 匹配规则（固定、可解释）：
 * - 电话：去除空格/横线/括号/点/前导 + 后纯数字比较；不猜测补全国家码或前缀；
 *   规范化后长度不足 6 位不参与匹配（避免短号误报）；
 * - 邮箱：去首尾空白并转小写后完全相等；
 * - 姓名：去首尾空白后完全同名；同名不等同同人，理由单独标注需人工确认；
 * - 空字段不参与匹配。
 * 索引式聚类（桶内两两配对），万级名册可用。纯函数：无 DOM、无 IO。
 */
import type { ContactSummary } from "./person";

export type DuplicateReasonKind = "phone" | "email" | "name";

export interface DuplicateReason {
    kind: DuplicateReasonKind;
    label: string;
}

export interface DuplicatePair {
    a: ContactSummary;
    b: ContactSummary;
    reasons: DuplicateReason[];
}

export function normalizePhoneKey(phone: string): string {
    const digits = phone.replace(/[\s\-().＋+]/g, "");
    return /^\d{6,}$/.test(digits) ? digits : "";
}

export function normalizeEmailKey(email: string): string {
    return email.trim().toLowerCase();
}

export function normalizeNameKey(name: string): string {
    return name.trim();
}

/** G-07：重复候选展示上限——防同名大桶 O(k²) 爆内存 */
export const DUPLICATE_PAIRS_LIMIT = 500;

function pairKey(a: ContactSummary, b: ContactSummary): string {
    const [first, second] = a.itemId < b.itemId ? [a, b] : [b, a];
    return `${first.itemId}::${second.itemId}`;
}

/** 发现疑似重复候选：多理由优先，同理由数按姓名排序；空名册返回空数组。
 *  G-07：maxPairs 上限防大桶 O(k²) 爆内存（500 同名 ≈ 124,750 对 ≈ 60 MiB）；
 *  达到上限后停止生成，调用方以 `pairs.length >= maxPairs` 判断截断并提示。 */
export function findDuplicatePairs(people: readonly ContactSummary[], maxPairs: number = 500): DuplicatePair[] {
    const phones = new Map<string, ContactSummary[]>();
    const emails = new Map<string, ContactSummary[]>();
    const names = new Map<string, ContactSummary[]>();
    for (const person of people) {
        if (person.phone) {
            const key = normalizePhoneKey(person.phone);
            if (key) phones.set(key, [...(phones.get(key) ?? []), person]);
        }
        if (person.email) {
            const key = normalizeEmailKey(person.email);
            if (key) emails.set(key, [...(emails.get(key) ?? []), person]);
        }
        const nameKey = normalizeNameKey(person.name);
        if (nameKey) names.set(nameKey, [...(names.get(nameKey) ?? []), person]);
    }

    const pairs = new Map<string, { a: ContactSummary; b: ContactSummary; reasons: DuplicateReason[] }>();
    const addReason = (a: ContactSummary, b: ContactSummary, reason: DuplicateReason) => {
        if (pairs.size >= maxPairs) return; /* G-07：大桶防护——达上限停止生成 */
        const key = pairKey(a, b);
        const existing = pairs.get(key);
        if (existing) {
            if (!existing.reasons.some((item) => item.kind === reason.kind)) existing.reasons.push(reason);
        } else {
            pairs.set(key, { a, b, reasons: [reason] });
        }
    };
    const addToBucket = (bucket: Map<string, ContactSummary[]>, kind: DuplicateReasonKind, buildLabel: (key: string) => string) => {
        for (const [key, members] of bucket) {
            if (members.length < 2) continue;
            for (let i = 0; i < members.length; i += 1) {
                for (let j = i + 1; j < members.length; j += 1) {
                    addReason(members[i], members[j], { kind, label: buildLabel(key) });
                }
            }
        }
    };
    addToBucket(phones, "phone", (key) => `电话相同：${key}`);
    addToBucket(emails, "email", (key) => `邮箱相同：${key}`);
    addToBucket(names, "name", (key) => `同名：${key}（同名不等同同人，需人工确认）`);

    return [...pairs.values()].sort((a, b) =>
        b.reasons.length - a.reasons.length ||
        a.a.name.localeCompare(b.a.name, "zh-CN"));
}

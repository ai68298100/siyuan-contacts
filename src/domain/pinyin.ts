/**
 * 极轻量中文拼音首字母提取纯函数
 * 供联系人搜索、选人器拼音首字母智能模糊命中，无外部第三方依赖。
 */

const SPECIAL_INITIALS: Record<string, string> = {
    阿: "a",
    艾: "a",
    安: "a",
    敖: "a",
    欧: "o",
    区: "o",
    仇: "q",
    单: "s",
    解: "x",
    查: "z",
    朴: "p",
    曾: "z",
    柏: "b",
    缪: "m",
    翟: "z",
};

const ZH_INITIAL_BOUNDS = "啊芭擦搭蛾发噶哈击喀拉妈拿哦啪期然撒塌挖昔压匝".split("");
const ZH_LETTERS = "abcdefghjklmnopqrstwxyz".split("");

export function getChineseCharInitial(ch: string): string {
    if (!ch) return "";
    if (/[a-zA-Z0-9]/.test(ch)) return ch.toLowerCase();
    if (SPECIAL_INITIALS[ch]) return SPECIAL_INITIALS[ch];
    const code = ch.charCodeAt(0);
    if (code < 0x4e00 || code > 0x9fa5) return "";

    for (let i = ZH_INITIAL_BOUNDS.length - 1; i >= 0; i--) {
        if (ch.localeCompare(ZH_INITIAL_BOUNDS[i], "zh-Hans-CN") >= 0) {
            return ZH_LETTERS[i];
        }
    }
    return "";
}

/**
 * 获取字符串对应的拼音首字母序列（小写）
 */
export function getPinyinInitials(text: string): string {
    if (!text) return "";
    return text.split("").map(getChineseCharInitial).join("");
}

export interface PinyinInitialGroup<T> {
    letter: string;
    count: number;
    items: T[];
}

export const ALPHABET_LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("");

/**
 * 获取联系人姓名的首字母大写（A-Z，非字母字符归入 '#'）
 */
export function getPersonNameInitial(name: string): string {
    if (!name || !name.trim()) return "#";
    const firstChar = name.trim()[0];
    const initial = getChineseCharInitial(firstChar);
    if (initial && /^[a-z]$/i.test(initial)) {
        return initial.toUpperCase();
    }
    return "#";
}

/**
 * 将联系人列表按拼音首字母聚合归类（A-Z + #）
 */
export function groupPeopleByAlphabet<T extends { name: string }>(people: readonly T[]): {
    groups: PinyinInitialGroup<T>[];
    activeLetters: Set<string>;
} {
    const map = new Map<string, T[]>();
    for (const letter of ALPHABET_LETTERS) {
        map.set(letter, []);
    }
    map.set("#", []);

    for (const person of people) {
        const initial = getPersonNameInitial(person.name);
        const list = map.get(initial) ?? map.get("#")!;
        list.push(person);
    }

    const groups: PinyinInitialGroup<T>[] = [];
    const activeLetters = new Set<string>();

    for (const [letter, items] of map.entries()) {
        if (items.length > 0) {
            groups.push({ letter, count: items.length, items });
            activeLetters.add(letter);
        }
    }

    return { groups, activeLetters };
}

/** 联系人搜索投影：关键词命中自身或其显式 related 关系两端。 */
import type { ContactSummary } from "./person";
import { profileText } from "./people-profiles.ts";
import { getPinyinInitials } from "./pinyin.ts";

function matchesOwnFields(person: ContactSummary, keyword: string): boolean {
    const isAsciiKeyword = /^[a-z0-9]+$/i.test(keyword);
    const nameInitials = isAsciiKeyword ? getPinyinInitials(person.name) : "";

    return Boolean(
        person.name.toLowerCase().includes(keyword) ||
        (isAsciiKeyword && nameInitials.includes(keyword)) ||
        (person.aliasProfile?.state === "known" && person.aliasProfile.values.some((alias) =>
            alias.toLowerCase().includes(keyword) || (isAsciiKeyword && getPinyinInitials(alias).includes(keyword)))) ||
        person.phone.includes(keyword) ||
        person.wechat.toLowerCase().includes(keyword) ||
        person.email.toLowerCase().includes(keyword) ||
        person.tags.some((tag) => tag.toLowerCase().includes(keyword) || (isAsciiKeyword && getPinyinInitials(tag).includes(keyword))) ||
        (person.profile ? ["family", "work", "education", "relationship"].some((field) =>
            (field === "relationship" ? person.profile?.relationship.state === "known" && person.profile.relationship.labels.length > 0
                : person.profile?.affiliations.state === "known" && person.profile.affiliations.value[field as "family" | "work" | "education"].length > 0)
            && profileText(person.profile, field as "family" | "work" | "education" | "relationship").toLowerCase().includes(keyword)) : false)
    );
}

/**
 * 搜索结果包含关键词命中的人物及其显式关系邻居。
 *
 * 关系列使用 itemID，结果投影也按 itemID 连接；同时接受单向/尚未回写完成的
 * 关系，避免一侧已有边时搜索结果看起来像没有关联人。分组条件继续作用于最终结果。
 */
export function filterContactSearch(
    people: readonly ContactSummary[],
    query: string,
    group = "",
): ContactSummary[] {
    const keyword = query.trim().toLowerCase();
    const inGroup = (person: ContactSummary) => !group || person.group === group;
    if (!keyword) return people.filter(inGroup);

    const direct = people.filter((person) => inGroup(person) && matchesOwnFields(person, keyword));
    if (direct.length === 0) return [];
    const directIds = new Set(direct.map((person) => person.itemId));
    const directRelatedIds = new Set(direct.flatMap((person) => person.relatedItemIds));
    return people.filter((person) => inGroup(person)
        && (directIds.has(person.itemId)
            || directRelatedIds.has(person.itemId)
            || person.relatedItemIds.some((itemId) => directIds.has(itemId))
        ));
}


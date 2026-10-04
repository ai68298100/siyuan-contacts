import type { PersonAffiliationProjection } from "./org-membership.ts";
import type { RelationshipLabelProjection } from "./person-relationship-labels.ts";

export interface PersonProfile {
    readAt: number;
    affiliations: { state: "known"; value: PersonAffiliationProjection } | { state: "unknown"; message: string };
    relationship: RelationshipLabelProjection;
    relationshipMessage?: string;
    selfDocId?: string | null;
}

export function profileText(profile: PersonProfile | undefined, field: "work" | "education" | "relationship" | "org"): string {
    if (!profile) return "尚未核实";
    if (field === "relationship") {
        if (profile.relationship.state === "unknown") return "称谓尚未核实";
        if (profile.relationship.state === "self_missing") return "请先设置本人";
        if (profile.relationship.state === "self") return "本人";
        return profile.relationship.state === "known" ? profile.relationship.labels.join("、") || "未填写" : "尚未核实";
    }
    if (profile.affiliations.state === "unknown") return "组织归属尚未核实";
    const value = profile.affiliations.value;
    const items = field === "org" ? [...value.work, ...value.education, ...value.unspecified] : value[field];
    return items.map((item) => [item.orgName, item.department, item.title].filter(Boolean).join(" · ")).join("；") || "未填写";
}

export function matchesProfileFilters(profile: PersonProfile | undefined, filter: { workQuery?: string; educationQuery?: string; relationshipLabel?: string }): boolean {
    for (const field of ["work", "education"] as const) {
        const query = (field === "work" ? filter.workQuery : filter.educationQuery)?.trim().toLowerCase();
        if (query && (profile?.affiliations.state !== "known" || !profile.affiliations.value[field].some((item) =>
            [item.orgName, item.department, item.title].filter(Boolean).join(" ").toLowerCase().includes(query)))) return false;
    }
    const label = filter.relationshipLabel?.trim();
    return !label || profile?.relationship.state === "known" && profile.relationship.labels.includes(label);
}

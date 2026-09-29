/**
 * AI 资料候选的受限补丁裁决（FUNC-01.14，纯函数可测）。
 * 纪律：只对补丁字段出写入（其余字段零触碰）；逐字段对照「当前库值」与「候选依据的快照值」
 * ——快照后该字段被并发改动且候选值又与之不同时判 conflict（提示冲突，不覆盖）；
 * 当前值已等于候选值判 skip（幂等）；其余 apply。见 NEXT-DEVELOPMENT-PLAN FUNC-01.14。
 */
import { PROFILE_FIELDS } from "./ai-extract.ts";
import type { ProfileField } from "./ai-extract.ts";

export interface CandidateFieldPatch {
    field: ProfileField;
    value: string;
    /** 候选生成时所依据的快照值（同字段）；缺省视为无并发证据直接应用 */
    baseline?: string;
}

export type CandidateFieldAction = "apply" | "skip" | "conflict";

export interface CandidateFieldOutcome {
    field: ProfileField;
    action: CandidateFieldAction;
    /** trim 后的候选值（apply 时由服务层写入） */
    value: string;
}

const trim = (value: string | undefined): string => (value ?? "").trim();

export function resolveCandidateFields(
    fresh: Partial<Record<ProfileField, string>>,
    patches: readonly CandidateFieldPatch[],
): CandidateFieldOutcome[] {
    const outcomes: CandidateFieldOutcome[] = [];
    for (const patch of patches) {
        if (!PROFILE_FIELDS.includes(patch.field)) continue;
        const value = trim(patch.value);
        if (!value) continue; /* 空候选不产生写入（AI 解析层已过滤，这里兜底） */
        const current = trim(fresh[patch.field]);
        if (current === value) {
            outcomes.push({ field: patch.field, action: "skip", value });
            continue;
        }
        const baseline = trim(patch.baseline);
        if (baseline !== "" && current !== baseline && current !== value) {
            /* 快照之后字段被并发改动：提示冲突，不覆盖 */
            outcomes.push({ field: patch.field, action: "conflict", value });
            continue;
        }
        outcomes.push({ field: patch.field, action: "apply", value });
    }
    return outcomes;
}

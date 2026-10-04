export type CaptureStatus = "pending" | "applied" | "skipped" | "failed" | "unknown";

export type CaptureIssueCode = "alias_ambiguous" | "name_ambiguous" | "invalid_name" | "person_missing"
    | "identity_unavailable"
    | "read_failed" | "create_rejected" | "create_unknown" | "bind_failed" | "interaction_failed"
    | "interaction_unknown" | "interaction_removed" | "projection_failed" | "projection_unknown";

export interface CaptureStage {
    status: CaptureStatus;
    code?: CaptureIssueCode;
    message?: string;
}

export interface CaptureInput {
    personDocIds: readonly string[];
    newNames: readonly string[];
    date: string;
    place?: string;
    note?: string;
}

export interface CapturePersonCheckpoint {
    key: string;
    name: string;
    personDocId?: string;
    eventId?: string;
    created: boolean;
    contact: CaptureStage;
    interaction: CaptureStage;
}

export interface CaptureProjectionCheckpoint extends CaptureStage {
    key: string;
    target: string;
    rootId?: string;
    markdown?: string;
}

export interface CaptureCheckpoint {
    requestId: string;
    generation: number;
    sourceDocId: string;
    anchor: string;
    input: CaptureInput;
    people: CapturePersonCheckpoint[];
    projections: CaptureProjectionCheckpoint[];
}

export const CAPTURE_PROJECTION_POLICY = "历史互动保持不变；日期、地点或参与者变化时，旧日记、旧地点及被移除人物中的投影保留，不自动清理。纠错须先预览影响，删除错误互动后重新记录；仅可清理插件生成块。";

export function normalizeCaptureInput(input: CaptureInput): CaptureInput {
    return {
        personDocIds: [...new Set(input.personDocIds)],
        newNames: [...new Set(input.newNames.map((name) => name.trim()).filter(Boolean))],
        date: input.date,
        ...(input.place?.trim() ? { place: input.place.trim() } : {}),
        ...(input.note?.trim() ? { note: input.note.trim() } : {}),
    };
}

export function captureStageComplete(stage: CaptureStage): boolean {
    return stage.status === "applied" || stage.status === "skipped";
}

export function capturePersonStatus(person: CapturePersonCheckpoint): CaptureStatus {
    if (person.contact.status === "unknown" || person.interaction.status === "unknown") return "unknown";
    if (person.contact.status === "failed" || person.interaction.status === "failed") return "failed";
    if (!captureStageComplete(person.contact) || !captureStageComplete(person.interaction)) return "pending";
    return person.interaction.status;
}

export function captureCheckpointComplete(checkpoint: CaptureCheckpoint): boolean {
    return checkpoint.people.every((person) => captureStageComplete(person.contact) && captureStageComplete(person.interaction))
        && checkpoint.projections.every(captureStageComplete);
}

export function beginCaptureCheckpoint(
    sourceDocId: string,
    anchor: string,
    input: CaptureInput,
    requestId: string,
    previous?: CaptureCheckpoint,
): CaptureCheckpoint {
    const normalized = normalizeCaptureInput(input);
    if (previous) {
        if (previous.sourceDocId !== sourceDocId || previous.anchor !== anchor
            || JSON.stringify(normalizeCaptureInput(previous.input)) !== JSON.stringify(normalized)) {
            throw new Error("重试必须沿用原笔记、数据库和确认输入；请先核对已有结果");
        }
        return {
            ...previous,
            requestId,
            generation: previous.generation + 1,
            input: normalized,
            people: previous.people.map((person) => ({ ...person, contact: { ...person.contact }, interaction: { ...person.interaction } })),
            projections: previous.projections.map((projection) => ({ ...projection })),
        };
    }
    return {
        requestId, generation: 1, sourceDocId, anchor, input: normalized,
        people: [
            ...normalized.personDocIds.map((personDocId) => ({ key: `doc:${personDocId}`, name: personDocId, personDocId })),
            ...normalized.newNames.map((name) => ({ key: `name:${name}`, name })),
        ].map((person) => ({ ...person, created: false, contact: { status: "pending" }, interaction: { status: "pending" } })),
        projections: [],
    };
}

export function shouldWriteCaptureProjection(previous: CaptureProjectionCheckpoint | undefined, markdown: string): boolean {
    return !previous || !captureStageComplete(previous) || previous.markdown !== markdown;
}

export function captureDiagnosticSummary(checkpoint: CaptureCheckpoint): string {
    return JSON.stringify({
        requestId: checkpoint.requestId, generation: checkpoint.generation, sourceDocId: checkpoint.sourceDocId,
        complete: captureCheckpointComplete(checkpoint), input: checkpoint.input,
        people: checkpoint.people,
        projections: checkpoint.projections.map(({ markdown: _markdown, ...projection }) => projection),
        projectionPolicy: CAPTURE_PROJECTION_POLICY,
    }, null, 2);
}

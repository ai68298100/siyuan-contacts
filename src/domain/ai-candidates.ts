import type { ExtractionResult, ProfileField } from "./ai-extract.ts";
import type { AiPreflight, AiSourceKind } from "./ai-preflight.ts";
import { isValidDateKey } from "./followups.ts";
import type { ContactSummary } from "./person.ts";

export interface AiCandidateEvidence {
    sourceDocId: string;
    sourceKind: AiSourceKind;
    quote: string;
    start: number | null;
    end: number | null;
    status: "verified" | "weak" | "missing";
}

export type AiCandidateWriteStatus = "pending" | "applied" | "skipped" | "failed" | "unknown";

export interface AiCandidateDraft {
    id: string;
    kind: "person" | "profile" | "followup" | "occasion" | "relation";
    personName: string;
    personB: string;
    targets: ContactSummary[];
    selectedDocId: string;
    field: ProfileField | "date" | "place" | "note" | "relation" | "name";
    value: string;
    title: string;
    dueDate: string;
    evidence: AiCandidateEvidence;
    checked: boolean;
    decision: "pending" | "accepted" | "rejected";
    conflict: boolean;
    status: AiCandidateWriteStatus;
    error: string;
    writeCheckpoint?: {
        docId: string;
        itemId: string;
        value: string;
        title: string;
        dueDate: string;
        baseline: string;
        followUpId?: string;
    };
}

function evidenceFor(preflight: AiPreflight, quote: string | undefined, required: readonly string[]): AiCandidateEvidence {
    const supplied = quote?.trim() ?? "";
    const position = supplied ? preflight.sentText.indexOf(supplied) : -1;
    const verified = position >= 0 && required.every((value) => supplied.includes(value));
    const fallback = required[0] ? preflight.sentText.indexOf(required[0]) : -1;
    const start = position >= 0 ? position : fallback >= 0 ? Math.max(0, fallback - 30) : null;
    const snippet = position >= 0 ? supplied : start === null ? "" : preflight.sentText.slice(start, start + 140);
    return {
        sourceDocId: preflight.sourceDocId, sourceKind: preflight.sourceKind,
        quote: snippet, start, end: start === null ? null : start + snippet.length,
        status: verified ? "verified" : snippet ? "weak" : "missing",
    };
}

export function buildAiCandidateDrafts(extraction: ExtractionResult, preflight: AiPreflight, roster: readonly ContactSummary[]): AiCandidateDraft[] {
    const drafts: AiCandidateDraft[] = [];
    const identities = new Set<string>();
    function add(kind: AiCandidateDraft["kind"], personName: string, field: AiCandidateDraft["field"], value: string,
        quote?: string, title = "", dueDate = "", personB = ""): void {
        const identity = JSON.stringify([preflight.id, kind, personName, personB, field, value, title, dueDate]);
        if (identities.has(identity)) return;
        identities.add(identity);
        const targets = roster.filter((person) => person.name === personName);
        const required = kind === "person" ? [personName] : kind === "followup" ? [personName, dueDate, title].filter(Boolean)
            : kind === "relation" ? [personName, personB, value] : [personName, value].filter(Boolean);
        drafts.push({
            id: `${preflight.id}:${drafts.length}`, kind, personName, personB, field, value, title, dueDate,
            targets: targets.map((person) => ({ ...person })), selectedDocId: targets.length === 1 ? targets[0].docId : "",
            evidence: evidenceFor(preflight, quote, required), checked: false, decision: "pending",
            conflict: false, status: "pending", error: "",
        });
    }
    if (preflight.fields.includes("people")) {
        for (const name of extraction.names) add("person", name, "name", name, extraction.peopleEvidence?.[name]);
    }
    if (preflight.fields.includes("profile")) {
        for (const item of extraction.profileCandidates) add("profile", item.person, item.field, item.value, item.evidence);
    }
    if (preflight.fields.includes("followup")) {
        for (const item of extraction.followUpCandidates) add("followup", item.person, "note", "", item.evidence, item.title || "联系一下", item.dueDate);
    }
    if (preflight.fields.includes("occasion")) {
        if (extraction.date) add("occasion", "", "date", extraction.date, extraction.occasionEvidence);
        if (extraction.place) add("occasion", "", "place", extraction.place, extraction.occasionEvidence);
        if (extraction.occasion || extraction.note) add("occasion", "", "note", [extraction.occasion, extraction.note].filter(Boolean).join("；"), extraction.occasionEvidence);
    }
    if (preflight.fields.includes("relation")) {
        for (const item of extraction.relationCandidates) add("relation", item.personA, "relation", item.relation, item.evidence, "", "", item.personB);
    }
    for (const candidate of drafts) {
        candidate.conflict = candidate.kind === "profile" && drafts.some((other) => other.id !== candidate.id && other.kind === "profile"
            && other.personName === candidate.personName && other.field === candidate.field && other.value !== candidate.value);
    }
    return drafts;
}

export function aiCandidateCanAccept(candidate: AiCandidateDraft): boolean {
    if (candidate.kind === "person") return Boolean(candidate.value.trim()) && candidate.value.trim().length <= 20
        && (candidate.targets.length === 0 || candidate.targets.some((target) => target.docId === candidate.selectedDocId));
    if (candidate.kind === "relation") return false;
    if (candidate.kind === "followup") return Boolean(candidate.title.trim()) && candidate.title.trim().length <= 40 && isValidDateKey(candidate.dueDate);
    if (candidate.field === "date" || candidate.field === "birthday") return isValidDateKey(candidate.value);
    if (candidate.field === "email") return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(candidate.value);
    return Boolean(candidate.value.trim()) && candidate.value.length <= (candidate.field === "note" ? 300 : 80);
}

export function decideAiCandidate(drafts: readonly AiCandidateDraft[], id: string, decision: "accepted" | "rejected"): AiCandidateDraft[] {
    const chosen = drafts.find((candidate) => candidate.id === id);
    if (!chosen || chosen.status !== "pending" || (decision === "accepted" && !aiCandidateCanAccept(chosen))) return [...drafts];
    return drafts.map((candidate) => {
        const competing = chosen.kind === "profile" && candidate.kind === "profile" && candidate.personName === chosen.personName
            && candidate.field === chosen.field && candidate.selectedDocId === chosen.selectedDocId && candidate.id !== id;
        if (candidate.id === id) return { ...candidate, checked: decision === "accepted", decision };
        if (decision === "accepted" && competing && candidate.status === "pending") return { ...candidate, checked: false, decision: "rejected" };
        return candidate;
    });
}

export function resetAiCandidate(candidate: AiCandidateDraft): void {
    if (candidate.status !== "pending") return;
    candidate.checked = false;
    candidate.decision = "pending";
}

export interface AiCaptureDraft {
    checked: Record<string, boolean>;
    newNamesText: string;
    date: string;
    place: string;
    note: string;
}

export interface AiCandidateCaptureEffect {
    docId: string;
    checked: boolean;
    name: string;
    namePresent: boolean;
    date: string;
    place: string;
    note: string;
}

export function captureAiCandidateEffect(candidate: AiCandidateDraft, draft: AiCaptureDraft): AiCandidateCaptureEffect {
    return {
        docId: candidate.selectedDocId, checked: draft.checked[candidate.selectedDocId] ?? false,
        name: candidate.value.trim(), namePresent: draft.newNamesText.split(/[，,、\s]+/).includes(candidate.value.trim()),
        date: draft.date, place: draft.place, note: draft.note,
    };
}

export function acceptAiCandidateInCapture(candidate: AiCandidateDraft, draft: AiCaptureDraft): AiCaptureDraft {
    if (!candidate.checked || candidate.decision !== "accepted") return draft;
    const next = { ...draft, checked: { ...draft.checked } };
    if (candidate.kind === "person") {
        if (candidate.selectedDocId) next.checked[candidate.selectedDocId] = true;
        else next.newNamesText = [...new Set([...draft.newNamesText.split(/[，,、\s]+/).filter(Boolean), candidate.value.trim()])].join(" ");
    } else if (candidate.kind === "occasion") {
        if (candidate.field === "date") next.date = candidate.value;
        if (candidate.field === "place") next.place = candidate.value;
        if (candidate.field === "note") next.note = candidate.value;
    }
    return next;
}

export function restoreAiCandidateInCapture(candidate: AiCandidateDraft, effect: AiCandidateCaptureEffect, draft: AiCaptureDraft): AiCaptureDraft {
    const next = { ...draft, checked: { ...draft.checked } };
    if (candidate.kind === "person") {
        if (effect.docId && draft.checked[effect.docId] === true) next.checked[effect.docId] = effect.checked;
        else if (!effect.docId && !effect.namePresent) next.newNamesText = draft.newNamesText.split(/[，,、\s]+/).filter((name) => name && name !== effect.name).join(" ");
    } else if (candidate.kind === "occasion") {
        if (candidate.field === "date" && draft.date === candidate.value) next.date = effect.date;
        if (candidate.field === "place" && draft.place === candidate.value) next.place = effect.place;
        if (candidate.field === "note" && draft.note === candidate.value) next.note = effect.note;
    }
    return next;
}

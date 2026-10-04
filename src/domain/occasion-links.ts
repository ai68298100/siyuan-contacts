import { birthdayToMs } from "./person.ts";
import { documentHPath } from "./format.ts";

export const OCCASION_DIARY_FOLDER = "日记";
export const OCCASION_PLACE_FOLDER = "地点";

const DOC_ID_PATTERN = /^\d{14}-[0-9a-z]{7}$/;

export interface OccasionPersonLink {
    docId: string;
    name: string;
}

export interface OccasionProjectionInput {
    sourceDocId: string;
    sourceLabel?: string;
    date: string;
    place?: string;
    diaryDocId?: string;
    placeDocId?: string;
    people: readonly OccasionPersonLink[];
}

export type OccasionProjectionKind = "source" | "diary" | "place" | "person";

function assertDocId(value: string, label: string): void {
    if (!DOC_ID_PATTERN.test(value)) throw new Error(`${label} 不是合法的思源 ID`);
}

function assertDate(value: string): string {
    if (birthdayToMs(value) === null) throw new Error("事项日期必须是有效的 YYYY-MM-DD 公历日期");
    return value;
}

function safeText(value: string): string {
    return value.trim().replace(/[\r\n]+/g, " ");
}

function escapeLinkLabel(value: string): string {
    return safeText(value).replaceAll("\\", "\\\\").replaceAll("[", "\\[").replaceAll("]", "\\]");
}

function link(label: string, docId: string): string {
    assertDocId(docId, "文档 ID");
    return `[${escapeLinkLabel(label)}](siyuan://blocks/${docId})`;
}

export function normalizeOccasionPlace(place: string | undefined): string | undefined {
    const trimmed = place?.trim() ?? "";
    if (!trimmed) return undefined;
    if (trimmed.length > 120) throw new Error("地点名称不能超过 120 个字符");
    if (/[\u0000-\u001f\u007f\\/]/.test(trimmed)) {
        throw new Error("地点名称不能包含换行、斜杠或反斜杠");
    }
    return trimmed;
}

export function occasionDiaryPath(notebookName: string, date: string): string {
    assertDate(date);
    const name = safeText(notebookName);
    if (!name) throw new Error("人脉笔记本名称不能为空");
    return documentHPath(notebookName, OCCASION_DIARY_FOLDER, date);
}

export function occasionPlacePath(notebookName: string, place: string): string {
    const normalized = normalizeOccasionPlace(place);
    if (!normalized) throw new Error("地点名称不能为空");
    const name = safeText(notebookName);
    if (!name) throw new Error("人脉笔记本名称不能为空");
    return documentHPath(notebookName, OCCASION_PLACE_FOLDER, normalized);
}

export function occasionMarkerAttr(sourceDocId: string): string {
    assertDocId(sourceDocId, "来源笔记 ID");
    return `custom-lvct-occasion-${sourceDocId}`;
}

function uniquePeople(people: readonly OccasionPersonLink[]): OccasionPersonLink[] {
    const seen = new Set<string>();
    const result: OccasionPersonLink[] = [];
    for (const person of people) {
        assertDocId(person.docId, "人物文档 ID");
        const name = safeText(person.name);
        if (!name || seen.has(person.docId)) continue;
        seen.add(person.docId);
        result.push({ docId: person.docId, name });
    }
    return result;
}

function contextLinks(input: OccasionProjectionInput): string[] {
    const links: string[] = [link(input.sourceLabel?.trim() || "来源笔记", input.sourceDocId)];
    if (input.diaryDocId) links.push(link(input.date, input.diaryDocId));
    if (input.place && input.placeDocId) links.push(link(input.place, input.placeDocId));
    return links;
}

function relatedLinks(input: OccasionProjectionInput, subjectDocId?: string): string[] {
    const links = contextLinks(input);
    if (subjectDocId) {
        const others = uniquePeople(input.people).filter((person) => person.docId !== subjectDocId);
        if (others.length > 0) links.push(...others.map((person) => link(person.name, person.docId)));
    }
    return links;
}

export function buildOccasionMarkdown(
    kind: OccasionProjectionKind,
    input: OccasionProjectionInput,
    subjectDocId?: string,
): string {
    assertDocId(input.sourceDocId, "来源笔记 ID");
    const date = assertDate(input.date);
    const place = normalizeOccasionPlace(input.place);
    const people = uniquePeople(input.people);
    if (input.diaryDocId) assertDocId(input.diaryDocId, "日记文档 ID");
    if (input.placeDocId) assertDocId(input.placeDocId, "地点文档 ID");
    if (kind === "person" && subjectDocId) assertDocId(subjectDocId, "人物文档 ID");

    const personLinks = people.map((person) => link(person.name, person.docId));
    if (kind === "source") {
        const lines = [`**参与人员**（${date}）：${personLinks.join("、") || "无"}`];
        if (input.diaryDocId) lines.push(`**当日日记**：${link(date, input.diaryDocId)}`);
        if (place && input.placeDocId) lines.push(`**地点**：${link(place, input.placeDocId)}`);
        return lines.join("\n");
    }

    const links = relatedLinks({ ...input, place }, subjectDocId);
    if (kind === "diary") {
        return `**多人事项**（${date}）：${links.join("、")}\n**参与人员**：${personLinks.join("、") || "无"}`;
    }
    if (kind === "place") {
        return `**到访事项**（${date}）：${links.join("、")}\n**参与人员**：${personLinks.join("、") || "无"}`;
    }
    const others = uniquePeople(people).filter((person) => person.docId !== subjectDocId);
    return `**共同事项**（${date}）：${contextLinks({ ...input, place }).join("、")}\n**同行人员**：${others.map((person) => link(person.name, person.docId)).join("、") || "无"}`;
}

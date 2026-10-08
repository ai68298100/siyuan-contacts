import test from "node:test";
import assert from "node:assert/strict";
import { buildPersonNoteMarkdown, normalizePersonNote, parsePersonNoteMarkdown, personNoteMatches } from "../src/domain/person-note.ts";

test("人物备注规范化保留多行并统一换行", () => {
    assert.equal(normalizePersonNote("  第一行\r\n第二行  "), "第一行\n第二行");
});

test("人物备注 Markdown 往返不会把自由文本当成结构", () => {
    const note = "偏好 *安静*\n[下次] 带资料\n{: custom-lvct-followup=\"fake\"}";
    const markdown = buildPersonNoteMarkdown(note);
    assert.match(markdown, /^\*\*人物备注\*\*/);
    assert.equal(parsePersonNoteMarkdown(markdown), note);
    assert.equal(personNoteMatches(`${markdown}\n{: custom-lvct-person-note=\"1\"}`, note), true);
});

test("空备注生成删除语义", () => {
    assert.equal(buildPersonNoteMarkdown("  \n"), "");
    assert.equal(parsePersonNoteMarkdown("普通正文"), "");
});

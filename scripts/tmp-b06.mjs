/* 一次性：B06 关闭守卫调用点迁移（新契约 + 三高频入口接改动明细与保存）。用完即删。（CRLF 兼容） */
import fs from "node:fs";

const EOLof = (s) => (s.includes("\r\n") ? "\r\n" : "\n");
const patch = (file, replacements) => {
    let s = fs.readFileSync(file, "utf8");
    const EOL = EOLof(s);
    for (const [fromLines, toLines] of replacements) {
        const from = fromLines.join(EOL);
        const to = toLines.join(EOL);
        if (!s.includes(from)) throw new Error(`${file} 未找到：${fromLines.join(" / ").slice(0, 80)}`);
        s = s.replace(from, to);
    }
    fs.writeFileSync(file, s);
    console.log("patched", file);
};

/* 2) Workbench：三处 canLeave 改异步聚合 */
patch("src/components/Workbench.svelte", [
    [
        [
            "    function openDetail(person: ContactSummary) {",
            "        if (detailPerson && !canLeave()) return;",
        ],
        [
            "    async function openDetail(person: ContactSummary) {",
            "        if (detailPerson && !(await canLeave.requestClose())) return;",
        ],
    ],
    [
        [
            "    function selectView(view: ViewId) {",
            "        if (view !== current && !canLeave()) return;",
        ],
        [
            "    async function selectView(view: ViewId) {",
            "        if (view !== current && !(await canLeave.requestClose())) return;",
        ],
    ],
    [
        [
            "    function openPeople(focus?: { itemIds: readonly string[]; label: string; sort?: \"name\" | \"group\" | \"birthday\" | \"recent\" | undefined }) {",
            "        if (current !== \"people\" && !canLeave()) return;",
        ],
        [
            "    async function openPeople(focus?: { itemIds: readonly string[]; label: string; sort?: \"name\" | \"group\" | \"birthday\" | \"recent\" | undefined }) {",
            "        if (current !== \"people\" && !(await canLeave.requestClose())) return;",
        ],
    ],
]);

/* 3) PersonDetail：互动备注守卫接明细与保存；关闭按钮走聚合 */
patch("src/components/people/PersonDetail.svelte", [
    [
        [
            "    const guardedClose = useCloseGuard(() => busy || deleting, () => noteText.trim().length > 0);",
        ],
        [
            "    // B06：互动备注草稿给出明细与「保存并离开」（保存=记录这条互动）",
            "    async function persistNote(): Promise<void> {",
            "        if (!current) throw new Error(\"当前没有人物\");",
            "        await onRecord(current.docId, noteText.trim() || undefined);",
            "        recorded = true;",
            "        noteText = \"\";",
            "        await loadInsights();",
            "    }",
            "    const guardedClose = useCloseGuard({",
            "        busy: () => busy || deleting,",
            "        dirty: () => noteText.trim().length > 0,",
            "        changes: () => [text(\"guardNoteDraft\", \"互动备注尚未记录：{text}\", { text: noteText.trim() })],",
            "        save: persistNote,",
            "    });",
        ],
    ],
    [
        [
            "                    mutate(async () => {",
            "                        await onRecord(current.docId, noteText.trim() || undefined);",
            "                        recorded = true;",
            "                        noteText = \"\";",
            "                        await loadInsights();",
            "                    })",
        ],
        [
            "                    mutate(persistNote)",
        ],
    ],
    [
        [
            "        <button class=\"b3-button b3-button--cancel\" onclick={() => { if (canLeave()) guardedClose(onClose); }} disabled={busy || deleting}>{text(\"closeDialog\", \"关闭\")}</button>",
        ],
        [
            "        <button class=\"b3-button b3-button--cancel\" onclick={() => void (async () => { if (await canLeave.requestClose()) onClose(); })()} disabled={busy || deleting}>{text(\"closeDialog\", \"关闭\")}</button>",
        ],
    ],
]);

/* 4) PersonEditDialog：抽出 persist（抛错版），守卫接字段级改动明细 */
patch("src/components/people/PersonEditDialog.svelte", [
    [
        [
            "    const guardedClose = useCloseGuard(() => running, () => !saved && (JSON.stringify(draft) !== original || tagsText !== originalTags));",
        ],
        [
            "    // B06：字段级改动明细 + 「保存并离开」（persist 抛错则留在原地）",
            "    async function persist(): Promise<void> {",
            "        const tags = tagsText.split(/[，,、\\s]+/).map((tag) => tag.trim()).filter((tag) => tag.length > 0);",
            "        await updateContactFields(settings, person.itemId, { ...draft, tags });",
            "        saved = true;",
            "        onSaved();",
            "    }",
            "    function draftChanges(): string[] {",
            "        if (saved) return [];",
            "        const changes: string[] = [];",
            "        const empty = text(\"guardEmpty\", \"（空）\");",
            "        const fields = [",
            "            [text(\"formName\", \"姓名\"), \"name\"], [text(\"formPhone\", \"电话\"), \"phone\"],",
            "            [text(\"formEmail\", \"邮箱\"), \"email\"], [text(\"formWechat\", \"微信\"), \"wechat\"],",
            "            [text(\"formWebsite\", \"网站\"), \"website\"], [text(\"formBirthday\", \"生日\"), \"birthday\"],",
            "        ] as const;",
            "        for (const [label, key] of fields) {",
            "            if (draft[key] !== person[key]) {",
            "                changes.push(text(\"guardFieldChange\", \"{field}：{from} → {to}\", { field: label, from: String(person[key]) || empty, to: String(draft[key]) || empty }));",
            "            }",
            "        }",
            "        if (draft.isLunar !== person.isLunar) {",
            "            changes.push(text(\"guardFieldChange\", \"{field}：{from} → {to}\", { field: text(\"formLunar\", \"农历生日\"), from: person.isLunar ? \"✓\" : empty, to: draft.isLunar ? \"✓\" : empty }));",
            "        }",
            "        if (draft.group !== person.group) {",
            "            changes.push(text(\"guardFieldChange\", \"{field}：{from} → {to}\", { field: text(\"formGroup\", \"分组\"), from: person.group || empty, to: draft.group || empty }));",
            "        }",
            "        if (tagsText !== originalTags) {",
            "            changes.push(text(\"guardTagsChange\", \"标签：{from} → {to}\", { from: originalTags || empty, to: tagsText || empty }));",
            "        }",
            "        return changes;",
            "    }",
            "    const guardedClose = useCloseGuard({",
            "        busy: () => running,",
            "        dirty: () => !saved && (JSON.stringify(draft) !== original || tagsText !== originalTags),",
            "        changes: draftChanges,",
            "        save: persist,",
            "    });",
        ],
    ],
    [
        [
            "    async function submit() {",
            "        if (running) return;",
            "        running = true;",
            "        errorText = \"\";",
            "        try {",
            "            const tags = tagsText.split(/[，,、\\s]+/).map((tag) => tag.trim()).filter((tag) => tag.length > 0);",
            "            await updateContactFields(settings, person.itemId, { ...draft, tags });",
            "            saved = true;",
            "            onSaved();",
            "            onClose();",
            "        } catch (error) {",
            "            errorText = error instanceof Error ? error.message : String(error);",
            "        } finally {",
            "            running = false;",
            "        }",
            "    }",
        ],
        [
            "    async function submit() {",
            "        if (running) return;",
            "        running = true;",
            "        errorText = \"\";",
            "        try {",
            "            await persist();",
            "            onClose();",
            "        } catch (error) {",
            "            errorText = error instanceof Error ? error.message : String(error);",
            "        } finally {",
            "            running = false;",
            "        }",
            "    }",
        ],
    ],
]);

/* 5) AddPersonDialog：同上（新建草稿明细 + 保存） */
patch("src/components/people/AddPersonDialog.svelte", [
    [
        [
            "    const guardedClose = useCloseGuard(() => running, () => !saved && (JSON.stringify(draft) !== JSON.stringify(emptyDraft()) || tagsText.trim().length > 0));",
        ],
        [
            "    // B06：新建草稿给出明细 + 「保存并离开」（persist 抛错则留在原地）",
            "    async function persist(): Promise<void> {",
            "        const tags = tagsText.split(/[，,、\\s]+/).map((tag) => tag.trim()).filter((tag) => tag.length > 0);",
            "        const person = await createContact(settings, { ...draft, tags });",
            "        saved = true;",
            "        onCreated(person);",
            "    }",
            "    function draftChanges(): string[] {",
            "        if (saved) return [];",
            "        const changes: string[] = [];",
            "        const empty = text(\"guardEmpty\", \"（空）\");",
            "        const fields = [",
            "            [text(\"formName\", \"姓名\"), \"name\"], [text(\"formPhone\", \"电话\"), \"phone\"],",
            "            [text(\"formEmail\", \"邮箱\"), \"email\"], [text(\"formWechat\", \"微信\"), \"wechat\"],",
            "            [text(\"formWebsite\", \"网站\"), \"website\"], [text(\"formBirthday\", \"生日\"), \"birthday\"],",
            "            [text(\"formGroup\", \"分组\"), \"group\"],",
            "        ] as const;",
            "        for (const [label, key] of fields) {",
            "            if (String(draft[key]).trim().length > 0) {",
            "                changes.push(text(\"guardFieldChange\", \"{field}：{from} → {to}\", { field: label, from: empty, to: String(draft[key]) }));",
            "            }",
            "        }",
            "        if (draft.isLunar) changes.push(text(\"guardFieldChange\", \"{field}：{from} → {to}\", { field: text(\"formLunar\", \"农历生日\"), from: empty, to: \"✓\" }));",
            "        if (tagsText.trim().length > 0) changes.push(text(\"guardTagsChange\", \"标签：{from} → {to}\", { from: empty, to: tagsText }));",
            "        return changes;",
            "    }",
            "    const guardedClose = useCloseGuard({",
            "        busy: () => running,",
            "        dirty: () => !saved && (JSON.stringify(draft) !== JSON.stringify(emptyDraft()) || tagsText.trim().length > 0),",
            "        changes: draftChanges,",
            "        save: persist,",
            "    });",
        ],
    ],
    [
        [
            "    async function submit() {",
            "        if (running) return;",
            "        running = true;",
            "        errorText = \"\";",
            "        try {",
            "            const tags = tagsText.split(/[，,、\\s]+/).map((tag) => tag.trim()).filter((tag) => tag.length > 0);",
            "            const person = await createContact(settings, { ...draft, tags });",
            "            saved = true;",
            "            onCreated(person);",
            "            onClose();",
            "        } catch (error) {",
            "            errorText = error instanceof Error ? error.message : String(error);",
            "        } finally {",
            "            running = false;",
            "        }",
        ],
        [
            "    async function submit() {",
            "        if (running) return;",
            "        running = true;",
            "        errorText = \"\";",
            "        try {",
            "            await persist();",
            "            onClose();",
            "        } catch (error) {",
            "            errorText = error instanceof Error ? error.message : String(error);",
            "        } finally {",
            "            running = false;",
            "        }",
        ],
    ],
]);

/* 6) SettingsView / VCardDialog / ImportDialog / PeopleView：明细（无保存动作，保持 放弃/取消） */
patch("src/components/SettingsView.svelte", [
    [
        [
            "    const guardedClose = useCloseGuard(",
            "        () => savingPreferences || rebinding || mappingBusy || importingInteractions,",
            "        () => JSON.stringify(draft) !== JSON.stringify(savedDraft) || importText.trim().length > 0,",
            "    );",
        ],
        [
            "    const guardedClose = useCloseGuard({",
            "        busy: () => savingPreferences || rebinding || mappingBusy || importingInteractions,",
            "        dirty: () => JSON.stringify(draft) !== JSON.stringify(savedDraft) || importText.trim().length > 0,",
            "        changes: () => [",
            "            ...(JSON.stringify(draft) !== JSON.stringify(savedDraft) ? [text(\"guardPrefsDraft\", \"显示偏好尚未保存\")] : []),",
            "            ...(importText.trim().length > 0 ? [text(\"guardImportTextDraft\", \"互动合并输入尚未处理\")] : []),",
            "        ],",
            "    });",
        ],
    ],
]);

patch("src/components/people/VCardDialog.svelte", [
    [
        [
            "    const guardedClose = useCloseGuard(() => importing || parsing || exporting || retrying, () => report === null && plans !== null && selectedCount > 0);",
        ],
        [
            "    const guardedClose = useCloseGuard({",
            "        busy: () => importing || parsing || exporting || retrying,",
            "        dirty: () => report === null && plans !== null && selectedCount > 0,",
            "        changes: () => [text(\"guardVcardSelection\", \"已选择 {n} 位联系人待导入\", { n: selectedCount })],",
            "    });",
        ],
    ],
]);

patch("src/components/people/ImportDialog.svelte", [
    [
        [
            "    const guardedClose = useCloseGuard(",
            "        () => importing,",
            "        () => importedCount === null && (selectedIds.length > 0 || importGroup !== \"\" || importTagsText.trim() !== \"\"),",
            "    );",
        ],
        [
            "    const guardedClose = useCloseGuard({",
            "        busy: () => importing,",
            "        dirty: () => importedCount === null && (selectedIds.length > 0 || importGroup !== \"\" || importTagsText.trim() !== \"\"),",
            "        changes: () => [",
            "            ...(selectedIds.length > 0 ? [text(\"guardAdoptSelection\", \"已勾选 {n} 篇文档待收编\", { n: selectedIds.length })] : []),",
            "            ...(importGroup !== \"\" || importTagsText.trim() !== \"\" ? [text(\"guardAdoptMeta\", \"收编分组/标签输入尚未应用\")] : []),",
            "        ],",
            "    });",
        ],
    ],
]);

patch("src/components/people/PeopleView.svelte", [
    [
        [
            "    useCloseGuard(() => batchBusy, () => batchOpen && (batchGroup !== \"__keep\" || !!batchTagsText.trim()));",
        ],
        [
            "    useCloseGuard({",
            "        busy: () => batchBusy,",
            "        dirty: () => batchOpen && (batchGroup !== \"__keep\" || !!batchTagsText.trim()),",
            "        changes: () => [text(\"guardBatchDraft\", \"批量编辑尚未应用\")],",
            "    });",
        ],
    ],
]);

console.log("B06 调用点迁移完成");

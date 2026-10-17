<script lang="ts">
    import { onDestroy, tick, untrack } from "svelte";
    import {
        MAX_PERSON_FIELDS_ITEMS,
        MAX_PERSON_FIELD_LABEL_LENGTH,
        MAX_PERSON_FIELD_VALUE_LENGTH,
        filterPersonFields,
        normalizePersonFields,
        personFieldsKey,
        type PersonField,
        type PersonFieldsSnapshot,
        type PersonFieldsState,
    } from "../../domain/person-fields";
    import { requestErrorMessage } from "../../shared/error-presenter";
    import { copyPlainText } from "../../shared/clipboard";
    import { useCloseGuard } from "../close-guard";

    let { personDocId, revision = 0, onLoad, onSave, onOpenDocument }: {
        personDocId: string;
        revision?: number;
        onLoad: (docId: string) => Promise<PersonFieldsState>;
        onSave: (docId: string, snapshot: PersonFieldsSnapshot, expected: PersonFieldsState) => Promise<PersonFieldsState>;
        onOpenDocument?: () => void;
    } = $props();

    let baseline: PersonFieldsState | null = $state(null);
    let draft: PersonField[] = $state([]);
    let editing = $state(false);
    let loading = $state(true);
    let saving = $state(false);
    let errorText = $state("");
    let statusText = $state("");
    let externalChanged = $state(false);
    let attemptedValidation = $state(false);
    let pendingDeleteId = $state("");
    let filterQuery = $state("");
    let copyPendingId = $state("");
    let copyInFlight = $state(false);
    let copyResultId = $state("");
    let copyStatusText = $state("");
    let copyErrorText = $state("");
    let resultElement: HTMLElement | undefined = $state();
    let editorElement: HTMLElement | undefined = $state();
    let alive = true;
    let generation = 0;
    let editRevision = 0;
    let activeDocId = "";
    let seenRevision = 0;
    let copyRequest = 0;
    const componentId = $props.id();
    const dirty = $derived.by(() => editing && baseline !== null && JSON.stringify(draft) !== JSON.stringify(baseline.snapshot.items));
    const busy = $derived(loading || saving);
    const blocked = $derived(busy || !!pendingDeleteId);
    const groups = $derived(draft.filter((item) => item.kind === "group"));
    const pendingDelete = $derived(draft.find((item) => item.id === pendingDeleteId));
    const emptyLabels = $derived(attemptedValidation ? draft.filter((item) => !item.label.trim()) : []);
    const filtered = $derived.by(() => filterPersonFields(baseline?.snapshot.items ?? [], filterQuery));
    const totalEntryCount = $derived.by(() => baseline?.snapshot.items.filter((item) => item.kind === "entry").length ?? 0);

    const guardedLeave = useCloseGuard({
        busy: () => busy,
        dirty: () => dirty,
        changes: () => ["补充资料有未保存的修改"],
        save: () => save(true),
    });
    onDestroy(() => { alive = false; generation += 1; copyRequest += 1; });

    function invalidateCopy(): void {
        copyRequest += 1;
        copyPendingId = "";
        copyResultId = "";
        copyStatusText = "";
        copyErrorText = "";
    }

    function changeFilter(value: string): void {
        filterQuery = value;
        invalidateCopy();
    }

    async function copyValue(entryId: string): Promise<void> {
        if (busy || editing || copyInFlight || !baseline) return;
        const entry = baseline.snapshot.items.find((item) => item.id === entryId);
        if (!entry || entry.kind !== "entry" || entry.value.length === 0) return;
        const docId = personDocId;
        const request = generation;
        const snapshotKey = personFieldsKey(baseline.snapshot);
        const copy = ++copyRequest;
        const label = entry.label;
        const value = entry.value;
        copyInFlight = true;
        copyPendingId = entryId;
        copyResultId = "";
        copyStatusText = "";
        copyErrorText = "";
        const activeCopy = () => current(docId, request) && copy === copyRequest && !editing && !busy
            && baseline !== null && personFieldsKey(baseline.snapshot) === snapshotKey
            && baseline.snapshot.items.some((item) => item.id === entryId && item.kind === "entry" && item.value === value);
        try {
            await copyPlainText(value);
            if (!activeCopy()) return;
            copyResultId = entryId;
            copyStatusText = `已复制“${label}”的内容`;
        } catch {
            if (!activeCopy()) return;
            copyResultId = entryId;
            copyErrorText = `未能复制“${label}”的内容。请选中上方内容手动复制。`;
        } finally {
            // Clipboard API 无法取消。反馈失效后仍等待这次请求结束，避免新旧写入乱序。
            copyInFlight = false;
            if (copy === copyRequest) copyPendingId = "";
        }
    }

    function copyItems(items: readonly PersonField[]): PersonField[] {
        return items.map((item) => ({ ...item }));
    }

    /** 回调也必须通过归属、格式和块身份校验，不能把错误结果当成空资料。 */
    function checkedState(value: unknown, docId: string): PersonFieldsState {
        if (!value || typeof value !== "object" || Array.isArray(value)
            || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) throw new Error("补充资料读取结果格式无效");
        const record = value as Record<string, unknown>;
        if (Reflect.ownKeys(record).some((key) => key !== "blockId" && key !== "snapshot")) throw new Error("补充资料读取结果含未知字段");
        if (record.blockId !== undefined && (typeof record.blockId !== "string" || !/^\d{14}-[0-9a-z]{7}$/.test(record.blockId) || record.blockId === docId)) {
            throw new Error("补充资料读取结果的块身份无效");
        }
        const snapshot = normalizePersonFields(record.snapshot, docId);
        if (record.blockId === undefined && snapshot.items.length > 0) throw new Error("补充资料读取结果缺少原文位置，未作为可编辑资料显示");
        return { ...(record.blockId === undefined ? {} : { blockId: record.blockId as string }), snapshot };
    }

    function current(docId: string, request: number, edit?: number): boolean {
        return alive && docId === personDocId && docId === activeDocId && request === generation
            && (edit === undefined || edit === editRevision);
    }

    async function focusResult(docId: string, request: number, edit: number): Promise<void> {
        await tick();
        if (current(docId, request, edit)) resultElement?.focus();
    }

    async function load(docId = personDocId): Promise<void> {
        if (!alive || docId !== personDocId || saving) return;
        invalidateCopy();
        const request = ++generation;
        const edit = ++editRevision;
        loading = true;
        errorText = "";
        statusText = "";
        attemptedValidation = false;
        pendingDeleteId = "";
        try {
            const loaded = checkedState(await onLoad(docId), docId);
            if (!current(docId, request, edit)) return;
            baseline = loaded;
            draft = copyItems(loaded.snapshot.items);
            editing = false;
            externalChanged = false;
        } catch (error) {
            if (!current(docId, request, edit)) return;
            // 读取失败时保留上次确认值，但不允许以它继续编辑或保存。
            baseline = null;
            errorText = requestErrorMessage(error);
        } finally {
            if (current(docId, request, edit)) loading = false;
        }
    }

    $effect(() => {
        const docId = personDocId;
        const nextRevision = revision;
        untrack(() => {
            if (docId !== activeDocId) {
                filterQuery = "";
                invalidateCopy();
                activeDocId = docId;
                seenRevision = nextRevision;
                baseline = null;
                draft = [];
                editing = false;
                saving = false;
                externalChanged = false;
                void load(docId);
            } else if (nextRevision !== seenRevision) {
                seenRevision = nextRevision;
                if (dirty || busy) externalChanged = true;
                else void load(docId);
            }
        });
    });

    function beginEditing(): boolean {
        if (busy || !baseline) return false;
        if (!editing) {
            invalidateCopy();
            filterQuery = "";
            draft = copyItems(baseline.snapshot.items);
            editing = true;
            editRevision += 1;
            errorText = "";
            statusText = "";
            attemptedValidation = false;
            pendingDeleteId = "";
        }
        return true;
    }

    function changed(): void {
        editRevision += 1;
        errorText = "";
        statusText = "";
    }

    /** 局域网 HTTP 可用 getRandomValues，但通常没有仅限安全上下文的 randomUUID。 */
    function newFieldId(): string {
        const cryptoApi = globalThis.crypto;
        if (typeof cryptoApi?.randomUUID === "function") return cryptoApi.randomUUID();
        if (typeof cryptoApi?.getRandomValues !== "function") throw new Error("当前环境无法安全生成资料条目标识，请更换访问方式后重试。");
        const bytes = cryptoApi.getRandomValues(new Uint8Array(16));
        bytes[6] = (bytes[6] & 0x0f) | 0x40;
        bytes[8] = (bytes[8] & 0x3f) | 0x80;
        const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
        return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
    }

    async function add(kind: "entry" | "group"): Promise<void> {
        if (blocked || !beginEditing() || draft.length >= MAX_PERSON_FIELDS_ITEMS) return;
        const docId = personDocId;
        const request = generation;
        try {
            const id = newFieldId();
            draft = [...draft, kind === "group" ? { id, kind, label: "" } : { id, kind, label: "", value: "" }];
            changed();
            const edit = editRevision;
            await tick();
            if (current(docId, request, edit)) editorElement?.querySelector<HTMLInputElement>(`[data-field-id="${id}"] input`)?.focus();
        } catch (error) {
            if (current(docId, request)) errorText = requestErrorMessage(error, "未能创建资料条目，请稍后重试。");
        }
    }

    function updateLabel(id: string, value: string): void {
        if (!editing || blocked) return;
        draft = draft.map((item) => item.id === id ? { ...item, label: value } : item);
        changed();
    }

    function updateValue(id: string, value: string): void {
        if (!editing || blocked) return;
        draft = draft.map((item) => item.id === id && item.kind === "entry" ? { ...item, value } : item);
        changed();
    }

    function updateParent(id: string, parentId: string): void {
        if (!editing || blocked || parentId && !groups.some((group) => group.id === parentId)) return;
        draft = draft.map((item) => {
            if (item.id !== id || item.kind !== "entry") return item;
            const { parentId: previousParent, ...entry } = item;
            return parentId ? { ...entry, parentId } : entry;
        });
        changed();
    }

    function siblingIndex(id: string, direction: -1 | 1): number {
        const index = draft.findIndex((item) => item.id === id);
        const item = draft[index];
        if (!item) return -1;
        const parentId = item.kind === "entry" ? item.parentId : undefined;
        for (let next = index + direction; next >= 0 && next < draft.length; next += direction) {
            const candidate = draft[next];
            if ((candidate.kind === "entry" ? candidate.parentId : undefined) === parentId) return next;
        }
        return -1;
    }

    function move(id: string, direction: -1 | 1): void {
        if (!editing || blocked) return;
        const from = draft.findIndex((item) => item.id === id);
        const to = siblingIndex(id, direction);
        if (from < 0 || to < 0) return;
        const next = [...draft];
        [next[from], next[to]] = [next[to], next[from]];
        draft = next;
        changed();
    }

    function requestDelete(id: string): void {
        if (!editing || blocked || !draft.some((item) => item.id === id)) return;
        pendingDeleteId = id;
        errorText = "";
        statusText = "";
    }

    function confirmDelete(keepChildren: boolean): void {
        if (!editing || busy || !pendingDelete) return;
        const target = pendingDelete;
        // 草稿可含尚未填名称的条目；删除时保留其余原始输入，统一在保存时校验。
        draft = draft.flatMap((item): PersonField[] => {
            if (item.id === target.id) return [];
            if (target.kind === "group" && item.kind === "entry" && item.parentId === target.id) {
                if (!keepChildren) return [];
                const { parentId, ...entry } = item;
                return [entry];
            }
            return [item];
        });
        pendingDeleteId = "";
        changed();
    }

    function resetDraft(): void {
        draft = copyItems(baseline?.snapshot.items ?? []);
        editing = false;
        pendingDeleteId = "";
        attemptedValidation = false;
        errorText = "";
        statusText = "";
        editRevision += 1;
    }

    async function cancelEditing(): Promise<void> {
        const docId = personDocId;
        const request = generation;
        await guardedLeave(() => { if (current(docId, request)) resetDraft(); });
    }

    async function reread(): Promise<void> {
        const docId = personDocId;
        const request = generation;
        await guardedLeave(() => {
            if (!current(docId, request)) return;
            resetDraft();
            void load(docId);
        });
    }

    async function save(rethrow = false): Promise<void> {
        if (busy || !baseline || !editing || pendingDeleteId) {
            if (rethrow) {
                const error = new Error(pendingDeleteId ? "请先确认或取消删除，再保存补充资料" : "补充资料当前尚不能保存，请先完成当前操作");
                errorText = error.message;
                await focusResult(personDocId, generation, editRevision);
                throw error;
            }
            return;
        }
        const docId = personDocId;
        const request = generation;
        const edit = editRevision;
        attemptedValidation = true;
        errorText = "";
        statusText = "";
        try {
            const desired = normalizePersonFields({ schemaVersion: 1, ownerDocId: docId, items: copyItems(draft) }, docId);
            const expected = checkedState(baseline, docId);
            // 请求意图在 await 前固定，不能用回调可能修改过的参数重新定义成功。
            const desiredKey = personFieldsKey(desired);
            const expectedBlockId = expected.blockId;
            saving = true;
            const saved = checkedState(await onSave(docId, desired, expected), docId);
            if (!current(docId, request, edit)) throw new Error("补充资料保存结果已过期，请重新读取核对");
            if (!saved.blockId || expectedBlockId && saved.blockId !== expectedBlockId
                || personFieldsKey(saved.snapshot) !== desiredKey) {
                throw new Error("补充资料保存结果与本次请求不一致，草稿已保留；请重新读取并核对原文");
            }
            baseline = saved;
            draft = copyItems(saved.snapshot.items);
            editing = false;
            attemptedValidation = false;
            pendingDeleteId = "";
            statusText = "补充资料已保存";
            externalChanged = false;
        } catch (error) {
            if (current(docId, request, edit)) errorText = requestErrorMessage(error);
            if (rethrow) throw error;
        } finally {
            if (current(docId, request, edit)) {
                saving = false;
                if (errorText || statusText) await focusResult(docId, request, edit);
            }
        }
    }
</script>

{#snippet readonlyValue(item: Extract<PersonField, { kind: "entry" }>)}
    <div class="lvct-person-fields__content" data-field-content={item.id}>{item.value || "（空）"}</div>
    {#if item.value.length > 0}
        <div class="lvct-person-fields__copy-actions">
            <button type="button" class="b3-button b3-button--text" data-copy-field-id={item.id} aria-label={`复制${item.label}的内容`} disabled={busy || copyInFlight} onclick={() => void copyValue(item.id)}>{copyPendingId === item.id ? "复制中…" : "复制内容"}</button>
        </div>
    {/if}
    {#if copyResultId === item.id}
        {#if copyErrorText}<p class="lvct-person-fields__copy-error" role="alert">{copyErrorText}</p>
        {:else if copyStatusText}<p class="lvct-person-fields__copy-status" role="status" aria-atomic="true">{copyStatusText}</p>{/if}
    {/if}
{/snippet}

<section class="lvct-detail__section lvct-person-fields" bind:this={editorElement} aria-busy={busy}>
    <div class="lvct-person-fields__heading">
        <h4>补充资料</h4>
        {#if baseline && !editing && !loading}
            <button type="button" class="b3-button b3-button--text" disabled={busy} onclick={() => beginEditing()}>编辑补充资料</button>
        {/if}
    </div>
    <p class="ft__smaller ft__on-surface">可添加同名的多条资料，用分组整理为两层。这些资料随人物文档备份；暂不用于快捷联系、全局搜索、通讯录导出或插件迁移包。</p>
    {#if externalChanged}
        <p class="lvct-person-fields__notice" role="status">资料有新变化，当前草稿已保留；保存时会核对原资料，也可重新读取后再编辑。</p>
    {/if}
    {#if errorText}
        <div class="lvct-form__error" role="alert" tabindex="-1" bind:this={resultElement}>
            <p>{errorText}</p>
            {#if emptyLabels.length > 0}
                <ul>{#each emptyLabels as item (item.id)}<li><a href={`#${componentId}-${item.id}-label`}>{item.kind === "group" ? "请填写分组名称" : "请填写条目名称"}</a></li>{/each}</ul>
            {/if}
            {#if editing}<p>草稿已保留。可修改后再次保存，或重新读取核对；重新读取前可选择保存或放弃草稿。</p>{/if}
        </div>
    {:else if statusText}
        <p class="lvct-person-fields__result" role="status" tabindex="-1" bind:this={resultElement}>{statusText}</p>
    {/if}
    {#if loading}
        <p role="status">正在读取补充资料…</p>
    {:else if baseline}
        {#if editing}
            <p class="ft__smaller">名称必填，内容可留空；最多 {MAX_PERSON_FIELDS_ITEMS} 项（含分组），当前 {draft.length} 项。修改在保存后写入人物文档。</p>
            <div class="lvct-person-fields__editor">
                {#each draft as item (item.id)}
                    <div class="lvct-person-fields__item" data-field-id={item.id} data-field-kind={item.kind}>
                        <div class="lvct-person-fields__item-heading"><strong>{item.kind === "group" ? "分组" : "条目"}</strong>
                            <div class="lvct-person-fields__item-actions">
                                <button type="button" class="b3-button b3-button--text" aria-label={`上移${item.label || (item.kind === "group" ? "分组" : "条目")}`} disabled={blocked || siblingIndex(item.id, -1) < 0} onclick={() => move(item.id, -1)}>上移</button>
                                <button type="button" class="b3-button b3-button--text" aria-label={`下移${item.label || (item.kind === "group" ? "分组" : "条目")}`} disabled={blocked || siblingIndex(item.id, 1) < 0} onclick={() => move(item.id, 1)}>下移</button>
                                <button type="button" class="b3-button b3-button--text" disabled={blocked} onclick={() => requestDelete(item.id)}>删除</button>
                            </div>
                        </div>
                        <label class="lvct-field__row" for={`${componentId}-${item.id}-label`}><span>{item.kind === "group" ? "分组名称" : "条目名称"}（必填）</span>
                            <input id={`${componentId}-${item.id}-label`} class="b3-text-field" type="text" value={item.label} maxlength={MAX_PERSON_FIELD_LABEL_LENGTH} aria-label={item.kind === "group" ? "分组名称" : "条目名称"} aria-invalid={attemptedValidation && !item.label.trim()} aria-describedby={attemptedValidation && !item.label.trim() ? `${componentId}-${item.id}-error` : undefined} required disabled={blocked} oninput={(event) => updateLabel(item.id, event.currentTarget.value)} />
                            {#if attemptedValidation && !item.label.trim()}<small id={`${componentId}-${item.id}-error`} class="lvct-form__error">名称不能为空。</small>{/if}
                        </label>
                        {#if item.kind === "entry"}
                            <label class="lvct-field__row" for={`${componentId}-${item.id}-value`}><span>内容</span>
                                <textarea id={`${componentId}-${item.id}-value`} class="b3-text-field" rows="3" value={item.value} maxlength={MAX_PERSON_FIELD_VALUE_LENGTH} aria-label="内容" disabled={blocked} oninput={(event) => updateValue(item.id, event.currentTarget.value)}></textarea>
                            </label>
                            <label class="lvct-field__row" for={`${componentId}-${item.id}-parent`}><span>所属分组</span>
                                <select id={`${componentId}-${item.id}-parent`} class="b3-select" value={item.parentId ?? ""} aria-label="所属分组" disabled={blocked} onchange={(event) => updateParent(item.id, event.currentTarget.value)}>
                                    <option value="">不分组</option>
                                    {#each groups as group (group.id)}<option value={group.id}>{group.label || "未命名分组"}</option>{/each}
                                </select>
                            </label>
                        {/if}
                        {#if pendingDeleteId === item.id}
                            <div class="lvct-person-fields__confirm" role="group" aria-label={item.kind === "group" ? "确认删除分组" : "确认删除资料条目"}>
                                {#if item.kind === "group"}
                                    <p>删除“{item.label || "未命名分组"}”时，如何处理其中的 {draft.filter((child) => child.kind === "entry" && child.parentId === item.id).length} 条资料？选择后仍需保存补充资料。</p>
                                    <div class="lvct-person-fields__actions">
                                        <button type="button" class="b3-button b3-button--outline" disabled={busy} onclick={() => confirmDelete(true)}>保留子条目（解除分组）</button>
                                        <button type="button" class="b3-button b3-button--cancel" disabled={busy} onclick={() => confirmDelete(false)}>连同子条目删除</button>
                                        <button type="button" class="b3-button b3-button--text" disabled={busy} onclick={() => pendingDeleteId = ""}>取消</button>
                                    </div>
                                {:else}
                                    <p>从草稿中删除“{item.label || "未命名条目"}”？保存前仍可取消整份修改。</p>
                                    <div class="lvct-person-fields__actions">
                                        <button type="button" class="b3-button b3-button--cancel" disabled={busy} onclick={() => confirmDelete(false)}>确认删除条目</button>
                                        <button type="button" class="b3-button b3-button--text" disabled={busy} onclick={() => pendingDeleteId = ""}>取消</button>
                                    </div>
                                {/if}
                            </div>
                        {/if}
                    </div>
                {/each}
            </div>
            <div class="lvct-person-fields__actions">
                <button type="button" class="b3-button b3-button--outline" disabled={blocked || draft.length >= MAX_PERSON_FIELDS_ITEMS} onclick={() => void add("entry")}>添加资料条目</button>
                <button type="button" class="b3-button b3-button--outline" disabled={blocked || draft.length >= MAX_PERSON_FIELDS_ITEMS} onclick={() => void add("group")}>添加分组</button>
                <button type="button" class="b3-button b3-button--text" disabled={blocked || !dirty} onclick={() => void save()}>{saving ? "保存中…" : "保存补充资料"}</button>
                <button type="button" class="b3-button b3-button--cancel" disabled={busy} onclick={() => void cancelEditing()}>取消编辑</button>
            </div>
        {:else if baseline.snapshot.items.length === 0}
            <p class="ft__smaller ft__on-surface">还没有补充资料。可添加多个电话、地址、家庭信息等自定义条目。</p>
            <button type="button" class="b3-button b3-button--outline" disabled={busy} onclick={() => void add("entry")}>添加资料条目</button>
        {:else}
            <div class="lvct-person-fields__filter">
                <label class="lvct-field__row" for={`${componentId}-filter`}><span>筛选补充资料</span>
                    <input id={`${componentId}-filter`} class="b3-text-field" type="search" aria-label="筛选补充资料" placeholder="名称、分组或内容" value={filterQuery} oninput={(event) => changeFilter(event.currentTarget.value)} />
                </label>
                <div class="lvct-person-fields__filter-actions">
                    <p class="ft__smaller ft__on-surface" role="status" aria-atomic="true">{filterQuery.trim() ? `找到 ${filtered.matchedEntryCount} / ${totalEntryCount} 条资料` : `共 ${totalEntryCount} 条资料`}</p>
                    {#if filterQuery}<button type="button" class="b3-button b3-button--text" onclick={() => changeFilter("")}>清空筛选</button>{/if}
                </div>
            </div>
            {#if copyInFlight && !copyPendingId}<p class="ft__smaller ft__on-surface" role="status">正在完成复制，请稍候再复制。</p>{/if}
            {#if filtered.items.length === 0}<p class="ft__smaller ft__on-surface">没有匹配的补充资料，请更换关键词或清空筛选。</p>{/if}
            <div class="lvct-person-fields__list">
                {#each filtered.items.filter((item) => item.kind === "group" || !item.parentId) as item (item.id)}
                    {#if item.kind === "group"}
                        <div class="lvct-person-fields__group">
                            <h5>{item.label}</h5>
                            <dl class="lvct-person-fields__values">
                                {#each filtered.items.filter((child) => child.kind === "entry" && child.parentId === item.id) as child (child.id)}
                                    {#if child.kind === "entry"}<div class="lvct-person-fields__value" data-field-id={child.id}><dt>{child.label}</dt><dd>{@render readonlyValue(child)}</dd></div>{/if}
                                {/each}
                            </dl>
                            {#if !filtered.items.some((child) => child.kind === "entry" && child.parentId === item.id)}<p class="ft__smaller ft__on-surface">分组中还没有条目。</p>{/if}
                        </div>
                    {:else}
                        <dl class="lvct-person-fields__values"><div class="lvct-person-fields__value" data-field-id={item.id}><dt>{item.label}</dt><dd>{@render readonlyValue(item)}</dd></div></dl>
                    {/if}
                {/each}
            </div>
        {/if}
    {/if}
    <div class="lvct-person-fields__actions lvct-person-fields__recovery">
        <button type="button" class="b3-button b3-button--text" disabled={busy} onclick={() => void reread()}>重新读取</button>
        {#if onOpenDocument}<button type="button" class="b3-button b3-button--text" disabled={busy} onclick={onOpenDocument}>打开人物文档</button>{/if}
    </div>
</section>

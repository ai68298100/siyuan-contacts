<script lang="ts">
    /** 从笔记捕获人脉：识别出链联系人 + 新人收编 + 共同交集（互动事件）+ 参与人区块 */
    import { toLocalDateKey } from "../../domain/interactions";
    import type { CapturePreview, CaptureResult } from "../../services/capture";
    import type { ContactsPluginFacade } from "../../types";

    let {
        facade,
        docId,
        onClose,
    }: {
        facade: ContactsPluginFacade;
        docId: string;
        onClose: () => void;
    } = $props();

    let preview: CapturePreview | null = $state(null);
    let checked: Record<string, boolean> = $state({});
    let newNamesText: string = $state("");
    let date: string = $state(toLocalDateKey());
    let place: string = $state("");
    let note: string = $state("");
    let running: boolean = $state(false);
    let errorText: string = $state("");
    let result: CaptureResult | null = $state(null);
    let loadError: string = $state("");

    const checkedIds = $derived(Object.entries(checked).filter(([, on]) => on).map(([id]) => id));
    const hasTarget = $derived(checkedIds.length > 0 || newNamesText.trim().length > 0);

    async function load() {
        try {
            preview = await facade.previewCapture(docId);
            const initial: Record<string, boolean> = {};
            for (const person of preview.linked) initial[person.docId] = true;
            checked = initial;
        } catch (error) {
            loadError = error instanceof Error ? error.message : String(error);
        }
    }

    load();

    async function submit() {
        if (running || !hasTarget) return;
        running = true;
        errorText = "";
        try {
            const newNames = newNamesText.split(/[，,、\s]+/).map((name) => name.trim()).filter((name) => name.length > 0);
            result = await facade.captureDoc(docId, {
                personDocIds: checkedIds,
                newNames,
                date: date || toLocalDateKey(),
                place: place.trim() || undefined,
                note: note.trim() || undefined,
            });
        } catch (error) {
            errorText = error instanceof Error ? error.message : String(error);
        } finally {
            running = false;
        }
    }
</script>

<div class="lvct-form">
    {#if loadError}
        <div class="lvct-form__error">{loadError}</div>
    {:else if !preview}
        <div class="lvct-placeholder">分析笔记中…</div>
    {:else if result}
        <div class="lvct-form__hint">
            <p>✕ 已记录 <b>{result.interactions}</b> 条互动</p>
            {#if result.createdNames.length > 0}<p>✦ 新增联系人：{result.createdNames.join("、")}</p>{/if}
            {#if result.attendeeBlockWritten}<p>✦ 笔记已写入「参与人员」双链区块</p>{/if}
            <p class="ft__smaller ft__on-surface">同一篇笔记重复捕获不会重复记录。</p>
        </div>
        <div class="lvct-form__actions">
            <button class="b3-button b3-button--text" onclick={onClose}>完成</button>
        </div>
    {:else}
        <p class="ft__smaller ft__on-surface lvct-form__hint">
            笔记：{preview.docName || docId}
        </p>

        <div class="lvct-form__item">
            <span>已识别的人脉联系人（{preview.linked.length}，来自笔记内双链）</span>
            {#if preview.linked.length === 0}
                <p class="ft__smaller ft__on-surface">
                    本笔记没有链接到任何联系人。可先在笔记里用 <code>[[姓名]]</code> 链接联系人，或在下方直接输入新人名单。
                </p>
            {:else}
                <div class="lvct-capture__list">
                    {#each preview.linked as person (person.docId)}
                        <label class="lvct-import__row">
                            <input class="b3-switch" type="checkbox" bind:checked={checked[person.docId]} />
                            <span><b>{person.name}</b></span>
                            <span class="ft__smaller ft__on-surface">{person.group || "未分组"}</span>
                        </label>
                    {/each}
                </div>
            {/if}
        </div>

        <label class="lvct-form__item">
            <span>新人员名单（不在人脉库中，将按名新建；空格/逗号分隔）</span>
            <input class="b3-text-field fn__block" type="text" bind:value={newNamesText} placeholder="王五 赵六" />
        </label>

        <div class="lvct-form__grid">
            <label class="lvct-form__item">
                <span>场合日期</span>
                <input class="b3-text-field fn__block" type="date" bind:value={date} />
            </label>
            <label class="lvct-form__item">
                <span>地点（可选）</span>
                <input class="b3-text-field fn__block" type="text" bind:value={place} placeholder="会议室 / 餐厅…" />
            </label>
        </div>
        <label class="lvct-form__item">
            <span>备注（可选）</span>
            <input class="b3-text-field fn__block" type="text" bind:value={note} placeholder="产品发布会" />
        </label>

        {#if errorText}
            <div class="lvct-form__error">{errorText}</div>
        {/if}

        <div class="lvct-form__actions">
            <button class="b3-button b3-button--cancel" onclick={onClose}>取消</button>
            <button class="b3-button b3-button--text" onclick={submit} disabled={running || !hasTarget}>
                {running ? "记录中…" : "记录互动并写入参与人员"}
            </button>
        </div>
        <p class="ft__smaller ft__on-surface lvct-form__hint">
            将为每位参与者记录一条互动（含时间/地点/备注），并在本笔记末尾写入「参与人员」双链区块。
        </p>
    {/if}
</div>

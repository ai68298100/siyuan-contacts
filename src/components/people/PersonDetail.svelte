<script lang="ts">
    /** 人物详情弹窗：档案字段 + 关系列表（增删，内核自动维护双向回链） */
    import { listContacts } from "../../services/contacts";
    import { addRelation, removeRelation, refreshPerson } from "../../services/relations";
    import type { ContactSummary } from "../../domain/person";
    import type { ContactsSettings } from "../../domain/model";

    let {
        settings,
        person,
        onRecord,
        onOpenPersonDoc,
        onChanged,
        onClose,
    }: {
        settings: ContactsSettings;
        person: ContactSummary;
        /** 记一笔互动（facade.recordInteraction） */
        onRecord: (personDocId: string, note?: string) => Promise<void>;
        onOpenPersonDoc: (docId: string) => void;
        onChanged: () => void;
        onClose: () => void;
    } = $props();

    // 有意取打开弹窗时的快照；后续更新走 refreshPerson 回查
    // svelte-ignore state_referenced_locally
    let current: ContactSummary = $state(person);
    let others: ContactSummary[] = $state([]);
    let addChoice: string = $state("");
    let busy: boolean = $state(false);
    let errorText: string = $state("");
    let noteText: string = $state("");
    let recorded: boolean = $state(false);

    const relatedPeople = $derived(
        current.relatedItemIds
            .map((itemId) => others.find((item) => item.itemId === itemId))
            .filter((item): item is ContactSummary => Boolean(item)),
    );
    const candidates = $derived(
        others.filter((item) => item.itemId !== current.itemId && !current.relatedItemIds.includes(item.itemId)),
    );

    async function loadOthers() {
        const people = await listContacts(settings, "");
        others = people;
        const fresh = people.find((item) => item.itemId === current.itemId);
        if (fresh) current = fresh;
    }

    loadOthers();

    async function mutate(action: () => Promise<void>) {
        if (busy) return;
        busy = true;
        errorText = "";
        try {
            await action();
            const fresh = await refreshPerson(settings, current);
            if (fresh) current = fresh;
            onChanged();
        } catch (error) {
            errorText = error instanceof Error ? error.message : String(error);
        } finally {
            busy = false;
        }
    }
</script>

<div class="lvct-detail">
    <div class="lvct-detail__header">
        <div class="lvct-person-card__avatar" data-avatar>{current.name.slice(0, 1)}</div>
        <div>
            <h3>{current.name}</h3>
            <div class="ft__smaller ft__on-surface">
                {#if current.group}{current.group}{/if}
                {#if current.birthday} · 生日 {current.birthday}{current.isLunar ? "（农历）" : ""}{/if}
            </div>
        </div>
    </div>

    <dl class="lvct-detail__fields">
        {#if current.phone}<div><dt>电话</dt><dd><a href={`tel:${current.phone}`}>{current.phone}</a></dd></div>{/if}
        {#if current.email}<div><dt>邮箱</dt><dd><a href={`mailto:${current.email}`}>{current.email}</a></dd></div>{/if}
        {#if current.wechat}<div><dt>微信</dt><dd>{current.wechat}</dd></div>{/if}
        {#if current.website}<div><dt>网站</dt><dd>{current.website}</dd></div>{/if}
        {#if current.tags.length > 0}<div><dt>标签</dt><dd>{current.tags.join(" · ")}</dd></div>{/if}
    </dl>

    <section class="lvct-detail__section">
        <h4>记一笔互动</h4>
        <div class="lvct-detail__record fn__flex">
            <input
                class="b3-text-field fn__flex-1"
                type="text"
                placeholder="做了什么、聊了什么（可留空）"
                bind:value={noteText}
                disabled={busy}
            />
            <button
                class="b3-button b3-button--text"
                disabled={busy || recorded}
                onclick={() =>
                    mutate(async () => {
                        await onRecord(current.docId, noteText.trim() || undefined);
                        recorded = true;
                        noteText = "";
                    })}
            >{recorded ? "已记录 ✓" : "记录"}</button>
        </div>
        <p class="ft__smaller ft__on-surface">记录后，首页"久未联系"会重新计时。</p>
    </section>

    <section class="lvct-detail__section">
        <h4>相关人（{relatedPeople.length}）</h4>
        {#if relatedPeople.length === 0}
            <p class="ft__smaller ft__on-surface">还没有建立关系。</p>
        {:else}
            <div class="lvct-detail__relations">
                {#each relatedPeople as other (other.itemId)}
                    <span class="lvct-detail__relation">
                        <button class="lvct-detail__relation-name" onclick={() => { onOpenPersonDoc(other.docId); }}>{other.name}</button>
                        <button
                            class="lvct-detail__relation-remove"
                            title="解除关系"
                            disabled={busy}
                            onclick={() => mutate(() => removeRelation(settings, current, other))}
                        >×</button>
                    </span>
                {/each}
            </div>
        {/if}

        <div class="lvct-detail__add fn__flex">
            <select class="b3-select fn__flex-1" bind:value={addChoice} disabled={busy || candidates.length === 0}>
                <option value="" disabled>{candidates.length === 0 ? "没有可添加的联系人" : "选择联系人…"}</option>
                {#each candidates as candidate (candidate.itemId)}
                    <option value={candidate.itemId}>{candidate.name}</option>
                {/each}
            </select>
            <button
                class="b3-button b3-button--text"
                disabled={busy || !addChoice}
                onclick={() => {
                    const other = others.find((item) => item.itemId === addChoice);
                    if (other) mutate(() => addRelation(settings, current, other));
                    addChoice = "";
                }}
            >添加关系</button>
        </div>
        <p class="ft__smaller ft__on-surface">关系为双向：添加后对方的「被相关人」列会自动出现你。</p>
    </section>

    {#if errorText}
        <div class="lvct-form__error">{errorText}</div>
    {/if}

    <div class="lvct-form__actions">
        <button class="b3-button b3-button--cancel" onclick={onClose}>关闭</button>
        <button class="b3-button b3-button--text" onclick={() => onOpenPersonDoc(current.docId)}>打开文档</button>
    </div>
</div>

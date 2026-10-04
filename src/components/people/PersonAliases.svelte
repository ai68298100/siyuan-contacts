<script lang="ts">
    import { onDestroy, untrack } from "svelte";
    import { useCloseGuard } from "../close-guard";
    import { translateText } from "../../domain/translation";
    import type { PersonAlias } from "../../domain/person-aliases";

    let {
        personDocId,
        i18n,
        onLoad,
        onAdd,
        onRemove,
        onChanged,
    }: {
        personDocId: string;
        i18n?: Readonly<Record<string, string>>;
        onLoad: (personDocId: string) => Promise<PersonAlias[]>;
        onAdd: (personDocId: string, alias: string) => Promise<PersonAlias>;
        onRemove: (id: string) => Promise<void>;
        onChanged: () => void;
    } = $props();

    const text = $derived.by(() => (key: string, fallback: string, values?: Record<string, string | number>) =>
        translateText(i18n, key, fallback, values));
    let aliases: PersonAlias[] = $state([]);
    let aliasDraft = $state("");
    let loading = $state(true);
    let busy = $state(false);
    let errorText = $state("");
    let readFailed = $state(false);
    let loadGeneration = 0;
    let personGeneration = 0;
    let alive = true;
    useCloseGuard({
        busy: () => busy,
        dirty: () => aliasDraft.trim().length > 0,
        changes: () => [text("personAliasesUnsavedDraft", "人物别名有未保存的输入")],
    });
    onDestroy(() => { alive = false; loadGeneration += 1; });

    async function load(docId = personDocId): Promise<void> {
        const generation = ++loadGeneration;
        loading = true;
        errorText = "";
        readFailed = false;
        try {
            const loaded = await onLoad(docId);
            if (!alive || generation !== loadGeneration || docId !== personDocId) return;
            if (loaded.some((alias) => alias.personDocId !== docId)) throw new Error("别名读取结果包含其他人物，未自动显示");
            aliases = loaded;
        } catch (error) {
            if (!alive || generation !== loadGeneration || docId !== personDocId) return;
            readFailed = true;
            errorText = error instanceof Error ? error.message : String(error);
        } finally {
            if (alive && generation === loadGeneration && docId === personDocId) loading = false;
        }
    }

    $effect(() => {
        const docId = personDocId;
        untrack(() => {
            personGeneration += 1;
            aliases = [];
            aliasDraft = "";
            busy = false;
            void load(docId);
        });
    });

    async function add(): Promise<void> {
        const alias = aliasDraft.trim();
        if (!alias || busy || loading || readFailed) return;
        busy = true;
        errorText = "";
        const docId = personDocId;
        const generation = personGeneration;
        try {
            const created = await onAdd(docId, alias);
            if (!alive || generation !== personGeneration || docId !== personDocId) return;
            if (created.personDocId !== docId) throw new Error("新增别名归属不一致，请核对保存结果");
            aliases = [...aliases.filter((item) => item.id !== created.id), created].sort((left, right) => left.alias.localeCompare(right.alias, "zh-CN"));
            aliasDraft = "";
            onChanged();
        } catch (error) {
            if (!alive || generation !== personGeneration || docId !== personDocId) return;
            errorText = error instanceof Error ? error.message : String(error);
        } finally {
            if (alive && generation === personGeneration && docId === personDocId) busy = false;
        }
    }

    async function remove(id: string): Promise<void> {
        if (busy || loading || readFailed) return;
        busy = true;
        errorText = "";
        const docId = personDocId;
        const generation = personGeneration;
        try {
            await onRemove(id);
            if (!alive || generation !== personGeneration || docId !== personDocId) return;
            aliases = aliases.filter((item) => item.id !== id);
            onChanged();
        } catch (error) {
            if (!alive || generation !== personGeneration || docId !== personDocId) return;
            errorText = error instanceof Error ? error.message : String(error);
        } finally {
            if (alive && generation === personGeneration && docId === personDocId) busy = false;
        }
    }
</script>

<section class="lvct-detail__section lvct-person-aliases">
    <h4>{text("personAliasesTitle", "称呼与别名")}</h4>
    <p class="ft__smaller ft__on-surface">{text("personAliasesHint", "别名用于识别笔记中的称呼并关联到此人；“王总”等泛称不会被接受。")}</p>
    {#if errorText}<div class="lvct-form__error" role="alert">{errorText}</div>{/if}
    {#if loading}
        <p class="ft__smaller ft__on-surface">{text("personAliasesLoading", "正在加载别名…")}</p>
    {:else if readFailed}
        <button type="button" class="b3-button b3-button--outline" onclick={() => void load()} disabled={busy}>{text("retryLoad", "重新读取")}</button>
    {:else if aliases.length > 0}
        <div class="lvct-person-aliases__list">
            {#each aliases as item (item.id)}
                <span class="lvct-person-aliases__item">
                    <span>{item.alias}</span>
                    <button type="button" class="b3-button b3-button--text" disabled={busy} onclick={() => void remove(item.id)}>
                        {text("personAliasesRemove", "删除")}
                    </button>
                </span>
            {/each}
        </div>
    {:else}
        <p class="ft__smaller ft__on-surface">{text("personAliasesEmpty", "还没有设置别名。")}</p>
    {/if}
    <div class="lvct-detail__record fn__flex">
        <input
            class="b3-text-field fn__flex-1"
            type="text"
            bind:value={aliasDraft}
            placeholder={text("personAliasesPlaceholder", "例如：老张、英文名")}
            aria-label={text("personAliasesInputLabel", "新增别名")}
            disabled={busy}
            onkeydown={(event) => { if (event.key === "Enter") void add(); }}
        />
        <button type="button" class="b3-button b3-button--text" disabled={busy || loading || readFailed || !aliasDraft.trim()} onclick={() => void add()}>
            {busy ? text("personAliasesSaving", "保存中…") : text("personAliasesAdd", "添加")}
        </button>
    </div>
</section>

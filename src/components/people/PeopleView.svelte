<script lang="ts">
    /** 联系人视图：名册缓存 + 客户端过滤/分页 + 卡片/表格双形态；详情弹窗由 Workbench 统一承载 */
    import { listContacts, filterContacts, PAGE_SIZE } from "../../services/contacts";
    import type { ContactSummary } from "../../domain/person";
    import type { ContactsSettings } from "../../domain/model";
    import PersonCard from "./PersonCard.svelte";
    import AddPersonDialog from "./AddPersonDialog.svelte";
    import ImportDialog from "./ImportDialog.svelte";

    let {
        settings,
        onOpenPersonDoc,
        onOpenDetail,
    }: {
        settings: ContactsSettings;
        onOpenPersonDoc: (docId: string) => void;
        onOpenDetail: (person: ContactSummary) => void;
    } = $props();

    let people: ContactSummary[] = $state([]);
    let loading: boolean = $state(true);
    let errorText: string = $state("");
    let searchText: string = $state("");
    let groupFilter: string = $state("");
    let viewMode: "cards" | "table" = $state("cards");
    let adding: boolean = $state(false);
    let importing: boolean = $state(false);
    let visibleCount: number = $state(PAGE_SIZE);

    const groups = $derived.by(() => {
        const set = new Set<string>();
        for (const person of people) {
            if (person.group) set.add(person.group);
        }
        return [...set].sort();
    });

    const filtered = $derived(filterContacts(people, searchText, groupFilter));
    const visible = $derived(filtered.slice(0, visibleCount));

    async function refresh() {
        loading = true;
        errorText = "";
        try {
            people = await listContacts(settings);
        } catch (error) {
            errorText = error instanceof Error ? error.message : String(error);
        } finally {
            loading = false;
        }
    }

    refresh();
</script>

<div class="lvct-people">
    <div class="lvct-people__toolbar fn__flex">
        <input
            class="b3-text-field fn__flex-1"
            type="text"
            placeholder="搜索姓名/电话/微信/邮箱/标签…"
            bind:value={searchText}
        />
        <select class="b3-select" bind:value={groupFilter} onchange={() => (visibleCount = PAGE_SIZE)}>
            <option value="">全部分组</option>
            {#each groups as group (group)}
                <option value={group}>{group}</option>
            {/each}
        </select>
        <button
            class="b3-button b3-button--outline"
            title="切换卡片/表格"
            onclick={() => (viewMode = viewMode === "cards" ? "table" : "cards")}
        >
            {viewMode === "cards" ? "表格" : "卡片"}
        </button>
        <button class="b3-button b3-button--outline" onclick={() => (importing = true)}>导入已有文档</button>
        <button class="b3-button b3-button--text" onclick={() => (adding = true)}>新建联系人</button>
    </div>

    {#if errorText}
        <div class="lvct-form__error">加载失败：{errorText}</div>
    {:else if loading}
        <div class="lvct-placeholder">加载中…</div>
    {:else if filtered.length === 0}
        <div class="lvct-placeholder">
            {people.length === 0 ? "还没有联系人：新建或「导入已有文档」开始。" : "当前筛选下没有联系人。"}
        </div>
    {:else if viewMode === "cards"}
        <div class="lvct-people__cards">
            {#each visible as person (person.itemId)}
                <PersonCard {person} onOpen={onOpenDetail} />
            {/each}
        </div>
    {:else}
        <div class="lvct-people__table-wrap">
            <table class="b3-table">
                <thead>
                    <tr><th>姓名</th><th>分组</th><th>电话</th><th>微信</th><th>生日</th><th>标签</th></tr>
                </thead>
                <tbody>
                    {#each visible as person (person.itemId)}
                        <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
                        <tr onclick={() => onOpenPersonDoc(person.docId)}>
                            <td><b>{person.name}</b></td>
                            <td>{person.group || "—"}</td>
                            <td>{person.phone || "—"}</td>
                            <td>{person.wechat || "—"}</td>
                            <td>{person.birthday ? `${person.birthday}${person.isLunar ? "（农历）" : ""}` : "—"}</td>
                            <td>{person.tags.join(" · ") || "—"}</td>
                        </tr>
                    {/each}
                </tbody>
            </table>
        </div>
    {/if}

    {#if filtered.length > visibleCount}
        <button class="b3-button b3-button--outline lvct-people__more" onclick={() => (visibleCount += PAGE_SIZE)}>
            加载更多（已显示 {visible.length} / {filtered.length}）
        </button>
    {/if}

    {#if adding}
        <div class="lvct-dialog-mask" role="presentation" onclick={(event) => { if (event.target === event.currentTarget) adding = false; }}>
            <div class="lvct-dialog-panel">
                <h3 class="lvct-dialog-panel__title">新建联系人</h3>
                <AddPersonDialog
                    {settings}
                    onCreated={() => refresh()}
                    onClose={() => (adding = false)}
                />
            </div>
        </div>
    {/if}

    {#if importing}
        <div class="lvct-dialog-mask" role="presentation" onclick={(event) => { if (event.target === event.currentTarget) importing = false; }}>
            <div class="lvct-dialog-panel lvct-dialog-panel--wide">
                <h3 class="lvct-dialog-panel__title">导入已有文档为联系人</h3>
                <ImportDialog
                    {settings}
                    onImported={(count) => {
                        if (count > 0) refresh();
                    }}
                    onClose={() => (importing = false)}
                />
            </div>
        </div>
    {/if}
</div>

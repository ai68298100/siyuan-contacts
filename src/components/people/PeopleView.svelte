<script lang="ts">
    /** 联系人视图：名册缓存 + 客户端过滤/分页 + 卡片/表格双形态；详情弹窗由 Workbench 统一承载 */
    import { batchUpdateContacts, listContacts, filterContacts, PAGE_SIZE, PRESET_GROUPS, removeContacts } from "../../services/contacts";
    import { exportVcfText } from "../../services/vcard";
    import { nextBirthday } from "../../domain/occasions";
    import type { ContactSummary } from "../../domain/person";
    import type { ContactsSettings } from "../../domain/model";
    import PersonCard from "./PersonCard.svelte";
    import AddPersonDialog from "./AddPersonDialog.svelte";
    import ImportDialog from "./ImportDialog.svelte";
    import VCardDialog from "./VCardDialog.svelte";
    import LvctDialog from "../LvctDialog.svelte";

    let {
        settings,
        loadRecentInteractions,
        revision,
        initialSort,
        focusIds = [],
        focusLabel = "",
        externalSearch = "",
        createRequested = 0,
        onClearFocus,
        onOpenDetail,
        activePersonId = "",
        onOrderChange,
        onOpenPersonDoc,
    }: {
        settings: ContactsSettings;
        loadRecentInteractions: () => Promise<Record<string, { occurredAt: number; localDate: string }>>;
        revision: number;
        initialSort: "name" | "group" | "birthday" | "recent";
        focusIds?: readonly string[];
        focusLabel?: string;
        externalSearch?: string;
        createRequested?: number;
        onClearFocus?: () => void;
        onOpenDetail: (person: ContactSummary) => void;
        activePersonId?: string;
        onOrderChange?: (people: ContactSummary[]) => void;
        onOpenPersonDoc?: (docId: string) => void;
    } = $props();

    let people: ContactSummary[] = $state([]);
    let loading: boolean = $state(true);
    let errorText: string = $state("");
    let searchText: string = $state("");
    $effect(() => { searchText = externalSearch; });
    $effect(() => { if (createRequested > 0) adding = true; });
    let groupFilter: string = $state("");
    let tagFilter: string[] = $state([]);
    // svelte-ignore state_referenced_locally
    let sortMode: "name" | "group" | "birthday" | "recent" = $state(initialSort);
    let recent: Record<string, { occurredAt: number; localDate: string }> = $state({});
    let recentError = $state("");
    let viewMode: "cards" | "table" = $state("cards");
    let adding: boolean = $state(false);
    let importing: boolean = $state(false);
    let vcarding: boolean = $state(false);
    let batchOpen: boolean = $state(false);
    let batchBusy: boolean = $state(false);
    let batchError: string = $state("");
    let batchGroup: string = $state("__keep");
    let batchTagsText: string = $state("");
    let selectedIds: string[] = $state([]);
    let visibleCount: number = $state(PAGE_SIZE);

    const groups = $derived.by(() => {
        const set = new Set<string>();
        for (const person of people) {
            if (person.group) set.add(person.group);
        }
        return [...set].sort();
    });
    const tags = $derived([...new Set(people.flatMap((person) => person.tags))].sort((a, b) => a.localeCompare(b, "zh-CN")));

    const filtered = $derived.by(() => {
        const focus = new Set(focusIds);
        const result = filterContacts(people, searchText, groupFilter)
            .filter((person) => !focusLabel || focus.has(person.itemId))
            .filter((person) => tagFilter.every((tag) => person.tags.includes(tag)));
        const birthdayDays = new Map(result.map((person) => [person.itemId, nextBirthday(person.birthday, person.isLunar)?.daysUntil ?? Infinity]));
        result.sort((a, b) => {
            if (sortMode === "group") return a.group.localeCompare(b.group, "zh-CN") || a.name.localeCompare(b.name, "zh-CN");
            if (sortMode === "birthday") return (birthdayDays.get(a.itemId) ?? Infinity) - (birthdayDays.get(b.itemId) ?? Infinity) || a.name.localeCompare(b.name, "zh-CN");
            if (sortMode === "recent") return (recent[b.docId]?.occurredAt ?? -Infinity) - (recent[a.docId]?.occurredAt ?? -Infinity) || a.name.localeCompare(b.name, "zh-CN");
            return a.name.localeCompare(b.name, "zh-CN");
        });
        return result;
    });
    const visible = $derived(filtered.slice(0, visibleCount));
    $effect(() => { onOrderChange?.(filtered); });
    const selectedPeople = $derived(people.filter((person) => selectedIds.includes(person.itemId)));
    const allVisibleSelected = $derived(visible.length > 0 && visible.every((person) => selectedIds.includes(person.itemId)));

    async function refresh() {
        loading = true;
        errorText = "";
        try {
            people = await listContacts(settings);
            const available = new Set(people.map((person) => person.itemId));
            selectedIds = selectedIds.filter((itemId) => available.has(itemId));
        } catch (error) {
            errorText = error instanceof Error ? error.message : String(error);
        } finally {
            loading = false;
        }
    }

    $effect(() => {
        revision;
        void refresh();
        void loadRecentInteractions().then((value) => { recent = value; recentError = ""; }).catch((error) => { recentError = error instanceof Error ? error.message : String(error); });
    });

    function toggleTag(tag: string) {
        tagFilter = tagFilter.includes(tag) ? tagFilter.filter((item) => item !== tag) : [...tagFilter, tag];
        visibleCount = PAGE_SIZE;
    }

    function toggleSelected(itemId: string, selected: boolean) {
        selectedIds = selected
            ? [...new Set([...selectedIds, itemId])]
            : selectedIds.filter((id) => id !== itemId);
    }

    function toggleAllVisible(selected: boolean) {
        const visibleIds = new Set(visible.map((person) => person.itemId));
        selectedIds = selected
            ? [...new Set([...selectedIds, ...visibleIds])]
            : selectedIds.filter((id) => !visibleIds.has(id));
    }

    function parseTags(value: string): string[] {
        return [...new Set(value.split(/[，,、\s]+/).map((tag) => tag.trim()).filter((tag) => tag.length > 0))];
    }

    async function runBatchUpdate() {
        if (batchBusy) return;
        const tagsToAdd = parseTags(batchTagsText);
        const group = batchGroup === "__keep" ? undefined : batchGroup === "__clear" ? "" : batchGroup;
        if (group === undefined && tagsToAdd.length === 0) {
            batchError = "请选择要修改的分组，或输入至少一个要添加的标签";
            return;
        }
        batchBusy = true;
        batchError = "";
        try {
            await batchUpdateContacts(settings, selectedPeople.map((person) => ({
                itemId: person.itemId,
                ...(group !== undefined ? { group } : {}),
                ...(tagsToAdd.length > 0 ? { tags: [...new Set([...person.tags, ...tagsToAdd])] } : {}),
            })));
            batchOpen = false;
            batchGroup = "__keep";
            batchTagsText = "";
            selectedIds = [];
            await refresh();
        } catch (error) {
            batchError = error instanceof Error ? error.message : String(error);
        } finally {
            batchBusy = false;
        }
    }

    async function exportSelected() {
        if (selectedIds.length === 0) return;
        try {
            const text = await exportVcfText(settings, selectedIds);
            if (!text) return;
            const stamp = new Date().toISOString().slice(0, 10).replaceAll("-", "");
            const blob = new Blob([text], { type: "text/vcard;charset=utf-8" });
            const url = URL.createObjectURL(blob);
            const anchor = document.createElement("a");
            anchor.href = url;
            anchor.download = `小驴人脉_选中_${stamp}.vcf`;
            anchor.click();
            URL.revokeObjectURL(url);
        } catch (error) {
            errorText = error instanceof Error ? error.message : String(error);
        }
    }

    async function removeSelected() {
        if (batchBusy || selectedIds.length === 0) return;
        const names = selectedPeople.map((person) => person.name).slice(0, 5).join("、");
        const suffix = selectedPeople.length > 5 ? ` 等 ${selectedPeople.length} 人` : "";
        if (!window.confirm(`将从人脉名册移除「${names}${suffix}」。人物文档和互动记录会保留，确定继续吗？`)) return;
        batchBusy = true;
        batchError = "";
        try {
            await removeContacts(settings, selectedIds);
            selectedIds = [];
            await refresh();
        } catch (error) {
            batchError = error instanceof Error ? error.message : String(error);
        } finally {
            batchBusy = false;
        }
    }
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
        <select class="b3-select" bind:value={sortMode} aria-label="排序方式" onchange={() => (visibleCount = PAGE_SIZE)}>
            <option value="name">按姓名</option>
            <option value="group">按分组</option>
            <option value="birthday">按生日临近</option>
            <option value="recent">按最近互动</option>
        </select>
        <button
            class="b3-button b3-button--outline"
            title="切换卡片/表格"
            onclick={() => (viewMode = viewMode === "cards" ? "table" : "cards")}
        >
            {viewMode === "cards" ? "表格" : "卡片"}
        </button>
        <button class="b3-button b3-button--outline" onclick={() => (importing = true)}>导入已有文档</button>
        <button class="b3-button b3-button--outline" onclick={() => (vcarding = true)}>vCard 导入/导出</button>
        <button class="b3-button b3-button--text" onclick={() => (adding = true)}>新建联系人</button>
    </div>
    {#if recentError}<div class="lvct-form__error" role="alert">最近互动读取失败：{recentError}</div>{/if}

    {#if tags.length > 0}
        <div class="lvct-people__filters" aria-label="标签筛选">
            <span class="ft__smaller ft__on-surface">标签</span>
            {#each tags as tag (tag)}
                <button type="button" class="lvct-people__filter" class:lvct-people__filter--active={tagFilter.includes(tag)} aria-pressed={tagFilter.includes(tag)} onclick={() => toggleTag(tag)}>{tag}</button>
            {/each}
            {#if tagFilter.length > 0}
                <button type="button" class="lvct-people__filter-clear" onclick={() => { tagFilter = []; visibleCount = PAGE_SIZE; }}>清除筛选</button>
            {/if}
        </div>
    {/if}

    {#if selectedIds.length > 0}
        <div class="lvct-people__batchbar" role="toolbar" aria-label="批量操作">
            <b>已选 {selectedIds.length} 人</b>
            <button class="b3-button b3-button--outline" onclick={() => { batchError = ""; batchOpen = true; }}>批量编辑</button>
            <button class="b3-button b3-button--outline" onclick={exportSelected}>导出 vCard</button>
            <button class="b3-button b3-button--cancel lvct-people__remove" onclick={removeSelected} disabled={batchBusy}>从人脉移除</button>
            <button class="b3-button b3-button--text" onclick={() => (selectedIds = [])}>取消选择</button>
        </div>
    {/if}

    {#if batchError && !batchOpen}
        <div class="lvct-form__error" role="alert">批量操作失败：{batchError}</div>
    {/if}

    {#if focusLabel}
        <div class="lvct-people__focusbar">
            <span>来自首页：{focusLabel}（{filtered.length} 人）</span>
            <button type="button" onclick={onClearFocus}>清除首页筛选</button>
        </div>
    {/if}

    {#if errorText}
        <div class="lvct-form__error">加载失败：{errorText}</div>
    {:else if loading}
        <div class="lvct-people__skeleton" aria-busy="true" aria-label="联系人加载中">
            {#each Array(6) as _, index (index)}
                <div class="lvct-people__skeleton-card">
                    <span class="lvct-skeleton lvct-skeleton--avatar"></span>
                    <span class="lvct-skeleton lvct-skeleton--name"></span>
                    <span class="lvct-skeleton lvct-skeleton--meta"></span>
                </div>
            {/each}
        </div>
    {:else if filtered.length === 0}
        <div class="lvct-empty">
            <div class="lvct-empty__icon" aria-hidden="true">♧</div>
            <b>{people.length === 0 ? "还没有联系人" : "当前筛选下没有联系人"}</b>
            <p>{people.length === 0 ? "从新建第一个联系人开始，也可以收编笔记或导入 vCard。" : "换个关键词、分组或标签试试。"}</p>
            {#if people.length === 0}
                <div class="lvct-empty__actions">
                    <button class="b3-button b3-button--text" onclick={() => (adding = true)}>＋ 新建联系人</button>
                    <button class="b3-button b3-button--outline" onclick={() => (importing = true)}>收编文档</button>
                    <button class="b3-button b3-button--outline" onclick={() => (vcarding = true)}>导入 vCard</button>
                </div>
            {:else}
                <div class="lvct-empty__actions">
                    <button class="b3-button b3-button--outline" onclick={() => {
                        searchText = "";
                        groupFilter = "";
                        tagFilter = [];
                        visibleCount = PAGE_SIZE;
                        onClearFocus?.();
                    }}>清除所有筛选</button>
                </div>
            {/if}
        </div>
    {:else if viewMode === "cards"}
        <div class="lvct-people__cards">
            {#each visible as person (person.itemId)}
                <PersonCard
                    {person}
                    selected={selectedIds.includes(person.itemId)}
                    active={activePersonId === person.itemId}
                    {onOpenPersonDoc}
                    onToggleSelected={(selected) => toggleSelected(person.itemId, selected)}
                    onOpen={onOpenDetail}
                />
            {/each}
        </div>
    {:else}
        <div class="lvct-people__table-wrap">
            <table class="b3-table">
                <thead>
                    <tr>
                        <th class="lvct-people__select-cell">
                            <input type="checkbox" aria-label="选择当前列表联系人" checked={allVisibleSelected} onchange={(event) => toggleAllVisible((event.currentTarget as HTMLInputElement).checked)} />
                        </th>
                        <th>姓名</th><th>分组</th><th>电话</th><th>微信</th><th>生日</th><th>最近互动</th><th>标签</th>
                    </tr>
                </thead>
                <tbody>
                    {#each visible as person (person.itemId)}
                        <tr tabindex="0" aria-label={`查看 ${person.name} 的详情`} class:lvct-people__row--active={activePersonId === person.itemId}
                            onclick={() => onOpenDetail(person)}
                            onkeydown={(event) => {
                                if (event.target !== event.currentTarget || (event.key !== "Enter" && event.key !== " ")) return;
                                event.preventDefault();
                                onOpenDetail(person);
                            }}>
                            <td class="lvct-people__select-cell">
                                <input
                                    type="checkbox"
                                    aria-label={`选择 ${person.name}`}
                                    checked={selectedIds.includes(person.itemId)}
                                    onclick={(event) => event.stopPropagation()}
                                    onchange={(event) => toggleSelected(person.itemId, (event.currentTarget as HTMLInputElement).checked)}
                                />
                            </td>
                            <td><b>{person.name}</b>{#if onOpenPersonDoc}<button type="button" class="lvct-people__open-doc" title={`打开 ${person.name} 的文档`} aria-label={`打开 ${person.name} 的文档`} onclick={(event) => { event.stopPropagation(); onOpenPersonDoc(person.docId); }}>↗</button>{/if}</td>
                            <td>{person.group || "—"}</td>
                            <td>{person.phone || "—"}</td>
                            <td>{person.wechat || "—"}</td>
                            <td>{person.birthday ? `${person.birthday}${person.isLunar ? "（农历）" : ""}` : "—"}</td>
                            <td>{recent[person.docId]?.localDate ?? "—"}</td>
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
        <LvctDialog title="新建联系人" onClose={() => (adding = false)}>
            <AddPersonDialog
                {settings}
                onCreated={() => refresh()}
                onClose={() => (adding = false)}
            />
        </LvctDialog>
    {/if}

    {#if importing}
        <LvctDialog title="导入已有文档为联系人" wide onClose={() => (importing = false)}>
            <ImportDialog
                {settings}
                onImported={(count) => {
                    if (count > 0) refresh();
                }}
                onClose={() => (importing = false)}
            />
        </LvctDialog>
    {/if}

    {#if vcarding}
        <LvctDialog title="vCard 通讯录导入/导出" wide onClose={() => (vcarding = false)}>
            <VCardDialog
                {settings}
                onImported={(count) => {
                    if (count > 0) refresh();
                }}
                onClose={() => (vcarding = false)}
            />
        </LvctDialog>
    {/if}

    {#if batchOpen}
        <LvctDialog title={`批量编辑 · ${selectedIds.length} 人`} onClose={() => (batchOpen = false)}>
            <div class="lvct-form">
                <p class="ft__smaller ft__on-surface">分组会覆盖所选联系人当前值；标签会追加到现有标签并自动去重。</p>
                <label class="lvct-form__item">
                    <span>统一分组</span>
                    <select class="b3-select fn__block" bind:value={batchGroup}>
                        <option value="__keep">保持不变</option>
                        <option value="__clear">清空分组</option>
                        {#each PRESET_GROUPS as group (group)}<option value={group}>{group}</option>{/each}
                        {#each groups.filter((group) => !PRESET_GROUPS.includes(group as typeof PRESET_GROUPS[number])) as group (group)}<option value={group}>{group}</option>{/each}
                    </select>
                </label>
                <label class="lvct-form__item">
                    <span>追加标签（空格/逗号分隔）</span>
                    <input class="b3-text-field fn__block" type="text" bind:value={batchTagsText} placeholder="重点 客户" />
                </label>
                {#if batchError}<div class="lvct-form__error">{batchError}</div>{/if}
                <div class="lvct-form__actions">
                    <button class="b3-button b3-button--cancel" onclick={() => (batchOpen = false)}>取消</button>
                    <button class="b3-button b3-button--text" onclick={runBatchUpdate} disabled={batchBusy}>{batchBusy ? "保存中…" : "应用到所选联系人"}</button>
                </div>
            </div>
        </LvctDialog>
    {/if}
</div>

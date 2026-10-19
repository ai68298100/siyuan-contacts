<script lang="ts">
    /** E-28 跟进列表按人物/当前组织/部门/来源文档分组的多视角总览面板 */
    import type { FollowUpItem } from "../domain/followups";
    import { groupFollowUps, type FollowUpGroup } from "../domain/followups";
    import { translateText } from "../domain/translation";
    import { Layers } from "@lucide/svelte";

    let {
        i18n,
        items,
        personNameByDocId,
        orgNameByDocId,
        departmentByDocId,
        sourceLabelByFollowUpId,
        onOpenPerson,
    }: {
        i18n?: Readonly<Record<string, string>>;
        items: readonly FollowUpItem[];
        personNameByDocId: ReadonlyMap<string, string>;
        orgNameByDocId?: ReadonlyMap<string, string>;
        departmentByDocId?: ReadonlyMap<string, string>;
        sourceLabelByFollowUpId?: ReadonlyMap<string, string>;
        /** 点击条目时按人物文档 ID 打开详情 */
        onOpenPerson?: (docId: string) => void;
    } = $props();

    const text = $derived.by(() => (key: string, fallback: string, values?: Record<string, string | number>) =>
        translateText(i18n, key, fallback, values));

    const groups: FollowUpGroup[] = $derived(groupFollowUps(items, personNameByDocId, {
        orgNameByDocId,
        departmentByDocId,
        sourceLabelByFollowUpId,
    }));
    const openCount = $derived(items.filter((item) => item.status === "open").length);
</script>

<details class="lvct-fu-group" aria-label={text("fuGroupTitle", "按视角分组")}>
    <summary class="lvct-fu-group__summary">
        <Layers size={14}/>
        <span>{text("fuGroupTitle", "按视角分组")}</span>
        <span class="ft__smaller ft__on-surface">
            {text("fuGroupCount", "{open} 条待办 / {total} 条", { open: openCount, total: items.length })}
        </span>
    </summary>
    {#if groups.length === 0}
        <p class="ft__smaller ft__on-surface">{text("fuGroupEmpty", "当前没有可分组的跟进事项。")}</p>
    {:else}
        <div class="lvct-fu-group__list">
            {#each groups as group (group.key + ":" + group.label)}
                <div class="lvct-fu-group__group">
                    <div class="lvct-fu-group__label">
                        {group.label}
                        <span class="lvct-fu-group__badge">{group.items.length}</span>
                    </div>
                    <ul>
                        {#each group.items as item (item.id)}
                            <li>
                                <button
                                    type="button"
                                    class="b3-button b3-button--text"
                                    disabled={!onOpenPerson}
                                    onclick={() => onOpenPerson?.(item.personDocId)}
                                >{personNameByDocId.get(item.personDocId) ?? item.personDocId}</button>
                                <span class="ft__smaller ft__on-surface">{item.title || text("dashKeepInTouch", "保持联系")} · {item.dueDate}</span>
                                <span
                                    class={`lvct-fu-group__status lvct-fu-group__status--${item.status}`}
                                    data-status={item.status}
                                >{item.status === "open" ? text("fuStatusOpen", "待办") : item.status === "done" ? text("fuStatusDone", "已完成") : text("fuStatusCancelled", "已取消")}</span>
                            </li>
                        {/each}
                    </ul>
                </div>
            {/each}
        </div>
    {/if}
</details>

<style>
.lvct-fu-group {
    margin-top: 8px;
    border-top: 1px dashed var(--b3-border-color, rgba(0,0,0,0.08));
    padding-top: 8px;
}
.lvct-fu-group__summary {
    display: flex;
    align-items: center;
    gap: 8px;
    cursor: pointer;
    padding: 4px 0;
}
.lvct-fu-group__list {
    display: flex;
    flex-direction: column;
    gap: 8px;
    margin-top: 4px;
}
.lvct-fu-group__label {
    display: flex;
    align-items: center;
    gap: 6px;
    font-weight: 600;
    font-size: 12px;
}
.lvct-fu-group__badge {
    display: inline-block;
    min-width: 20px;
    text-align: center;
    font-size: 11px;
    font-weight: 600;
    border-radius: 9999px;
    background: color-mix(in srgb, var(--b3-theme-primary) 12%, transparent);
    color: var(--b3-theme-primary);
    padding: 1px 6px;
}
.lvct-fu-group__group ul {
    margin: 2px 0 0 0;
    padding: 0 0 0 14px;
    list-style: none;
}
.lvct-fu-group__group li {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 1px 0;
}
.lvct-fu-group__status {
    font-size: 11px;
    font-weight: 500;
    border-radius: 4px;
    padding: 1px 6px;
}
.lvct-fu-group__status--open { background: color-mix(in srgb, var(--b3-theme-primary) 12%, transparent); color: var(--b3-theme-primary); }
.lvct-fu-group__status--done { background: color-mix(in srgb, var(--b3-theme-success, #4caf7d) 16%, transparent); color: var(--b3-theme-success, #4caf7d); }
.lvct-fu-group__status--cancelled { background: color-mix(in srgb, var(--b3-theme-on-surface-light) 18%, transparent); color: var(--b3-theme-on-surface-light); }
</style>

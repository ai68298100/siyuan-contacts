<script lang="ts">
    /** 联系人卡片（列表默认视图） */
    import type { ContactSummary } from "../../domain/person";

    let {
        person,
        onOpen,
        selected = false,
        active = false,
        onToggleSelected,
        onOpenPersonDoc,
    }: {
        person: ContactSummary;
        onOpen: (person: ContactSummary) => void;
        selected?: boolean;
        active?: boolean;
        onToggleSelected?: (selected: boolean) => void;
        onOpenPersonDoc?: (docId: string) => void;
    } = $props();

    function telHref(phone: string): string {
        return `tel:${phone}`;
    }

    function mailHref(email: string): string {
        return `mailto:${email}`;
    }
</script>

<div class="lvct-person-card" class:lvct-person-card--active={active} role="button" tabindex="0" aria-label={`查看 ${person.name} 的详情`}
    onclick={() => onOpen(person)}
    onkeydown={(event) => {
        if (event.target !== event.currentTarget || (event.key !== "Enter" && event.key !== " ")) return;
        event.preventDefault();
        onOpen(person);
    }}>
    {#if onToggleSelected}
        <input
            class="lvct-person-card__select"
            type="checkbox"
            aria-label={`选择 ${person.name}`}
            checked={selected}
            onclick={(event) => event.stopPropagation()}
            onchange={(event) => onToggleSelected?.((event.currentTarget as HTMLInputElement).checked)}
        />
    {/if}
    <div class="lvct-person-card__avatar" data-group={person.group || "未分组"}>
        {person.name.slice(0, 1)}
    </div>
    <div class="lvct-person-card__main">
        <div class="lvct-person-card__name">
            {person.name}
            {#if person.isLunar}<span class="lvct-chip">农历</span>{/if}
            {#if person.group}<span class="lvct-chip lvct-chip--group">{person.group}</span>{/if}
        </div>
        <div class="lvct-person-card__meta ft__smaller ft__on-surface">
            {#if person.phone}<span class="lvct-person-card__meta-item">
                <a href={telHref(person.phone)} onclick={(event) => event.stopPropagation()}>{person.phone}</a>
            </span>{/if}
            {#if person.email}<span class="lvct-person-card__meta-item">
                <a href={mailHref(person.email)} onclick={(event) => event.stopPropagation()}>{person.email}</a>
            </span>{/if}
            {#if person.wechat}<span class="lvct-person-card__meta-item">微信 {person.wechat}</span>{/if}
            {#if person.birthday}<span class="lvct-person-card__meta-item">生日 {person.birthday}</span>{/if}
            {#if person.tags.length > 0}
                <span class="lvct-person-card__meta-item">{person.tags.join(" · ")}</span>
            {/if}
        </div>
    </div>
    {#if onOpenPersonDoc}<button type="button" class="lvct-person-card__open-doc" title={`打开 ${person.name} 的文档`} aria-label={`打开 ${person.name} 的文档`} onclick={(event) => { event.stopPropagation(); onOpenPersonDoc(person.docId); }}>↗</button>{/if}
</div>

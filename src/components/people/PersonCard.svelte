<script lang="ts">
    /** 联系人卡片（列表默认视图） */
    import type { ContactSummary } from "../../domain/person";

    let {
        person,
        onOpen,
    }: {
        person: ContactSummary;
        onOpen: (person: ContactSummary) => void;
    } = $props();

    function telHref(phone: string): string {
        return `tel:${phone}`;
    }

    function mailHref(email: string): string {
        return `mailto:${email}`;
    }
</script>

<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
<div class="lvct-person-card" onclick={() => onOpen(person)}>
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
            {#if person.phone}<span class="lvct-person-card__meta-item" onclick={(event) => event.stopPropagation()}>
                <a href={telHref(person.phone)} onclick={(event) => event.stopPropagation()}>{person.phone}</a>
            </span>{/if}
            {#if person.email}<span class="lvct-person-card__meta-item" onclick={(event) => event.stopPropagation()}>
                <a href={mailHref(person.email)} onclick={(event) => event.stopPropagation()}>{person.email}</a>
            </span>{/if}
            {#if person.wechat}<span class="lvct-person-card__meta-item">微信 {person.wechat}</span>{/if}
            {#if person.birthday}<span class="lvct-person-card__meta-item">生日 {person.birthday}</span>{/if}
            {#if person.tags.length > 0}
                <span class="lvct-person-card__meta-item">{person.tags.join(" · ")}</span>
            {/if}
        </div>
    </div>
</div>

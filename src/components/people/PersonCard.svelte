<script lang="ts">
    /** 联系人卡片（列表默认视图） */
    import type { ContactSummary } from "../../domain/person";
    import { nextBirthday } from "../../domain/occasions";
    import { formatRelativeInteraction } from "../../domain/format";
    import { ExternalLink, Phone, MessageCircle, Mail, Clock3 } from "@lucide/svelte";
    import PersonProfileSummary from "./PersonProfileSummary.svelte";

    let {
        person,
        onOpen,
        selected = false,
        active = false,
        onToggleSelected,
        onOpenPersonDoc,
        recent,
        orgLine = "",
    }: {
        person: ContactSummary;
        onOpen: (person: ContactSummary) => void;
        selected?: boolean;
        active?: boolean;
        onToggleSelected?: (selected: boolean) => void;
        onOpenPersonDoc?: (docId: string) => void;
        recent?: { occurredAt: number; localDate: string };
        /** B12：单位显示串（组织名 · 部门，来自成员索引投影） */
        orgLine?: string;
    } = $props();

    function telHref(phone: string): string {
        return `tel:${phone}`;
    }

    function mailHref(email: string): string {
        return `mailto:${email}`;
    }
    const birthday = $derived(nextBirthday(person.birthday, person.isLunar));
    const recentLabel = $derived.by(() => {
        if (!recent) return "暂无互动";
        const today = new Date();
        const day = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
        const then = new Date(`${recent.localDate}T00:00:00`).getTime();
        return formatRelativeInteraction(Math.round((day - then) / 86400000));
    });
</script>

<div class="lvct-person-card" class:lvct-person-card--active={active} role="button" tabindex="0" aria-label={`查看 ${person.name} 的详情`}
    onclick={() => onOpen(person)}
    onkeydown={(event) => {
        if (event.target !== event.currentTarget || (event.key !== "Enter" && event.key !== " ")) return;
        event.preventDefault();
        onOpen(person);
    }}>
    <div class="lvct-person-card__top">
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
            {#if person.isSelf}<span class="lvct-chip lvct-bucket--today">本人</span>{/if}
        </div>
        <div class="lvct-person-card__sub">
            {#if birthday}{birthday.label}生日 · {birthday.daysUntil === 0 ? "今天" : `${birthday.daysUntil} 天后`} · {person.isLunar ? "农历" : "公历"}{:else}生日未填写{/if}
        </div>
        {#if person.profile}<PersonProfileSummary profile={person.profile} compact />
        {:else if orgLine}
            <div class="lvct-person-card__org" aria-label="单位">{orgLine}</div>
        {/if}
    </div>
    {#if onOpenPersonDoc}<button type="button" class="lvct-person-card__open-doc" title={`打开 ${person.name} 的文档`} aria-label={`打开 ${person.name} 的文档`} onclick={(event) => { event.stopPropagation(); onOpenPersonDoc(person.docId); }}><ExternalLink size={16}/></button>{/if}
    </div>
    <div class="lvct-person-card__meta">
        {#if person.phone}<div><span aria-hidden="true"><Phone size={13}/></span><a href={telHref(person.phone)} onclick={(event) => event.stopPropagation()}>{person.phone}</a></div>{/if}
        {#if person.wechat}<div><span aria-hidden="true"><MessageCircle size={13}/></span>{person.wechat}</div>{/if}
        {#if person.email}<div><span aria-hidden="true"><Mail size={13}/></span><a href={mailHref(person.email)} onclick={(event) => event.stopPropagation()}>{person.email}</a></div>{/if}
        <div><span aria-hidden="true"><Clock3 size={13}/></span>{recentLabel}</div>
    </div>
    {#if person.group || person.tags.length > 0}
        <div class="lvct-person-card__tags">
            {#if person.group}<span class="lvct-chip lvct-chip--group">{person.group}</span>{/if}
            {#each person.tags as tag (tag)}<span class="lvct-chip"># {tag}</span>{/each}
        </div>
    {/if}
</div>

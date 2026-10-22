<script lang="ts">
    /** 联系人卡片（列表默认视图） */
    import type { ContactSummary } from "../../domain/person";
    import { formatBirthdayDisplay, nextBirthday } from "../../domain/occasions";
    import { formatRelativeInteraction } from "../../domain/format";
    import { computeRelationshipHealth, heatLevelColorClass } from "../../domain/cadence";
    import { ExternalLink, Phone, MessageCircle, Mail, Clock3, Network, Star } from "@lucide/svelte";
    import PersonProfileSummary from "./PersonProfileSummary.svelte";
    import { copyPlainText } from "../../shared/clipboard";

    let {
        person,
        onOpen,
        selected = false,
        active = false,
        onToggleSelected,
        onOpenPersonDoc,
        onOpenGraphPerson,
        starred = false,
        onToggleStarred,
        recent,
        recentUnknown = false,
        orgLine = "",
        cadenceDays = 30,
        cadencePaused = false,
        compact = false,
    }: {
        person: ContactSummary;
        onOpen: (person: ContactSummary) => void;
        selected?: boolean;
        active?: boolean;
        onToggleSelected?: (selected: boolean) => void;
        onOpenPersonDoc?: (docId: string) => void;
        onOpenGraphPerson?: (docId: string) => void;
        starred?: boolean;
        onToggleStarred?: (starred: boolean) => void;
        recent?: { occurredAt: number; localDate: string };
        recentUnknown?: boolean;
        /** B12：单位显示串（组织名 · 部门，来自成员索引投影） */
        orgLine?: string;
        cadenceDays?: number;
        cadencePaused?: boolean;
        compact?: boolean;
    } = $props();

    function telHref(phone: string): string {
        return `tel:${phone}`;
    }

    function mailHref(email: string): string {
        return `mailto:${email}`;
    }
    const birthday = $derived(nextBirthday(person.birthday, person.isLunar));
    const recentLabel = $derived.by(() => {
        if (recentUnknown) return "最近互动待核实";
        if (!recent) return "暂无互动";
        const today = new Date();
        const day = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
        const then = new Date(`${recent.localDate}T00:00:00`).getTime();
        return formatRelativeInteraction(Math.round((day - then) / 86400000));
    });
    const health = $derived(computeRelationshipHealth({
        cadenceDays,
        lastInteractionTime: recent?.occurredAt,
        paused: cadencePaused,
    }));
</script>

<!-- 卡片保留鼠标快捷打开；tabindex 仅用于关闭详情后恢复焦点，键盘入口是独立详情按钮。 -->
<!-- svelte-ignore a11y_click_events_have_key_events -->
<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<article
    class="lvct-person-card"
    class:lvct-person-card--active={active}
    class:lvct-person-card--compact={compact}
    tabindex="-1"
    aria-label={`${person.name}，联系人`}
    data-person-item-id={person.itemId}
    onclick={(event) => { event.currentTarget.focus({ preventScroll: true }); onOpen(person); }}
>
    {#if compact}
        <!-- 紧凑单行模式：极高密度展示 -->
        <div class="lvct-person-card__compact-row">
            {#if onToggleSelected}
                <label class="lvct-person-card__select-hit-area" onclick={(event) => event.stopPropagation()}>
                    <input
                        class="lvct-person-card__select"
                        type="checkbox"
                        aria-label={`选择 ${person.name}`}
                        checked={selected}
                        onclick={(event) => event.stopPropagation()}
                        onchange={(event) => onToggleSelected?.((event.currentTarget as HTMLInputElement).checked)}
                    />
                </label>
            {/if}
            <span class="lvct-person-card__avatar lvct-person-card__avatar--sm" data-group={person.group || "未分组"}>
                {person.name.slice(0, 1)}
            </span>
            <div class="lvct-person-card__compact-info">
                <div class="lvct-person-card__name-row">
                    <strong class="lvct-person-card__name" title={person.name}>{person.name}</strong>
                    {#if person.isSelf}<span class="lvct-chip lvct-bucket--today">本人</span>{/if}
                    {#if person.group}<span class="lvct-chip lvct-chip--group font-size-11">{person.group}</span>{/if}
                    {#if birthday}<span class="lvct-person-card__bday font-size-11">🎂 {birthday.daysUntil === 0 ? "今天" : `${birthday.daysUntil}天后`}</span>{/if}
                </div>
                {#if orgLine || (person.profile && person.profile.affiliations?.state === "known")}
                    <div class="lvct-person-card__org lvct-text-muted font-size-11" title={orgLine}>
                        {orgLine || "已登记组织经历"}
                    </div>
                {/if}
            </div>
            {#if person.phone}
                <span class="lvct-person-card__compact-phone font-size-11">
                    <Phone size={11} class="lvct-text-muted" />
                    <span>{person.phone}</span>
                </span>
            {/if}
            <span class="lvct-person-card__compact-actions" role="presentation" onclick={(event) => event.stopPropagation()}>
                {#if onToggleStarred}
                    <button
                        type="button"
                        class="lvct-person-card__open-doc lvct-person-card__star-btn"
                        class:lvct-person-card__star-btn--active={starred}
                        title={starred ? "取消星标" : "设为星标常用"}
                        aria-label={starred ? `取消 ${person.name} 的星标` : `将 ${person.name} 设为星标`}
                        onclick={(event) => { event.stopPropagation(); onToggleStarred?.(!starred); }}
                    >
                        <Star size={14} fill={starred ? "#f59e0b" : "none"} color={starred ? "#f59e0b" : "currentColor"} />
                    </button>
                {/if}
                {#if onOpenGraphPerson}<button type="button" class="lvct-person-card__open-doc" title={`在关系图谱中查看 ${person.name}`} aria-label={`在关系图谱中查看 ${person.name}`} onclick={() => onOpenGraphPerson?.(person.docId)}><Network size={14}/></button>{/if}
                {#if onOpenPersonDoc}<button type="button" class="lvct-person-card__open-doc" title={`打开 ${person.name} 的文档`} aria-label={`打开 ${person.name} 的文档`} onclick={() => onOpenPersonDoc(person.docId)}><ExternalLink size={14}/></button>{/if}
            </span>
        </div>
    {:else}
        <!-- 舒适模式：呼吸感与完整字段展示 -->
        <div class="lvct-person-card__top">
            {#if onToggleSelected}
                <label class="lvct-person-card__select-hit-area" onclick={(event) => event.stopPropagation()}>
                    <input
                        class="lvct-person-card__select"
                        type="checkbox"
                        aria-label={`选择 ${person.name}`}
                        checked={selected}
                        onclick={(event) => event.stopPropagation()}
                        onchange={(event) => onToggleSelected?.((event.currentTarget as HTMLInputElement).checked)}
                    />
                </label>
            {/if}
            <button type="button" class="lvct-person-card__details" aria-label={`查看 ${person.name} 的详情`} onclick={(event) => { event.stopPropagation(); onOpen(person); }}>
                <span class="lvct-person-card__avatar" data-group={person.group || "未分组"}>
                    {person.name.slice(0, 1)}
                </span>
                <span class="lvct-person-card__main">
                    <span class="lvct-person-card__name" title={person.name}>
                        {person.name}
                        {#if person.isSelf}<span class="lvct-chip lvct-bucket--today">本人</span>{/if}
                    </span>
                    <span class="lvct-person-card__sub">
                        {#if birthday}{formatBirthdayDisplay(person.birthday, person.isLunar)} · {birthday.daysUntil === 0 ? "今天" : `${birthday.daysUntil} 天后`}{:else}生日未填写{/if}
                    </span>
                </span>
            </button>
            {#if onToggleStarred}
                <button
                    type="button"
                    class="lvct-person-card__open-doc lvct-person-card__star-btn"
                    class:lvct-person-card__star-btn--active={starred}
                    title={starred ? "取消星标" : "设为星标常用"}
                    aria-label={starred ? `取消 ${person.name} 的星标` : `将 ${person.name} 设为星标`}
                    onclick={(event) => { event.stopPropagation(); onToggleStarred?.(!starred); }}
                >
                    <Star size={16} fill={starred ? "#f59e0b" : "none"} color={starred ? "#f59e0b" : "currentColor"} />
                </button>
            {/if}
            {#if onOpenGraphPerson}<button type="button" class="lvct-person-card__open-doc" title={`在关系图谱中查看 ${person.name}`} aria-label={`在关系图谱中查看 ${person.name}`} onclick={(event) => { event.stopPropagation(); onOpenGraphPerson?.(person.docId); }}><Network size={16}/></button>{/if}
            {#if onOpenPersonDoc}<button type="button" class="lvct-person-card__open-doc" title={`打开 ${person.name} 的文档`} aria-label={`打开 ${person.name} 的文档`} onclick={(event) => { event.stopPropagation(); onOpenPersonDoc(person.docId); }}><ExternalLink size={16}/></button>{/if}
        </div>
        {#if person.profile}<PersonProfileSummary profile={person.profile} compact hideEmpty />
        {:else if orgLine}
            <div class="lvct-person-card__org" aria-label="单位">{orgLine}</div>
        {/if}
        <div class="lvct-person-card__meta">
            {#if person.phone}<div><span aria-hidden="true"><Phone size={13}/></span><a class="lvct-person-card__meta-value" href={telHref(person.phone)} onclick={(event) => event.stopPropagation()}>{person.phone}</a></div>{/if}
            {#if person.wechat}
                <div>
                    <span aria-hidden="true"><MessageCircle size={13}/></span>
                    <span
                        class="lvct-person-card__meta-value"
                        role="button"
                        tabindex="0"
                        title="点击复制微信号"
                        onclick={(event) => {
                            event.stopPropagation();
                            void copyPlainText(person.wechat);
                        }}
                        onkeydown={(event) => {
                            if (event.key === "Enter" || event.key === " ") {
                                event.stopPropagation();
                                void copyPlainText(person.wechat);
                            }
                        }}
                    >{person.wechat}</span>
                </div>
            {/if}
            {#if person.email}<div><span aria-hidden="true"><Mail size={13}/></span><a class="lvct-person-card__meta-value" href={mailHref(person.email)} onclick={(event) => event.stopPropagation()}>{person.email}</a></div>{/if}
            <div>
                <span aria-hidden="true"><Clock3 size={13}/></span>
                <span class="lvct-person-card__meta-value">{recentLabel}</span>
                {#if recent && health.level !== "unknown"}
                    <span class={`lvct-heat ${heatLevelColorClass(health.level)}`} style="font-size: 10px; padding: 1px 5px; margin-left: 4px;" title={`关系温度 ${health.score}%`}>
                        {health.level === "hot" ? "温热" : health.level === "warm" ? "常温" : health.level === "cool" ? "微凉" : health.level === "cold" ? "渐冻" : "已暂停"}
                    </span>
                {/if}
            </div>
        </div>
        {#if person.group || person.tags.length > 0}
            <div class="lvct-person-card__tags">
                {#if person.group}<span class="lvct-chip lvct-chip--group">{person.group}</span>{/if}
                {#each person.tags as tag (tag)}<span class="lvct-chip"># {tag}</span>{/each}
            </div>
        {/if}
    {/if}
</article>

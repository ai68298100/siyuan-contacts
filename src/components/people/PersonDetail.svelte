<script lang="ts">
    /** 人物详情 Peek：档案字段、互动与关系列表（增删，内核自动维护双向回链） */
    import { listContacts, removeContact } from "../../services/contacts";
    import { addRelation, removeRelation, refreshPerson } from "../../services/relations";
    import LvctDialog from "../LvctDialog.svelte";
    import PersonEditDialog from "./PersonEditDialog.svelte";
    import ViewState from "../ViewState.svelte";
    import type { ContactSummary } from "../../domain/person";
    import type { ContactsSettings } from "../../domain/model";

    let {
        settings,
        person,
        onRecord,
        onDeleteInteraction,
        onLoadInsights,
        onOpenPersonDoc,
        onNavigate,
        onChanged,
        onDeleted,
        onClose,
    }: {
        settings: ContactsSettings;
        person: ContactSummary;
        /** 记一笔互动（facade.recordInteraction） */
        onRecord: (personDocId: string, note?: string) => Promise<void>;
        onDeleteInteraction?: (personDocId: string, eventId: string) => Promise<void>;
        /** 人物洞察（时间线+共同出席） */
        onLoadInsights: (docId: string) => Promise<import("../../services/insights").PersonInsights>;
        onOpenPersonDoc: (docId: string) => void;
        onNavigate: (person: ContactSummary) => void;
        onChanged: () => void;
        onDeleted: () => void;
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
    let insights: import("../../services/insights").PersonInsights | null = $state(null);
    let insightsLoading = $state(true);
    let insightsError = $state("");
    let othersLoading = $state(true);
    let othersError = $state("");
    let relationSelect: HTMLSelectElement | undefined = $state();
    let insightsRequest = 0;
    let editing = $state(false);
    let deleting = $state(false);
    let activeTab: "overview" | "activity" | "relations" = $state("overview");
    let activitySearch = $state("");
    let activitySource = $state("");
    let activityLimit = $state(20);
    const sourceLabels = { manual: "手动记录", diary: "笔记捕获", api: "外部联动" };
    const filteredTimeline = $derived.by(() => {
        const query = activitySearch.trim().toLowerCase();
        return (insights?.timeline ?? []).filter((item) => (!activitySource || item.source === activitySource) &&
            (!query || `${item.localDate} ${item.note ?? ""}`.toLowerCase().includes(query)));
    });

    async function deleteTimelineItem(eventId: string) {
        if (busy || !onDeleteInteraction) return;
        if (!window.confirm(`删除「${current.name}」的这条互动吗？只删除本人的记录，其他参与者与人物文档会保留。`)) return;
        busy = true;
        errorText = "";
        try {
            await onDeleteInteraction(current.docId, eventId);
            recorded = false;
            onChanged();
            await loadInsights();
        } catch (error) {
            errorText = error instanceof Error ? error.message : String(error);
        } finally { busy = false; }
    }

    async function loadInsights() {
        const request = ++insightsRequest;
        insightsLoading = true;
        insightsError = "";
        try {
            const result = await onLoadInsights(current.docId);
            if (request === insightsRequest) insights = result;
        } catch (error) {
            if (request === insightsRequest) insightsError = error instanceof Error ? error.message : String(error);
        } finally {
            if (request === insightsRequest) insightsLoading = false;
        }
    }

    loadInsights();

    const relatedPeople = $derived(
        current.relatedItemIds
            .map((itemId) => others.find((item) => item.itemId === itemId))
            .filter((item): item is ContactSummary => Boolean(item)),
    );
    const candidates = $derived(
        others.filter((item) => item.itemId !== current.itemId && !current.relatedItemIds.includes(item.itemId)),
    );
    const currentIndex = $derived(others.findIndex((item) => item.itemId === current.itemId));
    const previousPerson = $derived(currentIndex > 0 ? others[currentIndex - 1] : null);
    const nextPerson = $derived(currentIndex >= 0 && currentIndex < others.length - 1 ? others[currentIndex + 1] : null);

    async function loadOthers() {
        othersLoading = true;
        othersError = "";
        try {
            const people = await listContacts(settings);
            others = people;
            const fresh = people.find((item) => item.itemId === current.itemId);
            if (fresh) current = fresh;
        } catch (error) {
            othersError = error instanceof Error ? error.message : String(error);
        } finally {
            othersLoading = false;
        }
    }

    loadOthers();

    async function mutate(action: () => Promise<void>) {
        if (busy) return;
        busy = true;
        errorText = "";
        try {
            await action();
            onChanged();
            const fresh = await refreshPerson(settings, current);
            if (fresh) current = fresh;
        } catch (error) {
            errorText = error instanceof Error ? error.message : String(error);
        } finally {
            busy = false;
        }
    }

    async function refreshAfterEdit() {
        await loadOthers();
        await loadInsights();
        onChanged();
    }

    async function confirmDelete() {
        if (deleting || busy) return;
        if (!window.confirm(`确定从人脉名册移除「${current.name}」吗？人物文档会保留。`)) return;
        deleting = true;
        errorText = "";
        try {
            await removeContact(settings, current);
            onDeleted();
        } catch (error) {
            errorText = error instanceof Error ? error.message : String(error);
        } finally {
            deleting = false;
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
        <div class="lvct-detail__header-actions">
            <button class="b3-button b3-button--outline" onclick={() => (editing = true)} disabled={busy || deleting}>编辑</button>
            <button class="b3-button b3-button--outline" onclick={() => previousPerson && onNavigate(previousPerson)} disabled={!previousPerson || busy}>上一位</button>
            <button class="b3-button b3-button--outline" onclick={() => nextPerson && onNavigate(nextPerson)} disabled={!nextPerson || busy}>下一位</button>
        </div>
    </div>

    <div class="lvct-detail__tabs" role="tablist" aria-label="人物详情内容">
        <button type="button" role="tab" aria-selected={activeTab === "overview"} class:lvct-detail__tab--active={activeTab === "overview"} onclick={() => (activeTab = "overview")}>概览</button>
        <button type="button" role="tab" aria-selected={activeTab === "activity"} class:lvct-detail__tab--active={activeTab === "activity"} onclick={() => (activeTab = "activity")}>互动</button>
        <button type="button" role="tab" aria-selected={activeTab === "relations"} class:lvct-detail__tab--active={activeTab === "relations"} onclick={() => (activeTab = "relations")}>相关人</button>
    </div>

    {#if activeTab === "overview"}
    {#if !current.phone && !current.email && !current.wechat && !current.website && current.tags.length === 0}
        <ViewState compact title="联系资料还未填写" description="补充电话、邮箱或标签，方便下次查找。">
            <button class="b3-button b3-button--outline" onclick={() => (editing = true)}>编辑资料</button>
        </ViewState>
    {/if}
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
                        await loadInsights();
                    })}
            >{recorded ? "已记录 ✓" : "记录"}</button>
        </div>
        <p class="ft__smaller ft__on-surface">记录后，首页"久未联系"会重新计时。</p>
    </section>
    {:else if activeTab === "activity"}

    <section class="lvct-detail__section">
        <h4>互动与共同出席{insights ? `（共 ${insights.totalEvents} 条）` : ""}</h4>
        <div class="lvct-detail__activity-filters">
            <input class="b3-text-field" type="search" aria-label="搜索互动备注或日期" placeholder="搜索备注或日期" bind:value={activitySearch} oninput={() => (activityLimit = 20)} />
            <select class="b3-select" aria-label="互动来源" bind:value={activitySource} onchange={() => (activityLimit = 20)}>
                <option value="">全部来源</option>
                <option value="manual">手动记录</option>
                <option value="diary">笔记捕获</option>
                <option value="api">外部联动</option>
            </select>
        </div>
        {#if insights && insights.coAttendance.length > 0}
            <div class="lvct-strip__chips" style="margin-bottom: 6px;">
                {#each insights.coAttendance.slice(0, 5) as item (item.otherDocId)}
                    <span class="lvct-chip lvct-chip--group">与 {item.name} 同场 {item.count} 次</span>
                {/each}
            </div>
        {/if}
        {#if insightsLoading}
            <ViewState compact loading title="正在加载互动记录" />
        {:else if insightsError}
            <ViewState compact error title="互动记录加载失败" description={insightsError}>
                <button class="b3-button b3-button--outline" onclick={loadInsights}>重试</button>
            </ViewState>
        {:else if filteredTimeline.length > 0}
            <div class="lvct-detail__timeline">
                {#each filteredTimeline.slice(0, activityLimit) as item (item.eventId)}
                    <div class="lvct-detail__timeline-row">
                        <span class="ft__on-surface">{item.localDate}</span>
                        <span class="lvct-detail__timeline-note">{item.note || "互动"}</span>
                        <span class="lvct-detail__timeline-source">{sourceLabels[item.source]}</span>
                        {#if item.groupSize > 1}<span class="lvct-chip">{item.groupSize} 人同场</span>{/if}
                        {#if onDeleteInteraction}
                            <button class="b3-button b3-button--text" title="删除这条互动" aria-label={`删除 ${item.localDate} 的互动`} disabled={busy} onclick={() => deleteTimelineItem(item.eventId)}>删除</button>
                        {/if}
                    </div>
                {/each}
            </div>
            <div class="lvct-detail__activity-more">
                <span class="ft__smaller ft__on-surface">显示 {Math.min(activityLimit, filteredTimeline.length)} / {filteredTimeline.length} 条</span>
                {#if activityLimit < filteredTimeline.length}
                    <button class="b3-button b3-button--outline" onclick={() => (activityLimit += 20)}>加载更多</button>
                {/if}
            </div>
        {:else if insights && insights.timeline.length > 0}
            <ViewState compact title="没有匹配的互动">
                <button class="b3-button b3-button--outline" onclick={() => { activitySearch = ""; activitySource = ""; activityLimit = 20; }}>清除筛选</button>
            </ViewState>
        {:else}
            <ViewState compact title="还没有互动记录" description="从一次聊天或见面开始，记录你们的往来。">
                <button class="b3-button b3-button--text" onclick={() => (activeTab = "overview")}>去记一笔</button>
            </ViewState>
        {/if}
    </section>
    {:else}

    <section class="lvct-detail__section">
        <h4>相关人（{relatedPeople.length}）</h4>
        {#if othersLoading}
            <ViewState compact loading title="正在加载相关人" />
        {:else if othersError}
            <ViewState compact error title="相关人加载失败" description={othersError}>
                <button class="b3-button b3-button--outline" onclick={loadOthers}>重试</button>
            </ViewState>
        {:else if relatedPeople.length === 0}
            <ViewState compact title="还没有建立关系"
                description={candidates.length > 0 ? "选择一位联系人，建立你们之间的关系。" : "先在联系人页添加其他人物，再回来建立关系。"}>
                {#if candidates.length > 0}
                    <button class="b3-button b3-button--outline" onclick={() => relationSelect?.focus()}>选择联系人</button>
                {:else}
                    <button class="b3-button b3-button--outline" onclick={onClose}>返回工作台</button>
                {/if}
            </ViewState>
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
            <select class="b3-select fn__flex-1" bind:this={relationSelect} aria-label="选择要添加关系的联系人" bind:value={addChoice} disabled={busy || othersLoading || !!othersError || candidates.length === 0}>
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
    {/if}

    {#if errorText}
        <div class="lvct-form__error">{errorText}</div>
    {/if}

    <div class="lvct-form__actions">
        <button class="b3-button b3-button--cancel" onclick={onClose}>关闭</button>
        <button class="b3-button b3-button--text" onclick={() => onOpenPersonDoc(current.docId)}>打开文档</button>
        <button class="b3-button b3-button--cancel lvct-detail__delete" onclick={confirmDelete} disabled={busy || deleting}>{deleting ? "移除中…" : "从人脉移除"}</button>
    </div>
</div>

{#if editing}
    <LvctDialog title={`编辑资料 · ${current.name}`} onClose={() => (editing = false)}>
        <PersonEditDialog
            {settings}
            person={current}
            onSaved={refreshAfterEdit}
            onClose={() => (editing = false)}
        />
    </LvctDialog>
{/if}

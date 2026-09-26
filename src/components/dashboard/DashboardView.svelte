<script lang="ts">
    /** 首页仪表盘：统计 + 近期生日（公/农历）+ 久未联系 */
    import type { ContactsPluginFacade } from "../../types";
    import type { DashboardData } from "../../services/dashboard";
    import type { ContactSummary } from "../../domain/person";
    import { detectCheckinBridge } from "../../bridge/checkin";

    let {
        facade,
        onOpenDetail,
    }: {
        facade: ContactsPluginFacade;
        onOpenDetail: (person: ContactSummary) => void;
    } = $props();

    let data: DashboardData | null = $state(null);
    let errorText: string = $state("");
    let bridge = $state(detectCheckinBridge());

    async function refresh() {
        errorText = "";
        try {
            data = await facade.loadDashboard();
        } catch (error) {
            errorText = error instanceof Error ? error.message : String(error);
        }
    }

    refresh();

    const bucketStyles: Record<string, string> = {
        today: "lvct-bucket--today",
        week: "lvct-bucket--week",
        month: "lvct-bucket--month",
        later: "lvct-bucket--later",
    };
</script>

<div class="lvct-dash">
    {#if errorText}
        <div class="lvct-form__error">{errorText}</div>
    {:else if !data}
        <div class="lvct-placeholder">加载中…</div>
    {:else}
        <div class="lvct-dash__stats">
            <div class="lvct-dash__stat"><b>{data.people}</b><span>联系人</span></div>
            <div class="lvct-dash__stat"><b>{data.relations}</b><span>关系</span></div>
            <div class="lvct-dash__stat"><b>{data.birthdaysThisWeek}</b><span>本周生日</span></div>
            <div class="lvct-dash__stat"><b>{data.neverContacted}</b><span>从未互动</span></div>
        </div>

        <div class="lvct-dash__grid">
            <div class="lvct-home__card">
                <h3>近期生日</h3>
                {#if data.birthdays.length === 0}
                    <p class="ft__smaller ft__on-surface">还没有生日数据：给联系人的档案补上生日（支持农历）就会出现在这里。</p>
                {:else}
                    <div class="lvct-dash__list">
                        {#each data.birthdays.slice(0, 8) as item (item.person.itemId)}
                            <button class="lvct-dash__row" onclick={() => onOpenDetail(item.person)}>
                                <b>{item.person.name}</b>
                                <span class="ft__smaller ft__on-surface">{item.projection.label}{item.person.isLunar ? "（农历）" : ""}</span>
                                <span class="lvct-bucket {bucketStyles[item.bucket]}">
                                    {item.projection.daysUntil === 0 ? "今天" : `${item.projection.daysUntil}天`}
                                </span>
                            </button>
                        {/each}
                    </div>
                {/if}
            </div>

            <div class="lvct-home__card">
                <h3>久未联系</h3>
                {#if data.stale.length === 0}
                    <p class="ft__smaller ft__on-surface">最近大家都联系过，保持！</p>
                {:else}
                    <div class="lvct-dash__list">
                        {#each data.stale.slice(0, 8) as item (item.person.itemId)}
                            <button class="lvct-dash__row" onclick={() => onOpenDetail(item.person)}>
                                <b>{item.person.name}</b>
                                <span class="ft__smaller ft__on-surface">
                                    {item.lastDaysAgo === undefined ? "从未互动" : `${item.lastDaysAgo} 天前`}
                                </span>
                                <span class="lvct-bucket lvct-bucket--stale">联系一下</span>
                            </button>
                        {/each}
                    </div>
                {/if}
            </div>
        </div>

        <div class="lvct-dash__grid">
            <div class="lvct-home__card">
                <h3>工作空间</h3>
                <div class="lvct-home__row"><span class="ft__on-surface">笔记本</span><b>{facade.settings?.notebookName ?? "—"}</b></div>
                <div class="lvct-home__actions">
                    <button class="b3-button b3-button--outline" onclick={() => facade.openHostDoc()}>打开联系人总表</button>
                </div>
            </div>

            <div class="lvct-home__card">
                <h3>小驴打卡联动</h3>
                {#if bridge.state === "ready"}
                    <div class="lvct-home__row"><span class="ft__on-surface">状态</span><b>已连接（协议 v{bridge.protocol}）</b></div>
                {:else if bridge.state === "pending"}
                    <div class="lvct-home__row"><span class="ft__on-surface">状态</span><b>检测到旧版打卡（协议 v{bridge.protocol ?? "?"}）</b></div>
                {:else if bridge.state === "failed"}
                    <div class="lvct-home__row"><span class="ft__on-surface">状态</span><b>探测异常</b></div>
                {:else}
                    <div class="lvct-home__row"><span class="ft__on-surface">状态</span><b>未检测到小驴打卡</b></div>
                    <p class="ft__smaller ft__on-surface">安装小驴打卡后，生日可同步为打卡事项提醒。</p>
                {/if}
            </div>
        </div>
    {/if}
</div>

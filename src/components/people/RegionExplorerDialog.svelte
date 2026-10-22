<script lang="ts">
    /**
     * 城市/地域人脉探索与出差助手对话框 (RegionExplorerDialog)
     * 帮助用户按城市热度探索人脉分布、计划出差行程、发现周边省市联系人、并一键导出出差拜访清单。
     */
    import type { ContactSummary } from "../../domain/person.ts";
    import {
        groupContactsByRegion,
        findNearbyOrSameProvinceCities,
        filterContactsByRegion,
    } from "../../domain/region.ts";
    import { profileText } from "../../domain/people-profiles.ts";
    import { copyPlainText } from "../../shared/clipboard.ts";
    import { onDestroy } from "svelte";
    import { MapPin, Search, Copy, Check, Filter, Compass, Briefcase, Phone } from "@lucide/svelte";

    let {
        contacts = [],
        onApplyRegionFilter,
        onClose,
    }: {
        contacts: readonly ContactSummary[];
        i18n?: Readonly<Record<string, string>>;
        onApplyRegionFilter: (region: string) => void;
        onClose: () => void;
    } = $props();

    // 搜索关键词
    let citySearch = $state("");
    // 当前选中的城市（默认为人数最多的城市或首个城市）
    let selectedCity = $state<string>("");
    // 复制成功的提示状态
    let copySuccess = $state(false);
    let copyTimer: ReturnType<typeof setTimeout> | null = null;

    // 按地域分组统计
    const regionGroups = $derived.by(() => groupContactsByRegion(contacts));

    // 热门快捷城市列表
    const hotCities = ["北京", "上海", "广州", "深圳", "杭州", "成都", "南京", "武汉"];

    // 过滤后的城市列表
    const filteredRegionGroups = $derived.by(() => {
        const query = citySearch.trim().toLowerCase();
        if (!query) return regionGroups;
        return regionGroups.filter(
            (group) =>
                group.city.toLowerCase().includes(query) ||
                (group.province && group.province.toLowerCase().includes(query))
        );
    });

    // 默认选中第一个城市
    $effect(() => {
        if (!selectedCity && regionGroups.length > 0) {
            // 优先选已知城市而非“未知”
            const firstKnown = regionGroups.find((g) => g.city !== "未知");
            selectedCity = firstKnown ? firstKnown.city : regionGroups[0].city;
        }
    });

    // 当前选中的城市分组详情
    const currentGroup = $derived.by(() => {
        return regionGroups.find((g) => g.city === selectedCity) ?? null;
    });

    // 当前选中的城市联系人列表
    const currentContacts = $derived.by(() => {
        if (!selectedCity) return [];
        return filterContactsByRegion(contacts, selectedCity);
    });

    // 周边及同省关联城市
    const nearbyCities = $derived.by(() => {
        if (!selectedCity || selectedCity === "未知") return [];
        const candidateNames = findNearbyOrSameProvinceCities(selectedCity);
        // 只保留通讯录中确实存在联系人的城市
        return regionGroups.filter((g) => g.city !== selectedCity && candidateNames.includes(g.city));
    });

    // 未知/未录入地区的数量
    const unknownCount = $derived.by(() => {
        const g = regionGroups.find((item) => item.city === "未知");
        return g ? g.count : 0;
    });

    // 复制出差拜访清单为 Markdown 格式
    async function handleCopyVisitList() {
        if (currentContacts.length === 0) return;
        const cityName = selectedCity || "未知地区";
        const lines: string[] = [
            `# 出差人脉拜访清单 - ${cityName} (共 ${currentContacts.length} 人)`,
            `> 生成时间：${new Date().toLocaleDateString()}`,
            "",
        ];

        for (const person of currentContacts) {
            const workText = profileText(person.profile, "work");
            const orgStr = workText && workText !== "未填写" && workText !== "尚未核实" ? ` | ${workText}` : "";

            const contactParts: string[] = [];
            if (person.phone) contactParts.push(`电话: ${person.phone}`);
            if (person.wechat) contactParts.push(`微信: ${person.wechat}`);
            if (person.email) contactParts.push(`邮箱: ${person.email}`);
            const contactStr = contactParts.length > 0 ? ` (${contactParts.join(", ")})` : "";

            const rel = profileText(person.profile, "relationship");
            const relStr = rel && rel !== "未填写" && rel !== "尚未核实" ? ` [${rel}]` : "";

            lines.push(`- **${person.name}**${relStr}${orgStr}${contactStr}`);
        }

        const textContent = lines.join("\n");
        await copyPlainText(textContent);
        copySuccess = true;
        if (copyTimer) clearTimeout(copyTimer);
        copyTimer = setTimeout(() => {
            copySuccess = false;
        }, 2000);
    }

    onDestroy(() => {
        if (copyTimer) clearTimeout(copyTimer);
    });

    function handleApplyAndClose(city: string) {
        onApplyRegionFilter(city);
        onClose();
    }
</script>

<div class="lvct-region-dialog">
    <!-- 顶部状态栏与目的地速搜 -->
    <div class="lvct-region-dialog__header">
        <div class="lvct-region-dialog__header-left">
            <Compass size={18} class="lvct-region-dialog__header-icon" />
            <div>
                <h3 class="lvct-region-dialog__title">城市人脉探索与出差助手</h3>
                <p class="lvct-region-dialog__subtitle">按城市归类通讯录联系人，一键导出拜访清单、探索同城及周边人脉</p>
            </div>
        </div>
        <div class="lvct-region-dialog__header-search">
            <div class="b3-form__icon">
                <Search size={14} class="b3-form__icon-icon" />
                <input
                    type="search"
                    class="b3-text-field b3-text-field--small"
                    placeholder="搜索城市、省份或大区..."
                    bind:value={citySearch}
                />
            </div>
        </div>
    </div>

    <!-- 热门城市快捷 Chips -->
    <div class="lvct-region-dialog__quick-chips">
        <span class="lvct-region-dialog__chips-label">热门出差地：</span>
        {#each hotCities as hot}
            {@const group = regionGroups.find((g) => g.city === hot)}
            <button
                type="button"
                class="b3-chip"
                class:b3-chip--primary={selectedCity === hot}
                onclick={() => (selectedCity = hot)}
            >
                {hot}{#if group} ({group.count}){/if}
            </button>
        {/each}
        {#if unknownCount > 0}
            <button
                type="button"
                class="b3-chip b3-chip--dashed"
                class:b3-chip--primary={selectedCity === "未知"}
                onclick={() => (selectedCity = "未知")}
                title="查看尚未录入地址或城市的联系人"
            >
                未填写地区 ({unknownCount})
            </button>
        {/if}
    </div>

    <!-- 主体：左侧城市列表 + 右侧人脉清单与行程卡片 -->
    <div class="lvct-region-dialog__body">
        <!-- 左侧：城市热度排行 -->
        <div class="lvct-region-dialog__sidebar">
            <div class="lvct-region-dialog__sidebar-header">
                <span>全部城市 ({filteredRegionGroups.length})</span>
                <span class="lvct-text-muted">共 {contacts.length} 人</span>
            </div>
            <div class="lvct-region-dialog__city-list">
                {#if filteredRegionGroups.length === 0}
                    <div class="lvct-empty-tip">未找到匹配的城市</div>
                {:else}
                    {#each filteredRegionGroups as group (group.city)}
                        <button
                            type="button"
                            class="lvct-region-dialog__city-item"
                            class:lvct-region-dialog__city-item--active={selectedCity === group.city}
                            onclick={() => (selectedCity = group.city)}
                        >
                            <div class="lvct-region-dialog__city-info">
                                <span class="lvct-region-dialog__city-name">{group.city}</span>
                                {#if group.province && group.province !== group.city}
                                    <span class="lvct-region-dialog__city-meta">{group.province}</span>
                                {/if}
                            </div>
                            <span class="b3-badge b3-badge--secondary">{group.count} 人</span>
                        </button>
                    {/each}
                {/if}
            </div>
        </div>

        <!-- 右侧：当前城市人脉清单 -->
        <div class="lvct-region-dialog__main">
            {#if !selectedCity}
                <div class="lvct-empty-state">
                    <MapPin size={40} class="lvct-empty-state__icon" />
                    <p>请在左侧选择一个城市查看联系人</p>
                </div>
            {:else}
                <!-- 城市头部与出差操作 -->
                <div class="lvct-region-dialog__target-header">
                    <div>
                        <div class="lvct-region-dialog__target-title">
                            <MapPin size={18} class="lvct-text-primary" />
                            <h4>{selectedCity}</h4>
                            <span class="b3-badge b3-badge--primary">{currentContacts.length} 位联系人</span>
                            {#if currentGroup?.province && currentGroup.province !== selectedCity}
                                <span class="lvct-text-muted font-size-12">（所属省份：{currentGroup.province}）</span>
                            {/if}
                        </div>
                        <!-- 周边联动提示 -->
                        {#if nearbyCities.length > 0}
                            <div class="lvct-region-dialog__nearby">
                                <span class="lvct-region-dialog__nearby-label">💡 同省及周边人脉：</span>
                                {#each nearbyCities as near (near.city)}
                                    <button
                                        type="button"
                                        class="b3-button b3-button--text b3-button--small"
                                        onclick={() => (selectedCity = near.city)}
                                    >
                                        {near.city} ({near.count}人)
                                    </button>
                                {/each}
                            </div>
                        {/if}
                    </div>

                    <!-- 操作按钮组 -->
                    <div class="lvct-region-dialog__actions">
                        <button
                            type="button"
                            class="b3-button b3-button--outline b3-button--small"
                            onclick={() => handleApplyAndClose(selectedCity === "未知" ? "未填写" : selectedCity)}
                            title="在名册主视图中应用此地域筛选"
                        >
                            <Filter size={14} /> 在名册中筛选
                        </button>
                        <button
                            type="button"
                            class="b3-button b3-button--primary b3-button--small"
                            onclick={handleCopyVisitList}
                            disabled={currentContacts.length === 0}
                        >
                            {#if copySuccess}
                                <Check size={14} /> 已复制清单
                            {:else}
                                <Copy size={14} /> 复制出差清单
                            {/if}
                        </button>
                    </div>
                </div>

                <!-- 联系人列表 -->
                <div class="lvct-region-dialog__contacts-wrap">
                    {#if currentContacts.length === 0}
                        <div class="lvct-empty-tip">该城市暂无联系人</div>
                    {:else}
                        <div class="lvct-region-dialog__contacts-grid">
                            {#each currentContacts as person (person.docId)}
                                {@const workText = profileText(person.profile, "work")}
                                {@const relText = profileText(person.profile, "relationship")}
                                <div class="lvct-region-dialog__person-card">
                                    <div class="lvct-region-dialog__person-top">
                                        <div class="lvct-region-dialog__person-avatar">
                                            {person.name.slice(0, 1).toUpperCase()}
                                        </div>
                                        <div class="lvct-region-dialog__person-basic">
                                            <div class="lvct-region-dialog__person-name-row">
                                                <strong class="lvct-region-dialog__person-name">{person.name}</strong>
                                                {#if relText && relText !== "未填写" && relText !== "尚未核实"}
                                                    <span class="b3-badge b3-badge--secondary font-size-11">{relText}</span>
                                                {/if}
                                            </div>
                                            {#if workText && workText !== "未填写" && workText !== "尚未核实"}
                                                <div class="lvct-region-dialog__person-job" title={workText}>
                                                    <Briefcase size={12} class="lvct-text-muted" />
                                                    <span>{workText}</span>
                                                </div>
                                            {/if}
                                        </div>
                                    </div>

                                    <!-- 详细信息：联系方式 -->
                                    <div class="lvct-region-dialog__person-details">
                                        {#if person.phone || person.wechat}
                                            <div class="lvct-region-dialog__person-detail-row">
                                                <Phone size={12} class="lvct-text-muted" />
                                                <span>{person.phone || person.wechat}</span>
                                            </div>
                                        {/if}
                                    </div>
                                </div>
                            {/each}
                        </div>
                    {/if}
                </div>
            {/if}
        </div>
    </div>
</div>

<style>
    .lvct-region-dialog {
        display: flex;
        flex-direction: column;
        height: 600px;
        max-height: 80vh;
        gap: 12px;
        color: var(--b3-theme-on-background);
    }
    .lvct-region-dialog__header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 16px;
        padding-bottom: 8px;
        border-bottom: 1px solid var(--b3-theme-surface-lighter);
    }
    .lvct-region-dialog__header-left {
        display: flex;
        align-items: center;
        gap: 10px;
    }
    :global(.lvct-region-dialog__header-icon) {
        color: var(--b3-theme-primary);
        flex-shrink: 0;
    }
    .lvct-region-dialog__title {
        margin: 0;
        font-size: 15px;
        font-weight: 600;
        line-height: 1.3;
    }
    .lvct-region-dialog__subtitle {
        margin: 2px 0 0 0;
        font-size: 12px;
        color: var(--b3-theme-on-surface);
    }
    .lvct-region-dialog__header-search {
        min-width: 220px;
    }
    .lvct-region-dialog__quick-chips {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: 6px;
        font-size: 12px;
    }
    .lvct-region-dialog__chips-label {
        color: var(--b3-theme-on-surface);
    }
    .lvct-region-dialog__body {
        display: flex;
        flex: 1;
        min-height: 0;
        gap: 16px;
        border: 1px solid var(--b3-theme-surface-lighter);
        border-radius: 6px;
        overflow: hidden;
    }
    /* 左侧城市列表 */
    .lvct-region-dialog__sidebar {
        width: 230px;
        display: flex;
        flex-direction: column;
        border-right: 1px solid var(--b3-theme-surface-lighter);
        background: var(--b3-theme-surface);
    }
    .lvct-region-dialog__sidebar-header {
        padding: 8px 12px;
        font-size: 12px;
        font-weight: 600;
        display: flex;
        justify-content: space-between;
        background: var(--b3-theme-background);
        border-bottom: 1px solid var(--b3-theme-surface-lighter);
    }
    .lvct-region-dialog__city-list {
        flex: 1;
        overflow-y: auto;
        padding: 4px;
        display: flex;
        flex-direction: column;
        gap: 2px;
    }
    .lvct-region-dialog__city-item {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 8px 10px;
        border-radius: 4px;
        background: transparent;
        border: none;
        cursor: pointer;
        text-align: left;
        color: inherit;
        transition: background-color 0.15s ease;
    }
    .lvct-region-dialog__city-item:hover {
        background: var(--b3-theme-surface-lighter);
    }
    .lvct-region-dialog__city-item--active {
        background: var(--b3-theme-primary-lightest);
        color: var(--b3-theme-primary);
        font-weight: 500;
    }
    .lvct-region-dialog__city-info {
        display: flex;
        flex-direction: column;
    }
    .lvct-region-dialog__city-name {
        font-size: 13px;
    }
    .lvct-region-dialog__city-meta {
        font-size: 11px;
        color: var(--b3-theme-on-surface);
    }
    /* 右侧主区域 */
    .lvct-region-dialog__main {
        flex: 1;
        display: flex;
        flex-direction: column;
        min-height: 0;
        background: var(--b3-theme-background);
        padding: 12px;
    }
    .lvct-region-dialog__target-header {
        display: flex;
        justify-content: space-between;
        align-items: flex-start;
        padding-bottom: 12px;
        border-bottom: 1px solid var(--b3-theme-surface-lighter);
        margin-bottom: 12px;
        gap: 12px;
    }
    .lvct-region-dialog__target-title {
        display: flex;
        align-items: center;
        gap: 8px;
    }
    .lvct-region-dialog__target-title h4 {
        margin: 0;
        font-size: 16px;
        font-weight: 600;
    }
    .lvct-region-dialog__nearby {
        display: flex;
        align-items: center;
        flex-wrap: wrap;
        gap: 4px;
        margin-top: 6px;
        font-size: 12px;
    }
    .lvct-region-dialog__nearby-label {
        color: var(--b3-theme-on-surface);
    }
    .lvct-region-dialog__actions {
        display: flex;
        gap: 8px;
        flex-shrink: 0;
    }
    .lvct-region-dialog__contacts-wrap {
        flex: 1;
        min-height: 0;
        overflow-y: auto;
    }
    .lvct-region-dialog__contacts-grid {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
        gap: 10px;
    }
    .lvct-region-dialog__person-card {
        padding: 10px 12px;
        background: var(--b3-theme-surface);
        border: 1px solid var(--b3-theme-surface-lighter);
        border-radius: 6px;
        display: flex;
        flex-direction: column;
        gap: 8px;
    }
    .lvct-region-dialog__person-top {
        display: flex;
        align-items: center;
        gap: 8px;
    }
    .lvct-region-dialog__person-avatar {
        width: 32px;
        height: 32px;
        border-radius: 50%;
        background: var(--b3-theme-primary-lightest);
        color: var(--b3-theme-primary);
        display: flex;
        align-items: center;
        justify-content: center;
        font-weight: 600;
        font-size: 13px;
        flex-shrink: 0;
    }
    .lvct-region-dialog__person-basic {
        flex: 1;
        min-width: 0;
    }
    .lvct-region-dialog__person-name-row {
        display: flex;
        align-items: center;
        gap: 6px;
    }
    .lvct-region-dialog__person-name {
        font-size: 13px;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
    }
    .lvct-region-dialog__person-job {
        display: flex;
        align-items: center;
        gap: 4px;
        font-size: 11px;
        color: var(--b3-theme-on-surface);
        margin-top: 2px;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
    }
    .lvct-region-dialog__person-details {
        font-size: 11px;
        color: var(--b3-theme-on-surface);
        display: flex;
        flex-direction: column;
        gap: 4px;
        padding-top: 6px;
        border-top: 1px dashed var(--b3-theme-surface-lighter);
    }
    .lvct-region-dialog__person-detail-row {
        display: flex;
        align-items: center;
        gap: 6px;
    }
    .lvct-empty-state {
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        flex: 1;
        color: var(--b3-theme-on-surface);
        gap: 8px;
    }
    :global(.lvct-empty-state__icon) {
        opacity: 0.4;
    }
    .font-size-11 { font-size: 11px; }
    .font-size-12 { font-size: 12px; }
    :global(.lvct-text-primary) { color: var(--b3-theme-primary); }
    .lvct-text-muted { color: var(--b3-theme-on-surface); }
</style>

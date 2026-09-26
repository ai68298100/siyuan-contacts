<script lang="ts">
    /**
     * 主工作台：首页(工作空间总览) + 联系人(卡片/表格) + 图谱(M3)。
     */
    import PeopleView from "./people/PeopleView.svelte";
    import type { ContactsSettings } from "../domain/model";
    import { detectCheckinBridge } from "../bridge/checkin";

    let {
        settings,
        isMobile,
        onOpenHostDoc,
        onOpenSettings,
        onOpenPersonDoc,
    }: {
        settings: ContactsSettings;
        isMobile: boolean;
        onOpenHostDoc: () => void;
        onOpenSettings: () => void;
        onOpenPersonDoc: (docId: string) => void;
    } = $props();

    type ViewId = "home" | "people" | "graph";

    const views: readonly { id: ViewId; label: string; enabled: boolean }[] = [
        { id: "home", label: "首页", enabled: true },
        { id: "people", label: "联系人", enabled: true },
        { id: "graph", label: "关系图谱", enabled: false },
    ];

    let current: ViewId = $state("home");
    let bridge = $state(detectCheckinBridge());

    const fieldCount = $derived(Object.keys(settings.fieldMap).length);
</script>

<div class="lvct-workbench fn__flex-column">
    <nav class="lvct-workbench__nav fn__flex">
        {#each views as view (view.id)}
            <button
                class="lvct-workbench__nav-item"
                class:lvct-workbench__nav-item--active={current === view.id}
                disabled={!view.enabled}
                title={view.enabled ? "" : "即将到来"}
                onclick={() => (current = view.id)}
            >
                {view.label}
            </button>
        {/each}
        <span class="fn__flex-1"></span>
        <button class="lvct-workbench__nav-item b3-button--small" title="打开插件设置" onclick={onOpenSettings}>设置</button>
    </nav>

    <div class="lvct-workbench__body fn__flex-1">
        {#if current === "home"}
            <section class="lvct-home">
                <div class="lvct-home__card">
                    <h3>工作空间</h3>
                    <div class="lvct-home__row"><span class="ft__on-surface">笔记本</span><b>{settings.notebookName}</b></div>
                    <div class="lvct-home__row"><span class="ft__on-surface">数据库字段</span><b>{fieldCount} 个</b></div>
                    <div class="lvct-home__row"><span class="ft__on-surface">初始化时间</span><b>{settings.initializedAt.slice(0, 10)}</b></div>
                    <div class="lvct-home__actions">
                        <button class="b3-button b3-button--outline" onclick={onOpenHostDoc}>打开联系人总表</button>
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
                        <p class="ft__smaller ft__on-surface">安装小驴打卡后，生日与纪念日可同步为打卡事项提醒。</p>
                    {/if}
                </div>

                <div class="lvct-home__card">
                    <h3>路线图</h3>
                    <p class="ft__smaller ft__on-surface">
                        关系图谱（M3）· 生日提醒与仪表盘（M4）· 移动端深度适配（M5）
                    </p>
                </div>
            </section>
        {:else if current === "people"}
            <PeopleView {settings} {onOpenPersonDoc} />
        {:else}
            <div class="lvct-placeholder">该视图在后续里程碑中开放。</div>
        {/if}
    </div>

    {#if isMobile}
        <div class="lvct-workbench__mobile-hint ft__smaller ft__on-surface">小屏模式：点击联系人文档名可直接跳转原文档。</div>
    {/if}
</div>

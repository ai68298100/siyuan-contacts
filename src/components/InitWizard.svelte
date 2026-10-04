<script lang="ts">
    /**
     * 初始化向导：一次性建齐 人脉笔记本 → 宿主文档 → 数据库 → 字段 → 双向关联。
     * 只在插件自管设置缺失/不兼容时出现。
     * 幂等可续建（D-0019）：运行前预检并提示将复用哪些已有内容；失败后按钮变为
     * 「继续初始化」，重跑只补缺失，不重复建、不删除已有内容。
     */
    import type { ContactsPluginFacade } from "../types";
    import { HOST_DOC_TITLE } from "../services/init.ts";
    import type { InitProgressStep, WorkspaceSnapshot } from "../services/init";
    import { translateText } from "../domain/translation";
    import { useCloseGuard } from "./close-guard";

    let {
        facade,
        i18n,
        onInitialized,
    }: {
        facade: ContactsPluginFacade;
        i18n?: Readonly<Record<string, string>>;
        onInitialized: (settings: import("../domain/model").ContactsSettings) => void;
    } = $props();
    const text = $derived.by(() => (
        key: string,
        fallback: string,
        values?: Readonly<Record<string, string | number>>,
    ) => translateText(i18n, key, fallback, values));

    /** 进度步骤的服务层回退文案（键表与 i18n 同源；values 由服务层给出） */
    const STEP_FALLBACKS: Record<string, string> = {
        wizardStepNotebookCreate: "创建笔记本「{name}」…",
        wizardStepNotebookReuse: "复用已存在的笔记本「{name}」…",
        wizardStepDocCreate: "创建宿主文档「{name}」…",
        wizardStepDocReuse: "复用已存在的宿主文档「{name}」…",
        wizardStepDbCreate: "创建人脉数据库…",
        wizardStepDbReuse: "复用已存在的人脉数据库…",
        wizardStepFieldsKept: "保留已建字段 {count} 个…",
        wizardStepFieldCreate: "创建字段「{name}」…",
        wizardStepRelationCreate: "配置「{name}」双向关联…",
        wizardStepRelationKept: "双向关联已存在，跳过配置…",
        wizardStepSettings: "保存工作空间设置…",
        wizardStepSelfCreate: "建立本人档案「{name}」…",
        wizardStepSelfPending: "工作空间已就绪，本人档案待续做：{message}。可进入后在设置中继续。",
        wizardStepSelfSkipped: "已跳过本人建档，可稍后在设置中创建或指定。",
        wizardStepDone: "初始化完成 ✔",
    };

    let notebookName: string = $state("人脉");
    let running: boolean = $state(false);
    let errorText: string = $state("");
    let failed: boolean = $state(false);
    let logLines: string[] = $state([]);
    let snapshot: WorkspaceSnapshot | null = $state(null);
    let previewToken: number = 0;
    let createSelf = $state(true);
    let selfPending = $state(false);
    let completedSettings: import("../domain/model").ContactsSettings | null = $state(null);
    useCloseGuard({ busy: () => running, dirty: () => false });

    /** 只读预检：预检自身失败不阻断向导（真实错误在运行时呈现） */
    async function refreshPreview() {
        const token = ++previewToken;
        try {
            const next = await facade.previewInitialize(notebookName);
            if (token === previewToken) snapshot = next;
        } catch {
            if (token === previewToken) snapshot = null;
        }
    }

    // 打开即检、改名后重检（防抖，避免逐字请求内核）
    $effect(() => {
        void notebookName;
        const timer = window.setTimeout(() => void refreshPreview(), 250);
        return () => window.clearTimeout(timer);
    });

    function pushLog(step: InitProgressStep) {
        if (step.key === "wizardStepSelfPending") selfPending = true;
        logLines = [...logLines, text(step.key, STEP_FALLBACKS[step.key] ?? step.key, step.values)];
    }

    async function run() {
        if (running) return;
        running = true;
        errorText = "";
        logLines = [];
        selfPending = false;
        try {
            const settings = await facade.initialize(notebookName, pushLog, { createSelf });
            if (selfPending) completedSettings = settings;
            else onInitialized(settings);
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            errorText = message;
            failed = true;
            logLines = [...logLines, `✕ ${message}`];
            await refreshPreview();
        } finally {
            running = false;
        }
    }
</script>

<div class="lvct-wizard">
    <header class="lvct-wizard__header">
        <svg class="lvct-wizard__logo"><use xlink:href="#iconLvContacts"></use></svg>
        <div>
            <h2>{text("wizardWelcome", "欢迎使用小驴人脉")}</h2>
            <p>{text("wizardIntro", "三步建好你的人脉工作空间：笔记本、数据库、关系字段一次配齐。")}</p>
        </div>
    </header>

    <label class="lvct-wizard__field">
        <span class="ft__on-surface">{text("wizardNotebookLabel", "人脉笔记本名称")}</span>
        <input class="b3-text-field" type="text" bind:value={notebookName} disabled={running} />
    </label>
    <p class="b3-label ft__smaller ft__on-surface">
        {text("wizardNotebookDesc", "将在工作空间新建一个笔记本存放联系人文档；每个联系人是一篇文档，可正常双链、搜索。")}
    </p>
    <label class="b3-label">
        <input type="checkbox" bind:checked={createSelf} disabled={running || completedSettings !== null} />
        {text("wizardCreateSelf", "同时建立本人档案「我自己」（可跳过，稍后在设置中指定）")}
    </label>

    {#if snapshot}
        <div class="lvct-wizard__plan" aria-live="polite">
            {#if snapshot.notebook}
                <p>
                    ✓ {notebookName.trim().length > 0 && snapshot.notebooks.length > 1
                        ? text("wizardReuseNotebookMulti", "存在 {count} 个同名笔记本「{name}」，将复用其中已建有人脉内容的那个，不会删除或覆盖已有内容。", { count: snapshot.notebooks.length, name: notebookName.trim() })
                        : text("wizardReuseNotebook", "已存在笔记本「{name}」，将复用它已建成的部分，不会删除或覆盖已有内容。", { name: notebookName.trim() })}
                </p>
                {#if snapshot.hostDocId}
                    <p>✓ {text("wizardReuseHostDoc", "将复用已有的「{name}」文档。", { name: HOST_DOC_TITLE })}</p>
                {/if}
                {#if snapshot.avId}
                    <p>✓ {text("wizardReuseDatabase", "将复用已有的联系人数据库，只补齐缺失字段。")}</p>
                {/if}
                {#if snapshot.existingFields.length > 0}
                    <p>
                        ✓ {text("wizardReuseFields", "将保留已建字段：{fields}。", {
                            fields: snapshot.existingFields.join("、"),
                        })}
                    </p>
                {/if}
                <p class="ft__smaller ft__on-surface">
                    {text("wizardReuseHint", "想全新开始？换个笔记本名称即可；本向导从不删除已有内容。")}
                </p>
            {:else}
                <p>
                    ✚ {text("wizardFreshPlan", "将新建笔记本「{name}」、「{doc}」文档与人脉数据库。", {
                        name: notebookName.trim(),
                        doc: HOST_DOC_TITLE,
                    })}
                </p>
            {/if}
            <button class="b3-button b3-button--text ft__smaller" onclick={() => void refreshPreview()} disabled={running}>
                {text("wizardRecheck", "重新检测")}
            </button>
        </div>
    {/if}

    {#if errorText}
        <div class="lvct-wizard__error">
            <div>{text("wizardFailed", "初始化失败：")}{errorText}</div>
            <p class="ft__smaller lvct-wizard__error-hint">
                {text("wizardResumeHint", "已建成的部分已保留：排除原因后再次点击「继续初始化」，将从断点续建，不会重复创建或删除已有内容。")}
            </p>
        </div>
    {/if}

    {#if completedSettings}
        <div class="lvct-wizard__error" role="status">{text("wizardSelfPending", "工作空间已经初始化，本人档案尚未确认。进入后可在设置中继续或指定已有联系人。")}</div>
        <button class="b3-button lvct-wizard__cta" onclick={() => { if (completedSettings) onInitialized(completedSettings); }}>
            {text("wizardEnterWorkspace", "进入工作空间")}
        </button>
    {:else}
    <button class="b3-button lvct-wizard__cta" onclick={run} disabled={running || notebookName.trim().length === 0}>
        {running
            ? text("wizardRunning", "正在初始化…")
            : failed
                ? text("wizardContinue", "继续初始化")
                : text("wizardStart", "开始初始化")}
    </button>
    {/if}

    {#if running}
        <div class="lvct-wizard__progress" role="progressbar" aria-label={text("wizardProgressLabel", "初始化进行中")}>
            <i></i>
        </div>
    {/if}

    {#if logLines.length > 0}
        <div class="lvct-wizard__log" role="log" aria-live="polite">
            {#each logLines as line, index (index)}
                <div>{line}</div>
            {/each}
        </div>
    {/if}
</div>

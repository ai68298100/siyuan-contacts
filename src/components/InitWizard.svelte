<script lang="ts">
    /**
     * 初始化向导：一次性建齐 人脉笔记本 → 宿主文档 → 数据库 → 字段 → 双向关联。
     * 只在插件自管设置缺失/不兼容时出现。
     */
    import type { ContactsPluginFacade } from "../types";
    import { translateText } from "../domain/translation";

    let {
        facade,
        i18n,
        onInitialized,
    }: {
        facade: ContactsPluginFacade;
        i18n?: Readonly<Record<string, string>>;
        onInitialized: (settings: import("../domain/model").ContactsSettings) => void;
    } = $props();
    const text = $derived.by(() => (key: string, fallback: string) => translateText(i18n, key, fallback));

    let notebookName: string = $state("人脉");
    let running: boolean = $state(false);
    let errorText: string = $state("");
    let logLines: string[] = $state([]);

    function pushLog(line: string) {
        logLines = [...logLines, line];
    }

    async function run() {
        if (running) return;
        running = true;
        errorText = "";
        logLines = [];
        try {
            const settings = await facade.initialize(notebookName, pushLog);
            onInitialized(settings);
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            errorText = message;
            pushLog(`✕ ${message}`);
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

    {#if errorText}
        <div class="lvct-wizard__error">
            <div>{text("wizardFailed", "初始化失败：")}{errorText}</div>
        </div>
    {/if}

    <button class="b3-button b3-button--text" onclick={run} disabled={running || notebookName.trim().length === 0}>
        {running ? text("wizardRunning", "正在初始化…") : text("wizardStart", "开始初始化")}
    </button>

    {#if logLines.length > 0}
        <div class="lvct-wizard__log">
            {#each logLines as line (line)}
                <div>{line}</div>
            {/each}
        </div>
    {/if}
</div>

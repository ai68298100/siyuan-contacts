<script lang="ts">
    /** FAST-01.1 粘贴并识别：本地解析（domain/quick-fill）→ 分组预览 → 用户勾选后才回填草稿。
     *  不直接写库：onApply 只把勾选项交给调用方的草稿，B06 守卫与既有保存路径继续生效。 */
    import { parseContactText, CONTACT_TEMPLATE } from "../../domain/quick-fill";
    import type { QuickFillItem, QuickFillResult } from "../../domain/quick-fill";
    import { quickFillDefaultIndexes } from "../../domain/import.ts";
    import LvctDialog from "../LvctDialog.svelte";
    import { useCloseGuard } from "../close-guard";
    import { translateText } from "../../domain/translation";

    let {
        i18n,
        existing,
        initialResult,
        onApply,
        onClose,
    }: {
        i18n?: Readonly<Record<string, string>>;
        /** 当前草稿值（判定 新增/冲突/已一致） */
        existing: {
            name: string; phone: string; email: string; wechat: string;
            website: string; birthday: string; isLunar?: boolean; group: string; tags: readonly string[];
        };
        /** FAST-01.3：外部已解析好的结果（选区/整篇文档识别），直接进预览阶段 */
        initialResult?: QuickFillResult;
        onApply: (patch: {
            name?: string; phone?: string; email?: string; wechat?: string;
            website?: string; birthday?: string; isLunar?: boolean; group?: string;
            tagsAppend: string[];
        }) => void;
        onClose: () => void;
    } = $props();
    const text = $derived.by(() => (key: string, fallback: string, values?: Record<string, string | number>) =>
        translateText(i18n, key, fallback, values));

    const FIELD_LABELS: Record<string, string> = {
        name: "formName", phone: "formPhone", email: "formEmail", wechat: "formWechat",
        website: "formWebsite", birthday: "formBirthday", group: "formGroup", tags: "formTagsLabel",
    };
    const FIELD_FALLBACKS: Record<string, string> = {
        name: "姓名", phone: "电话", email: "邮箱", wechat: "微信",
        website: "网站", birthday: "生日", group: "分组", tags: "标签",
    };
    /** 单值字段：同字段多个候选时互斥（单选语义）；tags 可多选 */
    const SINGLE_FIELDS = new Set(["name", "phone", "email", "wechat", "website", "birthday", "group"]);

    // svelte-ignore state_referenced_locally
    let pasteText = $state("");
    // svelte-ignore state_referenced_locally
    let previewed = $state(initialResult !== undefined);
    // svelte-ignore state_referenced_locally
    let result = $state<QuickFillResult | null>(initialResult ?? null);
    let checked = $state(new Set<string>());
    /* FAST-01.2：可复制空白模板（剪贴板不可用时静默，用户仍可从文档手抄） */
    let templateCopied = $state(false);
    let templateTimer: ReturnType<typeof setTimeout> | undefined;
    async function copyTemplate() {
        try {
            await navigator.clipboard.writeText(CONTACT_TEMPLATE);
            templateCopied = true;
            clearTimeout(templateTimer);
            templateTimer = setTimeout(() => (templateCopied = false), 2000);
        } catch { /* 非安全上下文等场景忽略 */ }
    }

    function fieldLabel(item: QuickFillItem): string {
        return text(FIELD_LABELS[item.field], FIELD_FALLBACKS[item.field]);
    }
    function itemKey(item: QuickFillItem, index: number): string {
        return `${item.field}:${item.value}:${index}`;
    }
    function currentValue(item: QuickFillItem): string {
        if (item.field === "tags") return "";
        return String((existing as Record<string, unknown>)[item.field] ?? "");
    }
    /** 无年份生日当前契约无法写入：可预览、不可勾选 */
    function notWritable(item: QuickFillItem): boolean {
        return item.field === "birthday" && /^\d{2}-\d{2}$/.test(item.value);
    }
    /** 已一致（同名同值）不展示；其余返回 true */
    function isRedundant(item: QuickFillItem): boolean {
        if (item.field === "tags") return existing.tags.includes(item.value);
        if (item.field === "birthday" && existing.isLunar !== undefined) return currentValue(item) === item.value && existing.isLunar === Boolean(item.note?.includes("农历"));
        return currentValue(item) === item.value;
    }
    function conflict(item: QuickFillItem): boolean {
        if (item.field === "tags") return false;
        const value = currentValue(item);
        return value.length > 0 && value !== item.value;
    }
    function visibleItems(): QuickFillItem[] {
        return (result?.items ?? []).filter((item) => !isRedundant(item));
    }
    function recognize() {
        result = parseContactText(pasteText);
        previewed = true;
        selectDefaults();
    }
    /** 默认勾选：无冲突且可写的新增值（已有值默认不覆盖，用户明确选择后才写入） */
    function selectDefaults() {
        const next = new Set<string>();
        const items = visibleItems();
        const defaults = quickFillDefaultIndexes({ items, unrecognized: result?.unrecognized ?? [] }, { ...existing, tags: [...existing.tags] });
        for (const index of defaults) {
            next.add(itemKey(items[index], index));
        }
        checked = next;
    }
    /* 外部传入 initialResult（FAST-01.3）时初始化默认勾选 */
    $effect(() => {
        if (initialResult) selectDefaults();
    });
    function toggle(item: QuickFillItem, index: number) {
        const key = itemKey(item, index);
        const next = new Set(checked);
        if (next.has(key)) {
            next.delete(key);
        } else {
            if (SINGLE_FIELDS.has(item.field)) {
                for (const [otherIndex, other] of visibleItems().entries()) {
                    if (other.field === item.field) next.delete(itemKey(other, otherIndex));
                }
            }
            next.add(key);
        }
        checked = next;
    }
    function apply() {
        const patch: Parameters<typeof onApply>[0] = { tagsAppend: [] };
        let lunar = false;
        for (const [index, item] of visibleItems().entries()) {
            if (!checked.has(itemKey(item, index))) continue;
            if (item.field === "tags") {
                patch.tagsAppend.push(item.value);
            } else if (item.field === "birthday") {
                patch.birthday = item.value;
                if (item.note?.includes("农历")) lunar = true;
            } else {
                (patch as unknown as Record<string, string>)[item.field] = item.value;
            }
        }
        if (patch.birthday) patch.isLunar = lunar;
        onApply(patch);
        onClose();
    }

    /* V-02/D-40 语义补齐：粘贴未识别、或识别结果未应用即关闭=丢草稿，经守卫确认放弃。
       apply() 是完成动作，直接 onClose 不拦（调用方在 onApply 后自行关闭）。 */
    function hasUnsavedDraft(): boolean {
        if (previewed) return visibleItems().length > 0;
        return pasteText.trim().length > 0;
    }
    const guardedClose = useCloseGuard({
        busy: () => false,
        dirty: () => hasUnsavedDraft(),
    });
    function requestClose(): void {
        void guardedClose(onClose);
    }
</script>

<LvctDialog title={text("qfTitle", "粘贴并识别")} onClose={requestClose}>
    <div class="lvct-qf">
        {#if !previewed}
            <p class="ft__smaller ft__on-surface">
                {text("qfIntro", "粘贴名片文字、聊天记录或键值清单；识别在本机完成，结果经你确认后才会填入表单。")}
                <button type="button" class="b3-button b3-button--text lvct-qf__copy" onclick={copyTemplate}>
                    {templateCopied ? text("qfCopied", "已复制 ✓") : text("qfCopyTemplate", "复制空白模板")}
                </button>
            </p>
            <textarea class="b3-text-field fn__block lvct-qf__input" rows="7"
                placeholder={text("qfPlaceholder", "张三\n手机：13800138000\n微信：zhang_san\n邮箱：a@example.com")}
                bind:value={pasteText}></textarea>
            <div class="lvct-form__actions">
                <button class="b3-button b3-button--cancel" onclick={requestClose}>{text("formCancel", "取消")}</button>
                <button class="b3-button" disabled={pasteText.trim().length === 0} onclick={recognize}>{text("qfRecognize", "识别")}</button>
            </div>
        {:else}
            <p class="ft__smaller">来源：本地粘贴/单人表格；目标：当前一个草稿。每项显示原文 → 字段；不同候选值须单选，未识别内容保留并忽略，不直接写联系人。</p>
            {#if visibleItems().length === 0 && (result?.unrecognized.length ?? 0) === 0}
                <p class="ft__on-surface">{text("qfEmpty", "没有识别到可填充的内容。")}</p>
            {/if}
            {#each visibleItems() as item, index (itemKey(item, index))}
                <label class="lvct-qf__item" class:lvct-qf__item--conflict={conflict(item)}>
                    <input type="checkbox" checked={checked.has(itemKey(item, index))}
                        disabled={notWritable(item)}
                        onchange={() => toggle(item, index)} />
                    <span class="lvct-qf__field">{fieldLabel(item)}</span>
                    <span class="lvct-qf__value">
                        {item.value}
                        {#if item.note}<small class="ft__smaller ft__on-surface">（{item.note}）</small>{/if}
                        {#if conflict(item)}
                            <small class="ft__smaller ft__on-surface">{text("qfConflict", "将覆盖当前值：{value}", { value: currentValue(item) })}</small>
                        {/if}
                        {#if notWritable(item)}
                            <small class="ft__smaller ft__on-surface">{text("qfNoYear", "缺少年份，暂不能写入；可先补全年份再识别")}</small>
                        {/if}
                    </span>
                    <span class="lvct-qf__raw ft__smaller ft__on-surface" title={item.raw}>{item.raw}</span>
                </label>
            {/each}
            {#if (result?.unrecognized.length ?? 0) > 0}
                <div class="lvct-qf__unrecognized">
                    <b class="ft__smaller">{text("qfUnrecognized", "无法识别（已保留原文，未做任何写入）")}</b>
                    {#each result!.unrecognized as line (line)}
                        <div class="ft__smaller ft__on-surface">{line}</div>
                    {/each}
                </div>
            {/if}
            <div class="lvct-form__actions">
                <button class="b3-button b3-button--cancel" onclick={requestClose}>{text("formCancel", "取消")}</button>
                <button class="b3-button" disabled={checked.size === 0} onclick={apply}>
                    {text("qfApply", "应用到表单（{n}）", { n: checked.size })}
                </button>
            </div>
        {/if}
    </div>
</LvctDialog>

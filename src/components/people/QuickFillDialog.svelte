<script lang="ts">
    /** FAST-01.1 粘贴并识别：本地解析（domain/quick-fill）→ 分组预览 → 用户勾选后才回填草稿。
     *  不直接写库：onApply 只把勾选项交给调用方的草稿，B06 守卫与既有保存路径继续生效。 */
    import { parseContactText } from "../../domain/quick-fill";
    import type { QuickFillItem } from "../../domain/quick-fill";
    import LvctDialog from "../LvctDialog.svelte";
    import { translateText } from "../../domain/translation";

    let {
        i18n,
        existing,
        onApply,
        onClose,
    }: {
        i18n?: Readonly<Record<string, string>>;
        /** 当前草稿值（判定 新增/冲突/已一致） */
        existing: {
            name: string; phone: string; email: string; wechat: string;
            website: string; birthday: string; group: string; tags: readonly string[];
        };
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

    let pasteText = $state("");
    let previewed = $state(false);
    let result = $state<ReturnType<typeof parseContactText> | null>(null);
    let checked = $state(new Set<string>());

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
        checked = new Set();
        previewed = true;
        /* 默认勾选：无冲突且可写的新增值（已有值默认不覆盖，用户明确选择后才写入） */
        for (const [index, item] of visibleItems().entries()) {
            if (!conflict(item) && !notWritable(item)) checked.add(itemKey(item, index));
        }
    }
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
        if (patch.birthday && lunar) patch.isLunar = true;
        onApply(patch);
        onClose();
    }
</script>

<LvctDialog title={text("qfTitle", "粘贴并识别")} onClose={onClose}>
    <div class="lvct-qf">
        {#if !previewed}
            <p class="ft__smaller ft__on-surface">{text("qfIntro", "粘贴名片文字、聊天记录或键值清单；识别在本机完成，结果经你确认后才会填入表单。")}</p>
            <textarea class="b3-text-field fn__block lvct-qf__input" rows="7"
                placeholder={text("qfPlaceholder", "张三\n手机：13800138000\n微信：zhang_san\n邮箱：a@example.com")}
                bind:value={pasteText}></textarea>
            <div class="lvct-form__actions">
                <button class="b3-button b3-button--cancel" onclick={onClose}>{text("formCancel", "取消")}</button>
                <button class="b3-button" disabled={pasteText.trim().length === 0} onclick={recognize}>{text("qfRecognize", "识别")}</button>
            </div>
        {:else}
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
                <button class="b3-button b3-button--cancel" onclick={onClose}>{text("formCancel", "取消")}</button>
                <button class="b3-button" disabled={checked.size === 0} onclick={apply}>
                    {text("qfApply", "应用到表单（{n}）", { n: checked.size })}
                </button>
            </div>
        {/if}
    </div>
</LvctDialog>

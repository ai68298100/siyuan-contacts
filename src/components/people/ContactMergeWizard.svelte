<script lang="ts">
    /** E-31 重复人物字段级安全合并向导：并排比对+逐字段主次选择+确认预览+回滚。 */
    import {
        buildDefaultMergePlan,
        resolveMergePlan,
        validateMergePlan,
        type ContactMergePlan,
        type FieldMergeSelection,
        type MergeAuditSnapshot,
    } from "../../domain/duplicate-merge";
    import { translateText } from "../../domain/translation";
    import { confirmDialog } from "../../libs/confirm-dialog";
    import { requestErrorMessage } from "../../shared/error-presenter";
    import { tick } from "svelte";
    import type { ContactSummary } from "../../domain/person";
    import { ChevronLeft, ChevronRight, ShieldAlert } from "@lucide/svelte";

    let {
        i18n,
        primary,
        secondary,
        onConfirm,
        onClose,
    }: {
        i18n?: Readonly<Record<string, string>>;
        primary: ContactSummary;
        secondary: ContactSummary;
        /** 二次确认真正合并。返回修正后的 primary 资料，外部负责写回数据库。 */
        onConfirm: (params: { primaryDocId: string; draft: ReturnType<typeof resolveMergePlan>["draft"]; auditSnapshot: MergeAuditSnapshot; removedSecondaryDocId: string }) => Promise<void> | void;
        onClose: () => void;
    } = $props();

    const text = $derived.by(() => (key: string, fallback: string, values?: Record<string, string | number>) =>
        translateText(i18n, key, fallback, values));

    // svelte-ignore state_referenced_locally
    let plan = $state<ContactMergePlan>(buildDefaultMergePlan(primary, secondary));
    const validationErrors = $derived(validateMergePlan(plan));
    const resolved = $derived(validationErrors.length === 0 ? resolveMergePlan(plan) : null);

    const fieldLabels: Record<keyof ContactMergePlan["fields"], string> = {
        name: "姓名",
        phone: "电话",
        email: "邮箱",
        wechat: "微信",
        website: "网站",
        birthday: "生日",
        group: "分组",
    };
    const primaryValue = (key: keyof ContactMergePlan["fields"]): string => (primary as never)[key] ?? "";
    const secondaryValue = (key: keyof ContactMergePlan["fields"]): string => (secondary as never)[key] ?? "";

    // svelte-ignore state_referenced_locally
    let tagsInput = $state(plan.additionalTags?.join("、") ?? "");
    let submitting = $state(false);
    let errorText = $state("");

    function updateFieldChoice(key: keyof ContactMergePlan["fields"], choice: FieldMergeSelection["choice"], customValue?: string): void {
        plan = { ...plan, fields: { ...plan.fields, [key]: { choice, customValue } } };
    }

    function switchPrimarySecondary(): void {
        // 切换主次人物（用户可能想保留 B 资料）
        const swapped: ContactMergePlan = buildDefaultMergePlan(secondary, primary);
        plan = { ...swapped, fields: plan.fields, tagsMode: plan.tagsMode, additionalTags: plan.additionalTags };
    }

    function setTagsMode(mode: ContactMergePlan["tagsMode"]): void {
        plan = { ...plan, tagsMode: mode };
    }

    function parseTagsInput(): string[] {
        return tagsInput
            .split(/[、,，\s]+/)
            .map((tag) => tag.trim())
            .filter(Boolean);
    }

    async function handleConfirm(): Promise<void> {
        if (validationErrors.length > 0) {
            errorText = validationErrors.join("；");
            return;
        }
        const result = resolveMergePlan(plan);
        const confirm = await confirmDialog({
            title: text("mergeConfirmTitle", "确认合并"),
            message: text(
                "mergeConfirmMsg",
                `将「${secondary.name}」的资料合并到「${primary.name}」并从名册解绑次人物。人物文档与互动/关系历史保留。`,
            ),
            confirmLabel: text("mergeConfirmBtn", "执行合并"),
            cancelLabel: text("mergeCancelBtn", "取消"),
            danger: true,
        });
        if (!confirm) return;
        submitting = true;
        errorText = "";
        try {
            await onConfirm({
                primaryDocId: primary.docId,
                draft: result.draft,
                auditSnapshot: result.auditSnapshot,
                removedSecondaryDocId: secondary.docId,
            });
            onClose();
        } catch (error) {
            errorText = requestErrorMessage(error);
        } finally {
            submitting = false;
        }
    }

    let liveAnnounce = $state("");
    $effect(() => {
        // 焦点管理：进入弹窗时自动聚焦主标题，便于读屏
        tick().then(() => {
            const heading = document.querySelector(".lvct-merge__title");
            heading?.setAttribute("tabindex", "-1");
            (heading as HTMLElement | null)?.focus();
        });
    });
</script>

<div class="lvct-merge" role="dialog" aria-modal="true" aria-labelledby="lvct-merge-title">
    <header class="lvct-merge__head">
        <h3 id="lvct-merge-title" class="lvct-merge__title">{translateText(i18n, "mergeTitle", "合并重复联系人")}</h3>
        <p class="ft__smaller ft__on-surface">
            并排比对 <b>{primary.name}</b> 与 <b>{secondary.name}</b>，逐字段选择保留方。可随时重置默认值。人物文档与互动、关系历史会保留。
        </p>
        <div class="lvct-merge__switch" role="group" aria-label="切换主次人物">
            <button class="b3-button b3-button--text" type="button" onclick={switchPrimarySecondary}>
                <ChevronLeft size={14}/> 切换主次 <ChevronRight size={14}/>
            </button>
        </div>
    </header>

    <div class="lvct-merge__headrow" role="row">
        <div class="lvct-merge__col lvct-merge__col--label">字段</div>
        <div class="lvct-merge__col">主人物（保留）：<b>{primary.name}</b></div>
        <div class="lvct-merge__col">次人物（合并后解绑）：<b>{secondary.name}</b></div>
        <div class="lvct-merge__col lvct-merge__col--choice">选择保留方</div>
    </div>

    {#each Object.entries(fieldLabels) as [field, label] (field)}
        {@const sel = plan.fields[field as keyof ContactMergePlan["fields"]]}
        <div class="lvct-merge__row" role="row">
            <div class="lvct-merge__col lvct-merge__col--label">{label}</div>
            <div class="lvct-merge__col" data-field-primary={field}>{primaryValue(field as keyof ContactMergePlan["fields"]) || "—"}</div>
            <div class="lvct-merge__col" data-field-secondary={field}>{secondaryValue(field as keyof ContactMergePlan["fields"]) || "—"}</div>
            <div class="lvct-merge__col lvct-merge__col--choice" role="radiogroup" aria-label={`${label} 保留方`}>
                <label class="lvct-merge__radio">
                    <input
                        type="radio"
                        name={`merge-${field}`}
                        value="primary"
                        checked={sel.choice === "primary"}
                        onchange={() => updateFieldChoice(field as keyof ContactMergePlan["fields"], "primary")}
                    />
                    <span>主</span>
                </label>
                <label class="lvct-merge__radio">
                    <input
                        type="radio"
                        name={`merge-${field}`}
                        value="secondary"
                        checked={sel.choice === "secondary"}
                        onchange={() => updateFieldChoice(field as keyof ContactMergePlan["fields"], "secondary")}
                    />
                    <span>次</span>
                </label>
                <label class="lvct-merge__radio">
                    <input
                        type="radio"
                        name={`merge-${field}`}
                        value="custom"
                        checked={sel.choice === "custom"}
                        onchange={() => updateFieldChoice(field as keyof ContactMergePlan["fields"], "custom", "")}
                    />
                    <span>自定义</span>
                </label>
                {#if sel.choice === "custom"}
                    <input
                        class="b3-text-field fn__block lvct-merge__custom"
                        type="text"
                        value={sel.customValue ?? ""}
                        oninput={(event) => updateFieldChoice(field as keyof ContactMergePlan["fields"], "custom", (event.currentTarget as HTMLInputElement).value)}
                        aria-label={`${label} 自定义值`}
                    />
                {/if}
            </div>
        </div>
    {/each}

    <div class="lvct-merge__row lvct-merge__row--tags" role="row">
        <div class="lvct-merge__col lvct-merge__col--label">标签</div>
        <div class="lvct-merge__col" data-field-primary="tags">{primary.tags.join("、") || "—"}</div>
        <div class="lvct-merge__col" data-field-secondary="tags">{secondary.tags.join("、") || "—"}</div>
        <div class="lvct-merge__col lvct-merge__col--choice" role="group" aria-label="标签合并模式">
            <label class="lvct-merge__radio">
                <input type="radio" name="merge-tags" value="union" checked={plan.tagsMode === "union"} onchange={() => setTagsMode("union")} />
                <span>并集去重</span>
            </label>
            <label class="lvct-merge__radio">
                <input type="radio" name="merge-tags" value="primary" checked={plan.tagsMode === "primary"} onchange={() => setTagsMode("primary")} />
                <span>仅主</span>
            </label>
            <label class="lvct-merge__radio">
                <input type="radio" name="merge-tags" value="secondary" checked={plan.tagsMode === "secondary"} onchange={() => setTagsMode("secondary")} />
                <span>仅次</span>
            </label>
            <input
                class="b3-text-field fn__block lvct-merge__custom"
                type="text"
                placeholder="追加标签（顿号、逗号或空格分隔）"
                value={tagsInput}
                oninput={(event) => { tagsInput = (event.currentTarget as HTMLInputElement).value; plan = { ...plan, additionalTags: parseTagsInput() }; }}
                aria-label="追加标签"
            />
        </div>
    </div>

    {#if resolved}
        <section class="lvct-merge__preview" aria-label="合并预览">
            <h4>合并预览</h4>
            <dl class="lvct-merge__preview-grid">
                <div><dt>姓名</dt><dd>{resolved.draft.name}</dd></div>
                <div><dt>电话</dt><dd>{resolved.draft.phone || "—"}</dd></div>
                <div><dt>邮箱</dt><dd>{resolved.draft.email || "—"}</dd></div>
                <div><dt>微信</dt><dd>{resolved.draft.wechat || "—"}</dd></div>
                <div><dt>网站</dt><dd>{resolved.draft.website || "—"}</dd></div>
                <div><dt>生日</dt><dd>{resolved.draft.birthday || "—"}{resolved.draft.isLunar ? "（农历）" : ""}</dd></div>
                <div><dt>分组</dt><dd>{resolved.draft.group || "—"}</dd></div>
                <div><dt>标签</dt><dd>{resolved.draft.tags.join("、") || "—"}</dd></div>
            </dl>
        </section>
    {/if}

    {#if validationErrors.length > 0}
        <div class="lvct-merge__errors" role="alert">
            <ShieldAlert size={16}/> 校验未通过：{validationErrors.join("；")}
        </div>
    {/if}

    {#if errorText}<p class="lvct-form__error" role="alert">{errorText}</p>{/if}
    <p class="ft__smaller ft__on-surface" role="status" aria-live="polite">{liveAnnounce}</p>

    <footer class="lvct-merge__footer">
        <button class="b3-button b3-button--outline" type="button" onclick={onClose} disabled={submitting}>取消</button>
        <button class="b3-button b3-button--cancel" type="button" onclick={handleConfirm} disabled={submitting || validationErrors.length > 0}>
            {submitting ? "执行中…" : "执行合并"}
        </button>
    </footer>
</div>

<style>
.lvct-merge {
    display: flex;
    flex-direction: column;
    gap: 12px;
    min-width: 0;
}
.lvct-merge__head {
    display: flex;
    flex-direction: column;
    gap: 4px;
}
.lvct-merge__switch { display: flex; }
.lvct-merge__headrow, .lvct-merge__row {
    display: grid;
    grid-template-columns: 80px minmax(0, 1fr) minmax(0, 1fr) 220px;
    gap: 8px;
    align-items: center;
    padding: 6px 8px;
    border-bottom: 1px dashed var(--b3-border-color, rgba(0,0,0,0.08));
}
.lvct-merge__col { min-width: 0; overflow-wrap: anywhere; }
.lvct-merge__col--label { font-weight: 600; }
.lvct-merge__col--choice { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
.lvct-merge__radio { display: inline-flex; align-items: center; gap: 4px; }
.lvct-merge__custom { width: 100%; min-width: 120px; }
.lvct-merge__preview {
    border: 1px solid var(--b3-border-color, rgba(0,0,0,0.16));
    border-radius: 6px;
    padding: 8px 12px;
    background: var(--b3-theme-surface, transparent);
}
.lvct-merge__preview h4 { margin: 0 0 8px 0; }
.lvct-merge__preview-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(min(100%, 160px), 1fr));
    gap: 6px 12px;
    margin: 0;
}
.lvct-merge__preview-grid dt { color: var(--b3-theme-on-surface-light); font-size: 12px; }
.lvct-merge__preview-grid dd { margin: 0; }
.lvct-merge__errors {
    display: flex;
    align-items: center;
    gap: 6px;
    color: var(--b3-theme-error);
    background: color-mix(in srgb, var(--b3-theme-error) 12%, transparent);
    padding: 6px 10px;
    border-radius: 4px;
}
.lvct-merge__footer {
    display: flex;
    gap: 8px;
    justify-content: flex-end;
    margin-top: 8px;
}
</style>

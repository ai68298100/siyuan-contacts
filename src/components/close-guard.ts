/**
 * 关闭守卫（B06 重做）：拦截未保存修改，给出「保存并离开 / 放弃并离开 / 取消」
 * 三选一与改动明细，替代宿主原生 confirm（原生框说不清改了什么、也没有保存出口）。
 *
 * 作用域模型（含 Svelte 5 snippet 边界的现实）：
 * - createCloseScope()：LvctDialog / Workbench 各建一个作用域；父链经 getContext 连接，
 *   对话框作用域自动登记为工作台作用域的子作用域。
 * - useCloseGuard(item)：注册单个守卫项。注意：对话框的 children 片段在**定义处**的
 *   上下文里初始化（Svelte 5 语义），因此内容的守卫项通常落在工作台根作用域，而不是
 *   包着它的 LvctDialog 作用域——这不是 bug，是解析规则的一部分。
 * - 关闭解析顺序：自身作用域 → 沿父链向上 → 孤儿作用域（无上下文的独立挂载内容，
 *   如 svelteDialog 直挂的捕获弹窗）。第一个非空聚合生效。
 * - 语义与旧版一致：busy 时不关；脏时先过弹窗；「保存并离开」失败留在原地。
 * 文案经 configureCloseGuardI18n 接入双语（模块层拿不到组件的 i18n prop）。
 */
import { getContext, onMount, setContext } from "svelte";
import { translateText } from "../domain/translation";

const KEY = Symbol("lvct-close-guard");

export interface CloseGuardItem {
    /** 忙碌时不允许关闭（静默阻止，与旧版一致） */
    busy: () => boolean;
    dirty: () => boolean;
    /** 改动明细，每条一句话；缺省时显示通用文案 */
    changes?: () => string[];
    /** 提供「保存并离开」；未提供则弹窗只有 放弃/取消 */
    save?: () => Promise<void>;
}

export interface CloseGuardSummary {
    changes: string[];
    canSave: boolean;
    save: () => Promise<void>;
}

export interface CloseScope {
    hasBlocked: () => boolean;
    dirtyChanges: () => CloseGuardSummary | null;
    requestClose: () => Promise<boolean>;
    addItem: (item: CloseGuardItem) => void;
    removeItem: (item: CloseGuardItem) => void;
}

interface ScopeInternals {
    parent?: CloseScope & ScopeInternals;
}

let guardI18n: Readonly<Record<string, string>> | undefined;

/** 插件入口注入宿主语言资源（index.ts onload 调用一次） */
export function configureCloseGuardI18n(i18n?: Readonly<Record<string, string>>): void {
    guardI18n = i18n;
}

function text(key: string, fallback: string, values?: Record<string, string | number>): string {
    return translateText(guardI18n, key, fallback, values);
}

function aggregate(items: Iterable<CloseGuardItem>): CloseGuardSummary | null {
    const changes: string[] = [];
    let canSave = true;
    const saves: Array<() => Promise<void>> = [];
    for (const item of items) {
        if (item.busy() || !item.dirty()) continue;
        changes.push(...(item.changes?.() ?? [text("guardGenericChange", "有未保存的修改")]));
        if (item.save) saves.push(item.save);
        else canSave = false;
    }
    if (changes.length === 0) return null;
    return { changes, canSave, save: async () => { for (const save of saves) await save(); } };
}

function createRegistryScope(): CloseScope {
    const items = new Set<CloseGuardItem>();
    return {
        hasBlocked: () => [...items].some((item) => item.busy()),
        dirtyChanges: () => aggregate(items),
        requestClose: () => requestScopeClose(aggregate(items)),
        addItem: (item) => { items.add(item); allGuardItems.add(item); },
        removeItem: (item) => { items.delete(item); allGuardItems.delete(item); },
    };
}

/** FUNC-01.7：跨作用域的脏草稿全量查询（工作台数据变化提示用）。
 *  项在守卫组件卸载时经 removeItem 移除，注册表不留悬挂项。 */
const allGuardItems = new Set<CloseGuardItem>();

export function anyDirtyChanges(): CloseGuardSummary | null {
    return aggregate(allGuardItems);
}

/** 无上下文的独立挂载内容（svelteDialog 直挂的弹窗等）兜底作用域 */
const orphanScope: CloseScope = createRegistryScope();

export function createCloseScope(): CloseScope {
    const parent = getContext<CloseScope & ScopeInternals | undefined>(KEY);
    const scope = createRegistryScope();
    const withParent = scope as CloseScope & ScopeInternals;
    withParent.parent = parent;
    // 对话框的 X 按钮走「自身 → 父链 → 孤儿」解析：内容守卫按 snippet 语义落在根作用域
    scope.requestClose = () => requestScopeClose(resolveSummary(withParent));
    setContext(KEY, withParent);
    return scope;
}

/** 关闭解析：自身 → 沿父链到根 → 孤儿作用域，第一个非空聚合生效 */
function resolveSummary(scope: CloseScope): CloseGuardSummary | null {
    let current: (CloseScope & ScopeInternals) | undefined = scope as CloseScope & ScopeInternals;
    const visited = new Set<CloseScope>();
    while (current && !visited.has(current)) {
        visited.add(current);
        const summary = current.dirtyChanges();
        if (summary) return summary;
        current = current.parent;
    }
    return orphanScope.dirtyChanges();
}

/** 作用域关闭：有脏项先弹三选一；「保存并离开」执行聚合保存，失败留在原地 */
async function requestScopeClose(summary: CloseGuardSummary | null): Promise<boolean> {
    if (!summary || summary.changes.length === 0) return true;
    const choice = await openGuardDialog(summary);
    if (choice === "discard") return true;
    if (choice === "save") {
        try {
            await summary.save();
            return true;
        } catch (error) {
            return false;
        }
    }
    return false;
}

export function useCloseGuard(item: CloseGuardItem): (close: () => void) => Promise<void> {
    const scope = getContext<CloseScope | undefined>(KEY) ?? orphanScope;
    onMount(() => {
        scope.addItem(item);
        return () => { scope.removeItem(item); };
    });
    return async (close: () => void) => {
        if (item.busy()) return;
        if (!item.dirty()) {
            close();
            return;
        }
        const choice = await openGuardDialog({
            changes: item.changes?.() ?? [text("guardGenericChange", "有未保存的修改")],
            canSave: Boolean(item.save),
        });
        if (choice === "discard") close();
        else if (choice === "save") {
            try {
                await item.save?.();
                close();
            } catch {
                // 保存失败：留在原地，错误由调用方的界面提示
            }
        }
    };
}

export type CloseGuardChoice = "save" | "discard" | "cancel";

/** 三选一弹窗（DOM 直挂 body，带 lvct-dialog-root 令牌根）。Esc/遮罩 = 取消。只出选择，不执行保存。 */
function openGuardDialog(summary: { changes: string[]; canSave: boolean }): Promise<CloseGuardChoice> {
    return new Promise((resolve) => {
        const onKeydown = (event: KeyboardEvent) => {
            if (event.key === "Escape") {
                event.preventDefault();
                event.stopPropagation();
                finish("cancel");
            }
        };
        const finish = (choice: CloseGuardChoice) => {
            document.removeEventListener("keydown", onKeydown, true);
            overlay.remove();
            resolve(choice);
        };

        const overlay = document.createElement("div");
        overlay.className = "lvct-dialog-root lvct-closeguard";
        const changesHtml = summary.changes
            .map((change) => `<li>${escapeHtml(change)}</li>`)
            .join("");
        overlay.innerHTML = `
            <div class="lvct-closeguard__mask"></div>
            <div class="lvct-closeguard__panel" role="alertdialog" aria-modal="true"
                aria-label="${escapeHtml(text("guardTitle", "有未保存的修改"))}">
                <h3>${escapeHtml(text("guardTitle", "有未保存的修改"))}</h3>
                <p class="lvct-closeguard__hint">${escapeHtml(text("guardHint", "以下修改尚未保存："))}</p>
                <ul class="lvct-closeguard__list">${changesHtml}</ul>
                <div class="lvct-closeguard__actions">
                    <button type="button" class="b3-button b3-button--cancel" data-choice="cancel">
                        ${escapeHtml(text("guardCancel", "取消"))}</button>
                    <button type="button" class="b3-button b3-button--outline" data-choice="discard">
                        ${escapeHtml(text("guardDiscard", "放弃并离开"))}</button>
                    <button type="button" class="b3-button b3-button--text" data-choice="save">
                        ${escapeHtml(text("guardSave", "保存并离开"))}</button>
                </div>
            </div>`;
        document.body.appendChild(overlay);
        const saveButton = overlay.querySelector<HTMLButtonElement>("button[data-choice='save']")!;
        if (!summary.canSave) saveButton.remove();
        for (const button of overlay.querySelectorAll<HTMLButtonElement>("button[data-choice]")) {
            button.addEventListener("click", () => finish(button.dataset.choice as CloseGuardChoice));
        }
        overlay.querySelector(".lvct-closeguard__mask")!.addEventListener("click", () => finish("cancel"));
        document.addEventListener("keydown", onKeydown, true);
        (overlay.querySelector(".lvct-closeguard__panel button:last-child") as HTMLElement | null)?.focus();
    });
}

function escapeHtml(value: string): string {
    return value
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
}

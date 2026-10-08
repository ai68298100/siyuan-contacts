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
import { getContext, onDestroy, onMount, setContext } from "svelte";
import { decideClose, type CloseGuardState } from "../domain/close-policy";
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
    children: Set<CloseScope>;
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
        const state = readGuardState(item);
        if (state.busy || !state.dirty) continue;
        changes.push(...(item.changes?.() ?? [text("guardGenericChange", "有未保存的修改")]));
        if (item.save) saves.push(item.save);
        else canSave = false;
    }
    if (changes.length === 0) return null;
    return { changes, canSave, save: async () => { for (const save of saves) await save(); } };
}

function combineSummaries(summaries: Array<CloseGuardSummary | null>): CloseGuardSummary | null {
    const present = summaries.filter((summary): summary is CloseGuardSummary => summary !== null);
    if (present.length === 0) return null;
    return {
        changes: present.flatMap((summary) => summary.changes),
        canSave: present.every((summary) => summary.canSave),
        save: async () => { for (const summary of present) await summary.save(); },
    };
}

function createRegistryScope(): CloseScope & ScopeInternals {
    const items = new Set<CloseGuardItem>();
    const children = new Set<CloseScope>();
    const scope: CloseScope & ScopeInternals = {
        children,
        hasBlocked: () => [...items].some((item) => decideClose(readGuardState(item)) === "blocked")
            || [...children].some((child) => child.hasBlocked()),
        dirtyChanges: () => combineSummaries([aggregate(items), ...[...children].map((child) => child.dirtyChanges())]),
        /* CODE-02.1：busy 独立于脏草稿阻断——不脏也可能在写入/AI/迁移/扫描/导出中 */
        requestClose: async () => {
            if (scope.hasBlocked()) return false;
            return requestScopeClose(scope.dirtyChanges());
        },
        addItem: (item) => { items.add(item); allGuardItems.add(item); },
        removeItem: (item) => { items.delete(item); allGuardItems.delete(item); },
    };
    return scope;
}

function readGuardState(item: CloseGuardItem): CloseGuardState {
    try {
        if (item.busy()) return { busy: true, dirty: false };
        return { busy: false, dirty: item.dirty() };
    } catch {
        return { busy: true, dirty: false };
    }
}

/** FUNC-01.7：跨作用域的脏草稿全量查询（工作台数据变化提示用）。
 *  项在守卫组件卸载时经 removeItem 移除，注册表不留悬挂项。 */
const allGuardItems = new Set<CloseGuardItem>();

export function anyDirtyChanges(): CloseGuardSummary | null {
    return aggregate(allGuardItems);
}

/** 无上下文的独立挂载内容（svelteDialog 直挂的弹窗等）兜底作用域 */
const orphanScope: CloseScope & ScopeInternals = createRegistryScope();

export function createCloseScope(): CloseScope {
    const parent = getContext<CloseScope & ScopeInternals | undefined>(KEY) ?? orphanScope;
    const scope = createRegistryScope();
    const withParent = scope as CloseScope & ScopeInternals;
    withParent.parent = parent;
    parent.children.add(scope);
    onDestroy(() => parent.children.delete(scope));
    // 对话框的 X 按钮走「busy 阻断 → 自身 → 父链 → 孤儿」解析：内容守卫按 snippet 语义落在根作用域
    scope.requestClose = async () => {
        if (resolveBusy(withParent)) return false; /* CODE-02.1：忙碌即不关（静默），无论有无脏草稿 */
        return requestScopeClose(resolveSummary(withParent));
    };
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

/** CODE-02.1：作用域链上是否存在忙碌项——busy 不再依赖「恰好也脏」才阻断 */
function resolveBusy(scope: CloseScope): boolean {
    let current: (CloseScope & ScopeInternals) | undefined = scope as CloseScope & ScopeInternals;
    const visited = new Set<CloseScope>();
    while (current && !visited.has(current)) {
        visited.add(current);
        if (current.hasBlocked()) return true;
        current = current.parent;
    }
    return orphanScope.hasBlocked();
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
        const decision = decideClose(readGuardState(item));
        if (decision === "blocked") return;
        if (decision === "allow") {
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
        const previousActive = document.activeElement instanceof HTMLElement ? document.activeElement : null;
        let finished = false;
        const onKeydown = (event: KeyboardEvent) => {
            if (event.key === "Escape") {
                event.preventDefault();
                event.stopPropagation();
                finish("cancel");
                return;
            }
            if (event.key !== "Tab") return;
            const focusable = [...overlay.querySelectorAll<HTMLElement>(
                "button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href], [tabindex]:not([tabindex='-1'])",
            )];
            if (focusable.length === 0) return;
            const first = focusable[0];
            const last = focusable[focusable.length - 1];
            if (!overlay.contains(document.activeElement)) {
                event.preventDefault();
                first.focus();
            } else if (event.shiftKey && document.activeElement === first) {
                event.preventDefault();
                last.focus();
            } else if (!event.shiftKey && document.activeElement === last) {
                event.preventDefault();
                first.focus();
            }
        };
        const finish = (choice: CloseGuardChoice) => {
            if (finished) return;
            finished = true;
            document.removeEventListener("keydown", onKeydown, true);
            overlay.remove();
            if (previousActive?.isConnected) queueMicrotask(() => previousActive.focus());
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

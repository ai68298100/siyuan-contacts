import { createLifecycleToken, type LifecycleToken } from "../domain/lifecycle.ts";
import { acceptDataChange, isNavigationDocId, mergeDataChanges, normalizeDataChange } from "../domain/navigation.ts";
import type { VersionedDataChange } from "../domain/navigation.ts";

/**
 * FUNC-01.7：数据变化通知的窗口内事件通道。
 *
 * 宿主在数据库/存储变化时对每个窗口的插件实例回调 `onDataChanged`；插件入口把回调防抖后经本通道广播，
 * 同源页面再通过 BroadcastChannel 补齐插件自身发起的块写入，工作台组件订阅后
 * 原地刷新（revision bump），不刷新浏览器全局、不依赖插件重载。
 * 放在 libs 以便 index.ts 与组件共同引用而不产生循环依赖。
 */

export const LVCT_DATA_CHANGED = "lvct-data-changed";

export type DataChangeDetail = VersionedDataChange;

let revision = 0;
const sourceId = `window-${Math.random().toString(36).slice(2)}`;
const dataChannel = typeof window !== "undefined" && typeof BroadcastChannel !== "undefined"
    ? new BroadcastChannel(`${LVCT_DATA_CHANGED}:channel`)
    : undefined;

dataChannel?.addEventListener("message", (event: MessageEvent<unknown>) => {
    const normalized = normalizeDataChange(event.data);
    if (!normalized || normalized.sourceId === sourceId) return;
    window.dispatchEvent(new CustomEvent(LVCT_DATA_CHANGED, { detail: normalized }));
});

/** 插件入口调用：广播一次数据变化（调用方负责防抖合并连续事件） */
export function emitDataChanged(change: Omit<DataChangeDetail, "revision"> = {}, token?: LifecycleToken): void {
    if (token && !token.isAlive()) return;
    const detail = { ...change, version: 1 as const, sourceId, revision: ++revision };
    window.dispatchEvent(new CustomEvent(LVCT_DATA_CHANGED, { detail }));
    dataChannel?.postMessage(detail);
}

/** 组件调用：订阅数据变化，返回取消订阅函数 */
export function subscribeDataChanged(
    handler: (change: DataChangeDetail) => void,
    options: { token?: LifecycleToken } = {},
): () => void {
    const token = createLifecycleToken(options.token);
    const seen = new Map<string, number>();
    const wrapped = (event: Event) => {
        if (!token.isAlive()) return;
        const detail = (event as CustomEvent<DataChangeDetail>).detail;
        const normalized = detail === undefined || detail === null ? { revision: ++revision, sourceId, version: 1 as const } : normalizeDataChange(detail);
        if (normalized && acceptDataChange(seen, normalized)) handler(normalized);
    };
    if (token.isAlive()) window.addEventListener(LVCT_DATA_CHANGED, wrapped);
    token.onDispose(() => window.removeEventListener(LVCT_DATA_CHANGED, wrapped));
    return token.invalidate;
}

export function subscribeDataChangedDebounced(
    handler: (change: DataChangeDetail) => void,
    options: { delayMs?: number; invalidate?: () => void; token?: LifecycleToken } = {},
): () => void {
    const token = createLifecycleToken(options.token);
    let timer: ReturnType<typeof setTimeout> | undefined;
    let pending: DataChangeDetail | undefined;
    const unsubscribe = subscribeDataChanged((change) => {
        if (!change || typeof change.revision !== "number") return;
        if (!token.isAlive()) return;
        options.invalidate?.();
        pending = mergeDataChanges(pending, change);
        clearTimeout(timer);
        if (!token.isAlive()) return;
        timer = setTimeout(() => {
            timer = undefined;
            const merged = pending;
            pending = undefined;
            if (token.isAlive() && merged) handler(merged);
        }, options.delayMs ?? 400);
    }, { token });
    token.onDispose(() => {
        clearTimeout(timer);
        timer = undefined;
        pending = undefined;
        unsubscribe();
    });
    return token.invalidate;
}

export const LVCT_PERSON_NAVIGATION = "lvct-person-navigation";
export interface PersonNavigationRequest {
    docId: string;
    source: "document";
    trigger?: HTMLElement;
}
const pendingPersonNavigation = new WeakMap<object, { request: PersonNavigationRequest; token?: LifecycleToken; detach?: () => void }>();

export function requestPersonNavigation(owner: object, request: PersonNavigationRequest, token?: LifecycleToken): void {
    if (!isNavigationDocId(request.docId) || request.source !== "document" || token && !token.isAlive()) return;
    pendingPersonNavigation.get(owner)?.detach?.();
    const entry = { request, token, detach: undefined as (() => void) | undefined };
    pendingPersonNavigation.set(owner, entry);
    entry.detach = token?.onDispose(() => {
        if (pendingPersonNavigation.get(owner) === entry) pendingPersonNavigation.delete(owner);
    });
    window.dispatchEvent(new CustomEvent(LVCT_PERSON_NAVIGATION, { detail: { owner } }));
}

export function subscribePersonNavigation(owner: object, handler: (request: PersonNavigationRequest) => void, parentToken?: LifecycleToken): () => void {
    const token = createLifecycleToken(parentToken);
    const deliver = () => {
        if (!token.isAlive()) return;
        const entry = pendingPersonNavigation.get(owner);
        if (!entry || entry.token && !entry.token.isAlive()) return;
        pendingPersonNavigation.delete(owner);
        entry.detach?.();
        handler(entry.request);
    };
    const wrapped = (event: Event) => {
        if ((event as CustomEvent<{ owner?: object }>).detail?.owner === owner) deliver();
    };
    if (token.isAlive()) window.addEventListener(LVCT_PERSON_NAVIGATION, wrapped);
    token.onDispose(() => window.removeEventListener(LVCT_PERSON_NAVIGATION, wrapped));
    deliver();
    return token.invalidate;
}

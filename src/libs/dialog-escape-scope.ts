/** 内层浮层优先消费原生弹窗的 Esc；以显式作用域回调避开宿主与 Svelte 委托监听的先后差异。 */
const scopes = new WeakMap<HTMLElement, () => void>();

export function registerDialogEscapeScope(element: HTMLElement, close: () => void): () => void {
    scopes.set(element, close);
    return () => { if (scopes.get(element) === close) scopes.delete(element); };
}

export function dialogEscapeScope(target: HTMLElement): (() => void) | undefined {
    for (let element: HTMLElement | null = target; element; element = element.parentElement) {
        const close = scopes.get(element);
        if (close) return close;
    }
    return undefined;
}

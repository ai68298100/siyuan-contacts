import { getContext, onMount, setContext } from "svelte";

const KEY = Symbol("lvct-close-guard");
type Guard = () => boolean;

/** Each dialog owns its guards; its parent also checks them before navigating. */
export function createCloseScope() {
    const parent = getContext<Set<Guard> | undefined>(KEY);
    const guards = new Set<Guard>();
    setContext(KEY, guards);
    const check = () => [...guards].every((guard) => guard());
    onMount(() => {
        parent?.add(check);
        return () => { parent?.delete(check); };
    });
    return check;
}

export function useCloseGuard(busy: () => boolean, dirty: () => boolean) {
    const scope = getContext<Set<Guard> | undefined>(KEY);
    const check = () => !busy() && (!dirty() || window.confirm("有未保存的修改，确定放弃并离开吗？"));
    onMount(() => {
        scope?.add(check);
        return () => { scope?.delete(check); };
    });
    return (close: () => void) => { if (check()) close(); };
}

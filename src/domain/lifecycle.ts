export interface LifecycleToken {
    readonly id: symbol;
    isAlive(): boolean;
    onDispose(cleanup: () => void): () => void;
    invalidate(): void;
}

export const LIFECYCLE_CONTEXT = Symbol("lvct-lifecycle-context");

export function createLifecycleToken(parent?: LifecycleToken): LifecycleToken {
    const id = Symbol("lvct-lifecycle");
    let alive = true;
    const cleanups = new Set<() => void>();
    const token: LifecycleToken = {
        id,
        isAlive: () => alive && (!parent || parent.isAlive()),
        onDispose: (cleanup) => {
            if (!token.isAlive()) cleanup();
            else cleanups.add(cleanup);
            return () => { cleanups.delete(cleanup); };
        },
        invalidate: () => {
            if (!alive) return;
            alive = false;
            for (const cleanup of [...cleanups]) cleanup();
            cleanups.clear();
        },
    };
    if (parent) {
        const detach = parent.onDispose(token.invalidate);
        token.onDispose(detach);
    }
    return token;
}

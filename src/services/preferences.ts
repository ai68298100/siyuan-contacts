import type { Plugin } from "siyuan";
import {
    DEFAULT_VIEW_PREFERENCES,
    normalizeViewPreferences,
    type ViewPreferences,
} from "../domain/preferences.ts";
import { readViewPreferences, writeViewPreferencePatch } from "../data/preferences.ts";
import { diffViewPreferences } from "../domain/preferences-concurrency.ts";

interface PreferenceState {
    queue: Promise<void>;
    latest: ViewPreferences | null;
}

const states = new WeakMap<Plugin, PreferenceState>();

function stateFor(plugin: Plugin): PreferenceState {
    let state = states.get(plugin);
    if (!state) {
        state = { queue: Promise.resolve(), latest: null };
        states.set(plugin, state);
    }
    return state;
}

function remember(state: PreferenceState, value: ViewPreferences): void {
    if (!state.latest || value.revision >= state.latest.revision) state.latest = value;
}

export async function loadViewPreferences(plugin: Plugin): Promise<ViewPreferences> {
    const state = stateFor(plugin);
    await state.queue;
    const value = await readViewPreferences(plugin);
    remember(state, value);
    return value;
}

export function saveViewPreferences(plugin: Plugin, preferences: ViewPreferences, baseline?: ViewPreferences): Promise<ViewPreferences> {
    const state = stateFor(plugin);
    const submitted = normalizeViewPreferences(preferences);
    const base = baseline ? normalizeViewPreferences(baseline) : state.latest && normalizeViewPreferences(state.latest);
    const task = state.queue.then(async () => {
        const previous = base ?? await readViewPreferences(plugin);
        const value = await writeViewPreferencePatch(plugin, diffViewPreferences(previous, submitted));
        remember(state, value);
        return value;
    });
    state.queue = task.then(() => {}, () => {});
    return task;
}

export function savePreferenceChanges(
    facade: { saveViewPreferences: (preferences: ViewPreferences, baseline?: ViewPreferences) => Promise<ViewPreferences> },
    preferences: ViewPreferences,
    baseline: ViewPreferences,
): Promise<ViewPreferences> {
    return facade.saveViewPreferences(preferences, baseline);
}

export function createPreferenceRequests(operations: {
    load: () => Promise<ViewPreferences>;
    save: (preferences: ViewPreferences, baseline: ViewPreferences) => Promise<ViewPreferences>;
    apply: (preferences: ViewPreferences) => void;
    fail?: (error: unknown) => void;
    saved?: (preferences: ViewPreferences) => void;
}) {
    let generation = 0;
    let active = true;
    let revision = 0;

    async function run(operation: () => Promise<ViewPreferences>, writing: boolean): Promise<ViewPreferences> {
        if (!active) throw new Error("偏好实例已关闭，操作已停止");
        const request = ++generation;
        try {
            const value = await operation();
            if (active && request === generation && value.revision >= revision) {
                revision = value.revision;
                operations.apply(value);
            }
            if (active && writing) operations.saved?.(value);
            return value;
        } catch (error) {
            if (active && request === generation) operations.fail?.(error);
            throw error;
        }
    }

    return {
        load: () => run(operations.load, false),
        save: (preferences: ViewPreferences, baseline: ViewPreferences) => {
            const submitted = normalizeViewPreferences(preferences);
            const base = normalizeViewPreferences(baseline);
            return run(() => operations.save(submitted, base), true);
        },
        invalidate: () => { generation += 1; },
        activate: () => { active = true; generation += 1; revision = 0; },
        dispose: () => { active = false; generation += 1; },
    };
}

export { DEFAULT_VIEW_PREFERENCES };

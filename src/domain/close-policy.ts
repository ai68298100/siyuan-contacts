export interface CloseGuardState {
    busy: boolean;
    dirty: boolean;
}

export type CloseDecision = "blocked" | "prompt" | "allow";

export function decideClose(state: CloseGuardState): CloseDecision {
    if (state.busy) return "blocked";
    return state.dirty ? "prompt" : "allow";
}

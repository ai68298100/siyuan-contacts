/** 插件工作区的安全状态。恢复状态下不得继续使用旧的原生锚点。 */
export type WorkspaceStateKind =
    | "uninitialized"
    | "ready"
    | "settings-invalid"
    | "settings-read-failed"
    | "anchor-missing"
    | "anchor-unknown";

export interface WorkspaceState {
    readonly kind: WorkspaceStateKind;
    /** 面向日志/恢复界面的诊断信息，不包含可执行请求参数。 */
    readonly message?: string;
}

/**
 * 与小驴打卡（siyuan-checkin）联动的预留层。
 * 原则（打卡侧协议 v5 + 雷切桥经验）：运行时 feature-detect，能力缺失优雅降级；
 * 状态必须自证（D-223：区分 unsupported/pending/ready/failed，不把失败误报为不支持）。
 * M1 只做探测与状态机占位；生日同步进打卡 occasions 在 M4 接线。
 */

export type CheckinBridgeState =
    | "unsupported"
    | "pending"
    | "ready"
    | "failed";

/** 打卡插件暴露的全局桥 API（协议 v5，见 siyuan-checkin docs/agent-document-context-m2.md 同款约定） */
interface CheckinBridgeApi {
    readonly protocol?: number;
    readonly capabilities?: readonly string[];
    readonly version?: string;
    whenReady?(): Promise<boolean>;
    hasCapability?(capability: string): boolean;
    recordItem?(itemId: string, note?: string, options?: { source?: string; externalRef?: string }): Promise<{ success: boolean; recordId?: string }>;
}

declare global {
    interface Window {
        siyuanCheckin?: CheckinBridgeApi;
        xiaolvCheckin?: CheckinBridgeApi;
        lvCheckin?: CheckinBridgeApi;
        LvCheckin?: CheckinBridgeApi;
    }
}

export interface CheckinBridgeStatus {
    readonly state: CheckinBridgeState;
    /** 探测到的协议版本；仅 state=ready 时有意义 */
    readonly protocol: number | null;
    /** 打卡插件声明的能力清单；仅 state=ready 且插件提供了 capabilities 时存在 */
    readonly capabilities: readonly string[];
    /** 打卡插件版本；仅 state=ready 且插件提供了 version 时存在 */
    readonly version: string | null;
}

export function detectCheckinBridge(): CheckinBridgeStatus {
    try {
        if (typeof window === "undefined") {
            return { state: "unsupported", protocol: null, capabilities: [], version: null };
        }
        const host = window as unknown as {
            siyuanCheckin?: CheckinBridgeApi;
            xiaolvCheckin?: CheckinBridgeApi;
            lvCheckin?: CheckinBridgeApi;
            LvCheckin?: CheckinBridgeApi;
        };
        const api = host.siyuanCheckin || host.xiaolvCheckin || host.lvCheckin || host.LvCheckin;
        if (!api || typeof api !== "object") {
            return { state: "unsupported", protocol: null, capabilities: [], version: null };
        }
        const protocol = typeof api.protocol === "number" ? api.protocol : null;
        if (protocol === null || protocol < 5) {
            return { state: "pending", protocol, capabilities: [], version: null };
        }
        const capabilities = Array.isArray(api.capabilities) ? [...api.capabilities] : [];
        const version = typeof api.version === "string" && api.version.trim() ? api.version.trim() : null;
        return { state: "ready", protocol, capabilities, version };
    } catch {
        return { state: "failed", protocol: null, capabilities: [], version: null };
    }
}

/**
 * 跨插件生态联动：人脉向打卡桥安全委托记录一项习惯打卡（如“给张三打电话/发问候”）。
 * 优雅降级：打卡插件未就绪、方法缺失或调用失败时不抛出阻断异常，返回 { recorded: false, reason }。
 */
export async function recordCheckinForContact(
    itemId: string,
    personName: string,
    note?: string,
): Promise<{ recorded: boolean; reason?: string; recordId?: string }> {
    const status = detectCheckinBridge();
    if (status.state !== "ready") {
        return { recorded: false, reason: `打卡插件未就绪（${status.state}）` };
    }
    const host = window as unknown as {
        siyuanCheckin?: CheckinBridgeApi;
        xiaolvCheckin?: CheckinBridgeApi;
        lvCheckin?: CheckinBridgeApi;
        LvCheckin?: CheckinBridgeApi;
    };
    const api = host.siyuanCheckin || host.xiaolvCheckin || host.lvCheckin || host.LvCheckin;
    if (!api || typeof api.recordItem !== "function") {
        return { recorded: false, reason: "打卡插件未提供 recordItem 能力" };
    }
    try {
        const fullNote = note?.trim() ? `[小驴人脉] ${personName} · ${note.trim()}` : `[小驴人脉] ${personName}`;
        const outcome = await api.recordItem(itemId, fullNote, { source: "lv-contacts" });
        return { recorded: Boolean(outcome?.success), recordId: outcome?.recordId };
    } catch (error) {
        return { recorded: false, reason: (error as Error)?.message ?? "调用打卡接口失败" };
    }
}

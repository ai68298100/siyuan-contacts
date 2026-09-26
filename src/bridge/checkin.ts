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
}

declare global {
    interface Window {
        siyuanCheckin?: CheckinBridgeApi;
    }
}

export interface CheckinBridgeStatus {
    readonly state: CheckinBridgeState;
    /** 探测到的协议版本；仅 state=ready 时有意义 */
    readonly protocol: number | null;
}

export function detectCheckinBridge(): CheckinBridgeStatus {
    try {
        const api = window.siyuanCheckin;
        if (!api || typeof api !== "object") {
            return { state: "unsupported", protocol: null };
        }
        const protocol = typeof api.protocol === "number" ? api.protocol : null;
        if (protocol === null || protocol < 5) {
            return { state: "pending", protocol };
        }
        return { state: "ready", protocol };
    } catch {
        return { state: "failed", protocol: null };
    }
}

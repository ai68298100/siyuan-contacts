// 仅供隔离 UI 回归：没有网络请求，也不读写思源数据。
export const kernel = {
    handler: async () => { throw new Error("未配置测试请求"); },
};

export function getFrontend() {
    return new URLSearchParams(window.location.search).get("mobile") === "1" ? "mobile" : "desktop";
}

export function fetchPost(route, body, callback) {
    Promise.resolve().then(() => kernel.handler(route, body)).then(
        (data) => callback({ code: 0, msg: "", data }),
        (error) => callback({ code: -1, msg: error instanceof Error ? error.message : String(error), data: null }),
    );
}

export class Dialog {
    constructor(options) {
        this.element = document.createElement("section");
        this.element.className = "test-native-dialog";
        this.element.innerHTML = options.content;
        this.onDestroy = options.destroyCallback;
        document.body.append(this.element);
    }
    destroy() {
        this.onDestroy?.();
        this.element.remove();
    }
}

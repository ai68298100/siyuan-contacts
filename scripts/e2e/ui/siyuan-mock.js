// 仅供隔离 UI 回归：没有网络请求，也不读写思源数据。
export const kernel = {
    handler: async () => { throw new Error("未配置测试请求"); },
};

export function fetchPost(route, body, callback) {
    Promise.resolve().then(() => kernel.handler(route, body)).then(
        (data) => callback({ code: 0, data }),
        (error) => callback({ code: -1, msg: error.message }),
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

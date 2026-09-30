// 仅供隔离 UI 回归：没有网络请求，也不读写思源数据。
// K-02：faultLog 挂在 kernel 对象上——vite 对 alias 与相对路径可能产生两个模块实例，
// 挂对象属性才能与 smoke.js 共享同一份故障日志（kernel 引用是共享锚点）。
export const kernel = {
    handler: async () => { throw new Error("未配置测试请求"); },
    faultLog: [],
};

export function fetchPost(route, body, callback) {
    Promise.resolve().then(() => kernel.handler(route, body)).then(
        (data) => callback({ code: 0, data }),
        (error) => {
            kernel.faultLog.push({ route, message: String(error?.message ?? error) });
            callback({ code: -1, msg: error.message });
        },
    );
}

export class Dialog {
    constructor(options) {
        this.element = document.createElement("section");
        this.element.className = "test-native-dialog b3-dialog";
        /* D-40：对齐真实宿主 DOM——遮罩与关闭钮类名（.b3-dialog__scrim / .b3-dialog__close），
           并模拟宿主「遮罩/关闭钮/Esc 直接 destroy」的原行为（守卫拦截器须先于本行为生效） */
        this.element.innerHTML =
            '<div class="b3-dialog__scrim"></div><div class="b3-dialog__close" role="button" aria-label="关闭"></div>' + options.content;
        this.onDestroy = options.destroyCallback;
        this.element.addEventListener("click", (event) => {
            const target = event.target;
            if (target instanceof Element && target.closest(".b3-dialog__scrim, .b3-dialog__close")) this.destroy();
        });
        this.onKey = (event) => {
            if (event.key === "Escape" && this.element.contains(event.target)) this.destroy();
        };
        window.addEventListener("keydown", this.onKey);
        document.body.append(this.element);
    }
    destroy() {
        window.removeEventListener("keydown", this.onKey);
        this.onDestroy?.();
        this.element.remove();
    }
}

// 仅供隔离 UI 回归：没有网络请求，也不读写思源数据。
// K-02：faultLog 挂在 kernel 对象上——vite 对 alias 与相对路径可能产生两个模块实例，
// 挂对象属性才能与 smoke.js 共享同一份故障日志（kernel 引用是共享锚点）。
export const kernel = {
    handler: async () => { throw new Error("未配置测试请求"); },
    faultLog: [],
};

export function getFrontend() {
    return new URLSearchParams(window.location.search).get("mobile") === "1" ? "mobile" : "desktop";
}

export function fetchPost(route, body, callback) {
    Promise.resolve().then(() => kernel.handler(route, body)).then(
        (data) => callback({ code: 0, msg: "", data }),
        (error) => {
            kernel.faultLog.push({ route, message: String(error?.message ?? error) });
            callback({ code: -1, msg: error instanceof Error ? error.message : String(error), data: null });
        },
    );
}

export class Dialog {
    constructor(options) {
        this.element = document.createElement("section");
        this.element.className = "test-native-dialog b3-dialog";
        /* D-40/V-16：对齐真实宿主 DOM——scrim + container（宽度/标题头/关闭钮）+ body 包裹层级，
           并挂 b3-dialog--open（宿主入场后的常驻态，base.css 以它放开 scrim/container 不透明度），
           并模拟宿主「遮罩/关闭钮/Esc 直接 destroy」的原行为（守卫拦截器须先于本行为生效） */
        this.element.innerHTML =
            '<div class="b3-dialog__scrim"></div>' +
            `<div class="b3-dialog__container"${options.width ? ` style="width:${options.width}"` : ""}>` +
            `<div class="b3-dialog__header"><span class="fn__ellipsis">${options.title ?? ""}</span><div class="b3-dialog__close" role="button" aria-label="关闭"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 6l12 12M18 6L6 18"/></svg></div></div>` +
            '<div class="b3-dialog__body"></div></div>';
        this.element.querySelector(".b3-dialog__body").innerHTML = options.content;
        this.element.classList.add("b3-dialog--open");
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

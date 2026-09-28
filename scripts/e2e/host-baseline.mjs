/* 宿主样式基线（C01）：把真实思源 base.css 与官方主题变量注入隔离截图/回归页。
   为什么需要：此前隔离 harness 用手写近似宿主样式，B02 浮层显示异常、B09 真机布局问题
   都因此溜过回归。本模块在本机思源安装目录读取 base.css（哈希文件名）与
   daylight/midnight 主题变量，经 vite 中间件以 /__host/*.css 提供；
   找不到本机安装（如 CI）时优雅降级为不可用，页面自行跳过注入。 */
import fs from "node:fs";
import path from "node:path";

const RESOURCE_DIRS = [
    "D:\\biji\\SiYuan\\resources",
    "D:\\RJ\\SiYuan\\resources",
    path.join(process.env.ProgramFiles || "C:\\Program Files", "SiYuan", "resources"),
];

export function resolveHostAssets() {
    for (const dir of RESOURCE_DIRS) {
        try {
            const appDir = path.join(dir, "stage", "build", "app");
            const baseFile = fs.readdirSync(appDir).find((name) => /^base\..*\.css$/.test(name));
            const light = path.join(dir, "appearance", "themes", "daylight", "theme.css");
            const dark = path.join(dir, "appearance", "themes", "midnight", "theme.css");
            if (baseFile && fs.existsSync(light) && fs.existsSync(dark)) {
                return {
                    base: fs.readFileSync(path.join(appDir, baseFile), "utf8"),
                    light: fs.readFileSync(light, "utf8"),
                    dark: fs.readFileSync(dark, "utf8"),
                };
            }
        } catch {
            /* 换下一个候选目录 */
        }
    }
    return null;
}

/** vite 插件：提供 /__host/base.css、/__host/theme-light.css、/__host/theme-dark.css */
export function hostBaselinePlugin() {
    const assets = resolveHostAssets();
    return {
        name: "lvct-host-baseline",
        configureServer(server) {
            if (!assets) return;
            const serve = (route, css) => {
                server.middlewares.use(route, (_req, res) => {
                    res.setHeader("Content-Type", "text/css; charset=utf-8");
                    res.end(css);
                });
            };
            serve("/__host/base.css", assets.base);
            serve("/__host/theme-light.css", assets.light);
            serve("/__host/theme-dark.css", assets.dark);
        },
    };
}

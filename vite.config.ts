import { existsSync, readFileSync } from "node:fs";
import { resolve } from "path";
import { defineConfig, type Plugin } from "vite";
import { viteStaticCopy } from "vite-plugin-static-copy";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import zipPack from "vite-plugin-zip-pack";
import fg from "fast-glob";

import { useLiveReload } from "./scripts/siyuan_live_reload.js";

const env = process.env;
const isSrcmap = env.VITE_SOURCEMAP === "inline";
const isDev = env.NODE_ENV === "development";
const outputDir = isDev ? "dev" : "dist";

const pluginManifest = JSON.parse(readFileSync(resolve(import.meta.dirname, "plugin.json"), "utf8"));
const packageImageTargets = [
    ["icon", "icon.png"],
    ["preview", "preview.png"],
].flatMap(([field, legacyName]) => {
    const fileName = pluginManifest[field] || (existsSync(legacyName) ? legacyName : "");
    return fileName ? [{ src: `./${fileName}`, dest: "./" }] : [];
});

console.log("isDev=>", isDev);
console.log("isSrcmap=>", isSrcmap);
console.log("outputDir=>", outputDir);

export default defineConfig({
    resolve: {
        alias: {
            "@": resolve(import.meta.dirname, "src"),
        }
    },

    publicDir: "public",

    plugins: [
        svelte(),
        viteStaticCopy({
            targets: [
                ...packageImageTargets,
                { src: "./README*.md", dest: "./" },
                { src: "./plugin.json", dest: "./" },
            ],
        }),
    ],

    define: {
        "process.env.DEV_MODE": JSON.stringify(isDev),
        "process.env.NODE_ENV": JSON.stringify(env.NODE_ENV)
    },

    build: {
        outDir: outputDir,
        emptyOutDir: false,
        minify: true,
        sourcemap: isSrcmap ? "inline" : false,

        lib: {
            entry: resolve(import.meta.dirname, "src/index.ts"),
            fileName: () => "index.js",
            cssFileName: "index",
            formats: ["cjs"],
        },
        rollupOptions: {
            plugins: isDev ? [
                useLiveReload({ outputDir }),
                watchExternalFiles([
                    "public/i18n/**",
                    "./README*.md",
                    "./plugin.json"
                ])
            ] : [
                /* zip 条目 mtime 必须是真实构建时间：若被固定为 1980 纪元，
                   集市包会被 WebDAV 同步按 mtime 判旧而回滚用户已装的新版
                   （siyuan-speed-switch 0.23.1 实故）。vite-plugin-zip-pack
                   直接采用 dist 文件落盘时间，满足该约束。 */
                zipPack({
                    inDir: "./dist",
                    outDir: "./",
                    outFileName: "package.zip"
                })
            ],

            external: ["siyuan", "process"],

            output: {
                entryFileNames: "[name].js",
                assetFileNames: (assetInfo) => assetInfo.name ?? "asset",
            },
        },
    },
});

function watchExternalFiles(patterns: string[]): Plugin {
    return {
        name: "watch-external",
        async buildStart() {
            const files = await fg(patterns);
            for (const file of files) {
                this.addWatchFile(file);
            }
        }
    };
}

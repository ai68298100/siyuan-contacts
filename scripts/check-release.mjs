/* 发布门禁：版本一致性 + dist 产物完整性 + package.zip 存在。任何一项不过即退出码 1。 */
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const failures = [];
const check = (name, ok, detail = "") => {
    console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
    if (!ok) failures.push(name);
};

const plugin = JSON.parse(fs.readFileSync(path.join(root, "plugin.json"), "utf8"));
const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));

check("版本一致（plugin.json = package.json）", plugin.version === pkg.version, `${plugin.version} / ${pkg.version}`);
check("插件名 = 仓库名约定", plugin.name === pkg.name, plugin.name);

const dist = path.join(root, "dist");
for (const file of ["index.js", "index.css", "plugin.json", "icon.png", "preview.png", "README.md", "README.zh-CN.md", "i18n/zh-CN.json", "i18n/en.json"]) {
    const p = path.join(dist, file);
    check(`dist/${file}`, fs.existsSync(p) && fs.statSync(p).size > 0);
}

const distManifest = JSON.parse(fs.readFileSync(path.join(dist, "plugin.json"), "utf8"));
check("dist/plugin.json 与源一致", JSON.stringify(distManifest) === JSON.stringify(plugin));

const zip = path.join(root, "package.zip");
check("package.zip 存在且非空", fs.existsSync(zip) && fs.statSync(zip).size > 1024, fs.existsSync(zip) ? `${fs.statSync(zip).size}B` : "缺失");
check("icon.png ≤ 64KiB（集市限制）", fs.statSync(path.join(root, "icon.png")).size <= 64 * 1024, `${fs.statSync(path.join(root, "icon.png")).size}B`);
check("preview.png ≤ 512KiB（集市限制）", fs.statSync(path.join(root, "preview.png")).size <= 512 * 1024, `${fs.statSync(path.join(root, "preview.png")).size}B`);

if (failures.length > 0) {
    console.error(`\n发布门禁未通过：${failures.length} 项`);
    process.exit(1);
}
console.log("\n发布门禁全部通过 ✔");

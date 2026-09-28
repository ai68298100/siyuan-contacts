/** i18n 资源键核对工具（M5 门禁辅助）：列出组件/面板中 text() 引用但未入 zh-CN 资源的键与 fallback。 */
import fs from "node:fs";
import path from "node:path";

const zh = JSON.parse(fs.readFileSync("public/i18n/zh-CN.json", "utf8"));
const used = new Map();
const re = new RegExp('text\\(\\s*"([A-Za-z0-9_]+)"\\s*,\\s*"((?:[^"\\\\]|\\\\.)*)"', "g");

function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(full);
      continue;
    }
    if (!entry.name.endsWith(".svelte") && !entry.name.endsWith(".ts")) continue;
    const text = fs.readFileSync(full, "utf8");
    let m;
    while ((m = re.exec(text))) {
      const key = m[1];
      let fallback = "";
      try {
        fallback = JSON.parse('"' + m[2] + '"');
      } catch {
        fallback = m[2];
      }
      if (!used.has(key)) used.set(key, { fallback, file: path.basename(full) });
    }
  }
}

walk("src/components");
walk("src/panels");
const missing = [...used.entries()].filter(([key]) => !(key in zh));
console.log("missing count:", missing.length);
for (const [key, info] of missing) {
  console.log(`${key}\t${JSON.stringify(info.fallback)}\t${info.file}`);
}

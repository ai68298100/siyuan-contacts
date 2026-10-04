import { readFileSync, readdirSync } from "node:fs";
import { resolve, relative } from "node:path";
import { parse } from "svelte/compiler";

const projectRoot = resolve(import.meta.dirname, "../..");
const componentRoot = resolve(projectRoot, "src/components");
const files = [];
function collectFiles(directory) {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
        const entryPath = resolve(directory, entry.name);
        if (entry.isDirectory()) collectFiles(entryPath);
        else if (entry.name.endsWith(".svelte")) files.push(entryPath);
    }
}
collectFiles(componentRoot);
files.sort();

const controls = [];
const findings = [];
for (const filename of files) {
    const source = readFileSync(filename, "utf8");
    const ast = parse(source, { modern: true });
    const file = relative(projectRoot, filename).replaceAll("\\", "/");
    function labelSource(node) {
        if (!node || typeof node !== "object") return "";
        if (Array.isArray(node)) return node.map(labelSource).join(" ");
        if (node.type === "Text") return node.data;
        if (node.type === "ExpressionTag") return source.slice(node.start, node.end);
        if (node.type === "RegularElement" || node.type === "Component") return labelSource(node.fragment);
        return Object.entries(node).filter(([key]) => ["nodes", "body", "consequent", "alternate", "fragment"].includes(key))
            .map(([, child]) => labelSource(child)).join(" ");
    }
    function visit(node) {
        if (!node || typeof node !== "object") return;
        if (Array.isArray(node)) { for (const child of node) visit(child); return; }
        const attributes = node.attributes ?? [];
        const getAttribute = (name) => attributes.find((attribute) => attribute.type === "Attribute" && attribute.name === name);
        const rawAttribute = (attribute) => attribute ? source.slice(attribute.start, attribute.end).replace(/\s+/g, " ").trim() : null;
        const role = getAttribute("role");
        const tag = node.type === "RegularElement" ? node.name : null;
        const events = attributes.filter((attribute) => attribute.type === "OnDirective"
            || attribute.type === "Attribute" && /^on[a-z]+$/.test(attribute.name));
        const interactive = ["button", "input", "select", "textarea", "summary"].includes(tag)
            || tag === "a" && getAttribute("href")
            || tag && (events.length > 0 || role && /button|tab|option|menuitem|link/.test(rawAttribute(role)));
        if (interactive) {
            const line = source.slice(0, node.start).split("\n").length;
            const content = labelSource(node.fragment).replace(/\s+/g, " ").trim();
            const nativeKeyboard = ["button", "input", "select", "textarea", "summary", "a"].includes(tag);
            const control = {
                id: `${file}:${line}`, file, line, tag,
                name: rawAttribute(getAttribute("aria-label")) ?? rawAttribute(getAttribute("title"))
                    ?? rawAttribute(getAttribute("id")) ?? content.slice(0, 240),
                handlers: events.map(rawAttribute),
                bindings: attributes.filter((attribute) => attribute.type === "BindDirective").map(rawAttribute),
                disabled: rawAttribute(getAttribute("disabled")),
                keyboard: nativeKeyboard ? "native" : rawAttribute(getAttribute("tabindex")) ?? "needs_review",
            };
            controls.push(control);
            if (!nativeKeyboard && events.some((attribute) => /click/.test(attribute.name)) && !getAttribute("tabindex")) {
                findings.push({ id: control.id, kind: "keyboard_review", evidence: control.handlers });
            }
            if (events.some((attribute) => /^onclick=\{\([^)]*\)\s*=>\s*\{\s*\}\}$/.test(rawAttribute(attribute)))) {
                findings.push({ id: control.id, kind: "empty_handler", evidence: control.handlers });
            }
        }
        for (const [key, child] of Object.entries(node)) {
            if (!["attributes", "loc", "parent", "metadata"].includes(key)) visit(child);
        }
    }
    visit(ast.fragment);
}
process.stdout.write(JSON.stringify({
    scope: "Current Svelte component source; runtime failures, conditional visibility and host behavior require separate verification",
    files: files.length, controls: controls.length, findings, inventory: controls,
}, null, 2));

#!/usr/bin/env node
/**
 * Design token audit for the Lv Contacts UI.
 *
 * The audit is intentionally lexical rather than a full CSS parser: Sass and
 * the prototype HTML are both inputs, and a stable lexical baseline makes the
 * before/after numbers reproducible on every machine. Values expressed through
 * CSS custom properties are counted separately from literals so coverage can
 * be tracked as the token system is consolidated.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const outIndex = args.indexOf("--out");
const outPath = outIndex >= 0 && args[outIndex + 1]
  ? path.resolve(root, args[outIndex + 1])
  : null;

/* Include component-scoped <style> blocks as first-class audit input. The
 * previous scope only covered global Sass, so a component could reintroduce
 * host colors or spacing without appearing in the report. */
const sourceRoots = ["src", "docs/ui-prototype.html"];
const includeExtensions = new Set([".scss", ".css", ".html", ".svelte"]);

async function collectFiles(entry) {
  const absolute = path.resolve(root, entry);
  const info = await fs.stat(absolute);
  if (info.isFile()) return [absolute];
  const result = [];
  const queue = [absolute];
  while (queue.length) {
    const dir = queue.pop();
    for (const item of await fs.readdir(dir, { withFileTypes: true })) {
      const target = path.join(dir, item.name);
      if (item.isDirectory()) queue.push(target);
      else if (includeExtensions.has(path.extname(item.name))) result.push(target);
    }
  }
  return result;
}

const files = (await Promise.all(sourceRoots.map(collectFiles))).flat().sort();
const literal = {
  colors: /(?:#[0-9a-f]{3,8}\b|(?:rgb|hsl)a?\([^)]*\))/gi,
  lengths: /(?<![-\w.])(\d+(?:\.\d+)?)(px|rem|em|ch|vh|vw|dvh|dvw)(?![-\w])/gi,
  fontSize: /font-size\s*:\s*([^;{}]+)/gi,
  lineHeight: /line-height\s*:\s*([^;{}]+)/gi,
  radius: /border-radius\s*:\s*([^;{}]+)/gi,
  shadow: /(?:box|text)-shadow\s*:\s*([^;{}]+)/gi,
  durations: /(?:transition(?:-duration)?|animation-duration)\s*:\s*([^;{}]+)/gi,
  zIndex: /z-index\s*:\s*(-?\d+)/gi,
};

function matches(text, re) {
  return [...text.matchAll(re)].map((match) => match[0]);
}

function unique(values) {
  return [...new Set(values.map((value) => value.trim()))].sort();
}

function countDeclarations(text) {
  return (text.match(/(^|[;{}])\s*[\w-]+\s*:/g) ?? []).length;
}

function countTokenDeclarations(text) {
  return (text.match(/--lvct-[\w-]+\s*:/g) ?? []).length;
}

function countTokenUsages(text) {
  return (text.match(/var\(\s*--lvct-[\w-]+/g) ?? []).length;
}

function auditText(file, source) {
  if (path.extname(file) !== ".svelte") return source;
  return [...source.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi)]
    .map((match) => match[1])
    .join("\n");
}

const byFile = [];
const aggregate = {
  files: 0,
  bytes: 0,
  lines: 0,
  declarations: 0,
  tokenDeclarations: 0,
  tokenUsages: 0,
  literals: { colors: 0, lengths: 0, fontSize: 0, lineHeight: 0, radius: 0, shadow: 0, durations: 0, zIndex: 0 },
  uniqueLiterals: { colors: 0, lengths: 0, fontSize: 0, lineHeight: 0, radius: 0, shadow: 0, durations: 0, zIndex: 0 },
  nonGridLengths: 0,
};
const allUnique = Object.fromEntries(Object.keys(aggregate.uniqueLiterals).map((key) => [key, []]));

for (const file of files) {
  const text = auditText(file, await fs.readFile(file, "utf8"));
  /* Keep the report about CSS, not Svelte markup/logic. */
  if (text.trim() === "") continue;
  const rel = path.relative(root, file).replaceAll(path.sep, "/");
  const stats = {
    file: rel,
    bytes: Buffer.byteLength(text),
    lines: text.split(/\r?\n/).length,
    declarations: countDeclarations(text),
    tokenDeclarations: countTokenDeclarations(text),
    tokenUsages: countTokenUsages(text),
    literals: {},
    uniqueLiterals: {},
    nonGridLengths: 0,
  };
  aggregate.bytes += stats.bytes;
  aggregate.files += 1;
  aggregate.lines += stats.lines;
  aggregate.declarations += stats.declarations;
  aggregate.tokenDeclarations += stats.tokenDeclarations;
  aggregate.tokenUsages += stats.tokenUsages;
  for (const [key, re] of Object.entries(literal)) {
    const found = matches(text, re);
    stats.literals[key] = found.length;
    stats.uniqueLiterals[key] = unique(found);
    aggregate.literals[key] += found.length;
    aggregate.uniqueLiterals[key] += stats.uniqueLiterals[key].length;
    allUnique[key].push(...stats.uniqueLiterals[key]);
  }
  const lengths = [...text.matchAll(literal.lengths)].map((m) => Number(m[1]));
  stats.nonGridLengths = lengths.filter((value) => value !== 0 && value % 4 !== 0).length;
  aggregate.nonGridLengths += stats.nonGridLengths;
  byFile.push(stats);
}

const uniqueLiterals = Object.fromEntries(Object.entries(allUnique).map(([key, values]) => [key, unique(values)]));
const result = {
  generatedAt: new Date().toISOString(),
  scope: sourceRoots,
  methodology: "Lexical audit of global/component-scoped CSS and prototype HTML; Svelte markup and logic are excluded, while CSS custom-property references are tracked separately from literals.",
  aggregate: {
    ...aggregate,
    uniqueLiterals,
    tokenCoverage: aggregate.declarations
      ? Number(((aggregate.tokenUsages / aggregate.declarations) * 100).toFixed(2))
      : 0,
  },
  byFile,
};

const output = `${JSON.stringify(result, null, 2)}\n`;
if (outPath) {
  await fs.mkdir(path.dirname(outPath), { recursive: true });
  await fs.writeFile(outPath, output, "utf8");
}
process.stdout.write(output);

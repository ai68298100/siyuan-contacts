import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const archive = path.resolve(import.meta.dirname, "../package.zip");
const content = fs.readFileSync(archive);
if (content.length === 0) throw new Error("package.zip 为空，未生成校验和");
const digest = createHash("sha256").update(content).digest("hex");
fs.writeFileSync(`${archive}.sha256`, `${digest}  ${path.basename(archive)}\n`, "utf8");
console.log(`package.zip SHA-256: ${digest}`);

/**
 * 生成 icon.png(160x160) 与 preview.png(1024x768)。
 * 与小驴打卡/小驴雷切同一视觉语言：浅色圆角底、层叠卡片、蓝紫渐变、白色主图形、点缀橙点。
 * 主图形 = 双人剪影（人脉）。SDF 距离场绘制 + 3x3 超采样抗锯齿，纯 Node 零依赖。
 * 运行：node scripts/gen-icon.mjs
 */
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";

/* ---------- PNG 编码 ---------- */

function crc32(buffer) {
    let table = crc32.table;
    if (!table) {
        table = crc32.table = new Int32Array(256);
        for (let n = 0; n < 256; n += 1) {
            let c = n;
            for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
            table[n] = c;
        }
    }
    let crc = -1;
    for (const byte of buffer) crc = (crc >>> 8) ^ table[(crc ^ byte) & 0xff];
    return (crc ^ -1) >>> 0;
}

function chunk(type, data) {
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body));
    return Buffer.concat([length, body, crc]);
}

function encodePng(width, height, pixelAt) {
    const raw = Buffer.alloc(height * (1 + width * 3));
    for (let y = 0; y < height; y += 1) {
        const rowStart = y * (1 + width * 3);
        raw[rowStart] = 0;
        for (let x = 0; x < width; x += 1) {
            const [r, g, b] = pixelAt(x, y);
            const offset = rowStart + 1 + x * 3;
            raw[offset] = r;
            raw[offset + 1] = g;
            raw[offset + 2] = b;
        }
    }
    const ihdr = Buffer.alloc(13);
    ihdr.writeUInt32BE(width, 0);
    ihdr.writeUInt32BE(height, 4);
    ihdr[8] = 8;
    ihdr[9] = 2;
    return Buffer.concat([
        Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
        chunk("IHDR", ihdr),
        chunk("IDAT", zlib.deflateSync(raw)),
        chunk("IEND", Buffer.alloc(0)),
    ]);
}

/* ---------- SDF 绘图 ---------- */

const sdCircle = (px, py, cx, cy, r) => Math.hypot(px - cx, py - cy) - r;

function sdRoundRect(px, py, cx, cy, hx, hy, r) {
    const qx = Math.abs(px - cx) - (hx - r);
    const qy = Math.abs(py - cy) - (hy - r);
    const ox = Math.max(qx, 0);
    const oy = Math.max(qy, 0);
    return Math.hypot(ox, oy) + Math.min(Math.max(qx, qy), 0) - r;
}

/** 形状：SDF + 填充色（[r,g,b] 或 (x,y)=>[r,g,b]）+ 可选 alpha */
function shape(sdf, fill, alpha = 1) {
    return { sdf, fill, alpha };
}

function mix(base, over, alpha) {
    return [
        base[0] + (over[0] - base[0]) * alpha,
        base[1] + (over[1] - base[1]) * alpha,
        base[2] + (over[2] - base[2]) * alpha,
    ];
}

/** 3x3 超采样渲染：shapes 按 painter's order，坐标以 size=160 的设计稿为准 */
function render(width, height, shapes) {
    const scale = Math.min(width, height) / 160;
    const offsetX = (width - 160 * scale) / 2;
    const offsetY = (height - 160 * scale) / 2;
    const ss = 3;
    return (x, y) => {
        let acc = [255, 255, 255];
        for (const [sx, sy] of [[0, 0], [1, 0], [0, 1], [1, 1], [2, 2], [2, 0], [0, 2], [1, 2], [2, 1]]) {
            const dx = x + (sx + 0.5) / ss;
            const dy = y + (sy + 0.5) / ss;
            const ux = (dx - offsetX) / scale;
            const uy = (dy - offsetY) / scale;
            let color = [255, 255, 255];
            for (const item of shapes) {
                const d = item.sdf(ux, uy);
                const cover = Math.min(Math.max(0.5 - d, 0), 1);
                if (cover <= 0) continue;
                const fill = typeof item.fill === "function" ? item.fill(ux, uy) : item.fill;
                color = mix(color, fill, cover * item.alpha);
            }
            acc = [
                acc[0] + color[0] / (ss * ss),
                acc[1] + color[1] / (ss * ss),
                acc[2] + color[2] / (ss * ss),
            ];
        }
        return [Math.round(acc[0]), Math.round(acc[1]), Math.round(acc[2])];
    };
}

/* ---------- 设计（160 设计稿坐标） ---------- */

/** 垂直渐变填充 */
function vGradient(y0, y1, top, bottom) {
    return (_x, y) => {
        const t = Math.min(Math.max((y - y0) / (y1 - y0), 0), 1);
        return [
            top[0] + (bottom[0] - top[0]) * t,
            top[1] + (bottom[1] - top[1]) * t,
            top[2] + (bottom[2] - top[2]) * t,
        ];
    };
}

function designShapes() {
    return [
        // 浅色底板（圆角方形，打卡同款浅灰蓝）
        shape((x, y) => sdRoundRect(x, y, 80, 80, 78, 78, 34), vGradient(2, 158, [246, 248, 253], [232, 238, 250])),
        // 后层卡片（浅紫蓝）
        shape((x, y) => sdRoundRect(x, y, 84, 74, 45, 42, 15), [206, 216, 248]),
        // 前层卡片（蓝紫渐变）
        shape((x, y) => sdRoundRect(x, y, 76, 84, 45, 42, 15), vGradient(42, 126, [124, 108, 246], [72, 106, 240])),
        // 白色双人剪影：后位人（半透明）
        shape((x, y) => sdCircle(x, y, 92, 76, 10.5), [255, 255, 255], 0.62),
        shape((x, y) => sdRoundRect(x, y, 92, 103, 13.5, 12, 11), [255, 255, 255], 0.62),
        // 前位人（实白）
        shape((x, y) => sdCircle(x, y, 64, 80, 12.5), [255, 255, 255]),
        shape((x, y) => sdRoundRect(x, y, 64, 110, 16, 14, 13), [255, 255, 255]),
        // 点缀橙点（打卡同款位置语言：卡片右上）
        shape((x, y) => sdCircle(x, y, 112, 46, 10.5), [255, 255, 255]),
        shape((x, y) => sdCircle(x, y, 112, 46, 7.5), [255, 154, 60]),
    ];
}

const root = path.resolve(import.meta.dirname, "..");
fs.writeFileSync(path.join(root, "icon.png"), encodePng(160, 160, render(160, 160, designShapes())));
fs.writeFileSync(path.join(root, "preview.png"), encodePng(1024, 768, render(1024, 768, designShapes())));
console.log("icon.png / preview.png 已生成（Lv Contacts 家庭视觉）");

/**
 * 生成小驴人脉 logo（小驴系列视觉：浅底圆角 + 渐变主形 + 白色图形）。
 * 与打卡(紫色对勾+橙点)、雷切(蓝色闪电)区分：人脉 = 青绿色系 + 双人相连图形，无橙点。
 * SDF 距离场绘制 + 3x3 超采样，纯 Node 零依赖。
 *
 * 用法：
 *   node scripts/gen-icon.mjs a            # 生成变体 a → icon.png + preview.png
 *   node scripts/gen-icon.mjs a b c --all  # 生成 320px 预览 icon-variant-*.png
 * 变体：a 青绿卡片·双人相连 / b 轻盈双人(无卡片) / c 深青底白描边
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

/* ---------- SDF ---------- */

const sdCircle = (px, py, cx, cy, r) => Math.hypot(px - cx, py - cy) - r;

function sdRoundRect(px, py, cx, cy, hx, hy, r) {
    const qx = Math.abs(px - cx) - (hx - r);
    const qy = Math.abs(py - cy) - (hy - r);
    return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r;
}

function sdCapsule(px, py, ax, ay, bx, by, r) {
    const pax = px - ax;
    const pay = py - ay;
    const bax = bx - ax;
    const bay = by - ay;
    const h = Math.min(Math.max((pax * bax + pay * bay) / (bax * bax + bay * bay), 0), 1);
    return Math.hypot(pax - bax * h, pay - bay * h) - r;
}

/** 白描边圆环（头形描边用） */
const sdRing = (px, py, cx, cy, r, w) => Math.abs(Math.hypot(px - cx, py - cy) - r) - w;

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

const solid = (rgb) => () => rgb;

/** 对角渐变（左上→右下） */
function diagGradient(topLeft, bottomRight) {
    return (x, y) => {
        const t = Math.min(Math.max((x + y) / 200, 0), 1);
        return [
            topLeft[0] + (bottomRight[0] - topLeft[0]) * t,
            topLeft[1] + (bottomRight[1] - topLeft[1]) * t,
            topLeft[2] + (bottomRight[2] - topLeft[2]) * t,
        ];
    };
}

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

function render(width, height, shapes) {
    const scale = Math.min(width, height) / 160;
    const offsetX = (width - 160 * scale) / 2;
    const offsetY = (height - 160 * scale) / 2;
    const ss = 3;
    const offsets = [];
    for (let sy = 0; sy < ss; sy += 1) for (let sx = 0; sx < ss; sx += 1) offsets.push([(sx + 0.5) / ss, (sy + 0.5) / ss]);
    return (x, y) => {
        let acc = [255, 255, 255];
        for (const [sx, sy] of offsets) {
            const ux = (x + sx - offsetX) / scale;
            const uy = (y + sy - offsetY) / scale;
            let color = [255, 255, 255];
            for (const item of shapes) {
                const d = item.sdf(ux, uy);
                const cover = Math.min(Math.max(0.5 - d, 0), 1);
                if (cover <= 0) continue;
                const fill = typeof item.fill === "function" ? item.fill(ux, uy) : item.fill;
                color = mix(color, fill, cover * item.alpha);
            }
            acc = [acc[0] + color[0] / (ss * ss), acc[1] + color[1] / (ss * ss), acc[2] + color[2] / (ss * ss)];
        }
        return [Math.round(acc[0]), Math.round(acc[1]), Math.round(acc[2])];
    };
}

const LIGHT_BG = (x, y) => vGradient(2, 158, [246, 248, 253], [232, 238, 250])(x, y);
const basePlate = () => shape((x, y) => sdRoundRect(x, y, 80, 80, 78, 78, 34), LIGHT_BG);

/* ---------- 变体 ---------- */

const TEAL = { a: [43, 179, 155], b: [30, 136, 176] };
const WHITE = [255, 255, 255];

/** a：青绿渐变卡片 + 双人相连（推荐） */
function variantA() {
    return [
        basePlate(),
        // 青绿渐变圆角卡片（对角渐变，区别于打卡的紫、雷切的蓝）
        shape((x, y) => sdRoundRect(x, y, 80, 82, 48, 45, 16), diagGradient([56, 190, 160], [26, 128, 176])),
        // 前位人物（白，头肩相接）
        shape((x, y) => sdCircle(x, y, 58, 76, 13), WHITE),
        shape((x, y) => sdRoundRect(x, y, 58, 103, 17, 14, 13.5), WHITE),
        // 后位人物（白 65%，右后）
        shape((x, y) => sdCircle(x, y, 98, 72, 10.5), WHITE, 0.65),
        shape((x, y) => sdRoundRect(x, y, 98, 94, 13.5, 11, 10.5), WHITE, 0.65),
    ];
}

/** b：轻盈双人（无卡片，人物即主形） */
function variantB() {
    const tealFill = diagGradient([56, 190, 160], [26, 136, 176]);
    return [
        basePlate(),
        // 左人物：青绿实心大剪影
        shape((x, y) => sdCircle(x, y, 55, 74, 17), tealFill),
        shape((x, y) => sdRoundRect(x, y, 55, 110, 22, 18, 18), tealFill),
        // 右人物：浅蓝灰半透明
        shape((x, y) => sdCircle(x, y, 104, 78, 13.5), [120, 144, 190], 0.75),
        shape((x, y) => sdRoundRect(x, y, 104, 108, 18, 15, 14), [120, 144, 190], 0.75),
    ];
}

/** c：深青底 + 白描边双人（最大的货架辨识度） */
function variantC() {
    return [
        shape((x, y) => sdRoundRect(x, y, 80, 80, 78, 78, 34), diagGradient([18, 118, 110], [21, 94, 158])),
        // 前位人物（白描边头 + 白实心底肩）
        shape((x, y) => sdRing(x, y, 58, 76, 11.5, 3.4), WHITE),
        shape((x, y) => sdRoundRect(x, y, 58, 104, 16, 13, 13), WHITE),
        // 后位人物
        shape((x, y) => sdRing(x, y, 98, 72, 9.5, 3), WHITE, 0.7),
        shape((x, y) => sdRoundRect(x, y, 98, 95, 12.5, 10.5, 10), WHITE, 0.7),
    ];
}

const VARIANTS = { a: variantA, b: variantB, c: variantC };

const root = path.resolve(import.meta.dirname, "..");
const args = process.argv.slice(2);
const wantAll = args.includes("--all");
const picked = args.find((arg) => VARIANTS[arg]) ?? "a";

if (wantAll) {
    for (const name of Object.keys(VARIANTS)) {
        fs.writeFileSync(path.join(root, `icon-variant-${name}.png`), encodePng(320, 320, render(320, 320, VARIANTS[name]())));
    }
    console.log("预览 icon-variant-a/b/c.png (320px) 已生成");
} else {
    fs.writeFileSync(path.join(root, "icon.png"), encodePng(160, 160, render(160, 160, VARIANTS[picked]())));
    fs.writeFileSync(path.join(root, "preview.png"), encodePng(1024, 768, render(1024, 768, VARIANTS[picked]())));
    console.log(`icon.png / preview.png 已生成（变体 ${picked}）`);
}

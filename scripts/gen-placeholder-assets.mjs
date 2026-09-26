/**
 * 生成占位 icon.png(160x160) 与 preview.png(1024x768)。
 * 纯 Node zlib 手写 PNG（无依赖），正式图标后续替换。
 * 运行：node scripts/gen-placeholder-assets.mjs
 */
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";

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

/** 主色 #3575f0 系思源蓝系；中央画一个双人剪影（近似插件图标） */
function lvPixelFactory(width, height) {
    const cx = width / 2;
    const cy = height / 2;
    const unit = Math.min(width, height);
    const headR = unit * 0.13;
    const bodyRx = unit * 0.20;
    const bodyTop = cy - unit * 0.02;
    return (x, y) => {
        const dx1 = x - (cx - unit * 0.11);
        const dy1 = y - (cy - unit * 0.10);
        const head1 = dx1 * dx1 + dy1 * dy1 <= headR * headR;
        const inBody1 = Math.abs(x - (cx - unit * 0.11)) <= bodyRx * 0.8 && y >= bodyTop && y <= cy + unit * 0.26;
        const dx2 = x - (cx + unit * 0.12);
        const dy2 = y - (cy - unit * 0.13);
        const head2 = dx2 * dx2 + dy2 * dy2 <= (headR * 0.8) * (headR * 0.8);
        if (head1 || inBody1 || head2) return [0x2b, 0x6c, 0xe8];
        const edge = x < 6 || y < 6 || x >= width - 6 || y >= height - 6;
        if (edge) return [0x2b, 0x6c, 0xe8];
        return [0xf5, 0xf8, 0xfd];
    };
}

const root = path.resolve(import.meta.dirname, "..");
fs.writeFileSync(path.join(root, "icon.png"), encodePng(160, 160, lvPixelFactory(160, 160)));
fs.writeFileSync(path.join(root, "preview.png"), encodePng(1024, 768, lvPixelFactory(1024, 768)));
console.log("占位 icon.png / preview.png 已生成");

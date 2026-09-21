import { readFileSync, writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import { decodePNG } from './png-analyze.mjs';

/* 把自己产出的透明 PNG 合成到指定底色上，用于「肉眼验证」——
   因为白线 + 白底预览 = 看不见，必须换深底才看得见。 */

function crc32(buf) {
  let c, crc = 0xffffffff;
  for (let n = 0; n < buf.length; n++) {
    c = (crc ^ buf[n]) & 0xff;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    crc = c ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function encodePNG(W, H, rgb) {
  const stride = W * 3;
  const raw = Buffer.alloc(H * (stride + 1));
  for (let y = 0; y < H; y++) {
    raw[y * (stride + 1)] = 0;
    rgb.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(W, 0); ihdr.writeUInt32BE(H, 4);
  ihdr[8] = 8; ihdr[9] = 2; // RGB8
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0)),
  ]);
}

// 合成：out = src over bg
export function compositeOn(src, dst, bg = { r: 10, g: 10, b: 10 }) {
  const img = decodePNG(src);
  const { W, H, ch, data } = img;
  if (ch !== 4) throw new Error('source has no alpha channel');
  const out = Buffer.alloc(W * H * 3);
  let lit = 0, total = 0;
  for (let i = 0, o = 0; i < W * H * 4; i += 4, o += 3) {
    const a = data[i + 3] / 255;
    total++;
    if (a > 0.18) lit++;
    out[o]     = Math.round(data[i]     * a + bg.r * (1 - a));
    out[o + 1] = Math.round(data[i + 1] * a + bg.g * (1 - a));
    out[o + 2] = Math.round(data[i + 2] * a + bg.b * (1 - a));
  }
  writeFileSync(dst, encodePNG(W, H, out));
  return { W, H, coverage: (lit / total * 100).toFixed(2) + '%' };
}

if (process.argv[1] && process.argv[1].endsWith('png-composite.mjs')) {
  const [src, dst] = process.argv.slice(2);
  const r = compositeOn(src, dst);
  console.log(`合成完成 → ${dst}`);
  console.log(`  ${r.W}x${r.H}  有效线条覆盖率 ${r.coverage}`);
}

import { readFileSync, writeFileSync } from 'node:fs';
import { inflateSync, deflateSync } from 'node:zlib';
import { decodePNG } from './png-analyze.mjs';

/* ═══════════════════════════════════════════════════════════
   本地亮度键控（luminance keying）
   输入：白底 + 深色线 的 PNG（模型产出的实际形态）
   输出：透明底 + 指定颜色线条 的 PNG（我们真正要的形态）

   为什么走这条路（有硬证据）：
   - Ark9 确实传了 background:'transparent'（lib/index.js:441）
   - 但产出 colorType=2（3 通道，无 alpha）⇒ 模型/中转站忽略了该参数
   - 与其反复要求模型支持透明，不如本地键控：零成本、可控、线色任意
   ═══════════════════════════════════════════════════════════ */

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
function encodePNG(W, H, rgba) {
  const stride = W * 4;
  const raw = Buffer.alloc(H * (stride + 1));
  for (let y = 0; y < H; y++) {
    raw[y * (stride + 1)] = 0; // filter none
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(W, 0); ihdr.writeUInt32BE(H, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0; // RGBA8
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/**
 * @param src 输入 PNG 路径（白底深线）
 * @param dst 输出 PNG 路径（透明底 + 白/浅蓝线）
 * @param opts.ink   主线颜色 {r,g,b}  默认纯白
 * @param opts.ink2  次级线颜色（中间调） 默认品牌蓝
 * @param opts.floor 亮度阈值：低于此值视为纯线条
 * @param opts.ceil  亮度阈值：高于此值视为纯背景
 */
export function keying(src, dst, opts = {}) {
  const ink = opts.ink || { r: 255, g: 255, b: 255 };
  const ink2 = opts.ink2 || { r: 103, g: 153, b: 254 }; // #6799fe
  const floor = opts.floor ?? 60;   // <=floor 全不透明
  const ceil = opts.ceil ?? 215;    // >=ceil 全透明
  const gamma = opts.gamma ?? 1.0;

  const img = decodePNG(src);
  const { W, H, ch, data } = img;
  const rgba = Buffer.alloc(W * H * 4);
  let minX = W, minY = H, maxX = -1, maxY = -1;

  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const si = (y * W + x) * ch;
      const r = data[si], g = data[si + 1], b = data[si + 2];
      const L = 0.2126 * r + 0.7152 * g + 0.0722 * b;
      // alpha：暗=不透明
      let a = (ceil - L) / (ceil - floor);
      a = a < 0 ? 0 : a > 1 ? 1 : a;
      if (gamma !== 1) a = Math.pow(a, gamma);
      const di = (y * W + x) * 4;
      // 颜色：深的地方用主色，中间调用次色，平滑过渡
      const t = L / 255; // 0=最暗
      const mix = t < 0.5 ? 0 : (t - 0.5) * 2; // 越暗越偏主色
      const cr = Math.round(ink.r * (1 - mix) + ink2.r * mix);
      const cg = Math.round(ink.g * (1 - mix) + ink2.g * mix);
      const cb = Math.round(ink.b * (1 - mix) + ink2.b * mix);
      rgba[di] = cr; rgba[di + 1] = cg; rgba[di + 2] = cb;
      rgba[di + 3] = Math.round(a * 255);
      if (a > 0.15) {
        if (x < minX) minX = x; if (x > maxX) maxX = x;
        if (y < minY) minY = y; if (y > maxY) maxY = y;
      }
    }
  }
  writeFileSync(dst, encodePNG(W, H, rgba));
  return { W, H, bbox: maxX > 0 ? { minX, minY, maxX, maxY } : null };
}

/* ── 裁剪 + 内边距：把前景居中到目标画布 ── */
function cropPad(src, dst, targetW, targetH, padRatio = 0.06) {
  const img = decodePNG(src);
  const { W, H, ch, data } = img;
  // 求 alpha 包围盒
  let minX = W, minY = H, maxX = -1, maxY = -1;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    if (data[(y * W + x) * ch + 3] > 24) {
      if (x < minX) minX = x; if (x > maxX) maxX = x;
      if (y < minY) minY = y; if (y > maxY) maxY = y;
    }
  }
  if (maxX < 0) throw new Error('empty');
  const fw = maxX - minX + 1, fh = maxY - minY + 1;
  const availW = targetW * (1 - padRatio * 2), availH = targetH * (1 - padRatio * 2);
  const s = Math.min(availW / fw, availH / fh);
  const dw = Math.round(fw * s), dh = Math.round(fh * s);
  const ox = Math.round((targetW - dw) / 2), oy = Math.round((targetH - dh) / 2);
  const out = Buffer.alloc(targetW * targetH * 4);
  for (let y = 0; y < dh; y++) {
    const sy = minY + Math.min(fh - 1, Math.floor(y / s));
    for (let x = 0; x < dw; x++) {
      const sx = minX + Math.min(fw - 1, Math.floor(x / s));
      const si = (sy * W + sx) * ch;
      const di = ((oy + y) * targetW + (ox + x)) * 4;
      out[di] = data[si]; out[di + 1] = data[si + 1];
      out[di + 2] = data[si + 2];
      out[di + 3] = ch === 4 ? data[si + 3] : 255;
    }
  }
  writeFileSync(dst, encodePNG(targetW, targetH, out));
  return { dw, dh, ox, oy, scale: s, srcBox: { fw, fh } };
}

export { cropPad };

if (process.argv[1] && process.argv[1].endsWith('png-keying.mjs')) {
  const [src, dst] = process.argv.slice(2);
  const r = keying(src, dst);
  console.log(`键控完成 ${src} → ${dst}`);
  console.log(`  ${r.W}x${r.H}  前景盒 ${JSON.stringify(r.bbox)}`);
}

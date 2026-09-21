import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

// 零依赖 PNG 解析：读 IHDR + IDAT 解压 + 反滤波
import { inflateSync } from 'node:zlib';

export function decodePNG(path) {
  const buf = readFileSync(path);
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error('not png');
  let off = 8, W = 0, H = 0, bitDepth = 0, colorType = 0;
  const idat = [];
  while (off < buf.length) {
    const len = buf.readUInt32BE(off);
    const type = buf.toString('ascii', off + 4, off + 8);
    const data = buf.subarray(off + 8, off + 8 + len);
    if (type === 'IHDR') {
      W = data.readUInt32BE(0); H = data.readUInt32BE(4);
      bitDepth = data[8]; colorType = data[9];
    } else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
    off += 12 + len;
  }
  const raw = inflateSync(Buffer.concat(idat));
  const ch = colorType === 6 ? 4 : colorType === 2 ? 3 : colorType === 0 ? 1 : 0;
  if (!ch) throw new Error('unsupported colorType ' + colorType);
  const stride = W * ch;
  const out = Buffer.alloc(H * stride);
  let p = 0;
  for (let y = 0; y < H; y++) {
    const ft = raw[p++];
    const line = raw.subarray(p, p + stride); p += stride;
    const prev = y > 0 ? out.subarray((y - 1) * stride, y * stride) : Buffer.alloc(stride);
    const cur = out.subarray(y * stride, (y + 1) * stride);
    for (let x = 0; x < stride; x++) {
      const a = x >= ch ? cur[x - ch] : 0;
      const b = prev[x];
      const c = x >= ch ? prev[x - ch] : 0;
      let v = line[x];
      if (ft === 1) v += a;
      else if (ft === 2) v += b;
      else if (ft === 3) v += (a + b) >> 1;
      else if (ft === 4) {
        const pa = Math.abs(b - c), pb = Math.abs(a - c), pc = Math.abs(a + b - 2 * c);
        v += (pa <= pb && pa <= pc) ? a : (pb <= pc ? b : c);
      }
      cur[x] = v & 0xff;
    }
  }
  return { W, H, ch, colorType, bitDepth, data: out };
}

const files = process.argv[1] && process.argv[1].endsWith('png-analyze.mjs') ? process.argv.slice(2) : [];
for (const f of files) {
  const img = decodePNG(f);
  const { W, H, ch, data } = img;
  const px = (x, y) => {
    const i = (y * W + x) * ch;
    return [data[i], data[i + 1], data[i + 2], ch === 4 ? data[i + 3] : 255];
  };
  const lum = (x, y) => { const [r, g, b] = px(x, y); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };

  // 四角背景色
  const corners = [px(2, 2), px(W - 3, 2), px(2, H - 3), px(W - 3, H - 3)];
  const bg = corners[0];
  const bgUniform = corners.every(c => Math.abs(c[0] - bg[0]) + Math.abs(c[1] - bg[1]) + Math.abs(c[2] - bg[2]) < 24);

  // 直方图 + 前景包围盒
  let dark = 0, light = 0, mid = 0, total = 0;
  let minX = W, minY = H, maxX = -1, maxY = -1;
  const step = 2;
  for (let y = 0; y < H; y += step) {
    for (let x = 0; x < W; x += step) {
      const L = lum(x, y); total++;
      if (L < 60) dark++; else if (L > 200) light++; else mid++;
      // 前景判定：与背景色差异大
      const [r, g, b] = px(x, y);
      const d = Math.abs(r - bg[0]) + Math.abs(g - bg[1]) + Math.abs(b - bg[2]);
      if (d > 90) {
        if (x < minX) minX = x; if (x > maxX) maxX = x;
        if (y < minY) minY = y; if (y > maxY) maxY = y;
      }
    }
  }
  const pct = n => (n / total * 100).toFixed(1) + '%';
  const bgIsDark = (0.2126 * bg[0] + 0.7152 * bg[1] + 0.0722 * bg[2]) < 96;

  console.log('════ ' + f.split('\\').pop() + ' ════');
  console.log(`  尺寸 ${W}x${H}  colorType=${img.colorType} (${ch}通道${ch === 4 ? ' 有alpha' : ' 无alpha'})`);
  console.log(`  背景色 rgb(${bg[0]},${bg[1]},${bg[2]})  ${bgIsDark ? '深色' : '浅色'}  四角一致=${bgUniform}`);
  console.log(`  亮度分布  暗(<60) ${pct(dark)} 中 ${pct(mid)} 亮(>200) ${pct(light)}`);
  console.log(`  ⇒ 判定: ${bgIsDark ? '浅色线条 + 深色背景' : '深色线条 + 浅色背景'}`);
  if (maxX > 0) {
    console.log(`  前景包围盒 x[${minX},${maxX}] y[${minY},${maxY}]  ${maxX - minX}x${maxY - minY}`);
    console.log(`  占比: 宽 ${((maxX - minX) / W * 100).toFixed(1)}%  高 ${((maxY - minY) / H * 100).toFixed(1)}%`);
  } else console.log('  前景包围盒: 未检出（背景纯色）');
  console.log('');
}

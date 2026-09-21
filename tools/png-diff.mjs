import { readFileSync } from 'node:fs';
import { decodePNG } from './png-analyze.mjs';

/* 两张同尺寸 PNG 的逐像素差异 + 覆盖率统计
   用法: node tools/png-diff.mjs a.png b.png */

function stats(path) {
  const img = decodePNG(path);
  const { width: w, height: h, px } = img;
  const ch = px.length / (w * h);
  let ink = 0, sum = 0, n = 0;
  const rows = [];
  for (let y = 0; y < h; y++) {
    let rowInk = 0;
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * ch;
      const lum = ch >= 3
        ? (px[i] * 0.299 + px[i + 1] * 0.587 + px[i + 2] * 0.114) * (ch === 4 ? px[i + 3] / 255 : 1)
        : px[i];
      sum += lum; n++;
      if (lum > 22) { ink++; rowInk++; }
    }
    if (y % 200 === 0) rows.push(`${y}:${rowInk}`);
  }
  return { w, h, ch, meanLum: +(sum / n).toFixed(2), inkPct: +(ink / n * 100).toFixed(2), rows, px, count: n };
}

const a = stats(process.argv[2]);
const b = stats(process.argv[3]);

console.log(`A ${process.argv[2]}`);
console.log(`   ${a.w}x${a.h} ch=${a.ch} 平均亮度=${a.meanLum} 非底色像素=${a.inkPct}%`);
console.log(`B ${process.argv[3]}`);
console.log(`   ${b.w}x${b.h} ch=${b.ch} 平均亮度=${b.meanLum} 非底色像素=${b.inkPct}%`);

if (a.w === b.w && a.h === b.h) {
  let diff = 0, maxd = 0, firstRow = -1, lastRow = -1;
  for (let y = 0; y < a.h; y++) {
    let rowDiff = 0;
    for (let x = 0; x < a.w; x++) {
      const ia = (y * a.w + x) * a.ch, ib = (y * b.w + x) * b.ch;
      const d = Math.abs(a.px[ia] - b.px[ib]) + Math.abs(a.px[ia + 1] - b.px[ib + 1]) + Math.abs(a.px[ia + 2] - b.px[ib + 2]);
      if (d > 30) { diff++; rowDiff++; if (d > maxd) maxd = d; }
    }
    if (rowDiff > 20) { if (firstRow < 0) firstRow = y; lastRow = y; }
  }
  console.log(`\n差异像素 ${diff} (${(diff / (a.w * a.h) * 100).toFixed(2)}%)  最大通道差 ${maxd}`);
  console.log(`差异集中在 y=${firstRow} … ${lastRow}`);
}

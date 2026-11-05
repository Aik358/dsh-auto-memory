import { readFileSync } from 'node:fs';
import { decodePNG } from './png-analyze.mjs';

/* 两张同尺寸、同 colorType 的 PNG 的逐像素差异 + 覆盖率统计
   用法: node tools/png-diff.mjs a.png b.png
   退出码: 0=已比较（有无差异都算成功） / 1=解码失败 / 2=尺寸或通道数不一致（无法逐像素对齐） / 64=缺参数 */

function stats(path) {
  const img = decodePNG(path);
  // decodePNG 返回 { W, H, ch, colorType, bitDepth, data }——不是 width/height/px。
  // 曾经按 width/height/px 解构 ⇒ 三个全 undefined ⇒ 下面 px.length 直接 TypeError（#541 根因 1）。
  const { W: w, H: h, ch, data: px } = img;
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

const [pa, pb] = [process.argv[2], process.argv[3]];
if (!pa || !pb) {
  console.error('用法: node tools/png-diff.mjs a.png b.png');
  process.exit(64);
}
// 解码失败必须明确报出来（而不是抛栈），否则调用方只能靠 stderr 猜哪张图坏了。
for (const [label, p] of [['A', pa], ['B', pb]]) {
  try { stats(p); } catch (e) {
    console.error(`[png-diff] ${label} 解码失败：${p} —— ${(e && e.message) ? e.message : e}`);
    process.exit(1);
  }
}

const a = stats(pa);
const b = stats(pb);

console.log(`A ${pa}`);
console.log(`   ${a.w}x${a.h} ch=${a.ch} 平均亮度=${a.meanLum} 非底色像素=${a.inkPct}%`);
console.log(`B ${pb}`);
console.log(`   ${b.w}x${b.h} ch=${b.ch} 平均亮度=${b.meanLum} 非底色像素=${b.inkPct}%`);

// #541 根因 2：尺寸不等时原代码整块 if 直接跳过、**静默 exit 0**（调用方以为"没有差异"）。
// 尺寸不等就没有逐像素对齐的语义，必须显式报错，不能装作比过了。
if (a.w !== b.w || a.h !== b.h) {
  console.error(`\n[png-diff] 尺寸不一致，无法逐像素对齐：A=${a.w}x${a.h}  B=${b.w}x${b.h}`);
  console.error('  ⇒ 请先统一画布尺寸（重截/重渲染，或裁到公共区域）后再比。');
  process.exit(2);
}
// #541 根因 3：通道数不同（灰度 ch=1 vs RGB ch=3）时，按固定 3 通道差 + 各自 ch 步进会**索引错位**
// —— 实测同一张图分别存灰度与 RGB，报 14 像素 / 87.50% 纯假阳性。跨色型没有"逐像素"可比性，显式拒绝。
if (a.ch !== b.ch) {
  console.error(`\n[png-diff] 通道数不一致（A ch=${a.ch} / B ch=${b.ch}），逐像素直比会索引错位、产生假阳性。`);
  console.error('  ⇒ 请先把两张图导出为同一 colorType（同为灰度 / 同为 RGB / 同为 RGBA）后再比。');
  process.exit(2);
}

{
  let diff = 0, maxd = 0, firstRow = -1, lastRow = -1;
  // 差值必须按实际通道数分支求和：ch=1 只比 1 个通道；ch=3 比 RGB；ch=4 比 RGBA（alpha 也是视觉差异）。
  // 写死 3 通道时，ch=1 会读到相邻像素（缓冲区尾部读 undefined ⇒ 差值变 NaN ⇒ 真实差异被静默丢弃）。
  const cc = a.ch;
  for (let y = 0; y < a.h; y++) {
    let rowDiff = 0;
    for (let x = 0; x < a.w; x++) {
      const ia = (y * a.w + x) * cc, ib = (y * b.w + x) * cc;
      let d = 0;
      for (let k = 0; k < cc; k++) d += Math.abs(a.px[ia + k] - b.px[ib + k]);
      if (d > 30) { diff++; rowDiff++; if (d > maxd) maxd = d; }
    }
    if (rowDiff > 20) { if (firstRow < 0) firstRow = y; lastRow = y; }
  }
  console.log(`\n差异像素 ${diff} (${(diff / (a.w * a.h) * 100).toFixed(2)}%)  最大通道差 ${maxd}（${cc} 通道逐像素求和，上限 ${255 * cc}）`);
  console.log(firstRow < 0
    ? '差异未形成行带（没有任何整行的差异像素 >20）'
    : `差异集中在 y=${firstRow} … ${lastRow}`);
}

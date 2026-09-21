import { keying, cropPad } from './png-keying.mjs';
import { compositeOn } from './png-composite.mjs';
import { decodePNG } from './png-analyze.mjs';
import { statSync } from 'node:fs';

/* 完整管线：生图产出 → 亮度键控 → 裁切内边距 → 深底预览
   hero 规格（取自既有资产 .vision-tmp/whale-zoom.png 的线框稿）：
     视觉框 1280x1280 · 角色高 900 · 脚底锚点 (500,900)

   但 hero 页面实际用 1024x1536 竖版画布（与生图同比例），
   角色占高度 82%，水平居中，脚下留 8% —— 便于 CSS 定位。 */

const SRC = process.argv[2] || 'D:/dsh-ark9canvas/out/ark9-2026-09-20-z5koug-0.png';
const OUTDIR = process.argv[3] || 'site/preview/assets';

console.log('【1/3】亮度键控：白底深线 → 透明底白/蓝线');
const k = keying(SRC, `${OUTDIR}/_keyed.png`, {
  ink: { r: 255, g: 255, b: 255 },      // 主线纯白
  ink2: { r: 103, g: 153, b: 254 },     // 次级线 #6799fe
  floor: 55, ceil: 220,
  gamma: 0.85,                          // 略提亮细线，避免断线
});
console.log(`     ${k.W}x${k.H}  前景盒 ${JSON.stringify(k.bbox)}`);

console.log('【2/3】裁切 + 居中到 hero 画布');
const c = cropPad(`${OUTDIR}/_keyed.png`, `${OUTDIR}/whale-girl.png`, 1024, 1536, 0.05);
console.log(`     缩放 ${c.scale.toFixed(3)}  放置 ${c.dw}x${c.dh} @ (${c.ox},${c.oy})`);

console.log('【3/3】深底预览（验证可见性）');
const p = compositeOn(`${OUTDIR}/whale-girl.png`, `${OUTDIR}/whale-girl-on-dark.png`, { r: 10, g: 10, b: 10 });
console.log(`     ${p.W}x${p.H}  线条覆盖率 ${p.coverage}`);

const final = decodePNG(`${OUTDIR}/whale-girl.png`);
console.log(`\n最终产物 site/preview/assets/whale-girl.png`);
console.log(`  ${final.W}x${final.H}  colorType=${final.colorType} (${final.ch}通道${final.ch === 4 ? ' 含alpha ✓' : ' 无alpha ✗'})`);
console.log(`  体积 ${(statSync(`${OUTDIR}/whale-girl.png`).size / 1024).toFixed(0)} KB`);

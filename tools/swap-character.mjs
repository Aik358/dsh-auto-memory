import { readFileSync, writeFileSync } from 'node:fs';
import { keying, cropPad } from './png-keying.mjs';
import { compositeOn } from './png-composite.mjs';
import { decodePNG } from './png-analyze.mjs';
import { statSync } from 'node:fs';

const SRC = process.argv[2];
const OUT = 'site/preview/assets';

console.log('【1/3】键控');
keying(SRC, OUT + '/_k.png', {
  ink: { r: 255, g: 255, b: 255 },
  ink2: { r: 103, g: 153, b: 254 },
  floor: 70, ceil: 235, gamma: 0.75,   // 线很细 → 提高 gamma 让细线更实
});
console.log('【2/3】裁切居中');
cropPad(OUT + '/_k.png', OUT + '/whale-girl.png', 1024, 1536, 0.045);
console.log('【3/3】深底预览');
const p = compositeOn(OUT + '/whale-girl.png', OUT + '/../_on-dark.png', { r: 10, g: 10, b: 10 });
const f = decodePNG(OUT + '/whale-girl.png');
console.log(`  ${f.W}x${f.H} colorType=${f.colorType} 覆盖率=${p.coverage} 体积=${(statSync(OUT+'/whale-girl.png').size/1024).toFixed(0)}KB`);

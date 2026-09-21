import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, unlinkSync, statSync } from 'node:fs';
import { resolve, dirname, basename } from 'node:path';

/* 整页截图：先把 .reveal 强制点亮，绕开 headless 下合成器过渡不推进的假象
   用法: node tools/shot-site.mjs site/index.html out.png [宽度] [高度] [--raw]
   加 --raw 则不注入强制点亮样式（用于对照真实动画行为） */

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';

const FORCE = `<style id="__force__">
.reveal{opacity:1!important;transform:none!important;transition:none!important}
.sheet .draw,.flowline{animation:none!important;stroke-dashoffset:0!important}
</style>`;

const args = process.argv.slice(2);
const raw = args.includes('--raw');
const positional = args.filter((a) => !a.startsWith('--'));
const src = positional[0];
const out = positional[1];
const W = Number(positional[2] || 1440);
const H = Number(positional[3] || 6000);

const abs = resolve(src);
const dir = dirname(abs);
const tmp = dir + '/_shot_tmp.html';
let html = readFileSync(abs, 'utf-8');
if (!raw) html = html.replace('</head>', FORCE + '</head>');
writeFileSync(tmp, html);

const url = 'file:///' + tmp.replace(/\\/g, '/');
const outAbs = resolve(out);

try {
  execFileSync(CHROME, [
    '--headless=new', '--disable-gpu', '--hide-scrollbars', '--no-sandbox',
    `--window-size=${W},${H}`,
    '--virtual-time-budget=12000',
    `--screenshot=${outAbs}`,
    url,
  ], { stdio: ['ignore', 'ignore', 'ignore'], timeout: 120000 });
} catch (e) {
  console.log('chrome 退出异常: ' + e.message);
}

try { unlinkSync(tmp); } catch (_) {}

try {
  const st = statSync(outAbs);
  console.log(`${raw ? '[raw]' : '[force]'} ${basename(abs)} @ ${W}x${H} → ${outAbs}  ${st.size} B`);
} catch (_) {
  console.log(`❌ 截图未生成: ${outAbs}`);
}

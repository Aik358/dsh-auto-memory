import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';

/* Playwright 驱动系统 Chrome 打开一个 URL，收集控制台/页面错误 + WebGL 能力 + 分阶段截图
   用法: node tools/pw-probe.mjs <url> <outPrefix> [宽] [高] */

const [url, prefix = 'artifacts/_pw', W = '1920', H = '1080'] = process.argv.slice(2);
if (!url) { console.error('用法: node tools/pw-probe.mjs <url> <outPrefix> [宽] [高]'); process.exit(2); }

const outDir = resolve(dirname(prefix === 'artifacts/_pw' ? 'artifacts/_pw' : `${prefix}.png`));
mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch({
  channel: 'chrome',
  headless: true,
  args: [
    '--enable-unsafe-swiftshader',
    '--use-gl=angle',
    '--use-angle=swiftshader',
    '--ignore-gpu-blocklist',
    '--enable-gpu-rasterization',
    '--no-sandbox',
    '--disable-dev-shm-usage',
  ],
});

const page = await browser.newPage({ viewport: { width: Number(W), height: Number(H) }, deviceScaleFactor: 1 });

const logs = [];
page.on('console', (m) => logs.push(`[${m.type()}] ${m.text().slice(0, 300)}`));
page.on('pageerror', (e) => logs.push(`[pageerror] ${String(e.message).slice(0, 300)}`));
page.on('requestfailed', (r) => logs.push(`[reqfail] ${r.url().slice(0, 160)} :: ${r.failure()?.errorText}`));
page.on('response', (r) => { if (r.status() >= 400) logs.push(`[http ${r.status()}] ${r.url().slice(0, 160)}`); });

await page.goto(url, { waitUntil: 'load', timeout: 90000 });

// WebGL 能力探测
const gl = await page.evaluate(() => {
  const c = document.createElement('canvas');
  const out = {};
  for (const t of ['webgl2', 'webgl', 'experimental-webgl']) {
    try {
      const g = c.getContext(t);
      out[t] = g ? {
        vendor: g.getParameter(g.VENDOR),
        renderer: g.getParameter(g.RENDERER),
        version: g.getParameter(g.VERSION),
        maxTex: g.getParameter(g.MAX_TEXTURE_SIZE),
      } : null;
    } catch (e) { out[t] = 'throw: ' + e.message; }
  }
  return out;
});

const shots = [1500, 3500, 6500, 11000, 16000];
let prev = 0;
for (const t of shots) {
  await page.waitForTimeout(t - prev);
  prev = t;
  const f = `${prefix}-${t}ms.png`;
  await page.screenshot({ path: f });
  const txt = await page.evaluate(() => (document.body.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 260));
  console.log(`--- ${t}ms  ${f}\n    ${txt}`);
}

console.log('\n════ WebGL 能力 ════');
console.log(JSON.stringify(gl, null, 1));
console.log('\n════ 控制台/网络（去重，最多 40 条）════');
const uniq = [...new Set(logs)];
uniq.slice(0, 40).forEach((l) => console.log('  ' + l));
console.log(`  … 共 ${logs.length} 条，去重后 ${uniq.length} 条`);

await browser.close();

import { execFileSync } from 'node:child_process';
import { mkdirSync, statSync } from 'node:fs';
import { resolve, dirname } from 'node:path';

/* 截一个 URL（支持 WebGL：走 SwiftShader 而不是 --disable-gpu）
   用法: node tools/shot-url.mjs <url> <out.png> [宽] [高] [等待ms] */

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';

const [url, out, W = '1920', H = '1080', wait = '9000'] = process.argv.slice(2);
if (!url || !out) { console.error('用法: node tools/shot-url.mjs <url> <out.png> [宽] [高] [等待ms]'); process.exit(2); }

const outAbs = resolve(out);
mkdirSync(dirname(outAbs), { recursive: true });

const profile = resolve(dirname(outAbs), '_chrome-profile-url');

try {
  execFileSync(CHROME, [
    '--headless=new',
    '--enable-unsafe-swiftshader',            // 软件 WebGL
    '--use-gl=angle', '--use-angle=swiftshader',
    '--hide-scrollbars', '--no-sandbox', '--no-first-run', '--disable-dev-shm-usage',
    `--user-data-dir=${profile}`,
    `--window-size=${W},${H}`,
    `--virtual-time-budget=${wait}`,
    `--screenshot=${outAbs}`,
    url,
  ], { stdio: ['ignore', 'ignore', 'pipe'], timeout: 180000 });
} catch (e) {
  const msg = (e.stderr || '').toString().split('\n').filter((l) => /error|fail|not/i.test(l)).slice(0, 6).join(' | ');
  console.log('chrome 退出异常: ' + e.message + (msg ? ' :: ' + msg : ''));
}

try {
  console.log(`${url} → ${outAbs}  ${statSync(outAbs).size} B`);
} catch (_) {
  console.log(`❌ 截图未生成: ${outAbs}`);
}

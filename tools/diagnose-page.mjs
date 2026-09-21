import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const URL = process.argv[2] || 'http://127.0.0.1:8791/hero';

/* 用 CDP 拿真实渲染后的 DOM + 布局 —— 比 --dump-dom 可靠 */
try {
  const dom = execFileSync(CHROME, [
    '--headless=new', '--disable-gpu', '--virtual-time-budget=8000',
    '--dump-dom', URL,
  ], { encoding: 'utf-8', maxBuffer: 1 << 26, stdio: ['ignore', 'pipe', 'ignore'] });
  writeFileSync('artifacts/_dom.html', dom);

  const count = (re) => (dom.match(re) || []).length;
  console.log('════ 渲染后 DOM 清点 ════');
  console.log(`  <a>            ${count(/<a[\s>]/g)}   其中 href="#": ${count(/href="#"/g)}`);
  console.log(`  <button>       ${count(/<button/g)}`);
  console.log(`  <input>        ${count(/<input/g)}`);
  console.log(`  <section>      ${count(/<section/g)}`);
  console.log(`  <canvas>       ${count(/<canvas/g)}`);
  console.log(`  is-shown 出现  ${count(/is-shown/g)}   ← 0 表示文案永远 opacity:0`);
  console.log(`  <img>          ${count(/<img/g)}`);

  // 有哪些 id / 主要块
  const ids = [...dom.matchAll(/id="([^"]+)"/g)].map(m => m[1]);
  console.log(`\n  id 列表: ${ids.join(', ') || '(无)'}`);

  // 文字内容长度（去标签）
  const text = dom.replace(/<script[\s\S]*?<\/script>/g, '').replace(/<style[\s\S]*?<\/style>/g, '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  console.log(`\n  可见文字 ${text.length} 字符`);
  console.log(`  开头 160 字: ${text.slice(0, 160)}`);
} catch (e) {
  console.log('❌ dump-dom 失败:', e.message);
}

import { execFileSync } from 'node:child_process';
import { writeFileSync, readFileSync, unlinkSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';

/* 链接完整性：把每个本地 href 变成真实文件路径，检查目标是否存在
   用法: node tools/check-links.mjs site/index.html */

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';

function collect(file) {
  const abs = resolve(file);
  const tmp = dirname(abs) + '/_link_tmp.html';
  const probe = `<script>setTimeout(function(){
    var out=[...document.querySelectorAll('a[href]')].map(function(a){return a.getAttribute('href');});
    var p=document.createElement('pre');p.id='__L__';
    p.textContent='L'+'_START'+JSON.stringify(out)+'L'+'_END';
    document.body.appendChild(p);},900);</script>`;
  writeFileSync(tmp, readFileSync(abs, 'utf-8').replace('</body>', probe + '</body>'));
  let dom = '';
  try {
    dom = execFileSync(CHROME, ['--headless=new', '--disable-gpu', '--no-sandbox', '--virtual-time-budget=4000',
      '--dump-dom', 'file:///' + tmp.replace(/\\/g, '/')], { encoding: 'utf-8', maxBuffer: 1 << 26, stdio: ['ignore', 'pipe', 'ignore'] });
  } catch { /* ignore */ }
  try { unlinkSync(tmp); } catch { /* ignore */ }
  const m = dom.match(/<pre id="__L__">([\s\S]*?)<\/pre>/);
  if (!m) return null;
  return JSON.parse(m[1].replace(/^L_START/, '').replace(/L_END$/, '').trim()
    .replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>'));
}

const file = process.argv[2] || 'site/index.html';
const baseDir = dirname(resolve(file));
const hrefs = collect(file);
if (!hrefs) { console.log('❌ 探针未执行'); process.exit(1); }

let bad = 0, ext = 0, ok = 0;
for (const raw of hrefs) {
  if (/^(https?:|mailto:|tel:)/i.test(raw)) { ext++; continue; }
  if (raw.startsWith('#')) { ok++; continue; }               // 页内锚点由 check-home 负责
  const [pathPart] = raw.split('#');
  const target = resolve(baseDir, pathPart);
  // 目录链接 → 找 index.html
  const candidates = [target, resolve(target, 'index.html')];
  if (candidates.some((c) => existsSync(c))) { ok++; }
  else { bad++; console.log(`❌ ${raw}  →  期望 ${candidates[1]}`); }
}
console.log(`\n本地链接 ${ok} 个可达 · 外链 ${ext} 个 · 断链 ${bad} 个`);
process.exit(bad ? 1 : 0);

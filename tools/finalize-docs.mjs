import { readFileSync, writeFileSync, existsSync } from 'node:fs';

/* 1) 校验新文档里引用的本地路径是否都存在
   2) 把仓库文档统一为 CRLF（铁律：除 lib/memory-envelope-pre.js 为 LF 外，仓库文档一律 CRLF）
   用法: node tools/finalize-docs.mjs [--check-only] */

const DOCS = ['docs/WHITEPAPER.md', 'docs/FRONTEND-CO-CREATION.md', 'docs/HOMEPAGE-CONTENT-FOR-GM53.md'];
const checkOnly = process.argv.includes('--check-only');

console.log('── 引用路径校验 ──');
/* 两类引用：
   ① 真相对路径（含 `/`）⇒ 必须存在
   ② 正文简写裸文件名（如 `index.js`）⇒ 在已知目录里找得到即可，找不到只提示不判错 */
const SEARCH_DIRS = ['', 'docs/', 'docs/internal/', 'lib/', 'tools/', 'site/', 'site/assets/', 'python/'];
let refs = 0, bad = 0, soft = 0;
for (const f of DOCS) {
  if (!existsSync(f)) { console.log(`❌ 缺失文档 ${f}`); bad++; continue; }
  const s = readFileSync(f, 'utf8');
  const seen = new Set();
  for (const m of s.matchAll(/`([A-Za-z0-9_.\-/]+\.(?:md|mjs|js|html|css|png|json))`/g)) {
    const p = m[1];
    if (seen.has(p)) continue;
    seen.add(p);
    refs++;
    if (p.includes('/')) {
      if (!existsSync(p)) { console.log(`  ❌ ${f} → ${p}（相对路径不存在）`); bad++; }
    } else {
      const hit = SEARCH_DIRS.some((d) => existsSync(d + p));
      if (!hit && !existsSync(p)) { console.log(`  ⚠️  ${f} → ${p}（裸名，未在常见目录找到）`); soft++; }
    }
  }
}
console.log(`  相对路径引用 ${refs} 个（去重），硬缺失 ${bad} 个，裸名存疑 ${soft} 个`);

console.log('\n── 行尾规范化（CRLF） ──');
for (const f of DOCS) {
  if (!existsSync(f)) continue;
  let s = readFileSync(f, 'utf8');
  const beforeLfOnly = (s.match(/(?<!\r)\n/g) || []).length;
  if (!checkOnly && beforeLfOnly > 0) {
    s = s.replace(/\r\n/g, '\n').replace(/\n/g, '\r\n');
    writeFileSync(f, s);
  }
  const after = readFileSync(f, 'utf8');
  const crlf = (after.match(/\r\n/g) || []).length;
  const lfOnly = (after.match(/(?<!\r)\n/g) || []).length;
  const bom = after.charCodeAt(0) === 0xfeff;
  const flag = lfOnly === 0 && !bom ? '✅' : '❌';
  console.log(`${flag} ${f.padEnd(42)} CRLF=${crlf} LFonly=${lfOnly} BOM=${bom ? 'YES' : 'no'}`);
  if (lfOnly > 0 || bom) bad++;
}

console.log(bad ? `\n${bad} 项待修` : '\n全部通过');
process.exit(bad ? 1 : 0);

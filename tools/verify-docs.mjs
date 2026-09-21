import { readFileSync, existsSync } from 'node:fs';

/* 交叉核验：新产出的四份文档里出现的数字性断言 vs 代码实际值
   用法: node tools/verify-docs.mjs */

const idx = readFileSync('lib/index.js', 'utf8');
let fail = 0;
const ok = (cond, label, got, want) => {
  console.log(`${cond ? '✅' : '❌'} ${label}  实测=${got}${cond ? '' : ` 文档声称=${want}`}`);
  if (!cond) fail++;
};

// ── 代码侧真值 ──
const dc = idx.match(/DEFAULT_CONFIG\s*=\s*\{/);
let i = idx.indexOf('{', dc.index), d = 0; const start = i;
for (; i < idx.length; i++) { const c = idx[i]; if (c === '{') d++; else if (c === '}') { d--; if (!d) break; } }
const body = idx.slice(start + 1, i);
const keys = [...body.matchAll(/^\s{2}([A-Za-z_$][\w$]*)\s*:/gm)].map((x) => x[1]);
const getKey = (k) => { const m = body.match(new RegExp(`^\\s{2}${k}\\s*:\\s*([^,\\n]+)`, 'm')); return m ? m[1].trim() : null; };

const tools = new Set();
for (const m of idx.matchAll(/defineTool\(\s*[{,]?\s*(?:name:\s*)?['"`]([a-z0-9_]+)['"`]/g)) tools.add(m[1]);
for (const m of idx.matchAll(/defineTool\(([\s\S]{0,160}?)\)/g)) {
  const n = m[1].match(/name:\s*['"`]([a-z0-9_]+)['"`]/); if (n) tools.add(n[1]);
}
const routes = new Set();
for (const m of idx.matchAll(/['"`](\/[a-z0-9][a-z0-9/_-]*)['"`]/g)) {
  if (/^\/(api|memory|recall|state|list|file|config|note|handoff|external|calendar|storage|review|semantic|python|rules|kanban|debug|notices|update|greet|summarize|reflect|workspaces|smart|shadow|scan|memory-hub)/.test(m[1])) routes.add(m[1]);
}

console.log('── 代码侧真值 ──');
console.log(`工具 ${tools.size} · 路由 ${routes.size} · 配置键 ${keys.length}`);
console.log(`handoffEnabled=${getKey('handoffEnabled')} · autoContinueEnabled=${getKey('autoContinueEnabled')} · boardMode=${getKey('boardMode')}`);
console.log(`tier0MaxTokens=${getKey('tier0MaxTokens')} · injectBudgetChars=${getKey('injectBudgetChars')}`);
console.log(`hubMechanicalProcedureFeedEnabled=${getKey('hubMechanicalProcedureFeedEnabled')}\n`);

// ── 文档断言 ──
const docs = {
  whitepaper: 'docs/WHITEPAPER.md',
  cocreation: 'docs/FRONTEND-CO-CREATION.md',
  gm53: 'docs/HOMEPAGE-CONTENT-FOR-GM53.md',
  readme: 'README.md',
  readmeZh: 'README.zh-CN.md',
};
for (const [k, p] of Object.entries(docs)) {
  if (!existsSync(p)) { console.log(`❌ 文档不存在: ${p}`); fail++; }
  else console.log(`✅ 存在 ${p}  (${readFileSync(p, 'utf8').length} B)  [${k}]`);
}

const wp = readFileSync('docs/WHITEPAPER.md', 'utf8');
const gm = readFileSync('docs/HOMEPAGE-CONTENT-FOR-GM53.md', 'utf8');
const cc = readFileSync('docs/FRONTEND-CO-CREATION.md', 'utf8');
const rm = readFileSync('README.md', 'utf8');
const rmz = readFileSync('README.zh-CN.md', 'utf8');

console.log('\n── 关键数字断言 ──');
ok(wp.includes('| 模型工具 | **17** |') || wp.includes('**17**'), '白皮书 工具数 17', tools.size, 17);
ok(/HTTP 路由 \| \*\*49\*\*/.test(wp), '白皮书 路由数 49', routes.size, 49);
ok(/设置键 \| \*\*98\*\*/.test(wp), '白皮书 配置键 98', keys.length, 98);
ok(wp.includes('`true`（开）') && /handoffEnabled/.test(wp), '白皮书 白板默认=开', getKey('handoffEnabled'), 'true');
ok(wp.includes('`false`（关）') && /autoContinueEnabled/.test(wp), '白皮书 自动接续默认=关', getKey('autoContinueEnabled'), 'false');
ok(/`hubMechanicalProcedureFeedEnabled`\s*\|\s*\*\*`false`/.test(wp), '白皮书 机械切片默认=关', getKey('hubMechanicalProcedureFeedEnabled'), 'false');
ok(/各 \*\*24000\*\*/.test(wp), '白皮书 容量 24000', 'DEFAULT_NOTE_CAPACITY_CHARS=24000', 24000);

ok(gm.includes('563 MB'), 'GM53 Python 档 563MB', '563MB', '563MB');
ok(!gm.includes('380+ MB'), 'GM53 无 380+MB 笔误', '—', '—');
ok(gm.includes('400 token 预算'), 'GM53 Tier-0 = 400 token', getKey('tier0MaxTokens'), 400);
ok(gm.includes('17 个模型工具') && gm.includes('49 条 HTTP 路由') && gm.includes('98 个配置键'),
  'GM53 规模数字一致', `${tools.size}/${routes.size}/${keys.length}`, '17/49/98');
ok(/12 页签/.test(cc) && /98 个配置键/.test(cc), '共创 12 页签 + 98 键', '—', '—');

console.log('\n── README 修正断言 ──');
ok(/Twelve tabs/.test(rm), 'README.md 十二页签', 'Twelve tabs', 'Twelve tabs');
ok(!/Ten tabs/.test(rm), 'README.md 无 Ten tabs 残留', '—', '—');
ok(/十二个页签/.test(rmz), 'README.zh-CN.md 十二页签', '十二个页签', '十二个页签');
ok(!/十个页签/.test(rmz), 'README.zh-CN.md 无十个页签残留', '—', '—');
ok(rm.includes('docs/WHITEPAPER.md') && rmz.includes('docs/WHITEPAPER.md'), '两份 README 挂了白皮书链接', '—', '—');
ok(rm.includes('docs/FRONTEND-CO-CREATION.md') && rmz.includes('docs/FRONTEND-CO-CREATION.md'), '两份 README 挂了共创链接', '—', '—');

console.log(fail ? `\n${fail} 项不一致` : '\n全部一致');
process.exit(fail ? 1 : 0);

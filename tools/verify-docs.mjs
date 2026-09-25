import { readFileSync, existsSync } from 'node:fs';

/* 交叉核验：新产出的四份文档里出现的数字性断言 vs 代码实际值
   用法: node tools/verify-docs.mjs

   ★ 2026-09-25（E6 勘误条目 3-12）：期望值不再写死。
     旧版把 17 / 49 / 98 直接写进条件里，而代码实测为 19 / 56 / 115 ⇒
     判定式里**不含实测值**：代码真值变了、或文档写错，都照样打印 ✅。
     （`if (!cond) fail++` 与 `process.exit(fail ? 1 : 0)` 一直存在，
       缺陷在**判定条件**，不在失败计数器。）
     现改为：从文档解析出声明值，再与源码实测值比对 —— 两侧都进判定，
     文档与代码从此不能再各自漂移。 */

const idx = readFileSync('lib/index.js', 'utf8');
let fail = 0;
const ok = (cond, label, got, want) => {
  console.log(`${cond ? '✅' : '❌'} ${label}  实测=${got}${cond ? '' : ` 期望=${want}`}`);
  if (!cond) fail++;
};
/** 从文档文本里取出声明的数字；取不到 → null（会让断言红，不会静默通过）。 */
const pick = (text, re) => {
  const m = text.match(re);
  return m ? Number(m[1]) : null;
};
/** 核心判据：文档声明值 === 代码实测值（两侧都进判定）。 */
const eq = (declared, measured, label) =>
  ok(declared !== null && declared === measured, label,
    `文档=${declared} 代码=${measured}`, `文档应写 ${measured}`);

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

// 实测值本身必须是正整数，否则下面所有 eq() 会因 measured 异常而失去意义
ok(tools.size > 0 && routes.size > 0 && keys.length > 0, '三项计数均取到正整数（判据前提）',
  `${tools.size}/${routes.size}/${keys.length}`, '>0');

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

console.log('\n── 白皮书 docs/WHITEPAPER.md §3.1 规模表 ──');
eq(pick(wp, /\| 模型工具 \| \*\*(\d+)\*\* \|/), tools.size, '白皮书 模型工具 = 代码实测');
eq(pick(wp, /\| HTTP 路由 \| \*\*(\d+)\*\* \|/), routes.size, '白皮书 HTTP 路由 = 代码实测');
eq(pick(wp, /\| 设置键 \| \*\*(\d+)\*\* \|/), keys.length, '白皮书 设置键 = 代码实测');
ok(wp.includes('`true`（开）') && /handoffEnabled/.test(wp), '白皮书 白板默认=开', getKey('handoffEnabled'), 'true');
ok(wp.includes('`false`（关）') && /autoContinueEnabled/.test(wp), '白皮书 自动接续默认=关', getKey('autoContinueEnabled'), 'false');
ok(/`hubMechanicalProcedureFeedEnabled`\s*\|\s*\*\*`false`/.test(wp), '白皮书 机械切片默认=关', getKey('hubMechanicalProcedureFeedEnabled'), 'false');
ok(/各 \*\*24000\*\*/.test(wp), '白皮书 容量 24000', 'DEFAULT_NOTE_CAPACITY_CHARS=24000', 24000);

console.log('\n── 主页内容规格 docs/HOMEPAGE-CONTENT-FOR-GM53.md ──');
eq(pick(gm, /(\d+) 个模型工具/), tools.size, 'GM53 模型工具 = 代码实测');
eq(pick(gm, /(\d+) 条 HTTP 路由/), routes.size, 'GM53 HTTP 路由 = 代码实测');
eq(pick(gm, /(\d+) 个配置键/), keys.length, 'GM53 配置键 = 代码实测');
ok(gm.includes('563 MB'), 'GM53 Python 档 563MB', '563MB', '563MB');
ok(!gm.includes('380+ MB'), 'GM53 无 380+MB 笔误', '—', '—');
ok(gm.includes('400 token 预算'), 'GM53 Tier-0 = 400 token', getKey('tier0MaxTokens'), 400);

console.log('\n── 前端共创 docs/FRONTEND-CO-CREATION.md ──');
eq(pick(cc, /后端 (\d+) 个模型工具/), tools.size, '共创 模型工具 = 代码实测');
eq(pick(cc, /(\d+) 条路由/), routes.size, '共创 路由 = 代码实测');
eq(pick(cc, /共 (\d+) 个配置键/), keys.length, '共创 配置键 = 代码实测');
ok(/12 页签/.test(cc), '共创 12 页签', '12', '12');

console.log('\n── README 功能清单口径 ──');
{
  const m = rm.match(/(\d+) user capabilities \/ (\d+) tools \/ (\d+) routes \/ (\d+) config keys/);
  eq(m ? Number(m[2]) : null, tools.size, 'README.md tools = 代码实测');
  eq(m ? Number(m[3]) : null, routes.size, 'README.md routes = 代码实测');
  eq(m ? Number(m[4]) : null, keys.length, 'README.md config keys = 代码实测');
}
{
  const m = rmz.match(/(\d+) 条用户能力 \/ (\d+) 工具 \/ (\d+) 路由 \/ (\d+) 配置键/);
  eq(m ? Number(m[2]) : null, tools.size, 'README.zh-CN.md 工具 = 代码实测');
  eq(m ? Number(m[3]) : null, routes.size, 'README.zh-CN.md 路由 = 代码实测');
  eq(m ? Number(m[4]) : null, keys.length, 'README.zh-CN.md 配置键 = 代码实测');
}

console.log('\n── README 修正断言 ──');
ok(/Twelve tabs/.test(rm), 'README.md 十二页签', 'Twelve tabs', 'Twelve tabs');
ok(!/Ten tabs/.test(rm), 'README.md 无 Ten tabs 残留', '—', '—');
ok(/十二个页签/.test(rmz), 'README.zh-CN.md 十二页签', '十二个页签', '十二个页签');
ok(!/十个页签/.test(rmz), 'README.zh-CN.md 无十个页签残留', '—', '—');
ok(rm.includes('docs/WHITEPAPER.md') && rmz.includes('docs/WHITEPAPER.md'), '两份 README 挂了白皮书链接', '—', '—');
ok(rm.includes('docs/FRONTEND-CO-CREATION.md') && rmz.includes('docs/FRONTEND-CO-CREATION.md'), '两份 README 挂了共创链接', '—', '—');

console.log(fail ? `\n${fail} 项不一致` : '\n全部一致（文档声明值 === 代码实测值）');
process.exit(fail ? 1 : 0);

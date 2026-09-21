import { readFileSync } from 'node:fs';

/* 自核 ZCode 上报的三组数字：模型工具 / HTTP 路由 / 设置键
   用法: node tools/verify-facts.mjs */

const idx = readFileSync('lib/index.js', 'utf8');
const client = readFileSync('lib/client.js', 'utf8');

// ── 1 模型工具：defineTool({ name: '...' }) 或 defineTool('name', ...)
const names = new Set();
for (const m of idx.matchAll(/defineTool\(\s*[{,]?\s*(?:name:\s*)?['"`]([a-z0-9_]+)['"`]/g)) names.add(m[1]);
// 兜底：defineTool( 之后 120 字符内找 name:
for (const m of idx.matchAll(/defineTool\(([\s\S]{0,160}?)\)/g)) {
  const n = m[1].match(/name:\s*['"`]([a-z0-9_]+)['"`]/);
  if (n) names.add(n[1]);
}
console.log(`① 模型工具：${names.size} 个`);
console.log('   ' + [...names].sort().join('\n   '));

// ── 2 HTTP 路由：插件 loopback API 的注册点
const routes = new Set();
for (const m of idx.matchAll(/['"`](\/[a-z0-9][a-z0-9/_-]*)['"`]/g)) {
  const p = m[1];
  if (/^\/(api|memory|recall|state|list|file|config|note|handoff|external|calendar|storage|review|semantic|python|rules|kanban|debug|notices|update|greet|summarize|reflect|workspaces|smart|shadow|scan|memory-hub)/.test(p)) routes.add(p);
}
console.log(`\n② 路由候选（按前缀筛）：${routes.size} 个路径字面量`);

// ── 3 设置键
const dc = idx.match(/DEFAULT_CONFIG\s*=\s*\{/);
let keys = [];
if (dc) {
  let i = idx.indexOf('{', dc.index), d = 0; const start = i;
  for (; i < idx.length; i++) { const c = idx[i]; if (c === '{') d++; else if (c === '}') { d--; if (!d) break; } }
  keys = [...idx.slice(start + 1, i).matchAll(/^\s{2}([A-Za-z_$][\w$]*)\s*:/gm)].map((x) => x[1]);
}
console.log(`\n③ 设置键：${keys.length} 个`);

// ── 4 client.js 六处插槽
const slots = [...client.matchAll(/register(Tab|Panel|Section|View|Action|Overlay)?\s*\(\s*\{?[\s\S]{0,80}?slot:\s*['"`]([^'"`]+)['"`]/g)].map((m) => m[2]);
console.log(`\n④ client.js 插槽引用：${new Set(slots).size} 处  ${[...new Set(slots)].join(', ')}`);

// ── 5 面板页签
const tabs = [...client.matchAll(/id:\s*['"`](overview|logs|refine|hub|storage|notes|plan|reflections|connect|calendar|search|workspaces)['"`]/g)].map((m) => m[1]);
console.log(`\n⑤ 面板页签：${new Set(tabs).size} 个  ${[...new Set(tabs)].join(', ')}`);

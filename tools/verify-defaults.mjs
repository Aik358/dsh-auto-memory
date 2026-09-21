import { readFileSync } from 'node:fs';

/* 核 ZCode 上报的「5 个老键默认值被翻转」
   用法: node tools/verify-defaults.mjs */

const idx = readFileSync('lib/index.js', 'utf8');
const dc = idx.match(/DEFAULT_CONFIG\s*=\s*\{/);
let i = idx.indexOf('{', dc.index), d = 0; const start = i;
for (; i < idx.length; i++) { const c = idx[i]; if (c === '{') d++; else if (c === '}') { d--; if (!d) break; } }
const body = idx.slice(start + 1, i);

const want = ['injectBudgetChars', 'handoffEnabled', 'autoContinueEnabled',
  'noteCapacityChars', 'userCapacityChars', 'boardMode', 'autoConsolidate',
  'tier0CatalogEnabled', 'associativeMemoryEnabled', 'hubMechanicalProcedureFeedEnabled',
  'memoryHubEnabled', 'unattendedMode', 'handoffPlanChars', 'handoffLedgerChars'];

console.log('键'.padEnd(34) + '默认值');
console.log('─'.repeat(50));
for (const k of want) {
  const m = body.match(new RegExp(`^\\s{2}${k}\\s*:\\s*([^,\\n]+)`, 'm'));
  console.log(k.padEnd(34) + (m ? m[1].trim() : '（未找到）'));
}

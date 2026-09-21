import { readFileSync } from 'node:fs';

/* 核对白皮书/README 里关于「实验特性默认值」的说法是否属实
   用法: node tools/verify-experimental.mjs */

const idx = readFileSync('lib/index.js', 'utf8');

const keys = ['handoffEnabled', 'waterLevelWindowTokens', 'waterLevelThreshold',
  'waterLevelAdvisory', 'waterLevelAutoHandoff', 'handoffPlanChars', 'handoffLedgerChars',
  'autoContinueEnabled', 'snapshotTieredInject', 'boardMode'];

for (const k of keys) {
  const m = idx.match(new RegExp(`^\\s{2}${k}\\s*:\\s*([^,\\n]+)`, 'm'));
  console.log(k.padEnd(28) + (m ? m[1].trim() : '（未找到）'));
}

// 容量常量
console.log('\n── 容量常量 ──');
for (const c of ['DEFAULT_NOTE_CAPACITY_CHARS', 'DEFAULT_USER_CAPACITY_CHARS', 'DEGRADE_RING']) {
  const m = idx.match(new RegExp(`(?:const|let|var)\\s+${c}\\s*=\\s*([^;\\n]+)`));
  console.log(c.padEnd(28) + (m ? m[1].trim() : '（不在 index.js）'));
}

// 45 天的注入相关默认
console.log('\n── 注入节奏 ──');
for (const k of ['injectEnabled', 'recentDaysInjected', 'snapshotMinGapRounds', 'tier0MaxTokens', 'tier0BudgetShare']) {
  const m = idx.match(new RegExp(`^\\s{2}${k}\\s*:\\s*([^,\\n]+)`, 'm'));
  console.log(k.padEnd(28) + (m ? m[1].trim() : '（未找到）'));
}

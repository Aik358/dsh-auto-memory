#!/usr/bin/env node
/**
 * guard-tracked-imports.mjs —— 静态 import 目标必须在 git 树里（2026-10-31）。
 *
 * 【为什么需要】
 *   v3.4.0-alpha.1 发布后，社区实测 clone 下来直接 ERR_MODULE_NOT_FOUND：
 *   lib/index.js 静态 import 了 ./subagent-prompt-guard.js 与 ./hub-message-filter.js，
 *   而这两个文件只存在于作者本地工作区、从未 git add。
 *   本地一切正常（文件在盘上），线上却完全无法加载 —— 典型「本地绿、clone 红」。
 *
 * 【判据】
 *   逐个解析 lib/ 下所有 .js 的静态 import/export from './x.js'，
 *   要求目标既存在于工作区，又存在于 git 索引（git ls-files）。
 *   任一缺失 → exit 1。
 *
 * 用法：node tools/guard-tracked-imports.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const ROOT = path.resolve(import.meta.dirname, '..');
const LIB = path.join(ROOT, 'lib');

const tracked = new Set(
  execFileSync('git', ['ls-files', 'lib'], { cwd: ROOT, encoding: 'utf8' })
    .split('\n').map(s => s.trim()).filter(Boolean)
);

const files = fs.readdirSync(LIB).filter(f => /\.js$/.test(f) && !/\.bak/.test(f));
const problems = [];

for (const f of files) {
  const p = path.join(LIB, f);
  const code = fs.readFileSync(p, 'utf8');
  const re = /^\s*(?:import|export)\s+(?:[^'"]*?\s+from\s+)?['"](\.\/[^'"]+)['"]/gm;
  let m;
  while ((m = re.exec(code)) !== null) {
    const rel = m[1];
    const target = path.posix.normalize(path.posix.join('lib', rel));
    const onDisk = fs.existsSync(path.join(ROOT, target));
    const inGit = tracked.has(target);
    if (!onDisk) problems.push(f + ' → ' + rel + '  [工作区不存在]');
    else if (!inGit) problems.push(f + ' → ' + rel + '  [存在但未 git add]');
  }
}

if (problems.length) {
  console.error('[guard-tracked-imports] FAIL —— ' + problems.length + ' 处 import 目标不可用：');
  for (const x of problems) console.error('  ✗ ' + x);
  console.error('\nclone 后这些文件会 ERR_MODULE_NOT_FOUND。请 git add 后重试。');
  process.exit(1);
}
console.log('[guard-tracked-imports] PASS —— ' + files.length + ' 个 lib 文件，import 目标全部已入库');

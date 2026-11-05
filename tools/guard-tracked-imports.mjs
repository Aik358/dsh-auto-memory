#!/usr/bin/env node
/**
 * guard-tracked-imports.mjs —— 静态 import 目标必须在 git 树里（2026-10-31 建；2026-11-04 扩面）。
 *
 * 【为什么需要】
 *   v3.4.0-alpha.1 发布后，社区实测 clone 下来直接 ERR_MODULE_NOT_FOUND：
 *   lib/index.js 静态 import 了 ./subagent-prompt-guard.js 与 ./hub-message-filter.js，
 *   而这两个文件只存在于作者本地工作区、从未 git add。
 *   本地一切正常（文件在盘上），线上却完全无法加载 —— 典型「本地绿、clone 红」。
 *
 * 【2026-11-04 扩面（#540 同族根因）】
 *   上一版只扫 lib/*.js，于是 tools/ 下的断链长期无人发现：
 *     tools/subagent-gc.mjs  → ../lib/subagent-gc-pre.js（模块早已改名，CLI 从来跑不起来）
 *     tools/migrate-m3b4.mjs → ../lib/memory-anchor-pre.js / ../lib/memory-writer-pre.js（同上）
 *   两者都是「工具在、目标不在」，静态看毫无征兆，只有真执行才撞 ERR_MODULE_NOT_FOUND。
 *   ⇒ 扫描面扩到 [lib, tools]，并纳入 .mjs；相对 specifier 按**导入方所在目录**解析
 *     （tools/ 下的工具 import '../lib/x.js'，不能继续假设前缀恒为 lib/）。
 *
 * 【判据】
 *   逐个解析 lib/ 与 tools/ 下所有 .js / .mjs 的静态 import/export from '<相对路径>'，
 *   要求目标既存在于工作区，又存在于 git 索引（git ls-files）。
 *   任一缺失 → exit 1。路径大小写按**精确**比对：Windows 本地能解析、Linux clone 会挂的
 *   大小写漂移，同样算不可用（这正是本守卫要防的那类「本地绿」）。
 *
 * 【跳过（可见，不静默）】
 *   - `_` 前缀的目录/文件：本仓既有约定 `_` = 脚手架 / 夹具 / 历史证据，不是在用代码
 *     （run-smoke 的 listSuites 同样按 `_` 前缀排除非套件；tools/_redproof/ 是历史红证存档）。
 *   - `.bak*` 备份副本、`node_modules`、`.` 前缀目录。
 *   跳过条数会打印出来，便于审计「扫了多少、跳了多少」。
 *
 * 用法：node tools/guard-tracked-imports.mjs
 */
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'

const ROOT = path.resolve(import.meta.dirname, '..')
const DIRS = ['lib', 'tools']
const EXT = /\.(?:js|mjs)$/
const skipName = (n) => n.startsWith('_') || n.startsWith('.') || n === 'node_modules' || /\.bak/.test(n)

const tracked = new Set(
  execFileSync('git', ['ls-files', ...DIRS], { cwd: ROOT, encoding: 'utf8' })
    .split('\n').map(s => s.trim()).filter(Boolean)
)

const relOf = (p) => path.relative(ROOT, p).replace(/\\/g, '/')
const files = []
const skipped = []
function walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name)
    if (skipName(e.name)) { skipped.push(relOf(p)); continue }
    if (e.isDirectory()) walk(p)
    else if (EXT.test(e.name)) files.push(p)
  }
}
for (const d of DIRS) walk(path.join(ROOT, d))

const re = /^\s*(?:import|export)\s+(?:[^'"]*?\s+from\s+)?['"]((?:\.{1,2}\/)[^'"]+)['"]/gm
const problems = []

for (const p of files) {
  const rel = relOf(p)
  const code = fs.readFileSync(p, 'utf8')
  let m
  re.lastIndex = 0
  while ((m = re.exec(code)) !== null) {
    const target = path.posix.normalize(path.posix.join(path.posix.dirname(rel), m[1]))
    if (target.startsWith('../') || target === '..') {
      problems.push(rel + ' → ' + m[1] + '  [越出仓库根]')
      continue
    }
    const onDisk = fs.existsSync(path.join(ROOT, target))
    const inGit = tracked.has(target)
    if (!onDisk) problems.push(rel + ' → ' + m[1] + '  [工作区不存在]')
    else if (!inGit) problems.push(rel + ' → ' + m[1] + '  [存在但未 git add]')
  }
}

const byDir = DIRS.map((d) => d + '=' + files.filter((f) => relOf(f).startsWith(d + '/')).length).join(' ')
const skipNote = skipped.length ? '（跳过 ' + skipped.length + ' 个 `_`/备份/隐藏条目）' : ''

if (problems.length) {
  console.error('[guard-tracked-imports] FAIL —— ' + problems.length + ' 处 import 目标不可用：');
  for (const x of problems) console.error('  ✗ ' + x)
  console.error('\n' + 'clone 后这些文件会 ERR_MODULE_NOT_FOUND。请 git add 或改正 specifier 后重试。')
  console.error('[guard-tracked-imports] 扫描面 ' + DIRS.join('+') + '（含 .mjs）：' + files.length + ' 个文件（' + byDir + '）' + skipNote)
  process.exit(1)
}
console.log('[guard-tracked-imports] PASS —— ' + files.length + ' 个文件（' + byDir + '）' + skipNote + '，import 目标全部已入库')

#!/usr/bin/env node
/**
 * tools/pre-regression-gate.mjs —— **回归前置判定器（返回 yes/no 给 Agent，不问用户）**
 *
 * ★用户 2026-10-26 裁定（逐字）：
 *   「我说的这个"yes or no"不是来问用户的。比如你调用这个 function，它会先返回一个
 *     "yes or no"给 Agent，让 Agent 自己评判：是现在应该直接复，还是需要定什么基线锁，
 *     然后判断相应的小模块里的回归是否正确等完成之后，就再进行总的回归」
 *
 * ⇒ 本工具**只做判定、只输出结论**，不交互、不阻塞、不替 Agent 做决定。
 *   Agent 拿到 verdict 后自己决定下一步。
 *
 * 用法：
 *   node tools/pre-regression-gate.mjs                # JSON 输出（给 Agent 读）
 *   node tools/pre-regression-gate.mjs --human        # 人类可读
 *   node tools/pre-regression-gate.mjs --changed <f1,f2,...>   # 显式声明改动文件
 *   node tools/pre-regression-gate.mjs --since <git-ref>       # 用 git diff 判定改动面
 *
 * 退出码：0 = READY（可直接跑全量）；2 = NOT-READY（须先处理 blockers）；1 = 工具自身错误
 *
 * 判定逻辑（四条并行检查）：
 *   B1 基线锁：仓库里是否有哈希/计数锁与当前源码不一致（锁红 ⇒ 全量必假红）
 *   B2 生成区：client.js 内联块与 ESM 源是否一致（不一致 ⇒ 前端套件必红）
 *   B3 相关模块：本次改动文件对应的**小模块套件**是否已跑绿
 *   B4 语法：改动文件是否都过 node --check
 *
 * 输出 verdict:
 *   "READY"     —— 可以跑全量
 *   "NOT-READY" —— 必须先做 blockers 里的事，做完重跑本门
 *   "CAUTION"   —— 可跑，但有风险项（如改动面大，建议先分块）
 */
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { execSync } from 'node:child_process'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const args = process.argv.slice(2)
const HUMAN = args.includes('--human')
const argOf = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : null }

// ── 0. 判定改动面 ─────────────────────────────────────────────
function changedFiles() {
  const explicit = argOf('--changed')
  if (explicit) return explicit.split(',').map((s) => s.trim()).filter(Boolean)
  const since = argOf('--since')
  const range = since ? since + '..HEAD' : null
  try {
    const cmd = range
      ? 'git -c core.quotepath=false diff --name-only ' + range
      : 'git -c core.quotepath=false status --porcelain=v1'
    const out = execSync(cmd, { cwd: ROOT, encoding: 'utf8' })
    if (range) return out.split('\n').map((s) => s.trim()).filter(Boolean)
    // status --porcelain: " M path" / "?? path"
    return out.split('\n').map((l) => l.slice(3).trim()).filter(Boolean)
  } catch (e) {
    return []
  }
}

const NOISE_RE = /^(artifacts[\/]|undefined[\\/]|%SystemDrive%[\/]|node_modules[\/]|\\.ci-log)/
const changed = changedFiles().filter((f) => !NOISE_RE.test(f))
const libChanged = changed.filter((f) => /^lib\//.test(f))
const testChanged = changed.filter((f) => /^tests\//.test(f))
const toolChanged = changed.filter((f) => /^tools\//.test(f))

const blockers = []
const cautions = []
const notes = []

// ── B1: 基线锁扫描 ────────────────────────────────────────────
// 仓库有 74 个用例带哈希/计数锁。这里只查**能自动判定**的：16 位大写 sha 常量。
function physicalOf(rel) {
  const p = path.join(ROOT, rel)
  if (!fs.existsSync(p)) return null
  const raw = fs.readFileSync(p)
  const nc = raw.toString('utf8').replace(/\r\n/g, '\n')
  return {
    bytes: fs.statSync(p).size,
    nc: nc.length,
    sha: crypto.createHash('sha256').update(nc).digest('hex').slice(0, 16).toUpperCase(),
  }
}

const watched = [
  'lib/index.js', 'lib/client.js', 'lib/ev4-adapter.js', 'lib/ev4-prototype-blocks.js',
  'lib/ev4-blocks.generated.js', 'lib/event-store.js', 'lib/rules-layer.js', 'lib/user-portrait.js',
]
const physical = {}
for (const f of watched) { const v = physicalOf(f); if (v) physical[f] = v }

// B1a: 16 位哈希锁
const smokeDir = path.join(ROOT, 'tests/smoke')
let suiteFiles = []
try { suiteFiles = fs.readdirSync(smokeDir).filter((f) => f.endsWith('.mjs')) } catch (e) {}
const knownShas = new Map()
for (const [f, v] of Object.entries(physical)) knownShas.set(v.sha, f)

const staleHashLocks = []
for (const f of suiteFiles) {
  let s = ''
  try { s = fs.readFileSync(path.join(smokeDir, f), 'utf8') } catch (e) { continue }
  const hits = [...new Set([...s.matchAll(/['"]([0-9A-F]{16})['"]/g)].map((m) => m[1]))]
  for (const h of hits) {
    if (knownShas.has(h)) continue
    // 白名单：明显不是本仓源码 sha 的（如常量表、fixture）—— 只报与 lib 相关的文件
    staleHashLocks.push({ suite: f, lock: h })
  }
}
if (staleHashLocks.length) {
  blockers.push({
    code: 'STALE_HASH_LOCK',
    count: staleHashLocks.length,
    detail: staleHashLocks.slice(0, 8),
    action: '先重定这些哈希锁（判据过期则改常量；真缺陷则改代码），再跑全量',
  })
}

// B1b: r26 计数锁（index.js 归一化字符数）
{
  const p = path.join(smokeDir, 'smoke-test-r26-cross-layer.mjs')
  if (fs.existsSync(p) && physical['lib/index.js']) {
    const s = fs.readFileSync(p, 'utf8')
    const m = s.match(/const R\d+_CHARS\s*=\s*(\d+)/)
    if (m && Number(m[1]) !== physical['lib/index.js'].nc) {
      blockers.push({
        code: 'STALE_CHAR_LOCK',
        detail: { suite: 'smoke-test-r26-cross-layer.mjs', locked: Number(m[1]), actual: physical['lib/index.js'].nc },
        action: 'r26 计数锁过期：按 2026-10-01 裁定先归因（真缺陷 / 判据过期），再重钉',
      })
    }
  }
}

// ── B2: 生成区一致性 ─────────────────────────────────────────
{
  const gen = path.join(ROOT, 'tools/gen-ev4-blocks.mjs')
  if (fs.existsSync(gen)) {
    try {
      execSync('node ' + JSON.stringify(gen) + ' --check', { cwd: ROOT, stdio: 'pipe', timeout: 120000 })
    } catch (e) {
      blockers.push({
        code: 'GENERATED_STALE',
        detail: 'client.js 内联块与 ESM 源不一致',
        action: '跑 node tools/gen-ev4-blocks.mjs 同步生成区，再跑 gen --check 确认',
      })
    }
  }
  const skin = path.join(ROOT, 'tools/build-iter5-skin.mjs')
  if (fs.existsSync(skin)) {
    try {
      execSync('node ' + JSON.stringify(skin) + ' --check --strict', { cwd: ROOT, stdio: 'pipe', timeout: 120000 })
    } catch (e) {
      blockers.push({
        code: 'SKIN_STALE',
        detail: 'iter5 皮肤产物与源不一致',
        action: '跑 node tools/build-iter5-skin.mjs 重新生成',
      })
    }
  }
}

// ── B3: 改动文件 → 相关小模块套件映射 ────────────────────────
// 只做**保守**映射：宁多勿漏。Agent 拿到后自己决定跑哪些。
const MODULE_SUITES = {
  'lib/index.js': ['r26-cross-layer', 'v4-h3-b-rules-groups', 'v4-h5-user-portrait', 't0-3-budget-ledger'],
  'lib/client.js': ['client-loadable', 'p3-fullpage-gate', 'v4-ev4-gen-blocks', 'v4-e1-ev4-css'],
  'lib/ev4-adapter.js': ['v4-ev4-gen-blocks', 'wb-time-and-drawer'],
  'lib/ev4-prototype-blocks.js': ['v4-ev4-gen-blocks', 'v4-ev4-free-vars', 'v4-e1-ev4-css', 'wb-time-and-drawer'],
  'lib/ev4-blocks.generated.js': ['v4-ev4-gen-blocks', 'v4-ev4-marker-guard'],
  'lib/event-store.js': ['wb-time-and-drawer', 'v4-h3-b-rules-groups'],
  'lib/rules-layer.js': ['v4-h3-b-rules-groups', 'rules-budget-portrait-dedup'],
  'lib/user-portrait.js': ['v4-h5-user-portrait', 'rules-budget-portrait-dedup'],
}
const needed = new Set()
for (const f of libChanged) for (const s of (MODULE_SUITES[f] || [])) needed.add(s)
if (libChanged.length && !needed.size) {
  cautions.push({ code: 'UNMAPPED_LIB_CHANGE', detail: libChanged, action: '有 lib 改动未映射到小模块套件，建议人工挑相关套件先跑' })
}
const neededExisting = [...needed].filter((s) => fs.existsSync(path.join(smokeDir, 'smoke-test-' + s + '.mjs')))
const neededMissing = [...needed].filter((s) => !neededExisting.includes(s))
if (neededMissing.length) {
  cautions.push({ code: 'SUITE_MISSING', detail: neededMissing, action: '映射到的小模块套件不存在，检查映射表' })
}
if (neededExisting.length) {
  notes.push({
    code: 'RUN_MODULE_SUITES_FIRST',
    suites: neededExisting.map((s) => 'tests/smoke/smoke-test-' + s + '.mjs'),
    command: 'node tests/smoke/smoke-test-' + neededExisting.join('.mjs && node tests/smoke/smoke-test-') + '.mjs',
    hint: '先跑这些小模块套件；全绿再进全量。它们红了说明还没准备好，跑全量只会浪费一轮。',
  })
}

// ── B4: 语法 ─────────────────────────────────────────────────
const syntaxBad = []
for (const f of [...libChanged, ...testChanged, ...toolChanged]) {
  if (!/\.(mjs|js|cjs)$/.test(f)) continue
  const p = path.join(ROOT, f)
  if (!fs.existsSync(p)) continue
  try { execSync('node --check ' + JSON.stringify(p), { cwd: ROOT, stdio: 'pipe', timeout: 60000 }) }
  catch (e) { syntaxBad.push(f) }
}
if (syntaxBad.length) {
  blockers.push({ code: 'SYNTAX_ERROR', detail: syntaxBad, action: '先修语法错误（node --check）' })
}

// ── 体量提示（不是阻塞）──────────────────────────────────────
if (libChanged.length >= 4) {
  cautions.push({
    code: 'WIDE_BLAST_RADIUS',
    detail: { libChanged: libChanged.length, files: libChanged },
    action: '改动面 ≥4 个 lib 文件，建议先把上面列的小模块套件全跑绿再进全量',
  })
}

// ── 汇总 ─────────────────────────────────────────────────────
const verdict = blockers.length ? 'NOT-READY' : (cautions.length ? 'CAUTION' : 'READY')
const out = {
  verdict,
  ts: new Date().toISOString(),
  changed: { total: changed.length, lib: libChanged, tests: testChanged, tools: toolChanged },
  blockers,
  cautions,
  notes,
  physical,
  fullRegression: {
    // 口径固定写死在这里，避免每次靠记忆
    command: 'node tools/run-smoke.mjs --timeout=180000',
    jobs: '不加 --jobs（默认 jobs=4 + heavy=8 双车道）',
    expectedDurationSec: [163, 200],
    warning: '--jobs=8 会绕过双车道机制导致资源竞争假红，禁止使用',
  },
  nextStep: verdict === 'READY'
    ? '可直接跑 fullRegression.command'
    : verdict === 'NOT-READY'
      ? '先处理 blockers（按 action 逐条做），做完重跑本门，直到 verdict=READY'
      : '可跑，但建议先跑 notes 里的小模块套件；全绿后再进全量',
}

if (HUMAN) {
  const L = []
  L.push('=== 回归前置判定 ===')
  L.push('verdict: ' + verdict)
  L.push('改动面: ' + changed.length + ' 个文件（lib ' + libChanged.length + ' / tests ' + testChanged.length + ' / tools ' + toolChanged.length + '）')
  if (blockers.length) {
    L.push('')
    L.push('❌ blockers（必须先处理）:')
    for (const b of blockers) L.push('  · [' + b.code + '] ' + (typeof b.detail === 'string' ? b.detail : JSON.stringify(b.detail)) + '  ⇒ ' + b.action)
  }
  if (cautions.length) {
    L.push('')
    L.push('⚠️ cautions:')
    for (const c of cautions) L.push('  · [' + c.code + '] ' + (typeof c.detail === 'string' ? c.detail : JSON.stringify(c.detail)) + '  ⇒ ' + c.action)
  }
  if (notes.length) {
    L.push('')
    L.push('📋 建议先跑的小模块:')
    for (const n of notes) n.suites.forEach((s) => L.push('  · ' + s))
  }
  L.push('')
  L.push('➡️  nextStep: ' + out.nextStep)
  console.log(L.join('\n'))
} else {
  console.log(JSON.stringify(out, null, 2))
}

process.exit(verdict === 'NOT-READY' ? 2 : 0)

#!/usr/bin/env node
/** probe (read-only). */
import { registerHooks } from 'node:module'
import path from 'node:path'
import { pathToFileURL, fileURLToPath } from 'node:url'
import { performance } from 'node:perf_hooks'
import { readdirSync, statSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'

const ROOT = process.env.PROBE_ROOT ? path.resolve(process.env.PROBE_ROOT) : path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const TARGET = pathToFileURL(path.join(ROOT, 'lib/index.js')).href

registerHooks({
  load(url, context, nextLoad) {
    const r = nextLoad(url, context)
    if (url === TARGET) {
      return { format: 'module', source: String(r.source) + '\nexport { MemoryEngine as __ProbeEngine }\n', shortCircuit: true }
    }
    return r
  },
})

const mod = await import(TARGET)
const MemoryEngine = mod.__ProbeEngine
const { recallPassagesPre } = await import(pathToFileURL(path.join(ROOT, 'lib/recall-passages.js')).href)

const now = () => performance.now()
const ms = (t) => Math.round((now() - t) * 100) / 100
const med = (a) => { const s = [...a].sort((x, y) => x - y); const n = s.length; return n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2 }
const stat = (a) => ({ n: a.length, min: +Math.min(...a).toFixed(2), median: +med(a).toFixed(2), max: +Math.max(...a).toFixed(2), all: a.map((x) => +x.toFixed(2)) })
const sha = (s) => createHash('sha256').update(String(s)).digest('hex').slice(0, 16)
async function timed(fn) { const t = now(); try { const value = await fn(); return { ms: ms(t), value, ok: true } } catch (e) { return { ms: ms(t), error: (e && e.message) || String(e), code: e && e.code, ok: false } } }

const report = { generatedAt: new Date().toISOString(), node: process.version, tree: ROOT, indexSha: createHash('sha256').update(await readFile(path.join(ROOT, 'lib/index.js'))).digest('hex'), sections: {} }
// ---------- 0. environment ----------
const engine = new MemoryEngine()
engine.configLoaded = false
await engine.loadConfig()
engine.configLoaded = true
const p = await engine.resolvePaths(undefined)
const AGENT = { session: { id: 'probe-recall-avail', header: { cwd: p.ws } } }

{
  let files = 0, bytes = 0
  const root = path.join(process.env.DSH_HOME || path.join(process.env.USERPROFILE || '', '.dsh'), 'sessions')
  const walk = (dir, depth) => {
    if (depth > 4) return
    let ents = []
    try { ents = readdirSync(dir, { withFileTypes: true }) } catch { return }
    for (const e of ents) {
      const f = path.join(dir, e.name)
      if (e.isDirectory()) { walk(f, depth + 1); continue }
      if (!/\.jsonl(\.zstd)?$/i.test(e.name)) continue
      files++
      try { bytes += statSync(f).size } catch {}
    }
  }
  walk(root, 0)
  report.sections.env = {
    ws: p.ws, projectDir: p.projectDir, userFile: p.userFile,
    sessionFiles: files, sessionMiB: +(bytes / 1048576).toFixed(1),
    config: { boardMode: engine.config.boardMode, handoffEnabled: engine.config.handoffEnabled, externalSources: Object.keys(engine.config.externalSources || {}).length },
  }
}

const QUERY = 'recall timeout memory retrieval'
const TERMS = QUERY.toLowerCase().split(/[\s,;:]+/).filter(Boolean)
const CJK_QUERY = 'recall 超时 记忆 检索'
const CJK_TERMS = CJK_QUERY.toLowerCase().split(/[\s,，、;；。:：]+/).filter(Boolean)

// ---------- 1. arms ----------
report.sections.arms = {}

{
  const runs = [], counts = []
  for (let i = 0; i < 3; i++) { const r = await timed(() => engine.discoverWorkspaces()); runs.push(r.ms); if (r.ok) counts.push(r.value.length) }
  report.sections.arms.discoverWorkspaces = Object.assign(stat(runs), { workspaces: counts[0] === undefined ? null : counts[0] })
}
{
  const runs = [], sizes = []
  for (let i = 0; i < 3; i++) { const r = await timed(() => engine.searchHandoffCorpus(CJK_TERMS, 8, p)); runs.push(r.ms); if (r.ok) sizes.push(r.value.length) }
  report.sections.arms.searchHandoffCorpus = Object.assign(stat(runs), { hits: sizes[0] === undefined ? null : sizes[0] })
}
{
  const runs = [], sizes = []
  for (let i = 0; i < 3; i++) { const r = await timed(() => engine.external.search(CJK_QUERY, 6)); runs.push(r.ms); if (r.ok) sizes.push(r.value.length) }
  report.sections.arms.externalSearch = Object.assign(stat(runs), { hits: sizes[0] === undefined ? null : sizes[0] })
}
{
  const runs = [], lens = []
  for (let i = 0; i < 3; i++) { const r = await timed(() => engine.lexicalSessionScanFallback('recall', 8, 'probe')); runs.push(r.ms); if (r.ok) lens.push(r.value.length) }
  report.sections.arms.lexicalSessionScanFallback = Object.assign(stat(runs), { outChars: lens[0] === undefined ? null : lens[0] })
}{
  const cases = {}
  engine._sessionQuery = undefined
  { const a = []; for (let i = 0; i < 3; i++) { const r = await timed(() => engine.searchSessionHistory(QUERY, 8)); a.push(r.ms) } cases.capabilityAbsent = stat(a) }
  const boom = () => Object.assign(new Error('session-search persistence observation failed'), { code: 'SESSION_QUERY_PERSISTENCE_FAILED' })
  engine._sessionQuery = { searchSessions: async () => { throw boom() } }
  { const a = []; for (let i = 0; i < 3; i++) { const r = await timed(() => engine.searchSessionHistory(QUERY, 8)); a.push(r.ms) } cases.hostThrows_fastStub = stat(a) }
  const delayed = []
  for (const delayMs of [500, 2000]) {
    engine._sessionQuery = { searchSessions: async () => { await new Promise((r) => setTimeout(r, delayMs)); throw boom() } }
    const r = await timed(() => engine.recall(QUERY, 8, AGENT, 'sessions', { format: 'l0' }))
    delayed.push({ stubDelayMs: delayMs, totalMs: +r.ms.toFixed(2), ok: r.ok, fellBack: r.ok ? /宿主会话检索抛错|兜底口径/.test(String(r.value)) : null })
  }
  cases.delayedStubNoDeadline = delayed
  engine._sessionQuery = undefined
  report.sections.arms.searchSessionHistory = cases
}
{
  const runCross = async () => {
    const cwds = await engine.discoverWorkspaces()
    const out = []
    for (const cwd of cwds) {
      if (out.length >= 8) break
      if (cwd === p.ws) continue
      const p2 = engine.projectDirOf(cwd)
      if (p2 === p.projectDir) continue
      const logs2 = await engine.listDailyLogs(p2, 15)
      for (const log of logs2) {
        if (out.length >= 8) break
        const t = await readFile(path.join(p2, log.name), 'utf8').catch(() => '')
        if (!t) continue
        try { const m = recallPassagesPre(t, CJK_TERMS, path.join(p2, log.name), false); if (m.length) out.push(m[0]) } catch {}
      }
      const nt = await readFile(path.join(p2, 'MEMORY.md'), 'utf8').catch(() => '')
      if (nt) { try { const m = recallPassagesPre(nt, CJK_TERMS, path.join(p2, 'MEMORY.md'), false); if (m.length) out.push(m[0]) } catch {} }
    }
    return out
  }
  const runs = [], lens = []
  for (let i = 0; i < 2; i++) { const r = await timed(runCross); runs.push(r.ms); if (r.ok) lens.push(r.value.length) }
  report.sections.arms.crossWorkspaceArm = Object.assign(stat(runs), { workspaces: (await engine.discoverWorkspaces()).length, hits: lens[0] === undefined ? null : lens[0] })
}
{
  const all = [], cur = [], allFull = [], curFull = []
  engine._sessionQuery = undefined
  const realExt = engine.external.search.bind(engine.external)
  engine.external.search = async () => []
  for (let i = 0; i < 2; i++) {
    all.push((await timed(() => engine.recall(CJK_QUERY, 8, AGENT, 'all', { format: 'l0' }))).ms)
    cur.push((await timed(() => engine.recall(CJK_QUERY, 8, AGENT, 'current', { format: 'l0' }))).ms)
    allFull.push((await timed(() => engine.recall(CJK_QUERY, 8, AGENT, 'all', { format: 'full' }))).ms)
    curFull.push((await timed(() => engine.recall(CJK_QUERY, 8, AGENT, 'current', { format: 'full' }))).ms)
  }
  engine.external.search = realExt
  report.sections.arms.recallDiff = {
    all_l0: stat(all), current_l0: stat(cur), delta_l0: +(med(all) - med(cur)).toFixed(2),
    all_full: stat(allFull), current_full: stat(curFull), delta_full: +(med(allFull) - med(curFull)).toFixed(2),
  }
}
{
  const e2 = new MemoryEngine(); e2.configLoaded = false; await e2.loadConfig(); e2.configLoaded = true
  e2._sessionQuery = undefined
  const cold = await timed(() => e2.recall(CJK_QUERY, 8, AGENT, 'current', { format: 'l0' }))
  const warm = await timed(() => e2.recall(CJK_QUERY, 8, AGENT, 'current', { format: 'l0' }))
  report.sections.arms.coldVsWarm = { coldMs: +cold.ms.toFixed(2), warmMs: +warm.ms.toFixed(2), coldOverheadMs: +(cold.ms - warm.ms).toFixed(2) }
}

// ---------- 2. timing matrix (in-process) ----------
{
  const boom = () => Object.assign(new Error('session-search persistence observation failed'), { code: 'SESSION_QUERY_PERSISTENCE_FAILED' })
  const matrix = {}
  for (const scope of ['all', 'current', 'handoff', 'archive', 'sessions']) {
    matrix[scope] = {}
    for (const format of ['l0', 'full']) {
      const runs = [], lens = []
      engine._sessionQuery = { searchSessions: async () => { throw boom() } }
      for (let i = 0; i < 2; i++) {
        const r = await timed(() => engine.recall(CJK_QUERY, 8, AGENT, scope, { format }))
        runs.push(r.ms); if (r.ok) lens.push(String(r.value).length)
      }
      matrix[scope][format] = Object.assign(stat(runs), { outChars: lens[0] === undefined ? null : lens[0] })
    }
  }
  engine._sessionQuery = undefined
  report.sections.matrixInProcess = matrix
}
// ---------- 3. failure surface ----------
{
  const boom = () => Object.assign(new Error('session-search persistence observation failed'), { code: 'SESSION_QUERY_PERSISTENCE_FAILED' })
  engine._sessionQuery = { searchSessions: async () => { throw boom() } }
  const R = async (q, limit, scope, opts) => {
    const r = await timed(() => engine.recall(q, limit, AGENT, scope, opts))
    const v = r.ok ? String(r.value) : ''
    return {
      ms: +r.ms.toFixed(2), ok: r.ok, threw: r.ok ? null : r.error, code: r.code || null,
      outChars: v.length, head: v.slice(0, 110).replace(/\n/g, ' '),
      flags: {
        hostThrow: /宿主会话检索抛错/.test(v),
        fallback: /兜底口径/.test(v),
        windowNote: /本地检索范围受限/.test(v),
        incomplete: /检索不完整/.test(v),
        emptyVerdict: /未找到相关记忆/.test(v),
      },
    }
  }
  const cases = {}
  cases.expand_badId = await R('x', 8, 'all', { format: 'l0', expand: 'mem_nothex' })
  cases.expand_wellformedMissing = await R('x', 8, 'all', { format: 'l0', expand: 'mem_' + '0'.repeat(32) })
  cases.emptyQuery = await R('', 8, 'all', { format: 'l0' })
  cases.whitespaceQuery = await R('   \n\t ', 8, 'all', { format: 'l0' })
  cases.punctOnly = await R('，。；：、', 8, 'all', { format: 'l0' })
  cases.longQuery_5000ascii = await R('a'.repeat(5000), 8, 'all', { format: 'l0' })
  cases.longQuery_5000cjk = await R('记忆'.repeat(2500), 8, 'all', { format: 'l0' })
  cases.longQuery_2000words = await R(Array.from({ length: 2000 }, (_, i) => 'w' + i).join(' '), 8, 'all', { format: 'l0' })
  cases.regexMetaOnly = await R('.*', 8, 'all', { format: 'l0' })
  cases.limit1000_l0 = await R('recall', 1000, 'all', { format: 'l0' })
  cases.limit1000_full = await R('recall', 1000, 'all', { format: 'full' })
  cases.limitString = await R('recall', '1000', 'all', { format: 'l0' })
  cases.limitZero = await R('recall', 0, 'all', { format: 'l0' })
  cases.limitNegative = await R('recall', -5, 'all', { format: 'l0' })
  cases.limitNaN = await R('recall', Number.NaN, 'all', { format: 'l0' })
  cases.chineseMultiWord = await R('记忆 检索 插件 白板 账本', 8, 'all', { format: 'l0' })
  cases.scopeInvalid = await R('recall', 8, 'bogus', { format: 'l0' })
  cases.scopeInvalidFull = await R('recall', 8, 'bogus', { format: 'full' })
  cases.scopeNull = await R('recall', 8, null, { format: 'l0' })
  const burst = []
  for (let i = 0; i < 5; i++) {
    const r = await timed(() => engine.recall('recall', 8, AGENT, 'all', { format: 'l0' }))
    burst.push({ ms: +r.ms.toFixed(2), outChars: r.ok ? String(r.value).length : 0, digest: r.ok ? sha(r.value) : null })
  }
  cases.burst5 = { runs: burst.map((x) => x.ms), distinctDigests: [...new Set(burst.map((x) => x.digest))], distinctSizes: [...new Set(burst.map((x) => x.outChars))] }
  report.sections.failures = cases
  engine._sessionQuery = undefined
}

// ---------- 4. degradation visibility ----------
{
  const boom = () => Object.assign(new Error('session-search persistence observation failed'), { code: 'SESSION_QUERY_PERSISTENCE_FAILED' })
  engine._sessionQuery = { searchSessions: async () => { throw boom() } }
  const before = engine._degradeSink ? engine._degradeSink.snapshot() : null
  const outSessions = String(await engine.recall('recall', 8, AGENT, 'sessions', { format: 'l0' }))
  const outAll = String(await engine.recall('recall', 8, AGENT, 'all', { format: 'l0' }))
  const after = engine._degradeSink ? engine._degradeSink.snapshot() : null
  report.sections.degradationVisibility = {
    sinkAttached: !!engine._degradeSink,
    countsBefore: before ? before.counts : null,
    countsAfter: after ? after.counts : null,
    recentAfter: after ? (after.recent || []).slice(-2) : null,
    sessionsMentionsHostThrow: /宿主会话检索抛错/.test(outSessions),
    allMentionsHostThrow: /宿主会话检索抛错/.test(outAll),
    allHasDiagnosticSection: /历史 DSH 会话检索说明/.test(outAll),
  }
  engine._sessionQuery = undefined
}

console.log('===PROBE_JSON_BEGIN===')
console.log(JSON.stringify(report, null, 2))
console.log('===PROBE_JSON_END===')
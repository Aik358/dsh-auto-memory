import * as fs from 'node:fs/promises'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { apply, MemoryEngine } from '../lib/audit-engine.mjs'
import { LedgerDocSystem } from '../../lib/ledger-doc/system.js'

// R4 P5: (a) the maintenance-document read-only projection must be VISIBLE on the real
// /debug payload and must never carry document text; (b) the shipped prompts must describe
// the target maintenance-document semantics AND keep the legacy path explicit while
// ledgerDocEnabled=false, without inviting a fabricated documentId.
const root = path.resolve('artifacts', '_r4-p5-20261112', 'fixtures', 'history-probe')
await fs.rm(root, { recursive: true, force: true })
const home = path.join(root, 'dsh-home')
const workspace = path.join(root, 'workspace')
const memoryRoot = path.join(home, 'memory', 'workspaces')
const userMemoryDir = path.join(home, 'memory')
await fs.mkdir(memoryRoot, { recursive: true })
await fs.mkdir(userMemoryDir, { recursive: true })
await fs.mkdir(workspace, { recursive: true })

let pass = 0
let fail = 0
const failures = []
const evidence = []
async function test(name, action) {
  try { const detail = await action(); pass++; console.log('  ok   - ' + name + (detail ? ' :: ' + detail : '')) }
  catch (error) { fail++; failures.push({ name, error: error.message }); console.log('  FAIL - ' + name + ' :: ' + error.stack) }
}

const prevHome = process.env.DSH_HOME
const prevSetTimeout = globalThis.setTimeout
const prevSetInterval = globalThis.setInterval
const prevFetch = globalThis.fetch
const prevLoad = MemoryEngine.prototype.loadConfigSync
const baselineListeners = new Map(['uncaughtException', 'unhandledRejection', 'exit'].map((k) => [k, new Set(process.listeners(k))]))
process.env.DSH_HOME = home
const tools = []
let engine = null
let cleanup = null
const agent = { session: { id: 'session-p5-probe', header: { cwd: workspace } } }
try {
  await fs.writeFile(path.join(home, 'dsh-auto-memory.json'), JSON.stringify({
    ledgerDocEnabled: false,
    handoffEnabled: true,
    criteriaGate: false,
    boardMode: 'legacy',
    memoryRoot,
    userMemoryDir,
    teamEnabled: false,
    globalBriefEnabled: false,
    externalSources: {},
  }))
  globalThis.setTimeout = globalThis.setInterval = () => ({ unref() {} })
  globalThis.fetch = async () => new Response('{}', { status: 503 })
  MemoryEngine.prototype.loadConfigSync = function (...args) { engine = this; return prevLoad.apply(this, args) }
  apply({
    get: (key) => (key === 'agents' ? { get: (id) => (id === agent.session.id ? agent : null) } : undefined),
    on: () => {},
    systemPrompt: { context: () => () => {}, section: () => () => {} },
    tools: { register: (t) => { tools.push(t); return () => {} } },
    webServer: { register: () => () => {} },
    effect: (f) => { try { cleanup = f() } catch (_) {} },
  }, {})
  for (const [kind, before] of baselineListeners) {
    for (const listener of process.listeners(kind)) if (!before.has(listener)) process.removeListener(kind, listener)
  }
  globalThis.setTimeout = prevSetTimeout
  globalThis.setInterval = prevSetInterval
} catch (error) { console.log('  FAIL - apply() threw :: ' + error.stack); fail++ }

console.log('=== P5-3 read-only maintenance-document projection on the real /debug payload ===')
let debug = null
await test('P5H-01 engine.debugInfo() really runs and returns the ledgerDoc projection', async () => {
  debug = await engine.debugInfo()
  if (!debug || typeof debug !== 'object') throw new Error('debugInfo returned ' + typeof debug)
  if (!Object.prototype.hasOwnProperty.call(debug, 'ledgerDoc')) throw new Error('ledgerDoc key missing; keys=' + Object.keys(debug).length)
  const d = debug.ledgerDoc
  if (!d || d.available !== true) throw new Error('ledgerDoc.available=' + JSON.stringify(d))
  evidence.push({ kind: 'debug-projection', ledgerDoc: d })
  return JSON.stringify(d)
})
await test('P5H-02 projection is aggregate/boolean/revision only: no document text, no paths, no event bodies', async () => {
  const d = debug.ledgerDoc
  const allowed = new Set(['available', 'enabled', 'cachedSystems', 'historyEntryPoint', 'historyEntryPointKind', 'hostRoute', 'lastCommittedRevision', 'lastCommittedDocumentId'])
  const keys = Object.keys(d)
  const extra = keys.filter((k) => !allowed.has(k))
  if (extra.length) throw new Error('unexpected keys: ' + JSON.stringify(extra))
  for (const k of keys) {
    const v = d[k]
    if (v === null) continue
    if (typeof v === 'string' && v.length > 200) throw new Error(k + ' looks like body text (' + v.length + ' chars)')
  }
  const blob = JSON.stringify(d)
  for (const banned of ['## 任务状态', '## 目标', 'handoff/documents', 'C:\\Users']) {
    if (blob.includes(banned)) throw new Error('projection leaks: ' + banned)
  }
  evidence.push({ kind: 'projection-shape', keys })
  return 'keys=' + keys.length
})
await test('P5H-03 enabled=false is reflected honestly and history entry point is declared as facade', async () => {
  const d = debug.ledgerDoc
  if (d.enabled !== false) throw new Error('enabled should be false, got ' + JSON.stringify(d.enabled))
  if (d.historyEntryPointKind !== 'facade') throw new Error('historyEntryPointKind=' + d.historyEntryPointKind)
  if (d.hostRoute !== null) throw new Error('hostRoute must be null until a route exists, got ' + JSON.stringify(d.hostRoute))
  if (d.lastCommittedRevision !== null) throw new Error('no committed document expected, got ' + JSON.stringify(d.lastCommittedRevision))
  return 'enabled=false hostRoute=null revision=null'
})
await test('P5H-04 facade queryHistory is reachable in-process and really answers from a synthetic store', async () => {
  const sysRoot = path.join(root, 'facade')
  const handoffDir = path.join(sysRoot, 'handoff')
  const docsDir = path.join(handoffDir, 'documents')
  await fs.mkdir(docsDir, { recursive: true })
  await fs.mkdir(path.join(sysRoot, 'logs'), { recursive: true })
  await fs.mkdir(path.join(sysRoot, 'archive'), { recursive: true })
  const eventId = 'evt_a1b2c3d4'
  const now = Date.now()
  await fs.writeFile(path.join(handoffDir, 'event-store.json'), JSON.stringify({ events: [{ id: eventId, status: 'active', name: 'P5 probe event', checkpoints: [{ at: now, kind: 'progress', text: 'synthetic' }] }] }))
  const system = new LedgerDocSystem({ rootDir: sysRoot, enabled: true, readOnly: true })
  const started = await system.start()
  if (!started.ok) throw new Error('start failed: ' + JSON.stringify(started))
  const from = new Date(now - 86400000).toISOString().slice(0, 10)
  const to = new Date(now + 86400000).toISOString().slice(0, 10)
  const result = await system.queryHistory({ from, to, timeZone: 'UTC' })
  if (!result || result.ok !== true) throw new Error('queryHistory failed: ' + JSON.stringify(result).slice(0, 300))
  if (!Array.isArray(result.items) || result.items.length < 1) throw new Error('no items; got ' + JSON.stringify(result).slice(0, 300))
  const hasBody = JSON.stringify(result.items).length > 4000
  if (hasBody) throw new Error('history payload unexpectedly large: ' + JSON.stringify(result.items).length)
  evidence.push({ kind: 'facade-history', total: result.total, count: result.count, sources: (result.coveredSources || []).length })
  return 'total=' + result.total
})

console.log('')
console.log('=== P5-3b real queryHistory observation (Lead review item 1) ===')
await test('P5H-04b historyProbe reports a REAL query result, aggregates only', async () => {
  // 真实路径：先打开开关并在引擎自己的 projectDir 下种合成事件库，再走 ledgerDocSystemForPre 建缓存，
  // 然后 /debug 的 historyProbe 必须真的跑一次 queryHistory（不预造结果、不用替身）。
  engine.config.ledgerDocEnabled = true
  const projectDir = engine.projectDirOf((engine.state && engine.state.ws) || workspace)
  const handoffDir = path.join(projectDir, 'handoff')
  await fs.mkdir(path.join(handoffDir, 'documents'), { recursive: true })
  await fs.mkdir(path.join(projectDir, 'logs'), { recursive: true })
  await fs.mkdir(path.join(projectDir, 'archive'), { recursive: true })
  await fs.writeFile(path.join(handoffDir, 'event-store.json'), JSON.stringify({ events: [{ id: 'evt_a1b2c3d4', status: 'active', name: 'P5 probe event', checkpoints: [{ at: Date.now(), kind: 'progress', text: 'synthetic' }] }] }))
  const cachedSystem = engine.ledgerDocSystemForPre(handoffDir)
  if (!cachedSystem) throw new Error('engine.ledgerDocSystemForPre returned nothing')
  const fresh = await engine.debugInfo()
  const probe = fresh && fresh.historyProbe
  debug = fresh
  if (!probe || typeof probe !== 'object') throw new Error('historyProbe missing from /debug payload')
  if (probe.attempted !== true) throw new Error('probe did not attempt: ' + JSON.stringify(probe))
  if (probe.ok !== true) throw new Error('probe ok=false: ' + JSON.stringify(probe))
  if (!Number.isSafeInteger(probe.total) || probe.total < 1) throw new Error('total=' + JSON.stringify(probe.total))
  if (!Number.isSafeInteger(probe.count)) throw new Error('count=' + JSON.stringify(probe.count))
  if (!Number.isSafeInteger(probe.elapsedMs) || probe.elapsedMs < 0) throw new Error('elapsedMs=' + JSON.stringify(probe.elapsedMs))
  if (!['sha256', 'none'].includes(probe.revisionKind)) throw new Error('revisionKind=' + JSON.stringify(probe.revisionKind))
  if (probe.revisionKind === 'sha256' && !/^sha256:[0-9a-f]{64}$/.test(String(probe.latestRevision))) throw new Error('bad latestRevision')
  const blob = JSON.stringify(probe)
  for (const banned of ['evt_', 'documents/', 'synthetic', '## ']) {
    if (blob.includes(banned)) throw new Error('probe leaks: ' + banned)
  }
  evidence.push({ kind: 'history-probe', probe })
  return 'total=' + probe.total + ' count=' + probe.count + ' ms=' + probe.elapsedMs + ' rev=' + probe.revisionKind
})
await test('P5H-04c historyProbe is fail-closed when the facade is disabled', async () => {
  const saved = engine.config.ledgerDocEnabled
  engine.config.ledgerDocEnabled = false
  try {
    const probe = (await engine.debugInfo()).historyProbe
    if (probe.attempted !== false) throw new Error('expected attempted=false, got ' + JSON.stringify(probe))
    if (probe.reason !== 'disabled') throw new Error('expected reason=disabled, got ' + JSON.stringify(probe.reason))
  } finally { engine.config.ledgerDocEnabled = saved }
  return 'attempted=false reason=disabled'
})
await test('P5H-04d historyProbe does not create a new cached facade', async () => {
  const before = (await engine.debugInfo()).ledgerDoc.cachedSystems
  await engine.debugInfo()
  const after = (await engine.debugInfo()).ledgerDoc.cachedSystems
  if (after !== before) throw new Error('cachedSystems grew: ' + before + ' -> ' + after)
  return 'cachedSystems=' + after + ' stable'
})

console.log('')
console.log('=== P5-4 shipped prompt wording (legacy path stays explicit) ===')
const GUIDANCE = (await import('../../lib/index.js')).GUIDANCE
await test('P5H-05 GUIDANCE describes the maintenance-document target state', () => {
  if (!GUIDANCE.includes('维护文档')) throw new Error('GUIDANCE does not mention the maintenance document at all')
  if (!GUIDANCE.includes('handoff/documents/')) throw new Error('GUIDANCE does not name documents/<documentId>.md')
  return 'target-state wording present'
})
await test('P5H-06 GUIDANCE names the only executable path and the missing tool params', () => {
  if (!GUIDANCE.includes('两条路径，按是否给了 documentId 分流')) throw new Error('GUIDANCE lacks the two-path statement')
  if (!GUIDANCE.includes('append-only')) throw new Error('GUIDANCE dropped the append-only legacy semantics')
  if (!GUIDANCE.includes('没给 documentId')) throw new Error('GUIDANCE lacks the legacy-branch statement')
  return 'executable path + missing params stated'
})
await test('P5H-07 GUIDANCE forbids fabricating document-edit params', () => {
  if (!GUIDANCE.includes('不得凭猜测编造')) throw new Error('GUIDANCE lacks the anti-fabrication rule')
  return 'anti-fabrication rule present'
})
await test('P5H-08 memory_log tool description carries the same executable-path guard', () => {
  const log = tools.find((t) => t.name === 'memory_log')
  if (!log) throw new Error('memory_log not registered')
  const desc = String(log.description || '')
  // task-2 起措辞升级为三态：更新既有（documentId+expectedRevision）/ 显式首建（createDocument+eventId）/ 旧路径。
  if (!desc.includes('R4 开启时维护文档有两种写法')) throw new Error('memory_log description lacks the document-path statement')
  if (!desc.includes('不要编造')) throw new Error('memory_log description lacks the anti-fabrication rule')
  return 'desc len=' + desc.length
})
await test('P5H-09 the old unconditional "new snapshot" wording is gone from both prompt surfaces', () => {
  const log = tools.find((t) => t.name === 'memory_log')
  const desc = String((log && log.description) || '')
  const bad = '用 `kind=handoff` 新开一篇账本(append-only,不追改旧账本)'
  if (desc.includes(bad)) throw new Error('memory_log still carries the old unconditional wording')
  const bad2 = '由 memory_note(kind=handoff) 新开一篇，**append-only、不追改旧账本**'
  if (GUIDANCE.includes(bad2)) throw new Error('GUIDANCE still carries the old unconditional wording')
  return 'old wording absent'
})

if (typeof cleanup === 'function') { try { cleanup() } catch (_) {} }
if (engine && typeof engine.dispose === 'function') { try { await engine.dispose() } catch (_) {} }
if (prevHome === undefined) delete process.env.DSH_HOME; else process.env.DSH_HOME = prevHome
globalThis.setTimeout = prevSetTimeout
globalThis.setInterval = prevSetInterval
globalThis.fetch = prevFetch
MemoryEngine.prototype.loadConfigSync = prevLoad

const outDir = path.resolve('artifacts', '_r4-p5-20261112', 'evidence')
await fs.mkdir(outDir, { recursive: true })
await fs.writeFile(path.join(outDir, 'history-probe.json'), JSON.stringify({ at: new Date().toISOString(), pass, fail, failures, evidence }, null, 2))
console.log('')
console.log('SUMMARY PASS ' + pass + ' / FAIL ' + fail)
if (fail > 0) { console.log(JSON.stringify(failures, null, 2)); process.exitCode = 1 }
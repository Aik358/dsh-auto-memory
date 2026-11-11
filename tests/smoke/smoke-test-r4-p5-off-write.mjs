import * as fs from 'node:fs/promises'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { apply, MemoryEngine } from '../lib/audit-engine.mjs'

// R4 P5: with ledgerDocEnabled=false, the legacy memory_note(kind=handoff) write path
// must produce ZERO R4 side effects: no documents/ entry, no wal-* checkpoint.
// All roots are absolute paths inside a throwaway DSH_HOME (never the production root).
const root = path.resolve('artifacts', '_r4-p5-20261112', 'fixtures', 'off-write')
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
const agent = { session: { id: 'session-p5-off', header: { cwd: workspace } } }
const exec = { agent }

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
} catch (error) {
  console.log('  FAIL - apply() threw :: ' + error.stack)
  fail++
}

const note = tools.find((t) => t.name === 'memory_note')
let resolvedHandoffDir = null
try {
  const paths = await engine.resolvePaths(agent)
  resolvedHandoffDir = paths.handoffDir
} catch (error) {
  console.log('  FAIL - resolvePaths threw :: ' + error.stack)
  fail++
}
const handoffDir = resolvedHandoffDir
function listTree(dir) {
  if (!existsSync(dir)) return []
  const out = []
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name)
    const st = statSync(full)
    if (st.isDirectory()) out.push(name + '/', ...listTree(full).map((x) => name + '/' + x))
    else out.push(name)
  }
  return out.sort()
}
function handlerFor(name) { return tools.find((t) => t.name === name) }

console.log('=== P5-2 legacy memory_note(kind=handoff) with ledgerDocEnabled=false ===')
await test('P5O-01 memory_note tool is registered and engine config really reads ledgerDocEnabled=false', async () => {
  if (!note) throw new Error('memory_note not registered')
  const cfg = engine && engine.config ? engine.config : {}
  if (cfg.ledgerDocEnabled !== false) throw new Error('engine.config.ledgerDocEnabled=' + JSON.stringify(cfg.ledgerDocEnabled))
  evidence.push({ kind: 'precondition', ledgerDocEnabled: cfg.ledgerDocEnabled, handoffEnabled: cfg.handoffEnabled, memoryRoot: cfg.memoryRoot })
  return 'ledgerDocEnabled=false'
})
await test('P5O-02 before-image: no handoff dir at all', async () => {
  if (existsSync(handoffDir)) throw new Error('handoff dir already exists before the write')
  return 'handoff-dir=absent'
})
let writeResult = null
let ledgerFile = null
await test('P5O-03 real memory_note(kind=handoff) writes exactly one legacy timestamped ledger', async () => {
  writeResult = await note.execute({
    kind: 'handoff',
    content: '# 任务状态' + String.fromCharCode(10) + 'synthetic p5 off-write probe' + String.fromCharCode(10) + '## 目标' + String.fromCharCode(10) + 'prove zero R4 side effect' + String.fromCharCode(10) + '## 已试方案与失败原因' + String.fromCharCode(10) + '## 进度与下一步' + String.fromCharCode(10) + 'none',
  }, exec)
  const text = String(writeResult || '')
  evidence.push({ kind: 'tool-output', head: text.slice(0, 300) })
  if (!/已更新|written|handoff/i.test(text)) throw new Error('unexpected tool output: ' + text.slice(0, 400))
  const names = existsSync(handoffDir) ? readdirSync(handoffDir).sort() : []
  ledgerFile = names.find((n) => /^handoff-[0-9]{8}-[0-9]{6}(?:-[a-z])?\.md$/.test(n)) || null
  if (!ledgerFile) throw new Error('no legacy handoff-*.md produced; names=' + JSON.stringify(names))
  evidence.push({ kind: 'legacy-write', names })
  return ledgerFile
})
await test('P5O-04 ZERO R4 side effect: no handoff/documents directory, no *.md under it', async () => {
  const documentsDir = path.join(handoffDir, 'documents')
  const exists = existsSync(documentsDir)
  const inside = exists ? readdirSync(documentsDir) : []
  if (exists && inside.length > 0) throw new Error('documents/ has ' + inside.length + ' entries: ' + JSON.stringify(inside))
  // Even an empty documents/ dir is acceptable only if the facade was never constructed lazily;
  // record the exact fact rather than rounding it away.
  evidence.push({ kind: 'no-documents', documentsDirExists: exists, entries: inside.length })
  return 'documentsDirExists=' + exists + ' entries=' + inside.length
})
await test('P5O-05 ZERO R4 side effect: event store contains no wal-* checkpoint', async () => {
  const eventStore = path.join(handoffDir, 'event-store.json')
  if (!existsSync(eventStore)) return 'event-store.json absent (no event was created)'
  const parsed = JSON.parse(readFileSync(eventStore, 'utf8'))
  const all = []
  for (const ev of (parsed.events || [])) for (const ck of (ev.checkpoints || [])) all.push(ck)
  const wal = all.filter((ck) => String(ck.kind || '').startsWith('wal-'))
  const withOpId = all.filter((ck) => ck && ck.opId)
  if (wal.length) throw new Error('found ' + wal.length + ' wal-* checkpoints')
  if (withOpId.length) throw new Error('found ' + withOpId.length + ' checkpoints carrying opId')
  evidence.push({ kind: 'no-wal', checkpoints: all.length, walStar: wal.length, withOpId: withOpId.length })
  return 'checkpoints=' + all.length + ' walStar=0 withOpId=0'
})
await test('P5O-06 ledger bytes are byte-identical to what the legacy writer produced (no rewrite by R4)', async () => {
  const full = path.join(handoffDir, ledgerFile)
  const before = readFileSync(full)
  await new Promise((resolve) => setTimeout(resolve, 200))
  const after = readFileSync(full)
  if (!before.equals(after)) throw new Error('ledger bytes changed after the write settled')
  if (!/^# 交接账本/.test(after.toString('utf8'))) throw new Error('legacy ledger header missing')
  evidence.push({ kind: 'legacy-bytes-stable', bytes: before.length })
  return 'bytes=' + before.length + ' stable'
})
await test('P5O-07 second write takes the legacy append-only path again (still zero documents)', async () => {
  const before = readdirSync(handoffDir).filter((n) => /^handoff-.*\.md$/.test(n)).length
  await note.execute({ kind: 'handoff', content: '## 任务状态' + String.fromCharCode(10) + 'second probe' }, exec)
  const after = readdirSync(handoffDir).filter((n) => /^handoff-.*\.md$/.test(n)).length
  if (after !== before + 1) throw new Error('expected exactly one new ledger, before=' + before + ' after=' + after)
  const documentsDir = path.join(handoffDir, 'documents')
  const docsInside = existsSync(documentsDir) ? readdirSync(documentsDir).length : 0
  if (docsInside > 0) throw new Error('documents/ gained ' + docsInside + ' entries on the second legacy write')
  evidence.push({ kind: 'second-legacy-write', before, after, documentsEntries: docsInside })
  return 'ledgers ' + before + '->' + after + ' documents=0'
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
await fs.writeFile(path.join(outDir, 'off-write.json'), JSON.stringify({ at: new Date().toISOString(), pass, fail, failures, evidence }, null, 2))
console.log('')
console.log('SUMMARY PASS ' + pass + ' / FAIL ' + fail)
if (fail > 0) { console.log(JSON.stringify(failures, null, 2)); process.exitCode = 1 }
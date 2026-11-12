import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { LedgerDocumentStore } from '../../lib/ledger-doc/document-store.js'
import { MemoryEngine, apply } from '../lib/audit-engine.mjs'
import { eventStorePre } from '../../lib/event-store.js'

const root = path.resolve('artifacts', '_batch2-2.6-note-integration')
const ws = path.join(root, 'workspace')
await fs.rm(root, { recursive: true, force: true })
await fs.mkdir(ws, { recursive: true })
await fs.writeFile(path.join(root, 'dsh-auto-memory.json'), JSON.stringify({ memoryRoot: path.join(root, 'memory'), userMemoryDir: path.join(root, 'user'), ledgerDocEnabled: false, criteriaGate: false, handoffEnabled: true, autoContinueEnabled: false, teamEnabled: false, externalSources: {} }))
const agent = { session: { id: 'task-10-session', header: { cwd: ws } } }
const exec = { agent }
let p
let storePath
let engine, note
const timerInterval = globalThis.setInterval
const timerTimeout = globalThis.setTimeout
const originalFetch = globalThis.fetch
const originalHome = process.env.DSH_HOME
const load = MemoryEngine.prototype.loadConfigSync
const listeners = new Map(['uncaughtException', 'unhandledRejection', 'exit'].map((key) => [key, new Set(process.listeners(key))]))
const ledger = '# Synthetic task-10\n## 任务状态\n- 用于验证显式事件归属的任务状态正文，足够长\n## 目标\n- 验证真实 memory_note 写入目标事件，而不写入其它事件\n## 已试方案与失败原因\n- 本轮没有需要记录的失败方案，使用隔离临时根\n## 进度与下一步\n- 运行真实工具入口并检查每个事件的检查点数量\n'
const plan = '# Synthetic plan\n## 目标\n- 足够长的项目目标内容用于通过正式白板判据。\n'
let pass = 0
const check = (condition, message) => { assert.ok(condition, message); pass++ }
const detail = async (id) => (await eventStorePre.detail(storePath, id)).event
const allDetails = async () => Promise.all((await eventStorePre.list(storePath, { all: true })).events.map(async (event) => [event.id, (await detail(event.id)).checkpoints.length]))
const listFiles = async (dir) => (await fs.readdir(dir, { withFileTypes: true })).filter((entry) => entry.isFile()).map((entry) => entry.name)
try {
  process.env.DSH_HOME = root
  globalThis.setInterval = globalThis.setTimeout = () => ({ unref() {} })
  globalThis.fetch = async () => new Response('{}', { status: 503 })
  MemoryEngine.prototype.loadConfigSync = function () { engine = this; return load.call(this) }
  apply({ get: () => undefined, on: () => () => {}, systemPrompt: { context: () => () => {}, section: () => () => {} }, tools: { register: (tool) => { if (tool.name === 'memory_note') note = tool; return () => {} } }, webServer: { register: () => () => {} }, effect: (run) => { run() } }, {})
  check(typeof note?.execute === 'function' && engine instanceof MemoryEngine, 'real MemoryEngine and registered memory_note')
  p = await engine.resolvePaths(agent)
  storePath = path.join(p.handoffDir, 'event-store.json')
  const active = await eventStorePre.create(storePath, { name: 'task10 active' })
  const paused = await eventStorePre.create(storePath, { name: 'task10 paused' })
  await eventStorePre.set(storePath, paused.id, { status: 'paused', pausedReason: 'task10 pause' })
  const closed = await eventStorePre.create(storePath, { name: 'task10 closed' })
  await eventStorePre.close(storePath, closed.id, { outcome: 'task10 closed' })
  for (const id of [active.id, paused.id]) {
    const before = (await detail(id)).checkpoints.length
    const result = await note.execute({ kind: 'handoff', content: ledger + id + '\n', eventId: id }, exec)
    check(String(result).includes('已写入'), 'real handoff accepted for ' + id + ' :: ' + String(result))
    check((await detail(id)).checkpoints.length === before + 1, 'explicit target checkpoint +1')
  }
  for (const id of [closed.id, 'evt_deadbeef', '../bad']) {
    const before = await allDetails()
    const beforeFiles = await listFiles(p.handoffDir)
    const result = await note.execute({ kind: 'handoff', content: ledger, eventId: id }, exec)
    check(String(result).includes('event-id-unavailable'), 'explicit invalid id rejected through tool')
    check(JSON.stringify(await allDetails()) === JSON.stringify(before), 'invalid id creates no checkpoints')
    check(JSON.stringify(await listFiles(p.handoffDir)) === JSON.stringify(beforeFiles), 'invalid id has no document side effect')
  }
  const fallback = await note.execute({ kind: 'handoff', content: ledger + 'fallback\n' }, exec)
  check(String(fallback).includes('已写入'), 'no eventId compatibility accepted')
  check((await detail(active.id)).checkpoints.some((cp) => cp.kind === 'handoff' && cp.text.includes('fallback')), 'default latest-active handoff remains unchanged')

  const beforePhase3 = (await detail(active.id)).checkpoints.length
  const originalPlan = engine.writePlanSnapshot.bind(engine)
  let called = false
  engine.writePlanSnapshot = async (...args) => { called = true; return { ok: false, error: 'stale-revision' } }
  const phase3 = await note.execute({ kind: 'plan', content: plan, eventId: active.id }, exec)
  engine.writePlanSnapshot = originalPlan
  check(called && String(phase3).includes('stale-revision'), 'real tool reaches Phase3 failure')
  const phase3Checks = (await detail(active.id)).checkpoints.slice(beforePhase3)
  check(phase3Checks.some((cp) => cp.kind === 'plan') && phase3Checks.some((cp) => cp.kind === 'plan-write-failed'), 'Phase1 and Phase3 use the same explicit eventId')

  engine.config.ledgerDocEnabled = true
  const a1Event = await eventStorePre.create(storePath, { name: 'task10 A1 event' })
  const beforeA1 = (await detail(a1Event.id)).checkpoints.length
  const a1 = await note.execute({ kind: 'handoff', documentId: 'task10-a1-000000-0001', createDocument: true, eventId: a1Event.id, content: ledger }, exec)
  check(String(a1).includes('维护文档已更新'), 'A1 document create succeeds :: ' + String(a1))
  const storedA1 = await new LedgerDocumentStore(path.join(p.handoffDir, 'documents'), { readOnly: true }).readDocument('task10-a1-000000-0001')
  check(storedA1.ok === true && /^sha256:[0-9a-f]{64}$/.test(storedA1.revision), 'A1 physical document has a real revision :: ' + JSON.stringify({ ok: storedA1.ok, error: storedA1.error, revision: storedA1.revision, keys: Object.keys(storedA1) }))
  check(String(a1).includes('revision ' + storedA1.revision), 'A1 create-only receipt exposes the same real revision')
  check((await detail(a1Event.id)).checkpoints.length === beforeA1, 'A1 does not use legacy handoff checkpoint path')
  console.log('SUMMARY PASS ' + pass + ' / FAIL 0')
} finally {
  globalThis.setInterval = timerInterval
  globalThis.setTimeout = timerTimeout
  globalThis.fetch = originalFetch
  MemoryEngine.prototype.loadConfigSync = load
  if (originalHome === undefined) delete process.env.DSH_HOME
  else process.env.DSH_HOME = originalHome
  for (const [key, previous] of listeners) for (const listener of process.listeners(key)) if (!previous.has(listener)) process.removeListener(key, listener)
  if (!process.env.TASK10_SKIP_MUTATION) {
    const mutationRoot = path.resolve('artifacts', '_batch2-2.6-note-mutation')
    await fs.rm(mutationRoot, { recursive: true, force: true })
    await fs.mkdir(mutationRoot, { recursive: true })
    const source = await fs.readFile('lib/index.js', 'utf8')
    const anchor = '            eventId: args.eventId,'
    assert.equal(source.split(anchor).length - 1, 1, 'Phase1 eventId pass-through anchor exactly once')
    const mutantPath = path.join(mutationRoot, 'index.js')
    await fs.writeFile(mutantPath, source.replace(anchor, '            eventId: undefined,'))
    const child = spawnSync(process.execPath, [fileURLToPath(import.meta.url)], { env: { ...process.env, DAM_AUDIT_ENGINE_SOURCE: mutantPath, TASK10_SKIP_MUTATION: '1' }, encoding: 'utf8', timeout: 120000 })
    const output = String(child.stdout || '') + String(child.stderr || '')
    assert.notEqual(child.status, 0, 'deleting Phase1 eventId pass-through must turn the real integration suite red: ' + output.slice(-500))
    console.log('MUTATION phase1-eventId-removed CAUGHT / MISSED 0')
  }
  if (pass >= 20) await fs.rm(root, { recursive: true, force: true })
}

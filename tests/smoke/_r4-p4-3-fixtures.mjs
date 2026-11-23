import * as fs from 'node:fs/promises'
import path from 'node:path'
import assert from 'node:assert/strict'
import { LedgerDocumentStore } from '../../lib/ledger-doc/index.js'

export const P43_EVENT_ID = 'evt_c1d2e3f4'
export const P43_DOC_ID = 'r4p43-brief-261111-0001'
export const P43_ROOT = path.resolve('artifacts', '_r4-p4-3-fixtures')
export const P43_MUTATION_ROOT = path.resolve('artifacts', '_r4-p4-3-mutations')
const nowBase = Date.UTC(2026, 10, 11, 4, 0, 0)
let nowTick = 0

export function p43LegacyText(goal = 'Synthetic legacy goal') {
  return ['# 交接账本 · synthetic', '## 任务状态', 'Synthetic legacy state', '## 目标', goal, '## 已试方案与失败原因', '', '## 进度与下一步', 'Synthetic legacy next', ''].join('\n')
}

export async function createP43Fixture(name, options = {}) {
  const base = options.base || P43_ROOT
  const documentId = options.documentId || P43_DOC_ID
  const root = path.join(base, name)
  assert.equal(root.startsWith(base + path.sep), true)
  await fs.rm(root, { recursive: true, force: true })
  const handoffDir = path.join(root, 'handoff')
  const documentsDir = path.join(handoffDir, 'documents')
  const eventsPath = path.join(handoffDir, 'event-store.json')
  await fs.mkdir(documentsDir, { recursive: true })
  await fs.writeFile(eventsPath, JSON.stringify({ events: [{ id: P43_EVENT_ID, status: 'active', checkpoints: [{ at: nowBase, kind: 'wal-committed', documentId, opId: 'r4op_' + 'ab'.repeat(16) }] }], appliedOps: {} }))
  await fs.writeFile(path.join(handoffDir, 'PLAN.md'), '# Synthetic plan\n')
  await fs.writeFile(path.join(handoffDir, 'handoff-20261111-120000.md'), p43LegacyText())
  const store = new LedgerDocumentStore(documentsDir, { eventsPath, now: () => new Date(nowBase + nowTick++).toISOString() })
  const created = await store.createDocument({ documentId, title: 'Synthetic P4-3 maintenance', eventIds: [P43_EVENT_ID], content: options.content || 'first synthetic body' })
  assert.equal(created.ok, true, JSON.stringify(created))
  return { root, handoffDir, documentsDir, eventsPath, store, document: created, documentId }
}

export function p43Paths(f) {
  return {
    ws: f.root, wsBound: true, projectDir: f.root, handoffDir: f.handoffDir,
    planPath: path.join(f.handoffDir, 'PLAN.md'), notesPath: path.join(f.root, 'MEMORY.md'),
    userFile: path.join(f.root, 'USER.md'), logPath: path.join(f.root, 'logs'),
    reflectDir: path.join(f.root, 'reflections'), userDir: path.join(f.root, 'user'),
    greetPath: path.join(f.root, 'greeting.md'), greetPathLegacy: path.join(f.root, 'greeting-old.md'), calendarPath: path.join(f.root, 'calendar.md'),
  }
}

export async function makeP43Engine(f, overrides = {}) {
  const { apply, MemoryEngine } = await import('../lib/audit-engine.mjs')
  let engine = null
  const original = MemoryEngine.prototype.loadConfigSync
  MemoryEngine.prototype.loadConfigSync = function () { engine = this; return original.call(this) }
  const ctx = { effect() {}, get() { return undefined }, on() { return () => {} }, config: {}, root: P43_ROOT, tools: { register() { return () => {} } }, webServer: { register() { return () => {} } }, systemPrompt: { context() { return () => {} }, section() { return () => {} } } }
  try { apply(ctx) } finally { MemoryEngine.prototype.loadConfigSync = original }
  assert.ok(engine, 'real apply must construct MemoryEngine')
  engine.config = Object.assign({}, engine.config, {
    handoffEnabled: true, boardMode: 'graph', ledgerDocEnabled: true,
    globalBriefEnabled: true, globalBriefWatchMemory: true, globalBriefWatchDocs: false,
    globalBriefWatchExternal: false, globalBriefWatchTeam: false,
  }, overrides)
  engine.configLoaded = true
  engine.loadConfig = async () => {}
  engine.loadConfigSync = () => {}
  const paths = p43Paths(f)
  engine.resolvePaths = async () => paths
  engine.resolvePathsForSession = async () => paths
  engine.resolvePathsForRequestPre = async () => ({ pa: paths, sid: 'synthetic-session' })
  engine.projectDirOf = () => f.root
  engine.userDirOf = () => path.join(f.root, 'user')
  engine.state.ws = f.root
  assert.equal(typeof engine.external.briefDetectSyncPre, 'function')
  return engine
}

export async function updateP43Document(f, after, { preserveMtime = false } = {}) {
  const file = path.join(f.documentsDir, f.documentId + '.md')
  const beforeStat = await fs.stat(file)
  const externalStore = new LedgerDocumentStore(f.documentsDir, { eventsPath: f.eventsPath, now: () => new Date(nowBase + 1000 + nowTick++).toISOString() })
  const current = await externalStore.readDocument(f.documentId)
  assert.equal(current.ok, true, JSON.stringify(current))
  const updated = await externalStore.updateDocument({ documentId: f.documentId, expectedRevision: current.revision, eventIds: [P43_EVENT_ID], changeSet: [{ regionId: 'content', beforeText: current.content, afterText: after }] })
  assert.equal(updated.ok, true, JSON.stringify(updated))
  if (preserveMtime) await fs.utimes(file, beforeStat.atime, beforeStat.mtime)
  return updated
}

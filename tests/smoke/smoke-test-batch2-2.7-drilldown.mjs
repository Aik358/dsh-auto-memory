import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { selectEventCheckpointPre, readEventCheckpointPre, formatEventCheckpointPre } from '../../lib/event-drilldown.js'
import { normalizeText } from '../../lib/ledger-doc/protocol.js'
import { MemoryEngine, apply } from '../lib/audit-engine.mjs'

const root = path.resolve('artifacts', '_batch2-2.7-drilldown')
const handoffDir = path.join(root, 'handoff')
await fs.rm(root, { recursive: true, force: true })
await fs.mkdir(handoffDir, { recursive: true })
const eventId = 'evt_a1b2c3d4'
const otherId = 'evt_b2c3d4e5'
const text = '# Synthetic checkpoint ledger\n'
const sourceRef = 'handoff-synthetic.md'
const file = path.join(handoffDir, sourceRef)
const raw = Buffer.from(text)
const sha = (b) => createHash('sha256').update(b).digest('hex')
const cp = { kind: 'handoff', text, sourceRef, idemKey: 'synthetic-one', rawSha256: sha(raw), normalizedSha256: sha(normalizeText(text)), at: 20 }
const store = { events: [
  { id: eventId, checkpoints: [{ kind: 'log', text: 'legacy full text' }, cp, { kind: 'plan', sourceRef: 'PLAN.md', idemKey: 'synthetic-plan', at: 40 }, { kind: 'handoff', text: 'older', sourceRef: 'older.md', idemKey: 'older', at: 30 }] },
  { id: otherId, checkpoints: [{ ...cp, idemKey: 'cross-event', text: 'other event text' }] },
] }
await fs.writeFile(file, raw)
await fs.writeFile(path.join(handoffDir, 'event-store.json'), JSON.stringify(store))
let pass = 0
process.on('uncaughtException', (error) => { console.error(error); process.exitCode = 1 })
process.on('unhandledRejection', (error) => { console.error(error); process.exitCode = 1 })
const check = (condition, message) => { if (!condition) throw new Error(message); pass++ }
check(selectEventCheckpointPre(store, { eventId, checkpointIndex: 1 }).checkpoint.idemKey === 'synthetic-one', '0-based selection')
check(selectEventCheckpointPre(store, { eventId, idemKey: 'synthetic-one' }).checkpointIndex === 1, 'event-scoped idem selection')
check(selectEventCheckpointPre(store, { eventId: otherId, idemKey: 'synthetic-one' }).code === 'checkpoint-not-found', 'cross-event idem cannot resolve')
check(selectEventCheckpointPre(store, { eventId, checkpointIndex: -1 }).code === 'checkpoint-not-found', 'negative index rejected')
check(selectEventCheckpointPre(store, { eventId, checkpointIndex: 1.5 }).code === 'checkpoint-not-found', 'fraction index rejected')
check(selectEventCheckpointPre(store, { eventId, checkpointIndex: '1' }).code === 'checkpoint-not-found', 'string index rejected')
check(selectEventCheckpointPre(store, { eventId }).code === 'checkpoint-selector-invalid', 'missing selector rejected')
check(selectEventCheckpointPre(store, { eventId, checkpointIndex: 1, idemKey: 'synthetic-one' }).code === 'checkpoint-selector-invalid', 'both selectors rejected')
const duplicate = structuredClone(store)
duplicate.events[0].checkpoints.push({ ...cp, idemKey: 'synthetic-one' })
check(selectEventCheckpointPre(duplicate, { eventId, idemKey: 'synthetic-one' }).code === 'checkpoint-idem-ambiguous', 'duplicate idem fail closed')
const verified = await readEventCheckpointPre({ store, eventId, checkpointIndex: 1, handoffDir })
check(verified.ok && verified.verified && verified.text === text, 'real Buffer and full fingerprint read')
check(verified.bytes === raw.length && verified.rawSha256 === sha(raw), 'real bytes and raw hash')
const legacy = await readEventCheckpointPre({ store, eventId, checkpointIndex: 0, handoffDir })
check(legacy.ok && !legacy.verified && legacy.text === 'legacy full text', 'legacy full-text compatibility')
const short = structuredClone(store)
short.events[0].checkpoints[1] = { ...cp, rawSha256: undefined, normalizedSha256: undefined, sha16: '1234567890abcdef' }
const unverified = await readEventCheckpointPre({ store: short, eventId, checkpointIndex: 1, handoffDir })
check(unverified.ok && !unverified.verified && unverified.code === 'pointer-unverified' && unverified.text === text, 'sha16 never proves identity')
const wrong = structuredClone(store)
wrong.events[0].checkpoints[1] = { ...cp, normalizedSha256: '0'.repeat(64) }
const drift = await readEventCheckpointPre({ store: wrong, eventId, checkpointIndex: 1, handoffDir })
check(!drift.ok && drift.code === 'pointer-drift' && drift.text === text && !drift.verified, 'drift never substitutes current file for old text')
await fs.writeFile(file, text.replace(/\n/g, '\r\n'))
const format = await readEventCheckpointPre({ store, eventId, checkpointIndex: 1, handoffDir })
check(format.ok && format.verified && format.formatWarning, 'CRLF is a format warning not content drift')
await fs.writeFile(file, raw)
const missingStore = structuredClone(store)
missingStore.events[0].checkpoints[1].sourceRef = 'absent.md'
const missing = await readEventCheckpointPre({ store: missingStore, eventId, checkpointIndex: 1, handoffDir })
check(!missing.ok && missing.code === 'pointer-missing', 'missing source explicit')
check(missing.recent.length === 2 && missing.recent.every((item) => item.kind === 'handoff' && item.eventId === eventId) && missing.recent[0].checkpointIndex === 3 && missing.recent[0].idemKey === 'older' && missing.recent[1].checkpointIndex === 1, 'recent filtered by kind with exact selectors and stable order')
check(formatEventCheckpointPre(verified).includes('rawSha256=' + sha(raw)), 'format contains full physical proof')

// Real registered memory_recall -> engine.recall -> strict selector, isolated DSH_HOME.
const workspace = path.join(root, 'workspace')
await fs.mkdir(workspace, { recursive: true })
await fs.writeFile(path.join(root, 'dsh-auto-memory.json'), JSON.stringify({ memoryRoot: path.join(root, 'memory'), userMemoryDir: path.join(root, 'user'), ledgerDocEnabled: false, handoffEnabled: true, autoContinueEnabled: false, teamEnabled: false, externalSources: {} }))
const originalHome = process.env.DSH_HOME
const originalInterval = globalThis.setInterval
const originalTimeout = globalThis.setTimeout
const originalFetch = globalThis.fetch
const originalLoad = MemoryEngine.prototype.loadConfigSync
const agent = { session: { id: 'synthetic-drilldown', header: { cwd: workspace } } }
let engine, recall
try {
  process.env.DSH_HOME = root
  globalThis.setInterval = globalThis.setTimeout = () => ({ unref() {} })
  globalThis.fetch = async () => new Response('{}', { status: 503 })
  MemoryEngine.prototype.loadConfigSync = function () { engine = this; return originalLoad.call(this) }
  apply({ get: () => undefined, on: () => () => {}, systemPrompt: { context: () => () => {}, section: () => () => {} }, tools: { register: (tool) => { if (tool.name === 'memory_recall') recall = tool; return () => {} } }, webServer: { register: () => () => {} }, effect: () => {} }, {})
  check(typeof recall?.execute === 'function' && engine instanceof MemoryEngine, 'real MemoryEngine and registered recall')
  const paths = await engine.resolvePaths(agent)
  await fs.mkdir(paths.handoffDir, { recursive: true })
  await fs.writeFile(path.join(paths.handoffDir, 'event-store.json'), JSON.stringify(store))
  await fs.writeFile(path.join(paths.handoffDir, sourceRef), raw)
  const direct = await recall.execute({ query: eventId, expand: eventId, eventId, checkpointIndex: 1 }, { agent })
  console.log('DIRECT RECEIPT', JSON.stringify(direct))
  check(direct.includes('真源:') && direct.includes(text) && direct.includes('bytes=' + raw.length), 'registered tool returns real source')
  const mismatch = await recall.execute({ query: eventId, expand: eventId, eventId: otherId, checkpointIndex: 1 }, { agent })
  check(mismatch.includes('checkpoint-selector-invalid'), 'expand/eventId mismatch refused')
  const noSelection = await recall.execute({ query: eventId, expand: eventId, eventId, checkpointIndex: 1, idemKey: 'synthetic-one' }, { agent })
  check(noSelection.includes('checkpoint-selector-invalid'), 'dual selector refused by real tool')
  const old = await recall.execute({ query: eventId, expand: eventId }, { agent })
  check(old.includes('checkpointIndex=1') && old.includes('idemKey=synthetic-one'), 'legacy expansion exposes selectors')
  const absent = await recall.execute({ query: eventId, expand: eventId, eventId, idemKey: 'cross-event' }, { agent })
  check(absent.includes('checkpoint-not-found'), 'cross-event key does not leak other event')
  const storeBefore = await fs.readFile(path.join(paths.handoffDir, 'event-store.json'))
  const sourceBefore = await fs.readFile(path.join(paths.handoffDir, sourceRef))
  await recall.execute({ query: eventId, expand: eventId, eventId, checkpointIndex: 1 }, { agent })
  check((await fs.readFile(path.join(paths.handoffDir, 'event-store.json'))).equals(storeBefore) && (await fs.readFile(path.join(paths.handoffDir, sourceRef))).equals(sourceBefore), 'read-only tool leaves source and store bytes unchanged')
} finally {
  process.env.DSH_HOME = originalHome
  globalThis.setInterval = originalInterval
  globalThis.setTimeout = originalTimeout
  globalThis.fetch = originalFetch
  MemoryEngine.prototype.loadConfigSync = originalLoad
}
console.log('SUMMARY PASS ' + pass + ' / FAIL 0')
console.log('PHYSICAL syntheticBytes=' + raw.length + ' rawSha256=' + sha(raw) + ' normalizedSha256=' + sha(normalizeText(text)))

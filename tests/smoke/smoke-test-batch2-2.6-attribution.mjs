import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { appendHandoffCheckpointPre } from '../../lib/event-write.js'
import { eventStorePre } from '../../lib/event-store.js'

const root = path.resolve('artifacts', '_batch2-2.6-attribution')
await fs.rm(root, { recursive: true, force: true })
await fs.mkdir(root, { recursive: true })
const storePath = path.join(root, 'event-store.json')
const ledgerPath = path.join(root, 'handoff-test.md')
const ledger = '# Synthetic handoff\n## 任务状态\nsynthetic\n## 目标\nsynthetic goal\n## 进度与下一步\nsynthetic next\n'
let checks = 0
const active = await eventStorePre.create(storePath, { name: 'synthetic active' })
const paused = await eventStorePre.create(storePath, { name: 'synthetic paused' })
assert.equal((await eventStorePre.set(storePath, paused.id, { status: 'paused', pausedReason: 'synthetic paused' })).status, 'paused')
const closed = await eventStorePre.create(storePath, { name: 'synthetic closed' })
assert.equal((await eventStorePre.close(storePath, closed.id, { outcome: 'synthetic close' })).ok, true)

for (const eventId of [active.id, paused.id]) {
  const before = await eventStorePre.detail(storePath, eventId)
  const result = await appendHandoffCheckpointPre(storePath, { ledgerText: ledger + 'write', ledgerPath, eventId })
  const after = await eventStorePre.detail(storePath, eventId)
  assert.equal(result.eventId, eventId)
  assert.equal(after.event.checkpoints.length, before.event.checkpoints.length + 1)
  checks++
}
for (const eventId of [closed.id, 'evt_deadbeef', '../bad']) {
  const before = await fs.readFile(storePath)
  await assert.rejects(() => appendHandoffCheckpointPre(storePath, { ledgerText: ledger, ledgerPath, eventId }), (error) => error.code === 'event-id-unavailable')
  assert.deepEqual(await fs.readFile(storePath), before)
  checks++
}
const other = await eventStorePre.create(storePath, { name: 'synthetic latest active' })
const fallback = await appendHandoffCheckpointPre(storePath, { ledgerText: ledger + 'fallback', ledgerPath })
assert.equal(fallback.eventId, other.id)
assert.equal((await eventStorePre.detail(storePath, other.id)).event.checkpoints.length, 1)
checks++
const pausedOnlyRoot = path.join(root, 'paused-only')
await fs.mkdir(pausedOnlyRoot)
const pausedOnlyPath = path.join(pausedOnlyRoot, 'event-store.json')
const pausedEvent = await eventStorePre.create(pausedOnlyPath, { name: 'synthetic paused only' })
await eventStorePre.set(pausedOnlyPath, pausedEvent.id, { status: 'paused', pausedReason: 'synthetic pause' })
const created = await appendHandoffCheckpointPre(pausedOnlyPath, { ledgerText: ledger + 'paused only', ledgerPath })
assert.notEqual(created.eventId, pausedEvent.id)
checks++
console.log('PASS ' + checks)

const mutationRoot = path.join(root, 'mutations')
await fs.mkdir(path.join(mutationRoot, 'ledger-doc'), { recursive: true })
await fs.copyFile('lib/event-store.js', path.join(mutationRoot, 'event-store.js'))
await fs.copyFile('lib/shared-state-lock.js', path.join(mutationRoot, 'shared-state-lock.js'))
await fs.copyFile('lib/ledger-doc/protocol.js', path.join(mutationRoot, 'ledger-doc', 'protocol.js'))
const source = await fs.readFile('lib/event-write.js', 'utf8')
const anchor = "if (!selected || !['active', 'paused'].includes(selected.status)) throw Object.assign(new Error('event-id-unavailable: ' + evId), { code: 'event-id-unavailable' })"
assert.equal(source.split(anchor).length - 1, 1)
const mutations = [
  { name: 'paused-rejected', source: source.replace("['active', 'paused']", "['active']"), input: { ledgerText: ledger + 'mutant', ledgerPath, eventId: paused.id } },
  { name: 'invalid-fallback', source: source.replace(anchor, ''), input: { ledgerText: ledger + 'mutant', ledgerPath, eventId: '../bad' } },
]
let caught = 0
for (const mutation of mutations) {
  const file = path.join(mutationRoot, mutation.name + '.js')
  await fs.writeFile(file, mutation.source)
  const { appendHandoffCheckpointPre: mutant } = await import(pathToFileURL(file).href)
  await assert.rejects(() => mutant(storePath, mutation.input), (error) => mutation.name === 'invalid-fallback' ? error.message.includes('事件不存在') : error.code === 'event-id-unavailable')
  caught++
}
const restored = path.join(mutationRoot, 'restored.js')
await fs.writeFile(restored, source)
const { appendHandoffCheckpointPre: restoredFn } = await import(pathToFileURL(restored).href)
const originalCount = (await eventStorePre.detail(storePath, active.id)).event.checkpoints.length
await restoredFn(storePath, { ledgerText: ledger + 'restored', ledgerPath, eventId: active.id })
assert.equal((await eventStorePre.detail(storePath, active.id)).event.checkpoints.length, originalCount + 1)
console.log('MUTATION CAUGHT ' + caught + ' / MISSED 0; RESTORED GREEN')

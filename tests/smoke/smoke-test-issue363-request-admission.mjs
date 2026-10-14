import assert from 'node:assert/strict'
import path from 'node:path'
import { captureMemoryMutationPre, withMemoryAdmissionScopePre } from '../../lib/memory-mutation-transaction.js'
import { memoryWriteLockKey } from '../../lib/memory-writer.js'

const target = path.resolve('fixture-memory.md')
const engine = { config: {}, expandUserPath: (x) => x, _settingsMigrationActive: true, _settingsPlanFlights: new Set([Promise.resolve()]) }
assert.equal(captureMemoryMutationPre(engine, target).migrationActive, true)
engine._noteRouteQueues = new Map([[memoryWriteLockKey(target), Promise.resolve()]])
assert.equal(captureMemoryMutationPre(engine, target).migrationActive, true)
withMemoryAdmissionScopePre({ engine, target }, () => {
  assert.equal(captureMemoryMutationPre(engine, target).migrationActive, true)
})
engine._settingsMigrationActive = false
await withMemoryAdmissionScopePre({ engine, target }, async () => {
  engine._settingsMigrationActive = true
  assert.equal(captureMemoryMutationPre(engine, target).migrationActive, false)
})
assert.equal(captureMemoryMutationPre(engine, target).migrationActive, true)
console.log('PASS #363 only the request admitted before migration may finish')

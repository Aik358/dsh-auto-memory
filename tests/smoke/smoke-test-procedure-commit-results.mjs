import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import fsSync from 'node:fs'
import path from 'node:path'
import { createProcedureStorePre } from '../../lib/procedure-store.js'
import { createScopedHubIoPre } from '../../lib/hub-io.js'
import { auditTemp, mountAuditHost, callAuditRoute } from '../lib/audit-host-fixture.mjs'

const candidate = { title: 'Audited copy workflow', riskLevel: 'low', steps: ['Copy source to destination'],
  successCriteria: ['Destination digest matches'], origin: 'agent' }
const failure = kind => { if (kind === 'throw') { const error = new Error('ENOSPC fixture'); error.code = 'ENOSPC'; throw error }
  return kind === 'false' ? false : { ok: false, error: 'ENOSPC fixture' } }
for (const kind of ['throw', 'false', 'result']) {
  for (const action of ['observe', 'merge', 'addEvidence', 'touch', 'setPinned', 'promote', 'activate', 'deprecate', 'approve', 'aging', 'clear', 'dispose']) {
    let broken = false, clock = 1
    const store = createProcedureStorePre({ now: () => clock,
      io: { save: () => broken ? failure(kind) : { ok: true }, clear: () => broken ? failure(kind) : { ok: true } } })
    const observed = store.observe(action === 'approve' ? { ...candidate, riskLevel: 'high' } : candidate)
    assert.equal(observed.ok, true); assert.equal(observed.persisted, true)
    const pid = observed.procedure.procedureId
    if (['activate', 'aging'].includes(action)) assert.equal(store.promote(pid, {}, { authorizedBy: 'model' }).ok, true)
    if (action === 'aging') { assert.equal(store.activate(pid).ok, true); clock = 1e13 }
    broken = true
    const methods = {
      observe: () => store.observe({ ...candidate, title: 'A second workflow' }),
      merge: () => store.observe(candidate), addEvidence: () => store.addEvidence(pid, { kind: 'seen', sessionRef: 'fixture' }),
      touch: () => store.touch(pid), setPinned: () => store.setPinned(pid, true),
      promote: () => store.promote(pid, {}, { authorizedBy: 'model' }),
      activate: () => store.activate(pid), deprecate: () => store.deprecate(pid),
      approve: () => store.approve(pid), aging: () => store.applyAutomaticTransitions(clock),
      clear: () => store.clear(), dispose: () => store.dispose(),
    }
    const result = methods[action]()
    assert.equal(result.ok, false, kind + ':' + action)
    assert.equal(result.persisted, false)
    assert.ok(store.size >= 1, 'failed commit keeps recoverable in-memory data')
    broken = false
    const retry = action === 'aging' ? store.applyAutomaticTransitions(clock) : methods[action]()
    assert.equal(retry.ok, true, 'recovered commit:' + kind + ':' + action)
    assert.equal(retry.persisted, true)
  }
}
// Dual approval retries persist the first signature without adding it twice.
let dualBroken = false
const dual = createProcedureStorePre({ gates: { highRiskRequiresApproval: true, highRiskDualApproval: true },
  io: { save: () => dualBroken ? { ok: false, error: 'ENOSPC fixture' } : { ok: true } } })
const dualPid = dual.observe({ ...candidate, riskLevel: 'high' }).procedure.procedureId
dualBroken = true
assert.equal(dual.approve(dualPid, 'alice').ok, false)
dualBroken = false
const firstSignature = dual.approve(dualPid, 'alice')
assert.equal(firstSignature.persisted, true)
assert.deepEqual(firstSignature.approvals, ['alice'])
assert.equal(firstSignature.approved, false)
assert.equal(dual.approve(dualPid, 'bob').approved, true)
assert.deepEqual(dual.get(dualPid).approvals, ['alice', 'bob'])
// Actual scoped filesystem failure, actual shipped tool and HTTP review action.
const root = await auditTemp('dam-procedure-commit-')
const host = await mountAuditHost(root)
try {
  let broken = true
  const io = createScopedHubIoPre({ globalDir: path.join(process.env.DSH_HOME, 'memory', 'hub'),
    resolveWorkspace: () => ({ dir: '', key: '' }),
    fsApi: { ...fsSync, renameSync(...args) { if (broken) failure('throw'); return fsSync.renameSync(...args) } } })
  const store = createProcedureStorePre({ io })
  host.engine._memoryHub.stores.procedures = store
  const tool = host.tools.find(tool => tool.name === 'memory_procedure')
  const args = { action: 'write', title: candidate.title, steps: candidate.steps.join('\n'), successCriteria: candidate.successCriteria.join('\n') }
  const failed = await tool.execute(args, {})
  assert.match(failed, /写入失败/); assert.ok(!failed.includes('已写入'))
  assert.equal(store.size, 1); assert.equal(store.getStats().persistFailures, 1)
  broken = false
  assert.match(await tool.execute(args, {}), /已并入/)
  assert.equal(store.size, 1, 'retry reuses the candidate identity')
  assert.ok(fsSync.existsSync(path.join(process.env.DSH_HOME, 'memory', 'hub', 'procedures.json')))
  broken = true
  const pid = store.query()[0].procedureId
  const reviewed = await callAuditRoute(host, 'memory-hub', { action: 'pin', procedureId: pid })
  assert.equal(reviewed.body.ok, false); assert.equal(reviewed.body.persisted, false)
  // Inner batch completion is deferred; the HTTP caller must return outer flush failure.
  host.engine._hubIoFactory = { beginBatch() {}, endBatch: () => ({ ok: false, errors: ['ENOSPC fixture'] }) }
  host.engine._memoryHub.ingestJudgementRows = () => ({ results: [], batch: { ok: true, deferred: true } })
  const fed = await callAuditRoute(host, 'memory-hub', { action: 'feed', rows: [] })
  assert.equal(fed.body.ok, false); assert.equal(fed.body.persisted, false); assert.equal(fed.body.batch.ok, false)
  console.log('PASS procedure commit outcomes, retained candidates, recovery, actual tool/API and outer batch flush')
} finally { host.dispose(); await fs.rm(root, { recursive: true, force: true }) }

import assert from 'node:assert/strict'
import * as fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { createScopedHubIoPre } from '../../lib/hub-io.js'
import { createProcedureStorePre } from '../../lib/procedure-store.js'

let failed = 0
async function check(name, fn) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dam-scoped-durability-'))
  try { await fn(root); console.log('PASS ' + name) }
  catch (e) { failed++; console.error('FAIL ' + name + ': ' + e.message) }
  finally { fs.rmSync(root, { recursive: true, force: true }) }
}
function libraries(root, extra = {}) {
  const globalDir = path.join(root, 'global'), wsDir = path.join(root, 'workspace')
  fs.mkdirSync(globalDir); fs.mkdirSync(wsDir)
  const io = createScopedHubIoPre({ globalDir, resolveWorkspace: () => ({ dir: wsDir, key: 'ws-a' }), ...extra })
  return { io, globalDir, wsDir, globalFile: path.join(globalDir, 'procedures.json'), wsFile: path.join(wsDir, 'procedures.json') }
}
const candidate = { title: 'Durable workspace skill', steps: ['Read the source'], successCriteria: ['Source read'], scope: 'workspace', workspaceRef: 'ws-a', riskLevel: 'high' }

await check('F1 corrupt receiver and donor preserve both original files', root => {
  for (const damaged of ['global', 'workspace']) {
    const sub = path.join(root, damaged); fs.mkdirSync(sub)
    const { io, globalFile, wsFile } = libraries(sub)
    const broken = '{"schemaVersion":1,"procedures":[{"procedureId":"recoverable-original"'
    const healthy = JSON.stringify({ schemaVersion: 1, procedures: [{ procedureId: 'move-me', scope: 'workspace', workspaceRef: 'ws-a' }] })
    fs.writeFileSync(globalFile, damaged === 'global' ? broken : healthy)
    fs.writeFileSync(wsFile, damaged === 'workspace' ? broken : healthy)
    const before = [globalFile, wsFile].map(file => fs.readFileSync(file, 'utf8'))
    const result = io.migrate([{ procedureId: 'move-me', scope: 'global' }])
    assert.equal(result.ok, false)
    assert.deepEqual([globalFile, wsFile].map(file => fs.readFileSync(file, 'utf8')), before)
    assert.equal(result.rolledBack, false, 'no write occurred, so no rollback is claimed')
  }
})

await check('F1 healthy failed donor write restores receiver, then retry succeeds', root => {
  let denied = true, wsFile
  const libs = libraries(root, { fsApi: { renameSync(from, to) {
    if (to === wsFile && denied) { denied = false; throw Object.assign(Error('donor denied'), { code: 'EPERM' }) }
    fs.renameSync(from, to)
  } } })
  wsFile = libs.wsFile
  fs.writeFileSync(libs.globalFile, JSON.stringify({ schemaVersion: 1, procedures: [] }))
  fs.writeFileSync(wsFile, JSON.stringify({ schemaVersion: 1, procedures: [{ procedureId: 'move-me', scope: 'workspace', workspaceRef: 'ws-a' }] }))
  const before = [libs.globalFile, wsFile].map(file => fs.readFileSync(file, 'utf8'))
  const failedMove = libs.io.migrate([{ procedureId: 'move-me', scope: 'global' }])
  assert.equal(failedMove.ok, false)
  assert.equal(failedMove.rolledBack, true)
  assert.deepEqual([libs.globalFile, wsFile].map(file => fs.readFileSync(file, 'utf8')), before)
  assert.equal(libs.io.migrate([{ procedureId: 'move-me', scope: 'global' }]).ok, true)
  assert.equal(JSON.parse(fs.readFileSync(libs.globalFile)).procedures.length, 1)
  assert.equal(JSON.parse(fs.readFileSync(wsFile)).procedures.length, 0)
})

await check('F2 failed workspace persistence is visible and can be retried', root => {
  const { io, wsFile, globalFile } = libraries(root)
  fs.mkdirSync(wsFile)
  const store = createProcedureStorePre({ io })
  const p = store.observe(candidate).procedure
  const approved = store.approve(p.procedureId)
  assert.equal(approved.persisted, false)
  assert.equal(io.lastWrite().wroteWorkspace, false)
  assert.equal(JSON.parse(fs.readFileSync(globalFile)).procedures.length, 0)
  assert.ok(store.getStats().persistFailures > 0)
  assert.ok(store.getStats().lastPersistError)
  fs.rmdirSync(wsFile)
  assert.equal(store.dispose('retry').persisted, true)
  assert.equal(io.load().procedures[0].approved, true)
})

await check('F1 rollback failure remains visible and preserves the donor copy', root => {
  let globalFile, rejectReceiverRead = false, receiverWrites = 0
  const libs = libraries(root, { fsApi: {
    renameSync(from, to) {
      if (to === globalFile && ++receiverWrites > 1) throw Object.assign(Error('rollback denied'), { code: 'EPERM' })
      fs.renameSync(from, to)
      if (to === globalFile) rejectReceiverRead = true
    },
    readFileSync(file, encoding) {
      if (file === globalFile && rejectReceiverRead) { rejectReceiverRead = false; throw Object.assign(Error('verification denied'), { code: 'EACCES' }) }
      return fs.readFileSync(file, encoding)
    },
  } })
  globalFile = libs.globalFile
  fs.writeFileSync(globalFile, JSON.stringify({ schemaVersion: 1, procedures: [] }))
  const donor = JSON.stringify({ schemaVersion: 1, procedures: [{ procedureId: 'move-me', scope: 'workspace', workspaceRef: 'ws-a' }] })
  fs.writeFileSync(libs.wsFile, donor)
  const result = libs.io.migrate([{ procedureId: 'move-me', scope: 'global' }])
  assert.equal(result.ok, false)
  assert.equal(result.rolledBack, false)
  assert.equal(result.results[0].rollbackFailed, true)
  assert.equal(fs.readFileSync(libs.wsFile, 'utf8'), donor)
})

await check('F2 both failures, unknown workspace and corrupt refusal never acknowledge persistence', root => {
  const { io, wsFile, globalFile } = libraries(root)
  fs.mkdirSync(wsFile); fs.mkdirSync(globalFile)
  assert.equal(io.save({ procedures: [candidate] }).ok, false)
  const unknown = createScopedHubIoPre({ globalDir: path.join(root, 'unknown-global'), resolveWorkspace: () => ({ dir: '', key: '' }) })
  const store = createProcedureStorePre({ io: unknown })
  const p = store.observe(candidate).procedure
  assert.equal(store.approve(p.procedureId).persisted, false)
  const corruptDir = path.join(root, 'corrupt'); fs.mkdirSync(corruptDir)
  fs.writeFileSync(path.join(corruptDir, 'procedures.json'), 'broken original')
  const corrupt = createScopedHubIoPre({ globalDir: corruptDir, resolveWorkspace: () => ({ dir: '', key: '' }) })
  corrupt.load()
  assert.equal(corrupt.save({ procedures: [] }).ok, false)
  assert.equal(fs.readFileSync(path.join(corruptDir, 'procedures.json'), 'utf8'), 'broken original')
})

await check('F2 store accepts legacy void saves but respects explicit failed results', () => {
  for (const result of [undefined, { ok: true }, { ok: false, error: 'disk full' }, false]) {
    const store = createProcedureStorePre({ io: { save: () => result } })
    const p = store.observe(candidate).procedure
    assert.equal(store.approve(p.procedureId).persisted, result === undefined || result?.ok === true)
  }
})
if (failed) process.exitCode = 1

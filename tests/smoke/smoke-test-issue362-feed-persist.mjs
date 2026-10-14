import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { tmpdir } from 'node:os'
import { createHubIoPre } from '../../lib/hub-io.js'
import { createProcedureStorePre } from '../../lib/procedure-store.js'
import { createMemoryHubPre } from '../../lib/memory-hub.js'
import { createFactStorePre } from '../../lib/fact-store.js'

const dir = fs.mkdtempSync(path.join(tmpdir(), 'dam-362-'))
let fail = true
try {
  const io = createHubIoPre({ dir, fsApi: { renameSync: (...args) => { if (fail) throw Object.assign(new Error('injected rename failure'), { code: 'EACCES' }); fs.renameSync(...args) } } })
  const procedures = createProcedureStorePre({ io: io('procedures.json') })
  const hub = createMemoryHubPre({ stores: { procedures }, batch: io })
  const rows = [{ kindCandidate: 'procedure_candidate', sourceIds: ['test'], title: 'procedure', excerpt: 'step' }]
  const failed = hub.ingestJudgementRows(rows)
  assert.equal(failed.ok, false)
  assert.equal(failed.persisted, false)
  assert.equal(failed.retryable, true)
  assert.match(failed.batch.errorDetails[0], /EACCES/)
  fail = false
  const retry = hub.ingestJudgementRows(rows)
  assert.equal(retry.ok, true)
  assert.equal(io('procedures.json').load().procedures.length, 1)
  const facts = createFactStorePre({ io: io('facts.json') })
  const factHub = createMemoryHubPre({ stores: { facts }, batch: io })
  const factRows = [{ kindCandidate: 'semantic_candidate', sourceIds: ['fact-fixture'], subject: 'project alpha', predicate: 'runtime version', object: 'Node.js version 24.15.0', confidence: 0.95 }]
  fail = true
  const factFailure = factHub.ingestJudgementRows(factRows)
  assert.equal(factFailure.persisted, false, JSON.stringify(factFailure))
  assert.equal(factFailure.retryable, true)
  assert.match(factFailure.results[0].error, /EACCES/)
  fail = false
  assert.equal(factHub.ingestJudgementRows(factRows).persisted, true)
  assert.equal(io('facts.json').load().facts.length, 1)
  console.log('PASS #362 failed feed exposes the commit error and retry persists once')
} finally { fs.rmSync(dir, { recursive: true, force: true }) }

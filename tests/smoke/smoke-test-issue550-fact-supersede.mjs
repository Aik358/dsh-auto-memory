import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFileSync, renameSync } from 'node:fs'
import path from 'node:path'
import { createFactStorePre, ingestJudgementRows } from '../../lib/fact-store.js'
import { createHubIoPre, createHubIoHealthPre } from '../../lib/hub-io.js'
import { createMemoryHubPre } from '../../lib/memory-hub.js'
import { createHarness } from './_harness.mjs'

const T = createHarness('issue550')
const now = () => 10000
const BASE = { scope: 'Workspace', subject: 'fixture', predicate: 'color', object: 'blue', sourceKind: 'explicit', get provenance() { return ['synthetic-user'] } }
const inference = (object, patch = {}) => ({ ...BASE, object, sourceKind: 'inference', provenance: ['synthetic-observation'], ...patch })
const row = (object, patch = {}) => ({
  kindCandidate: 'semantic_candidate', suggestion: 'supersede_suggest', observationId: 'synthetic-row',
  sourceIds: ['synthetic-observation'], confidence: 0.8,
  scope: BASE.scope, subject: BASE.subject, predicate: BASE.predicate, object, ...patch,
})
const subject = (store) => store.get(BASE.scope, BASE.subject, BASE.predicate)
const full = (store) => store.snapshot({ includeRevoked: true })

function test(label, fn) {
  try { fn(); T.ok(true, label) }
  catch (e) { T.ok(false, label, e.stack || e.message) }
}

function expectProtected(result) {
  assert.equal(result.ok, false)
  assert.equal(result.outcome, 'supersede-blocked')
  assert.equal(result.reason, 'explicit-fact-protected')
}

function diskFixture() {
  const dir = T.tmpdir('dam-550-')
  const file = path.join(dir, 'facts.json')
  const health = createHubIoHealthPre()
  let rejectWrite = false
  const batch = createHubIoPre({ dir, health, fsApi: { renameSync(from, to) {
    if (rejectWrite && to === file) throw Object.assign(new Error('synthetic rename failure'), { code: 'EIO' })
    return renameSync(from, to)
  } } })
  const store = (opts = {}) => createFactStorePre({ ...opts, now, io: batch('facts.json'), conflictsIo: batch('facts-conflicts.json') })
  return { store, batch, health, bytes: () => readFileSync(file), fail(value) { rejectWrite = value } }
}

test('store rejects a conflicting inference with zero fact, conflict or persistence changes', () => {
  let writes = 0
  const s = createFactStorePre({ now, io: { save() { writes++ } } })
  assert.equal(s.upsert(BASE).outcome, 'created')
  const before = full(s)
  const stats = s.getStats()
  for (const value of ['green', null]) {
    expectProtected(s.supersede(inference(value)))
    assert.deepEqual(full(s), before)
    assert.equal(s.conflictCount, 0)
    assert.equal(writes, 1)
    assert.deepEqual(s.getStats(), stats)
  }
})

test('same-value replay does not revoke; a user correction and its history survive replay', () => {
  const s = createFactStorePre({ now })
  const initial = s.upsert(BASE).fact.factId
  const before = full(s)
  assert.equal(s.supersede(inference('blue', { ttl: 20 })).outcome, 'inference-blocked')
  assert.deepEqual(full(s), before)
  const correction = { ...BASE, object: 'green', provenance: ['synthetic-correction'] }
  assert.equal(s.supersede(correction).outcome, 'created')
  assert.equal(s.supersede(correction).outcome, 'merged')
  assert.equal(subject(s).object, 'green')
  assert.deepEqual(subject(s).provenance, ['synthetic-correction'])
  assert.equal(full(s).facts.find(f => f.factId === initial).revoked, true)
  assert.equal(s.getStats().superseded, 1)
  assert.equal(s.getStats().revoked, 1)
  assert.equal(s.supersede(BASE).revived, true)
  assert.equal(subject(s).factId, initial)
  assert.equal(full(s).facts.length, 2)
})

test('team upsert keeps conflict and replay semantics; same value combines sources and keeps user protection', () => {
  const s = createFactStorePre({ now })
  const context = { teamId: 'synthetic-team' }
  const peer = inference('blue', { provenance: ['synthetic-peer'] })
  assert.equal(s.applyTeamChange(peer, { eventId: 'initial' }, context).outcome, 'created')
  const r = s.supersede({ ...BASE, sourceClass: 'workspace-notes' })
  assert.equal(r.outcome, 'merged')
  assert.equal(r.fact.sourceKind, 'explicit')
  assert.deepEqual(r.fact.provenance, ['synthetic-peer', 'synthetic-user'])
  const changes = { eventId: 'new-observation' }
  const before = full(s).facts
  assert.equal(s.applyTeamChange(inference('green'), changes, context).outcome, 'conflict-added')
  assert.equal(s.applyTeamChange(inference('green'), changes, context).outcome, 'duplicate')
  expectProtected(s.supersede(inference('green')))
  assert.deepEqual(full(s).facts, before)
  assert.equal(s.pendingConflicts().length, 1)
})

test('empty and inference-only tuples still accept supersede suggestions', () => {
  const s = createFactStorePre({ now })
  assert.equal(s.supersede(inference('blue')).outcome, 'created')
  assert.equal(s.supersede(inference('blue', { provenance: ['synthetic-confirmation'] })).outcome, 'merged')
  assert.deepEqual(subject(s).provenance, ['synthetic-observation', 'synthetic-confirmation'])
  assert.equal(s.getStats().revoked, 0)
  assert.equal(s.supersede(inference('green')).outcome, 'created')
  assert.equal(subject(s).object, 'green')
  assert.equal(full(s).facts.find(f => f.object === 'blue').revoked, true)
  assert.equal(s.getStats().superseded, 1)
})

test('legacy user-source metadata survives restore without relying on the epistemic label', () => {
  const seed = createFactStorePre({ now })
  seed.upsert({ ...BASE, scope: 'User' })
  const data = full(seed)
  const { sourceKind, ...fact } = data.facts[0]
  for (const metadata of [{ sourceClass: 'user-memory' }, { sourceClass: undefined, origin: 'user' }]) {
    const s = createFactStorePre({ now })
    s.restore({ ...data, facts: [{ ...fact, ...metadata }] })
    const before = full(s)
    expectProtected(s.supersede(inference('green', { scope: 'User', epistemicStatus: 'fact' })))
    assert.deepEqual(full(s), before)
  }
})

test('two live records for a restored tuple do not trigger an arbitrary revocation', () => {
  const s = createFactStorePre({ now })
  const explicit = s.upsert(BASE).fact
  const second = { ...explicit, factId: 'fact_pre_' + 'b'.repeat(32), sourceKind: 'inference', sourceClass: 'semantic-candidate' }
  assert.equal(s.restore({ ...full(s), facts: [second, explicit] }).restored, 2)
  const before = full(s)
  expectProtected(s.supersede(inference('green')))
  assert.equal(s.supersede({ ...BASE, object: 'green' }).reason, 'ambiguous-active-facts')
  assert.deepEqual(full(s), before)
})

test('invalid offer and invalid resulting fact leave an existing value and its saved bytes unchanged', () => {
  let saved = null
  const s = createFactStorePre({ now, factId: (_scope, _subject, _predicate, object) =>
    object === 'green' ? 'invalid-id' : 'fact_pre_' + 'a'.repeat(32), io: { save(data) { saved = JSON.stringify(data) } } })
  assert.equal(s.upsert(BASE).ok, true)
  const before = full(s)
  const bytes = saved
  assert.equal(s.supersede({ ...BASE, object: 42 }).reason, 'invalid:object')
  assert.equal(s.supersede({ ...BASE, object: '?' }).reason, 'not-a-fact-statement')
  const invalid = s.supersede({ ...BASE, object: 'green' })
  assert.equal(invalid.reason, 'fact-invalid:invalid:factId')
  assert.deepEqual(full(s), before)
  assert.equal(saved, bytes)
  assert.equal(s.getStats().revoked, 0)
})

test('an I/O failure without a transaction keeps facts, statistics and saved bytes; retry commits once', () => {
  let failSave = false, saved = null, writes = 0
  const s = createFactStorePre({ now, config: { maxFacts: 1 }, io: { save(data) {
    if (failSave) throw new Error('synthetic save failure')
    saved = JSON.stringify(data)
    writes++
  } } })
  assert.equal(s.upsert(BASE).ok, true)
  const before = full(s), stats = s.getStats(), bytes = saved
  failSave = true
  const correction = { ...BASE, object: 'green' }
  const failure = s.supersede(correction)
  assert.equal(failure.ok, false)
  assert.equal(failure.persisted, false)
  assert.match(failure.persistError, /synthetic save failure/)
  assert.deepEqual(full(s), before)
  assert.deepEqual(s.getStats(), stats)
  assert.equal(s.getLastPrune(), null)
  assert.equal(saved, bytes)
  failSave = false
  assert.equal(s.supersede(correction).persisted, true)
  assert.equal(writes, 2)
  assert.equal(subject(s).object, 'green')
  assert.equal(s.getLastPersistError(), null)
})

test('Hub and both bulk consumers expose the same rejection from a fresh locked disk read', () => {
  const d = diskFixture()
  const stale = d.store()
  const creating = d.store()
  creating.upsert(BASE)
  const disk = d.bytes(), writes = d.health.saves, facts = JSON.parse(disk)
  const hub = createMemoryHubPre({ stores: { facts: stale }, batch: d.batch, now })
  const assertHubRejected = (r) => {
    assert.equal(r.skipped, true)
    assert.equal(r.accepted, false)
    assert.equal(r.outcome, 'supersede-blocked')
    assert.equal(r.storeReason, 'explicit-fact-protected')
    assert.equal(r.consumed, undefined)
  }
  assertHubRejected(hub.ingestJudgement(row('green')))
  const profile = row('green', { kindCandidate: 'profile_candidate', observationId: 'synthetic-profile' })
  const bulk = hub.ingestJudgementRows([profile])
  assert.equal(bulk.ok, false)
  assert.equal(bulk.retryable, false)
  assertHubRejected(bulk.results[0])
  const direct = ingestJudgementRows(stale, [profile])
  expectProtected(direct.results[0])
  assert.equal(ingestJudgementRows(stale, [profile], direct).results[0].reason, 'duplicate')
  assert.equal(hub.getStats().rejectedSemantic, 2)
  assert.equal(hub.getStats().consumedSemantic, 0)
  assert.deepEqual(full(stale), facts)
  assert.deepEqual(d.bytes(), disk)
  assert.equal(d.health.saves, writes)

  const correction = stale.supersede({ ...BASE, object: 'green' })
  assert.equal(correction.persisted, true)
  const after = JSON.parse(d.bytes())
  assert.equal(after.facts.find(f => f.object === 'blue').revoked, true)
  assert.equal(after.facts.find(f => f.object === 'green').sourceKind, 'explicit')
  assert.equal(d.health.saves, writes + 1)
})

test('the real locked I/O keeps both states on failure and standalone bulk permits a retry', () => {
  const d = diskFixture()
  const s = d.store()
  s.upsert(inference('blue'))
  const disk = d.bytes(), offer = row('green')
  s.restore(JSON.parse(disk))
  const facts = full(s), stats = s.getStats()
  d.fail(true)
  const hub = createMemoryHubPre({ stores: { facts: s }, batch: d.batch, now })
  const r = hub.ingestJudgementRows([offer])
  assert.equal(r.ok, false)
  assert.equal(r.persisted, false)
  assert.equal(r.retryable, true)
  assert.equal(r.results[0].consumed, undefined)
  assert.match(r.results[0].error, /synthetic rename failure/)
  const f = ingestJudgementRows(s, [offer])
  assert.equal(f.results[0].ok, false)
  assert.equal(f.results[0].persisted, false)
  assert.equal(f.results[0].retryable, true)
  assert.deepEqual(f.seenObservationIds, [])
  assert.deepEqual(full(s), facts)
  assert.deepEqual(s.getStats(), stats)
  assert.deepEqual(d.bytes(), disk)
  d.fail(false)
  const retried = ingestJudgementRows(s, [offer], f)
  assert.equal(retried.results[0].outcome, 'created')
  assert.equal(subject(s).object, 'green')
  const restored = d.store()
  restored.restore(JSON.parse(d.bytes()))
  assert.deepEqual(JSON.parse(JSON.stringify(full(s))), JSON.parse(JSON.stringify(full(restored))))
  assert.equal(s.getStats().superseded, 1)
})

test('a replacement inside another fact transaction waits for its outer commit or rollback', () => {
  for (const abort of [false, true]) {
    const d = diskFixture()
    let store, before, writes
    const extra = { ...BASE, subject: 'other-fixture', object: 'yellow' }
    store = d.store({ factId(scope, subject, predicate, object) {
      if (subject === extra.subject) {
        assert.equal(store.supersede({ ...BASE, object: 'green' }).ok, true)
        assert.deepEqual(d.bytes(), before)
        assert.equal(d.health.saves, writes)
        if (abort) throw new Error('synthetic outer failure')
      }
      return 'fact_pre_' + createHash('sha256').update(JSON.stringify([scope, subject, predicate, object])).digest('hex').slice(0, 32)
    } })
    assert.equal(store.upsert(BASE).ok, true)
    before = d.bytes()
    writes = d.health.saves
    store.restore(JSON.parse(before))
    const state = full(store), stats = store.getStats()
    const r = store.upsert(extra)
    if (abort) {
      assert.equal(r.ok, false)
      assert.match(r.error, /synthetic outer failure/)
      assert.deepEqual(d.bytes(), before)
      assert.deepEqual(full(store), state)
      assert.deepEqual(store.getStats(), stats)
      assert.equal(d.health.saves, writes)
    } else {
      assert.equal(r.ok, true)
      assert.equal(d.health.saves, writes + 1)
      const after = JSON.parse(d.bytes())
      assert.equal(after.facts.find(f => f.object === 'blue').revoked, true)
      assert.deepEqual(after.facts.filter(f => !f.revoked).map(f => f.object), ['green', 'yellow'])
    }
  }
})

test('replacement commits facts independently of an unrelated pending conflict save', () => {
  let writes = 0, conflictWrites = 0
  const s = createFactStorePre({ now, io: { save() { writes++ } }, conflictsIo: {
    load: () => null,
    save() { conflictWrites++; throw new Error('synthetic conflict save failure') },
  } })
  assert.equal(s.upsert(BASE).ok, true)
  assert.equal(s.upsert({ ...BASE, object: 'orange' }).outcome, 'conflict-added')
  assert.equal(conflictWrites, 1)
  const before = s.conflictsSnapshot()
  assert.equal(s.supersede({ ...BASE, object: 'green' }).persisted, true)
  assert.equal(subject(s).object, 'green')
  assert.deepEqual(s.conflictsSnapshot(), before)
  assert.equal(conflictWrites, 1)
  assert.equal(writes, 3)
})

T.done()

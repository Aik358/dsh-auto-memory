/** Full production engine, isolated state, no real provider or session calls. */
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

const root = mkdtempSync(path.join(tmpdir(), 'dam-continuation-model-'))
for (const name of ['DSH_HOME', 'USERPROFILE', 'HOME']) process.env[name] = root
const { MemoryEngine, flushDiagnostics } = await import('../lib/state-engine.mjs')
let failed = 0, scenarios = 0
const requested = { provider: 'source-provider', model: 'source-model', reasoningEffort: 'high' }

async function scenario(name, selection, expectedStatus, actual = null, source = requested, options = {}) {
  scenarios++
  const e = new MemoryEngine()
  const sid = 'source-' + name, target = sid + '-next'
  const calls = [], finalSource = options.refreshedSource || source
  let created = 0, delivered = 0, selectedRequest, builds = 0
  e.config = { autoContinueEnabled: true, handoffEnabled: !!options.ritual }
  e.buildContinueCarry = async prevSessionId => ({ ok: true, prevSessionId,
    carryText: 'isolated task', ws: root, workspaceId: 'fixture', ...(++builds > 1 ? finalSource : source) })
  e.hostRefreshRitual = async () => {
    calls.push('ritual')
    if (options.dropSelection) delete e._sessionController.selectModel
    return { ok: true, waited: 'updated' }
  }
  e.inheritPermissionForContinue = async () => ({ ok: false })
  e._sessionController = {
    cancel: async () => { calls.push('cancel') },
    create: async () => { calls.push('create'); created++; return { sessionId: target } },
    prompt: async r => { calls.push(r.sessionId === target ? 'deliver' : 'notify'); if (r.sessionId === target) delivered++ },
    ...(selection ? { selectModel: async r => { calls.push('select'); selectedRequest = r; return selection() } } : {}),
  }
  const result = await e.decideAutoContinue('manual', null, sid)
  const state = e.autoContinueState(sid)
  console.log(name, JSON.stringify({ ok: result.ok, delivered, reported: result.model,
    lastOk: state.lastOk?.model, error: result.error, completed: !!state.completed }))
  try {
    assert.equal(result.ok, expectedStatus === 'selected')
    assert.equal(result.modelInheritance.status, expectedStatus)
    const preflightFailed = !source.provider || !source.model || !selection
    const expectedSource = preflightFailed ? source : finalSource
    assert.deepEqual(result.modelInheritance.requested, { provider: expectedSource.provider || '',
      model: expectedSource.model || '', reasoningEffort: expectedSource.reasoningEffort || '' })
    assert.deepEqual(result.modelInheritance.actual, actual)
    assert.deepEqual(state.modelInheritance, result.modelInheritance)
    assert.equal(delivered, result.ok ? 1 : 0)
    assert.equal(state.executing, false)
    assert.equal(state.armed, null)
    assert.equal(builds, options.ritual && !preflightFailed ? 2 : 1)
    if (preflightFailed) assert.deepEqual(calls, [], 'static failure must not cancel or run the ritual')
    else assert.deepEqual(calls, ['cancel', ...(options.ritual ? ['ritual'] : []),
      ...(['unsupported', 'source-unavailable'].includes(expectedStatus) ? [] : ['create', 'select']),
      ...(result.ok ? ['deliver', 'notify'] : [])])
    if (result.ok) {
      assert.deepEqual(selectedRequest, { sessionId: target, ...expectedSource })
      for (const field of ['provider', 'model', 'reasoningEffort']) {
        assert.equal(result[field], actual[field])
        assert.equal(state.lastOk[field], actual[field])
      }
      assert.deepEqual(state.lastOk.modelInheritance, result.modelInheritance)
      assert(state.completed)
      const replay = await e.decideAutoContinue('manual', null, sid)
      assert.deepEqual(replay.modelInheritance, result.modelInheritance)
    } else {
      assert.match(result.error, /model inheritance/)
      assert.equal(state.lastOk, null)
      assert.equal(state.completed, null)
      if (created) {
        assert.equal(result.continuationPending, true)
        assert.equal(result.sessionId, target)
        assert.equal(state.pending.successorId, target)
        const retry = await e.decideAutoContinue('manual', null, sid)
        assert.equal(retry.continuationPending, true)
        assert.equal(retry.sessionId, target)
        const restarted = new MemoryEngine()
        restarted.config = e.config
        restarted._sessionController = e._sessionController
        const afterRestart = await restarted.decideAutoContinue('manual', null, sid)
        assert.equal(afterRestart.continuationPending, true)
        assert.equal(afterRestart.sessionId, target)
      } else {
        assert.equal(state.pending, null)
        assert.equal(result.continuationPending, undefined)
        assert.match(state.error, /model inheritance/)
      }
      for (const field of ['provider', 'model', 'reasoningEffort']) assert.equal(result[field], actual?.[field] || '')
      if (name === 'rejected') assert.match(result.error, /provider\/model not available/)
    }
    assert.equal(created, ['unsupported', 'source-unavailable'].includes(expectedStatus) ? 0 : 1)
    if (!created) {
      // Static failures and post-ritual validation failures must release any
      // reservation so a repaired source/host can retry normally.
      e.config.handoffEnabled = false
      e.buildContinueCarry = async prevSessionId => ({ ok: true, prevSessionId,
        carryText: 'repaired task', ws: root, workspaceId: 'fixture', ...requested })
      e._sessionController.selectModel = async () => ({ selected: requested })
      assert.equal((await e.decideAutoContinue('manual', null, sid)).ok, true)
      assert.equal(created, 1)
      assert.equal(delivered, 1)
    }
  } catch (error) { failed++; console.error('FAIL - ' + name + ': ' + error.message) }
}

async function invalidRefreshedCarry(name, fault) {
  scenarios++
  const e = new MemoryEngine(), calls = []
  const sid = 'source-' + name
  let builds = 0
  e.config = { autoContinueEnabled: true, handoffEnabled: true }
  e.buildContinueCarry = async prevSessionId => ({ ok: true, prevSessionId,
    carryText: 'isolated task', ws: root, workspaceId: 'fixture', ...requested,
    ...(++builds > 1 ? fault : {}) })
  e.hostRefreshRitual = async () => { calls.push('ritual'); return { ok: true } }
  e._sessionController = {
    cancel: async () => { calls.push('cancel') },
    create: async () => { calls.push('create'); throw Error('unexpected creation') },
    prompt: async () => { calls.push('prompt'); throw Error('unexpected delivery') },
    selectModel: async () => ({ selected: requested }),
  }
  const result = await e.decideAutoContinue('manual', null, sid)
  const state = e.autoContinueState(sid)
  try {
    assert.equal(result.ok, false)
    assert.match(result.error, /carry source mismatch/)
    assert.deepEqual(calls, ['cancel', 'ritual'])
    assert.equal(builds, 2)
    assert.equal(state.pending, null)
    assert.equal(state.completed, null)
    assert.equal(state.lastOk, null)
    assert.equal(state.executing, false)
    assert.equal(new MemoryEngine().isContinuedSession(sid), false)
    console.log('ok - ' + name)
  } catch (error) { failed++; console.error('FAIL - ' + name + ': ' + error.message) }
}

try {
  await scenario('success', () => ({ selected: requested }), 'selected', requested)
  await scenario('rejected', () => { throw Error('provider/model not available') }, 'failed')
  await scenario('unsupported', null, 'unsupported')
  await scenario('legacy-void', () => undefined, 'unconfirmed')
  await scenario('rejected-value', () => ({ accepted: false }), 'unconfirmed')
  await scenario('partial-confirmation', () => ({ selected: { model: requested.model } }), 'unconfirmed')
  for (const field of ['provider', 'model', 'reasoningEffort']) {
    const resolved = { ...requested, [field]: 'host-default' }
    await scenario('different-' + field, () => ({ selected: resolved }), 'mismatch', resolved)
  }
  const noEffort = { provider: requested.provider, model: requested.model }
  const hostDefault = { ...requested, reasoningEffort: 'medium' }
  await scenario('default-effort', () => ({ selected: hostDefault }), 'selected', hostDefault, noEffort)
  const missingEffort = { provider: requested.provider, model: requested.model, reasoningEffort: '' }
  await scenario('effort-not-confirmed', () => ({ selected: noEffort }), 'mismatch', missingEffort)
  await scenario('source-unavailable', () => ({ selected: requested }), 'source-unavailable', null, {})
  for (const field of ['provider', 'model']) {
    const missing = { ...requested, [field]: '' }
    await scenario('missing-' + field, () => ({ selected: requested }), 'source-unavailable', null, missing)
    await scenario('refresh-missing-' + field, () => ({ selected: requested }), 'source-unavailable', null,
      requested, { ritual: true, refreshedSource: missing })
  }
  await scenario('preflight-before-ritual', () => ({ selected: requested }), 'source-unavailable', null, {}, { ritual: true })
  await scenario('unsupported-before-ritual', null, 'unsupported', null, requested, { ritual: true })
  await scenario('unsupported-after-ritual', () => ({ selected: requested }), 'unsupported', null,
    requested, { ritual: true, dropSelection: true })
  await scenario('ritual-success', () => ({ selected: requested }), 'selected', requested, requested, { ritual: true })
  const refreshed = { provider: 'refreshed-provider', model: 'refreshed-model', reasoningEffort: 'low' }
  await scenario('refreshed-selection', () => ({ selected: refreshed }), 'selected', refreshed,
    requested, { ritual: true, refreshedSource: refreshed })
  await scenario('refreshed-selection-mismatch', () => ({ selected: requested }), 'mismatch', requested,
    requested, { ritual: true, refreshedSource: refreshed })
  await invalidRefreshedCarry('refreshed-invalid', { ok: false })
  await invalidRefreshedCarry('refreshed-wrong-source', { prevSessionId: 'foreign-source' })
  console.log('continuation-model: ' + (scenarios - failed) + ' passed, ' + failed + ' failed')
} finally {
  await flushDiagnostics()
  rmSync(root, { recursive: true, force: true })
}
process.exitCode = failed ? 1 : 0

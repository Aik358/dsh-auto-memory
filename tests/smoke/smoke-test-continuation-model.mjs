/** Full production engine, isolated state, no real provider or session calls. */
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

const root = mkdtempSync(path.join(tmpdir(), 'dam-continuation-model-'))
for (const name of ['DSH_HOME', 'USERPROFILE', 'HOME']) process.env[name] = root
const { MemoryEngine, flushDiagnostics } = await import('../lib/state-engine.mjs')
let failed = 0
const requested = { provider: 'source-provider', model: 'source-model', reasoningEffort: 'high' }

async function scenario(name, selection, expectedStatus, actual = null, source = requested) {
  const e = new MemoryEngine()
  const sid = 'source-' + name, target = sid + '-next'
  let created = 0, delivered = 0, selectedRequest
  e.config = { autoContinueEnabled: true, handoffEnabled: false }
  e.buildContinueCarry = async prevSessionId => ({ ok: true, prevSessionId,
    carryText: 'isolated task', ws: root, workspaceId: 'fixture', ...source })
  e.inheritPermissionForContinue = async () => ({ ok: false })
  e._sessionController = {
    cancel: async () => {},
    create: async () => { created++; return { sessionId: target } },
    prompt: async r => { if (r.sessionId === target) delivered++ },
    ...(selection ? { selectModel: async r => { selectedRequest = r; return selection() } } : {}),
  }
  const result = await e.decideAutoContinue('manual', null, sid)
  const state = e.autoContinueState(sid)
  console.log(name, JSON.stringify({ ok: result.ok, delivered, reported: result.model,
    lastOk: state.lastOk?.model, error: result.error, completed: !!state.completed }))
  try {
    assert.equal(result.ok, expectedStatus === 'selected')
    assert.equal(result.modelInheritance.status, expectedStatus)
    assert.deepEqual(result.modelInheritance.requested, { provider: source.provider || '',
      model: source.model || '', reasoningEffort: source.reasoningEffort || '' })
    assert.deepEqual(result.modelInheritance.actual, actual)
    assert.deepEqual(state.modelInheritance, result.modelInheritance)
    assert.equal(delivered, result.ok ? 1 : 0)
    if (result.ok) {
      assert.deepEqual(selectedRequest, { sessionId: target, ...source })
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
      } else assert.equal(state.pending, null)
      for (const field of ['provider', 'model', 'reasoningEffort']) assert.equal(result[field], actual?.[field] || '')
      if (name === 'rejected') assert.match(result.error, /provider\/model not available/)
    }
    assert.equal(created, ['unsupported', 'source-unavailable'].includes(expectedStatus) ? 0 : 1)
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
  console.log('continuation-model: ' + (12 - failed) + ' passed, ' + failed + ' failed')
} finally {
  await flushDiagnostics()
  rmSync(root, { recursive: true, force: true })
}
process.exitCode = failed ? 1 : 0

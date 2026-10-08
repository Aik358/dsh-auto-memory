/** Full production engine and real continuation reservations, isolated from personal state. */
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { continuedSourceState } from '../../lib/continuation-state.js'

const root = mkdtempSync(path.join(os.tmpdir(), 'dam-autocont-idle-'))
const previousEnv = Object.fromEntries(['DSH_HOME', 'USERPROFILE', 'HOME'].map(key => [key, process.env[key]]))
for (const key of Object.keys(previousEnv)) process.env[key] = root
const realNow = Date.now
let now = 1800000000000
let flushDiagnostics
try {
  const production = await import('../lib/state-engine.mjs')
  flushDiagnostics = production.flushDiagnostics
  const engine = new production.MemoryEngine()
  engine.config = { ...engine.config, autoContinueEnabled: true, handoffEnabled: false }
  const source = { session: { id: 'session-isolated-source', header: { cwd: root } }, status: 'running' }
  const calls = []
  const controller = {
    cancel: async request => calls.push(['cancel', request.sessionId]),
    create: async () => { calls.push(['create']); return { sessionId: 'isolated-successor' } },
    prompt: async request => calls.push(['prompt', request.sessionId]),
  }
  engine._ctxRef = { get: name => name === 'agents' ? new Map([[source.session.id, source]]) : name === 'sessionController' ? controller : undefined }
  const carry = async sid => ({ ok: true, prevSessionId: sid, carryText: 'isolated task', ws: root })
  engine.buildContinueCarry = carry
  Date.now = () => now
  engine.armAutoContinue(source, { ratio: .9, modelKnown: true }, { awaitIdle: true })
  const intent = engine._autoContState.armed
  now = intent.expiresAt + 1
  await engine.tickAutoContinue()
  assert.deepEqual(calls, [], 'silent source remains running after the initial 35s deadline')
  assert.equal(engine._autoContState.armed, intent)

  // Restart between the first idle check and the final reservation/cancel boundary.
  source.status = 'idle'
  engine.buildContinueCarry = async sid => { source.status = 'running'; return carry(sid) }
  now = intent.expiresAt + 1
  await engine.tickAutoContinue()
  assert.deepEqual(calls, [], 'new source turn during preparation must not be canceled')
  assert.equal(engine._autoContState.armed, intent)
  assert.equal(engine._autoContState.executing, false)
  assert.equal(continuedSourceState(engine.continuedSessionsFile(), engine.waterKey(source.session.id)), null,
    'real pending reservation is released before deferring')
  assert.equal(engine.isContinuedSession(source.session.id), false)

  source.status = 'idle'
  engine.buildContinueCarry = carry
  now = intent.expiresAt + 1
  await engine.tickAutoContinue()
  assert.deepEqual(calls.filter(call => call[0] === 'create'), [['create']])
  assert.equal(engine._autoContState.armed, null)
  assert.equal(engine._autoContState.lastOk.sessionId, 'isolated-successor')
  assert.equal(continuedSourceState(engine.continuedSessionsFile(), engine.waterKey(source.session.id)).status, 'done',
    'idle retry completes the real reservation exactly once')
  console.log('PASS full production engine: silent running source, resumed turn, reservation release, idle retry')
} finally {
  Date.now = realNow
  await flushDiagnostics?.()
  for (const [key, value] of Object.entries(previousEnv)) {
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
  rmSync(root, { recursive: true, force: true })
}

import test, { after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, rename, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { continuationHost, continuationState, armContinuation } from '../lib/continuation-host.js'
import { AgentFixture, ControllerFixture, userMessage, until } from './fixtures/dsh.mjs'
let assertions = 0
const eq = (a, b, message) => { assertions++; assert.deepEqual(a, b, message) }
const roots = []
after(async () => { for (const r of roots) await rm(r, { recursive: true, force: true }); console.log('ASSERTIONS_EXECUTED=' + assertions) })
const sid = 'session-adapter-source'
async function fixture() {
  const directory = await mkdtemp(path.join(tmpdir(), 'pr37-adapter-')); roots.push(directory)
  const agent = new AgentFixture(sid), agents = new Map([[sid, agent]]), controller = new ControllerFixture(agents)
  const hooks = []
  const agentCtx = { on(name, fn) { hooks.push({ name, fn }); return () => {} } }
  agent.scope = { ctx: agentCtx }; agent.ctx = agentCtx
  agent.preStep = payload => {
    const list = hooks.filter(h => h.name === 'agent/pre-step')
    const call = i => i === list.length ? Promise.resolve({ kind: 'enter' }) : list[i].fn(payload, () => call(i + 1))
    return call(0)
  }
  const services = { agents, sessionController: controller }
  const engine = {
    config: { handoffEnabled: true, autoContinueEnabled: true, autoContinueRefreshRitual: false },
    state: {}, _autoContState: { armed: { sessionId: sid, edgeAt: 123, expiresAt: 0 } },
    _ctxRef: { get: name => services[name] }, _continuationGuardInstalled: true,
    hasReliableSessionIdentity: a => !!a.session?.id,
    withAgent: async (a, fn) => { engine.boundSource = a; return fn() },
    buildContinueCarry: async (from, material) => { engine.material = material; return { ok: true, prevSessionId: from, carryText: 'adapter carry', ws: '/workspace' } },
    refreshRitualPrompt: () => 'refresh',
    inheritPermissionPreset: async () => ({ ok: true, preset: 'workspace-write' }),
    isContinuedSession: () => false, markContinuedSession: async (...args) => { engine.marked = args },
  }
  const opts = { directory, atomicReplace: async (f, b) => { await mkdir(path.dirname(f), { recursive: true }); await writeFile(f + '.tmp', b); await rename(f + '.tmp', f) } }
  const host = continuationHost(engine, opts)
  return { engine, services, agent, agents, controller, hooks, opts, host }
}
test('host adapter resolves actual agents/sessionController and binds source runtime', async () => {
  const f = await fixture(), r = await f.host.decide('agree', 123, sid)
  eq(r.ok, true); eq(f.engine.boundSource, f.agent); eq(f.controller.created.size, 1)
  eq(f.controller.deliveries.length, 1); eq(f.engine.marked, [sid, r.sessionId]); eq(f.hooks.length, 1)
  eq(continuationHost(f.engine, f.opts), f.host)
})
test('adapter refuses missing agents despite a convenient _lastAgent', async () => {
  const f = await fixture(); f.services.agents = undefined; f.engine._lastAgent = f.agent
  const r = await f.host.decide('agree', 123, sid)
  eq(r.deferred, true); eq(f.controller.calls.create.length, 0); eq(f.controller.calls.prompt.length, 0)
})
test('adapter requires Agent-owned context, not arbitrary plugin scope', async () => {
  const f = await fixture(); f.agent.ctx = { on() { throw new Error('must not be used') } }
  const r = await f.host.decide('agree', 123, sid)
  eq(r.ok, false); eq(r.error, 'source-owned-guard-unavailable'); eq(f.controller.calls.create.length, 0)
})
test('adapter inspects current public Session instead of reading agent.session.events', async () => {
  const f = await fixture(), events = f.agent.session.events
  Object.defineProperty(f.agent.session, 'seq', { get: () => events.length })
  delete f.agent.session.events
  f.controller.inspect = async (id, signal) => { signal.throwIfAborted(); return { meta: { id }, events: id === sid ? events : structuredClone(f.agents.get(id).session.events) } }
  const r = await f.host.decide('agree', 123, sid)
  eq(r.ok, true); eq(f.controller.calls.prompt.length, 1)
})
test('adapter rejects inspect response with a different session identity', async () => {
  const f = await fixture(); f.controller.inspect = async () => ({ meta: { id: 'session-other' }, events: [] })
  const r = await f.host.decide('agree', 123, sid)
  eq(r.ok, false); eq(f.controller.calls.prompt.length, 0)
})
test('present permission service failure blocks carry; absent optional service is allowed', async () => {
  for (const reason of ['inheritance-failed', 'no-permission-service']) {
    const f = await fixture(); f.engine.inheritPermissionPreset = async () => ({ ok: false, reason })
    const r = await f.host.decide('agree', 123, sid)
    eq(r.ok, reason === 'no-permission-service'); eq(f.controller.calls.prompt.length, reason === 'no-permission-service' ? 1 : 0)
  }
})
test('carry builder cannot silently fall back to another session', async () => {
  const f = await fixture(); f.engine.buildContinueCarry = async () => ({ ok: true, prevSessionId: 'session-other', carryText: 'wrong', ws: '/workspace' })
  const r = await f.host.decide('agree', 123, sid)
  eq(r.ok, false); eq(r.error, 'carry-source-identity-mismatch'); eq(f.controller.calls.create.length, 0)
})
test('Agent-owned guard survives a replacement plugin engine and retains pending messages', async () => {
  const f = await fixture(); const r = await f.host.decide('agree', 123, sid)
  const replacement = { ...f.engine, _continuationCoordinator: undefined, _autoContState: {} }
  const recovered = continuationHost(replacement, f.opts)
  eq((await recovered.decide('manual', 0, sid)).sessionId, r.sessionId)
  eq(f.controller.deliveries.length, 1); eq(f.hooks.length, 1)
  f.agent.followup(userMessage('after-reload'))
  await until(() => f.agent.status === 'idle')
  eq(f.agent.modelStarts, 0); eq(f.agent.inbox.nextTurn.length, 1)
})
test('state is self-scoped; unknown session sees no arm, execution, or last result', async () => {
  const f = await fixture(); f.engine._autoContState.lastOk = { fromSessionId: sid, sessionId: 'session-target', at: 1 }
  f.engine._autoContState.executing = true; f.engine._autoContState.executingFor = sid
  const other = continuationState(f.engine, 'session-other'), unknown = continuationState(f.engine, '')
  eq(other.armed, null); eq(other.lastOk, null); eq(other.executing, false)
  eq(unknown.armed, null); eq(unknown.lastOk, null)
  const self = continuationState(f.engine, sid)
  eq(self.armed.sessionId, sid); eq(self.executing, true); eq(self.enabled, true); eq(self.threshold, 0.75)
  eq(typeof self.armed.leftMs, 'number')
})
test('arming retains an expired intent and never replaces it with another session', async () => {
  const f = await fixture(); const old = f.engine._autoContState.armed
  armContinuation(f.engine, new AgentFixture('session-other'), { ratio: 0.9 }, {}, () => true)
  eq(f.engine._autoContState.armed, old)
  f.engine._autoContState.armed = null
  armContinuation(f.engine, f.agent, { ratio: 0.9 }, {}, () => true)
  eq(f.engine._autoContState.armed.sessionId, sid); eq(f.engine._autoContState.armed.deferCount, 0)
})
test('automatic disabled still permits an explicitly manual request through the same gate', async () => {
  const f = await fixture(); f.engine.config.autoContinueEnabled = false; f.engine._autoContState.armed = null
  f.agent.setRunning(); const r = await f.host.decide('manual', 0, sid)
  eq(r.deferred, true); eq(f.controller.calls.prompt.length, 0)
  await f.agent.finishTurn(); f.engine._autoContState.armed.expiresAt = 0
  eq((await f.host.tick()).ok, true); eq(f.controller.deliveries.length, 1)
})

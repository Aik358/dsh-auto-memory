import test, { after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm, readFile, writeFile, mkdir, rename } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { ContinuationCoordinator, createCheckpointStore, readiness, proveRitual } from '../lib/continuation-safety.js'
import { AgentFixture, ControllerFixture, deferred, until, userMessage, toolResult } from './fixtures/dsh.mjs'
let assertions = 0
const eq = (a, b, message) => { assertions++; assert.deepEqual(a, b, message) }
const yes = (value, message) => { assertions++; assert.ok(value, message) }
const roots = []
after(async () => { for (const root of roots) await rm(root, { recursive: true, force: true }); console.log('ASSERTIONS_EXECUTED=' + assertions) })
const sid = 'session-old'
async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), 'pr37-')); roots.push(root)
  const store = createCheckpointStore(root, { atomicReplace: async (file, bytes) => {
    await mkdir(path.dirname(file), { recursive: true }); await writeFile(file + '.tmp', bytes); await rename(file + '.tmp', file)
  } })
  const old = new AgentFixture(sid)
  old.append('turn/start', { turn: 1 }); old.append('turn/end', { turn: 1, reason: { kind: 'completed' } }); old.turn = 1
  const agents = new Map([[sid, old]]), controller = new ControllerFixture(agents)
  const state = { armed: { sessionId: sid, edgeAt: 10, expiresAt: 0, deferCount: 0 } }
  let serial = 0
  const options = {
    state, store, getAgent: id => agents.get(id), controller,
    readSessionEvents: async id => (await controller.inspect(id)).events,
    buildCarry: async () => ({ ok: true, carryText: 'carry once', ws: '/workspace', contSeq: 7, wsBase: 'project', provider: 'provider', model: 'model' }),
    refreshEnabled: () => false, ritualPrompt: () => 'write PLAN and handoff',
    inheritPermission: async () => ({ ok: true, preset: 'workspace-write' }),
    makeId: () => `00000000-0000-4000-8000-${String(++serial).padStart(12, '0')}`,
    submissionTimeoutMs: 25, ritualTimeoutMs: 30, pollMs: 2, guardInstalled: true,
  }
  let coordinator = new ContinuationCoordinator(options)
  const wire = () => {
    old.preStep = payload => coordinator.guardSource(payload, async () => ({ kind: 'enter' }))
    controller.preStep = payload => coordinator.guardSource(payload, async () => ({ kind: 'enter' }))
  }
  wire()
  return { root, store, old, agents, controller, state, options, get coordinator() { return coordinator },
    restart() { options.state = { armed: { sessionId: sid, edgeAt: 10, expiresAt: 0 } }; coordinator = new ContinuationCoordinator(options); wire(); return coordinator },
    agree() { return coordinator.decide('agree', 10, sid) },
  }
}
const carryCalls = f => f.controller.calls.prompt.filter(r => r.sessionId !== sid)
const carryDeliveries = f => f.controller.deliveries.filter(r => r.sessionId !== sid)

test('T1 running with no recent activity cannot create or prompt', async () => {
  const f = await fixture(); f.old.setRunning(); f.state.armed.awaitIdle = false; f.state.lastActiveAt = 0
  const r = await f.agree(); eq(r.deferred, true); eq(f.controller.calls.create.length, 0); eq(f.controller.calls.prompt.length, 0)
  await f.old.finishTurn()
})
for (const queue of ['next-turn', 'next-step']) test(`T${queue === 'next-turn' ? 2 : 3} idle with ${queue} pending is blocked`, async () => {
  const f = await fixture(); f.old.inbox.append(queue, userMessage('pending'))
  const r = await f.agree(); eq(r.deferred, true); eq(f.controller.calls.create.length, 0); eq(f.controller.calls.prompt.length, 0)
})
test('T4 ten concurrent AND ten sequential agrees have one target and one delivery', async () => {
  const f = await fixture(); await Promise.all(Array.from({ length: 10 }, () => f.agree()))
  for (let i = 0; i < 10; i++) await f.agree()
  eq(f.controller.created.size, 1); eq(carryDeliveries(f).length, 1); eq(carryCalls(f).length, 1)
})
test('T5 heartbeat × agree race enters one executor', async () => {
  const f = await fixture(); await Promise.all([f.coordinator.tick(), f.agree(), f.coordinator.tick()])
  eq(f.controller.created.size, 1); eq(carryDeliveries(f).length, 1)
})
test('T6 create succeeds but response is lost; retry adopts identical explicit identity', async () => {
  const f = await fixture(); f.controller.createModes.push('lost')
  eq((await f.agree()).ok, false); const cp = await f.store.load(sid); yes(cp.newSessionId)
  await f.agree(); eq(f.controller.created.size, 1); eq(new Set(f.controller.calls.create.map(r => r.sessionId)).size, 1)
  eq(carryDeliveries(f).length, 1)
})
test('T7 prompt accepted but response lost; recovery uses receipt without a second call', async () => {
  const f = await fixture(); f.controller.promptModes.push('lost')
  await f.agree(); const recovered = await f.restart().decide('agree', 10, sid)
  eq(recovered.ok, true); eq(carryCalls(f).length, 1); eq(carryDeliveries(f).length, 1)
})
test('T8 ordinary assistant and background PLAN/handoff changes cannot prove ritual', async () => {
  const f = await fixture(); f.options.refreshEnabled = () => true; f.restart()
  f.options.legacyStampProbe = async () => readFile(path.join(f.root, 'PLAN.md'), 'utf8').catch(() => '')
  f.controller.onPrompt = async request => {
    if (request.sessionId !== sid) return
    f.old.append('assistant/message', { message: { content: [{ type: 'text', text: 'ordinary reply' }] } })
    await writeFile(path.join(f.root, 'PLAN.md'), 'background changed')
    await writeFile(path.join(f.root, 'handoff.md'), 'background changed')
  }
  const r = await f.agree(); eq(r.ok, false); eq(f.controller.created.size, 0)
  yes(['timeout', 'uncertain'].includes(r.reason))
  if (f.old.status === 'running') await f.old.finishTurn()
})
for (const phase of ['prepared', 'created', 'submitting', 'delivered']) test(`T9 restart from ${phase} is idempotent`, async () => {
  const f = await fixture()
  const cp = { version: 1, oldSessionId: sid, newSessionId: 'session-resume', requestId: 'resume-rpc', sourceSeq: 1, phase,
    carry: { ok: true, carryText: 'persisted carry', ws: '/workspace' } }
  if (phase !== 'prepared') { await f.controller.create({ sessionId: cp.newSessionId, cwd: '/workspace' }) }
  if (['submitting', 'delivered'].includes(phase)) {
    f.agents.get(cp.newSessionId).inbox.append('next-turn', userMessage(cp.requestId, cp.carry.carryText))
  }
  await f.store.save(sid, cp); const c = f.restart(); await c.decide('agree', 10, sid); await c.decide('agree', 10, sid)
  eq(f.controller.created.size, 1)
  eq(carryCalls(f).length, ['submitting', 'delivered'].includes(phase) ? 0 : 1)
})
test('T9 submitting with no receipt is uncertain, NEVER blindly resubmitted', async () => {
  const f = await fixture(); const cp = { version: 1, oldSessionId: sid, newSessionId: 'session-pending', requestId: 'pending-rpc', sourceSeq: 1, phase: 'submitting', carry: { carryText: 'carry', ws: '/workspace' } }
  await f.store.save(sid, cp)
  for (let i = 0; i < 3; i++) { const r = await f.restart().decide('agree', 10, sid); eq(r.uncertain, true) }
  eq(f.controller.calls.create.length, 0); eq(carryCalls(f).length, 0)
})
test('T10 missing source and unknown public status fail closed', async () => {
  for (const mode of ['missing', 'unknown-status', 'missing-inbox', 'missing-events']) {
    const f = await fixture()
    if (mode === 'missing') f.agents.delete(sid)
    if (mode === 'unknown-status') Object.defineProperty(f.old, 'status', { value: 'unknown' })
    if (mode === 'missing-inbox') f.old.inbox = undefined
    if (mode === 'missing-events') f.old.session.events = undefined
    const r = await f.agree(); yes(!r.ok || r.deferred); eq(f.controller.calls.create.length, 0); eq(f.controller.calls.prompt.length, 0)
  }
})
test('T11 reject after submitting cannot pretend to undo an uncertain delivery', async () => {
  const f = await fixture(); const gate = deferred(); f.controller.promptModes.push({ before: gate })
  const run = f.agree(); await until(() => carryCalls(f).length === 1)
  const rejection = await f.coordinator.decide('reject', 10, sid)
  eq(rejection.ok, false); eq(rejection.rejected, undefined)
  const timed = await run; eq(timed.uncertain, true)
  gate.resolve(); await until(() => carryDeliveries(f).length === 1)
  const again = await f.agree(); eq(again.ok, true); eq(carryCalls(f).length, 1)
})
test('T12 source boundary changes while building carry: final create gate stops it', async () => {
  const f = await fixture(); f.options.buildCarry = async () => {
    f.old.append('assistant/message', { message: { content: [] } }); return { ok: true, carryText: 'stale', ws: '/workspace' }
  }; f.restart()
  const r = await f.agree(); eq(r.deferred, true); eq(f.controller.calls.create.length, 0); eq(carryCalls(f).length, 0)
})
test('T12 source boundary changes during selectModel: final prompt gate stops it', async () => {
  const f = await fixture(); f.controller.onSelect = async () => f.old.append('user/message', userMessage('new-input'))
  const r = await f.agree(); eq(r.deferred, true); eq(carryCalls(f).length, 0)
})
test('M2 sentinel: 600 forced deadlines do not override a running source', async () => {
  const f = await fixture(); f.old.setRunning(); f.state.armed.deferCount = 600
  for (let i = 0; i < 8; i++) { f.state.armed.expiresAt = 0; const r = await f.coordinator.tick(); eq(r.deferred, true) }
  eq(f.controller.created.size, 0); eq(carryCalls(f).length, 0); await f.old.finishTurn()
})
test('busy → idle preserves the request and resumes from the common executor', async () => {
  const f = await fixture(); f.old.setRunning(); eq((await f.agree()).deferred, true)
  await f.old.finishTurn(); f.state.armed.expiresAt = 0; eq((await f.coordinator.tick()).ok, true)
  eq(f.controller.created.size, 1); eq(carryDeliveries(f).length, 1)
})
test('manual, agree, and timeout all use real readiness even with auto disabled', async () => {
  const f = await fixture(); f.old.setRunning()
  eq((await f.coordinator.decide('manual', 0, sid)).deferred, true)
  eq(f.controller.created.size, 0); await f.old.finishTurn()
})
test('missing guard or maintenance capability is not silently accepted', async () => {
  for (const mode of ['guard', 'maintenance']) {
    const f = await fixture()
    if (mode === 'guard') { f.options.guardInstalled = false; f.restart() } else f.old.runMaintenance = undefined
    const r = await f.agree(); eq(r.ok, false); eq(f.controller.created.size, 0)
  }
})
test('two coordinator instances share an in-process source lock', async () => {
  const f = await fixture(); const another = new ContinuationCoordinator({ ...f.options, state: { armed: { sessionId: sid, edgeAt: 10, expiresAt: 0 } } })
  await Promise.all([f.agree(), another.decide('agree', 10, sid)])
  eq(f.controller.created.size, 1); eq(carryDeliveries(f).length, 1)
})
test('reject during known-unsent preparation cancels before prompt', async () => {
  const f = await fixture(); const gate = deferred(); f.controller.onSelect = () => gate.promise
  const run = f.agree(); await until(() => f.controller.calls.selectModel.length === 1)
  const rejected = await f.coordinator.decide('reject', 10, sid); eq(rejected.rejected, true)
  gate.resolve(); await run; eq(carryCalls(f).length, 0)
})
test('late old input during asynchronous prompt admission is preserved but cannot run beside target', async () => {
  const f = await fixture(); const gate = deferred(); f.controller.promptModes.push({ before: gate })
  const run = f.agree(); await until(() => carryCalls(f).length === 1)
  f.old.followup(userMessage('late-user'))
  gate.resolve(); const r = await run; eq(r.ok, true)
  await until(() => f.old.status === 'idle' && f.agents.get(r.sessionId).modelStarts === 1)
  eq(f.old.modelStarts, 0); eq(f.old.inbox.nextTurn.length, 1)
  eq(f.old.inbox.nextTurn[0].source.rpcId, 'late-user'); eq(f.controller.calls.cancel.length, 0)
})
test('prompt caller timeout does not allow retry to overlap the original admission', async () => {
  const f = await fixture(); const gate = deferred(); f.controller.promptModes.push({ before: gate })
  eq((await f.agree()).uncertain, true)
  await f.restart().decide('agree', 10, sid); eq(carryCalls(f).length, 1)
  gate.resolve(); await until(() => carryDeliveries(f).length === 1)
  await f.agree(); eq(carryCalls(f).length, 1); eq(carryDeliveries(f).length, 1)
})
test('receipt remains detectable between inbox claim and user/message append', async () => {
  const f = await fixture(); const gate = deferred()
  f.controller.preStep = () => gate.promise
  f.controller.promptModes.push('lost')
  const r = await f.agree(); eq(r.ok, true); eq(carryCalls(f).length, 1)
  gate.resolve({ kind: 'enter' })
})
test('delivered checkpoint survives a failed secondary latch', async () => {
  const f = await fixture(); f.options.markContinued = async () => { throw Error('latch disk full') }; f.restart()
  await f.agree(); await f.restart().decide('agree', 10, sid)
  eq((await f.store.load(sid)).phase, 'delivered'); eq(carryCalls(f).length, 1)
})
test('a storage error before preparation prevents external effects', async () => {
  const f = await fixture(); f.store.save = async () => { throw Error('disk full') }
  const r = await f.agree(); eq(r.ok, false); eq(f.controller.created.size, 0); eq(carryCalls(f).length, 0)
})
test('a corrupt checkpoint never means no checkpoint', async () => {
  const f = await fixture(); await writeFile(f.store.file(sid), '{bad JSON')
  eq((await f.agree()).ok, false); eq(f.controller.created.size, 0)
})
test('wrong create identity cannot receive carry', async () => {
  const f = await fixture(); f.controller.createModes.push('mismatch')
  eq((await f.agree()).ok, false); eq(carryCalls(f).length, 0)
})
test('unrelated work in adopted target is not fed handoff', async () => {
  const f = await fixture(); f.controller.onCreate = async req => {
    f.agents.get(req.sessionId).inbox.append('next-turn', userMessage('unrelated'))
  }
  eq((await f.agree()).ok, false); eq(carryCalls(f).length, 0)
})
test('explicit negative acknowledgement without receipt may retry the same target', async () => {
  const f = await fixture(); f.controller.promptModes.push('reject')
  eq((await f.agree()).ok, false); eq((await f.store.load(sid)).phase, 'created')
  eq((await f.agree()).ok, true); eq(f.controller.created.size, 1); eq(carryDeliveries(f).length, 1)
})
test('undefined acknowledgement cannot mark delivered', async () => {
  const f = await fixture(); f.controller.promptModes.push('malformed')
  const r = await f.agree(); eq(r.uncertain, true); eq((await f.store.load(sid)).phase, 'submitting')
})
test('source replacement during preparation fails closed', async () => {
  const f = await fixture(); f.controller.onSelect = async () => f.agents.set(sid, new AgentFixture(sid))
  eq((await f.agree()).deferred, true); eq(carryCalls(f).length, 0)
})
test('request payload contains persisted identity, carry, and mode queue', async () => {
  const f = await fixture(); const r = await f.agree(); eq(r.ok, true)
  const cp = await f.store.load(sid), req = carryCalls(f)[0]
  eq(req.sessionId, cp.newSessionId); eq(req.requestId, cp.requestId); eq(req.content[0].text, cp.carry.carryText); eq(req.mode, 'queue')
})

function ritualEvents(rpc = 'ritual-rpc') {
  return [
    { seq: 1, type: 'turn/start', data: { turn: 3 } },
    { seq: 2, type: 'user/message', data: userMessage(rpc) },
    { seq: 3, type: 'tool/call', data: { turn: 3, step: 1, callId: 'call-plan', name: 'memory_note_pre', arguments: '{"kind":"plan"}' } },
    { seq: 4, type: 'tool/result', data: { turn: 3, step: 1, message: toolResult('call-plan') } },
    { seq: 5, type: 'tool/call', data: { turn: 3, step: 1, callId: 'call-handoff', name: 'memory_note_pre', arguments: '{"kind":"handoff"}' } },
    { seq: 6, type: 'tool/result', data: { turn: 3, step: 1, message: toolResult('call-handoff') } },
    { seq: 7, type: 'turn/end', data: { turn: 3, reason: { kind: 'completed' } } },
  ]
}
function ritualRecord(rpc = 'ritual-rpc') {
  return { requestId: rpc, afterSeq: 0, submitted: true, writes: Object.fromEntries(['plan', 'handoff'].map((kind, i) => [kind, {
    sessionId: sid, requestId: rpc, turn: 3, callId: `call-${kind}`, callSeq: 3 + i * 2, path: `/work/${kind}.md`, digest: 'a'.repeat(64),
  }])) }
}
test('ritual proof requires exact RPC, exact turn/end, and both successful tool writes', () => {
  eq(proveRitual(ritualEvents(), sid, ritualRecord()).ok, true)
  eq(proveRitual(ritualEvents('ordinary-rpc'), sid, ritualRecord()).ok, false)
  const events = ritualEvents(); events.at(-1).data.turn = 4; eq(proveRitual(events, sid, ritualRecord()).ok, false)
  const r = ritualRecord(); delete r.writes.plan; eq(proveRitual(ritualEvents(), sid, r).ok, false)
})
test('ritual stamp-only and assistant-count evidence is insufficient', () => {
  const events = [{ seq: 1, type: 'assistant/message', data: {} }, { seq: 2, type: 'turn/end', data: { turn: 3, reason: { kind: 'completed' } } }]
  eq(proveRitual(events, sid, ritualRecord()).ok, false)
})
test('ritual wrong callId, wrong owner, wrong kind, error result, incomplete turn are all rejected', () => {
  for (const mode of ['call', 'session', 'kind', 'result', 'end']) {
    const events = ritualEvents(), r = ritualRecord()
    if (mode === 'call') r.writes.plan.callId = 'other'
    if (mode === 'session') r.writes.plan.sessionId = 'another'
    if (mode === 'kind') events[2].data.arguments = '{"kind":"note"}'
    if (mode === 'result') events[3].data.message.content[0].isError = true
    if (mode === 'end') events.pop()
    eq(proveRitual(events, sid, r).ok, false, mode)
  }
})
test('ritual second user and later source turn invalidate earlier completion', () => {
  const events = ritualEvents(); events.splice(2, 0, { seq: 2.5, type: 'user/message', data: userMessage('intruder') })
  eq(proveRitual(events, sid, ritualRecord()).ok, false)
  eq(proveRitual([...ritualEvents(), { seq: 8, type: 'turn/start', data: { turn: 4 } }], sid, ritualRecord()).ok, false)
})
test('reject remains false after successful delivery and after restart', async () => {
  const f = await fixture(); await f.agree()
  eq((await f.coordinator.decide('reject', 10, sid)).ok, false)
  eq((await f.restart().decide('reject', 10, sid)).ok, false)
})
test('checkpoint file key cannot escape its directory', async () => {
  const f = await fixture(); const file = f.store.file('../../escape')
  eq(path.dirname(file), f.root); yes(/^[0-9a-f]{64}\.json$/.test(path.basename(file)))
})

test('reject racing first checkpoint persistence leaves a durable cancellation tombstone', async () => {
  const f = await fixture(); const gate = deferred(); const save = f.store.save; let started = false
  f.store.save = async (id, cp) => {
    if (!started) { started = true; await gate.promise }
    return save(id, cp)
  }
  const run = f.agree(); await until(() => started)
  const rejection = await f.coordinator.decide('reject', 10, sid)
  eq(rejection.rejected, true); gate.resolve(); await run
  eq((await f.store.load(sid)).cancelled, true)
  await f.restart().tick(); eq(f.controller.created.size, 0); eq(carryCalls(f).length, 0)
})
test('reject racing create completion survives restart and a stale checkpoint save', async () => {
  const f = await fixture(); const gate = deferred(); f.controller.onCreate = () => gate.promise
  const run = f.agree(); await until(() => f.controller.calls.create.length === 1)
  const rejection = await f.coordinator.decide('reject', 10, sid); eq(rejection.rejected, true)
  gate.resolve(); await run; eq((await f.store.load(sid)).cancelled, true)
  await f.restart().tick(); eq(carryCalls(f).length, 0)
  f.controller.onCreate = null
  const manual = await f.coordinator.decide('manual', 0, sid); eq(manual.ok, true)
  eq(f.controller.created.size, 1); eq(carryDeliveries(f).length, 1)
})
test('create caller timeout then late success keeps one reserved session identity', async () => {
  const f = await fixture(); const gate = deferred(); f.controller.onCreate = () => gate.promise
  eq((await f.agree()).ok, false)
  f.controller.onCreate = null; gate.resolve(); eq((await f.agree()).ok, true)
  eq(f.controller.created.size, 1); eq(new Set(f.controller.calls.create.map(x => x.sessionId)).size, 1)
  eq(carryDeliveries(f).length, 1)
})
async function finishRealRitual(f, { tamper = false, omit = '', wrongCall = false } = {}) {
  await until(() => f.old.modelStarts > 0)
  const turn = f.old.turn
  for (const kind of ['plan', 'handoff']) {
    if (kind === omit) continue
    const callId = 'call-' + kind, name = 'memory_note_pre', file = path.join(f.root, kind + '.md'), final = '# ' + kind + '\nupdated in ritual\n'
    f.old.append('tool/call', { turn, step: 1, callId, name, arguments: JSON.stringify({ kind, content: final }) })
    await writeFile(file, final)
    eq(await f.coordinator.recordWrite({ agent: f.old, callId: wrongCall ? 'unrelated-call' : callId, name }, kind,
      { ok: true, path: file, final }), !wrongCall)
    f.old.append('tool/result', { turn, step: 1, message: toolResult(callId) })
    if (tamper) await writeFile(file, 'unrelated background replacement')
  }
  await f.old.finishTurn()
}
test('real causal ritual path records actual tool writes and completed request-owned turn', async () => {
  const f = await fixture(); f.options.refreshEnabled = () => true; f.options.ritualTimeoutMs = 100; f.restart()
  const task = f.agree(); await finishRealRitual(f); const result = await task
  eq(result.ok, true); eq(result.refreshRitual, 'updated'); eq(carryDeliveries(f).length, 1)
  const cp = await f.store.load(sid); yes(cp.ritual.writes.plan.digest); yes(cp.ritual.writes.handoff.digest)
  eq(f.controller.calls.prompt[0].requestId, cp.ritual.requestId)
  eq(f.controller.calls.prompt[1].requestId, cp.requestId)
})
for (const mode of ['tamper', 'omit', 'wrongCall']) test(`ritual cannot claim success with ${mode} material ownership`, async () => {
  const f = await fixture(); f.options.refreshEnabled = () => true; f.options.ritualTimeoutMs = 70; f.restart()
  const task = f.agree(); await finishRealRitual(f, { tamper: mode === 'tamper', omit: mode === 'omit' ? 'handoff' : '', wrongCall: mode === 'wrongCall' })
  const result = await task; eq(result.ok, false); eq(f.controller.created.size, 0)
})
test('ritual accepted with lost response is proved from events without duplicate ritual delivery', async () => {
  const f = await fixture(); f.options.refreshEnabled = () => true; f.options.ritualTimeoutMs = 100; f.restart(); f.controller.promptModes.push('lost')
  const task = f.agree(); await finishRealRitual(f); eq((await task).ok, true)
  await f.restart().decide('agree', 10, sid)
  eq(f.controller.deliveries.filter(x => x.sessionId === sid).length, 1); eq(carryDeliveries(f).length, 1)
})
test('explicit negative ritual acknowledgement remains safely retryable without new request identity', async () => {
  const f = await fixture(); f.options.refreshEnabled = () => true; f.options.ritualTimeoutMs = 100; f.restart(); f.controller.promptModes.push('reject')
  eq((await f.agree()).ok, false); const id = (await f.store.load(sid)).ritual.requestId
  const task = f.agree(); await finishRealRitual(f); eq((await task).ok, true)
  eq(f.controller.calls.prompt[1].requestId, id)
})

test('busy exception is uncertain unless there is an actual admission receipt', async () => {
  const f = await fixture(); f.controller.promptModes.push('busy')
  eq((await f.agree()).uncertain, true); eq((await f.store.load(sid)).phase, 'submitting')
  await f.restart().decide('agree', 10, sid); eq(carryCalls(f).length, 1)
})
test('ritual rejects uncorrelated user input even when it has no RPC identity', () => {
  const events = ritualEvents()
  const user = userMessage('injected'); delete user.source.rpcId
  // Insert at the exact same turn and renumber both events and the recorded call seqs.
  events.splice(2, 0, { seq: 2, type: 'user/message', data: user })
  events.forEach((e, i) => { e.seq = i })
  const r = ritualRecord(); r.writes.plan.callSeq++; r.writes.handoff.callSeq++
  eq(proveRitual(events, sid, r).ok, false)
})
test('plugin-injected scaffolding inside the ritual turn does not invalidate the proof', () => {
  // A real host splices its own system-prompt/memory snapshot into every turn as a
  // role=user message whose source.kind is 'plugin' (observed on a live DSH session,
  // seq=23: {kind:'plugin', plugin:'@deepseek-ai/dsh-system-prompt', form:'snapshot'}).
  // That is not user input. Treating it as intruding input made the ritual proof
  // unsatisfiable whenever the ritual prompt was delivered, so every continuation
  // deferred as 'timeout' even though the model completed both writes.
  const events = ritualEvents()
  events.splice(2, 0, { seq: 0, type: 'user/message', data: {
    id: 'snapshot-1', role: 'user', content: [{ type: 'text', text: 'Current runtime context.' }],
    source: { kind: 'plugin', plugin: '@deepseek-ai/dsh-system-prompt', form: 'snapshot' },
  } })
  events.forEach((e, i) => { e.seq = i + 1 })
  const r = ritualRecord(); r.writes.plan.callSeq++; r.writes.handoff.callSeq++
  eq(proveRitual(events, sid, r).ok, true)
})
test('cosmetic rename failure is fail-soft and cannot duplicate carry', async () => {
  const f = await fixture(); f.controller.onRename = async () => { throw new Error('rename unavailable') }
  eq((await f.agree()).ok, true); await f.agree(); eq(carryDeliveries(f).length, 1)
})
test('actual create payload preserves agentPreset and never mixes workspaceId with cwd', async () => {
  for (const useWorkspace of [true, false]) {
    const f = await fixture(); f.options.buildCarry = async () => ({ ok: true, carryText: 'carry', ws: '/workspace',
      workspaceId: useWorkspace ? 'ws-official' : '', agentPreset: 'default', provider: 'p', model: 'm', reasoningEffort: 'high' }); f.restart()
    eq((await f.agree()).ok, true)
    const c = f.controller.calls.create[0]
    eq(c.agentPreset, 'default'); eq(c.workspaceId, useWorkspace ? 'ws-official' : undefined); eq(c.cwd, useWorkspace ? undefined : '/workspace')
    eq(f.controller.calls.selectModel[0].reasoningEffort, 'high')
  }
})

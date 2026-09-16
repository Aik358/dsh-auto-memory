import test from 'node:test'
import assert from 'node:assert/strict'
import { AgentFixture, ControllerFixture, deferred, until, userMessage } from './fixtures/dsh.mjs'
let assertions = 0
const eq = (actual, expected) => { assertions++; assert.deepEqual(actual, expected) }
process.on('exit', () => console.log('ASSERTIONS_EXECUTED=' + assertions))
test('fixture exposes idle/running, both queues, whenIdle, and explicit completion', async () => {
  const a = new AgentFixture('session-a')
  eq(a.status, 'idle'); eq(a.inbox.nextTurn.length, 0); eq(a.inbox.nextStep.length, 0)
  a.setRunning(); let idle = false; const wait = a.whenIdle().then(() => { idle = true })
  eq(a.status, 'running'); eq(idle, false)
  await a.finishTurn(); await wait; eq(idle, true); eq(a.status, 'idle')
})
test('maintenance reports idle but synchronously excludes another reservation', async () => {
  const a = new AgentFixture('session-a'); const gate = deferred()
  const work = a.runMaintenance(() => gate.promise)
  eq(a.status, 'idle'); assertions++; assert.throws(() => a.runMaintenance(async () => {}))
  a.followup(userMessage('u')); eq(a.inbox.nextTurn.length, 1); eq(a.modelStarts, 0)
  gate.resolve(); await work; await until(() => a.modelStarts === 1); eq(a.status, 'running')
  await a.finishTurn()
})
test('controller create is idempotent after effect with lost response', async () => {
  const c = new ControllerFixture(new Map()); c.createModes.push('lost')
  assertions++; await assert.rejects(c.create({ sessionId: 'session-new' }))
  eq((await c.create({ sessionId: 'session-new' })).sessionId, 'session-new'); eq(c.created.size, 1)
})
test('controller records full request and durable request receipt survives lost response', async () => {
  const a = new AgentFixture('session-new', { autoRun: false }); const c = new ControllerFixture(new Map([[a.id, a]]))
  const request = { sessionId: a.id, requestId: 'rpc-a', mode: 'queue', content: [{ type: 'text', text: 'carry' }] }
  c.promptModes.push('lost'); assertions++; await assert.rejects(c.prompt(request, new AbortController().signal))
  eq(c.calls.prompt[0], request); eq((await c.prompt(request, new AbortController().signal)).accepted, true); eq(c.deliveries.length, 1)
})
test('fixture really models host concurrent-admission dedup gap, not a stronger fake API', async () => {
  const a = new AgentFixture('session-new', { autoRun: false }); const c = new ControllerFixture(new Map([[a.id, a]]))
  const gate = deferred(); c.promptModes.push({ before: gate }, { before: gate })
  const request = { sessionId: a.id, requestId: 'same', mode: 'queue', content: [{ type: 'text', text: 'carry' }] }
  const one = c.prompt(request, new AbortController().signal), two = c.prompt(request, new AbortController().signal); gate.resolve(); await Promise.all([one, two])
  eq(c.deliveries.length, 2)
})
test('pre-step fixture claims input before invoking a rejecting guard', async () => {
  const a = new AgentFixture('session-a', { preStep: async payload => {
    eq(payload.agent.inbox.nextTurn.length, 0); eq(payload.messages.length, 1)
    payload.agent.inbox.prepend('next-turn', payload.messages[0]); return { kind: 'reject' }
  } })
  a.followup(userMessage('u')); await until(() => a.status === 'idle')
  eq(a.modelStarts, 0); eq(a.inbox.nextTurn.length, 1); eq(a.session.events.at(-1).data.reason.kind, 'blocked')
})

test('public prompt requires a signal and honors pre-admission abort', async () => {
  const c = new ControllerFixture(new Map())
  assertions++; await assert.rejects(c.prompt({}), TypeError)
  const abort = new AbortController(); abort.abort(new Error('caller-aborted'))
  assertions++; await assert.rejects(c.prompt({}, abort.signal), /caller-aborted/)
  eq(c.calls.prompt.length, 0)
})
test('same RPC does not mean same message id; inbox rejects duplicate message identity', () => {
  const a = new AgentFixture('session-a', { autoRun: false })
  const one = userMessage('same'), two = userMessage('same')
  eq(one.id === two.id, false)
  a.inbox.append('next-turn', one); a.inbox.append('next-turn', two)
  assertions++; assert.throws(() => a.inbox.append('next-step', one), /duplicate pending/)
  eq(a.inbox.nextTurn.length, 2); eq(a.inbox.nextStep.length, 0)
})

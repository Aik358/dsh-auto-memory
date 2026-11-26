import assert from 'node:assert/strict'
import { getEventListeners } from 'node:events'
import { test } from 'node:test'
import { SessionRecallQueue } from '../../lib/session-recall-queue.js'

function manualClock() {
  let now = 0
  let sequence = 0
  const timers = new Map()
  return {
    now: () => now,
    setTimer(callback, delay) {
      const id = sequence++
      timers.set(id, { callback, at: now + delay })
      return id
    },
    clearTimer: id => timers.delete(id),
    get pending() { return timers.size },
    advance(ms) {
      const end = now + ms
      for (;;) {
        const entry = [...timers].filter(([, timer]) => timer.at <= end).sort((a, b) => a[1].at - b[1].at)[0]
        if (!entry) break
        const [id, timer] = entry
        timers.delete(id)
        now = timer.at
        timer.callback()
      }
      now = end
    },
  }
}

const turn = () => new Promise(resolve => setImmediate(resolve))
const coded = (code, other = {}) => Object.assign(new Error('private host text'), { code, ...other })
const empty = { items: [] }
const query = (text, workspace = 'w1') => ({ query: text, workspace, limit: 8 })
const status = name => ({ status: name })
const deadline = { status: 'timeout', code: 'SESSION_QUERY_DEADLINE_EXCEEDED' }
const blocked = { code: 'SESSION_QUERY_CHANNEL_BLOCKED', stage: 'drain', elapsedMs: 95 }
const faultResult = (fault, name = 'breaker-open') => ({ status: name, code: fault.code, fault })

function fixture(options = {}, hostOverrides = {}) {
  const clock = manualClock()
  const calls = []
  const faults = []
  const host = {
    searchSessions(request, options) {
      assert.equal(this, host)
      return new Promise((resolve, reject) => calls.push({ request, options, resolve, reject }))
    },
    ...hostOverrides,
  }
  const queue = new SessionRecallQueue(host, {
    queueMs: 30, executionMs: 50, drainMs: 40, cooldownMs: 60,
    now: clock.now, setTimer: clock.setTimer, clearTimer: clock.clearTimer,
    onFault: fault => faults.push(fault), ...options,
  })
  return { queue, clock, calls, faults }
}

test('real import handles absent service, legacy options and ready or partial committed pages', async () => {
  const request = query('first')
  assert.deepEqual(await new SessionRecallQueue(null).submit(request), status('unavailable'))
  const legacy = fixture({}, { committedSearchVersion: '1' })
  const done = legacy.queue.submit(request)
  await turn()
  assert.deepEqual(Object.keys(legacy.calls[0].options), ['signal'])
  legacy.calls[0].resolve(empty)
  assert.deepEqual(await done, { status: 'no-hit', page: empty })

  const { queue, calls, faults, clock } = fixture({}, { committedSearchVersion: 1 })
  const samples = [
    [{ items: ['visible match'] }, 'hit', true],
    [{ items: [], indexStatus: 'ready', indexedSessions: 0 }, 'index-empty', true],
    [{ items: [], indexedSessions: 4, total: 0 }, 'no-hit', true],
    [{ items: [], indexStatus: 'building' }, 'index-building', true],
    [{ items: ['partial'], indexStatus: 'stale' }, 'index-stale', true],
    [{ indexStatus: 'building' }, 'index-building', false],
    [{ items: ['unusable'], indexStatus: 'unavailable' }, 'unavailable', false],
  ]
  for (const [page, expected, returnPage] of samples) {
    const result = queue.submit(request)
    await turn()
    assert.strictEqual(calls.at(-1).request, request)
    assert.equal(calls.at(-1).options.consistency, 'committed')
    assert.ok(calls.at(-1).options.signal instanceof AbortSignal)
    calls.at(-1).resolve(page)
    assert.deepEqual(await result, returnPage ? { status: expected, page } : { status: expected })
  }
  const malformed = queue.submit(request)
  await turn()
  calls.at(-1).resolve({ items: ['unexpected'], indexStatus: 'private-invalid-state' })
  assert.deepEqual(await malformed, { status: 'request-failed', code: 'SESSION_QUERY_INVALID_RESPONSE' })
  assert.deepEqual(faults, [])
  assert.equal(clock.pending, 0)
})

test('sync throws and async rejects preserve only allowlisted error metadata', async () => {
  const poisonedMessage = Object.defineProperty(new Error(), 'message', { get() { assert.fail('message read') } })
  const samples = [
    [coded('SESSION_QUERY_SEARCH_DISABLED', { cause: coded('SQLITE_CORRUPT') }), 'disabled', 'SESSION_QUERY_SEARCH_DISABLED'],
    [coded('SESSION_QUERY_TOOL_UNAUTHORIZED'), 'denied', 'SESSION_QUERY_TOOL_UNAUTHORIZED'],
    [coded('SESSION_QUERY_ABORTED', { cause: coded('SQLITE_NOTADB') }), 'cancelled', 'SESSION_QUERY_ABORTED'],
    [new DOMException('private AbortError request', 'AbortError'), 'cancelled', 'SESSION_QUERY_ABORTED'],
    [coded('SESSION_QUERY_INVALID_QUERY', { cause: coded('SQLITE_CORRUPT') }), 'request-failed', 'SESSION_QUERY_INVALID_QUERY'],
    [coded('SESSION_QUERY_STALE_CURSOR'), 'request-failed', 'SESSION_QUERY_STALE_CURSOR'],
    [coded('SESSION_QUERY_PERSISTENCE_FAILED', { cause: coded('EBUSY') }), 'request-failed', 'SESSION_QUERY_PERSISTENCE_FAILED'],
    [coded('SESSION_QUERY_INDEX_FAILED', { cause: coded('EACCES', { cause: coded('SQLITE_NOTADB') }) }), 'request-failed', 'SESSION_QUERY_INDEX_FAILED'],
    [coded('EBUSY', { errcode: 11 }), 'request-failed', 'EBUSY'],
    [coded('ERR_SQLITE_ERROR', { errcode: '26' }), 'request-failed', 'SESSION_QUERY_UNKNOWN'],
    [coded('ERR_SQLITE_ERROR', { errcode: 5 }), 'request-failed', 'SESSION_QUERY_UNKNOWN'],
    [coded('SESSION_QUERY_PRIVATE', { cause: coded('SQLITE_CORRUPT') }), 'request-failed', 'SESSION_QUERY_UNKNOWN'],
    [new Error('SQLITE_CORRUPT SESSION_QUERY_SEARCH_DISABLED'), 'request-failed', 'SESSION_QUERY_UNKNOWN'],
    [poisonedMessage, 'request-failed', 'SESSION_QUERY_UNKNOWN'],
  ]
  let call = 0
  const { queue, faults } = fixture({}, {
    searchSessions() {
      const i = call++
      if (i >= samples.length) return empty
      if (i % 2 === 0) throw samples[i][0]
      return Promise.reject(samples[i][0])
    },
  })
  for (const [i, [, expected, code]] of samples.entries()) {
    assert.deepEqual(await queue.submit(query(String(i))), { status: expected, code })
  }
  assert.deepEqual(await queue.submit(query('recovered normally')), { status: 'no-hit', page: empty })
  assert.deepEqual(faults, [])
})

test('FIFO coalesces exact keys, preserves order and never caches outcomes', async () => {
  const { queue, calls, clock } = fixture()
  const controller = new AbortController()
  const req = query('same')
  const a = queue.submit(req, { key: 'auth1:w1:visible:legacy:same', signal: controller.signal })
  const b = queue.submit(req, { key: 'auth1:w1:visible:legacy:same' })
  const c = queue.submit(query('same', 'w2'), { key: 'auth1:w2:visible:legacy:same' })
  const d = queue.submit(req, { key: 'auth1:w1:other-view:legacy:same' })
  const e = queue.submit(req)
  const f = queue.submit(req)
  await turn()
  controller.abort('private reason')
  assert.deepEqual(await a, status('cancelled'))
  assert.equal(getEventListeners(controller.signal, 'abort').length, 0)
  assert.equal(calls[0].options.signal.aborted, false)
  for (const [i, result] of [b, c, d, e, f].entries()) {
    assert.equal(calls.length, i + 1)
    const page = { items: [i] }
    calls[i].resolve(page)
    assert.deepEqual(await result, { status: 'hit', page })
    await turn()
  }
  assert.deepEqual(calls.map(call => call.request.workspace), ['w1', 'w2', 'w1', 'w1', 'w1'])
  const reuseKey = queue.submit(req, { key: 'auth1:w1:visible:legacy:same' })
  await turn()
  assert.equal(calls.length, 6)
  calls[5].resolve(empty)
  await reuseKey
  assert.equal(clock.pending, 0)
})

test('queue and subscriber limits reserve independent bounded capacity', async () => {
  const { queue, calls, clock, faults } = fixture({ maxQueued: 1, maxSubscribers: 2 })
  const first = queue.submit(query('running'), { key: 'running' })
  const controller = new AbortController()
  const shared = queue.submit(query('running'), { key: 'running', signal: controller.signal })
  const waiting = queue.submit(query('waiting'))
  assert.deepEqual(await queue.submit(query('running'), { key: 'running' }), status('queue-full'))
  assert.deepEqual(await queue.submit(query('overflow')), status('queue-full'))
  controller.abort()
  assert.deepEqual(await shared, status('cancelled'))
  const replacement = queue.submit(query('running'), { key: 'running' })
  clock.advance(30)
  assert.deepEqual(await waiting, status('queue-timeout'))
  assert.equal(calls.length, 1)
  calls[0].resolve(empty)
  for (const result of [first, replacement]) assert.deepEqual(await result, { status: 'no-hit', page: empty })
  assert.equal(clock.pending, 0)
  assert.deepEqual(faults, [])
})

test('authorization is per subscriber before dispatch and before a shared page is returned', async () => {
  const { queue, calls } = fixture()
  let aAllowed = true
  let bAllowed = true
  const incumbent = queue.submit(query('running'))
  const a = queue.submit(query('shared'), { key: 'shared', authorize: () => aAllowed })
  const b = queue.submit(query('shared'), { key: 'shared', authorize: () => bAllowed })
  const c = queue.submit(query('shared'), { key: 'shared', authorize: () => true })
  aAllowed = false
  await turn()
  calls[0].resolve(empty)
  await incumbent
  await turn()
  assert.deepEqual(await a, status('denied'))
  assert.equal(calls.length, 2)
  bAllowed = false
  const page = { items: ['visible match'] }
  calls[1].resolve(page)
  assert.deepEqual(await b, status('denied'))
  assert.deepEqual(await c, { status: 'hit', page })
  assert.deepEqual(await queue.submit(query('throw'), { authorize() { throw coded('SQLITE_NOTADB') } }), status('denied'))
  assert.deepEqual(await queue.submit(query('wrong type'), { authorize: () => 'truthy' }), status('denied'))
  assert.deepEqual(await queue.submit(query('async auth'), { authorize: async () => { throw new Error('private') } }), status('denied'))
  assert.equal(calls.length, 2)
})

test('cancel before dispatch and remove an all-denied queued job', async () => {
  const { queue, calls, clock } = fixture()
  const controller = new AbortController()
  const cancelled = queue.submit(query('selected'), { key: 'selected', signal: controller.signal })
  controller.abort()
  assert.deepEqual(await cancelled, status('cancelled'))
  assert.equal(calls.length, 0)
  assert.equal(getEventListeners(controller.signal, 'abort').length, 0)

  let allowed = true
  const active = queue.submit(query('running'))
  const denied = queue.submit(query('revoked'), { authorize: () => allowed })
  const waitingSignal = new AbortController()
  const waiting = queue.submit(query('queued'), { signal: waitingSignal.signal })
  waitingSignal.abort()
  assert.deepEqual(await waiting, status('cancelled'))
  assert.equal(getEventListeners(waitingSignal.signal, 'abort').length, 0)
  allowed = false
  await turn()
  calls[0].resolve(empty)
  await active
  assert.deepEqual(await denied, status('denied'))
  assert.equal(calls.length, 1)
  assert.equal(clock.pending, 0)
})

test('queue wait does not consume the execution budget', async () => {
  const { queue, calls, clock, faults } = fixture({ queueMs: 100 })
  const first = queue.submit(query('first'))
  const waiting = queue.submit(query('waiting'))
  await turn()
  clock.advance(49)
  calls[0].resolve(empty)
  await first
  await turn()
  clock.advance(49)
  assert.equal(calls[1].options.signal.aborted, false)
  clock.advance(1)
  assert.deepEqual(await waiting, deadline)
  assert.equal(calls[1].options.signal.aborted, true)
  assert.deepEqual(faults, [])
  calls[1].resolve(empty)
})

test('one execution timeout retains its lease, and a late permanent rejection stays local to the expired call', async () => {
  const { queue, calls, clock, faults } = fixture()
  const active = queue.submit(query('slow'), { key: 'slow' })
  await turn()
  clock.advance(50)
  assert.deepEqual(await active, deadline)
  assert.equal(calls[0].options.signal.aborted, true)
  const beforeDrain = queue.submit(query('queued before drain'))
  clock.advance(30)
  assert.deepEqual(await beforeDrain, status('queue-timeout'))
  assert.equal(calls.length, 1)
  assert.deepEqual(faults, [])
  const retry = queue.submit(query('retry'))
  calls[0].reject(coded('SQLITE_CORRUPT'))
  await turn()
  assert.equal(calls.length, 2)
  calls[1].resolve(empty)
  assert.deepEqual(await retry, { status: 'no-hit', page: empty })
  assert.deepEqual(faults, [])
})

test('legacy blockage requires an expired valid distinct waiter and the same lease past drain', async () => {
  const { queue, calls, clock, faults } = fixture()
  const active = queue.submit(query('hung'), { key: 'hung' })
  await turn()
  clock.advance(50)
  assert.deepEqual(await active, deadline)
  clock.advance(15)
  const witness = queue.submit(query('witness'), { key: 'witness' })
  clock.advance(1)
  const following = queue.submit(query('following'))
  clock.advance(28)
  assert.deepEqual(faults, [])
  clock.advance(1)
  assert.deepEqual(await witness, faultResult(blocked))
  assert.deepEqual(await following, faultResult(blocked))
  assert.deepEqual(faults, [blocked])
  assert.deepEqual(await queue.submit(query('during cooldown')), faultResult(blocked))
  clock.advance(100)
  assert.deepEqual(await queue.submit(query('slot still occupied')), faultResult(blocked))
  assert.equal(calls.length, 1)
  calls[0].resolve({ items: ['discarded late page'] })
  await turn()
  const recovery = queue.submit(query('recover'))
  await turn()
  assert.equal(calls.length, 2)
  calls[1].resolve(empty)
  assert.deepEqual(await recovery, { status: 'no-hit', page: empty })
  assert.deepEqual(faults, [blocked])
})

test('a repeated key or revoked waiter cannot witness a legacy blockage', async () => {
  const { queue, calls, clock, faults } = fixture()
  const active = queue.submit(query('hung'), { key: 'hung' })
  await turn()
  clock.advance(65)
  assert.deepEqual(await active, deadline)
  const same = queue.submit(query('hung'), { key: 'hung' })
  let allowed = true
  const revoked = queue.submit(query('revoked'), { key: 'different', authorize: () => allowed })
  allowed = false
  clock.advance(30)
  assert.deepEqual(await same, status('queue-timeout'))
  assert.deepEqual(await revoked, status('denied'))
  assert.deepEqual(faults, [])
  calls[0].resolve(empty)
})

test('a waiter previously blocked by another lease cannot confirm that the entire wait was blocked by this lease', async () => {
  const { queue, calls, clock, faults } = fixture({ queueMs: 85, executionMs: 20 })
  const first = queue.submit(query('first'))
  const second = queue.submit(query('second'))
  const waiting = queue.submit(query('waiting'))
  await turn()
  clock.advance(10)
  calls[0].resolve(empty)
  await first
  await turn()
  clock.advance(75)
  assert.deepEqual(await second, deadline)
  assert.deepEqual(await waiting, status('queue-timeout'))
  assert.deepEqual(faults, [])
  calls[1].resolve(empty)
})

test('last subscriber cancellation aborts the host and can establish blockage only with an independent waiter', async () => {
  const { queue, calls, clock, faults } = fixture()
  const controller = new AbortController()
  const active = queue.submit(query('active'), { signal: controller.signal })
  await turn()
  controller.abort()
  assert.deepEqual(await active, status('cancelled'))
  assert.equal(calls[0].options.signal.aborted, true)
  clock.advance(40)
  assert.deepEqual(faults, [])
  const queued = queue.submit(query('other'))
  clock.advance(30)
  const fault = { code: 'SESSION_QUERY_CHANNEL_BLOCKED', stage: 'drain', elapsedMs: 70 }
  assert.deepEqual(await queued, faultResult(fault))
  assert.deepEqual(faults, [fault])
  calls[0].reject(coded('SESSION_QUERY_ABORTED'))
})

test('permanent typed errors trip once, and a failed half-open retains the original incident', async () => {
  const { queue, calls, clock, faults } = fixture()
  const first = queue.submit(query('hidden request'))
  const pending = queue.submit(query('pending'))
  await turn()
  clock.advance(5)
  // Node's SQLite API reports extended result codes in errcode. The low byte is the primary code.
  calls[0].reject(coded('SESSION_QUERY_INDEX_FAILED', { cause: coded('ERR_SQLITE_ERROR', { errcode: 0x10b }) }))
  const fault = { code: 'SQLITE_CORRUPT', stage: 'execution', elapsedMs: 5 }
  for (const result of [first, pending]) assert.deepEqual(await result, faultResult(fault))
  assert.deepEqual(faults, [fault])

  clock.advance(60)
  const probe = queue.submit(query('probe'), { key: 'probe' })
  await turn()
  const coalesced = queue.submit(query('probe'), { key: 'probe' })
  assert.deepEqual(await queue.submit(query('different probe')), faultResult(fault, 'recovering'))
  assert.equal(calls.length, 2)
  calls[1].reject(coded('SQLITE_NOTADB'))
  for (const result of [probe, coalesced]) assert.deepEqual(await result, faultResult(fault))
  assert.deepEqual(await queue.submit(query('cooldown reset')), faultResult(fault))
  assert.deepEqual(faults, [fault])

  clock.advance(60)
  const genericFailure = queue.submit(query('generic failure during recovery'))
  await turn()
  calls[2].reject(coded('SESSION_QUERY_INDEX_FAILED'))
  assert.deepEqual(await genericFailure, { status: 'request-failed', code: 'SESSION_QUERY_INDEX_FAILED' })
  assert.deepEqual(await queue.submit(query('still cooling')), faultResult(fault))
  assert.deepEqual(faults, [fault])

  clock.advance(60)
  const recovery = queue.submit(query('valid empty partial page'))
  await turn()
  const page = { items: [], indexStatus: 'building' }
  calls[3].resolve(page)
  assert.deepEqual(await recovery, { status: 'index-building', page })
  const afterRecovery = queue.submit(query('starts a new incident'))
  await turn()
  calls[4].reject(coded('SQLITE_NOTADB'))
  const newFault = { code: 'SQLITE_NOTADB', stage: 'execution', elapsedMs: 0 }
  assert.deepEqual(await afterRecovery, faultResult(newFault))
  assert.deepEqual(faults, [fault, newFault])
})

test('committed refresh progress is not terminal evidence, and exact health metadata is', async () => {
  let terminalFailure
  const { queue, calls, clock, faults } = fixture({}, {
    committedSearchVersion: 1,
    getSearchHealth: () => ({ indexStatus: 'building', refreshPhase: 'refreshing', queued: 2, progress: 12, terminalFailure }),
  })
  const active = queue.submit(query('slow committed read'))
  await turn()
  clock.advance(65)
  assert.deepEqual(await active, deadline)
  const waiter = queue.submit(query('would witness legacy blockage'))
  clock.advance(30)
  assert.deepEqual(await waiter, status('queue-timeout'))
  assert.deepEqual(faults, [])
  calls[0].resolve(empty)
  await turn()

  terminalFailure = { code: 'SESSION_QUERY_INDEX_FAILED' }
  const unavailable = queue.submit(query('unavailable'))
  await turn()
  calls[1].resolve({ indexStatus: 'unavailable' })
  assert.deepEqual(await unavailable, status('unavailable'))
  assert.deepEqual(faults, [])

  terminalFailure = { code: 'SQLITE_NOTADB', detail: 'private persistence id' }
  const confirmed = queue.submit(query('terminal'))
  await turn()
  calls[2].resolve({ indexStatus: 'unavailable' })
  const fault = { code: 'SQLITE_NOTADB', stage: 'health', elapsedMs: 0 }
  assert.deepEqual(await confirmed, faultResult(fault))
  assert.deepEqual(faults, [fault])
})

test('disposal during delivery authorization cancels all remaining subscribers', async () => {
  const { queue, calls, clock } = fixture()
  let disposeDuringAuth = false
  const active = queue.submit(query('active'), { key: 'active', authorize: () => {
    if (disposeDuringAuth) queue.dispose()
    return true
  } })
  const shared = queue.submit(query('active'), { key: 'active' })
  await turn()
  disposeDuringAuth = true
  calls[0].resolve({ items: ['old generation'] })
  assert.deepEqual(await active, status('cancelled'))
  assert.deepEqual(await shared, status('cancelled'))
  assert.equal(clock.pending, 0)
})

test('dispose settles subscribers, removes timers and ignores late results from the old generation', async () => {
  const { queue, calls, clock, faults } = fixture()
  const activeSignal = new AbortController()
  const pendingSignal = new AbortController()
  const active = queue.submit(query('active'), { signal: activeSignal.signal })
  const pending = queue.submit(query('pending'), { signal: pendingSignal.signal })
  await turn()
  assert.equal(clock.pending, 2)
  queue.dispose()
  queue.dispose()
  assert.equal(calls[0].options.signal.aborted, true)
  assert.deepEqual(await active, status('cancelled'))
  assert.deepEqual(await pending, status('cancelled'))
  assert.equal(getEventListeners(activeSignal.signal, 'abort').length, 0)
  assert.equal(getEventListeners(pendingSignal.signal, 'abort').length, 0)
  assert.equal(clock.pending, 0)
  assert.deepEqual(await queue.submit(query('disposed')), status('cancelled'))
  calls[0].reject(coded('SQLITE_CORRUPT'))
  await turn()
  assert.equal(calls.length, 1)
  assert.deepEqual(faults, [])
})

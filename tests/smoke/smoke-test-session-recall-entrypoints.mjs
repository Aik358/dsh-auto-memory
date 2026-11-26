import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { startRecallHost, writeRecallFixture } from '../lib/pr420-host.mjs'
import { flushDiagnostics } from '../lib/audit-engine.mjs'

const model = 'memory_recall'
const coded = (code, message = 'A private diagnostic that must not be returned') => Object.assign(new Error(message), { code })
const deferred = () => {
  let resolve
  let reject
  const promise = new Promise((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}

async function withHost(services, callback) {
  const root = await mkdtemp(path.join(tmpdir(), 'dam-session-recall-entry-'))
  let host
  try {
    host = await startRecallHost(root, {}, { services })
    await callback(host, root)
  } finally {
    try {
      await host?.close()
      await host?.engine.flushPendingWritesPre()
      await flushDiagnostics()
    } finally {
      await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 30 })
    }
  }
}

function hit(cwd, id, snippet, options = {}) {
  const { surface = 'current', type = 'user/message' } = options
  return { header: { id, cwd, createdAt: 1_700_000_000_000 }, bestMatch: { sessionId: id, type, surface, snippet } }
}

function apiRecall(host, query, extra = {}, signal) {
  return host.request('recall', { sessionId: host.agent.session.id, query, ...extra }, '', signal)
}

function observeEntries(host, names) {
  const pending = new Map(names.map(name => [name, deferred()]))
  const original = host.engine.searchSessionHistory.bind(host.engine)
  host.engine.searchSessionHistory = (query, ...args) => {
    const result = original(query, ...args)
    pending.get(query)?.resolve()
    return result
  }
  return name => pending.get(name).promise
}

test('registered memory_recall preserves an ordinary error and the next search uses the host', { timeout: 8000 }, async () => {
  let calls = 0
  const services = { sessionQuery: { async searchSessions(request) {
    calls++
    if (calls === 1) throw coded('SESSION_QUERY_PERSISTENCE_FAILED')
    const cwd = request.sessionFilters[0].values[0]
    return { items: [null, hit(cwd, 'prior', 'allowed recovery'), hit(cwd, 'shadow', 'hidden shadow', { surface: 'shadowed' }),
      hit(cwd, 'reason', 'hidden reasoning', { type: 'assistant/reasoning' }), hit(cwd + '-else', 'foreign', 'hidden other workspace'),
      hit(cwd, 'fixture-session', 'hidden current session')] }
  } } }
  await withHost(services, async host => {
    const failure = await host.invokeTool(model, { scope: 'sessions', query: 'query one' })
    assert.match(failure, /SESSION_QUERY_PERSISTENCE_FAILED/)
    assert.doesNotMatch(failure, /熔断|超时|private diagnostic|issues\/new/)
    const hitText = await host.invokeTool(model, { scope: 'sessions', query: 'query two' })
    assert.match(hitText, /allowed recovery/)
    assert.doesNotMatch(hitText, /hidden|熔断/)
    assert.equal(calls, 2)
  })
})

test('model and real HTTP recall coalesce and queue different queries in order', { timeout: 12000 }, async () => {
  const calls = []
  const firstHost = deferred()
  const secondHost = deferred()
  const services = { sessionQuery: { searchSessions(request, options) {
    const result = deferred()
    calls.push({ query: request.query, result, signal: options.signal })
    if (request.query === 'shared recall') firstHost.resolve(request)
    if (request.query === 'different recall') secondHost.resolve(request)
    return result.promise
  } } }
  await withHost(services, async host => {
    await writeRecallFixture(host)
    const entered = observeEntries(host, ['shared recall', 'different recall'])
    const first = host.invokeTool(model, { scope: 'sessions', query: 'shared recall' })
    const hostRequest = await firstHost.promise
    assert.deepEqual(hostRequest.sessionFilters, [{ kind: 'cwd', values: [host.agent.session.header.cwd] }])
    assert.deepEqual(hostRequest.eventFilters, [{ kind: 'type', values: ['user/message', 'assistant/message'] }, { kind: 'surface', values: ['current'] }])
    // Capture the actual second history entry before resolving the first provider query.
    const sameEntered = deferred()
    const old = host.engine.searchSessionHistory
    host.engine.searchSessionHistory = (query, ...args) => {
      const result = old(query, ...args)
      if (query === 'shared recall') sameEntered.resolve()
      return result
    }
    const same = apiRecall(host, 'shared recall', { scope: 'all' })
    await sameEntered.promise
    const different = host.invokeTool(model, { scope: 'sessions', query: 'different recall' })
    await entered('different recall')
    assert.deepEqual(calls.map(call => call.query), ['shared recall'])
    calls[0].result.resolve({ items: [hit(host.agent.session.header.cwd, 'older', 'shared result')] })
    assert.match(await first, /shared result/)
    const response = await same
    assert.equal(response.status, 200)
    assert.deepEqual(Object.keys(response.data).sort(), ['hits', 'result'])
    assert.match(response.data.result, /shared result/)
    await secondHost.promise
    assert.deepEqual(calls.map(call => call.query), ['shared recall', 'different recall'])
    calls[1].result.resolve({ items: [hit(host.agent.session.header.cwd, 'older-two', 'different result')] })
    assert.match(await different, /different result/)
    const local = await apiRecall(host, 'Fixture heading')
    assert.equal(local.status, 200)
    assert.ok(local.data.hits.length > 0)
    assert.doesNotMatch(local.data.result, /历史会话检索说明/)
    const l0 = await apiRecall(host, 'Fixture heading', { format: 'l0' })
    assert.match(l0.data.result, /L0 命中/)
    assert.deepEqual(l0.data.hits, [])
    assert.equal(calls.length, 2)
  })
})

test('aborting a real HTTP response forwards cancellation to the host', { timeout: 8000 }, async () => {
  const started = deferred()
  const aborted = deferred()
  const services = { sessionQuery: { searchSessions(_request, { signal }) {
    started.resolve(signal)
    return new Promise((resolve, reject) => signal.addEventListener('abort', () => {
      aborted.resolve()
      reject(coded('SESSION_QUERY_ABORTED'))
    }, { once: true }))
  } } }
  await withHost(services, async host => {
    const c = new AbortController()
    const response = apiRecall(host, 'cancel read', { scope: 'all' }, c.signal)
    const assertCancelled = assert.rejects(response, { name: 'AbortError' })
    const hostSignal = await started.promise
    assert.equal(hostSignal.aborted, false)
    c.abort()
    await assertCancelled
    let timer
    try {
      await Promise.race([aborted.promise, new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error('Host was not cancelled by HTTP close')), 2000)
      })])
      assert.equal(hostSignal.aborted, true)
    } finally {
      clearTimeout(timer)
    }
  })
})

test('missing caller authority and revocation during search never expose the history result', { timeout: 8000 }, async () => {
  const signal = deferred()
  const pending = deferred()
  let calls = 0
  const sessions = new Map()
  const services = { sessions, sessionQuery: { searchSessions(_request, opts) {
    calls++
    signal.resolve(opts.signal)
    return pending.promise
  } } }
  await withHost(services, async host => {
    const withoutCaller = await host.invokeTool(model, { scope: 'sessions', query: 'not authorized' }, { agent: undefined })
    assert.match(withoutCaller, /授权/)
    assert.equal(calls, 0)
    sessions.set(host.agent.session.id, host.agent.session)
    const work = host.invokeTool(model, { query: 'try while authorized', scope: 'sessions' })
    await signal.promise
    sessions.delete(host.agent.session.id)
    pending.resolve({ items: [hit(host.agent.session.header.cwd, 'old', 'secret from revoked scope')] })
    const report = await work
    assert.match(report, /授权/)
    assert.doesNotMatch(report, /secret from revoked scope/)
    assert.equal(calls, 1)
  })
})

test('cold HTTP callers retain scoped history and must still be authorized at delivery', { timeout: 8000 }, async () => {
  let allowed = true
  let revokeDuringSearch = false
  let calls = 0
  const services = { sessions: new Map(), sessionQuery: {
    async filterSessions(filters) {
      if (!allowed) return []
      assert.deepEqual(filters.find(f => f.kind === 'id').values, ['fixture-session'])
      return [{ header: { id: 'fixture-session', cwd: filters.find(f => f.kind === 'cwd').values[0] } }]
    },
    async searchSessions(request) {
      calls++
      if (revokeDuringSearch) allowed = false
      return { items: [hit(request.sessionFilters[0].values[0], 'older', 'allowed cold history')] }
    },
  } }
  await withHost(services, async host => {
    host.engine.agentForSessionId = () => null
    const first = await apiRecall(host, 'cold history one', { scope: 'all' })
    assert.equal(first.status, 200)
    assert.match(first.data.result, /allowed cold history/)
    revokeDuringSearch = true
    const revoked = await apiRecall(host, 'cold history two', { scope: 'all' })
    assert.match(revoked.data.result, /授权/)
    assert.doesNotMatch(revoked.data.result, /allowed cold history/)
    const denied = await apiRecall(host, 'cold history three', { scope: 'all' })
    assert.match(denied.data.result, /授权/)
    assert.doesNotMatch(denied.data.result, /allowed cold history/)
    assert.equal(calls, 2)
  })
})

test('registered recall negotiates committed results and reports coverage during refresh', { timeout: 8000 }, async () => {
  const modes = []
  const services = { sessionQuery: { committedSearchVersion: 1, async searchSessions(req, options) {
    modes.push(options.consistency)
    const cwd = req.sessionFilters[0].values[0]
    if (modes.length === 1) return { items: [], indexStatus: 'building' }
    return { items: [hit(cwd, 'last-commit', 'previous committed result')], indexStatus: 'stale' }
  } } }
  await withHost(services, async host => {
    const initializing = await host.invokeTool(model, { query: 'building index', scope: 'sessions' })
    assert.match(initializing, /索引正在建立/)
    assert.doesNotMatch(initializing, /熔断|未命中/)
    const prior = await apiRecall(host, 'refresh index', { scope: 'all' })
    assert.match(prior.data.result, /previous committed result/)
    assert.match(prior.data.result, /最近已提交版本/)
    assert.deepEqual(modes, ['committed', 'committed'])
  })
})

test('real recall provides a safe incident once and preserves local results beyond output truncation', { timeout: 12000 }, async () => {
  let called = 0
  const services = { sessionQuery: { async searchSessions() {
    called++
    throw Object.assign(coded('SESSION_QUERY_INDEX_FAILED'), { cause: coded('SQLITE_CORRUPT', 'a private path, owner and message') })
  } } }
  await withHost(services, async host => {
    await mkdir(path.dirname(host.paths.notesPath), { recursive: true })
    await writeFile(host.paths.notesPath, ('fixture token ' + '正文'.repeat(34000)) + '\n')
    const first = await host.invokeTool(model, { query: 'fixture', scope: 'sessions' })
    assert.match(first, /已熔断/)
    assert.match(first, /请排查相关记忆引擎的问题/)
    assert.match(first, /github\.com\/Aik358\/dsh-auto-memory\/issues\/new\/choose/)
    assert.doesNotMatch(first, /private|path, owner/)
    const local = await apiRecall(host, 'fixture')
    assert.match(local.data.result, /fixture token/)
    assert.doesNotMatch(local.data.result, /已熔断|issues\/new/)
    const combined = await apiRecall(host, 'fixture', { scope: 'all' })
    assert.match(combined.data.result, /fixture token/)
    assert.match(combined.data.result, /输出已截断/)
    assert.ok(combined.data.result.length <= 60000)
    assert.match(combined.data.result, /请排查相关记忆引擎的问题/)
    assert.equal(called, 1)
    assert.equal(host.engine._degradeSink.snapshot().counts['session-search'], 1)
  })
})

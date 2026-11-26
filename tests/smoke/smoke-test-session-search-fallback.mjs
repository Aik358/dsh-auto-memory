#!/usr/bin/env node
/** The disabled-FTS compatibility path uses only authorized host projections. */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { SessionRecallReader } from '../../lib/session-recall.js'

const cwd = 'D:/workspace'
const caller = { session: { id: 'caller', header: { cwd } } }
const cwdFilter = { kind: 'cwd', values: [cwd] }
const messageFilters = [
  { kind: 'type', values: ['user/message', 'assistant/message'] },
  { kind: 'surface', values: ['current'] },
]
const record = (id, workspace = cwd) => ({ header: { id, cwd: workspace, createdAt: '2026-08-19T01:00:00Z' } })
const message = (sessionId, text, overrides = {}) => ({ sessionId, text, seq: 1, type: 'user/message', surface: 'current', ...overrides })
const hostError = code => Object.assign(new Error('private host detail'), { code })
const disabled = () => { throw hostError('SESSION_QUERY_SEARCH_DISABLED') }

function makeSearch(t, service) {
  const reader = new SessionRecallReader({ getService: () => service, getLiveSession: id => id === caller.session.id ? caller.session : undefined })
  t.after(() => reader.dispose())
  return (query, limit = 8, options) => reader.search(query, limit, { agent: caller, ...options })
}

for (const hasSearch of [false, true]) {
  test((hasSearch ? 'disabled FTS' : 'older host without FTS') + ' scans only host-authorized visible messages', async t => {
    const sessionCalls = []
    const eventsCalls = []
    let searchCalls = 0
    const visible = record('authorized')
    const service = {
      ...(hasSearch ? { searchSessions: async () => { searchCalls++; disabled() } } : {}),
      async filterSessions(filters, signal) {
        sessionCalls.push(filters)
        assert.ok(signal instanceof AbortSignal)
        if (filters.some(filter => filter.kind === 'id')) return [visible]
        // A stale or broad host response must still be narrowed at the reader boundary.
        return [record('foreign', 'D:/unrelated'), record(caller.session.id), visible]
      },
      async filterEvents(id, filters) {
        eventsCalls.push([id, filters])
        return [
          message('another-session', '水位 foreign document'),
          message(id, '水位 shadowed document', { surface: 'shadowed' }),
          message(id, '水位 log only document', { surface: 'log-only' }),
          message(id, '水位 tool payload', { type: 'tool/result' }),
          message(id, '水位 out-of-budget event', { seq: 160 }),
          message(id, '水位 ill-formed event', { seq: -1 }),
          message(id, 'unrelated visible event', { seq: 0 }),
          message(id, '  水位阈值\n已校准  ', { type: 'assistant/message', seq: 159 }),
        ]
      },
    }
    const result = await makeSearch(t, service)(' 水位，Never-Matches ')
    assert.deepEqual([...result], ['· [2026-08-19] D:/workspace\n  水位阈值 已校准'])
    assert.match(result.diagnostic, hasSearch ? /全文索引未启用/ : /全文索引未提供/)
    assert.match(result.diagnostic, /宿主可见消息接口.*当前工作区.*8 个会话的前 160 条记录/)
    assert.doesNotMatch(result.diagnostic, /部分会话|private host detail/)
    assert.deepEqual(sessionCalls, [[cwdFilter], [cwdFilter, { kind: 'id', values: ['authorized'] }]])
    assert.deepEqual(eventsCalls, [['authorized', [...messageFilters, { kind: 'seq', to: 159 }]]])
    assert.equal(searchCalls, Number(hasSearch))
  })
}

test('ordinary, unauthorized, and text-only failures never consult the compatibility API', async t => {
  let code
  let filterCalls = 0
  const service = {
    async searchSessions() {
      if (code) throw hostError(code)
      throw new Error('SESSION_QUERY_SEARCH_DISABLED private host detail')
    },
    async filterSessions() { filterCalls++; return [record('not-allowed')] },
    async filterEvents(id) { filterCalls++; return [message(id, 'private transcript')] },
  }
  const search = makeSearch(t, service)
  for (const [value, receipt] of [
    ['SESSION_QUERY_TOOL_UNAUTHORIZED', /无法确认.*授权/],
    ['EACCES', /检索失败.*EACCES/],
    ['EPERM', /检索失败.*EPERM/],
    ['SESSION_QUERY_PERSISTENCE_FAILED', /SESSION_QUERY_PERSISTENCE_FAILED/],
    [undefined, /检索失败/],
  ]) {
    code = value
    const result = await search('private')
    assert.equal(result.length, 0)
    assert.match(result.diagnostic, receipt)
    assert.doesNotMatch(result.diagnostic, /宿主可见消息接口|熔断|private host detail/)
  }
  const deniedCaller = { session: { id: 'no-live-session', header: { cwd } } }
  assert.match((await search('private', 8, { agent: deniedCaller })).diagnostic, /无法确认.*授权/)
  assert.equal(filterCalls, 0)
})

test('an access error during fallback discards the already collected hits', async t => {
  let errorCode
  const eventsCalls = []
  const search = makeSearch(t, {
    searchSessions: disabled,
    async filterSessions(filters) {
      assert.deepEqual(filters, [cwdFilter], 'no results should reach the second authorization check')
      return [record('first'), record('restricted')]
    },
    async filterEvents(id) {
      eventsCalls.push(id)
      if (id === 'restricted') throw hostError(errorCode)
      return [message(id, 'previously collected needle')]
    },
  })
  for (const [code, receipt] of [['SESSION_QUERY_TOOL_UNAUTHORIZED', /无法确认.*授权/], ['EACCES', /检索失败.*EACCES/], ['EPERM', /检索失败.*EPERM/]]) {
    errorCode = code
    const result = await search('needle')
    assert.deepEqual([...result], [])
    assert.match(result.diagnostic, receipt)
    assert.doesNotMatch(result.diagnostic, /previously collected needle|private host detail/)
  }
  assert.deepEqual(eventsCalls, ['first', 'restricted', 'first', 'restricted', 'first', 'restricted'])
})

test('fallback attempts at most eight authorized candidates and reports partial coverage', async t => {
  const ids = Array.from({ length: 9 }, (_, i) => 'candidate-' + i)
  const eventsCalls = []
  const search = makeSearch(t, {
    searchSessions: disabled,
    async filterSessions(filters) {
      const selected = filters.find(filter => filter.kind === 'id')?.values ?? ids
      return [record('foreign', 'D:/unrelated'), ...selected.map(id => record(id))]
    },
    async filterEvents(id) {
      eventsCalls.push(id)
      if (id === ids[0]) throw hostError('EIO')
      if (id === ids[1]) return [message(id, 'visible needle')]
      if (id === ids[8]) return [message(id, 'out-of-budget needle')]
      return []
    },
  })
  const result = await search('needle')
  assert.deepEqual([...result], ['· [2026-08-19] D:/workspace\n  visible needle'])
  assert.deepEqual(eventsCalls, ids.slice(0, 8))
  assert.match(result.diagnostic, /部分会话未能读取或超出扫描范围/)
  assert.doesNotMatch(result.diagnostic, /private host detail/)
})

test('fallback rechecks matched session authorization before returning the snippet', async t => {
  const sessionCalls = []
  const visible = record('revoked')
  const search = makeSearch(t, {
    searchSessions: disabled,
    async filterSessions(filters) {
      sessionCalls.push(filters)
      return sessionCalls.length === 1 ? [visible] : [record('revoked', 'D:/unrelated')]
    },
    async filterEvents(id) { return [message(id, 'revoked needle')] },
  })
  const result = await search('needle')
  assert.deepEqual([...result], [])
  assert.deepEqual(sessionCalls, [[cwdFilter], [cwdFilter, { kind: 'id', values: ['revoked'] }]])
  assert.match(result.diagnostic, /部分会话未能读取或超出扫描范围/)
})

test('index hits and misses retain their output shape and do not invoke fallback', async t => {
  const requests = []
  let filterCalls = 0
  const search = makeSearch(t, {
    async searchSessions(request) {
      requests.push(request)
      return { items: request.query === 'found' ? [
        { ...record('off-workspace', 'D:/unrelated'), bestMatch: { ...message('off-workspace'), snippet: 'secret' } },
        { ...record('host-hit'), bestMatch: { ...message('host-hit'), snippet: 'index hit\n' + 'x'.repeat(400) } },
        { ...record('other-hit'), bestMatch: { ...message('other-hit'), snippet: 'second hit' } },
      ] : [] }
    },
    async filterSessions() { filterCalls++; return [] },
    async filterEvents() { filterCalls++; return [] },
  })
  const found = await search('found', 1)
  assert.deepEqual([...found], ['· [2026-08-19] D:/workspace\n  index hit ' + 'x'.repeat(290)])
  assert.equal(found.diagnostic, '')
  const missing = await search('missing')
  assert.equal(missing.length, 0)
  assert.match(missing.diagnostic, /已完成，未命中/)
  assert.deepEqual(requests, [
    { query: 'found', limit: 2, sessionFilters: [cwdFilter], eventFilters: messageFilters },
    { query: 'missing', limit: 9, sessionFilters: [cwdFilter], eventFilters: messageFilters },
  ])
  assert.equal(filterCalls, 0)
})

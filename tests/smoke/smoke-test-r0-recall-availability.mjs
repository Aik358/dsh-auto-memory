#!/usr/bin/env node
/** R0 recall availability and limits, with request-scoped session receipts. */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { SessionRecallReader } from '../../lib/session-recall.js'

const caller = { session: { id: 'caller', header: { cwd: 'D:/caller' } } }
const source = readFileSync(new URL('../../lib/index.js', import.meta.url), 'utf8').replace(/\r\n/g, '\n')
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor

function readSection(startMarker, endMarker) {
  const start = source.indexOf(startMarker)
  assert.ok(start >= 0, 'production section starts at ' + startMarker)
  const end = source.indexOf(endMarker, start + startMarker.length)
  assert.ok(end > start, 'production section ends at ' + endMarker)
  return source.slice(start, end)
}

function makeReader(t, searchSessions, queueOptions) {
  const service = { searchSessions }
  const faults = []
  const reader = new SessionRecallReader({ getService: () => service, onFault: fault => faults.push(fault), queueOptions })
  t.after(() => reader.dispose())
  return { faults, search: query => reader.search(query, 8, { agent: caller }) }
}

function hostError(code, cause) {
  return Object.assign(new Error('private connection detail SQLITE_CORRUPT'), { code, cause })
}

for (const rejectAsync of [false, true]) {
  test('ordinary host failures stay request-scoped (' + (rejectAsync ? 'async rejection' : 'sync throw') + ')', async t => {
    const cases = [
      [hostError('SESSION_QUERY_SEARCH_DISABLED'), /全文检索未启用/],
      [hostError('SESSION_QUERY_TOOL_UNAUTHORIZED'), /无法确认.*授权/],
      [hostError('SESSION_QUERY_ABORTED'), /已取消/],
      [hostError('SESSION_QUERY_INVALID_QUERY'), /SESSION_QUERY_INVALID_QUERY/],
      [hostError('SESSION_QUERY_PERSISTENCE_FAILED', hostError('EBUSY')), /SESSION_QUERY_PERSISTENCE_FAILED/],
      [hostError(undefined), /检索失败/],
    ]
    let failure
    let calls = 0
    const { faults, search } = makeReader(t, () => {
      calls++
      if (!failure) return { items: [] }
      if (rejectAsync) return Promise.reject(failure)
      throw failure
    })
    for (const [error, description] of cases) {
      failure = error
      const receipt = await search('failed')
      assert.equal(receipt.length, 0)
      assert.match(receipt.diagnostic, description, error.code)
      assert.doesNotMatch(receipt.diagnostic, /超时|熔断|issues\/new|private connection detail|SQLITE_CORRUPT/)
      failure = undefined
      assert.match((await search('recovered')).diagnostic, /已完成，未命中/)
    }
    assert.equal(calls, cases.length * 2)
    assert.deepEqual(faults, [])
  })
}

test('true execution timeout requests cancellation and leaves the next call available', { timeout: 2000 }, async t => {
  let now = 0
  let expire
  let hostSignal
  const { faults, search } = makeReader(t, ({ query }, { signal }) => {
    if (query === 'next') return { items: [] }
    hostSignal = signal
    return new Promise((_, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true }))
  }, {
    executionMs: 50,
    now: () => now,
    setTimer: callback => { expire = callback; return 1 },
    clearTimer: () => {},
  })
  const pending = search('slow')
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(hostSignal?.aborted, false)
  assert.equal(typeof expire, 'function')
  now = 50
  expire()
  assert.match((await pending).diagnostic, /等待.*超时，已请求取消/)
  assert.equal(hostSignal.aborted, true)
  assert.match((await search('next')).diagnostic, /已完成，未命中/)
  assert.deepEqual(faults, [])
})

test('a confirmed index fault opens one breaker, and a readable empty page clears it', async t => {
  let now = 0
  let calls = 0
  const { faults, search } = makeReader(t, () => {
    if (++calls === 1) throw hostError('SESSION_QUERY_PERSISTENCE_FAILED', hostError('SQLITE_NOTADB'))
    return { items: [], indexedSessions: 0 }
  }, { cooldownMs: 100, now: () => now })
  const failed = await search('broken')
  assert.match(failed.diagnostic, /已熔断.*SQLITE_NOTADB/)
  assert.match(failed.diagnostic, /Issue 未提交/)
  assert.doesNotMatch(failed.diagnostic, /private connection detail/)
  now = 99
  assert.equal((await search('cooldown')).diagnostic, failed.diagnostic)
  assert.equal(calls, 1)
  assert.deepEqual(faults.map(({ code, stage }) => ({ code, stage })), [{ code: 'SQLITE_NOTADB', stage: 'execution' }])
  now = 100
  assert.match((await search('probe')).diagnostic, /索引当前为空/)
  assert.match((await search('after-probe')).diagnostic, /索引当前为空/)
  assert.equal(calls, 3)
  assert.equal(faults.length, 1)
})

test('workspace discovery reuses a fresh cache and refreshes an expired cache', async () => {
  const probe = new AsyncFunction(readSection('      let cwds\n', '      for (const cwd of cwds) {') + 'return cwds')
  let discoveries = 0
  const host = {
    _wsCache: { at: Date.now(), list: ['D:/cached'] },
    discoverWorkspaces: async () => { discoveries++; return ['D:/rediscovered'] },
  }
  assert.deepEqual(await probe.call(host), ['D:/cached'])
  assert.equal(discoveries, 0)
  host._wsCache.at = Date.now() - 5 * 60 * 1000
  assert.deepEqual(await probe.call(host), ['D:/rediscovered'])
  assert.equal(discoveries, 1)
  assert.deepEqual(host._wsCache.list, ['D:/rediscovered'])
  assert.deepEqual(await probe.call(host), ['D:/rediscovered'])
  assert.equal(discoveries, 1)
})

test('recall clamps limits and only reports upper-limit clamping', () => {
  const clampSource = source.match(/^[ \t]+const _limitRaw\b[\s\S]*?^[ \t]+limit = _limitClamped\b/m)?.[0]
  assert.ok(clampSource, 'recall limit clamp block not found')
  const clamp = new Function('limit',
    readSection('const R0_RECALL_MAX_LIMIT = ', '\n') + '\n' +
    clampSource + '\nreturn [limit, _limitWasClamped]')
  for (const [value, expected] of [[1000, [50, true]], [100, [50, true]], [50, [50, false]], [8, [8, false]],
    [0, [1, false]], [-5, [1, false]], [NaN, [8, false]], [undefined, [8, false]]]) {
    assert.deepEqual(clamp(value), expected)
  }
})

test('recall truncates only over the output cap and retains the request receipt', async t => {
  const finish = new Function('out', 'q', 'limit', 'localWindowNote', 'failureNote', 'sessionChannelNote', '_limitWasClamped', '_limitRaw',
    readSection('const R0_RECALL_MAX_OUTPUT_CHARS = ', '\n') + '\n' +
    readSection('    const clampNote', '\n  }\n'))
  const { search } = makeReader(t, () => { throw hostError('SESSION_QUERY_PERSISTENCE_FAILED') })
  const sessionChannelNote = '\n[历史会话检索说明] ' + (await search('needle')).diagnostic
  const format = (text, { limit = 50, clamped = false, raw = limit, receipt = sessionChannelNote } = {}) =>
    finish([text], 'needle', limit, '', '', receipt, clamped, raw)
  const overhead = format('').length
  assert.equal(format('x'.repeat(60_000 - overhead)).length, 60_000)
  assert.doesNotMatch(format('x'.repeat(60_000 - overhead)), /输出已截断/)
  const truncated = format('x'.repeat(60_001 - overhead))
  assert.equal(truncated.length, 60_000)
  assert.ok(truncated.endsWith(sessionChannelNote))
  assert.equal(truncated.split(sessionChannelNote).length - 1, 1)
  assert.match(truncated, /\[输出已截断\].*60000.*拿全的办法/)
  assert.doesNotMatch(format('local only', { receipt: '' }), /历史会话检索说明/)
  assert.match(format('local hit', { clamped: true, raw: 100 }), /limit 被夹紧到上限 50.*请求 100/)
})

test('HTTP recall keeps the current/full default and forwards explicit l0', async () => {
  const execute = new AsyncFunction('body', 'res', 'req', 'agent', 'liveAgent', 'engine', 'writeJson', 'bindRecallResponseCancellation',
    readSection("          const scope = body.scope || 'current'", '\n        } catch (e) { writeJson(res, 500'))
  for (const [body, expected] of [[{ query: 'needle' }, ['current', 'full']], [{ query: 'needle', scope: 'all', format: 'l0' }, ['all', 'l0']]]) {
    const agent = caller
    const signal = new AbortController().signal
    let returned
    const engine = {
      withAgent: (requestAgent, fn) => { assert.equal(requestAgent, agent); return fn() },
      recall: async (query, _limit, requestAgent, scope, { format, hits, signal: received }) => {
        assert.equal(query, body.query)
        assert.equal(requestAgent, agent)
        assert.deepEqual([scope, format], expected)
        assert.equal(received, signal)
        hits.push('structured-hit')
        return 'result text'
      },
    }
    await execute(body, {}, {}, agent, agent, engine,
      (_res, status, data) => { returned = [status, data] }, () => ({ signal, release() {} }))
    assert.deepEqual(returned, [200, { result: 'result text', hits: ['structured-hit'] }])
  }
})

/** Issue #162: method-level integration with real production bodies, sink,
 * parser, persistence and head decoder. No DSH bootstrap, user data or APIs.
 * ISSUE162_SOURCE_ROOT selects an alternate production source tree.
 */
import assert from 'node:assert/strict'
import { test, after } from 'node:test'
import * as fs from 'node:fs'
import * as fsp from 'node:fs/promises'
import path from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { zstdCompressSync } from 'node:zlib'
import { createDegradeSinkPre, DEGRADE_REASON_MAX_PRE_V1 } from '../../lib/degrade.js'
import { diagnosticErrorReasonPre, recordDiagnosticErrorPre } from '../../lib/diagnostic-error.js'

const ownRoot = fileURLToPath(new URL('../../', import.meta.url))
const root = process.env.ISSUE162_SOURCE_ROOT || ownRoot
// ★本仓为 CRLF 行尾（上游为 LF）：按 LF 边界提取方法体的判据需先归一化，否则 end=-1。
const source = fs.readFileSync(path.join(root, 'lib/index.js'), 'utf8').replace(/\r\n/g, '\n')
const client = fs.readFileSync(path.join(root, 'lib/client.js'), 'utf8').replace(/\r\n/g, '\n')
const temp = fs.mkdtempSync(path.join(tmpdir(), 'issue162-'))
after(() => fs.rmSync(temp, { recursive: true, force: true }))
const url = (name) => pathToFileURL(path.join(root, 'lib', name)).href
const { decodeZstdFramesHead, decodeZstdFrames, scanZstdFrames } = await import(url('subagent-gc.js'))
const extract = (marker) => {
  const start = source.indexOf('  ' + marker)
  assert.ok(start >= 0, 'production method exists: ' + marker)
  assert.equal(source.indexOf('  ' + marker, start + marker.length + 2), -1, 'unique method')
  const end = source.indexOf('\n  }\n', start)
  assert.ok(end > start)
  return source.slice(start, end + 5).replace(/import\('\.\/([^']+)'\)/g, (_, name) => `import(${JSON.stringify(url(name))})`)
}
const methods = [
  'async searchSessionHistory(', 'async applyNoteStatusPre(',
  'async recall(', 'async readTextSafe(', 'async writeFull(', '_degradeViewSnapshot(',
  '_quotaViewSnapshot(', '_persistObservabilityPre(', 'globalPaths(', 'async debugInfo(',
].map(extract).join('\n')
const constants = ['OBSERVER_SCHEMA_VERSION', 'ENVELOPE_RING_LIMIT', 'SEGMENT_RING_LIMIT', 'SEGMENT_RING_CHAR_BUDGET', 'SEED_REPLAY_MAX_EVENTS']
  .map((name) => { const found = source.match(new RegExp('const ' + name + ' = [^\\n]+')); assert.ok(found); return found[0] }).join('\n')
let fixtureNumber = 0
async function harness(overrides = {}) {
  const home = path.join(temp, 'home-' + fixtureNumber++)
  fs.mkdirSync(home, { recursive: true })
  const modulePath = path.join(home, 'harness.mjs')
  await fsp.writeFile(modulePath, `
import * as nativeFs from 'node:fs'
import * as nativePromises from 'node:fs/promises'
import path from 'node:path'
import { homedir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'
import { memoryWriteError } from ${JSON.stringify(url('memory-writer.js'))}
import { persistDegradeLedgerPre, deriveQuotaVerdictPre } from ${JSON.stringify(url('degrade.js'))}
import { SessionRecallReader, historyRecallLines } from ${JSON.stringify(url('session-recall.js'))}
import { recordDiagnosticErrorPre } from ${JSON.stringify(pathToFileURL(path.join(ownRoot, 'lib/diagnostic-error.js')).href)}
import { dirSize } from ${JSON.stringify(url('session-archive.js'))}
import { readDeliveryMode } from ${JSON.stringify(url('injection/policy-runtime.js'))}
import { EVENT_STORE_FILENAME as V4_EVENT_STORE_FILENAME } from ${JSON.stringify(url('event-store.js'))}
${constants}
const home = ${JSON.stringify(home)}
const dshHome = () => home
const memoryDir = (name) => path.join(home, 'memory', name)
const todayStr = () => '2026-09-30'
const dateStrOf = (value) => new Date(value).toISOString().slice(0, 10)
const diag = () => {}
const DATE_RE = /^\\d{4}-\\d{2}-\\d{2}$/
export function make(overrides) {
 const io = Object.assign({}, nativeFs, nativePromises, overrides)
 const { readdirSync, readFileSync, statSync, existsSync, mkdirSync, writeFileSync, readFile, readdir, stat, lstat, mkdir, writeFile } = io
 const instance = new (class ProductionHarness {
${methods}
 })()
 return instance
}
`)
  const { make } = await import(pathToFileURL(modulePath).href)
  const host = make(overrides)
  Object.assign(host, {
    // ★R1（2026-10-08）夹具同步（非回滚 · 依据 2026-10-01 裁定）：#258 给整篇写原语 `writeFull`
    //   加了本地角色门 `this._assertTeamActionPre(this._teamWriteActionPre(p))`。本 harness 抽取的是
    //   **真产线方法体**、`this` 上只有下面显式挂的成员（无原型链）⇒ 缺桩即 TypeError，被
    //   applyNoteStatusPre 的 fail-soft catch 吞成「状态写入失败」⇒ /状态已更新/ 断言假红。
    //   门的真实行为由 smoke-test-la-audit-fixes.mjs（真引擎 viewer 被拒）专测，本套件测的是
    //   诊断完整性（失败要如实上报、私密错误不外泄），故这里给恒过桩。
    _assertTeamActionPre: () => {},
    _teamWriteActionPre: () => 'write-own-memory',
    _ctxRef: new Map(), _degradeSink: createDegradeSinkPre(), config: {}, state: {}, _observerStats: {},
    runtimes: { values: () => [] }, autoStats: { count: 0 },
    memoryIndexSnapshot: async () => ({}), _hubIoViewSnapshot: () => null,
    // ★L-E（2026-10-08）夹具同步（非回滚 · 依据 §9.3-2 口径与上文 R1 同型）：#261 给 debugInfo 新增了
    //   诊断投影 `schedule: this._scheduleViewSnapshot()`（与既有 _hubIo/_factsPrune/_logs 三个 *ViewSnapshot
    //   **同一出口纪律**：只读快照、最小投影）。本 harness 抽取真产线方法体、`this` 无原型链 ⇒ 缺该桩即
    //   TypeError: this._scheduleViewSnapshot is not a function。**属夹具侧假红，非产品缺陷**；
    //   投影的真实行为由 smoke-test-le-261-schedule-failure.mjs（真执行 + 变异负路径）专测。
    _factsPruneViewSnapshot: () => null, _logsViewSnapshot: () => null,
    _scheduleViewSnapshot: () => null,
    capacityLimit: () => 1000, memToday: todayStr,
    userDirOf: () => path.join(home, 'user'), projectDirOf: () => path.join(home, 'workspace'),
    resolvePaths: async () => Object.fromEntries(['ws', 'projectDir', 'handoffDir', 'userFile', 'notesPath', 'logPath', 'reflectDir', 'calendarPath'].map((key) => [key, path.join(home, key)])),
    appendText: async (file, text) => { await fsp.appendFile(file, text); return text },
    // ★合并适配（PR #161 + PR #162）：#161 把 writeFull 改为 docStore/rawDocStore 双路，
    //   本 harness 只提供 rawDocStore 分支；写入失败语义由测试通过替换 writeFull 自身来注入。
    rawDocStore: { replaceRaw: async (p, text) => { await fsp.mkdir(path.dirname(p), { recursive: true }); await fsp.writeFile(p, String(text == null ? '' : String(text)), 'utf8'); return { ok: true } } },
  })
  return { home, host }
}
function todayStr() { return '2026-09-30' }
const cwd = 'D:/fixture-workspace'
const caller = { session: { id: 'caller', header: { cwd } } }
const historyHeader = id => ({ id, cwd, createdAt: '2026-09-30T00:00:00Z' })
const historyMatch = (sessionId, snippet) => ({ header: historyHeader(sessionId), bestMatch: { sessionId, snippet, surface: 'current', type: 'user/message' } })
const secretError = (code = 'EACCES') => Object.assign(new Error('Bearer credential123\nhttps://user:pass@host/private?token=URLSECRET\nC:\\Users\\PERSONAL\\secret.md /home/PERSONAL/secret.md\n正文私人内容\n' + 'X'.repeat(6000)), { code })
const disabledSearch = () => { throw secretError('SESSION_QUERY_SEARCH_DISABLED') }
const confirmedFault = () => Object.assign(secretError('SESSION_QUERY_PERSISTENCE_FAILED'), { cause: secretError('SQLITE_CORRUPT') })
const useSessionService = (host, service) => host._ctxRef.set('sessionQuery', service)
const absentSecrets = (value) => {
  assert.doesNotMatch(JSON.stringify(value), /credential123|URLSECRET|PERSONAL|正文私人内容|user:pass|Bearer|\b39\s*(?:个?旧会话|old sessions\b)|descriptor v2|v0→v1/)
}

test('privacy checks accept timestamp second 39 but reject obsolete session claims and secrets', () => {
  absentSecrets({ updatedAt: '2026-10-02T09:51:39.000Z', count: 39 })
  for (const value of ['39个旧会话', '39 old sessions', 'credential123', 'URLSECRET', 'PERSONAL', '正文私人内容', 'user:pass', 'Bearer', 'descriptor v2', 'v0→v1']) {
    assert.throws(() => absentSecrets(value), assert.AssertionError)
  }
})


test('missing capability, missing method, successful empty and successful hit stay distinct', async () => {
  const { host } = await harness()
  for (const service of [undefined, {}]) {
    useSessionService(host, service)
    const output = await host.recall('needle', 8, caller, 'sessions')
    assert.match(output, /能力当前不可用/)
    assert.doesNotMatch(output, /会话命中|已完成，未命中/)
  }
  let scans = 0
  let items = []
  useSessionService(host, {
    searchSessions: async () => ({ items }),
    filterSessions: async () => { scans++; return [] },
    filterEvents: async () => { scans++; return [] },
  })
  const empty = await host.recall('needle', 8, caller, 'sessions')
  assert.match(empty, /已完成，未命中/)
  assert.doesNotMatch(empty, /能力当前不可用|宿主可见消息接口/)
  items = [historyMatch('host-hit', 'needle from the index')]
  const hit = await host.recall('needle', 8, caller, 'sessions')
  assert.match(hit, /历史 DSH 会话命中.*needle from the index/s)
  assert.equal(scans, 0)
  assert.ok(host._degradeSink.isEmpty())
})

test('confirmed faults redact sensitive details and record one incident across repeated receipts', async () => {
  const { host } = await harness()
  let calls = 0
  useSessionService(host, { searchSessions: async () => { calls++; throw confirmedFault() } })
  for (let i = 0; i < 2; i++) {
    const result = await host.recall('needle', 8, caller, 'sessions')
    assert.match(result, /已熔断.*本次未覆盖历史会话.*SQLITE_CORRUPT/s)
    assert.match(result, /Issue 未提交/)
    assert.doesNotMatch(result, /会话命中|宿主可见消息接口/)
    absentSecrets(result)
  }
  assert.equal(calls, 1)
  const ledger = host._degradeSink.snapshot()
  assert.equal(ledger.counts['session-search'], 1)
  assert.equal(ledger.recent.length, 1)
  assert.match(ledger.recent[0].reason, /code=SQLITE_CORRUPT; stage=execution/)
  absentSecrets(ledger)
})

test('an ordinary host rejection leaves no stale receipt or incident on recovery', async () => {
  const { host } = await harness()
  let calls = 0
  let scans = 0
  useSessionService(host, {
    searchSessions: async () => { if (++calls === 1) throw secretError(); return { items: [] } },
    filterSessions: async () => { scans++; return [] },
    filterEvents: async () => { scans++; return [] },
  })
  const result = await host.recall('needle', 8, caller, 'sessions')
  assert.match(result, /检索失败.*EACCES/)
  assert.doesNotMatch(result, /熔断|宿主可见消息接口|会话命中/)
  absentSecrets(result)
  const success = await host.recall('needle', 8, caller, 'sessions')
  assert.match(success, /已完成，未命中/)
  assert.doesNotMatch(success, /EACCES|熔断/)
  assert.equal(calls, 2)
  assert.equal(scans, 0)
  assert.ok(host._degradeSink.isEmpty())
})

test('concurrent history requests keep each receipt and its hits separate', async () => {
  const { host } = await harness()
  let release
  const gate = new Promise(resolve => { release = resolve })
  useSessionService(host, { searchSessions: async ({ query }) => {
    if (query === 'failing-query') { await gate; throw secretError() }
    return { items: [historyMatch('clean', 'successful query hit')] }
  } })
  const failure = host.recall('failing-query', 8, caller, 'sessions')
  const success = host.recall('successful-query', 8, caller, 'sessions')
  release()
  const [failedResult, successfulResult] = await Promise.all([failure, success])
  assert.match(failedResult, /检索失败/)
  assert.doesNotMatch(failedResult, /successful query hit/)
  assert.match(successfulResult, /successful query hit/)
  assert.doesNotMatch(successfulResult, /检索失败|熔断|EACCES/)
  absentSecrets(failedResult)
  assert.ok(host._degradeSink.isEmpty())
})

test('failure of the authorized fallback listing is reported without exposing host details', async () => {
  const { host } = await harness()
  let events = 0
  useSessionService(host, {
    searchSessions: disabledSearch,
    filterSessions: async () => { throw secretError() },
    filterEvents: async () => { events++; return [] },
  })
  const result = await host.recall('needle', 8, caller, 'sessions')
  assert.match(result, /检索失败.*EACCES/)
  assert.doesNotMatch(result, /会话命中|已完成，未命中|熔断/)
  assert.equal(events, 0)
  assert.ok(host._degradeSink.isEmpty())
  absentSecrets(result)
})

test('frame and byte budgets really constrain production head decoding', () => {
  const frame = zstdCompressSync(Buffer.from('prefix\n'))
  const tail = zstdCompressSync(Buffer.from('tailneedle\n'))
  const crowded = Buffer.concat([...Array(160).fill(frame), tail])
  const observation = {}
  assert.equal(decodeZstdFramesHead(crowded, 160, 4 * 1024 * 1024, observation), 'prefix\n'.repeat(160))
  assert.deepEqual(observation, { limited: true, failedFrames: 0 })
  const oversizedFrame = zstdCompressSync(Buffer.from('x'.repeat(4 * 1024 * 1024 + 1)))
  assert.ok(Buffer.byteLength(decodeZstdFramesHead(oversizedFrame, 160, 4 * 1024 * 1024)) <= 4 * 1024 * 1024)
  const frames = Buffer.concat(['1234', '5678', 'overflow'].map(s => zstdCompressSync(Buffer.from(s))))
  assert.equal(decodeZstdFramesHead(frames, 3, 8), '12345678')
  // A valid frame that exceeds the byte budget still consumes a frame attempt.
  assert.equal(decodeZstdFramesHead(Buffer.concat([oversizedFrame, zstdCompressSync(Buffer.from('later'))]), 1, 8), '')
})

test('throwing and rejecting diagnostic sinks cannot break fail-soft recall', async () => {
  for (const sink of [{ record: () => { throw secretError() } }, { record: () => Promise.reject(secretError()) }, Object.defineProperty({}, 'record', { get() { throw secretError() } })]) {
    const { host } = await harness()
    host._degradeSink = sink
    useSessionService(host, { searchSessions: async () => { throw confirmedFault() } })
    const incident = await host.recall('needle', 8, caller, 'sessions')
    assert.match(incident, /已熔断.*SQLITE_CORRUPT/)
    absentSecrets(incident)
    host._ctxRef = { get() { throw secretError() } }
    const lookup = await host.recall('needle', 8, caller, 'sessions')
    assert.match(lookup, /检索失败/)
    assert.doesNotMatch(lookup, /已熔断/)
    absentSecrets(lookup)
  }
  await new Promise(resolve => setImmediate(resolve))
})

test('exception projection redacts messages, paths, query secrets, content and malicious values within bounds', () => {
  for (const error of [secretError(), 'arbitrary secret', null, new Proxy({}, { get() { throw secretError() } }), { name: 'evil\n'.repeat(1000), code: 'TOKEN_SECRET', message: 'private content'.repeat(10000) }, { toString() { throw secretError() } }]) {
    const reason = diagnosticErrorReasonPre(error)
    assert.ok(reason.length <= DEGRADE_REASON_MAX_PRE_V1)
    assert.doesNotMatch(reason, /[\r\n\u2028\u2029]|private|evil|TOKEN_SECRET/)
    absentSecrets(reason)
  }
  let accesses = 0
  const changing = Object.defineProperty({}, 'name', { get() { return accesses++ === 0 ? 'Error' : 'credential123' } })
  absentSecrets(diagnosticErrorReasonPre(changing))
  assert.equal(accesses, 1)
  assert.match(diagnosticErrorReasonPre(new Error('SESSION_QUERY_PERSISTENCE_FAILED: private content')), /code=SESSION_QUERY_PERSISTENCE_FAILED/)
  assert.doesNotMatch(diagnosticErrorReasonPre(new Error('X'.repeat(3000) + ' SESSION_QUERY_PERSISTENCE_FAILED')), /code=/)
  assert.doesNotThrow(() => recordDiagnosticErrorPre({ record() { throw secretError() } }, 'session-search', secretError()))
})

const memoryId = 'mem_' + 'a'.repeat(32)
const noteBody = `# Notes\n<!-- memory:${memoryId} -->\nOriginal conclusion\n`
async function noteFixture(overrides) {
  const fixture = await harness(overrides)
  fixture.notes = path.join(fixture.home, 'MEMORY.md')
  await fsp.writeFile(fixture.notes, noteBody)
  return fixture
}
test('note status write failure is recorded, private error hidden, previous text kept, recovery truthful', async () => {
  const { notes, host } = await noteFixture()
  const write = host.writeFull.bind(host)
  host.writeFull = async () => { throw secretError() }
  const result = await host.applyNoteStatusPre(notes, { retract: [memoryId] }, noteBody)
  assert.match(result, /状态写入失败/)
  assert.doesNotMatch(result, /笔记已正常保存|状态已更新/)
  assert.equal(await fsp.readFile(notes, 'utf8'), noteBody)
  assert.equal(host._degradeSink.countOf('note-status'), 1)
  absentSecrets(result)
  absentSecrets(host._degradeSink.snapshot())
  host.writeFull = write
  assert.match(await host.applyNoteStatusPre(notes, { retract: [memoryId] }, noteBody), /状态已更新/)
  assert.match(await fsp.readFile(notes, 'utf8'), /retracted/)
  assert.equal(host._degradeSink.countOf('note-status'), 1)
  assert.match(await host.applyNoteStatusPre(notes, { retract: [memoryId] }, noteBody), /状态未变更/)
})

test('real read failure cannot overwrite from a stale body or claim a successful save', async () => {
  const { notes, host } = await noteFixture({ readFile: async () => { throw secretError() } })
  let writes = 0
  host.writeFull = async () => { writes++ }
  const result = await host.applyNoteStatusPre(notes, { retract: [memoryId] }, noteBody)
  assert.match(result, /状态写入失败/)
  assert.equal(writes, 0)
  assert.equal(host._degradeSink.countOf('note-status'), 1)
  absentSecrets(result)
})

test('audit log failure and post-save failure report what actually persisted', async () => {
  const { notes, host } = await noteFixture()
  host.appendText = async () => { throw secretError() }
  const result = await host.applyNoteStatusPre(notes, { retract: [memoryId] }, noteBody)
  assert.match(result, /状态已更新/)
  assert.match(result, /变更日志写入失败/)
  assert.match(await fsp.readFile(notes, 'utf8'), /retracted/)
  assert.equal(host._degradeSink.countOf('note-status'), 1)
  absentSecrets(result)
  const other = await noteFixture()
  Object.defineProperty(other.host.state, 'notesText', { set() { throw secretError() } })
  const postSave = await other.host.applyNoteStatusPre(other.notes, { retract: [memoryId] }, noteBody)
  assert.match(postSave, /状态正文已写入，但后续处理失败/)
  assert.match(await fsp.readFile(other.notes, 'utf8'), /retracted/)
})

test('real debugInfo/persistence/dashboard path exposes failures and persistence failure stays observable', async () => {
  const { home, host } = await harness()
  useSessionService(host, { searchSessions: async () => { throw confirmedFault() } })
  await host.recall('needle', 8, caller, 'sessions')
  host._ctxRef = { get() { throw secretError() } }
  assert.match(await host.recall('needle', 8, caller, 'sessions'), /检索失败/)
  // The existing dashboard also presents sanitized I/O error details for note status.
  const { notesPath } = await host.resolvePaths()
  await fsp.writeFile(notesPath, noteBody)
  host.writeFull = async () => { throw secretError() }
  assert.match(await host.applyNoteStatusPre(notesPath, { retract: [memoryId] }, noteBody), /状态写入失败/)
  assert.equal(host._degradeViewSnapshot().persisted, true)
  const data = await host.debugInfo()
  const degrade = data.associativeMemory.degrade
  // ★2026-11-02 判据更新（非产品缺陷 · 归因可复算）：原断言写 `persisted === false`，注释「Diagnostic GET is read-only」——
  //   那是 readOnly:true 引入后**记录当时行为**的判据，而那个行为本身就是 #478 的真缺陷：
  //   readOnly 让 `_persistObservabilityPre` 生产永不执行，降级台账停更 30 天。
  //   本源设计是「读驱动写」（见 degrade.js 注释：形态选择 = 读驱动写，由 debugInfo() 调用），
  //   ⇒ 去掉 readOnly 后 debugInfo 重新落盘，persisted 应为 true。下面紧跟的磁盘断言正是它的证据。
  assert.equal(degrade.persisted, true) // Diagnostic GET 读驱动写：debugInfo 一次即刷新降级台账
  assert.equal(degrade.counts['session-search'], 1)
  assert.equal(degrade.counts['session-recall-handler'], 1)
  assert.equal(degrade.counts['note-status'], 1)
  assert.equal(degrade.schemaVersion, 'degrade_pre_v1')
  const disk = JSON.parse(fs.readFileSync(path.join(home, 'memory/degrade/latest.json'), 'utf8'))
  assert.deepEqual(disk.counts, degrade.counts)
  assert.deepEqual(disk.recent.map(entry => entry.kind), ['session-search', 'session-recall-handler', 'note-status'])
  assert.match(disk.recent[0].reason, /code=SQLITE_CORRUPT; stage=execution/)
  assert.match(disk.recent[1].reason, /code=EACCES/)
  assert.match(disk.recent[2].reason, /code=EACCES/)
  assert.equal(disk.quota.schemaVersion, 'quota_probe_pre_v1')
  absentSecrets(disk)

  const start = client.indexOf('    function diagnosticFailureRowsPre(')
  assert.ok(start >= 0, 'dashboard projection present')
  const end = client.indexOf('    // ───────────────────────── 更新弹窗', start)
  const componentSource = client.slice(start, end)
  let calls = 0
  const tree = new Function('useState', 'useEffect', 'h', 'L', 't', 'locale', 'currentWs', 'fmtSize',
    componentSource + '\nreturn DebugCenter()')(
    (value) => [calls++ === 0 ? data : value, () => {}], () => {},
    (tag, props, ...children) => ({ tag, props, children }), (zh) => zh, (key) => key, 'zh', () => '', String)
  const rendered = JSON.stringify(tree)
  assert.match(rendered, /data-dam-degrade-ledger/)
  assert.match(rendered, /session-search/)
  assert.match(rendered, /Error \/ EACCES/)
  assert.match(rendered, /累计失败历史/)
  assert.match(rendered, /刷新诊断时更新到磁盘/)
  absentSecrets(tree)

  const failed = await harness({ writeFileSync: () => { throw secretError() } })
  failed.host._degradeSink.record('note-status', diagnosticErrorReasonPre(secretError()))
  const failedView = await failed.host.debugInfo()
  assert.equal(failedView.associativeMemory.degrade.persisted, false)
  assert.equal(failedView.associativeMemory.degrade.counts['note-status'], 1)
})

test('unchanged retention bounds apply to confirmed incidents across service generations', async () => {
  const { host } = await harness()
  host._degradeSink = createDegradeSinkPre({ cap: 2 })
  let calls = 0
  for (let i = 0; i < 5; i++) {
    useSessionService(host, { searchSessions: async () => { calls++; throw confirmedFault() } })
    const result = await host.searchSessionHistory('needle', 8, caller)
    assert.match(result.diagnostic, /已熔断/)
  }
  const snapshot = host._degradeSink.snapshot()
  assert.equal(calls, 5)
  assert.equal(snapshot.counts['session-search'], 5)
  assert.equal(snapshot.recent.length, 2)
  assert.equal(snapshot.evicted, 3)
  absentSecrets(snapshot)
})

test('a malformed host page reports an invalid response without fallback or an incident', async () => {
  const { host } = await harness()
  let scans = 0
  useSessionService(host, {
    searchSessions: async () => ({ items: {} }),
    filterSessions: async () => { scans++; return [] },
    filterEvents: async () => { scans++; return [] },
  })
  const result = await host.recall('needle', 8, caller, 'sessions')
  assert.match(result, /SESSION_QUERY_INVALID_RESPONSE/)
  assert.doesNotMatch(result, /已完成，未命中|熔断|会话命中/)
  assert.equal(scans, 0)
  assert.ok(host._degradeSink.isEmpty())
})

test('note-status remains fail-soft with a broken sink and unchanged skipped-status behavior', async () => {
  const { notes, host } = await noteFixture()
  host.writeFull = async () => { throw secretError() }
  host._degradeSink = { record: () => { throw secretError() } }
  absentSecrets(await host.applyNoteStatusPre(notes, { retract: [memoryId] }, noteBody))
  assert.match(await host.applyNoteStatusPre(notes, { retract: ['mem_' + 'b'.repeat(32)] }, noteBody), /状态未变更/)
  await fsp.writeFile(notes, '')
  assert.match(await host.applyNoteStatusPre(notes, {}, ''), /笔记为空/)
})

test('real memory_note callback confirms the completed note write and safely reports a status exception', async () => {
  const { notes, host } = await noteFixture()
  const sectionStart = source.indexOf("defineTool('memory_note'")
  const header = '}, async (args, exec, replay) => {'
  const start = source.indexOf(header, sectionStart) + header.length
  const end = source.indexOf("\n    }),\n\n    defineTool('memory_user'", start)
  assert.ok(sectionStart > 0 && start > sectionStart && end > start)
  const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor
  const callback = new AsyncFunction('args', 'exec', 'replay', 'engine', 'sanitizeForWrite', 'tailHas', 'writeGateRefusalTextPre', 'recordDiagnosticErrorPre', source.slice(start, end))
  host.resolvePaths = async () => ({ notesPath: notes })
  host.ensureBudget = async () => ({ ok: true })
  host.applyNoteStatusPre = async () => { throw secretError() }
  const result = await callback({ content: 'New conclusion', action: 'replace', retract: [memoryId] }, {}, undefined, host,
    (content) => ({ ok: true, clean: content }), () => false, () => '', recordDiagnosticErrorPre)
  assert.equal(await fsp.readFile(notes, 'utf8'), 'New conclusion')
  assert.match(result, /笔记写入已完成，但状态变更未确认/)
  assert.equal(host._degradeSink.countOf('note-status'), 1)
  absentSecrets(result)
})


test('normal head-budget truncation is distinct from a decode failure', () => {
  const observation = {}
  const huge = zstdCompressSync(Buffer.from('x'.repeat(100)))
  assert.equal(decodeZstdFramesHead(huge, 160, 8, observation), '')
  assert.equal(observation.limited, true)
  assert.equal(observation.failedFrames, 0)
})

test('scope=all preserves local hits and the empty fallback receipt; current skips history', async () => {
  const { host } = await harness()
  const { notesPath } = await host.resolvePaths()
  await fsp.writeFile(notesPath, 'A local note with needle context.\n')
  Object.assign(host, {
    listDailyLogs: async () => [], listReflections: async () => [],
    external: { search: async () => [] }, searchHandoffCorpus: async () => [],
  })
  let historyCalls = 0
  useSessionService(host, {
    searchSessions: async () => { historyCalls++; disabledSearch() },
    filterSessions: async () => [{ header: historyHeader('visible-session') }],
    filterEvents: async () => { throw secretError('EIO') },
  })
  const result = await host.recall('needle', 8, caller, 'all')
  assert.match(result, /A local note with needle context/)
  assert.match(result, /历史会话检索说明.*宿主可见消息接口.*部分会话未能读取或超出扫描范围/)
  assert.doesNotMatch(result, /历史 DSH 会话命中/)
  assert.ok(host._degradeSink.isEmpty())
  absentSecrets(result)
  const current = await host.recall('needle', 8, caller, 'current')
  assert.match(current, /A local note with needle context/)
  assert.doesNotMatch(current, /历史会话检索说明|历史 DSH 会话命中/)
  assert.equal(historyCalls, 1)
})

test('analogous Python rank catch records an actual sidecar exception once, while empty success stays quiet', async () => {
  const { host, home } = await harness()
  const start = source.indexOf('    engine._pySemanticRank = async')
  const end = source.indexOf('    // P13 择优', start)
  assert.ok(start > 0 && end > start)
  const engine = Object.assign(host, {
    config: { semanticEngineMode: 'python' }, resolveSemanticTier: async () => 'c3',
    _pythonModelReady: async () => true, preparePythonRecallPre: async () => true, pythonRuntimeCached: () => ({ chosen: 'fixture-python' }),
    _pythonSidecar: { request: async () => { throw secretError() } },
    _indexSyncHost: { ensureWorkspaceIndexReady: async () => [{ ready: true }] },
  })
  const registry = class { get() { return { ok: true, snapshot: { memoryIndexVersion: 'fixture', records: [{memoryId, scope:'Workspace'}] } } } }
  new Function('engine', 'buildSourceCatalog', 'CorpusRegistry', 'canonicalize', 'memoryDir', 'path', 'recordDiagnosticErrorPre',
    source.slice(start, end))(engine, () => ({}), registry, (s) => s, (s) => path.join(home, s), path, recordDiagnosticErrorPre)
  const snap = { pyPaths: { ws: home } }
  assert.equal(await engine._pySemanticRank(snap, 'needle'), null)
  assert.equal(engine._degradeSink.countOf('semantic-arm'), 1)
  absentSecrets(engine._degradeSink.snapshot())
  engine._pythonSidecar.request = async () => ({ ok: true, frame: { payload: { scores: [] } } })
  assert.equal(await engine._pySemanticRank(snap, 'needle'), null)
  assert.equal(engine._degradeSink.countOf('semantic-arm'), 1)
  engine._pythonSidecar.request = async () => ({ ok: true, frame: { payload: { scores: [{ memoryId, score: 0.8 }] } } })
  const result = await engine._pySemanticRank(snap, 'needle')
  assert.equal(result.scores.get(memoryId), 0.8)
  assert.equal(engine._degradeSink.countOf('semantic-arm'), 1)
})


test('head decoder recovers prefix and reports structural corruption only inside frame and byte budgets', () => {
  const prefix = 'recoverable-prefix'
  const frame = zstdCompressSync(Buffer.from(prefix))
  for (const tail of [Buffer.from('garbage'), Buffer.from([0x28, 0xb5, 0x2f, 0xfd])]) {
    const buf = Buffer.concat([frame, tail])
    const inBudget = {}
    assert.equal(decodeZstdFramesHead(buf, 2, 1024, inBudget), prefix)
    assert.deepEqual(inBudget, { failedFrames: 1, limited: false })
    for (const [frames, bytes] of [[1, 1024], [2, Buffer.byteLength(prefix)], [0, 1024], [2, 0]]) {
      const observation = {}
      assert.equal(decodeZstdFramesHead(buf, frames, bytes, observation), frames && bytes ? prefix : '')
      assert.deepEqual(observation, { failedFrames: 0, limited: true })
    }
    assert.deepEqual(scanZstdFrames(buf), [{ start: 0, end: frame.length }])
    assert.equal(decodeZstdFrames(buf), prefix)
  }
  const complete = {}
  assert.equal(decodeZstdFramesHead(frame, 1, Buffer.byteLength(prefix), complete), prefix)
  assert.deepEqual(complete, { failedFrames: 0, limited: false })
  const oversized = {}
  assert.equal(decodeZstdFramesHead(frame, 2, 3, oversized), '')
  assert.deepEqual(oversized, { failedFrames: 0, limited: true })
})

test('truncated header, block, checksum and reserved block type retain preceding complete frames', () => {
  const prefix = zstdCompressSync(Buffer.from('prefix'))
  // Minimal single-segment header (FCS=1), then one final raw block of one byte.
  const raw = Buffer.from([0x28, 0xb5, 0x2f, 0xfd, 0x20, 0x01, 0x09, 0, 0, 0x78])
  const badTails = [raw.subarray(0, 5), raw.subarray(0, 7), raw.subarray(0, 9),
    Buffer.from([0x28, 0xb5, 0x2f, 0xfd, 0x24, 0x01, 0x09, 0, 0, 0x78]),
    Buffer.from([0x28, 0xb5, 0x2f, 0xfd, 0x20, 0x01, 0x07, 0, 0])]
  for (const tail of badTails) {
    const buf = Buffer.concat([prefix, tail])
    const observation = {}
    assert.equal(decodeZstdFramesHead(buf, 8, 1024, observation), 'prefix')
    assert.deepEqual(observation, { failedFrames: 1, limited: false })
    assert.deepEqual(scanZstdFrames(buf), [{ start: 0, end: prefix.length }])
  }
})

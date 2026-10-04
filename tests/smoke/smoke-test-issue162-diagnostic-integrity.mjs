/** Issue #162: method-level integration with real production bodies, sink,
 * parser, persistence and head decoder. No DSH bootstrap, user data or APIs.
 * ISSUE162_SOURCE_ROOT selects an unfixed tree for red/green proof.
 */
import assert from 'node:assert/strict'
import { test, after } from 'node:test'
import * as fs from 'node:fs'
import * as fsp from 'node:fs/promises'
import path from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { zstdCompressSync, zstdDecompressSync } from 'node:zlib'
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
  'async searchSessionHistory(', 'lexicalSessionScanFallback(', 'async applyNoteStatusPre(',
  'async recall(', 'async readTextSafe(', 'async writeFull(', '_degradeViewSnapshot(',
  '_quotaViewSnapshot(', '_persistObservabilityPre(', 'async debugInfo(',
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
import { memoryWriteError } from ${JSON.stringify(url('memory-writer.js'))}
import { persistDegradeLedgerPre, deriveQuotaVerdictPre } from ${JSON.stringify(url('degrade.js'))}
import { decodeZstdFramesHead as realDecode } from ${JSON.stringify(url('subagent-gc.js'))}
import { recordDiagnosticErrorPre } from ${JSON.stringify(pathToFileURL(path.join(ownRoot, 'lib/diagnostic-error.js')).href)}
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
 const { readdirSync, readFileSync, statSync, existsSync, mkdirSync, writeFileSync, readFile, readdir, stat, mkdir, writeFile } = io
 const zstdDec = 'zstdDec' in overrides ? overrides.zstdDec : true
 const decodeZstdFramesHead = overrides.decodeZstdFramesHead || realDecode
 return new (class ProductionHarness {
${methods}
 })()
}
`)
  const { make } = await import(pathToFileURL(modulePath).href)
  const host = make(overrides)
  Object.assign(host, {
    _degradeSink: createDegradeSinkPre(), config: {}, state: {}, _observerStats: {},
    currentRuntime: () => ({ agent: null }), peekRuntime: () => null,
    runtimes: { values: () => [] }, autoStats: { count: 0 },
    memoryIndexSnapshot: async () => ({}), _hubIoViewSnapshot: () => null,
    _factsPruneViewSnapshot: () => null, _logsViewSnapshot: () => null,
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
function session(home, id, content, { frames = 0, size = 0, name = 'session.jsonl.zstd', mtime = 1000 } = {}) {
  const dir = path.join(home, 'sessions/ws', id)
  fs.mkdirSync(dir, { recursive: true })
  const lines = [JSON.stringify({ type: 'session', id, createdAt: '2026-09-30T00:00:00Z', cwd: id })]
  for (let i = 0; i < frames; i++) lines.push(JSON.stringify({ type: 'user/message', data: { content: 'unrelated-' + i } }))
  lines.push(JSON.stringify({ type: 'user/message', data: { content } }))
  const file = path.join(dir, name)
  fs.writeFileSync(file, Buffer.concat(lines.map((line) => zstdCompressSync(Buffer.from(line + '\n')))))
  if (size) fs.truncateSync(file, size)
  fs.utimesSync(file, mtime, mtime)
  return file
}
const secretError = () => Object.assign(new Error('Bearer credential123\nhttps://user:pass@host/private?token=URLSECRET\nC:\\Users\\PERSONAL\\secret.md /home/PERSONAL/secret.md\n正文私人内容\n' + 'X'.repeat(6000)), { code: 'EACCES' })
const brokenQuery = () => ({ searchSessions: async () => { throw secretError() } })
const absentSecrets = (value) => {
  // Real ISO timestamps can contain second/minute 39; only prose must reject the stale hardcoded count.
  const inspected = JSON.stringify(value, (key, item) => ['at', 'updatedAt'].includes(key) && typeof item === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/.test(item) ? '[timestamp]' : item)
  assert.doesNotMatch(inspected, /credential123|URLSECRET|PERSONAL|正文私人内容|user:pass|Bearer|\b39\s*(?:个?旧会话|old sessions\b)|"39"|descriptor v2|v0→v1/)
}

test('secret guard permits ISO timestamps containing 39 but rejects stale prose and credentials', () => {
  absentSecrets({updatedAt:'2026-10-03T09:41:39.000Z',recent:[{at:'2026-10-03T09:39:00.000Z',reason:'message=[redacted]'}]})
  for(const value of ['39 old sessions','Bearer credential123',{at:'credential123'}])assert.throws(()=>absentSecrets(value))
})

// This suite checks diagnostic integrity, not host clock/PID formatting. Real
// debugInfo values vary across runs and a locale clock can contain standalone 39.
// Fix only the two runtime display inputs; keep the secret/stale-prose guard intact.
function dashboardFixture(data) {
  assert.ok(Number.isSafeInteger(data.host.pid) && data.host.pid > 0, 'debugInfo PID is numeric')
  assert.ok(typeof data.host.startTime === 'number' && Number.isFinite(data.host.startTime), 'debugInfo startTime is numeric')
  return { ...data, host: { ...data.host, pid: 162, startTime: Date.UTC(2026, 8, 30) } }
}

test('dashboard fixture fixes only runtime clock/PID and keeps the integrity guard strict', () => {
  for (const stamp of ['2026-10-03T11:39:17.000Z', '2026-10-03T11:17:39.000Z']) {
    const data = { host: { pid: 39, startTime: Date.parse(stamp), version: 'fixture' } }
    const fixture = dashboardFixture(data)
    assert.deepEqual(fixture.host, { pid: 162, startTime: Date.UTC(2026, 8, 30), version: 'fixture' })
    assert.deepEqual(data.host, { pid: 39, startTime: Date.parse(stamp), version: 'fixture' }, 'original debugInfo stays intact')
    absentSecrets(fixture)
    for (const bad of ['39 old sessions', '39', 'Bearer credential123', 'URLSECRET', 'PERSONAL', '正文私人内容', 'user:pass', 'descriptor v2', 'v0→v1']) {
      assert.throws(() => absentSecrets(dashboardFixture({ ...data, children: [bad] })), 'guard still rejects ' + bad)
      assert.throws(() => absentSecrets(dashboardFixture({ ...data, host: { ...data.host, version: bad } })), 'other host fields are inspected')
    }
    for (const key of ['pid', 'startTime']) {
      assert.throws(() => dashboardFixture({ ...data, host: { ...data.host, [key]: 'Bearer credential123' } }), 'runtime fixture requires numeric ' + key)
    }
  }
})

test('privacy checks accept timestamp second 39 but reject obsolete session claims and secrets', () => {
  absentSecrets({ updatedAt: '2026-10-02T09:51:39.000Z', count: 39 })
  for (const value of ['39个旧会话', '39 old sessions', 'credential123', 'URLSECRET', 'PERSONAL', '正文私人内容', 'user:pass', 'Bearer', 'descriptor v2', 'v0→v1']) {
    assert.throws(() => absentSecrets(value), assert.AssertionError)
  }
})


test('missing capability, missing method, successful empty and successful hit stay distinct', async () => {
  const { home, host } = await harness()
  session(home, 'local-hit', 'needle')
  let scans = 0
  const scan = host.lexicalSessionScanFallback.bind(host)
  host.lexicalSessionScanFallback = (...args) => { scans++; return scan(...args) }
  for (const sq of [undefined, {}]) {
    host._sessionQuery = sq
    const output = await host.recall('needle', 8, undefined, 'sessions')
    assert.match(output, /能力未提供/)
    assert.doesNotMatch(output, /会话命中|抛错/)
  }
  host._sessionQuery = { searchSessions: async () => ({ items: [] }) }
  const empty = await host.recall('needle', 8, undefined, 'sessions')
  assert.match(empty, /已完成，未命中/)
  assert.doesNotMatch(empty, /未部署|抛错|兜底口径/)
  host._sessionQuery = { searchSessions: async () => ({ items: [{ header: { id: 'host-hit', createdAt: '2026-09-30' }, bestMatch: { snippet: 'needle' } }] }) }
  const hit = await host.recall('needle', 8, undefined, 'sessions')
  assert.match(hit, /host-hit/)
  assert.equal(scans, 0)
  assert.ok(host._degradeSink.isEmpty())
})

test('thrown host query uses truthful fallback and the real counters/recent, once per call', async () => {
  const { home, host } = await harness()
  session(home, 'only-v3-data', 'needle', { name: 'session.v3.jsonl.zstd' })
  host._sessionQuery = brokenQuery()
  for (let i = 1; i <= 2; i++) {
    const result = await host.recall('needle', 8, undefined, 'sessions')
    assert.match(result, /only-v3-data/)
    assert.match(result, /宿主会话检索抛错/)
    assert.match(result, /具体成因未确定/)
    assert.match(result, /本次尝试 1 个，读到非空头部 1 个/)
    absentSecrets(result)
    assert.equal(host._degradeSink.countOf('session-search'), i)
    assert.equal(host._degradeSink.snapshot().recent.length, i)
    assert.equal(host._degradeSink.countOf('session-scan'), 0)
  }
  assert.match(host._degradeSink.snapshot().recent[0].reason, /code=EACCES/)
  absentSecrets(host._degradeSink.snapshot())
})

test('empty fallback reports bounded scan, and recovery carries no stale request diagnostics', async () => {
  const { home, host } = await harness()
  session(home, 'no-hit', 'unrelated')
  host._sessionQuery = brokenQuery()
  const lines = await host.searchSessionHistory('needle')
  assert.equal(lines.length, 0)
  assert.match(lines.diagnostic, /扫描范围内未命中/)
  assert.match(await host.recall('needle', 8, undefined, 'sessions'), /非全量/)
  host._sessionQuery = { searchSessions: async () => ({ items: [] }) }
  const success = await host.searchSessionHistory('needle')
  assert.equal(success.diagnostic, undefined)
  assert.doesNotMatch(await host.recall('needle', 8, undefined, 'sessions'), /兜底|抛错|EACCES/)
  assert.equal(host._degradeSink.countOf('session-search'), 2) // retained failure history
})

test('concurrent requests share history but never explanations or hits', async () => {
  const { home, host } = await harness()
  session(home, 'fallback-hit', 'failing-query')
  let release
  const gate = new Promise((resolve) => { release = resolve })
  host._sessionQuery = { searchSessions: async ({ query }) => {
    if (query === 'failing-query') { await gate; throw secretError() }
    return { items: [{ header: { id: 'clean-host-hit' }, bestMatch: { snippet: query } }] }
  } }
  const failure = host.recall('failing-query', 8, undefined, 'sessions')
  const success = await host.recall('successful-query', 8, undefined, 'sessions')
  release()
  assert.match(await failure, /fallback-hit/)
  assert.doesNotMatch(success, /兜底|抛错|fallback-hit/)
  assert.equal(host._degradeSink.countOf('session-search'), 1)
})

test('missing decoder, absent directory and root IO failure do not masquerade as empty success', async () => {
  const noDecoder = await harness({ zstdDec: false })
  noDecoder.host._sessionQuery = brokenQuery()
  assert.match(await noDecoder.host.recall('needle', 8, undefined, 'sessions'), /缺少 zstd 解码能力，未扫描/)
  assert.equal(noDecoder.host._degradeSink.countOf('session-scan'), 0)
  const absent = await harness()
  absent.host._sessionQuery = brokenQuery()
  assert.match(await absent.host.recall('needle', 8, undefined, 'sessions'), /目录不存在/)
  assert.equal(absent.host._degradeSink.countOf('session-scan'), 0)
  const denied = await harness({ readdirSync: () => { throw secretError() } })
  denied.host._sessionQuery = brokenQuery()
  const result = await denied.host.recall('needle', 8, undefined, 'sessions')
  assert.match(result, /目录读取失败，无法判断/)
  assert.doesNotMatch(result, /会话命中/)
  assert.equal(denied.host._degradeSink.countOf('session-scan'), 1)
  absentSecrets(result)
})

test('scan read/decode failures aggregate once and preserve usable hits', async () => {
  const { home, host } = await harness({ readFileSync: (file) => {
    if (file.includes('unreadable')) throw secretError()
    return fs.readFileSync(file)
  } })
  session(home, 'unreadable', 'needle')
  const bad = session(home, 'undecodable', 'needle')
  fs.writeFileSync(bad, 'broken')
  session(home, 'usable', 'needle')
  host._sessionQuery = brokenQuery()
  const result = await host.recall('needle', 8, undefined, 'sessions')
  assert.match(result, /usable/)
  assert.match(result, /目录\/文件读取或头部解码失败 2 次/)
  assert.equal(host._degradeSink.countOf('session-scan'), 1)
  assert.equal(host._degradeSink.countOf('session-search'), 1)
  absentSecrets(result)
})

test('scan cap counts failed attempts, newest order and oversized skip before file read', async () => {
  let reads = 0
  const { home, host } = await harness({ readFileSync: (file) => { reads++; return fs.readFileSync(file) } })
  session(home, 'old-hit', 'needle', { mtime: 1 })
  session(home, 'newest-oversized', 'needle', { size: 17 * 1024 * 1024, mtime: 1000 })
  for (let i = 0; i < 80; i++) {
    const file = session(home, 'broken-' + i, 'needle', { mtime: 100 + i })
    fs.writeFileSync(file, 'broken')
    fs.utimesSync(file, 100 + i, 100 + i)
  }
  const result = host.lexicalSessionScanFallback('needle')
  assert.equal(result.length, 0)
  assert.equal(reads, 79)
  assert.match(result.diagnostic, /最多尝试 80 个会话；本次尝试 80 个/)
  assert.match(result.diagnostic, /超大跳过 1 个/)
  assert.equal(host._degradeSink.countOf('session-scan'), 1)
})

test('frame and byte budgets really constrain production head decoding', async () => {
  const { home, host } = await harness()
  session(home, 'too-late', 'tailneedle', { frames: 160 })
  const output = host.lexicalSessionScanFallback('tailneedle')
  assert.equal(output.length, 0)
  assert.match(output.diagnostic, /最多 160 帧 \/ 4MiB/)
  const oversizedFrame = zstdCompressSync(Buffer.from('x'.repeat(4 * 1024 * 1024 + 1)))
  assert.ok(Buffer.byteLength(decodeZstdFramesHead(oversizedFrame, 160, 4 * 1024 * 1024)) <= 4 * 1024 * 1024)
  const frames = Buffer.concat(['1234', '5678', 'overflow'].map((s) => zstdCompressSync(Buffer.from(s))))
  assert.equal(decodeZstdFramesHead(frames, 3, 8), '12345678')
  // A valid frame that cannot be decoded within the remaining byte budget still
  // consumes a frame attempt; it must not allow a later frame beyond maxFrames.
  assert.equal(decodeZstdFramesHead(Buffer.concat([oversizedFrame, zstdCompressSync(Buffer.from('later'))]), 1, 8), '')
})

test('throwing and rejecting sinks/scanners cannot break fail-soft recall', async () => {
  for (const sink of [{ record: () => { throw secretError() } }, { record: () => Promise.reject(secretError()) }, Object.defineProperty({}, 'record', { get() { throw secretError() } })]) {
    const { home, host } = await harness()
    session(home, 'usable', 'needle')
    host._sessionQuery = brokenQuery()
    host._degradeSink = sink
    assert.match(await host.recall('needle', 8, undefined, 'sessions'), /usable/)
    host.lexicalSessionScanFallback = () => { throw secretError() }
    const output = await host.recall('needle', 8, undefined, 'sessions')
    assert.match(output, /扫描失败，无法判断/)
    absentSecrets(output)
  }
  await new Promise((resolve) => setImmediate(resolve))
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
  session(home, 'local', 'needle')
  host._sessionQuery = brokenQuery()
  await host.recall('needle', 8, undefined, 'sessions')
  assert.equal(host._degradeViewSnapshot().persisted, true)
  const data = await host.debugInfo()
  const degrade = data.associativeMemory.degrade
  assert.equal(degrade.persisted, false) // Diagnostic GET is read-only.
  assert.equal(degrade.counts['session-search'], 1)
  assert.equal(degrade.schemaVersion, 'degrade_pre_v1')
  const disk = JSON.parse(fs.readFileSync(path.join(home, 'memory/degrade/latest.json'), 'utf8'))
  assert.equal(disk.counts['session-search'], 1)
  assert.equal(disk.recent.length, 1)
  assert.equal(disk.quota.schemaVersion, 'quota_probe_pre_v1')
  absentSecrets(disk)
  const dashboardData = dashboardFixture(data)

  const start = client.indexOf('    function diagnosticFailureRowsPre(')
  assert.ok(start >= 0, 'dashboard projection present')
  const end = client.indexOf('    // ───────────────────────── 更新弹窗', start)
  const componentSource = client.slice(start, end)
  let calls = 0
  const tree = new Function('useState', 'useEffect', 'h', 'L', 't', 'locale', 'currentWs', 'fmtSize',
    componentSource + '\nreturn DebugCenter()')(
    (value) => [calls++ === 0 ? dashboardData : value, () => {}], () => {},
    (tag, props, ...children) => ({ tag, props, children }), (zh) => zh, (key) => key, 'zh', () => '', String)
  const rendered = JSON.stringify(tree)
  assert.match(rendered, /data-dam-degrade-ledger/)
  assert.match(rendered, /session-search/)
  assert.match(rendered, /Error \/ EACCES/)
  assert.match(rendered, /累计失败历史/)
  if (client.includes('刷新诊断不会写入磁盘')) assert.match(rendered, /刷新诊断不会写入磁盘/)
  else assert.match(rendered, /刷新诊断时更新到磁盘/)
  absentSecrets(tree)

  const failed = await harness({ writeFileSync: () => { throw secretError() } })
  failed.host._degradeSink.record('note-status', diagnosticErrorReasonPre(secretError()))
  const failedView = await failed.host.debugInfo()
  assert.equal(failedView.associativeMemory.degrade.persisted, false)
  assert.equal(failedView.associativeMemory.degrade.counts['note-status'], 1)
})

test('unchanged retention bounds apply to newly wired diagnostic events', async () => {
  const { host } = await harness()
  host._degradeSink = createDegradeSinkPre({ cap: 2 })
  host._sessionQuery = brokenQuery()
  for (let i = 0; i < 5; i++) await host.searchSessionHistory('needle')
  const snapshot = host._degradeSink.snapshot()
  assert.equal(snapshot.counts['session-search'], 5)
  assert.equal(snapshot.recent.length, 2)
  assert.equal(snapshot.evicted, 3)
})


test('malformed successful host response is reported as processing failure, not a thrown host search', async () => {
  const { home, host } = await harness()
  session(home, 'fallback-hit', 'needle')
  host._sessionQuery = { searchSessions: async () => ({ items: {} }) }
  const result = await host.recall('needle', 8, undefined, 'sessions')
  assert.match(result, /结果处理失败/)
  assert.doesNotMatch(result, /宿主会话检索抛错/)
  assert.match(result, /fallback-hit/)
  assert.equal(host._degradeSink.countOf('session-search'), 1)
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
  const start = source.indexOf('}, async (args, exec) => {', sectionStart) + '}, async (args, exec) => {'.length
  const end = source.indexOf("\n    }),\n\n    defineTool('memory_user'", start)
  assert.ok(sectionStart > 0 && start > sectionStart && end > start)
  const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor
  const callback = new AsyncFunction('args', 'exec', 'engine', 'sanitizeForWrite', 'tailHas', 'writeGateRefusalTextPre', 'recordDiagnosticErrorPre', source.slice(start, end))
  host.resolvePaths = async () => ({ notesPath: notes })
  host.ensureBudget = async () => ({ ok: true })
  host.applyNoteStatusPre = async () => { throw secretError() }
  const result = await callback({ content: 'New conclusion', action: 'replace', retract: [memoryId] }, {}, host,
    (content) => ({ ok: true, clean: content }), () => false, () => '', recordDiagnosticErrorPre)
  assert.equal(await fsp.readFile(notes, 'utf8'), 'New conclusion')
  assert.match(result, /笔记写入已完成，但状态变更未确认/)
  assert.equal(host._degradeSink.countOf('note-status'), 1)
  absentSecrets(result)
})


test('normal head-budget truncation is visible and is not recorded as an unexpected decode failure', async () => {
  const { home, host } = await harness()
  session(home, 'head-limited', 'tailneedle', { frames: 160 })
  const output = host.lexicalSessionScanFallback('tailneedle')
  assert.equal(output.length, 0)
  assert.match(output.diagnostic, /头部受预算限制 1 个/)
  assert.equal(host._degradeSink.countOf('session-scan'), 0)
  const observation = {}
  const huge = zstdCompressSync(Buffer.from('x'.repeat(100)))
  assert.equal(decodeZstdFramesHead(huge, 160, 8, observation), '')
  assert.equal(observation.limited, true)
  assert.equal(observation.failedFrames, 0)
})

test('scope=all preserves empty fallback explanation without fabricating a sessions hit section', async () => {
  const { home, host } = await harness()
  session(home, 'no-hit', 'unrelated')
  Object.assign(host, {
    listDailyLogs: async () => [], listReflections: async () => [],
    external: { search: async () => [] }, searchHandoffCorpus: async () => [],
  })
  host._sessionQuery = brokenQuery()
  const result = await host.recall('needle', 8, undefined, 'all')
  assert.match(result, /历史 DSH 会话检索说明/)
  assert.doesNotMatch(result, /历史 DSH 会话命中/)
  assert.match(result, /非全量/)
  assert.equal(host._degradeSink.countOf('session-search'), 1)
  absentSecrets(result)
})


test('analogous Python rank catch records an actual sidecar exception once, while empty success stays quiet', async () => {
  const { host, home } = await harness()
  const start = source.indexOf('    engine._pySemanticRank = async')
  const end = source.indexOf('    // P13 择优', start)
  assert.ok(start > 0 && end > start)
  const engine = Object.assign(host, {
    config: { semanticEngineMode: 'python' }, resolveSemanticTier: async () => 'c3',
    _pythonSidecar: { request: async () => { throw secretError() } },
  })
  const registry = class { get() { return { ok: true, snapshot: { memoryIndexVersion: 'fixture' } } } }
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


test('migration candidates use newest mtime, v3 wins ties, and stat failure retains a usable candidate', async () => {
  const { home, host } = await harness()
  session(home, 'migrated', 'stale unrelated', { mtime: 1000 })
  session(home, 'migrated', 'needle newest', { name: 'session.v3.jsonl.zstd', mtime: 2000 })
  const latest = host.lexicalSessionScanFallback('needle')
  assert.equal(latest.length, 2) // One hit plus the compatibility footer.
  assert.match(latest[0], /needle newest/)
  session(home, 'migrated', 'needle tied v3', { name: 'session.v3.jsonl.zstd', mtime: 1000 })
  assert.match(host.lexicalSessionScanFallback('needle')[0], /needle tied v3/)
  // The old-name file can also be newer: compatibility is based on observation.
  session(home, 'migrated', 'needle newest old', { mtime: 3000 })
  assert.match(host.lexicalSessionScanFallback('needle')[0], /needle newest old/)
  for (const failingName of ['session.jsonl.zstd', 'session.v3.jsonl.zstd']) {
    const fixture = await harness({ statSync: (file) => {
      if (path.basename(file) === failingName) throw secretError()
      return fs.statSync(file)
    } })
    session(fixture.home, 'stat-failure', 'needle old')
    session(fixture.home, 'stat-failure', 'needle v3', { name: 'session.v3.jsonl.zstd' })
    const result = fixture.host.lexicalSessionScanFallback('needle')
    assert.equal(result.length, 2) // One hit plus the compatibility footer.
    assert.equal(fixture.host._degradeSink.countOf('session-scan'), 1)
    assert.match(result.diagnostic, /目录\/文件读取或头部解码失败 1 次/)
    absentSecrets(result)
  }
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

test('fallback keeps usable hits while aggregating an in-budget corrupt tail into the real sink', async () => {
  const { home, host } = await harness()
  const file = session(home, 'partial-corrupt', 'needle')
  fs.appendFileSync(file, Buffer.from([0x28, 0xb5, 0x2f, 0xfd]))
  const result = host.lexicalSessionScanFallback('needle')
  assert.equal(result.length, 2) // One hit plus the compatibility footer.
  assert.match(result[0], /needle/)
  assert.equal(host._degradeSink.countOf('session-scan'), 1)
  assert.match(result.diagnostic, /目录\/文件读取或头部解码失败 1 次/)
})

// Mixed legacy/current continuation filenames must expose the newest eight transcripts.
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, utimesSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

const home = mkdtempSync(path.join(tmpdir(), 'dam-transcript-discovery-'))
for (const key of ['DSH_HOME', 'USERPROFILE', 'HOME']) process.env[key] = home
globalThis.fetch = async () => { throw new Error('unexpected network access') }
const { MemoryEngine, flushDiagnostics } = await import('../lib/state-engine.mjs')
const RealDate = Date
const instant = '2026-10-08T12:00:00.000Z'
globalThis.Date = class extends RealDate {
  constructor(...args) { super(...(args.length ? args : [instant])) }
  static now() { return RealDate.parse(instant) }
}
const workspace = path.join(home, 'workspace')
mkdirSync(workspace)
const e = new MemoryEngine()
e.config = { handoffEnabled: true, autoContinueEnabled: true, boardMode: 'legacy' }
const current = (hash, stamp, seq) => 'prev-session-' + hash.repeat(64) + '-' + stamp + '-' + seq + '.md'
const oldTime = '2026-10-07T12:00:00.000Z'
function fixture(name) {
  const dir = path.join(home, name)
  mkdirSync(dir)
  return dir
}
function transcript(dir, name, when = oldTime, marker = name) {
  const file = path.join(dir, name)
  writeFileSync(file, marker)
  const time = new RealDate(when)
  utimesSync(file, time, time)
  return name
}

let pass = 0, fail = 0
async function test(name, fn) {
  try { await fn(); pass++; console.log('  ok - ' + name) }
  catch (err) { fail++; console.error('  FAIL - ' + name + ': ' + err.message) }
}
try {
  await test('production pack survives eight legacy files and handoff search reads its content', async () => {
    const handoffDir = fixture('mixed')
    for (let i = 0; i < 8; i++) transcript(handoffDir, 'prev-session-ffffffff-10000' + i + '.md')
    const sid = 'ffffffff-1111-4111-8111-111111111111'
    const sessionDir = path.join(home, 'sessions', 'project', sid)
    mkdirSync(sessionDir, { recursive: true })
    writeFileSync(path.join(sessionDir, 'session.jsonl'), [
      JSON.stringify({ cwd: workspace }),
      JSON.stringify({ type: 'user/message', data: { message: { role: 'user', content: [{ type: 'text', text: 'NEW_UNFINISHED_TARGET' }] } } }),
    ].join('\n') + '\n')
    const p = { ws: workspace, wsBound: true, handoffDir, planPath: path.join(handoffDir, 'PLAN.md') }
    e.resolvePathsForSession = async () => p
    const pack = await e.buildPrevSessionPack(sid)
    assert.ok(pack && pack.transcriptPath)
    const files = await e.listPrevSessionTranscripts(handoffDir)
    assert.equal(files.length, 8)
    const hits = await e.searchHandoffCorpus(['new_unfinished_target'], 20, p)
    assert.equal(hits.length, 1)
    assert.equal(hits[0].where, '旧会话转写/' + path.basename(pack.transcriptPath))
    assert.equal(files[0], path.basename(pack.transcriptPath))
    e.config.handoffEnabled = false
    assert.deepEqual(await e.searchHandoffCorpus(['new_unfinished_target'], 20, p), [])
    e.config.handoffEnabled = true
  })
  await test('different sources sort by full UTC time across midnight before truncation', async () => {
    const dir = fixture('sources')
    const expected = []
    for (let i = 0; i < 8; i++) expected.unshift(transcript(dir, current('f', '2026100823595900' + i, 100), oldTime, i === 0 ? 'EXCLUDED_OLDEST_TARGET' : 'older'))
    const latest = transcript(dir, current('0', '20261009000000000', 1), '2030-01-01T00:00:00Z', 'LATEST_DAY_TARGET')
    assert.deepEqual(await e.listPrevSessionTranscripts(dir), [latest, ...expected.slice(0, 7)])
    assert.equal((await e.searchHandoffCorpus(['latest_day_target'], 20, { handoffDir: dir }))[0].where, '旧会话转写/' + latest)
    assert.deepEqual(await e.searchHandoffCorpus(['excluded_oldest_target'], 20, { handoffDir: dir }), [])
  })
  await test('same millisecond uses numeric sequence 9/10 across sources and beyond safe integers', async () => {
    const dir = fixture('sequence')
    const nine = transcript(dir, current('f', '20261008120000000', 9))
    const ten = transcript(dir, current('0', '20261008120000000', 10))
    const next = transcript(dir, current('f', '20261008120000001', 1))
    assert.deepEqual(await e.listPrevSessionTranscripts(dir), [next, ten, nine])
    const sameSourceTen = transcript(dir, current('f', '20261008120000000', 10))
    assert.ok((await e.listPrevSessionTranscripts(dir)).indexOf(sameSourceTen) < (await e.listPrevSessionTranscripts(dir)).indexOf(nine))
    assert.deepEqual(await e.listPrevSessionTranscripts(dir, 1), [next])
    assert.deepEqual(await e.listPrevSessionTranscripts(dir, 0), [])
    const bigA = transcript(dir, current('f', '20261008120000000', '9007199254740992'))
    const bigB = transcript(dir, current('0', '20261008120000000', '9007199254740993'))
    assert.deepEqual(await e.listPrevSessionTranscripts(dir), [next, bigB, bigA, sameSourceTen, ten, nine])
  })
  await test('legacy timestamps use mtime including a newer legacy file across midnight', async () => {
    const dir = fixture('legacy')
    const old = transcript(dir, 'prev-session-ffffffff-235959.md', '2026-10-07T23:59:59Z')
    const recent = transcript(dir, 'prev-session-00000000-000001.md', '2026-10-09T00:00:01Z')
    const middle = transcript(dir, current('a', '20261008120000000', 1), '2030-01-01T00:00:00Z')
    assert.deepEqual(await e.listPrevSessionTranscripts(dir), [recent, middle, old])
  })
  await test('invalid or unrecognized full timestamps fall back to mtime', async () => {
    const dir = fixture('invalid')
    const invalidDate = transcript(dir, current('f', '20260230000000000', 1), '2026-10-07T12:00:00Z')
    const invalidHour = transcript(dir, current('f', '20261008250000000', 2), '2026-10-09T12:00:00Z')
    const unknown = transcript(dir, 'prev-session-other-name.md', '2026-10-08T12:00:01Z')
    const valid = transcript(dir, current('0', '20261008120000000', 3))
    assert.deepEqual(await e.listPrevSessionTranscripts(dir), [invalidHour, unknown, valid, invalidDate])
  })
  await test('non-files do not consume slots and a missing directory remains fail-soft', async () => {
    const dir = fixture('non-files')
    mkdirSync(path.join(dir, current('f', '20261009120000000', 1)))
    const file = transcript(dir, 'prev-session-00000000-120000.md')
    transcript(dir, 'unrelated.md', '2030-01-01T00:00:00Z')
    assert.deepEqual(await e.listPrevSessionTranscripts(dir), [file])
    assert.deepEqual(await e.listPrevSessionTranscripts(path.join(dir, 'absent')), [])
  })
  console.log('[transcript-discovery] ' + pass + ' passed, ' + fail + ' failed')
  if (fail) process.exitCode = 1
} finally {
  globalThis.Date = RealDate
  await flushDiagnostics()
  rmSync(home, { recursive: true, force: true })
}

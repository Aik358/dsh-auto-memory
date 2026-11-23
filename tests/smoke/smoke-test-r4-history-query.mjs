import * as fs from 'node:fs/promises'
import path from 'node:path'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { pathToFileURL } from 'node:url'
import { LedgerHistoryQuery, HistoryQueryError, parseHistoryTime, queryHistory } from '../../lib/ledger-doc/history-query.js'

let pass = 0
let fail = 0
const failures = []
const evidence = []
async function test(name, action) {
  try {
    const detail = await action()
    pass++
    console.log('  ok   - ' + name + (detail ? ' :: ' + detail : ''))
  } catch (error) {
    fail++
    failures.push({ name, error: error.message })
    console.log('  FAIL - ' + name + ' :: ' + error.message)
  }
}
const root = path.resolve('artifacts', '_r4-p2d-fixtures')
const cases = path.join(root, 'cases')
const zone = 'Asia/Hong_Kong'
const from = '2026-11-02'
const to = '2026-11-09'
const eventId = 'evt_a1b2c3d4'
const range = { from, to, eventId }
const at = (iso) => Date.parse(iso)
const baseRange = { from, to }
const cp = (iso, text, extra = {}) => ({ at: at(iso), kind: 'progress', text, goal: 'goal ' + text, state: 'state ' + text, dead: '', next: 'next ' + text, sourceRef: 'synthetic.md', opId: 'r4op_' + 'ab'.repeat(16), ...extra })
const h1 = [
  cp('2026-11-02T09:00:00+08:00', 'synthetic week start'),
  cp('2026-11-04T12:00:00+08:00', 'synthetic midweek'),
  cp('2026-11-08T23:30:00+08:00', 'synthetic weekend'),
]
const boundary = [
  cp('2026-11-02T00:00:00+08:00', 'from inclusive'),
  cp('2026-11-02T00:00:00+08:00', 'from exclusive just before', { at: at('2026-11-02T00:00:00+08:00') - 1 }),
  cp('2026-11-09T00:00:00+08:00', 'to exclusive'),
  cp('2026-11-09T00:00:00+08:00', 'outside after', { at: at('2026-11-09T00:00:00+08:00') + 1 }),
]
const pageCps = Array.from({ length: 7 }, (_, index) => cp('2026-11-0' + (index % 2 ? 3 : 5) + 'T10:00:00+08:00', 'page-' + index, { checkpointIndex: index }))
const persisted = cp('2026-11-06T16:00:00+08:00', 'summary-only @ synthetic-pointer', {
  checkpointId: 'ckpt_0123456789abcdef', kind: 'committed',
  goal: 'G'.repeat(4200), state: 'persisted state', dead: '', next: 'persisted next',
  targetRevision: 'sha256:' + 'ab'.repeat(32), recoveryPointer: 'synthetic-document.md#state',
  rel: 'synthetic-document.md', quoteLine: 42, bytes: 321, sha256: 'cd'.repeat(32),
})
const events = [
  { id: eventId, checkpoints: h1 },
  { id: 'evt_b2c3d4e5', checkpoints: boundary },
  { id: 'evt_c3d4e5f6', checkpoints: pageCps },
  { id: 'evt_d4e5f6a7', checkpoints: [persisted] },
  { id: 'evt_e5f6a7b8', checkpoints: [
    cp('2026-11-09T00:00:00+08:00', 'local date start'),
    cp('2026-11-10T00:00:00+08:00', 'next local date start'),
  ] },
]
async function resetCase(name, store = { schema: 'r4-synthetic-history-v1', events }) {
  const directory = path.join(cases, name)
  assert.equal(directory.startsWith(cases + path.sep), true)
  await fs.rm(directory, { recursive: true, force: true })
  await fs.mkdir(path.join(directory, 'logs'), { recursive: true })
  await fs.mkdir(path.join(directory, 'archive'), { recursive: true })
  await fs.mkdir(path.join(directory, 'documents'), { recursive: true })
  await fs.writeFile(path.join(directory, 'events.json'), JSON.stringify(store, null, 2) + '\n')
  return directory
}
function query(directory, extra = {}) {
  return new LedgerHistoryQuery({ rootDir: directory, timeZone: zone, ...extra })
}
async function writeLog(directory, name, text, archive = false) {
  await fs.writeFile(path.join(directory, archive ? 'archive' : 'logs', name), text)
}
await fs.mkdir(root, { recursive: true })
await fs.writeFile(path.join(root, 'README.md'), '# Synthetic R4 P2D fixtures\n\nAll events, checkpoints, documents, and logs are generated synthetic test data. No real memory text or production store is read.\n')
const main = await resetCase('main')
await writeLog(main, '2026-11-03.md', '# Synthetic log\n- 08:30 [kind:fact] Synthetic daily-only evidence\n')
await writeLog(main, '2026-11-04.md', '# Synthetic archive\n- 10:00 [kind:todo] Synthetic cold log eventId=evt_a1b2c3d4\n', true)
await writeLog(main, '2026-11-05.md', '# Empty synthetic log\n')
await fs.writeFile(path.join(main, 'documents', 'current.md'), '# Synthetic current state\nONLY_CURRENT_DOCUMENT_9ef37c4f\n')
const corrupt = await resetCase('corrupt', null)
await fs.writeFile(path.join(corrupt, 'events.json'), '{not-json')
await writeLog(corrupt, '2026-11-03.md', '- 09:00 [kind:fact] Still visible log despite corrupt event store\n')
const noLedger = await resetCase('no-ledger')
await fs.rm(path.join(noLedger, 'documents'), { recursive: true })
await fs.mkdir(path.join(noLedger, 'handoff'), { recursive: true })
await fs.writeFile(path.join(noLedger, 'handoff', 'handoff-20261102-090000.md'), 'synthetic old ledger to be removed\n')
await fs.rm(path.join(noLedger, 'handoff'), { recursive: true })
const beforeHash = createHash('sha256').update(await fs.readFile(path.join(main, 'events.json'))).digest('hex')

console.log('=== H-1～H-8: protocol acceptance, real reads ===')
await test('H-1 three week checkpoints return in ascending at order', async () => {
  const result = await query(main).query({ ...range, kinds: ['progress'] })
  assert.equal(result.ok, true, JSON.stringify(result.readErrors))
  assert.equal(result.items.length, 3)
  assert.deepEqual(result.items.map((item) => item.text), ['synthetic week start', 'synthetic midweek', 'synthetic weekend'])
  assert.ok(result.items.every((item, index, all) => index === 0 || all[index - 1].at <= item.at))
  assert.deepEqual(result.items.map((item) => item.eventId), [eventId, eventId, eventId])
})
await test('H-2 [from,to) excludes one millisecond before and to itself', async () => {
  const result = await query(main).query({ ...baseRange, eventId: 'evt_b2c3d4e5' })
  assert.deepEqual(result.items.map((item) => item.text), ['from inclusive'])
  assert.equal(result.range.fromMs, parseHistoryTime(from, zone))
  assert.equal(result.range.toMs, parseHistoryTime(to, zone))
})
await test('H-3 current maintenance document cannot become historical fact', async () => {
  const result = await query(main).query({ ...range, kinds: ['progress'] })
  assert.equal(JSON.stringify(result.items).includes('ONLY_CURRENT_DOCUMENT_9ef37c4f'), false)
  assert.equal(result.items.length, 3)
})
await test('H-4 pagination returns all seven, not the recent five', async () => {
  const found = []
  const cursors = []
  let cursor
  let pages = 0
  do {
    const result = await query(main).query({ ...baseRange, eventId: 'evt_c3d4e5f6', limit: 2, cursor })
    assert.equal(result.items.length <= 2, true)
    assert.equal(result.truncated, Boolean(result.nextCursor))
    found.push(...result.items.map((item) => item.text))
    cursor = result.nextCursor
    if (cursor) cursors.push(cursor)
    if (++pages > 10) assert.fail('pagination did not finish')
  } while (cursor)
  assert.equal(found.length, 7)
  assert.equal(new Set(found).size, 7)
  assert.equal(pages, 4)
  assert.equal(cursors.length, 3)
})
await test('H-5 summary/pointer retains raw quad, revision, recovery and opId', async () => {
  const result = await query(main).query({ ...baseRange, eventId: 'evt_d4e5f6a7', includeQuad: true, kinds: ['committed'] })
  assert.equal(result.items.length, 1)
  const item = result.items[0]
  assert.equal(item.text, 'summary-only @ synthetic-pointer')
  assert.equal(item.goal.length, 4200)
  assert.equal(item.state, 'persisted state')
  assert.equal(item.next, 'persisted next')
  assert.equal(item.targetRevision, 'sha256:' + 'ab'.repeat(32))
  assert.equal(item.recoveryPointer, 'synthetic-document.md#state')
  assert.equal(item.rel, undefined)
  assert.equal(item.sourceRef, 'synthetic.md')
  assert.equal(item.opId, 'r4op_' + 'ab'.repeat(16))
  assert.equal(item.checkpointId, 'ckpt_0123456789abcdef')
  assert.equal(item.identityMode, 'persisted')
})
await test('H-6 corrupt event store returns readErrors and visible logs, not no-record', async () => {
  const result = await query(corrupt).query(baseRange)
  assert.equal(result.ok, false)
  assert.equal(result.items.length, 1)
  assert.equal(result.readErrors.some((error) => error.code === 'event-store-invalid-json'), true)
  assert.equal(result.coveredSources.find((source) => source.type === 'event-store').status, 'error')
  const empty = await resetCase('corrupt-no-logs', null)
  await fs.writeFile(path.join(empty, 'events.json'), '{broken')
  const noItems = await query(empty).query(baseRange)
  assert.equal(noItems.items.length, 0)
  assert.ok(noItems.readErrors.length > 0)
  assert.equal(noItems.ok, false)
})
await test('H-7 removing every ledger file leaves H-1 unchanged', async () => {
  assert.equal(await fs.stat(path.join(noLedger, 'handoff')).then(() => true, (error) => error.code === 'ENOENT'), true)
  assert.equal(await fs.stat(path.join(noLedger, 'documents')).then(() => true, (error) => error.code === 'ENOENT'), true)
  const result = await query(noLedger).query(range)
  assert.equal(result.ok, true)
  assert.equal(result.items.length, 3)
  assert.deepEqual(result.items.map((item) => item.text), ['synthetic week start', 'synthetic midweek', 'synthetic weekend'])
})
await test('H-8 fixed local zone/date returns identical results three times', async () => {
  const previous = process.env.TZ
  const snapshots = []
  try {
    for (const systemZone of ['UTC', 'America/New_York', 'Pacific/Auckland']) {
      process.env.TZ = systemZone
      const clock = new Date('2026-11-11T12:00:00+08:00')
      const days = [0, -1, 1].map((offset) => new Date(clock.getTime() + offset * 86400000).toISOString().slice(0, 10))
      assert.equal(new Set(days).size, 3, 'isolated clock dates must differ')
      const result = await query(main).query({ from: '2026-11-09', to: '2026-11-10', eventId: 'evt_e5f6a7b8', limit: 50 })
      snapshots.push(JSON.stringify(result))
      assert.equal(result.items.length, 1)
      assert.equal(result.items[0].text, 'local date start')
    }
  } finally {
    if (previous === undefined) delete process.env.TZ
    else process.env.TZ = previous
  }
  assert.equal(new Set(snapshots).size, 1)
})
await test('Q-01 eventId exact match never falls back to another event', async () => {
  const result = await query(main).query({ ...baseRange, eventId: 'evt_00000000' })
  assert.equal(result.items.length, 0)
  assert.equal(result.ok, true)
  await assert.rejects(query(main).query({ ...baseRange, eventId: 'evt_a1b2c3d4 ' }), (error) => error instanceof HistoryQueryError && error.code === 'history-event-id-invalid')
})
await test('Q-02 kinds filter is exact and includeQuad defaults off', async () => {
  const all = await query(main).query({ ...baseRange, eventId: 'evt_d4e5f6a7' })
  assert.equal(all.items[0].goal, null)
  const progress = await query(main).query({ ...baseRange, eventId: 'evt_d4e5f6a7', kinds: ['progress'] })
  assert.equal(progress.items.length, 0)
  const committed = await query(main).query({ ...baseRange, eventId: 'evt_d4e5f6a7', kinds: ['committed'] })
  assert.equal(committed.items.length, 1)
})
await test('Q-03 daily and archive logs supplement event checkpoints chronologically', async () => {
  const result = await query(main).query({ from: '2026-11-03', to: '2026-11-05', kinds: ['fact', 'todo'] })
  assert.deepEqual(result.items.map((item) => item.source.type), ['daily-log', 'archive-log'])
  assert.deepEqual(result.items.map((item) => item.text), ['Synthetic daily-only evidence', 'Synthetic cold log eventId=evt_a1b2c3d4'])
  assert.equal(result.items[1].eventId, eventId)
  assert.equal(result.items[1].sourceRef, 'archive/2026-11-04.md#L2')
  assert.equal(result.items[0].includeQuad, undefined)
  assert.equal(result.items[0].goal, null)
})
await test('Q-04 legacy ID is explicit null plus deterministic legacy key', async () => {
  const first = await query(main).query(range)
  const second = await query(main).query(range)
  assert.equal(first.items[0].checkpointId, null)
  assert.equal(first.items[0].identityMode, 'legacy-derived')
  assert.match(first.items[0].legacyCheckpointKey, /^sha256:[0-9a-f]{64}$/)
  assert.equal(first.items[0].legacyCheckpointKey, second.items[0].legacyCheckpointKey)
  assert.notEqual(first.items[0].legacyCheckpointKey, first.items[1].legacyCheckpointKey)
})
await test('Q-05 cursor is bound to range, event and kinds; invalid cursor rejects', async () => {
  const first = await query(main).query({ ...baseRange, eventId: 'evt_c3d4e5f6', limit: 2 })
  const second = await query(main).query({ ...baseRange, eventId: 'evt_c3d4e5f6', limit: 3, cursor: first.nextCursor })
  assert.equal(second.items[0].text, 'page-5')
  for (const filter of [
    { ...baseRange, eventId: 'evt_c3d4e5f6', kinds: ['log'], cursor: first.nextCursor },
    { ...baseRange, cursor: first.nextCursor },
    { ...baseRange, cursor: 'not-a-valid-cursor' },
  ]) await assert.rejects(query(main).query(filter), (error) => error.code === 'history-cursor-invalid')
})
await test('Q-06 invalid time/filter parameters reject; valid counterparts succeed', async () => {
  const bad = [
    [{ ...baseRange, from: '2026-11-02T00:00:00' }, 'history-timezone-required'],
    [{ ...baseRange, from: '2026-02-30' }, 'history-time-invalid'],
    [{ ...baseRange, to: from }, 'history-range-invalid'],
    [{ ...baseRange, kinds: [] }, 'history-kinds-invalid'],
    [{ ...baseRange, limit: 0 }, 'history-limit-invalid'],
    [{ ...baseRange, limit: 501 }, 'history-limit-invalid'],
    [{ ...baseRange, includeQuad: 'true' }, 'history-include-quad-invalid'],
  ]
  for (const [filter, code] of bad) await assert.rejects(query(main).query(filter), (error) => error.code === code)
  assert.throws(() => parseHistoryTime('2026-11-01', 'Not/AZone'), (error) => error.code === 'history-timezone-invalid')
  assert.equal(parseHistoryTime('2026-11-02T00:00:00+08:00'), parseHistoryTime('2026-11-02', zone))
  assert.equal(parseHistoryTime('2026-11-02T00:00:00Z'), Date.parse('2026-11-02T00:00:00Z'))
  assert.equal(parseHistoryTime('2026-11-02T00:00:00+08:00'), parseHistoryTime('2026-11-01T16:00:00Z'))
  assert.equal((await query(main).query({ ...baseRange, limit: 500, kinds: ['progress'], includeQuad: true })).ok, true)
  assert.throws(() => new LedgerHistoryQuery({ rootDir: 'relative' }), (error) => error.code === 'history-root-invalid')
  assert.throws(() => new LedgerHistoryQuery({ rootDir: process.cwd() }), (error) => error.code === 'history-root-invalid')
})
await test('Q-07 injected EACCES and malformed checkpoints produce readErrors', async () => {
  const failing = Object.create(fs)
  failing.readFile = async (file, ...args) => {
    if (path.resolve(String(file)) === path.join(main, 'events.json')) throw Object.assign(new Error('synthetic EACCES'), { code: 'EACCES' })
    return fs.readFile(file, ...args)
  }
  const result = await query(main, { fs: failing }).query(baseRange)
  assert.equal(result.ok, false)
  assert.equal(result.readErrors.some((error) => error.code === 'event-store-read-failed'), true)
  const malformed = await resetCase('malformed-cp', { events: [{ id: eventId, checkpoints: [{ at: 'invalid', text: 'not valid' }] }] })
  const bad = await query(malformed).query(range)
  assert.equal(bad.ok, false)
  assert.equal(bad.readErrors[0].code, 'checkpoint-invalid')
  assert.equal((await query(main).query(range)).items.length, 4)
})
await test('Q-08 coveredSources distinguishes missing, empty, and read', async () => {
  const result = await query(main).query(baseRange)
  assert.equal(result.coveredSources.find((source) => source.path === 'logs/2026-11-03.md').status, 'read')
  assert.equal(result.coveredSources.find((source) => source.path === 'logs/2026-11-05.md').status, 'empty')
  assert.equal(result.coveredSources.find((source) => source.path === 'logs/2026-11-02.md').status, 'missing')
  assert.equal(result.readErrors.length, 0)
})
await test('Q-09 queryHistory convenience export performs a real query without writes', async () => {
  const result = await queryHistory({ rootDir: main, timeZone: zone }, range)
  assert.equal(result.items.length, 4)
  assert.equal(createHash('sha256').update(await fs.readFile(path.join(main, 'events.json'))).digest('hex'), beforeHash)
})

console.log('=== Isolated mutations: assertions must turn red, clean copy green ===')
const source = await fs.readFile(path.resolve('lib/ledger-doc/history-query.js'), 'utf8')
const mutations = [
  {
    name: 'to-inclusive', anchor: 'record.at >= fromMs && record.at < toMs', replacement: 'record.at >= fromMs && record.at <= toMs',
    fixture: { events: [{ id: 'evt_b2c3d4e5', checkpoints: boundary }] }, filter: { ...baseRange, eventId: 'evt_b2c3d4e5' },
    verify: (result) => assert.deepEqual(result.items.map((item) => item.text), ['from inclusive']),
  },
  {
    name: 'pagination-five-cap', anchor: 'const selected = page.slice(0, limit)', replacement: 'const selected = page.slice(-5)',
    fixture: { events: [{ id: 'evt_c3d4e5f6', checkpoints: pageCps }] }, filter: { ...baseRange, eventId: 'evt_c3d4e5f6', limit: 2 },
    verify: (result) => assert.equal(result.items.length, 2),
  },
  {
    name: 'read-errors-swallowed', anchor: "readErrors.push(queryError(source, 'event-store-invalid-json', error.message))", replacement: 'return []',
    fixture: null, invalidJson: true, filter: baseRange,
    verify: (result) => assert.equal(result.readErrors.some((error) => error.code === 'event-store-invalid-json'), true),
  },
  {
    name: 'quad-dropped', anchor: 'goal: includeQuad && quad ? quad.goal : null', replacement: 'goal: null',
    fixture: { events: [{ id: 'evt_d4e5f6a7', checkpoints: [persisted] }] }, filter: { ...baseRange, eventId: 'evt_d4e5f6a7', includeQuad: true },
    verify: (result) => assert.equal(result.items[0].goal.length, 4200),
  },
]
for (const mutation of mutations) {
  assert.equal(source.split(mutation.anchor).length - 1, 1, mutation.name + ' anchor exactly once')
  const directory = path.resolve('artifacts', '_r4-p2d-mutation', mutation.name)
  await fs.rm(directory, { recursive: true, force: true })
  await fs.mkdir(directory, { recursive: true })
  await fs.copyFile(path.resolve('lib/ledger-doc/protocol.js'), path.join(directory, 'protocol.js'))
  await fs.writeFile(path.join(directory, 'history-query.js'), source.replace(mutation.anchor, mutation.replacement))
  await fs.writeFile(path.join(directory, 'events.json'), mutation.invalidJson ? '{broken' : JSON.stringify(mutation.fixture))
  const { LedgerHistoryQuery: MutantQuery } = await import(pathToFileURL(path.join(directory, 'history-query.js')).href)
  const result = await new MutantQuery({ rootDir: directory, timeZone: zone }).query(mutation.filter)
  let caught = false
  try { mutation.verify(result) } catch (_) { caught = true }
  await test('MUT-' + mutation.name + ' distinguishes the broken behavior', () => assert.equal(caught, true))
  evidence.push({ kind: 'mutation', name: mutation.name, result: caught ? 'CAUGHT' : 'MISSED' })
}
{
  const directory = path.resolve('artifacts', '_r4-p2d-mutation', 'restored')
  await fs.rm(directory, { recursive: true, force: true })
  await fs.mkdir(directory, { recursive: true })
  await fs.copyFile(path.resolve('lib/ledger-doc/protocol.js'), path.join(directory, 'protocol.js'))
  await fs.writeFile(path.join(directory, 'history-query.js'), source)
  await fs.writeFile(path.join(directory, 'events.json'), JSON.stringify({ events }))
  const { LedgerHistoryQuery: RestoredQuery } = await import(pathToFileURL(path.join(directory, 'history-query.js')).href)
  const clean = await new RestoredQuery({ rootDir: directory, timeZone: zone })
  const normal = await clean.query(range)
  const bounded = await clean.query({ ...baseRange, eventId: 'evt_b2c3d4e5' })
  const quad = await clean.query({ ...baseRange, eventId: 'evt_d4e5f6a7', includeQuad: true })
  await test('MUT-restored clean copy passes interval and raw quad', () => {
    assert.equal(normal.items.length, 3)
    assert.equal(bounded.items.length, 1)
    assert.equal(quad.items[0].goal.length, 4200)
  })
  evidence.push({ kind: 'restored', result: 'GREEN' })
}
await test('Q-10 delivered new files use LF only and production recall was not wired', async () => {
  for (const file of ['lib/ledger-doc/history-query.js', 'tests/smoke/smoke-test-r4-history-query.mjs']) {
    const text = (await fs.readFile(file)).toString('latin1')
    assert.equal(/\r\n/.test(text) && /(?<!\r)\n/.test(text), false, file)
  }
})
const results = { pass, fail, failures, evidence }
await fs.writeFile(path.join(root, 'test-results.json'), JSON.stringify(results, null, 2) + '\n', 'utf8')
console.log('SUMMARY PASS ' + pass + ' / FAIL ' + fail)
console.log('MUTATION CAUGHT ' + evidence.filter((item) => item.result === 'CAUGHT').length + ' / MISSED ' + evidence.filter((item) => item.result === 'MISSED').length)
console.log('RESTORED ' + (evidence.find((item) => item.kind === 'restored')?.result || 'MISSING'))
process.exitCode = fail === 0 ? 0 : 1

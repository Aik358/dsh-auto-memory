import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { tmpdir } from 'node:os'
import { loadPrivateEngine } from '../lib/load-private-engine.mjs'
import { calendarMergePre } from '../../lib/migrate-pack.js'

const { MemoryEngine } = await loadPrivateEngine()
const dir = await fs.mkdtemp(path.join(tmpdir(), 'dam-420-calendar-'))
const file = path.join(dir, 'CALENDAR.md')
const engine = Object.create(MemoryEngine.prototype)
Object.defineProperty(engine, 'state', { value: {} })
engine.resolvePaths = async () => ({ calendarPath: file })
engine.userDirOf = () => dir
engine._assertTeamActionPre = () => {}
engine.writeFullRaw = async (target, text) => fs.writeFile(target, text)
const row = '- [ ] 09:00 | 不重要紧急 | repeat fixture | first\n    second'
const legacy = '## 2026-10-14\n' + row + '\n' + row + '\n'
const pack = { userFiles: { 'CALENDAR.md': legacy } }
try {
  await fs.writeFile(file, legacy)
  await engine.calendarAdd({ title: 'upgrade fixture', date: '2026-10-14', time: '10:00' })
  const upgraded = engine.calendarEntriesPre(await fs.readFile(file, 'utf8'))
  assert.equal(upgraded.length, 3)
  assert.notEqual(upgraded[0].id, upgraded[1].id, 'identical legacy rows are separate occurrences')
  await engine.calendarDone(upgraded[0].date, upgraded[0].time, upgraded[0].title, undefined, upgraded[0].id)
  const before = await fs.readFile(file, 'utf8')
  const imported = await engine._applyUserFilesPre(pack)
  assert.deepEqual(imported.skipped, [])
  const after = await fs.readFile(file, 'utf8')
  const rows = engine.calendarEntriesPre(after)
  assert.equal(rows.length, 3, 'reimporting an old pack must not create a second identity for upgraded rows')
  assert.equal(after, before, 'reimport preserves local completion and is a no-op')
  assert.equal(rows[0].done, true)
  assert.equal(rows[1].done, false)
  await engine.calendarDone(rows[1].date, rows[1].time, rows[1].title, undefined, rows[1].id)
  await engine.calendarRemove(rows[0].date, rows[0].time, rows[0].title, undefined, rows[0].id)
  assert.equal(engine.calendarEntriesPre(await fs.readFile(file, 'utf8')).length, 2)

  const firstImport = calendarMergePre('', legacy)
  const firstRows = engine.calendarEntriesPre(firstImport.text)
  assert.equal(firstRows.length, 2, 'migration retains the legacy multiset even on an empty target')
  assert.equal(calendarMergePre(firstImport.text, legacy).added, 0)
  const explicit = engine.renderCalendar(firstRows.map((en, i) => ({ ...en, id: 'cal_' + String(i + 8).repeat(32) })))
  assert.equal(engine.calendarEntriesPre(calendarMergePre(firstImport.text, explicit).text).length, 4,
    'different explicit IDs survive even when every content field is identical')
  const mixed = [firstRows[0], { ...firstRows[0], id: undefined }]
  assert.equal(new Set(engine.calendarEntriesPre(engine.renderCalendar(mixed)).map(en => en.id)).size, 2,
    'an explicit ID reserves its identity before legacy IDs are assigned')
  const malformed = engine.renderCalendar([firstRows[0], firstRows[0]])
  const beforeRejected = await fs.readFile(file, 'utf8')
  const rejected = await engine._applyUserFilesPre({ userFiles: { 'CALENDAR.md': malformed } })
  assert.equal(rejected.applied.length, 0, 'ambiguous imported explicit IDs must be rejected before writing')
  assert.equal(rejected.skipped.length, 1)
  assert.equal(await fs.readFile(file, 'utf8'), beforeRejected, 'rejected import leaves the target byte-for-byte intact')
  console.log('PASS PR420 legacy upgrade/reimport, duplicate occurrences, explicit IDs and later calendar operations')
} finally { await fs.rm(dir, { recursive: true, force: true }) }

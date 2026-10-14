import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { tmpdir } from 'node:os'
import { loadPrivateEngine } from '../lib/load-private-engine.mjs'
import { calendarMergePre } from '../../lib/migrate-pack.js'

const { MemoryEngine } = await loadPrivateEngine()
const dir = await fs.mkdtemp(path.join(tmpdir(), 'dam-calendar-identity-'))
const file = path.join(dir, 'CALENDAR.md')
const engine = Object.create(MemoryEngine.prototype)
Object.defineProperty(engine, 'state', { value: {} })
engine.resolvePaths = async () => ({ calendarPath: file })
engine._assertTeamActionPre = () => {}
engine.writeFullRaw = async (file, body) => fs.writeFile(file, body)
try {
  const legacy = '## 2026-10-14\n- [ ] 09:00 | 不重要紧急 | legacy-one\n- [ ] 10:00 | 历史自定义优先级 | keep-custom'
  await fs.writeFile(file, legacy)
  await engine.calendarAdd({ date: '2026-10-14', time: '11:00', title: 'A | B \\ 中文 🙂', note: 'N | extra \\ chars\nsecond | line', quadrant: '不重要紧急', operationId: 'fixture-operation' })
  let rows = engine.calendarEntriesPre(await fs.readFile(file, 'utf8'))
  assert.equal(rows.length, 3, 'legacy aliases and unknown historical priorities must survive rewrites')
  assert.equal(rows[0].quadrant, '紧急不重要')
  assert.equal(rows[1].quadrant, '历史自定义优先级')
  assert.equal(rows[2].title, 'A | B \\ 中文 🙂')
  assert.equal(rows[2].note, 'N | extra \\ chars\nsecond | line')
  await engine.calendarAdd({ date: '2026-10-14', time: '11:00', title: 'A | B \\ 中文 🙂', note: rows[2].note, quadrant: '不重要紧急', operationId: 'fixture-operation' })
  assert.equal(engine.calendarEntriesPre(await fs.readFile(file, 'utf8')).length, 3, 'a lost response retry is idempotent')
  await engine.calendarAdd({ date: '2026-10-14', time: '11:00', title: rows[2].title, note: 'different note', quadrant: '重要紧急' })
  rows = engine.calendarEntriesPre(await fs.readFile(file, 'utf8'))
  assert.equal(new Set(rows.map((row) => row.id)).size, 4)
  const second = rows[3]
  await assert.rejects(engine.calendarRemove(second.date, second.time, second.title), /ambiguous/)
  await engine.calendarDone(second.date, second.time, second.title, undefined, second.id)
  rows = engine.calendarEntriesPre(await fs.readFile(file, 'utf8'))
  assert.equal(rows[2].done, false); assert.equal(rows[3].done, true)
  await engine.calendarRemove(second.date, second.time, second.title, undefined, second.id)
  rows = engine.calendarEntriesPre(await fs.readFile(file, 'utf8'))
  assert.equal(rows.length, 3); assert.equal(rows[2].note, 'N | extra \\ chars\nsecond | line')
  const merged = calendarMergePre('', await fs.readFile(file, 'utf8'))
  const back = engine.calendarEntriesPre(merged.text)
  assert.deepEqual(back, rows, 'migration preserves stable IDs, aliases and escaped fields')
  console.log('PASS #383/#385/#388 calendar identity, field round trips and safe retry')
} finally { await fs.rm(dir, { recursive: true, force: true }) }

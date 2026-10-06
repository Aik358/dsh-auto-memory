/**
 * #254: execute production calendar Add/Done/Remove and parser against isolated files.
 * AUDIT_SOURCE_ROOT selects the unchanged source for a negative control.
 */
import assert from 'node:assert/strict'
import { test, after } from 'node:test'
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(process.env.AUDIT_SOURCE_ROOT || fileURLToPath(new URL('../../', import.meta.url)))
const sandbox = await mkdtemp(path.join(tmpdir(), 'calendar254-'))
const savedEnv = Object.fromEntries(['HOME', 'USERPROFILE', 'DSH_HOME'].map(k => [k, process.env[k]]))
for (const key of Object.keys(savedEnv)) process.env[key] = path.join(sandbox, key)
after(async () => {
  for (const [key, value] of Object.entries(savedEnv)) {
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
  await rm(sandbox, { recursive: true, force: true })
})
const source = (await readFile(path.join(root, 'lib/index.js'), 'utf8')).replace(/\r\n/g, '\n')
function method(signature, optional = false) {
  const marker = '  ' + signature
  const start = source.indexOf(marker)
  if (start < 0 && optional) return ''
  assert(start >= 0, 'missing method: ' + signature)
  const end = source.indexOf('\n  }\n', start)
  assert(end > start)
  return source.slice(start, end + 5)
}
const methods = [
  method('parseCalendar(text) {'), method('renderCalendar(entries) {'),
  method('calendarEditTextPre(text, action, item) {', true),
  method('async _calendarTransactionPre(agent, job) {'),
  method('async calendarAdd(item, agent) {'),
  method('async calendarDone(date, time, title, agent) {'),
  method('async calendarRemove(date, time, title, agent) {'),
].join('\n')
const Harness = new Function('readFile', 'todayStr', 'withCalendarLock',
  'return class CalendarHarness {\n' + methods + '\n}')(readFile, () => '2026-10-07', async (_file, job) => job())
const first = { date: '2026-10-07', time: '09:00', quadrant: '未分类', title: 'Appointment', note: 'Call Alice' }
async function fixture(content = '') {
  const dir = await mkdtemp(path.join(sandbox, 'case-'))
  const calendarPath = path.join(dir, 'CALENDAR.md')
  if (content) await writeFile(calendarPath, content)
  const engine = new Harness()
  engine.state = {}
  let writes = 0
  engine.resolvePaths = async () => ({ calendarPath })
  engine.writeFullRaw = async (file, text) => {
    assert.equal(file, calendarPath)
    writes++
    await writeFile(file, text, 'utf8')
  }
  return { engine, read: () => readFile(calendarPath, 'utf8').catch(e => { if (e.code === 'ENOENT') return ''; throw e }), writes: () => writes }
}
test('new multiline and ambiguous title are explicitly rejected before any write', async () => {
  for (const changed of [
    { note: 'Call Alice\nBring ID card' }, { title: 'one\ntwo' },
    { note: '\nleading newline' }, { title: 'pricing | review' }, { title: 'one\u2028two' }, { note: 'one\u2029two' },
  ]) {
    const f = await fixture('# 手写日历\n')
    await assert.rejects(f.engine.calendarAdd({ ...first, ...changed }), /单行|分隔符/)
    assert.equal(f.writes(), 0)
    assert.equal(await f.read(), '# 手写日历\n')
  }
})
test('historical accepted continuation and hand-written Markdown survive Add and Done', async () => {
  const original = '# 手写日历\r\n\r\n## 2026-10-07\r\n- [ ] 09:00 | 未分类 | Appointment | Call Alice\r\nBring ID card\r\n  **keep indentation**\r\n\r\n'
  const f = await fixture(original)
  await f.engine.calendarAdd({ ...first, time: '10:00', title: 'Second', note: 'a | b / C:\\notes' })
  const added = await f.read()
  assert(added.startsWith(original))
  assert.equal(f.engine.parseCalendar(added).length, 2)
  assert.equal(f.engine.parseCalendar(added)[1].note, 'a | b / C:\\notes')
  await f.engine.calendarDone(first.date, first.time, first.title)
  const done = await f.read()
  assert.equal(done, added.replace('- [ ] 09:00', '- [x] 09:00'))
  const writes = f.writes()
  await assert.rejects(f.engine.calendarRemove(first.date, first.time, first.title), /续行|手写正文/)
  assert.equal(f.writes(), writes)
  assert.equal(await f.read(), done)
  await f.engine.calendarRemove(first.date, '10:00', 'Second')
  assert((await f.read()).includes('Bring ID card\r\n  **keep indentation**'))
})
test('supported single-line fields including literal backslashes and note pipes roundtrip; no-time compatible', async () => {
  const f = await fixture()
  await f.engine.calendarAdd({ ...first, time: undefined, title: 'C:\\work|review', note: 'a | b \\n is literal' })
  const parsed = f.engine.parseCalendar(await f.read())
  assert.equal(parsed[0].time, '--:--')
  assert.equal(parsed[0].title, 'C:\\work|review')
  assert.equal(parsed[0].note, 'a | b \\n is literal')
  await f.engine.calendarDone(first.date, '--:--', 'C:\\work|review')
  assert.equal(f.engine.parseCalendar(await f.read())[0].done, true)
  await f.engine.calendarRemove(first.date, '--:--', 'C:\\work|review')
  assert.equal(f.engine.parseCalendar(await f.read()).length, 0)
})
test('date sections and unrelated handwritten bytes remain on add/remove, missing target writes nothing', async () => {
  const original = '# Calendar\n# Intro\ncustom preface\n## 2026-10-07\n- [ ] 09:00 | 未分类 | Appointment | Call Alice\n\n## 2026-10-08\n- [ ] --:-- | 未分类 | Later\n\n# Appendix\nmanual text\n'
  const f = await fixture(original)
  await f.engine.calendarAdd({ ...first, title: 'Second', time: '10:00' })
  const added = await f.read()
  assert(added.includes('10:00 | 未分类 | Second | Call Alice\n## 2026-10-08'))
  assert(added.endsWith('# Appendix\nmanual text\n'))
  await f.engine.calendarRemove(first.date, '10:00', 'Second')
  assert.equal(await f.read(), original)
  const writes = f.writes()
  assert.match(await f.engine.calendarDone(first.date, '13:00', 'Missing'), /未找到/)
  assert.match(await f.engine.calendarRemove(first.date, '13:00', 'Missing'), /未找到/)
  assert.equal(f.writes(), writes)
})
test('unparseable new date/time/quadrant is rejected without clearing existing file', async () => {
  for (const changed of [{ date: '2026-02-30' }, { date: 'bad\n## 2000-01-01' }, { time: '99:99' }, { quadrant: 'other' }]) {
    const f = await fixture('existing markdown\n')
    await assert.rejects(f.engine.calendarAdd({ ...first, ...changed }))
    assert.equal(await f.read(), 'existing markdown\n')
    assert.equal(f.writes(), 0)
  }
})

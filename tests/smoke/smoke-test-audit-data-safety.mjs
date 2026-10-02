import assert from 'node:assert/strict'
import { mkdtemp, readFile, writeFile, mkdir, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { createFactStorePre } from '../../lib/fact-store.js'
import { createTeamOutbox } from '../../lib/team-outbox.js'
import { calendarMergePre } from '../../lib/migrate-pack.js'
import { withCalendarLock } from '../../lib/calendar-lock.js'
import { MemoryEngine, diag, flushDiagnostics } from '../lib/audit-engine.mjs'
const root = await mkdtemp(path.join(os.tmpdir(), 'dam-audit-data-'))
try {
  const fact = { scope: 'User', subject: 'A', predicate: 'B', object: 'esbuild', sourceKind: 'explicit' }
  let saved
  const facts = createFactStorePre({ io: { save: s => { saved = structuredClone(s) } } })
  const original = facts.upsert(fact).fact
  assert.equal(facts.supersede({ ...fact, subject: '请帮我？', predicate: '修改', object: '好吗？' }).ok, false)
  // Same identity, rejected question: cannot revoke the existing fact.
  assert.equal(facts.supersede({ ...fact, object: '？' }).ok, false)
  assert.equal(facts.get(fact.scope, fact.subject, fact.predicate).revoked, false)
  facts.upsert({ ...fact, subject: '其他项目' })
  assert.equal(saved.facts.find(f => f.factId === original.factId).revoked, false)
  const dir = path.join(root, 'outbox')
  assert.equal(createTeamOutbox({ dir }).enqueue({ kind: 'note', key: 'old' }).ok, true)
  assert.equal(createTeamOutbox({ dir }).enqueue({ kind: 'note', key: 'new' }).ok, true)
  const restored = createTeamOutbox({ dir })
  assert.equal(restored.load().size, 2)
  const engine = Object.create(MemoryEngine.prototype)
  Object.defineProperty(engine, 'state', { value: {}, writable: true, enumerable: true }); engine.config = {}; engine._lastCompactAt = {}
  engine.foldTextToSummaryPre = async () => ''
  engine.appendText = async (file, text) => { const old = await readFile(file, 'utf8').catch(() => ''); await writeFile(file, old + text) }
  engine.writeFull = engine.writeFullRaw = async (file, text) => writeFile(file, text)
  const p = { projectDir: root, notesPath: path.join(root, 'notes.md'), userFile: path.join(root, 'MEMORY.md'), calendarPath: path.join(root, 'CALENDAR.md') }
  engine.resolvePaths = async () => p
  engine.readTextSafe = async file => readFile(file, 'utf8').catch(e => { if (e.code === 'ENOENT') return ''; throw e })
  const old = '## old\n' + '原文完整保留。'.repeat(50)
  engine.state.notesText = old + '\n## new\n新内容'
  await engine.compactLegacyLayer(null, 'notes', p, 30, false)
  assert.ok((await readFile(path.join(root, 'archive/notes-archived.md'), 'utf8')).includes(old))
  const a = Object.create(MemoryEngine.prototype); Object.defineProperty(a, 'state', { value: {}, writable: true }); Object.assign(a, engine, { state: { calendarText: 'stale A' } })
  const b = Object.create(MemoryEngine.prototype); Object.defineProperty(b, 'state', { value: {}, writable: true }); Object.assign(b, engine, { state: { calendarText: 'stale B' } })
  await a.calendarAdd({ date: '2026-10-02', title: '无时间安排' })
  await b.calendarAdd({ date: '2026-10-02', title: '串行安排', time: '12:00' })
  await Promise.all(Array.from({ length: 12 }, (_, i) => (i % 2 ? a : b).calendarAdd({ date: '2026-10-02', title: '并发安排' + i })))
  const text = await readFile(p.calendarPath, 'utf8')
  assert.equal(a.parseCalendar(text).length, 14)
  assert.equal(calendarMergePre(text, '').kept, 14)
  await b.calendarDone('2026-10-02', '--:--', '无时间安排')
  assert.equal(a.parseCalendar(await readFile(p.calendarPath, 'utf8')).find(e => e.title === '无时间安排').done, true)
  await a.calendarRemove('2026-10-02', '--:--', '无时间安排')
  assert.equal(a.parseCalendar(await readFile(p.calendarPath, 'utf8')).length, 13)
  await writeFile(p.calendarPath + '.lock', 'other owner')
  await assert.rejects(withCalendarLock(p.calendarPath, () => assert.fail('must not enter'), { timeoutMs: 1 }), /calendar-lock-timeout/)
  engine._verifyWorkbench = async () => ({ ok: false }); engine._readWorkbench = async () => null
  engine._subagentLoopSize = () => 10
  assert.equal((await engine.workbenchStatus()).greetCount, 0)
  const configEngine = new MemoryEngine()
  configEngine.configLoaded = true
  configEngine.loadConfig = async () => {}
  configEngine.refresh = async () => {}
  const oldUser = path.join(root, 'old-user')
  await mkdir(oldUser); await writeFile(path.join(oldUser, 'MEMORY.md'), '用户旧数据')
  configEngine.config = { memoryRoot: root, userMemoryDir: oldUser }
  configEngine._configPath = path.join(root, 'config.json')
  await writeFile(configEngine._configPath, JSON.stringify(configEngine.config))
  const newUser = path.join(root, 'nested', 'new-user')
  await configEngine.saveConfig({ userMemoryDir: newUser })
  assert.equal(await readFile(path.join(newUser, 'MEMORY.md'), 'utf8'), '用户旧数据')
  assert.equal(await readFile(path.join(oldUser, 'MEMORY.md'), 'utf8'), '用户旧数据')
  const previous = configEngine.config
  configEngine._configPath = root // rename onto a directory fails
  await assert.rejects(configEngine.saveConfig({ greetingEnabled: false }), /config-save-failed/)
  assert.equal(configEngine.config, previous)
  const oldHome = process.env.DSH_HOME
  process.env.DSH_HOME = root
  const logFile = path.join(root, 'dsh-auto-memory-diagnose.log')
  for (let i = 0; i < 2; i++) {
    await writeFile(logFile, 'x'.repeat(2 * 1024 * 1024 + 1))
    diag('rotation ' + i); await flushDiagnostics()
    assert.ok((await readFile(logFile, 'utf8')).length < 100)
    assert.equal((await readFile(logFile + '.1', 'utf8')).length, 2 * 1024 * 1024 + 1)
  }
  if (oldHome === undefined) delete process.env.DSH_HOME; else process.env.DSH_HOME = oldHome
  console.log('PASS audit data safety: F01 F06 F07 F08 F23 F30 F31 R01 R03')
} finally { await rm(root, { recursive: true, force: true }) }

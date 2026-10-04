import assert from 'node:assert/strict'
import { mkdtemp, readFile, writeFile, mkdir, rm, chmod } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { createFactStorePre } from '../../lib/fact-store.js'
import { createTeamSync } from '../../lib/team-sync.js'
import { createTeamOutbox } from '../../lib/team-outbox.js'
import { calendarMergePre } from '../../lib/migrate-pack.js'
import { withCalendarLock } from '../../lib/calendar-lock.js'
import { MemoryEngine, diag, flushDiagnostics } from '../lib/audit-engine.mjs'
const root = await mkdtemp(path.join(os.tmpdir(), 'dam-audit-data-'))
const originalHome = process.env.DSH_HOME
process.env.DSH_HOME = root
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
  const sent = []
  const sync = createTeamSync({ engine: { config: { teamEnabled: true } }, outbox: restored, identity: { currentMember: () => ({ id: 'test' }) }, teamFetch: async (_url, req) => { sent.push(req.body.key); return { ok: true } } })
  assert.equal(sync.start().ok, true)
  assert.equal((await sync.tick()).sent, 2)
  sync.stop()
  assert.deepEqual(sent, ['old', 'new'])
  const engine = Object.create(MemoryEngine.prototype)
  Object.defineProperty(engine, 'state', { value: {}, writable: true, enumerable: true }); engine.config = {}; engine._lastCompactAt = {}
  engine.foldTextToSummaryPre = async () => ''
  const p = { projectDir: root, notesPath: path.join(root, 'notes.md'), userFile: path.join(root, 'MEMORY.md'), calendarPath: path.join(root, 'CALENDAR.md') }
  engine.resolvePaths = async () => p
  // Production readTextSafe intentionally swallows read errors; calendar must bypass it.
  engine.readTextSafe = MemoryEngine.prototype.readTextSafe
  engine.writeFullRaw = MemoryEngine.prototype.writeFullRaw
  const old = '## old\n' + Array.from({ length: 50 }, (_, i) => '证据' + i + '：原文完整保留。').join('\n')
  engine.state.notesText = old + '\n## new\n新内容'
  const beforeCompact = engine.state.notesText
  await writeFile(p.notesPath, beforeCompact)
  await writeFile(path.join(root, 'archive'), 'blocked archive parent')
  await assert.rejects(engine.compactLegacyLayer(null, 'notes', p, 30, false), /EEXIST|ENOTDIR/)
  assert.equal(engine.state.notesText, beforeCompact)
  assert.equal(await readFile(p.notesPath, 'utf8'), beforeCompact)
  await rm(path.join(root, 'archive'))
  await engine.compactLegacyLayer(null, 'notes', p, 30, false)
  assert.ok((await readFile(path.join(root, 'archive/notes-archived.md'), 'utf8')).includes(old))
  const a = Object.create(MemoryEngine.prototype); Object.defineProperty(a, 'state', { value: {}, writable: true }); Object.assign(a, engine, { state: { calendarText: 'stale A' } })
  const b = Object.create(MemoryEngine.prototype); Object.defineProperty(b, 'state', { value: {}, writable: true }); Object.assign(b, engine, { state: { calendarText: 'stale B' } })
  await a.calendarAdd({ date: '2026-10-02', title: '无时间安排' })
  await b.calendarAdd({ date: '2026-10-02', title: '串行安排', time: '12:00' })
  await Promise.all(Array.from({ length: 12 }, (_, i) => (i % 2 ? a : b).calendarAdd({ date: '2026-10-02', title: '并发安排' + i })))
  const text = await readFile(p.calendarPath, 'utf8')
  if (process.platform !== 'win32' && process.getuid?.() !== 0) {
    await chmod(p.calendarPath, 0)
    try { await assert.rejects(a.calendarAdd({ title: 'unreadable must preserve' }), /EACCES/) } finally { await chmod(p.calendarPath, 0o600) }
    assert.equal(await readFile(p.calendarPath, 'utf8'), text)
  }
  assert.equal(a.parseCalendar(text).length, 14)
  assert.equal(calendarMergePre(text, '').kept, 14)
  await b.calendarDone('2026-10-02', '--:--', '无时间安排')
  assert.equal(a.parseCalendar(await readFile(p.calendarPath, 'utf8')).find(e => e.title === '无时间安排').done, true)
  await a.calendarRemove('2026-10-02', '--:--', '无时间安排')
  assert.equal(a.parseCalendar(await readFile(p.calendarPath, 'utf8')).length, 13)
  const faultPath = path.join(root, 'read-fault')
  await mkdir(faultPath); await writeFile(path.join(faultPath, 'preserve'), 'old bytes')
  const healthyPaths = engine.resolvePaths
  engine.resolvePaths = async () => ({ ...p, calendarPath: faultPath })
  await assert.rejects(engine.calendarAdd({ date: '2026-10-02', title: 'must not overwrite' }), /EISDIR/)
  assert.equal(await readFile(path.join(faultPath, 'preserve'), 'utf8'), 'old bytes')
  engine.resolvePaths = healthyPaths
  await writeFile(p.calendarPath + '.lock', JSON.stringify({ host: os.hostname(), pid: process.pid }))
  await assert.rejects(withCalendarLock(p.calendarPath, () => assert.fail('must not enter'), { timeoutMs: 1 }), /calendar-lock-timeout/)
  await rm(p.calendarPath + '.lock')
  await writeFile(p.calendarPath + '.lock', JSON.stringify({ host: os.hostname(), pid: 2147483647 }))
  await withCalendarLock(p.calendarPath, async () => {})
  await assert.rejects(readFile(p.calendarPath + '.lock'))
  engine._verifyWorkbench = async () => ({ ok: false }); engine._readWorkbench = async () => null
  engine._subagentLoopSize = () => 10
  assert.equal((await engine.workbenchStatus()).greetCount, 0)
  const configEngine = new MemoryEngine()
  configEngine.configLoaded = true
  configEngine.loadConfig = async () => {}
  configEngine.refresh = async () => {}
  const oldUser = path.join(root, 'old-user')
  await mkdir(oldUser); await writeFile(path.join(oldUser, 'MEMORY.md'), '用户旧数据')
  await writeFile(path.join(oldUser, 'random.tmp'), 'runtime only')
  await writeFile(path.join(oldUser, 'CALENDAR.md'), '## 2026-10-02\n- --:-- 旧日历')
  configEngine.config = { memoryRoot: root, userMemoryDir: oldUser }
  configEngine._configPath = path.join(root, 'config.json')
  await writeFile(configEngine._configPath, JSON.stringify(configEngine.config))
  const newUser = path.join(root, 'nested', 'new-user')
  await configEngine.saveConfig({ userMemoryDir: newUser })
  assert.equal(await readFile(path.join(newUser, 'MEMORY.md'), 'utf8'), '用户旧数据')
  assert.equal(await readFile(path.join(newUser, 'CALENDAR.md'), 'utf8'), '## 2026-10-02\n- --:-- 旧日历')
  await assert.rejects(readFile(path.join(newUser, 'CALENDAR.md.lock')))
  await assert.rejects(readFile(path.join(newUser, 'random.tmp')))
  assert.equal(await readFile(path.join(oldUser, 'MEMORY.md'), 'utf8'), '用户旧数据')
  // Directory migration waits for the old calendar transaction and keeps the
  // old config visible. An add whose path was resolved before commit must retry.
  let release, acquired
  const entered = new Promise(r => { acquired = r })
  const held = withCalendarLock(path.join(newUser, 'CALENDAR.md'), async () => { acquired(); await new Promise(r => { release = r }) })
  await entered
  configEngine.resolvePaths = async () => ({ calendarPath: path.join(configEngine.userDirOf(), 'CALENDAR.md') })
  const nextUser = path.join(root, 'next-user')
  const moving = configEngine.saveConfig({ userMemoryDir: nextUser })
  const adding = configEngine.calendarAdd({ date: '2026-10-02', title: '迁移并发新增' })
  await new Promise(r => setTimeout(r, 50))
  assert.equal(configEngine.config.userMemoryDir, newUser)
  release(); await held; await Promise.all([moving, adding])
  assert.ok(configEngine.parseCalendar(await readFile(path.join(nextUser, 'CALENDAR.md'), 'utf8')).some(e => e.title === '迁移并发新增'))
  const previous = configEngine.config
  configEngine._configPath = root // rename onto a directory fails
  await assert.rejects(configEngine.saveConfig({ greetingEnabled: false }), /config-save-failed|Configuration save failed|EISDIR|EPERM|EEXIST|ENOTDIR|invalid/i)
  assert.equal(configEngine.config, previous)
  const parentFile = path.join(root, 'not-a-directory')
  await writeFile(parentFile, 'unchanged')
  configEngine._configPath = path.join(parentFile, 'config.json')
  await assert.rejects(configEngine.saveConfig({ greetingEnabled: false }), /EEXIST|ENOTDIR/)
  assert.equal(configEngine.config, previous)
  assert.equal(await readFile(parentFile, 'utf8'), 'unchanged')
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
} finally { if (originalHome === undefined) delete process.env.DSH_HOME; else process.env.DSH_HOME = originalHome
  await rm(root, { recursive: true, force: true }) }

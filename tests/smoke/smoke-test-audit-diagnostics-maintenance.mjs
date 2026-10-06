import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, readFile, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

const root = await mkdtemp(path.join(tmpdir(), 'dam-diagnostics-maintenance-'))
const prior = { HOME: process.env.HOME, USERPROFILE: process.env.USERPROFILE, DSH_HOME: process.env.DSH_HOME }
Object.assign(process.env, { HOME: root, USERPROFILE: root, DSH_HOME: root })
const { MemoryEngine, flushDiagnostics } = await import('../lib/audit-engine.mjs')
const text = '[PROJECT]\n- 合成测试的项目技术结论具有长期复用价值\n[USER]\n- 合成测试的用户规则需要人工确认后采用'
const nowTime = () => { const d = new Date(); return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0') }
let seq = 0
async function fixture() {
  const dir = path.join(root, 'case-' + (++seq))
  const userDir = path.join(dir, 'user'), projectDir = path.join(dir, 'project')
  await mkdir(userDir, { recursive: true }); await mkdir(projectDir)
  const p = { ws: projectDir, projectDir, userDir, notesPath: path.join(projectDir, 'MEMORY.md') }
  await writeFile(p.notesPath, '## 原有笔记\n- 原有项目结论保留。\n')
  await writeFile(path.join(projectDir, '2020-01-01.md'), '## 合成日志\n- 合成测试的长期技术事实。\n')
  const engine = new MemoryEngine()
  engine.configLoaded = true
  engine.config = { ...engine.config, handoffEnabled: false, associativeMemoryEnabled: false,
    userMemoryDir: userDir, memoryRoot: root, consolidateScheduleEnabled: false,
    maintainScheduleEnabled: false, autoSummaryTimes: [] }
  const agent = { session: { id: 'session-fixture-' + seq, header: { cwd: projectDir } } }
  engine._lastAgent = agent
  engine.resolvePaths = async () => p
  engine.ensureBudget = async () => ({ ok: true })
  engine._subagents = {}
  let calls = 0
  engine.runSubagent = async () => { calls++; return text }
  return { engine, p, agent, calls: () => calls }
}
async function schedule(f, kind) {
  f.engine.config[kind === 'consolidate' ? 'consolidateScheduleEnabled' : 'maintainScheduleEnabled'] = true
  f.engine.config[kind === 'consolidate' ? 'consolidateScheduleTime' : 'maintainScheduleTime'] = nowTime()
  f.engine.tickTime()
  // The production scheduler owns the flight; settle its actual promise before
  // diagnostics or cleanup. The fallback lets the old-tree negative control run.
  const flights = f.engine._maintenanceTaskFlights
  if (flights) await Promise.allSettled([...flights.values()])
  for (let i = 0; f.engine._scheduleBusy && i < 200; i++) await new Promise(resolve => setTimeout(resolve, 2))
  assert.equal(f.engine._scheduleBusy, false)
}
const view = async (f, kind) => (await f.engine.debugInfo()).maintenanceTasks?.[kind]
try {
  const failed = await fixture()
  const originalPath = failed.p.notesPath
  failed.p.notesPath = path.join(failed.p.projectDir, 'blocked-note')
  await mkdir(failed.p.notesPath)
  failed.engine.runSubagent = async () => '[PROJECT]\n- 合成测试的项目技术结论具有长期复用价值'
  await schedule(failed, 'consolidate')
  let receipt = await view(failed, 'consolidate')
  assert.equal(receipt?.status, 'failed', 'scheduled write failure must be visible through real debugInfo')
  assert.equal(receipt.writes, 0)
  assert.equal(receipt.source, 'scheduled')
  assert(receipt.attemptedAt && receipt.startedAt && receipt.finishedAt)
  assert(receipt.errorReason.includes('[redacted]'))
  const failedKey = receipt.jobKey
  await schedule(failed, 'consolidate')
  assert.equal((await view(failed, 'consolidate')).attempt, 1, 'same minute must not repeat a failed paid task')
  failed.p.notesPath = originalPath
  await failed.engine.consolidateMemory(failed.agent, 7)
  receipt = await view(failed, 'consolidate')
  assert.equal(receipt.status, 'succeeded')
  assert.equal(receipt.recoveryOf, failedKey)
  assert.equal(receipt.source, 'manual')
  assert((await readFile(originalPath, 'utf8')).includes('合成测试的项目技术结论'))

  const partial = await fixture()
  await mkdir(path.join(partial.p.userDir, 'PENDING-USER-MEMORY.md'))
  await schedule(partial, 'consolidate')
  receipt = await view(partial, 'consolidate')
  assert.equal(receipt.status, 'partial')
  assert.equal(receipt.writes, 1)
  assert.equal(receipt.resultCode, 'pending-write-failed')
  assert((await readFile(partial.p.notesPath, 'utf8')).includes('合成测试的项目技术结论'))
  await schedule(partial, 'consolidate')
  assert.equal(partial.calls(), 1, 'partial write must not be automatically replayed')

  const unavailable = await fixture()
  unavailable.engine.runSubagent = async () => ''
  await schedule(unavailable, 'consolidate')
  assert.equal((await view(unavailable, 'consolidate')).resultCode, 'model-unavailable')
  assert.equal((await view(unavailable, 'consolidate')).status, 'failed')

  const noInput = await fixture()
  noInput.engine.listDailyLogs = async () => []
  await schedule(noInput, 'consolidate')
  assert.equal((await view(noInput, 'consolidate')).status, 'succeeded')
  assert.equal(noInput.calls(), 0)

  const running = await fixture()
  let release
  const gate = new Promise(resolve => { release = resolve })
  running.engine.runSubagent = async () => { await gate; return '(无)' }
  running.engine.config.consolidateScheduleEnabled = true
  running.engine.config.consolidateScheduleTime = nowTime()
  running.engine.tickTime()
  for (let i = 0; i < 10; i++) await new Promise(resolve => setImmediate(resolve))
  assert.equal((await view(running, 'consolidate')).status, 'running')
  await assert.rejects(running.engine.consolidateMemory(running.agent), /maintenance-task-busy/)
  release()
  await Promise.allSettled([...running.engine._maintenanceTaskFlights.values()])
  assert.equal((await view(running, 'consolidate')).status, 'succeeded')

  const maintained = await fixture()
  maintained.engine.runSubagent = async () => '(无)'
  await schedule(maintained, 'maintain')
  receipt = await view(maintained, 'maintain')
  assert.equal(receipt.status, 'succeeded')
  assert.equal(receipt.writes, 2)
  assert((await readFile(path.join(maintained.p.projectDir, 'archive', '2020-01-01.md'), 'utf8')).includes('合成测试'))
  await assert.rejects(stat(path.join(maintained.p.projectDir, '2020-01-01.md')), { code: 'ENOENT' })

  const maintainPartial = await fixture()
  maintainPartial.engine.runSubagent = async () => '(无)'
  maintainPartial.p.notesPath = path.join(maintainPartial.p.projectDir, 'blocked-note')
  await mkdir(maintainPartial.p.notesPath)
  await schedule(maintainPartial, 'maintain')
  receipt = await view(maintainPartial, 'maintain')
  assert.equal(receipt.status, 'partial')
  assert.equal(receipt.writes, 1)
  assert((await stat(path.join(maintainPartial.p.projectDir, '2020-01-01.md'))).isFile(), 'partial note failure keeps source log')
  await schedule(maintainPartial, 'maintain')
  assert.equal(maintainPartial.calls(), 0) // custom fixture has its own zero-cost output
  assert.equal((await view(maintainPartial, 'maintain')).attempt, 1)

  const maintainFailed = await fixture()
  maintainFailed.engine.resolvePaths = async () => { throw Object.assign(new Error('secret fixture error payload'), { code: 'EACCES' }) }
  await schedule(maintainFailed, 'maintain')
  receipt = await view(maintainFailed, 'maintain')
  assert.equal(receipt.status, 'failed')
  assert(receipt.errorReason.includes('EACCES'))
  assert(!JSON.stringify(receipt).includes('secret fixture'))

  const swallowed = await fixture()
  swallowed.engine.runSubagent = async () => '(无)'
  await mkdir(path.join(swallowed.p.projectDir, 'archive', '2020-01-01.md'), { recursive: true })
  await schedule(swallowed, 'maintain')
  receipt = await view(swallowed, 'maintain')
  assert.equal(receipt.status, 'failed', 'caught archive failure must not appear successful')
  assert.equal(receipt.writes, 0)
  assert((await stat(path.join(swallowed.p.projectDir, '2020-01-01.md'))).isFile())

  const disposed = await fixture()
  disposed.engine._disposed = true
  disposed.engine.config.consolidateScheduleEnabled = true
  disposed.engine.config.consolidateScheduleTime = nowTime()
  disposed.engine.tickTime()
  assert.equal(disposed.calls(), 0)
  assert.equal((await view(disposed, 'consolidate')), null)
  await flushDiagnostics()
  const diagnostic = await readFile(path.join(root, 'dsh-auto-memory-diagnose.log'), 'utf8')
  assert(diagnostic.includes('"status":"failed"'))
  assert(diagnostic.includes('"status":"partial"'))
  assert(!diagnostic.includes('secret fixture error payload'))
  console.log('PASS audit diagnostics maintenance: actual scheduler, consolidation and archive writes, failed/partial/running/success receipts and explicit recovery')
} finally {
  await flushDiagnostics()
  for (const [key, value] of Object.entries(prior)) { if (value === undefined) delete process.env[key]; else process.env[key] = value }
  await rm(root, { recursive: true, force: true })
}

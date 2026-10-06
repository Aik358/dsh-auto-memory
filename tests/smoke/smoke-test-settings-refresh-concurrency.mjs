import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import { syncBuiltinESMExports } from 'node:module'
import path from 'node:path'
import { tmpdir } from 'node:os'
import { loadIsolatedEngine } from '../lib/load-isolated-engine.mjs'

const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r }); return { resolve, promise } }
const home = await fs.mkdtemp(path.join(tmpdir(), 'dam-settings-refresh-'))
const previousHome = process.env.DSH_HOME; process.env.DSH_HOME = home
const originalRename = fs.rename, originalError = console.error
const errors = [], waitingRefresh = deferred(), resumeRefresh = deferred(), committedConfig = deferred(), enteredMutation = deferred()
let refresh, saving, timer
try {
  const { MemoryEngine, DEFAULT_CONFIG } = await loadIsolatedEngine(home)
  const engine = new MemoryEngine(), ws = path.join(home, 'workspace')
  engine.config = { ...DEFAULT_CONFIG, memoryRoot: path.join(home, 'memory', 'workspaces'), userMemoryDir: path.join(home, 'memory'), handoffEnabled: false, greetingEnabled: false, l0IndexEnabled: false, externalSources: {} }
  engine.configLoaded = true; engine.state.ws = ws
  await fs.mkdir(path.join(ws, '.dsh-memory'), { recursive: true })
  await fs.writeFile(path.join(ws, '.dsh-memory', 'MEMORY.md'), 'Authoritative legacy notes')
  await fs.writeFile(engine._configPath, JSON.stringify(engine.config))
  const migrate = engine.migrateLegacy.bind(engine), mutation = engine._withMemoryMutationPre.bind(engine)
  engine.migrateLegacy = async (...args) => { waitingRefresh.resolve(); await resumeRefresh.promise; return migrate(...args) }
  engine._withMemoryMutationPre = (file, job, admission) => mutation(file, async () => { enteredMutation.resolve(); return job() }, admission)
  fs.rename = async (from, to) => {
    const result = await originalRename(from, to)
    if (to === engine._configPath) committedConfig.resolve()
    return result
  }
  syncBuiltinESMExports()
  console.error = (...args) => { errors.push(args.map(String).join(' ')); originalError(...args) }
  refresh = engine.refresh()
  await waitingRefresh.promise // the real refresh is paused before its document mutation gate
  saving = engine.saveConfig({ locale: 'en' })
  await committedConfig.promise // real atomic rename proves save owns the transaction and has committed
  assert.equal(JSON.parse(await fs.readFile(engine._configPath, 'utf8')).locale, 'en')
  resumeRefresh.resolve()
  // The deadline is only a watchdog. Passing requires the actual blocked
  // refresh to enter its protected callback, migrate bytes and finish both jobs.
  const entered = await Promise.race([enteredMutation.promise.then(() => true), new Promise(r => { timer = setTimeout(() => r(false), 500) })])
  clearTimeout(timer)
  assert.equal(entered, true, 'saved configuration must release its physical gate before awaiting the existing refresh')
  const [, saved] = await Promise.all([refresh, saving])
  assert.equal(saved.warning, '')
  assert.equal(await fs.readFile(path.join(engine.projectDirOf(ws), 'MEMORY.md'), 'utf8'), 'Authoritative legacy notes')
  assert(!errors.some(error => error.includes('config-lock-timeout')))
  await assert.rejects(fs.access(engine._configPath + '.lock'), { code: 'ENOENT' })
  console.log('PASS actual refresh/config commit barriers: existing refresh obtains the released gate, migrates legacy bytes and both operations complete without hidden timeout')
} finally {
  clearTimeout(timer); resumeRefresh.resolve()
  // Await actual producers before deleting their HOME, including the failing
  // old candidate's bounded lock timeout. Cleanup cannot mask the cycle verdict.
  await Promise.allSettled([refresh, saving].filter(Boolean))
  fs.rename = originalRename; syncBuiltinESMExports(); console.error = originalError
  if (previousHome === undefined) delete process.env.DSH_HOME; else process.env.DSH_HOME = previousHome
  await fs.rm(home, { recursive: true, force: true })
}

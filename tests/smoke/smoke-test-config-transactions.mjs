import assert from 'node:assert/strict'
import { AsyncResource } from 'node:async_hooks'
import { mkdtemp, writeFile, readFile, rm, mkdir, symlink } from 'node:fs/promises'
import { tmpdir, hostname } from 'node:os'
import path from 'node:path'
import { fork, spawn } from 'node:child_process'
import { once } from 'node:events'
import { fileURLToPath } from 'node:url'
import { withConfigLock, withConfigLockSync } from '../../lib/config-lock.js'

const root = await mkdtemp(path.join(tmpdir(), 'dam-config-transactions-'))
const home = path.join(root, 'home'), file = path.join(home, 'dsh-auto-memory.json')
await mkdir(home)
const prior = { HOME: process.env.HOME, USERPROFILE: process.env.USERPROFILE, DSH_HOME: process.env.DSH_HOME }
Object.assign(process.env, { HOME: root, USERPROFILE: root, DSH_HOME: home })
const workers = []
const incomingRequest = new AsyncResource('independent-request')
const baseline = { locale: 'zh', greetingEnabled: true, capacityDefaultsVersion: 1,
  pythonBackendWorkerPath: process.execPath, memoryRoot: path.join(home, 'workspaces'), userMemoryDir: path.join(home, 'memory') }
const disk = async () => JSON.parse(await readFile(file, 'utf8'))
async function worker() {
  const child = fork(fileURLToPath(new URL('../lib/config-save-worker.mjs', import.meta.url)), [], {
    execArgv: [], env: { ...process.env, DAM_CONFIG_TEST_FILE: file }, stdio: ['ignore', 'ignore', 'inherit', 'ipc'] })
  workers.push(child)
  const [message] = await once(child, 'message')
  assert.equal(message.ready, true)
  return child
}
let sequence = 0
function save(child, patch) {
  const id = ++sequence
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => { child.off('message', response); reject(new Error('worker save timeout')) }, 15000)
    function response(message) {
      if (message.id !== id) return
      clearTimeout(timeout); child.off('message', response)
      message.ok ? resolve() : reject(new Error(message.error))
    }
    child.on('message', response); child.send({ id, patch })
  })
}
try {
  const { MemoryEngine, flushDiagnostics } = await import('../lib/audit-engine.mjs')
  const [a, b] = await Promise.all([worker(), worker()])
  for (let round = 0; round < 20; round++) {
    await writeFile(file, JSON.stringify(baseline))
    await Promise.all([save(a, { locale: 'en' }), save(b, { greetingEnabled: false })])
    const result = await disk()
    assert.equal(result.locale, 'en', 'independent process locale save lost at round ' + round)
    assert.equal(result.greetingEnabled, false, 'independent process greeting save lost at round ' + round)
  }
  console.log('PASS: 20 independent-process saves preserve both patches')

  await writeFile(file, JSON.stringify(baseline))
  const x = new MemoryEngine({}), y = new MemoryEngine({})
  for (const engine of [x, y]) { engine._configPath = file; engine.refresh = async () => {} }
  await Promise.all([x.saveConfig({ locale: 'en' }), y.saveConfig({ greetingEnabled: false })])
  assert.equal((await disk()).locale, 'en'); assert.equal((await disk()).greetingEnabled, false)
  console.log('PASS: independent engine instances preserve both patches')

  // Holding an async lock while synchronously loading must neither deadlock nor
  // let the legacy merge/capacity migration overwrite the owner's future save.
  await writeFile(file, JSON.stringify({ ...baseline, noteCapacityChars: 12000, capacityDefaultsVersion: 0 }))
  await writeFile(path.join(home, 'dsh-auto-memory-pre.json'), JSON.stringify({ locale: 'obsolete', legacyOnly: 'retain' }))
  await withConfigLock(file, async () => {
    const before = await readFile(file, 'utf8')
    assert.equal(incomingRequest.runInAsyncScope(() => y.loadConfigSync()).locale, 'zh')
    assert.match(y._readError, /config-lock-busy/)
    assert.equal(await readFile(file, 'utf8'), before)
    // Nested owned operations are reentrant in their async context.
    withConfigLockSync(file, () => {})
  })
  await y.loadConfig()
  assert.equal((await disk()).legacyOnly, 'retain')
  assert.equal((await disk()).noteCapacityChars, 24000)
  await flushDiagnostics()
  console.log('PASS: busy synchronous startup is read-only; async retry performs migrations')

  // Recover only a provably dead owner on this host.
  const exited = spawn(process.execPath, ['-e', ''], { stdio: 'ignore' })
  await once(exited, 'exit')
  await writeFile(file + '.lock', JSON.stringify({ pid: exited.pid, host: hostname() }))
  await withConfigLock(file, async () => {})
  await writeFile(file + '.lock', JSON.stringify({ pid: process.pid, host: hostname() }))
  await assert.rejects(withConfigLock(file, async () => {}, { timeoutMs: 40 }), /config-lock-timeout/)
  await rm(file + '.lock')
  await assert.rejects(withConfigLock(file, async () => { throw new Error('injected failure') }), /injected failure/)
  await withConfigLock(file, async () => {})
  console.log('PASS: dead owner recovery, live owner timeout and failure release')

  const alias = path.join(root, 'alias')
  await symlink(home, alias, process.platform === 'win32' ? 'junction' : 'dir')
  await withConfigLock(file, async () => {
    // A different task context must wait even if the path has an alias.
    const child = fork(fileURLToPath(new URL('../lib/config-save-worker.mjs', import.meta.url)), [], {
      execArgv: [], env: { ...process.env, DAM_CONFIG_TEST_FILE: path.join(alias, path.basename(file)) },
      stdio: ['ignore', 'ignore', 'inherit', 'ipc'] })
    workers.push(child); await once(child, 'message')
    const pending = save(child, { locale: 'en' })
    // The lock is released before awaiting the child's save.
    child.pending = pending
  })
  await workers.at(-1).pending
  assert.equal((await disk()).locale, 'en')
  console.log('PASS: parent-directory aliases share the same lock')
} finally {
  await Promise.all(workers.map(async child => {
    if (child.exitCode !== null || child.signalCode !== null) return
    const ended = once(child, 'exit'); child.kill(); await ended
  }))
  for (const [key, value] of Object.entries(prior)) value === undefined ? delete process.env[key] : process.env[key] = value
  await rm(root, { recursive: true, force: true })
}

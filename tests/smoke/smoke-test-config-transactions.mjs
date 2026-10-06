/**
 * smoke-test-config-transactions —— 跨进程配置事务（#218，批 B-1 验收）
 *
 * 契约（逐条对应 AUDIT §3.3 / line-B-report #218）：
 *   ① 两个进程并发保存**互不相关**的字段 ⇒ 两个字段都必须留在盘上（旧实现实测丢更新）；
 *   ② 同进程两个引擎实例并发保存 ⇒ 同上；
 *   ③ ★PR#221 未覆盖的第三个洞：**启动期容量迁移的落盘**与另一进程的并发保存必须互不回退；
 *   ④ 负路径：损坏配置 ⇒ 保存被拒且原文件**逐字节不变**（配置锁不得把 quarantined 默认写回真源）；
 *   ⑤ 负路径：配置文件是符号链接 ⇒ 锁原语**拒绝**（config-file-symlink refused），不改写链接目标；
 *   ⑥ 负路径：锁被活进程持有 ⇒ 第二个持锁者超时拒绝；持有者已死 ⇒ 可回收后继续；
 *   ⑦ 忙锁下同步 load 降级**只读快照**：不 quarantine、不迁移、不写盘，诊断可观察；
 *   ⑧ 父目录别名（junction / symlink）共享同一把锁。
 *
 * 手法：真 fork 生产引擎（tests/lib/config-save-worker.mjs → tests/lib/audit-engine.mjs
 *   → lib/index.js），真调用 saveConfig/loadConfigSync，断言**磁盘字节**。不重实现任何生产逻辑。
 */
import assert from 'node:assert/strict'
import { AsyncResource } from 'node:async_hooks'
import { mkdtemp, writeFile, readFile, rm, mkdir, symlink } from 'node:fs/promises'
import { tmpdir, hostname } from 'node:os'
import path from 'node:path'
import { fork, spawn } from 'node:child_process'
import { once } from 'node:events'
import { fileURLToPath } from 'node:url'
import { withConfigLock, withConfigLockSync } from '../../lib/config-lock.js'
import { directoryLink, probeFileSymlinks, unprovenFileLink } from '../lib/link-fixture.mjs'

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
const workerPath = fileURLToPath(new URL('../lib/config-save-worker.mjs', import.meta.url))
async function worker(configFile = file) {
  const child = fork(workerPath, [], {
    execArgv: [], env: { ...process.env, DAM_CONFIG_TEST_FILE: configFile }, stdio: ['ignore', 'ignore', 'inherit', 'ipc'] })
  workers.push(child)
  const [message] = await once(child, 'message')
  assert.equal(message.ready, true)
  return child
}
let sequence = 0
function call(child, payload, timeoutMs = 20000) {
  const id = ++sequence
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => { child.off('message', response); reject(new Error('worker call timeout')) }, timeoutMs)
    function response(message) {
      if (message.id !== id) return
      clearTimeout(timeout); child.off('message', response)
      message.ok ? resolve(message) : reject(Object.assign(new Error(message.error), { workerCode: message.code }))
    }
    child.on('message', response); child.send({ id, ...payload })
  })
}
const save = (child, patch) => call(child, { op: 'save', patch })
try {
  const fileSymlinks = probeFileSymlinks(root)
  const { MemoryEngine, flushDiagnostics } = await import('../lib/audit-engine.mjs')

  /* ── ① 两个独立进程并发保存互不相关字段（20 轮） ── */
  const [a, b] = await Promise.all([worker(), worker()])
  for (let round = 0; round < 20; round++) {
    await writeFile(file, JSON.stringify(baseline))
    await Promise.all([save(a, { locale: 'en' }), save(b, { greetingEnabled: false })])
    const result = await disk()
    assert.equal(result.locale, 'en', 'independent process locale save lost at round ' + round)
    assert.equal(result.greetingEnabled, false, 'independent process greeting save lost at round ' + round)
  }
  console.log('PASS: 20 independent-process saves preserve both patches')

  /* ── ② 同进程两个引擎实例 ── */
  await writeFile(file, JSON.stringify(baseline))
  const x = new MemoryEngine({}), y = new MemoryEngine({})
  for (const engine of [x, y]) { engine._configPath = file; engine.refresh = async () => {} }
  await Promise.all([x.saveConfig({ locale: 'en' }), y.saveConfig({ greetingEnabled: false })])
  assert.equal((await disk()).locale, 'en'); assert.equal((await disk()).greetingEnabled, false)
  console.log('PASS: independent engine instances preserve both patches')

  /* ── ③ ★启动期容量迁移的落盘 vs 另一进程并发保存（PR#221 未覆盖的第三个洞） ──
   * 语义：同步 load 遇锁忙**推迁移**（不阻塞事件循环、磁盘保持原样）；异步 load 等锁补齐。
   * 无论走哪条，**任何一方的字段都不得被回退**，且迁移最终必须完成。 */
  for (let round = 0; round < 12; round++) {
    await writeFile(file, JSON.stringify({ ...baseline, noteCapacityChars: 12000, capacityDefaultsVersion: 0 }))
    await rm(file + '.lock', { force: true })
    await rm(file + '.lock.acquire', { force: true })
    await Promise.all([call(a, { op: 'loadSync' }), save(b, { locale: 'en' })])
    assert.equal((await disk()).locale, 'en', 'concurrent save clobbered by capacity migration at round ' + round)
    // 异步加载（会等锁）必须补齐迁移，且不回退并发保存
    await call(a, { op: 'load' })
    const settled = await disk()
    assert.equal(settled.noteCapacityChars, 24000, 'capacity migration did not complete after the lock freed at round ' + round)
    assert.equal(settled.locale, 'en', 'async migration clobbered the concurrent save at round ' + round)
  }
  {
    // 锁空闲时同步路径必须**当场**完成迁移 —— 否则等于迁移能力被锁掉（半修）
    await writeFile(file, JSON.stringify({ ...baseline, noteCapacityChars: 12000, capacityDefaultsVersion: 0 }))
    await call(a, { op: 'loadSync' })
    assert.equal((await disk()).noteCapacityChars, 24000, 'uncontended sync load must migrate in place')
    assert.ok((await disk()).capacityDefaultsVersion > 0, 'uncontended sync load must persist the migration guard')
  }
  console.log('PASS: 12 rounds of startup capacity migration & concurrent save both survive')

  /* ── ④ 负路径：损坏配置 ⇒ 拒绝且原文件逐字节不变 ── */
  const poison = '{"locale":"zh","broken'
  await writeFile(file, poison)
  await assert.rejects(save(b, { locale: 'en' }), /Invalid configuration|Unexpected|JSON/i)
  assert.equal(await readFile(file, 'utf8'), poison, 'corrupt config must be preserved byte-for-byte')
  assert.equal(await readFile(file + '.lock', 'utf8').then(() => true, () => false), false, 'lock file must not be left behind')
  console.log('PASS: corrupt configuration is refused and preserved byte-for-byte')

  /* ── ⑤ 负路径：配置文件为符号链接 ⇒ 锁原语拒绝，链接目标不被改写 ── */
  const target = path.join(home, 'real-config.json')
  const linkPath = path.join(home, 'linked-config.json')
  await writeFile(target, JSON.stringify(baseline))
  await rm(linkPath, { force: true })
  if (fileSymlinks.available) {
    await symlink(target, linkPath, 'file')
    let entered = false
    await assert.rejects(withConfigLock(linkPath, async () => { entered = true }), /config-file-symlink refused/)
    assert.equal(entered, false, 'file-link refusal must precede the protected callback')
    assert.equal(JSON.parse(await readFile(target, 'utf8')).locale, 'zh', 'symlink target must be untouched')
    console.log('PASS: real file-symlink configuration is refused before callback and target stays untouched')
  } else unprovenFileLink(fileSymlinks, '⑤ final-entry configuration file link refusal')
  // Mandatory final-entry reparse refusal without Windows file-link privilege.
  // This is a directory junction; it does not claim file-symlink coverage.
  const targetDir = path.join(home, 'real-config-dir'), directoryConfig = path.join(home, 'linked-directory-config.json')
  await mkdir(targetDir)
  const outsideConfig = path.join(targetDir, 'dsh-auto-memory.json'), original = JSON.stringify(baseline)
  await writeFile(outsideConfig, original)
  directoryLink(targetDir, directoryConfig)
  let enteredDirectory = false
  await assert.rejects(withConfigLock(directoryConfig, async () => {
    enteredDirectory = true; await writeFile(outsideConfig, 'MUST_NOT_WRITE')
  }), /config-file-symlink refused/)
  assert.equal(enteredDirectory, false)
  assert.equal(await readFile(outsideConfig, 'utf8'), original)
  console.log('PASS: actual final-entry directory link refuses config callback; target bytes unchanged (file-link capability is separate)')

  /* ── ⑥ 负路径：活持有者 ⇒ 超时拒绝；死持有者 ⇒ 可回收 ── */
  const exited = spawn(process.execPath, ['-e', ''], { stdio: 'ignore' })
  await once(exited, 'exit')
  await writeFile(file + '.lock', JSON.stringify({ pid: exited.pid, host: hostname() }))
  await withConfigLock(file, async () => {})
  const holder = await worker()
  await call(holder, { op: 'hold' })
  await assert.rejects(withConfigLock(file, async () => {}, { timeoutMs: 60 }), /config-lock-timeout/)
  await rm(file + '.lock', { force: true })
  holder.kill()
  await once(holder, 'exit')
  await assert.rejects(withConfigLock(file, async () => { throw new Error('injected failure') }), /injected failure/)
  await withConfigLock(file, async () => {})
  console.log('PASS: live owner times out, dead owner is recovered, failure releases the lock')

  /* ── ⑦ 忙锁下同步 load 降级为只读快照 ── */
  await writeFile(file, JSON.stringify({ ...baseline, noteCapacityChars: 12000, capacityDefaultsVersion: 0 }))
  await writeFile(path.join(home, 'dsh-auto-memory-pre.json'), JSON.stringify({ locale: 'obsolete', legacyOnly: 'retain' }))
  await withConfigLock(file, async () => {
    const before = await readFile(file, 'utf8')
    assert.equal(incomingRequest.runInAsyncScope(() => y.loadConfigSync()).locale, 'zh')
    assert.match(y._readError, /config-lock-busy/)
    assert.equal(await readFile(file, 'utf8'), before)
    withConfigLockSync(file, () => {})
  })
  await y.loadConfig()
  assert.equal((await disk()).legacyOnly, 'retain')
  assert.equal((await disk()).noteCapacityChars, 24000)
  await flushDiagnostics()
  console.log('PASS: busy synchronous startup is read-only; async retry performs migrations')

  /* ── ⑧ 父目录别名共享同一把锁 ── */
  const alias = path.join(root, 'alias')
  await symlink(home, alias, process.platform === 'win32' ? 'junction' : 'dir')
  await withConfigLock(file, async () => {
    const child = await worker(path.join(alias, path.basename(file)))
    const pending = save(child, { locale: 'en' })
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

// Standalone reuse of the reviewed calendar-lock algorithm; no dependency on PR #206.
import { mkdir, realpath, lstat } from 'node:fs/promises'
import { openSync, closeSync, writeFileSync, readFileSync, unlinkSync, statSync, realpathSync, mkdirSync, lstatSync } from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { setTimeout as delay } from 'node:timers/promises'

export async function canonicalSharedStatePath(file) {
  let target = path.resolve(file)
  const suffix = []
  for (;;) {
    try { return path.join(await realpath(target), ...suffix) } catch (e) {
      if (e.code !== 'ENOENT') throw e
      const parent = path.dirname(target)
      if (parent === target) return path.resolve(file)
      suffix.unshift(path.basename(target)); target = parent
    }
  }
}

// Recovery is serialized with acquisition: no process may install a new owner
// while another is checking/removing a dead owner's transaction lock.
function isDead(owner) {
  if (!owner || owner.host !== os.hostname() || !Number.isInteger(owner.pid) || owner.pid <= 0) return false
  try { process.kill(owner.pid, 0); return false } catch (e) { return e.code === 'ESRCH' }
}
function removeDead(file) {
  try {
    const before = statSync(file)
    const owner = JSON.parse(readFileSync(file, 'utf8'))
    if (!isDead(owner)) return false
    const after = statSync(file)
    if (before.ino !== after.ino || before.dev !== after.dev) return false
    unlinkSync(file); return true
  } catch (_) { return false }
}
function claim(file) {
  const fd = openSync(file, 'wx')
  try { writeFileSync(fd, JSON.stringify({ pid: process.pid, host: os.hostname() })); return fd }
  catch (e) { closeSync(fd); unlinkSync(file); throw e }
}
export async function acquireSharedStateLock(file, { timeoutMs = 10000 } = {}) {
  try { if ((await lstat(file)).isSymbolicLink()) throw Object.assign(new Error('state-file-symlink refused: ' + file), { statePersistence: true }) } catch (e) { if (e.code !== 'ENOENT') throw e }
  file = await canonicalSharedStatePath(file)
  await mkdir(path.dirname(file), { recursive: true })
  const lock = file + '.lock', gate = lock + '.acquire'
  const deadline = Date.now() + timeoutMs
  let handle
  while (handle === undefined) {
    let acquisition
    try {
      acquisition = claim(gate)
      try { handle = claim(lock) } catch (e) {
        if (e.code !== 'EEXIST') throw e
        if (removeDead(lock)) handle = claim(lock)
      }
    } catch (e) {
      if (e.code !== 'EEXIST') throw e
      // An abandoned acquisition gate fails visibly. Remove it only after
      // stopping all instances; automatically unlinking it can race a new gate.
    } finally {
      if (acquisition !== undefined) { closeSync(acquisition); unlinkSync(gate) }
    }
    if (handle === undefined) {
      if (Date.now() >= deadline) throw new Error('state-lock-timeout: ' + lock)
      await delay(20)
    }
  }
  return () => { closeSync(handle); unlinkSync(lock) }
}

export async function withSharedStateLock(file, job, options) {
  const release = await acquireSharedStateLock(file, options)
  try { return await job() } finally { release() }
}

/**
 * ★#306-fix（2026-10-08）：**同步版**共享锁 —— 协议与上面的 async 版**逐条同形**，只是全程同步：
 *   同一个 `<canonical>.lock` / `<canonical>.lock.acquire` 文件、同一条 `openSync('wx')` 认领、
 *   同一套死主判定（同主机 + 正整数 pid + ESRCH）、同一份 canonical 规则（realpath 最深存在祖先 + 拼回缺失后缀）。
 *   **两版互相排斥**（锁文件与判据同形 ⇒ 同名即互斥）。
 *
 * 为什么必须存在这一版（本轮实测的真回归，不是「顺手加个 API」）：
 *   `MemoryDocumentStore._queue` 的既有契约是「不同文件**不被全局串行化**」，其实现依赖
 *   「`job` 在**同步段里起手**」—— 旧写法 `return await job(file)` 里 `job(file)` 是**同步调用**的，
 *   只是 await 了它的返回值 ⇒ 先入队的任务先起手。
 *   一旦在 job 之前插入**异步**取锁（lstat/realpath/mkdir 都要 await），job 的起手就被推迟到若干个
 *   微任务之后，两个不同文件的任务便**同时**在途 ⇒ 起手顺序变成竞态。
 *   取证：`tests/smoke/smoke-test-issue48.mjs:194` 断言 `deepEqual(events,['a','b'])`，
 *   实测单独跑 **6 次红 3 次**（与本机负载正相关）；把取锁换成同步版后复绿（见下方回归）。
 *
 * 等待有界：争用时用 `Atomics.wait` **真睡眠**（不烧 CPU —— 本仓曾因忙等把整批回归卡死过），
 *   到 `timeoutMs` 抛错，由调用方 fail-closed。
 *
 * ⚠️ 同步睡眠会**阻塞事件循环**：故仅供「必须先同步起手」的调用点使用（当前 = memory-writer 的 _queue），
 *   且默认超时取得较小（见调用方）；能用 async 版的地方一律用 async 版。
 *
 * @returns {() => void} 释放函数（幂等：重复调用安全）
 */
export function acquireSharedStateLockSync(file, { timeoutMs = 10000, pollMs = 20 } = {}) {
  // ① 符号链接拒绝（与 async 版同判据）
  try {
    if (lstatSync(file).isSymbolicLink()) {
      throw Object.assign(new Error('state-file-symlink refused: ' + file), { statePersistence: true })
    }
  } catch (e) { if (e.code !== 'ENOENT') throw e }
  // ② canonical（同步版：realpath 最深存在祖先 + 拼回缺失后缀）
  file = canonicalSharedStatePathSync(file)
  const dir = path.dirname(file)
  try { mkdirSync(dir, { recursive: true }) } catch (e) { if (e.code !== 'EEXIST') throw e }
  const lock = file + '.lock', gate = lock + '.acquire'
  const deadline = Date.now() + timeoutMs
  let handle
  while (handle === undefined) {
    let acquisition
    try {
      acquisition = claimSync(gate)
      try { handle = claimSync(lock) } catch (e) {
        if (e.code !== 'EEXIST') throw e
        if (removeDead(lock)) handle = claimSync(lock)
      }
    } catch (e) {
      if (e.code !== 'EEXIST') throw e
      // 被遗弃的 acquisition gate 会**可见地**失败；只在所有实例停下后才清理它，
      //   自动删除会与新的 gate 竞争（与 async 版同一纪律）。
    } finally {
      if (acquisition !== undefined) { closeSync(acquisition); try { unlinkSync(gate) } catch (_) {} }
    }
    if (handle === undefined) {
      if (Date.now() >= deadline) throw new Error('state-lock-timeout: ' + lock)
      sleepSyncPre(pollMs)
    }
  }
  let released = false
  return () => {
    if (released) return
    released = true
    try { closeSync(handle) } catch (_) {}
    try { unlinkSync(lock) } catch (_) {}
  }
}

/** 同步 canonical：realpath(自身) → realpath(最近存在祖先)+缺失后缀 → path.resolve。 */
function canonicalSharedStatePathSync(file) {
  let target = path.resolve(file)
  const suffix = []
  for (;;) {
    try { return path.join(realpathSync(target), ...suffix) } catch (e) {
      if (e.code !== 'ENOENT') throw e
      const parent = path.dirname(target)
      if (parent === target) return path.resolve(file)
      suffix.unshift(path.basename(target)); target = parent
    }
  }
}

/** 同步认领（与 claim() 同形，仅去掉 async）。 */
function claimSync(file) {
  const fd = openSync(file, 'wx')
  try { writeFileSync(fd, JSON.stringify({ pid: process.pid, host: os.hostname() })); return fd }
  catch (e) { closeSync(fd); try { unlinkSync(file) } catch (_) {}; throw e }
}

/** 真睡眠（Atomics.wait）：不烧 CPU，且不被 signal 打断。 */
function sleepSyncPre(ms) {
  try {
    const sab = new SharedArrayBuffer(4)
    Atomics.wait(new Int32Array(sab), 0, 0, ms)
  } catch (_) {
    // 极端环境不支持 ⇒ 退化为有界忙等（仍是同步语义，只是费 CPU）
    const end = Date.now() + ms
    while (Date.now() < end) { /* bounded */ }
  }
}

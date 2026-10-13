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

/** ★#341：门元数据缺失/损坏时的**宽限**（ms）—— 短于此一律不删（见 reclaimDeadGate）。 */
const GATE_STALE_MS_PRE = 30000

/**
 * ★#341（2026-10-13）：**回收「被遗弃的 acquisition gate」**。
 *
 * 缺陷现场：门文件（`<lock>.acquire`）与锁文件一样由 claim() 写入了 owner 元数据，
 *   但旧实现的取锁循环在 `claim(gate)` 抛 EEXIST 时**只 catch、不回收**，注释主张
 *   「等所有实例停下再人工清理」。于是一次崩溃（进程死在 `claim(gate)` 与
 *   `finally { unlinkSync(gate) }` 之间，或门清理本身失败）留下的门会让**之后每一个进程**
 *   的每一轮循环都在 `claim(gate)` 上 EEXIST ⇒ 直到 timeoutMs 到期恒定抛
 *   `state-lock-timeout`：**锁可回收，门不可回收**，写入被永久堵死（#341 的报告症状）。
 *
 * 两条回收判据（**都**要求 stat 前后 ino/dev 一致 ⇒ 不会回收「刚被别人换上的新门」）：
 *   ① 元数据可解析且判死（同主机 + 正整数 pid + ESRCH）⇒ 立即回收 —— 复用 removeDead，
 *      与锁**逐条同形**，绝不新造第二套死主判据；
 *   ② 元数据**不可解析**（空文件 / 撕裂写 / 非 JSON）⇒ 必须**超过 staleMs 宽限**才回收。
 *      为什么需要宽限：`claim()` 是「先 openSync('wx') 再 writeFileSync」，两者之间存在
 *      **文件已存在但内容为空**的真实窗口；把刚创建的空门当遗弃门删掉，就等于允许两个进程
 *     同时进入临界区（互斥被破坏）。宽限保证只清理「确实躺了很久」的空门。
 *   活主进程的门、异主机的门一律不动（宁可超时也不破坏互斥）。
 *
 * 这个函数只删**门**，不删锁 —— 门不是互斥原语（锁才是：`openSync(lock,'wx')` 的原子独占），
 *   门只用于把「死主回收」与新主认领串行化。因此回收竞态最坏只是多一次回收尝试，
 *   不可能让两个持门者同时拿到锁（先到者在 wx 认领处胜出，后到者仍走 EEXIST 分支）。
 *
 * @param {string} gate  门文件路径（`<canonical>.lock.acquire`）
 * @param {number} staleMs 元数据不可解析时的宽限（ms）
 * @returns {boolean} true = 确实回收了（调用方应立即重试，不必空等一个 poll）
 */
export function reclaimDeadGate(gate, staleMs = GATE_STALE_MS_PRE) {
  if (removeDead(gate)) return true
  // 走到这里：元数据不可解析（或异主机/活主 —— 那些下面的年龄判据也不会放行）。
  try {
    const before = statSync(gate)
    // 只有「元数据不可解析」这一种才走年龄兜底；能解析出来就必须按死主判据决定。
    let parsed = null
    try { parsed = JSON.parse(readFileSync(gate, 'utf8')) } catch (_) { parsed = null }
    if (parsed !== null) return false
    if (!Number.isFinite(staleMs) || staleMs < 0) return false
    if (Date.now() - before.mtimeMs < staleMs) return false
    const after = statSync(gate)
    if (before.ino !== after.ino || before.dev !== after.dev) return false
    unlinkSync(gate)
    return true
  } catch (_) { return false }
}
function claim(file) {
  const fd = openSync(file, 'wx')
  try { writeFileSync(fd, JSON.stringify({ pid: process.pid, host: os.hostname() })); return fd }
  catch (e) { closeSync(fd); unlinkSync(file); throw e }
}
export async function acquireSharedStateLock(file, { timeoutMs = 10000, gateStaleMs = GATE_STALE_MS_PRE } = {}) {
  try { if ((await lstat(file)).isSymbolicLink()) throw Object.assign(new Error('state-file-symlink refused: ' + file), { statePersistence: true }) } catch (e) { if (e.code !== 'ENOENT') throw e }
  file = await canonicalSharedStatePath(file)
  await mkdir(path.dirname(file), { recursive: true })
  const lock = file + '.lock', gate = lock + '.acquire'
  const deadline = Date.now() + timeoutMs
  let handle
  while (handle === undefined) {
    let acquisition
    let gateReclaimed = false
    try {
      acquisition = claim(gate)
      try { handle = claim(lock) } catch (e) {
        if (e.code !== 'EEXIST') throw e
        if (removeDead(lock)) handle = claim(lock)
      }
    } catch (e) {
      if (e.code !== 'EEXIST') throw e
      // ★#341（2026-10-13）：门（<lock>.acquire）是**可回收的资源**，不是永久墓碑。
      //   旧实现只 catch 不回收，注释主张「等所有实例停下再人工清理」—— 实测后果是
      //   一次崩溃就留下**无人能回收**的门：后续每个进程的每轮循环都卡在 claim(gate) 的
      //   EEXIST 上，直到 timeoutMs 恒定抛 state-lock-timeout，写入被永久堵死。
      //   现按与锁**逐条同形**的判据回收：只有「同主机 + 正整数 pid + 进程已消失(ESRCH)」
      //   才删；活主/异主机/元数据不可解析（在 30s 宽限内）一律不动。
      gateReclaimed = reclaimDeadGate(gate, gateStaleMs)
    } finally {
      if (acquisition !== undefined) {
        try { closeSync(acquisition) } catch (_) {}
        // 门清理失败**不得**把异常抛出循环：否则一次 EPERM/ENOENT 会顶掉真正的结果，
        //   而门留着正好是 #341 的堵死形态（交给 reclaimDeadGate 在下一轮回收）。
        try { unlinkSync(gate) } catch (_) {}
      }
    }
    if (handle === undefined) {
      // ★deadline 必须在**任何**重试之前判（含下面「刚回收完门就立刻重试」那条）：
      //   否则一个被反复重建的死主门会让循环永不退出（同步版更会直接挂住进程）。
      if (Date.now() >= deadline) throw new Error('state-lock-timeout: ' + lock)
      // 刚回收掉一个死主门 ⇒ 立刻重试，不白等一个 poll 周期（回收后本次有很大概率直接取到锁）。
      if (!gateReclaimed) await delay(20)
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
export function acquireSharedStateLockSync(file, { timeoutMs = 10000, pollMs = 20, gateStaleMs = GATE_STALE_MS_PRE } = {}) {
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
    let gateReclaimed = false
    try {
      acquisition = claimSync(gate)
      try { handle = claimSync(lock) } catch (e) {
        if (e.code !== 'EEXIST') throw e
        if (removeDead(lock)) handle = claimSync(lock)
      }
    } catch (e) {
      if (e.code !== 'EEXIST') throw e
      // ★#341（2026-10-13）：与 async 版**逐条同形**的可回收判据 —— 旧注释主张
      //   「只在所有实例停下后才清理门」，实测后果是崩溃留下的门**无人能回收**：
      //   同步取锁的每个调用点（memory-writer 的 _queue）此后每轮都卡在 claimSync(gate)
      //   的 EEXIST 上，直到 timeoutMs 到点抛 state-lock-timeout，写入被永久堵死。
      //   现只回收「同主机 + 正整数 pid + ESRCH」的死主门（元数据不可解析需超宽限），
      //   活主/异主机一律不动。
      gateReclaimed = reclaimDeadGate(gate, gateStaleMs)
    } finally {
      if (acquisition !== undefined) {
        try { closeSync(acquisition) } catch (_) {}
        try { unlinkSync(gate) } catch (_) {}
      }
    }
    if (handle === undefined) {
      // 同 async 版：deadline 先于任何重试判定（防「门被反复重建」时无限自旋/挂住事件循环）。
      if (Date.now() >= deadline) throw new Error('state-lock-timeout: ' + lock)
      // 刚回收掉一个死主门 ⇒ 立刻重试，不白等一个 poll 周期。
      if (!gateReclaimed) sleepSyncPre(pollMs)
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

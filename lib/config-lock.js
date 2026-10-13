// One transaction boundary for settings saves and startup migrations.
import { AsyncLocalStorage } from 'node:async_hooks'
import { openSync, closeSync, writeFileSync, readFileSync, unlinkSync, statSync, lstatSync, realpathSync, mkdirSync } from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { setTimeout as delay } from 'node:timers/promises'
// ★#341（2026-10-13）：门（<lock>.acquire）的**回收判据只有一份实现** —— 直接复用
//   lib/shared-state-lock.js 导出的 reclaimDeadGate，而不是在本文件再抄一遍。
//   本文件与那个模块本就共用同一套锁协议（wx 认领 + 同主机/正整数 pid/ESRCH 死主判定），
//   若各自维护一份回收判据，改一处漏一处就会变成「半修」（本仓已记过该教训）。
//   ⚠️ 只 import 纯函数，不改变本文件的事务边界语义：这里仍不取 shared-state-lock 的锁。
import { reclaimDeadGate } from './shared-state-lock.js'

const context = new AsyncLocalStorage()

function canonical(file) {
  let target = path.resolve(file)
  try {
    if (lstatSync(target).isSymbolicLink()) throw new Error('config-file-symlink refused')
  } catch (e) { if (e.code !== 'ENOENT') throw e }
  const suffix = []
  for (;;) {
    try { return path.join(realpathSync(target), ...suffix) } catch (e) {
      if (e.code !== 'ENOENT') throw e
      const parent = path.dirname(target)
      if (parent === target) throw e
      suffix.unshift(path.basename(target)); target = parent
    }
  }
}

function claim(file) {
  const fd = openSync(file, 'wx')
  try { writeFileSync(fd, JSON.stringify({ pid: process.pid, host: os.hostname() })); return fd }
  catch (e) { closeSync(fd); unlinkSync(file); throw e }
}

function removeDead(file) {
  try {
    const before = statSync(file)
    const owner = JSON.parse(readFileSync(file, 'utf8'))
    if (owner.host !== os.hostname() || !Number.isInteger(owner.pid) || owner.pid <= 0) return false
    try { process.kill(owner.pid, 0); return false } catch (e) { if (e.code !== 'ESRCH') return false }
    const after = statSync(file)
    if (before.ino !== after.ino || before.dev !== after.dev) return false
    unlinkSync(file)
    return true
  } catch (_) { return false }
}

// The acquisition gate serializes stale-owner recovery with new owners.
// ★#341（2026-10-13）：旧注释主张「被遗弃的门会可见地失败，不去自动回收（免得与新的门竞争）」。
//   该主张已被实测推翻：门**只有**在 claim 与 unlink 之间就死掉的进程会留下，而此后
//   **每一个**进程的 tryAcquire 都在 claim(gate) 上 EEXIST ⇒ 同步路径恒抛 CONFIG_LOCK_BUSY、
//   异步路径等满 timeoutMs 抛 config-lock-timeout —— 配置**永久写不进去**，且没有任何自愈路径。
//   现按与锁**同一份判据**回收：只删「同主机 + 正整数 pid + 进程已消失(ESRCH)」的门
//   （元数据不可解析需超过宽限）；活主/异主机一律不动，stat 前后 ino/dev 复核 ⇒ 不会误删新门。
function tryAcquire(file) {
  const lock = file + '.lock', gate = lock + '.acquire'
  // ★#341：最多两轮 —— 第 1 轮若发现门是**死主遗弃**的，回收后立刻重试，本次调用即可恢复。
  //   为什么不是「回收完就返回 null 让调用方下一轮再来」：withConfigLockSync 的契约是
  //   「绝不阻塞，忙则抛 CONFIG_LOCK_BUSY 由启动迁移延后」——若回收后仍抛 busy，
  //   门虽已清掉但**本次写配置依然失败**，等于把「永久堵死」降级成「偶发失败」而非修好。
  //   两轮是有界的：第 2 轮不再回收（防「门被反复重建」时无限自旋）。
  for (let attempt = 0; attempt < 2; attempt++) {
    let acquisition, handle
    try {
      acquisition = claim(gate)
      try { handle = claim(lock) } catch (e) {
        if (e.code !== 'EEXIST') throw e
        if (removeDead(lock)) handle = claim(lock)
      }
    } catch (e) {
      if (e.code !== 'EEXIST') throw e
      // 门被占着 ⇒ 判它是不是死主遗弃的；是就回收并在下一轮重试（唯一的重试理由）。
      if (attempt === 0 && reclaimDeadGate(gate)) continue
    }
    finally {
      if (acquisition !== undefined) {
        // 释放**绝不抛**：门清理失败若冒泡，会顶掉调用方真正的写盘错误面
        //   （本文件头注已因同一理由把 mkdir 失败降级为「跳过加锁」）。
        try { closeSync(acquisition) } catch (_) {}
        try { unlinkSync(gate) } catch (_) {}
      }
    }
    if (handle === undefined) return null
    // 释放同样绝不抛：本函数在 run() 的 finally 链里被调用，抛出会覆盖 job 的真实结果/错误。
    return () => {
      try { closeSync(handle) } catch (_) {}
      try { unlinkSync(lock) } catch (_) {}
    }
  }
  return null
}

// ★B-1 偏差（对 PR#221 原文此处 mkdirSync 的替换，已实测归因，共一处语义差异）：
//   原写法在 mkdir 失败时直接抛出，而这里的失败**不代表锁的问题**，代表
//   「配置文件的父目录根本不可用」（如父路径被一个普通文件占位）。
//   实测：smoke-test-settings-safety 把 _configPath 指到 <home>/block/settings.json
//   （block 是文件），原写法先抛 EEXIST、修 mkdir 后又在 .lock.acquire 上抛 ENOENT，
//   两种都把调用方真正的「ENOTDIR / save failed」**掩盖**成一条无从理解的错误。
//   锁不该替写盘决定错误面 ⇒ 目录不可用时**跳过加锁**，把控制权交回真实的写盘路径报错。
//   安全性：该路径本就不可能写入任何字节，故此处不存在「两个写者互不互斥」的风险。
function ensureLockDir(file) {
  try { mkdirSync(path.dirname(file), { recursive: true }); return true } catch (_) { return false }
}

function owned(file) {
  return context.getStore()?.some(token => token.active && token.file === file)
}

function run(file, job, release, async) {
  const token = { file, active: true }
  const tokens = [...(context.getStore() || []), token]
  const finish = () => { token.active = false; release() }
  if (async) return context.run(tokens, async () => { try { return await job() } finally { finish() } })
  return context.run(tokens, () => { try { return job() } finally { finish() } })
}

export function withConfigLockSync(file, job) {
  file = canonical(file)
  if (owned(file)) return job()
  if (!ensureLockDir(file)) return job()
  const release = tryAcquire(file)
  // Never block the event loop: it may be running the asynchronous owner.
  if (!release) throw Object.assign(new Error('config-lock-busy: startup migration deferred'), { code: 'CONFIG_LOCK_BUSY' })
  return run(file, job, release, false)
}

export async function withConfigLock(file, job, { timeoutMs = 10000 } = {}) {
  file = canonical(file)
  if (owned(file)) return job()
  if (!ensureLockDir(file)) return job()
  const deadline = Date.now() + timeoutMs
  let release
  while (!(release = tryAcquire(file))) {
    if (Date.now() >= deadline) throw new Error('config-lock-timeout')
    await delay(20)
  }
  return run(file, job, release, true)
}

// A busy synchronous loader may read the last complete atomic snapshot, but
// must neither quarantine it nor perform migrations outside the transaction.
export function readConfigSnapshot(file) {
  try {
    const value = JSON.parse(readFileSync(file, 'utf8'))
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('config must be a JSON object')
    return value
  } catch (e) { if (e.code === 'ENOENT') return null; throw e }
}
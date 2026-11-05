/**
 * upgrade-pending.js —— 记忆整理向导 · P6（2026-11-03）
 *
 * 依据：docs/internal/PLAN-UPGRADE-WIZARD-20261103.md §5（迁移期间的 memory 渠道）
 * 任务：迁移期用户写工具（memory_log / memory_note / memory_event）被**拒绝**时，
 *   被拒条目**不得静默丢弃**，必须落盘排队、迁移结束或下次启动自动补写（replay）。
 *
 * 设计纪律（与 P2 applier 同族，但更简单：这里只碰队列文件，不碰记忆库）：
 *   ① **原子写**：先写 `.json.tmp` 再 rename —— 断电不会留下半个 JSON；
 *   ② **文件名即时间序**：`<ts 毫秒>-<rand>.json`，字典序 = 入队顺序 ⇒ replay 天然按时间回放；
 *   ③ **replay 失败绝不删源文件**：只有 apply 成功才 unlink，失败/抛错/解析失败一律留在盘上供下次重试
 *      （项目规约「不得静默永久丢弃已写入数据」，#489 同族教训）；
 *   ④ **不建空目录噪音**：读取类操作对 ENOENT 返回空，不 mkdir。
 *
 * 目录布局：`<root>/pending-writes/<runId>/<ts>-<rand>.json`
 * 文件形状：
 *   { schema:'upgrade_pending_write_v1', runId, queuedAt:number, entry:{tool,args,...} }
 */

import { randomBytes } from 'node:crypto'
import { readFile, writeFile, rename, mkdir, unlink, readdir } from 'node:fs/promises'
import path from 'node:path'

/** 队列根目录名（与 PLAN §5 的 pending-writes 同源） */
export const PENDING_DIRNAME = 'pending-writes'
/** 单条记录 schema */
export const PENDING_SCHEMA = 'upgrade_pending_write_v1'

/** 队列文件名窗口：`<13 位毫秒>-<hex>.json`（测试按此正则断言） */
export const PENDING_FILE_RE = /^\d{13,}-[0-9a-z]+\.json$/i

/** 目录名安全：runId 不允许路径分隔符/上跳，防写到 <root> 之外 */
function assertRunIdPre(runId) {
  const run = String(runId == null ? '' : runId)
  if (!run) throw new Error('upgrade-pending: 缺 runId')
  if (!/^[A-Za-z0-9._-]+$/.test(run) || run === '.' || run === '..') throw new Error('upgrade-pending: 非法 runId：' + run)
  return run
}

/** 队列目录：<root>/pending-writes/<runId> */
export function pendingRunDirPre(root, runId) {
  const base = String(root == null ? '' : root)
  if (!base) throw new Error('upgrade-pending: 缺 root')
  return path.join(base, PENDING_DIRNAME, assertRunIdPre(runId))
}

/** 队列文件名（导出以便套件断言命名契约） */
export function pendingFileNamePre(now, rand) {
  const t = Number(now) > 0 ? Math.floor(Number(now)) : Date.now()
  const r = String(rand || randomBytes(4).toString('hex'))
  return t + '-' + r + '.json'
}

/**
 * 入队一条被拒的用户写入。**原子写**（tmp → rename）后才返回 ok。
 *
 * @param {{root:string, runId:string, entry:object, now?:number, rand?:string}} p
 * @returns {Promise<{ok:boolean, file?:string, id?:string, bytes?:number, runId?:string, code?:string, error?:string}>}
 */
export async function enqueuePendingWritePre(p = {}) {
  const o = p && typeof p === 'object' ? p : {}
  if (!o.entry || typeof o.entry !== 'object' || Array.isArray(o.entry)) {
    return { ok: false, code: 'bad-entry', error: 'entry 必须是对象（用户写入的完整参数）' }
  }
  let dir
  let runId
  try {
    runId = assertRunIdPre(o.runId)
    dir = pendingRunDirPre(o.root, runId)
  } catch (e) {
    return { ok: false, code: 'bad-args', error: String((e && e.message) || e) }
  }
  const now = Number(o.now) > 0 ? Math.floor(Number(o.now)) : Date.now()
  const rec = { schema: PENDING_SCHEMA, runId, queuedAt: now, entry: o.entry }
  const body = JSON.stringify(rec, null, 2)
  const name = pendingFileNamePre(now, o.rand)
  const file = path.join(dir, name)
  const tmp = path.join(dir, name + '.tmp')
  try {
    await mkdir(dir, { recursive: true })
    await writeFile(tmp, body, 'utf8')
    await rename(tmp, file)
  } catch (e) {
    try { await unlink(tmp) } catch (_) {}
    return { ok: false, code: 'write-failed', error: String((e && e.message) || e) }
  }
  return { ok: true, file, id: name.replace(/\.json$/i, ''), bytes: Buffer.byteLength(body, 'utf8'), runId, queuedAt: now }
}

/**
 * 列某 run 的队列文件（**只认 .json**，忽略 .tmp 残留）。不存在 ⇒ []。
 * 返回绝对路径，按文件名排序（= 入队时间序）。
 */
export async function listPendingWritesPre(p = {}) {
  const o = p && typeof p === 'object' ? p : {}
  let dir
  try { dir = pendingRunDirPre(o.root, o.runId) } catch (_) { return [] }
  let names = []
  try { names = await readdir(dir) } catch (e) { if (e && e.code === 'ENOENT') return []; throw e }
  return names.filter((n) => /\.json$/i.test(n) && !/\.tmp$/i.test(n)).sort().map((n) => path.join(dir, n))
}

/** 列出所有有待补写队列的 runId（下次启动时用；不存在 ⇒ []） */
export async function listPendingRunIdsPre(root) {
  const base = path.join(String(root == null ? '' : root), PENDING_DIRNAME)
  let ents
  try { ents = await readdir(base, { withFileTypes: true }) } catch (e) { if (e && e.code === 'ENOENT') return []; throw e }
  return ents.filter((d) => d && d.isDirectory()).map((d) => String(d.name)).sort()
}

/** 队列计数（回执「补写 N 条」用） */
export async function countPendingWritesPre(p = {}) {
  const o = p && typeof p === 'object' ? p : {}
  const runIds = o.runId ? [String(o.runId)] : await listPendingRunIdsPre(o.root)
  let total = 0
  const perRun = {}
  for (const rid of runIds) {
    let n = 0
    try { n = (await listPendingWritesPre({ root: o.root, runId: rid })).length } catch (_) {}
    perRun[rid] = n
    total += n
  }
  return { total, perRun }
}

/**
 * ★补写回放：逐条读队列 → apply(entry, meta)。
 *
 * 成功判据（fail-closed 口径）：
 *   · apply 正常返回，且**不**是 false / {ok:false} ⇒ 成功 → unlink 源文件；
 *   · apply 抛错 / 返回 false / {ok:false} / 文件损坏 ⇒ **失败，源文件保留**。
 *
 * @param {{root:string, runId?:string, apply:(entry:object, meta:{file:string,runId:string,queuedAt:number})=>any}} p
 *        runId 省略 ⇒ 回放全部 run（下次启动场景）
 * @returns {Promise<{ok:boolean, replayed:number, failed:number, remaining:number, results:object[], runIds:string[]}>}
 */
export async function replayPendingWritesPre(p = {}) {
  const o = p && typeof p === 'object' ? p : {}
  const empty = { ok: true, replayed: 0, failed: 0, remaining: 0, results: [], runIds: [] }
  if (typeof o.apply !== 'function') {
    return Object.assign({}, empty, { ok: false, code: 'no-apply', error: 'replayPendingWritesPre 需要 apply(entry) 回调' })
  }
  let runIds = []
  try {
    runIds = o.runId ? [assertRunIdPre(o.runId)] : await listPendingRunIdsPre(o.root)
  } catch (e) {
    return Object.assign({}, empty, { ok: false, code: 'bad-args', error: String((e && e.message) || e) })
  }

  let replayed = 0
  let failed = 0
  const results = []
  for (const rid of runIds) {
    let files = []
    try {
      files = await listPendingWritesPre({ root: o.root, runId: rid })
    } catch (e) {
      failed++
      results.push({ runId: rid, file: '', ok: false, code: 'list-failed', error: String((e && e.message) || e) })
      continue
    }
    for (const file of files) {
      let rec = null
      try { rec = JSON.parse(await readFile(file, 'utf8')) } catch (e) {
        failed++
        results.push({ runId: rid, file, ok: false, code: 'unreadable', error: String((e && e.message) || e).slice(0, 200) })
        continue
      }
      const entry = (rec && typeof rec === 'object' && rec.entry && typeof rec.entry === 'object') ? rec.entry : rec
      const meta = { file, runId: rid, queuedAt: Number((rec && rec.queuedAt) || 0) || 0 }
      let res
      try {
        res = await o.apply(entry, meta)
      } catch (e) {
        failed++
        results.push({ runId: rid, file, ok: false, code: 'apply-threw', error: String((e && e.message) || e).slice(0, 300) })
        continue // ★不删除源文件
      }
      const rejected = res === false || (res && typeof res === 'object' && res.ok === false)
      if (rejected) {
        failed++
        results.push({ runId: rid, file, ok: false, code: 'apply-rejected', error: String((res && res.error) || '').slice(0, 300) })
        continue // ★不删除源文件
      }
      try {
        await unlink(file)
      } catch (e) {
        failed++
        results.push({ runId: rid, file, ok: false, code: 'unlink-failed', error: String((e && e.message) || e) })
        continue
      }
      replayed++
      results.push({ runId: rid, file, ok: true })
    }
  }

  let remaining = 0
  for (const rid of runIds) {
    try { remaining += (await listPendingWritesPre({ root: o.root, runId: rid })).length } catch (_) {}
  }
  return { ok: failed === 0, replayed, failed, remaining, results, runIds }
}

export default {
  PENDING_DIRNAME,
  PENDING_SCHEMA,
  PENDING_FILE_RE,
  pendingRunDirPre,
  pendingFileNamePre,
  enqueuePendingWritePre,
  listPendingWritesPre,
  listPendingRunIdsPre,
  countPendingWritesPre,
  replayPendingWritesPre,
}

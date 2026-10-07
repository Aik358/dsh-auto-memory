/**
 * 通用技能库（procedure memory）**跨进程快照事务** —— #250（C03）的落点。
 *
 * ── 缺陷现场（为什么必须有这个模块）──
 * `hub-io.js` 的技能库写入此前是「整份快照覆盖写」：进程 A 与进程 B 各自持有
 * 启动时读到的快照，谁后写谁赢（LWW）。A 新增/修改的条目会被 B 的旧快照**静默吃掉**，
 * 用户侧表现为「刚固化的技能过一会儿没了」，且磁盘上不留任何痕迹。
 *
 * ── 本模块的三条契约 ──
 *   ① **合并不是覆盖**：只把**本次写者自己的改动**（base → local 的差分）应用到
 *      加锁后重读的磁盘快照（fresh）上；写者没碰过的行一律以磁盘为准。
 *   ② **同一条目被两个进程各改一次 ⇒ 明确拒绝**（`DAM-PROCEDURE-CONFLICT`）：
 *      不静默挑选一方。拒绝时**不写盘**（调用方保证），并由
 *      `writeProcedureConflictCopyPre` 把 base/local/fresh 三方快照落盘留痕，
 *      人类/工具可事后比对（判据 #250 要求「冲突副本落盘可查」）。
 *   ③ **未知/不支持的行绝不静默过滤**：比对走 store 的既有归一化（与 hub-io
 *      的 legacy/session 归一化同一套），归一化不认的行退回**原文**参与比对，
 *      因此它们既不会被判成「用户编辑」，也不会被悄悄丢弃。
 *
 * 与 `plan-store.js` 的关系：两者同源 —— 整篇/逐条 CAS + 冲突副本落盘 + 明确拒绝
 * LWW；本模块是技能库那一版，逐条粒度（procedureId），不是整篇 sha256。
 */
import { mkdirSync, writeFileSync, existsSync } from 'node:fs'
import path from 'node:path'
import { isDeepStrictEqual } from 'node:util'
import { createProcedureStorePre } from './procedure-store.js'

/** 冲突副本的子目录名（与 plan-store 的 `handoff/conflicts` 同一命名习惯）。 */
export const PROCEDURE_CONFLICT_DIR_PRE_V1 = 'conflicts'

/** 空库快照（与 hub-io 的 `empty()` 同形）。 */
export const emptyProcedureSnapshotPre = () => ({ schemaVersion: 1, procedures: [] })

/** 深拷贝快照：事务三方比对**不得共享引用**（否则后续写入会改脏比较基准）。 */
export const copyProcedureSnapshotPre = snapshot => JSON.parse(JSON.stringify(snapshot || emptyProcedureSnapshotPre()))

const rows = snapshot => copyProcedureSnapshotPre(snapshot).procedures || []
const rawById = snapshot => new Map(rows(snapshot).map(row => [String(row && row.procedureId), row]))

const byId = snapshot => {
  // restore 会做 legacy/session 归一化。三方必须比较**同一逻辑形状** ——
  // 仅仅「盘上是一条旧行」不构成用户编辑。
  const original = rawById(snapshot), store = createProcedureStorePre()
  try { store.restore({ schemaVersion: 1, procedures: [...original.values()] }) } catch (_) { return original }
  const normalized = rawById(store.snapshot())
  // 归一化不认的行按原文参与比对，绝不静默过滤。
  return new Map([...original].map(([id, row]) => [id, normalized.get(id) || row]))
}

/**
 * 把 `local`（写者提交的完整快照）相对 `base`（写者上次看到的快照）的差分，
 * 应用到 `fresh`（加锁后重读的磁盘快照）上。
 *
 * 语义（逐条）：
 *   · base 与 local 相同 ⇒ 写者没碰这一条 ⇒ **不参与**（磁盘说了算，含磁盘上新增的行）；
 *   · 这一条被写者改过/删过 ⇒ 磁盘必须仍是写者上次看到的那一版（= base）；
 *       磁盘已被别人改成第三个版本 ⇒ **抛冲突**（不挑选任何一方）；
 *   · 写者新增的行（base 无、local 有）⇒ 叠加到磁盘快照上（别人新增的行保留）。
 *
 * @returns {object} 合并后的快照（磁盘的顶层字段 + 本地快照的其它字段 + 合并后的 procedures）
 * @throws  {Error} code=`DAM-PROCEDURE-CONFLICT`（附 `procedureId`）
 */
export function mergeProcedureSnapshotPre(base, local, fresh) {
  const before = byId(base), wanted = byId(local), diskRows = byId(fresh)
  const current = rawById(fresh), localRows = rawById(local)
  for (const id of new Set([...before.keys(), ...wanted.keys()])) {
    const old = before.get(id), next = wanted.get(id), disk = diskRows.get(id)
    if (isDeepStrictEqual(old, next)) continue
    if (!isDeepStrictEqual(disk, old) && !isDeepStrictEqual(disk, next)) {
      throw Object.assign(new Error('procedure-conflict: reload before editing ' + id), {
        code: 'DAM-PROCEDURE-CONFLICT', reason: 'procedure-conflict', procedureId: id,
      })
    }
    if (next === undefined) current.delete(id)
    else current.set(id, localRows.get(id))
  }
  return { ...fresh, ...local, procedures: [...current.values()] }
}

/** 两个快照的**逻辑行集**是否一致（归一化后逐条比对）。用于「有没有真的变」的判据。 */
export function sameProcedureRowsPre(a, b) {
  return isDeepStrictEqual(byId(a), byId(b))
}

/**
 * 冲突副本落盘（#250 判据：「冲突副本落盘可查」）。
 *
 * 落点：`<库目录>/conflicts/procedures.conflict-<ISO 时间>-<pid>[-n].json`。
 * 内容：reason / procedureId / 时间 / pid + **三方快照**（base 我上次看到的、local 我提交的、
 * onDisk 当时盘上的）——事后可逐条比对，不依赖任何内存态。
 * 全程 fail-soft：副本写不出来只返回 null，**不得**把「拒绝写库」这件事升级成异常
 * （拒绝本身已经由返回值表达，副本只是留痕）。
 *
 * @returns {string|null} 副本文件的绝对路径
 */
export function writeProcedureConflictCopyPre(dir, info = {}) {
  if (!dir) return null
  try {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-')
    const stem = 'procedures.conflict-' + stamp + '-' + process.pid
    const sub = path.join(dir, PROCEDURE_CONFLICT_DIR_PRE_V1)
    let file = path.join(sub, stem + '.json')
    for (let n = 1; existsSync(file) && n < 1000; n++) file = path.join(sub, stem + '.' + n + '.json')
    mkdirSync(sub, { recursive: true })
    writeFileSync(file, JSON.stringify({
      schemaVersion: 1,
      reason: String(info.reason || 'procedure-conflict'),
      procedureId: info.procedureId === undefined || info.procedureId === null ? null : String(info.procedureId),
      at: Date.now(),
      pid: process.pid,
      base: copyProcedureSnapshotPre(info.base),
      local: copyProcedureSnapshotPre(info.local),
      onDisk: copyProcedureSnapshotPre(info.fresh),
    }, null, 2), 'utf8')
    return file
  } catch (_) { return null }
}

/**
 * `mergeProcedureSnapshotPre` 的**不抛错**包装：冲突时落盘副本并返回结构化拒绝。
 * hub-io 的保存路径用它，这样「明确拒绝」既能被上层读到，又已经留下可查证据。
 *
 * @returns {{ok:true, snapshot:object, conflict:null} |
 *           {ok:false, reason:'procedure-conflict', procedureId:string|null, conflictFile:string|null, error:string}}
 */
export function mergeProcedureSnapshotWithConflictCopyPre({ dir, base, local, fresh } = {}) {
  try {
    return { ok: true, snapshot: mergeProcedureSnapshotPre(base, local, fresh), conflict: null }
  } catch (e) {
    if (!e || e.code !== 'DAM-PROCEDURE-CONFLICT') throw e
    const conflictFile = writeProcedureConflictCopyPre(dir, {
      reason: e.reason || 'procedure-conflict', procedureId: e.procedureId, base, local, fresh,
    })
    return {
      ok: false, reason: 'procedure-conflict', procedureId: e.procedureId === undefined ? null : e.procedureId,
      conflictFile, error: String((e && e.message) || e),
    }
  }
}

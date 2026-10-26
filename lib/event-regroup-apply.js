/**
 * event-regroup-apply.js —— ★R6（2026-10-27）：**提案落盘 + 快照 + 回滚**。
 *
 * ⚠️ 这是整条链路上**唯一会写用户数据**的模块。设计原则：
 *   ① **默认 dry-run**：不传 `apply:true` 一律不写盘，只返回「将要做什么」
 *   ② **令牌制**：必须带 `token` 且与提案内容指纹匹配（防「批准了 A 却落盘了 B」）
 *   ③ **快照先行**：写盘前把 event-store.json 整份复制到 backup 目录，失败可回滚
 *   ④ **不物理删除旧事件**（用户裁定 Q4）：旧事件标 `archived` 而非删除
 *   ⑤ **原子写**：复用 event-store 的 writeStorePre（tmp → rename）
 *
 * 用户裁定 Q5：「提案 → 批准 → 落盘 + 快照 + 回滚」⇒ 四条全部实现。
 */

import { createHash, randomBytes } from 'node:crypto'
import { readFile, writeFile, mkdir, copyFile, readdir, unlink } from 'node:fs/promises'
import path from 'node:path'
import { readStorePre, writeStorePre, emptyEventPre } from './event-store.js'

// ★newEventIdPre 在 event-store.js 里是**私有函数**（未导出）。
//   本模块需要生成事件 id，故内联一份**同算法**实现（evt_ + 4 字节 hex + 碰撞重试）。
//   ⚠️ 成对资产：改 event-store 的 id 格式必须同步改这里（套件有格式一致性断言）。
function newEventIdPre(used) {
  for (let i = 0; i < 32; i++) {
    const id = 'evt_' + randomBytes(4).toString('hex')
    if (!used || !used.has(id)) return id
  }
  throw new Error('event id 生成失败（32 次全部碰撞）')
}

/** 快照目录名（与 handoff/ 同级，避免污染账本扫描）。 */
export const BACKUP_DIRNAME = '.event-store-backups'
/** 默认保留最近多少份快照（防无限增长）。 */
export const MAX_BACKUPS = 20

/**
 * 计算提案的**内容指纹**（令牌就是它）。
 *
 * ★为什么必须：用户批准的是「这份提案」，若中途提案被改（比如重新跑了一批），
 *   令牌必须失效。指纹覆盖所有会影响落盘结果的字段。
 *
 * @param {object} proposal
 * @returns {string} 16 位大写 hex
 */
export function proposalTokenPre(proposal) {
  const p = proposal && typeof proposal === 'object' ? proposal : {}
  const groups = Array.isArray(p.proposedGroups) ? p.proposedGroups : []
  const canon = JSON.stringify({
    schema: String(p.schema || ''),
    workspace: String(p.workspace || ''),
    groups: groups.map((g) => ({
      name: String((g && g.name) || ''),
      members: Array.isArray(g && g.members) ? g.members.map(String).sort() : [],
    })),
  })
  return createHash('sha256').update(canon).digest('hex').slice(0, 16).toUpperCase()
}

/** 列快照目录（不存在 ⇒ 空数组）。 */
async function listBackupsPre(backupDir) {
  try {
    const names = await readdir(backupDir)
    return names.filter((n) => /\.json$/i.test(n)).sort()
  } catch (e) {
    if (e && e.code === 'ENOENT') return []
    throw e
  }
}

/**
 * 写盘前快照 event-store.json。**先快照再写**（顺序不可颠倒）。
 *
 * @param {{storePath:string, backupDir:string, now?:number, maxBackups?:number}} p
 * @returns {Promise<{ok:boolean, file?:string, skipped?:string, pruned?:number}>}
 */
export async function snapshotStorePre(p = {}) {
  const storePath = String(p.storePath || '')
  const backupDir = String(p.backupDir || '')
  if (!storePath || !backupDir) throw new Error('snapshotStorePre: 缺 storePath 或 backupDir')
  let raw = null
  try { raw = await readFile(storePath, 'utf8') } catch (e) {
    if (e && e.code === 'ENOENT') return { ok: true, skipped: 'store-not-exist' }
    throw e
  }
  await mkdir(backupDir, { recursive: true })
  const ts = Number(p.now) > 0 ? Number(p.now) : Date.now()
  const file = path.join(backupDir, 'event-store.' + ts + '.' + proposalTokenPre({ schema: raw.slice(0, 100) }) + '.json')
  await writeFile(file, raw, 'utf8')

  // 裁剪旧快照
  const max = Number(p.maxBackups) > 0 ? Math.floor(Number(p.maxBackups)) : MAX_BACKUPS
  const all = await listBackupsPre(backupDir)
  let pruned = 0
  if (all.length > max) {
    for (const old of all.slice(0, all.length - max)) {
      try { await unlink(path.join(backupDir, old)); pruned++ } catch (_) {}
    }
  }
  return { ok: true, file, pruned }
}

/**
 * **dry-run 预览**：不写盘，返回「将会创建哪些事件 / 归档哪些旧事件」。
 *
 * @param {{proposal:object, store:object}} p
 * @returns {object}
 */
export function previewApplyPre(p = {}) {
  const proposal = p && p.proposal ? p.proposal : {}
  const store = (p && p.store && typeof p.store === 'object') ? p.store : { events: [] }
  const groups = Array.isArray(proposal.proposedGroups) ? proposal.proposedGroups : []
  const existing = Array.isArray(store.events) ? store.events : []
  const activeExisting = existing.filter((e) => String(e && e.status) === 'active')

  return {
    // 将新建的事件（AI 重整产出）
    toCreate: groups.map((g) => ({
      name: String((g && g.name) || ''),
      memberCount: Array.isArray(g && g.members) ? g.members.length : 0,
    })),
    // 将归档的旧事件（用户裁定 Q4：**不物理删除**，只标 archived）
    toArchive: activeExisting.map((e) => ({ id: String(e.id || ''), name: String(e.name || '') })),
    // 保持不动的（已归档的不重复处理）
    untouched: existing.length - activeExisting.length,
    stats: {
      createCount: groups.length,
      archiveCount: activeExisting.length,
      totalMembers: groups.reduce((a, g) => a + (Array.isArray(g && g.members) ? g.members.length : 0), 0),
    },
  }
}

/**
 * ★应用提案：**dry-run 默认** + 令牌校验 + 快照 + 落盘。
 *
 * @param {object} p
 * @param {object} p.proposal 提案（R3 产出）
 * @param {string} p.storePath event-store.json 路径
 * @param {string} p.backupDir 快照目录
 * @param {string} [p.token] 令牌（= proposalTokenPre(proposal)）；dry-run 时可不传
 * @param {boolean} [p.apply] **必须显式为 true 才写盘**
 * @param {boolean} [p.force] 跳过令牌校验（仅测试用，生产禁用）
 * @returns {Promise<object>}
 */
export async function applyRegroupPre(p = {}) {
  const o = p && typeof p === 'object' ? p : {}
  const proposal = o.proposal
  if (!proposal || typeof proposal !== 'object') return { ok: false, code: 'no-proposal', error: '缺少提案' }
  const storePath = String(o.storePath || '')
  const backupDir = String(o.backupDir || '')
  if (!storePath) return { ok: false, code: 'no-store-path', error: '缺少 storePath' }

  const expected = proposalTokenPre(proposal)
  const isApply = o.apply === true

  // ① 令牌校验（dry-run 也校验，便于提前发现令牌不对）
  if (o.force !== true) {
    const got = String(o.token || '')
    if (!got) return { ok: false, code: 'no-token', error: '缺少令牌（dry-run 也需传，用于确认提案未被篡改）', expectedToken: expected }
    if (got.toUpperCase() !== expected) {
      return { ok: false, code: 'token-mismatch', error: '令牌不匹配（提案已被修改）', expectedToken: expected }
    }
  }

  // ② 读现状
  let store
  try { store = await readStorePre(storePath) } catch (e) {
    return { ok: false, code: 'store-read-failed', error: String(e && e.message || e).slice(0, 200) }
  }

  const preview = previewApplyPre({ proposal, store })

  // ③ dry-run：到此为止
  if (!isApply) {
    return { ok: true, dryRun: true, token: expected, preview }
  }

  // ④ 快照（**必须在写盘之前**）
  let snap = null
  try {
    snap = await snapshotStorePre({ storePath, backupDir, now: o.now, maxBackups: o.maxBackups })
  } catch (e) {
    return { ok: false, code: 'snapshot-failed', error: '快照失败，已中止写盘（不留半成品）：' + String(e && e.message || e).slice(0, 160) }
  }

  // ⑤ 构造新 store（旧 active ⇒ archived；新增 AI 重整事件）
  const next = {
    ...store,
    events: Array.isArray(store.events) ? store.events.slice() : [],
  }
  const archivedIds = []
  for (const ev of next.events) {
    if (ev && String(ev.status) === 'active') {
      ev.status = 'archived'
      ev.archivedAt = Number(o.now) || Date.now()
      ev.archivedBy = 'regroup'
      archivedIds.push(String(ev.id || ''))
    }
  }
  const used = new Set(next.events.map((e) => String((e && e.id) || '')))
  const created = []
  const groups = Array.isArray(proposal.proposedGroups) ? proposal.proposedGroups : []
  for (const g of groups) {
    const ev = emptyEventPre(String(g.name || ''), { id: newEventIdPre(used), summary: String(g.summary || '') })
    used.add(ev.id)
    const sec = (g.sections && typeof g.sections === 'object') ? g.sections : {}
    for (const k of ['goal', 'doing', 'deadend', 'next']) {
      if (typeof sec[k] === 'string') ev.sections[k] = sec[k]
    }
    // ★把成员账本记进事件（sourceRef 列表），供回溯
    ev.memberLedgers = Array.isArray(g.members) ? g.members.map(String) : []
    ev.origin = 'regroup-ai'
    ev.createdBy = 'regroup'
    next.events.push(ev)
    created.push({ id: ev.id, name: ev.name })
  }

  // ⑥ 落盘（原子写）
  try {
    await writeStorePre(storePath, next)
  } catch (e) {
    return { ok: false, code: 'write-failed', error: String(e && e.message || e).slice(0, 200), snapshot: snap }
  }

  return {
    ok: true,
    dryRun: false,
    token: expected,
    created,
    archivedIds,
    snapshot: snap,
    preview,
  }
}

/**
 * 从快照**回滚**（用户裁定 Q5 的「回滚」）：把快照文件复制回 storePath。
 *
 * @param {{storePath:string, backupFile:string}} p
 * @returns {Promise<object>}
 */
export async function rollbackFromSnapshotPre(p = {}) {
  const storePath = String(p.storePath || '')
  const backupFile = String(p.backupFile || '')
  if (!storePath || !backupFile) return { ok: false, error: '缺 storePath 或 backupFile' }
  try {
    await copyFile(backupFile, storePath)
    return { ok: true, restored: storePath, from: backupFile }
  } catch (e) {
    return { ok: false, error: String(e && e.message || e).slice(0, 200) }
  }
}

export default {
  BACKUP_DIRNAME,
  MAX_BACKUPS,
  proposalTokenPre,
  snapshotStorePre,
  previewApplyPre,
  applyRegroupPre,
  rollbackFromSnapshotPre,
}
/**
 * session-archive.js — 会话归档与删除的**自持**实现（F 线）。
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 来源与许可声明（Apache-2.0 §4(a)(b) 要求的版权与许可保留 + §4(b)「已修改」标注）
 *
 *   Portions of this file are derived from @linxin666/dsh-session-archive v0.4.1
 *   (licensed under the Apache License, Version 2.0); modified by dsh-auto-memory.
 *
 *   原包 license 实测为 Apache-2.0（package.json.license 与 LICENSE 首两行双证据），
 *   而非 MIT。原包无 NOTICE 文件，故无额外 NOTICE 传递义务；原包
 *   author/repository/homepage 三字段皆空，故署名只能引用包名与版本。
 *   本文件为**修改版**：函数改为本插件的导出形态、去掉 cosmokit 依赖、
 *   保护判据改由调用方注入（见下），逻辑等价的迁移函数逐条标注来源行号。
 * ─────────────────────────────────────────────────────────────────────────
 *
 * 设计约束（与 lib/subagent-gc.js 同风格）：
 *   - **零第三方依赖**，只用 node 内置模块；
 *   - **不 import lib/index.js**（避免循环依赖）：`dshHome` 一律由调用方作为参数传入；
 *   - **保护判据不外置**：本模块不读 workbench.json、不认识"工作台会话"。
 *     调用方必须把受保护 id 集合算好后经 `options.protectedIds` 传入 —— 这样
 *     守卫 ⑰ 的"不得删除工作台会话"能落在一个可单测的纯函数边界上。
 */

import { existsSync, readFileSync, readdirSync, realpathSync, rmSync, statSync } from 'node:fs'
import { join, resolve, sep } from 'node:path'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'

/** 一天的毫秒数。来源：@linxin666/dsh-session-archive L936。 */
export const DAY_MS = 864e5

/** 归档天数上限。来源：L1101–L1103。 */
export const AUTO_ARCHIVE_DAYS_MAX = 3650
export const AUTO_DELETE_DAYS_MAX = 3650
/** 巡检间隔（分钟）上限；下限为 15。来源：L1103 + L1127 的 validateDays(…,15,…)。 */
export const CHECK_INTERVAL_MIN_MAX = 1440
export const CHECK_INTERVAL_MIN_MIN = 15

/**
 * 默认值。来源 L1104–L1111（原包默认 7/7 且两条 auto*Enabled 皆关）。
 * ★本插件口径经用户拍板改为：归档 2 天、删除 7 天、两条都开（见规格 §10.3）。
 */
export const DEFAULT_AUTO_CONFIG = {
  enabled: true,
  autoArchiveEnabled: true,
  autoArchiveDays: 2,
  autoDeleteEnabled: true,
  autoDeleteDays: 7,
  checkIntervalMin: 60
}

/**
 * 校验一个"天数/分钟"字段；非法或越界返回 undefined。
 * 来源：L1113–L1118（契约逐字一致：非有限数即 undefined，四舍五入后越界即 undefined）。
 */
export function validateDays(value, min, max) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined
  const rounded = Math.round(value)
  if (rounded < min || rounded > max) return undefined
  return rounded
}

/**
 * 把原始配置收敛为可用值，非法项回落默认。来源：L1124–L1136。
 * 差异：默认值改用本插件的 DEFAULT_AUTO_CONFIG（2/7 且默认开）。
 */
export function resolveAutoConfig(config) {
  const days = validateDays(config?.autoArchiveDays, 1, AUTO_ARCHIVE_DAYS_MAX)
  const retain = validateDays(config?.autoDeleteDays, 1, AUTO_DELETE_DAYS_MAX)
  const interval = validateDays(config?.checkIntervalMin, CHECK_INTERVAL_MIN_MIN, CHECK_INTERVAL_MIN_MAX)
  return {
    enabled: config?.enabled ?? DEFAULT_AUTO_CONFIG.enabled,
    autoArchiveEnabled: config?.autoArchiveEnabled ?? DEFAULT_AUTO_CONFIG.autoArchiveEnabled,
    autoArchiveDays: days ?? DEFAULT_AUTO_CONFIG.autoArchiveDays,
    autoDeleteEnabled: config?.autoDeleteEnabled ?? DEFAULT_AUTO_CONFIG.autoDeleteEnabled,
    autoDeleteDays: retain ?? DEFAULT_AUTO_CONFIG.autoDeleteDays,
    checkIntervalMin: interval ?? DEFAULT_AUTO_CONFIG.checkIntervalMin
  }
}

/**
 * 挑出「该归档」的会话。来源：L943–L958（迁移，逻辑等价）。
 *
 * 判据（逐条对应原实现）：
 *   - 已归档的跳过；
 *   - **最后活动时间不可靠或缺失即跳过**（关键：不猜时间，宁可不归档）；
 *   - 在受保护集合里即跳过；
 *   - 距今未超过阈值即跳过；
 *   - 结果按最后活动时间**升序**（最老的先归档）。
 *
 * 只归档、不删除，故「归档一个空会话」是安全操作。
 *
 * @param {Array<{id:string, archived?:boolean, lastActivityReliable?:boolean, lastActivityAt?:number}>} rows
 * @param {{days:number, now:number, protectedIds:Set<string>}} options
 */
export function autoArchiveCandidates(rows, options) {
  const threshold = options.days * DAY_MS
  const candidates = []
  for (const row of rows) {
    if (row.archived) continue
    if (!row.lastActivityReliable || row.lastActivityAt === undefined) continue
    if (options.protectedIds.has(row.id)) continue
    if (options.now - row.lastActivityAt <= threshold) continue
    candidates.push({ id: row.id, lastActivityAt: row.lastActivityAt })
  }
  candidates.sort((a, b) => a.lastActivityAt - b.lastActivityAt)
  return candidates
}

/**
 * 挑出「该删」的种子（族级联之前）。来源：L966–L982（迁移，逻辑等价）。
 *
 * 判据（逐条对应原实现，注意与"归档候选"的三处差异）：
 *   - **必须是已归档的**，且**归档时间已知**（archivedAt 缺失即跳过）；
 *   - 在受保护集合里即跳过；
 *   - **本轮开始后归档的不删**（`archivedAt >= runStartedAt` 跳过）—— 防止同一 tick
 *     刚归档就被删；
 *   - 至今未超过保留阈值即跳过；
 *   - 结果按归档时间**升序**。
 *
 * ★「归档时间未知一律排除」是有意为之：本插件启用之前的历史归档没有可靠归档时间，
 *   它们**永远不会被自动删除**（只能手动删）。这是安全默认值，不得放宽。
 */
export function autoDeleteSeedCandidates(rows, options) {
  const threshold = options.retainDays * DAY_MS
  const candidates = []
  for (const row of rows) {
    if (!row.archived || row.archivedAt === undefined) continue
    if (options.protectedIds.has(row.id)) continue
    if (row.archivedAt >= options.runStartedAt) continue
    if (options.now - row.archivedAt <= threshold) continue
    candidates.push({
      id: row.id,
      archivedAt: row.archivedAt,
      ...(row.sizeBytes !== undefined ? { sizeBytes: row.sizeBytes } : {})
    })
  }
  candidates.sort((a, b) => a.archivedAt - b.archivedAt)
  return candidates
}

/**
 * 沿 `childIds` 边取一个 id 的**全部后代**（不含自身）。来源：L986–L998（迁移，逐字等价）。
 */
export function descendantsOf(rows, id) {
  const childIds = new Map()
  for (const row of rows) childIds.set(row.id, row.childIds)
  const seen = new Set()
  const queue = [...(childIds.get(id) ?? [])]
  while (queue.length > 0) {
    const current = queue.pop()
    if (seen.has(current)) continue
    seen.add(current)
    for (const child of childIds.get(current) ?? []) if (!seen.has(child)) queue.push(child)
  }
  return [...seen]
}

/**
 * 权威删除计划。来源：L1010–L1072（迁移，逐字等价）。
 *
 * 规则（原实现注释逐条保留）：
 *   - 直接选中但**不在名册里**的 ⇒ 跳过，reason `not-found`；
 *   - 直接选中且**自身受保护**的 ⇒ 以自身理由跳过，**其家族完全不碰**；
 *   - 一个家族（直接 id + 全部后代）里**只要有任一受保护成员** ⇒ 整族以
 *     `family-protected` 跳过 —— **绝不半删一个家族**；
 *   - 每个 id 在 `skipped` 里**至多出现一次**；直接选中的受保护 id 保留自己的理由，
 *     即使某个亲属的家族也覆盖了它；
 *   - 其余（安全家族的并集）才进入删除目标。
 *
 * ★这是守卫 ⑰ 要钉的那个函数：「受保护集合」由调用方注入，故
 *   「删除入口对工作台会话必须拒绝」可以被单测直接断言。
 *
 * @param {Array<{id:string, childIds?:string[], sizeBytes?:number}>} rows
 * @param {string[]} directIds
 * @param {Map<string,string>} protectedReason id → 保护理由
 * @returns {{direct:string[], descendants:string[], skipped:Array, targets:string[], totalBytes:number}}
 */
export function planDelete(rows, directIds, protectedReason) {
  const byId = new Map(rows.map((row) => [row.id, row]))
  const targets = new Set()
  const skipped = []
  const skippedIds = new Set()
  const directSet = new Set(directIds)
  const seenDirect = new Set()
  /** 记录一次跳过：经由多个家族可达的 id 只记一次。 */
  const pushSkipped = (entry) => {
    if (skippedIds.has(entry.id)) return
    skippedIds.add(entry.id)
    skipped.push(entry)
  }
  for (const id of directIds) {
    if (seenDirect.has(id)) continue
    seenDirect.add(id)
    if (byId.get(id) === undefined) {
      pushSkipped({ id, status: 'skipped', reason: 'not-found' })
      continue
    }
    const ownReason = protectedReason.get(id)
    if (ownReason !== undefined) {
      pushSkipped({ id, status: 'skipped', reason: ownReason })
      continue
    }
    const family = [id, ...descendantsOf(rows, id)]
    const blocker = family.find((member) => protectedReason.has(member))
    if (blocker !== undefined) {
      for (const member of family) {
        if (targets.has(member) || skippedIds.has(member)) continue
        if (directSet.has(member) && protectedReason.has(member)) continue
        pushSkipped({
          id: member,
          status: 'skipped',
          reason: 'family-protected',
          detail: `${blocker}:${protectedReason.get(blocker)}`
        })
      }
      continue
    }
    for (const member of family) targets.add(member)
  }
  let totalBytes = 0
  for (const id of targets) {
    const size = byId.get(id)?.sizeBytes
    if (typeof size === 'number') totalBytes += size
  }
  return {
    direct: [...seenDirect],
    descendants: [...targets].filter((id) => !seenDirect.has(id)),
    skipped,
    targets: [...targets],
    totalBytes
  }
}

/* ───────────────── 会话存储文件层（路径安全是硬边界） ───────────────── */

/**
 * 一个目录段名 → 规范会话 id。来源：L1153–L1155（逐字等价）。
 *
 * DSH 持久化按会话 id 派生目录段：`session-<uuid>` 落地为 `<uuid>`（也有布局保留前缀）。
 * 一个目录只映射到一个规范 id（带 `session-` 前缀的那种），故名册不会产生重复行。
 */
export function canonicalSessionId(segment) {
  return segment.startsWith('session-') ? segment : `session-${segment}`
}

/**
 * 递归求目录体积。来源：L1156–L1170（逐字等价）。
 * 读不动的一律算 0（不抛），用于「释放空间预览」。
 */
export function dirSize(path) {
  let total = 0
  let entries
  try {
    entries = readdirSync(path)
  } catch {
    return 0
  }
  for (const entry of entries) {
    try {
      const stat = statSync(join(path, entry))
      if (stat.isDirectory()) total += dirSize(join(path, entry))
      else total += stat.size
    } catch {}
  }
  return total
}

/** `child` 是 `root` 本身或在其下时返回 true（lexical）。来源：L1172–L1174。 */
export function isInside(root, child) {
  return relativeWithin(root, child) !== undefined
}

/** `child` 相对 `root` 的 lexical 相对路径；在外部时返回 undefined。来源：L1176–L1182。 */
export function relativeWithin(root, child) {
  const rootAbs = resolve(root)
  const childAbs = resolve(child)
  if (childAbs === rootAbs) return ''
  if (!childAbs.startsWith(rootAbs + sep)) return undefined
  return childAbs.slice(rootAbs.length + 1)
}

/**
 * 扫一次 sessions 根，索引每个会话目录。来源：L1189–L1243（迁移，逻辑等价）。
 *
 * 目录布局：`<sessionsRoot>/<projectKey>/<segment>/`。
 * **软链一律不跟进索引**：指向根外的链接记为 `unreadable`，不进 `byId`
 * （这是物理删除前唯一的一道"哪些目录是我们管的"的收口）。
 *
 * @returns {{byId: Map<string,string>, sizes: Map<string,number>, unreadable: string[]}}
 */
export function indexSessionDirs(sessionsRoot) {
  const index = { byId: new Map(), sizes: new Map(), unreadable: [] }
  if (!existsSync(sessionsRoot)) return index
  let rootReal
  try {
    rootReal = realpathSync(sessionsRoot)
  } catch {
    return index
  }
  let projectDirs
  try {
    projectDirs = readdirSync(sessionsRoot)
  } catch {
    return index
  }
  for (const project of projectDirs) {
    const projectPath = join(sessionsRoot, project)
    let entries
    try {
      entries = readdirSync(projectPath)
    } catch {
      continue
    }
    for (const segment of entries) {
      const dirPath = join(projectPath, segment)
      let stat
      try {
        stat = statSync(dirPath)
      } catch {
        continue
      }
      if (!stat.isDirectory()) continue
      let real
      try {
        real = realpathSync(dirPath)
      } catch {
        index.unreadable.push(dirPath)
        continue
      }
      if (!isInside(rootReal, real)) {
        index.unreadable.push(dirPath)
        continue
      }
      for (const candidate of [canonicalSessionId(segment)]) {
        if (!index.byId.has(candidate)) {
          index.byId.set(candidate, dirPath)
          index.sizes.set(candidate, dirSize(dirPath))
        }
      }
    }
  }
  return index
}

/**
 * 物理删除一个会话目录。来源：L1294–L1302（**逐字等价，含拒绝语义**）。
 *
 * ★安全边界（不得放宽）：目录必须已由索引解析出来（索引从不跟进逃逸软链）；
 * 本函数**再次**用 realpath 对 sessions 根复验，通过才递归删除。
 * ⇒ 任何调用方传来的路径都无法删掉会话存储之外的任何东西。
 *
 * @throws {Error} 当 realpath 落在 sessions 根之外时
 */
export function removeSessionDir(dirPath, sessionsRoot) {
  const rootReal = realpathSync(sessionsRoot)
  const real = realpathSync(dirPath)
  if (!isInside(rootReal, real)) {
    throw new Error(`refusing to remove '${dirPath}': outside the sessions root`)
  }
  rmSync(real, { recursive: true, force: false })
}

/** session-rdb sqlite 的可能位置（最可能在前）。来源：L1245–L1247（逐字等价）。 */
export function rdbDbPaths(dshHome) {
  return [join(dshHome, 'sessions', 'sessions.sqlite'), join(dshHome, 'sessions.sqlite')]
}

/** session-rdb 指纹：application_id + user_version（dsh-perf 契约）。来源：L1249–L1263。 */
export function isSessionRdb(dbPath) {
  if (!existsSync(dbPath)) return false
  let DatabaseSync
  try {
    // 延迟取 node:sqlite：本机实测可用（node v24.18.0），但若被裁剪过也不该让模块加载失败。
    ;({ DatabaseSync } = require$sqlite())
  } catch {
    return false
  }
  if (typeof DatabaseSync !== 'function') return false
  try {
    const db = new DatabaseSync(dbPath, { readOnly: true })
    try {
      const appId = db.prepare('pragma application_id').get()
      const userVersion = db.prepare('pragma user_version').get()
      return appId?.application_id === 1146308688 && userVersion?.user_version === 1
    } finally {
      db.close()
    }
  } catch {
    return false
  }
}

/**
 * 删除某会话在 session-rdb 里的行。来源：L1269–L1287（迁移，逻辑等价）。
 * FK 级联会带走事件表；删到行返回 true，会话本就不在返回 false；存储错误向上抛。
 */
export function deleteRdbSession(dbPath, id) {
  let DatabaseSync
  try {
    ;({ DatabaseSync } = require$sqlite())
  } catch {
    return false
  }
  if (typeof DatabaseSync !== 'function') return false
  const db = new DatabaseSync(dbPath)
  try {
    db.exec('begin')
    try {
      const result = db.prepare('delete from t_sessions where f_session_id = ?').run(id)
      const removed = Number(result.changes) > 0
      db.exec('commit')
      return removed
    } catch (error) {
      try {
        db.exec('rollback')
      } catch {}
      throw error
    }
  } finally {
    db.close()
  }
}

/**
 * 同步取 `node:sqlite`。用 createRequire 而非顶层 import：
 * 顶层 `import { DatabaseSync } from 'node:sqlite'` 在本机（v24.18.0）可用，
 * 但一旦宿主 node 被裁剪掉该内置模块，**静态 import 会让整个插件起不来**；
 * 改为延迟 require 后，缺失只是"rdb 清理跳过"，其余功能照常。
 */
function require$sqlite() {
  return createRequire(import.meta.url)('node:sqlite')
}

/* ───────────────── 投影缓存（标题与体积预览，全部只读） ───────────────── */

/**
 * 读聚合投影缓存索引。来源：L1316–L1324（逐字等价）。
 * 形状容错：任何解析失败都返回 `{sessions:{}}`，绝不抛。
 */
export function readProjcacheIndex(dshHome) {
  const path = join(dshHome, 'storages', 'session_projcache.json')
  if (!existsSync(path)) return { sessions: {} }
  try {
    return { sessions: JSON.parse(readFileSync(path, 'utf8')).tables?.sessions ?? {} }
  } catch {
    return { sessions: {} }
  }
}

/** 从聚合索引条目取标题。来源：L1325–L1328（逐字等价）。 */
export function titleFromProjcache(entry) {
  const val = entry.rows?.title?.val
  return typeof val === 'string' && val !== '' ? val : undefined
}

/**
 * 从单会话投影缓存文件兜底取 title/createdAt/cwd。来源：L1336–（迁移，逻辑等价）。
 *
 * 为什么需要兜底：聚合索引只覆盖**近期**会话，较早/已归档的行取不到标题，
 * 只能落到 `storages/session_projcache/sessions/<id>.json` 这些单文件。
 * 对版本与形状漂移一律容忍；缺失或读不动即返回 undefined。
 *
 * @param {string} dshHome
 * @param {string} id
 * @param {Map<string, object|undefined>} [cache] 可选：本轮的 memo（避免重复读盘）
 */
export async function readProjcacheFile(dshHome, id, cache) {
  if (cache !== undefined && cache.has(id)) return cache.get(id) ?? undefined
  const path = join(dshHome, 'storages', 'session_projcache', 'sessions', `${id}.json`)
  let entry
  try {
    const parsed = JSON.parse(await readFile(path, 'utf8'))
    const record = parsed.record ?? parsed
    const title =
      typeof record.rows?.title?.val === 'string' && record.rows.title.val !== ''
        ? record.rows.title.val
        : undefined
    const createdAt = typeof record.identity?.createdAt === 'number' ? record.identity.createdAt : undefined
    const cwd = typeof record.identity?.cwd === 'string' && record.identity.cwd !== '' ? record.identity.cwd : undefined
    if (title !== undefined || createdAt !== undefined || cwd !== undefined) {
      entry = {
        ...(title !== undefined ? { title } : {}),
        ...(createdAt !== undefined ? { createdAt } : {}),
        ...(cwd !== undefined ? { cwd } : {})
      }
    }
  } catch {
    entry = undefined
  }
  if (cache !== undefined) cache.set(id, entry)
  return entry
}

/**
 * Tier-0 用量台账（tier0_usage_v1）—— 曝光 / 召回计数。
 *
 * 目的：常驻目录原先只按「层优先级 + 日期」选条目，少数条目长期霸占位置、
 * 其余永不露面。本模块记录每条被曝光（seen）与被召回（used）的次数，
 * 供轮换位挑「最久未曝光」的长尾条目，保证有限轮内每条都能被看见一次。
 *
 * 存储：单个 JSON（默认 `~/.dsh/memory/tier0-usage.json`），键为
 *   · `id:mem_xxx`  —— 条目带记忆锚点时（可与 memory_recall(expand) 精确对齐）
 *   · `layer|标题`  —— 无锚点的条目（如日志）退化为标题键
 * 值：`{ seen, used, last }`。
 *
 * 纯旁路统计：任何 IO 失败都静默忽略，不影响注入。
 */
import { homedir } from 'node:os'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

const MAX_ENTRIES = 4000
const USAGE_PATH = () => join(homedir(), '.dsh', 'memory', 'tier0-usage.json')

function normTitle(s) {
  return String(s || '').replace(/\s+/g, ' ').trim().toLowerCase().slice(0, 80)
}

/** 条目键：优先锚点 id，其次 `layer|标题`。 */
export function tier0KeyPre(item) {
  const it = item && typeof item === 'object' ? item : {}
  const id = String(it.id || '')
  if (/^mem_[0-9a-f]{32}$/.test(id)) return 'id:' + id
  const layer = String(it.layer || 'log')
  const t = normTitle(it.title) || normTitle(it.oneLine) || 'untitled'
  return layer + '|' + t
}

function load() {
  try {
    const p = USAGE_PATH()
    if (!existsSync(p)) return {}
    const raw = JSON.parse(readFileSync(p, 'utf8'))
    return raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {}
  } catch (_) { return {} }
}

function save(db) {
  try {
    const p = USAGE_PATH()
    mkdirSync(dirname(p), { recursive: true })
    const keys = Object.keys(db)
    if (keys.length > MAX_ENTRIES) {
      keys.sort((a, b) => Number(db[b] && db[b].last || 0) - Number(db[a] && db[a].last || 0))
      for (const k of keys.slice(MAX_ENTRIES)) delete db[k]
    }
    writeFileSync(p, JSON.stringify(db), 'utf8')
  } catch (_) { /* 旁路统计，失败不影响注入 */ }
}

/** 本轮被目录选中的条目 ⇒ seen+1。 */
export function tier0MarkSeenPre(items) {
  try {
    const list = Array.isArray(items) ? items : []
    if (!list.length) return
    const db = load()
    const now = Date.now()
    for (const it of list) {
      const k = tier0KeyPre(it)
      const e = db[k] || (db[k] = { seen: 0, used: 0, last: 0 })
      e.seen = Number(e.seen || 0) + 1
      e.last = now
    }
    save(db)
  } catch (_) {}
}

/**
 * 召回计数：memory_recall / memory_read / memory_search 的入参命中某条目即 +1。
 *   ① expand="mem_xxx" —— 精确通道，点名单条；
 *   ② 其余 —— 标题 4-gram ≥3 命中才算（口径保守，避免随口提到一个词就虚增；
 *      id 键跳过文本通道，防止标题撞名）。
 */
export function tier0MarkUsedPre(args) {
  try {
    const expand = String((args && args.expand) || '')
    if (/^mem_[0-9a-f]{32}$/.test(expand)) {
      const db0 = load()
      const k0 = 'id:' + expand
      const e0 = db0[k0] || (db0[k0] = { seen: 0, used: 0, last: 0 })
      e0.used = Number(e0.used || 0) + 1
      e0.last = Date.now()
      save(db0)
    }
    const text = normTitle([args && args.query, args && args.name, args && args.kind, args && args.date]
      .filter(Boolean).join(' '))
    if (text.length < 4) return
    const db = load()
    const seed = new Set()
    for (let i = 0; i + 4 <= text.length; i++) seed.add(text.slice(i, i + 4))
    let dirty = false
    for (const k of Object.keys(db)) {
      if (k.startsWith('id:')) continue
      const title = k.split('|')[1] || ''
      if (title.length < 6) continue
      let hit = 0
      for (let i = 0; i + 4 <= title.length; i++) if (seed.has(title.slice(i, i + 4))) hit++
      if (hit >= 3) { db[k].used = Number(db[k].used || 0) + 1; db[k].last = Date.now(); dirty = true }
    }
    if (dirty) save(db)
  } catch (_) {}
}

/**
 * 轮换位：从「本轮没上桌」的候选里取 seen 最少（并列看 last 最旧）的 n 条并渲染。
 * 注意：被轮换选中的条目同样计入曝光，否则它们 seen 恒为 0，永远霸占轮换位。
 * @returns {string[]} 已渲染的目录行
 */
export function tier0RotationLinesPre(catalog, n = 2) {
  try {
    const picked = new Set(((catalog && catalog.items) || []).map(tier0KeyPre))
    const all = Array.isArray(catalog && catalog.candidatesAll) ? catalog.candidatesAll : []
    const db = load()
    const pool = all
      .filter((it) => it && !picked.has(tier0KeyPre(it)))
      .map((it) => {
        const k = tier0KeyPre(it)
        const e = db[k] || {}
        return { it, k, seen: Number(e.seen || 0), last: Number(e.last || 0) }
      })
      .sort((a, b) => (a.seen - b.seen) || (a.last - b.last) || String(a.k).localeCompare(String(b.k)))
    const chosen = pool.slice(0, Math.max(0, n))
    const now = Date.now()
    for (const x of chosen) {
      const e = db[x.k] || (db[x.k] = { seen: 0, used: 0, last: 0 })
      e.seen = Number(e.seen || 0) + 1
      e.last = now
    }
    if (chosen.length) save(db)
    return chosen.map((x) => {
      const e = db[x.k] || {}
      const t = String(x.it.title || x.it.oneLine || '').slice(0, 40)
      const used = Number(e.used || 0)
      return t + '（' + (x.it.layer || 'log') + '·曝光' + Number(e.seen || 0) + (used ? '·已用' + used : '') + '）'
    })
  } catch (_) { return [] }
}

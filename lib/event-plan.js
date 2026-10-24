/**
 * event-plan.js —— v4 未归档账本扫描 + 分页 + 事件归属判定（批次 A 数据层）
 *
 * 设计依据：MASTER-PLAN §5.3 / D9（未归档口径 A：**只算四段账本**）/ D10（审理批 40）
 *
 * 为什么需要它：`handoff/` 下有 577 篇 .md（实测），其中只有 **517** 篇是四段式账本；
 * 其余 60 篇是 PLAN 快照 / 会话转写 / 一次性报告。把机械副产物塞进审理队列 = 白烧 token。
 * 此外 archive/ 下 261 篇全不是四段式 ⇒ 机械副产物共 **321** 篇（577-517+261 的另一个口径见报告）。
 *
 * 纪律：纯读、纯函数为主；fs 只在 scan 里用；绝不写盘、绝不删文件。
 */

import { readdir, readFile, stat } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import path from 'node:path'

/** 四段标题（与 handoff-anchor.js 的权重表同源；这里只做**识别**，不做加权） */
export const LEDGER_SECTIONS = Object.freeze(['任务状态', '目标', '已试方案与失败原因', '进度与下一步'])
/** 审理批默认大小（D10 拍板 40） */
export const DEFAULT_CURATE_BATCH = 40
/** 未归档列表默认每页（与契约「默认 50/页」一致） */
export const DEFAULT_PAGE = 50

/** 判一篇文章是不是四段式账本：四个标题行都在即为真（顺序不强制，容忍尾随 \r） */
export function isFourSectionLedgerPre(text) {
  const src = String(text == null ? '' : text)
  if (!src.trim()) return false
  const heads = new Set()
  for (const line of src.split('\n')) {
    const t = line.replace(/\r$/, '').trim()
    const m = /^##\s+(.+)$/.exec(t)
    if (m) heads.add(m[1].trim())
  }
  return LEDGER_SECTIONS.every((s) => heads.has(s))
}

/** 从账本文本里抽四段内容（用于事件归属判定与草案生成） */
export function splitLedgerSectionsPre(text) {
  const out = { '任务状态': '', '目标': '', '已试方案与失败原因': '', '进度与下一步': '' }
  const src = String(text == null ? '' : text)
  let cur = null
  const bufs = Object.create(null)
  for (const line of src.split('\n')) {
    const t = line.replace(/\r$/, '')
    const m = /^##\s+(.+)$/.exec(t.trim())
    if (m) { cur = m[1].trim(); bufs[cur] = bufs[cur] || []; continue }
    if (cur && bufs[cur]) bufs[cur].push(t)
  }
  for (const k of Object.keys(out)) out[k] = (bufs[k] || []).join('\n').trim()
  return out
}

/** 去掉 front-matter / 锚点行后的正文（归属判定用，避免把 <!-- memory:mem_x --> 当成内容） */
function contentOfPre(text) {
  return String(text == null ? '' : text)
    .split('\n')
    .filter((l) => !/^\s*<!--\s*memory:mem_[0-9a-f]{32}\s*-->\s*$/.test(l))
    .join('\n')
}

/**
 * 扫 handoff/ 顶层（**不进 archives 子目录**）：返回四段账本清单，按 mtime 新→旧。
 * opts: { dir, maxFiles=2000, withText=false }
 */
export async function scanUnarchivedLedgersPre(opts = {}) {
  const dir = String(opts.dir || '')
  if (!dir) throw new Error('scanUnarchivedLedgers: 缺 dir')
  const maxFiles = Number.isFinite(opts.maxFiles) ? Math.max(1, Math.floor(opts.maxFiles)) : 2000
  let names = []
  try { names = await readdir(dir) } catch (e) {
    if (e && e.code === 'ENOENT') return { dir, total: 0, ledgers: [], skippedNonLedger: 0, skippedDirs: 0 }
    throw e
  }
  const md = names.filter((n) => /\.md$/i.test(n) && !/^PLAN\.md$/i.test(n) && !/^README/i.test(n)).sort()
  const ledgers = []
  let skippedNonLedger = 0, skippedDirs = 0, examined = 0
  for (const n of md) {
    if (examined >= maxFiles) break
    const full = path.join(dir, n)
    let st
    try { st = await stat(full) } catch (_) { continue }
    if (!st.isFile()) { skippedDirs++; continue }
    examined++
    let text
    try { text = await readFile(full, 'utf8') } catch (_) { continue }
    const body = contentOfPre(text)
    if (!isFourSectionLedgerPre(body)) { skippedNonLedger++; continue }
    const rec = { name: n, mtime: st.mtimeMs, bytes: Buffer.byteLength(text, 'utf8') }
    if (opts.withText) rec.sections = splitLedgerSectionsPre(body)
    ledgers.push(rec)
  }
  ledgers.sort((a, b) => b.mtime - a.mtime)
  return { dir, total: ledgers.length, examined, skippedNonLedger, skippedDirs, ledgers }
}

/** 分页（纯函数）：默认 50/页；cursor 是**偏移量**（与 event-list 同口径） */
export function pageItemsPre(items, { cursor = 0, limit = DEFAULT_PAGE } = {}) {
  const list = Array.isArray(items) ? items : []
  const cap = Math.max(1, Math.min(200, Number(limit) || DEFAULT_PAGE))
  const from = Math.max(0, Number(cursor) || 0)
  const page = list.slice(from, from + cap)
  const next = from + page.length < list.length ? from + page.length : null
  const total = list.length
  return { total, items: page, nextCursor: next, pageSize: cap, clipped: list.length > cap }
}

/**
 * 归属判定：把一批账本按「四段内容指纹」聚成候选事件组（供审理草案用）。
 * 判据刻意保守：① 目标段首行归一化后相同；② 或 mtime 落在同一 6 小时窗口且目标段有 ≥2 个共同 2-gram。
 * 不做语义 embedding（那是 D 批/后续模型的事），这里只做**确定性**聚类，保证同输入同输出。
 */
export function groupIntoCandidateEventsPre(ledgers) {
  const list = Array.isArray(ledgers) ? ledgers.filter((x) => x && x.sections) : []
  const norm = (s) => String(s || '').toLowerCase().replace(/\s+/g, '').replace(/[，。；：、,.;:]/g, '')
  const bigrams = (s) => { const out = new Set(); for (let i = 0; i + 1 < s.length; i++) out.add(s.slice(i, i + 2)); return out }
  const groups = []
  for (const L of list) {
    const goal = norm(L.sections['目标']).split('\n')[0] || ''
    const bm = bigrams(goal)
    let hit = null
    for (const g of groups) {
      if (goal && g.goalKey && goal === g.goalKey) { hit = g; break }
      if (Math.abs((L.mtime || 0) - g.anchorMtime) <= 6 * 3600 * 1000) {
        let common = 0
        for (const b of bm) if (g.bigrams.has(b)) { common++; if (common >= 2) break }
        if (common >= 2) { hit = g; break }
      }
    }
    if (!hit) { groups.push({ goalKey: goal, anchorMtime: L.mtime || 0, bigrams: bm, members: [L] }); continue }
    hit.members.push(L)
  }
  return groups.map((g, i) => ({
    candidateId: 'cand_' + String(i + 1).padStart(3, '0'),
    goalKey: g.goalKey,
    memberCount: g.members.length,
    members: g.members.map((m) => ({ name: m.name, mtime: m.mtime, bytes: m.bytes })),
  }))
}

/** 估算审理成本（D10 用：批 40 ≈ 2.7 万输入 token） */
export function estimateCurationCostPre(ledgers) {
  const list = Array.isArray(ledgers) ? ledgers : []
  const avgChars = list.length ? Math.round(list.reduce((a, b) => a + (Number(b.bytes) || 0), 0) / list.length) : 0
  // 实测口径（MASTER-PLAN §5.8）：账本均 1,153 字符；输入 token ≈ chars / 1.7；输出 ≈ 75/篇
  const inTokens = Math.round(avgChars / 1.7) * list.length
  const outTokens = 75 * list.length
  return { count: list.length, avgChars, estimatedInputTokens: inTokens, estimatedOutputTokens: outTokens }
}

export default { LEDGER_SECTIONS, DEFAULT_CURATE_BATCH, DEFAULT_PAGE, isFourSectionLedgerPre, splitLedgerSectionsPre, scanUnarchivedLedgersPre, pageItemsPre, groupIntoCandidateEventsPre, estimateCurationCostPre }
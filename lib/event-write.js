/**
 * event-write.js —— v4 写入层统一（批次 H1）
 *
 * 设计依据：
 *   · artifacts/V4-CODE-LEVEL-SPEC-2026-10-24.md §3（H1 写入层统一）
 *   · artifacts/V4-MASTER-PLAN-2026-10-24.md §1.4.2（蒸馏链：事件是源，日 .md 是投影）
 *   · 用户 2026-10-24 裁定 Q1(c)：事件为主 + 日 md 派生；Q2：日 .md 继续生成（供反思/consolidate）
 *
 * ★三条不可违反的红线（Lead 2026-10-24 裁决）：
 *   ① **事件写入必须先于日视图派生** —— 顺序反了会产生「视图有、事件无」的孤儿；
 *   ② **事件写失败必须向上抛** —— 禁止 fallback 到只写 .md（那是假成功）；
 *   ③ **日视图派生不得破坏既有锚点** —— 记忆 .md 由 appendText → MemoryDocumentStore 写入时
 *      带 <!-- memory:mem_<32hex> --> 锚点行（每段一条，id 是 randomUUID）。整篇覆盖会抹掉这些
 *      锚点 ⇒ 检索索引（~/.dsh/memory/index/files）与磁盘不一致。故派生只做**幂等增量对齐**：
 *      只 append 缺失的条目行，绝不删除/重排/重写既有行。
 *
 * ★为什么是纯函数 + 显式传参：
 *   本模块不 import index.js（避免环形依赖），也不 import 任何 DSH 宿主 API。
 *   所有 IO 原语（读/写/追加）由调用方注入 => 可在隔离目录里真跑单测。
 *
 * 依赖：仅 event-store.js 的读/写（同一批 v4 数据层，互不循环）。
 */

import path from 'node:path'
import { readStorePre, writeStorePre, emptyEventPre, EVENT_STORE_FILENAME } from './event-store.js'

/** 事件存储文件名（与 event-store.js 单源，禁止再写字面量） */
export const EVENT_WRITE_STORE_FILENAME = EVENT_STORE_FILENAME

/** 日视图里要投影的检查点 kind（只有 log 属日日志；handoff/plan/progress 等不投影） */
export const DAY_VIEW_KINDS = Object.freeze(['log'])

/** 默认日界（分钟）—— 与 DEFAULT_CONFIG.dayBoundaryMinutes 同值；调用方应显式传 engine 的值 */
export const DEFAULT_DAY_BOUNDARY_MINUTES = 450

function pad2(n) { return (n < 10 ? '0' : '') + n }

/**
 * 记忆日口径（与 MemoryEngine.memToday() 逐字节同源）。
 *
 * ★为什么不用 toISOString().slice(0,10)：那是 UTC 日，UTC+8 的凌晨会差一天
 *   （本仓 2026-10-13 已踩过 UTC 日期坑，见 MASTER-PLAN 教训）。
 * ★为什么把 boundary 做成参数而不读 config：保持本模块无宿主依赖；
 *   调用方传 engine.config.dayBoundaryMinutes 即可。
 *
 * @param {number} ms 毫秒时间戳
 * @param {number} [boundaryMinutes=450] 日界（分钟）
 * @returns {string} 'YYYY-MM-DD'
 */
export function memDateOfPre(ms, boundaryMinutes) {
  const b = Number(boundaryMinutes)
  const boundary = Number.isFinite(b) && b >= 0 ? b : DEFAULT_DAY_BOUNDARY_MINUTES
  const d = new Date(Number(ms) || 0)
  if (d.getHours() * 60 + d.getMinutes() < boundary) d.setDate(d.getDate() - 1)
  return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate())
}

/** 时间戳 → 'HH:MM'（本地时区，与 nowHm() 同口径） */
export function hhmmOfPre(ms) {
  const d = new Date(Number(ms) || 0)
  return pad2(d.getHours()) + ':' + pad2(d.getMinutes())
}

/**
 * ① resolveActiveEventPre —— 找当前活跃事件。
 *
 * 判据：status === 'active' 且 updatedAt 最大。并列时按 id 字典序取小（确定性）。
 * 为什么用 updatedAt 而不是 createdAt：用户要的是「我现在在做哪件事」，
 *   最近有动作的那件才是当前工作（可能建于很久以前但刚刚还在推进）。
 *
 * @param {object} store readStorePre 的返回值
 * @returns {{id:string, event:object}|null}
 */
export function resolveActiveEventPre(store) {
  const evs = (store && Array.isArray(store.events)) ? store.events : []
  let best = null
  for (const ev of evs) {
    if (!ev || ev.status !== 'active') continue
    if (!best) { best = ev; continue }
    const a = Number(ev.updatedAt) || 0
    const b = Number(best.updatedAt) || 0
    if (a > b || (a === b && String(ev.id) < String(best.id))) best = ev
  }
  return best ? { id: best.id, event: best } : null
}

/**
 * ② createEventForWorkPre —— 无活跃事件时自动建一个。
 *
 * name 取值优先级：显式 name → 当天日志首条摘要 → 「未命名工作」。
 * ★name 上限 80 字（event-store.validateEventPre 硬校验），超长必须在此截断，
 *   否则整次写入会在 validate 阶段抛错（用户看到的却是「建事件失败」，归因困难）。
 *
 * @param {object} deps { readStore, writeStore } 或 { storePath }
 * @param {{name?:string, summary?:string}} opts
 * @returns {Promise<{id:string, event:object}>}
 */
export async function createEventForWorkPre(deps, opts = {}) {
  const storePath = typeof deps === 'string' ? deps : (deps && deps.storePath)
  if (!storePath) throw new Error('createEventForWorkPre: 缺少 storePath')
  const store = await readStorePre(storePath)
  const today = String(opts.today || '')
  const rawName = String(opts.name || '').trim()
  let name = rawName
  if (!name && today) {
    // 当天日志首条作为事件名（若已有事件但都 closed，用最近一条日志开新事件）
    const firstLine = firstDayViewLinePre(store, today, opts.dayBoundaryMinutes)
    if (firstLine) name = firstLine
  }
  if (!name) name = '未命名工作'
  if (name.length > 80) name = name.slice(0, 79) + '…'
  const used = new Set((store.events || []).map((e) => e.id))
  let id = ''
  // 与 event-store 的 newEventIdPre 同构（本模块独立生成，避免依赖未导出的内部函数）
  for (let i = 0; i < 32; i++) {
    const cand = 'evt_' + randomHex8()
    if (!used.has(cand)) { id = cand; break }
  }
  if (!id) throw new Error('createEventForWorkPre: event id 生成失败（32 次全部碰撞）')
  const ev = emptyEventPre(name, { id, summary: opts.summary })
  store.events = store.events || []
  store.events.push(ev)
  await writeStorePre(storePath, store)
  return { id: ev.id, event: ev }
}

/** 8 位 hex（与 event-store 的 newEventIdPre 同格式） */
function randomHex8() {
  // 用 crypto.randomBytes 保证随机性；不引 randomUUID（那是 32 hex，格式不符）
  const bytes = new Uint8Array(4)
  const c = (typeof globalThis !== 'undefined' && globalThis.crypto && globalThis.crypto.getRandomValues)
    ? globalThis.crypto
    : null
  if (c) { c.getRandomValues(bytes) } else { for (let i = 0; i < 4; i++) bytes[i] = Math.floor(Math.random() * 256) }
  // ★2026-10-25 修复（真缺陷，由升格后的 smoke-test-v4-h2-note-event 抓出，复现率约 1/40）：
  //   旧实现用 pad2(bytes[i].toString(16)) —— pad2 是**数值**补零（`n < 10 ? '0'+n : n`），
  //   而这里传的是**字符串**：'a' < 10 为 false（字符串与数字比较走 NaN 语义）⇒ 不补零。
  //   结果：当某个字节的十六进制是单个字母（a–f）时，id 只有 7 位 ⇒ event-store 的
  //   /^evt_[0-9a-f]{8}$/ 判 bad-id ⇒ append 抛错 ⇒ memory_log 报「事件写入失败」。
  //   实测 40 次建事件里命中 1 次（≈2.5%），且**只在某些随机值下出现** ⇒ 典型间歇性缺陷。
  //   修法：显式 padStart(2, '0')，对数字/字母两种形态都正确。
  let s = ''
  for (let i = 0; i < 4; i++) s += bytes[i].toString(16).padStart(2, '0')
  return s
}

/**
 * ③ appendCheckpointPre —— 追加检查点（append-only）。
 *
 * ★失败必须向上抛（红线②）：本函数**不 catch**，让调用方拿到真实错误并回传给模型。
 * ★幂等（Lead 补充要求）：idemKey 命中 ⇒ event-store 返回 {deduped:true}，本函数原样透出。
 *   调用方（memory_log）负责生成 idemKey：'log:' + date + ':' + hhmm + ':' + sha1(text).slice(0,12)。
 *
 * @param {string} storePath
 * @param {string} eventId
 * @param {{kind?:string, text:string, at?:number, sourceRef?:string, panels?:Array, idemKey?:string}} ck
 * @returns {Promise<{ok:true, checkpointCount:number, deduped:boolean}>}
 */
export async function appendCheckpointPre(storePath, eventId, ck) {
  if (!storePath) throw new Error('appendCheckpointPre: 缺少 storePath')
  if (!eventId) throw new Error('appendCheckpointPre: 缺少 eventId')
  const text = String(ck && ck.text != null ? ck.text : '')
  if (!text.trim()) throw new Error('appendCheckpointPre: text 不能为空')
  const checkpoint = {
    at: Number(ck && ck.at) || Date.now(),
    kind: String((ck && ck.kind) || 'log'),
    text,
    sourceRef: ck && ck.sourceRef != null ? String(ck.sourceRef) : null,
    panels: Array.isArray(ck && ck.panels) ? ck.panels : [],
    idemKey: ck && ck.idemKey != null ? String(ck.idemKey) : null,
  }
  // 动态 import 避免与 event-store 形成静态循环（两者已互相不 import，但保持单一入口）
  const { eventStorePre } = await import('./event-store.js')
  const r = await eventStorePre.append(storePath, eventId, { checkpoint })
  return { ok: true, checkpointCount: Number(r && r.checkpointCount) || 0, deduped: !!(r && r.deduped) }
}

/**
 * ④ renderDayViewPre —— 从事件按 date 派生当日 .md「应存在的完整文本」（纯函数）。
 *
 * ★这是**纯函数**：同样的 (store, date, boundary) 必然产出同样的字节。
 *   用途有两个：① 供 deriveDayViewToDiskPre 做增量对齐；② 供一致性校验/单测。
 *
 * 输出格式严格复刻现有 memory_log 的条目行（这是 reflect/consolidate 零改动的关键）：
 *     - HH:MM [kind:xxx] <note>
 * 与 periodSummary()（index.js L11632 `^- (\d{2}):(\d{2}) (.*)$`）和
 * greeting 兜底（L11944 `^- \d{2}:\d{2} `）完全兼容。
 *
 * ★为什么只取 kind==='log'：handoff / plan / progress 等检查点属于事件侧材料，
 *   不是「今天做了什么」的流水记录；混进日日志会污染 reflect 的输入。
 * ★为什么按 at 升序：日志天然是时间正序追加，派生也按时间序（与磁盘既有行同序）。
 *
 * @param {object} store
 * @param {string} date 'YYYY-MM-DD'
 * @param {number} [boundaryMinutes] 日界
 * @returns {string} 完整文本（每行以 \n 结尾；无条目返回 ''）
 */
export function renderDayViewPre(store, date, boundaryMinutes) {
  const want = String(date || '')
  if (!want) return ''
  const rows = []
  for (const ev of ((store && store.events) || [])) {
    for (const cp of ((ev && ev.checkpoints) || [])) {
      if (!cp || !cp.at) continue
      if (!DAY_VIEW_KINDS.includes(String(cp.kind))) continue
      if (memDateOfPre(cp.at, boundaryMinutes) !== want) continue
      const text = String(cp.text == null ? '' : cp.text).trim()
      if (!text) continue
      rows.push({ at: Number(cp.at) || 0, text })
    }
  }
  rows.sort((a, b) => (a.at - b.at) || (a.text < b.text ? -1 : a.text > b.text ? 1 : 0))
  return rows.length ? rows.map((r) => r.text).join('\n') + '\n' : ''
}

/** 取当天日视图第一条的正文（供 createEventForWorkPre 起名用） */
function firstDayViewLinePre(store, date, boundaryMinutes) {
  const body = renderDayViewPre(store, date, boundaryMinutes)
  const line = body.split('\n').find((l) => l.trim())
  if (!line) return ''
  // 去掉 '- HH:MM [kind:xxx] ' 前缀，只留 note 正文
  return line.replace(/^-\s*\d{2}:\d{2}\s*(\[kind:[a-z]+\]\s*)?/, '').trim()
}

/**
 * ⑤ deriveDayViewToDiskPre —— 把派生结果**幂等增量对齐**到磁盘 .md。
 *
 * ★为什么不是整篇覆盖（这是本次最关键的设计决定）：
 *   记忆 .md 在 memoryAnchorEnabled=true 时由 MemoryDocumentStore 写入，每段带
 *   `<!-- memory:mem_<32hex> -->` 锚点行（id 是 randomUUID，每段唯一）。
 *   整篇覆盖会把这些锚点全部抹掉 ⇒ ~/.dsh/memory/index/files 索引与磁盘不一致 ⇒
 *   memory_read / memory_recall 解析失败或触发整库重建。**那是数据破坏，不可接受。**
 *
 * 做法：
 *   ① 读磁盘现有文本，抽出「内容行」（以 '- ' 开头的条目行）集合
 *   ② 派生结果里**不在**现有集合中的行 ⇒ 逐条 append（走注入的 append 原语，保留锚点机制）
 *   ③ 既有行一律不删、不改、不重排
 *
 * @param {object} paths  { logPath }
 * @param {object} store  readStorePre 的返回值
 * @param {string} date
 * @param {object} io     { readText(path)->Promise<string>, appendText(path, text)->Promise<string> }
 * @param {number} [boundaryMinutes]
 * @returns {Promise<{ok:boolean, path:string, bytes:number, appended:number, skipped:number, error?:string}>}
 */
export async function deriveDayViewToDiskPre(paths, store, date, io, boundaryMinutes) {
  const logPath = paths && paths.logPath
  if (!logPath) throw new Error('deriveDayViewToDiskPre: 缺少 paths.logPath')
  if (!io || typeof io.readText !== 'function' || typeof io.appendText !== 'function') {
    throw new Error('deriveDayViewToDiskPre: io 必须提供 readText/appendText')
  }
  const wanted = renderDayViewPre(store, date, boundaryMinutes)
  const wantLines = wanted.split('\n').filter((l) => l.trim())
  if (!wantLines.length) {
    // 无条目：不创建空文件（与既有行为一致——memory_log 只在有条目时才建文件）
    const existing = await io.readText(logPath).catch(() => '')
    return { ok: true, path: logPath, bytes: String(existing || '').length, appended: 0, skipped: 0 }
  }
  const existing = String(await io.readText(logPath).catch(() => '') || '')
  // 现有内容行（只看以 '- ' 开头的条目行；锚点行/空行/标题行都不参与比对）
  const have = new Set()
  for (const l of existing.split('\n')) {
    const t = l.trim()
    if (t.startsWith('- ')) have.add(t)
  }
  let appended = 0
  let skipped = 0
  for (const line of wantLines) {
    const t = line.trim()
    if (have.has(t)) { skipped++; continue }
    await io.appendText(logPath, t)   // 失败会抛（红线②），此处不 catch
    have.add(t)
    appended++
  }
  const after = String(await io.readText(logPath).catch(() => '') || '')
  return { ok: true, path: logPath, bytes: after.length, appended, skipped }
}

/**
 * ⑥ verifyDayViewConsistencyPre —— 一致性校验（供 H2 的「镜像后立即读回」用，也供单测）。
 *
 * 返回缺失行（应存在但磁盘没有）—— 空数组 = 一致。
 * ★只报告、不修复：修复由 deriveDayViewToDiskPre 负责（职责分离，便于定位）。
 *
 * @returns {{consistent:boolean, missing:string[]}}
 */
export function verifyDayViewConsistencyPre(existingText, store, date, boundaryMinutes) {
  const wanted = renderDayViewPre(store, date, boundaryMinutes)
  const wantLines = wanted.split('\n').filter((l) => l.trim()).map((l) => l.trim())
  const have = new Set()
  for (const l of String(existingText || '').split('\n')) {
    const t = l.trim()
    if (t.startsWith('- ')) have.add(t)
  }
  const missing = wantLines.filter((l) => !have.has(l))
  return { consistent: missing.length === 0, missing }
}

/** 读事件存储（薄封装，便于调用方少 import 一个模块） */
export async function readEventStorePre(storePath) { return readStorePre(storePath) }

/** 事件存储路径（单一构造点，避免各处手拼 path.join） */
export function eventStorePathOfPre(handoffDir) {
  if (!handoffDir) throw new Error('eventStorePathOfPre: 缺少 handoffDir')
  return path.join(String(handoffDir), EVENT_STORE_FILENAME)
}


/* ══════════════════════════════════════════════════════════════════════
 * v4 H2（2026-10-24）：memory_note 的 handoff / plan 收敛到事件
 *
 * 用户裁定（Lead 2026-10-24 裁决 3）：
 *   · handoff：**双写，事件优先** —— .md 文件名带时间戳、天然唯一，改成派生会破坏；
 *     且账本本身 append-only，与检查点语义天然对应。双写不产生「两套真源」风险，
 *     因为内容完全一致、.md 只是给人读的。
 *   · plan：**只做镜像，不改写盘方向** —— writePlanSnapshot 有 revision/CAS + M1 保护门 +
 *     卡片锚点（用户级硬规则要求不能绕）。改成「事件头是真源、PLAN.md 是派生」会破坏这些保护。
 *     ⇒ 写 PLAN.md 成功后，把四段 sections 镜像进事件头；并**立即读回做一致性断言**。
 *
 * 三条红线（沿用 H1）：
 *   ① 事件写失败向上抛（不 fallback）；② .md 写失败时事件已写成功要在返回值里如实告知；
 *   ③ 镜像**不改变** PLAN.md 的写入路径与判据（CAS/M1/锚点保护全在 writePlanSnapshot 内部）。
 * ══════════════════════════════════════════════════════════════════════ */

/**
 * 从四段式账本文本里切出 sections（供 plan 镜像 + 账本自查用）。
 *
 * 账本格式（memory_note kind=handoff 产出的固定四段）：
 *     # 交接账本 · YYYY-MM-DD HH:MM
 *     ## 任务状态
 *     ...
 *     ## 目标
 *     ...
 *     ## 已试方案与失败原因
 *     ...
 *     ## 进度与下一步
 *     ...
 *
 * ★为什么用「固定四段」而不是泛化解析：这是 memory_note 的既有产出契约，
 *   泛化解析会把用户自由内容误切成段（本仓已踩过「按标题文字猜」的坑）。
 *   容忍别名（「进度与下一步」/「下一步」、「已试方案与失败原因」/「失败与弯路」）。
 *
 * @param {string} text
 * @returns {{goal:string, doing:string, deadend:string, next:string}}
 */
export function parseLedgerSectionsPre(text) {
  const src = String(text == null ? '' : text)
  const out = { goal: '', doing: '', deadend: '', next: '' }
  if (!src.trim()) return out
  // 别名 → 目标键（顺序即匹配优先级）
  const ALIAS = [
    ['next', ['进度与下一步', '下一步', '接下来']],
    ['deadend', ['已试方案与失败原因', '失败与弯路', '失败原因', '已试方案']],
    ['doing', ['任务状态', '当前状态', '进行中']],
    ['goal', ['目标', '目的']],
  ]
  const lines = src.split(/\r?\n/)
  // 找出每个二级标题行的位置与其归属键
  const heads = []
  for (let i = 0; i < lines.length; i++) {
    const m = /^##\s+(.+?)\s*$/.exec(lines[i])
    if (!m) continue
    const title = m[1]
    for (const [key, names] of ALIAS) {
      if (names.some((n) => title === n || title.startsWith(n))) { heads.push({ i, key }); break }
    }
  }
  if (!heads.length) return out
  for (let h = 0; h < heads.length; h++) {
    const from = heads[h].i + 1
    const to = h + 1 < heads.length ? heads[h + 1].i : lines.length
    // 同一段被多次命中时保留第一次（账本四段固定顺序，重复标题属异常）
    if (out[heads[h].key]) continue
    out[heads[h].key] = lines.slice(from, to).join('\n').trim()
  }
  return out
}

/**
 * 追加一条 handoff 检查点到当前活跃事件（双写的事件侧）。
 *
 * ★事件优先（Lead 2026-10-24 裁决 2）：本函数**在 .md 写成功之后**调用；
 *   若本函数抛错，调用方必须把「账本已写、事未记」如实告知（不能静默当成功）。
 * ★幂等：idemKey 用「账本文件名 + 内容 sha1」——同一篇账本重复调用不重复追加。
 *
 * @param {string} storePath
 * @param {{ledgerText:string, ledgerPath?:string, eventId?:string, today?:string, boundaryMinutes?:number}} opts
 * @returns {Promise<{ok:true, eventId:string, deduped:boolean, sections:object}>}
 */
export async function appendHandoffCheckpointPre(storePath, opts = {}) {
  if (!storePath) throw new Error('appendHandoffCheckpointPre: 缺少 storePath')
  const ledgerText = String(opts.ledgerText == null ? '' : opts.ledgerText)
  if (!ledgerText.trim()) throw new Error('appendHandoffCheckpointPre: ledgerText 不能为空')
  const sections = parseLedgerSectionsPre(ledgerText)
  let evId = String(opts.eventId || '')
  if (!evId) {
    const store0 = await readStorePre(storePath)
    const active = resolveActiveEventPre(store0)
    if (active) evId = active.id
    else {
      const created = await createEventForWorkPre(storePath, { today: opts.today, dayBoundaryMinutes: opts.boundaryMinutes, name: (sections.goal || '交接账本').slice(0, 40) })
      evId = created.id
    }
  }
  const keySrc = String(opts.ledgerPath || '') + '\u0000' + ledgerText
  // （idemKey 在下方 ckPayload 里按 kind 前缀生成；此处保留 keySrc 供其使用）
  // ★v4-C1（2026-10-25）：kind 可注入，默认仍是 'handoff'（**向后兼容**：既有 6 个调用点行为不变）。
  //   plan 走同一条 append 通道时传 'plan'，使「白板被更新过」这件事在事件里留下**时间线**
  //   （C1 之前 plan 只走 set sections = 覆盖，事件里看不到演变）。
  const ckKind = String(opts.kind == null || opts.kind === '' ? 'handoff' : opts.kind)
  // ★idemKey 必须把 kind 也算进去：否则同一份内容先按 'handoff' 记、再按 'plan' 记时会被去重成 1 条
  //   （两者语义不同：一个是交接账本，一个是白板快照）。默认 kind='handoff' 时 keySrc 与旧版**逐字节相同**。
  const idemKindPrefix = ckKind === 'handoff' ? 'handoff:' : (ckKind + ':')
  const ckPayload = { kind: ckKind, at: Date.now(), text: ledgerText, sourceRef: opts.ledgerPath ? String(opts.ledgerPath) : null, idemKey: idemKindPrefix + sha1Hex12(keySrc) }
  const { eventStorePre } = await import('./event-store.js')
  // ★★2026-10-26（用户裁定「一次调用写完全部」）：把四类感知随检查点一起 append。
  //   为什么是这里：event-store.append() 内部是**单个 mutatePre 事务**，
  //   checkpoint + userPercept/agentTrace/sharedGround/commitment 会一次原子落盘
  //   ⇒ 不存在「四段写进去了、感知没写进去」的半渡态（这正是之前白板永远「本期未填」的原因：
  //     根本没往下传）。
  //   ★全部可选：不传时行为与旧版**逐字节相同**（向后兼容，既有 6 个调用点不受影响）。
  const perceptArgs = {}
  for (const k of ['userPercept', 'agentTrace', 'sharedGround', 'commitment']) {
    const v = opts[k]
    if (v && typeof v === 'object') perceptArgs[k] = v
  }
  const r = await eventStorePre.append(storePath, evId, { checkpoint: ckPayload, ...perceptArgs })
  // ★★2026-10-25 修复（A 线自查 · 真缺陷）：handoff **只追加检查点，不镜像 sections**。
  //   原实现把账本的四段覆盖进事件头 sections，但两者语义完全不同：
  //     · 事件头 sections = 这件事**整体**的目标/进行中/失败与弯路/下一步（低频，只在方向变化时改）
  //     · 账本四段       = **本次会话**的任务状态/目标/失败/下一步（高频，每次交接都新一篇）
  //   ⇒ 每写一次账本就污染一次事件头；而下一次 memory_event(action=set) 的显式设置会被悄悄覆盖。
  //   实测后果（本机真实数据）：一次交接后事件卡片的「目标」段变成了账本的「目标」段、
  //   「进行中」变成了「任务状态」段 ⇒ 注入给模型的第一屏显示的是「最后一次执行的流水」
  //   而不是「项目目标」。
  //   ★为什么删掉不丢信息：账本全文已完整保存在检查点的 text 字段里（不是摘要，实测 1,834 字）。
  //   ★事件头 sections 的写入权归：memory_event(action=set) / memory_note(kind=plan) 镜像。
  return { ok: true, eventId: evId, deduped: !!(r && r.deduped), sections }
}

/**
 * 把 PLAN.md 的四段镜像进事件头 sections，并**立即读回做一致性断言**。
 *
 * ★不改写盘方向（Lead 裁决 3）：本函数**只读** PLAN.md 的文本、**只写**事件 store，
 *   绝不碰 PLAN.md 文件本身 ⇒ writePlanSnapshot 的 revision/CAS、M1 保护门、卡片锚点全部不受影响。
 *
 * ★一致性断言（Lead 硬条件 1）：写入后立即 readStorePre 读回，比对各键。
 *   不一致 ⇒ **记诊断并如实返回**（不静默）。这是将来发现「镜像漂移」的唯一手段。
 *
 * @param {string} storePath
 * @param {{planText:string, eventId?:string, today?:string, boundaryMinutes?:number, recordDiag?:Function}} opts
 * @returns {Promise<{ok:boolean, eventId:string, consistent:boolean, mismatch:string[], mirrored:string[], error?:string}>}
 */
export async function mirrorPlanSectionsPre(storePath, opts = {}) {
  if (!storePath) throw new Error('mirrorPlanSectionsPre: 缺少 storePath')
  const planText = String(opts.planText == null ? '' : opts.planText)
  const sections = parseLedgerSectionsPre(planText)
  const wanted = {}
  for (const k of ['goal', 'doing', 'deadend', 'next']) if (String(sections[k] || '').trim()) wanted[k] = sections[k]
  let evId = String(opts.eventId || '')
  if (!evId) {
    const store0 = await readStorePre(storePath)
    const active = resolveActiveEventPre(store0)
    if (active) evId = active.id
    else {
      const created = await createEventForWorkPre(storePath, { today: opts.today, dayBoundaryMinutes: opts.boundaryMinutes, name: '项目白板' })
      evId = created.id
    }
  }
  if (!Object.keys(wanted).length) {
    // PLAN 里没有四段标题 ⇒ 无可镜像（不是错误：白板不要求四段式）
    return { ok: true, eventId: evId, consistent: true, mismatch: [], mirrored: [] }
  }
  const { eventStorePre } = await import('./event-store.js')
  await eventStorePre.set(storePath, evId, { sections: wanted })
  // ★立即读回做一致性断言（不是信任刚才那次写）
  // ★为什么把这行抽成可注入：一致性断言本身必须有**负路径**（证明漂移真能被发现），
  //   而正常写入下 set→read 必然一致 ⇒ 无法从外部构造漂移。注入 readBack 后可在测试里
  //   返回一份「少了一个键」的假读回，从而真跑 mismatch 分支。生产默认走 readStorePre，零行为变化。
  const back = typeof opts.readBack === 'function' ? await opts.readBack(storePath) : await readStorePre(storePath)
  const ev = (back.events || []).find((e) => e.id === evId)
  const got = (ev && ev.sections) || {}
  const mismatch = []
  for (const k of Object.keys(wanted)) {
    const a = String(wanted[k] == null ? '' : wanted[k]).replace(/\s+$/, '')
    const b = String(got[k] == null ? '' : got[k]).replace(/\s+$/, '')
    if (a !== b) mismatch.push(k)
  }
  const consistent = mismatch.length === 0
  if (!consistent && typeof opts.recordDiag === 'function') {
    try { opts.recordDiag(new Error('plan-mirror-drift: ' + mismatch.join(',')), { eventId: evId }) } catch (_) {}
  }
  return { ok: true, eventId: evId, consistent, mismatch, mirrored: Object.keys(wanted) }
}

/** 12 位 sha1（幂等键用；与 memory_log 的 idemKey 同构） */
function sha1Hex12(s) {
  // 用纯 JS 实现避免 import node:crypto（本模块保持零额外依赖；输入已含路径+全文，碰撞概率可忽略）
  let h1 = 0x811c9dc5, h2 = 0x01000193
  const str = String(s == null ? '' : s)
  for (let i = 0; i < str.length; i++) {
    const c = str.charCodeAt(i)
    h1 = (h1 ^ c) >>> 0; h1 = Math.imul(h1, 0x01000193) >>> 0
    h2 = (h2 + c * (i + 1)) >>> 0; h2 = Math.imul(h2, 0x85ebca6b) >>> 0
  }
  const hex = (n) => (n >>> 0).toString(16).padStart(8, '0')
  return (hex(h1) + hex(h2)).slice(0, 12)
}
export default Object.freeze({
  memDateOfPre,
  hhmmOfPre,
  resolveActiveEventPre,
  createEventForWorkPre,
  appendCheckpointPre,
  renderDayViewPre,
  deriveDayViewToDiskPre,
  verifyDayViewConsistencyPre,
  parseLedgerSectionsPre,
  appendHandoffCheckpointPre,
  mirrorPlanSectionsPre,
  readEventStorePre,
  eventStorePathOfPre,
  EVENT_WRITE_STORE_FILENAME,
  DAY_VIEW_KINDS,
  DEFAULT_DAY_BOUNDARY_MINUTES,
})

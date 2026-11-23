/**
 * upgrade-apply.js —— 记忆整理向导 · P2（2026-11-03）
 *
 * 依据：docs/internal/PLAN-UPGRADE-WIZARD-20261103.md §3.7（闸 8–10）、§4、§5、§6 第 4 行
 * 任务：把「子代理写好草案文件 → 引擎校验 → 落盘」这条受控通道的**落盘端**实现出来。
 *
 * ⚠️ 本模块是整条向导链路上**第二个会写用户数据**的模块（第一个是 event-regroup-apply）。
 *   设计原则（与 event-regroup-apply 同族，直接复用其快照/回滚实现，不另立一套）：
 *     ① **快照先行**：写盘前把 event-store.json + PLAN.md 复制到
 *        `opts.backupRoot/<wsKey>/<ts>/`（store 走既有 snapshotStorePre）；
 *     ② **校验在前**：任何一区的草案必须先过 validateUpgradeDraftPre（闸 1–7），
 *        不过 ⇒ 该区整区回滚、标 failed、**继续下一区**（不中断整批，§10 裁定）；
 *     ③ **原子写**：store 走 writeStorePre（tmp→rename）+ 库锁 withEventStoreLockPre；
 *        PLAN.md 走本模块的 tmp→rename（不经过引擎 writePlanSnapshot，避免 import index.js 环形依赖）；
 *     ④ **幂等**：同一 runId+wsKey 重复 apply 不产生重复事件 —— 先按 draft 里的 idemTag、
 *        再按既有事件名判重；全部命重时**不写盘**（sha 不变）；
 *     ⑤ **dry-run（只检测不整理）**：opts.dryRun=true ⇒ 只校验 + 渲染预览，零写盘，回执带 dryRun:true。
 *
 * 【与 upgrade-draft.js 的依赖（P1 并联）】
 *   本模块**不内联**闸 1–7。校验器优先动态 import `./upgrade-draft.js` 的
 *   validateUpgradeDraftPre(draft, ctx)；该文件此刻若不存在，退回本模块的
 *   fallbackValidateDraftPre（闸 1–2 最小实现，fail-closed），并在回执里把
 *   validatorSource 标成 'builtin-fallback' —— 一旦 P1 落盘，自动切到真校验器，零改动。
 *   也支持 opts.validate 注入（测试 / 引擎按需替换），注入时 validatorSource='injected'。
 *   传入校验器的 draft = 区草案**投影**（剥掉 applier 自己的 storePath/planPath 定位覆盖字段）；
 *   zone.storePath/zone.planPath 只作为路径覆盖，不进草案 schema。
 *
 * 【校验器返回契约（我方只认三种，其余 fail-closed）】
 *   · true / { ok: true }
 *   · { ok: false, code, errors: string[] }
 *   · 数组形态：[] = 过，非空 = 拒
 *   未知形状（含 {} / null / 'ok'）一律当拒绝 —— 这是「宁可拦下也不污染」的立场。
 */

import { createHash, randomBytes } from 'node:crypto'
import { readFile, writeFile, rename, mkdir, copyFile, unlink, readdir, stat } from 'node:fs/promises'
import path from 'node:path'
import {
  emptyEventPre,
  readStorePre,
  validateEventPre,
  writeStorePre,
  withEventStoreLockPre,
  EVENT_STORE_FILENAME,
  EVENT_KINDS,
  EVENT_CONFIDENCES,
} from './event-store.js'
import { snapshotStorePre, rollbackFromSnapshotPre } from './event-regroup-apply.js'
import { renderPlanFromEventsPre } from './plan-render.js'

/** 回执 schema 版本（引擎/前端按此判形状） */
export const UPGRADE_APPLY_SCHEMA = 'upgrade_apply_receipt_v1'
/** 白板文件名（与 datadir.planFile / writePlanSnapshot 同源） */
export const PLAN_FILENAME = 'PLAN.md'
/** 旧白板归档子目录（与 writePlanSnapshot 的 handoff/archive/ 同源） */
export const PLAN_ARCHIVE_DIRNAME = 'archive'

/** 草案事件的**字段白名单**（闸 1 的落盘侧冗余兜底；真闸 1 在 upgrade-draft.js） */
export const DRAFT_EVENT_FIELDS = Object.freeze([
  'id', 'name', 'summary', 'sections', 'checkpoints', 'members', 'rationale',
  'kind', 'confidence', 'outcomes', 'startMs', 'endMs', 'status', 'pausedReason',
  'outcome', 'ordinal', 'skills', 'idemTag', 'userPercept', 'agentTrace',
  'sharedGround', 'commitments', 'constraints',
])

const CUT = '…'

/** 统一的错误构造：带 code 便于回执分层（失败原因要回给用户，不能一句 'error' 糊过去） */
function failPre(code, message, extra) {
  const e = new Error(String(message || code))
  e.code = String(code)
  if (extra && typeof extra === 'object') Object.assign(e, extra)
  return e
}

/** 数组化（非数组 ⇒ []） */
function asArray(v) { return Array.isArray(v) ? v : [] }

/** 取对象里白名单字段（undefined/null 不落盘，避免脏键） */
function pickPre(obj, keys) {
  const out = {}
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return out
  for (const k of keys) if (obj[k] !== undefined && obj[k] !== null) out[k] = obj[k]
  return out
}

/** 文件 sha256（不存在 ⇒ null；其它 IO 错误照抛，不静默） */
export async function sha256FilePre(file) {
  try {
    const buf = await readFile(file)
    return createHash('sha256').update(buf).digest('hex')
  } catch (e) {
    if (e && e.code === 'ENOENT') return null
    throw e
  }
}

/** 字符串 sha256（白板正文用） */
function sha256TextPre(text) {
  return createHash('sha256').update(Buffer.from(String(text == null ? '' : text), 'utf8')).digest('hex')
}

/** 时间戳 → YYYYMMDD-HHMMSS（本地时区；与 handoffStamp 同口径，用本地时间） */
function stampPre(ms) {
  const d = new Date(Number(ms) > 0 ? Number(ms) : Date.now())
  const p = (n) => String(n).padStart(2, '0')
  return String(d.getFullYear()) + p(d.getMonth() + 1) + p(d.getDate()) + '-' + p(d.getHours()) + p(d.getMinutes()) + p(d.getSeconds())
}

/** 本地事件 id（与 event-store.newEventIdPre 同算法；该函数是私有导出，故内联并在套件里断言格式） */
function nextEventIdPre(used) {
  for (let i = 0; i < 32; i++) {
    const id = 'evt_' + randomBytes(4).toString('hex')
    if (!used || !used.has(id)) { if (used) used.add(id); return id }
  }
  throw failPre('event-id-collision', '事件 id 生成失败（32 次全部碰撞）')
}

// ══════════════════════════════════════════════════════════════════════════════
// ① 校验器接入（P1 并联点）
// ══════════════════════════════════════════════════════════════════════════════

/** 动态 import 结果缓存：'upgrade-draft' 或 'builtin-fallback' */
let _validatorPromisePre = null

/** 供套件/引擎在文件后出现时重置缓存（生产进程生命周期短，一般用不到） */
export function resetValidatorCachePre() { _validatorPromisePre = null }

/** 载入本校验器：优先 ./upgrade-draft.js，缺失 ⇒ 内置兜底（不抛，保持可用） */
function loadBundledValidatorPre() {
  if (_validatorPromisePre) return _validatorPromisePre
  _validatorPromisePre = (async () => {
    try {
      const m = await import('./upgrade-draft.js')
      if (m && typeof m.validateUpgradeDraftPre === 'function') {
        return { fn: m.validateUpgradeDraftPre, source: 'upgrade-draft' }
      }
    } catch (e) {
      const msg = String((e && e.message) || e)
      // 只有「模块不存在」才降级；模块存在但自身 throw（语法/初始化错误）必须原样抛
      if (!/(cannot find module|err_module_not_found|module_not_found|failed to fetch dynamically imported module|is not defined)/i.test(msg)) throw e
    }
    return { fn: fallbackValidateDraftPre, source: 'builtin-fallback' }
  })()
  return _validatorPromisePre
}

/** 解析本次使用的校验器（opts.validate 优先） */
async function resolveValidatorPre(o) {
  if (o && typeof o.validate === 'function') {
    return { fn: o.validate, source: String((o && o.validatorSource) || 'injected') }
  }
  return loadBundledValidatorPre()
}

/**
 * 校验器返回值归一化。**未知形状一律 fail-closed**。
 * @returns {{ok:boolean, code:string, errors:string[]}}
 */
export function normalizeValidatorResultPre(res) {
  if (res === true) return { ok: true, code: 'ok', errors: [] }
  if (res === false) return { ok: false, code: 'validate-rejected', errors: ['校验器返回 false'] }
  if (Array.isArray(res)) {
    const errors = res.map((x) => (typeof x === 'string' ? x : JSON.stringify(x))).filter(Boolean)
    return { ok: errors.length === 0, code: errors.length ? 'validate-rejected' : 'ok', errors }
  }
  if (res && typeof res === 'object') {
    const errors = Array.isArray(res.errors)
      ? res.errors.map((x) => (typeof x === 'string' ? x : JSON.stringify(x))).filter(Boolean)
      : []
    const ok = res.ok === true || (res.ok === undefined && Array.isArray(res.errors) && errors.length === 0)
    return { ok: ok === true, code: String(res.code || (ok ? 'ok' : 'validate-rejected')), errors, warnings: Array.isArray(res.warnings) ? res.warnings : undefined }
  }
  return { ok: false, code: 'validator-result-unrecognized', errors: ['校验器返回了无法识别的形状：' + String(res).slice(0, 120)] }
}

/** 确定性 hash（幂等标签兜底用） */
function idemDigestPre(s) {
  return createHash('sha256').update(String(s == null ? '' : s), 'utf8').digest('hex').slice(0, 16)
}

/**
 * 计算草案事件的幂等标签：草案显式给了 idemTag 就用它；否则派生
 * `upgrade:<runId|wsKey|name 的 sha256 前 16>`。
 *
 * ★为什么派生值里带 runId：同一批迁移的**重试**（同 runId）必须命中同一条记录 ⇒ 幂等；
 *   换一批（新 runId）时仍会由「既有事件名判重」拦住，不会重复建。
 */
export function draftIdemTagPre({ de, runId, wsKey, name } = {}) {
  const raw = String((de && de.idemTag) || '').trim()
  if (raw) return raw.slice(0, 200)
  return 'upgrade:' + idemDigestPre(String(runId || '') + '\u0000' + String(wsKey || '') + '\u0000' + String(name || '').trim())
}

/** 校验器透传上下文里的 files 归一：按草案引用的 rel 到真实工作区读文件 */
async function collectDraftFilesPre({ zone, wsPath, opts }) {
  if (opts && opts.files && typeof opts.files === 'object') return opts.files
  const rels = new Set()
  for (const de of asArray(zone && zone.events)) {
    for (const m of asArray(de && de.members)) if (typeof m === 'string') rels.add(m)
    for (const cp of asArray(de && de.checkpoints)) if (cp && typeof cp.rel === 'string') rels.add(cp.rel)
  }
  const files = {}
  for (const rel of rels) {
    const clean = String(rel || '').replace(/\\/g, '/').trim()
    if (!clean || path.isAbsolute(clean) || clean.split('/').includes('..')) continue
    for (const base of [wsPath, path.join(wsPath, '.dsh-memory')]) {
      const p = path.join(base, clean)
      try {
        const st = await stat(p)
        if (st.isFile()) { files[rel] = await readFile(p, 'utf8'); break }
      } catch (_) { /* 不存在是正常情况：闸 3 会据此拒 */ }
    }
  }
  return files
}

/** 统计工作区日志文件数（闸 4 的 coveredLogs 分母） */
async function countLogsPre(wsPath) {
  const dir = path.join(wsPath, '.dsh-memory')
  try {
    const names = await readdir(dir)
    return names.filter((n) => /^\d{4}-\d{2}-\d{2}\.md$/.test(n)).length
  } catch (e) {
    if (e && e.code === 'ENOENT') return 0
    return 0
  }
}

/**
 * 内置兜底校验器：**闸 1（字段白名单）+ 闸 2（必填）**的最小实现 + 闸 3 的真溯源抽查。
 * 存在的意义：P1（lib/upgrade-draft.js）未落盘时 applier 仍可跑、且仍然 fail-closed；
 * 真正的闸 4–7（守恒/形态/去重/卫生）由 P1 负责，这里**不假装实现**。
 *
 * @param {object} draft 单区草案
 * @param {{files?:object, wsKey?:string, logCount?:number}} [ctx]
 * @returns {{ok:boolean, code:string, errors:string[], warnings?:string[], stats?:object}}
 */
export function fallbackValidateDraftPre(draft, ctx) {
  const out = { ok: false, code: 'schema', errors: [] }
  const d = draft && typeof draft === 'object' && !Array.isArray(draft) ? draft : null
  if (!d) { out.errors.push('草案不是对象'); return out }
  const events = d.events
  if (!Array.isArray(events)) { out.errors.push('草案缺少 events 数组'); return out }
  if (!events.length) { out.code = 'required'; out.errors.push('草案没有任何事件'); return out }
  const files = (ctx && ctx.files && typeof ctx.files === 'object') ? ctx.files : null
  const names = new Set()
  const tags = new Set()
  let checkpoints = 0
  for (let i = 0; i < events.length; i++) {
    const ev = events[i]
    const at = 'events[' + i + ']'
    if (!ev || typeof ev !== 'object' || Array.isArray(ev)) { out.errors.push(at + ' 不是对象'); continue }
    for (const k of Object.keys(ev)) if (!DRAFT_EVENT_FIELDS.includes(k)) out.errors.push(at + ' 未知字段 ' + k)
    const name = String(ev.name == null ? '' : ev.name).trim()
    if (!name) out.errors.push(at + ' name 为空')
    if (name.length > 80) out.errors.push(at + ' name 超长（' + name.length + ' > 80）')
    if (String(ev.summary == null ? '' : ev.summary).length > 400) out.errors.push(at + ' summary 超长（>400）')
    if (names.has(name)) out.errors.push(at + ' 事件名重复：' + name)
    names.add(name)
    const sec = ev.sections
    if (!sec || typeof sec !== 'object' || Array.isArray(sec)) out.errors.push(at + ' sections 不是对象')
    else for (const k of ['goal', 'doing', 'deadend', 'next']) {
      if (!(typeof sec[k] === 'string' && sec[k].trim())) out.errors.push(at + ' sections.' + k + ' 必须是非空字符串')
    }
    if (!Array.isArray(ev.members) || !ev.members.some((m) => typeof m === 'string' && m.trim())) out.errors.push(at + ' members 至少 1 条非空字符串')
    if (!(typeof ev.rationale === 'string' && ev.rationale.trim())) out.errors.push(at + ' rationale 必填')
    if (ev.idemTag != null) {
      const tag = String(ev.idemTag)
      if (tags.has(tag)) out.errors.push(at + ' idemTag 重复：' + tag)
      tags.add(tag)
    }
    if (ev.kind !== undefined && !EVENT_KINDS.includes(ev.kind)) out.errors.push(at + ' 非法 kind：' + String(ev.kind))
    if (ev.confidence !== undefined && !EVENT_CONFIDENCES.includes(ev.confidence)) out.errors.push(at + ' 非法 confidence：' + String(ev.confidence))
    const cps = asArray(ev.checkpoints)
    for (let j = 0; j < cps.length; j++) {
      const cp = cps[j]
      const cAt = at + '.checkpoints[' + j + ']'
      if (!cp || typeof cp !== 'object' || Array.isArray(cp)) { out.errors.push(cAt + ' 不是对象'); continue }
      checkpoints++
      if (!(typeof cp.text === 'string' && cp.text.trim())) out.errors.push(cAt + ' text 为空')
      if (cp.at !== undefined && !(typeof cp.at === 'number' && Number.isFinite(cp.at) && cp.at > 0)) out.errors.push(cAt + ' at 必须是正数时间戳')
      // 闸 3 的**真溯源**（幻觉引用专挡）：rel 必须在 files 里真实存在，quoteRef 必须在文件里子串命中
      if (cp.rel != null) {
        const rel = String(cp.rel)
        if (files && typeof files[rel] !== 'string') out.errors.push(cAt + ' 溯源文件不存在：' + rel)
        else if (files && cp.quoteRef != null) {
          const q = String(cp.quoteRef)
          if (q && files[rel].indexOf(q) < 0) out.errors.push(cAt + ' quoteRef 未在该文件命中（疑似幻觉引用）：' + rel)
        }
      } else if (cp.quoteRef != null) {
        out.errors.push(cAt + ' 给了 quoteRef 却没有 rel（无法溯源）')
      }
    }
  }
  if (out.errors.length) {
    out.code = 'schema'
    if (out.errors.some((e) => e.indexOf('必填') >= 0 || e.indexOf('为空') >= 0 || e.indexOf('重复') >= 0 || e.indexOf('必须') >= 0)) out.code = 'required'
    return out
  }
  out.ok = true
  out.code = 'ok'
  out.stats = { events: events.length, checkpoints, logCount: Number((ctx && ctx.logCount) || 0) }
  return out
}

// ══════════════════════════════════════════════════════════════════════════════
// ② 草案 → 事件（纯函数，零 IO；套件可直接断言）
// ══════════════════════════════════════════════════════════════════════════════

/** 草案检查点 → 落盘检查点（保留四段/溯源字段；at 缺失用 now） */
function checkpointPre(c, now) {
  const cp = c && typeof c === 'object' && !Array.isArray(c) ? c : {}
  const at = Number(cp.at)
  const out = {
    at: Number.isFinite(at) && at > 0 ? Math.floor(at) : now,
    kind: String(cp.kind == null ? 'log' : cp.kind) || 'log',
    text: String(cp.text == null ? '' : cp.text),
  }
  if (cp.sourceRef != null) out.sourceRef = String(cp.sourceRef)
  if (cp.idemKey != null) out.idemKey = String(cp.idemKey)
  for (const k of ['goal', 'state', 'dead', 'next']) if (cp[k] != null) out[k] = String(cp[k])
  if (cp.quoteRef != null) out.quoteRef = String(cp.quoteRef)
  if (Number.isFinite(Number(cp.quoteLine))) out.quoteLine = Math.floor(Number(cp.quoteLine))
  if (cp.rel != null) out.rel = String(cp.rel)
  if (Number.isFinite(Number(cp.bytes))) out.bytes = Math.floor(Number(cp.bytes))
  if (cp.sha256 != null) out.sha256 = String(cp.sha256)
  if (Array.isArray(cp.panels)) {
    out.panels = cp.panels.map((pn) => ({
      kind: String((pn && pn.kind) || 'log'),
      text: String((pn && pn.text) == null ? '' : (pn && pn.text)),
    }))
  }
  return out
}

/**
 * 单条草案事件 → 严格 16/26 字段事件。**任何非法输入抛错**（fail-closed，不静默回落）。
 *
 * @param {object} de 草案事件
 * @param {{id?:string, idemTag?:string, now?:number}} opts
 * @returns {object} 通过 validateEventPre 的事件
 */
export function draftEventToStoreEventPre(de, opts = {}) {
  const src = de && typeof de === 'object' && !Array.isArray(de) ? de : {}
  const now = Number(opts.now) > 0 ? Number(opts.now) : Date.now()
  const name = String(src.name == null ? '' : src.name).trim()
  if (!name) throw failPre('empty-name', '草案事件缺少 name')
  if (name.length > 80) throw failPre('name-too-long', '草案事件 name 超长（>80）：' + name.slice(0, 80))
  const ev = emptyEventPre(name, { id: String(opts.id || ''), summary: String(src.summary == null ? '' : src.summary), now })

  const status = String(src.status || 'active')
  if (!['active', 'paused', 'closed'].includes(status)) throw failPre('bad-status', '非法 status：' + status)
  ev.status = status
  if (status === 'paused') {
    const r = String(src.pausedReason || '').trim()
    if (!r) throw failPre('paused-needs-reason', 'paused 事件缺少 pausedReason：' + name)
    ev.pausedReason = r
  }
  if (status === 'closed') {
    const o = String(src.outcome || '').trim()
    if (!o) throw failPre('closed-needs-outcome', 'closed 事件缺少 outcome：' + name)
    ev.outcome = o
  }

  const sec = src.sections && typeof src.sections === 'object' ? src.sections : {}
  for (const k of ['goal', 'doing', 'deadend', 'next']) ev.sections[k] = typeof sec[k] === 'string' ? sec[k] : ''
  ev.checkpoints = asArray(src.checkpoints).map((c) => checkpointPre(c, now))
  ev.userPercept = asArray(src.userPercept).map((x) => pickPre(x, ['at', 'kind', 'stage', 'text', 'sourceRef']))
  ev.agentTrace = asArray(src.agentTrace).map((x) => pickPre(x, ['at', 'action', 'result', 'wasRefuted', 'sourceRef']))
  ev.sharedGround = asArray(src.sharedGround).map((x) => pickPre(x, ['at', 'claim', 'confirmedBy', 'correction', 'sourceRef']))
  ev.commitments = asArray(src.commitments).map((x) => pickPre(x, ['at', 'promise', 'boundary', 'state', 'sourceRef']))
  ev.constraints = asArray(src.constraints).filter((x) => typeof x === 'string').slice(0, 200)
  if (src.skillRef != null) ev.skillRef = String(src.skillRef)

  if (Number.isFinite(Number(src.startMs)) && Number(src.startMs) >= 0) ev.startMs = Math.floor(Number(src.startMs))
  if (Number.isFinite(Number(src.endMs)) && Number(src.endMs) >= 0) ev.endMs = Math.floor(Number(src.endMs))
  if (Array.isArray(src.members)) ev.members = src.members.filter((m) => typeof m === 'string').slice(0, 500)
  if (typeof src.rationale === 'string') ev.rationale = src.rationale.slice(0, 600)
  if (src.kind !== undefined) {
    if (!EVENT_KINDS.includes(src.kind)) throw failPre('bad-kind', '非法 kind：' + JSON.stringify(src.kind) + '（' + (name) + '）')
    ev.kind = src.kind
  }
  if (src.confidence !== undefined) {
    if (!EVENT_CONFIDENCES.includes(src.confidence)) throw failPre('bad-confidence', '非法 confidence：' + JSON.stringify(src.confidence) + '（' + name + '）')
    ev.confidence = src.confidence
  }
  if (Array.isArray(src.outcomes)) ev.outcomes = src.outcomes.filter((o) => typeof o === 'string').slice(0, 50)
  if (Number.isFinite(Number(src.ordinal))) ev.ordinal = Math.floor(Number(src.ordinal))
  if (src.skills !== undefined) {
    if (Array.isArray(src.skills)) {
      const names = src.skills.filter((s) => typeof s === 'string' && s.trim()).map((s) => s.trim()).slice(0, 200)
      ev.skills = { hitCount: 0, names, touched: names.length > 0 }
    } else if (src.skills && typeof src.skills === 'object') {
      const names = Array.isArray(src.skills.names) ? src.skills.names.filter((s) => typeof s === 'string') : []
      const hits = Math.max(0, Math.floor(Number(src.skills.hitCount) || 0))
      const touched = typeof src.skills.touched === 'boolean' ? src.skills.touched : names.length > 0
      ev.skills = { hitCount: hits, names: names.slice(0, 200), touched }
    } else {
      throw failPre('bad-skills', 'skills 必须是字符串数组或 {hitCount,names,touched}：' + name)
    }
  }
  ev.idemTag = String(opts.idemTag || draftIdemTagPre({ de: src, runId: opts.runId, wsKey: opts.wsKey, name }))

  const bad = validateEventPre(ev)
  if (bad.length) throw failPre('event-invalid', '草案事件落盘校验失败「' + name + '」：' + bad.join(','), { badFields: bad })
  return ev
}

/**
 * ★幂等核心：给定区草案 + 既有 store，算出**真正要新建的事件**。
 * 判重顺序（与 §3.7 闸 6 同向）：
 *   ① 草案内重名/重 idemTag ⇒ 跳过（真闸 6 会拒，这里再兜一层）
 *   ② 既有事件 idemTag 相同 ⇒ 跳过（重试幂等）
 *   ③ 既有事件名相同 ⇒ 跳过（点名的幂等判据）
 *
 * @returns {{toCreate: object[], skipped: Array<{name:string,reason:string}>}}
 */
export function buildCreatePlanPre({ zone, store, runId, wsKey, now } = {}) {
  const existing = asArray(store && store.events)
  const usedIds = new Set(existing.map((e) => String((e && e.id) || '')))
  const existingTags = new Set()
  const existingNames = new Set()
  for (const ev of existing) {
    if (ev && typeof ev.idemTag === 'string' && ev.idemTag) existingTags.add(ev.idemTag)
    if (ev) { const n = String(ev.name || '').trim(); if (n) existingNames.add(n) }
  }
  const t = Number(now) > 0 ? Number(now) : Date.now()
  const toCreate = []
  const skipped = []
  const draftNames = new Set()
  const draftTags = new Set()
  for (const de of asArray(zone && zone.events)) {
    const name = String((de && de.name) || '').trim()
    if (!name) { skipped.push({ name: '', reason: 'empty-name' }); continue }
    if (draftNames.has(name)) { skipped.push({ name, reason: 'duplicate-in-draft' }); continue }
    draftNames.add(name)
    const idemTag = draftIdemTagPre({ de, runId, wsKey, name })
    if (draftTags.has(idemTag)) { skipped.push({ name, reason: 'duplicate-idemTag-in-draft' }); continue }
    draftTags.add(idemTag)
    if (existingTags.has(idemTag)) { skipped.push({ name, reason: 'idemTag-exists' }); continue }
    if (existingNames.has(name)) { skipped.push({ name, reason: 'name-exists' }); continue }
    toCreate.push(draftEventToStoreEventPre(de, { id: nextEventIdPre(usedIds), idemTag, now: t, runId, wsKey }))
  }
  return { toCreate, skipped }
}

// ══════════════════════════════════════════════════════════════════════════════
// ③ 白板渲染 + 闸 8（渲染门）
// ══════════════════════════════════════════════════════════════════════════════

/** 骨架的节标题集合（用渲染器自身产出，避免在 applier 里另抄一份节名判据） */
let _planHeadersCachePre = null
function expectedPlanHeadersPre() {
  if (_planHeadersCachePre) return _planHeadersCachePre
  const skel = renderPlanFromEventsPre([], { wsName: 'workspace', now: Date.now() })
  _planHeadersCachePre = (skel.match(/^## .+$/gm) || []).map((s) => s.trim())
  return _planHeadersCachePre
}

/** 白板锚点（M1 保护门口径：<!--memory:mem_*-->） */
export function planAnchorsPre(text) {
  const out = []
  for (const m of String(text == null ? '' : text).matchAll(/<!--\s*memory:(mem_[0-9a-f]+)\s*-->/gi)) out.push(m[1])
  return out
}

/**
 * 闸 8：白板渲染门 —— 非空、含预期节、不外泄 HTML 注释（plan-render 契约）。
 * ★「锚点集合不丢（M1 保护门）」的落地方式：渲染器按设计**剥掉** HTML 注释，
 *   所以旧白板的锚点不可能出现在新正文里；本模块在覆盖前把旧白板**逐字节归档**到
 *   handoff/archive/PLAN-<ts>.md 并读回校验 sha 相同（见 archivePlanPre / applyZonePre），
 *   以此保证「旧锚点一个不丢」——这与 writePlanSnapshot 的「先归档再写」同源。
 * @returns {{ok:boolean, code?:string, missing?:string[], bytes?:number}}
 */
export function checkPlanRenderGatePre(planText) {
  const text = String(planText == null ? '' : planText)
  if (!text.trim()) return { ok: false, code: 'plan-empty' }
  const missing = expectedPlanHeadersPre().filter((h) => text.indexOf(h) < 0)
  if (missing.length) return { ok: false, code: 'plan-section-missing', missing }
  if (text.indexOf('<!--') >= 0) return { ok: false, code: 'plan-comment-leak' }
  return { ok: true, bytes: Buffer.byteLength(text, 'utf8') }
}

/** 原子写白板（tmp → rename；不经过引擎，避免 index.js 环形依赖） */
async function writePlanAtomicPre({ planPath, text }) {
  const dir = path.dirname(planPath)
  await mkdir(dir, { recursive: true })
  const tmp = path.join(dir, '.PLAN.' + process.pid + '.' + randomBytes(4).toString('hex') + '.tmp')
  try {
    await writeFile(tmp, String(text), 'utf8')
    await rename(tmp, planPath)
  } catch (e) {
    try { await unlink(tmp) } catch (_) {}
    throw e
  }
  return { ok: true }
}

/** 覆盖前归档旧白板（writeFile flag:'wx' 防同名静默覆盖；同秒多写加 -b/-c 后缀） */
async function archivePlanPre(handoffDir, oldText, now) {
  const dir = path.join(handoffDir, PLAN_ARCHIVE_DIRNAME)
  await mkdir(dir, { recursive: true })
  const base = 'PLAN-' + stampPre(now)
  let file = path.join(dir, base + '.md')
  for (let i = 0; i < 26; i++) {
    try {
      await writeFile(file, String(oldText), { encoding: 'utf8', flag: 'wx' })
      return { ok: true, file }
    } catch (e) {
      if (e && e.code === 'EEXIST') { file = path.join(dir, base + '-' + String.fromCharCode(98 + i) + '.md'); continue }
      throw e
    }
  }
  throw failPre('plan-archive-collision', '归档文件名冲突过多：' + base)
}

/** 快照 PLAN.md（不存在/不是文件 ⇒ 记 skipped，不抛） */
async function snapshotPlanPre(planPath, backupDir) {
  let st = null
  try { st = await stat(planPath) } catch (e) {
    if (e && e.code === 'ENOENT') return { ok: true, skipped: 'plan-not-exist' }
    throw e
  }
  if (!st.isFile()) return { ok: true, skipped: 'plan-not-file' }
  await mkdir(backupDir, { recursive: true })
  const file = path.join(backupDir, PLAN_FILENAME)
  await copyFile(planPath, file)
  return { ok: true, file }
}

// ══════════════════════════════════════════════════════════════════════════════
// ④ 单区 apply（快照 → 校验 → 原子写 → 渲染 → 回执 / 失败整区回滚）
// ══════════════════════════════════════════════════════════════════════════════

/**
 * 交给草案校验器的**投影**：剥掉 applier 自己的定位覆盖字段（storePath/planPath）。
 *
 * ★为什么必须剥：P1 的闸 1 是**严格顶层白名单**（wsKey/wsPath/events/selfCheck）。
 *   引擎/套件为了定点注入 storePath/planPath 会带这两个键，若不剥离，校验器会把它们
 *   判成「未知字段」⇒ 整区被拒 —— 那是接线层制造出来的假缺陷。
 *   ★只剥这两个已知的引擎侧字段：模型草案里任何**其它**未知字段仍原样交给校验器拒掉，
 *     不静默放行（fail-closed 的口子只开给引擎自己的定位参数）。
 */
function validatorDraftOfPre(zone) {
  const out = {}
  const src = zone && typeof zone === 'object' ? zone : {}
  for (const k of Object.keys(src)) if (k !== 'storePath' && k !== 'planPath') out[k] = src[k]
  return out
}

/** 区路径解析（允许 zone/opts 显式覆盖，便于套件与引擎定点） */
function zonePathsPre(zone, o) {
  const wsPath = String((zone && zone.wsPath) || '')
  const storePath = String((zone && zone.storePath) || o.storePath || (wsPath ? path.join(wsPath, 'handoff', EVENT_STORE_FILENAME) : ''))
  const planPath = String((zone && zone.planPath) || o.planPath || (wsPath ? path.join(wsPath, 'handoff', PLAN_FILENAME) : ''))
  return { storePath, planPath }
}

/**
 * 回滚一个区：store 走既有 rollbackFromSnapshotPre；PLAN 只在**本次确实写过**时回滚。
 * @returns {{ok:boolean, store:string, plan:string, errors:string[]}}
 */
async function rollbackZonePre({ storePath, planPath, snap, planSnap, planWritten }) {
  const res = { ok: true, store: 'noop', plan: 'noop', errors: [] }
  if (snap && snap.file) {
    try {
      const r = await rollbackFromSnapshotPre({ storePath, backupFile: snap.file })
      if (r && r.ok) res.store = 'restored'
      else { res.ok = false; res.store = 'failed'; res.errors.push(String((r && r.error) || 'rollback failed')) }
    } catch (e) { res.ok = false; res.store = 'failed'; res.errors.push(String((e && e.message) || e)) }
  } else if (snap && snap.skipped === 'store-not-exist') {
    try {
      await unlink(storePath)
      res.store = 'removed'
    } catch (e) {
      if (e && e.code !== 'ENOENT') { res.ok = false; res.store = 'failed'; res.errors.push(String((e && e.message) || e)) }
      else res.store = 'absent'
    }
  }
  if (planWritten) {
    try {
      if (planSnap && planSnap.file) { await copyFile(planSnap.file, planPath); res.plan = 'restored' }
      else {
        try { await unlink(planPath); res.plan = 'removed' } catch (e) { if (e && e.code !== 'ENOENT') throw e; res.plan = 'absent' }
      }
    } catch (e) { res.ok = false; res.plan = 'failed'; res.errors.push(String((e && e.message) || e)) }
  }
  return res
}

/**
 * 处理一个工作区。**任何一步失败都返回 ok:false（被调用方继续下一区）**，从不向上抛。
 * @returns {Promise<object>} 回执（含 wsKey/events/ckpts/planBytes/sha256 五个硬字段）
 */
async function applyZonePre({ zone, runId, dryRun, now, backupRoot, validator, opts: o }) {
  const receipt = {
    schema: UPGRADE_APPLY_SCHEMA,
    wsKey: String((zone && zone.wsKey) || ''),
    wsPath: String((zone && zone.wsPath) || ''),
    runId,
    ok: false,
    dryRun: !!dryRun,
    applied: false,
    events: 0,
    ckpts: 0,
    planBytes: 0,
    sha256: null,
    sha256Before: null,
    eventsTotalBefore: 0,
    eventsTotalAfter: 0,
    skipped: [],
    validatorSource: validator.source,
    code: 'ok',
  }
  const { storePath, planPath } = zonePathsPre(zone, o)
  receipt.storePath = storePath
  receipt.planPath = planPath
  const handoffDir = path.dirname(planPath)
  let snap = null
  let planSnap = null
  let planWritten = false

  const done = () => receipt
  const failZone = (code, message, extra) => {
    receipt.ok = false
    receipt.code = String(code)
    receipt.error = String(message || code)
    if (extra && typeof extra === 'object') Object.assign(receipt, extra)
    return receipt
  }

  try {
    if (!receipt.wsKey) return failZone('missing-wsKey', '草案区缺少 wsKey')
    if (!storePath) return failZone('missing-storePath', '草案区缺少 wsPath / storePath')
    if (!planPath) return failZone('missing-planPath', '草案区缺少 wsPath / planPath')

    // ① 读现状（给出 sha 前后对照的「前」）
    let store0
    try { store0 = await readStorePre(storePath) } catch (e) {
      return failZone('store-read-failed', '读事件库失败（可能损坏）：' + String((e && e.message) || e).slice(0, 200))
    }
    receipt.sha256Before = await sha256FilePre(storePath)
    receipt.sha256 = receipt.sha256Before
    receipt.eventsTotalBefore = asArray(store0.events).length

    // ② 快照先行（dryRun 不备份：只检测不写盘，§3.8）
    if (!dryRun) {
      if (!backupRoot) return failZone('no-backup-root', '缺少 opts.backupRoot（写盘前必须先能备份）')
      const backupDir = path.join(String(backupRoot), receipt.wsKey, String(now))
      receipt.backupDir = backupDir
      try {
        snap = await snapshotStorePre({ storePath, backupDir, now, maxBackups: o.maxBackups })
      } catch (e) {
        return failZone('snapshot-failed', '快照失败，已中止写盘（不留半成品）：' + String((e && e.message) || e).slice(0, 200))
      }
      try {
        planSnap = await snapshotPlanPre(planPath, backupDir)
      } catch (e) {
        return failZone('snapshot-failed', '白板快照失败，已中止写盘：' + String((e && e.message) || e).slice(0, 200))
      }
      if (snap && snap.skipped) receipt.storeSnapshot = snap.skipped
    }

    // ③ 校验（闸 1–7）：逐区、独立；不过 ⇒ 回滚点（此时通常无事可回滚）+ 标 failed
    const files = await collectDraftFilesPre({ zone, wsPath: receipt.wsPath, opts: o })
    const logCount = await countLogsPre(receipt.wsPath)
    let vres
    try {
      // ★刻意**不**把 existingEventNames / existingIdemKeys 传给校验器（P1 闸 6 支持它们）：
      //   闸 6 对「与既有事件重名」的处置是**拒或跳过**；若交给校验器，重复 apply 会退化成
      //   「整区 validate-failed」，幂等语义就没了（任务要求「重复 apply ⇒ 事件数不变」而非报错）。
      //   ⇒ 既有事件去重由本模块的 buildCreatePlanPre 负责（标 skipped、不写盘），校验器只管草案自身质量。
      vres = await validator.fn(validatorDraftOfPre(zone), {
        manifest: o.manifest || null,
        files,
        wsKey: receipt.wsKey,
        wsPath: receipt.wsPath,
        runId,
        logCount,
        selfCheck: (zone && zone.selfCheck) || null,
      })
    } catch (e) {
      const rb = await rollbackZonePre({ storePath, planPath, snap, planSnap, planWritten })
      return failZone('validator-threw', '校验器抛错：' + String((e && e.message) || e).slice(0, 300), { rolledBack: rb.ok, rollback: rb })
    }
    const vnorm = normalizeValidatorResultPre(vres)
    receipt.validation = { ok: vnorm.ok, code: vnorm.code, errors: vnorm.errors.slice(0, 20) }
    if (!vnorm.ok) {
      const rb = await rollbackZonePre({ storePath, planPath, snap, planSnap, planWritten })
      return failZone('validate-failed', '草案未通过闸门：' + (vnorm.errors[0] || vnorm.code), { rolledBack: rb.ok, rollback: rb })
    }

    // ④ 幂等预判：全部命重 ⇒ 不写盘（重复 apply 不产生任何字节变化）
    const preview = buildCreatePlanPre({ zone, store: store0, runId, wsKey: receipt.wsKey, now })
    receipt.skipped = preview.skipped
    if (!preview.toCreate.length) {
      receipt.ok = true
      receipt.applied = false
      receipt.code = 'already-applied'
      receipt.planBytes = await planFileBytesPre(planPath)
      return done()
    }

    // ④-b dry-run（「只检测不整理」，§3.8）：只校验 + 渲染预览，**零写盘**
    if (dryRun) {
      let planBytes = 0
      let planSha = null
      if (o.renderPlan !== false) {
        const planText = renderPlanFromEventsPre(asArray(store0.events).concat(preview.toCreate), { wsName: receipt.wsKey, now })
        const dg = checkPlanRenderGatePre(planText)
        if (!dg.ok) return failZone('plan-gate-failed', '闸 8 白板渲染门未过：' + dg.code)
        planBytes = Buffer.byteLength(planText, 'utf8')
        planSha = sha256TextPre(planText)
      }
      receipt.ok = true
      receipt.dryRun = true
      receipt.applied = false
      receipt.code = 'dry-run'
      receipt.events = preview.toCreate.length
      receipt.ckpts = preview.toCreate.reduce((n, ev) => n + asArray(ev.checkpoints).length, 0)
      receipt.planBytes = planBytes
      receipt.planSha256 = planSha
      receipt.sha256 = receipt.sha256Before
      receipt.eventsTotalAfter = receipt.eventsTotalBefore
      return done()
    }

    // ⑤ 原子写事件库（writeStorePre + 库锁；锁内重读重算，防并发交错）
    let writeRes
    try {
      writeRes = await withEventStoreLockPre(storePath, async () => {
        const store = await readStorePre(storePath)
        const built = buildCreatePlanPre({ zone, store, runId, wsKey: receipt.wsKey, now })
        if (!built.toCreate.length) return { ok: true, noop: true, store, created: [], skipped: built.skipped }
        for (const ev of built.toCreate) {
          const bad = validateEventPre(ev)
          if (bad.length) throw failPre('event-invalid', '本次新建事件未过校验：' + ev.name + ' ' + bad.join(','))
        }
        const next = Object.assign({}, store, { events: asArray(store.events).concat(built.toCreate) })
        await writeStorePre(storePath, next)
        return { ok: true, noop: false, store: next, created: built.toCreate, skipped: built.skipped }
      })
    } catch (e) {
      const rb = await rollbackZonePre({ storePath, planPath, snap, planSnap, planWritten })
      return failZone('write-failed', '事件库写入失败：' + String((e && e.message) || e).slice(0, 300), { rolledBack: rb.ok, rollback: rb })
    }
    receipt.skipped = writeRes.skipped || []
    if (writeRes.noop) {
      receipt.ok = true
      receipt.applied = false
      receipt.code = 'already-applied'
      receipt.sha256 = await sha256FilePre(storePath)
      receipt.eventsTotalAfter = asArray(writeRes.store.events).length
      receipt.planBytes = await planFileBytesPre(planPath)
      return done()
    }

    // ⑥ 渲染白板（闸 8）+ 归档旧白板 + 原子写
    const eventsForPlan = asArray(writeRes.store.events)
    if (o.renderPlan !== false) {
      let planText = ''
      try {
        planText = renderPlanFromEventsPre(eventsForPlan, { wsName: receipt.wsKey, now })
      } catch (e) {
        const rb = await rollbackZonePre({ storePath, planPath, snap, planSnap, planWritten })
        return failZone('plan-render-failed', '白板渲染失败：' + String((e && e.message) || e).slice(0, 300), { rolledBack: rb.ok, rollback: rb })
      }
      const gate = checkPlanRenderGatePre(planText)
      if (!gate.ok) {
        const rb = await rollbackZonePre({ storePath, planPath, snap, planSnap, planWritten })
        return failZone('plan-gate-failed', '闸 8 白板渲染门未过：' + gate.code + (gate.missing ? '（缺节：' + gate.missing.join('、') + '）' : ''), { rolledBack: rb.ok, rollback: rb })
      }
      // 旧白板逐字节归档并读回校验（M1 保护：旧锚点不丢）
      let oldPlan = null
      try { oldPlan = await readFile(planPath, 'utf8') } catch (e) { if (e && e.code !== 'ENOENT') throw e }
      const oldAnchors = planAnchorsPre(oldPlan || '')
      if (oldPlan && oldPlan.trim()) {
        let arch = null
        try {
          arch = await archivePlanPre(handoffDir, oldPlan, now)
          const back = await readFile(arch.file, 'utf8')
          if (sha256TextPre(back) !== sha256TextPre(oldPlan)) throw failPre('plan-archive-mismatch', '归档白板读回不一致')
          if (planAnchorsPre(back).length !== oldAnchors.length) throw failPre('plan-archive-anchor-loss', '归档白板锚点数不一致')
        } catch (e) {
          const rb = await rollbackZonePre({ storePath, planPath, snap, planSnap, planWritten })
          return failZone('plan-archive-failed', '闸 8 旧白板归档失败：' + String((e && e.message) || e).slice(0, 300), { rolledBack: rb.ok, rollback: rb })
        }
        receipt.archivedPlan = {
          file: path.relative(handoffDir, arch.file),
          sha256: sha256TextPre(oldPlan),
          anchors: oldAnchors.length,
        }
      }
      // 写新白板（可注入；注入返回 {ok:false} 或抛错都算失败 ⇒ 回滚）
      const writePlan = typeof o.writePlanFn === 'function' ? o.writePlanFn : writePlanAtomicPre
      try {
        const wr = await writePlan({ planPath, text: planText, wsKey: receipt.wsKey, runId })
        if (wr && typeof wr === 'object' && wr.ok === false) throw failPre('plan-write-failed', String(wr.error || '白板写入被拒'))
        planWritten = true
        const back = await readFile(planPath, 'utf8')
        if (back !== planText) throw failPre('plan-readback-mismatch', '白板读回与渲染文本不一致')
      } catch (e) {
        const rb = await rollbackZonePre({ storePath, planPath, snap, planSnap, planWritten: planWritten === true })
        planWritten = false
        return failZone('plan-write-failed', '白板写入失败：' + String((e && e.message) || e).slice(0, 300), { rolledBack: rb.ok, rollback: rb })
      }
      receipt.planBytes = Buffer.byteLength(planText, 'utf8')
      receipt.planSha256 = sha256TextPre(planText)
    }

    // ⑦ 回执
    receipt.ok = true
    receipt.applied = true
    receipt.events = asArray(writeRes.created).length
    receipt.ckpts = asArray(writeRes.created).reduce((n, ev) => n + asArray(ev.checkpoints).length, 0)
    receipt.eventsTotalAfter = asArray(writeRes.store.events).length
    receipt.sha256 = await sha256FilePre(storePath)
    return done()
  } catch (e) {
    // 兜底：任何未预期异常也必须整区回滚，绝不把半成品留在盘上
    let rb = { ok: false, error: String((e && e.message) || e) }
    try { rb = await rollbackZonePre({ storePath, planPath, snap, planSnap, planWritten }) } catch (e2) { rb = { ok: false, error: String((e2 && e2.message) || e2) } }
    return failZone(String((e && e.code) || 'zone-failed'), String((e && e.message) || e).slice(0, 300), { rolledBack: rb.ok, rollback: rb })
  }
}

/** 读白板字节数（不存在 ⇒ 0） */
async function planFileBytesPre(planPath) {
  try { return Buffer.byteLength(await readFile(planPath, 'utf8'), 'utf8') } catch (e) {
    if (e && e.code === 'ENOENT') return 0
    return 0
  }
}

/** 草案归一：支持 {workspaces:[...]} 批形态，也支持单区直给（{wsKey, wsPath, events}） */
export function normalizeDraftPre(draft) {
  const d = draft && typeof draft === 'object' && !Array.isArray(draft) ? draft : null
  if (!d) return { runId: '', zones: [], code: 'draft-not-object' }
  const list = Array.isArray(d.workspaces) ? d.workspaces
    : Array.isArray(d.zones) ? d.zones
    : (d.wsKey || d.wsPath) ? [d]
    : []
  const zones = list.map((z) => {
    const src = z && typeof z === 'object' ? z : {}
    return Object.assign({}, src, {
      wsKey: String(src.wsKey || src.workspaceKey || ''),
      wsPath: String(src.wsPath || src.workspace || src.path || ''),
      events: Array.isArray(src.events) ? src.events : [],
    })
  })
  return { runId: String(d.runId || ''), zones, code: zones.length ? 'ok' : 'no-workspaces', raw: d }
}

/**
 * ★P2 主入口：逐区处理草案（快照 → 校验 → 原子写 → 渲染 → 回执/回滚）。
 *
 * @param {object} draft 批草案 | 单区草案
 * @param {object} opts
 * @param {string} [opts.backupRoot] **写盘时必填**：快照根，实际落 <backupRoot>/<wsKey>/<ts>/
 * @param {string} [opts.runId]    批 id（幂等键的一半；缺省取 draft.runId）
 * @param {boolean} [opts.dryRun]  只校验不写盘（回执带 dryRun:true）
 * @param {number} [opts.now]      固定时钟（套件可复算 sha）
 * @param {object} [opts.manifest] 透传给校验器（闸 3 的文件白名单）
 * @param {object} [opts.files]    透传给校验器（rel→content；缺省按草案 rel 真实读盘）
 * @param {Function} [opts.validate] 注入校验器（覆盖动态并联；测试/引擎可用）
 * @param {boolean} [opts.renderPlan=true] false ⇒ 只写事件库、不渲染白板
 * @param {Function} [opts.writePlanFn] 注入白板写入（测试故障注入 / 引擎接管）
 * @returns {Promise<{ok:boolean, runId:string, dryRun:boolean, workspaces:object[], summary:{total:number,ok:number,failed:number}, validatorSource?:string, code?:string}>}
 */
export async function applyUpgradeDraftPre(draft, opts = {}) {
  const o = opts && typeof opts === 'object' ? opts : {}
  const norm = normalizeDraftPre(draft)
  const runId = String(o.runId || norm.runId || '')
  const dryRun = o.dryRun === true
  const now = Number(o.now) > 0 ? Number(o.now) : Date.now()
  const validator = await resolveValidatorPre(o)

  if (!norm.zones.length) {
    return {
      ok: false, code: norm.code || 'no-workspaces', error: '草案里没有任何工作区（既非 workspaces[] 也未给 wsKey）',
      runId, dryRun, workspaces: [], summary: { total: 0, ok: 0, failed: 0 }, validatorSource: validator.source,
    }
  }
  if (!dryRun && !String(o.backupRoot || '')) {
    return {
      ok: false, code: 'no-backup-root', error: '缺少 opts.backupRoot：写盘前必须先能备份（拒绝无备份写盘）',
      runId, dryRun, workspaces: [], summary: { total: norm.zones.length, ok: 0, failed: norm.zones.length }, validatorSource: validator.source,
    }
  }

  const receipts = []
  for (const zone of norm.zones) {
    // 逐区独立：某一区抛错（含本函数未预期异常）也只影响该区
    try {
      receipts.push(await applyZonePre({ zone, runId, dryRun, now, backupRoot: o.backupRoot, validator, opts: o }))
    } catch (e) {
      receipts.push({
        schema: UPGRADE_APPLY_SCHEMA, wsKey: zone.wsKey, wsPath: zone.wsPath, runId, ok: false, dryRun,
        applied: false, events: 0, ckpts: 0, planBytes: 0, sha256: null,
        code: 'zone-crashed', error: String((e && e.message) || e).slice(0, 300), skipped: [],
        validatorSource: validator.source,
      })
    }
  }
  const failed = receipts.filter((r) => !r.ok).length
  return {
    ok: failed === 0,
    runId,
    dryRun,
    workspaces: receipts,
    summary: { total: receipts.length, ok: receipts.length - failed, failed },
    validatorSource: validator.source,
  }
}

export default {
  UPGRADE_APPLY_SCHEMA,
  PLAN_FILENAME,
  PLAN_ARCHIVE_DIRNAME,
  DRAFT_EVENT_FIELDS,
  sha256FilePre,
  planAnchorsPre,
  checkPlanRenderGatePre,
  normalizeValidatorResultPre,
  fallbackValidateDraftPre,
  resetValidatorCachePre,
  draftIdemTagPre,
  draftEventToStoreEventPre,
  buildCreatePlanPre,
  normalizeDraftPre,
  applyUpgradeDraftPre,
}

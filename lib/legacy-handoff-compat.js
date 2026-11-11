/**
 * 旧账本兼容模块（R4 P6/P7 A1-b · 2026-11-12）
 *
 * 职责边界（与 R4-LEGACY-COMPAT-API-20261112.md 一一对应）：
 *   · 只服务**旧时间戳快照** `handoff-<YYYYMMDD>-<HHMMSS>[-a-z].md` 的读取、枚举与格式适配；
 *   · 受控旧写入 writeLegacyLedger 必须**显式**调用，且只**薄转发**给 engine.writeHandoffLedger，
 *     保护门 / CAS / 锁 / sidecar / 原子写一律复用现行实现，**本模块不复制任何一份**；
 *   · 新维护文档（`handoff/documents/<documentId>.md`）走 LedgerDocSystem，**不经本模块**；
 *     本模块的任何返回值都不含、不拼、不推断 R4 文档内容（不把新路径拼进 legacy 结果）。
 *
 * 排序口径：与现行 `readLatestHandoff` 逐字一致 —— mtime 优先，同 mtime 按 order 降序；
 *          order = `<YYYYMMDD>-<HHMMSS>-<suffix||a>`（字典序即时间序）。
 * 错误区分：name 不合法 / 不存在 / 读取失败 三类分开返回，不合并成空串。
 */

import { readdir, readFile, stat } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import path from 'node:path'

/** 旧账本文件名（与 lib/index.js 现行正则逐字一致）。 */
export const LEGACY_LEDGER_RE = /^handoff-\d{8}-\d{6}(-[a-z])?\.md$/
const LEGACY_ORDER_RE = /^handoff-(\d{8}-\d{6})(?:-([a-z]))?\.md$/

/** 旧账本排序键：`YYYYMMDD-HHMMSS-<suffix||a>`。非旧账本名返回 null。 */
export function legacyOrderKeyPre(name) {
  const m = LEGACY_ORDER_RE.exec(String(name || ''))
  if (!m) return null
  return m[1] + '-' + (m[2] || 'a')
}

/** 是否旧账本文件名。 */
export function isLegacyLedgerNamePre(name) {
  return LEGACY_LEDGER_RE.test(String(name || ''))
}

function sha256Of(buf) { return createHash('sha256').update(buf).digest('hex') }

/**
 * 枚举旧账本。**只列**旧时间戳文件，不把 documents/ 或 PLAN.md 混进来。
 * @returns {{ok:boolean, handoffDir:string, items:Array<{name:string,order:string,mtimeMs:number,bytes:number}>, readErrors:Array, state:'present'|'empty'|'missing'|'error'}}
 */
export async function listLegacyLedgers(args = {}) {
  const handoffDir = String(args.handoffDir || '')
  const items = []
  const readErrors = []
  if (!handoffDir) return { ok: false, handoffDir, items, readErrors: [{ source: 'legacy', code: 'handoff-dir-required', message: 'handoffDir required' }], state: 'error' }
  let names
  try { names = (await readdir(handoffDir)).filter((n) => LEGACY_LEDGER_RE.test(n)) }
  catch (error) {
    if (error && error.code === 'ENOENT') return { ok: true, handoffDir, items, readErrors, state: 'missing' }
    readErrors.push({ source: 'legacy', code: 'legacy-list-failed', message: String((error && error.message) || error).slice(0, 160) })
    return { ok: false, handoffDir, items, readErrors, state: 'error' }
  }
  for (const name of names) {
    try {
      const st = await stat(path.join(handoffDir, name))
      if (!st.isFile()) { readErrors.push({ source: 'legacy/' + name, code: 'legacy-not-a-file', message: 'not a regular file' }); continue }
      items.push({ name, order: legacyOrderKeyPre(name), mtimeMs: Number(st.mtimeMs) || 0, bytes: Number(st.size) || 0 })
    } catch (error) {
      readErrors.push({ source: 'legacy/' + name, code: 'legacy-stat-failed', message: String((error && error.message) || error).slice(0, 160) })
    }
  }
  items.sort((a, b) => (b.mtimeMs - a.mtimeMs) || (a.order < b.order ? 1 : a.order > b.order ? -1 : 0))
  return { ok: readErrors.length === 0, handoffDir, items, readErrors, state: items.length ? 'present' : 'empty' }
}

/**
 * 读单个旧账本。三类错误分开：`legacy-name-invalid` / `legacy-not-found` / `legacy-read-failed`。
 * 原文逐字节返回，不做任何改写（不改行尾、不注入锚点、不拼 R4 内容）。
 */
export async function readLegacyLedger(args = {}) {
  const handoffDir = String(args.handoffDir || '')
  const name = String(args.name || '')
  if (!handoffDir) return { ok: false, error: 'handoff-dir-required' }
  if (!LEGACY_LEDGER_RE.test(name)) return { ok: false, error: 'legacy-name-invalid', name }
  try {
    const buf = await readFile(path.join(handoffDir, name))
    const st = await stat(path.join(handoffDir, name)).catch(() => null)
    return { ok: true, name, text: buf.toString('utf8'), bytes: buf.length, sha256: sha256Of(buf), mtimeMs: st ? Number(st.mtimeMs) || 0 : 0, order: legacyOrderKeyPre(name) }
  } catch (error) {
    const code = String((error && error.code) || '')
    if (code === 'ENOENT') return { ok: false, error: 'legacy-not-found', name }
    return { ok: false, error: 'legacy-read-failed', name, cause: String((error && error.message) || error).slice(0, 160) }
  }
}

/**
 * 读最新旧账本 —— 与现行 engine.readLatestHandoff **同口径**（mtime 优先，同 mtime 按 order 降序）。
 * 与旧实现的差别只在**返回值**：旧实现读不到就返回空串（无法区分「没有」与「读坏了」），
 * 这里显式区分 state 与错误；调用方要兼容旧行为可用 `.text || ''`。
 */
export async function readLatestLegacyLedger(args = {}) {
  const listed = await listLegacyLedgers(args)
  if (!listed.ok && listed.state !== 'empty') return { ok: false, error: 'legacy-list-failed', state: listed.state, readErrors: listed.readErrors }
  if (!listed.items.length) return { ok: true, name: null, order: null, text: '', bytes: 0, state: listed.state }
  const top = listed.items[0]
  const read = await readLegacyLedger({ handoffDir: listed.handoffDir, name: top.name })
  if (!read.ok) return { ok: false, error: read.error, name: top.name, cause: read.cause || null, state: listed.state }
  return { ok: true, name: read.name, order: read.order, text: read.text, bytes: read.bytes, sha256: read.sha256, mtimeMs: read.mtimeMs, state: listed.state }
}

const QUAD_TITLES = ['任务状态', '目标', '已试方案与失败原因', '进度与下一步']

/**
 * 旧账本格式适配（只**解析**旧格式，不产出 R4 结构、不写任何东西）。
 * 返回 title / sections(按四段标题切) / quad(四段文本) / lineCount；缺段置空串，不抛。
 */
export function adaptLegacyLedger(text) {
  const raw = String(text == null ? '' : text)
  const lines = raw.split(/\r?\n/)
  let title = ''
  const sections = []
  let current = null
  for (const line of lines) {
    const h1 = /^#\s+(.+)$/.exec(line)
    if (h1 && !title) { title = h1[1].trim(); continue }
    const h2 = /^##\s+(.+)$/.exec(line)
    if (h2) { current = { heading: h2[1].trim(), body: [] }; sections.push(current); continue }
    if (current) current.body.push(line)
  }
  const quad = {}
  for (const name of QUAD_TITLES) {
    const hit = sections.find((s) => s.heading === name)
    quad[name] = hit ? hit.body.join('\n').trim() : ''
  }
  return {
    title,
    sections: sections.map((s) => ({ heading: s.heading, body: s.body.join('\n').trim() })),
    quad,
    lineCount: lines.length,
    bytes: Buffer.byteLength(raw, 'utf8'),
    quadComplete: QUAD_TITLES.every((n) => quad[n] !== ''),
  }
}

/**
 * 受控旧写入。**只允许显式兼容调用**：缺 `explicit:true` 一律拒绝，且给出迁移指引。
 * 薄转发给 engine.writeHandoffLedger —— 判据门 / 共同保护门 / 锚点 / sidecar / 原子写全部复用现行实现。
 * 本函数**不**新开事务、不复制 CAS、不改写内容。
 */
export async function writeLegacyLedger(args = {}) {
  const engine = args.engine
  const projectDir = String(args.projectDir || '')
  // 顺序有意：**先判显式性**再判 engine —— 这样即使调用方没传 engine，也能拿到迁移指引，
  // 而不是一个只有内部人才看得懂的 legacy-write-engine-invalid。
  if (args.explicit !== true) {
    return {
      ok: false,
      error: 'legacy-write-requires-explicit-call',
      hint: '默认写入已退出：新维护文档请走 memory_note(kind=handoff, documentId=...) 或 LedgerDocSystem.upsertDocument；本函数只服务显式兼容调用（explicit:true）。',
    }
  }
  if (!engine || typeof engine.writeHandoffLedger !== 'function') return { ok: false, error: 'legacy-write-engine-invalid' }
  if (!projectDir) return { ok: false, error: 'legacy-write-project-dir-required' }
  const r = await engine.writeHandoffLedger(projectDir, args.content, args.opts)
  return { ...(r || {}), via: 'legacy-handoff-compat' }
}

export const LEGACY_COMPAT_SCHEMA = 'r4-legacy-handoff-compat-v1'
export const LEGACY_QUAD_TITLES = Object.freeze(QUAD_TITLES.slice())

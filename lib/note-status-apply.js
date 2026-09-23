/**
 * 结论层状态 · **条目级应用**（G3 写盘的核心纯函数）
 *
 * 职责：把一条 `status` 落到**指定 memoryId 的条目正文末尾**，返回**新文本**（不写盘）。
 * 与 `note-status.js` 的分工：
 *   - `note-status.js` = 状态行的**语法**（渲染/解析/剥离）
 *   - 本模块            = 状态行的**定位与落点**（在文件里找到那条、放到末尾）
 *
 * ── 与既有写入通道的关系（重要）───────────────────────────────
 * 本模块**不代替** `memory-writer` 事务写入，只产出**新全文**；
 * 落盘仍由调用方走既有通道（备份/校验/无 BOM 等纪律不绕过）。
 *
 * ── 为什么必须「只动目标条目」─────────────────────────────────
 * MEMORY.md 是**用户可见的明文**且 25+ 锚点共存。任何"顺手重排/格式化"都会：
 *   ① 让无关条目的 `recordDigest` 变化 ⇒ sidecar sourceVersion 无谓 +1 ⇒ 全量缓存失效；
 *   ② 制造巨大的 diff，用户在 GUI 里看不出"到底改了什么"。
 * ⇒ 契约：**除目标条目的状态行外，逐字节保持原样**（含 CRLF 行尾）。
 *
 * 纪律：纯函数、零 IO、fail-soft（不改动即返回 null，绝不返回半成品文本）。
 */
import { NOTE_STATUS_OPEN_PRE_V1, renderStatusLinePre, stripStatusLinePre, statusOfBodyPre } from './note-status.js'

/** 锚点：与 `l0-extract.js` / `memory-anchor.js` 同形态（此处独立声明，避免耦合）。 */
const ANCHOR_RE = /<!--\s*memory:(mem_[0-9a-f]{32})\s*-->/g

/**
 * 定位一条条目在原文中的**正文区间**。
 *
 * 语义与 `parseMemoryItemsPre` 一致：anchor marker **其后**的内容归该条，
 * 直到**下一个** marker 之前（或文件末尾）。
 *
 * @param {string} text 文件全文
 * @param {string} memoryId
 * @returns {{start:number, end:number, id:string}|null} 正文的 [start,end) 字符区间
 */
export function locateRecordBodyPre(text, memoryId) {
  try {
    const src = String(text == null ? '' : text)
    if (!src || !/^mem_[0-9a-f]{32}$/.test(String(memoryId || ''))) return null
    ANCHOR_RE.lastIndex = 0
    const marks = []
    let m
    while ((m = ANCHOR_RE.exec(src)) !== null) {
      // 同时记录 marker 的**真实**起止（不重建字符串 —— 锚点允许空白浮动）
      marks.push({ id: m[1], start: m.index, end: m.index + m[0].length })
      if (m.index === ANCHOR_RE.lastIndex) ANCHOR_RE.lastIndex++
    }
    for (let i = 0; i < marks.length; i++) {
      if (marks[i].id !== memoryId) continue
      const start = marks[i].end
      // 正文止于**下一个 marker 的起始**（该 marker 及其后内容不属于本条）
      const end = i + 1 < marks.length ? marks[i + 1].start : src.length
      return { start, end, id: memoryId }
    }
    return null
  } catch (_) { return null }
}

/**
 * ★ 主函数：给指定条目应用状态，返回**新全文**。
 *
 * 行为契约：
 *   - 目标不存在 ⇒ `null`（**fail-soft**：绝不凭空创建条目）
 *   - `status === 'current'` ⇒ **剥掉**既有状态行（撤销通道；正文其余不变）
 *   - 已是目标状态且 reason/by 未变 ⇒ 返回**原文**（幂等，调用方可据此跳过写盘）
 *   - 其余 ⇒ 剥旧状态行 + 在**正文末尾**追加新状态行
 *   - **行尾风格沿用原文件**（CRLF 保持 CRLF；本仓文件全 CRLF）
 *   - 任何异常 ⇒ `null`（绝不返回半成品）
 *
 * @param {string} text 文件全文
 * @param {string} memoryId 目标条目
 * @param {string} status current | superseded | retracted
 * @param {{supersededBy?:string, reason?:string}} [opts]
 * @returns {string|null} 新全文；不可应用时为 null
 */
export function applyStatusToRecordPre(text, memoryId, status, opts = {}) {
  try {
    const src = String(text == null ? '' : text)
    if (!src) return null
    const loc = locateRecordBodyPre(src, memoryId)
    if (!loc) return null

    const seg = src.slice(loc.start, loc.end)
    // CRLF 感知：本仓文件全 CRLF，必须沿用，否则整文件 diff 爆炸
    const eol = seg.includes('\r\n') ? '\r\n' : '\n'

    // 先把段落按当前 EOL 归一化切分，处理后再拼回
    const bodyClean = stripStatusLinePre(seg)
    const trimmed = bodyClean.replace(/[\r\n\s]+$/, '')

    const line = renderStatusLinePre(status, opts)
    let next = line ? trimmed + eol + line + eol : (trimmed ? trimmed + eol : '')
    // 段落与下一个 marker 之间保留一个空行（与既有文件形态一致）
    next = next ? next + eol : next

    const out = src.slice(0, loc.start) + next + src.slice(loc.end)
    // 幂等：无变化 ⇒ 返回原文（调用方可据此跳过写盘，避免无谓 sourceVersion +1）
    return out === src ? src : out
  } catch (_) { return null }
}

/**
 * 只读查询：某条目当前状态（供接线侧判断是否需要写）。
 * 与 `statusOfBodyPre` 同源，此处补上「文件级」定位。
 *
 * @returns {{status:string, supersededBy?:string, reason?:string}|null} 条目不存在 ⇒ null
 */
export function readRecordStatusPre(text, memoryId) {
  try {
    const src = String(text == null ? '' : text)
    const loc = locateRecordBodyPre(src, memoryId)
    if (!loc) return null
    return statusOfBodyPre(src.slice(loc.start, loc.end))
  } catch (_) { return null }
}

/** 供反向锁使用：确认本模块**不碰锚点语法**。 */
export const NOTE_STATUS_MARKER_PRE_V1 = NOTE_STATUS_OPEN_PRE_V1

/**
 * evidence-agg-pre —— evidence 事件 → 聚合 → importance 输入契约(M8-2b, 2026-09-09)。
 *
 * 管道:evidence/events/*.jsonl(写入侧 context-bridge-pre,只读)→ 有界扫描 →
 * 按 memoryId 聚合六类计数 + distinctSessions → 交给 memory-importance-pre.computeImportancePre
 * → 作为 recall() L0 融合的加权因子之一(P8 融合入口)。
 *
 * 契约:
 *   - 纯函数 + IO 注入(io = { listFiles(), readFile(name) }),模块零内置 IO、零写入。
 *   - 有界读取:文件名日期在窗口内(默认近 7 天)且每文件只取末 N 行(默认 400),绝不全量扫描历史。
 *     文件名约定 YYYY-MM-DD.jsonl(EvidenceEventStore 落盘惯例,实测样本确认);无法解析日期的文件跳过(确定性)。
 *   - 事件行结构(实测 2026-09-09.jsonl 确认):kind/memoryId 在顶层,会话= event.sessionRef,时间= event.ts。
 *   - 聚合输出形状 = memory-importance-pre.computeImportancePre 的输入契约(以其源码为准,不另立)。
 *   - fail-soft:行损坏跳过;io 抛错由调用方处理(模块内不吞 IO 异常——io 是注入的,调用方决定降级)。
 */

export const EVIDENCE_AGG_VERSION = 'evidence_agg_v1'

/** 有界读取默认值。 */
export const EVIDENCE_AGG_DEFAULTS_V1 = Object.freeze({
  maxAgeDays: 7, // 文件名日期距 now 的最大天数
  maxLinesPerFile: 400, // 每文件末 N 行(沿用 index.js 证据读取范式 slice(-400))
})

const KINDS = ['seen', 'read', 'cite', 'reuse', 'success', 'correction']

/**
 * 有界扫描 evidence 事件(只读)。io 注入;文件按名字日期过滤 + 每文件末 N 行。
 * @param {{listFiles:Function, readFile:Function}} io listFiles()→文件名数组;readFile(name)→全文
 * @param {{maxAgeDays?:number, maxLinesPerFile?:number, now?:Function}} opts
 * @returns {Array<object>} 解析后的事件对象(损坏行跳过;任何字段缺失由聚合层兜底)
 */
export function scanEvidenceEventsPre(io, opts = {}) {
  const d = Object.assign({}, EVIDENCE_AGG_DEFAULTS_V1, opts)
  const now = d.now || Date.now
  const files = (io.listFiles() || []).slice().sort()
  const cutoff = now() - d.maxAgeDays * 86400000
  const out = []
  for (const name of files) {
    const m = /^(\d{4})-(\d{2})-(\d{2})\.jsonl$/.exec(String(name))
    if (!m) continue // 非日期命名 → 跳过(确定性;不做全量兜底)
    const fileTs = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 23, 59, 59)
    if (fileTs < cutoff) continue
    const lines = String(io.readFile(name) || '').split('\n').filter(Boolean)
    for (const ln of lines.slice(-d.maxLinesPerFile)) {
      try { out.push(JSON.parse(ln)) } catch (_) {}
    }
  }
  return out
}

/**
 * 按 memoryId 聚合六类计数与去重会话数。输出形状 = computeImportancePre 的输入契约。
 * @param {Array<{kind?:string, memoryId?:string, event?:{sessionRef?:string}, sessionRef?:string}>} events
 * @returns {Map<string, {distinctSessions:number, seen:number, read:number, cite:number, reuse:number, success:number, correction:number}>}
 */
export function aggregateEvidenceEventsPre(events) {
  const list = Array.isArray(events) ? events : []
  const byId = new Map()
  for (const e of list) {
    if (!e || typeof e.memoryId !== 'string' || !e.memoryId) continue
    const kind = e.kind
    if (!KINDS.includes(kind)) continue // 非六类事件不计数(与 evidenceFor 口径一致)
    let agg = byId.get(e.memoryId)
    if (!agg) {
      agg = { distinctSessions: 0, seen: 0, read: 0, cite: 0, reuse: 0, success: 0, correction: 0 }
      byId.set(e.memoryId, agg)
    }
    agg[kind]++
    const sessionRef = (e.event && e.event.sessionRef) || e.sessionRef
    if (sessionRef) {
      if (!agg._sessions) agg._sessions = new Set()
      agg._sessions.add(sessionRef)
    }
  }
  for (const agg of byId.values()) {
    agg.distinctSessions = agg._sessions ? agg._sessions.size : 0
    delete agg._sessions
  }
  return byId
}

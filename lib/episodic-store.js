/**
 * M8-1 Episodic Store 纯核心(docs/proactive-associative-memory-system-map.html M-02 Episodic)。
 * 纯内存状态机,零 IO、零依赖(node:crypto 仅作确定性身份);持久化通过可注入 IO 接口,
 * Host 接线时才接真实文件(本模块自身不读写磁盘,测试用内存 IO)。
 *
 * 设计目标(M-02 元代码逐行落地):
 *   - Episode 六元组: {intent, actions, entities, unresolved, outcome, provenance}
 *   - 轻量事件先落 sidecar;会话结束或空闲期再摘要和巩固。
 *   - 失败经验默认是 candidate,不直接是事实(防错误自我解释污染长期层)。
 *
 * 生命周期:
 *   append(segment)  → episode 累积(intent/actions/entities/unresolved 从对话段提取)
 *   consolidate()    → 会话结束/空闲期调用:把 episode 摘要并固化,产出 episodic_candidate
 *                      供 M-03 Semantic(fact candidate)/M-04 Procedural(procedure candidate)消费。
 *
 * 与 M5 evidence 的衔接:每段都有 eventSeq/contextVersion 溯源;consolidate 后 evidence
 * 挂钩供 Procedure 晋升复用(复用 fact-store 的 evidenceFor 语义,本模块自带轻量聚合)。
 *
 * 与 M7 judgement-shadow 的衔接:episodic_candidate 是 judgement-shadow 8 类之一,
 * 本模块是它的 JS 侧真实来源(Python 侧仅建议,JS 侧才固化)。
 *
 * 全部同输入确定; UTF-8 无 BOM。
 */
import { createHash } from 'node:crypto'

// ========== 冻结常量 ==========

export const EPISODIC_POLICY_VERSION = 'episodic_store_v1'
export const EPISODE_ID_PREFIX = 'epi_'
export const EPISODE_ID_RE = /^epi_[0-9a-f]{32}$/

/** episode 累积上限(防无限增长;超过后最旧段被丢弃)。 */
export const EPISODE_SEGMENT_CAP_V1 = 64

/** 巩固后保留的最多 episode 数(超出按时间淘汰,保留最近)。 */
export const EPISODE_RETENTION_V1 = 256

/** 巩固阈值:至少多少段才算一个可巩固 episode(少于=丢弃,噪声太多)。 */
export const EPISODE_MIN_SEGMENTS_V1 = 2

/** outcome 枚举。 */
export const EPISODE_OUTCOMES_V1 = Object.freeze(['unknown', 'success', 'failure', 'partial'])

/**
 * EpisodeSegment 校验(append 输入)。
 * 最小字段: kind/userText 至少一个非空; eventSeq 非负; contextVersion 非负。
 */
export function validateEpisodeSegmentPre(seg) {
  const p = []
  if (!seg || typeof seg !== 'object' || Array.isArray(seg)) return { ok: false, reason: 'not-object' }
  const hasText = typeof seg.userText === 'string' && seg.userText.trim() ||
    typeof seg.assistantText === 'string' && seg.assistantText.trim()
  if (!hasText) p.push('no-text')
  if (seg.kind !== undefined && !['user', 'assistant', 'reasoning', 'tool'].includes(seg.kind)) p.push('kind')
  if (seg.eventSeq !== undefined && (!Number.isInteger(seg.eventSeq) || seg.eventSeq < 0)) p.push('eventSeq')
  if (seg.contextVersion !== undefined && (!Number.isInteger(seg.contextVersion) || seg.contextVersion < 0)) p.push('contextVersion')
  if (p.length) return { ok: false, reason: 'invalid:' + p.join(',') }
  return { ok: true, segment: seg }
}

/** Episode 校验(consolidate 产出 / 持久化读回)。 */
export function validateEpisodePre(ep) {
  const p = []
  if (!ep || typeof ep !== 'object' || Array.isArray(ep)) return { ok: false, reason: 'not-object' }
  if (typeof ep.episodeId !== 'string' || !EPISODE_ID_RE.test(ep.episodeId)) p.push('episodeId')
  if (typeof ep.sessionRef !== 'string' || !ep.sessionRef) p.push('sessionRef')
  if (typeof ep.intent !== 'string') p.push('intent')
  if (!Array.isArray(ep.actions)) p.push('actions')
  if (!Array.isArray(ep.entities)) p.push('entities')
  if (!Array.isArray(ep.unresolved)) p.push('unresolved')
  if (!EPISODE_OUTCOMES_V1.includes(ep.outcome)) p.push('outcome')
  if (!Array.isArray(ep.provenance)) p.push('provenance')
  if (typeof ep.startedAt !== 'number' || !Number.isFinite(ep.startedAt)) p.push('startedAt')
  if (ep.consolidatedAt !== undefined && (typeof ep.consolidatedAt !== 'number' || !Number.isFinite(ep.consolidatedAt))) p.push('consolidatedAt')
  if (ep.success !== undefined && typeof ep.success !== 'boolean') p.push('success')
  if (p.length) return { ok: false, reason: 'invalid:' + p.join(',') }
  return { ok: true, episode: ep }
}

/**
 * Episodic Store 工厂。
 * @param {object} opts
 * @param {object} opts.io      可选持久化 { save(snapshot), load() → snapshot, clear() }
 * @param {function} opts.now   可选时钟
 * @param {object} opts.config  { minSegments?, retention?, segmentCap? } — 可调参数(默认走冻结常量)
 */
export function createEpisodicStorePre(opts = {}) {
  const io = opts.io || { save() {}, load() { return null }, clear() {} }
  const nowFn = typeof opts.now === 'function' ? opts.now : () => Date.now()
  const cfg = Object.assign({
    segmentCap: EPISODE_SEGMENT_CAP_V1,
    retention: EPISODE_RETENTION_V1,
    minSegments: EPISODE_MIN_SEGMENTS_V1,
  }, opts.config || {})

  let episodes = []        // 已巩固 episode(含 candidate 状态)
  let current = null       // 当前会话累积中(未巩固)
  let disposed = false
  const stats = { segmentsAppended: 0, consolidated: 0, droppedTooShort: 0, retained: 0 }

  function defaultEpisodeId(sessionRef, startedAt) {
    const h = createHash('sha256').update(['episode-pre-v1', String(sessionRef), String(startedAt)].join('\u0000')).digest('hex')
    return EPISODE_ID_PREFIX + h.slice(0, 32)
  }

  // ---- 段追加(会话进行中实时累积) ----
  function append(seg) {
    if (disposed) return { ok: false, reason: 'disposed' }
    const v = validateEpisodeSegmentPre(seg)
    if (!v.ok) return { ok: false, reason: v.reason }
    const s = v.segment
    if (!current) {
      current = {
        sessionRef: String(s.sessionRef || 'unknown'),
        startedAt: nowFn(),
        segments: [],
        userTexts: [], assistantTexts: [],
      }
    }
    // 累积文本(只保留文本特征,不保留原文全文 —— 隐私最小化)
    const ut = typeof s.userText === 'string' ? s.userText : ''
    const at = typeof s.assistantText === 'string' ? s.assistantText : ''
    if (ut.trim()) current.userTexts.push(ut.trim().slice(0, 200))
    if (at.trim()) current.assistantTexts.push(at.trim().slice(0, 200))
    current.segments.push({
      kind: s.kind || 'unknown',
      eventSeq: s.eventSeq || 0,
      contextVersion: s.contextVersion || 0,
      userText: ut.slice(0, 200),
      assistantText: at.slice(0, 200),
      ts: nowFn(),
    })
    // 超 cap:丢最旧段(保留最近上下文)
    while (current.segments.length > cfg.segmentCap) {
      current.segments.shift()
      if (current.userTexts.length) current.userTexts.shift()
      if (current.assistantTexts.length) current.assistantTexts.shift()
    }
    stats.segmentsAppended++
    return { ok: true, segments: current.segments.length }
  }

  /** 从累积文本提取 intent(2026-08-28 提纯):跳过本插件注入快照污染的段
   *  (「Current runtime context. This snapshot…」/auto-memory 标记),取第一条
   *  真实用户文本;全被污染则取最后一条(退化)。 */
  function extractIntent(ep) {
    const INJECTED_RE = /^current runtime context\.|^this snapshot supersedes|auto-memory|\[自动沉淀\]/i
    const texts = (ep.userTexts || []).map((t) => String(t || '').trim()).filter((t) => t)
    const clean = texts.filter((t) => !INJECTED_RE.test(t))
    const pick = clean.length ? clean[0] : (texts.length ? texts[texts.length - 1] : '')
    return pick ? pick.slice(0, 60) : '(未提取)'
  }

  /** 从累积文本提取 entities(简单启发式:用户文本中的 CJK 2-4 字符 token,高频优先)。 */
  function extractEntities(userTexts) {
    const joined = userTexts.join(' ')
    const grams = new Map()
    const tokens = String(joined).match(/[A-Za-z0-9_\u4e00-\u9fff]+/g) || []
    for (const tok of tokens) {
      if (tok.length < 2 || tok.length > 20) continue
      if (/^[\u4e00-\u9fff]+$/.test(tok) && tok.length > 4) {
        // 中文长 token 按 2-3 字滑窗
        for (let i = 0; i + 2 <= tok.length && i < tok.length - 2 + 1 && i < 12; i++) {
          const g = tok.slice(i, i + 2)
          if (/[\u4e00-\u9fff]/.test(g)) grams.set(g, (grams.get(g) || 0) + 1)
        }
      } else {
        grams.set(tok, (grams.get(tok) || 0) + 1)
      }
    }
    return [...grams.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([g]) => g)
  }

  /** 推断 outcome(启发式:助手文本含失败信号→failure, 成功信号→success)。 */
  function inferOutcome(ep) {
    const at = ep.assistantTexts.join(' ').toLowerCase()
    const failSig = ['失败', '错误', '报错', '无法', 'error', 'failed', 'exception']
    const succSig = ['成功', '完成', '已修复', '搞定', 'ok', 'done', 'success']
    if (failSig.some((s) => at.includes(s))) return 'failure'
    if (succSig.some((s) => at.includes(s))) return 'success'
    return 'unknown'
  }

  /** 提取未决事项(启发式:用户文本含问句/待办)。 */
  function extractUnresolved(ep) {
    const ut = ep.userTexts.join(' ')
    const out = []
    const q = ut.match(/[^。！？\n]*[？?][^。！？\n]*/g) || []
    for (const s of q) if (s.trim() && out.length < 5) out.push(s.trim().slice(0, 80))
    return out
  }

  /**
   * 巩固: 会话结束/空闲期调用,把当前累积固化成 episode。
   * 产出 outcome=intent/entities/unresolved 等特征,并挂上 success 标志(供 Procedure 用)。
   * 少于 minSegments 的丢弃(噪声)。
   */
  function consolidate() {
    if (disposed) return { ok: false, reason: 'disposed' }
    if (!current) return { ok: false, reason: 'nothing-to-consolidate' }
    if (current.segments.length < cfg.minSegments) {
      stats.droppedTooShort++
      const segs = current.segments.length
      current = null
      return { ok: false, reason: 'too-short', segments: segs }
    }
    const outcome = inferOutcome(current)
    const ep = {
      episodeId: defaultEpisodeId(current.sessionRef, current.startedAt),
      sessionRef: current.sessionRef,
      intent: extractIntent(current),
      actions: current.segments.map((s) => s.kind).filter(Boolean),
      entities: extractEntities(current.userTexts),
      unresolved: extractUnresolved(current),
      outcome,
      success: outcome === 'success',
      provenance: current.segments.map((s) => 'seg:' + String(s.eventSeq)),
      startedAt: current.startedAt,
      consolidatedAt: nowFn(),
    }
    const v = validateEpisodePre(ep)
    if (!v.ok) { current = null; return { ok: false, reason: 'invalid:' + v.reason } }
    episodes.push(v.episode)
    // 保留策略: 超 retention 淘汰最旧
    if (episodes.length > cfg.retention) {
      episodes = episodes.slice(-cfg.retention)
      stats.retained++
    }
    current = null
    stats.consolidated++
    void persist()
    return { ok: true, episode: v.episode }
  }

  /** 会话中途强制巩固(跨天续接/会话切换时调用)。 */
  function flush() {
    if (current) return consolidate()
    return { ok: false, reason: 'nothing-to-consolidate' }
  }

  // ---- 查询 ----
  function query(q = {}) {
    if (disposed) return []
    return episodes
      .filter((e) =>
        (q.sessionRef === undefined || e.sessionRef === q.sessionRef) &&
        (q.outcome === undefined || e.outcome === q.outcome) &&
        (q.success === undefined || e.success === q.success))
      .map((e) => ({ ...e }))
  }
  function recent(n = 10) {
    return episodes.slice(-n).map((e) => ({ ...e }))
  }
  function get(episodeId) {
    const e = episodes.find((x) => x.episodeId === episodeId)
    return e ? { ...e } : null
  }

  // ---- M-04 挂钩: 供 Procedure 晋升用的事故/成功统计 ----
  function statsFor(sessionRef) {
    const all = episodes.filter((e) => e.sessionRef === sessionRef)
    return {
      total: all.length,
      success: all.filter((e) => e.success).length,
      failure: all.filter((e) => e.outcome === 'failure').length,
      distinctSessions: new Set(episodes.map((e) => e.sessionRef)).size,
    }
  }

  // ---- 持久化 ----
  function snapshot() {
    return {
      schemaVersion: 1, namespace: 'dsh-auto-memory', policyVersion: EPISODIC_POLICY_VERSION,
      savedAt: nowFn(),
      episodes: episodes.map((e) => ({ ...e })),
      current: current ? {
        sessionRef: current.sessionRef, startedAt: current.startedAt,
        segments: current.segments, userTexts: current.userTexts, assistantTexts: current.assistantTexts,
      } : null,
    }
  }
  function restore(data) {
    if (!data || data.schemaVersion !== 1) return { ok: false, reason: 'bad-schema' }
    if (!Array.isArray(data.episodes)) return { ok: false, reason: 'bad-episodes' }
    episodes = []
    for (const e of data.episodes) {
      const v = validateEpisodePre(e)
      if (!v.ok) continue
      episodes.push(v.episode)
    }
    current = data.current || null
    return { ok: true, restored: episodes.length }
  }
  function clear() {
    episodes = []; current = null
    try { io.clear() } catch (_) {}
    return { ok: true }
  }
  function dispose(reason) {
    if (disposed) return
    disposed = true
    try { io.save(snapshot()) } catch (_) {}
  }

  function persist() {
    try { io.save(snapshot()) } catch (_) {}
  }

  return {
    append, consolidate, flush, query, recent, get, statsFor,
    snapshot, restore, clear, dispose,
    getStats: () => ({ ...stats }),
    get size() { return episodes.length },
    get hasCurrent() { return !!current },
  }
}

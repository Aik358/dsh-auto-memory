/**
 * M8-0 Fact Store 纯核心(docs/proactive-associative-memory-system-map.html M-03 Semantic/Profile)。
 * 纯内存状态机,零 IO、零依赖(node:crypto 仅作确定性身份);持久化通过可注入 IO 接口,
 * Host 接线时才接真实文件(本模块自身不读写磁盘,测试用内存 IO)。
 *
 * 设计目标(M-03 元代码逐行落地):
 *   - Fact 四元组: {scope, subject, predicate, object?} + provenance + confirmedAt + ttl? + revoked?
 *   - upsert(cand): 冲突→冲突集保留双方; 自动推断不覆盖已有规则; 否则合并写入。
 *   - 用户明确声明 > 模型推断; 项目事实/用户画像/术语分开; 冲突可见、可确认、可撤销。
 *   - supersede: 同一 subject+predicate 的新事实显式取代旧事实(旧 revoked=true,保留 provenance)。
 *
 * 与 M7 judgement-shadow 的衔接(输入侧):
 *   - ingestJudgementRow(row) 消费 worker 输出的 semantic_candidate / profile_candidate,
 *     转成 FactCandidate; suggestion=supersede_suggest → supersede 路径, merge_suggest → merge。
 *
 * 与 M5 AccessEvidence 的衔接(证据挂钩,供 M9 Procedure 复用):
 *   - evidenceFor(memoryId) 聚合 seen/read/cite/reuse/success/correction 六类计数与去重 session 数。
 *
 * 与 M-06 可读投影 / sidecar 索引的衔接(输出侧,预留):
 *   - snapshot() 导出全部 fact 供 M-06 投影; Host 接线点=fact-store-pre 的 store.put 回调。
 *
 * 全部同输入确定; UTF-8 无 BOM。
 */
import { createHash } from 'node:crypto'

// ========== 冻结常量(变更必须升级 FACT_POLICY_VERSION) ==========

/** Fact 策略版本。 */
export const FACT_POLICY_VERSION = 'fact_store_v1'

/** factId 前缀(确定性身份)。 */
export const FACT_ID_PREFIX = 'fact_'

/** factId 长度前缀断言(与 memoryId/anchorId 同风格)。 */
export const FACT_ID_RE = /^fact_[0-9a-f]{32}$/

/** scope 枚举: 与 M5/M6 的 scope 对齐(User=跨工作区, Workspace=当前工作区)。 */
export const FACT_SCOPES_V1 = Object.freeze(['User', 'Workspace'])

/** sourceClass 枚举: 与 m4-corpus-pre 的 sourceClass 对齐。 */
export const FACT_SOURCE_CLASSES_V1 = Object.freeze([
  'user-memory', 'workspace-notes', 'workspace-log', 'semantic-candidate', 'profile-candidate',
])

/** 来源类型: 用户明确声明(硬规则) vs 模型推断(candidate)。 */
export const FACT_SOURCE_KINDS_V1 = Object.freeze(['explicit', 'inference'])

/** 冲突处理结果枚举。 */
export const UPSERT_OUTCOMES_V1 = Object.freeze([
  'created', 'merged', 'superseded', 'conflict-added', 'inference-blocked', 'expired-ignored',
])

/** TTL 语义: 过期事实视为不存在(读取时过滤),但保留记录供审计。 */
export const FACT_TTL_DEFAULT_V1 = 0 // 0 = 永不过期

/**
 * FactCandidate 校验(fail closed)。
 * 输入可以是 judgement-shadow 行或显式用户声明; sourceKind 决定 upsert 的覆盖权。
 */
export function validateFactCandidatePre(cand) {
  const p = []
  if (!cand || typeof cand !== 'object' || Array.isArray(cand)) return { ok: false, reason: 'not-object' }
  if (!FACT_SCOPES_V1.includes(cand.scope)) p.push('scope')
  if (typeof cand.subject !== 'string' || !cand.subject.trim()) p.push('subject')
  if (typeof cand.predicate !== 'string' || !cand.predicate.trim()) p.push('predicate')
  if (cand.object !== undefined && cand.object !== null && typeof cand.object !== 'string') p.push('object')
  if (!FACT_SOURCE_KINDS_V1.includes(cand.sourceKind)) p.push('sourceKind')
  if (cand.sourceClass !== undefined && !FACT_SOURCE_CLASSES_V1.includes(cand.sourceClass)) p.push('sourceClass')
  if (cand.provenance !== undefined && (!Array.isArray(cand.provenance) || cand.provenance.some((s) => typeof s !== 'string'))) p.push('provenance')
  if (cand.confidence !== undefined && (typeof cand.confidence !== 'number' || !Number.isFinite(cand.confidence) || cand.confidence < 0 || cand.confidence > 1)) p.push('confidence')
  if (cand.ttl !== undefined && (typeof cand.ttl !== 'number' || !Number.isFinite(cand.ttl) || cand.ttl < 0)) p.push('ttl')
  if (p.length) return { ok: false, reason: 'invalid:' + p.join(',') }
  return { ok: true, candidate: cand }
}

/**
 * 校验一个已固化的 Fact(读回/持久化时 fail closed)。
 * 与 FactCandidate 的区别: Fact 必须有 factId/confirmedAt, provenance 必填数组。
 */
export function validateFactPre(fact) {
  const p = []
  if (!fact || typeof fact !== 'object' || Array.isArray(fact)) return { ok: false, reason: 'not-object' }
  if (typeof fact.factId !== 'string' || !FACT_ID_RE.test(fact.factId)) p.push('factId')
  if (!FACT_SCOPES_V1.includes(fact.scope)) p.push('scope')
  if (typeof fact.subject !== 'string' || !fact.subject.trim()) p.push('subject')
  if (typeof fact.predicate !== 'string' || !fact.predicate.trim()) p.push('predicate')
  if (fact.object !== undefined && fact.object !== null && typeof fact.object !== 'string') p.push('object')
  if (!Array.isArray(fact.provenance) || fact.provenance.some((s) => typeof s !== 'string')) p.push('provenance')
  if (typeof fact.confirmedAt !== 'number' || !Number.isFinite(fact.confirmedAt)) p.push('confirmedAt')
  if (fact.ttl !== undefined && (typeof fact.ttl !== 'number' || !Number.isFinite(fact.ttl))) p.push('ttl')
  if (fact.revoked !== undefined && typeof fact.revoked !== 'boolean') p.push('revoked')
  if (p.length) return { ok: false, reason: 'invalid:' + p.join(',') }
  return { ok: true, fact }
}

/**
 * 冲突定义: 同一 subject+predicate+scope 但 object 不同(或一方有 object 一方无)。
 * 注意: 完全相同的 (subject,predicate,object,scope) 不算冲突, 是重复(走 merge)。
 */
export function isFactConflict(a, b) {
  if (!a || !b) return false
  if (a.scope !== b.scope || a.subject !== b.subject || a.predicate !== b.predicate) return false
  const ao = a.object === undefined || a.object === null ? '' : a.object
  const bo = b.object === undefined || b.object === null ? '' : b.object
  return ao !== bo
}

/**
 * 主状态机工厂。
 *
 * @param {object} opts
 * @param {object} opts.io          可选持久化接口 { save(facts), load() → facts[] , clear() }
 *                                   默认 = 内存版(不落盘,进程内有效)。Host 接线时注入真实文件 IO。
 * @param {function} opts.now       可选时钟(默认 Date.now), 测试注入确定性时间。
 * @param {function} opts.factId    可选 factId 工厂(默认确定性哈希), 测试注入。
 */
export function createFactStorePre(opts = {}) {
  // ---- 内部状态(全部在实例内, 无全局) ----
  let facts = []          // 已固化 Fact 数组(含 revoked/过期, 读取时过滤)
  let conflicts = []      // 冲突集(保留双方 provenance)
  let disposed = false
  const stats = {
    upserts: 0, created: 0, merged: 0, superseded: 0, conflictAdded: 0,
    inferenceBlocked: 0, expiredIgnored: 0, revoked: 0,
  }
  const io = opts.io || { save() {}, load() { return [] }, clear() {} }
  const nowFn = typeof opts.now === 'function' ? opts.now : () => Date.now()
  const idFn = typeof opts.factId === 'function' ? opts.factId : defaultFactId

  // ---- 确定性 factId(与 memoryId/anchorId 同风格) ----
  function defaultFactId(subject, predicate, object, scope) {
    const h = createHash('sha256').update(
      ['fact-pre-v1', String(scope), String(subject), String(predicate), String(object == null ? '' : object)].join('\u0000')
    ).digest('hex')
    return FACT_ID_PREFIX + h.slice(0, 32)
  }

  // 冲突自增序号:同一 subject+predicate 在极短时间内反复冲突时,conflictId 仍唯一。
  let conflictSeq = 0

  function isExpired(fact, now) {
    if (!fact || !fact.ttl || fact.ttl <= 0) return false
    return now >= fact.confirmedAt + fact.ttl
  }

  function findSubjectPredicate(scope, subject, predicate) {
    return facts.find((f) => f.scope === scope && f.subject === subject && f.predicate === predicate && !f.revoked && !isExpired(f, nowFn()))
  }

  // ---- 核心 upsert(M-03 元代码逐行) ----
  function upsert(cand) {
    if (disposed) return { ok: false, reason: 'disposed', outcome: 'disposed' }
    stats.upserts++
    const v = validateFactCandidatePre(cand)
    if (!v.ok) return { ok: false, reason: v.reason, outcome: 'invalid' }
    const c = v.candidate
    const now = nowFn()

    // 1. 冲突检测: 同 subject+predicate+scope 但 object 不同
    const existing = findSubjectPredicate(c.scope, c.subject, c.predicate)
    if (existing && isFactConflict(existing, c)) {
      stats.conflictAdded++
      // conflictId 必须唯一:同一候选值反复出现时,每次冲突都是独立待决事件。
      // 用 subject+predicate+object+序号+detectedAt 派生,保证可被逐个 resolve。
      conflictSeq++
      conflicts.push({
        conflictId: defaultFactId(c.scope, c.subject, c.predicate, c.object) + '_conflict_' + conflictSeq + '_' + String(now),
        scope: c.scope, subject: c.subject, predicate: c.predicate,
        left: existing, right: c, detectedAt: now, resolved: false,
      })
      void persist() // 冲突集是重要状态,必须落盘(不持久化会丢失待决冲突)
      return { ok: true, outcome: 'conflict-added', conflict: conflicts[conflicts.length - 1], existing }
    }

    // 2. 自动推断不覆盖已有规则(M-03: if (existing && cand.source === 'inference') return)
    if (existing && c.sourceKind === 'inference') {
      stats.inferenceBlocked++
      return { ok: true, outcome: 'inference-blocked', existing }
    }

    // 3. 新建 / 合并 / 取代
    if (!existing) {
      const fact = {
        factId: idFn(c.scope, c.subject, c.predicate, c.object),
        scope: c.scope, subject: c.subject, predicate: c.predicate,
        object: c.object === undefined ? null : c.object,
        sourceKind: c.sourceKind,
        sourceClass: c.sourceClass || (c.sourceKind === 'explicit' ? 'user-memory' : 'semantic-candidate'),
        provenance: c.provenance || [],
        confidence: c.confidence !== undefined ? c.confidence : null,
        confirmedAt: now, ttl: c.ttl !== undefined ? c.ttl : FACT_TTL_DEFAULT_V1,
        revoked: false,
      }
      const fv = validateFactPre(fact)
      if (!fv.ok) return { ok: false, reason: 'fact-invalid:' + fv.reason, outcome: 'invalid' }
      facts.push(fv.fact)
      stats.created++
      void persist()
      return { ok: true, outcome: 'created', fact: fv.fact }
    }

    // 已有且不冲突: 合并(用户声明提升 sourceKind/confidence, 追加 provenance)
    const prev = existing
    if (c.sourceKind === 'explicit' || prev.sourceKind !== 'explicit') {
      prev.sourceKind = c.sourceKind === 'explicit' ? 'explicit' : prev.sourceKind
    }
    if (c.sourceClass) prev.sourceClass = c.sourceClass
    if (c.provenance && c.provenance.length) {
      const seen = new Set(prev.provenance)
      for (const s of c.provenance) if (!seen.has(s)) prev.provenance.push(s)
    }
    if (c.confidence !== undefined && c.confidence !== null) prev.confidence = c.confidence
    prev.confirmedAt = now // 合并视为重新确认
    if (c.ttl !== undefined) prev.ttl = c.ttl
    stats.merged++
    void persist()
    return { ok: true, outcome: 'merged', fact: prev }
  }

  /**
   * 显式取代: 同一 subject+predicate 的新事实取代旧事实(旧 revoked=true, 保留 provenance)。
   * 语义 = judgement-shadow 的 supersede_suggest / 用户明确纠正。
   */
  function supersede(cand) {
    if (disposed) return { ok: false, reason: 'disposed', outcome: 'disposed' }
    const v = validateFactCandidatePre(cand)
    if (!v.ok) return { ok: false, reason: v.reason, outcome: 'invalid' }
    const c = v.candidate
    const existing = findSubjectPredicate(c.scope, c.subject, c.predicate)
    if (existing) {
      existing.revoked = true
      existing.revokedAt = nowFn()
      stats.revoked++
    }
    return upsert(c)
  }

  /**
   * M10 存储管理级联撤销(2026-08-30 P3):删除一条记忆后,由它派生出来的事实必须一起失效,
   * 否则「记忆已删、事实仍在被召回/写回」(HANDOFF §2 P3 缺口③)。
   * provenance 含该 sourceId 的未撤销事实一律 revoked=true —— 保留 provenance 与 revokedAt,
   * 只读不删(可审计、可追溯),与 supersede 的撤销语义完全一致。
   */
  function revokeBySource(sourceId) {
    if (disposed) return { ok: false, reason: 'disposed', revoked: 0, factIds: [] }
    const sid = String(sourceId || '')
    if (!sid) return { ok: false, reason: 'no-source-id', revoked: 0, factIds: [] }
    const now = nowFn()
    const factIds = []
    for (const f of facts) {
      if (f.revoked) continue
      if (!Array.isArray(f.provenance) || !f.provenance.includes(sid)) continue
      f.revoked = true
      f.revokedAt = now
      f.revokeReason = 'source-deleted'
      stats.revoked++
      factIds.push(f.factId)
    }
    if (factIds.length) void persist()
    return { ok: true, revoked: factIds.length, factIds }
  }

  // ---- 查询 ----
  function get(scope, subject, predicate) {
    if (disposed) return null
    const f = findSubjectPredicate(scope, subject, predicate)
    return f ? { ...f } : null // 返回副本, 防外部改内部态
  }
  function query(q = {}) {
    if (disposed) return []
    const now = nowFn()
    return facts
      .filter((f) =>
        (!f.revoked) &&
        (!isExpired(f, now)) &&
        (q.scope === undefined || f.scope === q.scope) &&
        (q.subject === undefined || f.subject === q.subject) &&
        (q.predicate === undefined || f.predicate === q.predicate))
      .map((f) => ({ ...f }))
  }
  function conflictsList() {
    return conflicts.map((c) => ({ ...c }))
  }
  function pendingConflicts() {
    return conflicts.filter((c) => !c.resolved).map((c) => ({ ...c }))
  }
  function resolveConflict(conflictId, choice) {
    // choice: 'left' 保留左(已有), 'right' 采用右(新候选)。解析后冲突标记 resolved。
    const c = conflicts.find((x) => x.conflictId === conflictId)
    if (!c) return { ok: false, reason: 'not-found' }
    if (c.resolved) return { ok: false, reason: 'already-resolved' }
    if (choice === 'left') {
      // 保留现有: 丢弃右候选(不落库)
      c.resolved = true; c.resolvedAt = nowFn(); c.choice = 'left'
    } else if (choice === 'right') {
      // 采用新候选: 旧 revoked, 新落库
      const old = findSubjectPredicate(c.scope, c.subject, c.predicate)
      if (old) { old.revoked = true; old.revokedAt = nowFn(); stats.revoked++ }
      upsert(c.right)
      c.resolved = true; c.resolvedAt = nowFn(); c.choice = 'right'
    } else {
      return { ok: false, reason: 'invalid-choice' }
    }
    void persist()
    return { ok: true, conflict: { ...c } }
  }

  // ---- M5 evidence 挂钩(供 M9 Procedure 复用) ----
  function evidenceFor(memoryId, evidenceList = []) {
    if (disposed) return null
    const evs = evidenceList.filter((e) => e && e.memoryId === memoryId)
    const byKind = {}
    for (const k of ['seen', 'read', 'cite', 'reuse', 'success', 'correction']) byKind[k] = 0
    const sessions = new Set()
    for (const e of evs) {
      if (byKind[e.kind] !== undefined) byKind[e.kind]++
      if (e.sessionRef) sessions.add(e.sessionRef)
    }
    return {
      memoryId, total: evs.length,
      distinctSessions: sessions.size,
      ...byKind,
    }
  }

  // ---- 持久化(可注入 IO) ----
  function persist() {
    try { io.save(snapshot({ includeRevoked: true })) } catch (_) {}
  }
  function snapshot(opts = {}) {
    const now = nowFn()
    return {
      schemaVersion: 1, namespace: 'dsh-auto-memory', policyVersion: FACT_POLICY_VERSION,
      savedAt: now,
      facts: (opts.includeRevoked ? facts : facts.filter((f) => !f.revoked))
        .map((f) => ({ ...f })),
      conflicts: conflicts.map((c) => ({ ...c })),
    }
  }
  function restore(data) {
    if (!data || data.schemaVersion !== 1) return { ok: false, reason: 'bad-schema' }
    if (!Array.isArray(data.facts)) return { ok: false, reason: 'bad-facts' }
    facts = []
    for (const f of data.facts) {
      const v = validateFactPre(f)
      if (!v.ok) continue // 坏记录跳过, 不整体失败(幂等恢复)
      facts.push(v.fact)
    }
    conflicts = Array.isArray(data.conflicts) ? data.conflicts.map((c) => ({ ...c })) : []
    return { ok: true, restored: facts.length }
  }
  function clear() {
    facts = []; conflicts = []
    try { io.clear() } catch (_) {}
    stats.created = 0; stats.merged = 0; stats.superseded = 0
    return { ok: true }
  }
  function dispose(reason) {
    if (disposed) return
    disposed = true
    try { io.save(snapshot({ includeRevoked: true })) } catch (_) {}
  }

  return {
    upsert, supersede, get, query, conflictsList, pendingConflicts, resolveConflict,
    evidenceFor, revokeBySource, snapshot, restore, clear, dispose,
    getStats: () => ({ ...stats }),
    get size() { return facts.length },
    get conflictCount() { return conflicts.length },
  }
}

// ========== judgement-shadow 消费(输入侧适配器) ==========

/**
 * 把 judgement-shadow 行转成 FactCandidate。
 * 只接受 semantic_candidate / profile_candidate; 其他 kind 返回 null(忽略)。
 * suggestion=supersede_suggest → 调用方走 supersede, 否则走 upsert。
 */
export function factCandidateFromJudgementRow(row) {
  if (!row || typeof row !== 'object') return null
  const kind = row.kindCandidate
  if (kind !== 'semantic_candidate' && kind !== 'profile_candidate') return null
  const sourceIds = Array.isArray(row.sourceIds) ? row.sourceIds : []
  if (!sourceIds.length) return null
  const subject = String(row.subject || sourceIds[0] || '') // 行内无 subject 时用 sourceId 占位
  const predicate = String(row.predicate || 'relation')
  const object = row.object === undefined || row.object === null ? null : String(row.object)
  return {
    scope: row.scope === 'User' ? 'User' : 'Workspace',
    subject, predicate, object,
    sourceKind: 'inference',
    sourceClass: kind === 'profile_candidate' ? 'profile-candidate' : 'semantic-candidate',
    provenance: [...sourceIds],
    confidence: typeof row.confidence === 'number' ? row.confidence : null,
    ttl: typeof row.ttl === 'number' ? row.ttl : undefined,
    _suggestion: row.suggestion || 'keep_suggest',
  }
}

/**
 * 批量消费 judgement-shadow 行(幂等: 同 observationId 同 sourceIds 只处理一次)。
 * 返回每行的处理结果数组。
 */
export function ingestJudgementRows(store, rows, opts = {}) {
  const seen = new Set(opts.seenObservationIds || [])
  const out = []
  for (const row of rows) {
    const cand = factCandidateFromJudgementRow(row)
    if (!cand) { out.push({ skipped: true, reason: 'not-fact-kind' }); continue }
    const key = String(row.observationId || '') + '|' + (row.sourceIds || []).join(',')
    if (seen.has(key)) { out.push({ skipped: true, reason: 'duplicate' }); continue }
    seen.add(key)
    const r = cand._suggestion === 'supersede_suggest' ? store.supersede(cand) : store.upsert(cand)
    out.push({ row: key, outcome: r.outcome, ok: r.ok, reason: r.reason || null })
  }
  return { results: out, seenObservationIds: [...seen] }
}

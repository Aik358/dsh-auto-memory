/**
 * M8-3 Memory Hub 编排器(docs/PROJECT-FREEZE-AND-ROADMAP.md M8/M9; 记忆中枢)。
 * 纯内存编排,零 IO 依赖(node:crypto 仅身份);把三层记忆串成一条可即插即用的链:
 *
 *   M-02 Episodic(经历) → M-03 Semantic/Profile(事实) → M-04 Procedural(技能)
 *            ↑                              ↑                        ↑
 *   M2 segments / M5 evidence  →  judgement-shadow.jsonl  →  M5 success/reuse evidence
 *
 * 职责:
 *   1) 消费 M7 judgement-shadow 的 semantic/profile/procedure_candidate,喂给对应 store。
 *   2) 把 episodic 巩固后的 episode 转成 episodic_candidate 供上层消费。
 *   3) 把 active procedure 渲染成 checklist(供 M7 召回系统在相似场景注入)。
 *   4) 对外提供统一查询/统计/快照,供设置页「记忆中枢」与前端「记忆中枢」窗口展示。
 *   5) 参数全部走 config(设置页可调),本模块只读不写。
 *
 * 设计原则:
 *   - 不杂糅: 三层各管各的 store(episodic-store / fact-store / procedure-store),
 *     hub 只做编排和转发,不重实现任何一层的逻辑。
 *   - 即插即用: Host 接线时传入 { episodic, facts, procedures } 三个 store 实例
 *     (或让 hub 用默认内存实例),即可工作;换成带 IO 的实例即持久化。
 *   - 全 fail-closed: 任一 store 缺失/失败,该路静默跳过,不阻断其他路。
 *
 * 全部同输入确定; UTF-8 无 BOM。
 */
import { createHash } from 'node:crypto'

export const MEMORY_HUB_POLICY_VERSION = 'memory_hub_pre_v1'

/** judgement-shadow 8 类候选 → 记忆层映射(不识别的不消费)。 */
export const KIND_TO_LAYER_PRE_V1 = Object.freeze({
  semantic_candidate: 'semantic',
  profile_candidate: 'semantic',
  procedure_candidate: 'procedure',
  episodic_candidate: 'episodic',
})

/**
 * Memory Hub 工厂。
 * @param {object} opts
 * @param {object} opts.stores  { episodic?, facts?, procedures? } — 缺省用内存实例
 * @param {object} opts.config  记忆中枢参数(从设置页读): { episodicMinSegments?, episodicRetention?,
 *                                procedureMinSessions?, procedureMinSuccess?, procedureCorrectionCap?,
 *                                procedureHighRiskApproval?, procedureActiveLevel? }
 * @param {function} opts.now
 * @param {function} opts.log  可选诊断(默认静默)
 */
export function createMemoryHubPre(opts = {}) {
  // 惰性 import 避免循环依赖(各 store 是独立模块)
  const { createEpisodicStorePre } = opts._stores || {}
  const { createFactStorePre } = opts._stores || {}
  const { createProcedureStorePre } = opts._stores || {}
  const nowFn = typeof opts.now === 'function' ? opts.now : () => Date.now()
  const log = typeof opts.log === 'function' ? opts.log : () => {}

  // 三层 store(可注入;缺省内存版)
  const stores = {}
  stores.episodic = opts.stores && opts.stores.episodic
    ? opts.stores.episodic
    : (createEpisodicStorePre ? createEpisodicStorePre({ now: nowFn }) : null)
  stores.facts = opts.stores && opts.stores.facts
    ? opts.stores.facts
    : (createFactStorePre ? createFactStorePre({ now: nowFn }) : null)
  stores.procedures = opts.stores && opts.stores.procedures
    ? opts.stores.procedures
    : (createProcedureStorePre ? createProcedureStorePre({ now: nowFn }) : null)

  const cfg = opts.config || {}
  const stats = { judgedRows: 0, consumedSemantic: 0, consumedProcedure: 0, consumedEpisodic: 0, skipped: 0, checklistsRendered: 0 }

  // ---- 1) 消费 judgement-shadow(喂给对应 store) ----
  function ingestJudgement(row) {
    if (!row || typeof row !== 'object') { stats.skipped++; return { skipped: true, reason: 'not-object' } }
    const kind = row.kindCandidate
    const layer = KIND_TO_LAYER_PRE_V1[kind]
    if (!layer) { stats.skipped++; return { skipped: true, reason: 'unknown-kind:' + kind } }
    stats.judgedRows++
    try {
      if (layer === 'semantic' && stores.facts) {
        // 复用 fact-store 的 judgement 消费(需 fact-store 提供 factCandidateFromJudgementRow/ingest)
        const cand = typeof stores.facts.factCandidateFromJudgementRow === 'function'
          ? stores.facts.factCandidateFromJudgementRow(row)
          : factCandidateFromRow(row)
        if (!cand) { stats.skipped++; return { skipped: true, reason: 'not-fact' } }
        const r = cand._suggestion === 'supersede_suggest' ? stores.facts.supersede(cand) : stores.facts.upsert(cand)
        stats.consumedSemantic++
        return { consumed: 'semantic', outcome: r.outcome }
      }
      if (layer === 'procedure' && stores.procedures) {
        // 从 row 构造 procedure candidate(行内可能只有 sourceIds + 摘要)
        const cand = procedureCandidateFromRow(row)
        if (!cand) { stats.skipped++; return { skipped: true, reason: 'not-procedure' } }
        const r = stores.procedures.observe(cand)
        stats.consumedProcedure++
        return { consumed: 'procedure', outcome: r.ok ? 'observed' : r.reason }
      }
      if (layer === 'episodic' && stores.episodic) {
        // episodic_candidate 已是巩固后的 episode,直接喂
        const r = stores.episodic.restore({ schemaVersion: 1, episodes: [row] })
        stats.consumedEpisodic++
        return { consumed: 'episodic', outcome: r.ok ? 'restored' : r.reason }
      }
    } catch (e) {
      log('memory-hub ingest error: ' + String(e && e.message || e))
      stats.skipped++
      return { skipped: true, reason: 'error' }
    }
    stats.skipped++
    return { skipped: true, reason: 'no-store' }
  }

  function ingestJudgementRows(rows) {
    const out = []
    for (const r of rows) out.push(ingestJudgement(r))
    return { results: out }
  }

  // ---- 2) episodic 巩固钩子(会话结束/空闲期调) ----
  function consolidateEpisodes() {
    if (!stores.episodic) return { ok: false, reason: 'no-episodic-store' }
    const r = stores.episodic.flush()
    return r
  }

  // ---- 3) 把 episode 转成 candidate 喂给 fact/procedure(举一反三) ----
  function crossFeed(sessionRef) {
    if (!stores.episodic) return { ok: false, reason: 'no-episodic-store' }
    const eps = stores.episodic.query({ sessionRef })
    const out = []
    for (const ep of eps) {
      // 成功 episode → procedure 观察(固定流程雏形)
      if (ep.success && stores.procedures && ep.intent && ep.actions && ep.actions.length) {
        const cand = {
          title: ep.intent.slice(0, 40),
          riskLevel: 'low',
          steps: ep.actions.map((a, i) => '步骤' + (i + 1) + ': ' + a),
          sourceEpisodes: [ep.episodeId],
          sourceMemoryIds: [],
        }
        const r = stores.procedures.observe(cand)
        out.push({ from: 'episode', to: 'procedure', outcome: r.ok ? 'observed' : r.reason })
      }
      // 有未决事项的 episode → 事实候选(不直接固化,留给 judgement)
      if (ep.unresolved && ep.unresolved.length && stores.facts) {
        const cand = {
          scope: 'Workspace', subject: ep.intent.slice(0, 30) || 'episode', predicate: '有未决事项',
          object: ep.unresolved[0].slice(0, 60), sourceKind: 'inference',
          sourceClass: 'semantic-candidate', provenance: [ep.episodeId],
        }
        const r = stores.facts.upsert(cand)
        out.push({ from: 'episode', to: 'fact', outcome: r.outcome })
      }
    }
    return { ok: true, fed: out }
  }

  // ---- 4) active procedure → checklist(供 M7 召回) ----
  function renderChecklists() {
    if (!stores.procedures) return []
    const actives = stores.procedures.activeProcedures()
    const out = []
    for (const p of actives) {
      const r = stores.procedures.renderChecklist(p.procedureId)
      if (r) { out.push(r); stats.checklistsRendered++ }
    }
    return out
  }

  // ---- 5) 统一查询/快照(前端「记忆中枢」窗口 + 设置页) ----
  function overview() {
    return {
      policyVersion: MEMORY_HUB_POLICY_VERSION,
      stats: { ...stats },
      episodic: stores.episodic ? {
        size: stores.episodic.size, recent: stores.episodic.recent(5),
        stats: stores.episodic.getStats ? stores.episodic.getStats() : null,
      } : null,
      facts: stores.facts ? {
        size: stores.facts.size, conflictCount: stores.facts.conflictCount,
        pendingConflicts: stores.facts.pendingConflicts ? stores.facts.pendingConflicts() : [],
        recent: stores.facts.query ? stores.facts.query().slice(-5) : [],
        stats: stores.facts.getStats ? stores.facts.getStats() : null,
      } : null,
      procedures: stores.procedures ? {
        size: stores.procedures.size,
        active: stores.procedures.activeProcedures().map((p) => ({ procedureId: p.procedureId, title: p.title, stage: p.stage, riskLevel: p.riskLevel, evidence: p.evidence })),
        candidates: stores.procedures.query({ stage: 'candidate' }).map((p) => ({ procedureId: p.procedureId, title: p.title, stage: p.stage })),
        // 2026-08-30 审批面:全部未 active/未 deprecated 技能(observed/candidate/validated),
        // 供 hubTab 审批按钮(晋升/激活/弃用)操作
        pipeline: stores.procedures.query()
          .filter((p) => p.stage !== 'active' && p.stage !== 'deprecated')
          .map((p) => ({ procedureId: p.procedureId, title: p.title, stage: p.stage, riskLevel: p.riskLevel, evidence: p.evidence, pinned: !!p.pinned })),
        stats: stores.procedures.getStats ? stores.procedures.getStats() : null,
      } : null,
    }
  }

  function snapshot() {
    return {
      schemaVersion: 1, namespace: 'dsh-auto-memory-pre', policyVersion: MEMORY_HUB_POLICY_VERSION,
      savedAt: nowFn(),
      episodic: stores.episodic ? stores.episodic.snapshot() : null,
      facts: stores.facts ? stores.facts.snapshot({ includeRevoked: true }) : null,
      procedures: stores.procedures ? stores.procedures.snapshot() : null,
    }
  }

  function dispose(reason) {
    for (const k of ['episodic', 'facts', 'procedures']) {
      if (stores[k] && typeof stores[k].dispose === 'function') { try { stores[k].dispose(reason) } catch (_) {} }
    }
  }

  return {
    ingestJudgement, ingestJudgementRows, consolidateEpisodes, crossFeed,
    renderChecklists, overview, snapshot, dispose,
    get stores() { return stores },
    getStats: () => ({ ...stats }),
  }
}

// ---- 行 → candidate 转换(独立纯函数,供 hub 与测试) ----

/** judgement 行 → fact candidate(与 fact-store 的 factCandidateFromJudgementRow 同语义)。 */
export function factCandidateFromRow(row) {
  const kind = row && row.kindCandidate
  if (kind !== 'semantic_candidate' && kind !== 'profile_candidate') return null
  const sourceIds = Array.isArray(row.sourceIds) ? row.sourceIds : []
  if (!sourceIds.length) return null
  return {
    scope: row.scope === 'User' ? 'User' : 'Workspace',
    subject: String(row.subject || sourceIds[0]),
    predicate: String(row.predicate || 'relation'),
    object: row.object === undefined || row.object === null ? null : String(row.object),
    sourceKind: 'inference',
    sourceClass: kind === 'profile_candidate' ? 'profile-candidate' : 'semantic-candidate',
    provenance: [...sourceIds],
    confidence: typeof row.confidence === 'number' ? row.confidence : null,
    _suggestion: row.suggestion || 'keep_suggest',
  }
}

/** judgement 行 → procedure candidate(procedure_candidate 行)。 */
export function procedureCandidateFromRow(row) {
  const kind = row && row.kindCandidate
  if (kind !== 'procedure_candidate') return null
  const sourceIds = Array.isArray(row.sourceIds) ? row.sourceIds : []
  if (!sourceIds.length) return null
  // 行内通常只有 memoryId 引用 + 摘要; 步骤用可用的文本特征
  const title = String(row.title || ('流程 ' + sourceIds[0].slice(-8)))
  const excerpt = String(row.excerpt || row.predicate || '').slice(0, 200)
  return {
    title: title.slice(0, 60),
    riskLevel: row.riskLevel === 'high' || row.riskLevel === 'medium' ? row.riskLevel : 'low',
    steps: excerpt ? [excerpt] : ['参考来源 ' + sourceIds[0]],
    sourceMemoryIds: sourceIds,
    sourceEpisodes: Array.isArray(row.sourceEpisodes) ? row.sourceEpisodes : [],
    successCriteria: Array.isArray(row.successCriteria) ? row.successCriteria : [],
  }
}

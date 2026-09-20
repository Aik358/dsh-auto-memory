import { stripRuntimeIntentPre, looksRuntimeResiduePre } from './intent-clean-safe.js'
import { isObservationOnlyPre } from './procedure-observation.js'
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

export const MEMORY_HUB_POLICY_VERSION = 'memory_hub_v1'

/** judgement-shadow 8 类候选 → 记忆层映射(不识别的不消费)。 */
export const KIND_TO_LAYER_V1 = Object.freeze({
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
  // ★T10：机械 procedure 切片开关（默认关闭；缺省值在 index.js 的 DEFAULT_CONFIG）。
  //   这里只读、不判定语义 —— 具体用途见 crossFeed() 的 procedure 分支。
  const mechanicalProcedureFeedEnabled = opts.mechanicalProcedureFeedEnabled === true
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
    const layer = KIND_TO_LAYER_V1[kind]
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
        // ★ 2026-09-19 上游 PR #77 / issue #63 同步落地（**P0 数据丢失**）：
        //   旧实现走 `stores.episodic.restore({schemaVersion:1, episodes:[row]})`，而 `restore()` 是
        //   **快照整体替换**语义（先清空 episodes）。候选行普遍缺 validateEpisodePre 必填字段
        //   ⇒ 校验拒（restored:0），**但 episodes 已被清空、current 已置 null**，且仍返回 {ok:true}
        //   ⇒ 一次 ingest 抹掉全部已巩固 episode，不可逆。
        //   现改走**增量导入**：不清空、逐条校验、按 episodeId 幂等。
        //   fallback：老 store 无 importEpisodes 时退化为"不导入"，**绝不回退到 restore**。
        if (typeof stores.episodic.importEpisodes !== 'function') {
          stats.skipped++
          return { skipped: true, reason: 'no-import-episodes' }
        }
        const r = stores.episodic.importEpisodes([row])
        if (r.ok && r.imported > 0) {
          stats.consumedEpisodic++
          return { consumed: 'episodic', outcome: 'imported' }
        }
        // 如实区分：非法行 / 重复行都不算 consumed（旧实现把两种情况都记成 'restored'）
        stats.skipped++
        return { skipped: true, reason: r.duplicates > 0 ? 'duplicate-episode' : 'rejected:' + r.rejected }
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
      // issue #30:episode 只提供"观察到一件事"的线索,**不足以**构成可晋升技能 ——
      // 把 actions 直接当成 steps 会让观察行看起来像真流程,且与后续同名富候选撞车后被合并
      // 而丢失富候选的 successCriteria(晋升永久卡死)。现在显式标 observationOnly=true,
      // 并在 title 前过滤运行时信封(避免注入文本变成技能标题)。
      const procedureIntent = stripRuntimeIntentPre(ep.intent).trim()
      // ★T10（2026-09-20 用户报「技能名/内容看不懂」）：**门控机械切片**。
      //   关闭时整段跳过 ⇒ 不再产出 `intent.slice(0,40)` 这种机械观察行。
      //   ⚠️ 只包住 procedure 分支：下方 fact 分支与循环外的逻辑一律不受影响。
      if (mechanicalProcedureFeedEnabled && ep.success && stores.procedures && procedureIntent && procedureIntent !== '(未提取)' && ep.actions && ep.actions.length) {
        const cand = {
          title: procedureIntent.slice(0, 40),
          riskLevel: 'low',
          steps: ['观察任务：' + procedureIntent.slice(0, 80)],
          observationOnly: true,
          sourceEpisodes: [ep.episodeId],
          sourceMemoryIds: [],
        }
        const r = stores.procedures.observe(cand)
        out.push({ from: 'episode', to: 'procedure', outcome: r.ok ? 'observed' : r.reason })
      }
      // 有未决事项的 episode → 事实候选(不直接固化,留给 judgement)
      if (ep.unresolved && ep.unresolved.length && stores.facts) {
        // ★ T1-1（2026-09-19 真机追加）：**fact 分支必须与 procedure 分支同样过清洗器**。
        //   根因：上面 procedure 分支早已调 `stripRuntimeIntentPre`（:152），但本分支直接用
        //   **未清洗**的 `ep.intent` ⇒ 运行时信封/U+FFFD 原样进 facts.json ⇒ 前端面板乱码（⑩-a），
        //   且经 `hubFlushTick` 写回 `MEMORY.md` 污染注入面与语义语料（⑩-b）。实测证据：
        //   `fact_ac4920327df6601f25200d66e52df71f` 的 subject 含 22 个 U+FFFD；
        //   另两条的 object 内嵌 `Current DSH file policy: …` / `Approval prompts are disabled …`。
        //   清洗后再截断，且**空值回退**到 'episode'（保持原 `|| 'episode'` 语义不变）。
        //   ★ F5（行内残留）：清洗器是**按行**判断的，真人与信封挤在同一行时整行必须保留
        //   （删了会丢人话）⇒ 此时「清洗后是否变化」检测不到脏。故再补一道 `looksRuntimeResiduePre`：
        //   该字段**含任何运行时痕迹即整体判脏并丢弃**（置空 ⇒ 走下面的空值回退），
        //   而不是把半截信封写进 facts.json。
        const rawIntent = String(ep.intent == null ? '' : ep.intent)
        const rawObject = String(ep.unresolved[0] == null ? '' : ep.unresolved[0])
        const factIntent = looksRuntimeResiduePre(rawIntent) ? '' : stripRuntimeIntentPre(rawIntent).trim()
        const factObject = looksRuntimeResiduePre(rawObject) ? '' : stripRuntimeIntentPre(rawObject).trim()
        const cand = {
          scope: 'Workspace', subject: factIntent.slice(0, 30) || 'episode', predicate: '有未决事项',
          object: factObject.slice(0, 60), sourceKind: 'inference',
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
          // issue #30:如实暴露 observationOnly —— 审批面必须能区分"可晋升技能"与"仅观察线索",
          // 否则使用者会对着一个结构上不可能晋升的条目反复点晋升。
          // ★R2（2026-09-20）：补 `promotion` 判定投影 —— 用户要「晋升原因必须显式展示」。
          //   走**纯只读**的 evaluatePromotion()，绝不在 overview 里碰 promote()（它写盘）。
          //   失败时置 null（fail-soft：判定异常不得拖垮整个面板）。
          .map((p) => {
            let promotion = null
            try {
              promotion = stores.procedures.evaluatePromotion
                ? stores.procedures.evaluatePromotion(p.procedureId)
                : null
            } catch (_) { promotion = null }
            return {
              procedureId: p.procedureId, title: p.title, stage: p.stage, riskLevel: p.riskLevel,
              evidence: p.evidence, pinned: !!p.pinned, observationOnly: isObservationOnlyPre(p),
              // R4 预览用：晋升后会注入的真实 checklist 文本
              steps: Array.isArray(p.steps) ? p.steps.slice(0, 12) : [],
              successCriteria: Array.isArray(p.successCriteria) ? p.successCriteria.slice(0, 6) : [],
              promotion,
            }
          }),
        stats: stores.procedures.getStats ? stores.procedures.getStats() : null,
      } : null,
    }
  }

  function snapshot() {
    return {
      schemaVersion: 1, namespace: 'dsh-auto-memory', policyVersion: MEMORY_HUB_POLICY_VERSION,
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
  // ★ T1-2（2026-09-19 真机追加）：这是 fact 的**第二条入口**（judgement shadow 行），
  //   与 `crossFeed` 的 fact 分支同源，同样必须过清洗器 —— 否则「补了 A 口、漏了 B 口」，
  //   脏数据仍会经本函数进入 facts.json（再被 hubFlushTick 写回 MEMORY.md）。
  //   ★ F5：清洗器按行判断，**行内混信封**时整行保留 ⇒ 再加一道 `looksRuntimeResiduePre`，
  //   命中即置空（走下面的空值回退），不把半截信封写进库。
  const rawSubject = String(row.subject == null ? '' : row.subject)
  const rawPredicate = String(row.predicate == null ? '' : row.predicate)
  const rawObject = row.object === undefined || row.object === null ? null : String(row.object)
  const cSubject = looksRuntimeResiduePre(rawSubject) ? '' : stripRuntimeIntentPre(rawSubject).trim()
  const cPredicate = looksRuntimeResiduePre(rawPredicate) ? '' : stripRuntimeIntentPre(rawPredicate).trim()
  const cObject = rawObject === null
    ? null
    : (looksRuntimeResiduePre(rawObject) ? null : (stripRuntimeIntentPre(rawObject).trim() || null))
  return {
    scope: row.scope === 'User' ? 'User' : 'Workspace',
    subject: cSubject || String(sourceIds[0]),
    predicate: cPredicate || 'relation',
    object: cObject,
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

/**
 * ④ 教训 → 观察型候选（2026-09-19 R5）。
 *
 * **用户裁定（2026-09-18 00:20）**：
 *   「**教训肯定得进 C 啊，它不自动晋升，但是可以形成候选，模型也可以通过搜索搜索到**。
 *    因为教训那边，我现在**自动注入的硬约束也是某种教训，把它上升到了约束层面**。」
 *
 * **通路设计**：
 *   `retracted` 条目 + 撤回原因（reason）→ 本函数 → `observationOnly: true` 观察型候选
 *   → `procedure-store.observe()` → **`promote()` 短路返回 `observation-only` ⇒ 永不自动晋升**
 *   → 但 `query()` 可检索到 ⇒ 模型能主动搜到「这条曾经被判错、原因是什么」。
 *
 * **三条硬约束（缺一即错）**：
 *  1. **必须 `observationOnly: true`** —— 这是「永不自动晋升」的**唯一结构保证**。
 *     若漏掉，它会变成可晋升富候选，与用户裁定直接冲突。
 *  2. **`sourceMemoryIds` 必须带被撤回条目的 id** —— 教训的 provenance 是那条 retracted 记忆本身；
 *     不得留空（留空会让 `addEvidence` 的 sourceMemoryIds 匹配计数恒零，且与
 *     episode→观察行 那条通路的语义混淆）。
 *     注意：这与 `crossFeed()` 里 `sourceMemoryIds: []` 的**有意留空不同** ——
 *     那里是"episode 只提供线索、不得凭空造 provenance"；这里 id 是**真实存在**的。
 *  3. **title/intent 必须先过信封清洗** —— 否则运行时信封会再次变成"教训标题"（H-3 同款）。
 *
 * @param {{memoryId?: string, title?: string, text?: string, reason?: string, retractedReason?: string}} row
 * @returns {object|null} procedure candidate（observationOnly），输入不合法返回 null
 */
export function lessonCandidateFromRetractedPre(row) {
  if (!row || typeof row !== 'object') return null
  const memoryId = String(row.memoryId || '').trim()
  // 只认严格锚点 id 形态：与 G3 状态行同一套判据（防任意文本被当成 provenance 拼进去）
  if (!/^mem_[0-9a-f]{32}$/.test(memoryId)) return null
  const rawTitle = String(row.title || row.text || '').trim()
  const title = stripRuntimeIntentPre(rawTitle).trim()
  if (!title) return null
  const reasonRaw = String(row.reason || row.retractedReason || '').trim()
  const reason = stripRuntimeIntentPre(reasonRaw).trim().replace(/\s+/g, ' ').slice(0, 120)
  return {
    title: ('教训：' + title).slice(0, 60),
    riskLevel: 'low',
    // 步骤形态：明说「这是一条教训」+ 撤回原因（原因才是教训的正文）
    steps: [reason ? ('曾判错，原因：' + reason + '。下次避免：' + title.slice(0, 60)) : ('曾判错：' + title.slice(0, 80))],
    // ★ 约束 1：永不自动晋升的结构保证
    observationOnly: true,
    sourceEpisodes: [],
    // ★ 约束 2：真实 provenance（非凭空构造）
    sourceMemoryIds: [memoryId],
  }
}

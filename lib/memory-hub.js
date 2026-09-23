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

export const MEMORY_HUB_POLICY_VERSION = 'memory_hub_pre_v1'

/**
 * ★A-10b（2026-09-23 用户拍板「按推荐方案全修」）：条目「观察数」= evidence 各计数之和。
 *
 * 用途：待审批列表的**主排序键**（用户指定口径：观察数降序 → 同数按时间新→旧）。
 * 只读；缺字段按 0 —— 旧快照或异常来源可能缺键（同名规范化在 procedure-store 的
 * `normalizeEvidencePre` 里，本模块不重复实现，只做无副作用的读数兜底）。
 *
 * @param {object} p 条目
 * @returns {number}
 */
function evidenceTotalPre(p) {
  const ev = (p && p.evidence) || {}
  const n = (v) => Number(v) || 0
  return n(ev.seen) + n(ev.read) + n(ev.cite) + n(ev.reuse) + n(ev.success) + n(ev.correction)
}

/** 比较器：观察数降序 → 时间新→旧（时间取自 updatedAt，缺则 createdAt，再缺按 0）。 */
function pipelineCmpPre(a, b) {
  const d = evidenceTotalPre(b) - evidenceTotalPre(a)
  if (d) return d
  const ts = (p) => Number((p && (p.updatedAt || p.createdAt)) || 0)
  return ts(b) - ts(a)
}

/**
 * ★A-10b（2026-09-23）：待审批列表排序 —— **只在投影层排，不动 store.query() 本体**。
 *
 * 为什么不在 `procedure-store.js` 的 `query()` 里加 `.sort()`：`query()` 有多个消费方
 * （hub 投影 / 测试 / 其它只读面），改它等于改所有消费方的顺序契约；而排序是**这一张列表的展示口径**。
 *
 * 用户指定口径（原话「观察数降序 → 同数按时间新→旧」）：见 `pipelineCmpPre`。
 * `Array.prototype.sort` 在本机 V8 上是稳定排序 ⇒ 同键保持 store 内原有相对顺序。
 *
 * ★调用点写法定死：必须**链在 `.filter(...).map(...)` 的尾巴上**（即 `pipeline:` 那个投影表达式的最后一段），
 *   **不得**把比较器包在 `stores.procedures.query()` 调用外面。原因：`smoke-test-r2-promotion.mjs`
 *   的 R2a-2 用**字面量锚点**（`pipeline:` 紧跟 `stores.procedures.query()`）作为源码切片起点来锁「只读路径」，
 *   包在外面会让切片起点落在别处、断言取不到 evaluatePromotion ⇒ 打红那条守卫（**实测踩过**：
 *   连本注释里逐字写出该锚点都会把 `indexOf` 引到注释上，故本注释刻意拆开写）。
 *   R2a-2 守的**语义**是「pipeline 必须从只读 query() 出发、且不得调 promote()」，
 *   链尾加排序不改变该语义 ⇒ 按守卫守的语义调整写法，不改守卫。
 */

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
  // ★T10：机械 procedure 切片开关（默认关闭；缺省值在 index.js 的 DEFAULT_CONFIG）。
  //   这里只读、不判定语义 —— 具体用途见 crossFeed() 的 procedure 分支。
  // ★A-1（2026-09-23）：机械 procedure 切片开关**已退役**（用户裁定「机械通路已被我弃用」）。
  //   原 `mechanicalProcedureFeedEnabled` 只包住 crossFeed 里那条 `intent.slice(0,40)` 分支；
  //   该分支产出的观察行既非真技能、又要用户在审批列表里手动清理 ⇒ 整段删除。
  //   ⚠️ 只删该分支：fact 分支、episode 巩固、judgement 消费一律不受影响（用户硬规矩
  //   「单一开关不得顺带改变其他功能行为」）。index.js 对应 getter 与设置项同轮一并移除。
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
  const stats = { judgedRows: 0, consumedSemantic: 0, consumedProcedure: 0, consumedEpisodic: 0, rejectedSemantic: 0, rejectedProcedure: 0, skipped: 0, checklistsRendered: 0 }

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
        // ★2026-09-22（B-3 对齐）：事实入口判据上线后 `upsert` **会**返回 `ok:false`（不是事实陈述 /
        //   缺字段等）。旧实现在此**无条件** `consumedSemantic++` 并回 `{consumed:'semantic'}`，
        //   于是宿主日志（index.js hubFeedTick 里 `if (r.consumed) fed++`）与 `?action=feed` 端点
        //   都把「被拒收」读成「已喂进去」 ⇒ 诊断面在说谎。
        //   本次只对齐口径（与下方 episodic 分支「如实区分」的既有纪律一致）：**不改任何入库行为**，
        //   拒收照样拒收，只是不再记成 consumed，并把 code/message 一路透传给人看。
        const accepted = r.ok !== false
        if (accepted) stats.consumedSemantic++
        else { stats.rejectedSemantic++; stats.skipped++ }
        if (!accepted) {
          const out = { skipped: true, reason: 'rejected-semantic', outcome: r.outcome, accepted: false }
          if (r.code) out.code = r.code
          if (r.message) out.message = r.message
          return out
        }
        return { consumed: 'semantic', outcome: r.outcome, accepted: true }
      }
      if (layer === 'procedure' && stores.procedures) {
        // 从 row 构造 procedure candidate(行内可能只有 sourceIds + 摘要)
        const cand = procedureCandidateFromRow(row)
        if (!cand) { stats.skipped++; return { skipped: true, reason: 'not-procedure' } }
        const r = stores.procedures.observe(cand)
        // ★2026-09-22：与上面 semantic 分支同一口径 —— 观察被拒（非法命令/已弃用等）不算「已消费」，
        //   否则诊断面同样会把拒收读成成功。不改 observe 的任何入库行为。
        const accepted = r.ok !== false
        if (accepted) stats.consumedProcedure++
        else { stats.rejectedProcedure++; stats.skipped++ }
        return accepted
          ? { consumed: 'procedure', outcome: 'observed', accepted: true }
          : { skipped: true, reason: 'rejected-procedure', outcome: r.reason, accepted: false }
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
    // issue #110 的剩余缺口：批内合并落盘此前**只挂在宿主的喂数定时循环上**（index.js 里
    // 手动 beginBatch/endBatch）。于是走 `ingestJudgementRows` 的其它批量入口——HTTP
    // `/memory-hub` 的 `action=feed`（面板/外部重放器喂一整批判据）——仍是 N 行 = N 次整份快照写盘，
    // 正是写放大。把批语义收到"拥有这批行"的这一层，任何批量入口都自动只落一次。
    // 外层若已自己开批（喂数循环），beginBatch 的 depth 计数保证内层 end 不会提前落盘。
    const batch = opts.batch
    const canBatch = batch && typeof batch.beginBatch === 'function' && typeof batch.endBatch === 'function'
    if (!canBatch) {
      const out = []
      for (const r of rows) out.push(ingestJudgement(r))
      return { results: out }
    }
    batch.beginBatch()
    const out = []
    let batchResult = null
    try {
      for (const r of rows) out.push(ingestJudgement(r))
    } finally {
      // 批末必落：中途抛错也不能把已接受的改动留在内存里等下次。
      // ★不在 finally 里 return —— 那会吞掉正在传播的异常（静默失败的同一种形状）。
      batchResult = batch.endBatch() || null
    }
    if (batchResult && batchResult.ok === false) {
      log('memory-hub batch persist failed: ' + JSON.stringify((batchResult.errors || []).slice(-1)))
    }
    return { results: out, batch: batchResult }
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
      // ★A-1（2026-09-23，用户裁定「机械通路已被我弃用」）：**机械 procedure 切片整段删除**。
      //   这里原本是 `intent.slice(0,40)` 造观察行 —— 无模型介入、产出的既不是技能名也不是
      //   步骤，只会堆在审批列表里等用户手动清理。开关 `hubMechanicalProcedureFeedEnabled`
      //   及其设置项、getter 同轮一并移除（该开关只服务这一条分支）。
      //   ⚠️ 只删这一段：下方 fact 分支、episode 巩固、judgement 消费一律不受影响
      //   （用户硬规矩「单一开关不得顺带改变其他功能的行为」）。
      //   ⇒ procedural 线的写入自此只剩两条正经通路：模型直写 memory_procedure、用户手动。
      // ★M8-R2（2026-09-23，用户拍板）：**删除「情节 → 事实」这条设计外的边**。
      //   背景：设计图的三个 store 输入是分开画的 —— 事实吃判定影子的语义/画像候选，
      //   情节只喂技能。本处曾多出一条图上没有的边，判据仅要求待决数组非空，
      //   而待决抽取是「凡含问号即命中」的纯正则 ⇒ **用户随口一问即被当成事实来源**。
      //
      //   实测后果（报告 docs/internal/M8-PATHWAY-REVIEW-20260923.md §3）：
      //   该边累计产出 11 条事实，**11/11 全部是用户口语残句**（谓词统一为「有未决事项」），
      //   零条可用知识；其中一条经回写通路进入项目长期记忆并被每轮无条件注入，
      //   导致下一轮把一段过期的用户原话当成实时指令执行。
      //
      //   ⇒ 判据：**情节记录的是「发生过什么」，不是「世界是什么样」**。
      //     会话状态（未决事项）属过程数据，不得升格为长期记忆。
      //     本边删除后，事实层的输入只剩设计规定的两条（判定影子 + 解析富化）。
      //   ⚠️ 只删这一条边：下方 episode 巩固、judgement 消费、技能观察一律不受影响。
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
        // ★M8-B 第6步（2026-09-23）：投影**必须带上归属库**。前端双库视图要回答
        //   「这条技能属于哪个库」，而缺省语义是 `global`（字段缺失=通用库，见
        //   procedure-store.js 的 PROCEDURE_DEFAULT_SCOPE_PRE_V1）⇒ 这里显式补齐缺省，
        //   让前端拿到的是**已解释过**的值，而不是「undefined 该当通用库还是未知」。
        //   纯增字段：既有消费方按名取用，不受影响（同 A-10b 补 updatedAt/createdAt 的手法）。
        active: stores.procedures.activeProcedures().map((p) => ({ procedureId: p.procedureId, title: p.title, stage: p.stage, riskLevel: p.riskLevel, evidence: p.evidence, scope: p.scope === 'workspace' ? 'workspace' : 'global', workspaceRef: p.workspaceRef || '', addedBy: p.addedBy || '' })),
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
              // ★A/B（2026-09-22）：把「人工能否越过」并进**同一条**只读投影。
              //   界面据此决定要不要给「强制晋升（人工）」按钮：只有统计门拦时才给，
              //   结构门拦时不给（避免再造一个「点了没反应」的假通道 —— 那正是 A-9 收掉旧按钮的原因）。
              //   注意：**不改 evaluatePromotion 的签名与函数体**（smoke-test-r2-promotion-pre.mjs
              //   用字面正则锁签名、用源码切片锁门限顺序）；promotionOverrideView 只读、只复用其结论。
              if (promotion && stores.procedures.promotionOverrideView) {
                const ov = stores.procedures.promotionOverrideView(p.procedureId)
                if (ov && ov.ok !== false) {
                  promotion.overridable = ov.overridable === true
                  promotion.gateKind = ov.gateKind
                }
              }
            } catch (_) { promotion = null }
            return {
              procedureId: p.procedureId, title: p.title, stage: p.stage, riskLevel: p.riskLevel,
              evidence: p.evidence, pinned: !!p.pinned, observationOnly: isObservationOnlyPre(p),
              // ★M8-B 第6步（2026-09-23）：归属库 + 添加者，供前端「这条属于哪个库」与
              //   转移操作（提升为全局 / 收纳到工作区）。缺省显式补齐为 global（同 active 投影）。
              scope: p.scope === 'workspace' ? 'workspace' : 'global',
              workspaceRef: p.workspaceRef || '', addedBy: p.addedBy || '',
              // ★A-10b（2026-09-23）：排序的次键需要时间戳 —— 投影行**必须带上**，
              //   否则 sortPipelinePre 的 `updatedAt || createdAt` 恒为 0，同观察数时退化成磁盘序。
              //   纯增字段（既有消费方按名取用，不受影响）。
              updatedAt: p.updatedAt, createdAt: p.createdAt,
              // R4 预览用：晋升后会注入的真实 checklist 文本
              steps: Array.isArray(p.steps) ? p.steps.slice(0, 12) : [],
              successCriteria: Array.isArray(p.successCriteria) ? p.successCriteria.slice(0, 6) : [],
              promotion,
            }
          }).sort(pipelineCmpPre),
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
  // ★A-2（2026-09-23，用户报「技能库里全是『流程 d3c24f99』这种一句话」）：
  //   **没有真标题就不生成候选** —— 旧实现用 `'流程 ' + sourceIds[0].slice(-8)` 兜底，
  //   于是一条只有 memoryId 的行会被造成「流程 xxxxxxxx」的技能，库里 9 条此类占位。
  //   兜底是"为了不丢行"，但对技能库而言**造一条垃圾比丢一条行更贵**：它会出现在
  //   审批列表、可能被注入、还要用户手动清理。⇒ 改为拒收（返回 null，上层按 not-procedure 跳过）。
  //   判据与 procedureCandidateFromRow 的其余校验同源：**宁缺毋滥**。
  const title = String(row.title || '').trim()
  if (!title) return null
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

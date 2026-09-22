import { isObservationOnlyPre, normalizeProcedureObservationPre, matchingProcedurePre, mergeProcedureSourcesPre, newProcedureIdentityPre } from './procedure-observation.js'
/**
 * M8-2 Procedural Store 纯核心(docs/proactive-associative-memory-system-map.html M-04 Procedural)。
 * 纯内存状态机,零 IO、零依赖(node:crypto 仅作确定性身份);持久化通过可注入 IO 接口,
 * Host 接线时才接真实文件(本模块自身不读写磁盘,测试用内存 IO)。
 *
 * ★ 这是「记忆中枢」的核心价值层:把多次使用的固定流程固化成 skill,
 *   让 M7 记忆召回系统在相似场景自动召回这些 skill,AI 按固定流程执行。
 *
 * 生命周期状态机(M-04 元代码逐行落地;P2-3 收敛为两态跳变):
 *   observed → validated → active → deprecated
 *   注:原枚举含 `candidate`,但全仓**无任何** stage='candidate' 写入点(observe 只产 observed、
 *   promote 直接 observed→validated)⇒ 它是死状态,已从枚举移除;旧快照若含该 stage,
 *   restore() 按"两态跳变"语义归入 observed(不静默丢弃)。
 *
 * 晋升规则(promote, 元代码原样):
 *   - sessionDiversity ≥ 3(跨独立会话)且 successCount ≥ 2 → 可晋升
 *   - correctionRate > MAX_CORRECTION 或 contradictions → 保持 observed
 *   - 无 successCriteria 或 无 cross-session evidence → 保持 observed
 *   - riskLevel=high 且未用户批准 → 返回 {decision:'ask'} 等待批准
 *   - 一次成功或三次重复均不足以证明可靠(元代码铁律)
 *
 * ★ ok 与 promoted 的语义差异(P2-5,2026-09-21):
 *   promote() 的 `ok` 只表示**这次调用被正常处理**(未抛错、未命中 disposed/not-found),
 *   **拒绝晋升同样是 ok:true**;要判断"到底晋升了没有"必须读 `promoted`(boolean)。
 *   加这个字段的原因:宿主 lib/index.js:10934-10936 记录过该坑 —— 旧日志只记 `r.ok`,
 *   于是"拒绝晋升"与"晋升成功"都写成 ok:true 的假阳性,事后完全看不出是否晋升。
 *   `ok` 语义保持不变(兼容既有调用方);新增调用方请以 `promoted` 为准。
 *
 * ★ 落盘失败可见(A-8,2026-09-21):
 *   凡走 persist() 的写操作,返回值都带 `persisted:boolean`;为 false 时附
 *   `persistReason` 与 `persistFailures`,getStats() 另透出 `persistFailures`/`lastPersistError`。
 *   此前 persist() 用**空 catch** 吞掉落盘失败 ⇒ 写盘坏了无从察觉(本模块零依赖、不打日志,
 *   故只能靠返回值与 stats 留痕)。
 *
 * ★ 人工批准只解一道门(B-1,2026-09-21):
 *   高风险条目入库时 `approved = c.riskLevel !== 'high'` ⇒ 恒为 false,而在此之前**全仓没有任何代码**
 *   能把它置真 ⇒ promote() 走到高风险门只能返回 `{decision:'ask', reasonCodes:['high-risk-awaiting-approval']}`,
 *   高风险技能永远晋升不了(死路)。`approve(procedureId, by)` 就是那条唯一的解门通路:
 *     · 它**只**置 `approved/approvedAt/approvedBy/updatedAt` 并落盘 —— 不改 stage、不触发晋升;
 *     · 它**不跳过** promote() 的另外五道结构门(已弃用短路 / 纯观察行短路 / 缺 successCriteria /
 *       纠正率超限 / 存在纠正记录):批准后仍可能被这些门拒绝,必须再调 promote() 才知道最终结果;
 *     · 所以 `approved:true` 的语义是**"高风险这道门不再拦"**,不是"这条已晋升/已激活"。
 *   返回的 `reason` 一律取自**冻结的机器码集合**(`not-found` / `stage-deprecated` / `disposed`),
 *   人类可读文案由消费端(前端/工具文案层)做映射 —— 码值稳定可枚举,不随文案变化。
}
 *
 * 渐进激活(M6 六级 level):
 *   index → hint → excerpt → checklist → resource → full
 *   高风险工具(SSH/部署/删除)永不因相似度自动执行。
 *
 * 输出:active procedure 渲染成 checklist 注入包(M6 Reference Tail 的 checklist level),
 *       供 M7 召回系统在相似场景自动召回。
 *
 * 与 M5 evidence 衔接:promote 读 evidence stats(seen/read/cite/reuse/success/correction),
 *   由调用方传入(本模块不直接读 evidence store,保持纯核心)。
 *
 * 全部同输入确定; UTF-8 无 BOM。
 */
import { createHash } from 'node:crypto'

// ========== 冻结常量 ==========

export const PROCEDURE_POLICY_VERSION = 'procedure_store_v1'
export const PROCEDURE_ID_PREFIX = 'proc_'
export const PROCEDURE_ID_RE = /^proc_[0-9a-f]{32}$/

/** 阶段枚举(M-04 元代码)。P2-3:移除死状态 'candidate' —— 全仓无写入点,
 *  observe 只产 observed、promote 直接 observed→validated(两态跳变)。 */
export const PROCEDURE_STAGES_V1 = Object.freeze(['observed', 'validated', 'active', 'deprecated'])

/** 自动归档老化(Hermes curator 借鉴,2026-08-28):active 技能 lastUsedAt 超过
 *  PROCEDURE_ARCHIVE_AFTER_DAYS_V1 天未使用且未 pinned → 自动 deprecated
 *  (reason=auto-archive-inactive;deprecated 可恢复,永不物理删除)。
 *  observed/validated 不老化——它们由晋升门槛时间控(P2-3 后已无 candidate 态)。 */
export const PROCEDURE_ARCHIVE_AFTER_DAYS_V1 = 90

/** 风险等级枚举。 */
export const PROCEDURE_RISKS_V1 = Object.freeze(['low', 'medium', 'high'])

/** 激活等级(M6 六级契约)。 */
export const PROCEDURE_LEVELS_V1 = Object.freeze(['index', 'hint', 'excerpt', 'checklist', 'resource', 'full'])

/** 晋升门槛(可调参数,默认值来自 M-04 元代码): 跨会话多样性≥3, 成功≥2。 */
export const PROCEDURE_DEFAULT_GATES_V1 = Object.freeze({
  minSessionDiversity: 3,
  minSuccessCount: 2,
  maxCorrectionRate: 0.3,   // correction 占总证据比例上限
  maxContradictions: 0,     // 矛盾数上限(0=任何矛盾都阻止)
  highRiskRequiresApproval: true,
})

/** 一次成功或三次重复都不足以证明可靠 → 需要的最小成功数(元代码铁律)。 */
export const PROCEDURE_MIN_SUCCESS_V1 = 2

/** active 后可注入的默认 level(渐进激活;高风险降级为 hint)。 */
export const PROCEDURE_ACTIVE_LEVEL_V1 = 'checklist'

/** procedure 校验(固化/读回)。 */
export function validateProcedurePre(p) {
  const q = []
  if (!p || typeof p !== 'object' || Array.isArray(p)) return { ok: false, reason: 'not-object' }
  if (typeof p.procedureId !== 'string' || !PROCEDURE_ID_RE.test(p.procedureId)) q.push('procedureId')
  if (!PROCEDURE_STAGES_V1.includes(p.stage)) q.push('stage')
  if (!PROCEDURE_RISKS_V1.includes(p.riskLevel)) q.push('riskLevel')
  if (typeof p.title !== 'string' || !p.title.trim()) q.push('title')
  if (!Array.isArray(p.sourceMemoryIds)) q.push('sourceMemoryIds')
  if (!Array.isArray(p.sourceEpisodes)) q.push('sourceEpisodes')
  if (!Array.isArray(p.steps) || !p.steps.length) q.push('steps')
  if (!Array.isArray(p.checks)) q.push('checks')
  if (!Array.isArray(p.successCriteria)) q.push('successCriteria')
  if (!Array.isArray(p.rollback)) q.push('rollback')
  if (typeof p.createdAt !== 'number' || !Number.isFinite(p.createdAt)) q.push('createdAt')
  if (p.requiresApproval !== undefined && typeof p.requiresApproval !== 'boolean') q.push('requiresApproval')
  // issue #30:observationOnly 可选字段,类型必须显式校验(否则脏值会静默通过校验层)。
  if (p.observationOnly !== undefined && typeof p.observationOnly !== 'boolean') q.push('observationOnly')
  // 2026-08-28 Hermes 借鉴字段(可选,向后兼容旧快照):lastUsedAt/pinned/origin
  if (p.lastUsedAt !== undefined && (typeof p.lastUsedAt !== 'number' || !Number.isFinite(p.lastUsedAt))) q.push('lastUsedAt')
  if (p.pinned !== undefined && typeof p.pinned !== 'boolean') q.push('pinned')
  if (p.origin !== undefined && !['agent', 'user'].includes(p.origin)) q.push('origin')
  // ★A-6(2026-09-21):evidence 形状校验。此前清单里**没有 evidence** ⇒
  //   ① 缺键时 promote() 的 `ev.seen + ev.read + …` 得 NaN,`NaN > cap` 为 false **静默放行**;
  //   ② evidence 整个缺失时 addEvidence 抛 TypeError,被宿主 lib/index.js:7644 空 catch 吞掉。
  //   兼容策略:**存在即须为对象且各计数为有限数;缺失不 reject**(旧快照本就无此字段),
  //   由 restore()/addEvidence() 用 normalizeEvidencePre 补零 —— 比"拒绝入袋"更安全(不丢条目)。
  if (p.evidence !== undefined) {
    if (!p.evidence || typeof p.evidence !== 'object' || Array.isArray(p.evidence)) q.push('evidence')
    else {
      for (const k of ['seen', 'read', 'cite', 'reuse', 'success', 'correction', 'sessions']) {
        const vv = p.evidence[k]
        if (vv !== undefined && (typeof vv !== 'number' || !Number.isFinite(vv))) q.push('evidence.' + k)
      }
    }
  }
  if (q.length) return { ok: false, reason: 'invalid:' + q.join(',') }
  return { ok: true, procedure: p }
}

/** ProcedureCandidate 校验(observe/candidate 输入)。 */
export function validateProcedureCandidatePre(c) {
  const p = []
  if (!c || typeof c !== 'object' || Array.isArray(c)) return { ok: false, reason: 'not-object' }
  if (typeof c.title !== 'string' || !c.title.trim()) p.push('title')
  if (!PROCEDURE_RISKS_V1.includes(c.riskLevel || 'low')) p.push('riskLevel')
  if (!Array.isArray(c.steps) || !c.steps.length) p.push('steps')
  if (c.successCriteria !== undefined && !Array.isArray(c.successCriteria)) p.push('successCriteria')
  if (c.sourceMemoryIds !== undefined && !Array.isArray(c.sourceMemoryIds)) p.push('sourceMemoryIds')
  if (c.sourceEpisodes !== undefined && !Array.isArray(c.sourceEpisodes)) p.push('sourceEpisodes')
  if (c.preconditions !== undefined && !Array.isArray(c.preconditions)) p.push('preconditions')
  if (c.checks !== undefined && !Array.isArray(c.checks)) p.push('checks')
  if (c.rollback !== undefined && !Array.isArray(c.rollback)) p.push('rollback')
  if (c.observationOnly !== undefined && typeof c.observationOnly !== 'boolean') p.push('observationOnly')
  if (p.length) return { ok: false, reason: 'invalid:' + p.join(',') }
  return { ok: true, candidate: c }
}

/**
 * Procedural Store 工厂。
 * @param {object} opts
 * @param {object} opts.io      可选持久化 { save(snapshot), load() → snapshot, clear() }
 * @param {function} opts.now   可选时钟
 * @param {function} opts.approve 可选用户批准回调(high-risk 时调用;测试注入)
 * @param {object} opts.gates   { minSessionDiversity, minSuccessCount, maxCorrectionRate, maxContradictions, highRiskRequiresApproval }
 */
export function createProcedureStorePre(opts = {}) {
  const io = opts.io || { save() {}, load() { return null }, clear() {} }
  const nowFn = typeof opts.now === 'function' ? opts.now : () => Date.now()
  const approveFn = typeof opts.approve === 'function' ? opts.approve : null
  // 2026-08-30:gates 保留调用方对象引用(支持 getter 活读配置);缺省才用冻结默认。
  // 注意:不可 Object.assign 展开——会立即求值 getter 并冻结挂载时的配置快照。
  const gates = opts.gates || PROCEDURE_DEFAULT_GATES_V1
  const activeLevel = opts.activeLevel || PROCEDURE_ACTIVE_LEVEL_V1

  let procedures = []      // 全部 procedure(各 stage)
  let disposed = false
  // P2-3:删除死字段 stats.candidates —— 全仓无 stage='candidate' 写入点,该计数永远为 0。
  // B-1(2026-09-21):approved = **真的写下去**的人工批准次数(只统计 approve() 的写入分支;
  //   notRequired / alreadyApproved 是幂等空操作,不计数 —— 它们没有新增任何批准留痕)。
  const stats = { observed: 0, validated: 0, activated: 0, deprecated: 0, approvalAsked: 0, approved: 0 }
  // A-8:落盘失败痕迹(本模块零依赖不打日志,故只能留在这里供 getStats() 透出)。
  let persistFailures = 0
  let lastPersistError = null

  /** 证据计数键与回填函数(A-6)。放模块级以免每次调用重建闭包。 */
  function emptyEvidencePre() {
    return { seen: 0, read: 0, cite: 0, reuse: 0, success: 0, correction: 0, sessions: 0 }
  }
  function normalizeEvidencePre(ev) {
    const out = emptyEvidencePre()
    if (ev && typeof ev === 'object' && !Array.isArray(ev)) {
      for (const k of Object.keys(out)) {
        const v = ev[k]
        if (typeof v === 'number' && Number.isFinite(v)) out[k] = v
      }
    }
    return out
  }


  // ---- 观察: 从 episode 或 judgement-shadow 的 procedure_candidate 进入 observed/candidate ----
  function observe(cand) {
    if (disposed) return { ok: false, reason: 'disposed' }
    const v = validateProcedureCandidatePre(cand)
    if (!v.ok) return { ok: false, reason: v.reason }
    const c = v.candidate
    const now = nowFn()
    // issue #30 根因:旧实现按 `title` 去重 —— episode 自动观察出的"仅观察行"通常先建,
    // 之后带真实步骤/成功判据的富候选**同名**时会被合并进观察行,而合并只拷贝证据源字段,
    // 富候选的 steps/successCriteria **整体丢失** ⇒ promote() 永远卡在 `no-success-criteria`,
    // 技能永远无法晋升。修法:① 先把历史行归一化出 observationOnly 标记;
    // ② 用**指纹**(含 steps/criteria/rollback 等全部实质字段)匹配,仅观察行与富候选
    // 指纹不同 ⇒ 各自独立成行,互不污染(标题不是身份)。
    procedures = procedures.map(normalizeProcedureObservationPre)
    const existing = matchingProcedurePre(procedures, c)
    if (existing) {
      mergeProcedureSourcesPre(existing, c)
      existing.updatedAt = now
      void persist()
      return { ok: true, procedure: existing, merged: true }
    }
    const p = {
      procedureId: newProcedureIdentityPre(c, now, procedures, PROCEDURE_ID_PREFIX),
      title: c.title,
      stage: 'observed',
      riskLevel: c.riskLevel || 'low',
      requiresApproval: c.riskLevel === 'high' && gates.highRiskRequiresApproval,
      // issue #30:入参数组一律深拷一层,避免调用方后续改动把已入账记录改脏(与 PR#36 口径一致)。
      sourceMemoryIds: [...new Set(c.sourceMemoryIds || [])],
      sourceEpisodes: [...new Set(c.sourceEpisodes || [])],
      preconditions: (c.preconditions || []).slice(),
      steps: c.steps.slice(),
      checks: (c.checks || []).slice(),
      successCriteria: (c.successCriteria || []).slice(),
      rollback: (c.rollback || []).slice(),
      createdAt: now,
      updatedAt: now,
      lastUsedAt: now,
      pinned: false,
      origin: c.origin === 'user' ? 'user' : 'agent',
      // issue #30:纯 episode 观察行显式打标 —— 它没有 successCriteria,永远不该晋升,
      // 也不该与富候选互相污染(此前无标记,只能靠 title 撞车后丢字段)。
      ...(isObservationOnlyPre(c) ? { observationOnly: true } : {}),
      evidence: { seen: 0, read: 0, cite: 0, reuse: 0, success: 0, correction: 0, sessions: 0 },
      approved: c.riskLevel !== 'high',
    }
    const pv = validateProcedurePre(p)
    if (!pv.ok) return { ok: false, reason: 'procedure-invalid:' + pv.reason }
    procedures.push(pv.procedure)
    stats.observed++
    void persist()
    return { ok: true, procedure: pv.procedure, merged: false }
  }

  /**
   * 证据喂入(由调用方在 M5 evidence 落盘后调)。
   * @param {string} procedureId
   * @param {object} ev  { kind: 'seen'|'read'|'cite'|'reuse'|'success'|'correction', sessionRef? }
   */
  function addEvidence(procedureId, ev) {
    if (disposed) return { ok: false, reason: 'disposed' }
    const p = procedures.find((x) => x.procedureId === procedureId)
    if (!p) return { ok: false, reason: 'not-found' }
    if (!ev || typeof ev !== 'object' || !['seen', 'read', 'cite', 'reuse', 'success', 'correction'].includes(ev.kind)) {
      return { ok: false, reason: 'bad-evidence' }
    }
    // ★A-6(2026-09-21)收尾:自增前必须先规范化 —— 旧快照/异常来源可能缺键,
    //   裸 `p.evidence[ev.kind]++` 会得 NaN(静默污染 promote 的门限算术)或抛 TypeError
    //   (被宿主 lib/index.js:7644 空 catch 吞掉 ⇒ 表现为「证据永远不累积」且无留痕)。
    p.evidence = normalizeEvidencePre(p.evidence)
    if (p.evidence[ev.kind] !== undefined) p.evidence[ev.kind]++
    // session 去重
    if (ev.sessionRef) {
      if (!p._sessions) p._sessions = new Set()
      p._sessions.add(String(ev.sessionRef))
      p.evidence.sessions = p._sessions.size
    }
    p.updatedAt = nowFn()
    p.lastUsedAt = p.updatedAt // 任何真实证据都算活动(Hermes: last_activity_at 驱动老化)
    void persist()
    return { ok: true, evidence: { ...p.evidence } }
  }

  /** 活动触点(act.skill 命中注入/用户手动调用时):驱动自动归档老化的时钟。 */
  function touch(procedureId) {
    const p = procedures.find((x) => x.procedureId === procedureId)
    if (!p) return { ok: false, reason: 'not-found' }
    p.lastUsedAt = nowFn()
    void persist()
    return { ok: true, lastUsedAt: p.lastUsedAt }
  }

  /** 置顶/取消置顶(pinned 豁免自动归档与 agent 改写——Hermes curator 不变量)。 */
  function setPinned(procedureId, v) {
    const p = procedures.find((x) => x.procedureId === procedureId)
    if (!p) return { ok: false, reason: 'not-found' }
    p.pinned = v === true
    p.updatedAt = nowFn()
    void persist()
    return { ok: true, pinned: p.pinned }
  }

  /** 确定性老化(Hermes apply_automatic_transitions 移植):active 且未 pinned 且
   *  lastUsedAt 超过 ARCHIVE_AFTER_DAYS → deprecated(auto-archive-inactive)。
   *  只归档不删除;返回变更计数。 */
  function applyAutomaticTransitions(nowTs) {
    const now = Number.isFinite(nowTs) ? nowTs : nowFn()
    const cutoff = now - PROCEDURE_ARCHIVE_AFTER_DAYS_V1 * 86400000
    const counts = { checked: 0, archived: 0 }
    for (const p of procedures) {
      counts.checked++
      if (p.stage !== 'active' || p.pinned) continue
      const last = Number.isFinite(p.lastUsedAt) ? p.lastUsedAt : (p.updatedAt || p.createdAt)
      if (last < cutoff) {
        p.stage = 'deprecated'
        p.deprecatedAt = now
        p.deprecateReason = 'auto-archive-inactive'
        stats.deprecated++
        counts.archived++
      }
    }
    if (counts.archived) void persist()
    return counts
  }

  /**
   * 晋升判定(M-04 元代码 promote 逐行)。
   * 返回 { decision: 'promote'|'keep'|'ask', procedure, reasonCodes }
   *
   * ★ T4（2026-09-19 用户拍板「让大模型来介入」）：新增第三个参数 `opts`。
   *   `opts.authorizedBy`（如 'model'）= **模型显式授权**，用于跳过两条**统计证据门**
   *   （`minSessionDiversity` / `minSuccessCount`）。
   *
   *   为什么需要它：这两条门是给**机械生成**的观察行用的防污染护栏 —— 它们靠"反复出现"累积证据。
   *   但机械路径产出的条目 13/14 是空壳（`actions=['user','user','user']` 切出来的），
   *   而**模型主动写出的技能**（带真 steps + successCriteria）**天生没有历史证据**，
   *   若不放行则永远卡在 `diversity-below-3` ⇒ 模型通路等于白建。
   *
   *   **仍然保留的护栏（授权也不放行）**：
   *     · `deprecated` 短路 —— 已弃用的不得复活；
   *     · `isObservationOnlyPre` 短路 —— 结构上不该晋升的行，授权也拦；
   *     · **`no-success-criteria` 必须有**（在下方）—— 没写验收标准的不算技能；
   *     · `correction-rate` / `has-correction` —— 有纠正记录说明这流程是错的。
   *   并**留痕**：`p.authorizedBy` + reasonCodes 追加 `model-authorized`，供审计与前端展示。
   */
  function promote(procedureId, extraEvidence = {}, opts = {}) {
    if (disposed) return { ok: false, promoted: false, reason: 'disposed' }
    const p = procedures.find((x) => x.procedureId === procedureId)
    if (!p) return { ok: false, promoted: false, reason: 'not-found' }
    if (p.stage === 'deprecated') return { ok: true, promoted: false, decision: 'keep', reasonCodes: ['deprecated'] }
    // issue #30:纯 episode 观察行没有 successCriteria,本来就无法晋升;
    // 显式短路并给出 `observation-only` 原因码,而不是让它落到下面报 `no-success-criteria`
    // (后者会让使用者误以为"缺判据、补上就能晋升",其实是这行**结构上**不该晋升)。
    // ★ T4:此短路**不受授权影响** —— 结构上不该晋升的行,模型授权也不放行。
    if (isObservationOnlyPre(p)) return { ok: true, promoted: false, decision: 'keep', procedure: p, reasonCodes: ['observation-only'] }

    const ev = p.evidence
    const reason = []
    const authorizedBy = opts && opts.authorizedBy ? String(opts.authorizedBy) : ''
    // ★A/B（2026-09-22）：授权来源分人留痕 —— 人工越权与模型越权必须在审计面可区分。
    //   注意：此行的形态变化会让 r2 的「源码级原因码提取」不再捕获它（正则要求引号紧跟括号），
    //   这正是期望的：它本来就属 AUTH_ONLY 集合、需被排除在门限顺序比对之外。
    if (authorizedBy) reason.push(authorizedBy === 'user' ? 'user-authorized' : 'model-authorized')
    // 跨会话多样性
    const diversity = extraEvidence.distinctSessions != null ? extraEvidence.distinctSessions : ev.sessions
    const successCount = extraEvidence.successCount != null ? extraEvidence.successCount : ev.success
    // ★ T4:两条**统计证据门**在模型授权下跳过(见上方函数注释);未授权时行为逐字节不变。
    if (!authorizedBy) {
      if (diversity < gates.minSessionDiversity) { reason.push('diversity-below-' + gates.minSessionDiversity); return { ok: true, promoted: false, decision: 'keep', procedure: p, reasonCodes: reason } }
      if (successCount < gates.minSuccessCount) { reason.push('success-below-' + gates.minSuccessCount); return { ok: true, promoted: false, decision: 'keep', procedure: p, reasonCodes: reason } }
    }
    // correction 率
    const total = ev.seen + ev.read + ev.cite + ev.reuse + ev.success + ev.correction
    const corrRate = total > 0 ? ev.correction / total : 0
    if (corrRate > gates.maxCorrectionRate) { reason.push('correction-rate-' + corrRate.toFixed(2)); return { ok: true, promoted: false, decision: 'keep', procedure: p, reasonCodes: reason } }
    // contradictions
    if (gates.maxContradictions === 0 && ev.correction > 0) { reason.push('has-correction'); return { ok: true, promoted: false, decision: 'keep', procedure: p, reasonCodes: reason } }
    // successCriteria 必须有(元代码: 无 successCriteria → keepCandidate)
    if (!p.successCriteria.length) { reason.push('no-success-criteria'); return { ok: true, promoted: false, decision: 'keep', procedure: p, reasonCodes: reason } }
    // 高风险需批准
    if (p.requiresApproval && !p.approved) {
      if (approveFn) {
        const apr = approveFn(p)
        if (apr && apr.approved) p.approved = true
        else { stats.approvalAsked++; reason.push('high-risk-awaiting-approval'); return { ok: true, promoted: false, decision: 'ask', procedure: p, reasonCodes: reason } }
      } else {
        stats.approvalAsked++
        reason.push('high-risk-awaiting-approval')
        return { ok: true, promoted: false, decision: 'ask', procedure: p, reasonCodes: reason }
      }
    }
    // 晋升
    p.stage = 'validated'
    p.updatedAt = nowFn()
    // ★ T4:授权晋升留痕 —— 前端与审计面必须能看出「这条是模型授权跳门进来的」,
    //   否则日后无法区分「统计证据充分」与「模型判断值得」两种来源。
    if (authorizedBy) p.authorizedBy = authorizedBy
    stats.validated++
    void persist()
    return { ok: true, promoted: true, decision: 'promote', procedure: p, reasonCodes: reason }
  }

  /**
   * ★R2（2026-09-20 用户要求「晋升原因必须看得见」）：**纯只读**晋升判定投影。
   *
   * 与 `promote()` 的关系：**逐行复制其门限判定，但不改任何状态**。
   * 为什么不能直接调 `promote()`：它含真实副作用
   * （`stats.approvalAsked++` / `p.stage='validated'` / `stats.validated++` / `persist()` 写盘），
   * 在 `overview()` 这类只读轮询路径里调用会**污染统计并把候选悄悄提升**。
   * ⇒ 只读面必须走本函数（用户 2026-09-18 冻结纪律）。
   *
   * ⚠️ 维护约定：改 `promote()` 的门限时**必须同步改这里**，否则前端会展示过时的判据。
   * 两者的一致性由测试 `smoke-test-r2-promotion-pre.mjs` 用变异兜底。
   *
   * @returns {{ok:boolean, decision?:string, reasonCodes?:string[], detail?:object}}
   */
  function evaluatePromotion(procedureId) {
    const p = procedures.find((x) => x.procedureId === procedureId)
    if (!p) return { ok: false, reason: 'not-found' }
    if (p.stage === 'deprecated') return { ok: true, decision: 'keep', reasonCodes: ['deprecated'] }
    if (isObservationOnlyPre(p)) return { ok: true, decision: 'keep', reasonCodes: ['observation-only'] }
    const ev = p.evidence || { seen: 0, read: 0, cite: 0, reuse: 0, success: 0, correction: 0, sessions: 0 }
    const reason = []
    const diversity = Number(ev.sessions) || 0
    const successCount = Number(ev.success) || 0
    const total = (Number(ev.seen) || 0) + (Number(ev.read) || 0) + (Number(ev.cite) || 0)
      + (Number(ev.reuse) || 0) + successCount + (Number(ev.correction) || 0)
    const corrRate = total > 0 ? (Number(ev.correction) || 0) / total : 0
    // ⚠️ 顺序必须与 promote() **完全一致**（先返回的那个才决定前端文案）
    if (diversity < gates.minSessionDiversity) {
      reason.push('diversity-below-' + gates.minSessionDiversity)
      return { ok: true, decision: 'keep', reasonCodes: reason, detail: { diversity, need: gates.minSessionDiversity } }
    }
    if (successCount < gates.minSuccessCount) {
      reason.push('success-below-' + gates.minSuccessCount)
      return { ok: true, decision: 'keep', reasonCodes: reason, detail: { successCount, need: gates.minSuccessCount } }
    }
    if (corrRate > gates.maxCorrectionRate) {
      reason.push('correction-rate-' + corrRate.toFixed(2))
      return { ok: true, decision: 'keep', reasonCodes: reason, detail: { corrRate, cap: gates.maxCorrectionRate } }
    }
    if (gates.maxContradictions === 0 && (Number(ev.correction) || 0) > 0) {
      reason.push('has-correction')
      return { ok: true, decision: 'keep', reasonCodes: reason, detail: { corrections: Number(ev.correction) || 0 } }
    }
    if (!p.successCriteria || !p.successCriteria.length) {
      reason.push('no-success-criteria')
      return { ok: true, decision: 'keep', reasonCodes: reason }
    }
    if (p.requiresApproval && !p.approved) {
      reason.push('high-risk-awaiting-approval')
      return { ok: true, decision: 'ask', reasonCodes: reason }
    }
    return { ok: true, decision: 'promote', reasonCodes: reason, detail: { diversity, successCount } }
  }

  /**
   * ★A/B（2026-09-22）：**人工可越权性**只读投影 —— 回答「这道 keep 人能不能强制越过」。
   *
   * 为什么单独一个函数、而不是给 evaluatePromotion 加参数：
   *   · `smoke-test-r2-promotion-pre.mjs` 用**字面正则**锁住了 `evaluatePromotion(procedureId)` 的签名，
   *     并用**源码切片**比对它与 `promote()` 的 reason.push 序列；动它的签名或函数体会同时打红两条守卫。
   *   · 更要紧的是「不重复实现门限」：本函数**不重写任何一道门**，而是复用 evaluatePromotion 的结论，
   *     只判断「拦它的原因码里是否**只有**那两道统计门」。
   *
   * 语义依据（与 `promote()` 逐条对齐，见 :368 `if (!authorizedBy) {`）：
   *   · 被授权时**只**跳过 `diversity-below-*` 与 `success-below-*` 两道统计门；
   *   · 结构门（deprecated / observation-only / correction-rate-* / has-correction /
   *     no-success-criteria / high-risk-awaiting-approval）**授权也拦**
   *     ⇒ 只要原因码里出现其中任何一个，就**不可越权**（界面上不该给强制按钮）。
   *
   * 纯只读：只调 evaluatePromotion，不写盘、不改状态、不动统计。异常一律 fail-soft 返回不可越权。
   *
   * @param {string} procedureId
   * @returns {{ok:boolean, decision?:string, overridable:boolean, reasonCodes?:string[], gateKind?:string}}
   *          `gateKind`：`promote`（已可晋升，无需越权）/ `statistical`（仅统计门拦，可人工越权）/
   *          `structural`（结构门拦，人工也不放行）/ `unknown`（投影失败）
   */
  function promotionOverrideView(procedureId) {
    try {
      const view = evaluatePromotion(procedureId)
      if (!view || view.ok === false) return { ok: false, overridable: false, gateKind: 'unknown' }
      if (view.decision === 'promote') {
        return { ok: true, decision: 'promote', overridable: false, gateKind: 'promote', reasonCodes: view.reasonCodes || [] }
      }
      if (view.decision === 'ask') {
        // 高风险待批准：本来就有人工通路（approve），不该再给"强制晋升"。
        return { ok: true, decision: 'ask', overridable: false, gateKind: 'structural', reasonCodes: view.reasonCodes || [] }
      }
      const codes = Array.isArray(view.reasonCodes) ? view.reasonCodes : []
      const isStat = (c) => /^diversity-below-/.test(c) || /^success-below-/.test(c)
      const stat = codes.length > 0 && codes.every(isStat)
      return {
        ok: true,
        decision: 'keep',
        overridable: stat,
        gateKind: stat ? 'statistical' : 'structural',
        reasonCodes: codes,
      }
    } catch (_) {
      return { ok: false, overridable: false, gateKind: 'unknown' }
    }
  }

  /** 激活: validated → active(可被召回)。 */
  function activate(procedureId) {
    const p = procedures.find((x) => x.procedureId === procedureId)
    if (!p) return { ok: false, reason: 'not-found' }
    if (p.stage !== 'validated') return { ok: false, reason: 'stage-' + p.stage }
    p.stage = 'active'
    p.activatedAt = nowFn()
    stats.activated++
    void persist()
    return { ok: true, procedure: p }
  }

  /**
   * ★B-1(2026-09-21):**人工批准原语** —— 只解「高风险需人工确认」这一道门。
   *
   * 为什么需要它(取证):高风险条目入库时 `approved = c.riskLevel !== 'high'`(observe, :235)
   * 恒为 false,而在本函数之前**全仓没有任何代码能把它置真**:promote() 走到高风险门只会返回
   * `{decision:'ask', reasonCodes:['high-risk-awaiting-approval']}`(宿主建 store 未传 opts.approve,
   * 路由白名单也没有 approve 动作)⇒ 高风险技能的晋升是**死路**。本函数就是那条唯一通路。
   *
   * 边界(**只有一道门**;文件头同名小节是同一条约定):
   *   · 只置 `approved/approvedAt/approvedBy/updatedAt` 并落盘 —— **不改 stage、不触发晋升、不写 authorizedBy**;
   *   · **不跳过** promote() 的另外五道结构门(已弃用短路 / 纯观察行短路 / 缺 successCriteria /
   *     纠正率超限 / 存在纠正记录)⇒ 批准之后仍可能被这些门拒绝,必须再调 promote() 才知道结果;
   *   · 所以返回里的 `approved:true` 意思是**"高风险这道门不再拦"**,不是"这条已晋升/已激活"。
   *     前端要展示"已批准、待晋升"时请读 `procedure.approved`,不要拿它当 stage 用。
   *
   * 幂等:重复调用不重复写盘,也不覆盖首次的 approvedAt/approvedBy(批准留痕不可被后续调用改写)。
   * 失败码一一取自**冻结的机器码集合**(`not-found` / `stage-deprecated` / `disposed`);人类可读
   * 文案由消费端(前端 / 工具文案层)映射 —— 码值稳定可枚举,不随文案措辞变化。
   *
   * @param {string} procedureId
   * @param {string} [by='user'] 批准者标识(用户手动=user;宿主/模型代批可传其它值,原样记入 approvedBy)
   * @returns {{ok:boolean, approved:boolean, reason?:string, notRequired?:boolean, alreadyApproved?:boolean, persisted?:boolean, procedure?:object}}
   */
  function approve(procedureId, by = 'user') {
    if (disposed) return { ok: false, reason: 'disposed' }
    const p = procedures.find((x) => x.procedureId === procedureId)
    if (!p) return { ok: false, reason: 'not-found' }
    // 已弃用:更强的短路,先判 —— 弃用条目不该被"批准"(批准不改变它的命运,只可能造出误导性留痕)。
    // 冻结码 'stage-deprecated' 与 activate()/deprecate() 的 'stage-' + stage 同形,前端可统一映射。
    if (p.stage === 'deprecated') return { ok: false, reason: 'stage-deprecated', procedure: p }
    // 本就不需要批准(requiresApproval 为 false,含旧快照缺该字段的行 —— 判据与 promote() 一致):
    // **纯只读返回**:不写盘、不动状态。没有门可解,写 approved 只会伪造一条"有人批过"的留痕。
    if (!p.requiresApproval) return { ok: true, approved: true, notRequired: true, procedure: p }
    // 幂等:已批准过 —— 不重复写盘,也不覆盖首次的 approvedAt/approvedBy。
    if (p.approved) return { ok: true, approved: true, alreadyApproved: true, procedure: p }
    const now = nowFn()
    p.approved = true
    p.approvedAt = now
    p.approvedBy = String(by)
    p.updatedAt = now
    stats.approved++
    const r = persist()
    // A-8 同口径:落盘失败**不静默** —— ok 仍为 true(内存里这道门确实开了),但把失败痕迹透出,
    // 由调用方决定是否上报(persisted:false 时附 persistReason/persistFailures)。
    // 键序与冻结契约一致(ok/approved/persisted/procedure),附加字段只出现在失败时。
    const out = { ok: true, approved: true, persisted: r.ok, procedure: p }
    if (!r.ok) { out.persistReason = r.reason; out.persistFailures = r.persistFailures }
    return out
  }

  /** 降级/禁用: 任何 stage → deprecated(用户手动或 correction 爆表)。 */
  function deprecate(procedureId, reason = 'user-disabled') {
    const p = procedures.find((x) => x.procedureId === procedureId)
    if (!p) return { ok: false, reason: 'not-found' }
    p.stage = 'deprecated'
    p.deprecatedAt = nowFn()
    p.deprecateReason = String(reason)
    stats.deprecated++
    void persist()
    return { ok: true, procedure: p }
  }

  // ---- 查询 ----
  function query(q = {}) {
    if (disposed) return []
    return procedures
      .filter((p) =>
        (q.stage === undefined || p.stage === q.stage) &&
        (q.riskLevel === undefined || p.riskLevel === q.riskLevel) &&
        (q.title === undefined || p.title.includes(q.title)))
      .map((p) => ({ ...p, evidence: { ...p.evidence } }))
  }
  function activeProcedures() {
    return procedures.filter((p) => p.stage === 'active').map((p) => ({ ...p, evidence: { ...p.evidence } }))
  }
  function get(procedureId) {
    const p = procedures.find((x) => x.procedureId === procedureId)
    return p ? { ...p, evidence: { ...p.evidence } } : null
  }

  /**
   * ★ 渲染成可注入的 checklist(M6 六级 level 的 checklist 形态)。
   * 输出给 M7 召回系统:相似场景召回 active procedure → 注入 checklist 提示 AI 按固定流程走。
   * 高风险 → 降级为 hint(仅提示"可参考流程",不自动给步骤)。
   */
  /**
   * ★P2-7(2026-09-21):checklist 行 → 注入文本,**超长截断必须可见**。
   *
   * 旧实现 `lines.join('\n').slice(0, 2000)` 在超长时**静默**丢掉尾部 ——
   * 而注入文本的尾部恰好是「检查 / 完成标准 / 回滚」,模型据此判断不了
   * "这条技能是否被砍过",也就无从知道该不该照做。本仓既有口径是
   * 「裁剪永远可见」(见 memory-envelope-pre 的同类处理),此处对齐。
   */
  function renderChecklistTextPre(lines) {
    const full = lines.join('\n')
    const CAP = 2000
    if (full.length <= CAP) return full
    const droppedChars = full.length - CAP
    return full.slice(0, CAP)
      + '\n…(清单超长已截断:尾部 ' + droppedChars + ' 字符未展开,可能含检查/完成标准/回滚,共 ' + lines.length + ' 段)'
  }

  function renderChecklist(procedureId) {
    const p = procedures.find((x) => x.procedureId === procedureId)
    if (!p || p.stage !== 'active') return null
    if (p.riskLevel === 'high') {
      return {
        procedureId: p.procedureId, title: p.title, level: 'hint', riskLevel: p.riskLevel,
        text: '[技能提示] 场景匹配「' + p.title + '」(高风险流程,已确认可参考)。如需执行请先向用户确认,再按记忆中的固定步骤操作。',
      }
    }
    const lines = []
    lines.push('[技能] ' + p.title)
    if (p.preconditions.length) lines.push('前置: ' + p.preconditions.join('; '))
    p.steps.forEach(function (s, i) { lines.push((i + 1) + '. ' + s) })
    if (p.checks.length) lines.push('检查: ' + p.checks.join('; '))
    if (p.successCriteria.length) lines.push('完成标准: ' + p.successCriteria.join('; '))
    if (p.rollback.length) lines.push('回滚: ' + p.rollback.join('; '))
    return {
      procedureId: p.procedureId, title: p.title, level: activeLevel, riskLevel: p.riskLevel,
      text: renderChecklistTextPre(lines), // ★P2-7(2026-09-21):超长截断必须可见(此前静默砍掉尾部)
    }
  }

  // ---- 持久化 ----
  function snapshot() {
    return {
      schemaVersion: 1, namespace: 'dsh-auto-memory', policyVersion: PROCEDURE_POLICY_VERSION,
      savedAt: nowFn(),
      procedures: procedures.map((p) => ({ ...p, _sessions: p._sessions ? [...p._sessions] : undefined, evidence: { ...p.evidence } })),
    }
  }
  function restore(data) {
    if (!data || data.schemaVersion !== 1) return { ok: false, reason: 'bad-schema' }
    if (!Array.isArray(data.procedures)) return { ok: false, reason: 'bad-procedures' }
    procedures = []
    for (const p of data.procedures) {
      // P2-3:旧快照可能含已移除的 'candidate' 态 —— 按"两态跳变"语义归入 observed(不丢条目)。
      const migrated = p && p.stage === 'candidate' ? { ...p, stage: 'observed' } : p
      const v = validateProcedurePre(migrated)
      if (!v.ok) continue
      // A-6:evidence 回填为有限数(缺键/脏值按 0)——否则 promote 的门限算术会得 NaN 而静默放行。
      v.procedure.evidence = normalizeEvidencePre(v.procedure.evidence)
      if (migrated._sessions) {
        v.procedure._sessions = new Set(migrated._sessions)
        v.procedure.evidence.sessions = v.procedure._sessions.size
      }
      // issue #30:旧快照里没有 observationOnly 字段,恢复时按同一判据补齐
      // (纯增量元数据迁移:不改身份/文本/风险/证据/阶段)。
      procedures.push(normalizeProcedureObservationPre(v.procedure))
    }
    // ★B-1(2026-09-21):stats.approved 是本轮新增计数,旧快照(以及本模块自己的快照 ——
    //   snapshot() 不含 stats 字段)里都没有这个键。还原后它**必须仍是有限数**:getStats() 是
    //   前端计数面板的数据源,透出 undefined 会让「已批准 N 条」凭空消失,而各消费方的兜底
    //   写法又不一致。有快照值就用快照值(数字/数字串都收),没有或脏值则保留当前值兜底 ——
    //   不无脑清零:restore() 并不还原其它统计(observed/validated/...),单清一个反而更不一致。
    stats.approved = Number(data.stats && data.stats.approved) || Number(stats.approved) || 0
    return { ok: true, restored: procedures.length }
  }
  /** 清空(失败不再静默:io.clear 抛错时返回 ok:false + error)。 */
  function clear() {
    procedures = []
    try { if (typeof io.clear === 'function') io.clear() } catch (e) {
      return { ok: false, reason: 'io-clear-failed', error: String((e && e.message) || e) }
    }
    return { ok: true }
  }
  /** 处置:落盘一次(与 persist 同口径返回,失败可见)。保留 reason 形参以兼容宿主既有调用。 */
  function dispose(reason) {
    if (disposed) return { ok: true, alreadyDisposed: true, persisted: true }
    disposed = true
    const r = persist()
    if (reason) r.disposeReason = String(reason)
    return r
  }
  /**
   * ★A-8(2026-09-21):落盘并**返回结果**。此前实现是 `try { io.save(...) } catch (_) {}`,
   * 落盘失败被**完全吞掉** ⇒ 记忆只在内存里、重启即丢,而调用方与统计都看不出异常。
   * 现在:失败仍不抛(保持既有容错语义),但①计数 persistFailures ②记 lastPersistError
   * ③把 { persisted:false, ... } 透传给调用它的写操作返回值,由调用方决定是否上报。
   */
  function persist() {
    try {
      io.save(snapshot())
      lastPersistError = null
      return { ok: true, persisted: true }
    } catch (e) {
      persistFailures++
      lastPersistError = String((e && e.message) || e)
      return { ok: false, persisted: false, reason: 'persist-failed', error: lastPersistError, persistFailures }
    }
  }

  return {
    // ★R2：只读判定投影（供 overview() 展示「为什么不能晋升」）
    evaluatePromotion,
    promotionOverrideView,
    observe, addEvidence, promote, activate, deprecate, approve,
    touch, setPinned, applyAutomaticTransitions,
    query, activeProcedures, get, renderChecklist,
    snapshot, restore, clear, dispose,
    // A-8:persistFailures/lastPersistError 一并透出(落盘健康度可观察)
    getStats: () => ({ ...stats, persistFailures, lastPersistError }),
    get size() { return procedures.length },
  }
}

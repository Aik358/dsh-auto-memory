import { createHash } from 'node:crypto'

/** Episode-only rows cannot earn memory-ID evidence. Do not fabricate provenance or gates. */
export function isObservationOnlyPre(p) {
  if (!p || typeof p !== 'object') return false
  if (p.observationOnly === true) return true
  // Already validated/active, user-authored and deprecated history keeps its existing semantics.
  if (p.origin === 'user' || (p.stage && !['observed', 'candidate'].includes(p.stage))) return false
  return Array.isArray(p.sourceEpisodes) && p.sourceEpisodes.length > 0 &&
    (!p.sourceMemoryIds || p.sourceMemoryIds.length === 0) &&
    (!p.successCriteria || p.successCriteria.length === 0)
}

/** Additive metadata migration only; no change to identity, text, risk, evidence or stage. */
export function normalizeProcedureObservationPre(p) {
  if (!p || p.pinned || p.observationOnly !== undefined || !isObservationOnlyPre(p)) return p
  return { ...p, observationOnly: true }
}

/** A title is not an identity. Rich and observation-only candidates must not contaminate each other. */
export function procedureFingerprintPre(p) {
  return JSON.stringify([p.title, p.origin === 'user' ? 'user' : 'agent', p.riskLevel || 'low',
    isObservationOnlyPre(p), p.steps || [], p.preconditions || [], p.checks || [],
    p.successCriteria || [], p.rollback || []])
}

/**
 * ★#457（2026-11-02）：**相似度**判据（与上面的**身份**指纹严格分开）。
 *
 * 缺陷：上层 `proceduresFindDuplicatePre`（lib/index.js）只比「标题整串归一后相等」或
 *   「前 3 步逐字相等」。同一条流程换个说法写两次 ⇒ 在所有逐字口径下**必然不等** ⇒
 *   审批队列被同流程变体灌满（作者最小用例实测：库里 2 条、都进 observed、无任何提示）。
 *
 * 本函数只回答一个问题：「这两条**像不像同一条流程**」，返回 0–1，不做合并决定。
 *   阈值与处置（合并 / 标 dupSuspect / 拒绝写入）由调用方定，故这里**不写死任何阈值**。
 *
 * 度量口径（写死、可复算、无第三方依赖）：
 *   ① token 化：ASCII 取词（≥2 字符，去纯标点），CJK 取**字符二元组**（单字成组按 1 字符）。
 *      —— 中文没有空格分词，bigram 是唯一不需要词典又能表达"词"的稳定口径。
 *   ② 标题相似度 = token 集合 Jaccard。
 *   ③ 步骤相似度 = **顺序无关的最优匹配**：对 A 的每一步，在 B 里找最相似的一步（Jaccard），
 *      两个方向各取平均再平均。⇒ 换措辞、加一步前置、调换顺序都不会归零，
 *      而"步骤根本不同"仍然趋近 0（这正是逐字判据丢掉的信息）。
 *   ④ 总分 = `0.15·标题 + 0.85·步骤`。权重有数据支撑（见 artifacts/issue-repair-20261102/
 *      probe-457-*）：标题在真实同流程对上只有 0.19 的 Jaccard（换措辞后标题几乎不共享 token），
 *      单靠标题会把同流程判成不相似；步骤才是流程身份的主信号。
 *      同时保留少量标题权重，避免"步骤模板化但主题不同"的两条被误判为同一条。
 *
 * **安全边界（fail-soft）**：入参不是对象 / 缺 title 且缺 steps ⇒ 返回 0，绝不抛错。
 *   上层可以在任何判重路径安全调用它。
 *
 * @param {object} a 形如 `{title, steps}` 的候选或既有条目
 * @param {object} b 同上
 * @returns {number} 0–1（同一条 ⇒ 1；毫不相干 ⇒ 0）
 */
export function procedureSimilarityPre(a, b) {
  const A = a && typeof a === 'object' ? a : {}
  const B = b && typeof b === 'object' ? b : {}
  const titleA = procedureTokensPre(A.title)
  const titleB = procedureTokensPre(B.title)
  const stepsA = procedureStepTokensPre(A.steps)
  const stepsB = procedureStepTokensPre(B.steps)
  // 两条都没有任何可比内容 ⇒ 不能声称"相似"（0 是安全值：不触发任何合并/拦截）。
  if (!titleA.length && !titleB.length && !stepsA.length && !stepsB.length) return 0
  const titleScore = procedureJaccardPre(titleA, titleB)
  const stepScore = procedureStepMatchPre(stepsA, stepsB)
  // 只有**两边都有步骤**时才能用步骤权重；否则步骤侧无证据，退回纯标题相似度
  // （否则"只有标题的两条完全相同条目"会得到 0.15，自反性被破坏）。
  const hasBothSteps = stepsA.length > 0 && stepsB.length > 0
  const score = hasBothSteps ? 0.15 * titleScore + 0.85 * stepScore : titleScore
  return Math.max(0, Math.min(1, Number(score.toFixed(6))))
}

/** ★F4 判重相似度阈值（#457 作者实测口径：A~B 应判重、AG591 V7.3~V7.9 不应判重）。
 *  调用点**禁止**再写第二份字面量；测试直接 import 本常量断言。 */
export const PROCEDURE_DUP_SIMILARITY_THRESHOLD_PRE_V1 = 0.62

/** ★F4 标题归一键（hub 旁路与工具查重闸门必须**同一判据口径**）。
 *  修前：工具侧在 index.js 工具 handler **内部**定义了 proceduresNormalizePre（局部不可复用），
 *  而 hub 旁路只能用 `.trim()` 比较 ⇒ **两条写入路径的标题判据不同源**（大小写/全角空格/标点差异在 hub 侧漏拦）。
 *  现状（**不是单一实现，别误会**）：
 *   · hub 旁路 import 本实现；
 *   · 工具侧 index.js 的 proceduresNormalizePre **必须保留自包含副本**——
 *     issue453-procedure-dedupe 会把那个函数体抽到独立 Function 作用域里真调用，
 *     改成委托会立刻 ReferenceError（实测踩过）。
 *   ⇒ 两份同规则实现必须**由行为等价锁强制同步**（verify-upstream-f4 的 F4-2b，39 条语料逐条比对）；
 *     **修改其中一份必须同时修另一份**，否则锁会红。
 *  归一规则（与工具侧原实现逐字等价）：去空白（含全角）、去中英文标点与括号、小写。 */
export function procedureTitleKeyPre(s) {
  return String(s == null ? '' : s)
    .replace(/[\s\u3000]+/g, '')
    .replace(/[\u3001\u3002\uff0c\uff1b\uff1a\uff01\uff1f.,;:!?'"\u201c\u201d\u2018\u2019()\uff08\uff09\[\]\u3010\u3011<>\u300a\u300b\u2014\-\u2013_*+~|/\\]/g, '')
    .toLowerCase()
}

/** CJK 字符类（含扩展 A；不含标点）。 */
const PROC_CJK_RE = /[\u3400-\u4dbf\u4e00-\u9fff]+/g
/** ASCII 词：至少含 2 个字母或数字（纯标点不算词）。 */
const PROC_WORD_RE = /[a-z0-9][a-z0-9_.+\/-]*/g

/** token 化（内部工具，导出仅供测试复算口径）。 */
export function procedureTokensPre(text) {
  const s = String(text == null ? '' : text).toLowerCase()
  const out = []
  for (const m of s.match(PROC_WORD_RE) || []) {
    if (String(m).replace(/[^a-z0-9]/g, '').length >= 2) out.push('w:' + m)
  }
  for (const m of s.match(PROC_CJK_RE) || []) {
    const run = String(m)
    if (run.length === 1) { out.push('c:' + run); continue }
    for (let i = 0; i + 1 < run.length; i++) out.push('c:' + run.slice(i, i + 2))
  }
  return out
}

/** 步骤数组 → 每步一份 token 集合（非数组/空步被丢弃）。 */
function procedureStepTokensPre(steps) {
  const list = Array.isArray(steps) ? steps : []
  const out = []
  for (const s of list) {
    const toks = procedureTokensPre(s)
    if (toks.length) out.push(toks)
  }
  return out
}

/** Jaccard（集合口径；两边都空 ⇒ 0，不声称相似）。 */
function procedureJaccardPre(a, b) {
  const A = new Set(a)
  const B = new Set(b)
  if (!A.size && !B.size) return 0
  let inter = 0
  for (const x of A) if (B.has(x)) inter++
  return inter / (A.size + B.size - inter)
}

/** 顺序无关的步骤集合相似度（双向最优匹配平均）。 */
function procedureStepMatchPre(stepsA, stepsB) {
  if (!stepsA.length || !stepsB.length) return 0
  const directed = (X, Y) => {
    let sum = 0
    for (const x of X) {
      let best = 0
      for (const y of Y) {
        const s = procedureJaccardPre(x, y)
        if (s > best) best = s
      }
      sum += best
    }
    return sum / X.length
  }
  return (directed(stepsA, stepsB) + directed(stepsB, stepsA)) / 2
}

export function matchingProcedurePre(rows, candidate) {
  const fingerprint = procedureFingerprintPre(candidate)
  return rows.find(p => p.stage !== 'deprecated' && procedureFingerprintPre(p) === fingerprint)
}

export function mergeProcedureSourcesPre(existing, candidate) {
  // These are the only mergeable fields. In particular, never inherit a lower risk or approval.
  existing.sourceMemoryIds = [...new Set([...(existing.sourceMemoryIds || []), ...(candidate.sourceMemoryIds || [])])]
  existing.sourceEpisodes = [...new Set([...(existing.sourceEpisodes || []), ...(candidate.sourceEpisodes || [])])]
}

export function newProcedureIdentityPre(candidate, now, rows, idPrefix = 'proc_pre_') {
  // ★ 内容寻址（2026-09-26 B1-1 修复）：id 只由**内容指纹**决定。
  //
  // 旧实现在哈希里掺了 now 与 sequence:
  //   ['procedure-v2', fingerprint, now, sequence]
  // ⇒ **同内容在两台机器/两个时刻得到不同 id** ⇒ 同步后变重复条目。
  // 这是身份级缺陷：不修则团队库里的同名技能会不断增殖。
  //
  // 修法：去掉时间与序号，只用 procedureFingerprintPre（纯内容字段：
  //   title / origin / riskLevel / observationOnly / steps / preconditions /
  //   checks / successCriteria / rollback）。跨机一致：同内容 ⇒ 同 id。
  //
  // 退化情形：若内容寻址 id 已被占用，用**确定性递增序号**消歧 ——
  // 仍不含时间戳，故同输入必得同输出（幂等）。
  // 前缀必须与 procedure-store.js 的 PROCEDURE_ID_PREFIX 一致 ——
  // 发布线会由 tools/release.mjs 反向转换，故此处字面量按 pre 线写。
  const used = new Set(rows.map(p => p.procedureId))
  const fingerprint = procedureFingerprintPre(candidate)
  for (let sequence = 0; sequence <= rows.length + 1; sequence++) {
    const seed = sequence === 0
      ? ['procedure-v3', fingerprint]
      : ['procedure-v3', fingerprint, sequence]
    const digest = createHash('sha256').update(JSON.stringify(seed)).digest('hex')
    const id = idPrefix + digest.slice(0, 32)
    if (!used.has(id)) return id
  }
  throw new Error('procedure-id-exhausted')
}

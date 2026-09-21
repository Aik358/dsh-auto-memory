/**
 * degrade-pre.js · 降级留痕层（R3，2026-09-18）
 *
 * ── 要解决的问题 ──────────────────────────────────────────────
 * 全仓普查发现 70 处 `catch` 只写 diag 不抛出，其中 10 处自述为「降级/回退/中性」。
 * 检索链上**四条臂各自独立降级、各自静默** ⇒ 可同时失效而使用者只感到「检索不太对」。
 * 实证案例（R2）：evidence 读侧误判目录缺失 ⇒ importance 加权对某类用户**出厂即死**，
 * 而表现只是每次 recall 写一行 diag。
 *
 * ── 定性 ─────────────────────────────────────────────────────
 * fail-soft 本身是对的（记忆插件不得拖垮会话）。**缺陷在「降级不可见」**。
 * 本模块不是要消灭降级，而是让「**哪条臂没在工作**」从推断变成**可查询的状态**。
 *
 * ── 与既有机制的边界（2026-09-18 前置检查已证实无重复）──────
 *   · `diag()`        = 过程日志（滚动、即时、人读）—— **保留不变**
 *   · `debugView()`   = 各 host 的**局部**状态投影（7 处，彼此分散）
 *   · `degrade`（本模块）= **跨臂统一台账**（聚合、可查询、回答"哪条臂失效"）
 *   · `_lastIndexDegrade`（context-host-pre.js:112）= 单值兼容投影，非收集器
 *
 * ── 判据（R1/R2 得出，本模块的最高纪律）──────────────────────
 * **必须区分两类，绝不能一律报，否则噪音淹没信号**：
 *   · **预期内分支**：该状态是合法业务状态（无证据事件 / 查询无时间表达）⇒ **静默，不记**
 *   · **预期外失败**：该状态不该发生（引擎抛错 / 目录异常 / worker 拒绝）⇒ **记**
 * 例：`parseTemporalQueryPre` 返回 null（查询含无时间表达）是预期内 ⇒ 不记；
 *     但它**抛错**是预期外 ⇒ 记。调用方须把"返回 null"与"抛错"分开。
 *
 * ── 元规则（本模块自身的 fail-soft）──────────────────────────
 * **留痕失败绝不可导致二次失败**：`record()` 内部整体 try/catch 吞掉一切。
 * 宁可丢掉一条留痕，也绝不能因为留痕而打断检索。
 */

/** 身份常量（枚举类常量须配断言兜底 —— 本仓纪律）。 */
export const DEGRADE_SCHEMA_PRE_V1 = 'degrade_pre_v1'

/** 环形缓冲上限：防内存无界增长。 */
export const DEGRADE_CAP_PRE_V1 = 200

/** 单条 reason 截断长度：与既有 diag 同口径，且防长文本撑爆状态文件。 */
export const DEGRADE_REASON_MAX_PRE_V1 = 200

/**
 * 臂状态枚举（fail-closed 校验）。
 * - `active`    正常工作
 * - `no-input`  无输入（**合法状态**，如尚无证据事件 / 查询无时间表达）
 * - `degraded`  已降级（**预期外**，值应能在 counts 里找到对应 kind）
 * - `disabled`  被配置关闭
 * - `unknown`   无法判定（**不得**当作正常，面板应显式呈现）
 */
export const ARM_STATES_PRE_V1 = Object.freeze(['active', 'no-input', 'degraded', 'disabled', 'unknown'])

/** 已知降级 kind（仅作文档/断言用，**不限制**调用方传入新 kind）。 */
export const DEGRADE_KINDS_PRE_V1 = Object.freeze([
  'semantic-arm',   // 语义臂择优失败 → 回退词法
  'evidence-arm',   // evidence 聚合失败 → importance 中性
  'l0-sync',        // L0 索引同步失败 → 索引陈旧
])

/**
 * 创建降级台账。
 *
 * @param {object} [opts]
 * @param {number} [opts.cap]  环形缓冲上限
 * @param {Function} [opts.now] 取时函数（注入便于测试确定性）
 */
export function createDegradeSinkPre(opts = {}) {
  const cap = Number.isFinite(opts.cap) && opts.cap > 0 ? Math.floor(opts.cap) : DEGRADE_CAP_PRE_V1
  const now = typeof opts.now === 'function' ? opts.now : () => Date.now()

  /** @type {Map<string, number>} kind → 累计次数（不受环形淘汰影响） */
  const counts = new Map()
  /** @type {Array<{kind:string,reason:string,at:number}>} 最近条目（有界） */
  let recent = []
  /** 因超出 cap 而被淘汰的条数（保证"有界"这件事本身可见，不静默丢数据） */
  let evicted = 0

  /**
   * 记录一次降级。**只用于预期外失败**（预期内分支请勿调用，直接静默）。
   * 内部整体 fail-soft：任何异常都被吞掉，调用方无需 try/catch。
   */
  function record(kind, reason) {
    try {
      const k = String(kind == null ? 'unknown' : kind)
      counts.set(k, (counts.get(k) || 0) + 1)
      if (recent.length >= cap) { recent.shift(); evicted += 1 }
      recent.push({
        kind: k,
        reason: String(reason == null ? '' : reason).slice(0, DEGRADE_REASON_MAX_PRE_V1),
        at: now(),
      })
    } catch (_) { /* 元规则：留痕失败不得影响主流程 */ }
  }

  /** 读快照（不可变副本，防外部改内部状态）。 */
  function snapshot() {
    let out
    try {
      out = {
        schemaVersion: DEGRADE_SCHEMA_PRE_V1,
        updatedAt: new Date(now()).toISOString(),
        counts: Object.fromEntries(counts),
        recent: recent.map((r) => ({ ...r, at: new Date(r.at).toISOString() })),
        evicted,
        cap,
      }
    } catch (_) {
      // 快照失败也要给出**结构性合法**的最小对象，不能让读取方拿到 undefined
      out = { schemaVersion: DEGRADE_SCHEMA_PRE_V1, updatedAt: null, counts: {}, recent: [], evicted, cap }
    }
    return out
  }

  /** 某 kind 的累计次数（断言友好）。 */
  function countOf(kind) { try { return counts.get(String(kind)) || 0 } catch (_) { return 0 } }

  /** 是否发生过任何降级。 */
  function isEmpty() { return counts.size === 0 }

  function reset() { counts.clear(); recent = []; evicted = 0 }

  return { record, snapshot, countOf, isEmpty, reset, _capForTest: cap }
}

/**
 * 派生**臂健康快照**（E-3 落地）。
 *
 * 这不是"降级记录"，而是**状态陈述** —— 目的是让「某条臂没在工作」可见，
 * 而不必靠"每次 recall 都报错"来推断。例：`evidence: 'no-input'` 一眼可见。
 *
 * @param {Record<string, string>} states 臂名 → 状态（须属 ARM_STATES_PRE_V1；非法值归一为 'unknown'）
 */
export function deriveArmsHealthPre(states) {
  const out = {}
  try {
    for (const [arm, st] of Object.entries(states || {})) {
      const s = String(st == null ? '' : st)
      out[String(arm)] = ARM_STATES_PRE_V1.includes(s) ? s : 'unknown'
    }
  } catch (_) { /* fail-soft */ }
  return out
}

/**
 * R3-②（2026-09-18）：把台账**落盘**为可查询状态文件。
 *
 * 形态选择：**读驱动写**（由 `debugInfo()` 调用），不引入定时器、不新增常驻任务。
 * 理由：① 降级是低频事件，无需实时落盘；② 用户查看诊断时正是"想知道发生了什么"的时刻，
 * 此刻把最新快照写到磁盘 —— 既满足"可查询"，又不增加空闲期 IO。
 *
 * ★ 与 record/snapshot 同一条元规则：**落盘失败绝不可影响调用方**
 *   —— 全程 try/catch，返回布尔而非抛错（调用方无需自行兜底）。
 *
 * @param {object} p
 * @param {string} p.file            目标 JSON 文件绝对路径
 * @param {object} p.snapshot        已算好的快照（通常来自 sink.snapshot()）
 * @param {Function} [p.mkdirSync]   注入的 fs.mkdirSync（便于测试与解耦）
 * @param {Function} [p.writeFileSync] 注入的 fs.writeFileSync
 * @returns {boolean} 是否成功写入（失败返回 false，**不抛**）
 */
export function persistDegradeLedgerPre(p) {
  try {
    const { file, snapshot, mkdirSync, writeFileSync } = p || {}
    if (!file || typeof file !== 'string') return false
    if (typeof mkdirSync !== 'function' || typeof writeFileSync !== 'function') return false
    const dir = file.replace(/[\\/][^\\/]*$/, '')
    if (dir) mkdirSync(dir, { recursive: true })
    writeFileSync(file, JSON.stringify(snapshot, null, 2), 'utf8')
    return true
  } catch (_) {
    // 元规则：留痕层自身的持久化失败，绝不可打断 debugInfo / 检索主流程。
    return false
  }
}

// ══════════════════════════════════════════════════════════════════════
// R4（2026-09-18）· 配额测量闭环
// ══════════════════════════════════════════════════════════════════════
//
// ── 要解决的问题（用户原话）──────────────────────────────────────────
// 「配额这个问题也困扰我很久。有的时候配额太少，效果完全没有，或者有些大条目可能就被过滤掉了，
//   一点用都没有；有的时候配额多了，我又怕浪费 token」
// 「确实得基于长期的观察，科学的（测量），不能拍脑子。」
//
// ── 为什么放在本模块（而不是新建一个文件）──────────────────────────────
// S10.4「不新建状态源」：配额观测与降级台账**同属"跨轮可查询的观测面"**，
// 只是两个不同的消费者。故复用同一模块、同一落盘文件（多一个 `quota` 键），
// **不新增文件、不新增配置键、不新增常驻任务**。
//
// ── 与降级台账的判据边界（务必不要混）──────────────────────────────────
//   · `record(kind, reason)` = **预期外失败**（引擎抛错、目录异常…）—— 只记异常
//   · `observe(meta)`（本函数）= **常规业务观测**（本轮各层进了多少、丢了多少）—— 每轮都记
//   把常规观测塞进 `record` 会**污染降级判据**（"有没有降级"将永远为非空），
//   故两者**并列而不混用**：各自的 counts/recent 互不干扰。

/** 配额探针的身份常量（枚举类常量须配断言兜底 —— 本仓纪律）。 */
export const QUOTA_PROBE_SCHEMA_PRE_V1 = 'quota_probe_pre_v1'

/** 采样环上限：与降级台账同口径（有界，防内存无界增长）。 */
export const QUOTA_PROBE_CAP_PRE_V1 = 200

/**
 * 配额判定结论枚举（fail-closed 校验）。
 * - `under-quota`        某层被反复丢弃 ⇒ 配额偏小，该层内容进不来
 * - `over-quota`         各层都不丢且远未用满 ⇒ 配额偏大，白花 token
 * - `balanced`           既有丢弃但未持续、占用也合理
 * - `insufficient-data`  **样本不足，不猜**（这是默认值 —— 宁可说不知道）
 */
export const QUOTA_VERDICTS_PRE_V1 = Object.freeze(['under-quota', 'over-quota', 'balanced', 'insufficient-data'])

/** 判定阈值（集中声明，便于断言锁定与后续按观测调参）。 */
export const QUOTA_THRESHOLDS_PRE_V1 = Object.freeze({
  /** 至少这么多轮采样才敢下结论（少于它一律 insufficient-data）。 */
  minSamples: 8,
  /** 某层"出现丢弃"的轮数占比 ≥ 此值 ⇒ under-quota。 */
  dropRateForUnder: 0.5,
  /** 各层都不丢时，token 占用率 < 此值 ⇒ over-quota（远未用满）。 */
  usageForOver: 0.5,
})

/**
 * 创建**配额探针**：有界收集每轮 `tier0Meta` 的配额相关切片。
 *
 * 与降级台账同一元规则：**观测失败绝不可影响主流程**（全程 try/catch，返回布尔不抛）。
 * 只保留判据所需字段（不整份存 tier0Meta），隐私面与降级台账一致（无正文、无路径）。
 *
 * @param {object} [opts]
 * @param {number} [opts.cap] 采样环上限
 * @param {Function} [opts.now] 取时函数（注入便于测试确定性）
 */
export function createQuotaProbePre(opts = {}) {
  const cap = Number.isFinite(opts.cap) && opts.cap > 0 ? Math.floor(opts.cap) : QUOTA_PROBE_CAP_PRE_V1
  const now = typeof opts.now === 'function' ? opts.now : () => Date.now()
  /** @type {Array<object>} 最近采样（有界） */
  let samples = []
  /** 因超上限被淘汰的条数（"有界"这件事本身可见，不静默丢数据） */
  let evicted = 0

  function observe(meta) {
    try {
      if (!meta || typeof meta !== 'object') return false
      const perLayer = {}
      const src = meta.perLayer
      if (src && typeof src === 'object') {
        for (const [layer, m] of Object.entries(src)) {
          if (!m || typeof m !== 'object') continue
          perLayer[String(layer)] = {
            candidates: Number(m.candidates) || 0,
            picked: Number(m.picked) || 0,
            dropped: Number(m.dropped) || 0,
            tokens: Number(m.tokens) || 0,
            cap: m.cap == null ? null : Number(m.cap),
          }
        }
      }
      if (samples.length >= cap) { samples.shift(); evicted += 1 }
      samples.push({
        at: now(),
        tokens: Number(meta.tokens) || 0,
        maxTokens: Number(meta.maxTokens) || 0,
        items: Number(meta.items) || 0,
        candidates: Number(meta.candidates) || 0,
        dropped: Number(meta.dropped) || 0,
        perLayer,
      })
      return true
    } catch (_) { return false }
  }

  function snapshot() {
    let out
    try {
      out = {
        schemaVersion: QUOTA_PROBE_SCHEMA_PRE_V1,
        updatedAt: new Date(now()).toISOString(),
        samples: samples.map((s) => ({ ...s, at: new Date(s.at).toISOString(), perLayer: { ...s.perLayer } })),
        evicted,
        cap,
      }
    } catch (_) {
      // 快照失败也要给出**结构性合法**的最小对象，不能让读取方拿到 undefined
      out = { schemaVersion: QUOTA_PROBE_SCHEMA_PRE_V1, updatedAt: null, samples: [], evicted, cap }
    }
    return out
  }

  function reset() { samples = []; evicted = 0 }

  return { observe, snapshot, reset, _capForTest: cap }
}

/**
 * 从配额探针快照**推导判定结论**（R4 · 纯函数、零 IO、永不抛）。
 *
 * 这是「科学测量」的判据落点 —— 用户要求**不能拍脑袋**，所以：
 *   · 样本不足 ⇒ 一律 `insufficient-data`（**不猜**，这是默认值）；
 *   · 某层**持续**被丢 ⇒ `under-quota`（该层内容长期进不来 ⇒ 配额偏小）；
 *   · 各层都不丢、且 token **远未用满** ⇒ `over-quota`（配额偏大、白花 token）；
 *   · 其余 ⇒ `balanced`。
 *
 * ★ 判据纪律（本仓）：**宁可漏判，不可误伤** —— 阈值取保守值，
 *   且把"凭什么这么判"的原始数据（dropRate/perLayer/usage）一并返回，供人复核。
 *
 * @param {object} snap `createQuotaProbePre().snapshot()` 的产物
 * @param {object} [opts] 覆盖阈值（默认取 QUOTA_THRESHOLDS_PRE_V1）
 * @returns {{version:string, verdict:string, samples:number, dropRate:number,
 *            usage:number, perLayer:object, reasons:string[]}}
 */
export function deriveQuotaVerdictPre(snap, opts = {}) {
  const th = { ...QUOTA_THRESHOLDS_PRE_V1, ...(opts || {}) }
  const base = {
    version: 'quota_verdict_pre_v1',
    verdict: 'insufficient-data',
    samples: 0,
    dropRate: 0,
    usage: 0,
    perLayer: {},
    reasons: [],
  }
  try {
    const list = snap && Array.isArray(snap.samples) ? snap.samples : []
    base.samples = list.length
    if (!list.length) { base.reasons.push('无采样'); return base }

    // 逐层聚合：出现丢弃的轮数 / token 占用 / 候选与命中
    const agg = {}
    let tokSum = 0, maxSum = 0
    for (const s of list) {
      tokSum += Number(s.tokens) || 0
      maxSum += Number(s.maxTokens) || 0
      const pl = s && s.perLayer && typeof s.perLayer === 'object' ? s.perLayer : {}
      for (const [layer, m] of Object.entries(pl)) {
        if (!agg[layer]) agg[layer] = { rounds: 0, dropRounds: 0, candidates: 0, picked: 0, dropped: 0, tokens: 0 }
        const a = agg[layer]
        a.rounds += 1
        if ((Number(m.dropped) || 0) > 0) a.dropRounds += 1
        a.candidates += Number(m.candidates) || 0
        a.picked += Number(m.picked) || 0
        a.dropped += Number(m.dropped) || 0
        a.tokens += Number(m.tokens) || 0
      }
    }
    for (const [layer, a] of Object.entries(agg)) {
      base.perLayer[layer] = {
        rounds: a.rounds,
        dropRounds: a.dropRounds,
        dropRate: a.rounds ? Number((a.dropRounds / a.rounds).toFixed(3)) : 0,
        candidates: a.candidates,
        picked: a.picked,
        dropped: a.dropped,
      }
    }
    base.usage = maxSum > 0 ? Number((tokSum / maxSum).toFixed(3)) : 0

    // ★ 样本不足 ⇒ 不猜（用户要的是"基于长期观察"，不是几轮就下结论）
    if (list.length < th.minSamples) {
      base.reasons.push('样本不足（' + list.length + '/' + th.minSamples + '），不下结论')
      return base
    }

    // 某层长期被丢 ⇒ 该层配额偏小
    const underLayers = Object.entries(base.perLayer)
      .filter(([, a]) => a.rounds > 0 && a.dropRate >= th.dropRateForUnder)
      .map(([l]) => l)
    if (underLayers.length) {
      base.verdict = 'under-quota'
      base.reasons.push('层 ' + underLayers.join('/') + ' 持续被丢（dropRate ≥ ' + th.dropRateForUnder + '）⇒ 配额偏小')
      return base
    }

    // 各层都不丢 + token 远未用满 ⇒ 配额偏大（浪费）
    if (base.usage < th.usageForOver) {
      base.verdict = 'over-quota'
      base.reasons.push('无任何层被丢，且 token 占用率 ' + base.usage + ' < ' + th.usageForOver + ' ⇒ 配额偏大、白花 token')
      return base
    }

    base.verdict = 'balanced'
    base.reasons.push('有丢弃但未持续，且占用率 ' + base.usage + ' 合理')
    return base
  } catch (_) {
    // 判定失败也要给出**结构性合法**的对象（verdict 保持 insufficient-data，不猜）
    base.reasons.push('判定异常，按样本不足处理')
    return base
  }
}


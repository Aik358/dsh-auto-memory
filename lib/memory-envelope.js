/**
 * 记忆注入信封 · 分项账本（memory_envelope_pre_v1）—— 契约 T0-3 / 总纲 §0.5 第 6 条。
 *
 * 2026-09-14 建立（P0）。**为什么需要这个模块**：
 *
 * 现行注入存在**两处实测缺陷**（读码确认，不是推测）：
 *   ① `lib/tier-layer-inject.js:327–335`（旧行号）：总长门只裁"下探段"，
 *      `headParts`（目录 + 降级行）**从不动**；而且降级说明是**在裁剪之后**才追加的
 *      ⇒ 最终长度可以**超过** `maxTotalChars`。
 *   ② `lib/index.js`（`renderMemoryDynamic`）：`catalogCost` 被 `Math.min(…, budget*0.35)` **封顶**，
 *      封顶的是"**扣账成本**"；实际注入用的是全文 `state.tier0LayerText`，**不参与 used 记账**。
 *      另外 `used` 变量只累加、**从未被读取**（注水账本）。
 *
 * 后果：**没人能回答"这一轮到底注入了多少、分别花在哪"**。v2 的要求是把它换成
 * **分项账本**：`chars: { rules, memoryReferences, otherDynamic, total }` +
 * `limits: { memoryReferences, otherDynamic }`。
 *
 * **本模块的三条不变式**（每条都有能红的断言，见 `tests/smoke/smoke-test-t0-3-budget-ledger.mjs`）：
 *   E1 **总计 = 最终序列化长度**：`chars.total === text.length`（逐字节相等，不是估算）。
 *   E2 **不允许未计费尾巴**：每个字符都归属某个分项；`rules + memoryReferences + otherDynamic === total`。
 *      标题、分隔符、降级说明**都必须作为某一段的文本被计入**（本模块不给任何"隐含前缀"留位置）。
 *   E3 **限制是硬约束**：启用了 `limits.X` 的分项，其实际字符数 **必须 ≤ 上限**；
 *      超限时按**整段**从该分项尾部丢弃（不腰斩半段），仍超则截断最后一段并显式标注
 *      —— **裁剪永远可见**（I7：不静默）。
 *
 * **明确代价**（v2 要求写清，不允许用换记账写法掩盖）：规则越长，注入总量越大；
 * 本模块**不再承诺**"全部动态内容有一个与规则规模无关的固定上限"。总纲 §0.5 第 6 条已接受此代价。
 *
 * **设计取舍——为什么不重排段落**：分项账本只做"归类 + 计量 + 限额"，**输出顺序 = 调用方给的顺序**，
 * 每段文本逐字节照搬（段自带前导 `\n`）。这样既满足 E1/E2，又不会顺手改变注入布局
 * （前缀缓存命中、既有套件的字节断言都不受影响）。
 *
 * S9 合规：零 IO、零依赖、纯函数、无网络、无 LLM、无子进程、全同步。
 * UTF-8 无 BOM。
 */

export const MEMORY_ENVELOPE_VERSION = 'memory_envelope_pre_v1'

/** 分项取值域（固定顺序仅用于**账本展示**；序列化顺序仍由调用方决定）。 */
export const ENVELOPE_BUCKETS_PRE_V1 = Object.freeze(['rules', 'memoryReferences', 'otherDynamic'])

/**
 * 段落优先级（★2026-09-15 新增）—— 决定"超额时先丢谁"。
 *
 * **为什么必须有它**：旧的丢弃是**纯位置式**（从分项尾部丢）。而尾部恰好是
 * `project-notes` 与 `user-memory`（本机实测：这两段被整段丢弃，而它们的价值最高）。
 * 位置顺序是**渲染顺序**，不是**价值顺序** —— 用渲染顺序决定丢谁，等于让"谁写在后面谁先死"。
 *
 * - `must`：**永不丢弃**（用户级硬性规则、块首尾框架行）。若连它们都超限，如实报告超额，不静默丢。
 * - `normal`：默认档。
 * - `low`：先丢（如最近日志——量最大、时效性最强、可从文件重读）。
 */
export const ENVELOPE_PRIORITIES_PRE_V1 = Object.freeze(['low', 'normal', 'must'])
const PRIORITY_RANK = Object.freeze({ low: 0, normal: 1, must: 2 })
const normalizePriority = (v) => (Object.prototype.hasOwnProperty.call(PRIORITY_RANK, String(v)) ? String(v) : 'normal')

/** 分项中文名（面板/日志可读；I7 精神：机器枚举之外要有人话）。 */
export const ENVELOPE_BUCKET_TEXT_PRE_V1 = Object.freeze({
  rules: '规则类',
  memoryReferences: '记忆参考类',
  otherDynamic: '其他动态内容',
})

/** 账本相关的原因码 → 可读中文。 */
export const ENVELOPE_REASONS_PRE_V1 = Object.freeze({
  'over-limit-dropped': '整段丢弃（超出分项上限）',
  'over-limit-truncated': '截断（单段本身即超上限）',
  'over-budget-total': '合计超出注入预算（分项账本如实记录，不掩盖）',
  'unknown-bucket': '分项名非法（该段被计入 otherDynamic 并留痕）',
})

const clean = (v) => String(v == null ? '' : v)

/**
 * 组装注入信封（**纯函数**：同输入必定同输出）。
 *
 * @param {object} input
 * @param {Array<{bucket:'rules'|'memoryReferences'|'otherDynamic', text:string, kind?:string}>} input.segments
 *   **已渲染好的段落文本**，按调用方期望的输出顺序给出。每段文本逐字节照搬
 *   （段内如需要前导换行，由调用方写进 `text`；本模块不补、不改、不重排）。
 * @param {{memoryReferences?:number, otherDynamic?:number}} [input.limits]
 *   分项字符上限。**未给出 = 该分项不设上限**（`rules` 在 P0/P6A 语义下**不参与裁剪**，
 *   故即使传了也会被忽略并留痕）。
 * @param {number} [input.budgetChars] 参考用的"总预算"（**只用于超额可见性**，不是硬门）。
 *   给出后，若 `chars.total > budgetChars` 会产出一条 `over-budget-total` 降级项
 *   —— 这是 v2 明确要求的"不许用记账写法掩盖代价"。
 * @returns {{text:string, chars:{rules:number,memoryReferences:number,otherDynamic:number,total:number},
 *            limits:{memoryReferences:number|null, otherDynamic:number|null, rulesIgnored?:boolean},
 *            segments:Array, dropped:Array, truncated:Array, degradations:Array, ok:boolean}}
 */
export function composeMemoryEnvelopePre(input = {}) {
  const o = input && typeof input === 'object' ? input : {}
  const rawSegs = Array.isArray(o.segments) ? o.segments.filter(Boolean) : []
  const limitsIn = o && typeof o.limits === 'object' && o.limits ? o.limits : {}
  const dropped = []
  const truncated = []
  const degradations = []

  // ── ① 归位：分项名非法的段落**不丢**，计入 otherDynamic 并留痕（不静默改归属） ──
  const segs = rawSegs.map((s, i) => {
    const text = clean(s && s.text)
    let bucket = clean(s && s.bucket)
    if (!ENVELOPE_BUCKETS_PRE_V1.includes(bucket)) {
      degradations.push({
        code: 'unknown-bucket', bucket: 'otherDynamic',
        text: '[降级] 第 ' + (i + 1) + ' 段分项名非法（' + (bucket || '(空)') + '）→ 已计入其他动态内容，未丢弃',
      })
      bucket = 'otherDynamic'
    }
    return { bucket, kind: clean(s && s.kind), text, index: i, priority: normalizePriority(s && s.priority) }
  })

  // ── ② 限额：只对 memoryReferences / otherDynamic 生效；rules 不参与裁剪（P0/P6A 语义） ──
  // ★2026-09-15 修复：`null` / `undefined` / 空串 **必须表示"不设限"**。
  // 旧写法 `Number(limitsIn[b])` 会把 `null` 变成 **0**（`Number(null)===0`）⇒ 上限 0 ⇒ 该分项被整段丢光。
  // 实测病症：调用方显式传 `otherDynamic: null`（= 未配置不设限）时，注入块只剩骨架两行，
  // `smoke-test.mjs` 立刻报 "dynamic context missing status line"。
  // 这类"缺省语义被数值化吃掉"的坑与 P6A 的 `Number(v) || 5` 是同一族，故在此显式区分三态。
  const limitOf = (b) => {
    if (b === 'rules') return null
    const raw = limitsIn[b]
    if (raw === null || raw === undefined || raw === '') return null
    const n = Number(raw)
    return Number.isFinite(n) && n >= 0 ? Math.floor(n) : null
  }
  const limits = {
    memoryReferences: limitOf('memoryReferences'),
    otherDynamic: limitOf('otherDynamic'),
  }
  // rules 若被显式传了上限 → 明确忽略并留痕（"规则不参与裁剪"是已定要求，不能被一个配置悄悄推翻）
  const rulesLimitRaw = Number(limitsIn.rules)
  if (limitsIn.rules !== undefined && Number.isFinite(rulesLimitRaw)) {
    limits.rulesIgnored = true
    degradations.push({
      code: 'unknown-bucket', bucket: 'rules', inject: false,
      text: '[降级] rules 分项上限（' + rulesLimitRaw + '）已被忽略：规则类不参与裁剪（分项账本仍如实体现在 chars.rules）',
    })
  }

  const kept = segs.slice()
  const rankOf = (s) => PRIORITY_RANK[normalizePriority(s.priority)]
  const bucketTotal = (bucket) => kept.filter((s) => s.bucket === bucket).reduce((a, s) => a + s.text.length, 0)

  /**
   * ★2026-09-15 修复：丢弃顺序改为**优先级感知**（旧实现是纯位置式，从尾部丢）。
   *
   * 规则：同一分项内，先丢**优先级最低**的段；同档内部从**文档尾部**丢（顺序稳定）。
   * `must` **永不丢弃** —— 若丢无可丢仍超限，**如实报告**而不是悄悄丢掉最高价值的内容。
   * 只剩最后一段可丢时**截断**它（保留部分内容优于整段消失），与旧语义一致。
   */
  const enforceLimit = (bucket) => {
    const lim = limits[bucket]
    if (lim === null) return
    for (;;) {
      if (bucketTotal(bucket) <= lim) return
      const mine = kept.filter((s) => s.bucket === bucket)
      const droppable = mine.filter((s) => rankOf(s) < PRIORITY_RANK.must)
      if (!droppable.length) {
        // 全是 must ⇒ 不丢，如实报告超额（I7：可见，但不牺牲最高价值内容）
        degradations.push({
          code: 'over-limit-must', bucket, inject: true,
          text: '[降级] ' + ENVELOPE_BUCKET_TEXT_PRE_V1[bucket] + '超出分项上限 ' + lim + ' 字符，但剩余 '
            + mine.length + ' 段均为 must 级（不可丢）⇒ 本轮**保留全部**并如实报告超额 '
            + (bucketTotal(bucket) - lim) + ' 字符（不静默丢弃硬性内容）',
        })
        return
      }
      if (droppable.length >= 2) {
        const minRank = Math.min(...droppable.map(rankOf))
        const group = droppable.filter((s) => rankOf(s) === minRank)
        const victim = group[group.length - 1]
        kept.splice(kept.indexOf(victim), 1)
        dropped.push({ bucket, kind: victim.kind, chars: victim.text.length, priority: victim.priority, reason: 'over-limit-dropped' })
        degradations.push({
          code: 'over-limit-dropped', bucket, inject: true,
          text: '[降级] ' + ENVELOPE_BUCKET_TEXT_PRE_V1[bucket] + '超出分项上限 ' + lim + ' 字符 → 丢弃优先级最低的一段'
            + (victim.kind ? '（' + victim.kind + '，priority=' + normalizePriority(victim.priority) + '）' : '')
            + '，未静默',
        })
        continue
      }
      // 只剩一段可丢 ⇒ 截断（截断标记本身占字符，先预留）
      const only = droppable[0]
      const mark = '…（已按分项预算截断，原文 ' + only.text.length + ' 字符）'
      if (lim <= mark.length + 1) {
        kept.splice(kept.indexOf(only), 1)
        dropped.push({ bucket, kind: only.kind, chars: only.text.length, priority: only.priority, reason: 'over-limit-truncated' })
        degradations.push({
          code: 'over-limit-truncated', bucket, inject: true,
          text: '[降级] ' + ENVELOPE_BUCKET_TEXT_PRE_V1[bucket] + '上限 ' + lim + ' 字符过小（放不下截断标记）→ 本段本轮为空',
        })
      } else {
        const before = only.text.length
        // ★2026-09-20 移植（issue #94③ / PR #100）：预算必须先扣掉同分项内 **must 段**的占用 ——
        //   旧实现 room = lim − mark 不扣 must ⇒ 超限纯由 must 造成时，对本已放得下的段也追加
        //   「已截断」标记（越截越长）并注入失实降级说明。
        const mustChars = bucketTotal(bucket) - only.text.length
        const available = Math.max(0, lim - mustChars)
        const room = Math.max(1, available - mark.length)
        only.text = only.text.slice(0, room) + mark
        truncated.push({ bucket, kind: only.kind, charsBefore: before, charsAfter: only.text.length, reason: 'over-limit-truncated' })
        degradations.push({
          code: 'over-limit-truncated', bucket, inject: true,
          text: '[降级] ' + ENVELOPE_BUCKET_TEXT_PRE_V1[bucket] + '只剩一段仍超上限 ' + lim + ' 字符 → 已截断（' + before + ' → ' + only.text.length + '）',
        })
      }
      // 截断后复核：must 段自身超限时如实报告，不假装达标
      if (bucketTotal(bucket) > lim) {
        degradations.push({
          code: 'over-limit-must', bucket, inject: true,
          text: '[降级] ' + ENVELOPE_BUCKET_TEXT_PRE_V1[bucket] + '截断后仍超上限 ' + lim + ' 字符（剩余为 must 级不可丢）⇒ 如实报告超额 '
            + (bucketTotal(bucket) - lim) + ' 字符',
        })
      }
      return
    }
  }
  enforceLimit('memoryReferences')
  enforceLimit('otherDynamic')

  // ── ③ 序列化：顺序 = 调用方给的顺序，逐字节拼接（不补分隔符、不重排） ──
  const text = kept.map((s) => s.text).join('')

  const chars = { rules: 0, memoryReferences: 0, otherDynamic: 0, total: text.length }
  for (const s of kept) chars[s.bucket] += s.text.length

  // ── ④ 超额可见性：分项账本如实记录，**不用任何写法掩盖**（v2 明确要求） ──
  const budgetChars = Number.isFinite(Number(o.budgetChars)) && Number(o.budgetChars) > 0 ? Math.floor(Number(o.budgetChars)) : null
  if (budgetChars !== null && chars.total > budgetChars) {
    const parts = ENVELOPE_BUCKETS_PRE_V1.map((b) => ENVELOPE_BUCKET_TEXT_PRE_V1[b] + ' ' + chars[b]).join(' · ')
    degradations.push({
      code: 'over-budget-total', bucket: null, inject: false,
      text: '[降级] 合计 ' + chars.total + ' 字符超出注入预算 ' + budgetChars + '（分项账本如实记录: ' + parts
        + '）· 规则类与目录层不参与裁剪，超出的部分不会被掩盖',
    })
  }

  return {
    version: MEMORY_ENVELOPE_VERSION,
    text,
    chars,
    limits,
    segments: kept.map((s) => ({ bucket: s.bucket, kind: s.kind, chars: s.text.length })),
    dropped,
    truncated,
    degradations,
    // E1/E2 自证：调用方可以据此直接断言（也让"注水账本"不可能悄悄回来）
    ok: chars.rules + chars.memoryReferences + chars.otherDynamic === chars.total,
  }
}

/** 分项账本 → 单行可读文本（进降级行 / 面板 / 排障都用它，口径唯一）。 */
export function describeEnvelopeCharsPre(envelope) {
  const c = (envelope && envelope.chars) || { rules: 0, memoryReferences: 0, otherDynamic: 0, total: 0 }
  return ENVELOPE_BUCKETS_PRE_V1.map((b) => ENVELOPE_BUCKET_TEXT_PRE_V1[b] + ' ' + (c[b] || 0)).join(' · ')
    + ' · 合计 ' + (c.total || 0)
}

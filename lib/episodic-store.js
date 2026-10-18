import { stripRuntimeIntentPre } from './intent-clean-safe.js'
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

export const EPISODIC_POLICY_VERSION = 'episodic_store_pre_v1'
export const EPISODE_ID_PREFIX = 'epi_pre_'
export const EPISODE_ID_RE = /^epi_pre_[0-9a-f]{32}$/

/** episode 累积上限(防无限增长;超过后最旧段被丢弃)。 */
export const EPISODE_SEGMENT_CAP_PRE_V1 = 64

/** 巩固后保留的最多 episode 数(超出按时间淘汰,保留最近)。 */
export const EPISODE_RETENTION_PRE_V1 = 256

/** 巩固阈值:至少多少段才算一个可巩固 episode(少于=丢弃,噪声太多)。 */
export const EPISODE_MIN_SEGMENTS_PRE_V1 = 2

/** outcome 枚举。 */
export const EPISODE_OUTCOMES_PRE_V1 = Object.freeze(['unknown', 'success', 'failure', 'partial'])

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
  if (!EPISODE_OUTCOMES_PRE_V1.includes(ep.outcome)) p.push('outcome')
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
  const cfg = {
    segmentCap: opts.config?.segmentCap ?? EPISODE_SEGMENT_CAP_PRE_V1,
    get retention() { return opts.config?.retention ?? EPISODE_RETENTION_PRE_V1 },
    get minSegments() { return opts.config?.minSegments ?? EPISODE_MIN_SEGMENTS_PRE_V1 },
  }

  let episodes = []        // 已巩固 episode(含 candidate 状态)
  let current = null       // 当前会话累积中(未巩固)
  let disposed = false
  const stats = { segmentsAppended: 0, consolidated: 0, droppedTooShort: 0, retained: 0 }

  function defaultEpisodeId(sessionRef, startedAt) {
    const h = createHash('sha256').update(['episode-pre-v1', String(sessionRef), String(startedAt)].join('\u0000')).digest('hex')
    return EPISODE_ID_PREFIX + h.slice(0, 32)
  }

  /**
   * issue#57 修复(2026-09-19):restore 时对 `data.current` 做**形状校验**。
   * 旧实现 `current = data.current || null` 零校验(与 :222 的 validateEpisodePre 形成不对称):
   * 磁盘上 `current:{}`(截断/手改/旧版本残留)会被原样采纳 ⇒ 之后 consolidate() 在
   * `current.segments.length`(:202)抛 TypeError ⇒ **巩固链路静默停摆**,且因异常发生在
   * 调用方 try 之外,统计与日志都不留痕。
   * 纪律:**丢弃优于卡死** —— 形状不合格一律置 null(等效"本会话无未巩固缓冲"),
   * 绝不把结构非法对象放进状态机。
   *
   * ★issue#430(2026-10-17)：`userTexts` / `assistantTexts` 已降级为**派生投影**(真源是
   * `segments[].userText/.assistantText`)。故:
   *   ① **`segments` 仍是硬必填** —— 它现在是唯一真源,缺了就无法重建任何文本特征;
   *   ② 两个投影数组改为**可选**:快照里仍会序列化它们(兼容旧版本读取方,见 snapshot),
   *      但恢复时**缺字段不拒绝**(旧快照 / 第三方只带 segments 的快照都必须能恢复),
   *      存在则忽略(不信任落盘值,一律以 segments 重算);
   *   ③ 保留 issue#57 的纪律:结构**明显非法**(非数组、形状不对)仍置 null,不放进状态机。
   *   ⚠️ 之所以要保留 ①② 两条:`smoke-test-issue55-58.mjs` 既逐字断言本函数体含
   *      `Array.isArray(raw.userTexts)`(源码守卫),又用**带该字段**的夹具验证合法 current
   *      被保留 —— 直接删字段会打红既有套件,而「派生 + 保留字段」同时满足两边的语义要求。
   */
  function restoreCurrentPre(raw) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
    if (typeof raw.sessionRef !== 'string' || !raw.sessionRef) return null
    if (typeof raw.startedAt !== 'number' || !Number.isFinite(raw.startedAt)) return null
    if (!Array.isArray(raw.segments)) return null
    // ★issue#430：投影数组可选(旧快照缺字段不拒绝),但**若给了就必须是数组**(形状校验不放水)。
    if (raw.userTexts !== undefined && !Array.isArray(raw.userTexts)) return null
    if (raw.assistantTexts !== undefined && !Array.isArray(raw.assistantTexts)) return null
    return raw
  }

  /**
   * ★ P2-2 修复(2026-09-21)：查询返回**深一层副本**。
   * 旧实现 `{ ...e }` 是浅拷贝 ⇒ `actions/entities/unresolved/provenance` 四个数组
   * 与库内对象**同引用**，调用方 push 会直接改脏已巩固 episode(绕过 persist 与统计)。
   */
  function cloneEpisode(e) {
    if (!e) return e
    return {
      ...e,
      actions: Array.isArray(e.actions) ? [...e.actions] : e.actions,
      entities: Array.isArray(e.entities) ? [...e.entities] : e.entities,
      unresolved: Array.isArray(e.unresolved) ? [...e.unresolved] : e.unresolved,
      provenance: Array.isArray(e.provenance) ? [...e.provenance] : e.provenance,
    }
  }

  // ---- 段追加(会话进行中实时累积) ----
  function append(seg) {
    if (disposed) return { ok: false, reason: 'disposed' }
    const v = validateEpisodeSegmentPre(seg)
    if (!v.ok) return { ok: false, reason: v.reason }
    const s = v.segment
    const incomingRef = String(s.sessionRef || 'unknown')
    // ★ A-7 修复(2026-09-21)：**按 sessionRef 隔离**。
    //   旧实现只在 `!current` 时取一次 sessionRef ⇒ 后续不同会话的段被并进同一个 episode:
    //   实测 sessionRef=session-A 但 intent 含 session-B 内容、provenance=["seg:1","seg:1"]。
    //   后果:procedure 晋升依赖的 distinctSessions 被系统性低估 ⇒ 技能永远卡在
    //   `diversity-below-3`(跨会话证据明明够,读数却恒为 1)。
    //   现改为:检测到会话切换时,**先巩固当前缓冲**(把上一会话的段固化成一个独立 episode),
    //   再为新的 sessionRef 开一个干净的 current。consolidate 失败(如 too-short)不阻断本段,
    //   其内部已负责把 current 置 null,后续照常新建。
    if (current && current.sessionRef !== incomingRef) {
      consolidate()
    }
    if (!current) {
      current = {
        sessionRef: incomingRef,
        startedAt: nowFn(),
        segments: [],
      }
    }
    // 累积文本(只保留文本特征,不保留原文全文 —— 隐私最小化)
    // issue#30:入库时就剥离运行时信封,避免注入快照一路流到 intent/title(下游只做兜底清洗)。
    const ut = stripRuntimeIntentPre(typeof s.userText === 'string' ? s.userText : '')
    const at = typeof s.assistantText === 'string' ? s.assistantText : ''
    // ★issue#430(2026-10-17)：文本投影**不再是独立数组**。旧实现另存 userTexts/assistantTexts
    //   两个数组,并假设「每段各有一条」与 segments 同步 shift —— 但 push 只在文本非空时发生
    //   (:170-171),基数天然不同(纯 tool/reasoning 段不产生任何文本)。一旦超 cap 开始 shift,
    //   两个数组与 segments 就**永久错位**。实测:63 条 assistant + 第 64 条 user「目标:把回归跑绿」
    //   + 两次超 cap ⇒ segments=64 而 userTexts=[],用户段仍在 segments 里但 intent 变空。
    //   现改为**单一真源 segments**:文本投影由 userTextsOfPre/assistantTextsOfPre 从 segments
    //   现算(见下方),shift 只有一处,错位在结构上不可能发生。
    current.segments.push({
      kind: s.kind || 'unknown',
      eventSeq: s.eventSeq || 0,
      contextVersion: s.contextVersion || 0,
      // ★保留「清洗后再截断」的两段式语义:入库前 stripRuntimeIntentPre 洗一次(issue#30),
      //   投影时再按 200 字截断 —— 与旧实现 userTexts.push(ut.trim().slice(0,200)) 的可见结果一致,
      //   但真源只有这一份。
      userText: ut.slice(0, 200),
      assistantText: at.slice(0, 200),
      ts: nowFn(),
    })
    // 超 cap:丢最旧段(保留最近上下文)。★只 shift segments 一处 —— 派生投影随之自动对齐。
    while (current.segments.length > cfg.segmentCap) {
      current.segments.shift()
    }
    stats.segmentsAppended++
    // ★ P2-11 修复(2026-09-21)：append 此前**完全不落盘** —— 段只留在内存，
    //   进程重启(崩溃/宿主重载)后未巩固的会话缓冲整段丢失，而调用方看到 ok:true。
    //   现在按段落盘(与 fact-store 各写路径一致)。落盘结果一并透传(A-8 同款纪律)。
    const pr = persist()
    return pr.ok
      ? { ok: true, segments: current.segments.length, persisted: true }
      : { ok: true, segments: current.segments.length, persisted: false, persistError: pr.error }
  }

  /**
   * ★issue#430：文本投影的**唯一派生入口**。
   *
   * 旧实现维护 `current.userTexts` / `current.assistantTexts` 两个并行数组,并假设它们与
   * `segments` 一一对应;但 append 只在文本非空时 push,基数天然不同(纯 tool / reasoning 段
   * 不产生文本)⇒ 超 cap 一旦开始 shift,两个数组与 segments 永久错位:segments 里还留着
   * 用户段(`目标:把回归跑绿`),`userTexts` 却已空 ⇒ intent 变空、续接材料丢失用户目标。
   *
   * 现改为**从 segments 现算**(单一真源):`segments[].userText` / `.assistantText` 本就在
   * append 时写好且随 segments 一起被 cap 裁掉,投影永远与段逐条对应,结构上不可能错位。
   * 过滤条件与旧实现的 push 判据严格对齐 —— 旧实现 push 的是 `ut.trim().slice(0,200)`
   * (trim 后非空才 push),故这里 `map(trim).filter(Boolean)` 得到逐条相同的旧语义。
   * @param {{segments?:object[]}|null} ep - current 缓冲(或任何带 segments 的对象)。
   * @returns {string[]} 非空文本数组(与旧 userTexts 逐条一致)。
   */
  function userTextsOfPre(ep) {
    const segs = (ep && Array.isArray(ep.segments)) ? ep.segments : []
    return segs.map((s) => String((s && s.userText) || '').trim().slice(0, 200)).filter(Boolean)
  }

  /** 见 userTextsOfPrePre —— assistant 侧的同一投影。
   * @param {{segments?:object[]}|null} ep - current 缓冲。
   * @returns {string[]} 非空助手文本数组(与旧 assistantTexts 逐条一致)。 */
  function assistantTextsOfPre(ep) {
    const segs = (ep && Array.isArray(ep.segments)) ? ep.segments : []
    return segs.map((s) => String((s && s.assistantText) || '').trim().slice(0, 200)).filter(Boolean)
  }

  /** 从累积文本提取 intent(2026-08-28 提纯;2026-09-16 issue#30 改为共享清洗器)。
   *  旧实现用一条正则猜"像注入"的文本,而注入形态会演进(新增标签/换行拼法)⇒ 漏判后
   *  污染文本进入 intent,再经 hub 变成"观察型 procedure"的 title。现在复用
   *  `stripRuntimeIntentPre`(与 intent-clean 同源),按**行边界**剥离运行时信封,
   *  保留代码块/引用块内的字面示例,避免误删真实文本。
   *  ★issue#430：文本源改走派生投影(不再读已删除的 ep.userTexts 字段)。 */
  function extractIntent(ep) {
    const clean = userTextsOfPre(ep).map((t) => stripRuntimeIntentPre(t).trim()).filter(Boolean)
    return clean.length ? clean[0].slice(0, 60) : ''
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

  /** 推断 outcome(启发式:助手文本含失败信号→failure, 成功信号→success)。
   *  ★issue#430：文本源改走派生投影(不再读已删除的 ep.assistantTexts 字段)。 */
  function inferOutcome(ep) {
    const at = assistantTextsOfPre(ep).join(' ').toLowerCase()
    const failSig = ['失败', '错误', '报错', '无法', 'error', 'failed', 'exception']
    const succSig = ['成功', '完成', '已修复', '搞定', 'ok', 'done', 'success']
    if (failSig.some((s) => at.includes(s))) return 'failure'
    if (succSig.some((s) => at.includes(s))) return 'success'
    return 'unknown'
  }

  /** 提取未决事项(启发式:用户文本含问句/待办)。
   *  ★issue#430：文本源改走派生投影(不再读已删除的 ep.userTexts 字段)。 */
  function extractUnresolved(ep) {
    const ut = userTextsOfPre(ep).join(' ')
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
      entities: extractEntities(userTextsOfPre(current)),
      unresolved: extractUnresolved(current),
      outcome,
      success: outcome === 'success',
      // ★ A-7 修复(2026-09-21)：provenance 改为 **`sessionRef:eventSeq`**。
      //   旧实现只用 `'seg:' + eventSeq` ⇒ 不同会话里 eventSeq 从 1 重新计数时
      //   会产出完全相同的串(实测 ["seg:1","seg:1"]),既无法溯源到会话,
      //   也让"同一段被重复计入"与"两段恰好同号"在审计面上不可区分。
      provenance: current.segments.map((s) => String(current.sessionRef) + ':' + String(s.eventSeq)),
      startedAt: current.startedAt,
      consolidatedAt: nowFn(),
    }
    const v = validateEpisodePre(ep)
    if (!v.ok) { current = null; return { ok: false, reason: 'invalid:' + v.reason } }
    // ★ P2-11 修复(2026-09-21)：巩固入店前按 **episodeId 去重**。
    //   episodeId = hash(sessionRef, startedAt) ⇒ 同一会话在同一时间戳被重复巩固
    //   (或 restore/import 已带入同 id 记录)会产出**同一主键的第二条**，
    //   下游 query/statsFor 会把一次会话数成两次 ⇒ distinctSessions/success 读数虚高。
    //   去重策略:**后到者胜**(原地替换,不打乱既有顺序),与 fact-store restore 一致。
    const dupAt = episodes.findIndex((x) => x.episodeId === v.episode.episodeId)
    if (dupAt >= 0) episodes[dupAt] = v.episode
    else episodes.push(v.episode)
    // 保留策略: 超 retention 淘汰最旧
    if (episodes.length > cfg.retention) {
      episodes = episodes.slice(-cfg.retention)
      stats.retained++
    }
    current = null
    stats.consolidated++
    const pr = persist()
    return pr.ok
      ? { ok: true, episode: v.episode, persisted: true }
      : { ok: true, episode: v.episode, persisted: false, persistError: pr.error }
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
      .map(cloneEpisode)
  }
  function recent(n = 10) {
    return episodes.slice(-n).map(cloneEpisode)
  }
  function get(episodeId) {
    const e = episodes.find((x) => x.episodeId === episodeId)
    return e ? cloneEpisode(e) : null
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
      schemaVersion: 1, namespace: 'dsh-auto-memory-pre', policyVersion: EPISODIC_POLICY_VERSION,
      savedAt: nowFn(),
      // ★ P2-2 修复：快照数组字段同样做副本(调用方改快照不得改脏库内 episode)
      episodes: episodes.map(cloneEpisode),
      // ★issue#430：`userTexts` / `assistantTexts` **仍然序列化**(兼容旧快照读取方与既有
      //   源码守卫,见 restoreCurrentPre 的说明),但值由 `segments` **现算派生**,不再是独立
      //   维护的状态 —— 故二者恒与 segments 逐条对应,不可能再出现旧实现的错位。
      current: current ? {
        sessionRef: current.sessionRef, startedAt: current.startedAt,
        segments: current.segments.map((s) => ({ ...s })),
        userTexts: userTextsOfPre(current), assistantTexts: assistantTextsOfPre(current),
      } : null,
    }
  }
  /**
   * ★ 增量导入（2026-09-19 上游 PR #77 / issue #63 同步落地，**P0 数据丢失**）。
   *
   * **为什么必须单独有这个函数**：hub 的 `ingestJudgement` 原本对每行 `episodic_candidate`
   * 调 `restore({schemaVersion:1, episodes:[row]})`，而 `restore()` 是**快照整体替换**语义
   * （先 `episodes = []`）。worker 产出的候选行普遍缺 `validateEpisodePre` 必填字段
   * ⇒ 校验必拒（`restored:0`），**但 episodes 已被清空、current 已被置 null**，
   * 且 `restore()` 仍返回 `{ok:true}` ⇒ hub 记 `consumedEpisodic++` / `outcome:'restored'`
   * ⇒ 下次 consolidate/flush 把清空态落盘 ⇒ **一次 ingest 抹掉全部已巩固 episode，不可逆**。
   *
   * 契约（与 `restore` 严格区分）：
   *  - **绝不清空既有状态**（不清 episodes、不动 current）；
   *  - 逐条校验，**只追加合法项**，非法项计入 `rejected`（不静默）；
   *  - 按 `episodeId` **幂等去重**（重复导入同一行不产生副本）；
   *  - **不持久化**（由调用方决定何时 flush），与 `restore` 一致。
   * @param {Array} rows - 候选 episode 行（原始形态，内部走 validateEpisodePre）
   * @returns {{ok: boolean, imported: number, rejected: number, duplicates: number, reason?: string}}
   */
  function importEpisodes(rows) {
    if (!Array.isArray(rows)) return { ok: false, imported: 0, rejected: 0, duplicates: 0, reason: 'bad-rows' }
    let imported = 0, rejected = 0, duplicates = 0
    const seen = new Set(episodes.map((e) => e.episodeId))
    for (const raw of rows) {
      const v = validateEpisodePre(raw)
      if (!v.ok) { rejected++; continue }
      if (seen.has(v.episode.episodeId)) { duplicates++; continue }
      episodes.push(v.episode)
      seen.add(v.episode.episodeId)
      imported++
    }
    return { ok: true, imported, rejected, duplicates }
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
    current = restoreCurrentPre(data.current)
    return { ok: true, restored: episodes.length }
  }
  function clear() {
    episodes = []; current = null
    // ★ A-8：io.clear() 失败不得静默(残留快照会在下次 load 时"复活"已清空的 episode)
    let cleared = true, clearError
    try { io.clear() } catch (e) {
      cleared = false
      clearError = (e && e.message) ? String(e.message) : String(e)
    }
    return clearError !== undefined ? { ok: true, cleared, error: clearError } : { ok: true, cleared }
  }
  function dispose(reason) {
    if (disposed) return { ok: true, persisted: true, alreadyDisposed: true }
    disposed = true
    // ★ A-8：dispose 是最后一次落盘机会，失败必须外显
    const r = persist()
    return { ok: r.ok, persisted: r.ok, ...(r.error ? { error: r.error } : {}) }
  }

  /**
   * ★ A-8 修复(2026-09-21)：旧实现 `try { io.save(snapshot()) } catch (_) {}` **吞掉落盘失败** ——
   * 调用方看到 ok:true、宿主继续推进状态，但磁盘没写上，该状态**永不重写**(静默数据丢失)。
   * 现改为:① 返回结构化结果 `{ok, persisted}`(失败时附 error 文案); ② 失败记进模块内可读状态
   * `lastPersistError`(经 `getLastPersistError()` 暴露)。不引入任何新 import。
   * @returns {{ok:boolean, persisted:boolean, error?:string}}
   */
  let lastPersistError = null
  function persist() {
    try {
      io.save(snapshot())
      lastPersistError = null
      return { ok: true, persisted: true }
    } catch (e) {
      const msg = (e && e.message) ? String(e.message) : String(e)
      lastPersistError = msg
      return { ok: false, persisted: false, error: msg }
    }
  }

  return {
    append, consolidate, flush, query, recent, get, statsFor,
    snapshot, restore, importEpisodes, clear, dispose,
    /** ★ A-8：最近一次落盘失败(字符串)或 null —— 供宿主诊断"写盘失败但流程继续"的静默缺口。 */
    getLastPersistError: () => lastPersistError,
    getStats: () => ({ ...stats }),
    get size() { return episodes.length },
    get hasCurrent() { return !!current },
  }
}
/**
 * 三层注入装配（tier_layer_inject_pre_v1）—— 契约 C5
 * （`docs/internal/THREE-LAYER-CONTRACT.md` §2.1/§5、`SEMANTIC-ARCHITECTURE-SPEC.md` S5/S9）。
 *
 * 2026-09-14 建立。职责 = **把三层按闸门装成一段可注入文本**：
 *   - **Tier-0 常驻目录**（每轮都进，不依赖命中）：调 `lib/tier0-catalog-pre.js` 的目录生成器
 *     （`buildTier0CatalogFromTextPre`，配额开启），≤ `B0`=800 token（`max(ceil(chars/2), repo口径)`）；
 *   - **闸门下探 Tier-1**：仅当本轮有语义命中（或问题含深挖语义）时，给 top-`K`=8 条 L0 摘要，
 *     每条 ≤ `L1`=140 字符；未命中只给目录层（省 token 的关键）；
 *   - **按需下探 Tier-2**：问题带"要证据"语义（原文/逐字/行号/命令/复现）时，给命中块原文，
 *     单块 ≤ `B2`=2400 字符，超长显式标注"已截断，全文 N 字符"。
 *
 * **I7 显式降级标注**（本模块的存在理由之一）：任何一层缺数据都必须在这段文本里出现**可读的
 * 降级标记**——索引未就绪 / 语义臂不可用 / 某层为空 / 某层有候选但被裁光 / 来源读不到 / 目录为空，
 * 逐条写成 `[降级] …`，**绝不允许静默丢弃**。层账 `[层账]` 行把五层的"候选/进目录/裁剪"逐层摆出来。
 *
 * **S9 合规**：本模块零 IO、纯函数、不调大模型；`composeTieredInjectionPre` 同输入同输出。
 * UTF-8 无 BOM。（唯一的模块依赖是 `l0-extract-pre.js` 的 `isCurrentPre`，见下方 I5 一节；
 * 那也是个零 import 的纯模块，不引入 IO。）
 *
 * 为什么不在 `lib/tier0-catalog-pre.js` 里做这段渲染：那个模块是"目录生成器"（C4，纯文本内核 +
 * 一条 IO 入口），本模块是"注入装配"（C5，层与闸门）。分开后 C4 的 33 条回归不受影响。
 *
 * I5 状态过滤（2026-09-14 P0 / C8 修复）：注入侧**必须**挡下非 current 条目，见 `filterCurrentHitsPre`。
 */
import {
  buildTier0CatalogFromTextPre,
  estimateTokensPre,
  TIER0_DEFAULTS,
} from './tier0-catalog-pre.js'
// 状态判定的**唯一权威**在检索侧（`lib/l0-extract-pre.js:124 isCurrentPre`）。
// 这里刻意 **import 而不是复制一份**：复制会让「检索侧放行、注入侧挡下」这种漂移成为可能，
// 而本模块的 S9 检查只禁网络/LLM/子进程/await，不禁内部纯模块引用（该模块本身零 import）。
import { isCurrentPre } from './l0-extract-pre.js'

export const TIER_INJECT_VERSION = 'tier_layer_inject_pre_v1'

/** 契约预算（冻结；变更须同步 `THREE-LAYER-CONTRACT.md` §4.3）。 */
export const TIER_BUDGET_PRE_V1 = Object.freeze({
  B0: 800,
  L1: 140,
  K: 8,
  B2: 2400,
  projectRatio: 0.6,
  floorRatio: 0.1,
  maxTier2Blocks: 2,
})

/** 段落标记（可读、可 grep；不改既有 Reference Tail 的固定边界行）。 */
export const TIER_MARK_PRE_V1 = Object.freeze({
  degrade: '[降级]',
  gate: '[闸门]',
  account: '[层账]',
  quota: '[配额]',
})

/** 五层展示顺序（与契约 §2 优先级一致：project > whiteboard > user > reflection > log）。 */
export const TIER_LAYER_ORDER_PRE_V1 = Object.freeze(['project', 'whiteboard', 'user', 'reflection', 'log'])

/** 深挖语义（决定"要不要下探 Tier-1"）：含这些词说明用户在问"怎么/为什么/具体"。 */
const DEEP_INTENT_RE = /为什么|怎么|如何|具体|复现|细节|原理|根因|哪个文件|在哪/
/** 要证据语义（决定"要不要下探 Tier-2"）：含这些词说明需要原文/行号/命令。 */
const EVIDENCE_INTENT_RE = /原文|逐字|引用|行号|命令|复现步骤|具体怎么|具体是|怎么写|怎么改|报错|堆栈|traceback/

const clean = (s) => String(s == null ? '' : s).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').trim()
const clip = (s, n) => {
  const t = clean(s)
  if (t.length <= n) return t
  return t.slice(0, Math.max(1, n - 1)) + '…'
}
const stamp = (v) => {
  const n = Number(v)
  return Number.isFinite(n) ? n.toFixed(2) : null
}

/**
 * I5 状态过滤 —— **注入侧**挡下非 `current` 条目（2026-09-14 · P0 / 核实表 C8）。
 *
 * **为什么必须补在注入侧**：契约不变式 I5（`THREE-LAYER-CONTRACT.md:183`）要求「非 `current`
 * 的条目在**检索结果与注入内容两处**都被过滤」。检索侧（`lib/index.js` 的 l0Corpus 过滤与语义臂）
 * 早已过滤，注入侧却一直没做。实测证据（不是推测）：`node tools/_redproof/red-proof-phase0-t01.mjs`
 * 在修复前 **0 通过 / 4 报红** —— 4 条候选（2 current + 1 superseded + 1 retracted）**全部**进了
 * Tier-1 注入文本与最终文本，Tier-1 条数 = 4 而非 2。
 *
 * **旧实现错在哪**：`buildTier1SectionPre` 只把 `h.status` 当**展示字段**渲染进 `- [layer/status]`
 * 前缀（`[user/superseded]`），却从不用它做准入判断 —— 于是"知道自己是被撤回的记忆，却照样注入"。
 *
 * **判定口径**：直接复用检索侧的 `isCurrentPre`（status 缺失/空 ⇒ 放行=旧记录兼容；
 * `'current'` ⇒ 放行；**其余任何值含未知值 ⇒ 挡下**，未知状态 fail closed）。
 *
 * **挡下不静默**（I7）：返回 `droppedIds` 供调用方渲染 `[降级]` 行，绝不无声丢弃。
 *
 * @param {Array} hits 候选命中（`{memoryId,score,excerpt,layer,status}`）
 * @returns {{kept:Array, dropped:Array, total:number, current:number, droppedCount:number, droppedIds:string[]}}
 */
export function filterCurrentHitsPre(hits) {
  const list = Array.isArray(hits) ? hits.filter(Boolean) : []
  const kept = []
  const dropped = []
  for (const h of list) {
    if (isCurrentPre(h)) kept.push(h)
    else dropped.push(h)
  }
  return {
    kept,
    dropped,
    total: list.length,
    current: kept.length,
    droppedCount: dropped.length,
    droppedIds: dropped.map((h) => clean(h && h.memoryId)).filter(Boolean),
  }
}

/** 状态判定别名（导出给测试与调用方做跨模块一致性对照；实体是 `l0-extract-pre.js:isCurrentPre`）。 */
export const isCurrentStatusPre = isCurrentPre

/**
 * 注入来源排除（群反馈第 4 条 / P0-④d「可排除来源」）。
 *
 * **要解决的问题**：记忆一旦被判定为错的（某条白板段、某天日志段），它仍会**每轮**被
 * Tier-0 目录或 Tier-1 下探重新灌进上下文 —— 即群反馈原话「避免因为记忆问题导致结果一路走错」。
 * `supersede` 只能覆盖"被新版本替代"，覆盖不了"这条来源整个不可信、我不想再看到它"。
 *
 * **匹配口径**（写死、可测，只支持精确/前缀，不做模糊猜测）：
 *   - 精确路径：`D:\ws\.dsh-memory\MEMORY.md` 命中该文件；
 *   - 目录前缀：`D:\ws\.dsh-memory\archive\`（以 `/` 或 `\` 结尾）命中其下全部文件；
 *   - 记忆 id：`mem_<32hex>` 命中该条命中项；
 *   - 层名：`log` / `whiteboard` / `project` / `user` / `reflection` 命中整层。
 * 路径比较在 Windows 下大小写不敏感、且统一分隔符（与 `memoryWriteLockKey` 同口径）。
 *
 * **挡下不静默**（沿用 I7）：返回 `dropped`/`matchedPatterns`，由调用方渲染 `[降级]` 行。
 *
 * @param {Array} hits 候选命中（`{memoryId,excerpt,layer,status,path,sourceRef}`）
 * @param {Array<string>} patterns 用户配置的排除项
 * @returns {{kept:Array, dropped:Array, total:number, droppedCount:number, matchedPatterns:string[]}}
 */
export function filterExcludedSourcesPre(hits, patterns) {
  const list = Array.isArray(hits) ? hits.filter(Boolean) : []
  const pats = (Array.isArray(patterns) ? patterns : [])
    .map((p) => clean(p)).filter(Boolean)
  if (!pats.length) {
    return { kept: list, dropped: [], total: list.length, droppedCount: 0, matchedPatterns: [] }
  }
  const normPath = (s) => String(s == null ? '' : s).replace(/[\\/]+/g, '/').toLowerCase()
  const isDirPat = (p) => /[\\/]$/.test(p)
  const layers = new Set(TIER_LAYER_ORDER_PRE_V1)
  const matched = new Set()
  const kept = []
  const dropped = []
  for (const h of list) {
    const id = clean(h && h.memoryId)
    const layer = clean(h && h.layer)
    const candPaths = [h && h.path, h && h.sourceRef, h && h.label]
      .map((x) => String(x == null ? '' : x)).filter(Boolean)
    let hit = null
    for (const raw of pats) {
      const p = raw
      // ① 记忆 id（精确）
      if (/^mem_[0-9a-f]{32}$/i.test(p)) {
        if (id && id.toLowerCase() === p.toLowerCase()) { hit = p; break }
        continue
      }
      // ② 层名（整层排除；仅当该 token 恰好是一个合法层名时才按层解释，避免误吞路径）
      if (layers.has(p) && !/[\\/:]/.test(p)) {
        if (layer && layer.toLowerCase() === p.toLowerCase()) { hit = p; break }
        continue
      }
      // ③/④ 路径：目录前缀 或 精确文件
      const np = normPath(p)
      if (isDirPat(p)) {
        if (candPaths.some((c) => normPath(c).startsWith(np))) { hit = p; break }
      } else if (candPaths.some((c) => normPath(c) === np)) { hit = p; break }
    }
    if (hit) { dropped.push(h); matched.add(hit) } else kept.push(h)
  }
  return {
    kept, dropped,
    total: list.length,
    droppedCount: dropped.length,
    matchedPatterns: Array.from(matched),
  }
}

/**
 * T0-2 复用判定的原因码 → 可读中文（2026-09-14 · P0）。
 *
 * **为什么需要它**：`lib/index.js` 原实现只用
 * `Date.now() - gh.at < 30*60000` 判"本轮命中投影还能不能用"——**只查时间、不查版本**。
 * 于是「A 快照产生的候选，到 B 快照才准备输出」时会照样被复用（A 的正文进了 B 的注入），
 * 这正是 T0-2 要挡的场景（契约 I6：三层必须来自同一份快照，混版视为错误）。
 */
export const TIER_HITS_REUSE_REASONS_PRE_V1 = Object.freeze({
  ok: '投影仍属当前快照',
  'no-projection': '本轮无命中投影（尚未发生激活投递）',
  'stale-time': '投影超出新鲜度窗口（仅时间新鲜不足以保证版本一致）',
  'identity-unknown': '缺少会话/工作区身份，无法证明投影归属（fail closed）',
  'session-mismatch': '投影来自其它会话（A/B 串线风险）',
  'workspace-mismatch': '投影来自其它工作区',
  'version-unknown': '投影未携带版本字段或当前版本不可得，无法证明同版（fail closed）',
  'context-version-changed': '上下文版本已变化（候选产生于旧上下文）',
  'miv-changed': '记忆索引版本已变化（候选产生于旧快照）',
  'observation-mismatch': '观测身份不匹配（不是同一次观测产生的候选）',
})

/** 原因码 → 可读中文（未知码原样返回，便于排障时不吞信息）。 */
export function describeReuseReasonPre(code) {
  const k = clean(code)
  return TIER_HITS_REUSE_REASONS_PRE_V1[k] || k || '未知原因'
}

/**
 * T0-2：判断 `_tierGateHits` 投影能否在本轮复用 —— **必须比对版本，不能只看时间**。
 *
 * **旧实现的错**（`lib/index.js:3894`，改为调用本函数）：
 * ```js
 * const fresh = Date.now() - gh.at < 30*60000
 * const sameSession = !agentSessionId || !gh || !gh.sessionId || gh.sessionId === agentSessionId
 * ```
 * 两个缺陷：① 只查时间；② 身份缺失时**fail open**（`!agentSessionId` 直接算通过）
 * ⇒ 拿不到会话身份时会把别的会话的候选当本轮的用。本函数一律 **fail closed**：
 * **凡不能证明是同一份快照、同一次观测、同一个会话，就不复用**。
 *
 * 不复用的后果只是"本轮不下探 Tier-1"（省 token 的安全侧），绝不是静默错误。
 * 调用方必须把 `reason` 渲染成可见的降级行（I7：降级不静默）。
 *
 * @param {object} input
 * @param {object|null} input.projection `engine._tierGateHits`（可能为 null 或旧形状）
 * @param {number} input.now 当前时间戳
 * @param {string} input.sessionId 当前 agent 的会话 id（取不到则传空串）
 * @param {number|undefined} input.contextVersion 当前 runtime 的 contextVersion
 * @param {string|null|undefined} input.miv 当前语料的 memoryIndexVersion（取不到传 null）
 * @param {number} [input.maxAgeMs] 新鲜度窗口（默认 30 分钟；时间门仍保留，但不再是唯一门）
 * @returns {{reuse:boolean, reason:string, reasonText:string, question:string, hits:Array,
 *            snapshot:{contextVersion:*, miv:*, observationId:*, requestKey:*, at:*}}}
 */
export function selectReusableTierHitsPre(input = {}) {
  const o = input && typeof input === 'object' ? input : {}
  const gh = o.projection && typeof o.projection === 'object' ? o.projection : null
  const now = Number.isFinite(Number(o.now)) ? Number(o.now) : Date.now()
  const maxAgeMs = Number(o.maxAgeMs) > 0 ? Number(o.maxAgeMs) : 30 * 60000
  const no = (reason) => ({
    reuse: false, reason, reasonText: describeReuseReasonPre(reason), question: '', hits: [],
    snapshot: {
      contextVersion: gh ? gh.contextVersion : undefined, miv: gh ? gh.miv : undefined,
      observationId: gh ? gh.observationId : undefined, requestKey: gh ? gh.requestKey : undefined,
      at: gh ? gh.at : undefined,
    },
  })

  if (!gh) return no('no-projection')
  // ① 时间门（保留：它挡的是"旧投影留太久"，但**它单独不足以复用**）
  const at = Number(gh.at)
  if (!Number.isFinite(at) || now - at >= maxAgeMs) return no('stale-time')
  // ② 身份门：任一侧缺身份 ⇒ 不能证明归属 ⇒ 不复用（旧实现在这里 fail open）
  const curSession = clean(o.sessionId)
  const projSession = clean(gh.sessionId)
  if (!curSession || !projSession) return no('identity-unknown')
  if (projSession !== curSession) return no('session-mismatch')
  const curWs = clean(o.workspaceKey)
  const projWs = clean(gh.workspaceKey)
  if (curWs && projWs && curWs !== projWs) return no('workspace-mismatch')
  // ③ 版本门（T0-2 的核心）：contextVersion 必须两侧可得且相等
  const curCv = o.contextVersion
  const projCv = gh.contextVersion
  if (!Number.isInteger(Number(projCv)) || !Number.isInteger(Number(curCv))) return no('version-unknown')
  if (Number(curCv) !== Number(projCv)) return no('context-version-changed')
  // ④ 快照门：miv 必须两侧可得且相等（拿不到当前 miv 时 fail closed，不猜）
  const curMiv = clean(o.miv)
  const projMiv = clean(gh.miv)
  if (!curMiv || !projMiv) return no('version-unknown')
  if (curMiv !== projMiv) return no('miv-changed')
  // ⑤ 观测门：投影必须能指出是哪一次观测产生的（T0-2 要求携带 observationId）
  const projObs = clean(gh.observationId)
  if (!projObs) return no('observation-mismatch')
  const expectObs = clean(o.observationId)
  if (expectObs && expectObs !== projObs) return no('observation-mismatch')

  const hits = Array.isArray(gh.hits) ? gh.hits.filter(Boolean) : []
  if (!hits.length) return no('no-projection')
  return {
    reuse: true, reason: 'ok', reasonText: describeReuseReasonPre('ok'),
    question: clean(gh.question), hits,
    snapshot: { contextVersion: projCv, miv: projMiv, observationId: projObs, requestKey: clean(gh.requestKey), at },
  }
}

/** 跳过原因 → 可读中文（I7：降级行必须人能读懂，不能只写机器枚举）。 */
export const SKIP_REASON_TEXT_PRE_V1 = Object.freeze({
  'missing-path': '路径未提供',
  'not-found': '文件不存在',
  'not-a-file': '路径不是文件',
  'too-large': '文件超出单文件上限',
  empty: '文件为空',
  'read-error': '读取失败',
  'stat-error': '无法访问',
  'unknown-layer': '层名非法',
  'no-items': '解析不出目录条目',
})

/** 原因码 → 可读中文。 */
export function describeReasonPre(reason) {
  const key = clean(reason)
  if (!key) return '未知原因'
  return SKIP_REASON_TEXT_PRE_V1[key] || key
}

/**
 * 层账行（每层候选/进目录/裁剪；`reflection 0(无数据)` 这类"没有就说没有"是 I7 的落点）。
 * @param {Record<string,{candidates:number,picked:number,dropped:number,tokens:number,cap:number|null,floor:number}>} perLayer
 * @param {string[]} [order]
 */
export function tierLayerAccountLinePre(perLayer, order) {
  const layers = Array.isArray(order) && order.length ? order : TIER_LAYER_ORDER_PRE_V1
  const segs = layers.map((layer) => {
    const m = (perLayer && perLayer[layer]) || null
    if (!m) return layer + ' ?'
    if (!m.candidates) return layer + ' 0(无数据)'
    return layer + ' ' + m.picked + '/' + m.candidates + (m.dropped ? '(裁' + m.dropped + ')' : '')
  })
  const dropped = layers.reduce((a, l) => a + (((perLayer && perLayer[l]) || {}).dropped || 0), 0)
  return TIER_MARK_PRE_V1.account + ' ' + segs.join(' · ') + (dropped ? ' · 合计裁剪 ' + dropped + ' 条' : '')
}

/**
 * 收集降级项（I7）。返回 `[{code, layer?, text}]`，`text` 以 `[降级]` 开头，可直接进注入文本。
 *
 * 覆盖：目录为空 / 来源读不到或空 / 某层无数据 / 某层有候选却被裁光 / 引用索引未就绪 /
 * 语义臂不可用。**每一类都必须显式落一条**，否则调用方测试会红（见 smoke-test-c5-*）。
 */
export function collectDegradationsPre(input = {}) {
  const o = input && typeof input === 'object' ? input : {}
  const catalog = o.catalog || null
  const out = []
  const mark = TIER_MARK_PRE_V1.degrade + ' '

  if (!catalog) {
    out.push({ code: 'catalog-missing', text: mark + 'Tier-0 目录生成器未返回结果（本轮无目录层）' })
  } else {
    if (!Array.isArray(catalog.items) || !catalog.items.length) {
      const n = Array.isArray(catalog.skipped) ? catalog.skipped.length : 0
      out.push({ code: 'tier0-empty', text: mark + 'Tier-0 目录为空' + (n ? '（跳过来源 ' + n + ' 个）' : '（无可渲染条目）') })
    }
    for (const s of Array.isArray(catalog.skipped) ? catalog.skipped : []) {
      out.push({
        code: 'source-unavailable',
        layer: clean(s && s.layer),
        text: mark + clean(s && s.layer) + ' 层来源不可用 · ' + describeReasonPre(s && s.reason)
          + (clean(s && s.path) ? ' · ' + clean(s.path) : '') + '（本轮该来源未进目录）',
      })
    }
    const quota = catalog.quota || null
    if (quota) {
      for (const layer of Array.isArray(quota.degradedLayers) ? quota.degradedLayers : []) {
        const m = (quota.perLayer || {})[layer] || {}
        out.push({
          code: 'layer-dropped',
          layer,
          text: mark + layer + ' 层有 ' + (m.candidates || 0) + ' 条候选但 0 条进目录（配额/预算裁剪）；需要时用 memory_search 下探该层',
        })
      }
      // I7 明确要求"层为空"也要显式标注（不能只在层账里露出一个 0 就算说过）。
      const emptyLayers = Array.isArray(quota.emptyLayers) ? quota.emptyLayers : []
      if (emptyLayers.length) {
        out.push({
          code: 'layers-empty',
          text: mark + '空层：' + emptyLayers.join('、') + '（本轮该层无数据可注入，非静默丢弃）',
        })
      }
    }
  }

  if (o.indexNotReady) {
    const r = clean(typeof o.indexNotReady === 'string' ? o.indexNotReady : o.indexNotReady.reason) || 'unknown'
    out.push({
      code: 'index-not-ready',
      text: mark + '语义索引未就绪（' + r + '）· 本轮降级为词法命中 + 常驻目录，未静默丢弃注入',
    })
  }
  if (o.semanticArm === false || o.semanticArm === 'unavailable') {
    out.push({ code: 'semantic-arm', text: mark + '语义臂不可用 · 本轮仅词法命中' })
  }
  for (const extra of Array.isArray(o.extraDegradations) ? o.extraDegradations : []) {
    const t = clean(extra)
    if (t) out.push({ code: 'extra', text: mark + t })
  }
  return out
}

/**
 * 闸门（契约 §5）：默认只给 Tier-0；命中或深挖语义 → Tier-1；要证据 → Tier-2。
 * @param {{hits?:Array, question?:string}} input
 * @returns {{level:'tier0'|'tier1'|'tier2', hitCount:number, reasons:string[], deep:boolean, evidence:boolean}}
 */
export function decideTierGatePre(input = {}) {
  const hits = Array.isArray(input && input.hits) ? input.hits.filter(Boolean) : []
  const q = clean(input && input.question)
  const deep = DEEP_INTENT_RE.test(q)
  const evidence = EVIDENCE_INTENT_RE.test(q)
  const reasons = []
  if (!hits.length) {
    reasons.push('no-hit')
    if (deep) reasons.push('deep-intent')
    if (evidence) reasons.push('evidence-intent')
    // 未命中：即便问题想深挖也没有候选可下探 —— 只给目录层（省 token 的关键路径）。
    return { level: 'tier0', hitCount: 0, reasons, deep, evidence }
  }
  reasons.push('hit=' + hits.length)
  if (deep) reasons.push('deep-intent')
  if (evidence) reasons.push('evidence-intent')
  if (evidence) return { level: 'tier2', hitCount: hits.length, reasons, deep, evidence }
  return { level: 'tier1', hitCount: hits.length, reasons, deep, evidence }
}

/** 取命中项的摘要源（L0 摘要优先；无则退到标题+摘录）。 */
function hitSummarySourcePre(h) {
  const oneLine = clean(h && (h.oneLine || h.summary || h.title))
  const body = clean(h && (h.excerptFull || h.excerpt || h.text))
  if (oneLine && body && !body.startsWith(oneLine)) return oneLine + '：' + body
  return oneLine || body
}

/**
 * Tier-1 渲染：top-`K` 条（默认 8），每条摘要 ≤ `L1`（默认 140）字符，按分值降序；
 * 超出 K 的部分**显式计数**（不静默截断）。
 */
export function buildTier1SectionPre(hits, opts = {}) {
  const K = Math.max(1, Number((opts && opts.maxItems) || TIER_BUDGET_PRE_V1.K))
  const L1 = Math.max(8, Number((opts && opts.itemChars) || TIER_BUDGET_PRE_V1.L1))
  const list = (Array.isArray(hits) ? hits.filter(Boolean) : [])
    .map((h, i) => ({ h, i, s: Number(h.score) }))
    .sort((a, b) => (Number.isFinite(b.s) ? b.s : -1) - (Number.isFinite(a.s) ? a.s : -1) || a.i - b.i)
  const kept = list.slice(0, K)
  const lines = kept.map(({ h }) => {
    const layer = clean(h.layer) || 'log'
    const status = clean(h.status) || 'current'
    const sc = stamp(h.score)
    const id = clean(h.memoryId)
    return '- [' + layer + '/' + status + ']' + (sc ? ' (' + sc + ')' : '') + ' '
      + clip(hitSummarySourcePre(h), L1) + (id ? ' · ' + id : '')
  })
  const overflow = list.length - kept.length
  const head = '[Tier-1 命中摘要 · ' + kept.length + '/' + list.length + ' 条 · 每条 ≤' + L1 + ' 字 · K=' + K + ']'
  const tail = overflow > 0 ? [TIER_MARK_PRE_V1.degrade + ' Tier-1 另 ' + overflow + ' 条命中未展开（K=' + K + ' 上限）；需要时用 memory_recall_pre 取'] : []
  return {
    text: [head].concat(lines, tail).join('\n'),
    lines,
    count: kept.length,
    overflow,
    truncated: overflow > 0,
  }
}

/**
 * Tier-2 渲染：命中块原文，单块 ≤ `B2`（默认 2400）字符；超长块显式标注"已截断，全文 N 字符"。
 */
export function buildTier2SectionPre(hits, opts = {}) {
  const B2 = Math.max(80, Number((opts && opts.maxChars) || TIER_BUDGET_PRE_V1.B2))
  const maxBlocks = Math.max(1, Number((opts && opts.maxBlocks) || TIER_BUDGET_PRE_V1.maxTier2Blocks))
  const list = (Array.isArray(hits) ? hits.filter(Boolean) : [])
    .map((h, i) => ({ h, i, s: Number(h.score) }))
    .sort((a, b) => (Number.isFinite(b.s) ? b.s : -1) - (Number.isFinite(a.s) ? a.s : -1) || a.i - b.i)
    .slice(0, maxBlocks)
  const blocks = []
  for (const { h } of list) {
    const raw = clean(h.excerptFull || h.excerpt || h.text)
    if (!raw) continue
    const layer = clean(h.layer) || 'log'
    const id = clean(h.memoryId)
    const clipped = raw.length > B2
      ? raw.slice(0, Math.max(1, B2 - 24)) + '…（已截断，全文 ' + raw.length + ' 字符）'
      : raw
    blocks.push('- [' + layer + ']' + (id ? ' ' + id : '') + '\n  ' + clipped)
  }
  return {
    text: ['[Tier-2 原文块 · ' + blocks.length + ' 块 · 每块 ≤' + B2 + ' 字符]'].concat(blocks).join('\n'),
    count: blocks.length,
  }
}

/**
 * C5 主入口：三层装配。**纯函数**（同输入同输出、零 IO、零 LLM）。
 *
 * @param {object} input
 * @param {Array<{layer:string,text:string,path?:string}>} [input.sources] 已读入内存的语料来源
 * @param {object} [input.catalog] 已建好的 Tier-0 目录结果（给了就不再自建）
 * @param {number} [input.maxTokens] Tier-0 预算（≤ B0=800；默认 800）
 * @param {Array} [input.hits] 当前轮语义命中（`{memoryId,score,excerpt,layer,status}`）；
 *   **非 current 的条目会在此被 I5 挡下**（见 `filterCurrentHitsPre`），返回体的 `hits` 是过滤账。
 * @param {string} [input.question] 当前轮 query（决定闸门档位）
 * @param {string|{reason:string}} [input.indexNotReady] 索引未就绪原因（I7 降级标注）
 * @param {boolean|'unavailable'} [input.semanticArm] 语义臂可用性（false → 显式降级）
 * @param {boolean} [input.enabled] false → 返回空文本（调用方可完全关闭；不注入空壳）
 * @returns {{text:string, tier0:object|null, gate:object, tier1:object|null, tier2:object|null,
 *            degradations:Array, tokens:number, maxTokens:number, degraded:boolean, level:string,
 *            hits:{kept:Array,dropped:Array,total:number,current:number,droppedCount:number,droppedIds:string[]}}}
 */
export function composeTieredInjectionPre(input = {}) {
  const o = input && typeof input === 'object' ? input : {}
  const maxTokens = Math.max(60, Number(o.maxTokens) > 0 ? Math.min(Number(o.maxTokens), TIER_BUDGET_PRE_V1.B0) : TIER_BUDGET_PRE_V1.B0)
  // I5 状态过滤（2026-09-14 P0 / C8）：**闸门之前**先挡下非 current —— 顺序很关键。
  // 若放在 Tier-1 渲染里过滤，闸门仍会看到"有命中"而下探、渲染出空段，浪费一轮预算且语义错乱；
  // 放在闸门前，则"全是 superseded"会自然退化成 tier0（本轮无可下探内容），这才是真实处境。
  const gateHits0 = filterCurrentHitsPre(o.hits)
  // 群反馈第 4 条：用户显式排除的来源（坏记忆不再反复灌入）。与 I5 同层、同在闸门之前 ——
  // 被排除项不得再影响下探决策，否则"排除了却仍然下探/占预算"等于没排除。
  const exHits = filterExcludedSourcesPre(gateHits0.kept, o.excludeSources)
  const gateHits = { ...gateHits0, kept: exHits.kept }
  if (o.enabled === false) {
    return {
      text: '', tier0: null, tier0Tokens: 0,
      gate: { level: 'tier0', hitCount: 0, reasons: ['disabled'], deep: false, evidence: false },
      tier1: null, tier2: null, degradations: [], tokens: 0, maxTokens, trimmedLines: 0, degraded: false, level: 'tier0',
      hits: gateHits,
    }
  }
  const catalog = o.catalog || buildTier0CatalogFromTextPre(Array.isArray(o.sources) ? o.sources : [], {
    maxTokens,
    estimateMode: 'conservative',
    quota: { projectRatio: TIER_BUDGET_PRE_V1.projectRatio, floorRatio: TIER_BUDGET_PRE_V1.floorRatio },
  })
  const degradations = collectDegradationsPre({
    catalog,
    indexNotReady: o.indexNotReady,
    semanticArm: o.semanticArm,
    extraDegradations: o.extraDegradations,
  })
  // 群反馈第 4 条：被用户排除的来源同样**不静默**（I7）—— 只报被排除项数与模式，不吐正文。
  if (exHits.droppedCount > 0) {
    degradations.push({
      code: 'excluded-source',
      text: TIER_MARK_PRE_V1.degrade + ' 已按用户排除项挡下 ' + exHits.droppedCount + ' 条命中（'
        + exHits.matchedPatterns.slice(0, 3).map((p) => clean(p)).join(' / ') + '）· 不进注入',
    })
  }
  // I5 的可见性（I7 精神）：挡下了就写清挡了几条、都是什么状态，绝不静默。
  // 只写 id（32 位锚点）与状态，**不写被挡条目的正文** —— 否则等于换个位置泄露被撤回的内容。
  if (gateHits.droppedCount > 0) {
    const states = Array.from(new Set(gateHits.dropped.map((h) => clean(h && h.status) || '(空)')))
    degradations.push({
      code: 'status-filtered',
      text: TIER_MARK_PRE_V1.degrade + ' 已按 I5 挡下 ' + gateHits.droppedCount + ' 条非 current 命中（'
        + states.join('/') + '）· 审计视图仍可见，但不进注入',
    })
  }
  const gate = decideTierGatePre({ hits: gateHits.kept, question: o.question })
  const tier1 = gate.level === 'tier1' || gate.level === 'tier2'
    ? buildTier1SectionPre(gateHits.kept, { maxItems: o.K, itemChars: o.L1 })
    : null
  const tier2 = gate.level === 'tier2'
    ? buildTier2SectionPre(gateHits.kept, { maxChars: o.B2, maxBlocks: o.maxBlocks })
    : null

  const head = '[Tier-0 常驻目录 · 指引层 · ≤B0=' + TIER_BUDGET_PRE_V1.B0 + ' token(实计 ' + catalog.tokens + ') · '
    + (Array.isArray(catalog.items) ? catalog.items.length : 0) + ' 条]'
  const headParts = [head]
  if (Array.isArray(catalog.items) && catalog.items.length) headParts.push(catalog.text)
  if (catalog.quota) headParts.push(tierLayerAccountLinePre(catalog.quota.perLayer))
  for (const d of degradations) headParts.push(d.text)
  const drillParts = []
  if (gate.level === 'tier0') {
    headParts.push(TIER_MARK_PRE_V1.gate + ' 本轮无语义命中（' + gate.reasons.join(',') + '）→ 仅目录层，未下探 Tier-1/Tier-2')
  } else {
    headParts.push(TIER_MARK_PRE_V1.gate + ' 本轮命中 ' + gate.hitCount + ' 条（' + gate.reasons.join(',') + '）→ 下探 Tier-1')
    if (tier1) drillParts.push(tier1.text)
    if (tier2) {
      drillParts.push(TIER_MARK_PRE_V1.gate + ' 需要证据语义 → 继续下探 Tier-2（单块 ≤' + TIER_BUDGET_PRE_V1.B2 + ' 字符）')
      drillParts.push(tier2.text)
    }
  }
  // 总长门（`injectBudgetChars` 侧给出）：只裁"下探段"，**目录层与降级行永不裁**——
  // 否则超预算会把 I7 的降级标注裁掉，"不静默"就成了空话。
  //
  // T0-3 修复（2026-09-14 P0）：旧实现有两处，都让这个"门"名不副实（读码确认）：
  //   ① 裁剪循环只算 `headParts`，而降级说明是**在裁剪之后**才 push 进去的
  //      ⇒ 最终长度 = 裁剪目标 + 降级行长度，**可以超过 maxTotalChars**（门放走了自己该拦的东西）；
  //   ② 没有"头部本身已超"的出口：若目录 + 降级行本身就超预算，旧代码静默照写，读者无从知道。
  // 现改为：**先把降级行算进 head 长度**再裁下探段；裁完把降级行**真正回写进 headParts**
  // （否则文本里根本没有这一行 —— 这是本段第一版实现的 bug，靠 `claimed == len` 自检抓到）；
  // 若 head 本身已超，如实标注超出量（目录层与降级行按 I7 不可裁 ⇒ 尽力门 + 显式超额，不假装达标）。
  let trimmed = 0
  let headOverBudget = 0
  let claimedTotalChars = 0
  const maxTotal = Number(o.maxTotalChars) > 0 ? Number(o.maxTotalChars) : 0
  if (maxTotal) {
    const noteFor = (n) => TIER_MARK_PRE_V1.degrade + ' 下探段超注入预算，已裁剪 ' + n + ' 行（目录层与降级标注不受影响）'
    const lines = drillParts.join('\n').split('\n').filter(Boolean)
    // 用"预留降级行长度"的保守估计先裁（降级行的字数随 trimmed 变化，先按最坏情况占位）。
    const reserve = noteFor(999).length
    while (lines.length && (headParts.join('\n').length + reserve + 1 + lines.join('\n').length) > maxTotal) {
      lines.pop(); trimmed++
    }
    // 裁完再用**确定的**降级行文本复核一次，确保不会因为降级行本身而超
    let note = trimmed > 0 ? noteFor(trimmed) : ''
    while (lines.length && (headParts.join('\n').length + (note ? note.length + 1 : 0) + 1 + lines.join('\n').length) > maxTotal) {
      lines.pop(); trimmed++
      note = noteFor(trimmed)
    }
    if (note) headParts.push(note)
    drillParts.length = 0
    if (lines.length) drillParts.push(lines.join('\n'))
    const headLen = headParts.join('\n').length
    const drillLen = drillParts.join('\n').length
    claimedTotalChars = headLen + (drillLen ? 1 + drillLen : 0)
    if (claimedTotalChars > maxTotal) {
      // 走投无路：目录层与降级行按 I7 不可裁 ⇒ **如实标注**，绝不假装达标。
      headOverBudget = claimedTotalChars - maxTotal
      const overNote = TIER_MARK_PRE_V1.degrade + ' 目录层与降级标注不可裁，本轮合计仍超注入预算 '
        + headOverBudget + ' 字符（尽力门 + 显式超额，不静默）'
      headParts.push(overNote)
      claimedTotalChars = headParts.join('\n').length + (drillLen ? 1 + drillLen : 0)
    }
  }
  const text = headParts.filter(Boolean).concat(drillParts.filter(Boolean)).join('\n')
  return {
    text,
    tier0: catalog,
    tier0Tokens: estimateTokensPre(catalog && catalog.text ? catalog.text : ''),
    gate,
    tier1,
    tier2,
    degradations,
    tokens: estimateTierTokensPre(text),
    /** 实际序列化长度（唯一口径，T0-3：不再让"扣账成本"与"实际注入"两本账）。 */
    textChars: text.length,
    maxTokens,
    maxTotalChars: maxTotal,
    /** 总长门裁剪掉的行数（0 = 未裁）。 */
    trimmedLines: trimmed,
    /** >0 表示"不可裁部分本身就超预算"，已如实标注（尽力门，不假装达标）。 */
    headOverBudgetChars: headOverBudget,
    /** 门所声称的合计长度（含降级行自身；`== text.length` 时为校准一致）。 */
    claimedTotalChars,
    degraded: degradations.length > 0,
    level: gate.level,
    // I5 过滤账（P0/C8）：调用方与测试都靠它区分「本来没命中」与「命中被状态挡下」。
    hits: gateHits,
    // 群反馈第 4 条排除账：区分「本来没命中」与「命中被用户排除项挡下」（可测、可观测）。
    excluded: { count: exHits.droppedCount, total: exHits.total, patterns: exHits.matchedPatterns },
  }
}

/**
 * 注入段的 token 记账（与 Tier-0 同一口径：`max(ceil(chars/2), ceil(chars/4)+4)`）。
 * 薄封装 `tier0-catalog-pre.js` 的估算器，保证全链路只有一个 token 口径（契约 §4.6）。
 */
export function estimateTierTokensPre(text) {
  return estimateTokensPre(text)
}

export { TIER0_DEFAULTS }

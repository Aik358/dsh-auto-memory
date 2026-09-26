/**
 * team-inject.js —— 团队注入段的**预算仲裁**（纯函数，B7 / ★最高风险批）。
 *
 * ## 为什么单独一个模块（而不是改 renderMemoryDynamic 里那段）
 * `renderMemoryDynamic` 是**注入主路径**，已被 181 条回归里的多条字节断言锁住。
 * 直接在它内部加"团队段"有两个致命风险：
 *   1. **两份预算账**：团队段若自己算一次限额，注入总量会超出 `injectBudgetChars`；
 *   2. **优先级错位**：团队段若占 'must'，会把个人规则段挤掉。
 * ⇒ 本模块**只做一件事**：给定「已有分项账 + 团队候选段 + 总预算」，
 *    返回**应当追加哪些段**，使总长不超预算、且 `must` 优先于 `normal` 优先于 `low`。
 *    它不读磁盘、不读 state、不认识 cfg ⇒ 可在源码抽取型测试里独立执行。
 *
 * ## 与既有实现的关系
 * 既有 `composeMemoryEnvelopePre` 已有"超额先丢 low、must 永不丢"的策略。
 * 本模块**复用同一套 priority 词汇**（low/normal/must），并把团队段**接进同一本账**，
 * 而不是另开一本。⇒ 判据：团队段与个人段**共用一个预算闸**，谁都不能超发。
 *
 * ## 纪律
 *  1. **teamEnabled=false 或不启用注入 ⇒ 返回空数组**（调用方据此走原路径，字节不变）。
 *  2. 团队段**默认 priority='low'**：宁可团队信息被裁，也不挤掉用户的规则/笔记。
 *  3. 绝不抛；任何畸形输入降级为「不追加」。
 */

export const TEAM_INJECT_DEFAULT_PRIORITY = 'low'
export const TEAM_INJECT_MAX_SEGMENTS_PRE = 6

/** 段的优先级权重（数字越大越保得住）。 */
function rankOfPre(p) {
  const s = String(p || 'normal')
  if (s === 'must') return 3
  if (s === 'low') return 1
  return 2
}

/** 单个段的估算成本：按字符数（与既有账本同口径）。 */
function costOfPre(seg) {
  try { return String((seg && seg.text) || '').length } catch (_) { return 0 }
}

/**
 * 计算"还能塞下多少"。
 * `usedChars` = 已占用（既有分项账的实际长度），`budgetChars` = 总预算。
 * 绝不用负数。
 */
export function remainingPre(usedChars, budgetChars) {
  const u = Number.isFinite(Number(usedChars)) ? Number(usedChars) : 0
  const b = Number.isFinite(Number(budgetChars)) ? Number(budgetChars) : 0
  const r = b - u
  return r > 0 ? r : 0
}

/**
 * 在预算内挑选可追加的团队段。
 *
 * 入参：
 *   candidates  : [{ bucket, kind, text, priority }]  候选团队段
 *   usedChars   : 既有分项账已占用字符数
 *   budgetChars : 总预算（injectBudgetChars）
 *   enabled     : 是否启用团队注入（缺省 false ⇒ 直接返回空）
 *
 * 返回：`{ accepted: [...], skipped: [...], usedAfter, remainingAfter }`
 *   入选段**按原顺序**返回（保持渲染顺序），但**挑选时按优先级**（高者先占位）。
 * 绝不抛。
 */
export function pickTeamSegmentsPre(candidates, usedChars, budgetChars, enabled) {
  const empty = { accepted: [], skipped: [], usedAfter: Number(usedChars) || 0, remainingAfter: 0 }
  try {
    if (enabled !== true) return empty
    const list = Array.isArray(candidates) ? candidates.filter(function (c) { return c && typeof c === 'object' && typeof c.text === 'string' && c.text !== '' }) : []
    if (!list.length) { empty.remainingAfter = remainingPre(usedChars, budgetChars); return empty }

    // ① 按「优先级降序 → 原序升序」排定占位次序（稳定排序，Node ≥11 保证稳定）
    const ordered = list
      .map(function (c, idx) { return { c: c, idx: idx, rank: rankOfPre(c.priority), cost: costOfPre(c) } })
      .sort(function (a, b) { return (b.rank - a.rank) || (a.idx - b.idx) })

    // ② 贪心占位
    let left = remainingPre(usedChars, budgetChars)
    const acceptedIdx = Object.create(null)
    const skipped = []
    for (const o of ordered) {
      if (o.cost <= left) {
        acceptedIdx[o.idx] = true
        left -= o.cost
      } else {
        skipped.push({ kind: o.c.kind, reason: 'over-budget', cost: o.cost, left: left })
      }
    }

    // ③ 按原顺序输出，保住渲染顺序
    const accepted = []
    for (let i = 0; i < list.length; i += 1) if (acceptedIdx[i]) accepted.push(list[i])

    const usedAfter = (Number(usedChars) || 0) + accepted.reduce(function (s, c) { return s + costOfPre(c) }, 0)
    return { accepted: accepted, skipped: skipped, usedAfter: usedAfter, remainingAfter: remainingPre(usedAfter, budgetChars) }
  } catch (_) { return empty }
}

/**
 * 把团队候选段**归一化**成与既有分项账同形状的段。
 * 缺省 priority = 'low'（团队信息不与用户内容抢位）。
 * 超过 `maxSegments` 直接丢弃（防御上游误传大数组）。
 */
export function normalizeTeamSegmentsPre(raw, maxSegments) {
  const cap = Number.isFinite(Number(maxSegments)) && Number(maxSegments) > 0
    ? Math.floor(Number(maxSegments)) : TEAM_INJECT_MAX_SEGMENTS_PRE
  const out = []
  try {
    const list = Array.isArray(raw) ? raw : []
    for (const it of list) {
      if (out.length >= cap) break
      if (!it || typeof it !== 'object') continue
      const text = typeof it.text === 'string' ? it.text : ''
      if (!text) continue
      out.push({
        bucket: String(it.bucket || 'otherDynamic'),
        kind: String(it.kind || 'team-section'),
        text: text,
        priority: String(it.priority || TEAM_INJECT_DEFAULT_PRIORITY),
      })
    }
  } catch (_) { /* 降级为空 */ }
  return out
}

export function createTeamInject(options) {
  const opt = options || {}
  const nowFn = typeof opt.now === 'function' ? opt.now : function () { return Date.now() }
  let lastPick = null

  /**
   * 一次注入决策。**不改任何状态以外的副作用**：只记 lastPick 供 status() 读。
   * `enabled` 由调用方传入（index.js 用 `teamEnabled && teamInjectEnabled` 计算）。
   */
  function decide(candidates, usedChars, budgetChars, enabled) {
    const norm = normalizeTeamSegmentsPre(candidates, opt.maxSegments)
    const res = pickTeamSegmentsPre(norm, usedChars, budgetChars, enabled === true)
    lastPick = {
      at: nowFn(), enabled: enabled === true,
      offered: norm.length, accepted: res.accepted.length, skipped: res.skipped.length,
      usedChars: Number(usedChars) || 0, budgetChars: Number(budgetChars) || 0,
      usedAfter: res.usedAfter, remainingAfter: res.remainingAfter,
    }
    return res
  }

  function status() {
    return lastPick ? Object.assign({}, lastPick) : { at: 0, enabled: false, offered: 0, accepted: 0, skipped: 0, usedChars: 0, budgetChars: 0, usedAfter: 0, remainingAfter: 0 }
  }

  function describe() {
    return { defaultPriority: TEAM_INJECT_DEFAULT_PRIORITY, maxSegments: TEAM_INJECT_MAX_SEGMENTS_PRE, priorities: ['low', 'normal', 'must'] }
  }

  return { decide: decide, status: status, describe: describe }
}

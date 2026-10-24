/**
 * injection-zones.js —— v4 注入面「一框三区」（批次 C-1）
 *
 * 设计依据：MASTER-PLAN §5.5 C-1（INJECTION-PLAN §2）。文档只给了一张表，没有给可执行判据，
 * 因此这里把「区」从**隐式约定**变成**显式契约**：
 *
 *   区 I 遵循区（compliance）：frame-head / frame-meta / frame-tail / rules-section / frame-inscription
 *     → **不参与裁剪、逐字节稳定**。「稳定」是可断言的性质：同一份 state 两次渲染，区 I 文本必须逐字节相等；
 *       且**任何**裁剪发生后，区 I 的文本仍必须与裁剪前逐字节相等。
 *   区 II 记忆区（memory）：每轮都可能变化的证据（Tier-0 目录 / 白板 / 账本 / 事件卡 / 日志 / 笔记…）
 *     → 按 `updatedAt` 倒序是**上游**的事（refresh 已保证），本模块只负责**统一淘汰序**（沿用 envelope 的
 *       priority：low → normal → must，同档内从尾部丢）。
 *   区 III 通道区（channel）：条件式提醒（水位 / 待办索取 / 日历 / 外部记忆 / 欢迎 / 账本指针 / 待审理）
 *     → **触发即清位，合计 ≤300 字符**。超了先丢本区最低优先级段（must 永不丢，与 envelope 同纪律）。
 *
 * 为什么单独成模块而不是改 memory-envelope.js：envelope 被 47 个套件用 `new Function` 抽取执行，
 * 且它的三条不变式（E1/E2/E3）已有 88 条断言在守。本模块是**信封之前的一趟纯预处理**：
 * 输入 `segs`、输出 `segs`，不碰 envelope 的输出格式 ⇒ 零回归面。
 *
 * S9 合规：零 IO、零依赖、纯函数、无网络、无 LLM、全同步。
 */

export const INJECTION_ZONES_VERSION = 'injection_zones_pre_v1'

/** 三区（顺序 = 渲染顺序，也 = 面板展示顺序） */
export const ZONES_PRE_V1 = Object.freeze(['compliance', 'memory', 'channel'])

/** 区 III 合计硬上限（MASTER-PLAN C-1 表：≤300 字符） */
export const CHANNEL_ZONE_MAX_CHARS = 300

/**
 * kind → 区 的唯一真源。
 *
 * ⚠ 新增注入段时**必须**在此登记：未登记的 kind 会 fail-safe 落到 `memory`（证据区，可被淘汰序正常处理），
 *   **不会**默认为 compliance —— 默认给「不可裁剪」待遇会让一个拼写错误变成永久豁免（fail-open）。
 *   代价是漏登记会少一层保护而不是多一层，方向正确。
 */
export const ZONE_BY_KIND_PRE_V1 = Object.freeze({
  // ── 区 I 遵循区（不可裁剪；改这些等于改契约） ──
  'frame-head': 'compliance',
  'frame-meta': 'compliance',
  'frame-tail': 'compliance',
  'rules-section': 'compliance',
  'frame-inscription': 'compliance',
  // ── 区 II 记忆区（每轮可变的证据） ──
  'tier0-catalog': 'memory',
  'whiteboard-plan': 'memory',
  'handoff-ledger': 'memory',
  'event-cards': 'memory',
  'recent-logs': 'memory',
  'reflection': 'memory',
  'user-memory': 'memory',
  'project-notes': 'memory',
  'workspace-map': 'memory',
  // ── 区 III 通道区（条件式提醒；≤300） ──
  'water-advisory': 'channel',
  'plan-update-request': 'channel',
  'calendar': 'channel',
  'external-memory': 'channel',
  'external-sessions': 'channel',
  'welcome-title': 'channel',
  'welcome-body': 'channel',
  'handoff-pointer': 'channel',
  'event-unarchived': 'channel',
})

const ZONE_SET = new Set(ZONES_PRE_V1)
const ZONE_PRIORITY_RANK = Object.freeze({ low: 0, normal: 1, must: 2 })
const normPriority = (v) => (Object.prototype.hasOwnProperty.call(ZONE_PRIORITY_RANK, String(v)) ? String(v) : 'normal')

/** kind → 区（未登记 ⇒ 'memory'，理由见 ZONE_BY_KIND_PRE_V1 注释） */
export function zoneOfKindPre(kind) {
  const k = String(kind == null ? '' : kind)
  const z = ZONE_BY_KIND_PRE_V1[k]
  return ZONE_SET.has(z) ? z : 'memory'
}

/** 给每段附上 zone 字段（不改原对象，返回新数组） */
export function tagZonesPre(segs) {
  const list = Array.isArray(segs) ? segs : []
  return list.filter(Boolean).map((s) => ({
    bucket: s.bucket, kind: s.kind, text: String(s.text == null ? '' : s.text),
    priority: normPriority(s.priority), zone: zoneOfKindPre(s.kind),
  }))
}

/** 分区字符数账本 */
export function zoneCharsPre(segs) {
  const out = { compliance: 0, memory: 0, channel: 0, total: 0 }
  for (const s of tagZonesPre(segs)) { out[s.zone] += s.text.length; out.total += s.text.length }
  return out
}

/** 按区分组（保持输入顺序 ⇒ 渲染顺序不变） */
export function splitByZonePre(segs) {
  const out = { compliance: [], memory: [], channel: [] }
  for (const s of tagZonesPre(segs)) out[s.zone].push(s)
  return out
}

/**
 * 区 III 限额：超 `maxChars` 时**先丢本区最低优先级段**；同档内**从尾部丢**（与 envelope 同纪律）。
 * `must` 段**永不丢**（与 envelope 一致）—— 若全是 must 仍超限，如实报告超额，不牺牲硬性提醒。
 *
 * 返回：{ segs, dropped, degradations, ok }
 *   segs = 处理后的完整段落数组（**顺序不变**，只少了被丢的段）
 */
export function enforceChannelCapPre(segs, maxChars = CHANNEL_ZONE_MAX_CHARS) {
  const list = Array.isArray(segs) ? segs.filter(Boolean) : []
  const cap = Number.isFinite(Number(maxChars)) && Number(maxChars) >= 0 ? Math.floor(Number(maxChars)) : CHANNEL_ZONE_MAX_CHARS
  const dropped = []
  const degradations = []
  // ★关键：**保留调用方传入的原始段落对象**（不重新构造）。
  //   原因：调用方可能携带本模块不认识的字段（如团队段的 `priority: 6` 数字档），
  //   若在这里 tagZonesPre 重建一遍，会把不认识的 priority 归一成 'normal' ⇒ 静默改写上游语义。
  //   本模块只做「标记删除 + 原始顺序过滤」，绝不改写保留段的任何字段。
  const zoneOf = (seg) => zoneOfKindPre(seg && seg.kind)
  const prioOf = (seg) => normPriority(seg && seg.priority)
  const dead = new Set()
  const channelTotal = () => list.reduce((a, seg) => (zoneOf(seg) === 'channel' && !dead.has(seg) ? a + String(seg.text == null ? '' : seg.text).length : a), 0)
  for (;;) {
    if (channelTotal() <= cap) break
    const mine = list.filter((seg) => zoneOf(seg) === 'channel' && !dead.has(seg))
    const droppable = mine.filter((seg) => ZONE_PRIORITY_RANK[prioOf(seg)] < ZONE_PRIORITY_RANK.must)
    if (!droppable.length) {
      degradations.push({
        code: 'channel-over-cap-must', zone: 'channel', inject: true,
        text: '[降级] 通道区超出上限 ' + cap + ' 字符，但剩余 ' + mine.length + ' 段均为 must 级（不可丢）⇒ 本轮保留全部并如实报告超额 ' + (channelTotal() - cap) + ' 字符',
      })
      break
    }
    const minRank = Math.min(...droppable.map((seg) => ZONE_PRIORITY_RANK[prioOf(seg)]))
    const group = droppable.filter((seg) => ZONE_PRIORITY_RANK[prioOf(seg)] === minRank)
    const victim = group[group.length - 1]
    dead.add(victim)
    dropped.push({ bucket: victim.bucket, kind: victim.kind, chars: String(victim.text == null ? '' : victim.text).length, priority: prioOf(victim), zone: 'channel', reason: 'channel-over-cap-dropped' })
    degradations.push({
      code: 'channel-over-cap-dropped', zone: 'channel', inject: true,
      text: '[降级] 通道区超出上限 ' + cap + ' 字符 → 丢弃本区最低优先级的一段（' + victim.kind + '，priority=' + prioOf(victim) + '），未静默',
    })
  }
  return { segs: list.filter((seg) => !dead.has(seg)), dropped, degradations }
}
/**
 * 区 I 稳定性判据：裁剪前后，区 I 的 (kind,text) 序列**逐字节相等**。
 * 这是「不参与裁剪、逐字节稳定」的可执行定义 —— 不是「看起来没动」。
 */
export function complianceStablePre(before, after) {
  const pick = (segs) => tagZonesPre(segs).filter((s) => s.zone === 'compliance').map((s) => s.kind + '\u0000' + s.text)
  const a = pick(before), b = pick(after)
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false
  return true
}

/** 汇总（供 meta/面板：一眼看清三区各花多少） */
export function zoneReportPre(segs, maxChars = CHANNEL_ZONE_MAX_CHARS) {
  const chars = zoneCharsPre(segs)
  return {
    version: INJECTION_ZONES_VERSION,
    chars,
    channelCap: maxChars,
    channelOver: Math.max(0, chars.channel - maxChars),
    unknownKinds: tagZonesPre(segs).filter((s) => !Object.prototype.hasOwnProperty.call(ZONE_BY_KIND_PRE_V1, s.kind)).map((s) => s.kind),
  }
}

export default { ZONES_PRE_V1, ZONE_BY_KIND_PRE_V1, CHANNEL_ZONE_MAX_CHARS, zoneOfKindPre, tagZonesPre, zoneCharsPre, splitByZonePre, enforceChannelCapPre, complianceStablePre, zoneReportPre }
/**
 * 召回统计（recall statistics）—— 只**记录**、不参与排序。
 *
 * **为什么只记录**（用户 2026-09-22 拍板的分步走）：
 *   加权是**会自我强化**的机制（召回越多 → 权重越高 → 越容易被召回）。在埋点口径未被真实数据
 *   检验之前就加权，会把口径错误放大成系统性偏差。所以本模块**只累积计数并落盘**，
 *   `recall()` 的排序与返回**逐字节不变**（守卫断言：本模块的调用不改任何排序输入）。
 *
 * ★★ 三条通路**分账**，不混为一谈（用户 2026-09-22 明确要求）：
 *   同一个「召回」在三条通路里的含义完全不同，合成一个数会误导判断：
 *   | channel  | 含义             | 语义                 | 用来判断什么           |
 *   |----------|------------------|----------------------|------------------------|
 *   | `model`  | 模型主动检索     | 「我明确想找」= 高信号 | 什么内容真的有用、被需要 |
 *   | `inject` | 每轮自动注入     | 「系统一直塞给我」= 成本 | 注入预算花在哪、哪段最费 |
 *   | `shadow` | 主动唤起（影子） | 「系统觉得该唤起」= 系统判断质量 | 唤起准不准、命中率如何 |
 *   ⇒ 若把 inject 与 model 合并，会把「模型懒得检索」误读成「这条不重要」，
 *     而这个误读会被写进加权公式，越滚越偏。故**必须分开存、分开看**。
 *
 * 存储：`~/.dsh/memory/recall-stats.json`（单文件、原子写 tmp→rename、有上限裁剪）。
 * 设计约束：零依赖（只用 node: 内置）＋ fail-soft（统计坏了绝不影响召回本身）。
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync, rmSync } from 'node:fs'
import path from 'node:path'

export const RECALL_STATS_VERSION_PRE = 'recall_stats_pre_v1'

/** 三条通路的稳定 id（写盘/前端都按它索引，禁止改拼写）。 */
export const RECALL_CHANNELS_PRE = ['model', 'inject', 'shadow']

/** 单条记忆的计数上限（超出按 count 升序淘汰最冷门的，防止文件无限增长）。 */
const MAX_ENTRIES = 2000
/** 保留天数（按天分布只留最近 N 天）。 */
const MAX_DAYS = 90

/**
 * ★A-11b（2026-09-23 用户拍板「按推荐方案全修」）：落盘**节流**间隔（毫秒）。
 *
 * 事故（有硬证据）：`observe()` / `observeInjection()` 此前只置 `dirty = true`，
 * **全仓没有任何地方调 `.save()`**（只有 `reset()` 会）⇒ `~/.dsh/memory/recall-stats.json`
 * 文件根本不存在 ⇒ 宿主一重启统计全清零（面板上看到的一直是"当前进程内"的数）。
 * 修法：observe 尾部走 `maybeSave()` 节流落盘 —— 复用既有 `save()`，不新增开关。
 * 间隔 2s：注入通路每轮调一次，节流后写盘成本可忽略，且重启最多丢最后 2s 的增量。
 */
const SAVE_THROTTLE_MS = 2000

/**
 * @param {{file: () => string, now?: () => number}} opts
 *   `file()` 每次调用都重新解析路径（DSH_HOME 可能变），必须是函数而非字符串。
 */
export function createRecallStatsPre(opts = {}) {
  const nowFn = typeof opts.now === 'function' ? opts.now : () => Date.now()
  const fileOf = typeof opts.file === 'function' ? opts.file : () => ''
  let state = null
  let dirty = false
  // ★A-11b（2026-09-23）：上次落盘时刻，用于 observe 侧节流（见 maybeSave）。
  let lastSaveAt = 0

  const dayOf = (ms) => {
    const d = new Date(ms)
    const p = (n) => String(n).padStart(2, '0')
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
  }
  /** 一条通路的空白账本。三条各自独立，互不汇总（汇总只发生在 snapshot 的展示层）。 */
  const emptyChannel = () => ({
    events: 0,        // 这条通路发生了多少次（检索次数 / 注入轮数 / 唤起次数）
    hits: 0,          // 命中条目总数（inject 通道为「注入的条目数」）
    zeroHit: 0,       // 零命中次数（model 通道专有语义；其它通道记为 0）
    ids: {},          // id → { count, first, last, layer, score, reason }
    byLayer: {},      // layer → count
    byDay: {},        // yyyy-mm-dd → count
    lastAt: 0,
  })
  const empty = () => ({
    version: RECALL_STATS_VERSION_PRE,
    since: nowFn(),
    channels: { model: emptyChannel(), inject: emptyChannel(), shadow: emptyChannel() },
  })

  /** 兼容旧结构（v1 早期是扁平 queries/hits/byLayer…）→ 迁到 channels.model，不丢数据。 */
  function migrate(d) {
    if (d && d.channels && typeof d.channels === 'object') {
      const base = empty()
      for (const ch of RECALL_CHANNELS_PRE) {
        base.channels[ch] = Object.assign(emptyChannel(), (d.channels && d.channels[ch]) || {})
      }
      base.since = d.since || base.since
      return base
    }
    const base = empty()
    const m = base.channels.model
    m.events = Number(d.queries) || 0
    m.zeroHit = Number(d.zeroHit) || 0
    m.ids = (d.hits && typeof d.hits === 'object') ? d.hits : {}
    m.byLayer = (d.byLayer && typeof d.byLayer === 'object') ? d.byLayer : {}
    m.byDay = (d.byDay && typeof d.byDay === 'object') ? d.byDay : {}
    m.hits = Object.keys(m.ids).reduce((n, k) => n + ((m.ids[k] && m.ids[k].count) || 0), 0)
    m.lastAt = Number(d.lastQueryAt) || 0
    base.since = d.since || base.since
    return base
  }

  function load() {
    if (state) return state
    state = empty()
    try {
      const f = fileOf()
      if (f && existsSync(f)) {
        const d = JSON.parse(readFileSync(f, 'utf8'))
        if (d && typeof d === 'object' && d.version === RECALL_STATS_VERSION_PRE) {
          state = migrate(d)
        }
      }
    } catch (_) { state = empty() } // 坏文件不阻塞：从零开始，下一轮覆盖写回
    return state
  }

  function save() {
    if (!dirty) return false
    try {
      const f = fileOf()
      if (!f) return false
      mkdirSync(path.dirname(f), { recursive: true })
      const tmp = f + '.tmp'
      writeFileSync(tmp, JSON.stringify(state), 'utf8')
      renameSync(tmp, f) // 同目录原子替换
      dirty = false
      return true
    } catch (_) {
      try { if (fileOf()) rmSync(fileOf() + '.tmp', { force: true }) } catch (_) {}
      return false
    }
  }

  /**
   * ★A-11b（2026-09-23）：**节流落盘** —— observe 尾部唯一的写盘通路。
   *
   * 为什么必须有：本模块此前只 `dirty = true`，`save()` 除 `reset()` 外**无任何调用方**
   * ⇒ 统计从不落盘、重启即清零（面板上"召回统计不更新"的真因之一）。
   * 为什么节流：inject 通路**每轮**都会调 `observeInjection`，不节流就是每轮一次原子写。
   * 节流窗口内只置 dirty，下次 observe 或显式 `save()`（含 reset）时补写 —— 不丢数据，
   * 只把「多次增量」合并成「一次写」。`nowFn` 可注入 ⇒ 测试里能确定性地推进时钟。
   *
   * fail-soft：写失败不抛出（save() 内部已 try/catch，返回 false）。
   * @returns {boolean} 本次是否真的写了盘
   */
  function maybeSave() {
    if (!dirty) return false
    const t = nowFn()
    if (lastSaveAt && t - lastSaveAt < SAVE_THROTTLE_MS) return false
    const ok = save()
    if (ok) lastSaveAt = t
    return ok
  }

  /** 裁剪：**每通道**条目数上限 + 天数上限。按 count 升序淘汰最冷门的。 */
  function prune() {
    for (const ch of RECALL_CHANNELS_PRE) {
      const c = state.channels[ch]
      if (!c) continue
      const ids = Object.keys(c.ids)
      if (ids.length > MAX_ENTRIES) {
        ids.sort((a, b) => (c.ids[a].count || 0) - (c.ids[b].count || 0))
        for (const id of ids.slice(0, ids.length - MAX_ENTRIES)) delete c.ids[id]
      }
      const days = Object.keys(c.byDay)
      if (days.length > MAX_DAYS) {
        days.sort()
        for (const d of days.slice(0, days.length - MAX_DAYS)) delete c.byDay[d]
      }
    }
  }

  /**
   * 记一次事件。**只读入参、绝不修改** —— 调用方传的 hits/顺序不因本调用而变。
   *
   * ★★ channel 必须显式给：`model`（模型主动检索）/ `inject`（每轮自动注入）/ `shadow`（主动唤起）。
   *   缺省回落到 `model` 只是为了兼容旧调用点；**新调用点一律显式传**。
   *
   * @param {Array<{id:string, layer?:string, score?:number, reason?:string}>} hits
   * @param {{channel?:'model'|'inject'|'shadow', zero?:boolean, label?:string, chars?:number}} [meta]
   */
  function observe(hits, meta = {}) {
    try {
      const s = load()
      const t = nowFn()
      const ch = RECALL_CHANNELS_PRE.indexOf(meta.channel) >= 0 ? meta.channel : 'model'
      const c = s.channels[ch]
      c.events += 1
      c.lastAt = t
      const list = Array.isArray(hits) ? hits : []
      // 零命中：对 model 通道是「检索了但没东西」（重要信号）；其它通道同样计数，语义由展示层解释
      if (!list.length) c.zeroHit += 1
      c.hits += list.length
      const d = dayOf(t)
      for (const h of list) {
        const id = h && h.id ? String(h.id) : ''
        if (!id) continue
        const cur = c.ids[id] || { count: 0, first: t, last: t, layer: '', score: 0, reason: '' }
        cur.count += 1
        cur.last = t
        if (h.layer) cur.layer = String(h.layer)
        if (typeof h.score === 'number' && isFinite(h.score)) cur.score = h.score
        // label / chars：注入侧用来回答「哪一段最占预算」（无 id 的段落用它记账）
        if (h.__label) cur.reason = String(h.__label)
        if (typeof h.__chars === 'number' && isFinite(h.__chars)) cur.score = h.__chars
        if (h.reason) cur.reason = String(h.reason)
        c.ids[id] = cur
        const lyr = String(h.layer || 'unknown')
        c.byLayer[lyr] = (c.byLayer[lyr] || 0) + 1
        c.byDay[d] = (c.byDay[d] || 0) + 1
      }
      prune()
      dirty = true
      maybeSave()
      return true
    } catch (_) { return false } // fail-soft：统计绝不影响召回
  }

  /** 把一条通路的账本转成只读视图（已排序，直接可画图）。 */
  function viewOf(c) {
    const items = Object.keys(c.ids).map((id) => Object.assign({ id }, c.ids[id]))
    const top = items.slice().sort((a, b) => b.count - a.count || (b.last || 0) - (a.last || 0))
    const byLayer = Object.keys(c.byLayer).map((k) => ({ key: k, count: c.byLayer[k] }))
      .sort((a, b) => b.count - a.count)
    const byDay = Object.keys(c.byDay).sort().map((k) => ({ day: k, count: c.byDay[k] }))
    return {
      events: c.events,
      hits: c.hits,
      zeroHit: c.zeroHit,
      lastAt: c.lastAt,
      distinct: items.length,
      top: top.slice(0, 200),
      byLayer,
      byDay,
      warm: top.filter((it) => it.count <= 1).length, // 只出现过一次的（"冷门"候选）
    }
  }

  /** 面板/路由用的只读视图。**按通道分组返回**，不做跨通道汇总（汇总口径会误导）。 */
  function snapshot() {
    const s = load()
    const channels = {}
    for (const ch of RECALL_CHANNELS_PRE) channels[ch] = viewOf(s.channels[ch])
    return {
      version: RECALL_STATS_VERSION_PRE,
      since: s.since,
      channelIds: RECALL_CHANNELS_PRE.slice(),
      channels,
    }
  }

  /** 复位（面板按钮 / 测试）。 */
  function reset() {
    state = empty()
    dirty = true
    return save()
  }

  /**
   * 注入侧的段级记账（没有条目 id 的段落也能记）。
   * 用途：回答「哪一段最占注入预算」—— 段名当 id，字符数当 score。
   * @param {Array<{name:string, chars:number, layer?:string}>} segs
   */
  function observeInjection(segs) {
    const list = (Array.isArray(segs) ? segs : [])
      .filter((s) => s && s.name)
      .map((s) => ({
        id: 'seg:' + String(s.name),
        layer: s.layer || 'section',
        score: Number(s.chars) || 0,
        __label: String(s.name) + ' · ' + (Number(s.chars) || 0) + ' 字符',
      }))
    return observe(list, { channel: 'inject' })
  }

  return { observe, observeInjection, snapshot, reset, save, _load: load, _state: () => state }
}

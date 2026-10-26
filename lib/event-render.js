/**
 * event-render.js —— v4 事件三档渲染（批次 A 数据层）
 *
 * 设计依据：MASTER-PLAN §3.2（三档渲染，对齐既有三层契约）
 *   T0 ≤80 字/事件：name + status      → 事件目录（独立段 ≤400 字符）
 *   T1 ≤140 字/事件：summary 首句       → Tier-1 命中摘要
 *   T2 ≤2400 字/事件：完整四段 + 最近 3 检查点 → event-cards 段（只放 active 1–2 个）
 *
 * 纪律：纯函数、零 IO、零依赖；所有上限都是**硬上限**（超了截断并加标记，不静默）；
 * 同输入逐字节确定（可做基线锁）。
 */

export const RENDER_LIMITS = Object.freeze({ T0: 80, T1: 140, T2: 2400 })
/** 事件目录段总上限（D6 裁定：独立段 ≤400 字符） */
export const EVENT_CATALOG_MAX_CHARS = 400
export const TRUNC_MARK = '…'

/**
 * ★H4 分段预算（2026-10-25 · Lead 按**真实数据实测定**）。
 *
 * 为什么必须分段（实测证据，不是估计）：
 *   本机真实事件 checkpoints=23、sections 合计 1,229 字、单条 handoff 检查点 1,457 字。
 *   旧实现只有总限 2,400 ⇒ 实测输出恰好 2,400 且以省略号结尾，
 *   「· 最近检查点：」从第 1,297 字符才开始 ⇒ **headroom = 0**。
 *   ⇒ 新增的 percept(≤200)+panels(≤150) 无论放在哪，都只能从检查点里挤 350 字。
 *   ⇒ 只靠总限 = 「谁排前面谁活」；必须**每段有配额 + 总限兜底**。
 *
 * 预算加法核对（Lead 2026-10-25 定稿）：
 *   60(头) + 900(四段) + 200(percept) + 150(panels) + 10(检查点标题) + 900(检查点) + 120(outcome) = 2,340
 *   余 60 余量 ✓（总限 2,400 兜底仍在，但正常不该触发）
 *
 * ★为什么 outcome 有固定配额而不「有剩才加」：它排在最后，若只按剩余空间分配，
 *   会被前面的段饿死。而 outcome 是「这件事做完了什么」——事件卡片里信息密度最高的字段。
 *
 * ★为什么是**模块常量**而不是配置键：配置键总数有「163」的连环锁（散布 11 处文档），
 *   且这些是渲染内部份额、不是用户可调策略。
 */
export const T2_BUDGET = Object.freeze({
  SECTIONS: 900,        // 四段合计（**逐段截 + 合计回压**，不是简单整块截）
  PERCEPT_TOTAL: 200,   // 四个 percept 合计
  PERCEPT_ITEM: 50,     // 单个 percept 条目上限
  PANELS_TOTAL: 150,    // checkpoints[].panels 合计
  CHECKPOINTS: 900,     // 检查点块合计
  CHECKPOINT_ITEM: 300, // ★单条检查点上限（现值单条 1,457 字独占，不设则 3 条必撑爆）
  OUTCOME: 120,         // 成果段**保底**配额（不按剩余空间 —— 否则排最后的它会被饿死）；实际可用 = 保底 120 + 剩余，上限 400（见 renderT2Pre 内注释）
})

/** 按码点安全截断（不切坏代理对；结尾加省略号时保证总长 ≤ n） */
function cutPre(s, n) {
  const src = String(s == null ? '' : s)
  if (src.length <= n) return src
  if (n <= 1) return TRUNC_MARK.slice(0, Math.max(0, n))
  let end = n - 1
  const code = src.charCodeAt(end)
  if (code >= 0xdc00 && code <= 0xdfff) end -= 1
  return src.slice(0, Math.max(0, end)) + TRUNC_MARK
}

/**
 * 取 summary 的第一句。
 *
 * ★为什么英文句点要单独处理（2026-10-24 批次 A 实测）：
 *   ① 中英文标点（。！？；）是无歧义的句末 ⇒ 直接切；
 *   ② ASCII 的 `!` `?` `;` 也无歧义（后面通常跟空格/结尾）⇒ 直接切；
 *   ③ **ASCII 的 `.` 有歧义**：`v3.3.17` / `Dr. Smith` / `1.5x` 都不是句末。
 *      故只在「后面是空白或串尾」时才当句末（标准启发式）。
 *      若不这样区分，summary 里的版本号/小数会被切碎，T1 摘要就成了半句话。
 */
/** 句末标点位置扫描（**不用锚定前缀**：每个候选边界独立判定，才能跳过缩写继续找）。 */
const SENT_END_SCAN = /[。！？；]|[!?;](?=\s|$)|\.(?=\s|$)/g
/** 常见缩写（英文句点不是句末）。只收高频且低歧义的，宁可漏判也不误切。 */
const ABBREV = new Set(['dr', 'mr', 'mrs', 'ms', 'prof', 'sr', 'jr', 'st', 'vs', 'etc', 'e.g', 'i.e', 'no', 'fig', 'sec', 'vol', 'ch', 'pp', 'al'])
export function firstSentencePre(text, max = 140) {
  const src = String(text == null ? '' : text).trim()
  if (!src) return ''
  SENT_END_SCAN.lastIndex = 0
  let end = -1
  let m
  while ((m = SENT_END_SCAN.exec(src)) !== null) {
    const at = m.index
    const mark = m[0]
    if (mark === '.') {
      // 往前取「紧邻的词」判断是否缩写（含 e.g / i.e 这种带点形态）
      const before = src.slice(0, at)
      const token = (/([A-Za-z][A-Za-z.]*)$/.exec(before) || [])[1] || ''
      if (ABBREV.has(token.toLowerCase())) continue
    }
    end = at + mark.length
    break
  }
  const one = end > 0 ? src.slice(0, end) : src
  return cutPre(one.trim(), max)
}

/** T0：name + status（≤80）。status 用中文短标，省字节。 */
const STATUS_LABEL = Object.freeze({ active: '进行', paused: '搁置', closed: '完成' })
export function renderT0Pre(ev) {
  if (!ev) return ''
  const label = STATUS_LABEL[ev.status] || String(ev.status || '?')
  const name = String(ev.name || '').trim() || '(未命名)'
  const suffix = ' [' + label + ']'
  // 名称可占的宽度 = 上限 - 状态标 - 1 个分隔空格
  const room = RENDER_LIMITS.T0 - suffix.length - 1
  return cutPre(name, Math.max(1, room)) + suffix
}

/** T1：summary 首句（≤140）；剥掉换行（注入面不允许裸换行破坏块结构） */
export function renderT1Pre(ev) {
  if (!ev) return ''
  const text = String(ev.summary || '').replace(/\s*\n+\s*/g, ' ').trim()
  const one = firstSentencePre(text, RENDER_LIMITS.T1)
  return one || cutPre(String(ev.name || '').trim(), RENDER_LIMITS.T1)
}

/**
 * ★★2026-10-25 修 §6.2 文档缺陷：**禁止三元兜底** `x.text || x.promise || x.claim`。
 *
 * 依据 `event-store.js` L326–L329 的实际归一化（不是猜，是照抄）：
 *   userPercept  → { at, kind, stage, text, sourceRef }          ⇒ 文本载体 = **text**
 *   agentTrace   → { at, action, result, wasRefuted, sourceRef } ⇒ 文本载体 = **action**
 *   sharedGround → { at, claim, confirmedBy, correction, ... }   ⇒ 文本载体 = **claim**
 *   commitments  → { at, promise, boundary, state, sourceRef }   ⇒ 文本载体 = **promise**
 *
 * 文档 §6.2 原文用 `x.text || x.promise || x.claim` 兜底 ⇒ **agentTrace 会永远渲染成空串**
 * 然后被 filter 掉 ⇒ 四类里有 1 类永不显示（「只存不用」的另一种形态，凶手是规格写错）。
 * ⇒ 必须逐字段定义取值器。
 *
 * ★stage 不做优先级排序（Lead 2026-10-25 裁定）：
 *   PERCEPT_STAGES 是**五阶段流水线**（retrieved→delivered→used→mentioned→accepted），
 *   不是重要性等级；拿它当排序键是范畴错误。更重要：排序会**静默丢数据**
 *   （slice(-3) 之后又按 stage 过滤 = 双重裁剪）。⇒ 如实呈现 + 标出 stage 让模型自己判断。
 *
 * 表结构：[key, 标题, 文本取值器, 标记取值器]
 */
const PERCEPT_RENDER = [
  { key: 'userPercept',  title: '用户记忆',   text: (x) => x.text,    tag: (x) => x.stage },
  { key: 'agentTrace',   title: 'Agent 经历', text: (x) => x.action,  tag: (x) => (x.wasRefuted ? 'refuted' : '') },
  // ★★2026-10-25 修（Lead 问题 4）：sharedGround 的 `correction` 正文必须渲出来。
  //   correction = 「用户纠正了什么」，是四类记忆里最有价值的字段之一（§2.1 明写「用户纠正某项长期误解」）。
  //   旧实现只标 [corrected] 不显正文 = 有标记无内容。
  //   渲染成 `· [corrected] <claim>（纠正：<correction>）`，两者合计受 PERCEPT_ITEM 50 字预算约束，
  //   截断时**优先保 claim**（主信息），再给 correction 剩余空间。
  {
    key: 'sharedGround', title: '共同认知',
    text: (x) => x.claim,
    tag: (x) => (x.correction ? 'corrected' : ''),
    suffix: (x) => (x.correction ? '（纠正：' + String(x.correction) + '）' : ''),
  },
  { key: 'commitments',  title: '关系约定',   text: (x) => x.promise, tag: (x) => x.state },
]
/* ══════════════════════════════════════════════════════════════════════════
 * T2 分段拼装：**拆成三个可测子函数**（2026-10-25 Lead 硬要求）
 *
 * ★为什么必须拆：若只有一个 renderT2Pre 返回最终字符串，测试断言「四段 ≤900」时
 *   无法区分两种情况：
 *     ① 四段真的被压到 900（正确）
 *     ② 四段拼了 1,500，只是被总限 2,400 切掉了（假绿）
 *   ⇒ 必须能单独调用「分段拼装」并量它自己的输出长度。
 *
 * 每个子函数返回 { lines: string[], used: number, dropped: number }，
 *   used = 该段实际占用（**未经总限裁剪**，这就是断言要量的物理量）。
 * ══════════════════════════════════════════════════════════════════════════ */

/**
 * 四段拼装：**逐段截断 + 合计回压**。
 *
 * ★为什么不是「每段截到 900/4」就完事：每段 300 × 4 段 = 1,200 > 900。
 *   只做单段截断**不等于**合计 ≤900（Lead 明确点出的坑）。
 *   做法：先按均分配额逐段截，若合计仍超配，**从最长段开始回压**直到合计达标。
 *
 * @param {object} ev
 * @returns {{lines:string[], used:number, dropped:number}}
 */
export function buildSectionsBlockPre(ev) {
  const SEC_TITLES = [['goal', '目标'], ['doing', '进行中'], ['deadend', '失败与弯路'], ['next', '下一步']]
  const sec = (ev && ev.sections) || {}
  const rows = []
  for (const [key, title] of SEC_TITLES) {
    const body = String(sec[key] == null ? '' : sec[key]).replace(/\s*\n+\s*/g, ' / ').trim()
    if (body) rows.push({ title, body })
  }
  if (!rows.length) return { lines: [], used: 0, dropped: 0 }
  const BUDGET = T2_BUDGET.SECTIONS
  const OVERHEAD = 8
  const perRow = Math.max(30, Math.floor(BUDGET / rows.length) - OVERHEAD)
  const trimmed = rows.map((r) => ({ title: r.title, body: cutPre(r.body, perRow) }))
  const lineOf = (t) => '· ' + t.title + '：' + t.body
  let total = trimmed.reduce((a, t) => a + lineOf(t).length + 1, 0)
  let guard = 0
  while (total > BUDGET && guard++ < 400) {
    let longest = -1, longestLen = 0
    for (let i = 0; i < trimmed.length; i++) {
      const len = lineOf(trimmed[i]).length
      if (len > longestLen) { longestLen = len; longest = i }
    }
    if (longest < 0) break
    const cur = trimmed[longest].body
    const need = total - BUDGET
    if (cur.length <= 10) break
    const step = Math.max(1, Math.min(need, Math.max(1, Math.ceil(cur.length / 8))))
    const keep = Math.max(9, cur.length - step)
    const next = keep <= 9 ? cur.slice(0, 8) : cur.slice(0, keep - 1)
    trimmed[longest].body = next
    total = trimmed.reduce((a, t) => a + lineOf(t).length + 1, 0)
  }
  const lines = trimmed.map(lineOf)
  return { lines, used: lines.reduce((a, l) => a + l.length + 1, 0), dropped: 0 }
}

/**
 * 四个 percept 拼装（合计 ≤PERCEPT_TOTAL，每条 ≤PERCEPT_ITEM，最近 3 条，带 [stage]）。
 *
 * ★不按 stage 过滤/排序：PERCEPT_STAGES 是五阶段流水线不是重要性等级；
 *   排序 = 双重裁剪 = 静默丢数据（见 PERCEPT_RENDER 注释）。
 * ★getter 结果必须 String() 兜一层（Lead 要求）：某条 action 是对象时不能在 join 处炸。
 *
 * @param {object} ev
 * @returns {{lines:string[], used:number, dropped:number}}
 */
export function buildPerceptBlockPre(ev) {
  const lines = []
  let used = 0
  let dropped = 0
  for (const spec of PERCEPT_RENDER) {
    const arr = ev && Array.isArray(ev[spec.key]) ? ev[spec.key] : []
    if (!arr.length) continue
    const rows = []
    for (const item of arr.slice(-3)) {
      let raw = spec.text(item)
      raw = String(raw == null ? '' : raw).replace(/\s*\n+\s*/g, ' / ').trim()
      if (!raw) continue
      const tag = String(spec.tag(item) == null ? '' : spec.tag(item)).trim()
      const tagStr = tag ? '[' + tag + '] ' : ''
      // ★suffix（如 correction 正文）：与主文本**共享** PERCEPT_ITEM 预算；
      //   截断时优先保主文本（claim），剩余空间才给 suffix。
      const suffix = typeof spec.suffix === 'function' ? String(spec.suffix(item) == null ? '' : spec.suffix(item)) : ''
      let combined = raw
      if (suffix) {
        const roomForSuffix = T2_BUDGET.PERCEPT_ITEM - raw.length
        if (roomForSuffix > 8) combined = raw + cutPre(suffix, roomForSuffix)
        else combined = cutPre(raw, Math.max(10, T2_BUDGET.PERCEPT_ITEM - 8))
      } else {
        combined = cutPre(raw, T2_BUDGET.PERCEPT_ITEM)
      }
      rows.push('  - ' + tagStr + combined)
    }
    if (!rows.length) continue
    const head = '· ' + spec.title + '：'
    const headCost = head.length + 1
    const bodyCost = rows.reduce((a, r) => a + r.length + 1, 0)
    if (used + headCost + bodyCost > T2_BUDGET.PERCEPT_TOTAL) { dropped++; continue }
    lines.push(head)
    used += headCost
    for (const r of rows) { lines.push(r); used += r.length + 1 }
  }
  return { lines, used, dropped }
}

/**
 * 检查点 + panels 拼装（**同一次遍历**）。
 *
 * ★panels 必须紧跟其宿主检查点（不是全堆末尾）：panel 是「这条检查点的补充面板」。
 * ★至少保留最近 1 条检查点（Lead 硬要求）：若单条就超 900，全丢会导致
 *   「模型看到事件却看不到任何检查点」—— 那比截断更糟。冲突时**先保条数，再保单条长度**。
 *
 * @param {object} ev
 * @param {number} maxCk
 * @returns {{lines:string[], used:number, dropped:number}}
 */
export function buildCheckpointsBlockPre(ev, maxCk) {
  const n = Number.isFinite(maxCk) ? Math.max(0, Math.floor(maxCk)) : 3
  const cks = ev && Array.isArray(ev.checkpoints) ? ev.checkpoints.slice(-n) : []
  if (!cks.length) return { lines: [], used: 0, panelsUsed: 0, checkpointsDropped: 0, panelsDropped: 0 }
  const headLine = '· 最近检查点：'

  // ★★2026-10-25 修（Lead 实测 · 语义级缺陷）：**从最新往前遍历，保最新、丢最旧**。
  //   旧实现从 cks[0]（最旧）往后渲染、遇超预算 break ⇒ 丢的是**最新**的、留的是最旧的。
  //   而 renderT2Pre 的语义是「**最近**检查点」⇒ 留下最旧的、丢掉最新的 = **语义反转**。
  //   模型最需要知道「刚刚发生了什么」，不是「三天前发生了什么」。
  //   ★这个 bug 用造数测不出来：只有真实数据的 1,665 字长检查点才会触发 dropped。
  //
  // ★★2026-10-25 修（Lead 问题 3）：`used` **只算检查点行本身**，panel 行单独累进 `panelsUsed`。
  //   旧实现把 panel 长度加进 used，而 used 又要和 CHECKPOINTS(900) 比 ⇒ 两个预算互相蚕食，
  //   且「检查点正文实际占多少」永远测不出来。总占用由 renderT2Pre 算（used + panelsUsed）。
  const picked = []
  let used = 0
  let ckDropped = 0
  let forcedOne = false
  for (let i = cks.length - 1; i >= 0; i--) {
    const c = cks[i]
    const kind = String(c.kind || 'log')
    const rawText = String(c.text || '').replace(/\s*\n+\s*/g, ' / ').trim()
    let body = cutPre(rawText, T2_BUDGET.CHECKPOINT_ITEM)
    let line = '  - [' + kind + '] ' + body
    const overBlock = used + line.length + 1 > T2_BUDGET.CHECKPOINTS
    if (overBlock && picked.length >= 1) { ckDropped += 1; continue }
    if (overBlock && picked.length === 0) {
      // ★保底：最新那条无论如何都要进（先保条数，再保单条长度）
      const room = Math.max(20, T2_BUDGET.CHECKPOINTS - used - 20)
      body = cutPre(rawText, room)
      line = '  - [' + kind + '] ' + body
      forcedOne = true
    }
    picked.push({ line, c })
    used += line.length + 1
  }
  // 从最新往前收集 ⇒ 反转回时间正序（输出仍应为「旧→新」可读顺序）
  picked.reverse()

  // panels：单独预算、单独计数（问题 2）
  let panelsUsed = 0
  let panelsDropped = 0
  const lines = [headLine]
  const headCost = headLine.length + 1
  for (const item of picked) {
    lines.push(item.line)
    const ps = Array.isArray(item.c.panels) ? item.c.panels : []
    for (const pn of ps) {
      if (!pn || !pn.text) continue
      const pText = String(pn.text).replace(/\s*\n+\s*/g, ' / ').trim()
      if (!pText) continue
      const pKind = String(pn.kind || 'log')
      const pLine = '    · [' + pKind + '] ' + cutPre(pText, T2_BUDGET.PANELS_TOTAL)
      if (panelsUsed + pLine.length + 1 > T2_BUDGET.PANELS_TOTAL) { panelsDropped += 1; continue }
      lines.push(pLine)
      panelsUsed += pLine.length + 1
    }
  }
  if (ckDropped > 0) lines.push('  （另有 ' + ckDropped + ' 条**更旧**的检查点因预算未显示）')
  return { lines, used: used + headCost, panelsUsed, checkpointsDropped: ckDropped, panelsDropped, forcedOne }
}

/**
 * T2：完整四段 + 四个 percept + 检查点面板组 + 最近 3 检查点 + 成果（≤2400）。
 *
 * ★★渲染顺序（2026-10-25 Lead 硬要求，不可调换）：
 *   【事件】name [status]
 *   · 四段（buildSectionsBlockPre，合计 ≤SECTIONS）
 *   · 四个 percept（buildPerceptBlockPre，合计 ≤PERCEPT_TOTAL）
 *   · 检查点+panels（buildCheckpointsBlockPre，单条 ≤CHECKPOINT_ITEM、块 ≤CHECKPOINTS）
 *   · 成果（固定配额 ≤OUTCOME）
 *
 * **为什么 percept/panels 必须在检查点之前**：真实数据实测检查点块从第 1,297 字符才开始，
 *   若把新增块放在检查点之后，`cutPre(…, 2400)` 会把它们全部截掉 ⇒ H4 白做。
 */
export function renderT2Pre(ev, opts = {}) {
  if (!ev) return ''
  const maxCk = Number.isFinite(opts.maxCheckpoints) ? Math.max(0, Math.floor(opts.maxCheckpoints)) : 3
  const out = []
  out.push('【事件】' + String(ev.name || '(未命名)') + '  [' + (STATUS_LABEL[ev.status] || ev.status) + ']')

  const sections = buildSectionsBlockPre(ev)
  for (const l of sections.lines) out.push(l)

  const percept = buildPerceptBlockPre(ev)
  for (const l of percept.lines) out.push(l)

  const cks = buildCheckpointsBlockPre(ev, maxCk)
  for (const l of cks.lines) out.push(l)

  // ★★v4-H3-E2 修（Lead 2026-10-25 诊断，用户实测）：**outcome 从固定 120 改为「保底 120 + 吃剩余空间（上限 400）」**。
  //
  //   缺陷原貌：T2_BUDGET 合计 = 900+200+900+150+120 = 2,270 < 2,400；实测非 outcome 部分约 1,728，
  //   ⇒ outcome 实际可用 672 字，但固定 120 ⇒ **白浪费约 550 字**。
  //   而 outcome 是「这件事的成果」，对模型判断「值不值得借鉴」很关键，却被饿死。
  //
  //   ★修法：不改总限（RENDER_LIMITS.T2 仍是 2,400），只让 outcome **吃剩余**；
  //     仍保留**保底 120**（`Math.max(T2_BUDGET.OUTCOME, …)`）—— 防止前面的段占满后 outcome 被压成 0。
  //     上限 400：成果再重要也不该独占半屏（四段才是主体）。
  if (ev.outcome) {
    const body = String(ev.outcome).replace(/\s*\n+\s*/g, ' / ').trim()
    if (body) {
      const usedBefore = out.reduce((a, l) => a + l.length + 1, 0)
      const room = Math.max(T2_BUDGET.OUTCOME, Math.min(400, RENDER_LIMITS.T2 - usedBefore - 4))
      out.push('· 成果：' + cutPre(body, room))
    }
  }

  return cutPre(out.join('\n'), RENDER_LIMITS.T2)
}

/**
 * ★v5-P6-R5（2026-10-27）：事件目录的**可见性筛选**（用户裁定 Q8）。
 *
 * 背景：upgrade 后事件数可能到 80+，若目录全列会吃掉全部注入预算。
 * 用户裁定：「注入适配（事件目录只列 active + 最近 closed）建议采纳；
 *           **但已归档事件必须能被 memory_recall 检索到**」。
 *
 * ⇒ 本函数只做**注入面可见性**，不动存储、不动检索索引。
 *   已归档事件仍在 event-store.json 里，memory_recall / memory_expand 照常能查到。
 *
 * @param {Array} events
 * @param {{recentClosedDays?:number, now?:number, includeClosed?:boolean}} [opts]
 * @returns {{visible:Array, hiddenArchived:number, hiddenOldClosed:number}}
 */
export const DEFAULT_RECENT_CLOSED_DAYS = 14
export function filterCatalogVisiblePre(events, opts = {}) {
  const list = Array.isArray(events) ? events.filter(Boolean) : []
  const days = Number(opts.recentClosedDays) >= 0 ? Number(opts.recentClosedDays) : DEFAULT_RECENT_CLOSED_DAYS
  const now = Number(opts.now) > 0 ? Number(opts.now) : Date.now()
  const cutoff = now - days * 24 * 3600 * 1000
  const includeClosed = opts.includeClosed === true
  const visible = []
  let hiddenArchived = 0
  let hiddenOldClosed = 0
  for (const ev of list) {
    // ★★2026-10-27 修（R5 首版实现缺陷，B1 套件 7 条红抓到）：
    //   `status` **缺省必须按 'active' 处理**，不能按 ''（那是「未知/空」）。
    //   为什么：事件库里**早期事件与测试夹具**没有 status 字段，
    //   按 '' 归到「archived/未知」会把它们从注入面静默隐藏 ⇒ 用户看不到当前工作。
    //   判据：状态是**可选字段**，缺省语义只能是「正常活跃」，不可能是「已归档」。
    const status = String((ev && ev.status) || 'active')
    // ① active / paused 一律可见（paused 是「暂时停下」，不是归档）
    if (status === 'active' || status === 'paused') { visible.push(ev); continue }
    // ② closed：只保留最近 N 天更新过的
    if (status === 'closed') {
      const t = Number(ev.updatedAt) || Number(ev.closedAt) || 0
      if (t >= cutoff) { visible.push(ev); continue }
      hiddenOldClosed++
      continue
    }
    // ③ archived（或未知状态）⇒ 不进注入面（仍可被检索）
    if (status === 'archived' || status === '') { hiddenArchived++; continue }
    // ④ 其他未知状态：保守起见可见（宁可多给，不要静默吞掉事件）
    visible.push(ev)
  }
  void includeClosed
  return { visible, hiddenArchived, hiddenOldClosed }
}

/** 事件目录段（D6：独立段 ≤400 字符）。输入按 updatedAt 降序（调用方保证或这里排）。 */
export function renderEventCatalogPre(events, opts = {}) {
  // ★★v5-P6-R5（2026-10-27）：可见性筛选是**可选开关**，默认关闭。
  //
  //   为什么是 opt-in 而不是默认开启（首版实现踩到的坑）：
  //   ① `renderEventCatalogPre` 是**既有公开契约**，B1 套件（22 条）依赖「全量渲染」语义，
  //      默认开启会让 7 条断言红 —— 那是**我改了契约**，不是判据过期。
  //      （本仓铁律：不要动被守卫的字符串/契约；改行为要找能改的维度。）
  //   ② 筛选是**产品策略**（用户裁定 Q8），不是渲染函数的内在语义。
  //      ⇒ 由**调用方**（lib/index.js 注入侧）显式声明要哪种语义。
  //   ③ 默认关闭也保证「旧调用点不改就不会变」——向后兼容。
  const vis = opts.applyVisibility === true
    ? filterCatalogVisiblePre(events, opts)
    : { visible: (Array.isArray(events) ? events.filter(Boolean) : []), hiddenArchived: 0, hiddenOldClosed: 0 }
  const list = vis.visible
  if (!list.length) return { text: '', included: 0, dropped: 0, hiddenArchived: vis.hiddenArchived, hiddenOldClosed: vis.hiddenOldClosed }
  // ★v4-B1（2026-10-25）：`excludeIds` —— 先把「已被 T2 卡片展开的事件」滤掉再渲染。
  //   为什么需要：`event-cards`（T2）取 active 前 N 个并**展开全文**；若目录再把它们列一遍，
  //   那几行是**纯重复**（同一个事件的两个视角指向同一份内容），白占预算。
  //   ★为什么不能用「included > picks.length」判：3 个 active 时 included=3 > picks=2，
  //   但目录里前 2 行与卡片完全重复，只有第 3 行是新信息 ⇒ 数量比较会漏掉「部分重复」。
  //   ⇒ 正确口径是**排除已展开后还剩什么**：剩下为空 ⇒ 整段零字节（由调用方按空串判断）。
  //   ★范围只影响「选择哪些行」，updatedAt 降序 / maxChars 截断 / included / dropped 语义一字不变。
  const exclude = new Set(Array.isArray(opts.excludeIds) ? opts.excludeIds.map((x) => String(x == null ? '' : x)).filter(Boolean) : [])
  const list2 = exclude.size ? list.filter((e) => !exclude.has(String((e && e.id) || ''))) : list
  if (!list2.length) return { text: '', included: 0, dropped: 0 }
  const max = Number.isFinite(opts.maxChars) ? Math.max(0, Math.floor(opts.maxChars)) : EVENT_CATALOG_MAX_CHARS
  const sorted = list2.slice().sort((a, b) => (Number(b.updatedAt) || 0) - (Number(a.updatedAt) || 0))
  const parts = []
  let used = 0, dropped = 0
  for (const ev of sorted) {
    const line = '· ' + renderT0Pre(ev)
    const cost = line.length + (parts.length ? 1 : 0)
    if (used + cost > max) { dropped = sorted.length - parts.length; break }
    parts.push(line); used += cost
  }
  return { text: parts.join('\n'), included: parts.length, dropped: Math.max(0, dropped), hiddenArchived: vis.hiddenArchived, hiddenOldClosed: vis.hiddenOldClosed }
}

/** 取 active 事件里最近更新的前 N 个做 T2（默认 2，与契约「只放 active 1–2 个」一致） */
export function pickT2EventsPre(events, max = 2) {
  const list = Array.isArray(events) ? events.filter((e) => e && e.status === 'active') : []
  return list.sort((a, b) => (Number(b.updatedAt) || 0) - (Number(a.updatedAt) || 0)).slice(0, Math.max(0, Math.floor(max)))
}

export default { RENDER_LIMITS, T2_BUDGET, EVENT_CATALOG_MAX_CHARS, DEFAULT_RECENT_CLOSED_DAYS, filterCatalogVisiblePre, firstSentencePre, renderT0Pre, renderT1Pre, renderT2Pre, renderEventCatalogPre, pickT2EventsPre }
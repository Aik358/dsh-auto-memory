/**
 * event-regroup.js —— ★R1（2026-10-27）：**语义化事件重整**的纯函数层。
 *
 * 设计与背景见 artifacts/UPGRADE-REGROUP-PLAN-2026-10-26.md（用户已批准 Q1–Q10）。
 *
 * ## 这个模块解决什么问题
 *
 * 旧版「把账本变成事件」用的是**纯确定性聚类**（目标段首行相同 / 6 小时内 2-gram 重合），
 * 实测产出垃圾：一篇账本 = 一个事件，事件名直接取「目标段首行」，
 * 而那行往往是 `<!--type=goal-->` 这种未清理的 HTML 注释。
 *
 * 用户裁定（逐字）：「可以先用这个机械的分类器来提供借鉴，但是**不能全量相信**，
 * 只能作为**加速器**。**具体事件的分类还是得 AI 来解决**。」
 *
 * ## 本模块的职责边界（严格遵守）
 *
 * ✅ **只做纯函数**：无 IO、无 LLM、无时间依赖（时间一律由入参传入）。
 * ✅ 机械分组**只产出「建议」**，永远带 `confidence`，且**永不写盘**。
 * ✅ 事件名质量闸门 —— 拒绝 HTML 注释 / markdown 标记 / 占位名。
 * ✅ 守恒校验 —— 成员数守恒、不重不漏。
 * ❌ 不做任何「决定」—— 最终分类权在 AI（R2/R3）。
 * ❌ 不读写磁盘（扫描在 R2）。
 */

/** 提案 schema 版本（落盘格式变更时必须 +1，R3 会校验）。 */
export const REGROUP_PROPOSAL_SCHEMA = 'v1_event_regroup_proposal'

/** 机械分组建议的置信度档（AI 可全盘推翻）。 */
export const SUGGEST_CONFIDENCE = Object.freeze({ HIGH: 'high', MEDIUM: 'medium', LOW: 'low' })

/**
 * 事件名质量闸门（用户裁定 Q9：4–60 字 + 五条判据）。
 *
 * ★为什么必须有：旧版事件名实测就是 `<!--type=goal-->验证四类感知...`，
 *   这种名字进注入面是**纯噪声**，而且会被 §2.1 那条「HTML 注释污染注入面」放大。
 *
 * @param {string} name 候选事件名
 * @returns {{ok:boolean, code?:string, message?:string, clean?:string}}
 */
export function validateEventNamePre(name) {
  const raw = String(name == null ? '' : name)
  const clean = raw.replace(/\s+/g, ' ').trim()
  if (!clean) return { ok: false, code: 'empty', message: '事件名不能为空' }
  // ① HTML 注释标记（旧版实测的垃圾来源）
  if (/<!--|-->/.test(clean)) {
    return { ok: false, code: 'html-comment', message: '事件名不得包含 HTML 注释标记（<!-- -->）' }
  }
  // ② markdown 结构标记开头（# - * > 等）
  if (/^[#>*+\-\s]/.test(clean)) {
    return { ok: false, code: 'markdown-prefix', message: '事件名不得以 markdown 标记开头' }
  }
  // ③ 长度 4–60（用户裁定；比现有 80 上限更严）
  if (clean.length < 4) return { ok: false, code: 'too-short', message: '事件名至少 4 字（当前 ' + clean.length + '）' }
  if (clean.length > 60) return { ok: false, code: 'too-long', message: '事件名不得超过 60 字（当前 ' + clean.length + '）' }
  // ④ 占位名
  const PLACEHOLDER = ['未命名', '未命名工作', 'untitled', '(未识别目标)', '未分类', 'TODO', 'todo']
  for (const p of PLACEHOLDER) {
    if (clean === p || clean.indexOf(p) === 0) {
      return { ok: false, code: 'placeholder', message: '事件名不得是占位名（' + p + '）' }
    }
  }
  // ⑤ 不得是纯标点/纯数字
  if (!/[\p{L}\p{Script=Han}]/u.test(clean)) {
    return { ok: false, code: 'no-letters', message: '事件名必须包含文字（不能是纯标点或纯数字）' }
  }
  return { ok: true, clean }
}

/**
 * 从账本正文**启发式**提取一个候选事件名（**仅供 AI 参考，永不直接采用**）。
 *
 * ★为什么不直接采用：旧版就是「取目标段首行」当名字，结果取到 HTML 注释。
 *   本函数会剥掉注释、markdown 标记、多余空白，并过质量闸门；
 *   仍不合格时返回宽松兜底（文件名去扩展名），且标记 `needsAiNaming: true`。
 *
 * @param {{name?:string, text?:string}} ledger
 * @returns {{name:string, needsAiNaming:boolean, reason:string}}
 */
export function suggestEventNamePre(ledger) {
  const l = ledger || {}
  const text = String(l.text || '')
  // 取「目标」段首行
  let line = ''
  const m = text.match(/^##\s*目标\s*\r?\n+([^\r\n]+)/m)
  if (m) line = m[1]
  if (!line) {
    // 兜底：第一个非空、非标题、非注释行
    for (const raw of text.split(/\r?\n/)) {
      const t = raw.trim()
      if (!t) continue
      if (t.indexOf('#') === 0) continue
      if (/^<!--/.test(t)) continue
      line = t
      break
    }
  }
  // 剥掉 HTML 注释、markdown 标记、引用符号
  let cleaned = String(line)
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/^[#>*+\-\s]+/, '')
    .replace(/\*\*/g, '')
    .replace(/\s+/g, ' ')
    .trim()
  // 截到第一个句号/分号，再夹 60 字
  const cut = cleaned.match(/^(.{4,60}?)[。；;，,]/)
  if (cut) cleaned = cut[1]
  if (cleaned.length > 60) cleaned = cleaned.slice(0, 60)

  const v = validateEventNamePre(cleaned)
  if (v.ok) return { name: v.clean, needsAiNaming: false, reason: 'from-goal-first-line' }

  // 不合格 ⇒ 用文件名兜底 + 明确要求 AI 重新命名
  const fname = String(l.name || '').replace(/^handoff-/, '').replace(/\.md$/, '').replace(/[-_]/g, ' ')
  return {
    name: fname || '(待 AI 命名)',
    needsAiNaming: true,
    reason: 'auto-name-rejected:' + (v.code || 'unknown'),
  }
}

/**
 * ★机械分组（**只作加速器建议**，用户裁定 Q1）。
 *
 * 判据（确定性、可复算，但**不构成决策**）：
 *   A. 目标段首行（清洗后）完全相同 ⇒ 同组建议
 *   B. 时间相近（传入的 mtime 差值 ≤ windowMs）且目标段有 ≥2 个共同 2-gram ⇒ 同组建议
 *
 * ★与旧版的**本质区别**：
 *   旧版把这个结果**直接当事件**写盘；
 *   本函数只返回 `suggestions`，每项带 `confidence` 与 `rationale`，
 *   AI（R2/R3）可**接受 / 拆开 / 合并 / 全部推翻**。
 *
 * @param {Array<{name:string,text:string,mtime:number}>} ledgers
 * @param {{windowMs?:number}} [opts]
 * @returns {{suggestions:Array, ungrouped:Array, method:string}}
 */
export function suggestGroupsPre(ledgers, opts = {}) {
  const list = Array.isArray(ledgers) ? ledgers.filter((x) => x && typeof x === 'object') : []
  const windowMs = Number(opts.windowMs) > 0 ? Number(opts.windowMs) : 6 * 3600 * 1000
  const groups = []
  const used = new Set()

  const goalKeyOf = (l) => {
    const text = String(l.text || '')
    const m = text.match(/^##\s*目标\s*\r?\n+([^\r\n]+)/m)
    const line = m ? m[1] : ''
    return String(line)
      .replace(/<!--[\s\S]*?-->/g, '')
      .replace(/^[#>*+\-\s]+/, '')
      .replace(/\*\*/g, '')
      .replace(/\s+/g, ' ')
      .trim()
  }
  const bigramsOf = (s) => {
    const out = new Set()
    const t = String(s || '').replace(/\s+/g, '')
    for (let i = 0; i + 1 < t.length; i++) out.add(t.slice(i, i + 2))
    return out
  }

  // A：目标段首行完全相同
  const byKey = new Map()
  for (let i = 0; i < list.length; i++) {
    const k = goalKeyOf(list[i])
    if (!k) continue
    if (!byKey.has(k)) byKey.set(k, [])
    byKey.get(k).push(i)
  }
  for (const [key, idxs] of byKey) {
    if (idxs.length < 2) continue
    idxs.forEach((i) => used.add(i))
    groups.push({
      members: idxs.map((i) => String(list[i].name || '')),
      suggestedName: key.length >= 4 && key.length <= 60 ? key : '',
      confidence: SUGGEST_CONFIDENCE.MEDIUM,
      rationale: '目标段首行完全相同（确定性判据，AI 可推翻）',
      method: 'A:goal-first-line',
    })
  }

  // B：时间窗 + 2-gram 重合（只处理未被 A 收编的）
  for (let i = 0; i < list.length; i++) {
    if (used.has(i)) continue
    const gi = goalKeyOf(list[i])
    if (!gi) continue
    const bi = bigramsOf(gi)
    const bucket = [i]
    for (let j = i + 1; j < list.length; j++) {
      if (used.has(j)) continue
      const gj = goalKeyOf(list[j])
      if (!gj) continue
      const dt = Math.abs((Number(list[i].mtime) || 0) - (Number(list[j].mtime) || 0))
      if (dt > windowMs) continue
      const bj = bigramsOf(gj)
      let common = 0
      for (const x of bi) if (bj.has(x)) common++
      if (common >= 2) bucket.push(j)
    }
    if (bucket.length >= 2) {
      bucket.forEach((x) => used.add(x))
      groups.push({
        members: bucket.map((x) => String(list[x].name || '')),
        suggestedName: '',
        confidence: SUGGEST_CONFIDENCE.LOW,
        rationale: '时间窗 ≤' + Math.round(windowMs / 3600000) + 'h 且目标段 ≥2 个共同 2-gram（弱判据，AI 应重点复核）',
        method: 'B:time+bigram',
      })
    }
  }

  const ungrouped = []
  for (let i = 0; i < list.length; i++) if (!used.has(i)) ungrouped.push(String(list[i].name || ''))

  return {
    suggestions: groups,
    ungrouped,
    method: 'deterministic-suggest-only',
  }
}

/**
 * 守恒校验：提案的成员必须与输入账本**一一对应**（不重、不漏、不多）。
 *
 * ★为什么必须校验：落盘前若成员集合与源账本不一致，
 *   会静默丢失账本（用户的核心资产）或重复归档。
 *
 * @param {string[]} allLedgerNames 全部待处理账本名
 * @param {Array<{members:string[]}>} groups 提案分组
 * @returns {{ok:boolean, duplicated:string[], missing:string[], unknown:string[]}}
 */
export function validateRegroupConservationPre(allLedgerNames, groups) {
  const all = Array.isArray(allLedgerNames) ? allLedgerNames.map(String) : []
  const allSet = new Set(all)
  const seen = new Map()
  for (const g of (Array.isArray(groups) ? groups : [])) {
    for (const m of ((g && Array.isArray(g.members)) ? g.members : [])) {
      const k = String(m)
      seen.set(k, (Number(seen.get(k)) || 0) + 1)
    }
  }
  const duplicated = []
  const unknown = []
  for (const [k, n] of seen) {
    if (n > 1) duplicated.push(k)
    if (!allSet.has(k)) unknown.push(k)
  }
  const missing = all.filter((x) => !seen.has(x))
  return {
    ok: duplicated.length === 0 && missing.length === 0 && unknown.length === 0,
    duplicated,
    missing,
    unknown,
  }
}

/**
 * 构造一份「事件重整提案」对象（R3 落盘用；本函数不写盘）。
 *
 * @param {{workspace?:string, events:Array, groups:Array, generatedAt?:number}} p
 * @returns {object}
 */
export function buildProposalPre(p = {}) {
  const o = p && typeof p === 'object' ? p : {}
  const events = Array.isArray(o.events) ? o.events : []
  const groups = Array.isArray(o.groups) ? o.groups : []
  const totalMembers = groups.reduce((a, g) => a + ((g && Array.isArray(g.members)) ? g.members.length : 0), 0)
  return {
    schema: REGROUP_PROPOSAL_SCHEMA,
    workspace: String(o.workspace || ''),
    generatedAt: Number(o.generatedAt) || 0,
    existingEvents: events.map((e) => ({ id: String((e && e.id) || ''), name: String((e && e.name) || ''), status: String((e && e.status) || '') })),
    proposedGroups: groups,
    stats: {
      existingEventCount: events.length,
      proposedGroupCount: groups.length,
      totalMembers,
    },
    // ★提案**永远不直接落盘**：必须先经人审 + 令牌（R6）
    requiresHumanApproval: true,
  }
}

export default {
  REGROUP_PROPOSAL_SCHEMA,
  SUGGEST_CONFIDENCE,
  validateEventNamePre,
  suggestEventNamePre,
  suggestGroupsPre,
  validateRegroupConservationPre,
  buildProposalPre,
}

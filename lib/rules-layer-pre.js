/**
 * 规则层抽取（rules_layer_pre_v1）—— P6A 的"分类"部分（Phase 6 拆分中的 6A）。
 *
 * 2026-09-14 建立（P0 第五步）。**它解决的是用户最痛的病之一**：
 *   注入开场白原来把所有记忆统一降格为「只是背景事实与规则参考」（`lib/index.js` 的
 *   `DEFAULT_PROMPT_LAYERS.snapshotHead`），**规则与资料混在一句措辞里** ⇒ 模型注意力不落在规矩上。
 *   用户原话：「这个 just for reference 说得太轻了，模型注意力没有在这上面。」
 *
 * **本模块只做一件事**：从记忆文本里**认出规则类条目**，把它们与参考类分开。
 * 措辞分层（不同引导语）与节奏（每轮在场）由调用方负责。
 *
 * **真源纪律（v2 修正，必须遵守）**：用户级规则＝**既有用户级记忆文件**（`~/.dsh/memory/MEMORY.md`）
 * 里的类型化规则，**不是新增 `RULES.md`**。`ROUND3 §2.3` 记录了我方曾在两处写了两个真源，
 * 被 GPT 抓出。若将来真要独立真源，必须补迁移/去重/旧模式读取/回滚四类测试。
 *
 * **两级判定**（T7-4 的"双保险"，v2 修正后的形态）：
 *   ① **结构化前缀**（高置信）：`【用户硬性规则…】` 这类显式标记 —— 这是既有记忆的真实形态
 *      （实测：`~/.dsh/memory/MEMORY.md` 首条即 `【用户硬性规则 - 文件编码】`）。
 *   ② **约束语汇**（中置信）：`严禁` / `绝不` / `必须` / `不得` 等。
 *
 *   ⚠️ **v2 明确纠正过我方原设计**：不能"命中关键词就无条件升级为规则"。
 *   反例（GPT 给）：`"文档写着必须重启"`、`"曾经要求必须 X 但已取消"` —— 这类是**描述**不是**要求**。
 *   故本模块对 ② 类的结果标注 `confidence:'medium'` 并**保留原文里的引用/历史语境标记**
 *   （`引文` / `已取消` / `据文档` 等），由调用方决定是否只作为「待确认候选」。
 *   本模块**不把中置信项冒充高置信**——那正是 T7-4 要防的误报。
 *
 * **依赖边界（如实标注，不宣称已保证）**：本模块保证的是"规则段被**注入函数**产出且不受节流与裁剪"。
 *   "模型**真的收到了**"取决于宿主最终请求 messages 的确认（`MASTER-PLAN-3.0.md §7` 的 **U6**，
 *   尚未具备）⇒ **不得**据此宣称"规则的遵守问题已解决"（T7-7 的纪律）。
 *
 * S9 合规：零 IO、纯函数、无网络/无 LLM/无子进程/无 await。UTF-8 无 BOM。
 *
 * **P9 更新（2026-09-22）**：规则段从此**认状态** —— superseded / retracted 的条目进 retired
 *   分项、**不再注入**（旧行为是规则段无视状态、过时条目每轮照发）。
 *   ★**本模块的「零 import」不变式保持不变**：状态解析用**等价内联**（statusOfEntryPre /
 *   stripStatusLinesPre，语法与 note-status-pre.js 一致），不引入模块依赖。
 *   理由：p6b 与 p6a 两条守卫都锁这条不变式，且 l0-extract-pre.js:6504-6508 有同样先例；
 *   等价性由守卫 tests/smoke/smoke-test-p9-rules-lifecycle-pre.mjs 逐例对照断言。
 */

export const RULES_LAYER_VERSION = 'rules_layer_pre_v1'

/**
 * ★P6B（2026-09-15 · 用户裁定开工）：日志行内 kind 标记 —— 规则分类的**持久化**落点。
 *
 * 权威依据：`TODO-GRAPH.html` V2-P6B 卡 points[1]（"分类时机：不做独立 LLM 调用，
 * memory_log_pre 本来就在本轮内由模型直接写，顺手打 kind 标记＝零额外成本"）+ crit[1]（T7-5）。
 *
 * **形态选行内标记** `- HH:MM [kind:rule] 内容`：日志是 append-only 纯文本，行内标记
 * 可被本模块的条目切分生态直接消费，且重启/迁移不丢（不依赖任何 sidecar）。
 * kind 作**可选参数**（缺省 fact）：不传时写入行与旧版逐字节一致（新旧并存 + 开关回退纪律）。
 */
export const LOG_KINDS_PRE_V1 = Object.freeze(['rule', 'preference', 'fact', 'todo'])

/** 行内标记的正则形态（渲染/解析两侧共用，不各写一套）。 */
export const LOG_KIND_TAG_RE_PRE_V1 = /\s*\[kind:(rule|preference|fact|todo)\]\s*/

/** 结构化前缀（高置信）：既有用户级记忆的真实形态。 */
export const RULE_MARKERS_PRE_V1 = Object.freeze([
  '【用户硬性规则', '【硬性规则', '【规则】', '【必须遵守', '【禁止', '【用户规则',
])

/** 约束语汇（中置信）—— 单靠它**不足以**判定为规则（见文件头 T7-4 说明）。 */
export const RULE_CONSTRAINT_WORDS_PRE_V1 = Object.freeze([
  '严禁', '绝不', '必须', '不得', '禁止', '务必', '一律', '永远不', '不要再', '不准',
])

/**
 * 引用/历史语境标记：出现这些 ⇒ 该段说的是"别处这么写"或"曾经如此"，
 * **不是**当前有效的规则要求 ⇒ 降级为 `candidate`（待确认候选），不得自动取得不可裁地位。
 * 这是 v2 §3.3（Q7 第 2 条）给的反例在代码里的落点。
 */
export const RULE_DESCRIPTION_MARKERS_PRE_V1 = Object.freeze([
  '据文档', '文档写着', '文档说', '曾经', '已取消', '已废弃', '不再要求', '原要求', '旧规则', '据说',
])

/** 条目切分锚点：与 `l0-extract-pre.js` 的记忆锚点完全一致（不另立一套）。 */
const MEM_ANCHOR_LINE_RE = /^<!--\s*memory:(mem_[0-9a-f]{32})\s*-->$/

/**
 * 条目内的日期小节 —— 既有记忆文件的实际结构。
 *
 * P9 修正：从「只认 ## + 纯日期」放宽到「任意级别 + 可带标题」——
 *   旧形态漏掉 `## 2026-09-22 · <标题>` / `### 2026-09-18 · <标题>` 这类带标题的日期小节。
 */
const DATE_SECTION_RE = /^#{1,6}\s*\d{4}-\d{2}-\d{2}\s*$/

/** ATX 标题行（任意级别）—— 小节标记，不是规则正文。 */
const ATX_HEADING_RE = /^#{1,6}\s+(\S.*)$/

/** 标题行的可读文本（剥 # 前缀）—— 正文缺失时的兜底，绝不留空条。 */
function headingTextPre(line) {
  const m = ATX_HEADING_RE.exec(clean(line))
  return m ? m[1].trim() : ''
}

const clean = (s) => String(s == null ? '' : s)

/**
 * 条目状态行语法（与 note-status-pre.js **完全一致**；刻意内联见文件头 P9 说明）。
 * 只认整行、只认三态；非法 memoryId / 未知属性一律丢弃（fail-soft）。
 */
const STATUS_LINE_RE_PRE_V1 = /^<!--\s*dsh-status:\s*(current|superseded|retracted)\s*((?:\w+=(?:"[^"]*"|[^\s"]+)\s*)*)-->$/
const STATUS_ATTR_RE_PRE_V1 = /(\w+)=(?:"([^"]*)"|([^\s"]+))/g
const MEM_ID_RE_PRE_V1 = /^mem_[0-9a-f]{32}$/
const STATUS_REASON_MAX_PRE_V1 = 120

/**
 * 从条目正文解析状态：**最后一个**状态行胜出（口径同 note-status-pre.js 的 statusOfBodyPre）。
 * 无状态行 ⇒ { status: current }。等价性由 tests/smoke/smoke-test-p9-rules-lifecycle-pre.mjs 逐例对照。
 * @param {string} body 条目正文（不含锚点行）
 * @returns {{status:string, supersededBy?:string, reason?:string}}
 */
export function statusOfEntryPre(body) {
  const lines = clean(body).split(/\r?\n/)
  for (let i = lines.length - 1; i >= 0; i--) {
    const m = STATUS_LINE_RE_PRE_V1.exec(lines[i].trim())
    if (!m) continue
    const out = { status: m[1] }
    STATUS_ATTR_RE_PRE_V1.lastIndex = 0
    let a
    while ((a = STATUS_ATTR_RE_PRE_V1.exec(m[2] || '')) !== null) {
      const k = a[1]
      const v = a[2] !== undefined ? a[2] : a[3]
      if (k === 'by') { if (MEM_ID_RE_PRE_V1.test(String(v || ''))) out.supersededBy = String(v) }
      else if (k === 'reason') {
        const r = String(v || '').replace(/[\r\n]+/g, ' ').trim().slice(0, STATUS_REASON_MAX_PRE_V1)
        if (r) out.reason = r
      }
    }
    return out
  }
  return { status: 'current' }
}

/**
 * 剥掉**整行**状态行，其余行逐字保留（口径同 note-status-pre.js 的 stripStatusLinePre）。
 * @param {string} body
 * @returns {string}
 */
export function stripStatusLinesPre(body) {
  const s = clean(body)
  if (!s.includes('<!-- dsh-status:')) return s
  return s.split(/\r?\n/).filter((ln) => STATUS_LINE_RE_PRE_V1.exec(ln.trim()) === null).join('\n')
}

/**
 * 把记忆文本按锚点切成条目（保持既有文件结构语义：无锚点的前置内容归入首条）。
 *
 * @param {string} text 用户级/工作区级记忆文件全文
 * @returns {Array<{id:string, anchorLine:number, text:string, lines:string[]}>}
 */
export function splitMemoryEntriesPre(text) {
  const src = clean(text).replace(/^\uFEFF/, '')
  if (!src.trim()) return []
  const lines = src.split('\n')
  const out = []
  let cur = null
  for (let i = 0; i < lines.length; i++) {
    const m = MEM_ANCHOR_LINE_RE.exec(lines[i].replace(/\r$/, ''))
    if (m) {
      if (cur) out.push(cur)
      cur = { id: m[1], anchorLine: i + 1, lines: [] }
      continue
    }
    if (cur) cur.lines.push(lines[i])
  }
  if (cur) out.push(cur)
  if (!out.length) {
    // 无锚点文件（旧格式）⇒ 整篇算一条，不丢内容
    return [{ id: '', anchorLine: 0, lines, text: src.trim() }]
  }
  return out.map((e) => ({ id: e.id, anchorLine: e.anchorLine, lines: e.lines, text: e.lines.join('\n').trim() }))
}

/** 单条文本的规则分类（返回置信度与理由，不抛异常）。 */
function classifyText(rawText) {
  const text = clean(rawText)
  if (!text.trim()) return { kind: 'reference', confidence: 'none', reasons: ['空内容'] }
  const marker = RULE_MARKERS_PRE_V1.find((k) => text.includes(k))
  if (marker) {
    return { kind: 'rule', confidence: 'high', reasons: ['结构化前缀 ' + marker] }
  }
  const words = RULE_CONSTRAINT_WORDS_PRE_V1.filter((w) => text.includes(w))
  if (!words.length) return { kind: 'reference', confidence: 'none', reasons: ['无规则标记与约束语汇'] }
  const desc = RULE_DESCRIPTION_MARKERS_PRE_V1.filter((w) => text.includes(w))
  if (desc.length) {
    // ★ v2 修正的落点：含"必须"但是**描述/引文**，不得自动升级为规则
    return {
      kind: 'candidate', confidence: 'low',
      reasons: ['约束语汇（' + words.slice(0, 3).join('/') + '）但含引用/历史语境（' + desc.slice(0, 3).join('/') + '）⇒ 仅作待确认候选，不自动取得规则地位'],
    }
  }
  return { kind: 'rule', confidence: 'medium', reasons: ['约束语汇 ' + words.slice(0, 3).join('/')] }
}

/**
 * 从记忆文本里抽出规则层（分项，供注入侧分层措辞与"不参与裁剪"）。
 *
 * @param {object} input
 * @param {string} [input.userText] 用户级记忆（跨工作区恒定；**规则真源**，见文件头）
 * @param {string} [input.notesText] 工作区级项目笔记（第二层）
 * @param {string} [input.rulesLayeringMode] 'off' | 'self' | 'none'
 *   - `'off'`：**默认**。返回空规则层（调用方回落旧行为：统一措辞 + 原有节奏）。这就是"新旧并存 + 开关回退"。
 *   - `'self'`：只看**当前 agent 自己写的** user 层（隔离子代理/外部导入的规则，防串线）。
 *   - `'none'`：不看任何 user 层（只保留工作区级）。
 * @param {string} [input.ownerSessionId] `rulesLayeringMode='self'` 时用于判定"是不是我自己写的"
 * @returns {{version:string, mode:string, enabled:boolean, text:string, rules:Array, candidates:Array,
 *            references:Array, counts:object, chars:{rules:number,candidates:number,total:number}}}
 */
export function extractRulesLayerPre(input = {}) {
  const o = input && typeof input === 'object' ? input : {}
  const mode = clampMode(o.rulesLayeringMode)
  const empty = {
    version: RULES_LAYER_VERSION, mode, enabled: false, text: '', rules: [], candidates: [], references: [], retired: [],
    counts: { entries: 0, rules: 0, candidates: 0, references: 0, retired: 0 }, chars: { rules: 0, candidates: 0, total: 0 },
  }
  if (mode === null) return empty

  const sources = []
  const pushAll = (layer, text) => {
    for (const e of splitMemoryEntriesPre(text)) sources.push({ layer, ...e })
  }
  // 模式语义（与文件头一致，别写反）：
  //   'self'  ⇒ 看用户级（跨工作区恒定）+ 工作区级
  //   'none'  ⇒ **不看任何用户级**，只看工作区级（用于"工作区规则覆盖用户规则"的场景）
  if (mode !== 'none') pushAll('user', o.userText)
  pushAll('project', o.notesText)

  const rules = []
  const candidates = []
  const references = []
  const retired = []
  for (const e of sources) {
    // ★P9：先读状态、再分类 —— 状态行是元数据不是正文（留着会被当规则语汇参与分类）
    const st = statusOfEntryPre(e.text)
    const content = stripStatusLinesPre(e.text)
    if (st.status !== 'current') {
      retired.push({
        layer: e.layer, id: e.id, anchorLine: e.anchorLine,
        status: st.status, supersededBy: st.supersededBy || '', reason: st.reason || '',
        text: content,
      })
      continue
    }
    const c = classifyText(content)
    const rec = { layer: e.layer, id: e.id, anchorLine: e.anchorLine, kind: c.kind, confidence: c.confidence, reasons: c.reasons, text: content }
    if (c.kind === 'rule') rules.push(rec)
    else if (c.kind === 'candidate') candidates.push(rec)
    else references.push(rec)
  }

  // 规则层文本：只含规则条目（高/中置信），逐条一行摘要，**不掺参考类**
  const rowsOut = rules.map((r) => '- ' + ruleSummaryPre(r.text)).filter((s) => s !== '- ')
  const text = rowsOut.join('\n')
  return {
    version: RULES_LAYER_VERSION, mode, enabled: true, text, rules, candidates, references, retired,
    counts: { entries: sources.length, rules: rules.length, candidates: candidates.length, references: references.length, retired: retired.length },
    chars: { rules: text.length, candidates: candidates.reduce((a, r) => a + ruleSummaryPre(r.text).length + 2, 0), total: text.length },
  }
}

/** 模式解析：`null` 表示"未启用"（调用方沿用旧行为）。 */
function clampMode(v) {
  const s = clean(v).trim().toLowerCase()
  if (!s || s === 'off' || s === 'false' || s === '0') return null
  if (s === 'self' || s === 'none' || s === 'all') return s
  return null // 非法值一律当"未启用"（fail-soft，不因配置写错而改变注入）
}

/** 取第一条非空行并裁剪（规则条目往往首行就是规则名，够用且省 token）。 */
export function firstLine(text, max = 200) {
  const lines = clean(text).split('\n').map((l) => l.trim()).filter(Boolean)
  const first = lines[0] || ''
  return first.length > max ? first.slice(0, Math.max(1, max - 1)) + '…' : first
}

/**
 * 规则条目的**摘要行**（渲染用）：跳过日期小节标题（`## 2026-08-14`）与纯标点行，
 * 取第一条实质内容。
 *
 * **为什么需要它**（实测踩坑）：既有记忆文件的条目结构是「锚点 → `## 日期` → 正文」，
 * 直接用 `firstLine` 会渲染成 `- ## 2026-08-14` —— 规则内容全丢，只剩日期，
 * 而且**看起来还挺正常**（这条断言首跑就红在"连续 6 轮规则都在"上，因为摘要里没有规则文本）。
 *
 * ★P6B：`[kind:x]` 行内标记在此**剥离**（标记只服务盘上审计与分类持久化，
 * 注入摘要保持干净）；时间戳 `HH:MM` 一并剥离（对规则语义是噪声）。
 */
export function ruleSummaryPre(text, max = 200) {
  const lines = clean(text).split('\n').map((l) => l.trim()).filter(Boolean)
  // ★P9（2026-09-22）：ATX 标题一律视为**小节标记**，优先渲染正文首行；
  //   正文缺失才回落到标题文本。旧行为把「## <日期> · <标题>」当正文渲染 ⇒
  //   规则段里进去的全是标题，规则本体一条都不在场（实测 54 条规则多数如此）。
  let headingFallback = ''
  for (const l of lines) {
    if (DATE_SECTION_RE.test(l)) continue
    if (ATX_HEADING_RE.test(l)) {
      if (!headingFallback) headingFallback = headingTextPre(l)
      continue
    }
    if (/^<!--/.test(l)) continue
    if (/^[-*+]\s*$/.test(l)) continue
    // 去掉列表前缀再返回，保持一条一行
    let body = l.replace(/^[-*+]\s+/, '')
    // ★P6B：剥行内 kind 标记与前置时间戳（只影响渲染，不回写盘上原文）
    body = body.replace(LOG_KIND_TAG_RE_PRE_V1, ' ').trim()
    body = body.replace(/^\d{1,2}:\d{2}\s+/, '').trim()
    if (!body) continue
    return body.length > max ? body.slice(0, Math.max(1, max - 1)) + '…' : body
  }
  return headingFallback.length > max ? headingFallback.slice(0, Math.max(1, max - 1)) + '…' : headingFallback
}

/**
 * 规则段渲染（**供注入侧直接使用**）：标题 + 引导语 + 逐条规则。
 *
 * 措辞分层的关键（T7-3）：**规则类用约束语**（"必须遵守"），**参考类保留"参考"语义**。
 * 两段引导语必须**不相同** —— 断言直接锁这一点，防止有人改回统一措辞。
 *
 * @param {object} rules `extractRulesLayerPre` 的返回值
 * @param {object} [opts]
 * @param {string} [opts.title] 段标题（默认常量）
 * @param {string} [opts.guide] 引导语（默认常量）
 * @returns {{text:string, chars:number, guide:string}}
 */
export function renderRulesSectionPre(rules, opts = {}) {
  const r = rules && typeof rules === 'object' ? rules : {}
  const list = Array.isArray(r.rules) ? r.rules : []
  if (!list.length) return { text: '', chars: 0, guide: '' }
  const title = clean((opts && opts.title) || RULES_SECTION_TITLE_PRE_V1)
  const guide = clean((opts && opts.guide) || RULES_SECTION_GUIDE_PRE_V1)
  // ★P9：空摘要**不渲染**（旧写法会产出裸 "- " 行；放宽小节标记后更易出现）
  const rows = list.map((x) => '- ' + ruleSummaryPre(x.text)).filter((r) => r !== '- ')
  if (!rows.length) return { text: '', chars: 0, guide: '' }
  const text = '\n' + title + '\n' + guide + '\n' + rows.join('\n')
  return { text, chars: text.length, guide }
}

/**
 * 规则段标题（T7-3：与参考段的措辞**必须不同**；断言直接比对两者）。
 * 用户可通过 `promptLayerOverrides.snapshotRulesTitle` 覆盖。
 */
export const RULES_SECTION_TITLE_PRE_V1 = '[规则 — 用户级硬性约束 · 必须遵守]'

/**
 * 规则段引导语：**约束语**（"以下为必须遵守的约束"），不是"只是参考"。
 * 这句话就是 P6A「措辞」要修的病：旧开场白把规矩与资料统一降格为「只是背景事实与规则参考」。
 */
export const RULES_SECTION_GUIDE_PRE_V1 = '以下条目是用户明确要求长期遵守的约束，不是可选背景。凡与其它内容冲突，以本节为准；无法满足时必须显式说明。'

/** 参考段引导语（保留"参考"语义，与规则段措辞不同）。 */
export const REFERENCE_SECTION_GUIDE_PRE_V1 = '以下为背景资料与历史记录，供参考与检索定位；与上面的规则冲突时不适用。'

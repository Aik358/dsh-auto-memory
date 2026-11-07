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
 *   stripStatusLinesPre，语法与 note-status.js 一致），不引入模块依赖。
 *   理由：p6b 与 p6a 两条守卫都锁这条不变式，且 l0-extract.js:6504-6508 有同样先例；
 *   等价性由守卫 tests/smoke/smoke-test-p9-rules-lifecycle-pre.mjs 逐例对照断言。
 */

export const RULES_LAYER_VERSION = 'rules_layer_pre_v1'

/**
 * ★P6B（2026-09-15 · 用户裁定开工）：日志行内 kind 标记 —— 规则分类的**持久化**落点。
 *
 * 权威依据：`TODO-GRAPH.html` V2-P6B 卡 points[1]（"分类时机：不做独立 LLM 调用，
 * memory_log 本来就在本轮内由模型直接写，顺手打 kind 标记＝零额外成本"）+ crit[1]（T7-5）。
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

/** 条目切分锚点：与 `l0-extract.js` 的记忆锚点完全一致（不另立一套）。 */
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
 * 条目状态行语法（与 note-status.js **完全一致**；刻意内联见文件头 P9 说明）。
 * 只认整行、只认三态；非法 memoryId / 未知属性一律丢弃（fail-soft）。
 */
const STATUS_LINE_RE_PRE_V1 = /^<!--\s*dsh-status:\s*(current|superseded|retracted)\s*((?:\w+=(?:"[^"]*"|[^\s"]+)\s*)*)-->$/
const STATUS_ATTR_RE_PRE_V1 = /(\w+)=(?:"([^"]*)"|([^\s"]+))/g
const MEM_ID_RE_PRE_V1 = /^mem_[0-9a-f]{32}$/
const STATUS_REASON_MAX_PRE_V1 = 120

/**
 * 从条目正文解析状态：**最后一个**状态行胜出（口径同 note-status.js 的 statusOfBodyPre）。
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
 * 剥掉**整行**状态行，其余行逐字保留（口径同 note-status.js 的 stripStatusLinePre）。
 * @param {string} body
 * @returns {string}
 */
export function stripStatusLinesPre(body) {
  const s = clean(body)
  if (!s.includes('<!-- dsh-status:')) return s
  return s.split(/\r?\n/).filter((ln) => STATUS_LINE_RE_PRE_V1.exec(ln.trim()) === null).join('\n')
}

/**
 * 把记忆文本按锚点切成条目。
 *
 * ★★真实切分语义（2026-10-25 修正 —— **本条注释此前在说谎**，改注释不改实现）：
 *   · **有锚点时**：按锚点切；**首个锚点之前的内容会被丢弃**（实现里 `cur` 还是 null，没有兜底 push）。
 *   · **无锚点时**：整篇算一条（`id` 为空串）。
 *
 *   旧注释写的是「无锚点的前置内容归入首条」—— 那是**错**的（只在整篇无锚点时才成立）。
 *   该错误由 H3-C1 兼容层验收实测发现（fixture「前置内容 + 锚点 + 条目」⇒ 前置内容消失）。
 *
 *   ★为什么只修注释、不改实现：
 *     ① **影响面实测为 0** —— 本机两份真实 MEMORY.md 的「锚点前行数」分别是 29 / 18，
 *        其中**非空行都是 0**（全是空行）⇒ 存量数据没有丢失；
 *     ② 改实现会改变 74（用户级）+ 24（项目级）条真实条目的切分方式，风险远大于收益；
 *     ③ 若将来真要支持「锚点前内容」，那是**新需求**，需单独评估并补全量回归。
 *   ★这条语义现在有断言钉住（smoke-test-v4-h3-c1-c2-legacy 的 C1-7），防止有人「顺手修」时静默改变切分。
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
 * ★★P2b-S1（2026-11-07 · CONSTRUCTION-PROMPT-LAYERING §S1）：**条目内 bullet 条目化**。
 *
 * 【治的病】一个 entry 里往往塞了 N 条约束（`- a` / `- b` / `- c`），而渲染只取「首条实质行」⇒
 *   实测 user 层 93 条 bullet 只有 49 条进注入、project 层 122 条只有 17 条进注入（160 条 / 74.4%
 *   **从未出现在注入面**）。硬约束静默丢失比「注入太多」危险得多（用户 2026-11-07 裁定：全投，不分层）。
 *
 * 【形态】把每个 entry 的正文按 `^-\s+` 拆成独立子条目，id = `<父id>#<n>`（n 从 1 起）；
 *   layer / anchorLine 继承父条目，父 id 另记 parentId（审计用，不参与渲染）。
 *
 * 【kind 语义（本批唯一的语义取舍，必须在此写明）】
 *   命中祈使判据（RULE_ITEM_IMPERATIVE_RE）⇒ `kind:'rule'`（硬约束，原样渲染）；
 *   其余 ⇒ `kind:'note'`（说明 / 归因 / 反例），渲染时加中性前缀「（说明）」——
 *   **保留信息但不冒充硬约束**。不丢弃 note（用户裁定：全投，宁可多给也不静默丢）。
 *
 * 【向后兼容（硬约束）】bullet 数 < 2 的 entry **不拆**（原样一条，kind 仍为 'rule'）⇒
 *   单 bullet / 无 bullet 条目的渲染结果与改前**逐字相同**，不引入新行。
 *   既有套件（p6a / p6b / p9 / h3-b）的夹具都是单 bullet 或纯段落 ⇒ 计数与文本不变。
 */
const RULE_ITEM_BULLET_RE = /^-\s+/

/** 说明类子条目的中性前缀（不冒充硬约束，也不丢内容）。 */
export const RULE_NOTE_PREFIX_PRE_V1 = '（说明）'

/**
 * 祈使判据：命中即判为硬约束。
 * ★刻意**不含**「建议」「最好」这类缓和词，避免把偏好描述升级成硬约束。
 */
const RULE_ITEM_IMPERATIVE_RE = /禁止|必须|不得|一律|须|不要|改成|要求|只能|应当|不允许/

/**
 * 把一个 entry 的正文拆成子条目（纯函数、零 IO）。
 * @param {string} content 已剥状态行的条目正文
 * @returns {Array<{n:number, id:string, kind:string, text:string}>} 不拆时返回单元素（id=''）
 */
export function splitRuleItemsPre(content) {
  const text = clean(content)
  const lines = text.split(/\r?\n/)
  const bulletLines = lines.filter((l) => RULE_ITEM_BULLET_RE.test(l))
  // ★向后兼容：< 2 个 bullet ⇒ 原样一条（渲染与改前逐字一致）
  if (bulletLines.length < 2) return [{ n: 0, id: '', kind: 'rule', text: text }]
  const out = []
  // ★★粒度口径（与施工文档 S1 的验收数一致：user 49→93 / project 17→122）：
  //   **一个 bullet 恰好一条**。bullet 前的纯前言行（标题/归因/说明段）并入紧随的那条 bullet，
  //   不单独成条 —— 否则条目数会比「约束句总数」多出来，验收数就对不上。
  //   末尾残留（最后一个 bullet 之后的非 bullet 行）同样并入最后一条。
  let pre = ''   // 尚未归属的 bullet 前段落
  const push = (body) => {
    const head = String(pre || "").trim()
    pre = ''
    const t = head ? (head + "\n" + body) : body
    out.push({
      n: out.length + 1,
      id: String(out.length + 1),
      kind: RULE_ITEM_IMPERATIVE_RE.test(t) ? 'rule' : 'note',
      text: t,
    })
  }
  for (const raw of lines) {
    const l = String(raw == null ? '' : raw)
    if (RULE_ITEM_BULLET_RE.test(l)) {
      push(l.replace(RULE_ITEM_BULLET_RE, '').trim())
      continue
    }
    if (!l.trim()) continue
    // 小节标记 / 注释行 ⇒ 跳过（不是正文，不该混进任何一条）
    if (/^#{1,6}\s/.test(l) || /^<!--/.test(l)) continue
    pre = pre ? (pre + '\n' + l) : l
  }
  if (String(pre || '').trim() && out.length) {
    const last = out[out.length - 1]
    last.text = last.text + '\n' + String(pre).trim()
    last.kind = RULE_ITEM_IMPERATIVE_RE.test(last.text) ? 'rule' : 'note'
  } else if (String(pre || '').trim()) {
    out.push({ n: 1, id: '1', kind: 'rule', text: String(pre).trim() })
  }
  return out.length ? out : [{ n: 0, id: '', kind: 'rule', text: text }]
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
    if (c.kind === 'rule') {
      // ★★P2b-S1（2026-11-07）：条目内 bullet 逐条投递 —— 一个 entry 里塞 N 条约束时，
      //   旧行为只渲染首条实质行 ⇒ 实测 160/215 条约束句（74.4%）从未进过注入面。
      //   拆成子条目后每条独立成行；kind 区分硬约束（rule）与说明（note，渲染加「（说明）」前缀）。
      //   ⚠️ 不丢 note：用户 2026-11-07 裁定「全投、不分层」，静默丢信息比多投危险。
      const _items = splitRuleItemsPre(content)
      if (_items.length <= 1 && _items[0] && _items[0].id === '') {
        // 未拆（<2 bullet）⇒ 与改前逐字同一条记录
        rules.push(rec)
      } else {
        for (const _it of _items) {
          rules.push({
            layer: e.layer,
            id: e.id + '#' + _it.n,
            parentId: e.id,
            // ★★P2b-S1 兼容（2026-11-07）：**保留父条目原文**。
            //   下游有一个「已在规约层的偏好不再进画像」的去重（user-portrait excludeIfInRules），
            //   它用**双向子串包含**判重。若把子条目文本喂进去，子串变短 ⇒
            //   「画像条目包含某条子串」命中率飙升 ⇒ 画像被整段误杀（实测 human_slim 帧 portrait 由有变无）。
            //   ⇒ 去重必须仍按**条目级原文**比，粒度不随本批拆分变化（画像段本批不动）。
            parentText: content,
            anchorLine: e.anchorLine,
            kind: _it.kind,
            confidence: c.confidence,
            reasons: c.reasons,
            itemKind: _it.kind,
            itemIndex: _it.n,
            text: _it.text,
          })
        }
      }
    }
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

/** 行尾截断指针（S2：真截断时告知全文入口，不只加省略号）。 */
export const RULE_TRUNC_POINTER_PRE_V1 = '（全文 memory_rules op=list）'

/** 句末标点（S2：截断优先落在句末，保住语义边界）。 */
const SENTENCE_END_RE = /[。；！]/

/**
 * ★★P2b-S2（2026-11-07 · CONSTRUCTION-PROMPT-LAYERING §S2）：**保义截断**。
 *
 * 【治的病】旧写法 `body.slice(0, max - 1) + '…'` 是**定长硬切**：实测 run 档 66 行里 49 行
 *   （74.2%）以「…」结尾，且切点常落在词中间（「不得只跑受影响的那几个套…」）⇒ 读者拿不到完整约束，
 *   也不知道去哪取全文。
 *
 * 【新口径】三条一起生效：
 *   ① 不超长 ⇒ 原样返回（逐字不变，不动既有字节断言）；
 *   ② 超长 ⇒ 截到不超过 max 的**最后一个句末标点**（。；！）之后 —— 保住语义边界；
 *   ③ 仍被截断 ⇒ 行尾追加 `（全文 memory_rules op=list）` 指针，让模型能自查全文。
 *   ★②若 max 内一个句末标点都没有，才退回定长切（并同样带指针）—— 不为了标点而放出超长行。
 *
 * @param {string} body 已清洗的正文行
 * @param {number} max 单行字符上限
 * @returns {string}
 */
export function truncateRuleLinePre(body, max) {
  const s = clean(body).replace(/\s+/g, ' ').trim()
  const lim = Math.max(1, Math.floor(Number(max) || 0))
  if (s.length <= lim) return s
  const head = s.slice(0, lim)
  let cut = -1
  for (let i = head.length - 1; i >= 0; i--) { if (SENTENCE_END_RE.test(head.charAt(i))) { cut = i; break } }
  const kept = cut >= 0 ? head.slice(0, cut + 1) : head
  return kept + RULE_TRUNC_POINTER_PRE_V1
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
    return truncateRuleLinePre(body, max)
  }
  return truncateRuleLinePre(headingFallback, max)
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
  const EMPTY = { text: '', chars: 0, guide: '', groups: { user: 0, project: 0 }, warn: null }
  if (!list.length) return EMPTY
  const title = clean((opts && opts.title) || RULES_SECTION_TITLE_PRE_V1)
  const guide = clean((opts && opts.guide) || RULES_SECTION_GUIDE_PRE_V1)
  // ★P9：空摘要**不渲染**（旧写法会产出裸 "- " 行；放宽小节标记后更易出现）
  // ★★P2b-S1（2026-11-07）：说明类子条目加中性前缀「（说明）」—— 保留信息但不冒充硬约束。
  //   判据取 `kind === 'note'`（S1 拆分时按祈使判据打的标）；未拆分的旧条目 kind 仍为 'rule' ⇒ 无前缀。
  const rowsOf = (arr) => arr.map((x) => '- ' + (String((x && x.kind) || '') === 'note' ? RULE_NOTE_PREFIX_PRE_V1 : '') + ruleSummaryPre(x && x.text)).filter((s) => s !== '- ' && s !== '- ' + RULE_NOTE_PREFIX_PRE_V1)
  // ══════════════════════════════════════════════════════════════════════
  // ★★v4-H3-B（2026-10-25 用户裁定 A）：**按 layer 分两小节** —— 用户规约 / 项目规约。
  //
  //   用户裁定原文：「规约为什么要并入画像啊？…用户规约…是比较『硬』的东西，应该是比较 rational 的。
  //   **这两者不该在一起**」⇒ 三类分立：用户画像(emotional) / 用户规约(rational,跨项目) / 项目规约(rational,本项目)。
  //
  //   ★向后兼容（关键）：`opts.groupByLayer` 未显式传 true 时，**保持旧的单节行为逐字节不变**
  //     （旧套件 p6a 有 123 条断言直接比对标点与顺序，不能动）。分组是**新增能力**，不是替换。
  // ══════════════════════════════════════════════════════════════════════
  if (opts && opts.groupByLayer === true) {
    const userArr = list.filter((x) => String((x && x.layer) || '') === 'user')
    const projArr = list.filter((x) => String((x && x.layer) || '') !== 'user')
    const parts = []
    const warn = []
    let userChars = 0
    let projChars = 0
    // ★★2026-10-26（用户裁定「预算线稍微放大一点，做成可审计、可压缩、可灵活调整的形式」）：
    //   · 可灵活调整 ⇒ 预算值从写死常量改为**调用方可传**（opts.userWarnChars / opts.projectWarnChars），
    //     未传则回出厂常量 ⇒ 旧调用点（含 p6a 那 123 条逐字节断言）行为完全不变。
    //   · fail-soft：非正数/非有限一律回出厂值 —— 配置写错绝不能把预算线关掉（那等于永不报警）。
    const _budgetOf = (v, fallback) => {
      const nb = Number(v)
      return Number.isFinite(nb) && nb > 0 ? Math.floor(nb) : fallback
    }
    const userBudget = _budgetOf(opts && opts.userWarnChars, RULES_BUDGET_FALLBACK_PRE_V1.user)
    const projBudget = _budgetOf(opts && opts.projectWarnChars, RULES_BUDGET_FALLBACK_PRE_V1.project)
    // ★可审计口径：把「超了多少 / 占比多少」都算出来写进提示，会话里可直接复算。
    const _audit = (chars, budget) => {
      const pct = budget > 0 ? Math.round((chars / budget) * 1000) / 10 : 0
      return { chars, budget, over: chars - budget, pct }
    }
    let userAudit = null
    let projAudit = null
    if (userArr.length) {
      const ur = rowsOf(userArr)
      if (ur.length) {
        userChars = ur.join('\n').length
        parts.push('\n[用户规约 — 跨项目通用 · 必须遵守]\n' + ur.join('\n'))
        if (userChars > userBudget) {
          userAudit = _audit(userChars, userBudget)
          warn.push('[用户规约超预算线] 当前 ' + userAudit.chars + ' 字符 / 预算 ' + userAudit.budget
            + ' 字符（占 ' + userAudit.pct + '%，超 ' + userAudit.over + '）。'
            + '注意：**超预算不会截断**（全文照常注入），但请用 memory_rules 整理：合并重复项、删除过时项。'
            + '整理完自动恢复无提示。预算线可用配置项 userRulesWarnChars 调整。')
        }
      }
    }
    if (projArr.length) {
      const pr = rowsOf(projArr)
      if (pr.length) {
        projChars = pr.join('\n').length
        parts.push('\n[项目规约 — 本项目必守]\n' + pr.join('\n'))
        if (projChars > projBudget) {
          projAudit = _audit(projChars, projBudget)
          warn.push('[项目规约超预算线] 当前 ' + projAudit.chars + ' 字符 / 预算 ' + projAudit.budget
            + ' 字符（占 ' + projAudit.pct + '%，超 ' + projAudit.over + '）。'
            + '注意：**超预算不会截断**（全文照常注入），但请用 memory_rules 整理：合并重复项、删除过时项、把「流水」迁到事件（memory_event）。'
            + '整理完自动恢复无提示。预算线可用配置项 projectRulesWarnChars 调整。')
        }
      }
    }
    if (!parts.length) return EMPTY
    // ★警告放**最前面**（模型先看到异常，再读内容），且**全量内容一个字不砍**
    const warnText = warn.length ? ('\n' + warn.join('\n')) : ''
    // ★★2026-10-26（用户裁定「用户画像确实应该是 emotional 情境化的，这个需要在 prompt 里面说清楚」）：
    //   把「三层语义分工」**真的写进注入文本**（此前只写在代码注释里，模型看不到）。
    //   ⚠️ 只在 groupByLayer 分支拼（本分支是 v4 分组渲染），旧单节路径逐字节不变 ⇒ p6a 那 123 条不受影响。
    const semanticText = THREE_LAYER_SEMANTICS_GUIDE_PRE_V1
      ? ('\n' + THREE_LAYER_SEMANTICS_GUIDE_PRE_V1)
      : ''
    const text = warnText + semanticText + parts.join('\n')
    return { text, chars: text.length, guide, groups: { user: userChars, project: projChars }, warn: warn.length ? warn.join(' ') : null }
  }
  const rows = rowsOf(list)
  if (!rows.length) return EMPTY
  const text = '\n' + title + '\n' + guide + '\n' + rows.join('\n')
  return { text, chars: text.length, guide, groups: { user: 0, project: 0 }, warn: null }
}

/**
 * 规则段标题（T7-3：与参考段的措辞**必须不同**；断言直接比对两者）。
 * 用户可通过 `promptLayerOverrides.snapshotRulesTitle` 覆盖。
 */
// ★★v4-H3-B（2026-10-25 用户裁定 B）：**注入面上限**（模块级常量，**不新增配置键** —— 配置键数锁 163）。
//
//   用户裁定原文（否决「只增不减」）：「只增不减是不是有点不太对啊？应该是可以增减、可以修改的，
//     不然以后每次都注入的话，是不是量有点太多了？」
//
//   ★★这两个数字是**警戒线**，不是**截断线**（Lead 2026-10-25 明确裁决）：
//     · ≤ 上限 ⇒ 正常注入，无提示；
//     · > 上限 ⇒ **全量注入**（一个字都不砍）+ 注入强提示要求整理。
//     **为什么不能截断**：静默截断 = 那条规约看似存在实则不生效，比超限危险得多。
//     用户要的是「量可控」，可控手段是「提示去整理」，不是「砍掉」。
//
//   ★与 `noteCapacityChars`(24,000) 的区别 —— **那是文件本体上限，这是注入面上限**：
//     文件可以大（流水多），但注入要小（只看核心）。自动压缩管前者，本预算管后者。
//
// ★★P2b-S6（2026-11-07 · CONSTRUCTION-PROMPT-LAYERING §S6）：**预算单真源**。
//   【治的病】旧实现有两个数字源：本模块的 1500 / 4000 与 config 的 4000 / 6000。
//     生产调用点（index.js:11393-11394）一直传 config 值 ⇒ 本模块的 1500 **生产不可达**，
//     却仍作为「出厂值」被测试与文档引用 ⇒ 两本账（改一处漏一处是本仓最常见半修）。
//   【修法】删掉 `USER_RULES_WARN_CHARS_PRE_V1=1500` / `PROJECT_...=4000` 两个导出常量，
//     只保留**一处**兜底表（数值与 `DEFAULT_CONFIG` 对齐：user 4000 / project 6000）。
//     调用方传了就按调用方（config）值；没传（旧套件 / 直接调用）才回落到这张表 ——
//     即「预算的唯一真源是 config，本表只是 fail-soft 兜底」。
//   ⚠️ 兜底**不能省**：省掉就等于「配置写错/未传 ⇒ 永不报警」，那是把预算线关掉。
export const RULES_BUDGET_FALLBACK_PRE_V1 = Object.freeze({ user: 4000, project: 6000 })

export const RULES_SECTION_TITLE_PRE_V1 = '[规则 — 用户级硬性约束 · 必须遵守]'

/**
 * 规则段引导语：**约束语**（"以下为必须遵守的约束"），不是"只是参考"。
 * 这句话就是 P6A「措辞」要修的病：旧开场白把规矩与资料统一降格为「只是背景事实与规则参考」。
 */
export const RULES_SECTION_GUIDE_PRE_V1 = '以下条目是用户明确要求长期遵守的约束，不是可选背景。凡与其它内容冲突，以本节为准；无法满足时必须显式说明。'

/**
 * ★★2026-10-26（用户裁定，逐字）：「用户画像确实应该是 emotional 情境化的，这个需要在 prompt 里面说清楚。」
 *
 * 三层语义分工 —— **必须出现在注入 prompt 里**，不能只写在代码注释里（此前正是只写在注释里）。
 *
 *   ① [用户规约 — 跨项目通用] / [项目规约 — 本项目必守] = **rational（硬约束）**
 *      答「我必须遵守什么」。来源=用户级 MEMORY.md 与项目笔记的约定条目；每次完整版都注入、不可裁剪。
 *      写法：祈使句、可判定、去情绪；一条一个约束。增删改用 memory_rules / memory_note。
 *  ② [用户画像 — 这是谁] = **emotional（对人的印象）**
 *      答「这个人什么样、在意什么、正处在什么情境」。来源=被采纳的 userPercept；是摘要、可裁剪。
 *      写法：具体、情境化、可带情绪色彩。**不得复述规约里的硬约束**——已在规约层的条目，画像侧会被自动过滤（去重），
 *      因为把硬规则当「印象」再注入一遍会双耗预算，且长期让模型把画像误当规约。
 *  ③ [当前事件] / [事件卡片] = **情境（正在做什么）** 答「这件事到哪了」。来源=事件库。
 *
 * ⇒ 归位规则：硬性要求写进规约（memory_rules / memory_note）；对人的观察写 userPercept（会进画像）；工作进展写事件检查点。
 * ⇒ 三者关系：**规约管「必须怎样」、画像管「他是谁」、事件管「正在做什么」。**
 *
 * ★为什么是独立常量而不是并进 GUIDE：GUIDE 被 p6a 等套件按字节比对（123 条断言），改它会大面积假红；
 *   本常量由渲染侧**单独拼接**，既有字节断言不受影响，且可被新套件直接抽取验证。
 */
export const THREE_LAYER_SEMANTICS_GUIDE_PRE_V1 = [
  '【三层语义分工 · 必须分清】',
  '① 规约（用户规约/项目规约）= rational 硬约束：答「我必须遵守什么」。祈使句、可判定、去情绪；每次完整版必注入、不可裁剪。增删改用 memory_rules / memory_note。',
  '② 用户画像 = emotional 印象：答「这个人什么样、在意什么、正处在什么情境」。具体、情境化、可带情绪色彩；是摘要、可裁剪。',
  '   ★画像**不得复述规约里的硬约束**——已在规约层的条目会被自动过滤（去重）：把硬规则当印象再注入一遍会双耗预算，且会让模型把画像误当规约。',
  '③ 当前事件/事件卡片 = 情境：答「这件事到哪了」。来源=事件库。',
  '⇒ 归位：硬性要求→规约；对人的观察→userPercept（进画像）；工作进展→事件检查点。规约管「必须怎样」、画像管「他是谁」、事件管「正在做什么」。',
].join('\n')

/** 参考段引导语（保留"参考"语义，与规则段措辞不同）。 */
export const REFERENCE_SECTION_GUIDE_PRE_V1 = '以下为背景资料与历史记录，供参考与检索定位；与上面的规则冲突时不适用。'

/**
 * ★★v4-H3-C2（2026-10-25 用户裁定 C）：**旧格式检测** —— 决定注入里要不要出「插件已升级」提醒。
 *
 * 用户原话（裁定 C 第①②步）：「**先做兼容，先不要让插件爆炸**，然后**记得提醒 AI**」。
 *
 * ## 为什么需要它
 * 本插件的记忆文件格式在 v4 里变了（事件中心 / 条目带锚点 / 带 status 行）。
 * **旧格式不会崩**（读路径一直兼容，见 splitMemoryEntriesPre），但旧文件：
 *   · 没有 `memory:mem_` 锚点 ⇒ 无法做条目级增删改（H3-B 的编辑能力用不上）
 *   · 没有 status 行 ⇒ 过时条目无法被标记退役，每轮照发
 *   · 混着大量「流水」条目 ⇒ 注入面被日志挤满（INJECTION-PLAN §1.6 实测 80% 流水）
 * ⇒ 需要主动提醒 AI「可以引导用户做一次整理」。
 *
 * ## 判据（★#520 P0 修正，2026-11-03）
 *   **`legacy = !anchors`** —— 只有「无锚点」才是旧格式的结构判据。
 *   其余三项只进 reasons（advisory），不决定 legacy：
 *   ② 无 status 行 —— **降级为 advisory**。理由（VERIFY-520 §1 实测）：
 *      status 行只由 `memory-writer.js` 的 appendAnchoredRecord 为**新追加记录**写入，
 *      全库**没有给存量已锚定条目回填 status 的路径**（applyMigrationPlan 只插锚点；
 *      memory_user replace 走 renderReplace 反而丢 status），
 *      且**升级/迁移流程不写 MEMORY.md**（v7 提示词只写事件库 + 白板）。
 *      ⇒ 旧实现 `!anchors || !statuses` 会让「有锚点 + 0 status」的库（#520 报告人形态）
 *        在整理成功后 legacy 仍为 true ⇒ 弹窗不退 = 死循环。status 缺失不是格式新旧判据。
 *   ③ 单条 > 200 字（疑似流水：一条里塞了整段工作记录）
 *   ④ 事件库为空但日志很多（该工作区从没建过事件，却累积了大量日志）
 *
 * ★为什么只有 ① 决定 legacy：①② 曾是「结构缺失」两条，但 ② 的缺失是**写入路径的历史形态**
 *   （存量条目天然无 status），不是可迁移的格式缺陷；把它当硬判据等于让迁移永远无法收敛。
 *   ③④ 只影响 reasons 的取舍不变。
 *
 * ★`eventized`（events > 0，★本次新增）：单独透出「是否已事件化」，
 *   供前端/引擎把「待迁移提示」与「尚未事件化提示」分开——两者不再是同一件事。
 *   保留 `no-events` 作为**补充理由**（有日志但 0 事件时才给）。
 *
 * @param {{userText?:string, notesText?:string, eventStore?:object|string, logCount?:number}} input
 * @returns {{legacy:boolean, reasons:string[], counts:{userEntries:number, projectEntries:number, anchors:number, statuses:number, events:number, logs:number}}}
 */
export function detectLegacyFormatPre(input = {}) {
  const o = input && typeof input === 'object' ? input : {}
  const userText = clean(o.userText)
  const notesText = clean(o.notesText)
  // 事件数：接受三种形态（★v5-P5 2026-10-26 修：第三种是本仓实际在用的，之前漏了）
  //   ① 纯数字（调用方已数好）
  //   ② 包装对象 { events: [] }
  //   ③ **裸数组 [{...}]** —— 实际调用点（index.js L9162 / L23830）传的就是这个形态
  //
  //   ★★为什么必须补第③种（真缺陷，不是兼容性美化）：
  //     旧实现只判 `typeof === "object"` 然后读 `o.eventStore.events`。
  //     **数组也是 object** ⇒ 走进去读 `arr.events` ⇒ undefined ⇒ 恒判 0。
  //     实测后果：upgrade-status 对「有 2 个事件」的工作区报 `no-events：事件库为空`，
  //     且 counts.events=0 与真实 events=2 自相矛盾（用户实报的现象）。
  //     注入侧更严重：`state.memLegacy` 恒带 no-events ⇒ 每轮都提醒「尚未事件化」，
  //     哪怕事件库早已建好。
  //
  //   ★为什么不改调用点而是改这里：
  //     调用点有 3 处、其中 2 处传裸数组；改函数是单点根治，
  //     且「裸数组」是更自然的调用写法（调用方手里本来就只有 events 数组）。
  let events = 0
  if (typeof o.eventStore === 'number') events = Math.max(0, Math.floor(o.eventStore))
  else if (Array.isArray(o.eventStore)) events = o.eventStore.length
  else if (o.eventStore && typeof o.eventStore === 'object') {
    const arr = Array.isArray(o.eventStore.events) ? o.eventStore.events : []
    events = arr.length
  }
  const logs = Math.max(0, Math.floor(Number(o.logCount) || 0))
  // ★#520 P0（2026-11-03）：「已事件化」判据单独透出（events > 0），
  //   供「是否待迁移」与「尚未事件化」两类提示分家；不参与 legacy 判定。
  const eventized = events > 0

  const all = userText + '\n' + notesText
  const anchors = (all.match(/<!--\s*memory:mem_[0-9a-f]{32}\s*-->/g) || []).length
  const statuses = (all.match(/<!--\s*dsh-status:\s*(?:current|superseded|retracted)\b/g) || []).length
  const userEntries = splitMemoryEntriesPre(userText).length
  const projectEntries = splitMemoryEntriesPre(notesText).length
  // 单条超长（疑似流水）：用与渲染同源的条目切分，避免另立一套口径
  const longEntries = splitMemoryEntriesPre(all).filter((e) => clean(e.text).length > 200).length

  const reasons = []
  const hasContent = !!(userText.trim() || notesText.trim())
  if (!hasContent) {
    return { legacy: false, reasons: [], eventized, counts: { userEntries: 0, projectEntries: 0, anchors: 0, statuses: 0, events, logs } }
  }
  // ★① 无锚点 = 唯一决定 legacy 的结构判据（#520 P0：statuses 不再参与判定）
  if (!anchors) reasons.push('no-anchors：文件里没有任何 memory:mem_ 锚点，条目级增删改不可用')
  // ② status 缺失 ⇒ advisory：只是「退役标记不可用」，不是旧格式判据（见函数头 §判据）
  if (!statuses) reasons.push('no-status：退役标记不可用（advisory：status 行只随新记录追加产生，迁移不回填，故不判定 legacy）')
  const structuralLegacy = !anchors
  // ③④ 只作补充理由，不单独判 legacy
  if (longEntries > 0) reasons.push('long-entries：' + longEntries + ' 条超 200 字，疑似流水未拆分')
  if (!eventized && logs > 0) reasons.push('no-events：事件库为空但已有 ' + logs + ' 篇日志，尚未事件化')

  return {
    legacy: structuralLegacy,
    reasons,
    eventized,
    counts: { userEntries, projectEntries, anchors, statuses, events, logs },
  }
}

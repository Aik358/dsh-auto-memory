/**
 * L0 抽取纯核心（l0_extract_pre_v1）—— 分层语义唤回的地基。
 *
 * 2026-09-08 建立。目的：为每条记忆生成廉价摘要（L0），使检索可先在小空间
 * 收敛候选，再按 id 下钻原文，从而把 token 开销与索引构建成本降约一个数量级
 * （实测：条目平均 814 字符 → L0 约 118 字符，压缩比 6.9:1）。
 *
 * 组成：
 *   1) parseMemoryItemsPre —— 按 `<!-- memory:mem_<32hex> -->` 锚点切分记忆条目
 *   2) extractL0Pre        —— 单条记忆的 L0 抽取（三级 fallback，见下）
 *   3) buildL0IndexPre     —— 文件级 L0 索引（确定性排序）
 *   4) classifyLayerPre    —— 来源 → 分层归属（2026-09-14，三层契约 C1，见下）
 *
 * 分层归属与状态（2026-09-14 · THREE-LAYER-CONTRACT §2 / C1）：
 *   `layer` ∈ { user | project | log | reflection | whiteboard }，由**来源标识**判定
 *   （userMemoryPath → user；workspaceMemoryPath 与旧版 {ws}/.dsh-memory/MEMORY.md → project；
 *     日志（todayLogPath / 历史日志） → log；reflections/ → reflection；
 *     handoff/PLAN.md 与交接账本 → whiteboard）。
 *   `status` ∈ { current | superseded | retracted }，本轮**只输出 current**（写入侧见
 *   buildL0IndexPre 内 TODO）。
 *
 * L0 抽取优先级（零 LLM，纯解析）：
 *   ① `## 主题块标题`   —— 已由写入侧概括，质量最好（去掉 `（HH:MM）` 后缀）
 *   ② 首个 `- ` 条目首句 —— 去掉 `- HH:MM ` 时间戳前缀后取首句
 *   ③ 截断兜底          —— 前 maxChars 字符
 *   若首句过短（< minChars）则继续并接后续句子，直到达标或触顶。
 *
 * 边界：纯函数、零 IO、零依赖；对同输入逐字段确定；非法输入 fail closed（返回
 * 空串/空数组），不抛异常。所有新增文本 UTF-8 无 BOM。
 */

export const L0_EXTRACT_VERSION = 'l0_extract_pre_v1'

/** 锚点：`<!-- memory:mem_<32hex> -->`（允许空白浮动）。 */
const MEM_ANCHOR_RE = /<!--\s*memory:(mem_[0-9a-f]{32})\s*-->/g

/** 行首时间戳：`12:01 ` / `14:5x ` 等（日志条目惯例）。 */
const LEAD_TIME_RE = /^\s*\d{1,2}:\d{2}[a-z]?\s+/

/** 句末/句读分隔符（含中文）。 */
const SENTENCE_SPLIT_RE = /[。；;!！?？\n]/

/** 主题块标题后缀：`（12:02）` 或 `(12:02)`。 */
const HEADING_SUFFIX_RE = /\s*[（(]\s*\d{1,2}:\d{2}\s*[)）]\s*$/

/**
 * ★M2.5a（2026-09-18）：**退化标题判据**。
 *
 * 规则① 原先假设「有标题 ⇒ 标题即摘要」，该假设**只对日志成立**：
 *   - 日志 `## 主题（12:02）` → 去掉时间后缀 = 真摘要 ✅
 *   - **项目/用户级笔记 `## 2026-09-17`（纯日期）→ 去后缀无效 ⇒ L0 = 一个日期** ❌
 *
 * 实测（本机真数据，`artifacts/_probe-l0-quality.mjs`）：
 *   project-notes 16/16 废（100%）、user-notes 46/50 废（92%）、
 *   log 449 条 0 废、reflection 21 条 0 废。
 * ⇒ 笔记层（**结论层**）在语义臂里向量彼此几乎相同 ⇒ **几乎不可检索**。
 *
 * 判据：标题若「不携带可检索语义」（纯日期/纯时间/纯符号数字/序号/短代号）
 * ⇒ **不采信，继续下探到规则②**（首个 `- ` 条目首句——那才是笔记的真实内容）。
 *
 * 边界：只拦**明显退化**的形态，绝不拦正常标题（宁可漏判，不可误伤）。
 */
const DEGENERATE_HEADING_RES = Object.freeze([
  /^\d{4}[-/.]\d{1,2}[-/.]\d{1,2}$/,          // 2026-09-17 / 2026/9/17
  /^\d{4}年\d{1,2}月(\d{1,2}日)?$/,            // 2026年9月17日
  /^\d{1,2}[-/.]\d{1,2}[-/.]\d{2,4}$/,         // 09-17 / 9.17.2026
  /^\d{1,2}:\d{2}(:\d{2})?$/,                  // 12:02
  /^[\d\s\-/.·、_]+$/,                          // 纯数字/符号
  /^第?\s*\d+\s*(章|节|部分|阶段|步|次|条|天|周|月|年)?$/, // 第3节 / 3
  /^[A-Za-z]{0,3}\d+(\.\d+)*$/,                // v1 / P3 / v1.2.3
])

/** 标题是否退化（不携带可检索语义）。 */
function isDegenerateHeading(title) {
  const t = clean(title)
  if (!t) return true
  // ★ 只按**形态**判，不按长度判。
  // 教训（2026-09-18，被既有套件抓出）：曾加 `t.length < 4` 作为"过短即退化"的判据，
  // 结果误伤 `主题甲`（3 个 CJK 字符，是合法标题）⇒ 标题被拒 ⇒ 落到规则② ⇒
  // 把正文里的隐私标记当成了 L0（`smoke-test-l0-index.mjs` 的"索引不得含原文"断言真红）。
  // 中文标题短而有效是常态，**长度不是质量信号**。
  // 纪律：宁可漏判（退化标题照旧被当摘要），不可误伤（合法标题被拒而拉入正文）。
  return DEGENERATE_HEADING_RES.some((re) => re.test(t))
}

/** 行级标题正则（与规则① 同一口径，供剥标题用）。 */
const HEADING_LINE_RE = /^\s{0,3}#{1,6}\s+(.+?)\s*$/

export const L0_DEFAULTS = Object.freeze({
  maxChars: 160,
  minChars: 15,
  hardChars: 480,
})

/** 分层取值域（契约 §2 · I4：每条条目必须带 layer）。 */
export const L0_LAYERS = Object.freeze(['user', 'project', 'log', 'reflection', 'whiteboard'])

/** 状态取值域（契约 §2 · I4/I5）。 */
export const L0_STATUSES = Object.freeze(['current', 'superseded', 'retracted'])

/** 无来源信息时的兜底层：`log`。L0 语料主体是日志；且按契约 §2 排序 log 优先级最低——
 *  判错只会**降权**，不会把低价值内容顶到高价值之前（安全侧默认）。 */
export const L0_DEFAULT_LAYER = 'log'

/** 层级契约版本（与 L0_EXTRACT_VERSION 分开：后者是抽取算法版本，已有断言锁定，不动）。 */
export const L0_LAYER_VERSION = 'l0_layer_pre_v1'

const clean = (s) => String(s == null ? '' : s).replace(/\u0000/g, '').trim()

/** 契约 §2 提到的来源字段名 / 常用路径键名 → 层（调用方直接手上有 resolvePaths 的键）。 */
const LAYER_TOKENS = Object.freeze({
  usermemorypath: 'user', userfile: 'user',
  workspacememorypath: 'project', notespath: 'project',
  todaylogpath: 'log', logpath: 'log',
  reflectionpath: 'reflection', reflectdir: 'reflection',
  whiteboardpath: 'whiteboard', planpath: 'whiteboard', handoffpath: 'whiteboard', handoffdir: 'whiteboard',
})

const WS_ROOT_RE = /(^|\/)memory\/workspaces(\/|$)/ // 集中式记忆根：<dshHome>/memory/workspaces/<wsKey>/
const WS_MARKER_RE = /(^|\/)\.dsh-memory(\/|$)/     // 旧版分散结构：{ws}/.dsh-memory/
const USER_ROOT_RE = /(^|\/)\.dsh\/memory(\/|$)/   // 用户级记忆根：~/.dsh/memory/
const DATE_FILE_RE = /^\d{4}-\d{2}-\d{2}\.md$/

/**
 * 来源标识 → 分层归属（契约 §2 判定规则）。纯字符串规则、零 IO、永不抛异常。
 *
 * 接受三种入参：① 层名本身（`'project'`）；② 契约/路径键名（`'workspaceMemoryPath'`）；
 * ③ 文件或目录路径（`'…/workspaces/--x--/reflections/2026-09-13.md'`，Windows 反斜杠同样识别）。
 * 判不出来返回 `null`（调用方回退 L0_DEFAULT_LAYER），不猜。
 *
 * @param {string} source 层名 / 键名 / 路径
 * @returns {'user'|'project'|'log'|'reflection'|'whiteboard'|null}
 */
export function classifyLayerPre(source) {
  const raw = clean(source)
  if (!raw) return null
  const s = raw.replace(/\\/g, '/').toLowerCase()
  if (L0_LAYERS.includes(s)) return s
  const token = LAYER_TOKENS[s]
  if (token) return token

  const base = s.slice(s.lastIndexOf('/') + 1)

  // ① 白板：handoff/ 目录（PLAN.md 与 handoff-<ts>.md 账本都在其下）
  if (/(^|\/)handoff(\/|$)/.test(s) || base === 'plan.md' || /^handoff[-_]\d{8}/.test(base) || /账本|白板/.test(s)) return 'whiteboard'
  // ② 反思：reflections/ 目录。文件名同样是 YYYY-MM-DD.md，必须先于日志判定
  if (/(^|\/)reflections?(\/|$)/.test(s) || /reflection/.test(base) || /反思/.test(s)) return 'reflection'
  // ③ 日志：日期文件名 或 logs/ 目录
  if (DATE_FILE_RE.test(base) || /(^|\/)logs?(\/|$)/.test(s) || /日志/.test(s)) return 'log'
  // ④ 项目笔记：工作区记忆根（集中式 / 旧版）下的 MEMORY.md
  if ((WS_ROOT_RE.test(s) || WS_MARKER_RE.test(s)) && /^(memory|notes)\.md$/.test(base)) return 'project'
  // ⑤ 用户级：用户记忆根下的文件，或带目录的 MEMORY.md（④ 已排除工作区侧）
  if (USER_ROOT_RE.test(s)) return 'user'
  if (s.includes('/') && /^(memory|calendar)\.md$/.test(base)) return 'user'
  return null
}

/** R4-B（2026-09-18）：分层**呈现**用的层序（最高优先在前）。
 *
 * 与 `recall-fusion.js:FUSION_LAYER_ORDER_PRE_V1` / `tier-layer-inject.js:TIER_LAYER_ORDER_PRE_V1`
 * **同序但独立声明** —— 本仓既有约定：跨模块不共享同一常量对象，避免一处改动静默改变另一处语义；
 * 三者相等由断言锁定（见 smoke-test-r4-recall-layers-pre.mjs）。 */
export const L0_LAYER_DISPLAY_ORDER_PRE_V1 = Object.freeze(['project', 'whiteboard', 'user', 'reflection', 'log'])

/** R4-B：层 → 呈现标题。措辞刻意让「结论」与「流水」一眼可分 —— 这正是检索区分度问题的靶心：
 *  语义臂内部不分层（`index.js` 纯分数 sort）时，模型看到的 MEMORY.md（结论）与 2026-09-xx.md（流水）
 *  在视觉上完全同级，含金量被数量淹没。 */
export const L0_LAYER_LABELS_PRE_V1 = Object.freeze({
  project: '结论层 · 项目笔记',
  user: '结论层 · 用户级记忆',
  whiteboard: '结论层 · 白板/账本',
  reflection: '反思层 · 每日反思',
  log: '流水层 · 每日日志',
})

/** 判不出层时的兜底标题：**不猜层**，如实说"未分层"，且固定排在最后（避免给出错误的层次暗示）。 */
export const L0_LAYER_UNKNOWN_LABEL_PRE_V1 = '未分层'

/**
 * R4-B（2026-09-18）：把检索命中**按层分组**（**只改呈现，不改排序**）。
 *
 * 硬契约（与本仓"回滚必须逐字节相同"纪律对齐）：
 *   ① **不增删条目**：输出各组条目总数 = 入参长度，且**层内保持入参原相对顺序**
 *      ⇒ 调用方无需改排序；`#finalRank` 标签仍在行内，排序信息可完全还原；
 *   ② 组顺序 = `L0_LAYER_DISPLAY_ORDER_PRE_V1`；判不出层的固定归**末组**；
 *   ③ 空入参 / 非数组 / 取层函数抛错 → **永不抛**（fail-soft：呈现层失败绝不打断检索）。
 *
 * 调用方职责：**只有一组时不打标题** ⇒ 单一层（如纯日志命中）的输出与旧版逐字节相同。
 *
 * @param {Array} items 命中条目
 * @param {(item:any)=>string} layerOf 取层函数（返回值经 classifyLayerPre 归一）
 * @returns {Array<{layer:string,label:string,items:Array}>}
 */
export function groupL0ByLayerPre(items, layerOf) {
  const groups = []
  try {
    if (!Array.isArray(items) || !items.length) return groups
    const fn = typeof layerOf === 'function' ? layerOf : () => ''
    /** @type {Map<string, Array>} 层 → 条目（插入序即入参相对序） */
    const byLayer = new Map()
    for (const it of items) {
      let layer = null
      try { layer = classifyLayerPre(fn(it)) } catch (_) { layer = null }
      const key = layer || ''
      if (!byLayer.has(key)) byLayer.set(key, [])
      byLayer.get(key).push(it)
    }
    // 已知层按契约层序；未知层紧随其后，保持首次出现序。
    // ★注：`classifyLayerPre` 的返回值域是**闭合词表**（L0_LAYERS 或 null），故下面
    //   `l && ...` 分支**当前不可达** —— 保留它是有意的前向兼容：将来 L0_LAYERS 扩容时，
    //   旧版调用方不会把新层误并入"未分层"，而是照实单独成组。
    //   （变异演示已证实：改这一段不会让任何断言变红 —— 它确实不参与当下语义。）
    const ordered = L0_LAYER_DISPLAY_ORDER_PRE_V1.filter((l) => byLayer.has(l))
    for (const l of byLayer.keys()) if (l && ordered.indexOf(l) === -1) ordered.push(l)
    for (const l of ordered) {
      groups.push({ layer: l, label: L0_LAYER_LABELS_PRE_V1[l] || l, items: byLayer.get(l) })
    }
    // 未分层固定末组（不猜层）—— **不走通用流程**：它不属层词表，也不该排在结论层之前。
    if (byLayer.has('')) {
      groups.push({ layer: '', label: L0_LAYER_UNKNOWN_LABEL_PRE_V1, items: byLayer.get('') })
    }
  } catch (_) { /* fail-soft：分组失败即降级为"无分组"，调用方按单组处理，检索不受影响 */ }
  return groups
}

/**
 * 三层契约 I5 的**检索侧过滤谓词**：只有 `status === 'current'` 的记录可进入检索与注入。
 *
 * 缺席 `status` 视为 `current`（向后兼容 C1 之前的记录）；`superseded` / `retracted` 一律挡下。
 * 做成导出的小函数是为了能被单测直接断言（验收要求"能失败的断言"）。
 *
 * @param {{status?:string}|null|undefined} record 记录（或任何带 status 的对象）
 * @returns {boolean} 是否可作为 current 使用
 */
export function isCurrentPre(record) {
  if (!record || typeof record !== 'object') return true
  const st = record.status
  if (st === undefined || st === null || st === '') return true
  return st === 'current'
}

/**
 * ★R4-A（2026-09-19 定稿）：**检索侧**准入谓词 —— I5 的**收窄**版。
 *
 * ── 变更依据（用户两次修正后定稿）──────────────────────────────────
 * 原 I5（`THREE-LAYER-CONTRACT.md:183`）：「非 `current` 的条目在**检索结果与注入内容两处**都被过滤」。
 *
 * ① 用户第一次修正：「**返回但标记是正确的**」⇒ 检索侧改为放行 + 标记。
 * ② 用户第二次修正（**推翻 agent 的"retracted 继续硬挡"方案**）：
 *    「这个 retracted **不是过滤掉**……**并不是挡，我感觉是备注**。
 *      因为比如说你之前踩过 3 次的那个坑，如果你不记住这个教训的话，你还会再踩。」
 *
 * ⇒ **三态一律返回、一律标记**。agent 原方案按「检索视角」分（过时的别干扰判断）；
 *   用户按「**学习视角**」分（**做错的事恰恰最该被记住**）。
 *   对记忆系统而言后者才是目的：`retracted` 不是垃圾数据，它是**一条教训**——
 *   把它藏起来 = **系统性遗忘自己的错误**，正是「还会再踩」的成因。
 *
 * ⇒ **本谓词不再过滤任何已知 status**，只对**未知值 fail-closed**
 *   （防将来新增枚举时静默放行 —— 枚举类常量必须配断言兜底，本仓纪律）。
 *
 * ── 与注入侧的分工（本谓词只用于检索侧）─────────────────────────
 * 注入侧仍用 `isCurrentPre`：注入是**常驻目录**（B0 仅 800 token），
 * 拿常驻预算装过时条目会挤掉现行结论；检索是**按需**的，装一条带警告的过时结论划算。
 * ⇒ **两处判据不同是有意为之**，不是漏改（`tier-layer-inject.js` 继续 import `isCurrentPre`）。
 *
 * @param {{status?:string}|null|undefined} record 记录（或任何带 status 的对象）
 * @returns {boolean} 是否可进入检索结果
 */
export function isRetrievablePre(record) {
  if (!record || typeof record !== 'object') return true
  const st = record.status
  if (st === undefined || st === null || st === '') return true
  // 已知三态一律放行（含 retracted —— 它是教训，不是垃圾）；未知值 fail-closed。
  return L0_STATUSES.includes(st)
}

/** 检索侧标记语的取值域（枚举类常量须配断言兜底 —— 本仓纪律）。 */
export const L0_SUPERSEDED_MARK_PRE_V1 = '⚠已作废'
export const L0_RETRACTED_MARK_PRE_V1 = '⚠已撤回'

/**
 * 为「返回但标记」生成**呈现后缀**（R4-A 的可见面）。
 *
 * 契约（**逐字节向后兼容**是硬约束）：
 *   `current` / 缺 status / 未知 / 非对象 ⇒ 空串（旧行为零变化）
 *   `superseded` ⇒ ` ⚠已作废（已被 mem_<32hex> 取代）`
 *   `retracted`  ⇒ ` ⚠已撤回（原因：<reason>；更正见 mem_<32hex>）`
 *
 * `reason` 才是「教训」的正文，比 status 本身有价值（用户第二次修正的要点）。
 * id 只认 `/^mem_[0-9a-f]{32}$/`，不合法一律丢弃 —— 防止把任意文本拼进检索呈现。
 *
 * @param {{status?:string, supersededBy?:string, reason?:string}} record
 * @returns {string} 追加到条目末尾的后缀（含前导空格；无需标记时为空串）
 */
export function supersededMarkPre(record) {
  try {
    if (!record || typeof record !== 'object') return ''
    const idOf = (v) => (/^mem_[0-9a-f]{32}$/.test(String(v || '').trim()) ? String(v).trim() : '')
    if (record.status === 'superseded') {
      const safe = idOf(record.supersededBy)
      return ' ' + L0_SUPERSEDED_MARK_PRE_V1 + (safe ? '（已被 ' + safe + ' 取代）' : '（已被更新结论取代）')
    }
    if (record.status === 'retracted') {
      const safe = idOf(record.supersededBy)
      const reason = record.reason ? String(record.reason).replace(/[\r\n]+/g, ' ').trim().slice(0, 80) : ''
      const tail = (reason ? '原因：' + reason + '；' : '') + (safe ? '更正见 ' + safe : '已被撤回')
      return ' ' + L0_RETRACTED_MARK_PRE_V1 + '（' + tail + '）'
    }
    return ''
  } catch (_) { return '' }   // fail-soft：标记失败绝不影响检索
}

/**
 * 按锚点切分记忆条目。
 *
 * 约定：锚点标记**其后**的内容（实测文件结构为 `<!-- A -->内容A<!-- B -->内容B`），
 * 因此第 i 个内容对应第 i 个锚点。锚点之前的游离内容（若有）归入 `preamble`。
 *
 * @param {string} text 文件内容
 * @returns {{items: Array<{id:string, body:string}>, preamble: string, anchors: number}}
 */
export function parseMemoryItemsPre(text) {
  const src = typeof text === 'string' ? text : ''
  const items = []
  if (!src) return { items, preamble: '', anchors: 0 }

  MEM_ANCHOR_RE.lastIndex = 0
  const marks = []
  let m
  while ((m = MEM_ANCHOR_RE.exec(src)) !== null) {
    marks.push({ id: m[1], start: m.index, end: m.index + m[0].length })
    if (m.index === MEM_ANCHOR_RE.lastIndex) MEM_ANCHOR_RE.lastIndex++
  }
  if (!marks.length) return { items, preamble: clean(src), anchors: 0 }

  for (let i = 0; i < marks.length; i++) {
    const from = marks[i].end
    const to = i + 1 < marks.length ? marks[i + 1].start : src.length
    const body = clean(src.slice(from, to))
    if (body) items.push({ id: marks[i].id, body })
  }
  return { items, preamble: clean(src.slice(0, marks[0].start)), anchors: marks.length }
}

/**
 * 抽取单条记忆的 L0。纯函数，永不抛异常。
 *
 * @param {string} body 条目正文
 * @param {{maxChars?:number, minChars?:number}} opts
 * @returns {{l0: string, source: 'heading'|'firstSentence'|'truncate'|'empty'}}
 */
export function extractL0Pre(body, opts = {}) {
  const maxChars = Math.max(16, Number(opts.maxChars) || L0_DEFAULTS.maxChars)
  const minChars = Math.max(0, Number(opts.minChars) || L0_DEFAULTS.minChars)
  const text = clean(body)
  if (!text) return { l0: '', source: 'empty' }

  const lines = text.split(/\r?\n/)

  // ① 主题块标题（★M2.5a：加质量门 —— 退化标题不采信，继续下探）
  for (const line of lines) {
    const h = HEADING_LINE_RE.exec(line)
    if (!h) continue
    const title = clean(h[1]).replace(HEADING_SUFFIX_RE, '')
    if (!title) continue
    // 退化标题（纯日期/纯时间/序号/短代号）不携带可检索语义 ⇒ 跳过，让规则② 取真实内容。
    if (isDegenerateHeading(title)) continue
    return { l0: cut(title, maxChars), source: 'heading' }
  }

  // ② 首个 `- ` 条目：先取首句，过短再并接（并接时剥列表标记与时间戳）
  for (const line of lines) {
    const b = /^\s*[-*+]\s+(.+?)\s*$/.exec(line)
    if (!b) continue
    let s = clean(b[1]).replace(LEAD_TIME_RE, '')
    if (!s) continue
    const first = clean(s.split(SENTENCE_SPLIT_RE)[0])
    s = growToMin(first || s, text, minChars, maxChars)
    return { l0: cut(s, maxChars), source: 'firstSentence' }
  }

  // ③ 兜底：正文截断（★M2.5a：先剥标题行 —— 否则退化标题会被压进 L0）
  // 场景：条目既无标题（或标题已退化被跳过）又无 `- ` 列表项时落到此处；
  // 直接压平会把 `## 2026-09-09` 变成 L0 开头（实测 user-notes 修后仍见该形态）。
  const bodyLines = lines.filter((l) => !HEADING_LINE_RE.test(l))
  const flat = clean((bodyLines.length ? bodyLines : lines).join('\n').replace(/\s+/g, ' '))
  return { l0: cut(flat, maxChars), source: 'truncate' }
}

/**
 * 构建文件级 L0 索引（按 id 升序，确定性）。
 *
 * 2026-09-14（三层契约 C1）：每条**追加** `layer` + `status` 两个字段——只增不减，
 * 老调用方读 `id / l0 / source / chars / bodyChars` 完全不受影响，签名与调用方式不变。
 * 层归属：`opts.layer`（层名 / 路径 / 键名，经 classifyLayerPre）→ `opts.path` → `L0_DEFAULT_LAYER`。
 *
 * ★R4-A（2026-09-18）：新增**可选** `opts.statusOf(id)` 注入解析器 —— 让本模块保持
 *   **零 IO 纯函数**（存储格式属写入侧 G3 的决定，本层只透传，不猜存储）。
 *   未注入时行为与从前**逐字节相同**（`status` 恒 `'current'`）⇒ 向后兼容。
 *
 * @param {string} text 文件内容
 * @param {{maxChars?:number, minChars?:number, layer?:string, path?:string,
 *          statusOf?:(id:string)=>({status?:string, supersededBy?:string}|null|undefined)}} [opts]
 * @returns {Array<{id:string, l0:string, source:string, chars:number, bodyChars:number, layer:string, status:string, supersededBy?:string}>}
 */
export function buildL0IndexPre(text, opts = {}) {
  const { items } = parseMemoryItemsPre(text)
  const layer = resolveLayerPre(opts)
  const statusOf = opts && typeof opts.statusOf === 'function' ? opts.statusOf : null
  const out = items.map((it) => {
    const r = extractL0Pre(it.body, opts)
    // C1 写入侧（G3）落盘状态后，由调用方经 `statusOf` 注入；本层只透传。
    // fail-closed 语义在**消费侧**（isRetrievablePre 未知值挡下），此处只做形态净化。
    let status = 'current'
    let supersededBy
    let reason
    if (statusOf) {
      try {
        const st = statusOf(it.id)
        if (st && typeof st === 'object') {
          if (typeof st.status === 'string' && L0_STATUSES.includes(st.status)) status = st.status
          if (typeof st.supersededBy === 'string' && st.supersededBy) supersededBy = st.supersededBy
          // R4-A：撤回原因 —— 这才是「教训」的正文，比 status 本身有价值。
          if (typeof st.reason === 'string' && st.reason) reason = st.reason
        }
      } catch (_) { /* fail-soft：状态解析失败 ⇒ 按 current 处理，绝不影响索引构建 */ }
    }
    const rec = {
      id: it.id, l0: r.l0, source: r.source, chars: r.l0.length, bodyChars: it.body.length,
      layer, status,
    }
    // 只在真的有值时附字段 —— 保证「无状态时」输出与旧版逐字节相同。
    if (supersededBy) rec.supersededBy = supersededBy
    if (reason) rec.reason = reason
    return rec
  })
  out.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
  return out
}

/** 本次抽取的层归属：显式层名/路径 > 备用路径键 > 兜底层。判不出不猜，回退 L0_DEFAULT_LAYER。 */
function resolveLayerPre(opts) {
  const o = opts && typeof opts === 'object' ? opts : {}
  for (const cand of [o.layer, o.path, o.sourcePath]) {
    const hit = classifyLayerPre(cand)
    if (hit) return hit
  }
  return L0_DEFAULT_LAYER
}

// ---------- 内部工具 ----------

function cut(s, n) {
  if (s.length <= n) return s
  return s.slice(0, Math.max(1, n - 1)) + '…'
}

/** 首句过短时，并接后续句子直到 minChars 或 maxChars。每句先剥列表标记与时间戳前缀。 */
function growToMin(first, full, minChars, maxChars) {
  if (first.length >= minChars) return first
  // ★ issue #71 修复（2026-09-19）：**保留换行结构**。
  //   旧实现先 `full.replace(/\s+/g, ' ')` 把换行压成空格，**再用含 `\n` 的 SENTENCE_SPLIT_RE 切分**
  //   ⇒ `\n` 分支恒不命中（死代码），整段多行正文被当成**一个 part**；
  //   而剥前缀的 `/^\s*[-*+]\s+/` 与 `LEAD_TIME_RE` 都是 `^` 锚定，只剥得掉该 part 的**首个**标记
  //   ⇒ 第 2 行起的 `- HH:MM` 原样进入 L0（嵌入/检索输入）。
  //   现改为：只把「行内连续空白」压成单空格，**行界 `\n` 保留** ⇒ 逐行切分、逐 part 剥前缀。
  const flat = clean(full.replace(/[^\S\r\n]+/g, ' ').replace(/\r\n?/g, '\n'))
  if (!flat || flat.length <= first.length) return first
  const parts = flat.split(SENTENCE_SPLIT_RE)
    .map((x) => clean(String(x).replace(/^\s*[-*+]\s+/, '').replace(LEAD_TIME_RE, '')))
    .filter(Boolean)
  let acc = ''
  for (const p of parts) {
    acc = acc ? acc + '。' + p : p
    if (acc.length >= minChars || acc.length >= maxChars) break
  }
  return acc || first
}

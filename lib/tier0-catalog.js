/**
 * Tier-0 目录生成器（tier0_catalog_v1）—— 三层检索契约（`docs/internal/THREE-LAYER-CONTRACT.md`）C4。
 *
 * 2026-09-14 建立。作用＝**指引层**：把四类来源（用户级记忆 / 项目笔记 / 当日日志 / 白板 PLAN）
 * 压成"每条 1 行"的短目录，用来回答「要不要用某条记忆」，从而决定是否下探 Tier-1 / Tier-2。
 *
 * 一行格式（契约 §1）：`标题 · 一句结论 · layer · status · 日期`
 *   - layer ∈ { user | project | log | reflection | whiteboard }，按**来源路径**归属（§2 判定规则）；
 *   - status 一律 `current`（superseded / retracted 的判定属写入侧，指引层不臆断）；
 *   - 预算 ≤ B0 token（契约 I1；默认 800，待实验 E1 校准）；
 *   - 裁剪优先级：project > whiteboard > user > log（同层按日期倒序）；`reflection` 排在 user 与 log
 *     之间，与 §2「notes(project) > log(reflection) > log」一致。
 *
 * **per-layer 配额（2026-09-14 C5，契约 §2.1；opt-in）**：纯严格优先级会被 `project` 吃满预算——真实
 * 语料实测 77 块把 800 token 全占，`whiteboard`/`user`/`log` 一条都进不来，"分层"退化成单层。
 * 故开立 `quota` 选项（`{projectRatio=0.6, floorRatio=0.1, floorLayers=['whiteboard','user']}`）：
 *   - `project ≤ projectRatio·maxTokens`（硬上限）；
 *   - `whiteboard`/`user` 各**保底** `floorRatio·maxTokens`（先预留额度再按优先级填充，保底不足则二轮补齐）；
 *   - 剩余额度按优先级继续填；被裁条目**按层计数**返回（`droppedByLayer` / `layerAccounting`），
 *     `degradedLayers` 明确列出"有候选却一条没进"的层 —— 落实 I7「不得静默丢层」。
 * **默认关闭（`quota` 缺省 = 旧行为）**：默认关闭是为保住既有调用方的逐字节行为（C4 的极小预算
 * 压力用例锁的是"纯严格优先级"语义）；自动注入路径（`lib/tier-layer-inject.js`）显式开启。
 *
 * 预算口径（**重要**）：I1 是硬上限，而仓库现有的 token 估算是 lib/index.js 的
 * `estimateSessionTokens()`（官方 token-meter 移植，`ceil(字符/4)+4`）。该口径对 CJK 语料会**低估
 * 约 2-4 倍**（中文接近 1 token/字符），拿它当预算门会静默突破 B0。故本模块两种口径都实现：
 *   - `estimateMode:'repo'`         —— 原样复刻仓库既有口径（供对齐 / 复算）；
 *   - `estimateMode:'conservative'` —— `ceil(字符/2)`，**默认**用它当预算门（CJK 密集体裁的保守上界）。
 * 验收口径：**两种口径下 text 都 ≤ maxTokens**（见 `tests/smoke/smoke-test-tier0-catalog-pre.mjs`）。
 *
 * 单元（"一条"）切分：① 有 `<!-- memory:mem_<32hex> -->` 锚点 → 一块一条（与 l0-extract-pre 同约定：
 * 锚点标记其**后**内容）；② 无锚点 → 按最浅的 ≥2 级标题切（`#` 文档标题成为独立一条）；③ 无标题 →
 * 按顶层 `- ` 条目切；④ 都没有 → 整个文件算一条。
 * 标题 = 该单元内**最深**的有效标题（剥掉 `（HH:MM）`/`（YYYY-MM-DD）` 尾巴；纯日期标题不算标题），
 * 否则取首行的 `【标签】`，都没有则为空串（不硬造）。一句结论 = 首条实质内容行的首句，剥掉列表标记 /
 * 时间前缀（`07:41 `）/ 序号（`①`、`1.`），≤ 80 字。
 *
 * 边界（契约 I7 精神）：路径为空 / 文件不存在 / 是目录 / 过大 / 空文件 / 格式乱 → 一律**跳过并计数**，
 * 绝不抛异常；目录为空时 text 输出显式空标记，不允许静默无声。
 *
 * 纯函数内核（零 IO，可单独测）：estimateTokensPre / splitTier0UnitsPre / extractTier0ItemsPre /
 * renderCatalogLinePre / buildTier0CatalogFromTextPre；IO 只集中在 buildTier0CatalogPre 与
 * readTextSafePre。零第三方依赖（仅 node 内建 fs）。UTF-8 无 BOM。
 */
import { readFileSync, statSync } from 'node:fs'

export const TIER0_CATALOG_VERSION = 'tier0_catalog_v1'

export const TIER0_DEFAULTS = Object.freeze({
  maxTokens: 800,
  oneLineChars: 80,
  titleChars: 40,
  minChars: 15,
  maxFileBytes: 4 * 1024 * 1024,
  estimateMode: 'conservative',
})

/** layer 优先级：数字小者优先保留（契约 §2）。 */
const LAYER_RANK = Object.freeze({ project: 0, whiteboard: 1, user: 2, reflection: 3, log: 4 })

/** 允许的 layer 取值（契约 §2）。 */
const KNOWN_LAYERS = Object.freeze(['user', 'project', 'log', 'reflection', 'whiteboard'])

/** 默认输入键 → layer（契约 §2 判定规则）。 */
const SOURCE_SPECS = Object.freeze([
  Object.freeze({ key: 'workspaceMemoryPath', layer: 'project' }),
  Object.freeze({ key: 'userMemoryPath', layer: 'user' }),
  Object.freeze({ key: 'todayLogPath', layer: 'log' }),
  Object.freeze({ key: 'handoffPlanPath', layer: 'whiteboard' }),
])

/** 锚点：`<!-- memory:mem_<32hex> -->`（允许空白浮动）。 */
const MEM_ANCHOR_RE = /<!--\s*memory:(mem_[0-9a-f]{32})\s*-->/g
/** 标题行：`## 标题`（≤3 空格缩进）。 */
const HEADING_RE = /^\s{0,3}(#{1,6})\s+(.*?)\s*$/
/** 列表标记：`- ` / `* ` / `+ ` / `• `。 */
const BULLET_RE = /^\s{0,3}[-*+•]\s+/
/** 行首时间戳：`07:41 ` / `14:5x `（日志惯例）。 */
const LEAD_TIME_RE = /^\s*\d{1,2}:\d{2}(?::\d{2})?[a-z]?\s+/
/** 行首序号：`①` / `1.` / `(2)` / `[3]` / `1、`。 */
const LEAD_ORDER_RE = /^\s*(?:[（(]\s*\d{1,3}\s*[)）]|\[\d{1,3}\]|\d{1,3}\s*[.)、．]|[\u2460-\u2473])\s*/
/** 行首 `【标签】` / `[标签]` / `(标签)`。 */
const LABEL_RE = /^\s*[【[（(]\s*([^】\]）)]{2,40})\s*[】\]）)]/
/** 句末/句读分隔符（与 l0-extract-pre 同一字符类）。 */
const SENTENCE_SPLIT_RE = /[。；;!！?？\n]/
/** 标题尾巴：`（07:41）` / `（2026-09-14）`；标题**开头**的日期与分隔符；日期串本体。 */
const HEADING_SUFFIX_RE = /\s*[（(]\s*(?:\d{1,2}:\d{2}|\d{4}[-/.]\d{1,2}[-/.]\d{1,2})\s*[)）]\s*$/
const LEAD_DATE_RE = /^\s*\d{4}[-/.]\d{1,2}[-/.]\d{1,2}\s*[·:：\-—–]?\s*/
const DATE_STR_RE = /(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/g
/** 日期：`2026-09-14` / `2026/9/14`。 */
const DATE_RE = /(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/g
/** 分隔线 / 注释 / 强调标记。 */
const RULE_LINE_RE = /^\s*(?:-{3,}|\*{3,}|_{3,}|={3,})\s*$/
const COMMENT_LINE_RE = /^\s*<!--/
const EMPHASIS_RE = /\*\*|__/g
/** 含字母/汉字才算"实质内容行"。 */
const HAS_LETTER_RE = /\p{L}/u

const clean = (s) => String(s == null ? '' : s).replace(/\u0000/g, '').trim()
const stripBom = (s) => (s && s.charCodeAt(0) === 0xfeff ? s.slice(1) : s)
const cut = (s, n) => (s.length <= n ? s : s.slice(0, Math.max(1, n - 1)) + '…')

/**
 * 纯日期标题（`2026-08-14`、`2026-08-14（周一）`）不作标题用——
 * 判定＝把日期串与分隔符剥光后什么都不剩。
 */
function isDateOnly(s) {
  const t = String(s || '')
  if (!findDatePre(t)) return false
  DATE_STR_RE.lastIndex = 0
  return t.replace(DATE_STR_RE, '').replace(/[\s\-—–·:：()（）[\]【】.,，、/]+/g, '') === ''
}

/**
 * token 估算。两种口径都可用，默认走保守口径（见文件头"预算口径"）。
 * 保守口径取 `max(ceil(字符/2), repo 口径)`——即**永不弱于**仓库既有口径（短文本时 repo 口径的
 * `+4` 框定开销更大，取 max 后两边都盖住）。
 * @param {string} text
 * @param {{mode?: 'repo'|'conservative'}} [opts]
 * @returns {number}
 */
export function estimateTokensPre(text, opts = {}) {
  const s = String(text == null ? '' : text)
  if (!s) return 0
  const mode = opts && opts.mode === 'repo' ? 'repo' : 'conservative'
  // repo 口径：lib/index.js estimateSessionTokens()（官方 token-meter 移植）的文本分支。
  const repo = Math.ceil(s.length / 4) + 4
  if (mode === 'repo') return repo
  // 保守口径：CJK 密集时 4 字符≈1 token 会低估，按 2 字符≈1 token 封顶。
  return Math.max(Math.ceil(s.length / 2), repo)
}

/** 取文本中首个合法日期（`YYYY-MM-DD`）；无则空串。 */
export function findDatePre(text) {
  const s = String(text == null ? '' : text)
  DATE_RE.lastIndex = 0
  let m
  while ((m = DATE_RE.exec(s)) !== null) {
    const y = Number(m[1]), mo = Number(m[2]), d = Number(m[3])
    if (y >= 1900 && y <= 2999 && mo >= 1 && mo <= 12 && d >= 1 && d <= 31) {
      return `${m[1]}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`
    }
    if (m.index === DATE_RE.lastIndex) DATE_RE.lastIndex++
  }
  return ''
}

/**
 * 切分单元（纯函数）。返回 `{ groups, headLines }`；`groups` 每项是一个单元的行数组。
 * 顺序：锚点 → 标题 → 顶层 `- ` 条目 → 整文件兜底。
 */
export function splitTier0UnitsPre(text) {
  const src = String(text == null ? '' : text)
  const empty = { groups: [], headLines: [] }
  if (!src.trim()) return empty
  const allLines = src.split(/\r?\n/)
  const headLines = allLines.map(clean).filter(Boolean).slice(0, 3)

  // ① 记忆锚点：锚点标记其后内容（与 l0-extract-pre.parseMemoryItemsPre 同约定）
  MEM_ANCHOR_RE.lastIndex = 0
  const marks = []
  let m
  while ((m = MEM_ANCHOR_RE.exec(src)) !== null) {
    marks.push({ start: m.index, end: m.index + m[0].length })
    if (m.index === MEM_ANCHOR_RE.lastIndex) MEM_ANCHOR_RE.lastIndex++
  }
  if (marks.length) {
    const groups = []
    for (let i = 0; i < marks.length; i++) {
      const from = marks[i].end
      const to = i + 1 < marks.length ? marks[i + 1].start : src.length
      const body = clean(src.slice(from, to))
      if (body) groups.push(body.split(/\r?\n/))
    }
    if (groups.length) return { groups, headLines }
  }

  // ② 标题切分：取最浅的 ≥2 级标题作分界（全为 1 级时退化为按 1 级）
  const heads = []
  allLines.forEach((line, i) => {
    const h = HEADING_RE.exec(line)
    if (h) heads.push({ i, level: h[1].length })
  })
  if (heads.length) {
    const levels = [...new Set(heads.map((h) => h.level))].sort((a, b) => a - b)
    const splitLevel = levels.find((lv) => lv >= 2) || levels[0]
    const bounds = heads.filter((h) => h.level <= splitLevel).map((h) => h.i)
    const groups = []
    for (let i = 0; i < bounds.length; i++) {
      const from = bounds[i]
      const to = i + 1 < bounds.length ? bounds[i + 1] : allLines.length
      const lines = allLines.slice(from, to)
      if (lines.some((l) => clean(l))) groups.push(lines)
    }
    if (groups.length) return { groups, headLines }
  }

  // ③ 无标题：按顶层 `- ` 条目切
  const bullets = []
  allLines.forEach((line, i) => { if (BULLET_RE.test(line)) bullets.push(i) })
  if (bullets.length >= 2) {
    return { groups: bullets.map((i) => [allLines[i]]), headLines }
  }

  // ④ 兜底：整个文件算一条
  return { groups: [allLines], headLines }
}

/** 单元内最深的有效标题（纯日期标题不算；剥掉头尾日期与（HH:MM）尾巴）；无则空串。 */
function pickHeadingTitle(lines, titleChars) {
  let best = null
  for (const line of lines) {
    const h = HEADING_RE.exec(line)
    if (!h) continue
    const t = clean(String(h[2]).replace(HEADING_SUFFIX_RE, '').replace(LEAD_DATE_RE, ''))
    if (!t || isDateOnly(t)) continue
    const level = h[1].length
    if (!best || level > best.level) best = { level, text: t }
  }
  return best ? cut(best.text, titleChars) : ''
}

/** 首条实质内容行：剥列表标记 / 序号 / 时间前缀 / 引用符 / 强调标记；返回 `{ label, body }`。 */
function pickContentLine(lines) {
  for (const line of lines) {
    if (HEADING_RE.test(line) || COMMENT_LINE_RE.test(line) || RULE_LINE_RE.test(line)) continue
    let t = clean(String(line).replace(/^\s*>\s?/, ''))
    t = t.replace(BULLET_RE, '')
    t = t.replace(LEAD_ORDER_RE, '')
    t = t.replace(LEAD_TIME_RE, '')
    t = clean(t.replace(EMPHASIS_RE, ''))
    if (!t || !HAS_LETTER_RE.test(t)) continue
    const lab = LABEL_RE.exec(t)
    if (lab) {
      const label = clean(lab[1])
      const rest = clean(t.slice(lab[0].length))
      if (label && rest) return { label, body: rest }
    }
    return { label: '', body: t }
  }
  return null
}

/** 首句；不足 minChars 时并接后续句子（同 l0-extract-pre 的 growToMin 思路）。 */
function firstSentence(text, minChars, maxChars) {
  const flat = clean(String(text).replace(/\s+/g, ' '))
  if (!flat) return ''
  const parts = flat.split(SENTENCE_SPLIT_RE).map(clean).filter(Boolean)
  if (!parts.length) return ''
  let acc = parts[0]
  for (let i = 1; i < parts.length && acc.length < minChars; i++) acc += '。' + parts[i]
  return cut(acc, maxChars)
}

/** 日期：单元标题行 → 文件名 → 文件头 → 单元正文。 */
function resolveDatePre(lines, ctx) {
  for (const line of lines) {
    if (!HEADING_RE.test(line)) continue
    const d = findDatePre(line)
    if (d) return d
  }
  if (ctx.baseDate) return ctx.baseDate
  if (ctx.fileDate) return ctx.fileDate
  for (const line of lines) {
    const d = findDatePre(line)
    if (d) return d
  }
  return ''
}

/** 单个单元 → 一条目录项；无实质内容返回 null。 */
function buildRecordPre(layer, unitLines, ctx, cfg) {
  const lines = unitLines.map(clean).filter(Boolean)
  if (!lines.length) return null
  let title = pickHeadingTitle(lines, cfg.titleChars)
  const content = pickContentLine(lines)
  let oneLine = ''
  if (content) {
    if (!title && content.label) title = cut(content.label, cfg.titleChars)
    oneLine = firstSentence(content.body, cfg.minChars, cfg.oneLineChars)
  }
  if (!title && !oneLine) return null
  return { layer, status: 'current', date: resolveDatePre(lines, ctx), title, oneLine }
}

/**
 * 单份文件文本 → 目录项数组（纯函数；layer 由调用方给定，非法 layer 返回空数组，不抛错）。
 * @param {string} text
 * @param {'user'|'project'|'log'|'reflection'|'whiteboard'} layer
 * @param {{path?:string, maxTokens?:number, oneLineChars?:number, titleChars?:number, minChars?:number}} [opts]
 */
export function extractTier0ItemsPre(text, layer, opts = {}) {
  const o = opts && typeof opts === 'object' ? opts : {}
  return extractSourcePre(text, layer, { path: clean(o.path) }, resolveOptsPre(o)).items
}

/** 单份来源的抽取（内部）：同时给出单元数与丢弃数。 */
function extractSourcePre(text, layer, ctx, cfg) {
  if (!KNOWN_LAYERS.includes(layer)) return { items: [], units: 0, dropped: 0 }
  const src = stripBom(String(text == null ? '' : text))
  if (!src.trim()) return { items: [], units: 0, dropped: 0 }
  const { groups, headLines } = splitTier0UnitsPre(src)
  const base = clean(String(ctx.path || '').replace(/\\/g, '/').split('/').pop())
  const dateCtx = { baseDate: findDatePre(base), fileDate: findDatePre(headLines.join(' ')) }
  const items = []
  let dropped = 0
  for (const unitLines of groups) {
    const rec = buildRecordPre(layer, unitLines, dateCtx, cfg)
    if (rec) items.push(rec)
    else dropped++
  }
  return { items, units: groups.length, dropped }
}

/** 一条目录项 → 一行文本。**导出**：渲染口径的唯一实现。 */
export function renderCatalogLinePre(item) {
  const it = item && typeof item === 'object' ? item : {}
  const title = clean(it.title)
  const oneLine = clean(it.oneLine)
  const date = clean(it.date)
  const segs = []
  if (title && title !== oneLine) segs.push(title)
  if (oneLine) segs.push(oneLine)
  segs.push(clean(it.layer) || 'log')
  segs.push(clean(it.status) || 'current')
  if (date) segs.push(date)
  return segs.join(' · ')
}

/** 契约要求的对外字段（五字段，顺序固定）。 */
const toPublicItemPre = (r) => ({
  layer: r.layer, status: r.status, date: r.date, title: r.title, oneLine: r.oneLine,
})

/** 排序：layer 优先级升序 → 同层日期倒序 → 原顺序（确定性）。 */
function compareRecordsPre(a, b) {
  const ra = LAYER_RANK[a.layer] === undefined ? 9 : LAYER_RANK[a.layer]
  const rb = LAYER_RANK[b.layer] === undefined ? 9 : LAYER_RANK[b.layer]
  if (ra !== rb) return ra - rb
  if (a.date !== b.date) {
    if (!a.date) return 1
    if (!b.date) return -1
    return a.date < b.date ? 1 : -1
  }
  return a._seq - b._seq
}

/** per-layer 配额默认值（契约 §2.1）。 */
export const TIER0_QUOTA_DEFAULTS = Object.freeze({
  projectRatio: 0.6,
  floorRatio: 0.1,
  projectLayer: 'project',
  floorLayers: Object.freeze(['whiteboard', 'user']),
})

/** 配额参数归一化（`quota===true` 即全默认；非法值一律回退默认，不抛错）。 */
function resolveQuotaPre(q) {
  const o = q === true ? {} : (q && typeof q === 'object' ? q : {})
  const ratio = (v, d) => { const n = Number(v); return Number.isFinite(n) && n > 0 && n <= 1 ? n : d }
  const fl = Array.isArray(o.floorLayers) ? o.floorLayers.filter((l) => KNOWN_LAYERS.includes(l)) : [...TIER0_QUOTA_DEFAULTS.floorLayers]
  return {
    projectRatio: ratio(o.projectRatio, TIER0_QUOTA_DEFAULTS.projectRatio),
    floorRatio: ratio(o.floorRatio, TIER0_QUOTA_DEFAULTS.floorRatio),
    projectLayer: KNOWN_LAYERS.includes(o.projectLayer) ? o.projectLayer : TIER0_QUOTA_DEFAULTS.projectLayer,
    floorLayers: [...new Set(fl)],
  }
}

/**
 * per-layer 配额分配（纯函数，确定性；契约 §2.1）。
 *
 * 两轮：
 *   ① 优先级填充（project > whiteboard > user > reflection > log，同层日期倒序）：逐条试装；
 *      超 `project` 层上限（`projectRatio·maxTokens`）或超"总预算 − 其它保底层尚欠额度"者跳过；
 *   ② 保底补齐：对仍低于保底的层（`floorLayers`），把①里被预留挤掉的条目补进来（仍受总预算约束）。
 *
 * @param {Array<{layer:string,date:string,title:string,oneLine:string,status:string,_seq?:number}>} candidates
 * @param {{maxTokens?:number, estimateMode?:'repo'|'conservative',
 *          quota?:boolean|{projectRatio?:number,floorRatio?:number,projectLayer?:string,floorLayers?:string[]}}} [opts]
 * @returns {{picked:Array, text:string, tokens:number, dropped:number,
 *            droppedByLayer:Record<string,number>, perLayer:Record<string,object>,
 *            caps:Record<string,number|null>, floors:Record<string,number>,
 *            degradedLayers:string[], emptyLayers:string[], quotaApplied:boolean}}
 */
export function allocateTier0QuotaPre(candidates, opts = {}) {
  const cfg = opts && typeof opts === 'object' ? opts : {}
  const maxTokens = Number(cfg.maxTokens) > 0 ? Number(cfg.maxTokens) : TIER0_DEFAULTS.maxTokens
  const estimateMode = cfg.estimateMode === 'repo' ? 'repo' : 'conservative'
  const q = resolveQuotaPre(cfg.quota === undefined ? true : cfg.quota)
  const list = (Array.isArray(candidates) ? candidates : []).map((r, i) => Object.assign({}, r, {
    _seq: Number.isFinite(r && r._seq) ? r._seq : i,
  }))
  const sorted = list.slice().sort(compareRecordsPre)
  const has = new Set(sorted.map((r) => r.layer))

  const caps = {}
  const floors = {}
  for (const layer of KNOWN_LAYERS) {
    caps[layer] = layer === q.projectLayer ? Math.max(1, Math.floor(maxTokens * q.projectRatio)) : null
    floors[layer] = (q.floorLayers.includes(layer) && has.has(layer)) ? Math.max(1, Math.ceil(maxTokens * q.floorRatio)) : 0
  }

  const layerChars = {}
  const tokensOf = (layer) => (layerChars[layer] ? estimateTokensPre(layerChars[layer], { mode: estimateMode }) : 0)
  /** 其它保底层尚欠的额度（要预留，不能被高优先级层先吃掉）。 */
  const reserveFor = (exceptLayer) => {
    let sum = 0
    for (const layer of q.floorLayers) {
      const f = floors[layer] || 0
      if (!f || layer === exceptLayer) continue
      sum += Math.max(0, f - tokensOf(layer))
    }
    return sum
  }
  const chosen = []
  const accepted = new Set()
  let text = ''
  const accept = (rec, line) => {
    layerChars[rec.layer] = layerChars[rec.layer] ? layerChars[rec.layer] + '\n' + line : line
    chosen.push(rec)
    accepted.add(rec)
    text = text ? text + '\n' + line : line
  }

  // ① 优先级填充（预留保底额度）
  for (const rec of sorted) {
    const line = renderCatalogLinePre(rec)
    const layerTok = estimateTokensPre(layerChars[rec.layer] ? layerChars[rec.layer] + '\n' + line : line, { mode: estimateMode })
    if (caps[rec.layer] !== null && layerTok > caps[rec.layer]) continue
    const reserve = reserveFor(rec.layer) + Math.max(0, (floors[rec.layer] || 0) - layerTok)
    const next = text ? text + '\n' + line : line
    if (estimateTokensPre(next, { mode: estimateMode }) > maxTokens - reserve) continue
    accept(rec, line)
  }
  // ② 保底补齐（补①中被预留挤掉的保底层条目）
  for (const rec of sorted) {
    if (accepted.has(rec)) continue
    const floor = floors[rec.layer] || 0
    if (!floor || tokensOf(rec.layer) >= floor) continue
    const line = renderCatalogLinePre(rec)
    const layerTok = estimateTokensPre(layerChars[rec.layer] ? layerChars[rec.layer] + '\n' + line : line, { mode: estimateMode })
    if (caps[rec.layer] !== null && layerTok > caps[rec.layer]) continue
    const next = text ? text + '\n' + line : line
    if (estimateTokensPre(next, { mode: estimateMode }) > maxTokens) continue
    accept(rec, line)
  }

  chosen.sort(compareRecordsPre)
  const perLayer = {}
  const droppedByLayer = {}
  const degradedLayers = []
  const emptyLayers = []
  for (const layer of KNOWN_LAYERS) {
    const total = sorted.filter((r) => r.layer === layer).length
    const picked = chosen.filter((r) => r.layer === layer).length
    perLayer[layer] = {
      candidates: total, picked, dropped: total - picked, tokens: tokensOf(layer),
      cap: caps[layer] === null ? null : caps[layer], floor: floors[layer] || 0,
    }
    if (total - picked > 0) droppedByLayer[layer] = total - picked
    if (total > 0 && picked === 0) degradedLayers.push(layer)
    if (total === 0) emptyLayers.push(layer)
  }
  return {
    picked: chosen,
    text,
    tokens: text ? estimateTokensPre(text, { mode: estimateMode }) : 0,
    dropped: sorted.length - chosen.length,
    droppedByLayer,
    perLayer,
    caps,
    floors,
    degradedLayers,
    emptyLayers,
    quotaApplied: true,
    projectRatio: q.projectRatio,
    floorRatio: q.floorRatio,
    floorLayers: [...q.floorLayers],
  }
}

function resolveOptsPre(opts) {
  const o = opts && typeof opts === 'object' ? opts : {}
  const num = (v, d) => {
    const n = Number(v)
    return Number.isFinite(n) && n > 0 ? n : d
  }
  return {
    maxTokens: num(o.maxTokens, TIER0_DEFAULTS.maxTokens),
    oneLineChars: num(o.oneLineChars, TIER0_DEFAULTS.oneLineChars),
    titleChars: num(o.titleChars, TIER0_DEFAULTS.titleChars),
    minChars: num(o.minChars, TIER0_DEFAULTS.minChars),
    maxFileBytes: num(o.maxFileBytes, TIER0_DEFAULTS.maxFileBytes),
    estimateMode: o.estimateMode === 'repo' ? 'repo' : 'conservative',
    markTruncation: o.markTruncation === true,
    // C5:per-layer 配额（opt-in；缺省=旧行为，逐字节不变）
    quota: o.quota === true || (o.quota && typeof o.quota === 'object') ? o.quota : false,
  }
}

/**
 * 已读到内存的多来源 → Tier-0 目录（纯函数，无 IO；确定性）。
 *
 * @param {Array<{layer:string, text:string, path?:string}>} sources
 * @param {{maxTokens?:number, estimateMode?:'repo'|'conservative', oneLineChars?:number,
 *          titleChars?:number, minChars?:number, markTruncation?:boolean}} [opts]
 * @returns {{text:string, items:Array<{layer:string,status:string,date:string,title:string,oneLine:string}>,
 *            tokens:number, maxTokens:number, estimateMode:string, tokenRepo:number, dropped:number,
 *            truncated:boolean, units:number, droppedUnits:number, candidates:number,
 *            skipped:Array<{layer:string,path:string,reason:string}>}}
 */
export function buildTier0CatalogFromTextPre(sources, opts = {}) {
  const cfg = resolveOptsPre(opts)
  const list = Array.isArray(sources) ? sources : []
  const candidates = []
  const skipped = []
  let units = 0
  let droppedUnits = 0
  let seq = 0

  for (const src of list) {
    const layer = clean(src && src.layer)
    const path = clean(src && src.path)
    if (!KNOWN_LAYERS.includes(layer)) {
      skipped.push({ layer, path, reason: 'unknown-layer' })
      continue
    }
    if (!clean(src && src.text)) {
      skipped.push({ layer, path, reason: 'empty' })
      continue
    }
    const r = extractSourcePre(src.text, layer, { path }, cfg)
    units += r.units
    droppedUnits += r.dropped
    if (!r.items.length) {
      skipped.push({ layer, path, reason: 'no-items' })
      continue
    }
    for (const rec of r.items) candidates.push(Object.assign({}, rec, { _seq: seq++, _path: path }))
  }

  candidates.sort(compareRecordsPre)

  const picked = []
  let text = ''
  let dropped = 0
  // C5:per-layer 配额（opt-in）。关闭时下面这段 = C4 既有贪心（逐字节不变）。
  const alloc = cfg.quota
    ? allocateTier0QuotaPre(candidates, { maxTokens: cfg.maxTokens, estimateMode: cfg.estimateMode, quota: cfg.quota })
    : null
  if (alloc) {
    for (const rec of alloc.picked) picked.push(rec)
    text = alloc.text
    dropped = alloc.dropped
  } else {
    for (const rec of candidates) {
      const line = renderCatalogLinePre(rec)
      const next = text ? text + '\n' + line : line
      if (estimateTokensPre(next, { mode: cfg.estimateMode }) > cfg.maxTokens) {
        dropped++
        continue
      }
      picked.push(rec)
      text = next
    }
  }

  if (!picked.length) {
    // I7 精神：目录为空也必须显式发声，不许静默注入空串。
    text = skipped.length
      ? `[Tier-0 目录为空 · 跳过来源 ${skipped.length}]`
      : '[Tier-0 目录为空 · 无可渲染条目]'
  } else if (cfg.markTruncation && dropped > 0) {
    const mark = `…已裁剪 ${dropped} 条（低优先级）`
    if (estimateTokensPre(text + '\n' + mark, { mode: cfg.estimateMode }) <= cfg.maxTokens) {
      text = text + '\n' + mark
    }
  }

  return {
    text,
    items: picked.map(toPublicItemPre),
    tokens: estimateTokensPre(text, { mode: cfg.estimateMode }),
    maxTokens: cfg.maxTokens,
    estimateMode: cfg.estimateMode,
    tokenRepo: estimateTokensPre(text, { mode: 'repo' }),
    dropped,
    truncated: dropped > 0,
    units,
    droppedUnits,
    candidates: candidates.length,
    skipped,
    // C5 配额账（quota 关闭时 quota=null，键仍在，调用方无需判空取法）
    quota: alloc
      ? {
        applied: true,
        projectRatio: alloc.projectRatio,
        floorRatio: alloc.floorRatio,
        floorLayers: alloc.floorLayers,
        caps: alloc.caps,
        floors: alloc.floors,
        perLayer: alloc.perLayer,
        droppedByLayer: alloc.droppedByLayer,
        degradedLayers: alloc.degradedLayers,
        emptyLayers: alloc.emptyLayers,
      }
      : null,
  }
}

/**
 * 读文本文件（容错，永不抛错）。
 * @param {string} p
 * @param {{maxFileBytes?:number}} [opts]
 * @returns {{ok:boolean, text:string, path:string, reason:string}}
 */
export function readTextSafePre(p, opts = {}) {
  const maxBytes = Number((opts && opts.maxFileBytes) || TIER0_DEFAULTS.maxFileBytes) || TIER0_DEFAULTS.maxFileBytes
  const path = typeof p === 'string' ? p.trim() : ''
  const fail = (reason) => ({ ok: false, text: '', path, reason })
  if (!path) return fail('missing-path')
  let st = null
  try {
    st = statSync(path)
  } catch (e) {
    return fail(e && e.code === 'ENOENT' ? 'not-found' : 'stat-error')
  }
  try {
    if (st.isDirectory()) return fail('not-a-file')
    if (Number(st.size) > maxBytes) return fail('too-large')
  } catch (e) {
    return fail('stat-error')
  }
  try {
    const text = stripBom(readFileSync(path, 'utf8'))
    if (!text.trim()) return fail('empty')
    return { ok: true, text, path, reason: '' }
  } catch (e) {
    return fail('read-error')
  }
}

/**
 * Tier-0 目录生成器（主入口，含 IO）。四类路径**都可能不存在**，逐一路径容错并计数。
 *
 * @param {{userMemoryPath?:string, workspaceMemoryPath?:string, todayLogPath?:string,
 *          handoffPlanPath?:string, extraPaths?:Array<{path:string, layer:string}>, [k:string]:any}} input
 * @param {object} [opts] 同 buildTier0CatalogFromTextPre（另加 maxFileBytes）
 * @returns {ReturnType<typeof buildTier0CatalogFromTextPre>}
 */
export function buildTier0CatalogPre(input = {}, opts = {}) {
  const cfg = resolveOptsPre(opts)
  const src = input && typeof input === 'object' ? input : {}
  const sources = []
  const skipped = []

  for (const spec of SOURCE_SPECS) {
    const r = readTextSafePre(src[spec.key], cfg)
    if (!r.ok) {
      skipped.push({ layer: spec.layer, path: String(src[spec.key] == null ? '' : src[spec.key]), reason: r.reason })
      continue
    }
    sources.push({ layer: spec.layer, text: r.text, path: r.path })
  }

  // 扩展点（C5 接反思目录等）：显式给出 layer，避免路径猜层。
  const extra = Array.isArray(src.extraPaths) ? src.extraPaths : []
  for (const e of extra) {
    const layer = clean(e && e.layer)
    const r = readTextSafePre(e && e.path, cfg)
    if (!r.ok) {
      skipped.push({ layer, path: String((e && e.path) == null ? '' : e.path), reason: r.reason })
      continue
    }
    sources.push({ layer, text: r.text, path: r.path })
  }

  const out = buildTier0CatalogFromTextPre(sources, cfg)
  const merged = out.skipped.concat(skipped)
  // 目录为空时，空标记必须用**合并后**的跳过数重算（IO 层的跳过发生在纯函数之外）。
  if (!out.items.length) {
    const text = merged.length
      ? `[Tier-0 目录为空 · 跳过来源 ${merged.length}]`
      : '[Tier-0 目录为空 · 无可渲染条目]'
    return Object.assign({}, out, {
      text,
      tokens: estimateTokensPre(text, { mode: cfg.estimateMode }),
      tokenRepo: estimateTokensPre(text, { mode: 'repo' }),
      skipped: merged,
    })
  }
  return Object.assign({}, out, { skipped: merged })
}

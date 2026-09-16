/**
 * L0 抽取纯核心（l0_extract_v1）—— 分层语义唤回的地基。
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

export const L0_EXTRACT_VERSION = 'l0_extract_v1'

/** 锚点：`<!-- memory:mem_<32hex> -->`（允许空白浮动）。 */
const MEM_ANCHOR_RE = /<!--\s*memory:(mem_[0-9a-f]{32})\s*-->/g

/** 行首时间戳：`12:01 ` / `14:5x ` 等（日志条目惯例）。 */
const LEAD_TIME_RE = /^\s*\d{1,2}:\d{2}[a-z]?\s+/

/** 句末/句读分隔符（含中文）。 */
const SENTENCE_SPLIT_RE = /[。；;!！?？\n]/

/** 主题块标题后缀：`（12:02）` 或 `(12:02)`。 */
const HEADING_SUFFIX_RE = /\s*[（(]\s*\d{1,2}:\d{2}\s*[)）]\s*$/

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
export const L0_LAYER_VERSION = 'l0_layer_v1'

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

  // ① 主题块标题
  for (const line of lines) {
    const h = /^\s{0,3}#{1,6}\s+(.+?)\s*$/.exec(line)
    if (h) {
      const title = clean(h[1]).replace(HEADING_SUFFIX_RE, '')
      if (title) return { l0: cut(title, maxChars), source: 'heading' }
    }
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

  // ③ 兜底：正文截断
  const flat = clean(text.replace(/\s+/g, ' '))
  return { l0: cut(flat, maxChars), source: 'truncate' }
}

/**
 * 构建文件级 L0 索引（按 id 升序，确定性）。
 *
 * 2026-09-14（三层契约 C1）：每条**追加** `layer` + `status` 两个字段——只增不减，
 * 老调用方读 `id / l0 / source / chars / bodyChars` 完全不受影响，签名与调用方式不变。
 * 层归属：`opts.layer`（层名 / 路径 / 键名，经 classifyLayerPre）→ `opts.path` → `L0_DEFAULT_LAYER`。
 *
 * @param {string} text 文件内容
 * @param {{maxChars?:number, minChars?:number, layer?:string, path?:string}} [opts]
 * @returns {Array<{id:string, l0:string, source:string, chars:number, bodyChars:number, layer:string, status:string}>}
 */
export function buildL0IndexPre(text, opts = {}) {
  const { items } = parseMemoryItemsPre(text)
  const layer = resolveLayerPre(opts)
  const out = items.map((it) => {
    const r = extractL0Pre(it.body, opts)
    // TODO(C1 写入侧，未实现)：status 恒为 current。superseded（被新记录经 supersedes 替代改正）
    //   与 retracted（人工判定作废）需要**写入侧先落盘状态**（fact-store 的 supersedes 边 / 审计视图标记），
    //   本层不做存储、只负责透传；存储与双层过滤（契约 I5）在 C2 接线 + 写入侧一起做。
    const status = 'current'
    return {
      id: it.id, l0: r.l0, source: r.source, chars: r.l0.length, bodyChars: it.body.length,
      layer, status,
    }
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
  const flat = clean(full.replace(/\s+/g, ' '))
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

/**
 * 白板格式适配器（wb_contract_v1）—— 白板线拥有「白板格式及其适配器」。
 *
 * 2026-09-14 建立（P0 最小适配边界）。**边界（总纲 §0.5 / ROUND3 §3.1 定案）**：
 *   - **3.0 主体**拥有「共同提交与保护入口」= `lib/memory-mutation.js:validateMutationBoundaryPre`
 *     —— 它**只接收规范化投影**（`beforeIds/afterIds/protectedRegions/changes`），**不自行解释图格式**。
 *   - **白板线**拥有「白板格式及其适配器」= **本模块** `parseWhiteboardPre`
 *     —— 格式只维护一份（`docs/internal/WB-FORMAT-CONVENTION.md` 是规格源）。
 *   这样切的意义：写入门要保护**卡片集合**与**用户区**，而这两个概念由白板格式定义；
 *   没有适配器就是"接口接上了但保护失效"。
 *
 * **规格源**：`docs/internal/WB-FORMAT-CONVENTION.md`
 *   §2 锚点契约（每个卡片/小节标题行下方紧跟 `<!-- memory:mem_<32hex> -->`）；
 *   §5 人机分区（`<!-- model -->…<!-- /model -->` 与 `<!-- user -->…<!-- /user -->`，模型整篇重写
 *      必须原样带回 user 段）。**B4 预授权默认值**：从选项 (c) 起步 = 每张卡片分「模型维护区 / 用户备注区」。
 *   **A8 预授权默认值**：id = `mem_` + sha256(workspaceKey + '\u0000' + 页面相对路径 + '\u0000' + 卡片标题) 前 32 位。
 *
 * **现状缺口（2026-09-14 实测，这是本模块存在的直接理由）**：规范 §5 **早已定义**人机分区，
 * 但实际 `PLAN.md` **一个锚点、一个分区标记都没有** —— 规范已批准、代码从未实现。
 * 这正是「白板被整篇覆盖成骨架」事故的根因。
 *
 * **本模块只做解析，不做判定**：它产出规范化投影（卡 id 集合、用户区集合、状态、标题），
 * 由 `validateMutationBoundaryPre` 决定接受/拒绝。职责不混，是为了让"格式"只有一个真源。
 *
 * S9 合规：零 IO、纯函数、同输入同输出、无网络/无 LLM/无子进程/无 await。
 * UTF-8 无 BOM。
 */
import { createHash } from 'node:crypto'
// 账本四段判据复用既有解析器（`handoff-anchor.js` 是账本段结构的既有权威，不另写一份）
import { parseHandoffLedgerPre, HANDOFF_LEDGER_SECTION_WEIGHTS_V1 } from './handoff-anchor.js'

export const WB_CONTRACT_VERSION = 'wb_contract_v1'

/** 锚点正则（与 `l0-extract.js` 的 `MEM_ANCHOR_RE` 完全一致；契约 §2 要求"完全一致"）。 */
export const WB_ANCHOR_RE_V1 = /^<!--\s*memory:(mem_[0-9a-f]{32})\s*-->$/

/** 分区标记（契约 §5 逐字）。 */
export const WB_MARKERS_V1 = Object.freeze({
  modelOpen: '<!-- model -->',
  modelClose: '<!-- /model -->',
  userOpen: '<!-- user -->',
  userClose: '<!-- /user -->',
})

/** 卡片状态（与记忆条目状态同域；缺 `status` 视为 `current`，与 `isCurrentPre` 口径一致）。
 *  ⚠️ 2026-09-17 L7 存活标注: 本常量**当前无仓内消费者**(全仓引用计数 = 1, 仅此定义)。
 *  判定 = **对外契约保留**, 不删 —— 理由是它是 WB-FORMAT-CONVENTION 的**状态值域声明**
 *  (`current`/`superseded`/`retracted`), 属已发布插件 (@a9i5k4/dsh-auto-memory 3.0.0, 有真实用户)
 *  的公开导出面; 第三方按契约读取状态时需要它作为**单一真源**, 删掉等于把值域契约降级成散落字面量。
 *  ⇒ 保留 + 显式标注, 不做"沉默留着"。 */
export const WB_STATUSES_V1 = Object.freeze(['current', 'superseded', 'retracted'])

/** 解析/校验的原因码 → 可读中文。 */
export const WB_REASONS_V1 = Object.freeze({
  'not-string': '内容不是字符串',
  'empty': '内容为空',
  'no-card': '页面里没有任何卡片标题（`### ` 行）',
  'anchor-missing': '卡片标题下方缺少锚点行 `<!-- memory:mem_<32hex> -->`',
  'anchor-format': '锚点格式不合法（必须是 mem_ + 32 位小写十六进制）',
  'anchor-duplicate': '同一个 id 被两个卡片复用（契约 §2 禁止）',
  'anchor-mid-body': '锚点不在标题行下方紧跟位置（契约 §2 禁止把锚点写在卡片正文中间）',
  'user-region-unclosed': '`<!-- user -->` 未闭合',
  'model-region-unclosed': '`<!-- model -->` 未闭合',
  'user-region-interleaved': '人机分区标记交错（user 段里又开 model 段）',
})

/** 原因码 → 可读中文（未知码原样返回，排障不吞信息）。
 *  ⚠️ 2026-09-17 L7 存活标注: 本函数**当前无仓内调用者**(全仓引用计数 = 1, 仅此定义)。
 *  判定 = **对外契约保留**, 不删 —— 它是 `WB_REASONS_V1`(上文, **有消费者**) 的唯一
 *  取值入口; 删掉函数会让那份码表的"怎么读"离开公开面, 而码表本身是契约的一部分
 *  (发布版已有真实用户)。⇒ 保留 + 显式标注。 */
export function describeWbReasonPre(code) {
  const k = String(code == null ? '' : code)
  return WB_REASONS_V1[k] || k || '未知原因'
}

const isAnchor = (line) => WB_ANCHOR_RE_V1.test(String(line || '').replace(/\r$/, ''))
const anchorIdOf = (line) => {
  const m = WB_ANCHOR_RE_V1.exec(String(line || '').replace(/\r$/, ''))
  return m ? m[1] : ''
}
const isCardTitle = (line) => /^#{3,}\s+\S/.test(String(line || '').replace(/\r$/, ''))
const titleTextOf = (line) => String(line || '').replace(/\r$/, '').replace(/^#{3,}\s+/, '').trim()

/**
 * 内容寻址 id（契约 §2 / A8 预授权默认值）：
 * `mem_` + `sha256(workspaceKey + '\u0000' + 页面相对路径 + '\u0000' + 卡片标题)` 前 32 位十六进制。
 *
 * **不复算既有锚点**：本函数只用于"写新卡时该用什么 id"，以及测试验证"重排不变、改名即变"。
 * 已有锚点一律**照用**（复算会在标题被小改时把整卡换 id，那是白板线 P1 的 supersede 语义，不在 P0 范围）。
 *
 * @param {string} workspaceKey 工作区标识（canonicalize 后的形态由调用方决定，本函数只做拼接）
 * @param {string} pageRelPath 页面相对路径（如 `handoff/PLAN.md`）
 * @param {string} cardTitle 卡片标题（不含 `### ` 前缀）
 * @returns {string} `mem_<32hex>`
 */
export function computeWhiteboardCardIdPre(workspaceKey, pageRelPath, cardTitle) {
  const src = String(workspaceKey == null ? '' : workspaceKey) + '\u0000'
    + String(pageRelPath == null ? '' : pageRelPath) + '\u0000'
    + String(cardTitle == null ? '' : cardTitle)
  return 'mem_' + createHash('sha256').update(src).digest('hex').slice(0, 32)
}

/**
 * 解析白板页面 → **规范化投影**（供 `validateMutationBoundaryPre` 消费）。
 *
 * 返回结构刻意做成"通用投影"而不是"白板专有结构"：写入门不需要知道 `### ` 是什么，
 * 它只需要知道「有哪些卡片 id」「哪些区域是用户区」「每个卡片的标题与状态」。
 *
 * @param {string} text 页面全文（文件字节按 utf8 解出的字符串）
 * @param {object} [opts]
 * @param {string} [opts.kind] 'plan' | 'handoff' | 'other'（仅用于报告可读性与判据选择，不改变解析）
 * @returns {{ok:boolean, version:string, kind:string, cards:Array, cardIds:string[],
 *            userRegions:Array<{cardId:string, text:string, digest:string}>,
 *            modelRegions:Array<{cardId:string, text:string}>,
 *            issues:Array<{code:string, detail:string, line:number}>, counts:object}}
 */
export function parseWhiteboardPre(text, opts = {}) {
  const kind = String((opts && opts.kind) || 'plan')
  const issues = []
  if (typeof text !== 'string') {
    return emptyResult(kind, [{ code: 'not-string', detail: '输入类型 ' + typeof text, line: 0 }])
  }
  const raw = text.replace(/^\uFEFF/, '') // 防御：绝不因 BOM 让首行标题判不出来
  if (!raw.trim()) return emptyResult(kind, [{ code: 'empty', detail: '内容为空', line: 0 }])

  const lines = raw.split('\n')
  const cards = []
  const userRegions = []
  const modelRegions = []
  const seenIds = new Map() // id → 首次出现的行号（重复检测）
  let cur = null

  // 分区状态：null = 不在任何区；'model' | 'user' = 在当前卡片的哪个区
  let region = null
  let regionStart = 0
  let regionLines = []

  const closeRegion = () => {
    if (!region || !cur) { region = null; regionLines = []; return }
    const body = regionLines.join('\n')
    if (region === 'user') {
      userRegions.push({ cardId: cur.id || '', text: body, digest: shortDigest(body) })
    } else {
      modelRegions.push({ cardId: cur.id || '', text: body })
    }
    region = null
    regionLines = []
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const trimmed = line.replace(/\r$/, '')

    // ── 分区标记（先于一切判定：标记行本身既不是标题也不是内容） ──
    if (trimmed === WB_MARKERS_V1.userOpen) {
      if (region === 'user') issues.push({ code: 'user-region-interleaved', detail: '重复的 user 开始标记', line: i + 1 })
      if (region === 'model') closeRegion()
      if (!cur) issues.push({ code: 'user-region-unclosed', detail: 'user 段不在任何卡片内（契约 §5 要求每卡分区）', line: i + 1 })
      region = 'user'
      regionStart = i + 1
      regionLines = []
      continue
    }
    if (trimmed === WB_MARKERS_V1.userClose) {
      if (region !== 'user') issues.push({ code: 'user-region-unclosed', detail: 'user 结束标记没有对应的开始标记', line: i + 1 })
      else closeRegion()
      continue
    }
    if (trimmed === WB_MARKERS_V1.modelOpen) {
      if (region === 'user') issues.push({ code: 'user-region-interleaved', detail: 'user 段里又开了 model 段（契约 §5 禁止）', line: i + 1 })
      region = 'model'
      regionStart = i + 1
      regionLines = []
      continue
    }
    if (trimmed === WB_MARKERS_V1.modelClose) {
      if (region !== 'model') issues.push({ code: 'model-region-unclosed', detail: 'model 结束标记没有对应的开始标记', line: i + 1 })
      else closeRegion()
      continue
    }

    // ── 卡片标题 ──
    if (isCardTitle(trimmed)) {
      if (region) { closeRegion(); issues.push({ code: 'user-region-unclosed', detail: '新卡片开始前上一张卡的分区未闭合', line: i + 1 }) }
      cur = { id: '', title: titleTextOf(trimmed), titleLine: i + 1, anchorLine: 0, status: 'current', expectAnchor: true }
      cards.push(cur)
      continue
    }

    // ── 锚点行（必须在标题行下方**紧跟**的位置） ──
    if (isAnchor(trimmed)) {
      if (!cur) { issues.push({ code: 'anchor-mid-body', detail: '锚点不在任何卡片标题下方', line: i + 1 }); continue }
      if (i + 1 !== cur.titleLine + 1) {
        issues.push({ code: 'anchor-mid-body', detail: '锚点在标题行下方第 ' + (i + 1 - cur.titleLine) + ' 行（契约为紧跟下一行）', line: i + 1 })
      }
      const id = anchorIdOf(trimmed)
      if (seenIds.has(id)) {
        issues.push({ code: 'anchor-duplicate', detail: 'id ' + id + ' 已被第 ' + seenIds.get(id) + ' 行的卡片占用', line: i + 1 })
      } else seenIds.set(id, i + 1)
      cur.id = id
      cur.anchorLine = i + 1
      cur.expectAnchor = false
      continue
    }

    // ── 状态声明（`status=superseded` 这类；缺省 current，与 isCurrentPre 口径一致） ──
    const sm = /(?:^|\s)status\s*[=:]\s*(current|superseded|retracted)\b/i.exec(trimmed)
    if (sm && cur && !region) cur.status = sm[1].toLowerCase()

    if (region) regionLines.push(line)
  }
  if (region) {
    issues.push({
      code: region === 'user' ? 'user-region-unclosed' : 'model-region-unclosed',
      detail: '文件结束时分区仍未闭合（起始行 ' + regionStart + '）', line: lines.length,
    })
  }

  // ── 逐卡检查：缺锚点 / 锚点格式 ──
  if (!cards.length) {
    // 空页面不算"缺卡"事故（首建白板是合法路径）；但**有内容却一张卡都没有**要报出来
    if (raw.trim()) issues.push({ code: 'no-card', detail: '页面有内容但没有任何 `### ` 卡片标题', line: 0 })
  } else {
    for (const c of cards) {
      if (!c.id) issues.push({ code: 'anchor-missing', detail: '卡片「' + c.title + '」缺锚点行', line: c.titleLine })
    }
  }

  const cardIds = cards.map((c) => c.id).filter(Boolean)
  return {
    ok: issues.length === 0,
    version: WB_CONTRACT_VERSION,
    kind,
    cards: cards.map((c) => ({
      id: c.id, title: c.title, status: c.status,
      titleLine: c.titleLine, anchorLine: c.anchorLine,
      hasUserRegion: userRegions.some((u) => u.cardId && u.cardId === c.id),
      hasModelRegion: modelRegions.some((m) => m.cardId && m.cardId === c.id),
    })),
    cardIds,
    userRegions,
    modelRegions,
    issues,
    counts: {
      cards: cards.length,
      anchored: cardIds.length,
      unanchored: cards.length - cardIds.length,
      userRegions: userRegions.length,
      modelRegions: modelRegions.length,
      lines: lines.length,
    },
  }
}

const shortDigest = (s) => createHash('sha256').update(String(s == null ? '' : s)).digest('hex').slice(0, 16)

function emptyResult(kind, issues) {
  return {
    ok: false, version: WB_CONTRACT_VERSION, kind,
    cards: [], cardIds: [], userRegions: [], modelRegions: [], issues,
    counts: { cards: 0, anchored: 0, unanchored: 0, userRegions: 0, modelRegions: 0, lines: 0 },
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// ★M2（2026-09-18）白板 lint —— 契约 §6「零 token 可判的四类」
//
// **硬约束（契约 §6 尾注，不可越）**：lint **只报告，不自动改**。
//   「任何自动修正都会把白板变成状态机（违反边界）」
// ⇒ 本模块是**纯函数**：不读文件、不写文件、不 import fs。
//   输入什么就判什么，输出问题清单。任何写盘能力都不得塞进这里（报告与写入分离）。
//
// 四类判据（§6 原文）与**本实现的口径**（判据纪律：宁可漏判，不可误伤）：
//   ① 孤立条目：无入站引用            → 全部卡正文里都找不到它的 id/标题
//   ② 陈旧：status≠current 或超期 current → 状态直读 + 与 now 比日期
//   ③ 被提及却无独立卡               → ★ 只判**客观可证**的一种：正文引用了
//      `mem_<32hex>` 但该 id 没有对应卡片（"什么算概念"无法零 token 判定，不猜）
//   ④ 缺交叉引用                    → ★ 只判**客观可证**的一种：两卡共享 ≥N 个 tag
//      却互不引用（"什么算相关"由 tag 交集代言，不猜语义）
//   ⑤ 矛盾检测 → 需 LLM，**不在本模块**（契约 §6：必须手动触发，不进自动路径）
// ─────────────────────────────────────────────────────────────────────────────

export const WB_LINT_VERSION = 'wb_lint_v1'

/** lint 问题码（§6 四类；⑤ 矛盾检测需 LLM，不在此列）。 */
export const WB_LINT_CODES_V1 = Object.freeze({
  ORPHAN: 'orphan',                   // ① 孤立条目
  INACTIVE: 'inactive',               // ② 陈旧（已标 superseded/retracted）
  EXPIRED: 'expired',                 // ② 陈旧（仍标 current 但超阈值）
  DANGLING_REF: 'dangling-ref',       // ③ 被引用却无卡（悬空锚点引用）
  NO_CROSS_REF: 'no-cross-ref',       // ④ 缺交叉引用（共享 tag 却互不引用）
})

/** 默认口径。 */
export const WB_LINT_DEFAULTS_V1 = Object.freeze({
  staleDays: 90,      // ② 仍标 current 但日期早于 now-90d ⇒ 报 expired
  minSharedTags: 2,   // ④ 共享 tag 数 ≥ 2 才算"应互链"
})

const LINT_ANCHOR_RE = /mem_[0-9a-f]{32}/g

const asDateMs = (v) => {
  const s = String(v == null ? '' : v)
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (!m) return NaN
  const t = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
  return Number.isFinite(t) ? t : NaN
}

/**
 * 白板 lint（**只读纯函数**，契约 §6）。
 *
 * @param {Array<object>|{entries?:Array<object>}} entries 条目数组；每项可含
 *   `{id, title, status, date, ts, tags, body}`。`body` 为该卡正文（用于扫描引用）；
 *   缺 `body` 时退化为用 `title+id` 判引用（**不报错**——信息少就少判，不猜）。
 * @param {{now?:Date|string|number, staleDays?:number, minSharedTags?:number, corpus?:string}} [opts]
 *   `corpus` 为白板之外的**额外文本**（如项目笔记/账本全文），一并参与"入站引用"扫描。
 * @returns {{version:string, ok:boolean, findings:Array<object>, counts:object}}
 */
export function lintWhiteboardPre(entries, opts = {}) {
  const o = opts && typeof opts === 'object' ? opts : {}
  const list = Array.isArray(entries) ? entries
    : (entries && Array.isArray(entries.entries) ? entries.entries : [])
  const staleDays = Number.isFinite(Number(o.staleDays)) ? Number(o.staleDays) : WB_LINT_DEFAULTS_V1.staleDays
  const minSharedTags = Number.isFinite(Number(o.minSharedTags)) ? Number(o.minSharedTags) : WB_LINT_DEFAULTS_V1.minSharedTags

  const nowMs0 = o.now instanceof Date ? o.now.getTime()
    : (typeof o.now === 'number' ? o.now : asDateMs(o.now))
  const nowMs = Number.isFinite(nowMs0) ? nowMs0 : Date.now()

  // ── 归一化（**永不抛**：坏条目降级为跳过，不打断整轮 lint）──
  const cards = []
  let skipped = 0
  for (const e of list) {
    if (!e || typeof e !== 'object') { skipped++; continue }
    const id = String(e.id || '')
    const title = String(e.title || '').trim()
    if (!id && !title) { skipped++; continue }
    const status = String(e.status || 'current').trim() || 'current'
    const dateSrc = e.date || e.ts || ''
    const tags = Array.isArray(e.tags) ? e.tags.map((t) => String(t)).filter(Boolean) : []
    cards.push({ id, title, status, tags, dateMs: asDateMs(dateSrc), dateRaw: String(dateSrc || '') })
  }

  // ── 引用语料：所有卡正文 + 外部 corpus ──
  const parts = []
  for (const e of list) {
    if (e && typeof e === 'object') {
      if (e.body != null) parts.push(String(e.body))
      if (e.preview != null) parts.push(String(e.preview))
    }
  }
  if (o.corpus != null) parts.push(String(o.corpus))
  const haystack = parts.join('\n')

  const findings = []
  const push = (code, card, detail) => {
    findings.push({ code, id: card ? card.id : '', title: card ? card.title : '', detail })
  }

  // ── ① 孤立条目：无入站引用 ──
  // 判据：除自己以外，任何卡正文/外部语料都未出现它的 id，也未出现它的标题。
  // 纪律：**只报"全无提及"**；标题过短（<2 字符）时跳过，避免单字误命中（宁可漏判）。
  for (const c of cards) {
    let referenced = false
    if (c.id) {
      const re = new RegExp(c.id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')
      const hits = haystack.match(re)
      // 自己正文里出现自己的 id 不算入站引用
      const selfBody = String((list.find((x) => x && x.id === c.id) || {}).body || '')
      const selfHits = selfBody.match(re)
      const inHits = (hits ? hits.length : 0) - (selfHits ? selfHits.length : 0)
      if (inHits > 0) referenced = true
    }
    if (!referenced && c.title && c.title.length >= 2) {
      if (haystack.includes(c.title)) {
        // 标题出现次数 > 自身正文里的次数 ⇒ 有外部提及
        const selfBody = String((list.find((x) => x && x.id === c.id) || {}).body || '')
        const total = haystack.split(c.title).length - 1
        const selfN = selfBody.split(c.title).length - 1
        if (total - selfN > 0) referenced = true
      }
    }
    if (!referenced) push(WB_LINT_CODES_V1.ORPHAN, c, '无任何其他卡片或语料引用它的 id/标题')
  }

  // ── ② 陈旧 ──
  const cutoff = nowMs - staleDays * 86400000
  for (const c of cards) {
    if (c.status !== 'current') {
      push(WB_LINT_CODES_V1.INACTIVE, c, 'status=' + c.status + '（已作废，仍在白板内）')
      continue
    }
    if (Number.isFinite(c.dateMs) && c.dateMs < cutoff) {
      const ageDays = Math.floor((nowMs - c.dateMs) / 86400000)
      push(WB_LINT_CODES_V1.EXPIRED, c, '仍标 current 但日期为 ' + c.dateRaw + '（' + ageDays + ' 天前，超阈值 ' + staleDays + ' 天）')
    }
  }

  // ── ③ 悬空锚点引用：正文引用了 mem_id 但没有对应卡片 ──
  // 契约 §2 的 id 是"内容寻址、可复算"的 ⇒ 引用了不存在的 id 是**客观可证**的断裂。
  const knownIds = new Set(cards.map((c) => c.id).filter(Boolean))
  const allIds = new Set()
  for (const m of haystack.match(LINT_ANCHOR_RE) || []) allIds.add(m)
  for (const id of allIds) {
    if (!knownIds.has(id)) {
      findings.push({
        code: WB_LINT_CODES_V1.DANGLING_REF, id, title: '',
        detail: '正文引用了 ' + id + '，但白板内没有该 id 的卡片（悬空引用）',
      })
    }
  }

  // ── ④ 缺交叉引用：共享 ≥minSharedTags 个 tag 却互不引用 ──
  for (let i = 0; i < cards.length; i++) {
    for (let j = i + 1; j < cards.length; j++) {
      const a = cards[i], b = cards[j]
      if (!a.tags.length || !b.tags.length) continue
      const shared = a.tags.filter((t) => b.tags.includes(t))
      if (shared.length < minSharedTags) continue
      const aRefB = (a.id && b.id && String((list.find((x) => x && x.id === a.id) || {}).body || '').includes(b.id)) ||
        (b.title && String((list.find((x) => x && x.id === a.id) || {}).body || '').includes(b.title))
      const bRefA = (a.id && b.id && String((list.find((x) => x && x.id === b.id) || {}).body || '').includes(a.id)) ||
        (a.title && String((list.find((x) => x && x.id === b.id) || {}).body || '').includes(a.title))
      if (!aRefB && !bRefA) {
        findings.push({
          code: WB_LINT_CODES_V1.NO_CROSS_REF, id: a.id, title: a.title,
          detail: '与「' + (b.title || b.id) + '」共享 ' + shared.length + ' 个 tag（' + shared.join(', ') + '）但互不引用',
        })
      }
    }
  }

  const byCode = {}
  for (const f of findings) byCode[f.code] = (byCode[f.code] || 0) + 1

  return {
    version: WB_LINT_VERSION,
    ok: findings.length === 0,
    findings,
    counts: {
      cards: cards.length,
      skipped,
      findings: findings.length,
      byCode,
      // ⑤ 明确声明"未判" —— 不许静默省略（契约 §6：需 LLM，必须手动触发）
      notChecked: ['contradiction'],
    },
  }
}

/**
 * 从投影里抽出"**必须逐字节保留**的用户区"（供写入门做前后比对）。
 *
 * 只返回**有 cardId 的用户区**：没有 cardId 的用户区无法与卡片对应，
 * 其"是否被保留"无从判定（那属于 lint/格式问题，不是写入门能拦的丢卡问题）。
 *
 * @param {object} projection `parseWhiteboardPre` 的返回值
 * @returns {Array<{key:string, digest:string, chars:number, cardId:string}>}
 */
export function extractProtectedRegionsPre(projection) {
  const p = projection && typeof projection === 'object' ? projection : {}
  const out = []
  for (const u of Array.isArray(p.userRegions) ? p.userRegions : []) {
    const cardId = String((u && u.cardId) || '')
    if (!cardId) continue
    out.push({
      key: 'user:' + cardId,
      cardId,
      digest: String((u && u.digest) || shortDigest(u && u.text)),
      chars: String((u && u.text) || '').length,
    })
  }
  return out
}

/**
 * 把白板投影适配成写入门要的**规范化投影**（`{beforeIds, afterIds, protectedRegions}`）。
 *
 * @param {object} projection `parseWhiteboardPre` 的返回值
 * @returns {{beforeIds?:string[], afterIds?:string[], protectedRegions:Array, cards:Array, issues:Array}}
 */
export function toMutationProjectionPre(projection) {
  const p = projection && typeof projection === 'object' ? projection : {}
  return {
    afterIds: Array.isArray(p.cardIds) ? p.cardIds.slice() : [],
    protectedRegions: extractProtectedRegionsPre(p),
    cards: Array.isArray(p.cards) ? p.cards : [],
    issues: Array.isArray(p.issues) ? p.issues : [],
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// 判据门（criteria gate）—— 账本用 H1–H4/S1–S4；PLAN 用 P-H1/P-H2/P-S1
//
// ⚠️ **判据不能张冠李戴**（v2 修正，务必遵守；`ROUND3 §2.2` 把我方原写法判为实质错误）：
//   H1–H4/S1–S4 是**交接账本**的判据；PLAN 是自由全貌文档（节名不固定，P7 老化按标题分类），
//   其判据**刻意保持最弱** = P-H1/P-H2/P-S1。把账本判据套给 PLAN 会误拒合法白板。
//
// **与共同保护的关系**（ROUND3 §3.7 第 4 条）：本判据门是**可选质量门**，
// `criteriaGate=false` 只退掉它；**丢卡 / 用户区 / 重复 id 三条保护在
// `memory-mutation.js` 里，无条件生效**，任何开关都绕不过。
// ═══════════════════════════════════════════════════════════════════════════

export const CRITERIA_GATE_VERSION = 'wb_criteria_v1'

/** 账本四段标题（逐字匹配；与 `handoff-anchor.js` 的权重表同源，不另写一份）。 */
export const HANDOFF_REQUIRED_SECTIONS_V1 = Object.freeze(
  HANDOFF_LEDGER_SECTION_WEIGHTS_V1.map((x) => x.title),
)

/** 占位符黑名单（H3）：段 body 只含这些即视为未填写。 */
export const CRITERIA_PLACEHOLDERS_V1 = Object.freeze(['(待补充)', '（待补充）', 'todo', '同上', '略', 'n/a', '待补充'])

/** 账本/白板判据的阈值（与 `sanitizeForWrite` 上限同源，先于它执行以免双重截断语义混乱）。 */
export const CRITERIA_LIMITS_V1 = Object.freeze({
  handoffMaxChars: 8000,
  planMaxChars: 200000,
  sectionMinChars: 20,
  sectionMaxLines: 5,
})

const PLACEHOLDER_SET = new Set(CRITERIA_PLACEHOLDERS_V1.map((x) => x.toLowerCase()))

/** 段 body 的"实质内容"行（去空行、去纯占位行）。 */
function bodyRealLines(body) {
  return (Array.isArray(body) ? body : [])
    .map((l) => String(l == null ? '' : l).trim())
    .filter((l) => l && !PLACEHOLDER_SET.has(l.toLowerCase()))
}

/**
 * 交接账本判据（H1–H4 硬；S1–S4 软）。**纯函数、零 IO**。
 *
 * @param {string} text 账本全文（写入函数会自带 `# 交接账本 · <日期> <时间>` 标题行，故解析 preamble 非空）
 * @returns {{ok:boolean, version:string, target:'handoff', hardPass:boolean,
 *            hard:Array, soft:Array, report:object}}
 */
export function checkHandoffCriteriaPre(text) {
  const src = typeof text === 'string' ? text : ''
  const parsed = parseHandoffLedgerPre(src)
  const hard = []
  const soft = []

  // H1 四段标题齐全且逐字匹配
  const gotTitles = parsed ? parsed.sections.map((s) => String(s.title).replace(/\r$/, '').replace(/^##\s+/, '').trim()) : []
  const missing = HANDOFF_REQUIRED_SECTIONS_V1.filter((t) => !gotTitles.includes(t))
  hard.push({
    id: 'H1', pass: missing.length === 0, missing: missing.slice(),
    detail: missing.length
      ? '缺少或标题不逐字匹配的四段标题：' + missing.join('、') + '（标题错会让权重化截断失效并让注入端解析失败）'
      : '四段标题齐全且逐字匹配',
  })

  // H2 每段 body 非空（≥1 非空行且合计 ≥20 字符）
  const thinSections = []
  if (parsed) {
    for (const s of parsed.sections) {
      const name = String(s.title).replace(/\r$/, '').replace(/^##\s+/, '').trim()
      if (!HANDOFF_REQUIRED_SECTIONS_V1.includes(name)) continue
      const real = bodyRealLines(s.body)
      const chars = real.join('').length
      if (!real.length || chars < CRITERIA_LIMITS_V1.sectionMinChars) thinSections.push(name + '(' + chars + ' 字符)')
    }
  } else {
    thinSections.push('(无法解析出任何段)')
  }
  hard.push({
    id: 'H2', pass: thinSections.length === 0, missing: thinSections.slice(),
    detail: thinSections.length
      ? '这些段为空或少于 ' + CRITERIA_LIMITS_V1.sectionMinChars + ' 字符：' + thinSections.join('、')
      : '四段 body 均非空且达到最小长度',
  })

  // H3 无占位符行
  const placeholderHits = []
  if (parsed) {
    for (const s of parsed.sections) {
      const name = String(s.title).replace(/\r$/, '').replace(/^##\s+/, '').trim()
      const real = bodyRealLines(s.body)
      const allBody = (Array.isArray(s.body) ? s.body : []).map((l) => String(l == null ? '' : l).trim()).filter(Boolean)
      if (allBody.length && !real.length) placeholderHits.push(name)
    }
  }
  hard.push({
    id: 'H3', pass: placeholderHits.length === 0, missing: placeholderHits.slice(),
    detail: placeholderHits.length
      ? '这些段的正文只有占位符（' + CRITERIA_PLACEHOLDERS_V1.slice(0, 4).join('/') + ' 等）：' + placeholderHits.join('、')
      : '无纯占位符段',
  })

  // H4 总长 ≤ 8000
  hard.push({
    id: 'H4', pass: src.length <= CRITERIA_LIMITS_V1.handoffMaxChars, missing: [],
    detail: '总长 ' + src.length + ' 字符（上限 ' + CRITERIA_LIMITS_V1.handoffMaxChars + '）',
  })

  // S1 每段 ≤5 行（软·警告；prompt 纪律既有约定）
  const longSections = []
  if (parsed) {
    for (const s of parsed.sections) {
      const name = String(s.title).replace(/\r$/, '').replace(/^##\s+/, '').trim()
      if (!HANDOFF_REQUIRED_SECTIONS_V1.includes(name)) continue
      const n = bodyRealLines(s.body).length
      if (n > CRITERIA_LIMITS_V1.sectionMaxLines) longSections.push(name + '(' + n + ' 行)')
    }
  }
  soft.push({ id: 'S1', pass: longSections.length === 0, detail: longSections.length ? '超过 5 行的段：' + longSections.join('、') : '各段均 ≤5 行' })

  // S2「已试方案与失败原因」写成「方案→失败原因」且保留报错关键词
  const failSec = parsed ? parsed.sections.find((s) => String(s.title).replace(/\r$/, '').replace(/^##\s+/, '').trim() === '已试方案与失败原因') : null
  const failBody = failSec ? bodyRealLines(failSec.body).join('\n') : ''
  const hexArrow = /→|->|⇒/.test(failBody)
  const errWord = /失败|报错|错误|回滚|error|fail|bug/i.test(failBody)
  soft.push({
    id: 'S2', pass: hexArrow && errWord,
    detail: (hexArrow ? '' : '缺「方案→失败原因」箭头；') + (errWord ? '' : '缺关键报错词；') || '失败项格式良好',
  })

  // S3「进度与下一步」含可执行特征（路径分隔符 / 反引号代码 / 命令动词）
  const nextSec = parsed ? parsed.sections.find((s) => String(s.title).replace(/\r$/, '').replace(/^##\s+/, '').trim() === '进度与下一步') : null
  const nextBody = nextSec ? bodyRealLines(nextSec.body).join('\n') : ''
  const execish = /[\\/][\w.-]+|`[^`]+`|\bnode\b|\bnpm\b|\bgit\b|\brun\b|执行|运行|命令/i.test(nextBody)
  soft.push({ id: 'S3', pass: execish, detail: execish ? '下一步含可执行特征' : '下一步看不出可直接执行的第一步（软提示）' })

  // S4 无临时信息（低置信启发，仅 diag）
  const tempish = /临时路径|tmp\\|\\\\tmp|搜索结果[:：]|console\.log\(/i.test(src)
  soft.push({ id: 'S4', pass: !tempish, detail: tempish ? '疑似含临时信息（低置信，仅诊断）' : '未见明显临时信息' })

  return {
    ok: hard.every((h) => h.pass), version: CRITERIA_GATE_VERSION, target: 'handoff',
    hardPass: hard.every((h) => h.pass), hard, soft,
    report: { chars: src.length, sections: gotTitles.length, requiredSections: HANDOFF_REQUIRED_SECTIONS_V1.length },
  }
}

/**
 * 白板 PLAN 判据（P-H1/P-H2 硬；P-S1 软）。**刻意保持最弱**（v2 修正）。
 *
 * P-H1 至少一个非空 `## ` 顶层节（与 P7 老化的节切分逻辑一致）—— 防"全部节被老化走"的空白板；
 * P-H2 ≤ 200000 字符；P-S1 含至少一处前瞻内容（软）。
 *
 * @param {string} text 白板全文
 * @param {object} [projection] 已有的 `parseWhiteboardPre` 结果（省略则只看文本，不看卡片）
 */
export function checkPlanCriteriaPre(text, projection) {
  const src = typeof text === 'string' ? text : ''
  const hard = []
  const soft = []
  // 与 P7 老化同一口径：按 `## ` 切顶层节（`### ` 不算顶层节）
  const sections = src.split(/(?=^## )/m).filter((s) => /^## /.test(s))
  const nonEmpty = sections.filter((s) => {
    const body = s.split('\n').slice(1).join('\n').trim()
    return body.length >= CRITERIA_LIMITS_V1.sectionMinChars
  })
  hard.push({
    id: 'P-H1', pass: nonEmpty.length >= 1, missing: nonEmpty.length ? [] : ['(无非空 ## 顶层节)'],
    detail: nonEmpty.length
      ? '有 ' + nonEmpty.length + ' 个非空顶层节（共 ' + sections.length + ' 个）'
      : '没有任何非空 `## ` 顶层节（' + CRITERIA_LIMITS_V1.sectionMinChars + ' 字符以上）—— 这是"白板被整篇覆盖成骨架/空白板"的形态',
  })
  hard.push({
    id: 'P-H2', pass: src.length <= CRITERIA_LIMITS_V1.planMaxChars, missing: [],
    detail: '总长 ' + src.length + ' 字符（上限 ' + CRITERIA_LIMITS_V1.planMaxChars + '）',
  })
  const forward = /下一步|待办|计划|todo/i.test(src)
  soft.push({ id: 'P-S1', pass: forward, detail: forward ? '含前瞻内容' : '未见前瞻内容（下一步/待办/计划）—— 软提示，不拦截' })

  // 卡片情况只作**报告**，不作 PLAN 硬判据（P0 既有白板没有锚点，硬判会立刻误拒所有现存白板）。
  // 锚点完备性属白板线 P1/P2，不在此拦截。
  const cards = projection && Array.isArray(projection.cards) ? projection.cards : null
  return {
    ok: hard.every((h) => h.pass), version: CRITERIA_GATE_VERSION, target: 'plan',
    hardPass: hard.every((h) => h.pass), hard, soft,
    report: {
      chars: src.length, sections: sections.length, nonEmptySections: nonEmpty.length,
      cards: cards ? cards.length : null, anchored: projection ? (projection.cardIds || []).length : null,
    },
  }
}

/** 判据报告 → 给模型的可执行拒绝文案（缺什么、哪段空、占位符原文，逐条列出）。 */
export function criteriaRefusalTextPre(res) {
  const r = res && typeof res === 'object' ? res : {}
  const failed = (Array.isArray(r.hard) ? r.hard : []).filter((h) => !h.pass)
  if (!failed.length) return ''
  return '写入被判据门拦截（' + failed.map((h) => h.id).join('/') + '），原文件未改动：\n'
    + failed.map((h) => '· [' + h.id + '] ' + h.detail).join('\n')
    + '\n请补齐后重试。'
}

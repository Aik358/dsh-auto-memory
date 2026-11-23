/**
 * event-regroup-scan.js —— ★R2（2026-10-27）：**只读扫描 + AI 输入构造**。
 *
 * 与 event-regroup.js 的分工：
 *   · event-regroup.js   = **纯函数**（零 IO）
 *   · 本模块             = **只读 IO**（遍历工作区 / 读账本）+ 构造 AI prompt 文本
 *
 * ★本模块**绝不写盘**。所有落盘动作在 R6（applyRegroupPre，需人审 + 令牌）。
 */

import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import { scanUnarchivedLedgersPre, splitLedgerSectionsPre } from './event-plan.js'
import { suggestEventNamePre } from './event-regroup.js'

/** 单工作区账本上限（防御性：避免异常工作区拖垮整轮扫描）。 */
export const MAX_LEDGERS_PER_WS = 2000

/** AI 每批最多喂多少个账本（用户裁定 Q2 的施工默认值，可被 R3 覆盖）。 */
export const DEFAULT_BATCH_SIZE = 40

/** 每篇账本投喂给 AI 的「目标段 + 结果段」字符上限（决策 B：L2 层）。 */
export const LEDGER_EXCERPT_CHARS = 600
/**
 * 遍历 **所有工作区**，收集「有账本的工作区」及其账本元数据。**只读**。
 *
 * ★为什么必须跨工作区（用户裁定 Q6）：upgrade 不只是当前工作区的事，
 *   本机实测 591 + 71 + 16 篇分散在 3 个工作区。只做当前工作区会留下断层。
 *
 * @param {{workspacesRoot:string, withExcerpt?:boolean, maxLedgersPerWs?:number}} opts
 * @returns {Promise<{workspaces:Array, totals:object}>}
 */
export async function scanAllWorkspacesPre(opts = {}) {
  const root = String(opts.workspacesRoot || '')
  if (!root) throw new Error('scanAllWorkspacesPre: 缺 workspacesRoot')
  const maxPer = Number(opts.maxLedgersPerWs) > 0 ? Math.floor(Number(opts.maxLedgersPerWs)) : MAX_LEDGERS_PER_WS

  let entries = []
  try { entries = await readdir(root, { withFileTypes: true }) } catch (e) {
    if (e && e.code === 'ENOENT') return { workspaces: [], totals: { workspaces: 0, withLedgers: 0, ledgers: 0, bytes: 0, existingEvents: 0 } }
    throw e
  }
  const dirs = entries.filter((d) => d && d.isDirectory()).map((d) => d.name).sort()

  const workspaces = []
  let totalLedgers = 0
  let withLedgers = 0

  for (const name of dirs) {
    const handoffDir = path.join(root, name, 'handoff')
    let scan = null
    try {
      scan = await scanUnarchivedLedgersPre({ dir: handoffDir, maxFiles: maxPer, withText: false })
    } catch (_) { continue }
    if (!scan || !scan.total) continue
    withLedgers++
    totalLedgers += scan.total

    // 事件库现状（只读；不存在 ⇒ 0）
    let eventCount = 0
    try {
      const raw = await readFile(path.join(handoffDir, 'event-store.json'), 'utf8')
      const store = JSON.parse(raw)
      eventCount = Array.isArray(store && store.events) ? store.events.length : 0
    } catch (_) { eventCount = 0 }

    const ledgers = []
    for (const l of scan.ledgers) {
      const rec = { name: l.name, mtime: l.mtime, bytes: l.bytes }
      if (opts.withExcerpt) {
        try {
          const text = await readFile(path.join(handoffDir, l.name), 'utf8')
          const secs = splitLedgerSectionsPre(String(text))
          rec.excerpt = buildExcerptPre(secs, text)
          rec.suggestName = suggestEventNamePre({ name: l.name, text: String(text) })
        } catch (_) { rec.excerpt = '' }
      }
      ledgers.push(rec)
    }

    workspaces.push({
      id: name,
      handoffDir,
      ledgerCount: scan.total,
      eventCount,
      ledgerBytes: ledgers.reduce((a, x) => a + (Number(x.bytes) || 0), 0),
      ledgers,
    })
  }

  return {
    workspaces,
    totals: {
      workspaces: dirs.length,
      withLedgers,
      ledgers: totalLedgers,
      bytes: workspaces.reduce((a, w) => a + w.ledgerBytes, 0),
      existingEvents: workspaces.reduce((a, w) => a + w.eventCount, 0),
    },
  }
}
/**
 * 从四段里取「目标 + 结果」作为投喂摘要（决策 B 的 L2 层，~600 字）。
 *
 * ★为什么只取这两段：AI 判断「这是哪件事」主要靠**目标**；
 *   判断「做完了没」靠**结果**。任务状态/下一步信息量低且重复，不投喂以省 token。
 */
export function buildExcerptPre(sections, fallbackText) {
  const s = (sections && typeof sections === 'object') ? sections : {}
  const pick = (k) => String(s[k] || '').replace(/\s+/g, ' ').trim()
  const goal = pick('goal')
  const outcome = pick('outcome') || pick('result') || pick('deadend')
  const parts = []
  if (goal) parts.push('目标: ' + goal)
  if (outcome) parts.push('结果: ' + outcome)
  let out = parts.join(' / ')
  if (!out) out = String(fallbackText || '').replace(/\s+/g, ' ').trim().slice(0, LEDGER_EXCERPT_CHARS)
  return out.slice(0, LEDGER_EXCERPT_CHARS)
}

/**
 * 把扫描结果**分批**，每批 ≤batchSize 篇（用户裁定 Q2：先 40 篇小样本验证质量）。
 *
 * ★为什么不一次全喂：本机实测 591 篇 × 600 字 ≈ 35 万字 ≈ 50 万 token，单次装不下。
 */
export function batchLedgersPre(workspaces, opts = {}) {
  const size = Number(opts.batchSize) > 0 ? Math.floor(Number(opts.batchSize)) : DEFAULT_BATCH_SIZE
  const maxBatches = Number(opts.maxBatches) > 0 ? Math.floor(Number(opts.maxBatches)) : Infinity
  const batches = []
  const list = Array.isArray(workspaces) ? workspaces : []
  for (const ws of list) {
    const ledgers = Array.isArray(ws && ws.ledgers) ? ws.ledgers.slice() : []
    // 按 mtime 升序（时间线顺序：AI 判断「同一件事」时时间连续性是关键信号）
    ledgers.sort((a, b) => (Number(a.mtime) || 0) - (Number(b.mtime) || 0))
    for (let i = 0; i < ledgers.length; i += size) {
      if (batches.length >= maxBatches) return batches
      batches.push({
        index: batches.length,
        workspaceId: String(ws.id || ''),
        ledgers: ledgers.slice(i, i + size),
      })
    }
  }
  return batches
}

/** AI 判定「一件事」的边界判据（用户裁定 Q3 + 补充）。 */
export const EVENT_BOUNDARY_RULES = Object.freeze([
  '一件事 = 一个连贯的目标从提出到达成/放弃的完整过程。',
  '① 目标相同或演进关系（如「修 bug」→「该 bug 的复查修复」）⇒ 同一件事。',
  '② 时间连续且中间无其他目标插入 ⇒ 同一件事。',
  '③ ★同一目标中断多日后被重新拾起 ⇒ **仍算同一件事**（用户 2026-10-26 明确裁定）。',
  '④ 产物归属相同（同一 commit / PR / tag）⇒ 同一件事。',
  '⑤ 目标不同（哪怕同一天）、或用户明确切换了话题 ⇒ **两个事件**。',
  '⑥ 反例：同一会话同一天但目标不同（如「注入截流」与「事件串行化」）⇒ 两个事件。',
])
/**
 * 构造给子代理的**单批** prompt（纯字符串拼装，不发请求）。
 *
 * ★设计要点：
 *   ① 每批都带**完整判据**（防分批口径漂移，方案风险 1）
 *   ② 每批都带**已有事件清单**（AI 才能判断「并入已有」还是「新建」）
 *   ③ 机械建议**只作参考**，prompt 里明确写「你可以全部推翻」
 *   ④ 末尾强制要求 JSON 输出（R3 解析用）
 */
export function buildRegroupPromptPre(p = {}) {
  const o = p && typeof p === 'object' ? p : {}
  const ledgers = Array.isArray(o.ledgers) ? o.ledgers : []
  const existing = Array.isArray(o.existingEvents) ? o.existingEvents : []
  const suggestions = Array.isArray(o.suggestions) ? o.suggestions : []
  const idx = Number(o.batchIndex) || 0
  const total = Number(o.batchTotal) || 1

  const L = []
  L.push('你是记忆整理助手。任务：把一批「工作交接账本」重新归类成**事件**（一件事一个容器）。')
  L.push('')
  L.push('## 背景（必读）')
  L.push('旧版记忆是「流水账」：每做完一段工作就写一篇 handoff 账本，篇与篇之间没有语义关联。')
  L.push('新版记忆是「事件中心」：一个事件 = 一件事从开始到结束的全部过程，可以包含多篇账本。')
  L.push('你的工作就是**判断哪些账本属于同一件事**，并给每个事件起一个人类可读的名字。')
  L.push('')
  L.push('## 事件边界判据（严格遵守，不要自己另立标准）')
  for (const r of EVENT_BOUNDARY_RULES) L.push('- ' + r)
  L.push('')
  L.push('## 事件命名要求（不合格会被拒绝）')
  L.push('- 4–60 字，必须能一句话说清「这是什么工作」')
  L.push('- **不得包含 HTML 注释标记** —— 这是旧版的错误做法')
  L.push('- 不得以 markdown 标记开头（# - * > 等）')
  L.push('- 不得使用占位名（未命名 / untitled / TODO）')
  L.push('- 中文优先，动宾结构，例如「修复上下文页卡死」「注入截流方案落地」')
  L.push('')

  if (existing.length) {
    L.push('## 已有事件（' + existing.length + ' 个，你**可以**把新账本并入其中）')
    for (const e of existing.slice(0, 50)) {
      L.push('- ' + String(e.id || '') + ' | ' + String(e.name || '') + ' | ' + String(e.status || ''))
    }
    L.push('')
  }

  L.push('## 机械分组建议（**仅供参考，你可以全部推翻**）')
  L.push('下面这些分组是程序按「目标段首行相同 / 时间相近 + 字面重合」算出来的，**它不懂语义**。')
  L.push('请你自己判断：这些分组对不对？该拆开的拆开，该合并的合并，完全不对就忽略。')
  if (suggestions.length) {
    for (let i = 0; i < Math.min(suggestions.length, 30); i++) {
      const g = suggestions[i]
      L.push('- 建议组 ' + (i + 1) + '（置信度 ' + String(g.confidence || '') + '）：' +
        (Array.isArray(g.members) ? g.members.join('、') : '') +
        ' —— 依据：' + String(g.rationale || ''))
    }
  } else {
    L.push('- （本批无机械建议，请完全靠你自己判断）')
  }
  L.push('')

  L.push('## 本批账本（第 ' + (idx + 1) + ' / ' + total + ' 批，共 ' + ledgers.length + ' 篇）')
  for (let i = 0; i < ledgers.length; i++) {
    const l = ledgers[i]
    L.push('')
    L.push('### [' + (i + 1) + '] ' + String(l.name || ''))
    L.push('- mtime: ' + new Date(Number(l.mtime) || 0).toISOString())
    L.push('- 字节: ' + (Number(l.bytes) || 0))
    if (l.excerpt) L.push('- 内容摘要: ' + String(l.excerpt))
    if (l.suggestName && l.suggestName.needsAiNaming) {
      L.push('- ⚠️ 程序无法从这篇提取合格名字，**必须由你命名**')
    }
  }
  L.push('')
  L.push('## 输出要求（严格 JSON，不要任何解释文字）')
  L.push('{')
  L.push('  "events": [')
  L.push('    {')
  L.push('      "name": "事件名（4-60字，人类可读）",')
  L.push('      "summary": "一句话总览（不超过200字）",')
  L.push('      "members": ["账本文件名1", "账本文件名2"],')
  L.push('      "sections": { "goal": "目标", "doing": "做了什么", "deadend": "失败与弯路", "next": "下一步" }')
  L.push('    }')
  L.push('  ],')
  L.push('  "rejectedSuggestions": "如果机械建议有错，说明哪里错（无则空字符串）"')
  L.push('}')
  L.push('')
  L.push('## 硬约束')
  L.push('1. **本批每一篇账本必须且只能出现在一个事件的 members 里**（不重不漏）。')
  L.push('2. 宁可分成多个小事件，也不要把不同目标硬塞进一个事件。')
  L.push('3. 事件名必须过上面的命名要求，否则整批作废。')
  L.push('4. 只输出 JSON，不要输出任何其他文字。')
  return L.join('\n')
}

export default {
  MAX_LEDGERS_PER_WS,
  DEFAULT_BATCH_SIZE,
  LEDGER_EXCERPT_CHARS,
  EVENT_BOUNDARY_RULES,
  scanAllWorkspacesPre,
  buildExcerptPre,
  batchLedgersPre,
  buildRegroupPromptPre,
}
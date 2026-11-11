/**
 * global-brief.js —— 「接续其他 Agent 记忆文档」的**纯逻辑核心**（全局动态简报）。
 *
 * ## 为什么存在这个文件
 * 用户在离开 DSH 一段时间后回来时，**本工作区里可能已经有别的 AI 工具**（ZCode / CodeBuddy /
 * WorkBuddy / Claude Code / Codex / Kimi / TRAE 等，见外部记忆源清单）改过记忆文件或项目文档。
 * 本模块负责「**看出这些变化**」，再由上层装配成注入段。
 *
 * ## 设计约束（用户裁定，2026-10-01 拟合）
 *  1. **范围 = 本工作区**。用户原话：「本工作区是一个项目，别的工作区是另一个项目。你不能把别的
 *     工作区另一个项目的内容嫁接到本工作区的这个项目上，容易造成漂移。」⇒ 本模块**只接受调用方
 *     传入的路径清单**，自己不扫描工作区桶，结构上无法跨项目搬运。
 *  2. **必须豁免 DSH 自己写的**（最大失败风险点）。DSH 每轮都在写白板 / 账本 / 日志，
 *     若不豁免会「每轮提醒自己刚写的东西」⇒ 疯狂误报。豁免经 `isSelfWrite(p)` 注入。
 *  3. ★**本模块是纯函数**：不 import `node:fs` / `node:path`、不联网、不读盘、不写盘。
 *     所有 IO 由调用方传入（`entries` 已是 stat 结果）。这保证它可被真 import + 真调用验收，
 *     且不可能绕过上层 Gate 直接落盘。
 *  4. **绝不抛**：任何畸形输入降级为「视为无变化」，不中断调用方。
 *
 * ## 与 team-* 模块的关系
 * 与 `team-pull.js` 同构（纯逻辑 + 依赖注入）。团队下行条目也可经 `buildDraft` 进同一渲染管线，
 * 但团队条目的**来源标记**是 `team`，与本地来源区分。
 */

/** 已知来源标记（与 externalSources 的 id 域对齐；未知来源归 `other`）。 */
export const BRIEF_SOURCES_PRE = ['workspace', 'external', 'team']

/** 单条 headline 的默认上限（超出截断，防注入段膨胀）。 */
export const BRIEF_HEADLINE_MAX_PRE = 96

/** 一次简报最多渲染的条目数（用户裁定：预算内裁剪时**保留草稿**）。 */
export const BRIEF_MAX_ITEMS_PRE = 12

function toText(value) {
  if (typeof value === 'string') return value
  if (value === null || value === undefined) return ''
  try { return String(value) } catch (_) { return '' }
}

function safeGet(target, key) {
  try { return target === null || target === undefined ? undefined : target[key] } catch (_) { return undefined }
}

function isFn(v) { return typeof v === 'function' }

/** 归一化一条 stat 结果；畸形 ⇒ null（调用方跳过，不抛）。 */
function normalizeEntry(raw) {
  if (!raw || typeof raw !== 'object') return null
  const p = toText(safeGet(raw, 'path'))
  if (!p) return null
  const size = Number(safeGet(raw, 'size'))
  const mtime = Number(safeGet(raw, 'mtimeMs'))
  return {
    path: p,
    size: Number.isFinite(size) ? size : 0,
    mtimeMs: Number.isFinite(mtime) ? mtime : 0,
    source: toText(safeGet(raw, 'source')) || 'workspace',
    documentId: toText(safeGet(raw, 'documentId')),
    revision: toText(safeGet(raw, 'revision')),
    errorCode: toText(safeGet(raw, 'errorCode'))
  }
}

/** 指纹 = size:mtimeMs（不读内容 ⇒ 零额外 IO，且大文件不拖慢）。 */
function fingerprintOf(entry) {
  if (entry.errorCode) return 'error:' + toText(entry.errorCode)
  if (entry.revision) return 'r4:' + toText(entry.revision)
  return toText(entry.size) + ':' + toText(entry.mtimeMs)
}

function changeOf(kind, entry) {
  return {
    kind, path: entry.path, source: entry.source, size: entry.size,
    documentId: entry.documentId || null,
    revision: entry.revision || null,
    errorCode: entry.errorCode || null,
  }
}

/**
 * 对比水位与当前 stat，产出「新增 / 修改 / 删除」三类变化。
 *
 * @param {Object} opt
 *   - opt.previous : 上次水位（`{ [path]: fingerprint }`）；null / 非对象 ⇒ 视为首次
 *   - opt.entries  : 当前 stat 结果数组（上层已 stat，本模块不读盘）
 *   - opt.isSelfWrite : (path) => boolean —— **豁免门**；返回 true 的条目一律不计入变化
 *   - opt.limit    : 最多返回多少条（默认 BRIEF_MAX_ITEMS_PRE）
 * @returns {{ ok: boolean, first: boolean, changed: Array, next: Object, counts: Object }}
 *   - `first === true` 表示「首次建立基线」：此时 `changed` 为空（首见不算变动，否则第一次运行就刷屏）
 */
export function diffBriefPre(opt) {
  const o = opt || {}
  const prevRaw = safeGet(o, 'previous')
  const first = !prevRaw || typeof prevRaw !== 'object'
  const prev = first ? {} : prevRaw
  const rawEntries = safeGet(o, 'entries')
  const list = Array.isArray(rawEntries) ? rawEntries : []
  const limitRaw = Number(safeGet(o, 'limit'))
  const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? Math.floor(limitRaw) : BRIEF_MAX_ITEMS_PRE
  const isSelfWrite = safeGet(o, 'isSelfWrite')

  const next = {}
  const changed = []
  let skippedSelf = 0

  for (let i = 0; i < list.length; i++) {
    const e = normalizeEntry(list[i])
    if (!e) continue
    // ★豁免门：DSH 自己刚写的文件，连基线都不更新（下次仍按「已知」处理）
    let selfWritten = false
    if (isFn(isSelfWrite)) {
      try { selfWritten = isSelfWrite(e.path, e) === true } catch (_) { selfWritten = false }
    }
    if (selfWritten) {
      skippedSelf += 1
      // 仍写入基线：把它登记为「已知」，避免豁免失效后被当成新变动
      next[e.path] = fingerprintOf(e)
      continue
    }
    next[e.path] = fingerprintOf(e)
    if (first && !e.errorCode) continue
    const before = prev[e.path]
    if (typeof before !== 'string') {
      changed.push(changeOf(e.errorCode ? 'error' : 'added', e))
    } else if (before !== fingerprintOf(e)) {
      changed.push(changeOf(e.errorCode ? 'error' : 'changed', e))
    }
  }

  // 删除类：上次有、这次没有（豁免判定同样适用）
  if (!first) {
    const seen = new Set(Object.keys(next))
    for (const p of Object.keys(prev)) {
      if (seen.has(p)) continue
      let selfWritten = false
      if (isFn(isSelfWrite)) {
        try { selfWritten = isSelfWrite(p, null) === true } catch (_) { selfWritten = false }
      }
      if (selfWritten) { skippedSelf += 1; continue }
      changed.push({ kind: 'removed', path: p, source: 'workspace', size: 0 })
    }
  }

  const bounded = changed.slice(0, limit)
  return {
    ok: true,
    first: first,
    changed: bounded,
    truncated: Math.max(0, changed.length - bounded.length),
    next: next,
    counts: {
      total: changed.length,
      emitted: bounded.length,
      skippedSelf: skippedSelf
    }
  }
}

/** 脱敏：命中疑似凭据的行整条丢弃（宁可少一条，不泄一个密钥）。 */
const SECRET_PATTERNS_PRE = [
  /\b(sk|pk|ak|rk)-[A-Za-z0-9]{12,}/i,
  /\b[A-Za-z0-9]{16,}\.[A-Za-z0-9._-]{20,}/,
  /(password|passwd|secret|token|api[_-]?key|access[_-]?key|private[_-]?key)\s*[:=]\s*\S{6,}/i,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/
]

/** 文本是否疑似凭据（供上层过滤 headline）。 */
export function looksSecretPre(text) {
  const s = toText(text)
  if (!s) return false
  for (let i = 0; i < SECRET_PATTERNS_PRE.length; i++) {
    try { if (SECRET_PATTERNS_PRE[i].test(s)) return true } catch (_) { /* 单条正则异常不影响其余 */ }
  }
  return false
}

/** 从路径取可读短名（basename，去扩展名；不引 node:path）。 */
function shortNameOf(p) {
  const s = toText(p).replace(/\\/g, '/')
  const parts = s.split('/')
  const base = parts.length ? parts[parts.length - 1] : s
  return base.replace(/\.[A-Za-z0-9]+$/, '') || base
}

/** 来源中文标签（用于 headline 前缀）。 */
function sourceLabelPre(source) {
  if (source === 'team') return '团队'
  if (source === 'external') return '外部'
  return '本区'
}

/**
 * 构造简报草稿（headline 列表）。**只报「什么变了 + 绝对路径」**（链路模式），
 * 不摘录内容 —— 避免把别的工具写的凭据/私密内容带进 prompt。
 *
 * @returns {{ headlines: Array, counts: Object, dropped: number }}
 */
export function buildDraftPre(opt) {
  const o = opt || {}
  const changed = safeGet(o, 'changed')
  const list = Array.isArray(changed) ? changed : []
  const maxCharsRaw = Number(safeGet(o, 'maxChars'))
  const maxChars = Number.isFinite(maxCharsRaw) && maxCharsRaw > 0 ? Math.floor(maxCharsRaw) : 0
  const maxHeadlineRaw = Number(safeGet(o, 'headlineMax'))
  const headlineMax = Number.isFinite(maxHeadlineRaw) && maxHeadlineRaw > 0 ? Math.floor(maxHeadlineRaw) : BRIEF_HEADLINE_MAX_PRE

  const headlines = []
  let dropped = 0
  let used = 0

  for (let i = 0; i < list.length; i++) {
    const c = list[i]
    if (!c || typeof c !== 'object') { dropped += 1; continue }
    const p = toText(safeGet(c, 'path'))
    const kind = toText(safeGet(c, 'kind')) || 'changed'
    const source = toText(safeGet(c, 'source')) || 'workspace'
    if (!p) { dropped += 1; continue }
    if (looksSecretPre(p)) { dropped += 1; continue }  // 路径本身疑似凭据 ⇒ 丢
    const verb = kind === 'added' ? '新增' : (kind === 'removed' ? '删除' : (kind === 'error' ? '读取失败' : '修改'))
    const documentId = toText(safeGet(c, 'documentId'))
    const revision = toText(safeGet(c, 'revision'))
    const errorCode = toText(safeGet(c, 'errorCode'))
    const identity = documentId && revision ? ' [' + documentId + '@' + revision + ']' : (errorCode ? ' [' + errorCode + ']' : '')
    let line = '· [' + sourceLabelPre(source) + verb + '] ' + shortNameOf(p) + identity
    if (line.length > headlineMax) line = line.slice(0, headlineMax - 1) + '…'
    const withPath = line + ' —— ' + p
    if (maxChars > 0 && used + withPath.length + 1 > maxChars) { dropped += list.length - i; break }
    headlines.push({ source: source, kind: kind, path: p, text: withPath, documentId: documentId || null, revision: revision || null, errorCode: errorCode || null })
    used += withPath.length + 1
  }

  return {
    headlines: headlines,
    counts: { in: list.length, out: headlines.length, dropped: dropped },
    chars: used
  }
}

/**
 * 渲染注入段。**无变化 ⇒ 返回空串**（零字节，用户裁定「只在真有变化时才提醒」）。
 *
 * 行为指令（§5.2，用户已确认）：**软指示 + 退路句** ——
 * 先让模型 read 路径确认新进展，再继续；若与本任务无关，说明一句后直接推进（防无关变更导致空转）。
 */
export function renderBriefPre(opt) {
  const o = opt || {}
  const draft = safeGet(o, 'draft') || {}
  const headlines = safeGet(draft, 'headlines')
  const list = Array.isArray(headlines) ? headlines : []
  if (!list.length) return ''
  const lines = []
  lines.push('[全局动态 — 其他 Agent 的记忆文档有更新]')
  lines.push('检测方式：对比本工作区记忆文件与项目文档的「大小:修改时间」指纹；DSH 自身写入已豁免。')
  if (list.some((item) => item && item.revision)) lines.push('维护文档按 revision 比较；同内容 mtime 变化不计入，同进程 committed 由失效通道豁免。')
  lines.push('')
  for (let i = 0; i < list.length; i++) {
    const h = list[i]
    lines.push(toText(safeGet(h, 'text')))
  }
  lines.push('')
  lines.push('请先按上面的绝对路径 read 其中与当前任务相关的文档，确认其他 Agent 的新进展，再继续推进任务。')
  lines.push('若这些变更与当前任务无关，简短说明一句后直接推进，不要为此停下来。')
  return lines.join('\n')
}

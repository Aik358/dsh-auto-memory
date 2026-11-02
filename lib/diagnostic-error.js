import { DEGRADE_REASON_MAX_PRE_V1, SESSION_SEARCH_POSTURES_PRE_V1 } from './degrade.js'

// Error messages can contain credentials, URLs, paths, source text or injected
// instructions. Keep only allowlisted identifiers; never persist message/stack
// or stringify an arbitrary thrown value. Unknown identifiers are omitted.
const ERROR_NAMES = new Set(['Error', 'TypeError', 'RangeError', 'SyntaxError', 'ReferenceError', 'AggregateError'])
const ERROR_CODES = new Set([
  'EACCES', 'EPERM', 'ENOENT', 'ENOSPC', 'EIO', 'EINVAL', 'EBUSY', 'EMFILE', 'ENFILE',
  'ETIMEDOUT', 'ECONNRESET', 'ECONNREFUSED', 'ERR_BUFFER_TOO_LARGE', 'ERR_OUT_OF_RANGE',
  'SESSION_QUERY_PERSISTENCE_FAILED',
  // issue #478：会话检索另外两个**稳定枚举码**。二者本身不含路径/正文/凭据，
  //   但此前不在白名单 ⇒ 整码被丢弃，台账只剩 "type=unknown; message=[redacted]"
  //   这种零信息量形态（#478 实盘即如此）。补进白名单不降低脱敏强度：message 仍不碰。
  'SESSION_QUERY_SEARCH_DISABLED',
  'SESSION_QUERY_INDEX_FAILED',
])

/** issue #478：调试态开关。默认**关**，脱敏强度与旧实现逐字一致。 */
export const DIAGNOSTIC_DEBUG_ENV = 'DSH_MEMORY_DEBUG'
/** 调试态下 message 段的字符上限（总长仍受 DEGRADE_REASON_MAX_PRE_V1 约束）。 */
export const DIAGNOSTIC_DEBUG_MESSAGE_MAX = 200
/**
 * 明显的凭据形状。命中即整段替换 —— 调试态是"多一点线索"，**不是**"把原文照抄"，
 * 所以宁可丢信息也不能把 token/password 落进可查询的状态文件。
 */
const SECRET_SHAPE_RE = /(bearer\s+\S+|(?:token|password|passwd|secret|api[_-]?key)\s*[=:]\s*\S+)/gi

function debugEnabledPre() {
  try {
    const env = typeof process !== 'undefined' ? process.env : null
    return String((env && env[DIAGNOSTIC_DEBUG_ENV]) || '') === '1'
  } catch (_) { return false }
}

/** 单行化 → 去控制字符 → 遮挡凭据形状 → 截断。任何异常都降级为空串（不抛）。 */
function debugMessagePre(raw, limit) {
  try {
    let s = String(raw == null ? '' : raw)
    s = s.replace(/[\u0000-\u001f\u007f\u2028\u2029]+/g, ' ')
    s = s.replace(SECRET_SHAPE_RE, '[secret-redacted]')
    s = s.replace(/\s+/g, ' ').trim()
    if (s.length > limit) s = s.slice(0, Math.max(1, limit - 1)) + '…'
    return s
  } catch (_) { return '' }
}

export function diagnosticErrorReasonPre(error) {
  let name = 'unknown', code = ''
  try { const value = error && error.name; if (ERROR_NAMES.has(value)) name = value } catch (_) {}
  try { const value = error && error.code; if (ERROR_CODES.has(value)) code = value } catch (_) {}
  // message 只在**两种**情形下读取，其余一律不碰（保持旧实现的访问面）：
  //   ① 需要从 message 里捞稳定 code；② 显式开了调试态。
  const wantDebug = debugEnabledPre()
  let message = ''
  if (!code || wantDebug) {
    try {
      const value = error && error.message
      if (typeof value === 'string') message = value
    } catch (_) {}
  }
  if (!code) {
    // Some hosts expose their stable code only in message. Copy the identifier,
    // never its surrounding content. Avoid arbitrary coercion and unbounded scans.
    try {
      if (message) {
        const tokens = message.slice(0, 2048).match(/\b[A-Z][A-Z0-9_]+\b/g) || []
        code = tokens.find((token) => ERROR_CODES.has(token)) || ''
      }
    } catch (_) {}
  }
  const hit = wantDebug && message ? debugMessagePre(message, DIAGNOSTIC_DEBUG_MESSAGE_MAX) : ''
  const tail = hit ? '; message=' + hit : '; message=[redacted]'
  // 绝不落 stack：本函数只读 name/code/message 三个属性，连 error.stack 都不碰。
  return ('type=' + name + (code ? '; code=' + code : '') + tail).slice(0, DEGRADE_REASON_MAX_PRE_V1)
}

/* ══════════════════════════════════════════════════════════════════════════
 * ★★#476（2026-11-02）：会话检索的**姿态分类**（四态可区分）
 *
 * 缺陷：searchSessionHistory 的 catch 不按 error.code 分支，把
 *   · 默认部署态（SESSION_QUERY_SEARCH_DISABLED，openAt: never）
 *   · 索引真坏（SESSION_QUERY_INDEX_FAILED / PERSISTENCE_FAILED）
 *   · 合法空结果（no-hit / index-empty）
 * 三件事混成同一句「宿主会话检索抛错；具体成因未确定」⇒ 用户拿不到任何可操作线索，
 * 且默认部署态每次 recall 都落一条降级台账，把真故障淹掉。
 *
 * 修法：**分类放在本模块**（只有这里认识 error.code 与 message 的脱敏面），
 *       **该不该记的判据留在 degrade.js**（预期内必须静默是降级层自己的纪律）。
 * 两处不各写一份判据 —— 那正是本仓已记录的「半修」风险。
 * ══════════════════════════════════════════════════════════════════════════ */

/** 会话检索的稳定码（单点定义：同一字面量在文件里只出现一次，守卫锚串才唯一）。 */
const CODE_SEARCH_DISABLED = 'SESSION_QUERY_SEARCH_DISABLED'
const CODE_INDEX_FAILED = 'SESSION_QUERY_INDEX_FAILED'
const CODE_PERSISTENCE_FAILED = 'SESSION_QUERY_PERSISTENCE_FAILED'

/** 部署未开时可操作的下一步（截图/复制给用户的那句话，点名配置项）。 */
export const SESSION_SEARCH_DISABLED_HINT =
  '会话全文检索未开启：DSH 桌面版默认 session-query-sqlite.openAt: never（全文检索是 opt-in）。'
  + '在 profile 的 cordis.patch.yml 覆盖为 openAt: first-search 并给持久 path 后重启生效。'
  + '以下为插件内词法扫描结果：'

/** 索引真坏时的说明（预期外，仍要留痕）。 */
export const SESSION_SEARCH_INDEX_ERROR_HINT =
  '会话索引不可用（索引损坏或持久化失败，非配置问题）。插件内词法扫描结果如下，'
  + '修复索引后可重试宿主检索。'

/**
 * 把会话检索抛出的错误归到姿态。
 *
 * @returns {{posture:string, code:string, expected:boolean, hint:string}}
 *   posture ∈ SESSION_SEARCH_POSTURES_PRE_V1（本函数只会返回 disabled / index-error / unknown）
 *   expected=true 表示「预期内、不该记降级台账」
 */
export function classifySessionSearchErrorPre(error) {
  let code = ''
  let message = ''
  try {
    const c = error && error.code
    if (typeof c === 'string') code = c
  } catch (_) {}
  try {
    const m = error && error.message
    if (typeof m === 'string') message = m.slice(0, 2048)
  } catch (_) {}
  // code 缺失时从 message 里捞（宿主有些版本只把稳定码放 message；#478 同源处理）
  if (!code && message) {
    const tokens = message.match(/[A-Z][A-Z0-9_]+/g) || []
    code = tokens.find((t) => ERROR_CODES.has(t)) || ''
  }
  const hasDisabled = code === CODE_SEARCH_DISABLED || message.includes(CODE_SEARCH_DISABLED)
  const hasIndexErr = code === CODE_INDEX_FAILED || code === CODE_PERSISTENCE_FAILED
    || message.includes(CODE_INDEX_FAILED) || message.includes(CODE_PERSISTENCE_FAILED)
  // ★顺序有意：**disabled 优先**。宿主在 _assertSearchEnabled() 里先抛 disabled，
  //   某些版本会把 persistence 字样的上下文一起塞进 message；若反过来判，部署态会被误记成真故障。
  if (hasDisabled) {
    return { posture: 'disabled', code: code || CODE_SEARCH_DISABLED, expected: true, hint: SESSION_SEARCH_DISABLED_HINT }
  }
  if (hasIndexErr) {
    return { posture: 'index-error', code: code || CODE_INDEX_FAILED, expected: false, hint: SESSION_SEARCH_INDEX_ERROR_HINT }
  }
  // 无法判定 ⇒ fail-closed 到 unknown（**不得**当作正常；调用方应记台账）
  return { posture: 'unknown', code, expected: false, hint: '宿主会话检索失败，成因未归类（已记入降级台账）：' }
}

/**
 * 把**成功返回**的检索页归到姿态（区分「索引空」与「本次没命中」）。
 *
 * @param {object} page 宿主 searchSessions 的返回值（{ items, total? }）
 * @returns {string} 'hit' | 'no-hit' | 'index-empty'
 *   · index-empty —— 整个索引里没有任何会话（索引刚建/被清空，属**合法**状态）
 *   · no-hit      —— 索引里有会话，但本次查询零命中（**合法**）
 *   · hit         —— 有命中
 * ★判定只看**计数**，不看正文：避免把用户内容当判据（本模块的既有纪律）。
 */
export function classifySessionSearchResultPre(page) {
  try {
    let items = []
    try { const v = page && page.items; if (Array.isArray(v)) items = v } catch (_) {}
    if (items.length > 0) return 'hit'
    // 总条目数：宿主字段名未冻结，按已知形态依次探测；取不到 ⇒ 按 no-hit（保守，不误报 index-empty）
    let total = null
    const probe = (o, k) => { try { const v = o && o[k]; return typeof v === 'number' && Number.isFinite(v) ? v : null } catch (_) { return null } }
    for (const k of ['total', 'totalSessions', 'indexedSessions', 'count']) {
      const v = probe(page, k)
      if (v !== null) { total = v; break }
    }
    if (total === null) {
      for (const k of ['total', 'indexedSessions']) {
        const v = probe(page && page.stats, k)
        if (v !== null) { total = v; break }
      }
    }
    return total === 0 ? 'index-empty' : 'no-hit'
  } catch (_) { return 'no-hit' }
}

/** posture 是否属于本模块认识的枚举（供断言与 fail-closed 归一）。 */
export function isSessionSearchPosturePre(p) {
  try { return SESSION_SEARCH_POSTURES_PRE_V1.includes(String(p == null ? '' : p)) } catch (_) { return false }
}

/** Respect the real sink's record(kind, reason) API, including hostile sinks. */
export function recordDiagnosticErrorPre(sink, kind, error) {
  try {
    if (!sink || typeof sink.record !== 'function') return
    const result = sink.record(kind, diagnosticErrorReasonPre(error))
    if (result && typeof result.catch === 'function') result.catch(() => {})
  } catch (_) { /* Observability must never mask the original failure. */ }
}

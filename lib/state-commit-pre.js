/**
 * 统一状态提交契约（state_commit_pre_v1）—— P1 主体（2026-09-15）。
 *
 * 依据：`docs/internal/DESIGN-P1-STATE-COMMIT-20260915.md`（已获用户批准）§2.1 / §2.2 / §2.3，
 *       `MASTER-PLAN-3.0.md` Phase 1、`TODO-GRAPH.html` 卡 V2-P1。
 *
 * **一句话目标**：把「谁在写、写的什么版本、写完算不算数」收敛成**一个提交边界**。
 *
 * **三条硬规则（本模块是它们的唯一实现点）**：
 *   1. **miv 是内容身份 + 状态清单摘要**（哈希，**不递增、不比较**）。
 *      任何代码不得写 `if (miv > lastMiv)` —— 它不是版本序。
 *   2. **`boardId` 在工作区内稳定、不含 sessionId**：由 `sha256(workspaceKey + '|' + scope)` 派生。
 *      接续后新窗口换 sessionId，若 boardId 跟着变，图就会被当成两块，共享语义直接崩。
 *   3. **必须废弃的口径**：白板 `index.json` 的 `rebuilt_at` **不得当版本序** ——
 *      它是时间戳，重建时间变而内容没变时它会变 ⇒ 用它当版本序会造成**假失效 + 真混版**。
 *      断言 T1-5c 专门钉死这一条。
 *
 * **边界（不在本模块做）**：
 *   - 不加长期编辑锁、不按会话分片（卡内明确否决）——并发靠「队列串行 + 边界内比较」。
 *   - 不解析白板格式（KICKOFF §3.4：白板线拥有 `parseWhiteboardPre`）。
 *   - `atomicReplace` 不是 CAS，本模块不给它加语义；提交校验必须发生在**队列内部**。
 *
 * S9 合规：零 IO、零外部依赖（只用 node:crypto）、纯函数、无网络/无 LLM/无子进程/无 await。
 * UTF-8 无 BOM。
 */
import { createHash } from 'node:crypto'

export const STATE_COMMIT_VERSION_PRE = 'state_commit_pre_v1'

/** miv 前缀（与 `shadow-retrieval-pre.js:144` 既有口径一致：`idx_pre_` + first32hex）。 */
export const MIV_PREFIX_PRE = 'idx_pre_'

/**
 * 三种状态的**命名隔离**（卡内要求"三种状态不能混"）。
 * 三者**不得互转**：记忆有效状态是"条目还算不算数"，任务进度是"活干完没有"，
 * 归档位置是"东西放哪儿"。`archived` 一词两义的问题以独立常量解决，**映射由白板线适配器负责**。
 */
export const MEMORY_STATUS_PRE = Object.freeze(['current', 'superseded', 'retracted'])
export const TASK_STATE_PRE = Object.freeze(['open', 'done', 'passed'])
export const ARCHIVE_STATE_PRE = Object.freeze(['active', 'archived'])

/** 提交单据必填字段（缺任一 ⇒ fail-closed 拒绝，不猜测）。 */
export const COMMIT_REQUIRED_PRE_V1 = Object.freeze(['workspaceKey', 'boardId', 'txId', 'actor'])

/** 冲突/拒绝原因码 → 可读中文。 */
export const COMMIT_REASONS_PRE_V1 = Object.freeze({
  'not-object': '传入的不是对象',
  'missing-field': '提交单据缺必填字段',
  'invalid-writes': 'writes 形状非法（必须是数组）',
  'digest-mismatch': '提交前摘要不匹配（外部编辑或并发写）',
  'state-version-mismatch': '状态版本不匹配（外部变更或并发提交）',
  'actor-invalid': 'actor 形状非法（需 { sessionId, kind }）',
})

/** 原因码 → 可读中文（未知码原样返回）。 */
export function describeCommitReasonPre(code) {
  const k = String(code == null ? '' : code)
  return COMMIT_REASONS_PRE_V1[k] || k || '未知原因'
}

function asNonEmptyString(v) {
  if (typeof v !== 'string') return null
  const t = v.trim()
  return t ? t : null
}

function canonicalJson(v) {
  // 稳定键序序列化（避免插入顺序导致同内容不同哈希）
  if (v === null || typeof v !== 'object') return JSON.stringify(v)
  if (Array.isArray(v)) return '[' + v.map(canonicalJson).join(',') + ']'
  const keys = Object.keys(v).sort()
  return '{' + keys.map((k) => JSON.stringify(k) + ':' + canonicalJson(v[k])).join(',') + '}'
}

function sha256HexPre(text) {
  return createHash('sha256').update(String(text), 'utf8').digest('hex')
}

/**
 * **miv 单源**（P1 步 2）：`memoryIndexVersionPre(projection)`。
 *
 * ⚠️ **与既有实现的边界（2026-09-15 施工期核实，必须分清）**：
 *   本函数算的是 **"状态清单摘要"口径**的 miv —— 输入是**规范化投影**
 *   （`{records:[{id,status,l0?}], boardCards?}`），用于「同一份快照」的**身份判定**，
 *   以及 pinned 状态进入摘要（状态变了 miv 必变）。
 *   它**不替换**契约 §8 的 `shadow-retrieval-pre.js:145 memoryIndexVersion(sources)` ——
 *   那个吃的是 **source tuples**（scope/sourceRef/epoch/version/fileDigest），是**建索引**侧的真源。
 *   两者**输入不同、用途不同**，不可互相替换；本函数是"提交边界侧"的口径，
 *   且**刻意保持与 §8 相同的前缀与长度**（`idx_pre_` + 32 hex），使二者在外部看来同形。
 *
 * ⚠️ 本函数**不负责**收敛 `index.js:4188 tierCurrentMivPre()`（那处的缓存/指纹语义属 T0-2 已交付内容），
 *    P1 不动它 —— 见设计稿 §2.2 边界说明。任何"用本函数替换 tier 自造版"的改动都**不在 P1 范围**。
 *
 * 输入：`{ records: [{id, status, l0?}], boardCards?: [{id, status}], scope? }`
 * 输出：`'idx_pre_' + first32hex(sha256(canonical))`
 *
 * canonical 构成（按 id 升序，换行拼接，无尾随空白）：
 *   每条 → `<id>\t<status>\t<contentDigest>`；`contentDigest` = 内容摘要（无内容时取空串）。
 *   `boardCards` 若给出，追加在 records 之后（同样排序）—— 白板卡片状态变化也进摘要。
 *
 * ⚠️ **不递增、不比较**。这是哈希身份。`rebuilt_at`（时间戳）**不得**参与本函数，也不得
 *    被任何调用方当作版本序使用 —— 见文件头第 3 条硬规则。
 */
export function memoryIndexVersionPre(projection) {
  const o = projection && typeof projection === 'object' ? projection : {}
  const records = Array.isArray(o.records) ? o.records : []
  const boardCards = Array.isArray(o.boardCards) ? o.boardCards : []
  const tuples = []
  for (const r of records) {
    if (!r || typeof r !== 'object') continue
    const id = asNonEmptyString(r.id)
    if (!id) continue
    const status = asNonEmptyString(r.status) || ''
    const contentDigest = r.l0 == null ? '' : sha256HexPre(canonicalJson(r.l0)).slice(0, 16)
    tuples.push([id, status, contentDigest])
  }
  for (const c of boardCards) {
    if (!c || typeof c !== 'object') continue
    const id = asNonEmptyString(c.id)
    if (!id) continue
    tuples.push(['board:' + id, asNonEmptyString(c.status) || '', ''])
  }
  tuples.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
  const canonical = tuples.map((t) => t.join('\t')).join('\n')
  return MIV_PREFIX_PRE + sha256HexPre(canonical).slice(0, 32)
}

/**
 * **boardId 派生**（卡内硬约束）：工作区内稳定、**不含 sessionId**。
 *
 * ⚠️ 入参**只接受 workspaceKey 与 scope**。刻意不接收 sessionId/agent 对象 ——
 *    从签名上就杜绝"顺手把会话号掺进去"这个错误。
 */
export function boardIdPre(workspaceKey, scope) {
  const ws = asNonEmptyString(workspaceKey)
  if (!ws) return null
  const sc = asNonEmptyString(scope) || 'Workspace'
  return 'board_pre_' + sha256HexPre(ws + '|' + sc).slice(0, 24)
}

/**
 * 构造并校验提交单据（P1 步 1）。
 *
 * 形状：`{ workspaceKey, boardId, txId, expectedDigest?, expectedStateVersion?,
 *          actor: { sessionId, contSeq?, kind }, writes: [{ path, content, expectedDigest? }],
 *          stateChanges?: [{ target, from, to }] }`
 *
 * **fail-closed**：缺必填字段 / actor 形状非法 / writes 非数组 ⇒ `{ok:false}`，不猜测、不补默认值。
 *
 * **向后兼容（T1-8）**：`expectedStateVersion` 与 `expectedDigest` 均为**可选**；
 * 不传时下游行为必须与本契约引入前**逐字节一致**（该校验由调用方在队列内执行）。
 */
export function buildStateCommitPre(input) {
  const o = input && typeof input === 'object' ? input : null
  if (!o) return { ok: false, reason: 'not-object', detail: describeCommitReasonPre('not-object') }

  const missing = []
  const workspaceKey = asNonEmptyString(o.workspaceKey)
  if (!workspaceKey) missing.push('workspaceKey')
  const boardId = asNonEmptyString(o.boardId)
  if (!boardId) missing.push('boardId')
  const txId = asNonEmptyString(o.txId)
  if (!txId) missing.push('txId')

  const actor = o.actor && typeof o.actor === 'object' ? o.actor : null
  const actorSession = actor ? asNonEmptyString(actor.sessionId) : null
  const actorKind = actor ? asNonEmptyString(actor.kind) : null
  if (!actor || !actorSession || !actorKind) {
    return { ok: false, reason: 'actor-invalid', detail: describeCommitReasonPre('actor-invalid'), missing: actor ? ['actor.sessionId', 'actor.kind'] : ['actor'] }
  }
  if (missing.length) {
    return { ok: false, reason: 'missing-field', detail: describeCommitReasonPre('missing-field'), missing }
  }

  if (o.writes !== undefined && !Array.isArray(o.writes)) {
    return { ok: false, reason: 'invalid-writes', detail: describeCommitReasonPre('invalid-writes') }
  }

  const commit = {
    schemaVersion: STATE_COMMIT_VERSION_PRE,
    workspaceKey,
    boardId,
    txId,
    actor: {
      sessionId: actorSession,
      contSeq: Number.isFinite(Number(actor.contSeq)) ? Number(actor.contSeq) : undefined,
      kind: actorKind,
    },
    writes: Array.isArray(o.writes) ? o.writes : [],
    stateChanges: Array.isArray(o.stateChanges) ? o.stateChanges : [],
  }
  // 可选字段：仅在显式给出时带上（保证"不传 = 行为不变"）
  if (o.expectedDigest != null) commit.expectedDigest = String(o.expectedDigest)
  if (o.expectedStateVersion != null) commit.expectedStateVersion = String(o.expectedStateVersion)
  return { ok: true, commit }
}

/**
 * 冲突描述（卡内 T1-7C 要求：拒绝信息必须带**当前版本 + 冲突目标**，不静默覆盖）。
 * 纯函数：只组装信息，不做 IO。
 */
export function commitConflictPre(commit, observed) {
  const c = commit && typeof commit === 'object' ? commit : {}
  const ob = observed && typeof observed === 'object' ? observed : {}
  const expected = c.expectedStateVersion != null ? String(c.expectedStateVersion) : (c.expectedDigest != null ? String(c.expectedDigest) : '(none)')
  const actual = ob.stateVersion != null ? String(ob.stateVersion) : (ob.fileDigest != null ? String(ob.fileDigest) : '(unknown)')
  const target = ob.target != null ? String(ob.target) : (Array.isArray(c.writes) && c.writes[0] && c.writes[0].path ? String(c.writes[0].path) : '(unknown)')
  const who = c.actor && c.actor.sessionId ? String(c.actor.sessionId) : '(unknown)'
  const contSeq = c.actor && c.actor.contSeq != null ? '@' + String(c.actor.contSeq) : ''
  const which = ob.kind === 'state-version' ? 'state-version-mismatch' : 'digest-mismatch'
  return {
    ok: false,
    reason: which,
    detail: describeCommitReasonPre(which),
    // 可见冲突三要素：期望值 / 实测值 / 冲突目标（+ 谁）
    expected,
    observed: actual,
    target,
    txId: c.txId != null ? String(c.txId) : '',
    boardId: c.boardId != null ? String(c.boardId) : '',
    actor: who + contSeq,
    text: '[提交被拒] tx=' + (c.txId != null ? String(c.txId) : '(none)')
      + ' 目标=' + target
      + ' 期望=' + expected + ' 实测=' + actual
      + ' 冲突方=' + who + contSeq,
  }
}

/** 成功回执：提交边界返回的可观测凭据（含 miv —— 快照侧据此判"同一份"）。 */
export function commitReceiptPre(commit, result) {
  const c = commit && typeof commit === 'object' ? commit : {}
  const r = result && typeof result === 'object' ? result : {}
  return {
    schemaVersion: STATE_COMMIT_VERSION_PRE,
    ok: true,
    txId: c.txId != null ? String(c.txId) : '',
    boardId: c.boardId != null ? String(c.boardId) : '',
    workspaceKey: c.workspaceKey != null ? String(c.workspaceKey) : '',
    digest: r.digest != null ? String(r.digest) : '',
    stateVersion: r.stateVersion != null ? String(r.stateVersion) : '',
    miv: r.miv != null ? String(r.miv) : '',
    at: Number.isFinite(Number(r.at)) ? Number(r.at) : Date.now(),
    actor: c.actor && c.actor.sessionId ? String(c.actor.sessionId) : '',
  }
}

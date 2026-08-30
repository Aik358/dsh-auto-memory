/**
 * M7-0 Wire Protocol 纯核心(docs/PYTHON-SIDECAR-CONTRACT.md §7-§9,§13 M7-0)。
 * 零 IO、零依赖(node:crypto);本模块不 spawn、不监听、不读文件、不改 M5/M6 schema。
 *
 * 组成:
 *   1) 协议常量(m7_wire_pre_v1 / 传输预算 / 帧类型两个不相交集合 / 请求→响应对应)
 *   2) canonical JSON + SHA-256(JS 与 Python worker 的逐字节一致实现;排序键、无空白、UTF-8)
 *   3) M7TransportFramePre envelope validator(fail closed;方向门)
 *   4) SemanticRecordPre / IndexSyncBegin/Page/Commit payload validators(M7-1)
 *   5) pageDigest/finalDigest/chunkId/syncId canonical identity(M7-1)
 * 全部函数同输入逐字段确定;UTF-8 无 BOM。
 */
import { createHash } from 'node:crypto'

const sha256Hex = (buf) => createHash('sha256').update(buf).digest('hex')
const sha256Str = (s) => sha256Hex(Buffer.from(String(s), 'utf8'))
const first32 = (h) => h.slice(0, 32)

export const M7_WIRE_PROTOCOL_VERSION_PRE_V1 = 'm7_wire_pre_v1'
export const M7_INDEX_POLICY_VERSION_PRE_V1 = 'index_sync_pre_v1'

/** §7 传输预算(冻结;变更必须升级协议版本)。 */
export const M7_TRANSPORT_BUDGET_PRE_V1 = Object.freeze({
  schemaVersion: 1,
  maxLineBytes: 256 * 1024,
  requestTimeoutMs: 5000,
  maxPendingRequests: 64,
  activationIdsCapacity: 256,
  breakerFailureThreshold: 3,
  breakerCooldownMs: 30000,
})

/** JS→Python frame 类型(§7.2;index_sync_* 属 M7-1)。 */
export const JS_FRAME_TYPES_PRE_V1 = Object.freeze([
  'health', 'context_push', 'index_sync_begin', 'index_sync_page', 'index_sync_commit',
  'cancel', 'close_session',
])
/** Python→JS frame 类型。 */
export const PY_FRAME_TYPES_PRE_V1 = Object.freeze([
  'health_result', 'context_ack', 'index_ack', 'activation_request', 'error',
])
const ALL_FRAME_TYPES = new Set([...JS_FRAME_TYPES_PRE_V1, ...PY_FRAME_TYPES_PRE_V1])
/** 请求→响应 type 对应(cancel/close_session 刻意无响应帧)。 */
export const RESPONSE_TYPE_FOR_PRE_V1 = Object.freeze({
  health: 'health_result',
  context_push: 'context_ack',
  index_sync_begin: 'index_ack',
  index_sync_page: 'index_ack',
  index_sync_commit: 'index_ack',
})

// ========== canonical JSON(与 python/worker_pre_v1.py 逐字节一致) ==========

/**
 * 确定性 canonical JSON:对象键递归排序、无空白、非 ASCII 原样 UTF-8、undefined 剔除。
 * 仅用于 digest 计算;参与 digest 的值必须限于 str/int/bool/null/list/dict(不含浮点)。
 */
export function canonicalJson(value) {
  if (value === undefined) return 'null'
  if (value === null || typeof value === 'boolean' || typeof value === 'number' || typeof value === 'string') {
    return JSON.stringify(value)
  }
  if (Array.isArray(value)) return '[' + value.map((v) => canonicalJson(v)).join(',') + ']'
  if (typeof value === 'object') {
    const keys = Object.keys(value).sort()
    return '{' + keys.map((k) => JSON.stringify(k) + ':' + canonicalJson(value[k])).join(',') + '}'
  }
  return 'null'
}

/** canonical JSON 的 SHA-256(hex64)。 */
export function sha256Canonical(value) {
  return sha256Str(canonicalJson(value))
}

// ========== envelope validator ==========

/**
 * M7TransportFramePre 校验(§7.2):七字段全检;opts.direction 门控方向(in=PY_TO_JS/out=JS_TO_PY)。
 */
export function validateTransportFramePre(frame, opts = {}) {
  const p = []
  if (!frame || typeof frame !== 'object' || Array.isArray(frame)) return { ok: false, reason: 'not-object' }
  if (frame.protocolVersion !== M7_WIRE_PROTOCOL_VERSION_PRE_V1) p.push('protocolVersion')
  if (typeof frame.frameId !== 'string' || !frame.frameId) p.push('frameId')
  if (typeof frame.requestId !== 'string') p.push('requestId')
  if (typeof frame.workerEpoch !== 'string' || !frame.workerEpoch) p.push('workerEpoch')
  if (!ALL_FRAME_TYPES.has(frame.type)) p.push('type')
  if (!frame.payload || typeof frame.payload !== 'object' || Array.isArray(frame.payload)) p.push('payload')
  if (typeof frame.sentAt !== 'number' || !Number.isFinite(frame.sentAt)) p.push('sentAt')
  if (!p.length && opts.direction === 'in' && !PY_FRAME_TYPES_PRE_V1.includes(frame.type)) p.push('direction')
  if (!p.length && opts.direction === 'out' && !JS_FRAME_TYPES_PRE_V1.includes(frame.type)) p.push('direction')
  if (p.length) return { ok: false, reason: 'invalid:' + p.join(',') }
  return { ok: true, frame }
}

/**
 * 构造出站请求帧(确定性 frameId;sentAt 必填由调用方给时钟)。
 */
export function makeRequestFramePre(input) {
  const type = input && input.type
  const requestId = String((input && input.requestId) || '')
  const sentAt = Number(input && input.sentAt)
  const frame = {
    protocolVersion: M7_WIRE_PROTOCOL_VERSION_PRE_V1,
    frameId: 'frm_pre_' + first32(sha256Str(JSON.stringify(['m7-frame-pre-v1', type, requestId, sentAt]))),
    requestId,
    workerEpoch: String((input && input.workerEpoch) || ''),
    type,
    payload: (input && input.payload) || {},
    sentAt,
  }
  const v = validateTransportFramePre(frame, { direction: 'out' })
  return v.ok ? { ok: true, frame } : { ok: false, reason: v.reason }
}

// ========== M7-1 index_sync payload validators ==========

const MEMORY_ID_RE = /^mem_[0-9a-f]{32}$/
const HEX64_RE = /^[0-9a-f]{64}$/
const IDX_VERSION_RE = /^idx_pre_[0-9a-f]{32}$/
const WORKSPACE_REF_RE = /^wsr_[0-9a-f]{32}$/
/** 与 M5/M6 同一相对引用白名单(user:/workspace:/workspace-log:+文件名)。 */
const SOURCE_REF_RE = new RegExp('^(user|workspace|workspace-log):[A-Za-z0-9._\\u4e00-\\u9fff-]+$')

/**
 * SemanticRecordPre 校验(§8.4):全字段硬校验;授权 text 为必填字符串(边界由 JS 决定)。
 */
export function validateSemanticRecordPre(rec) {
  const p = []
  if (!rec || typeof rec !== 'object' || Array.isArray(rec)) return { ok: false, reason: 'not-object' }
  if (typeof rec.memoryId !== 'string' || !MEMORY_ID_RE.test(rec.memoryId)) p.push('memoryId')
  if (typeof rec.anchorId !== 'string' || !rec.anchorId) p.push('anchorId')
  if (rec.scope !== 'Workspace' && rec.scope !== 'User') p.push('scope')
  if (typeof rec.workspaceRef !== 'string' || !WORKSPACE_REF_RE.test(rec.workspaceRef)) p.push('workspaceRef')
  if (typeof rec.sourceRef !== 'string' || !SOURCE_REF_RE.test(rec.sourceRef)) p.push('sourceRef')
  if (typeof rec.sourceEpoch !== 'string' || !rec.sourceEpoch) p.push('sourceEpoch')
  if (!Number.isInteger(rec.sourceVersion) || rec.sourceVersion < 1) p.push('sourceVersion')
  if (typeof rec.fileDigest !== 'string' || !HEX64_RE.test(rec.fileDigest)) p.push('fileDigest')
  if (typeof rec.recordDigest !== 'string' || !HEX64_RE.test(rec.recordDigest)) p.push('recordDigest')
  if (rec.heading !== undefined && rec.heading !== null && typeof rec.heading !== 'string') p.push('heading')
  if (typeof rec.text !== 'string') p.push('text')
  if (rec.occurredAt !== undefined && rec.occurredAt !== null && !Number.isFinite(rec.occurredAt)) p.push('occurredAt')
  if (typeof rec.chunkId !== 'string' || !rec.chunkId.startsWith('chk_pre_')) p.push('chunkId')
  if (!Number.isInteger(rec.chunkOrdinal) || rec.chunkOrdinal < 0) p.push('chunkOrdinal')
  if (!Number.isInteger(rec.chunkCount) || rec.chunkCount < 1 || rec.chunkOrdinal >= rec.chunkCount) p.push('chunkCount')
  if (p.length) return { ok: false, reason: 'invalid:' + p.join(',') }
  return { ok: true, record: rec }
}

/** IndexSyncBeginPre payload 校验(§8.4)。 */
export function validateIndexSyncBeginPre(pl) {
  const p = []
  if (!pl || typeof pl !== 'object') return { ok: false, reason: 'not-object' }
  if (pl.schemaVersion !== 1) p.push('schemaVersion')
  if (typeof pl.syncId !== 'string' || !pl.syncId.startsWith('syn_pre_')) p.push('syncId')
  if (typeof pl.workspaceRef !== 'string' || !WORKSPACE_REF_RE.test(pl.workspaceRef)) p.push('workspaceRef')
  if (pl.scope !== 'Workspace' && pl.scope !== 'User') p.push('scope')
  if (typeof pl.memoryIndexVersion !== 'string' || !IDX_VERSION_RE.test(pl.memoryIndexVersion)) p.push('memoryIndexVersion')
  if (!Array.isArray(pl.sourceTuples)) p.push('sourceTuples')
  else {
    for (const t of pl.sourceTuples) {
      if (!t || typeof t !== 'object' || Array.isArray(t)) { p.push('sourceTuples.entry'); break }
      if (typeof t.sourceRef !== 'string' || !SOURCE_REF_RE.test(t.sourceRef)) { p.push('sourceTuples.sourceRef'); break }
      if (typeof t.sourceEpoch !== 'string' || !t.sourceEpoch) { p.push('sourceTuples.sourceEpoch'); break }
      if (!Number.isInteger(t.sourceVersion) || t.sourceVersion < 1) { p.push('sourceTuples.sourceVersion'); break }
      if (typeof t.fileDigest !== 'string' || !HEX64_RE.test(t.fileDigest)) { p.push('sourceTuples.fileDigest'); break }
    }
  }
  if (!Number.isInteger(pl.recordCount) || pl.recordCount < 0) p.push('recordCount')
  if (!Number.isInteger(pl.pageCount) || pl.pageCount < 0) p.push('pageCount')
  if (pl.indexPolicyVersion !== M7_INDEX_POLICY_VERSION_PRE_V1) p.push('indexPolicyVersion')
  if (!p.length && (pl.recordCount === 0) !== (pl.pageCount === 0)) p.push('count-consistency')
  if (p.length) return { ok: false, reason: 'invalid:' + p.join(',') }
  return { ok: true, payload: pl }
}

/** IndexSyncPagePre payload 校验(digest 形状在此;内容一致性由 worker 端状态机判)。 */
export function validateIndexSyncPagePre(pl) {
  const p = []
  if (!pl || typeof pl !== 'object') return { ok: false, reason: 'not-object' }
  if (pl.schemaVersion !== 1) p.push('schemaVersion')
  if (typeof pl.syncId !== 'string' || !pl.syncId.startsWith('syn_pre_')) p.push('syncId')
  if (!Number.isInteger(pl.pageNo) || pl.pageNo < 0) p.push('pageNo')
  if (!Number.isInteger(pl.pageCount) || pl.pageCount < 0) p.push('pageCount')
  if (typeof pl.pageDigest !== 'string' || !HEX64_RE.test(pl.pageDigest)) p.push('pageDigest')
  if (!Array.isArray(pl.records)) p.push('records')
  else if (pl.records.some((r) => !validateSemanticRecordPre(r).ok)) p.push('records.entry')
  if (p.length) return { ok: false, reason: 'invalid:' + p.join(',') }
  return { ok: true, payload: pl }
}

/** IndexSyncCommitPre payload 校验。 */
export function validateIndexSyncCommitPre(pl) {
  const p = []
  if (!pl || typeof pl !== 'object') return { ok: false, reason: 'not-object' }
  if (pl.schemaVersion !== 1) p.push('schemaVersion')
  if (typeof pl.syncId !== 'string' || !pl.syncId.startsWith('syn_pre_')) p.push('syncId')
  if (typeof pl.memoryIndexVersion !== 'string' || !IDX_VERSION_RE.test(pl.memoryIndexVersion)) p.push('memoryIndexVersion')
  if (typeof pl.finalDigest !== 'string' || !HEX64_RE.test(pl.finalDigest)) p.push('finalDigest')
  if (p.length) return { ok: false, reason: 'invalid:' + p.join(',') }
  return { ok: true, payload: pl }
}

/** index_ack payload 校验(phase ∈ begin|page|commit;accepted=false 时必有 reason)。 */
export function validateIndexAckPayloadPre(pl) {
  const p = []
  if (!pl || typeof pl !== 'object') return { ok: false, reason: 'not-object' }
  if (pl.schemaVersion !== 1) p.push('schemaVersion')
  if (typeof pl.syncId !== 'string' || !pl.syncId.startsWith('syn_pre_')) p.push('syncId')
  if (!['begin', 'page', 'commit'].includes(pl.phase)) p.push('phase')
  if (typeof pl.accepted !== 'boolean') p.push('accepted')
  if (pl.accepted === false && (typeof pl.reason !== 'string' || !pl.reason)) p.push('reason')
  if (pl.pageNo !== undefined && !Number.isInteger(pl.pageNo)) p.push('pageNo')
  if (typeof pl.memoryIndexVersion !== 'string' || !IDX_VERSION_RE.test(pl.memoryIndexVersion)) p.push('memoryIndexVersion')
  if (typeof pl.workspaceRef !== 'string' || !WORKSPACE_REF_RE.test(pl.workspaceRef)) p.push('workspaceRef')
  if (pl.scope !== 'Workspace' && pl.scope !== 'User') p.push('scope')
  if (p.length) return { ok: false, reason: 'invalid:' + p.join(',') }
  return { ok: true, payload: pl }
}

// ========== M7-1 canonical identity ==========

/** 派生 chunk 身份(占位 chunking=整记录单 chunk;M7-2 tokenizer 落地前冻结此派生规则)。 */
export function buildChunkIdPre(memoryId, recordDigest) {
  return 'chk_pre_' + first32(sha256Str(JSON.stringify(['semantic-chunk-pre-v1', String(memoryId || ''), String(recordDigest || '')])))
}

/** syncId:由 workspaceRef+scope+memoryIndexVersion+recordCount 确定(同快照重放同 id)。 */
export function buildSyncIdPre(workspaceRef, scope, memoryIndexVersion, recordCount) {
  return 'syn_pre_' + first32(sha256Str(JSON.stringify(['index-sync-pre-v1', String(workspaceRef || ''), String(scope || ''), String(memoryIndexVersion || ''), Number(recordCount) | 0])))
}

/** pageDigest = sha256(canonical(records 数组))。 */
export function computePageDigestPre(records) {
  return sha256Canonical(Array.isArray(records) ? records : [])
}

/**
 * finalDigest = sha256(canonical({kind,syncId,memoryIndexVersion,workspaceRef,scope,recordCount,pageCount,pageDigests}))。
 * worker 端用收到的已验证页重算同一函数;不一致即拒绝整次 sync。
 */
export function computeFinalDigestPre(input) {
  return sha256Canonical({
    kind: 'index_sync_final_pre_v1',
    syncId: String(input.syncId || ''),
    memoryIndexVersion: String(input.memoryIndexVersion || ''),
    workspaceRef: String(input.workspaceRef || ''),
    scope: String(input.scope || ''),
    recordCount: Number(input.recordCount) | 0,
    pageCount: Number(input.pageCount) | 0,
    pageDigests: Array.isArray(input.pageDigests) ? input.pageDigests : [],
  })
}

/** ContextAckPre 观测身份回显检查(sink 用;observationId 必须与请求一致才算有效 ack)。 */
export function ackMatchesObservationPre(ack, observationId) {
  return !!(ack && typeof ack === 'object' && ack.observationId === observationId)
}

/** 静态卫生自检(测试用):剥离注释后确认本模块无进程/网络原语(词面拆分避免自匹配)。 */
export function wireModuleHygieneOk(sourceText) {
  const code = String(sourceText || '').replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^\s*\/\/.*$/gm, ' ')
  const BS = String.fromCharCode(92)
  const LPAREN = String.fromCharCode(40)
  const pat = ['child' + '_process', 'node:' + 'net', 'node:' + 'http', 'http' + '.request', 'spaw' + 'n', 'exec' + 'File', 'fetch' + BS + LPAREN].join('|')
  return !new RegExp(pat).test(code)
}

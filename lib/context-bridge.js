/**
 * M5-1 Context / Evidence Bridge 纯核心(docs/M5-CONTRACT.md §4-§11)。
 * 零 IO、零依赖(除 node:crypto);不接 Host、不写文件、不启动 Python、不改 prompt。
 *
 * 组成:
 *   1) 策略/预算常量(CONTEXT_BRIDGE_BUDGET_V1 / 版本化词典)
 *   2) ContextSegmentPre / AuthorizedMemoryRefPre / EvidenceAggregatePre validator
 *   3) ContextPushEnvelopePre validator + canonical identity(observationId)
 *   4) AccessEvidencePre validator + deterministic evidenceId
 *   5) read coverage adapter(M3 UTF-8 byte 半开区间 + 归一化包含判定;freshness 门)
 *   6) 六类证据纯构造器(seen 仅供 M6 delivered 后调用;cite/correction 文本扫描;
 *      reuse/success 身份对齐 episode tracker —— precision-first,只认显式身份 token)
 *   7) Null/Fake ContextSinkPre(fake 只记录 canonical frame,零进程零网络)
 *   8) push bridge(observationId 幂等 + latest-wins supersede + abort)
 *   9) replay pure core(canonical 输出排除墙钟)
 * 全部函数同输入逐字段确定;所有文本 UTF-8 无 BOM。
 */
import { createHash } from 'node:crypto'
import { sanitizeExcerpt, NAMESPACE } from './shadow-retrieval.js'

const sha256Hex = (buf) => createHash('sha256').update(buf).digest('hex')
const sha256Str = (s) => sha256Hex(Buffer.from(String(s), 'utf8'))
const first32 = (h) => h.slice(0, 32)
const clamp01 = (x) => Math.max(0, Math.min(1, Number(x) || 0))

export { NAMESPACE }
export const CONTEXT_BRIDGE_POLICY_VERSION = 'context_bridge_v1'
export const EVIDENCE_POLICY_VERSION = 'evidence_v1'
export const OBSERVATION_PREFIX = 'obs_'
export const EVIDENCE_PREFIX = 'ev_'

/** §4 budget(冻结;变更必须升级 contextPolicyVersion)。 */
export const CONTEXT_BRIDGE_BUDGET_V1 = Object.freeze({
  maxSegments: 8,
  maxInputBytes: 4096,
  maxMemoryRefs: 8,
  maxEvidenceItems: 16,
  excerptBytes: 480,
  frameMaxBytes: 64 * 1024,
  deadlineMs: 5000,
  sentObservationIds: 256,
})

/** §6 AccessKindPre 枚举。 */
export const ACCESS_KINDS_V1 = Object.freeze(['seen', 'read', 'cite', 'reuse', 'success', 'correction'])

/** §5 ContextAckPre reason 枚举(版本化)。 */
export const ACK_REASONS_V1 = Object.freeze(['ok', 'disabled', 'busy', 'unsupported', 'oversize', 'stale'])

/** §7 cite 引用分类器 v1:只认完整 memoryId token(保守;变更必须升级版本)。 */
export const CITATION_MEMORY_ID_PATTERN_V1 = /mem_[0-9a-f]{32}/g

/** §7 correction 分类器 v1 冻结词典(用户纠正/拒绝/反例;precision-first)。 */
export const CORRECTION_LEXICON_V1 = Object.freeze([
  '不对', '错了', '不是这样', '反了', '纠正', '过时', '失效', '别再用', '作废',
  'wrong', 'incorrect', 'not right', 'actually no', 'outdated', 'deprecated', 'obsolete', 'disagree',
])

// ========== validators ==========

const MEMORY_ID_RE = /^mem_[0-9a-f]{32}$/
const HEX64_RE = /^[0-9a-f]{64}$/
/** sourceRef 只允许稳定相对引用(user:/workspace:/workspace-log:+文件名;禁止绝对路径)。 */
const SOURCE_REF_RE = new RegExp('^(user|workspace|workspace-log):[A-Za-z0-9._\\u4e00-\\u9fff-]+$')

/** ContextSegmentPre 校验(§4)。 */
export function validateContextSegmentPre(seg) {
  const p = []
  if (!seg || typeof seg !== 'object') return { ok: false, reason: 'not-object' }
  if (typeof seg.segmentId !== 'string' || !seg.segmentId) p.push('segmentId')
  if (typeof seg.digest !== 'string' || seg.digest.length < 16) p.push('digest')
  if (!['user', 'tool_call', 'tool_result', 'assistant', 'reasoning'].includes(seg.kind)) p.push('kind')
  if (!Number.isInteger(seg.eventSeq) || seg.eventSeq < 0) p.push('eventSeq')
  if (!Number.isInteger(seg.contextVersion) || seg.contextVersion < 0) p.push('contextVersion')
  if (typeof seg.ts !== 'number' || !Number.isFinite(seg.ts)) p.push('ts')
  if (typeof seg.text !== 'string') p.push('text')
  if (seg.toolName !== undefined && seg.toolName !== null && typeof seg.toolName !== 'string') p.push('toolName')
  if (seg.toolOk !== undefined && seg.toolOk !== null && typeof seg.toolOk !== 'boolean') p.push('toolOk')
  if (seg.errorName !== undefined && seg.errorName !== null && typeof seg.errorName !== 'string') p.push('errorName')
  if (seg.errorCode !== undefined && seg.errorCode !== null && typeof seg.errorCode !== 'string') p.push('errorCode')
  if (p.length) return { ok: false, reason: 'invalid:' + p.join(',') }
  return { ok: true, segment: seg }
}

/** AuthorizedMemoryRefPre 校验(§4;scope 仅 Workspace|User;provenance 全链必填)。 */
export function validateAuthorizedMemoryRefPre(ref) {
  const p = []
  if (!ref || typeof ref !== 'object') return { ok: false, reason: 'not-object' }
  if (typeof ref.memoryId !== 'string' || !MEMORY_ID_RE.test(ref.memoryId)) p.push('memoryId')
  if (typeof ref.anchorId !== 'string' || !ref.anchorId) p.push('anchorId')
  if (ref.scope !== 'Workspace' && ref.scope !== 'User') p.push('scope')
  if (typeof ref.sourceRef !== 'string' || !SOURCE_REF_RE.test(ref.sourceRef)) p.push('sourceRef')
  if (typeof ref.sourceEpoch !== 'string' || !ref.sourceEpoch) p.push('sourceEpoch')
  if (!Number.isInteger(ref.sourceVersion) || ref.sourceVersion < 1) p.push('sourceVersion')
  if (typeof ref.fileDigest !== 'string' || !HEX64_RE.test(ref.fileDigest)) p.push('fileDigest')
  if (typeof ref.recordDigest !== 'string' || !HEX64_RE.test(ref.recordDigest)) p.push('recordDigest')
  if (ref.excerpt !== undefined) {
    if (typeof ref.excerpt !== 'string') p.push('excerpt')
    else if (Buffer.byteLength(ref.excerpt, 'utf8') > CONTEXT_BRIDGE_BUDGET_V1.excerptBytes) p.push('excerpt-budget')
  }
  if (p.length) return { ok: false, reason: 'invalid:' + p.join(',') }
  return { ok: true, ref }
}

/** EvidenceAggregatePre 校验(§11)。 */
export function validateEvidenceAggregatePre(a) {
  const p = []
  if (!a || typeof a !== 'object') return { ok: false, reason: 'not-object' }
  if (typeof a.memoryId !== 'string' || !MEMORY_ID_RE.test(a.memoryId)) p.push('memoryId')
  if (a.scope !== 'Workspace' && a.scope !== 'User') p.push('scope')
  if (!['fresh', 'stale', 'unknown'].includes(a.freshness)) p.push('freshness')
  for (const k of ['distinctSessions', 'seen', 'read', 'cite', 'reuse', 'success', 'correction']) {
    if (!Number.isInteger(a[k]) || a[k] < 0) p.push(k)
  }
  if (typeof a.lastEvidenceAt !== 'number' || !Number.isFinite(a.lastEvidenceAt)) p.push('lastEvidenceAt')
  if (a.policyVersion !== EVIDENCE_POLICY_VERSION) p.push('policyVersion')
  if (p.length) return { ok: false, reason: 'invalid:' + p.join(',') }
  return { ok: true, aggregate: a }
}
/** AccessEvidencePre 校验(§6 全 schema)。 */
export function validateAccessEvidencePre(ev) {
  const p = []
  if (!ev || typeof ev !== 'object') return { ok: false, reason: 'not-object' }
  if (ev.schemaVersion !== 1) p.push('schemaVersion')
  if (ev.namespace !== NAMESPACE) p.push('namespace')
  if (typeof ev.evidenceId !== 'string' || !ev.evidenceId.startsWith(EVIDENCE_PREFIX)) p.push('evidenceId')
  if (!ACCESS_KINDS_V1.includes(ev.kind)) p.push('kind')
  if (typeof ev.memoryId !== 'string' || !MEMORY_ID_RE.test(ev.memoryId)) p.push('memoryId')
  if (typeof ev.anchorId !== 'string' || !ev.anchorId) p.push('anchorId')
  if (!['Session', 'Workspace', 'User'].includes(ev.scope)) p.push('scope')
  if (typeof ev.workspaceKey !== 'string' || !ev.workspaceKey) p.push('workspaceKey')
  const e = ev.event
  if (!e || typeof e !== 'object') p.push('event')
  else {
    if (typeof e.sessionId !== 'string' || !e.sessionId) p.push('event.sessionId')
    if (!Number.isInteger(e.eventSeq) || e.eventSeq < 0) p.push('event.eventSeq')
    if (e.nativeSeq !== undefined && !Number.isInteger(e.nativeSeq)) p.push('event.nativeSeq')
    if (!Number.isInteger(e.contextVersion) || e.contextVersion < 0) p.push('event.contextVersion')
    if (e.callId !== undefined && e.callId !== null && typeof e.callId !== 'string') p.push('event.callId')
    if (typeof e.ts !== 'number' || !Number.isFinite(e.ts)) p.push('event.ts')
  }
  const s = ev.source
  if (!s || typeof s !== 'object') p.push('source')
  else {
    if (typeof s.sourceRef !== 'string' || !SOURCE_REF_RE.test(s.sourceRef)) p.push('source.sourceRef')
    if (typeof s.sourceEpoch !== 'string' || !s.sourceEpoch) p.push('source.sourceEpoch')
    if (!Number.isInteger(s.sourceVersion) || s.sourceVersion < 1) p.push('source.sourceVersion')
    if (typeof s.fileDigest !== 'string' || !HEX64_RE.test(s.fileDigest)) p.push('source.fileDigest')
    if (typeof s.recordDigest !== 'string' || !HEX64_RE.test(s.recordDigest)) p.push('source.recordDigest')
  }
  if (ev.coverage !== undefined && (typeof ev.coverage !== 'number' || ev.coverage < 0 || ev.coverage > 1)) p.push('coverage')
  if (ev.episodeId !== undefined && ev.episodeId !== null && typeof ev.episodeId !== 'string') p.push('episodeId')
  if (ev.policyVersion !== EVIDENCE_POLICY_VERSION) p.push('policyVersion')
  if (p.length) return { ok: false, reason: 'invalid:' + p.join(',') }
  return { ok: true, evidence: ev }
}

/** §4 canonical identity:observationId 由 sessionId+contextVersion+trigger digest+policy 决定。 */
export function buildObservationId(sessionId, contextVersion, triggerDigest, policyVersion = CONTEXT_BRIDGE_POLICY_VERSION) {
  const parts = ['context-push-pre-v1', String(sessionId || ''), Number(contextVersion) || 0, String(triggerDigest || ''), policyVersion]
  return OBSERVATION_PREFIX + first32(sha256Str(JSON.stringify(parts)))
}

/** §9 幂等 identity:evidenceId 由 kind/memory/session 坐标/policy 决定(同事件重放同 id)。 */
export function buildEvidenceId(input) {
  const parts = ['access-evidence-v1', input.kind, input.memoryId, String(input.sessionId || ''), input.eventSeq | 0,
    input.nativeSeq === undefined ? null : input.nativeSeq, input.callId || null, input.contextVersion | 0,
    String(input.workspaceKey || ''), input.policyVersion || EVIDENCE_POLICY_VERSION]
  return EVIDENCE_PREFIX + first32(sha256Str(JSON.stringify(parts)))
}

// ========== §8 coverage adapter(M3 byte-range 语义 + freshness 门) ==========

/**
 * M3 UTF-8 byte 半开区间 [start,end) 重叠覆盖率:overlap/(recordBytes);无重叠=0。
 */
export function computeRangeCoverage(record, range) {
  const rs = Number(record && record.byteStart), re = Number(record && record.byteEnd)
  const gs = Number(range && range.start), ge = Number(range && range.end)
  if (![rs, re, gs, ge].every(Number.isFinite)) return { coverage: 0 }
  const overlap = Math.min(re, ge) - Math.max(rs, gs)
  const len = Math.max(1, re - rs)
  return { coverage: clamp01(Math.max(0, overlap) / len) }
}

/** 读结果归一化:剥离行首行号前缀(如 ' 123|text'),NFKC。 */
export function normalizeReadText(text) {
  return String(text == null ? '' : text)
    .split(/\r?\n/)
    .map((l) => l.replace(/^\s*\d+\s*[|:)\]〕】]\s?/, ''))
    .join('\n')
    .normalize('NFKC')
}

/**
 * 包含判定(v2):record 归一化文本的最长匹配前缀占全文比例 → [0,1]。
 * 完整包含=1;部分重叠(读结果截断/部分读取)按字节比例单调取值;零重叠=0。
 */
export function computeContainmentCoverage(recordText, readText) {
  const needle = normalizeReadText(recordText).trim()
  if (!needle) return { coverage: 0 }
  const hay = normalizeReadText(readText)
  if (hay.includes(needle)) return { coverage: 1 }
  const chars = [...needle]
  let lo = 0
  let hi = chars.length
  while (lo < hi) {
    const mid = Math.ceil((lo + hi + 1) / 2)
    if (hay.includes(chars.slice(0, mid).join(''))) lo = mid
    else hi = mid - 1
  }
  if (!lo) return { coverage: 0 }
  const matched = chars.slice(0, lo).join('')
  return { coverage: clamp01(Buffer.byteLength(matched, 'utf8') / Buffer.byteLength(needle, 'utf8')) }
}

/**
 * §8 read coverage:freshness 门(observedFileDigest 与记录 provenance 不一致=stale fail closed,不建 evidence)
 * → 每条命中的 memoryId 单独产出 coverage 条目;range 优先,否则文本包含判定。stale ≠ coverage=0。
 */
export function computeReadCoverage(records, read) {
  const out = { ok: true, stale: [], covered: [] }
  const list = Array.isArray(records) ? records : []
  const byMemory = new Map()
  for (const rec of list) {
    if (read && read.observedFileDigest && rec.fileDigest && read.observedFileDigest !== rec.fileDigest) {
      out.stale.push({ memoryId: rec.memoryId, reason: 'stale-source' })
      continue
    }
    let cov = { coverage: 0 }
    if (read && read.range) cov = computeRangeCoverage(rec, read.range)
    else if (read && typeof read.text === 'string' && typeof rec.text === 'string') cov = computeContainmentCoverage(rec.text, read.text)
    if (cov.coverage > 0) {
      byMemory.set(rec.memoryId, { memoryId: rec.memoryId, recordDigest: rec.recordDigest, coverage: cov.coverage, record: rec })
    }
  }
  out.covered = [...byMemory.values()]
  return out
}

// ========== §7 六类证据纯构造器 ==========

/** 通用构造:确定性 evidenceId → AccessEvidencePre(校验失败 fail closed)。 */
export function createAccessEvidencePre(input) {
  const base = {
    schemaVersion: 1,
    namespace: NAMESPACE,
    kind: input.kind,
    memoryId: input.memoryId,
    anchorId: input.anchorId,
    scope: input.scope,
    workspaceKey: input.workspaceKey,
    event: {
      sessionId: input.sessionId,
      eventSeq: input.eventSeq,
      nativeSeq: input.nativeSeq === undefined ? undefined : input.nativeSeq,
      contextVersion: input.contextVersion,
      callId: input.callId === undefined ? undefined : input.callId,
      ts: input.ts,
    },
    source: {
      sourceRef: input.sourceRef,
      sourceEpoch: input.sourceEpoch,
      sourceVersion: input.sourceVersion,
      fileDigest: input.fileDigest,
      recordDigest: input.recordDigest,
    },
    policyVersion: EVIDENCE_POLICY_VERSION,
  }
  if (input.coverage !== undefined) base.coverage = clamp01(input.coverage)
  if (input.episodeId) base.episodeId = String(input.episodeId)
  base.evidenceId = buildEvidenceId({
    kind: base.kind, memoryId: base.memoryId, sessionId: base.event.sessionId,
    eventSeq: base.event.eventSeq, nativeSeq: base.event.nativeSeq, callId: base.event.callId,
    contextVersion: base.event.contextVersion, workspaceKey: base.workspaceKey,
  })
  const v = validateAccessEvidencePre(base)
  return v.ok ? { ok: true, evidence: v.evidence } : { ok: false, reason: v.reason }
}

/**
 * cite 扫描:可见文本中出现的完整 memoryId token(去重排序),且必须能在 knownRecords 中找到
 * 完整 provenance(无可靠 owner 不建 evidence,§3)→ 每个一条 cite evidence。precision-first。
 */
export function createCiteEvidencesFromText(input) {
  const ids = [...new Set(String(input.text == null ? '' : input.text).match(CITATION_MEMORY_ID_PATTERN_V1) || [])].sort()
  const out = []
  for (const mid of ids) {
    const rec = (input.knownRecords || []).find((r) => r.memoryId === mid)
    if (!rec) continue
    const r = createAccessEvidencePre({
      ...input.coords, kind: 'cite', memoryId: mid, anchorId: rec.anchorId, scope: rec.scope,
      sourceRef: rec.sourceRef, sourceEpoch: rec.sourceEpoch, sourceVersion: rec.sourceVersion,
      fileDigest: rec.fileDigest, recordDigest: rec.recordDigest,
    })
    if (r.ok) out.push(r.evidence)
  }
  return out
}

/** correction 扫描:同一文本同时出现完整 memoryId 且命中纠正词典 → 每个一条 correction。 */
export function createCorrectionEvidencesFromText(input) {
  const norm = String(input.text == null ? '' : input.text).normalize('NFKC').replace(/[A-Z]/g, (c) => c.toLowerCase())
  if (!CORRECTION_LEXICON_V1.some((w) => norm.includes(w))) return []
  return createCiteEvidencesFromText(input).map((ev) => ({
    ...ev,
    kind: 'correction',
    evidenceId: buildEvidenceId({
      kind: 'correction', memoryId: ev.memoryId, sessionId: input.coords.sessionId, eventSeq: input.coords.eventSeq,
      nativeSeq: input.coords.nativeSeq, callId: input.coords.callId, contextVersion: input.coords.contextVersion,
      workspaceKey: input.coords.workspaceKey,
    }),
  }))
}

/**
 * reuse/success 身份对齐 tracker(precision-first):
 *   reuse:工具调用参数预览中显式出现已 cite/read 过记忆的 anchorId 或 recordDigest 前 16 位;
 *   success:由调用方在该 callId 的 tools/result ok=true 时落 success(纯函数 createSuccessEvidence)。
 * episodeId 固定为触发对齐的那条历史 evidenceId(可解释回链)。
 */
export class IdentityEpisodeTracker {
  constructor(opts = {}) { this._bySession = new Map(); this._digestLen = opts.digestPrefixLen || 16 }
  _sess(sid) { let m = this._sessMap(sid); return m }
  _sessMap(sid) { let m = this._bySession.get(sid); if (!m) { m = new Map(); this._bySession.set(sid, m) } return m }
  /** 记录一条 cite/read/seen evidence 为可对齐锚点(同 memoryId 保留最新)。 */
  registerAnchor(evidence) {
    if (!evidence || (evidence.kind !== 'cite' && evidence.kind !== 'read' && evidence.kind !== 'seen')) return
    const m = this._sessMap(evidence.event.sessionId)
    const prev = m.get(evidence.memoryId)
    if (!prev || evidence.event.ts >= prev.event.ts) m.set(evidence.memoryId, evidence)
  }
  /** 工具调用对齐检测:返回 [{memoryId, episodeId}](按 memoryId 排序)或空。 */
  alignToolCall(sessionId, toolName, argPreview) {
    void toolName
    const m = this._sessMap(sessionId)
    if (!m.size || !argPreview) return []
    const text = String(argPreview)
    const hits = []
    for (const [memoryId, ev] of m) {
      const digestPrefix = String(ev.source.recordDigest || '').slice(0, this._digestLen)
      if ((ev.anchorId && text.includes(ev.anchorId)) || (digestPrefix.length === this._digestLen && text.includes(digestPrefix))) {
        hits.push({ memoryId, episodeId: ev.evidenceId })
      }
    }
    return hits.sort((a, b) => (a.memoryId < b.memoryId ? -1 : 1))
  }
  clearSession(sessionId) { this._bySession.delete(sessionId) }
}

/** success 构造:reuse episode 之后出现明确工具成功(ok=true)或用户确认。 */
export function createSuccessEvidencePre(input) {
  return createAccessEvidencePre({ ...input, kind: 'success' })
}
// ========== §5 Sinks(Null / Fake) ==========

/** Null sink:关闭态语义——push 永远 accepted:false/disabled,零 IO、零留存。 */
export function createNullContextSinkPre() {
  return {
    kind: 'null',
    async push(frame) {
      const id = frame && frame.observationId ? frame.observationId : ''
      return { observationId: id, accepted: false, reason: 'disabled' }
    },
    async closeSession() {},
    async dispose() {},
  }
}

/**
 * Fake sink:fixtures/replay 用。只在校验后的 canonical frame 上记账(bounded ring),
 * 同一 observationId 只接受一次;零进程、零网络、零 Python。
 */
export function createFakeContextSinkPre(opts = {}) {
  const capacity = Math.max(1, Number(opts.capacity) || 64)
  const frames = []
  const seenIds = new Set()
  const stats = { pushed: 0, accepted: 0, duplicate: 0, closedSessions: 0 }
  return {
    kind: 'fake',
    frames,
    stats,
    async push(frame) {
      stats.pushed++
      const id = frame && frame.observationId ? String(frame.observationId) : ''
      if (seenIds.has(id)) { stats.duplicate++; return { observationId: id, accepted: false, reason: 'busy' } }
      seenIds.add(id)
      frames.push(JSON.parse(JSON.stringify(frame)))
      if (frames.length > capacity) frames.shift()
      stats.accepted++
      return { observationId: id, accepted: true, workerEpoch: 'fake-epoch-pre-v1', reason: 'ok' }
    },
    async closeSession() { stats.closedSessions++ },
    async dispose() { frames.length = 0 },
  }
}

/** ContextAckPre 校验(§5)。 */
export function validateContextAckPre(ack) {
  if (!ack || typeof ack !== 'object') return { ok: false, reason: 'not-object' }
  if (typeof ack.observationId !== 'string' || !ack.observationId) return { ok: false, reason: 'observationId' }
  if (typeof ack.accepted !== 'boolean') return { ok: false, reason: 'accepted' }
  if (ack.workerEpoch !== undefined && typeof ack.workerEpoch !== 'string') return { ok: false, reason: 'workerEpoch' }
  if (ack.reason !== undefined && !ACK_REASONS_V1.includes(ack.reason)) return { ok: false, reason: 'reason' }
  return { ok: true, ack }
}

// ========== §4 envelope builder + push bridge ==========

/** 由 corpus 记录构造授权引用(excerpt 先清洗再预算)。 */
export function buildAuthorizedMemoryRefFromRecord(rec, excerptText) {
  const ref = {
    memoryId: rec.memoryId, anchorId: rec.anchorId, scope: rec.scope,
    sourceRef: rec.sourceRef, sourceEpoch: rec.sourceEpoch, sourceVersion: rec.sourceVersion,
    fileDigest: rec.fileDigest, recordDigest: rec.recordDigest,
  }
  if (excerptText != null) ref.excerpt = sanitizeExcerpt(excerptText)
  const v = validateAuthorizedMemoryRefPre(ref)
  return v.ok ? { ok: true, ref: v.ref } : { ok: false, reason: v.reason }
}

/**
 * 组装并校验 ContextPushEnvelopePre(§4):确定性 observationId;超预算 fail-closed 截断计账。
 * input: {session, cursor, index, trigger, window, memoryRefs, evidence, now, policyVersionGate?, policyVersionLexical?}
 */
export function buildContextPushEnvelopePre(input) {
  const B = CONTEXT_BRIDGE_BUDGET_V1
  const drop = []
  const session = input && input.session ? input.session : {}
  const cursor = input && input.cursor ? input.cursor : {}
  const index = input && input.index ? input.index : {}
  const now = Number.isFinite(input && input.now) ? input.now : Date.now()

  const tv = validateContextSegmentPre(input && input.trigger)
  if (!tv.ok) return { ok: false, reason: 'trigger:' + tv.reason }
  const rawWindow = Array.isArray(input.window) ? input.window : []
  let window = rawWindow.slice(-B.maxSegments).map((w) => validateContextSegmentPre(w))
  if (window.some((w) => !w.ok)) return { ok: false, reason: 'window:' + window.find((w) => !w.ok).reason }
  if (rawWindow.length > B.maxSegments) drop.push('window-truncated')
  const winSegs = window.map((w) => w.segment)
  let inputBytes = winSegs.reduce((a, w) => a + Buffer.byteLength(w.text || '', 'utf8'), 0) + Buffer.byteLength(tv.segment.text || '', 'utf8')
  while (inputBytes > B.maxInputBytes && winSegs.length) {
    const removed = winSegs.shift()
    inputBytes -= Buffer.byteLength(removed.text || '', 'utf8')
    drop.push('window-byte-budget')
  }
  // trigger 自身超预算且无 window 可弃 → fail closed(trigger 文本截断会破坏 digest 一致性)
  if (inputBytes > B.maxInputBytes) return { ok: false, reason: 'trigger-oversize' }

  const rawRefs = Array.isArray(input.memoryRefs) ? input.memoryRefs : []
  let refs = rawRefs.slice(0, B.maxMemoryRefs).map((r) => validateAuthorizedMemoryRefPre(r))
  if (refs.some((r) => !r.ok)) return { ok: false, reason: 'memoryRefs:' + refs.find((r) => !r.ok).reason }
  if (rawRefs.length > B.maxMemoryRefs) drop.push('memory-ref-budget')

  const rawAggs = Array.isArray(input.evidence) ? input.evidence : []
  let aggs = rawAggs.slice(0, B.maxEvidenceItems).map((a) => validateEvidenceAggregatePre(a))
  if (aggs.some((a) => !a.ok)) return { ok: false, reason: 'evidence:' + aggs.find((a) => !a.ok).reason }
  if (rawAggs.length > B.maxEvidenceItems) drop.push('evidence-budget')

  if (!index.memoryIndexVersion || typeof index.memoryIndexVersion !== 'string') return { ok: false, reason: 'memoryIndexVersion' }
  const epochs = Array.isArray(index.sourceEpochs) ? index.sourceEpochs.map(String).sort() : []

  const frame = {
    schemaVersion: 1,
    namespace: NAMESPACE,
    kind: 'context_push',
    observationId: '',
    session: {
      sessionId: String(session.sessionId || ''),
      agentId: String(session.agentId || ''),
      workspaceKey: String(session.workspaceKey || ''),
      scope: session.scope,
    },
    cursor: {
      eventSeq: cursor.eventSeq | 0,
      nativeSeq: cursor.nativeSeq === undefined ? undefined : cursor.nativeSeq,
      contextVersion: cursor.contextVersion | 0,
    },
    index: { memoryIndexVersion: String(index.memoryIndexVersion), sourceEpochs: epochs },
    trigger: tv.segment,
    window: winSegs,
    memoryRefs: refs.map((r) => r.ref),
    evidence: aggs.map((a) => a.aggregate),
    policy: {
      contextPolicyVersion: CONTEXT_BRIDGE_POLICY_VERSION,
      gatePolicyVersion: String(input.policyVersionGate || 'gate_v1'),
      lexicalPolicyVersion: String(input.policyVersionLexical || 'lexical_v2'),
      evidencePolicyVersion: EVIDENCE_POLICY_VERSION,
    },
    budget: { maxSegments: B.maxSegments, maxInputBytes: B.maxInputBytes, maxMemoryRefs: B.maxMemoryRefs, maxEvidenceItems: B.maxEvidenceItems },
    observedAt: now,
    deadlineAt: now + B.deadlineMs,
  }
  if (!['Session', 'Workspace', 'User'].includes(frame.session.scope)) return { ok: false, reason: 'session.scope' }
  if (!frame.session.workspaceKey) return { ok: false, reason: 'session.workspaceKey' }
  if (frame.cursor.nativeSeq !== undefined && !Number.isInteger(frame.cursor.nativeSeq)) return { ok: false, reason: 'cursor.nativeSeq' }
  frame.observationId = buildObservationId(frame.session.sessionId, frame.cursor.contextVersion, frame.trigger.digest)

  let json = JSON.stringify(frame)
  while (Buffer.byteLength(json, 'utf8') > B.frameMaxBytes && frame.window.length) {
    const removed = frame.window.pop()
    inputBytes -= Buffer.byteLength(removed.text || '', 'utf8')
    drop.push('frame-bytes-budget')
    json = JSON.stringify(frame)
  }
  if (Buffer.byteLength(json, 'utf8') > B.frameMaxBytes) return { ok: false, reason: 'frame-oversize' }
  return { ok: true, frame, dropped: drop, inputBytes }
}

/** latest-wins:同 session 新 contextVersion 使旧 in-flight 失效。 */
export function isSuperseded(oldFrame, newFrame) {
  if (!oldFrame || !newFrame) return false
  if (oldFrame.session.sessionId !== newFrame.session.sessionId) return false
  return newFrame.cursor.contextVersion > oldFrame.cursor.contextVersion
}

/** 有界 Set(M5 sentObservationIds 与 M6 deliveredPacketIds 复用;dispose 可清空)。 */
export class BoundedIdSet {
  constructor(capacity) { this.capacity = Math.max(1, Number(capacity) || 256); this._set = new Set() }
  has(id) { return this._set.has(id) }
  add(id) { this._set.add(id); if (this._set.size > this.capacity) { const first = this._set.values().next().value; this._set.delete(first) } }
  get size() { return this._set.size }
  clear() { this._set.clear() }
}

/**
 * Push bridge:observationId 幂等(至多成功发送一次)+ latest-wins 取消 + AbortSignal 贯通。
 * 关闭态应使用 null sink(本桥不判开关);sink 必须是 Null/Fake(M5 禁止 spawn/HTTP/Python 路径)。
 */
export function createContextPushBridge(opts = {}) {
  const sink = opts.sink
  if (!sink || typeof sink.push !== 'function') throw new Error('context-bridge: sink required')
  const signal = opts.signal
  const sent = new BoundedIdSet(CONTEXT_BRIDGE_BUDGET_V1.sentObservationIds)
  const inflight = new Map()
  const stats = { sent: 0, accepted: 0, duplicates: 0, superseded: 0, aborted: 0, errors: 0 }
  async function push(frame) {
    try {
      if (signal && signal.aborted) { stats.aborted++; return { observationId: frame.observationId, accepted: false, reason: 'stale' } }
      if (sent.has(frame.observationId)) { stats.duplicates++; return { observationId: frame.observationId, accepted: false, reason: 'busy' } }
      const prev = inflight.get(frame.session.sessionId)
      if (prev && isSuperseded(prev.frame, frame)) {
        try { prev.controller.abort('superseded') } catch (_) {}
        stats.superseded++
      }
      const controller = new AbortController()
      inflight.set(frame.session.sessionId, { frame, controller })
      sent.add(frame.observationId)
      stats.sent++
      const ack = await sink.push(frame, controller.signal)
      const v = validateContextAckPre(ack)
      if (v.ok && ack.accepted) stats.accepted++
      const cur = inflight.get(frame.session.sessionId)
      if (cur && cur.controller === controller) inflight.delete(frame.session.sessionId)
      return ack
    } catch (e) {
      stats.errors++
      return { observationId: (frame && frame.observationId) || '', accepted: false, reason: 'unsupported' }
    }
  }
  function cancelStale(sessionId, keepContextVersion) {
    const cur = inflight.get(sessionId)
    if (cur && cur.frame.cursor.contextVersion !== keepContextVersion) {
      try { cur.controller.abort('superseded') } catch (_) {}
      inflight.delete(sessionId)
      stats.superseded++
    }
  }
  async function closeSession(sessionId) {
    const cur = inflight.get(sessionId)
    if (cur) { try { cur.controller.abort('session-close') } catch (_) {}; inflight.delete(sessionId) }
    if (typeof sink.closeSession === 'function') await sink.closeSession(sessionId)
  }
  async function dispose(reason) {
    for (const [, cur] of inflight) { try { cur.controller.abort(reason || 'disposed') } catch (_) {} }
    inflight.clear()
    if (typeof sink.dispose === 'function') await sink.dispose(reason)
  }
  return { push, cancelStale, closeSession, dispose, sent, stats, sinkKind: () => sink.kind || 'unknown' }
}
// ========== replay pure core ==========

/**
 * §replay:对 fixture 事件序列跑 classifier → evidence/envelope,输出 canonical 结果。
 * 排除墙钟:ts/now 全部来自 fixture;同输入逐字段确定。sink 为进程内 fake,零 IO。
 */
export function replayContextBridge(input) {
  const events = Array.isArray(input && input.events) ? input.events : []
  const records = Array.isArray(input && input.records) ? input.records : []
  const sink = createFakeContextSinkPre({ capacity: input && input.sinkCapacity })
  const bridge = createContextPushBridge({ sink })
  const results = []
  const tracker = new IdentityEpisodeTracker()
  for (const step of events) {
    const r = { label: step.label }
    if (step.type === 'envelope') {
      const built = buildContextPushEnvelopePre({ ...step.input, now: step.now })
      r.envelopeOk = built.ok
      if (built.ok) {
        r.observationId = built.frame.observationId
        r.dropped = built.dropped
      } else {
        r.reason = built.reason
      }
      results.push(r)
      if (built.ok) step._pendingAck = bridge.push(built.frame)
    } else if (step.type === 'cite' || step.type === 'correction') {
      const maker = step.type === 'cite' ? createCiteEvidencesFromText : createCorrectionEvidencesFromText
      const evs = maker({ coords: { ...step.coords, ts: step.now }, text: step.text, knownRecords: records })
      for (const ev of evs) tracker.registerAnchor(ev)
      r.evidence = evs.map((e) => e.evidenceId)
      results.push(r)
    } else if (step.type === 'align') {
      r.alignments = tracker.alignToolCall(step.sessionId, step.toolName, step.argPreview)
      results.push(r)
    }
  }
  return { results, sink, bridge }
}
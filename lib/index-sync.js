/**
 * M7-1 Authorized index_sync 构造与执行(docs/PYTHON-SIDECAR-CONTRACT.md §8.4;handoff M7-1)。
 * JS 是唯一语料授权者:records 只能由现有 M3/M4 corpus snapshot 投影产生;
 * Python 绝不自行读文件或发现路径(本模块是唯一授权出口)。
 *
 * 约束(冻结):单页 ≤64 records 且 ≤256KiB(JSON 字节);pageDigest=sha256(canonical(records));
 * finalDigest=sha256(canonical(final 对象));同一 sync 的 workspaceRef/scope/memoryIndexVersion 一致。
 * 占位 chunking(M7-2 tokenizer 前冻结):整记录=单 chunk,chunkId 由 memoryId+recordDigest 派生,
 * chunkId 只是派生定位,永不替代 memoryId。本阶段不做 tokenizer/embedding/cosine/BM25/RRF/聚类/图。
 * UTF-8 无 BOM。
 */
import { workspaceRefOf } from './evidence-store.js'
import {
  buildChunkIdPre, buildSyncIdPre, computePageDigestPre, computeFinalDigestPre,
  validateIndexSyncBeginPre, validateIndexSyncPagePre, validateIndexSyncCommitPre, validateSemanticRecordPre,
  M7_INDEX_POLICY_VERSION_V1,
} from './m7-wire.js'

export const INDEX_SYNC_PAGE_BUDGET_V1 = Object.freeze({ maxRecordsPerPage: 64, maxPageBytes: 256 * 1024 })
const SCOPE_ORDER_PRE = ['Workspace', 'User']

function pagePayloadBytes(syncId, pageNo, pageCount, records) {
  return Buffer.byteLength(JSON.stringify({ schemaVersion: 1, syncId, pageNo, pageCount, pageDigest: '0'.repeat(64), records }), 'utf8')
}

/**
 * corpus snapshot 记录 → SemanticRecordPre 授权投影。text 边界即 snapshot 已授权切片;
 * occurredAt 语料无此概念 → null;heading 透传(null 允许)。
 */
export function toSemanticRecordPre(rec, workspaceRef) {
  const out = {
    memoryId: rec.memoryId,
    anchorId: rec.anchorId,
    scope: rec.scope,
    workspaceRef,
    sourceRef: rec.sourceRef,
    sourceEpoch: rec.sourceEpoch,
    sourceVersion: rec.sourceVersion,
    fileDigest: rec.fileDigest,
    recordDigest: rec.recordDigest,
    heading: rec.heading != null ? String(rec.heading) : null,
    text: String(rec.text == null ? '' : rec.text),
    occurredAt: null,
    chunkId: buildChunkIdPre(rec.memoryId, rec.recordDigest),
    chunkOrdinal: 0,
    chunkCount: 1,
  }
  const v = validateSemanticRecordPre(out)
  return v.ok ? { ok: true, record: v.record } : { ok: false, reason: v.reason }
}

/**
 * 由 corpus snapshot 构造按 scope 分组的 index sync 计划。
 * input: {snapshot(m4-corpus CorpusSnapshot), workspaceKey} 或显式 {records, sources, memoryIndexVersion, workspaceKey}。
 * 返回 {ok:true, plans:[{scope, begin, pages[], commit}], recordTotal}|{ok:false, reason}。
 */
export function buildIndexSyncPlansPre(input) {
  const B = INDEX_SYNC_PAGE_BUDGET_V1
  const snap = input && input.snapshot
  const recordsRaw = Array.isArray(input && input.records) ? input.records : (snap ? snap.records : [])
  const sourcesAll = Array.isArray(input && input.sources) ? input.sources : (snap ? snap.sources : [])
  const miv = String((input && input.memoryIndexVersion) || (snap ? snap.memoryIndexVersion : '') || '')
  if (!miv.startsWith('idx_')) return { ok: false, reason: 'memoryIndexVersion' }
  const wsRef = workspaceRefOf(String((input && input.workspaceKey) || ''))
  const byScope = new Map()
  for (const r of recordsRaw) {
    if (!byScope.has(r.scope)) byScope.set(r.scope, [])
    byScope.get(r.scope).push(r)
  }
  const plans = []
  let recordTotal = 0
  for (const scope of SCOPE_ORDER_PRE) {
    const group = byScope.get(scope)
    if (!group || !group.length) continue
    const projected = []
    for (const r of group) {
      const pr = toSemanticRecordPre(r, wsRef)
      if (!pr.ok) return { ok: false, reason: 'record:' + pr.reason + ':' + (r.memoryId || '') }
      projected.push(pr.record)
    }
    projected.sort((a, b) => (a.memoryId < b.memoryId ? -1 : a.memoryId > b.memoryId ? 1 : a.recordDigest < b.recordDigest ? -1 : 1))
    const recordCount = projected.length
    const syncId = buildSyncIdPre(wsRef, scope, miv, recordCount)
    const sourceTuples = sourcesAll
      .filter((s) => s.scope === scope)
      .map((s) => ({ sourceRef: s.sourceRef, sourceEpoch: s.sourceEpoch, sourceVersion: s.sourceVersion, fileDigest: s.fileDigest }))
      .sort((a, b) => (a.sourceRef < b.sourceRef ? -1 : 1))
    // 分页:计数边界 + 字节边界;单条超页预算 → fail closed(record-oversize)
    const pagesRecords = []
    let cur = []
    for (const r of projected) {
      if (cur.length >= B.maxRecordsPerPage) { pagesRecords.push(cur); cur = [] }
      const candidate = [...cur, r]
      if (pagePayloadBytes(syncId, pagesRecords.length, 0, candidate) > B.maxPageBytes) {
        if (!cur.length) return { ok: false, reason: 'record-oversize:' + r.memoryId }
        pagesRecords.push(cur)
        cur = [r]
        if (pagePayloadBytes(syncId, pagesRecords.length, 0, cur) > B.maxPageBytes) {
          return { ok: false, reason: 'record-oversize:' + r.memoryId }
        }
        continue
      }
      cur = candidate
    }
    if (cur.length) pagesRecords.push(cur)
    const pageCount = pagesRecords.length
    const begin = {
      schemaVersion: 1, syncId, workspaceRef: wsRef, scope, memoryIndexVersion: miv,
      sourceTuples, recordCount, pageCount, indexPolicyVersion: M7_INDEX_POLICY_VERSION_V1,
    }
    const bv = validateIndexSyncBeginPre(begin)
    if (!bv.ok) return { ok: false, reason: 'begin:' + bv.reason }
    const pageDigests = []
    const pages = pagesRecords.map((recs, i) => {
      const pageDigest = computePageDigestPre(recs)
      pageDigests.push(pageDigest)
      return { schemaVersion: 1, syncId, pageNo: i, pageCount, pageDigest, records: recs }
    })
    for (const p of pages) {
      const pv = validateIndexSyncPagePre(p)
      if (!pv.ok) return { ok: false, reason: 'page:' + pv.reason }
    }
    const commit = { schemaVersion: 1, syncId, memoryIndexVersion: miv, finalDigest: computeFinalDigestPre({
      syncId, memoryIndexVersion: miv, workspaceRef: wsRef, scope, recordCount, pageCount, pageDigests,
    }) }
    const cv = validateIndexSyncCommitPre(commit)
    if (!cv.ok) return { ok: false, reason: 'commit:' + cv.reason }
    plans.push({ scope, begin, pages, commit })
    recordTotal += recordCount
  }
  return { ok: true, plans, recordTotal, workspaceRef: wsRef, memoryIndexVersion: miv }
}

/**
 * 顺序执行一个 sync 计划(begin→每页→commit;任一 index_ack accepted=false 即中止并返回失败原因)。
 * 返回 {ok:true, acks:[...], recordCount}|{ok:false, phase, reason, acks}。
 */
export async function sendIndexSyncPlanPre(client, plan, opts = {}) {
  const timeoutMs = Number(opts.timeoutMs) || undefined
  const signal = opts.signal
  const acks = []
  async function step(type, payload) {
    const res = await client.request(type, payload, { timeoutMs, signal })
    const frame = res.ok ? res.frame : null
    const ackPayload = frame ? frame.payload : null
    acks.push(frame ? JSON.parse(JSON.stringify(frame)) : { error: res.code })
    if (!res.ok) return { ok: false, transportCode: res.code }
    if (!ackPayload || ackPayload.accepted !== true) return { ok: false, reason: (ackPayload && ackPayload.reason) || 'rejected' }
    return { ok: true }
  }
  let r = await step('index_sync_begin', plan.begin)
  if (!r.ok) return { ok: false, phase: 'begin', ...r, acks }
  for (const page of plan.pages) {
    r = await step('index_sync_page', page)
    if (!r.ok) return { ok: false, phase: 'page', pageNo: page.pageNo, ...r, acks }
  }
  r = await step('index_sync_commit', plan.commit)
  if (!r.ok) return { ok: false, phase: 'commit', ...r, acks }
  return { ok: true, acks, recordCount: plan.begin.recordCount, syncId: plan.begin.syncId, scope: plan.scope }
}

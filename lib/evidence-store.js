/**
 * M5-2 Evidence Store + Aggregate(docs/M5-CONTRACT.md §8-§11)。
 * append-only events(JSONL 按日分片)+隐私投影(sessionRef/workspaceRef 哈希;无原文/无绝对路径/
 * 无裸 sessionId/workspaceKey/excerpt)+retention(30 天/32MiB)+aggregate rebuild(fresh/stale/unknown)。
 * events 为唯一权威;aggregate 是可重建派生物。默认不构造不落盘;测试用临时 DSH_HOME 注入 root。
 * 零第三方依赖(node:fs/path/crypto);UTF-8 无 BOM。
 */
import { mkdirSync, appendFileSync, readdirSync, readFileSync, statSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
import {
  validateAccessEvidencePre, validateEvidenceAggregatePre, EVIDENCE_POLICY_VERSION, NAMESPACE, BoundedIdSet,
} from './context-bridge.js'

const sha256Str = (s) => createHash('sha256').update(Buffer.from(String(s), 'utf8')).digest('hex')
const first32 = (h) => h.slice(0, 32)

/** §10 持久化策略(冻结)。 */
export const EVIDENCE_STORE_POLICY_V1 = Object.freeze({
  schemaVersion: 1,
  storePolicyVersion: 'evidence_store_v1',
  keepDays: 30,
  maxTotalBytes: 32 * 1024 * 1024,
  eventMaxBytes: 16 * 1024,
  appendedIdCache: 4096,
})

/** 稳定 workspaceKey 规范化(与 m4-corpus canonical 同规则:resolve+正斜杠+小写)。 */
export function canonicalWorkspaceKey(key) {
  return path.resolve(String(key == null ? '' : key)).replace(/\\/g, '/').toLowerCase()
}

/** §10 隐私投影:sessionId → plugin-local sessionRef(不可逆哈希;跨文件稳定)。 */
export function sessionRefOf(sessionId) {
  return 'sesr_' + first32(sha256Str('evidence-sesref-pre-v1\u0000' + String(sessionId || '')))
}

/** §10 隐私投影:workspace 绝对键 → 稳定 workspaceRef(不落盘任何绝对路径)。 */
export function workspaceRefOf(workspaceKey) {
  return 'wsr_' + first32(sha256Str('evidence-wsref-pre-v1\u0000' + canonicalWorkspaceKey(workspaceKey)))
}

/**
 * §10 durable projection:evidence → 落盘形态。删除裸 sessionId/workspaceKey;
 * sourceRef 已由 validator 限定为相对引用(user:/workspace:/workspace-log:+文件名)。
 * 返回 {ok, projected} 或 {ok:false, reason}(invalid-evidence/oversize)。
 */
export function projectEvidenceForDurable(ev, opts = {}) {
  const v = validateAccessEvidencePre(ev)
  if (!v.ok) return { ok: false, reason: 'invalid-evidence:' + v.reason }
  const maxBytes = Number(opts.eventMaxBytes) || EVIDENCE_STORE_POLICY_V1.eventMaxBytes
  const projected = {
    schemaVersion: 1,
    namespace: NAMESPACE,
    storePolicyVersion: EVIDENCE_STORE_POLICY_V1.storePolicyVersion,
    evidenceId: ev.evidenceId,
    kind: ev.kind,
    memoryId: ev.memoryId,
    anchorId: ev.anchorId,
    scope: ev.scope,
    workspaceRef: workspaceRefOf(ev.workspaceKey),
    event: {
      sessionRef: sessionRefOf(ev.event.sessionId),
      eventSeq: ev.event.eventSeq,
      nativeSeq: ev.event.nativeSeq === undefined ? undefined : ev.event.nativeSeq,
      contextVersion: ev.event.contextVersion,
      callId: ev.event.callId === undefined ? undefined : ev.event.callId,
      ts: ev.event.ts,
    },
    source: {
      sourceRef: ev.source.sourceRef,
      sourceEpoch: ev.source.sourceEpoch,
      sourceVersion: ev.source.sourceVersion,
      fileDigest: ev.source.fileDigest,
      recordDigest: ev.source.recordDigest,
    },
    policyVersion: ev.policyVersion,
    recordedAt: Number.isFinite(opts.now) ? opts.now : Date.now(),
  }
  if (ev.coverage !== undefined) projected.coverage = ev.coverage
  if (ev.episodeId !== undefined && ev.episodeId !== null) projected.episodeId = ev.episodeId
  const json = JSON.stringify(projected)
  if (Buffer.byteLength(json, 'utf8') > maxBytes) return { ok: false, reason: 'event-oversize' }
  return { ok: true, projected, line: json }
}

/** 从投影行还原成 rebuild 输入(无原始 sessionId;distinctSessions 以 sessionRef 计数)。 */
export function parseDurableEventLine(line) {
  try {
    const j = JSON.parse(line)
    if (!j || typeof j !== 'object' || !j.evidenceId || !j.kind || !j.memoryId) return { ok: false }
    return { ok: true, event: j }
  } catch (_) { return { ok: false } }
}

// ========== Store(appen-only JSONL,engine 级串行链) ==========

export class EvidenceEventStore {
  constructor(opts = {}) {
    this.root = opts.root || null
    this.eventsDir = opts.eventsDir || (this.root ? path.join(this.root, 'events') : null)
    this._chain = Promise.resolve()
    this._appended = new BoundedIdSet(EVIDENCE_STORE_POLICY_V1.appendedIdCache)
    this._swept = false
    this.stats = { appended: 0, duplicates: 0, oversize: 0, invalid: 0, writeFailed: 0, sweptFiles: 0, lastWriteError: null }
  }

  /** §9 幂等:同 evidenceId 进程内只落盘一次(seed replay 与 live 双喂安全网;磁盘侧靠 rebuild 去重兜底)。 */
  async append(evidence, opts = {}) {
    if (!this.eventsDir) return { ok: false, reason: 'store-not-configured' }
    const id = evidence && evidence.evidenceId
    if (id && this._appended.has(id)) { this.stats.duplicates++; return { ok: false, reason: 'duplicate-evidence', evidenceId: id } }
    const proj = projectEvidenceForDurable(evidence, { now: opts.now })
    if (!proj.ok) {
      if (proj.reason === 'event-oversize') this.stats.oversize++
      else this.stats.invalid++
      return proj
    }
    if (id) this._appended.add(id)
    this._chain = this._chain.then(() => this._writeLine(proj.line))
    return this._chain.then((written) => ({ ok: written, reason: written ? 'ok' : 'write-failed', evidenceId: id, projected: proj.projected }))
  }

  async _writeLine(line) {
    try {
      mkdirSync(this.eventsDir, { recursive: true })
      const d = new Date()
      const fname = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0') + '.jsonl'
      appendFileSync(path.join(this.eventsDir, fname), line + '\n', 'utf8')
      this.stats.appended++
      this.sweepRetention()
      return true
    } catch (e) {
      this.stats.writeFailed++
      this.stats.lastWriteError = String(e && e.message ? e.message : e)
      try { console.error('[evidence-store] write-failed: ' + this.stats.lastWriteError) } catch (_) {}
      return false
    }
  }

  /** §10 retention:保留 keepDays 天且总量 ≤maxTotalBytes;只清 events 分片。每进程至多全扫一次。 */
  sweepRetention(force = false) {
    if (this._swept && !force) return
    this._swept = true
    try {
      const now = Date.now()
      let total = 0
      const files = []
      for (const f of readdirSync(this.eventsDir)) {
        if (!f.endsWith('.jsonl')) continue
        const fp = path.join(this.eventsDir, f)
        const st = statSync(fp)
        total += st.size
        files.push({ fp, mtimeMs: st.mtimeMs, size: st.size })
      }
      files.sort((a, b) => a.mtimeMs - b.mtimeMs)
      for (const f of files) {
        const ageDays = (now - f.mtimeMs) / 86400000
        if (ageDays > EVIDENCE_STORE_POLICY_V1.keepDays || total > EVIDENCE_STORE_POLICY_V1.maxTotalBytes) {
          try { rmSync(f.fp, { force: true }); this.stats.sweptFiles++; total -= f.size } catch (_) {}
        } else break
      }
    } catch (_) {}
  }

  /** 读回全部事件(旧→新按文件名排序;坏行跳过计数)。 */
  loadEvents() {
    const out = []
    let badLines = 0
    try {
      const files = readdirSync(this.eventsDir).filter((f) => f.endsWith('.jsonl')).sort()
      for (const f of files) {
        const text = readFileSync(path.join(this.eventsDir, f), 'utf8')
        for (const line of text.split('\n')) {
          if (!line.trim()) continue
          const p = parseDurableEventLine(line)
          if (p.ok) out.push(p.event)
          else badLines++
        }
      }
    } catch (_) {}
    return { events: out, badLines }
  }

  dispose(reason) {
    void reason
    this._appended.clear()
  }
}

// ========== §11 Aggregate rebuild(events 为唯一权威) ==========

/**
 * aggregate rebuild:从 durable events 重建 per-memoryId 聚合。
 *  - Session scope 不进 durable aggregate(§11 scope 仅 Workspace|User;privacy)。
 *  - evidenceId 去重(首见保留;重复计账)——seed replay/live 双写安全网。
 *  - freshness:提供 corpusRecords 时,digest+sourceVersion 与当前记录一致=fresh;
 *    memoryId 存在但不匹配=stale;语料缺失=unknown。不提供 corpusRecords → 全部 unknown。
 */
export function rebuildAggregates(durableEvents, corpusRecords) {
  const list = Array.isArray(durableEvents)
    ? durableEvents
    : (durableEvents && Array.isArray(durableEvents.events) ? durableEvents.events : [])
  const byKey = new Map() // memoryId → state
  const seenIds = new Set()
  let duplicates = 0
  let sessionScoped = 0
  for (const ev of list) {
    if (seenIds.has(ev.evidenceId)) { duplicates++; continue }
    seenIds.add(ev.evidenceId)
    if (ev.scope === 'Session') { sessionScoped++; continue }
    if (ev.scope !== 'Workspace' && ev.scope !== 'User') continue
    const wsRef = ev.workspaceRef || 'unknown'
    const key = ev.memoryId + '|' + ev.scope + '|' + wsRef
    let st = byKey.get(key)
    if (!st) {
      st = { memoryId: ev.memoryId, scope: ev.scope, workspaceRef: wsRef, sessions: new Set(), counts: { seen: 0, read: 0, cite: 0, reuse: 0, success: 0, correction: 0 }, lastEvidenceAt: 0, latest: null }
      byKey.set(key, st)
    }
    if (st.counts[ev.kind] === undefined) continue // 未知 kind 不计入(policy 升级兼容)
    st.counts[ev.kind]++
    st.sessions.add(ev.event && ev.event.sessionRef ? ev.event.sessionRef : 'unknown')
    const ts = Number(ev.event && ev.event.ts) || 0
    if (ts >= st.lastEvidenceAt) { st.lastEvidenceAt = ts; st.latest = ev }
  }
  const recsByMemory = new Map()
  for (const r of Array.isArray(corpusRecords) ? corpusRecords : []) {
    if (!recsByMemory.has(r.memoryId)) recsByMemory.set(r.memoryId, [])
    recsByMemory.get(r.memoryId).push(r)
  }
  const aggregates = []
  const byWorkspaceRef = new Map() // workspaceRef → aggregates(§9 跨工作区零泄漏的推送侧过滤依据)
  for (const st of byKey.values()) {
    let freshness = 'unknown'
    const recs = recsByMemory.get(st.memoryId)
    if (recs && recs.length && st.latest) {
      const match = recs.some((r) => r.recordDigest === st.latest.source.recordDigest && r.sourceVersion === st.latest.source.sourceVersion)
      freshness = match ? 'fresh' : 'stale'
    }
    const agg = {
      memoryId: st.memoryId,
      scope: st.scope,
      freshness,
      distinctSessions: st.sessions.size,
      seen: st.counts.seen,
      read: st.counts.read,
      cite: st.counts.cite,
      reuse: st.counts.reuse,
      success: st.counts.success,
      correction: st.counts.correction,
      lastEvidenceAt: st.lastEvidenceAt,
      policyVersion: EVIDENCE_POLICY_VERSION,
    }
    const v = validateEvidenceAggregatePre(agg)
    if (v.ok) {
      aggregates.push(v.aggregate)
      if (!byWorkspaceRef.has(st.workspaceRef)) byWorkspaceRef.set(st.workspaceRef, [])
      byWorkspaceRef.get(st.workspaceRef).push(v.aggregate)
    }
  }
  aggregates.sort((a, b) => (a.memoryId < b.memoryId ? -1 : a.memoryId > b.memoryId ? 1 : a.scope < b.scope ? -1 : 1))
  return { aggregates, byWorkspaceRef, duplicates, sessionScoped }
}

/** aggregate 快照持久化(evidence/aggregates/index.json;可重建派生物,仅调试/导出用)。 */
export function persistAggregatesSnapshot(root, aggregates) {
  const dir = path.join(root, 'aggregates')
  mkdirSync(dir, { recursive: true })
  const payload = { schemaVersion: 1, namespace: NAMESPACE, storePolicyVersion: EVIDENCE_STORE_POLICY_V1.storePolicyVersion, rebuiltAt: Date.now(), aggregates }
  writeFileSync(path.join(dir, 'index.json'), JSON.stringify(payload, null, 2) + '\n', 'utf8')
  return path.join(dir, 'index.json')
}
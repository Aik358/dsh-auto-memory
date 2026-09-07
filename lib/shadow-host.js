/**
 * M4-3 Host Shadow Wiring(docs/M4-CONTRACT.md §5/§14/§15/§17)。
 * 桥接 lib/index.js(M2 ContextObserver/M3 sidecar)与 M4-1 纯核心:
 *   - per-runtime Shadow state(WeakMap,lazy;enableEpoch/completedKeys/recentHits/cooldown/latch)
 *   - accepted Segment → 同步捕获 paths 快照 → 异步 latest-wins 调度(gate→corpus→lexical→audit)
 *   - durable audit:<DSH_HOME>/memory/retrieval-pre/audit/YYYY-MM-DD.jsonl(engine 级串行,32KiB 截断,
 *     隐私投影:无原文/无绝对路径/无 sessionId/term 只存 digest)+ retention(14 天/32MiB)
 *   - debugView(§17 最小投影;关闭时严格 {enabled:false})
 * 默认关闭:三开关任一为 false 时零构造、零 IO、零留存。
 */
import { mkdirSync, appendFileSync, writeFileSync, readFileSync, readdirSync, existsSync, statSync, rmSync } from 'node:fs'
import path from 'node:path'
import { homedir } from 'node:os'
import { createHash } from 'node:crypto'
import {
  validateSnapshot, buildQueryPlan, computeSignals, gatePreV1,
  lexicalSearch, buildCandidates, buildRetrievalId, replay as replayCore,
  SHADOW_GATE_POLICY_V1, LEXICAL_POLICY_VERSION, GATE_POLICY_VERSION, NAMESPACE,
} from './shadow-retrieval.js'
import { buildSourceCatalog, loadCorpusSnapshot, CorpusRegistry, canonicalize } from './m4-corpus.js'

const sha256Hex = (buf) => createHash('sha256').update(buf).digest('hex')
const first32 = (s) => String(s || '').slice(0, 32)
const AUDIT_KEEP_DAYS = 14
const AUDIT_MAX_BYTES = 32 * 1024 * 1024
const AUDIT_EVENT_MAX = 32 * 1024

/** 单 audit 事件 32KiB 上限:超限按 candidate/drop 尾部裁剪并标记。 */
export function truncateAuditEvent(ev) {
  let e = ev
  if (Buffer.byteLength(JSON.stringify(e), 'utf8') <= AUDIT_EVENT_MAX) return e
  e = JSON.parse(JSON.stringify(ev))
  e.auditTruncated = true
  while (Buffer.byteLength(JSON.stringify(e), 'utf8') > AUDIT_EVENT_MAX && (e.candidates.length || e.dropped.length)) {
    if (e.candidates.length >= e.dropped.length) e.candidates.pop()
    else e.dropped.pop()
    e.counts.kept = e.candidates.length
  }
  return e
}

export function createShadowHost({ engine }) {
  const states = new WeakMap() // runtime → shadow state(lazy)
  const volatileRing = [] // ≤64 events(最小投影)
  const stats = { evaluated: 0, retrieved: 0, prefetched: 0, suppressed: 0, stale: 0, errors: 0 }
  const registry = new CorpusRegistry({ sidecarDir: path.join(dshHome(), 'memory', 'index', 'files') })
  let lastMemoryIndexVersion = null
  let lastCombo = null
  let enableEpoch = 0
  let lastGate = null
  let inFlightCount = 0
  let lastAuditAt = 0
  let auditSwept = false

  const effectiveEnabled = () =>
    engine.config.associativeMemoryEnabled === true &&
    engine.config.shadowRetrievalEnabled === true &&
    engine.config.memoryAnchorEnabled === true

  function stateFor(runtime) {
    let st = states.get(runtime)
    if (!st) {
      st = {
        enableEpoch, processedSegmentCount: 0, cooldownUntilSegment: 0,
        latched: false, recentHits: [], completedKeys: new Set(),
        ignoredDigests: [], inFlight: null, runtimeTag: null, lastGate: null,
      }
      states.set(runtime, st)
    }
    return st
  }

  /** §17 debugView:关闭时严格 {enabled:false}。 */
  function debugView() {
    if (!effectiveEnabled()) return { enabled: false }
    const runtimes = []
    for (const pair of collectStates()) {
      const st = pair.state
      runtimes.push({
        runtimeTag: st.runtimeTag ? st.runtimeTag.slice(0, 8) : undefined,
        contextVersion: pair.runtime.contextVersion,
        gate: st.lastGate ? { action: st.lastGate.action, hesitation: st.lastGate.hesitation } : null,
        inFlight: !!st.inFlight,
        processedSegmentCount: st.processedSegmentCount,
        enableEpoch: st.enableEpoch,
      })
    }
    return {
      enabled: true, shadowOnly: true,
      gatePolicyVersion: GATE_POLICY_VERSION, lexicalPolicyVersion: LEXICAL_POLICY_VERSION,
      memoryIndexVersion: lastMemoryIndexVersion,
      corpus: { sources: lastCorpusCounts.sources, records: lastCorpusCounts.records, legacyConflicts: lastCorpusCounts.legacyConflicts, staleSources: lastCorpusCounts.staleSources || 0 },
      stats: { ...stats },
      lastAuditError,
      auditDirPath: auditDir(),
      auditWritten,
      runtimes,
      recentAudit: volatileRing.slice(-3),
    }
  }

  function collectStates() {
    // WeakMap 不可枚举:debug 用 engine.runtimes 反查
    const out = []
    for (const rt of engine.runtimes.values()) {
      const st = states.get(rt)
      if (st) out.push({ runtime: rt, state: st })
    }
    return out
  }

  const lastCorpusCounts = { sources: 0, records: 0, legacyConflicts: 0, staleSources: 0 }

  /** 调度瞬间同步捕获的 paths 快照由 index.js 写入(refresh 完成时)。 */
  const pathsByKey = new Map()
  function capturePaths(runtimeKey, p) {
    pathsByKey.set(String(runtimeKey || ''), {
      workspaceKey: canonicalize(p.ws),
      // engine.state 无 userFile 字段(§refresh 只写 userDir):用户级=state.userDir/MEMORY.md(与 resolvePaths 公式一致)
      userMemoryPath: p.userDir ? path.join(p.userDir, 'MEMORY.md') : undefined,
      workspaceMemoryPath: p.notesPath,
      todayLogPath: p.logPath,
    })
  }

  /** durable audit 目录与日期分片。 */
  function auditDir() { return path.join(dshHome(), 'memory', 'retrieval-pre', 'audit') }
  function dshHome() {
    const env = process.env.DSH_HOME
    if (env && env.trim()) return env.trim()
    // M4-4 修复:必须拼接 .dsh(此前漏拼导致 audit 写到 <home>/memory 错误位置)
    const base = engine.__homedirFn ? engine.__homedirFn() : (process.env.USERPROFILE || process.env.HOME || '')
    return base ? path.join(base, '.dsh') : '.'
  }

  /** 串行 durable append(§15.4):engine 级链式;失败只计 audit-write-failed 不重试不污染 Session。 */
  let auditChainTail = Promise.resolve()
  let auditWritten = 0
  let lastAuditError = null
  function appendAuditDurable(event) {
    const trimmed = truncateAuditEvent(event)
    const date = new Date(event.recordedAt)
    const fname = date.getFullYear() + '-' + String(date.getMonth() + 1).padStart(2, '0') + '-' + String(date.getDate()).padStart(2, '0') + '.jsonl'
    auditChainTail = auditChainTail.then(() => {
      try {
        const dir = auditDir()
        mkdirSync(dir, { recursive: true })
        appendFileSync(path.join(dir, fname), JSON.stringify(trimmed) + '\n', 'utf8')
        maybeRetentionSweep(dir)
        auditWritten++
        return true
      } catch (e2) {
        lastAuditError = 'audit-write-failed:' + (e2 && e2.message ? e2.message : String(e2))
        try { console.error('[shadow-audit] ' + lastAuditError) } catch (_) {}
        return false
      }
    })
    return auditChainTail
  }

  /** retention:保留 14 天且总量 ≤32MiB;只清 audit 分片,不动 Markdown/sidecar。 */
  function maybeRetentionSweep(dir) {
    if (auditSwept) return
    auditSwept = true
    try {
      const now = Date.now()
      let total = 0
      const files = []
      for (const f of readdirSync(dir)) {
        if (!f.endsWith('.jsonl')) continue
        const fp = path.join(dir, f)
        const st = statSync(fp)
        total += st.size
        files.push({ fp, mtimeMs: st.mtimeMs, size: st.size })
      }
      for (const f of files) {
        const ageDays = (now - f.mtimeMs) / 86400000
        if (ageDays > AUDIT_KEEP_DAYS || total > AUDIT_MAX_BYTES) {
          try { rmSyncSafe(f.fp); total -= f.size } catch (_) {}
        }
        if (total <= AUDIT_MAX_BYTES && ageDays <= AUDIT_KEEP_DAYS) break
      }
    } catch (_) {}
  }
  function rmSyncSafe(p) { try { rmSync(p, { force: true }) } catch (_) {} }

  return {
    init() { /* 兼容占位:运行期依赖已静态化 */ },
    capturePaths,
    effectiveEnabled,
    isLive: effectiveEnabled,

    /**
     * M2 Segment accept 后调用(index.js ingestEnvelope 内 fire-and-forget)。
     * 同步段:paths 快照/snapshot 构造/gate/latest-wins abort;异步段:corpus+rank+audit。
     */
    onSegmentAccepted(runtime, seg, envelope) {
      try {
        const combo = [
          engine.config.associativeMemoryEnabled === true,
          engine.config.shadowRetrievalEnabled === true,
          engine.config.memoryAnchorEnabled === true,
        ]
        const comboStr = combo.join(',')
        if (lastCombo !== null && comboStr !== lastCombo) {
          enableEpoch++
          states.delete(runtime) // 简化:该 runtime 状态清零(其它 runtime 下次触发时同样处理)
        }
        lastCombo = comboStr
        if (!effectiveEnabled()) return // 关闭零构造零留存
        const st = stateFor(runtime)
        st.processedSegmentCount += 1
        if (runtime.disposed) return
        const cooldownRemaining = Math.max(0, st.cooldownUntilSegment - st.processedSegmentCount)
        // child session hard suppress(§6:parentSession 存在即 child;volatile counter only)
        const isChild = !!(runtime.agent && runtime.agent.session && runtime.agent.session.header && runtime.agent.session.header.parentSession)
        if (isChild) {
          stats.suppressed++
          pushVolatile({ reason: 'child-session', contextVersion: seg.contextVersion })
          return
        }
        // plugin-generated user trigger 不得单独触发 retrieve(§6);标量在 envelope.payload 最小投影
        const envPayload = (envelope && envelope.payload) || {}
        if (seg.kind === 'user' && envPayload.sourcePlugin) {
          stats.suppressed++
          pushVolatile({ reason: 'plugin-generated-trigger', contextVersion: seg.contextVersion })
          return
        }
        const paths = pathsByKey.get(String(runtime.key || '')) || null
        if (!paths) { console.error('[shadow-diag] no-paths'); stats.suppressed++; pushVolatile({ reason: 'no-paths-captured', contextVersion: seg.contextVersion }); return }
        // window:segments ring 最近 8 条(含当前)
        const ringItems = runtime.segments ? runtime.segments.snapshot() : []
        const win = ringItems.slice(-8).map((w) => ({
          segmentId: w.id, digest: w.digest, kind: w.kind, eventSeq: w.eventSeq,
          contextVersion: w.contextVersion, ts: w.ts, text: w.text,
          toolName: w.toolName != null ? w.toolName : null,
          toolOk: w.toolOk != null ? w.toolOk : null,
          errorName: w.errorName != null ? w.errorName : null,
          errorCode: w.errorCode != null ? w.errorCode : null,
        }))
        const snap = validateSnapshot({
          schemaVersion: 1, sessionId: envelope.sessionId || '', agentId: runtime.agentId || '',
          workspaceKey: paths.workspaceKey, sessionClass: 'top-level',
          contextVersion: runtime.contextVersion, eventSeq: seg.eventSeq,
          trigger: {
            segmentId: seg.id, segmentDigest: seg.digest, kind: seg.kind, eventType: seg.eventType,
            nativeSeq: seg.nativeSeq != null ? seg.nativeSeq : undefined, ts: seg.ts,
            text: seg.text,
            inputSource: envPayload.inputSource || null,
            sourcePlugin: envPayload.sourcePlugin || null,
            toolName: seg.toolName != null ? seg.toolName : null,
            toolOk: seg.toolOk != null ? seg.toolOk : null,
            errorName: seg.errorName != null ? seg.errorName : null,
            errorCode: seg.errorCode != null ? seg.errorCode : null,
            callId: (envelope && envelope.callId) || null,
            rootCallId: (envelope && envelope.rootCallId) || null,
          },
          window: win,
        })
        if (!snap.ok) { stats.suppressed++; pushVolatile({ reason: snap.reason, contextVersion: runtime.contextVersion }); return }
        const snapshot = snap.snapshot
        const qp = buildQueryPlan(snapshot)
        const dec = gatePreV1(snapshot, { previousLatch: st.latched, cooldownRemaining, signals: computeSignals(snapshot, qp, st.recentHits), queryPlan: qp })
        st.lastGate = { action: dec.action, hesitation: dec.hesitation, rawScore: dec.rawScore, latched: dec.latched }
        st.latched = dec.latched
        st.cooldownUntilSegment = dec.action === 'retrieve' ? (st.processedSegmentCount + SHADOW_GATE_POLICY_V1.cooldownSegments) : st.cooldownUntilSegment
        stats.evaluated++
        if (dec.action === 'suppress') { stats.suppressed++; pushSuppressed(dec, snapshot); return }
        // latest-wins abort
        if (st.inFlight && st.inFlight.contextVersion !== snapshot.contextVersion) {
          try { st.inFlight.controller.abort() } catch (_) {}
          stats.stale++
        }
        const controller = new AbortController()
        const retrievalIdSeed = { sessionId: snapshot.sessionId, contextVersion: snapshot.contextVersion, segmentId: snapshot.trigger.segmentId }
        st.inFlight = { contextVersion: snapshot.contextVersion, controller, retrievalIdSeed }
        inFlightCount++
        void runRetrieval({ runtime, st, snapshot, qp, dec, cat: buildSourceCatalog(paths), controller, retrievalIdSeed })
          .catch((e) => { stats.errors++; pushVolatile({ reason: 'internal-error', detail: e && e.message }) })
      } catch (e) { stats.errors++ }
    },

    debugView,
    getStats: () => ({ ...stats }),
    disposeRuntime(runtime) {
      const st = states.get(runtime)
      if (st && st.inFlight) { try { st.inFlight.controller.abort() } catch (_) {} ; st.inFlight = null }
      states.delete(runtime)
    },
    disposeAll(reason) {
      for (const pair of collectStates()) this.disposeRuntime(pair.runtime)
      volatileRing.length = 0
    },
    replayFromFile,
    _volatileRing: volatileRing,
    _statsForTest: stats,
  }

  function pushVolatile(entry) {
    volatileRing.push({ at: Date.now(), ...entry })
    if (volatileRing.length > 64) volatileRing.shift()
  }
  function pushSuppressed(dec, snapshot) {
    pushVolatile({ reason: dec.reason, action: 'suppress', contextVersion: snapshot.contextVersion, hesitation: dec.hesitation })
  }

  async function runRetrieval(ctxR) {
    const { runtime, st, snapshot, qp, dec, controller } = ctxR
    if (controller.signal.aborted) { stats.stale++; return }
    const catalog = ctxR.cat
    const corpusRes = registry.get(catalog)
    if (!corpusRes.ok) { stats.suppressed++; pushVolatile({ reason: corpusRes.reason }); return }
    const snapshotOut = corpusRes.snapshot
    if (controller.signal.aborted) { stats.stale++; return }
    lastMemoryIndexVersion = snapshotOut.memoryIndexVersion
    lastCorpusCounts.sources = snapshotOut.counts.sources
    lastCorpusCounts.records = snapshotOut.records.length
    const ls = lexicalSearch(snapshotOut, qp, { triggerTs: snapshot.trigger.ts, mode: dec.action === 'retrieve' ? 'retrieve' : 'prefetch', dayBoundaryMinutes: Number(engine.config.dayBoundaryMinutes) || 450 })
    if (controller.signal.aborted) { stats.stale++; return }
    const retrievalId = buildRetrievalId(snapshot.sessionId, snapshot.contextVersion, snapshot.trigger.segmentId, snapshotOut.memoryIndexVersion)
    const candidates = buildCandidates(retrievalId, ls.kept, dec.action === 'retrieve' ? 'retrieve' : 'prefetch')
    if (dec.action === 'retrieve') stats.retrieved++
    else stats.prefetched++
    st.recentHits.push({ queryDigest: qp.queryDigest, fresh: ls.kept.length > 0, memoryIds: ls.kept.map((k) => k.memoryId) })
    if (st.recentHits.length > 64) st.recentHits.shift()
    st.completedKeys.add(qp.queryDigest + ':' + snapshotOut.memoryIndexVersion)
    if (st.completedKeys.size > 256) { const first = st.completedKeys.values().next().value; st.completedKeys.delete(first) }
    // durable audit(§15.2 schema,隐私投影)
    const ev = truncateAuditEvent({
      schemaVersion: 1, namespace: NAMESPACE,
      retrievalId, recordedAt: Date.now(), triggerTs: snapshot.trigger.ts,
      contextVersion: snapshot.contextVersion, eventSeq: snapshot.eventSeq,
      triggerSegmentId: snapshot.trigger.segmentId, triggerSegmentDigest: snapshot.trigger.segmentDigest,
      triggerKind: snapshot.trigger.kind,
      memoryIndexVersion: snapshotOut.memoryIndexVersion,
      gatePolicyVersion: GATE_POLICY_VERSION, lexicalPolicyVersion: LEXICAL_POLICY_VERSION,
      queryDigest: qp.queryDigest,
      gate: { action: dec.action, state: dec.state, reason: dec.reason, rawScore: dec.rawScore, hesitation: dec.hesitation, signals: dec.signals },
      outcome: candidates.length ? 'completed' : 'empty',
      candidates: candidates.map((c) => ({
        candidateId: c.candidateId, memoryId: c.memoryId, anchorId: c.anchorId,
        scope: c.scope, sourceClass: c.sourceClass, sourceRef: c.sourceRef,
        sourceEpoch: c.sourceEpoch, sourceVersion: c.sourceVersion, fileDigest: c.fileDigest, recordDigest: c.recordDigest,
        score: c.scores.total, reasonCodes: c.reasonCodes,
      })),
      dropped: ls.dropped.map((d) => ({ stage: d.stage, reason: d.reason, memoryId: d.memoryId, sourceRef: d.sourceRef })),
      counts: { sources: ls.counts.sources, records: ls.counts.records, legacyConflicts: ls.counts.legacyConflicts, rawHits: ls.counts.rawHits, kept: ls.counts.kept, dropped: ls.counts.dropped },
      latencyMs: { gate: 0, corpus: 0, search: 0, audit: 0, total: 0 },
      shadowOnly: true, injected: false, packetId: null, delivered: false, accessEvidenceCreated: false,
    })
    await appendAuditDurable(ev)
    lastAuditAt = Date.now()
    if (st.inFlight && st.inFlight.contextVersion === snapshot.contextVersion) st.inFlight = null
  }

  /** §16 显式 replay(纯核心;persist=false 不污染 live audit)。 */
  function replayFromFile(inputPath) {
    const fixture = JSON.parse(readFileSync(inputPath, 'utf8'))
    return replay(fixture)
  }
}

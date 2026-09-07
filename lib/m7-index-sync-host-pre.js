/**
 * M7-8 Host Index Sync Orchestrator(docs/PYTHON-SIDECAR-CONTRACT.md §19.10;修复 live blocker)。
 *
 * 根因(M7-8 live Phase E 实证):M7-1 的 index_sync 只实现了 plan/client 层,生产 Host
 * 从未调用 buildIndexSyncPlansPre/sendIndexSyncPlanPre → Python worker 收不到全库语料,
 * 无法建库;context_push 的 memoryRefs(top-8 lexical)不足以做语义检索。
 *
 * 本模块把授权 corpus snapshot → index_sync begin/page/commit 的编排接进 Host,并保证:
 *   - 默认关闭零 IO(assoc∧bridge∧pythonBackend∧sink='python' 四门全开才启用);
 *   - 输入必须是 loadCorpus(paths) 得到的已授权 M4 CorpusSnapshot(绝不自行读文件);
 *   - 每个 (workspaceRef, scope, memoryIndexVersion, workerEpoch) 最多成功同步一次;
 *   - worker 重启/epoch 变化 → 重新同步当前 index;
 *   - 新 memoryIndexVersion latest-wins;旧 in-flight sync abort/cancel;
 *   - 同一 workspace 的 Workspace/User plans 按确定顺序发送;
 *   - 任一失败结构化记录,允许下一有效 Segment 重试,绝不向未 ready 的 index 发 context_push;
 *   - 禁止在每个 Segment 重复全量 sync(成功后缓存 ready identity);
 *   - dispose 清理 in-flight/ready cache/abort controller,不删除 derived cache。
 *
 * 可观察性(最小投影,不泄内容):capturedPathKeys(≤8)、lastSegmentRuntimeKey、
 * lastSegmentSessionRef、lastDrop{reason,contextVersion,runtimeKey}、readyState。
 * UTF-8 无 BOM。
 */
import { buildIndexSyncPlansPre, sendIndexSyncPlanPre } from './index-sync-pre.js'
import { workspaceRefOf } from './evidence-store-pre.js'

export const M7_INDEX_SYNC_HOST_POLICY_VERSION = 'm7_index_sync_host_pre_v1'
const MAX_PATH_KEYS = 8
const MAX_DROPS = 16

export function createIndexSyncHostPre(opts = {}) {
  const engine = opts.engine
  if (!engine) throw new Error('index-sync-host: engine required')
  const readyCache = new Map()   // key=(wsRef,scope) -> { miv, epoch, at }
  const inFlight = new Map()     // key=(wsRef,scope) -> { controller, promise, miv }
  const enabledKeys = new Set()  // 显式 disable 的 key(同一 miv 内不再重试;miv 变化自动解除)
  const volatileDrops = []       // ≤16 条最小投影(无文本)
  const stats = { syncsStarted: 0, syncsOk: 0, syncsFailed: 0, skippedCached: 0,
    epochReset: 0, mivReplaced: 0, aborted: 0, drops: 0, readyHits: 0 }

  function enabled() {
    return engine.config.associativeMemoryEnabled === true &&
      engine.config.contextBridgeEnabled === true &&
      engine.config.pythonBackendEnabled === true &&
      String(engine.config.contextSinkMode || 'null') === 'python'
  }
  function client() { return engine._pythonSidecar || null }
  function keyOf(wsRef, scope) { return wsRef + '|' + scope }
  function drop(reason, contextVersion, runtimeKey) {
    volatileDrops.push({ at: Date.now(), reason, contextVersion, runtimeKey: String(runtimeKey || '').slice(0, 40) })
    if (volatileDrops.length > MAX_DROPS) volatileDrops.shift()
    stats.drops++
  }

  /** 当前 worker epoch(可能未启动);null 表示未启动。 */
  function currentEpoch() {
    const c = client()
    if (!c || typeof c.currentEpoch !== 'function') return null
    try { return c.currentEpoch() } catch (_) { return null }
  }

  /**
   * 使指定 workspace/scope 的 index 就绪(幂等)。返回 {ok, ready, reason}。
   * - ready=true 表示该 (wsRef,scope,miv,epoch) 已同步过(缓存命中)。
   * - 新 epoch → 清除该 key 的缓存并重同步(worker 重启后内存态清零)。
   * - 新 miv → latest-wins:abort 旧 in-flight,替换缓存,重同步。
   * - 失败不抛,结构化记录,允许重试。
   */
  async function ensureIndexReady(snapshot, paths, scope, opts = {}) {
    const signal = (opts && opts.signal) || undefined
    const ctxKey = String((opts && opts.runtimeKey) || '')
    if (!enabled()) return { ok: false, ready: false, reason: 'disabled' }
    const c = client()
    if (!c) return { ok: false, ready: false, reason: 'no-client' }
    if (!snapshot || !snapshot.records || !snapshot.records.length) return { ok: false, ready: false, reason: 'empty-corpus' }
    const wsRef = workspaceRefOf(paths.workspaceKey)
    const miv = String(snapshot.memoryIndexVersion || '')
    if (!miv.startsWith('idx_pre_')) return { ok: false, ready: false, reason: 'bad-miv' }
    const epoch = currentEpoch()
    const k = keyOf(wsRef, scope)
    const cached = readyCache.get(k)
    // epoch 变化(worker 重启) → 缓存失效,必须重同步
    if (cached && epoch && cached.epoch !== epoch) {
      readyCache.delete(k)
      stats.epochReset++
      drop('epoch-reset', 0, ctxKey)
    }
    // miv 变化 → 旧缓存/旧 in-flight 作废,latest-wins
    if (cached && cached.miv !== miv) {
      readyCache.delete(k)
      stats.mivReplaced++
      const infl = inFlight.get(k)
      if (infl) { try { infl.controller.abort() } catch (_) {}; stats.aborted++ }
      drop('miv-replaced', 0, ctxKey)
    }
    if (readyCache.has(k)) { stats.readyHits++; return { ok: true, ready: true, miv, epoch } }
    if (inFlight.has(k)) {
      const infl = inFlight.get(k)
      // 同 key 已在同步中:若 miv 相同则等待;否则 abort 旧的(latest-wins)
      if (infl.miv === miv) {
        try { await infl.promise; return infl.result } catch (_) { return { ok: false, ready: false, reason: 'inflight-failed' } }
      }
      try { infl.controller.abort() } catch (_) {}
      stats.aborted++
      drop('miv-replaced-inflight', 0, ctxKey)
    }
    // 构建计划(Workspace→User 固定序;本函数只处理单个 scope 的计划)
    const built = buildIndexSyncPlansPre({ snapshot, workspaceKey: paths.workspaceKey })
    if (!built.ok) { drop('plan:' + built.reason, 0, ctxKey); return { ok: false, ready: false, reason: built.reason } }
    const plan = built.plans.find((p) => p.scope === scope)
    if (!plan) { drop('no-plan:' + scope, 0, ctxKey); return { ok: false, ready: false, reason: 'no-plan:' + scope } }
    const controller = new AbortController()
    const signal2 = signal || controller.signal
    stats.syncsStarted++
    // M7-8 live 修复:sync 帧用独立长超时(覆盖 BGE 加载+全量建库),不套 client 默认 5s——
    // 否则 worker 首次加载/建库期间 begin/page 帧超时→重生成风暴(实测 syncsOk=0 死循环)
    const syncTimeoutMs = Number((opts && opts.syncTimeoutMs) || 120000)
    const promise = sendIndexSyncPlanPre(c, plan, { signal: signal2, timeoutMs: syncTimeoutMs })
      .then((res) => {
        if (res.ok) {
          readyCache.set(k, { miv, epoch, at: Date.now() })
          stats.syncsOk++
          return { ok: true, ready: true, miv, epoch }
        }
        stats.syncsFailed++
        drop('sync:' + (res.reason || res.phase || 'failed'), 0, ctxKey)
        return { ok: false, ready: false, reason: (res.reason || res.phase || 'sync-failed') }
      })
      .catch((err) => {
        const aborted = err && err.name === 'AbortError'
        if (aborted) stats.aborted++
        else stats.syncsFailed++
        drop('sync:' + (aborted ? 'aborted' : String(err && err.message || 'error')), 0, ctxKey)
        return { ok: false, ready: false, reason: aborted ? 'aborted' : 'sync-error' }
      })
    const entry = { controller, promise, miv, result: null }
    entry.result = promise
    inFlight.set(k, entry)
    try {
      const r = await promise
      if (inFlight.get(k) === entry) inFlight.delete(k)
      return r
    } catch (_) {
      if (inFlight.get(k) === entry) inFlight.delete(k)
      return { ok: false, ready: false, reason: 'sync-error' }
    }
  }

  /** 一次调用同步一个 workspace 的全部 scope(Workspace→User 固定序)。返回逐 scope 结果。 */
  async function ensureWorkspaceIndexReady(snapshot, paths, opts = {}) {
    if (!enabled()) return [{ ok: false, ready: false, reason: 'disabled' }]
    const results = []
    const scopes = ['Workspace', 'User']
    for (const scope of scopes) {
      const has = snapshot.records.some((r) => r.scope === scope)
      if (!has) continue
      results.push(await ensureIndexReady(snapshot, paths, scope, opts))
    }
    return results
  }

  function debugView() {
    if (!enabled()) return { enabled: false }
    const c = client()
    return {
      enabled: true,
      policyVersion: M7_INDEX_SYNC_HOST_POLICY_VERSION,
      ready: [...readyCache.entries()].map(([k, v]) => ({ key: k, miv: v.miv, epoch: v.epoch ? v.epoch.slice(0, 12) : null })),
      inFlightCount: inFlight.size,
      capturedPathKeys: [...enabledKeys].slice(0, MAX_PATH_KEYS),
      stats: { ...stats },
      recentDrops: volatileDrops.slice(-4),
      epoch: c && typeof c.currentEpoch === 'function' ? (c.currentEpoch() || '').slice(0, 12) : null,
    }
  }

  function dispose(reason) {
    for (const [, infl] of inFlight) { try { infl.controller.abort() } catch (_) {} }
    inFlight.clear()
    readyCache.clear()
    enabledKeys.clear()
    volatileDrops.length = 0
    stats.drops = 0
  }

  return {
    ensureIndexReady,
    ensureWorkspaceIndexReady,
    debugView,
    dispose,
    _stats: stats,
    _readyCacheForTest: readyCache,
    _inFlightForTest: inFlight,
  }
}

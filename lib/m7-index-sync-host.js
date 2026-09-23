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
 * 可观察性(最小投影,不泄内容):ready(按 (wsRef,scope) 的 miv/epoch/generation)、inFlightCount、
 * generation、recentDrops{reason,contextVersion}、epoch、engineSwitch、stats。
 * ★2026-09-22:删掉了一条恒空的死投影字段 —— 它取自某个全文件无 .add 的 Set,恒为 []。
 * 真正的「已捕获路径键」属 context-host.js(那边的集合是活的)。
 * UTF-8 无 BOM。
 */
import { buildIndexSyncPlansPre, sendIndexSyncPlanPre } from './index-sync.js'
import { workspaceRefOf } from './evidence-store.js'
import { createEngineSwitchPre } from './engine-switch.js'

export const M7_INDEX_SYNC_HOST_POLICY_VERSION = 'm7_index_sync_host_pre_v1'
const MAX_DROPS = 16

export function createIndexSyncHostPre(opts = {}) {
  const engine = opts.engine
  if (!engine) throw new Error('index-sync-host: engine required')
  const readyCache = new Map()   // key=(wsRef,scope) -> { miv, epoch, at, generation }
  const inFlight = new Map()     // key=(wsRef,scope) -> { controller, promise, miv }
  const volatileDrops = []       // ≤16 条最小投影(无文本)
  const stats = { syncsStarted: 0, syncsOk: 0, syncsFailed: 0, skippedCached: 0,
    epochReset: 0, mivReplaced: 0, aborted: 0, drops: 0, readyHits: 0, generationResets: 0 }
  // ★P2（T2-9a）：**重建代际**。切档 = 新 generation ⇒ 旧代 readyCache 一律不得跳过重建
  // （含 e5→BGE→e5 回到旧引擎：旧代的 ready 缓存同样作废，必须完整重跑）。
  let generation = 0
  // ★P2（T2-9b/c/d）：切换状态机由本宿主持有（评审 §3.5 采纳条目），状态唯一所有者；
  // semantic-status / 向导只投影它，不另立计数。
  const switchMachine = createEngineSwitchPre({
    now: opts.now,
    io: opts.switchIo || null,
    persistPath: opts.switchPersistPath || '',
    diag: opts.diag,
  })

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
    // ★P2（T2-9a）重建代际失效：切档后 generation 前进 ⇒ 旧代 ready 缓存**不得跳过重建**
    // （e5→BGE→e5 回到旧引擎也一样：缓存是"旧代的"，必须完整重跑）。
    if (cached && (Number(cached.generation) || 0) !== generation) {
      readyCache.delete(k)
      stats.generationResets++
      drop('generation-reset', 0, ctxKey)
    }
    // epoch 变化(worker 重启) → 缓存失效,必须重同步
    // ★ issue #69 修复（2026-09-19）：判据补上「**cached.epoch 为空 ⇒ 一律视为无效**」。
    //   旧写法 `if (cached && epoch && cached.epoch !== epoch)` 里的 **`epoch &&` 前置**是缺陷所在：
    //   当 `currentEpoch()` 返回 null（**client 未启动 / 已 exit 但 stdio 未排空**）时，该分支**永不成立**
    //   ⇒ 一条 `cached.epoch === null` 的旧缓存（冷启动时采样于 lazy spawn 之前，见 `:90`）会被一直保留
    //   ⇒ 对刚 spawn 出来的空索引 worker 误判 `ready=true`，该段 `context_push` 拿到零候选零激活，
    //   且 `context-host` 的 `indexNotReady` 也不点亮（readyRes.ready 为 true）⇒ **连降级留痕都没有**。
    //   保留旧语义的另一半（epoch 非空时要求严格相等）——worker 重启换 epoch 仍会正常失效重同步。
    if (cached && (!cached.epoch || (epoch && cached.epoch !== epoch))) {
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
          readyCache.set(k, { miv, epoch, at: Date.now(), generation })
          stats.syncsOk++
          // ★P2（T2-9c）：进度**来自实际完成量** —— 只有真同步成功后才上报该 scope 单元。
          try { switchMachine.reportDone(switchMachine.getEngineSwitchStatusPre().switchId, [k]) } catch (_) {}
          return { ok: true, ready: true, miv, epoch }
        }
        stats.syncsFailed++
        drop('sync:' + (res.reason || res.phase || 'failed'), 0, ctxKey)
        try { switchMachine.reportFailed(switchMachine.getEngineSwitchStatusPre().switchId, 1, res.reason || res.phase || 'sync-failed') } catch (_) {}
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
      generation,
      engineSwitch: switchMachine.getEngineSwitchStatusPre(),
      ready: [...readyCache.entries()].map(([k, v]) => ({ key: k, miv: v.miv, epoch: v.epoch ? v.epoch.slice(0, 12) : null, generation: v.generation })),
      inFlightCount: inFlight.size,
      stats: { ...stats },
      recentDrops: volatileDrops.slice(-4),
      epoch: c && typeof c.currentEpoch === 'function' ? (c.currentEpoch() || '').slice(0, 12) : null,
    }
  }

  /**
   * ★P2（T2-9）开始一次**实际**引擎切换：新 rebuild generation + 冻结目标身份。
   * 由调用方在**配置落盘之后**调用。返回 {ok, switchId, generation}。
   * 副作用：generation 前进 ⇒ 所有旧代 readyCache 立即失效（下次 ensureIndexReady 必完整重跑）。
   */
  function beginEngineSwitchPre(input = {}) {
    const r = switchMachine.beginEngineSwitchPre(input)
    if (r.ok && r.fresh) {
      generation = Number(r.generation) || generation + 1
      // 旧代 ready 缓存整体作废（不清盘、不删文件：缓存目录本身不就地覆盖，见回滚口径）
      readyCache.clear()
      for (const [, infl] of inFlight) { try { infl.controller.abort() } catch (_) {} }
      stats.generationResets++
      drop('engine-switch', 0, 'begin')
    }
    return r
  }

  function cancelEngineSwitchPre(switchId) { return switchMachine.cancelEngineSwitchPre(switchId) }
  function getEngineSwitchStatusPre() { return switchMachine.getEngineSwitchStatusPre() }
  function reportEngineSwitchDone(switchId, unitKeys, opts2) { return switchMachine.reportDone(switchId, unitKeys, opts2) }
  function setEngineSwitchTotal(switchId, total) { return switchMachine.setTotal(switchId, total) }
  function publishEngineSwitchReady(switchId) { return switchMachine.publishReady(switchId) }
  function failEngineSwitch(switchId, reason) { return switchMachine.failSwitch(switchId, reason) }
  /** 当前是否处于"强制全量重建"代际（切换未完成）。 */
  function requiresFullRebuild() { return switchMachine.requiresFullRebuild() }

  function dispose(reason) {
    for (const [, infl] of inFlight) { try { infl.controller.abort() } catch (_) {} }
    inFlight.clear()
    readyCache.clear()
    volatileDrops.length = 0
    stats.drops = 0
  }

  return {
    ensureIndexReady,
    ensureWorkspaceIndexReady,
    debugView,
    dispose,
    // ★P2：切档 API（评审 §3.5 采纳：状态由本宿主持有，唯一所有者）
    beginEngineSwitchPre,
    cancelEngineSwitchPre,
    getEngineSwitchStatusPre,
    reportEngineSwitchDone,
    setEngineSwitchTotal,
    publishEngineSwitchReady,
    failEngineSwitch,
    requiresFullRebuild,
    _generationForTest: () => generation,
    _stats: stats,
    _readyCacheForTest: readyCache,
    _inFlightForTest: inFlight,
  }
}

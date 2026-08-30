/**
 * M6-3 Surface Adapter(docs/M6-CONTRACT.md §7-§11,§13 M6-3)。
 * 桥接 lib/index.js(pre-step 生命周期/systemPrompt surface/调试路由)与 M6-1/2 纯核心:
 *   - capability 快照(不按模型名硬编码):本 DSH 构建可证明进入下一请求 messages 的
 *     surface=systemPrompt.context(user-role 快照追加历史尾部);pre-step/user-message patch
 *     不存在 → capability='dynamic-context';连 context 都没有 → 'none'(降级 Shadow,不标 delivered)。
 *   - pre-step 时序(§8):bumpStep→setCursor→claim(四重门);claimed packet 缓存于 runtime 态。
 *   - 渲染即投递:专用 context 组件 'dsh:m6-reference-tail-pre' 的 text() 重渲染并校验 exactDigest,
 *     一致则返回尾注文本(=已实际进入 messages)并 markDelivered + 异步创建 seen evidence;
 *     systemPrompt.section 永不承载动态 tail。
 * 默认关闭(associativeMemoryEnabled ∧ activationInboxEnabled 双门);activationSource='fake' 为
 * 路由注入唯一入口;'python' 仅在 assoc∧inbox∧pythonBackend 三重门下经 offerExternalActivation
 * 接收 worker 帧并走现有 validator/inbox/pre-step claim(M7-1)。无 spawn/net/http;UTF-8 无 BOM。
 */
import {
  buildReferenceTailPacketPre, renderReferenceTail, computeExactDigest, TAIL_MARKER_LINE_PRE_V1,
  REFERENCE_TAIL_BUDGET_PRE_V1, ACTIVATION_POLICY_VERSION,
} from './activation-inbox-pre.js'
import { createActivationInboxPre, ActivationInboxRegistry, REFERENCE_TAIL_COOLDOWN_STEPS_PRE_V1 } from './activation-inbox-state-pre.js'
import { createAccessEvidencePre } from './context-bridge-pre.js'
import path from 'node:path'
import { buildSourceCatalog, loadCorpusSnapshot, CorpusRegistry, canonicalize } from './m4-corpus-pre.js'

/** §11 capability 快照版本。 */
export const CAPABILITY_SNAPSHOT_PRE_V1 = 'capability_pre_v1'

/** §11 capability 检测:按宿主提供的 surface 形状决定 packetPatch,禁止按模型名硬编码。 */
export function detectPacketCapabilityPre(ctxLike) {
  const sp = ctxLike && ctxLike.systemPrompt
  const hasContext = !!(sp && typeof sp.context === 'function')
  return {
    capabilityVersion: CAPABILITY_SNAPSHOT_PRE_V1,
    packetPatch: hasContext ? 'dynamic-context' : 'none',
    includeRuntimeContext: false,
    maxPacketBytes: REFERENCE_TAIL_BUDGET_PRE_V1.maxPacketBytes,
    supportsDeliveryAck: true, // context text 返回非空即证明进入 messages,可同步 ack
  }
}

export function createActivationHost(opts = {}) {
  const engine = opts.engine
  if (!engine) throw new Error('activation-host: engine required')
  const registry = new ActivationInboxRegistry()
  const corpusRegistry = new CorpusRegistry({ sidecarDir: path.join(dshHome(), 'memory', 'index-pre', 'files') })
  const runtimeState = new Map() // runtime.key → {step, claimed:{packet, inbox}|null, identity:{sessionId,workspaceKey}|null}
  let mivCache = { wsRef: null, miv: null }
  const pathsByKey = new Map()
  const volatileEvents = [] // ≤16 最小投影
  const stats = { injected: 0, injectedAccepted: 0, injectedRejected: 0, claims: 0, claimFails: 0, rendered: 0, delivered: 0, seenCreated: 0, seenSkippedNoProv: 0, errors: 0 }

  function effectiveEnabled() {
    return engine.config.associativeMemoryEnabled === true && engine.config.activationInboxEnabled === true
  }
  /** M7-1 三重门(PYTHON-SIDECAR-CONTRACT §13.1):默认 fake 时恒不走 python 分支。 */
  function pythonGate() {
    return engine.config.associativeMemoryEnabled === true &&
      engine.config.activationInboxEnabled === true &&
      engine.config.pythonBackendEnabled === true
  }
  function sourceMode() {
    const s = String(engine.config.activationSource || 'fake')
    if (s === 'fake') return 'fake'
    if (s === 'js') return 'js' // 2026-08-27 JS 判定来源(C2 检索 + JS 判定核,独立于 Python)
    if (s === 'python' && pythonGate()) return 'python'
    return 'invalid'
  }
  function dshHome() {
    const env = process.env.DSH_HOME
    if (env && env.trim()) return env.trim()
    const base = engine.__homedirFn ? engine.__homedirFn() : (process.env.USERPROFILE || process.env.HOME || '')
    return base ? path.join(base, '.dsh') : '.'
  }
  function pushEvent(entry) {
    volatileEvents.push({ at: Date.now(), ...entry })
    if (volatileEvents.length > 16) volatileEvents.shift()
  }
  function capturePaths(runtimeKey, p) {
    pathsByKey.set(String(runtimeKey || ''), {
      workspaceKey: canonicalize(p.ws),
      userMemoryPath: p.userDir ? path.join(p.userDir, 'MEMORY.md') : undefined,
      workspaceMemoryPath: p.notesPath,
      todayLogPath: p.logPath,
    })
  }


  /** 当前 workspace 的 memoryIndexVersion(自有 CorpusRegistry 懒加载;失败 null 并清缓存)。 */
  function currentMiv(workspaceKey) {
    const ws = canonicalize(workspaceKey)
    const p = null
    for (const [, v] of pathsByKey) {
      if (v.workspaceKey !== ws) continue
      try {
        const catalog = buildSourceCatalog({
          workspaceKey: v.workspaceKey,
          userMemoryPath: v.userMemoryPath,
          workspaceMemoryPath: v.workspaceMemoryPath,
          todayLogPath: v.todayLogPath,
        })
        const res = corpusRegistry.get(catalog)
        if (res && res.ok) {
          mivCache = { wsRef: ws, miv: res.snapshot.memoryIndexVersion }
          return mivCache.miv
        }
      } catch (_) {}
      break
    }
    if (mivCache.wsRef === ws) return mivCache.miv
    return null
  }
  function setMiv(workspaceKey, miv) { mivCache = { wsRef: canonicalize(workspaceKey), miv } }

  function identityFor(runtime) {
    const sessionId = runtime.sessionId || ''
    const p = pathsByKey.get(String(runtime.key || '')) || null
    const workspaceKey = p ? p.workspaceKey : (engine.state && engine.state.ws ? canonicalize(engine.state.ws) : '')
    if (!sessionId || !workspaceKey) return null
    return { sessionId, agentId: runtime.agentId || '', workspaceKey }
  }

  /** fake/python 注入入口(路由/未来 sink 共用)。返回 offer 结果。 */
  function injectActivation(request) {
    try {
      if (!effectiveEnabled()) return { ok: false, reason: 'disabled' }
      if (sourceMode() !== 'fake') return { ok: false, reason: 'source-not-fake' }
      stats.injected++
      const rv = validateRequestShape(request)
      if (!rv.ok) { stats.injectedRejected++; return rv }
      const req = rv.request
      const box = registry.get(req.sessionId, req.workspaceKey)
      if (!box) {
        const created = registry.forRuntime(req.sessionId, req.workspaceKey, { contextVersion: req.contextVersion, memoryIndexVersion: req.memoryIndexVersion, agentId: req.agentId })
        if (!created) { stats.injectedRejected++; return { ok: false, reason: 'identity-mismatch' } }
        return finishInject(created, req)
      }
      if (!box.identity.agentId && req.agentId) box.identity.agentId = String(req.agentId)
      return finishInject(box, req)
    } catch (e) { stats.errors++; return { ok: false, reason: 'internal-error' } }
  }
  function finishInject(box, req) {
    box.setCursor({ contextVersion: req.contextVersion, memoryIndexVersion: req.memoryIndexVersion })
    const r = box.offerActivation(req, { nowStep: stepFor(req.sessionId, req.workspaceKey), currentMemoryIndexVersion: req.memoryIndexVersion })
    if (r.ok) {
      stats.injectedAccepted++
      // fake 来源「注入即泵」：立刻以请求自声明版本过四重门 claim，并把 claimed 挂到
      // 目标 runtime 态——下一次该 session 的自然 compose 会渲染尾注并 markDelivered(+seen)。
      pumpClaimed(box, req)
    } else stats.injectedRejected++
    pushEvent({ kind: 'inject', ok: !!r.ok, outcome: r.outcome || r.reason })
    return r
  }
  /**
   * 注入即泵(2026-08-28 自 fake 提取共享):offer 成功后立刻以请求自声明版本过四重门 claim,
   * claimed 挂到目标 runtime 态 → 下一次自然 compose 渲染尾注并 markDelivered(+seen)。
   * 动机(live 实证):DSH 会话 cv 每段自增 + TTL=3 步 < 多步回合长度,回合中途 offer 的
   * packet 活不到下一次 pre-step 自然 claim(claimFails 全 none-pending)。fake 与 JS 判定
   * 来源共用;Python 保持 pre-step 自然 claim(冻结契约,待 Python live 按证据另议)。
   */
  function pumpClaimed(box, req) {
    const c2 = box.claim({
      nowStep: stepFor(req.sessionId, req.workspaceKey),
      currentContextVersion: req.contextVersion,
      currentMemoryIndexVersion: req.memoryIndexVersion,
    })
    if (c2.ok) {
      stats.claims++
      let target = null
      for (const rt of engine.runtimes.values()) { if (rt.sessionId === req.sessionId && !rt.disposed) { target = rt; break } }
      if (target) {
        let st = runtimeState.get(target.key)
        if (!st) { st = { step: 0, claimed: null }; runtimeState.set(target.key, st) }
        st.claimed = { packet: c2.packet, inbox: box }
        pushEvent({ kind: 'pump', packetId: c2.packet.packetId, runtimeKey: String(target.key).slice(0, 24) })
      } else {
        box.rollbackClaim()
        pushEvent({ kind: 'pump', reason: 'no-runtime' })
      }
    } else {
      pushEvent({ kind: 'pump', reason: c2.reason })
    }
  }
  /**
   * M7-1 python 来源入口(worker activation_request 帧):JS 硬校验+身份/重复/抑制/cursor/index 门后入箱。
   * 与 fake 的注入即泵不同——真实 Python 推送不做 pump,走 pre-step 自然 claim(§8 时序保留;M6-4 偏差仅限 fake)。
   */
  function offerExternalActivation(request) {
    try {
      if (!effectiveEnabled()) return { ok: false, reason: 'disabled' }
      const sm = sourceMode()
      if (sm !== 'python' && sm !== 'js') return { ok: false, reason: 'source-not-python' }
      stats.injected++
      const rv = validateRequestShape(request)
      if (!rv.ok) { stats.injectedRejected++; return rv }
      const req = rv.request
      let box = registry.get(req.sessionId, req.workspaceKey)
      if (!box) {
        box = registry.forRuntime(req.sessionId, req.workspaceKey, { contextVersion: req.contextVersion, memoryIndexVersion: req.memoryIndexVersion, agentId: req.agentId })
        if (!box) { stats.injectedRejected++; return { ok: false, reason: 'identity-mismatch' } }
      }
      if (!box.identity.agentId && req.agentId) box.identity.agentId = String(req.agentId)
      const miv = currentMiv(req.workspaceKey)
      const r = box.offerActivation(req, { nowStep: stepFor(req.sessionId, req.workspaceKey), currentMemoryIndexVersion: miv === null ? undefined : miv })
      pushEvent({ kind: 'python-offer', ok: !!r.ok, outcome: r.outcome || r.reason })
      if (r.ok) {
        stats.injectedAccepted++
        // 2026-08-30:注入即泵扩展到 Python 来源——canary 实证(JS 档 08-28)自然 claim
        // 在回合中段必死(cv 每段自增+TTL3 步),Python emit 的时序机制完全相同,同一证据
        // 同一修法。泵是 M6 投递侧机制,不耦合任何语义档(JS/Python 各自独立可用)。
        pumpClaimed(box, req)
      } else stats.injectedRejected++
      return r
    } catch (e) { stats.errors++; return { ok: false, reason: 'internal-error' } }
  }
  function validateRequestShape(request) {
    if (!request || typeof request !== 'object') return { ok: false, reason: 'not-object' }
    if (typeof request.activationId !== 'string' || !request.activationId) return { ok: false, reason: 'no-activation-id' }
    return { ok: true, request }
  }
  const stepsByRuntime = new Map()
  function stepFor(sessionId, workspaceKey) {
    const key = sessionId + '|ws:' + workspaceKey
    const n = (stepsByRuntime.get(key) || 0) + 1
    stepsByRuntime.set(key, n)
    return n
  }

  /**
   * agent/pre-step(§8):先校验当前 cursor/index/TTL 再 claim;claimed packet 存 runtime 态,
   * 等待渲染面(text())消费。cursor/miv 取自 runtime 与 corpus 快照。
   */
  function onPreStep(agent) {
    try {
      if (!effectiveEnabled()) return
      const runtime = engine.runtimeFor(agent)
      if (!runtime || runtime.disposed) return
      const identity = identityFor(runtime)
      if (!identity) { pushEvent({ kind: 'prestep', reason: 'no-identity' }); return }
      const box = registry.forRuntime(identity.sessionId, identity.workspaceKey, { contextVersion: runtime.contextVersion })
      if (!box) return
      const miv = currentMiv(identity.workspaceKey)
      box.setCursor({ contextVersion: runtime.contextVersion, memoryIndexVersion: miv || undefined })
      const nowStep = stepFor(identity.sessionId, identity.workspaceKey)
      const c = box.claim({
        nowStep,
        currentContextVersion: runtime.contextVersion,
        currentMemoryIndexVersion: miv === null ? undefined : miv,
      })
      let st = runtimeState.get(runtime.key)
      if (!st) { st = { step: 0, claimed: null }; runtimeState.set(runtime.key, st) }
      st.step = nowStep
      if (c.ok) { st.claimed = { packet: c.packet, inbox: box }; stats.claims++ }
      else {
        // 2026-08-28 浏览器实测修复:claim 失败(none-pending 等)不得清掉已存在的 claimed——
        // 注入即泵挂上的包在 pending 里已不存在,下一次 pre-step 的 none-pending 失败会把
        // 它擦掉,导致 rendered 永远为 0。仅在无 claimed 时保持空位。
        stats.claimFails++; pushEvent({ kind: 'claim', reason: c.reason })
        if (process.env.DSH_ACT_DEBUG) console.error('[act-diag] claim fail ' + c.reason + ' runtimeCv=' + runtime.contextVersion + ' miv=' + miv)
      }
    } catch (e) { stats.errors++ }
  }

  /**
   * 专用渲染面(dsh:m6-reference-tail-pre 的 text()):重渲染 claimed packet 并校验 exactDigest,
   * 一致 → 返回尾注文本 + markDelivered + 异步 seen;不一致/未声明 → 返回空串(零注入)。
   */
  function renderTailFor(agent) {
    try {
      if (!effectiveEnabled()) return ''
      const runtime = engine.runtimeFor(agent)
      if (!runtime) return ''
      const st = runtimeState.get(runtime.key)
      if (!st || !st.claimed) return ''
      const { packet, inbox } = st.claimed
      const re = renderReferenceTail(packet.references, { reason: packet.triggerReason, budgetBytes: REFERENCE_TAIL_BUDGET_PRE_V1.maxPacketBytes })
      if (!re.ok || computeExactDigest(re.text) !== packet.exactDigest) {
        stats.errors++
        pushEvent({ kind: 'render', reason: 'digest-mismatch' })
        st.claimed = null
        return ''
      }
      const ack = inbox.markDelivered(packet.packetId, { nowStep: st.step })
      st.claimed = null
      if (!ack.ok) return ''
      stats.rendered++
      stats.delivered++
      void createSeenEvidences(runtime, packet)
      return re.text
    } catch (e) { stats.errors++; return '' }
  }

  /** delivery ack → M5 seen evidence(provenance 从 corpus 补全;查不到则跳过,fail closed)。 */
  async function createSeenEvidences(runtime, packet) {
    try {
      const ch = engine._contextHost
      const identity = identityFor(runtime)
      if (!ch || !identity) { stats.seenSkippedNoProv += packet.references.length; return }
      const evidences = []
      for (const ref of packet.references) {
        const prov = ch.findProvenance(identity.workspaceKey, ref.memoryId, ref.recordDigest)
        if (!prov) { stats.seenSkippedNoProv++; continue }
        const ev = createAccessEvidencePre({
          kind: 'seen', memoryId: prov.memoryId, anchorId: prov.anchorId, scope: prov.scope,
          workspaceKey: identity.workspaceKey, sessionId: identity.sessionId,
          eventSeq: runtime.eventCursor | 0, nativeSeq: undefined, contextVersion: packet.contextVersion,
          ts: Date.now(),
          sourceRef: prov.sourceRef, sourceEpoch: prov.sourceEpoch, sourceVersion: prov.sourceVersion,
          fileDigest: prov.fileDigest, recordDigest: prov.recordDigest,
        })
        if (ev.ok) evidences.push(ev.evidence)
      }
      if (evidences.length) {
        await ch.appendEvidence(evidences)
        stats.seenCreated += evidences.length
      }
    } catch (e) { stats.errors++ }
  }

  /** §11 capability(按当前宿主形状);Host 无 ctx 引用,由 index.js 注入一次。 */
  let capability = null
  function initCapability(ctxLike) { capability = detectPacketCapabilityPre(ctxLike); return capability }
  function getCapability() { return capability || { capabilityVersion: CAPABILITY_SNAPSHOT_PRE_V1, packetPatch: 'none', supportsDeliveryAck: false } }

  function debugView() {
    if (!effectiveEnabled()) return { enabled: false }
    const cap = getCapability()
    return {
      enabled: true,
      activationPolicyVersion: ACTIVATION_POLICY_VERSION,
      cooldownSteps: REFERENCE_TAIL_COOLDOWN_STEPS_PRE_V1,
      capability: cap,
      sourceMode: sourceMode(),
      memoryIndexVersion: mivCache.miv || null,
      inboxCount: registry.size,
      stats: { ...stats },
      recentEvents: volatileEvents.slice(-4),
    }
  }

  function disposeRuntime(runtimeKey) {
    runtimeState.delete(runtimeKey)
    stepsByRuntime.delete(String(runtimeKey))
  }
  function disposeAll(reason) {
    runtimeState.clear()
    stepsByRuntime.clear()
    registry.disposeAll(reason)
    volatileEvents.length = 0
  }
  function disposeSession(sessionId, workspaceKey) { registry.disposeSession(sessionId, workspaceKey) }

  return {
    initCapability,
    getCapability,
    capturePaths,
    effectiveEnabled,
    injectActivation,
    offerExternalActivation,
    onPreStep,
    renderTailFor,
    debugView,
    disposeRuntime,
    disposeAll,
    disposeSession,
    _statsForTest: stats,
  }
}
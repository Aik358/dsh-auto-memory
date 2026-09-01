/**
 * M6-2 Per-runtime Activation Inbox(docs/M6-CONTRACT.md §8-§9,§13 M6-2)。
 * 纯内存状态机,零 IO、零依赖(activation-inbox 纯核心);不接 Host、不碰 prompt。
 *   - 每个 SessionRuntime 一个 inbox 实例(Host 接线时经严格身份键注册,M6-3);
 *     本模块禁止任何全局 pendingPacket 或「最后活跃代理」式 fallback——状态只存在于实例内。
 *   - offer(request):JS 硬校验(schema/身份/重复/contextVersion/memoryIndexVersion/抑制名单)
 *     → 构建 ReferenceTailPacketPre → pending(新 cv 替换旧 pending=latest-wins)。
 *   - claim({nowStep,cursor}):TTL/cursor/index/cooldown 四重门 → claimed 并返回 packet。
 *   - markDelivered(packetId):claimed→delivered,启动 cooldown;只有此时才允许上游建 seen。
 *   - dispose():清空全部状态。
 * 全部同输入确定;UTF-8 无 BOM。
 */
import {
  validateActivationRequestPre, buildReferenceTailPacketPre, isExpired,
  REFERENCE_TAIL_BUDGET_V1, ACTIVATION_POLICY_VERSION, DELIVERY_STATES_V1,
} from './activation-inbox.js'

/** cooldown 步数策略(冻结;投递后冷却)。 */
export const REFERENCE_TAIL_COOLDOWN_STEPS_V1 = 2

const OFFER_REASONS = Object.freeze([
  'pending', 'replaced', 'duplicate-packet', 'duplicate-activation', 'duplicate-observation',
  'stale-context', 'stale-index', 'identity-mismatch', 'suppressed-candidate', 'invalid-request',
])

/** 单 runtime 收件箱状态机。 */
export function createActivationInboxPre(opts = {}) {
  const identity = {
    sessionId: String(opts.sessionId || ''),
    agentId: String(opts.agentId || ''),
    workspaceKey: String(opts.workspaceKey || ''),
  }
  let disposed = false
  let pending = null          // ReferenceTailPacketPre(deliveryState=pending)
  let claimedPacketId = null
  const deliveredIds = new Set()
  const deliveredOrder = []
  const seenActivationIds = new Set()
  const seenObservationIds = new Set()
  const suppressedMemoryIds = new Set() // 风险门:correction/revoked 记忆禁止进入 packet(M5 聚合喂入)
  let cooldownUntilStep = 0
  let lastActivationAt = 0
  let lastDeliveredAtStep = 0
  let currentCursor = { contextVersion: Number.isFinite(opts.contextVersion) ? opts.contextVersion : 0, memoryIndexVersion: String(opts.memoryIndexVersion || '') }
  let lastWorkerEpoch = ''
  const stats = { offered: 0, acceptedPending: 0, replaced: 0, duplicates: 0, claimed: 0, delivered: 0, expiredDrops: 0, staleDrops: 0, cooldownRejects: 0, suppressedOffers: 0 }

  function dropPending(reason) {
    if (!pending) return
    pending.deliveryState = reason === 'expired' ? 'expired' : 'dropped'
    pending = null
  }

  function offerActivation(request, ctx = {}) {
    if (disposed) return { ok: false, reason: 'disposed' }
    stats.offered++
    const rv = validateActivationRequestPre(request)
    if (!rv.ok) return { ok: false, reason: 'invalid-request:' + rv.reason }
    const req = rv.request
    // 身份门(§4):sessionId/agentId/workspaceKey 必须与本 runtime 完全一致(cross-workspace 拒绝)
    if (req.sessionId !== identity.sessionId || req.agentId !== identity.agentId || req.workspaceKey !== identity.workspaceKey) {
      return { ok: false, reason: 'identity-mismatch' }
    }
    // 重复激活门(§4):activationId/observationId 任一重复即拒绝
    if (seenActivationIds.has(req.activationId)) { stats.duplicates++; return { ok: false, reason: 'duplicate-activation' } }
    if (seenObservationIds.has(req.observationId)) { stats.duplicates++; return { ok: false, reason: 'duplicate-observation' } }
    // 抑制名单(correction/revoked 等):命中即整单拒绝(precision-first)
    const blocked = req.candidates.filter((c) => suppressedMemoryIds.has(c.memoryId))
    if (blocked.length) { stats.suppressedOffers++; return { ok: false, reason: 'suppressed-candidate', blocked: blocked.map((b) => b.memoryId) } }
    // cursor 门:请求的 contextVersion 落后当前 runtime 游标 → stale(时序门在身份/重复门之后)
    if (Number.isInteger(currentCursor.contextVersion) && req.contextVersion < currentCursor.contextVersion) {
      return { ok: false, reason: 'stale-context' }
    }
    if (ctx.currentMemoryIndexVersion !== undefined && ctx.currentMemoryIndexVersion !== req.memoryIndexVersion) {
      return { ok: false, reason: 'stale-index' }
    }
    const nowStep = Number(ctx.nowStep) || 0
    const built = buildReferenceTailPacketPre({ request: req, nowStep })
    if (!built.ok) return { ok: false, reason: built.reason }
    // latest-wins 替换语义(§8):同 contextVersion 同 packetId=幂等接受;否则替换旧 pending
    if (pending && pending.packetId === built.packet.packetId) {
      stats.duplicates++
      return { ok: true, outcome: 'duplicate-packet', packetId: pending.packetId }
    }
    const replacedCtx = pending ? pending.contextVersion : null
    dropPending('dropped')
    seenActivationIds.add(req.activationId)
    seenObservationIds.add(req.observationId)
    lastWorkerEpoch = String(req.workerEpoch || '')
    lastActivationAt = Date.now()
    pending = built.packet
    if (replacedCtx !== null) stats.replaced++; else stats.acceptedPending++
    return { ok: true, outcome: replacedCtx === null ? 'pending' : 'replaced', packetId: pending.packetId, replacedContextVersion: replacedCtx }
  }

  function setCursor(cursor) {
    if (disposed) return
    if (cursor && Number.isInteger(cursor.contextVersion)) currentCursor.contextVersion = cursor.contextVersion
    if (cursor && cursor.memoryIndexVersion !== undefined) currentCursor.memoryIndexVersion = String(cursor.memoryIndexVersion)
    // cursor 前进使旧 pending 失效(latest-wins)
    if (pending && pending.contextVersion < currentCursor.contextVersion) dropPending('dropped')
  }

  function suppressMemories(ids) {
    for (const id of Array.isArray(ids) ? ids : [ids]) suppressedMemoryIds.add(String(id))
  }

  /**
   * M10 存储管理级联清理(2026-08-30 P3):一条记忆被删除后,必须让它在途的激活包立即失效——
   * pending 包文本是烘焙好的,不清理就会在下一轮照样渲染出已删除的记忆(HANDOFF §2 P3 缺口②)。
   * 两步:①进抑制名单(后续 offer 整单拒绝,precision-first 语义不变)
   *       ②pending 包若含该 memoryId 整包丢弃(claimed 包由 Host 侧 runtimeState 清理)。
   * 不触碰 validator/Reference Tail 固定边界/seen 语义——只影响「还没投递出去的包」。
   */
  function purgeMemoryId(memoryId) {
    const id = String(memoryId || '')
    if (!id) return { ok: false, reason: 'no-memory-id', droppedPending: false }
    suppressMemories([id])
    let droppedPending = false
    if (pending && Array.isArray(pending.references) && pending.references.some((r) => r && r.memoryId === id)) {
      dropPending('dropped')
      droppedPending = true
    }
    return { ok: true, droppedPending, suppressed: true }
  }

  function claim(ctx = {}) {
    if (disposed) return { ok: false, reason: 'disposed' }
    const nowStep = Number(ctx.nowStep) || 0
    if (!pending) return { ok: false, reason: 'none-pending' }
    if (nowStep <= cooldownUntilStep && cooldownUntilStep > 0) { stats.cooldownRejects++; return { ok: false, reason: 'cooldown', cooldownRemainingSteps: cooldownUntilStep - nowStep } }
    if (isExpired(pending, nowStep)) {
      stats.expiredDrops++
      dropPending('expired')
      return { ok: false, reason: 'expired' }
    }
    if (ctx.currentContextVersion !== undefined && pending.contextVersion !== ctx.currentContextVersion) {
      stats.staleDrops++
      dropPending('dropped')
      return { ok: false, reason: 'stale-context' }
    }
    if (ctx.currentMemoryIndexVersion !== undefined && pending.memoryIndexVersion !== ctx.currentMemoryIndexVersion) {
      stats.staleDrops++
      dropPending('dropped')
      return { ok: false, reason: 'stale-index' }
    }
    pending.deliveryState = 'claimed'
    claimedPacketId = pending.packetId
    stats.claimed++
    return { ok: true, packet: pending }
  }

  /** §8:只有实际进入下一请求 messages 才调用;此时启动 cooldown。返回是否成功。 */
  function markDelivered(packetId, ctx = {}) {
    if (disposed || !claimedPacketId || claimedPacketId !== packetId) return { ok: false, reason: 'not-claimed' }
    const nowStep = Number(ctx.nowStep) || 0
    pending = null
    claimedPacketId = null
    deliveredIds.add(packetId)
    deliveredOrder.push(packetId)
    while (deliveredOrder.length > REFERENCE_TAIL_BUDGET_V1.deliveredIdsCapacity) {
      const oldest = deliveredOrder.shift()
      deliveredIds.delete(oldest)
    }
    cooldownUntilStep = nowStep + REFERENCE_TAIL_COOLDOWN_STEPS_V1
    lastDeliveredAtStep = nowStep
    stats.delivered++
    return { ok: true, packetId, cooldownUntilStep }
  }

  /** claimed→pending 回滚(pump 目标 runtime 缺失等场景);不影响 cooldown。 */
  function rollbackClaim() {
    if (!claimedPacketId || !pending) return { ok: false, reason: 'not-claimed' }
    pending.deliveryState = 'pending'
    claimedPacketId = null
    stats.claimed = Math.max(0, stats.claimed - 1)
    return { ok: true }
  }

  function debugView() {
    return {
      identityKeysPresent: Boolean(identity.sessionId && identity.workspaceKey),
      pending: pending ? { packetId: pending.packetId, contextVersion: pending.contextVersion, references: pending.references.length, expiresAtStep: pending.expiresAtStep } : null,
      claimedPacketId: claimedPacketId,
      deliveredCount: deliveredIds.size,
      cooldownUntilStep,
      lastActivationAt,
      lastDeliveredAtStep,
      lastWorkerEpoch: lastWorkerEpoch.slice(0, 16),
      stats: { ...stats },
    }
  }

  function dispose(reason) {
    void reason
    disposed = true
    dropPending('dropped')
    claimedPacketId = null
    deliveredIds.clear()
    deliveredOrder.length = 0
    seenActivationIds.clear()
    seenObservationIds.clear()
    suppressedMemoryIds.clear()
  }

  return {
    identity,
    offerActivation,
    setCursor,
    suppressMemories,
    purgeMemoryId,
    claim,
    rollbackClaim,
    markDelivered,
    debugView,
    dispose,
    get pendingPacket() { return pending },
    _statsForTest: stats,
    _suppressedForTest: suppressedMemoryIds,
  }
}

/**
 * 严格身份键注册表(M6-3 Host 接线用):无可靠身份不得创建 inbox(无 default 兜底桶)。
 * 键='session:'+sessionId;同一 sessionId 复用同一 inbox。
 */
export class ActivationInboxRegistry {
  constructor() { this._byKey = new Map() }
  static keyOf(sessionId, workspaceKey) {
    if (!sessionId || !workspaceKey) return null
    return 'session:' + String(sessionId) + '|ws:' + String(workspaceKey)
  }
  forRuntime(sessionId, workspaceKey, factoryOpts = {}) {
    const key = ActivationInboxRegistry.keyOf(sessionId, workspaceKey)
    if (!key) return null
    let box = this._byKey.get(key)
    if (!box) {
      box = createActivationInboxPre({ ...factoryOpts, sessionId, workspaceKey })
      this._byKey.set(key, box)
    } else if (factoryOpts.agentId && !box.identity.agentId) {
      box.identity.agentId = String(factoryOpts.agentId)
    }
    return box
  }
  get(sessionId, workspaceKey) {
    const key = ActivationInboxRegistry.keyOf(sessionId, workspaceKey)
    return key ? this._byKey.get(key) || null : null
  }
  /** M10 级联清理用:遍历全部 inbox(只读用途,返回副本数组,不泄漏内部 Map)。 */
  boxes() { return [...this._byKey.values()] }
  disposeSession(sessionId, workspaceKey) {
    const key = ActivationInboxRegistry.keyOf(sessionId, workspaceKey)
    if (key && this._byKey.has(key)) { this._byKey.get(key).dispose('session-disposed'); this._byKey.delete(key); return true }
    return false
  }
  disposeAll(reason) {
    for (const box of this._byKey.values()) box.dispose(reason)
    this._byKey.clear()
  }
  get size() { return this._byKey.size }
}
/** Thin MemoryEngine/DSH adapter. Only this module knows the host service registry. */
import { ContinuationCoordinator, createCheckpointStore } from './continuation-safety.js'
const ownersKey = Symbol.for('dsh-auto-memory.continuation.v1.source-guards')
const owners = globalThis[ownersKey] || (globalThis[ownersKey] = new WeakMap())

export function continuationHost(engine, { directory, atomicReplace, diag = () => {} }) {
  if (engine._continuationCoordinator) return engine._continuationCoordinator
  const store = createCheckpointStore(directory, { atomicReplace })
  const service = name => { try { return engine._ctxRef?.get?.(name) } catch { return undefined } }
  const state = engine._autoContState || (engine._autoContState = {})
  const options = {
    state, store,
    get controller() { return service('sessionController') },
    // No _lastAgent/runtime fallback: registry membership is part of readiness.
    getAgent: sid => service('agents')?.get?.(sid) || null,
    get guardInstalled() { return engine._continuationGuardInstalled === true },
    allowed: armed => engine.config.handoffEnabled !== false && (armed?.manual || engine.config.autoContinueEnabled !== false),
    buildCarry: async (sid, material) => {
      const source = options.getAgent(sid)
      if (!source || typeof engine.withAgent !== 'function') throw new Error('source-runtime-unavailable')
      const carry = await engine.withAgent(source, () => engine.buildContinueCarry(sid, material))
      if (carry?.ok && carry.prevSessionId !== sid) throw new Error('carry-source-identity-mismatch')
      return carry
    },
    refreshEnabled: () => engine.config.autoContinueRefreshRitual !== false,
    ritualPrompt: () => engine.refreshRitualPrompt(),
    inheritPermission: async (from, to) => {
      const result = await engine.inheritPermissionPreset(options.getAgent(from), to)
      // A missing service was historically optional; a present service failing is not success.
      if (result?.ok === false && result.reason !== 'no-permission-service') throw new Error('permission-inheritance-failed: ' + (result.reason || result.error || 'unknown'))
      return result
    },
    isContinued: sid => engine.isContinuedSession(sid),
    markContinued: (from, to) => engine.markContinuedSession(from, to),
    readSessionEvents: async sid => {
      const controller = service('sessionController')
      if (!controller?.inspect) throw new Error('cold-session-inspection-unavailable')
      const snapshot = await controller.inspect(sid, AbortSignal.timeout(10000))
      if (snapshot?.meta?.id !== sid || !Array.isArray(snapshot.events)) throw new Error('invalid-session-inspection')
      return snapshot.events
    },
    notice: text => diag('continuation: ' + text),
    pinSourceGuard(source) {
      const prior = owners.get(source)
      if (prior) return prior.scope === store.scope
      // Owned by the Agent's own scope, NOT by this plugin's disposable context.
      // The fence survives plugin hot reload while an admitted prompt may still settle.
      if (source.ctx !== source.scope?.ctx || typeof source.ctx?.on !== 'function') return false
      source.ctx.on('agent/pre-step', (payload, next) => payload.agent === source
        ? coordinator.guardSource(payload, next) : next())
      owners.set(source, { scope: store.scope })
      return true
    },
  }
  const coordinator = new ContinuationCoordinator(options)
  engine._continuationCoordinator = coordinator
  return coordinator
}

/** Existing arming policy moved intact, except an expired pending intent is never replaced. */
export function armContinuation(engine, agent, wl, opts, shouldArm, diag = () => {}) {
  try {
    if (!agent || !engine.hasReliableSessionIdentity(agent) || engine.config.handoffEnabled === false || engine.config.autoContinueEnabled === false) return
    if (!wl || !shouldArm(wl) || !(wl.ratio >= (Number(engine.config.autoContinueThreshold) || 0.75))) return
    const st = engine._autoContState || (engine._autoContState = {}), now = Date.now()
    const cooldownMin = Number(engine.config.autoContinueCooldownMinutes) || 30
    if (st.lastRunAt && now - st.lastRunAt < cooldownMin * 60000) return
    const sid = String(agent.session.id || agent.session.header?.id || '')
    if (engine.isContinuedSession(sid) || (st.rejectedEdgeAt && now - st.rejectedEdgeAt < 10 * 60 * 1000) || st.armed || st.executing) return
    const confirmSec = Number(engine.config.autoContinueConfirmSeconds)
    const sec = confirmSec >= 10 && confirmSec <= 120 ? confirmSec : 35
    st.armed = { edgeAt: now, sessionId: sid, expiresAt: now + sec * 1000,
      ratio: Number(wl.ratio) || 0, tokens: Number(wl.tokens) || 0, window: Number(wl.window) || 0, source: String(wl.source || ''),
      ring: Number(engine.state?.waterLevelRing) || 0, wall: Number(engine.state?.waterLevelWall) || 0,
      awaitIdle: !!opts?.awaitIdle, deferCount: 0 }
  } catch (error) { diag('armAutoContinue: ' + String(error?.message || error)) }
}

export function continuationState(engine, selfSid) {
  const st = engine._autoContState || {}, sid = String(selfSid || '')
  const armed = sid && st.armed?.sessionId === sid ? { ...st.armed, leftMs: Math.max(0, st.armed.expiresAt - Date.now()) } : null
  const lastOk = sid && st.lastOk?.fromSessionId === sid ? { ...st.lastOk } : null
  const executing = !!sid && st.executing === true && st.executingFor === sid
  return { enabled: engine.config.handoffEnabled !== false && engine.config.autoContinueEnabled !== false,
    threshold: Number(engine.config.autoContinueThreshold) || 0.75, armed, lastOk, executing, error: (armed || executing || lastOk) ? st.error || '' : '',
    lastRunAt: lastOk?.at || 0, rejectedEdgeAt: st.rejectedEdgeAt || 0 }
}

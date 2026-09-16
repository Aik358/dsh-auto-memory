/**
 * Issue #35: one request owner, durable at-most-once carry delivery, true-idle gates.
 * Public host contracts pinned in docs/PR37-HOST-CONTRACT.md.
 * No elapsed-activity heuristic, no forced defer limit, no cancel of source work.
 */
import { createHash, randomUUID } from 'node:crypto'
import { readFile, readdir } from 'node:fs/promises'
import path from 'node:path'

const PHASES = new Set(['prepared', 'created', 'submitting', 'delivered'])
const sharedKey = Symbol.for('dsh-auto-memory.continuation.v1.flights')
const flights = globalThis[sharedKey] || (globalThis[sharedKey] = new Map())
const queueKey = Symbol.for('dsh-auto-memory.continuation.v1.checkpoint-queues')
const sharedQueues = globalThis[queueKey] || (globalThis[queueKey] = new Map())
const hash = bytes => createHash('sha256').update(bytes).digest('hex')
const errorText = error => String(error?.message || error)
const rpc = message => message?.source?.kind === 'user' ? message.source.rpcId : undefined

/** Current DSH exposes the next sequence number, not a public .events array. */
export function sourceBoundary(agent) {
  try { const seq = agent?.session?.seq; return Number.isSafeInteger(seq) && seq >= 0 ? seq - 1 : null }
  catch { return null }
}
export function readiness(agent, sid) {
  try {
    if (!sid || !agent || agent.session?.id !== sid) return { ready: false, reason: 'source-unavailable' }
    if (agent.status !== 'idle') return { ready: false, reason: 'source-not-idle' } // M1
    if (!Array.isArray(agent.inbox?.nextTurn) || !Array.isArray(agent.inbox?.nextStep)) return { ready: false, reason: 'inbox-unavailable' }
    if (agent.inbox.nextTurn.length || agent.inbox.nextStep.length) return { ready: false, reason: 'inbox-pending' }
    if (sourceBoundary(agent) === null) return { ready: false, reason: 'source-events-unavailable' }
    return { ready: true }
  } catch { return { ready: false, reason: 'source-unavailable' } }
}
function validateCheckpoint(cp, sid) {
  if (!cp || cp.version !== 1 || cp.oldSessionId !== sid || !PHASES.has(cp.phase)
      || typeof cp.newSessionId !== 'string' || !cp.newSessionId.startsWith('session-')
      || cp.newSessionId === sid || typeof cp.requestId !== 'string' || !cp.requestId
      || !Number.isSafeInteger(cp.sourceSeq) || cp.sourceSeq < -1) throw new Error('invalid-continuation-checkpoint')
  if (cp.carry != null && (typeof cp.carry.carryText !== 'string' || !cp.carry.carryText.trim())) throw new Error('invalid-checkpoint-carry')
  if (cp.phase !== 'prepared' && !cp.carry) throw new Error('checkpoint-carry-missing')
  return cp
}
/** Reuses the caller's existing atomicReplace helper; read corruption is never treated as ENOENT. */
export function createCheckpointStore(directory, { atomicReplace } = {}) {
  if (typeof atomicReplace !== 'function') throw new Error('atomicReplace adapter required')
  const scope = path.resolve(directory)
  const queues = sharedQueues.get(scope) || new Map()
  sharedQueues.set(scope, queues)
  const file = sid => path.join(scope, hash(String(sid)) + '.json')
  const load = async sid => {
    try { return validateCheckpoint(JSON.parse(await readFile(file(sid), 'utf8')), sid) }
    catch (error) { if (error?.code === 'ENOENT') return null; throw error }
  }
  const queue = (sid, task) => {
    const previous = queues.get(sid) || Promise.resolve()
    const run = previous.then(task, task), settled = run.then(() => {}, () => {})
    queues.set(sid, settled)
    settled.then(() => { if (queues.get(sid) === settled) queues.delete(sid) })
    return run
  }
  const write = async (sid, cp) => {
    validateCheckpoint(cp, sid)
    await atomicReplace(file(sid), Buffer.from(JSON.stringify(cp), 'utf8'))
    return cp
  }
  return { scope, file, load,
    save: (sid, cp) => {
      const snapshot = structuredClone(cp)
      return queue(sid, async () => {
        // An acknowledged reject cannot be resurrected by a stale in-flight create result.
        const current = await load(sid)
        if (current?.cancelled) snapshot.cancelled = true
        return write(sid, snapshot)
      })
    },
    update: (sid, change) => queue(sid, async () => write(sid, await change(await load(sid)))),
    async list() {
      let names
      try { names = await readdir(scope) } catch (error) { if (error?.code === 'ENOENT') return []; throw error }
      const entries = []
      for (const name of names.filter(n => /^[0-9a-f]{64}\.json$/.test(n)).sort()) {
        const cp = JSON.parse(await readFile(path.join(scope, name), 'utf8'))
        validateCheckpoint(cp, cp.oldSessionId)
        if (path.basename(file(cp.oldSessionId)) !== name) throw new Error('checkpoint-key-mismatch')
        entries.push(cp)
      }
      return entries
    },
  }
}
/** Logged insertion proves admission even between claim and user/message logging.
 * Session persistence is buffered by DSH: this is not a disk-fsync/power-loss claim. */
export function hasReceipt(events, agent, requestId) {
  if (!requestId) return false
  return (Array.isArray(events) && events.some(event =>
    (event.type === 'user/message' && rpc(event.data) === requestId)
    || (event.type === 'agent/inbox/spliced' && event.data?.inserted?.some(message => rpc(message) === requestId))))
    || [...(agent?.inbox?.nextTurn || []), ...(agent?.inbox?.nextStep || [])].some(message => rpc(message) === requestId)
}
function ritualTurn(events, ritual) {
  if (!Array.isArray(events)) return null
  let turn = null, owner = null, userSeq = null, completed = false, endSeq = null, previous = -1
  for (const event of events) {
    if (!Number.isSafeInteger(event?.seq) || event.seq <= previous) return null
    previous = event.seq
    if (event.seq <= ritual.afterSeq) continue
    if (event.type === 'turn/start') {
      if (owner !== null || !Number.isSafeInteger(event.data?.turn)) return null
      turn = event.data.turn
    }
    if (event.type === 'user/message') {
      // Real hosts splice their own scaffolding into every turn as a role=user message
      // whose source.kind is not 'user' (observed: {kind:'plugin', plugin:'@deepseek-ai/
      // dsh-system-prompt', form:'snapshot'}, carrying this plugin's own memory context).
      // That is not user input, and treating it as intruding input made the proof
      // unsatisfiable whenever the ritual prompt was delivered -- the plugin vetoed its
      // own proof and every continuation deferred as 'timeout'.
      if (event.data?.source?.kind !== 'user') continue
      if (rpc(event.data) !== ritual.requestId || turn === null || completed || owner !== null) return null // M4
      owner = turn; userSeq = event.seq
    }
    if (event.type === 'turn/end' && owner !== null) {
      if (event.data?.turn !== owner || event.data?.reason?.kind !== 'completed') return null
      completed = true; endSeq = event.seq
    }
  }
  return owner === null ? null : { turn: owner, completed, endSeq, userSeq }
}
function endedRitual(events, ritual) {
  if (!Array.isArray(events)) return null
  let turn = null, owner = null
  for (const event of events) {
    if (event.seq <= ritual.afterSeq) continue
    if (event.type === 'turn/start') turn = event.data?.turn
    if (event.type === 'user/message' && rpc(event.data) === ritual.requestId) owner = turn
    if (event.type === 'turn/end' && owner != null && event.data?.turn === owner) return event
  }
  return null
}
function toolArguments(event) { try { return typeof event.data.arguments === 'string' ? JSON.parse(event.data.arguments) : event.data.arguments } catch { return null } }
/** Proof uses real RPC/turn/tool-call/result identities, not assistant counts or filesystem stamps. */
export function proveRitual(events, sid, ritual) {
  const boundary = ritual && ritualTurn(events, ritual)
  if (!boundary?.completed) return { ok: false, reason: 'uncertain' }
  for (const kind of ['plan', 'handoff']) {
    const write = ritual.writes?.[kind]
    if (!write || write.sessionId !== sid || write.requestId !== ritual.requestId || write.turn !== boundary.turn
        || !write.path || !/^[0-9a-f]{64}$/.test(write.digest || '')) return { ok: false, reason: 'uncertain' }
    const call = events.find(event => event.seq === write.callSeq && event.type === 'tool/call'
      && event.data?.turn === boundary.turn && event.data.callId === write.callId
      && ['memory_note', 'memory_note_pre'].includes(event.data.name) && toolArguments(event)?.kind === kind)
    if (!call || call.seq <= boundary.userSeq || call.seq >= boundary.endSeq) return { ok: false, reason: 'uncertain' }
    const result = events.find(event => event.seq > call.seq && event.seq < boundary.endSeq && event.type === 'tool/result'
      && event.data?.turn === boundary.turn && event.data.message?.source?.kind === 'tool' && event.data.message.source.callId === write.callId)
    const message = result?.data?.message, block = message?.content?.[0]
    if (!result || message.role !== 'user' || message.content.length !== 1 || block?.type !== 'tool-result'
        || block.toolCallId !== write.callId || block.isError === true || result.data.error) return { ok: false, reason: 'uncertain' }
  }
  return { ok: true, turn: boundary.turn, endSeq: boundary.endSeq }
}
async function bounded(call, milliseconds) {
  let timer
  const timeout = new Promise((_, reject) => { timer = setTimeout(() => reject(Object.assign(new Error('submission-timeout'), { uncertain: true })), milliseconds) })
  try { return await Promise.race([Promise.resolve(call()), timeout]) }
  finally { clearTimeout(timer) }
}

export class ContinuationCoordinator {
  constructor(options) {
    this.o = options; this.state = options.state; this.store = options.store
    this.now = options.now || Date.now; this.makeId = options.makeId || randomUUID
  }
  key(sid) { return this.store.scope + '\0' + sid }
  defer(sid, reason, extra = {}) {
    const armed = this.state.armed
    if (armed?.sessionId === sid) {
      armed.deferCount = (armed.deferCount || 0) + 1
      armed.expiresAt = this.now() + 20000; armed.waitReason = reason
    }
    return { ok: true, deferred: true, reason, ...extra }
  }
  async decide(action, edgeAt, fromSessionId) {
    const armed = this.state.armed
    const sid = fromSessionId || armed?.sessionId
    if (!sid) return { ok: false, error: 'source-session-required' }
    if (armed && (armed.sessionId !== sid || (edgeAt && edgeAt !== armed.edgeAt))) return { ok: false, error: 'stale-edge' }
    if (action === 'reject') return this.reject(sid)
    if (!['agree', 'manual'].includes(action)) return { ok: false, error: 'unknown-action' }
    if (!armed) {
      let cp
      try { cp = await this.store.load(sid) } catch (error) { return { ok: false, error: errorText(error) } }
      if (action !== 'manual' && !cp) return { ok: false, error: 'no-pending-continuation' }
      this.state.armed = { sessionId: sid, edgeAt: edgeAt || this.now(), expiresAt: 0, manual: action === 'manual' }
    }
    if (action === 'manual') this.state.armed.manual = true
    return this.request(sid, { manual: action === 'manual' })
  }
  async tick() {
    if (!this.state.armed) {
      // Recovery runs through the same executor and NEVER resends an uncertain submission.
      try {
        const cp = (await this.store.list()).find(cp => !cp.cancelled && cp.phase !== 'delivered')
        if (cp) this.state.armed = { sessionId: cp.oldSessionId, edgeAt: this.now(), expiresAt: 0, recovery: true }
      } catch (error) { return { ok: false, error: errorText(error) } }
    }
    if (!this.state.armed || this.state.armed.expiresAt > this.now()) return { ok: true, pending: !!this.state.armed }
    return this.request(this.state.armed.sessionId)
  }
  request(sid, { manual = false } = {}) {
    const key = this.key(sid)
    if (flights.has(key)) return flights.get(key).promise
    const run = { cancelled: false, commitStarted: false, manual, promise: null }
    flights.set(key, run)
    this.state.executing = true; this.state.executingFor = sid; this.state.error = ''
    run.promise = Promise.resolve().then(() => this.execute(sid, run)).then(result => {
      if (result.uncertain) {
        this.state.error = result.error || 'delivery-submitted-unconfirmed'
        if (this.state.armed?.sessionId === sid) this.state.armed.waitReason = 'delivery-uncertain'
      }
      return result
    }).catch(error => {
      this.state.error = errorText(error)
      return { ok: false, error: this.state.error, ...(run.commitStarted ? { uncertain: true, reason: 'uncertain' } : {}) }
    }).finally(() => {
      if (flights.get(key) === run) flights.delete(key)
      this.state.executing = false; this.state.executingFor = ''
    })
    return run.promise
  }
  async reject(sid) {
    const run = flights.get(this.key(sid))
    if (run?.commitStarted) return { ok: false, uncertain: true, error: 'delivery-submitted-or-uncertain' }
    // Linearize cancellation BEFORE any await: the executor checks this before committing intent.
    if (run) run.cancelled = true
    try {
      const cp = await this.store.load(sid) || run?.checkpoint
      if (cp && ['submitting', 'delivered'].includes(cp.phase)) return { ok: false, uncertain: cp.phase === 'submitting', error: 'delivery-submitted-or-delivered' }
      if (cp) { cp.cancelled = true; await this.store.save(sid, cp) }
      this.state.rejectedEdgeAt = this.state.armed?.edgeAt || this.now(); this.state.armed = null
      return { ok: true, rejected: true }
    } catch (error) { return { ok: false, error: errorText(error) } }
  }
  async events(sid) {
    if (typeof this.o.readSessionEvents !== 'function') throw new Error('session-inspection-unavailable')
    const events = await this.o.readSessionEvents(sid)
    if (!Array.isArray(events) || events.some((event, i) => event?.seq !== i)) throw new Error('session-inspection-not-contiguous')
    return events
  }
  async receipt(cp, requestId = cp.requestId, sessionId = cp.newSessionId) {
    const agent = this.o.getAgent(sessionId)
    if (hasReceipt(null, agent, requestId)) return true
    if (this.o.readSessionEvents) {
      try { return hasReceipt(await this.events(sessionId), agent, requestId) } catch { return false }
    }
    return false
  }
  async delivered(cp, permission = null) {
    cp.phase = 'delivered'; cp.deliveredAt ||= this.now()
    await this.store.save(cp.oldSessionId, cp)
    // The old latch is UI/backward compatibility, not the correctness boundary.
    try { await this.o.markContinued?.(cp.oldSessionId, cp.newSessionId) } catch (error) { this.o.notice?.('continued-latch: ' + errorText(error)) }
    const result = { ok: true, sessionId: cp.newSessionId, fromSessionId: cp.oldSessionId,
      model: cp.carry?.model || '', reasoningEffort: cp.carry?.reasoningEffort || '', workspaceId: cp.carry?.workspaceId || '',
      permissionPreset: permission?.preset || '', refreshRitual: cp.ritual ? 'updated' : 'disabled' }
    this.state.armed = null; this.state.lastRunAt = cp.deliveredAt; this.state.lastOk = { ...result, at: cp.deliveredAt }
    return result
  }
  gate(sid, source, cp = null, signal = null, run = null) {
    if (run?.cancelled || signal?.aborted) return 'cancelled'
    if (this.o.getAgent(sid) !== source) return 'source-replaced'
    const ready = readiness(source, sid)
    if (!ready.ready) return ready.reason
    if (cp && sourceBoundary(source) !== cp.sourceSeq) return 'source-changed'
    return null
  }
  async execute(sid, run) {
    let cp = await this.store.load(sid) // M5: persisted attempt is authoritative.
    if (cp?.phase === 'delivered') return this.delivered(cp)
    if (cp?.phase === 'submitting') {
      if (await this.receipt(cp)) return this.delivered(cp)
      return { ok: false, uncertain: true, reason: 'uncertain', sessionId: cp.newSessionId, requestId: cp.requestId }
    }
    if (cp?.cancelled && run.manual && !run.cancelled) {
      cp = await this.store.update(sid, current => ({ ...current, cancelled: false }))
    }
    if (cp?.cancelled || run.cancelled) return { ok: false, error: 'cancelled' }
    if (this.o.guardInstalled !== true) throw new Error('source-pre-step-guard-unavailable')
    if (!this.o.controller?.create || !this.o.controller?.prompt) throw new Error('session-controller-unavailable')
    if (this.o.allowed && !this.o.allowed(this.state.armed)) return { ok: false, error: 'continuation-disabled' }
    const source = this.o.getAgent(sid)
    const ready = readiness(source, sid)
    if (!ready.ready) return this.defer(sid, ready.reason) // M2: unlimited fail-closed deferral.
    if (typeof source.runMaintenance !== 'function' || typeof source.inbox.prepend !== 'function') throw new Error('host-maintenance-or-preservation-unavailable')
    if (!cp && this.o.isContinued?.(sid)) return { ok: false, error: 'source-already-continued' }
    if (this.o.pinSourceGuard && this.o.pinSourceGuard(source) !== true) throw new Error('source-owned-guard-unavailable')
    if (!cp) {
      cp = { version: 1, oldSessionId: sid, newSessionId: 'session-' + this.makeId(), requestId: this.makeId(), sourceSeq: sourceBoundary(source), phase: 'prepared', carry: null }
      run.checkpoint = cp // Reject can persist a tombstone while the first save is still in flight.
      await this.store.save(sid, cp)
    }
    if (!cp.carry || cp.sourceSeq !== sourceBoundary(source)) {
      const ritual = await this.refresh(cp, run)
      if (!ritual.ok) return this.defer(sid, ritual.reason, { ...ritual, ok: false })
      cp = await this.store.load(sid)
      let reason = this.gate(sid, source, null, null, run)
      if (reason) return this.defer(sid, reason)
      const boundary = sourceBoundary(source)
      const material = cp.ritual ? await this.freezeRitualMaterial(cp, source) : null
      const carry = await this.o.buildCarry(sid, material)
      if (!carry?.ok || typeof carry.carryText !== 'string' || !carry.carryText.trim()) throw new Error(carry?.error || 'handoff-material-unavailable')
      reason = this.gate(sid, source, { sourceSeq: boundary }, null, run)
      if (reason) return this.defer(sid, reason)
      cp.carry = carry; cp.sourceSeq = boundary
      await this.store.save(sid, cp)
    }
    // runMaintenance reserves the true idle phase synchronously (status alone includes maintenance).
    return source.runMaintenance(async signal => {
      let reason = this.gate(sid, source, cp, signal, run)
      if (reason) return this.defer(sid, reason)
      const c = this.o.controller, d = cp.carry
      if (cp.phase === 'prepared' || !this.o.getAgent(cp.newSessionId)) {
        const created = await bounded(() => c.create({ sessionId: cp.newSessionId,
          ...(d.workspaceId ? { workspaceId: d.workspaceId } : { cwd: d.ws }), ...(d.agentPreset ? { agentPreset: d.agentPreset } : {}) }), this.o.submissionTimeoutMs ?? 120000)
        if (created?.sessionId !== cp.newSessionId) throw new Error('create-identity-mismatch')
        cp.phase = 'created'; await this.store.save(sid, cp)
      }
      reason = this.gate(sid, source, cp, signal, run)
      if (reason) return this.defer(sid, reason)
      if (await this.receipt(cp)) return this.delivered(cp)
      const target = this.o.getAgent(cp.newSessionId), targetEvents = await this.events(cp.newSessionId)
      if (!readiness(target, cp.newSessionId).ready || targetEvents.some(e => e.type === 'user/message' || e.type === 'turn/start'
        || (e.type === 'agent/inbox/spliced' && e.data?.inserted?.length))) throw new Error('target-not-pristine')
      if (d.contSeq && typeof c.rename === 'function') {
        try { await c.rename({ sessionId: cp.newSessionId, title: '接续 #' + d.contSeq + (d.wsBase ? ' · ' + d.wsBase : '') }) }
        catch (error) { this.o.notice?.('continuation-title: ' + errorText(error)) }
      }
      if (d.provider && d.model) {
        if (!c.selectModel) throw new Error('select-model-unavailable')
        await c.selectModel({ sessionId: cp.newSessionId, provider: d.provider, model: d.model, ...(d.reasoningEffort ? { reasoningEffort: d.reasoningEffort } : {}) })
      }
      const permission = await this.o.inheritPermission?.(sid, cp.newSessionId)
      if (run.cancelled) return { ok: false, error: 'cancelled' }
      const finalTargetEvents = await this.events(cp.newSessionId)
      const targetBoundary = sourceBoundary(target)
      if (!readiness(target, cp.newSessionId).ready || targetBoundary !== finalTargetEvents.length - 1
          || finalTargetEvents.some(e => e.type === 'user/message' || e.type === 'turn/start'
            || (e.type === 'agent/inbox/spliced' && e.data?.inserted?.length))) throw new Error('target-not-pristine')
      run.commitStarted = true
      cp.phase = 'submitting'; await this.store.save(sid, cp)
      reason = this.gate(sid, source, cp, signal, run) // M6: the last gate is AFTER every awaited preparation/write.
      if (!reason && (this.o.getAgent(cp.newSessionId) !== target || sourceBoundary(target) !== targetBoundary || !readiness(target, cp.newSessionId).ready)) reason = 'target-changed'
      if (reason) {
        cp.phase = 'created'; await this.store.save(sid, cp); run.commitStarted = false
        return this.defer(sid, reason)
      }
      try {
        const answer = await bounded(() => c.prompt({ sessionId: cp.newSessionId, requestId: cp.requestId,
          content: [{ type: 'text', text: d.carryText }], mode: 'queue' }, new AbortController().signal), this.o.submissionTimeoutMs ?? 120000)
        if (answer?.accepted !== true) {
          if (answer?.accepted === false) { cp.phase = 'created'; await this.store.save(sid, cp); run.commitStarted = false; return { ok: false, error: 'prompt-rejected' } }
          throw Object.assign(new Error('prompt-acknowledgement-uncertain'), { uncertain: true })
        }
        return this.delivered(cp, permission)
      } catch (error) {
        if (await this.receipt(cp)) return this.delivered(cp, permission)
        // session/agent-busy wraps the entire admission, including code AFTER followup.
        // Its name is not proof of non-admission; no receipt means uncertain, not permission to retry.
        return { ok: false, uncertain: true, reason: 'uncertain', error: errorText(error), sessionId: cp.newSessionId, requestId: cp.requestId }
      }
    })
  }
  async refresh(cp, run) {
    if (!this.o.refreshEnabled?.()) return { ok: true, reason: 'disabled' }
    const sid = cp.oldSessionId, source = this.o.getAgent(sid)
    const openingEvents = await this.events(sid)
    const ended = cp.ritual && endedRitual(openingEvents, cp.ritual)
    // A terminal old request may be superseded; an unobserved/unfinished request may NOT.
    if (ended && (!proveRitual(openingEvents, sid, cp.ritual).ok || sourceBoundary(source) !== ended.seq)) cp.ritual = null
    if (!cp.ritual) {
      cp.ritual = { requestId: this.makeId(), afterSeq: sourceBoundary(source), submitted: false, writes: {} }
      await this.store.save(sid, cp)
    }
    const ritual = cp.ritual
    if (!ritual.submitted) {
      const reason = this.gate(sid, source, null, null, run)
      if (reason) return { ok: false, reason }
      // Persist before calling: a missing response cannot authorize another ritual submission.
      ritual.submitted = true; await this.store.save(sid, cp)
      const finalReason = this.gate(sid, source, { sourceSeq: ritual.afterSeq }, null, run)
      if (finalReason) { ritual.submitted = false; await this.store.save(sid, cp); return { ok: false, reason: finalReason } }
      try {
        const accepted = await bounded(() => this.o.controller.prompt({ sessionId: sid, requestId: ritual.requestId,
          content: [{ type: 'text', text: this.o.ritualPrompt() }], mode: 'queue' }, new AbortController().signal), this.o.submissionTimeoutMs ?? 120000)
        if (accepted?.accepted === false) {
          ritual.submitted = false; await this.store.save(sid, cp)
          return { ok: false, reason: 'ritual-rejected' }
        }
        if (accepted?.accepted !== true && !await this.receipt(cp, ritual.requestId, sid)) return { ok: false, reason: 'uncertain', uncertain: true }
      } catch (error) {
        // A busy wrapper can follow an effect; reconcile before declaring anything.
        if (!await this.receipt(cp, ritual.requestId, sid)) return { ok: false, reason: 'uncertain', uncertain: true }
      }
    }
    const deadline = this.now() + (this.o.ritualTimeoutMs ?? 90000)
    do {
      if (run.cancelled || this.o.getAgent(sid) !== source) return { ok: false, reason: 'cancelled' }
      const current = await this.store.load(sid), proof = proveRitual(await this.events(sid), sid, current.ritual)
      if (proof.ok && readiness(source, sid).ready) {
        let valid = true
        for (const write of Object.values(current.ritual.writes)) {
          try { if (hash(await readFile(write.path)) !== write.digest) valid = false } catch { valid = false }
        }
        if (valid) return { ok: true, reason: 'updated' }
      }
      if (this.now() >= deadline) break
      await new Promise(resolve => setTimeout(resolve, this.o.pollMs ?? 250))
    } while (this.now() <= deadline)
    return { ok: false, reason: 'timeout' }
  }
  async freezeRitualMaterial(cp, source) {
    if (!proveRitual(await this.events(cp.oldSessionId), cp.oldSessionId, cp.ritual).ok) throw new Error('ritual-proof-stale')
    const out = {}
    for (const kind of ['plan', 'handoff']) {
      const receipt = cp.ritual.writes[kind], bytes = await readFile(receipt.path)
      if (hash(bytes) !== receipt.digest) throw new Error('ritual-material-changed')
      out[kind + 'Text'] = bytes.toString('utf8'); out[kind + 'Path'] = receipt.path
    }
    // Pass immutable captured text to the real carry builder, never "latest handoff" discovery.
    return Object.freeze(out)
  }
  /** Called only inside the actual successful memory_note writer, with real exec.callId. */
  async recordWrite(exec, kind, result) {
    if (!['plan', 'handoff'].includes(kind) || result?.ok !== true || !result.path || typeof result.final !== 'string') return false
    const source = exec?.agent, sid = source?.session?.id
    if (!sid || this.o.getAgent(sid) !== source || !exec.callId) return false
    const cp = await this.store.load(sid), ritual = cp?.ritual
    const events = await this.events(sid), active = ritual && ritualTurn(events, ritual)
    if (!active || active.completed) return false
    const call = events.find(event => event.type === 'tool/call' && event.data?.callId === exec.callId
      && event.data.turn === active.turn && event.data.name === exec.name
      && ['memory_note', 'memory_note_pre'].includes(event.data.name) && toolArguments(event)?.kind === kind)
    if (!call || call.seq <= active.userSeq) return false
    const bytes = await readFile(result.path)
    const canonical = text => text.replace(/\r\n/g, '\n').trimEnd()
    if (canonical(bytes.toString('utf8')) !== canonical(result.final)) return false
    const receipt = { sessionId: sid, requestId: ritual.requestId, turn: active.turn, callId: exec.callId,
      callSeq: call.seq, path: result.path, digest: hash(bytes) }
    await this.store.update(sid, current => {
      if (current.ritual?.requestId !== ritual.requestId) throw new Error('ritual-owner-changed')
      current.ritual.writes[kind] = receipt
      return current
    })
    return true
  }
  /**
   * Once carry submission starts, the old session is a read-only source.
   * DSH claims before pre-step. Put every claimed message back before rejecting;
   * do not cancel/clear the inbox or pretend an uncertain delivery was undone.
   */
  async guardSource(payload, next) {
    const source = payload?.agent, sid = source?.session?.id
    if (!sid) return next()
    let blocked = false, target = ''
    try {
      const cp = await this.store.load(sid)
      blocked = !!cp && ['submitting', 'delivered'].includes(cp.phase); target = cp?.newSessionId || ''
    } catch { blocked = true }
    if (!blocked) return next()
    const pending = new Set([...(source.inbox?.nextTurn || []), ...(source.inbox?.nextStep || [])].map(m => m.id))
    const messages = (payload.messages || []).filter(message => !pending.has(message.id))
    if (messages.length && typeof source.inbox?.prepend !== 'function') throw new Error('cannot-preserve-claimed-source-input')
    for (let i = messages.length - 1; i >= 0; i--) source.inbox.prepend('next-turn', messages[i])
    this.o.notice?.('Source continuation is submitted; input preserved in old inbox. Use ' + (target || 'the continuation target') + '.')
    return { kind: 'reject' }
  }
}

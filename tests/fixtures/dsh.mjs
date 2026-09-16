import { randomUUID } from 'node:crypto'
// Behavioral fixture for DSH 0d1f5000. Not a copy of the continuation algorithm.
// Maintains the real host's public status/inbox/event shapes and admission order.
export function deferred() {
  let resolve, reject
  const promise = new Promise((a, b) => { resolve = a; reject = b })
  return { promise, resolve, reject }
}
export async function until(predicate, limit = 2000) {
  for (let i = 0; i < limit; i++) {
    if (predicate()) return
    await new Promise(resolve => setTimeout(resolve, 1))
  }
  throw new Error('fixture condition not reached')
}
export class AgentFixture {
  constructor(id, { events = [], autoRun = true, preStep = async () => ({ kind: 'enter' }) } = {}) {
    this.id = id
    this.session = { id, header: { id }, events: structuredClone(events) }
    Object.defineProperty(this.session, 'seq', { configurable: true, get() { return this.events.length } })
    this.phase = 'idle'
    this.autoRun = autoRun
    this.preStep = preStep
    this.modelStarts = 0
    this.turn = 0
    this.wakeRequested = false
    this.activity = Promise.resolve()
    const queues = { 'next-turn': [], 'next-step': [] }
    this.inbox = {
      get nextTurn() { return queues['next-turn'] },
      get nextStep() { return queues['next-step'] },
      get hasPending() { return queues['next-turn'].length > 0 || queues['next-step'].length > 0 },
      splice: (target, start, count, inserted = []) => {
        const queue = queues[target]
        const offset = Math.min(start, queue.length)
        const removedIds = new Set(queue.slice(offset, offset + count).map(m => m.id))
        const pendingIds = new Set([...queues['next-turn'], ...queues['next-step']].filter(m => !removedIds.has(m.id)).map(m => m.id))
        for (const message of inserted) {
          if (pendingIds.has(message.id)) throw new Error('duplicate pending message id')
          pendingIds.add(message.id)
        }
        const removed = queue.splice(offset, count, ...inserted)
        this.append('agent/inbox/spliced', { target, start: offset, removedCount: removed.length, inserted: structuredClone(inserted) })
        return removed
      },
      prepend: (target, message) => this.inbox.splice(target, 0, 0, [message]),
      append: (target, message) => this.inbox.splice(target, Infinity, 0, [message]),
      remove: id => {
        for (const target of ['next-turn', 'next-step']) {
          const i = queues[target].findIndex(m => m.id === id)
          if (i >= 0) { this.inbox.splice(target, i, 1, []); return true }
        }
        return false
      },
      clear: () => { for (const target of ['next-step', 'next-turn']) this.inbox.splice(target, 0, queues[target].length, []) },
      claim: target => {
        const items = this.inbox.splice('next-step', 0, queues['next-step'].length, [])
        if (target === 'next-turn') items.push(...this.inbox.splice('next-turn', 0, 1, []))
        return items
      },
    }
  }
  get status() { return this.phase === 'running' ? 'running' : 'idle' }
  append(type, data = {}) {
    const events = this.session.events
    const event = { seq: (events.at(-1)?.seq ?? -1) + 1, type, data: structuredClone(data) }
    events.push(event)
    return event
  }
  setRunning() {
    if (this.phase !== 'idle') throw new Error('already active')
    this.phase = 'running'; this.done = deferred(); this.activity = this.done.promise
    this.append('turn/start', { turn: ++this.turn })
  }
  async finishTurn(kind = 'completed') {
    this.append('turn/end', { turn: this.turn, reason: { kind } })
    this.phase = 'idle'; this.done?.resolve()
  }
  followup(message) { this.inbox.append('next-turn', message); this.wake() }
  steer(message) { this.inbox.append('next-step', message); this.wake() }
  inject(message) { this.inbox.append('next-step', message) }
  wake() {
    if (this.phase === 'maintenance') { this.wakeRequested = true; return }
    if (this.phase !== 'idle' || !this.autoRun) return
    this.setRunning()
    this.driver = (async () => {
      // DSH claims before agent/pre-step; a rejecting plugin must preserve these messages.
      const messages = this.inbox.claim('next-turn')
      this.claimed = messages
      const decision = await this.preStep({ agent: this, turn: this.turn, step: 1, messages })
      if (decision?.kind === 'reject') { await this.finishTurn('blocked'); return }
      for (const message of messages) this.append('user/message', message)
      this.modelStarts++
    })()
    this.driver.catch(error => { this.driverError = error; this.done?.reject(error) })
  }
  runMaintenance(job) {
    if (this.phase !== 'idle') throw new Error(`agent "${this.id}" already has active work`)
    this.phase = 'maintenance'; this.maintenance = new AbortController()
    const done = deferred(); this.activity = done.promise
    return (async () => {
      try { return await job(this.maintenance.signal) }
      finally {
        this.phase = 'idle'
        if (this.wakeRequested && this.inbox.hasPending && this.maintenance.signal.reason?.kind !== 'disposed') {
          this.wakeRequested = false; this.wake()
        }
        done.resolve()
      }
    })()
  }
  async whenIdle() { let activity; do { await (activity = this.activity) } while (activity !== this.activity) }
}
export function userMessage(requestId, text = 'task') {
  return { id: 'message-' + randomUUID(), role: 'user', content: [{ type: 'text', text }], source: { kind: 'user', rpcId: requestId } }
}
export class ControllerFixture {
  constructor(agents) {
    this.agents = agents
    this.calls = { create: [], prompt: [], selectModel: [], rename: [], cancel: [] }
    this.created = new Set()
    this.deliveries = []
    this.createModes = []; this.promptModes = []
    this.onCreate = null; this.onSelect = null; this.onRename = null; this.onPrompt = null
    this.preStep = async () => ({ kind: 'enter' })
  }
  async create(request) {
    this.calls.create.push(structuredClone(request))
    if (!request.sessionId) throw new Error('fixture requires an explicit id')
    const mode = this.createModes.shift()
    if (mode === 'throw') throw new Error('create-before-effect')
    if (!this.agents.has(request.sessionId)) {
      this.agents.set(request.sessionId, new AgentFixture(request.sessionId, { preStep: p => this.preStep(p) }))
      this.created.add(request.sessionId)
    }
    await this.onCreate?.(request)
    if (mode === 'lost') throw new Error('create-response-lost')
    return { sessionId: mode === 'mismatch' ? 'session-wrong' : request.sessionId }
  }
  async inspect(sessionId, signal) {
    signal?.throwIfAborted()
    const agent = this.agents.get(sessionId)
    if (!agent) throw new Error('session-inspection-not-found')
    return { meta: { ...agent.session.header }, inheritedEventCount: 0, events: structuredClone(agent.session.events) }
  }
  async selectModel(request) { this.calls.selectModel.push(structuredClone(request)); await this.onSelect?.(request); return { selected: { ...request } } }
  async rename(request) { this.calls.rename.push(structuredClone(request)); await this.onRename?.(request); return { title: request.title } }
  hasRequest(agent, requestId) {
    return agent.session.events.some(e => e.type === 'user/message' && e.data?.source?.rpcId === requestId)
      || [...agent.inbox.nextTurn, ...agent.inbox.nextStep].some(m => m.source?.rpcId === requestId)
  }
  async prompt(request, signal) {
    signal.throwIfAborted() // Public SessionController contract, not its private command delegate.
    this.calls.prompt.push(structuredClone(request))
    const agent = this.agents.get(request.sessionId)
    if (!agent) throw Object.assign(new Error('not-found'), { code: 'session/not-found' })
    // Match real DSH: dedup happens BEFORE asynchronous text/attachment admission.
    if (this.hasRequest(agent, request.requestId)) return { accepted: true }
    const mode = this.promptModes.shift()
    await this.onPrompt?.(request)
    if (mode === 'busy') throw Object.assign(new Error('prompt rejected'), { code: 'session/agent-busy' })
    if (mode === 'throw') throw new Error('unknown-submit-error')
    if (mode === 'reject') return { accepted: false }
    if (mode === 'malformed') return undefined
    if (mode?.before) await mode.before.promise
    if (this.agents.get(request.sessionId) !== agent) throw Object.assign(new Error('disposed during admission'), { code: 'session/not-found' })
    const message = userMessage(request.requestId, request.content[0].text)
    this.deliveries.push(structuredClone(request))
    if (request.mode === 'steer') agent.steer(message); else agent.followup(message)
    if (mode === 'lost') throw new Error('prompt-response-lost')
    if (mode?.after) await mode.after.promise
    return { accepted: true }
  }
  cancel(request) {
    this.calls.cancel.push(structuredClone(request))
    // Controller cancel preserves queues. The production continuation must NOT call this.
    return { accepted: true }
  }
}

export function toolResult(callId, isError = false) {
  return { id: 'result-' + callId, role: 'user', source: { kind: 'tool', callId },
    content: [{ type: 'tool-result', toolCallId: callId, isError, content: [{ type: 'text', text: 'written' }] }] }
}

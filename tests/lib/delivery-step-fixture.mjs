import assert from 'node:assert/strict'
import { isDeepStrictEqual } from 'node:util'
import * as fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

export const markers = {
  full: 'fixture-history-full-body',
  card: 'fixture-full-card',
  event: 'fixture-human-slim-event',
  slim: 'fixture-slim-snapshot',
}
const dynamicName = 'dsh:auto-memory-pre'
const noop = () => {}

export function message(kind = 'user', text = 'synthetic input') {
  return { role: 'user', source: { kind }, content: [{ type: 'text', text }] }
}

export function kindOf(text) {
  if (text.includes(markers.slim)) return text.includes(markers.event) ? 'human-slim' : 'run-slim'
  if (text.includes(markers.full) || text.includes(markers.card)) return 'full'
  if (text.includes('<memory_system>') && text.includes('memory_recall')) return 'reminder'
  return text ? 'unrecognized' : 'absent'
}

// Load the entire plugin and call public apply(). The existing audit loader only exposes the
// constructor so the fixture can supply deterministic memory data and silence unrelated I/O.
// In particular, no tier decision, pre-step callback, or renderer is extracted or reimplemented.
export async function startDeliveryHost() {
  const base = await fs.realpath(os.tmpdir())
  const root = await fs.mkdtemp(path.join(base, 'dam-delivery-step-'))
  const oldCwd = process.cwd()
  const home = path.join(root, 'home')
  await fs.mkdir(home)
  const env = { DSH_HOME: home, HOME: home, USERPROFILE: home, APPDATA: home, LOCALAPPDATA: home,
    TEMP: root, TMP: root, TMPDIR: root }
  const original = Object.fromEntries(Object.keys(env).map(k => [k, process.env[k]]))
  Object.assign(process.env, env)
  process.chdir(root)
  const cleanup = []
  let flush = async () => {}
  const m6ByAgent = new WeakMap()
  let restoreActivationHost = () => {}
  const close = async () => {
    restoreActivationHost()
    try {
      for (const dispose of cleanup.reverse()) await dispose()
      await flush()
    } finally {
      process.chdir(oldCwd)
      try {
        const owned = await fs.realpath(root)
        assert.equal(path.dirname(owned), base)
        assert(path.basename(owned).startsWith('dam-delivery-step-'))
        await fs.rm(owned, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
      } finally {
        for (const [key, previous] of Object.entries(original)) {
          if (previous === undefined) delete process.env[key]
          else process.env[key] = previous
        }
      }
    }
  }
  try {
    const { apply, MemoryEngine, flushDiagnostics } = await import('./audit-engine.mjs')
    flush = flushDiagnostics
    const contexts = new Map(), hooks = new Map(), registeredTools = []
    const defaults = { memoryRoot: path.join(home, 'memory'), userMemoryDir: path.join(home, 'user'),
      externalSources: {}, handoffEnabled: false, tier0CatalogEnabled: false, globalBriefEnabled: false,
      teamEnabled: false, autoConsolidate: false, activationInboxEnabled: false,
      contextBridgeEnabled: false, pythonBackendEnabled: false, rulesLayeringMode: 'off' }
    await fs.writeFile(path.join(home, 'dsh-auto-memory.json'), JSON.stringify(defaults))
    let engine
    const load = MemoryEngine.prototype.loadConfigSync
    const interval = globalThis.setInterval, timeout = globalThis.setTimeout
    try {
      MemoryEngine.prototype.loadConfigSync = function () { engine = this; return load.call(this) }
      // Registration is synchronous. Do not start unrelated periodic workers in the fixture.
      globalThis.setTimeout = globalThis.setInterval = () => ({ unref: noop })
      apply({ get: noop, on: (name, fn) => { hooks.set(name, fn); return noop },
        effect: setup => {
          const dispose = setup()
          if (typeof dispose === 'function') cleanup.push(dispose)
          return noop
        },
        systemPrompt: { context: def => { contexts.set(def.name, def); return noop }, section: () => noop },
        tools: { register: definition => { registeredTools.push(definition); return noop } },
        webServer: { register: () => noop } }, {})
    } finally {
      MemoryEngine.prototype.loadConfigSync = load
      globalThis.setTimeout = timeout; globalThis.setInterval = interval
    }
    assert(engine && contexts.has(dynamicName) && contexts.has('dsh:m6-reference-tail-pre') && hooks.has('agent/pre-step'))
    // Keep the real registered M6 context renderer, while allowing one request-local deterministic
    // tail to appear between the pre-step proposal and the model-admitted refresh.
    if (engine._activationHost && typeof engine._activationHost.renderTailFor === 'function') {
      const host = engine._activationHost
      const originalRender = host.renderTailFor
      const wrappedRender = agent => m6ByAgent.get(agent) || originalRender.call(host, agent)
      host.renderTailFor = wrappedRender
      restoreActivationHost = () => { if (host.renderTailFor === wrappedRender) host.renderTailFor = originalRender }
    }
    // The old developer probe appends to an absolute real checkout path. Disable it before any hook.
    engine._hubProbe = false
    engine._hubMsgReject = false
    engine.memToday = () => '2026-11-24'
    engine.checkWaterLevelAtStep = noop
    engine.refresh = async () => {}
    const baseConfig = { ...engine.config, ...defaults, fullInjectWaterPct: 'off',
      snapshotMinGapRounds: 40, slimEveryRounds: 15, snapshotTieredInject: true, runTierInjectEnabled: false,
      promptLayerOverrides: { snapshotSlimNote: markers.slim } }
    let n = 0
    function session(overrides = {}) {
      engine.config = { ...baseConfig, ...overrides }
      const events = [], id = 'fixture-session-' + ++n
      const workspace = path.join(root, 'workspace-' + n)
      const agent = { id, session: { id, header: { id, cwd: workspace }, snapshotEvents: () => events.slice() } }
      const state = engine.stateFor(agent)
      Object.assign(state, { ws: workspace, loadedAt: Date.now(), userText: markers.full,
        eventCardsText: markers.card, slimEventT1: [{ line: markers.event }], slimEventTotal: 1 })
      const emit = (type, data) => events.push({ seq: events.length + 1, type, time: Date.now(), data })
      const toolDefinitions = new Map(registeredTools.map(definition => [definition.name, definition]))
      // Exact resolved ToolSet contract from dsh-tools@0.2.2-rc.5: disposable step selection
      // exposing view(scope) => Map<name, definition>. Passed only to the initial assemble;
      // DSH refreshContext deliberately resolves the admitted contexts without a toolSet arg.
      const resolveToolSet = () => {
        let open = true
        return Object.freeze({
          view: scope => new Map(open && scope === agent ? toolDefinitions : []),
          dispose: () => { open = false },
        })
      }
      const assemble = context => [...contexts.values()].sort((a, b) => a.order - b.order)
        .map(def => ({ name: def.name, text: def.text(context) })).filter(section => section.text)
      const mainText = sections => sections.find(s => s.name === dynamicName)?.text || ''
      let turn = 0, step = 0, retained = []
      const proposal = sections => isDeepStrictEqual(retained, sections) ? undefined : {
        role: 'user', source: { kind: 'runtime-context', form: 'snapshot', sections },
        content: [{ type: 'text', text: sections.map(s => s.text).join('\n\n') }],
      }
      async function request(messages = [], options = {}) {
        if (!turn || options.newTurn) {
          if (turn) emit('turn/end', { turn, reason: { kind: 'completed' } })
          turn++; step = 0; emit('turn/start', { turn })
        }
        step++
        if (options.compact) emit('compaction/summary', { turn })
        if ('water' in options) state.waterLevelRatio = options.water
        // Agent-loop proposes the first snapshot, then runs pre-step on the claimed inbox.
        // Only the projection after step/start is committed, and only when its named sections change.
        const toolSet = resolveToolSet()
        const context = { agent, scope: agent, signal: new AbortController().signal,
          modelSelection: { provider: 'synthetic', model: 'fixture' } }
        if (options.m6AtProposal) m6ByAgent.set(agent, options.m6AtProposal)
        const draftSections = assemble({ ...context, toolSet })
        const draftText = mainText(draftSections)
        const draft = proposal(draftSections)
        const decision = await hooks.get('agent/pre-step')({ agent, turn, step, messages,
          signal: context.signal, modelSelection: context.modelSelection }, async () => ({
          kind: 'enter', messages: draft ? [...messages, draft] : messages,
        }))
        assert.equal(decision.kind, 'enter')
        if (options.compactDuringPreStep) emit('compaction/summary', { turn })
        emit('step/start', { turn, step })
        options.beforeRefresh?.()
        if (options.m6DuringPreStep) m6ByAgent.set(agent, options.m6DuringPreStep)
        if (options.notificationDuringPreStep) state.pendingReflection = options.notificationDuringPreStep
        const final = assemble(context)
        if (options.repeat) assert.deepEqual(assemble(context), final, 'a repeated render of the same request must be byte-identical')
        const snapshot = proposal(final)
        let admitted = false
        for (const msg of decision.messages) {
          if (msg.source?.kind !== 'runtime-context') emit('user/message', msg)
          else if (snapshot && !admitted) { emit('user/message', snapshot); admitted = true }
        }
        if (snapshot && !admitted) emit('user/message', snapshot)
        if (snapshot) retained = snapshot.source.sections
        if (options.toolStep) {
          const id = 'fixture-read-' + turn + '-' + step
          const call = { type: 'tool-call', id, name: 'read', arguments: {} }
          emit('assistant/message', { turn, step, message: { role: 'assistant', source: { kind: 'model' }, content: [call] } })
          emit('tool/call', { turn, step, callId: id, name: 'read', arguments: {} })
          emit('tool/result', { turn, step, message: { role: 'user', source: { kind: 'tool', callId: id },
            content: [{ type: 'tool-result', toolCallId: id, content: [{ type: 'text', text: 'fixture result' }] }] } })
        }
        emit('step/end', { turn, step })
        toolSet.dispose()
        m6ByAgent.delete(agent)
        const text = mainText(retained)
        const firstPostText = mainText(final)
        const m6Text = retained.find(s => s.name === 'dsh:m6-reference-tail-pre')?.text || ''
        return { kind: kindOf(text), text, draftText, draftSections, firstPostText, sections: retained,
          m6Text, changed: Boolean(snapshot) }
      }
      return { request, emit, state }
    }
    return { session, close }
  } catch (error) { await close(); throw error }
}

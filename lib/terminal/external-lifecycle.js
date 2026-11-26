import { ContractError, object, oneOfValues, text } from './contract.js'
import { CLOUD_CODE_HOOK_EVENTS, KIMI_HOOK_EVENTS } from '../harness/kimi.js'
import { ANTIGRAVITY_HOOK_EVENTS } from '../harness/antigravity.js'
import { getExternalHostEvents } from '../harness/external-hosts.js'

const hostEvents = {
  codex: new Set(['SessionStart', 'UserPromptSubmit', 'Stop', 'SessionEnd', 'PreCompact', 'PostCompact']),
  zcode: new Set(['SessionStart', 'UserPromptSubmit', 'Stop']),
  claude: new Set(['SessionStart', 'UserPromptSubmit', 'Stop', 'SessionEnd', 'PreCompact']),
  kimi: new Set(KIMI_HOOK_EVENTS),
  'cloud-code': new Set(CLOUD_CODE_HOOK_EVENTS),
  antigravity: new Set(ANTIGRAVITY_HOOK_EVENTS),
  opencode: new Set(getExternalHostEvents('opencode')),
}
const supportedEvents = [...new Set(Object.values(hostEvents).flatMap(events => [...events]))]
const id = { ...text, maxLength: 200, pattern: '^[a-zA-Z0-9_.:-]+$' }
const statuses = ['accepted', 'duplicate', 'out-of-order', 'unavailable']
const idleMs = 12 * 60 * 60 * 1000
const capacity = 1024

export const externalEventSchema = object({
  harness: oneOfValues(...Object.keys(hostEvents)), name: oneOfValues(...supportedEvents),
  sessionId: id, turnId: id,
  source: oneOfValues('startup', 'resume', 'clear', 'compact', 'fork'),
  trigger: oneOfValues('manual', 'auto'),
}, ['harness', 'name', 'sessionId'])

export const externalReceiptSchema = object({ status: oneOfValues(...statuses), context: text }, ['status'])

export function createExternalLifecycle() {
  const sessions = new Map()
  return async function observe(event, binding, context) {
    if (!hostEvents[event.harness].has(event.name)) throw new ContractError('event-unsupported', 'This host does not provide this lifecycle event')
    const key = event.harness + ':' + event.sessionId
    const now = Date.now()
    let state = sessions.get(key)
    if (state && now - state.touched > idleMs) {
      sessions.delete(key)
      state = undefined
    }
    if (state && (state.sessionId !== binding.sessionId || state.workspace !== binding.workspace)) {
      throw new ContractError('external-binding-changed', 'This external session was bound to a different DSH session or workspace', 409)
    }
    const starting = event.name === 'SessionStart'
    if (!state) {
      if (!starting) return { status: 'out-of-order' }
      if (sessions.size >= capacity) {
        for (const [priorKey, prior] of sessions) {
          if (now - prior.touched > idleMs) sessions.delete(priorKey)
        }
        if (sessions.size >= capacity) return { status: 'unavailable' }
      }
      state = { ...binding, touched: now, injected: false, compacting: false, turnIds: new Set(), openTurn: false }
      sessions.set(key, state)
    } else if (starting) {
      const zcodeCompaction = event.harness === 'zcode' && event.source === 'compact' &&
        event.turnId && event.turnId !== state.compactionTurn
      if (event.source === 'resume' && state.ended) {
        state.ended = false
        state.injected = false
        state.openTurn = false
        state.currentTurn = undefined
      } else if (event.source === 'compact' && (state.compacting || zcodeCompaction)) {
        state.compacting = false
        state.compactionTurn = event.turnId
        state.injected = false
      } else return { status: 'duplicate' }
    } else if (state.ended) return { status: 'out-of-order' }

    state.touched = now
    if (event.name === 'PreCompact') {
      if (state.compacting) return { status: 'duplicate' }
      state.compacting = true
      return { status: 'accepted' }
    }
    if (event.name === 'PostCompact') {
      if (!state.compacting) return { status: 'out-of-order' }
      state.compacting = false
      state.injected = false
      return { status: 'accepted' }
    }
    if (event.name === 'SessionEnd') {
      state.ended = true
      state.openTurn = false
      state.currentTurn = undefined
      return { status: 'accepted' }
    }
    if (event.name === 'Stop') {
      if (!state.openTurn) return { status: 'duplicate' }
      if (event.turnId && state.currentTurn && event.turnId !== state.currentTurn) return { status: 'out-of-order' }
      state.openTurn = false
      return { status: 'accepted' }
    }
    if (event.name === 'UserPromptSubmit') {
      if (event.turnId ? state.turnIds.has(event.turnId) : state.openTurn) return { status: 'duplicate' }
      if (event.turnId) {
        state.turnIds.add(event.turnId)
        if (state.turnIds.size > 512) state.turnIds.delete(state.turnIds.values().next().value)
      }
      state.currentTurn = event.turnId
      state.openTurn = true
    }
    if (event.harness === 'opencode') {
      if (event.name !== 'PreInvocation') return { status: 'accepted' }
      try {
        const selected = await context()
        return { status: 'accepted', ...(selected ? { context: selected } : {}) }
      } catch {
        return { status: 'unavailable' }
      }
    }
    if (event.name === 'PreInvocation') state.openTurn = true
    if (state.injected || (starting && ['kimi', 'cloud-code'].includes(event.harness))) return { status: 'accepted' }
    // Claim the current activation before reading. Two hook processes can arrive together.
    state.injected = true
    try {
      const selected = await context()
      if (!selected) state.injected = false
      return { status: 'accepted', ...(selected ? { context: selected } : {}) }
    } catch {
      state.injected = false
      return { status: 'unavailable' }
    }
  }
}

import path from 'node:path'
import { mkdirSync } from 'node:fs'
import { eventStorePre } from '../event-store.js'
import { fileWithinRoots } from '../file-boundary.js'
import { computeOperationDigest, computeLegacyCheckpointKey, validateOpId } from './protocol.js'

const PHASES = ['prepared', 'committed', 'failed']
const fail = (error, extra = {}) => ({ ok: false, error, ...extra })
const clone = (value) => JSON.parse(JSON.stringify(value))
const message = (error) => error instanceof Error ? error.message : String(error)

/** Real eventStorePre adapter. All writes are confined to workspace artifacts. */
export class EventStoreLedgerSink {
  constructor(workspaceRoot, storePath) {
    this.workspaceRoot = path.resolve(workspaceRoot || process.cwd())
    const artifacts = path.resolve(process.cwd(),'artifacts')
    mkdirSync(artifacts,{recursive:true})
    if (typeof storePath !== 'string' || !path.isAbsolute(storePath)) throw new TypeError('event-store-sink-path-invalid')
    const parent = path.dirname(path.resolve(storePath))
    const physicalParent = fileWithinRoots(parent,[artifacts],{strict:true,allowMissing:true})
    if (!physicalParent) throw new TypeError('event-store-sink-path-invalid')
    mkdirSync(physicalParent,{recursive:true})
    const physical = fileWithinRoots(path.resolve(storePath), [artifacts], { strict: true, allowMissing: true })
    if (!physical) throw new TypeError('event-store-sink-path-invalid')
    this.storePath = physical
    this.artifactsRoot = artifacts
  }
  async _event(eventId) {
    const detail = await eventStorePre.detail(this.storePath, eventId)
    if (!detail.ok || !detail.event) throw Object.assign(new Error('event-id-unavailable: ' + eventId), { code: 'EVENT_ID_UNAVAILABLE' })
    return detail.event
  }
  async append(eventId, { phase, opId, operationDigest, checkpoint } = {}) {
    if (!PHASES.includes(phase) || !validateOpId(opId).ok) return fail('op-id-invalid')
    if (typeof operationDigest !== 'string' || !operationDigest.startsWith('sha256:')) return fail('operation-digest-invalid')
    if (!checkpoint || typeof checkpoint !== 'object') return fail('checkpoint-invalid')
    try {
      const event = await this._event(eventId)
      const payload = clone(checkpoint)
      payload.kind = 'wal-' + phase
      payload.opId = opId
      payload.phase = phase
      payload.operationDigest = operationDigest
      // Stable business idemKey protects exact retry when the operation ledger was evicted.
      payload.idemKey = computeOperationDigest({ schema: 'r4-ledger-stage-v1', opId, phase, checkpoint: payload })
      const storageOpId = opId + ':' + phase
      const result = await eventStorePre.append(this.storePath, eventId, { checkpoint: payload, opId: storageOpId })
      if (!result.ok) return result
      const actual = (await this._event(eventId)).checkpoints.filter((item) => item.opId === opId && item.phase === phase)
      const found = actual.find((item) => item.idemKey === payload.idemKey)
      if (!found) return fail('checkpoint-persistence-failed', { eventId, phase })
      return { ...result, eventId, phase, checkpointId: found.checkpointId || null, checkpoint: clone(found) }
    } catch (error) {
      return fail(error.code === 'op-payload-mismatch' || error.code === 'op-payload-unverifiable' ? error.code : 'event-append-failed', { cause: message(error), eventId, phase })
    }
  }
  async listCheckpoints(eventIdOrOpId) {
    const events = validateOpId(eventIdOrOpId).ok
      ? (await import('../event-store.js').then((module) => module.readStorePre(this.storePath))).events
      : [await this._event(eventIdOrOpId)]
    return events.flatMap((event) => event.checkpoints.filter((item) => item.opId && PHASES.includes(item.phase) && (validateOpId(eventIdOrOpId).ok ? item.opId === eventIdOrOpId : true)).map((item) => ({
      ...clone(item), eventId: event.id, checkpointId: item.checkpointId || null,
      operationDigest: item.operationDigest || null,
      legacyCheckpointKey: item.checkpointId ? null : computeLegacyCheckpointKey({ ...item, eventId: event.id }),
      identityMode: item.checkpointId ? 'persisted' : 'legacy-derived',
    })))
  }
  async operations() {
    const state = await import('../event-store.js').then((module) => module.readStorePre(this.storePath))
    const groups = new Map()
    for (const event of state.events) for (const item of event.checkpoints) {
      if (!item.opId || !PHASES.includes(item.phase)) continue
      if (!groups.has(item.opId)) groups.set(item.opId, [])
      groups.get(item.opId).push(clone(item))
    }
    return [...groups].map(([opId, checkpoints]) => ({ opId, checkpoints }))
  }
}

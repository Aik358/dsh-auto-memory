import path from 'node:path'
import { AsyncLocalStorage } from 'node:async_hooks'
import { withSharedStateLock } from '../shared-state-lock.js'
import { LedgerDocumentStore } from './document-store.js'

const failure = (error, extra = {}) => ({ ok: false, error, ...extra })
const causeOf = (error) => error instanceof Error ? error.message : String(error)

/**
 * Opt-in isolation wrapper. Constructing it enables locking; no production
 * registry, writer, or default LedgerDocumentStore behavior is changed.
 */
export class LockedLedgerDocumentStore {
  constructor(store, options = {}) {
    if (!store || typeof store._pathFor !== 'function' || typeof store.readDocument !== 'function' || typeof store.updateDocument !== 'function') {
      throw new TypeError('locked-store-requires-ledger-store')
    }
    if (options.withLock !== undefined && typeof options.withLock !== 'function') throw new TypeError('lock-adapter-invalid')
    this.store = store
    this.lockTimeoutMs = options.lockTimeoutMs ?? 10000
    this.withLock = options.withLock || withSharedStateLock
    this.lockContext = new AsyncLocalStorage()
    this.lockSequence = []
  }

  _path(documentId) {
    const target = this.store._pathFor(documentId)
    if (!target.ok) return target
    return { ok: true, filePath: target.filePath }
  }

  async _exclusive(resource, filePath, job, options = {}) {
    const held = this.lockContext.getStore() || []
    if (held.length > 0) return failure('lock-nesting-forbidden', { held, requested: resource })
    return this.lockContext.run([resource], async () => {
      let acquired = false
      try {
        return await this.withLock(filePath, async () => {
          acquired = true
          this.lockSequence.push({ resource, filePath, state: 'acquired' })
          try { return await job() } finally {
            this.lockSequence.push({ resource, filePath, state: 'released' })
          }
        }, { timeoutMs: options.timeoutMs ?? this.lockTimeoutMs })
      } catch (error) {
        if (acquired) throw error
        // No job runs unless acquisition succeeded. Preserve the original cause.
        return failure('lock-unavailable', { cause: causeOf(error), resource })
      } finally {
        this.lockSequence.push({ resource, filePath, state: 'unlocked' })
      }
    })
  }

  /** MemoryDocumentStore compatibility: pass filePath+'.lock'; the shared lock adds the final '.lock'. */
  async withDocumentLock(documentId, job, options = {}) {
    const target = this._path(documentId)
    if (!target.ok) return target
    return this._exclusive('document', target.filePath + '.lock', job, options)
  }

  async withIndexLock(indexPath, job, options = {}) {
    if (typeof indexPath !== 'string' || !path.isAbsolute(indexPath)) return failure('index-path-invalid')
    return this._exclusive('index', indexPath, job, options)
  }

  async createDocument(input, options = {}) {
    return this.withDocumentLock(input?.documentId, () => this.store.createDocument(input), options)
  }

  async updateDocument(input, options = {}) {
    // The entire P1 read -> validate -> CAS -> atomic write -> readback is one job.
    return this.withDocumentLock(input?.documentId, () => this.store.updateDocument(input), options)
  }

  async readDocument(documentId, options = {}) {
    return this.withDocumentLock(documentId, () => this.store.readDocument(documentId), options)
  }

  async listDocuments() {
    return this.store.listDocuments()
  }

  /**
   * Isolated orchestration seam for the R4 order. Event callbacks own their
   * existing append lock; this wrapper never holds D while either E callback runs.
   * No real WAL/index writer is installed here.
   */
  async runOperation({ documentId, expectedRevision, changeSet, eventIds, prepareEvents, commitEvents, reindex }, options = {}) {
    const resources = {}
    const read = await this.withDocumentLock(documentId, () => this.store.readDocument(documentId), options)
    resources.documentRead = read.ok ? 'released' : 'failed'
    if (!read.ok) return failure(read.error, { stage: 'D-read', cause: read.cause, resources })
    if (read.revision !== expectedRevision) return failure('document-version-conflict', { stage: 'D-read', resources })

    let prepared
    try {
      prepared = typeof prepareEvents === 'function' ? await prepareEvents(read) : { ok: true, status: 'prepared' }
    } catch (error) {
      return failure('event-prepare-failed', { stage: 'E-prepared', cause: causeOf(error), resources })
    }
    if (prepared?.ok === false) return failure('event-prepare-failed', { stage: 'E-prepared', cause: prepared.error, resources })
    resources.events = 'prepared'

    const written = await this.withDocumentLock(documentId, () => this.store.updateDocument({
      documentId, expectedRevision, changeSet, eventIds: eventIds || read.eventIds,
    }), options)
    resources.document = written.ok ? 'winner' : 'unchanged'
    if (!written.ok) return failure(written.error, { stage: 'D-CAS/write', cause: written.cause, resources, prepared })

    let committed
    try {
      committed = typeof commitEvents === 'function' ? await commitEvents(prepared, written) : { ok: true, status: 'committed' }
    } catch (error) {
      return failure('event-commit-failed', { stage: 'E-committed', cause: causeOf(error), resources, prepared, document: written })
    }
    if (committed?.ok === false) return failure('event-commit-failed', { stage: 'E-committed', cause: committed.error, resources, prepared, document: written })
    resources.events = 'committed'

    if (typeof reindex === 'function') {
      const indexPath = path.resolve(options.indexPath || path.join(this.store.rootDir, 'index.json'))
      let indexed
      try { indexed = await this.withIndexLock(indexPath, () => reindex(written), options) } catch (error) {
        return failure('index-write-failed', { stage: 'I-reindex', cause: causeOf(error), indexStale: true, resources, document: written })
      }
      if (!indexed?.ok) return failure('index-write-failed', { stage: 'I-reindex', cause: indexed?.cause || indexed?.error, indexStale: true, resources, document: written })
      resources.index = 'current'
    }
    return { ok: true, document: written, prepared, committed, resources }
  }
}

import * as nodeFs from 'node:fs/promises'
import path from 'node:path'
import { LedgerDocumentStore } from './document-store.js'
import { LockedLedgerDocumentStore } from './locked-store.js'
import { HandoffMaterialStamp, MaterialInvalidationBus, publishCommittedDocument } from './material-stamp.js'
import { LedgerHistoryQuery } from './history-query.js'
import { LedgerCoverageAuditor } from './coverage-audit.js'
import { LedgerWal } from './wal.js'
import { LedgerDocReadSide } from './read-side.js'

function inside(root, candidate) {
  const relative = path.relative(root, candidate)
  return relative !== '' && relative !== '..' && !relative.startsWith('..' + path.sep) && !path.isAbsolute(relative)
}
const failure = (error, extra = {}) => ({ ok: false, error, ...extra })

export class LedgerDocSystem {
  constructor({
    rootDir, enabled = false, useLocks = true, stampEnabled,
    eventSink = null, timeZone = 'UTC', workspaceKey = 'isolated', readOnly = false,
    now = () => new Date().toISOString(), fs = nodeFs, invalidation = null,
  } = {}) {
    if (typeof rootDir !== 'string' || !path.isAbsolute(rootDir)) throw new TypeError('ledger-doc-root-invalid')
    if (typeof enabled !== 'boolean') throw new TypeError('ledger-doc-enabled-invalid')
    this.rootDir = path.resolve(rootDir)
    this.readOnly = readOnly === true
    const artifactsDir = path.resolve(process.cwd(), 'artifacts')
    if (!this.readOnly && !inside(artifactsDir, this.rootDir)) throw new TypeError('ledger-doc-root-invalid')
    this.enabled = enabled
    this.state = 'stopped'
    this.fs = fs
    this.now = now
    this.timeZone = timeZone
    this.workspaceKey = workspaceKey
    this.handoffDir = path.join(this.rootDir, 'handoff')
    this.documentsDir = path.join(this.handoffDir, 'documents')
    this.eventStorePath = path.join(this.handoffDir, 'event-store.json')
    this._baseDocuments = new LedgerDocumentStore(this.documentsDir, { eventsPath: this.eventStorePath, fs, now, readOnly: this.readOnly })
    this._documents = useLocks === true ? new LockedLedgerDocumentStore(this._baseDocuments) : this._baseDocuments
    this.invalidation = invalidation || new MaterialInvalidationBus()
    this._stamp = new HandoffMaterialStamp({
      handoffDir: this.handoffDir, eventsPath: this.eventStorePath,
      enabled: stampEnabled === undefined ? enabled : stampEnabled === true,
      fs, invalidation: this.invalidation, readOnly: this.readOnly,
    })
    this._history = new LedgerHistoryQuery({
      rootDir: this.rootDir, eventStorePath: this.eventStorePath,
      logsDir: path.join(this.rootDir, 'logs'), archiveDir: path.join(this.rootDir, 'archive'),
      timeZone, fs, readOnly: this.readOnly,
    })
    this._audit = this.readOnly ? null : new LedgerCoverageAuditor({
      sourceDir: path.join(this.rootDir, 'legacy'), eventStorePath: this.eventStorePath,
      reportDir: path.join(this.rootDir, 'coverage-reports'), workspaceKey, fs, now,
    })
    this._readSide = new LedgerDocReadSide({ handoffDir: this.handoffDir, eventsPath: this.eventStorePath, fs })
    this._wal = eventSink === null || this.readOnly ? null : new LedgerWal(this._documents, eventSink, { now })
    this._lastCommittedDocument = null
    this._pending = new Set()
    this._startPromise = null
  }

  get documents() { return this._documents }
  get stamp() { return this._stamp }
  get history() { return this._history }
  get audit() { return this._audit }
  get wal() { return this._wal }
  get readSide() { return this._readSide }
  get lastCommittedDocument() { return this._lastCommittedDocument }
  get started() { return this.state === 'started' }

  status() {
    return {
      ok: true, enabled: this.enabled, state: this.state, started: this.started,
      rootDir: this.rootDir,
      modules: {
        documents: this._documents.constructor.name, stamp: this._stamp.constructor.name,
        history: this._history.constructor.name, audit: this._audit ? this._audit.constructor.name : null,
        wal: this._wal ? this._wal.constructor.name : null,
      },
    }
  }

  _notificationOptions(opId) {
    return {
      refreshCache: async (document) => {
        const notification = publishCommittedDocument(this.invalidation, this.handoffDir, {
          ok: true, noop: false, documentId: document.documentId,
          revision: document.revision, opId,
        })
        const readback = await this._readSide.current({ documentId: document.documentId })
        if (readback.ok) this._lastCommittedDocument = readback.document
        return { ok: notification.listenerErrors.length === 0 && readback.ok, notification, readback }
      },
    }
  }

  async start() {
    if (this.started) return { ok: true, enabled: true, started: true, state: this.state, noop: true }
    if (this._startPromise) return this._startPromise
    if (!this.enabled) {
      this.state = 'disabled'
      return { ok: true, enabled: false, started: false, state: this.state, noop: true }
    }
    this._startPromise = (async () => {
      try {
        for (const directory of this.readOnly ? [] : [this.documentsDir, path.join(this.rootDir, 'logs'), path.join(this.rootDir, 'archive'), path.join(this.rootDir, 'legacy'), path.join(this.rootDir, 'coverage-reports')]) {
          await this.fs.mkdir(directory, { recursive: true })
        }
        const reconciliation = this._wal && !this.readOnly ? await this._wal.reconcile(this._notificationOptions(null)) : null
        const stamp = this._stamp.enabled && !this.readOnly ? await this._stamp.read() : null
        this.state = 'started'
        // A fully committed older revision is history, not a startup failure.
        // Preserve the raw attention result while rejecting unfinished recovery.
        const reconciled = !reconciliation || reconciliation.results.every((item) => item.ok || item.error === 'wal-committed-document-mismatch')
        const ok = reconciled && (!stamp || stamp.complete !== false)
        return {
          ok, enabled: true, started: this.started, state: this.state,
          complete: Boolean(reconciled && (!reconciliation || reconciliation.ok) && (!this._stamp.enabled || this.readOnly || stamp?.complete === true)),
          reconciliation, stamp,
          ...(ok ? {} : { error: 'ledger-doc-start-incomplete' }),
        }
      } catch (error) {
        this.state = 'stopped'
        return failure('ledger-doc-start-failed', { cause: error instanceof Error ? error.message : String(error), enabled: true, started: false })
      } finally {
        this._startPromise = null
      }
    })()
    return this._startPromise
  }

  async stop() {
    if (this._startPromise) await this._startPromise
    await Promise.all([...this._pending])
    this.state = 'stopped'
    return { ok: true, enabled: this.enabled, started: false, state: this.state, stopped: true }
  }

  _available() {
    if (!this.enabled) return failure('ledger-doc-system-disabled', { enabled: false })
    if (!this.started) return failure('ledger-doc-system-not-started', { enabled: true })
    return null
  }

  _track(action) {
    const promise = Promise.resolve().then(action)
    this._pending.add(promise)
    return promise.finally(() => this._pending.delete(promise))
  }

  async reconcile(options = {}) {
    const unavailable = this._available()
    if (unavailable) return unavailable
    if (!this._wal) return failure('wal-not-configured')
    return this._track(() => this._wal.reconcile({ ...options, ...this._notificationOptions(null) }))
  }

  async upsertDocument(args) {
    const unavailable = this._available()
    if (unavailable) return unavailable
    if (!this._wal) return failure('wal-not-configured')
    return this._track(() => this._wal.execute(args, this._notificationOptions(args?.opId ?? null)))
  }

  async queryHistory(args) {
    const unavailable = this._available()
    if (unavailable) return unavailable
    return this._track(() => this._history.query(args))
  }

  async readDocuments(args = {}) {
    const unavailable = this._available()
    if (unavailable) return unavailable
    return this._track(() => this._readSide.current(args))
  }

  async auditCoverage(args = {}) {
    const unavailable = this._available()
    if (unavailable) return unavailable
    if (!this._audit) return failure('audit-read-only')
    return this._track(() => this._audit.auditAll(args))
  }
}

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
    trustedMemoryRoot = null,
  } = {}) {
    if (typeof rootDir !== 'string' || !path.isAbsolute(rootDir)) throw new TypeError('ledger-doc-root-invalid')
    if (typeof enabled !== 'boolean') throw new TypeError('ledger-doc-enabled-invalid')
    this.rootDir = path.resolve(rootDir)
    this.readOnly = readOnly === true
    // ★R4 A1 修正（task-2，2026-11-12）：可写实例的**根包含校验**保留，但不再是「只认 cwd/artifacts」。
    //
    //   原阻塞：`readOnly:false` 硬要求 rootDir 落在 `process.cwd()/artifacts` 内 ⇒ 真实工作区
    //   （memoryRoot/<wsKey>）永远构造失败（ledger-doc-root-invalid），维护文档写入在真实宿主不可达。
    //   而 cwd 被指到 fixture 得到的「能构造」是伪证据，不能当真实形态。
    //
    //   修法：新增**显式受控授权通道** `trustedMemoryRoot`。
    //     · 缺省（不传）⇒ 行为与从前**逐字节相同**：仍只允许 artifacts 内，其余一律 ledger-doc-root-invalid；
    //     · 传入 ⇒ 必须是绝对路径，且 rootDir 必须**严格在其内**（inside 语义，不含自身）；
    //     · 传入但 rootDir 不在其内 ⇒ 仍 ledger-doc-root-invalid（不因为给了授权就放宽任意根）；
    //     · 该参数**只由 lib/index.js 的 ledgerDocWriteSystemForPre 传入**，取值是经 resolvePaths 得到的
    //       工作区 memoryRoot（见该函数内的额外一层「必须恰好一层子目录」校验），不对外暴露为通用开关。
    const artifactsDir = path.resolve(process.cwd(), 'artifacts')
    if (!this.readOnly) {
      const withinArtifacts = inside(artifactsDir, this.rootDir)
      let withinTrusted = false
      if (!withinArtifacts && typeof trustedMemoryRoot === 'string' && trustedMemoryRoot) {
        if (!path.isAbsolute(trustedMemoryRoot)) throw new TypeError('ledger-doc-root-invalid')
        withinTrusted = inside(path.resolve(trustedMemoryRoot), this.rootDir)
      }
      if (!withinArtifacts && !withinTrusted) throw new TypeError('ledger-doc-root-invalid')
      this.trustedMemoryRoot = withinTrusted ? path.resolve(trustedMemoryRoot) : null
    } else {
      this.trustedMemoryRoot = null
    }
    this.enabled = enabled
    this.state = 'stopped'
    this.fs = fs
    this.now = now
    this.timeZone = timeZone
    this.workspaceKey = workspaceKey
    this.handoffDir = path.join(this.rootDir, 'handoff')
    this.documentsDir = path.join(this.handoffDir, 'documents')
    this.eventStorePath = path.join(this.handoffDir, 'event-store.json')
    this._baseDocuments = new LedgerDocumentStore(this.documentsDir, { eventsPath: this.eventStorePath, fs, now, readOnly: this.readOnly, trustedMemoryRoot: this.trustedMemoryRoot })
    this._documents = useLocks === true ? new LockedLedgerDocumentStore(this._baseDocuments) : this._baseDocuments
    this.invalidation = invalidation || new MaterialInvalidationBus()
    this._stamp = new HandoffMaterialStamp({
      handoffDir: this.handoffDir, eventsPath: this.eventStorePath,
      enabled: stampEnabled === undefined ? enabled : stampEnabled === true,
      fs, invalidation: this.invalidation, readOnly: this.readOnly, trustedMemoryRoot: this.trustedMemoryRoot,
    })
    this._history = new LedgerHistoryQuery({
      rootDir: this.rootDir, eventStorePath: this.eventStorePath,
      logsDir: path.join(this.rootDir, 'logs'), archiveDir: path.join(this.rootDir, 'archive'),
      timeZone, fs, readOnly: this.readOnly, trustedMemoryRoot: this.trustedMemoryRoot,
    })
    this._audit = this.readOnly ? null : new LedgerCoverageAuditor({
      sourceDir: path.join(this.rootDir, 'legacy'), eventStorePath: this.eventStorePath,
      reportDir: path.join(this.rootDir, 'coverage-reports'), workspaceKey, fs, now, trustedMemoryRoot: this.trustedMemoryRoot,
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

  /**
   * ★R4 A1-c（task-2）：**显式首建**维护文档 —— create-only，不猜「最近事件」。
   *   · eventIds 必须由调用方**显式给出**，且必须是事件库里真实存在、状态 active/paused 的事件
   *     （由 LedgerDocumentStore._eventIds 逐个校验，未知 id ⇒ event-id-unavailable，不会回落到任何默认）。
   *   · 已存在同名文档 ⇒ document-already-exists（**绝不覆盖**）；不存在才写。
   *   · 首建**不走 WAL**：WAL 的 prepared/committed 契约要求「既有文档 + baseRevision」，
   *     首建没有 baseRevision 可对。首建的原子性由 LedgerDocumentStore._writeCandidate(createOnly:true)
   *     保证（临时文件 + rename），失败不产生半份文件。这是与「更新走 WAL」并列的第二条写路径，
   *     本函数在返回值里用 via:'create' 明示，调用方不得把它当成 WAL 提交。
   */
  async createDocument(args) {
    const unavailable = this._available()
    if (unavailable) return unavailable
    if (this.readOnly) return failure('document-read-only')
    return this._track(() => this._baseDocuments.createDocument(args))
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

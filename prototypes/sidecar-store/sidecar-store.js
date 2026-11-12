import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { IndexState, normalizeChanges, validateLegacySnapshot } from './index-state.js'
import { JournalStorage } from './journal-storage.js'
import { IndexStorageError, sha256, storageFailure } from './codec.js'

const DEFAULT_PARSER_VERSION = 'wb-parser-v1'
const fail = (code, message) => { throw new IndexStorageError(code, message) }
const canonical = value => JSON.stringify(value, function (key, item) {
  if (item && typeof item === 'object' && !Array.isArray(item)) {
    return Object.fromEntries(Object.keys(item).sort().map(name => [name, item[name]]))
  }
  return item
})
const requestHash = value => sha256(canonical(value))

function mutationOptions(options, defaultParserVersion) {
  if (!options || typeof options !== 'object' || Array.isArray(options) || ![Object.prototype, null].includes(Object.getPrototypeOf(options))) fail('INDEX_INVALID_ARGUMENT', 'options must be a plain object')
  const detached = {}
  for (const key of Reflect.ownKeys(options)) {
    const descriptor = Object.getOwnPropertyDescriptor(options, key)
    if (typeof key !== 'string' || !descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) fail('INDEX_INVALID_ARGUMENT', 'options must contain plain data properties')
  }
  detached.parserVersion = options.parserVersion ?? defaultParserVersion
  if (typeof detached.parserVersion !== 'string' || !detached.parserVersion) fail('INDEX_INVALID_ARGUMENT', 'parserVersion must be a nonempty string')
  if (options.operationId !== undefined) detached.operationId = options.operationId
  if (options.expectedState !== undefined) {
    const token = options.expectedState
    if (!token || typeof token.generation !== 'string' || !token.generation || !Number.isSafeInteger(token.seq) || token.seq < 0) fail('INDEX_INVALID_ARGUMENT', 'expectedState requires a generation and nonnegative sequence')
    detached.expectedState = { generation: token.generation, seq: token.seq }
  }
  return detached
}

function legacySnapshot(snapshot, workspaceKey) {
  const validated = validateLegacySnapshot(snapshot, workspaceKey)
  if (validated.version !== 'wb_sidecar_pre_v1') fail('INDEX_UNSUPPORTED_SCHEMA', 'Unsupported legacy sidecar version: ' + validated.version)
  return validated
}

/**
 * Public boundary for a derived whiteboard index. No caller handles disk format,
 * inverted maps, locks or generation publication. Markdown remains the source.
 * All writes require an explicit separate directory; there is no memory-root default.
 */
export class SidecarStore {
  #storage
  #workspaceKey
  #parserVersion
  #historyLimit
  #state = null
  #recent = new Map()
  #imported = false
  #tail = Promise.resolve()
  #closing = false
  #closePromise = null

  static async open(options = {}) {
    const { directory, workspaceKey, parserVersion = DEFAULT_PARSER_VERSION, operationHistoryLimit = 256 } = options
    if (typeof directory !== 'string' || !path.isAbsolute(directory)) fail('INDEX_INVALID_ARGUMENT', 'directory must be an explicit absolute path')
    if (typeof workspaceKey !== 'string' || !workspaceKey.trim()) fail('INDEX_INVALID_ARGUMENT', 'workspaceKey is required')
    if (typeof parserVersion !== 'string' || !parserVersion) fail('INDEX_INVALID_ARGUMENT', 'parserVersion must be a nonempty string')
    if (!Number.isSafeInteger(operationHistoryLimit) || operationHistoryLimit < 1) fail('INDEX_INVALID_ARGUMENT', 'operationHistoryLimit must be a positive integer')
    const storage = await JournalStorage.open(options).catch(storageFailure)
    const store = new SidecarStore(storage, { workspaceKey, parserVersion, operationHistoryLimit })
    try { await store.#run(() => {}); return store } catch (error) { await storage.close(); throw error }
  }

  constructor(storage, { workspaceKey, parserVersion, operationHistoryLimit }) {
    this.#storage = storage
    this.#workspaceKey = workspaceKey
    this.#parserVersion = parserVersion
    this.#historyLimit = operationHistoryLimit
  }

  get workspaceKey() { return this.#workspaceKey }
  get parserVersion() { return this.#parserVersion }

  #restore(checkpoint) {
    this.#state = IndexState.fromCheckpoint(checkpoint, { workspaceKey: this.#workspaceKey })
    this.#recent = new Map()
    if (!Array.isArray(checkpoint.recentOperations)) fail('INDEX_CORRUPT', 'Checkpoint operation history is missing')
    for (const receipt of checkpoint.recentOperations) {
      if (!receipt || typeof receipt.operationId !== 'string' || typeof receipt.requestHash !== 'string' || !/^[a-f0-9]{64}$/.test(receipt.requestHash) || !Number.isSafeInteger(receipt.seq) || receipt.seq < 0 || receipt.seq > checkpoint.seq || this.#recent.has(receipt.operationId)) {
        fail('INDEX_CORRUPT', 'Invalid checkpoint operation history')
      }
      this.#remember(receipt)
    }
    this.#imported = checkpoint.importedLegacy === true
  }

  #remember(receipt) {
    this.#recent.set(receipt.operationId, { operationId: receipt.operationId, requestHash: receipt.requestHash, seq: receipt.seq })
    while (this.#recent.size > this.#historyLimit) this.#recent.delete(this.#recent.keys().next().value)
  }

  #checkpoint() {
    return { ...this.#state.toCheckpoint(), recentOperations: [...this.#recent.values()], importedLegacy: this.#imported }
  }

  #consume(read) {
    try {
      if (read.checkpoint) this.#restore(read.checkpoint)
      if (!this.#state) fail('INDEX_CORRUPT', 'Index state has no checkpoint')
      for (const record of read.records) {
        if (this.#recent.has(record.operationId)) fail('INDEX_CORRUPT', 'Duplicate committed operationId')
        this.#state.applyChanges(record.changes, { seq: record.seq, rebuiltAt: record.rebuiltAt, parserVersion: record.parserVersion })
        this.#remember(record)
      }
      if (this.#state.getSeq() !== read.seq) fail('INDEX_CORRUPT', 'In-memory state and journal sequence differ')
    } catch (cause) {
      if (cause.code === 'INDEX_CORRUPT') throw cause
      throw new IndexStorageError('INDEX_CORRUPT', 'Committed index data failed semantic validation: ' + cause.message, { cause })
    }
  }

  async #sync(tx) {
    let read = await tx.read()
    if (!read.initialized) {
      this.#state = new IndexState(undefined, { workspaceKey: this.#workspaceKey, parserVersion: this.#parserVersion })
      read = await tx.initialize(this.#checkpoint())
    }
    this.#consume(read)
    return read
  }

  #run(job) {
    if (this.#closing) return Promise.reject(new IndexStorageError('INDEX_CLOSED', 'The sidecar store is closed'))
    const task = this.#tail.then(() => this.#storage.withLock(async tx => {
      try {
        const read = await this.#sync(tx)
        return await job(tx, read)
      } catch (error) {
        // A failed append can have left a complete committed line. Re-read disk
        // on the next call rather than publish speculative or stale memory.
        this.#state = null
        this.#recent.clear()
        this.#storage.invalidate()
        throw error
      }
    }))
    this.#tail = task.catch(() => {})
    return task
  }

  #operation(options, request) {
    const operationId = options.operationId ?? randomUUID()
    if (typeof operationId !== 'string' || !operationId.trim() || operationId.length > 256) fail('INDEX_INVALID_ARGUMENT', 'operationId must be 1–256 nonempty characters')
    return { operationId, requestHash: requestHash(request) }
  }

  #repeat(operation, info) {
    const receipt = this.#recent.get(operation.operationId)
    if (!receipt) return null
    if (receipt.requestHash !== operation.requestHash) fail('INDEX_OPERATION_CONFLICT', 'operationId was already used for different input')
    return { changed: false, alreadyApplied: true, originalSeq: receipt.seq, seq: this.#state.getSeq(), generation: info.generation, bytesWritten: 0 }
  }

  #checkStateToken(expectedState, info) {
    if (expectedState !== undefined && (!expectedState || expectedState.seq !== info.seq || expectedState.generation !== info.generation)) {
      fail('INDEX_REVISION_CONFLICT', 'The index changed after the rebuild snapshot was read')
    }
  }

  async #commit(tx, changes, options, operation) {
    const info = tx.info()
    const repeat = this.#repeat(operation, info)
    if (repeat) return repeat
    this.#checkStateToken(options.expectedState, info)
    const validated = this.#state.validateChanges(changes)
    const effective = validated.filter(change => {
      const sameRevision = this.#state.getSourceRevision(change.source) === change.sourceRevision
      const sameParser = this.#state.getSourceParserVersion(change.source) === change.parserVersion
      if (!sameRevision || !sameParser) return true
      if (canonical(this.#state.listSource(change.source)) !== canonical(change.entries)) {
        fail('INDEX_REVISION_MISMATCH', 'Identical source/parser revision cannot identify different entries: ' + change.source)
      }
      return false
    })
    if (!effective.length) return { changed: false, skipped: 'no-change', seq: info.seq, generation: info.generation, bytesWritten: 0 }
    const appended = await tx.append({ ...operation, changes: effective, parserVersion: options.parserVersion ?? this.#parserVersion, rebuiltAt: new Date().toISOString() })
    this.#state.applyChanges(appended.record.changes, { seq: appended.seq, rebuiltAt: appended.record.rebuiltAt, parserVersion: appended.record.parserVersion })
    this.#remember(appended.record)
    return { changed: true, operationId: operation.operationId, changedSources: effective.map(change => change.source), seq: appended.seq, generation: appended.generation, bytesWritten: appended.bytesWritten, journalBytes: appended.journalBytes }
  }

  /** One transaction can replace several sources; an empty entries array is a tombstone. */
  async replaceSources(changes, options = {}) {
    options = mutationOptions(options, this.#parserVersion)
    const normalized = normalizeChanges(changes).map(change => ({ ...change, parserVersion: change.parserVersion ?? options.parserVersion ?? this.#parserVersion }))
    const operation = this.#operation(options, { action: 'replace', changes: normalized, expectedState: options.expectedState })
    return this.#run(tx => this.#commit(tx, normalized, options, operation))
  }

  replaceSource(change, options = {}) { return this.replaceSources([change], options) }

  /** Preserve a revision tombstone so an old expectedRevision:null cannot resurrect a source. */
  async removeSources(sources, options = {}) {
    if (!Array.isArray(sources)) fail('INDEX_INVALID_ARGUMENT', 'removeSources requires an array of source descriptors')
    return this.replaceSources(sources.map(item => {
      if (!item || typeof item !== 'object') fail('INDEX_INVALID_ARGUMENT', 'A source descriptor is required')
      return { ...item, sourceRevision: item.sourceRevision ?? 'deleted:' + requestHash({ source: item.source, expectedRevision: item.expectedRevision ?? null }), entries: [] }
    }), options)
  }

  /** Import a legacy snapshot once. This never modifies the original legacy file. */
  async importLegacy(snapshot, options = {}) {
    options = mutationOptions(options, this.#parserVersion)
    const validated = legacySnapshot(snapshot, this.#workspaceKey)
    const operation = this.#operation(options, { action: 'import', snapshot: validated, parserVersion: options.parserVersion })
    return this.#run(async tx => {
      const repeat = this.#repeat(operation, tx.info())
      if (repeat) return repeat
      if (this.#imported || this.#state.getSeq() !== 0 || this.#state.getEntryCount() !== 0 || this.#recent.size) fail('INDEX_ALREADY_INITIALIZED', 'Legacy import requires an unused store')
      const state = new IndexState(validated, { workspaceKey: this.#workspaceKey, parserVersion: options.parserVersion })
      const payload = { ...state.toCheckpoint(), recentOperations: [{ ...operation, seq: 0 }], importedLegacy: true }
      const published = await tx.compact(payload)
      this.#consume(published)
      return { changed: true, imported: true, entries: this.#state.getEntryCount(), seq: published.seq, generation: published.generation, journalBytes: 0 }
    })
  }

  /** Explicit full rebuild, guarded by a token acquired with readSnapshot(). */
  async rebuild(snapshot, options = {}) {
    options = mutationOptions(options, this.#parserVersion)
    if (!options.expectedState) fail('INDEX_INVALID_ARGUMENT', 'rebuild requires expectedState from readSnapshot()')
    const validated = legacySnapshot(snapshot, this.#workspaceKey)
    const operation = this.#operation(options, { action: 'rebuild', snapshot: validated, expectedState: options.expectedState, parserVersion: options.parserVersion ?? this.#parserVersion })
    return this.#run(tx => {
      const bySource = new Map()
      for (const entry of validated.entries) {
        if (!bySource.has(entry.source)) bySource.set(entry.source, [])
        bySource.get(entry.source).push(entry)
      }
      // Full rebuild is deliberately O(all entries); regular writes are source-local.
      const old = this.#state.loadView()
      const sources = new Set([...old.entries.map(entry => entry.source), ...bySource.keys()])
      const changes = [...sources].map(source => ({
        source, entries: bySource.get(source) ?? [],
        sourceRevision: validated.sourceRevisions[source] ?? 'rebuilt:' + requestHash(bySource.get(source) ?? []),
        expectedRevision: this.#state.getSourceRevision(source), parserVersion: options.parserVersion ?? this.#parserVersion,
      }))
      return this.#commit(tx, changes, options, operation)
    })
  }

  loadView() { return this.#run(() => this.#state.loadView()) }
  readSnapshot() { return this.#run(tx => ({ view: this.#state.loadView(), revision: { generation: tx.info().generation, seq: tx.info().seq } })) }
  getEntry(id) { return this.#run(() => this.#state.getEntry(id)) }
  findByTag(tag) { return this.#run(() => this.#state.findByTag(tag)) }
  findByCue(cue) { return this.#run(() => this.#state.findByCue(cue)) }
  listSource(source) { return this.#run(() => this.#state.listSource(source)) }
  getSourceRevision(source) { return this.#run(() => this.#state.getSourceRevision(source)) }
  getStatus() { return this.#run((tx, read) => ({ ...tx.info(), workspaceKey: this.#workspaceKey, entries: this.#state.getEntryCount(), sources: this.#state.getSourceCount(), parserVersion: this.#parserVersion, configuredParserVersion: this.#parserVersion, committedParserVersion: this.#state.getParserVersion(), recentOperations: this.#recent.size, recoveredTailBytes: read.recoveredTailBytes })) }
  exportLegacySnapshot({ pretty = true } = {}) { return this.#run(() => JSON.stringify(this.#state.loadView(), null, pretty ? 2 : undefined)) }

  compact() {
    return this.#run(async tx => {
      const previous = tx.info()
      const published = await tx.compact(this.#checkpoint())
      this.#consume(published)
      return { changed: false, compacted: true, seq: published.seq, generation: published.generation, previousGeneration: previous.generation, previousJournalBytes: previous.journalBytes, journalBytes: published.journalBytes }
    })
  }

  /** All previously accepted calls finish; new calls are rejected once close starts. */
  close() {
    if (!this.#closePromise) {
      this.#closing = true
      this.#closePromise = this.#tail.then(() => this.#storage.close())
    }
    return this.#closePromise
  }
}

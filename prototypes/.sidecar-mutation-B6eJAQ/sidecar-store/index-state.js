/**
 * In-memory sidecar view. No filesystem or host dependencies.
 *
 * Source replacement changes only affected entry and posting buckets. Entries
 * that keep their IDs retain their original position; new IDs append. Public
 * reads return copies, so a caller cannot mutate a committed view.
 */

import { IndexStorageError } from './codec.js'

const LEGACY_VERSION = 'wb_sidecar_pre_v1'
const CHECKPOINT_SCHEMA = 'sidecar_index_state_v1'
const DEFAULT_PARSER_VERSION = 'sidecar-parser-v1'

function failure(code, message, details = {}) {
  return new IndexStorageError(code, message, details)
}

function invalid(message, details) {
  return failure('INDEX_INVALID_DATA', message, details)
}

function own(object, key) {
  return Object.prototype.hasOwnProperty.call(object, key)
}

function put(object, key, value) {
  // defineProperty handles literal "__proto__" and "constructor" as data.
  Object.defineProperty(object, key, { value, enumerable: true, writable: true, configurable: true })
}

function plainObject(value, label) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw invalid(`${label} must be a JSON object`)
  const prototype = Object.getPrototypeOf(value)
  if (prototype !== Object.prototype && prototype !== null) throw invalid(`${label} must be a plain JSON object`)
  return value
}

/** Strict JSON cloning rejects values that JSON.stringify would silently lose. */
function copyJson(value, label = 'value', active = new Set(), depth = 0) {
  if (depth > 128) throw invalid(`${label} exceeds the JSON nesting limit`)
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return value
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw invalid(`${label} must contain finite JSON numbers`)
    return value
  }
  if (typeof value !== 'object') throw invalid(`${label} contains a value that JSON cannot represent`)
  if (active.has(value)) throw invalid(`${label} contains a circular reference`)
  active.add(value)
  try {
    if (Array.isArray(value)) {
      if (Reflect.ownKeys(value).some(key => key !== 'length' && (typeof key !== 'string' || !/^(0|[1-9]\d*)$/.test(key) || Number(key) >= value.length))) {
        throw invalid(`${label} has non-JSON array properties`)
      }
      const result = []
      for (let i = 0; i < value.length; i++) {
        const descriptor = Object.getOwnPropertyDescriptor(value, String(i))
        if (!descriptor || !own(descriptor, 'value') || !descriptor.enumerable) throw invalid(`${label} must not contain sparse arrays or accessors`)
        result.push(copyJson(descriptor.value, `${label}[${i}]`, active, depth + 1))
      }
      return result
    }
    plainObject(value, label)
    const result = {}
    for (const key of Reflect.ownKeys(value)) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key)
      if (typeof key !== 'string' || !descriptor.enumerable || !own(descriptor, 'value')) throw invalid(`${label} has a non-JSON property`)
      put(result, key, copyJson(descriptor.value, `${label}.${key}`, active, depth + 1))
    }
    return result
  } finally {
    active.delete(value)
  }
}

function nonempty(value, label) {
  if (typeof value !== 'string' || value.length === 0) throw invalid(`${label} must be a nonempty string`)
  return value
}

function sourcePath(value, label = 'source') {
  nonempty(value, label)
  if (value !== value.trim() || value.includes('\\') || value.startsWith('/') || /[\u0000-\u001f<>:"|?*]/.test(value)) {
    throw invalid(`${label} must be a normalized relative path`)
  }
  if (value.split('/').some(part => !part || part === '.' || part === '..' || /[. ]$/.test(part))) {
    throw invalid(`${label} must not contain empty, dot or parent path segments`)
  }
  return value
}

function entriesFor(entries, source, label = 'entries') {
  if (!Array.isArray(entries)) throw invalid(`${label} must be an array`)
  const ids = new Set()
  return entries.map((entry, i) => {
    plainObject(entry, `${label}[${i}]`)
    const copy = copyJson(entry, `${label}[${i}]`)
    nonempty(copy.id, `${label}[${i}].id`)
    sourcePath(copy.source, `${label}[${i}].source`)
    if (source !== undefined && copy.source !== source) throw invalid(`${label}[${i}].source differs from its change source`)
    if (ids.has(copy.id)) throw failure('INDEX_ENTRY_CONFLICT', `Duplicate entry ID: ${copy.id}`, { entryId: copy.id })
    ids.add(copy.id)
    for (const field of ['tags', 'cues']) {
      if (own(copy, field) && (!Array.isArray(copy[field]) || copy[field].some(key => typeof key !== 'string'))) {
        throw invalid(`${label}[${i}].${field} must be an array of strings`)
      }
    }
    if (own(copy, 'kind') && typeof copy.kind !== 'string') throw invalid(`${label}[${i}].kind must be a string`)
    return copy
  })
}

/** Normalize only the changed documents, preserving absent vs null CAS. */
export function normalizeChanges(changes) {
  if (!Array.isArray(changes)) throw invalid('changes must be an array')
  const sources = new Set()
  const allIds = new Set()
  return changes.map((change, i) => {
    plainObject(change, `changes[${i}]`)
    // Clone before reading properties, so getter-bearing objects are rejected.
    const input = copyJson(change, `changes[${i}]`)
    const source = sourcePath(input.source, `changes[${i}].source`)
    if (sources.has(source)) throw invalid(`A source may occur only once per transaction: ${source}`)
    sources.add(source)
    const result = {
      source,
      sourceRevision: nonempty(input.sourceRevision, `changes[${i}].sourceRevision`),
      entries: entriesFor(input.entries, source, `changes[${i}].entries`),
    }
    if (own(input, 'expectedRevision')) {
      if (input.expectedRevision !== null) nonempty(input.expectedRevision, `changes[${i}].expectedRevision`)
      result.expectedRevision = input.expectedRevision
    }
    if (own(input, 'parserVersion')) result.parserVersion = nonempty(input.parserVersion, `changes[${i}].parserVersion`)
    for (const entry of result.entries) {
      if (allIds.has(entry.id)) throw failure('INDEX_ENTRY_CONFLICT', `Entry ID occurs in multiple changes: ${entry.id}`, { entryId: entry.id })
      allIds.add(entry.id)
    }
    return result
  })
}

/** Return a detached legacy DTO; persisted derived maps are not trusted. */
export function validateLegacySnapshot(snapshot, workspaceKey) {
  plainObject(snapshot, 'snapshot')
  const input = copyJson(snapshot, 'snapshot')
  const ws = typeof input.ws === 'string' ? input.ws : workspaceKey
  if (typeof ws !== 'string') throw invalid('snapshot.ws or workspaceKey is required')
  if (workspaceKey !== undefined && ws !== workspaceKey) throw invalid('snapshot workspace differs from the requested workspace', { expectedWorkspace: workspaceKey, actualWorkspace: ws })
  if (own(input, 'version') && typeof input.version !== 'string') throw invalid('snapshot.version must be a string')
  if (own(input, 'rebuilt_at') && typeof input.rebuilt_at !== 'string') throw invalid('snapshot.rebuilt_at must be a string')
  const entries = entriesFor(input.entries, undefined, 'snapshot.entries')
  const sourceRevisions = {}
  if (own(input, 'sourceRevisions')) {
    plainObject(input.sourceRevisions, 'snapshot.sourceRevisions')
    for (const [source, revision] of Object.entries(input.sourceRevisions)) {
      sourcePath(source, 'snapshot.sourceRevisions key')
      // Older indexes may contain empty revisions. They remain opaque and are
      // preserved by import; fresh transactions require nonempty revisions.
      if (typeof revision !== 'string') throw invalid('snapshot.sourceRevisions values must be strings')
      put(sourceRevisions, source, revision)
    }
  }
  let versions
  if (own(input, 'versions')) {
    plainObject(input.versions, 'snapshot.versions')
    versions = {}
    for (const [id, sources] of Object.entries(input.versions)) {
      if (!Array.isArray(sources) || sources.some(source => typeof source !== 'string')) throw invalid('snapshot.versions values must be arrays of strings')
      put(versions, id, sources.slice())
    }
  } else {
    versions = {}
    for (const entry of entries) if (entry.kind === 'archive') put(versions, entry.id, [entry.source])
  }
  return {
    version: input.version || LEGACY_VERSION,
    ws,
    rebuilt_at: input.rebuilt_at || '',
    entries,
    versions,
    sourceRevisions,
  }
}

function addPosting(map, key, id) {
  if (!map.has(key)) map.set(key, new Set())
  map.get(key).add(id)
}

function removePosting(map, key, id) {
  const posting = map.get(key)
  if (!posting) return
  posting.delete(id)
  if (!posting.size) map.delete(key)
}

export class IndexState {
  #entries = new Map()
  #sources = new Map()
  #byTag = new Map()
  #byCue = new Map()
  #versions = new Map()
  #revisions = new Map()
  #sourceParsers = new Map()
  #ranks = new Map()
  #nextRank = 0
  #seq = 0
  #version
  #workspaceKey
  #rebuiltAt
  #parserVersion

  constructor(snapshot, { workspaceKey, parserVersion = DEFAULT_PARSER_VERSION } = {}) {
    this.#parserVersion = nonempty(parserVersion, 'parserVersion')
    const initial = snapshot === undefined
      ? { version: LEGACY_VERSION, ws: workspaceKey ?? '', rebuilt_at: '', entries: [], versions: {}, sourceRevisions: {} }
      : snapshot
    const view = validateLegacySnapshot(initial, workspaceKey)
    this.#version = view.version
    this.#workspaceKey = view.ws
    this.#rebuiltAt = view.rebuilt_at
    for (const entry of view.entries) this.#addEntry(entry)
    for (const [id, sources] of Object.entries(view.versions)) this.#versions.set(id, sources)
    for (const [source, revision] of Object.entries(view.sourceRevisions)) this.#revisions.set(source, revision)
    for (const source of new Set([...this.#sources.keys(), ...this.#revisions.keys()])) this.#sourceParsers.set(source, this.#parserVersion)
  }

  static fromCheckpoint(data, options = {}) {
    plainObject(data, 'checkpoint')
    if (data.schema !== CHECKPOINT_SCHEMA) throw invalid('Unsupported in-memory checkpoint schema')
    if (!Number.isSafeInteger(data.seq) || data.seq < 0) throw invalid('checkpoint.seq must be a nonnegative safe integer')
    const checkpointParser = nonempty(data.parserVersion, 'checkpoint.parserVersion')
    // Ignore unknown root extensions, e.g. the facade idempotency window.
    const state = new IndexState(data.view, { ...options, parserVersion: checkpointParser })
    state.#seq = data.seq
    plainObject(data.sourceParserVersions, 'checkpoint.sourceParserVersions')
    const parsers = copyJson(data.sourceParserVersions, 'checkpoint.sourceParserVersions')
    for (const [source, version] of Object.entries(parsers)) {
      sourcePath(source, 'checkpoint.sourceParserVersions key')
      state.#sourceParsers.set(source, nonempty(version, 'checkpoint source parser version'))
    }
    return state
  }

  get seq() { return this.#seq }
  get workspaceKey() { return this.#workspaceKey }
  get parserVersion() { return this.#parserVersion }
  getSeq() { return this.#seq }
  getParserVersion() { return this.#parserVersion }
  getEntryCount() { return this.#entries.size }
  getSourceCount() { return this.#sources.size }

  getSourceRevision(source) { return this.#revisions.has(source) ? this.#revisions.get(source) : null }
  getSourceParserVersion(source) { return this.#sourceParsers.get(source) ?? null }

  #addEntry(entry) {
    if (!this.#ranks.has(entry.id)) this.#ranks.set(entry.id, this.#nextRank++)
    this.#entries.set(entry.id, entry)
    if (!this.#sources.has(entry.source)) this.#sources.set(entry.source, new Set())
    this.#sources.get(entry.source).add(entry.id)
    for (const tag of entry.tags || []) addPosting(this.#byTag, tag, entry.id)
    for (const cue of entry.cues || []) addPosting(this.#byCue, cue, entry.id)
  }

  #removeEntry(entry, removeRank) {
    for (const tag of entry.tags || []) removePosting(this.#byTag, tag, entry.id)
    for (const cue of entry.cues || []) removePosting(this.#byCue, cue, entry.id)
    this.#sources.get(entry.source)?.delete(entry.id)
    if (this.#sources.get(entry.source)?.size === 0) this.#sources.delete(entry.source)
    if (removeRank) {
      this.#entries.delete(entry.id)
      this.#ranks.delete(entry.id)
    }
  }

  #orderedIds(ids) {
    return [...(ids || [])].sort((a, b) => this.#ranks.get(a) - this.#ranks.get(b))
  }

  #copyEntries(ids) {
    return this.#orderedIds(ids).map(id => copyJson(this.#entries.get(id)))
  }

  getEntry(id) {
    const entry = this.#entries.get(id)
    return entry === undefined ? null : copyJson(entry)
  }

  findByTag(tag) { return this.#copyEntries(this.#byTag.get(tag)) }
  findByCue(cue) { return this.#copyEntries(this.#byCue.get(cue)) }
  listSource(source) { return this.#copyEntries(this.#sources.get(source)) }

  /** Validate the full transaction before the storage facade appends a record. */
  validateChanges(changes) {
    const normalized = normalizeChanges(changes)
    for (const change of normalized) {
      const actual = this.getSourceRevision(change.source)
      if (own(change, 'expectedRevision') && change.expectedRevision !== actual) {
        throw failure('INDEX_REVISION_CONFLICT', `Source revision changed: ${change.source}`, { source: change.source, expectedRevision: change.expectedRevision, actualRevision: actual })
      }
      for (const entry of change.entries) {
        const previous = this.#entries.get(entry.id)
        // Even an A-delete/B-insert transaction cannot reassign an existing ID
        // to another document. Entry identity includes source ownership.
        if (previous && previous.source !== change.source) {
          throw failure('INDEX_ENTRY_CONFLICT', `Entry ID belongs to another source: ${entry.id}`, { entryId: entry.id, source: change.source, actualSource: previous.source })
        }
      }
    }
    return normalized
  }

  applyChanges(changes, { seq = this.#seq + 1, rebuiltAt = new Date().toISOString(), parserVersion = this.#parserVersion } = {}) {
    const normalized = this.validateChanges(changes)
    if (!Number.isSafeInteger(seq) || seq !== this.#seq + 1) throw failure('INDEX_SEQUENCE_ERROR', `Expected sequence ${this.#seq + 1}, received ${seq}`)
    if (typeof rebuiltAt !== 'string') throw invalid('rebuiltAt must be a string')
    nonempty(parserVersion, 'parserVersion')
    // Every operation below uses detached validated plain JSON; all expected
    // failures happen above, before any committed in-memory field changes.
    for (const change of normalized) {
      const incoming = new Map(change.entries.map(entry => [entry.id, entry]))
      const previousIds = [...(this.#sources.get(change.source) || [])]
      for (const id of previousIds) {
        const previous = this.#entries.get(id)
        this.#removeEntry(previous, !incoming.has(id))
        // Versions are opaque historical evidence, not a derivable current-entry
        // posting. Replacing/removing an entry is not permission to erase lineage.
      }
      for (const entry of change.entries) {
        this.#addEntry(entry)
        if (entry.kind === 'archive') {
          const lineage = this.#versions.get(entry.id) ?? []
          if (!lineage.includes(entry.source)) this.#versions.set(entry.id, [...lineage, entry.source])
        }
      }
      this.#revisions.set(change.source, change.sourceRevision)
      this.#sourceParsers.set(change.source, change.parserVersion ?? parserVersion)
    }
    this.#seq = seq
    this.#parserVersion = parserVersion
    this.#rebuiltAt = rebuiltAt
    return { changedSources: normalized.map(change => change.source), entryCount: this.#entries.size, seq: this.#seq }
  }

  #postingObject(map, field) {
    const result = {}
    // Key order follows the first occurrence in the global entry order, just
    // as the existing buildByTagPre/buildByCuePre functions do.
    for (const entry of this.#entries.values()) {
      for (const key of entry[field] || []) if (!own(result, key)) put(result, key, this.#orderedIds(map.get(key)))
    }
    return result
  }

  loadView() {
    const versions = {}
    for (const [id, sources] of this.#versions) put(versions, id, sources.slice())
    const sourceRevisions = {}
    for (const [source, revision] of this.#revisions) put(sourceRevisions, source, revision)
    return {
      version: this.#version,
      ws: this.#workspaceKey,
      rebuilt_at: this.#rebuiltAt,
      entries: [...this.#entries.values()].map(entry => copyJson(entry)),
      by_tag: this.#postingObject(this.#byTag, 'tags'),
      by_cue: this.#postingObject(this.#byCue, 'cues'),
      versions,
      sourceRevisions,
    }
  }

  toCheckpoint() {
    const sourceParserVersions = {}
    for (const [source, version] of this.#sourceParsers) put(sourceParserVersions, source, version)
    const versions = {}
    for (const [id, sources] of this.#versions) put(versions, id, sources.slice())
    const sourceRevisions = {}
    for (const [source, revision] of this.#revisions) put(sourceRevisions, source, revision)
    return {
      schema: CHECKPOINT_SCHEMA,
      seq: this.#seq,
      parserVersion: this.#parserVersion,
      sourceParserVersions,
      // Derived posting maps remain in memory. Restore derives them from this
      // ordered entry list, so compaction need not build or persist them.
      view: {
        version: this.#version,
        ws: this.#workspaceKey,
        rebuilt_at: this.#rebuiltAt,
        entries: [...this.#entries.values()].map(entry => copyJson(entry)),
        versions,
        sourceRevisions,
      },
    }
  }

  clone() {
    return IndexState.fromCheckpoint(this.toCheckpoint(), { workspaceKey: this.#workspaceKey })
  }
}

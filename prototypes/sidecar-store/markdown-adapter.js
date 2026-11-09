import { readFile } from 'node:fs/promises'
import { buildSidecarEntriesPre, wbRefPre } from '../../lib/wb-sidecar.js'
import { planRevisionPre } from '../../lib/plan-store.js'
import { normalizeChanges } from './index-state.js'
import { IndexStorageError, sha256 } from './codec.js'

/**
 * Existing deterministic Markdown parsing sits here, outside persistence.
 * Methods index text; they never create, edit or archive a Markdown source file.
 */
export class MarkdownSidecarAdapter {
  #store
  #workspaceKey
  #parserVersion

  constructor(store, { workspaceKey, parserVersion = 'wb-parser-v1' } = {}) {
    if (!store || typeof store.replaceSources !== 'function' || typeof workspaceKey !== 'string' || !workspaceKey || store.workspaceKey !== workspaceKey || typeof parserVersion !== 'string' || !parserVersion) {
      throw new IndexStorageError('INDEX_INVALID_ARGUMENT', 'A store and matching workspaceKey are required')
    }
    this.#store = store
    this.#workspaceKey = workspaceKey
    this.#parserVersion = parserVersion
  }

  get workspaceKey() { return this.#workspaceKey }
  get parserVersion() { return this.#parserVersion }

  deriveDocument(document) {
    if (!document || typeof document.text !== 'string') throw new IndexStorageError('INDEX_INVALID_ARGUMENT', 'A document requires source and text')
    const ref = wbRefPre(document.source, document.title)
    const sourceRevision = ref.relPath === 'handoff/PLAN.md' ? planRevisionPre(document.text) : sha256(document.text)
    const inputs = { title: ref.title, ts: document.ts ?? '', kind: document.kind, mtime: document.mtime ?? 0, criteria: document.criteria, status: document.status }
    const entries = buildSidecarEntriesPre({ workspaceKey: this.workspaceKey, relPath: ref.relPath, text: document.text, ...inputs })
    // The source revision keeps PLAN's canonical source semantics. Metadata is
    // part of the derivation identity, so a title/mtime change cannot poison a
    // "same revision, different entries" transaction or masquerade as no-op.
    const derivationVersion = this.parserVersion + ':inputs:' + sha256(JSON.stringify(inputs))
    return normalizeChanges([{ source: ref.relPath, sourceRevision, entries, ...(Object.hasOwn(document, 'expectedRevision') ? { expectedRevision: document.expectedRevision } : {}), parserVersion: derivationVersion }])[0]
  }

  indexDocument(document, options = {}) { return this.indexDocuments([document], options) }

  indexDocuments(documents, options = {}) {
    if (!Array.isArray(documents)) throw new IndexStorageError('INDEX_INVALID_ARGUMENT', 'documents must be an array')
    return this.#store.replaceSources(documents.map(document => this.deriveDocument(document)), { ...options, parserVersion: this.parserVersion })
  }

  async importLegacyFile(file, options = {}) {
    return this.#store.importLegacy(JSON.parse(await readFile(file, 'utf8')), options)
  }

  /** The caller supplies the explicit document scope, including archive if desired. */
  async rebuild(documents, options = {}) {
    if (!Array.isArray(documents)) throw new IndexStorageError('INDEX_INVALID_ARGUMENT', 'documents must be an array')
    const derived = documents.map(document => this.deriveDocument(document))
    normalizeChanges(derived)
    const capturedOptions = { ...options, ...(options.expectedState ? { expectedState: { ...options.expectedState } } : {}) }
    const before = await this.#store.readSnapshot()
    const incoming = new Set(derived.map(change => change.source))
    const previousSources = new Set(before.view.entries.map(entry => entry.source))
    const changes = derived.map(change => ({ ...change, expectedRevision: Object.hasOwn(before.view.sourceRevisions, change.source) ? before.view.sourceRevisions[change.source] : null }))
    for (const source of previousSources) if (!incoming.has(source)) changes.push({ source, sourceRevision: 'deleted:' + sha256(source), entries: [], expectedRevision: Object.hasOwn(before.view.sourceRevisions, source) ? before.view.sourceRevisions[source] : null, parserVersion: this.parserVersion })
    return this.#store.replaceSources(changes, { ...capturedOptions, parserVersion: this.parserVersion, expectedState: capturedOptions.expectedState ?? before.revision })
  }
}

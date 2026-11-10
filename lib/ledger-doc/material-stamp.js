import * as fs from 'node:fs/promises'
import path from 'node:path'
import { TextDecoder } from 'node:util'
import { fileWithinRoots, pathKey } from '../file-boundary.js'
import { randomUUID } from 'node:crypto'
import {
  DOCUMENT_MARKER, canonicalize, computeOperationDigest, computeRevision,
  normalizeText, validateDocumentId, validateEventIds, validateRevision,
} from './protocol.js'

export const MATERIAL_STAMP_SCHEMA = 'r4-material-stamp-v2'
export const MATERIAL_INVALIDATION_SCHEMA = 'r4-material-invalidation-v1'
const LEGACY_LEDGER_RE = /^handoff-\d{8}-\d{6}(-[a-z])?\.md$/
const decoder = new TextDecoder('utf-8', { fatal: true })

function inside(parent, candidate) {
  const relative = path.relative(parent, candidate)
  return relative !== '' && relative !== '..' && !relative.startsWith('..' + path.sep) && !path.isAbsolute(relative)
}

function errorCode(error, fallback = 'read-failed') {
  return error && typeof error.code === 'string' && /^[A-Z][A-Z0-9_]+$/.test(error.code) ? error.code : fallback
}

function readError(source, code, identity = {}) {
  return { source, code, ...identity }
}

function emptyMaterial() {
  return {
    schema: MATERIAL_STAMP_SCHEMA,
    rootState: 'missing',
    plan: { state: 'missing', revision: null },
    legacyLatest: { state: 'missing', name: null, revision: null },
    documentsState: 'missing',
    documents: [],
    events: { state: 'missing', digest: null },
    readErrors: [],
  }
}

function eventProjection(event) {
  const source = event && typeof event === 'object' && !Array.isArray(event) ? event : {}
  const checkpointCount = Number.isFinite(source.checkpointCount)
    ? source.checkpointCount
    : Array.isArray(source.checkpoints) ? source.checkpoints.length : 0
  return {
    id: typeof source.id === 'string' ? source.id : null,
    name: typeof source.name === 'string' ? source.name : null,
    summary: typeof source.summary === 'string' ? source.summary : null,
    status: typeof source.status === 'string' ? source.status : null,
    sections: source.sections ?? null,
    updatedAt: source.updatedAt ?? null,
    checkpointCount,
    outcome: source.outcome ?? null,
  }
}

/** Synchronous, in-process hints only. Disk revision remains authoritative. */
export class MaterialInvalidationBus {
  constructor() {
    this.epoch = randomUUID()
    this.sequence = 0
    this.versions = new Map()
    this.listeners = new Map()
  }

  key(handoffDir) {
    if (typeof handoffDir !== 'string' || !path.isAbsolute(handoffDir)) throw new TypeError('handoff-root-invalid')
    return pathKey(handoffDir)
  }

  version(handoffDir) {
    return this.versions.get(this.key(handoffDir)) || 0
  }

  subscribe(handoffDir, listener) {
    if (typeof listener !== 'function') throw new TypeError('invalidation-listener-invalid')
    const key = this.key(handoffDir)
    if (!this.listeners.has(key)) this.listeners.set(key, new Set())
    const listeners = this.listeners.get(key)
    listeners.add(listener)
    return () => {
      listeners.delete(listener)
      if (!listeners.size) this.listeners.delete(key)
    }
  }

  publishCommitted({ handoffDir, documentId, revision, opId = null }) {
    if (!validateDocumentId(documentId).ok) throw new TypeError('document-id-invalid')
    if (!validateRevision(revision).ok) throw new TypeError('revision-invalid')
    if (opId !== null && (typeof opId !== 'string' || !opId)) throw new TypeError('op-id-invalid')
    const key = this.key(handoffDir)
    const version = this.version(handoffDir) + 1
    this.versions.set(key, version)
    const base = {
      schema: MATERIAL_INVALIDATION_SCHEMA,
      epoch: this.epoch,
      sequence: ++this.sequence,
      handoffVersion: version,
      handoffKey: key,
      documentId,
      revision,
      opId,
      committed: true,
      listenerErrors: [],
    }
    for (const listener of this.listeners.get(key) || []) {
      try { listener(base) } catch (error) { base.listenerErrors.push({ message: String(error?.message || error) }) }
    }
    return base
  }
}

/** Call only after the document store has committed and read back the revision. */
export function publishCommittedDocument(bus, handoffDir, writeResult) {
  if (!(bus instanceof MaterialInvalidationBus)) throw new TypeError('invalidation-bus-invalid')
  if (!writeResult || writeResult.ok !== true || writeResult.noop !== false) throw new TypeError('committed-write-required')
  return bus.publishCommitted({
    handoffDir,
    documentId: writeResult.documentId,
    revision: writeResult.revision,
    opId: writeResult.opId ?? null,
  })
}

/**
 * Isolated R4 reader. It is disabled unless enabled:true is explicit.
 * There is deliberately no stamp cache: local invalidation hints can ask a
 * consumer to refresh, while every refresh rereads content and recomputes
 * revisions. Other processes therefore need no shared in-memory bus.
 */
export class HandoffMaterialStamp {
  constructor({ handoffDir, planPath, eventsPath, artifactsDir, enabled = false, fs: fsApi = fs, invalidation = null } = {}) {
    if (typeof handoffDir !== 'string' || !path.isAbsolute(handoffDir)) throw new TypeError('handoff-root-invalid')
    this.handoffDir = path.resolve(handoffDir)
    this.artifactsDir = path.resolve(artifactsDir || path.join(process.cwd(), 'artifacts'))
    if (!inside(this.artifactsDir, this.handoffDir)) throw new TypeError('handoff-root-invalid')
    this.planPath = path.resolve(planPath || path.join(this.handoffDir, 'PLAN.md'))
    this.eventsPath = path.resolve(eventsPath || path.join(this.handoffDir, 'event-store.json'))
    if (!inside(this.handoffDir, this.planPath) || !inside(this.handoffDir, this.eventsPath)) throw new TypeError('material-path-invalid')
    this.documentsDir = path.join(this.handoffDir, 'documents')
    this.enabled = enabled === true
    this.fs = fsApi
    this.invalidation = invalidation
  }

  async _root() {
    const artifactsStat = await this.fs.lstat(this.artifactsDir)
    if (!artifactsStat.isDirectory() || artifactsStat.isSymbolicLink()) throw Object.assign(new Error('artifacts-root-invalid'), { code: 'MATERIAL_ROOT_INVALID' })
    const artifactsReal = await this.fs.realpath(this.artifactsDir)
    try {
      const stat = await this.fs.lstat(this.handoffDir)
      if (!stat.isDirectory() || stat.isSymbolicLink()) throw Object.assign(new Error('handoff-root-invalid'), { code: 'MATERIAL_ROOT_INVALID' })
    } catch (error) {
      if (error.code === 'ENOENT') {
        const missing = fileWithinRoots(this.handoffDir, [artifactsReal], { strict: true, allowMissing: true })
        if (!missing) throw Object.assign(new Error('handoff-root-invalid'), { code: 'MATERIAL_ROOT_INVALID' })
        return { physical: missing, missing: true }
      }
      throw error
    }
    const physical = fileWithinRoots(this.handoffDir, [artifactsReal], { strict: true })
    if (!physical) throw Object.assign(new Error('handoff-root-invalid'), { code: 'MATERIAL_ROOT_INVALID' })
    return { physical, missing: false }
  }

  async _readFile(rootPhysical, filePath) {
    let stat
    try { stat = await this.fs.lstat(filePath) } catch (error) {
      if (error.code === 'ENOENT') return { state: 'missing', text: null }
      throw error
    }
    if (!stat.isFile() || stat.isSymbolicLink()) throw Object.assign(new Error('material-path-invalid'), { code: 'MATERIAL_PATH_INVALID' })
    const physical = fileWithinRoots(filePath, [rootPhysical], { strict: true })
    if (!physical) throw Object.assign(new Error('material-path-invalid'), { code: 'MATERIAL_PATH_INVALID' })
    const bytes = await this.fs.readFile(physical)
    let text
    try { text = decoder.decode(bytes) } catch (error) {
      throw Object.assign(new Error('invalid-utf8'), { code: 'MATERIAL_INVALID_UTF8', cause: error })
    }
    return { state: 'present', text: normalizeText(text), stat }
  }

  _documentRevision(text, documentId) {
    const lines = text.split('\n')
    if (lines.length < 9 || !lines[0].startsWith('# ') || !lines[0].slice(2).trim() || lines[1] !== DOCUMENT_MARKER || lines[2] !== 'documentId: ' + documentId || lines[7] !== '') {
      throw Object.assign(new Error('document-format-invalid'), { code: 'MATERIAL_DOCUMENT_FORMAT_INVALID' })
    }
    if (!lines[3].startsWith('eventIds:') || !lines[4].startsWith('createdAt:') || !lines[5].startsWith('updatedAt:') || !lines[6].startsWith('revision:')) {
      throw Object.assign(new Error('document-format-invalid'), { code: 'MATERIAL_DOCUMENT_FORMAT_INVALID' })
    }
    const ids = validateEventIds(lines[3].slice('eventIds:'.length).trim().split(','))
    if (!ids.ok || lines[3] !== 'eventIds: ' + ids.value.join(',') || !lines[4].slice('createdAt:'.length).trim() || !lines[5].slice('updatedAt:'.length).trim()) {
      throw Object.assign(new Error('document-format-invalid'), { code: 'MATERIAL_DOCUMENT_FORMAT_INVALID' })
    }
    const declared = lines[6].slice('revision:'.length).trim()
    const revision = computeRevision(text)
    if (!validateRevision(declared).ok || declared !== revision) {
      throw Object.assign(new Error('document-revision-mismatch'), { code: 'MATERIAL_DOCUMENT_REVISION_MISMATCH' })
    }
    return revision
  }

  async _plan(root, material) {
    if (root.missing) return
    try {
      const result = await this._readFile(root.physical, this.planPath)
      material.plan = { state: result.state, revision: result.state === 'present' ? computeRevision(result.text) : null }
    } catch (error) {
      material.plan = { state: 'error', revision: null }
      material.readErrors.push(readError('plan', errorCode(error)))
    }
  }

  async _legacy(root, material) {
    if (root.missing) return
    let names
    try { names = (await this.fs.readdir(root.physical, { withFileTypes: true })).filter((entry) => LEGACY_LEDGER_RE.test(entry.name)) } catch (error) {
      material.legacyLatest = { state: 'error', name: null, revision: null }
      material.readErrors.push(readError('legacyLatest', errorCode(error)))
      return
    }
    let latest = null
    for (const entry of names.sort((a, b) => a.name.localeCompare(b.name))) {
      const filePath = path.join(root.physical, entry.name)
      try {
        const stat = await this.fs.lstat(filePath)
        if (!stat.isFile() || stat.isSymbolicLink() || !fileWithinRoots(filePath, [root.physical], { strict: true })) {
          throw Object.assign(new Error('legacy-path-invalid'), { code: 'MATERIAL_PATH_INVALID' })
        }
        if (!latest || stat.mtimeMs >= latest.stat.mtimeMs) latest = { name: entry.name, filePath, stat }
      } catch (error) {
        material.readErrors.push(readError('legacyLatest', errorCode(error), { name: entry.name }))
      }
    }
    if (!latest) {
      material.legacyLatest = { state: material.readErrors.some((item) => item.source === 'legacyLatest') ? 'error' : 'missing', name: null, revision: null }
      return
    }
    try {
      const result = await this._readFile(root.physical, latest.filePath)
      material.legacyLatest = { state: result.state, name: latest.name, revision: result.state === 'present' ? computeRevision(result.text) : null }
    } catch (error) {
      material.legacyLatest = { state: 'error', name: latest.name, revision: null }
      material.readErrors.push(readError('legacyLatest', errorCode(error), { name: latest.name }))
    }
  }

  async _documents(root, material) {
    if (root.missing) return
    let physical
    let entries
    try {
      const stat = await this.fs.lstat(this.documentsDir)
      if (!stat.isDirectory() || stat.isSymbolicLink()) throw Object.assign(new Error('documents-path-invalid'), { code: 'MATERIAL_PATH_INVALID' })
      physical = fileWithinRoots(this.documentsDir, [root.physical], { strict: true })
      if (!physical) throw Object.assign(new Error('documents-path-invalid'), { code: 'MATERIAL_PATH_INVALID' })
      entries = await this.fs.readdir(physical, { withFileTypes: true })
    } catch (error) {
      if (error.code === 'ENOENT') {
        material.documentsState = 'missing'
        return
      }
      material.documentsState = 'error'
      material.readErrors.push(readError('documents', errorCode(error)))
      return
    }
    const candidates = entries.filter((entry) => entry.name.endsWith('.md') && validateDocumentId(entry.name.slice(0, -3)).ok)
      .map((entry) => ({ entry, documentId: entry.name.slice(0, -3) }))
      .sort((a, b) => a.documentId.localeCompare(b.documentId))
    material.documentsState = candidates.length ? 'present' : 'empty'
    for (const { entry, documentId } of candidates) {
      try {
        if (!entry.isFile() || entry.isSymbolicLink()) throw Object.assign(new Error('document-path-invalid'), { code: 'MATERIAL_PATH_INVALID' })
        const result = await this._readFile(physical, path.join(physical, entry.name))
        if (result.state === 'missing') throw Object.assign(new Error('document-disappeared'), { code: 'ENOENT' })
        material.documents.push({ documentId, revision: this._documentRevision(result.text, documentId) })
      } catch (error) {
        material.readErrors.push(readError('document', errorCode(error), { documentId }))
      }
    }
  }

  async _events(root, material) {
    if (root.missing) return
    try {
      const result = await this._readFile(root.physical, this.eventsPath)
      if (result.state === 'missing') return
      const parsed = JSON.parse(result.text)
      const events = Array.isArray(parsed) ? parsed : parsed && parsed.events
      if (!Array.isArray(events)) throw Object.assign(new Error('events-format-invalid'), { code: 'MATERIAL_EVENTS_FORMAT_INVALID' })
      const projected = events.map(eventProjection).sort((a, b) => String(a.id).localeCompare(String(b.id)) || canonicalize(a).localeCompare(canonicalize(b)))
      material.events = { state: projected.length ? 'present' : 'empty', digest: computeOperationDigest(projected) }
    } catch (error) {
      const code = error instanceof SyntaxError ? 'MATERIAL_EVENTS_JSON_INVALID' : errorCode(error)
      material.events = { state: 'error', digest: null }
      material.readErrors.push(readError('events', code))
    }
  }

  async read() {
    if (!this.enabled) return { ok: false, enabled: false, error: 'r4-material-stamp-disabled', stamp: '', material: null }
    const material = emptyMaterial()
    try {
      const root = await this._root()
      material.rootState = root.missing ? 'missing' : 'present'
      await this._plan(root, material)
      await this._legacy(root, material)
      await this._documents(root, material)
      await this._events(root, material)
    } catch (error) {
      material.rootState = 'error'
      material.plan.state = 'error'
      material.legacyLatest.state = 'error'
      material.documentsState = 'error'
      material.events.state = 'error'
      material.readErrors.push(readError('handoff', errorCode(error)))
    }
    material.readErrors.sort((a, b) => canonicalize(a).localeCompare(canonicalize(b)))
    const stamp = computeOperationDigest(material)
    return {
      ok: true,
      enabled: true,
      complete: material.readErrors.length === 0,
      stamp,
      material,
      invalidationVersion: this.invalidation ? this.invalidation.version(this.handoffDir) : 0,
    }
  }

  async readStamp() {
    return (await this.read()).stamp
  }
}

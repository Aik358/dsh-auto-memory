import * as nodeFs from 'node:fs/promises'
import path from 'node:path'
import { TextDecoder } from 'node:util'
import { fileWithinRoots } from '../file-boundary.js'
import { computeOperationDigest, computeRevision, normalizeText, validateDocumentId, validateEventIds } from './protocol.js'

const decoder = new TextDecoder('utf-8', { fatal: true })
const READ_SCHEMA = 'r4-ledger-read-side-v1'
const QUAD_NAMES = new Map([
  ['任务状态', 'state'], ['当前状态', 'state'], ['进行中', 'state'],
  ['目标', 'goal'], ['目的', 'goal'], ['已试方案与失败原因', 'dead'], ['失败与弯路', 'dead'],
  ['失败原因', 'dead'], ['已试方案', 'dead'], ['进度与下一步', 'next'], ['下一步', 'next'],
])

function inside(root, candidate) {
  const relative = path.relative(root, candidate)
  return relative !== '' && relative !== '..' && !relative.startsWith('..' + path.sep) && !path.isAbsolute(relative)
}
function slug(text) {
  const ascii = text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
  return ascii || 'section-' + computeOperationDigest(text).slice(7, 15)
}
function errorOf(source, error) {
  return { source, code: error && error.code ? String(error.code) : 'ledger-doc-read-failed', message: String(error?.message || error) }
}

export function ledgerDocumentChunks(document) {
  if (!document || validateDocumentId(document.documentId).error || typeof document.text !== 'string' || typeof document.revision !== 'string') return []
  const lines = normalizeText(document.text).split('\n')
  const heads = []
  lines.forEach((line, index) => { if (/^#{1,6}\s+\S/.test(line)) heads.push({ index, title: line.replace(/^#{1,6}\s+/, '').trim() }) })
  const ranges = heads.length ? heads : [{ index: 0, title: document.title || document.documentId }]
  const chunks = []
  ranges.forEach((head, index) => {
    const end = index + 1 < ranges.length ? ranges[index + 1].index : lines.length
    const text = lines.slice(head.index, end).join('\n').trimEnd()
    const sectionId = slug(head.title) + '-' + head.index
    const chunkId = 'ledger-doc:' + document.documentId + ':' + sectionId + ':' + document.revision
    chunks.push({
      schema: READ_SCHEMA, chunkId, identity: chunkId, id: chunkId, memoryId: chunkId,
      documentId: document.documentId, sectionId, sectionTitle: head.title,
      revision: document.revision, path: document.path || null, relativePath: document.relativePath || null,
      text, l0: text.length > 400 ? text.slice(0, 400) + '…' : text,
      searchText: text, label: '维护文档/' + document.documentId + '#' + sectionId,
      layer: 'log', status: 'current', lineStart: head.index + 1, lineEnd: end,
      line: text.split('\n')[0], score: 0, sourcePath: document.path || document.documentId,
    })
  })
  return chunks
}

export class LedgerDocReadSide {
  constructor({ handoffDir, documentsDir, eventsPath, fs = nodeFs } = {}) {
    if (typeof handoffDir !== 'string' || !path.isAbsolute(handoffDir)) throw new TypeError('ledger-doc-handoff-invalid')
    this.handoffDir = path.resolve(handoffDir)
    this.documentsDir = path.resolve(documentsDir || path.join(this.handoffDir, 'documents'))
    this.eventsPath = path.resolve(eventsPath || path.join(this.handoffDir, 'event-store.json'))
    this.fs = fs
  }

  async _root() {
    const physical = fileWithinRoots(this.handoffDir, [this.handoffDir], { strict: false, allowMissing: true })
    if (!physical) throw Object.assign(new Error('ledger-doc-handoff-invalid'), { code: 'ledger-doc-handoff-invalid' })
    return physical
  }

  async _read(documentId) {
    if (!validateDocumentId(documentId).ok) throw Object.assign(new Error('document-id-invalid'), { code: 'document-id-invalid' })
    const handoffPhysical = await this._root()
    const target = path.resolve(this.documentsDir, documentId + '.md')
    const physical = fileWithinRoots(target, [handoffPhysical], { strict: true })
    if (!physical) throw Object.assign(new Error('document-id-invalid'), { code: 'document-id-invalid' })
    const stat = await this.fs.lstat(physical)
    if (!stat.isFile() || stat.isSymbolicLink() || path.dirname(physical) !== path.dirname(target)) throw Object.assign(new Error('document-id-invalid'), { code: 'document-id-invalid' })
    const bytes = await this.fs.readFile(physical)
    const text = normalizeText(decoder.decode(bytes))
    const lines = text.split('\n')
    const value = {}
    for (const [index, key] of [[2, 'documentId'], [3, 'eventIds'], [6, 'revision']]) {
      if (!lines[index]?.startsWith(key + ':')) throw Object.assign(new Error('document-format-invalid'), { code: 'document-format-invalid' })
      value[key] = lines[index].slice(key.length + 1).trim()
    }
    if (value.documentId !== documentId) throw Object.assign(new Error('document-id-invalid'), { code: 'document-id-invalid' })
    const ids = validateEventIds(value.eventIds.split(','))
    if (!ids.ok || ids.value.join(',') !== value.eventIds) throw Object.assign(new Error('document-format-invalid'), { code: 'document-format-invalid' })
    const revision = computeRevision(text)
    if (value.revision !== revision) throw Object.assign(new Error('document-revision-mismatch'), { code: 'document-revision-mismatch' })
    return {
      ok: true, schema: READ_SCHEMA, documentId, eventIds: ids.value, revision, text,
      path: physical, relativePath: 'handoff/documents/' + documentId + '.md',
      title: lines[0].replace(/^#\s+/, ''),
      content: lines.slice(8).join('\n').replace(/\n$/, ''),
      createdAt: lines[4]?.slice('createdAt:'.length).trim() || null,
      updatedAt: lines[5]?.slice('updatedAt:'.length).trim() || null,
      bytes: bytes.length,
    }
  }

  async list() {
    const documents = []
    const readErrors = []
    let names
    try {
      const handoffPhysical = await this._root()
      const directory = fileWithinRoots(this.documentsDir, [handoffPhysical], { strict: true, allowMissing: true })
      if (!directory) throw Object.assign(new Error('ledger-doc-documents-invalid'), { code: 'ledger-doc-documents-invalid' })
      const stat = await this.fs.lstat(directory)
      if (!stat.isDirectory() || stat.isSymbolicLink()) throw Object.assign(new Error('ledger-doc-documents-invalid'), { code: 'ledger-doc-documents-invalid' })
      names = (await this.fs.readdir(directory, { withFileTypes: true })).filter((entry) => entry.isFile() && !entry.isSymbolicLink() && entry.name.endsWith('.md')).map((entry) => entry.name).sort()
    } catch (error) {
      if (error.code === 'ENOENT') return { ok: true, documents: [], readErrors, state: 'missing' }
      readErrors.push(errorOf('handoff/documents', error))
      return { ok: false, documents: [], readErrors, state: 'error' }
    }
    for (const name of names) {
      const documentId = name.slice(0, -3)
      if (!validateDocumentId(documentId).ok) {
        readErrors.push({ source: 'handoff/documents/' + name, code: 'document-id-invalid', message: 'Invalid document ID' })
        continue
      }
      try { documents.push(await this._read(documentId)) } catch (error) { readErrors.push(errorOf('handoff/documents/' + name, error)) }
    }
    return { ok: readErrors.length === 0, documents, readErrors, state: documents.length ? 'present' : 'empty' }
  }

  async current({ documentId, eventIds, manifest = null } = {}) {
    const list = await this.list()
    let candidates = list.documents
    if (documentId !== undefined && documentId !== null) {
      if (!validateDocumentId(documentId).ok) return { ok: false, error: 'document-id-invalid', document: null, documents: [], chunks: [], readErrors: list.readErrors }
      candidates = candidates.filter((document) => document.documentId === documentId)
    }
    const ids = validateEventIds(eventIds)
    if (ids.ok) candidates = candidates.filter((document) => ids.value.every((id) => document.eventIds.includes(id)))
    else if (eventIds !== undefined && eventIds !== null) return { ok: false, error: ids.error, document: null, documents: [], chunks: [], readErrors: list.readErrors }
    const requested = manifest?.documentId ?? manifest?.currentDocumentId ?? null
    if (requested !== null && !validateDocumentId(requested).ok) return { ok: false, error: 'document-id-invalid', document: null, documents: [], chunks: [], readErrors: list.readErrors }
    const selected = requested ? candidates.filter((document) => document.documentId === requested) : candidates
    if (selected.length === 1) return { ok: true, selection: 'explicit', document: selected[0], documents: list.documents, chunks: ledgerDocumentChunks(selected[0]), readErrors: list.readErrors }
    if (selected.length === 0 && list.documents.length === 0 && list.readErrors.length === 0) return { ok: true, selection: 'none', document: null, documents: [], chunks: [], readErrors: [] }
    return { ok: false, error: selected.length ? 'document-selection-required' : 'document-not-found', selection: selected.length ? 'ambiguous' : 'missing', document: null, documents: list.documents, chunks: [], readErrors: list.readErrors }
  }

  async chunks() {
    const list = await this.list()
    const chunks = list.documents.flatMap((document) => ledgerDocumentChunks(document))
    return { ok: list.ok, chunks, readErrors: list.readErrors, state: list.state }
  }

  async readChunk(identity) {
    const chunks = await this.chunks()
    const matches = chunks.chunks.filter((chunk) => chunk.chunkId === identity || (chunk.documentId === identity && chunks.chunks.filter((candidate) => candidate.documentId === identity).length === 1))
    if (matches.length !== 1) return { ok: false, error: matches.length ? 'document-selection-required' : 'document-chunk-not-found', document: null, chunk: null, readErrors: chunks.readErrors }
    const chunk = matches[0]
    return { ok: true, document: await this._read(chunk.documentId), chunk, readErrors: chunks.readErrors }
  }

  async _eventDocumentIds(eventId) {
    const checked = validateEventIds([eventId])
    if (!checked.ok || checked.value[0] !== eventId) throw Object.assign(new Error('event-id-invalid'), { code: 'event-id-invalid' })
    const physical = fileWithinRoots(this.eventsPath, [this.handoffDir], { strict: true })
    if (!physical) throw Object.assign(new Error('event-id-unavailable'), { code: 'event-id-unavailable' })
    const stat = await this.fs.lstat(physical)
    if (!stat.isFile() || stat.isSymbolicLink()) throw Object.assign(new Error('event-id-unavailable'), { code: 'event-id-unavailable' })
    const store = JSON.parse(decoder.decode(await this.fs.readFile(physical)))
    const event = store.events?.find((item) => item?.id === eventId)
    if (!event) return []
    const ids = new Set()
    for (const item of event.members || []) {
      const match = /^handoff[\/\\]documents[\/\\]([^\/\\]+)\.md$/.exec(String(item).replace(/\\/g, '/'))
      if (match && validateDocumentId(match[1]).ok) ids.add(match[1])
    }
    for (const cp of event.checkpoints || []) {
      for (const value of [cp?.documentId, cp?.rel, cp?.sourceRef]) {
        const match = /(?:handoff[\/\\]documents[\/\\])?([a-z0-9][a-z0-9-]{0,63}-[0-9]{6}-[0-9]{4})(?:\.md)?$/.exec(String(value || '').trim())
        if (match && validateDocumentId(match[1]).ok) ids.add(match[1])
      }
    }
    return [...ids].sort()
  }

  async forEvent(eventId) {
    const readErrors = []
    let documentIds
    try { documentIds = await this._eventDocumentIds(eventId) } catch (error) {
      readErrors.push(errorOf('handoff/event-store.json', error))
      return { ok: false, error: error.code || 'event-id-unavailable', eventId, documents: [], chunks: [], readErrors }
    }
    const documents = []
    for (const documentId of documentIds) {
      try { documents.push(await this._read(documentId)) } catch (error) { readErrors.push(errorOf(documentId, error)) }
    }
    return { ok: readErrors.length === 0, eventId, documents, chunks: documents.flatMap((document) => ledgerDocumentChunks(document)), readErrors, selection: documents.length ? 'event-binding' : 'none' }
  }
}

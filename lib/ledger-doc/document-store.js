import * as fs from 'node:fs/promises'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { TextDecoder } from 'node:util'
import { DOCUMENT_MARKER, PROTOCOL_VERSION, computeRevision, normalizeText, validateChangeSet, validateDocumentId, validateEventIds, validateRevision } from './protocol.js'

const LF = String.fromCharCode(10)
const REGIONS = ['title', 'eventIds', 'content']
const decoder = new TextDecoder('utf-8', { fatal: true })
const fail = (error, extra = {}) => ({ ok: false, error, ...extra })
const within = (root, candidate) => {
  const relative = path.relative(root, candidate)
  return relative !== '' && relative !== '..' && !relative.startsWith('..' + path.sep) && !path.isAbsolute(relative)
}

function render({ documentId, title, eventIds, createdAt, updatedAt, revision = '', content }) {
  return [
    '# ' + title,
    DOCUMENT_MARKER,
    'documentId: ' + documentId,
    'eventIds: ' + eventIds.join(','),
    'createdAt: ' + createdAt,
    'updatedAt: ' + updatedAt,
    'revision:' + (revision ? ' ' + revision : ''),
    '',
    normalizeText(content),
    '',
  ].join(LF)
}

function parse(text) {
  const lines = normalizeText(text).split(LF)
  if (lines.length < 9 || !lines[0].startsWith('# ') || lines[1] !== DOCUMENT_MARKER || lines[7] !== '') return null
  const value = {}
  for (const [i, key] of [[2, 'documentId'], [3, 'eventIds'], [4, 'createdAt'], [5, 'updatedAt'], [6, 'revision']]) {
    if (!lines[i].startsWith(key + ':')) return null
    value[key] = lines[i].slice(key.length + 1).trim()
  }
  if (!validateDocumentId(value.documentId).ok || !validateRevision(value.revision).ok) return null
  const ids = validateEventIds(value.eventIds.split(','))
  if (!ids.ok || ids.value.join(',') !== value.eventIds || !value.createdAt || !value.updatedAt) return null
  let content = lines.slice(8).join(LF)
  if (content.endsWith(LF)) content = content.slice(0, -1)
  return {
    documentId: value.documentId, title: lines[0].slice(2), eventIds: ids.value, createdAt: value.createdAt,
    updatedAt: value.updatedAt, revision: value.revision, content,
  }
}

export class LedgerDocumentStore {
  constructor(rootDir, options = {}) {
    if (typeof rootDir !== 'string' || !path.isAbsolute(rootDir)) throw new TypeError('document-root-invalid')
    this.rootDir = path.resolve(rootDir)
    this.artifactsDir = path.resolve(process.cwd(), 'artifacts')
    this.readOnly = options.readOnly === true
    if (!this.readOnly && !within(this.artifactsDir, this.rootDir)) throw new TypeError('document-root-invalid')
    this.eventsPath = path.resolve(options.eventsPath || path.join(this.rootDir, '..', 'events.json'))
    if (!this.readOnly && !within(this.artifactsDir, this.eventsPath)) throw new TypeError('document-root-invalid')
    this.now = options.now || (() => new Date().toISOString())
    this.fs = options.fs || fs
  }

  _timestamp() {
    const date = new Date(this.now())
    if (!Number.isFinite(date.getTime())) throw new TypeError('document-clock-invalid')
    return date.toISOString()
  }

  async _assertRoot() {
    if (this.readOnly) {
      const stat = await this.fs.lstat(this.rootDir)
      if (!stat.isDirectory() || stat.isSymbolicLink()) return fail('document-root-invalid')
      this.physicalRoot = await this.fs.realpath(this.rootDir)
      return { ok: true }
    }
    const artifactsReal = await this.fs.realpath(this.artifactsDir)
    if (!within(artifactsReal, this.rootDir)) return fail('document-root-invalid')
    await this.fs.mkdir(this.rootDir, { recursive: true })
    const stat = await this.fs.lstat(this.rootDir)
    if (!stat.isDirectory() || stat.isSymbolicLink()) return fail('document-root-invalid')
    const rootReal = await this.fs.realpath(this.rootDir)
    if (!within(artifactsReal, rootReal)) return fail('document-root-invalid')
    this.physicalRoot = rootReal
    return { ok: true }
  }

  _pathFor(documentId) {
    const checked = validateDocumentId(documentId)
    if (!checked.ok) return checked
    const filePath = path.resolve(this.rootDir, documentId + '.md')
    if (path.dirname(filePath) !== this.rootDir || path.basename(filePath, '.md') !== documentId) return fail('document-id-invalid')
    return { ok: true, filePath }
  }

  async _readBytes(filePath) {
    const stat = await this.fs.lstat(filePath)
    if (!stat.isFile() || stat.isSymbolicLink()) throw Object.assign(new Error('document-id-invalid'), { code: 'DOCUMENT_ID_INVALID' })
    const physical = await this.fs.realpath(filePath)
    if (!this.physicalRoot || path.dirname(physical) !== this.physicalRoot) throw Object.assign(new Error('document-id-invalid'), { code: 'DOCUMENT_ID_INVALID' })
    return this.fs.readFile(filePath)
  }

  async _readText(filePath) {
    return normalizeText(decoder.decode(await this._readBytes(filePath)))
  }

  async _eventIds(args) {
    const primary = validateEventIds(args.eventIds)
    const legacy = args.eventId === undefined ? null : validateEventIds([args.eventId])
    if (!primary.ok && !legacy) return primary
    if (legacy && !legacy.ok) return legacy
    if (!primary.ok) return legacy
    if (legacy && primary.value.join(',') !== legacy.value.join(',')) return fail('event-ids-conflict')
    let parsed
    try {
      const artifactsReal = await this.fs.realpath(this.artifactsDir)
      const eventStat = await this.fs.lstat(this.eventsPath)
      const eventReal = await this.fs.realpath(this.eventsPath)
      if (!eventStat.isFile() || eventStat.isSymbolicLink() || !within(artifactsReal, eventReal)) return fail('event-id-unavailable')
      parsed = JSON.parse(decoder.decode(await this.fs.readFile(eventReal)))
    } catch (_) { return fail('event-id-unavailable') }
    const events = Array.isArray(parsed) ? parsed : parsed && parsed.events
    if (!Array.isArray(events)) return fail('event-id-unavailable')
    const available = new Map(events.filter((event) => event && typeof event.id === 'string').map((event) => [event.id, event]))
    if (!primary.value.every((id) => ['active', 'paused'].includes(available.get(id)?.status))) return fail('event-id-unavailable')
    return { ok: true, value: primary.value }
  }

  _revisionMatches(currentRevision, expectedRevision) {
    return currentRevision === expectedRevision
  }

  async _writeCandidate(filePath, text, { createOnly, expectedRevision }) {
    const revision = computeRevision(text)
    const temporary = path.join(this.rootDir, '.' + path.basename(filePath) + '.' + process.pid + '.' + randomUUID() + '.tmp')
    let handle
    let committed = false
    try {
      handle = await this.fs.open(temporary, 'wx')
      await handle.writeFile(Buffer.from(text, 'utf8'))
      await handle.sync()
      await handle.close()
      handle = null
      const root = await this._assertRoot()
      if (!root.ok) return root
      if (createOnly) {
        try {
          await this.fs.lstat(filePath)
          return fail('document-already-exists')
        } catch (error) { if (error.code !== 'ENOENT') throw error }
        await this.fs.link(temporary, filePath)
        committed = true
        await this.fs.unlink(temporary)
      } else {
        let current
        try { current = await this._readText(filePath) } catch (error) {
          if (error.code === 'ENOENT') return fail('document-not-found')
          throw error
        }
        if (!this._revisionMatches(computeRevision(current), expectedRevision)) return fail('document-version-conflict')
        await this.fs.rename(temporary, filePath)
        committed = true
      }
      let actual
      try { actual = await this._readText(filePath) } catch (error) {
        return fail(error.code === 'DOCUMENT_ID_INVALID' ? 'document-id-invalid' : 'document-readback-failed', { documentMayHaveChanged: committed })
      }
      if (actual !== text || computeRevision(actual) !== revision) return fail('document-readback-failed', { documentMayHaveChanged: committed })
      return { ok: true, revision, bytes: Buffer.byteLength(text, 'utf8') }
    } catch (error) {
      if (createOnly && error.code === 'EEXIST') return fail('document-already-exists')
      if (error.code === 'DOCUMENT_ID_INVALID') return fail('document-id-invalid')
      return fail('document-write-failed', { cause: error.message, documentMayHaveChanged: committed })
    } finally {
      if (handle) await handle.close().catch(() => undefined)
      if (!committed) await this.fs.unlink(temporary).catch(() => undefined)
    }
  }

  async createDocument({ documentId, title, eventIds, eventId, content = '' }) {
    if (this.readOnly) return fail('document-read-only')
    const target = this._pathFor(documentId)
    if (!target.ok) return target
    const ids = await this._eventIds({ eventIds, eventId })
    if (!ids.ok) return ids
    if (typeof title !== 'string' || !title.trim() || /[\r\n]/.test(title)) return fail('document-title-invalid')
    if (typeof content !== 'string') return fail('document-content-invalid')
    const root = await this._assertRoot()
    if (!root.ok) return root
    try { await this._readBytes(target.filePath); return fail('document-already-exists') } catch (error) {
      if (error.code !== 'ENOENT') return fail(error.code === 'DOCUMENT_ID_INVALID' ? 'document-id-invalid' : 'document-write-failed')
    }
    const timestamp = this._timestamp()
    const document = { documentId, title: title.trim(), eventIds: ids.value, createdAt: timestamp, updatedAt: timestamp, content }
    const blank = render(document)
    const text = render({ ...document, revision: computeRevision(blank) })
    const written = await this._writeCandidate(target.filePath, text, { createOnly: true })
    if (!written.ok) return written
    return { ...await this.readDocument(documentId), noop: false }
  }

  async updateDocument({ documentId, expectedRevision, eventIds, eventId, changeSet = [] }) {
    if (this.readOnly) return fail('document-read-only')
    const target = this._pathFor(documentId)
    if (!target.ok) return target
    if (!validateRevision(expectedRevision).ok) return fail('document-version-conflict')
    const ids = await this._eventIds({ eventIds, eventId })
    if (!ids.ok) return ids
    const changes = validateChangeSet(changeSet)
    if (!changes.ok) return changes
    const current = await this.readDocument(documentId)
    if (!current.ok) return current
    if (!this._revisionMatches(current.revision, expectedRevision)) return fail('document-version-conflict')
    const next = { title: current.title, eventIds: current.eventIds.join(','), content: current.content }
    for (const change of changes.value) {
      if (!REGIONS.includes(change.regionId)) return fail('changeset-invalid')
      if (next[change.regionId] !== normalizeText(change.beforeText)) return fail('changeset-base-mismatch', { regionId: change.regionId })
      next[change.regionId] = change.regionId === 'eventIds' ? normalizeText(change.afterText).toLowerCase() : normalizeText(change.afterText)
    }
    if (!next.title.trim() || /[\r\n]/.test(next.title)) return fail('document-title-invalid')
    const changedIds = validateEventIds(next.eventIds.split(','))
    if (!changedIds.ok) return changedIds
    if (changedIds.value.join(',') !== ids.value.join(',')) return fail('event-ids-conflict')
    if (next.title === current.title && next.content === current.content && changedIds.value.join(',') === current.eventIds.join(',')) return { ...current, noop: true }
    const document = { documentId, title: next.title, eventIds: ids.value, createdAt: current.createdAt, updatedAt: this._timestamp(), content: next.content }
    const blank = render(document)
    const text = render({ ...document, revision: computeRevision(blank) })
    const written = await this._writeCandidate(target.filePath, text, { createOnly: false, expectedRevision })
    if (!written.ok) return written
    return { ...await this.readDocument(documentId), noop: false }
  }

  async readDocument(documentId) {
    const target = this._pathFor(documentId)
    if (!target.ok) return target
    const root = await this._assertRoot()
    if (!root.ok) return root
    let text
    try { text = await this._readText(target.filePath) } catch (error) {
      if (error.code === 'ENOENT') return fail('document-not-found')
      if (error.code === 'DOCUMENT_ID_INVALID') return fail('document-id-invalid')
      return fail('document-read-failed', { cause: error.message })
    }
    const document = parse(text)
    if (!document) return fail('document-format-invalid')
    if (document.documentId !== documentId) return fail('document-id-invalid')
    const revision = computeRevision(text)
    if (document.revision !== revision) return fail('document-revision-mismatch', { expectedRevision: document.revision, actualRevision: revision })
    return { ok: true, ...document, documentId, text, bytes: Buffer.byteLength(text, 'utf8'), protocolVersion: PROTOCOL_VERSION }
  }

  async listDocuments() {
    const root = await this._assertRoot()
    if (!root.ok) return root
    const documents = []
    const readErrors = []
    for (const entry of await this.fs.readdir(this.rootDir, { withFileTypes: true })) {
      if (!entry.isFile() || entry.isSymbolicLink() || !entry.name.endsWith('.md')) continue
      const documentId = entry.name.slice(0, -3)
      if (!validateDocumentId(documentId).ok) continue
      const document = await this.readDocument(documentId)
      if (document.ok) {
        const { text, content, ...summary } = document
        documents.push(summary)
      } else readErrors.push({ documentId, error: document.error })
    }
    documents.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || a.documentId.localeCompare(b.documentId))
    return { ok: true, documents, readErrors }
  }
}

import * as nodeFs from 'node:fs'
import path from 'node:path'
import { TextDecoder } from 'node:util'
import { fileWithinRoots, pathKey } from '../file-boundary.js'
import { DOCUMENT_MARKER, computeRevision, normalizeText, validateDocumentId, validateEventIds, validateRevision } from './protocol.js'

const decoder = new TextDecoder('utf-8', { fatal: true })

function failure(source, code, error, extra = {}) {
  return { source, code, message: String(error?.message || error), ...extra }
}

/** Synchronous bounded metadata reader for the existing brief/scan pipelines. */
export class LedgerDocBriefScanner {
  constructor({ handoffDir, fs = nodeFs, limit = 64 } = {}) {
    if (typeof handoffDir !== 'string' || !path.isAbsolute(handoffDir)) throw new TypeError('ledger-doc-handoff-invalid')
    this.handoffDir = path.resolve(handoffDir)
    this.documentsDir = path.join(this.handoffDir, 'documents')
    this.fs = fs
    this.limit = Math.max(1, Math.min(256, Math.floor(Number(limit) || 64)))
  }

  _read(rootPhysical, documentsPhysical, name) {
    const documentId = name.slice(0, -3)
    if (!validateDocumentId(documentId).ok) throw Object.assign(new Error('Invalid document ID'), { code: 'document-id-invalid' })
    const target = path.resolve(this.documentsDir, name)
    const physical = fileWithinRoots(target, [rootPhysical], { strict: true })
    if (!physical || path.dirname(physical) !== documentsPhysical) throw Object.assign(new Error('Document path is outside handoff/documents'), { code: 'document-path-invalid' })
    const stat = this.fs.lstatSync(physical)
    if (!stat.isFile() || stat.isSymbolicLink()) throw Object.assign(new Error('Document is not a regular file'), { code: 'document-path-invalid' })
    const bytes = this.fs.readFileSync(physical)
    const text = normalizeText(decoder.decode(bytes))
    const lines = text.split('\n')
    if (lines.length < 9 || !lines[0].startsWith('# ') || !lines[0].slice(2).trim() || lines[1] !== DOCUMENT_MARKER || lines[2] !== 'documentId: ' + documentId || lines[7] !== '') {
      throw Object.assign(new Error('Invalid R4 maintenance document header'), { code: 'document-format-invalid' })
    }
    if (!lines[3].startsWith('eventIds:') || !lines[4].startsWith('createdAt:') || !lines[5].startsWith('updatedAt:') || !lines[6].startsWith('revision:')) {
      throw Object.assign(new Error('Invalid R4 maintenance document metadata'), { code: 'document-format-invalid' })
    }
    const ids = validateEventIds(lines[3].slice('eventIds:'.length).trim().split(','))
    if (!ids.ok || lines[3] !== 'eventIds: ' + ids.value.join(',') || !lines[4].slice('createdAt:'.length).trim() || !lines[5].slice('updatedAt:'.length).trim()) {
      throw Object.assign(new Error('Invalid R4 maintenance document event/timestamp metadata'), { code: 'document-format-invalid' })
    }
    const declared = lines[6].slice('revision:'.length).trim()
    const revision = computeRevision(text)
    if (!validateRevision(declared).ok || declared !== revision) throw Object.assign(new Error('Maintenance document revision mismatch'), { code: 'document-revision-mismatch' })
    return {
      documentId,
      revision,
      eventIds: ids.value,
      title: lines[0].slice(2).trim(),
      createdAt: lines[4].slice('createdAt:'.length).trim(),
      updatedAt: lines[5].slice('updatedAt:'.length).trim(),
      path: physical,
      relativePath: 'handoff/documents/' + name,
      size: stat.size,
      mtimeMs: stat.mtimeMs,
      source: 'workspace',
    }
  }

  scan() {
    const out = { ok: true, state: 'missing', documents: [], readErrors: [], truncated: 0 }
    let rootPhysical
    let documentsPhysical
    let entries
    try {
      rootPhysical = fileWithinRoots(this.handoffDir, [this.handoffDir], { strict: false, allowMissing: true })
      if (!rootPhysical) throw Object.assign(new Error('Invalid handoff root'), { code: 'ledger-doc-handoff-invalid' })
      const rootStat = this.fs.lstatSync(rootPhysical)
      if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) throw Object.assign(new Error('Invalid handoff directory'), { code: 'ledger-doc-handoff-invalid' })
      documentsPhysical = fileWithinRoots(this.documentsDir, [rootPhysical], { strict: true, allowMissing: true })
      if (!documentsPhysical) throw Object.assign(new Error('Invalid documents directory'), { code: 'document-path-invalid' })
      const directoryStat = this.fs.lstatSync(documentsPhysical)
      if (!directoryStat.isDirectory() || directoryStat.isSymbolicLink()) throw Object.assign(new Error('Invalid documents directory'), { code: 'document-path-invalid' })
      entries = this.fs.readdirSync(documentsPhysical, { withFileTypes: true })
        .filter((entry) => entry.name.toLowerCase().endsWith('.md'))
        .sort((a, b) => a.name.localeCompare(b.name))
    } catch (error) {
      if (error?.code === 'ENOENT') return out
      out.ok = false
      out.state = 'error'
      out.readErrors.push(failure('handoff/documents', error?.code || 'brief-scan-failed', error))
      return out
    }
    out.truncated = Math.max(0, entries.length - this.limit)
    const seenPaths = new Set()
    for (const entry of entries.slice(0, this.limit)) {
      try {
        const document = this._read(rootPhysical, documentsPhysical, entry.name)
        const key = pathKey(document.path)
        if (seenPaths.has(key)) continue
        seenPaths.add(key)
        out.documents.push(document)
      } catch (error) {
        const documentId = entry.name.slice(0, -3)
        out.readErrors.push({
          ...failure('handoff/documents/' + entry.name, error?.code || 'document-read-failed', error, { documentId: validateDocumentId(documentId).ok ? documentId : null }),
          path: path.join(this.documentsDir, entry.name),
        })
      }
    }
    out.state = out.documents.length ? 'present' : 'empty'
    out.ok = out.readErrors.length === 0
    return out
  }
}

import * as nodeFs from 'node:fs/promises'
import path from 'node:path'
import { LedgerDocReadSide } from './read-side.js'
import { fileWithinRoots } from '../file-boundary.js'
import { normalizeText } from './protocol.js'
import { decodeBaselineDocumentPre } from '../team-baseline.js'

const failure = (reason, extra = {}) => ({ ok: false, reason, ...extra })
const docsOf = (files) => Object.keys(files).filter((name) => name.startsWith('documents/')).sort()

/** Read all valid current maintenance documents for an explicit user upload. */
export async function readBaselineDocumentsForUploadPre({ handoffDir, fs = nodeFs } = {}) {
  try {
    if (typeof handoffDir !== 'string' || !path.isAbsolute(handoffDir)) return failure('handoff-root-invalid')
    const root = fileWithinRoots(handoffDir, [handoffDir], { strict: false, allowMissing: true })
    if (!root) return failure('handoff-root-invalid')
    const documentsDir = path.join(root, 'documents')
    try {
      const directory = await fs.lstat(documentsDir)
      if (!directory.isDirectory() || directory.isSymbolicLink()) return failure('document-path-invalid')
      const entries = await fs.readdir(documentsDir, { withFileTypes: true })
      for (const entry of entries) {
        if (entry.isSymbolicLink() || (entry.name.endsWith('.md') && !entry.isFile())) return failure('document-path-invalid', { source: 'documents/' + entry.name })
      }
    } catch (error) {
      if (error.code !== 'ENOENT') return failure('document-read-failed: ' + String(error.message))
    }
    const reader = new LedgerDocReadSide({ handoffDir, fs })
    const listed = await reader.list()
    if (!listed.ok || listed.readErrors.length) return failure('document-read-failed', { readErrors: listed.readErrors })
    const files = {}
    for (const document of listed.documents) {
      // _read has already validated identity, association and revision. Re-read the
      // same physical file for the exact bytes carried by the baseline.
      const physical = fileWithinRoots(document.path, [root], { strict: true })
      if (!physical) return failure('document-path-invalid', { documentId: document.documentId })
      const text = await fs.readFile(physical, 'utf8')
      const checked = decodeBaselineDocumentPre('documents/' + document.documentId + '.md', text)
      if (!checked.ok) return failure(checked.reason, { documentId: document.documentId })
      files['documents/' + document.documentId + '.md'] = text
    }
    return { ok: true, files, documents: listed.documents.map((document) => ({ documentId: document.documentId, revision: document.revision, eventIds: document.eventIds })) }
  } catch (error) { return failure('document-read-failed: ' + String(error?.message || error)) }
}

/** Resolve every document before any pause, backup or write. */
export async function planBaselineDocumentsPre({ files, handoffDir, resolutions = {}, fs = nodeFs } = {}) {
  const targets = {}
  const filesToWrite = { ...files }
  const documents = docsOf(files)
  const audit = []
  if (!documents.length) return { ok: true, targets, filesToWrite, audit, documents: [] }
  if (typeof handoffDir !== 'string' || !path.isAbsolute(handoffDir)) return failure('handoff-root-invalid')
  const reader = new LedgerDocReadSide({ handoffDir, fs })
  const conflicts = []
  for (const name of documents) {
    const documentId = name.slice('documents/'.length, -3)
    const checked = decodeBaselineDocumentPre(name, files[name])
    if (!checked.ok) return failure(checked.reason, { documentId })
    const target = path.join(handoffDir, 'documents', documentId + '.md')
    const documentsPhysical = fileWithinRoots(path.dirname(target), [handoffDir], { strict: true, allowMissing: true })
    if (!documentsPhysical) return failure('document-path-invalid', { documentId })
    const targetPhysical = path.join(documentsPhysical, path.basename(target))
    targets[name] = targetPhysical
    const choice = resolutions[documentId] ?? resolutions[name] ?? null
    let current = null
    try { current = await fs.lstat(target) } catch (error) { if (error.code !== 'ENOENT') return failure('document-read-failed: ' + String(error.message), { documentId }) }
    if (!current) {
      filesToWrite[name] = files[name]
      audit.push({ documentId, revision: checked.document.revision, action: 'write-new', localRevision: null })
      continue
    }
    if (!current.isFile() || current.isSymbolicLink() || !fileWithinRoots(target, [handoffDir], { strict: true })) return failure('document-path-invalid', { documentId })
    let local
    try { local = await reader._read(documentId) } catch (error) { return failure('document-conflict-unreadable', { documentId, error: String(error.message) }) }
    if (local.revision === checked.document.revision && normalizeText(local.text) === normalizeText(files[name])) {
      delete filesToWrite[name]
      audit.push({ documentId, revision: checked.document.revision, localRevision: local.revision, action: 'noop' })
      continue
    }
    const conflict = { documentId, localRevision: local.revision, remoteRevision: checked.document.revision, choice }
    if (!choice) { conflicts.push(conflict); continue }
    if (choice === 'local') {
      delete filesToWrite[name]
      audit.push({ ...conflict, action: 'keep-local' })
    } else if (choice === 'remote') {
      filesToWrite[name] = files[name]
      audit.push({ ...conflict, action: 'overwrite-remote' })
    } else return failure('document-resolution-invalid', { documentId, choice })
  }
  if (conflicts.length) return failure('document-conflict', { conflicts, documents: documents.map((name) => name.slice('documents/'.length, -3)) })
  return { ok: true, targets, filesToWrite, audit, documents: documents.map((name) => decodeBaselineDocumentPre(name, files[name]).document) }
}

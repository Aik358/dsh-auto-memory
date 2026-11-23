import { readFile as readRawFile } from 'node:fs/promises'
import { DOCUMENT_MARKER, computeOperationDigest, computeRevision, normalizeText, validateChangeSet, validateDocumentId, validateEventIds, validateOpId, validateRevision } from './protocol.js'

const LF = String.fromCharCode(10)
const REGIONS = ['title', 'eventIds', 'content']
const fail = (error, extra = {}) => ({ ok: false, error, ...extra })
const cause = (error) => error instanceof Error ? error.message : String(error)

function render(document) {
  return [
    '# ' + document.title, DOCUMENT_MARKER, 'documentId: ' + document.documentId,
    'eventIds: ' + document.eventIds.join(','), 'createdAt: ' + document.createdAt,
    'updatedAt: ' + document.updatedAt, 'revision: ' + (document.revision || ''), '',
    normalizeText(document.content), '',
  ].join(LF)
}
function operationDigest(operation) {
  return computeOperationDigest({
    schema: 'r4-ledger-wal-v1', documentId: operation.documentId,
    expectedRevision: operation.expectedRevision, eventIds: operation.eventIds,
    candidateRevision: operation.candidateRevision,
    changeSetDigest: computeOperationDigest(operation.changeSet),
  })
}
function preparedPayload(operation) {
  return {
    schema: 'r4-ledger-wal-v1', documentId: operation.documentId,
    eventIds: operation.eventIds, baseRevision: operation.expectedRevision,
    expectedRevision: operation.expectedRevision, candidateRevision: operation.candidateRevision,
    operationDigest: operation.operationDigest, changeSet: operation.changeSet,
    updatedAt: operation.updatedAt,
    sections: { goal: 'Synthetic ledger update', doing: '', deadend: '', next: '' },
    summary: 'Synthetic R4 WAL operation',
  }
}

/** Isolated append-only WAL. The supplied event sink owns its event locks. */
export class LedgerWal {
  constructor(store, eventSink, options = {}) {
    if (!store || typeof store.withDocumentLock !== 'function' || !store.store) throw new TypeError('wal-store-invalid')
    if (!eventSink || typeof eventSink.append !== 'function' || typeof eventSink.listCheckpoints !== 'function') throw new TypeError('wal-event-sink-invalid')
    this.store = store
    this.eventSink = eventSink
    this.now = options.now || (() => new Date().toISOString())
  }

  _document(documentId) {
    const target = this.store.store._pathFor(documentId)
    return target.ok ? target : fail('document-id-invalid')
  }
  async _append(eventId, phase, operation, checkpoint) {
    try {
      const result = await this.eventSink.append(eventId, {
        phase, opId: operation.opId, operationDigest: operation.operationDigest, checkpoint,
      })
      if (!result?.ok) return fail(result?.error || 'event-append-failed', { eventId, phase, cause: result?.cause })
      return { ok: true, eventId, phase, checkpointId: result.checkpointId, deduped: result.deduped === true, checkpoint: result.checkpoint }
    } catch (error) {
      return fail('event-append-failed', { eventId, phase, cause: cause(error) })
    }
  }
  async _prepare(input) {
    if (!validateDocumentId(input?.documentId).ok) return fail('document-id-invalid')
    const ids = validateEventIds(input?.eventIds)
    if (!ids.ok) return ids
    if (!validateOpId(input?.opId).ok) return fail('op-id-invalid')
    if (!validateRevision(input?.expectedRevision).ok) return fail('revision-invalid')
    const changes = validateChangeSet(input?.changeSet)
    if (!changes.ok) return changes
    const current = await this.store.readDocument(input.documentId)
    if (!current.ok) return fail(current.error, { cause: current.cause })
    if (current.revision !== input.expectedRevision) return fail('document-version-conflict')
    if (current.eventIds.join(',') !== ids.value.join(',')) return fail('event-ids-conflict')
    const next = { title: current.title, eventIds: current.eventIds.join(','), content: current.content }
    for (const change of changes.value) {
      if (!REGIONS.includes(change.regionId)) return fail('changeset-invalid')
      if (next[change.regionId] !== normalizeText(change.beforeText)) return fail('changeset-base-mismatch', { regionId: change.regionId })
      next[change.regionId] = change.regionId === 'eventIds' ? normalizeText(change.afterText).toLowerCase() : normalizeText(change.afterText)
    }
    const originalCandidate = { title: next.title, content: next.content, eventIds: ids.value }
    if (!originalCandidate.title.trim() || originalCandidate.title.includes(String.fromCharCode(13)) || originalCandidate.title.includes(LF)) return fail('document-title-invalid')
    const changedIds = validateEventIds(next.eventIds.split(','))
    if (!changedIds.ok || changedIds.value.join(',') !== ids.value.join(',')) return fail('event-ids-conflict')
    const missing = REGIONS.filter((region) => next[region] !== (region === 'eventIds' ? current.eventIds.join(',') : current[region]) && !changes.value.some((change) => change.regionId === region))
    if (missing.length) return fail('changeset-invalid', { missing })
    if (REGIONS.every((region) => next[region] === (region === 'eventIds' ? current.eventIds.join(',') : current[region]))) return { ok: true, noop: true, document: current }
    const updatedAt = new Date(this.now()).toISOString()
    if (!Number.isFinite(new Date(updatedAt).getTime())) return fail('document-clock-invalid')
    if (originalCandidate.title !== next.title.trim()) return fail('changeset-invalid', { reason: 'title-trim-not-preserved' })
    const candidate = { documentId: input.documentId, title: originalCandidate.title, eventIds: ids.value, createdAt: current.createdAt, updatedAt, content: originalCandidate.content }
    const candidateRevision = computeRevision(render({ ...candidate, revision: '' }))
    if (new Date(updatedAt).toISOString() !== updatedAt) throw new TypeError('document-clock-invalid')
    const operation = {
      documentId: input.documentId, eventIds: ids.value, expectedRevision: input.expectedRevision,
      changeSet: changes.value, opId: input.opId, candidateRevision, updatedAt,
    }
    operation.operationDigest = operationDigest(operation)
    return { ok: true, noop: false, operation, current }
  }

  async _commitPrepared(operation) {
    return this.store.withDocumentLock(operation.documentId, async () => {
      const current = await this.store.store.readDocument(operation.documentId)
      if (!current.ok) return fail(current.error || 'document-read-failed', { cause: current.cause })
      if (current.revision === operation.candidateRevision) return { ok: true, document: current, alreadyTarget: true }
      if (current.revision !== operation.expectedRevision) return fail('document-version-conflict', { actualRevision: current.revision })
      const next = { title: current.title, eventIds: current.eventIds.join(','), content: current.content }
      for (const change of operation.changeSet) {
        if (next[change.regionId] !== normalizeText(change.beforeText)) return fail('changeset-base-mismatch', { regionId: change.regionId })
        next[change.regionId] = change.regionId === 'eventIds' ? normalizeText(change.afterText).toLowerCase() : normalizeText(change.afterText)
      }
      const candidate = { documentId: operation.documentId, title: next.title.trim(), eventIds: operation.eventIds, createdAt: current.createdAt, updatedAt: operation.updatedAt, content: next.content }
      const text = render({ ...candidate, revision: operation.candidateRevision })
      if (computeRevision(text) !== operation.candidateRevision) return fail('candidate-revision-mismatch')
      const target = this._document(operation.documentId)
      if (!target.ok) return target
      const written = await this.store.store._writeCandidate(target.filePath, text, { createOnly: false, expectedRevision: operation.expectedRevision })
      if (!written.ok) return written
      if (written.revision !== operation.candidateRevision) return fail('candidate-revision-mismatch', { actualRevision: written.revision })
      const readback = await this.store.store.readDocument(operation.documentId)
      if (!readback.ok) return fail('document-readback-failed', { cause: readback.cause, documentMayHaveChanged: true })
      if (readback.revision !== operation.candidateRevision || readback.text !== text) return fail('candidate-revision-mismatch', { actualRevision: readback.revision })
      return { ok: true, document: readback, written }
    })
  }
  async _actual(documentId) {
    const actual = await this.store.store.readDocument(documentId)
    if (actual.ok) return actual
    // Readback failure does not erase evidence of a successful atomic rename.
    const target = this._document(documentId)
    if (target.ok) {
      try {
        const text = normalizeText(await readRawFile(target.filePath, 'utf8'))
        return { ok: false, actualRevision: computeRevision(text), text, readError: actual.error, cause: actual.cause }
      } catch (_) { /* Report unreadable below without hiding the original error. */ }
    }
    return { ok: false, actualRevision: null, readError: actual.error, cause: actual.cause }
  }
  async _terminal(operation, prepared, phase, document, error = null) {
    const results = []
    for (const ready of prepared) {
      const checkpoint = {
        kind: 'wal-' + phase, documentId: operation.documentId,
        revision: document?.revision || document?.actualRevision || null,
        candidateRevision: operation.candidateRevision,
        preparedCheckpointId: ready.checkpointId, operationDigest: operation.operationDigest,
        changeSet: operation.changeSet, errorCode: error?.error || null,
        documentCommitted: phase === 'committed',
      }
      results.push(await this._append(ready.eventId, phase, operation, checkpoint))
    }
    return results
  }
  async _postCommit(document, options) {
    let indexStale = false
    let cacheStale = false
    if (typeof options.reindex === 'function') {
      let indexed
      try { indexed = await this.store.withIndexLock(options.indexPath || this.store.store.rootDir + '/index.json', () => options.reindex(document)) }
      catch (error) { indexed = fail('index-write-failed', { cause: cause(error) }) }
      if (!indexed?.ok) indexStale = true
    }
    if (typeof options.refreshCache === 'function') {
      try { const refreshed = await options.refreshCache(document); if (refreshed?.ok === false) cacheStale = true }
      catch (_) { cacheStale = true }
    }
    return { indexStale, cacheStale }
  }

  async execute(input, options = {}) {
    const preparedPhase = await this._prepare(input)
    if (!preparedPhase.ok) return fail(preparedPhase.error, { phase: 0, documentCommitted: false, eventComplete: false, cause: preparedPhase.cause })
    if (preparedPhase.noop) return { ...preparedPhase.document, ok: true, noop: true, phase: 0, documentCommitted: true, eventComplete: true, events: [] }
    const operation = preparedPhase.operation
    const prepared = []
    const eventResults = []
    for (const eventId of operation.eventIds) {
      const result = await this._append(eventId, 'prepared', operation, { kind: 'wal-prepared', ...preparedPayload(operation) })
      eventResults.push(result)
      if (!result.ok) return fail('aborted-before-document', { phase: 1, documentCommitted: false, eventComplete: false, prepared, events: eventResults, operation })
      prepared.push(result)
    }
    let committedDocument
    try { committedDocument = await this._commitPrepared(operation) }
    catch (error) { committedDocument = fail('document-write-failed', { cause: cause(error) }) }
    if (committedDocument.error === 'document-version-conflict') {
      return fail('document-version-conflict', { phase: 2, documentCommitted: false, eventComplete: false, prepared, events: eventResults, actualRevision: committedDocument.actualRevision, operation })
    }
    if (!committedDocument.ok) {
      const actual = await this._actual(operation.documentId)
      const failed = await this._terminal(operation, prepared, 'failed', actual, committedDocument)
      return fail(committedDocument.error || 'document-write-failed', {
        phase: 3, documentCommitted: (actual.revision || actual.actualRevision) === operation.candidateRevision,
        eventComplete: failed.every((item) => item.ok), prepared, failed, events: [...eventResults, ...failed],
        actualRevision: actual.revision || actual.actualRevision || null, actualReadError: actual.readError,
        changeSet: operation.changeSet, operation, cause: committedDocument.cause,
      })
    }
    const committed = await this._terminal(operation, prepared, 'committed', committedDocument.document)
    eventResults.push(...committed)
    if (!committed.every((item) => item.ok)) {
      return fail('event-commit-failed', { phase: 3, documentCommitted: true, eventComplete: false, document: committedDocument.document, prepared, committed, events: eventResults, operation })
    }
    const post = await this._postCommit(committedDocument.document, options)
    if (post.indexStale || post.cacheStale) return fail(post.indexStale ? 'index-write-failed' : 'cache-refresh-failed', { phase: 3, documentCommitted: true, eventComplete: true, ...post, document: committedDocument.document, prepared, committed, events: eventResults, operation })
    return { ok: true, noop: false, phase: 3, documentCommitted: true, eventComplete: true, ...post, document: committedDocument.document, prepared, committed, events: eventResults, operation }
  }

  async _recover(opId) {
    const checkpoints = await this.eventSink.listCheckpoints(opId)
    const prepared = checkpoints.filter((item) => item.phase === 'prepared')
    if (!prepared.length) return fail('wal-prepared-missing', { opId, checkpoints })
    const first = prepared[0]
    const ids = validateEventIds(first.eventIds)
    if (!ids.ok) return fail('event-id-unavailable')
    if (prepared.length !== ids.value.length || ids.value.some((id) => !prepared.some((item) => item.eventId === id))) return fail('wal-prepared-incomplete')
    const operation = {
      opId, documentId: first.documentId, eventIds: ids.value, expectedRevision: first.baseRevision,
      candidateRevision: first.candidateRevision, changeSet: first.changeSet, updatedAt: first.updatedAt,
      operationDigest: first.operationDigest,
    }
    if (!validateOpId(opId).ok || !validateRevision(operation.expectedRevision).ok || !validateRevision(operation.candidateRevision).ok || !validateChangeSet(operation.changeSet).ok) return fail('wal-prepared-invalid')
    if (!Array.isArray(operation.changeSet) || operation.changeSet.some((change) => !change || !REGIONS.includes(change.regionId))) return fail('wal-prepared-invalid', { reason: 'changed-regions-missing' })
    const recoveredDigest = operationDigest(operation)
    if (recoveredDigest !== first.operationDigest) return fail('op-payload-mismatch', { expectedDigest: first.operationDigest, actualDigest: recoveredDigest, operation })
    if (prepared.some((item) => item.operationDigest !== operation.operationDigest || item.documentId !== operation.documentId || item.candidateRevision !== operation.candidateRevision)) return fail('op-payload-mismatch')
    return { ok: true, operation, prepared, checkpoints }
  }

  async replay(opId, options = {}) {
    const recovered = await this._recover(opId)
    if (!recovered.ok) return recovered
    const { operation, prepared, checkpoints } = recovered
    if (checkpoints.some((item) => item.phase === 'failed')) return fail('wal-operation-failed', { operation, prepared, failed: checkpoints.filter((item) => item.phase === 'failed') })
    const ready = prepared.map((item) => ({ ok: true, eventId: item.eventId, checkpointId: item.checkpointId, checkpoint: item }))
    const hasCommitted = (eventId) => checkpoints.some((item) => item.phase === 'committed' && item.eventId === eventId)
    const allCommitted = operation.eventIds.every(hasCommitted)
    const document = await this._actual(operation.documentId)
    if (allCommitted && document.revision === operation.candidateRevision) {
      return { ok: true, replayed: true, noop: true, documentCommitted: true, eventComplete: true, operation, prepared, committed: checkpoints.filter((item) => item.phase === 'committed') }
    }
    if (allCommitted) return fail('wal-committed-document-mismatch', { actualRevision: document.revision || null, operation })
    let written
    try { written = await this._commitPrepared(operation) } catch (error) { written = fail('document-write-failed', { cause: cause(error) }) }
    if (!written.ok) {
      if (written.error === 'document-version-conflict') return fail(written.error, { operation, prepared, actualRevision: written.actualRevision })
      const actual = await this._actual(operation.documentId)
      const failed = await this._terminal(operation, ready, 'failed', actual, written)
      return fail(written.error, { operation, prepared, failed, actualRevision: actual.revision || actual.actualRevision || null, documentCommitted: actual.revision === operation.candidateRevision, eventComplete: failed.every((item) => item.ok) })
    }
    const committed = []
    for (const readyItem of ready) {
      if (hasCommitted(readyItem.eventId)) continue
      const appended = await this._append(readyItem.eventId, 'committed', operation, {
        kind: 'wal-committed', documentId: operation.documentId, revision: written.document.revision,
        candidateRevision: operation.candidateRevision, preparedCheckpointId: readyItem.checkpointId,
        operationDigest: operation.operationDigest, changeSet: operation.changeSet, errorCode: null, documentCommitted: true,
      })
      committed.push(appended)
      if (!appended.ok) return fail('event-commit-failed', { documentCommitted: true, eventComplete: false, operation, prepared, committed, document: written.document })
    }
    const post = await this._postCommit(written.document, options)
    return { ok: !post.indexStale && !post.cacheStale, replayed: true, noop: written.alreadyTarget === true, documentCommitted: true, eventComplete: true, ...post, operation, prepared, committed, document: written.document }
  }

  async reconcile(options = {}) {
    const operations = await this.eventSink.operations()
    const results = []
    for (const { opId } of operations) {
      if (options.opIds && !options.opIds.includes(opId)) continue
      results.push(await this.replay(opId, options))
    }
    return { ok: results.every((item) => item.ok), count: results.length, recovered: results.filter((item) => item.ok).length, attention: results.filter((item) => !item.ok).length, results }
  }
}

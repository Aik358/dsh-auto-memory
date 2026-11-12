import * as nodeFs from 'node:fs/promises'
import path from 'node:path'
import { TextDecoder } from 'node:util'
import { computeLegacyCheckpointKey, computeOperationDigest, validateCheckpointId, validateEventIds } from './protocol.js'

const decoder = new TextDecoder('utf-8', { fatal: true })
const CURSOR_SCHEMA = 'r4-history-cursor-v1'
const MAX_LIMIT = 500
const MAX_RANGE_DAYS = 3700
const DAY_MS = 86400000

export class HistoryQueryError extends Error {
  constructor(code, message) {
    super(message)
    this.name = 'HistoryQueryError'
    this.code = code
  }
}

function inside(root, candidate) {
  const relative = path.relative(root, candidate)
  return relative !== '' && relative !== '..' && !relative.startsWith('..' + path.sep) && !path.isAbsolute(relative)
}

function partsAt(ms, timeZone) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  }).formatToParts(new Date(ms))
  const result = {}
  for (const part of parts) if (part.type !== 'literal') result[part.type] = Number(part.value)
  return result
}

function zonedMs({ year, month, day, hour = 0, minute = 0, second = 0, millisecond = 0 }, timeZone) {
  const guess = Date.UTC(year, month - 1, day, hour, minute, second, millisecond)
  if (!Number.isFinite(guess)) throw new HistoryQueryError('history-time-invalid', 'Invalid calendar time')
  const actual = partsAt(guess, timeZone)
  const asUtc = Date.UTC(actual.year, actual.month - 1, actual.day, actual.hour, actual.minute, actual.second, millisecond)
  const candidate = guess - (asUtc - guess)
  const check = partsAt(candidate, timeZone)
  for (const key of ['year', 'month', 'day', 'hour', 'minute', 'second']) {
    if (check[key] !== (key === 'month' ? month : key === 'day' ? day : key === 'year' ? year : key === 'hour' ? hour : key === 'minute' ? minute : second)) {
      throw new HistoryQueryError('history-time-invalid', 'Local time does not exist in ' + timeZone)
    }
  }
  return candidate
}

function validDay(year, month, day) {
  const date = new Date(Date.UTC(year, month - 1, day))
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
}

export function parseHistoryTime(value, timeZone = 'UTC') {
  try { new Intl.DateTimeFormat('en-US', { timeZone }).format() } catch (_) {
    throw new HistoryQueryError('history-timezone-invalid', 'Invalid IANA time zone')
  }
  if (typeof value !== 'string' || !value) throw new HistoryQueryError('history-time-required', 'Explicit ISO time or date required')
  let match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  if (match) {
    const [year, month, day] = match.slice(1).map(Number)
    if (!validDay(year, month, day)) throw new HistoryQueryError('history-time-invalid', 'Invalid calendar date')
    return zonedMs({ year, month, day }, timeZone)
  }
  match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?(Z|[+-]\d{2}:\d{2})$/.exec(value)
  if (!match) throw new HistoryQueryError('history-timezone-required', 'Datetime must carry Z or an explicit UTC offset')
  const [year, month, day, hour, minute, second = 0, fraction = '0', zone] = match.slice(1)
  const values = [year, month, day, hour, minute, second].map(Number)
  if (!validDay(...values.slice(0, 3)) || values[3] > 23 || values[4] > 59 || values[5] > 59) throw new HistoryQueryError('history-time-invalid', 'Invalid ISO datetime')
  const utc = Date.UTC(values[0], values[1] - 1, values[2], values[3], values[4], values[5], Number(fraction.padEnd(3, '0')))
  if (zone === 'Z') return utc
  const offset = /^([+-])(\d{2}):(\d{2})$/.exec(zone)
  const offsetHour = Number(offset[2])
  const offsetMinute = Number(offset[3])
  if (offsetHour > 14 || offsetMinute > 59) throw new HistoryQueryError('history-time-invalid', 'Invalid UTC offset')
  return utc - (offset[1] === '+' ? 1 : -1) * (offsetHour * 60 + offsetMinute) * 60000
}

function nextDate(date) {
  const [year, month, day] = date.split('-').map(Number)
  return new Date(Date.UTC(year, month - 1, day) + DAY_MS).toISOString().slice(0, 10)
}

function dateAt(ms, timeZone) {
  const parts = partsAt(ms, timeZone)
  return String(parts.year).padStart(4, '0') + '-' + String(parts.month).padStart(2, '0') + '-' + String(parts.day).padStart(2, '0')
}

function queryError(source, code, message, extra = {}) {
  return { source, code, message, ...extra }
}

export class LedgerHistoryQuery {
  constructor({ rootDir, eventStorePath, logsDir, archiveDir, timeZone = 'UTC', readOnly = false, fs = nodeFs, trustedMemoryRoot = null } = {}) {
    if (typeof rootDir !== 'string' || !path.isAbsolute(rootDir)) throw new HistoryQueryError('history-root-invalid', 'rootDir must be an absolute isolated path')
    this.rootDir = path.resolve(rootDir)
    this.artifactsDir = path.resolve(process.cwd(), 'artifacts')
    // ★R4 A1 修正（task-2）：与 LedgerDocSystem 同源的显式受控授权（缺省行为不变）。
    this.trustedMemoryRoot = (typeof trustedMemoryRoot === 'string' && trustedMemoryRoot && path.isAbsolute(trustedMemoryRoot)) ? path.resolve(trustedMemoryRoot) : null
    this.roots = this.trustedMemoryRoot ? [this.artifactsDir, this.trustedMemoryRoot] : [this.artifactsDir]
    this.readOnly = readOnly === true
    if (!this.readOnly && !this.roots.some((r) => inside(r, this.rootDir))) throw new HistoryQueryError('history-root-invalid', 'History sources must remain in artifacts')
    this.eventStorePath = path.resolve(eventStorePath || path.join(this.rootDir, 'events.json'))
    this.logsDir = path.resolve(logsDir || path.join(this.rootDir, 'logs'))
    this.archiveDir = archiveDir === undefined ? path.join(this.rootDir, 'archive') : archiveDir == null ? null : path.resolve(archiveDir)
    for (const candidate of [this.eventStorePath, this.logsDir, ...(this.archiveDir ? [this.archiveDir] : [])]) {
      if (!inside(this.rootDir, candidate)) throw new HistoryQueryError('history-root-invalid', 'History source escapes rootDir')
    }
    this.timeZone = timeZone
    try { new Intl.DateTimeFormat('en-US', { timeZone }).format() } catch (_) {
      throw new HistoryQueryError('history-timezone-invalid', 'Invalid IANA time zone')
    }
    this.fs = fs
  }

  async _read(source) {
    const realRoots = []
    for (const r of this.roots) { try { realRoots.push(await this.fs.realpath(r)) } catch (_) { /* 授权根不存在 ⇒ 不参与判定 */ } }
    const artifactsReal = this.readOnly ? await this.fs.realpath(this.rootDir) : (realRoots[0] || this.artifactsDir)
    const rootStat = await this.fs.lstat(this.rootDir)
    const rootReal = await this.fs.realpath(this.rootDir)
    if (!rootStat.isDirectory() || rootStat.isSymbolicLink() || (!this.readOnly && !realRoots.some((r) => inside(r, rootReal)))) throw new Error('history-root-invalid')
    const stat = await this.fs.lstat(source)
    const physical = await this.fs.realpath(source)
    if (!stat.isFile() || stat.isSymbolicLink() || !inside(rootReal, physical)) throw new Error('history-source-outside-root')
    return decoder.decode(await this.fs.readFile(physical))
  }

  _eventRecords(text, source, readErrors) {
    let store
    try { store = JSON.parse(text) } catch (error) {
      readErrors.push(queryError(source, 'event-store-invalid-json', error.message))
      return []
    }
    if (!store || !Array.isArray(store.events)) {
      readErrors.push(queryError(source, 'event-store-invalid-shape', 'events must be an array'))
      return []
    }
    const records = []
    for (const event of store.events) {
      if (!event || validateEventIds([event.id]).error) {
        readErrors.push(queryError(source, 'event-id-invalid', 'Event must have a valid exact ID'))
        continue
      }
      if (!Array.isArray(event.checkpoints)) {
        readErrors.push(queryError(source, 'event-checkpoints-invalid', 'checkpoints must be an array', { eventId: event.id }))
        continue
      }
      event.checkpoints.forEach((cp, checkpointIndex) => {
        if (!cp || typeof cp !== 'object' || typeof cp.at !== 'number' || !Number.isFinite(cp.at)) {
          readErrors.push(queryError(source, 'checkpoint-invalid', 'Checkpoint must have finite numeric at', { eventId: event.id, checkpointIndex }))
          return
        }
        const hasCheckpointId = cp.checkpointId != null
        const validCheckpointId = hasCheckpointId && validateCheckpointId(cp.checkpointId).ok
        if (hasCheckpointId && !validCheckpointId) readErrors.push(queryError(source, 'checkpoint-id-invalid', 'Malformed persisted checkpointId', { eventId: event.id, checkpointIndex }))
        const quad = { goal: cp.goal ?? '', state: cp.state ?? '', dead: cp.dead ?? '', next: cp.next ?? '' }
        records.push({
          eventId: event.id, checkpointId: validCheckpointId ? cp.checkpointId : null,
          at: cp.at, kind: typeof cp.kind === 'string' ? cp.kind : 'log', text: typeof cp.text === 'string' ? cp.text : '',
          sourceRef: cp.sourceRef ?? null, opId: cp.opId ?? null,
          quad,
          legacyCheckpointKey: validCheckpointId ? null : computeLegacyCheckpointKey({ ...cp, eventId: event.id, checkpointIndex, quad }),
          identityMode: validCheckpointId ? 'persisted' : 'legacy-derived',
          targetRevision: cp.targetRevision ?? cp.candidateRevision ?? cp.revision ?? null,
          recoveryPointer: cp.recoveryPointer ?? cp.rel ?? cp.sourceRef ?? null,
          quoteLine: cp.quoteLine ?? null, bytes: cp.bytes ?? null, sha256: cp.sha256 ?? null,
          checkpointIndex, source: { type: 'event-checkpoint', path: 'events.json' }, ordinal: checkpointIndex,
        })
      })
    }
    return records
  }

  _logRecords(text, source, date, readErrors) {
    const records = []
    text.split(/\r\n|\r|\n/).forEach((line, index) => {
      if (!line.startsWith('- ')) return
      const match = /^- (\d{2}:\d{2}(?::\d{2})?) \[kind:([a-z0-9-]+)\]\s*(.*)$/.exec(line)
      if (!match) {
        readErrors.push(queryError(source, 'log-entry-invalid', 'Malformed log entry', { line: index + 1 }))
        return
      }
      const [hour, minute, second = 0] = match[1].split(':').map(Number)
      if (hour > 23 || minute > 59 || second > 59) {
        readErrors.push(queryError(source, 'log-entry-invalid', 'Invalid local time', { line: index + 1 }))
        return
      }
      const [year, month, day] = date.split('-').map(Number)
      let at
      try { at = zonedMs({ year, month, day, hour, minute, second }, this.timeZone) } catch (error) {
        readErrors.push(queryError(source, 'log-entry-invalid', error.message, { line: index + 1 }))
        return
      }
      const body = match[3].split('<!--')[0].trimEnd()
      const eventMatch = /(?:^|\s)(?:eventId=|#)(evt_[0-9a-f]{8})(?:\s|$)/.exec(body)
      const opMatch = /(?:^|\s)opId=(r4op_[0-9a-f]{32})(?:\s|$)/.exec(body)
      records.push({
        eventId: eventMatch ? eventMatch[1] : null, checkpointId: null,
        at, kind: match[2], text: body, sourceRef: source + '#L' + (index + 1), opId: opMatch ? opMatch[1] : null,
        quad: null, legacyCheckpointKey: null, identityMode: 'daily-log-entry',
        targetRevision: null, recoveryPointer: source + '#L' + (index + 1),
        quoteLine: index + 1, bytes: null, sha256: null,
        checkpointIndex: null, source: { type: source.startsWith('archive/') ? 'archive-log' : 'daily-log', path: source }, ordinal: index,
      })
    })
    return records
  }

  async query({ from, to, eventId, kinds, cursor, limit = 100, includeQuad = false } = {}) {
    if (typeof eventId !== 'undefined') {
      const checked = validateEventIds([eventId])
      if (!checked.ok || checked.value[0] !== eventId) throw new HistoryQueryError('history-event-id-invalid', 'eventId must be exact and well formed')
    }
    if (typeof kinds !== 'undefined' && (!Array.isArray(kinds) || !kinds.length || kinds.some((kind) => typeof kind !== 'string' || !/^[a-z][a-z0-9-]{0,63}$/.test(kind)))) {
      throw new HistoryQueryError('history-kinds-invalid', 'kinds must be a nonempty array of kind names')
    }
    if (typeof includeQuad !== 'boolean') throw new HistoryQueryError('history-include-quad-invalid', 'includeQuad must be boolean')
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > MAX_LIMIT) throw new HistoryQueryError('history-limit-invalid', 'limit must be an integer in [1,500]')
    const fromMs = parseHistoryTime(from, this.timeZone)
    const toMs = parseHistoryTime(to, this.timeZone)
    if (fromMs >= toMs) throw new HistoryQueryError('history-range-invalid', 'from must be earlier than to')
    const selectedKinds = kinds ? [...new Set(kinds)].sort() : null
    const signature = computeOperationDigest({ schema: CURSOR_SCHEMA, fromMs, toMs, eventId: eventId ?? null, kinds: selectedKinds, timeZone: this.timeZone })
    let after = null
    if (cursor !== undefined && cursor !== null) {
      try {
        const decoded = JSON.parse(Buffer.from(String(cursor), 'base64url').toString('utf8'))
        if (decoded.schema !== CURSOR_SCHEMA || decoded.signature !== signature || !decoded.after || !Number.isFinite(decoded.after.at)) throw new Error('cursor mismatch')
        const key = decoded.after
        if ((key.eventId !== null && validateEventIds([key.eventId]).error) ||
          (key.checkpointIndex !== null && (!Number.isSafeInteger(key.checkpointIndex) || key.checkpointIndex < 0)) ||
          !Number.isSafeInteger(key.ordinal) || key.ordinal < 0 || !key.source ||
          !['event-checkpoint', 'daily-log', 'archive-log'].includes(key.source.type) || typeof key.source.path !== 'string' || !key.source.path) throw new Error('cursor key invalid')
        after = key
      } catch (_) { throw new HistoryQueryError('history-cursor-invalid', 'Cursor is malformed or belongs to another query') }
    }
    const readErrors = []
    const coveredSources = []
    const records = []
    let eventText = null
    try { eventText = await this._read(this.eventStorePath) } catch (error) {
      readErrors.push(queryError('events.json', 'event-store-read-failed', error.message))
    }
    if (eventText !== null) {
      const found = this._eventRecords(eventText, 'events.json', readErrors)
      records.push(...found)
      coveredSources.push({ type: 'event-store', path: 'events.json', status: readErrors.some((error) => error.source === 'events.json') ? 'error' : 'read', recordsRead: found.length })
    } else coveredSources.push({ type: 'event-store', path: 'events.json', status: 'error', recordsRead: 0 })
    for (const [dir, label] of [[this.logsDir, 'logs'], ...(this.archiveDir ? [[this.archiveDir, 'archive']] : [])]) {
      let date = dateAt(fromMs, this.timeZone)
      let days = 0
      while (zonedMs({ year: Number(date.slice(0, 4)), month: Number(date.slice(5, 7)), day: Number(date.slice(8, 10)) }, this.timeZone) < toMs) {
        if (++days > MAX_RANGE_DAYS) throw new HistoryQueryError('history-range-too-large', 'Range exceeds 3700 daily sources per log directory')
        const file = date + '.md'
        const source = label + '/' + file
        const fullPath = path.join(dir, file)
        let text
        try { text = await this._read(fullPath) } catch (error) {
          if (error.code === 'ENOENT') {
            coveredSources.push({ type: label === 'archive' ? 'archive-log' : 'daily-log', path: source, status: 'missing', recordsRead: 0 })
            date = nextDate(date)
            continue
          }
          readErrors.push(queryError(source, 'log-read-failed', error.message))
          coveredSources.push({ type: label === 'archive' ? 'archive-log' : 'daily-log', path: source, status: 'error', recordsRead: 0 })
          date = nextDate(date)
          continue
        }
        const found = this._logRecords(text, source, date, readErrors)
        records.push(...found)
        coveredSources.push({ type: label === 'archive' ? 'archive-log' : 'daily-log', path: source, status: found.length ? 'read' : 'empty', recordsRead: found.length })
        date = nextDate(date)
      }
    }
    const compare = (a, b) => a.at - b.at || String(a.eventId || '').localeCompare(String(b.eventId || '')) ||
      (a.checkpointIndex ?? -1) - (b.checkpointIndex ?? -1) || a.source.type.localeCompare(b.source.type) ||
      a.source.path.localeCompare(b.source.path) || a.ordinal - b.ordinal
    records.sort(compare)
    const filtered = records.filter((record) => record.at >= fromMs && record.at < toMs &&
      (eventId === undefined || record.eventId === eventId) && (!selectedKinds || selectedKinds.includes(record.kind)))
    const page = after ? filtered.filter((record) => compare(record, after) > 0) : filtered
    const truncated = page.length > limit
    const selected = page.slice(0, limit)
    const last = selected.at(-1)
    const nextCursor = truncated && last ? Buffer.from(JSON.stringify({ schema: CURSOR_SCHEMA, signature, after: {
      at: last.at, eventId: last.eventId, checkpointIndex: last.checkpointIndex,
      source: last.source, ordinal: last.ordinal,
    } })).toString('base64url') : null
    const items = selected.map(({ quad, ...record }) => ({ ...record, goal: includeQuad && quad ? quad.goal : null, state: includeQuad && quad ? quad.state : null, dead: includeQuad && quad ? quad.dead : null, next: includeQuad && quad ? quad.next : null }))
    return {
      ok: readErrors.length === 0,
      range: { from, to, fromMs, toMs, timeZone: this.timeZone },
      items, total: filtered.length, count: items.length,
      coveredSources, readErrors, truncated, nextCursor,
    }
  }
}

export async function queryHistory(options, filter) {
  return new LedgerHistoryQuery(options).query(filter)
}

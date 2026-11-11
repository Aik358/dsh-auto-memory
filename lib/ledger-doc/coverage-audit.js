import fs from 'node:fs/promises'
import path from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import { performance } from 'node:perf_hooks'
import { canonicalize, computeLegacyCheckpointKey } from './protocol.js'

export const COVERAGE_REPORT_SCHEMA = 'r4-coverage-report-v1'
export const COVERAGE_SUMMARY_SCHEMA = 'r4-coverage-summary-v1'
export const AUDIT_RULES_VERSION = 'r4-ledger-audit-v1'
export const NORMALIZATION_ALGORITHM = 'r4-ledger-normalize-v1'
export const STRICT_LEDGER_NAME = /^handoff-\d{8}-\d{6}(?:-[a-z]+(?:-[a-z]+)*)?\.md$/
export const QUAD_FIELDS = Object.freeze(['goal', 'state', 'dead', 'next'])

const LF = String.fromCharCode(10)
const decoder = new TextDecoder('utf-8', { fatal: true })
const hasOwn = (value, key) => Object.prototype.hasOwnProperty.call(value, key)

function sha256(value) {
  return createHash('sha256').update(value).digest('hex')
}

function error(code, cause) {
  return { code, message: cause instanceof Error ? cause.message : String(cause || code) }
}

function normalizeNewlines(text) {
  return String(text).split(String.fromCharCode(13) + LF).join(LF).split(String.fromCharCode(13)).join(LF)
}

function isGeneratedH1(line) {
  return /^#\s*交接账本(?:\s|$)/.test(line)
}

function isProtocolMetadata(line) {
  if (/^\s*eventId\s*=\s*evt_[0-9a-f]{8}\s*$/.test(line)) return true
  const comment = /^\s*<!--\s*(.*?)\s*-->\s*$/.exec(line)
  if (!comment) return false
  const body = comment[1]
  return body.startsWith('memory:') || body.startsWith('memory tag:') ||
    /^dsh-status\b/i.test(body) || /^type[:=](?:goal|state|dead-end|progress)\b/i.test(body)
}

export function normalizeLedgerForAudit(text) {
  if (typeof text !== 'string') throw new TypeError('ledger-text-must-be-string')
  const lines = normalizeNewlines(text).split(LF)
  const kept = []
  let removedGeneratedH1Count = 0
  let removedMetadataLineCount = 0
  for (const line of lines) {
    if (isGeneratedH1(line)) { removedGeneratedH1Count++; continue }
    if (isProtocolMetadata(line)) { removedMetadataLineCount++; continue }
    kept.push(line.replace(/[ 	]+$/g, ''))
  }
  while (kept.length && kept[0].trim() === '') kept.shift()
  while (kept.length && kept[kept.length - 1].trim() === '') kept.pop()
  const normalized = kept.join(LF)
  return {
    algorithm: NORMALIZATION_ALGORITHM,
    normalized,
    normalizedBytes: Buffer.byteLength(normalized, 'utf8'),
    normalizedSha256: sha256(Buffer.from(normalized, 'utf8')),
    removedGeneratedH1Count,
    removedMetadataLineCount,
  }
}

function normalizeInventoryV0(text) {
  return normalizeNewlines(String(text || '')).split(LF)
    .filter((line) => !/^#\s*交接账本/.test(line) && !/^\s*<!--.*-->\s*$/.test(line))
    .map((line) => line.replace(/[ 	]+$/g, '')).join(LF).trim()
}

const ALIASES = [
  ['next', ['进度与下一步', '下一步', '接下来']],
  ['dead', ['已试方案与失败原因', '失败与弯路', '失败原因', '已试方案']],
  ['state', ['任务状态', '当前状态', '进行中']],
  ['goal', ['目标', '目的']],
]

function quadKey(title) {
  for (const [key, names] of ALIASES) if (names.some((name) => title === name || title.startsWith(name))) return key
  return null
}

export function parseLedgerForAudit(text) {
  const lines = normalizeNewlines(String(text == null ? '' : text)).split(LF)
  const allHeads = []
  const quadHeads = []
  for (let index = 0; index < lines.length; index++) {
    const match = /^##\s+(.+?)\s*$/.exec(lines[index])
    if (!match) continue
    const title = match[1]
    const key = quadKey(title)
    allHeads.push({ index, title, key })
    if (key) quadHeads.push({ index, title, key })
  }
  const quad = { goal: '', state: '', dead: '', next: '' }
  const quadPresence = { goal: false, state: false, dead: false, next: false }
  const duplicateQuadRegions = []
  for (let head = 0; head < quadHeads.length; head++) {
    const current = quadHeads[head]
    quadPresence[current.key] = true
    if (quadHeads.filter((item) => item.key === current.key).length > 1 && !duplicateQuadRegions.includes(current.key)) duplicateQuadRegions.push(current.key)
    if (quad[current.key]) continue
    const to = head + 1 < quadHeads.length ? quadHeads[head + 1].index : lines.length
    quad[current.key] = lines.slice(current.index + 1, to).join(LF).trim()
  }
  const declaredEventIds = []
  let invalidDeclaredEventIdLines = 0
  for (const line of lines) {
    const match = /^\s*eventId\s*=\s*(\S+)\s*$/.exec(line)
    if (!match) continue
    if (/^evt_[0-9a-f]{8}$/.test(match[1])) declaredEventIds.push(match[1])
    else invalidDeclaredEventIdLines++
  }
  const regionDigests = {}
  for (const key of QUAD_FIELDS) regionDigests[key] = quadPresence[key] ? sha256(Buffer.from(quad[key], 'utf8')) : null
  const extraSectionNames = []
  for (let head = 0; head < allHeads.length; head++) {
    const current = allHeads[head]
    if (current.key) continue
    extraSectionNames.push(current.title)
    const to = head + 1 < allHeads.length ? allHeads[head + 1].index : lines.length
    const value = lines.slice(current.index + 1, to).join(LF).trim()
    regionDigests['section:' + current.title] = sha256(Buffer.from(value, 'utf8'))
  }
  return {
    quad,
    quadPresence,
    duplicateQuadRegions,
    declaredEventIds: [...new Set(declaredEventIds)].sort(),
    invalidDeclaredEventIdLines,
    sectionNames: allHeads.map((head) => head.title),
    extraSectionNames,
    regionDigests,
  }
}

function checkpointQuad(cp) {
  const quad = {}
  const presence = {}
  for (const key of QUAD_FIELDS) {
    presence[key] = hasOwn(cp, key)
    quad[key] = presence[key] && cp[key] != null ? normalizeNewlines(String(cp[key])).trim() : ''
  }
  return { quad, presence }
}

function explicitNone(value) {
  return /^(?:无已确认失败|暂无已确认失败)[。！!]?$/.test(value.trim())
}

function compareQuad(source, cp) {
  const checkpoint = checkpointQuad(cp)
  const comparison = {}
  const differences = []
  const emptyVsExplicitNone = []
  for (const key of QUAD_FIELDS) {
    const sourceValue = source.quad[key]
    const checkpointValue = checkpoint.quad[key]
    const sourceEmpty = sourceValue === ''
    const checkpointEmpty = checkpointValue === ''
    const sourceExplicitNone = explicitNone(sourceValue)
    const checkpointExplicitNone = explicitNone(checkpointValue)
    const equal = source.quadPresence[key] && checkpoint.presence[key] && sourceValue === checkpointValue
    comparison[key] = {
      equal,
      sourcePresent: source.quadPresence[key],
      checkpointPresent: checkpoint.presence[key],
      sourceEmpty,
      checkpointEmpty,
      sourceExplicitNone,
      checkpointExplicitNone,
      sourceSha256: sha256(Buffer.from(sourceValue, 'utf8')),
      checkpointSha256: sha256(Buffer.from(checkpointValue, 'utf8')),
    }
    const reasons = []
    if (!source.quadPresence[key]) reasons.push('source-region-missing')
    if (!checkpoint.presence[key]) reasons.push('checkpoint-region-missing')
    if (source.quadPresence[key] && checkpoint.presence[key] && sourceValue !== checkpointValue) reasons.push('value-diff')
    if ((sourceEmpty && checkpointExplicitNone) || (checkpointEmpty && sourceExplicitNone)) {
      reasons.push('empty-vs-explicit-none')
      emptyVsExplicitNone.push({ regionId: key, sourceEmpty, checkpointEmpty, sourceExplicitNone, checkpointExplicitNone })
    }
    if (key === 'dead' && (sourceEmpty || checkpointEmpty)) reasons.push('dead-empty-ambiguous')
    if (reasons.length) differences.push({ regionId: key, reasonCodes: [...new Set(reasons)], sourceSha256: comparison[key].sourceSha256, checkpointSha256: comparison[key].checkpointSha256 })
  }
  return { comparison, differences, emptyVsExplicitNone }
}

function normalizedRef(value) {
  return String(value || '').replace(/\\/g, '/').replace(/^\.\//, '')
}

function sourceRefMatches(sourceRef, relPath) {
  const reference = normalizedRef(sourceRef)
  const source = normalizedRef(relPath)
  if (!reference) return false
  return reference === source || reference.endsWith('/' + source) || path.posix.basename(reference) === path.posix.basename(source)
}

function filenameTimestamp(name, offsetMinutes) {
  const match = /^handoff-(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})(?:-[a-z]+(?:-[a-z]+)*)?\.md$/.exec(name)
  if (!match) return null
  const values = match.slice(1).map(Number)
  const milliseconds = Date.UTC(values[0], values[1] - 1, values[2], values[3], values[4], values[5]) - offsetMinutes * 60000
  return Number.isFinite(milliseconds) ? new Date(milliseconds).toISOString() : null
}

function reportDigest(report) {
  const unsigned = { ...report }
  delete unsigned.reportSha256
  delete unsigned.summarySha256
  return sha256(Buffer.from(canonicalize(unsigned), 'utf8'))
}

function within(root, target) {
  const relative = path.relative(root, target)
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative))
}

function baseReport(relPath, workspaceKey, eventStoreSnapshot) {
  return {
    schemaVersion: COVERAGE_REPORT_SCHEMA,
    auditRulesVersion: AUDIT_RULES_VERSION,
    generatedAt: null,
    workspaceKey,
    source: {
      relPath,
      bytes: 0,
      sha256: null,
      mtimeMs: null,
      birthtimeMs: null,
      filenameTimestamp: filenameTimestamp(relPath, 480),
      declaredEventIds: [],
      sectionNames: [],
      regionDigests: {},
      statSource: 'filesystem',
    },
    eventStoreSnapshot,
    normalization: {
      algorithm: NORMALIZATION_ALGORITHM,
      normalizedBytes: 0,
      normalizedSha256: null,
      removedGeneratedH1Count: 0,
      removedMetadataLineCount: 0,
    },
    candidates: [],
    identity: { pass: false, reasonCodes: [], declaredIdsCovered: false },
    content: { pass: false, fullTextEqual: false, regionDiffs: [] },
    quad: { pass: false, emptyVsExplicitNone: [], differences: [] },
    timeline: { pass: false, timeDeltaMs: null, reasonCodes: [], window: null, checkpoints: [] },
    binding: { pass: false, reasonCodes: [], checkpoints: [] },
    recovery: { backupId: null, backupSha256: null, restoreDrillId: null, byteExactRestore: false },
    gates: { identityMapping: false, normalizedEquivalence: false, quadSemantics: false, bindingTimeline: false, reportPersistence: false },
    disposition: 'illegible-or-ambiguous',
    eligibleForPhysicalDelete: false,
    review: { required: true, reasonCodes: [], reviewer: null, decidedAt: null },
    sourceRereadSha256: null,
    errors: [],
    auditDurationMs: 0,
    reportSha256: null,
  }
}

export class LedgerCoverageAuditor {
  constructor({ sourceDir, eventStorePath, reportDir, workspaceKey = 'isolated', fs: fsImpl = fs, now = () => new Date().toISOString(), trustedMemoryRoot = null, filenameTimeZoneOffsetMinutes = 480, sourceMetadata = [] } = {}) {
    if (![sourceDir, eventStorePath, reportDir].every((value) => typeof value === 'string' && path.isAbsolute(value))) throw new TypeError('audit-path-invalid')
    this.sourceDir = path.resolve(sourceDir)
    this.eventStorePath = path.resolve(eventStorePath)
    this.reportDir = path.resolve(reportDir)
    this.artifactsDir = path.resolve(process.cwd(), 'artifacts')
    // ★R4 A1 修正（task-2）：与 LedgerDocSystem 同源的显式受控授权（缺省行为不变）。
    this.trustedMemoryRoot = (typeof trustedMemoryRoot === 'string' && trustedMemoryRoot && path.isAbsolute(trustedMemoryRoot)) ? path.resolve(trustedMemoryRoot) : null
    this.roots = this.trustedMemoryRoot ? [this.artifactsDir, this.trustedMemoryRoot] : [this.artifactsDir]
    for (const target of [this.sourceDir, this.eventStorePath, this.reportDir]) if (!this.roots.some((r) => within(r, target))) throw new TypeError('audit-root-invalid')
    if (this.sourceDir === this.reportDir) throw new TypeError('audit-report-root-invalid')
    this.workspaceKey = String(workspaceKey || 'isolated')
    this.fs = fsImpl
    this.now = now
    this.filenameTimeZoneOffsetMinutes = filenameTimeZoneOffsetMinutes
    this.sourceMetadata = new Map(sourceMetadata.map((item) => [item.relPath, item]))
    this.prepared = null
  }

  async _assertRoots() {
    const realRoots = []
    for (const r of this.roots) { try { realRoots.push(await this.fs.realpath(r)) } catch (_) { /* 授权根不存在 ⇒ 不参与判定 */ } }
    for (const target of [this.sourceDir, this.reportDir]) {
      await this.fs.mkdir(target, { recursive: true })
      const stat = await this.fs.lstat(target)
      const physical = await this.fs.realpath(target)
      if (!stat.isDirectory() || stat.isSymbolicLink() || !realRoots.some((r) => within(r, physical))) throw new TypeError('audit-root-invalid')
    }
    const eventStat = await this.fs.lstat(this.eventStorePath)
    const eventReal = await this.fs.realpath(this.eventStorePath)
    if (!eventStat.isFile() || eventStat.isSymbolicLink() || !realRoots.some((r) => within(r, eventReal))) throw new TypeError('audit-event-store-invalid')
  }

  async _prepare() {
    if (this.prepared) return this.prepared
    await this._assertRoots()
    const eventBytes = await this.fs.readFile(this.eventStorePath)
    const eventStoreSnapshot = { bytes: eventBytes.length, sha256: sha256(eventBytes) }
    const store = JSON.parse(decoder.decode(eventBytes))
    const events = Array.isArray(store) ? store : store.events
    if (!Array.isArray(events)) throw new TypeError('audit-event-store-schema-invalid')
    const records = []
    events.forEach((event, eventIndex) => {
      if (!event || typeof event.id !== 'string' || !Array.isArray(event.checkpoints)) return
      event.checkpoints.forEach((cp, checkpointIndex) => {
        if (!cp || cp.kind !== 'handoff') return
        const normalized = normalizeLedgerForAudit(String(cp.text == null ? '' : cp.text))
        const parsed = parseLedgerForAudit(cp.text)
        const legacyCheckpointKey = computeLegacyCheckpointKey({
          ...cp,
          eventId: event.id,
          checkpointIndex,
          quad: Object.fromEntries(QUAD_FIELDS.map((key) => [key, cp[key] ?? null])),
        })
        records.push({
          eventId: event.id,
          eventIndex,
          eventStatus: event.status || null,
          cp,
          checkpointIndex,
          normalized,
          parsed,
          legacyCheckpointKey,
        })
      })
    })
    this.prepared = { eventBytes, eventStoreSnapshot, events, records }
    return this.prepared
  }

  _sourcePath(relPath) {
    if (typeof relPath !== 'string' || !STRICT_LEDGER_NAME.test(relPath) || path.basename(relPath) !== relPath) throw new TypeError('audit-source-name-invalid')
    const target = path.resolve(this.sourceDir, relPath)
    if (path.dirname(target) !== this.sourceDir) throw new TypeError('audit-source-name-invalid')
    return target
  }

  async _readSource(relPath) {
    const target = this._sourcePath(relPath)
    const stat = await this.fs.lstat(target)
    const physical = await this.fs.realpath(target)
    if (!stat.isFile() || stat.isSymbolicLink() || path.dirname(physical) !== await this.fs.realpath(this.sourceDir)) throw new TypeError('audit-source-invalid')
    const bytes = await this.fs.readFile(target)
    return { target, stat, bytes }
  }

  _candidate(record, context) {
    const { relPath, normalized, source } = context
    const sourceRef = record.cp.sourceRef == null ? null : String(record.cp.sourceRef)
    const sourceRefMatched = sourceRefMatches(sourceRef, relPath)
    const fullTextEqual = normalized.normalizedSha256 === record.normalized.normalizedSha256
    const quad = compareQuad(source, record.cp)
    const sourceRegions = new Set(source.sectionNames.map((title) => quadKey(title) || 'section:' + title))
    const checkpointRegions = new Set(record.parsed.sectionNames.map((title) => quadKey(title) || 'section:' + title))
    const missingRegions = [...checkpointRegions].filter((key) => !sourceRegions.has(key)).sort()
    const extraRegions = [...sourceRegions].filter((key) => !checkpointRegions.has(key)).sort()
    return {
      eventId: record.eventId,
      checkpointId: typeof record.cp.checkpointId === 'string' ? record.cp.checkpointId : null,
      legacyCheckpointKey: record.cp.checkpointId ? null : record.legacyCheckpointKey,
      identityMode: record.cp.checkpointId ? 'persisted-checkpoint-id' : 'legacy-derived',
      checkpointIndex: record.checkpointIndex,
      at: Number.isFinite(Number(record.cp.at)) ? Number(record.cp.at) : null,
      kind: String(record.cp.kind || ''),
      sourceRef,
      normalizedTextSha256: record.normalized.normalizedSha256,
      fullTextEqual,
      quadComparison: quad.comparison,
      missingRegions,
      extraRegions,
      sourceRefMatched,
      alternativeNormalizationMatch: normalizeInventoryV0(record.cp.text) === context.inventoryNormalized,
      selected: false,
      _record: record,
      _quad: quad,
    }
  }

  _selectIdentity(report, candidates) {
    const declared = report.source.declaredEventIds
    const declaredSet = new Set(declared)
    const reasons = []
    const selected = []
    const strong = candidates.filter((candidate) => candidate.sourceRefMatched || candidate.fullTextEqual)
    if (report.source.invalidDeclaredEventIdLines) reasons.push('declared-event-id-invalid')
    if (declared.length && strong.some((candidate) => !declaredSet.has(candidate.eventId))) reasons.push('declared-identity-conflict')
    const selectOne = (scoped, eventId) => {
      if (!scoped.length) { reasons.push(declared.length ? 'declared-event-checkpoint-missing' : 'checkpoint-not-found'); return }
      const pointers = scoped.filter((candidate) => candidate.sourceRefMatched)
      if (pointers.length) {
        const pointerFull = pointers.filter((candidate) => candidate.fullTextEqual)
        const chosen = pointerFull.length === 1 ? pointerFull[0] : pointers.length === 1 ? pointers[0] : null
        if (!chosen) { reasons.push('ambiguous-source-ref-candidates'); return }
        if (chosen.sourceRef && !chosen.sourceRefMatched) reasons.push('source-ref-identity-conflict')
        selected.push(chosen)
        return
      }
      const full = scoped.filter((candidate) => candidate.fullTextEqual)
      const globalFull = candidates.filter((candidate) => candidate.fullTextEqual)
      if (full.length === 1 && globalFull.length === 1) {
        if (full[0].sourceRef && !full[0].sourceRefMatched) reasons.push('source-ref-identity-conflict')
        selected.push(full[0])
      } else if (full.length || globalFull.length) reasons.push('ambiguous-normalized-fulltext-candidates')
      else reasons.push(eventId ? 'declared-event-content-evidence-missing' : 'checkpoint-not-found')
    }
    if (declared.length) {
      for (const eventId of declared) selectOne(strong.filter((candidate) => candidate.eventId === eventId), eventId)
    } else selectOne(strong, null)
    for (const candidate of new Set(selected)) candidate.selected = true
    const declaredIdsCovered = declared.length ? declared.every((eventId) => selected.some((candidate) => candidate.eventId === eventId)) : selected.length === 1
    report.identity = { pass: selected.length > 0 && declaredIdsCovered && reasons.length === 0, reasonCodes: [...new Set(reasons)], declaredIdsCovered }
  }

  _evaluateContentAndQuad(report, candidates) {
    const selected = candidates.filter((candidate) => candidate.selected)
    const regionDiffs = []
    const differences = []
    const emptyVsExplicitNone = []
    let quadPass = selected.length > 0
    for (const candidate of selected) {
      if (!candidate.fullTextEqual) {
        const keys = new Set([...Object.keys(report.source.regionDigests), ...Object.keys(candidate._record.parsed.regionDigests)])
        for (const regionId of [...keys].sort()) {
          const sourceHash = report.source.regionDigests[regionId] ?? null
          const checkpointHash = candidate._record.parsed.regionDigests[regionId] ?? null
          if (sourceHash !== checkpointHash) regionDiffs.push({ eventId: candidate.eventId, checkpointIndex: candidate.checkpointIndex, regionId, sourceSha256: sourceHash, checkpointSha256: checkpointHash })
        }
      }
      for (const difference of candidate._quad.differences) differences.push({ eventId: candidate.eventId, checkpointIndex: candidate.checkpointIndex, ...difference })
      for (const item of candidate._quad.emptyVsExplicitNone) emptyVsExplicitNone.push({ eventId: candidate.eventId, checkpointIndex: candidate.checkpointIndex, ...item })
      if (candidate._quad.differences.length || (candidate.extraRegions.length && !candidate.fullTextEqual)) quadPass = false
      if (candidate.extraRegions.length && !candidate.fullTextEqual) differences.push({ eventId: candidate.eventId, checkpointIndex: candidate.checkpointIndex, regionId: 'extra-sections', reasonCodes: ['extra-region-uncovered'] })
    }
    report.content = { pass: selected.length > 0 && selected.every((candidate) => candidate.fullTextEqual), fullTextEqual: selected.length > 0 && selected.every((candidate) => candidate.fullTextEqual), regionDiffs }
    report.quad = { pass: quadPass, emptyVsExplicitNone, differences }
  }

  _evaluateBinding(report) {
    const selected = report.candidates.filter((candidate) => candidate.selected)
    const reasons = []
    const checkpoints = []
    if (!report.identity.pass) reasons.push('identity-not-established')
    for (const candidate of selected) {
      const cp = candidate._record.cp
      const item = { eventId: candidate.eventId, checkpointIndex: candidate.checkpointIndex, sourceRefSameSource: true, relSameSource: true, bytesSameSource: true, shaSameSource: true }
      if (candidate.sourceRef && !candidate.sourceRefMatched) { item.sourceRefSameSource = false; reasons.push('source-ref-not-same-source') }
      if (cp.rel != null && !sourceRefMatches(cp.rel, report.source.relPath)) { item.relSameSource = false; reasons.push('checkpoint-rel-not-same-source') }
      if (Number.isFinite(Number(cp.bytes)) && Number(cp.bytes) !== report.source.bytes) { item.bytesSameSource = false; reasons.push('checkpoint-bytes-not-same-source') }
      if (cp.sha256 != null && String(cp.sha256).replace(/^sha256:/, '') !== report.source.sha256) { item.shaSameSource = false; reasons.push('checkpoint-sha-not-same-source') }
      if (!candidate.sourceRef && !candidate.fullTextEqual) reasons.push('no-source-binding-evidence')
      checkpoints.push(item)
    }
    if (!selected.length) reasons.push('checkpoint-not-found')
    report.binding = { pass: selected.length > 0 && reasons.length === 0, reasonCodes: [...new Set(reasons)], checkpoints }
  }

  _evaluateTimeline(report) {
    const selected = report.candidates.filter((candidate) => candidate.selected)
    const reasons = []
    const checkpoints = []
    const filenameMs = report.source.filenameTimestamp ? Date.parse(report.source.filenameTimestamp) : NaN
    const birthtimeMs = Number(report.source.birthtimeMs)
    const mtimeMs = Number(report.source.mtimeMs)
    const toleranceMs = 1000
    const graceMs = 5000
    if (!report.identity.pass || !report.binding.pass) reasons.push('identity-or-binding-not-established')
    if (!Number.isFinite(filenameMs)) reasons.push('filename-timestamp-invalid')
    if (!Number.isFinite(birthtimeMs) || birthtimeMs <= 0 || !Number.isFinite(mtimeMs) || mtimeMs <= 0) reasons.push('file-creation-window-unavailable')
    if (Number.isFinite(filenameMs) && Number.isFinite(birthtimeMs)) {
      const delta = birthtimeMs - filenameMs
      if (delta < -toleranceMs || delta > 2000) reasons.push('filename-birthtime-outside-window')
    }
    if (Number.isFinite(birthtimeMs) && Number.isFinite(mtimeMs) && mtimeMs + toleranceMs < birthtimeMs) reasons.push('file-time-inversion')
    const windowEnd = Number.isFinite(birthtimeMs) && Number.isFinite(mtimeMs) ? Math.max(birthtimeMs, mtimeMs) + graceMs : null
    let maxDelta = null
    for (const candidate of selected) {
      const at = Number(candidate.at)
      const item = {
        eventId: candidate.eventId,
        checkpointIndex: candidate.checkpointIndex,
        at: Number.isFinite(at) ? at : null,
        filenameTimestampDeltaMs: Number.isFinite(at) && Number.isFinite(filenameMs) ? at - filenameMs : null,
        birthtimeDeltaMs: Number.isFinite(at) && Number.isFinite(birthtimeMs) ? at - birthtimeMs : null,
        mtimeDeltaMs: Number.isFinite(at) && Number.isFinite(mtimeMs) ? at - mtimeMs : null,
        sourceRefSameSource: !candidate.sourceRef || candidate.sourceRefMatched,
      }
      if (!Number.isFinite(at) || at <= 0) reasons.push('checkpoint-time-invalid')
      else {
        if (Number.isFinite(filenameMs)) {
          const absolute = Math.abs(at - filenameMs)
          maxDelta = maxDelta == null ? absolute : Math.max(maxDelta, absolute)
          if (at + toleranceMs < filenameMs) reasons.push('checkpoint-before-filename-window')
        }
        if (Number.isFinite(birthtimeMs) && at + toleranceMs < birthtimeMs) reasons.push('checkpoint-before-file-creation')
        if (windowEnd != null && at > windowEnd) reasons.push('checkpoint-after-file-creation-window')
      }
      if (!item.sourceRefSameSource) reasons.push('timeline-source-ref-mismatch')
      checkpoints.push(item)
    }
    if (!selected.length) reasons.push('checkpoint-not-found')
    report.timeline = {
      pass: selected.length > 0 && reasons.length === 0,
      timeDeltaMs: maxDelta,
      reasonCodes: [...new Set(reasons)],
      window: Number.isFinite(filenameMs) && windowEnd != null ? { startMs: filenameMs, endMs: windowEnd, toleranceMs, checkpointAfterWriteGraceMs: graceMs } : null,
      checkpoints,
    }
  }

  _disposition(report, candidates) {
    if (report.errors.some((item) => item.code === 'source-utf8-invalid' || item.code === 'source-metadata-mismatch')) return 'illegible-or-ambiguous'
    const selected = candidates.filter((candidate) => candidate.selected)
    if (selected.length && ['identityMapping', 'normalizedEquivalence', 'quadSemantics', 'bindingTimeline'].every((gate) => report.gates[gate])) return 'covered'
    if (report.identity.reasonCodes.some((code) => code.includes('ambiguous') || code.includes('conflict'))) return 'illegible-or-ambiguous'
    if (candidates.some((candidate) => candidate.fullTextEqual)) return 'illegible-or-ambiguous'
    if (candidates.some((candidate) => candidate.sourceRefMatched)) return 'pointer-only-content-diff'
    if (report.source.declaredEventIds.length && candidates.some((candidate) => report.source.declaredEventIds.includes(candidate.eventId))) return 'declared-event-only'
    if (candidates.some((candidate) => candidate.alternativeNormalizationMatch)) return 'normalization-candidate'
    if (candidates.some((candidate) => candidate.semanticComparisonOnly)) return 'extra-semantic-content'
    if (report.errors.length) return 'illegible-or-ambiguous'
    if (!candidates.length) return 'no-event-side-evidence-in-scope'
    return 'illegible-or-ambiguous'
  }

  async _writeJsonAtomic(target, value) {
    if (path.dirname(target) !== this.reportDir) throw new TypeError('audit-report-path-invalid')
    const temporary = path.join(this.reportDir, '.' + path.basename(target) + '.' + process.pid + '.' + randomUUID() + '.tmp')
    let handle
    let committed = false
    try {
      handle = await this.fs.open(temporary, 'wx')
      const bytes = Buffer.from(JSON.stringify(value, null, 2) + LF, 'utf8')
      await handle.writeFile(bytes)
      await handle.sync()
      await handle.close()
      handle = null
      await this.fs.rename(temporary, target)
      committed = true
      return bytes.length
    } finally {
      if (handle) await handle.close().catch(() => undefined)
      if (!committed) await this.fs.unlink(temporary).catch(() => undefined)
    }
  }

  async _persistReport(report) {
    report.reportSha256 = reportDigest(report)
    const target = path.join(this.reportDir, report.source.relPath + '.json')
    const bytes = await this._writeJsonAtomic(target, report)
    let readback
    try {
      readback = JSON.parse(decoder.decode(await this.fs.readFile(target)))
    } catch (cause) {
      throw Object.assign(new Error('report-readback-failed'), { code: 'REPORT_READBACK_FAILED', cause })
    }
    if (readback.reportSha256 !== report.reportSha256 || reportDigest(readback) !== report.reportSha256) throw Object.assign(new Error('report-sha256-mismatch'), { code: 'REPORT_SHA256_MISMATCH' })
    return { reportPath: target, reportBytes: bytes, readbackBytes: Buffer.byteLength(JSON.stringify(readback, null, 2) + LF, 'utf8') }
  }

  async auditFile(relPath, prepared = null) {
    const started = performance.now()
    this._sourcePath(relPath)
    const snapshot = prepared || await this._prepare()
    const report = baseReport(relPath, this.workspaceKey, snapshot.eventStoreSnapshot)
    report.generatedAt = this.now()
    report.source.filenameTimestamp = filenameTimestamp(relPath, this.filenameTimeZoneOffsetMinutes)
    let context = null
    try {
      const input = await this._readSource(relPath)
      report.source.bytes = input.bytes.length
      report.source.sha256 = sha256(input.bytes)
      report.source.mtimeMs = input.stat.mtimeMs
      report.source.birthtimeMs = input.stat.birthtimeMs
      const metadata = this.sourceMetadata.get(relPath)
      if (metadata) {
        if (metadata.bytes !== input.bytes.length || metadata.sha256 !== report.source.sha256) report.errors.push(error('source-metadata-mismatch', 'snapshot metadata does not match copied source bytes'))
        else if (!Number.isFinite(metadata.mtimeMs) || !Number.isFinite(metadata.birthtimeMs)) report.errors.push(error('source-metadata-mismatch', 'snapshot metadata timestamps are invalid'))
        else {
          report.source.mtimeMs = metadata.mtimeMs
          report.source.birthtimeMs = metadata.birthtimeMs
          report.source.statSource = 'snapshot-manifest'
        }
      }
      const text = decoder.decode(input.bytes)
      const normalized = normalizeLedgerForAudit(text)
      const source = parseLedgerForAudit(text)
      Object.assign(report.source, {
        declaredEventIds: source.declaredEventIds,
        sectionNames: source.sectionNames,
        regionDigests: source.regionDigests,
        invalidDeclaredEventIdLines: source.invalidDeclaredEventIdLines,
      })
      const { normalized: ignored, ...normalization } = normalized
      report.normalization = normalization
      context = { relPath, normalized, source, inventoryNormalized: normalizeInventoryV0(text) }
    } catch (cause) {
      const code = cause instanceof TypeError && /decoded reason|UTF-8|encoded data/i.test(cause.message) ? 'source-utf8-invalid' : cause.code === 'ENOENT' ? 'source-read-failed' : cause.code || 'source-read-failed'
      report.errors.push(error(code, cause))
    }
    if (context) {
      const declared = new Set(context.source.declaredEventIds)
      const candidates = []
      for (const record of snapshot.records) {
        const candidate = this._candidate(record, context)
        if (candidate.sourceRefMatched || candidate.fullTextEqual || candidate.alternativeNormalizationMatch || declared.has(record.eventId)) candidates.push(candidate)
      }
      if (!candidates.some((candidate) => candidate.sourceRefMatched || candidate.fullTextEqual || declared.has(candidate.eventId))) {
        const semantic = []
        for (const record of snapshot.records) {
          const candidate = this._candidate(record, context)
          const primaryEqual = ['goal', 'state', 'next'].every((key) => context.source.quad[key] && context.source.quad[key] === record.parsed.quad[key])
          if (primaryEqual && (context.source.extraSectionNames.length || candidate.extraRegions.length || candidate.missingRegions.length)) {
            candidate.semanticComparisonOnly = true
            semantic.push(candidate)
          }
        }
        candidates.push(...semantic.slice(0, 3))
      }
      report.candidates = candidates
      this._selectIdentity(report, candidates)
      this._evaluateContentAndQuad(report, candidates)
      this._evaluateBinding(report)
      this._evaluateTimeline(report)
      if (context.source.duplicateQuadRegions.length) {
        report.quad.pass = false
        for (const regionId of context.source.duplicateQuadRegions) report.quad.differences.push({ regionId, reasonCodes: ['duplicate-quad-region'] })
      }
      if (report.errors.some((item) => item.code === 'source-metadata-mismatch')) {
        report.timeline.pass = false
        report.timeline.reasonCodes.push('source-metadata-mismatch')
      }
    }
    report.gates.identityMapping = report.identity.pass
    report.gates.normalizedEquivalence = report.content.pass
    report.gates.quadSemantics = report.quad.pass
    report.gates.bindingTimeline = report.binding.pass && report.timeline.pass
    report.disposition = this._disposition(report, report.candidates)
    try {
      const reread = await this._readSource(relPath)
      report.sourceRereadSha256 = sha256(reread.bytes)
      if (report.sourceRereadSha256 !== report.source.sha256) {
        report.errors.push(error('source-changed-during-audit', 'source SHA-256 changed between reads'))
        report.timeline.pass = false
        report.timeline.reasonCodes.push('source-changed-during-audit')
        report.gates.bindingTimeline = false
        report.disposition = 'illegible-or-ambiguous'
      }
    } catch (cause) {
      report.errors.push(error('source-reread-failed', cause))
      report.timeline.pass = false
      report.timeline.reasonCodes.push('source-reread-failed')
      report.gates.bindingTimeline = false
      report.disposition = 'illegible-or-ambiguous'
    }
    report.gates.reportPersistence = !report.errors.some((item) => ['source-changed-during-audit', 'source-reread-failed'].includes(item.code))
    report.review.required = !Object.values(report.gates).every(Boolean)
    report.review.reasonCodes = [...new Set([
      ...report.identity.reasonCodes,
      ...report.timeline.reasonCodes,
      ...report.binding.reasonCodes,
      ...report.errors.map((item) => item.code),
      ...(report.content.pass ? [] : ['normalized-equivalence-not-established']),
      ...(report.quad.pass ? [] : ['quad-semantics-not-established']),
      ...(report.gates.reportPersistence ? [] : ['report-persistence-not-established']),
    ])]
    report.disposition = this._disposition(report, report.candidates)
    report.auditDurationMs = Math.max(0, Math.round((performance.now() - started) * 1000) / 1000)
    for (const candidate of report.candidates) {
      delete candidate._record
      delete candidate._quad
    }
    const persisted = await this._persistReport(report)
    return { ...persisted, report }
  }

  async auditAll({ relPaths = null } = {}) {
    const started = performance.now()
    const prepared = await this._prepare()
    let names
    if (relPaths == null) {
      names = (await this.fs.readdir(this.sourceDir, { withFileTypes: true }))
        .filter((entry) => entry.isFile() && !entry.isSymbolicLink() && STRICT_LEDGER_NAME.test(entry.name))
        .map((entry) => entry.name).sort()
    } else {
      if (!Array.isArray(relPaths) || new Set(relPaths).size !== relPaths.length) throw new TypeError('audit-input-list-invalid')
      names = [...relPaths].sort()
      for (const name of names) this._sourcePath(name)
    }
    const reports = []
    const indexes = []
    for (const relPath of names) {
      try {
        const result = await this.auditFile(relPath, prepared)
        reports.push(result.report)
        indexes.push({ relPath, reportRelPath: relPath + '.json', status: 'written', reportSha256: result.report.reportSha256, bytes: result.reportBytes, disposition: result.report.disposition, eligibleForPhysicalDelete: false, errors: result.report.errors })
      } catch (cause) {
        indexes.push({ relPath, reportRelPath: relPath + '.json', status: 'failed', reportSha256: null, bytes: null, disposition: 'illegible-or-ambiguous', eligibleForPhysicalDelete: false, errors: [error(cause.code || 'report-persistence-failed', cause)] })
      }
    }
    let eventStoreRereadSha256 = null
    const summaryErrors = []
    try { eventStoreRereadSha256 = sha256(await this.fs.readFile(this.eventStorePath)) } catch (cause) { summaryErrors.push(error('event-store-reread-failed', cause)) }
    if (eventStoreRereadSha256 !== prepared.eventStoreSnapshot.sha256) summaryErrors.push(error('event-store-changed-during-audit', 'event store SHA-256 changed during batch'))
    const gateNames = { identityMapping: 'identityMapping', normalizedEquivalence: 'normalizedEquivalence', quadSemantics: 'quadSemantics', bindingTimeline: 'bindingTimeline', reportPersistence: 'reportPersistence' }
    const gates = {}
    for (const [key, field] of Object.entries(gateNames)) {
      const pass = reports.filter((report) => report.gates[field]).length
      gates[key] = { pass, fail: names.length - pass, total: names.length, rate: names.length ? pass / names.length : 0 }
    }
    const dispositions = {}
    for (const report of reports) dispositions[report.disposition] = (dispositions[report.disposition] || 0) + 1
    const persistencePass = names.length === reports.length && indexes.length === names.length && reports.every((report) => report.gates.reportPersistence) && summaryErrors.length === 0
    const summary = {
      schemaVersion: COVERAGE_SUMMARY_SCHEMA,
      auditRulesVersion: AUDIT_RULES_VERSION,
      generatedAt: this.now(),
      workspaceKey: this.workspaceKey,
      eventStoreSnapshot: prepared.eventStoreSnapshot,
      eventStoreRereadSha256,
      inputFileCount: names.length,
      total: names.length,
      reportCount: reports.length,
      persistencePass,
      gates,
      dispositions,
      eligibleForPhysicalDeleteCount: 0,
      reports: indexes,
      errors: summaryErrors,
      auditDurationMs: Math.max(0, Math.round((performance.now() - started) * 1000) / 1000),
      summarySha256: null,
    }
    summary.summarySha256 = reportDigest(summary)
    const summaryPath = path.join(this.reportDir, 'coverage-summary.json')
    await this._writeJsonAtomic(summaryPath, summary)
    const readback = JSON.parse(decoder.decode(await this.fs.readFile(summaryPath)))
    if (readback.summarySha256 !== summary.summarySha256 || reportDigest(readback) !== summary.summarySha256) throw new Error('coverage-summary-readback-failed')
    return { ok: persistencePass, summaryPath, summary, reports }
  }
}

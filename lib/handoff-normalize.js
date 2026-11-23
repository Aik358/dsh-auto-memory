import { createHash } from 'node:crypto'
import { normalizeText } from './ledger-doc/protocol.js'
import { normalizeLedgerForAudit, parseLedgerForAudit } from './ledger-doc/coverage-audit.js'

export const HANDOFF_NORMALIZATION_ALGORITHM = 'r4-handoff-coverage-normalize-v1'
export const HANDOFF_PARSE_SCHEMA = 'batch2-handoff-coverage-parse-v1'

const QUAD_FIELDS = Object.freeze(['goal', 'state', 'dead', 'next'])
const REQUIRED_NONEMPTY = Object.freeze(['goal', 'state', 'next'])
const QUAD_TITLES = [
  ['next', ['进度与下一步', '下一步', '接下来']],
  ['dead', ['已试方案与失败原因', '失败与弯路', '失败原因', '已试方案']],
  ['state', ['任务状态', '当前状态', '进行中']],
  ['goal', ['目标', '目的']],
]
const KNOWN_METADATA = new Set(['eventid', 'eventids', 'events', 'documentid', 'createdat', 'updatedat', 'revision', 'type'])
const hasOwn = (value, key) => Object.prototype.hasOwnProperty.call(value, key)
const sha256 = (value) => createHash('sha256').update(value).digest('hex')

function invalid(code) {
  return Object.assign(new TypeError(code), { code })
}

function decodeBytes(bytes) {
  if (!Buffer.isBuffer(bytes) && !(bytes instanceof Uint8Array)) throw invalid('handoff-bytes-invalid')
  const raw = Buffer.from(bytes)
  try {
    return { text: new TextDecoder('utf-8', { fatal: true }).decode(raw), rawBytes: raw }
  } catch (cause) {
    throw Object.assign(invalid('handoff-utf8-invalid'), { cause })
  }
}

function jsonEvidence(value, seen = new Set()) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value
  if (typeof value === 'number') return Number.isFinite(value) ? value : String(value)
  if (value === undefined) return '[undefined]'
  if (typeof value === 'bigint') return String(value)
  if (typeof value === 'function' || typeof value === 'symbol') return '[' + typeof value + ']'
  if (seen.has(value)) return '[circular]'
  seen.add(value)
  let result
  if (Array.isArray(value)) result = value.map((item) => jsonEvidence(item, seen))
  else {
    result = {}
    for (const key of Object.keys(value).sort()) result[key] = jsonEvidence(value[key], seen)
  }
  seen.delete(value)
  return result
}

function readInput(input) {
  if (input == null) return { text: '', rawBytes: Buffer.alloc(0), unknownFields: [] }
  if (typeof input === 'string') {
    const rawBytes = Buffer.from(input, 'utf8')
    return { text: input, rawBytes, unknownFields: [] }
  }
  if (Buffer.isBuffer(input) || input instanceof Uint8Array) {
    const decoded = decodeBytes(input)
    return { ...decoded, unknownFields: [] }
  }
  if (typeof input !== 'object' || Array.isArray(input)) throw invalid('handoff-input-invalid')
  const unknownFields = Object.keys(input).filter((key) => !['text', 'bytes'].includes(key)).sort()
    .map((name) => ({ source: 'input', name, value: jsonEvidence(input[name]) }))
  if (input.bytes != null) {
    const decoded = decodeBytes(input.bytes)
    if (input.text != null && (typeof input.text !== 'string' || input.text !== decoded.text)) throw invalid('handoff-raw-text-mismatch')
    return { ...decoded, unknownFields }
  }
  if (input.text != null && typeof input.text !== 'string') throw invalid('handoff-text-must-be-string')
  const text = input.text == null ? '' : input.text
  return { text, rawBytes: Buffer.from(text, 'utf8'), unknownFields }
}

function quadKey(title) {
  for (const [key, aliases] of QUAD_TITLES) {
    if (aliases.some((alias) => title === alias || title.startsWith(alias))) return key
  }
  return null
}

function parseQuadFromAllSections(lines) {
  const heads = []
  for (let index = 0; index < lines.length; index++) {
    const match = /^##\s+(.+?)\s*$/.exec(lines[index])
    if (match) heads.push({ index, key: quadKey(match[1]) })
  }
  const quad = { goal: '', state: '', dead: '', next: '' }
  for (let position = 0; position < heads.length; position++) {
    const head = heads[position]
    if (!head.key) continue
    const end = position + 1 < heads.length ? heads[position + 1].index : lines.length
    const value = lines.slice(head.index + 1, end).join('\n').trim()
    if (!quad[head.key]) quad[head.key] = value
  }
  return quad
}

function explicitNone(value) {
  return /^(?:无已确认失败|暂无已确认失败)[。！!]?$/.test(String(value).trim())
}

function lineNumberRegions(lines) {
  const heads = []
  for (let index = 0; index < lines.length; index++) {
    const match = /^##\s+(.+?)\s*$/.exec(lines[index])
    if (match) heads.push({ index, title: match[1], field: quadKey(match[1]) })
  }
  return heads.map((head, position) => {
    const end = position + 1 < heads.length ? heads[position + 1].index : lines.length
    const rawBody = lines.slice(head.index + 1, end).join('\n')
    const text = lines.slice(head.index, end).join('\n')
    return {
      id: head.field || 'section:' + head.title,
      title: head.title,
      field: head.field,
      startLine: head.index + 1,
      endLine: end,
      bodyStartLine: head.index + 2,
      bodyEndLine: end,
      text,
      body: rawBody.trim(),
      bytes: Buffer.byteLength(text, 'utf8'),
      sha256: sha256(Buffer.from(text, 'utf8')),
    }
  })
}

function noteEvidence(lines) {
  const notes = []
  const issues = []
  const claimedOpenLines = new Set()
  const headingLines = new Set()
  const digestNote = (kind, mode, start, end, closed, heading = null) => {
    const text = lines.slice(start, end).join('\n')
    for (let index = start; index < end; index++) headingLines.add(index)
    for (let index = start; index < end; index++) claimedOpenLines.add(index)
    notes.push({
      kind, mode, heading, closed, text,
      startLine: start + 1,
      endLine: end,
      bytes: Buffer.byteLength(text, 'utf8'),
      sha256: sha256(Buffer.from(text, 'utf8')),
    })
  }
  for (let index = 0; index < lines.length; index++) {
    const match = /^(#{2,6})\s+(用户备注|模型备注)\s*$/.exec(lines[index])
    if (!match) continue
    if (claimedOpenLines.has(index)) continue
    const level = match[1].length
    let end = lines.length
    for (let next = index + 1; next < lines.length; next++) {
      const heading = /^(#{1,6})\s+/.exec(lines[next])
      if (heading && heading[1].length <= level) { end = next; break }
    }
    const block = lines.slice(index, end)
    const firstOpen = block.findIndex((line) => /^\s*<!--\s*(user|model)\s*-->\s*$/.test(line))
    if (firstOpen >= 0) {
      const kind = /^\s*<!--\s*(user|model)\s*-->\s*$/.exec(block[firstOpen])[1]
      const closeIndex = block.findIndex((line, offset) => offset > firstOpen && new RegExp('^\\s*<!--\\s*/' + kind + '\\s*-->\\s*$').test(line))
      if (closeIndex > firstOpen) {
        digestNote(kind, 'html-comment', index + firstOpen, index + closeIndex + 1, true)
        if (closeIndex + 1 < block.length) digestNote(match[2] === '用户备注' ? 'user' : 'model', 'heading', index + closeIndex + 1, end, true, match[2])
        continue
      }
    }
    digestNote(match[2] === '用户备注' ? 'user' : 'model', 'heading', index, end, true, match[2])
  }
  for (let index = 0; index < lines.length; index++) {
    if (claimedOpenLines.has(index)) continue
    const open = /^\s*<!--\s*(user|model)\s*-->\s*$/.exec(lines[index])
    if (!open) continue
    const close = new RegExp('^\\s*<!--\\s*/' + open[1] + '\\s*-->\\s*$')
    let end = index + 1
    while (end < lines.length && !close.test(lines[end])) end++
    const closed = end < lines.length
    if (!closed) issues.push({ code: 'unclosed-' + open[1] + '-region', line: index + 1 })
    digestNote(open[1], 'html-comment', index, closed ? end + 1 : end, closed)
  }
  return { notes, issues }
}

function metadataEvidence(lines, unknownFields) {
  const firstH2 = lines.findIndex((line) => /^##\s+/.test(line))
  const metadata = []
  const declaredEventIds = []
  let invalidDeclaredEventIdLines = 0
  const limit = firstH2 < 0 ? lines.length : firstH2
  for (let index = 0; index < limit; index++) {
    const raw = lines[index]
    const pair = /^\s*([A-Za-z][A-Za-z0-9_-]*)\s*[:=]\s*(.*?)\s*$/.exec(raw)
    if (pair) {
      const known = KNOWN_METADATA.has(pair[1].toLowerCase())
      const item = { name: pair[1], value: pair[2], line: index + 1, raw, known }
      metadata.push(item)
      if (!known) unknownFields.push({ source: 'document-metadata', ...item })
      if (['eventid', 'eventids', 'events'].includes(pair[1].toLowerCase())) {
        const ids = pair[2].split(/[\s,]+/).filter(Boolean)
        if (!ids.length || ids.some((id) => !/^evt_[0-9a-f]{8}$/.test(id))) invalidDeclaredEventIdLines++
        for (const id of ids) if (/^evt_[0-9a-f]{8}$/.test(id)) declaredEventIds.push(id)
      }
      continue
    }
    const comment = /^\s*<!--[\s\S]*-->\s*$/.exec(raw)
    if (!comment) continue
    const known = /^\s*<!--\s*(?:memory(?:\s+tag)?\s*:|dsh-status\b|type[:=]|r4-ledger-doc-v1\s*-->|ledger-links:v1\s*-->|\/?(?:user|model)\s*-->)/i.test(raw)
    metadata.push({ name: 'html-comment', value: raw, line: index + 1, raw, known })
    if (!known) unknownFields.push({ source: 'document-comment', name: 'html-comment', value: raw, line: index + 1, raw })
  }
  return { metadata, declaredEventIds, invalidDeclaredEventIdLines }
}

/** Normalize only the declared R4 format differences, never arbitrary prose or whitespace. */
export function normalizeHandoffContentPre(input, options = {}) {
  const { text, rawBytes } = readInput(input)
  if (options.maxBytes !== undefined && (!Number.isSafeInteger(options.maxBytes) || options.maxBytes < 0)) throw invalid('handoff-max-bytes-invalid')
  if (options.maxBytes !== undefined && rawBytes.length > options.maxBytes) throw invalid('handoff-input-too-large')
  const withoutBom = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text
  const canonical = normalizeText(text)
  const base = normalizeLedgerForAudit(canonical)
  const normalizedContent = base.normalized
  const diagnostics = []
  const add = (code, count) => { if (count > 0) diagnostics.push({ code, count }) }
  add('utf8-bom-removed', text === withoutBom ? 0 : 1)
  add('crlf-normalized', (text.match(/\r\n/g) || []).length)
  add('cr-normalized', (withoutBom.replace(/\r\n/g, '').match(/\r/g) || []).length)
  add('trailing-whitespace-removed', canonical.split('\n').filter((line, index) => line !== withoutBom.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n')[index]).length)
  add('generated-h1-removed', base.removedGeneratedH1Count)
  add('protocol-metadata-removed', base.removedMetadataLineCount)
  const originalLines = canonical.split('\n')
  let leading = 0
  let trailing = 0
  while (leading < originalLines.length && originalLines[leading].trim() === '') leading++
  while (trailing < originalLines.length - leading && originalLines[originalLines.length - 1 - trailing].trim() === '') trailing++
  add('outer-blank-lines-removed', leading + trailing)
  const normalizedBytes = Buffer.from(normalizedContent, 'utf8')
  return {
    schemaVersion: 'batch2-handoff-normalization-v1',
    algorithm: HANDOFF_NORMALIZATION_ALGORITHM,
    baseAlgorithm: base.algorithm,
    normalizedContent,
    normalizedBytes: normalizedBytes.length,
    normalizedSha256: sha256(normalizedBytes),
    rawBytes: rawBytes.length,
    rawSha256: sha256(rawBytes),
    lineCount: text ? withoutBom.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n').length : 0,
    normalizedLineCount: normalizedContent ? normalizedContent.split('\n').length : 0,
    changed: !rawBytes.equals(normalizedBytes),
    diagnostics,
  }
}

/** Parse full source evidence; completeness is structural, not a coverage verdict. */
export function parseHandoffCoveragePre(input, options = {}) {
  const { text, unknownFields } = readInput(input)
  const normalization = normalizeHandoffContentPre(input, options)
  const canonical = normalizeText(text)
  const lines = canonical.split('\n')
  const parsed = parseLedgerForAudit(canonical)
  const regions = lineNumberRegions(lines)
  // Unlike the legacy quad-only parser, extra H2 sections are evidence, not
  // content to silently absorb into the preceding quad value.
  parsed.quad = parseQuadFromAllSections(lines)
  parsed.regionDigests = Object.fromEntries(regions.map((region) => [region.field || 'section:' + region.title, sha256(Buffer.from(region.body, 'utf8'))]))
  parsed.extraSectionNames = regions.filter((region) => region.field === null).map((region) => region.title)
  for (const key of QUAD_FIELDS) parsed.regionDigests[key] = parsed.quadPresence[key] ? sha256(Buffer.from(parsed.quad[key], 'utf8')) : null
  const noteResult = noteEvidence(lines)
  const metadata = metadataEvidence(lines, unknownFields)
  const anchors = []
  for (let index = 0; index < lines.length; index++) {
    const expression = /<!--\s*memory(\s+tag)?\s*:[\s\S]*?-->/g
    for (const match of lines[index].matchAll(expression)) {
      anchors.push({
        kind: match[1] ? 'memory-tag' : 'memory',
        value: match[0],
        id: /mem_[0-9a-f]{32}/.exec(match[0])?.[0] || null,
        line: index + 1,
        bytes: Buffer.byteLength(match[0], 'utf8'),
        sha256: sha256(Buffer.from(match[0], 'utf8')),
      })
    }
  }
  const normalizedQuad = {}
  const emptyListFields = []
  for (const key of QUAD_FIELDS) {
    if (parsed.quadPresence[key] && parsed.quad[key].trim() === '[]') {
      emptyListFields.push(key)
      parsed.quad[key] = ''
    }
  }
  const emptyFields = []
  const missingFields = []
  const missingRequiredFields = []
  const explicitNoneFields = []
  for (const key of QUAD_FIELDS) {
    normalizedQuad[key] = normalizeHandoffContentPre(parsed.quad[key]).normalizedContent
    if (!parsed.quadPresence[key]) missingFields.push(key)
    else if (parsed.quad[key].trim() === '') {
      emptyFields.push(key)
      if (REQUIRED_NONEMPTY.includes(key)) missingRequiredFields.push(key)
    }
    if (key === 'dead' && explicitNone(parsed.quad[key])) explicitNoneFields.push(key)
    if (!parsed.quadPresence[key] && REQUIRED_NONEMPTY.includes(key)) missingRequiredFields.push(key)
  }
  // Current checkpoint storage uses an empty string for no recorded failure.
  // Explicit-none is a different legacy audit value, never silently rewritten here.
  const ambiguousEmptyFields = []
  const reasons = [
    ...missingFields.map((field) => 'missing-section:' + field),
    ...missingRequiredFields.filter((field) => !missingFields.includes(field)).map((field) => 'empty-required-section:' + field),
    ...ambiguousEmptyFields.map((field) => 'ambiguous-empty-section:' + field),
    ...parsed.duplicateQuadRegions.map((field) => 'duplicate-section:' + field),
  ]
  const invalidDeclaredEventIdLines = metadata.invalidDeclaredEventIdLines
  if (invalidDeclaredEventIdLines) reasons.push('invalid-declared-event-id')
  const issues = [...noteResult.issues]
  for (const issue of issues) reasons.push(issue.code)
  const completeness = {
    presentCount: QUAD_FIELDS.filter((key) => parsed.quadPresence[key]).length,
    nonEmptyCount: QUAD_FIELDS.filter((key) => parsed.quad[key].trim() !== '').length,
    missingFields,
    emptyFields,
    missingRequiredFields,
    ambiguousEmptyFields,
    explicitNoneFields,
    requiredFieldsComplete: missingFields.length === 0 && missingRequiredFields.length === 0,
    complete: reasons.length === 0,
    reasonCodes: reasons,
    coverageGranted: false,
  }
  return {
    schemaVersion: HANDOFF_PARSE_SCHEMA,
    quad: parsed.quad,
    normalizedQuad,
    quadPresence: parsed.quadPresence,
    emptyListFields,
    sections: regions,
    extraSections: regions.filter((region) => region.field === null),
    notes: noteResult.notes,
    anchors,
    unknownFields,
    declaredEventIds: [...new Set(metadata.declaredEventIds)].sort(),
    invalidDeclaredEventIdLines,
    duplicateQuadRegions: parsed.duplicateQuadRegions,
    sectionNames: parsed.sectionNames,
    extraSectionNames: parsed.extraSectionNames,
    regionDigests: parsed.regionDigests,
    completeness,
    issues,
    normalization,
  }
}

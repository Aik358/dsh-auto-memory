import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { pathToFileURL } from 'node:url'
import {
  normalizeHandoffContentPre,
  parseHandoffCoveragePre,
  buildHandoffSourceProofPre,
  assessHandoffCoveragePre,
} from '../../lib/handoff-coverage.js'
import { normalizeText } from '../../lib/ledger-doc/protocol.js'
import { eventStorePre } from '../../lib/event-store.js'
import { computeLegacyCheckpointKey } from '../../lib/ledger-doc/protocol.js'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

process.on('exit', (code) => { if (code !== 0) process.exitCode = 1 })
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex')
const utf8 = (text) => Buffer.from(text, 'utf8')
const docSha = (text) => sha(normalizeText(text))

if (process.env.HANDOFF_MUTATION_PROBE && process.env.HANDOFF_MUTATION_LIB) {
  const mutantApi = await import(pathToFileURL(path.resolve(process.env.HANDOFF_MUTATION_LIB, 'handoff-coverage.js')).href)
  const probeBase = '# 交接账本 · synthetic\n\n## 目标\nDeliver the isolated synthetic proof.\n## 任务状态\nImplementation is running.\n## 已试方案与失败原因\n\n## 进度与下一步\nRun the isolated suite.\n## 相关文档\n- [synthetic-proof](docs/internal/SYNTHETIC.md)\n\n'
  const probeRoot = path.dirname(process.env.HANDOFF_MUTATION_LIB)
  const trusted = path.join(probeRoot, 'fixture', 'handoff')
  await fs.mkdir(trusted, { recursive: true })
  await fs.writeFile(path.join(trusted, 'current.md'), probeBase)
  await fs.writeFile(path.join(probeRoot, 'fixture', 'outside.md'), probeBase)
  const event = { id: 'evt_a1b2c3d4', status: 'active', checkpoints: [] }
  const checkpoint = {
    eventId: event.id,
    checkpointId: 'ckpt_0123456789abcdef',
    kind: 'handoff',
    sourceRef: 'current.md',
    text: probeBase,
    rawSha256: sha(utf8(probeBase)),
    normalizedSha256: docSha(probeBase),
    ...parseHandoffCoveragePre(probeBase).quad,
  }
  event.checkpoints.push(checkpoint)
  let result
  if (process.env.HANDOFF_MUTATION_PROBE === 'normalization-drops-semantic-content') {
    result = { equal: mutantApi.normalizeHandoffContentPre(probeBase).normalizedSha256 === mutantApi.normalizeHandoffContentPre(probeBase.replace('Deliver', 'Alter')).normalizedSha256 }
  } else if (process.env.HANDOFF_MUTATION_PROBE === 'source-ref-boundary-released') {
    const proof = await mutantApi.buildHandoffSourceProofPre({ sourceRef: '../outside.md' }, { handoffDir: trusted })
    result = { verified: proof.verified, code: proof.code, physicalPath: proof.physicalPath }
  } else if (process.env.HANDOFF_MUTATION_PROBE === 'missing-section-still-covered') {
    const fullProbeDocument = '# 交接账本 · synthetic\n\n## 目标\nDeliver the isolated synthetic proof.\n## 任务状态\nImplementation is running.\n## 已试方案与失败原因\n\n## 进度与下一步\nRun the isolated suite.\n## 相关文档\n- [synthetic-proof](docs/internal/SYNTHETIC.md)\n\n'
    const missing = fullProbeDocument.replace('## 已试方案与失败原因\n\n', '')
    await fs.writeFile(path.join(trusted, 'current.md'), missing)
    assert.equal(fullProbeDocument.includes('## 已试方案与失败原因'), true, 'full document must include section')
    assert.equal(missing.includes('## 已试方案与失败原因'), false, 'probe must remove section from checkpoint only, not from disk')
    checkpoint.text = missing
    checkpoint.rawSha256 = sha(utf8(missing))
    checkpoint.normalizedSha256 = docSha(missing)
    result = await mutantApi.assessHandoffCoveragePre({ documentText: missing, checkpoint, event }, { handoffDir: trusted, sourceRef: 'current.md' })
    result = { status: result.status, reasons: result.reasonCodes, gates: result.gates, sourceProof: result.sourceProof, comparison: result.quad.comparison }
  } else throw new Error('unknown-mutation-probe')
  process.stdout.write(JSON.stringify(result))
  process.exit(0)
}

const root = path.resolve('artifacts', '_batch2-2.9-handoff-coverage')
const mutationRoot = path.resolve('artifacts', '_batch2-2.9-handoff-coverage-mutations')
for (const directory of [root, mutationRoot]) {
  assert.equal(path.isAbsolute(directory), true)
  await fs.rm(directory, { recursive: true, force: true })
  await fs.mkdir(directory, { recursive: true })
}
const pass = []
const failures = []
const evidence = []
async function test(name, action) {
  try {
    const detail = await action()
    pass.push(name)
    evidence.push({ name, result: 'PASS', detail: detail || null })
    console.log('  ok   - ' + name + (detail ? ' :: ' + detail : ''))
  } catch (error) {
    failures.push({ name, error: error.stack || error.message })
    evidence.push({ name, result: 'FAIL', error: error.message })
    console.log('  FAIL - ' + name + ' :: ' + error.message)
  }
}
const active = { id: 'evt_a1b2c3d4', status: 'active', checkpoints: [] }
const makeCheckpoint = (text, overrides = {}) => {
  const checkpoint = {
  eventId: active.id,
  checkpointId: 'ckpt_0123456789abcdef',
  kind: 'handoff',
  sourceRef: 'handoff/current.md',
  text,
  rawSha256: sha(utf8(text)),
  normalizedSha256: docSha(text),
  ...Object.fromEntries(['goal', 'state', 'dead', 'next'].map((key) => [key, parseHandoffCoveragePre(text).quad[key]])),
  ...overrides,
  }
  active.checkpoints.push(checkpoint)
  return checkpoint
}
const base = [
  '# 交接账本 · synthetic',
  '',
  '## 目标',
  'Deliver the isolated synthetic proof.',
  '## 任务状态',
  'Implementation is running.',
  '## 已试方案与失败原因',
  '',
  '## 进度与下一步',
  'Run the isolated suite.',
  '## 相关文档',
  '- [synthetic-proof](docs/internal/SYNTHETIC.md)',
  '',
].join('\n')
const baseBytes = utf8(base)
const handoffDir = path.join(root, 'trusted', 'handoff')
await fs.mkdir(path.join(handoffDir, 'documents'), { recursive: true })
const sourcePath = path.join(handoffDir, 'current.md')
await fs.writeFile(sourcePath, baseBytes)
const options = { handoffDir }

console.log('=== real imports / normalization / full document evidence ===')
await test('N-01 CRLF/LF/CR and terminal newlines preserve the 2.9 normalized hash, not raw hash', () => {
  const crlf = normalizeHandoffContentPre(base.replace(/\n/g, '\r\n'))
  const cr = normalizeHandoffContentPre(base.replace(/\n/g, '\r'))
  const lf = normalizeHandoffContentPre(base)
  const extra = normalizeHandoffContentPre(base + '\n\n')
  assert.equal(crlf.normalizedSha256, lf.normalizedSha256)
  assert.equal(cr.normalizedSha256, lf.normalizedSha256)
  assert.equal(extra.normalizedSha256, lf.normalizedSha256)
  assert.notEqual(crlf.rawSha256, lf.rawSha256)
  assert.equal(lf.rawSha256, sha(baseBytes))
  assert.equal(lf.normalizedSha256.length, 64)
  assert.equal(lf.rawBytes, baseBytes.length)
  return JSON.stringify({ rawBytes: lf.rawBytes, normalizedBytes: lf.normalizedBytes, normalizedSha256: lf.normalizedSha256 })
})
await test('N-02 only generated H1, protocol metadata, trailing horizontal space and outer blank lines are equivalent', () => {
  const controlled = '\n# 交接账本 · generated\r\neventId = evt_a1b2c3d4\r\n<!-- dsh-status: current -->\r\n' + base.replace(/^# 交接账本 · synthetic\n/, '').replace(/\n/g, ' \t\r\n')
  const clean = base.replace(/^# 交接账本 · synthetic\n/, '').replace(/\s+$/g, '')
  const a = normalizeHandoffContentPre(controlled)
  const b = normalizeHandoffContentPre(clean)
  assert.equal(a.normalizedSha256, b.normalizedSha256)
  assert.ok(a.diagnostics.some((item) => item.code === 'protocol-metadata-removed'))
  assert.ok(a.diagnostics.some((item) => item.code === 'generated-h1-removed'))
  assert.equal(a.changed, true)
})
await test('N-03 semantic, intra-line whitespace and Markdown emphasis changes never normalize equal', () => {
  const baseline = normalizeHandoffContentPre(base)
  for (const changed of [base.replace('Deliver', 'Alter'), base.replace('is running', 'is  running'), base.replace('Deliver the', '**Deliver** the'), base.replace('相关文档', '另一个文档')]) {
    assert.notEqual(normalizeHandoffContentPre(changed).normalizedSha256, baseline.normalizedSha256)
  }
})
await test('N-04 input is immutable, repeated calls and JSON fields are deterministic', () => {
  const input = { text: base, unknownProtocolField: { future: true } }
  const before = JSON.stringify(input)
  const first = parseHandoffCoveragePre(input)
  const second = parseHandoffCoveragePre(input)
  assert.deepEqual(first, second)
  assert.deepEqual(Object.keys(first), Object.keys(second))
  assert.equal(JSON.stringify(input), before)
  assert.equal(first.unknownFields[0].name, 'unknownProtocolField')
  assert.deepEqual(first.unknownFields[0].value, { future: true })
  assert.equal(first.normalization.normalizedBytes, Buffer.byteLength(first.normalization.normalizedContent))
})
await test('N-05 malformed UTF-8, mismatched raw/text, bounds and invalid scalar quad values reject', () => {
  assert.throws(() => normalizeHandoffContentPre(Buffer.from([0x23, 0xff])), (error) => error.code === 'handoff-utf8-invalid')
  assert.throws(() => normalizeHandoffContentPre({ text: 'different', bytes: utf8(base) }), (error) => error.code === 'handoff-raw-text-mismatch')
  assert.throws(() => normalizeHandoffContentPre(base, { maxBytes: 2 }), (error) => error.code === 'handoff-input-too-large')
  assert.throws(() => normalizeHandoffContentPre(42), (error) => error.code === 'handoff-input-invalid')
})
await test('P-01 four sections retain extra section, user/model notes, anchors and line-numbered digests', () => {
  const text = base + '### 用户备注\n<!-- memory:mem_' + 'a'.repeat(32) + ' -->\n<!-- user -->\nSynthetic user note\n<!-- /user -->\n### 模型备注\nSynthetic model note\n'
  const parsed = parseHandoffCoveragePre(text)
  assert.equal(parsed.completeness.complete, true)
  assert.equal(parsed.completeness.presentCount, 4)
  assert.deepEqual(parsed.extraSectionNames, ['相关文档'])
  assert.deepEqual(parsed.notes.map((note) => note.kind), ['user', 'model'])
  assert.equal(parsed.notes[0].text.includes('Synthetic user note'), true)
  assert.equal(parsed.extraSections[0].text.includes('### 用户备注'), true)
  assert.equal(parsed.anchors.length, 1)
  assert.equal(parsed.anchors[0].id, 'mem_' + 'a'.repeat(32))
  assert.ok(parsed.sections.every((section) => section.startLine > 0 && section.endLine >= section.startLine))
  assert.ok(Object.values(parsed.regionDigests).every((value) => typeof value === 'string' && value.length === 64))
  assert.equal(parsed.issues.length, 0)
})
await test('P-02 missing, empty, text-only and duplicate structures are never declared complete', () => {
  const missing = parseHandoffCoveragePre('## 目标\nOnly goal\n')
  assert.equal(missing.completeness.complete, false)
  assert.deepEqual(missing.completeness.missingFields, ['state', 'dead', 'next'])
  const empty = parseHandoffCoveragePre(base.replace('Implementation is running.', ''))
  assert.equal(empty.completeness.complete, false)
  assert.ok(empty.completeness.missingRequiredFields.includes('state'))
  const textOnly = parseHandoffCoveragePre('unstructured synthetic text')
  assert.equal(textOnly.sections.length, 0)
  const duplicate = parseHandoffCoveragePre(base + '## 目标\nDuplicate goal\n')
  assert.deepEqual(duplicate.duplicateQuadRegions, ['goal'])
  assert.equal(duplicate.completeness.complete, false)
})
await test('P-03 empty dead stays distinguishable from explicit-none; no schema mutation', () => {
  const empty = parseHandoffCoveragePre(base)
  const explicit = parseHandoffCoveragePre(base.replace('## 已试方案与失败原因\n\n', '## 已试方案与失败原因\n无已确认失败\n'))
  assert.equal(empty.quad.dead, '')
  assert.equal(empty.completeness.complete, true)
  assert.deepEqual(empty.completeness.ambiguousEmptyFields, [])
  assert.equal(empty.completeness.explicitNoneFields.length, 0)
  assert.deepEqual(explicit.completeness.explicitNoneFields, ['dead'])
  assert.equal(empty.completeness.explicitNoneFields.includes('dead'), false)
  const list = parseHandoffCoveragePre(base.replace('## 已试方案与失败原因\n\n', '## 已试方案与失败原因\n[]\n'))
  assert.equal(list.quad.dead, '')
  assert.deepEqual(list.emptyListFields, ['dead'])
  assert.deepEqual(list.completeness.explicitNoneFields, [])
})
await test('P-04 long content is not truncated and unknown/unclosed note evidence remains reviewable', () => {
  const text = base + '## 长正文\n' + 'long synthetic line\n'.repeat(6000) + '<!-- user -->\nUnclosed note\n'
  const parsed = parseHandoffCoveragePre(text)
  assert.ok(parsed.normalization.rawBytes > 100000)
  assert.equal(parsed.sections.find((section) => section.title === '长正文').body.split('\n').length > 6000, true)
  assert.ok(parsed.notes.some((note) => note.closed === false))
  assert.equal(parsed.completeness.complete, false)
  assert.ok(parsed.issues.some((issue) => issue.code === 'unclosed-user-region'))
  return String(parsed.normalization.rawBytes) + ' bytes'
})
await test('P-05 invalid event declaration and current maintenance metadata are captured', () => {
  const valid = parseHandoffCoveragePre('# title\n<!-- r4-ledger-doc-v1 -->\ndocumentId: synthetic-261113-0001\neventIds: evt_a1b2c3d4\n' + base)
  assert.deepEqual(valid.declaredEventIds, ['evt_a1b2c3d4'])
  const invalid = parseHandoffCoveragePre('eventId = not-an-event\n' + base)
  assert.equal(invalid.invalidDeclaredEventIdLines, 1)
  assert.equal(invalid.completeness.complete, false)
})

console.log('=== actual trusted-root reads and source proof DTO ===')
const proof = await buildHandoffSourceProofPre({ documentText: base, sourceRef: 'handoff/current.md' }, options)
await test('S-01 real source proof reads trusted file and preserves raw/normalized/line evidence', () => {
  assert.equal(proof.ok, true, JSON.stringify(proof))
  assert.equal(proof.verified, true)
  assert.equal(proof.sourceRef, 'current.md')
  assert.equal(proof.rel, 'current.md')
  assert.equal(proof.rawSha256, sha(baseBytes))
  assert.equal(proof.sha256, proof.rawSha256)
  assert.equal(proof.documentNormalizedSha256, docSha(base))
  assert.equal(proof.normalizedSha256, normalizeHandoffContentPre(base).normalizedSha256)
  assert.equal(proof.bytes, baseBytes.length)
  assert.deepEqual(proof.lineRange, { start: 1, end: base.split('\n').length })
  assert.equal(proof.quoteLine, 1)
  assert.equal(proof.physicalPath, sourcePath)
  assert.equal(proof.pointerRead.rawEqual, true)
  assert.equal(proof.eligibleForPhysicalDelete, false)
  return JSON.stringify({ bytes: proof.bytes, rawSha256: proof.rawSha256, normalizedSha256: proof.normalizedSha256 })
})
await test('S-02 deterministic proof accepts raw UTF-8 bytes without coercion or side effects', async () => {
  const repeated = await buildHandoffSourceProofPre({ bytes: baseBytes, sourceRef: 'current.md' }, options)
  assert.deepEqual(repeated, proof)
  assert.equal(sha(await fs.readFile(sourcePath)), sha(baseBytes))
  const roots = await fs.readdir(handoffDir)
  assert.deepEqual(roots, ['current.md', 'documents'])
})
await test('S-03 CRLF real bytes retain raw identity and shared coverage identity', async () => {
  const crlf = base.replace(/\n/g, '\r\n')
  await fs.writeFile(sourcePath, crlf)
  const actual = await buildHandoffSourceProofPre({ documentText: crlf, sourceRef: 'current.md' }, options)
  assert.equal(actual.ok, true)
  assert.notEqual(actual.rawSha256, proof.rawSha256)
  assert.equal(actual.normalizedSha256, proof.normalizedSha256)
  assert.equal(actual.documentNormalizedSha256, proof.documentNormalizedSha256)
  assert.equal(actual.bytes, Buffer.byteLength(crlf))
  await fs.writeFile(sourcePath, baseBytes)
})
await test('S-04 invalid, absolute, dot-segment and archive sourceRef are rejected', async () => {
  for (const sourceRef of ['', '../outside.md', './current.md', 'D:/outside.md', '/outside.md', 'handoff/../../outside.md', 'archive/old.md', 'handoff']) {
    const actual = await buildHandoffSourceProofPre({ documentText: base, sourceRef }, options)
    assert.equal(actual.ok, false, sourceRef)
    assert.equal(actual.verified, false)
  }
})
await test('S-05 missing, raw drift and invalid line range are explicit failures', async () => {
  const missing = await buildHandoffSourceProofPre({ documentText: base, sourceRef: 'missing.md' }, options)
  assert.equal(missing.code, 'pointer-missing')
  const drift = await buildHandoffSourceProofPre({ documentText: base + 'different', expectDiskText: true, sourceRef: 'current.md' }, options)
  assert.equal(drift.code, 'source-text-mismatch')
  const mismatchedFingerprint = await buildHandoffSourceProofPre({ sourceRef: 'current.md', rawSha256: '0'.repeat(64) }, options)
  assert.equal(mismatchedFingerprint.code, 'source-raw-fingerprint-mismatch')
  const line = await buildHandoffSourceProofPre({ documentText: base, sourceRef: 'current.md' }, { ...options, quoteLine: 0 })
  assert.equal(line.code, 'source-line-invalid')
  const noRoot = await buildHandoffSourceProofPre({ documentText: base, sourceRef: 'current.md' })
  assert.equal(noRoot.code, 'source-root-required')
})
await test('S-06 real nested junction escape and file symlink never release outside bytes', async () => {
  const outside = path.join(root, 'outside')
  await fs.mkdir(outside)
  const outsideFile = path.join(handoffDir, '..', 'outside.md')
  await fs.writeFile(outsideFile, base)
  await fs.symlink(outside, path.join(handoffDir, 'escape'), 'junction')
  const nested = await buildHandoffSourceProofPre({ documentText: base, sourceRef: 'escape/outside.md' }, options)
  assert.equal(nested.ok, false)
  assert.equal(nested.code, 'pointer-unsafe')
  await fs.symlink(outsideFile, path.join(handoffDir, 'link.md'), 'file')
  const fileLink = await buildHandoffSourceProofPre({ documentText: base, sourceRef: 'link.md' }, options)
  assert.equal(fileLink.code, 'pointer-unsafe')
})
await test('S-07 trusted root symlink and malformed UTF-8 real file reject', async () => {
  const rootLink = path.join(root, 'root-link')
  await fs.symlink(handoffDir, rootLink, 'junction')
  assert.equal((await buildHandoffSourceProofPre({ documentText: base, sourceRef: 'current.md' }, { handoffDir: rootLink })).code, 'pointer-unsafe')
  await fs.writeFile(path.join(handoffDir, 'bad.md'), Buffer.from([0x23, 0xff]))
  const bytes = utf8(base)
  assert.throws(() => normalizeHandoffContentPre(Buffer.from([0x23, 0xff])), /handoff-utf8-invalid/)
  const invalid = await buildHandoffSourceProofPre({ documentText: base, sourceRef: 'bad.md' }, options)
  assert.equal(invalid.code, 'pointer-unsafe')
  assert.equal(bytes.length, baseBytes.length)
})

console.log('=== real coverage calls / no-claim / fail-closed negatives ===')
await test('C-01 full text, quad, identity, notes, anchors and raw/document fingerprints produce covered', async () => {
  const assessment = await assessHandoffCoveragePre({ documentText: base, checkpoint: makeCheckpoint(base), event: active }, options)
  assert.equal(assessment.status, 'covered', JSON.stringify(assessment.reasonCodes))
  assert.equal(assessment.historicalContentCovered, true)
  assert.equal(assessment.currentContentCovered, true)
  assert.equal(assessment.eventClaimed, false)
  assert.equal(assessment.eligibleForPhysicalDelete, false)
  assert.equal(assessment.eligibleForArchive, false)
  assert.equal(assessment.writesPerformed, false)
  assert.ok(Object.values(assessment.gates).every(Boolean))
})
await test('C-02 text-only without quad/fingerprints cannot be covered or auto-claim', async () => {
  const checkpoint = makeCheckpoint(base, { goal: undefined, state: undefined, dead: undefined, next: undefined, rawSha256: undefined, normalizedSha256: undefined })
  const assessment = await assessHandoffCoveragePre({ documentText: base, checkpoint, event: active }, options)
  assert.equal(assessment.status, 'partial')
  assert.equal(assessment.historicalContentCovered, false)
  assert.equal(assessment.eventClaimed, false)
  assert.ok(assessment.reasonCodes.includes('checkpoint-quad-missing:goal'))
  assert.ok(assessment.reasonCodes.includes('checkpoint-full-fingerprint-required'))
})
await test('C-03 missing section and empty required values never covered, even when copied into quad', async () => {
  const missing = base.replace('## 已试方案与失败原因\n\n', '')
  const missingResult = await assessHandoffCoveragePre({ documentText: missing, checkpoint: makeCheckpoint(missing), event: active }, options)
  assert.notEqual(missingResult.status, 'covered')
  assert.equal(missingResult.gates.quad, false)
  const empty = base.replace('Implementation is running.', '')
  const emptyResult = await assessHandoffCoveragePre({ documentText: empty, checkpoint: makeCheckpoint(empty), event: active }, options)
  assert.notEqual(emptyResult.status, 'covered')
  assert.ok(emptyResult.reasonCodes.includes('source-quad-incomplete:state'))
})
await test('C-04 equal normalized content with different raw bytes proves formatting only, not raw identity', async () => {
  const crlf = base.replace(/\n/g, '\r\n')
  const assessment = await assessHandoffCoveragePre({ documentText: crlf, checkpoint: makeCheckpoint(base), event: active }, options)
  assert.equal(assessment.content.fullTextEqual, true)
  assert.equal(assessment.content.sourceNormalizedSha256, assessment.content.normalizedTextSha256)
  assert.notEqual(assessment.status, 'covered')
  assert.ok(assessment.reasonCodes.includes('raw-sha256-mismatch'))
  assert.notEqual(sha(utf8(crlf)), sha(baseBytes))
})
await test('C-05 equal document fingerprint with prose drift rejects mismatched', async () => {
  const drift = base.replace('Deliver', 'Alter')
  const checkpoint = makeCheckpoint(drift, { normalizedSha256: docSha(base) })
  assert.equal(checkpoint.normalizedSha256, docSha(base))
  const assessment = await assessHandoffCoveragePre({ documentText: base, checkpoint, event: active }, options)
  assert.equal(assessment.status, 'mismatched')
  assert.equal(assessment.historicalContentCovered, false)
  assert.ok(assessment.reasonCodes.includes('normalized-content-mismatch'))
  assert.ok(assessment.reasonCodes.includes('quad-value-mismatch:goal'))
})
await test('C-06 raw fingerprint mismatch is diagnosed and cannot prove historical coverage', async () => {
  const checkpoint = makeCheckpoint(base, { rawSha256: '0'.repeat(64) })
  const assessment = await assessHandoffCoveragePre({ documentText: base, checkpoint, event: active }, options)
  assert.equal(assessment.historicalContentCovered, false)
  assert.notEqual(assessment.status, 'covered')
  assert.ok(assessment.reasonCodes.includes('checkpoint-raw-fingerprint-mismatch'))
  assert.ok(assessment.reasonCodes.includes('raw-sha256-mismatch'))
})
await test('C-07 extra source section, notes or anchors missing from checkpoint are mismatched', async () => {
  const extended = base + '### 用户备注\n<!-- memory:mem_' + 'b'.repeat(32) + ' -->\nSynthetic protected note\n'
  const checkpoint = makeCheckpoint(base)
  for (const key of ['goal', 'state', 'dead', 'next']) checkpoint[key] = parseHandoffCoveragePre(extended).quad[key]
  const assessment = await assessHandoffCoveragePre({ documentText: extended, checkpoint, event: active }, options)
  assert.equal(assessment.status, 'mismatched')
  assert.equal(assessment.content.regionDiffs.some((diff) => diff.regionId === 'section:相关文档'), true)
  assert.equal(assessment.content.extraSectionsPreserved, false)
  assert.ok(assessment.reasonCodes.includes('notes-not-preserved'))
  assert.ok(assessment.reasonCodes.includes('anchors-not-preserved'))
  assert.equal(assessment.eligibleForPhysicalDelete, false)
})
await test('C-08 no evidence or absent event cannot auto-claim an event', async () => {
  const assessment = await assessHandoffCoveragePre({ documentText: base, checkpoint: { kind: 'handoff' } }, options)
  assert.equal(assessment.event.id, null)
  assert.equal(assessment.eventClaimed, false)
  assert.notEqual(assessment.status, 'covered')
  assert.ok(assessment.reasonCodes.includes('event-id-required'))
  assert.ok(assessment.reasonCodes.includes('checkpoint-identity-required'))
  assert.ok(assessment.reasonCodes.includes('source-proof-required'))
})
await test('C-09 closed target and wrong event id are ineligible/mismatched, with no writes', async () => {
  const checkpoint = makeCheckpoint(base)
  const closed = await assessHandoffCoveragePre({ documentText: base, checkpoint, event: { ...active, status: 'closed' } }, { ...options, intent: 'write' })
  assert.equal(closed.status, 'ineligible')
  assert.equal(closed.code, 'event-target-closed')
  assert.equal(closed.writesPerformed, false)
  const wrong = await assessHandoffCoveragePre({ documentText: base, checkpoint: makeCheckpoint(base, { eventId: 'evt_deadbeef' }), event: active }, options)
  assert.equal(wrong.gates.identity, false)
  assert.ok(wrong.reasonCodes.includes('event-id-mismatch'))
  assert.notEqual(wrong.status, 'covered')
  assert.ok(wrong.reasonCodes.includes('event-id-mismatch'))
  const log = await assessHandoffCoveragePre({ documentText: base, checkpoint: makeCheckpoint(base, { kind: 'log' }), event: active }, options)
  assert.equal(log.status, 'ineligible')
})
await test('C-10 explicit-none vs empty is not normalized into covered', async () => {
  const checkpoint = makeCheckpoint(base, { dead: '无已确认失败' })
  const assessment = await assessHandoffCoveragePre({ documentText: base, checkpoint, event: active }, options)
  assert.equal(assessment.status, 'mismatched')
  assert.equal(assessment.quad.emptyVsExplicitNone[0].regionId, 'dead')
  assert.equal(assessment.historicalContentCovered, false)
})
await test('C-10b empty list is canonical empty failure, nonempty list is not text', async () => {
  const emptyList = await assessHandoffCoveragePre({ documentText: base, checkpoint: makeCheckpoint(base, { dead: [] }), event: active }, options)
  assert.equal(emptyList.status, 'covered')
  assert.equal(emptyList.quad.comparison.dead.checkpointEmpty, true)
  assert.equal(emptyList.quad.comparison.dead.checkpointExplicitNone, false)
  const listDocument = base.replace('## 已试方案与失败原因\n\n', '## 已试方案与失败原因\n[]\n')
  const parsedList = parseHandoffCoveragePre(listDocument)
  assert.equal(parsedList.normalizedQuad.dead, '')
  assert.equal(parsedList.completeness.complete, true)
  const nonempty = await assessHandoffCoveragePre({ documentText: base, checkpoint: makeCheckpoint(base, { dead: ['not scalar text'] }), event: active }, options)
  assert.notEqual(nonempty.status, 'covered')
  assert.ok(nonempty.reasonCodes.includes('checkpoint-quad-missing:dead'))
})
await test('C-11 current pointer alone cannot prove old full text', async () => {
  const checkpoint = makeCheckpoint(base)
  delete checkpoint.text
  const assessment = await assessHandoffCoveragePre({ documentText: base, checkpoint, event: active }, options)
  assert.equal(assessment.currentContentCovered, true)
  assert.equal(assessment.historicalContentCovered, false)
  assert.equal(assessment.status, 'partial')
  assert.ok(assessment.reasonCodes.includes('checkpoint-full-text-not-present'))
})
await test('C-12 stale supplied proof and multi-event declaration fail closed', async () => {
  const stale = await assessHandoffCoveragePre({ documentText: base, checkpoint: makeCheckpoint(base), event: active, sourceProof: { ...proof, rawSha256: '0'.repeat(64) } }, options)
  assert.equal(stale.status, 'mismatched')
  assert.ok(stale.reasonCodes.includes('source-proof-stale-or-mismatched'))
  const multi = 'events: evt_a1b2c3d4, evt_deadbeef\n' + base
  const result = await assessHandoffCoveragePre({ documentText: multi, checkpoint: makeCheckpoint(multi), event: active }, options)
  assert.equal(result.gates.identity, false)
  assert.equal(result.eventClaimed, false)
  assert.ok(result.reasonCodes.includes('multiple-declared-events-require-separate-evidence'))
})
await test('C-13 unsafe source and read failures are ineligible without event claims', async () => {
  const unsafe = await assessHandoffCoveragePre({ documentText: base, checkpoint: makeCheckpoint(base, { sourceRef: '../outside.md' }), event: active }, options)
  assert.equal(unsafe.status, 'ineligible')
  assert.equal(unsafe.code, 'source-ref-invalid')
  const missing = await assessHandoffCoveragePre({ documentText: base, checkpoint: makeCheckpoint(base, { sourceRef: 'missing.md' }), event: active }, options)
  assert.equal(missing.status, 'ineligible')
  assert.equal(missing.code, 'pointer-missing')
})
await test('C-14 legacy derived identity can be assessed only with explicit selector and event evidence', async () => {
  const checkpoint = makeCheckpoint(base, { checkpointId: undefined })
  checkpoint.checkpointIndex = active.checkpoints.indexOf(checkpoint)
  checkpoint.legacyCheckpointKey = computeLegacyCheckpointKey({ ...checkpoint, eventId: active.id, checkpointIndex: checkpoint.checkpointIndex, quad: Object.fromEntries(['goal', 'state', 'dead', 'next'].map((key) => [key, checkpoint[key] ?? null])) })
  const assessment = await assessHandoffCoveragePre({ documentText: base, checkpoint, event: active }, options)
  if (assessment.status !== 'covered') throw new Error('LEGACY-DIAG ' + JSON.stringify({ reasons: assessment.reasonCodes, identity: assessment.identity, gates: assessment.gates, proof: assessment.sourceProof, checkpointIndex: checkpoint.checkpointIndex, eventIndex: active.checkpoints.indexOf(checkpoint), legacyCheckpointKey: checkpoint.legacyCheckpointKey }))
  assert.equal(assessment.status, 'covered')
  assert.equal(assessment.identity.identityMode, 'legacy-derived')
  assert.equal(assessment.identity.checkpointIndex, checkpoint.checkpointIndex)
  const missingSelector = await assessHandoffCoveragePre({ documentText: base, checkpoint: { ...checkpoint, checkpointIndex: undefined }, event: active }, options)
  assert.notEqual(missingSelector.status, 'covered')
  const forged = await assessHandoffCoveragePre({ documentText: base, checkpoint: { ...checkpoint, legacyCheckpointKey: '0'.repeat(64) }, event: active }, options)
  assert.equal(forged.gates.identity, false)
  assert.ok(forged.reasonCodes.includes('checkpoint-identity-required'))
  let called = false
  const unsafeReader = await buildHandoffSourceProofPre({ sourceRef: '../outside.md' }, { ...options, readPointer: async () => { called = true; return { ok: true, text: base, rawSha256: sha(baseBytes), normalizedSha256: docSha(base) } } })
  assert.equal(unsafeReader.verified, false)
  assert.equal(called, false)
  const explicitRef = await buildHandoffSourceProofPre({ documentText: base, sourceRef: 'current.md' }, options)
  assert.equal(explicitRef.verified, true, JSON.stringify(explicitRef))
  assert.equal(explicitRef.rawSha256, sha(baseBytes))
  await fs.writeFile(sourcePath, base)
  const reloadedProof = await buildHandoffSourceProofPre({ sourceRef: 'current.md' }, options)
  assert.equal(reloadedProof.rawSha256, sha(baseBytes))
  assert.equal(reloadedProof.normalizedSha256, normalizeHandoffContentPre(base).normalizedSha256)
})
await test('C-15 duplicate sections reject even with identical quad text', async () => {
  const duplicated = base + '## 目标\nDeliver the isolated synthetic proof.\n'
  const assessment = await assessHandoffCoveragePre({ documentText: duplicated, checkpoint: makeCheckpoint(duplicated), event: active }, options)
  assert.notEqual(assessment.status, 'covered')
  assert.ok(assessment.reasonCodes.includes('duplicate-quad-region'))
})
await test('C-15b unknown document fields remain explicit review evidence', async () => {
  const withUnknown = 'futureProtocolField: retain-for-review\n' + base
  const parsed = parseHandoffCoveragePre(withUnknown)
  assert.equal(parsed.unknownFields.length, 1)
  assert.equal(parsed.unknownFields[0].name, 'futureProtocolField')
  const assessment = await assessHandoffCoveragePre({ documentText: withUnknown, checkpoint: makeCheckpoint(withUnknown), event: active }, options)
  assert.notEqual(assessment.status, 'covered')
  assert.ok(assessment.reasonCodes.includes('unknown-input-fields-not-provable'))
})

await test('C-16 real event membership rejects forged IDs and proof bytes stay immutable', async () => {
  const storePath = path.join(root, 'isolated-event-store.json')
  const event = await eventStorePre.create(storePath, { id: active.id, name: 'synthetic coverage event' })
  const checkpoint = makeCheckpoint(base)
  const appended = await eventStorePre.append(storePath, event.id, { checkpoint })
  assert.equal(appended.ok, true)
  const detail = await eventStorePre.detail(storePath, event.id)
  const selected = detail.event.checkpoints[0]
  selected.checkpointId = 'ckpt_0123456789abcdef'
  selected.rawSha256 = sha(utf8(selected.text))
  selected.normalizedSha256 = docSha(selected.text)
  selected.sourceRef = 'current.md'
  const assessment = await assessHandoffCoveragePre({ documentText: base, checkpoint: selected, event: detail.event }, options)
  assert.equal(assessment.status, 'covered', JSON.stringify(assessment.reasonCodes))
  assert.equal(assessment.event.bindingVerified, true)
  const forged = await assessHandoffCoveragePre({ documentText: base, checkpoint: { ...selected, eventId: 'evt_deadbeef' }, event: detail.event }, options)
  assert.equal(forged.gates.identity, false)
  assert.equal(forged.eventClaimed, false)
  const noMembership = await assessHandoffCoveragePre({ documentText: base, checkpoint: { ...selected }, event: detail.event }, options)
  assert.equal(noMembership.gates.identity, false)
  assert.equal(noMembership.eventClaimed, false)
  await eventStorePre.close(storePath, event.id, 'synthetic closed-target verification')
  const before = await fs.readFile(storePath)
  await assert.rejects(() => eventStorePre.append(storePath, event.id, { checkpoint: { ...selected, idemKey: 'new-write-after-close' } }), /closed/)
  assert.deepEqual(await fs.readFile(storePath), before)
  const writeAssessment = await assessHandoffCoveragePre({ documentText: base, checkpoint: selected, event: { ...detail.event, status: 'closed' } }, { ...options, intent: 'write' })
  assert.equal(writeAssessment.code, 'event-target-closed')
  assert.equal(writeAssessment.writesPerformed, false)
  assert.equal(sha(utf8(base)), proof.rawSha256)
})

console.log('=== isolated same-directory module mutations ===')
const dependencyFiles = [
  'handoff-coverage.js',
  'handoff-normalize.js',
  'event-pointer.js',
  'file-boundary.js',
  'ledger-doc/protocol.js',
  'ledger-doc/coverage-audit.js',
]
const mutationVariants = [
  {
    name: 'normalization-drops-semantic-content',
    file: 'ledger-doc/coverage-audit.js',
    anchor: "if (isGeneratedH1(line)) { removedGeneratedH1Count++; continue }",
    replacement: "if (isGeneratedH1(line)) { removedGeneratedH1Count++; continue }\n    if (/Deliver|Alter/.test(line)) continue",
    expected: (result) => result.equal === false,
    observed: (result) => result.equal === true,
  },
  {
    name: 'source-ref-boundary-released',
    file: 'handoff-coverage.js',
    edits: [
      ["if (parts.some((part) => !part || part === '.' || part === '..')) return null", "if (parts.some((part) => !part || part === '.')) return null"],
      ["if (parts.some((part) => part === '..' || part === '' || part === '.')) return failure('pointer-unsafe', { sourceRef })", "if (false) return failure('pointer-unsafe', { sourceRef })"],
      ["const physical = fileWithinRoots(candidate, [handoffDir], { strict: true, allowMissing: true })", "const physical = candidate"],
      ["const physical = fileWithinRoots(path.resolve(handoffDir, ...sourceRef.split('/')), [handoffDir], { strict: true, allowMissing: true })", "const physical = path.resolve(handoffDir, ...sourceRef.split('/'))"],
    ],
    expected: (result) => result.verified === false,
    observed: (result) => result.verified === true && result.physicalPath === path.join(mutationRoot, 'source-ref-boundary-released', 'fixture', 'outside.md'),
  },
  {
    name: 'missing-section-still-covered',
    file: 'handoff-coverage.js',
    edits: [
      ["const reasons = new Set(source.completeness.reasonCodes)", "const reasons = new Set()"],
      ["if (!source.quadPresence[field] || (field !== 'dead' && item.sourceEmpty)) review('source-quad-incomplete:' + field)", ""],
      ["const equal = sourcePresent && checkpointPresent && normalizedSource === normalizedCheckpoint", "const equal = checkpointPresent && normalizedSource === normalizedCheckpoint"],
      ["const quadPass = QUAD_FIELDS.every((key) => quad.comparison[key].equal) && !quad.emptyVsExplicitNone.length && source.completeness.complete", "const quadPass = QUAD_FIELDS.every((key) => quad.comparison[key].equal) && !quad.emptyVsExplicitNone.length"],
    ],
    expected: (result) => result.status !== 'covered',
    observed: (result) => result.status === 'covered',
  },
]
const selfPath = fileURLToPath(import.meta.url)
const mutationResults = []
for (const variant of mutationVariants) {
  const variantRoot = path.join(mutationRoot, variant.name)
  const directory = path.join(variantRoot, 'lib')
  const copies = new Map()
  for (const relative of dependencyFiles) {
    const target = path.join(directory, relative)
    await fs.mkdir(path.dirname(target), { recursive: true })
    const original = (await fs.readFile(path.join('lib', relative), 'utf8')).replace(/\r\n/g, '\n')
    copies.set(relative, original)
    await fs.writeFile(target, original)
    assert.equal(sha(await fs.readFile(target)), sha(original))
  }
  const source = copies.get(variant.file)
  const restore = async () => {
    for (const [relative, original] of copies) await fs.writeFile(path.join(directory, relative), original)
  }
  for (const [anchor, replacement] of variant.edits || [[variant.anchor, variant.replacement]]) {
    const owner = anchor.includes('relativeParts') || anchor.includes('fileWithinRoots(candidate') || anchor.includes("failure('pointer-unsafe'") ? 'event-pointer.js' : variant.file
    const target = path.join(directory, owner)
    const current = await fs.readFile(target, 'utf8')
    assert.equal(current.split(anchor).length - 1, 1, variant.name + ' anchor exactly once in ' + owner)
    await fs.writeFile(target, current.replace(anchor, replacement))
  }
  const probe = () => {
    const child = spawnSync(process.execPath, [selfPath], {
      cwd: path.resolve('.'),
      env: { ...process.env, HANDOFF_MUTATION_PROBE: variant.name, HANDOFF_MUTATION_LIB: directory },
      encoding: 'utf8',
      timeout: 30000,
      windowsHide: true,
    })
    assert.equal(child.status, 0, variant.name + ' probe stderr: ' + child.stderr)
    return JSON.parse(child.stdout)
  }
  const mutantResult = probe()
  await restore()
  const cleanResult = probe()
  await test('MUT-' + variant.name + ' CAUGHT by real clean/mutant behavior difference', () => {
    assert.equal(variant.expected(cleanResult), true, 'clean control: ' + JSON.stringify(cleanResult))
    assert.equal(variant.observed(mutantResult), true, 'mutant did not reach defect: ' + JSON.stringify(mutantResult))
    mutationResults.push({ name: variant.name, result: 'CAUGHT', clean: cleanResult, mutant: mutantResult })
  })
}
await test('MUT-clean-copy restores all three controls', () => {
  assert.equal(mutationResults.filter((item) => item.result === 'CAUGHT').length, mutationVariants.length)
  mutationResults.push({ name: 'clean-copy', result: 'GREEN', source: 'unmodified workspace imports used by all positive controls' })
})


const report = {
  schema: 'batch2-2.9-handoff-coverage-v1',
  pass: pass.length,
  fail: failures.length,
  failures,
  evidence,
  mutations: { caught: mutationResults.filter((item) => item.result === 'CAUGHT').length, missed: mutationVariants.length - mutationResults.filter((item) => item.result === 'CAUGHT').length, clean: 'GREEN', results: mutationResults },
  physical: {
    sourceBytes: baseBytes.length,
    sourceRawSha256: sha(baseBytes),
    sourceNormalizedSha256: proof.normalizedSha256,
    sourceDocumentNormalizedSha256: proof.documentNormalizedSha256,
    lines: base.split('\n').length,
    exports: ['normalizeHandoffContentPre', 'parseHandoffCoveragePre', 'buildHandoffSourceProofPre', 'assessHandoffCoveragePre'],
    isolationRoot: root,
    mutationRoot,
  },
  boundary: 'synthetic fixture only; read-only trusted handoff root; real create/close/rejected-append only inside isolated event-store fixture; no production memory, apply/merge/archive/delete, production wiring, or port access',
}
assert.equal(report.mutations.caught, 3)
assert.equal(report.mutations.missed, 0)
const reportPath = path.join(root, 'coverage-report.json')
await fs.writeFile(reportPath, JSON.stringify(report, null, 2) + '\n')
assert.equal(JSON.parse(await fs.readFile(reportPath, 'utf8')).pass, pass.length)
assert.equal(JSON.parse(await fs.readFile(reportPath, 'utf8')).fail, failures.length)
console.log('SUMMARY PASS ' + pass.length + ' / FAIL ' + failures.length)
console.log('MUTATION CAUGHT ' + report.mutations.caught + ' / MISSED ' + report.mutations.missed + '; CLEAN GREEN')
console.log('REPORT ' + reportPath)
process.exitCode = failures.length ? 1 : 0

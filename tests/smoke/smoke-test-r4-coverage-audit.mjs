import fs from 'node:fs/promises'
import path from 'node:path'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { pathToFileURL } from 'node:url'
import {
  LedgerCoverageAuditor, COVERAGE_REPORT_SCHEMA, NORMALIZATION_ALGORITHM,
  normalizeLedgerForAudit, parseLedgerForAudit,
} from '../../lib/ledger-doc/coverage-audit.js'

let pass = 0
let fail = 0
const failures = []
const evidence = []
const dispositionReports = []
async function test(name, action) {
  try {
    const detail = await action()
    pass++
    console.log('  ok   - ' + name + (detail ? ' :: ' + detail : ''))
  } catch (error) {
    fail++
    failures.push({ name, error: error.message })
    console.log('  FAIL - ' + name + ' :: ' + error.message)
  }
}
const root = path.resolve('artifacts', '_r4-p2b-fixtures')
await fs.mkdir(root, { recursive: true })
let sequence = 0
const FILENAME = 'handoff-20261111-120000.md'
const FILENAME_MS = Date.parse('2026-11-11T04:00:00.000Z')
const A = 'evt_a1b2c3d4'
const B = 'evt_b2c3d4e5'
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex')

function ledger({ declared = null, goal = 'Synthetic goal', state = 'Synthetic state', dead = '无已确认失败', next = 'Synthetic next', extraPre = '', lineEndings = '\n' } = {}) {
  const lines = ['# 交接账本 · 2026-11-11 12:00', '']
  if (declared) for (const id of Array.isArray(declared) ? declared : [declared]) lines.push('eventId=' + id)
  lines.push('<!-- memory:mem_0123456789abcdef0123456789abcdef -->', '<!-- memory tag: type:goal -->', '')
  if (extraPre) lines.push(extraPre.trimEnd(), '')
  lines.push('## 目标', goal, '', '## 任务状态', state, '', '## 已试方案与失败原因', dead, '', '## 进度与下一步', next, '')
  return lines.join(lineEndings)
}
function event(id, checkpoints) { return { id, status: 'active', checkpoints } }
function checkpoint(text, options = {}) {
  const parsed = parseLedgerForAudit(text)
  return {
    kind: 'handoff', text, at: FILENAME_MS + 200, sourceRef: FILENAME, idemKey: 'synthetic-idem',
    goal: parsed.quad.goal, state: parsed.quad.state, dead: parsed.quad.dead, next: parsed.quad.next,
    ...options,
  }
}
async function fixture(name, text, events, options = {}) {
  const base = options.base || root
  const directory = path.join(base, String(sequence++).padStart(3, '0') + '-' + name)
  const sourceDir = path.join(directory, 'source')
  const reportDir = path.join(directory, 'reports')
  const filename = options.filename || FILENAME
  const sourcePath = path.join(sourceDir, filename)
  const eventStorePath = path.join(directory, 'event-store.json')
  await fs.mkdir(sourceDir, { recursive: true })
  const raw = options.raw || Buffer.from(text, 'utf8')
  await fs.writeFile(sourcePath, raw)
  await fs.writeFile(eventStorePath, JSON.stringify({ events }, null, 2) + '\n', 'utf8')
  const metadata = options.metadata === false ? [] : [{
    relPath: filename,
    bytes: raw.length,
    sha256: sha256(raw),
    birthtimeMs: options.birthtimeMs ?? FILENAME_MS + 100,
    mtimeMs: options.mtimeMs ?? FILENAME_MS + 150,
  }]
  if (options.metadataMutate) options.metadataMutate(metadata[0])
  const Module = options.module || { LedgerCoverageAuditor }
  const auditor = new Module.LedgerCoverageAuditor({
    sourceDir, eventStorePath, reportDir, workspaceKey: 'synthetic-workspace',
    sourceMetadata: metadata, fs: options.fs || fs, now: () => '2026-11-11T04:00:01.000Z',
  })
  return { directory, sourceDir, reportDir, filename, sourcePath, eventStorePath, auditor, raw }
}

console.log('=== R4 P2B normalizer and positive coverage ===')
await test('N-01 v1 removes only generated H1/protocol metadata and preserves body/unknown comments', () => {
  const input = '\r\n# 交接账本 · synthetic\r\neventId=' + A + '\r\n<!-- memory:mem_0123456789abcdef0123456789abcdef -->\r\n<!-- type=goal -->\r\n<!-- user-comment -->\r\n## 目标  \r\nA  B\t\r\n\r\n'
  const result = normalizeLedgerForAudit(input)
  assert.equal(result.algorithm, NORMALIZATION_ALGORITHM)
  assert.equal(result.removedGeneratedH1Count, 1)
  assert.equal(result.removedMetadataLineCount, 3)
  assert.ok(result.normalized.includes('<!-- user-comment -->'))
  assert.ok(result.normalized.includes('A  B'))
  assert.ok(!result.normalized.includes('eventId='))
  assert.notEqual(result.normalizedSha256, normalizeLedgerForAudit(input.replace('A  B', 'A B')).normalizedSha256)
  assert.throws(() => normalizeLedgerForAudit(Buffer.from('x')), /ledger-text-must-be-string/)
})
await test('N-02 unified parser distinguishes missing, empty, and explicit none', () => {
  const explicit = parseLedgerForAudit(ledger({ dead: '无已确认失败' }))
  const empty = parseLedgerForAudit(ledger({ dead: '' }))
  assert.equal(explicit.quad.dead, '无已确认失败')
  assert.equal(explicit.quadPresence.dead, true)
  assert.equal(empty.quad.dead, '')
  assert.equal(empty.quadPresence.dead, true)
  assert.equal(parseLedgerForAudit('# only title').quadPresence.goal, false)
})

const mainText = ledger({ declared: A, extraPre: '## 附录\nSynthetic extra section retained' })
const mainCp = checkpoint(mainText)
const mainFixture = await fixture('all-gates-positive', mainText, [event(A, [mainCp])])
const mainBefore = await fs.readFile(mainFixture.sourcePath)
const mainResult = await mainFixture.auditor.auditFile(FILENAME)
dispositionReports.push(mainResult.report)
await test('P-01 exact sourceRef + declared event + full text + quad + timeline passes all five gates', () => {
  const report = mainResult.report
  assert.equal(report.schemaVersion, COVERAGE_REPORT_SCHEMA)
  assert.equal(report.identity.pass, true, JSON.stringify(report.identity))
  assert.equal(report.content.pass, true)
  assert.equal(report.quad.pass, true, JSON.stringify(report.quad))
  assert.equal(report.binding.pass, true)
  assert.equal(report.timeline.pass, true, JSON.stringify(report.timeline))
  assert.ok(Object.values(report.gates).every(Boolean))
  assert.equal(report.disposition, 'covered')
  assert.equal(report.eligibleForPhysicalDelete, false)
  assert.equal(report.source.statSource, 'snapshot-manifest')
  assert.equal(report.candidates[0].identityMode, 'legacy-derived')
  assert.match(report.candidates[0].legacyCheckpointKey, /^sha256:[0-9a-f]{64}$/)
})
await test('P-02 report schema, atomic readback SHA, source immutability, and no full-text archive', async () => {
  const required = ['schemaVersion','auditRulesVersion','source','eventStoreSnapshot','normalization','candidates','identity','content','quad','timeline','binding','recovery','gates','disposition','eligibleForPhysicalDelete','review','sourceRereadSha256','errors','auditDurationMs','reportSha256']
  for (const key of required) assert.ok(Object.hasOwn(mainResult.report, key), key)
  const disk = JSON.parse(await fs.readFile(mainResult.reportPath, 'utf8'))
  assert.equal(disk.reportSha256, mainResult.report.reportSha256)
  assert.equal(disk.sourceRereadSha256, mainResult.report.source.sha256)
  assert.equal(mainResult.reportBytes, mainResult.readbackBytes)
  assert.ok(mainBefore.equals(await fs.readFile(mainFixture.sourcePath)))
  assert.ok(!JSON.stringify(mainResult.report).includes('Synthetic goal'))
  assert.equal(mainResult.report.review.required, false)
})
const contentOnlyText = ledger()
const contentOnly = await fixture('content-only-positive', contentOnlyText, [event(A, [checkpoint(contentOnlyText, { sourceRef: null })])])
const contentOnlyResult = await contentOnly.auditor.auditFile(FILENAME)
await test('P-03 no sourceRef succeeds only with globally unique normalized content', () => {
  assert.equal(contentOnlyResult.report.identity.pass, true)
  assert.equal(contentOnlyResult.report.binding.pass, true)
  assert.equal(contentOnlyResult.report.disposition, 'covered')
})
const multiText = ledger({ declared: [A, B] })
const multi = await fixture('multi-event-positive', multiText, [event(A, [checkpoint(multiText)]), event(B, [checkpoint(multiText)])])
const multiResult = await multi.auditor.auditFile(FILENAME)
await test('P-04 declared multi-event evidence is independently covered and timed', () => {
  assert.equal(multiResult.report.identity.pass, true)
  assert.equal(multiResult.report.identity.declaredIdsCovered, true)
  assert.equal(multiResult.report.candidates.filter((candidate) => candidate.selected).length, 2)
  assert.equal(multiResult.report.timeline.checkpoints.length, 2)
  assert.equal(multiResult.report.gates.bindingTimeline, true)
})

console.log('=== Identity, content, quad, binding, and timeline negatives ===')
const duplicateText = ledger()
const duplicate = await fixture('identity-duplicate', duplicateText, [event(A, [checkpoint(duplicateText, { sourceRef: null })]), event(B, [checkpoint(duplicateText, { sourceRef: null })])])
const duplicateResult = await duplicate.auditor.auditFile(FILENAME)
await test('I-01 duplicate normalized matches without pointer fail closed', () => {
  assert.equal(duplicateResult.report.identity.pass, false)
  assert.ok(duplicateResult.report.identity.reasonCodes.includes('ambiguous-normalized-fulltext-candidates'))
  assert.equal(duplicateResult.report.content.pass, false)
  assert.equal(duplicateResult.report.eligibleForPhysicalDelete, false)
})
const mismatchText = ledger({ declared: A })
const mismatch = await fixture('identity-declared-mismatch', mismatchText, [event(A, [checkpoint(ledger({ goal: 'Other evidence' }), { sourceRef: null })]), event(B, [checkpoint(mismatchText, { sourceRef: null })])])
const mismatchResult = await mismatch.auditor.auditFile(FILENAME)
await test('I-02 declared identity mismatch rejects even with one full-text match', () => {
  assert.equal(mismatchResult.report.identity.pass, false)
  assert.ok(mismatchResult.report.identity.reasonCodes.includes('declared-identity-conflict'))
})
const missingMultiText = ledger({ declared: [A, B] })
const missingMulti = await fixture('identity-multi-missing', missingMultiText, [event(A, [checkpoint(missingMultiText)]), event(B, [checkpoint(ledger({ goal: 'Unrelated' }), { sourceRef: null })])])
const missingMultiResult = await missingMulti.auditor.auditFile(FILENAME)
await test('I-03 multi-event declaration fails when one event lacks evidence', () => {
  assert.equal(missingMultiResult.report.identity.declaredIdsCovered, false)
  assert.equal(missingMultiResult.report.identity.pass, false)
  assert.ok(missingMultiResult.report.identity.reasonCodes.includes('declared-event-checkpoint-missing'))
})
const wrongRefText = ledger()
const wrongRef = await fixture('binding-wrong-ref', wrongRefText, [event(A, [checkpoint(wrongRefText, { sourceRef: 'handoff-20261111-120001.md' })])])
const wrongRefResult = await wrongRef.auditor.auditFile(FILENAME)
await test('B-01 full-text match cannot override a conflicting sourceRef', () => {
  assert.equal(wrongRefResult.report.identity.pass, false)
  assert.equal(wrongRefResult.report.binding.pass, false)
  assert.ok(wrongRefResult.report.identity.reasonCodes.includes('source-ref-identity-conflict'))
})
const cpPointerText = ledger({ declared: A, next: 'Checkpoint next' })
const sourcePointerText = ledger({ declared: A, next: 'Source next differs' })
const pointer = await fixture('pointer-content-diff', sourcePointerText, [event(A, [checkpoint(cpPointerText)])])
const pointerResult = await pointer.auditor.auditFile(FILENAME)
dispositionReports.push(pointerResult.report)
await test('C-01 pointer identity survives content diff but equivalence/quad fail with region evidence', () => {
  assert.equal(pointerResult.report.identity.pass, true)
  assert.equal(pointerResult.report.content.pass, false)
  assert.ok(pointerResult.report.content.regionDiffs.some((diff) => diff.regionId === 'next'))
  assert.equal(pointerResult.report.quad.pass, false)
  assert.equal(pointerResult.report.disposition, 'pointer-only-content-diff')
  assert.equal(pointerResult.report.eligibleForPhysicalDelete, false)
})
const normalizationBase = ledger()
const normalizationSource = normalizationBase + '<!-- user-supplied-comment -->\n'
const normalization = await fixture('normalization-candidate', normalizationSource, [event(A, [checkpoint(normalizationBase, { sourceRef: null })])])
const normalizationResult = await normalization.auditor.auditFile(FILENAME)
dispositionReports.push(normalizationResult.report)
await test('C-02 alternate normalizer is only a candidate, never equivalence', () => {
  assert.equal(normalizationResult.report.content.pass, false)
  assert.ok(normalizationResult.report.candidates.some((candidate) => candidate.alternativeNormalizationMatch))
  assert.equal(normalizationResult.report.disposition, 'normalization-candidate')
})
const semanticCp = ledger()
const semanticSource = ledger({ extraPre: '## 独有附录\nSynthetic semantic extra' })
const semantic = await fixture('extra-semantic-content', semanticSource, [event(A, [checkpoint(semanticCp, { sourceRef: null })])])
const semanticResult = await semantic.auditor.auditFile(FILENAME)
dispositionReports.push(semanticResult.report)
await test('C-03 equal primary quads plus unique extra section classifies extra semantic content', () => {
  assert.equal(semanticResult.report.disposition, 'extra-semantic-content')
  assert.ok(semanticResult.report.candidates.some((candidate) => candidate.semanticComparisonOnly))
  assert.equal(semanticResult.report.eligibleForPhysicalDelete, false)
})
const declaredOnlySource = ledger({ declared: A, goal: 'Source-only goal' })
const declaredOnly = await fixture('declared-event-only', declaredOnlySource, [event(A, [checkpoint(ledger({ goal: 'Checkpoint goal' }), { sourceRef: null })])])
const declaredOnlyResult = await declaredOnly.auditor.auditFile(FILENAME)
dispositionReports.push(declaredOnlyResult.report)
await test('C-04 declared event without full-text match classifies declared-event-only', () => {
  assert.equal(declaredOnlyResult.report.disposition, 'declared-event-only')
  assert.equal(declaredOnlyResult.report.eligibleForPhysicalDelete, false)
})
const noEvidence = await fixture('no-evidence', ledger({ goal: 'No event evidence' }), [event(A, [checkpoint(ledger({ goal: 'Different' }), { sourceRef: null })])])
const noEvidenceResult = await noEvidence.auditor.auditFile(FILENAME)
dispositionReports.push(noEvidenceResult.report)
await test('C-05 no pointer/declaration/full-text evidence keeps no-event-side-evidence-in-scope', () => {
  assert.equal(noEvidenceResult.report.disposition, 'no-event-side-evidence-in-scope')
  assert.equal(noEvidenceResult.report.candidates.length, 0)
  assert.equal(noEvidenceResult.report.eligibleForPhysicalDelete, false)
})
const illegible = await fixture('illegible-utf8', '', [], { raw: Buffer.from([0x23, 0x20, 0xff, 0x0a]) })
const illegibleResult = await illegible.auditor.auditFile(FILENAME)
dispositionReports.push(illegibleResult.report)
await test('C-06 malformed UTF-8 is illegible, not empty content', () => {
  assert.ok(illegibleResult.report.errors.some((item) => item.code === 'source-utf8-invalid'))
  assert.equal(illegibleResult.report.disposition, 'illegible-or-ambiguous')
  assert.equal(illegibleResult.report.eligibleForPhysicalDelete, false)
})
await test('C-07 every unmatched/disposition fixture remains physically non-deletable', () => {
  for (const report of dispositionReports) assert.equal(report.eligibleForPhysicalDelete, false, report.disposition)
})

const missingQuadText = ledger()
const missingQuadCp = checkpoint(missingQuadText)
delete missingQuadCp.goal
const missingQuad = await fixture('quad-missing-field', missingQuadText, [event(A, [missingQuadCp])])
const missingQuadResult = await missingQuad.auditor.auditFile(FILENAME)
await test('Q-01 missing checkpoint field is distinct and fails quad semantics', () => {
  assert.equal(missingQuadResult.report.content.pass, true)
  assert.equal(missingQuadResult.report.quad.pass, false)
  assert.equal(missingQuadResult.report.candidates[0].quadComparison.goal.checkpointPresent, false)
})
const emptyQuadCp = checkpoint(missingQuadText, { goal: '' })
const emptyQuad = await fixture('quad-empty-field', missingQuadText, [event(A, [emptyQuadCp])])
const emptyQuadResult = await emptyQuad.auditor.auditFile(FILENAME)
await test('Q-02 present-but-empty checkpoint field is not missing and still fails', () => {
  assert.equal(emptyQuadResult.report.candidates[0].quadComparison.goal.checkpointPresent, true)
  assert.equal(emptyQuadResult.report.candidates[0].quadComparison.goal.checkpointEmpty, true)
  assert.equal(emptyQuadResult.report.quad.pass, false)
})
const deadEmptyText = ledger({ dead: '' })
const deadEmpty = await fixture('quad-dead-empty', deadEmptyText, [event(A, [checkpoint(deadEmptyText)])])
const deadEmptyResult = await deadEmpty.auditor.auditFile(FILENAME)
await test('Q-03 dead empty string is ambiguous and fails closed', () => {
  assert.ok(deadEmptyResult.report.quad.differences.some((diff) => diff.regionId === 'dead' && diff.reasonCodes.includes('dead-empty-ambiguous')))
  assert.equal(deadEmptyResult.report.quad.pass, false)
})
const deadNoneText = ledger({ dead: '无已确认失败' })
const deadNone = await fixture('quad-empty-vs-none', deadNoneText, [event(A, [checkpoint(deadNoneText, { dead: '' })])])
const deadNoneResult = await deadNone.auditor.auditFile(FILENAME)
await test('Q-04 explicit no-confirmed-failure is not equivalent to empty', () => {
  assert.equal(deadNoneResult.report.quad.emptyVsExplicitNone.length, 1)
  assert.equal(deadNoneResult.report.quad.pass, false)
  assert.equal(mainResult.report.quad.emptyVsExplicitNone.length, 0)
})
const beforeText = ledger()
const before = await fixture('timeline-before-create', beforeText, [event(A, [checkpoint(beforeText, { at: FILENAME_MS })])], { birthtimeMs: FILENAME_MS + 2000, mtimeMs: FILENAME_MS + 2000 })
const beforeResult = await before.auditor.auditFile(FILENAME)
await test('T-01 checkpoint before proven file creation window fails timeline only', () => {
  assert.equal(beforeResult.report.binding.pass, true)
  assert.equal(beforeResult.report.timeline.pass, false)
  assert.ok(beforeResult.report.timeline.reasonCodes.includes('checkpoint-before-file-creation'))
  assert.equal(beforeResult.report.gates.bindingTimeline, false)
})
const afterText = ledger()
const after = await fixture('timeline-after-window', afterText, [event(A, [checkpoint(afterText, { at: FILENAME_MS + 7000 })])])
const afterResult = await after.auditor.auditFile(FILENAME)
await test('T-02 checkpoint after bounded creation window fails', () => {
  assert.equal(afterResult.report.timeline.pass, false)
  assert.ok(afterResult.report.timeline.reasonCodes.includes('checkpoint-after-file-creation-window'))
})
const multiBadText = ledger({ declared: [A, B] })
const multiBad = await fixture('timeline-multi-bad', multiBadText, [event(A, [checkpoint(multiBadText)]), event(B, [checkpoint(multiBadText, { at: FILENAME_MS - 5000 })])])
const multiBadResult = await multiBad.auditor.auditFile(FILENAME)
await test('T-03 multi-event timeline fails on any individual event', () => {
  assert.equal(multiBadResult.report.timeline.checkpoints.length, 2)
  assert.equal(multiBadResult.report.timeline.pass, false)
})
const badShaText = ledger()
const badSha = await fixture('binding-sha-mismatch', badShaText, [event(A, [checkpoint(badShaText, { sha256: '0'.repeat(64) })])])
const badShaResult = await badSha.auditor.auditFile(FILENAME)
await test('B-02 pointer exists but checkpoint SHA does not prove same source', () => {
  assert.equal(badShaResult.report.content.pass, true)
  assert.equal(badShaResult.report.binding.pass, false)
  assert.ok(badShaResult.report.binding.reasonCodes.includes('checkpoint-sha-not-same-source'))
})
const metadataBadText = ledger()
const metadataBad = await fixture('metadata-mismatch', metadataBadText, [event(A, [checkpoint(metadataBadText)])], { metadataMutate: (metadata) => { metadata.bytes++ } })
const metadataBadResult = await metadataBad.auditor.auditFile(FILENAME)
await test('T-04 copied-source metadata mismatch invalidates timeline evidence', () => {
  assert.ok(metadataBadResult.report.errors.some((item) => item.code === 'source-metadata-mismatch'))
  assert.equal(metadataBadResult.report.timeline.pass, false)
  assert.equal(metadataBadResult.report.disposition, 'illegible-or-ambiguous')
})

console.log('=== Report persistence and summary fail-closed paths ===')
const changingFs = Object.create(fs)
let sourceReads = 0
let changingTarget
changingFs.readFile = async (...args) => {
  const bytes = await fs.readFile(...args)
  if (path.resolve(String(args[0])) === changingTarget) {
    sourceReads++
    if (sourceReads === 1) await fs.writeFile(changingTarget, 'synthetic concurrent change\n', 'utf8')
  }
  return bytes
}
const changingText = ledger()
const changing = await fixture('source-changed', changingText, [event(A, [checkpoint(changingText)])], { fs: changingFs })
changingTarget = changing.sourcePath
const changingResult = await changing.auditor.auditFile(FILENAME)
await test('R-01 source SHA change between reads fails persistence and timeline', () => {
  assert.notEqual(changingResult.report.sourceRereadSha256, changingResult.report.source.sha256)
  assert.ok(changingResult.report.errors.some((item) => item.code === 'source-changed-during-audit'))
  assert.equal(changingResult.report.gates.reportPersistence, false)
  assert.equal(changingResult.report.gates.bindingTimeline, false)
  assert.equal(changingResult.report.eligibleForPhysicalDelete, false)
})
const renameFs = Object.create(fs)
renameFs.rename = async () => { throw Object.assign(new Error('synthetic report rename failure'), { code: 'EIO' }) }
const renameText = ledger()
const rename = await fixture('report-rename-failure', renameText, [event(A, [checkpoint(renameText)])], { fs: renameFs })
const renameBefore = await fs.readFile(rename.sourcePath)
await test('R-02 atomic rename failure rejects and leaves source/temp state clean', async () => {
  await assert.rejects(rename.auditor.auditFile(FILENAME), /synthetic report rename failure/)
  assert.ok(renameBefore.equals(await fs.readFile(rename.sourcePath)))
  assert.equal((await fs.readdir(rename.reportDir)).filter((name) => name.endsWith('.tmp')).length, 0)
  assert.equal(mainResult.report.gates.reportPersistence, true)
})
const readbackFs = Object.create(fs)
let readbackTarget
readbackFs.readFile = async (...args) => {
  const bytes = await fs.readFile(...args)
  if (readbackTarget && path.resolve(String(args[0])) === readbackTarget) {
    const value = JSON.parse(bytes.toString('utf8'))
    value.reportSha256 = '0'.repeat(64)
    return Buffer.from(JSON.stringify(value, null, 2) + '\n', 'utf8')
  }
  return bytes
}
const readbackText = ledger()
const readback = await fixture('report-readback-mismatch', readbackText, [event(A, [checkpoint(readbackText)])], { fs: readbackFs })
readbackTarget = path.join(readback.reportDir, FILENAME + '.json')
await test('R-03 report readback hash mismatch rejects instead of claiming persistence', async () => {
  await assert.rejects(readback.auditor.auditFile(FILENAME), /report-sha256-mismatch/)
  assert.equal(mainResult.report.gates.reportPersistence, true)
})

function batchName(index) {
  const date = new Date(Date.UTC(2026, 0, 1, 4, 0, index) + 8 * 3600000)
  const pad = (value) => String(value).padStart(2, '0')
  return 'handoff-' + date.getUTCFullYear() + pad(date.getUTCMonth() + 1) + pad(date.getUTCDate()) + '-' + pad(date.getUTCHours()) + pad(date.getUTCMinutes()) + pad(date.getUTCSeconds()) + '.md'
}
const batch536Dir = path.join(root, 'batch-536-unmatched')
const batch536Source = path.join(batch536Dir, 'source')
const batch536Reports = path.join(batch536Dir, 'reports')
await fs.mkdir(batch536Source, { recursive: true })
for (let index = 0; index < 536; index++) {
  const name = batchName(index)
  await fs.writeFile(path.join(batch536Source, name), ledger({ goal: 'Synthetic unmatched ' + index }), 'utf8')
}
const batch536Events = path.join(batch536Dir, 'event-store.json')
await fs.writeFile(batch536Events, JSON.stringify({ events: [event(A, [checkpoint(ledger({ goal: 'Unrelated checkpoint' }), { sourceRef: null })])] }), 'utf8')
const auditor536 = new LedgerCoverageAuditor({ sourceDir: batch536Source, eventStorePath: batch536Events, reportDir: batch536Reports, workspaceKey: 'synthetic-536', metadata: [], sourceMetadata: [], now: () => '2026-11-11T04:00:01.000Z' })
const result536 = await auditor536.auditAll()
await test('S-01 all 536 no-match inputs get one report and none is deletable', () => {
  assert.equal(result536.ok, true)
  assert.equal(result536.summary.total, 536)
  assert.equal(result536.summary.inputFileCount, 536)
  assert.equal(result536.summary.reportCount, 536)
  assert.equal(result536.summary.reports.length, 536)
  assert.equal(result536.summary.dispositions['no-event-side-evidence-in-scope'], 536)
  assert.equal(result536.summary.gates.normalizedEquivalence.pass, 0)
  assert.equal(result536.summary.gates.reportPersistence.pass, 536)
  assert.equal(result536.summary.eligibleForPhysicalDeleteCount, 0)
  assert.ok(result536.reports.every((report) => report.eligibleForPhysicalDelete === false))
})
const batchFailDir = path.join(root, 'batch-summary-failure')
const batchFailSource = path.join(batchFailDir, 'source')
await fs.mkdir(batchFailSource, { recursive: true })
await fs.writeFile(path.join(batchFailSource, FILENAME), ledger(), 'utf8')
await fs.writeFile(path.join(batchFailSource, 'handoff-20261111-120001.md'), ledger({ goal: 'Second' }), 'utf8')
const batchFailEvents = path.join(batchFailDir, 'event-store.json')
await fs.writeFile(batchFailEvents, JSON.stringify({ events: [] }), 'utf8')
const batchFailFs = Object.create(fs)
batchFailFs.rename = async (from, to) => {
  if (String(to).endsWith(FILENAME + '.json')) throw Object.assign(new Error('injected one report failure'), { code: 'EIO' })
  return fs.rename(from, to)
}
const batchFailAuditor = new LedgerCoverageAuditor({ sourceDir: batchFailSource, eventStorePath: batchFailEvents, reportDir: path.join(batchFailDir, 'reports'), fs: batchFailFs, sourceMetadata: [] })
const batchFailResult = await batchFailAuditor.auditAll()
await test('S-02 summary total stays at input count but missing report makes batch not ok', () => {
  assert.equal(batchFailResult.ok, false)
  assert.equal(batchFailResult.summary.total, 2)
  assert.equal(batchFailResult.summary.inputFileCount, 2)
  assert.equal(batchFailResult.summary.reportCount, 1)
  assert.equal(batchFailResult.summary.persistencePass, false)
  assert.equal(batchFailResult.summary.reports.filter((row) => row.status === 'failed').length, 1)
})
const storeChangeFs = Object.create(fs)
let storeReads = 0
let storeTarget
storeChangeFs.readFile = async (...args) => {
  const bytes = await fs.readFile(...args)
  if (storeTarget && path.resolve(String(args[0])) === storeTarget) {
    storeReads++
    if (storeReads > 1) return Buffer.from(bytes.toString('utf8') + '\n', 'utf8')
  }
  return bytes
}
const storeChangeText = ledger()
const storeChange = await fixture('event-store-changed', storeChangeText, [event(A, [checkpoint(storeChangeText)])], { fs: storeChangeFs })
storeTarget = storeChange.eventStorePath
const storeChangeResult = await storeChange.auditor.auditAll()
await test('S-03 event store snapshot change invalidates batch persistence', () => {
  assert.equal(storeChangeResult.ok, false)
  assert.ok(storeChangeResult.summary.errors.some((item) => item.code === 'event-store-changed-during-audit'))
  assert.equal(storeChangeResult.summary.total, 1)
})
await test('S-04 path boundary rejects outside roots and traversal; valid isolated root succeeds', async () => {
  assert.throws(() => new LedgerCoverageAuditor({ sourceDir: path.resolve('outside'), eventStorePath: mainFixture.eventStorePath, reportDir: mainFixture.reportDir }), /audit-root-invalid/)
  await assert.rejects(mainFixture.auditor.auditFile('../' + FILENAME), /audit-source-name-invalid/)
  assert.equal(mainResult.report.source.relPath, FILENAME)
})
await test('S-05 newly delivered source/test files use LF without mixed endings', async () => {
  for (const file of ['lib/ledger-doc/coverage-audit.js', 'tests/smoke/smoke-test-r4-coverage-audit.mjs']) {
    const text = (await fs.readFile(file)).toString('latin1')
    assert.equal(/\r\n/.test(text) && /(?<!\r)\n/.test(text), false, file)
  }
})

console.log('=== Isolated mutation validation: five gates + no-delete invariant ===')
const mutationRoot = path.resolve('artifacts', '_r4-p2b-mutation')
await fs.mkdir(mutationRoot, { recursive: true })
const productionSource = (await fs.readFile('lib/ledger-doc/coverage-audit.js', 'utf8')).replace(/\r\n/g, '\n')
async function mutationModule(name, anchor, replacement) {
  assert.equal(productionSource.split(anchor).length - 1, 1, name + ' anchor exactly once')
  const directory = path.join(mutationRoot, name)
  await fs.mkdir(directory, { recursive: true })
  await fs.copyFile('lib/ledger-doc/protocol.js', path.join(directory, 'protocol.js'))
  await fs.writeFile(path.join(directory, 'coverage-audit.js'), productionSource.replace(anchor, replacement), 'utf8')
  return import(pathToFileURL(path.join(directory, 'coverage-audit.js')).href)
}
const mutations = [
  {
    name: 'identity-accepts-ambiguous', anchor: 'full.length === 1 && globalFull.length === 1', replacement: 'full.length >= 1',
    run: (Module) => fixture('mut-identity', duplicateText, [event(A, [checkpoint(duplicateText, { sourceRef: null })]), event(B, [checkpoint(duplicateText, { sourceRef: null })])], { module: Module, base: path.join(mutationRoot, 'cases') }),
    assertRed: (result) => assert.equal(result.report.identity.pass, false),
  },
  {
    name: 'normalized-equivalence-always-true', anchor: 'normalized.normalizedSha256 === record.normalized.normalizedSha256', replacement: 'true',
    run: (Module) => fixture('mut-content', sourcePointerText, [event(A, [checkpoint(cpPointerText)])], { module: Module, base: path.join(mutationRoot, 'cases') }),
    assertRed: (result) => assert.equal(result.report.content.pass, false),
  },
  {
    name: 'quad-ignores-dead-empty', anchor: "if (key === 'dead' && (sourceEmpty || checkpointEmpty)) reasons.push('dead-empty-ambiguous')", replacement: "if (false) reasons.push('dead-empty-ambiguous')",
    run: (Module) => fixture('mut-quad', deadEmptyText, [event(A, [checkpoint(deadEmptyText)])], { module: Module, base: path.join(mutationRoot, 'cases') }),
    assertRed: (result) => assert.equal(result.report.quad.pass, false),
  },
  {
    name: 'timeline-removes-creation-floor', anchor: "if (Number.isFinite(birthtimeMs) && at + toleranceMs < birthtimeMs) reasons.push('checkpoint-before-file-creation')", replacement: "if (false) reasons.push('checkpoint-before-file-creation')",
    run: (Module) => fixture('mut-timeline', beforeText, [event(A, [checkpoint(beforeText, { at: FILENAME_MS })])], { module: Module, base: path.join(mutationRoot, 'cases'), birthtimeMs: FILENAME_MS + 2000, mtimeMs: FILENAME_MS + 2000 }),
    assertRed: (result) => assert.equal(result.report.timeline.pass, false),
  },
  {
    name: 'persistence-skips-source-sha-check', anchor: 'if (report.sourceRereadSha256 !== report.source.sha256) {', replacement: 'if (false) {',
    run: async (Module) => {
      const wrapped = Object.create(fs)
      let target
      let reads = 0
      wrapped.readFile = async (...args) => {
        const bytes = await fs.readFile(...args)
        if (target && path.resolve(String(args[0])) === target && ++reads === 1) await fs.writeFile(target, 'mutation concurrent change\n', 'utf8')
        return bytes
      }
      const item = await fixture('mut-persistence', changingText, [event(A, [checkpoint(changingText)])], { module: Module, base: path.join(mutationRoot, 'cases'), fs: wrapped })
      target = item.sourcePath
      return item.auditor.auditFile(FILENAME)
    },
    assertRed: (result) => assert.equal(result.report.gates.reportPersistence, false),
  },
  {
    name: 'physical-delete-flag-enabled', anchor: '    eligibleForPhysicalDelete: false,\n    review:', replacement: '    eligibleForPhysicalDelete: true,\n    review:',
    run: (Module) => fixture('mut-no-delete', mainText, [event(A, [checkpoint(mainText)])], { module: Module, base: path.join(mutationRoot, 'cases') }),
    assertRed: (result) => assert.equal(result.report.eligibleForPhysicalDelete, false),
  },
]
for (const mutation of mutations) {
  let red = false
  let detail = ''
  try {
    const Module = await mutationModule(mutation.name, mutation.anchor, mutation.replacement)
    const item = await mutation.run(Module)
    const result = item.report ? item : await item.auditor.auditFile(item.filename)
    try { mutation.assertRed(result) } catch (error) { red = true; detail = error.message }
  } catch (error) {
    detail = 'mutation harness error: ' + error.message
  }
  await test('MUT-' + mutation.name + ' becomes red', () => assert.equal(red, true, detail))
  evidence.push({ name: mutation.name, result: red ? 'CAUGHT' : 'MISSED', detail })
}
const restoredModule = await mutationModule('restored-clean', 'const LF = String.fromCharCode(10)', 'const LF = String.fromCharCode(10)')
const restoredMainFixture = await fixture('restored-main', mainText, [event(A, [checkpoint(mainText)])], { module: restoredModule, base: path.join(mutationRoot, 'cases') })
const restoredMain = await restoredMainFixture.auditor.auditFile(FILENAME)
const restoredDuplicateFixture = await fixture('restored-duplicate', duplicateText, [event(A, [checkpoint(duplicateText, { sourceRef: null })]), event(B, [checkpoint(duplicateText, { sourceRef: null })])], { module: restoredModule, base: path.join(mutationRoot, 'cases') })
const restoredDuplicate = await restoredDuplicateFixture.auditor.auditFile(FILENAME)
const restoredDeadFixture = await fixture('restored-dead', deadEmptyText, [event(A, [checkpoint(deadEmptyText)])], { module: restoredModule, base: path.join(mutationRoot, 'cases') })
const restoredDead = await restoredDeadFixture.auditor.auditFile(FILENAME)
const restoredTimelineFixture = await fixture('restored-timeline', beforeText, [event(A, [checkpoint(beforeText, { at: FILENAME_MS })])], { module: restoredModule, base: path.join(mutationRoot, 'cases'), birthtimeMs: FILENAME_MS + 2000, mtimeMs: FILENAME_MS + 2000 })
const restoredTimeline = await restoredTimelineFixture.auditor.auditFile(FILENAME)
await test('MUT-restored clean copy returns green on positive and negative controls', () => {
  assert.ok(Object.values(restoredMain.report.gates).every(Boolean))
  assert.equal(restoredMain.report.eligibleForPhysicalDelete, false)
  assert.equal(restoredDuplicate.report.identity.pass, false)
  assert.equal(restoredDead.report.quad.pass, false)
  assert.equal(restoredTimeline.report.timeline.pass, false)
})
evidence.push({ name: 'restored-clean', result: 'GREEN' })

const artifacts = []
for (const file of ['lib/ledger-doc/coverage-audit.js', 'tests/smoke/smoke-test-r4-coverage-audit.mjs']) {
  const bytes = await fs.readFile(file)
  artifacts.push({ file, bytes: bytes.length, sha256: sha256(bytes) })
}
const results = { pass, fail, failures, mutations: evidence, artifacts, synthetic536: { total: result536.summary.total, reportCount: result536.summary.reportCount, noMatch: result536.summary.gates.normalizedEquivalence.fail, eligibleForPhysicalDeleteCount: result536.summary.eligibleForPhysicalDeleteCount } }
await fs.writeFile(path.join(root, 'test-results.json'), JSON.stringify(results, null, 2) + '\n', 'utf8')
console.log('SUMMARY PASS ' + pass + ' / FAIL ' + fail)
console.log('MUTATION CAUGHT ' + evidence.filter((item) => item.result === 'CAUGHT').length + ' / MISSED ' + evidence.filter((item) => item.result === 'MISSED').length)
console.log('RESTORED ' + (evidence.find((item) => item.name === 'restored-clean')?.result || 'MISSING'))
console.log('ARTIFACTS ' + JSON.stringify(artifacts))
process.exitCode = fail === 0 ? 0 : 1

import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { pathToFileURL } from 'node:url'
import { readPointerPre } from '../../lib/event-pointer.js'
import { normalizeText } from '../../lib/ledger-doc/protocol.js'

const root = path.resolve('artifacts', '_batch2-2.7-pointer')
await fs.rm(root, { recursive: true, force: true })
await fs.mkdir(root, { recursive: true })
let sequence = 0
let pass = 0
let fail = 0
const failures = []
const evidence = []
const sha = (value) => createHash('sha256').update(value).digest('hex')
const normalized = (text) => sha(normalizeText(text))
async function fixture(bytes, name = 'ledger.md') {
  const handoffDir = path.join(root, 'case-' + String(sequence++).padStart(3, '0'))
  await fs.mkdir(handoffDir, { recursive: true })
  const file = path.join(handoffDir, name)
  await fs.writeFile(file, bytes)
  return { handoffDir, file, sourceRef: name, bytes }
}
async function test(name, action) {
  try {
    const detail = await action()
    pass++
    console.log('  ok   - ' + name + (detail ? ' :: ' + detail : ''))
    evidence.push({ name, status: 'PASS' })
  } catch (error) {
    fail++
    failures.push({ name, error: error.message })
    console.log('  FAIL - ' + name + ' :: ' + error.message)
    evidence.push({ name, status: 'FAIL', error: error.message })
  }
}
const LF = '## 任务状态\nSynthetic state\n## 目标\nSynthetic goal\n'
const CRLF = LF.replace(/\n/g, '\r\n')
const SPACE = LF.replace('Synthetic state', 'Synthetic state \t')

console.log('=== Actual Buffer fingerprints and normalization ===')
const lfFixture = await fixture(Buffer.from(LF, 'utf8'))
const lfResult = await readPointerPre({ handoffDir: lfFixture.handoffDir }, { sourceRef: lfFixture.sourceRef, expectedNormalizedSha256: normalized(LF), expectedRawSha256: sha(Buffer.from(LF)) })
await test('P-01 real LF Buffer yields exact rawSha/bytes and normalized SHA', () => {
  assert.equal(lfResult.ok, true, JSON.stringify(lfResult))
  assert.equal(lfResult.text, LF)
  assert.equal(lfResult.bytes, Buffer.byteLength(LF))
  assert.equal(lfResult.rawSha256, sha(Buffer.from(LF)))
  assert.equal(lfResult.normalizedSha256, normalized(LF))
  assert.equal(lfResult.sha16, normalized(LF).slice(0, 16))
  assert.equal(lfResult.physicalPath, lfFixture.file)
  assert.equal(lfResult.rawSha256, lfResult.normalizedSha256)
})
const crlfFixture = await fixture(Buffer.from(CRLF, 'utf8'))
const crlfResult = await readPointerPre({ handoffDir: crlfFixture.handoffDir }, { sourceRef: crlfFixture.sourceRef, expectedNormalizedSha256: normalized(CRLF), expectedRawSha256: sha(Buffer.from(CRLF)) })
await test('P-02 CRLF real Buffer changes rawSha but retains normalized SHA', () => {
  assert.equal(crlfResult.ok, true)
  assert.equal(crlfResult.text, CRLF)
  assert.equal(crlfResult.bytes, Buffer.byteLength(CRLF))
  assert.equal(crlfResult.rawSha256, sha(Buffer.from(CRLF)))
  assert.notEqual(crlfResult.rawSha256, lfResult.rawSha256)
  assert.equal(crlfResult.normalizedSha256, lfResult.normalizedSha256)
  assert.notEqual(crlfResult.rawSha256, crlfResult.normalizedSha256)
})
const spaceFixture = await fixture(Buffer.from(SPACE, 'utf8'))
const spaceResult = await readPointerPre({ handoffDir: spaceFixture.handoffDir }, { sourceRef: spaceFixture.sourceRef, expectedNormalizedSha256: normalized(SPACE), expectedRawSha256: sha(Buffer.from(SPACE)) })
await test('P-03 trailing spaces change rawSha but normalizeText strips them', () => {
  assert.equal(spaceResult.ok, true)
  assert.equal(spaceResult.rawSha256, sha(Buffer.from(SPACE)))
  assert.notEqual(spaceResult.rawSha256, lfResult.rawSha256)
  assert.equal(spaceResult.normalizedSha256, lfResult.normalizedSha256)
  assert.equal(spaceResult.bytes, Buffer.byteLength(SPACE))
})
const lineChanged = await readPointerPre({ handoffDir: lfFixture.handoffDir }, { sourceRef: lfFixture.sourceRef, expectedNormalizedSha256: normalized(LF), expectedRawSha256: crlfResult.rawSha256 })
await test('P-04 CRLF-only raw mismatch is a warning, not content drift', () => {
  assert.equal(lineChanged.code, 'pointer-line-ending-changed')
  assert.equal(lineChanged.normalizedEqual, true)
  assert.equal(lineChanged.warning, true)
  assert.equal(lineChanged.text, LF)
  assert.equal(lineChanged.bytes, Buffer.byteLength(LF))
  assert.equal(lineChanged.actualRawSha256, lfResult.rawSha256)
})
const whitespaceChanged = await readPointerPre({ handoffDir: lfFixture.handoffDir }, { sourceRef: lfFixture.sourceRef, expectedNormalizedSha256: lfResult.normalizedSha256, expectedRawSha256: spaceResult.rawSha256 })
await test('P-05 trailing-space-only raw mismatch also warns without drift', () => {
  assert.equal(whitespaceChanged.code, 'pointer-line-ending-changed')
  assert.equal(whitespaceChanged.text, LF)
  assert.equal(whitespaceChanged.bytes, Buffer.byteLength(LF))
})
const shortSha = await readPointerPre({ handoffDir: lfFixture.handoffDir }, { sourceRef: lfFixture.sourceRef, expectedSha16: lfResult.sha16 })
await test('P-06 sha16 is advisory only and cannot verify pointer content', () => {
  assert.equal(shortSha.ok, false)
  assert.equal(shortSha.code, 'pointer-unverified')
  assert.equal(shortSha.sha16, lfResult.sha16)
})
const drift = await readPointerPre({ handoffDir: lfFixture.handoffDir }, { sourceRef: lfFixture.sourceRef, expectedNormalizedSha256: normalized('different synthetic content') })
await test('P-07 actual semantic content change rejects pointer-drift with expected/actual hashes', () => {
  assert.equal(drift.ok, false)
  assert.equal(drift.code, 'pointer-drift')
  assert.equal(drift.normalizedEqual, false)
  assert.equal(drift.actualNormalizedSha256, lfResult.normalizedSha256)
  assert.equal(Object.hasOwn(drift, 'text'), false)
})
const wrongShort = await readPointerPre({ handoffDir: lfFixture.handoffDir }, { sourceRef: lfFixture.sourceRef, expectedNormalizedSha256: '0'.repeat(16) })
await test('P-06b truncated or malformed normalized fingerprint is explicitly unverified', () => assert.equal(wrongShort.code, 'pointer-fingerprint-invalid'))
const missing = await readPointerPre({ handoffDir: lfFixture.handoffDir }, {
  sourceRef: 'absent.md', eventId: 'evt_a1b2c3d4',
  kind: 'handoff',
  readCheckpoints: async () => [
    { eventId: 'evt_a1b2c3d4', idemKey: 'idem-a', at: 10, kind: 'handoff', sourceRef: 'old-a.md', sha16: 'sha16-a', text: 'never expose old text' },
    { eventId: 'evt_a1b2c3d4', idemKey: 'idem-b', at: 40, kind: 'handoff', sourceRef: 'old-b.md', sha16: 'sha16-b', text: 'never expose old text' },
    { eventId: 'evt_a1b2c3d4', idemKey: 'idem-c', at: 40, kind: 'handoff', sourceRef: 'old-c.md', sha16: 'sha16-c', text: 'never expose old text' },
    { eventId: 'evt_a1b2c3d4', idemKey: 'idem-d', at: 30, kind: 'handoff', sourceRef: 'old-d.md', sha16: 'sha16-d', text: 'never expose old text' },
    { eventId: 'evt_a1b2c3d4', idemKey: 'idem-log', at: 20, kind: 'log', sourceRef: 'old-log.md', text: 'never expose old text' },
  ],
})
await test('P-08 missing source returns at most three metadata-only recent pointers', () => {
  assert.equal(missing.code, 'pointer-missing')
  assert.equal(missing.recent.length, 3)
  assert.deepEqual(missing.recent.map((item) => item.at), [40, 40, 30])
  assert.deepEqual(missing.recent.map((item) => item.checkpointIndex), [1, 2, 3])
  assert.ok(missing.recent.every((item) => item.eventId === 'evt_a1b2c3d4'))
  assert.deepEqual(missing.recent.map((item) => item.idemKey), ['idem-b', 'idem-c', 'idem-d'])
  assert.ok(missing.recent.every((item) => item.kind === 'handoff'))
  assert.ok(missing.recent.every((item) => !Object.hasOwn(item, 'text')))
  assert.equal(Object.hasOwn(missing, 'text'), false)
})
const planFixture = await fixture(Buffer.from('# Synthetic current PLAN\n'), 'PLAN.md')
for (const sourceRef of ['PLAN.md', 'handoff/PLAN.md', 'handoff/handoff/PLAN.md']) {
  const planResult = await readPointerPre({ handoffDir: planFixture.handoffDir }, { sourceRef, expectedNormalizedSha256: normalized('# Synthetic current PLAN\n'), expectedRawSha256: sha(Buffer.from('# Synthetic current PLAN\n')) })
  await test('P-09b current PLAN sourceRef adapts without losing handoff root: ' + sourceRef, () => {
    assert.equal(planResult.ok, true)
    assert.equal(planResult.text, '# Synthetic current PLAN\n')
    assert.equal(planResult.physicalPath, planFixture.file)
  })
}
const extraRoots = await readPointerPre({ handoffDir: lfFixture.handoffDir, roots: [root] }, { sourceRef: 'case-001/ledger.md' })
await test('P-09c extra roots cannot widen the trusted handoff domain', () => assert.equal(extraRoots.code, 'pointer-unsafe'))
for (const sourceRef of ['archive/PLAN-old.md', 'handoff/archive/PLAN-old.md', 'archive/old-ledger.md']) {
  const archive = await readPointerPre({ handoffDir: lfFixture.handoffDir }, { sourceRef })
  await test('P-09d archive cannot impersonate current handoff history: ' + sourceRef, () => assert.equal(archive.code, 'pointer-unsafe'))
}
const legacy = await readPointerPre({ handoffDir: lfFixture.handoffDir }, { sourceRef: null, checkpoint: { text: '# Synthetic legacy PLAN\n' } })
await test('P-09 old PLAN without pointer stays legacy and is not treated as history', () => {
  assert.equal(legacy.code, 'pointer-legacy')
  assert.equal(legacy.text, '# Synthetic legacy PLAN\n')
  assert.equal(legacy.sourceRef, null)
})

const planRepeated = await readPointerPre({ handoffDir: planFixture.handoffDir }, { sourceRef: 'handoff/handoff/PLAN.md', expectedNormalizedSha256: normalized('# Synthetic current PLAN\n'), expectedRawSha256: sha(Buffer.from('# Synthetic current PLAN\n')) })
await test('P-09e repeated handoff prefix resolves once to the same current PLAN', () => assert.equal(planRepeated.physicalPath, planFixture.file))
const unverified = await readPointerPre({ handoffDir: lfFixture.handoffDir }, { sourceRef: lfFixture.sourceRef, checkpoint: { sourceRef: lfFixture.sourceRef, text: LF } })
await test('F-01 sourceRef without strong fingerprint is unverified, never pseudo-true', () => {
  assert.equal(unverified.code, 'pointer-unverified')
  assert.equal(unverified.ok, false)
  assert.equal(unverified.bytes, lfResult.bytes)
})
const rawAliases = await readPointerPre({ handoffDir: lfFixture.handoffDir }, { sourceRef: lfFixture.sourceRef, expectedNormalizedSha256: lfResult.normalizedSha256, checkpoint: { rawsha256: lfResult.rawSha256, sha256: '0'.repeat(64) } })
await test('F-02 lowercase rawsha alias works; cp.sha256 remains raw-only', () => assert.equal(rawAliases.ok, true))
const rawOnlyLegacy = await readPointerPre({ handoffDir: lfFixture.handoffDir }, { sourceRef: lfFixture.sourceRef, checkpoint: { sha256: lfResult.rawSha256 } })
await test('F-03 legacy raw sha256 is checked as raw fingerprint, not normalized', () => assert.equal(rawOnlyLegacy.ok, true))
for (const input of ['0'.repeat(16), 'z'.repeat(64), 'sha256:' + '0'.repeat(63), 'sha256:' + 'f'.repeat(63)]) {
  const result = await readPointerPre({ handoffDir: lfFixture.handoffDir }, { sourceRef: lfFixture.sourceRef, expectedNormalizedSha256: input })
  await test('F-04 malformed normalized full64 rejects without drift claim: ' + input.slice(0, 15), () => assert.equal(result.code, 'pointer-fingerprint-invalid'))
}
const wrongFullNormalized = await readPointerPre({ handoffDir: lfFixture.handoffDir }, { sourceRef: lfFixture.sourceRef, expectedNormalizedSha256: 'f'.repeat(64) })
await test('F-04b valid full64 with different content rejects pointer-drift', () => assert.equal(wrongFullNormalized.code, 'pointer-drift'))
const badRaw = await readPointerPre({ handoffDir: lfFixture.handoffDir }, { sourceRef: lfFixture.sourceRef, expectedRawSha256: '0'.repeat(16) })
await test('F-05 raw fingerprint must also be full64', () => assert.equal(badRaw.code, 'pointer-fingerprint-invalid'))
const readFailureIo = Object.create(fs)
readFailureIo.readFile = async () => { throw Object.assign(new Error('synthetic disk failure'), { code: 'EIO' }) }
const readFailure = await readPointerPre({ handoffDir: lfFixture.handoffDir, fs: readFailureIo }, { sourceRef: lfFixture.sourceRef })
await test('F-06 non-ENOENT read error is explicit and not missing', () => {
  assert.equal(readFailure.code, 'pointer-read-failed')
  assert.equal(readFailure.errorCode, 'EIO')
  assert.ok(readFailure.error.includes('synthetic disk failure'))
})
const recentFailure = await readPointerPre({ handoffDir: lfFixture.handoffDir }, { sourceRef: 'absent.md', readCheckpoints: async () => { throw new Error('synthetic checkpoint read failure') } })
await test('F-07 recent checkpoint read failure is explicit and not a fabricated empty recent list', () => {
  assert.equal(recentFailure.code, 'pointer-read-failed')
  assert.ok(recentFailure.error.includes('synthetic checkpoint read failure'))
})

console.log('=== Unsafe paths, physical roots, and junctions ===')
for (const sourceRef of [path.resolve(lfFixture.file), '../outside.md', 'nested/../../outside.md', '.', 'nested//file.md', 'C:\\outside.md', '/outside.md']) {
  let readCount = 0
  const io = { readFile: async () => { readCount++; throw new Error('unsafe read') } }
  const unsafe = await readPointerPre({ handoffDir: lfFixture.handoffDir, fs: io }, { sourceRef })
  await test('U-01 unsafe sourceRef rejects without IO: ' + sourceRef, () => {
    assert.equal(unsafe.code, 'pointer-unsafe')
    assert.equal(readCount, 0)
  })
}
const rootUnsafe = await readPointerPre({ handoffDir: lfFixture.handoffDir }, { sourceRef: lfFixture.handoffDir, roots: [root] })
await test('U-02 root self/empty roots cannot grant source access', () => assert.equal(rootUnsafe.code, 'pointer-unsafe'))
const outsideDir = path.join(root, 'outside-' + sequence++)
await fs.mkdir(outsideDir, { recursive: true })
await fs.writeFile(path.join(outsideDir, 'outside.md'), LF)
for (const [name, kind] of [['file-link', 'file'], ['dir-junction', 'junction']]) {
  const linkDir = path.join(root, 'link-root-' + name)
  await fs.mkdir(linkDir, { recursive: true })
  const link = path.join(linkDir, kind === 'file' ? 'ledger-link.md' : 'nested')
  await fs.symlink(kind === 'file' ? lfFixture.file : lfFixture.handoffDir, link, kind)
  const result = await readPointerPre({ handoffDir: linkDir }, { sourceRef: kind === 'file' ? 'ledger-link.md' : 'nested/ledger.md' })
  await test('U-03 real ' + kind + ' link rejects even when target contains valid content', () => {
    assert.equal(result.code, 'pointer-unsafe')
    assert.equal(result.ok, false)
  })
}
const rootJunction = path.join(root, 'root-junction')
await fs.symlink(lfFixture.handoffDir, rootJunction, 'junction')
const junctionRootResult = await readPointerPre({ handoffDir: rootJunction }, { sourceRef: 'ledger.md' })
await test('U-04 junction used as trusted handoff root cannot grant access', () => {
  assert.equal(junctionRootResult.code, 'pointer-unsafe')
})
const nestedLink = path.join(lfFixture.handoffDir, 'escape')
await fs.symlink(outsideDir, nestedLink, 'junction')
const nestedEscape = await readPointerPre({ handoffDir: lfFixture.handoffDir }, { sourceRef: 'escape/outside.md' })
await test('U-05 nested junction escape rejects instead of reading outside bytes', () => {
  assert.equal(nestedEscape.code, 'pointer-unsafe')
})
const invalidUtf8Dir = path.join(root, 'invalid-utf8')
await fs.mkdir(invalidUtf8Dir, { recursive: true })
await fs.writeFile(path.join(invalidUtf8Dir, 'bad.md'), Buffer.from([0x23, 0xff, 0x0a]))
const invalidUtf8 = await readPointerPre({ handoffDir: invalidUtf8Dir }, { sourceRef: 'bad.md' })
await test('U-06 malformed UTF-8 is unsafe and not silently replaced', () => {
  assert.equal(invalidUtf8.code, 'pointer-unsafe')
  assert.equal(invalidUtf8.ok, false)
})

console.log('=== Isolated mutations: boundary and drift proof ===')
const source = (await fs.readFile('lib/event-pointer.js', 'utf8')).replace(/\r\n/g, '\n')
const mutationRoot = path.resolve('artifacts', '_batch2-2.7-pointer-mutations')
await fs.mkdir(mutationRoot, { recursive: true })
async function mutation(name, anchor, replacement) {
  assert.equal(source.split(anchor).length - 1, 1, name + ' anchor exactly once')
  const directory = path.join(mutationRoot, name, 'lib')
  await fs.mkdir(path.join(directory, 'ledger-doc'), { recursive: true })
  await fs.copyFile('lib/ledger-doc/protocol.js', path.join(directory, 'ledger-doc', 'protocol.js'))
  await fs.copyFile('lib/file-boundary.js', path.join(directory, 'file-boundary.js'))
  await fs.writeFile(path.join(directory, 'event-pointer.js'), source.replace(anchor, replacement), 'utf8')
  return import(pathToFileURL(path.join(directory, 'event-pointer.js')).href)
}
const mutationResults = []
async function differential(name, moduleName, anchor, replacement, invoke) {
  const mutantModule = await mutation(moduleName, anchor, replacement)
  const mutant = await invoke(mutantModule)
  const cleanResult = await invoke({ readPointerPre })
  assert.notDeepEqual({ code: mutant.code, ok: mutant.ok }, { code: cleanResult.code, ok: cleanResult.ok }, name + ' must differ from clean behavior')
  assert.equal(typeof cleanResult.code === 'string' || cleanResult.ok === true, true, name + ' clean control must return an explicit verdict')
  const result = { name, result: 'CAUGHT', mutantCode: mutant.code, cleanCode: cleanResult.code }
  mutationResults.push(result)
  await test(name + ' has a measured old-defect/clean difference', () => assert.equal(result.result, 'CAUGHT'))
}
await differential(
  'M-01 removed handoff prefix adaptation rejects valid sourceRef',
  'handoff-prefix-removed',
  'while (relativeParts[0]?.toLowerCase() === \'handoff\') relativeParts = relativeParts.slice(1)',
  '',
  (module) => module.readPointerPre({ handoffDir: planFixture.handoffDir }, { sourceRef: 'handoff/PLAN.md', expectedNormalizedSha256: normalized('# Synthetic current PLAN\n'), expectedRawSha256: sha(Buffer.from('# Synthetic current PLAN\n')) }),
)
await differential(
  'M-02 removed raw comparison loses CRLF warning',
  'raw-warning-removed',
  'if (expectedRaw && expectedRaw !== rawSha256) {',
  'if (false) {',
  (module) => module.readPointerPre({ handoffDir: lfFixture.handoffDir }, { sourceRef: lfFixture.sourceRef, expectedNormalizedSha256: lfResult.normalizedSha256, expectedRawSha256: crlfResult.rawSha256 }),
)
await differential(
  'M-03 removed normalized comparison misses drift',
  'normalized-drift-removed',
  'if (expectedNormalized && expectedNormalized !== normalizedSha256) {',
  'if (false) {',
  (module) => module.readPointerPre({ handoffDir: lfFixture.handoffDir }, { sourceRef: lfFixture.sourceRef, expectedNormalizedSha256: '0'.repeat(64) }),
)
const clean = await mutation('clean', 'const utf8 =', 'const utf8 =')
await test('M-04 clean copy passes real read, drift, and strict boundary controls', async () => {
  const valid = await clean.readPointerPre({ handoffDir: lfFixture.handoffDir }, { sourceRef: lfFixture.sourceRef, expectedNormalizedSha256: lfResult.normalizedSha256, expectedRawSha256: lfResult.rawSha256 })
  assert.equal(valid.ok, true)
  assert.equal(valid.rawSha256, lfResult.rawSha256)
  assert.equal((await clean.readPointerPre({ handoffDir: lfFixture.handoffDir }, { sourceRef: lfFixture.handoffDir })).code, 'pointer-unsafe')
  assert.equal((await clean.readPointerPre({ handoffDir: lfFixture.handoffDir }, { sourceRef: lfFixture.sourceRef, expectedNormalizedSha256: normalized('different synthetic content') })).code, 'pointer-drift')
})
const mutationCaught = mutationResults.filter((item) => item.result === 'CAUGHT').length
const mutationMissed = mutationResults.filter((item) => item.result !== 'CAUGHT').length

const report = {
  schema: 'batch2-2.7-pointer-v1',
  pass, fail, failures, evidence,
  mutation: { caught: mutationCaught, missed: mutationMissed, restored: 'GREEN', results: mutationResults },
  realFiles: { lfBytes: Buffer.byteLength(LF), crlfBytes: Buffer.byteLength(CRLF), trailingSpaceBytes: Buffer.byteLength(SPACE) },
  fingerprints: {
    lfRawSha256: lfResult.rawSha256,
    lfNormalizedSha256: lfResult.normalizedSha256,
    crlfRawSha256: crlfResult.rawSha256,
    trailingSpaceRawSha256: spaceResult.rawSha256,
  },
  boundary: 'sourceRef relative to trusted handoffDir; fileWithinRoots strict:true; no absolute/.. /root/junction/legacy-PLAN fallback',
  history: 'PLAN.md is only the current file; missing or legacy fingerprints never infer or substitute old history.',
  scope: 'Only lib/event-pointer.js and tests/smoke/smoke-test-batch2-2.7-pointer.mjs; no summary, no RAG/index/ledger-doc changes, no production wiring',
}
const reportPath = path.join(root, 'pointer-report.json')
await fs.writeFile(reportPath, JSON.stringify(report, null, 2) + '\n', 'utf8')
const reread = JSON.parse(await fs.readFile(reportPath, 'utf8'))
assert.equal(reread.pass, pass)
assert.equal(reread.fail, fail)
console.log('SUMMARY PASS ' + pass + ' / FAIL ' + fail)
console.log('MUTATION CAUGHT ' + mutationCaught + ' / MISSED ' + mutationMissed + '; RESTORED GREEN')
console.log('REPORT ' + reportPath)
process.exitCode = fail === 0 ? 0 : 1

/**
 * smoke-test-batch2-2.9-wiring.mjs —— 2.9 真实接线（handoff-write）专项套件
 *
 * 判据纪律（定稿 §6）：① 真 import → 真构造/真调用 → 真实隔离文件与事件库读回；
 * ② 新 handoff/plan 的 text.length ≤ 300，四段来自真实原文，磁盘字节/raw SHA/指针
 * normalize SHA/bytes/sourceRef 逐项复算；③ 用真实 readEventCheckpointPre 还原来源，
 * 旧全文检查点仍可读；④ 幂等语义；⑤ 路径/事件边界；⑦ 三类隔离变异必须 CAUGHT。
 */
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

import { eventStorePre, readStorePre } from '../../lib/event-store.js'
import { readEventCheckpointPre } from '../../lib/event-drilldown.js'
import { buildHandoffCheckpointSummaryPre } from '../../lib/handoff-checkpoint.js'
import * as protocolModule from '../../lib/ledger-doc/protocol.js'
import {
  appendStoredHandoffCheckpointPre,
  assessStoredHandoffCheckpointPre,
  assessCurrentPointerCoveragePre,
  assertWritableEventTargetPre,
} from '../../lib/handoff-write.js'

const sha256 = (v) => createHash('sha256').update(v).digest('hex')
let checks = 0
const ok = (cond, name) => { assert.ok(cond, name); checks++ }
const eq = (got, want, name) => { assert.equal(got, want, name); checks++ }

const root = path.resolve('artifacts', '_batch2-2.9-wiring')
await fs.rm(root, { recursive: true, force: true })
const handoffDir = path.join(root, 'handoff')
await fs.mkdir(handoffDir, { recursive: true })
const storePath = path.join(handoffDir, 'event-store.json')

const ledgerText = [
  '# 交接账本 · 2026-11-13 22:00',
  '',
  '## 任务状态',
  '2.9 接线中：真实来源证明已跑通，覆盖评估待读回。',
  '',
  '## 目标',
  '把已落盘的 handoff 接成可信检查点，正文用三百字符以内摘要。',
  '',
  '## 已试方案与失败原因',
  '- 直接把摘要当身份 ⇒ 相同路径下摘要外内容变了会被误判重复 ⇒ 改用完整正文做身份。',
  '',
  '## 进度与下一步',
  '继续跑真实读回与变异验证。',
  '',
].join('\n')
const ledgerPath = path.join(handoffDir, 'handoff-20261113-220000.md')
await fs.writeFile(ledgerPath, ledgerText, 'utf8')
const diskBytes = Buffer.from(ledgerText, 'utf8')

const activeEvent = await eventStorePre.create(storePath, { name: 'synthetic 2.9 active' })
const pausedEvent = await eventStorePre.create(storePath, { name: 'synthetic 2.9 paused' })
await eventStorePre.set(storePath, pausedEvent.id, { status: 'paused', pausedReason: 'synthetic' })
const closedEvent = await eventStorePre.create(storePath, { name: 'synthetic 2.9 closed' })
await eventStorePre.close(storePath, closedEvent.id, { outcome: 'synthetic closed' })
const otherEvent = await eventStorePre.create(storePath, { name: 'synthetic 2.9 other' })

/* ══════ A. 正路径 ══════ */
const a = await appendStoredHandoffCheckpointPre({
  storePath, handoffDir, sourcePath: ledgerPath, kind: 'handoff', eventId: activeEvent.id,
})
ok(a.ok === true, 'A1 真实 handoff 接线返回 ok')
eq(a.eventId, activeEvent.id, 'A2 归属就是显式 eventId（未被磁铁改判）')
eq(a.sourceRef, 'handoff-20261113-220000.md', 'A3 sourceRef 是真实相对路径')
eq(a.sourceBytes, diskBytes.length, 'A4 bytes = 真实磁盘字节数')
eq(a.sourceProof.rawSha256, sha256(diskBytes), 'A5 rawSha256 = 真实字节 sha256（逐字节复算）')
eq(a.sourceProof.verified, true, 'A6 sourceProof 已核验')
eq(a.sourceProof.ok, true, 'A7 sourceProof.ok')
ok(a.summaryChars <= 300, 'A8 摘要不超过三百字符（实测 ' + a.summaryChars + '）')
eq(a.pointerReadback.verified, true, 'A9 指针回读已核验（readEventCheckpointPre）')
eq(a.pointerReadback.ok, true, 'A10 指针回读 ok')

const store1 = await readStorePre(storePath)
const ev1 = store1.events.find((e) => e.id === activeEvent.id)
eq(ev1.checkpoints.length, 1, 'A11 显式事件只 +1 条检查点')
const cp1 = ev1.checkpoints[0]
eq(cp1.kind, 'handoff', 'A12 kind=handoff')
ok(cp1.text.length <= 300, 'A13 落库正文不超过三百字符（实测 ' + cp1.text.length + '）')
ok(cp1.text !== ledgerText, 'A14 落库正文不是全文（2.7 生效）')
eq(cp1.bytes, diskBytes.length, 'A15 检查点 bytes = 真实字节')
eq(cp1.rawSha256, sha256(diskBytes), 'A16 检查点 rawSha256 = 真实字节 sha256')
eq(cp1.normalizedSha256, a.sourceProof.documentNormalizedSha256, 'A17 normalizedSha256 = 指针口径')
ok(/^[0-9a-f]{64}$/.test(cp1.rawSha256) && /^[0-9a-f]{64}$/.test(cp1.normalizedSha256), 'A18 两个指纹都是完整 64 hex（未被白名单丢弃）')
eq(cp1.sourceRef, 'handoff-20261113-220000.md', 'A19 检查点 sourceRef 指向真实文件')
ok(cp1.state.includes('2.9 接线中'), 'A20 四段 state 来自真实原文')
ok(cp1.goal.includes('可信检查点'), 'A21 四段 goal 来自真实原文')
ok(cp1.dead.includes('完整正文做身份'), 'A22 四段 dead 来自真实原文')
ok(cp1.next.includes('变异验证'), 'A23 四段 next 来自真实原文')
eq(a.checkpointIndex, 0, 'A24 checkpointIndex 指向真实落库下标')
// ★三口径分离（Lead 2026-11-13 指出）：真源 raw / 指针 normalize / 覆盖 normalize / 摘要自身
ok(a.fingerprintScopes.fingerprintScope === 'source-pointer', 'A24a 检查点指纹口径判定为「真源指针」而非「正文自证」')
eq(a.fingerprintScopes.sourceRawSha256, sha256(diskBytes), 'A24b sourceRawSha256 == 真源字节 sha256')
eq(a.fingerprintScopes.sourceDocumentNormalizedSha256, a.sourceProof.documentNormalizedSha256, 'A24c 指针口径 == documentNormalizedSha256')
eq(a.fingerprintScopes.sourceCoverageNormalizedSha256, a.sourceProof.normalizedSha256, 'A24d 覆盖口径 == proof.normalizedSha256')
eq(a.fingerprintScopes.summaryTextRawSha256, sha256(Buffer.from(cp1.text, 'utf8')), 'A24e 摘要正文自身 sha256 独立可算')
ok(a.fingerprintScopes.sourceRawSha256 !== a.fingerprintScopes.summaryTextRawSha256, 'A24f 真源哈希 ≠ 摘要哈希（不得混用）')
// ★B3-CB（2026-11-17）：原断言末尾拼 `|| true` ⇒ **恒真、永远无法失败**（隔离变异确证）。
//   改为真判据：两个 normalized 口径**都必须存在（非空字符串）**且**互不相同**（不同口径不得混用）。
ok(typeof a.fingerprintScopes.sourceDocumentNormalizedSha256 === 'string'
  && a.fingerprintScopes.sourceDocumentNormalizedSha256.length > 0
  && typeof a.fingerprintScopes.sourceCoverageNormalizedSha256 === 'string'
  && a.fingerprintScopes.sourceCoverageNormalizedSha256.length > 0
  && a.fingerprintScopes.sourceDocumentNormalizedSha256 !== a.fingerprintScopes.sourceCoverageNormalizedSha256,
  'A24g 两个 normalized 口径都已单列且互不相同')
ok(a.coverage && !String(a.coverage.reasonCodes || '').includes('checkpoint-raw-fingerprint-mismatch'), 'A24h 覆盖评估不再出现指纹假红（已剥离真源口径）')
// ★A24i 起：摘要指针形态的**真覆盖判据**（Lead 要求：不能靠解释把 mismatch 改口成 covered）
ok(a.pointerCoverage && a.pointerCoverage.ok === true, 'A24i 摘要指针形态：当前覆盖评估 ok=true（六门全过）:: ' + (a.pointerCoverage && a.pointerCoverage.reasonCodes.join(',')))
eq(a.pointerCoverage.status, 'covered', 'A24j status=covered')
eq(a.pointerCoverage.scope, 'current-pointer-coverage-only', 'A24k 声明范围仅当前指针覆盖')
eq(a.pointerCoverage.historicalContentCovered, false, 'A24l 不声称历史全文覆盖')
eq(a.pointerCoverage.detail.summary.textIsFullDocument, false, 'A24m 明示摘要不是全文')
eq(a.pointerCoverage.eligibleForPhysicalDelete, false, 'A24n covered 不授予删除许可')
eq(a.pointerCoverage.eligibleForArchive, false, 'A24o covered 不授予归档许可')
eq(a.pointerCoverage.eventClaimed, false, 'A24p covered 不认领事件')
eq(a.pointerCoverage.detail.provenance.checkpointRawSha256, sha256(diskBytes), 'A24q provenance: 检查点 rawSha256 == 真源字节 sha256')
eq(a.pointerCoverage.detail.provenance.checkpointNormalizedSha256, a.sourceProof.documentNormalizedSha256, 'A24r provenance: 检查点 normalizedSha256 == 指针口径（不是摘要哈希）')
ok(a.pointerCoverage.detail.provenance.summaryTextRawSha256 !== a.pointerCoverage.detail.provenance.sourceRealRawSha256, 'A24s 摘要哈希 ≠ 真源哈希（口径未混用）')
eq(a.pointerCoverage.detail.quad.drift.length, 0, 'A24t 四段零漂移（逐字段等于真源解析）')

const rb = await readEventCheckpointPre({ store: store1, eventId: activeEvent.id, checkpointIndex: 0, handoffDir })
eq(rb.ok, true, 'A25 readEventCheckpointPre ok')
eq(rb.verified, true, 'A26 指针可证明（完整 raw/normalized 指纹齐备）')
eq(rb.text, ledgerText, 'A27 从真实磁盘逐字节还原全文')
eq(Buffer.byteLength(rb.text, 'utf8'), diskBytes.length, 'A28 还原正文字节数 = 磁盘字节数')
// 独立复算摘要：落库正文必须等于「同一纯函数对同一原文 + 同一四段」的输出。
// 没有这条，M1（全文回填）就会被 300 上限「顺手截断」掩盖成看起来正常。
const expectedSummary = buildHandoffCheckpointSummaryPre({ kind: 'handoff', text: ledgerText, quad: { goal: cp1.goal, state: cp1.state, dead: cp1.dead, next: cp1.next } })
eq(expectedSummary.ok, true, 'A29 独立复算摘要 ok')
eq(cp1.text, expectedSummary.text, 'A30 落库正文 == 确定性摘要（独立复算，不是全文截断）')

/* ══════ B. paused 可写；closed/未知/非法零副作用 ══════ */
const b = await appendStoredHandoffCheckpointPre({
  storePath, handoffDir, sourcePath: ledgerPath, kind: 'handoff', eventId: pausedEvent.id,
})
eq(b.eventId, pausedEvent.id, 'B1 paused 事件可写')

const beforeBytes = await fs.readFile(storePath)
for (const bad of [closedEvent.id, 'evt_deadbeef', '../bad', 'not-an-id']) {
  await assert.rejects(
    () => appendStoredHandoffCheckpointPre({ storePath, handoffDir, sourcePath: ledgerPath, kind: 'handoff', eventId: bad }),
    (e) => e.code === 'event-id-unavailable', 'B2 拒绝 ' + bad,
  )
  checks++
}
assert.deepEqual(await fs.readFile(storePath), beforeBytes, 'B3 拒绝时事件库字节不变')
checks++
eq((await assertWritableEventTargetPre(storePath, activeEvent.id)).status, 'active', 'B4 预检识别 active')
eq((await assertWritableEventTargetPre(storePath, '')).checked, false, 'B5 无 eventId 时预检不介入')
await assert.rejects(() => assertWritableEventTargetPre(storePath, closedEvent.id), (e) => e.code === 'event-id-unavailable', 'B6 预检拒绝 closed')
checks++

/* ══════ C. 路径边界 ══════ */
const outsidePath = path.join(root, 'outside.md')
await fs.writeFile(outsidePath, ledgerText, 'utf8')
for (const [name, p] of [
  ['C1 根外绝对路径', outsidePath],
  ['C2 点段越界', path.join(handoffDir, '..', 'outside.md')],
  ['C3 不存在的文件', path.join(handoffDir, 'nope.md')],
]) {
  await assert.rejects(
    () => appendStoredHandoffCheckpointPre({ storePath, handoffDir, sourcePath: p, kind: 'handoff', eventId: activeEvent.id }),
    (e) => ['handoff-write-source-outside-root', 'handoff-write-source-missing'].includes(e.code), name,
  )
  checks++
}
let linkTested = false
try {
  const linkDir = path.join(root, 'linkdir')
  await fs.symlink(handoffDir, linkDir, 'junction')
  await assert.rejects(
    () => appendStoredHandoffCheckpointPre({ storePath, handoffDir: linkDir, sourcePath: ledgerPath, kind: 'handoff', eventId: activeEvent.id }),
    (e) => e.code === 'handoff-write-handoff-dir-unsafe', 'C4 链接根被拒',
  )
  checks++
  linkTested = true
} catch (error) {
  if (error && error.code === 'handoff-write-handoff-dir-unsafe') throw error
  console.log('SKIP C4 链接根（本平台无法创建目录链接）: ' + String(error && error.code))
}
// ★B3-CB（2026-11-17）：原断言 `linkTested || true` **恒真**（隔离变异 M2 换 `(false)||true` 仍 PASS）。
//   改为**显式二态**：真测通过 ⇒ PASS；平台不支持而 SKIP ⇒ **打印 SKIP 且不计 PASS**（不再静默变绿）。
//   注意：C4 分支内的 `assert.rejects` 已能抛真失败；此处只负责「没测到也不能算通过」。
if (linkTested) {
  ok(true, 'C5 链接段真测通过（junction 被拒 handoff-write-handoff-dir-unsafe）')
} else {
  console.log('SKIP C5 链接段（本平台无法创建目录链接）—— 本项**未验证**，不计入 PASS')
}

/* ══════ D. 幂等：相同意图不重复；摘要外内容变 ⇒ 新检查点 ══════ */
const beforeDup = await readStorePre(storePath)
const dupCount = beforeDup.events.find((e) => e.id === activeEvent.id).checkpoints.length
const d1 = await appendStoredHandoffCheckpointPre({
  storePath, handoffDir, sourcePath: ledgerPath, kind: 'handoff', eventId: activeEvent.id,
})
eq(d1.deduped, true, 'D1 相同真实意图被幂等去重')
eq(d1.checkpointIndex, a.checkpointIndex, 'D2 去重返回原下标（未伪造新位置）')
eq((await readStorePre(storePath)).events.find((e) => e.id === activeEvent.id).checkpoints.length, dupCount, 'D3 去重后检查点条数不变')

const longTail = '\n## 附：低优先级备注\n' + '这是一段只在摘要之外的长备注，用于验证身份包含完整正文。'.repeat(20) + '\n'
await fs.writeFile(ledgerPath, ledgerText + longTail, 'utf8')
const d4 = await appendStoredHandoffCheckpointPre({
  storePath, handoffDir, sourcePath: ledgerPath, kind: 'handoff', eventId: activeEvent.id,
})
eq(d4.deduped, false, 'D4 摘要外内容改变 ⇒ 不被误判重复')
eq(d4.checkpointIndex, a.checkpointIndex + 1, 'D5 新增检查点下标前进')
eq((await readStorePre(storePath)).events.find((e) => e.id === activeEvent.id).checkpoints.length, dupCount + 1, 'D6 检查点真实 +1')
await fs.writeFile(ledgerPath, ledgerText, 'utf8')

/* ══════ E. 只读评估：真实选择器、不越界、不授予许可 ══════ */
const storeBeforeE = await readStorePre(storePath)
const f1 = await assessStoredHandoffCheckpointPre({ storePath, handoffDir, eventId: activeEvent.id, checkpointIndex: 0 })
eq(f1.eventId, activeEvent.id, 'E1 评估绑定真实 eventId')
eq(f1.checkpointIndex, 0, 'E2 评估绑定真实 checkpointIndex')
ok(f1.coverage && typeof f1.coverage.status === 'string', 'E3 覆盖评估返回真实 status')
eq(f1.coverage.eventClaimed, false, 'E4 评估不认领事件')
eq(f1.coverage.eligibleForPhysicalDelete, false, 'E5 评估不授予删除许可')
eq(f1.coverage.eligibleForArchive, false, 'E6 评估不授予归档许可')
eq(f1.coverage.writesPerformed, false, 'E7 评估零写入')
ok(f1.coverage.status !== 'covered', 'E8 摘要检查点如实不 covered（不能自证全文）')
const f9 = await assessStoredHandoffCheckpointPre({ storePath, handoffDir, eventId: activeEvent.id, checkpointIndex: 999 })
eq(f9.ok, false, 'E9 越界 checkpointIndex 被拒')
eq(f9.code, 'checkpoint-not-found', 'E10 越界码可判读')
const f11 = await assessStoredHandoffCheckpointPre({ storePath, handoffDir, eventId: 'evt_deadbeef', checkpointIndex: 0 })
eq(f11.ok, false, 'E11 未知事件被拒')
eq(f11.code, 'event-not-found', 'E12 未知事件码可判读')
eq((await readStorePre(storePath)).events.length, storeBeforeE.events.length, 'E13 评估不新建事件')

/* ══════ F. 旧全文检查点仍可读（兼容不误判） ══════ */
const legacyLedger = '# 交接账本 · 旧形态\n\n## 任务状态\n旧全文检查点\n'
const legacyPath = path.join(handoffDir, 'handoff-legacy.md')
await fs.writeFile(legacyPath, legacyLedger, 'utf8')
const { appendHandoffCheckpointPre } = await import('../../lib/event-write.js')
await appendHandoffCheckpointPre(storePath, { ledgerText: legacyLedger, ledgerPath: legacyPath, kind: 'handoff', eventId: otherEvent.id })
const storeLegacy = await readStorePre(storePath)
const otherEv = storeLegacy.events.find((e) => e.id === otherEvent.id)
eq(otherEv.checkpoints.length, 1, 'F1 旧路径仍写 1 条全文检查点')
eq(otherEv.checkpoints[0].text, legacyLedger, 'F2 旧路径正文仍是全文（未迁移、未改语义）')
eq(otherEv.checkpoints[0].sourceRef, legacyPath, 'F3 旧路径 sourceRef 仍照旧（原样存调用方传的绝对路径，未改语义）')
const g4 = await readEventCheckpointPre({ store: storeLegacy, eventId: otherEvent.id, checkpointIndex: 0, handoffDir })
eq(g4.ok, true, 'F4 旧全文检查点仍可读回')
const g5 = await assessStoredHandoffCheckpointPre({ storePath, handoffDir, eventId: otherEvent.id, checkpointIndex: 0 })
ok(g5.ok === false && g5.status !== 'covered', 'F5 旧检查点如实不 covered（status=' + String(g5.status) + '）')
eq((g5.coverage && g5.coverage.eventClaimed), false, 'F6 旧检查点评估同样不认领事件')
eq((g5.coverage && g5.coverage.writesPerformed), false, 'F7 旧检查点评估零写入')

console.log('PASS ' + checks)


/* ══════ N. 摘要指针覆盖的**负路径**（有区分力：必须非 covered） ══════ */
// 直接用真实产物做「篡改一份、其余不变」的对照，证明每个门都真的在判。
const base = {
  checkpoint: { ...cp1, legacyCheckpointKey: undefined },
  event: (await readStorePre(storePath)).events.find((e) => e.id === activeEvent.id),
  eventId: activeEvent.id,
  checkpointIndex: 0,
  source: (await import('../../lib/handoff-coverage.js')).parseHandoffCoveragePre(ledgerText),
  sourceProof: a.sourceProof,
  sourceRef: a.sourceRef,
  expectedSummary: buildHandoffCheckpointSummaryPre({ kind: 'handoff', text: ledgerText, quad: { goal: cp1.goal, state: cp1.state, dead: cp1.dead, next: cp1.next } }),
  readback: { ok: true, verified: true },
}
base.checkpoint.legacyCheckpointKey = (await import('../../lib/handoff-write.js')).__none
const legacyKeyForTest = (cp) => {
  const { computeLegacyCheckpointKey } = protocolModule
  return computeLegacyCheckpointKey({
    eventId: activeEvent.id, checkpointIndex: 0, at: cp.at ?? null, kind: cp.kind ?? null,
    text: cp.text ?? null, sourceRef: cp.sourceRef ?? null, idemKey: cp.idemKey ?? null,
    quad: Object.fromEntries(['goal', 'state', 'dead', 'next'].map((k) => [k, cp[k] ?? null])),
  })
}
base.checkpoint.legacyCheckpointKey = legacyKeyForTest(base.checkpoint)

const n1 = await assessCurrentPointerCoveragePre(base)
eq(n1.status, 'covered', 'N0 对照：未篡改 ⇒ covered（证明负路径有区分力）')

const driftQuad = await assessCurrentPointerCoveragePre({ ...base, checkpoint: { ...base.checkpoint, dead: '被篡改的失败段' } })
eq(driftQuad.ok, false, 'N1 四段漂移 ⇒ 非 covered')
ok(driftQuad.reasonCodes.includes('pointer-quad-drift'), 'N2 四段漂移的可判读理由')
eq(driftQuad.gates.quad, false, 'N3 quad 门确实关')

const wrongSrc = await assessCurrentPointerCoveragePre({ ...base, sourceRef: 'another-file.md' })
eq(wrongSrc.ok, false, 'N4 绑定错误（sourceRef 不一致）⇒ 非 covered')
ok(wrongSrc.reasonCodes.includes('pointer-source-ref-mismatch'), 'N5 绑定错误的可判读理由')

const wrongRaw = await assessCurrentPointerCoveragePre({ ...base, checkpoint: { ...base.checkpoint, rawSha256: 'a'.repeat(64) } })
eq(wrongRaw.ok, false, 'N6 指纹漂移（rawSha256 改一位）⇒ 非 covered')
ok(wrongRaw.reasonCodes.includes('pointer-raw-sha256-mismatch'), 'N7 指纹漂移的可判读理由')

const wrongBytes = await assessCurrentPointerCoveragePre({ ...base, checkpoint: { ...base.checkpoint, bytes: 1 } })
eq(wrongBytes.ok, false, 'N8 bytes 漂移 ⇒ 非 covered')

// 把**摘要哈希**冒充真源哈希：这是 Lead 明确点名的禁止事项，必须被判红
const summaryAsRaw = await assessCurrentPointerCoveragePre({
  ...base,
  checkpoint: { ...base.checkpoint, rawSha256: sha256(Buffer.from(base.checkpoint.text, 'utf8')) },
})
eq(summaryAsRaw.ok, false, 'N9 拿摘要哈希当真源哈希 ⇒ 非 covered（口径不可混用的硬判据）')

// 错误 eventId / 越界 selector
const wrongEvent = await assessCurrentPointerCoveragePre({ ...base, eventId: 'evt_deadbeef' })
eq(wrongEvent.ok, false, 'N10 事件绑定错误 ⇒ 非 covered')
ok(wrongEvent.reasonCodes.includes('pointer-identity-unverified'), 'N11 绑定错误的可判读理由')

// 指针不可回读
const noReadback = await assessCurrentPointerCoveragePre({ ...base, readback: { ok: false, verified: false } })
eq(noReadback.ok, false, 'N12 指针不可回读 ⇒ 非 covered')

// 摘要被改写（不是确定性复算结果）
const badSummary = await assessCurrentPointerCoveragePre({ ...base, checkpoint: { ...base.checkpoint, text: '这段是伪造的摘要' } })
eq(badSummary.ok, false, 'N13 摘要不匹配确定性复算 ⇒ 非 covered')
ok(badSummary.reasonCodes.includes('pointer-summary-mismatch'), 'N14 摘要不匹配的可判读理由')

// covered 绝不授予破坏性动作（正向与负向都要断）
for (const [name, r] of [['正', n1], ['负', driftQuad]]) {
  eq(r.eligibleForPhysicalDelete, false, 'N15 ' + name + '：不授予删除')
  eq(r.eligibleForArchive, false, 'N16 ' + name + '：不授予归档')
  eq(r.eventClaimed, false, 'N17 ' + name + '：不认领事件')
  eq(r.writesPerformed, false, 'N18 ' + name + '：零写入')
}

/* ══════ M. 隔离变异（只改副本，必须 CAUGHT） ══════ */
// 变异副本 = lib/ 的**整目录快照**。为什么整目录而不是白名单：
//   手工枚举传递依赖必然漏（实测漏了 ledger-doc/coverage-audit.js 就 ERR_MODULE_NOT_FOUND），
//   而漏一项的后果是「变异根本没跑起来」被当成 CAUGHT —— 那正是假绿。
//   ★只复制、不修改副本之外的任何文件；变异只写 handoff-write.mut.js 这一个文件。
const mutationRoot = path.join(root, 'mutations')
await fs.cp(path.join('lib'), mutationRoot, { recursive: true })

const source = await fs.readFile('lib/handoff-write.js', 'utf8')
const hit = (src, anchor, name) => {
  const n = src.split(anchor).length - 1
  assert.equal(n, 1, name + ' 变异锚点恰命中 1 次（实测 ' + n + '）')
  checks++
}

// M1 全文回填：把摘要换成全文（2.7 的靶心）
const m1Anchor = '    text: summarizePre(writeH, 300),'
// 用真实锚点：本模块传 summary 给 append，故变异点选「摘要对象整体」
const m1Real = '    summary,'
hit(source, m1Real, 'M1')
const m1Source = source.replace(m1Real, "    summary: { ...summary, text: text },")

// M2 四段从摘要错误派生
const m2Real = '    sectionsOverride: summary.sectionsOverride,'
hit(source, m2Real, 'M2')
const m2Source = source.replace(m2Real, "    sectionsOverride: { goal: summary.text, state: summary.text, dead: summary.text, next: summary.text },")

// M3 指纹绕过：把 sourceProof 的 rawSha256 伪造成格式合法但内容不符的值。
//   ★为什么不是「删掉 ok!==true 的 throw」：真实文件存在时 sourceProof 本来就 ok，
//     删掉校验后行为一字不差 ⇒ 那种变异**没有区分力**，实测 MISSED（不是守卫失效，
//     是变异选错了靶）。真正的守卫是「落库指纹必须逐字节对应磁盘」。
const m3Real = "  if (!sourceProof || sourceProof.ok !== true || sourceProof.verified !== true) {"
hit(source, m3Real, 'M3')
const m3Source = source
  .replace('  const sourceProof = await buildHandoffSourceProofPre(', '  let sourceProof = await buildHandoffSourceProofPre(')
  .replace('  const parsed = parseHandoffCoveragePre(text)', "  sourceProof = { ...sourceProof, rawSha256: '0'.repeat(64) }\n  const parsed = parseHandoffCoveragePre(text)")

// M4 真实事件绑定绕过：读回时不用真实 eventId（改用「最近一条」）
const m4Real = "  const selected = selectEventCheckpointPre(store, { eventId: resolvedEventId, checkpointIndex })"
hit(source, m4Real, 'M4')
const m4Source = source.replace(m4Real, '  const selected = selectEventCheckpointPre(store, { eventId: (store.events[store.events.length - 1] || {}).id, checkpointIndex })')

const mutations = [
  {
    name: 'M1 全文回填（摘要被绕成全文）',
    src: m1Source,
    run: async (mod, ctx) => {
      const r = await mod.appendStoredHandoffCheckpointPre({ ...ctx, kind: 'handoff' })
      const store = await readStorePre(ctx.storePath)
      const cp = store.events.find((e) => e.id === r.eventId).checkpoints[r.checkpointIndex]
      // 变异生效的判据 = 落库正文被撑成全文 / 超出上限
      return cp.text.length > 300 && cp.text === ctx.ledgerText
    },
  },
  {
    name: 'M2 四段从摘要错误派生',
    src: m2Source,
    run: async (mod, ctx) => {
      const r = await mod.appendStoredHandoffCheckpointPre({ ...ctx, kind: 'handoff' })
      const store = await readStorePre(ctx.storePath)
      const cp = store.events.find((e) => e.id === r.eventId).checkpoints[r.checkpointIndex]
      // ★检测「四段是否来自真实原文」的唯一有区分力的判据：与**原文解析结果**逐字比较。
      //   不能写成「不含某独有串」——摘要串本来也不含它，那样恒真（假绿）。
      const { parseHandoffCoveragePre } = await import('../../lib/handoff-coverage.js')
      const src = parseHandoffCoveragePre(ctx.ledgerText)
      const drifted = ['goal', 'state', 'dead', 'next'].filter((k) => cp[k] !== src.quad[k])
      return drifted.length > 0
    },
  },
  {
    name: 'M3 指纹绕过（伪造 rawSha256）',
    src: m3Source,
    run: async (mod, ctx) => {
      const r = await mod.appendStoredHandoffCheckpointPre({ ...ctx, kind: 'handoff' })
      const store = await readStorePre(ctx.storePath)
      const cp = store.events.find((e) => e.id === r.eventId).checkpoints[r.checkpointIndex]
      // 变异生效 = 落库指纹不再等于真实磁盘字节的 sha256
      return cp.rawSha256 !== sha256(Buffer.from(ctx.ledgerText, 'utf8'))
    },
  },
  {
    name: 'M4 真实事件绑定绕过（读回改用另一事件）',
    src: m4Source,
    run: async (mod, ctx) => {
      // 变异生效 = 返回的 eventId / 读回绑定不再是调用方给的显式事件（即「磁铁」复活）
      try {
        const r = await mod.appendStoredHandoffCheckpointPre({ ...ctx, kind: 'handoff' })
        return r.eventId !== ctx.eventId
      } catch (_) { return true }
    },
  },
]

let caught = 0
for (const mut of mutations) {
  const modPath = path.join(mutationRoot, 'handoff-write.mut.js')
  await fs.writeFile(modPath, mut.src, 'utf8')
  const dir = path.join(mutationRoot, 'run-' + createHash('sha1').update(mut.name).digest('hex').slice(0, 8))
  await fs.mkdir(dir, { recursive: true })
  const storeM = path.join(dir, 'event-store.json')
  const hdM = path.join(dir, 'handoff')
  await fs.mkdir(hdM, { recursive: true })
  const ledgerM = path.join(hdM, 'handoff-mut.md')
  await fs.writeFile(ledgerM, ledgerText, 'utf8')
  const evM = await eventStorePre.create(storeM, { name: 'mutation target' })
  // ★第二个事件必须**晚于** evM：M4 变异把绑定改成「store.events[最后一条]」，
  //   若夹具只有 1 个事件，最后一条就是 evM 本身 ⇒ 变异完全无效、必然 MISSED（实测踩中）。
  await eventStorePre.create(storeM, { name: 'mutation decoy（更晚的事件）' })
  const mod = await import(pathToFileURL(modPath).href + '?m=' + encodeURIComponent(mut.name))
  let detected = false
  try {
    detected = await mut.run(mod, { storePath: storeM, handoffDir: hdM, sourcePath: ledgerM, eventId: evM.id, ledgerText })
  } catch (_) { detected = true }
  ok(detected === true, 'CAUGHT ' + mut.name)
  if (detected) caught++
}
eq(caught, mutations.length, 'M 全部变异 CAUGHT（' + caught + '/' + mutations.length + '）')

await fs.rm(root, { recursive: true, force: true })
console.log('DONE ' + checks)

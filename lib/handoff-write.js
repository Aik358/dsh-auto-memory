import { createHash } from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileWithinRoots } from './file-boundary.js'
import { buildHandoffCheckpointSummaryPre } from './handoff-checkpoint.js'
import { appendHandoffCheckpointPre } from './event-write.js'
import { readStorePre } from './event-store.js'
import { readEventCheckpointPre, selectEventCheckpointPre } from './event-drilldown.js'
import {
  HANDOFF_SOURCE_PROOF_SCHEMA,
  assessHandoffCoveragePre,
  buildHandoffSourceProofPre,
  parseHandoffCoveragePre,
} from './handoff-coverage.js'
import { computeLegacyCheckpointKey, normalizeText } from './ledger-doc/protocol.js'

/**
 * 2.9：把「已真实落盘的 handoff/plan 文档」接成事件侧的可信检查点。
 *
 * 为什么需要这一层（而不是在 memory_note 里直接拼）：
 *   ① 真实来源证明只能在文件写成功**之后**取得 —— 文件名带时间戳、锚点由写入侧加、
 *      PLAN.md 只有 writePlanSnapshot 成功后才存在；
 *   ② 摘要是**确定性**的（task-17 纯函数），而来源证明是**读盘**的，两者不能混在一个函数里；
 *   ③ 覆盖评估必须绑定真实 eventId + checkpointIndex，不能猜「最近事件」。
 *
 * 纪律（与 2.9 定稿一致）：
 *   · 本模块**不写文档**：只读 sourcePath，绝不 create/edit/archive 任何 Markdown；
 *   · 覆盖证明只表示内容覆盖，**不是**删除/归档/自动认领许可（eligibleForPhysicalDelete 恒 false）；
 *   · 任何失败都如实返回/抛出可判读 code，不静默降级、不改判 covered。
 */

export const HANDOFF_WRITE_SCHEMA = 'batch2-handoff-write-v1'
export const SUPPORTED_KINDS = Object.freeze(['plan', 'handoff'])
const EVENT_ID = /^evt_[0-9a-f]{8}$/
const QUAD_FIELDS = Object.freeze(['goal', 'state', 'dead', 'next'])

const fail = (code, extra = {}) => Object.assign(new Error(code), { code, ...extra })

function requireText(value, name) {
  if (typeof value !== 'string' || !value.trim()) throw fail('handoff-write-invalid-argument', { argument: name })
  return value
}

function requireKind(kind) {
  if (!SUPPORTED_KINDS.includes(kind)) throw fail('handoff-write-invalid-kind', { kind: String(kind) })
  return kind
}

/** handoffDir 必须是**真实目录**（不是链接），否则「可信根」这句话就不成立。 */
async function assertTrustedRoot(handoffDir) {
  if (typeof handoffDir !== 'string' || !path.isAbsolute(handoffDir)) throw fail('handoff-write-handoff-dir-invalid')
  let stat
  try { stat = await fs.lstat(handoffDir) } catch (error) {
    throw fail(error?.code === 'ENOENT' ? 'handoff-write-handoff-dir-missing' : 'handoff-write-handoff-dir-unreadable')
  }
  if (stat.isSymbolicLink() || !stat.isDirectory()) throw fail('handoff-write-handoff-dir-unsafe')
  return handoffDir
}

/** 物理解析 + 组件级根包含（复用 lib/file-boundary 的单一来源，不新起第五套判据）。 */
async function resolveSourceRef(handoffDir, sourcePath) {
  if (typeof sourcePath !== 'string' || !sourcePath) throw fail('handoff-write-source-path-invalid')
  const absolute = path.isAbsolute(sourcePath) ? sourcePath : path.resolve(handoffDir, sourcePath)
  const physical = fileWithinRoots(absolute, [handoffDir], { strict: true })
  if (!physical) throw fail('handoff-write-source-outside-root', { sourcePath: String(sourcePath) })
  let stat
  try { stat = await fs.lstat(physical) } catch (error) {
    throw fail(error?.code === 'ENOENT' ? 'handoff-write-source-missing' : 'handoff-write-source-unreadable')
  }
  if (stat.isSymbolicLink() || !stat.isFile()) throw fail('handoff-write-source-unsafe')
  const relative = path.relative(handoffDir, physical).replace(/\\/g, '/')
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) throw fail('handoff-write-source-outside-root')
  return { physicalPath: physical, sourceRef: relative }
}

async function readUtf8(physicalPath) {
  const bytes = await fs.readFile(physicalPath)
  let text
  try { text = new TextDecoder('utf-8', { fatal: true }).decode(bytes) } catch {
    throw fail('handoff-write-source-not-utf8', { physicalPath })
  }
  return { text, bytes: bytes.length }
}

/**
 * 2.6 的显式归属校验在**文档写入之前**执行的那一份。
 * 语义与 appendHandoffCheckpointPre 内的预检逐字同源：只认 active/paused，
 * closed / 未知 / 非法形状一律抛 code=event-id-unavailable，绝不回退到「最新 active」。
 */
export async function assertWritableEventTargetPre(storePath, eventId) {
  const wanted = eventId == null ? '' : String(eventId)
  if (!wanted) return { ok: true, eventId: null, checked: false }
  if (!EVENT_ID.test(wanted)) throw fail('event-id-unavailable', { eventId: wanted })
  const store = await readStorePre(storePath)
  const target = (store.events || []).find((event) => event && event.id === wanted)
  if (!target || !['active', 'paused'].includes(target.status)) throw fail('event-id-unavailable', { eventId: wanted })
  return { ok: true, eventId: wanted, checked: true, status: target.status }
}

function selectCheckpointIndex(event, appendResult, summaryText) {
  const checkpoints = Array.isArray(event.checkpoints) ? event.checkpoints : []
  const reported = appendResult && appendResult.checkpointIndex
  if (Number.isSafeInteger(reported) && reported >= 0 && reported < checkpoints.length) return reported
  const idemKey = appendResult && appendResult.idemKey
  if (typeof idemKey === 'string' && idemKey) {
    const matches = []
    checkpoints.forEach((checkpoint, index) => { if (checkpoint?.idemKey === idemKey) matches.push(index) })
    if (matches.length === 1) return matches[0]
  }
  // append 语义是 push 到末尾；没有 explicit index 时唯一确定的定位点就是最后一条。
  return checkpoints.length - 1
}

function legacyKeyFor(eventId, checkpointIndex, checkpoint) {
  return computeLegacyCheckpointKey({
    eventId,
    checkpointIndex,
    at: checkpoint.at ?? null,
    kind: checkpoint.kind ?? null,
    text: checkpoint.text ?? null,
    sourceRef: checkpoint.sourceRef ?? null,
    idemKey: checkpoint.idemKey ?? null,
    quad: Object.fromEntries(QUAD_FIELDS.map((key) => [key, checkpoint[key] ?? null])),
  })
}

/**
 * 写盘后接线：真实文件 → 可信来源证明 → 确定性摘要 → 检查点 → 读回 → 覆盖评估。
 *
 * 调用方必须已经成功写盘并持有**真实返回的路径**（引擎返回的 p，不是自己拼的）。
 */
export async function appendStoredHandoffCheckpointPre(input = {}) {
  const {
    storePath, handoffDir, sourcePath, kind, eventId, today, boundaryMinutes,
    identityText, identityPath,
    userPercept, agentTrace, sharedGround, commitment,
  } = input
  requireText(storePath, 'storePath')
  const safeKind = requireKind(kind)
  const root = await assertTrustedRoot(handoffDir)
  const { physicalPath, sourceRef } = await resolveSourceRef(root, sourcePath)
  const { text, bytes } = await readUtf8(physicalPath)
  if (!text.trim()) throw fail('handoff-write-source-empty', { sourceRef })

  // ① 可信来源证明：描述的是**真实磁盘字节**，不是调用方的声明。
  const sourceProof = await buildHandoffSourceProofPre(
    { documentText: text, sourceRef, expectDiskText: true },
    { handoffDir: root },
  )
  if (!sourceProof || sourceProof.ok !== true || sourceProof.verified !== true) {
    throw fail('handoff-write-source-proof-unverified', { sourceRef, sourceProofCode: sourceProof?.code || null, sourceProof })
  }

  // ② 四段来自**已落盘原文**；plan 无四段是合法的，不强套 handoff 完整性。
  const parsed = parseHandoffCoveragePre(text)
  const quad = { goal: parsed.quad?.goal || '', state: parsed.quad?.state || '', dead: parsed.quad?.dead || '', next: parsed.quad?.next || '' }

  // ③ 确定性摘要（纯函数，不读盘、不推断 eventId）。
  const summary = buildHandoffCheckpointSummaryPre({ kind: safeKind, text, quad })
  if (!summary || summary.ok !== true || typeof summary.text !== 'string') {
    throw fail('handoff-write-summary-unavailable', { sourceRef, summaryCode: summary?.code || null })
  }

  // ④ 事件侧写入：身份用**完整正文**，正文用摘要；四段显式来自原文。
  // ★幂等身份必须与**旧路径同源**：旧 Phase 1 用的是模型传入的 writeH、且不传 ledgerPath。
  //   若这里改用读回的磁盘正文（含写入侧加的 H1 标题与锚点）或传 ledgerPath，同一意图的两次
  //   写入会得到不同 idemKey ⇒ 去重失效、检查点重复增长（2.8 套件实测抓到）。
  //   故身份默认仍是磁盘正文（独立调用场景），但共享入口可显式传 identityText/identityPath 复刻旧口径。
  const identitySource = typeof identityText === 'string' && identityText ? identityText : text
  const appendResult = await appendHandoffCheckpointPre(storePath, {
    ledgerText: identitySource,
    ledgerPath: identityPath === undefined ? undefined : identityPath,
    kind: safeKind,
    eventId: eventId == null || eventId === '' ? undefined : String(eventId),
    today,
    boundaryMinutes,
    summary,
    sourceProof,
    sectionsOverride: summary.sectionsOverride,
    userPercept,
    agentTrace,
    sharedGround,
    commitment,
  })
  if (!appendResult || appendResult.ok !== true) throw fail('handoff-write-checkpoint-append-failed', { sourceRef })
  const resolvedEventId = String(appendResult.eventId || '')
  if (!EVENT_ID.test(resolvedEventId)) throw fail('handoff-write-event-id-invalid', { eventId: resolvedEventId })

  // ⑤ 用真实 eventId + checkpointIndex 从事件库读回**同一事件里的同一检查点**。
  const store = await readStorePre(storePath)
  const event = (store.events || []).find((item) => item && item.id === resolvedEventId)
  if (!event) throw fail('handoff-write-event-not-found', { eventId: resolvedEventId })
  const checkpointIndex = selectCheckpointIndex(event, appendResult, summary.text)
  const selected = selectEventCheckpointPre(store, { eventId: resolvedEventId, checkpointIndex })
  if (!selected || selected.ok !== true) throw fail('handoff-write-checkpoint-readback-failed', { eventId: resolvedEventId, checkpointIndex, selectCode: selected?.code || null })
  const checkpoint = selected.checkpoint || {}
  // 摘要必须真的落库；否则「2.7 正文形态」在这里就是假接线（不静默放行）。
  if (typeof checkpoint.text !== 'string' || checkpoint.text !== summary.text) {
    throw fail('handoff-write-summary-not-applied', {
      eventId: resolvedEventId,
      checkpointIndex,
      expectedChars: summary.text.length,
      actualChars: typeof checkpoint.text === 'string' ? checkpoint.text.length : null,
    })
  }

  const stored = { ...checkpoint, eventId: resolvedEventId, checkpointIndex, legacyCheckpointKey: legacyKeyFor(resolvedEventId, checkpointIndex, checkpoint) }
  // ⑥ 指针回读：这是 2.9 的**真证据** —— 摘要正文本身不再可自证（2.7 的必然结果），
  //   能证的只有「指针指向的仍是当初那份字节」。走既有 readEventCheckpointPre（readPointerPre 消费
  //   normalizedSha256 = normalizeText 口径），不新起第五套判据。
  const pointerReadback = await readEventCheckpointPre({
    store, eventId: resolvedEventId, checkpointIndex, handoffDir: root,
  })
  // ★口径分离（Lead 2026-11-13 指出）：摘要检查点的 rawSha256/normalizedSha256 描述的是**真源**，
  //   不是检查点正文。喂给 assessHandoffCoveragePre 之前必须剥离，否则它按「正文指纹」验算必假红。
  const fingerprintScopes = fingerprintScopesPre(checkpoint, sourceProof)
  const coverage = safeKind === 'handoff'
    ? await assessHandoffCoveragePre(
      { documentText: text, sourceRef, eventId: resolvedEventId, checkpointIndex, checkpoint: withoutSourceFingerprintsPre(stored), event, sourceProof, intent: 'write' },
      { handoffDir: root },
    )
    : null
  // ★2.9 当前指针覆盖（摘要形态唯一有效的 covered 判据）：证「检查点如实指向真源」，
  //   不证「摘要含全文」。原 coverage 保留原判定（对 legacy/full-text 仍有效），两者并列不互相顶替。
  const sourceParsed = parseHandoffCoveragePre(text)
  const expectedSummary = buildHandoffCheckpointSummaryPre({ kind: safeKind, text, quad })
  const pointerCoverage = await assessCurrentPointerCoveragePre({
    checkpoint: stored,
    event,
    eventId: resolvedEventId,
    checkpointIndex,
    source: sourceParsed,
    sourceProof,
    sourceRef,
    expectedSummary,
    readback: pointerReadback,
  })

  return {
    ok: true,
    schemaVersion: HANDOFF_WRITE_SCHEMA,
    eventId: resolvedEventId,
    checkpointIndex,
    sourceProof,
    coverage,
    pointerCoverage,
    deduped: appendResult.deduped === true,
    // ★摘要检查点**不能**自证全文覆盖：text 只有 ≤300 字符，assessHandoffCoveragePre 拿它当
    //   "checkpoint 全文"必然判不 covered。这不是缺陷而是 2.7 的设计后果，故显式标注，
    //   避免下游把 non-covered 误读成"接线坏了"。真正的证据链是 pointerReadback + sourceProof。
    coverageLimitation: 'summary-checkpoint-cannot-self-prove-full-text',
    // ★三种 sha256 口径并列，禁止互换：真源 raw / 指针 normalize / 覆盖 normalize / 摘要正文自身
    fingerprintScopes,
    pointerReadback: {
      ok: pointerReadback && pointerReadback.ok === true,
      verified: pointerReadback && pointerReadback.verified === true,
      code: (pointerReadback && pointerReadback.code) || null,
      sourceRef: (pointerReadback && pointerReadback.sourceRef) || null,
      bytes: (pointerReadback && pointerReadback.bytes) ?? null,
    },
    summaryChars: summary.text.length,
    summaryTruncated: summary.truncated === true,
    sourceBytes: Number(sourceProof.bytes) || bytes,
    sourceRef,
  }
}

/**
 * 只读评估：给定真实 eventId 与**唯一**选择器，取该检查点并做覆盖评估。
 * 不猜最近事件、不越界、不改数据；缺证据/漂移/不匹配一律如实返回。
 */
export async function assessStoredHandoffCheckpointPre(input = {}) {
  const { storePath, handoffDir, eventId, checkpointIndex, idemKey } = input
  if (typeof storePath !== 'string' || !storePath) throw fail('handoff-write-invalid-argument', { argument: 'storePath' })
  const root = await assertTrustedRoot(handoffDir)
  const store = await readStorePre(storePath)
  const selector = {}
  if (checkpointIndex !== undefined && checkpointIndex !== null) selector.checkpointIndex = checkpointIndex
  if (idemKey !== undefined && idemKey !== null) selector.idemKey = idemKey
  const selected = selectEventCheckpointPre(store, { eventId: String(eventId == null ? '' : eventId), ...selector })
  if (!selected || selected.ok !== true) return { ok: false, code: selected?.code || 'checkpoint-select-failed', eventId: String(eventId || '') }
  const checkpoint = selected.checkpoint || {}
  const sourceRef = typeof checkpoint.sourceRef === 'string' && checkpoint.sourceRef ? checkpoint.sourceRef : null
  const stored = { ...checkpoint, eventId: selected.eventId, checkpointIndex: selected.checkpointIndex, legacyCheckpointKey: legacyKeyFor(selected.eventId, selected.checkpointIndex, checkpoint) }

  if (!sourceRef) {
    // 旧全文检查点：没有指针就没有「真源」可证。用检查点自身文本作源 ⇒ status 必为 needs-review，
    //   绝不因为「同一份文本」就改判 covered（那正是 2.7 要消除的自我循环）。
    const legacy = await assessHandoffCoveragePre(
      { documentText: String(checkpoint.text || ''), eventId: selected.eventId, checkpointIndex: selected.checkpointIndex, checkpoint: stored, event: selected.event, intent: 'read' },
      { handoffDir: root },
    )
    return { ok: legacy.ok === true, code: 'legacy-checkpoint-no-pointer', eventId: selected.eventId, checkpointIndex: selected.checkpointIndex, coverage: legacy }
  }

  let resolved
  try { resolved = await resolveSourceRef(root, sourceRef) } catch (error) {
    return { ok: false, code: 'source-unavailable', detail: String(error?.code || error), eventId: selected.eventId, checkpointIndex: selected.checkpointIndex, sourceRef }
  }
  const sourceProof = await buildHandoffSourceProofPre({ sourceRef: resolved.sourceRef, expectDiskText: true }, { handoffDir: root })
  if (!sourceProof || sourceProof.ok !== true) {
    return { ok: false, code: 'source-proof-unverified', detail: String(sourceProof?.code || 'unknown'), eventId: selected.eventId, checkpointIndex: selected.checkpointIndex, sourceRef: resolved.sourceRef, sourceProof }
  }
  const { text } = await readUtf8(resolved.physicalPath)
  const fingerprintScopes = fingerprintScopesPre(checkpoint, sourceProof)
  const coverage = await assessHandoffCoveragePre(
    { documentText: text, sourceRef: resolved.sourceRef, eventId: selected.eventId, checkpointIndex: selected.checkpointIndex, checkpoint: withoutSourceFingerprintsPre(stored), event: selected.event, sourceProof, intent: 'read' },
    { handoffDir: root },
  )
  const sourceParsed = parseHandoffCoveragePre(text)
  const expectedSummary = buildHandoffCheckpointSummaryPre({
    kind: checkpoint.kind === 'plan' ? 'plan' : 'handoff',
    text,
    quad: { goal: checkpoint.goal || '', state: checkpoint.state || '', dead: checkpoint.dead || '', next: checkpoint.next || '' },
  })
  const pointerCoverage = await assessCurrentPointerCoveragePre({
    checkpoint: stored,
    event: selected.event,
    eventId: selected.eventId,
    checkpointIndex: selected.checkpointIndex,
    source: sourceParsed,
    sourceProof,
    sourceRef: resolved.sourceRef,
    expectedSummary,
    readback: await readEventCheckpointPre({ store, eventId: selected.eventId, checkpointIndex: selected.checkpointIndex, handoffDir: root }),
  })
  return {
    ok: coverage.ok === true,
    code: coverage.code,
    status: coverage.status,
    eventId: selected.eventId,
    checkpointIndex: selected.checkpointIndex,
    sourceRef: resolved.sourceRef,
    sourceProofSchema: HANDOFF_SOURCE_PROOF_SCHEMA,
    sourceProof,
    fingerprintScopes,
    coverage,
    pointerCoverage,
  }
}

/**
 * 摘要检查点的指纹口径（2.9 · task-18）。
 *
 * ★三种 sha256 名字相近、语义完全不同，**禁止互换**：
 *   sourceRawSha256                 = 真源文件 UTF-8 字节的 sha256（rawSha256）
 *   sourceDocumentNormalizedSha256  = 真源文件的 ledger-doc/protocol.normalizeText 口径（normalizedSha256，
 *                                     由 readPointerPre / readEventCheckpointPre 消费）
 *   sourceCoverageNormalizedSha256  = 真源文件的覆盖规范化（handoff-normalize）口径（documentNormalizedSha256，
 *                                     由 assessHandoffCoveragePre 消费）
 *   summaryTextRawSha256            = **摘要正文本身**的 sha256 —— 只有这个才配得上「检查点正文指纹」
 *
 * ★为什么要显式区分：handoff-coverage 的 checkpointTextFingerprint 把 checkpoint.rawSha256 /
 *   checkpoint.normalizedSha256 当作**检查点正文**的指纹去验算（sha256(checkpoint.text)）。
 *   对 2.7 的摘要检查点，这两个字段描述的是**真源**，不是摘要 ⇒ 直接喂进去会产生
 *   checkpoint-raw-fingerprint-mismatch 这类**假红**，掩盖真正的结论。
 *   ⇒ 评估时先把它们剥离（见 withoutSourceFingerprintsPre），指纹证据改走 sourceProof + pointerReadback。
 */
function fingerprintScopesPre(checkpoint, sourceProof) {
  const sha256 = (v) => createHash('sha256').update(v).digest('hex')
  const text = typeof checkpoint.text === 'string' ? checkpoint.text : ''
  const cpRaw = String(checkpoint.rawSha256 || '').replace(/^sha256:/, '')
  const cpNorm = String(checkpoint.normalizedSha256 || '').replace(/^sha256:/, '')
  const summaryRaw = sha256(Buffer.from(text, 'utf8'))
  return {
    // 检查点里的两个字段到底是「真源指针」还是「正文自证」——由实测判定，不靠约定。
    fingerprintScope: cpRaw && cpRaw === summaryRaw ? 'checkpoint-full-text' : (cpRaw ? 'source-pointer' : 'none'),
    sourceRawSha256: cpRaw || null,
    sourceDocumentNormalizedSha256: cpNorm || null,
    sourceCoverageNormalizedSha256: (sourceProof && sourceProof.normalizedSha256) || null,
    summaryTextRawSha256: summaryRaw,
    summaryTextDocumentNormalizedSha256: sha256(normalizeText(text)),
    summaryChars: text.length,
  }
}

/** 评估前剥离「真源口径」的两个字段：它们不是检查点正文的指纹，喂给 coverage 会产生假红。 */
function withoutSourceFingerprintsPre(checkpoint) {
  const { rawSha256, normalizedSha256, ...rest } = checkpoint
  return rest
}

/**
 * 2.9 当前覆盖评估（摘要指针形态）—— **不改 assessHandoffCoveragePre 的本体判定**。
 *
 * 背景：2.7 之后检查点正文是 <=300 字符摘要，checkpoint.text **不再是全文**。
 *   原 assessHandoffCoveragePre 的 content 门把 checkpoint.text 当全文去和真源逐段比，
 *   对摘要形态必然 mismatch —— 那是「拿摘要冒充全文」，不能靠改口说成 covered。
 *
 * 本函数给出**指针形态自己的、可复算的**覆盖判据：证的是「这条检查点如实指向那份真源」，
 *   而不是「这条摘要包含全文」。六个门全部可独立复算：
 *     identity    真实事件存在、检查点确实是该事件成员、legacy key 由真实字段推导且自洽
 *     binding     checkpoint.sourceRef == 真源 sourceRef
 *     provenance  bytes / rawSha256 / normalizedSha256 三项分别对上真源真实值
 *                 （★normalizedSha256 是 normalizeText 口径，**不是**摘要正文的哈希）
 *     quad        原始四段逐字段等于真源解析出的四段
 *     summary     检查点正文 == 同一纯函数对「同真源+同四段」的输出（确定性复算）
 *     recoverable 指针回读能从磁盘逐字节还原真源
 *
 * ★covered 仍然**不是**删除/归档/认领许可：这些字段恒为 false，由本函数自己给出。
 */
export const HANDOFF_POINTER_COVERAGE_SCHEMA = 'batch2-handoff-pointer-coverage-v1'
const PQUAD_KEYS = Object.freeze(['goal', 'state', 'dead', 'next'])
const PSUMMARY_CHARS = 300

export async function assessCurrentPointerCoveragePre(input = {}) {
  const { checkpoint, event, eventId, checkpointIndex, source, sourceProof, sourceRef, expectedSummary } = input
  const reasons = []
  const gates = { identity: false, binding: false, provenance: false, quad: false, summary: false, recoverable: false }
  const detail = {}
  const sha = (v) => createHash('sha256').update(v).digest('hex')
  const norm = (v) => String(v == null ? '' : v).trim().replace(/^sha256:/, '')

  // identity
  const cpIndex = Array.isArray(event && event.checkpoints) ? event.checkpoints.indexOf(checkpoint) : -1
  const memberByIdem = Array.isArray(event && event.checkpoints)
    ? event.checkpoints.some((item) => item && checkpoint && item.idemKey && item.idemKey === checkpoint.idemKey)
    : false
  const legacyKey = checkpoint && checkpoint.legacyCheckpointKey ? String(checkpoint.legacyCheckpointKey) : ''
  const legacyRecomputed = legacyKey
    ? computeLegacyCheckpointKey({
      eventId,
      checkpointIndex,
      at: checkpoint.at ?? null,
      kind: checkpoint.kind ?? null,
      text: checkpoint.text ?? null,
      sourceRef: checkpoint.sourceRef ?? null,
      idemKey: checkpoint.idemKey ?? null,
      quad: Object.fromEntries(PQUAD_KEYS.map((key) => [key, checkpoint[key] ?? null])),
    })
    : null
  gates.identity = EVENT_ID.test(String(eventId || ''))
    && !!event && String(event.id || '') === String(eventId)
    && (cpIndex === checkpointIndex || memberByIdem)
    && (!legacyKey || legacyRecomputed === legacyKey)
  detail.identity = { eventId, checkpointIndex, cpIndex, memberByIdem, legacyKeyPresent: !!legacyKey, legacyKeySelfConsistent: !legacyKey || legacyRecomputed === legacyKey }
  if (!gates.identity) reasons.push('pointer-identity-unverified')

  // binding
  const cpSourceRef = checkpoint && typeof checkpoint.sourceRef === 'string' ? checkpoint.sourceRef : ''
  gates.binding = !!cpSourceRef && !!sourceRef && cpSourceRef === sourceRef
  detail.binding = { checkpointSourceRef: cpSourceRef || null, sourceRef: sourceRef || null }
  if (!gates.binding) reasons.push('pointer-source-ref-mismatch')

  // provenance：三项分别对上真源（不拿摘要哈希充数）
  const proofOk = !!(sourceProof && sourceProof.ok === true && sourceProof.verified === true)
  const proofRaw = proofOk ? norm(sourceProof.rawSha256) : null
  const proofBytes = proofOk && Number.isFinite(Number(sourceProof.bytes)) ? Number(sourceProof.bytes) : null
  // ★真源真值一律取自 **sourceProof**（它是对真实磁盘字节算出来的），不拿 checkpoint 自证；
  //   source 对象只提供四段解析结果。source.normalization.* 兼容两种入参形态。
  const norm0 = (source && source.normalization) || {}
  const realRaw = proofRaw != null ? proofRaw : (norm0.rawSha256 || null)
  const realBytes = proofBytes != null ? proofBytes : (norm0.rawBytes != null ? Number(norm0.rawBytes) : null)
  const cpBytes = Number(checkpoint && checkpoint.bytes)
  const cpRaw = norm(checkpoint && checkpoint.rawSha256)
  const cpNorm = norm(checkpoint && checkpoint.normalizedSha256)
  const bytesOk = Number.isFinite(cpBytes) && realBytes != null && Number(cpBytes) === Number(realBytes)
  const rawOk = !!realRaw && cpRaw === realRaw
  const normOk = proofOk && cpNorm === norm(sourceProof.documentNormalizedSha256)
  gates.provenance = proofOk && bytesOk && rawOk && normOk
  detail.provenance = {
    sourceProofOk: proofOk, bytesOk, rawOk, normalizedOk: normOk,
    checkpointBytes: Number.isFinite(cpBytes) ? cpBytes : null,
    sourceBytes: realBytes,
    checkpointRawSha256: cpRaw || null,
    sourceRealRawSha256: realRaw,
    checkpointNormalizedSha256: cpNorm || null,
    sourceDocumentNormalizedSha256: proofOk ? norm(sourceProof.documentNormalizedSha256) : null,
    sourceCoverageNormalizedSha256: proofOk ? norm(sourceProof.normalizedSha256) : null,
    summaryTextRawSha256: checkpoint && typeof checkpoint.text === 'string' ? sha(Buffer.from(checkpoint.text, 'utf8')) : null,
  }
  if (!proofOk) reasons.push('pointer-source-proof-unverified')
  if (!bytesOk) reasons.push('pointer-bytes-mismatch')
  if (!rawOk) reasons.push('pointer-raw-sha256-mismatch')
  if (!normOk) reasons.push('pointer-normalized-sha256-mismatch')

  // quad：原始四段逐字段等于真源解析结果
  const quadDrift = []
  for (const key of PQUAD_KEYS) {
    const cpValue = String((checkpoint && checkpoint[key]) == null ? '' : checkpoint[key])
    const srcValue = String((source && source.quad && source.quad[key]) == null ? '' : source.quad[key])
    if (cpValue !== srcValue) quadDrift.push({ field: key, checkpoint: cpValue, source: srcValue })
  }
  gates.quad = quadDrift.length === 0
  detail.quad = { drift: quadDrift }
  if (!gates.quad) reasons.push('pointer-quad-drift')

  // summary：确定性复算
  const cpText = checkpoint && typeof checkpoint.text === 'string' ? checkpoint.text : ''
  gates.summary = cpText.length <= PSUMMARY_CHARS
    && !!expectedSummary && expectedSummary.ok === true && cpText === expectedSummary.text
  detail.summary = {
    chars: cpText.length,
    limit: PSUMMARY_CHARS,
    expectedChars: expectedSummary && expectedSummary.ok === true ? expectedSummary.text.length : null,
    matchesDeterministicRecompute: !!(expectedSummary && expectedSummary.ok === true && cpText === expectedSummary.text),
    textIsFullDocument: false,
  }
  if (!gates.summary) reasons.push('pointer-summary-mismatch')

  // recoverable
  detail.recoverable = input.readback || null
  gates.recoverable = !!(input.readback && input.readback.ok === true && input.readback.verified === true)
  if (!gates.recoverable) reasons.push('pointer-not-recoverable')

  const allPass = Object.values(gates).every((v) => v === true)
  const status = allPass ? 'covered' : (reasons.some((r) => /mismatch|drift|unverified/.test(r)) ? 'partial' : 'needs-review')
  return {
    schemaVersion: HANDOFF_POINTER_COVERAGE_SCHEMA,
    ok: allPass,
    status,
    disposition: status,
    scope: 'current-pointer-coverage-only',
    eligibleForPhysicalDelete: false,
    eligibleForArchive: false,
    eligibleForMerge: false,
    eventClaimed: false,
    writesPerformed: false,
    historicalContentCovered: false,
    currentContentCovered: allPass,
    gates,
    reasonCodes: [...new Set(reasons)].sort(),
    detail,
  }
}

export default { appendStoredHandoffCheckpointPre, assessStoredHandoffCheckpointPre, assessCurrentPointerCoveragePre, assertWritableEventTargetPre }

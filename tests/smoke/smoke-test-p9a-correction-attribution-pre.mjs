#!/usr/bin/env node
/** smoke-test-p9a-correction-attribution-pre —— P9a correction 归因修正 回归锁定(2026-09-09)。
 * 覆盖:归因选择器纯函数(最近一条 cite/read / 5 分钟窗口 / 单条 precision /
 * 同记忆一轮一条去重 / ts 平局确定性 / 非法输入 fail-soft)/
 * emitTextEvidence 接线源核验(保留 cite、diag 不记用户原文)/
 * 投影形态事件 → createAccessEvidencePre(kind=correction) 构造合法证据。
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { selectCorrectionAttributionPre } from '../../lib/context-host-pre.js'
import { createAccessEvidencePre, CORRECTION_LEXICON_PRE_V1 } from '../../lib/context-bridge-pre.js'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const SRC = readFileSync(path.resolve(HERE, '..', '..', 'lib', 'context-host-pre.js'), 'utf8')
let pass = 0, fail = 0
const ok = (c, n) => { if (c) { pass++; console.log('  ok -', n) } else { fail++; console.error('FAIL', n) } }

const NOW = Date.UTC(2026, 8, 9, 12, 0, 0) // 2026-09-09 12:00Z
const WINDOW = 5 * 60 * 1000
const memId = (c) => 'mem_' + c.repeat(32)
const hex64 = (c) => c.repeat(64)
/** 投影形态事件(loadEvents 输出):ts 在 event.ts 内,provenance 顶层+source 嵌套。 */
const projected = (kind, mem, ts, extra = {}) => ({
  evidenceId: 'ev_' + mem.slice(4, 12) + '_' + kind,
  kind, memoryId: mem, anchorId: 'anc_' + mem.slice(4, 12), scope: 'Workspace',
  workspaceRef: 'Workspace:demo',
  event: { sessionRef: 'session-demo', eventSeq: 1, contextVersion: 1, ts },
  source: { sourceRef: 'workspace:notes.md', sourceEpoch: '1', sourceVersion: 1, fileDigest: hex64('a'), recordDigest: hex64('b') },
  policyVersion: 'evidence_policy_pre_v1', recordedAt: ts,
  ...extra,
})

console.log('[p9a] G1 最近一条 cite/read 被选中(read 比 cite 新 → read)')
{
  const events = [
    projected('cite', memId('a'), NOW - 60 * 1000),
    projected('read', memId('b'), NOW - 30 * 1000),
  ]
  const sel = selectCorrectionAttributionPre({ events, now: NOW, windowMs: WINDOW })
  ok(sel && sel.memoryId === memId('b'), '选最近一条:read(t-30s) 胜出 cite(t-60s)')
  ok(sel && sel.kind === 'read' && sel.anchorId === 'anc_' + memId('b').slice(4, 12), '返回完整事件(provenance 可透传)')
}
console.log('[p9a] G2 cite 更新时 cite 胜出(窗口内不分优先级,只看时间)')
{
  const events = [
    projected('read', memId('a'), NOW - 120 * 1000),
    projected('cite', memId('b'), NOW - 10 * 1000),
  ]
  const sel = selectCorrectionAttributionPre({ events, now: NOW, windowMs: WINDOW })
  ok(sel && sel.memoryId === memId('b') && sel.kind === 'cite', 'cite(t-10s) 胜出 read(t-120s)')
}
console.log('[p9a] G3 5 分钟窗口:界外不发,边界恰在 cutoff 上保留')
{
  const out = selectCorrectionAttributionPre({ events: [projected('cite', memId('a'), NOW - WINDOW - 1)], now: NOW, windowMs: WINDOW })
  ok(out === null, '窗口外 1ms → 不归因(null)')
  const edge = selectCorrectionAttributionPre({ events: [projected('cite', memId('a'), NOW - WINDOW)], now: NOW, windowMs: WINDOW })
  ok(edge && edge.memoryId === memId('a'), '恰在窗口边界(ets===cutoff)→ 归因')
  const empty = selectCorrectionAttributionPre({ events: [projected('seen', memId('a'), NOW - 1000)], now: NOW, windowMs: WINDOW })
  ok(empty === null, '仅 seen 事件 → 不归因(只认 cite/read)')
}
console.log('[p9a] G4 同一记忆一轮最多一条 correction(窗口内已有 correction → 跳过)')
{
  const events = [
    projected('cite', memId('a'), NOW - 30 * 1000),
    projected('correction', memId('a'), NOW - 20 * 1000),
    projected('read', memId('b'), NOW - 40 * 1000),
  ]
  const sel = selectCorrectionAttributionPre({ events, now: NOW, windowMs: WINDOW })
  ok(sel && sel.memoryId === memId('b'), 'mem_a 已有窗口内 correction → 跳过,归因到 mem_b')
  const allCorrected = selectCorrectionAttributionPre({ events: [
    projected('cite', memId('a'), NOW - 30 * 1000),
    projected('correction', memId('a'), NOW - 20 * 1000),
  ], now: NOW, windowMs: WINDOW })
  ok(allCorrected === null, '唯一候选已被纠正 → 不发(防重复惩罚)')
}
console.log('[p9a] G5 ts 平局确定性(平局按 memoryId 升序)')
{
  const events = [projected('cite', memId('f'), NOW - 1000), projected('cite', memId('3'), NOW - 1000)]
  const s1 = selectCorrectionAttributionPre({ events, now: NOW, windowMs: WINDOW })
  const s2 = selectCorrectionAttributionPre({ events: [...events].reverse(), now: NOW, windowMs: WINDOW })
  ok(s1 && s1.memoryId === memId('3'), '同 ts → memoryId 升序取 mem_3(确定性)')
  ok(s2 && s2.memoryId === s1.memoryId, '输入顺序翻转结果不变(确定性)')
}
console.log('[p9a] G6 非法输入 fail-soft(全场景 null)')
{
  ok(selectCorrectionAttributionPre(null) === null, 'null 输入 → null')
  ok(selectCorrectionAttributionPre({}) === null, '缺 events → null')
  ok(selectCorrectionAttributionPre({ events: 'not-array' }) === null, 'events 非数组 → null')
  ok(selectCorrectionAttributionPre({ events: [null, {}, { kind: 'cite' }, { kind: 'cite', memoryId: '' }], now: NOW }) === null, '坏条目全跳过 → null')
  ok(selectCorrectionAttributionPre({ events: [{ kind: 'cite', memoryId: memId('a'), event: { ts: 'NaN' } }], now: NOW }) === null, 'ts 非法(0<cutoff)→ null')
}
console.log('[p9a] G7 接线源核验(emitTextEvidence 保留原产出 + 隐私)')
{
  ok(SRC.includes('selectCorrectionAttributionPre({ events: st.loadEvents().events'), 'emitTextEvidence 已接归因选择器(store 注入)')
  ok(SRC.includes("kind: 'correction', memoryId: recent.memoryId"), 'correction 复用选中事件 memoryId 构造')
  ok(SRC.includes('createCiteEvidencesFromText({ text: seg.text') && SRC.includes('createCorrectionEvidencesFromText({ text: seg.text'), '原 cite/ correction 产出零改动')
  ok(SRC.includes("diagCtx('p9a correction attribution: lexHits=' + lexHits + ' attributed=' + attributedPrefix)"), 'diag 只记词典计数+memoryId 前缀')
  ok(!/diagCtx\([^)]*seg\.text/.test(SRC), 'diag 绝不记录用户原文(seg.text 不进 diagCtx)')
  ok(SRC.includes("} catch (eP9a) {"), '归因块 fail-soft(catch + diag)')
  ok(CORRECTION_LEXICON_PRE_V1.length > 0 && Object.isFrozen(CORRECTION_LEXICON_PRE_V1), '纠正词典非空且冻结(停止条件)')
}
console.log('[p9a] G8 投影事件 → correction 证据构造合法(createAccessEvidencePre)')
{
  const recent = selectCorrectionAttributionPre({ events: [projected('cite', memId('c'), NOW - 5000)], now: NOW, windowMs: WINDOW })
  const coords = { sessionId: 'session-demo', eventSeq: 9, nativeSeq: 9, contextVersion: 1, workspaceKey: 'ws-key', ts: NOW }
  const r = createAccessEvidencePre({
    ...coords, kind: 'correction', memoryId: recent.memoryId, anchorId: recent.anchorId, scope: recent.scope,
    sourceRef: recent.source.sourceRef, sourceEpoch: recent.source.sourceEpoch, sourceVersion: recent.source.sourceVersion,
    fileDigest: recent.source.fileDigest, recordDigest: recent.source.recordDigest,
  })
  ok(r.ok === true, '投影 provenance 透传 → 校验通过(ok=true)')
  ok(r.evidence && r.evidence.kind === 'correction' && r.evidence.memoryId === memId('c'), 'kind=correction 且 memoryId=归因对象')
  ok(typeof r.evidence.evidenceId === 'string' && r.evidence.evidenceId.length >= 16, 'evidenceId 确定性生成(幂等去重兜底)')
  const r2 = createAccessEvidencePre({
    ...coords, kind: 'correction', memoryId: recent.memoryId, anchorId: recent.anchorId, scope: recent.scope,
    sourceRef: recent.source.sourceRef, sourceEpoch: recent.source.sourceEpoch, sourceVersion: recent.source.sourceVersion,
    fileDigest: recent.source.fileDigest, recordDigest: recent.source.recordDigest,
  })
  ok(r2.evidence.evidenceId === r.evidence.evidenceId, '同 coords+memoryId 重放 evidenceId 一致(store 去重生效)')
}

console.log(`\n[p9a] ${pass}/${pass + fail} assertions passed`)
if (fail) process.exit(1)

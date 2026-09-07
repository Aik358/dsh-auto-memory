// M5-1 Context / Evidence Bridge 纯核心测试(docs/M5-CONTRACT.md §4-§13):
// validator/identity/coverage adapter/六类证据构造器/Null-Fake sink/push bridge/replay。
// 全程内存 fixtures,零 IO、零 Python;真实记忆零接触。
import { readFileSync } from 'node:fs'
process.on('uncaughtException', (e) => { console.error('[M51-TEST] FATAL:', (e && (e.stack || e.message)) || e); process.exit(1) })
process.on('unhandledRejection', (r) => { console.error('[M51-TEST] REJ:', r); process.exit(1) })

const CB = await import('../../lib/context-bridge.js')
let pass = 0; let fail = 0
function ok(cond, name) { if (cond) { pass++; console.log('  ok - ' + name) } else { fail++; console.error('  FAIL - ' + name) } }
function eq(a, b, name) { const ja = JSON.stringify(a); const jb = JSON.stringify(b); ok(ja === jb, name + (ja === jb ? '' : ' got=' + ja + ' want=' + jb)) }

const mem1 = 'mem_' + 'aa'.repeat(16)
const mem2 = 'mem_' + 'bb'.repeat(16)
const digest1 = 'c'.repeat(64)
const digest2 = 'd'.repeat(64)
const fileDigest = 'e'.repeat(64)
function mkRec(mid, opts = {}) {
  return { memoryId: mid || mem1, anchorId: opts.anchorId || 'memory:' + (mid || mem1), scope: opts.scope || 'Workspace',
    sourceClass: 'workspace-notes', sourceRef: opts.sourceRef || 'workspace:MEMORY.md',
    sourceEpoch: opts.sourceEpoch || '11111111-1111-4111-8111-111111111111', sourceVersion: opts.sourceVersion || 3,
    fileDigest, recordDigest: mid === mem2 ? digest2 : digest1,
    lineStart: 1, lineEnd: 5, byteStart: opts.byteStart != null ? opts.byteStart : 0, byteEnd: opts.byteEnd != null ? opts.byteEnd : 100,
    heading: opts.heading || '部署流程', text: opts.text || '部署流程使用 pnpm build 与 rsync', bytes: 100 }
}
const coords = { sessionId: 'sess-x', eventSeq: 7, nativeSeq: 42, contextVersion: 9, callId: 'call_1', workspaceKey: 'd:/ws', ts: 1700000000000 }

console.log('[A1] 策略冻结与命名空间')
ok(CB.CONTEXT_BRIDGE_POLICY_VERSION === 'context_bridge_v1', 'contextPolicyVersion 固定')
ok(CB.EVIDENCE_POLICY_VERSION === 'evidence_v1', 'evidencePolicyVersion 固定')
eq(CB.ACCESS_KINDS_V1, ['seen', 'read', 'cite', 'reuse', 'success', 'correction'], '六类证据枚举')
ok(Object.isFrozen(CB.CONTEXT_BRIDGE_BUDGET_V1), '预算对象冻结')
eq(CB.CONTEXT_BRIDGE_BUDGET_V1.maxSegments, 8, 'maxSegments=8')
ok(CB.NAMESPACE === 'dsh-auto-memory', 'namespace=_pre')

console.log('[A2] validators')
const seg = { segmentId: 'seg_1', digest: 'a'.repeat(32), kind: 'user', eventSeq: 3, contextVersion: 2, ts: 1700000000000, text: 'hello' }
ok(CB.validateContextSegmentPre(seg).ok, '合法 segment 通过')
// M7.5 契约修订(2026-08-26,用户裁定 CoT 为核心监听目标):'reasoning' 升为合法 Segment kind(权重 0.5),
// 旧断言「reasoning 不入上下文」作废;合法路径由 m53/主 smoke 的 CoT 场景覆盖。
ok(CB.validateContextSegmentPre({ ...seg, kind: 'reasoning' }).ok, 'reasoning kind 合法(M7.5 契约修订)')
ok(!CB.validateContextSegmentPre({ ...seg, digest: 'short' }).ok, '短 digest 拒绝')
const ref = { memoryId: mem1, anchorId: 'memory:' + mem1, scope: 'Workspace', sourceRef: 'workspace:MEMORY.md', sourceEpoch: 'ep-1', sourceVersion: 2, fileDigest, recordDigest: digest1 }
ok(CB.validateAuthorizedMemoryRefPre(ref).ok, '合法 memoryRef 通过')
ok(!CB.validateAuthorizedMemoryRefPre({ ...ref, memoryId: 'mem_xyz' }).ok, '坏 memoryId 拒绝')
ok(!CB.validateAuthorizedMemoryRefPre({ ...ref, scope: 'Session' }).ok, 'memoryRef scope=Session 拒绝(仅 Workspace|User)')
ok(!CB.validateAuthorizedMemoryRefPre({ ...ref, sourceRef: 'C:\\abs\\path.md' }).ok, '绝对路径 sourceRef 拒绝')
ok(!CB.validateAuthorizedMemoryRefPre({ ...ref, fileDigest: 'zz' }).ok, '坏 fileDigest 拒绝')
const agg = { memoryId: mem1, scope: 'User', freshness: 'fresh', distinctSessions: 2, seen: 1, read: 0, cite: 0, reuse: 0, success: 0, correction: 0, lastEvidenceAt: 1700000000000, policyVersion: 'evidence_v1' }
ok(CB.validateEvidenceAggregatePre(agg).ok, '合法 aggregate 通过')
ok(!CB.validateEvidenceAggregatePre({ ...agg, freshness: 'hot' }).ok, '非法 freshness 拒绝')
ok(!CB.validateEvidenceAggregatePre({ ...agg, seen: -1 }).ok, '负计数拒绝')

console.log('[A3] canonical identity')
const oid1 = CB.buildObservationId('s1', 5, seg.digest)
const oid2 = CB.buildObservationId('s1', 5, seg.digest)
const oid3 = CB.buildObservationId('s1', 6, seg.digest)
ok(oid1 === oid2 && oid1.startsWith('obs_'), 'observationId 确定(obs_)')
ok(oid1 !== oid3, 'contextVersion 变化 → observationId 变化')
const eidIn = { kind: 'read', memoryId: mem1, sessionId: 's1', eventSeq: 7, nativeSeq: 42, callId: 'c1', contextVersion: 9, workspaceKey: 'w1' }
const eid1 = CB.buildEvidenceId(eidIn)
ok(eid1 === CB.buildEvidenceId({ ...eidIn }), 'evidenceId 幂等')
ok(eid1 !== CB.buildEvidenceId({ ...eidIn, kind: 'cite' }), 'kind 变化 → evidenceId 变化')
ok(eid1 !== CB.buildEvidenceId({ ...eidIn, nativeSeq: undefined }), 'nativeSeq 变化 → evidenceId 变化')
ok(eid1.startsWith('ev_'), 'evidenceId 前缀 ev_')

console.log('[A4] coverage adapter(fresh/stale/多记录/range 半开区间)')
const rec1 = mkRec(mem1, { byteStart: 0, byteEnd: 100 })
const rec2 = mkRec(mem2, { byteStart: 120, byteEnd: 220 })
eq(CB.computeRangeCoverage(rec1, { start: 50, end: 150 }).coverage, 0.5, '半开区间重叠 50%')
eq(CB.computeRangeCoverage(rec1, { start: 100, end: 200 }).coverage, 0, '半开区间端点不重叠=0')
eq(CB.computeContainmentCoverage('部署流程使用 pnpm build', ' 12| 部署流程使用 pnpm build').coverage, 1, '行号前缀剥离后包含=1')
eq(CB.computeContainmentCoverage('部署流程使用 pnpm build', '完全无关文本').coverage, 0, '不包含=0')
const covFresh = CB.computeReadCoverage([rec1, rec2], { range: { start: 60, end: 200 }, observedFileDigest: fileDigest })
eq(covFresh.covered.map((c) => c.memoryId), [mem1, mem2], '一次 read 覆盖两条记忆(各自条目)')
eq(covFresh.covered[0].coverage, 0.4, 'rec1 coverage=40/100')
eq(covFresh.covered[1].coverage, 0.8, 'rec2 coverage=80/100')
const covStale = CB.computeReadCoverage([rec1], { range: { start: 0, end: 100 }, observedFileDigest: 'f'.repeat(64) })
eq(covStale.covered.length, 0, 'fileDigest 不匹配 → stale fail closed(不建 coverage)')
eq(covStale.stale[0] && covStale.stale[0].reason, 'stale-source', 'stale 原因记录(stale ≠ coverage=0)')

console.log('[A5] cite/correction 分类器(precision-first fixtures)')
const citeText = '根据 ' + mem1 + ' 的流程执行;另见 ' + mem2
const cites = CB.createCiteEvidencesFromText({ text: citeText, knownRecords: [rec1, rec2], coords })
eq(cites.map((e) => e.kind), ['cite', 'cite'], '两个 memoryId → 两条 cite')
eq(cites.map((e) => e.memoryId), [mem1, mem2], '按 memoryId 排序确定')
eq(new Set(cites.map((e) => e.evidenceId)).size, 2, 'evidenceId 各不相同')
const noProv = CB.createCiteEvidencesFromText({ text: '提到 ' + mem1, knownRecords: [], coords })
eq(noProv.length, 0, '无可靠 provenance 不建 evidence(§3)')
const partial = 'mem_' + 'aa'.repeat(15) + 'z'
eq(CB.createCiteEvidencesFromText({ text: partial, knownRecords: [rec1], coords }).length, 0, '残缺 token 不触发 cite')
const corr = CB.createCorrectionEvidencesFromText({ text: mem1 + ' 这条不对,已经过时了', knownRecords: [rec1], coords })
eq(corr.map((e) => e.kind), ['correction'], 'memoryId+纠正词典 → correction')
ok(corr[0].evidenceId !== cites[0].evidenceId, 'correction 与 cite id 不同(kind 入 identity)')
const corrNoId = CB.createCorrectionEvidencesFromText({ text: '这个不对', knownRecords: [rec1], coords })
eq(corrNoId.length, 0, '只有纠正词无 memoryId → 不建 correction(确定性关联缺失)')
const plain = CB.createCiteEvidencesFromText({ text: '普通句子没有引用', knownRecords: [rec1], coords })
eq(plain.length, 0, '无引用零证据')

console.log('[A6] reuse/success 身份对齐 tracker(precision-first fixtures)')
const tracker = new CB.IdentityEpisodeTracker()
tracker.registerAnchor(cites[0])
const readAnchor = { ...cites[0], kind: 'read', evidenceId: CB.buildEvidenceId({ ...eidIn, kind: 'read' }), event: { ...coords, ts: coords.ts + 1 } }
tracker.registerAnchor(readAnchor)
const aligns = tracker.alignToolCall(coords.sessionId, 'bash', 'run deploy per ' + rec1.recordDigest.slice(0, 16))
eq(aligns.length, 1, 'recordDigest 前 16 位命中 → reuse 对齐')
eq(aligns[0].episodeId, readAnchor.evidenceId, 'episodeId 回链到最新 anchor evidence(最新 provenance 胜出)')
const alignAnchor = tracker.alignToolCall(coords.sessionId, 'bash', 'use anchor ' + rec1.anchorId)
eq(alignAnchor.length, 1, 'anchorId 命中同样对齐')
eq(tracker.alignToolCall('other-session', 'bash', rec1.recordDigest.slice(0, 16)).length, 0, '跨 session 不对齐(隔离)')
eq(tracker.alignToolCall(coords.sessionId, 'bash', 'random args').length, 0, '无身份 token 不对齐')
const succ = CB.createSuccessEvidencePre({
  ...coords, memoryId: mem1, anchorId: rec1.anchorId, scope: rec1.scope,
  sourceRef: rec1.sourceRef, sourceEpoch: rec1.sourceEpoch, sourceVersion: rec1.sourceVersion,
  fileDigest, recordDigest: rec1.recordDigest, episodeId: aligns[0].episodeId,
})
ok(succ.ok && succ.evidence.kind === 'success', 'success 构造(kind=success)')
eq(succ.evidence.episodeId, aligns[0].episodeId, 'success 保留 episodeId')

console.log('[A7] envelope builder(schema/budget/canonical determinism)')
const envInput = {
  session: { sessionId: 's1', agentId: 'a1', workspaceKey: 'd:/ws', scope: 'Workspace' },
  cursor: { eventSeq: 11, nativeSeq: 77, contextVersion: 5 },
  index: { memoryIndexVersion: 'idx_' + 'ab'.repeat(8), sourceEpochs: ['ep-b', 'ep-a'] },
  trigger: seg,
  window: [seg, { ...seg, segmentId: 'seg_2', kind: 'tool_result', toolName: 'read', toolOk: true }],
  memoryRefs: [ref],
  evidence: [agg],
  now: 1700000000000,
}
const built1 = CB.buildContextPushEnvelopePre(envInput)
const built2 = CB.buildContextPushEnvelopePre(envInput)
ok(built1.ok, 'envelope 构造成功')
eq(built1.frame.observationId, built2.frame.observationId, '同输入同 observationId')
eq(built1.frame.policy.contextPolicyVersion, 'context_bridge_v1', 'policy 版本固化')
eq(built1.frame.index.sourceEpochs, ['ep-a', 'ep-b'], 'sourceEpochs 排序规范化')
eq(built1.frame.deadlineAt - built1.frame.observedAt, CB.CONTEXT_BRIDGE_BUDGET_V1.deadlineMs, 'deadline=now+5000ms')
ok(built1.frame.window[1].toolName === 'read' && built1.frame.window[1].toolOk === true, 'window segment 标量投影保留')
const bigWindow = []
for (let i = 0; i < 20; i++) bigWindow.push({ ...seg, segmentId: 'seg_' + i, text: 'x'.repeat(400) })
const overSegs = CB.buildContextPushEnvelopePre({ ...envInput, window: bigWindow })
eq(overSegs.frame.window.length, 8, 'window 超 8 条截断到 maxSegments')
ok(overSegs.dropped.includes('window-truncated'), '截断计账(window-truncated)')
const byteCut = CB.buildContextPushEnvelopePre({ ...envInput, window: [{ ...seg, segmentId: 'w1', text: 'y'.repeat(3000) }, { ...seg, segmentId: 'w2', text: 'z'.repeat(3000) }] })
eq(byteCut.frame.window.length, 1, 'inputBytes 超 4096 → 从最旧 window 逐条丢弃至预算内')
ok(byteCut.inputBytes <= CB.CONTEXT_BRIDGE_BUDGET_V1.maxInputBytes, '截断后 inputBytes 回到预算内')
const trigHuge = CB.buildContextPushEnvelopePre({ ...envInput, trigger: { ...seg, text: 'y'.repeat(6000) } })
ok(!trigHuge.ok && trigHuge.reason === 'trigger-oversize', 'trigger 自身超预算 fail closed(trigger-oversize)')
ok(!CB.buildContextPushEnvelopePre({ ...envInput, session: { ...envInput.session, scope: 'Global' } }).ok, 'scope 非法 fail closed')
ok(!CB.buildContextPushEnvelopePre({ ...envInput, session: { ...envInput.session, workspaceKey: '' } }).ok, '缺 workspaceKey fail closed')
ok(!CB.buildContextPushEnvelopePre({ ...envInput, trigger: { ...seg, kind: 'bogus' } }).ok, 'trigger 非法 fail closed')
ok(!CB.buildContextPushEnvelopePre({ ...envInput, memoryRefs: [{ ...ref, recordDigest: 'bad' }] }).ok, 'ref digest 非法 fail closed')
ok(!CB.buildContextPushEnvelopePre({ ...envInput, evidence: [{ ...agg, policyVersion: 'x' }] }).ok, 'aggregate policy 非法 fail closed')

console.log('[A8] Null/Fake sink + push bridge(幂等/latest-wins/abort)')
const nullSink = CB.createNullContextSinkPre()
const nullAck = await nullSink.push(built1.frame)
eq(nullAck.accepted, false, 'null sink 不接受')
eq(nullAck.reason, 'disabled', 'null ack reason=disabled')
ok(CB.validateContextAckPre(nullAck).ok, 'null ack 合法 schema')
const fakeSink = CB.createFakeContextSinkPre({ capacity: 4 })
const bridge = CB.createContextPushBridge({ sink: fakeSink })
const ack1 = await bridge.push(built1.frame)
eq(ack1.accepted, true, 'fake sink 接受首推')
eq(fakeSink.frames[0].observationId, built1.frame.observationId, 'canonical frame 落账')
eq(fakeSink.frames[0].window[0].text, 'hello', 'frame 含原文(fake 内存态允许;持久化由 M5-2 投影)')
const dup = await bridge.push(built1.frame)
eq(dup.accepted, false, '同 observationId 至多成功发送一次(幂等)')
eq(bridge.stats.duplicates, 1, '重复计账')
const newer = CB.buildContextPushEnvelopePre({ ...envInput, cursor: { ...envInput.cursor, contextVersion: 6 }, now: 1700000000001 })
const pendingResolvers = []
const slowSink = { kind: 'slow', push: (f) => new Promise((res) => { pendingResolvers.push(() => res({ observationId: f.observationId, accepted: true, reason: 'ok' })) }), closeSession: async () => {}, dispose: async () => {} }
const stillInflight = CB.createContextPushBridge({ sink: slowSink })
const pOld = stillInflight.push(built1.frame)
const pNew = stillInflight.push(newer.frame)
eq(stillInflight.stats.superseded, 1, 'latest-wins:旧 frame 仍在途时被新 contextVersion 取消')
for (const r of pendingResolvers) r()
await Promise.all([pOld, pNew])
const abortBridge = CB.createContextPushBridge({ sink: CB.createFakeContextSinkPre(), signal: AbortSignal.abort() })
const abAck = await abortBridge.push(built1.frame)
eq(abAck.reason, 'stale', '外部 signal 已 abort → stale 拒发')
const badSinkBridge = CB.createContextPushBridge({ sink: { kind: 'x', push: async () => { throw new Error('boom') } } })
const errAck = await badSinkBridge.push(built1.frame)
eq(errAck.accepted, false, 'sink 抛错不冒泡')
eq(badSinkBridge.stats.errors, 1, 'sink 错误计账')
await bridge.closeSession('s1')
eq(fakeSink.stats.closedSessions, 1, 'closeSession 透传 sink')
await bridge.dispose('test')
ok(true, 'dispose 完成')

console.log('[A9] replay pure core 确定性')
const events = [
  { type: 'cite', label: 'cite-1', coords, text: citeText, now: 1700000000000 },
  { type: 'envelope', label: 'push-1', input: envInput, now: 1700000000000 },
  { type: 'correction', label: 'corr-1', coords, text: mem1 + ' 不对了', now: 1700000000100 },
  { type: 'align', label: 'align-1', sessionId: coords.sessionId, toolName: 'bash', argPreview: rec1.recordDigest.slice(0, 16) },
]
const runArgs = { events: JSON.parse(JSON.stringify(events)), records: [rec1, rec2], sinkCapacity: 8 }
const run1 = CB.replayContextBridge(runArgs)
const run2 = CB.replayContextBridge(JSON.parse(JSON.stringify(runArgs)))
eq(JSON.stringify(run1.results), JSON.stringify(run2.results), '同事件流回放逐字段一致')
eq(run1.results.find((r) => r.label === 'cite-1').evidence.length, 2, 'replay cite 产出 2 条')
ok(run1.results.find((r) => r.label === 'push-1').observationId.startsWith('obs_'), 'replay envelope id 确定')
eq(run1.results.find((r) => r.label === 'corr-1').evidence.length, 1, 'replay correction 产出 1 条')
eq(run1.sink.frames.length, 1, 'replay fake sink 收到 1 帧')

console.log('[A10] 静态卫生:M5 纯核心无 spawn/HTTP/Python 路径')
const src = readFileSync(new URL('../../lib/context-bridge.js', import.meta.url), 'utf8')
ok(!/child_process|node:net|from\s*'node:http'|spawnSync|execFile|\.python/i.test(src), '无 child_process/net/http/python 引用')
ok(!src.includes('\uFEFF'), '源文件无 BOM 字符')

console.log('')
console.log('M5-1 smoke: ' + pass + ' passed, ' + fail + ' failed')
if (fail > 0) process.exitCode = 1
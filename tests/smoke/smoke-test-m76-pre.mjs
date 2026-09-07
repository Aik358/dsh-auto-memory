// M7-6 Semantic Activation 测试(任务集 §十,worker_semantic_v1):
// 双阈值 suppress/prefetch/emit + T_on>T_off 滞回 + cooldown;shadow 校准默认,
// active 模式发 activation_request 帧——逐字段过现有 M6 validateActivationRequestPre;
// provenance 从 corpus 复制;close_session 清 per-session 状态;未知 miv fail closed。
// hash-pre-v1 确定性 provider,零联网零模型。
import { mkdtempSync, writeFileSync, rmSync, existsSync, readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
process.on('uncaughtException', (e) => { console.error('[M76-TEST] FATAL:', (e && (e.stack || e.message)) || e); process.exit(1) })
process.on('unhandledRejection', (r) => { console.error('[M76-TEST] REJ:', r); process.exit(1) })

let pass = 0; let fail = 0
function ok(cond, name) { if (cond) { pass++; console.log('  ok - ' + name) } else { fail++; console.error('  FAIL - ' + name) } }
function eq(a, b, name) { ok(JSON.stringify(a) === JSON.stringify(b), name) }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const sha256Hex = (s) => createHash('sha256').update(Buffer.from(s)).digest('hex')
const hex32 = (s) => sha256Hex(s).slice(0, 32)

const CLIENT = await import('../../lib/python-sidecar-client.js')
const SYNC = await import('../../lib/index-sync.js')
const INBOX = await import('../../lib/activation-inbox.js')
const HERE = path.dirname(fileURLToPath(import.meta.url))
const SEM_WORKER = path.join(HERE, '..', '..', 'python', 'worker_semantic_v1.py')

function mkEmbConfig(home, activationPolicy) {
  const p = path.join(home, `emb-${Math.random().toString(36).slice(2, 7)}.json`)
  const cfg = { provider: 'hash-pre-v1', dimension: 64 }
  if (activationPolicy) cfg.activationPolicy = activationPolicy
  writeFileSync(p, JSON.stringify(cfg), 'utf8')
  return p
}
function mkClient(home, cfgPath) {
  process.env.DSH_M7_EMBEDDING_CONFIG = cfgPath
  return CLIENT.createPythonSidecarClientPre({
    command: 'python', scriptPath: () => SEM_WORKER, dshHome: home, requestTimeoutMs: 8000,
  })
}
const GOLD_TEXT = '语义激活双阈值测试的黄金记录:workerEpoch 语义激活双阈值测试的黄金记录 breaker 熔断语义激活'
const NEAR_TEXT = '完全无关的午餐备注:拉面店下午两点半关门,团队午餐改到周三十一点四十五分集合出发去街角那家店'
const OFF_TEXT = '量子色动力学非阿贝尔规范场论的格点数值模拟进展综述文献笔记无关文本'
const records = () => {
  const wsr = 'wsr_' + hex32('m76ws')
  const mk = (i, text) => ({
    memoryId: 'mem_' + hex32('m76:m:' + i), anchorId: 'anc_' + hex32('m76' + i).slice(0, 12),
    scope: 'Workspace', workspaceRef: wsr, sourceRef: 'workspace:MEMORY.md',
    sourceEpoch: 'e-m76', sourceVersion: 1,
    fileDigest: sha256Hex('m76f' + i), recordDigest: sha256Hex('m76r' + i),
    heading: null, text, chunkId: 'chk_' + hex32('m76c' + i), chunkOrdinal: 0, chunkCount: 1,
  })
  return [mk(1, GOLD_TEXT), mk(2, NEAR_TEXT)]
}
async function syncCorpus(c, recs, miv) {
  const snapshot = {
    memoryIndexVersion: miv,
    sources: [{ scope: 'Workspace', sourceRef: 'workspace:MEMORY.md', sourceEpoch: 'e-m76', sourceVersion: 1, fileDigest: sha256Hex('m76f') }],
    records: recs,
  }
  const built = SYNC.buildIndexSyncPlansPre({ snapshot, workspaceKey: 'D:/tmp/m76' })
  const plan = built.plans[0]
  const r = []
  r.push(await c.request('index_sync_begin', plan.begin))
  for (const pg of plan.pages) r.push(await c.request('index_sync_page', pg))
  r.push(await c.request('index_sync_commit', plan.commit))
  return r.every((x) => x.ok && x.frame.payload.accepted)
}
function push(obs, miv, text, cv = 1, extra = {}) {
  const evidence = extra.evidence || []
  delete extra.evidence
  const toolFail = extra.toolFail || false
  delete extra.toolFail
  return {
    kind: 'context_push', observationId: obs,
    session: { sessionId: 'sess-76', agentId: 'agent-76', workspaceKey: 'D:/tmp/m76', scope: 'Workspace' },
    cursor: { eventSeq: cv, contextVersion: cv },
    index: { memoryIndexVersion: miv, sourceEpochs: ['e-m76'] },
    trigger: { segmentId: 'sg' + cv, digest: 'd'.repeat(16), kind: 'user', eventSeq: cv, contextVersion: cv, ts: cv, text },
    window: toolFail ? [{ segmentId: 'tf' + cv, digest: 'e'.repeat(16), kind: 'tool_result', eventSeq: cv, contextVersion: cv, ts: cv, text: 'tool failed', toolName: 't', toolOk: false, errorName: 'EPIPE' }] : [],
    memoryRefs: [], evidence,
    policy: { contextPolicyVersion: 'context_bridge_v1', gatePolicyVersion: 'gate_v1', lexicalPolicyVersion: 'lexical_v2', evidencePolicyVersion: 'evidence_v1' },
    budget: { maxSegments: 8, maxInputBytes: 4096, maxMemoryRefs: 8, maxEvidenceItems: 16 },
    observedAt: 1000 + cv, deadlineAt: 6000 + cv, ...extra,
  }
}
const actShadowRows = (home) => readFileSync(path.join(home, 'memory', 'semantic', 'activation-shadow.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l))

console.log('[Q1] shadow 模式默认:低分 suppress/高分 emit 决策落日志但零帧')
{
  const home = mkdtempSync(path.join(tmpdir(), 'm76-q1-'))
  const c = mkClient(home, mkEmbConfig(home)) // 无 activationPolicy → shadow 默认
  const recs = records()
  const miv = 'idx_' + hex32('m76a')
  ok(await syncCorpus(c, recs, miv), 'corpus 同步成功')
  let acts = 0
  c.onActivation(() => { acts++ })
  await c.request('context_push', push('obs_' + hex32('q1a'), miv, OFF_TEXT, 1))
  await c.request('context_push', push('obs_' + hex32('q1b'), miv, GOLD_TEXT, 2))
  await sleep(500)
  const rows = actShadowRows(home)
  eq(rows.map((r) => r.decision), ['suppress', 'emit'], '决策序列 suppress→emit(低分不过 T_off,满分过 T_on)')
  eq(rows[0].mode, 'shadow', '默认 mode=shadow')
  eq(acts, 0, 'shadow 模式零 activation 帧(仅校准日志)')
  ok(rows[1].activationId && rows[1].activationId.startsWith('act_'), 'shadow emit 行带确定性 activationId')
  ok(rows[1].features && typeof rows[1].features.denseTop === 'number' && rows[1].features.denseTop > 0.9, '特征分组落日志(denseTop>0.9)')
  await c.dispose('q1'); rmSync(home, { recursive: true, force: true })
}

console.log('[Q2] active 模式:activation 帧逐字段过 M6 validateActivationRequestPre')
{
  const home = mkdtempSync(path.join(tmpdir(), 'm76-q2-'))
  const c = mkClient(home, mkEmbConfig(home, { mode: 'active', tOn: 0.7, tOff: 0.4, cooldownObs: 2 }))
  const recs = records()
  const miv = 'idx_' + hex32('m76b')
  await syncCorpus(c, recs, miv)
  const got = []
  c.onActivation((evt) => got.push(evt.activation))
  const r = await c.request('context_push', push('obs_' + hex32('q2a'), miv, GOLD_TEXT, 1))
  ok(r.ok && r.frame.payload.accepted === true, 'ack 不受激活影响')
  for (let i = 0; i < 20 && got.length < 1; i++) await sleep(50)
  ok(got.length === 1, '收到 1 个 activation 帧')
  const act = got[0]
  const v = INBOX.validateActivationRequestPre(act)
  ok(v.ok === true, '过 validateActivationRequestPre(' + (v.ok ? '' : v.reason) + ')')
  eq(act.observationId, 'obs_' + hex32('q2a'), 'observationId=envelope 原值')
  eq(act.memoryIndexVersion, miv, 'miv=envelope 原值')
  eq(act.sessionId, 'sess-76', 'sessionId 逐字复制')
  eq(act.threshold.policyVersion, 'm7_semantic_threshold_v1', 'threshold.policyVersion')
  ok(act.threshold.score >= 0.7 && act.threshold.threshold === 0.7, 'score≥T_on 且 threshold=T_on')
  ok(typeof act.level === 'string' && ['index', 'hint', 'excerpt', 'checklist', 'resource', 'full'].includes(act.level), 'level 枚举合法')
  ok(act.candidates.length >= 1 && act.candidates.length <= 8, '候选 1..8')
  const cand = act.candidates[0]
  eq({ memoryId: cand.memoryId, anchorId: cand.anchorId, scope: cand.scope, sourceRef: cand.sourceRef, sourceEpoch: cand.sourceEpoch, sourceVersion: cand.sourceVersion, fileDigest: cand.fileDigest, recordDigest: cand.recordDigest },
     { memoryId: recs[0].memoryId, anchorId: recs[0].anchorId, scope: recs[0].scope, sourceRef: recs[0].sourceRef, sourceEpoch: recs[0].sourceEpoch, sourceVersion: recs[0].sourceVersion, fileDigest: recs[0].fileDigest, recordDigest: recs[0].recordDigest },
     'top1 provenance 七字段逐字复制 corpus')
  ok(typeof cand.score === 'number' && cand.score >= 0 && cand.score <= 1, 'candidate.score∈[0,1]')
  ok(!cand.excerpt || Buffer.byteLength(cand.excerpt, 'utf8') <= 480, 'excerpt≤480B')
  ok(act.ttlSteps >= 2 && act.ttlSteps <= 10, 'ttlSteps 2..10(避开=1 立即过期雷区)')
  ok(act.expiresAt >= act.createdAt, 'expiresAt≥createdAt')
  await c.dispose('q2'); rmSync(home, { recursive: true, force: true })
}

console.log('[Q3] 滞回+cooldown:emit→cooldown→(冷却后)高分再 emit;中分 prefetch;低分回 suppress')
{
  const home = mkdtempSync(path.join(tmpdir(), 'm76-q3-'))
  const c = mkClient(home, mkEmbConfig(home, { mode: 'shadow', tOn: 0.7, tOff: 0.4, cooldownObs: 2 }))
  const recs = records()
  const miv = 'idx_' + hex32('m76c')
  await syncCorpus(c, recs, miv)
  const pushSeq = async (tag, text, cv) => c.request('context_push', push('obs_' + hex32(tag), miv, text, cv))
  await pushSeq('q3a', GOLD_TEXT, 1)      // emit
  await pushSeq('q3b', GOLD_TEXT, 2)      // cooldown
  await pushSeq('q3c', GOLD_TEXT, 3)      // cooldown (obs-last=2<=2)
  await pushSeq('q3d', OFF_TEXT, 4)  // low → below T_off, hysteresis release
  await pushSeq('q3e', GOLD_TEXT, 5)      // past cooldown → emit again
  await sleep(500)
  const rows = actShadowRows(home)
  const dec = rows.map((r) => r.decision)
  eq(dec[0], 'emit', '首观测高分 emit')
  eq(dec[1], 'cooldown', '紧随其后 cooldown')
  eq(dec[2], 'cooldown', '冷却窗口内(2 obs)仍 cooldown')
  ok(['suppress', 'prefetch'].includes(dec[3]), '低分观测回 suppress/prefetch(滞回释放)')
  eq(dec[4], 'emit', '冷却结束后高分再次 emit')
  ok(rows.every((r) => typeof r.features === 'object' && r.features !== null), '每次决策都带特征分组')
  await c.dispose('q3'); rmSync(home, { recursive: true, force: true })
}

console.log('[Q4] close_session 清会话状态;未知 miv fail closed')
{
  const home = mkdtempSync(path.join(tmpdir(), 'm76-q4-'))
  const c = mkClient(home, mkEmbConfig(home, { mode: 'active', tOn: 0.7, tOff: 0.4, cooldownObs: 5 }))
  const recs = records()
  const miv = 'idx_' + hex32('m76d')
  await syncCorpus(c, recs, miv)
  const got = []
  c.onActivation((evt) => got.push(evt.activation))
  await c.request('context_push', push('obs_' + hex32('q4a'), miv, GOLD_TEXT, 1))
  for (let i = 0; i < 20 && got.length < 1; i++) await sleep(50)
  ok(got.length === 1, '首个激活到达')
  await c.request('context_push', push('obs_' + hex32('q4b'), miv, GOLD_TEXT, 2))
  await sleep(300)
  eq(got.length, 1, 'cooldown=5 内第二观测不再发')
  await c.notify('close_session', { sessionId: 'sess-76' })
  await sleep(200)
  await c.request('context_push', push('obs_' + hex32('q4c'), miv, GOLD_TEXT, 3))
  for (let i = 0; i < 20 && got.length < 2; i++) await sleep(50)
  ok(got.length === 2, 'close_session 清状态后同会话重新可 emit')
  await c.request('context_push', push('obs_' + hex32('q4d'), 'idx_' + hex32('ghost'), GOLD_TEXT, 4))
  await sleep(300)
  eq(got.length, 2, '未知 miv → 零候选零激活(fail closed)')
  await c.dispose('q4'); rmSync(home, { recursive: true, force: true })
}

console.log('[Q5] 无 provider/无 corpus:激活路径安全静默')
{
  const home = mkdtempSync(path.join(tmpdir(), 'm76-q5-'))
  const c = mkClient(home, mkEmbConfig(home, { mode: 'active', tOn: 0.1, tOff: 0.05 }))
  const r = await c.request('context_push', push('obs_' + hex32('q5a'), 'idx_' + hex32('m76e'), GOLD_TEXT, 1))
  ok(r.ok && r.frame.payload.accepted === true, '无 corpus ack 正常')
  await sleep(300)
  ok(!existsSync(path.join(home, 'memory', 'semantic', 'activation-shadow.jsonl')), '无候选零激活日志')
  await c.dispose('q5'); rmSync(home, { recursive: true, force: true })
}


console.log('[Q6] 审计 H4:correction 硬抑制 / 负向特征 / toolFailures / occurredAt→recency')
{
  const home = mkdtempSync(path.join(tmpdir(), 'm76-q6-'))
  const c = mkClient(home, mkEmbConfig(home, { mode: 'shadow', tOn: 0.5, tOff: 0.3 }))
  const wsr = 'wsr_' + hex32('m76ws')
  const mk = (i, text, occurredAt) => ({
    memoryId: 'mem_' + hex32('m76:m:' + i), anchorId: 'anc_' + hex32('m76' + i).slice(0, 12),
    scope: 'Workspace', workspaceRef: wsr, sourceRef: 'workspace:MEMORY.md',
    sourceEpoch: 'e-m76', sourceVersion: 1,
    fileDigest: sha256Hex('m76f' + i), recordDigest: sha256Hex('m76r' + i),
    heading: null, text, chunkId: 'chk_' + hex32('m76c' + i), chunkOrdinal: 0, chunkCount: 1,
    ...(occurredAt ? { occurredAt } : {}),
  })
  const gold = mk(1, GOLD_TEXT, Date.now() - 86400000)
  const recs = [gold, mk(2, NEAR_TEXT)]
  const miv = 'idx_' + hex32('m76f')
  ok(await syncCorpus(c, recs, miv), 'corpus 同步')
  const candShadowLast = () => {
    const f = path.join(home, 'memory', 'semantic', 'candidates-shadow.jsonl')
    if (!existsSync(f)) return null
    const lines = readFileSync(f, 'utf8').trim().split('\n')
    return JSON.parse(lines[lines.length - 1])
  }
  // Q6a: correction targets GOLD -> gold hard-dropped; survivor must NOT emit
  await c.request('context_push', push('obs_' + hex32('q6a'), miv, GOLD_TEXT, 1, {
    evidence: [{ memoryId: gold.memoryId, scope: 'Workspace', freshness: 'fresh',
                 distinctSessions: 1, seen: 0, read: 0, cite: 0, reuse: 0,
                 success: 0, correction: 3, lastEvidenceAt: 1,
                 policyVersion: 'evidence_v1' }],
  }))
  await sleep(400)
  let rows = actShadowRows(home)
  ok(rows.length === 1, 'Q6a 恰一条决策行(幸存候选仍校准,实际 ' + rows.length + ')')
  ok(rows[0].decision !== 'emit', `gold 被抑制后决策=${rows[0].decision} ≠ emit(硬抑制生效)`)
  const cs1 = candShadowLast()
  ok(cs1 && cs1.conflictDropped && cs1.conflictDropped.includes(gold.memoryId),
     'candidates-shadow 记录 conflictDropped=[gold]')
  // Q6b: correction targets OTHER memory -> gold survives and emits
  await c.request('context_push', push('obs_' + hex32('q6b'), miv, GOLD_TEXT, 2, {
    evidence: [{ memoryId: recs[1].memoryId, scope: 'Workspace', freshness: 'fresh',
                 distinctSessions: 1, seen: 0, read: 0, cite: 0, reuse: 0,
                 success: 0, correction: 2, lastEvidenceAt: 1,
                 policyVersion: 'evidence_v1' }],
  }))
  await sleep(400)
  rows = actShadowRows(home)
  ok(rows.length === 2 && rows[1].decision === 'emit', 'correction 指向他者时 gold 正常 emit')
  eq(rows[1].features.evidenceCorrection, 2, 'correction 计数入特征(负向项)')
  // occurredAt 契约现状:index_sync 投影硬编码 null(语料无时间概念),
  // 因此 recency 特征处于"已接线、待数据"休眠态 —— 固化该契约事实
  const cs2 = candShadowLast()
  eq(cs2.candidates[0].occurredAt, null, '候选 occurredAt=null(index_sync 契约)')
  eq(rows[1].features.recencyBoost, 0, 'recencyBoost=0(休眠,待语料携带时间)')
  ok(rows[1].score >= 0 && rows[1].score <= 1, '分数有界 [0,1]')
  // Q6c: close_session resets state; tool failure adds explicit positive weight
  await c.notify('close_session', { sessionId: 'sess-76' })
  await sleep(200)
  await c.request('context_push', push('obs_' + hex32('q6c'), miv, GOLD_TEXT, 3, { toolFail: true }))
  await sleep(400)
  rows = actShadowRows(home)
  const f = rows[rows.length - 1].features
  eq(f.toolFailures, 1, 'toolFailures=1 入特征')
  // 从特征重算期望分:验证 toolFail 项(+0.05*min(1,n*0.5))正向进入公式
  const ev = Math.max(-1, Math.min(1, f.evidenceSeen * 0.05 + f.evidenceCite * 0.10 -
                                   f.evidenceCorrection * 0.20))
  const expected = Math.max(0, Math.min(1, 0.6 * f.denseTop +
      0.15 * Math.min(1, f.denseMargin * 4) + 0.1 * ev +
      0.15 * f.recencyBoost + 0.05 * Math.min(1, f.toolFailures * 0.5)))
  ok(Math.abs(rows[rows.length - 1].score - expected) < 1e-5,
     'score=' + rows[rows.length - 1].score + ' == 特征重算 ' + expected.toFixed(6) + '(含 toolFail 正向项)')
  await c.dispose('q6'); rmSync(home, { recursive: true, force: true })
}

console.log(`[M76] pass=${pass} fail=${fail}`)
if (fail > 0) process.exit(1)

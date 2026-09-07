// M7-10 fv2 → wire 发射桥验证(activationEmitMode 门;闭环 docs/M7-CLOSED-LOOP-WIRING.md)
// T0 默认 shadow:fv2 决策照记 shadow 行,但零 activation_request 帧(fail closed)
// T1 canary-explicit:explicit 车道 emit → 恰好一帧,字段符合 ActivationRequestPre+fv2 判定块
//    生活 echo(面条)→ 决策非 emit 且零帧
import { mkdtempSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
const HERE = path.dirname(fileURLToPath(import.meta.url))

const CLIENT = await import('../../lib/python-sidecar-client.js')
const SYNC = await import('../../lib/index-sync.js')
const SEM_WORKER = path.join(HERE, '..', '..', 'python', 'worker_semantic_v1.py')
const PYEXE = path.join(HERE, '..', '..', 'python', 'bench', '.venv', 'Scripts', 'python.exe')
const sha256Hex = (s) => createHash('sha256').update(Buffer.from(s)).digest('hex')
const hex32 = (s) => sha256Hex(s).slice(0, 32)
let pass = 0, fail = 0
const ok = (c, n) => { if (c) { pass++; console.log('  ok - ' + n) } else { fail++; console.error('  FAIL - ' + n) } }
const sleep = (ms) => new Promise(r => setTimeout(r, ms))

function writeEmbConfig(home, flag) {
  const cfg = { provider: 'hash-pre-v1', dimension: 64 }
  if (flag) cfg.activationEmitMode = flag
  const p = path.join(home, 'emb-m710.json')
  writeFileSync(p, JSON.stringify(cfg), 'utf8')
  process.env.DSH_M7_EMBEDDING_CONFIG = p
  return p
}
function mkClient(home) {
  return CLIENT.createPythonSidecarClientPre({
    command: PYEXE,
    scriptPath: () => SEM_WORKER, dshHome: home, requestTimeoutMs: 20000,
  })
}
function mkCorpus() {
  const wsr = 'wsr_' + hex32('m710ws')
  const mk = (i, text) => ({
    memoryId: 'mem_' + hex32('m710:m:' + i), anchorId: 'anc_' + hex32('m710a' + i).slice(0, 12),
    scope: 'Workspace', workspaceRef: wsr, sourceRef: 'workspace:MEMORY.md',
    sourceEpoch: 'e-m710', sourceVersion: 1, fileDigest: sha256Hex('m710f' + i),
    recordDigest: sha256Hex('m710r' + i), heading: null, text,
    chunkId: 'chk_' + hex32('m710c' + i), chunkOrdinal: 0, chunkCount: 1,
  })
  const recAmber = mk(1, '测试条目【琥珀协议】：虚构决策——采用琥珀协议作为模块间通信格式，供跨会话召回复核。')
  const recLunch = mk(2, '- 12:30 生活记录：今天中午吃了面条。')
  return { recs: [recAmber, recLunch], amberId: recAmber.memoryId }
}
async function syncCorpus(c, recs, miv) {
  const snapshot = { memoryIndexVersion: miv, sources: [{ scope: 'Workspace', sourceRef: 'workspace:MEMORY.md', sourceEpoch: 'e-m710', sourceVersion: 1, fileDigest: sha256Hex('m710f') }], records: recs }
  const plan = SYNC.buildIndexSyncPlansPre({ snapshot, workspaceKey: 'D:/tmp/m710' }).plans[0]
  const rs = [await c.request('index_sync_begin', plan.begin)]
  for (const pg of plan.pages) rs.push(await c.request('index_sync_page', pg))
  rs.push(await c.request('index_sync_commit', plan.commit))
  return rs.every(x => x.frame?.payload?.accepted)
}
function pushOf(obs, miv, text, memRefs) {
  return {
    kind: 'context_push', observationId: obs,
    session: { sessionId: 'sess-m710', agentId: 'agent-m710', workspaceKey: 'D:/tmp/m710', scope: 'Workspace' },
    cursor: { eventSeq: 1, contextVersion: 1 },
    index: { memoryIndexVersion: miv, sourceEpochs: ['e-m710'] },
    trigger: { segmentId: 'sg', digest: 'd'.repeat(16), kind: 'user', eventSeq: 1, contextVersion: 1, ts: 1, text },
    window: [], memoryRefs: memRefs || [], evidence: [],
    policy: { contextPolicyVersion: 'context_bridge_v1', gatePolicyVersion: 'gate_v1', lexicalPolicyVersion: 'lexical_v2', evidencePolicyVersion: 'evidence_v1' },
    budget: { maxSegments: 8, maxInputBytes: 4096, maxMemoryRefs: 8, maxEvidenceItems: 16 },
    observedAt: 1000, deadlineAt: 6000,
  }
}
const v2rows = (home) => {
  const p = path.join(home, 'memory', 'semantic', 'activation-shadow-v2.jsonl')
  return existsSync(p) ? readFileSync(p, 'utf8').trim().split('\n').filter(Boolean).map(l => JSON.parse(l)) : []
}

const home = mkdtempSync(path.join(tmpdir(), 'm710-'))
const { recs, amberId } = mkCorpus()
const AMBER_REFS = [{ memoryId: amberId, anchorId: 'anc_x', scope: 'Workspace', sourceRef: 'workspace:MEMORY.md', sourceEpoch: 'e-m710', sourceVersion: 1, fileDigest: sha256Hex('f'), recordDigest: sha256Hex('r') }]
const AMBER_Q = '之前关于采用琥珀协议作为模块间通信格式的决策是什么？请回忆一下具体内容。'
const LUNCH_Q = '今天中午吃的面条挺不错的。'

async function runPhase(tag, flag, queries) {
  writeEmbConfig(home, flag)
  const c = mkClient(home)
  const errTail = []
  try { const ch = c.processForTest(); ch.stderr.on('data', d => errTail.push(d.toString())) } catch {}
  const acts = []
  try { c.onActivation((evt) => { if (evt && evt.activation) acts.push(evt.activation) }) } catch (e) { console.error('onActivation reg threw:', e.message) }
  const miv = 'idx_' + hex32('m710miv-' + tag)
  let synced = false
  try { synced = await syncCorpus(c, recs, miv) } catch (e) { console.error('sync threw:', e.message) }
  if (!synced) console.error('[' + tag + '] corpus sync failed; stderr:', errTail.join('').slice(-600))
  for (let i = 0; i < queries.length; i++) {
    const q = queries[i]
    try { await c.request('context_push', pushOf('obs_' + hex32(tag + ':q' + i), miv, q.text, q.refs)) } catch (e) { console.error('push threw:', e.message) }
    await sleep(1200)
  }
  await sleep(800)
  const expectedObs = queries.map((q, i) => 'obs_' + hex32(tag + ':q' + i))
  const rows = v2rows(home).filter(r => expectedObs.includes(r.observationId))
  try { c.dispose() } catch {}
  await sleep(300)
  return { acts, rows }
}

// ---- T0: 默认 shadow(无开关)→ 零发射帧 ----
console.log('[T0] default shadow -> zero wire frames')
const t0 = await runPhase('t0', null, [{ text: AMBER_Q, refs: AMBER_REFS }, { text: LUNCH_Q }])
ok(t0.acts.length === 0, 'T0 no activation_request frames reached JS (got ' + t0.acts.length + ')')

// ---- T1: canary-explicit → explicit emit 恰好一帧;echo 零帧 ----
console.log('[T1] canary-explicit -> frames iff explicit emit rows')
const t1 = await runPhase('t1', 'canary-explicit', [{ text: AMBER_Q, refs: AMBER_REFS }, { text: LUNCH_Q }])
const emitRows = t1.rows.filter(r => r.decision === 'emit')
ok(emitRows.length >= 1, 'T1 at least one fv2 emit row produced (rows=' + t1.rows.length + ', decisions=' + t1.rows.map(r => r.decision).join(',') + ')')
ok(emitRows.every(r => (r.features || {}).lane === 'explicit'), 'T1 all emit rows are explicit lane')
ok(t1.acts.length === emitRows.length, 'T1 frame count == explicit emit row count (' + t1.acts.length + ' vs ' + emitRows.length + ')')
const echoRow = t1.rows.find(r => r.observationId === 'obs_' + hex32('t1:q1'))
ok(echoRow && echoRow.decision !== 'emit', 'T1 echo decision != emit (' + (echoRow ? echoRow.decision : 'no-row') + ')')
// T0 的 amber 行应已记录 decision=emit(决策照记)但零帧(fail closed)——双保险断言
const t0amberRow = t0.rows.find(r => r.observationId === 'obs_' + hex32('t0:q0'))
ok(t0amberRow && t0amberRow.decision === 'emit' && t0.acts.length === 0, 'T0 shadow row records emit decision yet zero frames leak')
if (t1.acts.length > 0) {
  const a = t1.acts[0]
  ok(a.kind === 'activation_request' && String(a.activationId || '').startsWith('act_'), 'act kind/id shape')
  ok(a.threshold && a.threshold.policyVersion === 'activation_policy_v2', 'threshold.policyVersion = activation_policy_v2')
  ok(a.level === 'excerpt', 'level=excerpt (minimal content tier)')
  ok(Number.isInteger(a.ttlSteps) && a.ttlSteps >= 1 && a.ttlSteps <= 10, 'ttlSteps in [1,10]')
  ok(Array.isArray(a.candidates) && a.candidates.length >= 1 && a.candidates.every(x => /^mem_[0-9a-f]{32}$/.test(x.memoryId) && /^[0-9a-f]{64}$/.test(x.recordDigest)), 'candidates carry provenance identity')
  ok(String((a.threshold || {}).reason || '').startsWith('fv2 lane='), 'reason carries fv2 lane/reasonCodes')
  ok(a.sessionId === 'sess-m710' && a.scope === 'Workspace', 'session identity echoed')
}

console.log(`[M710] pass=${pass} fail=${fail}`)
try { rmSync(home, { recursive: true, force: true }) } catch {}
delete process.env.DSH_M7_EMBEDDING_CONFIG
process.exit(fail > 0 ? 1 : 0)

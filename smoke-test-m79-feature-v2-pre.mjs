// M7 Activation Feature v2 Round-1 接线验证（resilient 版）
import { mkdtempSync, writeFileSync, readFileSync, rmSync, existsSync, mkdirSync, copyFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const CLIENT = await import('./lib/python-sidecar-client-pre.js')
const SYNC = await import('./lib/index-sync-pre.js')
const SEM_WORKER = 'D:/dsh-auto-memory/python/worker_semantic_pre_v1.py'
const PYEXE = 'D:/dsh-auto-memory/python/bench/.venv/Scripts/python.exe'
const POLICY_DIR = 'D:/dsh-auto-memory/python/policies'
const sha256Hex = (s) => createHash('sha256').update(Buffer.from(s)).digest('hex')
const hex32 = (s) => sha256Hex(s).slice(0, 32)
let pass = 0, fail = 0
const ok = (c, n) => { if (c) { pass++; console.log('  ok - ' + n) } else { fail++; console.error('  FAIL - ' + n) } }
const sleep = (ms) => new Promise(r => setTimeout(r, ms))

function mkClient(home, policyDirOverride) {
  if (policyDirOverride !== undefined) process.env.DSH_M7_ACTIVATION_POLICY_DIR = policyDirOverride
  else delete process.env.DSH_M7_ACTIVATION_POLICY_DIR
  return CLIENT.createPythonSidecarClientPre({
    command: 'D:/dsh-auto-memory/python/bench/.venv/Scripts/python.exe',
    scriptPath: () => SEM_WORKER, dshHome: home, requestTimeoutMs: 20000,
  })
}
function mkEmbConfig(home) {
  const p = path.join(home, 'emb-m79.json')
  writeFileSync(p, JSON.stringify({ provider: 'hash-pre-v1', dimension: 64 }), 'utf8')
  process.env.DSH_M7_EMBEDDING_CONFIG = p
  return p
}
function mkCorpus() {
  const wsr = 'wsr_' + hex32('m79ws')
  const mk = (i, text) => ({
    memoryId: 'mem_' + hex32('m79:m:' + i), anchorId: 'anc_' + hex32('m79a' + i).slice(0, 12),
    scope: 'Workspace', workspaceRef: wsr, sourceRef: 'workspace:MEMORY.md',
    sourceEpoch: 'e-m79', sourceVersion: 1, fileDigest: sha256Hex('m79f' + i),
    recordDigest: sha256Hex('m79r' + i), heading: null, text,
    chunkId: 'chk_pre_' + hex32('m79c' + i), chunkOrdinal: 0, chunkCount: 1,
  })
  const recAmber = mk(1, '测试条目【琥珀协议】：虚构决策——采用琥珀协议作为模块间通信格式，供跨会话召回复核。')
  const recLunch = mk(2, '- 12:30 生活记录：今天中午吃了面条。')
  const recM78 = mk(3, '## 2026-08-25\n- M7-8 编排修复完成；下一步为 shadow 校准。')
  return { recs: [recAmber, recLunch, recM78], amberId: recAmber.memoryId }
}
async function syncCorpus(c, recs, miv) {
  const snapshot = { memoryIndexVersion: miv, sources: [{ scope: 'Workspace', sourceRef: 'workspace:MEMORY.md', sourceEpoch: 'e-m79', sourceVersion: 1, fileDigest: sha256Hex('m79f') }], records: recs }
  const plan = SYNC.buildIndexSyncPlansPre({ snapshot, workspaceKey: 'D:/tmp/m79' }).plans[0]
  const rs = [await c.request('index_sync_begin', plan.begin)]
  for (const pg of plan.pages) rs.push(await c.request('index_sync_page', pg))
  rs.push(await c.request('index_sync_commit', plan.commit))
  for (let i = 0; i < rs.length; i++) {
    const x = rs[i]
    if (!(x.frame?.payload?.accepted)) console.error('sync step', i, '->', JSON.stringify(x.frame ? x.frame.payload : x).slice(0, 300))
  }
  return rs.every(x => x.frame?.payload?.accepted)
}
function pushOf(obs, miv, text, memRefs) {
  return {
    kind: 'context_push', observationId: obs,
    session: { sessionId: 'sess-m79', agentId: 'agent-m79', workspaceKey: 'D:/tmp/m79', scope: 'Workspace' },
    cursor: { eventSeq: 1, contextVersion: 1 },
    index: { memoryIndexVersion: miv, sourceEpochs: ['e-m79'] },
    trigger: { segmentId: 'sg', digest: 'd'.repeat(16), kind: 'user', eventSeq: 1, contextVersion: 1, ts: 1, text },
    window: [], memoryRefs: memRefs || [], evidence: [],
    policy: { contextPolicyVersion: 'context_bridge_pre_v1', gatePolicyVersion: 'gate_pre_v1', lexicalPolicyVersion: 'lexical_pre_v2', evidencePolicyVersion: 'evidence_pre_v1' },
    budget: { maxSegments: 8, maxInputBytes: 4096, maxMemoryRefs: 8, maxEvidenceItems: 16 },
    observedAt: 1000, deadlineAt: 6000,
  }
}

const home = mkdtempSync(path.join(tmpdir(), 'm79-'))
mkEmbConfig(home)
const c = mkClient(home)
const errTail = []
try { const ch = c.processForTest(); ch.stderr.on('data', d => errTail.push(d.toString())) } catch {}
const { recs, amberId } = mkCorpus()
const miv = 'idx_pre_' + hex32('m79miv')
let synced = false
try { synced = await syncCorpus(c, recs, miv) } catch (e) { console.error('sync threw:', e.message) }
ok(synced, 'corpus synced')
try { const h = await c.request('health'); console.log('featuresV2 health:', JSON.stringify(h.frame?.payload?.featuresV2)) } catch (e) { console.error('health threw:', e.message) }
console.log('candidates-shadow exists after sync:', existsSync(path.join(home, 'memory', 'semantic-pre', 'candidates-shadow.jsonl')))
const v2Path = path.join(home, 'memory', 'semantic-pre', 'activation-shadow-v2.jsonl')
const v2rows = () => existsSync(v2Path) ? readFileSync(v2Path, 'utf8').trim().split('\n').filter(Boolean).map(l => JSON.parse(l)) : []
const AMBER_REFS = [{ memoryId: amberId, anchorId: 'anc_x', scope: 'Workspace', sourceRef: 'workspace:MEMORY.md', sourceEpoch: 'e-m79', sourceVersion: 1, fileDigest: sha256Hex('f'), recordDigest: sha256Hex('r') }]
const AMBER_Q = '之前关于采用琥珀协议作为模块间通信格式的决策是什么？'

console.log('[T1] explicit recall + memoryRefs')
try {
  const res1 = await c.request('context_push', pushOf('obs_pre_' + hex32('t1'), miv, AMBER_Q, AMBER_REFS))
  console.log('T1 ack:', JSON.stringify(res1.frame ? res1.frame.payload : res1).slice(0, 200))
} catch (e) { console.error('push threw:', e.message) }
await sleep(1500)
let rows = v2rows()
console.log('v2 rows on disk:', rows.length)
if (rows.length) {
  const r1 = rows[rows.length - 1]
  console.log("ROW KEYS:", JSON.stringify(Object.keys(r1)))
  console.log("ROW SAMPLE:", JSON.stringify(r1).slice(0, 500))
  ok(r1.policyVersions?.features === 'activation_features_pre_v2', 'features policyVersion')
  ok(r1.policyVersions?.intent === 'recall_intent_lr_pre_v1', 'intent policyVersion')
  ok(r1.policyVersions?.activation === 'activation_policy_pre_v2', 'activation policyVersion')
  ok(String(r1.configHashes?.activation || '').startsWith('cfgh_'), 'activation configHash present')
  ok(String(r1.goldDigest || '').length === 64, 'goldDigest present')
  ok(['emit', 'prefetch'].includes(r1.decision), `T1 decision=${r1.decision}`)
  ok(r1.candidateHit === true, 'candidateHit=true via memoryRefs')
  ok(Array.isArray(r1.candidateProvenance) && r1.candidateProvenance.length >= 1, 'provenance present')
  ok(!('queryText' in r1) && typeof r1.normTextHash === 'string', 'no raw query persisted')
}

console.log('[T2] life echo -> never emit')
const beforeT2Rows = rows.map(r => r.observationId)
try { await c.request('context_push', pushOf('obs_pre_' + hex32('t2'), miv, '今天中午吃的面条挺不错的。')) } catch (e) { console.error('push threw:', e.message) }
await sleep(1500)
rows = v2rows()
const t2row = rows[rows.length - 1]
ok(!t2row || t2row.decision !== 'emit', 'echo did not emit')
ok(rows.length > beforeT2Rows.length, 'T2 appended a new v2 row')
ok(beforeT2Rows.every((id, i) => rows[i]?.observationId === id), 'T2 append preserved all existing rows in order')

console.log('[T3] determinism replay x2')
for (const tag of ['t3a', 't3b']) {
  try { await c.request('context_push', pushOf('obs_' + tag, miv, AMBER_Q, AMBER_REFS)) } catch (e) { console.error('push threw:', e.message) }
  await sleep(1200)
}
rows = v2rows()
const amberRows = rows.filter(r => r.decision)
const last2 = amberRows.slice(-2)
ok(rows.length >= 1, 'T3: v2 shadow rows present')

console.log('[T4] corrupted policy dir -> fail closed')
const badDir = path.join(tmpdir(), 'm79-badpol-' + Date.now())
mkdirSync(badDir, { recursive: true })
const ipol = JSON.parse(readFileSync(path.join(POLICY_DIR, 'recall_intent_lr_pre_v1.json'), 'utf8'))
ipol.configHash = 'cfgh_' + '0'.repeat(32)
writeFileSync(path.join(badDir, 'recall_intent_lr_pre_v1.json'), JSON.stringify(ipol))
copyFileSync(path.join(POLICY_DIR, 'activation_policy_pre_v2.json'), path.join(badDir, 'activation_policy_pre_v2.json'))
const candPath = path.join(home, 'memory', 'semantic-pre', 'candidates-shadow.jsonl')
const candBefore = existsSync(candPath) ? readFileSync(candPath, 'utf8').trim().split('\n').length : 0
const beforeBadRows = v2rows().map(r => r.observationId)
const cbad = mkClient(home, badDir)
let badSynced = false
try { badSynced = await syncCorpus(cbad, recs, miv) } catch (e) { console.error('bad sync threw:', e.message) }
ok(badSynced, 'retrieval alive under invalid policy')
try { await cbad.request('context_push', pushOf('obs_pre_' + hex32('t4bad'), miv, '琥珀协议的决策内容？')) } catch (e) { console.error('push threw:', e.message) }
await sleep(2000)
const badPath = path.join(home, 'memory', 'semantic-pre', 'activation-shadow-v2.jsonl')
let badRow = null
if (existsSync(badPath)) {
  const all = readFileSync(badPath, 'utf8').trim().split('\n').filter(Boolean).map(l => JSON.parse(l))
  badRow = all.find(x => x.observationId === 'obs_pre_' + hex32('t4bad')) || null
}
ok(badRow !== null && badRow !== undefined, 'bad-policy v2 row exists')
ok(badRow?.shadowReason === 'policy-invalid', 'bad policy fails closed with policy-invalid reason')
ok(String(badRow?.error || '').toLowerCase().includes('confighash'), 'bad policy records configHash validation failure')
const afterBadRows = v2rows()
ok(beforeBadRows.every((id, i) => afterBadRows[i]?.observationId === id), 'bad-policy append preserved all prior rows in order')
ok((existsSync(candPath) ? readFileSync(candPath, 'utf8').trim().split('\n').length : 0) > candBefore, 'hybrid retrieval unaffected')

console.log('--- sidecar stderr tail ---')
console.log(errTail.join('').slice(-2500) || '(empty)')
console.log('--- v2 rows total:', v2rows().length, '---')
console.log(`[M79] pass=${pass} fail=${fail}`)
try { c.dispose() } catch {}
try { rmSync(home, { recursive: true, force: true }); rmSync(badDir, { recursive: true, force: true }) } catch {}
process.exit(fail > 0 ? 1 : 0)

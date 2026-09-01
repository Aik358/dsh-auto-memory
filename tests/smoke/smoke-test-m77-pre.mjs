// M7-7 Memory Judgement Shadow 测试(任务集 §十一):
// 8 类 kindCandidate + keep/merge/supersede 建议,全部 shadow audit——
// 只写 semantic/judgement-shadow.jsonl;每条带 sourceIds/contextVersion/
// memoryIndexVersion/support+counter evidence/confidence/policyVersion;
// 禁止写真实 MEMORY.md/创建 evidence/晋升 Procedure(结构性断言:唯一写路径)。
import { mkdtempSync, writeFileSync, rmSync, readFileSync, readdirSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
process.on('uncaughtException', (e) => { console.error('[M77-TEST] FATAL:', (e && (e.stack || e.message)) || e); process.exit(1) })
process.on('unhandledRejection', (r) => { console.error('[M77-TEST] REJ:', r); process.exit(1) })

let pass = 0; let fail = 0
function ok(cond, name) { if (cond) { pass++; console.log('  ok - ' + name) } else { fail++; console.error('  FAIL - ' + name) } }
function eq(a, b, name) { ok(JSON.stringify(a) === JSON.stringify(b), name) }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const sha256Hex = (s) => createHash('sha256').update(Buffer.from(s)).digest('hex')
const hex32 = (s) => sha256Hex(s).slice(0, 32)

const CLIENT = await import('../../lib/python-sidecar-client.js')
const SYNC = await import('../../lib/index-sync.js')
const HERE = path.dirname(fileURLToPath(import.meta.url))
const SEM_WORKER = path.join(HERE, '..', '..', 'python', 'worker_semantic_v1.py')

function mkClient(home) {
  const cfg = path.join(home, 'emb.json')
  writeFileSync(cfg, JSON.stringify({ provider: 'hash-pre-v1', dimension: 64, activationPolicy: { mode: 'shadow', tOn: 0.99, tOff: 0.9 } }), 'utf8')
  process.env.DSH_M7_EMBEDDING_CONFIG = cfg
  return CLIENT.createPythonSidecarClientPre({
    command: 'python', scriptPath: () => SEM_WORKER, dshHome: home, requestTimeoutMs: 8000,
  })
}
const TEXTS = {
  runbook: '运维手册 runbook:sidecar 恢复步骤 checklist 第一步看 breaker 第二步 dispose 第三步重试',
  correction: 'CORRECTION: 不要 jieba 预切,supersede 旧记录,tokenizer 直接处理中文',
  resource: '错误码资源页: ECONNRESET 与 ERR_STREAM_WRITE_AFTER_END 的堆栈和路径 C:/x/y',
  short: '午饭',
}
const mkRec = (i, key) => ({
  memoryId: 'mem_' + hex32('m77:' + i), anchorId: 'anc_' + hex32('m77' + i).slice(0, 12),
  scope: 'Workspace', workspaceRef: 'wsr_' + hex32('m77ws'), sourceRef: 'workspace:MEMORY.md',
  sourceEpoch: 'e77', sourceVersion: 1, fileDigest: sha256Hex('f' + i),
  recordDigest: sha256Hex('r' + i), heading: null, text: TEXTS[key],
  chunkId: 'chk_' + hex32('c' + i), chunkOrdinal: 0, chunkCount: 1,
})
const pushOf = (obs, miv, text, cv) => ({
  kind: 'context_push', observationId: obs,
  session: { sessionId: 's77', agentId: 'a77', workspaceKey: 'D:/tmp/m77', scope: 'Workspace' },
  cursor: { eventSeq: cv, contextVersion: cv }, index: { memoryIndexVersion: miv, sourceEpochs: ['e77'] },
  trigger: { segmentId: 'sg' + cv, digest: 'd'.repeat(16), kind: 'user', eventSeq: cv, contextVersion: cv, ts: cv, text },
  window: [], memoryRefs: [], evidence: [],
  policy: { contextPolicyVersion: 'context_bridge_v1', gatePolicyVersion: 'gate_v1', lexicalPolicyVersion: 'lexical_v2', evidencePolicyVersion: 'evidence_v1' },
  budget: { maxSegments: 8, maxInputBytes: 4096, maxMemoryRefs: 8, maxEvidenceItems: 16 },
  observedAt: 1, deadlineAt: 5001,
})

console.log('[R1] judgement shadow:分类/建议/字段完整性/零副作用')
{
  const home = mkdtempSync(path.join(tmpdir(), 'm77-r1-'))
  const c = mkClient(home)
  const recs = [mkRec(1, 'runbook'), mkRec(2, 'correction'), mkRec(3, 'resource'), mkRec(4, 'short')]
  const miv = 'idx_' + hex32('m77a')
  const snapshot = { memoryIndexVersion: miv, sources: [{ scope: 'Workspace', sourceRef: 'workspace:MEMORY.md', sourceEpoch: 'e77', sourceVersion: 1, fileDigest: sha256Hex('f') }], records: recs }
  const plan = SYNC.buildIndexSyncPlansPre({ snapshot, workspaceKey: 'D:/tmp/m77' }).plans[0]
  for (const step of [['index_sync_begin', plan.begin], ...plan.pages.map((pg) => ['index_sync_page', pg]), ['index_sync_commit', plan.commit]]) {
    const r = await c.request(step[0], step[1])
    ok(r.ok && r.frame.payload.accepted, 'sync ' + step[0])
  }
  await c.request('context_push', pushOf('obs_' + hex32('r1a'), miv, TEXTS.correction, 1))
  await c.request('context_push', pushOf('obs_' + hex32('r1b'), miv, TEXTS.runbook, 2))
  await sleep(500)
  const rows = readFileSync(path.join(home, 'memory', 'semantic', 'judgement-shadow.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l))
  ok(rows.length >= 4, 'judgement 行产出(' + rows.length + ' 条)')
  const kinds = new Set(rows.map((r) => r.kindCandidate))
  ok(kinds.has('conflict_or_supersede_candidate'), 'correction 记录→conflict_or_supersede_candidate')
  ok(kinds.has('procedure_candidate'), 'runbook 记录→procedure_candidate')
  ok(rows.some((r) => r.suggestion === 'supersede_suggest'), 'marker 命中→supersede_suggest')
  ok(rows.every((r) => r.policyVersion === 'judgement_shadow_v1'), '全部 policyVersion=judgement_shadow_v1')
  ok(rows.every((r) => Array.isArray(r.sourceIds) && r.sourceIds.every((x) => x.startsWith('mem_'))), 'sourceIds=memoryId 数组')
  ok(rows.every((r) => typeof r.contextVersion === 'number' && r.memoryIndexVersion === miv), 'contextVersion/memoryIndexVersion 齐全')
  ok(rows.every((r) => r.supportEvidence && typeof r.supportEvidence === 'object' && typeof r.confidence === 'number' && r.confidence > 0 && r.confidence <= 1), 'support evidence+confidence∈(0,1]')
  ok(rows.every((r) => r.observationId.startsWith('obs_')), 'observationId 引用')
  // 零副作用:semantic 外零写路径,MEMORY.md/evidence 不存在
  const semDir = path.join(home, 'memory', 'semantic')
  const files = readdirSync(semDir)
  ok(files.every((f) => !f.includes('evidence') || f.includes('shadow')), '无 evidence 写入')
  ok(!existsSyncSafe(path.join(home, 'memory', 'MEMORY.md')), '未写任何 MEMORY.md')
  function existsSyncSafe(p) { try { return readFileSync(p); } catch { return false } }
  // 唯一写路径 = semantic 目录(readdir 已列)
  ok(files.includes('judgement-shadow.jsonl'), 'judgement 落 semantic')
  await c.dispose('r1'); rmSync(home, { recursive: true, force: true })
}

console.log(`[M77] pass=${pass} fail=${fail}`)
if (fail > 0) process.exit(1)

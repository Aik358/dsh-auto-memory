// M7-3 Semantic Worker 测试(docs/M7-ALGORITHM-DECISION.md D4):
// worker_semantic_pre_v1.py 复用 worker_pre_v1 协议层——
// 协议零回退(rejection 矩阵复测)/commit 后建 versioned vectors(identity block)/
// context_push 影子候选(本地日志,不发新帧)/miv 隔离/stale 检测与重建/
// 无 embedding 配置时降级为纯协议/semantic worker 抑制 fake activation。
// 全程 hash-pre-v1 确定性 provider(纯标准库)——不下载模型、不联网、不依赖 torch。
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync, readdirSync, readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
process.on('uncaughtException', (e) => { console.error('[M73-TEST] FATAL:', (e && (e.stack || e.message)) || e); process.exit(1) })
process.on('unhandledRejection', (r) => { console.error('[M73-TEST] REJ:', r); process.exit(1) })

let pass = 0; let fail = 0
function ok(cond, name) { if (cond) { pass++; console.log('  ok - ' + name) } else { fail++; console.error('  FAIL - ' + name) } }
function eq(a, b, name) { ok(JSON.stringify(a) === JSON.stringify(b), name) }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const sha256Hex = (s) => createHash('sha256').update(Buffer.from(s)).digest('hex')
const hex32 = (s) => sha256Hex(s).slice(0, 32)

const CLIENT = await import('./lib/python-sidecar-client-pre.js')
const WIRE = await import('./lib/m7-wire-pre.js')
const SYNC = await import('./lib/index-sync-pre.js')
const HERE = path.dirname(fileURLToPath(import.meta.url))
const SEM_WORKER = path.join(HERE, 'python', 'worker_semantic_pre_v1.py')

function mkEmbConfig(home, dim = 64) {
  const p = path.join(home, `emb-${dim}.json`)
  writeFileSync(p, JSON.stringify({ provider: 'hash-pre-v1', dimension: dim }), 'utf8')
  return p
}
function mkClient(home, embConfigPath) {
  if (embConfigPath) process.env.DSH_M7_EMBEDDING_CONFIG = embConfigPath
  else delete process.env.DSH_M7_EMBEDDING_CONFIG
  return CLIENT.createPythonSidecarClientPre({
    command: 'python', scriptPath: () => SEM_WORKER, dshHome: home, requestTimeoutMs: 8000,
  })
}
function mkRecords(tag, n, wsrSeed, opt = {}) {
  const wsr = 'wsr_' + hex32(wsrSeed)
  const out = []
  for (let i = 0; i < n; i++) {
    const long = opt.longIdx === i
    out.push({
      memoryId: 'mem_' + hex32(tag + ':m:' + i), anchorId: 'anc_' + hex32(tag + i).slice(0, 12),
      scope: 'Workspace', workspaceRef: wsr,
      sourceRef: 'workspace:MEMORY.md', sourceEpoch: 'e-' + tag, sourceVersion: 1,
      fileDigest: sha256Hex(tag + 'f' + i), recordDigest: sha256Hex(tag + 'r' + i),
      heading: '标题' + i,
      text: long
        ? Array.from({ length: 60 }, (_, k) => `段落${k}:关于${opt.longTopic || 'workerEpoch 重启语义与 breaker 行为'}的详细记录第${k}行内容,每段大约八十个字符左右的开发备忘内容填充文本${k}`).join('\n')
        : (opt.text || `记录关于 ${opt.topic || 'breaker 三连失败熔断'} 的内容 ` + i),
      chunkId: 'chk_pre_' + hex32(tag + 'c' + i), chunkOrdinal: 0, chunkCount: 1,
    })
  }
  return out
}
function mkPlan(records, miv, workspaceKey) {
  const snapshot = {
    memoryIndexVersion: miv,
    sources: [{ scope: 'Workspace', sourceRef: 'workspace:MEMORY.md', sourceEpoch: 'e-x', sourceVersion: 1, fileDigest: sha256Hex('f') }],
    records,
  }
  const built = SYNC.buildIndexSyncPlansPre({ snapshot, workspaceKey })
  if (!built || !built.ok || !built.plans || !built.plans.length) throw new Error('plan build failed: ' + JSON.stringify(built && built.reason))
  return built.plans[0]
}
async function sendAll(client, plan) {
  const r = []
  r.push(await client.request('index_sync_begin', plan.begin))
  for (const pg of plan.pages) r.push(await client.request('index_sync_page', pg))
  r.push(await client.request('index_sync_commit', plan.commit))
  return r
}
function pushPayload(obs, miv, text, cv = 1, wsKey = 'D:/tmp/wsA') {
  return {
    kind: 'context_push', observationId: obs,
    session: { sessionId: 's1', agentId: 'a1', workspaceKey: wsKey, scope: 'Workspace' },
    cursor: { eventSeq: 1, contextVersion: cv },
    index: { memoryIndexVersion: miv, sourceEpochs: ['e-x'] },
    trigger: { segmentId: 'sg1', digest: 'd'.repeat(16), kind: 'user', eventSeq: 1, contextVersion: cv, ts: 1, text },
    window: [], memoryRefs: [], evidence: [],
    policy: { contextPolicyVersion: 'context_bridge_pre_v1', gatePolicyVersion: 'gate_pre_v1', lexicalPolicyVersion: 'lexical_pre_v2', evidencePolicyVersion: 'evidence_pre_v1' },
    budget: { maxSegments: 8, maxInputBytes: 4096, maxMemoryRefs: 8, maxEvidenceItems: 16 },
    observedAt: 10, deadlineAt: 5010,
  }
}
const semDir = (home) => path.join(home, 'memory', 'semantic-pre')
const shadowRows = (home) => readFileSync(path.join(semDir(home), 'candidates-shadow.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l))

console.log('[N1] semantic worker 启动 + health embedding 视图(协议层零改动)')
{
  const home = mkdtempSync(path.join(tmpdir(), 'm73-n1-'))
  const c = mkClient(home, mkEmbConfig(home))
  const h = await c.health()
  ok(h.ok && h.frame.payload.worker === 'semantic', 'health worker=semantic')
  eq(h.frame.payload.capabilities, ['index-sync-v1', 'embedding-shadow-v1'], 'capabilities 含 embedding-shadow-v1')
  ok(h.frame.payload.embedding.enabled === true && h.frame.payload.embedding.ready === false, '无 corpus 时 enabled/ready=true/false')
  ok(h.frame.payload.embedding.policyVersion === 'm7_chunk_pre_v1', 'chunk policyVersion=m7_chunk_pre_v1')
  ok(h.frame.payload.embedding.configHash.startsWith('cfgh_') && h.frame.payload.embedding.configHash.length === 5 + 64, 'configHash=cfgh_+64hex')
  await c.dispose('n1')
  rmSync(home, { recursive: true, force: true })
}

console.log('[N2] index_sync E2E → versioned vectors + identity block 落盘')
{
  const home = mkdtempSync(path.join(tmpdir(), 'm73-n2-'))
  const c = mkClient(home, mkEmbConfig(home))
  const recs = mkRecords('n2', 3, 'wsA', { longIdx: 1 })
  const planN2 = mkPlan(recs, 'idx_pre_' + hex32('n2miv'), 'D:/tmp/wsA')
  const rs = await sendAll(c, planN2)
  ok(rs.every((r) => r.ok && r.frame.payload.accepted), 'begin/page/commit 全 accepted')
  const vecFiles = readdirSync(semDir(home)).filter((f) => f.startsWith('vectors-') && f.endsWith('.json'))
  ok(vecFiles.length === 1, 'semantic-pre 下恰一个 vectors 文件')
  const v = JSON.parse(readFileSync(path.join(semDir(home), vecFiles[0]), 'utf8'))
  eq(v.identity.chunkPolicyVersion, 'm7_chunk_pre_v1', 'identity.chunkPolicyVersion')
  eq(v.identity.provider, 'hash-pre-v1', 'identity.provider')
  eq(v.identity.normalization, 'l2_normalize', 'identity.normalization')
  eq(v.identity.dimension, 64, 'identity.dimension')
  ok(typeof v.identity.configHash === 'string' && v.identity.configHash.startsWith('cfgh_'), 'identity.configHash')
  eq(v.workspaceRef, planN2.begin.workspaceRef, 'vectors 绑 workspaceRef')
  eq(v.memoryIndexVersion, 'idx_pre_' + hex32('n2miv'), 'vectors 绑 memoryIndexVersion')
  const multi = v.chunks.filter((x) => x.memoryId === recs[1].memoryId)
  ok(multi.length >= 2, `长记录(>2048 字符)多 chunk(hash provider 段落装包,实际 ${multi.length})`)
  ok(multi.every((x) => x.chunkOrdinal < x.chunkCount) && multi[0].chunkCount === multi.length, 'chunkOrdinal/chunkCount 一致')
  ok(multi.every((x) => x.chunkId.startsWith('chk_pre_')) && new Set(multi.map((x) => x.chunkId)).size === multi.length, '多 chunk 各 ordinal chunkId 互异(序数入 hash)')
  const single = v.chunks.find((x) => x.memoryId === recs[0].memoryId)
  ok(single.chunkOrdinal === 0 && single.chunkCount === 1 && single.chunkId.startsWith('chk_pre_'), '单 chunk 记录 chunkOrdinal=0/chunkCount=1')
  ok(v.vectors.length === v.chunks.length && v.vectors[0].length === 64, '向量数=chunk 数,dimension=64')
  ok(v.chunks.every((x) => x.sourceRef && x.fileDigest && x.recordDigest && x.sourceEpoch && x.sourceVersion === 1), '每 chunk 带 provenance 五元组')
  const h = await c.health()
  ok(h.frame.payload.embedding.ready === true && h.frame.payload.embedding.chunks === v.chunks.length, 'health ready=true chunks 数正确')
  await c.dispose('n2'); rmSync(home, { recursive: true, force: true })
}

console.log('[N3] context_push → 影子候选(本地日志,零新帧) + gold top1')
{
  const home = mkdtempSync(path.join(tmpdir(), 'm73-n3-'))
  const c = mkClient(home, mkEmbConfig(home))
  const recs = mkRecords('n3', 4, 'wsA', { topic: 'breaker 三连失败熔断行为' })
  const miv = 'idx_pre_' + hex32('n3miv')
  await sendAll(c, mkPlan(recs, miv, 'D:/tmp/wsA'))
  let activation = null
  c.onActivation((evt) => { activation = evt })
  const push = await c.request('context_push', pushPayload('obs_pre_' + hex32('n3obs'), miv, 'breaker 连续失败三次之后会熔断吗'))
  ok(push.ok && push.frame.payload.accepted === true, 'context_push ack ok(语义 worker 不变 ack 语义)')
  eq(activation, null, 'M7-3 阶段零 activation 帧(fake 路径已抑制)')
  await sleep(400)
  const rows = shadowRows(home)
  ok(rows.length === 1, '影子日志恰一行')
  const row = rows[0]
  eq(row.observationId, 'obs_pre_' + hex32('n3obs'), '影子行绑 observationId')
  eq(row.memoryIndexVersion, miv, '影子行绑 miv')
  eq(row.method, 'hybrid', 'method=hybrid(D6 融合已进生产路径)')
  ok(Array.isArray(row.candidates) && row.candidates.length >= 1 && row.candidates.length <= 8, '候选 1..8')
  ok(row.candidates[0].memoryId.startsWith('mem_') && row.candidates[0].chunkId.startsWith('chk_pre_'), '候选带 chunkId/memoryId')
  ok(typeof row.candidates[0].score === 'number' && row.candidates[0].score > 0.5, 'top1 分数>0.5(hash provider 语义命中)')
  const ids = new Set(row.candidates.map((x) => x.memoryId))
  ok(ids.size === row.candidates.length, '候选按 memoryId 去重聚合(top-chunk 分数)')
  const dupPush = await c.request('context_push', pushPayload('obs_pre_' + hex32('n3obs'), miv, 'breaker 连续失败三次之后会熔断吗'))
  ok(dupPush.ok && dupPush.frame.payload.accepted === false && dupPush.frame.payload.reason === 'busy', '同 obs 幂等 busy(worker_pre_v1 语义保持)')
  await c.dispose('n3'); rmSync(home, { recursive: true, force: true })
}

console.log('[N4] miv 隔离:跨 workspaceRef/版本 不串')
{
  const home = mkdtempSync(path.join(tmpdir(), 'm73-n4-'))
  const c = mkClient(home, mkEmbConfig(home))
  const recsA = mkRecords('n4a', 3, 'wsA', { topic: 'alpha 工作区 breaker 语义' })
  const recsB = mkRecords('n4b', 3, 'wsB', { topic: 'beta 工作区 workerEpoch 语义' })
  const mivA = 'idx_pre_' + hex32('n4mivA')
  const mivB = 'idx_pre_' + hex32('n4mivB')
  const planA = mkPlan(recsA, mivA, 'D:/tmp/wsA')
  await sendAll(c, planA)
  const planB = mkPlan(recsB, mivB, 'D:/tmp/wsB')
  await sendAll(c, planB)
  const h = await c.health()
  eq(h.frame.payload.embedding.entries, 2, '两个 (wsRef,scope) 向量条目')
  await c.request('context_push', pushPayload('obs_pre_' + hex32('n4o1'), mivA, 'alpha 工作区 breaker 语义是什么'))
  await sleep(400)
  let rows = shadowRows(home)
  ok(rows[rows.length - 1].candidates.every((x) => x.workspaceRef === planA.begin.workspaceRef), 'mivA 查询只命中 A 条目')
  ok(rows[rows.length - 1].candidates.some((x) => x.memoryId === recsA[0].memoryId), 'A gold 在候选内')
  await c.request('context_push', pushPayload('obs_pre_' + hex32('n4o2'), mivB, 'beta 工作区 workerEpoch 语义是什么', 1, 'D:/tmp/wsB'))
  await sleep(400)
  rows = shadowRows(home)
  ok(rows[rows.length - 1].candidates.every((x) => x.workspaceRef === planB.begin.workspaceRef), 'mivB 查询只命中 B 条目(零串线)')
  const ghostMiv = 'idx_pre_' + hex32('ghost')
  const rowsBeforeGhost = rows.length
  await c.request('context_push', pushPayload('obs_pre_' + hex32('n4o3'), ghostMiv, '任意内容'))
  await sleep(300)
  rows = shadowRows(home)
  ok(rows.length === rowsBeforeGhost, '未知 miv → 零影子行(fail closed 不跨版本不吐空候选)')
  await c.dispose('n4'); rmSync(home, { recursive: true, force: true })
}

console.log('[N5] stale:identity 不匹配拒用,commit 后重建')
{
  const home = mkdtempSync(path.join(tmpdir(), 'm73-n5-'))
  const recs = mkRecords('n5', 2, 'wsA')
  const miv = 'idx_pre_' + hex32('n5miv')
  { // first run: build with dim 64
    const c = mkClient(home, mkEmbConfig(home, 64))
    await sendAll(c, mkPlan(recs, miv, 'D:/tmp/wsA'))
    const h = await c.health()
    ok(h.frame.payload.embedding.ready === true, '初次构建 ready')
    await c.dispose('n5a')
  }
  { // second run: same corpus already on disk, config now dim 128 -> stale, refuses
    const c = mkClient(home, mkEmbConfig(home, 128))
    const h = await c.health()
    ok(h.frame.payload.embedding.staleEntries >= 1, 'identity 失配 → staleEntries≥1')
    ok(h.frame.payload.embedding.ready === false, 'stale 时 ready=false(拒绝服务)')
    await c.request('context_push', pushPayload('obs_pre_' + hex32('n5o'), miv, 'breaker 语义'))
    await sleep(300)
    ok(!existsSync(path.join(semDir(home), 'candidates-shadow.jsonl')), 'stale 向量不产生影子候选')
    // rebuild: bump record digest -> new miv -> full rebuild
    const recs2 = mkRecords('n5', 2, 'wsA', { topic: 'breaker 语义 v2' })
    const miv2 = 'idx_pre_' + hex32('n5miv2')
    await sendAll(c, mkPlan(recs2, miv2, 'D:/tmp/wsA'))
    const h2 = await c.health()
    ok(h2.frame.payload.embedding.ready === true && h2.frame.payload.embedding.staleEntries === 0, 'commit 后重建 ready 且 stale=0')
    await c.request('context_push', pushPayload('obs_pre_' + hex32('n5o2'), miv2, 'breaker 语义 v2'))
    await sleep(300)
    const rows = shadowRows(home)
    ok(rows.length === 1 && rows[0].memoryIndexVersion === miv2, '重建后按新 miv 出候选')
    await c.dispose('n5b')
  }
  rmSync(home, { recursive: true, force: true })
}

console.log('[N9] 同 miv 跨 workspace:三重过滤显式隔离(审计 P1 泄漏用例)')
{
  const home = mkdtempSync(path.join(tmpdir(), 'm73-n9-'))
  const c = mkClient(home, mkEmbConfig(home))
  const mivSame = 'idx_pre_' + hex32('n9same')
  const recsA = mkRecords('n9a', 3, 'wsA', { topic: '共享快照内容 breaker' })
  const recsB = mkRecords('n9b', 3, 'wsB', { topic: '共享快照内容 breaker' })
  const planA9 = mkPlan(recsA, mivSame, 'D:/tmp/wsA')
  const planB9 = mkPlan(recsB, mivSame, 'D:/tmp/wsB')
  await sendAll(c, planA9)
  await sendAll(c, planB9)
  const h = await c.health()
  eq(h.frame.payload.embedding.entries, 2, '同 miv 两 (wsRef,scope) 条目共存')
  await c.request('context_push', pushPayload('obs_pre_' + hex32('n9o1'), mivSame, '共享快照内容 breaker 是什么', 1, 'D:/tmp/wsA'))
  await sleep(400)
  let rows = shadowRows(home)
  ok(rows[rows.length - 1].candidates.length >= 1, 'wsA 查询有候选')
  ok(rows[rows.length - 1].candidates.every((x) => x.workspaceRef === planA9.begin.workspaceRef),
     '同 miv 下 wsA 查询零 wsB 泄漏(三重过滤生效)')
  await c.request('context_push', pushPayload('obs_pre_' + hex32('n9o2'), mivSame, '共享快照内容 breaker 是什么', 2, 'D:/tmp/wsB'))
  await sleep(400)
  rows = shadowRows(home)
  ok(rows[rows.length - 1].candidates.every((x) => x.workspaceRef === planB9.begin.workspaceRef),
     '同 miv 下 wsB 查询零 wsA 泄漏')
  await c.dispose('n9'); rmSync(home, { recursive: true, force: true })
}

console.log('[N6] 协议零回退:rejection 矩阵在 semantic worker 上保持')
{
  const home = mkdtempSync(path.join(tmpdir(), 'm73-n6-'))
  const c = mkClient(home, mkEmbConfig(home))
  const recs = mkRecords('n6', 2, 'wsA')
  const planN6 = mkPlan(recs, 'idx_pre_' + hex32('n6miv'), 'D:/tmp/wsA')
  await c.request('index_sync_begin', planN6.begin)
  const badPage = JSON.parse(JSON.stringify(planN6.pages[0]))
  badPage.pageDigest = sha256Hex('tampered')
  const r1 = await c.request('index_sync_page', badPage)
  ok(r1.ok === true && r1.frame.payload.accepted === false && r1.frame.payload.reason === 'digest-mismatch', 'pageDigest 篡改 → index_ack accepted=false reason=digest-mismatch')
  const r2 = await c.request('index_sync_commit', planN6.commit)
  ok(r2.ok === false && String(r2.reason).includes('no-active-sync'), '失败后 commit → no-active-sync(整次作废)')
  ok(!existsSync(semDir(home)) || !readdirSync(semDir(home)).some((f) => f.startsWith('vectors-')), '拒绝路径零 vectors 写入')
  const r3 = await c.request('index_sync_page', planN6.pages[0])
  ok(r3.ok === false && String(r3.reason).includes('no-active-sync'), '作废后新 page → no-active-sync')
  await c.dispose('n6'); rmSync(home, { recursive: true, force: true })
}

console.log('[N7] 无 embedding 配置 → 降级纯协议,永不崩')
{
  const home = mkdtempSync(path.join(tmpdir(), 'm73-n7-'))
  const c = mkClient(home, null)
  const h = await c.health()
  ok(h.ok && h.frame.payload.embedding.enabled === false, 'embedding.enabled=false(无 env 配置)')
  const recs = mkRecords('n7', 2, 'wsA')
  const rs = await sendAll(c, mkPlan(recs, 'idx_pre_' + hex32('n7miv'), 'D:/tmp/wsA'))
  ok(rs.every((r) => r.ok && r.frame.payload.accepted), 'index_sync 照常 accepted(corpus 仍持久化)')
  ok(!readdirSync(semDir(home)).some((f) => f.startsWith('vectors-')), '无 provider → 零向量写入')
  const push = await c.request('context_push', pushPayload('obs_pre_' + hex32('n7o'), 'idx_pre_' + hex32('n7miv'), '任意'))
  ok(push.ok && push.frame.payload.accepted === true, 'context_push ack 不受影响')
  await sleep(300)
  ok(!existsSync(path.join(semDir(home), 'candidates-shadow.jsonl')), '无 provider → 零影子日志')
  await c.dispose('n7'); rmSync(home, { recursive: true, force: true })
}

console.log('[N8] 真实 provider 门:bge-m3-pre-v1 配置校验(不加载模型)')
{
  const home = mkdtempSync(path.join(tmpdir(), 'm73-n8-'))
  const cfgPath = path.join(home, 'emb-real.json')
  writeFileSync(cfgPath, JSON.stringify({ provider: 'bge-m3-pre-v1', modelDir: path.join(home, 'no-such-model'), dimension: 1024 }), 'utf8')
  const c = mkClient(home, cfgPath)
  const h = await c.health()
  ok(h.ok && h.frame.payload.embedding.enabled === true && h.frame.payload.embedding.ready === false, '模型缺失 → enabled/ready=true/false')
  ok(typeof h.frame.payload.embedding.error === 'string' && h.frame.payload.embedding.error.length > 0, '错误信息有界呈现(不崩)')
  const recs = mkRecords('n8', 1, 'wsA')
  const rs = await sendAll(c, mkPlan(recs, 'idx_pre_' + hex32('n8miv'), 'D:/tmp/wsA'))
  ok(rs.every((r) => r.ok && r.frame.payload.accepted), '协议在 provider 失败下仍全通(fail open 协议/fail closed 语义)')
  await c.dispose('n8'); rmSync(home, { recursive: true, force: true })
}

console.log(`[M73] pass=${pass} fail=${fail}`)
if (fail > 0) process.exit(1)

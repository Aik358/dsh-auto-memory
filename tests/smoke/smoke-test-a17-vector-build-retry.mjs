#!/usr/bin/env node
/**
 * smoke-test-a17-vector-build-retry.mjs —— #437 守卫套件。
 *
 * 缺陷（改前实测）：accepted 帧在父类 worker_v1.py 的 handle_index_commit 就定稿；
 * 子类 worker_semantic_v1.py 的 build_vectors 失败只写自己的 diag。JS 侧只看 accepted
 * 就写 readyCache ⇒ 同 miv 下永不重建；而 dense_search 因 memoryIndexVersion 不符恒返回 []
 * ⇒ 语义检索静默退化为零候选且永不自愈。
 *
 * 修复（跨语言三处）：
 *   ① python/worker_semantic_v1.py：有向量能力时把每个 key 的构建结果写进 commit ack 的
 *      payload.vectors（{persisted,chunks} 或 {error}）；无向量能力时不带该字段。
 *   ② lib/index-sync.js：把 payload.vectors 原样带出（缺失 ⇒ null）。
 *   ③ lib/m7-index-sync-host.js：vectorsVerdict 判定通过才写 ready 缓存。
 *
 * 本套件两层：
 *   A. 纯函数层（vectorsVerdict / index-sync 透传）：零进程，确定性。
 *   B. 真进程层（python worker，hash-pre-v1 确定性 provider，零模型依赖）：
 *      真发 begin/page/commit，断言 ack 真带 vectors；再用「把 build_vectors 打坏」
 *      的方式验错误如实回传（通过注入坏 embedding 配置诱发 init 失败 ⇒ 无向量能力路径另行覆盖）。
 * 变异：host 回退无条件写 ready ⇒ A 正路径红；删 worker 的 vectors 字段 ⇒ B 正路径红。
 */
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

let pass = 0, fail = 0
const ok = (c, n, x) => { if (c) { pass++; console.log('  ok - ' + n) } else { fail++; console.error('  FAIL - ' + n + (x == null ? '' : ' << ' + x)) } }
const eq = (a, b, n) => ok(JSON.stringify(a) === JSON.stringify(b), n, 'got=' + JSON.stringify(a) + ' want=' + JSON.stringify(b))
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const sha256Hex = (s) => createHash('sha256').update(Buffer.from(s)).digest('hex')
const hex32 = (s) => sha256Hex(s).slice(0, 32)
const HERE = path.dirname(fileURLToPath(import.meta.url))

const SYNC = await import('../../lib/index-sync.js')
const HOST = await import('../../lib/m7-index-sync-host.js')
const CLIENT = await import('../../lib/python-sidecar-client.js')
const EV = await import('../../lib/evidence-store.js')
const SEM_WORKER = path.join(HERE, '..', '..', 'python', 'worker_semantic_v1.py')

function mkRecords(tag, n, wsSeed) {
  const wsr = 'wsr_' + hex32(wsSeed)
  const out = []
  for (let i = 0; i < n; i++) {
    out.push({
      memoryId: 'mem_' + hex32(tag + ':m:' + i), anchorId: 'anc_' + hex32(tag + i).slice(0, 12),
      scope: 'Workspace', workspaceRef: wsr,
      sourceRef: 'workspace:MEMORY.md', sourceEpoch: 'e-' + tag, sourceVersion: 1,
      fileDigest: sha256Hex(tag + 'f' + i), recordDigest: sha256Hex(tag + 'r' + i),
      heading: '标题' + i, text: '记录关于 breaker 三连失败熔断 的内容 ' + i,
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
  if (!built.ok) throw new Error('plan build failed: ' + built.reason)
  return built.plans[0]
}

// ─────────────── A. 纯函数层 ───────────────
console.log('[A17-A1] index-sync 透传 commit ack 的 payload.vectors')
{
  const acksWith = [{ payload: { accepted: true, phase: 'commit' } }, { payload: { accepted: true, phase: 'commit', vectors: { 'wsr_x|Workspace': { persisted: true, chunks: 2 } } } }]
  const fakeClient = (payloadOverride) => ({
    async request(type, payload) {
      if (type === 'index_sync_commit') return { ok: true, frame: { payload: payloadOverride } }
      return { ok: true, frame: { payload: { accepted: true, phase: type.replace('index_sync_', '') } } }
    },
  })
  const plan = mkPlan(mkRecords('a17a', 1, 'wsA'), 'idx_pre_' + hex32('a17amiv'), 'D:/tmp/wsA17')
  const withVectors = await SYNC.sendIndexSyncPlanPre(fakeClient({ accepted: true, vectors: { 'wsr_x|Workspace': { persisted: true, chunks: 2 } } }), plan)
  ok(withVectors.ok === true, 'A17-A1a 计划执行成功')
  eq(withVectors.vectors, { 'wsr_x|Workspace': { persisted: true, chunks: 2 } }, 'A17-A1b ★ vectors 原样带出（不重构、不丢字段）')
  const noVectors = await SYNC.sendIndexSyncPlanPre(fakeClient({ accepted: true }), plan)
  eq(noVectors.vectors, null, 'A17-A1c 旧 worker 无该字段 ⇒ null（不伪造空对象）')
  ok(acksWith.length === 2, 'A17-A1d 对照夹具自检')
}

console.log('[A17-A2] vectorsVerdict 三态（真调 host，经公开 ensureIndexReady 观察）')
{
  const mkEngine = (client) => ({
    config: { associativeMemoryEnabled: true, contextBridgeEnabled: true, pythonBackendEnabled: true, contextSinkMode: 'python' },
    _pythonSidecar: client,
  })
  const mkSnap = (miv) => ({
    memoryIndexVersion: miv,
    sources: [{ scope: 'Workspace', sourceRef: 'workspace:a.md', sourceEpoch: 'ep-1', sourceVersion: 1, fileDigest: 'd'.repeat(64) }],
    records: [{
      memoryId: 'mem_' + 'a'.repeat(32), anchorId: 'anchor_' + 'a'.repeat(24), scope: 'Workspace',
      sourceRef: 'workspace:a.md', sourceEpoch: 'ep-1', sourceVersion: 1, fileDigest: 'd'.repeat(64),
      recordDigest: 'e'.repeat(64), heading: null, text: 'hello world workspace record', bytes: 27,
    }],
  })
  const fakeClient = (commitPayload) => ({
    currentEpoch: () => 'ep-1',
    async request(type) {
      if (type === 'index_sync_commit') return { ok: true, frame: { payload: commitPayload } }
      return { ok: true, frame: { payload: { accepted: true } } }
    },
  })
  const run = async (commitPayload) => {
    const host = HOST.createIndexSyncHostPre({ engine: mkEngine(fakeClient(commitPayload)), now: () => 1000 })
    const r = await host.ensureIndexReady(mkSnap('idx_pre_' + '1'.repeat(32)), { workspaceKey: 'D:\\proj' }, 'Workspace')
    return { r, host }
  }
  // ① 无 vectors 字段 ⇒ 向量不适用 ⇒ 兼容放行（这是纯协议路径，m71/m73/m78 依赖）
  {
    const { r, host } = await run({ accepted: true })
    ok(r.ready === true, 'A17-A2a ★ 无 vectors 字段 ⇒ ready（向量不适用，不误判失败）', JSON.stringify(r))
    eq(host._stats.vectorsNotApplicable, 1, 'A17-A2b 不适用**留痕**（stats.vectorsNotApplicable=1，不静默）')
    eq(host._stats.vectorsNotReady, 0, 'A17-A2c 不适用不计入 vectorsNotReady')
  }
  // ② vectors 带 error ⇒ 不就绪（fail closed）+ 不写 ready 缓存
  {
    const { r, host } = await run({ accepted: true, vectors: { 'wsr_x|Workspace': { error: 'encode-failed:boom' } } })
    eq(r.ready, false, 'A17-A2d ★★ 有 error ⇒ ready=false（改前 ready=true）')
    eq(r.reason, 'vectors-not-ready', 'A17-A2e reason=vectors-not-ready')
    eq(host._readyCacheForTest.size, 0, 'A17-A2f ★ 失败不写 ready 缓存（⇒ 下次天然重跑，已是有界）')
    ok(host._stats.vectorsNotReady >= 1, 'A17-A2g stats.vectorsNotReady 计数')
    ok(host.debugView().recentDrops.some((d) => String(d.reason).startsWith('vectors:')), 'A17-A2h recentDrops 留痕（可观测，不静默）')
    eq(r.vectors && r.vectors.failed && r.vectors.failed[0].error, 'encode-failed:boom', 'A17-A2i 错误详情如实透出')
  }
  // ③ vectors 全部成功 ⇒ ready 且写缓存
  {
    const { r, host } = await run({ accepted: true, vectors: { 'wsr_x|Workspace': { persisted: true, chunks: 3 } } })
    ok(r.ready === true, 'A17-A2j ★ 无 error ⇒ ready=true')
    eq(host._readyCacheForTest.size, 1, 'A17-A2k 成功才写 ready 缓存')
    eq(host._stats.vectorsNotReady, 0, 'A17-A2l 成功不计失败')
  }
  // ④ 空 vectors（{}）⇒ 「本轮无需重建」⇒ 就绪
  {
    const { r } = await run({ accepted: true, vectors: {} })
    ok(r.ready === true, 'A17-A2m 空 vectors={} ⇒ 就绪（无需重建≠失败）')
  }
  // ⑤ persist 失败但无 error 字段 ⇒ 仍就绪（内存态可服务；落盘失败由 worker 自己回报）
  {
    const { r } = await run({ accepted: true, vectors: { 'k': { persisted: false, chunks: 1 } } })
    ok(r.ready === true, 'A17-A2n persisted=false 不单独作为门槛（内存态已建立）')
  }
}

console.log('[A17-A3] ★ 失败后同 miv 第二次调用必须**真重发**（改前 readyHits 命中缓存永不重跑）')
{
  const mkEngine = (client) => ({
    config: { associativeMemoryEnabled: true, contextBridgeEnabled: true, pythonBackendEnabled: true, contextSinkMode: 'python' },
    _pythonSidecar: client,
  })
  const calls = { begin: 0, page: 0, commit: 0 }
  let vectors = { 'wsr_x|Workspace': { error: 'first-attempt-failed' } }
  const client = {
    currentEpoch: () => 'ep-1',
    async request(type) {
      if (type === 'index_sync_begin') calls.begin++
      else if (type === 'index_sync_page') calls.page++
      else if (type === 'index_sync_commit') { calls.commit++; return { ok: true, frame: { payload: { accepted: true, vectors } } } }
      return { ok: true, frame: { payload: { accepted: true } } }
    },
  }
  const host = HOST.createIndexSyncHostPre({ engine: mkEngine(client), now: () => 1000 })
  const snap = {
    memoryIndexVersion: 'idx_pre_' + '2'.repeat(32),
    sources: [{ scope: 'Workspace', sourceRef: 'workspace:a.md', sourceEpoch: 'ep-1', sourceVersion: 1, fileDigest: 'd'.repeat(64) }],
    records: [{
      memoryId: 'mem_' + 'b'.repeat(32), anchorId: 'anchor_' + 'b'.repeat(24), scope: 'Workspace',
      sourceRef: 'workspace:a.md', sourceEpoch: 'ep-1', sourceVersion: 1, fileDigest: 'd'.repeat(64),
      recordDigest: 'f'.repeat(64), heading: null, text: 'retry me', bytes: 8,
    }],
  }
  const paths = { workspaceKey: 'D:\\projRetry' }
  const r1 = await host.ensureIndexReady(snap, paths, 'Workspace')
  eq(r1.ready, false, 'A17-A3a 第 1 次：vectors 带 error ⇒ 不就绪')
  const commitsAfter1 = calls.commit
  const readyHitsAfter1 = host._stats.readyHits
  // 第 2 次：同 miv / 同 epoch，但这次 vectors 成功
  vectors = { 'wsr_x|Workspace': { persisted: true, chunks: 1 } }
  const r2 = await host.ensureIndexReady(snap, paths, 'Workspace')
  ok(r2.ready === true, 'A17-A3b 第 2 次成功')
  ok(calls.commit > commitsAfter1, 'A17-A3c ★★ 真正重发了 index_sync（commit 次数 ' + commitsAfter1 + ' → ' + calls.commit + '）')
  eq(host._stats.readyHits, readyHitsAfter1, 'A17-A3d ★ 没有走 readyHits 命中缓存（改前此处必然命中 ⇒ 永不重试）')
  const r3 = await host.ensureIndexReady(snap, paths, 'Workspace')
  ok(r3.ready === true && host._stats.readyHits > readyHitsAfter1, 'A17-A3e 成功后才有缓存命中（幂等仍然成立）')
}

console.log('[A17-A4] corpus 拒收（accepted=false）仍走原 reason 路径，不与 vectors 混为一谈')
{
  const mkEngine = (client) => ({
    config: { associativeMemoryEnabled: true, contextBridgeEnabled: true, pythonBackendEnabled: true, contextSinkMode: 'python' },
    _pythonSidecar: client,
  })
  const client = {
    currentEpoch: () => 'ep-1',
    async request(type) {
      if (type === 'index_sync_page') return { ok: true, frame: { payload: { accepted: false, reason: 'digest-mismatch' } } }
      return { ok: true, frame: { payload: { accepted: true } } }
    },
  }
  const host = HOST.createIndexSyncHostPre({ engine: mkEngine(client), now: () => 1000 })
  const snap = {
    memoryIndexVersion: 'idx_pre_' + '3'.repeat(32),
    sources: [{ scope: 'Workspace', sourceRef: 'workspace:a.md', sourceEpoch: 'ep-1', sourceVersion: 1, fileDigest: 'd'.repeat(64) }],
    records: [{ memoryId: 'mem_' + 'c'.repeat(32), anchorId: 'a', scope: 'Workspace', sourceRef: 'workspace:a.md', sourceEpoch: 'ep-1', sourceVersion: 1, fileDigest: 'd'.repeat(64), recordDigest: 'a9'.repeat(32), heading: null, text: 'x', bytes: 1 }],
  }
  const r = await host.ensureIndexReady(snap, { workspaceKey: 'D:\\projRej' }, 'Workspace')
  eq(r.ready, false, 'A17-A4a 拒收 ⇒ 不就绪')
  eq(r.reason, 'digest-mismatch', 'A17-A4b ★ 仍走原 reason（不是 vectors-not-ready）')
  eq(host._stats.vectorsNotReady, 0, 'A17-A4c 不误计 vectorsNotReady')
}

// ─────────────── B. 真进程层（hash-pre-v1，零模型依赖） ───────────────
console.log('[A17-B1] 真 python worker：commit ack 必须带 vectors 且逐 key 报构建结果')
{
  const home = mkdtempSync(path.join(tmpdir(), 'dam-a17-'))
  try {
    const cfgPath = path.join(home, 'emb.json')
    writeFileSync(cfgPath, JSON.stringify({ provider: 'hash-pre-v1', dimension: 64 }), 'utf8')
    process.env.DSH_M7_EMBEDDING_CONFIG = cfgPath
    const client = CLIENT.createPythonSidecarClientPre({ command: 'python', scriptPath: () => SEM_WORKER, dshHome: home, requestTimeoutMs: 12000 })
    try {
      const recs = mkRecords('a17b', 3, 'wsB17')
      const plan = mkPlan(recs, 'idx_pre_' + hex32('a17bmiv'), 'D:/tmp/wsB17')
      const res = await SYNC.sendIndexSyncPlanPre(client, plan, { timeoutMs: 20000 })
      ok(res.ok === true, 'A17-B1a 真进程 index_sync 全流程成功')
      ok(res.vectors && typeof res.vectors === 'object', 'A17-B1b ★★ commit ack 带 vectors 字段（改前完全缺失）')
      const keys = Object.keys(res.vectors || {})
      ok(keys.length >= 1, 'A17-B1c vectors 至少一条（实际 ' + keys.length + '）')
      ok(keys.some((k) => k.endsWith('|Workspace')), 'A17-B1d key 形如 <wsRef>|<scope>（' + keys.join(',') + '）')
      const entry = res.vectors[keys.find((k) => k.endsWith('|Workspace'))]
      ok(entry && typeof entry.persisted === 'boolean', 'A17-B1e 成功条目带 persisted（' + JSON.stringify(entry) + '）')
      ok(!!entry && Number.isInteger(entry.chunks) && entry.chunks >= 1, 'A17-B1f 成功条目带 chunks=' + (entry && entry.chunks))
      ok(!!entry && !entry.error, 'A17-B1g 成功条目无 error')
      // 落盘自证（persisted=true 不是空话）
      const fsMod = await import('node:fs')
      const semDir = path.join(home, 'memory', 'semantic')
      ok(fsMod.existsSync(semDir) && fsMod.readdirSync(semDir).some((f) => f.startsWith('vectors-')), 'A17-B1h persisted=true 有真实落盘自证（vectors-*.json 存在）')
    } finally {
      try { await client.dispose('a17b') } catch (_) {}
      delete process.env.DSH_M7_EMBEDDING_CONFIG
    }
  } finally { try { rmSync(home, { recursive: true, force: true }) } catch (_) {} }
}


console.log('[A17-B2] 真 python worker：无向量能力时不带 vectors 字段（不适用 ≠ 失败）')
{
  const home2 = mkdtempSync(path.join(tmpdir(), 'dam-a17b2-'))
  try {
    const modelDir = path.join(home2, 'no-model'); mkdirSync(modelDir, { recursive: true })
    const cfgPath = path.join(home2, 'emb-bad.json')
    // provider=bge-m3-pre-v1 且模型缺失 ⇒ worker 侧 embedder 初始化失败（embedder=None）
    writeFileSync(cfgPath, JSON.stringify({ provider: 'bge-m3-pre-v1', modelDir, dimension: 1024 }), 'utf8')
    process.env.DSH_M7_EMBEDDING_CONFIG = cfgPath
    const client2 = CLIENT.createPythonSidecarClientPre({ command: 'python', scriptPath: () => SEM_WORKER, dshHome: home2, requestTimeoutMs: 15000 })
    try {
      const recs2 = mkRecords('a17b2', 2, 'wsB2')
      const plan2 = mkPlan(recs2, 'idx_pre_' + hex32('a17b2miv'), 'D:/tmp/wsB2')
      const res2 = await SYNC.sendIndexSyncPlanPre(client2, plan2, { timeoutMs: 25000 })
      ok(res2.ok === true, 'A17-B2a 无向量能力时协议仍全通（accepted）')
      eq(res2.vectors, null, 'A17-B2b ★ 无 embedder ⇒ ack 不带 vectors（不适用 ≠ 失败，不误杀纯协议路径）')
    } finally {
      try { await client2.dispose('a17b2') } catch (_) {}
      delete process.env.DSH_M7_EMBEDDING_CONFIG
    }
  } finally { try { rmSync(home2, { recursive: true, force: true }) } catch (_) {} }
}

console.log('\n[A17] ' + pass + ' passed, ' + fail + ' failed')
process.exit(fail ? 1 : 0)

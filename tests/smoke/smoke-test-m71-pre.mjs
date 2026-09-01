// M7-1 Authorized index_sync 测试(docs/PYTHON-SIDECAR-CONTRACT.md §8.4,§16):
// 记录投影/chunk 派生身份/分页预算(64 条·256KiB)/happy path E2E+原子落盘+可重建确定性/
// 缺页·重复·乱序·pageDigest 不符·finalDigest 不符·版本/scope 中途不一致全拒绝/
// 旧 memoryIndexVersion 整体替换不混用/四种身份格式分离/M5-M6 兼容复assert/回退不受破坏。
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync, readdirSync, readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { tmpdir } from 'node:os'
import path from 'node:path'
process.on('uncaughtException', (e) => { console.error('[M71-TEST] FATAL:', (e && (e.stack || e.message)) || e); process.exit(1) })
process.on('unhandledRejection', (r) => { console.error('[M71-TEST] REJ:', r); process.exit(1) })

let pass = 0; let fail = 0
function ok(cond, name) { if (cond) { pass++; console.log('  ok - ' + name) } else { fail++; console.error('  FAIL - ' + name) } }
function eq(a, b, name) { ok(JSON.stringify(a) === JSON.stringify(b), name) }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const sha256Hex = (buf) => createHash('sha256').update(buf).digest('hex')
const hex32 = (s) => sha256Hex(Buffer.from(s)).slice(0, 32)

const WIRE = await import('../../lib/m7-wire.js')
const CLIENT = await import('../../lib/python-sidecar-client.js')
const SYNC = await import('../../lib/index-sync.js')
const BRIDGE = await import('../../lib/context-bridge.js')
const ACT = await import('../../lib/activation-inbox.js')
const WORKER_PATH = CLIENT.defaultWorkerScriptPathPre()

function mkSnapshot(nWs, nUser, tag, opt = {}) {
  const epochWs = 'ws-epoch-' + tag, epochUser = 'user-epoch-' + tag
  const rec = (scope, i) => ({
    memoryId: 'mem_' + hex32(tag + ':' + scope + ':' + i), anchorId: 'anc_' + hex32(tag + scope + i).slice(0, 12),
    scope, sourceClass: scope === 'User' ? 'user-memory' : 'workspace-notes',
    sourceRef: scope === 'User' ? 'user:MEMORY.md' : 'workspace:MEMORY.md',
    sourceEpoch: scope === 'User' ? epochUser : epochWs, sourceVersion: 1,
    fileDigest: sha256Hex(Buffer.from(tag + 'file' + scope)), recordDigest: sha256Hex(Buffer.from(tag + 'rec' + scope + i)),
    lineStart: i * 2 + 1, lineEnd: i * 2 + 2, byteStart: i * 40, byteEnd: i * 40 + 38,
    heading: '标题' + i, text: (opt.text || '记录内容关于部署与验证流程 ') + i, bytes: 38,
  })
  const records = []
  for (let i = 0; i < nWs; i++) records.push(rec('Workspace', i))
  for (let i = 0; i < nUser; i++) records.push(rec('User', i))
  return {
    memoryIndexVersion: opt.miv || ('idx_' + hex32('miv-' + tag)),
    sources: [
      { scope: 'Workspace', sourceRef: 'workspace:MEMORY.md', sourceEpoch: epochWs, sourceVersion: 1, fileDigest: sha256Hex(Buffer.from(tag + 'fileWorkspace')) },
      { scope: 'User', sourceRef: 'user:MEMORY.md', sourceEpoch: epochUser, sourceVersion: 1, fileDigest: sha256Hex(Buffer.from(tag + 'fileUser')) },
    ],
    records,
  }
}
function mkClient(home) {
  return CLIENT.createPythonSidecarClientPre({ command: 'python', scriptPath: () => WORKER_PATH, dshHome: home || '', requestTimeoutMs: 2500 })
}
const derivedPath = (home) => path.join(home, 'memory', 'semantic', 'derived-corpus.json')
async function sendAll(client, plans) {
  const results = []
  for (const p of plans) results.push(await SYNC.sendIndexSyncPlanPre(client, p))
  return results
}

console.log('[H1] 记录投影 + chunk 派生身份 + syncId 确定性')
{
  const snap = mkSnapshot(2, 1, 'h1')
  const built = SYNC.buildIndexSyncPlansPre({ snapshot: snap, workspaceKey: 'D:/tmp/wsH1' })
  ok(built.ok, 'H1 构建成功' + (built.ok ? '' : ':' + built.reason))
  eq(built.plans.map((p) => p.scope), ['Workspace', 'User'], 'H1 按 scope 分组且顺序固定(Workspace→User)')
  const wPlan = built.plans[0]
  const r0 = wPlan.pages[0].records[0]
  ok(WIRE.validateSemanticRecordPre(r0).ok, 'H1 投影记录通过 SemanticRecordPre 校验')
  for (const k of ['memoryId', 'anchorId', 'scope', 'workspaceRef', 'sourceRef', 'sourceEpoch', 'sourceVersion', 'fileDigest', 'recordDigest', 'heading', 'text', 'occurredAt', 'chunkId', 'chunkOrdinal', 'chunkCount']) {
    ok(Object.prototype.hasOwnProperty.call(r0, k), 'H1 记录含必填字段 ' + k)
  }
  ok(r0.workspaceRef.startsWith('wsr_') && r0.workspaceRef.length === 36, 'H1 workspaceRef 为隐私投影 wsr_*')
  ok(r0.chunkCount === 1 && r0.chunkOrdinal === 0 && r0.chunkId.startsWith('chk_'), 'H1 占位 chunking=整记录单 chunk(chk_*)')
  const srcRec = snap.records.find((x) => x.memoryId === r0.memoryId)
  ok(r0.recordDigest === srcRec.recordDigest && r0.text === srcRec.text && r0.sourceVersion === srcRec.sourceVersion, 'H1 provenance/text 逐字段来自授权语料快照')
  const another = wPlan.pages[0].records[1]
  ok(another.chunkId !== r0.chunkId, 'H1 不同记录 chunkId 不同')
  eq(SYNC.buildIndexSyncPlansPre({ snapshot: snap, workspaceKey: 'D:/tmp/wsH1' }).plans[0].begin.syncId, wPlan.begin.syncId, 'H1 syncId 同输入确定')
  ok(wPlan.begin.syncId !== built.plans[1].begin.syncId, 'H1 不同 scope 不同 syncId')
  eq(wPlan.begin.indexPolicyVersion, WIRE.M7_INDEX_POLICY_VERSION_V1, 'H1 begin 携带 index_sync_v1 策略版本')
}

console.log('[H2] 分页预算:64 条边界 + 256KiB 上限 + 单条超限 fail closed')
{
  const b64 = SYNC.buildIndexSyncPlansPre({ snapshot: mkSnapshot(64, 0, 'b64'), workspaceKey: 'D:/tmp/wsB' })
  eq(b64.plans[0].pages.length, 1, 'H2 恰 64 条 → 单页')
  const b65 = SYNC.buildIndexSyncPlansPre({ snapshot: mkSnapshot(65, 0, 'b65'), workspaceKey: 'D:/tmp/wsB' })
  eq(b65.plans[0].pages.length, 2, 'H2 65 条 → 两页(计数边界)')
  const big = SYNC.buildIndexSyncPlansPre({ snapshot: mkSnapshot(1, 0, 'big', { text: 'x'.repeat(300 * 1024) }), workspaceKey: 'D:/tmp/wsB' })
  ok(!big.ok && big.reason.startsWith('record-oversize'), 'H2 单条超 256KiB → record-oversize fail closed')
  const many = SYNC.buildIndexSyncPlansPre({ snapshot: mkSnapshot(200, 2, 'many'), workspaceKey: 'D:/tmp/wsB' })
  ok(many.ok, 'H2 大快照构建成功')
  const BUDGET = SYNC.INDEX_SYNC_PAGE_BUDGET_V1
  let totalRecords = 0
  for (const p of many.plans) {
    for (const pg of p.pages) {
      const bytes = Buffer.byteLength(JSON.stringify(pg), 'utf8')
      totalRecords += pg.records.length
      ok(pg.records.length <= BUDGET.maxRecordsPerPage, 'H2 每页 ≤64 条')
      ok(bytes <= BUDGET.maxPageBytes, 'H2 每页 ≤256KiB(JSON 字节)')
    }
    ok(p.pages.every((pg, i) => pg.pageNo === i), 'H2 pageNo 连续有序(' + p.scope + ')')
  }
  eq(totalRecords, 202, 'H2 分页无丢失无重复(202 条全覆盖)')
}


// ---------- H3 ----------
console.log('[H3] happy path E2E:begin→pages→commit + 原子落盘 + 可重建确定性')
const H3 = {}
{
  const home = mkdtempSync(path.join(tmpdir(), 'dam-m71-home-'))
  const c = mkClient(home)
  H3.home = home; H3.client = c
  const snap = mkSnapshot(70, 3, 'e2e')
  const built = SYNC.buildIndexSyncPlansPre({ snapshot: snap, workspaceKey: 'D:/tmp/wsE2E' })
  ok(built.ok, 'H3 计划构建成功')
  eq(built.plans[0].pages.length, 2, 'H3 70 条 Workspace → 两页(64+6)')
  eq(built.plans[0].begin.recordCount, 70, 'H3 begin.recordCount=70')
  eq(built.plans[1].begin.recordCount, 3, 'H3 User 分区 recordCount=3')
  const results = await sendAll(c, built.plans)
  ok(results.every((r) => r.ok), 'H3 全部 sync(begin/page/commit)接受')
  for (let i = 0; i < results.length; i++) {
    const commitAck = results[i].acks[results[i].acks.length - 1]
    ok(commitAck.payload && commitAck.payload.accepted === true && commitAck.payload.phase === 'commit', 'H3 [' + built.plans[i].scope + '] commit ack 接受')
    eq(commitAck.payload.persisted, true, 'H3 [' + built.plans[i].scope + '] 派生态已原子落盘(persisted=true)')
  }
  const dirP = path.join(home, 'memory', 'semantic')
  ok(existsSync(derivedPath(home)), 'H3 derived-corpus.json 存在且仅在 semantic 下')
  eq(readdirSync(dirP).sort(), ['derived-corpus.json'], 'H3 目录无临时残留(原子替换无 *.tmp)')
  const parsed = JSON.parse(readFileSync(derivedPath(home), 'utf8'))
  eq(parsed.entries.length, 2, 'H3 两个 scope 分区条目')
  const wsEntry = parsed.entries.find((e) => e.scope === 'Workspace')
  eq(wsEntry.recordCount, 70, 'H3 Workspace 条目 70 条')
  eq(wsEntry.memoryIndexVersion, snap.memoryIndexVersion, 'H3 绑定当前 memoryIndexVersion')
  eq(wsEntry.records.length, 70, 'H3 完整授权 records 已达 Python(可重建语料)')
  ok(typeof wsEntry.finalDigest === 'string' && wsEntry.finalDigest.length === 64, 'H3 finalDigest 落盘')
  // rebuild determinism:全新进程重放同一快照 → 落盘字节逐字节一致
  const bytesBefore = readFileSync(derivedPath(home))
  const c2 = mkClient(home)
  await sendAll(c2, built.plans)
  const bytesAfter = readFileSync(derivedPath(home))
  eq(bytesAfter.toString('hex'), bytesBefore.toString('hex'), 'H3 重放后落盘字节逐字节相同(完全可重建·确定性)')
  await c2.dispose('test')
}

// ---------- H4 ----------
console.log('[H4] 失败语义:缺页/重复/乱序/digest/版本/scope 全拒绝且派生态零变化')
{
  const c = H3.client
  const baseline = readFileSync(derivedPath(H3.home)).toString('hex')
  async function runBroken(mutate, expectReason, label) {
    const snap = mkSnapshot(5, 0, 'brk-' + label)
    const plan = SYNC.buildIndexSyncPlansPre({ snapshot: snap, workspaceKey: 'D:/tmp/wsE2E' }).plans[0]
    const frames = mutate(plan)
    const acks = []
    let last = null
    for (const f of frames) {
      const res = await c.request(f.type, f.payload)
      if (!res.ok) { last = { transportError: res.code }; break }
      acks.push(res.frame.payload)
      if (res.frame.payload.accepted === false) { last = { reason: res.frame.payload.reason }; break }
    }
    const failFrame = acks.find((a) => a.accepted === false)
    const reason = (last && last.reason) || (failFrame && failFrame.reason)
    ok(reason === expectReason, 'H4 ' + label + ' → 整次拒绝 reason=' + reason + '(期望 ' + expectReason + ')')
    const after = readFileSync(derivedPath(H3.home)).toString('hex')
    eq(after, baseline, 'H4 ' + label + ' 派生态字节不变(失败不落盘)')
  }
  const pageFrames = (plan) => [
    { type: 'index_sync_begin', payload: plan.begin },
    ...plan.pages.map((p) => ({ type: 'index_sync_page', payload: p })),
    { type: 'index_sync_commit', payload: plan.commit },
  ]
  await runBroken((p) => {
    // 单页计划强制声明 pageCount=2 → 只送 page0 即 commit → 缺页
    const fr = pageFrames({ ...p, begin: { ...p.begin, pageCount: 2 } })
    fr[1].payload = { ...fr[1].payload, pageCount: 2 }
    return [fr[0], fr[1], fr[fr.length - 1]]
  }, 'missing-page', '缺页(声明两页只送一页)')
  await runBroken((p) => {
    const fr = pageFrames(p)
    return [fr[0], fr[1], fr[1], fr[2]]
  }, 'page-duplicate', '重复页(pageNo=0 两次)')
  await runBroken((p) => {
    if (p.pages.length < 2) { p.pages.push(JSON.parse(JSON.stringify(p.pages[0]))); p.pages[1].pageNo = 1; p.begin.pageCount = 2 }
    const fr = pageFrames(p)
    const tmpOrder = fr[1]; fr[1] = fr[2]; fr[2] = tmpOrder;
    return fr
  }, 'page-out-of-order', '乱序(pageNo=1 先于 0)')
  await runBroken((p) => {
    const fr = pageFrames(p)
    fr[1].payload = { ...fr[1].payload, pageDigest: '0'.repeat(64) };
    return [fr[0], fr[1], fr[fr.length - 1]]
  }, 'digest-mismatch', 'pageDigest 篡改')
  await runBroken((p) => {
    const fr = pageFrames(p)
    const recs = fr[1].payload.records.map((r) => ({ ...r, workspaceRef: 'wsr_' + 'ff'.repeat(16) }))
    fr[1].payload = { ...fr[1].payload, records: recs }
    return [fr[0], fr[1]]
  }, 'record-scope-mismatch', '记录携带不同 workspaceRef(中途不一致)')
  await runBroken((p) => {
    const fr = pageFrames(p)
    fr[fr.length - 1].payload = { ...fr[fr.length - 1].payload, memoryIndexVersion: 'idx_' + 'ee'.repeat(16) }
    return fr
  }, 'version-mismatch', 'commit 的 memoryIndexVersion 与 begin 不一致')
  await runBroken((p) => {
    const fr = pageFrames(p)
    fr[fr.length - 1].payload = { ...fr[fr.length - 1].payload, finalDigest: '1'.repeat(64) };
    return fr
  }, 'final-digest-mismatch', 'finalDigest 不符')
  eq(readdirSync(path.join(H3.home, 'memory', 'semantic')).length, 1, 'H4 全程无 .tmp 残留文件')
}


// ---------- H5 ----------
console.log('[H5] 新 memoryIndexVersion 原子整体替换·旧版本零残留')
{
  const c = H3.client
  const oldMiv = 'idx_' + sha256Hex(Buffer.from('miv-e2e')).slice(0, 32)
  const snapV2 = mkSnapshot(10, 2, 'e2e', { miv: 'idx_' + hex32('miv-e2e-v2') })
  ok(snapV2.memoryIndexVersion !== oldMiv, 'H5 v2 版本号不同于已提交 v1')
  const built = SYNC.buildIndexSyncPlansPre({ snapshot: snapV2, workspaceKey: 'D:/tmp/wsE2E' })
  const results = await sendAll(c, built.plans)
  ok(results.every((r) => r.ok), 'H5 v2 全部 sync 接受')
  const parsed = JSON.parse(readFileSync(derivedPath(H3.home), 'utf8'))
  ok(parsed.entries.every((e) => e.memoryIndexVersion === snapV2.memoryIndexVersion), 'H5 所有分区条目均为 v2(旧版本整体淘汰)')
  ok(!JSON.stringify(parsed).includes(oldMiv), 'H5 落盘内容零旧版本痕迹(不混用)')
  const wsEntry = parsed.entries.find((e) => e.scope === 'Workspace')
  eq(wsEntry.recordCount, 10, 'H5 Workspace 条目替换为 v2 的 10 条(v1 的 70 条不再可见)')
  const hv = await c.health()
  const view = hv.frame.payload.corpus;
  ok(view.every((v) => v.memoryIndexVersion === snapV2.memoryIndexVersion), 'H5 health corpus 视图仅呈现当前版本')
}

// ---------- H6 ----------
console.log('[H6] 无 dsh-home 时派生态仅内存(persisted=false)')
{
  const cMem = mkClient(null)
  const built = SYNC.buildIndexSyncPlansPre({ snapshot: mkSnapshot(2, 0, 'mem'), workspaceKey: 'D:/tmp/wsMem' })
  const results = await sendAll(cMem, built.plans)
  ok(results.every((r) => r.ok), 'H6 内存模式 sync 成功')
  const commitAck = results[0].acks[results[0].acks.length - 1]
  eq(commitAck.payload.persisted, false, 'H6 未提供 dsh-home → persisted=false(仅内存派生态)')
  await cMem.dispose('test')
}

// ---------- H7 ----------
console.log('[H7] 四种身份格式分离 + index_ack 关联纪律')
{
  const c = H3.client
  await c.health()
  const epoch = c.currentEpoch()
  const before = c._statsForTest.dropped.unknownRequest;
  const fakeAck = { protocolVersion: WIRE.M7_WIRE_PROTOCOL_VERSION_V1, frameId: 'fa', requestId: 'obs_notarequestid', workerEpoch: epoch, type: 'index_ack', payload: { schemaVersion: 1, syncId: 'syn_' + '0'.repeat(32), phase: 'commit', accepted: true, memoryIndexVersion: 'idx_' + '0'.repeat(32), workspaceRef: 'wsr_' + '0'.repeat(32), scope: 'Workspace' }, sentAt: 9 }
  c._feedForTest(JSON.stringify(fakeAck) + '\n')
  eq(c._statsForTest.dropped.unknownRequest, before + 1, 'H7 observationId 形状 id 冒充 requestId 的 index_ack → 丢弃')
  const plans = SYNC.buildIndexSyncPlansPre({ snapshot: mkSnapshot(1, 0, 'idfmt'), workspaceKey: 'D:/tmp/wsE2E' })
  ok(plans.plans[0].begin.syncId.startsWith('syn_'), 'H7 sync 身份=syncId(syn_*)')
  await c.health()
  const lastReq = c._lastFrameForTest();
  ok(lastReq.requestId.startsWith('req_'), 'H7 transport 身份=requestId(req_*)')
}

// ---------- H8 ----------
console.log('[H8] M5/M6 兼容复assert(worker 产物仍过现有 validator)')
{
  const CB = await import('../../lib/context-bridge.js')
  const c = mkClient(null)
  const acts = []
  c.onActivation((evt) => acts.push(evt.activation))
  const rec = mkSnapshot(1, 0, 'h8').records[0];
  const ref = { memoryId: rec.memoryId, anchorId: rec.anchorId, scope: rec.scope, sourceRef: rec.sourceRef, sourceEpoch: rec.sourceEpoch, sourceVersion: rec.sourceVersion, fileDigest: rec.fileDigest, recordDigest: rec.recordDigest, excerpt: rec.text.slice(0, 40) };
  const built = CB.buildContextPushEnvelopePre({
    session: { sessionId: 'sess-H8', agentId: 'agent-h8', workspaceKey: 'D:/tmp/wsH8', scope: 'Workspace' },
    cursor: { eventSeq: 3, contextVersion: 2 },
    index: { memoryIndexVersion: 'idx_' + hex32('h8-miv'), sourceEpochs: [rec.sourceEpoch] },
    trigger: { segmentId: 't', digest: sha256Hex(Buffer.from('trigger-text')).slice(0, 32), kind: 'user', eventSeq: 3, contextVersion: 2, ts: 1700000000000, text: '触发文本' },
    window: [], memoryRefs: [ref], evidence: [], now: 1700000000000,
  })
  ok(built.ok, 'H8 fixture envelope 合法')
  const pres = await c.request('context_push', built.frame);
  ok(pres.ok && CB.validateContextAckPre(pres.frame.payload).ok, 'H8 ack 通过 M5 validateContextAckPre')
  for (let i = 0; i < 20 && acts.length < 1; i++) await sleep(50)
  ok(acts.length >= 1 && ACT.validateActivationRequestPre(acts[acts.length - 1]).ok, 'H8 worker 激活通过 M6 validateActivationRequestPre')
  await c.dispose('test')
}

// ---------- H9 ----------
console.log('[H9] 同步失败后 lexical_v2 回退语义不受破坏')
{
  const SR = await import('../../lib/shadow-retrieval.js')
  const snap = {
    memoryIndexVersion: 'idx_' + 'cd'.repeat(16), sources: [],
    records: [{ memoryId: 'mem_' + 'ee'.repeat(16), anchorId: 'anc-y', scope: 'Workspace', sourceClass: 'workspace-notes', sourceRef: 'workspace:MEMORY.md', sourceEpoch: 'ep', sourceVersion: 1, fileDigest: sha256Hex(Buffer.from('f')), recordDigest: sha256Hex(Buffer.from('r')), lineStart: 1, lineEnd: 2, byteStart: 0, byteEnd: 20, heading: '部署', text: '部署流程使用 pnpm build 与 rsync 发布', bytes: 20 }],
  }
  const qp = SR.buildQueryPlan({ trigger: { segmentId: 's', segmentDigest: 'd', kind: 'user', eventType: 'session/event', ts: 1700000000000 }, window: [] })
  const a = SR.lexicalSearch(snap, qp, { triggerTs: 1700000000000, mode: 'prefetch' }).kept.map((k) => k.memoryId)
  const plan = SYNC.buildIndexSyncPlansPre({ snapshot: mkSnapshot(2, 0, 'h9fail'), workspaceKey: 'D:/tmp/wsE2E' }).plans[0]
  const badCommit = { schemaVersion: 1, syncId: plan.commit.syncId, memoryIndexVersion: plan.commit.memoryIndexVersion, finalDigest: '9'.repeat(64) };
  await H3.client.request('index_sync_begin', plan.begin);
  for (const pg of plan.pages) await H3.client.request('index_sync_page', pg);
  const rBad = await H3.client.request('index_sync_commit', badCommit);
  ok(rBad.ok && rBad.frame.payload.accepted === false, 'H9 注入失败 sync 确实被拒(前置成立)')
  const b = SR.lexicalSearch(snap, qp, { triggerTs: 1700000000000, mode: 'prefetch' }).kept.map((k) => k.memoryId)
  eq(b, a, 'H9 同步失败前后 lexical_v2 结果一致(JS 本地回退不受影响)')
}

await H3.client.dispose('test')
try { rmSync(H3.home, { recursive: true, force: true }) } catch (_) {}
console.log('')
console.log('M71: ' + pass + ' passed, ' + fail + ' failed')
if (fail > 0) process.exit(1)

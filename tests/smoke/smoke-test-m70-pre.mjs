// M7-0 Protocol + Fake Worker 测试(docs/PYTHON-SIDECAR-CONTRACT.md §7,§13,§16):
// wire codec / framing(partial·multiple·bad JSON·oversize) / epoch 重启与旧响应丢弃 / 四种身份不混用 /
// timeout·cancel·crash·breaker / disabled 零进程零 IO / ContextAckPre M5 兼容 / fake ActivationRequestPre
// M6 兼容 / Python 不可用回退 / A-B 零串线 / determinism。
import { spawn } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync, readFile } from 'node:fs'
import { readFile as readFileP } from 'node:fs/promises'
import { createHash, randomUUID } from 'node:crypto'
import { tmpdir } from 'node:os'
import path from 'node:path'
process.on('uncaughtException', (e) => { console.error('[M70-TEST] FATAL:', (e && (e.stack || e.message)) || e); process.exit(1) })
process.on('unhandledRejection', (r) => { console.error('[M70-TEST] REJ:', r); process.exit(1) })

let pass = 0; let fail = 0
function ok(cond, name) { if (cond) { pass++; console.log('  ok - ' + name) } else { fail++; console.error('  FAIL - ' + name) } }
function eq(a, b, name) { ok(JSON.stringify(a) === JSON.stringify(b), name) }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const sha256Hex = (buf) => createHash('sha256').update(buf).digest('hex')

const WIRE = await import('../../lib/m7-wire.js')
const CLIENT = await import('../../lib/python-sidecar-client.js')
const BRIDGE = await import('../../lib/context-bridge.js')
const ACT = await import('../../lib/activation-inbox.js')
const WORKER_PATH = CLIENT.defaultWorkerScriptPathPre()

function mkRecordPair(seedHex) {
  return [{
    memoryId: 'mem_' + seedHex, anchorId: 'anc_' + seedHex.slice(0, 12), scope: 'Workspace',
    sourceRef: 'workspace:MEMORY.md', sourceEpoch: randomUUID(), sourceVersion: 1,
    fileDigest: sha256Hex(Buffer.from('file-' + seedHex)), recordDigest: sha256Hex(Buffer.from('rec-' + seedHex)),
    excerpt: '- 授权摘要内容 ' + seedHex.slice(0, 4),
  }]
}
function buildEnvelope(sess, cv, refs) {
  const seg = (id, text, kind, evSeq) => ({
    segmentId: id, digest: sha256Hex(Buffer.from(text)).slice(0, 32), kind, eventSeq: evSeq,
    contextVersion: cv, ts: 1700000000000, text,
  })
  const built = BRIDGE.buildContextPushEnvelopePre({
    session: sess,
    cursor: { eventSeq: 9, contextVersion: cv },
    index: { memoryIndexVersion: 'idx_' + 'ab'.repeat(16), sourceEpochs: ['ep-1'] },
    trigger: seg('seg-trigger', '用户询问部署流程细节', 'user', 9),
    window: [seg('seg-w1', '上一轮讨论了登录模块', 'assistant', 8)],
    memoryRefs: refs,
    evidence: [],
    now: 1700000000000,
  })
  if (!built.ok) throw new Error('fixture envelope invalid: ' + built.reason)
  return built.frame
}
const ENV_A_REFS = mkRecordPair('aa'.repeat(16))
const ENV_B_REFS = mkRecordPair('bb'.repeat(16))
const ENV_A = buildEnvelope({ sessionId: 'sess-A', agentId: 'agent-a1', workspaceKey: 'D:/tmp/wsA', scope: 'Workspace' }, 3, ENV_A_REFS)
const ENV_B = buildEnvelope({ sessionId: 'sess-B', agentId: 'agent-b1', workspaceKey: 'D:/tmp/wsB', scope: 'Workspace' }, 4, ENV_B_REFS)

function mkClient(over = {}) {
  return CLIENT.createPythonSidecarClientPre({
    command: over.command || 'python',
    scriptPath: () => (typeof over.scriptPathFn === 'function' ? over.scriptPathFn() : (over.scriptPath || WORKER_PATH)),
    dshHome: over.dshHome || '',
    requestTimeoutMs: over.requestTimeoutMs || 2500,
    breakerCooldownMs: over.breakerCooldownMs !== undefined ? over.breakerCooldownMs : 600,
    breakerFailureThreshold: over.breakerFailureThreshold || 3,
  })
}

// ---------- G1 ----------
console.log('[G1] 协议常量冻结 + wire codec')
{
  ok(Object.isFrozen(WIRE.M7_TRANSPORT_BUDGET_V1), 'G1 传输预算冻结')
  eq(WIRE.M7_WIRE_PROTOCOL_VERSION_V1, 'm7_wire_v1', 'G1 协议版本字符串')
  const js = new Set(WIRE.JS_FRAME_TYPES_V1), py = new Set(WIRE.PY_FRAME_TYPES_V1)
  ok([...js].every((t) => !py.has(t)) && [...py].every((t) => !js.has(t)), 'G1 JS/PY 帧类型集合不相交')
  for (const req of ['health', 'context_push', 'index_sync_begin', 'index_sync_page', 'index_sync_commit']) {
    ok(WIRE.RESPONSE_TYPE_FOR_V1[req], 'G1 响应映射含 ' + req)
  }
  ok(!WIRE.RESPONSE_TYPE_FOR_V1.cancel && !WIRE.RESPONSE_TYPE_FOR_V1.close_session, 'G1 cancel/close_session 无响应帧')
  eq(WIRE.canonicalJson({ b: 1, a: ['x', { z: null, y: true }] }), '{"a":["x",{"y":true,"z":null}],"b":1}', 'G1 canonicalJson 排序键已知向量')
  eq(WIRE.canonicalJson({ k: '中文\n"引"' }), '{"k":"中文\\n\\"引\\""}', 'G1 canonicalJson 非 ASCII 与转义')
  const v = WIRE.validateTransportFramePre({ protocolVersion: 'm7_wire_v1', frameId: 'f1', requestId: 'r1', workerEpoch: 'wk', type: 'health_result', payload: {}, sentAt: 1 })
  ok(v.ok, 'G1 合法 envelope 通过')
  for (const [mut, field] of [
    [(f) => { f.protocolVersion = 'v0' }, 'protocolVersion'],
    [(f) => { delete f.frameId }, 'frameId'],
    [(f) => { delete f.workerEpoch }, 'workerEpoch'],
    [(f) => { f.type = 'not_a_type' }, 'type'],
    [(f) => { f.payload = [] }, 'payload'],
    [(f) => { f.sentAt = 'x' }, 'sentAt'],
  ]) {
    const f = JSON.parse(JSON.stringify(v.frame)); mut(f)
    ok(!WIRE.validateTransportFramePre(f).ok, 'G1 篡改 ' + field + ' fail closed')
  }
  ok(!WIRE.validateTransportFramePre(v.frame, { direction: 'out' }).ok, 'G1 方向门:PY 帧不能当出站')
  const mf1 = WIRE.makeRequestFramePre({ type: 'health', payload: {}, requestId: 'rq1', workerEpoch: 'wk', sentAt: 42 })
  const mf2 = WIRE.makeRequestFramePre({ type: 'health', payload: {}, requestId: 'rq1', workerEpoch: 'wk', sentAt: 42 })
  ok(mf1.ok && mf2.ok && mf1.frame.frameId === mf2.frame.frameId, 'G1 出站帧 frameId 确定性')
  const wireSrc = await readFileP(new URL('../../lib/m7-wire.js', import.meta.url), 'utf8')
  ok(WIRE.wireModuleHygieneOk(wireSrc), 'G1 wire 模块静态卫生(无 spawn/net/http)')
}


// ---------- G2 ----------
console.log('[G2] framing:partial/multiple/bad JSON/oversize/epoch 门/type 混用')
{
  const c = mkClient()
  ok(c.ensureStarted().ok, 'G2 lazy start 成功(real worker)')
  const epoch = c.currentEpoch()
  ok(/^wk_[0-9a-f]{32}$/.test(epoch), 'G2 workerEpoch 形状 wk_+32hex')
  c._feedForTest('{"broken\n')
  eq(c._statsForTest.dropped.badJson, 1, 'G2 坏 JSON 计账丢弃')
  c._feedForTest(JSON.stringify({ protocolVersion: 'x' }) + '\n')
  eq(c._statsForTest.dropped.badEnvelope, 1, 'G2 坏 envelope 计账丢弃')
  const wrongEpochFrame = { protocolVersion: WIRE.M7_WIRE_PROTOCOL_VERSION_V1, frameId: 'f', requestId: 'zz', workerEpoch: 'wk_other_epoch', type: 'health_result', payload: {}, sentAt: 1 }
  c._feedForTest(JSON.stringify(wrongEpochFrame) + '\n')
  eq(c._statsForTest.dropped.staleEpoch, 1, 'G2 错误 epoch 丢弃(fail closed)')
  const unknownReq = { protocolVersion: WIRE.M7_WIRE_PROTOCOL_VERSION_V1, frameId: 'f2', requestId: 'req_none', workerEpoch: epoch, type: 'health_result', payload: {}, sentAt: 1 }
  c._feedForTest(JSON.stringify(unknownReq) + '\n')
  eq(c._statsForTest.dropped.unknownRequest, 1, 'G2 未知 requestId 丢弃')
  const ph = c.request('health')
  const sent = c._lastFrameForTest()
  ok(sent && sent.type === 'health' && sent.requestId, 'G2 出站帧捕获(requestId 关联键)')
  const mkResp = (type, payload) => ({ protocolVersion: WIRE.M7_WIRE_PROTOCOL_VERSION_V1, frameId: 'resp-' + Math.random().toString(36).slice(2), requestId: sent.requestId, workerEpoch: epoch, type, payload, sentAt: 5 })
  c._feedForTest(JSON.stringify(mkResp('context_ack', { observationId: 'obs_x', accepted: true })) + '\n')
  eq(c._statsForTest.dropped.typeMismatch, 1, 'G2 响应类型与请求不匹配丢弃(requestId 不跨类型混用)')
  c._feedForTest(JSON.stringify(mkResp('health_result', { protocol: 'm7_wire_v1' })) + '\n')
  const rh = await ph
  ok(rh.ok && rh.frame.type === 'health_result', 'G2 正确响应到达后正常 resolve')
  const p2 = c.request('health')
  const sent2 = c._lastFrameForTest()
  const resp2 = Buffer.from(JSON.stringify({ protocolVersion: WIRE.M7_WIRE_PROTOCOL_VERSION_V1, frameId: 'r2', requestId: sent2.requestId, workerEpoch: epoch, type: 'health_result', payload: { protocol: 'm7_wire_v1' }, sentAt: 6 }) + '\n', 'utf8')
  let done2 = false; void p2.then(() => { done2 = true })
  c._feedForTest(resp2.subarray(0, 10))
  await sleep(60)
  ok(!done2, 'G2 partial 行挂起等待补全')
  c._feedForTest(resp2.subarray(10))
  const r2 = await p2
  ok(r2.ok, 'G2 补全后半帧立即 resolve(partial 重组)')
  const qA = c.request('health'); const frA = JSON.parse(JSON.stringify(c._lastFrameForTest()))
  const qB = c.request('health'); const frB = JSON.parse(JSON.stringify(c._lastFrameForTest()))
  const chunk = [frA, frB].map((fr, i) => JSON.stringify({ protocolVersion: WIRE.M7_WIRE_PROTOCOL_VERSION_V1, frameId: 'm' + i, requestId: fr.requestId, workerEpoch: epoch, type: 'health_result', payload: { i }, sentAt: 7 })).join('\n') + '\n'
  c._feedForTest(chunk)
  const [ra, rb] = await Promise.all([qA, qB])
  ok(ra.ok && rb.ok && ra.frame.payload.i === 0 && rb.frame.payload.i === 1, 'G2 multiple-lines 单 chunk 双请求各自关联')
  const bigReq = c.request('health')
  c._feedForTest(Buffer.alloc(300 * 1024, 97))
  const rBig = await bigReq
  eq(rBig.code, 'protocol', 'G2 超长行 fatal → 在途请求结构化失败(protocol)')
  eq(c._statsForTest.lastFatal, 'line-oversize', 'G2 lastFatal=line-oversize')
  const rr = await c.request('health')
  ok(rr.ok, 'G2 fatal 后下一次请求自动重生进程并成功(crash recovery)')
  await c.dispose('test')
}


// ---------- G3 ----------
console.log('[G3] worker 往返:ack M5 兼容/激活 M6 兼容/幂等/determinism/零目录')
{
  const home = mkdtempSync(path.join(tmpdir(), 'dam-m70-home-'))
  const c = mkClient({ dshHome: home })
  const activations = []
  c.onActivation((evt) => activations.push(evt.activation))
  const h = await c.health()
  ok(h.ok && h.frame.payload.protocol === 'm7_wire_v1', 'G3 health_result 回显协议版本')
  eq(h.frame.payload.corpus, [], 'G3 初始 derived corpus 视图为空')
  const pres = await c.request('context_push', JSON.parse(JSON.stringify(ENV_A)))
  ok(pres.ok, 'G3 context_push 得到响应帧')
  const ack = pres.frame.payload
  eq(ack.observationId, ENV_A.observationId, 'G3 ack.observationId 一致')
  eq(ack.accepted, true, 'G3 ack.accepted=true')
  ok(BRIDGE.validateContextAckPre(ack).ok, 'G3 ack 通过现有 M5 validateContextAckPre(M5 兼容)')
  for (let i = 0; i < 30 && activations.length < 1; i++) await sleep(50)
  ok(activations.length >= 1, 'G3 worker 主动推送 activation_request 帧')
  const act = activations[activations.length - 1]
  const av = ACT.validateActivationRequestPre(act)
  ok(av.ok, 'G3 fake activation 逐字段通过现有 M6 validator(M6 兼容)' + (av.ok ? '' : ':' + av.reason))
  if (av.ok) {
    eq(act.observationId, ENV_A.observationId, 'G3 activation 绑定触发 observationId')
    eq(act.sessionId, ENV_A.session.sessionId, 'G3 activation sessionId 复制自推送帧')
    eq(act.contextVersion, ENV_A.cursor.contextVersion, 'G3 activation contextVersion 复制')
    eq(act.memoryIndexVersion, ENV_A.index.memoryIndexVersion, 'G3 activation memoryIndexVersion 复制')
    eq(act.candidates.map((x) => x.memoryId), ENV_A.memoryRefs.map((r) => r.memoryId), 'G3 候选 provenance 逐条复制自授权 refs')
    ok(act.candidates.every((x) => ACT.validateActivationCandidatePre(x).ok), 'G3 每个候选通过 M6 候选校验')
  }
  const dup = await c.request('context_push', JSON.parse(JSON.stringify(ENV_A)))
  ok(dup.frame.payload.accepted === false && dup.frame.payload.reason === 'busy', 'G3 同 observationId 幂等(第二次 busy)')
  async function rawRound() {
    const lines = [
      JSON.stringify({ protocolVersion: 'm7_wire_v1', frameId: 'fix-f1', requestId: 'fix-r-health', workerEpoch: 'wk_fix', type: 'health', payload: {}, sentAt: 123 }),
      JSON.stringify({ protocolVersion: 'm7_wire_v1', frameId: 'fix-f2', requestId: 'fix-r-push', workerEpoch: 'wk_fix', type: 'context_push', payload: ENV_A, sentAt: 124 }),
    ]
    return await new Promise((resolve, reject) => {
      const proc = spawn('python', [WORKER_PATH, '--expect-epoch', 'wk_fix'], { shell: false })
      const chunks = []
      proc.stdout.on('data', (d) => chunks.push(d))
      proc.on('error', reject)
      proc.stdin.end(lines.join('\n') + '\n')
      proc.on('close', () => resolve(Buffer.concat(chunks).toString('utf8')))
      setTimeout(() => { try { proc.kill() } catch (_) {} }, 8000)
    })
  }
  const run1 = await rawRound()
  const run2 = await rawRound()
  eq(run1, run2, 'G3 同 fixture 输入两进程输出逐字节相同(deterministic fake)')
  ok(run1.includes('"type":"health_result"') && run1.includes('"type":"context_ack"'), 'G3 stdout 只含协议帧')
  ok(!existsSync(path.join(home, 'memory', 'semantic')), 'G3 push-only 不产生 semantic 目录')
  await c.dispose('test')
  rmSync(home, { recursive: true, force: true })
}

// ---------- G4 ----------
console.log('[G4] workerEpoch 重启/旧响应丢弃/崩溃恢复')
{
  const c = mkClient()
  await c.health()
  const e0 = c.currentEpoch()
  c.restart('test-restart')
  eq(c.currentEpoch(), null, 'G4 restart 后 epoch 立即作废')
  const rNew = await c.request('health')
  ok(rNew.ok && c.currentEpoch() !== e0, 'G4 重启后新 epoch 新进程成功')
  const dvBefore = c.debugView().stats.dropped.staleEpoch
  c._feedForTest(JSON.stringify({ protocolVersion: WIRE.M7_WIRE_PROTOCOL_VERSION_V1, frameId: 'old', requestId: 'old-req', workerEpoch: e0, type: 'health_result', payload: {}, sentAt: 1 }) + '\n')
  eq(c.debugView().stats.dropped.staleEpoch, dvBefore + 1, 'G4 旧 epoch 响应丢弃(stale-epoch fail closed)')
  const silentPy = path.join(tmpdir(), 'dam-m70-silent-' + Date.now() + '.py')
  writeFileSync(silentPy, 'import sys, time\nwhile True:\n    sys.stdin.readline()\n    time.sleep(120)\n', 'utf8')
  const cs = mkClient({ scriptPath: silentPy, requestTimeoutMs: 8000 })
  const rq = cs.request('health')
  await sleep(150)
  ok(cs.isStarted(), 'G4 silent worker 已启动')
  cs.processForTest().kill('SIGKILL')
  const rr = await rq
  eq(rr.code, 'crashed', 'G4 进程被杀 → 在途请求结构化失败码=crashed')
  await cs.dispose('test')
  try { rmSync(silentPy, { force: true }) } catch (_) {}
  await c.dispose('test')
}


// ---------- G6 ----------
console.log('[G6] timeout/cancel/breaker/half-open 恢复')
{
  const silentPy = path.join(tmpdir(), 'dam-m70-silent2-' + Date.now() + '.py')
  writeFileSync(silentPy, 'import sys, time\nwhile True:\n    sys.stdin.readline()\n    time.sleep(120)\n', 'utf8')
  let target = silentPy
  const cs = mkClient({ scriptPathFn: () => target, requestTimeoutMs: 400, breakerCooldownMs: 700 })
  const t1 = await cs.request('health')
  eq(t1.code, 'timeout', 'G6 无响应 worker → 结构化 timeout')
  const ac = new AbortController()
  const rc = cs.request('health', {}, { signal: ac.signal, timeoutMs: 5000 })
  setTimeout(() => ac.abort(new Error('superseded')), 80)
  const rca = await rc
  eq(rca.code, 'aborted', 'G6 AbortSignal 中止 → aborted')
  ok(cs._statsForTest.cancelNotifications >= 1, 'G6 取消时向 worker 发出 cancel 通知帧')
  await cs.request('health')
  await cs.request('health')
  const startsAtOpen = cs.debugView().stats.starts
  ok(cs.breakerOpenForTest(), 'G6 连续失败达阈值 → breaker 打开')
  const ro = await cs.request('health')
  eq(ro.code, 'circuit-open', 'G6 打开期请求立即结构化失败(circuit-open)')
  eq(cs.debugView().stats.starts, startsAtOpen, 'G6 打开期零 spawn')
  target = WORKER_PATH
  cs.restart('target-switch') // 已在跑的 silent 进程不换脚本,必须显式重生
  await sleep(800)
  const rh = await cs.request('health', {}, { timeoutMs: 2500 })
  ok(rh.ok, 'G6 冷却后半开探测成功(real worker)')
  eq(cs.debugView().breaker.consecutiveFailures, 0, 'G6 成功后连续失败计数归零(breaker 关闭)')
  await cs.dispose('test')
  try { rmSync(silentPy, { force: true }) } catch (_) {}
}


// ---------- G5 ----------
console.log('[G5] 四种身份不混用(requestId/observationId/activationId/syncId)')
{
  const c = mkClient()
  await c.health()
  const epoch = c.currentEpoch()
  const pctx = c.request('context_push', JSON.parse(JSON.stringify(ENV_A)))
  const sentCtx = c._lastFrameForTest()
  const fakeIndexAck = { protocolVersion: WIRE.M7_WIRE_PROTOCOL_VERSION_V1, frameId: 'x1', requestId: 'syn_' + '0'.repeat(32), workerEpoch: epoch, type: 'index_ack', payload: { schemaVersion: 1, syncId: 'syn_' + '0'.repeat(32), phase: 'commit', accepted: true, memoryIndexVersion: ENV_A.index.memoryIndexVersion, workspaceRef: 'wsr_' + '0'.repeat(32), scope: 'Workspace' }, sentAt: 1 }
  c._feedForTest(JSON.stringify(fakeIndexAck) + '\n')
  eq(c._statsForTest.dropped.unknownRequest, 1, 'G5 syncId 形状 id 顶替 requestId → 未知请求丢弃(context_push 未被污染)')
  const goodAck = { protocolVersion: WIRE.M7_WIRE_PROTOCOL_VERSION_V1, frameId: 'x2', requestId: sentCtx.requestId, workerEpoch: epoch, type: 'context_ack', payload: { schemaVersion: 1, observationId: ENV_A.observationId, accepted: true, workerEpoch: epoch, reason: 'ok' }, sentAt: 2 }
  c._feedForTest(JSON.stringify(goodAck) + '\n')
  const rctx = await pctx
  ok(rctx.ok, 'G5 正确 context_ack 完成关联(四种身份各归各位)')
  ok(sentCtx.requestId.startsWith('req_'), 'G5 transport 身份=requestId(req_*)')
  ok(ENV_A.observationId.startsWith('obs_'), 'G5 M5 身份=observationId(obs_*)')
  await c.dispose('test')
}

// ---------- G8 ----------
console.log('[G8] Python 不可用结构化失败 + lexical_v2 回退不受破坏')
{
  const cu = mkClient({ command: 'definitely-not-python-xyz' })
  const h = await cu.request('health')
  eq(h.ok, false, 'G8 spawn 失败 → ok:false(不抛异常)')
  eq(h.code, 'unavailable', 'G8 结构化失败码=unavailable')
  const SR = await import('../../lib/shadow-retrieval.js')
  const snap = {
    memoryIndexVersion: 'idx_' + 'cd'.repeat(16),
    sources: [],
    records: [{
      memoryId: 'mem_' + 'ee'.repeat(16), anchorId: 'anc-x', scope: 'Workspace', sourceClass: 'workspace-notes',
      sourceRef: 'workspace:MEMORY.md', sourceEpoch: randomUUID(), sourceVersion: 1,
      fileDigest: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', recordDigest: sha256Hex(Buffer.from('lex-rec')),
      lineStart: 1, lineEnd: 2, byteStart: 0, byteEnd: 20, heading: '部署',
      text: '部署流程使用 pnpm build 与 rsync 发布', bytes: 20,
    }],
  }
  const qp = SR.buildQueryPlan({ trigger: { segmentId: 's', segmentDigest: 'd', kind: 'user', eventType: 'session/event', ts: 1700000000000 }, window: [] })
  const lexBefore = SR.lexicalSearch(snap, qp, { triggerTs: 1700000000000, mode: 'prefetch' }).kept.map((k) => k.memoryId)
  await cu.request('health')
  const lexAfter = SR.lexicalSearch(snap, qp, { triggerTs: 1700000000000, mode: 'prefetch' }).kept.map((k) => k.memoryId)
  eq(lexAfter, lexBefore, 'G8 Python 故障前后 lexical_v2 结果逐项一致(回退语义不受破坏)')
  await cu.dispose('test')
}

// ---------- G9 ----------
console.log('[G9] A/B 会话零串线(worker 侧)')
{
  const c = mkClient()
  const acts = []
  c.onActivation((evt) => acts.push(evt.activation))
  const [pa, pb] = await Promise.all([
    c.request('context_push', JSON.parse(JSON.stringify(ENV_A))),
    c.request('context_push', JSON.parse(JSON.stringify(ENV_B))),
  ])
  ok(pa.ok && pb.ok, 'G9 A/B 并发推送均获 ack')
  ok(pa.frame.payload.observationId === ENV_A.observationId && pb.frame.payload.observationId === ENV_B.observationId, 'G9 ack 各自回显正确 observationId')
  for (let i = 0; i < 30 && acts.length < 2; i++) await sleep(50)
  ok(acts.length >= 2, 'G9 两个激活帧均到达')
  const byObs = new Map(acts.map((a) => [a.observationId, a]))
  const actA = byObs.get(ENV_A.observationId), actB = byObs.get(ENV_B.observationId)
  ok(actA && actB, 'G9 激活与观测一一对应')
  ok(actA.sessionId === 'sess-A' && actA.workspaceKey === 'D:/tmp/wsA', 'G9 A 激活身份=A')
  ok(actB.sessionId === 'sess-B' && actB.workspaceKey === 'D:/tmp/wsB', 'G9 B 激活身份=B')
  const idsA = new Set(actA.candidates.map((x) => x.recordDigest))
  ok(actB.candidates.every((x) => !idsA.has(x.recordDigest)), 'G9 B 候选与 A 候选零交集(provenance 隔离)')
  await c.dispose('test')
}


// ---------- G7 ----------
console.log('[G7] 默认关闭零进程/零协议 IO/零目录(harness 经 lib/index.js apply)')
{
  const ws1 = mkdtempSync(path.join(tmpdir(), 'dam-m70-harness-'))
  const home = path.join(ws1, '.dsh-home')
  mkdirSync(home, { recursive: true })
  writeFileSync(path.join(home, 'dsh-auto-memory.json'), JSON.stringify({
    memoryRoot: path.join(ws1, 'mem'), userMemoryDir: path.join(ws1, 'user'), projectMemoryDir: '.project-memory', externalSources: {},
  }), 'utf8')
  process.env.DSH_HOME = home
  globalThis.fetch = async () => ({ ok: false, status: 503, json: async () => ({}) })
  const routes = []
  const effectDisposers = [] // 真实宿主卸载插件时会执行 effect 清理;空桩丢掉
                              // heartbeatTimer 的 clearInterval 会让进程无法退出
  const ctx = {
    get() { return undefined },
    on() { return () => {} },
    effect(fn) { const d = fn(); effectDisposers.push(d); return d },
    systemPrompt: { section() { return () => {} }, context() { return () => {} } },
    tools: { register() { return () => {} } },
    webServer: { register(r) { routes.push(r); return () => {} } },
  }
  const { apply } = await import('../../lib/index.js')
  apply(ctx, {})
  const dbgRoute = routes.find((r) => r.path === '/api/dsh-auto-memory/debug')
  const cfgRoute = routes.find((r) => r.path === '/api/dsh-auto-memory/config')
  const actRoute = routes.find((r) => r.path === '/api/dsh-auto-memory/activation-inbox')
  const postJson = async (route, payload) => {
    let out
    await route.handler({ socket: { remoteAddress: '127.0.0.1' }, headers: { host: '127.0.0.1:3080', origin: 'http://127.0.0.1:3080' }, method: 'POST', url: '/x', [Symbol.asyncIterator]() { return (async function* () { yield Buffer.from(JSON.stringify(payload)) })() } }, { writeHead() {}, end(x) { if (x !== undefined) out = x } })
    return out
  }
  const dbg = async () => {
    let b
    await dbgRoute.handler({ socket: { remoteAddress: '127.0.0.1' }, headers: { host: '127.0.0.1:3080' }, method: 'GET', url: '/debug' }, { writeHead() {}, end(x) { b = JSON.parse(x) } })
    return b.associativeMemory
  }
  const cfgPost = async (patch) => { await postJson(cfgRoute, patch); await sleep(120) }
  let am = await dbg()
  ok(am.pythonBackend && am.pythonBackend.enabled === false, 'G7 默认 pythonBackend.enabled=false')
  ok(am.pythonBackend.started === false && am.pythonBackend.stats.starts === 0, 'G7 默认零进程(stats.starts=0)')
  ok(!existsSync(path.join(home, 'memory', 'semantic')), 'G7 默认零 semantic 目录')
  await cfgPost({ associativeMemoryEnabled: true, contextBridgeEnabled: true, contextSinkMode: 'python' })
  am = await dbg()
  ok(am.contextBridge.enabled === true && am.contextBridge.sinkKind === 'null', 'G7 三重门缺 pythonBackend → sinkKind 回退 null')
  await cfgPost({ pythonBackendEnabled: true })
  am = await dbg()
  ok(am.contextBridge.sinkKind === 'python', 'G7 三重门全开 → sinkKind=python')
  ok(am.pythonBackend.started === false && am.pythonBackend.stats.starts === 0, 'G7 门开但无流量 → 依旧零进程(lazy start)')
  await cfgPost({ activationInboxEnabled: true, activationSource: 'python' })
  const inj = JSON.parse(await postJson(actRoute, { action: 'inject', request: {} }))
  eq(inj.reason, 'source-not-fake', 'G7 注入路由保持 fake-only(python 来源拒绝路由注入)')
  ok(!existsSync(path.join(home, 'memory', 'semantic')), 'G7 全程零 semantic 目录')
  await cfgPost({ associativeMemoryEnabled: false, contextBridgeEnabled: false, contextSinkMode: 'null', pythonBackendEnabled: false, activationInboxEnabled: false, activationSource: 'fake' })
  am = await dbg()
  ok(am.pythonBackend.enabled === false, 'G7 恢复默认关闭')
  for (const d of effectDisposers) { try { await d() } catch (e) {} }
  rmSync(ws1, { recursive: true, force: true })
}

console.log('')
console.log('M70: ' + pass + ' passed, ' + fail + ' failed')
if (fail > 0) process.exit(1)

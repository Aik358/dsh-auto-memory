// M6-2 Per-runtime Activation Inbox 测试(docs/M6-CONTRACT.md §8-§9,§14):
// pending/replace/expire/cooldown/claim/dispose/身份门/抑制门/注册表隔离。零 IO。
process.on('uncaughtException', (e) => { console.error('[M62B-TEST] FATAL:', (e && (e.stack || e.message)) || e); process.exit(1) })
process.on('unhandledRejection', (r) => { console.error('[M62B-TEST] REJ:', r); process.exit(1) })

const A = await import('../../lib/activation-inbox.js')
const S = await import('../../lib/activation-inbox-state.js')
let pass = 0; let fail = 0
function ok(cond, name) { if (cond) { pass++; console.log('  ok - ' + name) } else { fail++; console.error('  FAIL - ' + name) } }
function eq(a, b, name) { const ja = JSON.stringify(a); const jb = JSON.stringify(b); ok(ja === jb, name + (ja === jb ? '' : ' got=' + ja + ' want=' + jb)) }

const ID = { sessionId: 'sess-1', agentId: 'agent-1', workspaceKey: 'd:/ws' }
const MIV = 'idx_' + 'ab'.repeat(16)
const memA = 'mem_' + 'aa'.repeat(16)
const memB = 'mem_' + 'bb'.repeat(16)
function mkRec(mid) { return { memoryId: mid, anchorId: 'memory:' + mid, scope: 'Workspace', sourceRef: 'workspace:MEMORY.md', sourceEpoch: 'ep-1', sourceVersion: 2, fileDigest: 'e'.repeat(64), recordDigest: 'd'.repeat(63) + (mid === memA ? 'a' : 'b'), excerpt: '- 参考内容' } }
let seedCounter = 0
function mkReq(over = {}) {
  seedCounter++
  return A.makeFakeActivationRequestPre({
    seed: 'req-' + seedCounter, sessionId: ID.sessionId, agentId: ID.agentId, workspaceKey: ID.workspaceKey,
    contextVersion: over.contextVersion != null ? over.contextVersion : 5,
    memoryIndexVersion: over.memoryIndexVersion || MIV,
    ttlSteps: over.ttlSteps || 3,
    now: 1700000000000,
    records: over.records || [mkRec(memA)],
    observationId: over.observationId,
  })
}
function mkBox() { return S.createActivationInboxPre({ ...ID, contextVersion: 5, memoryIndexVersion: MIV }) }

console.log('[E1] 空收件箱/初始状态')
const box = mkBox()
eq(box.claim({ nowStep: 10 }).reason, 'none-pending', '空 claim → none-pending')
ok(box.pendingPacket === null, '无全局 pendingPacket 泄漏(实例字段为 null)')
console.log('[E1] 初始状态')

console.log('[E2] offer→pending→claim→deliver 全链路')
const req1 = mkReq()
const o1 = box.offerActivation(req1, { nowStep: 100 })
ok(o1.ok && o1.outcome === 'pending', '首单接受为 pending')
ok(box.pendingPacket && box.pendingPacket.packetId.startsWith('pkt_'), 'pending packet 就位(pkt_*)')
const c1 = box.claim({ nowStep: 101, currentContextVersion: 5, currentMemoryIndexVersion: MIV })
ok(c1.ok && c1.packet.packetId === o1.packetId, 'claim 返回同一 packet')
eq(c1.packet.deliveryState, 'claimed', '状态机 pending→claimed')
const d1 = box.markDelivered(o1.packetId, { nowStep: 101 })
ok(d1.ok && d1.cooldownUntilStep === 103, 'delivered 且 cooldown=now+2 步')
ok(box.claim({ nowStep: 102 }).reason === 'none-pending', '投递后 pending 清空')
console.log('[E2] offer/claim/deliver 状态机')

console.log('[E3] duplicate activationId/observationId 拒绝')
const dupIdReq = mkReq(); const firstOffer = box.offerActivation(dupIdReq, { nowStep: 110 })
ok(firstOffer.ok, '新 activation 首推接受')
const sameAct = A.makeFakeActivationRequestPre({ seed: 'dup-seed', sessionId: ID.sessionId, agentId: ID.agentId, workspaceKey: ID.workspaceKey, contextVersion: 5, memoryIndexVersion: MIV, records: [mkRec(memA)], now: 1700000000000 })
box.offerActivation(sameAct, { nowStep: 111 })
const again = box.offerActivation(JSON.parse(JSON.stringify(sameAct)), { nowStep: 112 })
eq(again.reason, 'duplicate-activation', '同 activationId 二次拒绝')
const obsTwins = mkReq({ observationId: sameAct.observationId, contextVersion: 5 })
eq(box.offerActivation(obsTwins, { nowStep: 113 }).reason, 'duplicate-observation', 'observationId 已见拒绝')
console.log('[E3] duplicate 门')

console.log('[E4] 身份门/cross-workspace 零泄漏')
const foreignWs = mkReq({ })
foreignWs.workspaceKey = 'd:/other'
eq(box.offerActivation(foreignWs, { nowStep: 120 }).reason, 'identity-mismatch', 'workspace 不匹配拒绝(cross-workspace)')
const foreignSess = mkReq()
foreignSess.sessionId = 'sess-other'
eq(box.offerActivation(foreignSess, { nowStep: 121 }).reason, 'identity-mismatch', 'sessionId 不匹配拒绝')
const reg = new S.ActivationInboxRegistry()
const boxB = reg.forRuntime('sess-B', 'd:/wsB', { contextVersion: 1 })
ok(boxB && boxB !== box, 'registry 按 session+ws 分桶')
eq(reg.forRuntime('sess-B', 'd:/wsB'), boxB, '同键复用同一实例')
ok(reg.get('sess-B', 'd:/OTHER') === null, '不同 ws 不同桶(get 为空)')
eq(S.ActivationInboxRegistry.keyOf('', ''), null, '无可靠身份 keyOf=null(禁止 default 桶)')
console.log('[E4] 身份门 + registry 分桶隔离')

console.log('[E5] cursor/index stale 门')
const box2 = mkBox()
const oldReq = mkReq({ contextVersion: 3 })
eq(box2.offerActivation(oldReq, { nowStep: 10 }).reason, 'stale-context', '落后游标的请求拒绝(stale-context)')
const okReq = mkReq({ contextVersion: 6 })
eq(box2.offerActivation(okReq, { nowStep: 11 }).outcome, 'pending', '超前游标接受(cv=6>5)')
const staleClaim = box2.claim({ nowStep: 12, currentContextVersion: 7, currentMemoryIndexVersion: MIV })
eq(staleClaim.reason, 'stale-context', 'claim 时 cursor 已前进 → stale-context 丢弃')
box2.setCursor({ contextVersion: 7 })
const req7 = mkReq({ contextVersion: 7 })
ok(box2.offerActivation(req7, { nowStep: 13 }).ok, 'cursor 对齐后重新接受')
const idxClaim = box2.claim({ nowStep: 14, currentContextVersion: 7, currentMemoryIndexVersion: 'idx_' + 'ff'.repeat(16) })
eq(idxClaim.reason, 'stale-index', 'index 版本不匹配 → stale-index 丢弃')
console.log('[E5] cursor/index 双 stale 门')

console.log('[E6] latest-wins 替换')
const box3 = mkBox()
const rA = mkReq({ contextVersion: 5 }); const rB = mkReq({ contextVersion: 6 })
box3.offerActivation(rA, { nowStep: 20 })
const oB = box3.offerActivation(rB, { nowStep: 21 })
eq(oB.outcome, 'replaced', '更高 cv 替换旧 pending')
eq(oB.replacedContextVersion, 5, '被替换者 cv 记录=5')
eq(box3.pendingPacket.contextVersion, 6, 'pending 现为 cv=6')
const idem = box3.offerActivation(rB, { nowStep: 22 })
eq(idem.reason, 'duplicate-activation', '同 activationId 重放硬拒绝(§4 幂等=拒绝而非重收)')
eq(box3.pendingPacket.packetId, oB.packetId, 'pending 未变')
console.log('[E6] latest-wins 替换与幂等')

console.log('[E7] TTL 过期丢弃')
const box4 = mkBox()
const shortReq = mkReq({ ttlSteps: 2, contextVersion: 9 })
box4.offerActivation(shortReq, { nowStep: 200 })
const expClaim = box4.claim({ nowStep: 202, currentContextVersion: 9 })
eq(expClaim.reason, 'expired', 'nowStep≥expiresAtStep → expired 丢弃')
ok(box4.pendingPacket === null, '过期后 pending 清空')
console.log('[E7] TTL 过期')

console.log('[E8] 投递冷却')
const box5 = mkBox()
const cd1 = mkReq({ contextVersion: 12 })
box5.offerActivation(cd1, { nowStep: 300 })
const cE8 = box5.claim({ nowStep: 301, currentContextVersion: 12 })
box5.markDelivered(cE8.packet.packetId, { nowStep: 301 })
void cd1
const cd2 = mkReq({ contextVersion: 13 })
box5.offerActivation(cd2, { nowStep: 302 })
const cdClaim = box5.claim({ nowStep: 302, currentContextVersion: 13 })
eq(cdClaim.reason, 'cooldown', 'E8 投递后 2 步内 claim 冷却拒绝(cooldownRemainingSteps=' + cdClaim.cooldownRemainingSteps + ')')
const cdOk = box5.claim({ nowStep: 304, currentContextVersion: 13 })
ok(cdOk.ok, 'E8 冷却窗口过后恢复 claim')
box5.markDelivered(cd2.packetId, { nowStep: 304 })
console.log('[E8] 冷却门(拒绝+恢复)')

console.log('[E9] dispose/抑制门/A-B 零串线')
const box6 = mkBox()
const sreq = mkReq({ contextVersion: 15, records: [mkRec(memA)] })
box6.suppressMemories([memA])
eq(box6.offerActivation(sreq, { nowStep: 400 }).reason, 'suppressed-candidate', '抑制名单命中整单拒绝(correction/revoked 门)')
box6.dispose('test')
eq(box6.offerActivation(mkReq({ contextVersion: 16 }), { nowStep: 401 }).reason, 'disposed', 'dispose 后拒单')
const ra = mkBox(), rb = mkBox()
ra.offerActivation(mkReq(), { nowStep: 500 })
ok(rb.pendingPacket === null, 'A/B 实例零串线(B 无 pending)')
reg.disposeAll('end')
eq(reg.size, 0, 'registry disposeAll 清空')
console.log('[E9] dispose/抑制/隔离')

console.log('[D-hygiene] 静态卫生')
const src = await (await import('node:fs')).promises.readFile(new URL('../../lib/activation-inbox-state.js', import.meta.url), 'utf8')
ok(!/child_process|node:net|node:http|spawnSync/i.test(src), '无 spawn/net/http 引用')
ok(!/_lastAgent/.test(src), '无 _lastAgent fallback(契约 §9)')
ok(!src.includes('\uFEFF'), '无 BOM 字符')

console.log('')
console.log('M6-2 smoke: ' + pass + ' passed, ' + fail + ' failed')
if (fail > 0) process.exitCode = 1
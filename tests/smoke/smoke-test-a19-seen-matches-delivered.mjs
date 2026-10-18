#!/usr/bin/env node
/**
 * smoke-test-a19-seen-matches-delivered.mjs —— #439 守卫套件（「投递的 seen 必须 = 实际投递」）。
 *
 * 缺陷（改前实测）：packet.references 存**全部候选**（渲染器复现 exactDigest 需要），
 * 预算裁剪只在渲染层产生 dropped；而 activation-host 的 createSeenEvidences 直接遍历
 * references 建 seen ⇒ 8 候选 / 丢 3 / 渲染 5 时**建 8 条 seen**（把没进 prompt 的候选记成已投递）。
 *
 * 修复：packet 新增**可选**字段 deliveredMemoryIds（全量 − rendered.dropped 的身份）；
 * Host 只按它建 seen（旧 packet 缺字段 ⇒ 退化为全量，向后兼容）。判据同源：deliveredRefsOfPre
 * 定义在 activation-inbox.js（packet 的形状就在那里），Host 直接 import，**不写第二份**。
 *
 * 本套件同时钉住：
 *   ① 不把 deliveredMemoryIds 加进 validateReferenceTailPacketPre 的必填校验（旧 packet 必须仍合法）；
 *   ② refs 事件读数语义变为「实际投递」，候选总量另存 offeredRefs；
 *   ③ exactDigest 仍与重渲染一致（新字段不参与 digest 计算）。
 */
import { createHash } from 'node:crypto'
const A = await import('../../lib/activation-inbox.js')
const { createActivationHost } = await import('../../lib/activation-host.js')

let pass = 0; let fail = 0
const ok = (c, n, x) => { if (c) { pass++; console.log('  ok - ' + n) } else { fail++; console.error('  FAIL - ' + n + (x == null ? '' : ' << ' + x)) } }
const eq = (a, b, n) => ok(JSON.stringify(a) === JSON.stringify(b), n, 'got=' + JSON.stringify(a) + ' want=' + JSON.stringify(b))

const { CorpusRegistry, buildSourceCatalog, canonicalize } = await import('../../lib/m4-corpus.js')
const sha256 = (s) => createHash('sha256').update(String(s), 'utf8').digest('hex')
const memId = (tag) => 'mem_' + sha256('mid:' + tag).slice(0, 32)
// Host 侧 offer 会用 currentMiv(workspaceKey) 与请求里的 memoryIndexVersion 比对（stale-index 门），
// 所以假请求的 miv 必须与真实语料快照**同源**（m83 同款适配），不能硬编码。
const MIV = new CorpusRegistry().get(buildSourceCatalog({ workspaceKey: canonicalize('c:/ws-a') })).snapshot.memoryIndexVersion
function mkRec(tag, excerpt) {
  return {
    memoryId: memId(tag), anchorId: 'anc_pre_' + sha256('anc:' + tag).slice(0, 16),
    scope: 'Workspace', sourceRef: 'workspace:MEMORY.md',
    sourceEpoch: '33333333-3333-4333-8333-333333333333', sourceVersion: 1,
    fileDigest: sha256('file:' + tag), recordDigest: sha256('rec:' + tag),
    excerpt: excerpt != null ? excerpt : ('参考内容 ' + tag),
  }
}
const recsOf = (n, len) => { const r = []; for (let i = 0; i < n; i++) r.push(mkRec('r' + i, 'x'.repeat(len))); return r }
function mkReq(records, seed) {
  return A.makeFakeActivationRequestPre({
    seed: seed || 'a19-seed', sessionId: 's1', agentId: 'a1', workspaceKey: 'c:/ws-a',
    contextVersion: 7, memoryIndexVersion: MIV, records, maxItems: records.length,
    ttlSteps: 8, now: 1700000000000,
  })
}

/** 假 context-host：findProvenance 只对传入的 id 集合命中（可造「有/无 provenance」两种场景）。 */
function makeFakeContextHost(withProvFor) {
  const appended = []
  return {
    appended,
    findProvenance(workspaceKey, memoryId, recordDigest) {
      if (!withProvFor(memoryId)) return null
      void workspaceKey
      return {
        memoryId, anchorId: 'anc_' + memoryId.slice(4, 20), scope: 'Workspace',
        sourceRef: 'workspace:MEMORY.md', sourceEpoch: '33333333-3333-4333-8333-333333333333',
        sourceVersion: 1, fileDigest: sha256('f:' + memoryId), recordDigest,
      }
    },
    async appendEvidence(evs) { appended.push(...evs); return { ok: true } },
  }
}
function makeEngine() {
  return {
    config: {
      associativeMemoryEnabled: true, activationInboxEnabled: true,
      pythonBackendEnabled: true, activationSource: 'python', memoryHubEnabled: false,
    },
    runtimes: new Map(),
    runtimeFor: () => null,
    state: { ws: 'c:/ws-a' },
  }
}
/** 起 host 并让 pump 有 runtime 可挂；返回 { host, rt, engine }。 */
function makeHost(contextHost) {
  const engine = makeEngine()
  engine._contextHost = contextHost
  const rt = { key: 'k1', sessionId: 's1', agentId: 'a1', disposed: false, eventCursor: 1 }
  engine.runtimes.set('k1', rt)
  engine.runtimeFor = () => rt
  const host = createActivationHost({ engine })
  host.initCapability({ systemPrompt: { context: () => 'x' } })
  host.capturePaths(rt.key, { ws: engine.state.ws })
  return { host, rt, engine }
}
const flush = () => new Promise((r) => setTimeout(r, 60))

console.log('[A19-1] packet 新增 deliveredMemoryIds = 全量 − 预算丢弃')
{
  // 实测标定（2026-10-17）：8 条 × excerpt 440B 在 4096B 预算下丢 3 渲染 5。
  const req = mkReq(recsOf(8, 440), 'a19-budget')
  const built = A.buildReferenceTailPacketPre({ request: req, nowStep: 3 })
  ok(built.ok === true, 'A19-1a packet 构建成功')
  eq(built.droppedByBudget.length, 3, 'A19-1b 预算丢弃恰 3 条（标定值）')
  eq(built.packet.references.length, 8, 'A19-1c references 仍是**全部候选**（渲染器复现 digest 需要，未改语义）')
  eq(built.packet.deliveredMemoryIds.length, 5, 'A19-1d ★ deliveredMemoryIds 恰 5 条（= 全量 − 丢弃）')
  const droppedIds = built.droppedByBudget.map((d) => d.memoryId).sort()
  const deliveredIds = built.packet.deliveredMemoryIds.slice().sort()
  ok(droppedIds.every((id) => !deliveredIds.includes(id)), 'A19-1e ★ 丢弃身份与投递身份不相交（丢的确实不在 delivered 里）')
  eq(deliveredIds.concat(droppedIds).sort(), built.packet.references.map((r) => r.memoryId).sort(), 'A19-1f 投递 ∪ 丢弃 = 全部候选（不漏不重）')
  ok(A.validateReferenceTailPacketPre(built.packet).ok, 'A19-1g 带新字段的 packet 仍通过 M6 validator')
}

console.log('[A19-2] 正路径（真调 Host 建证据）：建的 seen 数 === 实际投递数')
{
  const req = mkReq(recsOf(8, 440), 'a19-budget-host')
  const built = A.buildReferenceTailPacketPre({ request: req, nowStep: 3 })
  const delivered = built.packet.deliveredMemoryIds
  // ★鉴别力关键：让**所有候选**都有 provenance（真实场景就该如此 —— 记录存在与「本轮是否被预算裁掉」无关）。
  //   这样「按 references 遍历」会建 8 条、按投递口径只建 5 条 ⇒ 断言对修复有真实鉴别力。
  const ch = makeFakeContextHost(() => true)
  const { host } = makeHost(ch)
  const offered = host.offerExternalActivation(req)
  ok(offered.ok === true, 'A19-2a offer 被接受（outcome=' + (offered.outcome || offered.reason) + '）')
  const text = host.renderTailFor({ id: 'a1', session: { id: 's1' } })
  ok(String(text).length > 0, 'A19-2b renderTailFor 投递非空尾注（digest 校验通过）')
  await flush()
  eq(ch.appended.length, 5, 'A19-2c ★★ 真建的 seen 证据数 === 5（改前按 references ⇒ 8）')
  eq(host._statsForTest.seenCreated, 5, 'A19-2d stats.seenCreated === 5')
  eq(host._statsForTest.seenSkippedNoProv, 0, 'A19-2e 无跳过（每条投递都有 provenance）')
  const evIds = ch.appended.map((e) => e.memoryId).sort()
  eq(evIds, delivered.slice().sort(), 'A19-2f 证据的 memoryId 恰为投递集合（逐条对齐）')
  ok(ch.appended.every((e) => e.kind === 'seen'), 'A19-2g 证据 kind=seen')
}

console.log('[A19-3] 负路径①：一条都放不下 ⇒ packet-oversize（零注入、零 seen）')
{
  // 纯核心层：极小预算 ⇒ 全部被丢 ⇒ fail closed（dropped 里如实记身份）
  const req = mkReq(recsOf(2, 300), 'a19-oversize')
  const built = A.buildReferenceTailPacketPre({ request: req, nowStep: 3, budgetBytes: 64 })
  ok(built.ok === false && built.reason === 'packet-oversize', 'A19-3a 极小预算 ⇒ packet-oversize（fail closed）')
  ok(Array.isArray(built.dropped) && built.dropped.length === 2, 'A19-3b 全丢时 dropped 如实记录 2 条身份（不静默）')
  ok(built.packet === undefined, 'A19-3b2 fail closed：packet-oversize 时**不产出 packet**（自然也没有 deliveredMemoryIds）')
  // Host 层：没有可投的 claimed 包 ⇒ 渲染空、零证据（不是「按 references 建满」）
  const ch = makeFakeContextHost(() => true)
  const { host } = makeHost(ch)
  const text = host.renderTailFor({ id: 'a1', session: { id: 's1' } })
  await flush()
  eq(String(text), '', 'A19-3c 无 claimed 包 ⇒ 渲染为空（零注入）')
  eq(ch.appended.length, 0, 'A19-3d ★ 零 seen（未投递就不得建任何证据）')
  eq(host._statsForTest.seenCreated, 0, 'A19-3e stats.seenCreated === 0')
  // 显式「全丢」形状：deliveredMemoryIds 为空数组 ⇒ seen 口径为空（区别于旧包缺字段）
  const full = A.buildReferenceTailPacketPre({ request: mkReq(recsOf(2, 300), 'a19-all'), nowStep: 3 })
  const allDropped = JSON.parse(JSON.stringify(full.packet))
  allDropped.deliveredMemoryIds = []
  eq(A.deliveredRefsOfPre(allDropped).length, 0, 'A19-3f 全丢形状（空 deliveredMemoryIds）⇒ 投递口径为空')
  eq(A.deliveredRefsOfPre(full.packet).length, 2, 'A19-3g 对照：正常包投递口径为 2（判据有鉴别力）')
}

console.log('[A19-4] 负路径②：无 provenance 时 seenSkippedNoProv 只按 delivered 累加')
{
  const req = mkReq(recsOf(8, 440), 'a19-noprov')
  const built = A.buildReferenceTailPacketPre({ request: req, nowStep: 3 })
  const delivered = built.packet.deliveredMemoryIds
  // 只有前 2 条投递有 provenance ⇒ 期望 created=2、skipped=3（delivered 5 - 2），而不是 8/6
  const ch = makeFakeContextHost((id) => delivered.slice(0, 2).includes(id))
  const { host } = makeHost(ch)
  ok(host.offerExternalActivation(req).ok === true, 'A19-4a offer 被接受')
  const text = host.renderTailFor({ id: 'a1', session: { id: 's1' } })
  await flush()
  ok(String(text).length > 0, 'A19-4b 投递非空')
  eq(ch.appended.length, 2, 'A19-4c 有 provenance 的 2 条建了证据')
  eq(host._statsForTest.seenCreated, 2, 'A19-4d stats.seenCreated === 2')
  eq(host._statsForTest.seenSkippedNoProv, 3, 'A19-4e ★ seenSkippedNoProv === 3（按 delivered 5 计，改前按 8 计 ⇒ 6）')
  eq(ch.appended.length + host._statsForTest.seenSkippedNoProv, delivered.length, 'A19-4f 建证据 + 跳过 = 实际投递数（守恒）')
}

console.log('[A19-5] 负路径③：旧 packet 无 deliveredMemoryIds ⇒ 退化为全量、不抛')
{
  // 用真实 builder 造一个**完全合法**的 packet，再删掉新字段 ⇒ 精确模拟「旧版本产出的在途包」
  const built0 = A.buildReferenceTailPacketPre({ request: mkReq([mkRec('old1', '旧包引用一'), mkRec('old2', '旧包引用二')], 'a19-legacy'), nowStep: 3 })
  ok(built0.ok === true, 'A19-5a0 先造一个合法新包')
  const legacyPacket = JSON.parse(JSON.stringify(built0.packet))
  delete legacyPacket.deliveredMemoryIds
  const items = legacyPacket.references
  ok(legacyPacket.deliveredMemoryIds === undefined, 'A19-5a 前提：旧 packet 确实没有新字段')
  ok(A.validateReferenceTailPacketPre(legacyPacket).ok, 'A19-5b ★ 旧 packet 仍通过 validator（新字段**未**加进必填）')
  eq(A.deliveredRefsOfPre(legacyPacket).length, 2, 'A19-5c ★ 缺字段 ⇒ 退化为全量 references（不抛）')
  eq(A.deliveredRefsOfPre({ references: items, deliveredMemoryIds: [] }).length, 0, 'A19-5d 显式空数组 ⇒ 零投递（不是「缺失」）')
  eq(A.deliveredRefsOfPre(null), [], 'A19-5e 空 packet ⇒ 空数组（不抛）')
  eq(A.deliveredRefsOfPre(legacyPacket).map((r) => r.memoryId).sort(), legacyPacket.references.map((r) => r.memoryId).sort(),
    'A19-5f ★ 旧 packet 的投递口径 = 全量候选（退化语义与 references 逐条相同）')
}

console.log('[A19-6] 负路径④：exactDigest 仍与重渲染一致（新字段不参与 digest）')
{
  const req = mkReq(recsOf(8, 440), 'a19-digest')
  const built = A.buildReferenceTailPacketPre({ request: req, nowStep: 3 })
  const re = A.renderReferenceTail(built.packet.references, {
    reason: built.packet.triggerReason, budgetBytes: A.REFERENCE_TAIL_BUDGET_PRE_V1.maxPacketBytes, skill: built.packet.skill,
  })
  eq(re.text, built.rendered, 'A19-6a 重渲染文本逐字节一致')
  eq(A.computeExactDigest(re.text), built.packet.exactDigest, 'A19-6b ★ exactDigest 校验通过')
  const strip = JSON.parse(JSON.stringify(built.packet))
  delete strip.deliveredMemoryIds
  eq(A.buildPacketId(strip.activationId, strip.contextVersion, strip.memoryIndexVersion, strip.exactDigest), built.packet.packetId,
    'A19-6c packetId 不受新字段影响（身份四元组未变）')
}

console.log('[A19-7] 语义变化可见：render 事件 refs 变成「投递数」并另带 offeredRefs')
{
  const req = mkReq(recsOf(8, 440), 'a19-events')
  const built = A.buildReferenceTailPacketPre({ request: req, nowStep: 3 })
  const ch = makeFakeContextHost((id) => built.packet.deliveredMemoryIds.includes(id))
  const { host } = makeHost(ch)
  ok(host.offerExternalActivation(req).ok === true, 'A19-7a offer 被接受')
  host.renderTailFor({ id: 'a1', session: { id: 's1' } })
  await flush()
  const ev = host.debugView().recentEvents.filter((e) => e.kind === 'render').pop()
  ok(!!ev, 'A19-7b 找得到 render 事件')
  eq(ev.refs, 5, 'A19-7c ★ refs === 5（实际投递；改前为 8）')
  eq(ev.offeredRefs, 8, 'A19-7d offeredRefs === 8（候选总量，语义变化显式可见）')
}

console.log('\n[A19] ' + pass + ' passed, ' + fail + ' failed')
// 硬退出：Host 里挂着的 runtime/定时器不应参与退出码判定（避免残留句柄挂住进程）。
process.exit(fail ? 1 : 0)

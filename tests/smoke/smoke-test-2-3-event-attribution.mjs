#!/usr/bin/env node
/**
 * smoke-test-2-3-event-attribution.mjs —— 2.3 事件归属建议与异常提醒（event-attribution/v1）专项验收
 *
 * 被测面（全部真执行；静态断言一律标注「守卫」，不冒充功能证据）：
 *   · event-attribution/v1 协议形状与不变量
 *   · 触发条件矩阵（显式 ID 不调用 / 弱证据调用 / dryRun 调用 / 不可用降级）
 *   · 候选池 **显式截断**（eligible/visible/omitted/coverage 四件套 + 守恒）
 *   · parser 的 **fail-closed**（未知 ID / 非法 decision / 空输出）
 *   · receipt 不伪称「已按模型修正」
 *   · 历史零写提案 **不调 apply / 不发 token**
 *   · memory_note review-only：所有记忆文件字节不变
 *
 * 纪律（CR-10）：真 import → 真构造 → 真调用 → 断言返回值/副作用；每条正向都配负路径。
 *
 * 变异：只在**内存里的源码字符串**上做，不写工作区文件；每条先断言锚串恰命中 1 次。
 */
import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL, fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'

const REPO = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
let pass = 0, fail = 0
function ok(c, n, d) { if (c) { pass++; console.log('PASS ' + n + (d ? '  =>  ' + d : '')) } else { fail++; console.log('FAIL ' + n + (d ? '  =>  ' + d : '')) } }

// ═══════════ 0. 真 import ═══════════
const EA = await import(pathToFileURL(path.join(REPO, 'lib/event-attribution/index.js')).href)
ok(typeof EA.createEventAttributionService === 'function', '[import] createEventAttributionService 是函数')
const svc = EA.createEventAttributionService({})
ok(svc && typeof svc.review === 'function' && typeof svc.reviewExplicit === 'function'
  && typeof svc.proposeRegroup === 'function' && typeof svc.renderReceipt === 'function'
  && typeof svc.appendReceipt === 'function', '[import] facade 暴露 5 个方法 + profile')
ok(svc.profile && svc.profile.schemaVersion === 'event-attribution/v1', '[import] profile.schemaVersion')
// 公共导出形状冻结
const apiKeys = Object.keys(EA.PUBLIC_API)
let shapeBad = 0
for (const [k, t] of Object.entries(EA.PUBLIC_API)) if (typeof EA[k] !== t) shapeBad++
ok(shapeBad === 0, '[import] PUBLIC_API 形状全部吻合（守卫，非功能证据）', apiKeys.length + ' 键 / 不符 ' + shapeBad)

// ═══════════ 1. 协议不变量（真调用 validateProposalInvariants）═══════════
const good = EA.buildProposal({
  trigger: 'unassigned', decision: 'attach-existing', selectedEventId: 'evt_a',
  candidates: [{ eventId: 'evt_a', score: 0.9, margin: 0.1, evidence: ['x'] }],
  pool: { eligibleCount: 1, visibleCount: 1, omittedCount: 0, coverage: 'complete' },
})
ok(EA.validateProposalInvariants(good).length === 0, 'T1 合法 proposal 无违规', JSON.stringify(EA.validateProposalInvariants(good)))
// 负路径：attach 但 selectedEventId 不在候选内
const badSel = EA.buildProposal({ decision: 'attach-existing', selectedEventId: 'evt_zzz', candidates: [{ eventId: 'evt_a' }], pool: { eligibleCount: 1, visibleCount: 1, omittedCount: 0 } })
ok(EA.validateProposalInvariants(badSel).some((s) => s.includes('不在候选集内')), 'N1 负路径：selectedEventId 不在候选内被拒')
// 负路径：ambiguous 强行择一
const badAmb = EA.buildProposal({ decision: 'ambiguous', selectedEventId: 'evt_a', candidates: [{ eventId: 'evt_a' }], pool: { eligibleCount: 1, visibleCount: 1, omittedCount: 0 } })
ok(EA.validateProposalInvariants(badAmb).some((s) => s.includes('不得强行择一')), 'N2 负路径：ambiguous 带 selectedEventId 被拒')
// ★不变量：omitted>0 必为 partial（禁止静默截断）
const trunc = EA.buildProposal({ decision: 'create-new', candidates: [], pool: { eligibleCount: 50, visibleCount: 12, omittedCount: 38, coverage: 'complete' } })
ok(trunc.pool.coverage === 'partial' && trunc.pool.truncated === true, '★T2 截断强制 coverage=partial（即使调用方写 complete）', JSON.stringify(trunc.pool))
ok(EA.validateProposalInvariants(trunc).length === 0, 'T2b 截断 proposal 自身合法（visible+omitted=eligible）')
// 负路径：候选池不守恒
const badPool = Object.assign({}, trunc, { pool: Object.assign({}, trunc.pool, { visibleCount: 10 }) })
ok(EA.validateProposalInvariants(badPool).some((s) => s.includes('守恒失败')), 'N3 负路径：可见+省略≠eligible 被拒')

// ═══════════ 2. candidate-pool：预算截断必须显式 ═══════════
const mkEv = (i, over) => Object.assign({
  id: 'evt_' + String(i).padStart(3, '0'), status: 'active', createdAt: 1000 + i,
  updatedAt: 2000 + i, name: 'E' + i, summary: 'S' + i, checkpoints: [],
}, over || {})
const evs40 = Array.from({ length: 40 }, (_, i) => mkEv(i))
const pr = EA.buildCandidatePoolPre({ events: evs40, at: 999999, maxCandidates: 12 })
ok(pr.pool.eligibleCount === 40, 'T3 池 eligible = 40', pr.pool.eligibleCount)
ok(pr.pool.visibleCount === 12 && pr.pool.omittedCount === 28, '★T4 12 可见 / 28 省略（显式不静默）')
ok(pr.pool.truncated === true && pr.pool.coverage === 'partial', '★T5 truncated=true & coverage=partial')
ok(pr.pool.visibleCount + pr.pool.omittedCount === pr.pool.eligibleCount, 'T6 池守恒 visible+omitted=eligible')
// LOOCA：未来事件 / closed / 自身 必须被排除
const mixed = [
  mkEv(1), mkEv(2, { status: 'closed' }), mkEv(3, { createdAt: 5000000 }),
  mkEv(4, { id: 'evt_self' }),
]
const pr2 = EA.buildCandidatePoolPre({ events: mixed, at: 10000, excludeEventId: 'evt_self', maxCandidates: 12 })
const visIds = pr2.visible.map((c) => c.eventId)
ok(visIds.length === 1 && visIds[0] === 'evt_001', '★T7 LOOCA：只保留 active+非未来+非自身', JSON.stringify(visIds))
ok(pr2.pool.excluded.some((x) => x.reason === 'closed'), 'T7b closed 被排除并记原因')
ok(pr2.pool.excluded.some((x) => x.reason === 'future'), 'T7c future 被排除并记原因')
ok(pr2.pool.excluded.some((x) => x.reason === 'self'), 'T7d self 被排除并记原因')

// ═══════════ 3. parser fail-closed ═══════════
const allow = ['evt_001', 'evt_002']
ok(EA.parseModelOutputPre('{"decision":"attach-existing","selectedEventId":"evt_001"}', allow).ok === true, 'T8 合法 attach 通过')
const badFuture = EA.parseModelOutputPre('{"decision":"attach-existing","selectedEventId":"evt_999"}', allow)
ok(badFuture.ok === false && badFuture.code === 'invalid-event-id', '★N4 负路径：未知 ID fail-closed', badFuture.code)
const badDec = EA.parseModelOutputPre('{"decision":"auto-attach","selectedEventId":"evt_001"}', allow)
ok(badDec.ok === false && badDec.code === 'bad-decision', '★N5 负路径：非法 decision fail-closed', badDec.code)
ok(EA.parseModelOutputPre('', allow).ok === false, '★N6 负路径：空输出不可用')
ok(EA.parseModelOutputPre('not json at all', allow).ok === false, '★N7 负路径：非 JSON 不可用')
const ambParsed = EA.parseModelOutputPre('{"decision":"ambiguous","selectedEventId":"evt_001"}', allow)
ok(ambParsed.ok && ambParsed.selectedEventId === null, '★T9 ambiguous 强制 selectedEventId=null（不冒充确定）')
// 容忍代码块
const fenced = '\u0060\u0060\u0060json\n{"decision":"create-new"}\n\u0060\u0060\u0060'
ok(EA.parseModelOutputPre(fenced, allow).decision === 'create-new', 'T10 容忍 markdown 代码块')

// ═══════════ 4. 触发矩阵（decideTriggerPre）═══════════
const T = EA.decideTriggerPre
ok(T({ explicitEventId: 'evt_x', dryRun: false }).needed === false, '★T11 显式 eventId 真实写入 ⇒ 不调用模型')
ok(T({ dryRun: true }).needed === true, 'T12 dryRun ⇒ 调用')
ok(T({ dryRun: true, explicitEventId: 'evt_x' }).needed === true, 'T13 dryRun+显式 ID ⇒ 仍调用（预检）')
ok(T({ attrDecision: 'create' }).needed === true, 'T14 预判 create ⇒ 调用（未归属）')
ok(T({ attrDecision: 'attach', attrReason: 'wordbag' }).needed === true, '★T15 词袋 attach ⇒ 调用（弱证据）')
ok(T({ attrDecision: 'attach', attrReason: 'legacy' }).needed === true, 'T16 legacy attach ⇒ 调用')
ok(T({ attrDecision: 'attach', attrReason: 'identifier', identifierHits: 1 }).needed === false, '★T17 高置信单标识 ⇒ 不调用（不烧模型）')
ok(T({ attrDecision: 'attach', attrReason: 'identifier', identifierHits: 2 }).needed === true, '★T18 标识多命中 ⇒ 调用')
ok(T({ attrDecision: 'attach', attrReason: 'identifier', identifierHits: 1, conflict: true }).needed === true, 'T19 证据冲突 ⇒ 调用')

// ═══════════ 5. reviewer：模型不可用的降级（绝不 fail-open）═══════════
const eventsForReview = Array.from({ length: 20 }, (_, i) => mkEv(i))
// 5a 未注入 modelPort
const pUnavail = await svc.review({ record: { text: '某条未归属记录', at: 9000 }, events: eventsForReview, attrDecision: 'create' })
ok(pUnavail.decision === 'unavailable', '★T20 无 modelPort ⇒ unavailable')
ok(pUnavail.decision !== 'create-new', '★★T21 unavailable **不等于** create-new（禁止 fail-open）')
ok(pUnavail.pool.eligibleCount === 20 && pUnavail.pool.omittedCount === 8, 'T22 降级时仍给出池元数据（20/12/8）', JSON.stringify(pUnavail.pool))
// 5b 模型返回空串
const svcEmpty = EA.createEventAttributionService({ modelPort: { call: async () => '' } })
const pEmpty = await svcEmpty.review({ record: { text: 'x', at: 9000 }, events: eventsForReview, attrDecision: 'create' })
ok(pEmpty.decision === 'unavailable', '★T23 空串 ⇒ unavailable（不是 create-new）')
ok(pEmpty.warnings.some((w) => w.code === 'model-unparseable'), 'T23b 空串记为 model-unparseable')
// 5c 模型抛错
const svcThrow = EA.createEventAttributionService({ modelPort: { call: async () => { throw new Error('boom') } } })
const pThrow = await svcThrow.review({ record: { text: 'x', at: 9000 }, events: eventsForReview, attrDecision: 'create' })
ok(pThrow.decision === 'unavailable', '★T24 抛错 ⇒ unavailable')
// 5d 模型返回非法 ID ⇒ fail-closed
const svcBadId = EA.createEventAttributionService({ modelPort: { call: async () => '{"decision":"attach-existing","selectedEventId":"evt_ghost"}' } })
const pBadId = await svcBadId.review({ record: { text: 'x', at: 9000 }, events: eventsForReview, attrDecision: 'create' })
ok(pBadId.decision === 'unavailable', '★T25 模型幻觉 ID ⇒ unavailable（不采纳、不猜）')
// 5e ★真实发现：候选池被截断时，「被截掉的合法事件」会被 fail-closed 拒掉 —— 安全但信息有损
const svcTruncPick = EA.createEventAttributionService({ modelPort: { call: async () => '{"decision":"attach-existing","selectedEventId":"evt_001"}' } })
const pTruncPick = await svcTruncPick.review({ record: { text: 'x', at: 9000 }, events: eventsForReview, attrDecision: 'create' })
ok(pTruncPick.decision === 'unavailable', '★★T25b 模型选中「被截断掉的合法事件」⇒ fail-closed（安全优先，但信息有损）', 'pool 12/20')
ok(pTruncPick.pool.omittedCount === 8, 'T25c 且池元数据如实标出 omitted=8（可解释为何拒绝）')
// 5f 池未截断时，同一模型输出必须被采纳
const fewEvents = Array.from({ length: 5 }, (_, i) => mkEv(i))
const svcOk = EA.createEventAttributionService({ modelPort: { call: async () => '{"decision":"attach-existing","selectedEventId":"evt_001","rationale":"同一件","counterHypothesis":"可能不是"}' } })
const pOk = await svcOk.review({ record: { text: 'x', at: 9000 }, events: fewEvents, attrDecision: 'create' })
ok(pOk.decision === 'attach-existing' && pOk.selectedEventId === 'evt_001', 'T26 合法 attach 被采纳')
ok(pOk.modelIdentity.promptSha256.length === 64, 'T27 promptSha256 为 64 位', pOk.modelIdentity.promptSha256.slice(0, 16))
ok(pOk.modelIdentity.resolvedProvider === null && pOk.modelIdentity.resolvedModel === null, '★T28 resolved* 不猜测（null）')
// prompt 确定性
const p1 = await svcOk.review({ record: { text: 'same', at: 9000 }, events: fewEvents, attrDecision: 'create' })
const p2 = await svcOk.review({ record: { text: 'same', at: 9000 }, events: fewEvents, attrDecision: 'create' })
ok(p1.modelIdentity.promptSha256 === p2.modelIdentity.promptSha256, '★T29 同一输入 ⇒ 同一 promptSha256（确定性）')

// ═══════════ 6. 疑似错误归属告警 ═══════════
const svcDis = EA.createEventAttributionService({ modelPort: { call: async () => '{"decision":"create-new"}' } })
const pDis = await svcDis.review({ record: { text: 'x', at: 9000 }, events: fewEvents, attrDecision: 'attach', attrReason: 'wordbag', attrEventId: 'evt_001' })
ok(pDis.warnings.some((w) => w.code === 'suspect-auto-attach'), '★T30 既有 attach 被模型否决 ⇒ suspect-auto-attach')

// ═══════════ 7. receipt：不伪称「已按模型修正」═══════════
const rDis = svcDis.renderReceipt(pDis, { actualDecision: 'attach', actualEventId: 'evt_001' })
ok(rDis.includes('疑似错误归属'), '★T31 回执含「疑似错误归属」')
ok(rDis.includes('未改写'), '★★T32 回执明确「未改写」（不得伪称已按模型修正）', rDis.slice(0, 160))
ok(!rDis.includes('已按建议改为'), '★N8 负路径：回执不含「已按建议改为」')
// 同意时不吵
const pAgree = Object.assign({}, pOk)
const rAgree = svcOk.renderReceipt(pAgree, { actualDecision: 'attach', actualEventId: 'evt_001' })
ok(rAgree === '', '★T33 模型同意 ⇒ 回执为空（不制造噪声）', JSON.stringify(rAgree.slice(0, 60)))
// 截断必须写进回执
const rTrunc = svcOk.renderReceipt(Object.assign({}, pOk, { pool: trunc.pool, warnings: [{ code: 'pool-truncated', message: 'x', eventIds: [] }] }), { actualDecision: 'create' })
ok(rTrunc.includes('候选池不完整'), '★T34 截断写进回执（不静默）', rTrunc.slice(0, 120))
// unavailable 回执必须说清不等于新建
const rUn = svc.renderReceipt(pUnavail, { actualDecision: 'create' })
ok(rUn.includes('不可用') && rUn.includes('模型未给出任何归属意见'), '★T35 unavailable 回执说清「≠建议新建」')
// appendReceipt 保留原文
const appended = svc.appendReceipt('原文本', pDis, { actualDecision: 'attach', actualEventId: 'evt_001' })
ok(appended.startsWith('原文本'), '★T36 appendReceipt 原文本逐字在前')
ok(svc.appendReceipt('原文本', pAgree, { actualDecision: 'attach', actualEventId: 'evt_001' }) === '原文本', 'T37 空回执时原文本不变')

// ═══════════ 8. memory_note 只读复核：not-applicable 不硬编事件 ═══════════
const pNa = await svc.reviewExplicit({ kind: 'note', events: eventsForReview, record: { text: 'x', at: 9000 } })
ok(pNa.decision === 'not-applicable', '★T38 kind=note 无 eventId ⇒ not-applicable（不硬编事件）')
const pNa2 = await svc.reviewExplicit({ kind: 'plan', events: eventsForReview, record: { text: 'x', at: 9000 } })
ok(pNa2.decision === 'not-applicable', 'T38b kind=plan ⇒ not-applicable')

// ═══════════ 9. 历史零写提案：不调 apply / 不发 token ═══════════
ok(Array.isArray(EA.FORBIDDEN_APPLY_METHODS) && EA.FORBIDDEN_APPLY_METHODS.length === 4, 'T39 FORBIDDEN_APPLY_METHODS 冻结')
// 用带哨兵的 engine 验证「调用 0 次」
const sentinel = { applyRegroupPre: 0, writeCuratedEventsPre: 0, applyRegroup: 0, curateUnarchivedPre: 0 }
const fakeEngine = {
  applyRegroupPre() { sentinel.applyRegroupPre++ },
  writeCuratedEventsPre() { sentinel.writeCuratedEventsPre++ },
  applyRegroup() { sentinel.applyRegroup++ },
  curateUnarchivedPre() { sentinel.curateUnarchivedPre++ },
  _curateToken: null,
}
const groups = [{ candidateId: 'c1', memberCount: 3, goalKey: '目标A' }, { candidateId: 'c2', memberCount: 1, goalKey: '目标B' }]
const pDry = await svc.proposeRegroup({ groups, batchLedgerNames: ['a.md', 'b.md'], prompt: 'PROMPT', dryRun: true })
ok(pDry.trigger === 'historical-regroup', 'T40 dryRun 提案 trigger 正确')
ok(pDry.rationale.includes('未启动子代理'), '★T41 dryRun 不启动子代理（只回预览）')
ok(pDry.candidates.length === 2, 'T42 机械建议映射为候选', JSON.stringify(pDry.candidates.map((c) => c.eventId)))
// 非 dryRun 但模型不可用 ⇒ 保留机械建议
const pNoModel = await svc.proposeRegroup({ groups, batchLedgerNames: ['a.md'], prompt: 'PROMPT' })
ok(pNoModel.decision === 'unavailable' && pNoModel.candidates.length === 2, 'T43 模型不可用 ⇒ 保留机械建议')
// 哨兵：以上全部路径 apply/write/token 计数必须为 0
const totalCalls = Object.values(sentinel).reduce((a, b) => a + b, 0)
ok(totalCalls === 0, '★★T44 历史提案路径 apply/write/token 调用 **0 次**', JSON.stringify(sentinel))
ok(fakeEngine._curateToken === null, '★★T45 未签发确认令牌（_curateToken 未被写入）')

// ═══════════ 10. memory_note review 零写：真实文件字节不变 ═══════════
const SANDBOX = path.join(REPO, '.tmp-smoke-run/ea23')
fs.rmSync(SANDBOX, { recursive: true, force: true })
fs.mkdirSync(SANDBOX, { recursive: true })
const memFile = path.join(SANDBOX, 'MEMORY.md')
fs.writeFileSync(memFile, '# 项目笔记\n\n原文\n', 'utf8')
const beforeHash = createHash('sha256').update(fs.readFileSync(memFile)).digest('hex')
await svc.reviewExplicit({ kind: 'handoff', eventId: 'evt_001', events: eventsForReview, record: { text: 'review only', at: 9000 } })
const afterHash = createHash('sha256').update(fs.readFileSync(memFile)).digest('hex')
ok(beforeHash === afterHash, '★★T46 review 只读：记忆文件 sha256 前后相同', beforeHash.slice(0, 16))

// ═══════════ 11. 变异（只在内存字符串上，不写工作区）═══════════
function mutate(src, anchor, repl) {
  const hits = src.split(anchor).length - 1
  if (hits !== 1) return { ok: false, why: 'anchor hits=' + hits }
  return { ok: true, src: src.replace(anchor, repl) }
}
const contractSrc = fs.readFileSync(path.join(REPO, 'lib/event-attribution/contract.js'), 'utf8')
const parserSrc = fs.readFileSync(path.join(REPO, 'lib/event-attribution/parser.js'), 'utf8')
const receiptSrc = fs.readFileSync(path.join(REPO, 'lib/event-attribution/receipt.js'), 'utf8')
const poolSrc = fs.readFileSync(path.join(REPO, 'lib/event-attribution/candidate-pool.js'), 'utf8')

// ★变异副本必须**保持真实目录层级**：模块间是相对 import（regroup.js 依赖 ../event-regroup-propose.js），
//   只复制一个文件或压平目录都会 ERR_MODULE_NOT_FOUND。
const MUTROOT = path.join(SANDBOX, 'mutsrc')
const MUTDIR = path.join(MUTROOT, 'lib/event-attribution')
function prepMutDir() {
  fs.rmSync(MUTROOT, { recursive: true, force: true })
  fs.mkdirSync(MUTDIR, { recursive: true })
  const srcDir = path.join(REPO, 'lib/event-attribution')
  for (const f of fs.readdirSync(srcDir)) {
    if (f.endsWith('.js')) fs.copyFileSync(path.join(srcDir, f), path.join(MUTDIR, f))
  }
  // 同级依赖（regroup.js 复用 R3 的严格校验）
  fs.copyFileSync(path.join(REPO, 'lib/event-regroup-propose.js'), path.join(MUTROOT, 'lib/event-regroup-propose.js'))
  fs.copyFileSync(path.join(REPO, 'lib/event-regroup.js'), path.join(MUTROOT, 'lib/event-regroup.js'))
}
prepMutDir()
// ★每个变异用**独立目录**：ESM 依赖图会按被 import 的模块 URL 缓存，
//   在同一目录连续改不同文件时，index.js 的传递依赖仍命中旧缓存 ⇒ 变异体根本没生效（实测 4/5 MISSED 就是这么来的）。
let mutSeq = 0
async function importMutated(fileName, src) {
  const dir = path.join(SANDBOX, 'mut-' + (++mutSeq))
  const sub = path.join(dir, 'lib/event-attribution')
  fs.mkdirSync(sub, { recursive: true })
  const srcDir = path.join(REPO, 'lib/event-attribution')
  for (const f of fs.readdirSync(srcDir)) {
    if (f.endsWith('.js')) fs.copyFileSync(path.join(srcDir, f), path.join(sub, f))
  }
  fs.copyFileSync(path.join(REPO, 'lib/event-regroup-propose.js'), path.join(dir, 'lib/event-regroup-propose.js'))
  fs.copyFileSync(path.join(REPO, 'lib/event-regroup.js'), path.join(dir, 'lib/event-regroup.js'))
  fs.writeFileSync(path.join(sub, fileName), src, 'utf8')
  return await import(pathToFileURL(path.join(sub, 'index.js')).href)
}
let caught = 0, missed = 0
// M1：删掉「截断强制 partial」⇒ 静默截断必须被抓住
const m1 = mutate(contractSrc, 'if (omittedCount > 0) coverage = COVERAGES.PARTIAL', 'if (false) coverage = COVERAGES.PARTIAL')
if (m1.ok) {
  const mod = await importMutated('contract.js', m1.src)
  const t = mod.buildProposal({ decision: 'create-new', candidates: [], pool: { eligibleCount: 50, visibleCount: 12, omittedCount: 38, coverage: 'complete' } })
  const bad = mod.validateProposalInvariants(t).length > 0 || t.pool.coverage !== 'partial'
  if (bad) { caught++; console.log('PASS M1 删除「截断强制 partial」被捕获') } else { missed++; console.log('FAIL M1 静默截断未被捕获') }
} else { console.log('SKIP M1 ' + m1.why) }
// M2：删掉 eventId 白名单检查 ⇒ 幻觉 ID 被采纳必须被抓住
const m2 = mutate(parserSrc, "if (!allowed.has(selected)) {", "if (false) {")
if (m2.ok) {
  const mod = await importMutated('parser.js', m2.src)
  const r = mod.parseModelOutputPre('{"decision":"attach-existing","selectedEventId":"evt_ghost"}', ['evt_001'])
  if (r.ok === true) { caught++; console.log('PASS M2 删除 ID 白名单被捕获（幻觉 ID 会被采纳）') } else { missed++; console.log('FAIL M2 白名单变异未被捕获') }
} else { console.log('SKIP M2 ' + m2.why) }
// M3：删掉「未改写」这句 ⇒ 回执就会伪称已按模型修正，必须被抓住
//   ★上一版变异删的是 unavailable 分支，但 DECISION_CN 表里仍有中文名 ⇒ 渲染文本仍含「不可用」⇒ 变异体无效。
//     这里换成**有区分力**的变异点（实测确认：原型含「未改写」，变异体不含）。
const m3 = mutate(receiptSrc, "'；模型建议的是另一个处置，**未改写**本次写入。'", "'；模型建议的是另一个处置。'")
if (m3.ok) {
  const mod = await importMutated('receipt.js', m3.src)
  const t = mod.renderReceiptPre(
    { decision: 'create-new', candidates: [], warnings: [{ code: 'suspect-auto-attach', message: 'x', eventIds: [] }], pool: {} },
    { actualDecision: 'attach', actualEventId: 'evt_001' })
  if (!t.includes('未改写')) { caught++; console.log('PASS M3 删除「未改写」被捕获（回执会伪称已按模型修正）') } else { missed++; console.log('FAIL M3 未改写 变异未被捕获') }
} else { console.log('SKIP M3 ' + m3.why) }
// M4：删掉 LOOCA 的 future 排除 ⇒ 未来事件混入必须被抓住
const m4 = mutate(poolSrc, "if (Number.isFinite(created) && Number.isFinite(at) && created > at) return { ok: false, reason: 'future' }", "if (false) return { ok: false, reason: 'future' }")
if (m4.ok) {
  const mod = await importMutated('candidate-pool.js', m4.src)
  const t = mod.buildCandidatePoolPre({ events: [{ id: 'e1', status: 'active', createdAt: 5000000, updatedAt: 1 }], at: 1000, maxCandidates: 5 })
  if (t.visible.length !== 0) { caught++; console.log('PASS M4 删除 future 排除被捕获（未来事件会混入）') } else { missed++; console.log('FAIL M4 future 变异未被捕获') }
} else { console.log('SKIP M4 ' + m4.why) }
// M5：删掉「ambiguous 不得择一」⇒ 必须被抓住
const m5 = mutate(contractSrc, 'if (p.decision === DECISIONS.AMBIGUOUS && p.selectedEventId) {', 'if (false) {')
if (m5.ok) {
  const mod = await importMutated('contract.js', m5.src)
  const t = mod.buildProposal({ decision: 'ambiguous', selectedEventId: null, candidates: [] })
  const forced = Object.assign({}, t, { selectedEventId: 'evt_a', candidates: [{ eventId: 'evt_a', score: null, margin: null, evidence: [] }] })
  if (mod.validateProposalInvariants(forced).length === 0) { caught++; console.log('PASS M5 删除「ambiguous 不得择一」被捕获') } else { missed++; console.log('FAIL M5 ambiguous 变异未被捕获') }
} else { console.log('SKIP M5 ' + m5.why) }

ok(caught === 5 && missed === 0, '★★变异汇总：' + caught + ' CAUGHT / ' + missed + ' MISSED', caught + '/' + (caught + missed))
fs.rmSync(SANDBOX, { recursive: true, force: true })

console.log('\n── 2.3 event-attribution 专项：' + pass + ' PASS / ' + fail + ' FAIL ──')
if (fail > 0) process.exit(1)

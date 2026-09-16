/**
 * 冒烟套件：T0-2 版本校验 —— 命中投影**不得只凭时间复用**（2026-09-14 · P0）。
 *
 * 病灶（读码确认，非推测）：`lib/index.js` 原实现（本套件建立时已修）是
 *   const fresh = !!gh && Date.now() - (Number(gh.at) || 0) < 30 * 60000
 *   const sameSession = !agentSessionId || !gh || !gh.sessionId || String(gh.sessionId) === agentSessionId
 * 两个缺陷：
 *   ① **只查时间不查版本** ⇒ A 快照产生的候选到 B 快照才准备输出时，A 的正文会进 B 的注入
 *      （违反契约 I6：三层必须同一 miv，混版视为错误）；
 *   ② 身份取不到时 **fail open**（`!agentSessionId` 直接算通过）⇒ 会拿别的会话的候选当本轮的用。
 *
 * 判据方向：断言**期望行为**（不复用 = 不下探 Tier-1 = 省 token 的安全侧；复用必须五项版本全同）。
 *
 * 只读、零依赖、不联网、不启宿主。
 */
import { readFileSync } from 'node:fs'
import {
  buildTier0CatalogFromTextPre,
} from '../../lib/tier0-catalog.js'
import {
  selectReusableTierHitsPre,
  describeReuseReasonPre,
  composeTieredInjectionPre,
  TIER_HITS_REUSE_REASONS_V1,
} from '../../lib/tier-layer-inject.js'

let pass = 0, fail = 0
const ok = (cond, name) => { if (cond) { pass++; console.log('  ok   - ' + name) } else { fail++; console.error('  RED  - ' + name) } }
const eq = (got, want, name) => ok(got === want, name + ' got=' + JSON.stringify(got) + ' want=' + JSON.stringify(want))

const CV = 7
const MIV = 'idx_' + 'a'.repeat(32)
const SID = 'sess-A'
const WS = 'D:\\ws-a'
const OBS = 'obs_' + 'b'.repeat(32)
const NOW = 1757000000000

/** 一个"完全合法"的投影基准；各用例只改要考的字段。 */
const proj = (over = {}) => ({
  sessionId: SID, agentId: 'ag-1', workspaceKey: WS, at: NOW, question: '为什么',
  contextVersion: CV, miv: MIV, observationId: OBS, requestKey: 'req-1',
  hits: [{ memoryId: 'mem_' + 'a'.repeat(32), score: 0.9, excerpt: '摘要', layer: 'log', status: 'current' }],
  ...over,
})
const call = (over = {}, projOver = {}) => selectReusableTierHitsPre({
  projection: proj(projOver), now: NOW + 1000,
  sessionId: SID, workspaceKey: WS, contextVersion: CV, miv: MIV,
  ...over,
})

// ─────────────────────────────────────────────────────────────
console.log('[T0-2-1] 正常路径：五项版本全同 → 复用')
{
  const r = call()
  ok(r.reuse === true, '全同 → 复用')
  eq(r.reason, 'ok', '原因码 ok')
  eq(r.hits.length, 1, '候选随复用带出')
  eq(r.question, '为什么', 'query 随复用带出（决定闸门档位）')
  eq(r.snapshot.miv, MIV, '复用账里带着 miv（可审计）')
  eq(r.snapshot.observationId, OBS, '复用账里带着 observationId')
}

// ─────────────────────────────────────────────────────────────
console.log('[T0-2-2] ★核心场景：A 快照产生候选、B 快照准备输出 ⇒ 必须不复用（混装即失败）')
{
  // A 的 contextVersion = 7 产生候选；到 B 时当前 cv 已推进到 8
  const r = call({ contextVersion: CV + 1 })
  ok(r.reuse === false, 'A 候选不得用于 B（cv 已推进）')
  eq(r.reason, 'context-version-changed', '原因码指明是上下文版本变化')
  eq(r.hits.length, 0, '不复用时候选为空（不是"带出来但不用"）')

  // 同上，但走 miv 变化（换了快照）
  const r2 = call({ miv: 'idx_' + 'c'.repeat(32) })
  ok(r2.reuse === false, 'A 候选不得用于 B（miv 已变）')
  eq(r2.reason, 'miv-changed', '原因码指明是索引版本变化')

  // 两个都变 → 仍然只是不复用（不因"哪个先判"而泄漏候选）
  const r3 = call({ contextVersion: CV + 3, miv: 'idx_' + 'd'.repeat(32) })
  ok(r3.reuse === false && r3.hits.length === 0, 'cv 与 miv 同时变 → 仍不复用且无候选')
}

// ─────────────────────────────────────────────────────────────
console.log('[T0-2-3] fail closed：凡不能证明同版同源，一律不复用（对比旧实现的 fail open）')
{
  // ① 会话身份拿不到 —— 旧实现 `!agentSessionId` 直接算通过，这里必须挡下
  const r1 = selectReusableTierHitsPre({ projection: proj(), now: NOW + 1000, sessionId: '', workspaceKey: WS, contextVersion: CV, miv: MIV })
  ok(r1.reuse === false, '★缺当前会话身份 → 不复用（旧实现在此 fail open，是本条要挡的缺陷）')
  eq(r1.reason, 'identity-unknown', '原因码 identity-unknown')

  const r2 = call({}, { sessionId: '' })
  ok(r2.reuse === false, '★投影侧缺会话身份 → 不复用')
  eq(r2.reason, 'identity-unknown', '原因码 identity-unknown（投影侧）')

  // ② 投影缺版本字段（旧形状）—— 不能让"没版本"被当成"同版本"
  ok(call({}, { contextVersion: undefined }).reuse === false, '投影缺 contextVersion → 不复用（缺版本≠同版本）')
  eq(call({}, { contextVersion: undefined }).reason, 'version-unknown', '原因码 version-unknown')
  ok(call({}, { miv: undefined }).reuse === false, '投影缺 miv → 不复用')
  ok(call({}, { observationId: undefined }).reuse === false, '投影缺 observationId → 不复用（T0-2 要求携带它）')

  // ③ 当前侧版本不可得（拿不到 miv）—— 同样 fail closed
  ok(call({ miv: null }).reuse === false, '当前 miv 不可得 → 不复用（不猜）')
  ok(call({ miv: '' }).reuse === false, '当前 miv 空串 → 不复用')
  eq(call({ miv: null }).reason, 'version-unknown', '原因码 version-unknown（当前侧）')
  ok(call({ contextVersion: undefined }).reuse === false, '当前 contextVersion 不可得 → 不复用')

  // ④ 跨会话 / 跨工作区
  ok(call({ sessionId: 'sess-B' }) .reuse === false, '投影来自其它会话 → 不复用（A/B 串线）')
  eq(call({ sessionId: 'sess-B' }).reason, 'session-mismatch', '原因码 session-mismatch')
  eq(call({ workspaceKey: 'D:\\ws-b' }).reason, 'workspace-mismatch', '投影来自其它工作区 → workspace-mismatch')

  // ⑤ 观测身份不匹配
  eq(call({ observationId: 'obs_' + 'e'.repeat(32) }).reason, 'observation-mismatch',
    '显式要求另一次观测 → observation-mismatch')

  // ⑥ 时间门仍保留（它是必要不充分条件）
  eq(call({ now: NOW + 30 * 60000 }).reason, 'stale-time', '超出新鲜度窗口 → stale-time')
  eq(call({ now: NOW + 30 * 60000 - 1 }).reason, 'ok', '窗口内仍可复用（边界：30 分钟整被排除）')
  eq(selectReusableTierHitsPre({ projection: null, now: NOW, sessionId: SID, contextVersion: CV, miv: MIV }).reason,
    'no-projection', '没有投影 → no-projection（常态，不是错误）')
}

// ─────────────────────────────────────────────────────────────
console.log('[T0-2-4] 原因码必须可读且对外可观测（I7：降级不静默）')
{
  for (const code of Object.keys(TIER_HITS_REUSE_REASONS_V1)) {
    const t = describeReuseReasonPre(code)
    ok(typeof t === 'string' && t.length > 0 && t !== code, '原因码有可读中文：' + code + ' → ' + t)
  }
  ok(describeReuseReasonPre('some-new-code') === 'some-new-code', '未知原因码原样返回（排障不吞信息）')
  ok(describeReuseReasonPre('') === '未知原因', '空原因码有兜底文本')
}

// ─────────────────────────────────────────────────────────────
console.log('[T0-2-5] 接线可达性（源码级）：投影携带版本四元组 + 装配前逐项比对')
{
  const host = readFileSync(new URL('../../lib/activation-host.js', import.meta.url), 'utf8')
  const rec = host.slice(host.indexOf('function recordTierGateHits(req) {'), host.indexOf('function finishInject(box, req) {'))
  for (const k of ['contextVersion', 'miv', 'observationId', 'requestKey', 'workspaceKey']) {
    ok(new RegExp(k + ':').test(rec), 'recordTierGateHits 投影携带 ' + k)
  }
  // 投影里 query 的 120s 新鲜度是 query 选择用的（激活请求本身不带 query 文本），
  // 与"候选能否复用"是两件事；这里断言两者没有互相冒充。
  ok(/const q = \(lq && Date\.now\(\)/.test(rec), 'query 的新鲜度判定（120s）与复用判定分离，未混用')
  ok(!/fresh && sameSession/.test(readFileSync(new URL('../../lib/index.js', import.meta.url), 'utf8')),
    '旧的 fresh/sameSession 变量名不再残留在注入路径')

  const idx = readFileSync(new URL('../../lib/index.js', import.meta.url), 'utf8')
  ok(/selectReusableTierHitsPre\(\{/.test(idx), 'index.js 调用 selectReusableTierHitsPre（版本门真的接线）')
  // ⚠️ 必须**剥掉注释**再匹配：本函数上方刻意保留了旧实现的代码片段作为"踩坑留痕"，
  //    直接对全文做正则会把注释里的历史代码当现状（本套件首跑就因此产生两条假红）。
  //    这也是本项目"源码接线守卫 ≠ 行为断言"纪律的具体应用。
  const idxCode = idx.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
  ok(!/const fresh = !!gh && Date\.now\(\) - \(Number\(gh\.at\) \|\| 0\) < 30 \* 60000/.test(idxCode),
    '★旧的"只查时间"判定已被移除（否则本条红）')
  ok(!/const sameSession = !agentSessionId \|\| !gh/.test(idxCode),
    '★旧的 fail-open 会话判定已被移除（否则本条红）')
  ok(/tierCurrentMivPre\(\)/.test(idx), 'index.js 提供当前 miv（tierCurrentMivPre）')
  ok(/tierCurrentMivPre\(\) \{/.test(idx) && /sourceFingerprint\(f\)/.test(idx),
    'tierCurrentMivPre 用指纹判变化（零重读，不在热路径重建语料）')
  ok(/reuse: \{/.test(idx), 'tier0Meta 暴露复用账（面板/排障可观测）')
  ok(/statusFiltered: res\.hits/.test(idx), 'tier0Meta 暴露状态过滤账（I5 可见）')
}

// ─────────────────────────────────────────────────────────────
console.log('[T0-2-6] 不复用的**后果**：只退化成常驻目录（不是丢注入、不是报错）')
{
  const catalog = buildTier0CatalogFromTextPre(
    { user: '- 用户偏好一', project: '- 项目结论一', log: '- 今日做了一件事' },
    { maxTokens: 800, quota: true })
  const r = composeTieredInjectionPre({
    catalog, hits: [], question: '',
    extraDegradations: ['命中投影未复用（' + describeReuseReasonPre('miv-changed') + '）· 本轮不下探 Tier-1，仅常驻目录'],
  })
  eq(r.gate.level, 'tier0', '无候选 → 闸门停在 tier0')
  ok(r.text.includes('[Tier-0 常驻目录'), '常驻目录仍在（降级但不丢层）')
  ok(r.text.includes('命中投影未复用'), '注入里写明为什么不复用（不静默）')
  ok(r.text.includes('记忆索引版本已变化'), '降级行是可读中文，不是机器码')
}

// ─────────────────────────────────────────────────────────────
console.log('[T0-2-7] fixture 支持：makeFakeActivationRequestPre 可构造非 current 与 requestKey')
{
  const src = readFileSync(new URL('../../lib/activation-inbox.js', import.meta.url), 'utf8')
  ok(/status: rec\.status \|\| 'current'/.test(src), 'fixture 候选带 status（I5 过滤可被真实构造）')
  ok(/requestKey: opts\.requestKey \|\| ''/.test(src), 'fixture 带 requestKey（T0-2 可被真实构造）')
  const mod = src
  ok(!/\uFEFF/.test(mod), 'activation-inbox.js 无 BOM')
  for (const p of ['../../lib/index.js', '../../lib/tier-layer-inject.js', '../../lib/activation-host.js', '../../lib/activation-inbox.js']) {
    const raw = readFileSync(new URL(p, import.meta.url))
    ok(!(raw[0] === 0xEF && raw[1] === 0xBB && raw[2] === 0xBF), '无 BOM：' + p.split('/').pop())
  }
}

console.log('\n[t0-2-version-gate-pre] pass=' + pass + ' fail=' + fail)
process.exit(fail ? 1 : 0)

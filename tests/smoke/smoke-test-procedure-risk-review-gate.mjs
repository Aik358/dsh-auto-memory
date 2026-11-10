#!/usr/bin/env node
/**
 * smoke-test-procedure-risk-review-gate.mjs —— PR-A（F1+F2+F3）的上游侧独立断言。
 *
 * 为什么必须有这个套件：
 *   F1/F2 新增的结构门刻意用**字面 reasonCodes**（不用 reason.push），以免打乱 r2 守卫以源码正则
 *   提取的「追加式原因码序列」。代价是：**新门不在 r2 的扫描形态内** —— 改了 promote() 却忘了
 *   evaluatePromotion()，r2 仍然全绿。本套件补这条机器锁（评审意见 R1）。
 *
 * 判据分两层：
 *   ① 行为层：用内存 store 真跑 observed→validated→active、降级打标记、promote/activate 被拦、
 *      approve 解除；
 *   ② 同源层：promote() 与 evaluatePromotion() 都必须存在同一道门且码字面一致。
 * 纪律：只用内存 IO，绝不碰真实 ~/.dsh。
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, '../..')
const STORE_SRC = readFileSync(path.join(ROOT, 'lib', 'procedure-store.js'), 'utf8')

let pass = 0, fail = 0
const ok = (c, label, extra) => { if (c) { pass++; console.log('PASS ' + label) } else { fail++; console.log('FAIL ' + label + (extra === undefined ? '' : ' :: ' + JSON.stringify(extra))) } }

const storeMod = await import('../../lib/procedure-store.js')
const createStore = storeMod.createProcedureStorePre

function mkStore() {
  let saved = null
  return createStore({
    io: { save(d) { saved = d }, load() { return saved }, clear() { saved = null } },
    now: () => 1794300000000,
    gates: { ...storeMod.PROCEDURE_DEFAULT_GATES_PRE_V1, minSessionDiversity: 1, minSuccessCount: 1 },
  })
}
function evid(st, pid) {
  st.addEvidence(pid, { kind: 'success', sessionRef: 'sess-risk-review-0001' })
  st.addEvidence(pid, { kind: 'seen', sessionRef: 'sess-risk-review-0001' })
}

console.log('=== [F1] 已 active 条目再 promote 必须短路（不得降级）===')
{
  const st = mkStore()
  const c = st.observe({ title: 'F1 断言用流程', steps: ['一', '二'], successCriteria: ['跑通'], riskLevel: 'low' })
  const pid = c.procedure.procedureId
  evid(st, pid)
  ok(st.promote(pid).promoted === true, '[F1] 首次 promote 成功')
  ok(st.activate(pid).ok === true && st.get(pid).stage === 'active', '[F1] activate 成功')
  const again = st.promote(pid)
  ok(again.promoted === false, '[F1] ★再 promote 的 promoted 必须为 false（旧实现返回 true）', again.promoted)
  ok(again.decision === 'keep', '[F1] decision=keep', again.decision)
  ok(Array.isArray(again.reasonCodes) && again.reasonCodes.includes('already-active'), '[F1] 码为 already-active', again.reasonCodes)
  ok(st.get(pid).stage === 'active', '[F1] ★stage 仍是 active（旧实现会被打回 validated）', st.get(pid).stage)
}

console.log('=== [F2] 风险降级必须打标记、且不得误清批准 ===')
{
  const st = mkStore()
  const c = st.observe({ title: 'F2 断言用流程', steps: ['一'], successCriteria: ['跑通'], riskLevel: 'low' })
  const pid = c.procedure.procedureId
  evid(st, pid)
  st.update(pid, { riskLevel: 'high' })
  ok(st.get(pid).requiresApproval === true, '[F2] 升级到 high ⇒ requiresApproval=true')
  ok(st.get(pid).approved === false, '[F2] #337 升级清批准')
  st.approve(pid, 'user')
  ok(st.get(pid).approved === true, '[F2] 批准成功')
  st.update(pid, { riskLevel: 'medium' })
  const g = st.get(pid)
  ok(g.requiresApproval === false, '[F2] 降级后 requiresApproval=false（门原本会消失）')
  ok(g.approved === true, '[F2] ★降级不清既有人工批准（#337 负路径）', g.approved)
  ok(g.riskReviewRequired === true, '[F2] ★降级打 riskReviewRequired 标记', g.riskReviewRequired)
  const pr = st.promote(pid, {}, { authorizedBy: 'model' })
  ok(pr.decision === 'ask', '[F2] 降级后 promote 被拦 ⇒ decision=ask', pr.decision)
  ok(Array.isArray(pr.reasonCodes) && pr.reasonCodes.includes('risk-downgraded-awaiting-approval'), '[F2] 码正确', pr.reasonCodes)
  const ev = st.evaluatePromotion(pid)
  ok(ev.decision === 'ask' && (ev.reasonCodes || []).includes('risk-downgraded-awaiting-approval'), '[F2] 只读投影同码（同源）', ev.reasonCodes)
  const ov = st.promotionOverrideView(pid)
  ok(ov.overridable === false, '[F2] 结构门 ⇒ 不给强制晋升（overridable=false）', ov.overridable)
  const ap = st.approve(pid, 'user')
  ok(ap.ok === true && ap.riskReviewCleared === true, '[F2] approve 解除降级复核', ap)
  ok(st.get(pid).riskReviewRequired === false, '[F2] 标记已清')
  const pr2 = st.promote(pid, {}, { authorizedBy: 'model' })
  ok(!(pr2.decision === 'ask' && (pr2.reasonCodes || []).includes('risk-downgraded-awaiting-approval')), '[F2] 解除后不再因该门回 ask', pr2.reasonCodes)
}

console.log('=== [F2/R1] 同一道门必须在两处同时存在（r2 正则覆盖不到字面码，故需此锁）===')
{
  // 从源码按花括号配平抽函数体
  function bodyOf(header) {
    const s = STORE_SRC.indexOf(header)
    assert(s >= 0, '找不到 ' + header)
    let i = s + header.length - 1, d = 0
    for (; i < STORE_SRC.length; i++) {
      const ch = STORE_SRC[i]
      if (ch === '{') d++
      else if (ch === '}') { d--; if (d === 0) return STORE_SRC.slice(s, i + 1) }
    }
    throw new Error('unbalanced ' + header)
  }
  const promoteBody = bodyOf('function promote(procedureId, extraEvidence = {}, opts = {}) {')
  const evlBody = bodyOf('function evaluatePromotion(procedureId) {')
  const CODE = 'risk-downgraded-awaiting-approval'
  ok(promoteBody.includes("reasonCodes: ['" + CODE + "']"), '[R1] promote() 有该结构门（字面原因码）')
  ok(evlBody.includes("reasonCodes: ['" + CODE + "']"), '[R1] ★evaluatePromotion() 有同一道门且码字面一致')
  ok(!/reason\.push\('" + CODE + "'\)/.test(promoteBody + evlBody), '[R1] 该码不得用 reason.push（否则打乱 r2 序列）')
  // F1 同源：两处都要有 already-active 短路
  ok(promoteBody.includes("reasonCodes: ['already-active']"), '[R1] promote() 有 already-active 短路')
  ok(evlBody.includes("reasonCodes: ['already-active']"), '[R1] ★evaluatePromotion() 同样有 already-active（否则投影与执行不同源）')
}


console.log('=== [R3] 降级条目不得出现「零按钮」死路（复核阻断项）===')
{
  const CLIENT_SRC = readFileSync(path.join(ROOT, 'lib', 'client.js'), 'utf8')
  // ① 三面镜像的批准按钮条件必须都认 riskReviewRequired
  const faces = [...CLIENT_SRC.matchAll(/\|\| p\.riskReviewRequired === true/g)].length
  ok(faces === 3, '[R3] ★三面镜像都认 riskReviewRequired（应为 3 面）', faces)
  ok(!/\(p\.promotion && p\.promotion\.decision === 'ask'\)\r?\n/.test(CLIENT_SRC.replace(/\|\| p\.riskReviewRequired === true/g, '')), '[R3] 无遗漏的旧写法面')
  // ①b i18n 键必须三语言齐全 + 使用点：共 4 处（zh / en / ja / whyNotPromotable 使用点）。
  //   ★复核指出：现有 smoke-test-i18n-really 只断言条目数与抽样回落，**不校验 zh/en/ja 键集对齐**
  //   ⇒ 删掉 ja 那行不会有任何断言变红。这条把它补上（负控 = 删 ja ⇒ 必红）。
  const keyCount = (CLIENT_SRC.match(/hubWhyRiskDowngraded/g) || []).length
  ok(keyCount === 4, '[R3] ★i18n 键三语言齐全 + 使用点共 4 处', keyCount)
  // ② 两处 hub 投影必须带该字段（否则前端拿不到值）
  const HUB_SRC = readFileSync(path.join(ROOT, 'lib', 'memory-hub.js'), 'utf8')
  const proj = [...HUB_SRC.matchAll(/riskReviewRequired: !!p\.riskReviewRequired/g)].length
  ok(proj === 2, '[R3] ★memory-hub 两处投影都补了 riskReviewRequired（应为 2 处）', proj)
  // ③ 抽取 whyNotPromotable 真跑：混合码时首选文案必须是「降级复核」而不是统计门文案
  const ci = CLIENT_SRC.indexOf('function whyNotPromotable(promotion) {')
  ok(ci >= 0, '[R3] 能抽到 whyNotPromotable')
  if (ci >= 0) {
    let d = 0, j = CLIENT_SRC.indexOf('{', ci)
    for (; j < CLIENT_SRC.length; j++) { const ch = CLIENT_SRC[j]; if (ch === '{') d++; else if (ch === '}') { d--; if (d === 0) break } }
    const bodySrc = CLIENT_SRC.slice(CLIENT_SRC.indexOf('{', ci) + 1, CLIENT_SRC.lastIndexOf('}', j))
    const calls = []
    const fn = new Function('t', 'function whyNotPromotable(promotion) {' + bodySrc + '} return whyNotPromotable')
    // t() 对部分键返回**函数**（参数化文案，如 hubWhyDiversity(n, need)），桩必须两种形态都兼容
    const impl = fn(function (k) {
      calls.push(k)
      const f = function (a, b) { return 'MSG:' + k + ':' + a + '/' + b }
      f.toString = function () { return 'MSG:' + k }
      return f
    })
    // 宿主在 override 视图里现在返回**结构码在前**（procedure-store 的 hidden.concat(codes)），
    // 客户端按数组顺序取第一个命中 ⇒ 必须命中降级复核文案。
    const hostOrder = impl({ decision: 'keep', overridable: false, gateKind: 'structural',
      reasonCodes: ['risk-downgraded-awaiting-approval', 'diversity-below-3'] })
    ok(calls.includes('hubWhyRiskDowngraded'), '[R3] ★宿主顺序（结构码在前）下首个命中是降级复核文案', calls)
    ok(!/diversity-below-3/.test(String(hostOrder)), '[R3] 不得把裸统计码甩给用户', String(hostOrder))
    // 对照（记录用，断言其成立）：若顺序退回「统计码在前」，客户端的第一个文案会变成统计门 ⇒ 误导。
    //   这正是本 PR 把 promotionOverrideView 改成 hidden.concat(codes) 的原因。
    calls.length = 0
    impl({ decision: 'keep', overridable: false, gateKind: 'structural',
      reasonCodes: ['diversity-below-3', 'risk-downgraded-awaiting-approval'] })
    ok(calls[0] === 'hubWhyDiversity', '[R3] 对照：顺序若退回统计码在前，首个文案会变统计门（说明顺序修复必要）', calls)
  }
}

console.log('=== [R3-b] promotionOverrideView 的 reasonCodes 必须结构门优先 ===')
{
  const st = mkStore()
  const c = st.observe({ title: 'R3 顺序用流程', steps: ['一'], successCriteria: ['跑通'], riskLevel: 'low' })
  const pid = c.procedure.procedureId
  st.update(pid, { riskLevel: 'high' })
  st.approve(pid, 'user')
  st.update(pid, { riskLevel: 'medium' })   // 打降级标记；证据为 0 ⇒ 统计门也会拦
  const ov = st.promotionOverrideView(pid)
  const codes = (ov && ov.reasonCodes) || []
  ok(codes.length > 0, '[R3-b] 有原因码')
  ok(codes[0] === 'risk-downgraded-awaiting-approval', '[R3-b] ★结构门码必须排在最前（决定用户下一步动作）', codes)
}
console.log('\n结果: PASS=' + pass + ' FAIL=' + fail)
process.exit(fail ? 1 : 0)
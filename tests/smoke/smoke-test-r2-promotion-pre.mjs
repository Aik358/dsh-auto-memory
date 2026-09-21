// R2 守卫：evaluatePromotion 必须**纯只读**且与 promote() 的门限顺序一致
//
// 背景：promote() 含真实副作用（stats.approvalAsked++ / p.stage='validated' /
//   stats.validated++ / persist() 写盘）。overview() 是**只读轮询路径**，
//   若复用 promote() 会污染统计并把候选**悄悄提升**。
// ⇒ R2 另写纯只读投影，本套件锁三件事：
//   ① 它存在且被 overview() 使用；
//   ② 调它**不改任何状态**（关键：真调一次前后快照对比）；
//   ③ 门限判定与 promote() **同序同码**（防两边漂移）。
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { createProcedureStorePre } from '../../lib/procedure-store-pre.js'
import { readFileSync } from 'node:fs'

const PS = readFileSync(path.join(process.cwd(), 'lib', 'procedure-store-pre.js'), 'utf8')
const HUB = readFileSync(path.join(process.cwd(), 'lib', 'memory-hub-pre.js'), 'utf8')

let pass = 0, fail = 0
const t = (n, f) => { try { f(); pass++; console.log('  ok - ' + n) } catch (e) { fail++; console.log('  FAIL - ' + n + ': ' + (e && e.message)) } }
const assert = (c, m) => { if (!c) throw new Error(m || 'assertion failed') }

console.log('=== R2-a 结构接线 ===')

t('R2a-1 ★★ evaluatePromotion 存在且已导出', () => {
  assert(/function evaluatePromotion\(procedureId\)/.test(PS), '★ 缺 evaluatePromotion 实现')
  assert(/\r?\n\s*evaluatePromotion,/.test(PS) || /evaluatePromotion,\r?\n/.test(PS), '★ 未导出')
})

t('R2a-2 ★★★ overview() 必须走只读投影，**绝不能**调 promote()', () => {
  const i = HUB.indexOf("pipeline: stores.procedures.query()")
  assert(i > 0, '未找到 pipeline 投影')
  const seg = HUB.slice(i, i + 2200)
  assert(/evaluatePromotion\(/.test(seg), '★ pipeline 未使用只读投影')
  assert(!/\.promote\(/.test(seg), '★★ pipeline 里出现了 promote( —— 只读路径禁止调用有副作用的判定')
})

t('R2a-3 ★★ 投影字段齐全（前端 R2/R4 依赖）', () => {
  assert(/promotion,/.test(HUB), '未投影 promotion')
  assert(/steps: Array\.isArray\(p\.steps\)/.test(HUB), '未投影 steps（R4 预览需要）')
  assert(/successCriteria: Array\.isArray\(p\.successCriteria\)/.test(HUB), '未投影 successCriteria（R4 预览需要）')
})

console.log('\n=== R2-b 纯只读（行为级，最关键）===')

const tmp = mkdtempSync(path.join(tmpdir(), 'dam-r2-'))
let nowV = 1000
const now = () => ++nowV
const io = { load: () => null, save: () => {} }

function mkStore() {
  return createProcedureStorePre({ io, now })
}

// 造一条 diversity 不足的候选（会落 diversity-below-3）
function seedCandidate(st) {
  const r = st.observe({ title: '部署流程', riskLevel: 'low', steps: ['a'], successCriteria: ['done'] })
  return r && (r.procedureId || (r.procedure && r.procedure.procedureId))
}

t('R2b-1 ★★★ 调用 evaluatePromotion **不得改变任何状态**', () => {
  const st = mkStore()
  const id = seedCandidate(st)
  assert(id, '造候选失败')
  // ⚠️ 不能直接比 snapshot()：它内含 `savedAt: nowFn()`，**每次调用都会推进假时钟**，
  //    于是两次 snapshot 必然不同 —— 那是用例缺陷，不是被测代码有副作用。
  //    故只比**条目本体**（stage/evidence/successCriteria），不动用会自变的字段。
  const pick = (s) => JSON.stringify((s.procedures || []).map((p) => ({
    id: p.procedureId, stage: p.stage, ev: p.evidence, sc: p.successCriteria, st: p.steps,
  })))
  const snapOf = () => st.snapshot()
  const before = pick(snapOf())
  const beforeStats = JSON.stringify(st.getStats())
  st.evaluatePromotion(id)   // 调用两次，确保不会有累积副作用
  st.evaluatePromotion(id)
  const after = pick(snapOf())
  const afterStats = JSON.stringify(st.getStats())
  assert(before === after, '★★ 条目本体变了：evaluatePromotion 有副作用！')
  assert(beforeStats === afterStats, '★★ 统计变了：evaluatePromotion 有副作用！')
})

t('R2b-2 ★★★ 它不得把候选提升（stage 必须原样）', () => {
  const st = mkStore()
  const id = seedCandidate(st)
  const st0 = st.get(id).stage
  st.evaluatePromotion(id)
  assert(st.get(id).stage === st0, '★★ stage 被改了（' + st0 + ' → ' + st.get(id).stage + '）')
})

t('R2b-3 ★★ 对照：真有副作用的 promote() 会改统计（证明上面测的是真东西）', () => {
  // ⚠️ 必须喂**能走到晋升终点**的候选（证据齐 + 授权跳门）。
  //    否则 promote 在 diversity 门就 early-return，stats 根本不变 ⇒ 对照失效（自证假绿）。
  const st = mkStore()
  const id = seedCandidate(st)
  st.addEvidence(id, { seen: 1, read: 1, cite: 1, reuse: 1, success: 3, sessions: 3 })
  const b = JSON.stringify(st.getStats())
  const r = st.promote(id, {}, { authorizedBy: 'model' })
  const a = JSON.stringify(st.getStats())
  assert(r.decision === 'promote', '对照用例前提不成立：未走到晋升终点（' + JSON.stringify(r.reasonCodes) + '）')
  assert(b !== a, '★ promote 竟然不改统计 —— 说明本套件的「只读」断言没有区分力')
})

console.log('\n=== R2-c 判定正确性 ===')

t('R2c-1 ★★ 无历史证据 → diversity-below-3（与 promote 同码）', () => {
  const st = mkStore()
  const id = seedCandidate(st)
  const r = st.evaluatePromotion(id)
  assert(r.ok && r.decision === 'keep', '应是 keep')
  assert(r.reasonCodes.some((c) => /^diversity-below-/.test(c)), '原因码应为 diversity-below-*，实际 ' + JSON.stringify(r.reasonCodes))
  assert(r.detail && r.detail.need != null, '★ 应带 detail.need（前端要显示「需要 N 个会话」）')
})

t('R2c-2 ★ 观察行 → observation-only 短路', () => {
  const st = mkStore()
  const r = st.observe({ title: '观察A', riskLevel: 'low', steps: ['观察任务：x'], observationOnly: true })
  const id = r.procedureId || (r.procedure && r.procedure.procedureId)
  const e = st.evaluatePromotion(id)
  assert(e.reasonCodes.includes('observation-only'), '应为 observation-only，实际 ' + JSON.stringify(e.reasonCodes))
})

t('R2c-3 ★ 不存在的 id → ok:false（不抛）', () => {
  const st = mkStore()
  const r = st.evaluatePromotion('proc_nope')
  assert(r.ok === false, '应返回 ok:false')
})

console.log('\n=== R2-d 与 promote() 的一致性（防漂移）===')

t('R2d-1 ★★★ 两者的**门限判定顺序**必须一致（源码级对齐）', () => {
  // ⚠️ 不能做字面全等：`promote()` 还有**授权语义**（`model-authorized` 前置 + 高风险分支
  //    在两个 return 点各 push 一次），而只读投影**没有授权概念**（它回答的是
  //    「在无授权的一般路径下，卡在哪一道门」）。故只比**门限原因码序列**，
  //    并显式排除授权类标记。这才是有意义的对齐口径。
  const AUTH_ONLY = new Set(['model-authorized'])
  const pi = PS.indexOf('function promote(procedureId')
  const pEnd = PS.indexOf('return { ok: true, decision: \'promote\'', pi)
  const pseg = PS.slice(pi, pEnd)
  const ei = PS.indexOf('function evaluatePromotion(procedureId)')
  const eEnd = PS.indexOf("return { ok: true, decision: 'promote', reasonCodes: reason, detail", ei)
  const eseg = PS.slice(ei, eEnd)
  const codes = (seg) => {
    const raw = [...seg.matchAll(/reason\.push\('([a-z\-]+)'/g)].map((m) => m[1])
    const seen = []
    for (const c of raw) { if (AUTH_ONLY.has(c)) continue; if (!seen.includes(c)) seen.push(c) }
    return seen
  }
  const a = codes(pseg), b = codes(eseg)
  assert(a.length >= 5, 'promote 原因码提取失败：' + JSON.stringify(a))
  assert(JSON.stringify(a) === JSON.stringify(b), '★★ 门限顺序漂移：promote=' + JSON.stringify(a) + ' evaluate=' + JSON.stringify(b))
})

t('R2d-2 ★★ 相同的输入必须给**相同判定**（promote vs evaluate）', () => {
  // 用两条 store 造同样的候选，一条走 promote、一条走 evaluate
  const s1 = mkStore(); const s2 = mkStore()
  const i1 = seedCandidate(s1); const i2 = seedCandidate(s2)
  const a = s1.promote(i1)
  const b = s2.evaluatePromotion(i2)
  assert(a.decision === b.decision, '判定不一致：promote=' + a.decision + ' evaluate=' + b.decision)
  // 原因码集合归一（去掉尾部数字便于比较）
  const norm = (cs) => cs.map((c) => c.replace(/-?\d+(\.\d+)?$/, '')).sort()
  assert(JSON.stringify(norm(a.reasonCodes)) === JSON.stringify(norm(b.reasonCodes)),
    '原因码不一致：' + JSON.stringify(a.reasonCodes) + ' vs ' + JSON.stringify(b.reasonCodes))
})

console.log('\n[r2] ' + pass + ' passed, ' + fail + ' failed')
process.exit(fail ? 1 : 0)

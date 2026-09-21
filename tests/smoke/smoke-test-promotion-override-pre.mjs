/**
 * 人工越权晋升（C 批）守卫 —— 2026-09-22
 *
 * 背景（有代码证据）：
 *   evaluatePromotion 对线上 30 条全部返回 keep ⇒ A-9 之后「晋升」按钮一个都不出现，
 *   用户观感是「手动晋升的通道被关掉了」。修法是**给且只给统计门拦住的条目**开人工越权口：
 *     统计门（diversity / success）= 证据没攒够 ⇒ 容许人工越过；
 *     结构门（deprecated / observation-only / correction / no-success-criteria / high-risk）= 内容本身不合格
 *     ⇒ **人工也不放行**（否则就是再造一个「点了没反应」的假通道）。
 *
 * 本套件锁定三件事，任何一条被改坏都必须变红：
 *   P1 只读投影 promotionOverrideView 的 gateKind / overridable 语义正确；
 *   P2 promote(..., { authorizedBy:'user' }) 只越统计门、结构门恒拦、留痕正确；
 *   P3 宿主路由白名单 + hub 投影合并 + 前端按钮门控三处接线在位。
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createProcedureStorePre, PROCEDURE_DEFAULT_GATES_V1 } from '../../lib/procedure-store.js'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, '..', '..')
const idx = readFileSync(path.join(ROOT, 'lib', 'index.js'), 'utf8')
const HUB = readFileSync(path.join(ROOT, 'lib', 'memory-hub.js'), 'utf8')
const CLI = readFileSync(path.join(ROOT, 'lib', 'client.js'), 'utf8')

let pass = 0, fail = 0
const ok = (c, n) => { if (c) { pass++; console.log('  ok - ' + n) } else { fail++; console.error('  FAIL - ' + n) } }

const memIO = () => { let s = null; return { io: { save: (v) => { s = v }, load: () => s, clear: () => { s = null } }, get saved() { return s } } }
let fakeNow = 900000
const now = () => ++fakeNow
const mk = () => { const m = memIO(); return { st: createProcedureStorePre({ io: m.io, now }) } }
const G = PROCEDURE_DEFAULT_GATES_V1
const codes = (r) => (r && r.reasonCodes) || []

/** 真技能：有 steps + successCriteria（⇒ 非 observation-only），证据由调用方补。 */
const skill = (over = {}) => ({
  title: '发布前跑全量回归并核对 SHA256',
  steps: ['先备份目标文件', '跑全量回归', '核对三个文件的 SHA256 与原值一致'],
  successCriteria: ['全量回归 FAIL=0', 'SHA256 逐字节一致'],
  riskLevel: 'low', origin: 'agent', sourceMemoryIds: [], sourceEpisodes: [],
  ...over,
})
/** 观察型：有 sourceEpisodes、无 successCriteria ⇒ isObservationOnlyPre 命中。 */
const observed = (over = {}) => ({
  title: '某次操作被看到过一遍', steps: ['看到过 A'], successCriteria: [],
  riskLevel: 'low', origin: 'agent', sourceMemoryIds: [], sourceEpisodes: ['ep-1'],
  ...over,
})
/** 只补多样性 + 成功，不补纠正（用于「结构门 = no-success-criteria」的对照夹具）。 */
function feedClean(st, pid) {
  for (let i = 0; i < 4; i++) st.addEvidence(pid, { kind: 'success', sessionRef: 'ok-' + i })
}

console.log('[PO-1] 只读投影 promotionOverrideView：只有统计门可越')
{
  const { st } = mk()
  const pid = st.observe(skill()).procedure.procedureId
  const v = st.promotionOverrideView(pid)
  ok(v && v.decision === 'keep', '零证据真技能 ⇒ keep')
  ok(v.overridable === true, '★ 统计门拦住的条目 overridable === true（界面据此给「强制晋升（人工）」按钮）')
  ok(v.gateKind === 'statistical', 'gateKind === "statistical"')
  ok(codes(v).every((c) => /^diversity-below-/.test(c) || /^success-below-/.test(c)),
    'reasonCodes 全部是统计门码（' + codes(v).join(',') + '）')
}

console.log('\n[PO-2] 结构门 ⇒ overridable === false（人工也不放行，界面因此不给按钮）')
{
  // (a) no-success-criteria：先过统计门才会走到这一道结构门
  const { st } = mk()
  const r = st.observe(skill({ successCriteria: [] }))
  const pid = r.procedure.procedureId
  feedClean(st, pid)
  const v = st.promotionOverrideView(pid)
  ok(codes(v).includes('no-success-criteria'), '无 successCriteria 且证据达标 ⇒ no-success-criteria（' + codes(v).join(',') + '）')
  ok(v.overridable === false, '★ overridable === false')
  ok(v.gateKind === 'structural', 'gateKind === "structural"')

  // (b) deprecated
  const { st: st3 } = mk()
  const pid3 = st3.observe(skill()).procedure.procedureId
  st3.deprecate(pid3, 'user-disabled')
  const v3 = st3.promotionOverrideView(pid3)
  ok(codes(v3).includes('deprecated'), '已弃用 ⇒ deprecated')
  ok(v3.overridable === false && v3.gateKind === 'structural', '已弃用 ⇒ structural/不可越')

  // (c) observation-only
  const { st: st4 } = mk()
  const pid4 = st4.observe(observed()).procedure.procedureId
  const v4 = st4.promotionOverrideView(pid4)
  ok(codes(v4).includes('observation-only'), '观察型 ⇒ observation-only')
  ok(v4.overridable === false && v4.gateKind === 'structural', '观察型 ⇒ structural/不可越')
}

console.log('\n[PO-3] 已达标的条目 ⇒ gateKind === "promote"（本来就有按钮，不需要越权口）')
{
  const { st } = mk()
  const pid = st.observe(skill()).procedure.procedureId
  feedClean(st, pid)
  const v = st.promotionOverrideView(pid)
  ok(v.decision === 'promote', '证据达标 ⇒ promote')
  ok(v.gateKind === 'promote' && v.overridable === false, 'gateKind === "promote" 且 overridable === false')
}

console.log('\n[PO-4] 越权语义：authorizedBy="user" 只越统计门')
{
  // 统计门拦住 ⇒ 人工可越过
  const { st } = mk()
  const pid = st.observe(skill()).procedure.procedureId
  const pr = st.promote(pid, {}, { authorizedBy: 'user' })
  ok(pr.ok === true && pr.decision === 'promote', '★ 统计门 + 人工授权 ⇒ promote')
  ok(codes(pr).includes('user-authorized'), 'reasonCodes 含 user-authorized（留痕，可审计）')
  ok(st.get(pid).stage === 'validated', '阶段推进到 validated')
  ok(st.get(pid).authorizedBy === 'user', '★ 条目上留下 authorizedBy === "user"')

  // 不授权 ⇒ 统计门照拦（越权特性不得改变默认行为）
  const { st: st2 } = mk()
  const pid2 = st2.observe(skill()).procedure.procedureId
  const pr2 = st2.promote(pid2)
  ok(pr2.decision === 'keep', '不传授权 ⇒ keep（默认行为未被放宽）')
  ok(st2.get(pid2).authorizedBy === undefined, '未授权 ⇒ 不写 authorizedBy')
}

console.log('\n[PO-5] 结构门恒拦：人工授权也不放行（★ 这条保证界面「不给按钮」与后端一致）')
{
  const { st } = mk()
  const pid = st.observe(skill({ successCriteria: [] })).procedure.procedureId
  feedClean(st, pid)
  const pr = st.promote(pid, {}, { authorizedBy: 'user' })
  ok(pr.decision === 'keep' && codes(pr).includes('no-success-criteria'),
    '★ 无 successCriteria + 人工授权 ⇒ 仍 keep/no-success-criteria')
  ok(st.get(pid).authorizedBy === undefined, '结构门拦下 ⇒ 不写 authorizedBy（不留假授权痕）')

  const { st: st2 } = mk()
  const pid2 = st2.observe(skill()).procedure.procedureId
  st2.deprecate(pid2, 'user-disabled')
  const pr2 = st2.promote(pid2, {}, { authorizedBy: 'user' })
  ok(pr2.decision === 'keep' && codes(pr2).includes('deprecated'), '已弃用 + 人工授权 ⇒ 仍 keep/deprecated')

  const { st: st3 } = mk()
  const pid3 = st3.observe(observed()).procedure.procedureId
  const pr3 = st3.promote(pid3, {}, { authorizedBy: 'user' })
  ok(pr3.decision === 'keep' && codes(pr3).includes('observation-only'), '观察型 + 人工授权 ⇒ 仍 keep/observation-only')
}

console.log('\n[PO-6] 只读投影零副作用：evaluatePromotion 不得改状态、不得吐授权痕')
{
  const { st } = mk()
  const pid = st.observe(skill()).procedure.procedureId
  const a = st.evaluatePromotion(pid)
  const b = st.evaluatePromotion(pid)
  ok(JSON.stringify(a) === JSON.stringify(b), '连调两次结果逐字节一致（纯函数）')
  ok(a && a.decision === 'keep' && st.get(pid).stage === 'observed', '只读调用不改 stage（仍 observed）')
  ok(!codes(a).some((c) => c === 'user-authorized' || c === 'model-authorized'),
    '★ evaluatePromotion 永不输出授权痕（授权只在 promote 里追加 ⇒ 两者不会漂移）')
  ok(st.promotionOverrideView(pid).overridable === true, '只读投影也不改状态：之后仍可被判定可越权')
}

console.log('\n[PO-7] 宿主路由：force-promote 在白名单内且只应传 authorizedBy="user"')
{
  ok(idx.includes("'force-promote'"), 'index.js 出现 force-promote')
  const m = /if \(\[([^\]]*)\]\.includes\(action\)\)/.exec(idx)
  ok(!!m && /'force-promote'/.test(m[1]), '★ force-promote 位于动作白名单数组内（否则路由直接拒绝）')
  ok(/action === 'force-promote'\)\s*r = procs\.promote\(pid, \{\}, \{ authorizedBy: 'user' \}\)/.test(idx),
    '★ force-promote ⇒ procs.promote(pid, {}, { authorizedBy: "user" })')
  ok(!/action === 'force-promote'\)\s*r = procs\.promote\(pid(?!, \{\}, \{ authorizedBy: 'user' \}\))/.test(idx),
    'force-promote 的分支没有第二种（无授权的）调用形态')
}

console.log('\n[PO-8] hub 只读投影合并：前端拿到 promotion.overridable / gateKind')
{
  ok(/promotionOverrideView/.test(HUB), 'memory-hub.js 引用 promotionOverrideView')
  ok(/promotion\.overridable/.test(HUB) || /overridable/.test(HUB), 'hub 投影写出 overridable 字段')
  ok(/gateKind/.test(HUB), 'hub 投影写出 gateKind 字段')
}

console.log('\n[PO-9] 前端门控：overridable 才给按钮，结构门只给解释不給按钮')
{
  ok(/p\.promotion\.overridable === true/.test(CLI), '★ 按钮门控在 p.promotion.overridable === true 上')
  ok(/hubAct\('force-promote'/.test(CLI), '★ 按钮动作是 hubAct("force-promote")')
  ok(/hubWhyOverridable/.test(CLI) && /hubWhyStructural/.test(CLI), '两段解释文案键存在')
  const n1 = CLI.split('hubForcePromote:').length - 1
  const n2 = CLI.split('hubForcePromoteTitle:').length - 1
  ok(n1 === 2 && n2 === 2, 'hubForcePromote / hubForcePromoteTitle 各 zh+en 两处（实际 ' + n1 + ' / ' + n2 + '）')
  // 反例守卫：按钮不得挂在 decision==='ask' 上（那是「批准(人工)」，不是越权）
  ok(/p\.promotion\.decision === 'ask'/.test(CLI), '「批准(人工)」按钮仍在（两条通道互不冒充）')
}

console.log('\n=== [PO] ' + pass + ' passed, ' + fail + ' failed ===')
if (fail > 0) process.exit(1)

#!/usr/bin/env node
// issue#30 回归锁定(2026-09-14):Procedural skill crystallization can never promote。
// 根因三层,本文件逐层锁死:
//   P1 episode → crossFeed 候选:observationOnly 标记 + promote 首闸 observation-only
//      (旧实现:sourceMemoryIds=[] 且无 successCriteria → 证据永远挂不上 → 闸门永远 keep,
//       却占着审批队列假装可晋升;UI 只报 ok:true)
//   P2 注入 intent 防御:运行时注入文本不再成为技能标题(宁缺毋滥,跳过候选)
//   P3 steps 质量:actions 恒为 ['user','user'] 时不再产出「步骤1: user」垃圾
//   P4 judgement-shadow 路径不受影响:带 sourceIds 的候选仍走真实闸门(diversity/success)
//   P5 校验与持久化:observationOnly 布尔校验 + snapshot/restore 往返保留
//   P6 overview 审批队列表透出 observationOnly
//   G1 源码守卫:index.js hub review 日志记 decision+reasonCodes(不再只记 ok);
//      client.js 显示原因码、观察型条目隐藏晋升按钮
// 纯内存 fixture,零 IO、零真实记忆接触。
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createEpisodicStorePre } from '../../lib/episodic-store.js'
import { createProcedureStorePre, validateProcedureCandidatePre, validateProcedurePre } from '../../lib/procedure-store.js'
import { createFactStorePre } from '../../lib/fact-store.js'
import { createMemoryHubPre, procedureCandidateFromRow } from '../../lib/memory-hub.js'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const INDEX_SRC = readFileSync(path.resolve(HERE, '..', '..', 'lib', 'index.js'), 'utf8')
const CLIENT_SRC = readFileSync(path.resolve(HERE, '..', '..', 'lib', 'client.js'), 'utf8')

let pass = 0, fail = 0
const ok = (c, n) => { if (c) { pass++; console.log('  ok - ' + n) } else { fail++; console.error('  FAIL - ' + n) } }
const memIO = () => { let s = null; return { io: { save: (v) => { s = v }, load: () => s, clear: () => { s = null } }, get saved() { return s } } }
let fakeNow = 1000000
const now = () => ++fakeNow

function makeHub() {
  return createMemoryHubPre({
    stores: {
      episodic: createEpisodicStorePre({ now }),
      facts: createFactStorePre({ now }),
      procedures: createProcedureStorePre({ now }),
    },
    now,
  })
}

console.log('[P1] episode → crossFeed → observation-only 候选 + promote 首闸')
{
  const hub = makeHub()
  const eps = hub.stores.episodic
  const procs = hub.stores.procedures
  eps.append({ kind: 'user', userText: '帮我部署这个服务到服务器', sessionRef: 'sesr_X', eventSeq: 1 })
  eps.append({ kind: 'assistant', assistantText: '部署成功完成', sessionRef: 'sesr_X', eventSeq: 2 })
  const cr = eps.consolidate()
  ok(cr.ok && cr.episode.success === true, '成功 episode 巩固成功(前置)')
  const cf = hub.crossFeed('sesr_X')
  ok(cf.ok && cf.fed.some((f) => f.to === 'procedure' && f.outcome === 'observed'), 'crossFeed 仍产出 procedure 观察(m81-hub 兼容)')
  const list = procs.query()
  ok(list.length === 1, '入店 1 条候选')
  const p = list[0]
  ok(p.observationOnly === true, '候选带 observationOnly=true(如实标记,不再假装可晋升)')
  ok(Array.isArray(p.sourceMemoryIds) && p.sourceMemoryIds.length === 0, 'sourceMemoryIds 为空(episode 侧无 memoryId,事实如此)')
  ok(!p.steps.some((s) => /: user$/.test(s)), 'steps 不再产出「…: user」垃圾(P3)')
  ok(p.steps.length >= 1 && p.steps[0].length > 0, 'steps 退化为 intent 雏形,非空')
  // promote 首闸:observation-only(优先于 diversity/success 门槛,不再给误导性 reason)
  const r1 = procs.promote(p.procedureId)
  ok(r1.ok === true && r1.decision === 'keep', 'promote 仍 fail-safe 返回 keep')
  ok(Array.isArray(r1.reasonCodes) && r1.reasonCodes[0] === 'observation-only', 'reasonCodes=[observation-only](旧实现是 diversity-below-3,看似可修复实则永远差同一处)')
  // 即便硬塞过闸证据(extraEvidence),观察型仍 keep —— 候选本质不可自证
  const r2 = procs.promote(p.procedureId, { distinctSessions: 9, successCount: 9 })
  ok(r2.decision === 'keep' && r2.reasonCodes[0] === 'observation-only', 'extraEvidence 也不绕过观察闸(episode 无 memoryId,证据本就不可信)')
  // 人工管理路径不受影响
  ok(procs.setPinned(p.procedureId, true).ok, '置顶路径不受影响')
  ok(procs.deprecate(p.procedureId, 'user-disabled').ok, '弃用路径不受影响(用户可清理队列)')
}

console.log('[P2] 注入 intent → crossFeed 跳过(宁缺毋滥)')
{
  const hub = makeHub()
  const eps = hub.stores.episodic
  // 采集层漏网兜底:consolidate 全污染退化取最后一条 → intent=注入文本 → crossFeed 必须跳过
  eps.append({ kind: 'user', userText: 'Current DSH file policy: danger-full-access — runtime injected', sessionRef: 'sesr_Y', eventSeq: 1 })
  eps.append({ kind: 'assistant', assistantText: '部署成功完成', sessionRef: 'sesr_Y', eventSeq: 2 })
  eps.consolidate()
  const cf = hub.crossFeed('sesr_Y')
  ok(cf.ok && !cf.fed.some((f) => f.to === 'procedure'), '注入 intent 不再成为技能标题(issue 实录:Current DSH file policy: danger-full-acc)')
}

console.log('[P4] judgement-shadow 路径不受影响(带 sourceIds 仍走真实闸门)')
{
  const hub = makeHub()
  const procs = hub.stores.procedures
  const row = { kindCandidate: 'procedure_candidate', suggestion: 'keep_suggest', sourceIds: ['mem_3'], title: '发布流程', excerpt: '构建→测试→部署', successCriteria: ['部署完成且健康检查通过'], confidence: 0.6 }
  const cand = procedureCandidateFromRow(row)
  ok(cand && Array.isArray(cand.sourceMemoryIds) && cand.sourceMemoryIds.length === 1, 'procedureCandidateFromRow 带真实 sourceIds')
  const r = hub.ingestJudgement(row)
  ok(r.consumed === 'procedure', 'judgement 行照常入店')
  const p = procs.query()[0]
  ok(!p.observationOnly, 'judgement 来源不带 observationOnly(可自证路径保持可晋升)')
  const r1 = procs.promote(p.procedureId)
  ok(r1.decision === 'keep' && r1.reasonCodes[0] === 'diversity-below-3', '无证据时仍是多样性闸(真实门槛语义不变)')
  procs.addEvidence(p.procedureId, { kind: 'success', sessionRef: 's1' })
  procs.addEvidence(p.procedureId, { kind: 'success', sessionRef: 's2' })
  procs.addEvidence(p.procedureId, { kind: 'success', sessionRef: 's3' })
  const r2 = procs.promote(p.procedureId)
  ok(r2.decision === 'promote' && procs.query({ stage: 'validated' }).length === 1, '证据达标后 judgement 候选可正常晋升(设计路径完好)')
}

console.log('[P5] 校验与持久化往返')
{
  const v1 = validateProcedureCandidatePre({ title: 'x', steps: ['a'], observationOnly: true })
  ok(v1.ok, '候选校验放行布尔 observationOnly')
  const v2 = validateProcedureCandidatePre({ title: 'x', steps: ['a'], observationOnly: 'yes' })
  ok(!v2.ok && /observationOnly/.test(v2.reason), '非布尔 observationOnly 拒绝')
  const io = memIO()
  const st = createProcedureStorePre({ io: io.io, now })
  const o = st.observe({ title: '观察流程', riskLevel: 'low', steps: ['s'], observationOnly: true })
  ok(o.ok && o.procedure.observationOnly === true, 'observe 落字段')
  const pv = validateProcedurePre({ ...o.procedure, procedureId: o.procedure.procedureId })
  ok(pv.ok, 'procedure 校验放行布尔 observationOnly')
  const st2 = createProcedureStorePre({ io: io.io, now })
  st2.restore(io.saved)
  ok(st2.query()[0] && st2.query()[0].observationOnly === true, 'snapshot → restore 往返保留 observationOnly')
  // 普通候选零字段污染(向后兼容旧快照)
  const io2 = memIO()
  const st3 = createProcedureStorePre({ io: io2.io, now })
  const o2 = st3.observe({ title: '普通流程', riskLevel: 'low', steps: ['s'] })
  ok(o2.ok && o2.procedure.observationOnly === undefined, '未标记的候选不含 observationOnly 字段(快照零污染)')
  ok(st3.promote(o2.procedure.procedureId).reasonCodes[0] === 'diversity-below-3', '普通候选闸门语义完全不变')
}

console.log('[P6] overview 审批队列表透出 observationOnly')
{
  const hub = makeHub()
  const eps = hub.stores.episodic
  eps.append({ kind: 'user', userText: '整理并归档报告文件', sessionRef: 'sesr_Z', eventSeq: 1 })
  eps.append({ kind: 'assistant', assistantText: '归档成功完成', sessionRef: 'sesr_Z', eventSeq: 2 })
  eps.consolidate()
  hub.crossFeed('sesr_Z')
  const ov = hub.overview()
  const entry = ov.procedures.pipeline.find((x) => x.title)
  ok(entry && entry.observationOnly === true, 'pipeline 行带 observationOnly(前端据此打观察标)')
}

console.log('[G1] 源码守卫:index.js 日志 / client.js 面板')
ok(/hub review: ' \+ action \+ ' ' \+ pid\.slice\(0, 20\) \+ ' → ' \+ JSON\.stringify\(\{ ok: r\.ok, decision: r\.decision, reason: r\.reason, reasonCodes: r\.reasonCodes \}\)/.test(INDEX_SRC),
  'index.js hub review 日志记录 decision+reasonCodes(不再只记 ok 的假阳性)')
ok(/\(j && Array\.isArray\(j\.reasonCodes\) && j\.reasonCodes\.length \? ' \(' \+ j\.reasonCodes\.join\(', '\)/.test(CLIENT_SRC), 'client.js hubAct 内联追加显示 reasonCodes')
ok(/observationOnly \? \(locale === 'zh' \? ' · 观察/.test(CLIENT_SRC), 'client.js 审批队列为观察型条目打标')
ok(/!p\.observationOnly && h\('button'[\s\S]{0,220}?hubAct\('promote'/.test(CLIENT_SRC), 'client.js 观察型条目隐藏晋升按钮')

console.log('\n[issue30] ' + pass + ' passed, ' + fail + ' failed')
if (fail > 0) process.exit(1)

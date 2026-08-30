// M8 Memory Hub 综合验证(episodic → semantic → procedural 全链路)
// H1 episodic: 段追加/巩固/保留/失败默认 candidate
// H2 procedure: observe → promote 门槛(多样性/成功/correction) → active → checklist 渲染
// H3 procedure: 高风险需批准 + 一次成功不足以晋升(元代码铁律)
// H4 hub 编排: judgement-shadow 消费(三类候选分流) + crossFeed + renderChecklists
// H5 持久化: 三层各自 save/restore
// H6 卫生
import { createEpisodicStorePre } from './lib/episodic-store-pre.js'
import { createProcedureStorePre } from './lib/procedure-store-pre.js'
import { createFactStorePre } from './lib/fact-store-pre.js'
import { createMemoryHubPre, factCandidateFromRow, procedureCandidateFromRow } from './lib/memory-hub-pre.js'
import { readFileSync } from 'node:fs'

let pass = 0, fail = 0
const ok = (c, n) => { if (c) { pass++; console.log('  ok - ' + n) } else { fail++; console.error('  FAIL - ' + n) } }
const memIO = () => { let s = null; return { io: { save: (v) => { s = v }, load: () => s, clear: () => { s = null } }, get saved() { return s } } }
let fakeNow = 1000000
const now = () => fakeNow

console.log('[H1] episodic 生命周期')
{
  const st = createEpisodicStorePre({ now })
  // 追加 3 段(2 用户 + 1 助手, 成功信号)
  st.append({ kind: 'user', userText: '帮我部署这个服务到服务器', sessionRef: 'sesr_A', eventSeq: 1, contextVersion: 1 })
  st.append({ kind: 'assistant', assistantText: '好的,先备份再 rsync,已完成', sessionRef: 'sesr_A', eventSeq: 2, contextVersion: 1 })
  st.append({ kind: 'user', userText: '确认没问题,测试通过了', sessionRef: 'sesr_A', eventSeq: 3, contextVersion: 1 })
  const c = st.consolidate()
  ok(c.ok && c.episode && c.episode.episodeId.match(/^epi_pre_/), '巩固成功 + epi_pre_ id')
  ok(c.episode.intent.includes('部署'), 'intent 提取自首段用户文本')
  ok(c.episode.outcome === 'success' && c.episode.success === true, 'outcome 推断 success(助手文本含完成信号)')
  ok(st.size === 1, 'store 大小=1')
  // 太短丢弃
  const st2 = createEpisodicStorePre({ now })
  st2.append({ kind: 'user', userText: 'hi', sessionRef: 'sesr_B', eventSeq: 1 })
  const c2 = st2.consolidate()
  ok(!c2.ok && c2.reason === 'too-short', '少于 minSegments 丢弃(too-short)')
  // 失败信号 → failure(不直接是事实)
  const st3 = createEpisodicStorePre({ now })
  st3.append({ kind: 'user', userText: '执行迁移脚本', sessionRef: 'sesr_C', eventSeq: 1 })
  st3.append({ kind: 'assistant', assistantText: '执行失败,报错了,错误信息如下', sessionRef: 'sesr_C', eventSeq: 2 })
  st3.append({ kind: 'user', userText: '再看看', sessionRef: 'sesr_C', eventSeq: 3 })
  const c3 = st3.consolidate()
  ok(c3.ok && c3.episode.outcome === 'failure' && c3.episode.success === false, '失败 episode → failure 不标成功')
}

console.log('[H2] procedure 晋升全链路(核心)')
{
  const io = memIO()
  const st = createProcedureStorePre({ io: io.io, now })
  // observe 一个部署流程
  const r1 = st.observe({ title: '服务器部署流程', riskLevel: 'low', steps: ['备份', 'rsync', '重启服务'], successCriteria: ['curl 健康检查通过'], sourceMemoryIds: ['mem_a'] })
  ok(r1.ok && r1.procedure.stage === 'observed', 'observe → observed')
  // 去重: 同 title 再 observe → merged
  const r2 = st.observe({ title: '服务器部署流程', riskLevel: 'low', steps: ['备份'], sourceMemoryIds: ['mem_b'] })
  ok(r2.merged === true, '同 title 去重合并')
  // 未达门槛: diversity=1 < 3 → keep
  st.addEvidence(r1.procedure.procedureId, { kind: 'success', sessionRef: 'sesr_1' })
  const p1 = st.promote(r1.procedure.procedureId)
  ok(p1.decision === 'keep' && p1.reasonCodes[0].startsWith('diversity'), 'diversity=1 → keep')
  // 达到 diversity=3 + success=2
  st.addEvidence(r1.procedure.procedureId, { kind: 'success', sessionRef: 'sesr_2' })
  st.addEvidence(r1.procedure.procedureId, { kind: 'success', sessionRef: 'sesr_3' })
  const p2 = st.promote(r1.procedure.procedureId, { distinctSessions: 3, successCount: 2 })
  ok(p2.decision === 'promote' && p2.procedure.stage === 'validated', 'diversity=3 + success=2 → promote(validated)')
  // 激活 → active
  const a = st.activate(r1.procedure.procedureId)
  ok(a.ok && a.procedure.stage === 'active', 'activate → active')
  // 渲染 checklist
  const cl = st.renderChecklist(r1.procedure.procedureId)
  ok(cl && cl.level === 'checklist' && cl.text.includes('备份') && cl.text.includes('rsync'), 'checklist 渲染含步骤')
  ok(cl.text.includes('完成标准'), 'checklist 含完成标准')
  // correction 爆表 → 不能晋升
  const st2 = createProcedureStorePre({ now })
  const o = st2.observe({ title: '有问题的流程', riskLevel: 'low', steps: ['x'], successCriteria: ['y'] })
  st2.addEvidence(o.procedure.procedureId, { kind: 'success', sessionRef: 's1' })
  st2.addEvidence(o.procedure.procedureId, { kind: 'correction', sessionRef: 's1' })
  const p3 = st2.promote(o.procedure.procedureId, { distinctSessions: 5, successCount: 2 })
  ok(p3.decision === 'keep' && p3.reasonCodes.some((r) => r.startsWith('correction')), 'correction 爆表 → keep')
}

console.log('[H3] procedure 高风险 + 一次成功铁律')
{
  const st = createProcedureStorePre({ now }) // 无 approveFn → ask
  const o = st.observe({ title: 'SSH 生产环境操作', riskLevel: 'high', steps: ['ssh', '执行'], successCriteria: ['确认'] })
  const p = st.promote(o.procedure.procedureId, { distinctSessions: 5, successCount: 3 })
  ok(p.decision === 'ask' && p.reasonCodes.includes('high-risk-awaiting-approval'), '高风险无批准 → ask')
  // 有 approveFn 批准后晋升
  let approved = false
  const st2 = createProcedureStorePre({ now, approve: () => { approved = true; return { approved: true } } })
  const o2 = st2.observe({ title: 'SSH 生产操作', riskLevel: 'high', steps: ['ssh'], successCriteria: ['ok'] })
  const p2 = st2.promote(o2.procedure.procedureId, { distinctSessions: 5, successCount: 3 })
  ok(p2.decision === 'promote' && approved === true, '高风险经批准 → promote')
  // 一次成功不足以晋升(元代码铁律): success=1 但 diversity=5
  const st3 = createProcedureStorePre({ now })
  const o3 = st3.observe({ title: '单次成功流程', riskLevel: 'low', steps: ['x'], successCriteria: ['y'] })
  const p3 = st3.promote(o3.procedure.procedureId, { distinctSessions: 5, successCount: 1 })
  ok(p3.decision === 'keep' && p3.reasonCodes.some((r) => r.startsWith('success')), '一次成功 → keep(铁律)')
  // 高风险渲染 → hint 降级
  const st4 = createProcedureStorePre({ now, approve: () => ({ approved: true }) })
  const o4 = st4.observe({ title: '删除操作', riskLevel: 'high', steps: ['rm'], successCriteria: ['ok'] })
  st4.promote(o4.procedure.procedureId, { distinctSessions: 5, successCount: 3 })
  st4.activate(o4.procedure.procedureId)
  const cl = st4.renderChecklist(o4.procedure.procedureId)
  ok(cl && cl.level === 'hint' && cl.text.includes('确认'), '高风险 active → hint 降级(不自动给步骤)')
}

console.log('[H4] hub 编排')
{
  const io = memIO()
  const episodic = createEpisodicStorePre({ now })
  const facts = createFactStorePre({ io: io.io, now })
  const procedures = createProcedureStorePre({ io: io.io, now })
  const hub = createMemoryHubPre({ stores: { episodic, facts, procedures }, now })
  // judgement-shadow 三类候选分流
  const rows = [
    { kindCandidate: 'semantic_candidate', suggestion: 'keep_suggest', sourceIds: ['mem_1'], subject: '项目', predicate: '构建工具', object: 'esbuild', scope: 'Workspace', confidence: 0.8 },
    { kindCandidate: 'profile_candidate', suggestion: 'keep_suggest', sourceIds: ['mem_2'], subject: '偏好', predicate: '语言', object: 'python', scope: 'User', confidence: 0.7 },
    { kindCandidate: 'procedure_candidate', suggestion: 'keep_suggest', sourceIds: ['mem_3'], title: '发布流程', excerpt: '构建→测试→部署', confidence: 0.6 },
    { kindCandidate: 'noise', suggestion: 'discard_suggest', sourceIds: ['mem_4'], confidence: 0.1 },
  ]
  const r = hub.ingestJudgementRows(rows)
  ok(r.results.length === 4, '4 行全处理')
  ok(r.results[0].consumed === 'semantic' && r.results[1].consumed === 'semantic', 'semantic/profile → fact store')
  ok(r.results[2].consumed === 'procedure', 'procedure_candidate → procedure store')
  ok(r.results[3].skipped === true, 'noise 跳过')
  ok(facts.size === 2, 'fact store 2 条')
  ok(procedures.size === 1, 'procedure store 1 条(observed)')
  // crossFeed: episode 成功 → procedure 观察
  episodic.append({ kind: 'user', userText: '执行发布', sessionRef: 'sesr_X', eventSeq: 1 })
  episodic.append({ kind: 'assistant', assistantText: '发布成功完成', sessionRef: 'sesr_X', eventSeq: 2 })
  episodic.append({ kind: 'user', userText: '好', sessionRef: 'sesr_X', eventSeq: 3 })
  episodic.consolidate()
  const cf = hub.crossFeed('sesr_X')
  ok(cf.ok && cf.fed.some((f) => f.to === 'procedure'), '成功 episode crossFeed → procedure 观察')
  // renderChecklists
  const actives = hub.renderChecklists()
  ok(Array.isArray(actives), 'renderChecklists 返回数组')
  // overview 快照
  const ov = hub.overview()
  ok(ov.episodic && ov.facts && ov.procedures, 'overview 三栏齐全')
}

console.log('[H5] 持久化')
{
  // fact store 持久化已在 m80 验证;这里验证 procedure + hub 快照
  const io = memIO()
  const st = createProcedureStorePre({ io: io.io, now })
  const o = st.observe({ title: '部署', riskLevel: 'low', steps: ['a', 'b'], successCriteria: ['ok'] })
  st.addEvidence(o.procedure.procedureId, { kind: 'success', sessionRef: 's1' })
  st.promote(o.procedure.procedureId, { distinctSessions: 3, successCount: 2 })
  st.activate(o.procedure.procedureId)
  ok(io.saved && io.saved.procedures.length === 1 && io.saved.procedures[0].stage === 'active', 'procedure save 落盘')
  const st2 = createProcedureStorePre({ io: io.io, now })
  const r = st2.restore(io.saved)
  ok(r.ok && r.restored === 1 && st2.query({ stage: 'active' }).length === 1, 'restore 恢复 active')
  // hub snapshot 三栏
  const hub = createMemoryHubPre({ stores: { episodic: createEpisodicStorePre({ now }), facts: createFactStorePre({ now }), procedures: createProcedureStorePre({ now }) }, now })
  const snap = hub.snapshot()
  ok(snap.episodic && snap.facts && snap.procedures, 'hub snapshot 三栏')
}

console.log('[H6] 卫生')
{
  for (const f of ['./lib/episodic-store-pre.js', './lib/procedure-store-pre.js', './lib/memory-hub-pre.js']) {
    const src = readFileSync(new URL(f, import.meta.url), 'utf8')
    const code = src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^\s*\/\/.*$/gm, ' ')
    const bad = ['child' + '_process', 'node:' + 'net', 'node:' + 'http', 'spaw' + 'n', 'exec' + 'File', 'fetch' + '(']
    ok(!bad.some((b) => code.includes(b)), f.split('/').pop() + ' 零进程/网络原语')
  }
}

console.log(`[M8-HUB] pass=${pass} fail=${fail}`)
process.exit(fail > 0 ? 1 : 0)

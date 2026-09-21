#!/usr/bin/env node
// T4 回归锁定(2026-09-19 用户拍板「让大模型来介入 procedure memory」)。
//
// 背景(实测):此前三条记忆线(episodic/semantic/procedural)**全部只有机械生成**,零模型入口。
//   procedural 线唯一来源是 memory-hub-pre.js 的 crossFeed —— 它把每个"成功 episode"机械切成候选,
//   而 episode 的 actions 恒为 ['user','user','user'] ⇒ 14 条里 13 条 evidence 全 0 / successCriteria 全 0 /
//   steps 是 "步骤1: user" 占位符。清洗器只能删信封文字,**无法把 ['user','user','user'] 变成有价值的流程**。
//
// 本批新增 memory_procedure_pre 模型直写通路 + promote() 的 opts.authorizedBy 授权跳门。
// 本文件锁死:
//   T4-1 向后兼容:不传 opts 时,两条统计门**逐字节不变**(diversity/success 照拦)
//   T4-2 授权生效:authorizedBy='model' 时跳过两条统计门,decision 变 promote
//   T4-3 授权**不能**突破的结构门:observationOnly 短路 / 必须有 successCriteria / correction 阻止
//   T4-4 授权留痕:p.authorizedBy 落盘 + reasonCodes 含 'model-authorized'
//   T4-5 工具存在性:index.js 真注册了 memory_procedure_pre(定义 + 收进 tools 数组两步)
//   T4-6 注入语存在:renderMemoryStatic 里真有那条技能库直写引导
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createProcedureStorePre, PROCEDURE_DEFAULT_GATES_PRE_V1 } from '../../lib/procedure-store-pre.js'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const INDEX_SRC = readFileSync(path.resolve(HERE, '..', '..', 'lib', 'index.js'), 'utf8')

let pass = 0, fail = 0
const ok = (c, n) => { if (c) { pass++; console.log('  ok - ' + n) } else { fail++; console.error('  FAIL - ' + n) } }
const memIO = () => { let s = null; return { io: { save: (v) => { s = v }, load: () => s, clear: () => { s = null } }, get saved() { return s } } }
let fakeNow = 2000000
const now = () => ++fakeNow

/** 造一个"模型写的真技能":有 steps + successCriteria,但**零证据**(diversity=0/success=0)。 */
function richCandidate(over = {}) {
  return {
    title: '发布前跑全量回归并核对 SHA256',
    steps: ['先备份目标文件', '跑全量回归', '核对三个文件的 SHA256 与原值一致'],
    successCriteria: ['全量回归 FAIL=0', 'SHA256 逐字节一致'],
    riskLevel: 'low', origin: 'agent',
    sourceMemoryIds: [], sourceEpisodes: [],
    ...over,
  }
}
const mk = () => { const m = memIO(); return { st: createProcedureStorePre({ io: m.io, now }), m } }

console.log('[T4-1] 向后兼容:不传 opts ⇒ 两条统计门逐字节照拦(授权特性不得改变既有行为)')
{
  const { st } = mk()
  const r = st.observe(richCandidate())
  const pid = r.procedure.procedureId
  const pr = st.promote(pid) // ← 不传第三参
  ok(pr.ok === true && pr.decision === 'keep', '零证据 + 无授权 ⇒ decision=keep(不晋升)')
  ok(String((pr.reasonCodes || []).join(',')) === 'diversity-below-' + PROCEDURE_DEFAULT_GATES_PRE_V1.minSessionDiversity,
    '原因码恰为 diversity-below-' + PROCEDURE_DEFAULT_GATES_PRE_V1.minSessionDiversity + '(未被 model-authorized 污染)')
  ok(pr.procedure === undefined || pr.procedure.authorizedBy === undefined, '未被授权 ⇒ 不写 authorizedBy')
  // 传空对象 opts 也必须与不传等价
  const pr2 = st.promote(pid, {}, {})
  ok(pr2.decision === 'keep' && String((pr2.reasonCodes || []).join(',')) === 'diversity-below-' + PROCEDURE_DEFAULT_GATES_PRE_V1.minSessionDiversity,
    'opts={} 与不传等价(空授权不放行)')
}

console.log('\n[T4-2] 授权生效:authorizedBy=model ⇒ 跳过两条统计门,decision 变 promote')
{
  const { st } = mk()
  const r = st.observe(richCandidate())
  const pid = r.procedure.procedureId
  const pr = st.promote(pid, {}, { authorizedBy: 'model' })
  ok(pr.ok === true && pr.decision === 'promote', '零证据 + 模型授权 ⇒ decision=promote(跳过 diversity/success)')
  ok((pr.reasonCodes || []).includes('model-authorized'), 'reasonCodes 含 model-authorized(留痕)')
  ok(pr.procedure && pr.procedure.stage === 'validated', '阶段已推进到 validated')
  // success 门也一并跳过(造一个 diversity 够但 success 不够的场景是同一分支,直接用零证据已覆盖两条)
  const ar = st.activate(pid)
  ok(ar.ok === true && ar.procedure.stage === 'active', '授权晋升后可正常 activate → active(可被召回)')
}

console.log('\n[T4-3] 授权**不能**突破的结构门(护栏必须仍然有效)')
{
  // (a) observationOnly 短路 —— 机械生成的空壳行,授权也不放行
  const { st } = mk()
  const r = st.observe({ title: 'Current runtime context. This snapshot s', steps: ['观察任务：x'], observationOnly: true, sourceEpisodes: ['epi_pre_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'], sourceMemoryIds: [] })
  const pr = st.promote(r.procedure.procedureId, {}, { authorizedBy: 'model' })
  ok(pr.decision === 'keep' && (pr.reasonCodes || []).includes('observation-only'),
    '★ observationOnly 行即便模型授权也是 keep/observation-only(结构上不该晋升)')

  // (b) 必须有 successCriteria —— 没写验收标准的不算技能
  const { st: st2 } = mk()
  const r2 = st2.observe(richCandidate({ successCriteria: [] }))
  const pr2 = st2.promote(r2.procedure.procedureId, {}, { authorizedBy: 'model' })
  ok(pr2.decision === 'keep' && (pr2.reasonCodes || []).includes('no-success-criteria'),
    '★ 缺 successCriteria 即便授权也是 keep/no-success-criteria')

  // (c) correction 阻止 —— 有纠正记录说明这流程是错的
  // ★ 夹具注意:addEvidence(pid, ev) 要求 ev.kind ∈ ['seen','read','cite','reuse','success','correction'];
  //   本套件初版误写成 { correction: 1 } ⇒ 返回 bad-evidence 静默不生效 ⇒ 假红(与 T3 探针同一类坑)。
  const { st: st3 } = mk()
  const r3 = st3.observe(richCandidate())
  const pid3 = r3.procedure.procedureId
  const ae = st3.addEvidence(pid3, { kind: 'correction' })
  ok(ae.ok === true, '夹具自检:correction 证据已真实写入(addEvidence 返回 ok)')
  const pr3 = st3.promote(pid3, {}, { authorizedBy: 'model' })
  ok(pr3.decision === 'keep', '★ 有 correction 记录即便授权也不晋升')
  ok((pr3.reasonCodes || []).some((c) => c === 'has-correction' || String(c).startsWith('correction-rate-')),
    '原因是 has-correction 或 correction-rate-*')

  // (d) deprecated 短路 —— 已弃用的不得复活
  const { st: st4 } = mk()
  const r4 = st4.observe(richCandidate())
  const pid4 = r4.procedure.procedureId
  st4.deprecate(pid4, 'user-disabled')
  const pr4 = st4.promote(pid4, {}, { authorizedBy: 'model' })
  ok(pr4.decision === 'keep' && (pr4.reasonCodes || []).includes('deprecated'),
    '★ 已弃用条目即便授权也是 keep/deprecated')
}

console.log('\n[T4-4] 授权留痕:authorizedBy 落盘 + snapshot/restore 往返保留')
{
  const m = memIO()
  const st = createProcedureStorePre({ io: m.io, now })
  const r = st.observe(richCandidate())
  const pid = r.procedure.procedureId
  st.promote(pid, {}, { authorizedBy: 'model' })
  ok(st.get(pid).authorizedBy === 'model', 'procedure.authorizedBy === "model"(可审计/前端可展示)')
  const saved = m.saved
  const row = (saved && saved.procedures || []).find((p) => p.procedureId === pid)
  ok(row && row.authorizedBy === 'model', '已随 snapshot 落盘(不是仅内存)')
  const st2 = createProcedureStorePre({ io: memIO().io, now })
  const rr = st2.restore(saved)
  ok(rr.ok === true && st2.get(pid).authorizedBy === 'model', 'restore 往返后 authorizedBy 仍在')

  // 未授权的晋升不得凭空写出 authorizedBy
  // ★ 夹具注意(本套件第三次踩同一坑):正确签名是 addEvidence(pid, { kind, sessionRef })。
  //   门限:minSessionDiversity=3(需 ≥3 个**不同** sessionRef)/ minSuccessCount=2(需 ≥2 次 kind='success')。
  const { st: st3 } = mk()
  const r3 = st3.observe(richCandidate())
  const pid3 = r3.procedure.procedureId
  for (let i = 0; i < 4; i++) st3.addEvidence(pid3, { kind: 'success', sessionRef: 's' + i })
  const ev3 = st3.get(pid3).evidence
  ok(ev3.sessions >= 3 && ev3.success >= 2,
    '夹具自检:证据已达门限(sessions=' + ev3.sessions + ' success=' + ev3.success + ')')
  const pr3 = st3.promote(pid3) // 证据够了,正常晋升
  ok(pr3.decision === 'promote' && st3.get(pid3).authorizedBy === undefined,
    '证据充分正常晋升 ⇒ 不写 authorizedBy(两种来源可区分)')
}

console.log('\n[T4-5] 工具真实注册(两道都要:定义 + 收进 tools 数组)')
{
  ok(INDEX_SRC.includes("defineTool('memory_procedure_pre'"), '① index.js 里有 defineTool(\'memory_procedure_pre\')')
  // BUG-15 教训:defineTool 写在数组之外 ⇒ 永不注册。故必须确认它在 tools 数组内(用紧邻上下文判定)。
  const arrStart = INDEX_SRC.indexOf('const tools = [')
  const arrEnd = INDEX_SRC.indexOf('\n  ]', arrStart)
  const body = arrStart >= 0 && arrEnd > arrStart ? INDEX_SRC.slice(arrStart, arrEnd) : ''
  ok(arrStart >= 0 && arrEnd > arrStart, 'tools 数组边界可定位')
  ok(body.includes("defineTool('memory_procedure_pre'"),
    '② 定义**位于 tools 数组体内**(不是数组外——BUG-15 同款缺陷)')
  // 关键能力必须在描述里写明(模型靠描述决定何时调用)
  const descStart = body.indexOf("defineTool('memory_procedure_pre'")
  const desc = body.slice(descStart, descStart + 1800)
  ok(/successCriteria/.test(desc), '描述里提到 successCriteria(否则模型不知道要填)')
  ok(/activate/.test(desc) && /write/.test(desc), '描述里讲清 write / activate 两种 action')
  ok(/审批列表/.test(desc), '描述里说明 write 进审批列表')
  // 数组内还必须有 steps 必填与换行分隔说明
  ok(/steps/.test(desc) && /一行一步/.test(desc), '描述里说明 steps 一行一步')
}

console.log('\n[T4-6] 每轮注入语存在(renderMemoryStatic 里真有技能库直写引导)')
{
  ok(INDEX_SRC.includes('★技能库(procedure memory)直写') || INDEX_SRC.includes('memory_procedure_pre') ,
    '注入文案提到 procedure memory 直写')
  // 必须落在 renderMemoryStatic 内(否则不会注入)
  const rs = INDEX_SRC.indexOf('renderMemoryStatic()')
  const rsEnd = INDEX_SRC.indexOf('renderReflectionRequest()', rs)
  const seg = rs >= 0 && rsEnd > rs ? INDEX_SRC.slice(rs, rsEnd) : ''
  ok(seg.includes('memory_procedure_pre'), '★ 该文案位于 renderMemoryStatic() 方法体内(会真的注入)')
  ok(/不写就没有/.test(seg), '文案点明"不写就没有"——强调这是唯一模型入口')
  ok(/没有 successCriteria 的条目结构上永远无法晋升/.test(seg), '文案警示缺 successCriteria 的后果')
}

console.log('\n[T4-7] 源码级锁定:promote 的授权分支形状(防日后被"顺手重构"掉)')
{
  const PS = readFileSync(path.resolve(HERE, '..', '..', 'lib', 'procedure-store-pre.js'), 'utf8')
  ok(/function promote\(procedureId, extraEvidence = \{\}, opts = \{\}\)/.test(PS),
    'promote 签名含第三参 opts(缺省 {} ⇒ 老调用方零改动)')
  ok(/const authorizedBy = opts && opts\.authorizedBy \? String\(opts\.authorizedBy\) : ''/.test(PS),
    '授权取自 opts.authorizedBy 且**不传即空串**')
  // 统计门必须整体被 !authorizedBy 包住(而不是逐行加条件——后者易漏)
  ok(/if \(!authorizedBy\) \{\s*\n\s*if \(diversity < gates\.minSessionDiversity\)/.test(PS),
    '★ 两条统计门被同一个 if (!authorizedBy) 整体包住')
  // observationOnly 短路必须在授权读取**之前**(授权也无法绕过)
  // ★2026-09-21 放宽:此前用精确返回字面量 indexOf 定位,但 promote() 现已带 `promoted` 字段
  //   (P2-5 修复),字面量一变断言就断。改为只锚定**调用点**,语义不变、不再锁定返回形状。
  const iObs = PS.indexOf('if (isObservationOnlyPre(p))')
  const iAuth = PS.indexOf("const authorizedBy = opts && opts.authorizedBy")
  ok(iObs > 0 && iAuth > 0 && iObs < iAuth, '★ observationOnly 短路在授权读取之前(结构门优先于授权)')
  // no-success-criteria 必须在授权块**之后**(即授权不放行它)
  const iCrit = PS.indexOf("reason.push('no-success-criteria')")
  ok(iCrit > iAuth, '★ no-success-criteria 检查在授权块之后(授权不放行)')
  ok(/if \(authorizedBy\) p\.authorizedBy = authorizedBy/.test(PS), '晋升成功时写 p.authorizedBy')
}

console.log('\n' + (fail === 0 ? `全部通过 (${pass}/${pass})` : `${pass} 通过 / ${fail} 失败`))
process.exit(fail === 0 ? 0 : 1)

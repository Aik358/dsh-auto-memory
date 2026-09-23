#!/usr/bin/env node
/** [issue132-tail-brace] 激活尾注注入路径缺双花括号中和(用户报告 #132)。
 *
 * 病例:reference 正文含双花括号(例:记忆里写了 Vue 的 count 插值 / 提示词变量用法)时,
 * 尾注经 systemPrompt.context() 进入宿主 dsh-system-prompt 的严格插值 —— 变量名含大写判
 * malformed、未注册名判 unknown,两条都抛错并中止整轮装配 ⇒ 该会话每轮模型请求全失败。
 * 根因:sanitizeTailText(guard v1)只做控制符剔除/注释剥离/空格折叠/换行折叠,不碰双花括号。
 *
 * 修法:guard v1 → v2,在 sanitizeTailText 内施加与 lib/index.js neutralizePromptTemplateVars
 * 同口径的全角等长替换。放在渲染器内部 ⇒ build 与重渲染两侧 exactDigest 自然一致。
 *
 * 本套件同时守卫:①任意输入不再产出宿主可抛错形态 ②digest 往返一致 ③主快照口径一致。 */
import path from 'node:path'
import { readFileSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, '..', '..')
const A = await import(pathToFileURL(path.join(ROOT, 'lib', 'activation-inbox.js')).href)

let pass = 0, fail = 0
const ok = (c, n) => { if (c) { pass++; console.log('  ok -', n) } else { fail++; console.error('  FAIL -', n) } }

// 宿主严格插值:优先真实包,拿不到则退化为结构不变量断言(见 G3)。
const LB = String.fromCharCode(123) + String.fromCharCode(123)   // 双花括号,避免脚本自身被扫
const RB = String.fromCharCode(125) + String.fromCharCode(125)
async function loadHostInterpolator() {
  const tries = ['@deepseek-ai/dsh-system-prompt']
  const appData = process.env.APPDATA || ''
  if (appData) {
    tries.push(pathToFileURL(path.join(appData, 'npm', 'node_modules', '@deepseek-ai', 'dsh', 'node_modules', '@deepseek-ai', 'dsh-system-prompt', 'lib', 'index.js')).href)
  }
  for (const t of tries) {
    try { const m = await import(t); if (typeof m.renderContextSections === 'function') return m.renderContextSections } catch (_) {}
  }
  return null
}
const renderContextSections = await loadHostInterpolator()

const item = (reference) => ({
  memoryId: 'mem_' + 'a'.repeat(32), recordDigest: 'a'.repeat(64), scope: 'Workspace',
  sourceVersion: 3, score: 0.91, anchorId: 'anc_1', sourceRef: 'workspace:x', reference,
})
const renderOne = (reference) => A.renderReferenceTail([item(reference)], { reason: 'semantic activation' })

console.log('[issue132] G1 sanitizeTailText guard v2:双花括号中和')
{
  const cases = [
    ['大写变量', 'project 里 Vue 模板用 ' + LB + ' count ' + RB + ' 做插值'],
    ['小写变量', '提示词变量 ' + LB + 'footer' + RB + ' 的用法'],
    ['嵌套形态', '条件 ' + LB + ' a {b} c ' + RB + ' 结束'],
    ['孤立开口', '光秃秃的 ' + LB + ' 不闭合'],
    ['孤立闭合', '只有 ' + RB + ' 闭合'],
  ]
  for (const [name, raw] of cases) {
    const out = A.sanitizeTailText(raw)
    ok(!out.includes(LB) && !out.includes(RB), name + ' ⇒ 输出不含任何 ASCII 双花括号')
  }
  ok(A.sanitizeTailText('') === '' && A.sanitizeTailText(null) === '', '空/null 安全')
  const json = '{"a":1,"b":[2,3]}'
  ok(A.sanitizeTailText(json) === json, '单花括号/JSON 原样保留(不误伤)')
  const code = 'function f(x) { return { x } }'
  ok(A.sanitizeTailText(code) === code, '普通代码块原样保留')
  ok(A.sanitizeTailText(A.sanitizeTailText(LB + 'x' + RB)) === A.sanitizeTailText(LB + 'x' + RB), '幂等(二次中和结果不变)')
  ok(A.sanitizeTailText(LB + 'baseUrl' + RB).includes('｛｛baseUrl｝｝'), '全角改写且对人可读')
}

console.log('[issue132] G2 渲染器出口:宿主校验零命中')
{
  const r = renderOne('记忆正文:GET ' + LB + 'baseUrl' + RB + '/v1/usage,headers Bearer ' + LB + 'apiKey' + RB)
  ok(r.ok === true, 'renderReferenceTail 仍 ok')
  ok(!String(r.text).includes(LB) && !String(r.text).includes(RB), '渲染文本不含任何 ASCII 双花括号(宿主校验零命中)')
  ok(String(r.text).includes('Reference: '), '固定边界 Reference 行仍在')
}

console.log('[issue132] G2b 出口兜底:身份行与技能段字段不得穿透(二次修复回归)')
{
  const POISON = LB + ' ' + RB
  const base = () => ({ memoryId: 'mem_' + 'a'.repeat(32), recordDigest: 'a'.repeat(64), scope: 'Workspace', sourceVersion: 3, score: 0.91, anchorId: 'anc_1', sourceRef: 'workspace:x', reference: 'ok' })
  const cases = [
    ['reference', (it) => { it.reference = POISON }],
    ['memoryId(Source 行)', (it) => { it.memoryId = POISON }],
    ['scope(Source 行)', (it) => { it.scope = POISON }],
    ['sourceVersion(Source 行)', (it) => { it.sourceVersion = POISON }],
    ['recordDigest(Source 行)', (it) => { it.recordDigest = POISON }],
  ]
  for (const [name, mutate] of cases) {
    const it = base(); mutate(it)
    const r = A.renderReferenceTail([it], { reason: 'r' })
    ok(!String(r.text).includes(LB) && !String(r.text).includes(RB), '字段 ' + name + ' 含毒 ⇒ 出口已中和')
  }
  // reason / skill 走 opts 而非 item
  const rReason = A.renderReferenceTail([base()], { reason: POISON })
  ok(!String(rReason.text).includes(LB), 'reason 含毒 ⇒ 出口已中和')
  for (const [name, skillPatch] of [
    ['skill.procedureId', { procedureId: POISON }],
    ['skill.level', { level: POISON }],
    ['skill.title', { title: POISON }],
    ['skill.text', { text: 'body ' + POISON }],
  ]) {
    const sk = Object.assign({ procedureId: 'p1', title: 't', text: 'body', level: 'checklist' }, skillPatch)
    const r = A.renderReferenceTail([base()], { reason: 'r', skill: sk })
    ok(!String(r.text).includes(LB), name + ' 含毒 ⇒ 出口已中和')
  }
  // 结构不变量:任何字段组合下都不得含宿主 GROUP_AT 命中形态
  const hitRe = /\{\{[^{}]*\}\}/
  const it2 = base(); it2.scope = POISON; it2.recordDigest = POISON
  const r2 = A.renderReferenceTail([it2], { reason: POISON })
  ok(!hitRe.test(String(r2.text)), '宿主 GROUP_AT 命中形态零出现')
  ok(String(r2.text).includes('Source: '), '固定边界 Source 行仍在')
  ok(String(r2.text).trim().endsWith(A.TAIL_VERIFY_LINE_PRE_V1), 'Verify 收尾行仍在')
}
console.log('[issue132] G3 宿主严格插值不抛错(issue 原始复现路径)')
if (!renderContextSections) {
  console.log('  [skip] 本机无法解析 @deepseek-ai/dsh-system-prompt ⇒ 退化为结构性断言')
  const r = renderOne('project 里 Vue 模板用 ' + LB + ' count ' + RB + ' 做插值')
  ok(!String(r.text).includes(LB), '结构性不变量:无开口双花括号 ⇒ 宿主不可能进入抛错分支')
} else {
  const cases = [
    ['大写变量', 'project 里 Vue 模板用 ' + LB + ' count ' + RB + ' 做插值'],
    ['小写变量', '提示词变量 ' + LB + 'footer' + RB + ' 的用法'],
    ['嵌套形态', '条件 ' + LB + ' a {b} c ' + RB + ' 结束'],
  ]
  for (const [name, reference] of cases) {
    const r = renderOne(reference)
    let err = null
    try {
      renderContextSections({ sections: [], tools: [], variables: [], contexts: [{ name: 'dsh:m6-reference-tail-pre', text: r.text }] })
    } catch (e) { err = e }
    ok(err === null, name + ' ⇒ renderContextSections 不抛错' + (err ? ' (实抛:' + err.message + ')' : ''))
  }
}

console.log('[issue132] G4 packet 构建:digest 往返一致(渲染即投递不掉单)')
{
  const hex = (c) => c.repeat(64).slice(0, 64)
  const rec = {
    memoryId: 'mem_' + 'b'.repeat(32), anchorId: 'anc_b', scope: 'Workspace', sourceRef: 'workspace:mem',
    sourceEpoch: '33333333-3333-4333-8333-333333333333', sourceVersion: 1, fileDigest: hex('b'), recordDigest: hex('c'),
    excerpt: '记忆正文含模板变量 ' + LB + ' count ' + RB + ' 与 ' + LB + 'apiKey' + RB,
    status: 'current',
  }
  const req = A.makeFakeActivationRequestPre({ seed: 'issue132', sessionId: 's1', agentId: 'a1', workspaceKey: 'w1', records: [rec] })
  const built = A.buildReferenceTailPacketPre({ request: req, nowStep: 1, ttlSteps: 2 })
  ok(built.ok === true, 'buildReferenceTailPacketPre 成功' + (built.ok ? '' : ' (' + built.reason + ')'))
  if (built.ok) {
    const p = built.packet
    ok(!p.references.some((x) => x.reference.includes(LB)), 'packet.references 正文已中和')
    const re = A.renderReferenceTail(p.references, { reason: p.triggerReason, budgetBytes: A.REFERENCE_TAIL_BUDGET_PRE_V1.maxPacketBytes, skill: p.skill })
    ok(re.ok === true, '重渲染(renderTailFor 路径)成功')
    ok(A.computeExactDigest(re.text) === p.exactDigest, 'exactDigest 往返一致 ⇒ renderTailFor 不降级为空注入')
  }
}

console.log('[issue132] G5 与主快照出口口径一致(lib/index.js neutralizePromptTemplateVars)')
{
  const SRC = readFileSync(path.join(ROOT, 'lib', 'index.js'), 'utf8')
  const MARK = 'function neutralizePromptTemplateVars(text) {'
  const start = SRC.indexOf(MARK)
  ok(start > 0, '主快照中和函数存在(0.1.39 病例的既有修法)')
  if (start > 0) {
    let depth = 0, end = -1
    for (let i = start + MARK.length - 1; i < SRC.length; i++) {
      const ch = SRC[i]
      if (ch === '{') depth++
      else if (ch === '}') { depth--; if (depth === 0) { end = i; break } }
    }
    const main = new Function(SRC.slice(start, end + 1) + ' return neutralizePromptTemplateVars')()
    const samples = [LB + 'baseUrl' + RB + '/v1/usage', LB + ' a {b} c ' + RB, '无花括号', LB + ' 不闭合', RB, 'a{b}c']
    for (const s of samples) {
      ok(A.sanitizeTailText(s) === main(s), '口径逐字一致: ' + JSON.stringify(s.slice(0, 24)))
    }
  }
}

console.log('[issue132] G6 源码守卫:guard 版本标记与接线')
{
  const SRC = readFileSync(path.join(ROOT, 'lib', 'activation-inbox.js'), 'utf8')
  ok(SRC.includes('注入卫生 guard v2'), 'guard 版本已升到 v2(guard v1 注释自陈变更必须升版)')
  ok(SRC.includes('function neutralizeTailTemplateVars(text) {'), '中和函数已定义')
  ok(SRC.includes("  return neutralizeTailTemplateVars(String(text == null ? '' : text)"), 'sanitizeTailText 已接线(真实调用,非死码)')
  ok(SRC.includes('neutralizeTailTemplateVars(parts.join('), '渲染器出口兜底已接线(唯一出口整段中和)')
}

console.log('  [mode] 宿主插值器=' + (renderContextSections ? '真实包' : '结构性退化'))
console.log('[issue132] pass=' + pass + ' fail=' + fail)
process.exit(fail ? 1 : 0)

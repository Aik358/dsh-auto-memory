#!/usr/bin/env node
/**
 * smoke-test-a13-inject-seg-chars.mjs —— #433 守卫套件（注入段字符记账恒 0）。
 *
 * 缺陷（改前实测）：生产者 lib/memory-envelope.js 的 segments 只出 {bucket,kind,chars}
 * （**刻意不导出 text**，避免二次持有正文）；而 lib/index.js 的注入统计埋点读
 * (sg.text || '').length ⇒ **恒 0** ⇒ 面板「谁最占注入预算」永远为 0；
 * droppedList 更是硬编码 chars: 0（而 envelope.dropped 本来就带 chars）。
 *
 * 验收方式（**真执行**，不是源码字符串断言）：按仓内既有范式把 renderMemoryDynamic
 * 从 lib/index.js 抽出来（花括号配平 + 逐行抓全部依赖 helper，见 smoke-test-handoff.mjs 同款），
 * 注入 _recallStats 探针捕获 observeInjection 的**真实入参**，再与同一轮 envelope 的
 * segments / dropped 逐项比对。
 *
 * 负路径：① 截断场景记的是**截断后**长度；② 丢弃段 name 以 (dropped) 结尾且 chars 等于
 *          envelope.dropped[i].chars（>0）；③ _recallStats 缺失 ⇒ 不抛、注入文本逐字节不变。
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, '..', '..')
const SRC = readFileSync(path.join(ROOT, 'lib', 'index.js'), 'utf8')

let pass = 0, fail = 0
const ok = (c, n, x) => { if (c) { pass++; console.log('  ok - ' + n) } else { fail++; console.error('  FAIL - ' + n + (x == null ? '' : ' << ' + x)) } }
const eq = (a, b, n) => ok(JSON.stringify(a) === JSON.stringify(b), n, 'got=' + JSON.stringify(a) + ' want=' + JSON.stringify(b))

// —— 源码抽取器（照抄 smoke-test-handoff.mjs 的既有范式）——
function extractFn(header) {
  const start = SRC.indexOf(header)
  if (start < 0) throw new Error('not found: ' + header)
  let depth = 0, end = -1
  for (let i = start + header.length - 1; i < SRC.length; i++) {
    if (SRC[i] === '{') depth++
    else if (SRC[i] === '}') { depth--; if (depth === 0) { end = i; break } }
  }
  if (end < 0) throw new Error('unbalanced: ' + header)
  return SRC.slice(start, end + 1)
}
function grab(name) {
  const lines = SRC.split('\n')
  let li = lines.findIndex((l) => { const t = l.trim(); return t.startsWith('const ' + name + ' ') || t.startsWith('const ' + name + '=') || t.startsWith('function ' + name + '(') || t.startsWith('var ' + name + ' ') || t.startsWith('export const ' + name) })
  if (li < 0) throw new Error('helper not found: ' + name)
  let buf = '', depth = 0, started = false
  for (; li < lines.length; li++) {
    buf += lines[li] + '\n'
    for (const ch of lines[li]) {
      if (ch === '(' || ch === '{') { depth++; started = true }
      else if (ch === ')' || ch === '}') depth--
    }
    if (started && depth <= 0) break
    if (!started && / = \//.test(lines[li])) break
  }
  return buf
}

const dynSrc = extractFn('renderMemoryDynamic(context) {')
// ★批次 0.5（2026-10-24）：renderMemoryDynamic 新增两处模块级依赖 ——
//   ① user-memory / project-notes 改 tail ⇒ `truncateTail`；② PLAN 按节优先级 ⇒ `truncatePlanByPriority`；
//   ③ 账本加权截断 ⇒ handoff-anchor 模块（下面注入）。抽取式沙箱依赖的全部模块级符号都必须显式提供。
const helpers = ['pad', 'DEFAULT_PROMPT_LAYERS', 'neutralizePromptTemplateVars', 'truncateHead', 'truncateTail', 'truncateLinesBounded', 'truncatePlanByPriority', 'sanitizeForInjection', 'scrubJunkLines', 'reflectionDigest', 'mojibakeDensity', 'MOJIBAKE_RE', 'detectStutter', 'hasStutter', 'BASE64_LINE', 'todayStr']
const helperCode = helpers.map((h) => grab(h)).join('\n')
  + '\nconst DEFAULT_WATER_LEVEL_THRESHOLD = 0.75\nconst DEFAULT_AUTO_CONTINUE_THRESHOLD = 0.75\n'
  + readFileSync(path.join(ROOT, 'lib', 'injection-policy.js'), 'utf8').replace(/^export /gm, '') + '\n'
const envelopeCode = readFileSync(path.join(ROOT, 'lib', 'memory-envelope.js'), 'utf8').replace(/^export /gm, '')
// ★批次 0.5：账本加权截断来自 lib/handoff-anchor.js（零 import 纯模块，可内联）。
const ledgerWeightCode = readFileSync(path.join(ROOT, 'lib', 'handoff-anchor.js'), 'utf8').replace(/^export /gm, '')
// 旁路探针：把 renderMemoryDynamic 里唯一一次 `composeMemoryEnvelopePre(...)` 换成 __spyCompose，
// 以便拿到**完整 envelope**（生产投影 state.envelopeMeta 只留 bucket/kind，拿不到 dropped[i].chars）。
// 这一步只改测试沙箱里的调用名，被测函数本体与生产调用点逐字未变（dynSrc 其余部分原样）。
if (dynSrc.split('const envelope = composeMemoryEnvelopePre({').length !== 2) throw new Error('compose 调用点不唯一，抽取范式需复核')
const dynPatched = dynSrc.replace('const envelope = composeMemoryEnvelopePre({', 'const envelope = __spyCompose({')
const spyPrelude = '\nconst __spyState = { last: null }\n'
  + 'function __spyCompose(input) { const env = composeMemoryEnvelopePre(input); __spyState.last = env; return env }\n'
const sandbox = new Function(helperCode + '\n' + envelopeCode + '\n' + ledgerWeightCode + spyPrelude + '\nreturn {' + dynPatched + ', __spyState};')()
const renderFn = sandbox['renderMemoryDynamic']
const spyState = sandbox['__spyState']

// —— 夹具 ——
function makeFakeThis(over = {}) {
  const o = over || {}
  return {
    state: {
      ws: 'D:\\proj',
      recentLogs: o.recentLogs || [{ date: '2026-10-17', text: '完成了 A' }],
      latestReflection: o.latestReflection || '', latestReflectionDate: '',
      userText: o.userText != null ? o.userText : '用户级规则正文'.repeat(30),
      notesText: o.notesText != null ? o.notesText : '项目笔记正文'.repeat(30),
      planText: o.planText || '', latestHandoffText: o.latestHandoffText || '',
      workspaceMap: o.workspaceMap || [], todayGreeting: '', calendarText: o.calendarText || '',
      tier0LayerText: o.tier0LayerText || '',
    },
    config: {
      injectBudgetChars: o.injectBudgetChars || 2400,
      handoffEnabled: false, handoffPlanChars: 500, handoffLedgerChars: 400,
      otherDynamicBudgetChars: o.otherDynamicBudgetChars,
      dayBoundaryMinutes: 450, autoConsolidate: true, promptLayerOverrides: {},
      rulesLayeringMode: o.rulesLayeringMode || 'off',
    },
    memToday: () => '2026-10-17',
    parseCalendar: () => [],
    runtimes: { values: () => [] },
    isUnattendedNow: () => false,
    external: { cache: [] },
    _recallStats: o._recallStats,
  }
}
/** 探针：捕获 observeInjection 的真实入参（真调用，不是静态断言）。 */
function makeProbe() {
  const calls = []
  return {
    calls,
    observeInjection(segs) { calls.push(JSON.parse(JSON.stringify(segs))) },
  }
}
const runCase = (over) => {
  const probe = makeProbe()
  const fake = makeFakeThis({ ...over, _recallStats: probe })
  spyState.last = null
  const out = renderFn.call(fake, {})
  return { out, probe, fake, segs: probe.calls[0] || [], env: fake.state.envelopeMeta || null, full: spyState.last }
}

console.log('[A13-1] 正路径：每段 chars > 0，且段字符合计 === envelope.chars.total（改前恒 0）')
{
  const r = runCase({ tier0LayerText: 'Tier-0 目录行'.repeat(20) })
  ok(typeof r.out === 'string' && r.out.length > 0, 'A13-1a 注入文本非空')
  eq(r.probe.calls.length, 1, 'A13-1b observeInjection 恰被调用 1 次（真走埋点）')
  ok(r.segs.length > 0, 'A13-1c 记录了段（' + r.segs.length + ' 段）')
  const named = r.segs.filter((s) => !String(s.name).endsWith('(dropped)'))
  ok(named.length > 0, 'A13-1d 有非丢弃段')
  ok(named.every((s) => s.chars > 0), 'A13-1e ★ 每段 chars > 0（改前读 sg.text 恒 0）', JSON.stringify(named.map((s) => [s.name, s.chars])))
  ok(!!r.env, 'A13-1f state.envelopeMeta 已挂（生产行为，非测试专用）')
  const sum = named.reduce((a, s) => a + s.chars, 0)
  eq(sum, r.env.chars.total, 'A13-1g ★ 段字符合计 === envelope.chars.total（同一本账，不是第二套算法）')
}

console.log('[A13-2] 与 envelope.segments 逐项相等（name=kind、chars=chars）')
{
  const r = runCase({ tier0LayerText: 'Tier-0 目录行'.repeat(20) })
  const named = r.segs.filter((s) => !String(s.name).endsWith('(dropped)'))
  eq(named.map((s) => [s.name, s.chars]), (r.env.segments || []).map((s) => [s.kind, s.chars]),
    'A13-2a ★ 探针账本与 envelope.segments 逐项相等（同源口径）')
  eq(named.map((s) => s.layer), (r.env.segments || []).map((s) => s.bucket), 'A13-2b layer = bucket，逐项相等')
  ok(named.every((s) => s.chars > 0), 'A13-2c 每段 chars 为正')
}

console.log('[A13-3] 负路径①：截断场景记录的是**截断后**长度')
{
  // otherDynamic 里可丢的只有 frame-meta 一段（日历/地图/规则层都关），上限压到 80
  // ⇒ 命中「只剩一段可丢 ⇒ 截断」分支（envelope.truncated 有该段）。
  const r = runCase({ otherDynamicBudgetChars: 80 })
  const truncated = r.env.truncated || []
  ok(truncated.length > 0, 'A13-3a 前提：本场景确实触发了截断（' + JSON.stringify(truncated.map((t) => t.kind)) + '）')
  const t0 = truncated[0]
  if (t0) {
    const s = r.segs.find((x) => x.name === t0.kind)
    const e = (r.env.segments || []).find((x) => x.kind === t0.kind)
    ok(!!s && !!e, 'A13-3b 截断段同时出现在探针与 envelope.segments 里')
    if (s && e) {
      eq(s.chars, e.chars, 'A13-3c ★ 截断段记账 chars = envelope 的**最终**长度')
      const ft = ((r.full && r.full.truncated) || []).find((x) => x.kind === t0.kind)
      ok(!!ft, 'A13-3d 拿到完整 envelope 的 truncated 记录（含 charsBefore/charsAfter）')
      if (ft) {
        eq(s.chars, ft.charsAfter, 'A13-3e ★ 记账 chars === truncated.charsAfter（截断**后**长度，不是 charsBefore=' + ft.charsBefore + '）')
        ok(ft.charsAfter < ft.charsBefore, 'A13-3f 前提：确实变短了（' + ft.charsBefore + ' → ' + ft.charsAfter + '）')
      }
      ok(String(r.out).includes('已按分项预算截断'), 'A13-3g ★ 注入正文里带截断标记（截断确实发生且可见）')
    }
  }
}

console.log('[A13-4] 负路径②：丢弃段 name 以 (dropped) 结尾且 chars === envelope.dropped[i].chars（>0）')
{
  // otherDynamic 上限压到 200 ⇒ calendar / workspace-map 整段丢弃、frame-meta 被截断。
  // （memoryReferences 那侧有 must 保护，压制预算通常只触发截断而丢不掉段；这里走 otherDynamic 更贴近真实。）
  const cal = [{ date: '2026-10-18', time: '08:00', quadrant: '重要紧急', title: '交报告', done: false }]
  const r = runCase({ otherDynamicBudgetChars: 200, workspaceMap: ['wsA', 'wsB'], parseCalendar: () => cal, calendarText: 'x' })
  const envDropped = r.env.dropped || []
  const probeDropped = r.segs.filter((s) => String(s.name).endsWith('(dropped)'))
  ok(envDropped.length > 0, 'A13-4a 前提：本场景确实触发了整段丢弃（dropped=' + envDropped.length + '）')
  eq(probeDropped.length, envDropped.length, 'A13-4b 探针丢弃段数量 = envelope.dropped 数量（不漏不重）')
  eq(probeDropped.map((s) => s.name), envDropped.map((d) => d.kind + '(dropped)'), 'A13-4c 丢弃段 name = kind + (dropped)，逐条对齐')
  eq(probeDropped.map((s) => s.layer), envDropped.map((d) => d.bucket), 'A13-4d 丢弃段 layer = bucket，逐条对齐')
  ok(probeDropped.every((s) => s.chars > 0), 'A13-4e ★ 丢弃段 chars > 0（改前硬编码 0）', JSON.stringify(probeDropped.map((s) => [s.name, s.chars])))
  const fullDropped = (r.full && r.full.dropped) || []
  eq(fullDropped.length, envDropped.length, 'A13-4f 完整 envelope 的 dropped 数量与投影一致')
  eq(probeDropped.map((s) => s.chars), fullDropped.map((d) => d.chars), 'A13-4g ★★ 丢弃段 chars === envelope.dropped[i].chars（逐条精确相等，spec 原话）')
  ok(fullDropped.every((d) => d.chars > 0), 'A13-4h 对照：envelope.dropped 自身 chars 就 > 0（证明 4g 不是两边同为 0 的真空等价）')
}

console.log('[A13-5] 负路径③：_recallStats 缺失 ⇒ 不抛、不写、注入文本逐字节不变')
{
  const fakeA = makeFakeThis({ _recallStats: null, tier0LayerText: 'T0 '.repeat(20) })
  let threw = null
  let outA = ''
  try { outA = renderFn.call(fakeA, {}) } catch (e) { threw = e }
  ok(threw === null, 'A13-5a _recallStats=null 不抛（fail-soft）', threw ? String(threw && threw.message) : '')
  const rB = runCase({ tier0LayerText: 'T0 '.repeat(20) })
  eq(outA, rB.out, 'A13-5b ★ 有无埋点，注入文本**逐字节相同**（埋点只读，不改注入）')
  eq(rB.probe.calls.length, 1, 'A13-5c 有埋点时恰好记一次')
}

console.log('\n[A13] ' + pass + ' passed, ' + fail + ' failed')
process.exit(fail ? 1 : 0)

/**
 * smoke-test-ws-hint-first-round-pre.mjs
 *
 * 守卫「重启后首轮注入头显示 工作区: (未知)」的修复（2026-09-15，用户裁定立即修）。
 *
 * 病症：`state.ws` 由 `_doRefresh`（异步）写入；注入回调里 `void engine.refresh(agent)` 是
 * **发射后不管**（未 await）⇒ 本 turn 首次注入可能早于 `state.ws` 落地 ⇒ 头帧渲染 `(未知)`。
 * 分级注入之前"第 2–5 轮"整份跳过、只有完整版渲染，而完整版受 `pre-step` 的
 * `await engine.refresh(agent)`（:8149）保护 ⇒ 从未暴露；精简版是 09-15 新增路径，不受那道保护 ⇒ 才显形。
 *
 * 修法（用户明确约束「只管第一轮」）：精简版接受 `wsHint`，口径 `s.ws || wsHint || ''`。
 * 兜底来源 = `resolvePaths(agent)` 第①优先级（`session.header.cwd`），与 GUI 概览页
 * `currentWs()`（client.js:485 读 session.cwd）同源；仅当 `state.ws` 为空时生效。
 *
 * ⚠️ 本套件的两个易踩坑（首版实测踩过，写进注释防回归）：
 *  ① 抽取函数体**不能**直接全文匹配方法名——文档注释里会提到方法名（"与 renderMemoryDynamic 一样"），
 *     会把起点定位到注释里 ⇒ 用「定义行锚点（含参数表与开括号）+ 从该行起配平」两段式。
 *  ② 断言必须能**真失败**：被测方法内部 `catch(e){return ''}` 会把缺 helper 吞成空串，
 *     故先加一条"基线输出非空且含 memory_system 块"的存在性断言兜底。
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'

const ROOT = path.resolve(import.meta.dirname, '..', '..')
const SRC = readFileSync(path.join(ROOT, 'lib', 'index.js'), 'utf8')

let pass = 0, fail = 0
function ok(cond, msg) {
  if (cond) { pass++; console.log('  ok - ' + msg) }
  else { fail++; console.log('  FAIL - ' + msg) }
}

const lineOf = (idx) => SRC.slice(0, idx).split('\n').length

/** 定义行锚点：签名必须带参数表与开括号，从而跳过注释里的"提及"。 */
function defLineOf(re) {
  const m = re.exec(SRC)
  return m ? lineOf(m.index) : 0
}

/** 把 src 裁到第 fromLine 行起（1-based）。 */
function sliceFromLine(src, fromLine) {
  let idx = 0
  for (let n = 1; n < fromLine; n++) {
    const nl = src.indexOf('\n', idx)
    if (nl < 0) return ''
    idx = nl + 1
  }
  return src.slice(idx)
}

/** 从 fromLine 起，按花括号配平切出 `{ ... }`（不含形参表）。仅用于"源码守卫"式的存在性检查，不用于执行。 */
function extractBodyFromLine(src, fromLine) {
  const scoped = sliceFromLine(src, fromLine)
  const brace = scoped.indexOf('{')
  if (brace < 0) return ''
  let depth = 0
  for (let i = brace; i < scoped.length; i++) {
    const c = scoped[i]
    if (c === '{') depth++
    else if (c === '}') { depth--; if (depth === 0) return scoped.slice(brace, i + 1) }
  }
  return ''
}

/** 从定义行起，抽出「方法简写」形态：(wsHint) { ...body... }（含形参表）。
 *  ⚠️ 必须含形参表：若只取 `{ ... }` 再包成 `(function () {...})`，方法体内的 `wsHint` 就不在作用域里，
 *  会抛 `wsHint is not defined` 并被方法体自己的 catch 吞成空串（首版即此坑，靠"把 catch 改成 rethrow"诊断出来）。
 *  含签名的形态可直接放进对象字面量，`this` 与形参都自然正确。 */
function extractMethodFromLine(src, fromLine) {
  const scoped = sliceFromLine(src, fromLine)
  const paren = scoped.indexOf('(')
  if (paren < 0) return ''
  const brace = scoped.indexOf('{', paren)
  if (brace < 0) return ''
  let depth = 0
  for (let i = brace; i < scoped.length; i++) {
    const c = scoped[i]
    if (c === '{') depth++
    else if (c === '}') { depth--; if (depth === 0) return scoped.slice(paren, i + 1) }
  }
  return ''
}

const SLIM_DEF = defLineOf(/(^|\n)\s*renderSlimSnapshotPre\s*\(\s*wsHint\s*\)\s*\{/)
const FULL_DEF = defLineOf(/(^|\n)\s*renderMemoryDynamic\s*\(\s*context\s*\)\s*\{/)
// 方法简写形态：(wsHint) { ... } —— 含形参，可直接写进对象字面量
const SLIM_METHOD = SLIM_DEF ? extractMethodFromLine(SRC, SLIM_DEF) : ''
const FULL_BODY = FULL_DEF ? extractBodyFromLine(SRC, FULL_DEF) : ''

// ---- 沙箱执行精简版：显式注入它引用的全部模块级符号（本项目既有约定）----
// ⚠️ 漏任何一个都会被方法体内部的 `catch (e) { return '' }` 吞成空串（症状=断言全红但无报错）。
// 精简版实际引用：parseGapRoundsPre / neutralizePromptTemplateVars / DEFAULT_PROMPT_LAYERS /
// todayStr / extractRulesLayerPre / renderRulesSectionPre / truncateLinesBounded /
// stripSensitiveSections / sanitizeForInjection，以及 this.memToday() / this.isUnattendedNow() / this.parseCalendar()。
const LAYERS = {
  snapshotHead: '<memory_system>', snapshotTail: '</memory_system>',
  snapshotMeta: '工作区: {ws}', snapshotSlimNote: 'n={n}',
  snapshotSlimRecallNote: 'r', snapshotSlimStatus: 's', snapshotCatalogTitle: '',
  snapshotRulesTitle: '规则', snapshotRulesGuide: '必读',
  snapshotTier0Title: '目录', snapshotPlanTitle: '白板', snapshotHandoffTitle: '账本',
  snapshotCalendarTitle: '日程',
}
const CFG = {
  dayBoundaryMinutes: 450, autoConsolidate: true, snapshotMinGapRounds: 5,
  snapshotTieredInject: true, promptLayerOverrides: {}, snapshotSlimIncludeCalendar: false,
  rulesLayeringMode: 'off', // 走"无规则段"分支，避免额外 helper 参与
}
/** 以对象字面量方法简写实例化后调用：`this` 与形参 `wsHint` 都自然正确。 */
function runSlim(state, hint) {
  const fn = new Function(
    'parseGap', 'neut', 'LAYERS_', 'today', 'extractRules', 'renderRules',
    'truncBounded', 'stripSensitive', 'sanitize', 'st', 'cfg', 'hint',
    `const parseGapRoundsPre = parseGap;
     const neutralizePromptTemplateVars = neut;
     const DEFAULT_PROMPT_LAYERS = LAYERS_;
     const todayStr = today;
     const extractRulesLayerPre = extractRules;
     const renderRulesSectionPre = renderRules;
     const truncateLinesBounded = truncBounded;
     const stripSensitiveSections = stripSensitive;
     const sanitizeForInjection = sanitize;
     const self = {
       renderSlimSnapshotPre${SLIM_METHOD},
       state: st, config: cfg,
       memToday: () => '2026-09-15',
       isUnattendedNow: () => false,
       parseCalendar: () => [],
     };
     return self.renderSlimSnapshotPre(hint)`)
  return fn(
    (v) => Number(v) || 5, (t) => t, LAYERS, () => '2026-09-15',
    () => ({ text: '' }), () => ({ text: '' }),
    (t) => String(t || ''), (t) => String(t || ''), (t) => String(t || ''),
    state, CFG, hint,
  )
}
const BASE = { ws: '', loadedAt: 0, calendarText: '' }

console.log('[ws-hint] S0 源码守卫')
{
  ok(SLIM_DEF > 0, 'renderSlimSnapshotPre(wsHint) 定义行已定位（第 ' + SLIM_DEF + ' 行）')
  ok(FULL_DEF > 0, 'renderMemoryDynamic(context) 定义行已定位（第 ' + FULL_DEF + ' 行）')
  ok(SLIM_METHOD.length > 300, '精简版方法体抽取成功（' + SLIM_METHOD.length + ' 字符）')
  ok(FULL_BODY.length > 300, '完整版方法体抽取成功（' + FULL_BODY.length + ' 字符）')
  ok(/^\s*\(\s*wsHint\s*\)/.test(SLIM_METHOD),
    '★抽出的方法简写含形参 wsHint（否则沙箱内会 ReferenceError 并被 catch 吞成空串）')

  ok(/renderSlimSnapshotPre\s*\(\s*wsHint\s*\)/.test(SRC),
    '★签名已接受 wsHint（防被改回无参）')
  ok(/const\s+wsEff\s*=\s*s\.ws\s*\|\|\s*wsHint\s*\|\|\s*''/.test(SLIM_METHOD),
    "★口径 = s.ws || wsHint || ''（state 优先，首轮回退 hint）")
  ok(/ws:\s*wsEff\s*\|\|\s*'\(未知\)'/.test(SLIM_METHOD),
    '★精简版 frame-meta 使用 wsEff')
  ok(!/ws:\s*s\.ws\s*\|\|\s*'\(未知\)'/.test(SLIM_METHOD),
    '★精简版内已无旧的 s.ws 写法（残留即修复失效）')

  // 注入回调侧接线
  ok(/wsHintPre\s*=\s*\(agent\.session\s*&&\s*agent\.session\.header\s*&&\s*agent\.session\.header\.cwd\)/.test(SRC),
    '★回调从 session.header.cwd 取 hint（与 resolvePaths:1735 同源）')
  ok(/renderSlimSnapshotPre\(wsHintPre\)/.test(SRC),
    '★精简版调用点已传入 hint（防接线被摘）')

  // ---- C：pre-step 的 await refresh 必须包进 withAgent ----
  // 病因（已实证，最小复现 artifacts/_repro-als-state.mjs）：`engine.state` 是 ALS 敏感 getter
  // （`:1003`→`:1007`），ALS 唯一写入点是 `withAgent`（`:1099`）。裸调 refresh 时
  // `_doRefresh` 的 `this.state.ws = p.ws`（`:3704`）写进 **default runtime**，
  // 而注入侧在 withAgent 内读 **agent runtime** ⇒ 写入与读取目标不同源，
  // 且 loadedAt 也写在 default 上 ⇒ agent runtime 的 loadedAt 恒 0 ⇒ 每 step 白刷。
  ok(/await\s+engine\.withAgent\(\s*agent\s*,\s*\(\)\s*=>\s*engine\.refresh\(\s*agent\s*\)\s*\)/.test(SRC),
    '★C：pre-step 的 await refresh 已包进 withAgent（写入与读取目标同源）')
  ok(!/if\s*\(!skip[^)]*\)\s*\{\s*\n\s*await\s+engine\.refresh\(agent\)\s*\n/.test(SRC),
    '★C：不得回退成裸调 await engine.refresh(agent)')

  // ---- D：完整版也必须接 wsHint（与精简版同构） ----
  const FULL_METHOD = FULL_DEF ? extractMethodFromLine(SRC, FULL_DEF) : ''
  ok(FULL_METHOD.length > 300, '完整版方法简写抽取成功（' + FULL_METHOD.length + ' 字符）')
  ok(/ws:\s*wsEff\s*\|\|\s*'\(未知\)'/.test(FULL_METHOD),
    '★D：完整版 frame-meta 用 wsEff（不再是 s.ws）')
  ok(!/ws:\s*s\.ws\s*\|\|\s*'\(未知\)'/.test(FULL_METHOD),
    '★D：完整版内已无旧的 s.ws 写法（残留即 D 失效）')
  ok(/const\s+wsEff\s*=\s*s\.ws\s*\|\|\s*wsHintPre\s*\|\|\s*''/.test(FULL_METHOD),
    "★D：完整版口径 = s.ws || wsHintPre || ''（与精简版同构）")
  ok(/context\s*&&\s*context\.agent/.test(FULL_METHOD) && /session\.header\.cwd/.test(FULL_METHOD),
    '★D：完整版 hint 取自 context.agent.session.header.cwd（与 :1735 同源）')

  ok(!/this\.state\.ws\s*=/.test(SLIM_METHOD),
    '★精简版不写 state.ws（纯渲染，无副作用）')
}

console.log('[ws-hint] S1 行为')
{
  // 存在性兜底：若 helper 缺失被 catch 吞成空串，下面所有断言都会失去意义
  const base = runSlim({ ...BASE, ws: 'X' }, undefined)
  ok(base.length > 20 && base.includes('<memory_system>') && base.includes('</memory_system>'),
    '★基线注入块非空且结构完好（防 catch 静默降级使断言失效）')

  const a = runSlim({ ...BASE, ws: '' }, 'D:\\dsh-auto-memory')
  ok(a.includes('工作区: D:\\dsh-auto-memory'),
    '★state.ws 为空 + hint 有值 ⇒ 用 hint（首轮不再 (未知)）')
  ok(!a.includes('工作区: (未知)'), '★该场景下不再出现 (未知)')

  const b = runSlim({ ...BASE, ws: 'D:\\real-ws' }, 'D:\\stale-hint')
  ok(b.includes('工作区: D:\\real-ws'),
    '★state.ws 已就绪 ⇒ state 优先（只管第一轮，不覆盖后续）')
  ok(!b.includes('stale-hint'), '★hint 不得盖过已就绪的 state.ws')

  const c = runSlim({ ...BASE, ws: '' }, '')
  ok(c.includes('工作区: (未知)'), '两者皆空 ⇒ 仍如实显示 (未知)（不编造）')

  const d = runSlim({ ...BASE, ws: '' }, undefined)
  ok(d.includes('工作区: (未知)'), 'hint=undefined（旧调用点不传参）⇒ 回落原行为（兼容）')
}

console.log('[ws-hint] S2 边界')
{
  let threw = false
  try { runSlim({ ...BASE }, 0) } catch (_) { threw = true }
  ok(!threw, 'hint=0（falsy）不抛异常')

  threw = false
  try { runSlim({ ...BASE }, null) } catch (_) { threw = true }
  ok(!threw, 'hint=null 不抛异常')

  const st = { ...BASE }
  runSlim(st, 'D:\\hint-only')
  ok(st.ws === '', '★渲染不写 state.ws（无副作用，不产生耦合）')

  // 已就绪时 hint 完全不参与 ⇒ 与修复前逐字节等价
  const withHint = runSlim({ ...BASE, ws: 'D:\\w' }, 'D:\\ignored')
  const noHint = runSlim({ ...BASE, ws: 'D:\\w' }, undefined)
  ok(withHint === noHint,
    '★state.ws 就绪时"传 hint"与"不传"输出逐字节一致（零行为变化）')
}

console.log('[ws-hint] ' + pass + '/' + (pass + fail) + ' assertions passed')
process.exit(fail === 0 ? 0 : 1)

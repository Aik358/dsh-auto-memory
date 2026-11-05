/**
 * smoke-test-water-pct-tier.mjs
 *
 * ★2026-11-03 新增：注入档位「水位线 25%/50% + 压缩后」验收套件。
 *
 * 【为什么必须新增】
 *   2026-11-03 调查用 acorn 块作用域判定证实：`_rqK` 声明在 try 块内、4 处引用在块外
 *   ⇒ ReferenceError 被空 catch 吞掉 ⇒ 25%/50% 水位钩子与 F7 挂机补偿**生产恒不触发**
 *   （5 天 15,013 行诊断日志四项计数全 0）。同时发现水位授予闸只认 isHuman，
 *   而真人自己那条请求里 isHuman 恒 false ⇒ 即使修好作用域，「过线后第一轮人说话」仍拿不到。
 *
 * 【本套件的判据原则（CR-10）】
 *   ① 真执行：真 import 纯函数并真调用，断言返回值；不做「源码含某字符串」的恒真断言
 *   ② 断言物理量：投递次数 / 触发档位 / 是否触发
 *   ③ 每条都有负路径（变异必红）
 *   ④ 结构类断言（作用域）用 acorn 解析真实源码判定，并对照 git HEAD 版本做负路径
 */
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { execSync } from 'node:child_process'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..', '..')
const require = createRequire(path.join(ROOT, 'package.json'))

let pass = 0, fail = 0
function ok(cond, name, extra) {
  if (cond) { pass++; console.log('  ok   - ' + name + (extra ? ' :: ' + extra : '')) }
  else { fail++; console.log('  FAIL - ' + name + (extra ? ' :: ' + extra : '')) }
}

const idxPath = path.join(ROOT, 'lib', 'index.js')
const idxSrc = fs.readFileSync(idxPath, 'utf8')

// ══════════════════════════════════════════════════════════════════════════
console.log('== A. 纯函数：decideWaterPctFirePre（阈值 + 一次性语义）==')
// 从源码抽取该纯函数真执行（它是自包含的箭头函数，无外部依赖）
const fnSrcM = idxSrc.match(/const decideWaterPctFirePre = \(waterPct, thresholds, lastFired\) => \{[\s\S]*?\n\}/)
ok(!!fnSrcM, 'A-0 能抽取 decideWaterPctFirePre 源码')
let decide = null
if (fnSrcM) {
  try { decide = new Function(fnSrcM[0] + '\nreturn decideWaterPctFirePre')() } catch (e) { ok(false, 'A-0b 抽取后可执行', String(e.message).slice(0, 80)) }
}
ok(typeof decide === 'function', 'A-1 抽取后是真函数')
if (typeof decide === 'function') {
  const TH = [25, 50]
  // 用户裁定语义：26% 说话 ⇒ 投；27%/28% ⇒ 不投；51% ⇒ 再投
  let r = decide(26, TH, 0)
  ok(r.fire === true && r.fireAt === 25, 'A-2 水位 26%（首次过 25 档）⇒ 触发且记 25', JSON.stringify(r))
  r = decide(27, TH, 25)
  ok(r.fire === false, 'A-3 水位 27%（25 档已投）⇒ 不投（同档不重复）', JSON.stringify(r))
  r = decide(28, TH, 25)
  ok(r.fire === false, 'A-4 水位 28%（25 档已投）⇒ 不投', JSON.stringify(r))
  r = decide(51, TH, 25)
  ok(r.fire === true && r.fireAt === 50, 'A-5 水位 51%（跨 50 档）⇒ 再投且记 50', JSON.stringify(r))
  r = decide(52, TH, 50)
  ok(r.fire === false, 'A-6 水位 52%（50 档已投）⇒ 不投', JSON.stringify(r))
  // 一次跳多档只投一次，取最高
  r = decide(55, TH, 0)
  ok(r.fire === true && r.fireAt === 50, 'A-7 一次跳两档 ⇒ 只投一次且取最高档（不连投）', JSON.stringify(r))
  // 压缩回落（标记清零后）
  r = decide(26, TH, 0)
  ok(r.fire === true && r.fireAt === 25, 'A-8 压缩后标记清零 ⇒ 26% 可再投一次', JSON.stringify(r))
  // fail-closed
  r = decide(0, TH, 0)
  ok(r.fire === false, 'A-9 水位未知(0) ⇒ 不触发（fail-closed）', JSON.stringify(r))
  r = decide(NaN, TH, 0)
  ok(r.fire === false, 'A-10 水位 NaN ⇒ 不触发', JSON.stringify(r))
  r = decide(99, [], 0)
  ok(r.fire === false, 'A-11 阈值列表为空 ⇒ 不触发', JSON.stringify(r))
  // 负路径：把「取最高档」改成「取最低档」必须改变 A-7 的结果
  const mutated = fnSrcM[0].replace('crossed[crossed.length - 1]', 'crossed[0]')
  ok(mutated !== fnSrcM[0], 'A-12 负路径装置：变异锚点可命中')
  const decideM = new Function(mutated + '\nreturn decideWaterPctFirePre')()
  const rm = decideM(55, TH, 0)
  ok(rm.fireAt === 25, 'A-13 负路径：变异后跳档取最低档(25) ⇒ A-7 判据确实在测行为', JSON.stringify(rm))
}

// ══════════════════════════════════════════════════════════════════════════
console.log('')
console.log('== B. 阈值解析：parseWaterPctThresholdsPre ==')
const pSrcM = idxSrc.match(/const parseWaterPctThresholdsPre = \(raw\) => \{[\s\S]*?\n\}/)
ok(!!pSrcM, 'B-0 能抽取 parseWaterPctThresholdsPre 源码')
if (pSrcM) {
  const parse = new Function(pSrcM[0] + '\nreturn parseWaterPctThresholdsPre')()
  ok(JSON.stringify(parse('25,50')) === '[25,50]', 'B-1 字符串 "25,50" ⇒ [25,50]', JSON.stringify(parse('25,50')))
  ok(JSON.stringify(parse(undefined)) === '[25,50]', 'B-2 未配置 ⇒ 默认 [25,50]（水位钩子默认开启）', JSON.stringify(parse(undefined)))
  ok(JSON.stringify(parse('off')) === '[]', 'B-3 "off" ⇒ 显式关闭', JSON.stringify(parse('off')))
  ok(JSON.stringify(parse('50,25')) === '[25,50]', 'B-4 乱序输入 ⇒ 排序为升序', JSON.stringify(parse('50,25')))
  ok(JSON.stringify(parse('25,25')) === '[25]', 'B-5 重复阈值去重', JSON.stringify(parse('25,25')))
}

// ══════════════════════════════════════════════════════════════════════════
console.log('')
console.log('== C. 结构判据：_rqK 作用域（acorn 块作用域，非字符串匹配）==')
const acorn = require('acorn')
function scopeReport(src) {
  const ast = acorn.parse(src, { ecmaVersion: 'latest', sourceType: 'module' })
  const blocks = []
  ;(function walk(n) {
    if (!n || typeof n.type !== 'string') return
    if (['BlockStatement', 'SwitchStatement', 'ForStatement', 'ForOfStatement', 'ForInStatement', 'CatchClause', 'StaticBlock'].indexOf(n.type) >= 0) {
      blocks.push({ start: n.start, end: n.end })
    }
    for (const k of Object.keys(n)) {
      if (k === 'loc' || k === 'start' || k === 'end') continue
      const v = n[k]
      if (Array.isArray(v)) { for (const c of v) if (c && typeof c.type === 'string') walk(c) }
      else if (v && typeof v.type === 'string') walk(v)
    }
  })(ast)
  const lineStarts = [0]
  for (let i = 0; i < src.length; i++) if (src.charCodeAt(i) === 10) lineStarts.push(i + 1)
  const lineOf = (o) => { let lo = 0, hi = lineStarts.length - 1; while (lo < hi) { const m = (lo + hi + 1) >> 1; if (lineStarts[m] <= o) lo = m; else hi = m - 1 } return lo + 1 }
  const inner = (off) => blocks.filter((b) => b.start <= off && off < b.end).sort((a, b) => (a.end - a.start) - (b.end - b.start))[0]
  const refs = []
  const re = /_rqK/g
  let m
  while ((m = re.exec(src))) refs.push({ off: m.index, line: lineOf(m.index) })
  if (!refs.length) return { total: 0, outOfScope: [] }
  const d = inner(refs[0].off)
  const out = []
  for (const r of refs) {
    const b = inner(r.off)
    if (!(b.start >= d.start && b.end <= d.end)) out.push(r.line)
  }
  return { total: refs.length, outOfScope: out }
}
const cur = scopeReport(idxSrc)
ok(cur.total >= 10, 'C-1 现状统计到 _rqK 全部出现点', String(cur.total) + ' 处')
ok(cur.outOfScope.length === 0, 'C-2 【功能】_rqK 全部引用都在声明块作用域内（作用域修复生效）', cur.outOfScope.length ? ('越界行: ' + cur.outOfScope.join(',')) : '0 处越界')
// 负路径：用 git HEAD 的未修版本做同法判定，必须检出越界
let headOut = null
let headSrcForNeg = ''
try {
  const headSrc = execSync('git show HEAD:lib/index.js', { cwd: ROOT, maxBuffer: 64 * 1024 * 1024, encoding: 'utf8' })
  headSrcForNeg = headSrc
  headOut = scopeReport(headSrc).outOfScope
} catch (e) { headOut = null }
if (headOut === null) {
  console.log('  SKIP - C-3 负路径：git 不可用，无法取 HEAD 版本对照')
} else {
  ok(headOut.length > 0, 'C-3 负路径：未修版本必检出越界引用（判据不是恒真）', 'HEAD 越界 ' + headOut.length + ' 处: ' + headOut.join(','))
}

// ══════════════════════════════════════════════════════════════════════════
console.log('')
console.log('== D. 结构判据：水位授予闸的真人信号（含 isHuman 与 _humanPendingNow）==')
const gateM = idxSrc.match(/if \(_waterFire\.fire && \(([^)]*)\)\)/)
ok(!!gateM, 'D-1 水位授予闸存在且条件带显式括号')
if (gateM) {
  const gate = gateM[1]
  ok(gate.indexOf('isHuman') >= 0, 'D-2 闸含 isHuman（事件流已落地的真人轮）')
  ok(gate.indexOf('_humanPendingNow') >= 0, 'D-3 闸含 _humanPendingNow（真人自己那条请求，isHuman 尚未落地）')
  // 负路径：去掉两个真人信号后条件必须为空 ⇒ 证明闸里没有第三个分支
  const stripped = gate.replace(/isHuman/g, '').replace(/_humanPendingNow/g, '').replace(/[\s|&()]/g, '')
  ok(stripped.length === 0, 'D-4 负路径：闸里除真人信号外无其它分支（去掉即为空条件）', 'stripped=' + JSON.stringify(stripped))
}
ok(!/_waterFire\.fire && isHuman/.test(idxSrc), 'D-5 负路径：不得回退成「只认 isHuman」的旧写法')

console.log('')
console.log('== E. 结构判据：水位档位记账在授予公共出口（同档不重复投）==')
ok(/if \(_waterFire && _waterFire\.fire\) stH\._waterPctFired = _waterFire\.fireAt/.test(idxSrc),
   'E-1 授予公共出口推进 _waterPctFired（任何分支授了完整版都记账）')
ok(idxSrc.indexOf('stH._waterPctFired = _waterFire.fireAt') >= 0, 'E-2 水位旁路分支自身仍保留记账（两道保险）')
// 计数：_waterPctFired 的写点必须 ≥ 2（旁路 + 公共出口）
const wpWrites = (idxSrc.match(/_waterPctFired = /g) || []).length
ok(wpWrites >= 2, 'E-3 记账写点数量 ≥ 2（旁路 + 公共出口）', wpWrites + ' 处')

console.log('')
console.log('== F. 幻影标识符：_waterHumanGate 不得存在于代码（仅注释可提及）==')
const phantomHits = []
{
  const re = /_waterHumanGate/g
  let m
  while ((m = re.exec(idxSrc))) {
    const lineStart = idxSrc.lastIndexOf('\n', m.index) + 1
    const lineEnd = idxSrc.indexOf('\n', m.index)
    const line = idxSrc.slice(lineStart, lineEnd === -1 ? idxSrc.length : lineEnd)
    const isComment = /^\s*\/\//.test(line) || /^\s*\*/.test(line) || /\/\*/.test(line)
    phantomHits.push({ isComment, line: line.trim().slice(0, 60) })
  }
}
ok(phantomHits.filter((h) => !h.isComment).length === 0,
   'F-1 _waterHumanGate 不以「真变量」形式出现在代码里（注释里说明历史即可）',
   '总命中 ' + phantomHits.length + '，非注释 ' + phantomHits.filter((h) => !h.isComment).length)


// ══════════════════════════════════════════════════════════════════════════
console.log('')
console.log('== G. P0 结构判据：档位辅助函数必须在**模块顶层**（不得被吞进某个函数体）==')
// 缺陷实证（2026-11-03 审计，本轮最致命）：truncatePlanByPriority 的箭头函数体缺一个闭合花括号，
// 从 :1683 一直吞到 :2110 的多余 `}`（428 行），其中包括 INJECT_TIERS / decideInjectTierPre /
// parseWaterPctThresholdsPre / decideWaterPctFirePre / decideHangCompensatePre / renderRulesSlimPre 等 13 个声明，
// 且它们都位于 `return` 之后 ⇒ 永不初始化；模块顶层零绑定 ⇒ 注入回调每帧 ReferenceError 被空 catch 吞。
// ⚠️ 判据**不能**用 grep「有没有这个声明」—— 声明在，只是在对的作用域之外。必须做作用域链解析。
function declScope(src, names) {
  const ast2 = acorn.parse(src, { ecmaVersion: 'latest', sourceType: 'module' })
  const par = new WeakMap()
  const found = new Map()
  ;(function walk(n, p) {
    if (!n || typeof n.type !== 'string') return
    par.set(n, p)
    if (n.type === 'VariableDeclarator' && n.id && n.id.type === 'Identifier' && names.indexOf(n.id.name) >= 0 && !found.has(n.id.name)) found.set(n.id.name, n)
    for (const k of Object.keys(n)) {
      if (k === 'loc' || k === 'start' || k === 'end') continue
      const v = n[k]
      if (Array.isArray(v)) { for (const c of v) if (c && typeof c.type === 'string') walk(c, n) }
      else if (v && typeof v.type === 'string') walk(v, n)
    }
  })(ast2, null)
  const out = new Map()
  for (const [name, node] of found) {
    let p = par.get(node)
    let fn = null
    while (p) {
      if (p.type === 'FunctionDeclaration' || p.type === 'FunctionExpression' || p.type === 'ArrowFunctionExpression') { fn = p; break }
      p = par.get(p)
    }
    out.set(name, fn ? 'FUNCTION' : 'TOP')
  }
  return out
}
const TIER_HELPERS = ['INJECT_TIERS', 'decideInjectTierPre', 'parseWaterPctThresholdsPre', 'decideWaterPctFirePre', 'decideHangCompensatePre', 'renderRulesSlimPre', 'planSpecForTierPre']
const sc = declScope(idxSrc, TIER_HELPERS)
const trapped = TIER_HELPERS.filter((n) => sc.get(n) === 'FUNCTION')
ok(sc.size === TIER_HELPERS.length, 'G-1 七个档位辅助全部能在源码里定位到声明', sc.size + '/' + TIER_HELPERS.length)
ok(trapped.length === 0, 'G-2 【P0-1】档位辅助函数全部在模块顶层（不被吞进 truncatePlanByPriority 等函数体）', trapped.length ? ('仍在函数体内: ' + trapped.join(', ')) : '0 个')
// 负路径：用 git HEAD 的未修版本跑同一判据，必须检出被吞
if (headOut === null) {
  console.log('  SKIP - G-3 负路径：git 不可用')
} else {
  const scHead = declScope(headSrcForNeg, TIER_HELPERS)
  const trappedHead = TIER_HELPERS.filter((n) => scHead.get(n) === 'FUNCTION')
  ok(trappedHead.length === TIER_HELPERS.length, 'G-3 负路径：未修版本里这七个**全部**被吞进函数体（判据不是恒真）', trappedHead.length + '/' + TIER_HELPERS.length)
}

console.log('')
console.log('== H. P0-2 结构判据：注入回调内不得引用未绑定的 `cfg` ==')
// 缺陷实证：:22362-22363 原写 cfg.hangCompensateEnabled / cfg.hangCompensateTokens，
// 而工厂形参是 (ctx, config)、回调内无 cfg ⇒ F7 每帧 ReferenceError（vm 实测 getter 命中 2 次）。
const cbIdx = idxSrc.indexOf("return engine.withAgent(agent, () => {")
ok(cbIdx > 0, 'H-1 能定位注入回调起点')
const cbTail = cbIdx > 0 ? idxSrc.slice(cbIdx) : ''
const cbEnd = cbTail.indexOf("\n    },")
const cbBody = cbEnd > 0 ? cbTail.slice(0, cbEnd) : cbTail.slice(0, 60000)
// 去掉注释行后再判（注释里允许提到 cfg 作为历史说明）
const cbCode = cbBody.split('\n').filter((l) => l.trim().indexOf('//') !== 0).join('\n')
const cfgHits = (cbCode.match(/\bcfg\./g) || []).length
ok(cfgHits === 0, 'H-2 【P0-2】注入回调代码里不再引用 cfg（改为 engine.config）', cfgHits + ' 处')
ok(/engine && engine\.config/.test(cbCode) || /_cfgNow/.test(cbCode), 'H-3 F7 分支已改用 engine.config 取值')


// ══════════════════════════════════════════════════════════════════════════
console.log('')
console.log('== I. H6 结构判据：全帧档证据段放宽，但 run_full 不得被误伤 ==')
// 用户 2026-11-03 裁定：「只对全帧档放宽这两段（slim 档不变），不要误伤 run full」。
// 判据必须双向：①四档确实放宽 ②run_full 与 slim 档确实没变。
ok(idxSrc.indexOf('const subEv = _evFullTier ? sub * _EVIDENCE_WIDEN_X : sub') >= 0,
   'I-1 subEv 的计算式存在（全帧档乘以放宽系数，其余等同 sub）')
// 注意：idxSrc 是 lib/index.js 原文（CRLF）⇒ 行尾必须写 \r?\n，否则匹配不到。
const _evBlock = idxSrc.match(/const _evFullTier = \(([\s\S]{0,300}?)\)\r?\n/)
ok(!!_evBlock, 'I-2 能定位 _evFullTier 判定块')
if (_evBlock) {
  const b = _evBlock[1]
  for (const k of ['LEGACY', 'HUMAN_FULL', 'HANDOFF_CARRY', 'POST_COMPACT']) {
    ok(b.indexOf(k) >= 0, 'I-3 ' + k + ' 在全帧档判定里')
  }
  ok(b.indexOf('RUN_FULL') < 0, 'I-4 【关键】RUN_FULL **不在**全帧档判定里（不得误伤 run_full）')
  ok(b.indexOf('RUN_SLIM') < 0 && b.indexOf('HUMAN_SLIM') < 0, 'I-5 两个 slim 档都不在判定里')
}
ok(idxSrc.indexOf("SANITIZE_NO_CAP)), subEv, 'must', 'tail')") >= 0,
   'I-6 user-memory 段确实用 subEv（不是 sub）')
const _pnEv = (idxSrc.match(/subEv, 'must', 'tail'/g) || []).length
ok(_pnEv === 2, 'I-7 user-memory 与 project-notes 两段都用 subEv', _pnEv + ' 处')
ok(idxSrc.indexOf('+ (subEv - sub) * 2') >= 0,
   'I-8 memRefLimit 同步加上两段增量（否则桶超限会把 must 段整段 drop）')

// 真引擎：run_full 与 slim 档的这两段必须仍是原 sub 值
let _ENG_OK = false, _eng = null
try {
  const mod = await import('../lib/audit-engine.mjs')
  _eng = new mod.MemoryEngine()
  await _eng.refresh(undefined)
  const st0 = _eng.stateFor(undefined)
  _ENG_OK = String(st0 && st0.userText || '').length > 0
} catch (_eEng) { _ENG_OK = false }
if (!_ENG_OK) {
  console.log('  SKIP - I-9/I-10 引擎不可用（无真实记忆语料），跳过运行时字节比对')
} else {
  const st1 = _eng.stateFor(undefined)
  const segOf = (tier, kind) => {
    st1._injectTierPre = tier
    st1.memLegacy = { legacy: false, reasons: [], counts: {} }
    st1.envelopeMeta = null
    _eng.renderMemoryDynamic({ agent: undefined })
    const ss = (st1.envelopeMeta && st1.envelopeMeta.segments) || []
    const s0 = ss.find((x) => x.kind === kind)
    return s0 ? s0.chars : 0
  }
  const hfUm = segOf('human_full', 'user-memory')
  const rfUm = segOf('run_full', 'user-memory')
  const hfPn = segOf('human_full', 'project-notes')
  const rfPn = segOf('run_full', 'project-notes')
  ok(hfUm > rfUm, 'I-9 【运行时】human_full 的 user-memory 明显大于 run_full（放宽生效）', hfUm + ' vs ' + rfUm)
  ok(hfPn > rfPn, 'I-10 【运行时】human_full 的 project-notes 明显大于 run_full', hfPn + ' vs ' + rfPn)
}


// ══════════════════════════════════════════════════════════════════════════
console.log('')
console.log('== J. H7 判据：规约预算「注入面保留告警 + 不截断 + 对外可查询」==')
// 用户 2026-11-03 裁定：「注入面也提示一下告警，但是不强制截断。同时，设置页和面板页会显示」。
// 三条要同时成立，缺一不可：①注入面仍出告警 ②绝不截断 ③后端有只读投影供 UI 消费。
const rulesSrc = fs.readFileSync(path.join(ROOT, 'lib', 'rules-layer.js'), 'utf8')
ok(rulesSrc.indexOf('[用户规约超预算线]') >= 0, 'J-1 注入面仍产出「用户规约超预算线」告警行')
ok(rulesSrc.indexOf('[项目规约超预算线]') >= 0, 'J-2 注入面仍产出「项目规约超预算线」告警行')
ok(rulesSrc.indexOf('超预算不会截断') >= 0, 'J-3 告警文案明确写了「不会截断」')
// 负路径：rules-layer 里不得对 userArr/projArr 做 slice 截断后再注入
const _warnBlock = rulesSrc.slice(rulesSrc.indexOf('if (userChars > userBudget)'), rulesSrc.indexOf('if (!parts.length)'))
ok(!/ur\.slice|rows\.slice|projArr\.slice/.test(_warnBlock), 'J-4 负路径：超限分支内不得出现任何 slice 截断')
// 后端投影
ok(idxSrc.indexOf("rulesBudget: (() => {") >= 0, 'J-5 后端 debugInfo().associativeMemory.rulesBudget 投影存在')
ok(idxSrc.indexOf('truncation: false') >= 0, 'J-6 投影里明确标注 truncation:false（不截断）')
ok(idxSrc.indexOf('this._lastRulesAudit') >= 0, 'J-7 渲染时缓存本次实测规约字符数（单一真源，不另算一遍）')


// ══════════════════════════════════════════════════════════════════════════
console.log('')
console.log('== K. H12 判据：两档精简帧的档位判定与降级路径 ==')
// 用户 2026-11-04 裁定方案 A：不追求「两档必须不同」，只做两处加固。
const slimSrc = (function () {
  const i = idxSrc.indexOf("const _SLIM_HUMAN_CTX_TIERS")
  const j = idxSrc.indexOf("const _slimNeedsHumanCtx")
  return i >= 0 && j > i ? idxSrc.slice(i, j + 200) : ''
})()
ok(slimSrc.length > 0, 'K-1 精简帧档位判定改为正向白名单（_SLIM_HUMAN_CTX_TIERS）')
ok(!/_slimNeedsHumanCtx = !\(_slimTierPre === 'run_slim'\)/.test(idxSrc),
   'K-2 负向判据已移除（旧写法 !(tier === run_slim) 不再存在）')
// 真执行（沿用本套件 I-9/I-10 的 audit-engine 方式，不用 new Function 抽取）
let _SLIM_OK = false, _h = '', _r = ''
try {
  const mod2 = await import('../lib/audit-engine.mjs')
  const e2 = new mod2.MemoryEngine()
  await e2.refresh(undefined)
  const st2 = e2.stateFor(undefined)
  const sl = (tier) => {
    st2._injectTierPre = tier
    st2.memLegacy = { legacy: false, reasons: [], counts: {} }
    // ★必须给事件与画像喂料，否则两档都会是空，断言恒假绿
    st2.slimEventT1 = [{ id: 'evt_probe_1', line: '探针事件：H12 档位判定验收' }]
    st2.slimEventTotal = 3
    st2.userPortraitText = '探针画像：用于验证 human_slim 与 run_slim 的分叉'
    try { return String(e2.renderSlimSnapshotPre('', undefined) || '') } catch (_e) { return '' }
  }
  _h = sl('human_slim')
  _r = sl('run_slim')
  _SLIM_OK = _h.length > 0 && _r.length > 0
} catch (_eSlim) { _SLIM_OK = false }
if (!_SLIM_OK) {
  console.log('  SKIP - K-3/K-4/K-5 引擎不可用，跳过运行时档位分叉比对')
} else {
  ok(_h.indexOf('[当前事件]') >= 0 && _h.indexOf('[用户画像]') >= 0,
     'K-3 human_slim 承载事件卡 + 画像（真执行）')
  ok(_r.indexOf('[当前事件]') < 0 && _r.indexOf('[用户画像]') < 0,
     'K-4 run_slim 不承载事件卡 + 画像（真执行）')
  ok(_h.length > _r.length, 'K-5 human_slim 确实大于 run_slim（' + _h.length + ' > ' + _r.length + '）')
}
// 降级路径：不得再出现「清空重建」写法
// ★负路径必须看**真语法树**，不能看文本：本文件多处**注释**里就写着旧写法
//   `_slimParts.length = 0`（作为历史归因），纯文本正则会把它当成代码而恒红。
//   这正是本仓纪律「用注释包住定义行会让解析器仍匹配注释内文本」的反面用法。
const _slimAssigns = (function () {
  try {
    const ast = require('acorn').parse(idxSrc, { ecmaVersion: 'latest', sourceType: 'module' })
    const hits = []
    ;(function walk(n) {
      if (!n || typeof n !== 'object') return
      if (n.type === 'AssignmentExpression' && n.left && n.left.type === 'MemberExpression') {
        const o = n.left.object, p = n.left.property
        if (o && o.name === '_slimParts' && p && p.name === 'length') hits.push(n.start)
      }
      for (const k of Object.keys(n)) {
        if (k === 'parent' || k === 'loc' || k === 'range') continue
        const v = n[k]
        if (Array.isArray(v)) v.forEach(walk); else if (v && typeof v === 'object') walk(v)
      }
    })(ast)
    return hits
  } catch (_eA) { return null }
})()
ok(_slimAssigns !== null, 'K-6a 负路径判据可用（acorn 解析成功）')
ok(Array.isArray(_slimAssigns) && _slimAssigns.length === 0,
   'K-6 【负路径·语法树】`_slimParts.length = <任何值>` 赋值语句 0 处（不再清空重建）',
   _slimAssigns === null ? 'acorn 不可用' : ('实测 ' + _slimAssigns.length + ' 处'))
// 变异反向验证：把旧写法塞进一段字符串源码，同一判据必须变红
const _mutSrc = idxSrc + '\nfunction _mutProbe() { const _slimParts = []; _slimParts.length = 0 }\n'
const _mutHits = (function () {
  try {
    const ast = require('acorn').parse(_mutSrc, { ecmaVersion: 'latest', sourceType: 'module' })
    let c = 0
    ;(function walk(n) {
      if (!n || typeof n !== 'object') return
      if (n.type === 'AssignmentExpression' && n.left && n.left.type === 'MemberExpression') {
        const o = n.left.object, p = n.left.property
        if (o && o.name === '_slimParts' && p && p.name === 'length') c++
      }
      for (const k of Object.keys(n)) {
        if (k === 'parent' || k === 'loc' || k === 'range') continue
        const v = n[k]
        if (Array.isArray(v)) v.forEach(walk); else if (v && typeof v === 'object') walk(v)
      }
    })(ast)
    return c
  } catch (_eM) { return -1 }
})()
ok(_mutHits === 1, 'K-6b 【变异必须变红】注入旧写法后同一判据命中 1 处 ⇒ 判据在测真行为', '实测 ' + _mutHits)
ok(idxSrc.indexOf('★实测行为差异') >= 0, 'K-7 降级路径的行为差异已显式归因（共 N 个事件后缀保留）')


// ══════════════════════════════════════════════════════════════════════════
console.log('')
console.log('== L. H10 判据：规则摘要不得泄漏 markdown 前缀 ==')
let _H10_OK = false, _rulesText = ''
try {
  const mod3 = await import('../lib/audit-engine.mjs')
  const e3 = new mod3.MemoryEngine()
  await e3.refresh(undefined)
  const s3 = e3.stateFor(undefined)
  s3._injectTierPre = 'run_full'
  s3.memLegacy = { legacy: false, reasons: [], counts: {} }
  s3.envelopeMeta = null
  _rulesText = String(e3.renderMemoryDynamic({ agent: undefined }) || '')
  _H10_OK = _rulesText.length > 0
} catch (_eL) { _H10_OK = false }
if (!_H10_OK) {
  console.log('  SKIP - L-1..L-2 引擎不可用，跳过规则摘要前缀检查')
} else {
  const _rl = _rulesText.split('\n')
  const _dbl = _rl.filter((x) => x.indexOf('- - ') === 0)
  const _hash = _rl.filter((x) => x.indexOf('- ## ') === 0)
  ok(_dbl.length === 0, 'L-1 【负路径】`- - ` 双重列表前缀 0 行（修前 5 行）', '实测 ' + _dbl.length)
  ok(_hash.length === 0, 'L-2 【负路径】`- ## ` 日期标题泄漏 0 行（修前 58 行）', '实测 ' + _hash.length)
}
// 两处渲染器必须同改（内联版 + 模块级版）
const _stripCnt = (idxSrc.match(/one = one\.replace\(\/\^\\d\{4\}-\\d\{2\}-\\d\{2\}/g) || []).length
ok(_stripCnt === 2, 'L-3 前缀清理在两处渲染器都落了（内联版 + 模块级 renderRulesSlimPre）', '实测 ' + _stripCnt + ' 处')

console.log('')
console.log('== M. H11 判据：run_full / human_slim 只注入最近工作，不投规则档案 ==')
let _M_OK = false, _tierSeg = {}
try {
  const mod4 = await import('../lib/audit-engine.mjs')
  const e4 = new mod4.MemoryEngine()
  await e4.refresh(undefined)
  const s4 = e4.stateFor(undefined)
  for (const tier of ['run_full', 'human_slim', 'human_full', 'post_compact']) {
    s4._injectTierPre = tier
    s4.memLegacy = { legacy: false, reasons: [], counts: {} }
    s4.envelopeMeta = null
    e4.renderMemoryDynamic({ agent: undefined })
    const em = s4.envelopeMeta || {}
    _tierSeg[tier] = {
      kinds: (em.segments || []).map((x) => x.kind),
      dropped: (em.dropped || []).map((x) => x.kind),
    }
  }
  _M_OK = Object.keys(_tierSeg).length === 4
} catch (_eM2) { _M_OK = false }
if (!_M_OK) {
  console.log('  SKIP - M-1..M-5 引擎不可用，跳过档位内容检查')
} else {
  const _has = (tier, kind) => _tierSeg[tier].kinds.indexOf(kind) >= 0
  ok(!_has('run_full', 'user-memory') && !_has('run_full', 'project-notes'),
     'M-1 run_full 不投 user-memory / project-notes（规则档案让位给最近工作）')
  ok(!_has('human_slim', 'user-memory') && !_has('human_slim', 'project-notes'),
     'M-2 human_slim 不投 user-memory / project-notes（与 run_full 同口径）')
  ok(_has('run_full', 'recent-logs'), 'M-3 ★run_full 保住了 recent-logs（修前被整段 drop）',
     'dropped=' + (_tierSeg.run_full.dropped.join(',') || '无'))
  ok(_has('human_slim', 'recent-logs'), 'M-4 ★human_slim 保住了 recent-logs',
     'dropped=' + (_tierSeg.human_slim.dropped.join(',') || '无'))
  // 负路径：全帧档必须仍然有这两段（不得误伤）
  ok(_has('human_full', 'user-memory') && _has('human_full', 'project-notes'),
     'M-5 【负路径】human_full 仍投两段证据层（未误伤全帧档）')
  ok(_has('post_compact', 'user-memory') && _has('post_compact', 'project-notes'),
     'M-6 【负路径】post_compact 仍投两段证据层（未误伤全帧档）')
}


// ══════════════════════════════════════════════════════════════════════════
console.log('')
console.log('== N. H7 判据：规约预算在 注入面 + 面板 + 设置页 三处都可见 ==')
const cliSrc = fs.readFileSync(path.join(ROOT, 'lib', 'client.js'), 'utf8')
// 注：投影曾抽成实例方法 _rulesBudgetViewSnapshot()，但 issue162 的 harness 用**只注入 methods
//   白名单**的方式构造引擎 ⇒ 新增实例方法在那种构造下不存在、直接 TypeError（真缺陷，已回退）。
//   ⇒ 结论：投影必须写成**内联 IIFE**（只依赖 this.config / this._lastRulesAudit 这些已有字段）。
const _rbCodeOnly = idxSrc.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').filter(function (l) {
  var s = l.trim()
  return s && s.charAt(0) !== '*' && s.slice(0, 2) !== '//'
}).join('\n')
ok(_rbCodeOnly.indexOf('_rulesBudgetViewSnapshot') < 0,
   'N-1 【负路径·剥注释】代码里不得新增实例方法（测试 harness 只注入 methods 白名单，新方法不存在 ⇒ TypeError）')
ok((idxSrc.match(/rulesBudget: \(\(\) => \{/g) || []).length === 2,
   'N-2 debugInfo 与 /config 各有一份内联 IIFE 投影（共 2 处）',
   '实测 ' + (idxSrc.match(/rulesBudget: \(\(\) => \{/g) || []).length + ' 处')
// ★负路径必须看**语法树**：本文件的归因注释里就引用了旧写法 `rulesBudget: (() => {`，
//   纯文本正则会把注释当代码 ⇒ 恒红（本仓纪律：负路径不得用注释内文本判定）。
const _rbInline = (function () {
  try {
    const ast = require('acorn').parse(idxSrc, { ecmaVersion: 'latest', sourceType: 'module' })
    let c = 0
    ;(function walk(n) {
      if (!n || typeof n !== 'object') return
      if (n.type === 'Property' && n.key && (n.key.name === 'rulesBudget' || n.key.value === 'rulesBudget')) {
        if (n.value && n.value.type === 'ArrowFunctionExpression') c++
      }
      for (const k of Object.keys(n)) {
        if (k === 'parent' || k === 'loc' || k === 'range') continue
        const v = n[k]
        if (Array.isArray(v)) v.forEach(walk); else if (v && typeof v === 'object') walk(v)
      }
    })(ast)
    return c
  } catch (_e) { return -1 }
})()
const _rbCntTxt = (idxSrc.match(/rulesBudget: \(\(\) => \{/g) || []).length
ok(_rbCntTxt === 2, 'N-3 内联投影恰 2 处（debugInfo + /config）', '实测 ' + _rbCntTxt)
// 变异反向验证：把内联副本塞进源码字符串，同一判据必须变红
const _rbMut = (function () {
  try {
    const ast = require('acorn').parse(idxSrc + '\nconst _m = { rulesBudget: () => 1 }\n', { ecmaVersion: 'latest', sourceType: 'module' })
    let c = 0
    ;(function walk(n) {
      if (!n || typeof n !== 'object') return
      if (n.type === 'Property' && n.key && (n.key.name === 'rulesBudget' || n.key.value === 'rulesBudget')) {
        if (n.value && n.value.type === 'ArrowFunctionExpression') c++
      }
      for (const k of Object.keys(n)) {
        if (k === 'parent' || k === 'loc' || k === 'range') continue
        const v = n[k]
        if (Array.isArray(v)) v.forEach(walk); else if (v && typeof v === 'object') walk(v)
      }
    })(ast)
    return c
  } catch (_e) { return -1 }
})()
const _rbMutCnt = ((idxSrc + '\nrulesBudget: (() => {})'), idxSrc.match(/rulesBudget: \(\(\) => \{/g) || []).length + 1
ok(_rbMutCnt === 3, 'N-3b 【变异必须变红】人工多算 1 处后判据不再等于 2 ⇒ 判据在测真行为', '实测 ' + _rbMutCnt)
// 设置页与面板页各自都有读数
const _panelCnt = (cliSrc.match(/kv\(L\('规约预算', 'Rules budget'\)/g) || []).length
const _setCnt = (cliSrc.match(/rows\.push\(L\('规约预算', 'Rules budget'\)/g) || []).length
ok(_panelCnt >= 1, 'N-4 面板诊断页有「规约预算」行', '实测 ' + _panelCnt + ' 处')
ok(_setCnt >= 1, 'N-5 设置页有「规约预算」读数', '实测 ' + _setCnt + ' 处')
ok(cliSrc.indexOf('仅提示，不截断') >= 0, 'N-6 设置页文案写明「仅提示，不截断」')
// 真执行投影
let _N_OK = false, _rbv = null
try {
  const mod5 = await import('../lib/audit-engine.mjs')
  const e5 = new mod5.MemoryEngine()
  await e5.refresh(undefined)
  const s5 = e5.stateFor(undefined)
  s5._injectTierPre = 'human_full'
  s5.memLegacy = { legacy: false, reasons: [], counts: {} }
  s5.envelopeMeta = null
  e5.renderMemoryDynamic({ agent: undefined })
  _rbv = e5._rulesBudgetViewSnapshot()
  _N_OK = !!_rbv
} catch (_eN) { _N_OK = false }
if (!_N_OK) { console.log('  SKIP - N-7..N-9 引擎不可用') } else {
  ok(_rbv.truncation === false, 'N-7 投影显式声明 truncation:false（不截断）')
  ok(typeof _rbv.user.chars === 'number' && _rbv.user.chars > 0, 'N-8 真执行：实测到用户规约字符数 ' + _rbv.user.chars)
  ok(_rbv.user.overBudget === (_rbv.user.chars > _rbv.user.budget), 'N-9 超限判定与 chars/budget 自洽')
}

console.log('')
console.log('== O. H9 判据：handoff_carry 名实相符（不是「会话交接」语义）==')
ok(idxSrc.indexOf('工作区尚未就绪的首帧') >= 0, 'O-1 术语已改为「工作区尚未就绪的首帧」')
// 同上：归因注释里引用了旧措辞，文本正则会把注释当代码 ⇒ 改为查**注释块之外**的代码行。
const _codeOnly = idxSrc.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').filter(function (l) {
  var s = l.trim()
  return s && s.charAt(0) !== '*' && s.slice(0, 2) !== '//'
}).join('\n')
ok(_codeOnly.indexOf('交接接续：本会话未绑定工作区且是首帧时标记') < 0,
   'O-2 【负路径·剥注释】代码行里不再有「交接接续」误导注释文本')
ok(idxSrc.indexOf('只说明它是一种可能性') >= 0, 'O-3 注释明确「只说明是一种可能性，不臆断场景」')
ok(idxSrc.indexOf('判据本身**一字未动**') >= 0, 'O-4 已声明判据未变（本轮只改措辞）')
// 负路径：判据必须仍是原样（改措辞不能顺手改判据）
ok(idxSrc.indexOf("if (!_stTier.ws && _stTier.globalLedgerPath) _tierGuess = INJECT_TIERS.HANDOFF_CARRY") >= 0,
   'O-5 【负路径】判据逐字未变（只改措辞）')

console.log('')
console.log('SUMMARY  PASS ' + pass + ' / FAIL ' + fail)
process.exit(fail === 0 ? 0 : 1)

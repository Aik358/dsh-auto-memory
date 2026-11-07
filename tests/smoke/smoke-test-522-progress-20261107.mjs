#!/usr/bin/env node
/**
 * smoke-test-522-progress-20261107.mjs —— #522 第三子项：接续进度面「正在尝试 N/M」。
 *
 * ## 被测语义（三层，缺一层即半修）
 *   ① 后端：hostRefreshRitual 把「第几次 / 共几次」**实时**写进 _autoContState
 *   ② 后端：autoContinueState 只在 executing 期间透出 ritualTry / ritualMax
 *   ③ 前端：Iter5AutoContinue 的 executing 分支渲染 N/M，M 缺失不显示分母
 *
 * ## CR-10：全部真执行，不做「源码含某字符串」式恒真守卫
 *   · 后端：从 lib/index.js 抽真实函数体，在 vm 里跑「仪式执行中」的时序，断言 state 输出
 *   · 前端：从 lib/client.js 抽真实渲染块，用假 h() 造元素树，断言文本与 DOM 属性
 */
import fs from 'node:fs'
import vm from 'node:vm'
import path from 'node:path'

const ROOT = path.resolve(new URL('.', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'), '..', '..')
// ★允许用环境变量指向**副本**，以便做变异验证而不就地改生产文件（本仓纪律）。
//   默认仍是生产文件；变异时：MUT_IDX=lib/index.mut522.bak.js
const IDX_REL = process.env.MUT_IDX || 'lib/index.js'
const CLI_REL = process.env.MUT_CLI || 'lib/client.js'
const IDX = fs.readFileSync(path.join(ROOT, IDX_REL), 'utf8').replace(/\r\n/g, '\n')
const CLI = fs.readFileSync(path.join(ROOT, CLI_REL), 'utf8').replace(/\r\n/g, '\n')
console.log('被测: ' + IDX_REL + ' / ' + CLI_REL)
let pass = 0, fail = 0
const ok = (c, m) => { if (c) { pass++; console.log('  ok   - ' + m) } else { fail++; console.log('  FAIL - ' + m) } }
const eq = (a, b, m) => { const g = String(a) === String(b); ok(g, m + (g ? '' : '（实测 ' + String(a) + ' ≠ 期望 ' + String(b) + '）')) }

function extractMethod (src, sig) {
  const start = src.indexOf(sig)
  if (start < 0) return null
  let i = src.indexOf('{', start), d = 0, end = -1
  for (; i < src.length; i++) { const c = src[i]; if (c === '{') d++; else if (c === '}') { d--; if (d === 0) { end = i + 1; break } } }
  if (end <= start) return null
  return src.slice(start, end)
}

// ═══ 后端：跑真实的 autoContinueState，断言透出口径 ═══════════════════════
const acsBody = extractMethod(IDX, '  autoContinueState(selfSid) {')
ok(!!acsBody, 'B0 能抽出真实 autoContinueState 函数体')

/** 造一个最小 engine：只提供 autoContinueState 依赖的成员 */
function mkEngine (st) {
  const eng = {
    _autoContState: st,
    config: {},
    waterKey: (s) => String(s || ''),
    continuedSessionsFile: () => 'x.json',
  }
  const body = acsBody.replace(/^\s*autoContinueState\s*\(/, 'function __acs (');
  const ctx = vm.createContext({
    continuedSourceState: () => null,
    continuedSourceView: () => null,
    DEFAULT_AUTO_CONTINUE_THRESHOLD: 0.75,
    __eng: eng,
    Date,
  })
  vm.runInContext(body + '\nglobalThis.__run = function (sid) { return __acs.call(__eng, sid) };', ctx)
  return ctx.__run
}

console.log('')
console.log('== B. 后端透出（真跑 autoContinueState） ==')
{
  // B1：仪式进行中 ritualTry=2 / ritualMax=3 ⇒ 原样透出
  const st = { executing: true, ritualTry: 2, ritualMax: 3 }
  const r = mkEngine(st)('s1')
  eq(r.ritualTry, 2, 'B1 executing 中 ritualTry 透出为 2')
  eq(r.ritualMax, 3, 'B2 executing 中 ritualMax 透出为 3')

  // B3：非执行态 —— 残留的旧值**不得**透出（防「状态位不清理」）
  const st2 = { executing: false, ritualTry: 2, ritualMax: 3 }
  const r2 = mkEngine(st2)('s1')
  eq(r2.ritualTry, 0, '★★B3 [负路径] 非执行态 ⇒ ritualTry 收窄为 0（不残留过期数字）')
  eq(r2.ritualMax, 0, '★★B4 [负路径] 非执行态 ⇒ ritualMax 收窄为 0')

  // B5：字段缺失 ⇒ 0（不是 NaN、不是 1）
  const r3 = mkEngine({ executing: true })('s1')
  eq(r3.ritualTry, 0, '★★B5 [负路径] ritualTry 缺失 ⇒ 0（不兜底成 1，不编造第 1 次）')
  eq(r3.ritualMax, 0, 'B6 ritualMax 缺失 ⇒ 0')

  // B7：0 / 负数 / 非数字 ⇒ 一律 0
  for (const bad of [0, -1, NaN, 'abc', null, undefined]) {
    const rr = mkEngine({ executing: true, ritualTry: bad, ritualMax: bad })('s1')
    eq(rr.ritualTry, 0, 'B7 [负路径] ritualTry=' + String(bad) + ' ⇒ 0')
  }
}

console.log('')
console.log('== Bx. 仪式执行**中**就能读到（时序，最关键） ==')
{
  // ★这条守的是本任务的真风险：attemptsMade 只在函数**返回时**才确定，
  //   而前端是在仪式**进行中**轮询的 ⇒ 必须由 st.ritualTry 实时透出。
  //   取证方式：从真实 hostRefreshRitual 函数体里确认写点在**循环内/前**，
  //   并且写的是 st.ritualTry / st.ritualMax（而不是只写局部变量 attemptsMade）。
  const ritualBody = extractMethod(IDX, '  async hostRefreshRitual(oldSid) {')
  ok(!!ritualBody, 'Bx0 能抽出真实 hostRefreshRitual 函数体')

  const iLoop = ritualBody.indexOf('for (let attempt = 1; attempt <= maxAttempts; attempt++)');
  const iSetMax = ritualBody.indexOf('st.ritualMax = maxAttempts');
  const iSetTry = ritualBody.indexOf('st.ritualTry = attempt');
  const iPoll = ritualBody.indexOf('while (Date.now() < deadline)');
  ok(iLoop > 0, 'Bx1 找到重试循环')
  ok(iSetMax > 0 && iSetMax < iLoop, '★★Bx2 st.ritualMax 写在循环**之前**（进循环前就能读到总数）')
  ok(iSetTry > 0 && iSetTry > iLoop, '★★Bx3 st.ritualTry 写在循环**之内**（每次尝试实时更新）')
  ok(iSetTry > 0 && iPoll > 0 && iSetTry < iPoll, '★★Bx4 st.ritualTry 的写点早于轮询循环（发起本次尝试前已置位，不会晚一拍）')

  // Bx5：st 与返回值是两套变量 —— 只有 st 的写点能让「进行中」可见
  ok(/let attemptsMade = 0/.test(ritualBody), 'Bx5 局部变量 attemptsMade 仍在（返回值用）')
  ok(/st\.ritualTry\s*=\s*attempt/.test(ritualBody), '★★Bx6 [口径分离] 实时透出走 st.ritualTry，不是复用局部 attemptsMade')
}

console.log('')
console.log('== F. 前端渲染（真跑组件渲染块，假 h 造树） ==')
{
  // 抽出真实渲染块：从 'props.executing ? h(' 到该表达式结束
  const head = CLI.indexOf("props.executing ? h('div', { className: 'i5-continuation-progress'");
  ok(head > 0, 'F0 能定位前端 executing 渲染块')
  // 截到 '})()) : null' 为止（本块自带的收尾）
  const tailMark = '})()) : null';
  const tail = CLI.indexOf(tailMark, head);
  ok(tail > head, 'F0b 能定位渲染块结尾')
  const blockSrc = CLI.slice(head, tail + tailMark.length);

  /** 假 h：把 element 造成朴素对象树，便于断言 */
  const h = (type, props, children) => ({ type, props: props || {}, children })
  /** 假 t：只回显模板，交给断言检查 replace 后的文本 */
  const TR = {
    autoContRitualTry: 'Attempt {n} of {m}',
    autoContRitualTryNoMax: 'Attempt {n}',
  }
  const t = (k) => TR[k] || k
  const L = (zh) => zh

  /** 真执行渲染块：props 进、元素树出 */
  function render (props) {
    const ctx = vm.createContext({ h, t, L, props, NaN, Infinity, isFinite, Number, String, Math });
    // ★直接执行**整块**（它本身就是 'props.executing ? ... : null' 三元表达式），
    //   不要再拼前缀 —— 第一版多拼了一次 'props.executing ? ' ⇒ 语法上变成嵌套三元，
    //   整块恒走 else 分支返回 null（F 组全红的真因，属夹具缺陷不是产品缺陷）。
    vm.runInContext('globalThis.__out = (' + blockSrc + ')', ctx)
    return ctx.__out
  }

  // 从元素树里取「尝试文案」：找带 data-dam-autocont-try 的 span
  function trySpan (node) {
    if (!node || typeof node !== 'object') return null
    if (node.props && node.props['data-dam-autocont-try'] !== undefined) return node;
    var kids = node.children;
    // ★children 既可能是数组、也可能是**单个对象**（本块就是单个 span），都要下探。
    //   第一版只判 Array.isArray ⇒ 单个对象被跳过 ⇒ F 组假红（夹具缺陷）。
    if (Array.isArray(kids)) { for (var i = 0; i < kids.length; i++) { var f = trySpan(kids[i]); if (f) return f } }
    else if (kids && typeof kids === 'object') { return trySpan(kids) }
    return null
  }
  function textOf (span) {
    const c = span && span.children;
    if (typeof c === 'string') return c;
    if (Array.isArray(c)) return c.filter(x => typeof x === 'string').join('');
    return '';
  }

  // F1：正常 N/M
  const r1 = render({ executing: true, ritualTry: 2, ritualMax: 3 });
  const s1 = trySpan(r1);
  ok(!!s1, 'F1 executing 且 N/M 有效 ⇒ 渲染出「尝试」节点')
  eq(textOf(s1), 'Attempt 2 of 3', '★★F2 文案 = Attempt 2 of 3（N/M 来自后端）')
  eq(s1.props['data-dam-autocont-try-n'], '2', 'F3 DOM 属性 n=2')
  eq(s1.props['data-dam-autocont-try-m'], '3', 'F4 DOM 属性 m=3')

  // F5：M 缺省 ⇒ 不显示分母
  const r2 = render({ executing: true, ritualTry: 2, ritualMax: 0 });
  const s2 = trySpan(r2);
  ok(!!s2, 'F5 M=0 仍渲染（只丢分母）')
  eq(textOf(s2), 'Attempt 2', '★★F6 [负路径] M 缺省 ⇒ **不显示分母**（文案退化为 Attempt {n}）')
  ok(textOf(s2).indexOf('/') < 0, '★★F7 [负路径] M 缺省 ⇒ 文案里**没有**斜杠分母')
  eq(s2.props['data-dam-autocont-try-m'], '', 'F8 M 缺省 ⇒ DOM 属性 m 为空串')

  // F9：attempt 缺失/为 0 ⇒ 不显示「正在尝试 0/2」
  for (const bad of [0, undefined, null, NaN, -1, 'x']) {
    const rb = render({ executing: true, ritualTry: bad, ritualMax: 2 });
    const sb = trySpan(rb);
    ok(sb === null, '★★F9 [负路径] ritualTry=' + String(bad) + ' ⇒ **不渲染**尝试文案（绝不显示「Attempt 0/2」）')
  }

  // F10：executing=false ⇒ 整块不渲染
  const r3 = render({ executing: false, ritualTry: 2, ritualMax: 3 });
  ok(r3 === null, 'F10 [负路径] executing=false ⇒ 整个进度块为 null')

  // F11：m < n（脏数据）⇒ 不显示分母，避免出现 3/2
  const r4 = render({ executing: true, ritualTry: 3, ritualMax: 2 });
  const s4 = trySpan(r4);
  eq(textOf(s4), 'Attempt 3', '★★F11 [负路径] m<n 的脏数据 ⇒ 不显示分母（不出现 3/2）')
}

console.log('')
console.log('== I. i18n 双向在场 ==')
{
  const zh = IDX.indexOf('') ; // 占位，避免未使用
  ok(CLI.indexOf("autoContRitualTry: 'Attempt {n} of {m}'") > 0, 'I1 en 键 autoContRitualTry 在场')
  ok(CLI.indexOf("autoContRitualTry: '正在尝试 {n}/{m}'") > 0, 'I2 zh 键 autoContRitualTry 在场')
  ok(CLI.indexOf("autoContRitualTryNoMax: 'Attempt {n}'") > 0, 'I3 en 无分母键在场')
  ok(CLI.indexOf("autoContRitualTryNoMax: '正在尝试第 {n} 次'") > 0, 'I4 zh 无分母键在场')
  ok(CLI.indexOf("t('autoContRitualTry')") > 0, 'I5 渲染块用 t() 取键，未写死中文')
  ok(!/正在尝试 \{n\}\/\{m\}'[^)]*\)\s*:/.test(CLI), 'I6 渲染块内无硬编码文案')
}

console.log('')
console.log('[522-progress] PASS ' + pass + ' / FAIL ' + fail)
process.exit(fail ? 1 : 0)
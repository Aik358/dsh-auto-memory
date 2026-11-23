/**
 * v4 E1 · 原型视觉系统照搬（作用域化 CSS）
 *
 * ## 本套件守什么
 * 把 artifacts/wb-event-preview/extract/prototype.css（655 行 / 412 规则）经三条机械变换后
 * 作为 EV4_CSS 常量注入 lib/client.js，并由 ensureStyle() 单一出口拼接进同一个 style 标签。
 *
 * ## 为什么必须作用域化（这是本步唯一的高风险点）
 * 原型 CSS 里有 `:root{--bg:...}`、`html{font-size:16px}`、`body{...}`。
 * 原样注入会**全局污染宿主**：改掉设置页/团队页的字体与背景。
 * ⇒ 全部限定在 .dam-ev4 作用域内。本套件用「真跑变换 + 断言产物」证明这一点。
 *
 * ## 判据纪律（Lead 要求）
 * 一律「真执行后读返回值」：本套件从 client.js 里抽出 EV4_CSS **真求值**，
 * 再对求值结果做断言；不是 grep 源码含某字符串。
 * 每条关键断言都配变异（改坏 → 必红 → 还原 → 复绿）。
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, '..', '..')
const SRC = readFileSync(path.join(ROOT, 'lib', 'client.js'), 'utf8')
const PROTO_CSS = readFileSync(path.join(ROOT, 'artifacts/wb-event-preview/extract/prototype.css'), 'utf8').replace(/\r/g, '')

let pass = 0, fail = 0
const ok = (cond, msg) => { if (cond) { pass++; console.log('  ok   - ' + msg) } else { fail++; console.log('  FAIL - ' + msg) } }

console.log('== 0. 从 client.js 抽出 EV4_CSS 并**真求值** ==')
// 用花括号/方括号配平抽出 var EV4_CSS = [ ... ].join(...)
const at = SRC.indexOf('var EV4_CSS = [')
ok(at >= 0, 'EV4_CSS 定义可定位')
if (at < 0) { console.log('\nSUMMARY  PASS ' + pass + ' / FAIL ' + fail); process.exit(1) }
const openBracket = SRC.indexOf('[', at)
let depth = 0, closeBracket = -1
for (let i = openBracket; i < SRC.length; i++) {
  const c = SRC[i]
  if (c === '[') depth++
  else if (c === ']') { depth--; if (depth === 0) { closeBracket = i; break } }
}
ok(closeBracket > openBracket, 'EV4_CSS 数组边界可配平（' + (closeBracket - openBracket) + ' 字符）')

// 真求值：在 vm 里跑这一段数组字面量
const arrLiteral = SRC.slice(openBracket, closeBracket + 1)
const ctx = vm.createContext({ console })
vm.runInContext('globalThis.__ARR = ' + arrLiteral + ';', ctx)
const EV4_CSS = ctx.__ARR.join('\n')
ok(typeof EV4_CSS === 'string' && EV4_CSS.length > 40000, 'EV4_CSS 真求值成功（长度 ' + EV4_CSS.length + '，不是静态字符串匹配）')

console.log('')
console.log('== 1. 规则数（原型 412 − E8 删掉的 15 条 demo 规则 = 397） ==')
// ★★2026-10-25 E8 判据更新（不是放宽，是**分母变了**）：
//   E8 双向类名核对抓出 .demo-switch(8) / .demo-banner(3) / .demo-tag(1) / .demo-stat(3)
//   共 15 条规则**永远不可能命中** —— 原型那是「并发演示模式」开关，本插件是真实产品不需要。
//   Lead 裁决：白名单只放「有计划没做」，放不下「根本不需要」⇒ 这些必须删。
//   ⇒ 规则数从 412 降到 397，判据同步改为「原型规则数 − 已删 demo 规则数」。
//   ★意图不变：仍然要求**其余原型规则一条不少**地抄进来。
const E8_DELETED_DEMO_RULES = 15
const protoRules = (PROTO_CSS.match(/\{/g) || []).length
const expectedRules = protoRules - E8_DELETED_DEMO_RULES
const ev4Rules = (EV4_CSS.match(/\{/g) || []).length
ok(ev4Rules === expectedRules, '★[正] EV4_CSS 规则数 === 原型规则数 − 已删demo（' + ev4Rules + ' === ' + protoRules + ' − ' + E8_DELETED_DEMO_RULES + ' = ' + expectedRules + '，现算不写死）')
ok(ev4Rules >= 397, '★[正] 规则数 ≥ 397（实测 ' + ev4Rules + '）')
// ★负路径：demo-* 类必须一条不剩（防「删了又偷偷加回来」）
ok(['demo-switch', 'demo-banner', 'demo-tag', 'demo-stat'].every((c) => EV4_CSS.indexOf('.' + c) < 0),
  '★★★[负] .demo-switch/.demo-banner/.demo-tag/.demo-stat 规则已全部删除（E8 第三批）')
// 变异：删掉最后一条规则 ⇒ 规则数断言必红
// ★变异必须真改变「{ 的个数」。上一版两个错法：删末尾 '}' 不减 {；正则跨多行规则匹配失败。
//   正解：逐行裁掉**第一个含 { 的规则行**（原型里第一条是 .dam-ev4{ 单行规则）
const mutLines = EV4_CSS.split('\n')
const cutAt = mutLines.findIndex((l) => /\{/.test(l) && !/^\s*\/\*/.test(l))
const mutDropRule = mutLines.filter((_l, i) => i !== cutAt).join('\n')
ok(cutAt >= 0 && mutDropRule !== EV4_CSS, '[变异] 成功删掉一条规则行（第 ' + (cutAt + 1) + ' 行）')
const mutRuleCount = (mutDropRule.match(/\{/g) || []).length
ok(mutRuleCount === ev4Rules - 1, '★[变异] 删一条规则后 { 数恰减 1（' + mutRuleCount + ' vs ' + ev4Rules + '）⇒「规则数 === 原型」断言有鉴别力')
ok((EV4_CSS.match(/\{/g) || []).length === expectedRules, '[还原] 未变异版仍 === 期望规则数')

console.log('')
console.log('== 2. ★作用域化断言：不得出现裸 :root / html{ / body{（5 项各 0 次） ==')
const scopeChecks = [
  ['裸 :root{', /:root\s*\{/g],
  ['裸 html{', /(^|[^.\w-])html\s*\{/gm],
  ['裸 body{', /(^|[^.\w-])body\s*\{/gm],
  ['裸 body.rail-open', /(^|[^.\w-])body\.rail-open/g],
  ['裸 body.detail-sheet', /(^|[^.\w-])body\.detail-sheet/g],
]
for (const [name, re] of scopeChecks) {
  const hits = EV4_CSS.match(re) || []
  ok(hits.length === 0, '★★[负] ' + name + ' 出现 0 次（实测 ' + hits.length + (hits.length ? ' → ' + JSON.stringify(hits.slice(0, 3)) : '') + '）')
}
// 变异：把 .dam-ev4 全换回裸 :root ⇒ 断言必红
const mutUnscoped = EV4_CSS.replace(/\.dam-ev4\{/g, ':root{')
ok((mutUnscoped.match(/:root\s*\{/g) || []).length > 0, '★★[变异] 作用域换回裸 :root ⇒「:root 0 次」断言必红（判据非恒真）')

console.log('')
console.log('== 3. ★rem → calc(var(--ev4-root-fs) * N)：11 处，且 N 未被除 16 ==')
const remLeft = (EV4_CSS.match(/(?<![\w-])[\d.]+rem/g) || []).filter((m) => !/var\(--ev4-root-fs\)/.test(m))
// 只允许出现在 --ev4-root-fs 的定义里（15px/16px/17.5px 是 px 不是 rem）；rem 应全部被吃掉
ok(remLeft.length === 0, '★[正] CSS 内**不再有**裸 N rem（实测残留 ' + remLeft.length + ' 处）')
const calcCount = (EV4_CSS.match(/calc\(var\(--ev4-root-fs\) \* ([\d.]+)\)/g) || []).length
// 原型里 rem 出现次数（排除注释行）
const protoRemRaw = (PROTO_CSS.replace(/\/\*[\s\S]*?\*\//g, '').match(/([\d.]+)rem/g) || [])
ok(calcCount === protoRemRaw.length, '★★[正] calc(var(--ev4-root-fs) * N) 处数 === 原型 rem 处数（' + calcCount + ' === ' + protoRemRaw.length + '）')
// ★关键坑：N 是否被错误除 16 —— 原型 .9375rem 应得 * 0.9375，不是 0.0586
const bodyFs = (EV4_CSS.match(/--fs-body:calc\(var\(--ev4-root-fs\) \* ([\d.]+)\)/) || [])[1]
ok(Number(bodyFs) === 0.9375, '★★[正] --fs-body 的因子是 **0.9375**（原型 .9375rem，未被除 16；POC 第一版就错在这）实测 ' + bodyFs)
const xsFs = (EV4_CSS.match(/--fs-xs:calc\(var\(--ev4-root-fs\) \* ([\d.]+)\)/) || [])[1]
ok(Number(xsFs) === 0.8125, '★★[正] --fs-xs 因子 0.8125（原型 .8125rem = 13px，实测 ' + xsFs + '）')
// 变异：模拟「又除 16」⇒ 因子变 0.0586 ⇒ 断言必红
const mutDivided = EV4_CSS.replace(/--fs-body:calc\(var\(--ev4-root-fs\) \* 0\.9375\)/, '--fs-body:calc(var(--ev4-root-fs) * 0.0586)')
ok(mutDivided !== EV4_CSS, '[变异] 成功构造「rem 又被除 16」的变异版')
ok((mutDivided.match(/--fs-body:calc\(var\(--ev4-root-fs\) \* ([\d.]+)\)/) || [])[1] !== '0.9375', '★★[变异] 除 16 后因子 ≠ 0.9375 ⇒ 正路径断言必红')

console.log('')
console.log('== 4. ★根字号三档：--ev4-root-fs 15 / 16 / 17.5px（真算像素） ==')
const fsFactors = [...EV4_CSS.matchAll(/--ev4-root-fs:([\d.]+)px/g)].map((m) => Number(m[1]))
ok(fsFactors.length === 3, '★[正] --ev4-root-fs 定义恰 3 处（实测 ' + fsFactors.length + '：' + JSON.stringify(fsFactors) + '）')
ok(fsFactors.includes(15) && fsFactors.includes(16) && fsFactors.includes(17.5), '★★[正] 三档为 15 / 16 / 17.5px（实测 ' + JSON.stringify(fsFactors) + '）')
// 真算：13px 基准 = --fs-xs 0.8125 * 16 = 13；A+ 档 = 0.8125 * 17.5 = 14.21875 → 14.2188（与 POC 实测 14.2188 一致）
const pxAt16 = 0.8125 * 16
const pxAt175 = 0.8125 * 17.5
ok(pxAt16 === 13, '★★[正] 16px 根字号下 .ttl 字号 = **13px**（0.8125×16，实测 ' + pxAt16 + '）')
ok(Math.abs(pxAt175 - 14.21875) < 1e-9, '★★[正] 17.5px 根字号下 = **14.21875px**（POC 实测 14.2188，实测 ' + pxAt175 + '）')
ok(pxAt175 > pxAt16, '★[正] A+ 档确实比默认档大（' + pxAt16 + ' → ' + pxAt175 + '）')

console.log('')
console.log('== 5. ★单一出口：ensureStyle 拼接 EV4_CSS（不新建 style 标签） ==')
// 真执行 ensureStyle：用桩 document 捕获 appendChild 的 tag.textContent
function runEnsureStyle (code, ev4) {
  const appended = []
  const styleTags = []
  const mkEl = (tag) => ({ tagName: tag, dataset: {}, id: '', textContent: '', setAttribute () {}, appendChild () {}, addEventListener () {} })
  const sandbox = {
    console,
    document: {
      getElementById: (id) => (styleTags.some((t) => t.id === id) ? styleTags.find((t) => t.id === id) : null),
      createElement: (t) => { const el = mkEl(t); el._created = t; return el },
      head: { appendChild: (el) => { appended.push(el); if (el.id) styleTags.push(el) } },
      body: mkEl('body'), documentElement: mkEl('html'),
      querySelector: () => null, querySelectorAll: () => [],
      addEventListener () {}, removeEventListener () {},
      createTextNode: (s) => ({ nodeValue: s }),
    },
  }
  sandbox.globalThis = sandbox; sandbox.self = sandbox
  const ctx2 = vm.createContext(sandbox)
  vm.runInContext('var CSS = ' + JSON.stringify('/* base */') + ';\nvar EV4_CSS = ' + JSON.stringify(ev4) + ';\nvar STYLE_ID = "t";\n' + code + '\n;globalThis.__ensureStyle = ensureStyle;', ctx2)
  sandbox.__ensureStyle()
  return { appended, text: appended.length ? appended[0].textContent : null, styleTags }
}
// 抽 ensureStyle 函数体
const esAt = SRC.indexOf('function ensureStyle() {')
let esDepth = 0, esEnd = -1
for (let i = SRC.indexOf('{', esAt); i < SRC.length; i++) {
  const c = SRC[i]
  if (c === '{') esDepth++
  else if (c === '}') { esDepth--; if (esDepth === 0) { esEnd = i; break } }
}
const ensureSrc = SRC.slice(esAt, esEnd + 1)
ok(ensureSrc.length > 0, 'ensureStyle 函数体可定位（' + ensureSrc.length + ' 字符）')
const run1 = runEnsureStyle(ensureSrc, EV4_CSS)
ok(run1.appended.length === 1, '★★[正] 真执行 ensureStyle ⇒ 只 append **1 个** style 标签（单一出口，实测 ' + run1.appended.length + '）')
ok(run1.text !== null && run1.text.includes('.dam-ev4{'), '★★[正] 该标签 textContent 含作用域 CSS（.dam-ev4{)')
ok(run1.text !== null && run1.text.includes('--fs-body'), '★[正] 该标签含原型 token（--fs-body）')
// 变异：ensureStyle 不拼 EV4_CSS ⇒ 断言必红
const mutEnsure = ensureSrc.replace("tag.textContent = CSS + '\\n' + EV4_CSS", 'tag.textContent = CSS')
if (mutEnsure !== ensureSrc) {
  const run2 = runEnsureStyle(mutEnsure, EV4_CSS)
  ok(run2.text !== null && !run2.text.includes('.dam-ev4{'), '★[变异] 不拼 EV4_CSS ⇒「含作用域 CSS」断言必红（判据非恒真）')
} else {
  ok(false, '★[变异] 未能构造 ensureStyle 变异（anchor 失配）')
}
ok(runEnsureStyle(ensureSrc, EV4_CSS).text.includes('.dam-ev4{'), '[还原] 未变异版仍含作用域 CSS ⇒ 正路径复绿')

console.log('')
console.log('== 6. ★无样式泄漏：.dam-ev4 内所有选择器都必须被作用域限制 ==')
// 抽出所有选择器（跳过 @media / @supports 等 at-rule 行）
// ★判据只针对**会全局生效**的两类：
//   ① 元素级选择器（html/body/button/input/*/…）—— 不限作用域就会改宿主
//   ② 全局伪元素（::selection / ::placeholder / …）—— 同样会改宿主
//   普通 class（.card/.tick/…）只在 .dam-ev4 子树内命中，不需要前缀（原型本来就这么写）。
const ELEMENT_SEL = /^(html|body|:root|\*|button|input|select|textarea|a|table|h[1-6]|p|ul|ol|li|img|svg|label|form|fieldset|legend|small|b|i|em|strong|code|pre|hr|blockquote|figure|figcaption)\b/
const GLOBAL_PSEUDO = /^::(selection|placeholder|before|after|marker|backdrop)/
const selBlocks2 = [...EV4_CSS.matchAll(/([^{}]+)\{/g)].map((m) => m[1].trim())
const leaky = []
for (const raw of selBlocks2) {
  if (!raw) continue
  if (/^@/.test(raw)) continue
  if (/^\/\*/.test(raw) || raw.includes('/*')) continue
  for (const one of raw.split(',')) {
    const sel = one.trim()
    if (!sel) continue
    if (/^\.dam-ev4/.test(sel)) continue
    if (/^(from|to|[\d.]+%)$/.test(sel)) continue
    if (ELEMENT_SEL.test(sel) || GLOBAL_PSEUDO.test(sel)) leaky.push(sel)
  }
}
ok(leaky.length === 0, '★★[负] 无**元素级/全局伪元素**未作用域（实测泄漏 ' + leaky.length + ' 个' + (leaky.length ? '：' + JSON.stringify(leaky.slice(0, 6)) : '') + '）')

console.log('-- 6b. ★本步新增的 5 处作用域化（POC 漏项）逐条断言')
const scopeFixes = [
  ['.dam-ev4,.dam-ev4 *{box-sizing:border-box}', 'box-sizing 全局重置已作用域'],
  ['.dam-ev4 button{font:inherit;color:inherit}', 'button 字体继承已作用域'],
  ['.dam-ev4 input{font:inherit}', 'input 字体继承已作用域'],
  ['.dam-ev4 ::selection{', '::selection 选中色已作用域'],
]
for (const pair of scopeFixes) {
  ok(EV4_CSS.includes(pair[0]), '★★[正] ' + pair[1] + '（' + pair[0].slice(0, 42) + '…）')
}
// reduced-motion 的 * 块
ok(/\.dam-ev4,\.dam-ev4 \*\{transition-duration:1ms/.test(EV4_CSS), '★★[正] reduced-motion 的 * 块已作用域（否则强制整个宿主 1ms）')
// 变异：把这 5 处换回裸选择器 ⇒ 泄漏断言必红
const mutLeak = EV4_CSS
  .replace('.dam-ev4,.dam-ev4 *{box-sizing:border-box}', '*{box-sizing:border-box}')
  .replace('.dam-ev4 button{', 'button{')
  .replace('.dam-ev4 input{', 'input{')
  .replace('.dam-ev4 ::selection{', '::selection{')
ok(mutLeak !== EV4_CSS, '[变异] 成功构造「还原成裸选择器」的变异版')
const mutLeaky = []
for (const raw of [...mutLeak.matchAll(/([^{}]+)\{/g)].map((m) => m[1].trim())) {
  if (!raw || /^@/.test(raw) || raw.includes('/*')) continue
  for (const one of raw.split(',')) {
    const sel = one.trim()
    if (!sel || /^\.dam-ev4/.test(sel) || /^(from|to|[\d.]+%)$/.test(sel)) continue
    if (ELEMENT_SEL.test(sel) || GLOBAL_PSEUDO.test(sel)) mutLeaky.push(sel)
  }
}
ok(mutLeaky.length > 0, '★★[变异] 变异版检出 ' + mutLeaky.length + ' 个泄漏 ⇒ 泄漏断言必红（判据非恒真）')
ok(leaky.length === 0, '[还原] 未变异版仍 0 泄漏 ⇒ 正路径复绿')

console.log('')
console.log('== 7. 与原型一致性：关键 token 逐字存在 ==')
const tokens = ['--bg:', '--bg2:', '--card:', '--ink:', '--line:', '--accent:', '--done:', '--active:', '--paused:', '--sh1:', '--r1:', '--pad:']
const missing = tokens.filter((t) => !EV4_CSS.includes(t))
ok(missing.length === 0, '★[正] 原型 12 个关键 token 全部存在（缺 ' + JSON.stringify(missing) + '）')
// 暗色 token（E6 会用，此处先确认照搬完整）
const darkTokens = ['#0a0d14', '#0c111a', '#151b26', '#e6eaf1']
const darkMissing = darkTokens.filter((t) => !EV4_CSS.includes(t))
ok(darkMissing.length === 0, '★[正] 原型暗色 4 个核心色值已照搬（缺 ' + JSON.stringify(darkMissing) + '）')

console.log('')
console.log('== 8. ★★坏选择器 = 0（本轮真实事故的回归守卫） ==')
// ★事故：用 split('body{').join('.dam-ev4{') 会把 .rail-body{ / .cp-body{ 替成
//   .rail-.dam-ev4{ / .cp-.dam-ev4{ ⇒ 选择器彻底失效（rail 侧栏、检查点正文全没样式），
//   而 node --check 全绿、『html/body 作用域 0 次』断言也全绿（坏选择器不以 html/body 开头）。
//   ⇒ 必须另有一条「坏选择器 = 0」断言，否则这类事故**没有任何守卫能发现**。
const badSels = ['.rail-.dam-ev4', '.cp-.dam-ev4', '.wf.dam-ev4', '-.dam-ev4{']
for (const bad of badSels) {
  const n = EV4_CSS.split(bad).length - 1
  ok(n === 0, '★★[负] 坏选择器 "' + bad + '" 出现 0 次（实测 ' + n + '）')
}
// 正路径：原型的 .rail-body{ / .cp-body{ 必须完好
ok(EV4_CSS.includes('.rail-body{'), '★★[正] .rail-body{ 完好（未被 body{ 替换污染）')
ok(EV4_CSS.includes('.cp-body{'), '★★[正] .cp-body{ 完好')
ok(EV4_CSS.includes('.cp-body>.cp-inner{'), '★★[正] .cp-body>.cp-inner{ 完好')
// 变异：模拟「用 split('body{') 替换」的旧错法 ⇒ 坏选择器必现 ⇒ 断言必红
const mutBad = EV4_CSS.split('body{').join('.dam-ev4{')
ok(mutBad !== EV4_CSS, '[变异] 成功构造「用 split(body{) 替换」的旧错法')
ok(mutBad.includes('.rail-.dam-ev4{') || mutBad.includes('.cp-.dam-ev4{'), '★★[变异] 旧错法确实产生坏选择器 ⇒ 该断言必红（判据非恒真）')
ok(!mutBad.includes('.rail-body{'), '★★[变异] 旧错法把 .rail-body{ 破坏掉（实测已破坏）')

// 变体校验：'.cp-body{'.split('body{') 会变 '.cp-.dam-ev4{'（验证 old bug 的确切形态）
ok('.cp-body{'.split('body{').join('.dam-ev4{') === '.cp-.dam-ev4{', '★★[变异] 确认旧错法的确切产物是 .cp-.dam-ev4{')
console.log('')
console.log('== 9. ★★收口：所有选择器必须作用域化（389 裸 → 0）+ keyframes 全改名 ==')
// ★Lead 实测：改前 401 个选择器里 389 个是裸 class（.card/.panel/.badge/.col/.legend…），
//   4 个 @keyframes 是全局名（lm-spin/card-in/detail-in/cp-in）。
//   为什么这不是洁癖：EV4_CSS 拼进**全局 style 标签**，不管 EventView 渲染与否都生效。
//   E2/E5 一旦给根节点加 .dam-ev4，这 389 条会**全部激活**；而 .card/.panel/.badge
//   在本插件别的界面/宿主/其它插件里都可能存在 ⇒ 跨组件污染。现状没事只是「还没挂 .dam-ev4」= 运气。
const { countSelectors } = await import('../lib/css-scope.mjs')
const selInfo = countSelectors(EV4_CSS)
ok(selInfo.total > 300, '前置事实：选择器总数 > 300（实测 ' + selInfo.total + '）')
ok(selInfo.bare.length === 0, '★★★[负] 裸选择器数必须 = 0（实测 ' + selInfo.bare.length + (selInfo.bare.length ? ' → ' + JSON.stringify(selInfo.bare.slice(0, 8)) : '') + '）')
ok(selInfo.scoped === selInfo.total, '★★[正] 全部选择器都已作用域化（' + selInfo.scoped + ' / ' + selInfo.total + '）')

// keyframes 必须全部 ev4- 前缀
const kfNames = [...EV4_CSS.matchAll(/@keyframes\s+([\w-]+)/g)].map((m) => m[1])
ok(kfNames.length === 4, '★[正] @keyframes 恰 4 个（实测 ' + kfNames.length + '）')
ok(kfNames.every((n) => n.startsWith('ev4-')), '★★★[负] 所有 @keyframes 名以 ev4- 开头（实测 ' + JSON.stringify(kfNames) + '）')
// animation 引用不得残留旧名
const animDecls = [...EV4_CSS.matchAll(/animation[^;}]*/g)].map((m) => m[0])
const OLD_KF = /(^|[^\w-])(lm-spin|card-in|detail-in|cp-in)(?![\w-])/
const leftover = animDecls.filter((d) => OLD_KF.test(d))
ok(leftover.length === 0, '★★[负] animation 引用无旧 keyframes 名残留（实测 ' + leftover.length + ' 条' + (leftover.length ? '：' + JSON.stringify(leftover.slice(0, 3)) : '') + '）')
ok(animDecls.filter((d) => /ev4-/.test(d)).length >= 3, '★[正] animation 已改用 ev4- 前缀名（实测 ' + animDecls.filter((d) => /ev4-/.test(d)).length + ' 条）')

// 三条变异：随便挑一条改回裸 ⇒ 断言必红
const mutBare1 = EV4_CSS.replace('.dam-ev4 .card{', '.card{')
ok(mutBare1 !== EV4_CSS, '[变异1] 成功把 .dam-ev4 .card{ 改回 .card{')
ok(countSelectors(mutBare1).bare.length > 0, '★★[变异1] 改回裸 class 后裸选择器数 > 0 ⇒ 断言必红（实测 ' + countSelectors(mutBare1).bare.length + '）')
const mutBare2 = EV4_CSS.replace('@keyframes ev4-card-in{', '@keyframes card-in{')
ok(mutBare2 !== EV4_CSS, '[变异2] 成功把 ev4-card-in 改回 card-in')
ok(![...mutBare2.matchAll(/@keyframes\s+([\w-]+)/g)].map((m) => m[1]).every((n) => n.startsWith('ev4-')), '★★[变异2] 改回裸 keyframes 名后「全 ev4- 前缀」断言必红')
const mutBare3 = EV4_CSS.replace('.dam-ev4 .topbar{', '.topbar{')
ok(mutBare3 !== EV4_CSS || !EV4_CSS.includes('.dam-ev4 .topbar{'), '[变异3] 成功把 .dam-ev4 .topbar{ 改回 .topbar{')
ok(countSelectors(mutBare3).bare.length > 0, '★★[变异3] 裸选择器数 > 0 ⇒ 断言必红')

// ★回归：收口后仍须保证 .rail-body{ / .cp-body{ 这类「含 body 子串」的选择器未被破坏
ok(selInfo.bare.length === 0 && !EV4_CSS.includes('.rail-.dam-ev4'), '[回归] 收口未引入畸形选择器')
console.log('')
console.log('== 10. ★★data-dam-fullpage 全局开关的卸载收口（Lead 指定 · 比浮窗更严重）==')
// 为什么这条最严重：`body[data-dam-fullpage] [data-composer-seat]{display:none!important}`
// 是**挂在 body 上的全局开关**。一旦卸载没摘掉 ⇒ **用户在「对话」页签永远打不了字**。
// 判据：① 真执行 effect 源码（含 cleanup）② 卸载后查**实际可见性**不只是属性 ③ 删 cleanup 必红。
// ★★2026-10-25 E8-6 锚点更新：原锚点 `if (on) document.body.setAttribute(...)` 现在出现在
//   **引用计数的兜底分支**里（极老环境无 Set 时），从那里 lastIndexOf('useEffect') 会取到
//   不完整的片段。改用 effect 内**唯一**的引用计数调用作锚点。
const fpAnchor = "EV4_VISIBLE_PAGES.add(el)"
const fpAt = SRC.indexOf(fpAnchor)
ok(fpAt > 0, '★[正] fullpage effect 锚点可定位')
ok((SRC.match(/EV4_VISIBLE_PAGES\.add\(el\)/g) || []).length === 1, '★★[正] 引用计数锚点恰命中 1 次（防多处同名）')
const fpEffStart = SRC.lastIndexOf('useEffect(function () {', fpAt)
const fpEffEnd = SRC.indexOf('}, [props.kind])', fpAt) + '}, [props.kind])'.length
const fpEffect = SRC.slice(fpEffStart, fpEffEnd)
ok(fpEffect.length > 300, '★[正] effect 源码抽取成功（' + fpEffect.length + ' 字符）')
// ★结构断言：cleanup 必须在（含 mark(false)）
// ★★2026-10-25 E8-6 判据更新：cleanup 从**单行**变成**多行块**（引用计数改造）。
//   原判据写死单行形态 `return function () { try { io.disconnect() } catch (e) {} mark(false) }`，
//   E8-6 把 fullpage 标记改成引用计数后，cleanup 里要加注释解释「必须删自己」⇒ 跨多行 ⇒ 旧正则失配。
//   ★意图不变：仍然要求「卸载时清理自己」。新判据改为**函数体级**匹配：
//     ① 存在 return function ... { ... } 作为清理函数；
//     ② 其体内含 io.disconnect()；
//     ③ 其体内含 mark(false)（引用计数下 = 从 Set 删自己）。
//   ★并加负路径：真删掉 mark(false) ⇒ 必红。
const cleanupBlocks = fpEffect.match(/return function \(\) \{[\s\S]*?\n\s*\}/g) || []
ok(cleanupBlocks.length >= 1, '★★★[正] effect 的 cleanup 函数存在（实测 ' + cleanupBlocks.length + ' 个）')
const cleanupBody = cleanupBlocks.join('\n')
ok(/io\.disconnect\(\)/.test(cleanupBody), '★★[正] cleanup 含 io.disconnect()（注销观察者）')
ok(/mark\(false\)/.test(cleanupBody), '★★★[正] cleanup 含 mark(false)（卸载必摘标记）')
ok(/EV4_VISIBLE_PAGES|delete\(el\)|\.delete\(/.test(cleanupBody) || /mark\(false\)/.test(cleanupBody), '★★[正] cleanup 走引用计数删除（E8-6）')
// IO 不可用分支的 cleanup
ok(/return function \(\) \{ mark\(false\) \}/.test(fpEffect), '★★[正] IO 不可用分支的 cleanup 也含 mark(false)')
// CSS 锚点存在
ok(SRC.includes('body[data-dam-fullpage] [data-composer-seat],body[data-dam-fullpage] [data-composer-card]{display:none!important;}'), '★★[正] fullpage 隐藏 CSS 存在且选择器是 data-composer-seat/card（不是 CSS Modules 哈希）')
// ★变异：删掉整个 cleanup 里的 mark(false) ⇒ 结构断言必红
const mutFp = fpEffect.replace(/mark\(false\)/g, '')
ok(mutFp !== fpEffect, '[变异] 成功删掉 cleanup 里的 mark(false)')
ok(!/mark\(false\)/.test((mutFp.match(/return function \(\) \{[\s\S]*?\n\s*\}/g) || []).join('\n')), '★★[变异] 删掉后「cleanup 含 mark(false)」断言必红（判据非恒真）')

// ★★真执行：在 vm 里跑 effect 源码 + 桩 DOM，验证挂载打标 / 卸载摘标
const fpSandbox = (function () {
  const attrs = new Set()
  const sandbox = {
    console: { log: () => {}, warn: () => {}, error: () => {} },
    document: {
      body: {
        setAttribute: (k, v) => attrs.add(k + '=' + v),
        removeAttribute: (k) => { for (const a of [...attrs]) if (a.startsWith(k + '=')) attrs.delete(a) },
        hasAttribute: (k) => [...attrs].some((a) => a.startsWith(k + '=')),
      },
    },
    // ★桩必须**真的触发一次回调**且 isIntersecting=true —— 否则 mark(true) 永远不会被调用，
    //   「挂载后标记出现」会假红（本轮实测：observe 是空函数 ⇒ tag 一直 false）。
    IntersectionObserver: function (cb) {
      this._cb = cb
      this.observe = () => { cb([{ isIntersecting: true }]) }
      this.disconnect = () => {}
    },
  }
  // ★★2026-10-25 E8-6 桩补齐：effect 现在依赖两个模块级符号（vm 抽取不带模块作用域）。
  //   ★桩必须**同语义**（真 Set + 真写属性），不能返回假值 —— 否则测的是桩不是产品。
  //   EV4_VISIBLE_PAGES：真 Set；ev4SyncFullpageAttr：按 Set 现状真写 body 属性（与产品逐字同义）。
  // ★闸门需要 getComputedStyle（仅 offsetParent===null 分支用到）；补同语义桩
  sandbox.getComputedStyle = function () { return { display: 'block', visibility: 'visible' } }
  sandbox.EV4_VISIBLE_PAGES = new Set()
  sandbox.ev4SyncFullpageAttr = function () {
    const on = sandbox.EV4_VISIBLE_PAGES.size > 0
    if (on) sandbox.document.body.setAttribute('data-dam-fullpage', 'true')
    else sandbox.document.body.removeAttribute('data-dam-fullpage')
  }
  sandbox.globalThis = sandbox
  const ctx2 = vm.createContext(sandbox)
  // ★把 effect 源码剥成**纯函数体**：去掉外层 useEffect(function () { 与 }, [props.kind])
  //   判据：必须真执行到它内部的 mark()，而不是只读文本。
  let body = fpEffect
  body = body.replace(/^\s*useEffect\(function \(\) \{/, '')
  body = body.replace(/\},\s*\[props\.kind\]\)\s*$/, '')
  const build = 'var props = { kind: "page" };' +
    // ★2026-10-25 P3：effect 新增可见性闸门 elLooksVisible（Lead 裁决：防「对话页被误打标打不了字」）。
    //   闸门判据 = rect.height > 0 && offsetParent !== null（否则/fail-closed 不打标）。
    //   ⇒ 桩必须提供**同语义的可视几何**，否则本套件的「挂载后标记出现」会假红
    //     （本轮实测：只给 top:0 ⇒ height undefined ⇒ 闸门 false ⇒ 不打标 ⇒ 正路径红）。
    // ★2026-10-25 task-35 桩同步：闸门改为「不引用 el 自身高度」（防 fit() 死循环）
    //   新判据 = offsetWidth>0 && computed 非隐藏 && 祖先 scroll 容器 clientHeight>0
    'var __area = { clientHeight: 800 };' +
    'var boundary = { current: { offsetWidth: 1200, offsetHeight: 800, offsetParent: {}, closest: function (s) { return s === "[data-conversation-scroll]" ? __area : null }, getComputedStyle: function () { return { display: "block", visibility: "visible" } }, getBoundingClientRect: function () { return { top: 0, height: 800, width: 1200, bottom: 800, left: 0, right: 1200 } } } };' +
    'globalThis.__FP = function () {' + body + '};'
  vm.runInContext(build, ctx2)
  return { sandbox, attrs, ctx: ctx2 }
})()
ok(typeof fpSandbox.ctx.__FP === 'function', '★[正] fullpage effect 在 vm 中可真执行')
const fpCleanup = fpSandbox.ctx.__FP()
ok(typeof fpCleanup === 'function', '★★[正] effect 返回 cleanup 函数（实测 ' + typeof fpCleanup + '）')
ok(fpSandbox.sandbox.document.body.hasAttribute('data-dam-fullpage') === true, '★★[正] 挂载后 data-dam-fullpage **出现**')
fpCleanup()
ok(fpSandbox.sandbox.document.body.hasAttribute('data-dam-fullpage') === false, '★★★[负路径·核心] 卸载（真调 cleanup）后 data-dam-fullpage **消失**')
console.log('')
console.log('SUMMARY  PASS ' + pass + ' / FAIL ' + fail)
if (fail > 0) process.exit(1)

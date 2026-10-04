/**
 * 多语言功能验收（真执行，非源码字符串断言）
 *
 * 做法：从 lib/client.js 的明确国际化区间**抽取真实定义**（零外部依赖）
 *   - `function L(a, b)`
 *   - `function L3(a, b, ja)`
 *   - `var L10N = {...}`（第三语言查表）
 *   - `var I18N = {...}`（字典）
 *   - `function normLocale(v)`
 * 在 vm 里组装成可执行上下文，再**真调用**并断言返回值。
 *
 * 负路径：把字典删空 ⇒ ja 必须回落英文；未知语言 ⇒ 回落英文；zh ⇒ 恒取中文。
 */
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import { fileURLToPath } from 'node:url'
const damPath = (rel) => fileURLToPath(new URL('../../' + rel, import.meta.url))

const SRC = readFileSync(damPath('lib/client.js'), 'utf8')

let pass = 0, fail = 0
const fails = []
const ok = (c, m) => { if (c) pass++; else { fail++; fails.push(m) } }

// Execute the real contiguous localization declarations, including I18N.ja assignments.
// Explicit unique boundaries fail on source drift; no parser package or copied dictionary.
const startMarker = '    var I18N = {'
const endMarker = "    var localeMode = 'system'"
const start = SRC.indexOf(startMarker), end = SRC.indexOf(endMarker)
if (start < 0 || end <= start || SRC.indexOf(startMarker, start + 1) >= 0 || SRC.indexOf(endMarker, end + 1) >= 0) throw Error('Localization source boundaries changed')
const declarations = SRC.slice(start, end)
for (const name of ['L', 'L3', 'normLocale']) {
  const count = (declarations.match(new RegExp('function ' + name + '\\(', 'g')) || []).length
  ok(count === 1, 'Exactly one real localization function: ' + name)
}
for (const name of ['I18N', 'L10N', 'LOCALE_ALL']) {
  const count = (declarations.match(new RegExp('var ' + name + ' =', 'g')) || []).length
  ok(count === 1, 'Exactly one real localization dictionary: ' + name)
}
const code = declarations + '\n' +
  'globalThis.__T = { L, L3, normLocale, L10N, I18N, setLoc: function(v){ locale = v } }'

const sb = { console }
sb.globalThis = sb
let T = null
try {
  vm.runInContext(code, vm.createContext(sb), { filename: 'client.js#i18n' })
  T = sb.__T
  ok(true, '★抽取片段在 vm 中真执行成功（无 ReferenceError / SyntaxError）')
} catch (e) {
  ok(false, '抽取片段真执行失败: ' + e.message)
}

if (T) {
  // ① zh ⇒ 恒取中文
  T.setLoc('zh')
  ok(T.L('记忆', 'Memory') === '记忆', "L zh ⇒ 中文（'记忆'）")

  // ② en ⇒ 取英文
  T.setLoc('en')
  ok(T.L('记忆', 'Memory') === 'Memory', "L en ⇒ 英文（'Memory'）")

  // ③ ja：字典命中的键 ⇒ 日文，且**不等于**中文
  T.setLoc('ja')
  const jaKeys = Object.keys(T.L10N.ja || {})
  ok(jaKeys.length > 300, `L10N.ja 条目数 ${jaKeys.length} > 300`)
  const sample = jaKeys.find((k) => (T.I18N.ja || {})[k] === undefined) || jaKeys[0]
  const got = T.L(sample, 'EN-FALLBACK')
  ok(got !== 'EN-FALLBACK', `L ja 命中字典 ⇒ 非英文回落（key=${JSON.stringify(sample).slice(0, 30)} ⇒ ${JSON.stringify(got).slice(0, 30)}）`)
  ok(got !== sample || T.L10N.ja[sample] === sample, `L ja 值来自 L10N.ja（key=${JSON.stringify(sample).slice(0, 30)}）`)

  // ④ 负路径：字典里没有的键 ⇒ 回落英文
  const missing = '__NOPE__' + Date.now()
  ok(T.L(missing, 'FALLBACK') === 'FALLBACK', 'L ja 未命中 ⇒ 回落英文（负路径）')

  // ⑤ 负路径：把字典掏空 ⇒ 全部回落英文
  const backup = T.L10N.ja
  T.L10N.ja = {}
  ok(T.L('记忆', 'Memory') === 'Memory', 'L ja 空字典 ⇒ 回落英文（负路径）')
  T.L10N.ja = backup

  // ⑥ 未知语言 ⇒ 回落英文
  T.setLoc('fr')
  ok(T.L('记忆', 'Memory') === 'Memory', 'L 未知语言 fr ⇒ 回落英文（负路径）')
  ok(T.normLocale('fr') === '', "normLocale('fr') ⇒ ''（未知语言，负路径）")

  // ⑦ normLocale 归一化真实取值
  ok(T.normLocale('ja-JP') === 'ja', "normLocale('ja-JP') ⇒ 'ja'")
  ok(T.normLocale('ja_JP') === 'ja', "normLocale('ja_JP') ⇒ 'ja'")
  ok(T.normLocale('zh-CN') === 'zh', "normLocale('zh-CN') ⇒ 'zh'")
  ok(T.normLocale('en-US') === 'en', "normLocale('en-US') ⇒ 'en'")
  ok(T.normLocale('') === '', "normLocale('') ⇒ ''")
  ok(T.normLocale(null) === '', 'normLocale(null) ⇒ \'\'（不崩）')

  // ⑧ L3 逃生舱
  T.setLoc('ja')
  ok(T.L3('甲', 'Yi', 'コウ') === 'コウ', 'L3 ja ⇒ 第三参')
  T.setLoc('zh')
  ok(T.L3('甲', 'Yi', 'コウ') === '甲', 'L3 zh ⇒ 第一参')
  T.setLoc('en')
  ok(T.L3('甲', 'Yi', 'コウ') === 'Yi', 'L3 en ⇒ 第二参')

  // ⑧b ★2026-10-03（G1-2）：ja 函数键**必须是真函数字面量**（真执行取值 + typeof 断言）。
  //   历史缺陷：PR #143 把日文字典以 JSON 序列化带入，7 个函数键降级成 { __fn:true, src:'function…' } 占位对象，
  //   19 个裸调点（t('hubScopeCounts')(…) 等）在 ja 档取到对象再调用 ⇒ TypeError ⇒ 无错误边界的真 React
  //   整根白屏。修法 = 还原函数字面量 + t() 的 __fn 兜底；本块锁住「还原」这一半（兜底另见 lib/client.js:2460）。
  const jaFnKeys = ['hubEvLine', 'hubScopeCounts', 'hubScopeReasons', 'hubWhyCorrectionRate', 'hubWhyDiversity', 'hubWhyHasCorrection', 'hubWhySuccess']
  for (const key of jaFnKeys) {
    const v = (T.I18N.ja || {})[key]
    ok(typeof v === 'function', 'I18N.ja[' + key + '] typeof === function（真执行取值；实际 ' + typeof v + '）')
    ok(!(v && v.__fn), 'I18N.ja[' + key + '] 不是 __fn 占位对象（' + key + '）')
  }
  // 真调用：占位对象形态会在此抛 TypeError —— 这正是用户侧的故障形态，负路径由上面两条覆盖。
  try {
    ok(T.I18N.ja.hubScopeCounts(3, 4).indexOf('3 件') >= 0, '真调用 I18N.ja.hubScopeCounts(3,4) 返回可读文案')
    ok(typeof T.I18N.ja.hubScopeReasons('not-found') === 'string', '真调用 I18N.ja.hubScopeReasons(\'not-found\') 返回字符串')
  } catch (eFn) {
    ok(false, '真调用 ja 函数键抛异常（占位对象回归）: ' + eFn.message)
  }

  // ⑨ 字典规模（真计数）
  const zhN = Object.keys(T.I18N.zh || {}).length
  const enN = Object.keys(T.I18N.en || {}).length
  const jaN = Object.keys(T.I18N.ja || {}).length
  console.log(`  I18N.zh=${zhN} I18N.en=${enN} I18N.ja=${jaN} L10N.ja=${jaKeys.length}`)
  ok(jaN > 500, `I18N.ja 键数 ${jaN} > 500`)
  ok(enN >= zhN - 5, `I18N.en(${enN}) 不显著少于 zh(${zhN})`)
}

console.log(fails.map((f) => '  FAIL: ' + f).join('\n'))
console.log(`\n[i18n-really] PASS ${pass} / FAIL ${fail}`)
process.exit(fail ? 1 : 0)

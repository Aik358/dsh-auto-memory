#!/usr/bin/env node
/**
 * [#281 / P1] 孤立代理：三个截断函数必须产出**合法的 UTF-16 字符串**。
 *
 * 事故（会话级不可自救）：
 *   lib/index.js 的 truncateHead / truncateLinesBounded / truncateTail 全按 UTF-16 **code unit**
 *   切串。astral 字符（emoji 等）在 UTF-16 里是**一对** code unit；切点落在两者之间就切出
 *   **孤立代理**。孤立代理随注入快照进入 prompt ⇒ API 400 INVALID_REQUEST ⇒
 *   该会话**每轮都失败、重试无效**（注入每轮发生，新开会话同样复发）。
 *
 * 本套件的立场：**真取产线函数执行**（抽取定义 + new Function），不是源码文本断言。
 *   —— 三处定义必须**自包含**：本仓另有守卫（handoff / switch-decouple）也抽取它们单独执行，
 *      片段里若引用模块级 helper，会在那些守卫侧 ReferenceError（本轮实测已踩到）。
 *      A0b 顺带把「抽取后能独立**调用**」做成断言，守这条反重构约束。
 *
 * 覆盖：
 *   A 真实病例：truncateHead('abc📖def', 4) 合法且不含孤立代理（旧实现此处必红 —— A2 对照）
 *   B 尾部：truncateTail 首字符不得是孤立低位代理（B0 对照证明旧实现确有此病）
 *   C 非边界情形**逐字节不变**（含 astral 但切点不在对中间时同样必须全等）
 *   D 扫描：多 astral 样本 × 多个 n ⇒ 三者结果全部合法（D2 用旧实现证明本断言有鉴别力）
 *   E 边界语义：n<=0 / 越界 / 空 / null 与旧实现全等（**按设计必须变的对中间切点已显式排除**）
 *   F 端到端：sanitizeForInjection 真实链路（真 scrubJunkLines + neutralize + truncateHead）
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, '..', '..')
const SRC = readFileSync(path.join(ROOT, 'lib', 'index.js'), 'utf8')

let pass = 0, fail = 0
const ok = (c, m) => { if (c) { pass++; console.log('  ok   - ' + m) } else { fail++; console.log('  FAIL - ' + m) } }

/* ── 抽取产线定义（逐行扫描 + (){}[] 配平；与 handoff/switch-decouple 同款口径） ── */
function grab(name) {
  const lines = SRC.split('\n')
  const li = lines.findIndex((l) => {
    const t = l.trim()
    return t.startsWith('const ' + name + ' ') || t.startsWith('const ' + name + '=')
  })
  if (li < 0) throw new Error('helper not found: ' + name)
  let buf = '', depth = 0, started = false
  for (let n = li; n < lines.length; n++) {
    buf += lines[n] + '\n'
    for (const ch of lines[n]) {
      if (ch === '{' || ch === '(' || ch === '[') { depth++; started = true }
      else if (ch === '}' || ch === ')' || ch === ']') depth--
    }
    if (depth <= 0 && (started || /;[ \t]*$/.test(lines[n]))) break
  }
  return buf
}
const lift = (name) => new Function(grab(name) + '\nreturn ' + name + ';')()
/** 按 function NAME(...) { 头的花括号配平抽取（用于非 const 定义）。 */
function grabFn(mark) {
  const i0 = SRC.indexOf(mark)
  if (i0 < 0) throw new Error('not found: ' + mark)
  let depth = 0
  for (let i = i0 + mark.length - 1; i < SRC.length; i++) {
    if (SRC[i] === '{') depth++
    else if (SRC[i] === '}') { depth--; if (depth === 0) return SRC.slice(i0, i + 1) }
  }
  throw new Error('unbalanced: ' + mark)
}

/* ── 判据本体：合法 UTF-16 = 无未配对代理 ── */
function isWellFormedString(s) {
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i)
    if (c >= 0xd800 && c <= 0xdbff) {
      const d = i + 1 < s.length ? s.charCodeAt(i + 1) : 0
      if (!(d >= 0xdc00 && d <= 0xdfff)) return false
      i++
    } else if (c >= 0xdc00 && c <= 0xdfff) return false
  }
  return true
}
/** 切点是否**恰好落在代理对中间**（这些 n 属「必须改动」的情形，不与旧实现比对）。 */
const splitsPairHead = (s, n) => typeof s === 'string' && n > 0 && n < s.length
  && s.charCodeAt(n - 1) >= 0xd800 && s.charCodeAt(n - 1) <= 0xdbff
  && s.charCodeAt(n) >= 0xdc00 && s.charCodeAt(n) <= 0xdfff
const splitsPairTail = (s, n) => {
  if (typeof s !== 'string' || !(n > 0) || s.length - n <= 0) return false
  const i = s.length - n
  return s.charCodeAt(i) >= 0xdc00 && s.charCodeAt(i) <= 0xdfff
    && s.charCodeAt(i - 1) >= 0xd800 && s.charCodeAt(i - 1) <= 0xdbff
}

/* ── 旧实现复刻（只用 slice，即改动前形态）作为对照 ── */
const HEAD_MARK = '\n…(截断,完整内容用 memory_recall 或 GUI 面板)'
const LINES_MARK = '\n…(截断,全文见 handoff/ 白板与账本)'
const oldHead = (s, n) => (s && s.length > n) ? s.slice(0, n) + HEAD_MARK : (s || '')
const oldLines = (s, n) => {
  if (!s || s.length <= n) return s || ''
  const cut = s.slice(0, n)
  const nl = cut.lastIndexOf('\n')
  return (nl > Math.floor(n * 0.5) ? cut.slice(0, nl) : cut) + LINES_MARK
}
const oldTail = (s, n) => (s && s.length > n) ? '…(截断,完整内容用 memory_recall 或 GUI 面板)\n' + s.slice(-n) : (s || '')

console.log('[issue281] A0 抽取产线定义（真执行，非文本断言）')
let truncateHead, truncateLinesBounded, truncateTail
{
  let liftErr = null
  try {
    truncateHead = lift('truncateHead')
    truncateLinesBounded = lift('truncateLinesBounded')
    truncateTail = lift('truncateTail')
  } catch (e) { liftErr = e }
  ok(!liftErr && typeof truncateHead === 'function' && typeof truncateLinesBounded === 'function' && typeof truncateTail === 'function',
    'A0a 三个截断函数抽取成功且为函数' + (liftErr ? ': ' + liftErr.message : ''))
  let callErr = null
  try { truncateHead('abc\u{1F4D6}def', 4); truncateLinesBounded('a\nb', 2); truncateTail('abc\u{1F4D6}def', 4) }
  catch (e) { callErr = e }
  ok(!callErr, 'A0b ★三处**自包含**：单独抽取后可直接调用（无模块级 free variable）' + (callErr ? ': ' + callErr.message : ''))
  const nativeOk = typeof ''.isWellFormed === 'function'
  const samples = ['abc', 'abc\u{1F4D6}def', 'abc\ud83d', '\udc00x', '\u{1F600}\u{1F601}', '中文😀文']
  ok(!nativeOk || samples.every((x) => isWellFormedString(x) === x.isWellFormed()),
    'A0c 自带判据与原生 isWellFormed 口径一致（' + (nativeOk ? '原生可用，已比对 6 样本' : '原生不可用，跳过') + '）')
}

console.log('[issue281] A 真实病例（Lead 亲跑复现的那一条）')
{
  const src = 'abc\u{1F4D6}def'
  ok(src.length === 8, 'A1 样本确为 8 个 code unit（实得 ' + src.length + '）')
  ok(!isWellFormedString(oldHead(src, 4)), 'A2 ★对照：旧实现 slice(0,4) 产出**非法**串（缺陷真实存在）')
  const out = truncateHead(src, 4)
  const body = out.slice(0, out.indexOf(HEAD_MARK))
  ok(isWellFormedString(out), 'A3 ★truncateHead(src,4) 产出合法 UTF-16')
  const last = body.length ? body.charCodeAt(body.length - 1) : 0
  ok(!(last >= 0xd800 && last <= 0xdbff), 'A4 ★正文末位不是孤立高代理（末位=0x' + last.toString(16) + '）')
  ok(body === 'abc', 'A5 安全切点左移 1 位 ⇒ 正文退为完整前缀 abc（不塞半个字符）')
}

console.log('[issue281] B 尾部截断的起点侧')
{
  const src = 'abc\u{1F4D6}def'
  const out = truncateTail(src, 4)
  const body = out.replace('…(截断,完整内容用 memory_recall 或 GUI 面板)\n', '')
  ok(!isWellFormedString(oldTail(src, 4)), 'B0 ★对照：旧实现 slice(-4) 以**孤立低代理**开头')
  ok(isWellFormedString(out), 'B1 ★truncateTail(src,4) 产出合法 UTF-16')
  const first = body.charCodeAt(0)
  ok(!(first >= 0xdc00 && first <= 0xdfff), 'B2 ★首字符不是孤立低位代理（首位=0x' + first.toString(16) + '）')
  // ★语义：起点右移到**对之后**（而非退回对之前）—— 尾部函数的预算是硬上限，退回去会让结果
  //   变成 n+1 个 code unit 而超预算；右移得 n-1，与 truncateHead 左移得 n-1 同口径。
  ok(body === 'def' && body.length <= 4, 'B3 右移 1 位 ⇒ 丢掉那半个字符对，结果 "def"（' + body.length + ' ≤ n=4，不超预算）')
  // 位置对照：起点落在对中间时（i=4, s[4]=DCD6）⇒ 右移；落在对首（i=3, s[3]=D83D）⇒ 原样
  ok(truncateTail('abc\u{1F4D6}def', 5) === oldTail('abc\u{1F4D6}def', 5), 'B4 起点恰在对首时逐字节不变（不必挪动）')
}

console.log('[issue281] C 非边界情形**逐字节不变**（不许顺手改既有输出）')
{
  const plain = ['', 'x', 'hello world', '中文标点，句号。换行\n第二行',
    'a\nb\nc\nd\ne\nf\ng\nh\ni\nj\nk\nl\nm\nn\no\np', ' '.repeat(50) + 'tail',
    'mixed 中英 text with \r\n CRLF and \u00e9 accents']
  let cmp = 0, same = 0
  for (const s of plain) for (const n of [0, 1, 2, 3, 5, 8, 13, 21, 34, 55, 89, 144, 233]) {
    cmp += 3
    if (truncateHead(s, n) === oldHead(s, n)) same++
    if (truncateLinesBounded(s, n) === oldLines(s, n)) same++
    if (truncateTail(s, n) === oldTail(s, n)) same++
  }
  ok(same === cmp, 'C1 ★纯 BMP 样本 × 13 个 n：三者输出与旧实现逐字节全等（' + same + '/' + cmp + '）')

  const withAstral = ['😀abc', 'abc😀', 'a😀b😀c', '中😀文😀字', '😀😀😀', 'x'.repeat(20) + '😀' + 'y'.repeat(20)]
  let cmp2 = 0, same2 = 0
  for (const s of withAstral) for (let n = 0; n <= s.length + 2; n++) {
    if (!splitsPairHead(s, n)) { cmp2 += 2; if (truncateHead(s, n) === oldHead(s, n)) same2++; if (truncateLinesBounded(s, n) === oldLines(s, n)) same2++ }
    if (!splitsPairTail(s, n)) { cmp2 += 1; if (truncateTail(s, n) === oldTail(s, n)) same2++ }
  }
  ok(cmp2 > 0 && same2 === cmp2, 'C2 ★含 astral 但切点不在对中间 ⇒ 仍逐字节全等（' + same2 + '/' + cmp2 + '）')
}

console.log('[issue281] D 多样本 × 多 n 全扫描：结果一律合法')
{
  const samples = ['abc\u{1F4D6}def', '😀😀😀😀😀', '中文😀混排 test ' + '🙂'.repeat(5),
    '🧑‍🚀👨‍👩‍👧‍👦tail', 'a\u{10FFFF}b', '🏳️‍🌈flag']
  let scanned = 0, bad = []
  for (const s of samples) for (let n = 0; n <= s.length + 3; n++) {
    scanned += 3
    if (!isWellFormedString(truncateHead(s, n))) bad.push('head n=' + n + ' ' + JSON.stringify(s))
    if (!isWellFormedString(truncateLinesBounded(s, n))) bad.push('lines n=' + n + ' ' + JSON.stringify(s))
    if (!isWellFormedString(truncateTail(s, n))) bad.push('tail n=' + n + ' ' + JSON.stringify(s))
  }
  ok(bad.length === 0, 'D1 ★扫描 ' + scanned + ' 组（样本×n×3 函数）全部合法' + (bad.length ? '；反例: ' + bad.slice(0, 3).join(' | ') : ''))
  let oldBad = 0
  for (const s of samples) for (let n = 0; n <= s.length + 3; n++) {
    if (!isWellFormedString(oldHead(s, n))) oldBad++
    if (!isWellFormedString(oldLines(s, n))) oldBad++
    if (!isWellFormedString(oldTail(s, n))) oldBad++
  }
  ok(oldBad > 0, 'D2 ★对照：同扫描下**旧实现产出非法串 ' + oldBad + ' 组**（证明 D1 不是恒真）')
}

console.log('[issue281] E 边界语义与旧实现一致（n<=0 / 越界 / 空 / null）')
{
  const cases = [['abc', 0], ['abc', -1], ['abc', -5], ['abc', 3], ['abc', 4], ['abc', 99],
    ['', 0], ['', 5], [null, 5], [undefined, 5], ['😀', 0], ['😀', 1], ['😀', 2], ['😀', 3]]
  let bad = [], checked = 0
  for (const [s, n] of cases) {
    // ★按设计允许差异的只有「切点恰落在代理对中间」—— 其余必须全等（E1 的鉴别力所在）
    if (!splitsPairHead(s, n)) { checked += 2
      if (truncateHead(s, n) !== oldHead(s, n)) bad.push('head(' + JSON.stringify(s) + ',' + n + ')')
      if (truncateLinesBounded(s, n) !== oldLines(s, n)) bad.push('lines(' + JSON.stringify(s) + ',' + n + ')') }
    if (!splitsPairTail(s, n)) { checked++
      if (truncateTail(s, n) !== oldTail(s, n)) bad.push('tail(' + JSON.stringify(s) + ',' + n + ')') }
  }
  ok(bad.length === 0, 'E1 ★边界情形与旧实现全等（' + checked + ' 组；已排除按设计必须改动的对中间切点）' + (bad.length ? '；差异: ' + bad.join(', ') : ''))
  ok(truncateHead(null, 5) === '' && truncateTail(undefined, 5) === '' && truncateLinesBounded(null, 5) === '',
    'E2 null/undefined 仍返回空串（未引入新语义）')
  ok(truncateHead('abc', 0) === oldHead('abc', 0) && truncateHead('abc', -1) === oldHead('abc', -1) && truncateTail('abc', -1) === oldTail('abc', -1),
    'E3 n<=0 与旧实现逐字节相同（含 slice(-0)/负数下标语义）')
}

console.log('[issue281] F 端到端：sanitizeForInjection 真实链路')
{
  const MARKS = {
    moji: 'var MOJIBAKE_RE = ',
    mojibake: 'function mojibakeDensity(text) {',
    detect: 'function detectStutter(text) {',
    has: 'function hasStutter(text) {',
    scrub: 'function scrubJunkLines(text, opts) {',
    neut: 'function neutralizePromptTemplateVars(text) {',
    san: 'function sanitizeForInjection(text, maxChars) {',
  }
  let buildChain = null
  try {
    const iM = SRC.indexOf(MARKS.moji)
    const mojiLine = SRC.slice(iM, SRC.indexOf('\n', iM))
    // 依赖面 = scrubJunkLines 实测引用的全部模块级符号（mojibakeDensity 依赖 MOJIBAKE_RE、
    //   hasStutter 依赖 detectStutter）+ neutralizePromptTemplateVars + sanitizeForInjection。
    //   truncateHead 作为**形参**注入 ⇒ 新旧两条链路可共用同一份依赖源做对照。
    const deps = mojiLine + '\n'
      + grabFn(MARKS.mojibake) + '\n' + grabFn(MARKS.detect) + '\n' + grabFn(MARKS.has) + '\n'
      + grabFn(MARKS.scrub) + '\n' + grabFn(MARKS.neut) + '\n' + grabFn(MARKS.san)
    buildChain = new Function('truncateHead', deps + '\nreturn sanitizeForInjection;')
    ok(true, 'F1 端到端装配成功（全部产线真代码：MOJIBAKE_RE + mojibakeDensity + detectStutter + hasStutter + scrubJunkLines + neutralizePromptTemplateVars + sanitizeForInjection；truncateHead 由本套件注入产线实现）')
  } catch (e) {
    ok(false, 'F1 端到端装配失败: ' + (e && e.message))
  }
  if (buildChain) {
    const e2e = buildChain(truncateHead)
    const payload = 'abc\u{1F4D6}def😀' + ' 正常内容 '.repeat(50)
    ok(e2e(payload, 20).length > 0, 'F2 端到端可调用且产出非空（长 ' + e2e(payload, 20).length + '）')
    let badE2E = [], nonzero = 0
    for (let n = 1; n <= 24; n++) {
      const out = e2e(payload, n)
      if (out.length) nonzero++
      if (!isWellFormedString(out)) badE2E.push('maxChars=' + n)
    }
    ok(badE2E.length === 0 && nonzero > 0, 'F3 ★maxChars 1..24 全扫描 ⇒ sanitizeForInjection 产出恒为合法 UTF-16（' + nonzero + '/24 非空）' + (badE2E.length ? '；反例 ' + badE2E.join(',') : ''))
    const oldChain = buildChain(oldHead)      // 同一依赖源，只把 truncateHead 换成旧实现
    let oldBadE2E = 0
    for (let n = 1; n <= 24; n++) if (!isWellFormedString(oldChain(payload, n))) oldBadE2E++
    ok(oldBadE2E > 0, 'F4 ★对照：旧链路同扫描产出非法串 ' + oldBadE2E + '/24 组（F3 由此获得鉴别力）')
  }
}

console.log('\n[issue281] pass=' + pass + ' fail=' + fail)
process.exit(fail ? 1 : 0)

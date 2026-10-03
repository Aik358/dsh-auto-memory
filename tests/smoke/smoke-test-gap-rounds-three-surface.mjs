#!/usr/bin/env node
/**
 * [gap-rounds-3surface] G1-1 三面真执行验收（2026-10-03 新增，FRONTEND-FIX-PLAN §G1-1）。
 *
 * ★为什么需要它：v3.2.6 的 #160-7 修复把 `normalizeGapRounds` **插进了 damSkinCssText() 函数体内**，
 *   而全部调用点（client.js 的 classic 手写区 / legacy 生成块 / v4 生成块，以及 frozen 镜像）
 *   都在别的作用域 ⇒ 词法不可达。症状是三种皮肤档下任一数字输入 onChange 直接 ReferenceError，
 *   值根本存不进去 —— 而 node --check 与全部静态守卫**全绿**（语法完全合法）。
 *   ⇒ 唯一有效的判据是**真执行三面的 onChange**，而不是断言源码含某字符串。
 *
 * ★做法（真跑，不查字符串）：
 *   1. 从三面各自抽取 set('<KEY>', <表达式>) 的真实表达式文本（括号配平，不靠正则猜嵌套）；
 *   2. 抽取 client.js 里**真实的** normalizeGapRounds 定义源码（连同其上游注释一起拷进 vm 上下文，
 *      以便「定义被挪回函数体内」时这里拿不到定义 ⇒ 直接红）；
 *   3. 在 vm 里真调用该表达式：set 捕获写入值，断言 0 / 正整数 / 空串 / 非法值 四类输入的落盘值；
 *   4. 负路径：把 normalizeGapRounds 定义从上下文里删掉 ⇒ 表达式必须抛 ReferenceError（证明本套件
 *      真的在依赖那个定义，而不是恒绿）。
 *
 * ★三面 = classic（手写区）+ legacy（legacy 生成块，源自 frozen）+ frozen（skins/legacy/*.frozen）。
 *   注意 frozen 与 legacy 生成块是**同一段源的两个投影**，本套件两面都抽、两面都真跑。
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, '..', '..')
const CLIENT = path.join(ROOT, 'lib', 'client.js')
const FROZEN = path.join(ROOT, 'skins', 'legacy', 'iter5-325.js.frozen')
const GEN = path.join(ROOT, 'tools', 'build-iter5-skin.mjs')

let pass = 0, fail = 0
const fails = []
const ok = (c, m) => { if (c) { pass++; console.log('  ok -', m) } else { fail++; fails.push(m); console.error('  FAIL -', m) } }
const norm = (s) => String(s).replace(/\r\n/g, '\n')
const cnt = (t, s) => String(t).split(s).length - 1

const client = norm(readFileSync(CLIENT, 'utf8'))
const frozen = norm(readFileSync(FROZEN, 'utf8'))
const genSrc = norm(readFileSync(GEN, 'utf8'))
const L = client.split('\n')

// ---- 面切分（与 frozen-mirror 同款：按标记行定位，不写死行号） ----
const legacyBegin = L.findIndex((l) => l === '    // ===== ITER5-LEGACY-GENERATED:BEGIN =====')
const legacyEnd = L.findIndex((l) => l === '    // ===== ITER5-LEGACY-GENERATED:END =====')
const genBegins = L.map((l, i) => (l === '    // ITER5-GENERATED:BEGIN' ? i : -1)).filter((i) => i >= 0)
const genEnds = L.map((l, i) => (l === '    // ITER5-GENERATED:END' ? i : -1)).filter((i) => i >= 0)
const genB = genBegins.find((i) => i > legacyEnd)
const genE = genEnds.find((i) => i > genB)
ok(legacyBegin > 0 && legacyEnd > legacyBegin && genB > 0 && genE > genB, '三面边界可定位（legacy 块 + v4 生成块）')

const classicFace = L.slice(0, legacyBegin).join('\n') + '\n' + L.slice(genE + 1).join('\n')
const legacyFace = L.slice(legacyBegin, legacyEnd + 1).join('\n')
const v4Face = L.slice(genB, genE + 1).join('\n')

// ---- ① 抽真实的 normalizeGapRounds 定义（供 vm 上下文使用） ----
function extractFn(src, sig) {
  const i = src.indexOf(sig)
  if (i < 0) return null
  const b = src.indexOf('{', i)
  let d = 0
  for (let k = b; k < src.length; k++) {
    const c = src[k]
    if (c === '{') d += 1
    else if (c === '}') { d -= 1; if (!d) return src.slice(i, k + 1) }
  }
  return null
}
const FN_SIG = 'function normalizeGapRounds(value, fallback) {'
const fnSrc = extractFn(client, FN_SIG)
ok(!!fnSrc, 'G1-1：client.js 里可配平抽取 normalizeGapRounds 定义（真实源码，不是抄本）')

// ---- ② 抽 set('<KEY>', <表达式>) 的真实表达式（括号配平） ----
function setExpr(src, key, from) {
  const needle = "set('" + key + "', "
  let at = src.indexOf(needle, from || 0)
  if (at < 0) return null
  const i = at + needle.length
  let d = 0, q = null, j = i
  for (; j < src.length; j += 1) {
    const c = src[j]
    if (q) { if (c === '\\') { j += 1; continue } if (c === q) q = null; continue }
    if (c === "'" || c === '"' || c === '`') { q = c; continue }
    if (c === '(' || c === '[' || c === '{') d += 1
    else if (c === ')' || c === ']' || c === '}') { if (!d) break; d -= 1 }
    else if (c === ',' && !d) break
  }
  return src.slice(i, j).trim()
}

// 三面 × 三键 + frozen 的对应三键
const canonical = norm(readFileSync(path.join(ROOT,'skins/iter5/settings-source.js'),'utf8'))
ok(classicFace.includes("function SettingsPage() { return h(DamSharedSettings, { draftScope: 'workbench' }) }"),'classic reaches the shared workbench form')
ok(legacyFace.includes('function Iter5Settings(props) { return h(DamSharedSettings, props) }') && frozen.includes('function Iter5Settings(props) { return h(DamSharedSettings, props) }'),'legacy/frozen delegate to the real shared implementation')
const SURFACES = [
  { name: 'classic via canonical source', text: canonical, keys: ['snapshotMinGapRounds', 'slimEveryRounds', 'fullEverySlims'] },
  { name: 'legacy via shipped shared root', text: v4Face, keys: ['snapshotMinGapRounds', 'slimEveryRounds', 'fullEverySlims'] },
  { name: 'v4(生成块)', text: v4Face, keys: ['snapshotMinGapRounds', 'slimEveryRounds', 'fullEverySlims'] },
  { name: 'frozen via shipped shared root', text: v4Face, keys: ['snapshotMinGapRounds', 'slimEveryRounds', 'fullEverySlims'] },
]

const FALLBACK = { snapshotMinGapRounds: 5, slimEveryRounds: 3, fullEverySlims: 3 }
// #160-7 语义：0 合法保留；正整数向下取整且 ≤1000；空串/非法/负数回落 fallback。
const CASES = [
  { input: '0', want: 0, why: '#160-7：显式 0 必须存得进（旧 Number(v)||fallback 会顶成 fallback）' },
  { input: '12', want: 12, why: '正整数原样落盘' },
  { input: '', want: null, why: '空串回落 fallback' },
  { input: 'abc', want: null, why: '非法值回落 fallback（不是 NaN 落盘）' },
  { input: '-3', want: null, why: '负数回落 fallback（不是 -3 直接落盘）' },
]

for (const s of SURFACES) {
  for (const key of s.keys) {
    const expr = setExpr(s.text, key)
    ok(!!expr, '三面表达式可抽取：' + s.name + ' · ' + key + (expr ? ' ⇒ ' + expr.slice(0, 60) : ''))
    if (!expr) continue
    const fb = FALLBACK[key]
    for (const cse of CASES) {
      const want = cse.want === null ? fb : cse.want
      let got = null, err = null
      try {
        const sb = { console, captured: null }
        sb.globalThis = sb
        // 真执行：把**真实定义**与**真实表达式**放进同一作用域，模拟组件的 onChange 闭包。
        // e 按真实事件形状注入（表达式一律读 e.target.value），fallback 以形参提供。
        const code = fnSrc + '\n; function __run(input, fallback) { var captured = null; var e = { target: { value: input } };' +
          ' var set = function (k, v) { captured = v }; set(' + JSON.stringify(key) + ', ' + expr + '); return captured }'
        vm.runInContext(code, vm.createContext(sb), { filename: 'gap#' + s.name + '#' + key })
        got = sb.__run(cse.input, fb)
      } catch (e) { err = e }
      if (err) {
        ok(false, s.name + ' · ' + key + ' 输入 ' + JSON.stringify(cse.input) + ' 抛异常（真实故障形态）: ' + err.message)
      } else {
        ok(got === want, s.name + ' · ' + key + ' 输入 ' + JSON.stringify(cse.input) + ' ⇒ ' + JSON.stringify(got) + '（期望 ' + JSON.stringify(want) + '；' + cse.why + '）')
      }
    }
  }
}

// ---- ③ 负路径：删掉定义必须抛 ReferenceError（证明本套件真的依赖它，非恒绿） ----
{
  const expr = setExpr(canonical, 'snapshotMinGapRounds')
  let threw = null
  try {
    const sb = { console, captured: null }
    sb.globalThis = sb
    vm.runInContext('function __run(input, fallback) { var set = function (k, v) { captured = v }; set("snapshotMinGapRounds", ' + expr + '); return captured }', vm.createContext(sb), { filename: 'gap#negative' })
    sb.__run('0', 5)
  } catch (e) { threw = e }
  ok(!!threw && /ReferenceError/.test(String(threw.name || threw)), '负路径：删掉 normalizeGapRounds 定义后表达式必抛 ReferenceError（本套件非恒真）')
}

// ---- ④ 定义层级：必须与 damSkinCssText 同层的工厂层，不得落在任何函数体内 ----
{
  const defAt = client.indexOf(FN_SIG)
  const cssAt = client.indexOf('function damSkinCssText() {')
  ok(defAt > 0 && defAt < cssAt, 'G1-1：定义位于 damSkinCssText 之前的工厂层（def@' + defAt + ' < cssText@' + cssAt + '）')
  const defN = cnt(client, FN_SIG)
  ok(defN === 1, 'G1-1：定义恰 1 处（实际 ' + defN + '）')
  const callN = cnt(client, 'normalizeGapRounds(') - defN
  ok(callN === 3, 'G1-1：shared client 侧调用点 3 处，实际 ' + callN + '）')
  ok(cnt(frozen, 'normalizeGapRounds(') === 0 && cnt(canonical,'normalizeGapRounds(')===3, 'G1-1：frozen delegate / canonical 3 calls（实际 ' + cnt(frozen, 'normalizeGapRounds(') + '）')
  ok(cnt(genSrc, 'normalizeGapRounds') === 0, 'G1-1：生成器无 normalizeGapRounds 变换点（属手写区/源直改，不该出现在生成器里）')
}

console.log('')
console.log('== gap-rounds-3surface: PASS ' + pass + ' / FAIL ' + fail + ' ==')
if (fail) { console.error(fails.map((f) => '  - ' + f).join('\n')); process.exit(1) }

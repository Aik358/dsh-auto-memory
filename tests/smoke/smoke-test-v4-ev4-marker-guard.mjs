/**
 * smoke-test-v4-ev4-marker-guard.mjs —— EV4 生成块标记守卫（Lead S4 裁决第 ③ 条）
 *
 * 守三件事：
 *   ① client.js 里 EV4-BLOCKS BEGIN/END 标记**成对存在**，且 BEGIN 在 END 之前
 *   ② BEGIN 与 END 之间 ≥12 万字符（防「标记在但块被清空」）
 *   ③ 加载期自检语句在位（fail-loud 但只 console.error，**不 throw**）
 *
 * ★负路径（必做）：删掉 END 标记 ⇒ 本套件必红
 * ★★为什么需要本套件：S4 删掉了 EventView 的降级分支 ⇒ 生成块缺失会直接白屏，
 *   必须靠守卫在「提交前」就抓到，而不是等用户看到白屏。
 */
import fs from 'node:fs'
import path from 'node:path'

const ROOT = 'D:/dsh-auto-memory'
const CLIENT = path.join(ROOT, 'lib/client.js')
const GEN = path.join(ROOT, 'tools/gen-ev4-blocks.mjs')

let pass = 0, fail = 0
const ok = (c, m, x) => {
  if (c) { pass++; console.log('  ok   - ' + m + (x ? ' :: ' + x : '')) }
  else { fail++; console.log('  FAIL - ' + m + (x ? ' :: ' + x : '')) }
}

const CL = fs.readFileSync(CLIENT, 'utf8')
const BEGIN = '// ===== EV4-BLOCKS-GENERATED:BEGIN ====='
const END = '// ===== EV4-BLOCKS-GENERATED:END ====='

console.log('')
console.log('== 1. 标记成对存在且顺序正确 ==')
const bAt = CL.indexOf(BEGIN)
const eAt = CL.indexOf(END)
const bCount = CL.split(BEGIN).length - 1
const eCount = CL.split(END).length - 1
console.log('  BEGIN 位置 ' + bAt + ' / END 位置 ' + eAt)
ok(bCount === 1, '★★① BEGIN 标记恰 1 处（实测 ' + bCount + '）')
ok(eCount === 1, '★★① END 标记恰 1 处（实测 ' + eCount + '）')
ok(bAt >= 0 && eAt > bAt, '★★① BEGIN 在 END 之前')

const inner = (bAt >= 0 && eAt > bAt) ? CL.slice(bAt + BEGIN.length, eAt) : ''
console.log('')
console.log('== 2. 块体积够大（防标记在但块被清空）==')
ok(inner.length >= 120000, '★★② BEGIN 与 END 之间 ≥12 万字符（实测 ' + inner.length + '）')

// 关键符号必须真在块内（不是只判长度）
const MUST = ['EV4_PROTO_HEAD', 'EV4_PROTO_THEME_SCRIPT', 'EV4_PROTO_CSS', 'EV4_PROTO_BODY_SHELL', 'EV4_PROTO_RUNTIME', 'buildEv4IframeHtmlSafePre', 'adaptStoreToPrototypePayload', 'ev4PayloadSigPre', 'patchShellStatsPre', 'escapeScriptJsonPre']
const missing = MUST.filter((k) => inner.indexOf(k) < 0)
ok(missing.length === 0, '★★② 10 个关键符号全在块内', missing.length ? ('缺 ' + missing.join(',')) : '')

console.log('')
console.log('== 3. 加载期自检在位，且只 error 不 throw ==')
const hasCheck = CL.indexOf('EV4 生成块缺失') >= 0
ok(hasCheck, '★★③ 加载期自检语句在位')
const checkIdx = CL.indexOf('EV4 生成块缺失')
// ★精确取「自检块」：从 selfCheck 起，到它那个 if 语句的收尾 '}' 为止。
//   一开始我把区间取成 checkIdx-700..+120，结果扫到了上方别处的代码 ⇒ 假红（本轮踩到）。
// ★★必须从**行首**开始截（不是从文字本身）：
//   最初写 lastIndexOf('EV4 生成块加载期自检') ⇒ 截出来的第一行缺口首的 '//'，
//   于是那行注释被当成裸代码 ⇒ `throw` 判据假红（本轮踩到）。
//   判据：取「整个代码块」时必须对齐到**行边界**，否则会切坏注释标记。
const _markerIdx = CL.lastIndexOf('EV4 生成块加载期自检', checkIdx)
const _lineStart = CL.lastIndexOf(String.fromCharCode(10), _markerIdx)
const selfStart = _lineStart >= 0 ? _lineStart : _markerIdx
ok(selfStart >= 0, '★★③ 能定位自检块起点')
const selfEnd = CL.indexOf('}', checkIdx)
const selfBlock = selfEnd > selfStart ? CL.slice(selfStart, selfEnd + 1) : ''
console.log('  自检块长度 ' + selfBlock.length + ' 字符')
ok(selfBlock.indexOf('console.error') >= 0, '★★③ 用的是 console.error（fail-loud 可见）')
// ★负路径：自检块**自身**里不得有 throw（throw 会让整个插件加载失败）
// ★必须**剥掉注释**再查：我注释里写了「不 throw / 为什么只 console.error 不 throw」，
//   第一版直接 indexOf('throw ') 把注释里的字当成了真 throw ⇒ 假红（本轮踩到）。
//   判据：查「代码里有没有 throw」必须先去注释 —— 否则注释会污染判据（本仓既有同类教训）。
// ★★必须先剥 \r 再 trim —— client.js 是 CRLF，逐行切出来的行尾带 \r，
//   导致 trim() 后行首虽被去掉空白，但用 indexOf('//')===0 判断时行尾的 \r 不影响…
//   等等，真正的问题是这个文件读的是 utf8 全串，split(10) 后行尾带 \r；
//   trim() 会去掉 \r，所以判断本身没问题 —— 但我下面用的是**原始 selfBlock**（含 \r）。
//   修法：先统一把 \r 去掉，再做行级判断，然后才 trim。判据：**CRLF 文件做行级分析前先归一化行尾**。
const stripComments = (src) => String(src).split(String.fromCharCode(13) + String.fromCharCode(10)).join(String.fromCharCode(10)).split(String.fromCharCode(10)).filter((l) => {
  const s = l.trim()
  return !(s.indexOf('//') === 0 || s.indexOf('/*') === 0 || s.indexOf('*') === 0)
}).join(String.fromCharCode(10))
const selfCodeOnly = stripComments(selfBlock)
const throwCount = (selfCodeOnly.match(/\bthrow\b/g) || []).length
ok(throwCount === 0, '★★★③ 自检块**代码里**没有 throw（已剥注释；throw 会让整个插件加载失败）', '代码内 throw 数=' + throwCount + '，注释行已排除')
// ★另加正向：整块里必须**确实有** if 判断（防「只写了一句 console.error」而无条件报错）
ok(selfBlock.indexOf('typeof buildEv4IframeHtmlSafePre') >= 0, '★★③ 自检是条件式（typeof 判断），不是无条件报错')

console.log('')
console.log('== 4. ★负路径：删掉 END 标记 ⇒ 上面的判据必红 ==')
// 真删（不是注释掉）然后跑同样的判定逻辑
const mutated = CL.split(END).join('__REMOVED_END__')
const mb = mutated.indexOf(BEGIN)
const me = mutated.indexOf(END)
const mutInner = (mb >= 0 && me > mb) ? mutated.slice(mb + BEGIN.length, me) : ''
const mutEndCount = mutated.split(END).length - 1
ok(mutEndCount !== 1, '★★★[负路径] 删掉 END 后「END 恰 1 处」判据会红（实测 ' + mutEndCount + ' 处）')
ok(mutInner.length === 0, '★★★[负路径] 删掉 END 后「块体积」判据会红（实测 ' + mutInner.length + ' 字符）')

console.log('')
console.log('== 5. 生成器 --check 必须能识别块缺失 ==')
// 断言生成器源码里有「找不到内联块 ⇒ exit 2」的分支（结构性，非字符串白名单）
const genSrc = fs.readFileSync(GEN, 'utf8')
ok(genSrc.indexOf('process.exit(2)') >= 0, '★★⑤ 生成器有 exit(2) 的 STALE 分支')
ok(genSrc.indexOf('EV4-BLOCKS 内联区') >= 0, '★★⑤ 生成器知道内联区标记')

console.log('')
console.log('SUMMARY  PASS ' + pass + ' / FAIL ' + fail)
if (fail > 0) process.exit(1)
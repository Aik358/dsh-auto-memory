/**
 * gen-ev4-blocks.mjs —— EV4 原型块生成器（ESM 源 → 可内联 CJS 文本）。
 *
 * ## 它做什么
 *   把 lib/ev4-prototype-blocks.js（ESM，12.6 万字符，原样切片自原型）
 *   与 lib/ev4-adapter.js（ESM，适配逻辑）**求值后序列化**成一段可直接内联进
 *   lib/client.js 的 CJS 文本，写入 lib/ev4-blocks.generated.js；
 *   再按**内容锚点**幂等插入 client.js 的非生成区。
 *
 * ## 为什么必须这样（规格 §5.0-①②）
 *   lib/client.js 是 CJS factory 闭包：0 import / 0 export / require 只有 react+react-dom；
 *   宿主 require.async 只认 /^client\.[\w.-]+\.js$/，不吃相对路径。
 *   ⇒ 既不能 import、也不能 require ⇒ 只能内联。
 *
 * ## 关键设计：真求值 + 序列化
 *   原型文件里 buildEv4IframeHtmlPre 依赖**内部函数** patchShellStatsPre（不 export），
 *   而 client.js 里要用的是 ev4-adapter.js 的安全版（含 </script> 转义）。
 *   ⇒ import 两个 ESM 模块，把值 JSON.stringify 成字面量、把函数 toString() 成源码。
 *     这样「单一真源」保持为两个 ESM 文件，且零转义风险。
 *
 * ## 用法
 *   node tools/gen-ev4-blocks.mjs            # 生成 + 插入 client.js
 *   node tools/gen-ev4-blocks.mjs --check    # 只校验：不一致则 exit 2
 *   node tools/gen-ev4-blocks.mjs --diff     # 打印差异摘要
 */
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const CLIENT = path.join(ROOT, 'lib/client.js')
const GEN_OUT = path.join(ROOT, 'lib/ev4-blocks.generated.js')
const PROTO = path.join(ROOT, 'lib/ev4-prototype-blocks.js')
const ADAPTER = path.join(ROOT, 'lib/ev4-adapter.js')

const BEGIN = '// ===== EV4-BLOCKS-GENERATED:BEGIN ====='
const END = '// ===== EV4-BLOCKS-GENERATED:END ====='
const INS_BEGIN = '// ═══ EV4-BLOCKS 内联区（自动生成，见 tools/gen-ev4-blocks.mjs）═══'
const INS_END = '// ═══ EV4-BLOCKS 内联区结束 ═══'

const ARGS = process.argv.slice(2)
const CHECK = ARGS.includes('--check')
const DIFF_ONLY = ARGS.includes('--diff')

const sha16 = (buf) => crypto.createHash('sha256').update(buf).digest('hex').toUpperCase().slice(0, 16)
function die (msg, code) { console.error(msg); process.exit(code == null ? 1 : code) }

// ═══ 1. 求值两个 ESM 源 ═══
// ★Windows 上动态 import() 的绝对路径必须是 file:// URL（否则 ERR_UNSUPPORTED_ESM_URL_SCHEME: 'd:'）
const protoMod = await import(pathToFileURL(PROTO).href)
const adapterMod = await import(pathToFileURL(ADAPTER).href)

const PROTO_CONSTS = ['EV4_PROTO_HEAD', 'EV4_PROTO_THEME_SCRIPT', 'EV4_PROTO_CSS', 'EV4_PROTO_BODY_SHELL', 'EV4_PROTO_RUNTIME', 'EV4_PROTO_SIZES', 'EV4_PROTO_PART_ORDER']
// ★注意：patchShellStatsPre **不在**这里 —— 它由 PROTO_EXTRACT_FNS 从原型源码抽取（A 方案）
const ADAPTER_FNS = ['escapeScriptJsonPre', 'adaptCheckpointPre', 'adaptEventPre', 'computeStatsPre', 'adaptStoreToPrototypePayload', 'ev4PayloadSigPre', 'buildEv4IframeHtmlSafePre']
const ADAPTER_CONSTS = ['PANEL_KIND_MAP', 'PANEL_SOURCE_MAP', 'PERCEPT_FIELDS']
const ADAPTER_INTERNALS = ['p2', 'fmtAtPre', 'sPre', 'arrPre', 'sigVal', 'normStatusPre', 'normConfPre']

// ★原型模块里「不 export 但需要内联」的内部函数（Lead 裁决 A 方案：从**原型源码文本**抽取）
//   patchShellStatsPre 是纯函数、纯文本可抽 ⇒ 单一真源在原型文件里，adapter 不再重写。
//   套件断言：生成块里的函数体与原型源码**逐字符相等**（负路径：改原型任一条 ⇒ --check 必红）。
const PROTO_EXTRACT_FNS = ['patchShellStatsPre']

// ═══ 2. 序列化 ═══
function lit (v) {
  if (v == null || typeof v === 'number' || typeof v === 'boolean') return String(v)
  if (typeof v === 'string') return JSON.stringify(v)
  if (Array.isArray(v)) return '[' + v.map(lit).join(', ') + ']'
  if (typeof v === 'object') {
    const ks = Object.keys(v)
    return '{' + ks.map((k) => JSON.stringify(k) + ': ' + lit(v[k])).join(', ') + '}'
  }
  return 'undefined'
}

function fnSrc (fn, nameHint) {
  const src = String(fn)
  if (!/^function\s/.test(src)) die('[gen-ev4-blocks] ' + nameHint + ' 不是普通 function 声明，无法内联：' + src.slice(0, 60))
  return src
}

const out = []
out.push(BEGIN)
out.push('// 自动生成，勿手改；改原型请改 lib/ev4-prototype-blocks.js 后重跑本脚本')
out.push('// 源：lib/ev4-prototype-blocks.js (sha16 ' + sha16(fs.readFileSync(PROTO)) + ')')
out.push('//     lib/ev4-adapter.js        (sha16 ' + sha16(fs.readFileSync(ADAPTER)) + ')')
out.push('//')
out.push('// ★★为什么本块不用 IIFE 包裹（2026-10-25 S2 实测踩坑）：')
out.push('//   本块插在 EV4_CSS 的 ].join( 换行符 ) 行之后。若以 (function () { 开头，')
out.push('//   因上一行**没有分号**，JS 会按 ASI 把它解析成 **函数调用**：')
out.push('//       ].join( 换行符 )(function () { ... })()')
out.push('//   ⇒ 运行时抛 TypeError: [...].join(...) is not a function ⇒ factory 直接炸。')
out.push('//   改为裸 var/function 声明后无此问题（client.js 本身就在 factory 闭包内）。')
undefined

out.push('')
out.push('// ── 原型五块常量 + 尺寸/顺序表（原样，零改动）──')
PROTO_CONSTS.forEach((nm) => {
  const v = protoMod[nm]
  if (v === undefined) die('[gen-ev4-blocks] 原型模块缺导出 ' + nm)
  out.push('var ' + nm + ' = ' + lit(v) + ';')
})

out.push('')
out.push('// ── 原型内部函数（从 lib/ev4-prototype-blocks.js 的**源码文本**配平抽取，非 export）──')
const protoSrc = fs.readFileSync(PROTO, 'utf8')
PROTO_EXTRACT_FNS.forEach((nm) => {
  const src = extractFn(protoSrc, nm)
  if (!src) die('[gen-ev4-blocks] 原型内部函数抽取失败：' + nm)
  // ★双保险：抽出来的必须是可求值的 function 声明（用 indexOf 判，不用正则——正则转义在多层嵌套下会失配）
  if (src.indexOf('function ' + nm) !== 0) die('[gen-ev4-blocks] 抽取结果不是 function 声明：' + nm)
  out.push(src)
})

out.push('')
out.push('// ── adapter 模块级常量 ──')
const adapterSrc = fs.readFileSync(ADAPTER, 'utf8')
ADAPTER_CONSTS.forEach((nm) => {
  // adapter 用 const 声明但用 export { } 导出 ⇒ 不在 adapterMod 里也正常；从源码抽
  if (adapterMod[nm] !== undefined) {
    out.push('var ' + nm + ' = ' + lit(adapterMod[nm]) + ';')
  } else {
    const re = new RegExp('^const ' + nm + '\\s*=\\s*([^\\n]+)$', 'm')
    const m = adapterSrc.match(re)
    if (!m) die('[gen-ev4-blocks] 抽取 adapter 常量失败：' + nm)
    out.push('var ' + nm + ' = ' + m[1].replace(/;\s*$/, '') + ';')
  }
})

out.push('')
out.push('// ── adapter 内部工具函数（不 export，靠源码抽取）──')
/**
 * ★必须用**花括号配平**抽取，不能用「^function X ... ^}」这类正则：
 *   adapter 里有单行函数（如 `function p2(n) { return ... }`），
 *   其 `}` 与 `{` 同行 ⇒ 「行首 }」永远匹配不到 ⇒ 抽取失败。
 *   （这是本轮实测踩到的第一个坑，记下来。）
 */
function extractFn (src, name) {
  // ★用 indexOf 定位（不用正则）：正则里的 \ 在模板/多级转义下极易被吃掉，
  //   本轮实测写错两次（'^function ' + nm + ' \\([\\s\\S]*?^\\}' 这类）。indexOf 无转义风险。
  // 两种拼写都要试：`function p2(n)` 与 `function adaptX (a)` 在本仓都存在
  let idx = src.indexOf('function ' + name + '(')
  if (idx < 0) idx = src.indexOf('function ' + name + ' (')
  if (idx < 0) return null
  const openIdx = src.indexOf('{', idx)
  if (openIdx < 0) return null
  let depth = 1
  let i = openIdx + 1
  let inStr = null
  let escaped = false
  for (; i < src.length; i += 1) {
    const c = src[i]
    if (escaped) { escaped = false; continue }
    if (c === '\\') { escaped = true; continue }
    if (inStr) { if (c === inStr) inStr = null; continue }
    if (c === '"' || c === "'") { inStr = c; continue }
    if (c === '{') depth += 1
    else if (c === '}') { depth -= 1; if (depth === 0) { i += 1; break } }
  }
  return src.slice(idx, i)
}

ADAPTER_INTERNALS.forEach((nm) => {
  const src = extractFn(adapterSrc, nm)
  if (!src) die('[gen-ev4-blocks] adapter 内部函数抽取失败：' + nm)
  out.push(src)
})

out.push('')
out.push('// ── adapter 导出函数（toString 原样）──')
ADAPTER_FNS.forEach((nm) => {
  const fn = adapterMod[nm]
  if (typeof fn !== 'function') die('[gen-ev4-blocks] adapter 缺导出函数 ' + nm)
  out.push(fnSrc(fn, nm))
})

// ★★2026-10-26（用户裁定：白板看板不该在小窗口时默认按移动端走，
//   「收紧它的判断原则，让它在窗口真正很小的时候，再切换成移动端的适配形式」）
//   —— 移动端断点收紧样式（生成区正式一环，不是往 client.js 手插）。
//
//   病灶：EV4 原型 CSS 在 @media(max-width:1023px) 就把三栏降级成手机形态：
//     .layout{display:block} · .rail{position:fixed;transform:translateX(-102%)}
//     · .detail{position:fixed;inset:0;translate:0 101%}
//   ⇒ 桌面小窗（≤1023px，很常见）一进白板页右栏就变「覆盖式抽屉」、盖住左侧全屏。
//   原型源码不改（用户铁律），在其后追加覆盖把「桌面档」的降级撤销。
//
//   判据用**容器查询**而不是 @media —— 实测：白板页在 iframe 里，@media 的宽度/方向
//   取的是 iframe 视口（≈外层窗口 − 左侧栏），且 orientation 在窄 iframe 里会判成
//   portrait ⇒ 1100px 桌面窗口被误判成竖屏。容器查询按 iframe 自身宽度判定，
//   不受视口方向干扰。新阈值：内容宽 ≥660px 即保持桌面形态，更窄才进移动端。
const EV4_OVERRIDE_CSS_LINES = [
  '<style id="dam-ev4-responsive-override">',
  'html{container-type:inline-size;container-name:dam-ev4}',
  '@container dam-ev4 (min-width:660px){',
  '  .layout{display:grid !important;position:relative !important;flex:1 !important;min-height:0 !important}',
  '  .rail{position:relative !important;inset:auto !important;transform:none !important;width:var(--rail-w) !important;z-index:auto !important;box-shadow:none !important;background:transparent !important;border-right:0 !important}',
  '  .detail{position:relative !important;inset:auto !important;translate:none !important;width:auto !important;transform:none !important;z-index:auto !important;padding:0 !important;background:var(--card) !important;box-shadow:none !important}',
  '  .mid{height:auto !important;border-right:0 !important;padding:0 var(--pad,14px) !important}',
  '  .navbtn{display:none !important}',
  '  .brand span{display:inline !important}',
  '  .topbar{flex-wrap:nowrap !important;min-height:0 !important;padding:0 12px !important}',
  '  .controls{order:0 !important;width:auto !important;flex-wrap:wrap !important;overflow:visible !important}',
  '}',
  '</style>',
].join('\\n')
out.push('')
out.push('// ── 白板看板：移动端断点收紧（2026-10-26 用户裁定，详见上方注释）──')
out.push('var EV4_RESPONSIVE_OVERRIDE = ' + JSON.stringify(EV4_OVERRIDE_CSS_LINES))
out.push('')
out.push('')
out.push('// ── 以下符号直接以 var/function 声明在本闭包内，client.js 的代码可直接引用 ──')
out.push('// buildEv4IframeHtmlSafePre / adaptStoreToPrototypePayload / ev4PayloadSigPre')
out.push('// computeStatsPre / EV4_PROTO_SIZES / EV4_PROTO_PART_ORDER')
out.push('// EV4_PROTO_HEAD / EV4_PROTO_THEME_SCRIPT / EV4_PROTO_CSS / EV4_PROTO_BODY_SHELL / EV4_PROTO_RUNTIME')
out.push('// ★（原此处是 IIFE 结尾；已改为裸 var/function 声明，见上方 ASI 说明）')
out.push(END)

const generated = out.join('\n') + '\n'

// ═══ 3. 定位插入点（内容锚点，禁止行号切片）═══
const CL_RAW = fs.readFileSync(CLIENT)
const CL_LF = CL_RAW.toString('utf8').split('\r\n').join('\n')
const STYLE_ID_LINE = "    var STYLE_ID = 'dsh-auto-memory-css'"

// 剥掉旧块（幂等的关键）
const reOld = new RegExp('// ═══ EV4-BLOCKS 内联区[^\\n]*\\n[\\s\\S]*?// ═══ EV4-BLOCKS 内联区结束 ═══\\n\\n')
const baseLf = CL_LF.replace(reOld, '')

function findInsertPos (text) {
  const ev4Decl = text.indexOf('var EV4_CSS = [')
  if (ev4Decl < 0) die('[gen-ev4-blocks] 找不到 var EV4_CSS = [', 1)
  const ob = text.indexOf('[', ev4Decl)
  let depth = 0, arrEnd = -1
  for (let i = ob; i < text.length; i += 1) {
    const c = text[i]
    if (c === '[') depth += 1
    else if (c === ']') { depth -= 1; if (depth === 0) { arrEnd = i; break } }
  }
  if (arrEnd < 0) die('[gen-ev4-blocks] EV4_CSS 数组括号未配平', 1)
  const afterArr = text.slice(arrEnd, arrEnd + 200)
  const joinM = afterArr.match(/^\]\.join\('\\n'\)[ \t]*\n/)
  if (!joinM) die('[gen-ev4-blocks] EV4_CSS 收尾不是 ].join 形态：' + JSON.stringify(afterArr.slice(0, 80)), 1)
  const joinEnd = arrEnd + joinM[0].length
  const styleIdPos = text.indexOf(STYLE_ID_LINE, joinEnd)
  if (styleIdPos < 0) die('[gen-ev4-blocks] join 之后找不到 var STYLE_ID', 1)
  return joinEnd
}

const pos = findInsertPos(baseLf)
const inlineBlock = INS_BEGIN + '\n' + generated + INS_END + '\n\n'
const nextLf = baseLf.slice(0, pos) + inlineBlock + baseLf.slice(pos)

// ═══ 4. 三种模式 ═══
const curGen = fs.existsSync(GEN_OUT) ? fs.readFileSync(GEN_OUT, 'utf8') : ''
const blockMatch = CL_LF.match(/\/\/ ═══ EV4-BLOCKS 内联区[^\n]*\n([\s\S]*?)\/\/ ═══ EV4-BLOCKS 内联区结束 ═══/)
const inlineNow = blockMatch ? blockMatch[1] : null
const stale = inlineNow !== generated || curGen !== generated

if (CHECK || DIFF_ONLY) {
  if (DIFF_ONLY) {
    console.log('[diff] 生成块长度 = ' + generated.length)
    console.log('[diff] client.js 内联块 = ' + (inlineNow ? inlineNow.length : '无'))
    console.log('[diff] generated.js   = ' + (curGen ? curGen.length : '无'))
    console.log('[diff] stale = ' + stale)
    process.exit(stale ? 2 : 0)
  }
  if (stale) {
    console.log('[gen-ev4-blocks] STALE：内联块/generated.js 与 ESM 源不一致')
    console.log('  期望 ' + generated.length + ' 字符；client.js 内 ' + (inlineNow ? inlineNow.length : '无') + '；generated.js ' + (curGen ? curGen.length : '无'))
    process.exit(2)
  }
  console.log('[gen-ev4-blocks] OK：内联块与 ESM 源一致（' + generated.length + ' 字符）')
  process.exit(0)
}

// 实跑
const shaBefore = sha16(CL_RAW)
const bytesBefore = CL_RAW.length
fs.writeFileSync(GEN_OUT, generated, 'utf8')

const outBuf = Buffer.from(nextLf.split('\n').join('\r\n'), 'utf8')
if (outBuf.equals(CL_RAW)) {
  console.log('[gen-ev4-blocks] 无变化（幂等）：client.js 未改动')
  console.log('  bytes ' + bytesBefore + ' / sha16 ' + shaBefore)
  process.exit(0)
}
fs.writeFileSync(CLIENT, outBuf)
const shaAfter = sha16(fs.readFileSync(CLIENT))

// 尾部完整性断言
const finalText = fs.readFileSync(CLIENT, 'utf8')
const mustKeep = [
  "var STYLE_ID = 'dsh-auto-memory-css'",
  'function ensureStyle() {',
  'var EV4_CSS = [',
  INS_BEGIN, INS_END,
  'buildEv4IframeHtmlSafePre',
  'adaptStoreToPrototypePayload',
  'ev4PayloadSigPre',
  'EV4_PROTO_BODY_SHELL',
  'escapeScriptJsonPre',
]
const missing = mustKeep.filter((k) => finalText.indexOf(k) < 0)
if (missing.length) die('[gen-ev4-blocks] 尾部完整性断言失败，缺失：' + missing.join(' | '), 1)

// 行尾断言
const crlf = (finalText.match(/\r\n/g) || []).length
const lfAll = (finalText.match(/\n/g) || []).length
if (lfAll - crlf !== 0) die('[gen-ev4-blocks] 出现裸 LF：' + (lfAll - crlf), 1)

console.log('[gen-ev4-blocks] 已写入')
console.log('  生成块长度    ' + generated.length + ' 字符')
console.log('  bytes         ' + bytesBefore + ' → ' + outBuf.length + '（Δ +' + (outBuf.length - bytesBefore) + '）')
console.log('  sha16(bytes)  ' + shaBefore + ' → ' + shaAfter)
console.log('  CRLF ' + crlf + ' / bareLF 0')
console.log('  generated.js  ' + fs.statSync(GEN_OUT).size + ' B')

/**
 * v4-EV4-FREE-VARS · 组件函数体的「自由标识符」守门（2026-10-25 事故固化）
 *
 * ## 为什么必须有它（真实事故）
 *   S1 把 EventView 改成 iframe 时用了 `useMemo(...)`，但 **client.js 从来没有定义过 useMemo**
 *   （无 `var useMemo = React.useMemo` 别名、无本地 function）。
 *   ⇒ 用户点开白板页时抛 `ReferenceError: useMemo is not defined` ⇒ React 整棵树崩 ⇒ **插件闪退**。
 *
 * ## 为什么当时所有守卫全绿（「绿但假的」第 7 类：**未真渲染**）
 *   ① node --check              语法合法 —— 标识符存在性是运行期问题
 *   ② client-loadable 17/0      只执行 factory 顶层，**组件函数体不执行**
 *   ③ h4 245/0                  用 vm 抽取 EventView「真调用」，但沙箱里 React 桩**自带 useMemo**
 *                               ⇒ 它测的是沙箱的 React，不是 client.js 的闭包环境 ⇒ 恒绿
 *   ④ 真 Chrome s1-verify 6/0   跑的是「拼好的 iframe 单页」，**没经过宿主的 React 渲染**
 *   ⇒ 四条判据全部绕开了「组件在真实闭包环境下执行」这一环。
 *
 * ## 本套件测什么
 *   对指定组件函数体做**词法级自由标识符分析**：
 *     收集「裸调用」与「裸引用」的标识符 → 减去 JS 内置 → 减去 client.js 任意位置的声明 →
 *     减去函数自身参数/局部声明 ⇒ 剩余必须为空。
 *   ⇒ 不依赖任何运行时桩，**沙箱污染也不会让它失真**。
 *
 * ## 负路径（证明判据非恒真）
 *   往 EventView 里注入一句 `__nonexistentFn()__` ⇒ 必红。
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, '..', '..')
const SRC = readFileSync(path.join(ROOT, 'lib', 'client.js'), 'utf8')

let pass = 0, fail = 0
const ok = (c, m) => { if (c) { pass++; console.log('  ok   - ' + m) } else { fail++; console.log('  FAIL - ' + m) } }

/** 剥掉字符串与注释，只留可执行代码（防把文案里的词误判成标识符）。 */
function stripLiterals (src) {
  let out = '', i = 0; const n = src.length
  while (i < n) {
    const c = src[i], d = src[i + 1]
    if (c === '/' && d === '/') { while (i < n && src[i] !== '\n') i++; continue }
    if (c === '/' && d === '*') { i += 2; while (i < n && !(src[i] === '*' && src[i + 1] === '/')) i++; i += 2; continue }
    if (c === "'" || c === '"' || c === '`') {
      const q = c; i++
      while (i < n && src[i] !== q) { if (src[i] === '\\') i++; i++ }
      i++; out += ' '; continue
    }
    out += c; i++
  }
  return out
}

/** 取一个 4 空格缩进的顶层函数体（按花括号配平，不用行号）。 */
function fnBody (src, name) {
  const head = new RegExp('^    function ' + name + '\\s*\\(', 'm')
  const m = head.exec(src)
  if (!m) return null
  const ob = src.indexOf('{', m.index)
  if (ob < 0) return null
  let dep = 0
  for (let i = ob; i < src.length; i++) {
    const ch = src[i]
    if (ch === '{') dep++
    else if (ch === '}') { dep--; if (dep === 0) return src.slice(m.index, i + 1) }
  }
  return null
}

const JS_BUILTINS = new Set([
  'if','for','while','return','switch','catch','typeof','function','new','delete','void','do','else',
  'try','finally','throw','isFinite','isNaN','parseInt','parseFloat','encodeURIComponent',
  'decodeURIComponent','String','Number','Boolean','Array','Object','Math','JSON','Date','RegExp',
  'Error','Promise','Map','Set','Symbol','undefined','null','true','false','NaN','Infinity',
  'setTimeout','clearTimeout','setInterval','clearInterval','queueMicrotask',
  'requestAnimationFrame','cancelAnimationFrame','console','window','document','localStorage',
  'navigator','ResizeObserver','IntersectionObserver','performance','fetch','TextEncoder','TextDecoder',
])

/** 收集 client.js 里所有声明过的名字（任意位置）。 */
function declaredNames (src) {
  const s = new Set()
  for (const m of src.matchAll(/(?:^|\n)\s*(?:var|let|const|function)\s+([A-Za-z_$][\w$]*)/g)) s.add(m[1])
  for (const m of src.matchAll(/^\s*([A-Za-z_$][\w$]*)\s*(?=\()/gm)) s.add(m[1])
  return s
}

/** 分析一个函数体，返回「无定义的裸调用」与「无定义的裸引用」。 */
function freeNames (body, declared) {
  const code = stripLiterals(body)
  const local = new Set()
  for (const m of code.matchAll(/(?:var|let|const|function)\s+([A-Za-z_$][\w$]*)/g)) local.add(m[1])
  for (const m of code.matchAll(/function\s*\(([^)]*)\)/g)) {
    String(m[1]).split(',').forEach((x) => { const t = x.trim().split(/[=\s]/)[0]; if (/^[A-Za-z_$][\w$]*$/.test(t)) local.add(t) })
  }
  for (const m of code.matchAll(/\b(?:var|let|const)\s+([A-Za-z_$][\w$]*)\s*=/g)) local.add(m[1])
  const calls = new Set()
  for (const m of code.matchAll(/(?<![.\w$])([A-Za-z_$][\w$]*)\s*\(/g)) calls.add(m[1])
  const freeCalls = [...calls].filter((c) =>
    !JS_BUILTINS.has(c) && !declared.has(c) && !local.has(c) &&
    ['if','for','while','switch','catch','typeof','function','new','delete','void','do','else','try','finally','throw','return'].indexOf(c) < 0
  )
  return freeCalls
}

console.log('== 1. 定位组件 ==')
const targets = ['EventView']
const bodies = {}
const DECL = declaredNames(SRC)
for (const t of targets) {
  const b = fnBody(SRC, t)
  bodies[t] = b
  ok(!!b, '找到组件 ' + t + '（真配平取体，不用行号）')
  ok(!!b && b.length > 2000, t + ' 函数体 ≥2000 字符（实测 ' + (b ? b.length : 0) + '，防抽到空壳而恒绿）')
}

console.log('== 2. ★自由标识符必须为 0 ==')
for (const t of targets) {
  const b = bodies[t]
  if (!b) continue
  const free = freeNames(b, DECL)
  ok(free.length === 0, '★★★' + t + ' 体内无未定义裸调用（实测 ' + free.length + '：' + (free.join(', ') || '无') + '）')
  ok(free.indexOf('useMemo') < 0, '★★★负路径：useMemo 已定义（2026-10-25 闪退事故的根因）')
}

console.log('== 3. hook 别名完整性（防第二个 useMemo） ==')
const HOOKS = ['useState', 'useEffect', 'useReducer', 'useRef', 'useMemo', 'useCallback', 'useContext']
for (const hk of HOOKS) {
  const usedInFile = new RegExp('(?<![.\\w$])' + hk + '\\s*\\(').test(SRC)
  const aliased = new RegExp('var\\s+' + hk + '\\s*=\\s*React\\.' + hk).test(SRC)
  const localFn = new RegExp('function\\s+' + hk + '\\s*\\(').test(SRC)
  ok(!usedInFile || aliased || localFn,
    'hook ' + hk + ' 被用到则必须有别名或本地定义（用到=' + usedInFile + ' 别名=' + aliased + ' 本地=' + localFn + '）')
}

console.log('== 4. [负路径] 判据必须能捕到注入的未定义调用 ==')
const injected = bodies.EventView
if (injected) {
  // ★★2026-10-27 判据更新（锚点漂移 · 判据过期非产品缺陷）：
//   原锚点 `var ev4Sig = ev4PayloadSigPre(data)` 已随「evScope 作用到 iframe」修复改为
//   `var ev4Sig = ev4PayloadSigPre(ev4ScopedData) + '|scope=' + String(evScope)`。
//   本断言守的**不变量**没变（注入未定义调用后自由标识符扫描必须抓到），只是注入位置要跟着走。
//   ★负路径自检保留：mutated !== injected 仍断言「注入确实发生」，防止锚点再次漂移导致恒绿。
const INJECT_ANCHOR = "var ev4Sig = ev4PayloadSigPre(ev4ScopedData) + '|scope=' + String(evScope)"
const mutated = injected.replace(INJECT_ANCHOR, INJECT_ANCHOR + '; __deliberatelyUndefinedFn__(ev4Sig)')
  ok(mutated !== injected, '[负路径] 成功往 EventView 注入 __deliberatelyUndefinedFn__')
  const freeM = freeNames(mutated, DECL)
  ok(freeM.indexOf('__deliberatelyUndefinedFn__') >= 0, '★★★[负路径] 注入后必须被抓出（判据非恒真）—— 实测抓出：' + freeM.join(', '))
}

console.log('== 5. 回归：EventView 仍走 iframe ==')
ok(bodies.EventView && bodies.EventView.indexOf('data-dam-ev4-iframe') >= 0, 'EventView 仍渲染 iframe（未被修复动作改坏）')
ok(bodies.EventView && bodies.EventView.indexOf('useMemo(') >= 0, 'EventView 仍使用 useMemo（现在它有定义了）')

console.log('\n[v4-ev4-free-vars] PASS ' + pass + ' / FAIL ' + fail)
process.exit(fail ? 1 : 0)
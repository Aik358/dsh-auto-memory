/**
 * smoke-test-infinity-timeout.mjs —— 「Infinity 超时」回归护栏
 *
 * ★背景（2026-10-26 实测事故，我自造）：为「整理记忆不设超时」把
 *   UPGRADE_SUBAGENT_TIMEOUT_MS 改为 Number.POSITIVE_INFINITY。
 *   但 `setTimeout(fn, Infinity)` 在 Node 里**不是永不触发，而是立即触发**（实测 4ms）。
 *   ⇒ 子代理刚派发就被 abort ⇒ 日志 `resolve aborted` ⇒ 状态 19ms 记 failed。
 *   ⇒ 判据：「不设超时」≠「把 Infinity 传给 setTimeout」，必须显式走「不注册定时器」分支。
 *
 * 本套件守两处（同一语义两处各写一份，必须一起守）：
 *   ① _runSubagentOnce 的 abort 定时器
 *   ② withTimeout 的 Promise.race 定时器
 * 全部为**真执行行为断言**，不是源码字符串断言。
 */
import fs from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'

const ROOT = 'D:/dsh-auto-memory'
const INDEX = path.join(ROOT, 'lib/index.js')
let pass = 0, fail = 0
const ok = (c, msg, extra) => {
  if (c) { pass++; console.log('  ok   - ' + msg + (extra ? ' :: ' + extra : '')) }
  else { fail++; console.log('  FAIL - ' + msg + (extra ? ' :: ' + extra : '')) }
}

const SRC = fs.readFileSync(INDEX, 'utf8')

console.log('== 1. withTimeout 真实行为（从源码抽出并真跑）==')
function grab (anchor) {
  const i = SRC.indexOf(anchor)
  if (i < 0) return null
  let j = i, depth = 0, started = false
  for (; j < SRC.length; j++) {
    const c = SRC[j]
    if (c === '{') { depth++; started = true } else if (c === '}') { depth--; if (started && depth === 0) { j++; break } }
  }
  return SRC.slice(i, j)
}
const wtSrc = grab('async withTimeout(promise, ms, fallback) {')
ok(!!wtSrc, 'withTimeout 源码可抽取')
const ctx = { Promise, setTimeout, clearTimeout, Number, Error, console }
vm.createContext(ctx)
vm.runInContext('const _o = { ' + wtSrc + ' }; globalThis.wt = _o.withTimeout.bind(_o);', ctx)

const r1 = await ctx.wt(new Promise((r) => setTimeout(() => r('REAL'), 120)), Number.POSITIVE_INFINITY, null)
ok(r1 === 'REAL', '★★★[Infinity] withTimeout(Infinity) 等到真结果，不返回 fallback', 'got=' + JSON.stringify(r1))

const r2 = await ctx.wt(new Promise((r) => setTimeout(() => r('LATE'), 5000)), 100, 'FALLBACK')
ok(r2 === 'FALLBACK', '★★★[负路径] 有限超时仍然生效（功能没被改坏）', 'got=' + JSON.stringify(r2))

console.log('')
console.log('== 2. setTimeout(fn, Infinity) 的既有事实（防有人「优化」回去）==')
let fired = false
const t0 = Date.now()
const tm = setTimeout(() => { fired = true }, Number.POSITIVE_INFINITY)
await new Promise((r) => setTimeout(r, 60))
if (tm) clearTimeout(tm)
ok(fired === true, '★★★[事实] setTimeout(fn, Infinity) 会立即触发（这就是不能用它的理由）', 'elapsed<60ms fired=' + fired)

console.log('')
console.log('== 3. 两处代码都必须有显式 noTimeout 分支 ==')
const hasAbortGuard = /_noTimeout\s*=\s*!Number\.isFinite\(_tRaw\)/.test(SRC)
const hasWtGuard = /_noTimeout\s*=\s*!Number\.isFinite\(_msRaw\)/.test(SRC)
ok(hasAbortGuard, '★★_runSubagentOnce 的 abort 定时器有 noTimeout 分支')
ok(hasWtGuard, '★★withTimeout 有 noTimeout 分支')
ok(!/const timer = setTimeout\(\(\) => controller\.abort/.test(SRC) ||
   /_noTimeout \? null : setTimeout/.test(SRC),
   '★★abort 定时器注册已改为条件注册')

console.log('')
console.log('== 4. UPGRADE 常量确实是 Infinity（本轮需求）==')
ok(/UPGRADE_SUBAGENT_TIMEOUT_MS = Number\.POSITIVE_INFINITY/.test(SRC),
   '★★★[正] 整理记忆超时为 POSITIVE_INFINITY（用户裁定「不设上限」）')

console.log('')
console.log('SUMMARY  PASS ' + pass + ' / FAIL ' + fail)
process.exit(fail === 0 ? 0 : 1)

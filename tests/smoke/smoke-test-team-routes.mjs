#!/usr/bin/env node
/**
 * smoke-test-team-routes.mjs —— B11c 八条团队路由 ★**真执行产线 handler**（CR-10 最高档）。
 *
 * ★★本套件的核心方法（三级演进，全部是本轮实测逼出来的）：
 *   ① 手抄夹具 —— ✗ 不可靠：夹具与产线各自漂移，本轮真实漂移一次（产线补 `enabled`，夹具没跟），
 *      症状是「测试红，但红的是夹具不是代码」；
 *   ② 源码形状对照 —— ✗ 不够：只比键名抓不到值漂移（变异 M2 改 `reason` 字面量**没红**）；
 *      ★且抽取窗口会被内层 `},` 提前截断（实测窗口只有 920 字符，真 writeJson 根本没进窗口）；
 *   ③ **抽取产线 handler 源码 → `new Function` 真构造 → 真调用 → 断言真返回值** ← 本套件采用。
 *      ⇒ 断言对象是**产线代码的执行结果**，不是任何副本。
 *
 * 判据：
 *  - 八条路径必须真出现在 `mod.API`（真 import，不是正则抓文本）
 *  - 每条的 handler 真被调用，真返回 200 + 真 JSON
 *  - 非回环 ⇒ 真 403（负路径）
 *  - `teamEnabled=false` 时**照样 200**（前端据此渲染「未启用」而非误报「坏了」）
 *  - B 档 sync-now 未启用 ⇒ `{ok:false, reason:"team-disabled"}`（契约锁：前端依赖这两个值）
 */
import { readFileSync } from 'node:fs'

let pass = 0, fail = 0
const failures = []
function ok(cond, name, got) {
  if (cond) { pass++ } else { fail++; failures.push(name + (got === undefined ? '' : ' | got=' + JSON.stringify(got))) }
}

const ROUTES = [
  ['team-members', ['enabled', 'self', 'members', 'project']],
  ['team-presence', ['enabled', 'self', 'others', 'note']],
  ['team-attribution', ['enabled', 'actor', 'calendar', 'calendarInfo']],
  ['team-conflicts', ['enabled', 'policy', 'counts', 'conflicts']],
  ['team-sync-debug', ['enabled', 'identity', 'sync', 'outbox', 'board', 'derived', 'inject', 'transportError']],
  ['team-sync-now', ['enabled', 'ok', 'reason']],
  ['team-handoffs', ['enabled', 'pending', 'size']],
  ['team-skills', ['enabled', 'count', 'candidates']],
]

const camelOf = (name) => name.replace(/-(.)/g, (m, c) => c.toUpperCase())

/**
 * handlerSourceOf —— 从 lib/index.js 抽出某路由的 `handler: async (req, res) => { ... }` **源码文本**。
 * 用括号/引号感知扫描取配对 `}`（不用正则，避免被内层 `},` 截断——本轮已实测该坑）。
 */
function handlerSourceOf(idx, camel) {
  const start = idx.indexOf("path: API['" + camel + "'],")
  if (start < 0) return null
  const rest = idx.slice(start)
  const hs = rest.indexOf('handler: async (req, res) => {')
  if (hs < 0) return null
  const open = hs + "handler: async (req, res) => {".length - 1
  const scanned = scanBalanced(rest, open)
  // 剥掉 `handler: ` 前缀，只留 `async (req, res) => { ... }`（否则 new Function 报 Unexpected token ':'）
  return rest.slice(hs + 'handler: '.length, scanned.end + 1)
}

function scanBalanced(src, open) {
  let depth = 0, i = open, quote = null
  for (; i < src.length; i++) {
    const ch = src[i]
    if (quote) {
      if (ch === '\\') { i++; continue }
      if (ch === quote) quote = null
      continue
    }
    if (ch === "'" || ch === '"' || ch === '`') { quote = ch; continue }
    if (ch === '/' && src[i + 1] === '/') { while (i < src.length && src[i] !== '\n') i++; continue }
    if (ch === '{' || ch === '(' || ch === '[') depth++
    else if (ch === '}' || ch === ')' || ch === ']') { depth--; if (depth === 0) return { end: i } }
  }
  return { end: src.length }
}

/** fakeEngine —— 最小 engine 替身；**全部团队子系统为 null** ⇒ 走各 handler 的 fail-soft 分支。 */
function fakeEngine(over) {
  return Object.assign({
    config: { teamEnabled: false, teamConflictPolicy: "keep-both", teamMaxConflicts: 200, teamSyncTransport: "s3" },
    _teamIdentity: null, _teamProjectMap: null, _teamSync: null, _teamOutbox: null,
    _teamCalendar: null, _teamMerge: null, _teamBoard: null, _teamDerived: null,
    _teamInject: null, _teamTransport: null, _teamTransportError: null,
  }, over || {})
}

async function main() {
  const idx = readFileSync(new URL("../../lib/index.js", import.meta.url), "utf8")
  const mod = await import("../../lib/index.js")
  const API = mod.API || {}

  // ① 真 import 产线模块，取真 API 表（不是正则抓源码文本）
  ok(Object.keys(API).length === 65, '真 API 表 = 65 条（与计数锁一致）', Object.keys(API).length)
  for (const [name] of ROUTES) {
    const camel = camelOf(name)
    ok(!!API[camel], '真 API 表含 ' + camel, API[camel])
    ok(API[camel] === '/api/dsh-auto-memory/' + name, '真 API 表路径正确 ' + camel, API[camel])
  }

  // ② ★逐条抽取产线 handler 源码 → new Function 真构造 → 真调用
  for (const [name, expectKeys] of ROUTES) {
    const camel = camelOf(name)
    const src = handlerSourceOf(idx, camel)
    ok(typeof src === 'string' && src.length > 100, name + ' handler 箭头函数可抽取（长度 > 100）', src && src.length)
    let fn = null
    try { fn = new Function('engine', 'isLoopbackRequest', 'writeJson', 'API', 'return ' + src) }
    catch (e) { ok(false, name + ' handler 源码可构造', String(e && e.message)) }
    if (!fn) continue

    // ③ 正向：回环 + teamEnabled=false（最保守默认态）
    let cap = null
    const writeJson = (res, code, body) => { cap = { code, body } }
    await fn(fakeEngine(), () => true, writeJson, API)({}, {})
    ok(cap !== null, name + ' 真被调用并返回（writeJson 命中）')
    if (!cap) continue
    ok(cap.code === 200, name + ' ⇒ 200（未启用也返回 200）', cap.code)
    ok(cap.body && cap.body.enabled === false, name + ' ⇒ enabled:false', cap.body && cap.body.enabled)
    const liveKeys = Object.keys(cap.body || {})
    ok(JSON.stringify(liveKeys.slice().sort()) === JSON.stringify(expectKeys.slice().sort()),
      name + ' 真返回键集 == 期望键集', { live: liveKeys, expect: expectKeys })

    // ④ ★负路径：非回环 ⇒ 真 403，且**不落任何业务字段**
    let cap403 = null
    const wj403 = (res, code, body) => { cap403 = { code, body } }
    await fn(fakeEngine({ config: { teamEnabled: true } }), () => false, wj403, API)({}, {})
    ok(cap403 && cap403.code === 403, name + ' 非回环 ⇒ 403', cap403 && cap403.code)
    ok(cap403 && Object.keys(cap403.body).length === 1 && !!cap403.body.error,
      name + ' 403 体只含 error（不泄漏业务字段）', cap403 && Object.keys(cap403.body))
  }

  // ⑤ ★值级契约锁（前端依赖这两个**值**；只比键名抓不到）——
  //   变异 M2（把产线 `reason` 改成 'disabled'）在本轮**没被键名守卫抓到**，故必须有值断言。
  for (const [name, fn2] of ROUTES.map(([n]) => [n, null])) {
    const src = handlerSourceOf(idx, camelOf(name))
    const f = new Function('engine', 'isLoopbackRequest', 'writeJson', 'API', 'return ' + src)
    let c1 = null, c2 = null
    await f(fakeEngine(), () => true, (r, cd, b) => { c1 = b }, API)({}, {})
    await f(fakeEngine(), () => true, (r, cd, b) => { c2 = b }, API)({}, {})
    // ★确定性：同一 handler 连调两次，**键集与值都一致**（无隐藏状态）
    const k1 = JSON.stringify(c1, Object.keys(Object.assign({}, c1)).sort())
    const k2 = JSON.stringify(c2, Object.keys(Object.assign({}, c2)).sort())
    ok(k1 === k2, name + ' 两次调用结果一致（确定性）', { k1, k2 })
  }

  // ⑥ ★值级契约锁：sync-now 未启用 ⇒ 恰好这两个值（把产线 reason 改掉必红）
  const snSrc = handlerSourceOf(idx, "teamSyncNow")
  const snFn = new Function('engine', 'isLoopbackRequest', 'writeJson', 'API', 'return ' + snSrc)
  let sn = null
  await snFn(fakeEngine(), () => true, (r, c, b) => { sn = b }, API)({}, {})
  ok(sn && sn.ok === false, 'sync-now 未启用 ⇒ ok 恰为 false', sn && sn.ok)
  ok(sn && sn.reason === 'team-disabled', 'sync-now 未启用 ⇒ reason 恰为 "team-disabled"（值级契约锁）', sn && sn.reason)
  // ⑧ 回环守卫数 >= 路由数
  const guardCount = (idx.match(/isLoopbackRequest\(req\)/g) || []).length
  ok(guardCount >= 65, '回环守卫数 >= 65', guardCount)

  console.log('  team-routes 真执行: ' + pass + ' PASS / ' + fail + ' FAIL')
  if (fail > 0) {
    console.log('  失败项:')
    failures.forEach((f) => console.log('    ✗ ' + f))
    process.exit(1)
  }
}

main().catch((e) => {
  console.error('  ✗ 套件异常(非断言失败): ' + (e && e.message))
  console.error(e && e.stack)
  process.exit(1)
})

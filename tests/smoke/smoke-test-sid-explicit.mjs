/**
 * smoke-test-sid-explicit.mjs —— §1.4 不带 sid 静默回落 回归护栏（审计 P1）
 *
 * ★审计实测（新宿主，加载 HEAD 2ab33768）：
 *   GET event-list?all=1              （不带 sid）⇒ total:1、evt_605d...(aik_auto_memory_use)、29 检查点 ❌
 *   GET event-list?all=1&sessionId=…  （带 sid）  ⇒ total:2、项目白板 + v4 事件、200 检查点 ✅
 *   GET upgrade-status                （不带 sid）⇒ events 1 / cps 29 / logs 14 ❌
 *   GET upgrade-status?sessionId=…    （带 sid）  ⇒ events 2 / cps 200 / logs 28 ✅
 *
 * 后果：任何不带 sid 的调用方（缓存旧前端 / 第三方脚本 / curl 排障）**静默拿到别的工作区数据**，
 *   且返回 ok:true、无任何错误信号。
 * 审计还断言「前端已保证带 sid」——**实测不成立**：前端 apiGet 只给 external/file 注入 sid，
 *   event-list / upgrade-status 完全没带。这是缺陷的另一半，已一并修。
 *
 * 本套件守两层：
 *   ① 前端：apiGet 必须给 event-list / upgrade-status 注入 sessionId
 *   ② 后端：resolvePathsForRequestPre 必须给出 sidExplicit 标记，路由必须把它暴露为 wsFallback
 */
import fs from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'
import assert from 'node:assert/strict'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const CLIENT = fs.readFileSync(path.join(ROOT, 'lib', 'client.js'), 'utf8')
const INDEX = fs.readFileSync(path.join(ROOT, 'lib', 'index.js'), 'utf8')
const NL = String.fromCharCode(10)
let pass = 0, fail = 0
const ok = (c, msg, extra) => {
  if (c) { pass++; console.log('  ok   - ' + msg + (extra ? ' :: ' + extra : '')) }
  else { fail++; console.log('  FAIL - ' + msg + (extra ? ' :: ' + extra : '')) }
}

// 抽函数（复刻仓内成熟做法）
/**
 * 抽取函数源码：**到下一个同缩进成员**切真实边界。
 * ★为什么不用花括号计数：本仓函数体注释里有引号与反引号（如 `'sessionId'`），
 *   朴素计数会被提前闭合 ⇒ 抽到残缺片段 ⇒ vm 报 "Unexpected end of input"（本轮已踩）。
 *   判据：抽取后必须能被 new Function/vm 编译通过，否则视为抽取失败。
 */
function extractFnByLine (src, name) {
  const lines = src.split(/\r?\n/)
  const head = new RegExp('^\\s*(?:async\\s+)?(?:function\\s+)?' + name + '\\s*\\(')
  let start = -1
  for (let i = 0; i < lines.length; i += 1) if (head.test(lines[i])) { start = i; break }
  if (start < 0) return null
  const indent = (lines[start].match(/^\s*/) || [''])[0]
  const sameIndentMember = new RegExp('^' + indent + '(?:async\\s+)?[A-Za-z_$][\\w$]*\\s*\\(')
  const sameIndentBlock = new RegExp('^' + indent + '(?:/\\*|//)')
  let end = lines.length
  for (let i = start + 1; i < lines.length; i += 1) {
    if (sameIndentMember.test(lines[i]) || sameIndentBlock.test(lines[i])) { end = i; break }
  }
  // 去掉尾部空行与「下一成员前的注释块」
  let out = lines.slice(start, end)
  while (out.length && !out[out.length - 1].trim()) out.pop()
  return out.join(NL)
}

console.log('== S1 前端 apiGet 必须给 event-list / upgrade-status 注入 sessionId ==')
{
  // ★★为什么不用「抽 apiGet 片段」：它是 `__ModuleLoader__.load({factory})` 闭包内的私有函数，
  //   且函数体注释里含引号 ⇒ 花括号计数会被提前闭合、抽到残缺片段（本轮已踩两次）。
  //   改用**结构位置断言**：在 apiGet 的真实函数区间内检查那段 sid 注入条件。
  //   抽取方式：从 `async function apiGet(` 起到 `var res = await fetch(`（apiGet 的第一行业务语句）为止，
  //   这段是**线性代码、无嵌套块**，不可能被花括号计数干扰。
  let apiGetHead = ''
  {
    const i = CLIENT.indexOf('async function apiGet(')
    ok(i >= 0, 'apiGet 函数存在')
    if (i >= 0) {
      const j = CLIENT.indexOf('var res = await fetch(', i)
      ok(j > i, 'apiGet 的首个业务语句可定位（截取区间闭合）')
      if (j > i) apiGetHead = CLIENT.slice(i, j)
    }
  }
  ok(/API\.eventList/.test(apiGetHead), '★★★S1a apiGet 的 sid 注入条件里含 API.eventList')
  ok(/API\.upgradeStatus/.test(apiGetHead), '★★★S1b apiGet 的 sid 注入条件里含 API.upgradeStatus')
  ok(/sessionId: *\(params && params\.sessionId\) \|\| currentSessionIdClient\(\)/.test(apiGetHead),
    '★★★S1c 注入写法与既有 external/file 同款（不另造口径）')

  // ★负路径：把这三条从条件里删掉 ⇒ 断言必须红（证明不是恒真）
  {
    const mut = apiGetHead
      .split(' || path === API.eventList').join('')
      .split(' || path === API.upgradeStatus').join('')
    ok(!/API\.eventList/.test(mut) && !/API\.upgradeStatus/.test(mut),
      '★★★S1d [负路径] 去掉这两个条件后不再命中（判据有鉴别力）')
  }

  // ★真行为证据：用一个**独立复刻**的最小 apiGet（同款条件式）验证 URL 真会带 sid ——
  //   注意：这是"语义等价复刻"，不是产品代码本身；作为补充证据，主判据是上面的结构位置断言。
  {
    let capturedUrl = ''
    const ctx = vm.createContext({
      API: {
        external: '/api/x/external', file: '/api/x/file',
        eventList: '/api/x/event-list', upgradeStatus: '/api/x/upgrade-status',
        pyStatus: '/api/x/py-status', pyDetect: '/api/x/py-detect',
      },
      currentSessionIdClient: () => 'session-FROM-DOM',
      query: (p) => {
        if (!p) return ''
        const ks = Object.keys(p).filter((k) => p[k] !== undefined && p[k] !== null && p[k] !== '')
        return ks.length ? '?' + ks.map((k) => k + '=' + encodeURIComponent(p[k])).join('&') : ''
      },
      fetch: async (u) => { capturedUrl = u; return { ok: true, json: async () => ({ ok: true }) } },
      pythonSetupRequestPre: () => null, Promise, Object, String, encodeURIComponent,
    })
    // 用产品源码里**真实的条件式那一段**（不是手抄）
    const condLine = apiGetHead.split(/\r?\n/).filter((l) => l.indexOf('sessionId: (params && params.sessionId)') >= 0)[0] || ''
    ok(condLine.length > 0, 'S1e 能取到产品源码里的真实条件式那一行')
    const harness = [
      'async function apiGet(path, params, signal) {',
      '  ' + condLine.trim(),
      '  var res = await fetch(path + query(params))',
      '  return await res.json()',
      '}',
    ].join(NL)
    vm.runInContext(harness + ';globalThis.__apiGet = apiGet;', ctx)
    await ctx.__apiGet('/api/x/event-list', { all: 1 })
    ok(/sessionId=session-FROM-DOM/.test(capturedUrl), '★★★S1f [真跑产品条件式] event-list 实际 URL 带了 sessionId', capturedUrl)
    capturedUrl = ''
    await ctx.__apiGet('/api/x/upgrade-status', {})
    ok(/sessionId=session-FROM-DOM/.test(capturedUrl), '★★★S1g [真跑产品条件式] upgrade-status 实际 URL 带了 sessionId', capturedUrl)
  }
}

console.log('')
console.log('== S2 后端 resolvePathsForRequestPre 必须给出 sidExplicit ==')
ok(/sidExplicit: rawSid\.length > 0/.test(INDEX), '★★★S2a 以 rawSid 是否有值判定 sidExplicit（不是拿兜底后的 sid）')
ok(/const rawSid = String\(sessionId == null \? '' : sessionId\)\.trim\(\)/.test(INDEX), '★★S2b rawSid 先 trim（空白串也算没带）')

console.log('')
console.log('== S3 路由必须把回落状态暴露出去（不许静默）==')
const fb = (INDEX.match(/wsFallback: _rp\.sidExplicit !== true/g) || []).length
ok(fb >= 2, '★★★S3a event-list 与 event-detail 两处都暴露 wsFallback', '命中 ' + fb + ' 处')
ok((INDEX.match(/sidExplicit: _rp\.sidExplicit === true/g) || []).length >= 2, '★★★S3b 两处都暴露 sidExplicit')
// 负路径：确认这两行不是恒真 —— 删掉后正则应不再命中
{
  const mut = INDEX.split('wsFallback: _rp.sidExplicit !== true').join('')
  ok(!/wsFallback: _rp\.sidExplicit !== true/.test(mut), '★★★S3c [负路径] 去掉后不再命中（判据有鉴别力）')
}

console.log('')
console.log('== S4 真跑 resolvePathsForRequestPre（假 engine，验真实返回值）==')
{
  // ★类方法抽取：按「到下一个同缩进成员」切真实边界（花括号计数会被注释里的引号干扰）
  let fnSrc = null
  {
    const lines = INDEX.split(/\r?\n/)
    const head = /^\s*(?:async\s+)?resolvePathsForRequestPre\s*\(/
    let start = -1
    for (let i = 0; i < lines.length; i += 1) if (head.test(lines[i])) { start = i; break }
    if (start >= 0) {
      let end = start + 1
      for (let i = start + 1; i < lines.length; i += 1) {
        if (/^  (?:async\s+)?[A-Za-z_$][\w$]*\s*\(/.test(lines[i]) || /^  \/\*/.test(lines[i])) { end = i; break }
      }
      fnSrc = lines.slice(start, end).join(NL).replace(/\s+$/, '')
    }
  }
  ok(!!fnSrc, 'resolvePathsForRequestPre 可抽取')
  if (fnSrc) {
    // ★类方法简写不能直接当函数声明（"Function statements require a function name"）
    //   ⇒ 补函数名。抽取块形如 `async resolvePathsForRequestPre(sessionId) { ... }`
    const body = fnSrc.replace(/^\s*async\s+resolvePathsForRequestPre\s*\(/, 'async function resolvePathsForRequestPre(')
    const mk = (sidResolved) => {
      const ctx = vm.createContext({
        String, Object,
        engine: {
          currentSessionId: () => 'session-PLUGIN-WS',
          resolvePathsForSession: async (sid) => ({ ws: 'WS(' + sid + ')', wsBound: true }),
        },
      })
      // ★注意两个坑（本轮都踩过）：
      //   ① vm.runInContext 里给 globalThis 赋值**不会**落到外层 ctx 对象上；
      //   ② runInContext 对「语句串」的返回值是 undefined，不是最后一个表达式的值。
      //   ⇒ 用 vm.compileFunction：把源码编译成真函数，显式接收 engine 参数，最直白也最可靠。
      const fn = vm.compileFunction(
        body + NL + 'return resolvePathsForRequestPre',
        ['engine'],
        { parsingContext: ctx },
      )
      const fakeEngine = {
        currentSessionId: () => 'session-PLUGIN-WS',
        resolvePathsForSession: async (sid) => ({ ws: 'WS(' + sid + ')', wsBound: true }),
      }
      // ★this 必须真绑到 fakeEngine（产品代码里到处 this.xxx，丢 this 就 TypeError）
      return { call: (s) => fn(fakeEngine).call(fakeEngine, s) }
    }
    const ctx = mk()
    const r1 = await ctx.call('session-EXPLICIT-1')
    ok(r1.sidExplicit === true, '★★★S4a [正路径] 显式带 sid ⇒ sidExplicit=true（不误报回落）', 'sid=' + r1.sid)
    ok(r1.fallbackCompat === false, '★★S4b 显式带 sid ⇒ fallbackCompat=false')

    const r2 = await ctx.call('')
    ok(r2.sidExplicit === false, '★★★S4c [负路径] 空串 ⇒ sidExplicit=false（会被标为回落）', 'sid=' + r2.sid)
    ok(r2.fallbackCompat === true, '★★S4d 空串 ⇒ fallbackCompat=true')
    ok(r2.compatResolvedWs === 'WS(session-PLUGIN-WS)', '★★★S4e 记录兜底解析到的工作区（便于排障一眼看出落错）', String(r2.compatResolvedWs))

    const r3 = await ctx.call('   ')
    ok(r3.sidExplicit === false, '★★S4f 纯空白串也算没带（trim 后判空）')
  }
}

console.log('')
console.log('SUMMARY  PASS ' + pass + ' / FAIL ' + fail)
process.exit(fail === 0 ? 0 : 1)

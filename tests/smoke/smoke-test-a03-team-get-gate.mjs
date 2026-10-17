#!/usr/bin/env node
/**
 * smoke-test-a03-team-get-gate.mjs —— #423（A03）团队 viewer 的 GET 下行被写权限门阻断。
 *
 * ## 缺陷（改前实测）
 * 团队初始化把 `_teamFetch` 包成 `gatedFetch`，而包装体**无条件**
 * `_assertTeamActionPre('write-own-memory')`。团队下行读取（pull 的 fetchJson，
 * `engine._teamFetch(p, { method: 'GET' })`）走的正是这个出口 ⇒ viewer（有 read-team、
 * 无写权）在出口前就 throw，**底层 fetch 一次都没被调用**，下行永不完成。
 * 权限矩阵本身没问题（team-identity.js 的 ACTIONS_READ = ['read-team']），缺的只是
 * 包装层的**动作选择**。
 *
 * ## 验收方式（真执行，不是源码字符串断言）
 * 从 `lib/index.js` 抽出**产线**的 gatedFetch 包装段（自包含：只用 `engine._teamFetch`
 * 与 `engine._assertTeamActionPre`，无其它自由变量），用 `new Function` 真构造实例，
 * 然后**真 await 调用**包装后的 fetch，断言「抛不抛」与「底层被调用几次」。
 * 权限判据用**真模块** `assertTeamActionPre`（不复制、不打桩），喂真实角色配置。
 *
 * ## 判据
 *  正路径：viewer + GET ⇒ 不抛，且底层 mock fetch 被调用 **1** 次（改前：team-forbidden、0 次）
 *  负路径：① viewer + POST ⇒ code==='team-forbidden' 且底层调用 **0** 次（上传仍拒）
 *          ② teamEnabled=false ⇒ GET/POST 均放行（个人用户零感知）
 *          ③ method 缺省 ⇒ 按 GET 处理（下行调用点就是省略 method 的形态）
 *          ④ editor / administrator ⇒ 两动词均放行
 *          ⑤ 属性面（dispose/describe/readToken）包装后仍可读（R1 回归不破）
 *
 * ## 变异负路径（自带）
 *  把产线的动作选择改回恒 'write-own-memory'（忠实回退到修复前语义）⇒ 正路径必红。
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, '..', '..')
const SRC = readFileSync(path.join(ROOT, 'lib', 'index.js'), 'utf8')

let pass = 0, fail = 0
const ok = (c, n, x) => { if (c) { pass++; console.log('  ok - ' + n) } else { fail++; console.error('  FAIL - ' + n + (x == null ? '' : ' << ' + x)) } }

// ── 精确抽取产线 gatedFetch 包装段（纯内容锚点，不靠行号；含外层 try/catch）──
function extractGateBlock(src) {
  const marker = '        const rawFetch = engine._teamFetch'
  const a = src.indexOf(marker)
  if (a < 0) throw new Error('gatedFetch 抽取锚点缺失（产线形态已变，需复核抽取器）')
  // 起点回退到同缩进的 try {
  const tryAt = src.lastIndexOf('      try {', a)
  if (tryAt < 0) throw new Error('包装段外层 try 未找到')
  const endMarker = '      } catch (_) {}'
  const b = src.indexOf(endMarker, a)
  if (b < 0) throw new Error('包装段外层 catch 未找到')
  return src.slice(tryAt, b + endMarker.length)
}
const GATE_BLOCK = extractGateBlock(SRC)
const GATE_ANCHOR = "engine._assertTeamActionPre(gatedMethod === 'GET' ? 'read-team' : 'write-own-memory')"
// ★修复是否在场：不在场时**不 throw**，而是让 A03-1 的断言自然变红 ——
//   这样「回退生产代码」的实验能给出明确的 FAIL 计数（变异必红要有可复算的物理量），
//   而不是一个加载期异常（无法区分「判据有鉴别力」与「套件自身崩了」）。
const FIX_PRESENT = GATE_BLOCK.indexOf(GATE_ANCHOR) >= 0

// ── 真权限判据：真 import（不复制、不打桩）──
const { assertTeamActionPre } = await import(new URL('../../lib/team-policy.js', import.meta.url).href)

/** 真构造：注入真 _assertTeamActionPre + 探针 fetch。 */
function boot(mutate) {
  let realFetchCalls = 0
  const probe = async () => { realFetchCalls += 1; return { ok: true } }
  probe.dispose = () => 'disposed'
  probe.describe = () => ({ configured: true })
  probe.readToken = async () => 'token'
  const engine = {
    config: null,
    _assertTeamActionPre(action, durable) { return assertTeamActionPre(durable === undefined ? this.config : durable, action) },
    _teamFetch: probe,
  }
  const body = mutate
    ? GATE_BLOCK.replace(GATE_ANCHOR, "engine._assertTeamActionPre('write-own-memory')")
    : GATE_BLOCK
  if (mutate && body === GATE_BLOCK) throw new Error('变异锚点未命中：' + GATE_ANCHOR)
  // 产线片段以 try 开头、以 catch 收尾 ⇒ 包进函数体后 return 包装结果
  new Function('engine', body + '\nreturn engine._teamFetch')(engine)
  return { engine, calls: () => realFetchCalls, gated: engine._teamFetch }
}

const TEAM = (role) => ({ teamEnabled: true, teamMemberId: 'u1', teamMemberRole: role, teamId: 't1', teamServerUrl: 'https://example.invalid' })
function withConfig(b, cfg) { b.engine.config = cfg; return b }

console.log('[A03-1] 正路径：viewer + GET ⇒ 放行（改前被写权门拦住）')
{
  const b = withConfig(boot(false), TEAM('viewer'))
  let err = null, res = null
  try { res = await b.gated('https://example.invalid/v1/changes?since=0', { method: 'GET' }) } catch (e) { err = e }
  ok(!err, 'A03-1a ★ viewer 的 GET 不抛（改前抛 team-forbidden）', err && (err.code || err.message))
  ok(b.calls() === 1, 'A03-1b ★ 底层 fetch 恰被调用 1 次（改前 0 次）', 'calls=' + b.calls())
  ok(res && res.ok === true, 'A03-1c 拿到底层结果（下行真的有响应）', JSON.stringify(res && res.ok))
}

console.log('[A03-2] 负路径①：viewer + POST ⇒ 仍被拒，且**根本没发出去**')
{
  const b = withConfig(boot(false), TEAM('viewer'))
  let err = null
  try { await b.gated('https://example.invalid/v1/changes', { method: 'POST' }) } catch (e) { err = e }
  ok(!!err && err.code === 'team-forbidden', 'A03-2a ★ viewer 的 POST ⇒ team-forbidden（写权门未放松）', err && (err.code || err.message))
  ok(b.calls() === 0, 'A03-2b ★ 被拒时底层 fetch 调用数为 0（不是发出去被服务端拒）', 'calls=' + b.calls())
}

console.log('[A03-3] 负路径②：teamEnabled=false ⇒ 两动词均放行（个人用户零感知）')
{
  const cfg = TEAM('viewer'); cfg.teamEnabled = false
  const b = withConfig(boot(false), cfg)
  let e1 = null, e2 = null
  try { await b.gated('https://x/1', { method: 'GET' }) } catch (e) { e1 = e }
  try { await b.gated('https://x/2', { method: 'POST' }) } catch (e) { e2 = e }
  ok(!e1 && !e2, 'A03-3a ★ 团队关闭时 GET/POST 均放行', JSON.stringify([e1 && e1.code, e2 && e2.code]))
  ok(b.calls() === 2, 'A03-3b 两次都真的发到下层', 'calls=' + b.calls())
}

console.log('[A03-4] 负路径③：method 缺省 ⇒ 按 GET 处理（下行调用点的真实形态）')
{
  const b = withConfig(boot(false), TEAM('viewer'))
  let err = null
  try { await b.gated('https://example.invalid/v1/changes') } catch (e) { err = e }
  ok(!err, 'A03-4a ★ 省略 method 时按 GET 放行（下行调用不传 method）', err && (err.code || err.message))
  ok(b.calls() === 1, 'A03-4b 底层被调用 1 次', 'calls=' + b.calls())
}

console.log('[A03-5] 负路径④：editor / administrator 两动词均放行')
{
  for (const role of ['editor', 'administrator']) {
    const b = withConfig(boot(false), TEAM(role))
    let e1 = null, e2 = null
    try { await b.gated('https://x/g', { method: 'GET' }) } catch (e) { e1 = e }
    try { await b.gated('https://x/p', { method: 'POST' }) } catch (e) { e2 = e }
    ok(!e1 && !e2, 'A03-5 ★ ' + role + ' 的 GET/POST 均放行', JSON.stringify([e1 && e1.code, e2 && e2.code]))
    ok(b.calls() === 2, 'A03-5 ' + role + ' 两次都发到下层', 'calls=' + b.calls())
  }
}

console.log('[A03-6] 负路径⑤：包装体保留属性面（R1 回归不破）')
{
  const b = withConfig(boot(false), TEAM('viewer'))
  const attrs = ['dispose', 'describe', 'readToken'].filter((k) => typeof b.gated[k] === 'function')
  ok(attrs.length === 3, 'A03-6a 包装后 dispose/describe/readToken 三属性仍可用', JSON.stringify(attrs))
  ok(b.gated.describe().configured === true, 'A03-6b describe 仍指向原实现（闭包同一份）')
}

console.log('[A03-MUT] 变异负路径：动作选择回退成恒写权 ⇒ 正路径必须变红')
if (!FIX_PRESENT) {
  // 生产代码已回退（即本套件正被用于「变异必红」实验）：A03-1 已经直接证明了红。
  ok(true, 'A03-MUT 修复不在场 ⇒ 由 A03-1/A03-4/A03-5 直接给出红（无需二次变异）')
} else {
  const b = withConfig(boot(true), TEAM('viewer'))
  let err = null
  try { await b.gated('https://example.invalid/v1/changes', { method: 'GET' }) } catch (e) { err = e }
  ok(!!err && err.code === 'team-forbidden', 'A03-MUTa ★ 退回缺陷语义后 viewer 的 GET 被拒（证明判据有鉴别力）', err && (err.code || err.message))
  ok(b.calls() === 0, 'A03-MUTb ★ 退回后底层 fetch 调用 0 次（缺陷复现的物理量）', 'calls=' + b.calls())
}

console.log('\nPASS ' + pass + ' / FAIL ' + fail)
if (fail) process.exit(1)

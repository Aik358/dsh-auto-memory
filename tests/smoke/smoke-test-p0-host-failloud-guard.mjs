/**
 * 2026-11-02 守卫 —— 后台浮空 Promise 不得让宿主 fail-loud 自杀。
 *
 * ── 被守卫的缺陷（真机事故，桌面端起不来）──
 * 桌面壳报的错是「cannot create effect on inactive context」（dsh-desktop-host main() 在
 * 已 dispose 的 ctx 上 installDesktopUpdateTaskControl），与真实原因完全无关。真因链条是：
 *   ① dsh 0.2.1-rc.5 的 profile-boot 装了 **fail-loud**：任何 unhandledRejection 会立刻
 *      dispose 整棵插件树并 process.exit(1)（app-boot 的 installFailLoud）；
 *   ② 本插件有若干**裸 `void (async …)()` / `void engine.xxx()`** 调用点没有 catch
 *      （hub 喂数批、5 分钟重试、15 秒心跳里的五个后台任务）；
 *   ③ 于是任何一次后台失败（本例：facts.json 被截断成 102MB + 写盘失败）都被升级成
 *      「宿主自杀」，用户看到的是壳里一句无关的 Cordis 报错。
 *
 * ── 本套件怎么守 ──
 * ① 静态：上面那几个调用点必须带 catch（回归到裸 void 立刻变红）；
 * ② 行为：把「后台任务抛错」真的跑一遍，断言它**不再产生 unhandledRejection**
 *    （用 process 事件计数，与宿主 fail-loud 的判定口径一致）；
 * ③ 口径：失败必须留痕（diag），不得静默吞掉 —— 这是本仓既有的「失败不静默」纪律。
 */

import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, '..', '..')
const INDEX = readFileSync(path.join(ROOT, 'lib', 'index.js'), 'utf8')

let pass = 0, fail = 0
const ok = (cond, msg) => { if (cond) { pass++; console.log('  ✓ ' + msg) } else { fail++; console.log('  ✗ FAIL: ' + msg) } }

// ── ① 静态：那些调用点必须带 catch ──────────────────────────────────────────
// 判据取「调用点 + 紧跟其后的 catch」，而不是全文搜 catch 字样（否则别处的 catch 会给出假绿）。

/** 取某行号起的一段源码（便于断言「该语句自己带了 catch」）。 */
const lineAt = (needle, span = 12) => {
  const i = INDEX.indexOf(needle)
  if (i < 0) return null
  return INDEX.slice(i, i + span * 200)
}

// hub 喂数批：void (async …)().catch(…)
{
  const seg = lineAt('// 异步富化+喂送(不阻塞 tick);单行失败静默', 40)
  ok(seg !== null, 'hub 喂数批的锚点注释仍在（定位失败说明代码被大改，需重新核对本守卫）')
  if (seg) {
    ok(/void \(async \(\) => \{/.test(seg), 'hub 喂数批仍是浮空 async IIFE（若已改成 await 链，请同步更新本守卫）')
    ok(/\}\)\(\)\.catch\(/.test(seg), '★hub 喂数批的浮空 async **自带 .catch**（裸 `void (async…)()` 会让宿主 fail-loud 自杀）')
    ok(/hub feed: 批处理异常/.test(seg), '★喂数批失败必须留痕（diag），不得静默')
  }
}

// 5 分钟重试里的 consolidateTurn
{
  const seg = lineAt("void engine.withAgent(item.agent, () => engine.consolidateTurn(item.turn, item.agent))", 8)
  ok(seg !== null, '定时重试里的 consolidateTurn 调用点仍在')
  if (seg) {
    ok(/\)\.catch\(/.test(seg), '★定时重试的 consolidateTurn **自带 .catch**')
    ok(/retry consolidate: 异常/.test(seg), '★定时重试失败必须留痕')
  }
}

// 15 秒心跳：五个后台任务
{
  const i = INDEX.indexOf('heartbeatTimer = setInterval(')
  ok(i > 0, '心跳计时器仍在')
  if (i > 0) {
    const seg = INDEX.slice(i, i + 1600)
    ok(!/void writeHeartbeat\(\)/.test(seg), '★心跳里不再有裸 `void writeHeartbeat()`')
    ok(!/try \{ void engine\.(subagentGcSweep|tickAutoContinue|sessionArchiveSweep|_wbRotateTick)/.test(seg), '★心跳里不再有 `try { void engine.xxx() }`（同步 try 抓不到 async 拒绝）')
    ok(/bgGuard\('heartbeat'/.test(seg), '★心跳走 bgGuard 收口')
    ok(/bgGuard\('subagent gc'/.test(seg) && /bgGuard\('auto continue'/.test(seg) && /bgGuard\('session archive'/.test(seg) && /bgGuard\('wb rotate'/.test(seg),
      '★心跳的四个 engine 后台任务全部走 bgGuard')
  }
  const j = INDEX.indexOf('void writeHeartbeat() // 立即心跳一次')
  ok(j < 0, '★启动时的立即心跳也不再是裸 void')
}

// 热路径注入刷新：每轮对话都会走到
{
  // 只认「代码行」而非注释/已链式 .catch 的形态：注释里出现的同名字样不算缺陷
  // （:9715 的注释与 refreshAll 那条自带 .catch 的链都不是裸 void）。
  const lines = INDEX.split('\n')
  const bareVoidRefresh = []
  lines.forEach((line, idx) => {
    const t = line.trim()
    if (t.startsWith('//') || t.startsWith('*')) return                 // 注释
    if (!/void engine\.refresh\(agent\)/.test(t)) return
    if (/\.catch\(/.test(t) || /engineBg\(/.test(t)) return             // 同一行已带兜底
    // 跨行的链式 .catch 也算兜底：向后看 25 行内是否出现 .catch(
    const tail = lines.slice(idx + 1, idx + 26).join('\n')
    if (/\.catch\(/.test(tail)) return
    bareVoidRefresh.push(t)
  })
  ok(bareVoidRefresh.length === 0, '★注入热路径没有裸 `void engine.refresh(agent)`（refresh 返回的串行链没有自带兜底）' +
    (bareVoidRefresh.length ? ' 实得: ' + JSON.stringify(bareVoidRefresh) : ''))
  ok(INDEX.includes("engineBg(engine, 'inject refresh', engine.refresh(agent))"), '★注入热路径的 refresh 走 engineBg 收口')
}

// turn-stopping 的水位测量：外层 try 抓不到异步拒绝
{
  ok(!/try \{ void engine\.checkWaterLevel\(agent\)\.then\(function/.test(INDEX),
    '★turn-stopping 不再用 `try { void … .then() }` 假兜底（同步 try 抓不到异步拒绝）')
  ok(/engineBg\(engine, 'turn-stopping water level'/.test(INDEX), '★turn-stopping 的水位测量走 engineBg 收口')
}

// 启动期的一次性后台动作
{
  ok(!/^\s*void engine\.checkUpdate\(false\)/m.test(INDEX), '★checkUpdate 不再是裸 void')
  ok(/engineBg\(engine, 'check update'/.test(INDEX), '★checkUpdate 走 engineBg 收口')
  ok(!/void this\.external\.discover\(true\)/.test(INDEX), '★external.discover 不再是裸 void')
  ok(/engineBg\(this, 'external discover'/.test(INDEX), '★external.discover 走 engineBg 收口')
}

// engineBg 自身必须存在且带「不外抛 + 留痕」两条性质
{
  ok(/function engineBg\(engine, label, p\)/.test(INDEX), '★engineBg 收口函数存在')
  const i = INDEX.indexOf('function engineBg(engine, label, p)')
  const seg = INDEX.slice(i, i + 1400)
  ok(/r\.catch\(note\)/.test(seg), '★engineBg 给 Promise 挂了 catch')
  ok(/catch \(e\) \{ note\(e\) \}/.test(seg), '★engineBg 对同步抛出也留痕（空 catch 是本仓禁止的吞错形状）')
  ok(/已降级/.test(seg), '★engineBg 的诊断文案标明「已降级」')
}

// ── ② 行为：后台任务抛错不得产生 unhandledRejection ────────────────────────
// 复刻 index.js 里的 bgGuard 形状，而不是 import 整个插件（后者需要宿主 ctx）。
// 口径与宿主一致：Node 在微任务末尾结算未处理的拒绝 → 这里让事件循环空转两轮再判定。
{
  const unhandled = []
  const onUnhandled = (reason) => unhandled.push(reason)
  process.on('unhandledRejection', onUnhandled)

  const diagLines = []
  const diag = (m) => diagLines.push(String(m))
  // 与 index.js 里的 bgGuard 逐字同形（含「自身 try/catch 也必须留痕」那一版）。
  const bgGuard = (label, p) => {
    const note = (e) => { try { diag(label + ': 异常（已降级）—— ' + String((e && e.message) || e)) } catch (_) {} }
    try { const r = p && typeof p.catch === 'function' ? p : Promise.resolve(p); r.catch(note) } catch (e) { note(e) }
  }

  // 三种真实会出现的失败形态（async 函数体里的 throw 一律变成拒绝，不会同步抛出）
  bgGuard('heartbeat', Promise.reject(new Error('EACCES write heartbeat')))
  bgGuard('subagent gc', (async () => { throw new Error('gc boom') })())
  bgGuard('auto continue', (async () => { await Promise.resolve(); throw new Error('late boom') })())
  // 非 Promise 返回值也必须被容忍（旧实现里 tickTime 这类同步调用混在同一行）
  bgGuard('non-promise', 42)
  // bgGuard 自身的 try/catch 兜底：有 then 但 .catch 一调就抛的病态 thenable
  bgGuard('hostile thenable', { then() { throw new Error('hostile') }, catch() { throw new Error('hostile catch') } })

  await new Promise((r) => setTimeout(r, 60))
  process.off('unhandledRejection', onUnhandled)

  ok(unhandled.length === 0, '★五种后台失败形态**都没有**产生 unhandledRejection（宿主 fail-loud 的触发条件）')
  ok(diagLines.length === 4, '★三次拒绝 + 一次病态 thenable 全部留痕（diag 4 行，实得 ' + diagLines.length + '）')
  ok(diagLines.every((l) => /已降级/.test(l)), '★留痕文案标明「已降级」（读日志的人能立刻判断影响面）')
}

// 反证：裸 void 的同一形态**必须**产生 unhandledRejection —— 否则上面那组断言没有鉴别力。
{
  const unhandled = []
  const onUnhandled = (reason) => unhandled.push(reason)
  process.on('unhandledRejection', onUnhandled)
  void Promise.reject(new Error('bare void control'))
  await new Promise((r) => setTimeout(r, 60))
  process.off('unhandledRejection', onUnhandled)
  ok(unhandled.length === 1, '★反证：裸 void 的拒绝确实会被记为 unhandled（说明本守卫有鉴别力）')
}

console.log(`\n[hub-feed-crash-guard] pass=${pass} fail=${fail}`)
if (fail > 0) process.exitCode = 1

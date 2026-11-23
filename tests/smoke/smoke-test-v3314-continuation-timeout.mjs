/**
 * v3.3.14 回归锁 —— 接续刷新仪式超时可配 + 默认值抬高。
 *
 * ## 背景（2026-10-21 社群反馈，用户 6 tok/s 本地模型）
 * 本地/慢速模型在默认 90 秒内跑不完刷新仪式，且**单次 probe 上限写死 30 秒**
 * （lib/index.js 的 Math.min(30000, ...)）⇒ 用户翻遍设置页也找不到可调项。
 * 本批：①总超时默认 90 → 120 秒并开放到设置页；②probe 上限 30 → 60 秒并开放到设置页。
 *
 * ## 本套件钉住的判据（全部真执行，无一条靠读源码字符串）
 *   A. 真构造 MemoryEngine，读 engine.config 的两个默认值 = 120 / 60；
 *   B. 真跑 hostRefreshRitual（注入永不 resolve 的 inspect），断言按时 fail-soft 而非挂死；
 *   C. probe 上限真的受配置驱动：同一逻辑两种配置 ⇒ 两种显著不同耗时；
 *   D. 越界配置回落默认（负路径）；probe 与总超时取 min 的关系成立。
 *
 * ## ★2026-11-07（alpha.7 P4 · task-21）：B/C/D 改可控时钟，单跑 161.3s → 3~4s
 *   原实现靠真实等待（B 10s + C 10/20s + D 15/10s + D7 60s = 65s 纯等待），加上变异子进程
 *   实测 161,333ms，占全量回归墙钟 100%。改成「假 Date.now / setTimeout / clearTimeout」后，
 *   被测函数（hostRefreshRitual / continuationProbePre）一字未改，probe 仍真超时、Promise.race
 *   仍真决胜，只是时间由夹具推进 ⇒ 全套 B/C/D 假墙钟 85,499ms、真实墙钟 ≈0.2s、
 *   probe-task21-fakeclock.mjs 12/12 通过（先例：issue482 家族的固定时钟）。所有原有断言一条未删；另加 4 类「请求毫秒数」断言，
 *   使区分力不再依赖任何时间推进（M1/M3 靠它变红）。
 *
 * 运行：node tests/smoke/smoke-test-v3314-continuation-timeout.mjs
 */
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { MemoryEngine, apply } from '../lib/audit-engine.mjs'
const IDX_PATH = new URL('../../lib/index.js', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')

let pass = 0, fail = 0
const ok = (c, n, extra) => {
  if (c) { pass++; console.log('  ok - ' + n) }
  else { fail++; console.error('  FAIL - ' + n + (extra === undefined ? '' : ' :: ' + JSON.stringify(extra))) }
}

/** 整套件墙钟起点（报告用：验收要求单跑 < 30s）。 */
const SUITE_T0 = Date.now()

/**
 * ★2026-11-07（alpha.7 P4 · task-21）：**可控时钟**（判据不变，只换时间来源）。
 *
 * 背景：B/C/D 四组靠真实等待证明超时行为（10+10+20+15+10 = 65s），加上两轮变异子进程，
 * 单跑实测 161.3s，占全量回归墙钟 100%。其中约 59.5s 纯粹花在「等 probe 超时」上，
 * 而超时判据本身不依赖真实秒数 —— 它依赖的是「定时器被请求了多少毫秒」与「哪个定时器先决胜」。
 *
 * 做法：只替换本进程的 Date.now / setTimeout / clearTimeout，**被测代码一字未改**：
 *   hostRefreshRitual 与 continuationProbePre 照常真跑，probe 照常真超时，
 *   Promise.race 照常真决胜；差别只在「时间由本夹具推进」。
 *
 * ★三个必须照做的坑（实测踩过，probe-task21-fakeclock.mjs 已复现）：
 *   ① 返回句柄必须带 unref/ref/hasRef/refresh —— undici 会调 `fastNowTimeout?.unref()`，
 *      缺了它抛 TypeError，被插件 uncaughtException 吞掉后自激 12 次、进程挂死。
 *   ② 定时器先入 pending、**晚一个宏任务**才触发（真实 setTimeout(0)；不用 setImmediate 的原因
 *      见函数体内注释）—— 否则 Promise.race 的败者来不及被 clearTimeout 摘掉，
 *      一轮会多推进一个 delay（假时钟读数失真）。
 *   ③ 每轮开跑前 reset() 清 pending 与 reqs，避免上一轮残留计时器串进下一轮。
 */
function installFakeClock() {
  const realNow = Date.now
  const realTimeout = globalThis.setTimeout
  const realClear = globalThis.clearTimeout
  // ★必须用**真实 setTimeout(0)** 让假定时器落地，不能用 setImmediate：
  //   Windows 上 setImmediate 走 libuv 的 async 句柄，进程退出时若仍有排队的 immediate，
  //   会命中 `Assertion failed: !(handle->flags & UV_HANDLE_CLOSING), src\win\async.c:94`
  //   （实测 3 次 M3 子进程跑出 2 次 status=3221226505=0xC0000409，把「变异必红」判据打成假红）。
  //   真实 timer 不占 async 句柄，进程退出时由 libuv 正常收尾；微任务先于下一个 timer 清空的
  //   语义与 setImmediate 完全一致（Promise.race 的败者仍来得及被 clearTimeout 摘掉）。
  const realTick = (fn) => realTimeout(fn, 0)
  let now = realNow()
  let seq = 1
  let dropped = 0
  const pending = new Map()
  let requested = []
  const handle = (id) => ({
    unref() { return this }, ref() { return this }, hasRef() { return false },
    refresh() { return this }, close() { return this },
    [Symbol.toPrimitive]() { return id },
  })
  globalThis.setTimeout = (cb, ms, ...args) => {
    const id = seq++
    if (typeof cb !== 'function') return handle(id)   // 字符串回调早已废弃，不模拟
    const delay = Math.max(0, Number(ms) || 0)
    requested.push(delay)
    pending.set(id, { cb, args, delay })
    realTick(() => {
      const e = pending.get(id)
      if (!e) return                       // 已被 clearTimeout 摘掉 ⇒ 不推进时间
      pending.delete(id)
      now += e.delay
      try { e.cb(...e.args) } catch (e2) { dropped++; realTimeout(() => { throw e2 }, 0) }
    })
    return handle(id)
  }
  globalThis.clearTimeout = (id) => { try { pending.delete(Number(id)) } catch (e) {} }
  Date.now = () => now
  return {
    reset() { pending.clear(); requested = [] },
    get requested() { return requested.slice() },
    get dropped() { return dropped },
    restore() {
      Date.now = realNow
      globalThis.setTimeout = realTimeout
      globalThis.clearTimeout = realClear
      pending.clear()
    },
  }
}

// ══════════ 夹具：真构造一个 engine（走真实 DEFAULT_CONFIG 合并路径）══════════
const root = await fs.mkdtemp(path.join(os.tmpdir(), 'dam-v3314-'))
const prev = { home: process.env.DSH_HOME, interval: globalThis.setInterval, timeout: globalThis.setTimeout, load: MemoryEngine.prototype.loadConfigSync }
let engine = null
/** 可控时钟句柄（B/C/D 期间安装，见 installFakeClock）。 */
let clock = null
try {
  process.env.DSH_HOME = root
  // 不写配置文件 ⇒ engine.config 完全来自 DEFAULT_CONFIG，正是要验的对象
  await fs.writeFile(path.join(root, 'dsh-auto-memory.json'), JSON.stringify({ memoryRoot: path.join(root, 'memory') }))
  MemoryEngine.prototype.loadConfigSync = function () { engine = this; return prev.load.call(this) }
  globalThis.setInterval = globalThis.setTimeout = (cb, ms) => ({ callback: cb, ms, unref() {} })
  apply({
    get: () => undefined, credentials: {}, on: () => {},
    systemPrompt: { context: () => () => {}, section: () => () => {} },
    tools: { register: () => () => {} },
    webServer: { register: () => () => {} },
    effect: () => {},
  }, {})
  globalThis.setTimeout = prev.timeout; globalThis.setInterval = prev.interval

  assert.ok(engine, '夹具：engine 必须在 apply 期间被构造出来')

  // ══════════ A 组：真读 engine.config（默认值，无配置文件覆盖）══════════
  console.log('A 组：真构造 engine 后读默认配置')
  // ★2026-10-29 判据更新（判据过期，非产品缺陷）：用户裁定「刷新仪式超时 120 → 240 秒」已落盘
  //   （DEFAULT_AUTO_CONTINUE_REFRESH_TIMEOUT_SECONDS = 240，DEFAULT_CONFIG 同值）。
  //   本断言原钉 120 = **锁定了一个陈旧读数**；实测 engine.config 现值 240。
  ok(engine.config.autoContinueRefreshTimeoutSeconds === 240,
    'A1 总超时默认 = 240 秒（2026-10-29 用户裁定 120→240）', engine.config.autoContinueRefreshTimeoutSeconds)
  ok(engine.config.autoContinueProbeTimeoutSeconds === 60,
    'A2 单次 probe 默认 = 60 秒（原写死 30）', engine.config.autoContinueProbeTimeoutSeconds)
  ok(Object.prototype.hasOwnProperty.call(engine.config, 'autoContinueProbeTimeoutSeconds'),
    'A3 新键确实进了配置对象（hasOwnProperty，不是 undefined 真值判断）')
  ok(engine.config.autoContinueRefreshRitual === true,
    'A4 刷新仪式默认开（既有行为未被本批改动）', engine.config.autoContinueRefreshRitual)

  // ★变异子进程的「只跑 A / A+B」闸门（V3314_ONLY_A / V3314_ONLY_AB）保留：
  //   它是成本优化，不是正确性前提（B/C/D 已走可控时钟，全跑也只要 ~0.2s）。
  //   ★2026-11-07：M2 曾把模式写成 `true` 而判据是 `mode==='A'` ⇒ 闸门失效、白跑 65s。
  if (process.env.V3314_ONLY_A === '1') {
    console.log('pass=' + pass + ' fail=' + fail)
    process.exit(fail ? 1 : 0)
  }

  // ══════════ B/C/D 组：真跑 hostRefreshRitual ══════════
  const proto = MemoryEngine.prototype
  assert.ok(typeof proto.hostRefreshRitual === 'function', 'hostRefreshRitual 必须是真实原型方法')

  // ★不能用 Object.create(proto) 再赋 state —— state 是 only-getter（实测 TypeError）。
  //   改为在**真 engine 实例**上就地替换依赖成员，用完即还原（同一进程内串行，安全）。
  const mk = (overrides) => {
    const inst = engine
    inst.config = Object.assign({}, engine.config, overrides || {})
    inst._ctxRef = { get: () => undefined }
    inst.handoffMaterialStamp = () => 'stamp'
    inst.refreshRitualPrompt = () => 'prompt'
    inst._diag = () => {}
    // inspect 永不 resolve ⇒ 必然撞上 probe 超时
    inst._sessionController = {
      inspect: () => new Promise(() => {}),
      prompt: () => { throw new Error('probe 超时后不应走到 prompt') },
    }
    return inst
  }

  // ★2026-11-07（alpha.7 P4 · task-21）：B/C/D 改用**可控时钟**（见 installFakeClock）。
  //   被测函数、超时判据、Promise.race 决胜逻辑一字未改；只是不再真等 10~60 秒。
  //   每轮 reset() 清 pending/reqs ⇒ 轮与轮之间无残留定时器串扰。
  clock = installFakeClock()
  /** 跑一轮仪式：清上一轮残留，返回 {res, 假时钟耗时, 本轮被请求的定时器毫秒数}。 */
  const runRitual = async (overrides, sid) => {
    clock.reset()
    const t0 = Date.now()
    const r = await mk(overrides).hostRefreshRitual(sid)
    return { res: r, elapsed: Date.now() - t0, reqs: clock.requested }
  }

  try {
  console.log('B 组：永不 resolve 的 inspect ⇒ 按时 fail-soft（可控时钟）')
  {
    // ★关键：总超时必须**远大于** probe，否则 min(probe, 剩余预算) 会掩盖 probe 上限是否生效。
    //   （实测教训：总超时给 15s 时，把 probe 写死成 30s 仍得 min(30000,15000)=15s ⇒ B2 照样绿，
    //    即原 B 组对该变异**没有鉴别力**。此处放宽到 900s，只让 probe 决定实际耗时。）
    const { res, elapsed, reqs } = await runRitual({ autoContinueRefreshRitual: true, autoContinueRefreshTimeoutSeconds: 900, autoContinueProbeTimeoutSeconds: 10 }, 'sid-fixture')
    ok(res && res.ok === false, 'B1 返回 ok:false（fail-soft，不挂死主流程）', res)
    // 上界 20s：若 probe 上限被写死 30s（变异 M1），这里会得到 ~30s ⇒ 必红。
    ok(elapsed >= 9000 && elapsed <= 20000, 'B2 实测耗时 ≈ probe=10s ⇒ probe 上限真生效（写死 30s 会红）', elapsed)
    ok(typeof res.reason === 'string' && res.reason.length > 0 || typeof res.error === 'string',
      'B3 失败带可排查原因', res)
    // ★新增（2026-11-07）：耗时是**间接**证据（假时钟下还可能掺进杂散定时器）；
    //   直接断言「本轮向 setTimeout 请求了多少毫秒」⇒ 区分力不依赖任何时间推进，
    //   M1（写死 30000）在 B2/B4 两条判据上同时红。
    ok(reqs.includes(10000), 'B4 probe=10s ⇒ 定时器请求恰为 10000ms（写死 30s 会红）', reqs)
  }

  // ★M1 变异的判据落在 B2（probe=10s 时若写死 30s ⇒ 实测耗时 ~30s，越界必红）。
  //   M1 子进程只需跑完 A+B 即可判定，无需再跑 C/D（那两组在变异下各要等 30s，会让整轮超时）。
  if (process.env.V3314_ONLY_AB === '1') {
    console.log('pass=' + pass + ' fail=' + fail)
    process.exit(fail ? 1 : 0)
  }

  console.log('C 组：probe 上限随配置变化（同一逻辑两种配置）')
  {
    const a = await runRitual({ autoContinueRefreshRitual: true, autoContinueRefreshTimeoutSeconds: 900, autoContinueProbeTimeoutSeconds: 10 }, 'sid-a')
    ok(a.res && a.res.ok === false && a.elapsed >= 9000 && a.elapsed <= 20000, 'C1 probe=10s ⇒ 约 10s 后超时', { elapsed: a.elapsed })

    const b = await runRitual({ autoContinueRefreshRitual: true, autoContinueRefreshTimeoutSeconds: 900, autoContinueProbeTimeoutSeconds: 20 }, 'sid-b')
    ok(b.res && b.res.ok === false && b.elapsed >= 19000 && b.elapsed <= 32000, 'C2 probe=20s ⇒ 约 20s 后超时', { elapsed: b.elapsed })
    ok(b.elapsed > a.elapsed + 5000, 'C3 ★两组耗时显著不同 ⇒ probe 上限真由配置驱动，不是写死 30s', { d1: a.elapsed, d2: b.elapsed })
    ok(a.reqs.includes(10000) && b.reqs.includes(20000), 'C4 两组请求的毫秒数分别为 10000 / 20000（同一逻辑两种配置）', { r1: a.reqs, r2: b.reqs })
  }

  console.log('D 组：越界配置回落 + min 关系（负路径）')
  {
    // probe 越界上界 300 ⇒ 回落 60s；总超时压到 15s，验证不得突破总超时
    const oob = await runRitual({ autoContinueRefreshRitual: true, autoContinueRefreshTimeoutSeconds: 15, autoContinueProbeTimeoutSeconds: 9999 }, 'sid-oob')
    ok(oob.res && oob.res.ok === false, 'D1 probe 越界(9999) 不抛错，仍 fail-soft', oob.res)
    ok(oob.elapsed <= 22000, 'D2 ★probe 越界时不得突破总超时 15s（min 关系成立）', oob.elapsed)
    ok(oob.reqs.includes(15000), 'D2b min(回落 60000, 总超时 15000) ⇒ 实际请求 15000ms', oob.reqs)
  }
  {
    // 总超时越界上界 900 ⇒ 回落 240s；probe=10s 先超时
    const oob2 = await runRitual({ autoContinueRefreshRitual: true, autoContinueRefreshTimeoutSeconds: 9999, autoContinueProbeTimeoutSeconds: 10 }, 'sid-oob2')
    ok(oob2.res && oob2.res.ok === false, 'D3 总超时越界(9999) 回落默认 240s，不照单全收', { elapsed: oob2.elapsed })
    ok(oob2.elapsed >= 9000 && oob2.elapsed <= 20000, 'D4 由 probe=10s 先超时 ⇒ 回落后的总超时 > 10s（240s 生效）', oob2.elapsed)
  }
  {
    // 关掉刷新仪式 ⇒ 立即返回 disabled，不该有任何等待
    const off = await runRitual({ autoContinueRefreshRitual: false }, 'sid-off')
    ok(off.res && off.res.ok === false && off.res.reason === 'disabled', 'D5 仪式关闭时立即返回 disabled（既有语义未破）', off.res)
    ok(off.elapsed < 1000, 'D6 disabled 路径不做任何等待', off.elapsed)
    ok(off.reqs.length === 0, 'D6b disabled 路径连一个定时器都不装', off.reqs)
  }
  {
    // ★新增（2026-11-07）下界负路径：probe 下界是 10 秒，配置 1 必须回落到默认 60 秒。
    //   这是「cap 判据被改成恒真」（变异 M3）的**唯一**鉴别点：恒真时 1 会被照单全收成 1000ms。
    const low = await runRitual({ autoContinueRefreshRitual: true, autoContinueRefreshTimeoutSeconds: 900, autoContinueProbeTimeoutSeconds: 1 }, 'sid-low')
    ok(low.res && low.res.ok === false, 'D7 probe 低于下界(1) 不抛错，仍 fail-soft', low.res)
    ok(low.reqs.includes(60000) && !low.reqs.includes(1000), 'D7b probe=1 回落默认 60s（cap 判据不是恒真）', low.reqs)
    ok(low.elapsed >= 59000 && low.elapsed <= 70000, 'D7c 回落后的 60s 真生效（耗时 ≈ 60s）', low.elapsed)
  }
  } finally { clock.restore(); clock = null }
} catch (e) {
  ok(false, '执行期异常', String(e && e.stack || e).slice(0, 500))
} finally {
  globalThis.setInterval = prev.interval
  globalThis.setTimeout = prev.timeout
  if (prev.home === undefined) delete process.env.DSH_HOME; else process.env.DSH_HOME = prev.home
  MemoryEngine.prototype.loadConfigSync = prev.load
  try { await fs.rm(root, { recursive: true, force: true }) } catch (_) {}
}


// ══════════ E 组：变异反向验证（把代码改回旧写法 ⇒ 必须红）══════════
// ★2026-11-07（alpha.7 P4 · task-21）性能前提已变：B/C/D 走可控时钟，全套 B/C/D 实耗 ≈ 0.2s
//   （原实现 65.4s）。三个变异子进程因此都能在整套件 30s 预算内跑完：
//     M1 探针上限写死 30s      ⇒ B2/B4 红（只需 A+B）
//     M2 默认总超时 240 → 90   ⇒ A1 红（只需 A）
//     M3 cap 判据恒真（越界不回落）⇒ D7b/D7c 红（需跑完 A+B+C+D）
//   ★历史坑（本批修）：M2 子进程的模式参数一度写成 `true`，而 `:182` 判据是 `mode==='A'`
//   ⇒ 子进程没被 V3314_ONLY_A 拦住，白跑完整个 B/C/D（65,459ms）。现统一用 'A'/'AB'/'ALL'。
if (process.env.V3314_CHILD !== '1') {
  const { spawnSync } = await import('node:child_process')
  const { fileURLToPath } = await import('node:url')
  const realIdx = await fs.readFile(IDX_PATH, 'utf8')
  const CHILD_ONLY_A = 'V3314_ONLY_A'

  const runMutant = async (label, from, to, tag, mode) => {
    const hits = realIdx.split(from).length - 1
    ok(hits === 1, 'E 变异定位:' + label + ' 锚点恰命中 1 次', { hits })
    if (hits !== 1) return
    const mp = path.join(os.tmpdir(), 'mut-v3314-' + tag + '.js')
    await fs.writeFile(mp, realIdx.replace(from, to))
    const env = Object.assign({}, process.env, { V3314_CHILD: '1', DAM_AUDIT_ENGINE_SOURCE: mp })
    if (mode === 'A') env[CHILD_ONLY_A] = '1'
    if (mode === 'AB') env.V3314_ONLY_AB = '1'
    const r = spawnSync(process.execPath, [fileURLToPath(import.meta.url)], { env, encoding: 'utf8', maxBuffer: 1 << 25, timeout: 120000 })
    const out = String(r.stdout || '') + String(r.stderr || '')
    const m = out.match(/pass=(\d+) fail=(\d+)/)
    // ★判据收紧：必须 status===1（进程正常退出且断言失败）。
    //   原写法 status!==0 会把「被 spawnSync timeout 杀掉」（status=null, signal=SIGTERM）也当成红 ⇒ 假绿。
    ok(r.status === 1, '★变异必红(' + label + '):退出码必须为 1（断言红，不是被超时杀掉）', { status: r.status, signal: r.signal })
    ok(/FAIL - /.test(out), '★变异必红(' + label + '):是断言红不是崩溃', out.slice(-200))
    console.log('  [变异取证] ' + label + ' -> ' + (m ? m[0] : '?') + ' exit=' + r.status)
    try { await fs.rm(mp, { force: true }) } catch (_) {}
  }

  // M1：probe 上限退回写死 30s（复刻 v3.3.13 之前的代码）
  await runMutant('M1 probe 上限退回写死',
    "const probeSec = Number(this.config.autoContinueProbeTimeoutSeconds)\r\n    const probeCapMs = (probeSec >= 10 && probeSec <= 300 ? probeSec : DEFAULT_AUTO_CONTINUE_PROBE_TIMEOUT_SECONDS) * 1000",
    "const probeCapMs = 30000", 'M1', 'AB')   // M1 的判据在 B2（耗时越界）⇒ 跑完 A+B 即可

  // M2：默认总超时退回 90  ⇒ 判据在 A1
  //   ★2026-11-07 修：末位实参原为 `true`，而 runMutant 只认 'A'/'AB' ⇒ 门没生效，
  //   子进程白跑了整个 B/C/D（实测 65,459ms）。改为 'A' 是**零产品改动**的 65s 提速。
  await runMutant('M2 默认总超时退回 90',
    "autoContinueRefreshTimeoutSeconds: 240,", "autoContinueRefreshTimeoutSeconds: 90,", 'M2', 'A')

  // M3：cap 判据改成**恒真**（越界值不再回落默认）⇒ 下界负路径 D7 必红
  await runMutant('M3 probe cap 判据恒真',
    "(probeSec >= 10 && probeSec <= 300 ? probeSec : DEFAULT_AUTO_CONTINUE_PROBE_TIMEOUT_SECONDS)",
    "(true ? probeSec : DEFAULT_AUTO_CONTINUE_PROBE_TIMEOUT_SECONDS)", 'M3', 'ALL')
}

console.log('suite_wall_ms=' + (Date.now() - SUITE_T0))
console.log('pass=' + pass + ' fail=' + fail)
process.exitCode = fail ? 1 : 0

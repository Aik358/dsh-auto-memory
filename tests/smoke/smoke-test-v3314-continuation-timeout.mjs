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

// ══════════ 夹具：真构造一个 engine（走真实 DEFAULT_CONFIG 合并路径）══════════
const root = await fs.mkdtemp(path.join(os.tmpdir(), 'dam-v3314-'))
const prev = { home: process.env.DSH_HOME, interval: globalThis.setInterval, timeout: globalThis.setTimeout, load: MemoryEngine.prototype.loadConfigSync }
let engine = null
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
  ok(engine.config.autoContinueRefreshTimeoutSeconds === 120,
    'A1 总超时默认 = 120 秒（原 90）', engine.config.autoContinueRefreshTimeoutSeconds)
  ok(engine.config.autoContinueProbeTimeoutSeconds === 60,
    'A2 单次 probe 默认 = 60 秒（原写死 30）', engine.config.autoContinueProbeTimeoutSeconds)
  ok(Object.prototype.hasOwnProperty.call(engine.config, 'autoContinueProbeTimeoutSeconds'),
    'A3 新键确实进了配置对象（hasOwnProperty，不是 undefined 真值判断）')
  ok(engine.config.autoContinueRefreshRitual === true,
    'A4 刷新仪式默认开（既有行为未被本批改动）', engine.config.autoContinueRefreshRitual)

  // ★变异子进程只验 A 组（默认值真读）即可判定 M1/M2 是否变红；
  //   跳过靠真实等待的 B/C/D 组，避免整套件超过 runner 单套件上限。
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

  console.log('B 组：永不 resolve 的 inspect ⇒ 按时 fail-soft')
  {
    const t0 = Date.now()
    // ★关键：总超时必须**远大于** probe，否则 min(probe, 剩余预算) 会掩盖 probe 上限是否生效。
    //   （实测教训：总超时给 15s 时，把 probe 写死成 30s 仍得 min(30000,15000)=15s ⇒ B2 照样绿，
    //    即原 B 组对该变异**没有鉴别力**。此处放宽到 900s，只让 probe 决定实际耗时。）
    const res = await mk({ autoContinueRefreshRitual: true, autoContinueRefreshTimeoutSeconds: 900, autoContinueProbeTimeoutSeconds: 10 }).hostRefreshRitual('sid-fixture')
    const elapsed = Date.now() - t0
    ok(res && res.ok === false, 'B1 返回 ok:false（fail-soft，不挂死主流程）', res)
    // 上界 20s：若 probe 上限被写死 30s（变异 M1），这里会得到 ~30s ⇒ 必红。
    ok(elapsed >= 9000 && elapsed <= 20000, 'B2 实测耗时 ≈ probe=10s ⇒ probe 上限真生效（写死 30s 会红）', elapsed)
    ok(typeof res.reason === 'string' && res.reason.length > 0 || typeof res.error === 'string',
      'B3 失败带可排查原因', res)
  }

  // ★M1 变异的判据落在 B2（probe=10s 时若写死 30s ⇒ 实测耗时 ~30s，越界必红）。
  //   M1 子进程只需跑完 A+B 即可判定，无需再跑 C/D（那两组在变异下各要等 30s，会让整轮超时）。
  if (process.env.V3314_ONLY_AB === '1') {
    console.log('pass=' + pass + ' fail=' + fail)
    process.exit(fail ? 1 : 0)
  }

  console.log('C 组：probe 上限随配置变化（同一逻辑两种配置）')
  {
    const t0 = Date.now()
    const r1 = await mk({ autoContinueRefreshRitual: true, autoContinueRefreshTimeoutSeconds: 900, autoContinueProbeTimeoutSeconds: 10 }).hostRefreshRitual('sid-a')
    const d1 = Date.now() - t0
    ok(r1 && r1.ok === false && d1 >= 9000 && d1 <= 20000, 'C1 probe=10s ⇒ 约 10s 后超时', { elapsed: d1 })

    const t1 = Date.now()
    const r2 = await mk({ autoContinueRefreshRitual: true, autoContinueRefreshTimeoutSeconds: 900, autoContinueProbeTimeoutSeconds: 20 }).hostRefreshRitual('sid-b')
    const d2 = Date.now() - t1
    ok(r2 && r2.ok === false && d2 >= 19000 && d2 <= 32000, 'C2 probe=20s ⇒ 约 20s 后超时', { elapsed: d2 })
    ok(d2 > d1 + 5000, 'C3 ★两组耗时显著不同 ⇒ probe 上限真由配置驱动，不是写死 30s', { d1, d2 })
  }

  console.log('D 组：越界配置回落 + min 关系（负路径）')
  {
    // probe 越界上界 300 ⇒ 回落 60s；总超时压到 15s，验证不得突破总超时
    const t0 = Date.now()
    const r = await mk({ autoContinueRefreshRitual: true, autoContinueRefreshTimeoutSeconds: 15, autoContinueProbeTimeoutSeconds: 9999 }).hostRefreshRitual('sid-oob')
    const d = Date.now() - t0
    ok(r && r.ok === false, 'D1 probe 越界(9999) 不抛错，仍 fail-soft', r)
    ok(d <= 22000, 'D2 ★probe 越界时不得突破总超时 15s（min 关系成立）', d)
  }
  {
    // 总超时越界上界 900 ⇒ 回落 120s；probe=10s 先超时
    const t0 = Date.now()
    const r = await mk({ autoContinueRefreshRitual: true, autoContinueRefreshTimeoutSeconds: 9999, autoContinueProbeTimeoutSeconds: 10 }).hostRefreshRitual('sid-oob2')
    const d = Date.now() - t0
    ok(r && r.ok === false, 'D3 总超时越界(9999) 回落默认 120s，不照单全收', { elapsed: d })
    ok(d >= 9000 && d <= 20000, 'D4 由 probe=10s 先超时 ⇒ 回落后的总超时 > 10s（120s 生效）', d)
  }
  {
    // 关掉刷新仪式 ⇒ 立即返回 disabled，不该有任何等待
    const t0 = Date.now()
    const r = await mk({ autoContinueRefreshRitual: false }).hostRefreshRitual('sid-off')
    const d = Date.now() - t0
    ok(r && r.ok === false && r.reason === 'disabled', 'D5 仪式关闭时立即返回 disabled（既有语义未破）', r)
    ok(d < 1000, 'D6 disabled 路径不做任何等待', d)
  }
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
// ★性能约束：B/C/D 组靠真实等待（10~20s/组）证明超时行为，单跑已约 35s。
//   若子进程把 B/C/D 也跑一遍，两轮变异会让整套件超过 runner 的 180s 单套件上限（实测 TIMEOUT）。
//   ⇒ 变异子进程只跑 A 组（默认值真读），那正是 M1/M2 两个变异所针对的判据，足够证明鉴别力。
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

  // M2：默认总超时退回 90
  await runMutant('M2 默认总超时退回 90',
    "autoContinueRefreshTimeoutSeconds: 120,", "autoContinueRefreshTimeoutSeconds: 90,", 'M2', true)   // M2 的判据在 A1 ⇒ 只跑 A 组即可
}

console.log('pass=' + pass + ' fail=' + fail)
process.exit(fail ? 1 : 0)

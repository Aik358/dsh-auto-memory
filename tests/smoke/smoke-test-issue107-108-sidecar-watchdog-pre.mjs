/**
 * issue #107 / #108 回归锁：Python 侧车的看门狗、熔断闭合口径与 stderr 可见性。
 *
 * 三条各自独立的缺陷：
 *  A(#107) `health()` / `restart()` 是「有实现、零调用方」：worker wedged 时超时分支只发一帧
 *          `cancel`（它连 cancel 都不听），熔断冷却后又在**同一具尸体**上重试 ⇒ 每帧白等到超时。
 *  B(#107) 熔断闭合口径「任一成功即清零」与 index_sync 的分段序列冲突：每段 `begin` 帧必先成功
 *          一帧 ⇒ consecutiveFailures 峰值恒为 1 ⇒ 阈值 3 永不触发，熔断形同不存在。
 *          半开探测（冷却后一次成功即闭合）是既有契约（m70 G6），必须保留。
 *  C(#108) worker stderr 被收进 4KB 尾巴却**全仓无一处读内容**，对外只有 stderrTailBytes；
 *          Python 的 traceback 恰只走 stderr ⇒「起即退」的唯一定位信息被静默丢弃。
 *
 * 全程用 **Node 假 worker**（`command: process.execPath`）说话，不依赖 python。
 * 运行：node tests/smoke/smoke-test-issue107-108-sidecar-watchdog-pre.mjs
 */
import { createPythonSidecarClientPre } from '../../lib/python-sidecar-client.js'
import { M7_WIRE_PROTOCOL_VERSION_V1 } from '../../lib/m7-wire.js'
import { mkdtempSync, writeFileSync, rmSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

process.on('uncaughtException', (e) => { console.error('[SIDECAR-FATAL]', (e && (e.stack || e.message)) || e); process.exit(1) })
process.on('unhandledRejection', (r) => { console.error('[SIDECAR-REJ]', r); process.exit(1) })

let pass = 0
let fail = 0
function ok(cond, name) {
  if (cond) { pass++; console.log('  ok - ' + name) } else { fail++; console.error('  FAIL - ' + name) }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const tmp = mkdtempSync(path.join(tmpdir(), 'dam-sidecar-wd-'))
// 装死 worker：把 stdin 吊住、永不回帧（等价于 wedged 的 python worker）
const SILENT = path.join(tmp, 'silent-worker.mjs')
writeFileSync(SILENT, 'import "node:process";\nprocess.stdin.resume();\nsetInterval(() => {}, 1000);\n', 'utf8')
// 起即退 worker：先吐一段带标记的 traceback 到 stderr，再以非零码退出
const NOISY = path.join(tmp, 'noisy-worker.mjs')
writeFileSync(NOISY, 'import "node:process";\nconsole.error("Traceback (most recent call last):");\nconsole.error("  File \\"worker_v1.py\\", line 42, in <module>\\n    raise RuntimeError(\\"DIM MISMATCH marker-dam-107\\")");\nprocess.exit(3);\n', 'utf8')

function mk(over = {}) {
  const diags = []
  const c = createPythonSidecarClientPre({
    command: process.execPath,
    scriptPath: () => over.script || SILENT,
    dshHome: '',
    requestTimeoutMs: over.requestTimeoutMs || 200,
    breakerFailureThreshold: over.breakerFailureThreshold || 3,
    breakerCooldownMs: over.breakerCooldownMs || 60000,
    watchdogTimeouts: over.watchdogTimeouts || 3,
    diag: (m) => diags.push(String(m)),
  })
  return { c, diags }
}
/** 造一条合法入站响应帧（与 m70 的 mkResp 同形状）。 */
function respOf(sent, epoch, type, payload) {
  return JSON.stringify({
    protocolVersion: M7_WIRE_PROTOCOL_VERSION_V1, frameId: 'r' + Math.random().toString(36).slice(2),
    requestId: sent.requestId, workerEpoch: epoch, type, payload, sentAt: 7,
  }) + '\n'
}

console.log('[W1] 看门狗：连续超时 ⇒ 杀 wedged worker 并重生（旧实现 health/restart 零调用方）')
{
  const { c, diags } = mk({ watchdogTimeouts: 3, breakerFailureThreshold: 99, requestTimeoutMs: 200 })
  const starts0 = c._statsForTest.starts
  const r1 = await c.request('health'); const r2 = await c.request('health'); const r3 = await c.request('health')
  ok(r1.code === 'timeout' && r2.code === 'timeout' && r3.code === 'timeout', '三次请求均结构化 timeout')
  ok(c._statsForTest.watchdogKills >= 1, `★ 看门狗计入重生（watchdogKills=${c._statsForTest.watchdogKills}）`)
  ok(c._statsForTest.restarts >= 1, 'restart() 被真实调用（旧实现全仓零调用方）')
  ok(c.isStarted() === false, '重生前旧进程已被丢弃（child 归零），下一次请求才懒拉起新 worker')
  ok(diags.some((d) => /看门狗触发/.test(d) && /判定 worker wedged/.test(d)), 'diag 里能看到看门狗动作与原因')
  await c.request('health')
  ok(c._statsForTest.starts > starts0, `新 worker 被拉起（starts ${starts0} → ${c._statsForTest.starts}）`)
  await c.dispose('test')
}

console.log('[W2] 交替「成功/超时」必须能累积到熔断（旧口径被 begin 帧清零 ⇒ 永不打开）')
{
  const { c } = mk({ watchdogTimeouts: 999, breakerFailureThreshold: 3, breakerCooldownMs: 60000 })
  c.ensureStarted()
  const epoch = c.currentEpoch()
  ok(!!epoch, '夹具前提：worker 已起且拿到 epoch')
  // ok, timeout, ok, timeout, ok, timeout —— 每轮「先成功再超时」模拟 index_sync 分段节奏
  for (let i = 0; i < 3; i++) {
    const p = c.request('health')
    c._feedForTest(respOf(c._lastFrameForTest(), epoch, 'health_result', { protocol: 'm7_wire_v1' }))
    const r = await p
    ok(r.ok === true, `第 ${i + 1} 轮 begin 类帧成功`)
    const t = await c.request('health')
    ok(t.code === 'timeout', `第 ${i + 1} 轮 commit 类帧超时`)
  }
  ok(c.breakerOpenForTest() === true, '★ 六帧后熔断打开：consecutiveFailures 累积到阈值 3 —— 旧实现在此恒为 1，永不打开')
  const ro = await c.request('health')
  ok(ro.code === 'circuit-open', '打开期请求立即结构化失败，不再白等 5s')
  await c.dispose('test')
}

console.log('[W3] 半开探测仍是一次成功即闭合（保持既有契约与 m70 G6）')
{
  const { c } = mk({ watchdogTimeouts: 999, breakerFailureThreshold: 2, breakerCooldownMs: 300 })
  await c.request('health')
  await c.request('health')
  ok(c.breakerOpenForTest() === true, '连续失败达阈值 ⇒ 打开')
  await sleep(420)
  ok(c.breakerOpenForTest() === false, '冷却过后 ⇒ 放行探测（breaker 关闭态）')
  c.ensureStarted()
  const p = c.request('health')
  c._feedForTest(respOf(c._lastFrameForTest(), c.currentEpoch(), 'health_result', { protocol: 'm7_wire_v1' }))
  const r = await p
  ok(r.ok === true, '半开探测成功')
  const dv = c.debugView()
  ok(dv.breaker.consecutiveFailures === 0, '★ 探测一次成功即归零（未误伤既有契约）')
  await c.dispose('test')
}

console.log('[W4] stderr 内容可见：落 diag + 进 stats（旧实现只报字节数）')
{
  const { c, diags } = mk({ script: NOISY, requestTimeoutMs: 400, watchdogTimeouts: 999, breakerFailureThreshold: 99 })
  const r = await c.request('health')
  ok(r.ok === false, '起即退的 worker ⇒ 请求结构化失败（code=' + String(r.code) + '）')
  await sleep(120)
  const tail = c.debugView().stats.lastStderrTail
  ok(typeof tail === 'string' && tail.includes('marker-dam-107'), '★ stats.lastStderrTail 含 Python 侧的 traceback 标记')
  ok(diags.some((d) => /worker 退出/.test(d) && /marker-dam-107/.test(d)), '★ 退出时的 diag 带上了 stderr 尾部内容')
  ok(c.debugView().stderrTailBytes > 0, 'stderrTailBytes 仍保留（区分"没输出"与"被截断"）')
  await c.dispose('test')
}

console.log('[W5] 死码清除守卫：不留下第二套并行的失败抑制机制')
{
  const strip = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '') // 去注释：本仓旧教训「注释里提到旧写法」会造成假红
  const host = strip(readFileSync(new URL('../../lib/m7-index-sync-host.js', import.meta.url), 'utf8'))
  ok(!/enabledKeys/.test(host), '★ m7-index-sync-host.js 不再声明从不写入的 enabledKeys')
  ok(!/capturedPathKeys/.test(host), '★ 其 debugView 不再打印恒为 [] 的 capturedPathKeys（context-host 的同名字段不受影响）')
  const client = strip(readFileSync(new URL('../../lib/python-sidecar-client.js', import.meta.url), 'utf8'))
  ok(/restart\(reason\)/.test(client) && /maybeWatchdog/.test(client), 'restart 由看门狗在 client 内部调用（不再是无人调用的入口）')
  ok(/probing/.test(client), '闭合态与半开探测两套口径显式分列')
  ok(!/if \(result\.ok\) \{ stats\.succeeded\+\+; breaker\.consecutiveFailures = 0 \}/.test(client), '★ 不再有「任一成功即清零」的旧写法')
}

rmSync(tmp, { recursive: true, force: true })
console.log('\n--- issue #107/#108 侧车看门狗与 stderr 可见性 ---')
console.log('pass=' + pass + ' fail=' + fail)
process.exit(fail ? 1 : 0)

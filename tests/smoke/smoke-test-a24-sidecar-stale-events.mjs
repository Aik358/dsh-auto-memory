#!/usr/bin/env node
/**
 * smoke-test-a24-sidecar-stale-events.mjs —— #444 守卫套件（Python 语义侧车「旧代迟到事件」）。
 *
 * 缺陷（改前实测）：只有 exit handler 有 `child !== proc` 守卫；error / stdout / stderr 三个
 * handler 无条件生效 ⇒ 重启后**旧进程迟到的事件**会：
 *   ① error：child=null + epoch=null + rejectAll('unavailable') ⇒ 抹掉**新进程**引用、
 *      新代在途请求被误拒、熔断计数 +1（unavailable 在 FAILURE_CODES 内）；
 *   ② stdout：旧代半帧被拼进新代解析 buffer ⇒ badJson / 请求白等到超时；
 *   ③ stderr：旧代 traceback 被挂到新代 stderrTail（诊断张冠李戴）；
 *   ④ stdin：全文件零 error 监听 ⇒ EPIPE 走 Node 默认「无监听即抛未捕获」。
 *
 * 纪律：真 spawn `process.execPath` 假 worker（照 issue415 的夹具），全部断言对着**行为**；
 * 负路径③「当前代 error 仍须照常清理」是**防过修**的关键判据（一律丢弃式修复会在这里红）。
 */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createPythonSidecarClientPre } from '../../lib/python-sidecar-client.js'

let pass = 0; let fail = 0
const ok = (c, n, x) => { if (c) { pass++; console.log('  ok - ' + n) } else { fail++; console.error('  FAIL - ' + n + (x == null ? '' : ' << ' + x)) } }
const eq = (a, b, n) => ok(a === b, n, 'got=' + JSON.stringify(a) + ' want=' + JSON.stringify(b))
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const DIR = mkdtempSync(join(tmpdir(), 'dam-a24-'))

/** 假 worker：合法回帧 + 常驻（可被 stdin 关闭触发 EPIPE）。 */
const W = join(DIR, 'worker.mjs')
writeFileSync(W, [
  "let buf = ''",
  "process.stdin.setEncoding('utf8')",
  "process.stdin.on('data', (d) => {",
  "  buf += d",
  "  let i",
  "  while ((i = buf.indexOf(String.fromCharCode(10))) !== -1) {",
  "    const line = buf.slice(0, i); buf = buf.slice(i + 1)",
  "    let req",
  "    try { req = JSON.parse(line) } catch (_) { continue }",
  "    if (!req || !req.requestId) continue",
  "    const respType = req.type === 'health' ? 'health_result' : 'context_ack'",
  "    process.stdout.write(JSON.stringify({ protocolVersion: 'm7_wire_pre_v1', frameId: 'f-' + req.requestId, requestId: req.requestId, workerEpoch: req.workerEpoch, type: respType, payload: {}, sentAt: Date.now() }) + String.fromCharCode(10))",
  "  }",
  "})",
  "setInterval(() => {}, 1000)",
  '',
].join('\n'), 'utf8')

function mkClient(over = {}) {
  return createPythonSidecarClientPre({
    command: process.execPath,
    scriptPath: () => over.script || W,
    dshHome: '',
    requestTimeoutMs: over.requestTimeoutMs || 3000,
    breakerFailureThreshold: 50,
    breakerCooldownMs: 600,
  })
}
const hardKill = (child) => { try { child.kill('SIGKILL') } catch (_) {} }

console.log('[A24-1] 正路径：旧代迟到 error 不得抹掉新代（引用 / epoch / 在途请求 / 熔断计数）')
{
  const c = mkClient()
  const rA = await c.request('health', {}, { timeoutMs: 3000 })
  ok(rA.ok === true, 'A24-1a 第 1 代 worker health 成功')
  const childA = c.processForTest()
  ok(!!childA, 'A24-1b 拿到第 1 代 ChildProcess 引用')
  c.restart('A24-stale-error')
  const rB = await c.request('health', {}, { timeoutMs: 3000 })
  ok(rB.ok === true, 'A24-1c 第 2 代 worker health 成功')
  const childB = c.processForTest()
  ok(!!childB && childB !== childA, 'A24-1d 确实换到了新进程（引用不同）')
  const epochB = c.currentEpoch()
  const cfBefore = c.debugView().breaker.consecutiveFailures
  const pendingB = c.request('health', {}, { timeoutMs: 3000 })
  await sleep(20)
  // 真实场景等价物：旧代进程的 'error'（ENOENT / EPIPE）迟到到宿主
  childA.emit('error', new Error('A24_STALE_ERR'))
  const rPending = await pendingB
  ok(rPending.ok === true, 'A24-1e ★ 第 2 代在途请求仍成功（改前被误拒为 unavailable）', JSON.stringify(rPending && rPending.code))
  eq(c.isStarted(), true, 'A24-1f ★ isStarted() 仍为 true（改前把新进程引用抹成 null）')
  eq(c.currentEpoch(), epochB, 'A24-1g ★ currentEpoch() 未被清空')
  eq(c.debugView().breaker.consecutiveFailures, cfBefore, 'A24-1h ★ 熔断计数不增（改前 unavailable 计一次失败）')
  eq(c.processForTest(), childB, 'A24-1i 当前进程引用仍是 B')
  ok(c._diagRingForTest.some((d) => String(d.message).includes('迟到 error 已忽略')), 'A24-1j 迟到 error 有 diag 留痕（不静默）')
  eq(c._statsForTest.exitKinds.spawnError, 0, 'A24-1k 非当前代 error 不计 spawnError 归因桶')
  // 收尾：A 已被 restart 击杀；B 交给 dispose
  await c.dispose('A24-1')
  hardKill(childA)
}

console.log('[A24-2] 负路径①：旧代迟到 stderr 不污染当前代 stderrTail')
{
  const c = mkClient()
  await c.request('health', {}, { timeoutMs: 3000 })
  const childA = c.processForTest()
  c.restart('A24-stale-stderr')
  await c.request('health', {}, { timeoutMs: 3000 })
  const bytesBefore = c.debugView().stderrTailBytes
  const staleBefore = c._statsForTest.dropped.staleEpoch
  childA.stderr.emit('data', Buffer.from('A24_STALE_STDERR_MARKER' + String.fromCharCode(10), 'utf8'))
  await sleep(40)
  eq(c.debugView().stderrTailBytes, bytesBefore, 'A24-2a ★ 旧代 stderr 未写进当前代 stderrTail')
  ok(!String(c.debugView().lastStderrTail || '').includes('A24_STALE_STDERR_MARKER'), 'A24-2b 退出诊断的 lastStderrTail 里也不含旧代标记')
  eq(c._statsForTest.dropped.staleEpoch, staleBefore + 1, 'A24-2c 丢弃计入 dropped.staleEpoch（可观测，不静默）')
  await c.dispose('A24-2')
  hardKill(childA)
}

console.log('[A24-3] 负路径②：旧代迟到 stdout 半帧不污染解析 buffer')
{
  const c = mkClient()
  await c.request('health', {}, { timeoutMs: 3000 })
  const childA = c.processForTest()
  c.restart('A24-stale-stdout')
  await c.request('health', {}, { timeoutMs: 3000 })
  const staleBefore = c._statsForTest.dropped.staleEpoch
  const badBefore = c._statsForTest.dropped.badJson
  childA.stdout.emit('data', Buffer.from('{"half":', 'utf8'))
  await sleep(30)
  eq(c._statsForTest.dropped.staleEpoch, staleBefore + 1, 'A24-3a 旧代 stdout 计 dropped.staleEpoch')
  const r = await c.request('health', {}, { timeoutMs: 3000 })
  ok(r.ok === true, 'A24-3b ★ 新代请求仍成功（改前半帧污染 buffer ⇒ badJson + 挂到超时）', JSON.stringify(r && r.code))
  eq(c._statsForTest.dropped.badJson, badBefore, 'A24-3c 无坏 JSON（半帧没有拼进合法行）')
  await c.dispose('A24-3')
  hardKill(childA)
}

console.log('[A24-4] 负路径③（防过修）：**当前代** error 仍须照常清理')
{
  const c = mkClient()
  await c.request('health', {}, { timeoutMs: 3000 })
  const childNow = c.processForTest()
  ok(!!childNow, 'A24-4a 当前代进程存在')
  // 同步发请求后**立刻**补发 error（不再 await/sleep）：必须让「当前代 error」发生在这条请求
  // 还没结算的窗口内 —— 否则 worker 的正常回帧先到，本断言测的就不是清理路径了（首版踩过）。
  const pending = c.request('health', {}, { timeoutMs: 3000 })
  childNow.emit('error', new Error('A24_CURRENT_ERR'))
  const rp = await pending
  eq(rp && rp.code, 'unavailable', 'A24-4b ★ 当前代 error ⇒ 在途请求结构化 unavailable（清理照常发生）')
  eq(c.isStarted(), false, 'A24-4c ★ 当前代 error 后进程引用被清空')
  eq(c.currentEpoch(), null, 'A24-4d ★ 当前代 error 后 epoch 被清空')
  eq(c._statsForTest.exitKinds.spawnError, 1, 'A24-4e spawnError 归因桶 +1（该桶改前零写入）')
  const rNext = await c.request('health', {}, { timeoutMs: 3000 })
  ok(rNext.ok === true, 'A24-4f 下一次请求能重新拉起新进程并成功', JSON.stringify(rNext && rNext.code))
  await c.dispose('A24-4')
  hardKill(childNow)
}

console.log('[A24-5] 负路径④：stdin 管道错误不得升级为未捕获异常')
{
  const c = mkClient()
  await c.request('health', {}, { timeoutMs: 3000 })
  const childNow = c.processForTest()
  const before = Number(c._statsForTest.dropped.stdinError || 0)
  let threw = null
  // 语义等价于真实 EPIPE：ChildProcess.stdin 上 emit('error')。**无监听时 Node 会在此处同步抛出**，
  // 有监听则被记账 ⇒ 该断言同时证明「监听存在」与「不抛出」。
  try { childNow.stdin.emit('error', Object.assign(new Error('write EPIPE'), { code: 'EPIPE' })) } catch (e) { threw = e }
  ok(threw === null, 'A24-5a ★ stdin error 被监听消费，未抛成未捕获异常（改前零监听 ⇒ 直接抛）', threw ? String(threw.code || threw.message) : '')
  ok(Number(c._statsForTest.dropped.stdinError || 0) === before + 1, 'A24-5b stdin 错误计入 dropped.stdinError（可观测）')
  ok(c._diagRingForTest.some((d) => String(d.message).includes('stdin 管道错误')), 'A24-5c stdin 管道错误有 diag 留痕（不静默）')
  // 真实路径补充：杀掉子进程后写 stdin —— 不得抛出未捕获异常
  let uncaught = null
  const onUncaught = (e) => { uncaught = e }
  process.on('uncaughtException', onUncaught)
  hardKill(childNow)
  await sleep(120)
  try { childNow.stdin.write('{"x":1}' + String.fromCharCode(10)) } catch (_) {}
  await sleep(200)
  process.removeListener('uncaughtException', onUncaught)
  ok(uncaught === null, 'A24-5d ★ 真实 EPIPE 路径同样不升级为未捕获异常', uncaught ? String(uncaught.code || uncaught.message) : '')
  await c.dispose('A24-5')
}

try { rmSync(DIR, { recursive: true, force: true }) } catch (_) {}
console.log('\n[A24] ' + pass + ' passed, ' + fail + ' failed')
// 硬退出：本套件会刻意制造「宿主已丢失某个子进程引用」的窗口（正是被测缺陷形态），
// 若用 process.exitCode 收尾，那种残留子进程会把事件循环挂住（实测：变异实验会永久卡住）。
process.exit(fail ? 1 : 0)

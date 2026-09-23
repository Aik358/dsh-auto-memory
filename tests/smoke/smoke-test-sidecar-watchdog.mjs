#!/usr/bin/env node
/**
 * smoke-test-sidecar-watchdog-pre.mjs —— 上游 #107 / #108 守卫套件(Python 语义侧车)。
 *
 * #107(挂死无人收尸):health()/restart() 零调用;超时只发 cancel 不 kill;熔断计数被「每段 begin
 *   成功帧」清零 ⇒ 峰值恒 1、阈值 3 永不达。
 * #108(stderr 结构性丢弃):4KB 尾部只暴露字节数,内容无任何读者 ⇒ Python traceback 永远看不到。
 *
 * 纪律:
 *   - **不启动、不杀任何 python 进程**:假 worker 用 `process.execPath`(node)执行,收帧不回/回帧/
 *     写带唯一标记的 stderr 后非零退出,三种模式各一个脚本。
 *   - 每个断言都对着**行为**,不只看源码文本;文本级断言只用于「契约仍在/没有越界联动」的反向锁。
 *   - 只读被改文件与它自己的产物;不改仓库任何文件。
 */
import { mkdtempSync, writeFileSync, rmSync, readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { randomBytes } from 'node:crypto'

const SRC = resolve('lib/python-sidecar-client.js')
if (!existsSync(SRC)) { console.error('请从仓库根运行(cwd=' + process.cwd() + ')'); process.exit(2) }
const CLIENT = await import(new URL('file://' + SRC).href)

let pass = 0, fail = 0
const ok = (c, name, extra) => {
  if (c) { pass++; console.log('  ok - ' + name) }
  else { fail++; console.error('  FAIL - ' + name + (extra == null ? '' : '  << ' + extra)) }
}
const eq = (a, b, name) => ok(a === b, name, 'got=' + JSON.stringify(a) + ' want=' + JSON.stringify(b))
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const hex = () => randomBytes(8).toString('hex')

const DIR = mkdtempSync(join(tmpdir(), 'sw-watchdog-'))
const NODE = process.execPath

/** 假 worker:收帧不回(挂死),进程常驻 —— 用来触发超时/心跳缺失。 */
const HANG = join(DIR, 'fake-hang.mjs')
writeFileSync(HANG, [
  'process.stdin.resume()',
  'setInterval(() => {}, 1000)',
  '',
].join('\n'), 'utf8')

/** 假 worker:合法回帧(终态成功路径)。payload 内容客户端不校验,只校验 envelope + type 对应。 */
const OKW = join(DIR, 'fake-ok.mjs')
writeFileSync(OKW, [
  'let buf = \'\'',
  'process.stdin.setEncoding(\'utf8\')',
  'process.stdin.on(\'data\', (d) => {',
  '  buf += d',
  '  let i',
  '  while ((i = buf.indexOf(String.fromCharCode(10))) !== -1) {',
  '    const line = buf.slice(0, i); buf = buf.slice(i + 1)',
  '    let req',
  '    try { req = JSON.parse(line) } catch (_) { continue }',
  '    if (!req || !req.requestId) continue',
  '    const t = req.type',
  '    const respType = t === \'health\' ? \'health_result\' : (t === \'context_push\' ? \'context_ack\' : \'index_ack\')',
  '    process.stdout.write(JSON.stringify({',
  '      protocolVersion: \'m7_wire_pre_v1\', frameId: \'f-\' + req.requestId, requestId: req.requestId,',
  '      workerEpoch: req.workerEpoch, type: respType, payload: {}, sentAt: Date.now(),',
  '    }) + String.fromCharCode(10))',
  '  }',
  '})',
  '',
].join('\n'), 'utf8')

/** 假 worker:往 stderr 写带唯一标记的 traceback 后非零退出(#108 的核心场景)。 */
function mkCrashWorker(marker, lines) {
  const p = join(DIR, 'fake-crash-' + marker + '.mjs')
  const body = []
  body.push('process.stderr.write(\'Traceback (most recent call last):\' + String.fromCharCode(10))')
  for (let k = 1; k <= lines; k++) {
    const text = k === lines ? marker : ('line-' + String(k).padStart(3, '0') + '-filler')
    body.push('process.stderr.write(\'' + text + '\' + String.fromCharCode(10))')
  }
  // 延迟 80ms 再退出:保证请求帧已在飞,退出落在 in-flight 期间 ⇒ 必然结算为 crashed
  body.push('setTimeout(() => process.exit(3), 80)')
  body.push('')
  writeFileSync(p, body.join('\n'), 'utf8')
  return p
}

/** 假 worker:stderr 零输出后非零退出(区分「确实没打印」与「输出被截」)。 */
const QUIET = join(DIR, 'fake-quiet-crash.mjs')
writeFileSync(QUIET, ['setTimeout(() => process.exit(7), 80)', ''].join('\n'), 'utf8')

function mkClient(over = {}) {
  return CLIENT.createPythonSidecarClientPre({
    command: NODE,
    scriptPath: () => (typeof over.scriptPath === 'function' ? over.scriptPath() : (over.script || HANG)),
    dshHome: '',
    requestTimeoutMs: over.requestTimeoutMs || 150,
    breakerCooldownMs: over.breakerCooldownMs === undefined ? 600 : over.breakerCooldownMs,
    breakerFailureThreshold: over.breakerFailureThreshold || 3,
    watchdogStallThreshold: over.watchdogStallThreshold === undefined ? 3 : over.watchdogStallThreshold,
  })
}

/** 生成一个与出站请求严格对齐的 PY 帧(用于把「段内进度帧成功」喂进解析器)。 */
function feedAckFor(c, phase) {
  const f = c._lastFrameForTest()
  const line = JSON.stringify({
    protocolVersion: 'm7_wire_pre_v1', frameId: 'f-' + f.requestId, requestId: f.requestId,
    workerEpoch: f.workerEpoch, type: 'index_ack', payload: { phase }, sentAt: Date.now(),
  }) + '\n'
  c._feedForTest(line)
  return f
}

/** 等到条件成立或超时(用于等 exit/close 事件落地)。 */
async function until(fn, ms = 2500) {
  const t0 = Date.now()
  for (;;) {
    let v = false
    try { v = fn() } catch (_) { v = false }
    if (v) return true
    if (Date.now() - t0 > ms) return false
    await sleep(25)
  }
}

console.log('\n[G1] 契约与影响面(源码级反向锁,不起进程)')
{
  const src = readFileSync(SRC, 'utf8')
  ok(src.includes('入站帧 epoch 不匹配即丢弃(fail closed)'), 'G1 #72 的 fail-closed 契约仍原文在场')
  ok(/if \(!epoch \|\| frame\.workerEpoch !== epoch\)/.test(src), 'G1 入站 epoch 门仍是 fail-closed 判据')
  ok(/const TERMINAL_SUCCESS_TYPES_PRE_V1 = new Set\(\['health', 'context_push', 'index_sync_commit'\]\)/.test(src),
    'G1 终态成功集合 = health/context_push/index_sync_commit')
  ok(!/TERMINAL_SUCCESS_TYPES_PRE_V1 = new Set\(\[[^\]]*index_sync_begin/.test(src),
    'G1 段内进度帧 index_sync_begin 不在终态集合(否则熔断永不可达)')
  ok(!/TERMINAL_SUCCESS_TYPES_PRE_V1 = new Set\(\[[^\]]*index_sync_page/.test(src),
    'G1 段内进度帧 index_sync_page 不在终态集合')
  // 影响面:只 import node 内置 + wire 模块;不得引用 JS 语义侧任何模块
  const imports = [...src.matchAll(/^import[\s\S]*?from '([^']+)'/gm)].map((m) => m[1])
  const allowed = new Set(['node:child_process', 'node:crypto', 'node:path', 'node:url', './m7-wire.js'])
  ok(imports.every((m) => allowed.has(m)), 'G1 依赖面收敛(Python 档自身)', JSON.stringify(imports))
  ok(!/semantic-js-pre|memory-hub-pre|fact-store-pre|procedure-store-pre|context-host-pre/.test(src),
    'G1 本模块不引用 JS 端语义模块(无联动)')
  // 不得硬编码 python:命令由调用方给,缺省才回落 'python'
  ok(/resolveOpt\('command'\) \|\| 'python'/.test(src), 'G1 python 命令仅为缺省回落,可被调用方覆盖')
}
console.log('\n[G2] 熔断口径:段内进度帧成功不清零 / 终态成功才清零(#107)')
{
  // 场景 A:超时与「begin ack 成功」交替 ⇒ 累计失败必须继续累加,第 3 次真失败即开闸。
  //   旧实现在每次 begin 成功时就清零 ⇒ consecutiveFailures 峰值恒 1、阈值不可达。
  const c = mkClient({ scriptPath: () => HANG, watchdogStallThreshold: 99, requestTimeoutMs: 120 })
  const r1 = await c.request('health')
  eq(r1.code, 'timeout', 'G2 A1 无响应 worker → 结构化 timeout')
  const f1 = c.debugView().breaker.consecutiveFailures
  eq(f1, 1, 'G2 A2 首次失败计 1')
  // 段内进度帧:index_sync_begin + 一条合法 index_ack → 成功,但**不得**清零
  const p = c.request('index_sync_begin', { syncId: 'syn_pre_' + '0'.repeat(32) })
  feedAckFor(c, 'begin')
  const rb = await p
  ok(rb.ok === true, 'G2 A3 段内 begin 帧构造为成功', JSON.stringify(rb && rb.code))
  eq(c.debugView().breaker.consecutiveFailures, 1, 'G2 A4 ★ 段内成功不清零(旧实现此处归 0 ⇒ 熔断永不触发)')
  await c.request('health')
  eq(c.debugView().breaker.consecutiveFailures, 2, 'G2 A5 第 2 次真失败累加到 2')
  await c.request('health')
  ok(c.breakerOpenForTest(), 'G2 A6 第 3 次真失败 → 熔断打开(阈值 3 真正可达)')
  await c.dispose('G2A')

  // 场景 B:终态成功必须清零。
  const c2 = mkClient({ scriptPath: () => OKW, requestTimeoutMs: 1500, breakerFailureThreshold: 3 })
  const bad = c2.request('index_sync_begin', { syncId: 'syn_pre_' + '0'.repeat(32) }, { timeoutMs: 120 })
  feedAckFor(c2, 'page') // 类型对但阶段无关:客户端只看 type ⇒ 这算成功
  const rbad = await bad
  void rbad
  const okh = await c2.request('health', {}, { timeoutMs: 2000 })
  ok(okh.ok === true, 'G2 B1 正常 worker 的 health 成功', JSON.stringify(okh && okh.code))
  eq(c2.debugView().breaker.consecutiveFailures, 0, 'G2 B2 ★ 终态成功(health)清零累计失败')
  await c2.dispose('G2B')
}
console.log('\n[G3] #108 stderr 尾部必须可见(内容有读者,不再只有字节数)')
{
  const marker = 'SW_TB_MARKER_' + hex()
  const crash = mkCrashWorker(marker, 3)
  const c = mkClient({ scriptPath: () => crash, requestTimeoutMs: 1200 })
  const r = await c.request('health')
  eq(r.code, 'crashed', 'G3 1 崩溃退出 → in-flight 请求结构化 crashed')
  ok(await until(() => c.debugView().lastStderrTail.includes(marker)), 'G3 2 ★ debugView().lastStderrTail 含 traceback 唯一标记(内容真的读得到了)')
  const dv = c.debugView()
  ok(dv.stats.lastStderrTail.includes(marker), 'G3 3 stats.lastStderrTail 同步可见')
  ok(dv.lastStderrTail.includes('Traceback (most recent call last):'), 'G3 4 首行 traceback 形状原样保留')
  ok(dv.stderrTailBytes > 0, 'G3 5 stderrTailBytes 仍保留(>0)')
  eq(dv.lastStderrTailTruncated, false, 'G3 6 短输出不触发截断')
  eq(dv.stats.exits, 1, 'G3 7 exits 计 1')
  eq(c._diagRingForTest.filter((d) => d.message.includes(marker)).length, 1, 'G3 8 ★ 同一次退出只落一条 diag(不刷屏)')
  const note = String(dv.stats.lastExitNote || '')
  ok(note.includes('第 1 代') && note.includes('code=3') && note.includes('崩溃退出'), 'G3 9 lastExitNote 是人话(代次/退出码/归因)', note)
  ok((dv.stats.exitKinds.crash || 0) >= 1, 'G3 10 exitKinds.crash 计入')
  ok(dv.recentDiag.some((d) => d.message.includes('stderr 原文')), 'G3 11 diag 带「stderr 原文」小节')
  await c.dispose('G3')

  const marker2 = 'SW_TAIL_MARKER_' + hex()
  const crash2 = mkCrashWorker(marker2, 40)
  const c2 = mkClient({ scriptPath: () => crash2, requestTimeoutMs: 1200 })
  await c2.request('health')
  ok(await until(() => c2.debugView().lastStderrTail.includes(marker2)), 'G3 12 长 stderr 也已捕获')
  const dv2 = c2.debugView()
  eq(dv2.lastStderrTailTruncated, true, 'G3 13 40 行 stderr → 标记为已截断')
  ok(dv2.lastStderrTail.includes('已按行/字符截断'), 'G3 14 截断时留说明(读者不会误以为这是全部输出)')
  ok(dv2.lastStderrTail.includes(marker2), 'G3 15 保留的是**尾部**(最后一行仍在)')
  ok(!dv2.lastStderrTail.includes('Traceback (most recent call last):'), 'G3 16 头部行按截断策略让位')
  ok(dv2.lastStderrTail.length < 1400, 'G3 17 单条 diag 文本长度有界', String(dv2.lastStderrTail.length))
  await c2.dispose('G3-2')

  const c3 = mkClient({ scriptPath: () => QUIET, requestTimeoutMs: 1200 })
  await c3.request('health')
  ok(await until(() => (c3.debugView().stats.exits || 0) >= 1), 'G3 18 静默崩溃进程已退出')
  await sleep(250)
  const dv3 = c3.debugView()
  eq(dv3.lastStderrTail, '', 'G3 19 零 stderr → lastStderrTail 为空串')
  eq(dv3.lastStderrTailTruncated, false, 'G3 20 零 stderr 与「被截断」可区分')
  ok(c3._diagRingForTest.some((d) => d.message.includes('确实没打印')), 'G3 21 diag 明说「确实没打印,不是被截断」')
  await c3.dispose('G3-3')
}
console.log('\n[G4] #107 看门狗:连续心跳缺失达阈值 ⇒ kill + 下次请求重生(真进程实测)')
{
  const c = mkClient({ scriptPath: () => HANG, requestTimeoutMs: 250, watchdogStallThreshold: 3, breakerFailureThreshold: 50 })
  eq((await c.request('health')).code, 'timeout', 'G4 1 第 1 次心跳缺失 → timeout')
  const oldChild = c.processForTest()
  const oldPid = oldChild.pid
  const epoch1 = c.currentEpoch()
  eq(c.debugView().watchdog.kills, 0, 'G4 2 未达阈值不击杀(避免偶发慢帧被误杀)')
  await c.request('health')
  eq(c.debugView().watchdog.kills, 0, 'G4 3 第 2 次仍未击杀')
  eq((await c.request('health')).code, 'timeout', 'G4 4 第 3 次仍先给调用方结构化 timeout')
  eq(c.debugView().watchdog.kills, 1, 'G4 5 ★ 达阈值 → 看门狗击杀旧进程(旧实现只发 cancel,从不 kill)')
  eq(c.debugView().watchdog.lastReason, '连续超时', 'G4 6 击杀原因记账')
  eq(c.isStarted(), false, 'G4 7 击杀后立即置空(不再向挂死进程发帧)')
  ok(await until(() => oldChild.exitCode !== null || oldChild.signalCode !== null, 3000),
    'G4 8 ★ 旧进程确实终止(exitCode/signalCode 已落地)', 'exitCode=' + oldChild.exitCode + ' signal=' + oldChild.signalCode)
  eq(c.debugView().stats.exitKinds.watchdog, 1, 'G4 9 归因记 watchdog,不与 crash 混计')
  ok(String(c.debugView().stats.lastExitNote).includes('看门狗主动击杀'), 'G4 10 lastExitNote 用中文说明是看门狗击杀')
  ok(c._diagRingForTest.some((d) => d.message.includes('心跳缺失')), 'G4 11 diag 说明连续心跳缺失与即将重生')
  eq((await c.request('health')).code, 'timeout', 'G4 12 重生后的新进程同样收帧不回 → 新一次 timeout')
  eq(c.debugView().stats.starts, 2, 'G4 13 ★ 下次请求确实重生新进程(lazy respawn)')
  ok(c.processForTest().pid !== oldPid, 'G4 14 新进程 pid 与旧不同')
  ok(c.currentEpoch() !== epoch1, 'G4 15 新 epoch ⇒ 旧 in-flight 与旧 index 缓存必然作废')
  eq(c.debugView().watchdog.respawns, 1, 'G4 16 重生计数与击杀分离记账')
  eq(c.debugView().stderrTailBytes, 0, 'G4 17 stderr 按世系隔离(新代未输出 ⇒ 0)')
  await c.dispose('G4')
}
console.log('\n[G5] 主动重启 / 崩溃退出 / dispose 三者归因必须分离')
{
  const c = mkClient({ scriptPath: () => HANG, requestTimeoutMs: 5000, watchdogStallThreshold: 99 })
  ok(c.ensureStarted().ok, 'G5 1 显式启动成功')
  const child = c.processForTest()
  c.restart('守卫套件:主动换代')
  eq(c.debugView().stats.restarts, 1, 'G5 2 restarts 计 1')
  ok(await until(() => child.exitCode !== null || child.signalCode !== null, 3000), 'G5 3 restart 后旧进程确实终止')
  eq(c.debugView().stats.exitKinds.restart, 1, 'G5 4 归因记 restart')
  ok(String(c.debugView().stats.lastExitNote).includes('restart() 主动重启'), 'G5 5 lastExitNote 明说「刻意换代,不是故障」')
  eq(c.debugView().stats.exitKinds.crash, 0, 'G5 6 ★ 主动重启不计入 crash(旧实现两者混在一个 exits 里)')
  await c.dispose('G5')
}
console.log('\n[G6] 模型友好:Python 档未启用时零进程零 IO,不作为 JS 语义生效的前提')
{
  const c = mkClient({})
  eq(c.debugView().stats.starts, 0, 'G6 1 仅构造不发进程(lazy start)')
  eq(c.debugView().started, false, 'G6 2 未启动')
  ok(!/semantic-js-pre|semantic-json|memory-hub-pre/.test(readFileSync(SRC, 'utf8')), 'G6 3 本模块不触碰 JS 语义实现')
  ok(readFileSync(SRC, 'utf8').includes('JS 语义默认 / Python 发烧友可选'), 'G6 4 文件头写明两条线互不联动')
  await c.dispose('G6')
  eq(c.debugView().stats.starts, 0, 'G6 5 空 dispose 同样零进程')
}

try { rmSync(DIR, { recursive: true, force: true }) } catch (_) {}
console.log('\n[sidecar-watchdog] ' + pass + ' passed, ' + fail + ' failed')
if (fail) process.exit(1)

/**
 * issue #341 回归锁 —— **行为级**（真 import → 真构造 → 真调用 → 断言返回值/副作用）。
 *
 * 缺陷形态：acquisition gate（`<canonical>.lock.acquire`）在取锁循环里被 `claim()` 认领，
 *   EEXIST 分支**只 catch、不回收**（旧注释主张「等所有实例停下再人工清理」）。于是：
 *     lib/shared-state-lock.js:57-63（async 版）与 :122-126（sync 版）两处取锁循环，
 *     以及 lib/config-lock.js:47-59 的 tryAcquire（withConfigLock / withConfigLockSync 的唯一路径），
 *   只要有一次「进程死在 claim(gate) 与 unlink(gate) 之间」（或门清理失败），
 *   留下的门就**无人能回收** ⇒ 之后每个进程的每一轮循环都卡在 claim(gate) 的 EEXIST 上，
 *   直到 timeoutMs 到点恒定抛 state-lock-timeout / config-lock-timeout：写入被永久堵死。
 *
 * 为什么必须行为级：本缺陷的判据是「**另一个真进程死掉之后**，本进程还能不能恢复正常」——
 *   源码里 grep 到 reclaim/unlink 只是恒真守卫，证明不了「真遗弃的门真被回收、活主的门真没被误删」。
 *   故本套件：真起子进程取门后 exit（真 ESRCH）、真起子进程持门不放、真并发回收，全部断言返回值/磁盘副作用。
 *
 * 故障注入**跨平台**：门文件只是普通文件，用「子进程写 owner 元数据后立刻 exit」制造真遗弃，
 *   不依赖 Windows 只读文件语义、也不依赖 POSIX 权限语义；活主对照用**本进程** pid
 *   （process.kill(pid,0) 必然成功 ⇒ 必须判为「不回收」）。
 *
 * 运行：node tests/smoke/smoke-test-issue341-lockgate.mjs
 * 退出码：有 FAIL 即 1（变异子进程的红由**父进程**断言，父进程自身应为绿）。
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync, spawn } from 'node:child_process'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = path.resolve(fileURLToPath(new URL('../..', import.meta.url)))
const REAL_LOCK = path.join(ROOT, 'lib', 'shared-state-lock.js')
const REAL_CFG = path.join(ROOT, 'lib', 'config-lock.js')
// LOCK_PATH / CFG_PATH 只给变异子进程用：指向「把 #341 修复退回旧写法」的副本。
const LOCK_PATH = process.env.LOCK_PATH ? path.resolve(process.env.LOCK_PATH) : REAL_LOCK
const CFG_PATH = process.env.CFG_PATH ? path.resolve(process.env.CFG_PATH) : REAL_CFG
const CHILD = process.env.I341_CHILD === '1'
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'i341-lockgate-'))

let pass = 0
let fail = 0
function ok(cond, name, extra) {
  if (cond) { pass++; console.log('  ok - ' + name) }
  else { fail++; console.error('  FAIL - ' + name + (extra ? ' :: ' + extra : '')) }
}
const loadLock = () => import(pathToFileURL(LOCK_PATH).href)
function fresh(name) { const d = path.join(TMP, name); fs.mkdirSync(d, { recursive: true }); return d }

/** ★跨平台取证：造一个**真死主**门（真子进程写 owner 后 exit ⇒ 真 ESRCH，不靠打桩/只读语义）。 */
function abandonGate(gate) {
  const script = path.join(TMP, 'abandon-gate.mjs')
  fs.writeFileSync(script, [
    'import fs from "node:fs"',
    'import os from "node:os"',
    'fs.writeFileSync(process.argv[2], JSON.stringify({ pid: process.pid, host: os.hostname() }), "utf8")',
  ].join('\n'))
  const r = spawnSync(process.execPath, [script, gate], { encoding: 'utf8' })
  if (r.status !== 0) throw new Error('abandon-gate 子进程失败: ' + String(r.stderr || '').slice(0, 300))
}
/** 探针：该 pid 是否真的已消失（判据本身不许是「猜」）。 */
function pidGone(pid) {
  try { process.kill(pid, 0); return false } catch (e) { return e.code === 'ESRCH' }
}

async function main() {
  const lock = await loadLock()
  const cfg = await import(pathToFileURL(CFG_PATH).href)
  console.log('=== issue #341 acquisition-gate 回收 行为级回归' + (CHILD ? ' [变异子进程模式]' : '') + ' ===')

  // ===================================================================
  // ① 报告症状的真复现：遗弃的门存在 ⇒ 修复前恒定抛 state-lock-timeout
  //    先钉「前提确实成立」：门在、owner 是真死主、且与本进程同主机。
  // ===================================================================
  {
    const dir = fresh('abandoned')
    const target = path.join(dir, 'state.json')
    const gate = target + '.lock.acquire'
    abandonGate(gate)
    const owner = JSON.parse(fs.readFileSync(gate, 'utf8'))
    ok(pidGone(owner.pid), '#341 前提:门 owner 是真死主(子进程已 exit ⇒ ESRCH)', 'pid=' + owner.pid)
    ok(owner.host === os.hostname(), '#341 前提:门 owner 与本进程同主机(死主判据的前提)', String(owner.host))
    const t0 = Date.now()
    let release = null
    let threw = null
    try { release = await lock.acquireSharedStateLock(target, { timeoutMs: 2000 }) } catch (e) { threw = e }
    const elapsed = Date.now() - t0
    ok(threw === null && typeof release === 'function', '★#341 async:遗弃门被回收 ⇒ 取锁成功(旧实现恒定 state-lock-timeout)',
      threw ? String(threw.message) : 'ok')
    ok(elapsed < 1500, '★#341 async:回收后**不必**等满超时上限(门在首轮就被回收)', 'elapsed=' + elapsed + 'ms')
    if (release) release()
    ok(!fs.existsSync(gate), '★#341 async:回收后门文件已消失(不再继续堵后面的进程)')
    ok(!fs.existsSync(target + '.lock'), '★#341 async:释放后锁文件已消失')
  }

  // ===================================================================
  // ② 同步版同一判据（memory-writer 的 _queue 走的正是这条）
  // ===================================================================
  {
    const dir = fresh('abandoned-sync')
    const target = path.join(dir, 'doc.md')
    const gate = target + '.lock.acquire'
    abandonGate(gate)
    const t0 = Date.now()
    let release = null
    let threw = null
    try { release = lock.acquireSharedStateLockSync(target, { timeoutMs: 2000, pollMs: 20 }) } catch (e) { threw = e }
    const elapsed = Date.now() - t0
    ok(threw === null && typeof release === 'function', '★#341 sync:遗弃门被回收 ⇒ 取锁成功(旧实现恒定 state-lock-timeout)',
      threw ? String(threw.message) : 'ok')
    ok(elapsed < 1500, '★#341 sync:回收后不必等满超时上限', 'elapsed=' + elapsed + 'ms')
    if (release) release()
    ok(!fs.existsSync(gate), '★#341 sync:回收后门文件已消失')
  }

  // ===================================================================
  // ③ withConfigLock / withConfigLockSync（第三条路径）—— 门遗弃后配置仍可写
  // ===================================================================
  {
    const dir = fresh('cfg-abandoned')
    const cfgFile = path.join(dir, 'settings.json')
    fs.writeFileSync(cfgFile, JSON.stringify({ v: 1 }), 'utf8')
    const gate = cfgFile + '.lock.acquire'
    abandonGate(gate)
    ok(fs.existsSync(gate), '#341 前提:config 门的遗弃门确已就位')
    let wroteAsync = false
    let threwAsync = null
    try { await cfg.withConfigLock(cfgFile, async () => { wroteAsync = true }, { timeoutMs: 2000 }) } catch (e) { threwAsync = e }
    ok(threwAsync === null && wroteAsync, '★#341 withConfigLock:遗弃门被回收 ⇒ 事务正常执行(旧实现恒定 config-lock-timeout)',
      threwAsync ? String(threwAsync.message) : 'ok')
    abandonGate(gate)
    let wroteSync = false
    let threwSync = null
    try { cfg.withConfigLockSync(cfgFile, () => { wroteSync = true }) } catch (e) { threwSync = e }
    ok(threwSync === null && wroteSync, '★#341 withConfigLockSync:遗弃门被回收 ⇒ 事务正常执行(旧实现恒定 CONFIG_LOCK_BUSY)',
      threwSync ? String(threwSync.message) : 'ok')
    ok(!fs.existsSync(gate), '★#341 config:两条路径都把遗弃门清掉了')
  }

  // ===================================================================
  // ④ ★负路径 A：**活主**的门绝不许被回收（宁可超时，也不破坏互斥）
  //    用**本进程**的 pid 做活主：process.kill(pid,0) 必然成功 ⇒ isDead=false。
  // ===================================================================
  {
    const dir = fresh('live-owner')
    const target = path.join(dir, 'state.json')
    const gate = target + '.lock.acquire'
    fs.writeFileSync(gate, JSON.stringify({ pid: process.pid, host: os.hostname() }), 'utf8')
    const before = fs.readFileSync(gate, 'utf8')
    let threw = null
    try { await lock.acquireSharedStateLock(target, { timeoutMs: 300 }) } catch (e) { threw = e }
    ok(!!threw && /state-lock-timeout/.test(String(threw.message)),
      '★#341 负路径:活主门**必须**照旧超时(不许为了「恢复」去误删活进程的门)', threw ? threw.message : 'NO-THROW')
    ok(fs.existsSync(gate) && fs.readFileSync(gate, 'utf8') === before,
      '★#341 负路径:活主门**逐字节未被改动**(误删活主门=互斥被破坏)', fs.existsSync(gate) ? 'intact' : 'DELETED')
    fs.unlinkSync(gate)
  }
  {
    const dir = fresh('live-owner-sync')
    const target = path.join(dir, 'doc.md')
    const gate = target + '.lock.acquire'
    fs.writeFileSync(gate, JSON.stringify({ pid: process.pid, host: os.hostname() }), 'utf8')
    let threw = null
    try { lock.acquireSharedStateLockSync(target, { timeoutMs: 300, pollMs: 20 }) } catch (e) { threw = e }
    ok(!!threw && /state-lock-timeout/.test(String(threw.message)), '★#341 负路径 sync:活主门照旧超时', threw ? threw.message : 'NO-THROW')
    ok(fs.existsSync(gate), '★#341 负路径 sync:活主门仍在(未被误删)')
    fs.unlinkSync(gate)
  }
  {
    const dir = fresh('cfg-live-owner')
    const cfgFile = path.join(dir, 'settings.json')
    const gate = cfgFile + '.lock.acquire'
    fs.writeFileSync(gate, JSON.stringify({ pid: process.pid, host: os.hostname() }), 'utf8')
    let threw = null
    let ran = false
    try { cfg.withConfigLockSync(cfgFile, () => { ran = true }) } catch (e) { threw = e }
    ok(!ran && !!threw && /config-lock-busy/.test(String(threw.message)),
      '★#341 负路径 config:活主门 ⇒ 照旧 CONFIG_LOCK_BUSY(不误删活主的门)', threw ? threw.message : 'NO-THROW')
    ok(fs.existsSync(gate), '★#341 负路径 config:活主门仍在')
    fs.unlinkSync(gate)
  }

  // ===================================================================
  // ⑤ ★负路径 B：**异主机**的门不许被回收（判据必须含 host 校验）
  // ===================================================================
  {
    const dir = fresh('foreign-host')
    const target = path.join(dir, 'state.json')
    const gate = target + '.lock.acquire'
    // pid 用一个必然不存在的值，但 host 写成别的机器 ⇒ isDead 必须为 false
    fs.writeFileSync(gate, JSON.stringify({ pid: 999999, host: 'some-other-host' }), 'utf8')
    let threw = null
    try { await lock.acquireSharedStateLock(target, { timeoutMs: 300 }) } catch (e) { threw = e }
    ok(!!threw && /state-lock-timeout/.test(String(threw.message)),
      '★#341 负路径:异主机门**不回收**(跨主机 pid 判据无意义，回收会破坏互斥)', threw ? threw.message : 'NO-THROW')
    ok(fs.existsSync(gate), '★#341 负路径:异主机门仍在')
    fs.unlinkSync(gate)
  }

  // ===================================================================
  // ⑥ ★负路径 C：元数据不可解析且**未超宽限**的门不许被回收
  //    claim() 是「先 openSync('wx') 再 writeFileSync」⇒「空门」是真实存在的窗口；
  //    误删刚创建的空门 = 两个进程同时进临界区。
  // ===================================================================
  {
    const dir = fresh('young-empty-gate')
    const target = path.join(dir, 'state.json')
    const gate = target + '.lock.acquire'
    fs.writeFileSync(gate, '', 'utf8')   // 空门：模拟「另一个进程刚 openSync、还没写完」
    let threw = null
    try { await lock.acquireSharedStateLock(target, { timeoutMs: 300, gateStaleMs: 60000 }) } catch (e) { threw = e }
    ok(!!threw && /state-lock-timeout/.test(String(threw.message)),
      '★#341 负路径:年轻空门**不回收**(否则等于放开互斥)', threw ? threw.message : 'NO-THROW')
    ok(fs.existsSync(gate), '★#341 负路径:年轻空门仍在')
    // 正路径对照：同一空门，等它超过宽限（用 utimes 回拨模拟，跨平台、不用真 sleep 60s）
    const past = new Date(Date.now() - 120000)
    fs.utimesSync(gate, past, past)
    let release = null
    let threw2 = null
    try { release = await lock.acquireSharedStateLock(target, { timeoutMs: 2000, gateStaleMs: 30000 }) } catch (e) { threw2 = e }
    ok(threw2 === null && typeof release === 'function',
      '★#341 正路径:超过宽限的**陈旧空门**被回收 ⇒ 取锁成功(崩溃留下的空门不再永久堵死)',
      threw2 ? String(threw2.message) : 'ok')
    if (release) release()
  }

  // ===================================================================
  // ⑦ ★并发回收：多进程同时撞一个遗弃门 ⇒ 全部最终取到锁，且临界区从未重叠
  // ===================================================================
  {
    const dir = fresh('concurrent-reclaim')
    const target = path.join(dir, 'state.json')
    const gate = target + '.lock.acquire'
    abandonGate(gate)
    const markerDir = path.join(dir, 'markers')
    fs.mkdirSync(markerDir)
    // ★重叠判据必须是「**此刻在临界区内的进程数**」，而不是「标记目录里有几个文件」：
    //   标记若不在退出时删除，后进者会把**已经出去的**前驱当成重叠（本套件初版就这样误红过）。
    //   故：进入时先读目录（>0 ⇒ 真重叠，如实记 OVERLAP），再写自己的标记，退出前删掉自己的标记。
    const worker = path.join(TMP, 'concurrent-worker.mjs')
    fs.writeFileSync(worker, [
      'import { pathToFileURL } from "node:url"',
      'import fs from "node:fs"',
      'const mod = await import(pathToFileURL(process.env.LOCK_PATH).href)',
      'const [target, stageDir] = process.argv.slice(2)',
      'try {',
      '  const release = await mod.acquireSharedStateLock(target, { timeoutMs: 5000 })',
      '  const inside = fs.readdirSync(stageDir).length   // >0 ⇒ 有人与我同时在内 ⇒ 互斥被破坏',
      '  fs.writeFileSync(stageDir + "/" + process.pid, String(inside))',
      '  await new Promise((r) => setTimeout(r, 200))     // 撑开窗口：真重叠必然被后进者看到',
      '  fs.unlinkSync(stageDir + "/" + process.pid)',
      '  release()',
      '  console.log("HELD inside=" + inside)',
      '} catch (e) { console.log("TIMEOUT " + e.message) }',
    ].join('\n'))
    const runOne = () => new Promise((resolve) => {
      const p = spawn(process.execPath, [worker, target, markerDir], {
        env: { ...process.env, LOCK_PATH }, stdio: ['ignore', 'pipe', 'pipe'],
      })
      let out = ''
      p.stdout.on('data', (d) => { out += String(d) })
      p.stderr.on('data', (d) => { out += String(d) })
      p.on('close', (code) => resolve({ code, out }))
    })
    const results = await Promise.all([runOne(), runOne(), runOne()])
    const held = results.filter((r) => /HELD/.test(r.out)).length
    const timedOut = results.filter((r) => /TIMEOUT/.test(r.out)).length
    ok(held === 3, '★#341 并发:三个进程**全部**在遗弃门存在时取到锁(旧实现:全部超时)', 'held=' + held + ' timedOut=' + timedOut + ' :: ' + JSON.stringify(results.map((r) => r.out.trim())))
    const overlap = results.some((r) => /HELD inside=[1-9]/.test(r.out))
    ok(!overlap, '★#341 并发:临界区**从未同时进入两个进程**(进入时所见「在内进程数」恒为 0)',
      JSON.stringify(results.map((r) => (r.out.match(/inside=\d+/) || [''])[0])))
    ok(fs.readdirSync(markerDir).length === 0, '★#341 并发:三个进程都真进过又都退出了临界区(标记已全部自删)',
      'leftover=' + fs.readdirSync(markerDir).join(','))
  }

  console.log('pass=' + pass + ' fail=' + fail)
  if (!CHILD) fs.rmSync(TMP, { recursive: true, force: true })

  // ===================================================================
  // ★变异反向验证：把两处修复分别退回旧写法，再以子进程模式跑本套件 ⇒ **必红**
  //   （判据：fail>0 且退出码非 0，且是**断言红**而不是崩溃）。
  // ===================================================================
  if (!CHILD) {
    // 上面已把 TMP 清掉（父进程收尾），变异验证需要自己的临时目录 ⇒ 重建。
    fs.mkdirSync(TMP, { recursive: true })
    const real = fs.readFileSync(REAL_LOCK, 'utf8')
    const realCfg = fs.readFileSync(REAL_CFG, 'utf8')
    const cases = []
    // M1：async 版把门回收退回「只 catch 不回收」
    const M1_FROM = '      gateReclaimed = reclaimDeadGate(gate, gateStaleMs)'
    const m1Hits = real.split(M1_FROM).length - 1
    ok(m1Hits === 2, '变异定位:#341 门回收调用点恰命中 2 次（async+sync）', 'hits=' + m1Hits)
    cases.push(['#341 async 回退(门不回收)', path.join(TMP, 'mut-341-async.mjs'), real.replace(/\n(\s*)gateReclaimed = reclaimDeadGate\(gate, gateStaleMs\)/g, '\n$1/* mutated: gate not reclaimed */')])
    // M2：元数据不可解析的陈旧门不再回收（宽限分支摘掉）
    const M2_FROM = '    if (Date.now() - before.mtimeMs < staleMs) return false'
    ok(real.split(M2_FROM).length - 1 === 1, '变异定位:#341 陈旧空门宽限分支恰命中 1 次')
    cases.push(['#341 陈旧空门不回收', path.join(TMP, 'mut-341-stale.mjs'), real.replace(M2_FROM, '    if (true) return false')])
    // M3：config-lock 的 tryAcquire 退回「门占着就直接返回 null」
    // ★必须写在 **lib/ 里**（不能放 TMP）：config-lock.js 有相对导入 './shared-state-lock.js'，
    //   放到别处会因解析不到兄弟模块而变成「模块加载崩溃」，那是假红（本套件已实测踩到一次）。
    const m3Path = path.join(ROOT, 'lib', '__mut-341-config-lock.mjs')
    const m3 = realCfg.replace('      if (attempt === 0 && reclaimDeadGate(gate)) continue', '      /* mutated: no reclaim */')
    ok(m3 !== realCfg, '变异定位:#341 config-lock 门回收分支已命中')
    for (const [label, mp, src] of cases) {
      fs.writeFileSync(mp, src)
      const syn = spawnSync(process.execPath, ['--check', mp], { encoding: 'utf8' })
      ok(syn.status === 0, '变异文件语法可用(' + label + ')', String(syn.stderr || '').slice(0, 200))
      const r = spawnSync(process.execPath, [fileURLToPath(import.meta.url)], { env: { ...process.env, LOCK_PATH: mp, CFG_PATH: label.indexOf('config') >= 0 ? mp : REAL_CFG, I341_CHILD: '1' }, encoding: 'utf8', maxBuffer: 1 << 26 })
      const out = String(r.stdout || '') + String(r.stderr || '')
      const m = out.match(/pass=(\d+) fail=(\d+)/)
      ok(r.status !== 0, '★变异必红(' + label + '):子进程退出码非 0', 'status=' + r.status)
      ok(/FAIL - /.test(out), '★变异必红(' + label + '):是断言红(有 FAIL 行)不是崩溃', out.slice(-300))
      ok(!!m && Number(m[2]) > 0, '★变异必红(' + label + '):fail>0', m ? m[0] : '(未取到计数)')
      console.log('  [变异取证] ' + label + ' -> ' + (m ? m[0] : '?') + ' exit=' + r.status)
    }
    // M3 单独跑（它只换 config-lock）；无论结果如何都要把临时变异文件删掉，不留脏文件。
    try {
      fs.writeFileSync(m3Path, m3)
      const syn3 = spawnSync(process.execPath, ['--check', m3Path], { encoding: 'utf8' })
      ok(syn3.status === 0, '变异文件语法可用(#341 config-lock)', String(syn3.stderr || '').slice(0, 200))
      const r3 = spawnSync(process.execPath, [fileURLToPath(import.meta.url)], { env: { ...process.env, LOCK_PATH: REAL_LOCK, CFG_PATH: m3Path, I341_CHILD: '1' }, encoding: 'utf8', maxBuffer: 1 << 26 })
      const o3 = String(r3.stdout || '') + String(r3.stderr || '')
      const m3m = o3.match(/pass=(\d+) fail=(\d+)/)
      ok(r3.status !== 0, '★变异必红(#341 config-lock 门不回收):子进程退出码非 0', 'status=' + r3.status)
      ok(/FAIL - /.test(o3), '★变异必红(#341 config-lock):是断言红不是崩溃', o3.slice(-300))
      ok(!!m3m && Number(m3m[2]) > 0, '★变异必红(#341 config-lock):fail>0', m3m ? m3m[0] : '(未取到计数)')
      console.log('  [变异取证] #341 config-lock 门不回收 -> ' + (m3m ? m3m[0] : '?') + ' exit=' + r3.status)
    } finally { try { fs.rmSync(m3Path, { force: true }) } catch (_) {} }
  }

  process.exit(fail ? 1 : 0)
}

main().catch((e) => {
  console.error('套件自身异常:', (e && e.stack) || e)
  process.exit(1)
})

/**
 * issue #342 回归锁 —— **行为级**（真 import → 真构造 → 真调用 → 断言返回值/副作用）。
 *
 * 缺陷形态：出站队列的写路径在**取不到互斥锁**时只 failPre（记 diag/lastError），然后**继续写盘**：
 *   lib/team-outbox.js:579（writeLockedPre）、:616（wipeLockedPre）、:438（snapshotLockedPre 取锁失败
 *   仍让 release=null 继续走到 commitPre）。降级后的动作退化成「无锁的读-改-写 + 整份快照写回」，
 *   正是 #307 要修的形状：两个进程各自读、各自写 ⇒ 先写者的事件被后写者的旧快照抹掉，
 *   而**双方都拿到 ok:true**（丢事件却双双谎报成功）。
 *
 * ★用户裁定方案 (a)（2026-10-13）：未取得互斥锁时**不得**发布快照 / 清空 / 确认；
 *   必须返回可重试失败(ok:false)并**保留未提交数据**。原注释里的 fail-soft 设计已被推翻。
 *
 * 本套件断言的核心不变量（与调度无关，故是确定性的）：
 *   ① **成功回执 ⇒ 事件确实在盘上**（绝不出现「ok:true 但盘上没有」）；
 *   ② 锁被占时 enqueue/clear/flush 一律 ok:false 且磁盘**逐字节未变**、内存队列**原样保留**；
 *   ③ 锁释放后重试成功，且**双方事件都在**（A/B 都不丢）；
 *   ④ 负路径：无锁时**绝不写盘**（这是消除丢事件窗口的直接证据）。
 *
 * 故障注入**跨平台**：占用锁用**真的** lib/shared-state-lock.js（与出站队列同一条 wx 认领原语、
 *   同一个 <canonical>.lock 文件），不依赖 Windows 只读语义、也不依赖 POSIX 权限语义。
 *
 * 运行：node tests/smoke/smoke-test-issue342-outbox-lock.mjs
 * 退出码：有 FAIL 即 1（变异子进程的红由**父进程**断言，父进程自身应为绿）。
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawn, spawnSync } from 'node:child_process'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = path.resolve(fileURLToPath(new URL('../..', import.meta.url)))
const REAL_SRC = path.join(ROOT, 'lib', 'team-outbox.js')
const REAL_LOCK = path.join(ROOT, 'lib', 'shared-state-lock.js')
// OUTBOX_PATH 只给变异子进程用：指向「把 #342 修复退回旧写法」的副本。
const OUTBOX_PATH = process.env.OUTBOX_PATH ? path.resolve(process.env.OUTBOX_PATH) : REAL_SRC
const CHILD = process.env.I342_CHILD === '1'
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'i342-outbox-'))

let pass = 0
let fail = 0
function ok(cond, name, extra) {
  if (cond) { pass++; console.log('  ok - ' + name) }
  else { fail++; console.error('  FAIL - ' + name + (extra ? ' :: ' + extra : '')) }
}
const loadOutbox = () => import(pathToFileURL(OUTBOX_PATH).href)
const loadLock = () => import(pathToFileURL(REAL_LOCK).href)
function fresh(name) { const d = path.join(TMP, name); fs.mkdirSync(d, { recursive: true }); return d }
const queueFile = (dir) => path.join(dir, 'team-outbox.json')
function diskRaw(dir) { try { return fs.readFileSync(queueFile(dir), 'utf8') } catch (e) { return null } }
function disk(dir) { try { return JSON.parse(fs.readFileSync(queueFile(dir), 'utf8')) } catch (e) { return null } }
function diskKeys(dir) { const d = disk(dir); return ((d && d.items) || []).map((i) => i.key).sort() }

async function main() {
  const { createTeamOutbox } = await loadOutbox()
  const lockMod = await loadLock()
  console.log('=== issue #342 出站队列「无锁不写盘」行为级回归' + (CHILD ? ' [变异子进程模式]' : '') + ' ===')

  // ===================================================================
  // ① ★enqueue：锁被别的进程占着 ⇒ ok:false + 磁盘逐字节未变 + 内存保留未提交数据
  // ===================================================================
  {
    const dir = fresh('enqueue-lock-busy')
    const ob = createTeamOutbox({ dir, lockTimeoutMs: 150 })
    ob.enqueue({ kind: 'handoff', key: 'SEED', payload: { n: 0 } })
    const before = diskRaw(dir)
    const releaseHeld = await lockMod.acquireSharedStateLock(queueFile(dir), { timeoutMs: 5000 })
    let r = null
    let threw = null
    try { r = ob.enqueue({ kind: 'handoff', key: 'A', payload: { n: 1 } }) } catch (e) { threw = e }
    ok(threw === null, '#342 enqueue 无锁时不抛（契约=结构化返回）', threw && threw.message)
    ok(r && r.ok === false, '★#342 enqueue 取不到锁 ⇒ ok:false（旧实现:fail-soft 回 ok:true 并写盘）', JSON.stringify(r))
    ok(r && /lock unavailable/.test(String(r.reason || '')), '★#342 失败原因可读、可重试（带 lock unavailable/timeout）', String(r && r.reason))
    ok(diskRaw(dir) === before, '★#342 无锁时磁盘**逐字节未变**（这是消除丢事件窗口的直接证据）',
      'before=' + JSON.stringify(String(before).slice(0, 60)) + ' after=' + JSON.stringify(String(diskRaw(dir)).slice(0, 60)))
    ok(ob.size() === 2, '★#342 未提交数据保留在内存队列（A 没被丢掉，size=2）', 'size=' + ob.size())
    ok(ob.list().some((it) => it.key === 'A'), '★#342 内存里确实还有 A（可重试）', JSON.stringify(ob.list().map((i) => i.key)))
    ok(ob.list().find((i) => i.key === 'A').persisted !== true, '★#342 A 的 persisted 仍为 false（如实表达「尚未落盘」）')
    // 锁释放 ⇒ 同条重试必须成功，且 SEED 与 A **都在**
    releaseHeld()
    const r2 = ob.enqueue({ kind: 'handoff', key: 'A', payload: { n: 1 } })
    ok(r2 && r2.ok === true, '★#342 锁释放后重试成功（前一次只是「可重试失败」，不是丢弃）', JSON.stringify(r2))
    ok(diskKeys(dir).join(',') === 'A,SEED', '★#342 重试后磁盘上 A 与 SEED **都在**（没有任何一方被覆盖）', JSON.stringify(diskKeys(dir)))
  }

  // ===================================================================
  // ② ★clear：锁被占 ⇒ 不清空、不落盘；内存与磁盘双双原样
  // ===================================================================
  {
    const dir = fresh('clear-lock-busy')
    const ob = createTeamOutbox({ dir, lockTimeoutMs: 150 })
    ob.enqueue({ kind: 'handoff', key: 'K1', payload: {} })
    ob.enqueue({ kind: 'handoff', key: 'K2', payload: {} })
    const before = diskRaw(dir)
    const releaseHeld = await lockMod.acquireSharedStateLock(queueFile(dir), { timeoutMs: 5000 })
    const c = await ob.clear()
    ok(c && c.ok === false, '★#342 clear 取不到锁 ⇒ ok:false（不谎报已清空）', JSON.stringify(c))
    ok(diskRaw(dir) === before, '★#342 clear 无锁时磁盘**逐字节未变**（绝不无锁擦除）')
    ok(ob.size() === 2, '★#342 clear 失败后**内存队列原样保留**（旧实现先 queue.length=0 ⇒ 未提交数据被丢）', 'size=' + ob.size())
    releaseHeld()
    const c2 = await ob.clear()
    ok(c2 && c2.ok === true, '★#342 锁可用后 clear 成功', JSON.stringify(c2))
    ok(ob.size() === 0 && diskKeys(dir).length === 0, '★#342 成功清空：内存与磁盘都空了')
  }

  // ===================================================================
  // ③ ★flush：锁被占 ⇒ 取快照就失败 ⇒ **一条都不发**，队列原样保留、如实上报
  // ===================================================================
  {
    const dir = fresh('flush-lock-busy')
    const ob = createTeamOutbox({ dir, lockTimeoutMs: 150 })
    ob.enqueue({ kind: 'handoff', key: 'F1', payload: {} })
    const before = diskRaw(dir)
    const releaseHeld = await lockMod.acquireSharedStateLock(queueFile(dir), { timeoutMs: 5000 })
    const sent = [];
    const fr = await ob.flush(async (it) => { sent.push(it.key) })
    ok(sent.length === 0, '★#342 flush 无锁时**一条都不发**（拿不到持久保证的发送只是徒劳）', JSON.stringify(sent))
    ok(fr.sent === 0 && fr.failed === 1, '★#342 flush 如实上报 tick 级失败(sent=0, failed=1)', JSON.stringify(fr))
    ok(fr.persisted === false, '★#342 flush 上报 persisted:false（调用方据此判 offline）', JSON.stringify(fr))
    ok(diskRaw(dir) === before && diskKeys(dir).join(',') === 'F1', '★#342 flush 无锁时磁盘未变、事件仍在（等下个 tick 重发）', JSON.stringify(diskKeys(dir)))
    releaseHeld()
    const sent2 = []
    const fr2 = await ob.flush(async (it) => { sent2.push(it.key) })
    ok(fr2.sent === 1 && sent2.join(',') === 'F1', '★#342 锁可用后正常发出（证明前一次只是暂缓，不是丢弃）', JSON.stringify(fr2))
    ok(diskKeys(dir).length === 0, '★#342 发出并确认后磁盘清空')
  }

  // ===================================================================
  // ④ ★snapshotLockedPre 的「未持久条目重试落盘」分支：无锁时也必须 fail-closed
  //    构造：内存里有一条 persisted!==true 的条目（首次落盘被人为挡掉）⇒ 取快照时本想重试落盘，
  //    此刻若锁被占，**绝不允许**走 commitPre 无锁写盘。
  // ===================================================================
  {
    const dir = fresh('snapshot-unpersisted-lock-busy')
    const ob = createTeamOutbox({ dir, lockTimeoutMs: 150 })
    const qf = queueFile(dir)
    // ★前提必须**先让 load 成功**（否则 enqueue 在 load 阶段就早退，队列压根不会有条目，
    //   本用例想覆盖的「未持久条目重试落盘」分支根本走不到 —— 这是本套件初版的自身缺陷）。
    fs.writeFileSync(qf, JSON.stringify({ v: 1, items: [] }), 'utf8')
    ob.load()
    // 注入：把队列文件**路径**占成目录 ⇒ 原子 rename 必失败（Windows 目标为目录/权限拒绝；
    //   Linux rename(file,dir) ⇒ EISDIR）。跨平台，且不依赖只读文件语义。
    fs.rmSync(qf, { force: true })
    fs.mkdirSync(qf)
    let injEffective = false
    try {
      const t = path.join(dir, '.probe-tmp')
      fs.writeFileSync(t, 'x')
      try { fs.renameSync(t, qf) } catch (_) { injEffective = true }
      try { fs.rmSync(t, { force: true }) } catch (_) {}
    } catch (_) {}
    const r1 = ob.enqueue({ kind: 'handoff', key: 'U1', payload: {} })
    fs.rmdirSync(qf)
    fs.writeFileSync(qf, JSON.stringify({ v: 1, items: [] }), 'utf8')   // 恢复成合法空队列，供后续字节比对
    ok(injEffective, '#342 前提:本平台的「目标占成目录」注入确实挡得住 rename（挡不住则以下前提断言如实跳过）'
      + (injEffective ? '' : ' [SKIP: 注入在本平台无效]'))
    ok(!injEffective || (r1 && r1.ok === false), '#342 前提:首跳落盘确实失败（ok:false）', JSON.stringify(r1))
    ok(!injEffective || (ob.size() === 1 && ob.list()[0].persisted !== true),
      '#342 前提:内存里留着一条**未持久**条目', JSON.stringify(ob.list()))
    const releaseHeld = await lockMod.acquireSharedStateLock(queueFile(dir), { timeoutMs: 5000 })
    const before = diskRaw(dir)
    const sent = []
    const fr = await ob.flush(async (it) => { sent.push(it.key) })
    ok(sent.length === 0, '★#342 未持久条目 + 无锁 ⇒ 仍然一条都不发', JSON.stringify(sent))
    ok(fr.persisted === false, '★#342 未持久条目 + 无锁 ⇒ 如实上报 persisted:false', JSON.stringify(fr))
    ok(diskRaw(dir) === before, '★#342 未持久条目 + 无锁 ⇒ **绝无无锁写盘**（旧实现此处继续 commitPre）')
    ok(!injEffective || ob.size() === 1, '★#342 未持久条目原样留在内存（等下个 tick）', 'size=' + ob.size())
    releaseHeld()
    const fr2 = await ob.flush(async () => {})
    // ★断言的是「未持久条目被带入 drain 快照并真的发出」：#308 的重试语义若被回退，该条会被当成
    //   「已发出」而根本不进快照 ⇒ sent 恒为 0。发成功之后队列被确认清空（diskKeys 为空）才是正确终态。
    ok(!injEffective || (fr2.sent === 1 && fr2.persisted !== false && ob.size() === 0),
      '★#342 锁可用后未持久条目被重试落盘并发出（#308 的重试语义未被回退）',
      JSON.stringify(fr2) + ' diskKeys=' + JSON.stringify(diskKeys(dir)) + ' size=' + ob.size())
  }

  // ===================================================================
  // ⑤ ★真双进程交错：**成功回执 ⇒ 事件确实在盘上**（与调度无关的确定性判据）
  //    两个真子进程并发入队 A / B（锁争用随机发生）——不允许出现「ok:true 却在盘上找不到」。
  // ===================================================================
  {
    const dir = fresh('two-process')
    const worker = path.join(TMP, 'enqueue-worker.mjs')
    fs.writeFileSync(worker, [
      'import { pathToFileURL } from "node:url"',
      'const mod = await import(pathToFileURL(process.env.OUTBOX_PATH).href)',
      'const [dir, key] = process.argv.slice(2)',
      'const ob = mod.createTeamOutbox({ dir, lockTimeoutMs: 400 })',
      'const r = ob.enqueue({ kind: "handoff", key, payload: { key } })',
      'console.log("RESULT " + JSON.stringify({ key, ok: r.ok, reason: r.reason || null, size: r.size }))',
    ].join('\n'))
    const syn = spawnSync(process.execPath, ['--check', worker], { encoding: 'utf8' })
    ok(syn.status === 0, '#342 前提:子进程驱动脚本语法可用', String(syn.stderr || '').slice(0, 200))
    const rounds = 4
    for (let round = 0; round < rounds; round++) {
      fs.rmSync(dir, { recursive: true, force: true });
      fs.mkdirSync(dir, { recursive: true })
      const runOne = (key) => new Promise((resolve) => {
        const p = spawn(process.execPath, [worker, dir, key], {
          env: { ...process.env, OUTBOX_PATH }, stdio: ['ignore', 'pipe', 'pipe'],
        })
        let out = ''
        p.stdout.on('data', (d) => { out += String(d) })
        p.stderr.on('data', (d) => { out += String(d) })
        p.on('close', () => resolve(out))
      })
      const outs = await Promise.all([runOne('A'), runOne('B')])
      const results = outs.map((o) => {
        const m = String(o).match(/RESULT (\{.*\})/)
        return m ? JSON.parse(m[1]) : { ok: false, parse: String(o).slice(0, 120) }
      })
      const keys = diskKeys(dir)
      const succeeded = results.filter((r) => r.ok === true)
      // ★核心不变量：**每一个回 ok:true 的进程，它的事件都必须在盘上**（绝无「谎报成功」）
      const lied = succeeded.filter((r) => !keys.includes(r.key))
      ok(lied.length === 0, '#342[round ' + round + '] ★成功回执 ⇒ 事件确实在盘上（无 ok:true 谎报）',
        JSON.stringify({ keys, succeeded: succeeded.map((r) => r.key), lied: lied.map((r) => r.key) }))
      ok(succeeded.length >= 1, '#342[round ' + round + '] 至少一方成功（锁是可重试的，不是永久失败）', JSON.stringify(results))
      // 若双方都成功 ⇒ 双方事件都必须在（这正是「双方成功却丢事件」的反面）
      if (succeeded.length === 2) {
        ok(keys.includes('A') && keys.includes('B'), '#342[round ' + round + '] ★双方都成功 ⇒ A/B **都在盘上**（旧实现可能只剩一个）', JSON.stringify(keys))
      }
    }
  }

  // ===================================================================
  // ⑥ 负路径对照：锁**可用**时三个出口全部照常工作（修复不得把正常路径也挡掉）
  // ===================================================================
  {
    const dir = fresh('no-contention')
    const ob = createTeamOutbox({ dir })
    const ra = ob.enqueue({ kind: 'handoff', key: 'N1', payload: { n: 1 } })
    ok(ra.ok === true, '★#342 负路径:无竞争 ⇒ enqueue 照常 ok:true', JSON.stringify(ra))
    const rb = ob.enqueue({ kind: 'handoff', key: 'N2', payload: { n: 2 } })
    ok(rb.ok === true && diskKeys(dir).join(',') === 'N1,N2', '★#342 负路径:无竞争 ⇒ 两条都在盘上（读-改-写仍然生效）', JSON.stringify(diskKeys(dir)))
    const sent = []
    const fr = await ob.flush(async (it) => { sent.push(it.key) })
    ok(fr.sent === 2 && diskKeys(dir).length === 0, '★#342 负路径:无竞争 ⇒ flush 正常发出并出队', JSON.stringify(fr))
    const rc = await ob.clear()
    ok(rc.ok === true, '★#342 负路径:无竞争 ⇒ clear 照常成功', JSON.stringify(rc))
  }

  // ===================================================================
  // ★变异反向验证：把三处修复分别退回旧写法 ⇒ 子进程模式跑本套件必须**红**（断言红，非崩溃）
  // ===================================================================
  if (!CHILD) {
    fs.mkdirSync(TMP, { recursive: true })
    const real = fs.readFileSync(REAL_SRC, 'utf8')
    const muts = [
      ['#342 enqueue 回退(fail-soft 继续写盘)', '    if (!release) return failPre(\'lock\', \'lock unavailable or timeout \' + lockTimeoutMs + \'ms (fail-closed: nothing published, retry)\')', '    if (!release) failPre(\'lock\', \'mutated: fail-soft\')'],
      ['#342 clear 回退(无锁也擦除)', '    if (!release) return failPre(\'lock\', \'lock unavailable or timeout \' + lockTimeoutMs + \'ms (fail-closed: nothing cleared, retry)\')', '    if (!release) failPre(\'lock\', \'mutated: fail-soft wipe\')'],
      // ★忠实回退 = **把守门整行摘掉**（旧实现就是「取不到锁也继续往下走」），
      //   而不是改它的返回负载：只改 items 在 flush 的失败路径上不可观测（初版实测恒绿 = 假变异）。
      ['#342 快照回退(无锁也继续往下走)', '    if (!release) return { ok: false, items: [], reason: \'state-lock-busy\', persisted: false, persistError: \'state-lock-busy\' }', '    /* mutated: no fail-closed guard */'],
      ['#342 clear 回退(先清内存再落盘)', '      const saved = wipeLockedPre()\n      if (!saved.ok) return saved\n      queue.length = 0\n      seen.clear()\n      return saved', '      queue.length = 0\n      seen.clear()\n      return wipeLockedPre()'],
    ]
    for (const [label, from, to] of muts) {
      const hits = real.split(from).length - 1
      ok(hits === 1, '变异定位:' + label + ' 锚点恰命中 1 次', 'hits=' + hits)
      if (hits !== 1) continue
      const mp = path.join(TMP, 'mut-' + String(muts.indexOf(muts.filter((m) => m[0] === label)[0])).replace(/[^a-z0-9]/gi, '') + '.mjs')
      fs.writeFileSync(mp, real.replace(from, to))
      const syn = spawnSync(process.execPath, ['--check', mp], { encoding: 'utf8' })
      ok(syn.status === 0, '变异文件语法可用(' + label + ')', String(syn.stderr || '').slice(0, 200))
      const r = spawnSync(process.execPath, [fileURLToPath(import.meta.url)], { env: { ...process.env, OUTBOX_PATH: mp, I342_CHILD: '1' }, encoding: 'utf8', maxBuffer: 1 << 26 })
      const out = String(r.stdout || '') + String(r.stderr || '')
      const m = out.match(/pass=(\d+) fail=(\d+)/)
      ok(r.status !== 0, '★变异必红(' + label + '):子进程退出码非 0', 'status=' + r.status)
      ok(/FAIL - /.test(out), '★变异必红(' + label + '):是断言红不是崩溃', out.slice(-300))
      ok(!!m && Number(m[2]) > 0, '★变异必红(' + label + '):fail>0', m ? m[0] : '(未取到计数)')
      console.log('  [变异取证] ' + label + ' -> ' + (m ? m[0] : '?') + ' exit=' + r.status)
    }
  }

  console.log('pass=' + pass + ' fail=' + fail)
  if (!CHILD) fs.rmSync(TMP, { recursive: true, force: true })
  process.exit(fail ? 1 : 0)
}

main().catch((e) => {
  console.error('套件自身异常:', (e && e.stack) || e)
  process.exit(1)
})

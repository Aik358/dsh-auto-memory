/**
 * issue #322 回归锁 —— **行为级**（真 import → 真构造 → 真调用 → 断言返回值/副作用）。
 *
 * 缺陷形态（报告人确定性交错复现，v3.2.13 残留）：
 *   lib/team-outbox.js 的 flush() 用 queue.slice() 这份**旧缓存**做发送快照，收尾用 {no lock}
 *   的 writeNowPre 整份写回。后果三条：
 *     ① 空缓存实例发不出别的实例已入队的事件（一条都不发）；
 *     ② 发送期间另一实例入队 B / 替换同 key 版本 ⇒ 收尾用旧快照写回 ⇒ 新事件/新版本消失；
 *     ③ 锁竞争时降级为未持锁写入（拿不准版本也照写）。
 *   修法：锁内重读取 drain 快照、await sender 全程锁外、确认删除走锁内重读 + **版本身份**判据
 *   （含 eventId 更新与 ABA），锁拿不到 ⇒ 不删除并如实上报，绝不无锁写。
 *
 * 为什么必须行为级：这是**并发交错**缺陷。源码里 grep 到 lock/If-Match 之类的字符串只是恒真守卫，
 * 证明不了「两个实例真的并发时谁都没丢」。故本套件全部用真实例 + 在**被测进程内注入延迟**撑开窗口
 * （概率撞交错会假绿），并在末尾做**变异反向验证**（回退修复 ⇒ 必红）。
 *
 * 运行：node tests/smoke/smoke-test-issue322-team-outbox-flush.mjs
 * 退出码：有 FAIL 即 1（变异子进程的红由父进程断言，父进程自身应为绿）。
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = path.resolve(fileURLToPath(new URL('../..', import.meta.url)))
const REAL_SRC = path.join(ROOT, 'lib', 'team-outbox.js')
// OUTBOX_PATH 只给变异子进程用：指向一份「把 #322 修复退回旧写法」的副本，验证本套件真的会红。
const OUTBOX_PATH = process.env.OUTBOX_PATH ? path.resolve(process.env.OUTBOX_PATH) : REAL_SRC
const CHILD = process.env.OUTBOX_CHILD === '1'
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'outbox-322-'))

let pass = 0
let fail = 0
function ok(cond, name, extra) {
  if (cond) { pass++; console.log('  ok - ' + name) }
  else { fail++; console.error('  FAIL - ' + name + (extra ? ' :: ' + extra : '')) }
}
const loadOutbox = () => import(pathToFileURL(OUTBOX_PATH).href)
function fresh(name) { const d = path.join(TMP, name); fs.mkdirSync(d, { recursive: true }); return d }
const queueFile = (dir) => path.join(dir, 'team-outbox.json')
function disk(dir) { try { return JSON.parse(fs.readFileSync(queueFile(dir), 'utf8')) } catch (e) { return null } }
function diskKeys(dir) { const d = disk(dir); return ((d && d.items) || []).map((i) => i.key).sort() }
function diskEventId(dir, key) {
  const d = disk(dir); const it = ((d && d.items) || []).find((x) => x.key === key)
  return it ? it.eventId : null
}
function diskRaw(dir) { try { return fs.readFileSync(queueFile(dir), 'utf8') } catch (e) { return null } }

/** 撑开交错窗口用：把控制权让给事件循环若干轮（确定性，不靠 sleep 撞运气）。 */
const tick = () => new Promise((r) => setTimeout(r, 0))

async function main() {
  const { createTeamOutbox } = await loadOutbox()
  console.log('=== issue #322 team-outbox flush 并发一致性 行为级回归' + (CHILD ? ' [变异子进程模式]' : '') + ' ===')

  // =====================================================================
  // ① 核心：空闲实例（缓存为空）必须发出**磁盘上别人入队**的事件
  // =====================================================================
  {
    const dir = fresh('idle')
    const a = createTeamOutbox({ dir })
    a.load()
    ok(diskKeys(dir).length === 0, '#322 前提:A 实例空队列已 load(缓存为空)')
    const b = createTeamOutbox({ dir })
    const rb = b.enqueue({ kind: 'handoff', key: 'B', payload: { n: 1 } })
    ok(rb.ok === true && diskKeys(dir).join(',') === 'B', '#322 前提:B 实例已把 B 事件写进磁盘', JSON.stringify(diskKeys(dir)))
    const sent = []
    const fr = await a.flush((it) => { sent.push(it.key) })
    ok(fr.sent === 1, '★#322 空闲实例 flush 发出了别人的事件(旧实现:queue.slice() 为空 ⇒ sent=0)', JSON.stringify(fr))
    ok(sent.join(',') === 'B', '★#322 发出的正是磁盘上那条(key=B)', JSON.stringify(sent))
    ok(diskKeys(dir).length === 0, '#322 发出且确认后磁盘清空(该条确实被消费)', JSON.stringify(diskKeys(dir)))
  }

  // =====================================================================
  // ② 发送期间**别的实例**入队新事件 ⇒ 不得被旧快照写回抹掉
  // =====================================================================
  {
    const dir = fresh('during-enqueue')
    const a = createTeamOutbox({ dir })
    a.enqueue({ kind: 'handoff', key: 'A1', payload: { n: 1 } })
    const b = createTeamOutbox({ dir })
    let rB = null
    const sent = []
    const fr = await a.flush(async (it) => {
      sent.push(it.key)
      await tick()            // 撑开窗口：此刻 A 正 await 发送、未持锁
      rB = b.enqueue({ kind: 'handoff', key: 'B', payload: { n: 2 } })
      await tick()
    })
    ok(rB && rB.ok === true, '#322 发送期间 B 实例入队成功(锁外 await ⇒ 别的进程能写入)', JSON.stringify(rB))
    ok(fr.sent === 1 && sent.join(',') === 'A1', '#322 本次只发 A1', JSON.stringify(fr) + ' sent=' + JSON.stringify(sent))
    ok(diskKeys(dir).join(',') === 'B', '★#322 收尾后**B 仍在磁盘上**(旧实现:用 A 的旧快照写回 ⇒ B 消失)', JSON.stringify(diskKeys(dir)))
    ok(fr.persisted === undefined || fr.persisted !== false, '#322 确认成功(无 persisted:false)', JSON.stringify(fr))
  }

  // =====================================================================
  // ③ 发送期间同 key 被换版本（eventId 更新 / ABA）⇒ 旧确认不得删掉新版本
  // =====================================================================
  {
    const dir = fresh('during-update')
    const a = createTeamOutbox({ dir })
    a.enqueue({ kind: 'handoff', key: 'K', payload: { v: 1 }, eventId: 'ev-1' })
    const b = createTeamOutbox({ dir })
    let rB = null
    const fr = await a.flush(async () => {
      await tick()
      rB = b.enqueue({ kind: 'handoff', key: 'K', payload: { v: 2 }, eventId: 'ev-2' })   // 同键新版本
      await tick()
    })
    ok(rB && rB.ok === true, '#322 发送期间同键更新入队成功', JSON.stringify(rB))
    ok(diskKeys(dir).join(',') === 'K', '★#322 新版本仍在队列(未被旧确认删除)', JSON.stringify(diskKeys(dir)))
    ok(diskEventId(dir, 'K') === 'ev-2', '★#322 磁盘上留下的是**新版本**(eventId=ev-2, 旧实现:被 ev-1 的确认抹掉)', String(diskEventId(dir, 'K')))
    const restored = createTeamOutbox({ dir })
    restored.load()
    ok(restored.list()[0] && restored.list()[0].payload.v === 2, '★#322 重启后读到的是新版本 v=2', JSON.stringify(restored.list()))
  }

  // =====================================================================
  // ④ 发送失败 / 取消 ⇒ 事件留在队列（at-least-once，不静默丢）
  // =====================================================================
  {
    const dir = fresh('failure')
    const a = createTeamOutbox({ dir })
    a.enqueue({ kind: 'handoff', key: 'F1', payload: {} })
    const fr = await a.flush(() => { throw new Error('offline') })
    ok(fr.sent === 0 && fr.failed === 1, '#322 发送失败计入 failed', JSON.stringify(fr))
    ok(diskKeys(dir).join(',') === 'F1', '★#322 发送失败的事件**留在磁盘**(下个 tick 重发)', JSON.stringify(diskKeys(dir)))
    const sent = []
    const fr2 = await a.flush((it) => { sent.push(it.key) })
    ok(fr2.sent === 1 && diskKeys(dir).length === 0, '#322 重试成功后出队', JSON.stringify(fr2))
  }
  {
    const dir = fresh('cancel')
    const a = createTeamOutbox({ dir })
    a.enqueue({ kind: 'handoff', key: 'C1', payload: {} })
    a.enqueue({ kind: 'handoff', key: 'C2', payload: {} })
    let cancelled = false
    let n = 0
    const fr = await a.flush(() => { n++; cancelled = true }, { isCancelled: () => cancelled })
    ok(n === 1, '#322 取消后不再发第二条(n=1)', 'n=' + n)
    // ★取消发生在「发送器已正常返回」之后 ⇒ 循环在 sent++ 之前 break：
    //   该条**不计入 sent 也不进确认集**，磁盘上一条都不删。这是刻意的 at-least-once 取舍：
    //   **宁可下次重发（重复），也绝不在取消路径上删掉任何事件（丢失）**。
    //   代价是 sent 计数在「取消恰逢发送成功」时少报 1 —— 这里显式钉住该语义，免得日后被当成 bug 改坏。
    ok(fr.sent === 0, '#322 取消路径 sent 少报(已发送但未计数)——at-least-once 的刻意取舍', JSON.stringify(fr))
    ok(diskKeys(dir).join(',') === 'C1,C2', '★#322 取消 ⇒ 一条都不删(已发的下个 tick 重发)', JSON.stringify(diskKeys(dir)))
    const sent2 = []
    const fr2 = await a.flush((it) => { sent2.push(it.key) })
    ok(fr2.sent === 2 && diskKeys(dir).length === 0, '#322 恢复后两条都发出并清空(证明取消没丢事件)', JSON.stringify(fr2))
  }

  // =====================================================================
  // ⑤ ACK 拿不到锁 ⇒ 不删除、不无锁写盘（#322 的第三条：禁止超时后无锁写）
  //    这里用**真的** lib/shared-state-lock.js 持锁 —— 同时证明两把锁互相排斥（不是各发明一套）。
  // =====================================================================
  {
    const dir = fresh('ack-lock-busy')
    const a = createTeamOutbox({ dir, lockTimeoutMs: 250 })
    a.enqueue({ kind: 'handoff', key: 'L1', payload: {} })
    const before = diskRaw(dir)
    const lockMod = await import(pathToFileURL(path.join(ROOT, 'lib', 'shared-state-lock.js')).href)
    let releaseHeld = null
    const sent = []
    const fr = await a.flush(async (it) => {
      sent.push(it.key)
      await tick()
      // ★发送期间（锁外）由**另一个锁模块**把锁抢走并一直持有 ⇒ ACK 必然拿不到锁
      releaseHeld = await lockMod.acquireSharedStateLock(a.file, { timeoutMs: 2000 })
    })
    ok(sent.join(',') === 'L1', '#322 前提:发送确实发生(S1 已发出)', JSON.stringify(sent))
    ok(fr.sent === 1, '#322 发送计数为 1', JSON.stringify(fr))
    ok(fr.persisted === false, '★#322 确认未完成时如实上报 persisted:false(不谎报成功)', JSON.stringify(fr))
    ok(diskRaw(dir) === before, '★#322 确认失败时磁盘**逐字节未变**(绝不无锁写盘)', 'before=' + JSON.stringify(before) + ' after=' + JSON.stringify(diskRaw(dir)))
    ok(diskKeys(dir).join(',') === 'L1', '★#322 该事件留在队列等下个 tick 重发', JSON.stringify(diskKeys(dir)))
    releaseHeld()   // 释放别的模块持有的锁
    const fr2 = await a.flush((it) => { sent.push(it.key) })
    ok(fr2.sent === 1 && diskKeys(dir).length === 0, '★#322 锁可用后重发成功并出队(证明前一次只是暂缓,不是丢弃)', JSON.stringify(fr2))
  }

  // =====================================================================
  // ⑤b 已发出但**确认落盘失败** ⇒ 必须如实上报 + 队列与磁盘**双双原样保留**（issue174 契约）
  //     这条同时钉住一个曾实测到的失效形态：确认集若用「对象身份」收集，在合并把候选换成
  //     磁盘读出的新对象时会恒不匹配 ⇒ 确认**静默不做**、还回 sent:1 谎报成功。
  // =====================================================================
  {
    const dir = fresh('ack-persist-fail')
    const ob = createTeamOutbox({ dir })
    ob.enqueue({ kind: 'fact', key: 'durable-ack', payload: { t: 1 } })
    const senderGate = []
    let releaseGate = null
    const gate = new Promise((r) => { releaseGate = r })
    const pending = ob.flush(async () => { await gate })
    await tick()
    // 发送在途（锁外）再入队 ⇒ 确认时要与「期间新增的条目」共存
    ob.enqueue({ kind: 'fact', key: 'during-ack', payload: { t: 2 } })
    const file = queueFile(dir)
    const diskBefore = diskRaw(dir)
    const rename = fs.renameSync
    let attempts = 0
    try {
      fs.renameSync = (from, to) => {
        if (to === file) { attempts++; throw Object.assign(new Error('injected outbox rename denied'), { code: 'EPERM' }) }
        return rename(from, to)
      }
      releaseGate()
      const fr = await pending
      ok(fr.sent === 1, '#322 前提:该条确实发出去了(sent=1)', JSON.stringify(fr))
      ok(fr.persisted === false, '★#322 确认落盘失败 ⇒ **如实上报 persisted:false**(旧形态:静默不确认却回 sent:1)', JSON.stringify(fr))
      ok(/rename denied/.test(String(fr.persistError || '')), '#322 persistError 里带得上真实原因(便于线上定位)', String(fr.persistError))
      ok(attempts > 0, '★#322 确认**真的尝试过**写盘(对象身份判据失效时 attempts=0、静默跳过)', 'attempts=' + attempts)
      ok(ob.size() === 2, '★#322 队列原样保留 2 条(已发出的 + 期间新增的)', 'size=' + ob.size())
      ok(diskRaw(dir) === diskBefore, '★#322 磁盘逐字节未变(提交失败 ⇒ 两边都不动)', 'before=' + String(diskBefore).slice(0, 60))
    } finally { fs.renameSync = rename }
    // 故障解除 ⇒ 下个 tick 两条都发出并真正出队
    const sent2 = []
    const fr2 = await ob.flush((it) => { sent2.push(it.key) })
    ok(fr2.sent === 2 && ob.size() === 0 && diskKeys(dir).length === 0,
      '★#322 故障解除后两条都处理完毕(队列与磁盘同时清空)', JSON.stringify(fr2) + ' sent=' + JSON.stringify(sent2))
  }

  // =====================================================================
  // ⑥ 回归 #308：本地「未持久」条目在取快照时必须被重试落盘，而不是当成已发出
  // =====================================================================
  {
    const dir = fresh('unpersisted')
    const f = queueFile(dir)
    fs.writeFileSync(f, JSON.stringify({ v: 1, items: [] }))   // 合法空队列 ⇒ load 成功
    const a = createTeamOutbox({ dir })
    fs.chmodSync(f, 0o444)                                     // 确定性故障注入:原子 rename 必 EPERM
    const r1 = a.enqueue({ kind: 'handoff', key: 'U1', payload: {} })
    ok(r1.ok === false, '#308 前提:首次落盘失败(enqueue 回 ok:false)', JSON.stringify(r1))
    fs.chmodSync(f, 0o666)
    const sent = []
    const fr = await a.flush((it) => { sent.push(it.key) })
    ok(sent.join(',') === 'U1', '★#308 未持久条目照常参与本次投递', JSON.stringify(sent))
    ok(fr.sent === 1, '★#308 发出计数为 1', JSON.stringify(fr))
    ok(diskKeys(dir).length === 0, '#308 确认后磁盘与内存一致(该条确实落过盘再被确认删除)', JSON.stringify(diskKeys(dir)))
  }

  // =====================================================================
  // 变异反向验证（只在父进程做一次；子进程模式跳过）
  //   变异①#322：drain 快照退回 queue.slice()（不重读磁盘）
  //   变异②#322：ACK 拿不到锁时退回无锁整份写盘（旧降级形态）
  // =====================================================================
  if (!CHILD) {
    const real = fs.readFileSync(REAL_SRC, 'utf8')

    const A1 = 'drain = snapshotLockedPre()'
    const hits1 = real.split(A1).length - 1
    ok(hits1 === 1, '变异定位:drain 快照锚点恰命中 1 次', 'hits=' + hits1)
    const m1Path = path.join(TMP, 'mutated-322-snapshot.mjs')
    fs.writeFileSync(m1Path, real.replace(A1, 'drain = { ok: true, items: queue.slice() }'))

    const A2 = "    if (!release) return { ok: false, reason: 'state-lock-busy' }"
    const hits2 = real.split(A2).length - 1
    ok(hits2 === 1, '变异定位:ACK 锁忙锚点恰命中 1 次', 'hits=' + hits2)
    const m2Path = path.join(TMP, 'mutated-322-ack.mjs')
    fs.writeFileSync(m2Path, real.replace(A2,
      '    if (!release) {\n'
      + '      const unlocked = writeNowPre(queue.filter((it) => !ackMap.has(dedupeKeyPre(it.kind, it.key))))\n'
      + "      return unlocked.ok ? { ok: true } : { ok: false, reason: unlocked.reason || 'unlocked-fallback' }\n"
      + '    }'))

    for (const pair of [['#322 回退(drain 不重读磁盘)', m1Path], ['#322 回退(ACK 锁忙时无锁写盘)', m2Path]]) {
      const label = pair[0]
      const mp = pair[1]
      const syn = spawnSync(process.execPath, ['--check', mp], { encoding: 'utf8' })
      ok(syn.status === 0, '变异文件语法可用(' + label + ')', String(syn.stderr || '').slice(0, 200))
      const r = spawnSync(process.execPath, [fileURLToPath(import.meta.url)], {
        env: { ...process.env, OUTBOX_PATH: mp, OUTBOX_CHILD: '1' },
        encoding: 'utf8', maxBuffer: 1 << 26,
      })
      // ★FAIL 行走 stderr、计数行走 stdout ⇒ 必须合并看，否则「断言红」与「崩溃」会误判
      const out = String(r.stdout || '') + String(r.stderr || '')
      const m = out.match(/pass=(\d+) fail=(\d+)/)
      ok(r.status !== 0, '★变异必红(' + label + '):子进程退出码非 0', 'status=' + r.status)
      ok(/FAIL - /.test(out), '★变异必红(' + label + '):是断言红(有 FAIL 行),不是崩溃退出', out.slice(-300))
      ok(!!m && Number(m[2]) > 0, '★变异必红(' + label + '):fail>0', m ? m[0] : '(未取到计数)')
      console.log('  [变异取证] ' + label + ' -> ' + (m ? m[0] : '?') + ' exit=' + r.status)
    }
  }

  fs.rmSync(TMP, { recursive: true, force: true })
  console.log('pass=' + pass + ' fail=' + fail)
  process.exit(fail ? 1 : 0)
}

main().catch((e) => {
  console.error('套件自身异常:', (e && e.stack) || e)
  process.exit(1)
})

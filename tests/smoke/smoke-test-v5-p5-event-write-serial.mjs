/**
 * smoke-test-v5-p5-event-write-serial.mjs
 *
 * ★§2.5（2026-10-26）验收：**事件写路径串行化**。
 *
 * 缺陷：`mutatePre` 是裸 read-modify-write —— read(await) → mutator → write(await)，
 *   中间无互斥。两个并发 append 会交错：
 *     A: read(5) ─────> A: write(6)   ← 用 5 做基线
 *     B:   read(5) → B: write(6)      ← 也用 5 做基线
 *   结果两次 append 只留 1 个检查点（丢写）。
 *
 * 修复：按 storePath 分键的模块级串行链（`withStoreChainPre`），
 *   并导出 `withEventStoreLockPre` 给 event-write.js 复用**同一条链**
 *   （必须同一条：两者写同一文件，各建一条仍会交错）。
 *
 * 验收要求（CR-10）：真 import → 真构造 → 真调用 → 断言返回值；每条带负路径。
 */
import fs from 'node:fs'
import path from 'node:path'
import { eventStorePre, readStorePre, withEventStoreLockPre, activeStoreChainCountPre } from '../../lib/event-store.js'
import { createEventForWorkPre } from '../../lib/event-write.js'

const ROOT = 'D:/dsh-auto-memory'
const TMP = path.join(ROOT, 'artifacts', '_ser-tmp')
let pass = 0, fail = 0
function ok(cond, name, extra) {
  if (cond) { pass++; console.log('  ok   - ' + name + (extra ? ' :: ' + extra : '')) }
  else { fail++; console.log('  FAIL - ' + name + (extra ? ' :: ' + extra : '')) }
}
function fresh(name) {
  const d = path.join(TMP, name)
  try { fs.rmSync(d, { recursive: true, force: true }) } catch (e) {}
  fs.mkdirSync(d, { recursive: true })
  return path.join(d, "event-store.json")
}

console.log("== A. 并发 append 不丢写（核心判据）==")
{
  const sp = fresh("a")
  const ev = await eventStorePre.create(sp, { name: "并发测试" })
  const N = 10
  await Promise.all(Array.from({ length: N }, (_, i) =>
    eventStorePre.append(sp, ev.id, { checkpoint: { kind: "log", text: "条目 " + i, at: Date.now() } })
  ))
  const store = await readStorePre(sp)
  const got = store.events.find((e) => e.id === ev.id)
  const n = Array.isArray(got.checkpoints) ? got.checkpoints.length : 0
  ok(n === N, "A-1 ★并发 10 个 append ⇒ 10 个检查点（无丢写）", "实测 " + n + "/" + N)
  const uniq = new Set((got.checkpoints || []).map((c) => String(c.text)))
  ok(uniq.size === N, "A-2 10 条文本各不相同（不是同一条重复写）", "实测 " + uniq.size)
}

console.log("")
console.log("== B. 更大并发压力 ==")
{
  const sp = fresh("b")
  const ev = await eventStorePre.create(sp, { name: "压力测试" })
  const N = 30
  await Promise.all(Array.from({ length: N }, (_, i) =>
    eventStorePre.append(sp, ev.id, { checkpoint: { kind: "log", text: "p" + i, at: Date.now() } })
  ))
  const store = await readStorePre(sp)
  const got = store.events.find((e) => e.id === ev.id)
  const n = Array.isArray(got.checkpoints) ? got.checkpoints.length : 0
  ok(n === N, "B-1 并发 30 个 ⇒ 30 个（高并发仍不丢）", "实测 " + n + "/" + N)
}

console.log("")
console.log("== C. 跨模块共用同一条链（关键设计）==")
{
  const sp = fresh("c")
  // 一边 createEventForWorkPre，一边 lock 内写 —— 若两条链互不等待就会丢
  const N = 8
  await Promise.all(Array.from({ length: N }, (_, i) =>
    i % 2 === 0
      ? createEventForWorkPre(sp, { name: "事件" + i })
      : withEventStoreLockPre(sp, async () => {
          const s0 = await readStorePre(sp)
          await new Promise((r) => setTimeout(r, 2))
          s0.__probe = (Number(s0.__probe) || 0) + 1
          const { writeStorePre } = await import("../../lib/event-store.js")
          await writeStorePre(sp, s0)
        })
  ))
  const store = await readStorePre(sp)
  const created = Array.isArray(store.events) ? store.events.length : 0
  ok(created === N / 2, "C-1 4 个 createEventForWorkPre 全部建成功（未被并发覆盖）", "实测 " + created + "/" + (N / 2))
  ok(Number(store.__probe) === N / 2, "C-2 ★4 次 lock 内读改写全部生效（证明两条路径真的互斥）", "实测 " + store.__probe + "/" + (N / 2))
}

console.log("")
console.log("== D. 不同 storePath 不互相阻塞（按路径分键）==")
{
  const sp1 = fresh("d1")
  const sp2 = fresh("d2")
  const e1 = await eventStorePre.create(sp1, { name: "库1" })
  const e2 = await eventStorePre.create(sp2, { name: "库2" })
  const t0 = Date.now()
  await Promise.all([
    ...Array.from({ length: 5 }, (_, i) => eventStorePre.append(sp1, e1.id, { checkpoint: { kind: "log", text: "a" + i, at: Date.now() } })),
    ...Array.from({ length: 5 }, (_, i) => eventStorePre.append(sp2, e2.id, { checkpoint: { kind: "log", text: "b" + i, at: Date.now() } })),
  ])
  const dt = Date.now() - t0
  const s1 = await readStorePre(sp1)
  const s2 = await readStorePre(sp2)
  const n1 = s1.events.find((e) => e.id === e1.id).checkpoints.length
  const n2 = s2.events.find((e) => e.id === e2.id).checkpoints.length
  ok(n1 === 5 && n2 === 5, "D-1 两个库各自 5 条（互不干扰）", n1 + " / " + n2)
  ok(dt < 2000, "D-2 两个库并发未被串成一条链（耗时合理）", dt + "ms")
}

console.log("")
console.log("== E. 失败隔离（一个事务抛错不能污染后续）==")
{
  const sp = fresh("e")
  const ev = await eventStorePre.create(sp, { name: "失败隔离" })
  // ★用「事件不存在」触发真错误（空 text 其实是被接受的 —— 实测：append 允许 text 为空字符串，
  //   我第一次写这条判据时假设错了，导致 E-1/E-3 假红。判据必须基于**实测行为**，不是猜测。）
  let caught = false
  try {
    await eventStorePre.append(sp, "evt_ffffffff", { checkpoint: { kind: "log", text: "x", at: Date.now() } })
  } catch (e) { caught = true }
  ok(caught, "E-1 往不存在的事件 append 确实抛错（负路径）")
  // 抛错之后链必须还能继续工作
  const r2 = await eventStorePre.append(sp, ev.id, { checkpoint: { kind: "log", text: "失败之后的写入", at: Date.now() } })
  ok(r2 && r2.ok === true, "E-2 ★抛错后链未死锁，后续写入仍成功")
  const store = await readStorePre(sp)
  const n = store.events.find((e) => e.id === ev.id).checkpoints.length
  ok(n === 1, "E-3 目标事件只留下 1 条（失败那条没写进去）", "实测 " + n)
}
console.log("== F. 链清理（无内存泄漏）==")
{
  // 上面跑了多个 storePath，全部落定后链应被清理
  for (let i = 0; i < 20; i++) {
    const sp = fresh("f" + i)
    await eventStorePre.create(sp, { name: "清理" + i })
  }
  await new Promise((r) => setTimeout(r, 200))
  const cnt = activeStoreChainCountPre()
  ok(cnt <= 3, "F-1 ★链已清理，无无限增长", "活跃链 " + cnt)
}

console.log("")
console.log("== G. 幂等未被破坏 ==")
{
  const sp = fresh("g")
  const ev = await eventStorePre.create(sp, { name: "幂等" })
  const ck = { kind: "log", text: "同一条", at: Date.now(), idemKey: "idem-1" }
  const r1 = await eventStorePre.append(sp, ev.id, { checkpoint: ck })
  const r2 = await eventStorePre.append(sp, ev.id, { checkpoint: ck })
  ok(r2 && r2.deduped === true, "G-1 相同 idemKey 去重（串行化未破坏幂等）")
  const store = await readStorePre(sp)
  const n = store.events.find((e) => e.id === ev.id).checkpoints.length
  ok(n === 1, "G-2 只落 1 条", "实测 " + n)
}

console.log("")
try { fs.rmSync(TMP, { recursive: true, force: true }) } catch (e) {}
console.log("SUMMARY  PASS " + pass + " / FAIL " + fail)
process.exit(fail === 0 ? 0 : 1)

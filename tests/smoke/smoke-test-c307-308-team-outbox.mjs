/**
 * issue #307 / #308 回归锁 —— **行为级**（真 import → 真构造 → 真调用 → 断言返回值/副作用）。
 *
 * 为什么必须行为级：这两条缺陷都是**并发交错 / 落盘失败之后**才显形的（原子 rename 只保证
 * 「读到的字节完整」，不防「旧快照覆盖新快照」；落盘失败后 dup 分支照样回 ok:true），
 * 用「源码里有没有某段字符串」当验收在本仓是**恒真守卫**，抓不住任何回归。所以本套件：
 *   ① 真 import lib/team-outbox.js，真构造 createTeamOutbox，真 await enqueue/load/flush/clear；
 *   ② #307 用**真的第二个操作系统进程**（子进程驱动脚本）复现「两个实例各写一份」；
 *   ③ #308 用**确定性故障注入**（把队列文件名先占成目录 ⇒ 原子 rename 必失败），不靠打桩；
 *   ④ 末尾做**变异反向验证**：把两处修复分别回退出旧写法，再以子进程模式跑本套件，
 *      断言「必红（fail>0 且退出码非 0，且是断言红不是崩溃）」。变异文件先过 node --check，
 *      避免「语法坏掉导致红」冒充「缺陷被抓住」。
 *
 * 运行：node tests/smoke/smoke-test-c307-308-team-outbox.mjs
 * 退出码：有 FAIL 即 1（变异子进程的红由**父进程**断言，父进程自身仍应为绿）。
 */
import assert from "node:assert/strict"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { spawnSync } from "node:child_process"
import { fileURLToPath, pathToFileURL } from "node:url"

const ROOT = path.resolve(fileURLToPath(new URL("../..", import.meta.url)))
const REAL_SRC = path.join(ROOT, "lib", "team-outbox.js")
// OUTBOX_PATH 只给变异子进程用：指向一份「把修复退回旧写法」的副本，验证本套件真的会红。
const OUTBOX_PATH = process.env.OUTBOX_PATH ? path.resolve(process.env.OUTBOX_PATH) : REAL_SRC
const CHILD = process.env.OUTBOX_CHILD === "1"
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "outbox-c307-"))

let pass = 0
let fail = 0
function ok(cond, name, extra) {
  if (cond) { pass++; console.log("  ok - " + name) }
  else { fail++; console.error("  FAIL - " + name + (extra ? " :: " + extra : "")) }
}
const loadOutbox = () => import(pathToFileURL(OUTBOX_PATH).href)
function fresh(name) { const d = path.join(TMP, name); fs.mkdirSync(d, { recursive: true }); return d }
const queueFile = (dir) => path.join(dir, "team-outbox.json")
const diskMissing = (dir) => !fs.existsSync(queueFile(dir))
function disk(dir) { try { return JSON.parse(fs.readFileSync(queueFile(dir), "utf8")) } catch (e) { return null } }
function diskKeys(dir) { const d = disk(dir); return ((d && d.items) || []).map((i) => i.key).sort() }
function payloadOf(item) { try { return JSON.parse(item.payloadRaw) } catch (e) { return null } }

// ---------- #307 的「另一个进程」：真子进程驱动（不是 vm、不是打桩） ----------
const DRIVER = path.join(TMP, "outbox-driver.mjs")
fs.writeFileSync(DRIVER, [
  "import { pathToFileURL } from \"node:url\"",
  "const target = process.env.OUTBOX_PATH || " + JSON.stringify(REAL_SRC),
  "const mod = await import(pathToFileURL(target).href)",
  "const [dir, kind, key, payloadJson] = process.argv.slice(2)",
  "const ob = mod.createTeamOutbox({ dir })",
  "const r = await ob.enqueue({ kind: kind, key: key, payload: JSON.parse(payloadJson) })",
  "console.log(\"DRIVER \" + JSON.stringify({ ok: r.ok, dup: !!r.dup, reason: r.reason || null }))",
].join("\n"))
// 驱动脚本先自检语法:若生成逻辑写坏(如把 \n 写成源码里的真换行),这里立刻给出精确失败,
// 而不是让下游抛一个「子进程失败」的模糊错误。
{
  const syn = spawnSync(process.execPath, ["--check", DRIVER], { encoding: "utf8" })
  if (syn.status !== 0) throw new Error("生成的驱动脚本语法不合法: " + String(syn.stderr || "").slice(0, 300))
}

function runDriver(dir, key, payload) {
  const r = spawnSync(process.execPath, [DRIVER, dir, "handoff", key, JSON.stringify(payload)], {
    env: { ...process.env, OUTBOX_PATH: OUTBOX_PATH },
    encoding: "utf8",
    maxBuffer: 1 << 26,
  })
  if (r.status !== 0) throw new Error("驱动子进程失败 status=" + r.status + " stderr=" + String(r.stderr || "").slice(0, 400))
  const out = String(r.stdout || "")
  const line = out.split("\n").find((l) => l.startsWith("DRIVER "))
  assert.ok(line, "驱动子进程产出了结果行 (stdout=" + out.slice(0, 300) + ")")
  return JSON.parse(line.slice("DRIVER ".length))
}

async function main() {
  const { createTeamOutbox } = await loadOutbox()
  console.log("=== issue #307/#308 team-outbox 行为级回归(真 import/真调用/故障注入)" + (CHILD ? " [变异子进程模式]" : "") + " ===")

  // =====================================================================
  // #307：两个实例各自入队 ⇒ 磁盘必须同时保住 A 与 B（进程内交错）
  // =====================================================================
  {
    const dir = fresh("inproc")
    const a = createTeamOutbox({ dir })
    const b = createTeamOutbox({ dir })
    ok(diskMissing(dir), "#307 前提:构造实例不做 IO(此刻磁盘上还没有队列文件)")
    const ra = await a.enqueue({ kind: "handoff", key: "A", payload: { n: 1 } })
    const rb = await b.enqueue({ kind: "handoff", key: "B", payload: { n: 2 } })
    ok(ra.ok === true && rb.ok === true, "#307 两实例各自入队都回 ok:true", JSON.stringify([ra, rb]))
    ok(diskKeys(dir).join(",") === "A,B", "★#307 两实例入队后磁盘上 A、B 都在(旧实现:只剩后写者 B)", JSON.stringify(diskKeys(dir)))
  }

  // =====================================================================
  // #307：issue 的原始形态 —— 两个**真进程**
  // =====================================================================
  {
    const dir = fresh("xproc")
    const b = createTeamOutbox({ dir })
    b.load()
    const d1 = runDriver(dir, "A", { n: 1 })
    ok(d1.ok === true && diskKeys(dir).join(",") === "A", "★#307 前提:子进程写入后磁盘确有 A(部分磁盘状态)", JSON.stringify(diskKeys(dir)))
    const rb = await b.enqueue({ kind: "handoff", key: "B", payload: { n: 2 } })
    ok(rb.ok === true, "#307 第二进程入队 B 回 ok:true", JSON.stringify(rb))
    ok(diskKeys(dir).join(",") === "A,B", "★#307 跨进程:两进程各自入队的条目都在磁盘上(旧实现 A 被旧快照覆盖)", JSON.stringify(diskKeys(dir)))
  }

  // =====================================================================
  // #307：与 lib/shared-state-lock.js 的**互斥同形**验证（同一个 .lock 文件、同一套认领协议）
  //   证据链：用**真的** async 锁模块持锁 ⇒ 本模块的同步 enqueue 必须被挡住（耗时≈等待上限），
  //   超时后 fail-soft 仍然返回结构化结果而不是抛/挂。这条同时锁住「锁协议不许各自发明一套」。
  // =====================================================================
  {
    const dir = fresh("interop")
    let lockMod = null
    try { lockMod = await import(pathToFileURL(path.join(ROOT, "lib", "shared-state-lock.js")).href) } catch (e) { lockMod = null }
    if (!lockMod) {
      ok(false, "#307 前提:能加载 lib/shared-state-lock.js（互斥同形验证的前提）")
    } else {
      const f = queueFile(dir)
      const release = await lockMod.acquireSharedStateLock(f, { timeoutMs: 5000 })
      const ob = createTeamOutbox({ dir, lockTimeoutMs: 200 }) // 收紧等待上限,把实验控制在 1s 内
      const t0 = Date.now()
      let r = null
      let threw = null
      try { r = ob.enqueue({ kind: "handoff", key: "L", payload: { n: 1 } }) } catch (e) { threw = e }
      const elapsed = Date.now() - t0
      ok(threw === null, "#307 锁被占用时 enqueue 仍不抛(fail-soft)", threw && threw.message)
      ok(r !== null && typeof r === "object" && typeof r.ok === "boolean",
        "★#307 enqueue 是**同步返回**的结构化结果(不是 Promise;既有调用点直接读 .ok)", "实得 " + JSON.stringify(r))
      ok(elapsed < 150, "★#307 同步入口不阻塞异步锁所有者的事件循环", "elapsed=" + elapsed)
      ok(r && r.ok === false && /state-lock-busy/.test(r.reason), "★#307 锁忙可见失败，不允许无锁读改写", JSON.stringify(r))
      release()
      ok(diskKeys(dir).length === 0, "#307 被拒绝的争锁写没有覆盖磁盘", JSON.stringify(diskKeys(dir)))
      // 释放后再入队:这次应当不必等满上限(锁已可用)
      const t1 = Date.now()
      const r2 = ob.enqueue({ kind: "handoff", key: "M", payload: { n: 2 } })
      const fast = Date.now() - t1
      ok(r2 && r2.ok === true && fast < 150, "★#307 锁可用时入队几乎不等待(实得 " + fast + "ms)", JSON.stringify(r2))
      const retry = ob.enqueue({ kind: "handoff", key: "L", payload: { n: 1 } })
      ok(retry.ok === true && diskKeys(dir).join(",") === "L,M", "#307 释放锁后显式重试可持久化", JSON.stringify(retry))
    }
  }

  // =====================================================================
  // #308：首次落盘失败 → 同条重试必须真写盘
  //   故障注入：盘上先放一份**合法空队列**（保证 load 成功、走的正是 enqueue 的写路径），
  //   Windows 使用真实只读目标；POSIX 可覆盖只读文件，故只针对目标 rename 注入 EACCES。
  //   两种方式均必须证明磁盘未改、内存保留待重试；后续断言保持相同。
  // =====================================================================
  {
    const dir = fresh("fault")
    const f = queueFile(dir)
    fs.writeFileSync(f, JSON.stringify({ v: 1, items: [] }))
    const ob = createTeamOutbox({ dir })
    fs.chmodSync(f, 0o444)
    const onDiskBefore = fs.readFileSync(f, "utf8")
    let r1 = null
    let threw = null
    const realRename = fs.renameSync
    if (process.platform !== "win32" || process.env.DAM_OUTBOX_TEST_FAULT === "rename") {
      fs.renameSync = (from, to) => {
        if (path.resolve(String(to)) === path.resolve(f)) throw Object.assign(new Error("fixture target rename denied"), { code: "EACCES" })
        return realRename(from, to)
      }
    }
    try { r1 = await ob.enqueue({ kind: "handoff", key: "k1", payload: { v: 1 } }) }
    catch (e) { threw = e }
    finally { fs.renameSync = realRename }
    ok(threw === null, "#308 落盘失败时 enqueue 不抛(契约=结构化返回)", threw && threw.message)
    ok(r1 && r1.ok === false && typeof r1.reason === "string" && r1.reason.length > 0,
      "#308 前提:首次目标提交确实失败 ⇒ ok:false + reason", JSON.stringify(r1))
    ok(fs.readFileSync(f, "utf8") === onDiskBefore, "#308 前提:第一跳失败后磁盘逐字节未变(确实什么都没写进去)")
    ok(ob.size() === 1, "#308 前提:失败的那条**留在内存队列**(issue 原文:保留 queue/seen)", "size=" + ob.size())
    fs.chmodSync(f, 0o666) // 故障解除
    const r2 = await ob.enqueue({ kind: "handoff", key: "k1", payload: { v: 1 } })
    ok(r2 && r2.ok === true, "★#308 故障解除后同条重试入队 ⇒ ok:true", JSON.stringify(r2))
    ok(diskKeys(dir).join(",") === "k1", "★#308 这次真的落盘了(旧实现:dup 分支直接 ok:true,磁盘仍缺)", JSON.stringify(diskKeys(dir)))
    const ob3 = createTeamOutbox({ dir })
    const rl = ob3.load()
    ok(rl.ok === true && ob3.size() === 1, "★#308 新实例 load 恢复 1 条(旧实现:重启恢复 0 条)", "size=" + ob3.size())
    const r3 = await ob.enqueue({ kind: "handoff", key: "k1", payload: { v: 1 } })
    ok(r3.ok === true && r3.dup === true, "#308 已持久之后的 dup 才短路", JSON.stringify(r3))
  }

  // =====================================================================
  // 回归:#280 A1 的同键新负载，不得被「#307 的重读合并」回退成磁盘旧版本
  // =====================================================================
  {
    const dir = fresh("update")
    const ob = createTeamOutbox({ dir })
    await ob.enqueue({ kind: "handoff", key: "K", payload: { v: 1 }, eventId: "ev-1" })
    const r = await ob.enqueue({ kind: "handoff", key: "K", payload: { v: 2 }, eventId: "ev-2" })
    ok(r.ok === true && r.updated === true, "回归:同键新负载 ⇒ updated:true", JSON.stringify(r))
    const d = disk(dir)
    const p = d && d.items && d.items[0] ? payloadOf(d.items[0]) : null
    ok(p && p.v === 2 && d.items[0].eventId === "ev-2", "★回归:合并裁决不得把同键更新回退成磁盘旧版本(#280 A1)", JSON.stringify(d && d.items))
  }

  // =====================================================================
  // 回归:幂等 dup / flush 出队 / clear 擦除 / 有界
  // =====================================================================
  {
    const dir = fresh("dup")
    const ob = createTeamOutbox({ dir })
    await ob.enqueue({ kind: "handoff", key: "k", payload: { a: 1 } })
    const r = await ob.enqueue({ kind: "handoff", key: "k", payload: { a: 1 } })
    ok(r.ok === true && r.dup === true, "回归:同键同负载 ⇒ dup:true", JSON.stringify(r))
    ok((((disk(dir) || {}).items) || []).length === 1, "回归:dup 不重复写条目", JSON.stringify(diskKeys(dir)))
  }
  {
    const dir = fresh("flush")
    const ob = createTeamOutbox({ dir })
    await ob.enqueue({ kind: "handoff", key: "f1", payload: { x: 1 } })
    const r = await ob.flush(async () => {})
    ok(r.sent === 1 && ob.size() === 0, "回归:flush 成功出队", JSON.stringify(r))
    ok((((disk(dir) || {}).items) || []).length === 0, "回归:flush 后磁盘也空了", JSON.stringify(diskKeys(dir)))
    await ob.enqueue({ kind: "handoff", key: "c1", payload: { y: 1 } })
    ok((((disk(dir) || {}).items) || []).length === 1, "回归:clear 前磁盘有 1 条")
    const c = await ob.clear()
    ok(c.ok === true, "回归:clear 回 ok", JSON.stringify(c))
    ok((((disk(dir) || {}).items) || []).length === 0, "★回归:clear 是整份擦除,不是「合并之后什么都没清」", JSON.stringify(diskKeys(dir)))
  }
  {
    const dir = fresh("bound")
    const ob = createTeamOutbox({ dir, maxItems: 2 })
    await ob.enqueue({ kind: "handoff", key: "b1", payload: {} })
    await ob.enqueue({ kind: "handoff", key: "b2", payload: {} })
    await ob.enqueue({ kind: "handoff", key: "b3", payload: {} })
    ok(ob.size() === 2, "回归:内存队列有界(2)", "size=" + ob.size())
    ok(diskKeys(dir).join(",") === "b2,b3", "★回归:磁盘收束到最新 2 条(合并不得把被淘汰的旧条复活)", JSON.stringify(diskKeys(dir)))
    ok(ob.dropped >= 1, "回归:dropped 计数递增", "dropped=" + ob.dropped)
  }

  // =====================================================================
  // 负路径变异反向验证（只在父进程做一次；子进程模式跳过）
  // =====================================================================
  if (!CHILD) {
    const real = fs.readFileSync(REAL_SRC, "utf8")

    // 变异①#307 回退：去掉 writeLockedPre 里的「重读磁盘 + 合并」，退回整份快照直写
    const writeStart = real.indexOf("function writeLockedPre(candidate)")
    const M1_ANCHOR = "const merged = mergeCandidatePre(candidate)"
    const m1Start = real.indexOf(M1_ANCHOR, writeStart)
    ok(writeStart > 0 && m1Start > writeStart, "变异定位:#307 锁内重读", "s=" + m1Start)
    const m1Path = path.join(TMP, "mutated-307.mjs")
    const resolvable = source => source.replace("'./shared-state-lock.js'", JSON.stringify(pathToFileURL(path.join(ROOT, "lib/shared-state-lock.js")).href))
    fs.writeFileSync(m1Path, resolvable(real.slice(0, m1Start) + "const merged = { ok: true, items: candidate }" + real.slice(m1Start + M1_ANCHOR.length)))

    // 变异②#308 回退：dup 分支不再看 persisted（旧写法：一律短路）
    const DUP_ANCHOR = "if (previous.persisted === true && sameEntryPre(previous, item)) {"
    const dupHits = real.split(DUP_ANCHOR).length - 1
    ok(dupHits === 1, "变异定位:#308 dup 短路锚点恰命中 1 次", "hits=" + dupHits)
    const m2Path = path.join(TMP, "mutated-308.mjs")
    fs.writeFileSync(m2Path, resolvable(real.replace(DUP_ANCHOR, "if (sameEntryPre(previous, item)) {")))

    const cases = [["#307 回退(取消重读合并)", m1Path], ["#308 回退(dup 无条件短路)", m2Path]]
    for (const pair of cases) {
      const label = pair[0]
      const mp = pair[1]
      const syn = spawnSync(process.execPath, ["--check", mp], { encoding: "utf8" })
      ok(syn.status === 0, "变异文件语法可用(" + label + ")", String(syn.stderr || "").slice(0, 200))
      const r = spawnSync(process.execPath, [fileURLToPath(import.meta.url)], {
        env: { ...process.env, OUTBOX_PATH: mp, OUTBOX_CHILD: "1", OUTBOX_REAL: REAL_SRC },
        encoding: "utf8",
        maxBuffer: 1 << 26,
      })
      // ★FAIL 行走 stderr，计数行走 stdout ⇒ 必须合并看，否则「是断言红还是崩溃」会误判。
      const out = String(r.stdout || "") + String(r.stderr || "")
      const m = out.match(/pass=(\d+) fail=(\d+)/)
      ok(r.status !== 0, "★变异必红(" + label + "):子进程退出码非 0", "status=" + r.status)
      ok(/FAIL - /.test(out), "★变异必红(" + label + "):是断言红(有 FAIL 行),不是崩溃退出", out.slice(-400))
      ok(!!m && Number(m[2]) > 0, "★变异必红(" + label + "):fail>0", m ? m[0] : "(未取到计数)")
      console.log("  [变异取证] " + label + " -> " + (m ? m[0] : "?") + " exit=" + r.status)
    }
  }

  fs.rmSync(TMP, { recursive: true, force: true })
  console.log("pass=" + pass + " fail=" + fail)
  process.exit(fail ? 1 : 0)
}

main().catch((e) => {
  console.error("套件自身异常:", (e && e.stack) || e)
  process.exit(1)
})

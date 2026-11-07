#!/usr/bin/env node
/**
 * smoke-test-baseline-rollback-547.mjs —— #547 基线应用失败回滚抹掉并发写入（P0 数据丢失）
 *
 * 缺陷（2026-11-07 alpha.7 P0-1）：
 *   applyBaselineOfferPre 的备份在锁外（mkdir + copyFileSync），真正取锁在 10s 后；
 *   取锁超时抛出后，回滚**无条件作用于整份计划**，而本次事务一个字节都没写
 *   ⇒ 抹掉「备份之后、取锁之前」并发成功写入的检查点（实测 895B / checkpoints=0）。
 *
 * 本套件是**真执行**验收（不是源码字符串断言）：
 *   · 真 import tests/lib/audit-engine.mjs（MemoryEngine，来自生产 lib/index.js）；
 *   · 真 fs 落盘、真子进程持**跨进程文件锁**（A 用例）、真 config-io 原子写失败（B/C）；
 *   · 断言对象是返回值字段 + 磁盘字节 + 锁文件被独立进程观测到的存在区间。
 *
 * 用例：
 *   A 并发写成功后取锁超时 ⇒ 并发写入必须仍在；reason=write-not-started；零回滚；按闸门恢复同步。
 *   B 本次零写入（首个写入即失败）⇒ 绝不回滚；备份文件必须仍存在。
 *   C 写了一半（PLAN.md 成功、event-store 失败）⇒ 只回滚写过的文件；保持 paused。
 *   D 成功路径：锁持有区间由独立进程实测 < 500ms；refreshEventStatePre 不在持锁期间调用。
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, watch, writeFileSync, chmodSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { spawn } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { installExitGuard } from './_exit-guard.mjs'

const SELF = fileURLToPath(import.meta.url)
const ROOT = path.resolve(path.dirname(SELF), '..', '..')
const WORKROOT = path.join(ROOT, 'artifacts', '_lead-integ', 'smoke-547-work')
/** 并发写者写入的 PLAN.md 内容（用来区分「锁内备份」与「备份前旧值」）。 */
const CONCURRENT_PLAN = '# plan-v1-from-concurrent-writer\n'

// ═══ 子进程模式 ①：真持跨进程锁 → 等信号 → 追加检查点 → 等释放信号 → 释放 ═══
if (process.argv[2] === '--hold-lock') {
  const [storePath, readyPath, sigPath, donePath, releasePath] = process.argv.slice(3)
  const S = await import(pathToFileURL(path.join(ROOT, 'lib', 'event-store.js')).href)
  const L = await import(pathToFileURL(path.join(ROOT, 'lib', 'shared-state-lock.js')).href)
  const release = await L.acquireSharedStateLock(String(storePath) + '.lock', { timeoutMs: 20000 })
  const sab = new Int32Array(new SharedArrayBuffer(4))
  const nap = (ms) => Atomics.wait(sab, 0, 0, ms)
  writeFileSync(readyPath, 'held', 'utf8')
  const t0 = Date.now()
  while (!existsSync(sigPath) && Date.now() - t0 < 8000) nap(1)
  const store = await S.readStorePre(storePath)
  const ev = (store.events || [])[0]
  ev.checkpoints = Array.isArray(ev.checkpoints) ? ev.checkpoints : []
  ev.checkpoints.push({ at: Date.now(), kind: 'log', text: 'concurrent-append-while-locked', idemKey: 'k-concurrent' })
  await S.writeStorePre(storePath, store)
  writeFileSync(donePath, JSON.stringify({ ok: true, appended: 1, checkpoints: ev.checkpoints.length, waitedMs: Date.now() - t0 }), 'utf8')
  const t1 = Date.now()
  while (!existsSync(releasePath) && Date.now() - t1 < 20000) nap(2)
  try { release() } catch (_) {}
  process.exit(0)
}

// ═══ 子进程模式 ②：独立观察 <store>.lock.lock 的出现/消失区间（锁持有时间的物理测量）═══
//   用 fs.watch（ReadDirectoryChangesW 事件）而不是轮询：事件在锁文件 create/delete 时各投递一次，
//   实测 3ms 的持锁也能完整拿到「出现→消失」两条事件，不存在采样窗口漏检。
if (process.argv[2] === '--watch-lock') {
  const [lockPath, outPath, maxMsRaw] = process.argv.slice(3)
  const lockDir = path.dirname(lockPath)
  const lockBase = path.basename(lockPath).toLowerCase()
  let first = 0
  let last = 0
  let finished = false
  const w = watch(lockDir, { persistent: true }, (_ev, fn) => {
    if (String(fn || '').toLowerCase() !== lockBase) return
    const now = Date.now()
    if (existsSync(lockPath)) { if (!first) first = now } else if (first && !last) { last = now; finish() }
  })
  function finish() {
    if (finished) return
    finished = true
    try { w.close() } catch (_) {}
    writeFileSync(outPath, JSON.stringify({ seen: first > 0, first, last, hold: first && last ? last - first : -1 }), 'utf8')
    process.exit(0)
  }
  setTimeout(finish, Number(maxMsRaw || 5000))
  await new Promise((r) => setTimeout(r, 10))
  writeFileSync(outPath + '.ready', 'go', 'utf8')
  // ★必须挂住：本模式没有“主流程”可返回。旧写法直接落回文件底部 ⇒ 子进程把整套 suite
  //   又跑一遍（rmSync WORKROOT + 重写 baseline-offer.json）⇒ 父进程 apply 读到别人的 offer，
  //   实测表现为 checksum-changed / no-offer。finish() 会自行 process.exit。
  await new Promise(() => {})
}

// ═══ 子进程模式 ③：持锁 → 追加检查点 + 写 PLAN.md（模拟并发 applier）→ 等释放 ═══
if (process.argv[2] === '--hold-lock-plan') {
  const [storePath, planPath, readyPath, sigPath, donePath, releasePath] = process.argv.slice(3)
  const S2 = await import(pathToFileURL(path.join(ROOT, 'lib', 'event-store.js')).href)
  const L2 = await import(pathToFileURL(path.join(ROOT, 'lib', 'shared-state-lock.js')).href)
  const release = await L2.acquireSharedStateLock(String(storePath) + '.lock', { timeoutMs: 20000 })
  const sab = new Int32Array(new SharedArrayBuffer(4))
  const nap = (ms) => Atomics.wait(sab, 0, 0, ms)
  writeFileSync(readyPath, 'held', 'utf8')
  const t0 = Date.now()
  while (!existsSync(sigPath) && Date.now() - t0 < 8000) nap(1)
  const store = await S2.readStorePre(storePath)
  const ev = (store.events || [])[0]
  ev.checkpoints = Array.isArray(ev.checkpoints) ? ev.checkpoints : []
  ev.checkpoints.push({ at: Date.now(), kind: 'log', text: 'concurrent-append-while-locked', idemKey: 'k-concurrent' })
  await S2.writeStorePre(storePath, store)
  writeFileSync(planPath, CONCURRENT_PLAN, 'utf8')
  writeFileSync(donePath, JSON.stringify({ ok: true, appended: 1, checkpoints: ev.checkpoints.length, storeBytes: statSync(storePath).size }), 'utf8')
  const t1 = Date.now()
  while (!existsSync(releasePath) && Date.now() - t1 < 20000) nap(2)
  try { release() } catch (_) {}
  process.exit(0)
}

const G = installExitGuard({ suite: 'baseline-rollback-547' })
const fails = []
const eq = (a, b, label) => { if (a !== b) fails.push(label + '（期望 ' + JSON.stringify(b) + '，实际 ' + JSON.stringify(a) + '）') }
const ok = (cond, label) => { if (!cond) fails.push(label) }
const sha = (b) => createHash('sha256').update(b).digest('hex').slice(0, 16)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const waitFile = async (p, ms) => { const t = Date.now(); while (!existsSync(p) && Date.now() - t < ms) await sleep(5); return existsSync(p) }
const waitExit = (child, ms) => new Promise((r) => {
  const t = setTimeout(() => { try { child.kill('SIGKILL') } catch (_) {} ; r('killed') }, ms)
  child.on('exit', () => { clearTimeout(t); r('exited') })
})
const lsBackups = (handoff) => readdirSync(handoff).filter((n) => n.startsWith('backup-baseline-'))
const unro = (p) => { try { if (existsSync(p) && statSync(p).isFile()) chmodSync(p, 0o666) } catch (_) {} }

rmSync(WORKROOT, { recursive: true, force: true })
mkdirSync(WORKROOT, { recursive: true })
process.env.DSH_HOME = WORKROOT

const { MemoryEngine } = await import(pathToFileURL(path.join(ROOT, 'tests', 'lib', 'audit-engine.mjs')).href)
const TB = await import(pathToFileURL(path.join(ROOT, 'lib', 'team-baseline.js')).href)
const S = await import(pathToFileURL(path.join(ROOT, 'lib', 'event-store.js')).href)

/** 造一个真引擎：saveConfig 只记账；_teamSync 给既有 B4 恢复闸门一个真实形状。 */
function mkEngine(caseName) {
  const eng = new MemoryEngine()
  eng.config.userMemoryDir = path.join(WORKROOT, 'memory')
  eng.config.memoryRoot = path.join(WORKROOT, 'memory', 'workspaces')
  eng.configLoaded = true
  eng._teamSync = { status: () => ({ upgrade: { state: 'ok' } }) }
  eng.saveCalls = []
  eng.saveConfig = async (p) => { eng.saveCalls.push(p); return { ok: true } }
  eng.caseName = caseName
  return eng
}
function setupWs(eng, name) {
  const wsCwd = path.join(WORKROOT, name)
  mkdirSync(path.join(wsCwd, 'handoff'), { recursive: true })
  const projectDir = eng.projectDirOf(wsCwd)
  const handoff = path.join(projectDir, 'handoff')
  mkdirSync(handoff, { recursive: true })
  return { wsCwd, handoff, storePath: path.join(handoff, 'event-store.json') }
}
function offerFor(files) {
  const pkg = TB.packBaselinePre({ files, at: Date.now() })
  if (!pkg.ok) throw new Error('packBaselinePre failed: ' + pkg.reason)
  const teamDir = path.join(WORKROOT, 'memory', 'team')
  mkdirSync(teamDir, { recursive: true })
  writeFileSync(path.join(teamDir, 'baseline-offer.json'), JSON.stringify(pkg.payload), 'utf8')
  return pkg.payload
}
const EMPTY_STORE = JSON.stringify({ schema: 'v4_event_store_v2', schemaVersion: 1, events: [] })

// ═════════════════════════ A：并发写成功后取锁超时 ⇒ 并发写入必须仍在 ═════════════════════════
{
  const eng = mkEngine('A')
  const ws = setupWs(eng, 'caseA')
  await S.eventStorePre.create(ws.storePath, { name: 'E-A', now: 1762300000000 })
  const A0 = readFileSync(ws.storePath)
  const offer = offerFor({ 'event-store.json': EMPTY_STORE })
  const ready = path.join(WORKROOT, 'A-ready.txt')
  const sig = path.join(WORKROOT, 'A-sig.txt')
  const done = path.join(WORKROOT, 'A-done.json')
  const rel = path.join(WORKROOT, 'A-release.txt')
  const child = spawn(process.execPath, [SELF, '--hold-lock', ws.storePath, ready, sig, done, rel], { stdio: 'ignore' })
  const childExitP = waitExit(child, 20000)   // 监听必须先挂，避免「已退出→事件不再触发」
  ok(await waitFile(ready, 10000), 'A 子进程必须已真持锁')
  const t = Date.now()
  const applyP = eng.applyBaselineOfferPre({ ws: ws.wsCwd, expectedChecksum: offer.checksum })
  await sleep(150)                      // 让 apply 真正进入取锁等待
  writeFileSync(sig, 'go', 'utf8')      // 放行持锁者追加（它持锁 ⇒ 必然成功）
  const res = await applyP
  const applyMs = Date.now() - t
  ok(await waitFile(done, 5000), 'A 并发写者必须有回执')
  const receipt = existsSync(done) ? JSON.parse(readFileSync(done, 'utf8')) : { ok: false }
  writeFileSync(rel, 'go', 'utf8')
  ok((await childExitP) === 'exited', 'A 子进程应自然释放锁退出')
  const afterObj = JSON.parse(readFileSync(ws.storePath, 'utf8'))
  const cps = (afterObj.events[0] && afterObj.events[0].checkpoints) || []
  ok(receipt.ok === true && receipt.appended === 1, 'A 并发写者必须真成功（receipt=' + JSON.stringify(receipt) + '）')
  eq(cps.length, 1, 'A 并发成功写入的检查点必须存活（数量）')
  eq(cps[0] && cps[0].idemKey, 'k-concurrent', 'A 并发检查点 idemKey 必须存活')
  ok(/write-not-started/.test(String(res.reason || '')), 'A reason 必须含 write-not-started（实际 ' + String(res.reason || '').slice(0, 120) + '）')
  eq(res.ok, false, 'A 失败回执 ok=false')
  eq((res.applied || []).length, 0, 'A applied 必须为空（本次零写入）')
  eq((res.rolledBack || []).length, 0, 'A 零写入 ⇒ rolledBack 必须为空')
  eq(res.resumed, true, 'A 零写入失败必须经 B4 闸门恢复同步')
  eq(res.teamPaused, false, 'A resumed 后 teamPaused=false')
  eq(lsBackups(ws.handoff).length, 0, 'A 锁从未取到 ⇒ 不应产生备份目录（备份已在锁内）')
  ok(applyMs >= 9500 && applyMs < 20000, 'A 必须是真取锁超时（实测 ' + applyMs + 'ms）')
  console.log('[A] apply=' + applyMs + 'ms reason=' + String(res.reason || '').slice(0, 60) +
    ' 并发 checkpoints=' + cps.length + ' keys=' + JSON.stringify(cps.map((c) => c.idemKey)) +
    ' storeBytes ' + A0.length + '→' + readFileSync(ws.storePath).length + ' backups=' + lsBackups(ws.handoff).length)
}

// ═════════════════════════ B：本次零写入 ⇒ 不回滚，备份必须仍存在 ═════════════════════════
{
  const eng = mkEngine('B')
  const ws = setupWs(eng, 'caseB')
  await S.eventStorePre.create(ws.storePath, { name: 'E-B', now: 1762300000001 })
  const B0 = readFileSync(ws.storePath)
  chmodSync(ws.storePath, 0o444)        // 让同目录 rename 原子写失败（EPERM），而备份读得到
  const offer = offerFor({ 'event-store.json': EMPTY_STORE })
  const res = await eng.applyBaselineOfferPre({ ws: ws.wsCwd, expectedChecksum: offer.checksum })
  const backups = lsBackups(ws.handoff)
  eq(backups.length, 1, 'B 锁内备份必须已发生（目录存在）')
  const bkDir = backups.length ? path.join(ws.handoff, backups[0]) : ''
  const bkFile = bkDir ? path.join(bkDir, 'event-store.json') : ''
  ok(bkFile ? existsSync(bkFile) : false, 'B 备份文件必须仍存在（零写入失败不得删备份）')
  ok(bkFile && readFileSync(bkFile).length === B0.length, 'B 备份内容必须是旧库（' + B0.length + 'B）')
  eq(readFileSync(ws.storePath).length, B0.length, 'B 目标库必须未被改动')
  eq(sha(readFileSync(ws.storePath)), sha(B0), 'B 目标库 sha16 必须未变')
  ok(/write-not-started/.test(String(res.reason || '')), 'B 必须报 write-not-started（实际 ' + String(res.reason || '').slice(0, 120) + '）')
  eq((res.applied || []).length, 0, 'B applied 为空')
  eq((res.rolledBack || []).length, 0, 'B 零写入 ⇒ 绝不回滚')
  eq(res.resumed, true, 'B 恢复同步（走既有闸门）')
  console.log('[B] reason=' + String(res.reason || '').slice(0, 60) + ' backup=' + (bkFile ? 'exists/' + readFileSync(bkFile).length + 'B' : 'MISSING') +
    ' 目标库=' + readFileSync(ws.storePath).length + 'B rolledBack=' + JSON.stringify(res.rolledBack || []))
  unro(ws.storePath)
  if (bkFile) unro(bkFile)
}

// ═════════════════════════ C：写了一半 ⇒ 只回滚写过的文件 ═════════════════════════
{
  const eng = mkEngine('C')
  const ws = setupWs(eng, 'caseC')
  await S.eventStorePre.create(ws.storePath, { name: 'E-C', now: 1762300000002 })
  const C0 = readFileSync(ws.storePath)
  chmodSync(ws.storePath, 0o444)
  // 计划按文件名排序：PLAN.md 先写成功；event-store.json 后写失败 ⇒ 半截写入
  const offer = offerFor({ 'PLAN.md': '# remote plan from baseline\n', 'event-store.json': EMPTY_STORE })
  const res = await eng.applyBaselineOfferPre({ ws: ws.wsCwd, expectedChecksum: offer.checksum })
  const backups = lsBackups(ws.handoff)
  const planTarget = path.join(ws.handoff, 'PLAN.md')
  ok(!existsSync(planTarget), 'C 写过的 PLAN.md 必须被回滚（原本不存在 ⇒ 删除）')
  eq(readFileSync(ws.storePath).length, C0.length, 'C 未写过的 event-store 不得被回滚/改写')
  eq(sha(readFileSync(ws.storePath)), sha(C0), 'C 未写过的 event-store sha16 必须未变')
  eq(JSON.stringify(res.applied || []), JSON.stringify(['PLAN.md']), 'C applied 只含本次真写成功的文件')
  eq(JSON.stringify(res.rolledBack || []), JSON.stringify(['PLAN.md']), 'C 只回滚本次写过的文件')
  ok(/write-failed/.test(String(res.reason || '')) && /rolled-back/.test(String(res.reason || '')), 'C 半截失败必须如实报 write-failed + rolled-back（实际 ' + String(res.reason || '').slice(0, 140) + '）')
  eq(res.resumed, false, 'C 写了半截 ⇒ 不得自行 resume')
  eq(res.teamPaused, true, 'C 写了半截 ⇒ 回执必须 teamPaused=true')
  eq(eng.saveCalls.filter((x) => x.teamPaused === false).length, 0, 'C 半截失败不得写 teamPaused=false')
  eq(backups.length, 1, 'C 备份目录必须存在')
  const bkDir = backups.length ? path.join(ws.handoff, backups[0]) : ''
  ok(bkDir ? existsSync(path.join(bkDir, 'event-store.json')) : false, 'C 备份必须含原本存在的 event-store.json')
  ok(bkDir ? !existsSync(path.join(bkDir, 'PLAN.md')) : false, 'C 备份只含原本存在的文件（不含 PLAN.md）')
  console.log('[C] applied=' + JSON.stringify(res.applied || []) + ' rolledBack=' + JSON.stringify(res.rolledBack || []) +
    ' resumed=' + res.resumed + ' teamPaused=' + res.teamPaused + ' 目标库=' + readFileSync(ws.storePath).length + 'B planExists=' + existsSync(planTarget))
  unro(ws.storePath)
  if (bkDir && existsSync(path.join(bkDir, 'event-store.json'))) unro(path.join(bkDir, 'event-store.json'))
}

// ═════════════════════════ D：成功路径 —— 持锁时长实测 < 500ms，refresh 不在锁内 ═════════════════════════
{
  const eng = mkEngine('D')
  const ws = setupWs(eng, 'caseD')
  await S.eventStorePre.create(ws.storePath, { name: 'E-D', now: 1762300000003 })
  const lockPath = ws.storePath + '.lock.lock'
  let lockHeldAtRefresh = null
  const origRefresh = eng.refreshEventStatePre.bind(eng)
  eng.refreshEventStatePre = async (x) => { lockHeldAtRefresh = existsSync(lockPath); return origRefresh(x) }
  // 锁持有区间由独立进程用 fs.watch 事件实测（见 --watch-lock）；这里放 1MiB 正文延长一次复制/写入
  const planText = '# remote plan v2\n' + 'x'.repeat(1 * 1024 * 1024)
  const offer = offerFor({ 'PLAN.md': planText, 'event-store.json': EMPTY_STORE })
  const watchOut = path.join(WORKROOT, 'D-lock-watch.json')
  const watcher = spawn(process.execPath, [SELF, '--watch-lock', lockPath, watchOut, '5000'], { stdio: 'ignore' })
  const watcherExitP = waitExit(watcher, 10000)   // 监听必须先挂：写盘后立即退出的进程不能再等到 exit
  ok(await waitFile(watchOut + '.ready', 4000), 'D 锁观察子进程必须就绪')
  await sleep(20)                       // 让观察者先进入采样循环，再触发 apply（消除 ready→loop 的缝）
  const tD = Date.now()
  const res = await eng.applyBaselineOfferPre({ ws: ws.wsCwd, expectedChecksum: offer.checksum })
  const applyMs = Date.now() - tD
  ok(await waitFile(watchOut, 6000), 'D 锁观察子进程必须有结果')
  const w = existsSync(watchOut) ? JSON.parse(readFileSync(watchOut, 'utf8')) : { seen: false, hold: -1 }
  ok((await watcherExitP) === 'exited', 'D 观察子进程应退出')
  eq(res.ok, true, 'D 成功路径 ok=true')
  eq(JSON.stringify(res.applied || []), JSON.stringify(['PLAN.md', 'event-store.json']), 'D applied=计划全集')
  eq(readFileSync(path.join(ws.handoff, 'PLAN.md'), 'utf8'), planText, 'D PLAN.md 内容来自基线包')
  eq(JSON.parse(readFileSync(ws.storePath, 'utf8')).events.length, 0, 'D 事件库已换成基线包内容')
  ok(w.seen === true, 'D 独立观察进程必须看到锁文件（否则测不到持锁区间）')
  ok(w.hold >= 0 && w.hold < 500, 'D 持锁时长必须 < 500ms（实测 ' + w.hold + 'ms）')
  eq(lockHeldAtRefresh, false, 'D refreshEventStatePre 不得在持锁期间被调用')
  console.log('[D] apply=' + applyMs + 'ms 锁持有区间实数=' + w.hold + 'ms（观察进程采样）refresh 时锁存在=' + lockHeldAtRefresh)
}

// ═════════ E：备份后并发写 + 写失败 ⇒ 回滚必须还原到「锁内快照」，不是备份前旧值 ═════════
{
  const eng = mkEngine('E')
  const ws = setupWs(eng, 'caseE')
  await S.eventStorePre.create(ws.storePath, { name: 'E-E', now: 1762300000004 })
  const planTarget = path.join(ws.handoff, 'PLAN.md')
  writeFileSync(planTarget, '# plan-v0-old\n', 'utf8')
  const ready = path.join(WORKROOT, 'E-ready.txt')
  const sig = path.join(WORKROOT, 'E-sig.txt')
  const done = path.join(WORKROOT, 'E-done.json')
  const rel = path.join(WORKROOT, 'E-release.txt')
  const child = spawn(process.execPath, [SELF, '--hold-lock-plan', ws.storePath, planTarget, ready, sig, done, rel], { stdio: 'ignore' })
  const childExitP = waitExit(child, 20000)
  ok(await waitFile(ready, 10000), 'E 子进程必须已真持锁')
  const offer = offerFor({ 'PLAN.md': '# plan-v2-from-baseline\n', 'event-store.json': EMPTY_STORE })
  const applyP = eng.applyBaselineOfferPre({ ws: ws.wsCwd, expectedChecksum: offer.checksum })
  await sleep(150)
  writeFileSync(sig, 'go', 'utf8')                       // 放行：持锁者写 store + PLAN.md（v1）
  ok(await waitFile(done, 8000), 'E 并发写者必须完成写入')
  const receipt = existsSync(done) ? JSON.parse(readFileSync(done, 'utf8')) : { ok: false }
  const concurrentStore = readFileSync(ws.storePath)
  chmodSync(ws.storePath, 0o444)                        // 让 apply 写完 PLAN.md 后卡在 event-store（EPERM）
  writeFileSync(rel, 'go', 'utf8')                      // 放锁 ⇒ apply 取锁 → 锁内备份 → 写 PLAN.md → 失败 → 回滚
  const res = await applyP
  ok((await childExitP) === 'exited', 'E 子进程应自然释放锁')
  const backups = lsBackups(ws.handoff)
  ok(receipt.ok === true && receipt.appended === 1, 'E 并发写者必须真成功（store+PLAN）')
  eq(JSON.stringify(res.applied || []), JSON.stringify(['PLAN.md']), 'E applied 只含 PLAN.md')
  eq(JSON.stringify(res.rolledBack || []), JSON.stringify(['PLAN.md']), 'E 只回滚 PLAN.md')
  ok(/write-failed/.test(String(res.reason || '')), 'E 必须是 write-failed（实际 ' + String(res.reason || '').slice(0, 120) + '）')
  eq(readFileSync(planTarget, 'utf8'), CONCURRENT_PLAN, 'E 回滚必须还原到「取锁后的并发写入」，而不是备份前旧值 ⇒ 备份必须在锁内')
  eq(readFileSync(ws.storePath).length, concurrentStore.length, 'E 未写过的 event-store 不得被回滚')
  eq(((JSON.parse(readFileSync(ws.storePath, 'utf8')).events[0] || {}).checkpoints || []).length, 1, 'E 并发检查点存活')
  eq(res.resumed, false, 'E 写了半截 ⇒ 不得 resume')
  eq(res.teamPaused, true, 'E 写了半截 ⇒ teamPaused=true')
  eq(backups.length, 1, 'E 备份目录必须存在')
  const bkDir = backups.length ? path.join(ws.handoff, backups[0]) : ''
  ok(bkDir ? readFileSync(path.join(bkDir, 'PLAN.md'), 'utf8') === CONCURRENT_PLAN : false, 'E 备份快照必须含并发写入后的 PLAN.md（⇒ 备份在锁内）')
  ok(bkDir ? statSync(path.join(bkDir, 'event-store.json')).size === concurrentStore.length : false, 'E 备份快照必须含并发追加后的 event-store（' + concurrentStore.length + 'B）')
  console.log('[E] applied=' + JSON.stringify(res.applied || []) + ' rolledBack=' + JSON.stringify(res.rolledBack || []) +
    ' PLAN.md=' + JSON.stringify(readFileSync(planTarget, 'utf8')) + ' store=' + readFileSync(ws.storePath).length + 'B cps=' +
    (((JSON.parse(readFileSync(ws.storePath, 'utf8')).events[0] || {}).checkpoints || []).length) +
    ' backupStore=' + (bkDir ? statSync(path.join(bkDir, 'event-store.json')).size : -1) + 'B')
  unro(ws.storePath)
  if (bkDir && existsSync(path.join(bkDir, 'event-store.json'))) unro(path.join(bkDir, 'event-store.json'))
}

// ═════════════════════════ 清理 + 汇总 ═════════════════════════
try {
  for (const dir of [path.join(WORKROOT, 'memory', 'workspaces')]) {
    if (!existsSync(dir)) continue
    for (const wsDir of readdirSync(dir)) {
      const hd = path.join(dir, wsDir, 'handoff')
      if (!existsSync(hd)) continue
      for (const n of readdirSync(hd)) {
        if (n.startsWith('backup-baseline-')) {
          for (const f of readdirSync(path.join(hd, n))) unro(path.join(hd, n, f))
        }
      }
    }
  }
} catch (_) {}
try { rmSync(WORKROOT, { recursive: true, force: true }) } catch (_) {}

console.log('PASS ' + (fails.length === 0 ? 1 : 0) + ' / FAIL ' + fails.length)
for (const f of fails) console.log('  FAIL: ' + f)
console.log('[guard] ' + G.summary())
process.exit(fails.length === 0 && !G.failed() ? 0 : 1)

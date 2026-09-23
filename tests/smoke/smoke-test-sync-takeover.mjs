// 2026-09-17 · 索引同步「卡死自愈」回归锁（worker_v1.py）
//
// 背景（实测取证）：
//   JS 侧契约是「新 memoryIndexVersion latest-wins；旧 in-flight sync abort/cancel」
//   （lib/m7-index-sync-host.js:13/111/121），但 abort 只作用于 JS 的 fetch，
//   Python 从不收到取消帧；而 active_sync 原先只在 reject_sync(:371) 与 commit(:463)
//   两处清零 ⇒ 一次「begin 之后没收 page/commit」的同步会把槽永久占住，
//   此后每次 index_begin 都被回 sync-in-progress，索引永不 ready，语义唤回全程降级。
//   线上证据：engine-switch-state.json = failed:2527 / error:"sync-in-progress"；
//   诊断日志 index-not-ready 累计 22945 行（sync-in-progress 占 664），
//   且 worker 于 00:49:56 重启后仍持续出现 ⇒ 重启只是暂时缓解。
//
// 本套件钉住四条语义：
//   T1 基线：begin 成功后，同 key 同 syncId 再 begin ⇒ 仍拒 sync-in-progress（拒绝矩阵不变）
//   T2 接管：同 key 换 syncId（= JS 已放弃旧的）⇒ 必须受理，不再永久卡死 ★核心
//   T3 不误伤：**不同 key** 并发时不得互相抢占 ⇒ 仍拒 sync-in-progress（防跨工作区互踩）
//   T4 收尾：接管后的新同步 must 能正常 page→commit 走完，索引就绪
//
// 变异演示（真失败证据）：把 worker 的接管分支去掉（回到「active_sync 非空即拒」），
// T2 与 T4 必须转红；T1/T3 保持绿（证明它们钉的不是同一件事）。
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

process.on('uncaughtException', (e) => { console.error('[SYNC-TAKEOVER] FATAL:', (e && e.stack) || e); process.exit(1) })
process.on('unhandledRejection', (r) => { console.error('[SYNC-TAKEOVER] REJ:', r); process.exit(1) })

let pass = 0, fail = 0
function ok(cond, name) { if (cond) { pass++; console.log('  ok - ' + name) } else { fail++; console.error('  FAIL - ' + name) } }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const CLIENT = await import('../../lib/python-sidecar-client.js')
const SYNC = await import('../../lib/index-sync.js')
const HERE = path.dirname(fileURLToPath(import.meta.url))
const WORKER = path.join(HERE, '..', '..', 'python', 'worker_v1.py')

const home = mkdtempSync(path.join(tmpdir(), 'sync-takeover-'))
const client = CLIENT.createPythonSidecarClientPre({
  command: 'python', scriptPath: () => WORKER, dshHome: home, requestTimeoutMs: 10000,
})

async function healthReady(c, attempts = 10, gapMs = 400) {
  let last = null
  for (let i = 0; i < attempts; i++) {
    last = await c.health()
    if (last && last.frame) return last
    if (i < attempts - 1) await sleep(gapMs)
  }
  return last
}
// 与生产同源：用真实 buildIndexSyncPlansPre 生成 begin/page/commit（不手写协议帧）
function mkPlan(tag, miv, workspaceKey) {
  const wsrSeed = workspaceKey
  const records = [{
    memoryId: 'mem_' + tag.padEnd(32, '0').slice(0, 32).replace(/[^0-9a-f]/g, 'a'),
    anchorId: 'anc_pre_takeover',
    scope: 'Workspace',
    workspaceRef: 'wsr_' + wsrSeed.padEnd(32, '0').slice(0, 32).replace(/[^0-9a-f]/g, 'b'),
    sourceRef: 'workspace:MEMORY.md',
    sourceEpoch: 'e-' + tag,
    sourceVersion: 1,
    fileDigest: 'c'.repeat(64),
    recordDigest: 'd'.repeat(64),
    heading: 'h',
    text: '关于索引同步接管语义的记录 ' + tag,
    chunkId: 'chk_pre_' + 'e'.repeat(32),
    chunkOrdinal: 0,
    chunkCount: 1,
  }]
  const snapshot = {
    memoryIndexVersion: miv,
    sources: [{ scope: 'Workspace', sourceRef: 'workspace:MEMORY.md', sourceEpoch: 'e-' + tag, sourceVersion: 1, fileDigest: 'c'.repeat(64) }],
    records,
  }
  const built = SYNC.buildIndexSyncPlansPre({ snapshot, workspaceKey })
  if (!built || !built.ok || !built.plans || !built.plans.length) throw new Error('plan build failed: ' + JSON.stringify(built && built.reason))
  return built.plans[0]
}
const accepted = (r) => !!(r && r.frame && r.frame.payload && r.frame.payload.accepted === true)
const reasonOf = (r) => (r && r.frame && r.frame.payload && r.frame.payload.reason) || ('transport:' + ((r && r.code) || '?'))

console.log('[sync-takeover] worker =', WORKER)
const h = await healthReady(client)
ok(!!(h && h.frame), '前置：worker 起得来（' + (h && h.frame ? 'ok' : 'no frame') + '）')

const MIV_A = 'idx_pre_' + '1'.repeat(32)
const MIV_B = 'idx_pre_' + '2'.repeat(32)
const MIV_C = 'idx_pre_' + '3'.repeat(32)
const WS_A = 'D:/tmp/ws-takeover-a'
const WS_B = 'D:/tmp/ws-takeover-b'

const planA = mkPlan('a', MIV_A, WS_A)   // 同一 key（WS_A/Workspace）
const planB = mkPlan('b', MIV_B, WS_A)   // 同一 key，不同 miv ⇒ 不同 syncId
const planC = mkPlan('c', MIV_C, WS_B)   // 不同 key（WS_B/Workspace）

ok(planA.begin.syncId !== planB.begin.syncId, '前置：换 miv ⇒ syncId 确实不同（' + planA.begin.syncId.slice(0, 18) + ' vs ' + planB.begin.syncId.slice(0, 18) + '）')
ok(planA.begin.workspaceRef === planB.begin.workspaceRef, '前置：planA/planB 同 workspaceRef')

// ---- T1 拒绝矩阵不变：同 key 同 syncId 重复 begin 仍拒 ----
{
  const r1 = await client.request('index_sync_begin', planA.begin)
  ok(accepted(r1), 'T1a 首次 begin 受理')
  const r2 = await client.request('index_sync_begin', planA.begin)
  ok(!accepted(r2) && reasonOf(r2) === 'sync-in-progress', 'T1b 同 key 同 syncId 重复 begin ⇒ 仍拒 sync-in-progress（拒绝矩阵未放宽）实测=' + reasonOf(r2))
}

// ---- T3 防跨工作区互踩：不同 key 不得抢占（在 A 仍活跃时） ----
{
  const r3 = await client.request('index_sync_begin', planC.begin)
  ok(!accepted(r3) && reasonOf(r3) === 'sync-in-progress', 'T3 不同 key 并发 ⇒ 不得抢占，仍拒 sync-in-progress（实测=' + reasonOf(r3) + '）')
}

// ---- T2 核心：同 key 换 syncId ⇒ 必须接管（旧行为在此永久卡死） ----
{
  const r4 = await client.request('index_sync_begin', planB.begin)
  ok(accepted(r4), 'T2 同 key 换 syncId ⇒ 接管受理（旧实现恒回 sync-in-progress）实测=' + (accepted(r4) ? 'accepted' : reasonOf(r4)))
}

// ---- T4 接管后能走完 page→commit ----
{
  let allOk = true
  for (const pg of planB.pages) { const r = await client.request('index_sync_page', pg); if (!accepted(r)) { allOk = false; console.error('    page 被拒:', reasonOf(r)) } }
  const rc = await client.request('index_sync_commit', planB.commit)
  ok(allOk && accepted(rc), 'T4 接管后的同步可完整 page→commit（索引就绪路径打通）实测=' + (accepted(rc) ? 'commit accepted' : reasonOf(rc)))
}

// ---- T5 收尾后再 begin 同 syncId 不应再被「卡死」：应被受理（槽已空） ----
{
  const r5 = await client.request('index_sync_begin', planB.begin)
  ok(accepted(r5), 'T5 commit 后槽已释放 ⇒ 同 syncId 重新 begin 受理（证明不是永久卡死）实测=' + (accepted(r5) ? 'accepted' : reasonOf(r5)))
}

try { if (client.dispose) await client.dispose() } catch (_) {}
try { rmSync(home, { recursive: true, force: true }) } catch (_) {}

console.log('\n[sync-takeover] PASS=' + pass + ' FAIL=' + fail)
process.exit(fail ? 1 : 0)

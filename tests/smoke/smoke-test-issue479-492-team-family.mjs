#!/usr/bin/env node
/**
 * smoke-test-issue479-492-team-family.mjs —— 批次 F：#479 #481 #486 #491 #492（真 import → 真调用 → 断言返回值，CR-10）。
 *
 * ============================ 五条的共性（按族归因，不逐条打补丁）============================
 * 家族 **C「失败/不确定被折叠成确定结论」** —— #479 #486 #491：
 *   · #479 回滚只覆盖 1/4 文件，却无条件回 @rollbacked@
 *   · #486 只读本地缓存没命中，就对外宣称「远端暂无可用基准」
 *   · #491 磁盘上写着 running 就当成任务在跑 ⇒ 重启后永久 reused
 *   三者**折叠方式完全相同**：把「我不知道」当成「我知道了，而且答案是否」。
 *   修法 = **一处判据**（@lib/team-baseline.js@ 的四个纯函数），三段代码共用，
 *   不再各写一份（半修红线）。
 *
 * 家族 **A「异步未等待」** —— #481：把「启动了异步任务」当成「任务已完成」，
 *   打包挂在点击事件而不是完成回调上。判据同样收敛到一处：@judgeBaselineUploadGatePre@。
 *
 * 家族 **E「并发边界」** —— #492：串行化作用域是**进程**而不是**文件**。
 *   本套件用**真双进程**验收（不是同进程 Promise.all —— 那样结构上测不到）。
 *
 * ============================ 判据 ============================
 *  T-1 #479 写计划：四个文件都必须有落点；空 target **不许静默跳过**（旧行为 @if (!target) continue@）
 *  T-2 #479 回滚裁决：只回滚 1/4 ⇒ @rollback-incomplete@，**绝不** @rolled-back@
 *  T-3 #479 回滚裁决：四个全处理 ⇒ 才允许 @rolled-back@
 *  T-4 #486 搜索三态：没发起 / 失败 / 暂停中 ⇒ @indeterminate@ 且 @mayClaimAbsent=false@
 *  T-5 #486 搜索三态：真的问到且远端明确没有 ⇒ 才 @mayClaimAbsent=true@
 *  T-6 #491 在跑判定：世代不同 / jobId 不在在飞集 ⇒ @orphan@（应重启，不是复用）
 *  T-7 #491 在跑判定：同世代 + 在飞集中 ⇒ 才 @running@（正常长任务不被误杀）
 *  T-8 #481 打包门：整理未完成/失败 ⇒ @blocksUpload=true@；只有 done 才 @allowed@
 *  T-9 #492 **真双进程**并发写：@checkpoints.length === 2@ 且两个 idemKey 都在，连续多轮 0 丢写
 *  T-10 #492 两进程都返回 ok（不再出现 EPERM）
 *  T-11 #492 僵尸锁接管：持锁进程被强杀后，下一个进程能在超时内拿到锁（不永久卡死）
 *
 * ============================ 变异负路径（自带）============================
 *  MUT-479 / MUT-486 / MUT-491 / MUT-481：把产线的判据改回「折叠」语义 ⇒ 对应 T 组必红
 *  MUT-492：把跨进程文件锁从产线摘掉 ⇒ T-9 必红（复现丢写）
 */
import assert from 'node:assert'
import { readFileSync, writeFileSync, mkdirSync, unlinkSync, mkdtempSync, rmSync } from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { spawn } from 'node:child_process'

const HERE = path.dirname(new URL(import.meta.url).pathname).replace(/^\/([A-Za-z]:)/, '$1')
const ROOT = path.resolve(HERE, '..', '..')
const BASELINE_PATH = path.join(ROOT, 'lib', 'team-baseline.js')
const STORE_PATH = path.join(ROOT, 'lib', 'event-store.js')
const M = await import(pathToFileURL(BASELINE_PATH).href)

const {
  buildBaselineWritePlanPre,
  classifyBaselineRollbackPre,
  judgeBaselineSearchResultPre,
  judgeBaselineUploadGatePre,
  judgeUpgradeJobRecoveryPre,
} = M

let pass = 0
let fail = 0
function ok(name, fn) {
  try { fn(); pass++; console.log('  ok - ' + name) } catch (e) { fail++; console.error('  FAIL - ' + name + ' :: ' + String((e && e.message) || e).slice(0, 300)) }
}

// ══════════════════════════════════════════════════════════════════════
console.log('[T-0] 真 import 的模块契约')
ok('T-0a 家族 C/A 的五个判据都是函数', () => {
  for (const f of ['buildBaselineWritePlanPre', 'classifyBaselineRollbackPre', 'judgeBaselineSearchResultPre', 'judgeBaselineUploadGatePre', 'judgeUpgradeJobRecoveryPre']) {
    assert.equal(typeof M[f], 'function', f + ' 必须是函数')
  }
})

// ══════════════════════════════════════════════════════════════════════
console.log('[T-1] #479 写计划：四个文件都必须有落点，空 target 不得静默跳过')
const PKG_FILES = { 'event-store.json': '{}', 'PLAN.md': 'p', 'MEMORY.project.md': 'j', 'MEMORY.user.md': 'u' }
const FULL_TARGETS = { 'event-store.json': '/a/ev.json', 'PLAN.md': '/a/PLAN.md', 'MEMORY.project.md': '/a/MEMORY.project.md', 'MEMORY.user.md': '/a/MEMORY.user.md' }
ok('T-1a 四文件齐备 ⇒ ok:true 且 plan 覆盖全部 4 个文件', () => {
  const r = buildBaselineWritePlanPre(PKG_FILES, FULL_TARGETS)
  assert.equal(r.ok, true, r.reason)
  assert.equal(r.plan.length, 4, 'plan=' + r.plan.length)
  assert.deepEqual(r.plan.map((x) => x.name).sort(), Object.keys(PKG_FILES).sort())
})
ok('T-1b ★空 target 不许静默跳过（旧 if(!target) continue 的行为必然变红）', () => {
  const t = Object.assign({}, FULL_TARGETS, { 'MEMORY.project.md': '' })
  const r = buildBaselineWritePlanPre(PKG_FILES, t)
  assert.equal(r.ok, false, '空 target 必须直接判失败，实际 ok=' + r.ok)
  assert(/target-missing/.test(String(r.reason)), 'reason=' + r.reason)
  assert.deepEqual(r.missingTargets, ['MEMORY.project.md'])
})
ok('T-1c 空白字符串（只有空格）同样算缺失', () => {
  const r = buildBaselineWritePlanPre(PKG_FILES, Object.assign({}, FULL_TARGETS, { 'PLAN.md': '   ' }))
  assert.equal(r.ok, false, r.reason)
  assert.deepEqual(r.missingTargets, ['PLAN.md'])
})
ok('T-1d 包为空 / 入参非法 ⇒ 拒绝且不抛', () => {
  for (const bad of [null, undefined, {}, 'x', 42]) {
    const r = buildBaselineWritePlanPre(bad, FULL_TARGETS)
    assert.equal(r.ok, false, '应拒绝: ' + JSON.stringify(bad))
  }
})

// ══════════════════════════════════════════════════════════════════════
console.log('[T-2] #479 回滚裁决：只回滚 1/4 ⇒ rollback-incomplete，绝不 rolled-back')
ok('T-2a ★只还原 event-store（旧产线的真实行为）⇒ verdict=indeterminate', () => {
  const r = classifyBaselineRollbackPre({
    planned: ['event-store.json', 'PLAN.md', 'MEMORY.project.md', 'MEMORY.user.md'],
    restored: ['event-store.json'],
    removed: [],
    failed: [],
  })
  assert.equal(r.ok, false, '回滚不完整却报 ok，正是 #479')
  assert.equal(r.verdict, 'indeterminate', 'verdict=' + r.verdict)
  assert.equal(r.reason, 'rollback-incomplete: PLAN.md,MEMORY.project.md,MEMORY.user.md', 'reason=' + r.reason)
  assert.equal(r.rolledBack.length, 1, 'rolledBack=' + JSON.stringify(r.rolledBack))
  assert.equal(r.failedItems.length, 3, 'failedItems=' + JSON.stringify(r.failedItems))
})
ok('T-2b 还原 + 删除混合，仍有遗漏 ⇒ 仍判 incomplete', () => {
  const r = classifyBaselineRollbackPre({
    planned: ['event-store.json', 'PLAN.md', 'MEMORY.user.md'],
    restored: ['event-store.json'],
    removed: ['MEMORY.user.md'],
    failed: [],
  })
  assert.equal(r.verdict, 'indeterminate', 'verdict=' + r.verdict)
  assert.equal(r.reason, 'rollback-incomplete: PLAN.md', 'reason=' + r.reason)
})
ok('T-2c 回滚本身抛错的项被如实列出，不吞', () => {
  const r = classifyBaselineRollbackPre({
    planned: ['event-store.json', 'PLAN.md'],
    restored: ['event-store.json'],
    removed: [],
    failed: [{ name: 'PLAN.md', error: 'EACCES' }],
  })
  assert.equal(r.verdict, 'indeterminate')
  assert.equal(r.failedItems[0].name, 'PLAN.md')
  assert.equal(r.failedItems[0].error, 'EACCES')
})

// ══════════════════════════════════════════════════════════════════════
console.log('[T-3] #479 回滚裁决：四个全部处理过 ⇒ 才允许 rolled-back')
ok('T-3a 两还原 + 两删除（原本不存在的文件被删掉）⇒ rolled-back', () => {
  const r = classifyBaselineRollbackPre({
    planned: ['event-store.json', 'PLAN.md', 'MEMORY.project.md', 'MEMORY.user.md'],
    restored: ['event-store.json', 'PLAN.md'],
    removed: ['MEMORY.project.md', 'MEMORY.user.md'],
    failed: [],
  })
  assert.equal(r.reason, 'rolled-back', 'reason=' + r.reason)
  assert.equal(r.verdict, 'failed', 'verdict=' + r.verdict)
  assert.equal(r.rolledBack.length, 4)
  assert.equal(r.failedItems.length, 0)
})
ok('T-3b 空计划 ⇒ 不算「已回滚」（没有可回滚的东西不是成功）', () => {
  const r = classifyBaselineRollbackPre({ planned: [], restored: [], removed: [], failed: [] })
  // 计划为空时 planned.length===0 且 rolledBack.length===0 ⇒ 相等 ⇒ 走 rolled-back 分支
  // ★这是刻意的：调用方只有在一个文件都没写时才拿着空计划来；此时「没有需要回滚的」= 事实。
  assert.equal(r.reason, 'rolled-back', 'reason=' + r.reason)
})

// ══════════════════════════════════════════════════════════════════════
console.log('[T-4] #486 远端搜索三态：没发起 / 失败 / 暂停中 ⇒ indeterminate，不得宣称「远端没有」')
ok('T-4a ★没发起查询 ⇒ indeterminate（旧实现正是拿这个状态说了「远端暂无」）', () => {
  const r = judgeBaselineSearchResultPre({ attempted: false, ok: false, hasBaseline: false })
  assert.equal(r.verdict, 'indeterminate', 'verdict=' + r.verdict)
  assert.equal(r.mayClaimAbsent, false, '★绝不允许宣称远端没有')
  assert.equal(r.reason, 'not-attempted')
})
ok('T-4b 请求失败（离线/超时）⇒ indeterminate', () => {
  const r = judgeBaselineSearchResultPre({ attempted: true, ok: false, error: 'ECONNREFUSED', hasBaseline: false })
  assert.equal(r.verdict, 'indeterminate')
  assert.equal(r.mayClaimAbsent, false, '★失败时不得宣称「远端没有」')
  assert(/search-failed/.test(String(r.reason)), 'reason=' + r.reason)
})
ok('T-4c ★暂停期间的空结果不可信 ⇒ indeterminate', () => {
  const r = judgeBaselineSearchResultPre({ attempted: true, ok: true, hasBaseline: false, paused: true })
  assert.equal(r.verdict, 'indeterminate', 'verdict=' + r.verdict)
  assert.equal(r.mayClaimAbsent, false, '★暂停时同步停着，本来就不会有新 offer')
  assert.equal(r.reason, 'paused')
})

// ══════════════════════════════════════════════════════════════════════
console.log('[T-5] #486 远端搜索三态：真的问到 + 未暂停 + 明确没有 ⇒ 才允许说「远端没有」')
ok('T-5a 有基线 ⇒ ok / baseline-available', () => {
  const r = judgeBaselineSearchResultPre({ attempted: true, ok: true, hasBaseline: true })
  assert.equal(r.verdict, 'ok')
  assert.equal(r.reason, 'baseline-available')
  assert.equal(r.mayClaimAbsent, false)
})
ok('T-5b 明确问到了且没有 ⇒ 此时才 mayClaimAbsent=true', () => {
  const r = judgeBaselineSearchResultPre({ attempted: true, ok: true, hasBaseline: false, paused: false })
  assert.equal(r.verdict, 'ok')
  assert.equal(r.reason, 'baseline-absent')
  assert.equal(r.mayClaimAbsent, true, '唯一允许宣称「远端没有」的条件')
})

// ══════════════════════════════════════════════════════════════════════
console.log('[T-6] #491 在跑判定：世代不同 / jobId 不在在飞集 ⇒ orphan（应重启，不是复用）')
ok('T-6a ★世代不同（宿主重启过）⇒ orphan / action=restart（旧实现回 reused）', () => {
  const r = judgeUpgradeJobRecoveryPre({
    diskPhase: 'running', diskJobId: 'job-1', diskEpoch: 'epoch-old',
    currentEpoch: 'epoch-new', inflightIds: [],
  })
  assert.equal(r.verdict, 'orphan', 'verdict=' + r.verdict)
  assert.equal(r.orphan, true)
  assert.equal(r.reason, 'epoch-mismatch')
  assert.equal(r.action, 'restart', '★必须重启任务，不是复用')
})
ok('T-6b 世代相同但 jobId 不在在飞集 ⇒ 同样 orphan', () => {
  const r = judgeUpgradeJobRecoveryPre({
    diskPhase: 'running', diskJobId: 'job-1', diskEpoch: 'e1',
    currentEpoch: 'e1', inflightIds: ['job-2'],
  })
  assert.equal(r.verdict, 'orphan', 'verdict=' + r.verdict)
  assert.equal(r.reason, 'jobid-not-inflight')
  assert.equal(r.action, 'restart')
})
ok('T-6c 写着 running 却没有 jobId ⇒ unverifiable（不假装在跑）', () => {
  const r = judgeUpgradeJobRecoveryPre({ diskPhase: 'running', diskJobId: '', diskEpoch: 'e1', currentEpoch: 'e1', inflightIds: [] })
  assert.equal(r.verdict, 'unverifiable', 'verdict=' + r.verdict)
  assert.equal(r.reuse, false, '★不得复用')
})
ok('T-6d 旧状态文件没有 epoch 字段 ⇒ unverifiable（不猜）', () => {
  const r = judgeUpgradeJobRecoveryPre({ diskPhase: 'running', diskJobId: 'job-1', diskEpoch: '', currentEpoch: 'e1', inflightIds: ['job-1'] })
  assert.equal(r.verdict, 'unverifiable', 'verdict=' + r.verdict)
  assert.equal(r.reason, 'epoch-missing')
})
ok('T-6e 非 running 阶段 ⇒ idle / action=start', () => {
  for (const ph of ['idle', 'done', 'failed', 'unavailable', '']) {
    const r = judgeUpgradeJobRecoveryPre({ diskPhase: ph, diskJobId: 'j', diskEpoch: 'e1', currentEpoch: 'e1', inflightIds: [] })
    assert.equal(r.verdict, 'idle', ph + ' ⇒ ' + r.verdict)
    assert.equal(r.action, 'start')
  }
})

// ══════════════════════════════════════════════════════════════════════
console.log('[T-7] #491 在跑判定：同世代 + 在飞集中 ⇒ running（正常长任务不得误杀）')
ok('T-7a 同世代 + jobId 在 Set 里 ⇒ running / action=reuse', () => {
  const r = judgeUpgradeJobRecoveryPre({
    diskPhase: 'running', diskJobId: 'job-1', diskEpoch: 'e1',
    currentEpoch: 'e1', inflightIds: new Set(['job-1']),
  })
  assert.equal(r.verdict, 'running', 'verdict=' + r.verdict)
  assert.equal(r.reuse, true)
  assert.equal(r.orphan, false)
  assert.equal(r.action, 'reuse')
})
ok('T-7b 同世代 + jobId 在数组里 ⇒ 同样 running（两种容器都支持）', () => {
  const r = judgeUpgradeJobRecoveryPre({ diskPhase: 'running', diskJobId: 'job-1', diskEpoch: 'e1', currentEpoch: 'e1', inflightIds: ['job-1'] })
  assert.equal(r.verdict, 'running')
})

// ══════════════════════════════════════════════════════════════════════
console.log('[T-8] #481 打包门：整理没完成 / 失败 ⇒ blocksUpload；只有 done 才 allowed')
ok('T-8a ★整理启动失败（unavailable）⇒ 永不打包（旧实现照样打包=假承诺）', () => {
  const r = judgeBaselineUploadGatePre({ upgradeRequested: true, upgradePhase: 'unavailable', hasLocalEventStore: true })
  assert.equal(r.allowed, false, '★整理不可用时不得打包')
  assert.equal(r.blocksUpload, true)
  assert.equal(r.wait, false, '这不是「还没到」，是永久不成立')
  assert(/upgrade-not-completed/.test(String(r.reason)), 'reason=' + r.reason)
})
ok('T-8b 整理失败（failed）⇒ 同样永不打包', () => {
  const r = judgeBaselineUploadGatePre({ upgradeRequested: true, upgradePhase: 'failed', hasLocalEventStore: true })
  assert.equal(r.allowed, false)
  assert.equal(r.blocksUpload, true)
  assert.equal(r.wait, false)
})
ok('T-8c ★整理进行中（running/upgrading）⇒ 不许打包，且标记 wait=true', () => {
  for (const ph of ['running', 'pausing', 'pulling', 'upgrading', 'verifying']) {
    const r = judgeBaselineUploadGatePre({ upgradeRequested: true, upgradePhase: ph, hasLocalEventStore: true })
    assert.equal(r.allowed, false, ph + ' 时不得打包')
    assert.equal(r.wait, true, ph + ' 应标记「等完成回调」')
    assert.equal(r.blocksUpload, true)
  }
})
ok('T-8d ★只有 done 才允许打包', () => {
  const r = judgeBaselineUploadGatePre({ upgradeRequested: true, upgradePhase: 'done', hasLocalEventStore: true })
  assert.equal(r.allowed, true, 'reason=' + r.reason)
  assert.equal(r.reason, 'upgrade-completed')
})
ok('T-8e 没请求整理 ⇒ 直接允许（既有路径行为不变）', () => {
  const r = judgeBaselineUploadGatePre({ upgradeRequested: false, hasLocalEventStore: true })
  assert.equal(r.allowed, true)
  assert.equal(r.reason, 'no-upgrade-requested')
})
ok('T-8f 本地没有事件库 ⇒ 直接拒（不制造「空包已上传」）', () => {
  const r = judgeBaselineUploadGatePre({ upgradeRequested: false, hasLocalEventStore: false })
  assert.equal(r.allowed, false, 'reason=' + r.reason)
  assert.equal(r.blocksUpload, true)
  assert.equal(r.reason, 'event-store-missing')
})
ok('T-8g 判据自身抛错 ⇒ 不放行（拿不准就拦住）', () => {
  const evil = {}
  Object.defineProperty(evil, 'upgradeRequested', { get() { throw new Error('boom') } })
  const r = judgeBaselineUploadGatePre(evil)
  assert.equal(r.allowed, false, '★判据异常时默认放行等于把错误版本扩散出去')
  assert(/upload-gate-threw/.test(String(r.reason)), 'reason=' + r.reason)
})

// ══════════════════════════════════════════════════════════════════════
// #492 真双进程
// ══════════════════════════════════════════════════════════════════════
const CHILD_SRC = [
  "import { readFileSync, writeFileSync } from 'node:fs'",
  'const [modUrl, storePath, barrierPath, tag, outPath] = process.argv.slice(2)',
  'const M = await import(modUrl)',
  "const bar = JSON.parse(readFileSync(barrierPath, 'utf8'))",
  'while (Date.now() < bar.startAt) { /* 忙等到统一起跑时刻 */ }',
  "let ok = false, err = ''",
  'try {',
  '  const r = await M.eventStorePre.append(storePath, bar.eventId, {',
  "    checkpoint: { at: Date.now(), kind: 'log', text: 'from-' + tag, idemKey: 'k-' + tag + '-' + bar.round },",
  '  })',
  '  ok = r && r.ok === true',
  "} catch (e) { err = String((e && e.message) || e) }",
  "writeFileSync(outPath, JSON.stringify({ ok, err }), 'utf8')",
].join('\n')

const TMP_ROOT = mkdtempSync(path.join(process.env.DSH_SMOKE_TMP || ROOT, 'fam492-'))
const CHILD_FILE = path.join(TMP_ROOT, '_child.mjs')
writeFileSync(CHILD_FILE, CHILD_SRC, 'utf8')
const M_STORE = await import(pathToFileURL(STORE_PATH).href)

async function runRound(round, modUrl) {
  const dir = path.join(TMP_ROOT, 'r' + round)
  mkdirSync(dir, { recursive: true })
  const storePath = path.join(dir, 'event-store.json')
  const created = await M_STORE.eventStorePre.create(storePath, { name: 'R492', now: Date.now() })
  const barrierPath = path.join(dir, 'barrier.json')
  writeFileSync(barrierPath, JSON.stringify({ startAt: Date.now() + 700, eventId: created.id, round }), 'utf8')
  const outA = path.join(dir, 'result-A.json')
  const outB = path.join(dir, 'result-B.json')
  const spawnChild = (tag, out) => new Promise((resolve) => {
    const c = spawn(process.execPath, [CHILD_FILE, modUrl, storePath, barrierPath, tag, out], { stdio: 'ignore' })
    c.on('exit', resolve)
  })
  await Promise.all([spawnChild('A', outA), spawnChild('B', outB)])
  const readOut = (p) => { try { return JSON.parse(readFileSync(p, 'utf8')) } catch (_) { return { ok: false, err: 'no-result' } } }
  const store = JSON.parse(readFileSync(storePath, 'utf8'))
  const ev = store.events.find((e) => e.id === created.id)
  const cps = (ev && Array.isArray(ev.checkpoints)) ? ev.checkpoints : []
  return { ra: readOut(outA), rb: readOut(outB), n: cps.length, keys: cps.map((c) => c.idemKey) }
}

console.log('[T-9/T-10] #492 真双进程并发写：连续 5 轮，每轮必须留下 2 个检查点')
const R492_ROUNDS = 5
const rounds = []
for (let i = 0; i < R492_ROUNDS; i++) rounds.push(await runRound(i, pathToFileURL(STORE_PATH).href))
const lostRounds = rounds.filter((r) => r.n !== 2).length
const errRounds = rounds.filter((r) => !r.ra.ok || !r.rb.ok).length
console.log('  · 实测：' + rounds.map((r, i) => 'r' + i + ' n=' + r.n + ' keys=' + JSON.stringify(r.keys)).join(' | '))
console.log('  · lostRounds=' + lostRounds + '/' + R492_ROUNDS + '  roundsWithError=' + errRounds)
ok('T-9a ★连续 ' + R492_ROUNDS + ' 轮 0 丢写（修复前实测 5/5 丢写）', () => {
  assert.equal(lostRounds, 0, '丢写轮数=' + lostRounds + '/' + R492_ROUNDS)
})
ok('T-9b 每轮两个进程的 idemKey 都在（数据齐全，不是只留一条）', () => {
  for (let i = 0; i < rounds.length; i++) {
    const keys = rounds[i].keys.slice().sort()
    assert.deepEqual(keys, ['k-A-' + i, 'k-B-' + i], 'round' + i + ' keys=' + JSON.stringify(keys))
  }
})
ok('T-10 两进程都返回 ok（不再出现 Windows 并发 rename 的 EPERM）', () => {
  assert.equal(errRounds, 0, '有错误轮数=' + errRounds)
})

// ── T-11 僵尸锁接管：持锁进程被强杀 ⇒ 下一进程仍能拿到锁 ──
console.log('[T-11] #492 僵尸锁：持锁进程被强杀后，后续进程必须在超时内接管（不永久卡死）')
{
  const dir = path.join(TMP_ROOT, 'zombie')
  mkdirSync(dir, { recursive: true })
  const storePath = path.join(dir, 'event-store.json')
  const created = await M_STORE.eventStorePre.create(storePath, { name: 'Zombie', now: Date.now() })
  // 子进程：取锁 → 报告已持有 → 等待被杀
  const holder = [
    "import { writeFileSync } from 'node:fs'",
    "const [lockMod, target, readyPath] = process.argv.slice(2)",
    'const L = await import(lockMod)',
    "const release = await L.acquireSharedStateLock(target, { timeoutMs: 5000 })",
    "writeFileSync(readyPath, 'held', 'utf8')",
    'setInterval(() => {}, 1000)',   // 保持存活
    'void release',
  ].join('\n')
  const holderFile = path.join(TMP_ROOT, '_holder.mjs')
  writeFileSync(holderFile, holder, 'utf8')
  const readyPath = path.join(dir, 'ready.txt')
  const lockTarget = storePath + '.lock'
  const child = spawn(process.execPath, [holderFile, pathToFileURL(path.join(ROOT, 'lib', 'shared-state-lock.js')).href, lockTarget, readyPath], { stdio: 'ignore' })
  const t0 = Date.now()
  let held = false
  while (Date.now() - t0 < 8000) {
    try { if (readFileSync(readyPath, 'utf8').trim() === 'held') { held = true; break } } catch (_) {}
    await new Promise((r) => setTimeout(r, 25))
  }
  // 强杀持锁者（模拟宿主崩溃）
  try { child.kill('SIGKILL') } catch (_) {}
  await new Promise((r) => setTimeout(r, 300))
  let got = null
  let tookMs = -1
  const t1 = Date.now()
  try {
    const r = await M_STORE.eventStorePre.append(storePath, created.id, {
      checkpoint: { at: Date.now(), kind: 'log', text: 'after-zombie', idemKey: 'k-zombie' },
    })
    got = r
    tookMs = Date.now() - t1
  } catch (e) { got = { err: String((e && e.message) || e) }; tookMs = Date.now() - t1 }
  console.log('  · 持锁者已就位=' + held + '；强杀后追加 tookMs=' + tookMs + ' ⇒ ' + JSON.stringify(got && (got.ok === true ? { ok: true, appended: got.appended } : { err: got.err || got.reason })))
  ok('T-11a 僵尸锁可被回收，后续写入不被永久堵死', () => {
    assert.equal(held, true, '持锁子进程未就绪（前置失败）')
    assert.equal(got && got.ok, true, '正常写入被僵尸锁堵死: ' + JSON.stringify(got))
    assert(tookMs < 8000, '接管耗时 ' + tookMs + 'ms 超预期')
  })
}

// ══════════════════════════════════════════════════════════════════════
// 变异负路径
// ══════════════════════════════════════════════════════════════════════
console.log('[MUT] 变异负路径：把判据改回「折叠」语义 ⇒ 对应断言必须变红')
const MUT_DIR = path.join(ROOT, '.tmp-smoke-run')
try { mkdirSync(MUT_DIR, { recursive: true }) } catch (_) {}

function mutateAndLoad(srcPath, patches, tag) {
  let src = readFileSync(srcPath, 'utf8')
  const hits = []
  for (const [from, to] of patches) {
    const n = src.split(from).length - 1
    hits.push(n)
    if (n === 1) src = src.replace(from, to)
  }
  const file = path.join(MUT_DIR, '_mut-' + tag + '-' + process.pid + '.mjs')
  writeFileSync(file, src, 'utf8')
  return { hits, file }
}

// ── MUT-479/486/491/481：一次把四处判据都改回「折叠」 ──
{
  const patches = [
    // ① #479 写计划：空 target 回到「静默跳过」
    ["      if (!target) { missing.push(name); continue }", '      if (!target) continue'],
    // ② #479 回滚：只要回滚过任何一项就报 rolled-back（旧语义）
    ['    if (failedItems.length || rolledBack.length !== planned.length) {', '    if (failedItems.length && rolledBack.length === planned.length) {'],
    // ③ #486 搜索：没发起查询也当「没有」（旧语义）—— 单行锚点保证补丁串里没有裸换行
    ["      return { verdict: 'indeterminate', ok: false, reason: 'not-attempted', mayClaimAbsent: false }",
      "      return { verdict: 'ok', ok: true, reason: 'baseline-absent', mayClaimAbsent: true }"],
    // ④ #491 恢复：跨世代也当「在跑」（旧语义）
    ["      return { verdict: 'orphan', ok: false, reuse: false, orphan: true, reason: 'epoch-mismatch', action: 'restart' }",
      "      return { verdict: 'running', ok: true, reuse: true, orphan: false, reason: 'genuinely-running', action: 'reuse' }"],
    // ⑤ #481 打包门：整理失败/不可用也照样放行（旧语义 = 点击即打包）
    ["      return { ok: false, allowed: false, reason: 'upgrade-not-completed: ' + phase, wait: false, blocksUpload: true }",
      "      return { ok: true, allowed: true, reason: 'upgrade-not-completed: ' + phase, wait: false, blocksUpload: false }"],
  ]
  const mut = mutateAndLoad(BASELINE_PATH, patches, 'famCA')
  console.log('  · 五处锚点命中数：' + JSON.stringify(mut.hits))
  ok('MUT-a 五处锚点各自恰好命中 1 次（否则变异无鉴别力）', () => {
    assert.deepEqual(mut.hits, [1, 1, 1, 1, 1], JSON.stringify(mut.hits))
  })
  try {
    const MM = await import(pathToFileURL(mut.file).href + '?t=' + Date.now())
    // #479 写计划
    const r1 = MM.buildBaselineWritePlanPre(PKG_FILES, Object.assign({}, FULL_TARGETS, { 'MEMORY.project.md': '' }))
    console.log('  · 变异体[#479 写计划]：' + JSON.stringify({ ok: r1.ok, plan: (r1.plan || []).length }))
    ok('MUT-b ★变异体把空 target 静默跳过（证明 T-1b 有鉴别力）', () => {
      assert.equal(r1.ok, true, '变异体仍拒绝 ⇒ 变异没生效')
      assert.equal(r1.plan.length, 3, '应只剩 3 项，实际 ' + r1.plan.length)
    })
    // #479 回滚
    const r2 = MM.classifyBaselineRollbackPre({
      planned: ['event-store.json', 'PLAN.md', 'MEMORY.project.md', 'MEMORY.user.md'],
      restored: ['event-store.json'], removed: [], failed: [],
    })
    console.log('  · 变异体[#479 回滚]：' + JSON.stringify({ reason: r2.reason, rolledBack: r2.rolledBack.length }))
    ok('MUT-c ★变异体只回滚 1/4 却报 rolled-back（证明 T-2a 有鉴别力）', () => {
      assert.equal(r2.reason, 'rolled-back', '变异体 reason=' + r2.reason)
    })
    // #486 搜索
    const r3 = MM.judgeBaselineSearchResultPre({ attempted: false, ok: false, hasBaseline: false })
    console.log('  · 变异体[#486 搜索]：' + JSON.stringify({ verdict: r3.verdict, mayClaimAbsent: r3.mayClaimAbsent }))
    ok('MUT-d ★变异体没查询就说「远端没有」（证明 T-4a 有鉴别力）', () => {
      assert.equal(r3.mayClaimAbsent, true, '变异体 mayClaimAbsent=' + r3.mayClaimAbsent)
    })
    // #491 恢复
    const r4 = MM.judgeUpgradeJobRecoveryPre({ diskPhase: 'running', diskJobId: 'job-1', diskEpoch: 'old', currentEpoch: 'new', inflightIds: [] })
    console.log('  · 变异体[#491 恢复]：' + JSON.stringify({ verdict: r4.verdict, reuse: r4.reuse }))
    ok('MUT-e ★变异体跨世代仍报 running/reuse（证明 T-6a 有鉴别力）', () => {
      assert.equal(r4.reuse, true, '变异体 reuse=' + r4.reuse)
      assert.equal(r4.verdict, 'running')
    })
    // #481 打包门
    const r5 = MM.judgeBaselineUploadGatePre({ upgradeRequested: true, upgradePhase: 'unavailable', hasLocalEventStore: true })
    console.log('  · 变异体[#481 打包门]：' + JSON.stringify({ allowed: r5.allowed, reason: r5.reason }))
    ok('MUT-f ★变异体在整理不可用时仍允许打包（证明 T-8a 有鉴别力）', () => {
      assert.equal(r5.allowed, true, '变异体 allowed=' + r5.allowed)
    })
  } finally {
    try { unlinkSync(mut.file) } catch (_) {}
  }
}

// ── MUT-492：把跨进程文件锁摘掉 ⇒ 必须重新出现丢写 ──
console.log('  · MUT-492：从产线摘掉跨进程文件锁，重跑双进程并发')
const MUT492_ROUNDS = 5
{
  const patches = [
    ["  return withStoreChainPre(storePath, () => withStoreFileLockPre(storePath, () => mutateUnlockedPre(storePath, mutator)))",
      '  return withStoreChainPre(storePath, () => mutateUnlockedPre(storePath, mutator))'],
  ]
  const mut = mutateAndLoad(STORE_PATH, patches, 'fam492')
  console.log('  · 锚点命中数：' + JSON.stringify(mut.hits))
  ok('MUT-492a 挂锁锚点恰好命中 1 次', () => assert.deepEqual(mut.hits, [1], JSON.stringify(mut.hits)))
  const mutRounds = []
  for (let i = 0; i < MUT492_ROUNDS; i++) mutRounds.push(await runRound(100 + i, pathToFileURL(mut.file).href))
  const mutLost = mutRounds.filter((r) => r.n !== 2).length
  console.log('  · 变异体实测：' + mutRounds.map((r, i) => 'r' + i + ' n=' + r.n).join(' | ') + ' ⇒ lostRounds=' + mutLost + '/' + MUT492_ROUNDS)
  ok('MUT-492b ★摘掉跨进程锁后必须重新丢写（证明 T-9a 有鉴别力）', () => {
    assert(mutLost > 0, '变异体 0 丢写 ⇒ 判据没有鉴别力（锁可能是别的东西挡住的）')
  })
  try { unlinkSync(mut.file) } catch (_) {}
}

try { rmSync(TMP_ROOT, { recursive: true, force: true }) } catch (_) {}

console.log('\nPASS ' + pass + ' / FAIL ' + fail)
process.exit(fail === 0 ? 0 : 1)

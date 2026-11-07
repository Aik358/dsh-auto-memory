/**
 * smoke-test-issue548-549-hub-and-queue.mjs —— P0-2 验收（2026-11-07）
 *
 * 覆盖（真执行 + 负路径 + 幂等 + 变异锚点）：
 *   #548 ① 子代理会话 id 在中枢白名单内 ⇒ 跨区写通过（`hubAccessIdsPre` 收 upgrade 子代理）
 *   #548 ② wsPath 是记忆存储目录，不得当 cwd 再编码（`resolveUpgradeWriteTargetPre` 纯决策层）
 *   #548 ③ 写闸区分整理执行者与普通并发写者（`upgradeGateVerdictPre` 纯决策层）
 *   #549 补写队列：入队保存目标身份 / 终态与启动两条 replay 路径 / 失败保留 / 幂等
 *
 * ★本套件全部真 import → 真构造 → 真调用 → 断言返回值（CR-10）；
 *   不做「源码含某字符串」式恒真断言。
 * ★变异锚点（M1–M3）：见各段末尾说明，变异在副本里做。
 */
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { readFile, writeFile, mkdir, rm } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { createHarness } from './_harness.mjs'
import {
  decideWriteTargetPre,
  normalizeWsKeyPre,
  isHubSessionPre,
  WRITE_DENY,
} from '../../lib/hub-access.js'
import {
  MAX_PENDING_ATTEMPTS,
  pendingReplayOrderPre,
  buildPendingEntryPre,
  validatePendingEntryPre,
  resolvePendingTargetPre,
  upgradeGateVerdictPre,
  hubAccessIdsPre,
} from '../../lib/upgrade-pending.js'

const T = createHarness('issue548-549')
const ROOT = fileURLToPath(new URL('../..', import.meta.url))

// ══════════════════════════════════════════════════════════════════════════════
console.log('== A. #548① 中枢身份白名单纳入整理子代理 ==')
{
  // A-1 纯函数：hubAccessIdsPre 把父会话与已登记子代理会话合并去重
  const ids = hubAccessIdsPre({
    parentSessionIds: ['sess-parent'],
    subagentSessionIds: ['sess-upg-1', 'sess-upg-2', 'sess-parent'],
  })
  T.eq(ids, ['sess-parent', 'sess-upg-1', 'sess-upg-2'], 'A-1 父会话 + 整理子代理会话合并去重（父在首）')
  T.eq(hubAccessIdsPre({ parentSessionIds: [], subagentSessionIds: [] }), [], 'A-2 空输入 ⇒ 空集合（fail closed，不猜）')
  T.eq(hubAccessIdsPre({}), [], 'A-3 无参数 ⇒ 空集合不炸')
  T.ok(hubAccessIdsPre({ parentSessionIds: ['  sess-a  '], subagentSessionIds: [' sess-a '] }).length === 1, 'A-4 去空白后同一会话只留一条')

  // A-5 ★真调用 decideWriteTargetPre：子代理 sessionId 在白名单内 ⇒ 跨区写放行
  const allowed = ['--D--proj-a--', '/mem/workspaces/--D--proj-b--']
  const asChild = decideWriteTargetPre({
    sessionId: 'sess-upg-1',
    hubSessionIds: ids,
    boundWs: 'D:/hub',
    requestedWs: '--D--proj-a--',
    allowedWs: allowed,
  })
  T.ok(asChild.ok === true && asChild.target === '--D--proj-a--', 'A-5 ★子代理会话 id 在白名单内 ⇒ 跨区写通过（#548 核心）', JSON.stringify(asChild))

  // A-6 ★负路径：未授权子代理仍被拒
  const asStranger = decideWriteTargetPre({
    sessionId: 'sess-random',
    hubSessionIds: ids,
    boundWs: 'D:/hub',
    requestedWs: '--D--proj-a--',
    allowedWs: allowed,
  })
  T.ok(asStranger.ok === false && asStranger.code === WRITE_DENY.NOT_HUB, 'A-6 ★★负路径：未授权会话仍被拒（cross-workspace-write-requires-hub）', asStranger.code)

  // A-7 身份集合为空 ⇒ 全否（不因「有清单」就放行）
  const emptyHub = decideWriteTargetPre({
    sessionId: 'sess-upg-1', hubSessionIds: [], boundWs: 'D:/hub',
    requestedWs: '--D--proj-a--', allowedWs: allowed,
  })
  T.ok(emptyHub.ok === false && emptyHub.code === WRITE_DENY.NOT_HUB, 'A-7 身份集合为空 ⇒ 拒绝（fail closed）')
}

// ══════════════════════════════════════════════════════════════════════════════
console.log('')
console.log('== B. #548② wsPath 是存储目录，不得当 cwd 再编码 ==')
{
  const cfg = {
    memoryRoot: '/mem/workspaces',
    wsKeyOf: (p) => '--' + String(p).replace(/[\\/:*?"<>|]/g, '-') + '--',
    projectDirOf: (ws) => '/mem/workspaces/' + ('--' + String(ws).replace(/[\\/:*?"<>|]/g, '-') + '--'),
    cwdOfWsKey: (key) => (key === '--D--proj-a--' ? 'D:/proj-a' : ''),
  }
  const inv = [
    { wsKey: '--D--proj-a--', wsPath: '/mem/workspaces/--D--proj-a--' },
    { wsKey: '--D--proj-b--', wsPath: '/mem/workspaces/--D--proj-b--' },
  ]

  // B-1 传目录名 ⇒ 命中，且 projectDir 就是该行 wsPath（不是二次编码）
  const byKey = resolvePendingTargetPre({ requestedWs: '--D--proj-a--', inventory: inv, cfg })
  T.ok(byKey.ok === true, 'B-1 传目录名可命中', JSON.stringify(byKey))
  T.eq(byKey.projectDir, '/mem/workspaces/--D--proj-a--', 'B-2 ★★projectDir 直接取清单 wsPath（不再经 projectDirOf 二次编码）')
  T.eq(byKey.cwd, 'D:/proj-a', 'B-3 cwd 由 wsKey 反查得到（真实工作区路径）')

  // B-4 ★★核心负路径：传存储目录 ⇒ 必须落到同一个库，不得写进另一个目录
  const byPath = resolvePendingTargetPre({ requestedWs: '/mem/workspaces/--D--proj-a--', inventory: inv, cfg })
  T.ok(byPath.ok === true && byPath.projectDir === '/mem/workspaces/--D--proj-a--', 'B-4 ★★传清单存储路径 ⇒ 落点仍是同一个库（旧实现会写进另一个目录）', String(byPath.projectDir))
  T.ok(byPath.projectDir !== cfg.projectDirOf('/mem/workspaces/--D--proj-a--'), 'B-5 ★变异锚点：二次编码会得到不同目录（证明 B-4 有区分力）', cfg.projectDirOf('/mem/workspaces/--D--proj-a--'))

  // B-6 传真实 cwd ⇒ 命中同一个区
  const byCwd = resolvePendingTargetPre({ requestedWs: 'D:/proj-a', inventory: inv, cfg })
  T.ok(byCwd.ok === true && byCwd.projectDir === '/mem/workspaces/--D--proj-a--', 'B-6 传真实 cwd ⇒ 命中同一区')

  // B-7 反查不到 cwd ⇒ 回落 wsKey 并标记（不静默当成成功解析）
  const noCwd = resolvePendingTargetPre({ requestedWs: '--D--proj-b--', inventory: inv, cfg })
  T.ok(noCwd.ok === true && noCwd.wsUnresolved === true, 'B-7 反查不到 cwd ⇒ wsUnresolved=true（不假装解析成功）')
  T.eq(noCwd.cwd, '--D--proj-b--', 'B-8 ★反查不到时 cwd 回落目录名（仍是确定的字符串，不是空）')

  // B-9 ★负路径：不在清单 ⇒ 明确拒绝
  const ghost = resolvePendingTargetPre({ requestedWs: 'D:/proj-zzz', inventory: inv, cfg })
  T.ok(ghost.ok === false && ghost.code === 'workspace-not-in-manifest', 'B-9 ★负路径：清单外目标被拒', ghost.code)

  // B-10 空清单 ⇒ 拒绝一切（fail closed）
  const emptyInv = resolvePendingTargetPre({ requestedWs: '--D--proj-a--', inventory: [], cfg })
  T.ok(emptyInv.ok === false && emptyInv.code === 'workspace-not-in-manifest', 'B-10 空清单 ⇒ 拒绝（fail closed）')
}

// ══════════════════════════════════════════════════════════════════════════════
console.log('')
console.log('== C. #548③ 写闸区分「整理执行者」与「普通并发写者」 ==')
{
  const running = { phase: 'running', runId: 'upg_1', subagentSessionIds: ['sess-upg-1'] }

  // C-1 普通并发写者（升级 running）⇒ 拦 + 落队列
  const bystander = upgradeGateVerdictPre({ state: running, sessionId: 'sess-user', tool: 'memory_log' })
  T.ok(bystander.blocked === true && bystander.queued === true, 'C-1 普通并发写者 ⇒ 拦下并入队', JSON.stringify(bystander))

  // C-2 ★★整理执行者 ⇒ 放行（#548 核心诉求）
  const executor = upgradeGateVerdictPre({ state: running, sessionId: 'sess-upg-1', tool: 'memory_event' })
  T.ok(executor.blocked === false, 'C-2 ★★整理执行者写闸放行（不再被暂存）', JSON.stringify(executor))
  T.eq(executor.reason, 'upgrade-executor', 'C-3 放行原因可判定（upgrade-executor）')

  // C-4 ★负路径：身份相近但不在集合内 ⇒ 仍拦
  const near = upgradeGateVerdictPre({ state: running, sessionId: 'sess-upg-2', tool: 'memory_event' })
  T.ok(near.blocked === true, 'C-4 ★负路径：不在执行者集合内的子代理仍被拦')

  // C-5 未运行 ⇒ 一律放行（零行为变化）
  const idle = upgradeGateVerdictPre({ state: { phase: 'done' }, sessionId: 'sess-user', tool: 'memory_log' })
  T.ok(idle.blocked === false && idle.reason === 'not-running', 'C-5 未 running ⇒ 放行（既有行为不变）')

  // C-6 无 runId ⇒ 拦但标记不可入队（不假装已暂存）
  const noRun = upgradeGateVerdictPre({ state: { phase: 'running' }, sessionId: 'sess-user', tool: 'memory_log' })
  T.ok(noRun.blocked === true && noRun.queued === false && noRun.reason === 'no-run-id', 'C-6 ★无 runId ⇒ 拦但 queued=false（不谎报已暂存）')

  // C-7 只读工具不在闸门集合内（决策层不关心，闸门集合由调用方判定）
  const gate = upgradeGateVerdictPre({ state: running, sessionId: 'sess-user', tool: 'memory_recall' })
  T.ok(gate.blocked === true, 'C-7 决策层不自行放宽工具白名单（集合判定留在调用方，判据只有一份）')
}

// ══════════════════════════════════════════════════════════════════════════════
console.log('')
console.log('== D. #549 入队必须保存目标身份（现在缺 sessionId 与已解析目标）==')
{
  const entry = buildPendingEntryPre({
    tool: 'memory_log',
    args: { note: '迁移期被拒的第 1 条', workspace: '--D--proj-a--' },
    sessionId: 'sess-user',
    target: { wsKey: '--D--proj-a--', projectDir: '/mem/workspaces/--D--proj-a--', cwd: 'D:/proj-a' },
    at: 1793500000000,
  })
  T.ok(entry && entry.target && entry.target.wsKey === '--D--proj-a--', 'D-1 入队保存已解析目标（wsKey）')
  T.eq(entry.target.projectDir, '/mem/workspaces/--D--proj-a--', 'D-2 入队保存目标 projectDir（回放据此定位原库）')
  T.eq(entry.sessionId, 'sess-user', 'D-3 入队保存 sessionId')
  T.eq(entry.tool, 'memory_log', 'D-4 入队保存工具名')
  T.eq(entry.attempts, 0, 'D-5 attempts 初值 0（供重试计数）')

  const v = validatePendingEntryPre(entry)
  T.ok(v.ok === true, 'D-6 合法条目校验通过', JSON.stringify(v))

  // D-7 ★负路径②：缺目标身份 ⇒ 明确报错（不是静默丢弃、也不是静默成功）
  const noTarget = validatePendingEntryPre({ tool: 'memory_log', args: {}, sessionId: 's', at: 1 })
  T.ok(noTarget.ok === false && noTarget.code === 'missing-target', 'D-7 ★★负路径：缺目标身份 ⇒ 明确报错 missing-target（不静默丢弃）', noTarget.code)
  const noTool = validatePendingEntryPre({ target: { projectDir: '/x' }, args: {}, at: 1 })
  T.ok(noTool.ok === false && noTool.code === 'missing-tool', 'D-8 缺工具名 ⇒ explicit 报错')
  const noArgs = validatePendingEntryPre({ tool: 'memory_log', target: { projectDir: '/x' }, at: 1 })
  T.ok(noArgs.ok === false && noArgs.code === 'missing-args', 'D-9 缺参数 ⇒ explicit 报错')
  const badTool = validatePendingEntryPre({ tool: 'memory_recall', args: {}, target: { projectDir: '/x' }, at: 1 })
  T.ok(badTool.ok === false && badTool.code === 'tool-not-gateable', 'D-10 ★只读工具不得入队（入队白名单与写闸同源）', badTool.code)

  // D-11 schema 版本可判定
  T.ok(typeof entry.schema === 'string' && entry.schema.length > 0, 'D-11 条目带 schema 版本（便于将来迁移）')
}

// ══════════════════════════════════════════════════════════════════════════════
console.log('')
console.log('== E. #549 回放顺序 + 重试上限（纯函数）==')
{
  const mk = (at, id) => ({ file: '/q/' + at + '-' + id + '.json', queuedAt: at, attempts: 0 })
  const files = [mk(30, 'c'), mk(10, 'a'), mk(20, 'b')]
  const order = pendingReplayOrderPre(files)
  T.eq(order.map((x) => x.queuedAt), [10, 20, 30], 'E-1 回放按 queuedAt 升序（时间序，不靠文件名）')

  const retried = [
    { file: '/q/1.json', queuedAt: 1, attempts: 0 },
    { file: '/q/2.json', queuedAt: 2, attempts: MAX_PENDING_ATTEMPTS },
  ]
  const picked = pendingReplayOrderPre(retried)
  T.eq(picked.map((x) => x.file), ['/q/1.json'], 'E-2 已达重试上限的条目不参与本轮（但仍留在盘上）')
  T.ok(MAX_PENDING_ATTEMPTS >= 2, 'E-3 重试上限 ≥2（一次失败不算放弃）', String(MAX_PENDING_ATTEMPTS))
}

// ══════════════════════════════════════════════════════════════════════════════
console.log('')
console.log('== F. #549 真实 replay：终态路径 / 启动路径 / 失败保留 / 幂等 ==')
{
  const {
    enqueuePendingWritePre, replayPendingWritesPre, listPendingWritesPre, countPendingWritesPre,
  } = await import('../../lib/upgrade-pending.js')

  const root = T.tmpdir('issue549-queue-')
  const RUN = 'upg_e2e_1'
  const applied = []

  // F-1/F-2 两条真条目（带目标身份）
  for (const n of [1, 2]) {
    const e = buildPendingEntryPre({
      tool: 'memory_log',
      args: { note: '条目' + n, workspace: '--D--proj-a--' },
      sessionId: 'sess-user',
      target: { wsKey: '--D--proj-a--', projectDir: '/mem/workspaces/--D--proj-a--', cwd: 'D:/proj-a' },
      at: 1793500000000 + n,
    })
    const w = await enqueuePendingWritePre({ root, runId: RUN, entry: e, now: 1793500000000 + n })
    T.ok(w.ok === true && fs.existsSync(w.file), 'F-' + n + ' 真入队并落盘（含目标身份）')
  }
  const rec = JSON.parse(await readFile((await listPendingWritesPre({ root, runId: RUN }))[0], 'utf8'))
  T.ok(rec.entry && rec.entry.target && rec.entry.target.projectDir, 'F-3 ★队列文件里确实带着目标身份（回放能定位原库）')

  // F-4 终态路径：真 replay，apply 收到目标身份
  const r1 = await replayPendingWritesPre({
    root, runId: RUN,
    apply: async (entry) => { applied.push(entry.target.wsKey); return { ok: true } },
  })
  T.eq([r1.replayed, r1.failed, r1.remaining], [2, 0, 0], 'F-4 ★终态路径 replay 成功 2 条、无残留')
  T.eq(applied, ['--D--proj-a--', '--D--proj-a--'], 'F-5 apply 逐条拿到原目标身份')

  // F-6 启动路径：不带 runId（扫全部 run）
  await enqueuePendingWritePre({ root, runId: 'upg_boot', entry: buildPendingEntryPre({ tool: 'memory_log', args: { note: 'x' }, target: { wsKey: 'k', projectDir: '/p' }, sessionId: 's', at: 1 }), now: 1793500009999 })
  const bootSeen = []
  const r2 = await replayPendingWritesPre({ root, apply: async (e) => { bootSeen.push(e.target.projectDir); return { ok: true } } })
  T.ok(r2.replayed === 1 && bootSeen[0] === '/p', 'F-6 ★启动路径（不带 runId）扫全部 run 并真补写', JSON.stringify(r2))
  T.eq((await countPendingWritesPre({ root })).total, 0, 'F-7 两条路径跑完后队列清空')

  // F-8 ★负路径③：apply 失败 ⇒ 条目不删、attempts 可判
  await enqueuePendingWritePre({ root, runId: 'upg_fail', entry: buildPendingEntryPre({ tool: 'memory_log', args: { note: 'y' }, target: { wsKey: 'k', projectDir: '/p' }, sessionId: 's', at: 1 }), now: 1793500011111 })
  const r3 = await replayPendingWritesPre({ root, runId: 'upg_fail', apply: async () => { throw new Error('宿主写盘失败') } })
  T.eq([r3.replayed, r3.failed, r3.remaining], [0, 1, 1], 'F-8 ★★负路径：apply 抛错 ⇒ failed=1 且 remaining=1')
  T.ok(fs.existsSync(r3.results[0].file), 'F-9 ★★失败条目仍在盘上（不丢文件）')
  const rec2 = JSON.parse(await readFile(r3.results[0].file, 'utf8'))
  T.eq(rec2.attempts, 1, 'F-10 失败后 attempts 累加（供重试上限判定）')
  T.eq(rec2.lastError && rec2.lastError.code, 'apply-threw', 'F-11 失败原因写进条目（可见状态）')

  // F-12 幂等：同一条目回放两次，效果只发生一次
  const once = []
  await enqueuePendingWritePre({ root, runId: 'upg_idem', entry: buildPendingEntryPre({ tool: 'memory_log', args: { note: 'z' }, target: { wsKey: 'k', projectDir: '/p' }, sessionId: 's', at: 1 }), now: 1793500022222 })
  const a1 = await replayPendingWritesPre({ root, runId: 'upg_idem', apply: async () => { once.push(1); return { ok: true } } })
  const a2 = await replayPendingWritesPre({ root, runId: 'upg_idem', apply: async () => { once.push(1); return { ok: true } } })
  T.eq([a1.replayed, a2.replayed], [1, 0], 'F-12 ★幂等：第一次 replayed=1，第二次 replayed=0（源文件已删）')
  T.eq(once.length, 1, 'F-13 ★幂等：apply 只被调用 1 次（效果只发生一次）')

  // F-14 启动恢复必须 fail-soft：队列根不存在时返回 0，不抛
  const emptyRoot = T.tmpdir('issue549-empty-')
  const r4 = await replayPendingWritesPre({ root: emptyRoot, apply: async () => ({ ok: true }) })
  T.ok(r4 && r4.replayed === 0 && r4.failed === 0, 'F-14 空队列 ⇒ 全 0 不抛（启动路径必须 fail-soft）')
}

// ══════════════════════════════════════════════════════════════════════════════
console.log('')
console.log('== I. ★决策层与工具白名单正交（Lead 复核要求）==')
{
  // 判据：换任何工具，决策结果只能由「身份×状态」决定 —— 一旦有人把工具白名单塞进决策层，这条必红。
  const runStates = [
    { phase: 'running', runId: 'r', subagentSessionIds: ['s1'] },
    { phase: 'running', runId: 'r', subagentSessionIds: [] },
    { phase: 'running' },
    { phase: 'done' },
  ]
  const sids = ['s1', 'stranger', '']
  const tools = ['memory_log', 'memory_note', 'memory_event', 'memory_recall', 'memory_search', 'some_future_tool']
  let orthogonal = true
  let probes = 0
  for (const st of runStates) {
    for (const sid of sids) {
      const baseline = upgradeGateVerdictPre({ state: st, sessionId: sid, tool: tools[0] })
      for (const t2 of tools.slice(1)) {
        const got = upgradeGateVerdictPre({ state: st, sessionId: sid, tool: t2 })
        probes++
        if (JSON.stringify(got) !== JSON.stringify(baseline)) orthogonal = false
      }
    }
  }
  T.ok(orthogonal, 'I-1 ★★决策结果与工具名正交（换工具不改变判定 ⇒ 白名单不在决策层）', 'probes=' + probes)
  T.ok(probes === 60, 'I-2 探针数量符合预期（4 状态 × 3 身份 × 5 对照工具）', String(probes))
  // 反向：身份真的会影响结果（证明上一条不是「恒真」）
  const asExec = upgradeGateVerdictPre({ state: { phase: 'running', runId: 'r', subagentSessionIds: ['s1'] }, sessionId: 's1', tool: 'memory_log' })
  const asOther = upgradeGateVerdictPre({ state: { phase: 'running', runId: 'r', subagentSessionIds: ['s1'] }, sessionId: 'stranger', tool: 'memory_log' })
  T.ok(asExec.blocked !== asOther.blocked, 'I-3 ★对照：身份确实改变判定（I-1 不是恒真）')
  // ★②（Lead 复核要求）：壳 agent 路径失败必须**点名缺什么**，不能只报 handler-threw。
  //   判据取自源码（守卫，非功能证据）—— 因为壳路径需要真 engine 才能跑；但它是可证伪的：
  //   把 code 改回 handler-threw，本条立刻红。
  const IX2 = (await readFile(path.join(ROOT, 'lib', 'index.js'), 'utf8'))
  T.ok(IX2.indexOf("'shell-agent-missing-ctx'") >= 0, 'I-4 ★壳 agent 失败有点名错误码 shell-agent-missing-ctx')
  T.ok(/if \(shelled\)[\s\S]{0,240}shell-agent-missing-ctx/.test(IX2), 'I-5 ★该错误码只在 shelled 分支返回（真 agent 路径仍报 handler-threw）')
  T.ok(IX2.indexOf('壳 agent 缺少完整会话上下文') >= 0, 'I-6 错误文案点名缺的是完整会话上下文（无 ctx/parent）')
}

// ══════════════════════════════════════════════════════════════════════════════
console.log('')
console.log('== H. ★label 匹配（字符串枚举写错不报错，必须真跑一遍）==')
{
  const IX = (await readFile(path.join(ROOT, 'lib', 'index.js'), 'utf8')).split('\r\n').join('\n')
  // 从源码抽出常量与 subagentJob 归一化函数，真执行
  const constM = /const CROSS_WS_ALLOWED_LABELS = Object\.freeze\(\[([^\]]*)\]\)/.exec(IX)
  T.ok(!!constM, 'H-1 能抽出 CROSS_WS_ALLOWED_LABELS 常量定义')
  const labels = constM ? constM[1].split(',').map((s) => s.trim().replace(/^'|'$/g, '')).filter(Boolean) : []
  const jobStart = IX.indexOf('function subagentJob(label) {')
  let depth = 0, i = IX.indexOf('{', jobStart), end = -1
  for (; i < IX.length; i++) { const c = IX[i]; if (c === '{') depth++; else if (c === '}') { depth--; if (depth === 0) { end = i + 1; break } } }
  const subagentJob = new Function('return (' + IX.slice(jobStart, end) + ')')()
  T.ok(typeof subagentJob === 'function', 'H-2 能抽出 subagentJob 归一化函数并真执行')
  // ★真跑：真实 label 归一化后必须命中白名单
  const upgradeJob = subagentJob('auto-memory-upgrade')
  T.eq(upgradeJob, 'upgrade', 'H-3 ★真 label auto-memory-upgrade 归一化为 upgrade')
  T.ok(labels.indexOf(upgradeJob) >= 0, 'H-4 ★★真实 upgrade label 命中白名单（防「枚举写错静默不生效」）', JSON.stringify(labels) + ' vs ' + upgradeJob)
  // ★负路径：另外 10 个 auto-memory-* job 必须不命中
  const others = ['auto-memory-consolidate', 'auto-memory-consolidate-logs', 'auto-memory-distill', 'auto-memory-fold', 'auto-memory-greet', 'auto-memory-summarize', 'auto-memory-smart-kw', 'auto-memory-smart-ans', 'auto-memory-ws-map']
  const leaked = others.filter((lb) => labels.indexOf(subagentJob(lb)) >= 0)
  T.eq(leaked, [], 'H-5 ★负路径：其余 auto-memory-* job 一律不命中白名单（不扩大授权面）')
  // 展示名（带 lane/代次）也必须归一化到同一键
  T.eq(subagentJob('auto-memory-long-upgrade-g03'), 'upgrade', 'H-6 ★展示名（lane+代次）归一化后同样命中')
  T.ok(labels.indexOf(subagentJob('auto-memory-long-upgrade-g03')) >= 0, 'H-7 ★「同一个 label 的三种写法」都能命中（归一化判据只有一份）')
  T.eq(subagentJob('auto-memory-long-upgrade-g03'), subagentJob('auto-memory-upgrade'), 'H-8 三种写法归一化到同一个稳定键')
}

// ══════════════════════════════════════════════════════════════════════════════
console.log('')
console.log('== G. 接线守卫（源码级，明确标注「守卫，非功能证据」）==')
{
  const IX = (await readFile(path.join(ROOT, 'lib', 'index.js'), 'utf8')).split(String.fromCharCode(13) + String.fromCharCode(10)).join(String.fromCharCode(10))
  T.ok(IX.indexOf('hubAccessIdsPre(') >= 0, 'G-1 [守卫] hubSessionIdsPre 已改走 hubAccessIdsPre（合并子代理身份）')
  T.ok(IX.indexOf('upgradeGateVerdictPre(') >= 0, 'G-2 [守卫] upgradeWriteGatePre 已接纯决策层')
  T.ok(IX.indexOf("reason: verdict.reason") >= 0 && IX.indexOf('upgradeGateVerdictPre({ state: gateState') >= 0, 'G-3 [守卫] 闸门区分了整理执行者分支（决策层返回 reason，闸门不再只看 phase）')
  T.ok(IX.indexOf('replayUpgradePendingWritesPre(') >= 0, 'G-4 [守卫] 存在 replay 引擎方法（终态/启动共用）')
  const fin = IX.indexOf('async finishUpgradeJobPre(')
  const finEnd = IX.indexOf(String.fromCharCode(10) + '  }' + String.fromCharCode(10), fin)
  T.ok(fin > 0 && IX.slice(fin, finEnd).indexOf('replayUpgradePendingWritesPre(') >= 0, 'G-5 [守卫] finishUpgradeJobPre 内接 replay（终态路径）')
  T.ok(IX.indexOf('resolvePendingTargetPre(') >= 0, 'G-6 [守卫] 落点解析走新纯决策层 resolvePendingTargetPre') 
  T.ok(IX.indexOf('resolvePaths({ session: { id: \'\', header: { cwd: d.target } } })') < 0, 'G-7 ★[守卫] 旧的「把 target 当 cwd 喂回 resolvePaths」已不存在')
}

T.done()

/**
 * issue #343 回归锁 —— **行为级**（真 import → 真构造 → 真调用 → 断言返回值/副作用）。
 *
 * 缺陷形态：lib/team-pull.js:192-194 注释「即使有被拒项：游标前进」把**所有**失败一视同仁地
 *   当作「拒绝已留痕、重拉没意义」⇒ 只要有一条**临时**失败（磁盘 EACCES/写事务失败/锁被占…），
 *   游标照样前进，这批变更**永远不会被重放**，而返回值还是 ok:true —— 调用方以为已落盘。
 *   报告症状：一次 EACCES 之后即使故障恢复，普通下一次 pull（**不 reset**）也补不回来。
 *
 * 修法（本套件断言的判据）：
 *   · **临时失败**（EACCES/EPERM/EBUSY/EIO/ENOSPC/写事务失败/锁被占…）⇒ 游标**不前进**、
 *     回 ok:false + retryable:true + deferred 计数与错误码；
 *   · **业务拒绝**（未知 kind / 无 applier / 门拒绝 / 畸形数据）⇒ 照旧前进游标（重拉结果一样）；
 *   · 已成功应用的条目在重放时**幂等**（applier 侧 kind+key 去重），不会重复写入。
 *
 * 全部断言基于真调用返回值与**可观测状态**（applier 侧真写入的集合 / status().since），
 *   不使用源码字符串守卫。
 *
 * 运行：node tests/smoke/smoke-test-issue343-pull-cursor.mjs
 * 退出码：有 FAIL 即 1（变异子进程的红由**父进程**断言，父进程自身应为绿）。
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = path.resolve(fileURLToPath(new URL('../..', import.meta.url)))
const REAL_SRC = path.join(ROOT, 'lib', 'team-pull.js')
// PULL_PATH 只给变异子进程用：指向「把 #343 修复退回旧写法」的副本。
const PULL_PATH = process.env.PULL_PATH ? path.resolve(process.env.PULL_PATH) : REAL_SRC
const CHILD = process.env.I343_CHILD === '1'

let pass = 0
let fail = 0
function ok(cond, name, extra) {
  if (cond) { pass++; console.log('  ok - ' + name) }
  else { fail++; console.error('  FAIL - ' + name + (extra ? ' :: ' + extra : '')) }
}
const loadPull = () => import(pathToFileURL(PULL_PATH).href)

/** 造一个「批」服务器：把 changes 与 cursor 固定，模拟服务端增量端点。 */
function batchServer(changes, cursor) {
  let calls = 0
  return {
    fetchJson: async (p) => { calls++; return { ok: true, data: { changes, cursor } } },
    calls: () => calls,
  };
}

/** 造一个真 applier（**同步**，与生产契约一致）：成功的条目真写进 store（幂等：按 kind+key 去重）。 */
function realApplier(store) {
  return (payload, ch) => {
    const dk = ch.kind + '|' + ch.key
    if (!store.has(dk)) store.set(dk, payload)   // ★幂等：重复应用不重复写
    return { ok: true, outcome: 'applied' }
  };
}

async function main() {
  const { createTeamPuller } = await loadPull()
  console.log('=== issue #343 team-pull 游标推进语义 行为级回归' + (CHILD ? ' [变异子进程模式]' : '') + ' ===')

  // ===================================================================
  // ① ★报告症状真复现：一次 EACCES ⇒ 游标**不得**前进；故障恢复后**普通下一次 pull**（不 reset）补存
  // ===================================================================
  {
    const store = new Map()
    let failing = true
    const srv = batchServer([
      { kind: 'fact', key: 'F1', payload: { v: 1 } },
      { kind: 'fact', key: 'F2', payload: { v: 2 } },
    ], 100)
    const puller = createTeamPuller({
      engine: { config: { teamEnabled: true }, _teamEpoch: 0 },
      fetchJson: srv.fetchJson,
      appliers: {
        // ★applier 契约与生产一致 = **同步**（index.js:14847 的 fact applier 就是同步的；
        //   本模块的 apply 调用点不 await ⇒ 异步 applier 返回的 Promise 是 truthy，会被当成成功）。
        fact: (payload, ch) => {
          if (failing) {
            const e = new Error('injected EACCES while writing fact store')
            e.code = 'EACCES'   // ★结构化错误码：临时失败的可判定依据（不猜文案）
            throw e
          }
          const dk = ch.kind + '|' + ch.key
          if (!store.has(dk)) store.set(dk, payload)
          return { ok: true, outcome: 'applied' }
        },
      },
    })
    const r1 = await puller.pullOnce()
    ok(r1.ok === false, '★#343 有临时失败(EACCES) ⇒ 如实回 ok:false（旧实现:游标前进且回 ok:true）', JSON.stringify(r1))
    ok(r1.retryable === true, '★#343 明确标注 retryable:true（调用方据此重试而不是当作终局失败）', JSON.stringify(r1))
    ok(r1.deferred === 2, '★#343 deferred 计数如实(2 条都是临时失败)', JSON.stringify({ deferred: r1.deferred, codes: r1.deferredCodes }))
    ok(Array.isArray(r1.deferredCodes) && r1.deferredCodes.indexOf('EACCES') >= 0,
      '★#343 返回值带出真实错误码 EACCES（诊断可见，不必翻日志）', JSON.stringify(r1.deferredCodes))
    ok(r1.since === 0, '★#343 游标**未前进**(since 仍为 0) —— 这批变更下次会被重放', 'since=' + r1.since)
    ok(puller.status().since === 0, '★#343 status() 里的游标同样是 0（无副作用泄漏）', 'since=' + puller.status().since)
    ok(store.size === 0, '★#343 前提:第一次确实一条都没写进去（applier 全部抛 EACCES）', 'size=' + store.size)

    // 故障恢复 ⇒ **普通下一次 pull**（不 reset、不换实例）必须把两条都补存
    failing = false
    const r2 = await puller.pullOnce()
    ok(r2.ok === true && r2.applied === 2, '★#343 故障恢复后普通下一次 pull 补存成功（旧实现:游标已前进 ⇒ 永远拉不到）', JSON.stringify(r2))
    ok(store.has('fact|F1') && store.has('fact|F2'), '★#343 两条都真的落进了 store（内容补回来了）', JSON.stringify([...store.keys()]))
    ok(puller.status().since === 100, '★#343 这次才推进游标(100)', 'since=' + puller.status().since)

    // 幂等：把 since 复位重放同一批 ⇒ 不得重复写入（applier 按 kind+key 幂等）
    puller.reset()
    const r3 = await puller.pullOnce()
    ok(r3.ok === true && r3.applied === 2, '★#343 重放同一批：applier 全部再次成功（幂等路径已生效）', JSON.stringify(r3))
    ok(store.size === 2, '★#343 重放**不重复写入**（已成功条目幂等，size 仍为 2）', 'size=' + store.size)
  }

  // ===================================================================
  // ② ★负路径对照 A：**业务拒绝**（未知 kind / 无 applier）⇒ 照旧前进游标（不许死循环重放）
  // ===================================================================
  {
    const store = new Map()
    const srv = batchServer([
      { kind: 'fact', key: 'G1', payload: { v: 1 } },
      { kind: 'totally-unknown-kind', key: 'X1', payload: {} },
      { kind: 'handoff', key: 'H1', payload: {} },   // 没有 handoff applier ⇒ 业务拒绝
    ], 200)
    const puller = createTeamPuller({
      engine: { config: { teamEnabled: true }, _teamEpoch: 0 },
      fetchJson: srv.fetchJson,
      appliers: { fact: realApplier(store) },
    })
    const r = await puller.pullOnce()
    ok(r.ok === true, '★#343 负路径:纯业务拒绝 ⇒ 仍回 ok:true（拒绝已留痕，不是临时错误）', JSON.stringify(r))
    ok(r.applied === 1 && r.rejected === 2 && r.deferred === 0,
      '★#343 负路径:1 applied / 2 rejected / 0 deferred', JSON.stringify({ applied: r.applied, rejected: r.rejected, deferred: r.deferred }))
    ok(puller.status().since === 200, '★#343 负路径:纯业务拒绝 ⇒ 游标**照旧前进**(200)，避免死循环重拉同一批', 'since=' + puller.status().since)
  }

  // ===================================================================
  // ③ ★负路径对照 B：**混合批次** —— 有临时失败时，即使同批里有成功条目，游标也不许动
  // ===================================================================
  {
    const store = new Map()
    let failKeys = { F2: true }
    const srv = batchServer([
      { kind: 'fact', key: 'F1', payload: { v: 1 } },
      { kind: 'fact', key: 'F2', payload: { v: 2 } },
    ], 300)
    const puller = createTeamPuller({
      engine: { config: { teamEnabled: true }, _teamEpoch: 0 },
      fetchJson: srv.fetchJson,
      appliers: {
        fact: (payload, ch) => {
          if (failKeys[ch.key]) { const e = new Error('transient write failure'); e.code = 'EBUSY'; throw e }
          const dk = ch.kind + '|' + ch.key
          if (!store.has(dk)) store.set(dk, payload)
          return { ok: true, outcome: 'applied' }
        },
      },
    })
    const r = await puller.pullOnce()
    ok(r.ok === false && r.applied === 1 && r.deferred === 1,
      '★#343 混合批次:成功 1 条 + 临时失败 1 条 ⇒ ok:false 且两项计数都对', JSON.stringify(r))
    ok(r.since === 0, '★#343 混合批次:游标**不动**（成功的 F1 下次会被幂等重放，失败的 F2 才补得上）', 'since=' + r.since)
    ok(store.has('fact|F1'), '★#343 混合批次:成功的那条确实落盘了（不因整批失败而回滚）', JSON.stringify([...store.keys()]))
    failKeys = {}
    const r2 = await puller.pullOnce()
    ok(r2.ok === true && store.has('fact|F2'), '★#343 混合批次:故障解除后 F2 补存、F1 幂等重放不重复', JSON.stringify(r2) + ' size=' + store.size)
    ok(store.size === 2, '★#343 混合批次:最终 store 恰为 2 条（无重复写入）', 'size=' + store.size)
  }

  // ===================================================================
  // ④ ★门拒绝携带临时码（res.ok===false + code:'write-transaction-failed'）⇒ 也按临时失败处理
  // ===================================================================
  {
    const store = new Map()
    let transientMode = true
    const srv = batchServer([{ kind: 'fact', key: 'T1', payload: {} }], 400)
    const puller = createTeamPuller({
      engine: { config: { teamEnabled: true }, _teamEpoch: 0 },
      fetchJson: srv.fetchJson,
      appliers: {
        fact: (payload, ch) => {
          if (transientMode) return { ok: false, code: 'write-transaction-failed', reason: 'lock busy' }
          const dk = ch.kind + '|' + ch.key
          if (!store.has(dk)) store.set(dk, payload)
          return { ok: true, outcome: 'applied' }
        },
      },
    })
    const r = await puller.pullOnce()
    ok(r.ok === false && r.deferred === 1,
      '★#343 门返回 {ok:false, code:write-transaction-failed} ⇒ 判为临时失败(不推进游标)', JSON.stringify(r))
    ok(r.since === 0, '★#343 该类门失败同样不推进游标', 'since=' + r.since)
    transientMode = false
    const r2 = await puller.pullOnce()
    ok(r2.ok === true && store.has('fact|T1'), '★#343 这类失败恢复后同样能补存（无需 reset）', JSON.stringify(r2))
  }

  // ===================================================================
  // ⑤ ★负路径对照 C：门返回**业务码**（gate-rejected / conflict）⇒ 仍按业务拒绝前进游标
  // ===================================================================
  {
    const srv = batchServer([{ kind: 'fact', key: 'B1', payload: {} }], 500)
    const puller = createTeamPuller({
      engine: { config: { teamEnabled: true }, _teamEpoch: 0 },
      fetchJson: srv.fetchJson,
      appliers: { fact: () => ({ ok: false, code: 'gate-rejected' }) },
    })
    const r = await puller.pullOnce()
    ok(r.ok === true && r.rejected === 1 && r.deferred === 0,
      '★#343 负路径:门返回业务码 gate-rejected ⇒ 业务拒绝(不是临时失败)', JSON.stringify(r))
    ok(puller.status().since === 500, '★#343 负路径:业务拒绝照旧推进游标(500)', 'since=' + puller.status().since)
  }

  // ===================================================================
  // ⑤b ★未识别错误码 ⇒ **偏向临时**（宁可不前进游标去重放，也不静默丢数据）
  //     这条覆盖 classifyFailurePre 的兜底分支；缺它则「未知一律当业务」的变异不会被抓住。
  // ===================================================================
  {
    const store = new Map()
    let weirdMode = true
    const srv = batchServer([{ kind: 'fact', key: 'W1', payload: {} }], 600)
    const puller = createTeamPuller({
      engine: { config: { teamEnabled: true }, _teamEpoch: 0 },
      fetchJson: srv.fetchJson,
      appliers: {
        fact: (payload, ch) => {
          if (weirdMode) { const e = new Error('some unheard-of failure'); e.code = 'ENOTRECOGNIZED_XYZ'; throw e }
          const dk = ch.kind + '|' + ch.key
          if (!store.has(dk)) store.set(dk, payload)
          return { ok: true, outcome: 'applied' }
        },
      },
    })
    const r = await puller.pullOnce()
    ok(r.ok === false && r.deferred === 1,
      '★#343 **未识别错误码** ⇒ 偏向临时（不推进游标、不静默丢数据）', JSON.stringify(r))
    ok(r.since === 0, '★#343 未识别错误码同样不推进游标', 'since=' + r.since)
    ok(Array.isArray(r.deferredCodes) && r.deferredCodes.indexOf('ENOTRECOGNIZED_XYZ') >= 0,
      '★#343 未识别错误码原样带进 deferredCodes（诊断可见）', JSON.stringify(r.deferredCodes))
    weirdMode = false
    const r2 = await puller.pullOnce()
    ok(r2.ok === true && store.has('fact|W1'), '★#343 故障恢复后照常补存（证明前一次只是暂缓）', JSON.stringify(r2))
  }

  // ===================================================================
  // ⑥ ★对外的 applyOne 仍回 **boolean**（既有调用契约不许被结构性改坏）
  // ===================================================================
  {
    const store = new Map()
    const puller = createTeamPuller({
      engine: { config: { teamEnabled: true }, _teamEpoch: 0 },
      fetchJson: async () => ({ ok: true, data: { changes: [], cursor: 0 } }),
      appliers: { fact: realApplier(store) },
    })
    const okOne = puller.applyOne({ kind: 'fact', key: 'Z1', payload: {} })
    ok(okOne === true, '★#343 回归:applyOne 成功仍回 boolean true（旧契约）', typeof okOne + '=' + okOne)
    const badOne = puller.applyOne({ kind: 'nope', key: 'Z2', payload: {} })
    ok(badOne === false, '★#343 回归:applyOne 被拒仍回 boolean false（旧契约）', typeof badOne + '=' + badOne)
    const thrown = puller.applyOne({ kind: 'fact', key: 'Z3', payload: {} })
    ok(typeof thrown === 'boolean', '★#343 回归:applyOne 返回值恒为 boolean（不是对象）', typeof thrown)
  }

  // ===================================================================
  // ⑦ 回归:既有 status/describe/reset 形状未变（既有套件按它读）
  // ===================================================================
  {
    const puller = createTeamPuller({
      engine: { config: { teamEnabled: true } },
      fetchJson: async () => ({ ok: true, data: { changes: [], cursor: 0 } }),
      appliers: {},
    })
    const st = puller.status()
    ok(st && st.kind === 'team-pull' && typeof st.since === 'number' && typeof st.lastError === 'string',
      '★#343 回归:status() 既有字段形状未变（kind/since/lastError…）', JSON.stringify(st).slice(0, 160))
    ok(st.stats && typeof st.stats.rejected === 'number' && typeof st.stats.applied === 'number',
      '★#343 回归:stats 既有计数仍在（applied/rejected/unknown）', JSON.stringify(st.stats))
    ok(st.stats.deferred === 0, '★#343 新增 stats.deferred 归零初始化（可观测）', JSON.stringify(st.stats))
    ok(puller.reset().ok === true, '★#343 回归:reset() 仍可用（强制全量重拉）')
  }

  // ===================================================================
  // ★变异反向验证：把两处修复分别退回旧写法 ⇒ 子进程模式跑本套件必须**红**（断言红，非崩溃）
  // ===================================================================
  if (!CHILD) {
    const real = fs.readFileSync(REAL_SRC, 'utf8')
    // M1：游标语义退回「有临时失败也照旧前进」（旧写法：无条件 since = cursor）
    const M1_FROM = [
      "      if (deferred > 0) {",
      "        stats.deferred += deferred",
      "        stats.transientFailures += deferred",
    ].join('\n')
    const m1To = [
      "      if (false) {",
      "        stats.deferred += deferred",
      "        stats.transientFailures += deferred",
    ].join('\n')
    // M2：临时/业务分类恒判「业务」⇒ 临时失败被当业务拒绝，游标照旧前进（丢掉可重试性）
    const M2_FROM = "    return { transient: true, code: codes[0] || 'unclassified' }"
    const muts = [
      ['#343 游标回退(临时失败也前进)', M1_FROM, m1To],
      ['#343 分类回退(未知一律当业务)', M2_FROM, "    return { transient: false, code: codes[0] || 'unclassified' }"],
    ]
    for (const [label, from, to] of muts) {
      const hits = real.split(from).length - 1
      ok(hits === 1, '变异定位:' + label + ' 锚点恰命中 1 次', 'hits=' + hits)
      if (hits !== 1) continue
      const mp = path.join(os.tmpdir(), 'mut-343-' + label.replace(/[^a-z0-9]/gi, '') + '.mjs')
      fs.writeFileSync(mp, real.replace(from, to))
      const syn = spawnSync(process.execPath, ['--check', mp], { encoding: 'utf8' })
      ok(syn.status === 0, '变异文件语法可用(' + label + ')', String(syn.stderr || '').slice(0, 200))
      const r = spawnSync(process.execPath, [fileURLToPath(import.meta.url)], { env: { ...process.env, PULL_PATH: mp, I343_CHILD: '1' }, encoding: 'utf8', maxBuffer: 1 << 26 })
      const out = String(r.stdout || '') + String(r.stderr || '')
      const m = out.match(/pass=(\d+) fail=(\d+)/)
      ok(r.status !== 0, '★变异必红(' + label + '):子进程退出码非 0', 'status=' + r.status)
      ok(/FAIL - /.test(out), '★变异必红(' + label + '):是断言红不是崩溃', out.slice(-300))
      ok(!!m && Number(m[2]) > 0, '★变异必红(' + label + '):fail>0', m ? m[0] : '(未取到计数)')
      console.log('  [变异取证] ' + label + ' -> ' + (m ? m[0] : '?') + ' exit=' + r.status)
      try { fs.rmSync(mp, { force: true }) } catch (_) {}
    }
  }

  console.log('pass=' + pass + ' fail=' + fail)
  process.exit(fail ? 1 : 0)
}

main().catch((e) => {
  console.error('套件自身异常:', (e && e.stack) || e)
  process.exit(1)
})

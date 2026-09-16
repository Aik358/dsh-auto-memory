/**
 * P4 (2026-09-16) —— 精排多级档位 + 有界异步窗口验收套件。
 * 权威依据: MASTER-PLAN §Phase 4 (H2 按实测重写) + TODO-GRAPH V2-P4 卡 crit T5-3R/4R/5R/6R。
 * 实测数据源: artifacts/m7-rerank-pre/results.json (bge P95 37.4s, RSS 3.84GB)。
 * 模型调用经 rerankFn 注入, 全部用受控时钟 — 不发真实模型请求。
 */
import { strict as assert } from 'node:assert'
import {
  createRerankHostPre, resolveRerankTierPre, computeRerankInputKeyPre,
  RERANK_WINDOW_MS_PRE_V1, RERANK_KILL_GRACE_MS_PRE_V1, RERANK_HOST_VERSION,
} from '../../lib/rerank-host-pre.js'
import { readFile } from 'node:fs/promises'

let pass = 0, fail = 0
const t = (name, fn) => {
  Promise.resolve().then(fn).then(
    () => { pass++; console.log('  ok - ' + name); flush() },
    (e) => { fail++; console.log('  FAIL - ' + name + ': ' + (e && e.message || e)); flush() },
  )
}
let done = 0
const TOTAL = 10
function flush() { if (++done === TOTAL) { console.log('[p4-rerank-window] ' + pass + ' passed, ' + fail + ' failed'); if (fail) process.exit(1) } }

// ---------- 档位门(多级: 关/快档/发烧档) ----------
t('G1 档位解析: off/invalid → inactive fail-closed; fast/enthusiast 未就绪 → inactive+reason', () => {
  assert.deepEqual(resolveRerankTierPre('off'), { tier: 'off', active: false, reason: 'tier-off' })
  assert.deepEqual(resolveRerankTierPre('fast'), { tier: 'fast', active: false, reason: 'tier-not-provisioned' }, '快档 int8 产物未就绪')
  assert.deepEqual(resolveRerankTierPre('enthusiast'), { tier: 'enthusiast', active: false, reason: 'tier-not-provisioned' }, 'GPU torch 缺口未解决')
  assert.equal(resolveRerankTierPre('yolo').tier, 'off', '非法档位 fail closed → off')
})

// ---------- T5-3R: 前台先返回; 59 秒内完成且输入完全一致可复用 ----------
t('T5-3R 精排未完成时前台已返回(offer 即返, 模式 accepted)', async () => {
  let resolved = false
  const clock = { t: 0 }
  const host = createRerankHostPre({
    tier: 'enthusiast',
    now: () => clock.t,
    rerankFn: () => new Promise((r) => { setTimeout(() => { resolved = true; r([0.9, 0.1]) }, 5) }),
  })
  const r = host.offerRerankPre({ query: 'q', orderedIds: ['a', 'b'], memoryIndexVersion: 'idx_pre_0', requestKey: 'rk1' })
  assert.equal(r.mode, 'accepted', '本轮立即返回, 不等待精排')
  assert.equal(resolved, false, '模型仍在后台计算 — 前台先返回')
})

t('T5-3R 59 秒内完成 + inputKey 完全一致 ⇒ 下一请求复用; 到 60 秒不可复用', async () => {
  const clock = { t: 0 }
  let resolveFn = null
  const host = createRerankHostPre({
    tier: 'enthusiast', now: () => clock.t,
    rerankFn: () => new Promise((r) => { resolveFn = r }),
  })
  const ids = ['a', 'b']
  host.offerRerankPre({ query: 'q', orderedIds: ids, memoryIndexVersion: 'idx_pre_0', requestKey: 'rk1' })
  await new Promise((r) => setTimeout(r, 5)) // 等 worker promise 构造(resolveFn 已赋值)
  clock.t = 1000; assert.equal(typeof resolveFn, 'function', 'worker 已启动'); resolveFn([0.8, 0.2])
  await new Promise((r) => setTimeout(r, 5))
  clock.t = RERANK_WINDOW_MS_PRE_V1 - 1000 // 59 秒: 窗口内
  const r1 = host.offerRerankPre({ query: 'q', orderedIds: ids, memoryIndexVersion: 'idx_pre_0', requestKey: 'rk2' })
  assert.equal(r1.mode, 'reuse', '59 秒内复用(新 requestKey, inputKey 相同)')
  clock.t = RERANK_WINDOW_MS_PRE_V1 + 1 // 60 秒: 到期不续命
  const r2 = host.offerRerankPre({ query: 'q', orderedIds: ids, memoryIndexVersion: 'idx_pre_0', requestKey: 'rk3' })
  assert.notEqual(r2.mode, 'reuse', '60 秒后缓存过期, 不可复用(T5-3R 口径: 不可复用, 新窗口重新入队不算复用)')
  assert.ok(r2.mode === 'accepted' || r2.mode === 'skip', '过期后重新入队(下一请求真实到来)或跳过, 但绝无 reuse')
})

t('T5-3R 改变任一身份字段(query/ordered/miv) ⇒ inputKey 不同 ⇒ 不复用', async () => {
  const k1 = computeRerankInputKeyPre({ query: 'q', orderedIds: ['a', 'b'], memoryIndexVersion: 'idx_pre_0' })
  assert.notEqual(k1, computeRerankInputKeyPre({ query: 'q2', orderedIds: ['a', 'b'], memoryIndexVersion: 'idx_pre_0' }), '查询变 → 不复用')
  assert.notEqual(k1, computeRerankInputKeyPre({ query: 'q', orderedIds: ['b', 'a'], memoryIndexVersion: 'idx_pre_0' }), '顺序变 → 不复用')
  assert.notEqual(k1, computeRerankInputKeyPre({ query: 'q', orderedIds: ['a', 'b'], memoryIndexVersion: 'idx_pre_1' }), 'miv 变 → 不复用')
})

// ---------- T5-4R: 撤回候选后下一轮不得输出; 不能复用旧 fv2 放行结论 ----------
t('T5-4R 缓存只存 scores 不推送 — 主机无 envelope/emit 面(结构性守卫)', async () => {
  const src = await readFile('lib/rerank-host-pre.js', 'utf8')
  assert.ok(!/emit|envelope|inject/.test(src.replace(/\/\/.*|\/\*[\s\S]*?\*\//g, '')), '主机代码无 emit/envelope/inject — 后台完成只进缓存, 不改本轮注入')
})

// ---------- T5-5R: 忽略取消 → 宽限内终止进程并释放; 稠密查询仍可工作 ----------
t('T5-5R 超窗任务在宽限内可 kill(killFn 调用+占用释放); busy 门不阻塞稠密路径', async () => {
  const clock = { t: 0 }
  let killed = 0
  const host = createRerankHostPre({
    tier: 'enthusiast', now: () => clock.t,
    rerankFn: () => new Promise(() => {}), // 永不完成(模拟忽略取消)
    killFn: () => { killed++ },
  })
  host.offerRerankPre({ query: 'q', orderedIds: ['a'], memoryIndexVersion: 'idx_pre_0', requestKey: 'rk' })
  clock.t = RERANK_WINDOW_MS_PRE_V1 + RERANK_KILL_GRACE_MS_PRE_V1 + 1
  assert.equal(host.isRunningBeyondWindowPre(), true, '超窗+超宽限被登记')
  const r = host.killRunningRerankPre()
  assert.equal(r.killed, true, 'kill 生效')
  assert.equal(killed, 1, 'killFn 恰被调用一次(终止进程并释放)')
  assert.equal(host.debugView().running, null, '占用已释放')
  // 稠密查询仍可工作: kill 后新 offer 不再 busy
  const r2 = host.offerRerankPre({ query: 'q2', orderedIds: ['b'], memoryIndexVersion: 'idx_pre_0', requestKey: 'rk2' })
  assert.equal(r2.mode, 'accepted', 'kill 后新任务可入队 — 稠密/粗排路径不受影响')
})

// ---------- T5-6R: 零复用不得写成异步注入收益 ----------
t('T5-6R debugView.stats.reused 如实为 0 — 零复用就是零复用(审计面)', async () => {
  const clock = { t: 0 }
  const host = createRerankHostPre({ tier: 'off', now: () => clock.t })
  host.offerRerankPre({ query: 'q', orderedIds: ['a'], memoryIndexVersion: 'idx_pre_0', requestKey: 'rk' })
  const dv = host.debugView()
  assert.equal(dv.stats.reused, 0, 'off 档零复用, stats 如实记录')
  assert.equal(dv.stats.tierRejects, 1, '拒绝原因可审计(tier-off)')
})

// ---------- 忙时继续粗排 + LRU 有界缓存 ----------
t('G2 全机最多一个精排任务: 忙时新请求 skip(busy) 继续粗排', () => {
  const clock = { t: 0 }
  const host = createRerankHostPre({ tier: 'enthusiast', now: () => clock.t, rerankFn: () => new Promise(() => {}) })
  assert.equal(host.offerRerankPre({ query: 'q1', orderedIds: ['a'], memoryIndexVersion: 'm' }).mode, 'accepted')
  const r = host.offerRerankPre({ query: 'q2', orderedIds: ['b'], memoryIndexVersion: 'm' })
  assert.equal(r.mode, 'skip'); assert.equal(r.reason, 'busy')
})

t('G3 结果缓存有界(LRU 逐出 ≤16 条)', async () => {
  const clock = { t: 0 }
  let n = 0
  const host = createRerankHostPre({
    tier: 'enthusiast', now: () => clock.t,
    rerankFn: () => Promise.resolve([n++]),
  })
  for (let i = 0; i < 20; i++) {
    host.offerRerankPre({ query: 'q' + i, orderedIds: ['x'], memoryIndexVersion: 'm', requestKey: 'rk' + i })
    clock.t += 100
    await new Promise((r) => setTimeout(r, 1))
    clock.t += 100
  }
  assert.equal(host.debugView().cacheSize, 16, '缓存上限 16(LRU 逐出)')
})

// ---------- 版本守卫 ----------
t('V1 版本常量 = rerank_host_pre_v1; 窗口 60s; 宽限 5s(与卡内口径一致)', () => {
  assert.equal(RERANK_HOST_VERSION, 'rerank_host_pre_v1')
  assert.equal(RERANK_WINDOW_MS_PRE_V1, 60000)
  assert.equal(RERANK_KILL_GRACE_MS_PRE_V1, 5000)
})

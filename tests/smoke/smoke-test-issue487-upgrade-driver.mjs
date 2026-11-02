#!/usr/bin/env node
/**
 * smoke-test-issue487-upgrade-driver.mjs —— #487 团队升级驱动器的两层缺陷。
 *
 * ## 缺陷（改前实测，纯模块层可复现）
 *  第一层【产线前置阻断】：run() ① 一定先 pauseSync 把 _teamPaused 置真（升级的前置条件），
 *    ② 再走 pullAll → 团队下行 pullOnce 的第一道闸门就是 `_teamPaused === true ⇒ team-paused`
 *    ⇒ 「先暂停、再拉取」互斥，驱动器**一次都走不过 pulling**。
 *  第二层【fail-open】：`upgradeLocal` / `verify` 缺失时用 `if (typeof o.x === 'function')`
 *    静默跳过，最后照样 setPhase('done')；且 verify 返回 `{ok:true, remaining:5}` 也被当成通过
 *    ⇒ 与文件头声称的 fail-closed 相反：什么都没升级却回报成功，恢复闸门随即放行。
 *
 * ## 修法（lib/team-upgrade-driver.js）
 *   · 新增 `inspectUpgradeCapsPre(o)` 与 `TE_UPGRADE_REQUIRED_CAPS_PRE`：run() ⓪ 在**任何副作用之前**
 *     预检能力，缺失即返回 `{ok:false, phase:'unavailable', persistPhase, error:'missing-X', missing}`；
 *   · verify 返回 remaining>0 ⇒ 停在 verifying，不再 done；
 *   · pulling 改走**注入的** `pullDiscovery`（受控只读通道，优先于 pullAll）——
 *     不解除用户的暂停，只是给「升级过程中的这一次只读」一条单独注入的路径。
 *
 * ## 验收方式（CR-10：真 import → 真构造 → 真 await 调用 → 断言返回值）
 *   注入桩回调构造**真驱动器**，逐场景断言 phase / ok / error / remaining / 副作用计数。
 *
 * ## 判据
 *   D-1 缺 upgradeLocal ⇒ phase='unavailable'，且 **零副作用**（pauseSync 0 次、onPhase 空）
 *   D-2 缺 verify       ⇒ phase='unavailable'（error=missing-verify）
 *   D-3 remaining=5     ⇒ ok=false、phase 停在 verifying、remaining=5、onPhase 序列里没有 'done'
 *   D-4 全部正常        ⇒ ok=true、phase='done'、remaining=0、upgraded=2、阶段序列完整
 *   D-5 pendingItems 非数组 ⇒ phase='unavailable'（旧写法把「没给清单」吞成「清单是空的」）
 *   D-6 pullDiscovery 优先于 pullAll（第一层：受控只读通道真的接管了 pulling）
 *   D-7 只给 pullDiscovery、不给 pullAll ⇒ 能力仍算齐备
 *   D-8 两个拉取通道都没有 ⇒ unavailable/missing-pullAll
 *   D-9 拉取失败 ⇒ 停在 pulling，绝不 done
 *   D-10 逐条升级失败 ⇒ 停在 upgrading，绝不 done（失败不 resume）
 *   守卫 'unavailable' **不在**线性链上（phaseReachedPre 恒 false）——这正是必须回传 persistPhase 的原因
 *
 * ## 变异负路径（自带，MUT-487，三处锚点各自先断言恰好命中 1 次）
 *   忠实回退到修复前语义：①能力预检恒返回空 ⇒ 预检失效；②③③④ 两步重新套上 typeof 护栏
 *   ⇒ 缺 upgradeLocal 时**一路静默跳到 done**（D-1 变红）、remaining=5 时也 done（D-3 变红）。
 */
import assert from 'node:assert'
import { readFileSync, writeFileSync, mkdirSync, unlinkSync } from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const HERE = path.dirname(new URL(import.meta.url).pathname).replace(/^\/([A-Za-z]:)/, '$1')
const ROOT = path.resolve(HERE, '..', '..')
const MOD_PATH = path.join(ROOT, 'lib', 'team-upgrade-driver.js')
const M = await import(pathToFileURL(MOD_PATH).href)

const {
  createTeamUpgradeDriver,
  phaseReachedPre,
  inspectUpgradeCapsPre,
  TEAM_UPGRADE_PHASES_PRE,
  TEAM_UPGRADE_REQUIRED_CAPS_PRE,
} = M

let pass = 0
let fail = 0
function ok(name, fn) {
  try { fn(); pass++; console.log('  ok - ' + name) } catch (e) { fail++; console.error('  FAIL - ' + name + ' :: ' + String((e && e.message) || e).slice(0, 300)) }
}

/** 用桩回调构造**真驱动器**；over 里给 undefined 的键会被真的删掉（模拟「没有这个能力」）。 */
function build(mod, over) {
  const calls = { pauseSync: 0, pullAll: 0, pullDiscovery: 0, upgradeLocal: 0, verify: 0 }
  const phases = []
  const opts = {
    pauseSync: async () => { calls.pauseSync += 1; return { ok: true } },
    pullAll: async () => { calls.pullAll += 1; return { ok: true, total: 2 } },
    pendingItems: [{ id: 'a' }, { id: 'b' }],
    upgradeLocal: async () => { calls.upgradeLocal += 1; return { ok: true } },
    verify: async () => { calls.verify += 1; return { ok: true, remaining: 0 } },
    onPhase: (p) => phases.push(p),
  }
  for (const k of Object.keys(over || {})) {
    if (over[k] === undefined) delete opts[k]
    else opts[k] = over[k]
  }
  const driver = mod.createTeamUpgradeDriver(opts)
  return { driver, calls, phases }
}

// ─────────────────────────────────────────────────────────────
console.log('[D-0] 真 import 的模块契约')
ok('D-0a 导出的是工厂函数与判据函数', () => {
  for (const f of ['createTeamUpgradeDriver', 'phaseReachedPre', 'inspectUpgradeCapsPre']) {
    assert.equal(typeof M[f], 'function', f + ' 必须是函数')
  }
})
ok('D-0b 线性链仍是 6 个阶段，且 unavailable 不在链上', () => {
  assert.deepEqual(Array.from(TEAM_UPGRADE_PHASES_PRE), ['idle', 'pausing', 'pulling', 'upgrading', 'verifying', 'done'])
  assert.equal(TEAM_UPGRADE_PHASES_PRE.indexOf('unavailable'), -1, 'unavailable 不得混进线性链')
})
ok('D-0c unavailable 不在链上 ⇒ 任何 phaseReachedPre 恒 false（故必须回传 persistPhase）', () => {
  assert.equal(phaseReachedPre('unavailable', 'idle'), false)
  assert.equal(phaseReachedPre('unavailable', 'pulling'), false)
})
ok('D-0d 必需能力清单 = pauseSync/pullAll/upgradeLocal/verify/pendingItems', () => {
  assert.deepEqual(Array.from(TEAM_UPGRADE_REQUIRED_CAPS_PRE), ['pauseSync', 'pullAll', 'upgradeLocal', 'verify', 'pendingItems'])
})
ok('D-0e inspectUpgradeCapsPre 对完整配置返回空缺失表', () => {
  const full = { pauseSync: async () => {}, pullAll: async () => {}, upgradeLocal: async () => {}, verify: async () => {}, pendingItems: [] }
  assert.deepEqual(inspectUpgradeCapsPre(full), [])
})

// ─────────────────────────────────────────────────────────────
console.log('[D-1] 缺 upgradeLocal ⇒ 显式 unavailable，不再静默 done（且零副作用）')
let d1 = null
await (async () => {
  d1 = build(M, { upgradeLocal: undefined })
  const r = await d1.driver.run()
  console.log('  · 实测：' + JSON.stringify({ ok: r.ok, phase: r.phase, error: r.error, persistPhase: r.persistPhase, missing: r.missing }))
  ok('D-1a ok === false 且 phase === unavailable', () => {
    assert.equal(r.ok, false)
    assert.equal(r.phase, 'unavailable', '实际 phase=' + r.phase)
  })
  ok('D-1b error 点名缺失能力（missing-upgradeLocal）', () => assert.equal(r.error, 'missing-upgradeLocal', 'error=' + r.error))
  ok('D-1c missing 里带 upgradeLocal', () => assert(Array.isArray(r.missing) && r.missing.includes('upgradeLocal'), JSON.stringify(r.missing)))
  ok('D-1d 回传 persistPhase=idle（机器真实所在阶段，可安全落盘）', () => assert.equal(r.persistPhase, 'idle', 'persistPhase=' + r.persistPhase))
  ok('D-1e ★零副作用：pauseSync 0 次（不得把用户同步暂停掉）', () => assert.equal(d1.calls.pauseSync, 0, 'pauseSync=' + d1.calls.pauseSync))
  ok('D-1f ★零副作用：onPhase 一次都没被调用（阶段未动）', () => assert.deepEqual(d1.phases, [], JSON.stringify(d1.phases)))
  ok('D-1g driver.status().phase 仍是 idle（机器没被拖进 unavailable）', () => assert.equal(d1.driver.status().phase, 'idle'))
})()

// ─────────────────────────────────────────────────────────────
console.log('[D-2] 缺 verify ⇒ unavailable')
await (async () => {
  const d2 = build(M, { verify: undefined })
  const r = await d2.driver.run()
  console.log('  · 实测：' + JSON.stringify({ ok: r.ok, phase: r.phase, error: r.error, pauseSync: d2.calls.pauseSync }))
  ok('D-2a phase === unavailable', () => assert.equal(r.phase, 'unavailable', '实际 phase=' + r.phase))
  ok('D-2b error === missing-verify', () => assert.equal(r.error, 'missing-verify', 'error=' + r.error))
  ok('D-2c 零副作用（pauseSync 0 次）', () => assert.equal(d2.calls.pauseSync, 0))
})()

// ─────────────────────────────────────────────────────────────
console.log('[D-3] verify 返回 remaining=5 ⇒ 不得置 done（旧行为把它当通过）')
await (async () => {
  const d3 = build(M, { verify: async () => { d3.calls.verify += 1; return { ok: true, remaining: 5 } } })
  const r = await d3.driver.run()
  console.log('  · 实测：' + JSON.stringify({ ok: r.ok, phase: r.phase, remaining: r.remaining, error: r.error, phases: d3.phases }))
  ok('D-3a ok === false', () => assert.equal(r.ok, false))
  ok('D-3b phase 停在 verifying（不是 done）', () => assert.equal(r.phase, 'verifying', '实际 phase=' + r.phase))
  ok('D-3c remaining 如实回传 5', () => assert.equal(r.remaining, 5, 'remaining=' + r.remaining))
  ok('D-3d error 形如 verify-incomplete: remaining=5', () => assert(/^verify-incomplete: remaining=5$/.test(String(r.error)), 'error=' + r.error))
  ok('D-3e onPhase 序列里没有 done（恢复闸门无从而放行）', () => assert.equal(d3.phases.indexOf('done'), -1, JSON.stringify(d3.phases)))
})()

// ─────────────────────────────────────────────────────────────
console.log('[D-4] 全部正常 ⇒ 走完 done，且阶段顺序完整')
await (async () => {
  const d4 = build(M, {})
  const r = await d4.driver.run()
  console.log('  · 实测：' + JSON.stringify({ ok: r.ok, phase: r.phase, upgraded: r.upgraded, remaining: r.remaining, phases: d4.phases, calls: d4.calls }))
  ok('D-4a ok === true / phase === done', () => {
    assert.equal(r.ok, true, 'error=' + r.error)
    assert.equal(r.phase, 'done')
  })
  ok('D-4b upgraded=2（pendingItems 两条都被升级）、remaining=0', () => {
    assert.equal(r.upgraded, 2)
    assert.equal(r.remaining, 0)
  })
  ok('D-4c 阶段序列 = pausing,pulling,upgrading,verifying,done', () => {
    assert.deepEqual(d4.phases, ['pausing', 'pulling', 'upgrading', 'verifying', 'done'])
  })
  ok('D-4d 四个回调各被调用 1 次（pauseSync/pullAll/verify）与 2 次（upgradeLocal）', () => {
    assert.equal(d4.calls.pauseSync, 1)
    assert.equal(d4.calls.pullAll, 1)
    assert.equal(d4.calls.verify, 1)
    assert.equal(d4.calls.upgradeLocal, 2)
  })
})()

// ─────────────────────────────────────────────────────────────
console.log('[D-5] pendingItems 不是数组 ⇒ unavailable（不再吞成「空清单」）')
await (async () => {
  const d5 = build(M, { pendingItems: undefined })
  const r = await d5.driver.run()
  console.log('  · 实测：' + JSON.stringify({ ok: r.ok, phase: r.phase, error: r.error, missing: r.missing }))
  ok('D-5a phase === unavailable', () => assert.equal(r.phase, 'unavailable', '实际 phase=' + r.phase))
  ok('D-5b error === missing-pendingItems', () => assert.equal(r.error, 'missing-pendingItems', 'error=' + r.error))
  ok('D-5c 没跑到升级步骤（upgradeLocal 0 次）', () => assert.equal(d5.calls.upgradeLocal, 0))
})()

// ─────────────────────────────────────────────────────────────
console.log('[D-6] 第一层：#487 的受控只读通道 pullDiscovery 优先于 pullAll')
await (async () => {
  const d6 = build(M, {
    pullAll: async () => { d6.calls.pullAll += 1; return { ok: false, error: 'team-paused' } },
    pullDiscovery: async () => { d6.calls.pullDiscovery += 1; return { ok: true, total: 2 } },
  })
  const r = await d6.driver.run()
  console.log('  · 实测：' + JSON.stringify({ ok: r.ok, phase: r.phase, calls: d6.calls }))
  ok('D-6a 驱动器真的跑完了（不再停在 pulling/team-paused）', () => {
    assert.equal(r.ok, true, 'phase=' + r.phase + ' error=' + r.error)
    assert.equal(r.phase, 'done')
  })
  ok('D-6b pullDiscovery 被调用 1 次、pullAll 被调用 0 次（受控只读接管了 pulling）', () => {
    assert.equal(d6.calls.pullDiscovery, 1, 'pullDiscovery=' + d6.calls.pullDiscovery)
    assert.equal(d6.calls.pullAll, 0, 'pullAll=' + d6.calls.pullAll)
  })
})()

// ─────────────────────────────────────────────────────────────
console.log('[D-7] 只给 pullDiscovery、不给 pullAll ⇒ 能力仍算齐备')
await (async () => {
  const d7 = build(M, { pullAll: undefined, pullDiscovery: async () => { d7.calls.pullDiscovery += 1; return { ok: true, total: 2 } } })
  const r = await d7.driver.run()
  console.log('  · 实测：' + JSON.stringify({ ok: r.ok, phase: r.phase, pullDiscovery: d7.calls.pullDiscovery }))
  ok('D-7a 不判 unavailable，正常跑完', () => {
    assert.equal(r.ok, true, 'phase=' + r.phase + ' error=' + r.error)
    assert.equal(r.phase, 'done')
  })
  ok('D-7b pullDiscovery 被调用 1 次', () => assert.equal(d7.calls.pullDiscovery, 1))
})()

// ─────────────────────────────────────────────────────────────
console.log('[D-8] 两个拉取通道都没有 ⇒ unavailable/missing-pullAll')
await (async () => {
  const d8 = build(M, { pullAll: undefined })
  const r = await d8.driver.run()
  console.log('  · 实测：' + JSON.stringify({ ok: r.ok, phase: r.phase, error: r.error }))
  ok('D-8a phase === unavailable 且 error === missing-pullAll', () => {
    assert.equal(r.phase, 'unavailable', '实际 phase=' + r.phase)
    assert.equal(r.error, 'missing-pullAll', 'error=' + r.error)
  })
})()

// ─────────────────────────────────────────────────────────────
console.log('[D-9] 拉取失败 ⇒ 停在 pulling，绝不 done')
await (async () => {
  const d9 = build(M, { pullDiscovery: async () => ({ ok: false, error: 'network-down' }) })
  const r = await d9.driver.run()
  console.log('  · 实测：' + JSON.stringify({ ok: r.ok, phase: r.phase, error: r.error, phases: d9.phases }))
  ok('D-9a phase === pulling / ok === false', () => {
    assert.equal(r.ok, false)
    assert.equal(r.phase, 'pulling', '实际 phase=' + r.phase)
  })
  ok('D-9b 不进入 upgrading，也没 done', () => {
    assert.equal(d9.phases.indexOf('upgrading'), -1, JSON.stringify(d9.phases))
    assert.equal(d9.phases.indexOf('done'), -1, JSON.stringify(d9.phases))
  })
})()

// ─────────────────────────────────────────────────────────────
console.log('[D-10] 逐条升级失败 ⇒ 停在 upgrading，绝不 resume')
await (async () => {
  let n = 0
  const d10 = build(M, { upgradeLocal: async () => { n += 1; return n === 1 ? { ok: true } : { ok: false, error: 'boom' } } })
  const r = await d10.driver.run()
  console.log('  · 实测：' + JSON.stringify({ ok: r.ok, phase: r.phase, error: r.error, upgraded: r.upgraded, phases: d10.phases }))
  ok('D-10a phase === upgrading / upgraded=1', () => {
    assert.equal(r.phase, 'upgrading', '实际 phase=' + r.phase)
    assert.equal(r.upgraded, 1)
  })
  ok('D-10b error 点名失败位置', () => assert(/^upgrade-failed@1: boom$/.test(String(r.error)), 'error=' + r.error))
  ok('D-10c 没有 verify 阶段、没有 done（失败即停）', () => {
    assert.equal(d10.phases.indexOf('verifying'), -1, JSON.stringify(d10.phases))
    assert.equal(d10.phases.indexOf('done'), -1, JSON.stringify(d10.phases))
  })
})()

// ─────────────────────────────────────────────────────────────
console.log('[MUT-487] 变异负路径：忠实回退到修复前语义 ⇒ D-1 / D-3 必红')
{
  const src = readFileSync(MOD_PATH, 'utf8')
  const D3_FROM = [
    '        const left = Number(vr.remaining) || 0',
    '        remaining = left',
    '        if (left > 0) {',
    "          lastError = 'verify-incomplete: remaining=' + left",
    '          return { ok: false, phase: phase, upgraded: upgraded, remaining: remaining, error: lastError }',
    '        }',
  ].join('\n')
  const patches = [
    // ① 能力预检整体失效（永不报缺）
    ['  const missing = []',
      '  return []\n  const missing = []'],
    // ② 逐条升级重新套上 typeof 护栏（缺失即跳过）
    ["      if (!phaseReachedPre(phase, 'verifying')) {",
      "      if (!phaseReachedPre(phase, 'verifying') && typeof o.upgradeLocal === 'function') {"],
    // ③ verify 重新套上 typeof 护栏（缺失即跳过）
    ["      if (!phaseReachedPre(phase, 'done')) {",
      "      if (!phaseReachedPre(phase, 'done') && typeof o.verify === 'function') {"],
    // ④ remaining>0 的拦截被删掉（回到「remaining 只记账、不拦」）
    [D3_FROM, '        remaining = Number(vr.remaining) || 0'],
  ]
  let mutated = src
  let anchorsOk = 0
  const anchorReport = []
  for (const [from, to] of patches) {
    const hits = mutated.split(from).length - 1
    anchorReport.push(hits)
    if (hits === 1) anchorsOk += 1
    mutated = mutated.replace(from, to)
  }
  console.log('  · 三处锚点命中数：' + JSON.stringify(anchorReport))
  ok('MUT-487a 四处锚点各自恰好命中 1 次（否则变异无鉴别力）', () => assert.deepEqual(anchorReport, [1, 1, 1, 1], JSON.stringify(anchorReport)))
  ok('MUT-487b 四处均已替换', () => assert.equal(anchorsOk, 4))

  const tmpDir = path.join(ROOT, '.tmp-smoke-run')
  try { mkdirSync(tmpDir, { recursive: true }) } catch (_) {}
  const tmpFile = path.join(tmpDir, '_mut-issue487-' + process.pid + '.mjs')
  writeFileSync(tmpFile, mutated, 'utf8')
  try {
    const MM = await import(pathToFileURL(tmpFile).href + '?t=' + Date.now())
    // 变异体工厂必须真的把 unavailable 判没（否则判据没测到东西）
    // 场景 1：缺 upgradeLocal
    const m1 = build(MM, { upgradeLocal: undefined })
    const rm1 = await m1.driver.run()
    console.log('  · 变异体[缺 upgradeLocal]：' + JSON.stringify({ ok: rm1.ok, phase: rm1.phase, upgraded: rm1.upgraded, phases: m1.phases }))
    ok('MUT-487c 变异体在缺 upgradeLocal 时**一路静默跳到 done**（缺陷复现，证明 D-1 有鉴别力）', () => {
      assert.equal(rm1.phase, 'done', '变异体 phase=' + rm1.phase)
      assert.equal(rm1.ok, true, '变异体 ok=' + rm1.ok)
    })
    // 场景 2：remaining=5
    const m3 = build(MM, { verify: async () => ({ ok: true, remaining: 5 }) })
    const rm3 = await m3.driver.run()
    console.log('  · 变异体[remaining=5]：' + JSON.stringify({ ok: rm3.ok, phase: rm3.phase, remaining: rm3.remaining, phases: m3.phases }))
    ok('MUT-487d 变异体在 remaining=5 时也置 done（证明 D-3 有鉴别力）', () => {
      assert.equal(rm3.phase, 'done', '变异体 phase=' + rm3.phase)
      assert.equal(rm3.ok, true, '变异体 ok=' + rm3.ok)
    })
    // 场景 3：能力齐备时变异体仍应成功（证明其余断言不是被变异整体打红）
    const m4 = build(MM, {})
    const rm4 = await m4.driver.run()
    ok('MUT-487e 变异体在正常路径上仍成功（红只出现在被修的两条路径上）', () => {
      assert.equal(rm4.ok, true, 'error=' + rm4.error)
      assert.equal(rm4.phase, 'done')
    })
  } finally {
    try { unlinkSync(tmpFile) } catch (_) {}
  }
}

console.log('\nPASS ' + pass + ' / FAIL ' + fail)
process.exit(fail === 0 ? 0 : 1)

#!/usr/bin/env node
/** smoke-test-memory-importance-pre —— M8-2 evidence→importance 纯函数回归锁定(2026-09-09)。
 * 覆盖:中性缺省(验收 3)/ correction 负向(验收 2,口径逐字复用 promote)/
 * success·reuse·distinctSessions 正向 / 值域 [0,1] / 确定性 / 纯函数零 IO /
 * 不接线守卫(本段只交付纯函数,接线待 P3 RRF 落点)。
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { computeImportancePre, IMPORTANCE_NEUTRAL_PRE_V1, MEMORY_IMPORTANCE_VERSION, IMPORTANCE_WEIGHTS_PRE_V1 } from '../../lib/memory-importance-pre.js'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const SRC = readFileSync(path.resolve(HERE, '..', '..', 'lib', 'index.js'), 'utf8')
const MOD = readFileSync(path.resolve(HERE, '..', '..', 'lib', 'memory-importance-pre.js'), 'utf8')
const PSRC = readFileSync(path.resolve(HERE, '..', '..', 'lib', 'procedure-store-pre.js'), 'utf8')
let pass = 0, fail = 0
const ok = (c, n) => { if (c) { pass++; console.log('  ok -', n) } else { fail++; console.error('FAIL', n) } }
const close = (a, b) => Math.abs(a - b) < 1e-9

console.log('[memory-importance] G1 版本与中性缺省(验收 3)')
ok(MEMORY_IMPORTANCE_VERSION === 'memory_importance_pre_v1', '版本标识 memory_importance_pre_v1')
for (const agg of [undefined, null, {}, { seen: 0, read: 0, cite: 0, reuse: 0, success: 0, correction: 0, distinctSessions: 0 }]) {
  const r = computeImportancePre(agg)
  assert.equal(r.importance, IMPORTANCE_NEUTRAL_PRE_V1)
  assert.equal(r.neutral, true)
  assert.equal(r.total, 0)
}
ok(true, '无 evidence/全零/非法输入 → 中性 0.5(neutral:true)')
{
  const r = computeImportancePre({ seen: 5, read: 2, cite: 3 })
  assert.equal(r.neutral, false)
  assert.ok(close(r.importance, 0.5))
  assert.ok(close(r.correctionRate, 0))
}
ok(true, '仅 seen/read/cite(无正负信号)→ 保持中性 0.5(不置顶不垫底)')

console.log('[memory-importance] G2 correction 负向 + 口径复用(验收 2)')
{
  const r = computeImportancePre({ correction: 3 })
  assert.ok(close(r.correctionRate, 1))
  assert.equal(r.importance, 0)
}
ok(true, '纯 correction(total=3)→ correctionRate=1 → importance=0(垫底)')
{
  const r = computeImportancePre({ seen: 7, correction: 3 })
  assert.ok(close(r.correctionRate, 0.3))
  assert.ok(close(r.importance, 0.35))
}
ok(true, 'seen=7/correction=3 → 口径复用 corrRate=0.3 → importance=0.35(<0.5,被纠正即下降)')
{
  // 口径守卫:correctionRate 必须与 promote 同式(同一分母六类合计)
  const m = PSRC.match(/const corrRate = total > 0 \? ev\.correction \/ total : 0/)
  ok(!!m, 'procedure-store promote 口径原样在位(未被本段改动)')
  const line = MOD.match(/const correctionRate = total > 0 \? correction \/ total : 0/)
  ok(!!line, '本模块 correctionRate 与 promote 同式(六类合计为分母)')
}
{
  // cite 稀释 correctionRate(与 promote 同效应):correction 恒 3,cite 越多 corrRate 越低
  const r1 = computeImportancePre({ correction: 3 })
  const r2 = computeImportancePre({ correction: 3, cite: 9 })
  assert.ok(r2.correctionRate < r1.correctionRate)
  assert.ok(r2.importance > r1.importance)
}
ok(true, 'cite/seen/read 经分母稀释 correctionRate(与 promote 同效应)')

console.log('[memory-importance] G3 正向信号(验收 2)')
{
  const r = computeImportancePre({ distinctSessions: 3 })
  assert.ok(close(r.importance, 0.65))
}
ok(true, 'distinctSessions=3(饱和)→ importance=0.65(>0.5)')
{
  const r = computeImportancePre({ success: 2, reuse: 2 })
  assert.ok(close(r.importance, 0.65))
}
ok(true, 'success+reuse=4(饱和)→ importance=0.65(>0.5)')
{
  const r = computeImportancePre({ distinctSessions: 3, success: 4, reuse: 4 })
  assert.ok(close(r.importance, 0.8))
}
ok(true, '双正向满格 → importance=0.8(上限 0.5+0.3)')
{
  const lo = computeImportancePre({ reuse: 1 }).importance
  const hi = computeImportancePre({ reuse: 4 }).importance
  assert.ok(hi > lo)
  const c1 = computeImportancePre({ seen: 10, correction: 1 }).importance
  const c2 = computeImportancePre({ seen: 10, correction: 4 }).importance
  assert.ok(c2 < c1)
}
ok(true, '单调性:reuse↑ 则升,correction↑ 则降')

console.log('[memory-importance] G4 值域/确定性/纯函数(验收 1/4)')
{
  const cases = []
  for (let s = 0; s <= 5; s++) for (let c = 0; c <= 5; c++) for (let d = 0; d <= 4; d++) for (let u = 0; u <= 5; u++) {
    cases.push({ seen: s, read: s, cite: c, reuse: u, success: c, correction: d, distinctSessions: d })
  }
  let inRange = true
  for (const agg of cases) {
    const r = computeImportancePre(agg)
    if (!(r.importance >= 0 && r.importance <= 1)) { inRange = false; break }
  }
  ok(inRange, cases.length + ' 组输入扫描全部 importance ∈ [0,1]')
  const a = computeImportancePre({ seen: 3, correction: 1, reuse: 2, distinctSessions: 2 })
  const b = computeImportancePre({ seen: 3, correction: 1, reuse: 2, distinctSessions: 2 })
  assert.deepEqual(a, b)
  ok(true, '确定性:同输入两次 deepEqual')
}
ok(!/import\s|require\(|readFile|writeFile|Date\.now|Math\.random/.test(MOD), '纯函数零 IO/无时钟无随机(确定性前提)')
ok(Array.isArray(Object.freeze(IMPORTANCE_WEIGHTS_PRE_V1) && Object.keys(IMPORTANCE_WEIGHTS_PRE_V1)) && Object.isFrozen(IMPORTANCE_WEIGHTS_PRE_V1), '权重常数冻结')

console.log('[memory-importance] G5 不接线守卫(本段只交付纯函数)')
ok(!SRC.includes('memory-importance-pre'), 'index.js 未接线(检索结论:fuseD6Pre 现役点=fv2 决策 margin、P3 RRF 未接线、shadow 管线 evidence 不可达——接线待 P3 RRF 落点,importance 仅作加权因子之一)')

console.log(`\n[memory-importance] ${pass}/${pass + fail} assertions passed`)
if (fail) process.exit(1)

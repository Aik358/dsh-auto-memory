#!/usr/bin/env node
/**
 * _inflight-race-probe.mjs —— 行为级守卫：并发闸门**原子性**（2026-09-26 事故回归）
 *
 * ## 为什么必须是行为级
 * 事故（一次爆发 41 个并发子代理）是**时序缺陷**：
 *   `if (inflight >= 3) return` ——(E2 归属门的 `await this._readWorkbench()`)——`inflight++`
 * 静态文本守卫全部查不出来 —— 源码里每条语句都对，只有「await 让出控制权」这件事是错的。
 * ⇒ 判据必须是**真跑**：模拟 N 个调用方在同一 tick 内并发进入，断言最终 inflight 不超上限。
 *
 * ## 抽真源码真跑
 * 从 `lib/index.js` 抽出 `runSubagent` 的**闸门段 + 占位自增段**（花括号配平扫描），
 * 装配成一个最小 harness（不依赖宿主 ctx），并发调用 N 次，观察峰值 inflight。
 *
 * 用法：node artifacts/_inflight-race-probe.mjs
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const SRC = path.join(ROOT, 'lib', 'index.js')
const src = fs.readFileSync(SRC, 'utf8')

let P = 0, F = 0
const ck = (ok, m) => { ok ? P++ : F++; console.log((ok ? '  PASS  ' : '  FAIL  ') + m) }

console.log('═══ 闸门原子性行为探针（并发竞态回归）═══')
console.log('  源: lib/index.js  ' + Buffer.byteLength(src, 'utf8') + ' B')

/* ── 静态面：先确认修复形态在位（否则行为断言无从谈起） ── */
console.log('\n[A] 修复形态（静态面）')
const L = src.split(/\r?\n/)
const gateI = L.findIndex((l) => l.trim() === 'if (this._subagentInflight >= 3) {')
const incI = L.findIndex((l) => l.trim() === 'this._subagentInflight = (this._subagentInflight || 0) + 1')
const relI = L.findIndex((l) => l.trim() === 'const _wbReleaseInflight = () => {')
ck(gateI > 0, '闸门行存在（L' + (gateI + 1) + '）')
ck(incI > gateI, '占位自增存在且在闸门之后（L' + (incI + 1) + ' > L' + (gateI + 1) + '）')
ck(incI - gateI <= 12, '★占位自增紧邻闸门（间隔 ' + (incI - gateI) + ' 行 ≤ 12）⇒ 中间放不下 await')
ck(relI > gateI && relI < gateI + 20, '释放器声明紧随闸门（L' + (relI + 1) + '）')
// 剥离注释后闸门→自增零 await
const strip = (l) => (l.trim().startsWith('//') || l.trim().startsWith('*') ? '' : l.replace(/\/\/.*$/, ''))
const aw = []
for (let i = gateI; i < incI; i++) if (/\bawait\b/.test(strip(L[i]))) aw.push(i + 1)
ck(aw.length === 0, '★闸门→自增零 await（剥离注释），越界 ' + (aw.join(',') || '无'))

/* ── 行为面：真跑并发 ── */
// 花括号配平抽函数体
function extractFn(source, anchor) {
  const i = source.indexOf(anchor)
  if (i < 0) throw new Error('anchor miss: ' + anchor)
  let j = source.indexOf('{', i), d = 0, end = -1
  for (let k = j; k < source.length; k++) {
    const c = source[k]
    if (c === '{') d++
    else if (c === '}') { d--; if (d === 0) { end = k; break } }
  }
  return source.slice(i, end + 1)
}

// 按**行**抽「闸门 + 占位自增 + 释放器」整段（起点必须是**闸门行本身**，不能从注释起——否则闸门不在段内）
const gs = gateI
ck(gs > 0, '闸门段起点 = 闸门行（L' + (gs + 1) + '）')
const relClose = (() => {
  for (let i = relI + 1; i < relI + 20; i++) if (L[i].trim() === '}') return i
  return -1
})()
ck(relClose > relI, '释放器收尾行可定（L' + (relClose + 1) + '）')
const segment = L.slice(gs, relClose + 1).join('\n')
ck(segment.includes('_subagentInflight = (this._subagentInflight || 0) + 1'), '★抽出段含占位自增')
ck(segment.includes('_wbReleaseInflight'), '★抽出段含释放器')
ck(segment.includes('if (this._subagentInflight >= 3) {'), '★抽出段含闸门')

// 装配 harness：用一个「带 await 的伪造归属门」模拟 E2 —— 这是竞态的必要条件
const harness = `
  return async function (inflightState, job, delayMs) {
    const self = this
${segment}
    // 模拟 E2 归属门之后的真实工作（此处**必须**有 await，才能验证占位已生效）
    await new Promise((r) => setTimeout(r, delayMs))
    self._peak = Math.max(self._peak || 0, self._subagentInflight)
    self._completed = (self._completed || 0) + 1
    _wbReleaseInflight()
    return 'done'
  }
`
const mk = new Function('label', 'diag', harness)('probe-label', () => {})

async function runCase(n, delayMs) {
  const st = { _subagentInflight: 0, _peak: 0, _completed: 0 }
  const results = await Promise.all(
    Array.from({ length: n }, () => mk.call(st, st, 'job', delayMs))
  )
  return { st, results }
}

console.log('\n[B] 并发行为（同一 tick 内 N 路同时进入）')
// B1：40 路并发 ⇒ 峰值必须 ≤ 3（修复前会冲到 40+）
{
  const { st, results } = await runCase(40, 5)
  ck(st._peak <= 3, '★40 路并发峰值 inflight=' + st._peak + '（上限 3；修复前实测 41）')
  ck(st._subagentInflight === 0, '★全部完成后 inflight 归零（无泄漏），实际 ' + st._subagentInflight)
  const rejected = results.filter((r) => r === '').length
  ck(rejected === 37, '★放行 3 路 / 拒绝 37 路（实际拒绝 ' + rejected + '）')
}
// B2：恰好 3 路 ⇒ 全部放行
{
  const { st, results } = await runCase(3, 5)
  ck(st._peak === 3, '3 路并发峰值 = 3（恰好达上限），实际 ' + st._peak)
  ck(results.filter((r) => r === '').length === 0, '3 路全部放行（无一被拒）')
  ck(st._subagentInflight === 0, '完成后归零，实际 ' + st._subagentInflight)
}
// B3：4 路 ⇒ 第 4 路被拒
{
  const { st, results } = await runCase(4, 5)
  ck(st._peak <= 3, '4 路并发峰值 ≤ 3，实际 ' + st._peak)
  ck(results.filter((r) => r === '').length === 1, '恰好 1 路被拒，实际 ' + results.filter((r) => r === '').length)
}
// B4：两批串行 ⇒ 上限不被跨批复用污染（释放后名额归还）
{
  const st = { _subagentInflight: 0, _peak: 0, _completed: 0 }
  await Promise.all(Array.from({ length: 3 }, () => mk.call(st, st, 'job', 5)))
  const afterFirst = st._subagentInflight
  const r2 = await Promise.all(Array.from({ length: 3 }, () => mk.call(st, st, 'job', 5)))
  ck(afterFirst === 0, '第一批结束后名额全部归还（实际 ' + afterFirst + '）')
  ck(r2.filter((r) => r === '').length === 0, '★第二批 3 路仍全部放行（名额可复用，非一次性闸门）')
  ck(st._peak <= 3, '跨批峰值仍 ≤ 3，实际 ' + st._peak)
}
// B5：100 路极端并发 ⇒ 仍不超上限
{
  const { st } = await runCase(100, 3)
  ck(st._peak <= 3, '★100 路极端并发峰值 = ' + st._peak + '（≤ 3）')
  ck(st._subagentInflight === 0, '100 路后归零，实际 ' + st._subagentInflight)
}

/* ── 反面对照：把闸门改回「旧序」应复现竞态（证明探针有辨别力） ── */
console.log('\n[C] 反面对照（变异红证明）：还原旧序应复现竞态')
const oldHarness = `
  return async function (inflightState, job, delayMs) {
    const self = this
    if (self._subagentInflight >= 3) { return '' }        // 旧序：只检查
    await new Promise((r) => setTimeout(r, 1))            // E2 的 await（让出控制权）
    self._subagentInflight = (self._subagentInflight || 0) + 1   // 旧序：推迟自增
    await new Promise((r) => setTimeout(r, delayMs))
    self._peak = Math.max(self._peak || 0, self._subagentInflight)
    self._subagentInflight = Math.max(0, self._subagentInflight - 1)
    return 'done'
  }
`
const mkOld = new Function('label', 'diag', oldHarness)('probe', () => {})
{
  const st = { _subagentInflight: 0, _peak: 0 }
  await Promise.all(Array.from({ length: 40 }, () => mkOld.call(st, st, 'job', 5)))
  ck(st._peak > 3, '★旧序复现竞态：峰值 inflight=' + st._peak + '（> 3 ⇒ 探针确实有辨别力，非恒真）')
}

console.log('\n═══ 结果：' + P + ' PASS / ' + F + ' FAIL ═══')
process.exit(F ? 1 : 0)

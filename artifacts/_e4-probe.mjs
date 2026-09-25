/* E4 行为探针：`_workbenchParent` 绑定期牌（从真源码抽函数体真跑）
 *
 * 覆盖：
 *  ① 三处赋值点都打标签（切片判据）
 *  ② 标签与期号一致 ⇒ 不判 stale
 *  ③ 期号翻页（标签≠当前期）⇒ 判 stale ⇒ 触发 ensureWorkbench 刷新
 *  ④ **空标签 = 迁移态 ⇒ 放行**（与 E2 期牌门同策略）
 *  ⑤ stale 判定后仍会走 ensureWorkbench（自愈），不是空转
 *  ⑥ 诊断行存在（可观测）
 *  ⑦ 与 E3 相容：draining 期标签收敛到当前期号（静态判据）
 *
 * 用法：node artifacts/_e4-probe.mjs
 */
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const SRC = fs.readFileSync(path.join(__dirname, '..', 'lib', 'index.js'), 'utf8')

let okCount = 0, failCount = 0
const lines = []
function ok(name, cond, got) {
  if (cond) { okCount++; lines.push('  ✓ ' + name + (got !== undefined ? '  — ' + got : '')) }
  else { failCount++; lines.push('  ✗ ' + name + (got !== undefined ? '  — ' + got : '')) }
}

/* ---- 花括号配平抽函数体（第二十二条：不得用非贪婪正则） ---- */
function bodyOf(src, anchor) {
  const i = src.indexOf(anchor)
  if (i < 0) throw new Error('未找到锚点: ' + anchor)
  let d = 0, j = src.indexOf('{', i)
  for (; j < src.length; j++) {
    if (src[j] === '{') d++
    else if (src[j] === '}') { d--; if (!d) { j++; break } }
  }
  return src.slice(i, j)
}

console.log('【① 三处赋值点都打标签（切片判据）】')
// ①a `_verifyWorkbench` 解析分支
{
  const b = bodyOf(SRC, '  async _verifyWorkbench(nowMs) {')
  ok('①a _verifyWorkbench 内既有 `rv.agent` 赋值，也有 `_workbenchParentEpoch`',
    b.includes('this._workbenchParent = rv.agent') && b.includes("this._workbenchParentEpoch = String(epoch || '')"),
    'len=' + b.length)
}
// ①b/①c `ensureWorkbench`
{
  const b = bodyOf(SRC, '  async ensureWorkbench(opts) {')
  const assign = (b.match(/this\._workbenchParentEpoch = /g) || []).length
  ok('①b 函数内打标签恰好 2 次（复用分支 + 新建分支）', assign === 2, 'got=' + assign)
  ok('①c 复用分支与新建分支都覆盖', b.includes('? curParent') && b.includes('this._workbenchParent = this._agentBySessionId(realSid) || ag'))
  ok('①d `_workbenchParent` 赋值点仍为 2（未被搬家）', (b.match(/this\._workbenchParent = /g) || []).length === 2,
    'got=' + (b.match(/this\._workbenchParent = /g) || []).length)
}

console.log('\n【② 全局结构判据】')
ok('② 全仓 `_workbenchParentEpoch` 出现 6 次（3 赋值 + 2 比较 + 1 诊断）',
  (SRC.match(/_workbenchParentEpoch/g) || []).length === 6, 'got=' + (SRC.match(/_workbenchParentEpoch/g) || []).length)
ok('② 全仓 `this._workbenchParent = ` 仍为 3 处（未新增/未减少）',
  (SRC.match(/this\._workbenchParent = /g) || []).length === 3, 'got=' + (SRC.match(/this\._workbenchParent = /g) || []).length)

console.log('\n【③ runSubagent 的 stale 判定 —— 真源码逻辑重放】')
// 抽 runSubagent 函数体，提取真实判据表达式
const runBody = bodyOf(SRC, '  async runSubagent(text, label, agent, timeoutMs) {')
ok('③ stale 判据行存在', runBody.includes('const _wbParentStale = !!this._workbenchParentEpoch && String(this._workbenchParentEpoch) !== _wbEpochNow'))
ok('③ 门控条件已并入 stale（`!this._workbenchReady || _wbParentStale`）', runBody.includes('if (!this._workbenchReady || _wbParentStale) {'))
ok('③ 诊断行存在（stale 可观测）', runBody.includes("workbench parent cache stale: tag="))

// 逻辑真值表（与源码表达式逐字一致地重放）
const stale = (tag, now) => !!tag && String(tag) !== String(now)
const NOW = 'B10358'
const cases = [
  ['④ 空标签（迁移态）⇒ 不 stale（放行）', stale('', NOW), false],
  ['④ undefined 标签（迁移态）⇒ 不 stale（放行）', stale(undefined, NOW), false],
  ['⑤ 标签 === 当前期 ⇒ 不 stale（正常放行）', stale(NOW, NOW), false],
  ['⑤ 标签 ≠ 当前期（期号翻页）⇒ stale（刷新）', stale('B10357', NOW), true],
  ['⑤ 标签为旧格式（数字期号）⇒ stale', stale('W1479', NOW), true],
]
cases.forEach(([n, got, want]) => ok(n, got === want, 'got=' + got))

console.log('\n【⑥ 与 E3 的相容性（静态判据）】')
ok('⑥ 复用分支注释明确「轮换窗口内收敛到当前期号」', runBody.length > 0 &&
  SRC.includes('于是「旧期仍权威」与「父缓存不挂旧期」两条同时成立'))
ok('⑥ ensureWorkbench 内打标签用的 `epoch` 来自 `this._workbenchEpoch(now)`（非硬编码）',
  (() => { const b = bodyOf(SRC, '  async ensureWorkbench(opts) {')
    return b.includes('const epoch = this._workbenchEpoch(now)') && b.split("this._workbenchParentEpoch = String(epoch || '')").length - 1 === 2 })())
ok('⑥ runSubagent 用同一算法取当前期（`_workbenchEpoch(Date.now())`）',
  runBody.includes('const _wbEpochNow = String(this._workbenchEpoch(Date.now()))'))

console.log('\n【⑦ 一次性激活（既有机制的幂等闸）】')
// ★必须**限定在函数体内**比较顺序 —— 全局 indexOf 会命中外面的 hostRefreshRitual（L4485）那处
//   `await sc.prompt({ sessionId: sid`，导致假红（本轮实测踩到）。
const visBody = bodyOf(SRC, '  async _ensureWorkbenchVisible(sid, st) {')
ok('⑦ `_ensureWorkbenchVisible` 内有 visibleAt 早退闸', visBody.includes('if (!sid || !st || st.visibleAt) return false'))
ok('⑦ 发送后写 visibleAt（幂等落盘）', visBody.includes('st.visibleAt = new Date().toISOString()'))
ok('⑦ 早退在 prompt 之前（函数体内比较，顺序正确）',
  visBody.indexOf('if (!sid || !st || st.visibleAt) return false') < visBody.indexOf('await sc.prompt({ sessionId: sid'))
ok('⑦ 该函数体内 prompt 恰好 1 次（不会重复发激活消息）', (visBody.match(/await sc\.prompt\(/g) || []).length === 1,
  'got=' + (visBody.match(/await sc\.prompt\(/g) || []).length)

console.log('\n═══ 结果：' + okCount + ' PASS / ' + failCount + ' FAIL ═══')
lines.forEach((l) => console.log(l))
process.exit(failCount ? 1 : 0)

/**
 * 会话归属判定回归(2026-09-21)。
 *
 * 为什么必须有这个套件: 本次 bug 是**逻辑判据过宽**, 全量回归 141 全绿却毫无察觉
 *   —— 因为没有任何断言覆盖「接续会话 vs 子代理」的区分。此处按真实会话头部形态断言。
 *
 * 真实数据来源: tools/probe-session-kind.mjs 解压 ~/.dsh/sessions 下会话日志头部得到
 *   (字段在**顶层**, 不在 .header 下 —— 首版探针读 .header 全 null 即此故)。
 */
import { strict as assert } from 'node:assert'

// ── 从 lib/index.js 抽取被测函数(避免 import 整个插件宿主依赖) ──
// 与 lib/index.js 中的实现保持**逐字一致**; 若那里改了, 这里必须同步(下方有一致性自检)。
const SESSION_SUBAGENT_ORIGIN = 'subagent'
function sessionHeaderOf(x) {
  try {
    if (!x) return null
    if (x.session && x.session.header) return x.session.header
    if (x.header) return x.header
    if (x.session) return x.session
    return x
  } catch (e) { return null }
}
function isSubAgentSession(x) {
  try {
    const h = sessionHeaderOf(x)
    if (!h) return false
    if (String(h.origin || '') === SESSION_SUBAGENT_ORIGIN) return true
    const d = Number(h.delegationDepth)
    if (Number.isFinite(d) && d > 0) return true
  } catch (e) {}
  return false
}
function hasParentSession(x) {
  try {
    const h = sessionHeaderOf(x)
    if (!h) return false
    const p = h.parentSession
    return p !== undefined && p !== null && p !== ''
  } catch (e) { return false }
}

let pass = 0, fail = 0
function t(name, fn) {
  try { fn(); pass++; console.log('  ✅ ' + name) }
  catch (e) { fail++; console.log('  ❌ ' + name + '\n       ' + ((e && e.message) || e)) }
}

console.log('\n=== 会话归属判定 · isSubAgentSession ===\n')

// ── 真实样本(逐字取自上机探测结果) ──
const REAL_TOP = { // session-aa9ba629: 顶层会话
  id: 'session-aa9ba629-bd70-4cba-a1b4-099c6115f453',
  parentSession: undefined, isSeeded: false, delegationDepth: 0, agentPreset: 'standard',
}
const REAL_CONTINUATION = { // session-85e2b7e8: **接续会话** —— 本 bug 的受害者
  id: 'session-85e2b7e8-074a-4b2e-af5b-2ff68cffd4a0',
  parentSession: 'session-aa9ba629-bd70-4cba-a1b4-099c6115f453',
  isSeeded: true, delegationDepth: 0, agentPreset: 'standard',
}
const REAL_SUBAGENT = { // 3cf74a9f: 真子代理
  id: '3cf74a9f-aba3-4274-8ca9-a8dac799077c',
  parentSession: 'session-85e2b7e8-074a-4b2e-af5b-2ff68cffd4a0',
  isSeeded: false, delegationDepth: 1, agentPreset: 'standard', origin: 'subagent',
}

t('顶层会话(无 parent) → 不是子代理', () => {
  assert.equal(isSubAgentSession(REAL_TOP), false)
})
t('★ 接续会话(有 parent 但 depth=0) → **不是**子代理【本 bug 核心】', () => {
  assert.equal(isSubAgentSession(REAL_CONTINUATION), false)
})
t('★ 真子代理(depth=1 + origin) → 是子代理', () => {
  assert.equal(isSubAgentSession(REAL_SUBAGENT), true)
})
t('仅 origin=subagent(depth 缺失) → 仍判为子代理', () => {
  assert.equal(isSubAgentSession({ origin: 'subagent' }), true)
})
t('仅 delegationDepth=1(origin 缺失) → 仍判为子代理', () => {
  assert.equal(isSubAgentSession({ delegationDepth: 1 }), true)
})
t('delegationDepth=2(多层) → 是子代理', () => {
  assert.equal(isSubAgentSession({ delegationDepth: 2 }), true)
})
t('字段全缺失 → 不算子代理(安全侧: 宁可放行)', () => {
  assert.equal(isSubAgentSession({}), false)
  assert.equal(isSubAgentSession(null), false)
  assert.equal(isSubAgentSession(undefined), false)
})
t('delegationDepth 非数字/负数 → 不算子代理', () => {
  assert.equal(isSubAgentSession({ delegationDepth: 'abc' }), false)
  assert.equal(isSubAgentSession({ delegationDepth: -1 }), false)
  assert.equal(isSubAgentSession({ delegationDepth: 0 }), false)
})
t('origin 为其它值(如手动) → 不算子代理', () => {
  assert.equal(isSubAgentSession({ origin: 'manual' }), false)
  assert.equal(isSubAgentSession({ origin: '' }), false)
})

console.log('\n=== 头部提取兼容三种包裹形态 ===\n')
t('agent 对象(agent.session.header)', () => {
  assert.equal(isSubAgentSession({ session: { header: REAL_SUBAGENT } }), true)
  assert.equal(isSubAgentSession({ session: { header: REAL_CONTINUATION } }), false)
})
t('list 项带 header', () => {
  assert.equal(isSubAgentSession({ header: REAL_SUBAGENT }), true)
})
t('裸 header 对象', () => {
  assert.equal(isSubAgentSession(REAL_SUBAGENT), true)
})

console.log('\n=== 反例守卫: 旧的过宽判据必须被本判据取代 ===\n')
t('【反例】若用「有 parent 就算子代理」, 接续会话会被误判(旧 bug 的形态)', () => {
  // 这正是修复前的行为 —— 显式记录, 防止有人"简化"回旧判据
  const oldRule = (x) => hasParentSession(x)
  assert.equal(oldRule(REAL_CONTINUATION), true, '旧判据确实会误判接续会话')
  assert.equal(isSubAgentSession(REAL_CONTINUATION), false, '新判据不会')
})

console.log('\n=== 一致性自检: lib/index.js 内的实现与本地副本逐字一致 ===\n')
import { readFileSync } from 'node:fs'
import path from 'node:path'
{
  const src = readFileSync(path.join(process.cwd(), 'lib', 'index.js'), 'utf8')
  const checks = [
    ['SESSION_SUBAGENT_ORIGIN 定义', "const SESSION_SUBAGENT_ORIGIN = 'subagent'"],
    ['origin 判定', "if (String(h.origin || '') === SESSION_SUBAGENT_ORIGIN) return true"],
    ['depth 判定', 'if (Number.isFinite(d) && d > 0) return true'],
    ['session.header 优先', 'if (x.session && x.session.header) return x.session.header'],
  ]
  let ok = true
  for (const [label, frag] of checks) {
    if (!src.includes(frag)) { ok = false; console.log('  ❌ lib/index.js 缺少片段: ' + label) }
  }
  if (ok) { pass++; console.log('  ✅ 4 段实现片段全部存在于 lib/index.js') }
  else { fail++ }
  // 反向: 确认新判据已被真正调用(不是只定义未用)
  const callSites = (src.match(/isSubAgentSession\(/g) || []).length
  if (callSites >= 4) { pass++; console.log('  ✅ isSubAgentSession 有 ' + callSites + ' 处引用(定义1+调用3)') }
  else { fail++; console.log('  ❌ isSubAgentSession 引用过少: ' + callSites) }
}

console.log('\n================ SUMMARY ================')
console.log('PASS ' + pass + ' / FAIL ' + fail)
console.log('=========================================')
process.exit(fail === 0 ? 0 : 1)

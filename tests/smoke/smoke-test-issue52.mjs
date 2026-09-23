#!/usr/bin/env node
/**
 * Issue #52 回归:子代理模型/思考强度选择被旧 cfg 覆盖(React 闭包快照 + 批处理)。
 *
 * 根因(修前):
 *   `function set(key, value) { var next = Object.assign({}, cfg); next[key] = value; setCfg(next); setDirty(true) }`
 *   读的是**本次渲染的闭包快照** `cfg`。同一个 React 事件里连续调
 *   `set('subagentModel', m.id); set('subagentProvider', p.id)` 时,两次更新被批处理,
 *   而第二次仍基于同一个旧 cfg ⇒ 把第一次刚写进去的 model **覆盖回旧值**。
 *   症状:subagentModel 存过一个后来被删除的模型后,换模型/清空/手输都"选不动"。
 *
 * 口径:从 lib/client.js 源码**抽取真实 set/setMany 函数体**执行 —— 测的是随包发布的代码。
 *       模拟 React 批处理语义(闭包里的 cfg 在本轮内保持不变),而不是手抄一份逻辑。
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import assert from 'node:assert'
import { test } from 'node:test'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const SRC = readFileSync(path.resolve(HERE, '..', '..', 'lib', 'client.js'), 'utf8').replace(/\r\n/g, '\n')

// —— 抽取真实实现 ——
const setLine = SRC.match(/\n {4}function set\(key, value\) \{[^\n]*\n/)
assert.ok(setLine, '未定位到 set() 实现')
const setManyLine = SRC.match(/\n {4}function setMany\(patch\) \{[^\n]*\n/)
assert.ok(setManyLine, '未定位到 setMany() 实现')

/**
 * 用真实函数体构造一个受控 harness。
 * React 语义:同一事件内 `cfg`(闭包变量)保持不变;setCfg 接受「值」或「更新函数」,
 * 更新函数拿到的是**最新**的 prev —— 这正是修复能生效的机制。
 */
function makeHarness(initial) {
  let latest = initial
  const factory = new Function('setCfg', 'setDirty', `
    var cfg = ${JSON.stringify(initial)}
    ${setManyLine[0].trim()}
    ${setLine[0].trim()}
    return { set: set, setMany: setMany }
  `)
  const api = factory(function (v) { latest = (typeof v === 'function') ? v(latest) : v }, function () {})
  return { api, current: () => latest }
}

test('S0 源码守卫:set 不得再读闭包快照 cfg;setMany 必须走函数式更新', () => {
  assert.ok(/setCfg\(function \(prev\)/.test(setLine[0]),
    'set() 必须用函数式更新 setCfg(function (prev) {...})，否则同事件内连续 set 会互相覆盖')
  assert.ok(!/Object\.assign\(\{\}, cfg\)/.test(setLine[0]),
    'set() 不得再引用闭包变量 cfg（issue #52 根因）')
  assert.ok(/setCfg\(function \(prev\)/.test(setManyLine[0]), 'setMany 必须函数式合并 patch')
})

test('S1 根因复现:旧实现对同一事件内的连续 set 会覆盖（证明该修有意义）', () => {
  // 手工重现旧实现(读闭包快照),用于反证 —— 新实现不得有此行为
  let closed = { subagentModel: 'deleted-model', subagentProvider: 'old' }
  function legacySet(key, value) { const next = Object.assign({}, closed); next[key] = value; closed = next }
  // React 批处理:两次调用都基于**同一个**入参快照,故第二次覆盖第一次
  const snapshot = closed
  function legacySetStale(key, value) { const next = Object.assign({}, snapshot); next[key] = value; closed = next }
  legacySetStale('subagentModel', 'model-B')
  legacySetStale('subagentProvider', 'prov-B')
  assert.equal(closed.subagentModel, 'deleted-model', '旧口径确实会回退成已删除模型(根因成立)')
})

test('S2 选择另一个可用模型 → model/provider 均为新值(不再回退)', () => {
  const h = makeHarness({ subagentModel: 'deleted-model', subagentProvider: 'p-old' })
  h.api.setMany({ subagentModel: 'model-B', subagentProvider: 'prov-B' })
  assert.equal(h.current().subagentModel, 'model-B', 'model 必须覆盖为 B')
  assert.equal(h.current().subagentProvider, 'prov-B', 'provider 必须一并变为 B')
})

test('S3 「跟随路由默认(留空)」→ model/provider 均清空', () => {
  const h = makeHarness({ subagentModel: 'deleted-model', subagentProvider: 'p-old' })
  h.api.setMany({ subagentModel: '', subagentProvider: '' })
  assert.equal(h.current().subagentModel, '', 'model 必须清空')
  assert.equal(h.current().subagentProvider, '', 'provider 必须清空')
})

test('S4 手动输入自定义模型 → model=custom 且 provider 置空', () => {
  const h = makeHarness({ subagentModel: 'deleted-model', subagentProvider: 'p-old' })
  h.api.setMany({ subagentModel: 'custom-model', subagentProvider: '' })
  assert.equal(h.current().subagentModel, 'custom-model')
  assert.equal(h.current().subagentProvider, '', '手输时 provider 应跟随路由默认(置空)')
})

test('S5 正常模型 A → B 不回退为 A', () => {
  const h = makeHarness({ subagentModel: 'model-A', subagentProvider: 'prov-A' })
  h.api.setMany({ subagentModel: 'model-B', subagentProvider: 'prov-B' })
  assert.equal(h.current().subagentModel, 'model-B')
})

test('S6 切换模型不得回滚 reasoning effort(issue#52 第 5 条)', () => {
  const h = makeHarness({ subagentModel: 'deleted-model', subagentProvider: 'p', subagentReasoningEffort: 'max' })
  h.api.setMany({ subagentModel: 'model-B', subagentProvider: 'prov-B' })
  assert.equal(h.current().subagentReasoningEffort, 'max', '未触碰的字段必须原样保留')
  h.api.set('subagentReasoningEffort', 'low')
  assert.equal(h.current().subagentReasoningEffort, 'low', '单独改 effort 生效')
  assert.equal(h.current().subagentModel, 'model-B', '改 effort 不得回滚 model')
})

test('S7 连续两次单字段 set 也不再互相覆盖(函数式更新的通用收益)', () => {
  const h = makeHarness({ subagentModel: 'deleted-model', subagentProvider: 'p-old' })
  h.api.set('subagentModel', 'model-B')
  h.api.set('subagentProvider', 'prov-B')
  assert.equal(h.current().subagentModel, 'model-B', '先写的 model 不得被后写的 provider 覆盖回旧值')
  assert.equal(h.current().subagentProvider, 'prov-B')
})

test('S8 调用点已改用 setMany（三个成对入口全部覆盖）', () => {
  const setManyCalls = SRC.match(/setMany\(\{ subagentModel: [^}]*\}\)/g) || []
  assert.equal(setManyCalls.length, 3, '默认/选模型/手输 三个入口都必须走 setMany，实得 ' + setManyCalls.length)
  assert.ok(setManyCalls.some((s) => /subagentModel: ''/.test(s) || /subagentModel: ''/.test(s)) || setManyCalls.some((s) => s.includes("subagentModel: ''")),
    '必须包含「清空」入口')
  // 只检查**代码行**,排除注释(修复说明里会引用旧写法作为反面例子)
  const codeOnly = SRC.split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n')
  const stale = codeOnly.match(/set\('subagentModel'[^\n]*?\); set\('subagentProvider'/g) || []
  assert.equal(stale.length, 0, '不得残留成对的旧式 set 调用: ' + JSON.stringify(stale))
})

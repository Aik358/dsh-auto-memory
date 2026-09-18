#!/usr/bin/env node
/**
 * Issue #58 回归:activation host 的 per-runtime 状态在会话释放时从不清理。
 *
 * 根因 1(清理函数零调用方):`disposeRuntime` 全仓无调用点 —— 唯一的 runtime 释放路径
 *   `SessionRuntimeStore.dispose(agent)` 只清了 shadow host(而那一行本身也是死代码:
 *   `SessionRuntimeStore` 上从未挂过 `_shadowHost`,该字段只存在于 engine 上 —— 另案)。
 *   ⇒ runtimeState / stepsByRuntime / pathsByKey / inbox 注册表每会话累积一条,进程存活期内不释放,
 *   已释放会话的 claimed 包(含烘焙好的 references)一直挂在注册表里。
 * 根因 2(键格式错配):`stepFor` 写键 `sessionId|ws:<workspaceKey>`,registry 写键
 *   `session:<sessionId>|ws:<workspaceKey>`,而 disposeRuntime 删的是 `runtime.key`
 *   ⇒ 即使接上线也是空操作。
 *
 * 本套件锁定:
 *   A. 真实 host:一轮 onPreStep 挂上四处状态 → disposeRuntime 四处全清(修前只清 runtimeState)。
 *   B. 只清被释放的那个 runtime,别的会话不受影响(过度清理=每次重算)。
 *   C. 接线守卫:从 lib/index.js 抽出**真实的** dispose(agent) 函数体执行,证明调用真的发生。
 *   D. 兼容既有导出签名(传 key 字符串也要能清);畸形入参不抛、不误清。
 */
import assert from 'node:assert/strict'
import { readFileSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const SRC = readFileSync(path.resolve(HERE, '..', '..', 'lib', 'index.js'), 'utf8')

const tmpHome = mkdtempSync(path.join(tmpdir(), 'dam-issue58-'))
process.env.DSH_HOME = tmpHome

const { createActivationHost } = await import('../../lib/activation-host.js')
const { ActivationInboxRegistry } = await import('../../lib/activation-inbox-state.js')

/** 花括号配平抽取(与 smoke-test-capture-paths-pre 同法):测的是随包发布的代码。 */
function extractFn(header) {
  const start = SRC.indexOf(header)
  assert.ok(start >= 0, '未定位到 ' + header)
  let depth = 0, end = -1
  for (let i = start + header.length - 1; i < SRC.length; i++) {
    if (SRC[i] === '{') depth++
    else if (SRC[i] === '}') { depth--; if (depth === 0) { end = i; break } }
  }
  assert.ok(end > 0, '花括号不配平: ' + header)
  return SRC.slice(start, end + 1)
}

const WS_STATE = { ws: 'c:/ws-a', userDir: tmpHome + '/user', notesPath: tmpHome + '/notes.md', logPath: tmpHome + '/log.md' }
function makeEngine(rt) {
  return {
    config: { associativeMemoryEnabled: true, activationInboxEnabled: true, activationSource: 'fake' },
    runtimeFor: () => rt,
    state: { ...WS_STATE },
    __homedirFn: () => tmpHome,
  }
}
const makeRuntime = (key, sessionId) => ({ key, sessionId, agentId: 'a1', disposed: false, contextVersion: 3, eventCursor: 7 })

/** 起 host 并跑一轮 onPreStep:该轮会挂上 runtimeState / stepsByRuntime / pathsByKey / inbox 四条状态。 */
function prime(runtime) {
  const rt = runtime || makeRuntime('session:s1', 's1')
  const engine = makeEngine(rt)
  const host = createActivationHost({ engine })
  host.capturePaths(rt.key, engine.state)          // 真实接线里由 refreshAll / context 回调调用
  host.onPreStep({ id: rt.agentId, session: { id: rt.sessionId } })
  const st = host._statsForTest
  assert.equal(st.errors, 0, '夹具:onPreStep 必须真的跑完(否则本套件是空测),stats=' + JSON.stringify(st))
  assert.equal(st.claims + st.claimFails, 1, '夹具:onPreStep 走到了 claim 分支,stats=' + JSON.stringify(st))
  assert.equal(host.debugView().inboxCount, 1, '夹具:inbox 注册表已挂上该会话')
  return { host, rt, engine }
}

test('A1 ★disposeRuntime(runtime) 清掉四处 per-runtime 状态(修前只清 runtimeState)', () => {
  const { host, rt } = prime()
  const cleared = host.disposeRuntime(rt)
  assert.equal(typeof cleared, 'number', '★disposeRuntime 应回报清理条数(泄漏可观测的锚)')
  assert.ok(cleared >= 4, '★应清 runtimeState + stepsByRuntime + pathsByKey + inbox,实得 ' + cleared)
  assert.equal(host.debugView().inboxCount, 0, '★inbox 注册表已摘除该会话(修前恒 1)')
  assert.equal(host.disposeRuntime(rt), 0, '重复 dispose 幂等(已无可清)')
})

test('A2 释放后再走一轮:已 dispose 的 runtime 不复活激活态', () => {
  const { host, rt } = prime()
  host.disposeRuntime(rt)
  rt.disposed = true
  host.onPreStep({ id: rt.agentId, session: { id: rt.sessionId } })
  assert.equal(host.debugView().inboxCount, 0, '已释放会话不再挂新 inbox(disposed 守卫仍生效)')
})

test('A3 ★registry.disposeBySession 一次摘掉该会话在所有工作区下的 inbox', () => {
  const reg = new ActivationInboxRegistry()
  reg.forRuntime('s1', 'ws-a')
  reg.forRuntime('s1', 'ws-b')
  reg.forRuntime('s2', 'ws-a')
  assert.equal(reg.size, 3, '夹具:两会话三工作区分片')
  assert.equal(reg.disposeBySession('s1'), 2, '★s1 的两个分片一起摘掉(既有 disposeSession 要逐个工作区给 key)')
  assert.equal(reg.size, 1)
  assert.equal(reg.get('s1', 'ws-a'), null, '已摘除')
  assert.ok(reg.get('s2', 'ws-a'), '★其它会话不受影响')
  assert.equal(reg.disposeBySession(''), 0, '空 sessionId → 0')
  assert.equal(reg.disposeBySession('nope'), 0, '不存在的会话 → 0')
  assert.equal(reg.size, 1)
})

test('B1 ★只清被释放的那个 runtime:另一会话的 inbox/paths/step 全保留', () => {
  const rtA = makeRuntime('session:sA', 'sA')
  const engine = makeEngine(rtA)
  const host = createActivationHost({ engine })
  host.capturePaths(rtA.key, engine.state)
  host.onPreStep({ id: 'aA', session: { id: 'sA' } })
  const rtB = makeRuntime('session:sB', 'sB')
  engine.runtimeFor = () => rtB
  host.capturePaths(rtB.key, engine.state)
  host.onPreStep({ id: 'aB', session: { id: 'sB' } })
  assert.equal(host.debugView().inboxCount, 2, '夹具:两会话各一条 inbox')

  assert.ok(host.disposeRuntime(rtA) >= 4, '释放 A 清掉它自己的四条')
  assert.equal(host.debugView().inboxCount, 1, '★B 的 inbox 必须保留')
  host.onPreStep({ id: 'aB', session: { id: 'sB' } })
  assert.equal(host.debugView().inboxCount, 1, 'B 继续正常累积(未被 A 的释放打断)')
  assert.equal(host.disposeRuntime(rtB) >= 4, true, 'B 也可正常释放')
  assert.equal(host.debugView().inboxCount, 0, '两会话都释放后注册表归零')
})

test('B2 disposeAll 语义不回归:整体卸载仍清全部', () => {
  const rtA = makeRuntime('session:sA', 'sA')
  const engine = makeEngine(rtA)
  const host = createActivationHost({ engine })
  host.capturePaths(rtA.key, engine.state)
  host.onPreStep({ id: 'aA', session: { id: 'sA' } })
  const rtB = makeRuntime('session:sB', 'sB')
  engine.runtimeFor = () => rtB
  host.onPreStep({ id: 'aB', session: { id: 'sB' } })
  assert.equal(host.debugView().inboxCount, 2)
  host.disposeAll('plugin disposed')
  assert.equal(host.debugView().inboxCount, 0, 'disposeAll 仍清全部 inbox')
  assert.equal(host.disposeRuntime(rtA), 0, 'disposeAll 之后再 dispose 单个不报错、不重复计数')
})

test('C1 ★接线守卫:真实的 SessionRuntimeStore.dispose(agent) 会调用 _activationHost.disposeRuntime', () => {
  const body = extractFn('dispose(agent) {')
  const calls = []
  const agent = { id: 'aX', session: { id: 'sX' } }
  const rt = {
    key: 'session:sX', sessionId: 'sX', agentId: 'aX', disposed: false,
    abortController: new AbortController(), pendingConsolidations: [],
    envelopes: null, segments: null, callLinks: null, agent,
  }
  const byAgent = new WeakMap([[agent, rt]])
  const self = {
    _byAgent: byAgent,
    _byIdentity: new Map([['session:sX', rt]]),
    _all: new Set([rt]),
    _default: { key: 'default', abortController: new AbortController() },
    _activationHost: { disposeRuntime: (x) => { calls.push(x); return 4 } },
  }
  const dispose = new Function('return {' + body + '}')().dispose
  assert.equal(dispose.call(self, agent), true, '夹具:dispose 正常返回 true')
  assert.equal(calls.length, 1, '★dispose(agent) 实际调用 _activationHost.disposeRuntime 一次(修前 0 次)')
  const arg = calls[0]
  const passedKey = typeof arg === 'string' ? arg : (arg && arg.key)
  assert.equal(passedKey, 'session:sX', '★传的是这个 runtime 的身份(runtime 对象或 runtime.key)')
  assert.equal(rt.disposed, true, '既有清理不回归')
})

test('C2 接线守卫:store 上确实挂了 _activationHost(否则 C1 的 this._activationHost 恒假)', () => {
  assert.ok(
    /runtimes\._activationHost *=/.test(SRC) || /new SessionRuntimeStore\([^)]*activation/i.test(SRC),
    '★SessionRuntimeStore 实例必须拿到 activation host 引用(engine.runtimes._activationHost = …)'
  )
  assert.ok(SRC.includes('engine._activationHost = createActivationHost'), '夹具:activation host 仍在 apply() 里构造')
})

test('D1 兼容既有导出签名:传 runtime.key 字符串同样能清', () => {
  const { host } = prime(makeRuntime('session:s1', 's1'))
  assert.ok(host.disposeRuntime('session:s1') >= 4, '★按 key 字符串也能清到 inbox')
  assert.equal(host.debugView().inboxCount, 0)
})

test('D2 畸形入参:不抛、不误清别人的状态', () => {
  const { host, rt } = prime()
  assert.equal(host.disposeRuntime(undefined), 0, 'undefined → 0 条')
  assert.equal(host.disposeRuntime(''), 0, "空串 → 0 条")
  assert.equal(host.disposeRuntime(null), 0, 'null → 0 条')
  assert.equal(host.disposeRuntime({ key: '', sessionId: 's1' }), 0, '无 key 的入参不动共享状态')
  assert.equal(host.debugView().inboxCount, 1, '★误调用不得把有效会话清掉')
  assert.ok(host.disposeRuntime(rt) >= 4, '正常入参照样可清')
})

test('D3 以 agent id 为身份的 runtime(key 非 session: 前缀)也能按 sessionId 清 inbox', () => {
  // get() 里 identity 可能是 'agent:<id>'(创建时无 session.id),而 sessionId 之后才补上
  // ⇒ registry 键是 session:<sid>|ws:…,只按 key 前缀匹配会漏。故入参优先带 runtime 对象。
  const rt = makeRuntime('agent:aZ', 'sZ')
  const { host } = prime(rt)
  assert.ok(host.disposeRuntime(rt) >= 4, '★agent 身份 runtime 释放后 inbox 也被摘除')
  assert.equal(host.debugView().inboxCount, 0)
})

console.log('\nissue58-activation-dispose: done')

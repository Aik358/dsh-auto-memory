import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import vm from 'node:vm'
import { loadPrivateEngine } from '../lib/load-private-engine.mjs'

const source = await fs.readFile(new URL('../../lib/client.js', import.meta.url), 'utf8')
const start = source.indexOf('    async function runContinueFlow(opts) {')
const flow = source.slice(start, source.indexOf('    function PlanTab()', start))
for (const leave of [false, true, 'return']) {
  let sid = 'A', opened = [], listener, release
  const response = new Promise((resolve) => { release = resolve })
  // ★2026-10-24（C 线）：本段（runContinueFlow → PlanTab）现在**还包含** EventConvertPanel
  //   （存量转换三步 UI，插在 PlanTab 之前）。它引用 ROUTE_PREFIX / h / useState，
  //   抽取式真执行必须注入这些模块级依赖，否则报的是「抽取不全」而不是「代码有 bug」。
  //   （与 smoke-test-r38 的 PERCEPT_TITLES 同型；本条是 2026-10-24 全量回归实测到的。）
  const env = { currentSessionIdClient: () => sid, L: (s) => s, continueFlowBusy: false,
    ROUTE_PREFIX: '/api/dsh-auto-memory',
    h: function () { return null }, useState: function (v) { return [typeof v === 'function' ? v() : v, function () {}] },
    API: { autoContDecide: '/fixture' }, apiPost: () => response,
    sessions: { open: (id) => opened.push(id), list: { subscribe: (fn) => { listener = fn; return () => { listener = null } } } } }
  vm.createContext(env); vm.runInContext(flow, env)
  const work = env.runContinueFlow({})
  if (leave) { sid = 'B'; if (listener) listener(); if (leave === 'return') { sid = 'A'; if (listener) listener() } }
  release({ ok: true, sessionId: 'A-next' })
  await work
  assert.deepEqual(opened, leave ? [] : ['A-next'], 'a completed continuation must respect user navigation')
}
const { MemoryEngine } = await loadPrivateEngine()
const engine = Object.create(MemoryEngine.prototype)
engine.config = { autoContinueEnabled: true }
engine._autoContState = { lastRunAt: 10, lastOk: { sessionId: 'A-next', fromSid: 'A', model: '',
  modelConfirmed: false, modelDegraded: true, modelDegradeReason: 'selection-failed', modelRequested: 'fixture-model' } }
const state = engine.autoContinueState('A')
for (const key of ['modelConfirmed', 'modelDegraded', 'modelDegradeReason', 'modelRequested']) assert.equal(state.lastOk[key], engine._autoContState.lastOk[key], key)
console.log('PASS #392/#393 manual navigation and polled model warnings retain their identity')

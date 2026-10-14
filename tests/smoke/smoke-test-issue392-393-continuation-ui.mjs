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
  const env = { currentSessionIdClient: () => sid, L: (s) => s, continueFlowBusy: false,
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

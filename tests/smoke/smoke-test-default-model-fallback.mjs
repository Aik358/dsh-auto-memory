// Execute the shipped fallback method with host substitutes; no network or user memory.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import { parseModelWindowsPre, pickWindowPre } from '../../lib/water-window.js'

const source = readFileSync(new URL('../../lib/index.js', import.meta.url), 'utf8').replace(/\r\n/g, '\n')
const start = source.indexOf('  async _runSubagentOnce(text, label, agent, timeoutMs) {')
const end = source.indexOf('  /** 子代理痕迹回收', start)
const optionsStart = source.indexOf('function subAgentOptions(config, lane) {')
const optionsEnd = source.indexOf('\n}', optionsStart) + 2
const parserStart = source.indexOf('function parseAgentDefaultModelPre(text) {')
const parserEnd = source.indexOf('\n}', parserStart) + 2
// ★2026-10-18（DSH 0.2.1 迁移）：_runSubagentOnce 内的两处启动改走 callSubagentStartPre 适配层，
//   该函数定义在 vm 切片之外 ⇒ 必须一并注入上下文，否则 vm 内 ReferenceError 被 catch 吞成空结果。
const adapterStart = source.indexOf('async function callSubagentStartPre(')
const adapterEnd = source.indexOf('\n}', adapterStart) + 2
let failed = 0

async function check(name, fn) {
  try { await fn(); console.log('PASS ' + name) }
  catch (e) { failed++; console.error('FAIL ' + name + ': ' + e.message) }
}

async function run(settings, registered = ['spawn'], config = { subagentProvider: 'broken-provider', subagentModel: 'bad-model' }) {
  const calls = []
  const context = vm.createContext({
    AbortController, setTimeout, clearTimeout, Date, console: { error() {} },
    diag() {}, WB_GATED_JOBS: [], subagentJob: () => 'sum',
    readSettingsTextPre: async () => settings,
  })
  if (parserStart >= 0) vm.runInContext(source.slice(parserStart, parserEnd), context)
  if (adapterStart >= 0) vm.runInContext(source.slice(adapterStart, adapterEnd), context)
  const engine = vm.runInContext(source.slice(optionsStart, optionsEnd) + '\nnew (class { ' + source.slice(start, end) + ' })()', context)
  Object.assign(engine, {
    config, _workbenchReady: true, _workbenchEpoch: () => 'epoch',
    _subagentLane: () => 'short', _currentGen: async () => 0, _subagentDisplayLabel: () => 'fixture',
    _workbenchParent: { session: { id: 'fixture-parent' }, ctx: { get() {} } },
    _subagents: {
      list: () => registered,
      async start(implementation, request) {
        calls.push({ implementation, options: request.agentOptions })
        const error = calls.length === 1 ? 'UNKNOWN_MODEL' : !registered.includes(implementation) ? 'unknown subagent implementation' : request.agentOptions?.provider !== 'valid-provider' ? 'UNKNOWN_MODEL wrong fallback provider' : ''
        return { result: error ? Promise.reject(Error(error)) : Promise.resolve({ output: [{ type: 'text', text: 'fallback-result' }] }) }
      },
    },
    withTimeout: promise => promise, bumpGenFor: async () => {},
  })
  const result = await engine._runSubagentOnce('fixture input', 'sum', null, 1000)
  assert.equal(engine._subagentInflight, 0, 'inflight ownership is released')
  return { result, calls, circuit: engine._subagentCircuit }
}

for (const [name, settings] of [
  ['profile list', '- id: agent-default-model\n  name: agent-default-model\n  config:\n    provider: valid-provider\n    model: valid-model\n- id: other\n  config:\n    model: unrelated-model\n'],
  ['legacy block', 'agent-default-model:\n  provider: valid-provider\n  model: valid-model\nother:\n  model: unrelated-model\n'],
  ['CRLF and quoted scalars', '- id: agent-default-model # default route\r\n  config:\r\n    provider: "valid-provider" # provider\r\n    model: \'valid-model\' # model\r\n'],
]) {
  await check(name + ' retries with paired default provider/model', async () => {
    const result = await run(settings)
    assert.equal(result.result, 'fallback-result')
    assert.equal(result.calls.length, 2)
    assert.equal(result.calls[1].implementation, 'spawn')
    assert.equal(result.calls[1].options.provider, 'valid-provider')
    assert.equal(result.calls[1].options.model, 'valid-model')
    assert.equal(result.circuit, undefined)
  })
}

await check('fallback preserves non-spawn registered implementation and lane effort', async () => {
  const result = await run('agent-default-model:\n  provider: valid-provider\n  model: valid-model\n', ['custom-runner'], { subagentProvider: 'broken-provider', subagentModel: 'bad-model', subagentReasoningEffortShort: 'high' })
  assert.equal(result.result, 'fallback-result')
  assert.equal(result.calls[1].implementation, 'custom-runner')
  assert.equal(result.calls[1].options.reasoningEffort, 'high')
})

for (const [name, settings] of [
  ['missing default', '- id: other\n  config:\n    provider: valid-provider\n    model: valid-model\n'],
  ['missing provider', 'agent-default-model:\n  model: valid-model\n'],
  ['incomplete profile', '- id: agent-default-model\n  config:\n    provider: valid-provider\n- id: other\n  config:\n    model: valid-model\n'],
  ['incomplete legacy block', 'agent-default-model:\n  provider: valid-provider\nother:\n  model: valid-model\n'],
]) {
  await check(name + ' cannot borrow another plugin model', async () => {
    const result = await run(settings)
    assert.equal(result.result, '')
    assert.equal(result.calls.length, 1)
    assert.match(result.circuit.reason, /UNKNOWN_MODEL/)
  })
}
for (const defaults of [
  '- id: agent-default-model\n  config:\n    provider: valid-provider\n    model: valid-model\n',
  'agent-default-model:\n  provider: valid-provider\n  model: valid-model\n',
]) {
  await check('shared parser preserves default-route water window lookup', async () => {
    const models = defaults.startsWith('- ')
      ? '- id: llm-pi-ai\n  config:\n    providers:\n      valid-provider:\n        models:\n          - id: valid-model\n            contextWindow: 1000000\n'
      : 'llm:\n  valid-provider:\n    models:\n      - id: valid-model\n        contextWindow: 1000000\n'
    const settings = defaults + models
    const context = vm.createContext({ Date, parseModelWindowsPre, pickWindowPre, readSettingsTextPre: async () => settings })
    vm.runInContext(source.slice(parserStart, parserEnd), context)
    const waterStart = source.indexOf("  async resolveWaterWindow(providerOverride = '', modelOverride = '') {")
    const waterEnd = source.indexOf('  /** 会话级水位记录', waterStart)
    const engine = vm.runInContext('new (class { ' + source.slice(waterStart, waterEnd) + ' })()', context)
    engine.config = {}
    const result = await engine.resolveWaterWindow()
    assert.equal(result.window, 1000000)
    assert.equal(result.source, 'auto:valid-provider/valid-model')
  })
}
if (failed) process.exitCode = 1

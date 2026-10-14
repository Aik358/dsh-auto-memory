import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'
import { EventEmitter } from 'node:events'
import { randomBytes } from 'node:crypto'
import { makeRequestFramePre } from '../../lib/m7-wire.js'

const source = fs.readFileSync(new URL('../../lib/index.js', import.meta.url), 'utf8')
let kills = 0, tick, restarts = 0
const stream = () => new EventEmitter()
const child = { stdin: stream(), stdout: stream(), stderr: stream(), exitCode: null, on() {}, kill() { kills++; this.exitCode = 0 } }
child.stdin.write = () => {}
const engine = { config: {}, _pyHealthProbes: new Set(), _pyRtGeneration: 0, _healthProbeSpawn: () => child, _pythonSidecar: { restart: () => { restarts++ } } }
const env = { engine, Date, String, JSON, Promise, randomBytes, makeRequestFramePre,
  resolveWorkerScriptPathPre: () => '/fixture/worker.py', defaultWorkerScriptPathPre: () => '/fixture/worker.py', existsSync: () => true,
  resolveDshHomePre: () => '/fixture/home', setTimeout: fn => { tick = fn } }
vm.createContext(env)
const invalidation = source.indexOf('  engine.invalidatePythonRuntime = (reason) => {')
vm.runInContext(source.slice(invalidation, source.indexOf('  /**', invalidation)), env)
const start = source.indexOf('  engine._probeWorkerHealthOnce = async (pyPath) => {')
vm.runInContext(source.slice(start, source.indexOf('  engine.__homedirFn', start)), env)
const pending = engine._probeWorkerHealthOnce('fixture-python')
assert.equal(engine._pyHealthProbes.size, 1)
engine.invalidatePythonRuntime('uninstall')
assert.equal(kills, 1, 'invalidation stops the independent health probe before deleting files')
assert.equal(restarts, 1); tick()
const result = await pending
assert.equal(result.ready, false); assert.match(result.reason, /取消/); assert.equal(engine._pyHealthProbes.size, 0)
console.log('PASS #415 independent health processes share configuration and uninstall cancellation')

import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { syncBuiltinESMExports } from 'node:module'
import { loadIsolatedEngine } from '../lib/load-isolated-engine.mjs'

const repo = process.env.AUDIT_TEST_REPO || path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'dam-hub-actual-feed-'))
Object.assign(process.env, { HOME: home, USERPROFILE: home, DSH_HOME: home })
globalThis.fetch = async () => { throw new Error('offline regression') }
fs.writeFileSync(path.join(home, 'dsh-auto-memory.json'), JSON.stringify({ memoryRoot: path.join(home, 'projects'), userMemoryDir: path.join(home, 'user'), memoryHubEnabled: true, globalBriefEnabled: false }))
const intervals = [], effects = [], originalRename = fs.renameSync, originalInterval = globalThis.setInterval
let writes = 0, engine, oldLoad, MemoryEngine
fs.renameSync = (...args) => { if (path.basename(String(args[1])) === 'facts.json') writes++; return originalRename(...args) }
syncBuiltinESMExports()
globalThis.setInterval = (fn, ...args) => { intervals.push(fn); return originalInterval(fn, ...args) }
const waitFor = async predicate => {
  for (let i = 0; i < 100; i++) { if (predicate()) return; await new Promise(r => setTimeout(r, 10)) }
  assert.fail('ordinary host callback did not settle')
}
try {
  const mod = await loadIsolatedEngine(home, repo)
  MemoryEngine = mod.MemoryEngine; oldLoad = MemoryEngine.prototype.loadConfigSync
  MemoryEngine.prototype.loadConfigSync = function () { engine = this; return oldLoad.call(this) }
  const noop = () => () => {}
  mod.apply({ get: () => undefined, on: noop, effect: fn => effects.push(fn()), systemPrompt: { context: noop, section: noop }, tools: { register: noop }, webServer: { register: noop } }, {})
  const pending = [...(engine.runtimes?.values() || [])].map(rt => engine._refreshChains?.get(rt)).filter(Boolean)
  await Promise.allSettled(pending)
  const tick = intervals.find(fn => fn.name === 'hubFeedTick')
  assert.equal(typeof tick, 'function')
  // Exercise the actual lazy scope resolver: only the separate old hub has
  // ownership evidence, and its selected legacy bucket uses canonical spelling.
  const workspace = path.join(home, 'workspace'), alias = path.join(home, 'workspace-alias')
  fs.mkdirSync(workspace); fs.symlinkSync(workspace, alias, process.platform === 'win32' ? 'junction' : 'dir')
  const oldKey = '--' + workspace.replace(/[\\/:*?"<>|]/g, '-') + '--'
  const legacy = path.join(home, 'memory', 'workspaces', oldKey)
  fs.mkdirSync(path.join(legacy, 'hub'), { recursive: true })
  const original = JSON.stringify({ schemaVersion: 1, procedures: [{ procedureId: 'preserved-ordinary-procedure', scope: 'workspace', workspaceRef: oldKey, provenance: ['synthetic-original'] }] })
  fs.writeFileSync(path.join(legacy, 'hub', 'procedures.json'), original)
  fs.writeFileSync(path.join(legacy, '.workspace-identity.json'), JSON.stringify({ schemaVersion: 1, workspace }))
  engine.state.ws = alias
  const recovered = engine._scopedProcedureIo.load()
  assert.equal(recovered.procedures[0].workspaceRef, engine.wsKey(alias))
  assert.equal(recovered.procedures[0].procedureId, 'preserved-ordinary-procedure')
  assert.deepEqual(recovered.procedures[0].provenance, ['synthetic-original'])
  assert.equal(fs.readFileSync(path.join(legacy, 'hub', 'procedures.json'), 'utf8'), original)
  assert.equal(engine.state.workspaceMigration?.blocked, undefined)
  console.log('PASS #179 actual apply own hub receipt and canonical alias migration preserve scope, IDs, provenance and original bytes')

  const semantic = path.join(home, 'memory', 'semantic'), shadow = path.join(semantic, 'judgement-shadow.jsonl')
  fs.mkdirSync(semantic, { recursive: true }); fs.writeFileSync(shadow, '')
  tick() // register current empty cursor; no replay of history
  const rows = ['A', 'B'].map(s => ({ kindCandidate: 'semantic_candidate', observationId: 'ordinary-timer-' + s, scope: 'User', sourceIds: ['synthetic-source-' + s], subject: 'Synthetic timer project ' + s, predicate: 'uses', object: 'Synthetic configuration ' + s, confidence: 0.7 }))
  fs.writeFileSync(shadow, rows.map(r => JSON.stringify(r)).join('\n') + '\n')
  const beforeWrites = writes; tick()
  await waitFor(() => engine._factStore.query().length === 2)
  assert.equal(writes - beforeWrites, 1)
  assert.equal(engine._memoryHub.getStats().consumedSemantic, 2)
  console.log('PASS #274 actual hubFeedTick enriches and commits two rows with exactly one facts rename')

  // Pause the actual async enrichment, dispose, then release it. No late feed
  // may enter the store after the host has revoked its lifetime.
  let release, entered = false
  const pause = new Promise(resolve => { release = resolve })
  const resolvePaths = engine.resolvePaths
  engine.resolvePaths = async function (...args) { entered = true; await pause; return resolvePaths.apply(this, args) }
  const late = { ...rows[0], observationId: 'late-after-dispose', subject: 'Synthetic late timer project' }
  fs.appendFileSync(shadow, JSON.stringify(late) + '\n'); tick()
  await waitFor(() => entered)
  engine._disposed = true
  const beforeLate = writes; release()
  await new Promise(r => setTimeout(r, 50))
  assert.equal(writes, beforeLate); assert.equal(engine._factStore.query().length, 2)
  engine.resolvePaths = resolvePaths
  console.log('PASS actual timer async enrichment cannot feed after disposal')
} finally {
  const pending = [...(engine?.runtimes?.values() || [])].map(rt => engine._refreshChains?.get(rt)).filter(Boolean)
  for (const dispose of effects) if (typeof dispose === 'function') dispose()
  await Promise.allSettled(pending)
  if (MemoryEngine && oldLoad) MemoryEngine.prototype.loadConfigSync = oldLoad
  globalThis.setInterval = originalInterval; fs.renameSync = originalRename; syncBuiltinESMExports()
  fs.rmSync(home, { recursive: true, force: true })
}

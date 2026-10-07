import assert from 'node:assert/strict'
import * as fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { spawnSync } from 'node:child_process'
import { fileURLToPath, pathToFileURL } from 'node:url'
import test from 'node:test'
import { loadIsolatedEngine } from '../lib/load-isolated-engine.mjs'

const home = await fs.mkdtemp(path.join(os.tmpdir(), 'dam-backend-followup-'))
Object.assign(process.env, { HOME: home, USERPROFILE: home, DSH_HOME: home })
globalThis.fetch = async () => { throw new Error('offline regression') }
const repo = process.env.AUDIT_TEST_REPO || path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const mod = await loadIsolatedEngine(home, repo)
const { MemoryEngine, DEFAULT_CONFIG } = mod
const engine = () => {
  const e = new MemoryEngine()
  e.configLoaded = true
  e.config = { ...DEFAULT_CONFIG, memoryRoot: path.join(home, 'memory'), userMemoryDir: path.join(home, 'user'), criteriaGate: false, boardMode: 'graph', handoffEnabled: false }
  return e
}
const legacyKey = ws => '--' + String(ws).replace(/[\\/:*?"<>|]/g, '-') + '--'

test('#179 distinct physical workspaces retain independent notes and PLAN', async () => {
  const e = engine(), a = path.join(home, 'foo-bar'), b = path.join(home, 'foo', 'bar')
  await fs.mkdir(a); await fs.mkdir(b, { recursive: true })
  const pa = await e.resolvePaths({ session: { header: { cwd: a } } }), pb = await e.resolvePaths({ session: { header: { cwd: b } } })
  assert.notEqual(e.wsKey(a), e.wsKey(b))
  assert.notEqual(pa.notesPath, pb.notesPath); assert.notEqual(pa.planPath, pb.planPath)
  await fs.mkdir(pa.projectDir, { recursive: true }); await fs.mkdir(pb.projectDir, { recursive: true })
  await fs.writeFile(pa.notesPath, 'Workspace A personal project note')
  assert.equal(await e.readTextSafe(pb.notesPath), '')
  const alias = path.join(home, 'workspace-alias')
  await fs.symlink(a, alias, process.platform === 'win32' ? 'junction' : 'dir')
  assert.equal(e.wsKey(alias), e.wsKey(a))
  assert.equal(e.wsKey(a + path.sep), e.wsKey(a))
})

test('#179 unowned legacy library gives actionable state while personal memory works', async () => {
  const e = engine(), ws = path.join(home, 'legacy-project'), agent = { session: { header: { cwd: ws } } }
  await fs.mkdir(ws)
  const old = path.join(e.config.memoryRoot, legacyKey(ws))
  await fs.mkdir(old, { recursive: true }); await fs.writeFile(path.join(old, 'MEMORY.md'), 'Historical original bytes')
  await fs.mkdir(e.config.userMemoryDir, { recursive: true }); await fs.writeFile(path.join(e.config.userMemoryDir, 'MEMORY.md'), 'Personal preserved')
  await assert.rejects(e.resolvePaths(agent), { code: 'WORKSPACE_LEGACY_OWNER_REQUIRED' })
  const personal = await e.resolvePaths(agent, { personalOnly: true })
  assert.equal(await e.readTextSafe(personal.userFile), 'Personal preserved')
  await e._doRefresh(agent)
  const snap = await e.snapshot(agent)
  assert.equal(snap.workspaceMigration.blocked, true)
  assert.equal(snap.userText, 'Personal preserved'); assert.equal(snap.projectDir, '')
  assert.match(snap.workspaceMigration.message, /原目录=.*目标目录=/)
  assert.equal((await e.ensureBudget(agent, 'user', 'A fresh personal preference')).ok, true)
  assert.equal(await fs.readFile(path.join(old, 'MEMORY.md'), 'utf8'), 'Historical original bytes')
  await fs.writeFile(path.join(old, '.workspace-identity.json'), 'null')
  await assert.rejects(e.resolvePaths(agent), { code: 'WORKSPACE_LEGACY_OWNER_REQUIRED' })
  await fs.writeFile(path.join(old, '.workspace-identity.json'), JSON.stringify({ schemaVersion: 1, workspace: path.join(home, 'another-project') }))
  await assert.rejects(e.resolvePaths(agent), { code: 'WORKSPACE_LEGACY_OWNER_REQUIRED' })
  await fs.mkdir(path.join(old, 'hub'))
  const originalProcedures = JSON.stringify({ schemaVersion: 1, procedures: [{procedureId:'stable-original-id',scope:'workspace',workspaceRef:legacyKey(ws),provenance:['original-source']}] })
  await fs.writeFile(path.join(old,'hub','procedures.json'),originalProcedures)
  await fs.writeFile(path.join(old, '.workspace-identity.json'), JSON.stringify({ schemaVersion: 1, workspace: ws }))
  const recovered = await e.resolvePaths(agent)
  assert.notEqual(recovered.projectDir, old)
  const migratedProcedures=JSON.parse(await fs.readFile(path.join(recovered.projectDir,'hub','procedures.json'),'utf8'))
  assert.equal(migratedProcedures.procedures[0].workspaceRef,e.wsKey(ws))
  assert.equal(migratedProcedures.procedures[0].procedureId,'stable-original-id')
  assert.equal(await fs.readFile(path.join(old,'hub','procedures.json'),'utf8'),originalProcedures)
  const { workspaceDirectoryPre } = await import(pathToFileURL(path.join(repo,'lib/workspace-directory.js')))
  const hubRoot=path.join(home,'separate-hub','workspaces'),oldHub=path.join(hubRoot,legacyKey(ws),'hub')
  await fs.mkdir(oldHub,{recursive:true});await fs.writeFile(path.join(oldHub,'procedures.json'),originalProcedures)
  const hubDirectory=workspaceDirectoryPre(hubRoot,ws,{ownerFile:path.join(old,'.workspace-identity.json')})
  assert.equal(JSON.parse(await fs.readFile(path.join(hubDirectory,'hub','procedures.json'),'utf8')).procedures[0].workspaceRef,e.wsKey(ws))
  assert.equal(await fs.readFile(path.join(oldHub,'procedures.json'),'utf8'),originalProcedures)
  assert.equal(await fs.readFile(recovered.notesPath, 'utf8'), 'Historical original bytes')
  assert.equal(await fs.readFile(path.join(old, 'MEMORY.md'), 'utf8'), 'Historical original bytes')
  // New user changes are never overwritten by a later resolve/restart.
  await fs.writeFile(recovered.notesPath, 'New authoritative bytes')
  assert.equal(await fs.readFile((await engine().resolvePaths(agent)).notesPath, 'utf8'), 'New authoritative bytes')
})

test('#268 ordinary stale revision keeps both candidates in admitted conflict directory', async () => {
  const e = engine(), project = path.join(home, 'plan-project')
  assert.equal((await e.writePlanSnapshot(project, '## Original\nCurrent project facts and details remain intact.\n')).ok, true)
  const plan = path.join(project, 'handoff', 'PLAN.md'), before = await fs.readFile(plan, 'utf8')
  const result = await e.writePlanSnapshot(project, '## Proposed\nA newer proposal contains ordinary project details.\n', { expectedRevision: 'stale' })
  assert.equal(result.ok, false); assert.ok(result.conflictPath)
  const artifact = JSON.parse(await fs.readFile(result.conflictPath, 'utf8'))
  assert.equal(artifact.current, before); assert.match(artifact.proposed, /newer proposal/)
  assert.equal(await fs.readFile(plan, 'utf8'), before)
  // An occupied derived path is an ordinary filesystem failure, not a missing directory.
  await fs.rm(path.join(project, 'handoff', 'conflicts'), { recursive: true })
  await fs.writeFile(path.join(project, 'handoff', 'conflicts'), 'occupied')
  assert.equal((await e.writePlanSnapshot(project, 'proposal', { expectedRevision: 'stale' })).ok, false)
  assert.equal(await fs.readFile(plan, 'utf8'), before)
})

test('#179 late personal recovery read cannot publish after disposal', async () => {
  const e = engine(), ws = path.join(home, 'late-recovery'), old = path.join(e.config.memoryRoot, legacyKey(ws))
  await fs.mkdir(ws); await fs.mkdir(old, { recursive: true })
  await fs.writeFile(path.join(old, 'MEMORY.md'), 'Original workspace bytes')
  e.state.userText = 'Existing in-memory personal state'
  let entered, release
  const enteredPromise = new Promise(resolve => { entered = resolve })
  const barrier = new Promise(resolve => { release = resolve })
  const read = e.readTextSafe.bind(e)
  e.readTextSafe = async file => { entered(); await barrier; return read(file) }
  const pending = e._doRefresh({ session: { header: { cwd: ws } } })
  await enteredPromise; e._disposed = true; release()
  await pending.catch(error => { assert.equal(error.code, 'PLUGIN_DISPOSED') })
  assert.equal(e.state.userText, 'Existing in-memory personal state')
})

test('#268 derived conflict path admission is performed before artifact IO', async () => {
  // Deterministic boundary test of the ordinary CAS path. No out-of-root file
  // is created; a directory alias already exists only as a local fixture.
  const e = engine(), project = path.join(home, 'plan-alias-case'), other = path.join(home, 'other-artifacts')
  await fs.mkdir(other)
  await e.writePlanSnapshot(project, '## Stable\nStable full project facts before a stale ordinary save.\n')
  const plan = path.join(project, 'handoff', 'PLAN.md'), before = await fs.readFile(plan, 'utf8')
  await fs.symlink(other, path.join(project, 'handoff', 'conflicts'), process.platform === 'win32' ? 'junction' : 'dir')
  const result = await e.writePlanSnapshot(project, '## Candidate\nRejected ordinary update retains its source.\n', { expectedRevision: 'stale' })
  assert.equal(result.ok, false); assert.match(result.error, /outside-root/)
  assert.deepEqual(await fs.readdir(other), []); assert.equal(await fs.readFile(plan, 'utf8'), before)
})

test('#269 failed child startup returns structured diagnostic and the process survives', async () => {
  const childFile = path.join(home, 'health-case.mjs')
  await fs.writeFile(childFile, `
    import {loadIsolatedEngine} from ${JSON.stringify(pathToFileURL(path.join(repo, 'tests/lib/load-isolated-engine.mjs')).href)}
    import fs from 'node:fs/promises'; import path from 'node:path'; import assert from 'node:assert/strict'
    const home = process.env.DSH_HOME; globalThis.fetch = async () => {throw Error('offline')}
    const {apply,MemoryEngine} = await loadIsolatedEngine(home, ${JSON.stringify(repo)})
    let engine; const load=MemoryEngine.prototype.loadConfigSync
    MemoryEngine.prototype.loadConfigSync=function(){engine=this;return load.call(this)}
    await fs.writeFile(path.join(home,'dsh-auto-memory.json'),JSON.stringify({memoryRoot:path.join(home,'memory'),userMemoryDir:path.join(home,'user'),globalBriefEnabled:false}))
    const effects=[], noop=()=>()=>{}
    apply({get:()=>undefined,on:noop,effect:fn=>effects.push(fn()),systemPrompt:{context:noop,section:noop},tools:{register:noop},webServer:{register:noop}}, {})
    try { const result=await engine._probeWorkerHealthOnce(path.join(home,'interpreter-unavailable.exe')); assert.equal(result.ok,false); assert.match(result.reason,/ENOENT|worker/); assert(result.ms<5000); console.log('STRUCTURED_SURVIVED',JSON.stringify(result)) }
    finally {for(const dispose of effects)dispose()}
  `)
  const childHome = await fs.mkdtemp(path.join(home, 'health-home-'))
  const result = spawnSync(process.execPath, [childFile], { env: { ...process.env, HOME: childHome, USERPROFILE: childHome, DSH_HOME: childHome }, windowsHide: true, encoding: 'utf8', timeout: 10000 })
  assert.equal(result.status, 0, result.stdout + result.stderr)
  assert.match(result.stdout, /STRUCTURED_SURVIVED/)
})

test('#236 POSIX-style case-distinct source and sidecar identities stay distinct', async () => {
  const { canonicalScopeGuard } = await import(pathToFileURL(path.join(repo, 'lib/m4-corpus.js')))
  const source = path.join(home, 'CaseWorkspace', 'MEMORY.md')
  const wrong = path.join(home, 'caseworkspace', 'MEMORY.md')
  const io = { realpathSync: p => p === path.dirname(source) ? path.dirname(source) : wrong }
  const result = canonicalScopeGuard({ file: source }, source, io)
  if (process.platform === 'win32') assert.equal(result.ok, true)
  else assert.equal(result.ok, false)
  const normal = canonicalScopeGuard({ file: source }, source, { realpathSync: p => p })
  assert.equal(normal.ok, true)
  const sibling = canonicalScopeGuard({ file: source }, source, { realpathSync: p => p === path.dirname(source) ? p : path.join(home, 'CaseWorkspace-other', 'MEMORY.md') })
  assert.equal(sibling.ok, false)
})

test.after(async () => { await fs.rm(home, { recursive: true, force: true }) })

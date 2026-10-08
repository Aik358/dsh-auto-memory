import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { MemoryEngine, flushDiagnostics } from '../lib/state-engine.mjs'
import { continuedSourceState, recoverContinuedSource } from '../../lib/continuation-state.js'

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'dam-207-create-'))
const previousHome = process.env.DSH_HOME
process.env.DSH_HOME = home
const workspace = path.join(home, 'workspace')
fs.mkdirSync(workspace)
let created = 0, delivered = 0
function engineFor(source, create) {
  const dir = path.join(home, 'sessions', 'project', source)
  fs.mkdirSync(dir, {recursive:true})
  fs.writeFileSync(path.join(dir, 'session.jsonl'), [
    JSON.stringify({cwd:workspace, agentPreset:'default'}),
    JSON.stringify({type:'request/header', data:{header:{config:{provider:'fixture', model:'fixture-model'}}}}),
    JSON.stringify({type:'user/message', data:{message:{role:'user', content:[{type:'text', text:'continue isolated task'}]}}}),
  ].join('\n') + '\n')
  const engine = new MemoryEngine()
  engine.config = {...engine.config, memoryRoot:path.join(home, 'memory'), userMemoryDir:path.join(home, 'user'), handoffEnabled:false, autoContinueEnabled:true}
  engine.configLoaded = true
  engine.resolveWorkspaceIdForSession = () => 'workspace-source'
  engine.inheritPermissionForContinue = async () => ({ok:false})
  engine._sessionController = {create, cancel:async () => {}, rename:async () => {}, selectModel:async r => ({selected:{provider:r.provider,model:r.model}}), prompt:async request => {
    if (request.sessionId !== source) delivered++
  }}
  return engine
}
const record = (engine, source) => continuedSourceState(engine.continuedSessionsFile(), engine.waterKey(source))
try {
  // DSH 0.2.0-rc.2 create first ensures a session, then attaches its workspace.
  // The actual attach-failed contract supplies the already created raw ID.
  const source = 'session-attach-source'
  const attachFailure = async args => {
    const id = 'session-created-' + (++created)
    fs.writeFileSync(path.join(home, id + '.json'), JSON.stringify({id, cwd:workspace}))
    throw Object.assign(Error('session was created but could not attach to workspace'), {code:'session/workspace-attach-failed', details:{sessionId:id, workspaceId:args.workspaceId}})
  }
  const engine = engineFor(source, attachFailure)
  const failed = await engine.decideAutoContinue('manual', null, source)
  assert.equal(failed.ok, false)
  assert.equal(failed.continuationPending, true)
  assert.equal(failed.sessionId, 'session-created-1')
  assert.equal(created, 1)
  assert.equal(delivered, 0)
  assert.equal(record(engine, source).to, 'session-created-1')
  const restarted = engineFor(source, attachFailure)
  assert.equal((await restarted.decideAutoContinue('manual', null, source)).continuationPending, true)
  assert.equal(restarted.autoContinueState(source).pending.successorId, 'session-created-1')
  assert.equal(created, 1)
  console.log('PASS attach-failed retains the created raw successor, avoids fallback/delivery and blocks duplicate creation after restart')

  const unknownSource = 'session-unknown-create'
  const unknown = engineFor(unknownSource, async () => {created++; throw Error('creation response lost')})
  const unknownResult = await unknown.decideAutoContinue('manual', null, unknownSource)
  assert.equal(unknownResult.ok, false)
  assert.equal(unknownResult.continuationPending, true)
  assert.equal(unknownResult.sessionId, '')
  assert.equal(created, 2)
  const pending = record(unknown, unknownSource)
  assert.equal(pending.status, 'pending')
  assert.equal(pending.to, undefined)
  assert.equal((await engineFor(unknownSource, unknown._sessionController.create).decideAutoContinue('manual', null, unknownSource)).continuationPending, true)
  assert.equal(created, 2)
  await assert.rejects(recoverContinuedSource(unknown.continuedSessionsFile(), unknown.waterKey(unknownSource), {action:'release', token:pending.token, expectedSuccessor:'', confirmed:false}))
  await recoverContinuedSource(unknown.continuedSessionsFile(), unknown.waterKey(unknownSource), {action:'release', token:pending.token, expectedSuccessor:'', confirmed:true})
  assert.equal(record(unknown, unknownSource), null)
  console.log('PASS unknown creation without an ID remains pending across restart and requires explicit verified recovery')

  let calls = 0
  const missingSource = 'session-missing-workspace'
  const missing = engineFor(missingSource, async args => {
    calls++
    if (args.workspaceId) throw Object.assign(Error('workspace not found'), {code:'workspace/not-found', details:{workspaceId:args.workspaceId}})
    assert.equal(args.cwd, workspace)
    return {sessionId:'session-cwd-successor'}
  })
  assert.equal((await missing.decideAutoContinue('manual', null, missingSource)).ok, true)
  assert.equal(calls, 2)
  assert.equal(record(missing, missingSource).status, 'done')
  console.log('PASS verified pre-create workspace/not-found retains the source cwd fallback')

  const mismatched = engineFor('session-mismatched-error', async () => {calls++; throw Object.assign(Error('workspace not found'), {code:'workspace/not-found', details:{workspaceId:'another-workspace'}})})
  const mismatch = await mismatched.decideAutoContinue('manual', null, 'session-mismatched-error')
  assert.equal(mismatch.continuationPending, true)
  assert.equal(calls, 3)
  const fallbackUnknown = engineFor('session-fallback-unknown', async args => {
    calls++
    if (args.workspaceId) throw Object.assign(Error('workspace not found'), {code:'workspace/not-found', details:{workspaceId:args.workspaceId}})
    throw Error('fallback creation result unknown')
  })
  assert.equal((await fallbackUnknown.decideAutoContinue('manual', null, 'session-fallback-unknown')).continuationPending, true)
  assert.equal(calls, 5)
  assert.equal(record(fallbackUnknown, 'session-fallback-unknown').status, 'pending')
  console.log('PASS mismatched failure identity and uncertain cwd fallback retain pending reservations')
} finally {
  await flushDiagnostics()
  if (previousHome === undefined) delete process.env.DSH_HOME
  else process.env.DSH_HOME = previousHome
  fs.rmSync(home, {recursive:true, force:true})
}

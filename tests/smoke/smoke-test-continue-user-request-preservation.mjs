/** Full production replay: unfinished requests survive bounded transfer summaries. */
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { zstdCompressSync } from 'node:zlib'

const home = await mkdtemp(path.join(tmpdir(), 'dam-request-preservation-'))
process.env.DSH_HOME = home
process.env.USERPROFILE = home
process.env.HOME = home
const { MemoryEngine, flushDiagnostics } = await import('../lib/state-engine.mjs')
let passed = 0, failed = 0, serial = 0
async function check(name, run) {
  try { await run(); passed++; console.log('ok - ' + name) }
  catch (error) { failed++; console.error('not ok - ' + name + ': ' + error.message) }
}
async function fixture(requests, toolCount = 0, withHandoff = false) {
  const sid = 'request-source-' + serial++
  const workspace = path.join(home, sid)
  const handoffDir = path.join(workspace, 'handoff')
  const sessionDir = path.join(home, 'sessions', 'project', sid)
  await mkdir(workspace, { recursive: true })
  await mkdir(sessionDir, { recursive: true })
  const events = [{ cwd: workspace }]
  events.push({ seq: events.length, type: 'request/header', data: { header: { config: { provider: 'fixture', model: 'fixture-model' } } } })
  for (const text of requests) events.push({ seq: events.length, type: 'user/message', data: { message: { role: 'user', content: [{ type: 'text', text }] } } })
  for (let i = 0; i < toolCount; i++) {
    events.push({ seq: events.length, type: 'tool/call', data: { name: 'read', arguments: { path: 'input.txt' } } })
    events.push({ seq: events.length, type: 'tool/result', data: { message: { role: 'tool', content: [{ type: 'text', text: 'prepared input ' + i }] } } })
  }
  await writeFile(path.join(sessionDir, 'session.v3.jsonl.zstd'), zstdCompressSync(Buffer.from(events.map(e => JSON.stringify(e)).join('\n') + '\n')))
  const e = new MemoryEngine()
  e.config = { handoffEnabled: withHandoff, autoContinueEnabled: true, autoContinueRefreshRitual: false }
  e.resolvePathsForSession = async () => ({ ws: workspace, wsBound: true, handoffDir, planPath: path.join(handoffDir, 'PLAN.md') })
  e.resolveWorkspaceIdForSession = () => 'fixture-' + sid
  e.inheritPermissionForContinue = async () => ({ ok: true })
  const calls = []
  e._sessionController = {
    cancel: async () => calls.push('cancel'),
    create: async () => { calls.push('create'); return { sessionId: sid + '-next' } },
    selectModel: async r => ({ selected: { provider: r.provider, model: r.model } }),
    prompt: async r => calls.push({ session: r.sessionId, text: r.content[0].text }),
  }
  if (withHandoff) {
    await mkdir(handoffDir, { recursive: true })
    await writeFile(path.join(handoffDir, 'PLAN.md'), 'Existing project description; not the current request.')
  }
  return { e, sid, workspace, handoffDir, calls }
}

try {
  for (const [name, request, tools] of [
    ['2000-character request', 'x'.repeat(1996) + 'GOAL', 0],
    ['2001-character request with goal at the end', 'x'.repeat(1997) + 'GOAL', 0],
    ['tool-heavy unfinished task', 'context'.repeat(400) + 'CURRENT_UNFINISHED_GOAL', 12],
    ['request longer than the transcript and prompt budgets', 'context'.repeat(11000) + 'CURRENT_UNFINISHED_GOAL', 12],
  ]) {
    await check(name, async () => {
      const f = await fixture([request], tools)
      const pack = await f.e.buildContinueCarry(f.sid)
      assert.equal(pack.ok, true)
      assert(pack.userRequestsPath, 'readable unabridged request path is required')
      const raw = await readFile(pack.userRequestsPath, 'utf8')
      assert(raw.includes(request), 'entire request, including its final constraints, survives')
      assert(pack.carryText.includes(pack.userRequestsPath), 'lossless path is in delivered navigation')
      assert(pack.carryText.length <= 18000, 'first-turn prompt retains its existing budget')
      const result = await f.e.decideAutoContinue('manual', null, f.sid)
      assert.equal(result.ok, true)
      assert.equal(f.calls.filter(c => c === 'cancel').length, 1)
      const delivered = f.calls.find(c => c && typeof c === 'object' && c.session === f.sid + '-next')
      assert(delivered?.text.includes('用户请求全文'), 'manual delivery identifies the unabridged source')
    })
  }
  await check('earlier task survives later brief continuation and ritual messages', async () => {
    const request = 'context'.repeat(400) + 'EARLIER_UNFINISHED_TASK'
    const f = await fixture([request, 'Continue the unfinished task.', 'Only refresh PLAN and reply 已刷新.'], 12)
    const pack = await f.e.buildContinueCarry(f.sid)
    const raw = await readFile(pack.userRequestsPath, 'utf8')
    for (const text of [request, 'Continue the unfinished task.', 'Only refresh PLAN and reply 已刷新.']) assert(raw.includes(text))
    assert(raw.indexOf(request) < raw.indexOf('Continue the unfinished task.'))
  })
  await check('later packing does not overwrite a returned full-request path', async () => {
    const f = await fixture(['context'.repeat(400) + 'IMMUTABLE_UNFINISHED_TASK'], 12)
    const first = await f.e.buildContinueCarry(f.sid)
    const before = await readFile(first.userRequestsPath, 'utf8')
    const second = await f.e.buildContinueCarry(f.sid)
    assert.notEqual(first.userRequestsPath, second.userRequestsPath)
    assert.equal(await readFile(first.userRequestsPath, 'utf8'), before)
  })
  await check('request originals do not crowd out transcript or ledger retrieval slots', async () => {
    const f = await fixture(['context'.repeat(400) + 'READ_ON_DEMAND_TASK'], 12)
    const pack = await f.e.buildContinueCarry(f.sid)
    const transcripts = await f.e.listPrevSessionTranscripts(f.handoffDir)
    const ledgers = await f.e.listHandoffLedgers(f.handoffDir)
    assert(transcripts.includes(path.basename(pack.transcriptPath)))
    assert(!transcripts.includes(path.basename(pack.userRequestsPath)))
    assert(!ledgers.includes(path.basename(pack.userRequestsPath)))
  })
  await check('failed full-request persistence cannot stop the source or silently use PLAN', async () => {
    const f = await fixture(['context'.repeat(400) + 'PRESERVE_BEFORE_CANCEL'], 12, true)
    const first = await f.e.buildContinueCarry(f.sid)
    assert(first.userRequestsPath)
    // Force an actual wx conflict with a file the engine has already returned.
    f.e.allocContSeq = async () => first.contSeq
    const before = await readFile(first.userRequestsPath, 'utf8')
    const result = await f.e.decideAutoContinue('manual', null, f.sid)
    assert.equal(result.ok, false)
    assert.deepEqual(f.calls, [], 'do not cancel/create/prompt when lossless task material could not be committed')
    assert.equal(await readFile(first.userRequestsPath, 'utf8'), before)
  })
} finally {
  await flushDiagnostics()
  await rm(home, { recursive: true, force: true })
}
console.log('RESULT ' + passed + ' PASS / ' + failed + ' FAIL')
if (failed) process.exitCode = 1

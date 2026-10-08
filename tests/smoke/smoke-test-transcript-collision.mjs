// Issue #291: returned layer-3 paths must keep their original source and snapshot.
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawn } from 'node:child_process'

const worker = process.argv[2] === '--worker'
const home = worker ? process.argv[3] : mkdtempSync(path.join(tmpdir(), 'dam-transcript-collision-'))
for (const key of ['DSH_HOME', 'USERPROFILE', 'HOME']) process.env[key] = home
globalThis.fetch = async () => { throw new Error('unexpected network access') }
const { MemoryEngine, flushDiagnostics } = await import('../lib/state-engine.mjs')
const workspace = path.join(home, 'workspace')
const handoffDir = path.join(home, 'handoff')
const a = 'session-aaaaaaaa-1111-4111-8111-111111111111'
const b = 'session-abbbbbbb-2222-4222-8222-222222222222'
const RealDate = Date
let instant = '2026-10-08T12:00:00.000Z'
globalThis.Date = class extends RealDate {
  constructor(...args) { super(...(args.length ? args : [instant])) }
  static now() { return RealDate.parse(instant) }
}

function engine() {
  const e = new MemoryEngine()
  e.config = { handoffEnabled: false, autoContinueEnabled: true }
  e.resolvePathsForSession = async () => ({ ws: workspace, wsBound: true, handoffDir, planPath: path.join(handoffDir, 'PLAN.md') })
  e.resolveWorkspaceIdForSession = () => 'fixture-workspace'
  return e
}

function session(sid, marker, role = 'user') {
  const dir = path.join(home, 'sessions', 'project', sid)
  mkdirSync(dir, { recursive: true })
  writeFileSync(path.join(dir, 'session.jsonl'), [
    JSON.stringify({ cwd: workspace }),
    JSON.stringify({ type: role + '/message', data: { message: { role, content: [{ type: 'text', text: marker }] } } }),
  ].join('\n') + '\n')
}

const retained = []
function retain(carry, sid, marker) {
  assert.equal(carry.ok, true)
  assert.equal(carry.prevSessionId, sid)
  assert.ok(carry.transcriptPath)
  assert.ok(carry.carryText.includes(carry.transcriptPath), 'layer 3 references the returned file')
  const body = readFileSync(carry.transcriptPath, 'utf8')
  assert.ok(body.includes(sid) && body.includes(marker), 'file contains this source and snapshot')
  retained.push([carry.transcriptPath, body])
  assert.ok(carry.userRequestsPath && carry.carryText.includes(carry.userRequestsPath))
  const requests = readFileSync(carry.userRequestsPath, 'utf8')
  assert.ok(requests.includes(sid) && requests.includes(marker))
  retained.push([carry.userRequestsPath, requests])
}

function unchanged() {
  for (const [file, body] of retained) assert.equal(readFileSync(file, 'utf8'), body, 'returned snapshot was overwritten: ' + file)
  assert.equal(new Set(retained.map(([file]) => file)).size, retained.length, 'each generation has a separate path')
}

function child(sid) {
  return new Promise((resolve, reject) => {
    const cp = spawn(process.execPath, [fileURLToPath(import.meta.url), '--worker', home, sid], { env: process.env, windowsHide: true })
    let out = '', err = ''
    cp.stdout.on('data', (s) => { out += s })
    cp.stderr.on('data', (s) => { err += s })
    cp.on('error', reject)
    cp.on('close', (code) => {
      if (code !== 0) return reject(new Error('worker failed: ' + err + out))
      try { resolve(JSON.parse(out)) } catch (e) { reject(e) }
    })
  })
}

let pass = 0, fail = 0
async function test(name, fn) {
  try { await fn(); pass++; console.log('  ok - ' + name) }
  catch (e) { fail++; console.error('  FAIL - ' + name + ': ' + e.message) }
}

try {
  if (worker) {
    console.log(JSON.stringify(await engine().buildContinueCarry(process.argv[4])))
  } else {
    mkdirSync(workspace)
    session(a, 'SOURCE_A_ONLY')
    session(b, 'SOURCE_B_ONLY')
    const e = engine()
    await test('normal carry preserves source, content and searchable transcript', async () => {
      const carry = await e.buildContinueCarry(a)
      retain(carry, a, 'SOURCE_A_ONLY')
      assert.ok((await e.listPrevSessionTranscripts(handoffDir)).includes(path.basename(carry.transcriptPath)))
    })
    await test('different sources sharing eight characters in the same second', async () => {
      retain(await e.buildContinueCarry(b), b, 'SOURCE_B_ONLY')
      unchanged()
    })
    await test('same-source same-second retry keeps the earlier snapshot', async () => {
      session(a, 'SOURCE_A_RETRY')
      retain(await e.buildContinueCarry(a), a, 'SOURCE_A_RETRY')
      unchanged()
    })
    await test('same time of day across dates keeps the earlier snapshot', async () => {
      instant = '2026-10-09T12:00:00.000Z'
      session(a, 'SOURCE_A_NEXT_DAY')
      retain(await e.buildContinueCarry(a), a, 'SOURCE_A_NEXT_DAY')
      unchanged()
    })
    await test('parallel independent engines preserve every returned path', async () => {
      const carries = await Promise.all([engine().buildContinueCarry(a), engine().buildContinueCarry(b), engine().buildContinueCarry(a)])
      for (const [i, carry] of carries.entries()) retain(carry, i === 1 ? b : a, i === 1 ? 'SOURCE_B_ONLY' : 'SOURCE_A_NEXT_DAY')
      unchanged()
    })
    await test('parallel processes preserve every returned path', async () => {
      const carries = await Promise.all([child(a), child(b), child(a)])
      for (const [i, carry] of carries.entries()) retain(carry, i === 1 ? b : a, i === 1 ? 'SOURCE_B_ONLY' : 'SOURCE_A_NEXT_DAY')
      unchanged()
    })
    await test('existing output is rejected even if the reserved identity repeats', async () => {
      const first = await e.buildPrevSessionPack(a)
      const before = readFileSync(first.transcriptPath, 'utf8')
      const requestsBefore = readFileSync(first.userRequestsPath, 'utf8')
      // Reach the transcript wx guard without first colliding with the independent user artifact.
      session(a, 'MUST_NOT_REPLACE_EXISTING', 'assistant')
      const collision = engine()
      collision.allocContSeq = async () => first.contSeq
      assert.equal(await collision.buildPrevSessionPack(a), null, 'collision must not return a successful pack')
      assert.equal(readFileSync(first.transcriptPath, 'utf8'), before)
      assert.equal(readFileSync(first.userRequestsPath, 'utf8'), requestsBefore)
    })
    console.log('[transcript-collision] ' + pass + ' passed, ' + fail + ' failed')
    if (fail) process.exitCode = 1
  }
} finally {
  globalThis.Date = RealDate
  await flushDiagnostics()
  if (!worker) rmSync(home, { recursive: true, force: true })
}


import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import test, { after } from 'node:test'
import { EVENT_STORE_FILENAME } from '../../lib/event-store.js'
import { validatePolicy } from '../../lib/injection/policy-v2.js'
import { buildUserPortraitPre, PORTRAIT_MAX_CHARS } from '../../lib/user-portrait.js'

const dir = await mkdtemp(path.join(tmpdir(), 'dam-batch4-person-'))
const dshDir = path.join(dir, 'dsh')
const personDir = path.join(dshDir, 'memory', 'person')
const personPath = path.join(personDir, EVENT_STORE_FILENAME)
const audit = new URL('../lib/audit-engine.mjs', import.meta.url)
const index = new URL('../../lib/index.js', import.meta.url)
const portrait = new URL('../../lib/user-portrait.js', import.meta.url)
const delivery = new URL('../../lib/injection/unit-delivery.js', import.meta.url)
const originalHome = process.env.DSH_HOME
const originalAuditSource = process.env.DAM_AUDIT_ENGINE_SOURCE
process.env.DSH_HOME = dshDir
delete process.env.DAM_AUDIT_ENGINE_SOURCE
await mkdir(personDir, { recursive: true })
const production = await import(audit)
const copies = [production]
let serial = 0

after(async () => {
  await Promise.all(copies.map(copy => copy.flushDiagnostics()))
  if (originalHome === undefined) delete process.env.DSH_HOME
  else process.env.DSH_HOME = originalHome
  if (originalAuditSource === undefined) delete process.env.DAM_AUDIT_ENGINE_SOURCE
  else process.env.DAM_AUDIT_ENGINE_SOURCE = originalAuditSource
  const resolved = await realpath(dir)
  assert.equal(path.dirname(resolved), await realpath(tmpdir()))
  assert.match(path.basename(resolved), /^dam-batch4-person-/)
  await rm(resolved, { recursive: true, force: true, maxRetries: 5 })
})

const now = Date.parse('2026-11-23T00:00:00Z')
function item(text, stage = 'accepted', kind = 'preference', at = now) {
  return { stage, kind, text, at }
}
function event(id, name, userPercept) {
  return { id, name, status: 'active', createdAt: now, updatedAt: now, summary: name, userPercept }
}
async function writeStore(file, events) {
  await writeFile(file, JSON.stringify({ schema: 'v4_event_store_v1', events }))
}
async function engineFor(host, mode, workspaceItems = []) {
  const ws = 'fixture-' + (++serial)
  const projectDir = path.join(dir, ws)
  const handoffDir = path.join(projectDir, 'handoff')
  await mkdir(handoffDir, { recursive: true })
  await writeStore(path.join(handoffDir, EVENT_STORE_FILENAME), [
    event('evt_00000001', 'WORKSPACE_EVENT_NAME', workspaceItems),
  ])
  const engine = new host.MemoryEngine()
  engine.configLoaded = true
  engine.config.deliveryPolicy = validatePolicy({ schemaVersion: 2, presetId: 'human_full', deliveryMode: mode })
  engine.resolvePaths = async () => ({
    ws, userDir: dshDir, projectDir, handoffDir,
    planPath: path.join(handoffDir, 'PLAN.md'), reflectDir: path.join(projectDir, 'reflections'),
  })
  engine.memToday = () => '2026-11-23'
  Object.assign(engine.state, { ws, _injectTierPre: 'human_full' })
  assert.equal(await engine.refreshEventStatePre(), true)
  return engine
}

const personAccepted = 'PERSON_ACCEPTED_PREFERENCE'
const personUsed = 'PERSON_USED_STATE'
const retrieved = 'PERSON_RETRIEVED_MUST_STAY_OUT'
const delivered = 'PERSON_DELIVERED_MUST_STAY_OUT'
const author = 'PERSON_AUTHOR_RESPONSE'
const projectAccepted = 'WORKSPACE_ACCEPTED_PREFERENCE'

async function seedEligibility() {
  const response = { kind: 'authorResponse', text: author }
  const entries = [item(personAccepted), item(personUsed, 'used', 'state'), item(retrieved, 'retrieved'),
    item(delivered, 'delivered'), response]
  await writeStore(personPath, [event('evt_00000002', 'PERSON_EVENT_PRIVATE_NAME', entries)])
}

async function assertEligible(host) {
  const receipts = {}
  for (const mode of ['legacy', 'eventView', 'units']) {
    const engine = await engineFor(host, mode, [item(projectAccepted)])
    const frame = engine.renderMemoryDynamic({})
    for (const text of [personAccepted, personUsed, author, projectAccepted]) {
      assert.ok(frame.includes(text), mode + ': required portrait item missing ' + text)
    }
    assert.ok(!frame.includes('PERSON_EVENT_PRIVATE_NAME'), mode + ': person event escaped into workspace context')
    assert.equal(frame.split(personAccepted).length - 1, 1, mode + ': person item escaped the portrait segment')
    receipts[mode] = { portraitChars: engine.state.userPortraitText.length, units: engine.state._unitDeliveryReceiptPre?.counts?.portrait?.portraitItem ?? null }
  }
  return receipts
}

async function assertStageGate(host, modes = ['legacy', 'eventView', 'units']) {
  for (const mode of modes) {
    const engine = await engineFor(host, mode)
    const frame = engine.renderMemoryDynamic({})
    for (const banned of [retrieved, delivered]) {
      assert.ok(!frame.includes(banned), mode + ': ineligible portrait item emitted ' + banned)
    }
  }
}

test('4.1 a stored person preference is delivered across workspaces in each mode', async t => {
  await seedEligibility()
  t.diagnostic(JSON.stringify(await assertEligible(production)))
  t.diagnostic('frame excerpt: ' + personAccepted + ' / ' + personUsed + ' / ' + author)
})

test('4.1 retrieved and delivered person preferences stay out of every frame', async () => {
  await seedEligibility()
  await assertStageGate(production)
})

test('4.1 existing renderer and policy tier gates apply to the person source', async () => {
  await seedEligibility()
  for (const mode of ['legacy', 'eventView', 'units']) {
    const engine = await engineFor(production, mode)
    for (const tier of ['human_full', 'human_slim', 'post_compact', 'handoff_carry',
      'run_full', 'run_slim', 'hang_compensate', 'legacy']) {
      engine.state._injectTierPre = tier
      const frame = engine.renderMemoryDynamic({})
      const fullExpected = ['human_full', 'human_slim', 'post_compact', 'handoff_carry'].includes(tier)
      assert.equal(frame.includes(personAccepted), fullExpected, mode + '/' + tier + ': full frame')
      const slim = engine.renderSlimSnapshotPre()
      const slimExpected = fullExpected || (mode !== 'units' && ['run_full', 'legacy'].includes(tier))
      assert.equal(slim.includes(personAccepted), slimExpected, mode + '/' + tier + ': slim frame')
    }
  }
})

async function assertCap(host) {
  const entries = ['A', 'B', 'C', 'D'].map((letter, i) => item('P' + letter + '_BIG_' + letter.repeat(400), 'accepted',
    'preference', now + i))
  await writeStore(personPath, [event('evt_00000002', 'PERSON_EVENT_PRIVATE_NAME', entries.slice(0, 2))])
  const result = {}
  for (const mode of ['eventView', 'units']) {
    const workspaceItems = entries.slice(2)
    const engine = await engineFor(host, mode, workspaceItems)
    const frame = engine.renderMemoryDynamic({})
    const expected = buildUserPortraitPre([{ userPercept: workspaceItems.concat(entries.slice(0, 2)) }])
    assert.equal(expected.text.length, PORTRAIT_MAX_CHARS)
    assert.equal(expected.truncated, true)
    assert.equal(engine.state.userPortraitText, expected.text)
    if (mode === 'eventView') {
      assert.ok(frame.includes(expected.text), 'existing truncation must appear in the actual dynamic frame')
      result[mode] = expected.text.length
      continue
    }
    const bodies = frame.split('\n').filter(line => /^P[A-D]_BIG_/.test(line))
    assert.ok(bodies.length > 0, 'production units frame has no portrait body')
    assert.ok(bodies.every(text => entries.some(entry => entry.text === text)), 'portrait units must be retained whole')
    const jsChars = bodies.reduce((total, text) => total + 1 + text.length, 0)
    assert.ok(jsChars <= PORTRAIT_MAX_CHARS, 'units frame exceeded the portrait cap: ' + jsChars)
    assert.ok(engine.state._unitDeliveryReceiptPre.degradations.some(entry =>
      entry.moduleId === 'portrait' && entry.code === 'module-transport-limit'))
    result[mode] = { jsChars, remainingWhole: bodies.length, degradation: 'module-transport-limit' }
  }
  return result
}

test('4.1 legacy truncation and the units ceiling cover both portrait sources', async t => {
  t.diagnostic(JSON.stringify(await assertCap(production)))
})

test('4.1 missing or corrupt person storage leaves the workspace portrait available', async () => {
  await rm(personPath, { force: true })
  const render = async () => (await engineFor(production, 'eventView', [item(projectAccepted)])).renderMemoryDynamic({})
  const absent = await render()
  assert.ok(absent.includes(projectAccepted))
  assert.ok(!absent.includes(personAccepted))
  await writeFile(personPath, '{corrupt')
  const corrupt = await render()
  assert.equal(corrupt.replace(/fixture-\d+/g, 'fixture'), absent.replace(/fixture-\d+/g, 'fixture'))
})

function replaceOne(text, anchor, value) {
  assert.equal(text.split(anchor).length, 2, 'mutation anchor must be unique: ' + anchor)
  return text.replace(anchor, value)
}

async function engineMutant(label, rewriteIndex, moduleUrl, rewriteModule) {
  let source = (await readFile(index, 'utf8')).replaceAll('\r\n', '\n')
  if (moduleUrl) {
    const raw = (await readFile(moduleUrl, 'utf8')).replaceAll('\r\n', '\n')
    const absolute = rewriteModule(raw).replace(/(\bfrom\s+)(['"])(\.\.?\/[^'"]+)\2/g,
      (_, keyword, quote, relative) => keyword + JSON.stringify(new URL(relative, moduleUrl).href))
    const modulePath = path.join(dir, 'mutant-' + label + '.mjs')
    await writeFile(modulePath, absolute)
    source = rewriteIndex(source, pathToFileURL(modulePath).href)
  } else {
    source = rewriteIndex(source)
  }
  const enginePath = path.join(dir, 'index-' + label + '.mjs')
  await writeFile(enginePath, source)
  const auditUrl = new URL(audit)
  auditUrl.searchParams.set('mutation', label)
  process.env.DAM_AUDIT_ENGINE_SOURCE = enginePath
  try {
    const engine = await import(auditUrl)
    copies.push(engine)
    return engine
  } finally {
    delete process.env.DAM_AUDIT_ENGINE_SOURCE
  }
}

test('4.1 isolated mutation removing the person read is caught', async t => {
  await seedEligibility()
  const mutant = await engineMutant('no-person-read', source => replaceOne(source,
    'personEvents = (await readStoreForInjectPre(personStore)).events', 'personEvents = []'))
  await assert.rejects(() => assertEligible(mutant), /required portrait item missing PERSON_ACCEPTED_PREFERENCE/)
  await assertEligible(production)
  t.diagnostic('no person read: CAUGHT, production PASS')
})

test('4.1 isolated mutation allowing all portrait stages is caught', async t => {
  await seedEligibility()
  const mutant = await engineMutant('no-stage-gate', (source, url) => replaceOne(source,
    "from './user-portrait.js'", 'from ' + JSON.stringify(url)), portrait, source => replaceOne(source,
    'if (!_bypass && PORTRAIT_STAGES.indexOf(stage) < 0) continue', 'if (false) continue'))
  await assert.rejects(() => assertStageGate(mutant, ['eventView']), /ineligible portrait item emitted/)
  await assertStageGate(production)
  t.diagnostic('no portrait stage gate: CAUGHT, production PASS')
})

test('4.1 isolated mutation removing only the units ceiling is caught', async t => {
  const mutant = await engineMutant('no-units-cap', (source, url) => replaceOne(source,
    "from './injection/unit-delivery.js'", 'from ' + JSON.stringify(url)), delivery, source => replaceOne(source,
    "if (unit.moduleId === 'portrait') moduleCap.jsChars = Math.min(moduleCap.jsChars ?? Infinity, PORTRAIT_MAX_CHARS)", ''))
  await assert.rejects(() => assertCap(mutant), /units frame exceeded the portrait cap/)
  await assertCap(production)
  t.diagnostic('no portrait units ceiling: CAUGHT, production PASS')
})

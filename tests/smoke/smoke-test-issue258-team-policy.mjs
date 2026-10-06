import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { loadSecurityEngine, securityModule, securityRepo } from '../lib/security-engine.mjs'

const root = await fs.mkdtemp(path.join(os.tmpdir(), 'dsh-sec258-'))
const prior = process.env.DSH_HOME
const priorHome = process.env.HOME, priorProfile = process.env.USERPROFILE
process.env.DSH_HOME = root
process.env.HOME = root; process.env.USERPROFILE = root
try {
  const { MemoryEngine, DEFAULT_CONFIG } = await loadSecurityEngine()
  const { createTeamIdentity } = await securityModule('team-identity.js')
  const { createTeamSync } = await securityModule('team-sync.js')
  const { createTeamOutbox } = await securityModule('team-outbox.js')
  const { validateSettingsPatch, validateSettingsPaths } = await securityModule('settings-safety.js')
  const engine = new MemoryEngine(); engine.refresh = async () => {}
  const policy = async (role, extra = {}) => {
    engine.config = { ...DEFAULT_CONFIG, teamEnabled: true, teamMemberId: 'synthetic-member', teamMemberRole: role, ...extra }
    await fs.writeFile(engine._configPath, JSON.stringify(engine.config))
  }
  await policy('viewer')
  const source = await fs.readFile(path.join(securityRepo, 'lib/index.js'), 'utf8')
  const route = source.indexOf('      path: API.config,')
  const start = source.indexOf('handler: ', route) + 9, end = source.indexOf('\n      },', start)
  assert(route > 0 && end > start)
  const env = { engine, DEFAULT_CONFIG, validateSettingsPatch, validateSettingsPaths,
    dshHome: () => root, isLoopbackRequest: () => true, readJsonBody: async req => req.body,
    writeJson: (res, status, body) => { res.status = status; res.body = body } }
  const handler = new Function(...Object.keys(env), 'return (' + source.slice(start, end) + '\n})')(...Object.values(env))
  const call = async body => { const res = {}; await handler({ method: 'POST', body }, res); return res }
  const before = await fs.readFile(engine._configPath, 'utf8')
  // In-memory admin cannot authorize against durable viewer; patch cannot disable its own gate.
  engine.config.teamMemberRole = 'administrator'
  for (const patch of [{ teamMemberRole: 'administrator' }, { teamMemberId: '' }]) {
    await assert.rejects(engine.saveConfig(patch), e => e.code === 'team-forbidden')
    assert.equal(await fs.readFile(engine._configPath, 'utf8'), before)
  }
  // HTTP keeps its existing DEFAULT_CONFIG allowlist; identity-only keys are
  // not admitted there. Exercise real supported team fields through this route.
  for (const patch of [{ teamEnabled: false, teamMemberRole: 'administrator' }, { teamId: 'changed' }]) {
    const result = await call(patch)
    assert.equal(result.status, 403, JSON.stringify(result))
    assert.match(result.body.error, /team-forbidden/)
    assert.equal(await fs.readFile(engine._configPath, 'utf8'), before)
  }
  assert.equal((await call({ locale: 'ja' })).status, 200, 'personal setting must remain editable')
  assert.equal(JSON.parse(await fs.readFile(engine._configPath, 'utf8')).teamMemberRole, 'viewer')
  await policy('editor')
  assert.equal((await call({ teamId: 'new-team' })).status, 403)
  await policy('administrator')
  assert.equal((await call({ teamId: 'new-team' })).status, 200)
  await policy('viewer')
  const files = { memory: path.join(root, 'MEMORY.md'), calendar: path.join(root, 'CALENDAR.md'), plan: path.join(root, 'handoff', 'PLAN.md') }
  await fs.mkdir(path.dirname(files.plan), { recursive: true })
  for (const file of Object.values(files)) await fs.writeFile(file, '# Original\n')
  for (const method of ['appendText', 'writeFull', 'writeFullSingle', 'writeFullRaw']) {
    for (const file of Object.values(files)) {
      await assert.rejects(engine[method](file, 'replacement'), e => e.code === 'team-forbidden')
      assert.equal(await fs.readFile(file, 'utf8'), '# Original\n')
    }
  }
  engine.resolvePaths = async () => ({ calendarPath: files.calendar })
  await assert.rejects(engine.calendarAdd({ date: '2026-10-07', title: 'synthetic appointment' }), /team-forbidden/)
  await policy('editor')
  await engine.appendText(files.memory, '\nOrdinary editor write\n')
  await engine.calendarAdd({ date: '2026-10-07', title: 'synthetic appointment' })
  assert.match(await fs.readFile(files.calendar, 'utf8'), /synthetic appointment/)
  for (const extra of [{ teamEnabled: false }, { teamMemberId: '' }, { teamMemberRole: 'unknown-role' }]) {
    await policy('viewer', extra)
    await engine.appendText(files.memory, '\nExempt personal write ' + JSON.stringify(extra) + '\n')
  }
  await policy('administrator')
  const identity = createTeamIdentity({ engine })
  assert.equal(identity.currentMember().role, 'administrator')
  const outbox = createTeamOutbox({ dir: path.join(root, 'outbox') }); outbox.load()
  outbox.enqueue({ kind: 'fact', key: 'first', payload: { text: 'synthetic-first' } })
  outbox.enqueue({ kind: 'fact', key: 'second', payload: { text: 'synthetic-second' } })
  let requests = 0, sentMember = null
  const sync = createTeamSync({ engine, identity, outbox, teamFetch: async (_url, options) => {
    requests++
    sentMember = options.body.member
    if (requests === 1) await policy('viewer') // Same member demoted while first request is in flight.
    return { ok: true }
  } })
  const first = await sync.tick()
  assert.equal(identity.currentMember().role, 'viewer', 'identity cached stale role')
  assert.equal(requests, 1, 'second queued write bypassed role recheck')
  assert.equal(first.sent, 1); assert.equal(first.failed, 1); assert.equal(outbox.size(), 1)
  const disk = JSON.parse(await fs.readFile(outbox.file, 'utf8'))
  assert.equal(disk.items.length, 1); assert.equal(disk.items[0].key, 'second')
  const denied = await sync.tick()
  assert.equal(denied.sent, 0); assert.equal(requests, 1); assert.equal(outbox.size(), 1)
  // A changed/removed member in durable config must also be checked, even when
  // the instance's identity cache still shows the preceding registration.
  const durablePolicy = JSON.parse(await fs.readFile(engine._configPath, 'utf8'))
  await fs.writeFile(engine._configPath, JSON.stringify({ ...durablePolicy, teamMemberId: '' }))
  assert.equal((await sync.tick()).sent, 0); assert.equal(requests, 1); assert.equal(outbox.size(), 1)
  await fs.writeFile(engine._configPath, JSON.stringify({ ...durablePolicy, teamMemberRole: 'editor', teamMemberId: 'new-synthetic-member' }))
  assert.equal((await sync.tick()).sent, 1); assert.equal(outbox.size(), 0)
  assert.deepEqual(sentMember, { id: 'new-synthetic-member', role: 'editor' })
  sync.stop()
  console.log('PASS #258 actual /config HTTP 403, durable old-role/disable-gate refusal, personal/editor/admin controls, 12 write primitives, calendar entry, same-member demotion, real outbox retention and retry, zero network')
} finally {
  if (prior === undefined) delete process.env.DSH_HOME; else process.env.DSH_HOME = prior
  if (priorHome === undefined) delete process.env.HOME; else process.env.HOME = priorHome
  if (priorProfile === undefined) delete process.env.USERPROFILE; else process.env.USERPROFILE = priorProfile
  await fs.rm(root, { recursive: true, force: true })
}

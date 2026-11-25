import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import { markers, message, startDeliveryHost } from '../lib/delivery-step-fixture.mjs'

let host
before(async () => { host = await startDeliveryHost() })
after(async () => { await host?.close() })

const human = () => message('user')
const agentNotice = () => message('agent-message')
const expect = (row, kind, detail) => assert.equal(row.kind, kind, detail)

test('a human followed by 45 empty tool requests commits only the Run-off reminder', async t => {
  const s = host.session()
  expect(await s.request([human()], { toolStep: true }), 'full', 'first human establishes a full snapshot')
  const counts = {}, committed = []
  for (let i = 0; i < 45; i++) {
    const row = await s.request([], { toolStep: true })
    counts[row.kind] = (counts[row.kind] || 0) + 1
    if (row.changed) committed.push(row.kind)
  }
  t.diagnostic(JSON.stringify({ counts, committed }))
  assert.deepEqual(counts, { reminder: 45 })
  assert.deepEqual(committed, ['reminder'], 'unchanged reminder is retained across requests')
})

test('same-turn steering sees the human slim snapshot at the admission render', async () => {
  const s = host.session()
  expect(await s.request([human()], { repeat: true }), 'full')
  assert.equal(s.state._injectTierPre, 'human_full', 'the returned full frame owns the label')
  expect(await s.request([human()], { repeat: true }), 'human-slim', 'second actual human in same turn')
  assert.equal(s.state._injectTierPre, 'human_slim', 'same-request replay preserves the final profile')
  expect(await s.request([]), 'reminder', 'fresh empty request after steering')
  assert.equal(s.state._injectTierPre, null, 'a suppressed run has no content tier')
})

test('consecutive human turns keep the full and slim profiles with Run off', async () => {
  const s = host.session()
  expect(await s.request([human()]), 'full')
  expect(await s.request([human()], { newTurn: true, repeat: true }), 'human-slim')
})

test('per-request classification covers mixed batches, pure notices and fresh turns', async () => {
  const s = host.session()
  expect(await s.request([agentNotice()]), 'reminder')
  expect(await s.request([human()], { newTurn: true }), 'full')
  expect(await s.request([agentNotice(), human()]), 'human-slim', 'human may follow a host notice')
  expect(await s.request([human(), message('subagent-settled')]), 'human-slim', 'human may precede a host notice')
  for (const kind of ['agent-message', 'subagent-settled', 'runtime-context']) {
    expect(await s.request([message(kind)]), 'reminder', 'notice only: ' + kind)
  }
  expect(await s.request([human()], { newTurn: true }), 'human-slim')
})

test('legacy human inputs may omit source or supply a source string', async () => {
  const s = host.session()
  const legacyMessage = { role: 'user', content: human().content }
  expect(await s.request([legacyMessage]), 'full')
  expect(await s.request([{ ...human(), source: 'user' }], { newTurn: true }), 'human-slim')
  expect(await s.request([{ ...agentNotice(), source: 'agent-message' }]), 'reminder')
})

test('opening Run restores both full and slim run deliveries, without the human-slim event', async () => {
  const s = host.session({ runTierInjectEnabled: true, snapshotMinGapRounds: 4, slimEveryRounds: 2 })
  const rows = [await s.request([agentNotice()])]
  for (let i = 0; i < 8; i++) rows.push(await s.request([]))
  assert(rows.some(row => row.kind === 'full' && row.text.includes(markers.card)), 'run full returned fixture card')
  assert(rows.some(row => row.kind === 'run-slim'), 'run slim was delivered')
  assert(rows.every(row => !row.text.includes(markers.event)), 'no synthetic human-slim event on run')
})

test('with Run enabled a fresh human batch replaces the provisional run profile', async () => {
  const s = host.session({ runTierInjectEnabled: true })
  const first = await s.request([human()])
  assert(first.text.includes(markers.full), 'the first actual human receives the user-memory body')
  expect(await s.request([agentNotice(), human()], { repeat: true }), 'human-slim')
  expect(await s.request([]), 'run-slim')
})

test('zero full gap consumes the human signal before following agent-only requests', async () => {
  const s = host.session({ snapshotMinGapRounds: 0 })
  expect(await s.request([human()]), 'full')
  expect(await s.request([agentNotice()], { newTurn: true }), 'reminder')
  expect(await s.request([], { repeat: true }), 'reminder')
  expect(await s.request([human()], { newTurn: true }), 'full')
})

test('water threshold waits for a human request, grants once and then returns to slim', async () => {
  const s = host.session({ fullInjectWaterPct: '25' })
  expect(await s.request([human()], { water: 0.1 }), 'full')
  expect(await s.request([], { water: 0.26 }), 'reminder', 'empty same-turn step must not consume the threshold')
  expect(await s.request([human()], { repeat: true }), 'full', 'water remains pending for the actual human')
  expect(await s.request([human()]), 'human-slim', 'threshold is consumed exactly once')
})

test('historic compaction is a baseline, new compaction delivers one full rebuild', async () => {
  const s = host.session({ snapshotReinjectOnCompact: true })
  s.emit('compaction/summary', {})
  expect(await s.request([agentNotice()]), 'reminder', 'first observation of historical compaction')
  expect(await s.request([human()], { newTurn: true }), 'full')
  const rebuild = await s.request([agentNotice()], { compact: true, newTurn: true, repeat: true })
  expect(rebuild, 'full')
  assert.match(rebuild.text, /上下文已压缩/)
  expect(await s.request([]), 'reminder', 'only the compact request reuses its grant')
})

test('compaction between the two host assemblies is observable on admission', async () => {
  const s = host.session()
  expect(await s.request([human()]), 'full')
  const row = await s.request([], { compactDuringPreStep: true, repeat: true })
  expect(row, 'full')
  assert.match(row.text, /上下文已压缩/)
  expect(await s.request([]), 'reminder')
})

test('an unresolved workspace can carry a full first frame and releases it once bound', async () => {
  const s = host.session()
  const ws = s.state.ws
  s.state.ws = ''
  s.state.globalLedgerPath = ws + '/sample-handoff.md'
  expect(await s.request([agentNotice()]), 'full')
  s.state.ws = ws
  expect(await s.request([]), 'reminder')
})

test('a busy event stream keeps the current request identity across more than 400 non-boundary events', async () => {
  const s = host.session()
  const noise = () => {
    for (let i = 0; i < 451; i++) s.emit('agent/inbox/spliced', { target: 'next-step', start: 0, removedCount: 0, inserted: [] })
  }
  expect(await s.request([human()]), 'full')
  for (const [messages, expected] of [[[], 'reminder'], [[human()], 'human-slim'], [[agentNotice()], 'reminder'], [[human()], 'human-slim']]) {
    noise()
    expect(await s.request(messages, { beforeRefresh: noise, repeat: true }), expected)
  }
})

test('first-ever compression between proposal and admission delivers the new rebuild immediately', async () => {
  const s = host.session()
  const row = await s.request([agentNotice()], { compactDuringPreStep: true, repeat: true })
  assert.equal(row.draftText, '', 'a new session starts with an empty proposal')
  expect(row, 'full', 'fresh compaction is newer than the provisional baseline')
  assert.match(row.text, /上下文已压缩/)
  expect(await s.request([]), 'reminder')
})

test('M6 and a one-time notification that arrive after proposal reach their named model sections', async () => {
  const s = host.session({ runTierInjectEnabled: true })
  const first = await s.request([human()])
  const tail = 'Source: Workspace memory\nReference: evidence-A\nSource: Workspace memory\nReference: evidence-B'
  const notice = { date: '2026-11-23', text: 'fixture-post-proposal-notification' }
  const row = await s.request([human()], { m6DuringPreStep: tail, notificationDuringPreStep: notice, repeat: true })
  assert.equal(row.draftText, first.text)
  assert(!row.draftSections.some(section => section.name === 'dsh:m6-reference-tail-pre'))
  assert(!row.draftText.includes(notice.text))
  expect(row, 'human-slim')
  assert(row.text.includes(notice.text), 'once-only reflection notice must survive into the admitted main section')
  assert.equal(row.m6Text, tail, 'the independent tail is admitted in this request')
  const next = await s.request([human()])
  expect(next, 'human-slim')
  assert.match(next.text, /已自动想起 2 条/)
  assert(!next.text.includes(notice.text))
  assert.equal(next.m6Text, '')
})

test('a recall observation made by the proposal tail survives to the current human admission', async () => {
  const s = host.session()
  const first = await s.request([human()])
  const tail = 'Source: Project memory\nReference: proposal-A\nSource: Project memory\nReference: proposal-B'
  const row = await s.request([human()], { m6AtProposal: tail, repeat: true })
  assert.equal(row.draftText, first.text, 'the main proposal precedes the current M6 observation')
  assert.equal(row.draftSections.find(section => section.name === 'dsh:m6-reference-tail-pre')?.text, tail)
  expect(row, 'human-slim')
  assert.match(row.firstPostText, /已自动想起 2 条/)
  assert.equal(row.m6Text, tail)
})

test('disabling post-compaction reinjection leaves the ordinary run reminder', async () => {
  const s = host.session({ snapshotReinjectOnCompact: false })
  expect(await s.request([human()]), 'full')
  expect(await s.request([agentNotice()], { compact: true, newTurn: true }), 'reminder')
})

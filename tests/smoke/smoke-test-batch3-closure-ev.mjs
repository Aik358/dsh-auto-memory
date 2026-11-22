import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const INDEX = new URL('../../lib/index.js', import.meta.url)
const EVENT_VIEW = new URL('../../lib/injection/event-view.js', import.meta.url)
const AUDIT_ENGINE = new URL('../lib/audit-engine.mjs', import.meta.url)
const FIXTURE_DAY = '2026-11-22'
const FIXTURE_TIME = Date.parse(FIXTURE_DAY + 'T12:00:00Z')
const HEAD = 'HEAD_0123456789ABCDE'
const TAIL = 'TAIL_0123456789ABCDE'
const FAILURE = 'EV-FAILURE-REASON'
const FAILURE_TITLE = '· 失败与弯路：'
const CHECKPOINT_FAILURE = 'EV-CHECKPOINT-DEAD-REASON'
const SHA256 = text => createHash('sha256').update(text, 'utf8').digest('hex')
// Captured by running the same fixture against decdeccf with the event store on disk.
const BASELINE = {
  full: [2879, 5062, '47f2ea95cca20a7f5ad469566d878737c69efd185029c3c38f142f4901f25077'],
  slim: [2131, 4494, 'ecc483b3f12f98294edbf251585ec7f98343a5440fac174222fd450a466c1090'],
  overview: [57, 68, '21116465b071b5079e113eacc8a8e1f2b51a3169b1ce9bafdab6bdc0446be791'],
}

const counts = { pass: 0, fail: 0 }
async function check(label, verify) {
  try {
    const evidence = await verify()
    counts.pass++
    console.log(`PASS ${label}${evidence === undefined ? '' : ' ' + JSON.stringify(evidence)}`)
  } catch (error) {
    counts.fail++
    console.error(`FAIL ${label} ${error.stack || error}`)
  }
}

function eventsFixture({ deadend = FAILURE, checkpointDead = '' } = {}) {
  return Array.from({ length: 10 }, (_, index) => {
    const n = index + 1
    const latest = n === 10
    const checkpoints = latest ? [{
      id: 'cp_fixture', at: FIXTURE_TIME, text: HEAD + 'x'.repeat(1360) + TAIL,
    }] : []
    if (latest && checkpointDead) {
      checkpoints.push({
        id: 'cp_dead', at: FIXTURE_TIME + 1, text: 'legacy placeholder',
        goal: 'Checkpoint goal', state: 'Checkpoint state', dead: checkpointDead, next: 'Checkpoint next',
      })
    }
    return {
      id: 'evt_' + n.toString(16).padStart(8, '0'), name: 'Name ' + n, status: 'active',
      createdAt: FIXTURE_TIME, updatedAt: FIXTURE_TIME + n, summary: 'T1-SUMMARY-' + n + '. More summary.',
      sections: { goal: 'Goal ' + n, doing: 'Doing ' + n, deadend: latest ? deadend : '', next: 'Next ' + n },
      checkpoints,
    }
  })
}

const T1_CASES = [
  { label: 'production sample', input: { summary: 'T1-SUMMARY-10. More summary.' }, expected: 'T1-SUMMARY-10.' },
  { label: 'English punctuation and abbreviations', input: { summary: 'Dr. Smith shipped v3.4 and 1.5x today. Next.' }, expected: 'Dr. Smith shipped v3.4 and 1.5x today.' },
  { label: 'Chinese punctuation and folded line breaks', input: { summary: '  第一行\r\n\n 后续一行。下一句。 ' }, expected: '第一行 后续一行。' },
  { label: '140-char boundary preserves surrogate pairs', id: 'long-summary', input: { summary: 'x'.repeat(138) + '😀suffix' }, expected: 'x'.repeat(138) + '…' },
  { label: 'empty summary uses name', id: 'empty-summary', input: { summary: '', name: '  NAME-FALLBACK  ' }, expected: 'NAME-FALLBACK' },
  { label: 'whitespace-only summary uses name', input: { summary: ' \n\t', name: '  NAME-FALLBACK  ' }, expected: 'NAME-FALLBACK' },
  { label: 'empty summary and empty name', input: { summary: '', name: '' }, expected: '' },
  { label: 'name fallback uses the same cap', input: { name: 'x'.repeat(145) }, expected: 'x'.repeat(139) + '…' },
  { label: 'null input', input: null, expected: '' },
]

function assertT1Case(renderOld, renderNew, fixture) {
  const oldText = renderOld(fixture.input)
  const newText = renderNew(fixture.input)
  assert.equal(oldText, fixture.expected, `baseline ${fixture.label}`)
  assert.equal(newText, oldText, `T1 parity ${fixture.label}`)
  assert.deepEqual(Buffer.from(newText, 'utf8'), Buffer.from(oldText, 'utf8'), `T1 UTF-8 parity ${fixture.label}`)
  return { label: fixture.label, text: newText, chars: newText.length }
}

function replaceOnce(source, before, after) {
  assert.equal(source.split(before).length - 1, 1, `expected one isolated mutation anchor: ${before}`)
  return source.replace(before, after)
}

function assertEventFailure(text) {
  assert.ok(text.includes(FAILURE_TITLE + FAILURE), 'A1 event deadend remains visible')
}

function assertCheckpointTail(text) {
  assert.ok(text.includes(HEAD) && text.includes(TAIL), 'A3 preserves first and last 20 characters')
}

function assertFiveCards(text, events) {
  const cardHeadings = text.split('\n').filter(line => line.startsWith('【事件】'))
  assert.ok(cardHeadings.length >= 5, 'A4 at least five expanded event cards')
  for (const event of events.slice(-5)) {
    assert.ok(cardHeadings.some(line => line.includes('#' + event.id)), `A4 expanded card id ${event.id}`)
    assert.ok(text.split('\n').some(line => line.endsWith('：' + event.sections.goal)), `A4 expanded body ${event.sections.goal}`)
  }
  for (const event of events) assert.ok(text.includes('#' + event.id), `A4 searchable id ${event.id}`)
  return cardHeadings.map(line => line.match(/#evt_[0-9a-f]{8}/)?.[0])
}

async function expectCaught(label, test) {
  await assert.rejects(test, { code: 'ERR_ASSERTION', message: new RegExp(label) })
  return 'CAUGHT'
}

const work = await mkdtemp(path.join(tmpdir(), 'dam-closure-ev-'))
const env = process.env.DSH_HOME
const override = process.env.DAM_AUDIT_ENGINE_SOURCE
process.env.DSH_HOME = work
delete process.env.DAM_AUDIT_ENGINE_SOURCE
try {
  const { EVENT_STORE_FILENAME } = await import('../../lib/event-store.js')
  const { renderT1Pre } = await import('../../lib/event-render.js')
  const { renderEventOneLineSummaryPre } = await import(EVENT_VIEW)
  const [indexSource, viewSource] = await Promise.all([readFile(INDEX, 'utf8'), readFile(EVENT_VIEW, 'utf8')])
  const current = await import(AUDIT_ENGINE)
  const paths = {
    ws: 'fixture-workspace', userDir: work, projectDir: path.join(work, 'project'),
    handoffDir: path.join(work, 'handoff'), reflectDir: path.join(work, 'reflections'), planPath: path.join(work, 'PLAN.md'),
  }
  await Promise.all([paths.projectDir, paths.handoffDir, paths.reflectDir].map(dir => mkdir(dir)))

  async function production(engineModule, events, activeLimit) {
    const engine = new engineModule.MemoryEngine()
    engine.configLoaded = true
    engine.memToday = () => FIXTURE_DAY
    engine.resolvePaths = async () => paths
    engine.state.ws = paths.ws
    if (activeLimit !== undefined) engine.config.eventMaxActiveInInject = activeLimit
    await writeFile(path.join(paths.handoffDir, EVENT_STORE_FILENAME), JSON.stringify({ events }), 'utf8')
    await engine.refreshEventStatePre()
    const full = engine.renderMemoryDynamic({})
    const slim = engine.renderSlimSnapshotPre(paths.ws)
    const overview = engine.buildReadOverviewPre()
    await engineModule.flushDiagnostics()
    return { full, slim, overview }
  }

  // The audit engine executes the complete module in a temporary copy.
  // Only the import of event-view changes for a view-module mutant.
  async function engineFrom(source, label, viewTransform) {
    if (viewTransform) {
      const view = await isolatedView(viewTransform, label)
      source = replaceOnce(source, "from './injection/event-view.js'", `from '${view.href}'`)
    }
    const indexPath = path.join(work, 'index-' + label + '.js')
    await writeFile(indexPath, source, 'utf8')
    process.env.DAM_AUDIT_ENGINE_SOURCE = indexPath
    try {
      const audit = new URL(AUDIT_ENGINE)
      audit.searchParams.set('variant', label)
      return await import(audit)
    } finally {
      delete process.env.DAM_AUDIT_ENGINE_SOURCE
    }
  }

  async function isolatedView(viewTransform, label) {
    const rewritten = viewTransform(viewSource).replace(/from\s+(['"])(\.\.?\/[^'"]+)\1/g,
      (_match, _quote, relative) => 'from ' + JSON.stringify(new URL(relative, EVENT_VIEW).href))
    const viewPath = path.join(work, 'event-view-' + label + '.mjs')
    await writeFile(viewPath, rewritten, 'utf8')
    return pathToFileURL(viewPath)
  }

  const switchOff = source => replaceOnce(source, 'const useEventView = true', 'const useEventView = false')
  const switchOffEngine = await engineFrom(switchOff(indexSource), 'switch-off')
  const events = eventsFixture()
  const main = await production(current, events, 5)

  await check('A1 event deadend and checkpoint dead appear in production frame', async () => {
    const { full } = await production(current, eventsFixture({ checkpointDead: CHECKPOINT_FAILURE }))
    assertEventFailure(full)
    assert.ok(full.includes(CHECKPOINT_FAILURE), 'A1 checkpoint dead remains visible')
    return full.split('\n').filter(line => line.includes(FAILURE) || line.includes(CHECKPOINT_FAILURE))
  })
  await check('A2 empty deadend emits no title', async () => {
    const { full } = await production(current, eventsFixture({ deadend: '' }))
    assert.ok(full.includes('#evt_0000000a'))
    assert.ok(!full.includes(FAILURE_TITLE) && !full.includes(FAILURE))
    return { eventPresent: true, deadendTitlePresent: false }
  })
  await check('A3 1400-char checkpoint keeps both 20-char ends in the production frame', () => {
    assert.equal(events.at(-1).checkpoints[0].text.length, 1400)
    assertCheckpointTail(main.full)
    const checkpoint = main.full.split('\n').find(line => line.includes(HEAD))
    assert.ok(checkpoint.includes(TAIL))
    assert.ok(checkpoint.slice(checkpoint.indexOf(HEAD), checkpoint.indexOf(TAIL) + TAIL.length).length <= 300)
    assert.ok(main.full.length <= 8000)
    return { head: HEAD, tail: TAIL, checkpoint, frameChars: main.full.length }
  })
  await check('A4 ten active events keep five card bodies and all ten searchable IDs', () => {
    return { cards: assertFiveCards(main.full, events), ids: events.map(event => event.id) }
  })

  const evMutations = [
    { name: 'checkpoint-tail-removed', anchor: 'let tail = source.slice(source.length - (retained - Math.floor(retained / 2)));',
      change: "let tail = '';", assertFrame: assertCheckpointTail, fails: 'A3 preserves' },
    { name: 'event-deadend-mapping-removed', anchor: "const EVENT_HEAD_KEYS = Object.freeze(['goal', 'doing', 'deadend', 'next']);",
      change: "const EVENT_HEAD_KEYS = Object.freeze(['goal', 'doing', 'next']);", assertFrame: assertEventFailure, fails: 'A1 event deadend' },
    { name: 'active-limit-one', anchor: 'const expanded = actives.slice(0, activeLimit);',
      change: 'const expanded = actives.slice(0, Math.min(activeLimit, 1));', assertFrame: assertFiveCards, fails: 'A4 at least five' },
  ]
  for (const mutation of evMutations) {
    await check('A5 ' + mutation.name, async () => {
      const mutant = await engineFrom(indexSource, mutation.name,
        source => replaceOnce(source, mutation.anchor, mutation.change))
      const { full } = await production(mutant, events, 5)
      await expectCaught(mutation.fails, async () => mutation.assertFrame(full, events))
      mutation.assertFrame((await production(current, events, 5)).full, events)
      return 'CAUGHT → original PASS'
    })
  }

  await check('A6 switch off restores pre-change full frame, slim frame and overview bytes', async () => {
    const rollback = await production(switchOffEngine, events)
    const normal = await production(current, events)
    const observed = Object.fromEntries(Object.entries(rollback).map(([key, value]) =>
      [key, [value.length, Buffer.byteLength(value, 'utf8'), SHA256(value)]]))
    assert.deepEqual(observed, BASELINE)
    assert.notEqual(normal.full, rollback.full, 'control verifies the new full path actually differs')
    assert.equal(normal.overview, rollback.overview)
    return observed
  })

  // [DECISION D30B-13 | 2026-11-22 | user ruling] T1 新旧接口逐例比较文本与 UTF-8，覆盖旧消费端与回滚。
  for (const fixture of T1_CASES) {
    await check('A7 ' + fixture.label, () => assertT1Case(renderT1Pre, renderEventOneLineSummaryPre, fixture))
  }

  const t1Mutations = [
    { name: 'summary-limit-120', anchor: 'firstSentencePre(text, RENDER_LIMITS.T1)', change: 'firstSentencePre(text, 120)', fixtureId: 'long-summary' },
    { name: 'name-fallback-removed', anchor: "one || cutPre(String(ev.name || '').trim(), RENDER_LIMITS.T1)", change: 'one', fixtureId: 'empty-summary' },
  ]
  for (const mutation of t1Mutations) {
    await check('A8 ' + mutation.name, async () => {
      const url = await isolatedView(source => replaceOnce(source, mutation.anchor, mutation.change), mutation.name)
      const { renderEventOneLineSummaryPre: mutant } = await import(url)
      const fixture = T1_CASES.find(item => item.id === mutation.fixtureId)
      await expectCaught('T1 parity', async () => assertT1Case(renderT1Pre, mutant, fixture))
      assertT1Case(renderT1Pre, renderEventOneLineSummaryPre, fixture)
      return 'CAUGHT → original PASS'
    })
  }

  await check('A9 slim and overview consume the real refresh T1 output, with exactly three marked index sites', async () => {
    assert.ok(main.slim.includes('T1-SUMMARY-10.'))
    assert.ok(main.overview.includes('· T1-SUMMARY-10.'))
    const lines = indexSource.split(/\r?\n/)
    const evidence = lines.flatMap((line, i) => {
      if (!line.includes('renderEventOneLineSummaryPre')) return []
      const decision = '[DECISION D30B-13 | 2026-11-22 | user ruling]'
      assert.ok(line.includes(decision) || lines[i - 1]?.includes(decision), `D30B-13 tag at index:${i + 1}`)
      return [`lib/index.js:${i + 1}:${line.trim()}`]
    })
    assert.equal(evidence.length, 3)

    const t1Probe = 'T1-NEW-ROUTE-PROBE'
    const replaceT1Value = source => replaceOnce(source, 'firstSentencePre(text, RENDER_LIMITS.T1)', JSON.stringify(t1Probe))
    const probeEngine = await engineFrom(indexSource, 't1-consumers', replaceT1Value)
    const probeRollbackEngine = await engineFrom(switchOff(indexSource), 't1-consumers-off', replaceT1Value)
    const probeOn = await production(probeEngine, events, 5)
    const probeOff = await production(probeRollbackEngine, events, 5)
    assert.ok(probeOn.slim.includes('[当前事件] ' + t1Probe))
    assert.ok(probeOn.overview.includes('· ' + t1Probe))
    assert.ok(!probeOff.slim.includes(t1Probe) && !probeOff.overview.includes(t1Probe))
    assert.ok(probeOff.slim.includes('T1-SUMMARY-10.') && probeOff.overview.includes('T1-SUMMARY-10.'))
    return { slim: main.slim.split('\n').find(line => line.includes('T1-SUMMARY-10.')),
      overview: main.overview.split('\n').filter(line => line.includes('T1-SUMMARY-')),
      probe: 'new T1 reaches both readers when enabled and reaches neither on rollback', grep: evidence }
  })
} finally {
  if (env === undefined) delete process.env.DSH_HOME
  else process.env.DSH_HOME = env
  if (override === undefined) delete process.env.DAM_AUDIT_ENGINE_SOURCE
  else process.env.DAM_AUDIT_ENGINE_SOURCE = override
  await rm(work, { recursive: true, force: true })
}

console.log(`B3-EV closure: ${counts.pass} PASS / ${counts.fail} FAIL`)
if (counts.fail) process.exitCode = 1

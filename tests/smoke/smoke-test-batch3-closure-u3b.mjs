import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test, { after } from 'node:test';
import { runInNewContext } from 'node:vm';
import { pathToFileURL } from 'node:url';
import { EVENT_STORE_FILENAME } from '../../lib/event-store.js';
import { validatePolicy } from '../../lib/injection/policy-v2.js';
import { measureFrame } from '../../lib/injection/policy-runtime.js';
import { collectDeliveryEventUnitsPre, composeUnitDeliveryPre } from '../../lib/injection/unit-delivery.js';

const engineUrl = new URL('../lib/audit-engine.mjs', import.meta.url);
const indexUrl = new URL('../../lib/index.js', import.meta.url);
const policyUrl = new URL('../../lib/injection/unit-policy.js', import.meta.url);
const adapterUrl = new URL('../../lib/injection/unit-adapters.js', import.meta.url);
const deliveryUrl = new URL('../../lib/injection/unit-delivery.js', import.meta.url);
const dedupeUrl = new URL('../../lib/injection/inject-dedupe.js', import.meta.url);
const temp = await mkdtemp(path.join(tmpdir(), 'dam-u3b-closure-'));
const iso = path.join(temp, 'dsh');
const priorHome = process.env.DSH_HOME;
const priorAuditSource = process.env.DAM_AUDIT_ENGINE_SOURCE;
process.env.DSH_HOME = iso;
delete process.env.DAM_AUDIT_ENGINE_SOURCE;
await mkdir(iso);

const current = await import(engineUrl);
const hosts = [current];
const now = Date.parse('2026-11-22T12:00:00Z');
let serial = 0;
const digest = text => ({ jsChars: text.length, utf8Bytes: Buffer.byteLength(text),
  sha256: createHash('sha256').update(text, 'utf8').digest('hex') });

after(async () => {
  await Promise.all(hosts.map(host => host.flushDiagnostics()));
  if (priorHome === undefined) delete process.env.DSH_HOME;
  else process.env.DSH_HOME = priorHome;
  if (priorAuditSource === undefined) delete process.env.DAM_AUDIT_ENGINE_SOURCE;
  else process.env.DAM_AUDIT_ENGINE_SOURCE = priorAuditSource;
  const resolved = await realpath(temp);
  assert.equal(path.dirname(resolved), await realpath(tmpdir()));
  assert.ok(path.basename(resolved).startsWith('dam-u3b-closure-'));
  await rm(resolved, { recursive: true, force: true, maxRetries: 5 });
});

// [DECISION D30B-14 | 2026-11-22 | user ruling] These digest inputs and outputs were frozen before the first batch-B code edit.
const baseline = {
  legacy: {
    empty: [2080, 4005, '1e986f357071f597115c2b5bf8e7520404a7f1f858ac4f511e14598c7ada8c5e'],
    normal: [2748, 5051, '5a7ba6eda7df8a21374871176cf743b74a1d3b22b51b47cc7add5072d6bd090f'],
    full: [6649, 9670, '75583d005e623d1aa59f5f6f9af68ebad486dd47af9943acafcdaa759f5d749a'],
  },
  eventView: {
    empty: [2080, 4005, '1e986f357071f597115c2b5bf8e7520404a7f1f858ac4f511e14598c7ada8c5e'],
    normal: [2769, 5099, 'e583dbaf2b7b80c959bbfe1c712d60bb260e6d878ceb51cb48ea7413d0dd83b8'],
    full: [6684, 9750, '30219e0b0f943b6e0206d22a0bf3391bc0334fae48c825e8a607d3173e34e50b'],
  },
  // Captured on 0880b650 before D4-2 was implemented.
  units: {
    empty: [2080, 4005, '9b8b21b7d7678afe32673f149e96ed58afb89efa3fa38817d26f5a9b0875629b'],
    normal: [2748, 4840, '0583a4b20b3d370ccbf3f92046c958b3a8c9a264e0abf118ffb38bf0ffb0b2dc'],
    full: [3619, 4199, '73fc5fb11211c0fc67fafefecef8bf9dafb2aa5813ea8fb31718caa4aedf77ca'],
  },
};

// Keep D30B-14's exact frame hashes. Only the two approved wording layers changed in Batch 5.
const originalSource = execFileSync('git', ['show', '37f20223:lib/index.js'], {
  cwd: new URL('../../', import.meta.url), encoding: 'utf8', maxBuffer: 8 * 1024 * 1024,
}).replaceAll('\r\n', '\n');
const baselineWording = Object.fromEntries(['snapshotInscription', 'snapshotInscriptionArchive'].map(key => {
  const literal = originalSource.match(new RegExp('^  ' + key + ': ([\\s\\S]+?),\\n', 'm'))?.[1];
  assert.ok(literal, 'missing baseline wording: ' + key);
  return [key, runInNewContext(literal)];
}));
const useBaselineWording = engine => { engine.config.promptLayerOverrides = baselineWording; };

function event(i, count, { full = false, status = 'active' } = {}) {
  return {
    id: 'evt_' + (i + 1).toString(16).padStart(8, '0'), name: 'Event ' + i, status,
    updatedAt: now + i, createdAt: now, summary: 'Event summary ' + i + '.',
    sections: { goal: 'Goal ' + i, doing: 'Progress ' + i, deadend: 'Blocked ' + i, next: 'Next ' + i },
    checkpoints: Array.from({ length: count }, (_, j) => ({ id: 'cp_' + i + '_' + j,
      at: now + j, kind: 'log', text: 'CHECKPOINT ' + i + ' / ' + j + ' ' + ' x'.repeat(full ? 95 : 10) })),
  };
}

async function fixture(host = current, { scene = 'normal', policy, events, setup, engine = new host.MemoryEngine() } = {}) {
  engine.configLoaded = true;
  const projectDir = path.join(temp, String(serial++));
  const handoffDir = path.join(projectDir, 'handoff');
  const paths = { ws: 'fixture-workspace', userDir: iso, projectDir, handoffDir,
    planPath: path.join(handoffDir, 'PLAN.md'), reflectDir: path.join(projectDir, 'reflections') };
  await mkdir(handoffDir, { recursive: true });
  engine.memToday = () => '2026-11-22';
  engine.resolvePaths = async () => paths;
  engine.config.eventMaxActiveInInject = 5;
  if (policy !== undefined) engine.config.deliveryPolicy = policy;
  Object.assign(engine.state, { ws: paths.ws, _injectTierPre: 'human_full' });
  if (scene === 'full') {
    engine.state.userText = 'LOCK_USER ' + 'user '.repeat(750);
    engine.state.notesText = 'LOCK_PROJECT ' + 'project '.repeat(700);
  }
  if (setup) await setup(engine, paths);
  const count = { empty: 0, normal: 3, full: 10 }[scene];
  const records = events ?? Array.from({ length: count }, (_, i) => event(i, scene === 'full' ? 5 : 1, { full: scene === 'full' }));
  await writeFile(path.join(handoffDir, EVENT_STORE_FILENAME), JSON.stringify({ events: records }));
  await engine.refreshEventStatePre();
  return { engine, frame: engine.renderMemoryDynamic({}), paths };
}

function units(edit = {}) {
  return validatePolicy({ schemaVersion: 2, presetId: 'human_full', deliveryMode: 'units', ...edit });
}

function requireBaseline(mode, scene, frame) {
  const measured = digest(frame);
  assert.deepEqual([measured.jsChars, measured.utf8Bytes, measured.sha256], baseline[mode][scene], `${mode}/${scene} frame differs from its frozen baseline`);
  return measured;
}

test('C0/C1 three modes, default and null frames against pre-edit baselines', async t => {
  for (const scene of Object.keys(baseline.eventView)) {
    const legacy = await fixture(current, { scene, policy: { deliveryMode: 'legacy' }, setup: useBaselineWording });
    const eventView = await fixture(current, { scene, policy: { deliveryMode: 'eventView' }, setup: useBaselineWording });
    const byDefault = await fixture(current, { scene, setup: useBaselineWording });
    const nullPolicy = await fixture(current, { scene, policy: null, setup: useBaselineWording });
    const selected = await fixture(current, { scene, policy: units(), setup: useBaselineWording });
    assert.equal(byDefault.frame, eventView.frame, `${scene} missing policy must use eventView`);
    assert.equal(nullPolicy.frame, eventView.frame, `${scene} null policy must use eventView`);
    t.diagnostic(JSON.stringify({ scene,
      legacy: requireBaseline('legacy', scene, legacy.frame),
      eventView: requireBaseline('eventView', scene, eventView.frame),
      units: requireBaseline('units', scene, selected.frame),
    }));
    assert.ok(selected.frame !== eventView.frame, `${scene} units must enter the production assembler`);
  }
});

test('C0b save rejects an illegal mode without writes and hand-edited config loads eventView with visible degradation', async t => {
  const valid = { schemaVersion: 2, presetId: 'human_full', deliveryMode: 'eventView' };
  const invalid = { ...valid, deliveryMode: 'bogus' };
  const engine = new current.MemoryEngine();
  const configPath = path.join(iso, 'dsh-auto-memory.json');
  engine._configPath = configPath;
  await writeFile(configPath, JSON.stringify({ deliveryPolicy: valid }));
  engine.loadConfigSync();
  const original = await readFile(configPath);
  await assert.rejects(() => engine.saveConfig({ deliveryPolicy: invalid }), /deliveryMode/);
  assert.deepEqual(await readFile(configPath), original);
  for (const load of ['loadConfigSync', 'loadConfig']) {
    await writeFile(configPath, JSON.stringify({ ...JSON.parse(original), deliveryPolicy: invalid }));
    const fresh = new current.MemoryEngine();
    fresh._configPath = configPath;
    await fresh[load]();
    const loaded = await fixture(current, { engine: fresh });
    assert.ok(loaded.frame.includes('Event 2 · 最近更新'), `${load} must render the eventView card`);
    const debug = await fresh.debugInfo();
    assert.equal(debug.deliveryMode?.mode, 'eventView');
    assert.ok(debug.deliveryMode?.degradations?.some(entry => entry.code === 'invalid-delivery-mode'), JSON.stringify(debug.deliveryMode));
    t.diagnostic(`${load}: ${JSON.stringify(debug.deliveryMode)}`);
  }
});

function matchesCheckpoint(frame) {
  const markers = frame.match(/CHECKPOINT \d+ \/ \d+/g) ?? [];
  assert.equal(new Set(markers).size, markers.length, 'duplicate checkpoint content in frame');
  return markers;
}

const emptyRuleConfig = { rulesLayeringMode: 'off' };
function withSmallLocks(engine, paths) {
  Object.assign(engine.config, emptyRuleConfig);
  Object.assign(engine.state, {
    userText: 'USER_LOCK_TAIL_🧠', notesText: 'PROJECT_LOCK_TAIL_🧠',
    userFile: path.join(paths.userDir, 'MEMORY.md'), notesPath: path.join(paths.projectDir, 'MEMORY.md'),
  });
}

async function requireDisabledAndOvercommit(host) {
  const limits = { jsChars: 20, utf8Bytes: 25 };
  const result = await fixture(host, { events: [event(0, 1)], setup: withSmallLocks,
    policy: units({ transport: limits, modules: {
      rules: { enabled: false }, plan: { enabled: false }, handoff: { enabled: false },
      events: { enabled: false }, portrait: { enabled: false }, semantic: { enabled: false },
      calendar: { enabled: false }, externalMemory: { enabled: false }, workspaceMap: { enabled: false },
      recentLogs: { enabled: false }, reflection: { enabled: false },
    } }) });
  const { frame, engine } = result;
  assert.ok(!frame.includes('Event summary 0.') && !frame.includes('CHECKPOINT 0 / 0'), 'C3 disabled events appear in frame');
  assert.ok(frame.includes('USER_LOCK_TAIL_🧠'), 'C6 user lock disappeared');
  assert.ok(frame.includes('PROJECT_LOCK_TAIL_🧠'), 'C6 project lock disappeared');
  const receipt = receiptOf(await engine.debugInfo());
  assert.equal(receipt.budgetOvercommit, true, 'C6 locked sections exceed the requested limit');
  assert.ok(receipt.staticCost.jsChars > 0, 'C6 static discipline is charged to the same budget');
  assert.equal(receipt.m6Included, false, 'C6 M6 is independently budgeted');
  assert.equal(receipt.dynamicCost.jsChars, frame.length, 'C6 receipt measures the actual dynamic frame');
  assert.equal(receipt.dynamicCost.utf8Bytes, Buffer.byteLength(frame), 'C6 receipt measures actual dynamic UTF-8');
  assert.ok(receipt.degradations.some(item => item.code === 'budgetOvercommit'));
  return receipt;
}

function receiptOf(debug) {
  const receipt = debug.unitDelivery;
  assert.equal(receipt?.mode, 'units', 'production debugInfo must expose the units receipt');
  return receipt;
}

test('C3/C6 disabled modules stay absent and lock tails survive whole-frame overcommit', async t => {
  const ordinary = await fixture(current, { events: [event(0, 1)],
    policy: units({ modules: { events: { enabled: false } } }) });
  assert.ok(!ordinary.frame.includes('Event summary 0.') && !ordinary.frame.includes('CHECKPOINT 0 / 0'));
  const receipt = await requireDisabledAndOvercommit(current);
  t.diagnostic(JSON.stringify(receipt));
});

async function ruleViews(host) {
  const phrase = '必须保持事件来源可追溯';
  const body = '- ' + phrase + '，以便在宿主升级后稳定复核。' + '这是历史验证材料。'.repeat(12);
  const setup = engine => {
    engine.state.userText = '# User memory\n\n## 用户规约\n\n' + body;
    engine.config.rulesLayeringMode = 'self';
  };
  const full = await fixture(host, { scene: 'empty', setup,
    policy: units({ modules: { rules: { view: 'full' } } }) });
  const pointer = await fixture(host, { scene: 'empty', setup,
    policy: units({ modules: { rules: { view: 'pointer' } } }) });
  const count = (text, value) => text.split(value).length - 1;
  assert.ok(count(full.frame, phrase) > count(pointer.frame, phrase), 'C4 full rule body is also present in the pointer form');
  assert.ok(Buffer.byteLength(full.frame) > Buffer.byteLength(pointer.frame), 'C4 full frame must be larger');
  assert.match(pointer.frame, /memory_rules\s+op=list/, 'C4 policy pointer must include a readback instruction');
  return { fullBytes: Buffer.byteLength(full.frame), pointerBytes: Buffer.byteLength(pointer.frame) };
}

test('C4 rule view renders either the full rule or a readable pointer', async t => {
  t.diagnostic(JSON.stringify(await ruleViews(current)));
});

async function familyQuota(host) {
  const { frame, engine } = await fixture(host, { events: [event(0, 1), event(1, 0, { status: 'paused' })],
    policy: units({ modules: { events: { quotas: [{ unit: 'event', scope: 'event', max: 2, strength: 'hard' }] } } }),
  });
  const receipt = receiptOf(await engine.debugInfo());
  const counts = receipt.counts.events;
  assert.equal((counts?.event ?? 0) + (counts?.checkpoint ?? 0) + (counts?.catalogEntry ?? 0), 2, 'C5 family quota must cap all three kinds');
  const lines = frame.split('\n').filter(line => /^\[(?:事件|检查点|事件目录) #evt_/.test(line));
  assert.equal(lines.length, 2, 'C5 budget must apply to the emitted frame');
  return { counts, lines };
}

test('C5 event, checkpoint and catalogEntry share a two-unit family quota', async t => {
  t.diagnostic(JSON.stringify(await familyQuota(current)));
});

function replaceOne(text, anchor, replacement) {
  const first = text.indexOf(anchor);
  assert.ok(first >= 0 && text.indexOf(anchor, first + anchor.length) === -1, `mutation requires a unique anchor: ${anchor}`);
  return text.slice(0, first) + replacement + text.slice(first + anchor.length);
}

async function importableCopy(url, label, rewrite) {
  const before = (await readFile(url, 'utf8')).replaceAll('\r\n', '\n');
  const changed = rewrite(before).replace(/(\bfrom\s+)(['"])(\.\.?\/[^'"]+)\2/g,
    (_, keyword, quote, relative) => keyword + JSON.stringify(new URL(relative, url).href));
  const file = path.join(temp, label + '.mjs');
  await writeFile(file, changed);
  return pathToFileURL(file);
}

async function engineVariant(label, rewrite) {
  const src = (await readFile(indexUrl, 'utf8')).replaceAll('\r\n', '\n');
  const out = path.join(temp, 'index-' + label + '.js');
  await writeFile(out, rewrite(src));
  process.env.DAM_AUDIT_ENGINE_SOURCE = out;
  try {
    const copy = new URL(engineUrl);
    copy.searchParams.set('mutation', label);
    const host = await import(copy);
    hosts.push(host);
    return host;
  } finally {
    delete process.env.DAM_AUDIT_ENGINE_SOURCE;
  }
}

async function deliveryVariant(label, rewrite) {
  const module = await importableCopy(deliveryUrl, 'delivery-' + label, rewrite);
  return engineVariant(label, src => replaceOne(src, "from './injection/unit-delivery.js'", 'from ' + JSON.stringify(module.href)));
}

test('C7a narrowing family match to exact kind breaches the real frame quota', async t => {
  const label = 'family-exact';
  const exact = await importableCopy(policyUrl, 'selector-' + label, src => replaceOne(src,
    `quota.unit === unitKind\n    || (quota.scope === 'event' && EVENT_FAMILY.includes(unitKind))`,
    'quota.unit === unitKind'));
  const adapter = await importableCopy(adapterUrl, 'adapter-' + label, src => replaceOne(src,
    "from './unit-policy.js'", 'from ' + JSON.stringify(exact.href)));
  const mutant = await deliveryVariant(label, src => replaceOne(replaceOne(src,
    "from './unit-policy.js'", 'from ' + JSON.stringify(exact.href)),
    "from './unit-adapters.js'", 'from ' + JSON.stringify(adapter.href)));
  await assert.rejects(() => familyQuota(mutant), /C5 family quota must cap all three kinds/);
  await familyQuota(current);
  t.diagnostic('exact unitKind quota: CAUGHT, restored production PASS');
});

test('C7b overcommit does not classify a disabled module as deferred', async t => {
  const skip = `      if (!entry.enabled) {\n        rejected.push(makeRejected(entry.unit, 'module-disabled'))\n        continue\n      }\n`;
  const mutated = await importableCopy(policyUrl, 'selector-overcommit-ignores-enable', src => replaceOne(src, skip, ''));
  const mutant = await deliveryVariant('overcommit-ignores-enable', src => replaceOne(src,
    "from './unit-policy.js'", 'from ' + JSON.stringify(mutated.href)));
  const verify = async host => {
    const receipt = await requireDisabledAndOvercommit(host);
    assert.ok(receipt.rejectedCount > 0, 'C7 disabled units must be rejected before budget deferral');
    assert.equal(receipt.deferredCount, 0, 'C7 disabled units must not be deferred');
  };
  await assert.rejects(() => verify(mutant), /C7 disabled units must be rejected/);
  await verify(current);
  t.diagnostic('disabled overcommit guard removal: CAUGHT, restored production PASS');
});

test('C7d substituting the full body for a policy pointer is caught in the frame', async t => {
  const mutant = await deliveryVariant('pointer-is-full', src => replaceOne(src,
    "if (representation === 'pointer') return raw.pointer || READ_POINTER[raw.moduleId] || ''", "if (representation === 'pointer') return raw.text"));
  await assert.rejects(() => ruleViews(mutant), /C4 full rule body is also present in the pointer form/);
  await ruleViews(current);
  t.diagnostic('pointer replaced with full body: CAUGHT, restored production PASS');
});

test('C7c bypassing the eventView branch breaks the frozen batch-A frame', async t => {
  const mutant = await engineVariant('event-view-bypassed', source => replaceOne(source,
    `if (typeof readDeliveryMode === 'function' && readDeliveryMode(cfg).mode === 'units') {`,
    `if (typeof readDeliveryMode === 'function' && readDeliveryMode(cfg).mode !== 'legacy') {`));
  const run = async host => requireBaseline('eventView', 'normal', (await fixture(host, {
    policy: { schemaVersion: 2, presetId: 'human_full', deliveryMode: 'eventView' },
    setup: useBaselineWording,
  })).frame);
  await assert.rejects(() => run(mutant), /eventView\/normal frame differs/);
  await run(current);
  t.diagnostic('eventView branch bypass: CAUGHT, restored production PASS');
});

test('C2 production frames contain exactly 3, 1 and 5 checkpoint bodies at the corresponding configured limits', async t => {
  for (const max of [3, 1, 5]) {
    const { frame } = await fixture(current, { events: [event(0, 5)],
      policy: units({ modules: { events: { quotas: [{ unit: 'checkpoint', scope: 'module', max, strength: 'hard' }] } } }),
    });
    const markers = matchesCheckpoint(frame);
    assert.equal(markers.length, max, `production frame checkpoint limit ${max}`);
    t.diagnostic(`${max}: ${markers.join(', ')}`);
  }
});

const SHARED_BODY = 'D4_EXACT_LEDGER_BODY_X';
const NEAR_BODY = 'D4_EXACT_LEDGER_BODY_Y';
const OTHER_FIELD = 'D4_KEEP_NEXT_STEP';
const EXACT_LEDGER = '## 目标\n' + SHARED_BODY;
const DISABLED_EVENT_UNIT = { unit: 'event', scope: 'module', max: 0, strength: 'hard' };

function dedupeEvent(checkpoint) {
  const ev = event(0, 1);
  return { ...ev, checkpoints: [{ ...ev.checkpoints[0], text: '', ...checkpoint }] };
}

async function dedupeFrame(host, { checkpoint = { text: SHARED_BODY }, ledger = EXACT_LEDGER,
  policy = units(), tier = 'human_full', slim = false } = {}) {
  const { engine, frame } = await fixture(host, { events: [dedupeEvent(checkpoint)], policy,
    setup: engine => Object.assign(engine.state, { latestHandoffText: ledger, _injectTierPre: tier }) });
  return { frame: slim ? engine.renderSlimSnapshotPre() : frame, receipt: engine.state._unitDeliveryReceiptPre };
}

const occurrences = (frame, body) => frame.split(body).length - 1;

function reportDedupe(result) {
  const { frame, receipt } = result;
  const { jsChars, utf8Bytes } = measureFrame(frame);
  assert.deepEqual(receipt.dynamicCost, { jsChars, utf8Bytes });
  return { jsChars, utf8Bytes, selectedCount: receipt.selectedCount, rejectedCount: receipt.rejectedCount,
    budgetOvercommit: receipt.budgetOvercommit,
    excerpt: frame.split('\n').filter(line => line.startsWith('## 目标') || line.includes(SHARED_BODY)) };
}

test('D4-2 full exact matches keep the ledger and reduce real frame cost against isolated pre-dedupe assembly', async t => {
  const mutant = await deliveryVariant('dedupe-disabled', src => replaceOne(src,
    'const covers = ledgerBodyCoveragePre([...owners.values()].map(owner => owner.body))', 'const covers = () => false'));
  async function verify(host) {
    const result = await dedupeFrame(host);
    assert.equal(occurrences(result.frame, SHARED_BODY), 1, 'exact ledger content must appear once');
    return result;
  }
  await assert.rejects(() => verify(mutant), /exact ledger content must appear once/);
  const before = reportDedupe(await dedupeFrame(mutant));
  const after = reportDedupe(await verify(current));
  assert.equal(after.selectedCount, before.selectedCount - 1);
  assert.equal(after.rejectedCount, before.rejectedCount);
  assert.ok(after.jsChars < before.jsChars && after.utf8Bytes < before.utf8Bytes);
  assert.equal(after.budgetOvercommit, before.budgetOvercommit);
  assert.deepEqual(after.excerpt, ['## 目标', SHARED_BODY]);
  t.diagnostic(JSON.stringify({ before, after, mutation: 'disabled exact match CAUGHT, production PASS' }));
});

test('D4-2 CRLF and boundary whitespace normalize, only the matching checkpoint field is omitted', async t => {
  const multiline = SHARED_BODY + '\n保留边界 🧠';
  const cases = [
    { ledger: '## 目标\n前段\n\n' + multiline + '\n\n末段',
      checkpoint: { goal: '  ' + multiline.replaceAll('\n', '\r\n') + '  ', next: OTHER_FIELD } },
    { ledger: '## 目标\r\n' + multiline.replaceAll('\n', '\r\n'),
      checkpoint: { text: '  ' + multiline + '  ' } },
  ];
  for (const { ledger, checkpoint } of cases) {
    const result = await dedupeFrame(current, { checkpoint, ledger });
    assert.equal(occurrences(result.frame, SHARED_BODY), 1);
    assert.ok(result.frame.includes('## 目标') && result.frame.includes('保留边界 🧠'));
    assert.equal(result.frame.includes('下一步：' + OTHER_FIELD), !!checkpoint.next);
    assert.ok(!result.frame.includes('目标：' + SHARED_BODY));
    reportDedupe(result);
  }
  const slim = await dedupeFrame(current, { tier: 'human_slim', slim: true });
  assert.equal(occurrences(slim.frame, SHARED_BODY), 1);
  assert.deepEqual(reportDedupe(slim).excerpt, ['## 目标', SHARED_BODY]);
  t.diagnostic('normalized multiline content, distinct next field, and slim assembly validated');
});

test('D4-2 repeated checkpoint ids cannot borrow another checkpoint’s field offsets', async t => {
  const shared = 'same';
  const source = event(0, 2);
  source.checkpoints[0] = { ...source.checkpoints[0], id: 'same-id', text: 'plain text' };
  source.checkpoints[1] = { ...source.checkpoints[1], id: 'same-id', text: '', goal: shared, next: 'diff' };
  const base = { events: [source], setup: engine => { engine.state.latestHandoffText = '## 目标\n' + shared; }, policy: units() };
  const wrongOffsets = await deliveryVariant('dedupe-borrowed-offsets', src => {
    let mutated = replaceOne(src, 'const fieldsByUnit = new WeakMap()', 'const fieldsByUnit = new Map()');
    mutated = replaceOne(mutated, 'fieldsByUnit.set(unit,', 'fieldsByUnit.set(unit.sourceRef,');
    return replaceOne(mutated, 'fieldsByUnit.get(unit)', 'fieldsByUnit.get(unit.sourceRef)');
  });
  async function verify(host) {
    const { frame } = await fixture(host, base);
    assert.ok(frame.includes('[检查点 #evt_00000001] plain text'), 'preserve unaffiliated checkpoint bytes');
  }
  await assert.rejects(() => verify(wrongOffsets), /preserve unaffiliated checkpoint bytes/);
  await verify(current);
  const normalizedId = await dedupeFrame(current, { checkpoint: { sourceRef: ' padded ', goal: SHARED_BODY, next: OTHER_FIELD } });
  assert.equal(occurrences(normalizedId.frame, SHARED_BODY), 1);
  assert.ok(normalizedId.frame.includes(OTHER_FIELD));
  t.diagnostic('field offsets keyed by duplicate ids: CAUGHT, production PASS');
});

test('D4-2 sanitization cannot turn distinct interior whitespace into a match', async t => {
  const body = 'D4_LINE_A\n\nD4_LINE_B';
  const different = body.replace('\n\n', '\n\n\n');
  const mutant = await deliveryVariant('dedupe-cleaned-whitespace', src => replaceOne(src,
    "if (raw.unitKind === 'checkpoint' && (bodyChanged || changed && raw.checkpointFields))",
    "if (raw.unitKind === 'checkpoint' && changed && raw.checkpointFields)"));
  async function verify(host, checkpointBody, ledgerBody) {
    const { frame } = await dedupeFrame(host, { checkpoint: { text: checkpointBody }, ledger: '## 目标\n' + ledgerBody });
    assert.equal(occurrences(frame, body), 2, 'authored interior whitespace difference must remain');
  }
  await assert.rejects(() => verify(mutant, different, body), /authored interior whitespace difference must remain/);
  await verify(current, different, body);
  await verify(current, body, different);
  t.diagnostic('match after sanitization only: CAUGHT, production PASS');
});

test('D4-2 compatibility modes still retain both copies of the same text', async t => {
  for (const deliveryMode of ['eventView', 'legacy']) {
    const { frame } = await dedupeFrame(current, { policy: units({ deliveryMode }) });
    assert.equal(occurrences(frame, SHARED_BODY), 2, deliveryMode);
    t.diagnostic(deliveryMode + ': matching body still occurs twice');
  }
});

test('D4-2 absent, disabled, quota-rejected, pointer and incomplete ledgers cannot cover a checkpoint', async t => {
  const cases = [
    { name: 'empty', ledger: '' },
    { name: 'disabled', policy: units({ modules: { handoff: { enabled: false } } }) },
    { name: 'quota', policy: units({ modules: { handoff: { quotas: [{ unit: 'ledgerSection', scope: 'module', max: 0, strength: 'hard' }] } } }) },
    { name: 'pointer', ledger: '## 任务状态\n' + SHARED_BODY + '\n## 目标\nOther goal',
      tier: 'human_slim', policy: units({ presetId: 'human_slim', modules: { events: { quotas: [DISABLED_EVENT_UNIT] } } }) },
    { name: 'trimmed', ledger: EXACT_LEDGER + '\n\n' + 'padding '.repeat(140) },
  ];
  for (const { name, ...input } of cases) {
    const result = await dedupeFrame(current, input);
    assert.ok(result.frame.includes('[检查点 #evt_00000001] ' + SHARED_BODY), name);
    if (name === 'pointer') assert.ok(result.frame.includes('· type:state'));
    assert.ok(!result.receipt.degradations.some(row => row.code === 'checkpoint-body-covered-by-ledger'), name);
    t.diagnostic(name + ': checkpoint preserved');
  }
});

test('D4-2 equal-length one-character differences survive, with isolated length-only mutation', async t => {
  const fp = await importableCopy(dedupeUrl, 'dedupe-by-length', src => src.replaceAll('computeExactDigest(', 'StringLength(')
    + '\nfunction StringLength(text) { return text.length }\n');
  const mutant = await deliveryVariant('dedupe-length-only', src => replaceOne(src,
    "from './inject-dedupe.js'", 'from ' + JSON.stringify(fp.href)));
  async function verify(host) {
    const { frame } = await dedupeFrame(host, { checkpoint: { text: NEAR_BODY } });
    assert.equal(occurrences(frame, SHARED_BODY), 1, 'ledger remains');
    assert.equal(occurrences(frame, NEAR_BODY), 1, 'one-character difference must remain');
  }
  await assert.rejects(() => verify(mutant), /one-character difference must remain/);
  await verify(current);
  t.diagnostic('length-only fingerprint CAUGHT, production PASS');
});

test('D4-2 reruns the budget using revised selections, with isolated stale-cost mutation', async t => {
  const staleUrl = await importableCopy(deliveryUrl, 'dedupe-stale-budget', src => replaceOne(src,
    '    selection = next\n    selectionDegradations = revisedDegradations',
    '    selection = { ...next, cost: selection.cost }\n    selectionDegradations = revisedDegradations'));
  const stale = await import(staleUrl.href);
  const snapshot = collectDeliveryEventUnitsPre({ events: [dedupeEvent({ text: SHARED_BODY })], now });
  const aux = 'D4_OPTIONAL_BUDGET_RECOVERY';
  const args = { policy: units({ modules: { events: { quotas: [DISABLED_EVENT_UNIT] } } }),
    phase: 'human_full', sourceSnapshot: snapshot, sources: { handoffText: EXACT_LEDGER },
    parts: [{ kind: 'budget-probe', text: aux }] };
  const beforeDedupeBudget = SHARED_BODY.length + '\n[检查点 #evt_00000001] '.length + EXACT_LEDGER.length + 1;
  function verify(compose) {
    const { text, receipt } = compose({ ...args, budgetChars: beforeDedupeBudget });
    assert.ok(text.includes(aux), 'released budget must admit the optional segment');
    assert.ok(measureFrame(text, { jsChars: beforeDedupeBudget }).ok);
    assert.deepEqual(receipt.dynamicCost, { jsChars: text.length, utf8Bytes: Buffer.byteLength(text) });
    assert.equal(receipt.budgetOvercommit, false);
  }
  assert.throws(() => verify(stale.composeUnitDeliveryPre), /released budget must admit the optional segment/);
  verify(composeUnitDeliveryPre);
  t.diagnostic('stale post-dedupe cost CAUGHT, production PASS');
});

test('D4-2 newly admitted complete ledger sections also cover matching checkpoints', async t => {
  const goal = 'D4_FIRST_LEDGER_SECTION';
  const progress = 'D4_SECOND_LEDGER_SECTION';
  const ev = event(0, 2);
  ev.checkpoints[0].text = goal;
  ev.checkpoints[1].text = progress;
  const snapshot = collectDeliveryEventUnitsPre({ events: [ev], now });
  const goalBlock = '## 目标\n' + goal;
  const progressBlock = '## 进度与下一步\n' + progress;
  const checkpointHeader = '\n[检查点 #evt_00000001] ';
  const args = { policy: units({ modules: { events: { quotas: [DISABLED_EVENT_UNIT] } } }),
    phase: 'human_full', sourceSnapshot: snapshot, sources: { handoffText: goalBlock + '\n' + progressBlock },
    budgetChars: (checkpointHeader + goal + checkpointHeader + progress + '\n' + goalBlock).length };
  const onePassUrl = await importableCopy(deliveryUrl, 'dedupe-first-owner-only', src => replaceOne(src,
    '    deduped = true\n  }', '    deduped = true\n    break\n  }'));
  const onePass = await import(onePassUrl.href);
  function verify(compose) {
    const { text, receipt } = compose(args);
    assert.ok(text.includes(goalBlock) && text.includes(progressBlock), 'the freed space admits the second ledger section');
    assert.equal(occurrences(text, progress), 1, 'the second full ledger section covers its checkpoint');
    assert.equal(receipt.selectedCount, 2);
    assert.ok(measureFrame(text, { jsChars: args.budgetChars }).ok);
  }
  assert.throws(() => verify(onePass.composeUnitDeliveryPre), /the second full ledger section covers its checkpoint/);
  verify(composeUnitDeliveryPre);
  t.diagnostic('one pass missing a newly admitted owner: CAUGHT, production PASS');
});

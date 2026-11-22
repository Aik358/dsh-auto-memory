import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test, { after } from 'node:test';
import { pathToFileURL } from 'node:url';
import { EVENT_STORE_FILENAME } from '../../lib/event-store.js';
import { validatePolicy } from '../../lib/injection/policy-v2.js';

const engineUrl = new URL('../lib/audit-engine.mjs', import.meta.url);
const indexUrl = new URL('../../lib/index.js', import.meta.url);
const policyUrl = new URL('../../lib/injection/unit-policy.js', import.meta.url);
const adapterUrl = new URL('../../lib/injection/unit-adapters.js', import.meta.url);
const deliveryUrl = new URL('../../lib/injection/unit-delivery.js', import.meta.url);
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
};

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
    const legacy = await fixture(current, { scene, policy: { deliveryMode: 'legacy' } });
    const eventView = await fixture(current, { scene, policy: { deliveryMode: 'eventView' } });
    const byDefault = await fixture(current, { scene });
    const nullPolicy = await fixture(current, { scene, policy: null });
    const selected = await fixture(current, { scene, policy: units() });
    assert.equal(byDefault.frame, eventView.frame, `${scene} missing policy must use eventView`);
    assert.equal(nullPolicy.frame, eventView.frame, `${scene} null policy must use eventView`);
    t.diagnostic(JSON.stringify({ scene,
      legacy: requireBaseline('legacy', scene, legacy.frame),
      eventView: requireBaseline('eventView', scene, eventView.frame),
      units: digest(selected.frame),
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

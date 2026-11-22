import assert from 'node:assert/strict';
import test from 'node:test';
import * as fs from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { fileURLToPath } from 'node:url';
import { validatePolicy, resolvePolicy, legacyToPolicy } from '../../lib/injection/policy-v2.js';
import { parseWaterThresholds } from '../../lib/injection/cadence.js';
import { previewDelivery } from '../../lib/injection/preview.js';
import { projectHandoffPre } from '../../lib/injection/project-handoff.js';
import { parseHandoffLedgerPre, weightedTrimHandoffLedgerPre } from '../../lib/handoff-anchor.js';

const indexUrl = new URL('../../lib/index.js', import.meta.url);
const policyUrl = new URL('../../lib/injection/policy-v2.js', import.meta.url);
const repo = fileURLToPath(new URL('../../', import.meta.url));
const INDEX = (await fs.readFile(indexUrl, 'utf8')).replaceAll('\r\n', '\n');
const HEAD = execFileSync('git', ['show', '96bfded8:lib/index.js'], {
  cwd: repo, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024,
}).replaceAll('\r\n', '\n');
const root = await fs.mkdtemp(path.join(tmpdir(), 'dam-delivery-runtime-'));
const oldHome = process.env.DSH_HOME;
process.env.DSH_HOME = root;
const hosts = [];
test.after(async () => {
  try {
    await Promise.all(hosts.map(host => host.flushDiagnostics()));
    const resolvedRoot = await fs.realpath(root);
    assert.equal(path.dirname(resolvedRoot), await fs.realpath(tmpdir()), 'cleanup is confined to this test directory');
    assert(path.basename(resolvedRoot).startsWith('dam-delivery-runtime-'));
    await fs.rm(resolvedRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  } finally {
    if (oldHome === undefined) delete process.env.DSH_HOME;
    else process.env.DSH_HOME = oldHome;
  }
});

function anchor(source, key) {
  const at = source.indexOf(key);
  assert(at >= 0 && source.indexOf(key, at + key.length) === -1, 'expected one production anchor: ' + key);
  return at;
}
function slice(source, start, end) {
  const a = anchor(source, start), b = source.indexOf(end, a + start.length);
  assert(b > a, 'missing closing anchor: ' + end);
  return source.slice(a, b);
}
function replace(source, old, next) {
  const a = anchor(source, old);
  return source.slice(0, a) + next + source.slice(a + old.length);
}
async function importSource(source, baseUrl, out, label) {
  const code = source.replace(/\bfrom '(\.\/[^']+)'/g, (_, s) => 'from ' + JSON.stringify(new URL(s, baseUrl).href))
    .replace(/\bimport\('(\.\/[^']+)'\)/g, (_, s) => 'import(' + JSON.stringify(new URL(s, baseUrl).href) + ')')
    .replaceAll('import.meta.url', JSON.stringify(baseUrl.href));
  try {
    return await import('data:text/javascript;base64,' + Buffer.from(code + '\n' + out + '\n//# sourceURL=dam-runtime-' + label + '.mjs').toString('base64'));
  } catch (error) {
    throw new Error(label + ': ' + String(error.message).split(' imported from data:')[0]);
  }
}
async function loadHost(source, label) {
  const context = slice(source, '  const disposeContext = ctx.systemPrompt.context({', '\n  })') + '\n  });';
  const marker = '      path: API.config,\n      handler: ';
  const config = slice(source, marker, '\n      },').slice(marker.length) + '\n      }';
  const host = await importSource(source, indexUrl, `
    export { MemoryEngine };
    export const flushDiagnostics = () => _diagChain;
    export const bindConfig = (engine) => { const panelAllowedHosts = []; return (${config}); };
    export const bindDynamic = (engine) => {
      let text;
      const ctx = { systemPrompt: { context(spec) { text = spec.text; return () => {}; } } };
      ${context}
      return text;
    };
  `, label);
  hosts.push(host);
  return host;
}
const current = await loadHost(INDEX, 'current');
const historical = await loadHost(HEAD, 'head');
const policy = (overrides = {}) => validatePolicy({ schemaVersion: 2, presetId: 'human_full', ...overrides });

const FULL = '<memory_system>\n白板 PLAN.md\n完整正文：汉字🧠\n[降级] 合成快照尾注\n</memory_system>';
const SLIM = '<memory_system>SLIM</memory_system>';
const fullOnly = text => text.includes('白板 PLAN.md');
const mark = text => fullOnly(text) ? 'F' : text.includes('SLIM') ? 'S' : '-';
function fixture(host, config = {}, { actual = false } = {}) {
  const engine = new host.MemoryEngine();
  Object.assign(engine.config, {
    snapshotMinGapRounds: 999, slimEveryRounds: 3, fullInjectWaterPct: 'off', snapshotTieredInject: true,
    snapshotReinjectOnCompact: true, tier0CatalogEnabled: false, handoffEnabled: false,
    locale: 'zh-CN', rulesLayeringMode: 'off', ...config,
  });
  const agent = { id: 'delivery-agent', session: { id: 'delivery-session', header: { cwd: root }, events: [] } };
  const st = engine.runtimeFor(agent).state;
  Object.assign(st, { ws: root, loadedAt: Date.now(), waterLevelRatio: 0 });
  engine.memToday = () => '2026-11-18';
  engine.capturePathsFor = () => {};
  engine.refresh = async () => {};
  engine.isUnattendedNow = () => false;
  engine.renderReflectionRequest = () => '';
  const degradations = [];
  engine._degradeSink = { record: (...args) => { degradations.push(args); return Promise.resolve(); } };
  let full = FULL;
  if (!actual) {
    engine.renderMemoryDynamic = () => full;
    engine.renderSlimSnapshotPre = () => SLIM;
  }
  const fn = host.bindDynamic(engine);
  let seq = 100, seqTurn = 0;
  const run = ({ human = true, ratio = 0, usage, snap = FULL, repeat = false, compact = false } = {}) => {
    st.loadedAt = Date.now();
    st.waterLevelRatio = ratio;
    full = snap;
    if (!repeat) {
      seqTurn += 1;
      if (seqTurn > 1) agent.session.events.push({ seq: ++seq, type: 'step/end', data: { step: seqTurn - 1 } });
      agent.session.events.push({ seq: ++seq, type: 'turn/start', data: { turn: seqTurn } });
      if (human) agent.session.events.push({ seq: ++seq, type: 'user/message', data: { source: { kind: 'user' } } });
      if (compact) agent.session.events.push({ seq: ++seq, type: 'compaction/summary', data: {} });
      agent.session.events.push({ seq: ++seq, type: 'step/start', data: { turn: seqTurn, step: seqTurn } });
      // Production sets this fact in its pre-step hook, before the host callback runs.
      st._humanPending = human;
    }
    return fn({ agent, usage });
  };
  return { engine, agent, st, run, degradations };
}

const stateMark = 'STATE-SHOULD-BE-OMITTED';
const ledger = (goal, dead, next) => [
  '# 交接', '## 目标 [type:goal]', 'G'.repeat(goal), '## 任务状态 [type:state]', stateMark,
  '## 已试方案与失败原因 [type:dead-end]', 'D'.repeat(dead), 'FAILURE-END',
  '## 进度与下一步 [type:progress]', 'N'.repeat(next), 'NEXT-STEP',
].join('\n');
const sample787 = ledger(919, 300, 313);
const LEDGER_START = '      const ledgerPart = (() => {';
const LEDGER_END = '      if (ledgerPart) pushPart';

// Historical closure from the pre-A1 production anchor. Whitespace/comments are omitted.
const oldLedgerBody = `
  const _LEDGER_FULL_TIERS = ['human_full', 'post_compact', 'handoff_carry', 'hang_compensate', 'legacy'];
  const _ledgerProfile = _LEDGER_FULL_TIERS.indexOf(String(_tier)) >= 0 ? 'full' : 'slim';
  const _finish = (sel) => {
    const _base = typeof weightedTrimHandoffLedgerPre === 'function'
      ? weightedTrimHandoffLedgerPre(_ledgerRaw, _ledgerBudget) : null;
    const _budgeted = (typeof _base === 'string' && _base)
      ? _base : truncateLinesBounded(_ledgerRaw, _ledgerBudget);
    if (!sel) return _budgeted;
    return _budgeted.length <= sel.length ? _budgeted : sel;
  };
  if (typeof projectHandoffPre === 'function') {
    try {
      const _bdL = projectHandoffPre({ planText: '', latestHandoffText: _ledgerRaw, tier: _tier,
        policy: { profile: _ledgerProfile } });
      const _sel = (_bdL && typeof _bdL.ledgerPart === 'string') ? _bdL.ledgerPart : '';
      return _finish(_sel || _ledgerRaw);
    } catch (_eBdL) {
      try {
        _bdDegradations.push({ scope: 'ledger', code: 'handoff-projection-failed', tier: _tier, profile: _ledgerProfile });
      } catch (_eD2) {}
      return _finish(_ledgerRaw);
    }
  }
  return _weighted || truncateLinesBounded(_ledgerRaw, _ledgerBudget);`;
const baselinePath = process.env.DAM_A1_BEFORE_INDEX;
const archivedPreviousSource = baselinePath && (await fs.readFile(baselinePath, 'utf8')).replaceAll('\r\n', '\n');
function oldLedgerProjection(raw) {
  const body = archivedPreviousSource ? slice(archivedPreviousSource, LEDGER_START, LEDGER_END) + '\nreturn ledgerPart;' : oldLedgerBody;
  const run = new Function('projectHandoffPre', '_tier', '_ledgerRaw', '_ledgerBudget', 'weightedTrimHandoffLedgerPre',
    'truncateLinesBounded', '_weighted', '_bdDegradations', body);
  let selected;
  const realProjection = input => {
    const result = projectHandoffPre(input);
    selected = result.ledgerPart;
    return result;
  };
  const degradations = [];
  const text = run(realProjection, 'run_full', raw, 800, weightedTrimHandoffLedgerPre,
    () => assert.fail('the production weigher did not run'), null, degradations);
  assert.deepEqual(degradations, []);
  return { selected, text };
}
function realLedger(host, raw, tier) {
  const F = fixture(host, { handoffEnabled: true, handoffLedgerChars: 800 }, { actual: true });
  Object.assign(F.st, { latestHandoffText: raw, _injectTierPre: tier });
  return { text: F.engine.withAgent(F.agent, () => F.engine.renderMemoryDynamic({ agent: F.agent })), st: F.st, degradations: F.degradations };
}

function ledgerClosure(source, raw, tier) {
  const run = new Function('projectHandoffPre', 'parseHandoffLedgerPre', 'weightedTrimHandoffLedgerPre', 'truncateLinesBounded',
    '_tier', '_ledgerRaw', '_ledgerBudget', '_bdDegradations', slice(source, LEDGER_START, LEDGER_END) + '\nreturn ledgerPart;');
  const degradations = [];
  const text = run(projectHandoffPre, parseHandoffLedgerPre, weightedTrimHandoffLedgerPre,
    () => assert.fail('the production weigher did not run'), tier, raw, 800, degradations);
  return { text, degradations };
}

function segmentWindow(meta, kind) {
  let start = 0;
  for (const segment of meta.segments) {
    const end = start + segment.chars;
    if (segment.kind === kind) return { start, end };
    start = end;
  }
  return null;
}

const request = async (fn, method, body) => {
  const req = Readable.from(body === undefined ? [] : [Buffer.from(JSON.stringify(body))]);
  Object.assign(req, { method, headers: { host: 'localhost' }, socket: { remoteAddress: '127.0.0.1' } });
  const out = {};
  await fn(req, { writeHead(status) { out.status = status; }, end(text) { out.data = JSON.parse(text); } });
  return out;
};

test('01 HEAD and A1 emit byte-identical FSSS output on four consecutive humans', async t => {
  const evaluate = host => {
    const F = fixture(host);
    const rows = [1, 2, 3, 4].map(n => F.run({ snap: FULL + '\nrequest ' + n }));
    assert.equal(rows.map(mark).join(''), 'FSSS');
    return rows;
  };
  const baseline = evaluate(historical);
  assert.deepEqual(evaluate(current), baseline);
  const renderedBytes = host => {
    const F = fixture(host, {}, { actual: true });
    F.st.userText = 'FULL-ONLY-MEMORY-FIXTURE';
    F.st.notesText = 'Project note for the complete frame.';
    const rows = Array.from({ length: 4 }, () => F.run());
    assert.equal(rows.map(row => !row ? '-' : row.includes('FULL-ONLY-MEMORY-FIXTURE') ? 'F' : 'S').join(''), 'FSSS');
    return rows;
  };
  assert.deepEqual(renderedBytes(current), renderedBytes(historical));
  const mutant = await loadHost(replace(INDEX, 'const _grantByHuman = false', 'const _grantByHuman = _reqHumanNow'), 'human-bypass');
  assert.throws(() => evaluate(mutant), { code: 'ERR_ASSERTION' });
  t.diagnostic('mutation human bypass: rejected by FSSS assertion; original stays byte-equal');
});

test('02 direct [] remains closed in production and 25.5 is a real trigger', async t => {
  assert.deepEqual(parseWaterThresholds([]), []);
  for (const value of [undefined, null, '', 'bad']) assert.deepEqual(parseWaterThresholds(value), [25]);
  assert.deepEqual(legacyToPolicy({ fullInjectWaterPct: '25.5' }).triggers.waterPct, [25.5]);
  for (const illegal of [[0], [100.01], [25.555], [25.5, 25.5], ['25.5']]) {
    assert.throws(() => policy({ triggers: { waterPct: illegal } }), /waterPct/);
  }
  const trajectory = (host, selected, legacy = '25') => {
    const F = fixture(host, { fullInjectWaterPct: legacy,
      ...(selected === undefined ? {} : { deliveryPolicy: policy({ triggers: { waterPct: selected, fullGapRounds: 999 } }) }) });
    const rows = [F.run(), F.run({ ratio: 0.253 }), F.run({ ratio: 0.256, human: false }), F.run({ ratio: 0.256 })];
    return { marks: rows.map(mark).join(''), fired: F.st._waterPctFired || 0 };
  };
  const expectClosed = host => assert.deepEqual(trajectory(host, []), { marks: 'FSSS', fired: 0 });
  expectClosed(current);
  assert.deepEqual(trajectory(current, [25.5]), { marks: 'FSSF', fired: 25.5 });
  assert.deepEqual(trajectory(current, undefined, '25.5'), { marks: 'FSSF', fired: 25.5 });
  const mutant = await loadHost(replace(INDEX, 'const _wpList = _stepTriggersPre?.waterPct ?? parseWaterPctThresholdsPre(_wpRaw)',
    'const _wpList = _stepTriggersPre?.waterPct?.length ? _stepTriggersPre.waterPct : parseWaterPctThresholdsPre(_wpRaw)'), 'water-reopened');
  assert.throws(() => expectClosed(mutant), { code: 'ERR_ASSERTION' });
  expectClosed(current);
  t.diagnostic('mutation empty policy threshold reopened at 25: rejected by actual callback');
});

test('03 cross-tier resolution/preview preserve valid edits, safely reset representation, and reject explicit illegal settings', async t => {
  const slim = policy({ presetId: 'human_slim', representation: { preferred: 'summary', fallback: ['pointer', 'omit'] },
    triggers: { fullGapRounds: 56 }, modules: { rules: { enabled: false } } });
  const assertHumanFull = o => {
    assert.equal(o.contentTier, 'human_full');
    assert.deepEqual(o.policy.representation, { preferred: 'full', fallback: ['omit'] });
    assert.equal(o.policy.triggers.fullGapRounds, 56);
    assert.equal(o.policy.modules.rules.enabled, false);
  };
  const input = { tier: 'human_full', overrides: slim };
  assertHumanFull(resolvePolicy(input));
  const preview = previewDelivery({ policy: slim, tier: 'human_full', sources: { 'user-memory': { text: 'M' }, 'project-notes': { text: 'N' } } });
  assert.equal(preview.receipt.contentTier, 'human_full');
  assert.equal(preview.partial, true);
  assert.throws(() => policy({ representation: slim.representation }), /human_full allows only full or whole-unit omit/);
  const src = (await fs.readFile(policyUrl, 'utf8')).replaceAll('\r\n', '\n');
  const cross = slice(src, '        delete edits.presetId;', '\n      }\n    } else {');
  const mutant = await importSource(replace(src, cross,
    '        delete edits.presetId;\n        policy = validatePolicy(merge(PRESETS[contentTier], edits));'), policyUrl, '', 'cross-unsafe');
  assert.throws(() => assertHumanFull(mutant.resolvePolicy(input)), /human_full allows only full or whole-unit omit/);
  assertHumanFull(resolvePolicy(input));
  t.diagnostic('mutation restored raw cross-tier merge: rejected by the target representation contract');
});

test('04 exact 1679 -> 1625 -> 787 old ledger defect; new production omits state from short, long and malformed ledgers', t => {
  assert.equal(sample787.length, 1679);
  const old = oldLedgerProjection(sample787);
  assert.equal(old.selected.length, 1625);
  assert.equal(old.text.length, 787);
  assert.match(old.text, /type:state/);
  assert(old.text.includes(stateMark));
  const safe = value => {
    assert(!value.includes(stateMark) && !value.includes('type:state'), 'slim leaked a task-state unit');
  };
  assert.throws(() => safe(old.text), { code: 'ERR_ASSERTION' });
  const malformedRaw = stateMark + ' type:state';
  const testLedgers = [sample787, ledger(6, 5, 7), ledger(1900, 302, 305),
    ledger(6, 5, 7).replace(/ \[(type:[^\]]+)\]/g, '\n<!-- $1 -->')];
  const verifyClosure = (source, tier) => {
    for (const raw of testLedgers) {
      const out = ledgerClosure(source, raw, tier);
      safe(out.text);
      assert(out.text.includes('FAILURE-END') && out.text.includes('NEXT-STEP'), tier + ' dropped failure or next-step sample');
      assert(out.text.length <= 800, tier + ' exceeded the 800 character ledger body budget');
    }
  };
  const mutant = replace(INDEX, "return _finish(_selected.join('\\n'))", 'return _finish(_ledgerRaw)');
  assert.throws(() => verifyClosure(mutant, 'run_full'), /slim leaked a task-state unit/);
  for (const tier of ['run_full', 'run_slim']) {
    verifyClosure(INDEX, tier);
    const malformed = ledgerClosure(INDEX, malformedRaw, tier);
    assert.equal(malformed.text, '');
    assert(malformed.degradations.some(item => /handoff-(projection-failed|ledger-no-eligible-sections)/.test(item.code)), 'malformed projection is observable');
    for (const raw of testLedgers) {
      const out = realLedger(current, raw, tier);
      assert(!out.text.includes(stateMark));
      const window = segmentWindow(out.st.envelopeMeta, 'handoff-ledger');
      if (tier === 'run_slim') assert.equal(window, null, 'the live reminder frame has no ledger segment');
      else {
        assert(window, 'run_full must really include the ledger segment');
        const body = out.text.slice(window.start, window.end);
        safe(body);
        assert(body.includes('FAILURE-END') && body.includes('NEXT-STEP'));
      }
    }
  }
  const failedInHost = realLedger(current, malformedRaw, 'run_full');
  assert.equal(segmentWindow(failedInHost.st.envelopeMeta, 'handoff-ledger'), null);
  assert.match(JSON.stringify(failedInHost.degradations), /scope=ledger; tier=run_full; code=handoff-(projection-failed|ledger-no-eligible-sections)/);
  assert(realLedger(current, ledger(6, 5, 7), 'human_full').text.includes(stateMark));
  t.diagnostic('historical budget-before-selection mutation leaks state; new production keeps the selected profile');
});

test('05 trigger reader is saved only; the host preserves legacy values and defaults', async t => {
  const { effectiveTriggers, resolveRuntimePolicy, frameTransport } = await import('../../lib/injection/policy-runtime.js');
  const old = { snapshotMinGapRounds: 999, slimEveryRounds: 3, fullInjectWaterPct: 'off', snapshotTieredInject: true,
    hangCompensateEnabled: true, hangCompensateTokens: 500, injectBudgetChars: 1 };
  const saved = policy({ triggers: { fullGapRounds: 2, slimEveryRounds: 1, waterPct: [40], tieredInject: false,
    hangCompensateEnabled: false, hangCompensateTokens: 700 } });
  const expected = { fullGapRounds: 2, slimEveryRounds: 1, waterPct: [40], tieredInject: false,
    hangCompensateEnabled: false, hangCompensateTokens: 700 };
  const explicit = { ...old, deliveryPolicy: saved };
  const resolved = resolveRuntimePolicy(explicit);
  const legacy = resolveRuntimePolicy(old);
  assert.deepEqual(effectiveTriggers(explicit), expected);
  assert.deepEqual(effectiveTriggers(explicit, resolved), expected);
  assert.equal(resolved.source, 'saved');
  assert.equal(legacy.source, 'legacy');
  assert.deepEqual(resolveRuntimePolicy(undefined), { policy: null, source: 'none' });
  assert.equal(frameTransport(old), null);
  const assertSavedOnly = read => {
    assert.equal(read(old), null, 'legacy triggers must be read only by the host');
    assert.equal(read(), null);
    assert.equal(read({}), null);
    assert.equal(read({ ...old, deliveryPolicy: null }), null);
    assert.equal(read(old, legacy), null, 'a derived policy never participates in production');
    assert.throws(() => read({ deliveryPolicy: { schemaVersion: 2, presetId: 'unknown' } }), { code: 'invalid-delivery-policy' });
  };
  assertSavedOnly(effectiveTriggers);
  const runtimeUrl = new URL('../../lib/injection/policy-runtime.js', import.meta.url);
  const runtimeSrc = (await fs.readFile(runtimeUrl, 'utf8')).replaceAll('\r\n', '\n');
  const withSecondFallback = await importSource(replace(runtimeSrc, '  if (!t) return null;',
    '  if (!t) return legacyToPolicy(config).triggers;'), runtimeUrl, '', 'duplicate-trigger-fallback');
  assert.throws(() => assertSavedOnly(withSecondFallback.effectiveTriggers), { code: 'ERR_ASSERTION' });
  assertSavedOnly(effectiveTriggers);
  t.diagnostic('mutation reinstates legacy trigger fallback in policy-runtime: rejected by the saved-only contract');
  const play = (host, cfg) => {
    const { run } = fixture(host, cfg);
    return [0, 1, 2, 3].map(n => mark(run({ snap: FULL + '\n' + n }))).join('');
  };
  assert.equal(play(current, old), 'FSSS');
  assert.equal(play(current, { ...old, deliveryPolicy: saved }), 'FFFF');
  const assertCadence = host => assert.equal(play(host, { ...old, deliveryPolicy: policy({
    triggers: { fullGapRounds: 2, slimEveryRounds: 1, waterPct: [], tieredInject: true },
  }) }), 'FSFS');
  assertCadence(current);
  const mutated = await loadHost(replace(INDEX,
    'const fullGapStep = Math.max(1, _stepTriggersPre?.fullGapRounds ?? parseGapRoundsPre(engine.config.snapshotMinGapRounds, 40))',
    'const fullGapStep = Math.max(1, parseGapRoundsPre(engine.config.snapshotMinGapRounds, 40))'), 'ignore-saved-gap');
  assert.throws(() => assertCadence(mutated), { code: 'ERR_ASSERTION' });
  assertCadence(current);
  const slimProgress = (host, config) => {
    const F = fixture(host, { ...old, ...config });
    return [1, 2, 3, 4].map(n => {
      F.run({ human: false, snap: FULL + '\n' + n });
      return F.st._lastSlimStepSeq;
    });
  };
  assert.deepEqual(slimProgress(current, {}), [1, 1, 1, 4]);
  assert.deepEqual(slimProgress(current, { deliveryPolicy: policy({ triggers: {
    fullGapRounds: 999, slimEveryRounds: 1, waterPct: [],
  } }) }), [1, 2, 3, 4]);
  const defaultFull = fixture(current, { ...old, snapshotMinGapRounds: undefined });
  const fullSteps = [];
  for (let step = 1; step <= 41; step++) {
    if (mark(defaultFull.run({ snap: FULL + '\n' + step })) === 'F') fullSteps.push(step);
  }
  assert.deepEqual(fullSteps, [1, 41], 'the old full gap defaults to 40 in the host callback');
  const defaultSlim = fixture(current, { ...old, slimEveryRounds: undefined });
  const slimSteps = [];
  for (let step = 1; step <= 16; step++) {
    defaultSlim.run({ human: false, snap: FULL + '\n' + step });
    if (defaultSlim.st._lastSlimStepSeq === step) slimSteps.push(step);
  }
  assert.deepEqual(slimSteps, [1, 16], 'the old slim interval defaults to 15 in the host callback');
  const defaultWater = fixture(current, { ...old, fullInjectWaterPct: undefined });
  assert.equal([0, 0.26, 0.51].map(ratio => mark(defaultWater.run({ ratio }))).join(''), 'FFS');
  assert.equal(defaultWater.st._waterPctFired, 25, 'the old water defaults to 25 in the host callback');
  const hang = (host, config) => {
    const F = fixture(host, { ...old, hangCompensateEnabled: false, ...config });
    F.engine.isUnattendedNow = () => true;
    const frames = [0, 60, 45].map(outputTokens => F.run({ human: false, usage: { outputTokens } }));
    return { frames: frames.map(mark).join(''), count: F.st._hangCompensateCount || 0 };
  };
  assert.deepEqual(hang(current, {}), { frames: 'FSS', count: 0 });
  assert.deepEqual(hang(current, { deliveryPolicy: policy({ triggers: {
    fullGapRounds: 999, hangCompensateEnabled: true, hangCompensateTokens: 100, waterPct: [],
  } }) }), { frames: 'FSF', count: 1 });
  t.diagnostic('mutation read old full gap despite saved policy: rejected by host cadence');
});

const receipt = F => {
  assert(F.st._deliveryTransportReceiptPre, 'final dynamic host boundary did not log a transport receipt');
  return F.st._deliveryTransportReceiptPre;
};
const disableTransport = () => replace(INDEX,
  'const _deliveryTransportPre = _savedPolicyPre && !_useDeliveryUnitsPre ? frameTransport(engine.config, _runtimePolicyPre) : null',
  'const _deliveryTransportPre = null');

test('06 hard transport measures the full UTF-16/UTF-8 text; excess yields no injected fragment', async t => {
  const { measureFrame } = await import('../../lib/injection/policy-runtime.js');
  const mm = measureFrame('汉🧠A', { strength: 'hard', jsChars: 4, utf8Bytes: 7 });
  assert.equal(mm.jsChars, 4);
  assert.equal(mm.utf8Bytes, 8);
  assert.equal(mm.ok, false);
  assert.equal(measureFrame('汉🧠A', { strength: 'hard', utf8Bytes: 8 }).ok, true);
  assert.throws(() => policy({ transport: { strength: 'hard', jsChars: 10, overflowAllowance: { jsChars: 1 } } }), /allowance/i);
  const assertHard = host => {
    const F = fixture(host, { deliveryPolicy: policy({ transport: { strength: 'hard', jsChars: FULL.length,
      utf8Bytes: Buffer.byteLength(FULL) - 1 } }) });
    assert.equal(F.run(), '', 'a byte-only overflow must fail the whole frame');
    const r = receipt(F);
    assert.equal(r.ok, false);
    assert.deepEqual([r.jsChars, r.utf8Bytes], [FULL.length, Buffer.byteLength(FULL)]);
    assert(r.degradations.includes('transport-hard-limit-exceeded'));
    assert.equal(F.run({ repeat: true }), '');
  };
  assertHard(current);
  const under = fixture(current, { deliveryPolicy: policy({ transport: { strength: 'hard', jsChars: FULL.length,
    utf8Bytes: Buffer.byteLength(FULL) } }) });
  assert.equal(under.run(), FULL);
  const mutant = await loadHost(disableTransport(), 'no-transport');
  assert.throws(() => assertHard(mutant), { code: 'ERR_ASSERTION' });
  assertHard(current);
  t.diagnostic('mutation bypass final transport completely: rejected on the byte-only overflow');
});

test('07 the two lock sources survive old flags; a tight hard cap fails without slicing them', async t => {
  const lockText = { userText: 'LOCKED-USER-FIXTURE\n用户记忆 🧠', notesText: 'LOCKED-PROJECT-FIXTURE\n项目记忆' };
  const flags = { 'user-memory': false, 'project-notes': false, 'rules-section': false };
  const stand = (host, cfg = {}) => {
    const F = fixture(host, { promptSectionToggles: flags, ...cfg }, { actual: true });
    Object.assign(F.st, lockText);
    return F;
  };
  const assertBothPresent = host => {
    const text = stand(host).run();
    assert(text.includes('LOCKED-USER-FIXTURE') && text.includes('LOCKED-PROJECT-FIXTURE'), 'old flags must not close locked sources');
    return text;
  };
  const text = assertBothPresent(current);
  const chosen = stand(current, { deliveryPolicy: policy({ transport: { strength: 'hard', jsChars: text.length - 1 } }) });
  assert.equal(chosen.run(), '');
  assert(receipt(chosen).degradations.includes('locked-content-does-not-fit'));
  const runTier = stand(current).run({ human: false });
  assert(runTier && !runTier.includes('LOCKED-USER-FIXTURE') && !runTier.includes('LOCKED-PROJECT-FIXTURE'));
  assert.throws(() => policy({ lockedModules: ['project-notes'] }), /locked/i);
  const mutant = await loadHost(replace(INDEX,
    "if (secToggles[kind] === false && kind !== 'user-memory' && kind !== 'project-notes')",
    'if (secToggles[kind] === false)'), 'lock-flags');
  assert.throws(() => assertBothPresent(mutant), /old flags must not close locked sources/);
  assertBothPresent(current);
  t.diagnostic('legacy false flags cannot suppress the two sources; whole-frame failure keeps them intact');
});

test('08 soft allowance admits measured target overflow and makes allowance excess observable', async t => {
  const soft = allowance => policy({ transport: { strength: 'soft', jsChars: FULL.length - 1,
    overflowAllowance: { jsChars: allowance } } });
  const accept = fixture(current, { deliveryPolicy: soft(1) });
  assert.equal(accept.run(), FULL);
  const allowed = receipt(accept);
  assert.equal(allowed.ok, true);
  assert.equal(allowed.jsChars, FULL.length);
  assert.equal(allowed.excess.jsChars, 1, 'target overflow is still measured');
  assert(allowed.degradations.includes('transport-soft-target-exceeded'));
  const assertExcess = host => {
    const reject = fixture(host, { deliveryPolicy: soft(0) });
    assert.equal(reject.run(), '', 'an unstructured fixture may fail, but it may not be truncated');
    const r = receipt(reject);
    assert.equal(r.ok, false);
    assert(r.degradations.includes('transport-soft-allowance-exceeded'));
  };
  assertExcess(current);
  const mutant = await loadHost(disableTransport(), 'no-transport');
  assert.throws(() => assertExcess(mutant), { code: 'ERR_ASSERTION' });
  assertExcess(current);
  const renderSources = (host, configured) => {
    const F = fixture(host, configured, { actual: true });
    Object.assign(F.st, { recentLogs: [{ date: '2026-11-17', text: 'OPTIONAL-LOG-FIXTURE\n' + 'L'.repeat(60) }],
      userText: 'LOCKED-USER-SPILL', notesText: 'LOCKED-PROJECT-SPILL' });
    return F;
  };
  const baseline = renderSources(current);
  const full = baseline.run();
  const optional = segmentWindow(baseline.st.envelopeMeta, 'recent-logs');
  assert(optional && full.includes('OPTIONAL-LOG-FIXTURE'));
  const expected = full.slice(0, optional.start) + full.slice(optional.end);
  const canOmit = host => {
    const trim = renderSources(host, { deliveryPolicy: policy({ transport: { strength: 'soft', jsChars: expected.length,
      overflowAllowance: { jsChars: 0 } } }) });
    assert.equal(trim.run(), expected, 'soft transport can omit a proved whole optional segment');
    assert.deepEqual(receipt(trim).omitted, ['recent-logs']);
    assert(expected.includes('LOCKED-USER-SPILL') && expected.includes('LOCKED-PROJECT-SPILL'));
    assert.equal(trim.run({ repeat: true }), expected);
  };
  canOmit(current);
  const skipWhole = await loadHost(replace(INDEX, 'if (soft && !measured.ok && !replay && meta?.transportOmittable?.length',
    'if (false && soft && !measured.ok && !replay && meta?.transportOmittable?.length'), 'no-whole-omission');
  assert.throws(() => canOmit(skipWhole), /soft transport can omit a proved whole optional segment/);
  canOmit(current);
  t.diagnostic('mutation bypass final transport: rejected on allowance overflow');
});

test('09 /config rollback physically removes policy, exposes legacy after reopen and stays removed on later save', async t => {
  const configFile = path.join(root, 'dsh-auto-memory.json');
  const disk = async () => JSON.parse(await fs.readFile(configFile, 'utf8'));
  const create = host => {
    const engine = new host.MemoryEngine();
    engine.refresh = async () => {};
    return { engine, route: host.bindConfig(engine) };
  };
  const initial = { memoryRoot: path.join(root, 'memory'), userMemoryDir: path.join(root, 'user'), handoffEnabled: false,
    snapshotMinGapRounds: 13, slimEveryRounds: 7, fullInjectWaterPct: '28', snapshotGapDefaultsVersion: 3,
    slimEveryDefaultsVersion: 2, waterPctDefaultsVersion: 1, deliveryPolicy: null };
  const exercise = async host => {
    await fs.writeFile(configFile, JSON.stringify(initial));
    const { route, engine } = create(host);
    const first = await request(route, 'GET');
    assert.equal(first.status, 200, JSON.stringify(first.data));
    assert.equal(first.data.deliveryPolicy.compatibility.source, 'legacy');
    assert(!Object.hasOwn(engine.config, 'deliveryPolicy'), 'a legacy persisted null must read as absent');
    const saved = await request(route, 'POST', { deliveryPolicy: policy({ triggers: { waterPct: [] } }) });
    assert.equal(saved.status, 200, JSON.stringify(saved.data));
    assert.deepEqual((await disk()).deliveryPolicy.triggers.waterPct, []);
    const beforeInvalid = await fs.readFile(configFile, 'utf8');
    const invalid = await request(route, 'POST', { deliveryPolicy: { schemaVersion: 2, presetId: 'human_full', triggers: { waterPct: [25.555] } } });
    assert.equal(invalid.status, 400);
    assert.equal(await fs.readFile(configFile, 'utf8'), beforeInvalid);
    const cleared = await request(route, 'POST', { deliveryPolicy: null });
    assert.equal(cleared.status, 200, JSON.stringify(cleared.data));
    assert(!Object.hasOwn(await disk(), 'deliveryPolicy'), 'rollback must remove the key from the JSON');
    assert(!Object.hasOwn(engine.config, 'deliveryPolicy'), 'rollback must remove the key from live config');
    const reopened = create(host);
    const got = await request(reopened.route, 'GET');
    assert.equal(got.status, 200);
    assert.equal(got.data.deliveryPolicy.compatibility.source, 'legacy');
    assert.deepEqual(got.data.deliveryPolicy.triggers.waterPct, [28]);
    assert.equal(got.data.deliveryPolicy.triggers.fullGapRounds, 13);
    const again = await request(reopened.route, 'POST', { slimEveryRounds: 6 });
    assert.equal(again.status, 200, JSON.stringify(again.data));
    assert(!Object.hasOwn(await disk(), 'deliveryPolicy'), 'unrelated save must not resurrect the removed default');
    assert.equal((await disk()).fullInjectWaterPct, '28');
    assert.equal((await disk()).slimEveryRounds, 6, 'the A1 legacy API must still accept legacy writes');
  };
  await exercise(current);
  const mutant = await loadHost(replace(INDEX, 'if (next.deliveryPolicy == null) delete next.deliveryPolicy',
    'if (next.deliveryPolicy == null) next.deliveryPolicy = null'), 'save-null');
  await assert.rejects(() => exercise(mutant), /rollback must remove the key from the JSON/);
  await exercise(current);
  t.diagnostic('mutation writes null instead of removing the key: rejected on actual disk JSON');
});

test('10 saved enabled controls only dynamic delivery; absent policy keeps old gate and legacy budget is not a cap', async t => {
  const check = host => {
    const closed = fixture(host, { injectEnabled: true, deliveryPolicy: policy({ enabled: false }) });
    assert.equal(closed.run(), '');
    assert.equal(closed.st._reqTextPre, undefined);
    assert(closed.engine.renderMemoryStatic().trim());
    assert.equal(fixture(host, { injectEnabled: false, deliveryPolicy: policy() }).run(), FULL);
    assert.equal(fixture(host, { injectEnabled: false }).run(), '');
    assert.equal(fixture(host, { injectBudgetChars: 1 }).run(), FULL);
    assert.equal(fixture(host, { injectBudgetChars: 1, deliveryPolicy: null }).run(), FULL);
    assert.equal(fixture(host, { injectBudgetChars: 1, deliveryPolicy: policy({ transport: { strength: 'hard', jsChars: 1 } }) }).run(), '');
  };
  check(current);
  const mutant = await loadHost(replace(INDEX,
    "if (_savedPolicyPre ? _savedPolicyPre.enabled === false : engine.config && engine.config.injectEnabled === false) return ''",
    "if (engine.config && engine.config.injectEnabled === false) return ''"), 'ignore-saved-enabled');
  assert.throws(() => check(mutant), { code: 'ERR_ASSERTION' });
  check(current);
  const compactCfg = { snapshotReinjectOnCompact: true };
  const compactSaved = { ...compactCfg, deliveryPolicy: policy({ triggers: { postCompact: 'off', waterPct: [], fullGapRounds: 999 } }) };
  const compactTrajectory = (host, settings) => {
    const F = fixture(host, settings);
    return [F.run(), F.run({ compact: true, snap: FULL + '\nCOMPACT-FRAME' })];
  };
  const priorCompact = compactTrajectory(historical, compactCfg);
  assert.equal(priorCompact.map(mark).join(''), 'FF');
  assert.deepEqual(compactTrajectory(current, compactSaved), priorCompact, 'the policy field stays preview-only during A1');
  const map = (moduleEnabled, sectionEnabled) => {
    const F = fixture(current, { deliveryPolicy: policy({ modules: { workspaceMap: { enabled: moduleEnabled } } }),
      promptSectionToggles: { 'workspace-map': sectionEnabled } }, { actual: true });
    F.st.workspaceMap = ['WORKSPACE-MAP-FIXTURE'];
    return F.run().includes('WORKSPACE-MAP-FIXTURE');
  };
  assert.equal(map(false, true), true, 'A1 does not wire module enablement');
  assert.equal(map(true, false), false, 'the existing section switch remains authoritative');
  t.diagnostic('mutation reuses the old gate with a saved policy: rejected. Legacy transport remains observational.');
});

test('11 hard transport rejection and duplicate do not consume a pending water grant', async t => {
  const saved = jsChars => policy({ triggers: { waterPct: [25], fullGapRounds: 999 }, transport: { strength: 'hard', jsChars } });
  const check = host => {
    const F = fixture(host, { deliveryPolicy: saved(8000) });
    assert.equal(F.run({ ratio: 0.24 }), FULL);
    const staticBefore = F.engine.renderMemoryStatic();
    assert(staticBefore.length > 0);
    const before = F.st._waterPctFired;
    assert.equal(before || 0, 0);
    F.engine.config.deliveryPolicy = saved(0);
    const crossing = FULL + '\nWATER-25-FULL-FIXTURE';
    assert.equal(F.run({ ratio: 0.26, snap: crossing }), '');
    const rejected = receipt(F);
    assert.equal(rejected.ok, false);
    assert.equal(rejected.jsChars, crossing.length, 'the rejected frame must be the full grant');
    assert(rejected.degradations.includes('transport-hard-limit-exceeded'));
    assert.equal(F.st._waterPctFired, before, 'a rejected full frame must leave the water threshold pending');
    assert.equal(F.run({ ratio: 0.26, snap: crossing, repeat: true }), '');
    assert.deepEqual(receipt(F), rejected);
    assert.equal(F.st._waterPctFired, before);
    assert.equal(F.engine.renderMemoryStatic(), staticBefore, 'the dynamic zero cap does not limit the static section');
    F.engine.config.deliveryPolicy = saved(8000);
    assert.equal(F.run({ ratio: 0.26, snap: crossing }), crossing);
    assert.equal(receipt(F).ok, true);
    assert.equal(F.st._waterPctFired, 25);
    assert.equal(mark(F.run({ ratio: 0.26, snap: crossing + '\nNEXT' })), 'S');
  };
  check(current);
  const mutant = await loadHost(replace(INDEX, 'if (!measured.ok && _deliveryStatePre) {',
    'if (false && !measured.ok && _deliveryStatePre) {'), 'consume-rejected-water');
  assert.throws(() => check(mutant), /a rejected full frame must leave the water threshold pending/);
  check(current);
  t.diagnostic('mutation skips request-state restore: 25 was consumed without delivery; restored path retries exactly once');
});

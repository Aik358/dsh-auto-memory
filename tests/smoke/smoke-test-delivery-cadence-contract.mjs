#!/usr/bin/env node
/**
 * P1 finite CA/DTO contract changes. Executes owning modules, without live host or files.
 * DSH_DELIVERY_CADENCE_TEST_ROOT selects only the isolated mutation copy used by the
 * outside-repository verifier; normal execution resolves this repository from this file.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

const repo = process.env.DSH_DELIVERY_CADENCE_TEST_ROOT
  ? path.resolve(process.env.DSH_DELIVERY_CADENCE_TEST_ROOT)
  : path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const cadence = await import(pathToFileURL(path.join(repo, 'lib/injection/cadence.js')).href);
const dto = await import(pathToFileURL(path.join(repo, 'lib/injection/dto.js')).href);
const call = cadence.decideInjectionCadencePre;
const real = (over = {}) => ({
  _stepSeq: 1, _lastFullStepSeq: 0, _lastSlimStepSeq: 0,
  compactionSeq: 1, _compactSeqSeenPre: 1, waterPct: 10, _waterPctFired: 0,
  ...over,
});
const decide = (over = {}) => call({
  state: real(), signals: {}, frame: {}, config: {}, requestKey: 'request-1', ...over,
});
const legacyDto = (over = {}) => ({
  tier: 'slim', fullGranted: false, slimAllowed: true,
  grants: ['slim-every'], reasons: ['fixture'], requestKey: 'request-1', ...over,
});
const deepFreeze = value => {
  if (value && typeof value === 'object') {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
};

test('all five existing positive human aliases survive as the explicit actor field', () => {
  const cases = [
    ['signals.isHumanTurn', { signals: { isHumanTurn: true } }],
    ['signals.isHuman', { signals: { isHuman: true } }],
    ['state.humanTurn', { state: real({ humanTurn: true }) }],
    ['state._humanPending', { state: real({ _humanPending: true }) }],
    ['state._humanPendingNow', { state: real({ _humanPendingNow: true }) }],
  ];
  for (const [label, over] of cases) {
    const decision = decide(over);
    assert.equal(decision.isHuman, true, label);
    assert.equal(decision.tier, 'full', label + ': existing r3 human bypass retained');
    assert(decision.grants.includes('human-turn'), label);
  }
});

test('false aliases do not erase an existing positive pending signal', () => {
  const decision = decide({
    signals: { isHumanTurn: false, isHuman: false },
    state: real({ humanTurn: false, _humanPending: false, _humanPendingNow: true }),
  });
  assert.equal(decision.isHuman, true);
  assert(decision.grants.includes('human-turn'));
});

test('absent or non-true aliases report false without granting human full', () => {
  for (const value of [undefined, false, null, 0, 1, 'true']) {
    const decision = decide({
      signals: { isHumanTurn: value, isHuman: value },
      state: real({ humanTurn: value, _humanPending: value, _humanPendingNow: value }),
    });
    assert.equal(decision.isHuman, false, String(value));
    assert.equal(decision.fullGranted, false);
    assert(!decision.grants.includes('human-turn'));
  }
});

test('isHuman remains independent of full grants from first-frame, carry, hang and compression', () => {
  for (const over of [
    { signals: { firstFrame: true } },
    { signals: { handoffCarry: true } },
    { signals: { hangCompensate: true } },
    { state: real({ compactionSeq: 2 }) },
  ]) {
    const decision = decide(over);
    assert.equal(decision.fullGranted, true);
    assert.equal(decision.isHuman, false);
  }
  const humanCarry = decide({ signals: { isHuman: true, handoffCarry: true } });
  assert.equal(humanCarry.isHuman, true);
  assert(humanCarry.grants.includes('handoff-carry'));
  assert(!humanCarry.grants.includes('human-turn'), 'existing priority is not rewritten');
});

test('DTO preserves explicit boolean actor and defaults old calls to false', () => {
  const previous = dto.makeCadenceDecision(legacyDto());
  assert.equal(previous.isHuman, false);
  assert.equal(previous.tier, 'slim');
  assert.equal(dto.makeCadenceDecision(legacyDto({ isHuman: true })).isHuman, true);
  assert.equal(dto.makeCadenceDecision(legacyDto({ isHuman: false })).isHuman, false);
  assert.equal(dto.makeCadenceDecision(legacyDto({ isHuman: true })).fullGranted, false,
    'actor is not a grant');
  const current = decide({ signals: { isHuman: true } });
  const roundTrip = dto.makeCadenceDecision({
    tier: current.tier, isHuman: current.isHuman, fullGranted: current.fullGranted,
    slimAllowed: current.slimAllowed, grants: current.grants,
    reasons: current.reasons, requestKey: current.requestKey,
  });
  assert.equal(roundTrip.isHuman, true);
  assert.equal(roundTrip.fullGranted, true);
  assert.deepEqual(JSON.parse(JSON.stringify(roundTrip)), roundTrip);
});

test('DTO rejects invalid present isHuman values instead of coercing them', () => {
  for (const value of [null, 0, 1, 'true', {}, []]) {
    assert.throws(() => dto.makeCadenceDecision(legacyDto({ isHuman: value })), error =>
      error.code === 'injection-invalid-argument' && error.field === 'CadenceDecision.isHuman');
  }
});

test('ordinary 100-step run uses the new 40/15 fallbacks and commits only allowed frames', () => {
  const state = real({ _stepSeq: 0 });
  const fullSteps = [], slimSteps = [];
  for (let step = 1; step <= 100; step++) {
    state._stepSeq = step;
    const decision = call({ state, config: {}, requestKey: 'run:' + step });
    assert.equal(decision.isHuman, false);
    if (decision.fullGranted) {
      fullSteps.push(step);
      state._lastFullStepSeq = step;
    } else if (decision.slimAllowed) {
      slimSteps.push(step);
      state._lastSlimStepSeq = step;
    }
  }
  assert.deepEqual(fullSteps, [40, 80]);
  assert.deepEqual(slimSteps, [15, 30, 55, 70, 95]);
  assert(fullSteps.length <= 3);
  assert(slimSteps.length <= 7);
});

test('new default boundaries differ from 20/8 while explicit zero and one keep their intent', () => {
  assert.equal(decide({ state: real({ _stepSeq: 20 }) }).fullGranted, false);
  assert.equal(decide({ state: real({ _stepSeq: 39 }) }).fullGranted, false);
  assert.equal(decide({ state: real({ _stepSeq: 40 }) }).fullGranted, true);
  assert.equal(decide({ state: real({ _stepSeq: 8 }) }).slimAllowed, false);
  assert.equal(decide({ state: real({ _stepSeq: 14 }) }).slimAllowed, false);
  assert.equal(decide({ state: real({ _stepSeq: 15 }) }).slimAllowed, true);
  assert.equal(decide({ config: { snapshotMinGapRounds: 0 } }).fullGranted, true);
  const everyStep = decide({ config: { snapshotMinGapRounds: 999, slimEveryRounds: 1 } });
  assert.equal(everyStep.fullGranted, false);
  assert.equal(everyStep.slimAllowed, true);
  const explicitOld = decide({ state: real({ _stepSeq: 8 }), config: {
    snapshotMinGapRounds: 20, slimEveryRounds: 8,
  } });
  assert.equal(explicitOld.fullGranted, false);
  assert.equal(explicitOld.slimAllowed, true);
});

test('human and human-water grants bypass ordinary cadence without changing their existing cause', () => {
  const state = real({ _stepSeq: 100, _lastFullStepSeq: 100, _lastSlimStepSeq: 100 });
  const config = { snapshotMinGapRounds: 999, slimEveryRounds: 999 };
  const human = decide({ state, config, signals: { isHumanTurn: true } });
  assert.equal(human.fullGranted, true);
  assert.equal(human.isHuman, true);
  assert(human.grants.includes('human-turn'));
  const water = decide({ state: { ...state, waterPct: 26 }, config,
    signals: { isHuman: true } });
  assert.equal(water.fullGranted, true);
  assert.equal(water.isHuman, true);
  assert.deepEqual(water.grants, ['water-25']);
  assert.equal(water.observed.waterFireAt, 25);
  const noHuman = decide({ state: { ...state, waterPct: 99 }, config });
  assert.equal(noHuman.fullGranted, false);
  assert.equal(noHuman.isHuman, false);
});

test('water defaults remain 25; parser preserves explicit 25,50/off/0/custom values', () => {
  assert.deepEqual(cadence.parseWaterThresholds(undefined), [25]);
  assert.deepEqual(cadence.parseWaterThresholds('25,50'), [25, 50]);
  assert.deepEqual(cadence.parseWaterThresholds('off'), []);
  assert.deepEqual(cadence.parseWaterThresholds('0'), []);
  assert.deepEqual(cadence.parseWaterThresholds('70,90'), [70, 90]);
});

test('new actor output and DTO remain pure, deterministic, frozen copies', () => {
  const input = deepFreeze({
    state: real({ _humanPending: true }), signals: { isHuman: false }, frame: {},
    config: { snapshotMinGapRounds: 40, slimEveryRounds: 15 }, requestKey: 'immutable',
  });
  const before = JSON.stringify(input);
  const a = call(input), b = call(input);
  assert.equal(JSON.stringify(input), before);
  assert.deepEqual(a, b);
  assert(Object.isFrozen(a));
  const raw = legacyDto({ isHuman: true });
  const rawBefore = JSON.stringify(raw);
  const built = dto.makeCadenceDecision(raw);
  assert.equal(JSON.stringify(raw), rawBefore);
  assert(!Object.isFrozen(raw));
  assert(!Object.isFrozen(raw.grants));
  assert(Object.isFrozen(built));
  assert(Object.isFrozen(built.grants));
  raw.grants.push('caller-still-mutable');
  assert(!built.grants.includes('caller-still-mutable'));
});


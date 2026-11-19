#!/usr/bin/env node
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DEFAULT_POLICY, PRESETS, MODULE_REGISTRY, PRODUCER_IDS, validatePolicy, resolvePolicy, legacyToPolicy, DeliveryPolicyError } from '../../lib/injection/policy-v2.js';
import { previewDelivery } from '../../lib/injection/preview.js';
import { formatDiagnosticDigest } from '../../lib/injection/diagnostics.js';

let pass = 0;
function test(name, fn) { fn(); pass++; console.log('PASS ' + name); }
const copy = value => JSON.parse(JSON.stringify(value));
const invalid = fn => assert.throws(fn, error => error instanceof DeliveryPolicyError && error.statusCode === 400 && Object.keys(error.fields).length === 1);
const minimal = presetId => ({ schemaVersion: 2, presetId });
const sources = () => ({
  rules: { rules: [{ id: 'r1', text: '完整规则\n最后限定', kind: 'rule' }], notes: [] },
  plan: { text: 'FULL-HISTORY', representations: { full: '完整白板', core: '当前白板' } },
  handoff: { representations: { full: '完整账本', sections: '有限账本' } },
  events: { cardsText: '事件卡-证据', catalogText: '另一个事件目录' },
  portraitItems: [{ text: '偏好要点', stage: 'accepted', kind: 'preference' }, { text: '未确认内容', stage: 'retrieved', kind: 'preference' }],
  semantic: { text: '相关语义' }, calendar: { representations: { current: '今天事项' } },
  externalMemory: { text: '外部记忆' }, workspaceMap: { representations: { brief: '地图概要', full: '完整地图' } },
  recentLogs: { representations: { tail: '最近日志' } }, reflection: { representations: { recent: '近期反思' } },
  userMemory: { text: 'LOCKED-USER' }, projectNotes: { text: 'LOCKED-PROJECT' },
});
test('four immutable presets, exactly 11 producers and two locked registry entries', () => {
  assert.equal(Object.keys(PRESETS).length, 4); assert.equal(PRODUCER_IDS.length, 11);
  assert.equal(Object.keys(MODULE_REGISTRY).length, 13); assert(Object.isFrozen(DEFAULT_POLICY));
});
test('canonical validation is idempotent and never freezes the caller', () => {
  const input = minimal('human_slim'), result = validatePolicy(input);
  assert(!Object.isFrozen(input)); input.extra = true;
  assert.deepEqual(validatePolicy(result), result); assert(Object.isFrozen(result.modules.events));
  assert.deepEqual(result.triggers.waterPct, [25]); assert.equal(result.triggers.slimEveryRounds, 15);
  assert.equal(result.triggers.fullGapRounds, 40); assert.equal(result.modules.diagnostics.enabled, false);
});
test('unknown fields, preset, unit, view, negative/fraction and unsafe quantities reject', () => {
  const bads = [
    { ...minimal('human_slim'), typo: true }, minimal('unknown'),
    { ...minimal('human_slim'), modules: { events: { view: 'full' } } },
    { ...minimal('human_slim'), modules: { events: { priority: -1 } } },
    { ...minimal('human_slim'), modules: { events: { quotas: [{ unit: 'tokens', scope: 'delivery', max: 2, strength: 'hard' }] } } },
    { ...minimal('human_slim'), modules: { events: { quotas: [{ unit: 'checkpoint', scope: 'event', max: 1.5, strength: 'hard' }] } } },
    { ...minimal('human_slim'), transport: { jsChars: Number.MAX_SAFE_INTEGER + 1 } },
  ];
  for (const value of bads) invalid(() => validatePolicy(value));
});
test('hard allowance rejects, bounded soft quota accepts, zero quantity survives', () => {
  const q = { unit: 'checkpoint', scope: 'event', max: 0, strength: 'hard' };
  assert.equal(validatePolicy({ ...minimal('human_slim'), modules: { events: { quotas: [q] } } }).modules.events.quotas[0].max, 0);
  invalid(() => validatePolicy({ ...minimal('human_slim'), modules: { events: { quotas: [{ ...q, overflowAllowance: 1 }] } } }));
  invalid(() => validatePolicy({ ...minimal('human_slim'), transport: { jsChars: 100, strength: 'hard', overflowAllowance: { jsChars: 20 } } }));
  assert.equal(validatePolicy({ ...minimal('human_slim'), modules: { events: { quotas: [{ ...q, strength: 'soft', overflowAllowance: 1 }] } } }).modules.events.quotas[0].overflowAllowance, 1);
});
test('human_full can only choose full or omit; human_slim can explicitly use alternate forms', () => {
  invalid(() => validatePolicy({ ...minimal('human_full'), representation: { preferred: 'preview', fallback: ['omit'] } }));
  invalid(() => validatePolicy({ ...minimal('human_full'), representation: { preferred: 'full', fallback: ['pointer', 'omit'] } }));
  assert.equal(validatePolicy({ ...minimal('human_slim'), representation: { preferred: 'preview', fallback: ['pointer', 'omit'] } }).representation.preferred, 'preview');
});
test('logs aliases one producer and dual enable is rejected', () => {
  invalid(() => validatePolicy({ ...minimal('human_full'), modules: { logs: { aliasOf: 'recentLogs', enabled: true } } }));
  const p = validatePolicy({ ...minimal('human_slim'), modules: { logs: { aliasOf: 'recentLogs', enabled: true, view: 'tail' } } });
  assert(p.modules.recentLogs.enabled); assert.equal(p.modules.logs.aliasOf, 'recentLogs'); assert.equal(p.modules.logs.enabled, false);
  invalid(() => validatePolicy({ ...minimal('human_slim'), modules: { logs: { aliasOf: 'other', enabled: false } } }));
});
test('two local MEMORY sources are locked and the 13 legacy toggles are not their identity', () => {
  invalid(() => validatePolicy({ ...minimal('human_slim'), lockedModules: ['user-memory'] }));
  invalid(() => validatePolicy({ ...minimal('human_slim'), modules: { 'user-memory': { enabled: false } } }));
});
test('non-JSON, cycles and accessors are rejected without invoking caller code', () => {
  const cycle = minimal('human_slim'); cycle.compatibility = cycle;
  invalid(() => validatePolicy(cycle));
  let called = 0; const getter = { schemaVersion: 2, presetId: 'human_slim' };
  Object.defineProperty(getter, 'modules', { get() { called++; return {}; }, enumerable: true });
  invalid(() => validatePolicy(getter)); assert.equal(called, 0);
  invalid(() => validatePolicy({ ...minimal('human_slim'), compatibility: { legacyKeys: { injectEnabled: () => true } } }));
});
test('resolver maps all actor/full quadrants and preserves special tier facts', () => {
  for (const [isHuman, isFull, expected] of [[true,true,'human_full'],[true,false,'human_slim'],[false,true,'run_full'],[false,false,'run_slim']]) {
    assert.equal(resolvePolicy({ tier: 'full', isHuman, isFull }).contentTier, expected);
  }
  assert.equal(resolvePolicy({ tier: 'post_compact', isHuman: false, isFull: false }).contentTier, 'human_full');
  assert.equal(resolvePolicy({ tier: 'handoff_carry' }).contentTier, 'human_full');
  assert.equal(resolvePolicy({ tier: 'hang_compensate' }).contentTier, 'run_full');
  assert.equal(resolvePolicy({ tier: 'legacy' }).legacyLocked, true);
  const legacy = resolvePolicy({ tier: 'legacy', overrides: { modules: { rules: { view: 'full' } } } });
  assert.equal(legacy.policy.modules.rules.view, 'pointer');
  assert.equal(resolvePolicy({ tier: 'legacy', overrides: { modules: { diagnostics: { enabled: true } } } }).policy.modules.diagnostics.enabled, true);
  invalid(() => resolvePolicy({ tier: 'bogus' }));
  invalid(() => resolvePolicy({ tier: 'human_full', overrides: { presetId: 'run_slim' } }));
});
test('stored default human_full policy does not turn human_slim rules into full', () => {
  const resolved = resolvePolicy({ tier: 'human_slim', overrides: DEFAULT_POLICY });
  assert.equal(resolved.policy.modules.rules.view, 'pointer');
  assert.deepEqual(resolved.policy.representation.fallback, ['summary', 'preview', 'pointer', 'omit']);
  assert.equal(resolved.policy.modules.recentLogs.enabled, false);
});
test('legacy adapter preserves explicit 0/1, water settings, read-only dead keys, and existing policy idempotence', () => {
  const legacy = { snapshotMinGapRounds: 0, slimEveryRounds: 1, fullInjectWaterPct: '25,50',
    handoffPlanChars: 1200, externalInjectionChars: 1400, slimCheckpointCount: 3, recentDaysInjected: 2,
    waterPctDefaultsMigration: { code: 'waterPct-old-default-migrated', from: '25,50', to: '25' } };
  const before = JSON.stringify(legacy), p = legacyToPolicy(legacy);
  assert.equal(p.triggers.fullGapRounds, 0); assert.equal(p.triggers.slimEveryRounds, 1);
  assert.deepEqual(p.triggers.waterPct, [25,50]); assert.equal(p.compatibility.legacyKeys.handoffPlanChars, 1200);
  assert.equal(p.modules.plan.transport.jsChars, undefined); assert.equal(p.modules.externalMemory.transport.jsChars, undefined);
  assert.equal(p.modules.events.quotas.some(q => q.unit === 'checkpoint'), false);
  assert.deepEqual(p.compatibility.migrationCodes, ['waterPct-old-default-migrated']); assert.equal(JSON.stringify(legacy), before);
  assert.deepEqual(legacyToPolicy({ deliveryPolicy: p }), p);
  assert.deepEqual(legacyToPolicy({ fullInjectWaterPct: 'off' }).triggers.waterPct, []);
  assert.deepEqual(legacyToPolicy({ fullInjectWaterPct: '0' }).triggers.waterPct, []);
});
test('partial preview uses actual PJ/FM text, is byte-equal deterministic, and leaves input untouched', () => {
  const input = { policy: minimal('human_full'), sources: sources(), tier: 'human_full' };
  const before = JSON.stringify(input), a = previewDelivery(input), b = previewDelivery(input);
  assert.deepEqual(a, b); assert.equal(JSON.stringify(input), before); assert.equal(a.partial, true);
  assert.equal(a.chars.total, a.text.length); assert.equal(a.chars.bytes, Buffer.byteLength(a.text));
  assert(a.text.includes('最后限定')); assert(a.text.includes('LOCKED-USER')); assert(a.text.includes('LOCKED-PROJECT'));
  assert.equal(a.receipt.counts.checkpoints, null); assert(a.receipt.unsupported.includes('event-checkpoint-identity-and-quantity-engine'));
  assert.equal(a.receipt.retained.filter(c => c.sectionKey === 'recent-logs').length, 1);
  assert(!a.text.includes('未确认内容'));
});
test('human_slim is reachable; explicit core is not replaced by raw full history', () => {
  const p = previewDelivery({ policy: DEFAULT_POLICY, sources: sources(), isHuman: true, isFull: false });
  assert.equal(p.receipt.contentTier, 'human_slim'); assert(p.text.includes('当前白板')); assert(!p.text.includes('FULL-HISTORY'));
  assert(!p.text.includes('最后限定')); assert(p.receipt.retained.some(c => c.moduleId === 'rules' && c.representation === 'pointer'));
});
test('module and global hard ceilings omit complete candidates without slicing locked memories', () => {
  const input = { policy: { ...minimal('human_slim'), transport: { jsChars: 1 } }, sources: sources() };
  const p = previewDelivery(input); assert.equal(p.text, ''); assert.equal(p.receipt.status, 'unfulfillable-preview');
  assert(p.receipt.violations.some(v => v.code === 'locked-content-does-not-fit'));
  const short = previewDelivery({ policy: { ...minimal('human_full'), modules: { plan: { transport: { jsChars: 1 } } } }, sources: sources() });
  assert(!short.text.includes('完整白板')); assert(short.text.includes('LOCKED-USER'));
  assert(short.receipt.omitted.some(v => v.moduleId === 'plan' && v.reason === 'module-transport-limit'));
});
test('zero global switch renders zero bytes and never reads a diagnostic source getter', () => {
  let reads = 0; const s = sources(); Object.defineProperty(s, 'diagnostic', { get() { reads++; return {}; } });
  const p = previewDelivery({ policy: { ...minimal('human_slim'), enabled: false }, sources: s });
  assert.equal(p.text, ''); assert.equal(reads, 0); assert.equal(p.receipt.counts.modules, 0);
});
test('missing sources are explicit; quantity quotas never masquerade as executed', () => {
  const p = previewDelivery({ policy: { ...minimal('human_slim'), modules: { events: { quotas: [{ unit: 'checkpoint', scope: 'event', max: 3, strength: 'hard' }] } } }, sources: {} });
  assert.equal(p.receipt.counts.checkpoints, 0); assert(p.receipt.unsupported.includes('semantic-unit-quotas'));
  assert(p.receipt.violations.some(v => v.code === 'locked-source-unavailable'));
});
test('preview only chooses explicitly supplied preview representations and never labels them full', () => {
  const s = sources(); s.events.representations = { preview: '事件明确预览' };
  const p = previewDelivery({ policy: { ...minimal('human_slim'), representation: { preferred: 'preview', fallback: ['omit'] } }, sources: s });
  assert(p.text.includes('事件明确预览'));
  assert(p.receipt.retained.some(c => c.moduleId === 'events' && c.representation === 'preview'));
  assert.equal(p.receipt.counts.checkpointFull, null);
});
test('policy errors cannot consume source getters, and disabled diagnostics return zero injections', () => {
  let reads = 0; const s = { get rules() { reads++; return {}; }, get diagnostic() { reads++; return {}; } };
  invalid(() => previewDelivery({ policy: { ...minimal('human_full'), unknown: true }, sources: s }));
  assert.equal(reads, 0);
  const p = previewDelivery({ policy: minimal('human_slim'), sources: sources() });
  assert.equal(p.receipt.diagnosticInjections, 0);
});
test('preview diagnostics use the same code-only formatter, ignore raw text and do not count as content modules', () => {
  const s = sources();
  const codes = [{ code: 'snapshot-build', count: 2 }, { code: 'wal-flush', count: 1 }, { code: 'session-secret-id', count: 7 }];
  s.diagnostic = { enabled: true, codes, text: 'C:/private/path SECRET QUERY model-name' };
  const policy = { ...minimal('human_slim'), modules: { diagnostics: { enabled: true } } };
  const out = previewDelivery({ policy, sources: s });
  const expected = formatDiagnosticDigest({ codes, windowHours: 24, maxLines: 5 });
  assert(out.text.includes(expected.text)); assert(!out.text.includes('SECRET'));
  assert(!out.text.includes('session-secret-id')); assert.equal(out.receipt.diagnosticInjections, 1);
  assert.equal(out.receipt.counts.modules, new Set(out.receipt.retained.filter(x => PRODUCER_IDS.includes(x.moduleId)).map(x => x.moduleId)).size);
  const noErrors = previewDelivery({ policy, sources: { ...s, diagnostic: { enabled: true, codes: [] } } });
  assert.equal(noErrors.receipt.diagnosticInjections, 0);
  const zeroLines = previewDelivery({ policy: { ...policy, modules: { diagnostics: { enabled: true, maxLines: 0 } } }, sources: s });
  assert.equal(zeroLines.receipt.diagnosticInjections, 0);
});
test('module overflow uses only an explicitly supplied allowed representation, otherwise whole omission', () => {
  const s = sources();
  s.events.cardsText = '事件卡完整正文-额外长证据';
  s.events.representations = { preview: '事件预览' };
  const out = previewDelivery({ policy: { ...minimal('human_slim'), modules: { events: { transport: { jsChars: 6 } } } }, sources: s });
  const event = out.receipt.retained.find(x => x.moduleId === 'events');
  assert.equal(event.representation, 'preview'); assert(out.text.includes('事件预览'));
  const strict = previewDelivery({ policy: { ...minimal('human_full'), modules: { events: { transport: { jsChars: 6 } } } }, sources: s });
  assert(!strict.receipt.retained.some(x => x.moduleId === 'events'));
});
test('diagnostic disabled never accesses the diagnostic snapshot and disabled producers are not inspected', () => {
  let diagnosticReads = 0, externalReads = 0;
  const s = sources();
  Object.defineProperty(s, 'diagnostic', { enumerable: true, get() { diagnosticReads++; return { enabled: true, codes: [{ code: 'snapshot-build', count: 1 }] }; } });
  Object.defineProperty(s, 'externalMemory', { enumerable: true, get() { externalReads++; return { text: 'disabled-source-sentinel' }; } });
  const out = previewDelivery({ policy: minimal('human_slim'), sources: s });
  assert.equal(diagnosticReads, 0); assert.equal(externalReads, 0); assert.equal(out.receipt.diagnosticInjections, 0);
});
test('soft transport target is reported separately from its absolute allowance', () => {
  const s = sources(); s.plan.representations.core = '当前白板-扩展';
  const out = previewDelivery({ policy: { ...minimal('human_slim'),
    modules: { plan: { transport: { jsChars: 2, strength: 'soft', overflowAllowance: { jsChars: 20 } } } } }, sources: s });
  assert(out.text.includes('当前白板-扩展'));
  assert(out.receipt.violations.some(v => v.code === 'soft-module-transport-target-exceeded' && v.actual > v.target));
});
console.log('Delivery Policy v2: ' + pass + ' PASS / 0 FAIL');


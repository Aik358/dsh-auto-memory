/**
 * Policy v2 contracts. Pure normalization only; no file, state or host access.
 * The 11 producers, legacy 13 section toggles and 2 locked sources are distinct sets.
 */
import { parseWaterThresholds } from './cadence.js';

export class DeliveryPolicyError extends Error {
  constructor(path, message) {
    super('deliveryPolicy.' + path + ': ' + message);
    this.name = 'DeliveryPolicyError';
    this.code = 'invalid-delivery-policy';
    this.statusCode = 400;
    this.fields = { ['deliveryPolicy.' + path]: message };
  }
}
const bad = (path, message) => { throw new DeliveryPolicyError(path, message); };
const own = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
function object(value, path) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
      || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) bad(path, 'expected a plain object');
  for (const [key, desc] of Object.entries(Object.getOwnPropertyDescriptors(value))) {
    if (!own(desc, 'value')) bad(path + '.' + key, 'accessors are not policy data');
    if (!desc.enumerable) bad(path + '.' + key, 'non-enumerable fields are not policy data');
  }
  if (Object.getOwnPropertySymbols(value).length) bad(path, 'symbol fields are not policy data');
  return value;
}
function keys(value, allowed, path) {
  object(value, path);
  for (const key of Object.keys(value)) if (!allowed.includes(key)) bad(path + '.' + key, 'unknown field');
}
function jsonCopy(value, path = 'policy', seen = new Set()) {
  if (value === null || ['string', 'boolean'].includes(typeof value)) return value;
  if (typeof value === 'number') { if (!Number.isFinite(value)) bad(path, 'expected finite JSON number'); return value; }
  if (typeof value !== 'object') bad(path, 'expected JSON data');
  if (seen.has(value)) bad(path, 'circular policy data');
  seen.add(value);
  let copy;
  if (Array.isArray(value)) {
    copy = [];
    for (let i = 0; i < value.length; i++) {
      if (!own(value, i)) bad(path, 'sparse arrays are not policy data');
      copy.push(jsonCopy(value[i], path + '[' + i + ']', seen));
    }
  } else {
    object(value, path); copy = {};
    for (const key of Object.keys(value)) {
      if (['__proto__', 'constructor', 'prototype'].includes(key)) bad(path + '.' + key, 'reserved field');
      copy[key] = jsonCopy(value[key], path + '.' + key, seen);
    }
  }
  seen.delete(value); return copy;
}
function freeze(value) {
  if (value && typeof value === 'object') { for (const child of Object.values(value)) freeze(child); Object.freeze(value); }
  return value;
}
const bool = (v, p) => { if (typeof v !== 'boolean') bad(p, 'expected boolean'); return v; };
const integer = (v, p, max = Number.MAX_SAFE_INTEGER) => {
  if (!Number.isSafeInteger(v) || v < 0 || v > max) bad(p, 'expected non-negative safe integer' + (max < Number.MAX_SAFE_INTEGER ? ' <= ' + max : ''));
  return v;
};
const enumOf = (v, p, allowed) => { if (!allowed.includes(v)) bad(p, 'unknown value'); return v; };
const listOfStrings = (v, p) => {
  if (!Array.isArray(v) || v.some(x => typeof x !== 'string' || !x.trim())) bad(p, 'expected non-empty string items');
  if (new Set(v).size !== v.length) bad(p, 'duplicate items');
  return v.slice();
};
export const CONTENT_PRESETS = freeze(['human_full', 'human_slim', 'run_full', 'run_slim']);
export const LOCKED_MODULES = freeze(['user-memory', 'project-notes']);
export const SECTION_KEYS = freeze([
  'rules-section', 'tier0-catalog', 'whiteboard-plan', 'handoff-ledger', 'calendar', 'external-memory',
  'external-sessions', 'workspace-map', 'welcome-title', 'welcome-body', 'plan-update-request', 'water-advisory', 'handoff-pointer',
]);
const producer = (views, units, priority, extra = {}) => ({ views, units, priority, locked: false, ...extra });
export const MODULE_REGISTRY = freeze({
  rules: producer(['full', 'pointer', 'summary'], ['rule', 'ruleModule', 'deliveryModule'], 100, { children: ['maintenance'] }),
  plan: producer(['core', 'full'], ['planSection', 'deliveryModule'], 60),
  handoff: producer(['sections', 'full'], ['ledgerSection', 'deliveryModule'], 55),
  events: producer(['cards', 'cards+catalog'], ['event', 'checkpoint', 'catalogEntry', 'deliveryModule'], 70),
  portrait: producer(['short', 'full'], ['portraitItem', 'deliveryModule'], 80),
  semantic: producer(['full'], ['retrievalHit', 'evidenceBlock', 'deliveryModule'], 40),
  calendar: producer(['current', 'full'], ['calendarEntry', 'deliveryModule'], 35),
  externalMemory: producer(['full'], ['source', 'memoryRecord', 'deliveryModule'], 30),
  workspaceMap: producer(['brief', 'full'], ['workspaceEntry', 'moduleReference', 'deliveryModule'], 25),
  recentLogs: producer(['tail', 'full'], ['logEntry', 'documentSection', 'deliveryModule'], 20, { aliases: ['logs'] }),
  reflection: producer(['recent', 'full'], ['reflectionEntry', 'documentSection', 'deliveryModule'], 18),
  'user-memory': { locked: true, views: ['full'], units: ['memoryRecord'] },
  'project-notes': { locked: true, views: ['full'], units: ['memoryRecord'] },
});
export const MODULE_ALIASES = freeze({ logs: { aliasOf: 'recentLogs' }, maintenance: { childOf: 'rules' } });
export const PRODUCER_IDS = freeze(Object.keys(MODULE_REGISTRY).filter(id => !MODULE_REGISTRY[id].locked));
export const LEGACY_READONLY_KEYS = freeze([
  'snapshotMinGapRounds', 'slimEveryRounds', 'snapshotTieredInject', 'snapshotReinjectOnCompact', 'fullInjectWaterPct',
  'hangCompensateEnabled', 'hangCompensateTokens', 'injectEnabled', 'promptSectionToggles', 'injectExcludeSources',
  'injectBudgetChars', 'fullInjectSlimBudgetChars', 'handoffEnabled', 'handoffPlanChars', 'handoffPlanSections',
  'handoffPlanSectionMax', 'handoffLedgerChars', 'eventMaxActiveInInject', 'eventCatalogChars', 'eventCatalogRecentClosedDays',
  'slimCheckpointCount', 'fullInjectSemanticChars', 'externalInjectionChars', 'tier0CatalogEnabled', 'tier0MaxTokens',
  'tier0BudgetShare', 'recentDaysInjected', 'promptLayerOverrides', 'slimPlanChars', 'slimLedgerChars',
  'procedureInjectEnabled', 'globalBriefChars', 'maxPacketItems', 'maxPacketChars', 'injectionCooldownSteps',
  'softInjectionEnabled', 'teamInjectEnabled',
]);
export const INEFFECTIVE_LEGACY_KEYS = freeze([
  'handoffPlanChars', 'externalInjectionChars', 'slimCheckpointCount', 'slimPlanChars', 'slimLedgerChars',
]);
function moduleDefault(id, view, enabled) {
  return { enabled, view, priority: MODULE_REGISTRY[id].priority, quotas: [], transport: {} };
}
function makePreset(id) {
  const humanFull = id === 'human_full', runSlim = id === 'run_slim';
  const modules = {
    rules: moduleDefault('rules', humanFull ? 'full' : 'pointer', true),
    plan: moduleDefault('plan', humanFull ? 'full' : 'core', !runSlim),
    handoff: moduleDefault('handoff', humanFull ? 'full' : 'sections', !runSlim),
    events: moduleDefault('events', humanFull ? 'cards+catalog' : 'cards', true),
    portrait: moduleDefault('portrait', humanFull ? 'full' : 'short', id.startsWith('human_')),
    semantic: moduleDefault('semantic', 'full', !runSlim),
    calendar: moduleDefault('calendar', 'current', !runSlim),
    externalMemory: moduleDefault('externalMemory', 'full', humanFull),
    workspaceMap: moduleDefault('workspaceMap', humanFull ? 'full' : 'brief', !runSlim),
    recentLogs: { ...moduleDefault('recentLogs', 'tail', humanFull), aliases: ['logs'] },
    reflection: moduleDefault('reflection', 'recent', humanFull),
    diagnostics: { enabled: false, windowHours: 24, maxLines: 5 },
  };
  return {
    schemaVersion: 2, presetId: id, enabled: true, modules, lockedModules: LOCKED_MODULES.slice(),
    transport: {}, representation: { preferred: 'full', fallback: humanFull ? ['omit'] : ['summary', 'preview', 'pointer', 'omit'] },
    triggers: { human: 'always', postCompact: 'always', waterPct: [25], slimEveryRounds: 15, fullGapRounds: 40,
      tieredInject: true, hangCompensateEnabled: false, hangCompensateTokens: 300000, firstFrame: true, handoff: true },
    presetOverrides: { post_compact: { notice: true }, handoff_carry: {}, hang_compensate: {} },
    compatibility: { legacyKeys: {}, migrationCodes: [], source: 'preset' },
  };
}
export const PRESETS = freeze(Object.fromEntries(CONTENT_PRESETS.map(id => [id, makePreset(id)])));
export const DEFAULT_POLICY = PRESETS.human_full;
function merge(base, patch) {
  const out = jsonCopy(base);
  for (const key of Object.keys(patch)) {
    const v = patch[key];
    out[key] = v && typeof v === 'object' && !Array.isArray(v) && out[key]
      && typeof out[key] === 'object' && !Array.isArray(out[key]) ? merge(out[key], v) : jsonCopy(v);
  }
  return out;
}
function differences(value, baseline) {
  const out = {};
  for (const key of Object.keys(value)) {
    const current = value[key], prior = baseline[key];
    if (JSON.stringify(current) === JSON.stringify(prior)) continue;
    if (current && prior && typeof current === 'object' && typeof prior === 'object'
        && !Array.isArray(current) && !Array.isArray(prior)) {
      const nested = differences(current, prior);
      if (Object.keys(nested).length) out[key] = nested;
    } else out[key] = jsonCopy(current);
  }
  return out;
}
function transport(v, p) {
  keys(v, ['jsChars', 'utf8Bytes', 'strength', 'overflowAllowance'], p);
  const out = {};
  for (const unit of ['jsChars', 'utf8Bytes']) if (own(v, unit)) out[unit] = integer(v[unit], p + '.' + unit);
  if (own(v, 'strength')) out.strength = enumOf(v.strength, p + '.strength', ['hard', 'soft']);
  if (own(v, 'overflowAllowance')) {
    if (out.strength !== 'soft') bad(p + '.overflowAllowance', 'only soft budgets may have an allowance');
    keys(v.overflowAllowance, ['jsChars', 'utf8Bytes'], p + '.overflowAllowance');
    out.overflowAllowance = {};
    for (const unit of Object.keys(v.overflowAllowance)) {
      if (!own(out, unit)) bad(p + '.overflowAllowance.' + unit, 'requires the matching transport target');
      out.overflowAllowance[unit] = integer(v.overflowAllowance[unit], p + '.overflowAllowance.' + unit);
      if (!Number.isSafeInteger(out[unit] + out.overflowAllowance[unit])) bad(p, 'target plus allowance is unsafe');
    }
  }
  if (out.strength === 'soft' && !out.overflowAllowance) bad(p + '.overflowAllowance', 'soft budgets require explicit allowance');
  return out;
}
function quotas(v, p, allowedUnits) {
  if (!Array.isArray(v)) bad(p, 'expected quota array');
  const normalized = v.map((q, i) => {
    const at = p + '[' + i + ']';
    keys(q, ['unit', 'scope', 'max', 'strength', 'overflowAllowance'], at);
    const unit = enumOf(q.unit, at + '.unit', allowedUnits);
    const scope = enumOf(q.scope, at + '.scope', ['delivery', 'event', 'module']);
    if (scope === 'event' && !['event', 'checkpoint', 'catalogEntry'].includes(unit)) bad(at + '.scope', 'event scope requires an event unit');
    const max = integer(q.max, at + '.max');
    const strength = enumOf(q.strength, at + '.strength', ['hard', 'soft']);
    const out = { unit, scope, max, strength };
    if (strength === 'hard' && own(q, 'overflowAllowance')) bad(at + '.overflowAllowance', 'hard quotas cannot have an allowance');
    if (strength === 'soft') {
      out.overflowAllowance = integer(q.overflowAllowance, at + '.overflowAllowance');
      if (!Number.isSafeInteger(max + out.overflowAllowance)) bad(at, 'target plus allowance is unsafe');
    }
    return out;
  });
  const seen = new Set();
  for (let i = 0; i < normalized.length; i++) {
    const quota = normalized[i];
    const key = quota.unit + '/' + quota.scope;
    if (seen.has(key)) bad(p + '[' + i + ']', 'duplicate-quota-scope');
    seen.add(key);
  }
  return normalized;
}
const MODULE_FIELDS = ['enabled', 'view', 'priority', 'quotas', 'transport', 'aliases', 'selection', 'maintenance'];
function checkModule(id, v, path) {
  keys(v, MODULE_FIELDS, path);
  const out = {
    enabled: bool(v.enabled, path + '.enabled'),
    view: enumOf(v.view, path + '.view', MODULE_REGISTRY[id].views),
    priority: integer(v.priority, path + '.priority'),
    quotas: quotas(v.quotas, path + '.quotas', MODULE_REGISTRY[id].units),
    transport: transport(v.transport, path + '.transport'),
  };
  if (own(v, 'aliases')) {
    const a = listOfStrings(v.aliases, path + '.aliases');
    if (id !== 'recentLogs' || a.length !== 1 || a[0] !== 'logs') bad(path + '.aliases', 'only logs aliases recentLogs');
    out.aliases = a;
  }
  if (own(v, 'maintenance')) {
    if (id !== 'rules') bad(path + '.maintenance', 'maintenance is a rules child');
    out.maintenance = bool(v.maintenance, path + '.maintenance');
  }
  if (own(v, 'selection')) {
    keys(v.selection, ['sections', 'recentDays', 'recentClosedDays', 'catalogChars', 'excludeSources'], path + '.selection');
    out.selection = {};
    if (own(v.selection, 'sections')) out.selection.sections = listOfStrings(v.selection.sections, path + '.selection.sections');
    for (const k of ['recentDays', 'recentClosedDays', 'catalogChars']) if (own(v.selection, k)) out.selection[k] = integer(v.selection[k], path + '.selection.' + k);
    if (own(v.selection, 'excludeSources')) out.selection.excludeSources = listOfStrings(v.selection.excludeSources, path + '.selection.excludeSources');
  }
  return out;
}
function checkRepresentation(v, p, presetId) {
  keys(v, ['preferred', 'fallback'], p);
  const preferred = enumOf(v.preferred, p + '.preferred', ['full', 'summary', 'preview', 'pointer']);
  const fallback = listOfStrings(v.fallback, p + '.fallback');
  for (const mode of fallback) enumOf(mode, p + '.fallback', ['full', 'summary', 'preview', 'pointer', 'omit']);
  if (fallback.includes(preferred)) bad(p + '.fallback', 'preferred representation must not be repeated');
  if (presetId === 'human_full' && (preferred !== 'full' || fallback.some(k => k !== 'omit'))) bad(p, 'human_full allows only full or whole-unit omit');
  return { preferred, fallback };
}
// A field that was valid in the source preset can conflict with the target preset.
function rebaseRepresentation(value, presetId) {
  const preset = PRESETS[presetId].representation;
  let preferred = value.preferred;
  try {
    checkRepresentation({ preferred, fallback: [] }, 'representation', presetId);
  } catch (error) {
    if (!(error instanceof DeliveryPolicyError)) throw error;
    preferred = preset.preferred;
  }
  try {
    return checkRepresentation({ preferred, fallback: value.fallback }, 'representation', presetId);
  } catch (error) {
    if (!(error instanceof DeliveryPolicyError)) throw error;
    return { preferred, fallback: preset.fallback.filter(mode => mode !== preferred) };
  }
}
function triggers(v) {
  keys(v, ['human', 'postCompact', 'waterPct', 'slimEveryRounds', 'fullGapRounds', 'tieredInject',
    'hangCompensateEnabled', 'hangCompensateTokens', 'firstFrame', 'handoff'], 'triggers');
  if (!Array.isArray(v.waterPct)) bad('triggers.waterPct', 'expected threshold array');
  const waterPct = v.waterPct.map((n, i) => {
    const path = 'triggers.waterPct[' + i + ']';
    if (n === 0) bad(path, 'use an empty array to disable water triggers');
    if (!Number.isFinite(n) || n < 0 || n > 100 || Math.round(n * 100) / 100 !== n) {
      bad(path, 'expected threshold above 0 and up to 100 with at most two decimal places');
    }
    return n;
  });
  if (new Set(waterPct).size !== waterPct.length) bad('triggers.waterPct', 'duplicate thresholds');
  return {
    human: enumOf(v.human, 'triggers.human', ['always', 'off']),
    postCompact: enumOf(v.postCompact, 'triggers.postCompact', ['always', 'off']),
    waterPct: waterPct.slice().sort((a, b) => a - b),
    slimEveryRounds: integer(v.slimEveryRounds, 'triggers.slimEveryRounds'),
    fullGapRounds: integer(v.fullGapRounds, 'triggers.fullGapRounds'),
    tieredInject: bool(v.tieredInject, 'triggers.tieredInject'),
    hangCompensateEnabled: bool(v.hangCompensateEnabled, 'triggers.hangCompensateEnabled'),
    hangCompensateTokens: integer(v.hangCompensateTokens, 'triggers.hangCompensateTokens'),
    firstFrame: bool(v.firstFrame, 'triggers.firstFrame'),
    handoff: bool(v.handoff, 'triggers.handoff'),
  };
}
const TOP = ['schemaVersion', 'presetId', 'enabled', 'modules', 'lockedModules', 'transport', 'representation', 'triggers', 'presetOverrides', 'compatibility'];
function validatePatch(patch, presetId, path = 'policy') {
  keys(patch, TOP, path);
  if (own(patch, 'schemaVersion') && patch.schemaVersion !== 2) bad('schemaVersion', 'expected version 2');
  if (own(patch, 'presetId')) enumOf(patch.presetId, 'presetId', CONTENT_PRESETS);
  if (own(patch, 'modules')) {
    keys(patch.modules, [...PRODUCER_IDS, 'diagnostics', 'logs'], 'modules');
    for (const [id, value] of Object.entries(patch.modules)) {
      if (id === 'diagnostics') keys(value, ['enabled', 'windowHours', 'maxLines'], 'modules.diagnostics');
      else if (id === 'logs') keys(value, ['aliasOf', 'enabled', 'view', 'priority', 'quotas', 'transport'], 'modules.logs');
      else keys(value, MODULE_FIELDS, 'modules.' + id);
    }
  }
  if (own(patch, 'compatibility')) {
    keys(patch.compatibility, ['source', 'legacyKeys', 'migrationCodes'], 'compatibility');
    if (own(patch.compatibility, 'legacyKeys')) keys(patch.compatibility.legacyKeys, LEGACY_READONLY_KEYS, 'compatibility.legacyKeys');
  }
  if (own(patch, 'presetOverrides')) {
    keys(patch.presetOverrides, ['post_compact', 'handoff_carry', 'hang_compensate'], 'presetOverrides');
    for (const [tier, override] of Object.entries(patch.presetOverrides)) {
      keys(override, ['notice', 'modules', 'transport', 'representation'], 'presetOverrides.' + tier);
      if (own(override, 'notice')) bool(override.notice, 'presetOverrides.' + tier + '.notice');
      if (own(override, 'modules')) {
        keys(override.modules, PRODUCER_IDS, 'presetOverrides.' + tier + '.modules');
        for (const [id, val] of Object.entries(override.modules)) {
          const merged = merge(PRESETS[presetId].modules[id], val);
          checkModule(id, merged, 'presetOverrides.' + tier + '.modules.' + id);
        }
      }
      if (own(override, 'transport')) transport(override.transport, 'presetOverrides.' + tier + '.transport');
      if (own(override, 'representation')) checkRepresentation(override.representation, 'presetOverrides.' + tier + '.representation',
        tier === 'hang_compensate' ? 'run_full' : 'human_full');
    }
  }
}
/** Missing optional parts are filled from the selected preset, never from mutable global state. */
export function validatePolicy(input) {
  object(input, 'policy');
  const checked = jsonCopy(input);
  keys(checked, TOP, 'policy');
  if (checked.schemaVersion !== 2) bad('schemaVersion', 'expected version 2');
  enumOf(checked.presetId, 'presetId', CONTENT_PRESETS);
  validatePatch(checked, checked.presetId);
  const p = merge(PRESETS[checked.presetId], checked);
  const modules = {};
  for (const id of PRODUCER_IDS) modules[id] = checkModule(id, p.modules[id], 'modules.' + id);
  if (own(p.modules, 'logs')) {
    const a = p.modules.logs;
    if (a.aliasOf !== 'recentLogs') bad('modules.logs.aliasOf', 'logs must alias recentLogs');
    const enabled = own(a, 'enabled') ? bool(a.enabled, 'modules.logs.enabled') : false;
    if (enabled && modules.recentLogs.enabled) bad('modules.logs.enabled', 'logs and recentLogs cannot both be enabled');
    if (own(a, 'view')) enumOf(a.view, 'modules.logs.view', ['tail', 'full']);
    if (own(a, 'priority')) integer(a.priority, 'modules.logs.priority');
    if (own(a, 'quotas')) quotas(a.quotas, 'modules.logs.quotas', MODULE_REGISTRY.recentLogs.units);
    if (own(a, 'transport')) transport(a.transport, 'modules.logs.transport');
    if (enabled) modules.recentLogs = checkModule('recentLogs', merge(modules.recentLogs,
      { ...Object.fromEntries(Object.entries(a).filter(([k]) => k !== 'aliasOf')), enabled: true }), 'modules.recentLogs');
    modules.logs = { aliasOf: 'recentLogs', enabled: false };
  }
  const d = p.modules.diagnostics;
  keys(d, ['enabled', 'windowHours', 'maxLines'], 'modules.diagnostics');
  modules.diagnostics = { enabled: bool(d.enabled, 'modules.diagnostics.enabled'),
    windowHours: integer(d.windowHours, 'modules.diagnostics.windowHours', 168),
    maxLines: integer(d.maxLines, 'modules.diagnostics.maxLines', 5) };
  if (modules.diagnostics.windowHours === 0) bad('modules.diagnostics.windowHours', 'windowHours must be positive');
  const lockedModules = listOfStrings(p.lockedModules, 'lockedModules');
  if (lockedModules.length !== 2 || LOCKED_MODULES.some(k => !lockedModules.includes(k))) bad('lockedModules', 'the two source modules are locked and cannot be disabled');
  const c = p.compatibility;
  keys(c, ['source', 'legacyKeys', 'migrationCodes'], 'compatibility');
  keys(c.legacyKeys, LEGACY_READONLY_KEYS, 'compatibility.legacyKeys');
  const migrationCodes = listOfStrings(c.migrationCodes, 'compatibility.migrationCodes');
  for (const code of migrationCodes) enumOf(code, 'compatibility.migrationCodes', ['waterPct-old-default-migrated']);
  const normalized = { schemaVersion: 2, presetId: p.presetId, enabled: bool(p.enabled, 'enabled'),
    modules, lockedModules: LOCKED_MODULES.slice(), transport: transport(p.transport, 'transport'),
    representation: checkRepresentation(p.representation, 'representation', p.presetId), triggers: triggers(p.triggers),
    presetOverrides: jsonCopy(p.presetOverrides),
    compatibility: { source: enumOf(c.source, 'compatibility.source', ['preset', 'legacy', 'policy']),
      legacyKeys: jsonCopy(c.legacyKeys), migrationCodes } };
  return freeze(normalized);
}

/** Explicit tier identity is retained; special-tier overlays do not rename production facts. */
export function resolvePolicy(input = {}) {
  keys(input, ['tier', 'isHuman', 'isFull', 'overrides'], 'resolve');
  const tier = input.tier === undefined ? 'run_slim' : enumOf(input.tier, 'tier',
    [...CONTENT_PRESETS, 'post_compact', 'handoff_carry', 'hang_compensate', 'legacy', 'full', 'slim']);
  const inferredHuman = tier.startsWith('human_');
  const isHuman = input.isHuman === undefined ? inferredHuman : bool(input.isHuman, 'isHuman');
  const isFull = input.isFull === undefined ? ['human_full', 'run_full', 'full', 'post_compact', 'handoff_carry'].includes(tier)
    : bool(input.isFull, 'isFull');
  const contentTier = ['post_compact', 'handoff_carry'].includes(tier) ? 'human_full'
    : tier === 'hang_compensate' ? 'run_full'
      : tier === 'legacy' ? 'run_slim' : isHuman ? (isFull ? 'human_full' : 'human_slim') : (isFull ? 'run_full' : 'run_slim');
  let policy;
  const o = input.overrides;
  if (o !== undefined) {
    object(o, 'overrides');
    if (tier === 'legacy') {
      // The compatibility tier is read-only: validate the request but do not
      // let editable preset overrides widen this legacy compatibility view.
      const requested = own(o, 'schemaVersion') ? validatePolicy(o) : validatePolicy(merge(PRESETS.run_slim, o));
      policy = validatePolicy({ ...jsonCopy(PRESETS.run_slim), enabled: requested.enabled,
        transport: jsonCopy(requested.transport), compatibility: jsonCopy(requested.compatibility),
        modules: { ...jsonCopy(PRESETS.run_slim.modules), diagnostics: jsonCopy(requested.modules.diagnostics) } });
    } else
    if (own(o, 'schemaVersion')) {
      policy = validatePolicy(o);
      // A policy is a stored editable preset, while request facts decide the content tier.
      if (policy.presetId !== contentTier) {
        const edits = differences(policy, PRESETS[policy.presetId]);
        delete edits.presetId;
        const target = merge(PRESETS[contentTier], edits);
        target.representation = rebaseRepresentation(target.representation, contentTier);
        policy = validatePolicy(target);
      }
    } else {
      validatePatch(o, contentTier);
      if (own(o, 'presetId') && o.presetId !== contentTier) bad('overrides.presetId', 'request facts determine the content tier');
      policy = validatePolicy(merge(PRESETS[contentTier], o));
    }
  } else policy = validatePolicy(PRESETS[contentTier]);
  const special = policy.presetOverrides[tier];
  if (special) policy = validatePolicy(merge(policy, Object.fromEntries(Object.entries(special).filter(([k]) => k !== 'notice'))));
  return freeze({ policy, contentTier, presetId: contentTier, sourceTier: tier, isHuman, isFull,
    legacyLocked: tier === 'legacy', overridesApplied: special ? jsonCopy(special) : {} });
}
const numberLegacy = (c, k, fallback) => {
  if (!own(c, k)) return fallback;
  const n = Number(c[k]);
  return Number.isSafeInteger(n) && n >= 0 ? n : fallback;
};
/** Does not migrate disk values; the R8 one-time migration belongs to config loading. */
export function legacyToPolicy(config = {}) {
  object(config, 'config');
  if (config.deliveryPolicy !== undefined && config.deliveryPolicy !== null) return validatePolicy(config.deliveryPolicy);
  const p = jsonCopy(DEFAULT_POLICY);
  p.enabled = config.injectEnabled !== false;
  p.triggers.slimEveryRounds = numberLegacy(config, 'slimEveryRounds', p.triggers.slimEveryRounds);
  p.triggers.fullGapRounds = numberLegacy(config, 'snapshotMinGapRounds', p.triggers.fullGapRounds);
  p.triggers.waterPct = parseWaterThresholds(config.fullInjectWaterPct);
  p.triggers.tieredInject = config.snapshotTieredInject !== false;
  p.triggers.postCompact = config.snapshotReinjectOnCompact === false ? 'off' : 'always';
  p.triggers.hangCompensateEnabled = config.hangCompensateEnabled === true;
  p.triggers.hangCompensateTokens = numberLegacy(config, 'hangCompensateTokens', 300000);
  // Compatibility observation only: this old budget did not cap a whole frame.
  if (own(config, 'injectBudgetChars')) p.transport.jsChars = numberLegacy(config, 'injectBudgetChars', 8000);
  p.transport.strength = 'hard';
  const toggles = config.promptSectionToggles && typeof config.promptSectionToggles === 'object' ? config.promptSectionToggles : {};
  const oldSections = { rules: 'rules-section', plan: 'whiteboard-plan', handoff: 'handoff-ledger', calendar: 'calendar',
    externalMemory: 'external-memory', workspaceMap: 'workspace-map' };
  for (const [id, oldKey] of Object.entries(oldSections)) if (toggles[oldKey] === false) p.modules[id].enabled = false;
  if (config.handoffEnabled === false) { p.modules.plan.enabled = false; p.modules.handoff.enabled = false; }
  if (own(config, 'handoffLedgerChars')) p.modules.handoff.transport.jsChars = numberLegacy(config, 'handoffLedgerChars', 800);
  if (own(config, 'fullInjectSemanticChars')) p.modules.semantic.transport.jsChars = numberLegacy(config, 'fullInjectSemanticChars', 800);
  p.modules.events.quotas = [{ unit: 'event', scope: 'delivery', max: numberLegacy(config, 'eventMaxActiveInInject', 2), strength: 'hard' }];
  p.modules.events.selection = { catalogChars: numberLegacy(config, 'eventCatalogChars', 400),
    recentClosedDays: numberLegacy(config, 'eventCatalogRecentClosedDays', 14) };
  p.modules.recentLogs.selection = { recentDays: numberLegacy(config, 'recentDaysInjected', 1) };
  if (Array.isArray(config.handoffPlanSections)) p.modules.plan.selection = { sections: config.handoffPlanSections.slice() };
  if (Array.isArray(config.injectExcludeSources)) p.modules.externalMemory.selection = { excludeSources: config.injectExcludeSources.slice() };
  p.compatibility.source = 'legacy';
  for (const key of LEGACY_READONLY_KEYS) if (own(config, key) && config[key] !== undefined) p.compatibility.legacyKeys[key] = jsonCopy(config[key], 'legacy.' + key);
  if (config.waterPctDefaultsMigration === 'waterPct-old-default-migrated'
      || (config.waterPctDefaultsMigration && config.waterPctDefaultsMigration.code === 'waterPct-old-default-migrated')
      || (Array.isArray(config.waterPctDefaultsMigrations) && config.waterPctDefaultsMigrations.includes('waterPct-old-default-migrated'))) {
    p.compatibility.migrationCodes = ['waterPct-old-default-migrated'];
  }
  return validatePolicy(p);
}


/**
 * Partial, read-only Policy v2 preview. It composes existing PJ/FM adapters.
 * It does not implement or claim the later unit-policy engine, host retention or commit.
 */
import { validatePolicy, resolvePolicy, PRODUCER_IDS, LOCKED_MODULES, DeliveryPolicyError } from './policy-v2.js';
import { makeContentSpec } from './dto.js';
import { projectInjectionPre } from './projection.js';
import { composeFinalEnvelopePre } from './final-frame.js';
import { formatDiagnosticDigest } from './diagnostics.js';

const SECTION = Object.freeze({
  rules: 'rules-section', plan: 'whiteboard-plan', handoff: 'handoff-ledger', events: 'event-cards',
  portrait: 'user-portrait', semantic: 'semantic-recall', calendar: 'calendar',
  externalMemory: 'external-memory', workspaceMap: 'workspace-map', recentLogs: 'recent-logs', reflection: 'reflection',
});
const noneSpec = () => ({ rules: 'none', plan: 'none', handoff: 'none', events: 'none', portrait: 'none',
  semantic: 'none', logs: 'none', calendar: 'none', externalMemory: 'none', workspaceMap: 'none',
  recentLogs: 'none', reflection: 'none', diagnostic: 'none', maintenance: 'none' });
const rawText = source => typeof source === 'string' ? source
  : source && typeof source.text === 'string' ? source.text : '';
const identity = (source, id) => source && typeof source.sourceIdentity === 'string' ? source.sourceIdentity : 'preview:' + id;
function textCost(text) { return { jsChars: text.length, utf8Bytes: Buffer.byteLength(text, 'utf8') }; }
function limits(policy) {
  const strength = policy.strength || 'hard';
  return ['jsChars', 'utf8Bytes'].filter(key => policy[key] !== undefined).map(key => ({
    metric: key, target: policy[key], absoluteMax: policy[key] + (strength === 'soft' ? policy.overflowAllowance?.[key] || 0 : 0), strength,
  }));
}
function overLimit(text, transport) {
  const cost = textCost(text);
  return limits(transport).filter(rule => cost[rule.metric] > rule.absoluteMax)
    .map(rule => ({ code: 'transport-limit', ...rule, actual: cost[rule.metric] }));
}
function sourceCopy(source) {
  if (typeof source === 'string') return { text: source };
  return source && typeof source === 'object' ? { ...source } : {};
}
/**
 * Sources are already-read immutable snapshots. Supported forms are existing PJ forms:
 * rules RC aggregate; plan/handoff text or explicit representations; event pre-rendered
 * cardsText/catalogText; structured portraitItems; source-specific view representations.
 * Locked local memories use userMemory/projectNotes or their production kind names.
 */
export function previewDelivery(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new DeliveryPolicyError('preview', 'expected object');
  for (const key of Object.keys(input)) {
    if (!['policy', 'sources', 'tier', 'isHuman', 'isFull'].includes(key)) throw new DeliveryPolicyError('preview.' + key, 'unknown field');
  }
  const supplied = validatePolicy(input.policy);
  const resolved = resolvePolicy({ tier: input.tier ?? supplied.presetId,
    ...(input.isHuman === undefined ? {} : { isHuman: input.isHuman }),
    ...(input.isFull === undefined ? {} : { isFull: input.isFull }), overrides: supplied });
  const policy = resolved.policy;
  const sources = input.sources && typeof input.sources === 'object' && !Array.isArray(input.sources) ? input.sources : {};
  const violations = [];
  const omitted = [];
  const unsupported = [];
  if (policy.modules.events.enabled) unsupported.push('event-checkpoint-identity-and-quantity-engine');
  if (PRODUCER_IDS.some(id => policy.modules[id].quotas.length)) unsupported.push('semantic-unit-quotas');
  if (resolved.overridesApplied.notice === true) unsupported.push('special-tier-notice-overlay');
  unsupported.push('host-delivery-observation', 'notification-and-cadence-commit', 'full-production-frame-parity');
  const shaped = {};
  for (const id of PRODUCER_IDS) shaped[id] = policy.enabled && policy.modules[id].enabled ? sourceCopy(sources[id]) : {};
  // The unique producer is recentLogs. A legacy alias may supply the same snapshot.
  if (policy.enabled && policy.modules.recentLogs.enabled
      && !rawText(shaped.recentLogs) && !shaped.recentLogs.representations && sources.logs) shaped.recentLogs = sourceCopy(sources.logs);
  if (policy.enabled && policy.modules.rules.enabled) {
    if (Array.isArray(sources.rules)) shaped.rules = { aggregate: { rules: sources.rules } };
    if (sources.rules && Array.isArray(sources.rules.rules)) shaped.rules = { aggregate: sources.rules };
  }
  const values = noneSpec();
  for (const id of PRODUCER_IDS) {
    if (policy.enabled && policy.modules[id].enabled) values[id] = policy.modules[id].view;
  }
  if (policy.enabled && resolved.contentTier === 'human_slim' && policy.modules.rules.enabled
      && policy.modules.rules.maintenance !== false) {
    values.maintenance = 'slim-maintain';
    shaped.maintenance = sourceCopy(sources.maintenance);
  }
  // Preserve the source owner's explicit plan core selection, never invent a full fallback.
  if (policy.modules.plan.selection?.sections) {
    shaped.plan.policy = { ...(shaped.plan.policy || {}), planCoreSections: policy.modules.plan.selection.sections };
  }
  const spec = makeContentSpec({ ...values, budgetPolicy: { unit: 'js-chars', cap: null, unresolved: true },
    sourceIdentity: 'delivery-policy-v2-preview' });
  const projected = projectInjectionPre({ sources: shaped, tier: resolved.legacyLocked ? 'legacy' : resolved.contentTier,
    frame: { step: 0 }, contentSpec: spec, portraitItems: Array.isArray(sources.portraitItems) ? sources.portraitItems : [],
    channelLimit: Number.MAX_SAFE_INTEGER });
  violations.push(...projected.degradations.map(v => ({ code: v.code, moduleId: v.scope, message: v.message })));
  let candidates = projected.candidates.map(c => {
    const moduleId = c.kind === 'maintenance' ? 'rules' : c.kind;
    const source = sources[moduleId];
    const module = policy.modules[moduleId];
    const moduleView = module?.view;
    let representation = moduleView === 'pointer' ? 'pointer' : moduleView === 'summary' ? 'summary' : 'full';
    return { ...c, moduleId, sectionKey: SECTION[moduleId] || c.kind,
      priority: module?.priority ?? c.priority, representation, locked: false, sourceIdentity: identity(source, moduleId) };
  });
  // Representation fallback uses only explicit provider variants. It never invents
  // summaries or slices a raw source. Module views (core/cards/tail) are independent.
  candidates = candidates.flatMap(candidate => {
    const source = sources[candidate.moduleId];
    if (resolved.contentTier === 'human_full' && candidate.representation !== 'full') {
      omitted.push({ moduleId: candidate.moduleId, id: candidate.id, reason: 'human-full-representation-not-full' });
      return [];
    }
    const choices = [policy.representation.preferred, ...policy.representation.fallback];
    for (const choice of choices) {
      if (choice === 'omit') break;
      const variant = source && source.representations && source.representations[choice];
      if (choice === 'full') return [candidate];
      if (typeof variant === 'string' && variant.trim()) return [{ ...candidate, text: variant, representation: choice }];
      if (choice === candidate.representation) return [candidate];
    }
    omitted.push({ moduleId: candidate.moduleId, id: candidate.id, reason: 'allowed-representation-unavailable' });
    return [];
  });
  for (const id of PRODUCER_IDS) {
    const module = policy.modules[id];
    if (!policy.enabled || !module.enabled) continue;
    if (module.quotas.length) violations.push({ code: 'unit-quotas-not-executed', moduleId: id, quotas: module.quotas });
    const ownCandidates = candidates.filter(c => c.moduleId === id);
    if (!ownCandidates.length) omitted.push({ moduleId: id, reason: 'source-or-representation-unavailable' });
    for (const candidate of ownCandidates) {
      for (const rule of limits(module.transport)) {
        const actual = textCost(candidate.text)[rule.metric];
        if (rule.strength === 'soft' && actual > rule.target && actual <= rule.absoluteMax) {
          violations.push({ code: 'soft-module-transport-target-exceeded', moduleId: id, ...rule, actual });
        }
      }
      const exceeded = overLimit(candidate.text, module.transport);
      if (exceeded.length) {
        const source = sources[id];
        const alternate = policy.representation.fallback.filter(mode => mode !== 'omit')
          .map(mode => ({ mode, text: source && source.representations && source.representations[mode] }))
          .find(choice => typeof choice.text === 'string' && choice.text.trim() && !overLimit(choice.text, module.transport).length);
        if (alternate) {
          candidate.text = alternate.text;
          candidate.representation = alternate.mode;
          violations.push({ code: 'explicit-representation-fallback', moduleId: id, id: candidate.id, representation: alternate.mode });
        } else {
          omitted.push({ moduleId: id, id: candidate.id, reason: 'module-transport-limit', constraints: exceeded });
          candidates = candidates.filter(c => c !== candidate);
        }
      }
    }
  }
  if (policy.enabled) for (const [moduleId, keys] of [
    ['user-memory', ['userMemory', 'user-memory']], ['project-notes', ['projectNotes', 'project-notes']],
  ]) {
    const source = keys.map(key => sources[key]).find(value => rawText(value).trim());
    const text = rawText(source);
    if (!text.trim()) {
      violations.push({ code: 'locked-source-unavailable', moduleId });
      omitted.push({ moduleId, reason: 'locked-source-unavailable' });
    } else candidates.push({ id: 'locked:' + moduleId, kind: 'body', bucket: 'memoryReferences', priority: 100,
      text, moduleId, sectionKey: moduleId, representation: 'full', locked: true, sourceIdentity: identity(source, moduleId) });
  }
  // Reformat sanitized registered codes through the exact same pure formatter as
  // the provider. Never trust source.text and never read the diagnostic log here.
  if (policy.enabled && policy.modules.diagnostics.enabled) {
    const digest = sources.diagnostic;
    if (digest && digest.enabled === true && Array.isArray(digest.codes)) {
      const formatted = formatDiagnosticDigest({ codes: digest.codes,
        windowHours: policy.modules.diagnostics.windowHours, maxLines: policy.modules.diagnostics.maxLines });
      if (formatted.text) candidates.push({ id: 'preview:diagnostics', kind: 'body', bucket: 'otherDynamic',
        priority: 20, text: formatted.text, moduleId: 'diagnostics', sectionKey: 'diagnostic',
        representation: 'summary', locked: false, sourceIdentity: 'diagnostic:sanitized-codes' });
      for (const warning of formatted.warnings || []) violations.push({ code: warning, moduleId: 'diagnostics' });
    } else {
      unsupported.push('diagnostic-source-unavailable');
      violations.push({ code: 'diagnostic-source-unavailable', moduleId: 'diagnostics' });
    }
  }
  const moduleIdsBefore = [...new Set(candidates.map(c => c.moduleId))];
  const frameOf = list => composeFinalEnvelopePre({ candidates: list, tier: resolved.contentTier, budgetPolicy: { mode: 'compat' } });
  let frame = frameOf(candidates);
  let globalFailure = false;
  while (overLimit(frame.text, policy.transport).length) {
    const optional = candidates.filter(c => !c.locked).sort((a, b) => a.priority - b.priority || a.id.localeCompare(b.id));
    if (!optional.length) {
      globalFailure = true;
      violations.push({ code: 'locked-content-does-not-fit', constraints: overLimit(frame.text, policy.transport) });
      for (const c of candidates) omitted.push({ moduleId: c.moduleId, id: c.id, reason: 'preview-unfulfillable' });
      candidates = []; frame = frameOf(candidates); break;
    }
    const victim = optional[0];
    candidates = candidates.filter(c => c !== victim);
    omitted.push({ moduleId: victim.moduleId, id: victim.id, reason: 'global-transport-limit' });
    frame = frameOf(candidates);
  }
  const retained = candidates.map(c => ({ id: c.id, moduleId: c.moduleId, sectionKey: c.sectionKey,
    representation: c.representation, locked: c.locked, sourceIdentity: c.sourceIdentity,
    chars: c.text.length, utf8Bytes: Buffer.byteLength(c.text, 'utf8'),
    // P1 has no unit membership proof. A module candidate must not claim full checkpoints.
    checkpointIds: null, coverage: 'module-view-only' }));
  const contentRetained = retained.filter(c => PRODUCER_IDS.includes(c.moduleId));
  const eventVisible = contentRetained.some(c => c.moduleId === 'events');
  const counts = {
    modules: new Set(contentRetained.map(c => c.moduleId)).size,
    lockedModules: new Set(retained.filter(c => c.locked).map(c => c.moduleId)).size,
    events: eventVisible ? null : 0,
    checkpoints: eventVisible ? null : 0,
    checkpointFull: eventVisible ? null : 0, checkpointSummary: eventVisible ? null : 0,
    checkpointPreview: eventVisible ? null : 0, checkpointPointer: eventVisible ? null : 0,
    representations: {
      full: contentRetained.filter(c => c.representation === 'full').length,
      summary: contentRetained.filter(c => c.representation === 'summary').length,
      preview: contentRetained.filter(c => c.representation === 'preview').length,
      pointer: contentRetained.filter(c => c.representation === 'pointer').length,
    },
  };
  for (const rule of limits(policy.transport)) {
    const actual = textCost(frame.text)[rule.metric];
    if (rule.strength === 'soft' && actual > rule.target) violations.push({ code: 'soft-transport-target-exceeded', ...rule, actual });
  }
  return {
    text: frame.text, chars: frame.chars, partial: true,
    receipt: { status: globalFailure ? 'unfulfillable-preview' : 'partial-preview', contentTier: resolved.contentTier,
      sourceTier: resolved.sourceTier, retained, counts, omitted, violations,
      diagnosticInjections: retained.some(candidate => candidate.moduleId === 'diagnostics') ? 1 : 0,
      unsupported: [...new Set(unsupported)], selectedModules: moduleIdsBefore,
      hostObservation: 'unknown', policySchemaVersion: 2 },
  };
}


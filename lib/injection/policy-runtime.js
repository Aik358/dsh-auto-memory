/** Pure runtime readers. A derived legacy policy is a view of the old settings. */
import { legacyToPolicy, validatePolicy } from './policy-v2.js';

const isConfig = value => value !== null && typeof value === 'object' && !Array.isArray(value);

function savedPolicy(config, resolved) {
  if (resolved !== undefined) return resolved?.source === 'saved' ? resolved.policy : null;
  if (!isConfig(config) || !Object.hasOwn(config, 'deliveryPolicy') || config.deliveryPolicy == null) return null;
  // Do not silently replace an invalid explicit policy with a less restrictive legacy one.
  return validatePolicy(config.deliveryPolicy);
}

export function resolveRuntimePolicy(config) {
  if (!isConfig(config)) return { policy: null, source: 'none' };
  const policy = savedPolicy(config);
  return policy ? { policy, source: 'saved' } : { policy: legacyToPolicy(config), source: 'legacy' };
}

/** Saved policy only. Null leaves cadence to the host's legacy readers. */
export function effectiveTriggers(config, resolved) {
  const t = savedPolicy(config, resolved)?.triggers;
  if (!t) return null;
  return {
    fullGapRounds: t.fullGapRounds,
    slimEveryRounds: t.slimEveryRounds,
    waterPct: t.waterPct.slice(),
    tieredInject: t.tieredInject,
    hangCompensateEnabled: t.hangCompensateEnabled,
    hangCompensateTokens: t.hangCompensateTokens,
  };
}

export function frameTransport(config, resolved) {
  return savedPolicy(config, resolved)?.transport ?? null;
}

/** Excess is above the target; ok tests the absolute maximum including any soft allowance. */
export function measureFrame(text, transport) {
  if (typeof text !== 'string') throw new TypeError('Frame text must be a string');
  const measured = { jsChars: text.length, utf8Bytes: Buffer.byteLength(text, 'utf8') };
  const excess = { jsChars: 0, utf8Bytes: 0 };
  const violations = [];
  let ok = true;
  const strength = transport?.strength ?? 'hard';
  for (const metric of ['jsChars', 'utf8Bytes']) {
    const target = transport?.[metric];
    if (target === undefined) continue;
    const actual = measured[metric];
    const allowance = strength === 'soft' ? (transport.overflowAllowance?.[metric] ?? 0) : 0;
    const absoluteMax = target + allowance;
    excess[metric] = Math.max(0, actual - target);
    const rule = { metric, target, absoluteMax, strength, actual };
    if (strength === 'soft' && excess[metric] > 0) {
      violations.push({ code: 'soft-transport-target-exceeded', ...rule });
    }
    if (actual > absoluteMax) {
      ok = false;
      violations.push({ code: 'transport-limit', ...rule });
    }
  }
  return { ...measured, ok, excess, violations };
}

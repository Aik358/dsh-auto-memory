/**
 * lib/injection/profile.js —— 单一 policyVersion 的注入 profile（L1 §5.2）
 *
 * 契约要求：
 *   · **单一 policyVersion**；早期多个平级版本字段只作组成信息，**不另建平行协议**；
 *   · 另含：来源身份、档位、预算单位、表示版本、降级策略；
 *   · 不得隐式复用旧证据/旧结论（版本变更须让旧结果可被判为不可比）。
 */

import { INJECTION_ERROR_CODES, fail } from './errors.js';
import { requireString, requireEnum, requireVersion, deepFreeze, INJECTION_PROFILE_VERSION } from './dto.js';

/** 档位全集（与 CadenceDecision.tier 同一口径）。 */
export const INJECTION_TIERS = Object.freeze(['full', 'slim', 'run_slim', 'human_slim', 'human_full']);

/** 预算单位：只允许实测口径；token 未实测不得冒称（L1 §4.7）。 */
export const BUDGET_UNITS = Object.freeze([
  'js-chars',
  'utf8-bytes',
  // 'token' —— **刻意不开放**：未实测前不得写入 profile（见 §6.3）
]);

/** 降级策略全集。 */
export const DEGRADE_POLICIES = Object.freeze(['explicit', 'silent-none']);

/**
 * 构造冻结的 profile。
 * @param {object} input
 *   policyVersion   —— 单一版本号（本模块支持 INJECTION_PROFILE_VERSION）
 *   sourceIdentity  —— 来源身份
 *   tier            —— 档位
 *   budgetUnit      —— 预算单位
 *   representationVersion —— 表示版本（事件表示/四段映射等）
 *   degradePolicy   —— 降级策略
 */
export function makeInjectionProfile(input) {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) {
    fail(INJECTION_ERROR_CODES.INVALID_ARGUMENT, 'expected plain object: profile');
  }
  requireVersion(input.policyVersion, 'policyVersion', INJECTION_PROFILE_VERSION);
  return deepFreeze({
    kind: 'InjectionProfile',
    schemaVersion: 1,
    policyVersion: INJECTION_PROFILE_VERSION,
    sourceIdentity: requireString(input.sourceIdentity, 'sourceIdentity'),
    tier: requireEnum(input.tier, 'tier', INJECTION_TIERS),
    budgetUnit: requireEnum(input.budgetUnit, 'budgetUnit', BUDGET_UNITS),
    representationVersion: requireString(input.representationVersion, 'representationVersion'),
    degradePolicy: requireEnum(input.degradePolicy, 'degradePolicy', DEGRADE_POLICIES),
  }, 'InjectionProfile');
}

/** 合法档位判定（供 facade 前置校验用，纯函数）。 */
export function isKnownTier(tier) {
  return typeof tier === 'string' && INJECTION_TIERS.includes(tier);
}
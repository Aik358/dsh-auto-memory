/**
 * lib/injection/index.js —— 公共契约包入口
 *
 * 本包**只导出契约**（DTO / profile / ports / errors），
 * **不实现** B3-SR / B3-RC / B3-CA / B3-PJ 等业务模块，也不读文件、不写记忆、不调模型。
 */

export {
  INJECTION_ERROR_CODES,
  DEGRADATION_CODES,
  InjectionContractError,
  fail,
  isInjectionContractError,
  makeDegradation,
} from './errors.js';

export {
  INJECTION_SCHEMA_VERSION,
  INJECTION_PROFILE_VERSION,
  CONTENT_SPEC_ENUMS,
  CONTENT_SPEC_SEGMENTS,
  requireString,
  requireNonNegativeNumber,
  requireBoolean,
  requireEnum,
  requireStringArray,
  requireVersion,
  deepFreeze,
  RESERVED_FIELD_NAMES,
  makeSourceProof,
  makeProjectionCandidate,
  makeContentSpec,
  makeCadenceDecision,
  makePreparedNotification,
  makeFinalizeReceipt,
  makeHostDeliveryObservation,
  makeUnknownHostObservation,
  makeDeliveryReceipt,
} from './dto.js';

export {
  INJECTION_TIERS,
  BUDGET_UNITS,
  DEGRADE_POLICIES,
  makeInjectionProfile,
  isKnownTier,
} from './profile.js';

export {
  PORT_NAMES,
  createPortRegistry,
  callPort,
  describePortCoverage,
} from './ports.js';

/** 包自述（测试与报告用；不含任何运行时状态）。 */
export const INJECTION_CONTRACT_INFO = Object.freeze({
  name: 'injection-contract',
  schemaVersion: 1,
  profileVersion: 1,
  dtoCount: 8,
  portCount: 5,
  implements: Object.freeze(['contract-only']),
  doesNotImplement: Object.freeze(['B3-SR', 'B3-RC', 'B3-CA', 'B3-PJ']),
});
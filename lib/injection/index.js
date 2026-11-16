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

export {
  readRulesAggregatePre,
  RULE_LAYERS,
  READ_STATUS,
} from './read-rules.js';

export {
  readInjectionSourcesPre,
  createSourcesPort,
  SOURCE_CHANNELS,
} from './read-sources.js';

export {
  decideInjectionCadencePre,
  createCadencePort,
  CADENCE_TIERS,
  GRANT_REASONS,
  DEFAULT_WATER_THRESHOLDS,
  OBSERVATION_FIELDS,
} from './cadence.js';

export {
  projectInjectionPre,
  createProjectionPort,
  filterPortraitItems,
  CONTENT_SPEC_TO_PROMPT_SECTION,
  SLIM_ONLY_TIERS,
  PORTRAIT_ALLOWED_STAGES,
  PORTRAIT_ALLOWED_KINDS,
} from './projection.js';

export {
  renderRulesForTierPre,
  RENDER_TIERS,
  NOTE_PREFIX,
  TRUNC_POINTER,
  SUMMARY_POINTER,
  SLIM_MAINTAIN_BLOCK,
} from './render-rules.js';

export {
  projectHandoffPre,
  createHandoffPort,
  HANDOFF_TAGS,
  HANDOFF_SECTION_ORDER,
  HANDOFF_VIEW_TIERS,
  SLIM_MUST_KEEP,
  TRUNCATION_MARKER,
  tailTruncate,
} from './project-handoff.js';

export {
  prepareNotificationPre,
  finalizeInjectionPre,
  commitNotificationPre,
  splitRuntimeSignalsPre,
  createNotificationPort,
} from './notification.js';

export {
  composeFinalEnvelopePre,
  createFinalFramePort,
  SEGMENT_KINDS,
  BUDGET_MODES,
  DEFAULT_SEPARATOR,
} from './final-frame.js';

export {
  projectEventSectionsPre,
  projectCheckpointSectionsPre,
  renderCheckpointPreviewPre,
  selectEventProjectionPre,
  renderEventSourcePointersPre,
  createEventViewPort,
  EVENT_HEAD_KEYS,
  CHECKPOINT_KEYS,
  EVENT_HEAD_TITLES,
  CHECKPOINT_TITLES,
  EVENT_STATUSES,
  SOURCE_KINDS,
} from './event-view.js';

/** 包自述（测试与报告用；不含任何运行时状态）。 */
export const INJECTION_CONTRACT_INFO = Object.freeze({
  name: 'injection-contract',
  schemaVersion: 1,
  profileVersion: 1,
  dtoCount: 8,
  portCount: 5,
  implements: Object.freeze(['contract-only', 'B3-SR', 'B3-RC', 'B3-CA', 'B3-PJ', 'B3-RP', 'B3-BD', 'B3-NT', 'B3-FM', 'B3-EV']),
  doesNotImplement: Object.freeze(['B3-CO']),
});
export { commitNotificationToFilePre } from './notification-store.js';

export { renderLatestCheckpointPreviewsPre, composeEventFramePre } from './event-frame.js';

/**
 * lib/injection/dto.js —— 公共 DTO 构造器（L1 §5.1）
 *
 * 设计约束（逐条对应契约）：
 *   1. **可 JSON 序列化**：不含函数 / Map / Set / 循环引用；
 *   2. **输入不可变**：构造后 Object.freeze，且对传入数据做深拷贝（不冻结调用方数组或对象）；
 *   3. **非法输入显式报错**：缺字段/类型不符/枚举非法/版本不符 一律抛 InjectionContractError；
 *   4. **稳定身份 + 来源证明 + 错误码 + 降级信息** 四件套在返回里可见。
 *
 * 本模块**只做形状与校验**，不含任何业务逻辑（不读文件、不投影、不算预算）。
 */

import { INJECTION_ERROR_CODES, fail } from './errors.js';

export const INJECTION_SCHEMA_VERSION = 1;
export const INJECTION_PROFILE_VERSION = 1;

/** Production tier identities; full/slim remain accepted compatibility aliases. */
export const INJECTION_TIERS = Object.freeze([
  'human_full', 'human_slim', 'run_full', 'run_slim',
  'post_compact', 'handoff_carry', 'hang_compensate', 'legacy',
  'full', 'slim',
]);

// ─────────────────────────────────────────────────────────────
// 通用校验助手
// ─────────────────────────────────────────────────────────────

/** 契约保留字段名：调用方不得占用（否则会与判别/版本字段互相覆盖）。 */
export const RESERVED_FIELD_NAMES = Object.freeze(['dtoKind', 'schemaVersion']);

/**
 * 断言是普通对象（非 null / 非数组），且**未占用契约保留字段**。
 * 保留字段检查放在这里（而不是 buildDto 内），因为各 DTO 构造器只把
 * 白名单字段传给 buildDto —— 若只在 buildDto 检查，调用方塞进来的保留字段
 * 会被白名单静默丢弃，**看不出被拒绝**，等于检查失效。
 */
function requireObject(value, field) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    fail(INJECTION_ERROR_CODES.INVALID_ARGUMENT, 'expected plain object: ' + field, { field });
  }
  for (const k of RESERVED_FIELD_NAMES) {
    if (Object.prototype.hasOwnProperty.call(value, k)) {
      fail(INJECTION_ERROR_CODES.INVALID_ARGUMENT, 'field name reserved by contract: ' + k, { field: k });
    }
  }
  return value;
}

/** 断言存在且非空字符串。 */
export function requireString(value, field, opts) {
  const o = opts || {};
  if (value === undefined || value === null) {
    fail(INJECTION_ERROR_CODES.MISSING_FIELD, 'missing required field: ' + field, { field });
  }
  if (typeof value !== 'string') {
    fail(INJECTION_ERROR_CODES.INVALID_ARGUMENT, 'expected string: ' + field, { field, detail: typeof value });
  }
  if (o.nonEmpty !== false && value.length === 0) {
    fail(INJECTION_ERROR_CODES.INVALID_ARGUMENT, 'expected non-empty string: ' + field, { field });
  }
  return value;
}

/** 断言是有限非负数字（0 合法，NaN/Infinity/-1 非法）。 */
export function requireNonNegativeNumber(value, field) {
  if (value === undefined || value === null) {
    fail(INJECTION_ERROR_CODES.MISSING_FIELD, 'missing required field: ' + field, { field });
  }
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    fail(INJECTION_ERROR_CODES.INVALID_ARGUMENT, 'expected finite non-negative number: ' + field, { field, detail: String(value) });
  }
  return value;
}

/** 断言是布尔值。 */
export function requireBoolean(value, field) {
  if (typeof value !== 'boolean') {
    fail(INJECTION_ERROR_CODES.INVALID_ARGUMENT, 'expected boolean: ' + field, { field, detail: typeof value });
  }
  return value;
}

/** 断言枚举合法。 */
export function requireEnum(value, field, allowed) {
  requireString(value, field);
  if (!allowed.includes(value)) {
    fail(INJECTION_ERROR_CODES.INVALID_ENUM, 'invalid enum for ' + field + ': ' + value + ' (allowed: ' + allowed.join('|') + ')', { field, detail: value });
  }
  return value;
}

/** 断言字符串数组（元素非空）。 */
export function requireStringArray(value, field) {
  if (!Array.isArray(value)) {
    fail(INJECTION_ERROR_CODES.INVALID_ARGUMENT, 'expected array: ' + field, { field });
  }
  value.forEach((v, i) => requireString(v, field + '[' + i + ']'));
  return value;
}

/**
 * 版本比对：显式不匹配即抛错（契约要求，不得静默兼容）。
 * @param {number} declared 调用方声明的版本
 * @param {number} expected 本模块支持的版本
 */
export function requireVersion(declared, field, expected) {
  if (declared === undefined || declared === null) {
    fail(INJECTION_ERROR_CODES.MISSING_FIELD, 'missing required field: ' + field, { field });
  }
  if (declared !== expected) {
    fail(INJECTION_ERROR_CODES.VERSION_MISMATCH,
      'version mismatch for ' + field + ': got ' + declared + ', expected ' + expected,
      { field, detail: declared });
  }
  return declared;
}

/**
 * 深冻结 + 循环检测。契约要求「不含循环引用」，故构造时即拒绝，
 * 而不是等到 JSON.stringify 才炸（那时调用方已拿到坏对象）。
 */
/** Validate without freezing: a rejected leaf must not partially freeze its caller. */
function inspectDtoGraph(value, path) {
  const active = new WeakSet();
  const complete = new WeakSet();
  const order = [];
  const walk = (v, p) => {
    const type = typeof v;
    if (type === 'function' || type === 'undefined' || type === 'symbol' || type === 'bigint'
      || (type === 'number' && !Number.isFinite(v))) {
      fail(INJECTION_ERROR_CODES.INVALID_ARGUMENT, 'non-JSON value at ' + p, { field: p });
    }
    if (v === null || type !== 'object') return;
    if (active.has(v)) {
      fail(INJECTION_ERROR_CODES.IMMUTABLE_VIOLATION, 'circular reference at ' + p, { field: p });
    }
    if (complete.has(v)) return;
    const array = Array.isArray(v);
    const prototype = Object.getPrototypeOf(v);
    if (!array && prototype !== Object.prototype && prototype !== null) {
      fail(INJECTION_ERROR_CODES.INVALID_ARGUMENT, 'expected JSON data object at ' + p, { field: p });
    }
    active.add(v);
    const keys = Reflect.ownKeys(v);
    for (const key of keys) {
      if (array && key === 'length') continue;
      if (typeof key !== 'string') {
        fail(INJECTION_ERROR_CODES.INVALID_ARGUMENT, 'symbol key not allowed at ' + p, { field: p });
      }
      const descriptor = Object.getOwnPropertyDescriptor(v, key);
      if (!descriptor || !descriptor.enumerable || !Object.prototype.hasOwnProperty.call(descriptor, 'value')) {
        fail(INJECTION_ERROR_CODES.INVALID_ARGUMENT, 'expected enumerable data property at ' + p + '.' + key, { field: p });
      }
      if (array && (!/^(0|[1-9][0-9]*)$/.test(key) || Number(key) >= v.length)) {
        fail(INJECTION_ERROR_CODES.INVALID_ARGUMENT, 'non-index array property at ' + p + '.' + key, { field: p });
      }
      walk(descriptor.value, p + '.' + key);
    }
    if (array && Object.keys(v).length !== v.length) {
      fail(INJECTION_ERROR_CODES.INVALID_ARGUMENT, 'sparse array not allowed at ' + p, { field: p });
    }
    active.delete(v);
    complete.add(v);
    order.push(v);
  };
  walk(value, path || "$");
  return order;
}

/** Copy JSON data before freezing a DTO; keep the public deepFreeze in-place contract. */
function copyDtoData(value, path) {
  const order = inspectDtoGraph(value, path);
  const copies = new WeakMap();
  for (const original of order) {
    const copy = Array.isArray(original) ? []
      : Object.create(Object.getPrototypeOf(original) === null ? null : Object.prototype);
    for (const key of Object.keys(original)) {
      const child = Object.getOwnPropertyDescriptor(original, key).value;
      Object.defineProperty(copy, key, {
        value: child !== null && typeof child === 'object' ? copies.get(child) : child,
        enumerable: true, configurable: true, writable: true,
      });
    }
    copies.set(original, copy);
  }
  return value !== null && typeof value === 'object' ? copies.get(value) : value;
}

export function deepFreeze(value, path) {
  const order = inspectDtoGraph(value, path);
  for (const object of order) Object.freeze(object);
  return value;
}

/**
 * 构造 DTO 的统一外壳：校验 → 组装 → 深冻结。
 * 保证返回对象是全新对象（不持有调用方引用），且可 JSON 往返。
 */
/**
 * 构造 DTO 的统一外壳：校验 → 组装 → 深冻结。
 *
 * ★判别字段用 `dtoKind` 而**不是** `kind` —— 因为 `ProjectionCandidate` 自身就有业务字段 `kind`
 *   （L1 §5.1：「ProjectionCandidate：id、kind、bucket、priority、text、sourceIdentity、contentVersion」）。
 *   若判别字段也叫 `kind`，业务 `kind` 会与判别值互相覆盖 ⇒ 构造出的对象要么丢失业务 `kind`，
 *   要么丢失身份。这是**必须由契约层承担的缺陷**，不应让调用方改名规避。
 */
function buildDto(dtoKind, fields) {
  const out = { dtoKind, schemaVersion: INJECTION_SCHEMA_VERSION };
  for (const k of Object.keys(fields)) {
    if (k === 'dtoKind' || k === 'schemaVersion') {
      fail(INJECTION_ERROR_CODES.INVALID_ARGUMENT, 'field name reserved by contract: ' + k, { field: k });
    }
    out[k] = fields[k];
  }
  return deepFreeze(copyDtoData(out, dtoKind), dtoKind);
}

// ─────────────────────────────────────────────────────────────
// ContentSpec 枚举表（**逐字照抄 L1 §4.4**，不得静默新增公共面）
// ─────────────────────────────────────────────────────────────

/** 每个段的合法取值。新增段必须先登记到这里（契约 §4.4 末条）。 */
export const CONTENT_SPEC_ENUMS = Object.freeze({
  rules: Object.freeze(['none', 'pointer', 'summary', 'full']),
  plan: Object.freeze(['none', 'core', 'full']),
  handoff: Object.freeze(['none', 'sections', 'full']),
  events: Object.freeze(['none', 'cards', 'cards+catalog']),
  portrait: Object.freeze(['none', 'short', 'full']),
  semantic: Object.freeze(['none', 'full']),
  logs: Object.freeze(['none', 'tail', 'full']),
  calendar: Object.freeze(['none', 'current', 'full']),
  externalMemory: Object.freeze(['none', 'full']),
  workspaceMap: Object.freeze(['none', 'brief', 'full']),
  recentLogs: Object.freeze(['none', 'tail', 'full']),
  reflection: Object.freeze(['none', 'recent', 'full']),
  diagnostic: Object.freeze(['none', 'brief', 'full']),
  maintenance: Object.freeze(['none', 'slim-maintain']),
});

export const CONTENT_SPEC_SEGMENTS = Object.freeze(Object.keys(CONTENT_SPEC_ENUMS));

// ─────────────────────────────────────────────────────────────
// 8 个公共 DTO
// ─────────────────────────────────────────────────────────────

/** §5.1 SourceProof：sourceRef、bytes、rawSha256、normalizedSha256、revision */
export function makeSourceProof(input) {
  const o = requireObject(input, 'SourceProof');
  return buildDto('SourceProof', {
    sourceRef: requireString(o.sourceRef, 'sourceRef'),
    bytes: requireNonNegativeNumber(o.bytes, 'bytes'),
    rawSha256: requireString(o.rawSha256, 'rawSha256'),
    normalizedSha256: requireString(o.normalizedSha256, 'normalizedSha256'),
    revision: requireString(o.revision, 'revision'),
  });
}

/** §5.1 ProjectionCandidate：id、kind、bucket、priority、text、sourceIdentity、contentVersion */
export function makeProjectionCandidate(input) {
  const o = requireObject(input, 'ProjectionCandidate');
  return buildDto('ProjectionCandidate', {
    id: requireString(o.id, 'id'),
    kind: requireString(o.kind, 'kind'),
    bucket: requireString(o.bucket, 'bucket'),
    priority: requireNonNegativeNumber(o.priority, 'priority'),
    text: requireString(o.text, 'text', { nonEmpty: false }),
    sourceIdentity: requireString(o.sourceIdentity, 'sourceIdentity'),
    contentVersion: requireString(o.contentVersion, 'contentVersion'),
  });
}

/**
 * §5.1 ContentSpec：§4.4 所列枚举及必要预算/来源字段。
 * 14 个段**全部必填**（缺段即报错，避免不同模块各写一套默认值）。
 */
export function makeContentSpec(input) {
  const o = requireObject(input, 'ContentSpec');
  const fields = {};
  for (const seg of CONTENT_SPEC_SEGMENTS) {
    fields[seg] = requireEnum(o[seg], 'ContentSpec.' + seg, CONTENT_SPEC_ENUMS[seg]);
  }
  // 必要预算/来源字段（契约 §5.1 明确要求）
  fields.budgetPolicy = freezeBudget(o.budgetPolicy);
  fields.sourceIdentity = requireString(o.sourceIdentity, 'ContentSpec.sourceIdentity');
  return buildDto('ContentSpec', fields);
}

/** budgetPolicy：预算单位 + 上限 + 未定标记（未定项不得写死，见 §6.3）。 */
function freezeBudget(input) {
  const b = requireObject(input, 'ContentSpec.budgetPolicy');
  const units = Object.freeze(['js-chars', 'utf8-bytes']);
  return Object.freeze({
    unit: requireEnum(b.unit, 'budgetPolicy.unit', units),
    // cap 允许 null = 未定（§6.3 明确 50K 单位/8000 等不是新批准值）
    cap: b.cap === null || b.cap === undefined ? null : requireNonNegativeNumber(b.cap, 'budgetPolicy.cap'),
    unresolved: b.unresolved === undefined ? false : requireBoolean(b.unresolved, 'budgetPolicy.unresolved'),
  });
}

/** CadenceDecision：既有六字段 + isHuman；旧调用缺省 false，不把 actor 当作 full 授权。 */
export function makeCadenceDecision(input) {
  const o = requireObject(input, 'CadenceDecision');
  const tiers = INJECTION_TIERS;
  if (!Array.isArray(o.grants)) {
    fail(INJECTION_ERROR_CODES.INVALID_ARGUMENT, 'expected array: CadenceDecision.grants', { field: 'grants' });
  }
  return buildDto('CadenceDecision', {
    tier: requireEnum(o.tier, 'CadenceDecision.tier', tiers),
    isHuman: o.isHuman === undefined ? false : requireBoolean(o.isHuman, 'CadenceDecision.isHuman'),
    fullGranted: requireBoolean(o.fullGranted, 'CadenceDecision.fullGranted'),
    slimAllowed: requireBoolean(o.slimAllowed, 'CadenceDecision.slimAllowed'),
    grants: requireStringArray(o.grants, 'CadenceDecision.grants'),
    reasons: requireStringArray(o.reasons, 'CadenceDecision.reasons'),
    requestKey: o.requestKey === null ? null : requireString(o.requestKey, 'CadenceDecision.requestKey'),
  });
}

/** §5.1 PreparedNotification：id、version、payload、commitToken */
export function makePreparedNotification(input) {
  const o = requireObject(input, 'PreparedNotification');
  return buildDto('PreparedNotification', {
    id: requireString(o.id, 'id'),
    version: requireNonNegativeNumber(o.version, 'version'),
    payload: requireString(o.payload, 'payload', { nonEmpty: false }),
    commitToken: requireString(o.commitToken, 'commitToken'),
  });
}

/**
 * §5.1 FinalizeReceipt：requestId、textSha256、selectedNotificationIds、
 *                  preparedVersions、hostObservation
 * 注意：hostObservation **不冒充** hostDelivered —— 未观测必须是 unknown。
 */
export function makeFinalizeReceipt(input) {
  const o = requireObject(input, 'FinalizeReceipt');
  const preparedVersions = requireObject(o.preparedVersions, 'FinalizeReceipt.preparedVersions');
  const pv = {};
  for (const k of Object.keys(preparedVersions)) {
    pv[k] = requireNonNegativeNumber(preparedVersions[k], 'preparedVersions.' + k);
  }
  return buildDto('FinalizeReceipt', {
    requestId: requireString(o.requestId, 'requestId'),
    textSha256: requireString(o.textSha256, 'textSha256'),
    selectedNotificationIds: requireStringArray(o.selectedNotificationIds, 'selectedNotificationIds'),
    preparedVersions: Object.freeze(pv),
    hostObservation: makeHostDeliveryObservation(o.hostObservation),
  });
}

/**
 * §5.1 HostDeliveryObservation：requestId、projected、retained、observedAt、evidenceRef
 * **未观测时明确 unknown，不得伪造 hostDelivered**（契约原文）。
 */
export function makeHostDeliveryObservation(input) {
  const o = requireObject(input, 'HostDeliveryObservation');
  const states = Object.freeze(['unknown', 'projected', 'retained']);
  return buildDto('HostDeliveryObservation', {
    requestId: requireString(o.requestId, 'requestId'),
    projected: requireEnum(o.projected, 'HostDeliveryObservation.projected', states),
    retained: requireEnum(o.retained, 'HostDeliveryObservation.retained', states),
    observedAt: o.observedAt === null ? null : requireString(o.observedAt, 'observedAt'),
    evidenceRef: o.evidenceRef === null || o.evidenceRef === undefined
      ? null : requireString(o.evidenceRef, 'evidenceRef'),
  });
}

/** 未观测的默认观测：显式 unknown，绝不默认 projected。 */
export function makeUnknownHostObservation(requestId) {
  return makeHostDeliveryObservation({
    requestId, projected: 'unknown', retained: 'unknown', observedAt: null, evidenceRef: null,
  });
}

/** §5.1 DeliveryReceipt：requestId、finalizedText、selectedNotificationIds、committed、skipped、errors */
export function makeDeliveryReceipt(input) {
  const o = requireObject(input, 'DeliveryReceipt');
  if (!Array.isArray(o.errors)) {
    fail(INJECTION_ERROR_CODES.INVALID_ARGUMENT, 'expected array: DeliveryReceipt.errors', { field: 'errors' });
  }
  const errors = o.errors.map((e, i) => {
    const eo = requireObject(e, 'errors[' + i + ']');
    return Object.freeze({
      code: requireString(eo.code, 'errors[' + i + '].code'),
      message: requireString(eo.message, 'errors[' + i + '].message', { nonEmpty: false }),
    });
  });
  return buildDto('DeliveryReceipt', {
    requestId: requireString(o.requestId, 'requestId'),
    finalizedText: requireString(o.finalizedText, 'finalizedText', { nonEmpty: false }),
    selectedNotificationIds: requireStringArray(o.selectedNotificationIds, 'selectedNotificationIds'),
    committed: requireStringArray(o.committed, 'committed'),
    skipped: requireStringArray(o.skipped, 'skipped'),
    errors: Object.freeze(errors),
  });
}

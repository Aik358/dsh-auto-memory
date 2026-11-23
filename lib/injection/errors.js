/**
 * lib/injection/errors.js —— 公共契约的统一错误与降级形状
 *
 * 契约要求（L1 §5 / §9）：
 *   · 非法输入、版本不符必须**显式报错**，不得静默纠正或静默返回空；
 *   · 缺 port 必须**显式降级**（degradation），不得静默跳过；
 *   · 所有返回携带错误码，便于调用方与测试统一判定。
 */

export const INJECTION_ERROR_CODES = Object.freeze({
  INVALID_ARGUMENT: 'injection-invalid-argument',
  MISSING_FIELD: 'injection-missing-field',
  INVALID_ENUM: 'injection-invalid-enum',
  VERSION_MISMATCH: 'injection-version-mismatch',
  IMMUTABLE_VIOLATION: 'injection-immutable-violation',
  PORT_MISSING: 'injection-port-missing',
  DEGRADED: 'injection-degraded',
});

/** 契约错误：带 code / field / detail，可安全序列化（不含堆栈）。 */
export class InjectionContractError extends Error {
  constructor(code, message, extra) {
    super(message);
    this.name = 'InjectionContractError';
    this.code = code;
    const e = extra || {};
    this.field = e.field === undefined ? null : e.field;
    this.detail = e.detail === undefined ? null : e.detail;
  }

  /** 契约要求「错误可 JSON 序列化」，故显式提供。 */
  toJSON() {
    return { name: this.name, code: this.code, message: this.message, field: this.field, detail: this.detail };
  }
}

/** 构造并抛出 —— 统一入口，避免各处手写 new + throw。 */
export function fail(code, message, extra) {
  throw new InjectionContractError(code, message, extra);
}

/** 判定是否为契约错误（供调用方区分「契约拒绝」与「真实异常」）。 */
export function isInjectionContractError(e) {
  return !!e && e.name === 'InjectionContractError' && typeof e.code === 'string';
}

/**
 * 显式降级记录。缺 port / 通道超限等场景**必须**产出它，而不是静默跳过。
 * 形状与 DTO 一致：可 JSON 序列化、无函数。
 */
export function makeDegradation(code, message, extra) {
  const e = extra || {};
  return {
    code: String(code),
    message: String(message),
    scope: e.scope === undefined ? null : e.scope,
    recoverable: e.recoverable === undefined ? true : !!e.recoverable,
  };
}

export const DEGRADATION_CODES = Object.freeze({
  PORT_MISSING: 'port-missing',
  CHANNEL_OVERFLOW: 'channel-overflow',
  UNKNOWN: 'degraded-unknown',
});
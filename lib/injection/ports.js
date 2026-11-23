/**
 * lib/injection/ports.js —— 依赖注入 facade（缺 port 显式降级）
 *
 * 契约要求（L1 §9 / §5.1）：
 *   · 依赖**注入**而非模块内 import 具体实现；
 *   · **缺 port 必须显式降级**（返回 degradation），不得静默跳过或抛出裸异常；
 *   · 本层只做「拿到 port 并调用 + 归一化结果」，不实现任何业务逻辑。
 * 不实现 SR/RC/CA/PJ 业务模块。
 */

import { INJECTION_ERROR_CODES, DEGRADATION_CODES, fail, makeDegradation } from './errors.js';

/** 契约要求的 5 个 port 名。缺任一 ⇒ 显式降级。 */
export const PORT_NAMES = Object.freeze([
  'sources',   // B3-SR：全来源读取（本批不实现，仅留接口）
  'rules',     // B3-RC：规则完整读取
  'cadence',   // B3-CA：帧节奏
  'projection',// B3-PJ：投影
  'clock',     // 时钟（测试可注入，避免真实时间进断言）
]);

/**
 * 构造 port registry。
 * **只接受函数**：每个 port 必须可调用（对象型 port 用 .call 语义不统一，故统一为函数）。
 * 缺省项不报错（允许部分注入），但使用时会产出显式降级。
 */
export function createPortRegistry(input) {
  const src = input === undefined || input === null ? {} : input;
  if (typeof src !== 'object' || Array.isArray(src)) {
    fail(INJECTION_ERROR_CODES.INVALID_ARGUMENT, 'expected plain object: ports');
  }
  const ports = {};
  const provided = [];
  const missing = [];
  for (const name of PORT_NAMES) {
    const v = src[name];
    if (v === undefined || v === null) {
      missing.push(name);
      continue;
    }
    if (typeof v !== 'function') {
      fail(INJECTION_ERROR_CODES.INVALID_ARGUMENT, 'port must be a function: ' + name, { field: name, detail: typeof v });
    }
    ports[name] = v;
    provided.push(name);
  }
  return Object.freeze({
    kind: 'PortRegistry',
    ports: Object.freeze(ports),
    provided: Object.freeze(provided),
    missing: Object.freeze(missing),
  });
}

/**
 * 调用一个 port。
 * 缺 port ⇒ **显式降级**（返回 { ok:false, degradation }），不抛异常、不返回 undefined。
 * port 抛错 ⇒ 包装成契约错误（保留原 message，不吞）。
 */
export function callPort(registry, name, args) {
  if (!registry || registry.kind !== 'PortRegistry') {
    fail(INJECTION_ERROR_CODES.INVALID_ARGUMENT, 'expected PortRegistry: registry');
  }
  if (!PORT_NAMES.includes(name)) {
    fail(INJECTION_ERROR_CODES.INVALID_ENUM, 'unknown port: ' + name + ' (known: ' + PORT_NAMES.join('|') + ')', { field: 'name', detail: name });
  }
  const fn = registry.ports[name];
  if (typeof fn !== 'function') {
    // ★契约核心：缺 port **必须显式降级**，不得静默
    return {
      ok: false,
      value: null,
      degradation: makeDegradation(DEGRADATION_CODES.PORT_MISSING,
        'port not provided: ' + name + ' (degraded explicitly)', { scope: name }),
    };
  }
  try {
    const value = fn.apply(null, Array.isArray(args) ? args : []);
    return { ok: true, value, degradation: null };
  } catch (e) {
    fail(INJECTION_ERROR_CODES.DEGRADED, 'port threw: ' + name + ': ' + String(e && e.message), {
      field: name, detail: String(e && e.message),
    });
  }
  return null; // 不可达，仅为显式表明控制流
}

/** 缺 port 的批量清点（供自检与报告用，纯函数）。 */
export function describePortCoverage(registry) {
  if (!registry || registry.kind !== 'PortRegistry') {
    fail(INJECTION_ERROR_CODES.INVALID_ARGUMENT, 'expected PortRegistry: registry');
  }
  return Object.freeze({
    total: PORT_NAMES.length,
    provided: registry.provided.length,
    missing: registry.missing.length,
    missingNames: registry.missing,
    complete: registry.missing.length === 0,
  });
}
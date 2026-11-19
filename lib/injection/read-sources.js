/**
 * lib/injection/read-sources.js —— B3-SR：全来源读取（L1 §4.1）
 *
 * readInjectionSourcesPre({paths,state,policyVersion})
 *   → {rules,events,plan,handoff,reflections,logs,proofs,warnings}
 *
 * 契约：
 *   · **只读**：不写事件/白板/账本/记忆/配置；
 *   · 返回来源身份、相对路径、bytes、rawSha256、normalizedSha256、revision；
 *   · 区分 missing / empty / unreadable / invalid；**读取失败不得静默转空**；
 *   · rules 来自 B3-RC（本模块**调用** readRulesAggregatePre，不重写其逻辑）；
 *   · 其他来源由各自 Reader 适配器提供；**不要求 Prototype 作数据源**、不新增事实源。
 */

import { createHash } from 'node:crypto';
import { INJECTION_ERROR_CODES, fail, makeDegradation } from './errors.js';
import { makeSourceProof, requireVersion, INJECTION_PROFILE_VERSION } from './dto.js';
import { READ_STATUS, readRulesAggregatePre } from './read-rules.js';

const sha256 = (s) => createHash('sha256').update(s, 'utf8').digest('hex');
const normLF = (s) => String(s == null ? '' : s).replace(/\r\n/g, '\n').replace(/\r/g, '\n');

/** 非规则来源的 7 个通道（rules 单独由 B3-RC 提供）。 */
export const SOURCE_CHANNELS = Object.freeze([
  'events', 'plan', 'handoff', 'reflections', 'logs',
]);

/**
 * 读取一个非规则来源。与 B3-RC 同一四态口径，但**不解析内容**（内容由各自 Reader 负责）。
 * paths 项可以是 {path, reader?}：reader 存在时优先调用它（真实调用方注入）。
 */
function readChannel(name, spec, readFile, warnings, proofs, statuses) {
  if (!spec) {
    statuses[name] = READ_STATUS.MISSING;
    return Object.freeze({ status: READ_STATUS.MISSING, text: '', proof: null });
  }
  // 注入式 reader（真实调用方提供的适配器）优先
  if (typeof spec.reader === 'function') {
    try {
      const v = spec.reader();
      const text = typeof v === 'string' ? v : (v && typeof v.text === 'string' ? v.text : null);
      if (text === null) {
        statuses[name] = READ_STATUS.INVALID;
        warnings.push(makeDegradation('invalid-content', name + ' reader returned non-text', { scope: name }));
        return Object.freeze({ status: READ_STATUS.INVALID, text: '', proof: null });
      }
      return finalizeChannel(name, text, spec, warnings, proofs, statuses);
    } catch (e) {
      statuses[name] = READ_STATUS.UNREADABLE;
      warnings.push(makeDegradation('read-failed', name + ' reader threw: ' + String(e && (e.code || e.message)), { scope: name }));
      return Object.freeze({ status: READ_STATUS.UNREADABLE, text: '', proof: null });
    }
  }
  if (!spec.path) {
    statuses[name] = READ_STATUS.MISSING;
    return Object.freeze({ status: READ_STATUS.MISSING, text: '', proof: null });
  }
  if (typeof readFile !== 'function') {
    statuses[name] = READ_STATUS.UNREADABLE;
    warnings.push(makeDegradation('readfile-not-injected', name + ': readFile port not provided', { scope: name }));
    return Object.freeze({ status: READ_STATUS.UNREADABLE, text: '', proof: null });
  }
  try {
    const raw = readFile(spec.path);
    if (raw === null || raw === undefined) { statuses[name] = READ_STATUS.MISSING; return Object.freeze({ status: READ_STATUS.MISSING, text: '', proof: null }) }
    if (typeof raw !== 'string') {
      statuses[name] = READ_STATUS.INVALID;
      warnings.push(makeDegradation('invalid-content', name + ' content is not a string', { scope: name }));
      return Object.freeze({ status: READ_STATUS.INVALID, text: '', proof: null });
    }
    return finalizeChannel(name, raw, spec, warnings, proofs, statuses);
  } catch (e) {
    const code = e && (e.code || e.name);
    const status = code === 'ENOENT' ? READ_STATUS.MISSING : READ_STATUS.UNREADABLE;
    statuses[name] = status;
    warnings.push(makeDegradation('read-failed', name + ' read failed: ' + String(code), { scope: name }));
    return Object.freeze({ status, text: '', proof: null });
  }
}

function finalizeChannel(name, raw, spec, warnings, proofs, statuses) {
  const normalized = normLF(raw);
  if (!normalized.trim()) {
    statuses[name] = READ_STATUS.EMPTY;
    return Object.freeze({ status: READ_STATUS.EMPTY, text: '', proof: null,
      bytes: Buffer.byteLength(raw, 'utf8') });
  }
  const proof = makeSourceProof({
    sourceRef: spec.sourceRef || ('source:' + name),
    bytes: Buffer.byteLength(raw, 'utf8'),
    rawSha256: sha256(raw),
    normalizedSha256: sha256(normalized),
    revision: 'sha256:' + sha256(normalized).slice(0, 16),
  });
  proofs[name] = proof;
  statuses[name] = READ_STATUS.OK;
  return Object.freeze({
    status: READ_STATUS.OK, text: normalized, proof,
    relativePath: spec.relativePath || null,
    sourceIdentity: proof.sourceRef,
  });
}

/**
 * B3-SR 主入口。**只读**。
 * @param {object} input
 *   paths   {object} 各来源路径或 {path,reader,sourceRef,relativePath}
 *   state   {object} 可选，只读取不写（本项目不使用其写路径）
 *   policyVersion {number} 可选，须与公共 profile 一致（不传则不校验）
 *   readFile {Function} 可选，注入式读取器
 *   rules   {object} 可选，透传给 readRulesAggregatePre 的参数（userFile/notesPath/candidatePath/ownerSessionId/sessionKey）
 */
export function readInjectionSourcesPre(input) {
  const o = input === null || typeof input !== 'object' ? {} : input;
  if (o.policyVersion !== undefined) {
    requireVersion(o.policyVersion, 'policyVersion', INJECTION_PROFILE_VERSION);
  }
  const paths = o.paths && typeof o.paths === 'object' ? o.paths : {};
  const readFile = o.readFile;
  const warnings = [];
  const proofs = {};
  const statuses = {};

  // ── rules：**委托 B3-RC**（不重写解析逻辑）
  const rulesInput = Object.assign({}, o.rules || {}, { readFile });
  rulesInput.userFile = rulesInput.userFile || (paths.rules && paths.rules.userFile) || (paths.userFile);
  rulesInput.notesPath = rulesInput.notesPath || (paths.rules && paths.rules.notesPath) || (paths.notesPath);
  rulesInput.candidatePath = rulesInput.candidatePath || (paths.rules && paths.rules.candidatePath) || (paths.candidatePath);
  const rules = readRulesAggregatePre(rulesInput);
  for (const w of rules.warnings) warnings.push(w);
  for (const k of Object.keys(rules.proofs)) proofs['rules.' + k] = rules.proofs[k];
  statuses.rules = rules.statuses;

  // ── 其他来源
  const channels = {};
  for (const name of SOURCE_CHANNELS) {
    channels[name] = readChannel(name, paths[name], readFile, warnings, proofs, statuses);
  }

  return Object.freeze({
    dtoKind: 'InjectionSources',
    schemaVersion: 1,
    rules,
    events: channels.events,
    plan: channels.plan,
    handoff: channels.handoff,
    reflections: channels.reflections,
    logs: channels.logs,
    proofs: Object.freeze(proofs),
    statuses: Object.freeze(statuses),
    warnings: Object.freeze(warnings),
  });
}

/** 把 SR 注册为 ports.js 的 sources port（供 DI facade 使用）。 */
export function createSourcesPort(getInput) {
  if (typeof getInput !== 'function') {
    fail(INJECTION_ERROR_CODES.INVALID_ARGUMENT, 'createSourcesPort requires a function that returns input');
  }
  return (() => readInjectionSourcesPre(getInput()));
}
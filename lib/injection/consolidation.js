/**
 * lib/injection/consolidation.js —— B3-CO：Consolidation 扩读取面（L1 §4.10）
 *
 * collectConsolidationSourcesPre({days,readers})
 *   → {logs,events,plan,handoff,reflections,proofs,warnings}
 * buildConsolidationPromptPre({sources,budgetPolicy})
 *   → {prompt,counts,truncation,sourceProofs}
 * applyConsolidationResultPre({parsed,writer,budget})
 *   → {written,skipped,errors} for synchronous dependencies;
 *     Promise<{written,skipped,errors}> only when budget or writer returns a thenable.
 * budget may be an explicit approval result or an admission callback/check port.
 *
 * 契约（L1 §4.10 / L2 §9 逐条）：
 *   · **collect/build 只读**；apply **由现有工作流写入**（本层不自带写权限）；
 *   · 来源含**日志、事件、白板、账本、反思**；
 *   · ★**unreadable 不得当空来源**（必须显式区分 unreadable / empty / missing）；
 *   · ★**USER 候选仍只进待确认区**，不直接写全局用户级 MEMORY；
 *   · **不承担事件归并、四段补全或 2.4**；
 *   · ★**模型解析失败、空正文、超时不得产生新写入**。
 */

import { INJECTION_ERROR_CODES, fail, makeDegradation } from './errors.js';
import { makeSourceProof } from './dto.js';

/** ★五类来源（与 read-sources.js 的 SOURCE_CHANNELS 同口径）。 */
export const CONSOLIDATION_CHANNELS = Object.freeze(['logs', 'events', 'plan', 'handoff', 'reflections']);

/** 读取四态（与 B3-RC / B3-SR 同口径）。 */
export const READ_STATES = Object.freeze(['ok', 'empty', 'missing', 'unreadable']);

/**
 * 结果分区：**只有 ok/empty 算「读到了」**；
 * ★**unreadable 绝不当空来源** —— 它必须留下 warning 并计入 `unreadable` 计数。
 */
function classifyRead(name, spec, readFile, warnings, proofs) {
  if (!spec) {
    return { name, state: 'missing', text: '', reason: '未提供该来源' };
  }
  const p = typeof spec === 'string' ? spec : spec.path;
  if (!p) {
    return { name, state: 'missing', text: '', reason: '未提供路径' };
  }
  if (typeof readFile !== 'function') {
    // ★给了路径但没有读函数 ⇒ **unreadable**（不是 empty、更不是 missing）
    warnings.push({ code: 'unreadable', channel: name, ref: p, message: '有路径但无 readFile ⇒ 判定 unreadable，**不当空来源**' });
    return { name, state: 'unreadable', text: '', reason: 'no-readFile' };
  }
  let raw;
  try {
    raw = readFile(p);
  } catch (e) {
    const code = (e && (e.code || e.name)) || 'read-error';
    // ★读失败同样**不当空来源**
    warnings.push({ code: 'unreadable', channel: name, ref: p, message: '读取失败（' + code + '）⇒ 判定 unreadable，**不当空来源**' });
    return { name, state: 'unreadable', text: '', reason: code };
  }
  if (raw === undefined || raw === null) {
    warnings.push({ code: 'unreadable', channel: name, ref: p, message: 'readFile 返回空值 ⇒ 判定 unreadable' });
    return { name, state: 'unreadable', text: '', reason: 'null-return' };
  }
  if (raw && typeof raw.then === 'function') {
    Promise.resolve(raw).catch(() => {});
    warnings.push({ code: 'unreadable', channel: name, ref: p, message: 'sync source reader returned a Promise; prefetch a source snapshot first' });
    return { name, state: 'unreadable', text: '', reason: 'async-reader-not-supported' };
  }
  if (typeof raw !== 'string' && !Buffer.isBuffer(raw)) {
    warnings.push({ code: 'unreadable', channel: name, ref: p, message: 'source reader must return text or a Buffer' });
    return { name, state: 'unreadable', text: '', reason: 'invalid-reader-result' };
  }
  const text = String(raw);
  // ★sourceProof：raw 与 normalized 双口径 + revision
  proofs.push(makeSourceProof({
    sourceRef: p,
    bytes: Buffer.byteLength(text, 'utf8'),
    rawSha256: sha256(text),
    normalizedSha256: sha256(normalizeEol(text)),
    revision: sha256(normalizeEol(text)).slice(0, 16),
  }));
  if (!text.trim()) {
    return { name, state: 'empty', text: '', reason: '文件存在但内容为空' };
  }
  return { name, state: 'ok', text, reason: null };
}

import { createHash } from 'node:crypto';
function sha256(s) { return createHash('sha256').update(String(s), 'utf8').digest('hex'); }
/** 行尾归一化（CRLF / CR → LF）。 */
function normalizeEol(s) { return String(s).replace(/\r\n/g, '\n').replace(/\r/g, '\n'); }
/**
 * ★ collect：**只读**聚合五类来源。
 *
 * @param {object} input {days, readers, readFile}
 *   readers —— {logs:[{path}], events:[...], plan:{path}, handoff:{path}, reflections:[...]}
 *   也可传字符串路径或 {path}。
 */
export function collectConsolidationSourcesPre(input) {
  const o = input === null || typeof input !== 'object' ? {} : input;
  const readers = o.readers && typeof o.readers === 'object' ? o.readers : {};
  const readFile = typeof o.readFile === 'function' ? o.readFile : null;
  const warnings = [];
  const proofs = [];
  const states = Object.create(null);
  const out = Object.create(null);

  const normalize = (v) => {
    if (v === undefined || v === null) return [];
    if (Array.isArray(v)) return v;
    return [v];
  };

  for (const ch of CONSOLIDATION_CHANNELS) {
    let specs = normalize(readers[ch]);
    if (ch === 'logs' && o.days !== undefined && o.days !== null) {
      const days = Math.floor(Number(o.days));
      if (Number.isFinite(days) && days >= 0) {
        const now = o.clock ? Number(o.clock()) : Date.now();
        const cutoff = now - days * 86400000;
        specs = specs.filter((spec) => {
          const ref = typeof spec === 'string' ? spec : spec && spec.path;
          const match = String(ref || '').match(/(\d{4}-\d{2}-\d{2})(?:\.md)?$/);
          if (!match) return true;
          return Date.parse(match[1] + 'T00:00:00Z') >= cutoff;
        });
      }
    }
    const items = [];
    const chStates = [];
    for (const spec of specs) {
      const r = classifyRead(ch, spec, readFile, warnings, proofs);
      chStates.push(r.state);
      if (r.state === 'ok') items.push({ ref: typeof spec === 'string' ? spec : spec.path, text: r.text });
    }
    out[ch] = Object.freeze(items);
    // ★通道状态：任一 unreadable ⇒ 该通道记 unreadable（**不被空来源掩盖**）
    const st = chStates.length === 0 ? 'missing'
      : chStates.includes('unreadable') ? 'unreadable'
      : chStates.every((x) => x === 'empty') ? 'empty'
      : chStates.includes('ok') ? 'ok' : 'empty';
    states[ch] = st;
    if (st === 'unreadable') {
      warnings.push({ code: 'channel-unreadable', channel: ch, message: ch + ' 通道含 unreadable 来源，**不得当空来源参与统计**' });
    }
  }

  return Object.freeze({
    dtoKind: 'ConsolidationSources', schemaVersion: 1,
    logs: out.logs,
    events: out.events,
    plan: out.plan,
    handoff: out.handoff,
    reflections: out.reflections,
    proofs: Object.freeze(proofs),
    warnings: Object.freeze(warnings),
    states: Object.freeze(states),
    counts: Object.freeze({
      ok: CONSOLIDATION_CHANNELS.filter((c) => states[c] === 'ok').length,
      empty: CONSOLIDATION_CHANNELS.filter((c) => states[c] === 'empty').length,
      missing: CONSOLIDATION_CHANNELS.filter((c) => states[c] === 'missing').length,
      unreadable: CONSOLIDATION_CHANNELS.filter((c) => states[c] === 'unreadable').length,
    }),
  });
}

/**
 * ★ build：组装 prompt。**只读**（不写任何状态）。
 *
 * ★**统计每类输入 JS 字符、最终 prompt 字符与被裁量**（L2 §9.2：不沿用历史 12.7%）。
 */
export function buildConsolidationPromptPre(input) {
  const o = input === null || typeof input !== 'object' ? {} : input;
  const src = o.sources && typeof o.sources === 'object' ? o.sources : {};
  const bp = o.budgetPolicy && typeof o.budgetPolicy === 'object' ? o.budgetPolicy : {};
  const cap = bp.promptChars === undefined || bp.promptChars === null ? null : Number(bp.promptChars);
  if (cap !== null && (!Number.isSafeInteger(cap) || cap < 0
      || !['number', 'string'].includes(typeof bp.promptChars)
      || (typeof bp.promptChars === 'string' && !bp.promptChars.trim()))) {
    fail(INJECTION_ERROR_CODES.INVALID_ARGUMENT, 'promptChars must be a non-negative integer', { field: 'budgetPolicy.promptChars' });
  }
  const unresolved = [];
  if (cap === null) {
    unresolved.push({ key: 'budgetPolicy.promptChars', reason: '未给 prompt 字符上限 ⇒ 不裁剪（不擅自定值）' });
  }

  // ── 逐类统计输入字符（**只统计 ok 的；unreadable 单独列出，不并入空**）
  const inputChars = Object.create(null);
  const blockOf = Object.create(null);
  for (const ch of CONSOLIDATION_CHANNELS) {
    const arr = Array.isArray(src[ch]) ? src[ch] : [];
    let chars = 0;
    const parts = [];
    for (const it of arr) {
      const t = typeof it.text === 'string' ? it.text : '';
      chars += t.length;
      parts.push(t);
    }
    inputChars[ch] = chars;
    blockOf[ch] = parts.join('\n');
  }
  const totalInput = CONSOLIDATION_CHANNELS.reduce((n, c) => n + inputChars[c], 0);

  const head = [
    '你是用户的长期记忆管家。请阅读下面的**多源**工作材料，提炼值得长期记住的内容。',
    '规则：',
    '- 只提炼有跨会话长期价值的：技术决策、架构约定、关键路径、用户偏好、踩过的坑及其规则',
    '- 不记临时信息；语体用第三人称客观陈述，只落可复用结论',
    '- 项目专属 → [PROJECT]；跨项目通用的用户硬性规则/偏好 → [USER]',
    '- ★[USER] 只是**候选**，会进待确认区，不会直接写入全局用户级 MEMORY',
    '- 若没有任何值得长期记录的内容，只输出一行：(无)',
    '',
  ].join('\n');

  const sectionTitles = { logs: '工作日志', events: '事件', plan: '项目白板', handoff: '交接账本', reflections: '反思' };
  const bodyParts = [];
  for (const ch of CONSOLIDATION_CHANNELS) {
    if (!blockOf[ch]) continue;
    bodyParts.push('## ' + sectionTitles[ch] + '\n' + blockOf[ch]);
  }
  const body = bodyParts.join('\n\n');
  let prompt = head + body;
  let truncatedChars = 0;
  if (cap !== null && prompt.length > cap) {
    if (head.length > cap) {
      fail(INJECTION_ERROR_CODES.INVALID_ARGUMENT,
        'prompt-budget-unsatisfiable: the required instruction header exceeds the explicit cap',
        { field: 'budgetPolicy.promptChars', detail: { capChars: cap, requiredChars: head.length } });
    }
    const room = cap - head.length;
    let tail = room > 0 ? body.slice(Math.max(0, body.length - room)) : '';
    if (/^[\uDC00-\uDFFF]/.test(tail)) tail = tail.slice(1);
    truncatedChars = prompt.length - (head.length + tail.length);
    prompt = head + tail;
  }

  const counts = Object.freeze({
    inputChars: Object.freeze(inputChars),
    inputTotalChars: totalInput,
    promptChars: prompt.length,
    truncatedChars,
    // ★如实给出「被裁比例」，但**不预设/沿用任何历史比例**（如 12.7%）
    truncatedRatio: totalInput > 0 ? Math.round((truncatedChars / totalInput) * 10000) / 10000 : 0,
    okChannels: CONSOLIDATION_CHANNELS.filter((c) => inputChars[c] > 0).length,
  });

  return Object.freeze({
    dtoKind: 'ConsolidationPrompt', schemaVersion: 1,
    prompt,
    counts,
    truncation: Object.freeze({ capChars: cap, truncatedChars, truncated: truncatedChars > 0 }),
    sourceProofs: Object.freeze(Array.isArray(src.proofs) ? src.proofs.slice() : []),
    // ★unreadable 单列，不进 inputChars 也不被当成 0 内容来源
    unreadableChannels: Object.freeze(CONSOLIDATION_CHANNELS.filter((c) => src.states && src.states[c] === 'unreadable')),
    unresolved: Object.freeze(unresolved),
  });
}
/**
 * ★ apply：**只经现有 writer 应用**。
 *
 * 契约（L1 §4.10 / L2 §9.1）：
 *   · ★**模型解析失败、空正文、超时、`(无)` 一律不产生新写入**；
 *   · ★**USER 候选仍只进待确认区**（`writer.writeUserPending`），**绝不直接写全局用户级 MEMORY**；
 *   · **不承担事件归并、四段补全或 2.4**（本层只写 project note 与 user pending）；
 *   · writer 由调用方注入（现有工作流），本层**不自带写权限**。
 *
 * @param {object} input {parsed, writer, budget}
 *   parsed —— {text} 或 {status:'timeout'|'empty'|'none'|'parse-error', ...}
 */
export function applyConsolidationResultPre(input) {
  const o = input === null || typeof input !== 'object' ? {} : input;
  const parsed = o.parsed && typeof o.parsed === 'object' ? o.parsed : {};
  const writer = o.writer;
  const written = [];
  const skipped = [];
  const errors = [];

  // ── ★ 失败态**一律不写**（四类显式 + 未知态保守不写）
  const status = typeof parsed.status === 'string' ? parsed.status : null;
  const NO_WRITE = ['timeout', 'empty', 'none', 'parse-error'];
  if (status && NO_WRITE.includes(status)) {
    return Object.freeze({
      dtoKind: 'ConsolidationApply', schemaVersion: 1,
      written: Object.freeze([]),
      skipped: Object.freeze([{ target: 'all', reason: status }]),
      errors: Object.freeze([]),
      wroteAnything: false,
      note: '模型 ' + status + ' ⇒ **未产生任何写入**',
    });
  }
  if (status && !['ok', 'success', 'done'].includes(status)) {
    return Object.freeze({ dtoKind: 'ConsolidationApply', schemaVersion: 1, written: Object.freeze([]),
      skipped: Object.freeze([{ target: 'all', reason: 'unknown-status' }]), errors: Object.freeze([]), wroteAnything: false });
  }
  const text = typeof parsed.text === 'string' ? parsed.text : '';
  if (!text.trim()) {
    // ★空正文（含 status 缺失但 text 为空）⇒ 不写
    return Object.freeze({
      dtoKind: 'ConsolidationApply', schemaVersion: 1,
      written: Object.freeze([]),
      skipped: Object.freeze([{ target: 'all', reason: 'empty-body' }]),
      errors: Object.freeze([]),
      wroteAnything: false,
      note: '正文为空 ⇒ **未产生任何写入**',
    });
  }
  // ★(无) 判定：模型明确说没内容
  if (/^\s*\(无\)\s*$/m.test(text)) {
    return Object.freeze({
      dtoKind: 'ConsolidationApply', schemaVersion: 1,
      written: Object.freeze([]),
      skipped: Object.freeze([{ target: 'all', reason: 'none-marker' }]),
      errors: Object.freeze([]),
      wroteAnything: false,
      note: '模型输出 (无) ⇒ 未产生任何写入',
    });
  }

  // ── 解析 [PROJECT] / [USER] 分节
  const projectPts = [];
  const userPts = [];
  let section = null;
  for (const raw of text.split('\n')) {
    const l = String(raw).trim();
    if (!l) continue;
    if (l === '[PROJECT]') { section = 'project'; continue; }
    if (l === '[USER]') { section = 'user'; continue; }
    if (l.startsWith('- ') && section) {
      const pt = l.slice(2).trim();
      if (pt) (section === 'project' ? projectPts : userPts).push(pt);
    }
  }
  if (!projectPts.length && !userPts.length) {
    // ★解析不出任何条目 ⇒ 视为解析失败，**不写**
    return Object.freeze({
      dtoKind: 'ConsolidationApply', schemaVersion: 1,
      written: Object.freeze([]),
      skipped: Object.freeze([{ target: 'all', reason: 'parse-error' }]),
      errors: Object.freeze([]),
      wroteAnything: false,
      note: '解析不出 [PROJECT]/[USER] 条目 ⇒ 视为解析失败，**未产生任何写入**',
    });
  }

  if (!writer || typeof writer !== 'object') {
    fail(INJECTION_ERROR_CODES.MISSING_FIELD,
      'applyConsolidationResultPre requires an injected writer (现有工作流)；本层不自带写权限', { field: 'writer' });
  }

  // Keep synchronous callers synchronous; create a Promise only for a real thenable.
  const isThenable = (value) => value !== null
    && (typeof value === 'object' || typeof value === 'function')
    && typeof value.then === 'function';
  const recordFailure = (code, target, error) => {
    errors.push({ code, target, message: String((error && error.message) || error) });
  };
  const admit = (target, points) => {
    const budget = o.budget;
    if (budget === undefined || budget === null) return true;
    const request = { target, points: points.slice(), chars: points.join('\n').length };
    if (typeof budget === 'function') return budget(request);
    if (budget && typeof budget.check === 'function') return budget.check(request);
    return budget;
  };
  const invokeWriter = (target, method, points, extra) => {
    const acceptWrite = (result) => {
      if (result === false || (result && result.ok === false)) {
        throw new Error('writer explicitly rejected the write');
      }
      written.push(Object.assign({ target, count: points.length }, extra || {}));
    };
    try {
      const result = writer[method](points.slice());
      if (isThenable(result)) {
        return Promise.resolve(result).then((value) => {
          try { acceptWrite(value); }
          catch (error) { recordFailure('write-failed', target, error); }
        }, (error) => { recordFailure('write-failed', target, error); });
      }
      acceptWrite(result);
    } catch (error) {
      recordFailure('write-failed', target, error);
    }
    return null;
  };
  const writeTarget = (target, method, points, extra) => {
    if (!points.length) return null;
    try {
      if (typeof writer[method] !== 'function') {
        skipped.push({ target, reason: 'writer 未提供 ' + method });
        return null;
      }
    } catch (error) {
      recordFailure('write-failed', target, error);
      return null;
    }
    const afterAdmission = (decision) => {
      let allowed;
      try { allowed = decision === true || !!(decision && decision.ok === true); }
      catch (error) {
        recordFailure('budget-check-failed', target, error);
        return null;
      }
      if (!allowed) {
        skipped.push({ target, reason: 'budget-rejected' });
        return null;
      }
      return invokeWriter(target, method, points, extra);
    };
    try {
      const decision = admit(target, points);
      if (isThenable(decision)) {
        return Promise.resolve(decision).then(afterAdmission,
          (error) => { recordFailure('budget-check-failed', target, error); });
      }
      return afterAdmission(decision);
    } catch (error) {
      recordFailure('budget-check-failed', target, error);
      return null;
    }
  };
  const runTargets = () => {
    const project = writeTarget('projectNote', 'writeProjectNote', projectPts);
    const user = () => writeTarget('userPending', 'writeUserPending', userPts, { pendingConfirm: true });
    return isThenable(project) ? Promise.resolve(project).then(user) : user();
  };

  const finish = () => {
    if (userPts.length) {
      try {
        if (typeof writer.writeUserGlobal === 'function') skipped.push({ target: 'userGlobal', reason: 'USER 候选不直接写全局用户级 MEMORY（L1 §4.10）' });
      } catch (error) {
        recordFailure('writer-inspection-failed', 'userGlobal', error);
      }
    }
    return Object.freeze({
      dtoKind: 'ConsolidationApply', schemaVersion: 1,
      written: Object.freeze(written),
      skipped: Object.freeze(skipped),
      errors: Object.freeze(errors),
      wroteAnything: written.length > 0,
      didRegroup: false,
      didSectionFill: false,
      didConsolidate24: false,
    });
  };
  const completion = runTargets();
  return isThenable(completion) ? Promise.resolve(completion).then(finish) : finish();
}

/** 注册专用 port（供 DI facade 使用）。 */
export function createConsolidationPort(getInput, fn) {
  if (typeof getInput !== 'function' || typeof fn !== 'function') {
    fail(INJECTION_ERROR_CODES.INVALID_ARGUMENT, 'createConsolidationPort requires (getInput, fn)');
  }
  return (() => fn(getInput()));
}
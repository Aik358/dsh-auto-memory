/**
 * lib/injection/final-frame.js —— B3-FM：最终帧（L1 §4.7）
 *
 * composeFinalEnvelopePre({candidates,tier,budgetPolicy})
 *   → {text,chars,segments,dropped,truncated,degradations,unresolved}
 *
 * 契约（L1 §4.7 / L2 §7.3 逐条）：
 *   · **标题、分隔符、降级尾巴、通知、反思先成为段，再统一计量**；
 *   · **text.length = chars.total = 分桶之和 = 最终段长度之和**；**另记 UTF-8 bytes**；
 *   · **候选账与实际投递账分离**；最终选帧**每请求只记一次**；
 *   · 区分**兼容计量**与**硬上限**政策；**未定的 full/压缩/50K/段级/整帧边界放 unresolved**，不擅自定值；
 *   · token **未实测不得冒称**。
 */

import { INJECTION_ERROR_CODES, fail, makeDegradation } from './errors.js';

/** 段类型（**先成段**的类别，顺序即拼接顺序）。 */
export const SEGMENT_KINDS = Object.freeze([
  'title', 'body', 'notification', 'reflection', 'degradationTail', 'separator',
]);

/** 默认分隔符（可用 budgetPolicy.separator 覆盖）。 */
export const DEFAULT_SEPARATOR = '\n\n';

/**
 * ★预算政策。区分两类：
 *   · `mode:'compat'` —— **兼容计量**：只统计，不裁剪（不改变既有行为）；
 *   · `mode:'hard'`   —— **硬上限**：按 cap 裁剪（丢弃/截断），并如实记账。
 * 未给出 cap 时（含 hard 模式）⇒ 不裁，且把边界写进 unresolved。
 */
export const BUDGET_MODES = Object.freeze(['compat', 'hard']);

/** UTF-8 字节数（不靠 Buffer.byteLength 之外的口径，Node 下等价且可复算）。 */
function utf8Bytes(s) {
  return Buffer.byteLength(String(s), 'utf8');
}

/** 把候选归一为「段」。candidates 里可带 kind/bucket/text；非对象项忽略。 */
function toSegment(c, sep) {
  const o = c && typeof c === 'object' ? c : {};
  const kind = SEGMENT_KINDS.includes(o.kind) ? o.kind : 'body';
  const text = typeof o.text === 'string' ? o.text : '';
  const bucket = typeof o.bucket === 'string' && o.bucket ? o.bucket : kind;
  const priority = Number.isFinite(Number(o.priority)) ? Number(o.priority) : 0;
  return { kind, bucket, text, priority, id: typeof o.id === 'string' ? o.id : null, sep };
}

/**
 * ★ 主入口：组合最终帧。**纯函数**。
 *
 * @param {object} input {candidates, tier, budgetPolicy, requestId}
 * @returns {{text,chars,segments,dropped,truncated,degradations,unresolved,bytes}}
 */
export function composeFinalEnvelopePre(input) {
  const o = input === null || typeof input !== 'object' ? {} : input;
  const tier = typeof o.tier === 'string' ? o.tier : 'slim';
  const bp = o.budgetPolicy && typeof o.budgetPolicy === 'object' ? o.budgetPolicy : {};
  const mode = BUDGET_MODES.includes(bp.mode) ? bp.mode : 'compat';
  const degradations = [];
  const unresolved = [];

  if (!BUDGET_MODES.includes(bp.mode)) {
    unresolved.push({ key: 'budgetPolicy.mode', reason: '未显式声明 compat/hard ⇒ 按 compat（只计量不裁剪）' });
  }

  const sep = typeof bp.separator === 'string' ? bp.separator : DEFAULT_SEPARATOR;
  const list = Array.isArray(o.candidates) ? o.candidates : [];

  // ── ★先成段（标题/分隔符/降级尾巴/通知/反思都在这里成为段）
  let segs = list.map((c) => toSegment(c, sep)).filter((s) => s.text !== '');
  // 分隔符段：显式登记，使其长度也进入等式（不会被「凭空多出」的字符破坏等式）
  // 注意：separator 长度计入**相邻段之间**，故不入 segments 列表，而在计数时单列。
  const segCount = segs.length;
  const sepLen = segCount > 1 ? sep.length * (segCount - 1) : 0;

  // ── 硬上限裁剪：**只裁后段低优先级**，并如实记账
  const dropped = [];
  let truncated = false;
  const cap = Number.isFinite(Number(bp.capChars)) && Number(bp.capChars) > 0 ? Number(bp.capChars) : null;
  if (mode === 'compat') {
    unresolved.push({ key: 'budgetPolicy.capChars', reason: 'compat 模式只计量不裁剪；硬上限未启用' });
  } else if (cap === null) {
    unresolved.push({ key: 'budgetPolicy.capChars', reason: 'hard 模式但未给 capChars ⇒ 不裁剪（不擅自定值）' });
  } else {
    // 固定：title / degradationTail 优先保留；其余按 priority 升序淘汰
    const KEEP = ['title', 'degradationTail'];
    const computeLen = (arr) => {
      const t = arr.map((x) => x.text).join(sep);
      return t.length;
    };
    let guard = 0;
    while (computeLen(segs) > cap && guard++ < 10000) {
      let victim = -1;
      let lowest = Infinity;
      for (let i = 0; i < segs.length; i++) {
        if (KEEP.includes(segs[i].kind)) continue;
        if (segs[i].priority < lowest) { lowest = segs[i].priority; victim = i; }
      }
      if (victim < 0) {
        // 只剩必须保留的段仍超限 ⇒ 截断最后一个可截段（**显式标记**）
        const tail = segs[segs.length - 1];
        const over = computeLen(segs) - cap;
        if (tail) {
          const keepN = Math.max(0, tail.text.length - over);
          tail.text = tail.text.slice(0, keepN);
          truncated = true;
        }
        break;
      }
      dropped.push({ id: segs[victim].id, kind: segs[victim].kind, bucket: segs[victim].bucket, chars: segs[victim].text.length });
      segs.splice(victim, 1);
    }
    if (dropped.length) {
      degradations.push(makeDegradation('segment-dropped',
        'hard 上限 ' + cap + ' ⇒ 丢弃 ' + dropped.length + ' 段', { scope: 'final-frame', recoverable: true }));
    }
  }

  // 重新计算分隔符长度（裁剪后段数可能变化）
  const finalSepLen = segs.length > 1 ? sep.length * (segs.length - 1) : 0;
  const text = segs.map((s) => s.text).join(sep);

  // ── ★计量等式：text.length === chars.total === 分桶和(含分隔) === 最终段长和 + 分隔长度和
  const segments = segs.map((s) => ({
    kind: s.kind,
    bucket: s.bucket,
    chars: s.text.length,
    bytes: utf8Bytes(s.text),
    id: s.id,
  }));
  const segCharSum = segs.reduce((n, s) => n + s.text.length, 0);

  const buckets = {};
  for (const s of segs) buckets[s.bucket] = (buckets[s.bucket] || 0) + s.text.length;
  if (finalSepLen > 0) buckets['separator'] = finalSepLen;

  const bucketSum = Object.keys(buckets).reduce((n, k) => n + buckets[k], 0);

  // ★断言等式（不成立就是内部缺陷，直接抛，不静默产出错账）
  if (text.length !== segCharSum + finalSepLen) {
    fail(INJECTION_ERROR_CODES.INVALID_ARGUMENT,
      'internal accounting broken: text.length(' + text.length + ') !== segSum(' + segCharSum + ')+sep(' + finalSepLen + ')',
      { field: 'chars' });
  }
  if (bucketSum !== text.length) {
    fail(INJECTION_ERROR_CODES.INVALID_ARGUMENT,
      'internal accounting broken: bucketSum(' + bucketSum + ') !== text.length(' + text.length + ')',
      { field: 'chars' });
  }

  // ★候选账与实际投递账**分离**
  const candidateAccount = Object.freeze({
    total: list.length,
    chars: list.reduce((n, c) => n + (typeof (c && c.text) === 'string' ? c.text.length : 0), 0),
  });
  const deliveredAccount = Object.freeze({
    segments: segs.length,
    chars: text.length,
  });

  const chars = Object.freeze({
    total: text.length,
    byBucket: Object.freeze(buckets),
    segmentChars: segCharSum,
    separatorChars: finalSepLen,
    bytes: utf8Bytes(text),
    // ★token 未实测 ⇒ 显式 null，**不冒称**
    tokens: null,
  });

  if (fpUnset(bp)) {
    unresolved.push({ key: 'budgetPolicy.fullExit', reason: 'full 出口的公共记账边界未定案（跨请求对照待验）' });
    unresolved.push({ key: 'budgetPolicy.compression', reason: '压缩边界未定案' });
    unresolved.push({ key: 'budgetPolicy.50K', reason: '50K 整帧上限未定案（不得擅自定值）' });
    unresolved.push({ key: 'budgetPolicy.segmentLevel', reason: '段级硬上限未定案' });
    unresolved.push({ key: 'budgetPolicy.frameLevel', reason: '整帧硬上限未定案' });
  }

  return Object.freeze({
    dtoKind: 'FinalEnvelope',
    schemaVersion: 1,
    text,
    chars,
    segments: Object.freeze(segments),
    dropped: Object.freeze(dropped),
    truncated,
    degradations: Object.freeze(degradations),
    unresolved: Object.freeze(unresolved),
    mode,
    tier,
    candidateAccount,
    deliveredAccount,
  });
}

/** 是否所有未决边界都未声明（用于生成 unresolved 清单）。 */
function fpUnset(bp) {
  return bp.fullExit === undefined && bp.compression === undefined
    && bp.peak50k === undefined && bp.segmentLevel === undefined && bp.frameLevel === undefined;
}

/** 注册专用 port（供 DI facade 使用）。 */
export function createFinalFramePort(getInput) {
  if (typeof getInput !== 'function') {
    fail(INJECTION_ERROR_CODES.INVALID_ARGUMENT, 'createFinalFramePort requires a function that returns input');
  }
  return (() => composeFinalEnvelopePre(getInput()));
}
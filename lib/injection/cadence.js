/**
 * lib/injection/cadence.js —— B3-CA：帧节奏纯决策（L1 §4.3）
 *
 * decideInjectionCadencePre({state,frame,signals,config,requestKey})
 *   → {tier,fullGranted,slimAllowed,grants,reasons,requestKey,...}
 *
 * ★★本模块是**纯函数**：
 *   · **不读也不写 state**（只从入参读快照，返回决策供适配器显式提交）；
 *   · 不渲染内容、不提交任何通知、不做 IO；
 *   · 同输入两次调用输出**逐字节一致**（可被测试锁死）。
 *
 * 覆盖（L1 §4.3）：首帧、真人/运行、fullGap、slimEvery、25/50 水位、
 *   post_compact、handoff_carry、hang_compensate、legacy 回退。
 *
 * ★真实 engine 字段（task-38 复核修订，2026-11-17）：
 *   状态侧优先读**真实字段**，紧凑别名仅作兜底——
 *     `_compactSeqSeenPre`   (别名 lastCompactCount)  —— 上次观测到的压缩序号基线
 *     `compactionSeq`        (别名 compactCount)      —— 当前压缩序号
 *     `_waterPctFired`       (别名 waterFired)        —— 已投递到的最高水位阈值
 *     `_lastFullStepSeq`     (别名 lastFullTurn)      —— 上次完整版的 step 序号
 *     `_stepSeq`             (别名 turnIndex)         —— 当前 step 序号
 *     `requestKey`           —— **真实请求身份**，由调用方输入；本模块**不自造**前缀覆盖
 */

import { INJECTION_ERROR_CODES, fail } from './errors.js';

// ─────────────────────────────────────────────────────────────
// 水位阈值解析
// ─────────────────────────────────────────────────────────────

/**
 * 水位阈值解析。
 *
 * ★★缺省语义（task-38 复核修订，按 L1 §6.1「50%水位默认关闭，25%保留」的**已裁定口径**）：
 *   · **缺省 / 空串 / 全非法 ⇒ `[25]`**（**只有 25；50 默认关闭**）
 *   · 显式 `'25,50'` ⇒ **`[25,50]`**（用户显式要求双档时保留，不得被缺省逻辑吞掉）
 *   · 显式 `'0'`/`'off'`/`'none'`/`'false'`/`0`/`false` ⇒ `[]`（**禁用**）
 *   · 其它自定义列表 ⇒ 逐项 Number()、丢弃 <1 或 >100、去重（两位小数）、升序
 *
 * ⚠ 与 `lib/index.js:2153` 既有实现的**差异点（必须记住）**：既有实现缺省回落 `[25,50]`，
 *   即 50 档**当前仍然开启**（L1 §6.2 已记为「❌ 未实现」）。本模块实现的是**已裁定口径**；
 *   生产替换前两者行为不同属**预期**，不是缺陷——替换时须按本节语义同步。
 */
export const DEFAULT_WATER_THRESHOLDS = Object.freeze([25]);

export function parseWaterThresholds(raw) {
  if (typeof raw === 'string') {
    const low = raw.trim().toLowerCase();
    if (low === '0' || low === 'off' || low === 'none' || low === 'false') return [];
  }
  if (raw === 0 || raw === false) return [];
  let parts = [];
  if (Array.isArray(raw)) parts = raw;
  else if (typeof raw === 'number') parts = [raw];
  else if (typeof raw === 'string') parts = raw.split(/[,;\s]+/);
  else return DEFAULT_WATER_THRESHOLDS.slice();
  const seen = Object.create(null);
  const out = [];
  for (const p of parts) {
    if (p === null || p === undefined || p === '') continue;
    const n = Number(p);
    if (!Number.isFinite(n)) continue;
    if (n < 1 || n > 100) continue;
    const r = Math.round(n * 100) / 100;
    if (seen[r]) continue;
    seen[r] = true;
    out.push(r);
  }
  if (!out.length) return DEFAULT_WATER_THRESHOLDS.slice();
  out.sort((a, b) => a - b);
  return out;
}

/**
 * 水位判定：按「最高已跨阈值」+ 一次性标记（与既有语义一致）。
 * 一次跳过多个阈值只投一次；fireAt = 本次跨过的最高阈值；压缩后 lastFired 复位为 0 可再投。
 */
export function decideWaterFire(waterPct, thresholds, lastFired) {
  const list = Array.isArray(thresholds) ? thresholds : [];
  const last = Number(lastFired) || 0;
  if (!list.length) return { fire: false, fireAt: 0, nextThreshold: null };
  const w = Number(waterPct);
  if (!Number.isFinite(w)) return { fire: false, fireAt: 0, nextThreshold: list[0] };
  let highest = 0;
  for (const t of list) if (w >= t && t > highest) highest = t;
  const next = list.find((t) => t > Math.max(w, last));
  if (highest > last) return { fire: true, fireAt: highest, nextThreshold: next === undefined ? null : next };
  return { fire: false, fireAt: 0, nextThreshold: next === undefined ? null : next };
}

// ─────────────────────────────────────────────────────────────
// 主决策函数
// ─────────────────────────────────────────────────────────────

export const CADENCE_TIERS = Object.freeze(['full', 'slim', 'run_slim', 'human_slim', 'human_full']);

/** 授予原因码（可被测试与回执消费）。 */
export const GRANT_REASONS = Object.freeze({
  FIRST_OBSERVATION_BASELINE: 'first-observation-baseline', // 首观测：只建压缩基线
  HUMAN_TURN: 'human-turn',
  UNATTENDED: 'unattended',
  FULL_GAP: 'full-gap',
  SLIM_EVERY: 'slim-every',
  WATER_25: 'water-25',
  WATER_50: 'water-50',
  WATER_CUSTOM: 'water-custom',
  POST_COMPACT: 'post-compact',            // ★新压缩（无论是否授予 full 都记录）
  POST_COMPACT_NO_REINJECT: 'post-compact-no-reinject', // 新压缩但 snapshotReinjectOnCompact=false
  HANDOFF_CARRY: 'handoff-carry',
  HANG_COMPENSATE: 'hang-compensate',
  LEGACY_FALLBACK: 'legacy-fallback',
});

/** 真实观测字段名（用于「是否真的观测过」的判定，避免把空 state 误判成首观测）。 */
export const OBSERVATION_FIELDS = Object.freeze([
  '_compactSeqSeenPre', 'compactionSeq', '_stepSeq', '_lastFullStepSeq', '_waterPctFired', 'loadedAt',
]);

/** 从 state 里按「真实字段 → 别名」顺序取数；取不到返回 null（**不把 0 当缺失**）。 */
function readNum(state, names) {
  for (const n of names) {
    const v = state[n];
    if (v === undefined || v === null || v === '') continue;
    const x = Number(v);
    if (Number.isFinite(x)) return x;
  }
  return null;
}

/**
 * ★ 纯决策主入口。
 *
 * @param {object} input
 *   state   —— **只读快照**（不持有引用、不写回）。优先真实字段，别名兜底：
 *     _compactSeqSeenPre / compactionSeq / _waterPctFired / _lastFullStepSeq / _stepSeq / waterPct / requestKey
 *   frame   —— {carry?, hangCompensate?, step?}
 *   signals —— {isHumanTurn?, isUnattended?, postCompact?, firstObservation?,
 *               handoffCarry?, hangCompensate?, slimEvery?, fullGap?, legacy?}
 *   config  —— {fullInjectWaterPct, snapshotMinGapRounds, slimEvery, snapshotReinjectOnCompact}
 *   requestKey —— **真实请求身份**（也可放在 state.requestKey）
 */
export function decideInjectionCadencePre(input) {
  const o = input === null || typeof input !== 'object' ? {} : input;
  const state = o.state && typeof o.state === 'object' ? o.state : {};
  const frame = o.frame && typeof o.frame === 'object' ? o.frame : {};
  const sig = o.signals && typeof o.signals === 'object' ? o.signals : {};
  const cfg = o.config && typeof o.config === 'object' ? o.config : {};

  const grants = [];
  const reasons = [];
  let fullGranted = false;

  // ── 读真实字段（别名兜底）
  const stepSeq = readNum(state, ['_stepSeq', 'turnIndex']);
  const lastFullStepSeq = readNum(state, ['_lastFullStepSeq', 'lastFullTurn']);
  const compactionSeq = readNum(state, ['compactionSeq', 'compactCount']);
  const compactSeqSeen = readNum(state, ['_compactSeqSeenPre', 'lastCompactCount']);
  const waterPctFired = readNum(state, ['_waterPctFired', 'waterFired']) ?? 0;
  const waterPct = readNum(state, ['waterPct', '_waterPct']);

  // ── 1. 首观测判定（★不再「没字段就是首观测」）
  //   有观测字段存在，且压缩基线缺失但有当前序号 ⇒ 首观测（需要建基线）。
  //   空 state / 完全无观测字段 ⇒ **不判首观测**，按 legacy fail-open 正常决策。
  const hasAnyObservation = OBSERVATION_FIELDS.some((k) => state[k] !== undefined && state[k] !== null);
  const explicitFirst = sig.firstObservation === true;
  const isFirstObservation = explicitFirst
    || (hasAnyObservation && compactSeqSeen === null && compactionSeq !== null);

  let compactionBaselineOnly = false;
  if (isFirstObservation) {
    // ★★首观测**只建压缩基线**：记录基线后**继续往下决策**，
    //   绝不吞掉正常的 human / fullGap 等条件（task-38 复核修订）。
    compactionBaselineOnly = true;
    grants.push(GRANT_REASONS.FIRST_OBSERVATION_BASELINE);
    reasons.push('首观测：只建立压缩基线（compactionSeq=' + compactionSeq + '），不据此授予 full；继续按 human/fullGap 等正常条件决策');
  }

  if (!hasAnyObservation) {
    reasons.push('无任何观测字段 ⇒ **不**判首观测；按 legacy fail-open 正常决策');
  }

  // ── 2. legacy 回退：缺信号 ⇒ fail-open（显式标记，不崩）
  if (sig.legacy === true) {
    grants.push(GRANT_REASONS.LEGACY_FALLBACK);
    reasons.push('legacy 输入缺信号 ⇒ fail-open（按精简决策并显式标记）');
  }

  // ── 3. 新压缩判定：**必须序号增长**（历史压缩不得当成新压缩）
  const newCompact = (compactionSeq !== null && compactSeqSeen !== null)
    ? compactionSeq > compactSeqSeen
    : false;
  if (sig.postCompact === true && !newCompact) {
    reasons.push('收到 postCompact 信号但压缩序号未增长或基线缺失 ⇒ 不当作新压缩');
  }

  if (newCompact) {
    grants.push(GRANT_REASONS.POST_COMPACT);
    reasons.push('检测到新压缩（compactionSeq ' + compactionSeq + ' > 基线 ' + compactSeqSeen + '）');
    // ★snapshotReinjectOnCompact=false ⇒ **不授予 full，但 post_compact 仍记录**（上面已 push）
    const cfgReinject = cfg.snapshotReinjectOnCompact;
    const sigReinject = sig.snapshotReinjectOnCompact;
    const reinject = !(cfgReinject === false || sigReinject === false);
    if (reinject) {
      fullGranted = true;
      reasons.push('snapshotReinjectOnCompact 未禁用 ⇒ 强制 full（短路，不受间距限制）');
      return finalize('full', true, true, grants, reasons, o, { newCompact, compactionBaselineOnly, stepSeq, lastFullStepSeq, compactionSeq, compactSeqSeen });
    }
    grants.push(GRANT_REASONS.POST_COMPACT_NO_REINJECT);
    reasons.push('snapshotReinjectOnCompact=false ⇒ 记录 post_compact 但**不授予 full**，继续评估 human/fullGap');
  }

  // ── 4. 特殊档：handoff_carry / hang_compensate 保持触发语义
  if (sig.handoffCarry === true || frame.carry === true) {
    grants.push(GRANT_REASONS.HANDOFF_CARRY);
    reasons.push('handoff_carry 档 ⇒ 保留既有触发语义（授予 full）');
    return finalize('full', true, true, grants, reasons, o, { newCompact, compactionBaselineOnly, stepSeq, lastFullStepSeq, compactionSeq, compactSeqSeen });
  }
  if (sig.hangCompensate === true || frame.hangCompensate === true) {
    grants.push(GRANT_REASONS.HANG_COMPENSATE);
    reasons.push('hang_compensate 档 ⇒ 保留既有触发语义（授予 full）');
    return finalize('full', true, true, grants, reasons, o, { newCompact, compactionBaselineOnly, stepSeq, lastFullStepSeq, compactionSeq, compactSeqSeen });
  }

  // ── 5. 真人说话 ⇒ full
  const humanTurn = sig.isHumanTurn === true || state.humanTurn === true;
  const unattended = sig.isUnattended === true || state.unattended === true;
  if (humanTurn) {
    grants.push(GRANT_REASONS.HUMAN_TURN);
    reasons.push('真人发言 ⇒ 授予 full');
    return finalize('full', true, true, grants, reasons, o, { newCompact, compactionBaselineOnly, stepSeq, lastFullStepSeq, compactionSeq, compactSeqSeen });
  }

  // ── 6. 水位（缺省只 25；显式 25,50 双档；off/0 禁用）
  const thresholds = parseWaterThresholds(cfg.fullInjectWaterPct);
  if (!thresholds.length) {
    reasons.push('水位阈值显式禁用（off/0）⇒ 不因水位授予 full');
  } else {
    const w = decideWaterFire(waterPct, thresholds, waterPctFired);
    if (w.fire) {
      grants.push(w.fireAt === 25 ? GRANT_REASONS.WATER_25
        : w.fireAt === 50 ? GRANT_REASONS.WATER_50 : GRANT_REASONS.WATER_CUSTOM);
      reasons.push('水位 ' + waterPct + '% 跨过最高阈值 ' + w.fireAt + '（阈值表 ' + thresholds.join(',') + '）⇒ 授予 full');
      return finalize('full', true, true, grants, reasons, o, { newCompact, compactionBaselineOnly, stepSeq, lastFullStepSeq, compactionSeq, compactSeqSeen });
    }
  }

  // ── 7. fullGap（用真实 step 字段）
  const gapNeed = Number.isFinite(Number(cfg.snapshotMinGapRounds)) ? Number(cfg.snapshotMinGapRounds) : 5;
  const gap = (stepSeq !== null && lastFullStepSeq !== null) ? stepSeq - lastFullStepSeq : null;
  const gapHit = sig.fullGap === true || (gap !== null && gap >= gapNeed);
  if (gapHit) {
    grants.push(GRANT_REASONS.FULL_GAP);
    reasons.push('间距满足（gap ' + (gap === null ? 'via-signal' : gap) + ' >= ' + gapNeed + '）⇒ 授予 full');
    return finalize('full', true, true, grants, reasons, o, { newCompact, compactionBaselineOnly, stepSeq, lastFullStepSeq, compactionSeq, compactSeqSeen });
  }

  // ── 8. 无人值守 / slimEvery ⇒ 精简
  if (unattended) {
    grants.push(GRANT_REASONS.UNATTENDED);
    reasons.push('无人值守 ⇒ 不授予 full');
  }
  const slimEvery = Number.isFinite(Number(sig.slimEvery)) ? Number(sig.slimEvery)
    : (Number.isFinite(Number(cfg.slimEvery)) ? Number(cfg.slimEvery) : null);
  if (slimEvery !== null && gap !== null && gap >= slimEvery) {
    grants.push(GRANT_REASONS.SLIM_EVERY);
    reasons.push('slimEvery=' + slimEvery + ' 且 gap=' + gap + ' ⇒ 精简');
  }

  reasons.push('无 full 条件命中 ⇒ 精简');
  return finalize('slim', false, true, grants, reasons, o, { newCompact, compactionBaselineOnly, stepSeq, lastFullStepSeq, compactionSeq, compactSeqSeen });
}

/**
 * 组装返回。
 *
 * ★requestKey 语义（task-38 复核修订）：**只回显调用方提供的真实请求身份**，
 *   **绝不**用 `cad:...` 之类自造串覆盖；缺失时显式 `requestKey: null` + `requestKeyMissing: true`，
 *   并由 reasons 说明『交由适配器补』——宁可为空，不可伪造。
 */
function finalize(tier, fullGranted, slimAllowed, grants, reasons, o, obs) {
  const s = o.state && typeof o.state === 'object' ? o.state : {};
  const realKey = (typeof o.requestKey === 'string' && o.requestKey.length > 0)
    ? o.requestKey
    : (typeof s.requestKey === 'string' && s.requestKey.length > 0 ? s.requestKey : null);
  const outReasons = reasons.slice();
  if (realKey === null) {
    outReasons.push('requestKey 未由调用方提供：**不伪造**，保持 null 并由适配器补真实请求身份');
  }
  const _ = obs || {};
  return Object.freeze({
    dtoKind: 'CadenceDecision',
    schemaVersion: 1,
    tier,
    fullGranted: !!fullGranted,
    slimAllowed: !!slimAllowed,
    grants: Object.freeze(grants.slice()),
    reasons: Object.freeze(outReasons),
    requestKey: realKey,
    requestKeyMissing: realKey === null,
    newCompact: _.newCompact === true,
    compactionBaselineOnly: _.compactionBaselineOnly === true,
    // 只读回显（供适配器显式提交基线，本函数不写任何状态）
    observed: Object.freeze({
      stepSeq: _.stepSeq === undefined ? null : _.stepSeq,
      lastFullStepSeq: _.lastFullStepSeq === undefined ? null : _.lastFullStepSeq,
      compactionSeq: _.compactionSeq === undefined ? null : _.compactionSeq,
      compactSeqSeen: _.compactSeqSeen === undefined ? null : _.compactSeqSeen,
    }),
  });
}

/** 注册为 ports.js 的 cadence port（供 DI facade 使用）。 */
export function createCadencePort(getInput) {
  if (typeof getInput !== 'function') {
    fail(INJECTION_ERROR_CODES.INVALID_ARGUMENT, 'createCadencePort requires a function that returns input');
  }
  return (() => decideInjectionCadencePre(getInput()));
}
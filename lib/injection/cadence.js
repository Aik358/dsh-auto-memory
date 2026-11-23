/**
 * lib/injection/cadence.js —— B3-CA：帧节奏纯决策（L1 §4.3）
 *
 * decideInjectionCadencePre({state,frame,signals,config,requestKey})
 *   → {tier,isHuman,fullGranted,slimAllowed,grants,reasons,requestKey,...}
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
import { INJECTION_TIERS } from './dto.js';

// ─────────────────────────────────────────────────────────────
// 水位阈值解析
// ─────────────────────────────────────────────────────────────

/**
 * 水位阈值解析。
 *
 * ★★缺省语义（task-38 复核修订，按 L1 §6.1「50%水位默认关闭，25%保留」的**已裁定口径**）：
 *   · **缺省 / 空串 / 全非法 ⇒ `[25]`**（**只有 25；50 默认关闭**）
 *   · 显式 `'25,50'` ⇒ **`[25,50]`**（用户显式要求双档时保留，不得被缺省逻辑吞掉）
 *   · 显式 `[]`/`'0'`/`'off'`/`'none'`/`'false'`/`0`/`false` ⇒ `[]`（**禁用**）
 *   · 其它自定义列表 ⇒ 逐项 Number()、丢弃 <1 或 >100、去重（两位小数）、升序
 *
 * 生产 `lib/index.js` 的水位解析适配器已委托本函数，缺省同为 `[25]`。
 *   显式 `'25,50'` 仍按双档解析；旧默认残留的一次性迁移属于配置加载层，
 *   不在这个纯解析器里覆盖显式输入。
 */
export const DEFAULT_WATER_THRESHOLDS = Object.freeze([25]);

export function parseWaterThresholds(raw) {
  if (typeof raw === 'string') {
    const low = raw.trim().toLowerCase();
    if (low === '0' || low === 'off' || low === 'none' || low === 'false') return [];
  }
  if (raw === 0 || raw === false || (Array.isArray(raw) && raw.length === 0)) return [];
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

export const CADENCE_TIERS = INJECTION_TIERS;

/** 授予原因码（可被测试与回执消费）。 */
export const GRANT_REASONS = Object.freeze({
  FIRST_FRAME: 'first-frame',
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
 *   signals —— {isHumanTurn?, isHuman?, isUnattended?, postCompact?, firstObservation?, firstFrame?,
 *     真人正信号为 isHumanTurn | isHuman | state.humanTurn | state._humanPending | state._humanPendingNow。
 *     纯决策优先级：carry / 新压缩重注入 / hang / firstFrame / 水位 / 真人 / 普通fullGap / slim。
 *     同请求缓存与实际投递准入由适配器处理；本函数不自造身份、不写state。
 *               handoffCarry?, hangCompensate?, slimEvery?, fullGap?, legacy?}
 *   config  —— {fullInjectWaterPct, snapshotMinGapRounds=40, slimEveryRounds=15, slimEvery?, snapshotReinjectOnCompact}
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
  const stepSeq = readNum(state, ['_stepSeq', 'turnIndex']);
  const lastFullStepSeq = readNum(state, ['_lastFullStepSeq', 'lastFullTurn']);
  const lastSlimStepSeq = readNum(state, ['_lastSlimStepSeq', 'lastSlimStepSeq', 'lastSlimTurn']);
  const compactionSeq = readNum(state, ['compactionSeq', 'compactCount']);
  const compactSeqSeen = readNum(state, ['_compactSeqSeenPre', 'lastCompactCount']);
  const waterPctFired = readNum(state, ['_waterPctFired', 'waterFired']) ?? 0;
  const explicitWaterPct = readNum(state, ['waterPct', '_waterPct']);
  const waterRatio = readNum(state, ['waterLevelRatio', 'waterLevel']);
  const waterPct = explicitWaterPct !== null ? explicitWaterPct
    : (waterRatio === null ? null : waterRatio * 100);
  // ★Lead 裁定（A批 r2）：**接受生产真实信号名**，不要求旧夹具迁就。
  //   生产入口（lib/index.js:24591）的条件是 `_waterFire.fire && (isHuman || _humanPendingNow)`，
  //   即信号名是 `isHuman` / `_humanPending`；本模块此前只认 `isHumanTurn`，
  //   导致**生产接线上永远不授予水位 full**（夹具全绿也发现不了）。
  //   故按生产语义扩为：isHumanTurn | isHuman | state.humanTurn | state._humanPending | state._humanPendingNow
  // Positive production aliases form a union; an explicit false alias does not erase pending human input.
  const humanTurn = sig.isHumanTurn === true || sig.isHuman === true
    || state.humanTurn === true || state._humanPending === true || state._humanPendingNow === true;
  const unattended = sig.isUnattended === true || state.unattended === true;
  const gapSetting = (values, fallback, allowZero = false) => {
    for (const raw of values) {
      if (raw === undefined || raw === null || (typeof raw === 'string' && !raw.trim())) continue;
      const value = Number(raw);
      if (Number.isFinite(value) && value >= 0) {
        const parsed = Math.min(1000, Math.floor(value));
        return allowZero ? parsed : Math.max(1, parsed);
      }
    }
    return fallback;
  };
  const fullGap = gapSetting([cfg.snapshotMinGapRounds], 40, true);
  const slimEvery = gapSetting([sig.slimEvery, cfg.slimEveryRounds, cfg.slimEvery], 15);
  const hasAnyObservation = OBSERVATION_FIELDS.some((key) => state[key] !== undefined && state[key] !== null);
  const firstObservation = sig.firstObservation === true
    || (hasAnyObservation && compactSeqSeen === null && compactionSeq !== null);
  const newCompact = !firstObservation && compactionSeq !== null && compactSeqSeen !== null
    && compactionSeq > compactSeqSeen;
  // This is a delivery fact supplied by the adapter, not inferred from a missing compaction baseline.
  const firstFrame = sig.firstFrame === true || frame.firstFrame === true;
  const thresholds = parseWaterThresholds(cfg.fullInjectWaterPct);
  const water = humanTurn && waterPct !== null
    ? decideWaterFire(waterPct, thresholds, waterPctFired)
    : { fire: false, fireAt: 0, nextThreshold: null };
  const slimBaseStepSeq = lastSlimStepSeq === null ? lastFullStepSeq
    : (lastFullStepSeq === null ? lastSlimStepSeq : Math.max(lastSlimStepSeq, lastFullStepSeq));
  const observed = {
    newCompact, compactionBaselineOnly: firstObservation, stepSeq, lastFullStepSeq,
    lastSlimStepSeq, slimBaseStepSeq, compactionSeq, compactSeqSeen,
    waterFireAt: water.fire ? water.fireAt : 0,
  };
  const finish = (tier, fullGranted, slimAllowed) =>
    finalize(tier, fullGranted, slimAllowed, grants, reasons, o, observed, humanTurn);

  if (firstObservation) {
    grants.push(GRANT_REASONS.FIRST_OBSERVATION_BASELINE);
    reasons.push('首观测只建立压缩序号基线，不当作新压缩');
  }
  if (!hasAnyObservation) reasons.push('没有观测字段；不推断历史压缩或首次投递');
  if (sig.legacy === true) {
    grants.push(GRANT_REASONS.LEGACY_FALLBACK);
    reasons.push('legacy 身份保留；不借此扩大内容档位');
  }
  if (sig.postCompact === true && !newCompact) reasons.push('压缩序号没有有效增长，不授予 post_compact');
  if (newCompact) {
    grants.push(GRANT_REASONS.POST_COMPACT);
    reasons.push('压缩序号增长 ' + compactSeqSeen + ' -> ' + compactionSeq);
  }

  // Preserve production priority: carry, new compaction, hang compensation, then ordinary cadence.
  if (sig.handoffCarry === true || frame.carry === true) {
    grants.push(GRANT_REASONS.HANDOFF_CARRY);
    reasons.push('handoff_carry 强制完整帧，不受普通间隔限制');
    return finish('full', true, false);
  }
  if (newCompact) {
    if (cfg.snapshotReinjectOnCompact !== false && sig.snapshotReinjectOnCompact !== false) {
      reasons.push('新压缩启用重注入；不受普通间隔限制');
      return finish('full', true, false);
    }
    grants.push(GRANT_REASONS.POST_COMPACT_NO_REINJECT);
    reasons.push('新压缩重注入关闭，不授予 full；继续评估其他独立授予条件');
  }
  if (sig.hangCompensate === true || frame.hangCompensate === true) {
    grants.push(GRANT_REASONS.HANG_COMPENSATE);
    reasons.push('hang_compensate 强制完整帧，不受普通间隔限制');
    return finish('full', true, false);
  }
  if (firstFrame) {
    grants.push(GRANT_REASONS.FIRST_FRAME);
    reasons.push('调用方确认本会话首次投递，授予完整帧');
    return finish('full', true, false);
  }

  // Water grants require a human signal and keep their cause/threshold bookkeeping before the human fallback.
  if (!thresholds.length) reasons.push('水位阈值显式关闭');
  else if (!humanTurn) reasons.push('没有本请求真人信号；不因水位授予完整帧');
  else if (water.fire) {
    grants.push(water.fireAt === 25 ? GRANT_REASONS.WATER_25
      : water.fireAt === 50 ? GRANT_REASONS.WATER_50 : GRANT_REASONS.WATER_CUSTOM);
    reasons.push('本请求真人信号命中水位阈值 ' + water.fireAt);
    return finish('full', true, false);
  }

  // Lead r3 P1: human input is an independent full grant, including low/off/already-fired water.
  // Request replay and delivery admission remain adapter responsibilities; this function stays pure.
  if (humanTurn) {
    grants.push(GRANT_REASONS.HUMAN_TURN);
    reasons.push('真人独立旁路授予完整帧；水位未触发不吞真人条件');
    return finish('full', true, false);
  }

  const fullDistance = stepSeq !== null && lastFullStepSeq !== null ? stepSeq - lastFullStepSeq : null;
  if (fullGap === 0 || sig.fullGap === true
    || (fullDistance !== null && fullDistance >= fullGap && fullDistance > 0)) {
    grants.push(GRANT_REASONS.FULL_GAP);
    reasons.push('完整帧间隔满足；要求 ' + fullGap + '，实际 ' + fullDistance);
    return finish('full', true, false);
  }
  if (unattended) {
    grants.push(GRANT_REASONS.UNATTENDED);
    reasons.push('无人值守没有命中独立完整帧条件');
  }
  const slimDistance = stepSeq !== null && slimBaseStepSeq !== null ? stepSeq - slimBaseStepSeq : null;
  const slimAllowed = slimDistance === null || (slimDistance > 0 && slimDistance >= slimEvery);
  if (slimAllowed) {
    grants.push(GRANT_REASONS.SLIM_EVERY);
    reasons.push('精简帧放行；要求间隔 ' + slimEvery + '，实际 ' + slimDistance);
  } else {
    reasons.push('精简帧节流；要求间隔 ' + slimEvery + '，实际 ' + slimDistance);
  }
  return finish('slim', false, slimAllowed);
}

/**
 * 组装返回。
 *
 * ★requestKey 语义（task-38 复核修订）：**只回显调用方提供的真实请求身份**，
 *   **绝不**用 `cad:...` 之类自造串覆盖；缺失时显式 `requestKey: null` + `requestKeyMissing: true`，
 *   并由 reasons 说明『交由适配器补』——宁可为空，不可伪造。
 */
function finalize(tier, fullGranted, slimAllowed, grants, reasons, o, obs, isHuman) {
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
    isHuman,
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
      lastSlimStepSeq: _.lastSlimStepSeq === undefined ? null : _.lastSlimStepSeq,
      slimBaseStepSeq: _.slimBaseStepSeq === undefined ? null : _.slimBaseStepSeq,
      waterFireAt: _.waterFireAt === undefined ? 0 : _.waterFireAt,
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
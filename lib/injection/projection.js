/**
 * lib/injection/projection.js —— B3-PJ：投影与 ContentSpec（L1 §4.4）
 *
 * projectInjectionPre({sources,tier,frame,contentSpec})
 *   → {candidates,notifications,policyVersion,degradations}
 *
 * 契约（L1 §4.4 逐条）：
 *   · **纯函数**：不读写 state、不渲染、不提交通知；
 *   · 候选带 id/kind/bucket/priority/text/sourceIdentity/contentVersion；
 *   · **各段可各有名单**，不为统一名单改变语义；
 *   · ContentSpec 覆盖 14 段并映射既有 PROMPT_SECTION_KEYS_PRE_V1；
 *   · **扩展段须先登记**，不得静默新增公共面；
 *   · 通道区（calendar/externalMemory 等）超限整段省略时**必须显式 degradation**；
 *   · 画像**只用 accepted/used 与 authorResponse** 结构化来源；
 *   · 事件归属**只消费 2.3 proposal-only**，不自动 attach/merge/archive；
 *   · **不得把 human_slim/run_slim 送入 renderMemoryDynamic**；精简帧走真实精简路径。
 */

import { INJECTION_ERROR_CODES, fail, makeDegradation } from './errors.js';
import { makeProjectionCandidate, CONTENT_SPEC_SEGMENTS, CONTENT_SPEC_ENUMS, INJECTION_PROFILE_VERSION } from './dto.js';
import { renderRulesForTierPre, SUMMARY_POINTER, SLIM_MAINTAIN_BLOCK } from './render-rules.js';
import { projectHandoffPre } from './project-handoff.js';
import { isKnownTier } from './profile.js';

/** 画像允许的结构化来源（L1 §4.4 原文：「画像仅使用 accepted/used 及 authorResponse」）。 */
export const PORTRAIT_ALLOWED_STAGES = Object.freeze(['accepted', 'used']);
export const PORTRAIT_ALLOWED_KINDS = Object.freeze(['preference', 'state', 'unfinished-goal', 'authorResponse']);

/**
 * ContentSpec 段 → 既有 PROMPT_SECTION_KEYS_PRE_V1 键（映射表；**新增段必须先登记**）。
 * 未登记的段 ⇒ 抛错（不得静默新增公共面）。
 */
export const CONTENT_SPEC_TO_PROMPT_SECTION = Object.freeze({
  rules: 'rules-section',
  plan: 'whiteboard-plan',
  handoff: 'handoff-ledger',
  events: 'event-cards',
  portrait: 'user-portrait',
  semantic: 'semantic-recall',
  logs: 'recent-logs',
  calendar: 'calendar',
  externalMemory: 'external-memory',
  workspaceMap: 'workspace-map',
  recentLogs: 'recent-logs',
  reflection: 'reflection',
  // 当前生产没有独立诊断段；请求时显式降级，不能编造分区。
  diagnostic: null,
  // 维护块并入唯一规则候选，不创建第二个规则段生产者。
  maintenance: 'rules-section',
});

/** 精简档：**不得**送 renderMemoryDynamic（L1 §4.4 末条）。 */
export const SLIM_ONLY_TIERS = Object.freeze(['human_slim', 'run_slim', 'slim']);

/** 各段在候选里的默认优先级（越大多越先保留）。**各段语义不同，不强行统一名单**。 */
const SEGMENT_PRIORITY = Object.freeze({
  rules: 100, portrait: 80, events: 70, plan: 60, handoff: 55,
  semantic: 40, calendar: 35, externalMemory: 30, workspaceMap: 25,
  recentLogs: 20, reflection: 18, diagnostic: 10, maintenance: 90, logs: 15,
});

/** 受限模式只能消费明确声明的表示，不能回退原始全文。 */
function explicitModeText(source, mode) {
  const variants = source && source.representations;
  if (variants && Object.prototype.hasOwnProperty.call(variants, mode)) {
    return typeof variants[mode] === 'string' ? variants[mode] : null;
  }
  return source && source.mode === mode && typeof source.text === 'string' ? source.text : null;
}

/** 各段的内容语义交给既有 RP/BD 或来源所有者的明确表示。 */
function sourceTextFor(seg, sources, mode, tier, degradations) {
  const source = sources[seg] && typeof sources[seg] === 'object' ? sources[seg] : {};
  const degrade = (code, message) => {
    degradations.push(makeDegradation(code, message, { scope: seg }));
    return '';
  };
  if (CONTENT_SPEC_TO_PROMPT_SECTION[seg] === null) {
    return degrade('segment-unmapped', seg + ' has no existing production section');
  }
  const represented = explicitModeText(source, mode);
  if (represented !== null) return represented;
  if (seg === 'rules') {
    const aggregate = source.aggregate || source;
    if (Array.isArray(aggregate.rules) || Array.isArray(aggregate.notes)) {
      return renderRulesForTierPre({ rules: aggregate, tier: mode === 'full' ? 'human_full' : 'run_slim' }).text;
    }
    const text = typeof source.ruleText === 'string' ? source.ruleText : '';
    return mode === 'full' ? text : (text.trim() ? SUMMARY_POINTER : '');
  }
  const raw = typeof source.text === 'string' ? source.text : '';
  if (mode === 'full') return raw;
  if (seg === 'plan' && mode === 'core') {
    const policy = source.policy && typeof source.policy === 'object' ? source.policy : {};
    const core = Array.isArray(policy.planCoreSections)
      ? policy.planCoreSections.filter((word) => typeof word === 'string' && word.trim()) : [];
    if (!core.length) return degrade('mode-policy-missing', 'plan:core requires an explicit core-section policy');
    const result = projectHandoffPre({ planText: raw, latestHandoffText: '', tier,
      policy: Object.assign({}, policy, { profile: 'slim', planCoreSections: core }) });
    degradations.push(...result.degradations.filter((item) => item.scope === 'plan'));
    return result.planPart;
  }
  if (seg === 'handoff' && mode === 'sections') {
    const policy = source.policy && typeof source.policy === 'object' ? source.policy : {};
    const result = projectHandoffPre({ planText: '', latestHandoffText: raw, tier,
      policy: Object.assign({}, policy, { profile: 'slim', planCoreSections: [] }) });
    degradations.push(...result.degradations.filter((item) => item.scope === 'ledger'));
    return result.ledgerPart;
  }
  if (seg === 'events') {
    const hasCards = typeof source.cardsText === 'string';
    const cards = hasCards ? source.cardsText : raw;
    if (!hasCards && raw) {
      degradations.push(makeDegradation('legacy-event-representation',
        'legacy events.text accepted as pre-rendered cards; structured event rendering remains owned by EV', { scope: seg }));
    }
    if (mode === 'cards') return cards;
    const catalog = typeof source.catalogText === 'string' ? source.catalogText : '';
    return [cards, catalog].filter((text) => text.trim()).join('\n');
  }
  if (mode === 'tail') {
    const cap = Number(source.tailChars);
    if (!Number.isFinite(cap) || cap <= 0) {
      return degrade('mode-policy-missing', seg + ':tail requires an explicit tail representation or tailChars');
    }
    const limit = Math.floor(cap);
    if (limit < 1) return degrade('mode-policy-invalid', seg + ':tail requires at least one JS character');
    if (raw.length <= limit) return raw;
    let tail = raw.slice(-limit);
    const first = tail.charCodeAt(0);
    if (first >= 0xdc00 && first <= 0xdfff) tail = tail.slice(1);
    degradations.push(makeDegradation('mode-truncated', seg + ' kept only the explicitly budgeted tail', { scope: seg }));
    return tail;
  }
  return degrade('mode-representation-missing', seg + ':' + mode + ' requires a representation supplied by its source owner');
}

/**
 * 画像过滤：**只保留 accepted/used 与 authorResponse 结构化来源**。
 * 其它阶段（retrieved/delivered/mentioned 等）一律丢弃并记 degradation。
 */
export function filterPortraitItems(items) {
  const kept = [];
  const dropped = [];
  for (const it of Array.isArray(items) ? items : []) {
    const stageOk = it && PORTRAIT_ALLOWED_STAGES.includes(it.stage);
    const kindOk = it && PORTRAIT_ALLOWED_KINDS.includes(it.kind);
    // authorResponse 按 kind 放行（不必有 accepted/used 阶段）
    const authorOk = it && it.kind === 'authorResponse';
    if (authorOk || (stageOk && kindOk)) kept.push(it);
    else dropped.push(it);
  }
  return { kept, dropped };
}
/**
 * ★ 主入口：按 ContentSpec 的 14 段投影候选。**纯函数**。
 *
 * @param {object} input
 *   sources     —— {rules:{ruleText},plan:{text},...} 各来源文本（可缺）
 *     full 使用原始正文；受限模式不能把未声明视角的 text 当成已经选好的正文。
 *     plan:core 由 sources.plan.policy.planCoreSections 调用既有 BD 选节，
 *       或消费 sources.plan.representations.core / {mode:'core',text} 明确表示。
 *     calendar:current 等来源专属模式要求 representations[mode] 或 {mode,text}；
 *       缺失时显式降级，不回落原始全文。tail 另接受调用方明确的 tailChars。
 *   tier        —— 档位（human_slim/run_slim 会被标记不得走完整渲染）
 *   frame       —— {step?}
 *   contentSpec —— 已冻结的 ContentSpec（由 makeContentSpec 构造）
 *   portraitItems —— 原始画像条目（会被过滤）
 *   attributionProposals —— **2.3 的 proposal-only 建议**（只透传，不自动应用）
 *   channelLimit —— 通道区字符上限（超限整段省略并记 degradation）
 */
export function projectInjectionPre(input) {
  const o = input === null || typeof input !== 'object' ? {} : input;
  const sources = o.sources && typeof o.sources === 'object' ? o.sources : {};
  const spec = o.contentSpec;
  if (!spec || spec.dtoKind !== 'ContentSpec') {
    fail(INJECTION_ERROR_CODES.INVALID_ARGUMENT, 'projectInjectionPre requires a ContentSpec');
  }
  for (const seg of CONTENT_SPEC_SEGMENTS) {
    if (!CONTENT_SPEC_ENUMS[seg].includes(spec[seg])) {
      fail(INJECTION_ERROR_CODES.INVALID_ENUM, 'invalid ContentSpec mode: ' + seg, { field: seg });
    }
  }
  const tier = typeof o.tier === 'string' ? o.tier : 'slim';
  if (!isKnownTier(tier)) fail(INJECTION_ERROR_CODES.INVALID_ENUM, 'unknown projection tier: ' + tier, { field: 'tier' });
  const degradations = [];
  const candidates = [];
  const channelLimit = Number.isFinite(Number(o.channelLimit)) ? Number(o.channelLimit) : 2000;
  const channelSegments = ['calendar', 'externalMemory', 'workspaceMap', 'recentLogs', 'reflection', 'diagnostic'];
  let maintainText = '';
  if (spec.maintenance === 'slim-maintain') {
    if (tier === 'human_slim') {
      maintainText = explicitModeText(sources.maintenance, 'slim-maintain');
      if (maintainText === null) maintainText = SLIM_MAINTAIN_BLOCK;
    } else {
      degradations.push(makeDegradation('maintenance-tier-omitted', 'maintenance is only eligible in human_slim', { scope: 'maintenance' }));
    }
  }
  let maintenanceInRules = false;
  for (const seg of CONTENT_SPEC_SEGMENTS) {
    const mode = spec[seg];
    if (mode === 'none' || seg === 'portrait' || seg === 'maintenance') continue;
    if (!Object.prototype.hasOwnProperty.call(CONTENT_SPEC_TO_PROMPT_SECTION, seg)) {
      fail(INJECTION_ERROR_CODES.INVALID_ARGUMENT, 'unregistered content segment: ' + seg, { field: seg });
    }
    let text = sourceTextFor(seg, sources, mode, tier, degradations);
    if (seg === 'rules' && maintainText) {
      if (!text.includes(maintainText)) text = text ? text + '\n' + maintainText : maintainText;
      maintenanceInRules = true;
    }
    if (typeof text !== 'string' || !text.trim()) {
      degradations.push(makeDegradation('segment-empty', seg + ':' + mode + ' has no eligible content', { scope: seg }));
      continue;
    }
    if (channelSegments.includes(seg) && text.length > channelLimit) {
      degradations.push(makeDegradation('channel-overflow', seg + ' omitted: ' + text.length + ' chars > ' + channelLimit, { scope: seg }));
      continue;
    }
    candidates.push(makeProjectionCandidate({
      id: 'cand:' + seg + ':' + (o.frame && o.frame.step !== undefined ? o.frame.step : 0),
      kind: seg, bucket: seg, priority: SEGMENT_PRIORITY[seg] === undefined ? 1 : SEGMENT_PRIORITY[seg],
      text,
      sourceIdentity: (sources[seg] && sources[seg].sourceIdentity) || ('segment:' + seg),
      contentVersion: (sources[seg] && sources[seg].contentVersion) || ('v:' + mode),
    }));
  }
  if (maintainText && !maintenanceInRules) {
    candidates.push(makeProjectionCandidate({ id: 'cand:maintenance', kind: 'maintenance', bucket: 'rules',
      priority: SEGMENT_PRIORITY.maintenance, text: maintainText,
      sourceIdentity: (sources.maintenance && sources.maintenance.sourceIdentity) || 'maintenance:structured',
      contentVersion: 'v:slim-maintain' }));
  }
  if (spec.portrait !== 'none') {
    if (sources.portrait && typeof sources.portrait.text === 'string' && sources.portrait.text.trim()) {
      degradations.push(makeDegradation('portrait-unstructured-ignored', 'unstructured portrait text is not an eligible source', { scope: 'portrait' }));
    }
    const { kept, dropped } = filterPortraitItems(o.portraitItems);
    if (dropped.length) degradations.push(makeDegradation('portrait-filtered', dropped.length + ' portrait item(s) filtered', { scope: 'portrait' }));
    const rows = kept.map((item) => {
      const text = typeof item.text === 'string' ? item.text : '';
      return spec.portrait === 'short' ? (text.split(/\r?\n/).map((line) => line.trim()).find(Boolean) || '') : text.trim();
    }).filter(Boolean);
    if (rows.length) {
      candidates.push(makeProjectionCandidate({ id: 'cand:portrait-structured', kind: 'portrait', bucket: 'portrait',
        priority: SEGMENT_PRIORITY.portrait, text: rows.map((text) => '- ' + text).join('\n'),
        sourceIdentity: (sources.portrait && sources.portrait.sourceIdentity) || 'portrait:structured',
        contentVersion: 'v:' + spec.portrait }));
    }
  }
  const proposals = Array.isArray(o.attributionProposals) ? o.attributionProposals : [];
  const attribution = Object.freeze({ proposals: Object.freeze(proposals.slice()), applied: false,
    autoAttach: false, autoMerge: false, autoArchive: false });
  return Object.freeze({ dtoKind: 'Projection', schemaVersion: 1, candidates: Object.freeze(candidates),
    notifications: Object.freeze([]), policyVersion: INJECTION_PROFILE_VERSION, tier,
    renderPath: SLIM_ONLY_TIERS.includes(tier) ? 'slim' : 'dynamic', attribution,
    degradations: Object.freeze(degradations) });
}

/** 注册为 ports.js 的 projection port。 */
export function createProjectionPort(getInput) {
  if (typeof getInput !== 'function') {
    fail(INJECTION_ERROR_CODES.INVALID_ARGUMENT, 'createProjectionPort requires a function that returns input');
  }
  return (() => projectInjectionPre(getInput()));
}
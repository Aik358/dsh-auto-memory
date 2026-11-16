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
import { makeProjectionCandidate, makeContentSpec, CONTENT_SPEC_SEGMENTS, CONTENT_SPEC_ENUMS } from './dto.js';

/** 画像允许的结构化来源（L1 §4.4 原文：「画像仅使用 accepted/used 及 authorResponse」）。 */
export const PORTRAIT_ALLOWED_STAGES = Object.freeze(['accepted', 'used']);
export const PORTRAIT_ALLOWED_KINDS = Object.freeze(['preference', 'state', 'unfinished-goal', 'authorResponse']);

/**
 * ContentSpec 段 → 既有 PROMPT_SECTION_KEYS_PRE_V1 键（映射表；**新增段必须先登记**）。
 * 未登记的段 ⇒ 抛错（不得静默新增公共面）。
 */
export const CONTENT_SPEC_TO_PROMPT_SECTION = Object.freeze({
  rules: 'rules',
  plan: 'plan',
  handoff: 'handoff',
  events: 'events',
  portrait: 'portrait',
  semantic: 'semantic',
  logs: 'logs',
  calendar: 'calendar',
  externalMemory: 'externalMemory',
  workspaceMap: 'workspaceMap',
  recentLogs: 'recentLogs',
  reflection: 'reflection',
  diagnostic: 'diagnostic',
  maintenance: 'maintenance',
});

/** 精简档：**不得**送 renderMemoryDynamic（L1 §4.4 末条）。 */
export const SLIM_ONLY_TIERS = Object.freeze(['human_slim', 'run_slim', 'slim']);

/** 各段在候选里的默认优先级（越大多越先保留）。**各段语义不同，不强行统一名单**。 */
const SEGMENT_PRIORITY = Object.freeze({
  rules: 100, portrait: 80, events: 70, plan: 60, handoff: 55,
  semantic: 40, calendar: 35, externalMemory: 30, workspaceMap: 25,
  recentLogs: 20, reflection: 18, diagnostic: 10, maintenance: 90, logs: 15,
});

/**
 * 取某段在给定 sources 里的原始内容。
 * **不解析语义**（那是各 Reader 的职责），只做「取到 / 取不到」与投影。
 */
function sourceTextFor(seg, sources) {
  const map = {
    rules: () => sources.rules && sources.rules.ruleText,
    portrait: () => sources.portrait && sources.portrait.text,
    events: () => sources.events && sources.events.text,
    plan: () => sources.plan && sources.plan.text,
    handoff: () => sources.handoff && sources.handoff.text,
    semantic: () => sources.semantic && sources.semantic.text,
    calendar: () => sources.calendar && sources.calendar.text,
    externalMemory: () => sources.externalMemory && sources.externalMemory.text,
    workspaceMap: () => sources.workspaceMap && sources.workspaceMap.text,
    recentLogs: () => sources.recentLogs && sources.recentLogs.text,
    reflection: () => sources.reflection && sources.reflection.text,
    diagnostic: () => sources.diagnostic && sources.diagnostic.text,
    maintenance: () => sources.maintenance && sources.maintenance.text,
    logs: () => sources.logs && sources.logs.text,
  };
  const fn = map[seg];
  return fn ? fn() : undefined;
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
    fail(INJECTION_ERROR_CODES.INVALID_ARGUMENT, 'projectInjectionPre requires a frozen ContentSpec (use makeContentSpec)');
  }
  const tier = typeof o.tier === 'string' ? o.tier : 'slim';
  const degradations = [];
  const candidates = [];
  const notifications = [];
  const channelLimit = Number.isFinite(Number(o.channelLimit)) ? Number(o.channelLimit) : 2000;

  // ── 通道区（可整段省略，但**必须显式 degradation**）
  const CHANNEL_SEGMENTS = ['calendar', 'externalMemory', 'workspaceMap', 'recentLogs', 'reflection', 'diagnostic'];

  for (const seg of CONTENT_SPEC_SEGMENTS) {
    const mode = spec[seg];
    if (mode === 'none') continue;                      // 显式 none：按契约**不产生 degradation**
    if (!(seg in CONTENT_SPEC_TO_PROMPT_SECTION)) {
      fail(INJECTION_ERROR_CODES.INVALID_ARGUMENT,
        'unregistered content-spec segment (must register in CONTENT_SPEC_TO_PROMPT_SECTION first): ' + seg,
        { field: seg });
    }
    let text = sourceTextFor(seg, sources);
    if (typeof text !== 'string' || text.trim() === '') {
      // 该段未被内容命中：**不静默**，记 degradation（但省略本身合法）
      degradations.push(makeDegradation('segment-empty',
        'segment ' + seg + ' requested as ' + mode + ' but source has no content', { scope: seg }));
      continue;
    }
    // 通道区超限 ⇒ **整段省略**并显式 degradation（L1 §4.4 明文）
    if (CHANNEL_SEGMENTS.includes(seg) && text.length > channelLimit) {
      degradations.push(makeDegradation('channel-overflow',
        'channel segment ' + seg + ' omitted: ' + text.length + ' chars > limit ' + channelLimit,
        { scope: seg, recoverable: true }));
      continue;
    }
    candidates.push(makeProjectionCandidate({
      id: 'cand:' + seg + ':' + (o.frame && o.frame.step !== undefined ? o.frame.step : 0),
      kind: seg,
      bucket: seg,
      priority: SEGMENT_PRIORITY[seg] === undefined ? 1 : SEGMENT_PRIORITY[seg],
      text,
      sourceIdentity: (sources[seg] && sources[seg].sourceIdentity) || ('segment:' + seg),
      contentVersion: (sources[seg] && sources[seg].contentVersion) || ('v:' + mode),
    }));
  }

  // ── 画像：只保留 accepted/used 与 authorResponse
  if (spec.portrait !== 'none' && Array.isArray(o.portraitItems)) {
    const { kept, dropped } = filterPortraitItems(o.portraitItems);
    if (dropped.length) {
      degradations.push(makeDegradation('portrait-filtered',
        dropped.length + ' portrait item(s) dropped: only accepted/used + authorResponse allowed',
        { scope: 'portrait' }));
    }
    if (kept.length) {
      const text = kept.map((x) => '- ' + String(x.text || '')).join('\n');
      candidates.push(makeProjectionCandidate({
        id: 'cand:portrait-structured',
        kind: 'portrait',
        bucket: 'portrait',
        priority: SEGMENT_PRIORITY.portrait,
        text,
        sourceIdentity: 'portrait:structured',
        contentVersion: 'v:' + spec.portrait,
      }));
    }
  }

  // ── 2.3 事件归属：**只作建议透传，不自动 attach/merge/archive**
  const proposals = Array.isArray(o.attributionProposals) ? o.attributionProposals : [];
  const attribution = Object.freeze({
    proposals: Object.freeze(proposals.slice()),
    applied: false,            // ★恒为 false：本层不应用任何归属
    autoAttach: false,
    autoMerge: false,
    autoArchive: false,
  });

  // ── 档位约束：精简档不得走完整渲染
  const slimOnly = SLIM_ONLY_TIERS.includes(tier);
  const renderPath = slimOnly ? 'slim' : 'dynamic';

  return Object.freeze({
    dtoKind: 'Projection',
    schemaVersion: 1,
    candidates: Object.freeze(candidates),
    notifications: Object.freeze(notifications),
    policyVersion: 1,
    tier,
    renderPath,                       // ★slim 档为 'slim'，**不得**送 renderMemoryDynamic
    attribution,
    degradations: Object.freeze(degradations),
  });
}

/** 注册为 ports.js 的 projection port。 */
export function createProjectionPort(getInput) {
  if (typeof getInput !== 'function') {
    fail(INJECTION_ERROR_CODES.INVALID_ARGUMENT, 'createProjectionPort requires a function that returns input');
  }
  return (() => projectInjectionPre(getInput()));
}
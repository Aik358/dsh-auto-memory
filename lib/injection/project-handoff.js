/**
 * lib/injection/project-handoff.js —— B3-BD：白板/账本投影（L1 §4.6）
 *
 * projectHandoffPre({planText,latestHandoffText,tier,policy})
 *   → {planPart,ledgerPart,sourceIdentity,degradations}
 *
 * 契约（L1 §4.6 / L2 §7.2 逐条）：
 *   · **先按既定章节/四段选择，再交 FM**；**不得在选择前默认 2000 截断**；
 *   · **保留尾部失败原因与下一步**及截断标记；
 *   · full/slim 视角、**无命中回退按 profile**，**无命中不得擅自回退全文**；
 *   · 与 2.5 生成/更新边界分离，**不改 PLAN 或账本原文**（本模块只读）。
 */

import { INJECTION_ERROR_CODES, fail, makeDegradation } from './errors.js';

/** 账本四段的 tag（与白板/账本成文协议一致）。 */
export const HANDOFF_TAGS = Object.freeze(['type:goal', 'type:state', 'type:dead-end', 'type:progress']);

/** 四段的规范顺序与中文标题（与「四段式：任务状态/目标/已试方案与失败原因/进度与下一步」一致）。 */
export const HANDOFF_SECTION_ORDER = Object.freeze(['type:goal', 'type:state', 'type:dead-end', 'type:progress']);

/**
 * slim 视角下**必须保留**的两端（L1 §4.6「保留尾部失败原因与下一步」）。
 * 注意：dead-end 与 progress 是 slim 的**优先保留项**，不是可裁剪项。
 */
export const SLIM_MUST_KEEP = Object.freeze(['type:dead-end', 'type:progress']);

/** 支持的档位；非这些档位一律显式报错（不静默降级）。 */
export const HANDOFF_VIEW_TIERS = Object.freeze(['full', 'human_full', 'human_slim', 'run_slim', 'slim']);

/** 截断标记（明文可搜，便于审计）。 */
export const TRUNCATION_MARKER = '…（已截断：保留尾部失败原因与下一步）';

/**
 * 解析文本为「节」。节起点 = 含 `type:*` 标签的行 **或** `## ` 标题行。
 * ★**不做任何长度限制**——长度策略在选择之后才生效（见 §不得预先 2000 截断）。
 */
function parseSections(text) {
  const raw = String(text == null ? '' : text);
  if (!raw.trim()) return [];
  const lines = raw.split('\n');
  const out = [];
  let cur = null;
  for (const line of lines) {
    const tagMatch = HANDOFF_TAGS.find((t) => line.includes(t));
    const isHeading = /^#{2,3}\s+/.test(line);
    if (tagMatch || isHeading) {
      if (cur) out.push(cur);
      cur = { tag: tagMatch || null, title: line.replace(/^#{2,3}\s+/, '').trim(), body: [] };
      if (tagMatch && isHeading) cur.title = line.replace(/^#{2,3}\s+/, '').trim();
      // 标签行本身若含正文（如 `type:state` 后无标题），保留其后的文字
      continue;
    }
    if (cur) cur.body.push(line);
    else {
      // 首个节之前的内容归入「前言」节（不丢弃，但不参与 slim 优先）
      cur = { tag: null, title: '', body: [line] };
    }
  }
  if (cur) out.push(cur);
  // ★★纯注释/纯空白的节**不是有效内容**：必须剔除，否则「无命中」会被误判为有命中、
  //   进而把整段原文（含注释锚点）当成内容回退出去 —— 这正是 B2 变异暴露的缺陷。
  const isMeaningful = (body) => {
    const stripped = String(body)
      .replace(/<!--[\s\S]*?-->/g, '')     // 去掉 HTML 注释（含 memory 锚点）
      .replace(/\s+/g, '')                  // 去掉所有空白
      .trim();
    return stripped.length > 0;
  };
  return out
    .map((s) => ({ tag: s.tag, title: s.title, body: s.body.join('\n').trim() }))
    .filter((s) => s.tag !== null || isMeaningful(s.body));
}

/**
 * ★尾部截断：超限时**保留尾部**（失败原因与下一步通常在段尾），前面加截断标记。
 * 只在**选择之后**对已选中的节调用 —— 绝不用于预筛。
 */
export function tailTruncate(body, capChars) {
  const s = String(body == null ? '' : body);
  const cap = Number(capChars);
  if (!Number.isFinite(cap) || cap <= 0) return { text: s, truncated: false };
  if (s.length <= cap) return { text: s, truncated: false };
  const room = Math.max(0, cap - TRUNCATION_MARKER.length - 1);
  if (room <= 0) return { text: TRUNCATION_MARKER, truncated: true };
  let tail = s.slice(s.length - room);
  // 尽量从行首开始，避免半行
  const nl = tail.indexOf('\n');
  if (nl >= 0 && nl < tail.length - 1) tail = tail.slice(nl + 1);
  return { text: TRUNCATION_MARKER + '\n' + tail, truncated: true };
}

/**
 * 按档位与策略从节列表中选择。**选择在前、截断在后**。
 * slim：只保留 goal / dead-end / progress 三类 + 首个非标签前言节；**dead-end 与 progress 必保**。
 * full：全部保留。
 */
function selectSections(sections, isFull) {
  if (isFull) return { kept: sections.slice(), omitted: [] };
  const kept = [];
  const omitted = [];
  for (const s of sections) {
    if (s.tag === 'type:goal' || SLIM_MUST_KEEP.includes(s.tag)) kept.push(s);
    else if (!s.tag && s.body) kept.push(s);          // 前言/无标签正文保留（不丢信息）
    else omitted.push(s);
  }
  return { kept, omitted };
}

/** 渲染选中的节为文本（标题 + 正文）。 */
function renderSections(sections) {
  const out = [];
  for (const s of sections) {
    const t = s.title ? s.title.trim() : '';
    if (t && !s.body) { out.push(t); continue; }
    if (t) out.push(t);
    if (s.body) out.push(s.body);
  }
  return out.join('\n').trim();
}
/**
 * ★ 主入口：白板/账本投影。**纯函数**（只读文本，不改原文）。
 *
 * @param {object} input
 *   planText          —— 白板全貌原文
 *   latestHandoffText —— 最新交接账本原文
 *   tier              —— 档位
 *   policy            —— {sectionCapChars?, profile?:'full'|'slim', onNoHit?:'omit'|'degrade'}
 * @returns {{planPart,ledgerPart,sourceIdentity,degradations,unresolved}}
 */
export function projectHandoffPre(input) {
  const o = input === null || typeof input !== 'object' ? {} : input;
  const tier = typeof o.tier === 'string' ? o.tier : 'slim';
  if (!HANDOFF_VIEW_TIERS.includes(tier)) {
    fail(INJECTION_ERROR_CODES.INVALID_ENUM,
      'unknown tier for handoff projection: ' + tier + ' (allowed: ' + HANDOFF_VIEW_TIERS.join('|') + ')',
      { field: 'tier', detail: tier });
  }
  const policy = o.policy && typeof o.policy === 'object' ? o.policy : {};
  const degradations = [];
  const unresolved = [];

  // ── 视角：full / slim（显式 policy.profile 优先，否则由 tier 推）
  const isFull = policy.profile === 'full' ? true
    : policy.profile === 'slim' ? false
    : (tier === 'full' || tier === 'human_full');

  // ── ★ 关于「选择前的 2000 预截断」：本模块**不做任何预截断**。
  //   段级上限 sectionCapChars 只在**选择之后**作用于已选中的节（见下）。
  //   若调用方未给 sectionCapChars，则**不截断**（保留全文）——
  //   因为「未定的段级/整帧硬上限」按 L1 §4.7 须进 unresolved，不擅自定值。
  const capRaw = policy.sectionCapChars;
  const hasCap = Number.isFinite(Number(capRaw)) && Number(capRaw) > 0;
  if (!hasCap) {
    unresolved.push({ key: 'sectionCapChars', reason: '未提供段级字符上限 ⇒ 不截断（不擅自定值）' });
  }

  const projOne = (text, label) => {
    const sections = parseSections(text);
    if (!sections.length) {
      // ★无命中：**不得擅自回退全文**。按政策 omit 或显式 degrade。
      const mode = policy.onNoHit === 'degrade' ? 'degrade' : 'omit';
      if (mode === 'degrade') {
        degradations.push(makeDegradation('segment-empty',
          label + ' 无可用章节（未回退全文）', { scope: label, recoverable: true }));
      }
      return { part: '', sections: 0, omitted: 0, truncated: false, noHit: true };
    }
    const { kept, omitted } = selectSections(sections, isFull);
    // ★选择之后才截断
    let truncated = false;
    const shaped = kept.map((s) => {
      if (!hasCap || !s.body) return s;
      const r = tailTruncate(s.body, Number(capRaw));
      if (r.truncated) truncated = true;
      return { tag: s.tag, title: s.title, body: r.text };
    });
    if (omitted.length) {
      degradations.push(makeDegradation('segment-omitted',
        label + ' 按 ' + (isFull ? 'full' : 'slim') + ' 视角省略 ' + omitted.length + ' 个章节'
        + (omitted.map((x) => x.tag || x.title).filter(Boolean).length
          ? '：' + omitted.map((x) => x.tag || x.title).filter(Boolean).join(',') : ''),
        { scope: label, recoverable: true }));
    }
    return { part: renderSections(shaped), sections: kept.length, omitted: omitted.length, truncated, noHit: false };
  };

  const plan = projOne(o.planText, 'plan');
  const ledger = projOne(o.latestHandoffText, 'ledger');

  const sourceIdentity = 'handoff:plan(' + plan.sections + ')|ledger(' + ledger.sections + ')';

  return Object.freeze({
    dtoKind: 'HandoffProjection',
    schemaVersion: 1,
    planPart: plan.part,
    ledgerPart: ledger.part,
    sourceIdentity,
    degradations: Object.freeze(degradations),
    unresolved: Object.freeze(unresolved),
    view: Object.freeze({
      profile: isFull ? 'full' : 'slim',
      tier,
      sectionCapChars: hasCap ? Number(capRaw) : null,
      preTruncated2000: false,          // ★显式声明：**没有**做选择前 2000 预截断
    }),
    counts: Object.freeze({
      planSections: plan.sections,
      planOmitted: plan.omitted,
      ledgerSections: ledger.sections,
      ledgerOmitted: ledger.omitted,
      truncated: plan.truncated || ledger.truncated,
    }),
  });
}

/** 注册为 ports.js 的 sources port 之外的专用 port（供 DI facade 使用）。 */
export function createHandoffPort(getInput) {
  if (typeof getInput !== 'function') {
    fail(INJECTION_ERROR_CODES.INVALID_ARGUMENT, 'createHandoffPort requires a function that returns input');
  }
  return (() => projectHandoffPre(getInput()));
}
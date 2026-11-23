/**
 * lib/injection/event-view.js —— B3-EV：事件视图与来源指针（L1 §4.9）
 *
 * projectEventSectionsPre({sections}) → [{key,title,text}]
 * renderCheckpointPreviewPre({checkpoint,budget,sourceRef}) → {text,head,tail,truncated,sourceIdentity}
 * selectEventProjectionPre({events,activeLimit,catalogChars,finalBudget,currentEventIds}) → {cards,catalog,counts}
 * renderEventSourcePointersPre({members,checkpoints,resolvePath}) → {pointers,warnings}
 *
 * 契约（L1 §4.9 / L2 §8 逐条）：
 *   · **事件头用 goal/doing/deadend/next；检查点用 goal/state/dead/next，不混映射**；
 *   · 预览保留**首尾**或按四段分配；**空字段不输出**；**不改检查点原文**；
 *   · `activeLimit` **来自 eventMaxActiveInInject**，不擅自增加；**目录排除已展开事件**；
 *   · members/rel/quoteRef/sourceRef **只生成指针**，不默认注入整篇文档；未解析路径**显式标注**；
 *   · `quoteRef` 是**引文不是路径**；`sourceRef` 可能是账本/日志，**不冒充施工文档**；
 *   · `currentEventIds` 来自真实会话上下文；**没有时只称「最近更新」，不冒充当前任务**。
 */

import { INJECTION_ERROR_CODES, fail, makeDegradation } from './errors.js';
import {
  cutPre, eventIdTagPre, firstSentencePre, RENDER_LIMITS, renderT0Pre, renderT2Pre, T2_BUDGET, filterCatalogVisiblePre,
} from '../event-render.js';
import { makeProjectionCandidate } from './dto.js';
import { createHash } from 'node:crypto';

/** ★事件头四段（L1 §4.9：goal/doing/deadend/next —— 注意不是 dead）。 */
export const EVENT_HEAD_KEYS = Object.freeze(['goal', 'doing', 'deadend', 'next']);

/** ★检查点四段（L1 §4.9：goal/state/dead/next —— 注意是 dead 不是 deadend）。 */
export const CHECKPOINT_KEYS = Object.freeze(['goal', 'state', 'dead', 'next']);

/** 四段的中文标题（用于渲染，不改字段名）。 */
export const EVENT_HEAD_TITLES = Object.freeze({
  goal: '目标', doing: '进行中', deadend: '失败与弯路', next: '下一步',
});
export const CHECKPOINT_TITLES = Object.freeze({
  goal: '目标', state: '做到了哪', dead: '卡在哪', next: '下一步',
});

/** 事件状态（目录分组用）。 */
export const EVENT_STATUSES = Object.freeze(['active', 'paused', 'closed', 'archived']);

/** 来源类别：**只用于标注，不冒充**（L1 §4.9 末条）。 */
export const SOURCE_KINDS = Object.freeze([
  'quote', 'ledger', 'log', 'reflection', 'plan', 'doc', 'unknown',
]);

// [DECISION D30B-13 | 2026-11-22 | user ruling] Preserve the legacy T1 output byte for byte.
export function renderEventOneLineSummaryPre(ev) {
  if (!ev) return '';
  const text = String(ev.summary || '').replace(/\s*\n+\s*/g, ' ').trim();
  const one = firstSentencePre(text, RENDER_LIMITS.T1);
  return one || cutPre(String(ev.name || '').trim(), RENDER_LIMITS.T1);
}

/**
 * ★事件头四段投影。
 * **空字段不输出**；只取 goal/doing/deadend/next，**不读** dead/state（不混映射）。
 */
export function projectEventSectionsPre(input) {
  const o = input === null || typeof input !== 'object' ? {} : input;
  const src = o.sections && typeof o.sections === 'object' ? o.sections : o;
  const out = [];
  for (const key of EVENT_HEAD_KEYS) {
    const v = src[key];
    if (typeof v !== 'string') continue;
    const text = v.trim();
    if (!text) continue;                       // ★空字段不输出
    out.push(Object.freeze({ key, title: EVENT_HEAD_TITLES[key], text }));
  }
  return Object.freeze(out);
}

/**
 * ★检查点四段投影。**空字段不输出**；只取 goal/state/dead/next。
 * 与事件头**不混映射**（事件头没有 state/dead，检查点没有 doing/deadend）。
 */
export function projectCheckpointSectionsPre(input) {
  const o = input === null || typeof input !== 'object' ? {} : input;
  const src = o.sections && typeof o.sections === 'object' ? o.sections : o;
  const out = [];
  for (const key of CHECKPOINT_KEYS) {
    const v = src[key];
    if (typeof v !== 'string') continue;
    const text = v.trim();
    if (!text) continue;
    out.push(Object.freeze({ key, title: CHECKPOINT_TITLES[key], text }));
  }
  return Object.freeze(out);
}
/**
 * ★检查点预览（1400 字级长文）：保留**首尾**，或按四段分配。
 * **不改检查点原文**：本函数只读，返回的 head/tail 都是原文切片。
 *
 * @param {object} input {checkpoint, budget, sourceRef}
 *   budget —— {capChars?, mode?:'head-tail'|'sections'}
 */
function fitCheckpointPreviewTextPre(source, cap) {
  if (cap === null || source.length <= cap) {
    return { text: source, head: source, tail: '', truncated: false, omittedChars: 0 };
  }
  if (cap === 0) {
    return { text: '', head: '', tail: '', truncated: true, omittedChars: source.length };
  }
  const candidateAt = (retained) => {
    let head = source.slice(0, Math.floor(retained / 2));
    let tail = source.slice(source.length - (retained - Math.floor(retained / 2)));
    if (head && /[\uD800-\uDBFF]$/.test(head)) head = head.slice(0, -1);
    if (tail && /^[\uDC00-\uDFFF]/.test(tail)) tail = tail.slice(1);
    const omittedChars = source.length - head.length - tail.length;
    const marker = '…（已省略 ' + omittedChars + ' 字）…';
    return { text: head + marker + tail, head, tail, truncated: true, omittedChars };
  };
  let best = candidateAt(0);
  if (best.text.length > cap) {
    return { text: '…', head: '', tail: '', truncated: true, omittedChars: source.length };
  }
  let low = 0;
  let high = Math.min(cap, source.length - 1);
  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    const candidate = candidateAt(mid);
    if (candidate.text.length <= cap) {
      best = candidate;
      low = mid + 1;
    } else high = mid - 1;
  }
  return best;
}

/** The selector and candidate factory share this exact catalog serialization. */
function renderEventCatalogTextPre(items, withIdTag) {
  if (withIdTag) return items.map((item) => '· ' + renderT0Pre(item) + eventIdTagPre(item)).join('\n');
  return items.map((item) => '- ' + String(item.name || '').replace(/\s*\n+\s*/g, ' ').trim()
    + '（' + item.id + '）· ' + item.label).join('\n');
}

export function renderCheckpointPreviewPre(input) {
  const o = input === null || typeof input !== 'object' ? {} : input;
  const cp = o.checkpoint && typeof o.checkpoint === 'object' ? o.checkpoint : {};
  const budget = o.budget && typeof o.budget === 'object' ? o.budget : {};
  const mode = budget.mode === 'sections' ? 'sections' : 'head-tail';
  const rawCap = budget.capChars;
  const cap = rawCap !== undefined && rawCap !== null && rawCap !== ''
    && Number.isFinite(Number(rawCap)) && Number(rawCap) >= 0
    ? Math.floor(Number(rawCap)) : null;
  const sections = projectCheckpointSectionsPre(cp);
  const inline = budget.singleLine === true;
  const normalize = (text) => inline ? text.replace(/\s*\n+\s*/g, ' / ').trim() : text;
  const sectionText = sections.map((section) => section.title + '：' + normalize(section.text))
    .join(inline ? ' ‖ ' : '\n');
  const rawText = typeof cp.text === 'string' ? normalize(cp.text) : '';
  // A sections projection is the rendered body even when text is short or absent.
  const source = mode === 'sections' && sectionText ? sectionText : (rawText || sectionText);
  const bounded = fitCheckpointPreviewTextPre(source, cap);
  const id = typeof cp.id === 'string' && cp.id ? cp.id : null;
  const sourceRef = o.sourceRef ?? (typeof cp.sourceRef === 'string' ? cp.sourceRef : null);
  const unresolved = cap === null
    ? [{ key: 'budget.capChars', reason: '未给检查点预览上限 ⇒ 不裁剪（不擅自定值）' }] : [];
  return Object.freeze({
    dtoKind: 'CheckpointPreview', schemaVersion: 1,
    text: bounded.text,
    head: bounded.head, tail: bounded.tail, truncated: bounded.truncated,
    sourceIdentity: id ? 'cp:' + id : 'cp:unknown',
    sourceRef: sourceRef === undefined ? null : sourceRef,
    mode,
    sections: Object.freeze(mode === 'sections' ? sections : []),
    omittedChars: bounded.omittedChars,
    unresolved: Object.freeze(unresolved),
  });
}
/**
 * ★事件选择与目录（activeLimit 来自 eventMaxActiveInInject，不擅自增加）。
 *
 * @param {object} input
 *   events          —— [{id,name,status,summary,updatedAt,sections}]
 *   activeLimit     —— **必须由调用方从 eventMaxActiveInInject 取**；缺省不猜
 *   catalogChars    —— 目录字符预算（未给则不裁）
 *   finalBudget     —— 最终帧预算（未给则不裁，不擅自定值）
 *   currentEventIds —— **真实会话上下文**；缺省 ⇒ 只称「最近更新」
 */
export function selectEventProjectionPre(input) {
  const o = input === null || typeof input !== 'object' ? {} : input;
  const list = Array.isArray(o.events) ? o.events.filter((e) => e && typeof e === 'object') : [];
  const unresolved = [];
  const degradations = [];
  const warnings = [];

  // ── activeLimit：**必须显式给出**（来自 eventMaxActiveInInject）
  const limRaw = Number(o.activeLimit);
  const hasLimit = Number.isFinite(limRaw) && limRaw >= 0;
  if (!hasLimit) {
    unresolved.push({ key: 'activeLimit', reason: '未提供 eventMaxActiveInInject 取值 ⇒ 不擅自决定 active 展开数' });
  }
  const activeLimit = hasLimit ? Math.floor(limRaw) : 0;

  // ── 去重（重复 id 只保留首见，并如实记 warning）
  const seen = Object.create(null);
  const uniq = [];
  for (const e of list) {
    const id = typeof e.id === 'string' ? e.id : null;
    if (!id) {
      // ★非法/缺 id **不伪造**
      warnings.push({ code: 'missing-id', message: '事件缺 id，已跳过（不伪造）' });
      continue;
    }
    if (seen[id]) { warnings.push({ code: 'duplicate-id', message: '重复 id 已去重：' + id }); continue; }
    seen[id] = true;
    uniq.push(e);
  }

  // Visibility remains opt-in for the existing selector API. Candidate injection opts in.
  let visible = uniq;
  let visibility = { applied: false, hiddenArchived: 0, hiddenOldClosed: 0, hiddenUnresolvedClosed: 0 };
  if (o.applyVisibility === true) {
    const hasNow = o.now !== undefined && o.now !== null && Number.isFinite(Number(o.now)) && Number(o.now) > 0;
    const hasDays = o.recentClosedDays !== undefined && o.recentClosedDays !== null
      && Number.isFinite(Number(o.recentClosedDays)) && Number(o.recentClosedDays) >= 0;
    if (hasNow && hasDays) {
      const result = filterCatalogVisiblePre(uniq, { now: Number(o.now), recentClosedDays: Number(o.recentClosedDays) });
      visible = result.visible;
      visibility = { applied: true, hiddenArchived: result.hiddenArchived,
        hiddenOldClosed: result.hiddenOldClosed, hiddenUnresolvedClosed: 0 };
    } else {
      // No wall clock or closed-window value is invented inside a pure renderer.
      visible = uniq.filter((event) => event.status !== 'archived' && event.status !== 'closed');
      visibility = { applied: true,
        hiddenArchived: uniq.filter((event) => event.status === 'archived').length,
        hiddenOldClosed: 0,
        hiddenUnresolvedClosed: uniq.filter((event) => event.status === 'closed').length };
      unresolved.push({ key: 'visibility.now/recentClosedDays',
        reason: '可见性筛选缺调用方时钟或近期 closed 窗口；closed 暂不注入，未改存储或检索可见性' });
    }
  }
  const sorted = visible.slice().sort((a, b) => {
    const ta = Number(a.updatedAt) || 0;
    const tb = Number(b.updatedAt) || 0;
    return tb - ta;
  });

  // ── currentEventIds：**真实输入**；缺省 ⇒ 全部标「最近更新」，不冒充当前任务
  // [DECISION D30B-10 | 2026-11-22 | user ruling] Recency cannot mark an event as the current task.
  const curIds = Array.isArray(o.currentEventIds)
    ? o.currentEventIds.filter((x) => typeof x === 'string' && x) : null;
  const hasCurrent = curIds !== null && curIds.length > 0;
  if (curIds === null) {
    unresolved.push({ key: 'currentEventIds', reason: '无真实会话上下文 ⇒ 一律称「最近更新」，**不冒充当前任务**' });
  }
  const curSet = hasCurrent ? new Set(curIds) : null;

  // ── 选 active 卡片：**只取 status==='active'**，且数量不超过 activeLimit
  const actives = sorted.filter((e) => String(e.status || '') === 'active');
  const expanded = actives.slice(0, activeLimit);
  const expandedIds = new Set(expanded.map((e) => e.id));

  const cards = expanded.map((e) => {
    const isCur = curSet !== null && curSet.has(e.id);
    return Object.freeze({
      id: e.id,
      name: typeof e.name === 'string' ? e.name : '',
      status: String(e.status || ''),
      // ★标签语义：有真实上下文才说「当前任务」，否则只说「最近更新」
      label: isCur ? '当前任务' : '最近更新',
      isCurrentTask: isCur,
      sections: projectEventSectionsPre(e),
    });
  });

  // ★目录**排除已展开事件**
  const catalogAll = sorted.filter((e) => !expandedIds.has(e.id));
  let catalogItems = catalogAll.map((e) => {
    const isCur = curSet !== null && curSet.has(e.id);
    return Object.freeze({
      id: e.id,
      name: typeof e.name === 'string' ? e.name : '',
      status: String(e.status || ''),
      label: isCur ? '当前任务' : '最近更新',
    });
  });

  // Measure the exact serialized text, including labels and inter-item newlines.
  const rawCatalogCap = o.catalogChars;
  const catCap = rawCatalogCap !== undefined && rawCatalogCap !== null && rawCatalogCap !== ''
    && Number.isFinite(Number(rawCatalogCap)) && Number(rawCatalogCap) >= 0
    ? Math.floor(Number(rawCatalogCap)) : null;
  let catOmitted = 0;
  if (catCap !== null) {
    const kept = [];
    for (const item of catalogItems) {
      if (renderEventCatalogTextPre(kept.concat([item]), o.catalogWithIdTag === true).length > catCap) {
        catOmitted++;
      } else kept.push(item);
    }
    catalogItems = kept;
    if (catOmitted) {
      degradations.push(makeDegradation('segment-dropped',
        '目录超预算 ⇒ 省略 ' + catOmitted + ' 条', { scope: 'event-catalog', recoverable: true }));
    }
  } else {
    unresolved.push({ key: 'catalogChars', reason: '未给目录预算 ⇒ 不裁剪（不擅自定值）' });
  }
  const catalogText = renderEventCatalogTextPre(catalogItems, o.catalogWithIdTag === true);
  const catalogChars = catalogText.length;
  if (!Number.isFinite(Number(o.finalBudget))) {
    unresolved.push({ key: 'finalBudget', reason: '最终帧预算未定 ⇒ 交 FM（不擅自定值）' });
  }

  return Object.freeze({
    dtoKind: 'EventProjection', schemaVersion: 1,
    cards: Object.freeze(cards),
    catalog: Object.freeze(catalogItems),
    catalogText,
    visibility: Object.freeze(visibility),
    counts: Object.freeze({
      input: list.length,
      unique: uniq.length,
      active: actives.length,
      expanded: cards.length,
      cataloged: catalogItems.length,
      catalogOmitted: catOmitted,
      catalogChars,
    }),
    activeLimit: hasLimit ? activeLimit : null,
    // ★显式声明标签语义来源，便于审计「是否冒充当前任务」
    labelSemantics: Object.freeze({
      hasCurrentEventIds: hasCurrent,
      fallbackLabel: '最近更新',
    }),
    warnings: Object.freeze(warnings),
    degradations: Object.freeze(degradations),
    unresolved: Object.freeze(unresolved),
  });
}
/**
 * ★来源指针（members / rel / quoteRef / sourceRef）。
 *
 * 契约（L1 §4.9 / L2 §8.3）：
 *   · **只生成指针，不注入整篇文档**（`content` 恒为 null）；
 *   · **quoteRef 是引文不是路径** ⇒ kind='quote'，**不当作可解析路径**；
 *   · **sourceRef 可能是账本/日志** ⇒ 按前缀/特征判类别，**不冒充施工文档**；
 *   · **路径失效显式标未解析**（`resolved:false` + warning），**不静默丢弃**。
 *
 * @param {object} input {members, checkpoints, resolvePath}
 *   resolvePath —— 可选注入：把路径解析成 {ok, kind}；不给则一律 resolved=false
 */
export function renderEventSourcePointersPre(input) {
  const o = input === null || typeof input !== 'object' ? {} : input;
  const pointers = [];
  const warnings = [];
  const resolvePath = typeof o.resolvePath === 'function' ? o.resolvePath : null;

  /** 判定 sourceRef 类别（**不冒充施工文档**）。 */
  const classify = (ref) => {
    const s = String(ref);
    if (/^docs\/internal\/.*\.md$/i.test(s) && /DETAIL-|RESULT-|REVIEW-|CONSTRUCTION-|MASTER-/.test(s)) return 'doc';
    if (/handoff\//.test(s) || /账本|ledger/i.test(s)) return 'ledger';
    if (/\.dsh-memory\/|daily|\blog\b|日志/i.test(s)) return 'log';
    if (/reflection|反思/i.test(s)) return 'reflection';
    if (/PLAN\.md|白板|whiteboard/i.test(s)) return 'plan';
    return 'unknown';
  };

  const push = (p) => { pointers.push(Object.freeze(p)); };

  // ── members：文档/文件指针
  const members = Array.isArray(o.members) ? o.members : [];
  for (const m of members) {
    const raw = typeof m === 'string' ? m : (m && typeof m.rel === 'string' ? m.rel : null);
    if (!raw) {
      warnings.push({ code: 'missing-rel', message: 'member 缺 rel，已跳过（不伪造）' });
      continue;
    }
    let resolved = false;
    if (resolvePath) {
      try { const r = resolvePath(raw); resolved = !!(r && r.ok); }
      catch (_) { resolved = false; }
    }
    if (!resolved) {
      warnings.push({ code: 'unresolved-path', message: '路径未解析：' + raw + '（显式标注，不静默丢弃）' });
    }
    push({
      kind: 'member',
      ref: raw,
      sourceKind: classify(raw),
      resolved,
      // ★只是指针：不带内容
      content: null,
      hint: resolved ? '可用读取工具下钻' : '路径未解析，勿当作已加载内容',
    });
  }

  // ── checkpoints：rel / quoteRef / sourceRef
  const cps = Array.isArray(o.checkpoints) ? o.checkpoints : [];
  for (const cp of cps) {
    if (!cp || typeof cp !== 'object') continue;
    const cpId = typeof cp.id === 'string' ? cp.id : null;
    if (typeof cp.rel === 'string' && cp.rel) {
      let resolved = false;
      if (resolvePath) { try { const r = resolvePath(cp.rel); resolved = !!(r && r.ok); } catch (_) { resolved = false; } }
      if (!resolved) warnings.push({ code: 'unresolved-path', message: '检查点 rel 未解析：' + cp.rel });
      push({ kind: 'rel', ref: cp.rel, sourceKind: classify(cp.rel), resolved, content: null, checkpointId: cpId,
        hint: resolved ? '可用读取工具下钻' : '路径未解析，勿当作已加载内容' });
    }
    // ★quoteRef 是**引文**不是路径：不做 resolve，不当作可打开的文件
    if (typeof cp.quoteRef === 'string' && cp.quoteRef) {
      push({ kind: 'quoteRef', ref: cp.quoteRef, sourceKind: 'quote', resolved: null, content: null, checkpointId: cpId,
        hint: '这是引文，不是路径（勿按路径解析）' });
    }
    // ★sourceRef 可能是账本/日志，按类别标注，**不冒充施工文档**
    if (typeof cp.sourceRef === 'string' && cp.sourceRef) {
      const sk = classify(cp.sourceRef);
      push({ kind: 'sourceRef', ref: cp.sourceRef, sourceKind: sk, resolved: null, content: null, checkpointId: cpId,
        hint: '类别：' + sk + '（来源可能不是施工文档）' });
    }
  }

  return Object.freeze({
    dtoKind: 'EventSourcePointers', schemaVersion: 1,
    pointers: Object.freeze(pointers),
    warnings: Object.freeze(warnings),
    counts: Object.freeze({
      total: pointers.length,
      members: pointers.filter((p) => p.kind === 'member').length,
      rel: pointers.filter((p) => p.kind === 'rel').length,
      quotes: pointers.filter((p) => p.kind === 'quoteRef').length,
      sourceRefs: pointers.filter((p) => p.kind === 'sourceRef').length,
      unresolved: pointers.filter((p) => p.resolved === false).length,
    }),
    // ★显式声明：本函数**不注入任何正文**
    injectedContent: false,
  });
}

function makeEventCandidatePre(id, bucket, priority, text, sourceIdentity) {
  return makeProjectionCandidate({
    id, kind: 'body', bucket, priority: Number.isFinite(Number(priority)) ? Number(priority) : 0, text,
    sourceIdentity,
    contentVersion: 'event-view-v1:' + createHash('sha256').update(text, 'utf8').digest('hex'),
  });
}

/** Shared order and preview projection; index refers to the caller's original array. */
export function renderLatestCheckpointPreviewsPre(input) {
  const o = input && typeof input === 'object' ? input : {};
  const list = Array.isArray(o.checkpoints) ? o.checkpoints : [];
  const sorted = list.map((checkpoint, index) => ({ checkpoint, index }))
    .filter((item) => item.checkpoint && typeof item.checkpoint === 'object')
    .sort((a, b) => {
      const ta = Number(a.checkpoint.at ?? a.checkpoint.updatedAt) || 0;
      const tb = Number(b.checkpoint.at ?? b.checkpoint.updatedAt) || 0;
      return tb - ta || b.index - a.index;
    });
  return Object.freeze(sorted.map(({ checkpoint, index }, rank) => Object.freeze({
    rank, index,
    preview: renderCheckpointPreviewPre({ checkpoint, budget: o.budget, sourceRef: o.sourceRef }),
  })));
}

/**
 * One candidate API for every event-frame consumer. Existing T2 owns percept/panel/
 * outcome formatting and its compatibility limits; this layer only adapts previews.
 * now/recentClosedDays are injected, not read from wall-clock or new configuration.
 */
export function buildEventCandidatesPre(input) {
  const o = input && typeof input === 'object' ? input : {};
  const projection = selectEventProjectionPre(Object.assign({}, o, {
    applyVisibility: o.applyVisibility !== false,
  }));
  const sourceById = new Map();
  for (const event of Array.isArray(o.events) ? o.events : []) {
    if (event && typeof event === 'object' && !sourceById.has(event.id)) sourceById.set(event.id, event);
  }
  const candidates = [];
  for (const card of projection.cards) {
    const event = sourceById.get(card.id);
    if (!event) continue;
    const budget = o.checkpointBudget && typeof o.checkpointBudget === 'object' ? o.checkpointBudget : {};
    const rawCap = budget.capChars;
    const hasCap = rawCap !== undefined && rawCap !== null && rawCap !== ''
      && Number.isFinite(Number(rawCap)) && Number(rawCap) >= 0;
    // Reuse the current legacy per-item limit; do not define an event/frame policy here.
    const capChars = hasCap
      ? Math.min(Math.floor(Number(rawCap)), T2_BUDGET.CHECKPOINT_ITEM) : T2_BUDGET.CHECKPOINT_ITEM;
    const original = Array.isArray(event.checkpoints) ? event.checkpoints : [];
    const previews = renderLatestCheckpointPreviewsPre({
      checkpoints: original,
      budget: Object.assign({}, budget, { capChars, singleLine: true, mode: budget.mode || 'sections' }),
    });
    const checkpoints = Number.isFinite(o.maxCheckpoints) && o.maxCheckpoints <= 0 ? []
      : previews.slice().reverse().map(({ index, preview }) => Object.assign({}, original[index], {
        // The legacy renderer reads four fields before text. Clear only the copy.
        goal: '', state: '', dead: '', next: '', text: preview.text,
      }));
    const text = renderT2Pre(Object.assign({}, event, {
      name: card.name + ' · ' + card.label,
      sections: Object.fromEntries(card.sections.map(({ key, text }) => [key, text])),
      checkpoints,
    }), { maxCheckpoints: o.maxCheckpoints });
    if (text) candidates.push(makeEventCandidatePre(card.id, 'event-cards', o.eventPriority, text,
      typeof o.sourceIdentity === 'string' && o.sourceIdentity ? o.sourceIdentity + '#' + card.id : 'event:' + card.id));
  }
  if (projection.catalogText) candidates.push(makeEventCandidatePre('event-catalog', 'event-catalog',
    o.catalogPriority, projection.catalogText,
    typeof o.sourceIdentity === 'string' && o.sourceIdentity ? o.sourceIdentity + '#catalog' : 'events:catalog'));
  return Object.freeze({ projection, candidates: Object.freeze(candidates) });
}

/** Prepare only the text and counts that the existing frame renderer consumes. */
export function buildEventInjectionSnapshotPre(input) {
  const { projection, candidates } = buildEventCandidatesPre({ ...input, catalogWithIdTag: true });
  return {
    cardsText: candidates.filter((candidate) => candidate.bucket === 'event-cards')
      .map((candidate) => candidate.text).join('\n\n'),
    catalog: {
      text: projection.catalogText,
      included: projection.counts.cataloged,
      dropped: projection.counts.catalogOmitted,
    },
  };
}

/** 注册专用 port（供 DI facade 使用）。 */
export function createEventViewPort(getInput, fn) {
  if (typeof getInput !== 'function' || typeof fn !== 'function') {
    fail(INJECTION_ERROR_CODES.INVALID_ARGUMENT, 'createEventViewPort requires (getInput, fn)');
  }
  return (() => fn(getInput()));
}

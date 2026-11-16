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
export function renderCheckpointPreviewPre(input) {
  const o = input === null || typeof input !== 'object' ? {} : input;
  const cp = o.checkpoint && typeof o.checkpoint === 'object' ? o.checkpoint : {};
  const budget = o.budget && typeof o.budget === 'object' ? o.budget : {};
  const mode = budget.mode === 'sections' ? 'sections' : 'head-tail';
  const cap = Number.isFinite(Number(budget.capChars)) && Number(budget.capChars) > 0
    ? Math.floor(Number(budget.capChars)) : null;

  const text = typeof cp.text === 'string' ? cp.text : '';
  const id = typeof cp.id === 'string' && cp.id ? cp.id : null;
  const sourceRef = o.sourceRef
    ?? (typeof cp.sourceRef === 'string' ? cp.sourceRef : null);

  const unresolved = [];
  if (cap === null) {
    unresolved.push({ key: 'budget.capChars', reason: '未给检查点预览上限 ⇒ 不裁剪（不擅自定值）' });
  }

  // ── 空字段不输出：没有任何四段也没有 text ⇒ 空预览
  const sections = projectCheckpointSectionsPre(cp);
  if (!text && !sections.length) {
    return Object.freeze({
      dtoKind: 'CheckpointPreview', schemaVersion: 1,
      text: '', head: '', tail: '', truncated: false,
      sourceIdentity: id ? 'cp:' + id : 'cp:unknown',
      sourceRef: sourceRef === undefined ? null : sourceRef,
      mode, sections: Object.freeze([]), omittedChars: 0,
      unresolved: Object.freeze(unresolved),
    });
  }

  let head = '';
  let tail = '';
  let truncated = false;
  let rendered = text;

  if (cap !== null && text.length > cap) {
    truncated = true;
    if (mode === 'head-tail') {
      // ★保留首尾：一半给头、一半给尾（尾部含结论/下一步通常更关键，多给 1）
      const headLen = Math.floor(cap / 2);
      const tailLen = cap - headLen;
      head = text.slice(0, headLen);
      tail = tailLen > 0 ? text.slice(text.length - tailLen) : '';
      rendered = head + '\n…（已省略 ' + (text.length - cap) + ' 字）…\n' + tail;
    } else {
      // ★按四段分配：从四段里取，直到用完预算（不改原文，只选段）
      const picked = [];
      let used = 0;
      for (const s of sections) {
        const chunk = s.title + '：' + s.text;
        if (used + chunk.length > cap) {
          const room = cap - used;
          if (room > 8) { picked.push(chunk.slice(0, room)); used += room; }
          break;
        }
        picked.push(chunk);
        used += chunk.length;
      }
      rendered = picked.join('\n');
      head = picked[0] || '';
      tail = picked.length > 1 ? picked[picked.length - 1] : '';
    }
  } else {
    head = text;
  }

  const omittedChars = truncated ? Math.max(0, text.length - cap) : 0;

  return Object.freeze({
    dtoKind: 'CheckpointPreview', schemaVersion: 1,
    text: rendered,
    head, tail, truncated,
    sourceIdentity: id ? 'cp:' + id : 'cp:unknown',
    sourceRef: sourceRef === undefined ? null : sourceRef,
    mode,
    sections: Object.freeze(mode === 'sections' ? sections : []),
    omittedChars,
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

  // ── 排序：updatedAt 降序（**最近更新优先**）
  const sorted = uniq.slice().sort((a, b) => {
    const ta = Number(a.updatedAt) || 0;
    const tb = Number(b.updatedAt) || 0;
    return tb - ta;
  });

  // ── currentEventIds：**真实输入**；缺省 ⇒ 全部标「最近更新」，不冒充当前任务
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

  // ── 目录字符预算
  const catCap = Number.isFinite(Number(o.catalogChars)) && Number(o.catalogChars) > 0
    ? Math.floor(Number(o.catalogChars)) : null;
  let catalogChars = 0;
  let catOmitted = 0;
  if (catCap !== null) {
    const kept = [];
    let used = 0;
    for (const it of catalogItems) {
      const line = '- ' + it.name + '（' + it.id + '）';
      if (used + line.length > catCap) { catOmitted++; continue; }
      used += line.length;
      kept.push(it);
    }
    catalogItems = kept;
    catalogChars = used;
    if (catOmitted) {
      degradations.push(makeDegradation('segment-dropped',
        '目录超预算 ⇒ 省略 ' + catOmitted + ' 条', { scope: 'event-catalog', recoverable: true }));
    }
  } else {
    unresolved.push({ key: 'catalogChars', reason: '未给目录预算 ⇒ 不裁剪（不擅自定值）' });
  }
  if (!Number.isFinite(Number(o.finalBudget))) {
    unresolved.push({ key: 'finalBudget', reason: '最终帧预算未定 ⇒ 交 FM（不擅自定值）' });
  }

  return Object.freeze({
    dtoKind: 'EventProjection', schemaVersion: 1,
    cards: Object.freeze(cards),
    catalog: Object.freeze(catalogItems),
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

/** 注册专用 port（供 DI facade 使用）。 */
export function createEventViewPort(getInput, fn) {
  if (typeof getInput !== 'function' || typeof fn !== 'function') {
    fail(INJECTION_ERROR_CODES.INVALID_ARGUMENT, 'createEventViewPort requires (getInput, fn)');
  }
  return (() => fn(getInput()));
}
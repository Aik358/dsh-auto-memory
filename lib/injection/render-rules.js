/**
 * lib/injection/render-rules.js —— B3-RP：规则呈现（L1 §4.5）
 *
 * renderRulesForTierPre({rules,tier})
 *   → {text,counts,chars,mode}
 *
 * 契约（L1 §4.5 / L2 §6 逐条）：
 *   · **摘要档一行指针**（不给整段规则）；
 *   · **human_full 输出完整有效正文**，不只首行、**不逐条 200 截断**；
 *   · **note 保留中性前缀**，不冒充硬规则；**legacy 少给**；
 *   · **snapshotSlimMaintain 只在 human_slim**，run_slim 不含；
 *   · **retired 不进有效规则**（返回但标记，不冒充有效）；
 *   · 消费 B3-RC 的聚合结果（`readRulesAggregatePre` 的返回），**不改 rules-layer.js 公开语义**。
 *
 * ★本模块**只做呈现**：不读文件、不写状态、不解析记忆文本（解析在 RC）。
 */

import { INJECTION_ERROR_CODES, fail } from './errors.js';
import { RULE_NOTE_PREFIX_PRE_V1, RULE_TRUNC_POINTER_PRE_V1 } from '../rules-layer.js';

/** 与既有 rules-layer 保持**同一措辞**（不复制常量值，而是显式引用其语义）。 */
export const NOTE_PREFIX = RULE_NOTE_PREFIX_PRE_V1;
export const TRUNC_POINTER = RULE_TRUNC_POINTER_PRE_V1;

/** 摘要档的「一行指针」形态。 */
export const SUMMARY_POINTER = '（规则已按摘要档省略：完整正文用 memory_rules op=list）';

/** 维护块（snapshotSlimMaintain）：**只在 human_slim**。 */
export const SLIM_MAINTAIN_BLOCK = '（规则维护提醒：本轮为精简档，仅保留硬规则要点；需要完整规则请用 memory_rules op=list）';

/** 支持渲染的档位。 */
export const RENDER_TIERS = Object.freeze(['full', 'human_full', 'post_compact', 'handoff_carry', 'hang_compensate', 'human_slim', 'run_full', 'run_slim', 'slim', 'legacy']);

/** 精简档：只给一行指针（摘要档）。 */
const SUMMARY_TIERS = Object.freeze(['slim', 'run_full', 'run_slim', 'human_slim', 'legacy']);
/** legacy 只给指针，不重新引入完整规则条目。 */

/**
 * 从 RC 聚合结果里取出「有效条目」列表（rule + note）。
 *
 * ★★关键（本轮实测发现并修正的缺陷）：B3-RC 把 note **单独放在 `notes` 字段**，
 *   **不在 `rules` 里**。若 RP 只读 `rules`，note 会**整类丢失** ⇒
 *   「note 保留中性前缀」这条契约（L1 §4.5）在输出上**无法成立**。
 *   故必须**合并 rules + notes** 再渲染；note 靠 kind 加前缀，不冒充硬规则。
 *
 * ★**retired 不进有效规则**（L1 §4.5 / L2 §6）。candidates / references 不消费（非硬规则）。
 */
/**
 * ★★唯一过滤点（本轮实测发现：原实现有**两份重复过滤逻辑** —— 对象路径走 effectiveRulesOf、
 *   数组路径在 renderRulesForRierPre 内又内联了一遍。两份逻辑迟早改一处漏一处，故收敛到此函数。
 *   变异验证也据此才有意义：改这一处即可覆盖两条输入路径。
 */
function filterEffective(list) {
  return (Array.isArray(list) ? list : []).filter((x) => {
    if (!x || typeof x !== 'object') return false;
    if (x.retired === true) return false;              // ★retired 排除
    if (String(x.status || 'current') !== 'current') return false; // superseded/retracted 亦排除
    if (typeof x.text !== 'string' || !x.text.trim()) return false;
    return true;
  });
}

/** 从 RC 聚合结果（对象形态）取有效条目 = rules + notes。 */
function effectiveRulesOf(rules) {
  const r = rules && typeof rules === 'object' ? rules : {};
  const ruleList = Array.isArray(r.rules) ? r.rules : [];
  const noteList = Array.isArray(r.notes) ? r.notes : [];
  return filterEffective(ruleList.concat(noteList));
}

/**
 * 渲染单条规则。
 * @param {object} item RC 条目 {text, kind, ...}
 * @param {object} opts {full:boolean} —— full=true 时**完整正文**（多行原样，不截断）
 */
function renderItem(item, opts) {
  const isNote = String(item.kind || '') === 'note';
  // ★note 需带中性前缀（不冒充硬规则）；具体补法见下方 stillNeedPrefix
  let body = opts.full ? String(item.text).trim() : firstLineOf(item.text);
  // ★去掉正文自带的列表前缀，避免渲染出 "- - xxx"（RC 的 note 文本本身就带 "- "）
  body = body.replace(/^[-*+]\s+/, '');
  // ★★避免前缀重复：RC 的说明类正文**本身可能已带「（说明）」**
  //   （rules-layer 的 splitRuleItemsPre 在 <2 bullet 时的行为），
  //   若再无条件加一次会渲染成「（说明）（说明）…」。此处仅在缺失时补。
  const stillNeedPrefix = isNote && !body.startsWith(NOTE_PREFIX);
  return '- ' + (stillNeedPrefix ? NOTE_PREFIX : '') + body.replace(/\n/g, '\n  ');
}

/** 取首行（摘要用），保留既有「跳过标题/注释」语义。 */
function firstLineOf(text) {
  const lines = String(text == null ? '' : text).split('\n').map((l) => l.trim()).filter(Boolean);
  for (const l of lines) {
    if (/^#{1,6}\s/.test(l)) continue;   // 小节标记不是正文
    if (/^<!--/.test(l)) continue;
    if (/^[-*+]\s*$/.test(l)) continue;
    const body = l.replace(/^[-*+]\s+/, '').trim();
    if (!body) continue;
    return body;
  }
  return '';
}

/**
 * ★ 主入口：按档位渲染规则。
 *
 * @param {object} input
 *   rules  —— **B3-RC 聚合结果**（readRulesAggregatePre 的返回；也可只传 {rules:[...]}）
 *   tier   —— 档位
 *   legacy —— （可选）legacy 少给开关，true 时只给指针
 * @returns {{text,counts,chars,mode}}
 */
export function renderRulesForTierPre(input) {
  const o = input === null || typeof input !== 'object' ? {} : input;
  const tier = typeof o.tier === 'string' ? o.tier : 'slim';
  if (!RENDER_TIERS.includes(tier)) {
    fail(INJECTION_ERROR_CODES.INVALID_ENUM,
      'unknown tier for rules render: ' + tier + ' (allowed: ' + RENDER_TIERS.join('|') + ')',
      { field: 'tier', detail: tier });
  }

  // ★两条输入路径（数组 / RC 对象）都走同一个 filterEffective —— 不再各写一遍
  const effective = Array.isArray(o.rules) ? filterEffective(o.rules) : effectiveRulesOf(o.rules);

  const isLegacy = o.legacy === true || tier === 'legacy';
  const limited = effective;
  const omittedByLegacy = isLegacy ? effective.length : 0;

  // ★excludedRetired：RC 聚合结果里 retired 的条数（不参与渲染，但如实报数）
  const excludedRetired = (o.rules && !Array.isArray(o.rules) && Array.isArray(o.rules.retired))
    ? o.rules.retired.length : 0;
  const counts = {
    total: effective.length,
    rendered: 0,
    rule: 0,
    note: 0,
    omittedLegacy: omittedByLegacy,
    excludedRetired,
  };

  // ── 摘要档：**一行指针**
  if (SUMMARY_TIERS.includes(tier) || isLegacy) {
    const text = limited.length
      ? (isLegacy ? '（legacy 规则已省略 ' + omittedByLegacy + ' 条；完整正文用 memory_rules op=list）' : SUMMARY_POINTER)
      : '';
    const maintainText = typeof o.maintainText === 'string' && o.maintainText ? o.maintainText : SLIM_MAINTAIN_BLOCK;
    const finalText = tier === 'human_slim' && text ? text + '\n' + maintainText : text;
    counts.rendered = 0;
    return Object.freeze({
      dtoKind: 'RulesRender', schemaVersion: 1,
      text: finalText, counts: Object.freeze(counts), chars: Object.freeze({ text: finalText.length }),
      mode: isLegacy ? 'legacy-pointer' : (tier === 'human_slim' ? 'slim-maintain' : 'pointer'),
      snapshotSlimMaintain: tier === 'human_slim',
      legacy: isLegacy,
    });
  }

  // ── 完整档 / 精简档
  const isFull = ['full', 'human_full', 'post_compact', 'handoff_carry', 'hang_compensate'].includes(tier);
  const rows = limited.map((it) => renderItem(it, { full: isFull }));
  for (const it of limited) {
    if (String(it.kind || '') === 'note') counts.note++; else counts.rule++;
  }
  counts.rendered = rows.length;

  const parts = [];
  if (rows.length) parts.push(rows.join('\n'));

  // ★snapshotSlimMaintain **只在 human_slim**（run_slim 不含）
  let maintain = false;
  if (tier === 'human_slim') {
    parts.push(typeof o.maintainText === 'string' && o.maintainText ? o.maintainText : SLIM_MAINTAIN_BLOCK);
    maintain = true;
  }

  if (omittedByLegacy > 0) {
    parts.push('（legacy 模式：另 ' + omittedByLegacy + ' 条未展开，完整正文用 memory_rules op=list）');
  }

  const text = parts.join('\n');
  return Object.freeze({
    dtoKind: 'RulesRender', schemaVersion: 1,
    text,
    counts: Object.freeze(counts),
    chars: Object.freeze({ text: text.length }),
    mode: isFull ? 'full' : (maintain ? 'slim-maintain' : 'slim'),
    snapshotSlimMaintain: maintain,
    legacy: isLegacy,
  });
}
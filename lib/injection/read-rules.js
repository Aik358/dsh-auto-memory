/**
 * lib/injection/read-rules.js —— B3-RC：规则完整读取（L1 §4.2）
 *
 * readRulesAggregatePre({userFile,notesPath,candidatePath,ownerSessionId,sessionKey,readFile})
 *   → {rules,candidates,references,retired,counts,chars,proofs,warnings}
 *
 * 关键契约（逐条）：
 *   · userFile/notesPath **可缺省**；
 *   · candidatePath/ownerSessionId/sessionKey/readFile **由调用方注入，绝不从全局状态猜**；
 *   · 覆盖 user+project 完整有效正文与多行限定；rule/note/candidate/reference/retired 分别计数；
 *   · 区分「两条 bullet」与「一条多行规则」（复用 rules-layer 的 <2 bullet 不拆语义）；
 *   · 保留 applyRuleEditPre 的层内 index/expect/revision 与跨层 CAS 拒绝；**不制造跨层统一编辑索引**；
 *   · 候选规则**不因包含规则措辞自动升格**；owner/session 缺失时**保留边界，不跨会话读取**；
 *   · revision(user) 与 revision(project) 属**不同命名空间**；
 *   · 只读：不写任何文件、不改写入路径。
 */

import { createHash } from 'node:crypto';
import { INJECTION_ERROR_CODES, fail, makeDegradation } from './errors.js';
import { makeSourceProof, requireString } from './dto.js';
import {
  splitMemoryEntriesPre,
  splitRuleItemsPre,
  statusOfEntryPre,
} from '../rules-layer.js';

/** 层名（user / project 是两个独立命名空间）。 */
export const RULE_LAYERS = Object.freeze(['user', 'project']);

/** 读取状态四态（L1 §4.1「区分 missing/empty/unreadable/invalid」）。 */
export const READ_STATUS = Object.freeze({
  OK: 'ok',
  MISSING: 'missing',
  EMPTY: 'empty',
  UNREADABLE: 'unreadable',
  INVALID: 'invalid',
});

const sha256 = (s) => createHash('sha256').update(s, 'utf8').digest('hex');
const normLF = (s) => String(s == null ? '' : s).replace(/\r\n/g, '\n').replace(/\r/g, '\n');

/**
 * 读取单个来源文件，归一化为四态 + SourceProof。
 * **readFile 必须由调用方注入**（契约要求）；未注入即显式降级，不 fallback 到 fs。
 */
function readOneSource(spec, readFile) {
  const label = spec.label;
  if (!spec.path) {
    return { status: READ_STATUS.MISSING, text: '', proof: null, warning: null };
  }
  if (typeof readFile !== 'function') {
    // ★契约：不猜、不 fallback 到真实 fs；显式降级并把状态标为 unreadable
    return {
      status: READ_STATUS.UNREADABLE, text: '', proof: null,
      warning: makeDegradation('readfile-not-injected',
        'readFile port not provided; cannot read ' + label, { scope: label }),
    };
  }
  let raw = null;
  try {
    raw = readFile(spec.path);
  } catch (e) {
    const code = e && (e.code || e.name);
    // ENOENT ⇒ missing；其余（EPERM/EISDIR/…）⇒ unreadable。**绝不静默转空**
    const status = code === 'ENOENT' ? READ_STATUS.MISSING : READ_STATUS.UNREADABLE;
    return {
      status, text: '', proof: null,
      warning: makeDegradation('read-failed',
        'read ' + label + ' failed: ' + String(code),
        { scope: label, recoverable: status === READ_STATUS.UNREADABLE }),
    };
  }
  if (raw === null || raw === undefined) {
    return { status: READ_STATUS.MISSING, text: '', proof: null, warning: null };
  }
  if (typeof raw !== 'string') {
    // 读到非字符串 ⇒ invalid（不是空）
    return {
      status: READ_STATUS.INVALID, text: '', proof: null,
      warning: makeDegradation('invalid-content',
        label + ' content is not a string: ' + typeof raw, { scope: label }),
    };
  }
  const normalized = normLF(raw);
  if (!normalized.trim()) {
    return {
      status: READ_STATUS.EMPTY, text: '', proof: null,
      proofEmpty: true,
      rawBytes: Buffer.byteLength(raw, 'utf8'),
    };
  }
  const proof = makeSourceProof({
    sourceRef: spec.sourceRef || label,
    bytes: Buffer.byteLength(raw, 'utf8'),
    rawSha256: sha256(raw),
    normalizedSha256: sha256(normalized),
    revision: 'sha256:' + sha256(normalized).slice(0, 16),
  });
  return { status: READ_STATUS.OK, text: normalized, proof, warning: null };
}
/**
 * 把一个层（user 或 project）解析为 5 类条目。
 *
 * 复用 rules-layer 既有语义（**不另造一套**）：
 *   · splitMemoryEntriesPre：按 memory 锚点切条目；无锚点整篇一条（不丢内容）
 *   · statusOfEntryPre：取 dsh-status（current/superseded/retracted）⇒ retired 判定
 *   · splitRuleItemsPre：entry 内 bullet 条目化，**<2 bullet 不拆**（向后兼容硬约束）
 *
 * 分类口径：
 *   · 命中 RULE_CONSTRAINT_WORDS 且无引用语境的 bullet ⇒ rule
 *   · 含引用/历史语境（描述标记）⇒ **candidate（候选，不自动升格）**
 *   · bullet 内非祈使句 ⇒ note（说明，保留但不冒充硬约束）
 *   · 无约束语汇且非 note ⇒ reference
 *   · dsh-status 为 superseded/retracted ⇒ retired（不剔除，保留并标记）
 */
function parseLayer(text, layer) {
  const rules = [], notes = [], candidates = [], references = [], retired = [];
  if (!text) return { rules, notes, candidates, references, retired, entries: 0 };
  const entries = splitMemoryEntriesPre(text);
  for (let ei = 0; ei < entries.length; ei++) {
    const entry = entries[ei];
    const st = statusOfEntryPre(entry.text) || {};
    const isRetired = st.status === 'superseded' || st.status === 'retracted';
    const items = splitRuleItemsPre(entry.text);
    // ★按层内行级再分类：splitRuleItemsPre 在「<2 bullet」时**不拆**（向后兼容硬约束），
    //   于是「一条规则 + 一行（说明）」会整块返回、kind 一律 rule。
    //   若整块一刀切，说明行会被误判为 candidate、note 计数恒 0。
    //   故这里再把每个 item 的正文按行切成「同一 item 内的多个分类片区」：
    //   以「（说明）/说明：/注：」等语境行为界，前半按 rule 判、该行起按 note 判。
    //   ⚠ 不修改 rules-layer 的公开语义（那会影响既有 21 个套件），只在本层做只读细分。
    for (let ii = 0; ii < items.length; ii++) {
      const it = items[ii];
      const rawBody = String(it.text || '');
      if (!rawBody.trim()) continue;
      for (const seg of splitItemSegments(rawBody, it.kind)) {
        const body = String(seg.text || '').trim();
        if (!body) continue
        const rec = {
          layer,
          // ★层内 index：**只在本层有意义**，不制造跨层统一编辑索引
          entryIndex: ei,
          itemIndex: ii,
          segmentIndex: seg.index,
          entryId: entry.id || null,
          itemId: it.id || null,
          text: body,                       // 完整正文，多行限定不丢
          kind: seg.kind,
          revision: 'sha256:' + sha256(body).slice(0, 16),
          status: st.status || 'current',
          retired: isRetired,
        };
        if (isRetired) { retired.push(rec); continue }
        if (seg.kind === 'note') { notes.push(rec); continue }
        // 再区分 candidate / reference / rule（候选不因措辞自动升格）
        const cls = classifyItem(body);
        if (cls === 'candidate') candidates.push(rec);
        else if (cls === 'reference') references.push(rec);
        else rules.push(rec);
      }
    }
  }
  return { rules, notes, candidates, references, retired, entries: entries.length };
}

/**
 * 条目分类（不抛异常）。
 * **候选不因包含规则措辞自动升格**：命中「引用/历史语境」一律 candidate。
 */
/**
 * 把一个 item 的正文按「语境行」切成多个片区。
 * 语境行（（说明）/说明：/注：/例如/所谓/历史/曾经/原文/引用/参考）起，其后的行归为 note 片区。
 * 返回 [{index, kind, text}]；未命中语境行 ⇒ 单片区，kind 沿用 item 的 kind。
 */
const SEG_NOTE_LINE_RE = /^\s*(（说明）|说明[：:]|注[：:]|例如|所谓|历史|曾经|原文|引用|参考)/;
function splitItemSegments(body, itemKind) {
  const lines = String(body).split('\n');
  const segs = [];
  let cur = [];
  let curKind = itemKind;
  const flush = () => {
    const t = cur.join('\n').trim();
    if (t) segs.push({ index: segs.length, kind: curKind, text: t });
    cur = [];
  };
  for (const line of lines) {
    const isNoteLine = SEG_NOTE_LINE_RE.test(line);
    if (isNoteLine && curKind !== 'note') {
      flush();
      curKind = 'note';
    }
    cur.push(line);
  }
  flush();
  return segs.length ? segs : [{ index: 0, kind: itemKind, text: String(body).trim() }];
}
const CONSTRAINT_RE = /禁止|必须|不得|一律|须|不要|改成|要求|只能|应当|不允许/;
const CONTEXT_RE = /（说明）|说明：|注：|例如|所谓|历史|曾经|原文|引用|据.*所述|参考/;
function classifyItem(body) {
  const t = String(body || '');
  if (CONTEXT_RE.test(t)) return 'candidate';   // ★有语境 ⇒ 候选，不升格
  if (CONSTRAINT_RE.test(t)) return 'rule';
  return 'reference';
}

/**
 * B3-RC 主入口。**只读**。
 *
 * @param {object} input
 *   userFile      {string} 可选 —— 用户级记忆路径
 *   notesPath     {string} 可选 —— 项目笔记路径
 *   candidatePath {string} 可选 —— 候选规则路径（**必须由调用方注入，不猜**）
 *   ownerSessionId{string} 可选 —— 归属会话（缺省 ⇒ 不跨会话读取）
 *   sessionKey    {string} 可选 —— 会话键
 *   readFile      {Function} **必须由调用方注入**
 */
export function readRulesAggregatePre(input) {
  const o = input === null || typeof input !== 'object' ? {} : input;
  const readFile = o.readFile;
  const warnings = [];
  const proofs = {};
  const statuses = {};

  // ── user 层
  const userRes = readOneSource(
    { label: 'user', path: o.userFile, sourceRef: 'rules:user' }, readFile);
  statuses.user = userRes.status;
  if (userRes.warning) warnings.push(userRes.warning);
  if (userRes.proof) proofs.user = userRes.proof;

  // ── project 层
  const projRes = readOneSource(
    { label: 'project', path: o.notesPath, sourceRef: 'rules:project' }, readFile);
  statuses.project = projRes.status;
  if (projRes.warning) warnings.push(projRes.warning);
  if (projRes.proof) proofs.project = projRes.proof;

  // ── candidate 层（候选规则；**独立文件，且必须显式注入路径**）
  const candRes = o.candidatePath
    ? readOneSource({ label: 'candidate', path: o.candidatePath, sourceRef: 'rules:candidate' }, readFile)
    : { status: READ_STATUS.MISSING, text: '', proof: null, warning: null };
  statuses.candidate = candRes.status;
  if (candRes.warning) warnings.push(candRes.warning);
  if (candRes.proof) proofs.candidate = candRes.proof;

  // ── 归属边界：owner/session 缺失时**保留边界，不跨会话读取**
  const hasOwner = typeof o.ownerSessionId === 'string' && o.ownerSessionId.length > 0;
  const hasSession = typeof o.sessionKey === 'string' && o.sessionKey.length > 0;
  const ownerBoundary = Object.freeze({
    ownerSessionId: hasOwner ? o.ownerSessionId : null,
    sessionKey: hasSession ? o.sessionKey : null,
    crossSessionRead: false,          // ★恒为 false：从不跨会话读取
    degraded: !hasOwner || !hasSession,
  });
  if (!hasOwner) {
    warnings.push(makeDegradation('owner-session-missing',
      'ownerSessionId not injected; keeping boundary (no cross-session read)', { scope: 'owner' }));
  }

  const u = parseLayer(userRes.text, 'user');
  const p = parseLayer(projRes.text, 'project');
  const c = parseLayer(candRes.text, 'candidate');

  // 候选层产出的 rule 一律**降回 candidate**（不因措辞自动升格）
  const candAll = c.rules.concat(c.candidates).map((x) => Object.assign({}, x, { kind: 'candidate' }));

  const rules = u.rules.concat(p.rules);
  const notes = u.notes.concat(p.notes);
  const references = u.references.concat(p.references);
  const retired = u.retired.concat(p.retired).concat(c.retired);

  const counts = Object.freeze({
    rule: rules.length,
    note: notes.length,
    candidate: candAll.length,
    reference: references.length,
    retired: retired.length,
    entries: u.entries + p.entries,
    byLayer: Object.freeze({
      user: Object.freeze({ rule: u.rules.length, note: u.notes.length, candidate: u.candidates.length, reference: u.references.length, retired: u.retired.length }),
      project: Object.freeze({ rule: p.rules.length, note: p.notes.length, candidate: p.candidates.length, reference: p.references.length, retired: p.retired.length }),
    }),
  });

  const chars = Object.freeze({
    rules: rules.reduce((n, x) => n + x.text.length, 0),
    notes: notes.reduce((n, x) => n + x.text.length, 0),
    candidates: candAll.reduce((n, x) => n + x.text.length, 0),
    references: references.reduce((n, x) => n + x.text.length, 0),
    total: [].concat(rules, notes, candAll, references).reduce((n, x) => n + x.text.length, 0),
  });

  return Object.freeze({
    dtoKind: 'RulesAggregate',
    schemaVersion: 1,
    rules: Object.freeze(rules),
    notes: Object.freeze(notes),
    candidates: Object.freeze(candAll),
    references: Object.freeze(references),
    retired: Object.freeze(retired),
    counts,
    chars,
    proofs: Object.freeze(proofs),
    statuses: Object.freeze(statuses),
    ownerBoundary,
    // 两个 revision **不同命名空间**：分别给出，不合并
    revisions: Object.freeze({
      user: proofs.user ? proofs.user.revision : null,
      project: proofs.project ? proofs.project.revision : null,
    }),
    warnings: Object.freeze(warnings),
  });
}
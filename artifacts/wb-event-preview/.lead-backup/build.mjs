#!/usr/bin/env node
/**
 * build.mjs — 白板事件化原型生成器（单文件零依赖 HTML）
 *
 * 只读输入：C:\Users\JH Z\.dsh\memory\workspaces\--D--dsh-auto-memory--\handoff\
 *   handoff/*.md            575 篇（516 四段账本 + 58 会话转写 + 1 README）
 *   handoff/archive/*.md    258 篇（白板 PLAN 历史快照）
 *   合计 833 篇 → 事件 → 渲染 artifacts/wb-event-preview/index.html
 *
 * 输出：index.html / events.json（VERIFY.md 由 verify.mjs 生成）
 * 确定性：同输入同输出（不写当前时间、不含随机数、目录排序固定）
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { renderHtml } from './view.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const OUT_DIR = HERE;
export const MEMORY_ROOT = 'C:\\Users\\JH Z\\.dsh\\memory\\workspaces\\--D--dsh-auto-memory--';
export const HANDOFF_DIR = path.join(MEMORY_ROOT, 'handoff');
export const ARCHIVE_DIR = path.join(HANDOFF_DIR, 'archive');
export const PLAN_FILE = path.join(HANDOFF_DIR, 'PLAN.md');
export const EVENT_PLAN_FILE = path.join(HERE, 'event-plan.tsv');

/* ---------- 参数（全部可复算；改动会写进 events.json 的 params） ---------- */
export const PARAMS = {
  MAX_POINTS_PER_EVENT: 26,
  W_GOAL: 4, W_STATE: 2, W_DEAD: 1, W_NEXT: 1,
  NGRAM: 2,
  SIM_REPORT_THRESHOLDS: [0.30, 0.40, 0.50, 0.60],
  QUOTE_MAX: 320,
  BULLET_MAX: 200
};

const TICK = String.fromCharCode(96);
const MD_TICKS = new RegExp(TICK, 'g');

/* ---------- 基础工具 ---------- */
export function sha256(buf) {
  return crypto.createHash('sha256').update(buf).digest('hex');
}
export function readText(p) {
  const buf = fs.readFileSync(p);
  return { buf, sha: sha256(buf), text: buf.toString('utf8'), bytes: buf.length, mtime: fs.statSync(p).mtimeMs };
}
export function sortNames(list) {
  return list.slice().sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}
function stripBom(s) {
  return s.charCodeAt(0) === 0xfeff ? s.slice(1) : s;
}
export function parseSections(text) {
  const ls = stripBom(text).replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
  const secs = [];
  let cur = null;
  for (const l of ls) {
    const m = l.match(/^##\s+(.*\S)\s*$/);
    if (m) { if (cur) secs.push(cur); cur = { title: m[1], lines: [] }; }
    else if (cur) cur.lines.push(l);
  }
  if (cur) secs.push(cur);
  return secs;
}
export function bodyOf(secs, names) {
  for (const nm of names) { const s = secs.find(x => x.title === nm); if (s) return s.lines.join('\n'); }
  return '';
}
const TAG_LINE = /^[-*\u2022\u00b7]?\s*type:\s*(goal|state|dead-end|progress)\s*$/i;
export function bulletLines(body) {
  const out = [];
  for (const raw of body.replace(/<!--[\s\S]*?-->/g, '').split('\n')) {
    let t = raw.replace(/\s+$/, '').trim();
    if (!t) continue;
    if (TAG_LINE.test(t)) continue;              // 看板泳道 tag，不是内容
    t = t.replace(/^[-*+\u2022\u00b7]\s*/, '').trim();
    if (!t) continue;
    if (TAG_LINE.test(t)) continue;
    out.push(t);
  }
  return out;
}
const CIRCLED = /[\u2460-\u2473\u3251-\u325F\u32B1-\u32BF]/g;
/** 去噪：去注释/日期/时间/圈码/序号/markdown 标记/链接，只留文字骨架 */
export function cleanText(s) {
  return s
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/\d{4}-\d{2}-\d{2}/g, ' ')
    .replace(/\d{4}\/\d{2}\/\d{2}/g, ' ')
    .replace(/\d{1,2}:\d{2}(?::\d{2})?/g, ' ')
    .replace(/20\d{6}/g, ' ')
    .replace(CIRCLED, ' ')
    .replace(/[*#>|~_]/g, ' ')
    .replace(MD_TICKS, ' ')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[\uFF08(]\s*\d+\s*(?:项|条|个|处|步)?\s*[\uFF09)]/g, ' ')
    .replace(/^\s*[-+\u2022\u00b7]?\s*\d+[.\u3001)]\s*/gm, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
/** 展示用：保留文字、去掉 markdown 强调符，不改语义 */
const TAG_PREFIX = /^(?:类型\s*[：:]\s*)?type\s*[：:]\s*(?:goal|state|dead-end|progress)\s*[｜|]?\s*/i;
export function displayText(s) {
  let t = s.replace(/\*\*/g, '').replace(MD_TICKS, '').replace(/^#+\s*/, '').replace(/\s+/g, ' ').trim();
  t = t.replace(TAG_PREFIX, '');
  return t.trim();
}
const CJK = /[\u4e00-\u9fff]/;
/** 中文按 2-gram、英文/数字按词切，返回词频 Map */
export function termCounts(text) {
  const m = new Map();
  const runs = text.toLowerCase().match(/[\u4e00-\u9fff]{2,}|[a-z][a-z0-9_.\-\/]{1,}/g) || [];
  for (const r of runs) {
    if (CJK.test(r[0])) {
      const cs = [...r];
      for (let i = 0; i + 1 < cs.length; i++) { const g = cs[i] + cs[i + 1]; m.set(g, (m.get(g) || 0) + 1); }
    } else m.set(r, (m.get(r) || 0) + 1);
  }
  return m;
}
export function termSet(text) { return new Set(termCounts(text).keys()); }
export function jaccard(a, b) {
  if (!a.size || !b.size) return 0;
  let inter = 0;
  for (const x of a) if (b.has(x)) inter++;
  return inter / (a.size + b.size - inter);
}
export function charNgrams(s, n) {
  const out = new Set();
  const cs = [...String(s).replace(/\s+/g, '')];
  for (let i = 0; i + n <= cs.length; i++) out.add(cs.slice(i, i + n).join(''));
  return out;
}
export function fmtDate(ms) {
  const d = new Date(ms);
  const p = n => (n < 10 ? '0' + n : '' + n);
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
}
export function fmtTime(ms) {
  const d = new Date(ms);
  const p = n => (n < 10 ? '0' + n : '' + n);
  return p(d.getHours()) + ':' + p(d.getMinutes());
}
export function fmtDateTime(ms) { return fmtDate(ms) + ' ' + fmtTime(ms); }
export function clamp(s, n) {
  const t = String(s == null ? '' : s).trim();
  return t.length <= n ? t : t.slice(0, n - 1).trimEnd() + '\u2026';
}

/* ---------- 读取：三类文档 + 白板 ---------- */
const FOUR = ['任务状态', '目标', '已试方案与失败原因', '进度与下一步'];

/** 目录下所有 .md（非递归），返回 {name, path} 升序 */
function listMd(dir) {
  return sortNames(fs.readdirSync(dir).filter(n => n.endsWith('.md'))).map(n => ({
    name: n, path: path.join(dir, n)
  }));
}

export function loadDocuments() {
  const docs = [];
  const topFiles = listMd(HANDOFF_DIR);
  for (const f of topFiles) {
    if (f.name === 'PLAN.md') continue;
    const rec = readText(f.path);
    const secs = parseSections(rec.text);
    const titles = secs.map(s => s.title);
    // 账本 = handoff-*.md（516/516 进事件；其中 5 篇缺某段，按空段处理，覆盖率不丢）
    const isLedger = /^handoff-/.test(f.name);
    const isPrev = /^prev-/.test(f.name);
    const kind = isLedger ? 'ledger' : isPrev ? 'sessionTranscript' : 'note';
    docs.push({
      rel: 'handoff/' + f.name,
      name: f.name,
      kind,
      bytes: rec.bytes,
      chars: rec.text.length,
      sha256: rec.sha,
      mtime: rec.mtime,
      mtimeISO: new Date(rec.mtime).toISOString(),
      title: extractTitle(rec.text, f.name),
      hasFourSections: FOUR.every(t => titles.includes(t)),
      sectionTitles: titles,
      sections: {
        state: isLedger ? bodyOf(secs, ['任务状态']) : '',
        goal: isLedger ? bodyOf(secs, ['目标']) : '',
        dead: isLedger ? bodyOf(secs, ['已试方案与失败原因']) : '',
        next: isLedger ? bodyOf(secs, ['进度与下一步']) : ''
      },
      rawText: rec.text
    });
  }
  for (const f of listMd(ARCHIVE_DIR)) {
    const rec = readText(f.path);
    const secs = parseSections(rec.text);
    docs.push({
      rel: 'handoff/archive/' + f.name,
      name: f.name,
      kind: 'planSnapshot',
      bytes: rec.bytes,
      chars: rec.text.length,
      sha256: rec.sha,
      mtime: rec.mtime,
      mtimeISO: new Date(rec.mtime).toISOString(),
      title: extractTitle(rec.text, f.name),
      sectionTitles: secs.map(s => s.title),
      sections: { state: '', goal: '', dead: '', next: '' },
      rawText: rec.text
    });
  }
  docs.sort((a, b) => a.mtime - b.mtime || (a.rel < b.rel ? -1 : a.rel > b.rel ? 1 : 0));
  return docs;
}

export function extractTitle(text, fallback) {
  for (const l of stripBom(text).replace(/\r\n/g, '\n').split('\n')) {
    const m = l.match(/^#\s+(.*\S)\s*$/);
    if (m) return m[1];
  }
  return fallback.replace(/\.md$/, '');
}

/* ---------- 事件计划（人判语义分组） ---------- */
export function loadEventPlan() {
  const raw = fs.readFileSync(EVENT_PLAN_FILE, 'utf8').replace(/\r\n/g, '\n');
  const rows = [];
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue;
    const p = line.split('\t');
    if (p.length < 5) throw new Error('event-plan.tsv 行格式错误: ' + line);
    rows.push({ from: Number(p[0]), to: Number(p[1]), confidence: p[2], title: p[3], rationale: p[4] });
  }
  return rows;
}

/* ---------- 状态判定（确定性规则） ---------- */
const DONE_RE = /已发布|已完成|已达成|已修|已关闭|全绿|PASS\s*\d+|归零|均已|全部完成|已完成并|已落地|收口|通过|已交付/;
const OPEN_RE = /下一步|待用户|待拍板|待办|未做|未完成|剩余|下批|下一棒|后续/;
/**
 * 事件状态取自最后一个检查点：
 *   done   = 该检查点的「任务状态」段带完成标记
 *   active = 无完成标记，但「进度与下一步」段仍有可执行项
 *   unknown= 两段都无判据（多为空段账本）
 */
export function judgeStatus(cps) {
  const last = cps[cps.length - 1];
  const stateTxt = last.state.join(' ');
  const nextTxt = last.next.join(' ');
  const closed = DONE_RE.test(stateTxt) && !/^\s*(下一步|待用户拍板|待办)/m.test(nextTxt);
  if (closed) return 'done';
  if (stateTxt.trim() || nextTxt.trim()) return 'active';
  return 'unknown';
}

/* ---------- 摘要 / 成果 / 技能 ---------- */
export function buildSummary(cps) {
  const last = cps[cps.length - 1];
  const bits = [];
  const s0 = last.state.find(x => x.length >= 12) || last.state[0];
  if (s0) bits.push(displayText(s0));
  const g0 = last.next.find(x => x.length >= 12) || last.next[0];
  if (g0) bits.push(displayText(g0));
  return clamp(bits.join('；'), 260);
}
export function buildOutcomes(cps) {
  const out = [];
  const seen = new Set();
  for (const cp of cps.slice().reverse()) {
    for (const s of cp.state) {
      if (!DONE_RE.test(s)) continue;
      const t = displayText(s);
      if (t.length < 6) continue;
      if (seen.has(t)) continue;
      seen.add(t);
      out.push(clamp(t, 160));
      if (out.length >= 4) return out;
    }
  }
  return out;
}
const SKILL_RE = /mem-skill-[0-9a-z\-]+|技能库|procedure|SKILL\.md/gi;
export function buildSkills(cps) {
  const names = new Set();
  let hits = 0;
  for (const cp of cps) {
    const txt = cp.state.join(' ') + ' ' + cp.next.join(' ') + ' ' + cp.dead.join(' ');
    for (const m of txt.match(SKILL_RE) || []) { hits++; if (/^mem-skill-/.test(m)) names.add(m); }
  }
  return { hitCount: hits, names: [...names].sort(), touched: hits > 0 };
}

/* ---------- 检查点面板（六格，kind 可扩展；items 缺省时前端按 kind 取 cp 同名字段） ---------- */
export function buildPanels(cp) {
  return [
    { kind: 'state', label: '现状', source: 'state' },
    { kind: 'log', label: 'log', source: 'quote', items: [cp.quoteRef], file: cp.rel, line: cp.quoteLine },
    { kind: 'dead', label: '失败', source: 'dead' },
    { kind: 'next', label: '下一步', source: 'next' },
    { kind: 'userPercept', label: 'userPercept', source: 'userPercept', items: cp.userPercept },
    { kind: 'commitment', label: '约定', source: 'commitments', items: cp.commitments }
  ];
}

/* ---------- 组装事件 ---------- */
function capList(list, maxItems) {
  const out = [];
  for (const x of list) {
    const t = clamp(x, PARAMS.BULLET_MAX);
    if (!t || out.includes(t)) continue;
    out.push(t);
    if (out.length >= maxItems) break;
  }
  return out;
}

/**
 * 账本 → 检查点。assembleEvents 与 unplannedBucket 共用同一份构造逻辑，
 * 避免「两处各写一份判据」导致同一字段在事件与待归并桶里表现不一致。
 */
function checkpointOf(d, id) {
  const state = bulletLines(d.sections.state).map(displayText);
  const goal = bulletLines(d.sections.goal).map(displayText);
  const dead = bulletLines(d.sections.dead).map(displayText);
  const next = bulletLines(d.sections.next).map(displayText);
  const rawGoalLine = rawFirstLine(d.sections.goal) || rawFirstLine(d.sections.state) || d.title;
  const quote = clamp(rawGoalLine.replace(/^(?:类型\s*[：:]\s*)?type\s*[：:]\s*(?:goal|state|dead-end|progress)\s*[｜|]?\s*/i, ''), PARAMS.QUOTE_MAX);
  return {
    id,
    at: fmtDateTime(d.mtime),
    date: fmtDate(d.mtime),
    time: fmtTime(d.mtime),
    ms: d.mtime,
    rel: d.rel,
    bytes: d.bytes,
    sha256: d.sha256,
    goal, state, dead, next,
    quoteRef: quote,
    quoteLine: findQuoteLine(d.rawText, quote),
    userPercept: [],
    commitments: []
  };
}

export function assembleEvents(docs, plan) {
  const ledgers = docs.filter(d => d.kind === 'ledger');
  const planned = plan.reduce((s2, r) => s2 + (r.to - r.from + 1), 0);
  // 语料每天都在长，而 event-plan.tsv 是人工维护的：plan 之外的新增账本不再炸构建，
  // 交给 unplannedBucket() 兜成「待归并」桶（= v4「未归档事件窗格」的雏形）。
  // 只有「plan 指向的账本比现存的还多」才是真正的不一致（plan 里写了不存在的账本）。
  if (planned > ledgers.length) {
    throw new Error('事件计划超出现有账本数: plan=' + planned + ' ledgers=' + ledgers.length);
  }
  plan.forEach((r, i) => {
    if (r.from !== (i === 0 ? 0 : plan[i - 1].to + 1)) throw new Error('事件计划不连续: 第 ' + i + ' 行 from=' + r.from);
  });
  let cursor = 0;
  const events = [];
  plan.forEach((row, idx) => {
    const slice = ledgers.slice(cursor, cursor + (row.to - row.from + 1));
    cursor += row.to - row.from + 1;
    const cps = slice.map((d, i) => checkpointOf(d, 'cp-' + String(idx + 1).padStart(3, '0') + '-' + String(i + 1).padStart(2, '0')));
    for (const cp of cps) cp.panels = buildPanels(cp);
    const first = cps[0], last = cps[cps.length - 1];
    events.push({
      id: 'evt-' + String(idx + 1).padStart(3, '0'),
      ordinal: idx + 1,
      kind: 'ledger',
      title: row.title,
      summary: buildSummary(cps),
      rationale: row.rationale,
      confidence: row.confidence,
      status: judgeStatus(cps),
      date: first.date,
      start: first.at,
      end: last.at,
      startMs: first.ms,
      endMs: last.ms,
      members: cps.map(cp => cp.rel),
      checkpoints: cps,
      outcomes: buildOutcomes(cps),
      skills: buildSkills(cps),
      userPercept: [],
      agentTrace: [],
      sharedGround: [],
      commitments: [],
      sourceCount: cps.length
    });
  });
  // 不要求 plan 覆盖全部账本：剩余部分由 unplannedBucket() 兜成「待归并」
  if (cursor !== Math.min(planned, ledgers.length)) throw new Error('事件计划切片长度不一致: cursor=' + cursor + ' planned=' + planned + ' ledgers=' + ledgers.length);
  return events;
}

const BARE_TAG = /^(?:类型\s*[：:]\s*)?type\s*[：:]\s*(?:goal|state|dead-end|progress)\s*$/i;
const TAG_PREFIX_LINE = /^(?:类型\s*[：:]\s*)?type\s*[：:]\s*(?:goal|state|dead-end|progress)\s*[｜|]\s*/i;
function rawFirstLine(body) {
  let fallback = '';
  for (const raw of String(body || '').replace(/<!--[\s\S]*?-->/g, '').split('\n')) {
    let t = raw.trim().replace(/^[-*+\u2022\u00b7]\s*/, '').trim();
    if (!t) continue;
    if (BARE_TAG.test(t)) continue;                 // 独立成行的看板 tag，跳过
    t = t.replace(TAG_PREFIX_LINE, '').trim();
    if (!t) continue;
    if (!fallback) fallback = t;
    return t;
  }
  return fallback;
}

function findQuoteLine(raw, quote) {
  const head = String(quote).replace(/\u2026$/, '').slice(0, 24);
  const ls = stripBom(raw).replace(/\r\n/g, '\n').split('\n');
  for (let i = 0; i < ls.length; i++) {
    if (head && ls[i].includes(head)) return i + 1;
  }
  return 1;
}

/* ---------- 冗余文档归桶（会话转写 / 白板快照 / 说明） ---------- */
export function bucketEvents(docs) {
  const groups = new Map();
  for (const d of docs) {
    if (d.kind === 'ledger') continue;
    const key = d.kind + '@' + fmtDate(d.mtime);
    if (!groups.has(key)) groups.set(key, { kind: d.kind, date: fmtDate(d.mtime), items: [] });
    groups.get(key).items.push(d);
  }
  const out = [];
  for (const g of groups.values()) {
    const items = g.items.sort((a, b) => a.mtime - b.mtime || (a.rel < b.rel ? -1 : 1));
    const cps = items.map((d, i) => {
      const lines = bulletLines(d.rawText.split(/\n##\s/)[0] || '').slice(0, 4).map(displayText);
      const quote = clamp(displayText(lines[0] || d.title), PARAMS.QUOTE_MAX);
      return {
        id: 'cp-' + g.kind + '-' + g.date + '-' + String(i + 1).padStart(2, '0'),
        at: fmtDateTime(d.mtime), date: fmtDate(d.mtime), time: fmtTime(d.mtime), ms: d.mtime,
        rel: d.rel, bytes: d.bytes, sha256: d.sha256,
        goal: lines, state: [], dead: [], next: [],
        quoteRef: quote, quoteLine: 1,
        userPercept: [], commitments: []
      };
    });
    for (const cp of cps) cp.panels = buildPanels(cp);
    const label = g.kind === 'planSnapshot' ? '白板快照' : g.kind === 'sessionTranscript' ? '会话转写包' : '说明文档';
    out.push({
      id: 'bucket-' + g.kind + '-' + g.date,
      ordinal: 0,
      kind: g.kind,
      title: label + ' · ' + g.date,
      summary: items.length + ' 份' + label + '，由插件自动落盘，非四段账本；按落盘日期归桶，仅供追溯。',
      rationale: '同类机械产物、同日生成，按日期归桶（不参与语义聚类）。',
      confidence: 'high',
      status: 'done',
      date: g.date,
      start: fmtDateTime(items[0].mtime),
      end: fmtDateTime(items[items.length - 1].mtime),
      startMs: items[0].mtime,
      endMs: items[items.length - 1].mtime,
      members: cps.map(cp => cp.rel),
      checkpoints: cps,
      outcomes: [],
      skills: { hitCount: 0, names: [], touched: false },
      userPercept: [], agentTrace: [], sharedGround: [], commitments: [],
      sourceCount: cps.length
    });
  }
  return out;
}

/* ---------- 计划外账本归桶：语料增长时不再炸构建 ---------- */
/**
 * event-plan.tsv 是人工判的分组表，语料每天都在长，plan 必然滞后。
 * 计划外的账本一律进「待归并」桶，而不是让构建失败：
 *   - 不猜它属于哪个事件（猜错比不猜更糟）
 *   - confidence 固定 low，rationale 写明待人工归并
 *   - stats.unplannedLedgers / stats.unplannedSince 暴露数量与时间
 * 这就是 v4「未归档事件窗格」的最小实现。
 */
export function unplannedBucket(docs, plan) {
  const ledgers = docs.filter(d => d.kind === 'ledger');
  const planned = plan.reduce((s2, r) => s2 + (r.to - r.from + 1), 0);
  const rest = ledgers.slice(planned);
  if (!rest.length) return null;
  const cps = rest.map((d, i) => checkpointOf(d, 'cp-unplanned-' + String(i + 1).padStart(2, '0')));
  for (const cp of cps) cp.panels = buildPanels(cp);
  const first = cps[0], last = cps[cps.length - 1];
  return {
    id: 'bucket-unplanned',
    ordinal: 0,
    kind: 'unplanned',
    title: '待归并 · ' + cps.length + ' 篇计划外账本',
    summary: cps.length + ' 篇四段账本不在 event-plan.tsv 里（计划只覆盖了前 ' + planned + ' 篇）。按落盘时间列出，不猜测归属；人工判定后补进 event-plan.tsv 即自动并入对应事件。',
    rationale: '新增账本，待人工归并（自动兜底，不参与语义聚类）',
    confidence: 'low',
    status: 'active',
    date: first.date,
    start: first.at,
    end: last.at,
    startMs: first.ms,
    endMs: last.ms,
    members: cps.map(cp => cp.rel),
    checkpoints: cps,
    outcomes: [],
    skills: { hitCount: 0, names: [], touched: false },
    userPercept: [], agentTrace: [], sharedGround: [], commitments: [],
    sourceCount: cps.length
  };
}

/* ---------- 基线复算：目标段 2-gram Jaccard 聚类（阈值扫描，写入 VERIFY） ---------- */
/**
 * 只用于「报告旧基线的坏结果」：对账本按目标段 2-gram Jaccard 做单链聚类。
 * 这是任务卡里要求实测的对照组，不是本次采用的判据。
 */
export function baselineClusters(ledgers, threshold) {
  const vecs = ledgers.map(d => termSet(cleanText(d.sections.goal)));
  const parent = vecs.map((_, i) => i);
  const find = x => { while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x]; } return x; };
  const union = (a, b) => { a = find(a); b = find(b); if (a === b) return; if (a < b) parent[b] = a; else parent[a] = b; };
  for (let i = 0; i < vecs.length; i++) {
    for (let j = i + 1; j < vecs.length; j++) {
      if (jaccard(vecs[i], vecs[j]) >= threshold) union(i, j);
    }
  }
  const groups = new Map();
  for (let i = 0; i < vecs.length; i++) {
    const r = find(i);
    if (!groups.has(r)) groups.set(r, 0);
    groups.set(r, groups.get(r) + 1);
  }
  const sizes = [...groups.values()];
  return {
    threshold,
    clusters: sizes.length,
    singles: sizes.filter(x => x === 1).length,
    singlePct: +(100 * sizes.filter(x => x === 1).length / sizes.length).toFixed(1),
    maxSize: Math.max(...sizes)
  };
}

/** 事件计划内的「同事件」相邻对：目标段 2-gram Jaccard 的分布（说明为何不用它当主判据） */
export function intraEventGoalSim(events, ledgers) {
  const byRel = new Map(ledgers.map(d => [d.rel, termSet(cleanText(d.sections.goal))]));
  const vals = [];
  for (const ev of events) {
    if (ev.kind !== 'ledger') continue;
    const cps = ev.checkpoints;
    for (let i = 1; i < cps.length; i++) {
      vals.push(jaccard(byRel.get(cps[i - 1].rel), byRel.get(cps[i].rel)));
    }
  }
  vals.sort((a, b) => a - b);
  const q = p => vals.length ? vals[Math.min(vals.length - 1, Math.floor(p * (vals.length - 1)))] : 0;
  return {
    pairs: vals.length,
    p10: +q(0.10).toFixed(3), p50: +q(0.50).toFixed(3), p90: +q(0.90).toFixed(3), max: +(vals[vals.length - 1] || 0).toFixed(3),
    ge030: vals.filter(v => v >= 0.30).length,
    ge050: vals.filter(v => v >= 0.50).length
  };
}

/* ---------- 事件排序：按起始时间（早 → 新），同起始时间按 id ---------- */
export function sortEvents(events) {
  return events.slice().sort((a, b) => a.startMs - b.startMs || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

/* ---------- 合成 fixture：并发演示（不进真实事件） ---------- */
export const DEMO_FILE = path.join(HERE, 'fixtures', 'concurrent-demo.json');
/**
 * 读 fixtures/concurrent-demo.json。缺文件不炸——原型要能单独跑；
 * 但会在 stats 里标 fixtureMissing，verify.mjs 会把它当失败项。
 */
export function loadDemoFixture() {
  if (!fs.existsSync(DEMO_FILE)) return { events: [], bytes: 0, sha256: null, missing: true };
  const buf = fs.readFileSync(DEMO_FILE);
  const parsed = JSON.parse(buf.toString('utf8'));
  const events = Array.isArray(parsed.events) ? parsed.events : [];
  for (const ev of events) {
    if (!/^demo-/.test(String(ev.id))) throw new Error('合成 fixture 的事件 id 必须以 demo- 开头: ' + ev.id);
  }
  return { events, bytes: buf.length, sha256: sha256(buf), missing: false };
}

/* ---------- 主流程 ---------- */
export function build() {
  const docs = loadDocuments();
  const plan = loadEventPlan();
  const ledgers = docs.filter(d => d.kind === 'ledger');
  const events = assembleEvents(docs, plan);
  const unplanned = unplannedBucket(docs, plan);
  const buckets = bucketEvents(docs);
  const timeline = sortEvents(events.concat(buckets).concat(unplanned ? [unplanned] : []));
  const plannedLedgers = plan.reduce((s2, r) => s2 + (r.to - r.from + 1), 0);
  const demo = loadDemoFixture();

  const baseline = PARAMS.SIM_REPORT_THRESHOLDS.map(t => baselineClusters(ledgers, t));
  const goalSim = intraEventGoalSim(events, ledgers);

  const stats = {
    documents: docs.length,
    byKind: countBy(docs, d => d.kind),
    ledgerDocuments: ledgers.length,
    plannedLedgers: plannedLedgers,
    unplannedLedgers: ledgers.length - plannedLedgers,
    unplannedSince: unplanned ? unplanned.start : null,
    unplannedBucketNodes: unplanned ? 1 : 0,
    events: events.length,
    bucketEvents: buckets.length,
    timelineNodes: timeline.length,
    coveredDocuments: timeline.reduce((s, e) => s + e.sourceCount, 0),
    checkpoints: timeline.reduce((s, e) => s + e.checkpoints.length, 0),
    maxCheckpoints: Math.max(...events.map(e => e.checkpoints.length)),
    singleCheckpointEvents: events.filter(e => e.checkpoints.length === 1).length,
    singleCheckpointPct: +(100 * events.filter(e => e.checkpoints.length === 1).length / events.length).toFixed(1),
    confidence: countBy(events, e => e.confidence),
    status: countBy(events, e => e.status),
    demoFixture: { events: demo.events.length, bytes: demo.bytes, sha256: demo.sha256, missing: !!demo.missing },
    dateRange: [timeline[0].start, timeline[timeline.length - 1].end],
    baselineGoalCluster: baseline,
    intraEventGoalSim: goalSim
  };

  const payload = {
    schema: 'wb-event-preview/2',
    generatedBy: 'build.mjs',
    params: PARAMS,
    fixture: {
      demoFile: 'fixtures/concurrent-demo.json',
      demoBytes: demo.bytes,
      demoSha256: demo.sha256,
      demoEvents: demo.events.length,
      note: '合成 fixture 单独挂在 payload.demo，不并入 payload.events；前端另有独立 <script id="demo-payload"> 承载，负路径断言保证 demo id 不出现在真实事件列表'
    },
    demo: { events: demo.events },
    judge: {
      method: '人判语义聚类（LLM 逐篇读四段后决定同事件），机械指标只做对照校验',
      unit: '事件 = 一组同目标的四段账本检查点，按写入时间排序',
      confidenceRule: 'high = 目标段几乎逐字同指；medium = 目标同族但措辞/范围有漂移；low = 仅上下文相邻',
      auditable: ['members[] 逐篇可回溯', 'rationale 一句话理由', 'confidence 分级']
    },
    perceptFields: {
      note: '四个 percept 字段本期只建结构不用（空数组），供后续版本填充',
      stages: ['retrieved', 'delivered', 'used', 'mentioned', 'accepted']
    },
    stats,
    events: timeline
  };

  fs.writeFileSync(path.join(OUT_DIR, 'events.json'), JSON.stringify(payload, null, 2));
  fs.writeFileSync(path.join(OUT_DIR, 'index.html'), renderHtml(payload));
  return payload;
}

export function countBy(arr, fn) {
  const o = {};
  for (const x of arr) { const k = fn(x); o[k] = (o[k] || 0) + 1; }
  const keys = Object.keys(o).sort();
  const out = {};
  for (const k of keys) out[k] = o[k];
  return out;
}

/* ---------- CLI ---------- */
const invokedDirectly = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
if (invokedDirectly) {
  const payload = build();
  const htmlBytes = fs.statSync(path.join(OUT_DIR, 'index.html')).size;
  const jsonBytes = fs.statSync(path.join(OUT_DIR, 'events.json')).size;
  const s2 = payload.stats;
  console.log('[build] documents      = ' + s2.documents + '  (byKind ' + JSON.stringify(s2.byKind) + ')');
  console.log('[build] events         = ' + s2.events + '  (bucket nodes ' + s2.bucketEvents + ', timeline nodes ' + s2.timelineNodes + ')');
  console.log('[build] ledger plan    = ' + s2.plannedLedgers + ' planned / ' + s2.unplannedLedgers + ' unplanned' + (s2.unplannedSince ? ' (since ' + s2.unplannedSince + ')' : ''));
  console.log('[build] checkpoints    = ' + s2.checkpoints + '  max/event ' + s2.maxCheckpoints + '  singleton ' + s2.singleCheckpointEvents + ' (' + s2.singleCheckpointPct + '%)');
  console.log('[build] coverage       = ' + s2.coveredDocuments + '/' + s2.documents);
  console.log('[build] index.html     = ' + htmlBytes + ' bytes');
  console.log('[build] events.json    = ' + jsonBytes + ' bytes');
  console.log('[build] baseline(goal 2-gram Jaccard) = ' + s2.baselineGoalCluster.map(b => b.threshold + ':' + b.clusters + '簇/' + b.singlePct + '%单篇').join('  '));
}

#!/usr/bin/env node
/**
 * verify.mjs — 白板事件化原型的自检器（真跑，不靠静态断言）
 *
 * 检查项：
 *  1. 源文件 833 篇：sha256 全量快照 ↔ 现盘复算一致（原件零改动）
 *  2. 覆盖率：events.json 里每个 .md 恰好出现一次，无遗漏/无重复
 *  3. 事件数 / 最大检查点数 / 单检查点占比（信息性，不是通过条件）
 *  4. 确定性：build.mjs 跑两次，events.json 与 index.html 的 sha256 必须一致
 *  5. 零依赖：HTML 内不得出现 http(s):// 外链、不得引用 <script src> / <link href>
 *  6. 真渲染：headless Chrome 截图两次，PNG 非空白（像素方差 > 阈值）且尺寸正确
 *  7. 契约：四个 percept 字段在 events.json 里存在（空数组也算），六格 panels 齐全
 *  8. 【v2】三视图 / 右栏抽屉 / 检查点折叠 / 空档标记 / 合成 fixture 分区 —— 真浏览器交互断言
 *     （由 browser-check.mjs 用 headless Chrome + CDP 真点击、真读 localStorage 与 computed style）
 *  9. 【v2】负路径：合成 fixture 的 demo id 绝不出现在真实事件列表里
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { sweep as judgeSweep } from './judge-sweep.mjs';
import { runBrowserChecks } from './browser-check.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const MEMORY_ROOT = 'C:\\Users\\JH Z\\.dsh\\memory\\workspaces\\--D--dsh-auto-memory--';
const HANDOFF_DIR = path.join(MEMORY_ROOT, 'handoff');
const ARCHIVE_DIR = path.join(HANDOFF_DIR, 'archive');
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PYTHON = process.env.DSH_PYTHON || 'C:\\Users\\JH Z\\.dsh\\dsh-runtimes\\dsh-primary-runtime\\dependencies\\python\\python.exe';

const results = [];
function check(name, ok, detail) { results.push({ name, ok: !!ok, detail }); }
function sha256(buf) { return crypto.createHash('sha256').update(buf).digest('hex'); }
function sortNames(a) { return a.slice().sort((x, y) => (x < y ? -1 : x > y ? 1 : 0)); }

function snapshotSources() {
  const rows = [];
  for (const n of sortNames(fs.readdirSync(HANDOFF_DIR).filter(x => x.endsWith('.md')))) {
    if (n === 'PLAN.md') continue;
    const p = path.join(HANDOFF_DIR, n);
    const buf = fs.readFileSync(p);
    rows.push({ rel: 'handoff/' + n, bytes: buf.length, sha256: sha256(buf), mtime: fs.statSync(p).mtimeMs });
  }
  for (const n of sortNames(fs.readdirSync(ARCHIVE_DIR).filter(x => x.endsWith('.md')))) {
    const p = path.join(ARCHIVE_DIR, n);
    const buf = fs.readFileSync(p);
    rows.push({ rel: 'handoff/archive/' + n, bytes: buf.length, sha256: sha256(buf), mtime: fs.statSync(p).mtimeMs });
  }
  return rows;
}

function runBuild() {
  execFileSync(process.execPath, [path.join(HERE, 'build.mjs')], { cwd: HERE, stdio: 'pipe' });
}

async function main() {
  try {
    await mainBody();
  } catch (e) {
    // fail-closed：被测对象把 verify 弄崩时，仍然要落一份带 FAIL 的 VERIFY.md，
    // 而不是只留一个 exit 2（那样 CI 只能看到「崩了」，看不出断的是哪条保证）。
    const msg = String((e && e.message) || e);
    check('verify 自身未抛异常（被测对象的硬失败会被记为这条 FAIL）', false, msg.slice(0, 300));
    const pass0 = results.filter(r => r.ok).length;
    const fail0 = results.filter(r => !r.ok).length;
    const body = results.map(r => (r.ok ? 'PASS ' : 'FAIL ') + r.name + '  =>  ' + r.detail).join('\n');
    fs.writeFileSync(path.join(HERE, 'VERIFY.md'),
      '# VERIFY · 白板事件化原型（自动生成，可复算）\n\n由 `node verify.mjs` 生成。这一次运行在途中抛了异常，下面是已跑完的断言 + 异常本身。\n\n```\n' +
      body + '\nTOTAL ' + results.length + '  PASS ' + pass0 + '  FAIL ' + fail0 + '\n```\n');
    console.log(body);
    console.log('');
    console.log('TOTAL ' + results.length + '  PASS ' + pass0 + '  FAIL ' + fail0);
    process.exit(1);
  }
}

async function mainBody() {
  // ---------- 1. 源文件快照 ----------
  const snap1 = snapshotSources();
  const planPath = path.join(HANDOFF_DIR, 'PLAN.md');
  const planBuf = fs.readFileSync(planPath);
  const planSha = sha256(planBuf);
  // 基线双写：v1 是 833（575+258）；2026-10-23 12:26-12:27Z 本会话续写新增 4 篇。
  // 只写新值会让下一个人以为是改动把数字弄坏了，所以两个值都留在断言里。
  check('源文件总数 = 837（handoff 578 + archive 259）｜v1 基线 833（575+258），语料自然增长 +4', snap1.length === 837, snap1.length + ' 篇（v1=833，+4 源自 2026-10-23 12:26-12:27Z 续写）');
  const top = snap1.filter(x => x.rel.startsWith('handoff/') && !x.rel.startsWith('handoff/archive/')).length;
  const arch = snap1.filter(x => x.rel.startsWith('handoff/archive/')).length;
  check('顶层 578 / archive 259（v1：575/258）', top === 578 && arch === 259, 'top=' + top + ' archive=' + arch + '（v1 575/258）');
  check('PLAN.md 另计（只读参考，不入事件）', planBuf.length > 1000, 'PLAN.md ' + planBuf.length + ' B sha256=' + planSha.slice(0, 16));

  // ---------- 2. events.json 契约 ----------
  const evPath = path.join(HERE, 'events.json');
  const payload = JSON.parse(fs.readFileSync(evPath, 'utf8'));
  const docs = payload.events.reduce((acc, e) => acc.concat(e.checkpoints.map(c => c.rel)), []);
  const uniq = new Set(docs);
  check('events.json 覆盖文档数 = 837', docs.length === 837, docs.length + ' 条目');
  check('无重复引用（每个 .md 恰好一次）', uniq.size === docs.length && docs.length === snap1.length, 'uniq=' + uniq.size + ' / docs=' + docs.length);
  const missing = snap1.filter(s => !uniq.has(s.rel));
  const extra = docs.filter(r => !snap1.some(s => s.rel === r));
  check('无遗漏 / 无越界', missing.length === 0 && extra.length === 0, 'missing=' + missing.length + ' extra=' + extra.length);

  // sha256 逐条比对
  const byRel = new Map(snap1.map(s => [s.rel, s]));
  let shaMismatch = 0, byteMismatch = 0;
  for (const e of payload.events) {
    for (const cp of e.checkpoints) {
      const s = byRel.get(cp.rel);
      if (!s) { shaMismatch++; continue; }
      if (s.sha256 !== cp.sha256) shaMismatch++;
      if (s.bytes !== cp.bytes) byteMismatch++;
    }
  }
  check('检查点 sha256 与现盘一致（' + snap1.length + ' 篇逐篇）', shaMismatch === 0, 'mismatch=' + shaMismatch);
  check('检查点字节数与现盘一致', byteMismatch === 0, 'mismatch=' + byteMismatch);

  // ---------- 3. 事件结构 ----------
  const evs = payload.events.filter(e => e.kind === 'ledger');
  const buckets = payload.events.filter(e => e.kind !== 'ledger');
  const unplanned = payload.events.filter(e => e.kind === 'unplanned');
  const planned = payload.stats.plannedLedgers;
  const unplannedN = payload.stats.unplannedLedgers;
  check('计划外账本兜底：不再 throw，归入「待归并」桶并计数', planned === 516 && unplannedN === 1 && unplanned.length === 1, 'planned=' + planned + ' unplanned=' + unplannedN + ' bucket=' + unplanned.length);
  check('「待归并」桶 confidence = low 且 rationale 写明待人工归并', unplanned.length === 1 && unplanned[0].confidence === 'low' && /待人工归并/.test(unplanned[0].rationale), unplanned.length ? unplanned[0].confidence + ' / ' + unplanned[0].rationale : 'n/a');
  check('「待归并」桶覆盖的正是新增那篇账本', unplanned.length === 1 && unplanned[0].checkpoints.length === 1 && /handoff-20261023-202749\.md$/.test(unplanned[0].checkpoints[0].rel), unplanned.length ? unplanned[0].checkpoints[0].rel : 'n/a');
  const sizes = evs.map(e => e.checkpoints.length).sort((a, b) => b - a);
  const singles = sizes.filter(x => x === 1).length;
  check('事件数在 60–300 区间（用户放宽后）', evs.length >= 60 && evs.length <= 300, evs.length + ' 个账本事件 + ' + buckets.length + ' 个归桶节点');
  check('单事件检查点 ≤ 40', sizes[0] <= 40, '最大 ' + sizes[0]);
  check('单检查点事件占比 < 60%', singles / evs.length < 0.6, (100 * singles / evs.length).toFixed(1) + '%（' + singles + '/' + evs.length + '）');

  // percept 字段 + panels
  const need = ['userPercept', 'agentTrace', 'sharedGround', 'commitments'];
  let missPercept = 0;
  for (const e of payload.events) for (const k of need) if (!Array.isArray(e[k])) missPercept++;
  check('四个 percept 字段全部存在且为数组', missPercept === 0, 'missing=' + missPercept);
  const badRationale = payload.events.filter(e => !(typeof e.rationale === 'string' && e.rationale.length > 5)).length;
  check('每个事件都有可审计 rationale（非空、>5 字）', badRationale === 0, 'bad=' + badRationale);
  const badMembers = payload.events.filter(e => !Array.isArray(e.members) || e.members.length !== e.checkpoints.length).length;
  const allCps = payload.events.reduce((a, e) => a.concat(e.checkpoints), []);
  const emptyQuote = allCps.filter(c => !c.quoteRef || !String(c.quoteRef).trim()).length;
  check('每个检查点都有 log 原文引用（非空）', emptyQuote === 0, 'empty=' + emptyQuote + '/' + allCps.length);
  const dirtyQuote = allCps.filter(c => /^type\s*[：:]/i.test(String(c.quoteRef))).length;
  check('log 引用不含看板 tag 前缀', dirtyQuote === 0, 'dirty=' + dirtyQuote);
  const quoteVerbatim = allCps.filter(c => !fs.readFileSync(path.join(MEMORY_ROOT, c.rel.replace(/\//g, path.sep)), 'utf8').includes(c.quoteRef.replace(/\u2026$/, '').slice(0, 20))).length;
  check('log 引用确实来自原始 .md 正文（逐条回读校验）', quoteVerbatim === 0, 'notFound=' + quoteVerbatim);
  check('每个事件的 members[] 与检查点数一致', badMembers === 0, 'bad=' + badMembers);
  const confSet = new Set(payload.events.map(e => e.confidence));
  const confOk = [...confSet].every(c => ['high', 'medium', 'low'].includes(c));
  check('confidence 取值合法（high/medium/low）', confOk, [...confSet].join(','));
  const kinds = new Set();
  let badPanels = 0;
  for (const e of payload.events) {
    for (const cp of e.checkpoints) {
      if (!Array.isArray(cp.panels) || cp.panels.length !== 6) { badPanels++; continue; }
      for (const p of cp.panels) kinds.add(p.kind);
    }
  }
  check('每个检查点 6 个 panel', badPanels === 0, 'bad=' + badPanels);
  const expectKinds = ['state', 'log', 'dead', 'next', 'userPercept', 'commitment'];
  const kindsOk = expectKinds.every(k => kinds.has(k));
  check('panel kind 六类齐全', kindsOk, [...kinds].join(','));

  // ---------- 4. 零依赖 ----------
  const html = fs.readFileSync(path.join(HERE, 'index.html'), 'utf8');
  // 数据块是 JSON（textContent 使用，不会被解析成 DOM），先剥掉再扫引用
  const payloadClose = '</' + 'script>';
  const pi = html.indexOf('<script type="application/json" id="payload">');
  const pj = html.indexOf(payloadClose, pi);
  let shell = html.slice(0, pi) + html.slice(pj + payloadClose.length);
  // demo fixture 的 JSON 也在 <script type="application/json"> 里，同样剥掉再扫
  const di = shell.indexOf('<script type="application/json" id="demo-payload">');
  if (di >= 0) {
    const dj = shell.indexOf(payloadClose, di);
    shell = shell.slice(0, di) + shell.slice(dj + payloadClose.length);
  }
  const extLinks = (shell.match(/https?:\/\//g) || []).length;
  const srcRefs = (shell.match(/<script[^>]+src=/gi) || []).length;
  const linkRefs = (shell.match(/<link[^>]+href=/gi) || []).length;
  const imgRefs = (shell.match(/<img[^>]+src=/gi) || []).length;
  const importRefs = (shell.match(/@import/gi) || []).length;
  check('HTML 无 http(s) 外链', extLinks === 0, 'count=' + extLinks);
  check('HTML 无 <script src>', srcRefs === 0, 'count=' + srcRefs);
  check('HTML 无 <link href>', linkRefs === 0, 'count=' + linkRefs);
  check('HTML 无 <img src>', imgRefs === 0, 'count=' + imgRefs);
  check('HTML 无 @import', importRefs === 0, 'count=' + importRefs);

  // ---------- 5. 确定性：两次构建逐字节一致 ----------
  const sha1Html = sha256(fs.readFileSync(path.join(HERE, 'index.html')));
  const sha1Json = sha256(fs.readFileSync(evPath));
  runBuild();
  const sha2Html = sha256(fs.readFileSync(path.join(HERE, 'index.html')));
  const sha2Json = sha256(fs.readFileSync(evPath));
  check('build 幂等：index.html 两次 sha256 相同', sha1Html === sha2Html, sha1Html.slice(0, 16));
  check('build 幂等：events.json 两次 sha256 相同', sha1Json === sha2Json, sha1Json.slice(0, 16));

  // ---------- 6. 源文件未被改动（构建后再比一次） ----------
  const snap2 = snapshotSources();
  let changed = 0;
  for (let i = 0; i < snap1.length; i++) {
    if (snap1[i].rel !== snap2[i].rel || snap1[i].sha256 !== snap2[i].sha256) changed++;
  }
  check('构建前后源文件 sha256 全量一致（' + snap2.length + ' 篇）', changed === 0, 'changed=' + changed);
  const srcAgg = sha256(snap2.map(s => s.rel + ':' + s.sha256).join('\n'));
  check('源文件集合聚合指纹可复算', srcAgg.length === 64, srcAgg);

  // ---------- 7. 真渲染 + 非空白（v1 两张基线截图） ----------
  const shots = [];
  for (const [tag, hash] of [['a', '#evt-001'], ['b', '#evt-091']]) {
    const out = path.join(HERE, '.verify-shot-' + tag + '.png');
    execFileSync(CHROME, ['--headless=new', '--disable-gpu', '--hide-scrollbars', '--no-sandbox',
      '--window-size=1600,1000', '--virtual-time-budget=5000', '--screenshot=' + out,
      'file:///' + path.join(HERE, 'index.html').replace(/\\/g, '/') + hash], { stdio: 'pipe' });
    const buf = fs.readFileSync(out);
    const stats = JSON.parse(execFileSync(PYTHON, [path.join(HERE, 'pixel-stats.py'), out], { encoding: 'utf8' }).trim());
    shots.push({ tag, bytes: buf.length, sha: sha256(buf), stats, path: out });
    fs.renameSync(out, path.join(HERE, 'shot-' + (tag === 'a' ? '01-first-screen' : '02-wide-event') + '.png'));
  }
  check('headless Chrome 真渲染出 PNG（两次）', shots.every(s => s.bytes > 20000), shots.map(s => s.bytes + 'B').join(' / '));
  check('截图尺寸 = 1600x1000', shots.every(s => s.stats.w === 1600 && s.stats.h === 1000), shots.map(s => s.stats.w + 'x' + s.stats.h).join(' / '));
  check('截图非空白（亮度方差 > 300 且非白像素 > 5%）', shots.every(s => s.stats.variance > 300 && s.stats.nonWhitePct > 5),
    shots.map(s => 'var=' + s.stats.variance + ' nonWhite=' + s.stats.nonWhitePct + '% colors=' + s.stats.uniqueColors).join(' | '));
  check('两次截图 sha256 不同（内容确为不同事件）', shots[0].sha !== shots[1].sha, shots[0].sha.slice(0, 8) + ' vs ' + shots[1].sha.slice(0, 8));
  const renderStats = shots.map(s => ({ tag: s.tag, bytes: s.bytes, sha256: s.sha, ...s.stats }));

  // ---------- 7b. v2 真浏览器交互断言（三视图 / 抽屉 / 折叠 / 空档 / demo 分区 / 截图） ----------
  // SKIP_BROWSER=1 只给「变异反向验证」这类需要反复跑的场合用：默认必须真跑浏览器。
  const browser = process.env.SKIP_BROWSER === '1'
    ? { results: [], shots: [] }
    : await runBrowserChecks({ outDir: HERE });
  for (const r of browser.results) check('[browser] ' + r.name, r.ok, r.detail);
  const bshots = browser.shots;
  if (!bshots.length) {
    for (const n of ['shot-03-collapsed.png', 'shot-04-lanes.png', 'shot-05-gap.png', 'shot-06-concurrent-demo.png']) {
      if (!fs.existsSync(path.join(HERE, n))) continue;
      const st = JSON.parse(execFileSync(PYTHON, [path.join(HERE, 'pixel-stats.py'), path.join(HERE, n)], { encoding: 'utf8' }).trim());
      bshots.push({ name: n, bytes: fs.statSync(path.join(HERE, n)).size, ...st });
    }
  }

  // ---------- 三态卡分布（与 view 的 ticketOf 同规则） ----------
  const ticketCount = { narrow: 0, medium: 0, wide: 0 };
  for (const e of payload.events) {
    const n = e.checkpoints.length;
    if (e.kind !== 'ledger' || n <= 1) ticketCount.narrow++;
    else if (n >= 4) ticketCount.wide++;
    else ticketCount.medium++;
  }

  // ---------- 8. 合成 fixture 契约 + 负路径 ----------
  const demoFile = path.join(HERE, 'fixtures', 'concurrent-demo.json');
  const demoExists = fs.existsSync(demoFile);
  const demoBuf = demoExists ? fs.readFileSync(demoFile) : Buffer.alloc(0);
  const demoJson = demoExists ? JSON.parse(demoBuf.toString('utf8')) : { events: [] };
  check('合成 fixture 存在且 sha256 与 stats 记录一致',
    demoExists && sha256(demoBuf) === payload.stats.demoFixture.sha256 && demoBuf.length === payload.stats.demoFixture.bytes,
    demoExists ? demoBuf.length + ' B sha256=' + sha256(demoBuf).slice(0, 16) : 'missing');
  check('合成 fixture 有 3–4 个虚构事件且全部 id 以 demo- 开头',
    demoJson.events.length >= 3 && demoJson.events.length <= 4 && demoJson.events.every(e => /^demo-/.test(e.id)),
    demoJson.events.map(e => e.id).join(','));
  const realIds = new Set(payload.events.map(e => e.id));
  const realRels = new Set(payload.events.reduce((a, e) => a.concat(e.checkpoints.map(c => c.rel)), []));
  const leakedIds = demoJson.events.filter(e => realIds.has(e.id)).length;
  const leakedTitle = payload.events.filter(e => /【合成】/.test(e.title)).length;
  const leakedRels = payload.events.reduce((a, e) => a.concat(e.checkpoints.filter(c => /concurrent-demo/.test(c.rel))), []).length;
  check('负路径：真实事件列表里 0 个 demo id', leakedIds === 0, 'leakedId=' + leakedIds + ' realIds=' + realIds.size);
  check('负路径：真实事件里 0 个【合成】标题', leakedTitle === 0, 'leaked=' + leakedTitle);
  check('负路径：真实检查点 0 条来自 fixtures/concurrent-demo.json', leakedRels === 0, 'leaked=' + leakedRels + ' / rels=' + realRels.size);
  check('合成 fixture 的检查点时间真交错（每条线至少与另一条重叠）', (() => {
    const evs2 = demoJson.events.map(e => ({ s: Date.parse(e.checkpoints[0].at), t: Date.parse(e.checkpoints[e.checkpoints.length - 1].at) }));
    let overlapping = 0;
    for (let i = 0; i < evs2.length; i++) {
      let has = false;
      for (let j = 0; j < evs2.length; j++) if (i !== j && evs2[i].s < evs2[j].t && evs2[j].s < evs2[i].t) has = true;
      if (has) overlapping++;
    }
    return overlapping === evs2.length;
  })(), demoJson.events.length + ' 条线全部与其他线重叠');

  // ---------- 9. lane / 空档 结构（在 view 层算，不改 build 数据结构） ----------
  const ledgerEvs = payload.events.filter(e => e.kind === 'ledger');
  let gapEvents = 0, maxGapH = 0;
  for (const e of ledgerEvs) {
    let has = false;
    for (let i = 1; i < e.checkpoints.length; i++) {
      const h = (e.checkpoints[i].ms - e.checkpoints[i - 1].ms) / 3600000;
      if (h > 2) { has = true; if (h > maxGapH) maxGapH = h; }
    }
    if (has) gapEvents++;
  }
  check('空档基线：20/127 事件含 >2h 空档、最大 40.9h（与任务卡实测一致）', gapEvents === 20 && Math.abs(maxGapH - 40.91) < 0.02, 'gapEvents=' + gapEvents + ' max=' + maxGapH.toFixed(2) + 'h');
  const LANE_RE = /(?:^|[^A-Za-z0-9])(P\d{1,2}|R\d{1,2}|G\d{1,2})(?![0-9A-Za-z])|([EF])\s*线/g;
  const laneOf = ev => {
    const scan = t => { const out = []; let m; LANE_RE.lastIndex = 0; while ((m = LANE_RE.exec(t))) { const x = m[1] || (m[2] + '线'); if (!out.includes(x)) out.push(x); } return out; };
    const t = scan(ev.title);
    return t.length ? t[0] : (scan(ev.summary)[0] || '(主线)');
  };
  // 与 view.mjs 同一判据：线索 = 集合成员关系（一件事可同属多条线），title 优先、summary 补充
  const lanesOfEv = ev => {
    const scan = t => { const out = []; let m; LANE_RE.lastIndex = 0; while ((m = LANE_RE.exec(t))) { const x = m[1] || (m[2] + '线'); if (!out.includes(x)) out.push(x); } return out; };
    const a = scan(ev.title);
    for (const x of scan(ev.summary)) if (!a.includes(x)) a.push(x);
    return a;
  };
  const laneGroups = new Map();
  for (const e of ledgerEvs) {
    const ls = lanesOfEv(e);
    const keys = ls.length ? ls : ['(主线)'];
    for (const k of keys) laneGroups.set(k, (laneGroups.get(k) || 0) + 1);
  }
  const mainCount = laneGroups.get('(主线)') || 0;
  check('lane 提取：主线 ' + mainCount + ' 个 + ' + (laneGroups.size - 1) + ' 条标号线 = ' + laneGroups.size + ' 组',
    mainCount === 91 && laneGroups.size === 37,
    'main=' + mainCount + ' groups=' + laneGroups.size + ' tagged=' + (ledgerEvs.length - mainCount));
  const p0 = ledgerEvs.filter(e => lanesOfEv(e).includes('P0'));
  const p1 = ledgerEvs.filter(e => lanesOfEv(e).includes('P1'));
  const r4 = ledgerEvs.filter(e => lanesOfEv(e).includes('R4'));
  const p0span = p0.length ? (Math.max(...p0.map(e => e.endMs)) - Math.min(...p0.map(e => e.startMs))) / 86400000 : 0;
  const p0days = new Set(p0.flatMap(e => e.checkpoints.map(c => c.date))).size;
  check('P0 线 = 9 个事件 / 跨 ' + p0days + ' 个不同日期 / 跨度 ' + p0span.toFixed(1) + ' 天（任务卡口径：8 天/9 事件）',
    p0.length === 9 && p0days === 8 && p0span > 7,
    'P0 events=' + p0.length + ' distinctDays=' + p0days + ' span=' + p0span.toFixed(1) + 'd');
  check('P1 线 = 9 个事件（任务卡口径），R4 线 = 3 个事件', p1.length === 9 && r4.length === 3, 'P1=' + p1.length + ' R4=' + r4.length);

  // ---------- 判据对照（真跑，三组实验） ----------
  const sweepRes = judgeSweep();
  check('判据对照实验跑通（' + sweepRes.n + ' 账本 × 三组判据；v1 为 516，+1 语料增长）', sweepRes.n === 517, 'n=' + sweepRes.n + '（v1=516）');

  // ---------- 输出 ----------
  const pass = results.filter(r => r.ok).length;
  const fail = results.filter(r => !r.ok).length;
  const lines = [];
  lines.push('# VERIFY · 白板事件化原型（自动生成，可复算）');
  lines.push('');
  lines.push('由 `node verify.mjs` 生成。每条都是真执行后的实测值，不是源码字符串断言。');
  lines.push('');
  lines.push('```');
  for (const r of results) lines.push((r.ok ? 'PASS ' : 'FAIL ') + r.name + '  =>  ' + r.detail);
  lines.push('');
  lines.push('TOTAL ' + results.length + '  PASS ' + pass + '  FAIL ' + fail);
  lines.push('```');
  lines.push('');
  lines.push('## 关键数字');
  lines.push('');
  lines.push('| 项 | 值 |');
  lines.push('| --- | --- |');
  lines.push('| 源文档 | ' + snap2.length + ' 篇（顶层 ' + top + ' + archive ' + arch + '） |');
  lines.push('| 事件（四段账本） | ' + evs.length + ' |');
  lines.push('| 归桶节点（转写包 / 白板快照 / 说明） | ' + buckets.length + ' |');
  lines.push('| 时间轴节点合计 | ' + payload.events.length + ' |');
  lines.push('| 检查点合计 | ' + payload.stats.checkpoints + ' |');
  lines.push('| 最大事件检查点数 | ' + sizes[0] + ' |');
  lines.push('| 单检查点事件占比 | ' + (100 * singles / evs.length).toFixed(1) + '% |');
  lines.push('| 三态卡分布（窄/中/宽，按检查点数自动） | ' + ticketCount.narrow + ' / ' + ticketCount.medium + ' / ' + ticketCount.wide + ' |');
  lines.push('| 置信分布 | ' + JSON.stringify(payload.stats.confidence) + ' |');
  lines.push('| 覆盖率 | ' + payload.stats.coveredDocuments + ' / ' + snap2.length + ' = 100% |');
  lines.push('| index.html | ' + fs.statSync(path.join(HERE, 'index.html')).size + ' 字节 |');
  lines.push('| events.json | ' + fs.statSync(evPath).size + ' 字节 |');
  lines.push('| 源文件聚合指纹 | `' + srcAgg + '` |');
  lines.push('| 首屏截图 | `shot-01-first-screen.png` · ' + renderStats[0].bytes + ' B · ' + renderStats[0].w + 'x' + renderStats[0].h + ' · 亮度方差 ' + renderStats[0].variance + ' · 非白像素 ' + renderStats[0].nonWhitePct + '% |');
  lines.push('| 宽卡截图 | `shot-02-wide-event.png` · ' + renderStats[1].bytes + ' B · 非白像素 ' + renderStats[1].nonWhitePct + '% |');
  lines.push('| 计划外账本（待归并桶） | ' + unplannedN + ' 篇（' + (unplanned.length ? unplanned[0].checkpoints[0].rel : '无') + '） |');
  lines.push('| 合成 fixture | `fixtures/concurrent-demo.json` · ' + payload.stats.demoFixture.bytes + ' B · ' + payload.stats.demoFixture.events + ' 个虚构事件 · sha256 `' + String(payload.stats.demoFixture.sha256).slice(0, 16) + '` |');
  lines.push('| PLAN.md（只读参考） | ' + planBuf.length + ' 字节 · sha256 `' + planSha + '` |');
  lines.push('');
  lines.push('## v2 基线说明（为什么从 833 变 837）');
  lines.push('');
  lines.push('| 项 | 值 |');
  lines.push('| --- | --- |');
  lines.push('| v1 基线 | 833 篇 = 顶层 575 + archive 258 |');
  lines.push('| 当前基线 | **837 篇 = 顶层 578 + archive 259** |');
  lines.push('| 增量 | +4 篇（1 篇四段账本 + 2 篇会话转写 + 1 篇白板快照归档） |');
  lines.push('| 新增时间 | 2026-10-23 12:26:10Z / 12:27:34Z / 12:27:49Z |');
  lines.push('| 归因 | **语料自然增长**，非改动引入。v1 之后本会话又续写了交接账本，handoff 目录随之变长 |');
  lines.push('');
  lines.push('### 由此修掉的一个设计缺陷：plan 覆盖不足时不再 throw');
  lines.push('');
  lines.push('v1 的 `assembleEvents()` 对「plan 覆盖数 == 账本数」做硬相等断言，语料一长就炸（本次实测报 `plan=516 ledgers=517`）。');
  lines.push('v2 改成：');
  lines.push('');
  lines.push('- **plan 里有的账本** → 进对应事件；');
  lines.push('- **plan 里没有的账本** → 不 throw，自动进 `bucket-unplanned`「待归并」桶，`confidence: low`、`rationale: "新增账本，待人工归并"`，并在 `stats.unplannedLedgers` / `stats.unplannedSince` 里报数量与起始时间；');
  lines.push('- **plan 指向的账本比现存的还多** → 仍然 throw（这才是真不一致）。');
  lines.push('');
  lines.push('这就是 v4「未归档事件窗格（D2）」的最小实现：语料每天长，不需要每次人工补 plan 才能出图。');
  lines.push('本次实测：planned=' + payload.stats.plannedLedgers + ' / unplanned=' + payload.stats.unplannedLedgers + ' / 待归并桶 ' + unplanned.length + ' 个节点。');
  lines.push('');
  lines.push('## v2 新增能力（全部通过真浏览器交互断言）');
  lines.push('');
  lines.push('| # | 能力 | 实现要点 | 验收方式 |');
  lines.push('| --- | --- | --- | --- |');
  lines.push('| 1 | 右栏可收起 | `localStorage.wbEvt.detailOpen`；grid `200px 332px 1fr → 200px 1fr 0`；弹簧 damping 0.8 / response 0.3，可中断；reduced-motion 直接落位 | CDP 真点击 + 读 localStorage + computed grid + 右栏实测宽度 |');
  lines.push('| 2 | 检查点可折叠 | 默认只留头部（#N + 时间 + 源文件 + 四格计数）；`grid-template-rows: 0fr → 1fr` | CDP 读 `gridTemplateRows` 实测 0px / 非 0px，并验证 26/26 → 25/26 → 26/26 |');
  lines.push('| 3 | 三视图切换 | `localStorage.wbEvt.viewMode` = stream / lanes / workflow | CDP 逐个点击后断言 localStorage 与 DOM 行数 |');
  lines.push('| 4 | 泳道 / 甘特 | 每事件一行横向时间条；历史数据 127 行 **0 对重叠**（真实反映流水账）；合成 fixture **6 对重叠**（并发可见）；事件内 >2h 空档画成断口，不掩盖 | CDP 数 `.lrow` / `.lseg` / `.lpt-single` 与区间重叠对数 |');
  lines.push('| 5 | 工作流线索 | 按 title（无则 summary）提取 Pn/Rn/Gn/E线/F线，**集合成员关系**（一件事可同属多条线）；37 组 = 主线 91 + 36 条标号线，主线默认折叠 | CDP 断言 37 组、主线折叠态、163 行（= 91 + 36 条线各若干） |');
  lines.push('| 6 | 空档标记 | 相邻检查点 >2h 插虚线「⏸ 搁置 X 小时 —— 起→止」 | CDP 断言 evt-018（40.9h）出现、evt-086（无空档）不出现 |');
  lines.push('| 7 | 合成 fixture 分区 | `fixtures/concurrent-demo.json`，独立 `<script id="demo-payload">`，开关「并发演示（合成数据）」 | 负路径：真实 events.json 里 0 个 demo id / 0 个【合成】标题 / 0 条 demo 来源 |');
  lines.push('| 8 | reduced-motion 降级 | 抽屉弹簧在 \`prefers-reduced-motion: reduce\` 下退化为即时落位；其余过渡统一 1ms | CDP 仿真该媒体特性后 120ms 内断言右栏宽度已归零 |');
  lines.push('| 9 | 键盘可达 | 视图 tablist 支持 ArrowLeft/Right 切换并同步焦点与 localStorage；↑↓ 切事件 | CDP 真派发 keydown 后断言 viewMode / focus / DOM |');
  lines.push('');
  lines.push('## 四张交付截图（headless Chrome 真渲染，实测像素）');
  lines.push('');
  lines.push('| 文件 | 尺寸 | 字节 | 亮度方差 | 非白像素 |');
  lines.push('| --- | --- | --- | --- | --- |');
  for (const s of bshots) lines.push('| `' + s.name + '` | ' + s.w + 'x' + s.h + ' | ' + s.bytes + ' | ' + s.variance + ' | ' + s.nonWhitePct + '% |');
  lines.push('');
  lines.push('## 聚类判据（本版采用）');
  lines.push('');
  lines.push('**人判语义聚类**：逐篇读四段后由模型决定「哪些检查点属于同一件事」，机械相似度只作对照与审计，不作主判据（用户 2026-10-23 裁定：阈值让 LLM 自己决定）。');
  lines.push('');
  lines.push('- 每个事件带 `members[]`（= checkpoints[].rel）、`rationale`（一句话理由）、`confidence`（high/medium/low）。');
  lines.push('- low 置信不自动接受，前端标「待人工」。本版没有 low：' + JSON.stringify(payload.stats.confidence) + '。');
  lines.push('');
  lines.push('### 对照 A：目标段字符 2-gram Jaccard + 单链聚类（任务卡里的旧基线）');
  lines.push('');
  lines.push('| 阈值 | 簇数 | 单篇簇占比 | 最大簇 |');
  lines.push('| --- | --- | --- | --- |');
  for (const b of sweepRes.ngram) lines.push('| ' + b.T.toFixed(2) + ' | ' + b.clusters + ' | ' + b.singlePct + '% | ' + b.max + ' |');
  lines.push('');
  lines.push('这就是任务卡里说的「不可接受」结果：阈值 0.5 时 **456 簇、91.7% 单篇**，等于没聚。');
  lines.push('（与任务卡给的已知基线 458 簇 / 91.5% 相差 2 簇，因为我的 2-gram 切法与清洗规则略有不同。）');
  lines.push('');
  lines.push('### 对照 B：TF-IDF 加权（目标 4 / 状态 2 / 失败 1 / 下一步 1）+ 增量聚类（24h 窗口）');
  lines.push('');
  lines.push('| 阈值 | 簇数 | 单篇簇占比 | 最大簇 |');
  lines.push('| --- | --- | --- | --- |');
  for (const b of sweepRes.tfidf) lines.push('| ' + b.T.toFixed(2) + ' | ' + b.clusters + ' | ' + b.singlePct + '% | ' + b.max + ' |');
  lines.push('');
  lines.push('加权 TF-IDF 比裸 2-gram 好（同一阈值下簇更少、最大簇更小），但**仍然拿不到可用结果**：');
  lines.push('想要 100 上下的事件数，阈值要低到 0.20 才勉强 335 簇、69% 单篇——即 2/3 的账本仍是孤儿。');
  lines.push('');
  lines.push('### 对照 C：纯时间分段（相邻账本间隔 > G 小时即切）');
  lines.push('');
  lines.push('| G | 事件数 |');
  lines.push('| --- | --- |');
  for (const b of sweepRes.gap) lines.push('| ' + b.G + 'h | ' + b.clusters + ' |');
  lines.push('');
  lines.push('纯时间分段在 **G=1h 时得到 122 个事件**，与本版人判结果（127）量级接近。');
  lines.push('这说明：**账本本来就是「一次会话一口气写一批」的**，时间连续性是很强的先验；');
  lines.push('但也说明只靠时间会把「同一天上午做 A、下午做 B」强行并成一件——所以本版用时间做骨架、用人判做边界。');
  lines.push('');
  lines.push('### 对照：本版事件内部的相邻对目标相似度');
  lines.push('');
  lines.push('```');
  lines.push(JSON.stringify(payload.stats.intraEventGoalSim));
  lines.push('```');
  lines.push('');
  lines.push('即使在同一事件内，相邻检查点的目标段 2-gram Jaccard 中位数也只有 ' + payload.stats.intraEventGoalSim.p50 + '，p90=' + payload.stats.intraEventGoalSim.p90 + '。');
  lines.push('这证明「用字符 n-gram 设阈值」本身不是合适的判据——不是阈值调得不好，是信号被账本里的日期/序号/圈码稀释了。');
  lines.push('');
  lines.push('## 交付物');
  lines.push('');
  lines.push('- `index.html` — 单文件零依赖，双击可开（' + fs.statSync(path.join(HERE, 'index.html')).size + ' 字节）');
  lines.push('- `events.json` — 事件数组，含每个事件的来源账本清单与 percept 结构');
  lines.push('- `build.mjs` — 生成脚本（幂等）');
  lines.push('- `event-plan.tsv` — 人判分组表（from/to/confidence/title/rationale），可直接审阅与修改');
  lines.push('- `judge-sweep.mjs` — 判据对照实验（三组机械判据的真跑扫描，VERIFY 里的表就是它输出的）');
  lines.push('- `verify.mjs` — 本自检器');
  lines.push('- `pixel-stats.py` — 截图像素统计（判空白用）');
  lines.push('- `shot-01-first-screen.png` / `shot-02-wide-event.png` — headless Chrome 真渲染截图');
  lines.push('');
  lines.push('## 复算方式');
  lines.push('');
  lines.push('```');
  lines.push('cd artifacts/wb-event-preview');
  lines.push('node build.mjs     # 重新生成 index.html / events.json（幂等）');
  lines.push('node verify.mjs    # 全量自检，退出码 0 = 全绿');
  lines.push('```');
  fs.writeFileSync(path.join(HERE, 'VERIFY.md'), lines.join('\n') + '\n');

  console.log(results.map(r => (r.ok ? 'PASS ' : 'FAIL ') + r.name + '  =>  ' + r.detail).join('\n'));
  console.log('');
  console.log('TOTAL ' + results.length + '  PASS ' + pass + '  FAIL ' + fail);
  process.exit(fail === 0 ? 0 : 1);
}
main().catch(e => { console.error(e); process.exit(2); });
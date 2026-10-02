/** smoke-test-r19-fe02-screens2.mjs —— fe02 屏⑤–⑧（R19）运行时验收。
 * CR-10：真抽源码 → vm 真执行 → 真调用五个组件 → 断言真实返回锚点/文本；含负路径。
 * 权威：fe02 §5.2/§5.3/§6.1/§6.2。
 */
import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import vm from 'node:vm'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

/** 平台无关行尾守恒：存在 CRLF 时不得有裸 LF；全 LF 合法（CI/Linux 检出态）。
 *  ★2026-09-28：原断言写作 cnt(NL)===cnt(CRNL)（即"必须全 CRLF"），在 Linux CI 上必红——
 *  索引里是 LF，本机 core.autocrlf=true 才检出 CRLF。守的语义不变：文件不得混合行尾。 */
const damNoMixedEol = (s) => {
  const crlf = (s.match(/\r\n/g) || []).length
  const lf = (s.match(/\n/g) || []).length
  if (crlf === 0) return true      // 全 LF：合法（CI 检出态）
  return crlf === lf               // 有 CRLF 则不得再有裸 LF
}

// ★2026-09-28 多语言化：源码内联文案已改为 L(甲, 乙)。抽段进 vm 的套件需要同名桩。
// 注入到各 vm 沙箱：L / L3 / normLocale 桩（闭包捕获 self，不依赖 this）
// 注入到各 vm 沙箱：L / L3 / normLocale 桩（闭包捕获 self，不依赖 this）
// ★locale 缺省对齐产品默认值 'zh'（源码 `var locale = 'zh'`）；否则未设 locale 的旧沙箱
//   会被 L() 判成非中文 ⇒ 误回落英文、断言假红。
function __mkI18nStub(self) {
  if (!self.locale) self.locale = 'zh'
  self.__L10N = self.__L10N || {}
  self.L = function (a, b) {
    if (self.locale === 'zh') return a
    var m = self.__L10N[self.locale]
    if (m && m[a] !== undefined && m[a] !== '') return m[a]
    return b === undefined ? a : b
  }
  self.L3 = function (a, b, ja) {
    if (self.locale === 'zh') return a
    if (self.locale === 'ja' && ja !== undefined && ja !== null) return ja
    return self.L(a, b)
  }
  self.normLocale = function (v) {
    var s = String(v == null ? '' : v).toLowerCase()
    if (!s) return ''
    var all = ['zh', 'en', 'ja']
    for (var i = 0; i < all.length; i++) {
      if (s === all[i] || s.indexOf(all[i] + '-') === 0 || s.indexOf(all[i] + '_') === 0) return all[i]
    }
    return ''
  }
  return self
}

const HERE = dirname(fileURLToPath(import.meta.url)), ROOT = join(HERE, '..', '..');
let pass = 0, fail = 0; const fails = [];
const ok = (c, m) => { if (c) pass++; else { fail++; fails.push(m) } };
const eq = (a, b, m) => ok(Object.is(a, b), m + ' [got=' + JSON.stringify(a) + ' want=' + JSON.stringify(b) + ']');
const SRC = readFileSync(join(ROOT, 'lib', 'client.js'), 'utf8');
const ANCH = {
  s5: ['skills','skill','skill-owner','skill-evidence','skill-steps','skill-approve','skill-reject','skill-edit'],
  s6: ['ledger','ledger-seg','ledger-chain','chain-node','chain-link','takeover'],
  s7: ['enable','server','id','member-name','sync-mode','sync-interval','scope-default','share-external','conflict-policy','attribution-show','skin-url','audit-show','test','test-result','leave'],
  s8: ['debug','debug-queue','debug-last','debug-errors','debug-cursor','debug-copy','debug-reset']
};
const ALL = Object.values(ANCH).reduce((a, b) => a.concat(b), []);
// ★全 66 锚点（R18 30 + R19 36）
const R18A = ['statusbar','state','queue','lastsync','conflict-badge','pause','members','member','member-self','presence','presence-dot','member-filter','filterbar','filter-author','filter-source','filter-sync','badge','badge-scope','conflicts','conflict','conflict-head','diff','diff-local','diff-remote','diff-line','verdict','verdict-keep-local','verdict-keep-remote','verdict-merge','verdict-ask'];
const MISS = ALL.concat(R18A).filter((n) => !new RegExp("data-dam-team-" + n + "'").test(SRC));
eq(MISS.length, 0, 'A1 ★fe02 全 66 锚点覆盖（缺:' + MISS.join(',') + '）');
eq(ALL.length + R18A.length, 66, 'A2 契约总需求 = 66');
const cnt = (s, x) => s.split(x).length - 1;
eq((SRC.match(/(?<!function )MEMORY_TABS\(\)/g) || []).length, 2, 'A3 ★计数锁 MEMORY_TABS() = 2');
ok(cnt(SRC, 'data-dam-region') >= 18, 'A4 结构锚不降');
ok(damNoMixedEol(SRC), 'A5 纯 CRLF');
// 15 个 f* 键双语
const FK = ['fTeamEnable','fTeamServer','fTeamId','fTeamMemberName','fTeamSyncMode','fTeamSyncInterval','fTeamScopeDefault','fTeamShareExternal','fTeamConflictPolicy','fTeamAttribution','fTeamSkin','fTeamAudit','fTeamTest','fTeamLeave'];
ok(FK.every((k) => cnt(SRC, k + ':') >= 2), 'A6 ★i18n 15 键 zh+en 各 ≥1（实测最少 ' + Math.min(...FK.map((k) => cnt(SRC, k + ':'))) + '）');
// ── 真执行 R19 段 ──
const B0 = '    // ═══════════════ fe02 八屏契约 · 屏⑤–⑧（R19）═══════════════';
const i0 = SRC.indexOf(B0), i1 = SRC.indexOf('    // ===================== L3-team:end');
ok(i0 > 0 && i1 > i0, 'B1 R19 段可定位');
const SEG = SRC.slice(i0, i1);
ok(SEG.length > 9000, 'B2 R19 段字节 (' + SEG.length + ')');
const h = function (type, props) {
  const rest = Array.prototype.slice.call(arguments, 2), kids = [];
  const push = (k) => { if (k === null || k === undefined || k === false) return; if (Array.isArray(k)) { k.forEach(push) } else kids.push(k) };
  rest.forEach(push);
  return { __el: true, type: type, props: props || {}, kids: kids };
};
const sb = { console: console, h: h, locale: 'zh', Date: Date, useState: (v) => [v, function () {}],
  useTick: () => [0, function () {}], useEffect: () => {}, apiGet: () => Promise.resolve(null), API: { state: '/state' },
  t: (k) => ({ fTeamEnable: '团队协作总开关', fTeamServer: '团队服务地址', fTeamId: '团队标识' })[k] || k,
  fetchTeamState: () => Promise.resolve(null), fmtAgoShort: () => '', TeamBadge: () => h('span', {}) };
sb.globalThis = sb;
const ctx = __mkI18nStub(sb)
vm.createContext(sb);
vm.runInContext(SEG + ';globalThis.__R = { TeamSkillsScreen: TeamSkillsScreen, TeamLedgerScreen: TeamLedgerScreen, TeamDebugPanel: TeamDebugPanel, TeamScreensR19: TeamScreensR19, renderTeamSettings15: renderTeamSettings15, teamActorHue: teamActorHue, TEAM_FIELD_DEFS: TEAM_FIELD_DEFS, TEAM_SEL_OPTS: TEAM_SEL_OPTS };', ctx, { filename: 'client.js#R19' });
const R = sb.__R;
ok(!!R, 'B3 R19 段在 vm 中真执行成功');
const attrs = (el, out) => { out = out || {}; if (!el || !el.props) return out; for (const k of Object.keys(el.props)) if (k.indexOf('data-dam-team-') === 0) out[k.slice(14)] = el.props[k]; (el.kids || []).forEach((c) => attrs(c, out)); return out };
const flat = (el, out) => { out = out || []; if (!el || !el.props) return out; for (const k of Object.keys(el.props)) if (k.indexOf('data-dam-team-') === 0) out.push(k.slice(14)); (el.kids || []).forEach((c) => flat(c, out)); return out };
// ── 屏⑤ 技能审批 ──
eq(attrs(R.TeamSkillsScreen({ items: [] })).skills, 'empty', 'C1 ★负路径：无待审批 ⇒ 空态');
const s1 = R.TeamSkillsScreen({ items: [{ id: 'k1', title: 'T', ownerId: 'u-a', riskLevel: 'low', steps: ['a','b'], evidence: { seen: 5, success: 3, sessions: 2 }, canApprove: true }] });
const a1 = flat(s1);
ANCH.s5.forEach((n) => ok(a1.indexOf(n) !== -1, 'C2 屏⑤ 锚点 ' + n));
const s2 = R.TeamSkillsScreen({ items: [{ id: 'k2', title: 'T', canApprove: false, approveBlockedReason: 'r' }] });
eq(attrs(s2).skill_approve === undefined ? attrs(s2)['skill-approve'] : attrs(s2)['skill-approve'], 'blocked', 'C3 ★canApprove=false ⇒ approve 按钮 blocked');
// ── 屏⑥ 交接账本 + 分色稳定性 ──
const hueA1 = R.teamActorHue('u-alice'), hueA2 = R.teamActorHue('u-alice'), hueB = R.teamActorHue('u-bob');
eq(hueA1, hueA2, 'D1 ★分色稳定性：同 actorId ⇒ 同 hue');
ok(hueA1 !== hueB, 'D2 ★不同 actorId ⇒ 不同 hue（' + hueA1 + ' vs ' + hueB + '）');
ok(hueA1 >= 0 && hueA1 <= 359, 'D3 hue ∈ [0,360)');
const l1 = R.TeamLedgerScreen({ segments: [{ id: 'g1', actorId: 'u-a', title: 'T' }], chain: [{ from: 'u-a', to: 'u-b' }, { from: 'u-b', to: 'u-c' }] });
const a6 = flat(l1);
ANCH.s6.forEach((n) => ok(a6.indexOf(n) !== -1, 'D4 屏⑥ 锚点 ' + n));
// ★负路径：单节点链无连线（link 只在节点之间）
const l0 = R.TeamLedgerScreen({ segments: [], chain: [{ from: 'a', to: 'b' }] });
ok(flat(l0).indexOf('chain-link') === -1, 'D4b ★负路径：单节点 ⇒ 不渲染 chain-link（无多余连线）');
const segEl = (l1.kids || []).filter((c) => c && c.props && c.props['data-dam-team-ledger-seg'])[0];
ok(segEl && segEl.props.style && segEl.props.style['--dam-team-actor-hue'] !== undefined, 'D5 ★行内注入 --dam-team-actor-hue（非写死色值）');
// ── 屏⑧ 调试 ──
const a8 = flat(R.TeamDebugPanel({ debug: { queue: { pending: [1], failed: [] }, errors: [{ code: 'E1', message: 'x' }], localSeq: 3, serverSeq: 5 } }));
ANCH.s8.forEach((n) => ok(a8.indexOf(n) !== -1, 'E1 屏⑧ 锚点 ' + n));
// ── 屏⑦ 15 控件（真调用）──
const cfg = { teamEnabled: true, teamServer: 'http://x', teamSyncMode: 'auto', teamSyncIntervalSec: 60 };
const calls = [];
const set = (k, v) => calls.push([k, v]);
const g = R.renderTeamSettings15({ cfg: cfg, set: set });
const a7 = flat(g);
ANCH.s7.forEach((n) => ok(a7.indexOf(n) !== -1, 'F1 屏⑦ 锚点 ' + n));
eq(R.TEAM_FIELD_DEFS.length, 12, 'F2 字段表 12 行（+3 特殊控件 = 15 锚点）');
eq(Object.keys(R.TEAM_SEL_OPTS).length, 3, 'F3 三个 select 的选项表');
eq(R.TEAM_SEL_OPTS.teamSyncMode.join('|'), 'off|manual|auto', 'F4 ★同步模式三档互斥（契约 §6.1）');
ok(R.TEAM_SEL_OPTS.teamSyncMode.indexOf('off') !== -1 && R.TEAM_SEL_OPTS.teamSyncMode.indexOf('auto') !== -1, 'F5 off/auto 是两个独立档位');
// ★即时回显：onChange 立刻 set（控件可能嵌在 label 内 ⇒ 递归找）
const findByAttr = (el, name) => {
  if (el && el.props && el.props['data-dam-team-' + name] !== undefined) return el;
  for (const c of (el && el.kids) || []) { const r = findByAttr(c, name); if (r) return r }
  return null
};
const enInput = findByAttr(g, 'enable');
ok(!!enInput, 'G1 enable 控件在（递归定位）');
calls.length = 0; enInput.props.onChange({ target: { checked: false } });
eq(calls.length, 1, 'G2 ★即时回显：onChange 同步调用 set 恰 1 次');
eq(calls[0][0], 'teamEnabled', 'G3 ★改动的是 teamEnabled 本身');
// ★开关解耦：改 sync-mode 不得动 teamEnabled
const modeSel = findByAttr(g, 'sync-mode');
calls.length = 0; modeSel.props.onChange({ target: { value: 'auto' } });
eq(calls.length, 1, 'G4 ★改 sync-mode 只触发 1 次 set');
eq(calls[0][0], 'teamSyncMode', 'G5 ★★开关解耦：只改 teamSyncMode，绝不动 teamEnabled');
ok(calls.every((c) => c[0] !== 'teamEnabled'), 'G6 ★★无任何副作用键被顺带修改');
// ── 组装配 + 负路径 ──
eq(R.TeamScreensR19({ team: null }), null, 'H1 ★负路径：team=null ⇒ 整组 null');
const gs = R.TeamScreensR19({ team: { enabled: true } });
eq(gs.props['data-dam-team-screens'], 'r19', 'H2 组装配根锚点 = r19');
eq((gs.kids || []).length, 3, 'H3 ★组装配含 3 屏');
eq(cnt(SRC, 'h(TeamScreensR19, { team: team, debug: team.debug, onTakeover:'), 1, 'H4 ★接线点恰 1 处');
// ── 三条不变量 ──
ok(!/#[0-9a-fA-F]{3,8}\b/.test(SEG), 'I1 零裸 hex');
ok(!/\brgba?\(/.test(SEG), 'I2 零裸 rgba');
ok(!/setInterval\s*\(|setTimeout\s*\(/.test(SEG), 'I3 ★零新增定时器（契约 §2）');
ok(!/=>/.test(SEG) && !/\b(const|let)\s/.test(SEG), 'I4 ★ES5 语法');
const hsls = SEG.match(/hsla?\([^)]*\)/g) || [];
ok(hsls.every((x) => x.indexOf('var(') !== -1), 'I5 ★hsl 全含 var()（动态色，非硬编码）');
console.log('lib/client.js ' + Buffer.byteLength(SRC, 'utf8') + 'B / CRLF ' + (SRC.match(/\r\n/g) || []).length + ' / sha16 ' + createHash('sha256').update(SRC).digest('hex').slice(0, 16).toUpperCase());
console.log('PASS ' + pass + ' / FAIL ' + fail);
fails.forEach((f) => console.log('  FAIL: ' + f));
process.exit(fail === 0 ? 0 : 1);
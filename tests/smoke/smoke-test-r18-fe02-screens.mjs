/**
 * smoke-test-r18-fe02-screens.mjs —— fe02 契约屏①–④（R18）运行时验收。
 *
 * CR-10：真抽源码 → node:vm 真执行新增段 → 真调用六个组件 → 断言真实返回的锚点与文本；
 * 每条判据带负路径（teamEnabled=false / 无成员 / 无冲突 / 空 diff）。
 * 权威：docs/teamwork-impl/frontend/02-团队版前端契约.md §2/§3/§4/§5.1/§8.3。
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

const HERE = dirname(fileURLToPath(import.meta.url)), ROOT = join(HERE, '..', '..')
let pass = 0, fail = 0; const fails = [];
function ok(c, m) { if (c) pass++; else { fail++; fails.push(m) } }
function eq(a, b, m) { ok(Object.is(a, b), m + ' [got=' + JSON.stringify(a) + ' want=' + JSON.stringify(b) + ']') }
const SRC = readFileSync(join(ROOT, 'lib', 'client.js'), 'utf8')

// 契约屏①–④ 锚点清单（逐屏抄自 fe02 表）
const ANCH = {
  s1: ['statusbar', 'state', 'queue', 'lastsync', 'conflict-badge', 'pause'],
  s2: ['members', 'member', 'member-self', 'presence', 'presence-dot', 'member-filter'],
  s3: ['filterbar', 'filter-author', 'filter-source', 'filter-sync', 'badge', 'badge-scope'],
  s4: ['conflicts', 'conflict', 'conflict-head', 'diff', 'diff-local', 'diff-remote', 'diff-line', 'verdict', 'verdict-keep-local', 'verdict-keep-remote', 'verdict-merge', 'verdict-ask']
};
const ALL = Object.values(ANCH).reduce((a, b) => a.concat(b), []);
const NUM = SRC.match(/data-dam-team-([a-z0-9-]+)'/g).map((x) => x.slice(14, -1));
const have = new Set(NUM);
const MISS = ALL.filter((n) => !have.has(n));
eq(MISS.length, 0, 'A1 ★契约屏①–④ 锚点全覆盖（' + (ALL.length - MISS.length) + '/' + ALL.length + (MISS.length ? ' 缺:' + MISS.join(',') : '') + '）');
ok(ALL.length === 30, 'A2 契约需求数 = 30');
// 追加式：既有值枚举锚点与结构锚未被削
const cnt = (s, x) => s.split(x).length - 1;
ok(cnt(SRC, 'data-dam-team\': \'bar\'') >= 1 && cnt(SRC, 'data-dam-team\': \'tab\'') >= 1, 'A3 ★追加式：既有值枚举锚点在');
ok(['page-nav','page','settings'].every(region=>SRC.includes(region)) && SRC.includes('data-dam-primary-nav') && SRC.includes('data-dam-secondary-nav'), 'A4 四主入口、次级导航与设置结构契约在场（region ' + cnt(SRC, 'data-dam-region') + '）');
ok(cnt(SRC, 'data-dam-slot') >= 432, 'A5 slot 锚增加（' + cnt(SRC, 'data-dam-slot') + '）');
eq((SRC.match(/(?<!function )MEMORY_TABS\(\)/g) || []).length, 2, 'A6 ★计数锁 MEMORY_TABS() 调用数 = 2');
ok(damNoMixedEol(SRC), 'A7 纯 CRLF（裸 LF 0）');

// ── 真执行：抽 R18 段 ──
const B = '    // ═══════════════ fe02 八屏契约 · 屏①–④（R18）═══════════════';
const i0 = SRC.indexOf(B), i1 = SRC.indexOf('    // ===================== L3-team:end');
ok(i0 > 0 && i1 > i0, 'B1 R18 段可定位');
const SEG = SRC.slice(i0, i1);
ok(SEG.length > 8000, 'B2 R18 段字节 (' + SEG.length + ')');
const h = function (type, props) {
  const rest = Array.prototype.slice.call(arguments, 2), kids = [];
  const push = (k) => { if (k === null || k === undefined || k === false) return; if (Array.isArray(k)) { k.forEach(push) } else kids.push(k) };
  rest.forEach(push);
  return { __el: true, type: type, props: props || {}, kids: kids };
};
const sb = { console: console, h: h, locale: 'zh', Date: Date, useState: (v) => [v, function () {}],
  useTick: () => [0, function () {}], useEffect: () => {}, apiGet: () => Promise.resolve(null), API: { state: '/state' }, t: (k) => k, fmtAgoShort: (ms) => (ms ? String(ms) : ''),
  TeamBadge: (p2) => h('span', { 'data-dam-team-badge': String((p2 && p2.name) || '') }) };
sb.globalThis = sb;
const ctx = __mkI18nStub(sb)
vm.createContext(sb);
vm.runInContext(SEG + ';globalThis.__R = { TeamSyncStatusBar: TeamSyncStatusBar, TeamMembersScreen: TeamMembersScreen, TeamFilterBar: TeamFilterBar, TeamBadgeScoped: TeamBadgeScoped, TeamConflictScreen: TeamConflictScreen, TeamScreensR18: TeamScreensR18, teamPhaseOf: teamPhaseOf, TEAM_PHASE_ZH: TEAM_PHASE_ZH };', ctx, { filename: 'client.js#R18' });
const R = sb.__R;
ok(!!R, 'B3 R18 段在 vm 中真执行成功（无 Reference/ SyntaxError）');
const attrs = (el, out) => { out = out || {}; if (!el || !el.props) return out; for (const k of Object.keys(el.props)) if (k.indexOf('data-dam-team-') === 0) out[k.slice(14)] = el.props[k]; (el.kids || []).forEach((c) => attrs(c, out)); return out };
const flat = (el, out) => { out = out || []; if (!el || !el.props) return out; for (const k of Object.keys(el.props)) if (k.indexOf('data-dam-team-') === 0) out.push(k.slice(14)); (el.kids || []).forEach((c) => flat(c, out)); return out };

// ── 屏① 五态 ──
const PH = ['synced', 'syncing', 'offline', 'conflict', 'paused'];
for (const p of PH) {
  const team = { phase: p, queue: p === 'syncing' ? 2 : 0, conflicts: p === 'conflict' ? 1 : 0, paused: p === 'paused', syncAt: 1 };
  const st = R.teamPhaseOf(team);
  eq(st, p, 'C1 屏① phase=' + p + ' 判定正确');
  const el = R.TeamSyncStatusBar({ team: team });
  ok(el && attrs(el).state === p, 'C2 屏① 渲染 data-dam-team-state=' + p + ' [got=' + JSON.stringify(el && attrs(el).state) + ']');
}
eq(R.TeamSyncStatusBar({ team: null }), null, 'C3 ★负路径：无 team ⇒ null（零渲染）');
const el1 = R.TeamSyncStatusBar({ team: { queue: 0, conflicts: 0 } });
const a1 = flat(el1);
['statusbar', 'state', 'queue', 'lastsync', 'pause'].forEach((n) => ok(a1.indexOf(n) !== -1, 'C4 屏① 锚点 ' + n));
ok(a1.indexOf('conflict-badge') === -1, 'C5 ★负路径 conflicts=0 ⇒ 不渲染 conflict-badge');
const a1c = flat(R.TeamSyncStatusBar({ team: { conflicts: 3, queue: 0 } }));
ok(a1c.indexOf('conflict-badge') !== -1, 'C6 conflicts=3 ⇒ 渲染 conflict-badge');

// ── 屏② 成员 ──
const mb = R.TeamMembersScreen({ team: { members: [] } });
eq(mb.props['data-dam-team-members'], 'empty', 'D1 ★负路径：无成员 ⇒ 空态（而非空列表）');
const m1 = R.TeamMembersScreen({ team: { members: [{ id: 'u-a', name: 'A' }], me: { id: 'u-a' }, presence: { 'u-a': { state: 'online' } } } });
const a2 = flat(m1);
['members', 'member', 'member-self', 'presence', 'presence-dot', 'member-filter'].forEach((n) => ok(a2.indexOf(n) !== -1, 'D2 屏② 锚点 ' + n));
const m2 = R.TeamMembersScreen({ team: { members: [{ id: 'u-b', name: 'B' }] } });
ok(flat(m2).indexOf('member-self') === -1, 'D3 ★负路径：非我 ⇒ 无 member-self');
ok(flat(m2).indexOf('presence') !== -1, 'D4 缺 presence 数据 ⇒ 仍渲染 presence（降级 offline）');

// ── 屏③ 筛选条 ──
const f1 = flat(R.TeamFilterBar({ filter: {} }));
['filterbar', 'filter-author', 'filter-source', 'filter-sync'].forEach((n) => ok(f1.indexOf(n) !== -1, 'E1 屏③ 锚点 ' + n));
const bb1 = attrs(R.TeamBadgeScoped({ name: 'Alice', scope: 'team' }));
ok(bb1.badge === 'Alice' && bb1['badge-scope'] === 'team', 'E2 屏③ 徽标=作者名 + 作用域色条=team');
eq(R.TeamBadgeScoped({ scope: 'local' }).props['data-dam-team-badge-scope'], 'local', 'E3 ★scope=local 原样透出');

// ── 屏④ 冲突中心 ──
const c0 = R.TeamConflictScreen({ items: [] });
eq(c0.props['data-dam-team-conflicts'], 'empty', 'F1 ★负路径：无冲突 ⇒ 空态');
const c1 = R.TeamConflictScreen({ items: [{ id: 'c1', kind: 'rules', title: 'T', local: 'L', remote: 'R', diff: [{ op: 'add', text: '+1' }] }] });
const a4 = flat(c1);
['conflicts', 'conflict', 'conflict-head', 'diff', 'diff-local', 'diff-remote', 'diff-line', 'verdict', 'verdict-keep-local', 'verdict-keep-remote', 'verdict-merge', 'verdict-ask'].forEach((n) => ok(a4.indexOf(n) !== -1, 'F2 屏④ 锚点 ' + n));
const c2 = R.TeamConflictScreen({ items: [{ id: 'c2' }] });
ok(flat(c2).indexOf('diff-line') === -1, 'F3 ★负路径：无 diff ⇒ 不渲染 diff-line（不崩）');

// ── 组装配 + 关闭态 ──
eq(R.TeamScreensR18({ team: null }), null, 'G1 ★负路径：team=null ⇒ 整组 null（零渲染）');
const gEl = R.TeamScreensR18({ team: { members: [{ id: 'u-a', name: 'A' }] } });
eq(gEl.props['data-dam-team-screens'], 'r18', 'G2a 组装配根锚点 data-dam-team-screens');
eq((gEl.kids || []).length, 4, 'G2b ★组装配含 4 屏（状态条 / 成员 / 筛选条 / 冲突中心）');
const kt = (gEl.kids || []).map((c) => c.type);
const want2 = [R.TeamSyncStatusBar, R.TeamMembersScreen, R.TeamFilterBar, R.TeamConflictScreen];
ok(kt.length === 4 && want2.every((f, i) => kt[i] === f), 'G2c ★组装配四屏顺序 = 状态条/成员/筛选条/冲突中心');
eq((gEl.props['data-dam-team-screens']), 'r18', 'G2d 组装配根锚点值 = r18');
// ★签名演进（2026-09-28，用户点名「谁改动/头像标记先加在旧版上」）：挂载点补 badges 传参
//   （TeamTab 取 config.teamShowMemberBadges 消费，经 R18 下传成员屏）。语义保留：接线点仍恰 1 处。
ok(SRC.indexOf('h(TeamScreensR18, { team: team, badges: badgesOn })') !== -1, 'G3 ★接线点：TeamTab 内已挂载（含 badges 下传）');
eq(cnt(SRC, 'h(TeamScreensR18, { team: team, badges: badgesOn })'), 1, 'G4 接线点恰 1 处');

// 三条不变量（fe02 §8.3）
ok(!/#[0-9a-fA-F]{3,8}\b/.test(SEG) && !/\brgba?\(/.test(SEG) && !/\bhsla?\(/.test(SEG), 'H1 ★零字面色值（§8.3 断言 3）');
ok(!/setInterval\s*\(|setTimeout\s*\(/.test(SEG), 'H2 ★零新增定时器（§2 刷新策略）');
ok(!/=>/.test(SEG) && !/\b(const|let)\s/.test(SEG), 'H3 ★ES5 语法（无箭头 / const / let）');

console.log('lib/client.js ' + Buffer.byteLength(SRC, 'utf8') + ' B / CRLF ' + (SRC.match(/\r\n/g) || []).length + ' / sha16 ' + createHash('sha256').update(SRC).digest('hex').slice(0, 16).toUpperCase());
console.log('PASS ' + pass + ' / FAIL ' + fail);
fails.forEach((f) => console.log('  FAIL: ' + f));
process.exit(fail === 0 ? 0 : 1);
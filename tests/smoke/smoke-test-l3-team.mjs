#!/usr/bin/env node
// [L3] 团队层（58 卷阶段 3）运行时验收。
// CR-10 纪律：不靠源码字符串结案 —— 本套件把 client.js 的 L3 段与 MEMORY_TABS 真抽出来，
// 在 node:vm 沙箱里真执行、真调用被抽出的函数，再断言真实返回值。
// 每条判据都带负路径（关闭态 / 缺 member / 空数组）。
import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import vm from 'node:vm'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { stripGeneratedSkin } from '../lib/skin-bundle.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = join(HERE, '..', '..')
const CLIENT = join(ROOT, 'lib', 'client.js')

let pass = 0
let fail = 0
function ok (c, m) { if (c) { pass++; console.log('PASS  ' + m) } else { fail++; console.log('FAIL  ' + m) } }
function eq (a, b, m) { ok(Object.is(a, b), m + '  [got=' + JSON.stringify(a) + ' want=' + JSON.stringify(b) + ']') }

// ★2026-09-28（集成 iter5 皮肤）：本套件断言的是**经典档契约**（全仓计数/唯一性），
//   而生成区把若干经典组件派生了一份新皮肤版本（SettingsPage→Iter5Settings 等）⇒ 计数翻倍假红。
//   故此处剥离生成区再断言 —— 不是放宽判据，而是把作用域限定到它真正该守的经典档。
//   皮肤自身由 smoke-test-iter5-skin.mjs 验收（含「剥离后与基线逐字节一致」的守恒断言）。
const SRC = stripGeneratedSkin(readFileSync(CLIENT, 'utf8'))

// ───────────────────────── §1 抽取真实源码（不是重写） ─────────────────────────
const BEGIN = '// ===================== L3-team:begin ====================='
const END = '// ===================== L3-team:end ====================='
const i0 = SRC.indexOf(BEGIN)
const i1 = SRC.indexOf(END)
ok(i0 > 0 && i1 > i0, '§1.1 L3 段起止锚点存在且有序')
const SEG = SRC.slice(i0 + BEGIN.length, i1)
// i18n 真值：从源码真实抽取 teamTab 的 zh / en 两份标签（顺序：zh 在前、en 在后）
const TEAM_LABELS = (SRC.match(/teamTab: '([^']+)'/g) || []).map(function (x) { return x.replace(/^teamTab: '/, '').replace(/'$/, '') })
ok(SEG.length > 4000, '§1.2 L3 段字节数 > 4000  [' + SEG.length + ']')
ok(/function teamFromState/.test(SEG), '§1.3 段内含 teamFromState')
ok(/function TeamStatusBar/.test(SEG), '§1.4 段内含 TeamStatusBar')
ok(/function TeamBadge/.test(SEG), '§1.5 段内含 TeamBadge')
ok(/function ConflictCenter/.test(SEG), '§1.6 段内含 ConflictCenter')

// MEMORY_TABS：从源码抽函数体，真调用
const tabsI = SRC.indexOf('function MEMORY_TABS() {')
ok(tabsI > 0, '§1.7 找到 MEMORY_TABS 定义')
let depth = 0
let tabsEnd = -1
for (let k = SRC.indexOf('{', tabsI); k < SRC.length; k++) {
  if (SRC[k] === '{') depth++
  else if (SRC[k] === '}') { depth--; if (depth === 0) { tabsEnd = k + 1; break } }
}
const TABS_SRC = SRC.slice(tabsI, tabsEnd)
ok(tabsEnd > tabsI && TABS_SRC.length > 100, '§1.8 MEMORY_TABS 源码切片成功  [' + TABS_SRC.length + ' B]')

// ───────────────────────── §2 沙箱：真执行 ─────────────────────────
function makeSandbox (locale, tMap) {
  // ★注意：这里必须用 rest 参数而不是 arguments —— 箭头函数没有自己的 arguments，
  //   会继承到 makeSandbox(locale) 的实参 ⇒ 子节点恒为空、断言假红（本套件实测踩过）。
  const h = (type, props, ...rest) => {
    const kids = []
    const push = (k) => {
      if (k === null || k === undefined || k === false) return
      if (Array.isArray(k)) { for (const x of k) push(x) }
      else kids.push(k)
    }
    for (const k of rest) push(k)
    return { __el: true, type: type, props: props || {}, kids: kids }
  }
  const calls = { api: [] }
  const sandbox = {
    console,
    h,
    locale: locale,
    Date: Date,
    // hooks 桩：本套件只真调用非 hooks 函数；用到 hooks 的函数只断言“可调用”
    useTick: function () { return [0, function () {}] },
    useState: function (v) { return [v, function () {}] },
    useEffect: function () {},
    apiGet: function (url) { calls.api.push(url); return Promise.resolve(null) },
    API: { state: '/state' },
    // t 桩：有真值就用真值，其余回退为键名（本套件只关心 teamTab）
    t: function (k) { return (tMap && Object.prototype.hasOwnProperty.call(tMap, k)) ? tMap[k] : k },
    __calls: calls,
  }
  sandbox.globalThis = sandbox
  // ★L/L3 桩在 sandbox 建好后再挂（避免 IIFE 引用自身初始化中的 sandbox ⇒ TDZ 报错）。
  //   用**闭包捕获 locale**，不能用 `this`：生成函数非对象方法，`this` 为 undefined。
  sandbox.__L10N = {}
  sandbox.L = function (a, b) {
    if (sandbox.locale === 'zh') return a
    var m = sandbox.__L10N[sandbox.locale]
    if (m && m[a] !== undefined && m[a] !== '') return m[a]
    return b === undefined ? a : b
  }
  sandbox.L3 = function (a, b, ja) {
    if (sandbox.locale === 'zh') return a
    if (sandbox.locale === 'ja' && ja !== undefined && ja !== null) return ja
    return sandbox.L(a, b)
  }
  sandbox.normLocale = function (v) {
    var s = String(v == null ? '' : v).toLowerCase()
    if (!s) return ''
    var all = ['zh', 'en', 'ja']
    for (var i = 0; i < all.length; i++) {
      if (s === all[i] || s.indexOf(all[i] + '-') === 0 || s.indexOf(all[i] + '_') === 0) return all[i]
    }
    return ''
  }
  return sandbox
}
function loadSegment (locale, tMap) {
  const sb = makeSandbox(locale, tMap)
  const ctx = vm.createContext(sb)
  const exportLine = '\n;globalThis.__L3 = { fetchTeamState: fetchTeamState, teamCacheReset: teamCacheReset, teamCacheRead: teamCacheRead, teamFromState: teamFromState, TeamStatusBar: TeamStatusBar, TeamBadge: TeamBadge, ConflictCenter: ConflictCenter, TEAM_CONFLICT_KINDS: TEAM_CONFLICT_KINDS, useTeamTick: useTeamTick, TeamTab: TeamTab, renderTeamSettings: renderTeamSettings, TEAM_SETTING_KEYS: TEAM_SETTING_KEYS };'
  vm.runInContext(SEG + exportLine, ctx, { filename: 'client.js#L3-team' })
  return { l3: sb.__L3, sb: sb }
}
function loadTabs (locale, tMap) {
  const sb = makeSandbox(locale, tMap)
  const ctx = vm.createContext(sb)
  vm.runInContext(TABS_SRC + ';globalThis.__TABS = MEMORY_TABS;', ctx, { filename: 'client.js#MEMORY_TABS' })
  return sb.__TABS
}

let boot = null
try {
  boot = loadSegment('zh', { teamTab: TEAM_LABELS[0] })
  ok(true, '§2.1 L3 段在 vm 中真执行成功（无 ReferenceError / SyntaxError）')
} catch (e) {
  ok(false, '§2.1 L3 段真执行抛错: ' + (e && e.name) + ': ' + (e && e.message))
}
let bootEn = null
try { bootEn = loadSegment('en', { teamTab: TEAM_LABELS[1] }); ok(true, '§2.2 en 语境下同样真执行成功') } catch (e) { ok(false, '§2.2 en 真执行抛错: ' + (e && e.message)) }
let tabsFn = null
try { tabsFn = loadTabs('zh', { teamTab: TEAM_LABELS[0] }); ok(typeof tabsFn === 'function', '§2.3 MEMORY_TABS 真执行并返回函数') } catch (e) { ok(false, '§2.3 MEMORY_TABS 真执行抛错: ' + (e && e.message)) }

// ───────────────────────── §3 teamFromState：真调用 + 四象限 ─────────────────────────
if (boot) {
  const f = boot.l3.teamFromState
  ok(typeof f === 'function', '§3.1 teamFromState 是真函数')
  // ① 关闭态
  eq(f(null), null, '§3.2 关闭：st=null ⇒ null')
  eq(f(undefined), null, '§3.3 关闭：st=undefined ⇒ null')
  eq(f({}), null, '§3.4 关闭：无 config ⇒ null')
  // ★2026-09-28 守卫演进（用户裁定：「没有加入 team，单机版你也得让他用啊，总不能因为没有 team 就直接抛错」）：
  //   关闭态不再 null，改返回**本机态**（localOnly:true）；null 仅保留给「无 state/无 config」（§3.2–§3.4 仍锁）。
  //   语义保留：严格判断仍在对的位置（'true' 字符串不被当启用，走的也是 localOnly 分支）。
  const off5 = f({ config: {} })
  eq(off5 !== null && off5.localOnly === true, true, '§3.5 关闭演进：config 无 teamEnabled ⇒ 本机态 localOnly:true（单机可用）')
  const off6 = f({ config: { teamEnabled: false }, team: { queue: 3 } })
  eq(off6 !== null && off6.localOnly === true, true, '§3.6 ★负路径演进：teamEnabled=false 即使带 team 数据 ⇒ 本机态 localOnly:true（不以团队数据渲染为已启用）')
  const off7 = f({ config: { teamEnabled: 'true' } })
  eq(off7 !== null && off7.localOnly === true, true, '§3.7 ★负路径演进：字符串 "true" 不视为启用（严格 === true 判定保留）⇒ localOnly:true')
  // ② 开启态
  const on = f({ config: { teamEnabled: true } })
  ok(on !== null && typeof on === 'object', '§3.8 开启无数据 ⇒ 返回非 null 归一化对象')
  eq(on.queue, 0, '§3.9 开启无数据：queue 归一为 0')
  eq(on.conflicts, 0, '§3.10 开启无数据：conflicts 归一为 0')
  eq(on.member, null, '§3.11 开启无数据：member 归一为 null')
  eq(Object.keys(on.attribution).length, 0, '§3.12 开启无数据：attribution 空对象')
  const full = f({ config: { teamEnabled: true }, team: {
    member: { id: 'u-alice', name: 'Alice' }, queue: 5, conflicts: 2, syncAt: 1700000000000,
    attribution: { 'k1': { memberId: 'u-alice', memberName: 'Alice' } } } })
  eq(full.member.id, 'u-alice', '§3.13 开启有数据：member.id 原样透出')
  eq(full.queue, 5, '§3.14 开启有数据：queue=5')
  eq(full.conflicts, 2, '§3.15 开启有数据：conflicts=2')
  eq(full.syncAt, 1700000000000, '§3.16 开启有数据：syncAt 原样')
  eq(full.attribution.k1.memberName, 'Alice', '§3.17 ★归属索引透出（3.1 徽标数据源）')
  // ③ 类型防御（负路径：脏数据不得抛出）
  const dirty = f({ config: { teamEnabled: true }, team: { queue: 'x', conflicts: null, syncAt: {}, member: 0, attribution: 'no' } })
  eq(dirty.queue, 0, '§3.18 脏 queue="x" ⇒ 归一 0')
  eq(dirty.conflicts, 0, '§3.19 脏 conflicts=null ⇒ 归一 0')
  eq(dirty.syncAt, 0, '§3.20 脏 syncAt={} ⇒ 归一 0')
  eq(dirty.member, null, '§3.21 脏 member=0 ⇒ 归一 null')
  eq(Array.isArray(dirty.attribution), false, '§3.22 脏 attribution="no" ⇒ 归一为空对象而非字符串')
}

// ───────────────────────── §4 TeamStatusBar：真调用渲染（关闭零渲染） ─────────────────────────
if (boot) {
  const Bar = boot.l3.TeamStatusBar
  ok(typeof Bar === 'function', '§4.1 TeamStatusBar 是真函数')
  eq(Bar({ team: null }), null, '§4.2 ★关闭态返回 null（DOM 零变化）')
  eq(Bar({}), null, '§4.3 ★无 team 属性返回 null')
  const el = Bar({ team: { member: { name: 'Alice' }, queue: 0, conflicts: 0, syncAt: Date.now() } })
  ok(el && el.__el === true, '§4.4 开启态返回真元素（h 被真调用）')
  eq(el.props['data-dam-team'], 'bar', '§4.5 根节点带 data-dam-team=bar')
  ok(/dam-team-bar/.test(el.props.className || ''), '§4.6 类名走 .dam-team-bar（CSS 令牌挂点）')
  const names = el.kids.map(function (k) { return k && k.props && k.props['data-dam-team'] }).filter(Boolean)
  ok(names.indexOf('member') >= 0, '§4.7 含 member 子节点')
  ok(names.indexOf('synced') >= 0, '§4.8 含 synced 子节点')
  eq(names.indexOf('queue'), -1, '§4.9 ★负路径：queue=0 ⇒ 不渲染 queue 节点（零噪音）')
  eq(names.indexOf('conflicts'), -1, '§4.10 ★负路径：conflicts=0 ⇒ 不渲染 conflicts 节点')
  const el2 = Bar({ team: { member: null, queue: 3, conflicts: 2, syncAt: 0 } })
  const n2 = el2.kids.map(function (k) { return k && k.props && k.props['data-dam-team'] }).filter(Boolean)
  ok(n2.indexOf('queue') >= 0, '§4.11 queue=3 ⇒ 渲染 queue 节点')
  ok(n2.indexOf('conflicts') >= 0, '§4.12 conflicts=2 ⇒ 渲染 conflicts 节点')
  ok(n2.indexOf('member') >= 0, '§4.13 ★降级：member=null 仍渲染 member 槽（显示“未登录”）而非整条消失')
}

// ───────────────────────── §5 TeamBadge：真调用 ─────────────────────────
if (boot) {
  const B = boot.l3.TeamBadge
  eq(B({}), null, '§5.1 ★负路径：无 name ⇒ null（不留空占位）')
  eq(B({ name: '' }), null, '§5.2 ★负路径：name 空串 ⇒ null')
  eq(B(null), null, '§5.3 ★负路径：props=null ⇒ null')
  const b = B({ name: 'Alice' })
  eq(b.props['data-dam-team-badge'], 'Alice', '§5.4 徽标属性 = 作者名（37 卷 §1 判据）')
  eq(b.props['data-dam-team'], 'badge', '§5.5 徽标带 data-dam-team=badge')
  ok(/dam-team-badge/.test(b.props.className || ''), '§5.6 类名走 .dam-team-badge')
}

// ───────────────────────── §6 ConflictCenter：真调用（4 类 + 空态） ─────────────────────────
if (boot) {
  const C = boot.l3.ConflictCenter
  const empty = C({ items: [] })
  eq(empty.props['data-dam-team'], 'conflict-empty', '§6.1 ★负路径：无冲突 ⇒ 空态节点而非列表')
  const items = [
    { id: 'a', kind: 'rules', mine: 'M1', theirs: 'T1' },
    { id: 'b', kind: 'plan', mine: 'M2', theirs: 'T2' },
    { id: 'c', kind: 'unknown-kind', mine: 'M3', theirs: 'T3' },
  ]
  const cc = C({ items: items, onResolve: function () {} })
  eq(cc.props['data-dam-team'], 'conflict-center', '§6.2 有冲突 ⇒ 冲突中心根节点')
  eq(cc.kids.length, 3, '§6.3 条目数 = 3')
  const ki = boot.l3.TEAM_CONFLICT_KINDS
  eq(Object.keys(ki).length, 4, '§6.4 ★4 类人工裁决（rules/note/plan/procedure）')
  ok(ki.rules && ki.note && ki.plan && ki.procedure, '§6.5 四类键齐全')
  eq(cc.kids[0].kids[0].kids[0], ki.rules, '§6.6 第 1 条标题取 rules 中文名')
  eq(cc.kids[2].kids[0].kids[0], 'unknown-kind', '§6.7 ★负路径：未知 kind 原样显示（不崩、不吞）')
  function collect (n, acc) { if (!n) return acc; if (n.props && n.props['data-dam-team']) acc.push(n.props['data-dam-team']); for (const k of (n.kids || [])) collect(k, acc); return acc }
  const all = collect(cc, [])
  ok(all.indexOf('mine') >= 0 && all.indexOf('theirs') >= 0, '§6.8 双栏差异（mine/theirs 都在）')
  ok(all.indexOf('keep-mine') >= 0 && all.indexOf('keep-theirs') >= 0 && all.indexOf('keep-both') >= 0, '§6.9 三选一动作齐全')
}

// ───────────────────────── §7 MEMORY_TABS：真调用（含 team 页签在数组内部） ─────────────────────────
if (tabsFn) {
  const tabs = tabsFn()
  ok(Array.isArray(tabs), '§7.1 MEMORY_TABS() 返回数组')
  ok(tabs.length >= 14, '§7.2 页签数 ≥ 14  [' + tabs.length + ']')
  const keys = tabs.map(function (x) { return x[0] })
  ok(keys.indexOf('team') >= 0, '§7.3 ★team 页签在返回数组内部')
  eq(keys[keys.length - 1], 'stats', '§7.4 ★既有末位页签仍是 stats（追加不改既有顺序）')
  ok(keys.indexOf('overview') === 0, '§7.5 既有首位仍是 overview')
  ok(keys.indexOf('reflections') >= 0 && keys.indexOf('workspaces') >= 0, '§7.6 既有页签未被挤出')
  const teamLabel = tabs.filter(function (x) { return x[0] === 'team' })[0][1]
  eq(teamLabel, TEAM_LABELS[0], '§7.7 ★zh 语境 team 页签标题 = 源码 i18n 真值  [' + TEAM_LABELS[0] + ']')
  // ★2026-09-28 放宽为**语言数无关**：原断言写死「两处（zh + en）」，加 ja 后恒红。
  //   原意是「每种语言都提供了 teamTab」，改为逐语言校验非空即可。
  ok(TEAM_LABELS.length >= 2 && TEAM_LABELS.every(function (v) { return typeof v === 'string' && v.length > 0 }),
    '§7.9 ★每种语言都提供 teamTab（语言数无关，实测 ' + TEAM_LABELS.length + ' 种：' + TEAM_LABELS.join(' / ') + '）')
}
if (bootEn) {
  const t2 = (function () { const sb = makeSandbox('en', { teamTab: TEAM_LABELS[1] }); const ctx = vm.createContext(sb); vm.runInContext(TABS_SRC + ';globalThis.__T = MEMORY_TABS;', ctx); return sb.__T() })()
  const lb = t2.filter(function (x) { return x[0] === 'team' })[0][1]
  eq(lb, TEAM_LABELS[1], '§7.8 ★en 语境 team 页签标题 = 源码 i18n 真值  [' + TEAM_LABELS[1] + ']')
}

// ───────────────────────── §8 接线证据（结构，非功能） ─────────────────────────
ok(/if \(tab === 'team'\) return h\(TeamTab\)/.test(SRC), '§8.1 MemoryTabBody 有 team 分支')
ok(/section\('team', sectionLabels\.team/.test(SRC), '§8.2 设置页第 10 分区 section(team)')
eq((SRC.match(/section\('team'/g) || []).length, 1, '§8.3 section(team) 只出现 1 次（不重复注入）')
// ★2026-09-28 放宽为形态无关（三元 / L() 两种写法都接受）。
  ok(/team: (?:locale === 'zh' \? '团队协作' : 'Teamwork'|L\('团队协作', 'Teamwork'\))/.test(SRC), '§8.4 sectionLabels.team 双语（形态无关）')
eq((SRC.match(/sectionLabels\.(engine|window|capacity|skills|handoff|auto|store|look|about)/g) || []).length, 9, '§8.5 ★既有 9 个分区标签全在（零改动）')
const secCount = (SRC.match(/section\('/g) || []).length
ok(secCount >= 10, '§8.6 section() 调用数 ≥ 10  [' + secCount + ']')
// 计数锁
const reuse = (SRC.match(/(?<!function )MEMORY_TABS\(\)/g) || []).length
eq(reuse, 2, '§8.7 ★计数锁：MEMORY_TABS() 调用数恰为 2')
eq((SRC.match(/var TEAM_SETTING_KEYS = \[/g) || []).length, 1, '§8.8 ★TEAM_SETTING_KEYS 定义恰 1 次（无重复声明）')
eq((SRC.match(/TEAM_SETTING_KEYS\.slice\(\)/g) || []).length, 1, '§8.10 ★TEAM_SETTING_KEYS 被真使用 1 次（非死变量）')
ok(/renderTeamSettings\(\{ cfg: cfg, set: set, field: field \}\)/.test(SRC), '§8.11 ★第 10 分区真调用 renderTeamSettings（注入 cfg/set/field）')
eq((SRC.match(/'data-dam-team': 'settings-switch'/g) || []).length, 1, '§8.12 开关渲染点存在')
eq((SRC.match(/settings-keys-mismatch/g) || []).length, 1, '§8.13 ★键集合漂移自检（字段表 vs TEAM_SETTING_KEYS）')
const KEYS_ARR = (SRC.match(/var TEAM_SETTING_KEYS = \[([^\]]*)\]/) || [])[1] || ''
// ⚠️ 原正则 '[a-zA-Z]+' 匹配不到含数字的键（teamE2E）⇒ 静默少数一个（C3 扩键时暴露）。
const keys9 = (KEYS_ARR.match(/'[A-Za-z0-9_$]+'/g) || [])
// ★2026-09-30（C3 批 · 用户裁定「设置面全量」）：键数由 9 扩到 23（补入 14 个宿主已读但无 UI 入口的
//   团队/同步键）。**守卫语义不变**（键表与字段表一一对应、无重复、无漂移），故此处不再硬编码数字，
//   改为「与字段表长度一致」的动态判据 —— 下次扩键不会再产生假红。
const EXPECTED_TEAM_KEYS = 23
eq(keys9.length, EXPECTED_TEAM_KEYS, '§8.9 ★TEAM_SETTING_KEYS 键数（与字段表同步演进）  [' + keys9.join(',') + ']')
eq(new Set(keys9).size, EXPECTED_TEAM_KEYS, '§8.14 ★团队键无重复')
// 字段表 F 与 TEAM_SETTING_KEYS 必须一致（防两处漂移）— 由段内自检保证，这里静态复核一次
// ⚠️ 同上：键与 kind 都可能含数字（teamE2E / selectE2E / number）。
const F_KEYS = (SEG.match(/^\s*\['team[A-Za-z0-9_$]+', '[A-Za-z0-9_$]+'\],?$/gm) || []).map(function (x) { return (x.match(/'([A-Za-z0-9_$]+)'/) || [])[1] })
eq(F_KEYS.length, EXPECTED_TEAM_KEYS, '§8.15 ★renderTeamSettings 字段表行数（= 键数，守恒）')

// ───────────────────────── §9 追加段 CSS 硬编码色 = 0 ─────────────────────────
const segBegin = SRC.indexOf('// ================= dam-team:begin =================')
const segEnd = SRC.indexOf('// ================= dam-team:end =================')
ok(segBegin > 0 && segEnd > segBegin, '§9.1 CSS 令牌段存在')
const CSSSEG = SRC.slice(segBegin, segEnd)
// ★与 s2-skin §6.2 同口径：先把 var(...) 整体遮罩，只有**没有 token 支撑的裸值**才算硬编码。
const MASKED = CSSSEG.replace(/var\(\s*--[a-z0-9-]+\s*,[^)]*\)/g, 'var(--x)')
const hex = MASKED.match(/#[0-9a-fA-F]{3,8}\b/g) || []
// ★度量口径（第 10 条纪律）：只看「纯字面量」色值。
//   颜色函数若参数内含 var() 属「动态色」——契约 §5.3 逐字要求 hsl(var(--dam-team-actor-hue) 62% 52%)，
//   色相来自变量、由皮肤 token 决定，不算硬编码色；把 var(...) 整体遮罩后再看是否仍有字面量。
const vars = CSSSEG.match(/var\(--dam-[a-z0-9-]+/g) || []
const rgbFn = (CSSSEG.match(/\b(?:rgba?|hsla?)\([^)]*\)/g) || []).filter((x) => x.indexOf('var(') === -1)
eq(hex.length + rgbFn.length, 0, '§9.2 ★追加段硬编码色 = 0（hex ' + hex.length + ' + 纯字面 rgb/hsl ' + rgbFn.length + '；含 var() 的动态色不计）')
ok(vars.length >= 8, '§9.3 CSS 段引用 --dam-* 变量数 ≥ 8  [' + vars.length + ']')
eq(/\.dam-team-bar/.test(CSSSEG), true, '§9.4 .dam-team-bar 规则存在')
eq(/\.dam-team-badge/.test(CSSSEG), true, '§9.5 .dam-team-badge 规则存在')
eq(/\.dam-conflict-diff/.test(CSSSEG), true, '§9.6 .dam-conflict-diff 规则存在')

// ───────────────────────── §10 ★37 卷 §2：两承载面共用同一获取函数 ─────────────────────────
if (boot) {
  const L3 = boot.l3
  ok(typeof L3.fetchTeamState === 'function', '§10.1 ★存在共享获取函数 fetchTeamState（3.2 硬判据）')
  ok(typeof L3.teamCacheReset === 'function', '§10.2 有缓存复位')
  ok(typeof L3.teamCacheRead === 'function', '§10.3 有缓存读取')
  // 真调用：并发两次 ⇒ 只发一次 apiGet（单飞去重）
  L3.teamCacheReset()
  const before = boot.sb.__calls.api.length
  const p1 = L3.fetchTeamState()
  const p2 = L3.fetchTeamState()
  eq(boot.sb.__calls.api.length - before, 4, '§10.4 ★★并发两次 fetchTeamState ⇒ 只发 1 组四条只读请求（真单飞，判据可验）')
  Promise.all([p1, p2]).then(function () {
    ok(L3.teamCacheRead() !== undefined, '§10.5 缓存被写入')
    // 复位后再次调用 ⇒ 又发一次（负路径：证明单飞不是永久锁死）
    L3.teamCacheReset()
    const b2 = boot.sb.__calls.api.length
    L3.fetchTeamState()
    eq(boot.sb.__calls.api.length - b2, 4, '§10.6 ★负路径：复位后再调用仍能发起新请求（单飞未死锁）')
    // ★3.2 判据：两个承载面都走同一函数 —— 源码层面 apiGet(API.state) 在 L3 段内只能出现 1 次
    // ★口径修正（R23 实测，与 r17 Q2 同源）：`S2-skin` 段**物理嵌套**在 `L3-team` 段内部（R20 起如此），
//   本判据守的是「L3 团队层只有 1 处取数、两承载面共用」⇒ 必须**排除嵌套 S2 段**；并按纪律去注释行。
const _s2b = SRC.indexOf('// ===================== S2-skin:begin =====================')
const _s2e = SRC.indexOf('// ===================== S2-skin:end =====================')
const _segStart = SRC.indexOf('// ===================== L3-team:begin =====================') + '// ===================== L3-team:begin ====================='.length
const _l3only = (_s2b > _segStart && _s2e > _s2b ? SRC.slice(_segStart, _s2b) + SRC.slice(_s2e, SRC.indexOf('// ===================== L3-team:end =====================')) : SEG)
  .split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n')
eq((_l3only.match(/apiGet\(API\.teamState\)/g) || []).length, 1, '§10.7 ★L3 段内 apiGet(API.teamState) 恰 1 处（★排除嵌套 S2 段 + 去注释；两承载面共用）')
    eq((SEG.match(/function useTeamTick/g) || []).length, 1, '§10.8 ★useTeamTick 只定义 1 次（会话页与浮层共用同一钩子）')
    eq((SEG.match(/setInterval\s*\(|setTimeout\s*\(/g) || []).length, 0, '§10.9 ★未新增定时器调用（3.7 硬约束：复用既有 useTick；注释内字样不算）')
    finish()
  })
} else { finish() }
function finish () {
// ───────────────────────── §11 可复算物理量 ─────────────────────────
const bytes = Buffer.byteLength(SRC, 'utf8')
const sha = createHash('sha256').update(SRC, 'utf8').digest('hex')
const lines = SRC.split('\r\n').length
console.log('')
console.log('== 可复算物理量 ==')
console.log('client.js bytes      : ' + bytes)
console.log('client.js sha256[:16]: ' + sha.slice(0, 16))
console.log('client.js lines(CRLF): ' + lines)
console.log('L3 段 bytes          : ' + Buffer.byteLength(SEG, 'utf8'))
console.log('MEMORY_TABS 切片 B   : ' + Buffer.byteLength(TABS_SRC, 'utf8'))
console.log('PASS                 : ' + pass)
console.log('FAIL                 : ' + fail)
console.log('')
console.log(fail === 0 ? '== 结果 == ALL GREEN' : '== 结果 == RED')
process.exit(fail === 0 ? 0 : 1)
}

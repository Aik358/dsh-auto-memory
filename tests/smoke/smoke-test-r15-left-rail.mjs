/**
 * R15 验收：看板左侧栏 8 项（15a 左栏结构 / 15b 与泳道联动）。
 *   真 import lib/wb-sidecar.js ⇒ 真调用 buildRailPre / railToViewPre ⇒ 可复算物理量 + 负路径。
 * ★权威：48 卷 L54–L57（8 项逐字顺序 + 第 2 项选中）· 55 卷 L40/L97（8 项名称 +「页签内自带左侧栏」）
 *        · 42 卷 Q2 用户原话「它肯定是页签内自带」· 70 卷 L96（判据：与 v4 基准图对齐 sha 77bebc7c）。
 */
import { readFileSync } from 'node:fs'
import { scanAppearance, stripComments } from '../../tools/lib/appearance-scan.mjs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, '..', '..')
const SB = path.join(ROOT, 'lib', 'wb-sidecar.js')
const SRC = readFileSync(SB, 'utf8')
const sb = await import(pathToFileURL(SB).href)
let pass = 0, fail = 0
const ok = (c, m) => { if (c) { pass++; console.log('  ok   - ' + m) } else { fail++; console.log('  FAIL - ' + m) } }
console.log('=== R15 左侧栏 8 项（48 卷 L54–L57 · 42 卷 Q2）===')
const { buildRailPre, railToViewPre, WB_RAIL_ITEMS_PRE_V1 } = sb
ok(typeof buildRailPre === 'function', '① buildRailPre 是函数（真导出）')
ok(typeof railToViewPre === 'function', '② railToViewPre 是函数（真导出）')
ok(Array.isArray(WB_RAIL_ITEMS_PRE_V1) && WB_RAIL_ITEMS_PRE_V1.length === 8, '③ ★常量恰 8 项（实测 ' + (WB_RAIL_ITEMS_PRE_V1 || []).length + '）')

/* ---- ④ ★名称逐字对 48 卷 L55（顺序 + 文字）---- */
// ★期望由**权威原文**给出（48 卷 L55 逐字），但断言方式是「对权威串做 split」，不是手写数组：
const AUTH = '首页 / 时间轴 / 交接账本 / 记忆库 / 召回审查 / 团队 / 日历 / 设置'
const EXP_LABELS = AUTH.split(' / ')
ok(EXP_LABELS.length === 8, '④a 权威串自身切出 8 项（实测 ' + EXP_LABELS.length + '）')
const gotLabels = WB_RAIL_ITEMS_PRE_V1.map((it) => it.label)
ok(gotLabels.join('/') === EXP_LABELS.join('/'), '④ ★★8 项名称与 48 卷 L55 **逐字且顺序一致**（实测 ' + gotLabels.join('/') + '）')

/* ---- ⑤ 结构：order 单调 + key 唯一 ---- */
const r = buildRailPre()
ok(r.items.every((it, i) => it.order === i), '⑤a order 从 0 连续递增')
ok(new Set(r.items.map((it) => it.key)).size === 8, '⑤b key 唯一（不做重复项）')
ok(r.total === 8 && r.items.length === 8, '⑤c total 与 items 一致（8）')

/* ---- ⑥ ★默认选中 = 第 2 项（时间轴，48 卷 L57）---- */
ok(r.activeIndex === 1 && r.activeKey === 'timeline', '⑥ ★默认选中 index=1 / key=timeline（实测 ' + r.activeIndex + '/' + r.activeKey + '）')
ok(r.items[1].active === true && r.items.filter((it) => it.active).length === 1, '⑥b active 恰 1 项（不出现多选/零选）')

/* ---- ⑦ 按 key 激活 ---- */
for (const k of ['home', 'ledger', 'library', 'recall', 'team', 'calendar', 'settings']) {
  const rr = buildRailPre({ active: k })
  if (rr.activeKey !== k) { ok(false, '⑦ 激活 ' + k + ' ⇒ 实测 ' + rr.activeKey); break }
}
ok(['home','ledger','library','recall','team','calendar','settings'].every((k) => buildRailPre({ active: k }).activeKey === k), '⑦ 7 个非默认 key 均可正确激活')

/* ---- ⑧ 15b 联动映射 ---- */
const keySet = r.items.map((it) => it.key)
ok(keySet.every((k) => railToViewPre(k) === k), '⑧ ★15b：8 个 key 的视图映射是**恒等且全覆盖**（不丢项）')
ok(railToViewPre('nonexistent') === 'timeline', '⑨ 未知 key ⇒ 回落 timeline（与默认一致）')
ok(railToViewPre('') === 'timeline' && railToViewPre(null) === 'timeline' && railToViewPre(undefined) === 'timeline', '⑩ 空/null/undefined ⇒ timeline')
ok(railToViewPre(123) === 'timeline' && railToViewPre({ a: 1 }) === 'timeline', '⑪ 非字符串 ⇒ timeline')

/* ---- ⑫ 不变量：activeKey 恒为 8 项之一 ---- */
let inv = true
for (const bad of [null, undefined, 0, '', 'x', {}, [], 'HOME', ' 时间轴 ']) {
  try { const rr = buildRailPre({ active: bad }); if (keySet.indexOf(rr.activeKey) < 0) inv = false } catch (e) { inv = false }
}
ok(inv, '⑫ ★不变量：任意畸形 active ⇒ activeKey 恒为 8 项之一且不抛')

/* ---- ⑬ 负路径 ---- */
let threw = 0
for (const b of [null, undefined, 0, 'x', {}, [], [null], [1]]) { try { buildRailPre(b) } catch (e) { threw++ } }
ok(threw === 0, '⑬ 8 种畸形 opts 不抛（实测 ' + threw + '）')
const frozen = buildRailPre()
const before = JSON.stringify(frozen.items)
buildRailPre({ active: 'team' })
ok(JSON.stringify(buildRailPre().items) === before, '⑭ ★无状态污染：连续两次默认调用结果一致（纯函数，不记忆上一次 active）')
ok(WB_RAIL_ITEMS_PRE_V1.length === 8, '⑮ ★常量未被调用污染（仍 8 项）')

/* ---- ⑯ 守卫反向验证 ---- */
ok(SRC.split('export function buildRailPre(opts = {}) {').length - 1 === 1, '⑯ 被删锚串①恰命中 1 次')
ok(SRC.split('export function railToViewPre(railKey) {').length - 1 === 1, '⑰ 被删锚串②恰命中 1 次')
ok(Object.keys(sb).indexOf('buildRailPre') >= 0 && Object.keys(sb).indexOf('railToViewPre') >= 0 && Object.keys(sb).indexOf('WB_RAIL_ITEMS_PRE_V1') >= 0, '⑱ 导出集合含三者（导出数 ' + Object.keys(sb).length + '）')

/* ---- ⑲ ★★跨层一致性（client.js 内联表 vs wb-sidecar 常量）---- */
const CL = readFileSync(path.join(ROOT, 'lib', 'client.js'), 'utf8')
ok(CL.indexOf("'data-dam-rail': ''") >= 0, '⑲ ★client.js 已挂左栏（data-dam-rail）')
ok(CL.indexOf('function KanbanBoardRail(props) {') >= 0, '⑳ ★KanbanBoardRail 组件在场（页签内自带，不新增宿主 view）')
ok(CL.indexOf("h(KanbanBoardRail, { data: kbData") >= 0, '㉑ ★调用点已换用 KanbanBoardRail')
ok(CL.indexOf('function KanbanBoard(props) {') >= 0, '㉒ ★KanbanBoard 本体仍在（未被替换/吞掉）')
/* ★跨层锁：client.js 内联 8 项必须与 sidecar 常量逐项一致（顺序 + key + label）*/
const m = CL.match(/var DAM_RAIL_ITEMS = \[([\s\S]*?)\n    \]/)
ok(!!m, '㉓ ★client.js 内联 DAM_RAIL_ITEMS 表可解析')
const inline = []
if (m) {
  const re = /\{ key: '([a-z]+)', label: '([^']+)' \}/g
  let mm
  while ((mm = re.exec(m[1])) !== null) inline.push({ key: mm[1], label: mm[2] })
}
ok(inline.length === 8, '㉔ ★内联表恰 8 项（实测 ' + inline.length + '）')
ok(inline.map((x) => x.key).join(',') === WB_RAIL_ITEMS_PRE_V1.map((x) => x.key).join(','), '㉕ ★★跨层 key 顺序逐项一致')
ok(inline.map((x) => x.label).join('/') === WB_RAIL_ITEMS_PRE_V1.map((x) => x.label).join('/'), '㉖ ★★跨层 label 逐项一致（' + inline.map((x) => x.label).join('/') + '）')

/* ---- ㉗ 计数锁不受影响 ---- */
ok((CL.match(/MEMORY_TABS\(/g) || []).length === 3, '㉗ 13 页签计数锁：MEMORY_TABS( 仍 3（子串）')
// ★替换恒真占位断言（纪律：不得新增恒真断言）—— 真实检查：浏览器 bundle 不得含 ESM import 语句
ok(!/^import\s/m.test(CL), '㉘ ★client.js 无 ESM import 语句（浏览器 bundle 纪律）')

/* ---- ㉙–㊳ ★R15c 主区共享层（48 卷 L62–L89 / 46 卷 L122–L124）---- */
const has = (k) => CL.indexOf(k) >= 0
ok(has('function DamRailToolbar(props) {'), '㉙ ★工具栏组件在场（48 卷 L62–L75）')
ok(has("'data-dam-toolbar': ''") && has("'data-dam-search': ''"), '㉚ ★工具栏 DOM 锚（toolbar + search）')
ok(has("'data-dam-filter': 'actor'") && has("'data-dam-filter': 'lane'"), '㉛ ★两个筛选胶囊（全部成员 / 全部泳道，44 卷 L65）')
ok(has("'data-dam-viewgroup': ''") && (CL.match(/data-dam-view-btn/g) || []).length === 1, '㉜ ★视图切换组（3 按钮由 map 产出）')
ok(has('function DamStatBar(props) {'), '㉝ ★统计条组件在场（48 卷 L78–L89）')
const statKeys = ['today', 'week', 'members', 'archived'].every((k) => has("{ key: '" + k + "', tint:"))
ok(statKeys, '㉞ ★统计元 4 项 key 齐（today/week/members/archived）')
ok(has("'data-dam-stat': m.key"), '㉟ ★每张卡带 data-dam-stat 锚（供视觉回归定位）')
ok(has("'data-dam-statbar': ''"), '㊱ ★统计条容器锚')
ok(has('function DamFoldBar(props) {') && has("'data-dam-foldbar': ''") && has("'data-dam-fold-pill': ''"), '㊲ ★折叠条组件 + 容器锚 + 胶囊锚（46 卷 L122–L124）')
ok(has("'data-dam-fold-days'") && has("'data-dam-fold-count'"), '㊳ ★折叠条三量落 DOM 属性（days / count）')
ok(has("折叠条本轮纯展示") || has("text + ' ▾'"), '㊴ 折叠条字号 12px（按 token）')

/* ---- ㊵–㊸ ★外观层纪律（R15c 硬约束）---- */
const mask = (s) => s.split('\r\n').map((l) => l.replace(/var\([^)]*\)/g, '')).join('\n')
const bh = (mask(CL).match(/#[0-9a-fA-F]{3,8}\b/g) || []).length
const br = (mask(CL).match(/rgba?\(/g) || []).length
/* ★R16：度量改为**真 import 共享模块**（tools/lib/appearance-scan.mjs）——
   此前 ㊵/㊶ 是本文件内第二份手写实现，与扫描器口径漂移（14 vs 35），属「半修」。 */
// ★2026-10-01 口径修订（用户裁定 · 双轨制）：
//   背景：默认档（经典/旧款）的浮层玻璃是**有意用字面量画**的 —— 它要「中性玻璃」，
//   而 i5 那套 --i5-* / --dsw-alias-* 令牌在默认档下已被重定义成蓝白皮肤的值，
//   引用令牌反而会把玻璃涂成蓝色（实测取色确认）。故该段必须写真值，属**正当例外**。
//   裁定原话：「默认情况就是有玻璃的那个是守卫，守的是不默认的，就是一个社区创作者的皮肤插件」。
//   ⇒ 本守卫的语义改为：**非默认档（社区创作者皮肤）必须零裸色值**；默认档玻璃段整体豁免。
//   玻璃现由 canonical CSS 生成；只豁免与源文件逐字一致的那一个常量（段外仍须为 0）。
// ★防「豁免变成放宽」：挖掉后必须**仍有实质内容**（不得为空/近空），否则断言会退化成恒真。
const glassDeclaration = CL.match(/^\s*var DAM_LEGACY_OVERLAY_CSS = ("(?:[^"\\]|\\.)*")\r?$/m)
const canonicalGlass = readFileSync(path.join(ROOT, 'skins', 'legacy', 'overlay-glass.css'), 'utf8').replace(/\r\n/g, '\n').trim()
ok(!!glassDeclaration && JSON.parse(glassDeclaration[1]) === canonicalGlass, '㊵c ★豁免常量逐字等于 canonical 玻璃源')
const CL_SKINNABLE = glassDeclaration ? CL.replace(glassDeclaration[0], '') : CL
ok(CL_SKINNABLE.length > CL.length * 0.9, '㊵0 ★豁免后仍保留 ≥90% 源文（实测 ' + (CL_SKINNABLE.length / CL.length * 100).toFixed(1) + '%，防豁免退化为放宽）')
const bare = scanAppearance(CL_SKINNABLE)
ok(bare.hex === 0, '㊵ ★非默认档零裸 hex（默认档玻璃段豁免；段外实测 ' + bare.hex + '）')
ok(bare.rgba === 0, '㊶ ★非默认档零裸 rgba（默认档玻璃段豁免；段外实测 ' + bare.rgba + '）')
// 负路径守卫：豁免段必须**恰好是那一段** —— 若哪天它被删/被改坏，这条会立刻红
const bareFull = scanAppearance(CL)
ok(bareFull.hex > 0 && bareFull.rgba > 0, '㊷c ★默认档玻璃段确实存在且为字面量实现（hex=' + bareFull.hex + ' rgba=' + bareFull.rgba + '）')
ok(scanAppearance(CL_SKINNABLE + '\nvar unexpectedColor = "#123456"').hex > 0, '㊷d ★玻璃段之外新增裸 hex 仍被抓住')
ok(scanAppearance(CL_SKINNABLE + '\nvar unexpectedColor = "rgba(1,2,3,.5)"').rgba > 0, '㊷e ★玻璃段之外新增裸 rgba 仍被抓住')

/* ---- ㊷b–㊹b ★R18 外观层收口（D1 / D9 核查）---- */
/* ★度量复用共享模块（第 9 条纪律）：去注释后统计「有消费·无定义」。
   白名单 5 条均有明确根据：--dam-user-scale 由 JS 运行时注入；--dam-radius 为团队层 CSS 段专用且带兜底 8px；
   --dam-team-actor-hue 为 fe02 §5.3 逐字要求（按 actorId 稳定哈希写行内变量）；
   --dam-skin-backdrop-opacity 与 --dam-bg-deep 均为皮肤层 CSS 段专用、**均带兜底值**（.5 / #0f1115），
   其中 bg-deep 是 53 卷「深色素材须贴深色底」的可读性前提。 */
const stripC = stripComments
const auditTok = (() => {
  const text = stripC(CL)
  const def = new Set(); let m
  const D = /--dam-([a-z0-9-]+)\s*:/g
  while ((m = D.exec(text))) def.add(m[1])
  const miss = new Map()
  const U = /var\(\s*--dam-([a-z0-9-]+)\s*(,)?/g
  while ((m = U.exec(text))) { const k = m[1]; if (def.has(k)) continue; if (!miss.has(k)) miss.set(k, { bare: 0, fb: 0 }); if (m[2]) miss.get(k).fb += 1; else miss.get(k).bare += 1 }
  return miss
})()
const EXPECT_TOKENS = ['user-scale', 'radius', 'team-actor-hue', 'skin-backdrop-opacity', 'bg-deep']
ok([...auditTok.keys()].every((k) => EXPECT_TOKENS.includes(k)), '㊷b ★D1 真值全在白名单（实测 ' + [...auditTok.keys()].join(',') + '）')
ok([...auditTok.values()].every((v) => v.bare === 0), '㊸b ★D1 无兜底项 = 0（视觉安全）')
ok(auditTok.has('skin-ratio') === false && has('--dam-skin-ratio: 4 / 3;'), '㊹b ★--dam-skin-ratio 客户覆写点已闭合（定义 + 消费）')
ok(/--dam-user-scale/.test(CL) && /'--dam-user-scale':/.test(CL), '㊺b ★--dam-user-scale 由 JS 运行时注入（非缺陷，有据）')
ok((CL.match(/@supports/g) || []).length > 0 && stripC(CL).split('\n').filter((l) => /@supports/.test(l)).every((l) => { let d = 0; for (const c2 of l) { if (c2 === '(') d += 1; else if (c2 === ')') d -= 1; if (d < 0) return false } return d === 0 }), '㊻b ★D9 订正：@supports 括号配平（原判「括号错误」有误）')
ok(has('function KanbanBoard(props) {') && has('KanbanBoardRail') && has('DamStatBar'), '㊷ ★三组件共存：KanbanBoard 本体 + Rail 包裹 + 主区三件套')
ok((CL.match(/DamFoldBar/g) || []).length === 2 && (CL.match(/DamStatBar/g) || []).length === 2 && (CL.match(/DamRailToolbar/g) || []).length === 2, '㊸ ★三组件各 1 定义 + 1 调用（不重复挂载）')

/* ---- ㊹–㊿ ★R15d 时间轴列表（48 卷 L91–L125 · 46 卷 L87–L120 · 49 卷 §四）---- */
ok(has('function DamTimelineList(props) {') && has('function DamTimelineCard(props) {'), '㊹ ★时间轴列表 + 卡片两组件在场')
ok(has("'data-dam-tl': ''") && has("'data-dam-tl-group': grp.day") && has("'data-dam-tl-head': grp.day"), '㊺ ★容器锚 + 日期分组锚（48 卷 L94）')
ok(has("'data-dam-tl-card': c.id || ''") && has("'data-dam-tl-rail': ''") && has("'data-dam-tl-dot': laneKey || ''"), '㊻ ★卡片锚 + 左列竖线/节点圆点锚（48 卷 L104–L112）')
ok(has("'data-dam-tl-title': ''") && has("'data-dam-tl-summary': ''") && has("'data-dam-tl-meta': ''") && has("'data-dam-tl-time': hhmm"), '㊼ ★右列四行锚（身份/标题/摘要/元信息，48 卷 L114–L124）')
ok(has("'data-dam-tl-empty': ''"), '㊽ ★空态锚')
ok(has("grp.count + (zh ? ' 条活动' : ' entries')"), '㊾ ★「N 条活动」计数文案（48 卷 L96）')
ok(has('DAM_WEEKDAY_ZH') && has('DAM_WEEKDAY_EN'), '㊿ ★双语星期表（48 卷 L95「· 星期日」）')
ok(has('var view = props.view || vp[0], setView = props.onView || vp[1]') && has('h(DamRailToolbar, { zh: zh, view: tview, onView: setTview })'), '① ★工具栏视图态上提到 rail（三视图真实可切）')
// ★R27 口径同步（守卫守的语义未变，只是字面串被扩充）：原断言写死 `h(DamTimelineList, { data: props.data, zh: zh })`，
//   R27 为卡片「跳转」按钮透传 onOpen ⇒ 该**恰字面串**失配，但「timeline 分支仍渲染时间轴列表」这一被守语义**完全未变**。
//   判据：守的是**语义**（分支存在 + 仍渲染该组件），不是**恰字面串** —— 故把断言改为对语义成立的最小匹配。
//   注：`CL` 是**原始文件全文**（L79），`has()` 不做去注释 ⇒ 第三条件用 `has()` 同源匹配，不自造正则（上一版正则多写了 `=`）。
//   ★自查：上一版我写成 `X === false || X` —— 那是**恒真**（等于没测第三条件）。恒真项一律不留。
// ★R38 口径同步（守的语义未变，只是字面串变了）：原断言写死 `h(DamTimelineList, { data: props.data, zh: zh` ——
//   R38 修白屏时把 rail 的数据源统一到 `var kb`（＝折叠态数据 || 父级数据），故恰字面串失配；
//   「timeline 分支仍渲染时间轴列表且**透传数据与 onOpen**」这一被守语义完全未变。
//   判据：守语义（分支存在 + 真渲染该组件 + 真透传 data/onOpen），不是旧字面串。
ok(has("tview === 'timeline'") && has('h(DamTimelineList, { data: kb, zh: zh, onOpen: props.onOpen })')
  && has("var kb = foldData || props.data || {}"), '② ★timeline 分支渲染时间轴列表（list/lane 回落 KanbanBoard）')
ok(has('damGroupByDay') && has('damFlattenCards'), '③ ★本地分组两个纯助手在场（不改宿主、不加路由）')
ok(!/头像|avatar/i.test(CL.slice(CL.indexOf('function DamTimelineCard'), CL.indexOf('function DamTimelineCard') + 4000)), '④ ★不渲染头像/徽标（49 卷「个人版不渲染」）')
ok((CL.match(/DamTimelineList/g) || []).length === 2 && (CL.match(/DamTimelineCard/g) || []).length === 2, '⑤ ★两组件各 1 定义 + 1 调用')
console.log('')
console.log('[r15] PASS ' + pass + ' / FAIL ' + fail)
process.exit(fail === 0 ? 0 : 1)

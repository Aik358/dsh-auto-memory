/**
 * R15 验收：看板左侧栏 8 项（15a 左栏结构 / 15b 与泳道联动）。
 *   真 import lib/wb-sidecar.js ⇒ 真调用 buildRailPre / railToViewPre ⇒ 可复算物理量 + 负路径。
 * ★权威：48 卷 L54–L57（8 项逐字顺序 + 第 2 项选中）· 55 卷 L40/L97（8 项名称 +「页签内自带左侧栏」）
 *        · 42 卷 Q2 用户原话「它肯定是页签内自带」· 70 卷 L96（判据：与 v4 基准图对齐 sha 77bebc7c）。
 */
import { readFileSync } from 'node:fs'
import { scanAppearance, stripComments } from '../../tools/lib/appearance-scan.mjs'
import vm from 'node:vm'
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
// ★★D14（2026-10-24 用户裁定 + 当面指示）：白板页签改为事件视图；看板左栏**保留但未接线**。
//   本条原本防的事故是「左栏被挂到宿主 view 而不是页签内自带」——看板退场后该不变量自然消失。
//   改为守**替换后的等价不变量**：① 白板页签渲染事件视图；② 看板 rail 不得再被调用；
//   ③ 左栏的那组 UI 组件**必须仍在源码里**（用户明确要求「不要误删不该删的东西」）。
ok(CL.indexOf('data-dam-event-surface') >= 0, '⑲ ★client.js 已挂事件视图面（data-dam-event-surface）')
ok(CL.indexOf('h(EventView, { zh: locale') >= 0, '⑳ ★白板页签调用 EventView（D14 替换看板）')
ok(CL.indexOf("h(KanbanBoardRail, { data: kbData") < 0, '⑳b ★负：不再调用看板 rail（D14 退场）')
ok(CL.indexOf('function DamRailToolbar(props) {') >= 0 && CL.indexOf('function DamStatBar(props) {') >= 0 && CL.indexOf('function DamFoldBar(props) {') >= 0, '⑳c ★左栏 UI 资产**保留在源码**（用户要求：不误删可继承的东西）')
// ★D14（2026-10-24 用户裁定）：白板页签改为事件视图，看板组件按 D13 退出白板页签。
//   本条原本防的事故是「左栏换 Rail 时把 KanbanBoard 本体吞掉/替换」——
//   现在 KanbanBoardRail 已不在白板页签渲染，该不变量**自然消失**；
//   改为守**替换后的等价不变量**：白板页签必须渲染事件视图，且不得再渲染看板。
ok(CL.indexOf('h(EventView, { zh: locale') >= 0, '㉑ ★白板页签调用点已换用 EventView（D14）')
ok(CL.indexOf("h(KanbanBoardRail, { data: kbData") < 0, '㉑b ★负：白板页签已不再渲染 KanbanBoardRail（D14 删看板）')
ok(CL.indexOf('function KanbanBoard(props) {') < 0, '㉒ ★负：KanbanBoard 已按 D13/D14 删除（不再占体量）')
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
// ★D14：旧「三视图切换组」随 rail 退场（`data-dam-viewgroup` 已无）；判据改为守**新的切换组存在且按钮不重复**。
// `data-dam-view-btn` 实测 3 处：旧工具栏 1 处（保留未接线）+ 事件视图 2 处 ⇒ 判据不能按全文件总数。
// ★R2026-10-25 判据演进（**不是放宽**）：用户 2026-10-25 明确裁定「workflow 三视图必须做」
//   ⇒ 事件视图从 D14 的两档（卡片/时间轴）升级为**三档（stream/lanes/workflow）**。
//   原判据「恰两档 cards/timeline」的两个被检字面量已不存在（旧两档是过渡态），属**判据过期**。
//   不变量本体保持不变：**切换组容器在场 + 每档按钮各恰好 1 个 + 不重复**。
//   ⇒ 改为守三档，并对每档单独断言「恰 1 个」（比原来「两档各 1」更严格：多一档就多一组计数检查）。
ok(has("'data-dam-event-viewswitch': ''"), '㉜a ★事件视图切换组容器在场')
// ★2026-10-25 判据收紧（**不是放宽**）：原判据按「全文件字面量出现次数 === 1」，
//   但仓库里存在**旧工具栏（保留未接线）**也用 data-dam-view-btn（值是变量 it.key，不是字面量）。
//   全文件计数会把「事件视图的 1 个」与「旧工具栏的变量用法」混在一起，既误报也测不准。
//   ⇒ 改为**按作用域切片计数**：只在 EventView 的切换组区块里数，且每档必须**恰 1 个**。
//   不变量本体不变（每档唯一），而且比原来更能定位问题：少一个/多一个都会精确报出档位。
function blockOf (marker, endMarker) {
  const a = CL.indexOf(marker)
  if (a < 0) return ''
  const b = CL.indexOf(endMarker, a)
  return b > a ? CL.slice(a, b) : CL.slice(a)
}
const vswitchBlock = blockOf("'data-dam-vswitch': ''", "'data-dam-chips': ''")
ok(vswitchBlock.length > 200, '㉜-pre ★事件视图切换组区块可切出（' + vswitchBlock.length + ' 字符）')
const vmCount = (m) => (vswitchBlock.split("'data-dam-view-btn': '" + m + "'").length - 1)
ok(vmCount('stream') === 1, '㉜b ★三档按钮 stream 恰 1 个（实测 ' + vmCount('stream') + '）')
ok(vmCount('lanes') === 1, '㉜c ★三档按钮 lanes 恰 1 个（实测 ' + vmCount('lanes') + '）')
ok(vmCount('workflow') === 1, '㉜d ★三档按钮 workflow 恰 1 个（实测 ' + vmCount('workflow') + '）')
// 负路径：区块外**不得**再出现这三档字面量（防有人把按钮复制到别处造成重复交互）
const outsideBlock = CL.replace(vswitchBlock, '')
ok(!/'data-dam-view-btn': 'stream'/.test(outsideBlock), '㉜f ★[负] 区块外无重复的 stream 字面量')
ok(has("'data-dam-view-active'"), '㉜e ★当前档高亮锚在场（三档切换的可测状态）')
ok(has('function DamStatBar(props) {'), '㉝ ★统计条组件在场（48 卷 L78–L89）')
const statKeys = ['today', 'week', 'members', 'archived'].every((k) => has("{ key: '" + k + "', tint:"))
ok(statKeys, '㉞ ★统计元 4 项 key 齐（today/week/members/archived）')
ok(has("'data-dam-stat': m.key"), '㉟ ★每张卡带 data-dam-stat 锚（供视觉回归定位）')
ok(has("'data-dam-statbar': ''"), '㊱ ★统计条容器锚')
ok(has('function DamFoldBar(props) {') && has("'data-dam-foldbar': ''") && has("'data-dam-fold-pill': ''"), '㊲ ★折叠条组件 + 容器锚 + 胶囊锚（46 卷 L122–L124）')
ok(has("'data-dam-fold-days'") && has("'data-dam-fold-count'"), '㊳ ★折叠条三量落 DOM 属性（days / count）')
ok(has("折叠条本轮纯展示") || has("text + ' ▾'"), '㊴ 折叠条字号 12px（按 token）')

/* ---- ㊵–㊸ ★外观层纪律（R15c 硬约束）---- */
/* ★★2026-10-25 判据升级（Lead 裁定 D）：从「按位置豁免」改为「按声明语义豁免」
   背景：E1 照搬原型 412 条 CSS（EV4_CSS），其色值全部集中写在 `--xxx:` 声明里，
   选择器层一律引用 var()。这与本守卫的真实意图**完全一致**，只是载体从 --dam-* 换成了
   作用域 token .dam-ev4{--bg:...}。原「只豁免 damLegacyOverlayGlass() 函数体」的位置豁免
   无法覆盖它，且**位置豁免本身是橡皮图章**（给了一个"以后往这个块里塞裸色值也不会红"的口子）。

   ★新判据（语义）：**声明的属性名以 -- 开头 ⇒ 视为 token 定义，豁免；否则视为裸用，必须为 0。**
     理由：守卫的真实意图是「色值不许散落在选择器里，必须集中成 token，选择器只引用 var()」。
     按声明豁免同时覆盖「换个块名规避」的情况，按位置豁免做不到。

   ★防退化：三条变异（见下方 ㊵m1/m2/m3）+ 下限断言（token 声明数 ≥ 40）。
     原「豁免后 ≥90% 源文」是被动防御，已被这三条主动变异取代。

   ★扫描必须用声明级切分（tests/lib/css-decl-scan.mjs）：
     文本正则会犯两类错 —— ①块内注释粘到后续声明（`/* 阴影 *\/ --sh1:rgba(...)` 被当成裸用，
     实测多算 6 个 rgba）②@media 嵌套不按深度切分。声明级扫描用 ; 切 + 判首字符，且带深度计。 */
import { scanDeclarations, countColors } from '../lib/css-decl-scan.mjs'

// ── ㊵/㊶ 主判据：EV4_CSS 与全文件，声明级零裸色值 ──────────────────────────
const ev4At = CL.indexOf('var EV4_CSS = [')
let ev4Css = ''
if (ev4At >= 0) {
  const ob = CL.indexOf('[', ev4At)
  let dep = 0, cb = -1
  for (let i = ob; i < CL.length; i++) { const ch = CL[i]; if (ch === '[') dep++; else if (ch === ']') { dep--; if (dep === 0) { cb = i; break } } }
  // 真求值数组字面量（不是文本匹配）
  const ev4Arr = vm.runInNewContext('(' + CL.slice(ob, cb + 1) + ')', {})
  ev4Css = ev4Arr.join('\n')
}
ok(ev4Css.length > 40000, '㊵0 EV4_CSS 真求值成功（' + ev4Css.length + ' 字符）')

const ev4Counts = countColors(scanDeclarations(ev4Css))
ok(ev4Counts.bareHex === 0, '㊵ ★EV4_CSS 声明级零裸 hex（实测 ' + ev4Counts.bareHex + '；token 内 ' + ev4Counts.tokenHex + ' 已豁免）')
ok(ev4Counts.bareRgba === 0, '㊶ ★EV4_CSS 声明级零裸 rgba（实测 ' + ev4Counts.bareRgba + '；token 内 ' + ev4Counts.tokenRgba + ' 已豁免）')
ok(ev4Counts.tokenDeclCount >= 40, '㊵d ★豁免的 token 声明数 ≥ 40（实测 ' + ev4Counts.tokenDeclCount + '，防 token 块被整体删掉后判据扫不到东西而恒绿）')
ok(ev4Counts.hex === 60 && ev4Counts.rgba === 25, '㊵e ★色值总量守恒（hex ' + ev4Counts.hex + ' / rgba ' + ev4Counts.rgba + '，全部在 token 内 —— 证明是"搬家"而非"删值"）')

// ── 全文件：沿用既有 scanAppearance 口径 ────────────────────────────────
// ★为什么全文件**不用**声明级扫描（本轮实测）：声明级切分会把
//   ① 其他 CSS 块里 var(--x, <fallback>) 的兜底色当成裸用（那是既有正常写法，量 286/351）
//   ② JS 对象字面量里的 'color'/'background' 键误当 CSS 声明
//   ⇒ 声明级扫描只适用于 EV4_CSS（纯 CSS 文本，无 JS 混入、且已 token 化）。
//   全文件继续用 scanAppearance（它会剥 var() 内容，正是为这件事设计的）。
// ★全文件判据分两段（各自用合适口径）：
//   (a) **EV4_CSS 之外**的既有代码：沿用 scanAppearance（已掩 var() 兜底、已认 --dam-*/--skin-* 定义）
//   (b) **EV4_CSS 内部**：用声明级扫描（上面已断言过）
//   为什么不把 EV4_CSS 混进 (a)：scanAppearance 的 DEF 只认 --dam-*/--skin-*，
//   会把 EV4 的 --bg: / --sh1: 当成裸值（实测假数 60/25）——**判据口径必须与目标文本匹配**。
// ★★2026-10-25 S1 判据扩展：还要剔除 **EV4-BLOCKS 内联区**。
//   理由：那是**原型源码的原样切片**（EV4_PROTO_CSS 44,439 字符，含 176 class / 大量原型自带 hex·rgba），
//   由 tools/gen-ev4-blocks.mjs 从 lib/ev4-prototype-blocks.js 生成。
//   ★本仓「零裸色值」纪律针对**我们自己写的**样式；要求原型切片也 token 化 =
//     等于改原型源码 = 违反用户「原型源码一个字都不许改」的铁律。
//   ⇒ 豁免它，并加**长度守恒断言**防豁免退化为放宽（下面 ㊵0b）。
const VENDOR_RE = /\/\/ ═══ EV4-BLOCKS 内联区[^\n]*\n[\s\S]*?\/\/ ═══ EV4-BLOCKS 内联区结束 ═══/
const CL_NO_VENDOR = CL.replace(VENDOR_RE, '\n/* [EV4-BLOCKS 内联区 —— 原型源码原样切片，已豁免色值扫描] */\n')
const CL_NO_EV4 = (() => {
  const at = CL_NO_VENDOR.indexOf('var EV4_CSS = [')
  if (at < 0) return CL_NO_VENDOR
  const ob = CL_NO_VENDOR.indexOf('[', at)
  let dep = 0, cb = -1
  for (let i = ob; i < CL_NO_VENDOR.length; i++) { const ch = CL_NO_VENDOR[i]; if (ch === '[') dep++; else if (ch === ']') { dep--; if (dep === 0) { cb = i; break } } }
  return CL_NO_VENDOR.slice(0, at) + CL_NO_VENDOR.slice(cb + 1)
})()
// ★㊵0b 长度守恒：内联区必须被**精确剔除**（不是顺手删掉一大片）
const vendorM = CL.match(VENDOR_RE)
ok(!!vendorM, '㊵0b ★EV4-BLOCKS 内联区可定位')
ok(vendorM && vendorM[0].length > 120000, '㊵0b ★剔除的内联区 ≥12 万字符（实测 ' + (vendorM ? vendorM[0].length : 0) + '）')
ok(CL_NO_EV4.length < CL.length - 100000, '㊵0b ★剔除后确实变短（防"没剔到却全绿"）')
const CL_SKINNABLE = CL_NO_EV4.replace(/function damLegacyOverlayGlass\(\) \{[\s\S]*?\n    \}/, '')
// ★基数改成「剔除原型切片后的正文」，否则原型占 5% 会让这条恒红
const OUR_CODE_LEN = CL_NO_EV4.length
ok(CL_SKINNABLE.length > OUR_CODE_LEN * 0.9, '㊵0 ★豁免后仍保留 ≥90% 自研正文（实测 ' + (CL_SKINNABLE.length / OUR_CODE_LEN * 100).toFixed(1) + '%，防豁免退化为放宽）')
const bare = scanAppearance(CL_SKINNABLE)
ok(bare.hex === 0, '㊵ ★EV4_CSS 之外零裸 hex（默认档玻璃段豁免；实测 ' + bare.hex + '）')
ok(bare.rgba === 0, '㊶ ★EV4_CSS 之外零裸 rgba（默认档玻璃段豁免；实测 ' + bare.rgba + '）')

// ── 三条变异（都必须真跑、必红；证明豁免是按声明而非按位置、按语义而非按名字白名单）──
// ㊵m1：往任意普通声明里插一个 #abc ⇒ bare hex 必增
const mut1 = ev4Css.replace('.card{', '.card{color:#abc;')
ok(mut1 !== ev4Css, '㊵m1[变异] 成功往 .card 里插 #abc')
const m1c = countColors(scanDeclarations(mut1))
ok(m1c.bareHex > 0 && ev4Counts.bareHex === 0, '㊵m1 ★★[变异] 插裸色值后 bareHex 由 0 变 ' + m1c.bareHex + ' ⇒ ㊵ 必红（判据非恒真）')

// ㊵m2：把某个 token 改写成直接声明（token→裸用）⇒ bare hex 必增
const mut2 = ev4Css.replace('--bg:#f4f6f9', 'background:#f4f6f9')
ok(mut2 !== ev4Css, '㊵m2[变异] 成功把 --bg token 改成 background 直写')
const m2c = countColors(scanDeclarations(mut2))
ok(m2c.bareHex > 0, '㊵m2 ★★[变异] token→裸用后 bareHex 变 ' + m2c.bareHex + ' ⇒ ㊵ 必红')

// ㊵m3：把 token 改个名字但仍是 -- 开头 ⇒ **必须仍然绿**（证明豁免按声明、不按名字白名单）
const mut3 = ev4Css.replace('--bg:#f4f6f9', '--zz-renamed-bg:#f4f6f9')
ok(mut3 !== ev4Css, '㊵m3[变异] 成功把 --bg 改名为 --zz-renamed-bg')
const m3c = countColors(scanDeclarations(mut3))
ok(m3c.bareHex === 0, '㊵m3 ★★[变异] token 改名后仍零裸用（实测 ' + m3c.bareHex + '）⇒ 证明豁免按「声明是否 -- 开头」而非名字白名单')

// ㊷c ★默认档玻璃段确实存在且为字面量实现（负路径守卫：若它被删/改坏会立刻红）
const bareFull = scanAppearance(CL)

/* ---- ㊷b–㊹b ★R18 外观层收口（D1 / D9 核查）---- */
/* ★度量复用共享模块（第 9 条纪律）：去注释后统计「有消费·无定义」。
   白名单 6 条均有明确根据：--dam-user-scale 由 JS 运行时注入；--dam-radius 为团队层 CSS 段专用且带兜底 8px；
   --dam-detail-w 由 JS 运行时注入（applyDetailWidthPre 逐帧 setProperty 写宽度，右栏抽屉动画用）—— 与 user-scale 同型；
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
// ★2026-10-25 白名单扩充（+rail-w）：E2 左轨时间轴新增 --dam-rail-w（336px），
//   它是**三列栅格的第一列宽**，与既有 --dam-detail-w（右栏宽）同构：
//   都有 JS 注入点（E5 接可拖分隔条时写 setProperty），都在 CSS 里被 grid-template-columns 消费。
//   白名单判据意图不变（守的是「无兜底项=0 / 视觉安全」，不是钉死 token 集合）。
const EXPECT_TOKENS = ['user-scale', 'radius', 'team-actor-hue', 'skin-backdrop-opacity', 'bg-deep', 'detail-w', 'rail-w']
ok([...auditTok.keys()].every((k) => EXPECT_TOKENS.includes(k)), '㊷b ★D1 真值全在白名单（实测 ' + [...auditTok.keys()].join(',') + '）')
ok([...auditTok.values()].every((v) => v.bare === 0), '㊸b ★D1 无兜底项 = 0（视觉安全）')
ok(auditTok.has('skin-ratio') === false && has('--dam-skin-ratio: 4 / 3;'), '㊹b ★--dam-skin-ratio 客户覆写点已闭合（定义 + 消费）')
ok(/--dam-user-scale/.test(CL) && /'--dam-user-scale':/.test(CL), '㊺b ★--dam-user-scale 由 JS 运行时注入（非缺陷，有据）')
// ★对称守卫（2026-10-25）：--dam-detail-w 也必须**有 JS 注入点**，防止它退化成「只在 CSS 里消费、没人写」的死变量。
//   （这正是 --dam-state-warn 犯过的错：有消费无定义 ⇒ 静默回退兜底值、无人知晓。）
ok(/setProperty\('--dam-detail-w'/.test(CL), '㊺c ★--dam-detail-w 由 JS 运行时注入（applyDetailWidthPre setProperty，非死变量）')
ok((CL.match(/@supports/g) || []).length > 0 && stripC(CL).split('\n').filter((l) => /@supports/.test(l)).every((l) => { let d = 0; for (const c2 of l) { if (c2 === '(') d += 1; else if (c2 === ')') d -= 1; if (d < 0) return false } return d === 0 }), '㊻b ★D9 订正：@supports 括号配平（原判「括号错误」有误）')
// ★D14：看板三组件已退场（KanbanBoard/Rail 删除）；主区三件套（工具栏/统计条/折叠条）保留未接线。
ok(!has('function KanbanBoard(props) {') && !has('function KanbanBoardRail(props) {'), '㊷ ★负：看板组件已按 D13/D14 删除')
ok(has('function DamStatBar(props) {'), '㊷b ★主区三件套保留在源码（未接线，留给事件视图继承）')
// ★D14：旧调用点随 rail 删除；`DamStatBar` 已被**事件视图复用**（+1 处调用）。
//   原意 = 「不重复挂载」（同一组件不得被定义两次 / 挂载两次）。改守：**各恰 1 个定义**，
//   且 `DamStatBar` 恰 1 个调用点（事件视图用它），`DamFoldBar`/`DamRailToolbar` 当前 0 调用（未接线）。
// 用朴素字符串计数（正则转义层数易错，本会话已踩过）：定义 = 'function X('，调用 = "h(X,"。
const defCnt = (n) => CL.split('function ' + n + '(').length - 1
const callCnt = (n) => CL.split('h(' + n + ',').length - 1
ok(defCnt('DamFoldBar') === 1 && defCnt('DamStatBar') === 1 && defCnt('DamRailToolbar') === 1, '㊸a ★三组件各恰 1 个定义（不重复定义）')
ok(callCnt('DamStatBar') >= 1, '㊸b ★DamStatBar 已被事件视图复用（实测 ' + callCnt('DamStatBar') + ' 个调用点）')
ok(callCnt('DamFoldBar') === 0 && callCnt('DamRailToolbar') === 0, '㊸c ★DamFoldBar / DamRailToolbar 当前未接线（保留待适配）')

/* ---- ㊹–㊿ ★R15d 时间轴列表（48 卷 L91–L125 · 46 卷 L87–L120 · 49 卷 §四）---- */
ok(has('function DamTimelineList(props) {') && has('function DamTimelineCard(props) {'), '㊹ ★时间轴列表 + 卡片两组件在场')
ok(has("'data-dam-tl': ''") && has("'data-dam-tl-group': grp.day") && has("'data-dam-tl-head': grp.day"), '㊺ ★容器锚 + 日期分组锚（48 卷 L94）')
ok(has("'data-dam-tl-card': c.id || ''") && has("'data-dam-tl-rail': ''") && has("'data-dam-tl-dot': laneKey || ''"), '㊻ ★卡片锚 + 左列竖线/节点圆点锚（48 卷 L104–L112）')
ok(has("'data-dam-tl-title': ''") && has("'data-dam-tl-summary': ''") && has("'data-dam-tl-meta': ''") && has("'data-dam-tl-time': hhmm"), '㊼ ★右列四行锚（身份/标题/摘要/元信息，48 卷 L114–L124）')
ok(has("'data-dam-tl-empty': ''"), '㊽ ★空态锚')
ok(has("grp.count + (zh ? ' 条活动' : ' entries')"), '㊾ ★「N 条活动」计数文案（48 卷 L96）')
ok(has('DAM_WEEKDAY_ZH') && has('DAM_WEEKDAY_EN'), '㊿ ★双语星期表（48 卷 L95「· 星期日」）')
// ★D14：rail 已退场，「工具栏与 rail 的视图态联动」这个不变量随宿主一起消失；
//   改为守「工具栏组件与其视图态参数仍在」（保留资产，将来接事件视图时要能直接复用）。
ok(has('function DamRailToolbar(props) {') && has('var view = props.view || vp[0], setView = props.onView || vp[1]'), '① ★工具栏组件与其视图态参数保留（可继承资产）')
// ★R27 口径同步（守卫守的语义未变，只是字面串被扩充）：原断言写死 `h(DamTimelineList, { data: props.data, zh: zh })`，
//   R27 为卡片「跳转」按钮透传 onOpen ⇒ 该**恰字面串**失配，但「timeline 分支仍渲染时间轴列表」这一被守语义**完全未变**。
//   判据：守的是**语义**（分支存在 + 仍渲染该组件），不是**恰字面串** —— 故把断言改为对语义成立的最小匹配。
//   注：`CL` 是**原始文件全文**（L79），`has()` 不做去注释 ⇒ 第三条件用 `has()` 同源匹配，不自造正则（上一版正则多写了 `=`）。
//   ★自查：上一版我写成 `X === false || X` —— 那是**恒真**（等于没测第三条件）。恒真项一律不留。
// ★R38 口径同步（守的语义未变，只是字面串变了）：原断言写死 `h(DamTimelineList, { data: props.data, zh: zh` ——
//   R38 修白屏时把 rail 的数据源统一到 `var kb`（＝折叠态数据 || 父级数据），故恰字面串失配；
//   「timeline 分支仍渲染时间轴列表且**透传数据与 onOpen**」这一被守语义完全未变。
//   判据：守语义（分支存在 + 真渲染该组件 + 真透传 data/onOpen），不是旧字面串。
// ★D14：`tview === 'timeline'` 与 `h(DamTimelineList, ...)` 都在已删除的 rail 里 ⇒ 这两个子判据失效。
//   保留的语义：**时间轴组件仍在源码**（用户要求不误删可继承资产）。
ok(has('function DamTimelineList(props) {') && has('function DamTimelineCard(props) {'), '② ★时间轴两组件定义保留（原「timeline 分支渲染」随 rail 退场）')
ok(has('damGroupByDay') && has('damFlattenCards'), '③ ★本地分组两个纯助手在场（不改宿主、不加路由）')
ok(!/头像|avatar/i.test(CL.slice(CL.indexOf('function DamTimelineCard'), CL.indexOf('function DamTimelineCard') + 4000)), '④ ★不渲染头像/徽标（49 卷「个人版不渲染」）')
// ★D14：调用点已随 rail 删除 ⇒ 现在各剩 1 处（只有定义）。这条从「定义+调用」改为「定义仍在」。
// ★D14：调用点随 rail 退场。判据从「各 1 定义 + 1 调用」改为「**定义仍在**」（用 function 声明串判，计数会因
//   注释/内部调用而漂移 —— 实测 DamTimelineCard 出现 3 处：定义 + DamTimelineList 内调用 + 注释）。
ok(has('function DamTimelineList(props) {') && has('function DamTimelineCard(props) {'), '⑤ ★两组件定义仍在（调用点随 rail 退场，资产保留）')
console.log('')
console.log('[r15] PASS ' + pass + ' / FAIL ' + fail)
process.exit(fail === 0 ? 0 : 1)
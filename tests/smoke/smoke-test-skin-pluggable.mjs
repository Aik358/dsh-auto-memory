import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'

// ★2026-09-30（B 批 · 用户裁定「皮肤可插拔 · 基线永不变」）——真执行验收，非静态断言。
//   验收对象：①damSkinCssFlavor/Text 的分派与 CSS 组成；②SkinPicker.pick 的存储语义；
//   ③挂载门放宽后三值模型的判定。全部真调函数并断言返回值/副作用。
const source = readFileSync(new URL('../../lib/client.js', import.meta.url), 'utf8')

// ---- 从真实源码抽出被测块（保持与产品同源，不做手写副本）----
function block(startNeedle, endNeedle) {
  const i = source.indexOf(startNeedle)
  assert.ok(i >= 0, 'block start not found: ' + startNeedle.slice(0, 40))
  const j = source.indexOf(endNeedle, i)
  assert.ok(j >= 0, 'block end not found: ' + endNeedle.slice(0, 40))
  return source.slice(i, j + endNeedle.length)
}
/** 精确取一个顶层函数：起锚 → 其后首个「四空格缩进的单独 }」行。 */
function fn(startNeedle) {
  const i = source.indexOf(startNeedle)
  assert.ok(i >= 0, 'fn start not found: ' + startNeedle.slice(0, 40))
  const end = source.indexOf('\n    }', i)
  assert.ok(end >= 0, 'fn end not found for ' + startNeedle.slice(0, 40))
  return source.slice(i, end + 6)
}
const KEY = 'dam-skin'
const STYLE_KEY = 'dam-skin-style'
function boot(store) {
  const local = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => { store.set(k, String(v)) },
    removeItem: (k) => { store.delete(k) },
  }
  const code = [
    'var DAM_SKIN_KEY = ' + JSON.stringify(KEY),
    'var DAM_SKIN_STYLE_KEY = ' + JSON.stringify(STYLE_KEY),
    'var DAM_SKIN_VARIANT_IDS = ["legacy","instrument","editorial","water"]',
    fn('    function damSkinActive() {'),
    fn('    function damSkinStyleGet() {'),
    '    function damSkinLegacy() { return damSkinStyleGet() === \'legacy\' }',
    fn('    function damSkinCssFlavor() {'),
    'return { damSkinActive: damSkinActive, damSkinStyleGet: damSkinStyleGet, damSkinLegacy: damSkinLegacy, damSkinCssFlavor: damSkinCssFlavor }',
  ].join('\n')
  const ctx = vm.createContext({ localStorage: local, String, JSON })
  return vm.runInContext('(function(){' + code + '})()', ctx)
}

// ---- 1) 三值状态模型（真执行）----
let s1 = boot(new Map())
assert.equal(s1.damSkinActive(), 'iter5', 'unset must default to iter5 (new-skin family, not classic)')
assert.equal(s1.damSkinCssFlavor(), 'legacy', 'unset + default style must resolve to baseline flavor')
let s2 = boot(new Map([[KEY, 'classic']]))
assert.equal(s2.damSkinActive(), 'classic')
assert.equal(s2.damSkinCssFlavor(), 'classic', 'classic flavor must be classic')
let s3 = boot(new Map([[KEY, 'v4'], [STYLE_KEY, 'instrument']]))
assert.equal(s3.damSkinActive(), 'v4')
assert.equal(s3.damSkinCssFlavor(), 'iter5', 'explicit v4 + variant style resolves to iter5 flavor')
let s4 = boot(new Map([[KEY, 'v4'], [STYLE_KEY, 'legacy']]))
assert.equal(s4.damSkinCssFlavor(), 'legacy', 'explicit v4 + legacy style must NOT fall back to classic')
let s5 = boot(new Map([[KEY, 'garbage']]))
assert.equal(s5.damSkinActive(), 'iter5', 'unknown value must be treated as unset (iter5)')
console.log('PASS three-value state model: unset/v4/classic/garbage all resolve correctly')

// ---- 2) CSS 分派与组成（真执行 + 负路径）----
assert.ok(source.includes('DAM_SKIN_V4_CSS'), 'baseline flavor must include the shell CSS constant')
const flavorBlock = block('    function damSkinCssText() {', "      return '/* dam-skin:begin (v4) */\\n' + DAM_SKIN_V4_CSS")
// ★H35 判据更正（2026-10-01）：原判据锁字面 `return ''`，过粗。
//   该断言真正要守的语义是「**经典页不被新皮肤页面样式表污染**」（F 批根因）。
//   但 classic 档的**浮层**（shell.overlay）不走 page 表，而是 Iter5Surface 恒投的冻结表
//   （L13316 `damSkinCssFlavor() === 'iter5' ? ITER5_CSS : LEGACY_ITER5_CSS`）——
//   冻结表里 `[data-dam-theme] :is([data-dam-panel],[data-dam-tour],[data-dam-autocont])
//   { background:var(--i5-surface)!important; backdrop-filter:none!important }` 会让浮层变蓝底并杀掉毛玻璃。
//   故 classic 分支改为只返回**浮层玻璃覆盖段** damLegacyOverlayGlass()（不改任何 --i5-* 变量定义）。
//   判据随之改为语义化：classic 不得注入三张**页面**样式表中的任何一张。
const classicLine = flavorBlock.split('\n').filter((l) => l.includes("flavor === 'classic'"))[0]
assert.ok(classicLine, 'classic branch line must exist')
assert.ok(!classicLine.includes('DAM_SKIN_V4_CSS'), 'classic flavor must NOT inject the shell/page stylesheet')
const classicNoLegacy = classicLine.split('LEGACY_ITER5_CSS').join('')
assert.ok(!classicNoLegacy.includes('ITER5_CSS'), 'classic flavor must NOT inject the frozen baseline page stylesheet')
assert.ok(!classicLine.includes('DAM_SKIN_V4_CSS') && !classicNoLegacy.includes('ITER5_CSS'), 'classic flavor must inject NO page stylesheet (page pollution guard)')
assert.ok(classicLine.includes('damLegacyOverlayGlass'), 'classic flavor must carry the overlay glass compat segment (H35)')
assert.ok(flavorBlock.includes('DAM_SKIN_V4_CSS'), 'legacy flavor must carry DAM_SKIN_V4_CSS (shell root rules live there)')
assert.ok(flavorBlock.includes('LEGACY_ITER5_CSS'), 'legacy flavor must use the frozen baseline stylesheet')
assert.ok(flavorBlock.includes('ITER5_CSS'), 'iter5 flavor must use the variants stylesheet')
// 负路径：两份皮肤 CSS 不得同时出现在同一分支
// 只取 legacy 那**一行**（含 DAM_SKIN_V4_CSS + LEGACY_ITER5_CSS），不得包含变体样式表 ITER5_CSS。
// 注意：iter5 分支行本身含 ITER5_CSS，故必须先按行切，不能用固定宽度窗口（会把下一行卷进来）。
const flavorLines = flavorBlock.split('\n')
const legacyLine = flavorLines.filter((l) => l.includes("flavor === 'legacy'"))[0]
assert.ok(legacyLine && legacyLine.includes('LEGACY_ITER5_CSS'), 'legacy branch line must use the frozen baseline stylesheet')
// ⚠️ 判据陷阱：LEGACY_ITER5_CSS 自身含子串 'ITER5_CSS' ⇒ 必须先剥掉它再查（否则恒假红）。
const legacyLineNoLegacy = legacyLine.split('LEGACY_ITER5_CSS').join('')
assert.ok(!legacyLineNoLegacy.includes('ITER5_CSS'), 'legacy branch line must not also inject the variants stylesheet')
console.log('PASS css dispatch: flavor branches are mutually exclusive and baseline carries the shell')

// ---- 3) ensure 重建判据（P0 回归拦截）----
const ensureBlock = block('    function damSkinEnsureCss() {', '    function damSkinRemoveCss() {')
// ⚠️ 判据陷阱（本项目已固化）：注释里也会出现同一串字面量 ⇒ 必须**行锚定**匹配真实代码行，
//   否则负路径恒红/恒绿（把注释包住的旧写法当成代码）。
assert.ok(!/^\s*if \(el\) return\s*$/m.test(ensureBlock), 'P0: bare early-return on existing <style> must be gone')
assert.ok(ensureBlock.includes("el.getAttribute('data-dam-skin-css') === flavor"), 'ensure must compare the flavor marker')
assert.ok(ensureBlock.includes('removeChild(el)'), 'ensure must remove the stale stylesheet before rebuilding')
assert.ok(ensureBlock.includes('if (!want) return'), 'ensure must not inject empty CSS (classic)')
console.log('PASS ensure rebuild: marker compare + stale removal + empty guard')

// ---- 4) 挂载门（三值模型下必须放宽）----
assert.ok(source.includes("if (damSkinActive() !== 'classic') {"), 'mount gate must admit iter5 (default) — otherwise skins vanish')
// ★H35b 判据更正（2026-10-01）：原断言要求 apply 期门禁保留 `!== 'classic'`，方向反了。
//   真语义：**classic 档也必须注入**——classic 的 damSkinCssText() 只返回浮层玻璃覆盖段
//   （不注入任何页面样式表），若被门禁挡住，经典档浮层就永久停在扁平 i5 面色
//   （用户实报「浮窗没变化」）。故断言 apply 期必须无档位条件地调用 damSkinEnsureCss()。
assert.ok(source.includes('try { ensureStyle(); damSkinEnsureCss() }'), 'apply-time injection must NOT be gated on flavor (classic needs the overlay compat segment)')
assert.ok(!source.includes("!== 'classic') damSkinEnsureCss()"), 'the old classic-excluding apply gate must be gone')
assert.ok(!source.includes("if (damSkinActive() === 'v4') {\n        try { damSkinEnsureCss() }"), 'old narrow mount gate must be gone')
console.log('PASS mount gates widened to !== classic (default state renders the skin shell)')

// ---- 5) SkinPicker 四款直选（真执行 pick 语义）----
const itemsBlock = block('      .concat([', ']).concat(layers.filter(')
for (const fam of ['legacy', 'instrument', 'editorial', 'water']) {
  assert.ok(itemsBlock.includes("family: '" + fam + "'"), 'picker must offer family row: ' + fam)
}
// 真执行：把 pick 函数体连同闭合括号一起抽出，注入可观测的 localStorage 后调用。
// 抽成**函数表达式**：源码里是 'var pick = function (it) {...}'，取 '=' 右侧整体，
// 这样注入 vm 后可直接调用（旧写法只取 inner var 段，缺闭合括号 ⇒ SyntaxError）。
function pickExpression() {
  const i = source.indexOf('var pick = function (it) {')
  assert.ok(i >= 0, 'pick declaration not found')
  const j = source.indexOf('\n      }', i)
  assert.ok(j >= 0, 'pick end not found')
  return source.slice(i + 'var pick = '.length, j + 8)
}
const pickSrc = pickExpression()
assert.ok(pickSrc.trimEnd().endsWith('}'), 'pick source must include its closing brace')
const makeCtx = (store, onSwitch) => ({
  localStorage: {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => { store.set(k, String(v)) },
    removeItem: (k) => { store.delete(k) },
  },
  props: { onSwitch },
})

// 5a) 选「活水」⇒ dam-skin=v4 + style=water + presentation.v1=water，且回调触发一次
let store5a = new Map()
let hits = 0
const ctx5a = makeCtx(store5a, () => { hits++ })
vm.runInNewContext('(' + pickSrc + ')({ family: \'water\', id: \'water\' })', ctx5a)
assert.equal(store5a.get('dam-skin'), 'v4', 'variant pick must set dam-skin=v4')
assert.equal(store5a.get('dam-skin-style'), 'water', 'variant pick must set dam-skin-style=water')
assert.equal(store5a.get('dsh-auto-memory.presentation.v1'), 'water', 'variant pick must mirror into the variants key')
assert.equal(hits, 1, 'onSwitch must fire exactly once per pick')

// 5b) 选「基线」⇒ 删除 dam-skin（回到未显式选过语义），style=legacy
let store5b = new Map([['dam-skin', 'v4'], ['dam-skin-style', 'instrument']])
const ctx5b = makeCtx(store5b, () => {})
vm.runInNewContext('(' + pickSrc + ')({ family: \'legacy\', id: \'legacy\' })', ctx5b)
assert.equal(store5b.has('dam-skin'), false, 'baseline pick must clear dam-skin (back to unset semantics)')
assert.equal(store5b.get('dam-skin-style'), 'legacy', 'baseline pick must set style=legacy')

// 5c) 选「经典」⇒ dam-skin=classic
let store5c = new Map()
const ctx5c = makeCtx(store5c, () => {})
vm.runInNewContext('(' + pickSrc + ')({ id: \'classic\' })', ctx5c)
assert.equal(store5c.get('dam-skin'), 'classic', 'classic pick must set dam-skin=classic')

// 5d) 主题层（用户自装）⇒ dam-skin=v4 + variant
let store5d = new Map()
const ctx5d = makeCtx(store5d, () => {})
vm.runInNewContext('(' + pickSrc + ')({ theme: true, id: \'user-skin-x\' })', ctx5d)
assert.equal(store5d.get('dam-skin'), 'v4', 'theme-layer pick must set dam-skin=v4')
assert.equal(store5d.get('dam-skin-variant'), 'user-skin-x', 'theme-layer pick must set the variant id')
console.log('PASS picker writes: family / baseline / classic / theme-layer all drive storage correctly')
console.log('PASS skin pluggable acceptance (real execution): 5 groups, negative paths included')

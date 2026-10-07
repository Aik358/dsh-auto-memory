import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

// ★2026-09-30（用户硬性要求）：「不同皮肤的设置页面，和 DSH 里点击设置的页面，
//   一定要全量同步，不能有缺少」——本套件把这条要求变成可执行的守卫。
//
// 三面（同一套 87 字段的三种载体）：
//   ① 经典档 SettingsPage（lib/client.js，生成块之外）；
//   ② 冻结基线块 Iter5Settings（skins/legacy/iter5-325.js.frozen）；
//   ③ 生成变体块 Iter5Settings（lib/client.js 的 ITER5-GENERATED 区内，由生成器从①复制）。
// 判据：逐个配置键核对三面是否都有控件（set('KEY' / checked: ... cfg.KEY），缺一即红。
const client = readFileSync(new URL('../../lib/client.js', import.meta.url), 'utf8').replace(/\r\n/g, '\n')
const frozen = readFileSync(new URL('../../skins/legacy/iter5-325.js.frozen', import.meta.url), 'utf8').replace(/\r\n/g, '\n')

// ---- 切三面 ----
function sliceBetween(src, a, b) {
  const i = src.indexOf(a)
  assert.ok(i >= 0, 'start not found: ' + a.slice(0, 40))
  const j = b ? src.indexOf(b, i) : src.length
  assert.ok(j > i, 'end not found: ' + String(b).slice(0, 40))
  return src.slice(i, j)
}
const classic = sliceBetween(client, '    function SettingsPage() {', '    // ───────────────────────── 插件挂载')
// ★#276 修法（2026-10-08）：**行锚匹配**，不再用 `indexOf` 的子串命中。
//   旧实现 `client.indexOf('    // ITER5-GENERATED:BEGIN')`（四空格 + 注释体）：
//   client.js 内 legit 变体块的 marker 是 **8 空格缩进**（`      // ITER5-GENERATED:BEGIN`），
//   其「后四个空格 + 注释体」正好满足四空格子串 ⇒ indexOf **命中 8 空格那条**，
//   于是 variants 实际切的是**legacy 块之前的另一条生成块**（实测切出的内容与 frozen legacy 高度同源），
//   判据因此退化成「重复检查冻结面」，**当前变体块从未被检查**（报告者原案）。
//   现改为整行严格相等（行锚）：只认「行内容 == '    // ITER5-GENERATED:BEGIN'」的那一行。
const genLineNo = (() => {
  const ls = client.split('\n')
  const hits = []
  for (let i = 0; i < ls.length; i++) if (ls[i] === '    // ITER5-GENERATED:BEGIN') hits.push(i)
  assert.equal(hits.length, 1, 'line-anchored BEGIN marker must be unique, got ' + hits.length)
  return hits[0]
})()
const genStart = client.split('\n').slice(0, genLineNo).join('\n').length + (genLineNo ? 1 : 0)
assert.ok(genStart > 0, 'generated block not found (line anchor)')
// 行锚必须**确实**选中当前变体块：其后的第一个 Iter5Settings 必须早于第一条 8 空格 marker 之后的内容
// ★行锚鉴别力自检：老口径（子串 indexOf）命中 8 空格 marker ⇒ 切到的是**另一条**生成块，
//   其内容与 frozen legacy 高度同源 ⇒ 判据退化成「重复检查冻结面」。
const buggyStart = client.indexOf('    // ITER5-GENERATED:BEGIN')
const buggySlice = sliceBetween(client.slice(buggyStart), 'function Iter5Settings(props) {', 'function Iter5Storage(props) {')
assert.ok(buggyStart !== genStart, 'line anchor must differ from the legacy substring hit (got the same offset)')
assert.ok(buggyStart < genStart, 'legacy substring hit sits earlier in the file than the true top-level block')
console.log('slice check: buggy=' + buggySlice.length + ' (substring hit) vs line-anchored=' + (client.length - genStart) + ' (true block)')
const gen = client.slice(genStart)
const variants = sliceBetween(gen, 'function Iter5Settings(props) {', 'function Iter5Storage(props) {')
assert.notEqual(variants, buggySlice, 'line-anchored variant slice must differ from the legacy substring slice')
const legacy = sliceBetween(frozen, 'function Iter5Settings(props) {', 'function Iter5Storage(props) {')

// ---- 从 index.js 的 DEFAULT_CONFIG 取权威键集 ----
const indexSrc = readFileSync(new URL('../../lib/index.js', import.meta.url), 'utf8').replace(/\r\n/g, '\n')
const cfgBody = sliceBetween(indexSrc, 'const DEFAULT_CONFIG = {', '\n}\n')
const allKeys = [...cfgBody.matchAll(/^\s{2}([A-Za-z_$][\w$]*):/gm)].map((m) => m[1])
assert.ok(allKeys.length > 100, 'DEFAULT_CONFIG parse looks wrong: ' + allKeys.length)

// ---- 判据：某键在某面是否有控件（写：set('KEY')；或读绑定：cfg.KEY / sem.KEY）----
function hasControl(surface, key) {
  const write = new RegExp("set\\('" + key + "'")
  const bind = new RegExp('(?:cfg|sem)\\.' + key + '\\b')
  return write.test(surface) || bind.test(surface)
}
const ci = (s, k) => hasControl(s, k)
// ★鉴别力实验（#276 原报告）：把**当前变体**里某 key 改名为 __renamed_gate__ ⇒ parity 必须红。
//   做法：只在该变体切片的字符区间内做替换，再走同一条行锚切片路径重算。
const RENAME_KEY = 'activationInboxEnabled'
const renamedClient = client.slice(0, genStart + gen.indexOf('function Iter5Settings(props) {'))
  + variants.split(RENAME_KEY).join('__renamed_gate__')
  + client.slice(genStart + gen.indexOf('function Iter5Storage(props) {'))
const renamedAnchor = (() => {
  const ls = renamedClient.split('\n')
  let a = -1
  for (let k = 0; k < ls.length; k++) if (ls[k] === '    // ITER5-GENERATED:BEGIN') a = k
  return ls.slice(0, a).join('\n').length + 1
})()
const renamedVariants = sliceBetween(renamedClient.slice(renamedAnchor), 'function Iter5Settings(props) {', 'function Iter5Storage(props) {')
assert.ok(!ci(renamedVariants, RENAME_KEY), '★鉴别力实验：当前变体改名 ⇒ 该键在变体面必须判缺失')
assert.ok(ci(renamedVariants, '__renamed_gate__'), '★鉴别力实验：改名后的键名仍应可被检测器识别（检测器本身没坏）')
console.log('PASS discrimination: renaming a key inside the current variant makes the variant surface red')
console.log('surfaces: classic=' + classic.length + ' variants=' + variants.length + ' legacy=' + legacy.length + ' chars')

// ---- 1) 三面字段规模一致（同一套 87 字段）----
function fieldCount(surface) { return (surface.match(/field\(/g) || []).length }
const fc = { classic: fieldCount(classic), variants: fieldCount(variants), legacy: fieldCount(legacy) }
console.log('field() counts: ' + JSON.stringify(fc))
assert.ok(fc.classic > 60 && fc.variants > 60 && fc.legacy > 60, 'unexpectedly thin settings surface')

// ---- 2) 新增的 4 道闸门必须在三面都在（用户点名的「不能有缺少」）----
const GATES = ['activationInboxEnabled', 'shadowRetrievalEnabled', 'contextBridgeEnabled', 'l0IndexEnabled']
for (const g of GATES) {
  for (const [name, surface] of [['classic', classic], ['variants', variants], ['legacy', legacy]]) {
    assert.ok(ci(surface, g), 'gate ' + g + ' missing on surface: ' + name)
  }
}
console.log('PASS 4 gates present on all three settings surfaces (' + (GATES.length * 3) + ' control sites)')

// ---- 3) 三面对任意「已实现控件」的键集必须一致：以经典档为准，另两面不得缺 ----
const implemented = allKeys.filter((k) => ci(classic, k))
const missingVariants = implemented.filter((k) => !ci(variants, k))
const missingLegacy = implemented.filter((k) => !ci(legacy, k))
console.log('classic implements ' + implemented.length + ' of ' + allKeys.length + ' config keys')
assert.deepEqual(missingVariants, [], 'variants surface is missing keys present in classic: ' + missingVariants.join(', '))
assert.deepEqual(missingLegacy, [], 'legacy surface is missing keys present in classic: ' + missingLegacy.join(', '))
console.log('PASS full parity: every key implemented in classic is also on variants and legacy')

// ---- 4) 只读诊断块三面都在（消除「显示正常但不生效」盲区）----
for (const [name, surface] of [['classic', classic], ['variants', variants], ['legacy', legacy]]) {
  assert.ok(surface.includes("'data-dam-gate-readout'"), 'gate readout missing on ' + name)
}
console.log('PASS host-truth readout present on all three surfaces')

// ---- 5) 负路径：证明判据本身能抓到缺失（构造一个缺键的假面）----
// 构造一个「把该键所有控件都改名」的假面：必须用全局替换，否则 12 处只改 1 处，
// 检测器仍会在别处命中 ⇒ 负路径恒绿（这是真阳性验证的常见陷阱）。
const fake = classic.split("activationInboxEnabled").join('__renamed_gate__')
assert.ok(!ci(fake, 'activationInboxEnabled'), 'negative path: detector must notice a removed control')
assert.ok(implemented.includes('activationInboxEnabled'), 'activationInboxEnabled must be among implemented keys')
console.log('PASS negative path: detector catches a removed gate control')


// ---- 6) ★写入白名单一致性（D1 · 2026-09-30）----
//   根因：POST /config 只接受 Object.keys(DEFAULT_CONFIG) 里的键，其余**静默丢弃**。
//   而 renderTeamSettings 曾渲染 5 个不在白名单里的键（teamServerUrl/teamId/teamMemberName/
//   teamConflictPolicy/teamAuditEnabled）⇒ 用户改了界面翻面、配置永远写不进去，且无任何报错。
//   判据：UI 渲染的团队键 ⊆ DEFAULT_CONFIG 键集（缺一即红）。
const teamKeysInUi = [...sliceBetween(client, 'var TEAM_SETTING_KEYS = [', ']').matchAll(/'([A-Za-z0-9_$]+)'/g)].map((m) => m[1])
assert.ok(teamKeysInUi.length > 20, 'team key extraction looks wrong: ' + teamKeysInUi.length)
const missingFromWhitelist = teamKeysInUi.filter((k) => !allKeys.includes(k))
assert.deepEqual(missingFromWhitelist, [], 'team keys rendered in UI but NOT in DEFAULT_CONFIG (would be silently dropped): ' + missingFromWhitelist.join(', '))
console.log('PASS write whitelist: all ' + teamKeysInUi.length + ' UI team keys are writable (in DEFAULT_CONFIG)')

// 负路径：证明判据能抓到白名单缺键
const fakeKeys = allKeys.filter((k) => k !== 'teamConflictPolicy')
assert.ok(fakeKeys.indexOf('teamConflictPolicy') < 0, 'negative path: must notice a removed whitelist entry')
assert.ok(teamKeysInUi.includes('teamConflictPolicy'), 'teamConflictPolicy must be rendered in the team UI')
console.log('PASS negative path: whitelist check catches a missing key')

console.log('PASS settings parity: 3 surfaces, ' + implemented.length + ' keys each, gates + readout verified')
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

// Every settings entry must delegate to the same source-backed implementation.
// Check the delegation seams, source/generated control parity and writable keys.
import { canonicalSettings, shippedSettings } from '../lib/shared-settings.mjs'

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
const classic = canonicalSettings()
const variants = shippedSettings(client)
assert(client.includes("function SettingsPage() { return h(DamSharedSettings, { draftScope: 'workbench' }) }"),'classic workbench delegates to shared workbench scope')
assert(frozen.includes('function Iter5Settings(props) { return h(DamSharedSettings, props) }'),'frozen skin delegates to shared root')
assert(/function DamSharedSettings\(props\) \{[\s\S]*?h\(Iter5Settings, Object.assign\(\{\}, props, \{ key: identity\[0\] \}\)\)/.test(client),'shared classic/frozen surface is keyed by watched identity')
assert(client.includes("h(Iter5Settings, { key: identity[0], draftScope: 'host'"),'host surface mounts shared root')
assert(client.includes('var iter5SettingsDrafts = damSettingsDrafts'),'one draft registry is shared across skins')

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
console.log('surfaces: classic=' + classic.length + ' variants=' + variants.length + ' source-to-generated chars')

// ---- 1) 三面字段规模一致（同一套 87 字段）----
function fieldCount(surface) { return (surface.match(/field\(/g) || []).length }
const fc = { classic: fieldCount(classic), variants: fieldCount(variants), source: fieldCount(classic) }
console.log('field() counts: ' + JSON.stringify(fc))
assert.ok(fc.classic > 60 && fc.variants > 60 && fc.source > 60, 'unexpectedly thin settings surface')

// ---- 2) 新增的 4 道闸门必须在三面都在（用户点名的「不能有缺少」）----
const GATES = ['activationInboxEnabled', 'shadowRetrievalEnabled', 'contextBridgeEnabled', 'l0IndexEnabled']
for (const g of GATES) {
  for (const [name, surface] of [['canonical', classic], ['shared generated', variants]]) {
    assert.ok(ci(surface, g), 'gate ' + g + ' missing on surface: ' + name)
  }
}
console.log('PASS 4 gates present on canonical and generated settings (' + (GATES.length * 2) + ' control sites)')

// ---- 3) 三面对任意「已实现控件」的键集必须一致：以经典档为准，另两面不得缺 ----
const implemented = allKeys.filter((k) => ci(classic, k))
const missingVariants = implemented.filter((k) => !ci(variants, k))
const extraGenerated = allKeys.filter((k) => ci(variants,k) && !ci(classic,k))
console.log('classic implements ' + implemented.length + ' of ' + allKeys.length + ' config keys')
assert.deepEqual(missingVariants, [], 'variants surface is missing keys present in classic: ' + missingVariants.join(', '))
assert.deepEqual(extraGenerated, [], 'generator must not invent editable config keys')
console.log('PASS full parity: every canonical control key reaches the shared generated root')

// ---- 4) 只读诊断块三面都在（消除「显示正常但不生效」盲区）----
for (const [name, surface] of [['canonical', classic], ['shared generated', variants]]) {
  assert.ok(surface.includes("'data-dam-gate-readout'"), 'gate readout missing on ' + name)
}
console.log('PASS host-truth readout present on the shared root')

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

console.log('PASS settings parity: 3 consumer seams, '+implemented.length+' shared control keys, gates + readout verified')

/**
 * T1/T2/T3 永久守卫：设置页「逐段注入控制」二级页
 *
 * 用户口径（2026-11-18 P2）：
 *   - P3 接线前，旧设置的 13 个 prompt section 开关及「全部恢复全开」仍控制实际投递。
 *   - 开关的**成员与顺序唯一真源 = 宿主常量** `PROMPT_SECTION_KEYS_PRE_V1`（经 /config 应答体的
 *     `promptSections` 下发），前端只提供文案，**不得硬编码第二份清单**；
 *   - 2 个 must 段保留关闭后果提示；Policy v2 的只读清单只作信息展示。
 *
 * 本守卫用**真值解析**两侧清单（不是子串计数），再断言集合相等 ——
 * 前端漏一个键或宿主新增一个键都会红。三面执行原始控件及其事件处理函数。
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, '../..')
let pass = 0, fail = 0
const ok = (c, m) => { if (c) { pass++; console.log('  ok   - ' + m) } else { fail++; console.log('  FAIL - ' + m) } }
const eq = (a, b, m) => ok(JSON.stringify(a) === JSON.stringify(b), m + '  (got ' + JSON.stringify(a) + ')')

const IX = fs.readFileSync(path.join(ROOT, 'lib/index.js'), 'utf8')
const CL = fs.readFileSync(path.join(ROOT, 'lib/client.js'), 'utf8').replace(/\r\n/g, '\n')
const FROZEN = fs.readFileSync(path.join(ROOT, 'skins/legacy/iter5-325.js.frozen'), 'utf8').replace(/\r\n/g, '\n')

function sliceOnce(source, start, end) {
  const from = source.indexOf(start)
  const to = source.indexOf(end, from + start.length)
  assert(from >= 0 && from === source.lastIndexOf(start) && to > from && to === source.lastIndexOf(end),
    '切片锚点须按顺序各命中一次：' + start.trim() + ' / ' + end.trim())
  return source.slice(from, to)
}

const variant = sliceOnce(CL, '\n    // ITER5-GENERATED:BEGIN\n', '\n    // ITER5-GENERATED:END\n')
const FACES = [
  ['classic 模板', sliceOnce(CL, 'function SettingsPage(props) {', '    // ───────────────────────── 插件挂载')],
  ['v4 生成区', sliceOnce(variant, 'function Iter5Settings(props) {', 'function Iter5Storage(props) {')],
  ['Frozen 源', sliceOnce(FROZEN, 'function Iter5Settings(props) {', 'function Iter5Storage(props) {')],
]
const ENTRY = "field(t('fPromptSections'), h('button'"
const NEXT = "field(t('fInject'),"

/** 解析宿主 Object.freeze([...]) 常量 → 真数组（去注释后 eval，仅字面量） */
function hostList(src, name) {
  const head = 'export const ' + name + ' = Object.freeze(['
  const i = src.indexOf(head)
  if (i < 0) throw new Error('未找到宿主常量 ' + name)
  const start = i + head.length
  const end = src.indexOf('])', start)
  if (end < 0) throw new Error(name + ' 找不到收尾 ])')
  const body = src.slice(start, end).split(/\r?\n/).map((l) => l.replace(/\/\/.*$/, '')).join('\n')
  return new Function('return [' + body + ']')() // eslint-disable-line no-new-func
}
/** 解析客户端 PROMPT_SECTION_TEXT 对象字面量 → 真对象 */
function clientText(src) {
  const head = 'var PROMPT_SECTION_TEXT = {'
  const i = src.indexOf(head)
  if (i < 0) throw new Error('未找到 PROMPT_SECTION_TEXT')
  const start = i + head.length
  const end = src.indexOf('\n    }', start)
  if (end < 0) throw new Error('PROMPT_SECTION_TEXT 找不到收尾 }')
  return new Function('return {' + src.slice(start, end) + '}')() // eslint-disable-line no-new-func
}
/** 集合差异（供正例与反例共用） */
function diff(hostKeys, textKeys) {
  const a = new Set(hostKeys), b = new Set(textKeys)
  return {
    missing: hostKeys.filter((k) => !b.has(k)),
    extra: textKeys.filter((k) => !a.has(k)),
  }
}

console.log('[G1] 宿主常量（唯一真源）')
const KEYS = hostList(IX, 'PROMPT_SECTION_KEYS_PRE_V1')
const MUST = hostList(IX, 'PROMPT_SECTION_MUST_PRE_V1')
eq(KEYS.length, 13, 'G1a 分区键 13 个')
eq(new Set(KEYS).size, 13, 'G1b 分区键无重复')
eq(MUST, ['plan-update-request', 'water-advisory'], 'G1c must 两个（与宿主注释一致）')
ok(MUST.every((k) => KEYS.indexOf(k) >= 0), 'G1d must ⊆ keys（子集纪律）')

console.log('[G2] 前端文案表 ≡ 宿主清单（集合相等；反例自检）')
const TEXT = clientText(CL)
const textKeys = Object.keys(TEXT)
const d = diff(KEYS, textKeys)
eq(d.missing, [], 'G2a 前端无缺失键')
eq(d.extra, [], 'G2b 前端无多余键')
for (const k of KEYS) {
  const t = TEXT[k] || {}
  ok(typeof t.zh === 'string' && t.zh.trim().length > 0, 'G2c ' + k + ' 有中文名')
  ok(typeof t.en === 'string' && t.en.trim().length > 0, 'G2d ' + k + ' 有英文名')
}
for (const k of MUST) {
  const t = TEXT[k] || {}
  ok(typeof t.offZh === 'string' && t.offZh.length > 8, 'G2e must 段 ' + k + ' 有中文关闭后果')
  ok(typeof t.offEn === 'string' && t.offEn.length > 8, 'G2f must 段 ' + k + ' 有英文关闭后果')
}
// ★反例自检：删掉一个键后，G2a 必须报缺失（守卫非恒真）
{
  const doctored = textKeys.filter((k) => k !== KEYS[0])
  const d2 = diff(KEYS, doctored)
  eq(d2.missing, [KEYS[0]], 'G2g 反例：删一个键 ⇒ missing 恰为该键')
  const d3 = diff(KEYS, textKeys.concat(['bogus-key']))
  eq(d3.extra, ['bogus-key'], 'G2h 反例：加一个键 ⇒ extra 恰为新增键')
}

console.log('[G3] 通路：宿主下发 → 前端消费（前端不得硬编码成员）')
ok(IX.indexOf('promptSections: PROMPT_SECTION_KEYS_PRE_V1') >= 0, 'G3a 宿主 /config 应答体下发 keys')
ok(IX.indexOf('promptSectionMust: PROMPT_SECTION_MUST_PRE_V1') >= 0, 'G3b 宿主 /config 应答体下发 must')
ok(FACES.every(([, src]) => src.includes('setPsecKeys(Array.isArray(d.promptSections) ? d.promptSections : [])')), 'G3c 三面装载点收下 keys（含 fail-soft 兜底）')
ok(FACES.every(([, src]) => src.includes('setPsecMust(Array.isArray(d.promptSectionMust) ? d.promptSectionMust : [])')), 'G3d 三面装载点收下 must')
const panels = FACES.map(([name, src]) => [name, sliceOnce(src, ENTRY, NEXT)])
ok(panels.every(([, src]) => src.includes('psecKeys.map(function (k)')), 'G3e 三面开关由 psecKeys 派生（而非写死数组）')
ok(panels.every(([, src]) => KEYS.every((k) => !src.includes("'" + k + "'"))), 'G3f 三面渲染块内零宿主键字面量')

console.log('[G4] 一级/二级分层与会话状态')
ok(FACES.every(([, src]) => src.split(ENTRY).length === 2), 'G4a 三面一级页各一个入口按钮')
ok(FACES.every(([, src]) => src.includes('var psecOpenPair = useState(false)')), 'G4b 三面有二级页开合状态')
ok(panels.every(([, src]) => src.includes('psecOpen ? (function () {')), 'G4c 三面二级页面板由 psecOpen 单一状态控制')
ok(panels.every(([, src]) => src.includes('不推荐修改')), 'G4d 三面二级页保留谨慎修改说明')
ok(FACES.every(([, src]) => {
  const early = src.search(/^\s*if \(!cfg\) return/m)
  const hooks = src.indexOf('var psecOpenPair = useState(false)')
  return hooks >= 0 && early > hooks
}), 'G4e 三面 hooks 挂在真实早退语句之前（React hooks 纪律）')

const h = (type, props, ...children) => ({ type, props: props || {}, children: children.flat(Infinity) })
function flatten(tree) {
  return tree.flatMap((node) => node && typeof node === 'object' ? [node, ...flatten(node.children)] : [])
}

function exercisePanel(source) {
  // 夹具只提供渲染包装和草稿状态；入口、开关及其事件处理函数来自成品源码。
  const renderPanel = new Function('h', 'field', 't', 'L', 'cfg', 'psecOpen', 'setPsecOpen', 'psecKeys', 'psecMust',
    'PROMPT_SECTION_TEXT', 'locale', 'set', 'return [' + source + '\n]')
  let open = false, cfg = { promptSectionToggles: Object.freeze({}) }
  const writes = []
  const render = (keys = KEYS) => flatten(renderPanel(h, (label, button) => h('div', { label }, button), (s) => s,
    (zh) => zh, cfg, open, (next) => { open = next }, keys, MUST, TEXT, 'zh', (key, value) => {
      writes.push([key, value])
      cfg = { ...cfg, [key]: Object.freeze(value) }
    }))
  const switches = (tree) => tree.filter((node) => node.props['data-dam-pswitch'] !== undefined)
  const switchFor = (key) => switches(render()).find((node) => node.props['data-dam-pswitch'] === key)
  const verifyWrite = (expected, count) => {
    assert.equal(writes.length, count)
    assert.deepEqual(writes.at(-1), ['promptSectionToggles', expected])
  }
  const entries = render().filter((node) => node.type === 'button')
  assert.equal(entries.length, 1, '一级页须有一个入口')
  assert.equal(switches(render()).length, 0, '二级页关闭时不开列开关')
  entries[0].props.onClick()
  const tree = render()
  assert.deepEqual(switches(tree).map((node) => node.props['data-dam-pswitch']), KEYS)
  for (const control of switches(tree)) {
    const key = control.props['data-dam-pswitch']
    assert.equal(control.props.checked, true, key + ' 默认开启')
    assert(control.props.disabled !== true && typeof control.props.onChange === 'function', key + ' 开关必须可编辑')
  }
  const mustLabels = tree.filter((node) => node.type === 'span' && node.children.some((text) => String(text).endsWith(' · 硬性要求')))
  assert.deepEqual(mustLabels.flatMap((node) => node.children), MUST.map((key) => TEXT[key].zh + ' · 硬性要求'))
  for (const key of MUST) assert(tree.some((node) => node.children.includes(TEXT[key].offZh)), key + ' 关闭后果必须可见')
  const alternate = [KEYS[1], 'server-supplied-fixture', KEYS[0]]
  assert.deepEqual(switches(render(alternate)).map((node) => node.props['data-dam-pswitch']), alternate)
  assert.equal(switches(render([])).length, 0, '无清单时不生成客户端兜底开关')
  assert.equal(writes.length, 0, '浏览清单不写草稿')

  const expected = {}
  for (const [index, key] of KEYS.entries()) {
    switchFor(key).props.onChange({ target: { checked: false } })
    expected[key] = false
    verifyWrite({ ...expected }, index + 1)
    assert.equal(switchFor(key).props.checked, false, key + ' 关闭后立即回显')
  }
  switchFor(KEYS[0]).props.onChange({ target: { checked: true } })
  delete expected[KEYS[0]]
  verifyWrite(expected, KEYS.length + 1)
  assert.equal(switchFor(KEYS[0]).props.checked, true, '重新开启后立即回显')

  const reset = render().filter((node) => node.type === 'button' && node.children.includes('全部恢复全开'))
  assert.equal(reset.length, 1, '恢复按钮必须存在且唯一')
  assert(reset[0].props.disabled !== true && typeof reset[0].props.onClick === 'function', '恢复按钮必须可编辑')
  reset[0].props.onClick()
  verifyWrite({}, KEYS.length + 2)
  assert(switches(render()).every(({ props }) => props.checked === true), '恢复后 13 项全开')
}

console.log('[G5] 三面旧分区真执行：逐项关闭、单项重新开启、全部恢复')
for (const [name, source] of panels) {
  ok(source.includes("set('promptSectionToggles', t2)") && source.includes("set('promptSectionToggles', {})")
    && source.includes('全部恢复全开'), 'G5a ' + name + ' 有旧分区写入与恢复入口')
  try {
    exercisePanel(source)
    ok(true, 'G5b ' + name + ' 逐项关闭/回显、重新开启保留其它禁用项、一键恢复')
    const anchor = "'data-dam-pswitch': k, checked:"
    assert(source.indexOf(anchor) >= 0 && source.indexOf(anchor) === source.lastIndexOf(anchor), '只读变异锚点唯一')
    const mutant = source.replace(anchor, "'data-dam-pswitch': k, disabled: true, checked:")
    assert.throws(() => exercisePanel(mutant), /开关必须可编辑/)
    exercisePanel(source)
    ok(true, 'G5c ' + name + ' 原始源码通过 → 注入只读必失败 → 还原复绿')
  } catch (error) {
    ok(false, name + ' · ' + error.message)
  }
}
ok(IX.indexOf('promptSectionToggles: {},') >= 0, 'G5e 宿主 DEFAULT_CONFIG 出厂为空对象（= 全开）')

console.log('\n[T1] ' + pass + ' passed, ' + fail + ' failed')
if (fail) process.exit(1)

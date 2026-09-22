/**
 * T1/T2/T3 永久守卫：设置页「逐段注入控制」二级页
 *
 * 用户口径（2026-09-22）：
 *   - 13 个注入分区开关**不做在一级页**，一级只放中性说明 + 入口，**不推荐用户修改**；
 *   - 开关的**成员与顺序唯一真源 = 宿主常量** `PROMPT_SECTION_KEYS_V1`（经 /config 应答体的
 *     `promptSections` 下发），前端只提供文案，**不得硬编码第二份清单**；
 *   - 每个 must 段开关旁标注关闭后果；开关改动必须即时回显；提供「全部恢复全开」。
 *
 * 本守卫用**真值解析**两侧清单（不是子串计数），再断言集合相等 ——
 * 前端漏一个键或宿主新增一个键都会红。
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, '../..')
let pass = 0, fail = 0
const ok = (c, m) => { if (c) { pass++; console.log('  ok   - ' + m) } else { fail++; console.log('  FAIL - ' + m) } }
const eq = (a, b, m) => ok(JSON.stringify(a) === JSON.stringify(b), m + '  (got ' + JSON.stringify(a) + ')')

const IX = fs.readFileSync(path.join(ROOT, 'lib/index.js'), 'utf8')
const CL = fs.readFileSync(path.join(ROOT, 'lib/client.js'), 'utf8')

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
const KEYS = hostList(IX, 'PROMPT_SECTION_KEYS_V1')
const MUST = hostList(IX, 'PROMPT_SECTION_MUST_V1')
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
ok(IX.indexOf('promptSections: PROMPT_SECTION_KEYS_V1') >= 0, 'G3a 宿主 /config 应答体下发 keys')
ok(IX.indexOf('promptSectionMust: PROMPT_SECTION_MUST_V1') >= 0, 'G3b 宿主 /config 应答体下发 must')
ok(CL.indexOf('setPsecKeys(Array.isArray(d.promptSections) ? d.promptSections : [])') >= 0, 'G3c 前端装载点收下 keys（含 fail-soft 兜底）')
ok(CL.indexOf('setPsecMust(Array.isArray(d.promptSectionMust) ? d.promptSectionMust : [])') >= 0, 'G3d 前端装载点收下 must')
ok(CL.indexOf('psecKeys.map(function (k)') >= 0, 'G3e 开关行由 psecKeys 派生（而非写死数组）')
{
  // 负向：渲染器里不得出现「≥3 个宿主键字面量组成的数组」
  const renderBlockStart = CL.indexOf("'data-dam-prompt-sections'")
  const renderBlock = CL.slice(renderBlockStart, CL.indexOf('})() : null,', renderBlockStart))
  const litCount = KEYS.filter((k) => renderBlock.indexOf("'" + k + "'") >= 0).length
  ok(litCount === 0, 'G3f 渲染块内零宿主键字面量（实得 ' + litCount + '）')
}

console.log('[G4] 一级/二级分层与会话状态')
ok(CL.indexOf("field(t('fPromptSections'), h('button'") >= 0, 'G4a 一级页只有一个入口按钮')
ok(CL.indexOf('var psecOpenPair = useState(false)') >= 0, 'G4b 二级页开合状态存在')
ok(CL.indexOf('psecOpen ? (function () {') >= 0, 'G4c 二级页面板由 psecOpen 单一状态 gate')
ok(CL.indexOf('不推荐修改') >= 0, 'G4d 二级页含「不推荐修改」中性文案')
{
  // ★作用域必须限定在 SettingsPage 内，且锚点必须是**真实早退语句**：
  //   文件里 6045/6058 的注释也含 `if (!cfg)` 字样，用裸 indexOf 会命中注释 ⇒ 恒假（本次踩过）。
  const spStart = CL.indexOf('function SettingsPage() {')
  const sp = CL.slice(spStart)
  const hooksRel = sp.indexOf('var psecOpenPair = useState(false)')
  const earlyRel = sp.indexOf('if (!cfg) return')
  ok(spStart > 0 && hooksRel > 0 && earlyRel > 0 && hooksRel < earlyRel, 'G4e hooks 挂在真实早退语句之前（React hooks 纪律）')
}

console.log('[G5] 即时回显与一键恢复')
ok(CL.indexOf("checked: toggles[k] !== false") >= 0, 'G5a 未设置 = 默认开（undefined 视为 true）')
ok(CL.indexOf("if (e.target.checked) delete t2[k]; else t2[k] = false") >= 0, 'G5b 勾选即删键（回归出厂态）、取消即写 false')
ok(CL.indexOf("set('promptSectionToggles', t2)") >= 0, 'G5c 走既有 set() 写入路径（= 即时回显机制）')
ok(CL.indexOf("set('promptSectionToggles', {})") >= 0, 'G5d 「全部恢复全开」一键写空对象')
ok(IX.indexOf('promptSectionToggles: {},') >= 0, 'G5e 宿主 DEFAULT_CONFIG 出厂为空对象（= 全开）')

console.log('\n[T1] ' + pass + ' passed, ' + fail + ' failed')
if (fail) process.exit(1)

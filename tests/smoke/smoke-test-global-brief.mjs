/** 全局动态简报批 · 独立验收套件（CR-10：真 import → 真构造 → 真调用 → 断言返回值；每条带负路径）。
 *
 *  三层证据：
 *   A. `lib/global-brief.js` —— **真 import 真调用**纯模块（非源码字符串断言）。
 *   B. 自写豁免接线 —— 从 `lib/index.js` **抽取真实实现**（花括号配对），vm **真执行**：
 *      写盘登记 → 豁免命中（正）／未登记或异路径 → 不豁免（负）。
 *   C. 团队注入候选生产者 —— 同样抽取真实回调体，vm **真执行**：appliedEntries 非空 → 候选被填；
 *      空 → 候选**不被改写**（负）。
 *  另有少量**静态守卫**，已在断言名里显式标注「守卫，非功能证据」。
 *
 *  物理量：本文件打印 PASS/FAIL 计数；回归可复算。
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import {
  BRIEF_SOURCES_PRE, BRIEF_HEADLINE_MAX_PRE, BRIEF_MAX_ITEMS_PRE,
  diffBriefPre, buildDraftPre, renderBriefPre, looksSecretPre,
} from '../../lib/global-brief.js'

let pass = 0, fail = 0
const failures = []
function t(name, fn) {
  try { fn(); pass += 1; console.log('  ok   - ' + name) }
  catch (e) { fail += 1; failures.push(name + ' :: ' + (e && e.message)); console.log('  FAIL - ' + name + ' :: ' + (e && e.message)) }
}

const SOURCE = readFileSync(new URL('../../lib/index.js', import.meta.url), 'utf8').replace(/\r\n/g, '\n')

/** 花括号配对抽取「含首尾花括号」的整块（用于完整语句：`engine.X = function(){}`）。 */
function extractBlock(text, anchor) {
  const i = text.indexOf(anchor)
  if (i < 0) throw new Error('anchor not found: ' + anchor)
  let depth = 0
  for (let k = text.indexOf('{', i); k < text.length; k += 1) {
    if (text[k] === '{') depth += 1
    else if (text[k] === '}') { depth -= 1; if (depth === 0) return text.slice(i, k + 1) }
  }
  throw new Error('unbalanced: ' + anchor)
}
/** 抽取 function(..) {  … } 的**内部体**（不含外层花括号），供 new Function 真执行。 */
function extractBody(text, anchor) {
  const i = text.indexOf(anchor)
  if (i < 0) throw new Error('anchor not found: ' + anchor)
  const open = text.indexOf('{', i)
  let depth = 0
  for (let k = open; k < text.length; k += 1) {
    if (text[k] === '{') depth += 1
    else if (text[k] === '}') { depth -= 1; if (depth === 0) return text.slice(open + 1, k) }
  }
  throw new Error('unbalanced: ' + anchor)
}

console.log('== A. global-brief.js 纯模块（真 import / 真调用）==')

t('BRIEF_SOURCES_PRE 是三源且含 workspace', () => {
  assert.ok(Array.isArray(BRIEF_SOURCES_PRE))
  assert.ok(BRIEF_SOURCES_PRE.includes('workspace'))
  assert.equal(BRIEF_SOURCES_PRE.length, 3)
})
t('[正] 首次（无水位）⇒ first=true、不报 changed（建基线不刷屏）', () => {
  const r = diffBriefPre({ previous: null, entries: [{ path: 'a.md', size: 1, mtimeMs: 2, source: 'workspace' }], isSelfWrite: () => false })
  assert.equal(r.ok, true)
  assert.equal(r.first, true)
  assert.equal(r.changed.length, 0)
  assert.ok(r.next && r.next['a.md'], '水位应记住该文件')
})
t('[负] 无变化 ⇒ changed 为空、renderBriefPre 返回空串（零注入）', () => {
  const e = [{ path: 'a.md', size: 1, mtimeMs: 2, source: 'workspace' }]
  const base = diffBriefPre({ previous: null, entries: e, isSelfWrite: () => false })
  const r = diffBriefPre({ previous: base.next, entries: e, isSelfWrite: () => false })
  assert.equal(r.first, false)
  assert.equal(r.changed.length, 0)
  assert.equal(renderBriefPre({ draft: buildDraftPre({ changed: r.changed }) }), '')
})
t('[正] 真变化 ⇒ changed 命中该文件且渲染出文本', () => {
  const e0 = [{ path: 'a.md', size: 1, mtimeMs: 2, source: 'workspace' }]
  const base = diffBriefPre({ previous: null, entries: e0, isSelfWrite: () => false })
  const e1 = [{ path: 'a.md', size: 999, mtimeMs: 5, source: 'workspace' }]
  const r = diffBriefPre({ previous: base.next, entries: e1, isSelfWrite: () => false })
  assert.equal(r.changed.length, 1)
  assert.equal(r.changed[0].kind, 'changed')
  const text = renderBriefPre({ draft: buildDraftPre({ changed: r.changed }) })
  assert.ok(text.length > 0, '应有简报文本')
  assert.ok(text.includes('a.md'), '应含路径')
})
t('[负] 自我写入 ⇒ 计入 skippedSelf 且**不进** changed（豁免真的生效）', () => {
  const e0 = [{ path: 'self.md', size: 1, mtimeMs: 2, source: 'workspace' }]
  const base = diffBriefPre({ previous: null, entries: e0, isSelfWrite: () => false })
  const e1 = [{ path: 'self.md', size: 77, mtimeMs: 9, source: 'workspace' }]
  const r = diffBriefPre({ previous: base.next, entries: e1, isSelfWrite: (p) => String(p).endsWith('self.md') })
  assert.equal(r.changed.length, 0)
  assert.equal(r.counts.skippedSelf, 1)
})
t('[负] looksSecretPre：密钥样式必须判真，普通文本必须判假', () => {
  assert.equal(looksSecretPre('sk-abcdefghijklmnopqrstuvwxyz012345'), true)
  assert.equal(looksSecretPre('这是一段普通的中文说明'), false)
})
t('行数/条数上限是正整数常量', () => {
  assert.ok(Number.isInteger(BRIEF_MAX_ITEMS_PRE) && BRIEF_MAX_ITEMS_PRE > 0)
  assert.ok(Number.isInteger(BRIEF_HEADLINE_MAX_PRE) && BRIEF_HEADLINE_MAX_PRE > 0)
})

console.log('== B. 自写豁免接线（抽取真实实现 + new Function 真执行）==')

/** 用与 C 段同款的方式：抽取**真实函数体**，new Function 真执行（不用 vm/class，避免抽取层自身出问题）。 */
// 整块抽取真实语句（与 C 段同款），拼成可执行的 harness 源码，交由 new Function 真执行。
const harnessSrc = [
  extractBlock(SOURCE, 'const normPre = function (s) {'),
  'var engine = {}',
  extractBlock(SOURCE, 'engine._noteSelfWritePre = function (filePath) {'),
  extractBlock(SOURCE, 'engine._isSelfWritePre = function (filePath) {'),
  'engine._noteSelfWriteAtPre = function (p) {' + extractBody(SOURCE, '  _noteSelfWriteAtPre(p) {') + '}',
  'return engine',
].join('\n')
const buildEngine = new Function(harnessSrc)
const BS = String.fromCharCode(92)   // 反斜杠

t('[正] 真调 _noteSelfWriteAtPre ⇒ 登记进 _selfWrites（接线存在且可执行）', () => {
  const engine = buildEngine()
  engine._noteSelfWriteAtPre('C:' + BS + 'ws' + BS + 'MEMORY.md')
  assert.ok(Array.isArray(engine._selfWrites), '_selfWrites 应被创建')
  assert.equal(engine._selfWrites.length, 1, '_selfWrites 应有 1 条登记')
})
t('[正] 分隔符不同也豁免命中（登记与检测归一化后必须相等）', () => {
  const engine = buildEngine()
  engine._noteSelfWriteAtPre('C:' + BS + 'ws' + BS + 'MEMORY.md')
  assert.equal(engine._isSelfWritePre('C:/ws/MEMORY.md'), true, '归一化后应命中')
})
t('[负] 未登记的路径 ⇒ 不豁免', () => {
  const engine = buildEngine()
  engine._noteSelfWriteAtPre('C:/ws/MEMORY.md')
  assert.equal(engine._isSelfWritePre('C:/ws/OTHER.md'), false)
})
t('[负] 空路径 / 空登记表 ⇒ 不豁免（且不抛）', () => {
  const engine = buildEngine()
  assert.equal(engine._isSelfWritePre(''), false)
  assert.equal(engine._isSelfWritePre('C:/any.md'), false, '零登记时不得豁免')
})
t('[负] 豁免有时效：过期登记不再命中（120s 窗口）', () => {
  const engine = buildEngine()
  engine._noteSelfWriteAtPre('C:/ws/OLD.md')
  engine._selfWrites[0].at = Date.now() - 121000
  assert.equal(engine._isSelfWritePre('C:/ws/OLD.md'), false, '过期后不应再豁免')
})
/** 取函数体（花括号配平）：判据锚定在**函数体内**，不随注释/前置语句长度漂移。
 *  ⚠️ 必须先从参数表开括号配平圆括号再取花括号 —— 否则 `writeFull(p, text, opts = {})` 里
 *  解构默认值的 `{}` 会被误当函数体（实测：返回空体，判据假红）。 */
const fnBody = (src, anchor) => {
  const i = src.indexOf(anchor)
  assert.ok(i >= 0, '找不到函数起点 ' + anchor)
  let paren = 0, open = -1
  for (let k = src.indexOf('(', i); k >= 0 && k < src.length; k++) {
    if (src[k] === '(') paren++
    else if (src[k] === ')') { paren--; if (paren === 0) { open = src.indexOf('{', k); break } }
  }
  assert.ok(open >= 0, '找不到函数体起点 ' + anchor)
  let depth = 0
  for (let k = open; k < src.length; k++) {
    if (src[k] === '{') depth++
    else if (src[k] === '}') { depth--; if (depth === 0) return src.slice(open + 1, k) }
  }
  throw new Error('unbalanced: ' + anchor)
}
t('四个写盘原语都挂了登记（守卫，非功能证据；调用点计数）', () => {
  const calls = (SOURCE.match(/_noteSelfWriteAtPre\(/g) || []).length
  assert.ok(calls >= 5, '_noteSelfWriteAtPre( 出现应 >= 5（1 定义 + 4 调用），实测 ' + calls)
  // ★R1（2026-10-08）判据同步（非回滚 · 依据 2026-10-01 裁定）：#258 给四个写盘原语加了本地角色门
  //   `this._assertTeamActionPre(this._teamWriteActionPre(p))`，登记调用因此后移到 273 字符
  //   （writeFull）⇒ 原「函数头后 260 字符」窗过期。改为**函数体抽取**（花括号配平）后断言：
  //   不再受前置换行/注释长度影响，且比原字符窗更严（锚定在函数体内，而不是「附近某处」）。
  for (const m of // ★2026-10-01 判据同步：`writeFull` 签名因 #160（整篇写改走 rawDocStore + expectedDigest CAS）
//   增加了可选 `opts = {}` 第三参 ⇒ 原锚串过期。改为**前缀锚**（只锁函数头，不含参数表尾部），
//   这样后续再增可选参数也不必改判据；其余三个原语签名未变，保持不变。
['  async appendText(p, text) {', '  async writeFullRaw(p, text) {', '  async writeFullSingle(p, text) {', '  async writeFull(p, text']) {
    const seg = fnBody(SOURCE, m)
    assert.ok(seg.includes('_noteSelfWriteAtPre(p)'), m + ' 函数体内未挂登记调用')
  }
})
console.log('== C. 团队注入候选生产者（抽取真实回调体 + vm 真执行）==')

const CAND_ANCHOR = 'Promise.resolve(p.pullOnce()).then(function (res) {'
const body = extractBody(SOURCE, CAND_ANCHOR)
const mk = () => new Function('engine', 'diagThrottled', 'damDiagLine', 'normalizeTeamSegmentsPre', 'res', body)

t('[正] appliedEntries 非空 ⇒ _teamInjectCandidates 被填充（生产者存在）', () => {
  const engine = {}
  const seen = []
  mk()(engine, () => {}, (e) => String(e), (list) => list, {
    appliedEntries: [{ kind: 'handoff', key: 'k1', member: { id: 'm1' } }],
  })
  assert.ok(Array.isArray(engine._teamInjectCandidates), '应写入候选数组')
  assert.equal(engine._teamInjectCandidates.length, 1)
  assert.ok(engine._teamInjectCandidates[0].text.includes('团队'), '候选文本应含团队标记')
  assert.ok(engine._teamInjectCandidates[0].text.includes('m1'), '候选文本应含来源成员')
})
t('[负] appliedEntries 为空 ⇒ **不改写**候选（不得把已有候选清空）', () => {
  const engine = { _teamInjectCandidates: [{ bucket: 'external', kind: 'keep', text: 'x', priority: 'low' }] }
  mk()(engine, () => {}, (e) => String(e), (list) => list, { appliedEntries: [] })
  assert.equal(engine._teamInjectCandidates.length, 1, '空批次不得清空既有候选')
  assert.equal(engine._teamInjectCandidates[0].kind, 'keep')
})
t('[负] res 为异常形状 ⇒ 不抛、不改写', () => {
  const engine = { _teamInjectCandidates: [] }
  mk()(engine, () => {}, (e) => String(e), (list) => list, null)
  assert.equal(engine._teamInjectCandidates.length, 0)
})
t('候选喂给 team-inject 的归一化函数（守卫，非功能证据）', () => {
  assert.ok(/normalizeTeamSegmentsPre/.test(SOURCE), 'index.js 应 import 并使用 normalizeTeamSegmentsPre')
  assert.ok(SOURCE.includes("import { normalizeTeamSegmentsPre } from './team-inject.js'"))
})

console.log('')
console.log('[global-brief] PASS ' + pass + ' / FAIL ' + fail)
if (fail) { console.log('失败项：'); for (const f of failures) console.log('  - ' + f); process.exit(1) }

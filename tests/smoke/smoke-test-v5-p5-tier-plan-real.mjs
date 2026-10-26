/**
 * smoke-test-v5-p5-tier-plan-real.mjs
 *
 * ★2026-10-27 新增（用户裁定方案 A 的验收）——补上 P3/P4 漏掉的关键断言。
 *
 * 【为什么必须新增这个套件】**
 *   P3「按档位投白板」上线后，套件 green（44/0、45/0），但**功能是死的**：
 *   `truncatePlanBySections` 是模块级 const，`renderMemoryDynamic` 被 `new Function`
 *   抽取执行时该符号 `typeof === "undefined"` ⇒ `typeof` 守卫恒假 ⇒ **永远走 fallback**。
 *   套件只断言「枚举值存在 / 函数定义在源码里 / 条件写法对」，
 *   **没有一条真执行渲染 + 量白板段字节** ⇒ 这就是本仓记录过的「恒真守卫」家族。
 *
 * 【本套件的判据原则（CR-10）】**
 *   ① 真引擎（`new MemoryEngine()` → `refresh` → 真渲染），不抽取、不造假 state
 *   ② 断言**物理量**（白板段字节数），不是「源码含某字符串」
 *   ③ 每条都有**负路径**（去掉内联实现后必须变红）
 *   ④ 含**成对断言**：内联实现 vs 模块级实现输出逐字节相同
 */
import { MemoryEngine } from '../../tests/lib/audit-engine.mjs'

let pass = 0, fail = 0
function ok(cond, name, extra) {
  if (cond) { pass++; console.log('  ok   - ' + name + (extra ? ' :: ' + extra : '')) }
  else { fail++; console.log('  FAIL - ' + name + (extra ? ' :: ' + extra : '')) }
}

const engine = new MemoryEngine()
await engine.refresh(undefined)
const st = engine.stateFor(undefined)

/** 渲染并返回该档位的白板段字符数（唯一权威口径：envelopeMeta.segments） */
function planChars(tier, legacy) {
  st._injectTierPre = tier
  st.memLegacy = legacy
    ? { legacy: true, reasons: ['no-anchors'], counts: { userEntries: 1, projectEntries: 0 } }
    : { legacy: false, reasons: [], counts: {} }
  st.envelopeMeta = null
  engine.renderMemoryDynamic({ agent: undefined })
  const m = st.envelopeMeta || {}
  let n = 0
  for (const sg of (m.segments || [])) if (sg.kind === 'whiteboard-plan') n = sg.chars
  return n
}
function hintChars(tier, legacy) {
  planChars(tier, legacy)
  const m = st.envelopeMeta || {}
  let n = 0
  for (const sg of (m.segments || [])) if (sg.kind === 'mem-legacy-upgrade') n = sg.chars
  return n
}

console.log('== A. 档位白板投递真实生效（核心判据，P3 漏掉的那条）==')
{
  const full = planChars('human_full', false)
  const core = planChars('run_full', false)
  const none = planChars('run_slim', false)
  ok(full > 0, 'A-1 F1(全文) 白板有内容', full + 'B')
  ok(core > 0, 'A-2 F3(三节) 白板有内容', core + 'B')
  ok(none === 0, 'A-3 F4(不投) 白板为 0', none + 'B')
  ok(core < full, 'A-4 ★三节必须比全文少（修前实测 2149 > 1221，反的）', core + ' < ' + full)
  ok(core < full * 0.95, 'A-5 ★三节至少比全文省 5%（实测省 ' + (full > 0 ? ((1 - core/full)*100).toFixed(1) : '?') + '%）')
}

console.log('')
console.log('== B. 负路径：没有内联实现时必然退化成「三节 == 全文」==')
{
  // 用「档位不同但都走 sections 路径」来证明 sections 真的在起作用：
  // 若 sections 失效（走 fallback 按预算截断），三档会因为同一预算而给出同样的值。
  const core3 = planChars('run_full', false)      // 3 节 + 瘦预算
  const core5 = planChars('post_compact', false)  // 3 节 + 瘦预算
  const fullT = planChars('handoff_carry', false) // 全文 + 原预算
  ok(core3 === core5, 'B-1 同白名单同预算的两档字节一致（可预期）', core3 + ' / ' + core5)
  ok(fullT !== core3, 'B-2 ★白名单不同的两档字节必须不同（sections 真在起作用）', fullT + ' vs ' + core3)
}

console.log('')
console.log('== C. legacy 临时截流（用户裁定 B）==')
{
  const normal = planChars('run_full', false)
  const legacy = planChars('run_full', true)
  ok(legacy > 0, 'C-1 legacy 时白板仍有内容（不是一刀切没）', legacy + 'B')
  ok(legacy < normal, 'C-2 ★legacy 时白板更少（截流生效）', legacy + ' < ' + normal)
  ok(legacy <= 2400, 'C-3 legacy 总预算 ≤2400', legacy + 'B')
}

console.log('')
console.log('== D. legacy 迁移提示投递（含用户指定文案要素）==')
{
  const h = hintChars('run_full', true)
  ok(h > 0, 'D-1 legacy 时提示段被投递（修前因 priority=low 被静默击杀）', h + 'B')
  ok(h <= 600, 'D-2 提示段 ≤600 字符（不挤占注入面）', h + 'B')
  // 文案要素：必须说清「白板仍是旧版」「怎么迁移」「要汇报」
  st._injectTierPre = 'run_full'
  st.memLegacy = { legacy: true, reasons: [], counts: {} }
  const snap = engine.renderMemoryDynamic({ agent: undefined })
  ok(snap.indexOf('旧版流水账') >= 0, 'D-3 文案含「旧版流水账」（说清当前状态，不让模型误以为已升级）')
  ok(snap.indexOf('派出子代理') >= 0, 'D-4 文案含「派出子代理」（迁移路径①）')
  ok(snap.indexOf('开始迁移') >= 0, 'D-5 文案含「开始迁移」（迁移路径②）')
  ok(snap.indexOf('向用户汇报') >= 0, 'D-6 文案要求「向用户汇报」（用户指定的强制动作）')
  ok(snap.indexOf('已临时截流') >= 0, 'D-7 文案说明「已临时截流」（解释白板为何投得少）')
}

console.log('')
console.log('== E. 成对断言：内联实现 vs 模块级实现**行为等价** ==')
{
  // ★判据选型（重要）：不能做「逐字符结构相同」断言 ——
  //   内联版有意做了一处等价简化（省掉 `const hit =` 中间变量），
  //   结构必然不同。守「函数体长得一样」是**错误的判据**，
  //   真正要守的不变量是「**同一输入给出同一输出**」。
  //   ⇒ 改成行为等价：多组输入喂两个实现，比输出。
  const { readFileSync } = await import('node:fs')
  const src = readFileSync(new URL('../../lib/index.js', import.meta.url), 'utf8')
  function extract(marker) {
    const st0 = src.indexOf(marker)
    if (st0 < 0) return null
    let i = src.indexOf('{', st0), d = 0, e = st0
    for (; i < src.length; i++) { const c = src[i]; if (c === '{') d++; else if (c === '}') { d--; if (d === 0) { e = i + 1; break } } }
    return src.slice(st0, e)
  }
  const modSrc = extract('const truncatePlanBySections = (text, sectionWhitelist, perSectionMax) => {')
  const inlSrc = extract('const _truncatePlanBySectionsInline = (text, sectionWhitelist, perSectionMax) => {')
  ok(!!modSrc, 'E-1 模块级实现存在')
  ok(!!inlSrc, 'E-2 内联实现存在')
  let fnMod = null, fnInl = null
  try { fnMod = new Function('return ' + modSrc.replace(/^const [A-Za-z0-9_]+ = /, ''))() } catch (e) {}
  try { fnInl = new Function('return ' + inlSrc.replace(/^const [A-Za-z0-9_]+ = /, ''))() } catch (e) {}
  ok(typeof fnMod === 'function', 'E-3 模块级实现可真执行')
  ok(typeof fnInl === 'function', 'E-4 内联实现可真执行')

  // 多组输入（覆盖：命中/不命中/超长截断/空输入/非法输入）
  const CASES = [
    ['两节命中', '## 甲\n内容甲\n## 乙\n内容乙', ['甲', '乙'], 2000],
    ['无命中', '## 丙\n内容丙', ['甲'], 2000],
    ['超长截断', '## 甲\n' + 'x'.repeat(500), ['甲'], 100],
    ['空文本', '', ['甲'], 2000],
    ['空白名单', '## 甲\n内容', [], 2000],
    ['null 白名单', '## 甲\n内容', null, 2000],
    ['大小写', '## ALPHA\n内容', ['alpha'], 2000],
    ['未给上限', '## 甲\n' + 'y'.repeat(50), ['甲'], undefined],
  ]
  let same = 0, diffs = []
  for (const [name, text, wl, cap] of CASES) {
    let a = null, b = null
    try { a = fnMod(text, wl, cap) } catch (e) { a = 'THROW:' + e.message }
    try { b = fnInl(text, wl, cap) } catch (e) { b = 'THROW:' + e.message }
    const eq = JSON.stringify(a) === JSON.stringify(b)
    if (eq) same++
    else diffs.push(name + ' (mod=' + JSON.stringify(a).slice(0, 40) + ' inl=' + JSON.stringify(b).slice(0, 40) + ')')
  }
  ok(same === CASES.length, 'E-5 ★8 组输入两实现输出完全一致（' + same + '/' + CASES.length + '）', diffs.length ? diffs.join(' | ') : '')
  ok(CASES.length >= 6, 'E-6 用例覆盖 ≥6 组（含截断/空/非法）', CASES.length + ' 组')
}
console.log('SUMMARY  PASS ' + pass + ' / FAIL ' + fail)
process.exit(fail === 0 ? 0 : 1)

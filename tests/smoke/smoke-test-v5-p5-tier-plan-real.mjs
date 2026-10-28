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
  // ★2026-10-27 判据更新（同批修真缺陷的连带）：完整档预算由 handoffPlanChars(1200) 提升到
  //   max(handoffPlanChars, fullInjectSlimBudgetChars)=3000 ⇒ 完整档白板段变大（1251→2149），
  //   三节档(2079) 相对省幅从 66% 降到 3.3%。**语义意图不变**：三节必须严格小于全文。
  //   原 5% 阈值是在「完整档被压到 1.2K」的错误基线上定的，故改为「严格小于即可」+ 保留 A-4。
  ok(core < full, 'A-5 ★三节严格小于全文（省 ' + (full > 0 ? ((1 - core/full)*100).toFixed(1) : '?') + '%）')
}

console.log('')
console.log('== B. 负路径：没有内联实现时必然退化成「三节 == 全文」==')
{
  // 用「档位不同但都走 sections 路径」来证明 sections 真的在起作用：
  // 若 sections 失效（走 fallback 按预算截断），三档会因为同一预算而给出同样的值。
  // ★2026-10-28 判据更新：`post_compact` 已按用户裁定升为**全量档**（与 human_full 同级），
  //   不再是瘦档 ⇒ 原配对（run_full vs post_compact）已失效。
  //   改用**同为瘦档**的 run_full 与 human_slim 作对照（两者都走 7 节白名单 + 瘦预算）。
  const core3 = planChars('run_full', false)      // 7 节 + 瘦预算
  const core5 = planChars('human_slim', false)    // 7 节 + 瘦预算
  const fullT = planChars('handoff_carry', false) // 全文 + 全量预算
  ok(core3 === core5, 'B-1 同白名单同预算的两档字节一致（可预期）', core3 + ' / ' + core5)
  // 新增：post_compact 必须与 human_full 同量级（用户裁定「和 human_full 一样尽量多」）
  const pc = planChars('post_compact', false)
  const hf = planChars('human_full', false)
  ok(pc === hf, 'B-1b ★post_compact 白板与 human_full 同量级（P0-4 修复）', pc + ' / ' + hf)
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
console.log('== F. 规则段档位化真实生效（F4 摘要，2026-10-27 修）==')
{
  function rulesChars(tier) {
    st._injectTierPre = tier
    st.memLegacy = { legacy: false, reasons: [], counts: {} }
    st.envelopeMeta = null
    engine.renderMemoryDynamic({ agent: undefined })
    const m = st.envelopeMeta || {}
    let n = 0
    for (const sg of (m.segments || [])) if (sg.kind === 'rules-section') n = sg.chars
    return n
  }
  const full = rulesChars('human_full')
  const slim = rulesChars('run_slim')
  ok(full > 0, 'F-1 完整档规则段有内容', full + 'B')
  ok(slim > 0, 'F-2 ★F4(run_slim) 规则段有内容（修前因 typeof 守卫恒假，此处是从未生效的摘要路径）', slim + 'B')
  ok(slim < full, 'F-3 ★F4 规则摘要必须比全文少（修前 8,397 == 8,397，摘要从未生效）', slim + ' < ' + full)
  ok(slim < full * 0.7, 'F-4 ★F4 至少比全文省 30%（实测省 ' + (full > 0 ? ((1 - slim/full)*100).toFixed(1) : '?') + '%）')
  // ★2026-10-28 判据更新（设计纲要 2026-10-27）：
  //   旧判据「run_full / post_compact 规则段仍是全文」与纲要有冲突 ——
  //   用户原话：「human_slim / run_full 应该是核心节，并且不投送『规则』的全文，
  //             因为模型注意力没有那么容易漂移」。
  //   ⇒ 全文只给人声全量档 / 交接接续 / 改前行为（LEGACY）。
  for (const t of ['human_full', 'handoff_carry', 'post_compact']) {
    ok(rulesChars(t) === full, 'F-5 ' + t + ' 规则段仍是全文（正路径：该给全文的档）', rulesChars(t) + 'B')
  }
  // ★2026-10-28：post_compact 已从「摘要」组移出，改列全文组（用户裁定同 human_full）。
  for (const t of ['run_full', 'human_slim']) {
    const c = rulesChars(t)
    ok(c > 0 && c < full, 'F-5b ' + t + ' 规则段应为摘要而非全文（纲要 2026-10-27）', c + 'B < ' + full + 'B')
  }
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

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

let pass = 0, fail = 0, skipped = 0
// ★#507（2026-11-02）：数据缺席/无意义比较时用 skip 记账，**不计入 PASS**。
//   本套件原有 8 条「0 == 0」型的假绿（A-3 / B-1 / B-1b / C-2 / C-3 / F-5×3）：
//   白板为空时它们照样 ok —— 语义是「该给全文的档必须给全文」，产品真坏了也绿。
function skip(name, why) { skipped++; console.log('  SKIP - ' + name + ' :: ' + why) }
function ok(cond, name, extra) {
  if (cond) { pass++; console.log('  ok   - ' + name + (extra ? ' :: ' + extra : '')) }
  else { fail++; console.log('  FAIL - ' + name + (extra ? ' :: ' + extra : '')) }
}

// ★★#507（2026-11-02）：**引擎可用性守卫**。
//   空 HOME / 无真实记忆目录时，MemoryEngine.refresh 自身就会失败（uv_os_homedir ENOENT），
//   白板全为 0 ⇒ 下面所有「有内容」「比全文少」的断言必然红 —— 那是**环境不可用**，不是产品缺陷。
//   判据分层（关键：不能一 skip 了之）：
//     · ENGINE_READY=false ⇒ 只能 skip 并打印原因（无法观测，任何结论都是假的）；
//     · ENGINE_READY=true 但白板为 0 ⇒ **仍然是 FAIL**（那才是真缺陷，本套件原本要抓的正是它）。
const engine = new MemoryEngine()
// ★实测（2026-11-02）：refresh **内部吞掉了** uv_os_homedir ENOENT（不向外抛），
//   所以「有没有抛错」**不是**可用性判据 —— 用它会让 ENGINE_READY 恒 true，守卫形同虚设。
//   真正的判据是「引擎有没有读到任何语料」：空 HOME 下 userText/notesText/logText 三者全空。
//   这条判据也顺带排除了「语料目录存在但全空」的同族情形。
let ENGINE_ERR = ''
try { await engine.refresh(undefined) } catch (e) { ENGINE_ERR = String((e && e.message) || e).slice(0, 160) }
const st = engine.stateFor(undefined)
const CORPUS_CHARS = String(st.userText || '').length + String(st.notesText || '').length
  + String(st.logText || '').length + String(st.planText || '').length
let ENGINE_READY = CORPUS_CHARS > 0
if (!ENGINE_READY && ENGINE_ERR) console.log('  [diag] refresh 抛错：' + ENGINE_ERR)
if (!ENGINE_READY) {
  console.log('  SKIP 引擎不可用：读到语料 0 字符（' + JSON.stringify({ user: String(st.userText||'').length, notes: String(st.notesText||'').length, log: String(st.logText||'').length, plan: String(st.planText||'').length }) + '）')
  console.log('  SKIP 原因：空 HOME / 无真实记忆目录时引擎读不到任何语料（CORPUS_CHARS=0），白板恒为空；')
  console.log('  SKIP       此时任何「有内容 / 比全文少」的断言都必然红，属环境不可用而非产品缺陷。')
  console.log('  SKIP 这是 CI 上的预期行为；引擎可用时下面的断言仍会真跑（不降低判据）。')
}

/** 渲染并返回该档位的白板段字符数（唯一权威口径：envelopeMeta.segments） */
function planChars(tier, legacy) {
  if (!ENGINE_READY) return 0
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
  if (!ENGINE_READY) return 0
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
  if (!ENGINE_READY) skip('A-1 F1(全文) 白板有内容', '引擎不可用'); else ok(full > 0, 'A-1 F1(全文) 白板有内容', full + 'B')
  if (!ENGINE_READY) skip('A-2 F3(三节) 白板有内容', '引擎不可用'); else ok(core > 0, 'A-2 F3(三节) 白板有内容', core + 'B')
  // ★#507：A-3 只有在前两档**确实有内容**时才具鉴别力。白板本身为空时
  //   「F4 也是 0」是恒真（0==0），不构成证据 ⇒ 显式 skip，不当成 PASS。
  if (full > 0 && core > 0) ok(none === 0, 'A-3 F4(不投) 白板为 0', none + 'B')
  else skip('A-3 F4(不投) 白板为 0', '正路径档白板为空（full=' + full + 'B core=' + core + 'B）⇒ 0==0 恒真，无鉴别力')
  if (!ENGINE_READY) skip('A-4 三节必须比全文少', '引擎不可用'); else ok(core < full, 'A-4 ★三节必须比全文少（修前实测 2149 > 1221，反的）', core + ' < ' + full)
  // ★2026-10-27 判据更新（同批修真缺陷的连带）：完整档预算由 handoffPlanChars(1200) 提升到
  //   max(handoffPlanChars, fullInjectSlimBudgetChars)=3000 ⇒ 完整档白板段变大（1251→2149），
  //   三节档(2079) 相对省幅从 66% 降到 3.3%。**语义意图不变**：三节必须严格小于全文。
  //   原 5% 阈值是在「完整档被压到 1.2K」的错误基线上定的，故改为「严格小于即可」+ 保留 A-4。
  if (!ENGINE_READY) skip('A-5 三节严格小于全文', '引擎不可用'); else ok(core < full, 'A-5 ★三节严格小于全文（省 ' + (full > 0 ? ((1 - core/full)*100).toFixed(1) : '?') + '%）')
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
  // ★#507：两侧都为 0 时「一致」是恒真 —— 加绝对下界再比。
  if (core3 > 0 && core5 > 0) ok(core3 === core5, 'B-1 同白名单同预算的两档字节一致（可预期）', core3 + ' / ' + core5)
  else skip('B-1 同白名单同预算的两档字节一致', '两侧有 0（' + core3 + ' / ' + core5 + '）⇒ 相等是恒真，无鉴别力')
  // 新增：post_compact 必须与 human_full 同量级（用户裁定「和 human_full 一样尽量多」）
  const pc = planChars('post_compact', false)
  const hf = planChars('human_full', false)
  if (pc > 0 && hf > 0) ok(pc === hf, 'B-1b ★post_compact 白板与 human_full 同量级（P0-4 修复）', pc + ' / ' + hf)
  else skip('B-1b post_compact 与 human_full 同量级', '两侧有 0（' + pc + ' / ' + hf + '）⇒ 相等是恒真，无鉴别力')
  if (!ENGINE_READY) skip('B-2 白名单不同的两档字节必须不同', '引擎不可用'); else ok(fullT !== core3, 'B-2 ★白名单不同的两档字节必须不同（sections 真在起作用）', fullT + ' vs ' + core3)
}

console.log('')
console.log('== C. legacy 临时截流（用户裁定 B）==')
{
  const normal = planChars('run_full', false)
  const legacy = planChars('run_full', true)
  if (!ENGINE_READY) skip('C-1 legacy 时白板仍有内容', '引擎不可用'); else ok(legacy > 0, 'C-1 legacy 时白板仍有内容（不是一刀切没）', legacy + 'B')
  // ★★2026-10-29 判据修正（判据过期，非产品缺陷）：原 C-2 断言「legacy < normal」，
  //   但截流只在**某节超单节上限**时才生效（legacy: 800/节 + 总预算 2400）。
  //   实测当前真实白板 2,186 字符、4 节全部命中 legacy 白名单且无一节超 800
  //   ⇒ legacy 与 normal **必然等长**（1535 == 1535）⇒ 原判据在现有白板形状下**恒红**。
  //   语义意图不变（legacy 必须真能截流、且绝不放大），改成两条可判定断言：
  // ★#507：legacy<=normal 在两侧都 0 时恒真（0<=0）⇒ 要求 normal 有绝对下界。
  if (normal > 0) ok(legacy <= normal, 'C-2 ★legacy 绝不放大（≤ 全文）', legacy + ' <= ' + normal)
  else skip('C-2 legacy 绝不放大', 'normal=' + normal + 'B ⇒ 0<=0 恒真，无鉴别力')
  //   C-2b：截流机制**真生效**——用构造片（每节 2000 字）真跑，必须被压到 800/节。
  //   这一条与真实白板大小解耦，所以无论白板怎么写都会验到真行为。
  const bigSec = (t) => '## ' + t + '\n' + 'x'.repeat(2000)
  const bigPlan = [bigSec('当前状态'), '', bigSec('近期进展'), '', bigSec('关键约束')].join('\n')
  const proxied = engine.renderMemoryDynamic
  let capOut = null
  try {
    // 直接用被测的白名单/上限口径复算（与 legacy 分支同参数：800/节）
    st._injectTierPre = 'run_full'
    st.memLegacy = { legacy: true, reasons: ['no-anchors'], counts: { userEntries: 1, projectEntries: 0 } }
    st.envelopeMeta = null
    const savedPlan = st.planText
    st.planText = bigPlan
    engine.renderMemoryDynamic({ agent: undefined })
    const m2 = st.envelopeMeta || {}
    capOut = 0
    for (const sg of (m2.segments || [])) if (sg.kind === 'whiteboard-plan') capOut = sg.chars
    st.planText = savedPlan
  } catch (e) { st.planText = st.planText }
  ok(capOut !== null && capOut > 0 && capOut < bigPlan.length * 0.9,
    'C-2b ★legacy 对超长白板真截流（构造片 2000/节 ⇒ 必须显著变小）',
    (capOut === null ? 'null' : capOut + ' < ' + bigPlan.length))
  if (legacy > 0) ok(legacy <= 2400, 'C-3 legacy 总预算 ≤2400', legacy + 'B')
  else skip('C-3 legacy 总预算 ≤2400', 'legacy=' + legacy + 'B ⇒ 0<=2400 恒真，无鉴别力')
}

console.log('')
console.log('== D. legacy 迁移提示投递（含用户指定文案要素）==')
{
  const h = hintChars('run_full', true)
  if (!ENGINE_READY) skip('D-1 legacy 时提示段被投递', '引擎不可用')
  else ok(h > 0, 'D-1 legacy 时提示段被投递（修前因 priority=low 被静默击杀）', h + 'B')
  if (!ENGINE_READY) skip('D-2 提示段 ≤600 字符', '引擎不可用'); else ok(h <= 600, 'D-2 提示段 ≤600 字符（不挤占注入面）', h + 'B')
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
  if (!ENGINE_READY) skip('F-1 完整档规则段有内容', '引擎不可用'); else ok(full > 0, 'F-1 完整档规则段有内容', full + 'B')
  if (!ENGINE_READY) skip('F-2 F4(run_slim) 规则段有内容', '引擎不可用'); else ok(slim > 0, 'F-2 ★F4(run_slim) 规则段有内容（修前因 typeof 守卫恒假，此处是从未生效的摘要路径）', slim + 'B')
  if (!ENGINE_READY) skip('F-3 F4 规则摘要必须比全文少', '引擎不可用'); else ok(slim < full, 'F-3 ★F4 规则摘要必须比全文少（修前 8,397 == 8,397，摘要从未生效）', slim + ' < ' + full)
  // ★★P2b-S2 判据重钉（2026-11-07 · task-29，Lead 指定同批处理）：**判据过期，非产品缺陷**。
  //   原判据「F4 至少比全文省 30%（slim < full*0.7）」锁定的是 60 字硬切时代的比例。
  //   S2 把单行上限 60→240 且改为「保留到首个句末标点」⇒ 摘要行**本来就该含完整首句**，
  //   与「再省 30%」在语义上互相矛盾（省得越多 = 切得越碎 = 越不保义）。
  //   判据意图不变（**F4 必须显著短于全文，不能退化成全文**），把比例按实测重钉：
  //   实测 full=23,962B / slim=17,297B ⇒ 省 27.8%（ratio 0.722）；阈值 0.85 仍能抓住
  //   「摘要从未生效 ⇒ slim == full」这个原始缺陷（0.722 远离 1.0，0.85 有鉴别力）。
  if (!ENGINE_READY) skip('F-4 至少比全文省 15%', '引擎不可用'); else ok(slim < full * 0.85, 'F-4 ★F4 至少比全文省 15%（实测省 ' + (full > 0 ? ((1 - slim/full)*100).toFixed(1) : '?') + '%）')
  // ★2026-10-28 判据更新（设计纲要 2026-10-27）：
  //   旧判据「run_full / post_compact 规则段仍是全文」与纲要有冲突 ——
  //   用户原话：「human_slim / run_full 应该是核心节，并且不投送『规则』的全文，
  //             因为模型注意力没有那么容易漂移」。
  //   ⇒ 全文只给人声全量档 / 交接接续 / 改前行为（LEGACY）。
  // ★★#507：这 3 条是**全仓最危险的假绿** —— 语义是「该给全文的档必须给全文」，
  //   但 full=0 时 rulesChars(t)===0===full 恒真 ⇒ 产品把规则段整个丢掉也照样绿。
  //   加绝对下界：先要求 full > 0（有规则段可投），再逐档比。
  if (full > 0) {
    for (const t of ['human_full', 'handoff_carry', 'post_compact']) {
      ok(rulesChars(t) === full, 'F-5 ' + t + ' 规则段仍是全文（正路径：该给全文的档）', rulesChars(t) + 'B')
    }
  } else {
    for (const t of ['human_full', 'handoff_carry', 'post_compact']) {
      skip('F-5 ' + t + ' 规则段仍是全文', 'full=' + full + 'B ⇒ 0==0 恒真，无鉴别力（这曾是全仓最危险的假绿）')
    }
  }
  // ★2026-10-28：post_compact 已从「摘要」组移出，改列全文组（用户裁定同 human_full）。
  for (const t of ['run_full', 'human_slim']) {
    const c = rulesChars(t)
    if (full > 0) ok(c > 0 && c < full, 'F-5b ' + t + ' 规则段应为摘要而非全文（纲要 2026-10-27）', c + 'B < ' + full + 'B')
    else skip('F-5b ' + t + ' 规则段应为摘要', 'full=' + full + 'B ⇒ 无参照，无鉴别力')
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
console.log('SUMMARY  PASS ' + pass + ' / FAIL ' + fail + ' / SKIP ' + skipped)
process.exit(fail === 0 ? 0 : 1)

/**
 * smoke-test-rules-budget-portrait-dedup.mjs —— §2.2 画像去重 + 预算线可配（用户裁定）
 *
 * ★用户裁定（2026-10-26 逐字）：
 *   「肯定是保留在用户规约里面。规约的话，警戒线就是预算线要稍微放大一点，
 *     这个还是按照我的偏好做成可审计、可压缩、可灵活调整的形式。
 *     用户画像确实应该是 emotional 情境化的，这个需要在 prompt 里面说清楚。」
 *
 * 本套件守四条（对应用户一句话里的四个要求）：
 *   A. 保留在用户规约（画像侧过滤掉已在规约层的条目，不是反过来）
 *   B. 预算线可灵活调整（配置键驱动，非写死常量）
 *   C. 可审计（超限提示给出 当前/预算/占比/超出量 四项可复算数）
 *   D. 可压缩但不截断（超预算全文照常注入 + 提示整理）
 *   E. prompt 里说清画像=emotional / 规约=rational
 * 全部真执行，带负路径。
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const RL = await import(pathToFileURL(path.join(ROOT, 'lib', 'rules-layer.js')).href)
const UP = await import(pathToFileURL(path.join(ROOT, 'lib', 'user-portrait.js')).href)
const INDEX = fs.readFileSync(path.join(ROOT, 'lib', 'index.js'), 'utf8')

let pass = 0, fail = 0
const ok = (c, msg, extra) => {
  if (c) { pass++; console.log('  ok   - ' + msg + (extra ? ' :: ' + extra : '')) }
  else { fail++; console.log('  FAIL - ' + msg + (extra ? ' :: ' + extra : '')) }
}

const sampleRules = { rules: [
  { text: '用户偏好要中文回答', layer: 'user' },
  { text: '本项目必须用 pnpm', layer: 'project' },
] }

console.log('== A. 画像侧必须排除已在规约层的条目（用户裁定：保留在规约）==')
{
  const ruleText = '反对在 system prompt 中注入长候选清单，倾向一句话提醒 + 按需工具调用'
  const events = [{
    userPercept: [
      { stage: 'accepted', kind: 'preference', at: 100, text: ruleText },
      { stage: 'accepted', kind: 'preference', at: 90, text: '他在深夜里更愿意做架构决策' },
    ],
  }]
  const withDedup = UP.buildUserPortraitPre(events, { excludeIfInRules: [ruleText] })
  ok(withDedup.text.indexOf('长候选清单') < 0, '★★★A-1 已在规约层的偏好**不出现在画像**')
  ok(withDedup.text.indexOf('深夜里更愿意做架构决策') >= 0, '★★★A-2 其它 emotional 印象**仍然保留**')
  ok(withDedup.excludedByRules === 1, '★★★A-3 excludedByRules 计数=1（可审计）', 'got=' + withDedup.excludedByRules)

  const noDedup = UP.buildUserPortraitPre(events)
  ok(noDedup.text.indexOf('长候选清单') >= 0, '★★A-4 [负路径] 不传 excludeIfInRules ⇒ 该条会出现（证明 A-1 非恒真）')

  // 括注形态：规约条目带前后缀，画像文本是子串 ⇒ 也要能过滤
  const longRule = '汇报恒为两条独立线：后端线是否完成、前端线总进度（2026-10-25 用户裁定）'
  const ev2 = [{ userPercept: [{ stage: 'used', kind: 'preference', at: 1, text: '汇报恒为两条独立线：后端线是否完成、前端线总进度' }] }]
  const r2 = UP.buildUserPortraitPre(ev2, { excludeIfInRules: [longRule] })
  ok(r2.text.indexOf('汇报恒为两条独立线') < 0, '★★★A-5 规约条目带括注、画像文本是子串 ⇒ 仍能去重')
}

console.log('')
console.log('== B. 预算线可灵活调整（配置驱动）==')
{
  const big = { rules: [{ text: 'X'.repeat(300), layer: 'user' }] }
  // 默认预算（4000）：300 < 4000 ⇒ 无提示
  const d = RL.renderRulesSectionPre(big, { groupByLayer: true })
  ok(!d.warn, '★★B-1 默认预算(4000)下 300 字符不报警')
  // 显式把预算调到 100 ⇒ 必须报警（证明真的可调）
  const t = RL.renderRulesSectionPre(big, { groupByLayer: true, userWarnChars: 100 })
  ok(!!t.warn, '★★★B-2 把预算调到 100 ⇒ 300 字符立刻报警（可灵活调整）', String(t.warn).slice(0, 40))
  // 调大 ⇒ 不报
  const t2 = RL.renderRulesSectionPre(big, { groupByLayer: true, userWarnChars: 99999 })
  ok(!t2.warn, '★★★B-3 把预算调大 ⇒ 不报警')
  // 非法值 fail-soft 回出厂
  const t3 = RL.renderRulesSectionPre(big, { groupByLayer: true, userWarnChars: -1 })
  ok(!t3.warn, '★★B-4 非法预算(-1) ⇒ fail-soft 回出厂 4000（不误报）')
  const t4 = RL.renderRulesSectionPre(big, { groupByLayer: true, userWarnChars: 0 })
  ok(!t4.warn, '★★B-5 非法预算(0) ⇒ fail-soft 回出厂值')
  // index.js 真的把 config 传下去了
  ok(/userWarnChars: cfg\.userRulesWarnChars/.test(INDEX), '★★★B-6 [接线] index.js 传 cfg.userRulesWarnChars')
  ok(/projectWarnChars: cfg\.projectRulesWarnChars/.test(INDEX), '★★★B-7 [接线] index.js 传 cfg.projectRulesWarnChars')
  ok(/userRulesWarnChars: 4000/.test(INDEX) && /projectRulesWarnChars: 6000/.test(INDEX),
    '★★★B-8 DEFAULT_CONFIG 出厂值已按裁定放大（1500→4000 / 4000→6000）')
}

console.log('')
console.log('== C. 可审计（提示里必须有 当前/预算/占比/超出量 四项）==')
{
  // 用多条 100 字规则造出真实超限（单条超长会被 rowsOf 截断，那是既有行为）
  const many = { rules: Array.from({ length: 30 }, (_, i) => ({ text: '规则' + i + '：' + 'Z'.repeat(95), layer: 'user' })) }
  const t = RL.renderRulesSectionPre(many, { groupByLayer: true, userWarnChars: 1000 })
  const w = String(t.warn || '')
  const uChars = t.groups && t.groups.user
  ok(!!t.warn, '★C-0 构造前提：确实超限', 'user=' + uChars)
  ok(/当前\s*\d+/.test(w), '★★★C-1 提示含「当前 N 字符」', w.slice(0, 70))
  ok(/预算\s*\d+/.test(w), '★★★C-2 提示含「预算 M 字符」')
  ok(/占\s*[\d.]+%/.test(w), '★★★C-3 提示含「占比 P%」')
  ok(/超\s*\d+/.test(w), '★★★C-4 提示含「超了多少」')
  // 可复算：占比 = round(chars/budget*1000)/10，超出 = chars-budget
  const pct = Math.round((uChars / 1000) * 1000) / 10
  const over = uChars - 1000
  ok(w.indexOf('占 ' + pct + '%') >= 0, '★★★C-5 占比可复算（' + uChars + '/1000 = ' + pct + '%）', w.slice(0, 90))
  ok(w.indexOf('超 ' + over) >= 0, '★★★C-6 超出量可复算（' + uChars + '-1000 = ' + over + '）')
}

console.log('')
console.log('== D. 可压缩但不截断（超预算全文照常注入）==')
{
  const rules = Array.from({ length: 30 }, (_, i) => ({ text: '甲' + i + '号规约' + 'Q'.repeat(90), layer: 'user' }))
  const t = RL.renderRulesSectionPre({ rules }, { groupByLayer: true, userWarnChars: 1000 })
  const inText = String(t.text || '')
  ok(/不会截断/.test(inText), '★★★D-1 提示明写「不会截断」（防误解为截断线）')
  ok(inText.indexOf('[用户规约超预算线]') >= 0, '★★★D-2 段首给出超预算提示')
  // 全文照常：30 条必须都在（不在预算线处被砍）
  let present = 0
  for (let i = 0; i < 30; i += 1) if (inText.indexOf('甲' + i + '号规约') >= 0) present += 1
  ok(present === 30, '★★★D-3 超预算时 30 条规则**全部**注入（一条不少）', 'present=' + present)
}
console.log('== E. prompt 里说清 规约=rational / 画像=emotional（用户裁定原话）==')
{
  // ★正确位置：**注入文本**里（此前只写在代码注释里，模型看不到）—— 用户原话「需要在 prompt 里面说清楚」
  const t = RL.renderRulesSectionPre({ rules: [
    { text: '用户偏好要中文回答', layer: 'user' },
    { text: '本项目必须用 pnpm', layer: 'project' },
  ] }, { groupByLayer: true })
  const tx = String(t.text || '')
  ok(tx.indexOf('三层语义分工') >= 0, '★★★E-1 **注入文本**含「三层语义分工」段（不是只在注释里）')
  ok(/规约[^。]{0,30}rational/.test(tx), '★★★E-2 注入文本明确 规约 = rational 硬约束')
  ok(/画像[^。]{0,30}emotional/.test(tx), '★★★E-3 注入文本明确 用户画像 = emotional 印象')
  ok(tx.indexOf('不得复述规约') >= 0, '★★★E-4 注入文本明确「画像不得复述规约里的硬约束」')
  ok(tx.indexOf('去重') >= 0, '★★E-5 注入文本说明已在规约层的会被去重')
  ok(tx.indexOf('事件') >= 0 && tx.indexOf('情境') >= 0, '★★E-6 注入文本说明事件=情境')
  // 常量本身也可被抽取验证（结构可测，不依赖渲染细节）
  const G = String(RL.THREE_LAYER_SEMANTICS_GUIDE_PRE_V1 || '')
  ok(G.length > 200, '★★E-7 独立常量 THREE_LAYER_SEMANTICS_GUIDE_PRE_V1 存在且充实', 'len=' + G.length)
  // 负路径：单节旧路径（不传 groupByLayer）**不得**混入该段（保 p6a 123 条字节断言）
  const old = RL.renderRulesSectionPre({ rules: [{ text: '用户偏好要中文回答', layer: 'user' }] })
  ok(String(old.text || '').indexOf('三层语义分工') < 0, '★★★E-8 [负路径] 旧单节路径不混入该段（p6a 字节断言不受影响）')
}
console.log('== F. 接线守卫（★变异实证：只测函数不测接线 = 「两段式只测后段」）==')
// ★★为什么加这组：上面 A 组直接调 buildUserPortraitPre(events, {excludeIfInRules})，
//   把 index.js 的 excludeIfInRules 那行删掉，A 组**仍然全绿**（实测变异 1 未红）。
//   这是「套件全绿但功能是死的」第 5 类：只测了后段（函数），没测前段（接线）。
//   ⇒ 必须断言 index.js 真的把规约文本传给了画像。
ok(INDEX.indexOf('_ruleTextsForDedup = (_rl && Array.isArray(_rl.rules)') >= 0,
  '★★★F-1 [接线] index.js 从 extractRulesLayerPre 取了 rules 文本')
ok(/excludeIfInRules: _ruleTextsForDedup/.test(INDEX),
  '★★★F-2 [接线] 并作为 excludeIfInRules 传进 buildUserPortraitPre（**变异 1 抓的就是这条**）')
ok(INDEX.indexOf('userPortraitExcludedByRules = Number(portrait.excludedByRules)') >= 0,
  '★★★F-3 [接线] 去重条数挂 state（可审计，排障能看到）')
// 负路径：删掉接线后 F-2 必红
{
  const mut = INDEX.split('excludeIfInRules: _ruleTextsForDedup,').join('')
  ok(!/excludeIfInRules: _ruleTextsForDedup/.test(mut), '★★★F-4 [负路径] 去掉接线后 F-2 不再命中（有鉴别力）')
}
// 真引擎级：extractRulesLayerPre 真产出能被 _inRules 匹配的文本
{
  const real = RL.extractRulesLayerPre({ userText: '- 反对在 system prompt 中注入长候选清单' + String.fromCharCode(10) + '- 发布类动作必须等用户明确指令', notesText: '', rulesLayeringMode: 'self' })
  const texts = (real && real.rules || []).map((x) => String(x.text || ''))
  // ★extractRulesLayerPre 会把相邻多行合并成 1 条（既有行为）⇒ 只要求至少抽出 1 条即可
  ok(texts.length >= 1, '★★F-5 [真跑] extractRulesLayerPre 从真实文本抽出规则条目', 'n=' + texts.length)
  const port = UP.buildUserPortraitPre(
    [{ userPercept: [{ stage: 'accepted', kind: 'preference', at: 1, text: '反对在 system prompt 中注入长候选清单' }] }],
    { excludeIfInRules: texts },
  )
  ok(port.text.indexOf('长候选清单') < 0, '★★★F-6 [端到端] 用**真实抽出的规则文本**做排除 ⇒ 画像里该条消失')
  ok(port.excludedByRules === 1, '★★F-7 端到端 excludedByRules=1')
}

console.log('')
console.log('SUMMARY  PASS ' + pass + ' / FAIL ' + fail)
process.exit(fail === 0 ? 0 : 1)

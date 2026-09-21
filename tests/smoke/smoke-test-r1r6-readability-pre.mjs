// R1–R6 前端守卫：审批界面可读性契约。
//
// 用户原话（2026-09-19）：「你看这图片上他技能的名字和描述，都是很难让人看懂的。
// 这个也要在前端里更好地表示」「最后你在旧前端的基础上也要体现出来，要让人读懂。
// 比如说 procedure memory、skill 的内容，以及晋升的原因等等。」
//
// 本套件把这些要求固化成**可失败的断言**，防止日后回退成「看不懂只能盲确认」。
import { readFileSync } from 'node:fs'
import path from 'node:path'

const ROOT = process.cwd()
const C = readFileSync(path.join(ROOT, 'lib', 'client.js'), 'utf8')

let pass = 0, fail = 0
const t = (n, f) => { try { f(); pass++; console.log('  ok - ' + n) } catch (e) { fail++; console.log('  FAIL - ' + n + ': ' + (e && e.message)) } }
const assert = (c, m) => { if (!c) throw new Error(m || 'assertion failed') }

console.log('=== R3 stage 中文化 ===')

t('R3-1 ★★ stage 不再直接显示英文枚举，必须过 stageLabel()', () => {
  assert(/function stageLabel\(stage\)/.test(C), '★ 缺 stageLabel()')
  // 旧写法：'[' + p.stage + ']'（把英文枚举直接给用户看）
  assert(!/'\[" \+ p\.stage/.test(C) && !C.includes("'[' + p.stage + ']'"), '★★ 仍在直接拼 p.stage（英文枚举）')
  assert(C.includes("'[' + stageLabel(p.stage) + ']'"), '未使用 stageLabel 渲染 stage')
})

t('R3-2 ★ 五个 stage 都有中文文案', () => {
  for (const k of ['hubStageObserved', 'hubStageCandidate', 'hubStageValidated', 'hubStageActive', 'hubStageDeprecated']) {
    assert(new RegExp(k + ":\\s*'").test(C), '缺文案 ' + k)
  }
})

console.log('\n=== R2 晋升原因显式化 ===')

t('R2-1 ★★★ 必须把 reasonCodes 翻成人话（whyNotPromotable）', () => {
  assert(/function whyNotPromotable\(promotion\)/.test(C), '★ 缺 whyNotPromotable()')
  // 关键原因码都要有对应处理
  for (const code of ['observation-only', 'no-success-criteria', 'has-correction', 'diversity-below-', 'success-below-', 'correction-rate-', 'high-risk-awaiting-approval']) {
    assert(C.includes("'" + code + "'") || C.includes("'" + code), '未处理原因码 ' + code)
  }
})

t('R2-2 ★★ 界面上必须真的渲染出来（不是只定义了函数）', () => {
  assert(/t\('hubWhyTitle'\)/.test(C), '★ 未渲染「为什么还不能晋升」标题')
  assert(/whyNotPromotable\(p\.promotion\)/.test(C), '★ 渲染处未调用 whyNotPromotable')
})

t('R2-3 ★★ 文案要带**具体数字**与下一步（「需要 3 个，当前 1 个」）', () => {
  assert(/hubWhyDiversity: function \(d, need\)/.test(C), '★ diversity 文案未接收数字')
  assert(/hubWhySuccess: function \(n, need\)/.test(C), '★ success 文案未接收数字')
  assert(/diversity != null \? d\.diversity/.test(C), '未把 detail.diversity 传进文案')
  assert(/successCount != null \? d\.successCount/.test(C), '未把 detail.successCount 传进文案')
  // ★ 光有签名不够 —— 文案体内必须真的**拼进**这两个变量，
  //   否则「条件不足」这种空话也能通过（变异 5 实测假绿，故补此断言）。
  const m = C.match(/hubWhyDiversity: function \(d, need\) \{ return ([^\n]+) \}/)
  assert(m, '未找到 hubWhyDiversity 文案体')
  assert(/' \+ need \+ '/.test(m[1]) && /' \+ d \+ '/.test(m[1]),
    '★★ diversity 文案体未把 need/d 拼进句子，实际：' + m[1])
  const m2 = C.match(/hubWhySuccess: function \(n, need\) \{ return ([^\n]+) \}/)
  assert(m2, '未找到 hubWhySuccess 文案体')
  assert(/' \+ need \+ '/.test(m2[1]) && /' \+ n \+ '/.test(m2[1]),
    '★★ success 文案体未把 need/n 拼进句子，实际：' + m2[1])
})

console.log('\n=== R5 evidence 人话 ===')

t('R5-1 ★★ evidence 不再只显示裸数字', () => {
  assert(/hubEvLine: function \(ev\)/.test(C), '★ 缺 hubEvLine()')
  assert(/t\('hubEvLine'\)\(ev\)/.test(C), '★ 渲染处未调用 hubEvLine')
  // 旧写法：成功 N · 会话 N（两个裸数字）
  assert(!/\(locale === 'zh' \? '成功 ' : 'succ '\) \+ \(ev\.success/.test(C), '★ 旧的裸数字写法仍在')
})

t('R5-2 ★ 文案含「见过/成功/跨会话」三类量', () => {
  assert(/见过 ' \+ \(ev\.seen \|\| 0\)/.test(C), '未见「见过」')
  assert(/成功 ' \+ \(ev\.success/.test(C), '未见「成功」')
  assert(/个会话里用过/.test(C), '未见「会话」')
})

console.log('\n=== R4 晋升后预览 ===')

t('R4-1 ★★ 必须能预览「晋升后会注入什么」', () => {
  assert(/hubInjectPreview/.test(C), '缺预览入口文案')
  assert(/\(p\.steps \|\| \[\]\)\.map/.test(C), '★ 未渲染真实 steps')
  assert(/hubInjectCriteria/.test(C), '★ 未渲染 successCriteria')
  // ★ 三个部件必须在**同一个三元表达式**里同时出现 —— 光各自存在不够
  //   （变异 4 把条件改成 (false) 后，三个字符串仍在文件里，原断言照样绿 ⇒ 假绿）。
  const i = C.indexOf("? h('details'")
  assert(i > 0, '★ 未找到预览的详情块')
  const seg = C.slice(i, i + 900)
  assert(/hubInjectPreview/.test(seg) && /\(p\.steps \|\| \[\]\)\.map/.test(seg) && /hubInjectCriteria/.test(seg),
    '★★ 预览三部件不在同一分支内（条件被短路后用户就看不到了）')
  // 且该三元条件的**真分支**必须真的是条件表达式，不能被写成常量
  const cond = C.slice(Math.max(0, i - 160), i)
  assert(!/\(false\)\s*$/.test(cond.trim()) && !/\(0\)\s*$/.test(cond.trim()),
    '★★ 预览条件被写成常量，用户永远看不到预览')
})

t('R4-2 ★★ 无步骤时必须如实说明（不得假装有内容）', () => {
  assert(/hubNoSteps/.test(C), '★ 缺「无可用步骤」说明')
  assert(/机械截断/.test(C) || /mechanically truncated/.test(C), '★ 说明里未点出「机械截断」这一真因')
})

console.log('\n=== R6 保留可撤回 ===')

t('R6-1 ★ 三个操作按钮仍在（晋升/激活/弃用）', () => {
  for (const act of ['promote', 'activate', 'deprecate']) {
    assert(new RegExp("hubAct\\('" + act + "'").test(C), '★ 缺操作按钮 ' + act)
  }
})

t('R6-2 ★★ 观察型条目仍隐藏晋升按钮（issue30 契约不得回退）', () => {
  // ★2026-09-21(A-9)收紧:晋升按钮条件由「仅 !observationOnly」改为
  //   「!observationOnly && 只读投影 decision==='promote'」——多了一道与真实门限对齐的判据。
  //   本断言随之改为**按意图验证**:晋升按钮所在的条件区必须仍含 !p.observationOnly。
  //   (不再锁死紧邻字面量,否则排版一变就假红。)
  const iBtn = C.indexOf("hubAct('promote'")
  assert(iBtn > 0, '找不到晋升按钮调用点')
  const condZone = C.slice(Math.max(0, iBtn - 400), iBtn)
  assert(/!p\.observationOnly/.test(condZone), '★ 观察型条目的晋升按钮又出现了（条件区缺 !p.observationOnly）')
  // A-9 附加:按钮还须受只读投影约束(与 store 真实门限一致)
  assert(/p\.promotion/.test(condZone), '★ 晋升按钮未对齐只读投影 p.promotion(A-9 契约)')
})

console.log('\n[r1r6] ' + pass + ' passed, ' + fail + ' failed')
process.exit(fail ? 1 : 0)

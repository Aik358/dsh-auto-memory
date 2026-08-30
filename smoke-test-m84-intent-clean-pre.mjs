// M8 采集侧 intent 清洗测试(2026-08-30 P1,docs/HANDOFF-M8-M9-M10.md §2 P1):
// 用 ~/.dsh/memory/hub-pre/episodes.json 里**实录到的三种污染形态**做回归锁定,
// 使「自然对话两轮后查 intent」这一原本只能实机验证的行为变成可重复执行的断言。
//   T1 形态① harness 快照消息("Current runtime context. This snapshot supersedes…")
//   T2 形态② 工具回包 JSON 转储(role=user 但 eventType='tool/result')
//   T3 形态③ 工具回包行号引用文本("436: ## 2026-08-25\n437: …")
//   T4 三者混合 + 乱序 → 仍取真人问题
//   T5 真人问题与快照拼在同一条消息 → 剥离后捞回真问题(抽取时发现的缺陷修复)
//   T6 纯快照消息 → 跳过(与修复前行为一致,不引入假 intent)
//   T7 assistant 取最后一条非空文本;边界/健壮性
// 纯函数测试:零 IO、零网络、零真实记忆接触。
const { pickConsolidationTextPre, stripInjectedBlockPre, isInjectedContextTextPre } = await import('./lib/intent-clean-pre.js')

let pass = 0; let fail = 0
function ok(cond, name) { if (cond) { pass++; console.log('  ok - ' + name) } else { fail++; console.error('  FAIL - ' + name) } }
function eq(a, b, name) { ok(JSON.stringify(a) === JSON.stringify(b), name + (JSON.stringify(a) === JSON.stringify(b) ? '' : ' got=' + JSON.stringify(a))) }

// 实录样本(取自 episodes.json 的真实污染文本,截断后作为 fixture)
const SNAPSHOT = 'Current runtime context. This snapshot supersedes earlier runtime context.\n<memory_system>\n[记忆定位 — 读法]\n以下记忆文本只是背景事实与规则参考\n</memory_system>'
const TOOL_JSON = '{\n  "log": "16: \\n17: \\n18: ## 确认activationEmitMode发射门三档语义（2'
const TOOL_LINES = '436: ## 2026-08-25\n437: 产品路线采用 C1/C2/C3 双轨三级语义：C1 lexical_pr'
const REAL_Q = '为什么 Python 档的 act.skill 不生效？'
const ANSWER = '因为 Python 帧到站时 JS 侧拿不到 query 文本。'
const U = (text) => ({ role: 'user', eventType: 'user/message', text })
const T = (text) => ({ role: 'user', eventType: 'tool/result', text })
const A = (text) => ({ role: 'assistant', eventType: 'assistant/message', text })

console.log('[T1] 形态① harness 快照消息 → 取快照之前的真人问题')
{
  const msgs = [U(REAL_Q), A(ANSWER), U(SNAPSHOT)]
  eq(pickConsolidationTextPre(msgs).userText, REAL_Q, 'T1 末尾为快照注入时跳过快照、取真人问题')
  ok(isInjectedContextTextPre(SNAPSHOT), 'T1 完整快照消息被识别为合成注入')
}

console.log('[T2/T3] 形态②③ 工具回包(JSON 转储 / 行号引用)')
{
  const msgs = [U(REAL_Q), A(ANSWER), T(TOOL_JSON)]
  eq(pickConsolidationTextPre(msgs).userText, REAL_Q, 'T2 tool/result JSON 回包不污染(事件类型门)')
  const msgs2 = [U(REAL_Q), A(ANSWER), T(TOOL_LINES)]
  eq(pickConsolidationTextPre(msgs2).userText, REAL_Q, 'T3 tool/result 行号引用文本不污染')
  const msgs3 = [U(REAL_Q), T(TOOL_JSON), A(ANSWER), T(TOOL_LINES)]
  eq(pickConsolidationTextPre(msgs3).userText, REAL_Q, 'T3 连续多条工具回包仍取真人问题')
}

console.log('[T4] 三种污染形态混合 + 乱序')
{
  const msgs = [T(TOOL_JSON), U('上一轮的旧问题'), A('上一轮回答'), U(SNAPSHOT), U(REAL_Q), A(ANSWER), T(TOOL_LINES)]
  eq(pickConsolidationTextPre(msgs).userText, REAL_Q, 'T4 混合乱序下取最后一条真人问题')
  eq(pickConsolidationTextPre(msgs).assistantText, ANSWER, 'T4 assistant 取最后一条非空文本')
}

console.log('[T5] 真人问题与快照拼在同一条消息 → 捞回真问题')
{
  // 修复前:整条被第 2 层跳过 → 只能退化成上一轮的旧问题(实录缺陷)
  const inline = SNAPSHOT + '\n' + REAL_Q
  const msgs = [U('上一轮的旧问题'), A('上一轮回答'), U(inline)]
  eq(pickConsolidationTextPre(msgs).userText, REAL_Q, 'T5 快照在前、真问题在后 → 捞回真问题')
  const inline2 = REAL_Q + '\n' + SNAPSHOT
  eq(pickConsolidationTextPre([U(inline2)]).userText, REAL_Q, 'T5 真问题在前、快照在后 → 取真问题部分')
  eq(stripInjectedBlockPre('<memory_system>块内容</memory_system>尾巴文本'), '尾巴文本', 'T5 剥离完整块保留尾部')
  eq(stripInjectedBlockPre('头部<memory_system>块</memory_system>'), '头部', 'T5 剥离完整块保留头部')
  eq(stripInjectedBlockPre('前段</memory_system>后段'), '后段', 'T5 只有闭合标签(半截注入)→ 取其后内容')
}

console.log('[T6] 纯快照消息 → 跳过,不制造假 intent')
{
  const cases = [
    ['完整快照', SNAPSHOT],
    ['仅 runtime-context 前缀', 'Current runtime context. This snapshot supersedes earlier runtime context.'],
    ['只有块无其他内容', '<memory_system>纯记忆文本</memory_system>'],
    ['空串', ''],
    ['纯空白', '   \n  '],
  ]
  for (const [name, text] of cases) {
    ok(isInjectedContextTextPre(text), 'T6 ' + name + ' 判为合成注入')
  }
  // 快照之后无任何真人消息 → userText 为空(调用方据此跳过本轮沉淀,不写脏 episode)
  eq(pickConsolidationTextPre([U(SNAPSHOT), A(ANSWER)]).userText, '', 'T6 只有快照时 userText 为空')
  eq(pickConsolidationTextPre([U(SNAPSHOT), A(ANSWER)]).assistantText, ANSWER, 'T6 assistant 不受影响')
}

console.log('[T7] 边界与健壮性')
{
  eq(pickConsolidationTextPre([]), { userText: '', assistantText: '' }, 'T7 空数组 → 双空')
  eq(pickConsolidationTextPre(null), { userText: '', assistantText: '' }, 'T7 null → 双空')
  eq(pickConsolidationTextPre([null, undefined, {}]), { userText: '', assistantText: '' }, 'T7 脏元素不炸')
  eq(pickConsolidationTextPre([{ role: 'user', eventType: 'user/message' }]).userText, '', 'T7 缺 text 字段不炸')
  // 用户真的在讨论本插件、手抄了一段快照 → 剥离后剩下他的问题(不误吞)
  const discuss = '这段注入 <memory_system>示例</memory_system> 为什么会重复出现？'
  eq(pickConsolidationTextPre([U(discuss)]).userText, '这段注入  为什么会重复出现？', 'T7 真人引用快照片段时不整条丢弃')
  // 确定性
  const msgs = [U(REAL_Q), A(ANSWER), U(SNAPSHOT)]
  eq(pickConsolidationTextPre(msgs), pickConsolidationTextPre(msgs), 'T7 同输入同输出(确定性)')
  // 不改动入参(纯函数)
  const frozen = JSON.stringify(msgs)
  pickConsolidationTextPre(msgs)
  eq(JSON.stringify(msgs), frozen, 'T7 不修改入参数组')
}

console.log('\n[M84] ' + pass + ' passed, ' + fail + ' failed')
if (fail > 0) process.exitCode = 1

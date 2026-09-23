#!/usr/bin/env node
/**
 * smoke-test-r5-envelope-structural-pre.mjs —— 运行时信封**结构判据**套件（2026-09-19 R5）
 *
 * 背景（③ Hermes 遗留 / issue #30 / H-3）：
 *   旧清洗器用一条**行首字面量白名单**识别信封，真机 `~/.dsh/memory/hub-pre/procedures.json`
 *   里 4 条 observed 条目的 title 就是运行时信封，实测**全部漏网**：
 *     · `Approval prompts are disabled in this session: …`（英文声明头）
 *     · `{"path":"D:\\…`（工具回包 JSON 转储，且被**截断**）
 *     · 中文「当前运行时上下文。」
 *     · `Approval prompts are disabled in this se`（**被截断到 40 字符，冒号都没了**）
 *
 * 本套件锁定**结构判据**（形态侦测）而非继续枚举整句前缀：
 *   F1 结构化转储：`{"`/`[{`/`["` 强开幕（允许未闭合 —— 真机就是断的）
 *   F2 声明头词族 + 分隔符 / be 动词陈述（词族可扩展，不依赖具体措辞）
 *   F2 位置约束 leadingOnly：仅对消息**开头信封区**生效，出现真人文本即关闭
 *
 * 反向锁（防回退 + 防误伤）：
 *   · 真人原话必须逐字保留（含以 "Policy:" 开头的正文句 —— 位置约束的意义）
 *   · 代码块/引用块内的字面示例不得被删
 *   · 不得退回「整句字面量白名单」形态（断言判据是**族**而不是整句）
 */
import { stripRuntimeIntentPre, RUNTIME_ENVELOPE_PRE_V1 } from '../../lib/intent-clean-safe.js'
import { readFileSync } from 'node:fs'

let pass = 0, fail = 0
const ok = (c, n, x) => {
  if (c) { pass++; console.log('  ok -', n) }
  else { fail++; console.error('  FAIL -', n, x == null ? '' : x) }
}

console.log('\n[R1] 真机实录的 4 类漏网信封 —— 必须被清空')
{
  const ENVELOPES = [
    ['英文声明头 + 冒号', 'Approval prompts are disabled in this session: actions that require approval are rejected automatically'],
    ['工具回包 JSON（完整）', '{"path":"D:\\\\personal_issue\\\\.dsh-vision","type":"image"}'],
    ['工具回包 JSON（★被截断）', '{"path":"D:\\\\personal_issue\\\\.dsh-vision'],
    ['中文声明头', '当前运行时上下文。本快照取代更早的快照。'],
    ['★英文声明头被截断到 40 字符（连冒号都没了）', 'Approval prompts are disabled in this se'],
    ['架构演进出的新措辞（同词族）', 'Escalation prompts are handled by the host automatically'],
    ['沙箱策略声明', 'Sandbox policy: danger-full-access. The sandbox does not restrict modifications.'],
  ]
  for (const [name, t] of ENVELOPES) {
    const out = stripRuntimeIntentPre(t).trim()
    ok(out === '', '剥离后为空 · ' + name, '得到 ' + JSON.stringify(out.slice(0, 70)))
  }
}

console.log('\n[R2] 真人原话 —— 必须逐字保留（防误伤反向锁）')
{
  const HUMANS = [
    '让我自己去试吧。现在是什么情况？',
    '开始实施',
    '开始实施,实施完给我准确的报告保证我能看懂',
    // ★ 位置约束的意义：正文里出现 "Policy:" 不该被删（此时已出现真人文本）
    '前一句是人的话。\nPolicy: 我说的是我自己的策略，不是 harness 的。',
    '帮我看看 Session 那边的配置对不对',
    // ★ F1 不得过度放宽：花括号起头的真人文本不是 JSON 转储（M5 变异点）
    '{这个花括号} 是什么意思？',
    '{待定} 明天再问你',
    '[重要] 记得改配置',
    // ★★ M5 精确边界：强开幕（`{"`）但**未闭合且无引号键值** ⇒ 不是转储，必须保留。
    //    正确实现：strongOpen=true → 未闭合 → 再查 `"key":` 不匹配 ⇒ 判为非转储。
    //    若有人为"多覆盖 JSON"删掉第二道守卫（M5 变异），这条会被误删 ⇒ 真红。
    '{"这个是半截引号开头的中文，不是 JSON',
  ]
  for (const t of HUMANS) {
    const out = stripRuntimeIntentPre(t).trim()
    ok(out === t.trim(), '逐字保留：' + JSON.stringify(t.slice(0, 46)), '得到 ' + JSON.stringify(out.slice(0, 70)))
  }
}

console.log('\n[R3] ★ 位置约束：信封区之后的同形文本不删（leadingOnly 的核心行为）')
{
  const t = 'Current runtime context. This snapshot supersedes earlier ones.\n帮我把 Policy: x 改成 y'
  const out = stripRuntimeIntentPre(t)
  ok(!out.includes('supersedes'), '开头信封被剥离')
  ok(out.includes('Policy: x'), '★ 真人正文里的同形文本被保留', JSON.stringify(out))
}

console.log('\n[R4] 代码块 / 引用块内的字面示例不得被删（原有保护不能破）')
{
  const fenced = '```\nApproval prompts are disabled in this session: fake example\n```'
  ok(stripRuntimeIntentPre(fenced).includes('fake example'), '代码块内信封原样保留')

  const quoted = '> {"path":"D:\\\\x","type":"image"}'
  ok(stripRuntimeIntentPre(quoted).includes('"path"'), '引用块内 JSON 原样保留')

  const indented = '    {"path":"D:\\\\y"}'
  ok(stripRuntimeIntentPre(indented).includes('"path"'), '四空格缩进块内 JSON 原样保留')
}

console.log('\n[R5] 标签块行为不回归（memory_system / system-reminder / long_term_memory）')
{
  const t = '<memory_system>\n[记忆定位 — 读法]\n内存内容\n</memory_system>\n让我自己去试吧。'
  const out = stripRuntimeIntentPre(t).trim()
  ok(!out.includes('记忆定位'), '标签块被剥离')
  ok(!out.includes('内存内容'), '★ 标签块内的全部内容被剥离（防残留）')
  ok(out.includes('让我自己去试吧'), '标签后的真人文本保留')
  // ★ 不留残行（幂等与整洁性；M6 变异点：stack 非空时仍 push 会留下残行）
  ok(!/^\s*$/.test(out.split('\n')[0] || 'x'), '★ 剥离后首行不是空行')
  ok(out.split('\n').length === 1, '★ 剥离后只剩一行（真人文本），无残留行')
}

console.log('\n[R6] ★ 判据是「词族」而非整句字面量（防回退反向锁）')
{
  const src = readFileSync(new URL('../../lib/intent-clean-safe.js', import.meta.url), 'utf8')
  // 断言：判据里出现**词族枚举**（多个候选词以 | 连接），而不是单条整句前缀
  ok(/\bapproval\b/i.test(src) && /\bsandbox\b/i.test(src) && /\bescalation\b/i.test(src),
    '★ 词族含 approval/sandbox/escalation（形态侦测）')
  ok(/BE_STATEMENT_RE/.test(src), '★ 存在 be 动词陈述判据（覆盖截断形态）')
  ok(/leadingOnly/.test(src), '★ 存在位置约束（防正文误伤）')
  // 反回退：不得只剩老的整句白名单
  const oldStyleOnly = !/HARNESS_HEAD_RE/.test(src) && !/BE_STATEMENT_RE/.test(src)
  ok(!oldStyleOnly, '未退回「仅整句字面量白名单」')
}

console.log('\n[R7] 导出的判据对象可直接断言（不只能靠整串行为间接验证）')
{
  ok(RUNTIME_ENVELOPE_PRE_V1 && typeof RUNTIME_ENVELOPE_PRE_V1.isEnvelopeLinePre === 'function',
    'RUNTIME_ENVELOPE_PRE_V1.isEnvelopeLinePre 可调用')
  ok(RUNTIME_ENVELOPE_PRE_V1.isEnvelopeLinePre('Approval prompts are disabled in this se') === true,
    '判据直接命中截断形态')
  ok(RUNTIME_ENVELOPE_PRE_V1.isEnvelopeLinePre('开始实施') === false,
    '判据不误伤真人原话')
}

console.log('\n[R8] 确定性与幂等')
{
  const t = 'Current runtime context. x\nApproval prompts are disabled in this se\n开始实施'
  const a = stripRuntimeIntentPre(t)
  const b = stripRuntimeIntentPre(t)
  ok(a === b, '同输入同输出')
  ok(stripRuntimeIntentPre(a) === a, '幂等（再过一遍不变）')
  ok(a.trim() === '开始实施', '★ 混合序列只剩真人原话', JSON.stringify(a))
}

console.log(`\n[R5-envelope-structural] ${pass} passed, ${fail} failed`)
if (fail) process.exit(1)

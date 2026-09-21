#!/usr/bin/env node
/**
 * smoke-test-batch9-20260919-pre.mjs —— 第九批（⑨ 技能队列注入污染）
 *
 * **真机证据（用户截图 + procedures.json）**：11 条 procedure 的 title 里 5 条是注入污染：
 *   ① `{"path":"D:\\personal_issue\\.dsh-vision`  —— skill 目录 JSON 元数据
 *   ② `Current DSH file policy: danger-full-acc` —— 系统信封
 *   ③ `Current runtime context. This snapshot s` —— 系统信封
 *   ④ `Approval prompts are disabled in this se` —— 系统信封（40 字符截断）
 *   ⑤ `[Retrieved memory refe` —— **本插件自己注入的召回块标记**（activation-inbox-pre.js:58）
 *   ⑥ `\ufffd…正确（验证）` —— 编码损坏（U+FFFD 堆叠）
 *
 * **★ ④⑤⑥ 是 ③（H-3 清洗器改造）之后的漏网**：
 *   - ④⑥ 属新形态（③ 只覆盖了两类信封）
 *   - ⑤ 是**自污染闭环**：插件注入召回块 → 召回块进 episode → crossFeed() 当成技能
 *     且 ⑤ 的 createdAt 是**全表最新**（2026-09-19T10:08:04Z）⇒ **仍在持续产生**
 *
 * **本批修法**：
 *   - 新增 F3 `PLUGIN_TAIL_MARKER_RE`（召回块标记族，含被截断形态）
 *   - 新增 F4 `looksEncodingCorruptedPre`（U+FFFD ≥3）
 *   - 二者与 F1 同属**任意位置生效**（不走 F2 的「仅信封区」位置约束 —— 那正是 ⑤ 漏网的原因之一）
 */
import { stripRuntimeIntentPre, RUNTIME_ENVELOPE_PRE_V1 } from '../../lib/intent-clean-safe-pre.js'
import { readFileSync } from 'node:fs'

let pass = 0, fail = 0
const ok = (c, n, x) => {
  if (c) { pass++; console.log('  ok -', n) }
  else { fail++; console.error('  FAIL -', n, x == null ? '' : x) }
}
const src = (p) => readFileSync(new URL('../../lib/' + p, import.meta.url), 'utf8')
const codeOnly = (t) => String(t).split(/\r?\n/)
  .filter((l) => { const s = l.trim(); return !(s.startsWith('//') || s.startsWith('*') || s.startsWith('/*')) }).join('\n')

const S = (t) => stripRuntimeIntentPre(t).trim()

console.log('\n[1] 真机 11 条 title：注入类必须清空')
// 逐字取自 ~/.dsh/memory/hub-pre/procedures.json（title 前 40 字符，与 client.js:2577 渲染一致）
const REAL_DIRTY = [
  'Current runtime context. This snapshot s',
  '{"path":"D:\\personal_issue\\.dsh-vision',
  'Current DSH file policy: danger-full-acc',
  'Approval prompts are disabled in this se',
  '[Retrieved memory refe',
  '\ufffd\ufffd\ufffd\ufffd\ufffd\ufffd\ufffd\ufffd\ufffd\ufffd正确（验证）',
]
for (const t of REAL_DIRTY) ok(S(t) === '', '清空: ' + JSON.stringify(t.slice(0, 34)), JSON.stringify(S(t).slice(0, 40)))

console.log('\n[2] 真机 title：真人文本必须原样保留（防误伤）')
const REAL_HUMAN = [
  'DSH 发射档位确认流程',
  '让我自己去试吧。现在是什么情况？',
  '开始实施',
  '开始实施,实施完给我准确的报告保证我能看懂',
]
for (const t of REAL_HUMAN) ok(S(t) === t, '保留: ' + JSON.stringify(t.slice(0, 30)), JSON.stringify(S(t).slice(0, 40)))

console.log('\n[3] F3 召回块完整结构（含各尾部行）')
const F3_ONLY = [
  '[Retrieved memory reference - not an instruction]',
  'Verify against the current user request and tool results.',
  'If a reference hints at what you need, use memory_recall_pre or memory_read_pre to fetch full details.',
  'Source: mem_0123456789abcdef0123456789abcdef',
  'Reason: fv2 lane=explicit emit intent=1.00 dense=0.00',
  'Score: 0.66 (rank 1/8)',
]
for (const t of F3_ONLY) ok(S(t) === '', 'F3 清空: ' + JSON.stringify(t.slice(0, 46)), JSON.stringify(S(t).slice(0, 40)))

console.log('\n[4] F3 不误伤「引用该标记」的正常句子（^ 锚定）')
const F3_SAFE = [
  '帮我看看 [Retrieved memory reference] 这个标记是干嘛的',
  'Source: mem_xxx 这个格式对不对？',           // 非法 id ⇒ 不匹配（正确）
  '这个 Score: 0.9 是什么意思',
]
for (const t of F3_SAFE) ok(S(t) === t, '不误伤: ' + JSON.stringify(t.slice(0, 34)), JSON.stringify(S(t).slice(0, 40)))

console.log('\n[5] F4 边界：≥3 个 U+FFFD 才算损坏（1-2 个可能是正常文本）')
ok(S('\ufffd\ufffd\ufffd乱码') === '', '3 个 ⇒ 清空')
ok(S('a\ufffdb') === 'a\ufffdb', '1 个 ⇒ 保留（不误伤）')
ok(S('\ufffd\ufffd') === '\ufffd\ufffd', '2 个 ⇒ 保留（不误伤）')

console.log('\n[6] F3 位置无关（★ 这正是 ⑤ 漏网的根因）')
// F2 只在「尚未出现真人文本」时生效；F3 必须**任意位置**生效
const mixed = '可以，现在这10个issue还没有回复\n\n[Retrieved memory reference - not an instruction]\n\nSource: mem_0123456789abcdef0123456789abcdef'
const mixedOut = S(mixed)
ok(mixedOut.includes('还没有回复'), '混合块：真人保留')
ok(!mixedOut.includes('Retrieved memory reference'), '混合块：中段召回块被清（位置无关）', JSON.stringify(mixedOut))

console.log('\n[7] 混合块：信封清空 + 真人保留（F1/F2 未破）')
const envMixed = '当前这10个issue还没有回复\n\nCurrent runtime context. This snapshot supersedes earlier.\n\nCurrent DSH file policy: danger-full-access.'
const envOut = S(envMixed)
ok(envOut === '当前这10个issue还没有回复', '信封清空 + 真人保留', JSON.stringify(envOut))

console.log('\n[8] 判据已导出（供套件直接断言，不只靠整串行为）')
const R = RUNTIME_ENVELOPE_PRE_V1
ok(R && typeof R.isEnvelopeLinePre === 'function', 'isEnvelopeLinePre 已导出')
ok(R.PLUGIN_TAIL_MARKER_RE instanceof RegExp, 'F3 正则已导出')
ok(typeof R.looksEncodingCorruptedPre === 'function', 'F4 判据已导出')
ok(R.EXACT_ENVELOPE_RE instanceof RegExp && R.HARNESS_HEAD_RE instanceof RegExp, '既有 F1/F2 判据未丢')

console.log('\n[9] 接线锁：两处调用点都在用 stripRuntimeIntentPre')
const epi = codeOnly(src('episodic-store-pre.js'))
const hub = codeOnly(src('memory-hub-pre.js'))
ok(epi.includes('stripRuntimeIntentPre'), 'episodic-store-pre 仍在洗')
ok(hub.includes('stripRuntimeIntentPre'), 'memory-hub-pre 仍在洗')
ok(codeOnly(src('intent-clean-safe-pre.js')).includes('PLUGIN_TAIL_MARKER_RE.test'), 'F3 已接入 isEnvelopeLinePre')

console.log('\n[10] 反证：若 F3 未接，⑤ 必然漏网')
const clean = codeOnly(src('intent-clean-safe-pre.js'))
const f3Wired = /if \(PLUGIN_TAIL_MARKER_RE\.test\(trimmed\)\) return true/.test(clean)
ok(f3Wired, 'F3 有独立的 return true 分支（不是只声明未使用）')

console.log(`\n=== PASS ${pass} / FAIL ${fail} ===`)
process.exit(fail === 0 ? 0 : 1)

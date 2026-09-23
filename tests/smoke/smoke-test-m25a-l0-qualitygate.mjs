/**
 * M2.5a · L0 抽取质量门（笔记层废数据修复）
 *
 * 背景（实测，2026-09-18）：
 *   规则① 假设「有标题 ⇒ 标题即摘要」，该假设只对日志成立。
 *   日志 `## 主题（12:02）` → 去时间后缀 = 真摘要 ✅
 *   笔记 `## 2026-09-17`（纯日期）→ 去后缀无效 ⇒ L0 = 一个日期 ❌
 *   危害：笔记层（结论层）向量彼此几乎相同 ⇒ 语义臂几乎不可检索。
 *
 * 修法（三条）：
 *   ① 规则① 加质量门：退化标题不采信，继续下探
 *   ② 规则③ 压平前先剥标题行（否则 `## 2026-09-09` 被压进 L0）
 *   ③ 判据常量与函数集中定义、可独立断言
 *
 * 断言纪律：本套件**不依赖外部文件**，全部用内联样本 —— 外部文件会随会话变动而漂移。
 */
import { extractL0Pre, buildL0IndexPre, L0_DEFAULTS } from '../../lib/l0-extract.js'

let pass = 0, fail = 0
const ok = (cond, name) => { if (cond) { pass++; console.log('  ok   ' + name) } else { fail++; console.log('  FAIL ' + name) } }
const eq = (a, b, name) => ok(a === b, name + '  (got=' + JSON.stringify(a) + ' want=' + JSON.stringify(b) + ')')

console.log('=== M2.5a · L0 质量门 ===\n')

// ── 1. 退化标题：不再被采信，而是下探到 `- ` 条目 ─────────────────────
console.log('[1] 退化标题不再产出日期型 L0')
const dateHeading = '## 2026-09-17\n- 白板线解耦边界：锚点是写入格式契约、看板是渲染形态，只该动两处。'
{
  const r = extractL0Pre(dateHeading)
  ok(r.l0 !== '2026-09-17', '纯日期标题不被采信（l0=' + JSON.stringify(r.l0) + '）')
  ok(r.l0.includes('白板线解耦边界'), '下探到 `- ` 条目首句（即真实内容）')
  eq(r.source, 'firstSentence', 'source 落到 firstSentence（不再报 heading）')
}

// ── 2. 正常标题：仍然走规则①（无回归）──────────────────────────────
console.log('\n[2] 正常标题仍走规则①（无回归）')
{
  const r = extractL0Pre('## 论文缺口分析落盘\n- 无关内容')
  eq(r.l0, '论文缺口分析落盘', '正常标题原样作摘要')
  eq(r.source, 'heading', 'source=heading')
}
{
  // 日志形态：标题带 (12:02) 后缀，应剥掉后缀后仍是标题
  const r = extractL0Pre('## 白板M层规划与M1渲染设计定案（18:00）\n- x')
  eq(r.l0, '白板M层规划与M1渲染设计定案', '日志标题剥掉 (HH:MM) 后缀')
  eq(r.source, 'heading', 'source=heading')
}

// ── 3. 规则③ 剥标题行（否则退化标题被压进正文）─────────────────────
console.log('\n[3] 规则③ 压平前剥标题行')
{
  // 只有退化标题 + 一段无列表项的正文 ⇒ 落到 truncate，但不得以标题开头
  const r = extractL0Pre('## 2026-09-09\n【用户约定 - 总体事项权威来源】进入执行阶段，必须以总体事项为唯一权威依据。')
  ok(!r.l0.startsWith('##'), 'L0 不以标题符号开头（got=' + JSON.stringify(r.l0.slice(0, 40)) + '）')
  ok(!/^2026-09-09/.test(r.l0), 'L0 不以日期标题开头')
  eq(r.source, 'truncate', 'source=truncate')
  ok(r.l0.includes('用户约定'), '正文内容被保留')
}

// ── 4. 退化形态枚举（正例/反例成对）────────────────────────────────
console.log('\n[4] 退化形态判据：正例驱逐 / 反例保留')
const degenerate = [
  '## 2026-09-17', '## 2026/9/17', '## 09-17', '## 12:02', '## 3', '## 第3节', '## v1', '## P3',
]
const legit = [
  '## 白板线解耦边界', '## M9 容量迁移事故', '## 远期调研清单', '## 三项默认值裁定',
]
for (const h of degenerate) {
  const r = extractL0Pre(h + '\n- 真内容在这里，应该被取用。')
  ok(r.l0 !== h.replace(/^##\s*/, ''), '退化标题被驱逐: ' + h)
}
for (const h of legit) {
  const r = extractL0Pre(h + '\n- 别的')
  eq(r.l0, h.replace(/^##\s*/, ''), '正常标题被保留: ' + h)
}

// ── 5. 边界：空/极短/无标题 ────────────────────────────────────────
console.log('\n[5] 边界与 fail-soft')
eq(extractL0Pre('').l0, '', '空输入 → 空 L0')
eq(extractL0Pre('   \n  ').l0, '', '纯空白 → 空 L0')
eq(extractL0Pre(null).l0, '', 'null → 空 L0（不抛）')
eq(extractL0Pre(undefined).l0, '', 'undefined → 空 L0（不抛）')
{
  const r = extractL0Pre('## 一个正常的小标题')
  eq(r.l0, '一个正常的小标题', '只有标题、无列表项 → 仍取标题')
}

// ── 6. 端到端：buildL0IndexPre 全链路（笔记形态样本）──────────────
console.log('\n[6] buildL0IndexPre 全链路：笔记形态不再产出日期型 L0')
{
  const A = '<!-- memory:mem_' + 'a'.repeat(32) + ' -->'
  const B = '<!-- memory:mem_' + 'b'.repeat(32) + ' -->'
  const C = '<!-- memory:mem_' + 'c'.repeat(32) + ' -->'
  const doc = [
    A, '## 2026-09-17', '- dsh-auto-memory 三项默认值裁定：boardMode 默认改 graph。', '',
    B, '## 2026-09-16', '- 架构契约错位事实：同步所有权语义需对齐。', '',
    C, '## 远期调研清单（Long-term research backlog）', '- 不进执行顺序。',
  ].join('\n')
  const items = buildL0IndexPre(doc, { layer: 'project' })
  eq(items.length, 3, '抽出 3 条')
  const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/
  ok(items.every((it) => !DATE_ONLY.test(it.l0.trim())),
    '★ 无任何日期型 L0（核心回归锁）')
  eq(items[0].l0.slice(0, 12), 'dsh-auto-mem', '第 1 条取到真实结论')
  ok(items[1].l0.startsWith('架构契约错位事实'), '第 2 条取到真实结论（首句含尾冒号，用 startsWith）')
  eq(items[2].l0, '远期调研清单（Long-term research backlog）', '正常标题条不受影响')
  ok(items.every((it) => it.layer === 'project'), 'layer 归属保持 project')
  ok(items.every((it) => it.status === 'current'), 'status 保持 current（M2.5a 不动 status）')
}

// ── 7. 确定性：同输入同输出 ────────────────────────────────────────
console.log('\n[7] 确定性')
{
  const doc = '## 2026-09-17\n- 同样的输入应当给出同样的输出。'
  const a = JSON.stringify(extractL0Pre(doc))
  const b = JSON.stringify(extractL0Pre(doc))
  eq(a, b, '同输入两次抽取结果一致')
}

// ── 8. 常量完整性（枚举类必须配断言 —— 本仓铁律）─────────────────
console.log('\n[8] 默认值未被误改')
eq(L0_DEFAULTS.maxChars, 160, 'maxChars=160')
eq(L0_DEFAULTS.minChars, 15, 'minChars=15')
eq(L0_DEFAULTS.hardChars, 480, 'hardChars=480')

console.log('\n=== M2.5a: PASS ' + pass + ' / FAIL ' + fail + ' ===')
if (fail > 0) process.exitCode = 1

#!/usr/bin/env node
/**
 * smoke-test-b05-truncation-direction.mjs —— 批次 0.5「截断方向修正」的行为验收。
 *
 * 实测背景（用户可见的 bug）：三个「最近的记忆」段注入的都是**最老**的内容。
 *   user-memory  → truncateHead(text,1596) → 日期 2026-09-22 单日（文件最新 2026-10-22）
 *   project-notes→ truncateHead(text,1596) → 日期 2026-10-20 单日（文件最新 2026-10-24）
 *   whiteboard-plan → truncateLinesBounded(1200) → 13 个 ## 节丢 9 个（含「★v4 待办（下一步）」）
 *   handoff-ledger  → truncateLinesBounded(800)  → 四段只覆盖前两段（「失败原因」「下一步」整段丢）
 *
 * 验收方式：真抽取产线代码（truncatePlanByPriority / part / renderMemoryDynamic）→ 真执行 → 断言输出文本。
 * 每条正向都配负路径（把修正还原 ⇒ 断言必红）。
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, '..', '..')
const IDX = readFileSync(path.join(ROOT, 'lib', 'index.js'), 'utf8')
const ANCHOR = readFileSync(path.join(ROOT, 'lib', 'handoff-anchor.js'), 'utf8').replace(/^export /gm, '')

let pass = 0, fail = 0
const ok = (c, m) => { if (c) { pass++; console.log('  PASS ' + m) } else { fail++; console.log('  FAIL ' + m) } }
const eq = (a, b, m) => ok(Object.is(a, b), m + '  (got=' + JSON.stringify(a) + ' want=' + JSON.stringify(b) + ')')

// ---- 抽取器：行扫描 + 括号配平（与本仓既有范式一致）----
function grab(name) {
  const lines = IDX.split('\n')
  // 兼容四种定义形态：const X = / const X= / function X( / var X =（本仓三处都用到了）
  const li = lines.findIndex((l) => {
    const t = l.trim()
    return t.startsWith('const ' + name + ' ') || t.startsWith('const ' + name + '=') ||
      t.startsWith('function ' + name + '(') || t.startsWith('var ' + name + ' ') ||
      t.startsWith('let ' + name + ' ')
  })
  if (li < 0) throw new Error('helper not found: ' + name)
  let buf = '', depth = 0, started = false
  for (let i = li; i < lines.length; i++) {
    buf += lines[i] + '\n'
    for (const ch of lines[i]) { if (ch === '(' || ch === '{') { depth++; started = true } else if (ch === ')' || ch === '}') depth-- }
    if (started && depth <= 0) break
  }
  return buf
}

const head = grab('truncateHead'), tail = grab('truncateTail'), bounded = grab('truncateLinesBounded')
const planPri = grab('PLAN_SECTION_PRIORITY_RE') + '\n' + grab('truncatePlanByPriority')
const code = head + '\n' + tail + '\n' + bounded + '\n' + planPri + '\n' + ANCHOR +
  '\nreturn { truncateHead, truncateTail, truncateLinesBounded, truncatePlanByPriority, weightedTrimHandoffLedgerPre }'
const H = new Function(code)()

// ---- 夹具：两个日期不同的记忆文件（时间正序，与产线一致：新内容追加在**尾部**）----
const OLD_DAY = '2026-09-22', NEW_DAY = '2026-10-24'
const pad = (s) => s.repeat(60)
const memFile =
  '# 用户级记忆\n' +
  '## ' + OLD_DAY + '\n' + '- ' + pad('最老的内容。') + '\n- OLD-MARKER-应当被切成不注入\n' +
  '## 2026-10-01\n- 中间内容\n' +
  '## ' + NEW_DAY + '\n- ' + pad('最新的内容。') + '\n- NEW-MARKER-必须出现在注入窗口内\n'

console.log('[B05] 1. 方向对比：head 取最老 / tail 取最新（真执行）')
const hCut = H.truncateHead(memFile, 400)
const tCut = H.truncateTail(memFile, 400)
ok(!hCut.includes('NEW-MARKER'), 'head 截断拿不到最新标记（复现旧 bug）')
ok(tCut.includes('NEW-MARKER'), 'tail 截断拿到最新标记')
ok(tCut.includes('2026-10-24'), 'tail 窗口内日期 = 最新日期')
ok(!tCut.includes('OLD-MARKER'), 'tail 窗口内不含最老标记')

console.log('[B05] 2. PLAN 按节优先级：高优先节必须活下来')
const plan = [
  '# 项目全貌',
  '## 背景', Array.from({ length: 40 }, (_, i) => '- 背景条目 ' + i + '：' + pad('填充')).join('\n'),
  '## 历史沿革', Array.from({ length: 40 }, (_, i) => '- 沿革条目 ' + i + '：' + pad('填充')).join('\n'),
  '## ★v4 待办（下一步）', '- TODO-KEEP-1 先做契约冻结', '- TODO-KEEP-2 再做数据层',
  '## 硬约束', '- 禁止整块替换',
].join('\n')
const planCut = H.truncatePlanByPriority(plan, 900)
ok(planCut !== null, 'truncatePlanByPriority 正常返回（不是 fail-closed）')
ok(planCut.includes('TODO-KEEP-1') && planCut.includes('TODO-KEEP-2'), '★「下一步」节的待办条目在窗口内')
ok(planCut.includes('## 硬约束'), '硬约束节标题保留')
ok(planCut.length <= 900, '结果不超预算（实测 ' + planCut.length + '）')
// 负路径：旧实现（位置截断）必然丢掉「下一步」
const oldPlan = H.truncateLinesBounded(plan, 900)
ok(!oldPlan.includes('TODO-KEEP-1'), '负路径：旧位置截断确实丢掉待办（证明修的是真问题）')

console.log('[B05] 3. 账本加权截断：四段标题全覆盖')
const ledger = [
  '# 交接账本 · 2026-10-24 15:00',
  '## 任务状态', '- 状态条目 ' + pad('填充').repeat(3),
  '## 目标', '- 目标条目 ' + pad('填充').repeat(3),
  '## 已试方案与失败原因', '- DEADEND-KEEP 方案A失败:' + pad('填充').repeat(3),
  '## 进度与下一步', '- NEXT-KEEP 下一步做契约冻结' + pad('填充').repeat(3),
].join('\n')
const ledgerCut = H.weightedTrimHandoffLedgerPre(ledger, 500)
ok(ledgerCut !== null, 'weightedTrimHandoffLedgerPre 正常返回')
for (const sec of ['任务状态', '目标', '已试方案与失败原因', '进度与下一步']) {
  ok(ledgerCut.includes('## ' + sec), '四段标题保留：' + sec)
}
// 负路径：旧位置截断丢掉后两段
const oldLedger = H.truncateLinesBounded(ledger, 500)
ok(!oldLedger.includes('## 进度与下一步'), '负路径：旧位置截断确实丢掉「进度与下一步」（证明修的是真问题）')

console.log('[B05] 4. fail-closed：无 ## 节时回落，不崩不改变旧行为')
eq(H.truncatePlanByPriority('没有小标题的纯文本行', 100), null, '无节 ⇒ 返回 null（调用方回落）')
eq(H.truncatePlanByPriority('', 100), null, '空串 ⇒ 返回 null')
eq(H.truncatePlanByPriority('## 只有标题', 0), null, '预算非法 ⇒ 返回 null')
ok(typeof H.truncatePlanByPriority(plan, 999999) === 'string', '预算充足 ⇒ 返回全文（不做无谓截断）')

console.log('[B05] 5. 接线守卫（非功能证据，已明确标注）')
// ⚠️ 本节的断言对象是「源码里是否存在某调用形态」⇒ 按 CR-10 属**守卫**，不构成功能验收。
//   功能证据在 §1–§4：那四节真执行的是**产线函数本体**（truncateTail / truncatePlanByPriority /
//   weightedTrimHandoffLedgerPre），断言的是它们的**返回值**。
//   `renderMemoryDynamic` 的端到端真执行由 smoke-test-handoff.mjs G4 承担（它已把新增的两个
//   模块级依赖 truncateTail / truncatePlanByPriority 与 handoff-anchor 注入沙箱，并真跑真断言）。
ok(IDX.indexOf('renderMemoryDynamic(context) {') > 0, '守卫：renderMemoryDynamic 定义已定位')
ok(/'user-memory'[^\n]*'must', 'tail'\)/.test(IDX), '守卫：user-memory 调用点传了 tail')
ok(/'project-notes'[^\n]*'must', 'tail'\)/.test(IDX), '守卫：project-notes 调用点传了 tail')
ok(/truncatePlanByPriority\(_planRaw, _planBudget\)/.test(IDX), '守卫：PLAN 段调用 truncatePlanByPriority')
ok(/weightedTrimHandoffLedgerPre\(_ledgerRaw, _ledgerBudget\)/.test(IDX), '守卫：账本段调用 weightedTrimHandoffLedgerPre')
ok(!/truncateLinesBounded\(stripSensitiveSections\(sanitizeForInjection\(s\.planText/.test(IDX), '守卫：旧的 PLAN 位置截断调用已消失（不是两套并存）')
ok(!/truncateLinesBounded\(stripSensitiveSections\(sanitizeForInjection\(s\.latestHandoffText/.test(IDX), '守卫：旧的账本位置截断调用已消失')

console.log('')
console.log('[B05] ' + pass + ' PASS / ' + fail + ' FAIL')
process.exit(fail ? 1 : 0)

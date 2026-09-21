#!/usr/bin/env node
/**
 * smoke-test-r5-lesson-candidate-pre.mjs —— ④ 教训 → 观察型候选（2026-09-19 R5）
 *
 * **用户裁定（2026-09-18 00:20 原话）**：
 *   「**教训肯定得进 C 啊，它不自动晋升，但是可以形成候选，模型也可以通过搜索搜索到**。
 *    因为教训那边，我现在**自动注入的硬约束也是某种教训，把它上升到了约束层面**。」
 *
 * 本套件锁定三件事（缺一即与裁定冲突）：
 *   L1 **可形成候选** —— retracted 条目能产出 procedure candidate
 *   L2 **永不自动晋升** —— 必须是 observationOnly，且 `promote()` 真短路
 *   L3 **可被搜索到** —— `query()` 能命中（不是写进去就查不到）
 * 外加反向锁：不得凭空造 provenance、不得漏清洗（H-3 同款）、不得误收非法输入。
 */
import { createMemoryHubPre, lessonCandidateFromRetractedPre } from '../../lib/memory-hub-pre.js'
import { isObservationOnlyPre } from '../../lib/procedure-observation-pre.js'
import { createProcedureStorePre } from '../../lib/procedure-store-pre.js'
import { createEpisodicStorePre } from '../../lib/episodic-store-pre.js'
import { createFactStorePre } from '../../lib/fact-store-pre.js'

/** 夹具：hub 的 store 必须经 `_stores` 注入（否则默认 null）。 */
const makeHub = (nowVal) => createMemoryHubPre({
  now: () => nowVal,
  _stores: { createProcedureStorePre, createEpisodicStorePre, createFactStorePre },
})

let pass = 0, fail = 0
const ok = (c, n, x) => {
  if (c) { pass++; console.log('  ok -', n) }
  else { fail++; console.error('  FAIL -', n, x == null ? '' : x) }
}

const MID = 'mem_' + 'a'.repeat(32)
const MID2 = 'mem_' + 'b'.repeat(32)

console.log('\n[L1] ★ 可形成候选 —— retracted 条目能产出 candidate')
{
  const c = lessonCandidateFromRetractedPre({
    memoryId: MID, title: '配置项 X 不能设成 true', reason: '会导致写入被拒',
  })
  ok(c !== null, '★ 合法输入产出 candidate')
  ok(c.title.startsWith('教训：'), '★ title 带「教训：」前缀（审批面一眼可辨）', c.title)
  ok(typeof c.riskLevel === 'string', 'riskLevel 合法')
  ok(Array.isArray(c.steps) && c.steps.length > 0, '有 steps')
}

console.log('\n[L2] ★★ 永不自动晋升 —— 结构保证为 observationOnly')
{
  const c = lessonCandidateFromRetractedPre({ memoryId: MID, title: 'X 不能这样写', reason: '会崩' })
  ok(c.observationOnly === true, '★★ candidate 自带 observationOnly:true（唯一结构保证）')
  ok(isObservationOnlyPre(c) === true, '★★ isObservationOnlyPre 判据确认（store 侧同一判据）')

  // ★★ 端到端：走真实 store，主张晋升也必须被短路
  const hub = makeHub(1000)
  const r = hub.stores.procedures.observe(c)
  ok(r.ok === true, 'observe 成功', JSON.stringify(r))
  const pid = r.procedure && r.procedure.procedureId ? r.procedure.procedureId : (r.procedureId || null)
  ok(!!pid, '拿到 procedureId', JSON.stringify(r).slice(0, 200))
  if (pid) {
    // 证据拉满（远超 minSessions=3 / minSuccess=2）
    const pr = hub.stores.procedures.promote(pid, { distinctSessions: 99, successCount: 99 })
    ok(pr.decision === 'keep', '★★ 证据拉满仍是 keep（永不自动晋升）', JSON.stringify(pr.decision))
    ok(Array.isArray(pr.reasonCodes) && pr.reasonCodes.includes('observation-only'),
      '★★ 原因码是 observation-only（可区分于其他 keep）', JSON.stringify(pr.reasonCodes))
  }
}

console.log('\n[L3] ★ 可被搜索到 —— query 能命中（否则等于没进）')
{
  const hub = makeHub(2000)
  const c = lessonCandidateFromRetractedPre({ memoryId: MID, title: '独特标记词 ZEBRA9', reason: 'r' })
  hub.stores.procedures.observe(c)
  const all = hub.stores.procedures.query()
  ok(all.some(p => p.title.includes('ZEBRA9')), '★ query() 能检索到该教训候选')
  ok(all.some(p => p.stage === 'observed'), '★ 落在 observed 阶段（进审批队列）')
}

console.log('\n[L4] ★★ 反向锁 1：provenance 必须是真实 memoryId（不得留空、不得凭空造）')
{
  const c = lessonCandidateFromRetractedPre({ memoryId: MID, title: 'x' })
  ok(Array.isArray(c.sourceMemoryIds) && c.sourceMemoryIds.length === 1, '★ sourceMemoryIds 非空')
  ok(c.sourceMemoryIds[0] === MID, '★ 携带被撤回条目的真实 id')
  // 与 crossFeed 的「有意留空」区分开：那条通路的语义是"episode 只提供线索"
  ok(!(c.sourceMemoryIds.length === 0), '★ 不得照抄 episode 通路的空数组写法')
}

console.log('\n[L5] ★★ 反向锁 2：非法输入一律拒绝（fail-closed，不造脏数据）')
{
  const BAD = [
    ['缺 memoryId', { title: 'x' }],
    ['memoryId 形态非法（非 mem_32hex）', { memoryId: 'mem_short', title: 'x' }],
    ['memoryId 是大写/长度错', { memoryId: 'MEM_' + 'A'.repeat(32), title: 'x' }],
    ['empty title', { memoryId: MID, title: '' }],
    ['只有信封没有正文', { memoryId: MID, title: 'Current runtime context. x' }],
    ['null', null],
    ['字符串', 'not-an-object'],
  ]
  for (const [name, row] of BAD) {
    ok(lessonCandidateFromRetractedPre(row) === null, '拒绝：' + name)
  }
}

console.log('\n[L6] ★★ 反向锁 3：信封必须先清洗（H-3 同款 —— 否则教训标题又被信封污染）')
{
  const c = lessonCandidateFromRetractedPre({
    memoryId: MID,
    title: 'Approval prompts are disabled in this se\n真实教训：不要用裸 join()',
    reason: 'Current DSH file policy: x',
  })
  ok(c !== null, '混合输入仍产出 candidate（清洗后还有真人内容）')
  ok(!/Approval prompts/.test(c.title), '★ title 里的信封被清掉', c.title)
  ok(c.title.includes('裸 join'), '★ 真人教训保留', c.title)
  const stepText = c.steps.join(' ')
  ok(!/Current DSH file policy/.test(stepText), '★ reason 里的信封被清掉', stepText)
}

console.log('\n[L7] 确定性 / 幂等 / 不修改入参')
{
  const row = { memoryId: MID, title: 't', reason: 'r' }
  const snapshot = JSON.stringify(row)
  const a = lessonCandidateFromRetractedPre(row)
  const b = lessonCandidateFromRetractedPre(row)
  ok(JSON.stringify(a) === JSON.stringify(b), '同输入同输出')
  ok(JSON.stringify(row) === snapshot, '不修改入参')
}

console.log('\n[L8] ★ 多条教训候选互不污染（指纹含 title ⇒ 不同教训是不同条目）')
{
  const hub = makeHub(3000)
  hub.stores.procedures.observe(lessonCandidateFromRetractedPre({ memoryId: MID, title: '教训一' }))
  hub.stores.procedures.observe(lessonCandidateFromRetractedPre({ memoryId: MID2, title: '教训二' }))
  const all = hub.stores.procedures.query()
  ok(all.length === 2, '★ 两条不同教训各占一条（未被 title 去重合并）', '实际 ' + all.length)
  const uniq = new Set(all.map(p => p.procedureId))
  ok(uniq.size === 2, '★ procedureId 互异')
}

console.log(`\n[R5-lesson-candidate] ${pass} passed, ${fail} failed`)
if (fail) process.exit(1)

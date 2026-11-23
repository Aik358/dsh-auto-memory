/**
 * smoke-test-v5-p6-event-regroup.mjs
 *
 * ★R1 验收（2026-10-27）：`lib/event-regroup.js` 纯函数层。
 *
 * 验收纪律（CR-10）：
 *   ① 真 import → 真调用 → 断言**返回值**
 *   ② 每条都有**负路径**（构造函数能返回 false 的输入）
 *   ③ 断言对象是物理量/行为，不是「源码含某字符串」
 *   ④ 覆盖用户裁定 Q1（机械只作建议）/ Q9（事件名五条闸门）/ 守恒
 */

import {
  REGROUP_PROPOSAL_SCHEMA,
  SUGGEST_CONFIDENCE,
  validateEventNamePre,
  suggestEventNamePre,
  suggestGroupsPre,
  validateRegroupConservationPre,
  buildProposalPre,
} from '../../lib/event-regroup.js'

let pass = 0, fail = 0
function ok(cond, name, extra) {
  if (cond) { pass++; console.log('  ok   - ' + name + (extra ? ' :: ' + extra : '')) }
  else { fail++; console.log('  FAIL - ' + name + (extra ? ' :: ' + extra : '')) }
}

console.log('== A. 事件名质量闸门（用户裁定 Q9：4–60 字 + 五条判据）==')
{
  // ① 合法
  const good = ['v4 底层改造', '修复上下文页卡死', '注入截流方案 P3', '事件写路径串行化']
  let okCount = 0
  for (const n of good) if (validateEventNamePre(n).ok) okCount++
  ok(okCount === good.length, 'A-1 四个正常中文名全部通过', okCount + '/' + good.length)

  // ② HTML 注释（旧版实测的垃圾来源）
  const c1 = validateEventNamePre('<!--type=goal-->验证四类感知')
  ok(!c1.ok && c1.code === 'html-comment', 'A-2 ★含 HTML 注释被拒（旧版垃圾事件名）', c1.code)
  const c2 = validateEventNamePre('正常名字 <!-- memory:mem_x -->')
  ok(!c2.ok, 'A-3 ★含任意 HTML 注释标记被拒', c2.code)

  // ③ markdown 前缀
  for (const n of ['- 三项需求', '# 标题式名字', '* 星号开头', '> 引用式']) {
    const r = validateEventNamePre(n)
    ok(!r.ok && r.code === 'markdown-prefix', 'A-4 markdown 前缀被拒: ' + JSON.stringify(n.slice(0, 10)), r.code)
  }

  // ④ 长度
  const short = validateEventNamePre('短')
  ok(!short.ok && short.code === 'too-short', 'A-5 少于 4 字被拒', short.code)
  const long = validateEventNamePre('这'.repeat(61))
  ok(!long.ok && long.code === 'too-long', 'A-6 超过 60 字被拒', long.code)
  ok(validateEventNamePre('四字名字').ok, 'A-7 恰好 4 字通过')
  ok(validateEventNamePre('六'.repeat(60)).ok, 'A-8 恰好 60 字通过')

  // ⑤ 占位名
  for (const n of ['未命名工作', 'untitled', '(未识别目标)', 'TODO 这件事']) {
    const r = validateEventNamePre(n)
    ok(!r.ok, 'A-9 占位名被拒: ' + n, r.code)
  }

  // ⑥ 空 / 纯标点
  ok(!validateEventNamePre('').ok, 'A-10 空名被拒')
  ok(!validateEventNamePre(null).ok, 'A-11 null 被拒')
  ok(!validateEventNamePre('---').ok, 'A-12 纯标点被拒')
  ok(!validateEventNamePre('12345').ok, 'A-13 纯数字被拒')
}

console.log('')
console.log('== B. 候选事件名提取（必须剥注释 + 过闸门）==')
{
  // 旧版实测踩坑的原文形态
  const bad = suggestEventNamePre({
    name: 'handoff-20261010-185158.md',
    text: '## 目标\n<!--type=goal-->验证四类感知（userpercept）\n\n## 任务状态\n- x',
  })
  ok(bad.name.indexOf('<!--') < 0, 'B-1 ★提取结果不含 HTML 注释（旧版直接取首行 ⇒ 带注释）', JSON.stringify(bad.name))
  ok(bad.name.indexOf('type=goal') < 0, 'B-2 不含 type=goal 残留', JSON.stringify(bad.name))

  const good = suggestEventNamePre({
    name: 'handoff-a.md',
    text: '## 目标\n修复上下文页卡死问题\n\n## 任务状态\n- x',
  })
  ok(good.name === '修复上下文页卡死问题', 'B-3 正常目标段首行被采用', JSON.stringify(good.name))
  ok(good.needsAiNaming === false, 'B-4 合格时不需要 AI 重命名')

  const noGoal = suggestEventNamePre({ name: 'handoff-20261010-120000.md', text: '' })
  ok(noGoal.needsAiNaming === true, 'B-5 ★无内容时标记 needsAiNaming（强制 AI 命名）', JSON.stringify(noGoal.name))

  const mdLine = suggestEventNamePre({
    name: 'handoff-b.md',
    text: '## 目标\n- **当前首要**让用户看到白板\n',
  })
  ok(mdLine.name.indexOf('-') !== 0 && mdLine.name.indexOf('**') < 0, 'B-6 markdown 标记被剥掉', JSON.stringify(mdLine.name))
}

console.log('')
console.log('== C. 机械分组只作「建议」（用户裁定 Q1）==')
{
  const mk = (name, goal, mtime) => ({ name, mtime, text: '## 目标\n' + goal + '\n\n## 任务状态\n- x' })

  // 同目标 ⇒ 建议同组
  const same = [
    mk('a.md', '修复上下文页卡死', 1000),
    mk('b.md', '修复上下文页卡死', 2000),
    mk('c.md', '完全不同的目标', 3000),
  ]
  const r1 = suggestGroupsPre(same)
  ok(r1.suggestions.length >= 1, 'C-1 同目标被建议成一组', r1.suggestions.length + ' 组')
  const g0 = r1.suggestions[0]
  ok(Array.isArray(g0.members) && g0.members.length === 2, 'C-2 组内 2 个成员', g0 && g0.members && g0.members.join(','))
  ok(!!g0.confidence && Object.values(SUGGEST_CONFIDENCE).indexOf(g0.confidence) >= 0, 'C-3 ★每组都带 confidence（可被 AI 推翻）', g0.confidence)
  ok(!!g0.rationale && g0.rationale.length > 0, 'C-4 ★每组都带 rationale（说明依据，便于 AI 复核）', g0.rationale.slice(0, 30))
  ok(r1.ungrouped.indexOf('c.md') >= 0, 'C-5 不同目标的账本不被硬塞进组', r1.ungrouped.join(','))
  ok(r1.method === 'deterministic-suggest-only', 'C-6 ★method 明确标注「仅建议」', r1.method)

  // 单条不分组
  const single = [mk('x.md', '独立目标', 1000)]
  const r2 = suggestGroupsPre(single)
  ok(r2.suggestions.length === 0, 'C-7 单条账本不产生分组建议', r2.suggestions.length + ' 组')
  ok(r2.ungrouped.length === 1, 'C-8 单条进 ungrouped', r2.ungrouped.join(','))

  // 时间窗外的 2-gram 不合并
  const farApart = [mk('p.md', '目标甲甲乙乙', 0), mk('q.md', '目标甲甲丙丙', 100 * 3600 * 1000)]
  const r3 = suggestGroupsPre(farApart)
  ok(r3.suggestions.length === 0, 'C-9 时间差超窗 ⇒ 即使 2-gram 重合也不合并', r3.suggestions.length + ' 组')

  // 空输入
  ok(suggestGroupsPre([]).suggestions.length === 0, 'C-10 空输入不炸')
  ok(suggestGroupsPre(null).suggestions.length === 0, 'C-11 null 输入不炸')
}

console.log('')
console.log('== D. 守恒校验（不重不漏不多）==')
{
  const all = ['a.md', 'b.md', 'c.md']
  const okCase = validateRegroupConservationPre(all, [{ members: ['a.md', 'b.md'] }, { members: ['c.md'] }])
  ok(okCase.ok === true, 'D-1 完整覆盖且不重 ⇒ 通过', JSON.stringify(okCase))

  const missCase = validateRegroupConservationPre(all, [{ members: ['a.md'] }])
  ok(missCase.ok === false && missCase.missing.length === 2, 'D-2 ★漏掉账本 ⇒ 红（会静默丢账本）', missCase.missing.join(','))

  const dupCase = validateRegroupConservationPre(all, [{ members: ['a.md', 'a.md'] }, { members: ['b.md', 'c.md'] }])
  ok(dupCase.ok === false && dupCase.duplicated.indexOf('a.md') >= 0, 'D-3 ★重复成员 ⇒ 红（会重复归档）', dupCase.duplicated.join(','))

  const unknownCase = validateRegroupConservationPre(all, [{ members: ['a.md', 'b.md', 'c.md', 'ghost.md'] }])
  ok(unknownCase.ok === false && unknownCase.unknown.indexOf('ghost.md') >= 0, 'D-4 ★未知成员 ⇒ 红', unknownCase.unknown.join(','))

  ok(validateRegroupConservationPre([], []).ok === true, 'D-5 空对空 ⇒ 通过')
}

console.log('')
console.log('== E. 提案构造（必须标 requiresHumanApproval）==')
{
  const p = buildProposalPre({
    workspace: 'D:/dsh-auto-memory',
    events: [{ id: 'evt_1', name: '已有事件', status: 'active' }],
    groups: [{ members: ['a.md', 'b.md'] }, { members: ['c.md'] }],
    generatedAt: 1700000000000,
  })
  ok(p.schema === REGROUP_PROPOSAL_SCHEMA, 'E-1 schema 正确', p.schema)
  ok(p.requiresHumanApproval === true, 'E-2 ★★必须标 requiresHumanApproval（提案不得直接落盘）')
  ok(p.stats.existingEventCount === 1, 'E-3 统计已有事件数', p.stats.existingEventCount)
  ok(p.stats.proposedGroupCount === 2, 'E-4 统计提案组数', p.stats.proposedGroupCount)
  ok(p.stats.totalMembers === 3, 'E-5 统计成员总数', p.stats.totalMembers)
  ok(Array.isArray(p.existingEvents) && p.existingEvents[0].id === 'evt_1', 'E-6 已有事件被投影（供 AI 做合并判断）')
  ok(buildProposalPre({}).requiresHumanApproval === true, 'E-7 空入参也必须标 requiresHumanApproval')
}

console.log('')
console.log('SUMMARY  PASS ' + pass + ' / FAIL ' + fail)
process.exit(fail === 0 ? 0 : 1)

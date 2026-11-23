/**
 * smoke-test-v5-p6-r3-regroup-propose.mjs
 *
 * ★R3 验收（2026-10-27）：event-regroup-propose.js —— AI 输出解析 + 提案构造。
 *
 * 【本套件的核心价值】**
 *   这一层是**最容易被 AI 幻觉污染**的地方。AI 会：
 *     · 忘了只输出 JSON（包 markdown / 加解释）
 *     · 给事件起垃圾名（带 HTML 注释 / 占位名）
 *     · **漏掉某篇账本**（最危险：会静默丢数据）
 *     · **把同一篇分到两个事件**（会重复归档）
 *     · **编造不存在的账本名**
 *   ⇒ 每条都必须有对应断言，且必须**真调用**验证拒绝行为。
 */
import {
  NAME_MAX,
  SUMMARY_MAX,
  SECTION_MAX,
  extractJsonPre,
  validateAiEventPre,
  parseAiBatchPre,
  mergeBatchesPre,
} from '../../lib/event-regroup-propose.js'

let pass = 0, fail = 0
function ok(cond, name, extra) {
  if (cond) { pass++; console.log('  ok   - ' + name + (extra ? ' :: ' + extra : '')) }
  else { fail++; console.log('  FAIL - ' + name + (extra ? ' :: ' + extra : '')) }
}

console.log('== A. extractJsonPre（容忍包装，但不容忍坏 JSON）==')
{
  const direct = extractJsonPre('{"events":[]}')
  ok(direct.ok === true && Array.isArray(direct.value.events), 'A-1 纯 JSON 直接解析')

  const fenced = extractJsonPre('好的，结果如下：\n```json\n{"events":[{"name":"x"}]}\n```\n以上。')
  ok(fenced.ok === true && fenced.value.events.length === 1, 'A-2 ★剥 markdown 代码块（AI 常见行为）')

  const loose = extractJsonPre('说明文字 {"events":[]} 结尾文字')
  ok(loose.ok === true, 'A-3 ★从废话里截取 JSON')

  const bad = extractJsonPre('{ this is not json }')
  ok(bad.ok === false, 'A-4 坏 JSON 被拒', bad.error && bad.error.slice(0, 20))

  const empty = extractJsonPre('')
  ok(empty.ok === false, 'A-5 空输入被拒', empty.error)

  const noJson = extractJsonPre('只有文字没有 JSON')
  ok(noJson.ok === false, 'A-6 无 JSON 被拒', noJson.error)

  ok(extractJsonPre(null).ok === false, 'A-7 null 被拒')
}

console.log('')
console.log('== B. validateAiEventPre（单条事件严格校验）==')
{
  const allowed = new Set(['a.md', 'b.md'])

  const good = validateAiEventPre({
    name: '修复上下文页卡死',
    summary: '定位到 500ms 轮询无条件 setState，改为值变才更新',
    members: ['a.md', 'b.md'],
    sections: { goal: '修卡死', doing: '改轮询', deadend: '', next: '观察' },
  }, allowed)
  ok(good.ok === true, 'B-1 合格事件通过', good.ok ? good.event.name : good.error)
  ok(good.ok && good.event.origin === 'regroup-ai', 'B-2 带 origin 标记（区分 AI 重整）')
  ok(good.ok && good.event.members.length === 2, 'B-3 members 保留')

  // 负路径：垃圾事件名（AI 最容易犯的错）
  const badName = validateAiEventPre({ name: '<!--type=goal-->验证', members: ['a.md'] }, allowed)
  ok(badName.ok === false && badName.code.indexOf('bad-name') === 0, 'B-4 ★★HTML 注释名被拒（AI 幻觉）', badName.code)

  const shortName = validateAiEventPre({ name: '短', members: ['a.md'] }, allowed)
  ok(shortName.ok === false && shortName.code === 'bad-name:too-short', 'B-5 名字过短被拒', shortName.code)

  const placeholder = validateAiEventPre({ name: '未命名工作', members: ['a.md'] }, allowed)
  ok(placeholder.ok === false, 'B-6 占位名被拒', placeholder.code)

  // 负路径：members 为空
  const noMem = validateAiEventPre({ name: '正常名字啊', members: [] }, allowed)
  ok(noMem.ok === false && noMem.code === 'no-members', 'B-7 ★members 为空被拒（事件必须有账本）', noMem.code)

  // 负路径：★编造不存在的账本
  const ghost = validateAiEventPre({ name: '正常名字啊', members: ['a.md', 'ghost.md'] }, allowed)
  ok(ghost.ok === false && ghost.code === 'member-outside-batch', 'B-8 ★★编造账本名被拒（AI 幻觉核心防线）', ghost.code)

  // 负路径：summary 超长
  const longSum = validateAiEventPre({ name: '正常名字啊', members: ['a.md'], summary: 'x'.repeat(SUMMARY_MAX + 1) }, allowed)
  ok(longSum.ok === false && longSum.code === 'summary-too-long', 'B-9 summary 超长被拒', longSum.code)

  // sections 夹断（不报错，但必须截到上限）
  const longSec = validateAiEventPre({ name: '正常名字啊', members: ['a.md'], sections: { goal: 'g'.repeat(SECTION_MAX + 500) } }, allowed)
  ok(longSec.ok === true && longSec.event.sections.goal.length === SECTION_MAX, 'B-10 ★超长 section 被夹断到上限（不整条拒绝）', longSec.ok ? longSec.event.sections.goal.length : '')

  ok(validateAiEventPre(null, allowed).ok === false, 'B-11 null 被拒')
  ok(validateAiEventPre('not object', allowed).ok === false, 'B-12 非对象被拒')
}

console.log('')
console.log('== C. parseAiBatchPre（整批解析 + 守恒 = 核心防线）==')
{
  const names = ['a.md', 'b.md', 'c.md']
  const okJson = JSON.stringify({
    events: [
      { name: '第一件事', summary: 's1', members: ['a.md', 'b.md'], sections: { goal: 'g1' } },
      { name: '第二件事', summary: 's2', members: ['c.md'], sections: { goal: 'g2' } },
    ],
  })
  const r1 = parseAiBatchPre(okJson, names)
  ok(r1.ok === true, 'C-1 合格批次通过', r1.ok ? r1.events.length + ' 个事件' : r1.error)
  ok(r1.ok && r1.conservation.ok === true, 'C-2 守恒通过')

  // ★★核心负路径 1：AI 漏掉一篇账本（会静默丢数据）
  const missingJson = JSON.stringify({
    events: [{ name: '第一件事', summary: 's', members: ['a.md', 'b.md'], sections: {} }],
  })
  const r2 = parseAiBatchPre(missingJson, names)
  ok(r2.ok === false && r2.code === 'conservation-failed', 'C-3 ★★★AI 漏账本 ⇒ 整批拒绝（防静默丢数据）', r2.code)
  ok(r2.conservation && r2.conservation.missing.indexOf('c.md') >= 0, 'C-4 能指出漏了哪篇', r2.conservation && r2.conservation.missing.join(','))

  // ★★核心负路径 2：AI 把同一篇分到两个事件（会重复归档）
  const dupJson = JSON.stringify({
    events: [
      { name: '第一件事', summary: 's', members: ['a.md', 'b.md'], sections: {} },
      { name: '第二件事', summary: 's', members: ['b.md', 'c.md'], sections: {} },
    ],
  })
  const r3 = parseAiBatchPre(dupJson, names)
  ok(r3.ok === false && r3.code === 'conservation-failed', 'C-5 ★★★同一篇分到两个事件 ⇒ 整批拒绝（防重复归档）', r3.code)
  ok(r3.conservation && r3.conservation.duplicated.indexOf('b.md') >= 0, 'C-6 能指出重复的是哪篇', r3.conservation && r3.conservation.duplicated.join(','))

  // 负路径：无 events 字段
  const r4 = parseAiBatchPre('{"foo":1}', names)
  ok(r4.ok === false && r4.code === 'no-events-field', 'C-7 缺 events 字段被拒', r4.code)

  // 负路径：空 events（本批有账本却返回空）
  const r5 = parseAiBatchPre('{"events":[]}', names)
  ok(r5.ok === false && r5.code === 'empty-events', 'C-8 ★本批非空却返回空 events ⇒ 拒绝', r5.code)

  // 负路径：坏 JSON
  const r6 = parseAiBatchPre('完全不是 JSON', names)
  ok(r6.ok === false && r6.code === 'extract-failed', 'C-9 坏输出被拒', r6.code)

  // 负路径：某条事件名不合格 ⇒ 整批拒绝
  const badOne = JSON.stringify({
    events: [
      { name: '合格的名字', summary: 's', members: ['a.md', 'b.md'], sections: {} },
      { name: '<!--x-->垃圾', summary: 's', members: ['c.md'], sections: {} },
    ],
  })
  const r7 = parseAiBatchPre(badOne, names)
  ok(r7.ok === false && r7.code.indexOf('event-invalid') === 0, 'C-10 ★任一条不合格 ⇒ 整批拒绝（fail-closed）', r7.code)
  ok(r7.error && r7.error.indexOf('第 2 条') >= 0, 'C-11 错误信息指出是第几条', r7.error && r7.error.slice(0, 40))
}

console.log('')
console.log('== D. mergeBatchesPre（多批合并 + 跨批重复检测）==')
{
  const batches = [
    { workspaceId: 'ws1', events: [{ name: '事件甲', summary: 's', members: ['a.md', 'b.md'], sections: {} }] },
    { workspaceId: 'ws2', events: [{ name: '事件乙', summary: 's', members: ['c.md'], sections: {} }] },
  ]
  const r = mergeBatchesPre(batches, { workspace: 'test', existingEvents: [{ id: 'evt_1', name: '旧事件', status: 'active' }], generatedAt: 123 })
  ok(r.ok === true, 'D-1 两批合并成功', r.ok ? r.proposal.proposedGroups.length + ' 组' : r.error)
  ok(r.proposal.batchCount === 2, 'D-2 batchCount 正确', r.proposal.batchCount)
  ok(r.proposal.memberTotal === 3, 'D-3 memberTotal 守恒（3）', r.proposal.memberTotal)
  ok(Math.abs(r.proposal.avgEventSize - 1.5) < 0.01, 'D-4 avgEventSize 正确（1.5）', r.proposal.avgEventSize)
  ok(r.proposal.requiresHumanApproval === true, 'D-5 ★仍需人审')
  ok(r.proposal.existingEvents.length === 1, 'D-6 已有事件被带入', r.proposal.existingEvents.length)
  ok(r.proposal.proposedGroups[0].members[0] === 'ws1/a.md', 'D-7 ★members 带 workspaceId 前缀（防跨工作区同名冲突）', r.proposal.proposedGroups[0].members[0])

  // ★负路径：跨批重复
  const dupBatches = [
    { workspaceId: 'ws1', events: [{ name: '事件甲', summary: 's', members: ['a.md'], sections: {} }] },
    { workspaceId: 'ws1', events: [{ name: '事件乙', summary: 's', members: ['a.md'], sections: {} }] },
  ]
  const r2 = mergeBatchesPre(dupBatches, {})
  ok(r2.ok === false, 'D-8 ★★跨批同一账本出现两次 ⇒ 拒绝', r2.error && r2.error.slice(0, 30))

  const r3 = mergeBatchesPre([], {})
  ok(r3.ok === true && r3.proposal.proposedGroups.length === 0, 'D-9 空批次 ⇒ 空提案（不炸）')
  ok(mergeBatchesPre(null, {}).ok === true, 'D-10 null 输入不炸')
}

console.log('')
console.log('== E. 常量 ==')
{
  ok(NAME_MAX === 60, 'E-1 事件名上限 60（用户裁定 Q9）', NAME_MAX)
  ok(SUMMARY_MAX === 400, 'E-2 summary 上限 400', SUMMARY_MAX)
  ok(SECTION_MAX === 2000, 'E-3 四段单项上限 2000', SECTION_MAX)
}

console.log('')
console.log('SUMMARY  PASS ' + pass + ' / FAIL ' + fail)
process.exit(fail === 0 ? 0 : 1)
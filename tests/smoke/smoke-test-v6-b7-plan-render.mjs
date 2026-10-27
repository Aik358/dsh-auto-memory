/** smoke-test-v6-b7-plan-render.mjs —— B7 由事件渲染新版白板验收 */
import { renderPlanFromEventsPre, planSectionsFromEventsPre, estimatePlanCharsPre, PLAN_SECTION_CHAR_MAX } from '../../lib/plan-render.js'

let pass = 0, fail = 0
const ok = (c, n, e) => { if (c) { pass++; console.log('  ok   - ' + n + (e ? ' :: ' + e : '')) } else { fail++; console.log('  FAIL - ' + n + (e ? ' :: ' + e : '')) } }

console.log('=== A. 真渲染 3 个事件 ===')
const T = (s) => Date.parse(s + 'T08:00:00Z')
const events = [
  {
    id: 'evt_00000001', name: 'v4 底层改造', summary: '把记忆单元从流水账迁到事件。', status: 'closed',
    startMs: T('2026-10-20'), endMs: T('2026-10-24'), ordinal: 1,
    sections: { goal: '完成事件化改造', doing: '六段判据全打通', deadend: 'P2 镜像白名单漏了一个字段', next: '' },
    constraints: ['每次变动都要重写四段', '禁止整文件 write'],
    members: ['handoff/a.md', 'handoff/b.md'], rationale: '同一目标的不同阶段',
    kind: 'ledger', confidence: 'high', outcomes: [], skills: {}, createdAt: T('2026-10-20'), updatedAt: T('2026-10-24'),
  },
  {
    id: 'evt_00000002', name: 'v6 白板改造', summary: '白板改为产出物。', status: 'active',
    startMs: T('2026-10-26'), endMs: T('2026-10-27'), ordinal: 2,
    sections: { goal: '对齐 prototype 数据模型', doing: 'B1/B2/B3/B4/B6 完成', deadend: 'subagent 空转 20 分钟', next: '实跑验证 B8' },
    constraints: ['禁止整文件 write'],
    members: ['handoff/c.md'], rationale: '同一次改造',
    kind: 'ledger', confidence: 'high', outcomes: [], skills: {}, createdAt: T('2026-10-26'), updatedAt: T('2026-10-27'),
  },
  {
    id: 'evt_00000003', name: '早期工作（无时间）', summary: 'startMs=0 的旧事件。', status: 'active',
    startMs: 0, endMs: 0, ordinal: 0,
    sections: { goal: '验证回落', doing: '', deadend: '', next: '补齐时间' },
    constraints: [], members: [], rationale: '',
    kind: 'unknown', confidence: 'unknown', outcomes: [], skills: {}, createdAt: T('2026-10-01'), updatedAt: T('2026-10-01'),
  },
]
const md = renderPlanFromEventsPre(events, { wsName: 'test-ws', now: T('2026-10-27') })

ok(md.indexOf('# 项目白板 · test-ws') >= 0, 'A-1 标题含工作区名')
ok(md.indexOf('由 3 个事件渲染') >= 0, 'A-2 说明事件数')
ok(md.indexOf('## 当前状态') >= 0, 'A-3 ★含「当前状态」节')
ok(md.indexOf('## 近期进展') >= 0, 'A-4 ★含「近期进展」节')
ok(md.indexOf('## 关键约束') >= 0, 'A-5 ★含「关键约束」节')
ok(md.indexOf('## 待办') >= 0, 'A-6 ★含「待办」节')

console.log('')
console.log('=== B. 四段内容真的进去了 ===')
ok(md.indexOf('完成事件化改造') >= 0, 'B-1 goal 渲染')
ok(md.indexOf('六段判据全打通') >= 0, 'B-2 doing 渲染')
ok(md.indexOf('P2 镜像白名单漏了一个字段') >= 0, 'B-3 deadend 渲染')
ok(md.indexOf('实跑验证 B8') >= 0, 'B-4 next 渲染（待办节）')
ok(md.indexOf('2026-10-20') >= 0 && md.indexOf('2026-10-26') >= 0, 'B-5 日期从 startMs 推出')

console.log('')
console.log('=== C. 排序与状态 ===')
const i26 = md.indexOf('### 2026-10-26')
const i20 = md.indexOf('### 2026-10-20')
ok(i26 >= 0 && i20 >= 0 && i26 < i20, 'C-1 ★倒序：10-26 在 10-20 之前', 'i26=' + i26 + ' i20=' + i20)
ok(md.indexOf('| 完成 |') >= 0 || md.indexOf('| 进行 |') >= 0, 'C-2 状态已中文化')

console.log('')
console.log('=== D. ★负路径 ===')
ok(md.indexOf('1970') < 0, 'D-1 ★★负路径：不出现 1970（startMs=0 时回落 createdAt）')
ok(md.indexOf('<!--') < 0, 'D-2 ★★负路径：输出不含 HTML 注释')
const empty = renderPlanFromEventsPre([], { wsName: 'empty-ws' })
ok(typeof empty === 'string' && empty.length > 0, 'D-3 空数组返回骨架不崩溃', empty.length + ' 字符')
ok(empty.indexOf('## 当前状态') >= 0, 'D-4 空数组仍有完整四节')
ok(empty.indexOf('1970') < 0, 'D-5 空数组也不出现 1970')

console.log('')
console.log('=== E. 超长截断 ===')
const longEv = [{ ...events[1], sections: { goal: 'x'.repeat(5000), doing: '', deadend: '', next: '' } }]
const md2 = renderPlanFromEventsPre(longEv, { wsName: 'long' })
ok(md2.length < 5000, 'E-1 单段超长被截断', md2.length + ' 字符')
ok(md2.indexOf('x'.repeat(PLAN_SECTION_CHAR_MAX + 50)) < 0, 'E-2 截断到 PLAN_SECTION_CHAR_MAX')

console.log('')
console.log('=== F. 分节函数与估算 ===')
const secs = planSectionsFromEventsPre(events)
ok(secs.current && secs.recent && secs.constraints && secs.todos, 'F-1 四节都有内容')
ok(secs.constraints.indexOf('每次变动都要重写四段') >= 0, 'F-2 约束汇总正确')
const est = estimatePlanCharsPre(events, { wsName: 'test-ws', now: T('2026-10-27') })
const actual = md.length
const err = Math.abs(est - actual) / Math.max(1, actual)
ok(err <= 0.15, 'F-3 ★估算误差 ≤ 15%', 'est=' + est + ' actual=' + actual + ' err=' + (err * 100).toFixed(1) + '%')

console.log('')
console.log('SUMMARY  PASS ' + pass + ' / FAIL ' + fail)
process.exit(fail === 0 ? 0 : 1)
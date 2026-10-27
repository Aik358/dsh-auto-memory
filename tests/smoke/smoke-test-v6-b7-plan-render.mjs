/**
 * smoke-test-v6-b7-plan-render.mjs —— B7 由事件渲染新版白板验收
 *
 * 本仓铁律：断言必须「真 import → 真构造 → 真调用 → 断言返回值」，
 * 且每条判据都要有**负路径**（实现改错时必须变红）。
 *
 * 这里的负路径分两类：
 *   ① 输入型负路径：喂真实世界里的脏数据（带 HTML 注释、无时间戳、空数组），
 *      断言输出里不出现病态结果（'<!--' / '1970'）；
 *   ② 实现型负路径：把被测函数的判据**真改坏**（不是注释掉），断言结果真的变红，
 *      再还原。仅当「改坏后必红」成立，前面的绿才算有鉴别力。
 */

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import {
  renderPlanFromEventsPre,
  planSectionsFromEventsPre,
  estimatePlanCharsPre,
  PLAN_SECTION_CHAR_MAX,
  PLAN_RECENT_MAX,
  PLAN_TOTAL_CHAR_MAX,
} from '../../lib/plan-render.js'

let pass = 0, fail = 0
const ok = (c, n, e) => { if (c) { pass++; console.log('  ok   - ' + n + (e ? ' :: ' + e : '')) } else { fail++; console.log('  FAIL - ' + n + (e ? ' :: ' + e : '')) } }

const NOW = Date.parse('2026-10-27T12:00:00Z')
const T = (s) => Date.parse(s + 'T08:00:00Z')
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const SRC_PATH = path.join(ROOT, 'lib', 'plan-render.js')

// ───────────────────────────────────────────────────────────────────────────
console.log('=== A. 真 import + 真构造 3 个事件 + 真渲染 ===')
// 刻意让第一个事件的时间靠 startMs，第二个靠 createdAt 回落，第三个完全没有时间
const events = [
  {
    id: 'evt_00000001', name: 'v4 底层改造', summary: '把记忆单元从流水账迁到事件。第二句不该进表格。',
    status: 'closed', startMs: T('2026-10-20'), endMs: T('2026-10-24'), ordinal: 1, createdAt: T('2026-10-18'),
    sections: { goal: '完成事件化改造', doing: '六段判据全打通', deadend: 'P2 镜像白名单漏了一个字段', next: '归档旧日志' },
    constraints: ['每次变动都要重写四段', '禁止整文件 write'],
    members: ['handoff/a.md', 'handoff/b.md'], rationale: '同一目标的不同阶段',
    kind: 'ledger', confidence: 'high', outcomes: [], skills: {},
  },
  {
    id: 'evt_00000002', name: 'v6 白板改造', summary: '白板改为产出物。', status: 'active',
    startMs: T('2026-10-26'), endMs: T('2026-10-27'), ordinal: 2, createdAt: T('2026-10-26'),
    sections: { goal: '对齐 prototype 数据模型', doing: 'B1/B2/B3/B4/B6 完成', deadend: 'subagent 空转 20 分钟', next: '实跑验证 B8' },
    constraints: ['禁止整文件 write'],
    members: ['handoff/c.md'], rationale: '同一次改造',
    kind: 'ledger', confidence: 'high', outcomes: [], skills: {},
  },
  {
    // ★v1 旧事件形状：完全没有 startMs/endMs/kind/confidence/members/rationale/ordinal
    id: 'evt_00000003', name: '早期工作（v1 事件）', summary: 'v1 旧事件应回落 createdAt。', status: 'active',
    createdAt: T('2026-10-01'), updatedAt: T('2026-10-01'),
    sections: { goal: '验证 startMs 回落', doing: '', deadend: '', next: '补齐时间' },
  },
]
const md = renderPlanFromEventsPre(events, { wsName: 'test-ws', now: NOW })

ok(typeof md === 'string' && md.length > 200, 'A-1 返回非空字符串', md.length + ' 字符')
ok(md.indexOf('# 项目白板 · test-ws') === 0, 'A-2 ★标题行含 opts.wsName')
ok(md.indexOf('> 由 3 个事件渲染 · 最后更新 2026-10-27') >= 0, 'A-3 ★说明行的事件数与最后更新日期')
ok(md.indexOf('## 当前状态') >= 0, 'A-4 ★含「当前状态」节')
ok(md.indexOf('## 近期进展（按时间倒序）') >= 0, 'A-5 ★含「近期进展」节')
ok(md.indexOf('## 关键约束') >= 0, 'A-6 ★含「关键约束」节')
ok(md.indexOf('## 待办') >= 0, 'A-7 ★含「待办」节')
// 节的**先后次序**也要对，否则结构错位不会红
ok(md.indexOf('## 当前状态') < md.indexOf('## 近期进展') &&
   md.indexOf('## 近期进展') < md.indexOf('## 关键约束') &&
   md.indexOf('## 关键约束') < md.indexOf('## 待办'), 'A-8 四节顺序正确')

// ───────────────────────────────────────────────────────────────────────────
console.log('')
console.log('=== B. 四段内容真的进了「近期进展」 ===')
ok(md.indexOf('- 目标：完成事件化改造') >= 0, 'B-1 goal 渲染')
ok(md.indexOf('- 做了什么：六段判据全打通') >= 0, 'B-2 doing 渲染')
ok(md.indexOf('- 卡点：P2 镜像白名单漏了一个字段') >= 0, 'B-3 deadend 渲染')
ok(md.indexOf('- 下一步：实跑验证 B8') >= 0, 'B-4 next 渲染')
ok(md.indexOf('### 2026-10-20 · v4 底层改造') >= 0, 'B-5 日期取自 startMs（不是 endMs 10-24）')
ok(md.indexOf('### 2026-10-01 · 早期工作（v1 事件）') >= 0, 'B-6 ★v1 旧事件 startMs 缺失 ⇒ 回落 createdAt')
ok(md.indexOf('- 目标：') >= 0 && md.indexOf('（本事件暂未填四段）') < 0, 'B-7 v1 事件也有四段（空段不输出）')

// ───────────────────────────────────────────────────────────────────────────
console.log('')
console.log('=== C. 当前状态表：只列 active ===')
const secs = planSectionsFromEventsPre(events)
ok(secs.current.indexOf('| 事件名 | 状态 | 最近进展 |') >= 0, 'C-1 表头存在')
ok(secs.current.indexOf('v6 白板改造') >= 0, 'C-2 active 事件在表内')
ok(secs.current.indexOf('| 进行 |') >= 0, 'C-3 状态中文化为「进行」')
ok(secs.current.indexOf('v4 底层改造') < 0, 'C-4 ★负路径：closed 事件不进「当前状态」表')
ok(secs.current.indexOf('早期工作（v1 事件）') >= 0, 'C-5 v1 事件未标 status ⇒ 仍是 active，应在表内')
// 最近进展取 summary 首句（不是整段）
ok(secs.current.indexOf('把记忆单元从流水账迁到事件。') < 0 || secs.current.indexOf('第二句不该进表格') < 0,
   'C-6 ★表格只取 summary 首句（不整段塞入）')

// ───────────────────────────────────────────────────────────────────────────
console.log('')
console.log('=== D. 排序：startMs 倒序，同时间用 ordinal ===')
const iO26 = md.indexOf('### 2026-10-26'), iO20 = md.indexOf('### 2026-10-20'), iO01 = md.indexOf('### 2026-10-01')
ok(iO26 >= 0 && iO20 >= 0 && iO26 < iO20 && iO20 < iO01, 'D-1 ★按 startMs 倒序', iO26 + '/' + iO20 + '/' + iO01)
const tie = planSectionsFromEventsPre([
  { id: 'x1', name: '同时间-ordinal低', status: 'active', startMs: 5000, ordinal: 1 },
  { id: 'x2', name: '同时间-ordinal高', status: 'active', startMs: 5000, ordinal: 9 },
])
ok(tie.recent.indexOf('同时间-ordinal高') < tie.recent.indexOf('同时间-ordinal低'), 'D-2 ★同 startMs 时按 ordinal 降序')

// ───────────────────────────────────────────────────────────────────────────
console.log('')
console.log('=== E. 关键约束 / 待办 汇总 ===')
ok(secs.constraints.indexOf('- 每次变动都要重写四段') >= 0, 'E-1 约束已汇总')
ok(secs.constraints.split('禁止整文件 write').length - 1 === 1, 'E-2 ★跨事件重复约束只出现一次（去重）')
ok(secs.todos.indexOf('- 实跑验证 B8') >= 0, 'E-3 active 的 next 进待办')
ok(secs.todos.indexOf('归档旧日志') < 0, 'E-4 ★负路径：closed 事件的 next 不进待办')
const pausedEv = [{ id: 'p1', name: '暂停事件', status: 'paused', startMs: 1000, sections: { goal: '', doing: '', deadend: '', next: '暂停的下步' } }]
const pSec = planSectionsFromEventsPre(pausedEv)
ok(pSec.todos.indexOf('暂停的下步') < 0, 'E-5 ★负路径：paused 事件的 next 不进待办')
ok(pSec.current.indexOf('暂停事件') < 0, 'E-6 ★负路径：paused 事件不进「当前状态」表')

// ───────────────────────────────────────────────────────────────────────────
console.log('')
console.log('=== F. ★★负路径①：startMs=0 不得出现 1970 ===')
const noTime = [{ id: 'n1', name: '零时间事件', status: 'active', startMs: 0, endMs: 0, ordinal: 0,
  sections: { goal: 'G', doing: '', deadend: '', next: 'N' } }]
const mdNoTime = renderPlanFromEventsPre(noTime, { wsName: 'zero', now: NOW })
ok(mdNoTime.indexOf('1970') < 0, 'F-1 ★★startMs=0 且无 createdAt ⇒ 不出现 1970')
ok(mdNoTime.indexOf('### 零时间事件') >= 0, 'F-2 无日期时标题不带假日期（只剩事件名）')
// 极端：createdAt 显式给 0 / 负数 / NaN / 字符串
for (const bad of [0, -1, NaN, 'abc', null, undefined]) {
  const mm = renderPlanFromEventsPre([{ id: 'n2', name: 'X' + String(bad), status: 'active', startMs: 0, createdAt: bad }], { now: NOW })
  ok(mm.indexOf('1970') < 0, 'F-3 病态 createdAt=' + String(bad) + ' 也不出现 1970')
}
// 真回到 1970 的合法时间戳也必须被挡（前端曾把缺失时间伪造成 0）
const epoch = renderPlanFromEventsPre([{ id: 'n3', name: '纪元事件', status: 'active', startMs: 1, createdAt: 1 }], { now: NOW })
ok(epoch.indexOf('1970') < 0, 'F-4 ★时间戳 1ms（1970-01-01）也不外泄 1970')

// ───────────────────────────────────────────────────────────────────────────
console.log('')
console.log('=== G. ★★负路径②：输出不得含 HTML 注释 ===')
const dirty = [{
  id: 'd1',
  name: '<!-- type:goal --> 脏标题',
  summary: '摘要<!-- memory:mem_deadbeef --> 后续',
  status: 'active', startMs: T('2026-10-05'),
  sections: {
    goal: '<!-- type:dead-end -->目标正文',
    doing: '半截注释 <!-- 未闭合也在',
    deadend: '结尾残缺 -->这里',
    next: '收尾 <!-- memory:mem_x -->',
  },
  constraints: ['<!-- type:rule -->约束正文', '<!-- memory:mem_y -->'],
}]
const mdDirty = renderPlanFromEventsPre(dirty, { wsName: 'dirty', now: NOW })
ok(mdDirty.indexOf('<!--') < 0, 'G-1 ★★输出不含 "<!--"')
ok(mdDirty.indexOf('-->') < 0, 'G-2 ★★输出也不含 "-->"（半截残留）')
ok(mdDirty.indexOf('脏标题') >= 0, 'G-3 注释被剥掉但正文保留')
ok(mdDirty.indexOf('目标正文') >= 0, 'G-4 段首注释剥掉后正文保留')
ok(mdDirty.indexOf('约束正文') >= 0, 'G-5 约束里的注释也剥掉')
// planSections 单独调用也不能漏
const dSec = planSectionsFromEventsPre(dirty)
ok([dSec.current, dSec.recent, dSec.constraints, dSec.todos].join('').indexOf('<!--') < 0, 'G-6 planSections 四节同样无注释')

// ───────────────────────────────────────────────────────────────────────────
console.log('')
console.log('=== H. ★★负路径③：空数组 ⇒ 返回骨架且不抛错 ===')
let emptyOk = false, empty = ''
try { empty = renderPlanFromEventsPre([], { wsName: 'empty-ws', now: NOW }); emptyOk = true } catch (e) { emptyOk = false }
ok(emptyOk, 'H-1 ★空数组不抛错')
ok(typeof empty === 'string' && empty.length > 0, 'H-2 空数组返回非空骨架', empty.length + ' 字符')
ok(empty.indexOf('# 项目白板 · empty-ws') === 0, 'H-3 骨架也有标题')
ok(empty.indexOf('## 当前状态') >= 0 && empty.indexOf('## 近期进展（按时间倒序）') >= 0 &&
   empty.indexOf('## 关键约束') >= 0 && empty.indexOf('## 待办') >= 0, 'H-4 骨架四节齐全')
ok(empty.indexOf('1970') < 0, 'H-5 骨架无 1970')
// 非数组入参也不能崩
for (const bad of [null, undefined, 'abc', 42, {}]) {
  let threw = false
  try { renderPlanFromEventsPre(bad, { now: NOW }) } catch (e) { threw = true }
  ok(!threw, 'H-6 非数组入参不抛错 :: ' + String(bad))
}
ok(renderPlanFromEventsPre([], { now: NOW }).indexOf('workspace') >= 0, 'H-7 缺省 wsName = workspace')

// ───────────────────────────────────────────────────────────────────────────
console.log('')
console.log('=== I. estimatePlanCharsPre：误差 ≤ 15% ===')
// 用**多组**不同形状的事件量误差，避免「只测一组恰好相等」
const estCases = [
  ['空数组', []],
  ['单事件', [events[1]]],
  ['三事件', events],
  ['长文本', [{ id: 'l1', name: '长', status: 'active', startMs: T('2026-10-02'), summary: 'S'.repeat(200),
    sections: { goal: 'G'.repeat(500), doing: 'D'.repeat(500), deadend: 'X'.repeat(500), next: 'N'.repeat(500) },
    constraints: ['C'.repeat(300)] }]],
  ['大量事件', Array.from({ length: 40 }, (_, i) => ({
    id: 'm' + i, name: '事件' + i, status: i % 3 === 0 ? 'active' : 'closed',
    startMs: T('2026-09-01') + i * 86400000, ordinal: i,
    summary: '摘要' + i, sections: { goal: '目标' + i, doing: '做了' + i, deadend: '', next: '下一步' + i },
    constraints: ['约束' + i],
  }))],
]
for (const [label, evs] of estCases) {
  const est = estimatePlanCharsPre(evs, { wsName: 'est-ws', now: NOW })
  const actual = renderPlanFromEventsPre(evs, { wsName: 'est-ws', now: NOW }).length
  const err = Math.abs(est - actual) / Math.max(1, actual)
  ok(typeof est === 'number' && Number.isFinite(est), 'I-x ' + label + ' 返回 finite number', String(est))
  ok(err <= 0.15, 'I-1 ★' + label + ' 估算误差 ≤ 15%', 'est=' + est + ' actual=' + actual + ' err=' + (err * 100).toFixed(2) + '%')
}

// ───────────────────────────────────────────────────────────────────────────
console.log('')
console.log('=== J. 上限与截断 ===')
const longEv = [{ id: 'z1', name: '超长事件', status: 'active', startMs: T('2026-10-03'),
  sections: { goal: 'x'.repeat(5000), doing: '', deadend: '', next: '' } }]
const mdLong = renderPlanFromEventsPre(longEv, { wsName: 'long', now: NOW })
ok(mdLong.indexOf('x'.repeat(PLAN_SECTION_CHAR_MAX + 50)) < 0, 'J-1 单段截断到 PLAN_SECTION_CHAR_MAX', PLAN_SECTION_CHAR_MAX + '')
const goalLine = mdLong.split('\n').filter((l) => l.indexOf('- 目标：') === 0)[0] || ''
ok(goalLine.slice(-1) === '…' && goalLine.length === 5 + PLAN_SECTION_CHAR_MAX, 'J-2 截断到上限并加省略号（不是无限截）', 'lineLen=' + goalLine.length + ' 期望=' + (5 + PLAN_SECTION_CHAR_MAX))
const many = Array.from({ length: PLAN_RECENT_MAX + 10 }, (_, i) => ({
  id: 'q' + i, name: '批量事件' + i, status: 'active', startMs: 1000000 + i * 86400000,
  sections: { goal: 'g', doing: '', deadend: '', next: '' },
}))
const mdMany = renderPlanFromEventsPre(many, { wsName: 'many', now: NOW })
const headings = (mdMany.match(/^### /gm) || []).length
ok(headings === PLAN_RECENT_MAX, 'J-3 ★「近期进展」最多 PLAN_RECENT_MAX 个（' + PLAN_RECENT_MAX + '）', '实际 ' + headings)
ok(mdMany.length <= PLAN_TOTAL_CHAR_MAX, 'J-4 总长不超 PLAN_TOTAL_CHAR_MAX', mdMany.length + '')

// ───────────────────────────────────────────────────────────────────────────
console.log('')
console.log('=== K. ★★实现型负路径：把判据真改坏，断言真的变红 ===')
/**
 * 读源码 → 做**文本替换** → 写进同目录的临时 .mjs → 真 import → 断言行为变化。
 * ★不是注释掉判据：每处替换都真删/真改被检逻辑，替换必须恰好命中 1 次。
 * ★临时文件必须与事件源同目录，否则 './event-store.js' 解析不到。
 */
const SRC = fs.readFileSync(SRC_PATH, 'utf8')
const TMP = path.join(ROOT, 'lib', '.plan-render.mutant-' + process.pid + '.mjs')

async function mutate(label, from, to, expectFn) {
  const hits = SRC.split(from).length - 1
  ok(hits === 1, 'K ' + label + ' 锚串恰命中 1 次', '命中 ' + hits + ' 次')
  if (hits !== 1) return
  fs.writeFileSync(TMP, SRC.replace(from, to), 'utf8')
  try {
    const mutant = await import(pathToFileURL(TMP).href + '?v=' + Math.random())
    const red = !expectFn(mutant)
    ok(red, 'K ' + label + ' ★变异后判据必红')
  } finally {
    try { fs.unlinkSync(TMP) } catch (e) {}
  }
}

// 变异 1：不再剥 HTML 注释 ⇒ G 组必须红
await mutate('变异1-不剥注释', 'return stripHtmlCommentsPre(s)', "return String(s == null ? '' : s)", (mm) => {
  return mm.renderPlanFromEventsPre(dirty, { wsName: 'dirty', now: NOW }).indexOf('<!--') < 0
})
// 变异 2：1970 守卫失效（不再挡 y < 1971）⇒ F 组必须红
await mutate('变异2-1970守卫失效', 'if (y < 1971) return', 'if (false) return', (mm) => {
  return mm.renderPlanFromEventsPre([{ id: 'n3', name: '纪元事件', status: 'active', startMs: 1, createdAt: 1 }], { now: NOW }).indexOf('1970') < 0
})
// 变异 3：当前状态表不再过滤 active ⇒ C-4 必须红
await mutate('变异3-状态过滤失效', "const actives = sorted.filter((e) => e.status === 'active')", 'const actives = sorted.slice()', (mm) => {
  return mm.planSectionsFromEventsPre(events).current.indexOf('v4 底层改造') < 0
})
// 变异 4：时间不再回落 createdAt ⇒ B-6 必须红
await mutate('变异4-不回落createdAt', "const created = Number(ev && ev.createdAt)", 'const created = 0', (mm) => {
  return mm.renderPlanFromEventsPre(events, { wsName: 'test-ws', now: NOW }).indexOf('### 2026-10-01 · 早期工作（v1 事件）') >= 0
})
// 变异 5：倒序改正序 ⇒ D-1 必须红
await mutate('变异5-排序反转', 'if (tb !== ta) return tb - ta', 'if (tb !== ta) return ta - tb', (mm) => {
  const m = mm.renderPlanFromEventsPre(events, { wsName: 'test-ws', now: NOW })
  return m.indexOf('### 2026-10-26') < m.indexOf('### 2026-10-20')
})
// 变异 6：estimate 直接回退成「真渲染」⇒ 把固定算式改坏后必须能抓到（证明它不是恒真）
await mutate('变异6-estimate与render脱钩', 'const total = fixed + s.current.length', 'const total = fixed + s.current.length + 5000', (mm) => {
  const est = mm.estimatePlanCharsPre(events, { wsName: 'test-ws', now: NOW })
  const actual = mm.renderPlanFromEventsPre(events, { wsName: 'test-ws', now: NOW }).length
  return Math.abs(est - actual) / Math.max(1, actual) <= 0.15
})

// ───────────────────────────────────────────────────────────────────────────
console.log('')
console.log('=== L. 纯函数 / 无 IO 守卫（静态，非功能证据）===')
const srcCrlf = (SRC.match(/\r\n/g) || []).length
ok(srcCrlf === 0, 'L-1 源文件无 CRLF', 'CRLF=' + srcCrlf)
ok(SRC.indexOf("from './event-store.js'") >= 0, 'L-2 走 normalizeEventPre 的唯一入口（event-store）')
ok(!/from\s+'\.\/index\.js'/.test(SRC), 'L-3 ★不 import lib/index.js（无环形依赖）')
ok(!/require\(\s*['"]node:fs/.test(SRC) && !/from\s+'node:fs/.test(SRC), 'L-4 零文件 IO')
// normalize 真生效：v1 事件的 ordinal/kind 等被补成默认值后才能安全排序
const v1Only = planSectionsFromEventsPre([{ id: 'v1', name: '纯 v1', createdAt: T('2026-10-04'), status: 'active' }])
ok(v1Only.recent.indexOf('### 2026-10-04 · 纯 v1') >= 0, 'L-5 v1 事件（无 sections/ordinal/kind）也能渲染')

console.log('')
console.log('SUMMARY  PASS ' + pass + ' / FAIL ' + fail)
process.exit(fail === 0 ? 0 : 1)

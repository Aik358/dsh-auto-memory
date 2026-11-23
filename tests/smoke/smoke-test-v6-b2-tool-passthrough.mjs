import fs from 'node:fs'
import path from 'node:path'
import { eventStorePre, readStorePre } from '../../lib/event-store.js'

let pass = 0, fail = 0
const ok = (c, n, e) => { if (c) { pass++; console.log('  ok   - ' + n + (e ? ' :: ' + e : '')) } else { fail++; console.log('  FAIL - ' + n + (e ? ' :: ' + e : '')) } }

const IX = fs.readFileSync(new URL('../../lib/index.js', import.meta.url), 'utf8')

console.log('=== A. 工具层接线（静态守卫）===')
ok(IX.indexOf('startMs: args.startMs, endMs: args.endMs, members: args.members') >= 0, 'A-1 create 透传 10 个新字段')
ok(IX.indexOf("'startMs', 'endMs', 'members', 'rationale', 'kind', 'confidence', 'outcomes', 'skills'") >= 0, 'A-2 set 白名单含 8 个新字段')
ok(IX.indexOf('时间跨度: ') >= 0, 'A-3 create 返回值带时间跨度')

console.log('')
console.log('=== B. 端到端：模拟工具层调用链（真调 store，走与工具相同的入参形状）===')
const dir = path.join(process.cwd(), 'artifacts', '_b2test')
fs.mkdirSync(dir, { recursive: true })
const sp = path.join(dir, 'event-store.json')
try { fs.unlinkSync(sp) } catch (e) {}

// 模拟 args（与 memory_event tool 的 args 同形）
const args = {
  action: 'create', name: 'B2 端到端事件', summary: '验证工具层透传',
  startMs: Date.parse('2026-10-01T00:00:00Z'), endMs: Date.parse('2026-10-05T00:00:00Z'),
  members: ['handoff/a.md', 'handoff/b.md', 'log/2026-10-01.md'],
  rationale: '三篇同属一件事的不同阶段', kind: 'ledger', confidence: 'high',
  outcomes: ['成果1', '成果2'], ordinal: 3,
  sections: { goal: 'G', doing: 'D', deadend: '', next: 'N' },
}
// 完全照抄 index.js 里 create 分支的写法
const ev = await eventStorePre.create(sp, {
  name: args.name, summary: args.summary, sections: args.sections,
  constraints: args.constraints, skillRef: args.skillRef,
  startMs: args.startMs, endMs: args.endMs, members: args.members,
  rationale: args.rationale, kind: args.kind, confidence: args.confidence,
  outcomes: args.outcomes, ordinal: args.ordinal, skills: args.skills, idemTag: args.idemTag,
})
ok(ev.startMs === args.startMs, 'B-1 startMs 经工具层落盘', ev.startMs + '')
ok(ev.members.length === 3, 'B-2 members 三项', ev.members.length + '')
ok(ev.rationale === args.rationale, 'B-3 rationale 落盘')
ok(ev.kind === 'ledger' && ev.confidence === 'high', 'B-4 kind/confidence 落盘')
ok(ev.outcomes.length === 2 && ev.ordinal === 3, 'B-5 outcomes/ordinal 落盘')

console.log('')
console.log('=== C. set 分支改新字段 ===')
const e2 = await eventStorePre.set(sp, ev.id, { startMs: Date.parse('2026-09-28T00:00:00Z'), confidence: 'medium', rationale: '改过了' })
ok(new Date(e2.startMs).toISOString().slice(0,10) === '2026-09-28', 'C-1 set 可改 startMs')
ok(e2.confidence === 'medium', 'C-2 set 可改 confidence')
ok(e2.rationale === '改过了', 'C-3 set 可改 rationale')

console.log('')
console.log('=== D. append 检查点四段（工具层同形）===')
const ckargs = {
  at: Date.parse('2026-09-25T10:00:00Z'), kind: 'ledger',
  goal: '目标段', state: '状态段', dead: '失败段', next: '下一步段',
  quoteRef: '源文件引用', quoteLine: 42, rel: 'a.md', bytes: 1234, sha256: 'deadbeef',
  text: '原文',
}
await eventStorePre.append(sp, ev.id, { checkpoint: ckargs })
const disk = JSON.parse(fs.readFileSync(sp, 'utf8'))
const cp = disk.events[0].checkpoints[0]
ok(cp.goal === '目标段' && cp.state === '状态段' && cp.dead === '失败段' && cp.next === '下一步段', 'D-1 四段全落盘')
ok(cp.quoteLine === 42 && cp.sha256 === 'deadbeef' && cp.bytes === 1234, 'D-2 溯源字段落盘')
ok(new Date(disk.events[0].startMs).toISOString().slice(0,10) === '2026-09-25', 'D-3 ★span 自动扩到 09-25', new Date(disk.events[0].startMs).toISOString())

console.log('')
console.log('=== E. 负路径：工具层非法入参不得静默 ===')
// members 非数组 → applyV2FieldsPre 静默忽略 → 但 validate 不会报（因为默认 []）
// 真正需要验的是：startMs > endMs 必须被 validate 拒绝
const { validateEventPre } = await import('../../lib/event-store.js')
const badEv = JSON.parse(JSON.stringify(disk.events[0]))
badEv.startMs = badEv.endMs + 5000
ok(validateEventPre(badEv).indexOf('startMs-gt-endMs') >= 0, 'E-1 startMs>endMs 被 validate 拒绝')

console.log('')
console.log('SUMMARY  PASS ' + pass + ' / FAIL ' + fail)
process.exit(fail === 0 ? 0 : 1)
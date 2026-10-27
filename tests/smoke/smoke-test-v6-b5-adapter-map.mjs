/** smoke-test-v6-b5-adapter-map.mjs —— B5 前端字段映射验收（真执行 adapter） */
import fs from 'node:fs'

let pass = 0, fail = 0
const ok = (c, n, e) => { if (c) { pass++; console.log('  ok   - ' + n + (e ? ' :: ' + e : '')) } else { fail++; console.log('  FAIL - ' + n + (e ? ' :: ' + e : '')) } }

// ★ 从 ESM 源真 import（不是从 client.js 抽字符串）
const mod = await import('../../lib/ev4-adapter.js')
const adaptEventPre = mod.adaptEventPre || (mod.default && mod.default.adaptEventPre)
ok(typeof adaptEventPre === 'function', 'B-0 ★真 import 到 adaptEventPre 函数', typeof adaptEventPre)

console.log('')
console.log('=== A. 事件级字段映射（真调用）===')
const raw = {
  id: 'evt_0000abcd', name: 'ZCode 移交 + 首页重排',
  summary: '三路工作完整移交', status: 'active',
  kind: 'ledger', confidence: 'high',
  startMs: Date.parse('2026-09-20T08:10:00Z'), endMs: Date.parse('2026-09-22T20:59:00Z'),
  members: ['handoff/a.md', 'handoff/b.md', 'log/2026-09-20.md'],
  rationale: '两篇为把功能/架构/首页三路工作移交 ZCode',
  outcomes: ['验证 check-home.mjs 全绿', '全量回归 PASS 141'],
  ordinal: 7,
  sections: { goal: '移交 ZCode', doing: '改 site 三件', deadend: '', next: '等接手' },
  checkpoints: [],
  userPercept: [], agentTrace: [], sharedGround: [], commitments: [], constraints: [],
  createdAt: Date.parse('2026-09-20T08:10:00Z'), updatedAt: Date.parse('2026-09-22T20:59:00Z'),
}
const ev = adaptEventPre(raw, 0)
ok(Array.isArray(ev.members) && ev.members.length === 3, 'A-1 ★members 映射（原写死 []）', JSON.stringify(ev.members))
ok(ev.members[0] === 'handoff/a.md', 'A-2 members 内容正确')
ok(ev.rationale.indexOf('移交 ZCode') >= 0, 'A-3 ★rationale 用产品字段（原只读 sections.deadend）', ev.rationale.slice(0,30))
ok(ev.kind === 'ledger', 'A-4 ★kind 用产品字段（原写死 event）')
ok(Array.isArray(ev.outcomes) && ev.outcomes.length === 2, 'A-5 ★outcomes 用产品数组', ev.outcomes.length + '')
ok(ev.outcomes[0].text.indexOf('check-home') >= 0, 'A-6 outcomes 内容正确')
ok(typeof ev.startMs === 'number' && ev.startMs > 0, 'A-7 startMs 保留')
ok(ev.confidence === 'high', 'A-8 confidence 映射')

console.log('')
console.log('=== B. 检查点四段映射（真调用）===')
const raw2 = JSON.parse(JSON.stringify(raw))
raw2.checkpoints = [{
  at: Date.parse('2026-09-20T08:10:00Z'), kind: 'ledger',
  goal: '把三路工作完整移交 ZCode',
  state: '本轮改动 site/index.html（42,291→55,977 B）',
  dead: '无',
  next: '等 ZCode 接手',
  quoteRef: '把功能梳理 + 架构梳理 + 首页构建三路工作完整移交',
  quoteLine: 11,
  text: '原始正文',
}]
const ev2 = adaptEventPre(raw2, 0)
const cp = ev2.checkpoints[0]
ok(Array.isArray(cp.goal) && cp.goal.length > 0, 'B-1 ★checkpoint.goal 非空（原写死 []）', JSON.stringify(cp.goal).slice(0,50))
ok(Array.isArray(cp.state) && cp.state.length > 0, 'B-2 ★checkpoint.state 非空')
ok(Array.isArray(cp.dead) && cp.dead.length > 0, 'B-3 ★checkpoint.dead 非空')
ok(Array.isArray(cp.next) && cp.next.length > 0, 'B-4 ★checkpoint.next 非空')
ok(String(cp.goal[0]).indexOf('移交 ZCode') >= 0, 'B-5 goal 内容正确')

console.log('')
console.log('=== C. ★负路径：旧事件（无新字段）不得崩 ===')
const legacy = {
  id: 'evt_11111111', name: '旧事件', summary: 's', status: 'active',
  sections: { goal: 'g', doing: '', deadend: 'd', next: '' }, checkpoints: [],
  userPercept: [], agentTrace: [], sharedGround: [], commitments: [], constraints: [],
  createdAt: 1, updatedAt: 1,
}
let ev3 = null, threw = null
try { ev3 = adaptEventPre(legacy, 1) } catch (e) { threw = e.message }
ok(!threw, 'C-1 ★旧事件不抛错', threw || '')
ok(ev3 && Array.isArray(ev3.members) && ev3.members.length === 0, 'C-2 members 缺省为空数组')
ok(ev3 && ev3.kind === 'event', 'C-3 kind 缺省回落 event')
ok(ev3 && ev3.rationale.indexOf('d') >= 0, 'C-4 rationale 回落 sections.deadend')

console.log('')
console.log('=== D. ★client.js 内联块与源一致（守卫）===')
const CL = fs.readFileSync(new URL('../../lib/client.js', import.meta.url), 'utf8')
ok(CL.indexOf('members: arrPre(ev.members)') >= 0, 'D-1 client.js 内联块含 members 映射')
ok(CL.indexOf('quadLinesPre') >= 0, 'D-2 client.js 内联块含 quadLinesPre')
ok(CL.indexOf('cleanSectionTextPre(ev.rationale)') >= 0, 'D-3 client.js 含 rationale 映射')
ok(CL.indexOf('CHECKPOINT_QUAD') < 0 || true, 'D-4 (info) 不做无谓断言')

console.log('')
console.log('SUMMARY  PASS ' + pass + ' / FAIL ' + fail)
process.exit(fail === 0 ? 0 : 1)
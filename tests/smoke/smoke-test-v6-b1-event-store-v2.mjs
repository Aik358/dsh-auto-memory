import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { eventStorePre, readStorePre, normalizeEventPre, validateEventPre, EVENT_TOP_FIELDS } from '../../lib/event-store.js'

let pass = 0, fail = 0
const ok = (c, name, extra) => { if (c) { pass++; console.log('  ok   - ' + name + (extra ? ' :: ' + extra : '')) } else { fail++; console.log('  FAIL - ' + name + (extra ? ' :: ' + extra : '')) } }

const dir = path.join(process.cwd(), 'artifacts', '_b1test')
fs.mkdirSync(dir, { recursive: true })
const storePath = path.join(dir, 'event-store.json')
try { fs.unlinkSync(storePath) } catch (e) {}

console.log('=== A. 字段定义 ===')
ok(EVENT_TOP_FIELDS.length === 26, 'A-1 EVENT_TOP_FIELDS = 26', EVENT_TOP_FIELDS.length + '')
for (const f of ['startMs','endMs','members','rationale','kind','confidence','outcomes','ordinal','skills','idemTag']) {
  ok(EVENT_TOP_FIELDS.includes(f), 'A-2 含 ' + f)
}

console.log('')
console.log('=== B. 真 create（带新字段）===')
const T1 = Date.parse('2026-09-20T08:10:00Z'), T2 = Date.parse('2026-09-22T20:59:00Z')
const ev = await eventStorePre.create(storePath, {
  name: 'ZCode 移交 + 首页重排', summary: '三路工作完整移交',
  kind: 'ledger', confidence: 'high',
  startMs: T1, endMs: T2,
  members: ['handoff/handoff-20260920-081045.md', 'handoff/handoff-20260920-203744.md'],
  rationale: '两篇为把功能/架构/首页三路工作移交 ZCode，以及首页按功能组织。',
  outcomes: ['验证 check-home.mjs 全绿', '全量回归 PASS 141 / FAIL 0'],
  ordinal: 7,
  sections: { goal: '移交 ZCode', doing: '改 site 三件', deadend: '', next: '等 ZCode 接手' },
})
ok(ev.id && /^evt_/.test(ev.id), 'B-1 create 返回合法 id', ev.id)
ok(ev.startMs === T1, 'B-2 startMs 落盘', ev.startMs + '')
ok(ev.endMs === T2, 'B-3 endMs 落盘', ev.endMs + '')
ok(ev.members.length === 2, 'B-4 members 落盘', ev.members.length + '')
ok(ev.rationale.indexOf('移交 ZCode') >= 0, 'B-5 rationale 落盘')
ok(ev.kind === 'ledger', 'B-6 kind 落盘')
ok(ev.confidence === 'high', 'B-7 confidence 落盘')
ok(ev.outcomes.length === 2, 'B-8 outcomes 落盘')
ok(ev.ordinal === 7, 'B-9 ordinal 落盘')
ok(ev.skills && ev.skills.hitCount === 0, 'B-10 skills 默认')

console.log('')
console.log('=== C. 真 append 检查点四段 + 自动扩展 span ===')
const T0 = Date.parse('2026-09-18T06:00:00Z')  // 早于 startMs
const r1 = await eventStorePre.append(storePath, ev.id, {
  checkpoint: {
    at: T0, kind: 'ledger',
    goal: '把三路工作完整移交 ZCode', state: '本轮改动 site/index.html（42,291→55,977 B）',
    dead: '', next: '等 ZCode 接手',
    quoteRef: '把「功能梳理 + 架构梳理 + 首页构建」三路工作完整移交', quoteLine: 11,
    rel: 'handoff-20260920-081045.md', bytes: 25800, sha256: 'abc123',
    text: '原始账本正文',
  },
})
ok(r1.appended === 1, 'C-1 append 成功', JSON.stringify(r1))
const back = JSON.parse(fs.readFileSync(storePath, 'utf8')).events[0]
const cp = back.checkpoints[0]
ok(cp.goal === '把三路工作完整移交 ZCode', 'C-2 goal 落盘')
ok(cp.state.indexOf('site/index.html') >= 0, 'C-3 state 落盘')
ok(cp.next === '等 ZCode 接手', 'C-4 next 落盘')
ok(cp.dead === '', 'C-5 dead 落盘')
ok(cp.quoteLine === 11, 'C-6 quoteLine 落盘')
ok(cp.sha256 === 'abc123', 'C-7 sha256 落盘')
ok(cp.bytes === 25800, 'C-8 bytes 落盘')
ok(back.startMs === T0, 'C-9 ★span 自动向前扩展', new Date(back.startMs).toISOString())
ok(back.endMs === T2, 'C-10 endMs 未被缩小', new Date(back.endMs).toISOString())

console.log('')
console.log('=== D. 磁盘真验证（不是内存）===')
const disk = JSON.parse(fs.readFileSync(storePath, 'utf8'))
ok(disk.schema === 'v4_event_store_v2', 'D-1 schema = v2', disk.schema)
const d0 = disk.events[0]
ok(Object.keys(d0).length === 26, 'D-2 磁盘事件 26 字段', Object.keys(d0).length + '')
ok(d0.members[0] === 'handoff/handoff-20260920-081045.md', 'D-3 members 在磁盘上')

console.log('')
console.log('=== E. 校验负路径（必须拒绝）===')
function bad(mut, label) {
  const e2 = JSON.parse(JSON.stringify(d0))
  mut(e2)
  const errs = validateEventPre(e2)
  ok(errs.length > 0, label, errs.slice(0, 2).join(','))
}
bad(e => { e.startMs = T2 + 1000 }, 'E-1 startMs > endMs 被拒')
bad(e => { e.members = 'not-array' }, 'E-2 members 非数组被拒')
bad(e => { e.kind = 'bogus' }, 'E-3 非法 kind 被拒')
bad(e => { e.confidence = 'bogus' }, 'E-4 非法 confidence 被拒')
bad(e => { delete e.startMs }, 'E-5 缺 startMs 被拒')

console.log('')
console.log('=== F. v1 兼容（normalize）===')
const v1 = { id: 'evt_aaaaaaaa', name: 'old', summary: '', outcome: null, skillRef: null, status: 'active', pausedReason: null, sections: {goal:'',doing:'',deadend:'',next:''}, checkpoints: [], userPercept: [], agentTrace: [], sharedGround: [], commitments: [], constraints: [], createdAt: 1, updatedAt: 1 }
const nv = normalizeEventPre(v1)
ok(nv.startMs === 0, 'F-1 v1 → startMs 补 0')
ok(Array.isArray(nv.members) && nv.members.length === 0, 'F-2 v1 → members 补 []')
ok(nv.kind === 'unknown', 'F-3 v1 → kind=unknown')
ok(validateEventPre(nv).length === 0, 'F-4 ★normalize 后校验通过', validateEventPre(nv).join(','))

console.log('')
console.log('SUMMARY  PASS ' + pass + ' / FAIL ' + fail)
process.exit(fail === 0 ? 0 : 1)
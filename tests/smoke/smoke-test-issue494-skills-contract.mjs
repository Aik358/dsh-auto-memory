// issue#494 验收：memory_event.skills 的**公开数组契约**与**内部对象契约**不一致。
//
// 缺陷（修复前，HEAD 6a3da76a）：
//   · 公开签名（lib/index.js memory_event）：skills = { type:'array', items:{type:'string'} }
//   · 内部契约（lib/event-store.js emptyEventPre/validateEventPre）：
//       skills = { hitCount: number, names: string[], touched: boolean }
//   · 写入层 lib/event-store.js:147 用 Object.assign 做**形状合并**（不是语义转换）：
//       Object.assign({hitCount:0,names:[],touched:false}, ['skill-a'])
//     ⇒ 落盘成 { "0":"skill-a", hitCount:0, names:[], touched:false }
//     ⇒ ① 技能登记静默失效（工具报成功、names 仍空、touched 仍 false）
//        ② 落盘多出 "0"/"1" 脏键，且脏键绕过 26 字段 fail-closed 校验
//        ③ 传 'not-an-object' ⇒ typeof 'x' === 'object' 为 false ⇒ 静默跳过（不报错）
//   · 展示层 lib/ev4-adapter.js:350 硬编码 skills: [] ⇒ 即使写入修好，事件卡「SKILL 状态」栏
//     也永远显示「本事件未涉及技能库」。
//
// 本套件是**功能验收（CR-10）**：真 import → 真构造 store → 真调 create/set → 读盘断言，
// 并对适配层真调 adaptEventPre 断言输出形状。
//   [A] create 传数组          [B] set 传数组          [C] 空数组
//   [D] 对象形态               [E] 非法形状必须抛错    [F] 对象内字段非法必须抛错
//   [G] validateEventPre 仍通过（'bad-skills' 未被削弱）
//   [H] ev4-adapter 输出真实 names（不是空数组）
//   [N] 负路径：本套件由外部「变异」验证（见 artifacts/issue-repair-20261102/R-A.md）
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
process.on('uncaughtException', (e) => { console.error('[494] FATAL:', (e && e.stack || e.message) || e); process.exit(1) })
process.on('unhandledRejection', (r) => { console.error('[494] REJ:', r); process.exit(1) })

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ES = await import('../../lib/ev4-adapter.js')
const { eventStorePre, validateEventPre, readStorePre } = await import('../../lib/event-store.js')

let pass = 0, fail = 0
const ok = (c, name, extra) => { if (c) { pass++; console.log('  ok   - ' + name + (extra ? ' :: ' + extra : '')) } else { fail++; console.error('  FAIL - ' + name + (extra ? ' :: ' + extra : '')) } }
const hasNumericKey = (o) => Object.keys(o || {}).some((k) => /^\d+$/.test(k))

const DIR = mkdtempSync(path.join(tmpdir(), 'dam-494-'))
const storePath = path.join(DIR, 'event-store.json')
const readDisk = () => JSON.parse(readFileSync(storePath, 'utf8'))

console.log('=== A. 真 create({skills:[...]}) —— 公开数组契约 ===')
const evA = await eventStorePre.create(storePath, { name: '技能登记 A', skills: ['skill-a'] })
ok(evA.skills && Array.isArray(evA.skills.names) && evA.skills.names.length === 1 && evA.skills.names[0] === 'skill-a',
  'A-1 create 返回 names=[skill-a]', JSON.stringify(evA.skills))
ok(evA.skills.touched === true, 'A-2 create 返回 touched=true', String(evA.skills.touched))
ok(hasNumericKey(evA.skills) === false, 'A-3 ★返回值不含 "0"/"1" 数字脏键', Object.keys(evA.skills).join(','))
const dA = readDisk().events.find((e) => e.id === evA.id)
ok(dA && Array.isArray(dA.skills.names) && dA.skills.names[0] === 'skill-a', 'A-4 ★读盘 names=[skill-a]（不是内存态）', JSON.stringify(dA && dA.skills))
ok(dA && Object.keys(dA.skills).length === 3, 'A-5 磁盘 skills 恰好 3 个键', Object.keys(dA.skills).join(','))
ok(dA && hasNumericKey(dA.skills) === false, 'A-6 ★磁盘 skills 不含数字键')
const vA = validateEventPre(dA)
ok(vA.length === 0, 'A-7 写盘后 validateEventPre 仍通过（bad-skills 未削弱）', vA.join(',') || 'clean')

console.log('')
console.log('=== B. 真 set({skills:[...]}) —— set 路径同口径 ===')
const evB = await eventStorePre.set(storePath, evA.id, { skills: ['skill-a', 'skill-b'] })
ok(evB.skills.names.length === 2 && evB.skills.names[1] === 'skill-b', 'B-1 set 后 names=[skill-a,skill-b]', JSON.stringify(evB.skills.names))
ok(evB.skills.touched === true, 'B-2 set 后 touched=true')
const dB = readDisk().events.find((e) => e.id === evA.id)
ok(dB.skills.names.length === 2 && hasNumericKey(dB.skills) === false, 'B-3 ★磁盘 set 结果无数字键', Object.keys(dB.skills).join(','))

console.log('')
console.log('=== C. 空数组 ===')
const evC = await eventStorePre.create(storePath, { name: '技能登记 C', skills: [] })
ok(Array.isArray(evC.skills.names) && evC.skills.names.length === 0, 'C-1 空数组 ⇒ names=[]')
ok(evC.skills.touched === false, 'C-2 空数组 ⇒ touched=false（"没给条目"不是"提到技能库"）')

console.log('')
console.log('=== D. 对象形态（内部契约）仍可用 · 非字符串条目被过滤 ===')
const evD = await eventStorePre.create(storePath, { name: '技能登记 D', skills: { hitCount: 3, names: ['skill-x', 42, 'skill-y'], touched: true } })
ok(evD.skills.hitCount === 3 && evD.skills.names.length === 2 && evD.skills.names[1] === 'skill-y',
  'D-1 对象形态逐字段生效（非字符串条目被过滤）', JSON.stringify(evD.skills))
ok(validateEventPre(readDisk().events.find((e) => e.id === evD.id)).length === 0, 'D-2 对象形态落盘后校验通过')

console.log('')
console.log('=== E. 非法形状必须 fail-closed（修复前是静默吞掉）===')
const expectThrow = async (fn, name, keyword) => {
  let err = null
  try { await fn() } catch (e) { err = e }
  const msg = err ? String(err.message || err) : ''
  ok(!!err && msg.indexOf(keyword) >= 0, name, err ? msg.slice(0, 90) : '（没有抛错 = 静默吞掉，缺陷复现）')
}
await expectThrow(() => eventStorePre.create(storePath, { name: 'E 字符串', skills: 'not-an-object' }), 'E-1 ★字符串 skills 抛错', 'skills')
await expectThrow(() => eventStorePre.create(storePath, { name: 'E 数字', skills: 123 }), 'E-2 数字 skills 抛错', 'skills')
await expectThrow(() => eventStorePre.create(storePath, { name: 'E null', skills: null }), 'E-3 null skills 抛错', 'skills')
await expectThrow(() => eventStorePre.set(storePath, evA.id, { skills: 'oops' }), 'E-4 ★set 路径同样抛错', 'skills')

console.log('')
console.log('=== F. 对象字段类型非法必须抛错（不许静默重建）===')
await expectThrow(() => eventStorePre.create(storePath, { name: 'F names', skills: { names: 'a,b' } }), 'F-1 names 非数组抛错', 'skills.names')
await expectThrow(() => eventStorePre.create(storePath, { name: 'F hit', skills: { hitCount: 'many' } }), 'F-2 hitCount 非数字抛错', 'skills.hitCount')
await expectThrow(() => eventStorePre.create(storePath, { name: 'F touched', skills: { touched: 'yes' } }), 'F-3 touched 非布尔抛错', 'skills.touched')

console.log('')
console.log('=== G. 非法输入被拒后，库里没有半成品（fail-closed 不落盘）===')
const diskNow = readDisk()
ok(diskNow.events.length === 3, 'G-1 只有 A/C/D 三条成功事件，失败的 6 次未落盘', diskNow.events.length + ' 条')
ok(diskNow.events.every((e) => validateEventPre(e).length === 0), 'G-2 全库每条事件校验通过（无脏键幸存）')

console.log('')
console.log('=== H. ev4-adapter：真调 adaptEventPre，读真实 skills（不是硬编码 []）===')
const tk = Date.now()
const mkEv = (skills) => ({
  id: 'evt_0000abcd', name: 'H 适配', summary: 's', outcome: null, skillRef: null,
  status: 'active', pausedReason: null,
  sections: { goal: 'g', doing: 'd', deadend: '', next: 'n' },
  checkpoints: [{ at: tk, kind: 'log', text: '一行正文', panels: [] }],
  userPercept: [], agentTrace: [], sharedGround: [], commitments: [], constraints: [],
  createdAt: tk, updatedAt: tk, startMs: tk, endMs: tk, members: [], rationale: 'r',
  kind: 'ledger', confidence: 'high', outcomes: [], ordinal: 0, skills, idemTag: null,
})
const adH = ES.adaptEventPre(mkEv({ hitCount: 2, names: ['mem-skill-aaa'], touched: true }), 0)
ok(adH.skills && typeof adH.skills === 'object' && Array.isArray(adH.skills.names), 'H-1 adaptEventPre 输出 skills 对象', JSON.stringify(adH.skills))
const adNames = (x) => (Array.isArray(x && x.skills && x.skills.names) ? x.skills.names : [])
ok(adNames(adH).length === 1 && adNames(adH)[0] === 'mem-skill-aaa', 'H-2 ★输出真实 names（修复前恒为 []）', JSON.stringify(adH.skills))
ok(adH.skills.touched === true && adH.skills.hitCount === 2, 'H-3 touched/hitCount 透出', JSON.stringify(adH.skills))
const adEmpty = ES.adaptEventPre(mkEv({ hitCount: 0, names: [], touched: false }), 0)
ok(adNames(adEmpty).length === 0 && adEmpty.skills.touched === false, 'H-4 未涉及技能时仍为空（不伪造）', JSON.stringify(adEmpty.skills))
const adMissing = ES.adaptEventPre(mkEv(undefined), 0)
ok(adMissing.skills && Array.isArray(adMissing.skills.names) && adMissing.skills.names.length === 0, 'H-5 事件缺 skills 字段 ⇒ 回落空形状不抛', JSON.stringify(adMissing.skills))

console.log('')
console.log((fail === 0 ? 'PASS ' : 'FAIL ') + pass + ' / FAIL ' + fail)
try { rmSync(DIR, { recursive: true, force: true }) } catch (_) {}
process.exit(fail === 0 ? 0 : 1)

#!/usr/bin/env node
/**
 * smoke-test-v4-h1a-event-write.mjs —— H1-A：lib/event-write.js 行为验收
 *
 * 覆盖 memDateOfPre / resolveActiveEventPre / renderDayViewPre / deriveDayViewToDiskPre / createEventForWorkPre / appendCheckpointPre 六个函数。
 *
 * 来源：2026-10-25 由 A 线一次性验证脚本升格为永久回归套件（Lead 批准）。
 * 升格理由：这些断言是 v4-H 写入层的核心不变量，只放临时目录 ⇒ 下次谁改回去只有临时跑才发现。
 *
 * 纪律（CR-10）：真 import → 真构造 → 真调用 → 断言返回值/副作用；每条正向都配负路径。
 * 全部在仓库内的 .tmp-smoke-run/ 临时目录里跑（每次自清），不碰真实 handoff/ 与真实记忆目录。
 */
import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

import { fileURLToPath } from 'node:url'
const REPO = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const M = await import(pathToFileURL(path.join(REPO, 'lib/event-write.js')).href)
const ROOT = path.join(REPO, '.tmp-smoke-run/ew-test')
fs.rmSync(ROOT, { recursive: true, force: true })
fs.mkdirSync(ROOT, { recursive: true })

let pass = 0, fail = 0
function ok(cond, name, detail) {
  if (cond) { pass++; console.log('PASS ' + name + (detail ? '  =>  ' + detail : '')) }
  else { fail++; console.log('FAIL ' + name + (detail ? '  =>  ' + detail : '')) }
}

// ── 1. memDateOfPre：日界线（450 分钟 = 7:30）──
// 2026-10-24 06:00 本地 → 应归 2026-10-23
const t1 = new Date(2026, 9, 24, 6, 0, 0).getTime()
const t2 = new Date(2026, 9, 24, 8, 0, 0).getTime()
const t3 = new Date(2026, 9, 25, 0, 30, 0).getTime()
ok(M.memDateOfPre(t1, 450) === '2026-10-23', 'memDateOfPre 06:00 归前一天', M.memDateOfPre(t1, 450))
ok(M.memDateOfPre(t2, 450) === '2026-10-24', 'memDateOfPre 08:00 归当天', M.memDateOfPre(t2, 450))
ok(M.memDateOfPre(t3, 450) === '2026-10-24', 'memDateOfPre 次日00:30 归前一天', M.memDateOfPre(t3, 450))
ok(M.memDateOfPre(t1, 0) === '2026-10-24', 'boundary=0 时按自然日', M.memDateOfPre(t1, 0))
ok(M.memDateOfPre(t1, undefined) === '2026-10-23', 'boundary 缺省=450', M.memDateOfPre(t1, undefined))

// ── 2. resolveActiveEventPre ──
const mkStore = (evs) => ({ schema: 'v4_event_store_v1', events: evs, updatedAt: 0 })
const evA = { id: 'evt_aaaaaaaa', name: 'A', status: 'active', updatedAt: 100, checkpoints: [] }
const evB = { id: 'evt_bbbbbbbb', name: 'B', status: 'active', updatedAt: 200, checkpoints: [] }
const evC = { id: 'evt_cccccccc', name: 'C', status: 'closed', updatedAt: 300, checkpoints: [] }
ok(M.resolveActiveEventPre(mkStore([])) === null, '无事件 → null')
ok(M.resolveActiveEventPre(mkStore([evC])) === null, '只有 closed → null', JSON.stringify(M.resolveActiveEventPre(mkStore([evC]))))
ok(M.resolveActiveEventPre(mkStore([evA, evB])).id === 'evt_bbbbbbbb', '取 updatedAt 最大', M.resolveActiveEventPre(mkStore([evA, evB])).id)
ok(M.resolveActiveEventPre(mkStore([evB, evA])).id === 'evt_bbbbbbbb', '顺序无关（确定性）')
const tie1 = { id: 'evt_11111111', name: 'T1', status: 'active', updatedAt: 500, checkpoints: [] }
const tie2 = { id: 'evt_22222222', name: 'T2', status: 'active', updatedAt: 500, checkpoints: [] }
ok(M.resolveActiveEventPre(mkStore([tie2, tie1])).id === 'evt_11111111', 'updatedAt 并列时取 id 小者')

// ── 3. renderDayViewPre 纯函数性 + 格式 ──
function cp(at, kind, text) { return { at, kind, text, panels: [], idemKey: null } }
const store3 = mkStore([{
  id: 'evt_00000001', name: 'T', status: 'active', updatedAt: 1,
  checkpoints: [
    cp(new Date(2026, 9, 24, 9, 15).getTime(), 'log', '- 09:15 [kind:fact] 第二条'),
    cp(new Date(2026, 9, 24, 8, 5).getTime(), 'log', '- 08:05 [kind:fact] 第一条'),
    cp(new Date(2026, 9, 24, 10, 0).getTime(), 'handoff', '- 10:00 账本不该进日日志'),
    cp(new Date(2026, 9, 24, 11, 0).getTime(), 'progress', '- 11:00 进度不该进日日志'),
    cp(new Date(2026, 9, 23, 9, 0).getTime(), 'log', '- 昨天的不该出现'),
  ],
}])
const dv1 = M.renderDayViewPre(store3, '2026-10-24', 450)
const dv2 = M.renderDayViewPre(store3, '2026-10-24', 450)
ok(dv1 === dv2, 'renderDayViewPre 纯函数：两次调用字节相同')
ok(dv1.split('\n').filter(l => l.trim()).length === 2, '只投影当天 log 类（2 条）', JSON.stringify(dv1))
ok(dv1.indexOf('08:05') < dv1.indexOf('09:15'), '按时间升序')
ok(!dv1.includes('账本不该进'), 'handoff 被排除')
ok(!dv1.includes('进度不该进'), 'progress 被排除')
ok(!dv1.includes('昨天的不该出现'), '跨日被排除')
ok(/^- \d{2}:\d{2} \[kind:[a-z]+\] /m.test(dv1), '格式与 memory_log 一致')
ok(M.renderDayViewPre(mkStore([]), '2026-10-24', 450) === '', '空 store → 空串')
ok(M.renderDayViewPre(store3, '', 450) === '', '空 date → 空串')

// ── 4. 与 periodSummary / greeting 的正则兼容 ──
const RE = /^- (\d{2}):(\d{2}) (.*)$/
let parsed = 0
for (const l of dv1.split('\n').filter(x => x.trim().startsWith('- '))) if (RE.test(l)) parsed++
ok(parsed === 2, '与 periodSummary 正则 ^- \\d{2}:\\d{2} 兼容', parsed + '/2')
const stripped = dv1.split('\n').filter(l => l.trim().startsWith('- ')).map(l => l.replace(/^- \d{2}:\d{2} /, ''))
ok(stripped.every(x => x.length > 0), 'greeting 的 replace(/^- \\d{2}:\\d{2} /) 后非空')

// ── 5. deriveDayViewToDiskPre：增量对齐 + 幂等 ──
const logPath = path.join(ROOT, '2026-10-24.md')
let disk = ''
const io = {
  readText: async (p) => { try { return fs.readFileSync(p, 'utf8') } catch (_) { return '' } },
  appendText: async (p, text) => {
    // 模拟 MemoryDocumentStore：每次 append 生成一条新锚点（randomUUID 风格）
    const fakeId = 'mem_' + Math.random().toString(16).slice(2).padEnd(32, '0').slice(0, 32)
    const add = '<!-- memory:' + fakeId + ' -->\n\n' + text + '\n'
    fs.appendFileSync(p, add, 'utf8')
    return fs.readFileSync(p, 'utf8')
  },
}
const r1 = await M.deriveDayViewToDiskPre({ logPath }, store3, '2026-10-24', io, 450)
ok(r1.ok && r1.appended === 2, '首次派生：追加 2 条', JSON.stringify({ appended: r1.appended, skipped: r1.skipped }))
const afterFirst = fs.readFileSync(logPath, 'utf8')
const anchors1 = (afterFirst.match(/<!-- memory:mem_/g) || []).length
ok(anchors1 === 2, '首次派生生成 2 条锚点（模拟真实机制）', String(anchors1))

const r2 = await M.deriveDayViewToDiskPre({ logPath }, store3, '2026-10-24', io, 450)
ok(r2.appended === 0 && r2.skipped === 2, '重复派生：0 追加 / 2 跳过（幂等）', JSON.stringify({ appended: r2.appended, skipped: r2.skipped }))
const afterSecond = fs.readFileSync(logPath, 'utf8')
ok(afterFirst === afterSecond, '重复派生后字节完全相同')
const anchors2 = (afterSecond.match(/<!-- memory:mem_/g) || []).length
ok(anchors2 === anchors1, '重复派生不增加也不减少锚点', anchors1 + ' -> ' + anchors2)

// ── 6. 新增检查点后再派生：只追加新的 ──
store3.events[0].checkpoints.push(cp(new Date(2026, 9, 24, 12, 30).getTime(), 'log', '- 12:30 [kind:fact] 第三条'))
const r3 = await M.deriveDayViewToDiskPre({ logPath }, store3, '2026-10-24', io, 450)
ok(r3.appended === 1 && r3.skipped === 2, '新增一条后：只追加 1 条', JSON.stringify({ appended: r3.appended, skipped: r3.skipped }))
const afterThird = fs.readFileSync(logPath, 'utf8')
ok((afterThird.match(/<!-- memory:mem_/g) || []).length === 3, '锚点累计 3 条（既有未被破坏）')
ok(afterThird.includes('08:05') && afterThird.includes('09:15') && afterThird.includes('12:30'), '三条内容都在')

// ── 7. 关键：既有行不被删除/重排（模拟用户手写内容）──
fs.appendFileSync(logPath, '\n- 23:59 [kind:fact] 用户手工追加的一行\n', 'utf8')
const beforeManual = fs.readFileSync(logPath, 'utf8')
const r4 = await M.deriveDayViewToDiskPre({ logPath }, store3, '2026-10-24', io, 450)
const afterManual = fs.readFileSync(logPath, 'utf8')
ok(r4.appended === 0, '手工行存在时不重复追加')
ok(afterManual.includes('用户手工追加的一行'), '★手工追加的行未被删除')
ok(afterManual.startsWith(beforeManual.replace(/\s+$/, '')), '★既有内容前缀未被改动（不重写不重排）')

// ── 8. verifyDayViewConsistencyPre ──
const v1 = M.verifyDayViewConsistencyPre(afterManual, store3, '2026-10-24', 450)
ok(v1.consistent === true, '一致性校验：一致', JSON.stringify(v1.missing))
const v2 = M.verifyDayViewConsistencyPre('', store3, '2026-10-24', 450)
ok(v2.consistent === false && v2.missing.length === 3, '一致性校验：空文件时报告 3 条缺失')

// ── 9. createEventForWorkPre 真建事件（走真 event-store 写盘）──
const storePath = path.join(ROOT, 'event-store.json')
const created = await M.createEventForWorkPre(storePath, { name: '测试事件' })
ok(/^evt_[0-9a-f]{8}$/.test(created.id), 'createEventForWorkPre 生成合法 id', created.id)
const storeAfter = JSON.parse(fs.readFileSync(storePath, 'utf8'))
ok(storeAfter.events.length === 1 && storeAfter.events[0].name === '测试事件', '事件已落盘')

// ── 10. appendCheckpointPre 真追加 + 幂等 ──
const a1 = await M.appendCheckpointPre(storePath, created.id, { kind: 'log', text: '第一条', idemKey: 'k1' })
ok(a1.ok && a1.checkpointCount === 1 && !a1.deduped, 'appendCheckpointPre 追加成功', JSON.stringify(a1))
const a2 = await M.appendCheckpointPre(storePath, created.id, { kind: 'log', text: '第一条', idemKey: 'k1' })
ok(a2.deduped === true && a2.checkpointCount === 1, '★同 idemKey 重试 → deduped，不重复追加', JSON.stringify(a2))
const a3 = await M.appendCheckpointPre(storePath, created.id, { kind: 'log', text: '第二条', idemKey: 'k2' })
ok(a3.checkpointCount === 2, '不同 idemKey → 正常追加', JSON.stringify(a3))

// ── 11. 负路径：append 到不存在的事件必须抛错（不静默）──
let threw = false, errMsg = ''
try { await M.appendCheckpointPre(storePath, 'evt_deadbeef', { kind: 'log', text: 'x', idemKey: 'k9' }) }
catch (e) { threw = true; errMsg = String(e && e.message) }
ok(threw && /不存在/.test(errMsg), '★负路径：事件不存在 → 抛错（不静默）', errMsg.slice(0, 60))

// ── 12. 负路径：空 text 必须抛错 ──
let threw2 = false
try { await M.appendCheckpointPre(storePath, created.id, { kind: 'log', text: '   ' }) } catch (e) { threw2 = true }
ok(threw2, '★负路径：空 text → 抛错')

// ── 13. 负路径：io 缺 appendText 必须抛错 ──
let threw3 = false
try { await M.deriveDayViewToDiskPre({ logPath }, store3, '2026-10-24', { readText: async () => '' }, 450) } catch (e) { threw3 = true }
ok(threw3, '★负路径：io 不全 → 抛错')


// ══════════════════════════════════════════════════════════════
// ★Lead 追加的两条强化验收（2026-10-24 裁决）
// ══════════════════════════════════════════════════════════════

// ── ④ 防「静默不写」：有新检查点时，磁盘内容行数必须严格增加 ──
const ROOT2 = path.join(REPO, '.tmp-smoke-run/ew-test4')
fs.rmSync(ROOT2, { recursive: true, force: true })
fs.mkdirSync(ROOT2, { recursive: true })
const log4 = path.join(ROOT2, '2026-10-24.md')
const io4 = {
  readText: async (p) => { try { return fs.readFileSync(p, 'utf8') } catch (_) { return '' } },
  appendText: async (p, text) => {
    const fakeId = 'mem_' + Math.random().toString(16).slice(2).padEnd(32, '0').slice(0, 32)
    fs.appendFileSync(p, '<!-- memory:' + fakeId + ' -->\n\n' + text + '\n', 'utf8')
    return fs.readFileSync(p, 'utf8')
  },
}
function countContentLines(txt) {
  return String(txt || '').split('\n').filter(l => l.trim().startsWith('- ')).length
}
const store4 = mkStore([{ id: 'evt_44444444', name: 'T4', status: 'active', updatedAt: 1, checkpoints: [
  cp(new Date(2026, 9, 24, 9, 0).getTime(), 'log', '- 09:00 [kind:fact] A'),
] }])
await M.deriveDayViewToDiskPre({ logPath: log4 }, store4, '2026-10-24', io4, 450)
const n1 = countContentLines(fs.readFileSync(log4, 'utf8'))
store4.events[0].checkpoints.push(cp(new Date(2026, 9, 24, 10, 0).getTime(), 'log', '- 10:00 [kind:fact] B'))
const rFinal = await M.deriveDayViewToDiskPre({ logPath: log4 }, store4, '2026-10-24', io4, 450)
const n2 = countContentLines(fs.readFileSync(log4, 'utf8'))
ok(n2 === n1 + 1, '★④ 有新检查点时磁盘内容行数严格 +1（防静默不写）', n1 + ' -> ' + n2)
ok(rFinal.appended === 1, '★④ appended 计数与实际落盘一致', 'appended=' + rFinal.appended)

// ── ⑤ 防「锚点与内容错位」：新内容必须挂在最后一个锚点之后 ──
const txt5 = fs.readFileSync(log4, 'utf8')
const lines5 = txt5.split('\n')
let lastAnchorIdx = -1
for (let i = 0; i < lines5.length; i++) if (/<!-- memory:mem_[0-9a-f]{32} -->/.test(lines5[i])) lastAnchorIdx = i
ok(lastAnchorIdx >= 0, '★⑤ 存在锚点行', 'lastAnchorIdx=' + lastAnchorIdx)
// 最后一个锚点之后应能找到紧随的内容行（允许中间有空行）
let afterAnchorContent = ''
for (let i = lastAnchorIdx + 1; i < lines5.length; i++) {
  if (lines5[i].trim().startsWith('- ')) { afterAnchorContent = lines5[i].trim(); break }
}
ok(afterAnchorContent.includes('10:00'), '★⑤ 最后一个锚点之后是新增的内容行（归属未错位）', afterAnchorContent.slice(0, 60))
// 且每个锚点之后都有一条内容行（无 orphan anchor）
let orphan = 0
for (let i = 0; i < lines5.length; i++) {
  if (!/<!-- memory:mem_[0-9a-f]{32} -->/.test(lines5[i])) continue
  let found = false
  for (let j = i + 1; j < lines5.length; j++) {
    if (/<!-- memory:mem_[0-9a-f]{32} -->/.test(lines5[j])) break
    if (lines5[j].trim().startsWith('- ')) { found = true; break }
  }
  if (!found) orphan++
}
ok(orphan === 0, '★⑤ 无 orphan anchor（每个锚点后都有内容行）', 'orphan=' + orphan)
// 内容行顺序 = 时间升序（追加后仍有序）
const contentOrder = lines5.filter(l => l.trim().startsWith('- ')).map(l => l.trim())
ok(contentOrder[0].includes('09:00') && contentOrder[1].includes('10:00'), '★⑤ 追加后内容仍按时间升序', JSON.stringify(contentOrder))

console.log('')
console.log('TOTAL ' + (pass + fail) + '  PASS ' + pass + '  FAIL ' + fail)
process.exit(fail === 0 ? 0 : 1)
#!/usr/bin/env node
/** smoke-test-evidence-agg-pre —— M8-2b evidence→聚合→importance 管道 回归锁定(2026-09-09)。
 * 覆盖:纯函数+IO 注入(零内置 IO)/ 有界读取(7 天窗口+每文件末 400 行)/ 确定性 /
 * 输出形状 = computeImportancePre 输入契约 / correction 负向(口径复用)/ 损坏行跳过 /
 * io 抛错传播(调用方降级中性)/ 只读性(模块无写入)。
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { scanEvidenceEventsPre, aggregateEvidenceEventsPre, EVIDENCE_AGG_DEFAULTS_V1 } from '../../lib/evidence-agg.js'
import { computeImportancePre, IMPORTANCE_NEUTRAL_V1 } from '../../lib/memory-importance.js'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const SRC = readFileSync(path.resolve(HERE, '..', '..', 'lib', 'evidence-agg.js'), 'utf8')
let pass = 0, fail = 0
const ok = (c, n) => { if (c) { pass++; console.log('  ok -', n) } else { fail++; console.error('FAIL', n) } }
const FIXED_NOW = Date.UTC(2026, 8, 9, 12, 0, 0) // 2026-09-09 12:00Z
const day = (n) => new Date(FIXED_NOW - n * 86400000).toISOString().slice(0, 10) + '.jsonl'
const ev = (kind, mem, sessionRef, ts = FIXED_NOW) => JSON.stringify({ kind, memoryId: mem, event: { sessionRef, ts } })

const memId = (c) => 'mem_' + c.repeat(32)
const FILES = {
  [day(0)]: [ev('cite', memId('a'), 's1'), ev('cite', memId('a'), 's2'), ev('reuse', memId('a'), 's1'), 'broken-line{{{', ev('success', memId('a'), 's3')].join('\n'),
  [day(1)]: [ev('read', memId('a'), 's4'), ev('correction', memId('b'), 's1'), ev('seen', memId('b'), 's2'), ev('seen', memId('b'), 's3')].join('\n'),
  [day(30)]: [ev('reuse', memId('a'), 'sold')].join('\n'), // 超出 7 天窗口 → 不读
}
const io = {
  listFiles: () => Object.keys(FILES),
  readFile: (name) => { if (name === 'BOOM') throw new Error('io down'); return FILES[name] || '' },
}

console.log('[evidence-agg] G1 有界读取(7 天窗口 + 末 400 行)')
{
  const events = scanEvidenceEventsPre(io, { now: () => FIXED_NOW })
  const ids = new Set(events.map((e) => e.memoryId))
  ok(!ids.has(memId('a')) || events.every((e) => e.sessionRef === undefined), '扫描输出为原始事件(会话在 event 内)')
  ok(!events.some((e) => e.memoryId === undefined), '损坏行被跳过(无 undefined memoryId 事件)')
  const ev30 = events.filter((e) => e.kind === 'reuse' && e.event.sessionRef === 'sold')
  ok(ev30.length === 0, '30 天前文件不在窗口内(有界,不全量扫描)')
  assert.ok(events.length >= 7, '窗口内事件已读取(实际 ' + events.length + ')')
  ok(true, '窗口内 7+ 事件全部读出')
}
console.log('[evidence-agg] G2 聚合形状 = importance 输入契约')
{
  const events = scanEvidenceEventsPre(io, { now: () => FIXED_NOW })
  const agg = aggregateEvidenceEventsPre(events)
  const a = agg.get(memId('a'))
  assert.deepEqual(a, { distinctSessions: 4, seen: 0, read: 1, cite: 2, reuse: 1, success: 1, correction: 0 })
  ok(true, 'mem_a:六类计数 + distinctSessions=4(s1..s4 去重),无多余字段')
  const b = agg.get(memId('b'))
  assert.equal(b.correction, 1)
  ok(true, 'mem_b correction=1 计入')
  ok(!agg.has('nonexistent'), '无事件记忆不出现在聚合中(中性由 computeImportancePre 兜底)')
  const r1 = computeImportancePre(Object.fromEntries(Object.entries(a)))
  ok(r1.importance > IMPORTANCE_NEUTRAL_V1, '聚合直喂 importance:a 高于中性(' + r1.importance.toFixed(2) + ')')
}
console.log('[evidence-agg] G3 correction 负向(口径复用)')
{
  const events = scanEvidenceEventsPre(io, { now: () => FIXED_NOW })
  const agg = aggregateEvidenceEventsPre(events)
  const rb = computeImportancePre(agg.get(memId('b')))
  assert.ok(rb.correctionRate > 0 && rb.importance < IMPORTANCE_NEUTRAL_V1)
  ok(true, 'correction=1/total4 → corrRate .25 → importance ' + rb.importance.toFixed(2) + ' < 中性(负向生效,口径复用 promote)')
}
console.log('[evidence-agg] G4 确定性 + fail-soft 传播')
{
  const e1 = aggregateEvidenceEventsPre(scanEvidenceEventsPre(io, { now: () => FIXED_NOW }))
  const e2 = aggregateEvidenceEventsPre(scanEvidenceEventsPre(io, { now: () => FIXED_NOW }))
  assert.deepEqual([...e1.entries()], [...e2.entries()])
  ok(true, '同输入两次聚合 deepEqual(确定性)')
  let propagated = false
  try { scanEvidenceEventsPre({ listFiles: () => [day(0)], readFile: () => { throw new Error('io down') } }, { now: () => FIXED_NOW }) } catch (e) { propagated = true }
  ok(propagated, 'io 抛错向上传播(调用方 catch → 中性降级;模块不吞 IO 异常)')
}
console.log('[evidence-agg] G5 只读性与边界默认值')
ok(!/writeFile|appendFile|renameSync|mkdirSync|rmSync/.test(SRC), '模块零写入 API(只读)')
ok(EVIDENCE_AGG_DEFAULTS_V1.maxAgeDays === 7 && EVIDENCE_AGG_DEFAULTS_V1.maxLinesPerFile === 400, '默认有界参数 7 天/400 行(冻结)')
{
  // 400 行尾窗:500 行只取末 400
  const lines = Array.from({ length: 500 }, (_, i) => ev('seen', memId('z'), 's' + i))
  const files = { [day(0)]: lines.join('\n') }
  const events = scanEvidenceEventsPre({ listFiles: () => Object.keys(files), readFile: (n) => files[n] }, { now: () => FIXED_NOW })
  assert.equal(events.length, 400)
  ok(true, '每文件末 400 行生效(500 行输入 → 400 事件)')
}
console.log(`\n[evidence-agg] ${pass}/${pass + fail} assertions passed`)
if (fail) process.exit(1)

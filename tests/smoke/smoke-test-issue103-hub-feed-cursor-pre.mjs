/**
 * issue #103 回归锁：judgement-shadow 环形日志的增量游标。
 *
 * 缺陷形状：`judgement-shadow.jsonl` 由 Python 侧按**保尾丢弃**维护（SHADOW_LOG_MAX=256），
 * 而消费端旧实现用「行数」定位增量 —— 文件写满后 `lines.length` 恒等于上次的 `count`，
 * 增量区间恒为空 ⇒ 记忆中枢的学习面静默永久停摆，且不留一行日志。
 *
 * 设计纪律（本仓惯例）：每条断言都必须**能失败**。C2 直接并排跑「旧算法」作对照，
 * 因此把游标改回行数控法 ⇒ 本套件必红。
 *
 * 运行：node tests/smoke/smoke-test-issue103-hub-feed-cursor-pre.mjs
 */
import { createJsonlTailCursorPre } from '../../lib/jsonl-tail-cursor.js'
import { readFileSync } from 'node:fs'

let pass = 0
let fail = 0
const failures = []
function ok(cond, name) {
  if (cond) { pass++; console.log('  ok - ' + name) } else { fail++; console.error('  FAIL - ' + name) }
}

/** 模拟 Python 侧的保尾丢弃环：追加后裁到 RING 行。 */
const RING = 256
class RingLog {
  constructor(cap = RING) { this.cap = cap; this.lines = [] }
  append(...rows) {
    for (const r of rows) this.lines.push(JSON.stringify(r))
    if (this.lines.length > this.cap) this.lines = this.lines.slice(-this.cap)
    return this.snapshot()
  }
  snapshot() { return this.lines.slice() }
}

/** 旧算法（f05de04 的 hubFeedTick）：行数控法。用于「同一输入两把尺子」的对照。 */
function oldCountCursor(prev, lines) {
  const start = prev && lines.length >= prev.count ? prev.count : lines.length
  const fresh = lines.slice(start)
  return { next: { size: lines.length, count: lines.length }, fresh }
}

const row = (n) => ({ kindCandidate: 'fact', seq: n, sourceIds: ['mem_' + String(n).padStart(8, '0')] })

console.log('[C1] 冷启动只登记现状、不追喂（与旧口径一致）')
{
  const c = createJsonlTailCursorPre({ maxSeen: 1024 })
  const ring = new RingLog()
  for (let i = 0; i < 200; i++) ring.append(row(i))
  const r = c.take(ring.snapshot())
  ok(r.seeded === false, '首次 take 返回 seeded:false')
  ok(r.fresh.length === 0, '首次 take 一行都不交付（重启后不重复吃历史判据）')
  ok(c.stats().seenSize === 200, '现状 200 行全部登记进指纹表（seenSize=200）')
}

console.log('[C2] ★环形饱和后仍能取到新行（#103 主证据，并排跑旧算法作对照）')
{
  const c = createJsonlTailCursorPre({ maxSeen: 1024 })
  const ring = new RingLog()
  for (let i = 0; i < RING; i++) ring.append(row(i)) // 恰好写满环
  c.take(ring.snapshot()) // 冷启动登记
  let oldPrev = { size: RING, count: RING } // 旧实现在同一时点的游标状态
  const got = []
  for (let batch = 0; batch < 4; batch++) {
    const lines = ring.append(row(1000 + batch * 3), row(1001 + batch * 3), row(1002 + batch * 3))
    ok(lines.length === RING, `第 ${batch + 1} 批后环仍封顶 256 行（保尾丢弃）`)
    const r = c.take(lines)
    got.push(...r.fresh.map((l) => JSON.parse(l).seq))
    const o = oldCountCursor(oldPrev, lines)
    oldPrev = o.next
    if (batch === 3) {
      ok(o.fresh.length === 0, '★ 对照：同一输入下**旧行数控法**取到 0 行 ⇒ 旧实现确实停摆（改回旧算法本套件必红）')
    }
  }
  ok(got.length === 12, `新游标 4 批共交付 12 行（实得 ${got.length}）`)
  ok(got.join(',') === Array.from({ length: 12 }, (_, i) => 1000 + i).join(','), '交付的正是新写入的 12 行，顺序与内容一致')
}

console.log('[C3] 幂等：同一内容重复 take 不重复交付')
{
  const c = createJsonlTailCursorPre({ maxSeen: 1024 })
  const lines = [JSON.stringify(row(1)), JSON.stringify(row(2))]
  c.take(lines)
  ok(c.take(lines).fresh.length === 0, '未变化的文件再取 ⇒ 零新行')
  const withDup = lines.concat([JSON.stringify(row(2))])
  ok(c.take(withDup).fresh.length === 0, '环内出现逐字节相同的重复行 ⇒ 不视为新信息（跳过即幂等）')
}

console.log('[C4] 资源上界：长跑不使指纹表无界增长')
{
  const c = createJsonlTailCursorPre({ maxSeen: 1024 })
  const ring = new RingLog()
  for (let i = 0; i < RING; i++) ring.append(row(i))
  c.take(ring.snapshot())
  let total = 0
  for (let batch = 0; batch < 40; batch++) {
    const rows = []
    for (let k = 0; k < 25; k++) rows.push(row(10000 + batch * 25 + k))
    const r = c.take(ring.append(...rows))
    total += r.fresh.length
  }
  ok(total === 40 * 25, `1000 行新判据（40 批 × 25）全部被交付（实得 ${total}）`)
  ok(c.stats().seenSize <= 1024, `指纹表封顶 maxSeen（实得 ${c.stats().seenSize}）⇒ 无无界增长`)
}

console.log('[C5] maxSeen 小于环容量会重复交付（选型约束的证据，不是缺陷）')
{
  const c = createJsonlTailCursorPre({ maxSeen: 8 })
  const ring = new RingLog(64)
  for (let i = 0; i < 64; i++) ring.append(row(i))
  c.take(ring.snapshot())
  const r = c.take(ring.append(...Array.from({ length: 40 }, (_, i) => row(500 + i))))
  ok(c.stats().seenSize <= 8, '登记表按 maxSeen 淘汰')
  ok(r.fresh.length > 40,
    `★ 反例：maxSeen(8) < 环容量(64) 时，环内 16 行旧判据因指纹被淘汰而被**重复交付**（实得 fresh=${r.fresh.length} > 40 批内新行）`
    + ' ⇒ 故 maxSeen 必须 ≥ 环上限，本仓取 1024 = 256×4')
  ok(createJsonlTailCursorPre({ maxSeen: 1024 }).stats().maxSeen === 1024, '生产配置 maxSeen=1024 覆盖环上限 256')
}

console.log('[C6] 接线守卫：hubFeedTick 真用游标模块，且不再有行数控法与静默 return')
{
  const raw = readFileSync(new URL('../../lib/index.js', import.meta.url), 'utf8')
  const src = raw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '') // 去注释，防注释自证
  ok(/import \{ createJsonlTailCursorPre \} from '\.\/jsonl-tail-cursor\.js'/.test(src),
    "index.js 以裸名 import 游标模块（非 '-pre' 模块名）")
  const a = src.indexOf('const hubFeedTick = () => {')
  const b = src.indexOf('const hubFlushTick', a)
  ok(a > 0 && b > a, '已定位到 hubFeedTick 函数体（守卫范围）')
  const tick = src.slice(a, b)
  ok(/hubFeedCursor\.take\(lines\)/.test(tick), 'hubFeedTick 实际调用 take(lines)')
  ok(!/\.count\b/.test(tick) && !/lines\.length >=/.test(tick),
    '★ 函数体内不残留行数控法（守卫只圈 hubFeedTick，避免把通用的 prev.count 一并禁掉）')
  ok(/if \(!newRows\.length\) \{[\s\S]{0,300}?diagThrottled\('hub-feed-empty',\s*'\[降级\]/.test(tick),
    '★ 零新行分支必须打 [降级]（I7：绝不静默丢弃），不许裸 return')
  ok(/prev\.checked &&\s*prev\.size === st\.size/.test(tick) && !/prev\.seeded/.test(tick),
    'size/mtime 短路仍保留（零新读盘），但把门的是 checked 而非 seeded ⇒ 冷启动那轮不会被短路跳过')
}

console.log('\n--- issue #103 回归锁 ---')
console.log('pass=' + pass + ' fail=' + fail)
if (failures.length) { for (const f of failures) console.log('  ✗ ' + f) }
process.exit(fail ? 1 : 0)

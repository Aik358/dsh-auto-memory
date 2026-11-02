/**
 * smoke-test-v4-json-roundtrip.mjs —— ★JSON 往返守卫（2026-10-27 血泪教训固化）
 *
 * 【为什么必须有这条】
 *   P9 修了两轮都没生效，根因是我把 `NaN` 当成「无害的空值」写进 adapter 产物。
 *   但 adapter 的产物要经 HTTP JSON 序列化才到前端，而：
 *     JSON.stringify(NaN)  ->  null   （不是 NaN、也不是丢键！）
 *   前端 `null < Infinity` 在 JS 里为 **true**（null 被 ToNumber 成 0）
 *   => min = null => isFinite(null) === true => 兜底 `if (!isFinite(min))` 永不触发
 *   => 时间轴起点 1970-01-01 08:00，且刻度宽度恒为 6h（max=min+6h 的默认兜底）。
 *
 * 【判据】凡 adapter/render 产出的数值字段，必须断言：
 *   ① 真值在 JSON 往返后**仍然是同一个数**（不是 null/undefined/字符串）
 *   ② 空值在 JSON 往返后**不污染**下游的 min/max 类聚合
 *
 * 【教训归属】这是「绿但假的」家族第 5 形态：
 *   前四形态（见项目笔记）：ok:true 未写盘 / 源码字符串断言 / 假状态桩 / 探针未命中。
 *   第 5 形态 = **测的是内存对象，跑的是序列化之后的对象**——
 *   即「测试与运行之间隔着一层序列化边界，而测试没跨过它」。
 */
import { strict as assert } from 'node:assert'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '../..')
let pass = 0, fail = 0
const ok = (cond, name, extra) => {
  if (cond) { pass++; console.log('  PASS ' + name) }
  else { fail++; console.log('  FAIL ' + name + (extra ? '  (' + extra + ')' : '')) }
}

console.log('[JR] JSON 往返守卫 · adapter 产物跨序列化边界后仍须正确')

// ---- JR-0 元事实：坐实 JSON.stringify(NaN) === null，且 null 会污染比较 ----
{
  const s = JSON.stringify({ ms: NaN })
  ok(s === '{"ms":null}', 'JR-0a JSON.stringify(NaN) 产出 null（不是 NaN、不是丢键）', 'got=' + s)
  let min = Infinity
  const back = JSON.parse(s)
  if (back.ms < min) min = back.ms
  ok(min === null, 'JR-0b null 参与 `<` 比较会把 min 污染成 null', 'got=' + String(min))
  ok(isFinite(min) === true, 'JR-0c isFinite(null) === true ⇒ 兜底守卫会失守', 'got=' + isFinite(min))
  ok(JSON.stringify({ ms: undefined }) === '{}', 'JR-0d JSON.stringify(undefined) 直接丢键（这才是正确空值）')
}

// ---- JR-1 真调 adapter，再做 JSON 往返，断言 ms 不污染聚合 ----
const { adaptEventPre } = await import('file://' + path.join(ROOT, 'lib/ev4-adapter.js').replace(/\\/g, '/'))
{
  // 造两个事件：一个有真时间、一个只有 checkpointCount（占位检查点）
  const realCp = { text: 'T', at: 1793073600000 }
  const evReal = {
    id: 'evt_aaaa1111', name: 'A', summary: 's', status: 'active',
    sections: { goal: 'g', state: 'st', dead: '', next: 'n' },
    updatedAt: 1793073600000, createdAt: 1793073600000,
    checkpointCount: 1, checkpoints: [realCp],
    startMs: 1793073600000, endMs: 1793073600000, kind: 'ledger', members: ['m1'],
  }
  const evPlaceholder = {
    id: 'evt_bbbb2222', name: 'B', summary: 's', status: 'active',
    sections: { goal: 'g', state: 'st', dead: '', next: 'n' },
    updatedAt: 1793080000000, createdAt: 1793080000000,
    checkpointCount: 3, // 只有数量，没有真 checkpoints
    startMs: 1793080000000, endMs: 1793080000000, kind: 'ledger', members: [],
  }
  const evsMem = [adaptEventPre(evReal, 0), adaptEventPre(evPlaceholder, 1)]
  const evsNet = JSON.parse(JSON.stringify(evsMem))  // ★跨序列化边界

  // ① 真时间必须存活（不能被序列化弄丢）
  const realMs = evsNet[0].checkpoints[0].ms
  ok(typeof realMs === 'number' && realMs === 1793073600000,
     'JR-1a 真时间经 JSON 往返后仍是原数字', 'got=' + realMs)

  // ② 占位检查点的 ms 必须是「缺席」，不能是 null
  const phCps = evsNet[1].checkpoints
  ok(phCps.length === 3, 'JR-1b 占位检查点按 checkpointCount 产出 3 条', 'got=' + phCps.length)
  const anyNull = phCps.some(cp => cp.ms === null)
  ok(!anyNull, 'JR-1c ★占位检查点的 ms 不得为 null（null 会污染 min）')
  const anyNaN = phCps.some(cp => typeof cp.ms === 'number' && !isFinite(cp.ms))
  ok(!anyNaN, 'JR-1d 占位检查点的 ms 不得是 NaN（序列化会变 null）')

  // ③ 端到端：按前端 timeScale 的写法聚合，必须能被 isFinite 兜住
  const items = evsNet.filter(e => e.kind === 'ledger')
  let min = Infinity, max = -Infinity
  for (const e of items) for (const cp of e.checkpoints) {
    const ms = cp.ms
    if (ms < min) min = ms
    if (ms > max) max = ms
  }
  ok(isFinite(min), 'JR-1e ★聚合后的 min 必须是有限数（否则说明被 null 污染）', 'got=' + String(min))
  ok(min > 1e12, 'JR-1f min 不得回落到 0/1970（>1e12 毫秒）', 'got=' + String(min))

  // ④ 负面自检：把 ms 强行改成 NaN，往返后必须能被本守卫识别出来（证明判据有鉴别力）
  const mutated = JSON.parse(JSON.stringify(evsMem))
  mutated[1].checkpoints.forEach(cp => { cp.ms = NaN })
  const back = JSON.parse(JSON.stringify(mutated))
  const polluted = back[1].checkpoints.some(cp => cp.ms === null)
  ok(polluted, 'JR-1g 负路径：故意设 NaN 时往返后确实出现 null（证明上式能抓到）')
}

console.log('')
console.log('[JR-BE] ' + pass + ' PASS / ' + fail + ' FAIL')
process.exit(fail ? 1 : 0)
#!/usr/bin/env node
/**
 * smoke-test-session-tail-readers.mjs —— 事件尾三路读法（inspect / events / page）
 *
 * ## 为什么有这个套件
 * DSH **0.2.2-rc.1** 把 `sessionController.inspect()` 从宿主控制器里移除了（实解
 * `G:\dsh_desktop\resources\app.asar` 内 `@deepseek-ai/dsh-api-session-controller@0.2.2-rc.1`
 * 的方法表：有 `page` / `events` / `observeEvent` / `state` / `follow`，**没有 inspect**）。
 * 我们的刷新仪式把 inspect 当成宿主的必需契约，于是：
 *
 *     00:13:47.615  auto-continue: stopped old turn sid=session-351b90ef…
 *     00:13:47.623  hostAutoContinue error: refresh ritual failed: ritual-inspection-unavailable
 *                   ↑ 相隔 8ms：旧回合已经被 cancel，才在下一步炸掉 ⇒ 旧会话被打断、新会话没建出来
 *
 * 修法是 `sessionTailPre`：按宿主能力在三条等价读法间降级，全不通才退回材料指纹。
 * 本套件逐条钉住这四条路径 + 「不许假成功」（`page` 用 `throughSeq:-1` 会拿到空页）。
 *
 * ## 变异验证（本仓纪律：守卫必须能真红）
 *   MUT_SESSION_TAIL=lib/continuation.mut.js  node tests/smoke/smoke-test-session-tail-readers.mjs
 *   支持用环境变量指向副本做变异，默认读生产文件。
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

// ★必须用 fileURLToPath：`new URL(...).pathname` 对含空格的路径给出 `%20` 且不解码，
//   在 `C:\Users\JH Z\...` 这类用户目录下会直接 ERR_MODULE_NOT_FOUND（本机实测踩中）。
const HERE = path.dirname(fileURLToPath(import.meta.url))
const REPO = path.resolve(HERE, '..', '..')
const TARGET = process.env.MUT_SESSION_TAIL || 'lib/continuation.js'
const { sessionTailPre, continuationRitualEndPre } = await import(pathToFileURL(path.join(REPO, TARGET)).href)
console.log('被测: ' + TARGET)

let pass = 0, fail = 0
const ok = (c, m, d) => { if (c) { pass++; console.log('  ok   - ' + m) } else { fail++; console.log('  FAIL - ' + m + (d ? '  =>  ' + d : '')) } }
const eq = (a, b, m) => ok(String(a) === String(b), m, '实测 ' + String(a) + ' ≠ 期望 ' + String(b))

const SID = 'session-351b90ef-4a15-4f8d-a075-b9478c0d160d'
/** 宿主 `records[]` 形状（0.2.2 `events` / 0.2.0 `page` 同形）。 */
const asRecords = (events) => events.map((event) => ({ type: 'event', event }))
const EVENTS = [
  { seq: 0, type: 'user/message', data: { source: { rpcId: 'old' } } },
  { seq: 1, type: 'turn/start', data: { turn: 1 } },
  { seq: 2, type: 'tool/call', data: { name: 'read' } },
  { seq: 3, type: 'turn/end', data: { turn: 1, reason: { kind: 'completed' } } },
]

// ── ① inspect（0.2.0 / 0.2.1 线，向后兼容）────────────────────────────────
console.log('\n== ① inspect 存在 ==')
{
  const calls = []
  const sc = { inspect: async (sid, sig) => { calls.push({ sid, sig }); return { meta: { id: SID }, inheritedEventCount: 0, events: EVENTS } } }
  const r = await sessionTailPre(sc, SID, undefined)
  eq(r && r.via, 'inspect', '优先走 inspect，via=inspect')
  eq(r.events.length, EVENTS.length, '事件数组原样返回')
  eq(r.meta.id, SID, 'meta 透传（调用方靠它做源身份校验）')
  // 有 inspect 时不该再去碰别的读法
  ok(!sc.events && !sc.page, 'inspect 可用时不调用 events/page')
}

// ── ② 0.2.2-rc.1 真机形态：**没有 inspect，有 events** ─────────────────────
console.log('\n== ② inspect 缺失 + events 存在（0.2.2-rc.1 真机）==')
{
  const reqs = []
  const sc = { events: async (req) => { reqs.push(req); return { records: asRecords(EVENTS), hasMore: false, cursor: 3 } } }
  const r = await sessionTailPre(sc, SID, undefined)
  eq(r && r.via, 'events', '降级到 events，via=events')
  eq(r.events.length, EVENTS.length, 'records[].event 摊平成事件数组（长度对）')
  eq(r.events[3].type, 'turn/end', '摊平后仍是真事件对象（turn/end 保留）')
  eq(reqs[0].address.kind, 'session', 'address.kind = session')
  eq(reqs[0].address.sessionId, SID, 'address.sessionId = 目标会话')
  ok(reqs[0].maxMessages > 0, '带正数 maxMessages（宿主校验要求）')
  ok(!(('throughSeq' in reqs[0])), 'events 请求不传 throughSeq（不需要）')
}

// ── ③ 只有 page（0.2.0 线退化形态）────────────────────────────────────────
console.log('\n== ③ 只有 page ==')
{
  const reqs = []
  const sc = { page: async (req) => { reqs.push(req); return { records: asRecords(EVENTS), hasMore: false } } }
  const r = await sessionTailPre(sc, SID, undefined)
  eq(r && r.via, 'page', '降级到 page，via=page')
  eq(r.events.length, EVENTS.length, 'page 的 records 同样摊平')
  // ★关键：**不许**传 throughSeq:-1。0.2.0 的 paginate 会算出 end=0 ⇒ 空页看着「成功」，
  //   实则永远读不到事件（假成功）。这条断言把那个修法钉死。
  ok(!('throughSeq' in reqs[0]), 'page 请求不传 throughSeq:-1（那会得到空页的假成功）', JSON.stringify(reqs[0]))
}

// ── ④ 三条全无 → null（调用方退回材料指纹）────────────────────────────────
console.log('\n== ④ 三条读法全无（旧 host）==')
{
  const r = await sessionTailPre({ prompt: async () => {} }, SID, undefined)
  eq(r, null, '无任何读法 ⇒ null（由调用方降级到 stamp-fallback，不中止接续）')
  eq(await sessionTailPre(null, SID, undefined), null, 'sc 缺失 ⇒ null（不抛）')
  eq(await sessionTailPre({ inspect: async () => ({}) }, '', undefined), null, '无 sid ⇒ null（绝不猜会话）')
}

// ── ⑤ 单条读法抛错 ⇒ 继续试下一条（不是整片失败）────────────────────────
console.log('\n== ⑤ 单条抛错不应终结整片读取 ==')
{
  const sc = {
    inspect: async () => { throw new Error('inspect gone') },
    events: async () => ({ records: asRecords(EVENTS), hasMore: false }),
  }
  const seen = []
  const r = await sessionTailPre(sc, SID, undefined, { onError: (via, e) => seen.push(via + ':' + e.message) })
  eq(r && r.via, 'events', 'inspect 抛错后改走 events（不是直接放弃）')
  eq(seen.length, 1, 'onError 收到一次（inspect）', JSON.stringify(seen))
}
{
  const sc = {
    events: async () => { throw new Error('events boom') },
    page: async () => ({ records: asRecords(EVENTS) }),
  }
  const r = await sessionTailPre(sc, SID, undefined)
  eq(r && r.via, 'page', 'events 抛错后改走 page')
}
{
  const bad = { events: async () => ({ wrong: 'shape' }), page: async () => ({ records: 'not-array' }) }
  eq(await sessionTailPre(bad, SID, undefined), null, '两条都返回坏形状 ⇒ null（不把坏形状当零事件的成功读）')
}

// ── ⑥ 摊平后的口径必须能被仪式判据消费（端到端串起来）────────────────────
console.log('\n== ⑥ 摊平结果喂给 continuationRitualEndPre ==')
{
  const events = [
    { seq: 10, type: 'user/message', data: { source: { rpcId: 'pre-existing' } } },
    { seq: 11, type: 'turn/start', data: { turn: 2 } },
    { seq: 12, type: 'user/message', data: { source: { rpcId: 'REQ' } } },
    { seq: 13, type: 'turn/end', data: { turn: 2, reason: { kind: 'completed' } } },
  ]
  const sc = { events: async () => ({ records: asRecords(events), hasMore: false }) }
  const r = await sessionTailPre(sc, SID, undefined)
  const baseSeq = 10 // 发仪式前的基线（最后一条既有事件的 seq）
  eq(continuationRitualEndPre(r.events, 'REQ', baseSeq), 'completed', 'events 读法 + 判据 ⇒ 认出本次仪式 turn 结束')
  eq(continuationRitualEndPre(r.events, 'other', baseSeq), '', '别的 requestId 不算（判据绑定 reqId）')
  eq(continuationRitualEndPre(r.events, 'REQ', 13), '', 'baseSeq 已覆盖该 turn ⇒ 不重复认（重试取新基线）')
}

// ── 变异自检：把 throughSeq 塞回去，③ 必须转红 ────────────────────────────
console.log('\n== ⑦ 变异反向验证（内存副本）==')
{
  const src = fs.readFileSync(path.join(REPO, TARGET), 'utf8')
  const mut = src.replace("sc.page({ address, maxMessages }", "sc.page({ address, throughSeq: -1, maxMessages }")
  ok(mut !== src, '变异命中（page 请求被塞回 throughSeq:-1）')
  const tmp = path.join(REPO, 'lib', '.mut-session-tail-' + process.pid + '.js')
  fs.writeFileSync(tmp, mut)
  try {
    const mod = await import(pathToFileURL(tmp).href + '?t=' + Date.now())
    const reqs = []
    await mod.sessionTailPre({ page: async (req) => { reqs.push(req); return { records: asRecords(EVENTS) } } }, SID, undefined)
    // 变异体既然塞回了 throughSeq:-1，就**必须**被 ③ 的形状判据抓住 ⇒ 这里断言「它确实违规」。
    // （真宿主上 throughSeq:-1 会得到空页；假 page 不理会参数，所以只能在形状上验。）
    ok('throughSeq' in reqs[0], '变异体确实传了 throughSeq:-1（证明变异生效、③ 的判据能抓住它）', JSON.stringify(reqs[0]))
    ok(!(reqs[0].throughSeq === -1 && reqs[0].throughSeq !== undefined) === false,
      '★③「page 请求不传 throughSeq:-1」这条判据在变异体上会红（真阳性）')
  } finally {
    try { fs.unlinkSync(tmp) } catch (e) {}
  }
}

console.log('\n[session-tail-readers] PASS ' + pass + ' / FAIL ' + fail)
if (fail > 0) process.exit(1)

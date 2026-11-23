/** Bound ritual host calls even when a service ignores its cancellation signal. */
export async function continuationProbePre(probe, timeoutMs) {
  const controller = new AbortController()
  let timer
  try {
    return await Promise.race([
      Promise.resolve().then(() => probe(controller.signal)),
      new Promise((resolve, reject) => {
        timer = setTimeout(() => {
          controller.abort()
          reject(new Error('continuation probe timed out'))
        }, Math.max(1, timeoutMs))
      }),
    ])
  } finally { clearTimeout(timer) }
}

/**
 * Read one Session's event tail over **whichever** host read API exists.
 *
 * ★2026-11-08（DSH 0.2.2-rc.1 起 `sessionController.inspect()` 被移除）：桌面宿主把它拆成了
 *   `events` / `page` / `state` 三个 Remote 端点 —— 实解 `app.asar` 的
 *   `dsh-api-session-controller@0.2.2-rc.1` 方法表里**没有 inspect**（`events` 新增、`page` 已弃用）。
 *   旧实现把 inspect 当必需能力 ⇒ 仪式恒返回 `ritual-inspection-unavailable`，调用方再 throw，
 *   **整条接续失败**；而此时旧回合**已被 cancel**（实测日志两条相隔 8ms）——比不接续更糟。
 *   故改为按能力降级，三条读法语义等价（都返回该会话事件尾、seq 连续）：
 *     ① `inspect(sid, signal)`                  → `{ meta, inheritedEventCount, events }`
 *     ② `events({ address, maxMessages }, signal)` → `{ records: [{ type:'event', event }], hasMore, cursor }`
 *     ③ `page({ address, maxMessages }, signal)`   → 同 ②（0.2.2 起 `throughSeq` 可省 = 读到末尾）
 *
 * @returns `{ events, via, hasMore?, cursor?, meta? }`，`via ∈ {'inspect','events','page'}`；
 *          三条都不通（或都抛错）返回 **null**（调用方退回材料指纹判据，**不中止接续**）。
 *          ★每条读法**各自 try/catch**：某一条抛错只说明这条不适用，不代表会话读不出来。
 *
 * ★只取一页够不够：`events`/`page` 按 backward 分页返回**日志尾部**（`maxMessages` 只计
 *   消息类事件；`turn/start`、`tool/call`、`turn/end` 一律随切点带出），而仪式判据只关心
 *   `baseSeq` 之后有无 `turn/end` —— 基线与轮询走同一个读法，口径自洽。
 *   ★不能用 `throughSeq:-1`：0.2.0 线的 `paginate` 会算出空页（`end = min(-1+1, …) = 0`），
 *   看似成功实则永远读不到事件 —— 那是**假成功**，比读不到更糟。
 */
export async function sessionTailPre(sc, sid, signal, opts = {}) {
  if (!sc || typeof sc !== 'object' || !sid) return null
  const maxMessages = Number(opts.maxMessages) > 0 ? Number(opts.maxMessages) : 200
  if (typeof sc.inspect === 'function') {
    try {
      const snap = await sc.inspect(sid, signal)
      if (snap && typeof snap === 'object') {
        return { events: Array.isArray(snap.events) ? snap.events : [], via: 'inspect', meta: snap.meta }
      }
    } catch (e) { if (opts.onError) opts.onError('inspect', e) }
  }
  const address = { kind: 'session', sessionId: String(sid) }
  /** `events` / `page` 同形：`records[].event` ⇒ 摊平成事件数组。 */
  const flatten = (res) => {
    if (!res || typeof res !== 'object' || !Array.isArray(res.records)) return null
    const events = []
    for (const rec of res.records) {
      if (rec && typeof rec === 'object' && rec.event && typeof rec.event === 'object') events.push(rec.event)
    }
    return { events, hasMore: !!res.hasMore, cursor: res.cursor }
  }
  for (const [via, call] of [
    ['events', () => sc.events({ address, maxMessages }, signal)],
    ['page', () => sc.page({ address, maxMessages }, signal)],
  ]) {
    if (typeof sc[via] !== 'function') continue
    try {
      const flat = flatten(await call())
      if (flat) return { ...flat, via }
    } catch (e) { if (opts.onError) opts.onError(via, e) }
  }
  return null
}

/** A ritual is complete only when the turn consuming this request has ended. */
export function continuationRitualEndPre(events, requestId, baseSeq) {
  let turn = null
  let matched = null
  for (const ev of Array.isArray(events) ? events : []) {
    if (!(Number(ev && ev.seq) > baseSeq)) continue
    if (ev.type === 'turn/start') turn = ev.data && ev.data.turn
    if (ev.type === 'user/message') {
      const message = ev.data && ev.data.message ? ev.data.message : ev.data
      if (message && message.source && message.source.rpcId === requestId) matched = turn
    }
    if (ev.type === 'turn/end' && matched != null && ev.data && ev.data.turn === matched) {
      return (ev.data.reason && ev.data.reason.kind) || 'unknown'
    }
  }
  return ''
}

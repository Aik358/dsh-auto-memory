/**
 * smoke-test-a10-episode-text-cap.mjs —— issue #430 功能验收(零 IO 纯函数)。
 *
 * 缺陷(修复前):userTexts / assistantTexts 是**派生投影**,却按「每段必有一条」的假设与
 * segments 同步 shift;而 push 只在文本非空时发生(纯 tool/reasoning 段不产生文本)⇒ 基数天然
 * 不同 ⇒ 一旦超 segmentCap 开始 shift,两个数组与 segments **永久错位**。
 * 实测:63 条 assistant + 第 64 条 user「目标:把回归跑绿」+ 两次超 cap ⇒ segments=64,
 * userTexts=[] —— 用户段仍在 segments 里,但 intent 变空、用户目标从续接材料里消失。
 *
 * 本套件纪律(CR-10):真 import → 真构造 → 真调用 → 断言返回值;
 * 正路径锁「逐条对应」,负路径锁「不抛 / 兼容旧快照 / cap=1 同步 / snapshot 往返一致」。
 */
import { createEpisodicStorePre, EPISODE_SEGMENT_CAP_PRE_V1 } from '../../lib/episodic-store.js'

let pass = 0
let fail = 0
const ok = (cond, name, extra) => {
  if (cond) { pass++; console.log('  ok - ' + name + (extra === undefined ? '' : ' (' + extra + ')')) }
  else { fail++; console.error('  FAIL - ' + name + (extra === undefined ? '' : ' 实得 ' + JSON.stringify(extra))) }
}
const now = () => 1000000
const memIO = () => ({ save() {}, load() { return null }, clear() {} })

console.log('[A10-1] 正路径:#430 实测形态 —— 63 assistant + 用户目标 + 两次超 cap')
{
  const st = createEpisodicStorePre({ now })
  // 63 条 assistant 把缓冲顶到 cap-1
  for (let i = 0; i < 63; i++) st.append({ kind: 'assistant', assistantText: 'ok-' + i, sessionRef: 's1', eventSeq: i })
  // 第 64 条 = 用户目标(修复前它会在超 cap 后被挤出 userTexts)
  st.append({ kind: 'user', userText: '目标：把回归跑绿', sessionRef: 's1', eventSeq: 63 })
  st.append({ kind: 'assistant', assistantText: 'a64', sessionRef: 's1', eventSeq: 64 })
  st.append({ kind: 'assistant', assistantText: 'a65', sessionRef: 's1', eventSeq: 65 })
  const snap = st.snapshot()
  ok(snap.current.segments.length === EPISODE_SEGMENT_CAP_PRE_V1, '缓冲被 cap 压到 ' + EPISODE_SEGMENT_CAP_PRE_V1, snap.current.segments.length)
  // ★核心:用户目标仍在投影里(修复前 userTexts=[])
  ok(snap.current.userTexts.length === 1 && snap.current.userTexts[0] === '目标：把回归跑绿',
    '★正路径①:超 cap 后用户文本仍在投影里(修复前为空)', JSON.stringify(snap.current.userTexts))
  ok(snap.current.assistantTexts.length === EPISODE_SEGMENT_CAP_PRE_V1 - 1,
    '★正路径②:assistant 投影条数与 segments 里的 assistant 段数一致', snap.current.assistantTexts.length)
  // ★逐条对应:从 segments 推出的非空文本必须与 snapshot 里的投影**逐条相等**
  const derivedU = snap.current.segments.map((s) => String(s.userText || '').trim()).filter(Boolean)
  const derivedA = snap.current.segments.map((s) => String(s.assistantText || '').trim()).filter(Boolean)
  ok(JSON.stringify(derivedU) === JSON.stringify(snap.current.userTexts), '★正路径③:userTexts 与 segments 逐条对应(长度与文本都相等)', JSON.stringify(snap.current.userTexts))
  ok(JSON.stringify(derivedA) === JSON.stringify(snap.current.assistantTexts), '★正路径③:assistantTexts 与 segments 逐条对应', derivedA.length)
  // ★用户目标必须真正进入 intent
  const c = st.consolidate()
  ok(c.ok && c.episode.intent === '目标：把回归跑绿', '★正路径④:intent 取回用户目标(修复前为空)', c.ok ? c.episode.intent : c.reason)
  ok(c.ok && c.episode.entities.length > 0, '正路径④:entities 由用户文本派生(非空)', c.ok ? c.episode.entities.length : 0)
}

console.log('[A10-2] 正路径:cap=4 混合序列 ⇒ 投影与 segments 逐条对应')
{
  // ★夹具说明:纯 { kind:'tool' } 无文本段会被 validateEpisodeSegmentPre 以 no-text 拒绝
  //   (不会进缓冲),因此「基数不同」的真实来源是**只有 assistantText 的段**(#430 实测形态:
  //   63 条 assistant)—— 它们进 segments 但不进 userTexts。故混合序列 = 用户段 + 纯助手段。
  const st = createEpisodicStorePre({ now, config: { segmentCap: 4 } })
  const seq = [
    { kind: 'user', userText: 'u1 你好吗？' },
    { kind: 'assistant', assistantText: 'a1 完成' },
    { kind: 'assistant', assistantText: 'a1b 补充' },   // ← 纯助手段:只进 segments,不进 userTexts
    { kind: 'user', userText: 'u2 还没好？' },
    { kind: 'assistant', assistantText: 'a2 报错了' },
    { kind: 'assistant', assistantText: 'a2b 再补' },
  ]
  for (let i = 0; i < seq.length; i++) st.append(Object.assign({ sessionRef: 'x', eventSeq: i }, seq[i]))
  const cur = st.snapshot().current
  ok(cur.segments.length === 4, 'cap=4 ⇒ 缓冲恰好 4 段(6 段进、丢最旧 2 段)', cur.segments.length)
  const segU = cur.segments.map((s) => String(s.userText || '').trim()).filter(Boolean)
  const segA = cur.segments.map((s) => String(s.assistantText || '').trim()).filter(Boolean)
  ok(JSON.stringify(cur.userTexts) === JSON.stringify(segU), '★cap=4:userTexts 与 segments 逐条一致', JSON.stringify({ got: cur.userTexts, seg: segU }))
  ok(JSON.stringify(cur.assistantTexts) === JSON.stringify(segA), '★cap=4:assistantTexts 与 segments 逐条一致', JSON.stringify({ got: cur.assistantTexts, seg: segA }))
  // 投影里**不得**出现已被 cap 丢掉的最旧段文本
  ok(cur.userTexts.indexOf('u1 你好吗？') === -1, '★cap=4:被裁掉的最旧段文本不在投影里(单一真源)', JSON.stringify(cur.userTexts))
  ok(cur.assistantTexts.indexOf('a1 完成') === -1, '★cap=4:被裁掉的最旧助手文本同样不在投影里', JSON.stringify(cur.assistantTexts))
  // ★关键对照:同一序列在「未超 cap」时两者本应一致 —— 现在超 cap 后仍然一致(这才是本 issue 的核心)
  ok(cur.userTexts.length === 1 && cur.userTexts[0] === 'u2 还没好？', '★cap=4:唯一保留的用户段就是 u2', JSON.stringify(cur.userTexts))
}

console.log('[A10-3] 负路径①:纯 assistant ⇒ intent 空、不抛')
{
  const st = createEpisodicStorePre({ now })
  st.append({ kind: 'assistant', assistantText: '完成', sessionRef: 'y', eventSeq: 1 })
  st.append({ kind: 'assistant', assistantText: '好了', sessionRef: 'y', eventSeq: 2 })
  let threw = false
  let c = null
  try { c = st.consolidate() } catch (e) { threw = true }
  ok(!threw, '★负路径①:纯 assistant 巩固不抛')
  ok(c && c.ok && c.episode.intent === '', '★负路径①:无用户文本 ⇒ intent 为空串(不编造)', c && c.ok ? JSON.stringify(c.episode.intent) : c)
  ok(c && c.ok && c.episode.unresolved.length === 0, '负路径①:无用户文本 ⇒ unresolved 为空数组')
  ok(c && c.ok && c.episode.outcome === 'success', '负路径①:outcome 仍从 assistant 文本推断', c && c.ok ? c.episode.outcome : '')
  // 含问句的用户文本 ⇒ unresolved 才有内容(证明投影确实被读到,不是恒空)
  const st2 = createEpisodicStorePre({ now })
  st2.append({ kind: 'user', userText: '这个能跑通吗？', sessionRef: 'y2', eventSeq: 1 })
  st2.append({ kind: 'assistant', assistantText: 'ok', sessionRef: 'y2', eventSeq: 2 })
  const c2 = st2.consolidate()
  ok(c2.ok && c2.episode.unresolved.length === 1, '负路径①:对照 —— 有问句时 unresolved 恰好 1 条(证明不是恒空)', c2.ok ? JSON.stringify(c2.episode.unresolved) : c2)
}

console.log('[A10-4] 负路径②:旧快照缺投影字段 ⇒ restore 不丢 current、派生值重算')
{
  const io = memIO()
  const st = createEpisodicStorePre({ io, now })
  // 旧版本快照:**只有 segments,没有 userTexts/assistantTexts**(旧实现会因形状校验而整条丢弃)
  const legacy = {
    schemaVersion: 1, episodes: [],
    current: { sessionRef: 's-legacy', startedAt: 42, segments: [
      { kind: 'user', eventSeq: 1, userText: '旧快照里的用户目标' },
      { kind: 'assistant', eventSeq: 2, assistantText: '已完成' },
    ] },
  }
  const r = st.restore(legacy)
  ok(r.ok === true, '★负路径②:旧快照 restore 成功')
  ok(st.hasCurrent === true, '★负路径②:缺投影字段不得丢弃 current(修复前 restoreCurrentPre 直接 return null)', st.hasCurrent)
  // 空值安全:current 被丢弃时(变异实验/真回退)这里要**报红而不是抛崩**,否则拿不到可复算的
  // FAIL 计数(本仓纪律:跑不红的断言等于没有断言,崩掉的套件同样给不出数值)。
  const snap = st.snapshot()
  const cur0 = snap.current || { userTexts: null, assistantTexts: null, segments: null }
  ok(JSON.stringify(cur0.userTexts) === JSON.stringify(['旧快照里的用户目标']), '★负路径②:恢复后投影由 segments 重算', JSON.stringify(cur0.userTexts))
  ok(JSON.stringify(cur0.assistantTexts) === JSON.stringify(['已完成']), '负路径②:assistant 投影同样重算', JSON.stringify(cur0.assistantTexts))
  const c = st.consolidate()
  ok(c.ok && c.episode.intent === '旧快照里的用户目标', '负路径②:恢复后可正常巩固且 intent 正确', c.ok ? c.episode.intent : c.reason)
  // 但**明显非法**的投影类型仍必须拒绝(形状校验不放水)
  const st2 = createEpisodicStorePre({ io: memIO(), now })
  st2.restore({ schemaVersion: 1, episodes: [], current: { sessionRef: 's-bad', startedAt: 1, segments: [], userTexts: 'not-an-array' } })
  ok(st2.hasCurrent === false, '★负路径②:投影给了但类型非法(非数组)⇒ 仍置 null(校验不放水)')
  const st3 = createEpisodicStorePre({ io: memIO(), now })
  st3.restore({ schemaVersion: 1, episodes: [], current: { sessionRef: 's-bad2', startedAt: 1 } })
  ok(st3.hasCurrent === false, '★负路径②:segments 缺失(唯一真源)⇒ 仍置 null')
}

console.log('[A10-5] 负路径③:cap=1 ⇒ 投影同步为 1')
{
  const st = createEpisodicStorePre({ now, config: { segmentCap: 1 } })
  st.append({ kind: 'user', userText: 'first', sessionRef: 'z', eventSeq: 1 })
  st.append({ kind: 'user', userText: 'second', sessionRef: 'z', eventSeq: 2 })
  const cur = st.snapshot().current
  ok(cur.segments.length === 1, '★cap=1:segments 恰好 1', cur.segments.length)
  ok(cur.userTexts.length === 1 && cur.userTexts[0] === 'second', '★cap=1:userTexts 同步为 1 且是最新那条', JSON.stringify(cur.userTexts))
  ok(cur.segments[0].userText === 'second', '负路径③:保留的是最新段', cur.segments[0].userText)
}

console.log('[A10-6] 负路径④:restore 后 snapshot 仍一致(防破坏 #57 形状门)')
{
  const io = memIO()
  const st = createEpisodicStorePre({ io, now })
  st.append({ kind: 'user', userText: 'u', sessionRef: 'r1', eventSeq: 1 })
  st.append({ kind: 'assistant', assistantText: 'a', sessionRef: 'r1', eventSeq: 2 })
  const snap1 = st.snapshot()
  // 落盘 → 恢复到新实例 → 再快照:current 的三数组必须逐条一致
  const st2 = createEpisodicStorePre({ io: memIO(), now })
  const r = st2.restore(JSON.parse(JSON.stringify(snap1)))
  ok(r.ok === true, '★负路径④:快照往返 restore 成功')
  const snap2 = st2.snapshot()
  ok(JSON.stringify(snap1.current.segments) === JSON.stringify(snap2.current.segments), '★负路径④:往返后 segments 逐条一致')
  ok(JSON.stringify(snap1.current.userTexts) === JSON.stringify(snap2.current.userTexts), '★负路径④:往返后 userTexts 一致')
  ok(JSON.stringify(snap1.current.assistantTexts) === JSON.stringify(snap2.current.assistantTexts), '★负路径④:往返后 assistantTexts 一致')
  // 快照必须**保留** userTexts/assistantTexts 字段(兼容旧读取方 + 既有源码守卫 issue55-58:203)
  ok(Array.isArray(snap1.current.userTexts) && Array.isArray(snap1.current.assistantTexts),
    '★负路径④:snapshot 仍序列化 userTexts/assistantTexts 字段(兼容旧快照,不得删除)')
}

console.log(String.fromCharCode(10) + '[a10] ' + pass + ' passed, ' + fail + ' failed')
process.exit(fail === 0 ? 0 : 1)
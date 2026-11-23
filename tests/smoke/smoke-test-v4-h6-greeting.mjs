#!/usr/bin/env node
/**
 * smoke-test-v4-h6-greeting.mjs —— v4-H6：问候环节改造（读事件摘要 + 未完成承诺）。
 *
 * ★本套件要防的四类假绿：
 *   ① 只测「有事件时含事件名」⇒ 半条判据。必须同时证「kept 承诺不计入」（Lead 断言 ③）
 *   ② 只造数测渲染 ⇒ 不跑 enforceChannelCapPre，永远发现不了「整段被区 III 限额丢弃」
 *   ③ 阈值写死 30/60 分钟测 ⇒ 将来有人硬编码，测试全绿但功能不听配置（Lead 断言 ⑥）
 *   ④ 只测「改后长度」⇒ 不证「改前会红」，即没有鉴别力（Lead 特别表扬的做法）
 *
 * ★区 III 实测水位（2026-10-25，可复现）：
 *   CHANNEL_ZONE_MAX_CHARS = 300
 *   water-advisory   = 273（1 前导\n + 18 标题 + 1 分隔\n + 253 正文，pct 渲染后）
 *   event-unarchived = 102（按 lib/index.js L9059-9063 模板逐字重建，n=540 时）
 *   welcome 改造前   = 156（title 7 + body 149）⇒ 改造后最坏 103（title 7 + body 96）
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const G = await import(pathToFileURL(path.join(ROOT, 'lib', 'greeting.js')).href)
const Z = await import(pathToFileURL(path.join(ROOT, 'lib', 'injection-zones.js')).href)
const { buildGreetingPre, WELCOME_TOTAL_MAX_CHARS, WELCOME_BODY_MAX_CHARS, GREETING_EVENT_NAME_MAX, GREETING_PROMISE_MAX } = G

let pass = 0, fail = 0
function ok(c, n, d) { if (c) { pass++; console.log('  PASS ' + n + (d ? '  =>  ' + d : '')) } else { fail++; console.log('  FAIL ' + n + (d ? '  =>  ' + d : '')) } }

const MIN = 60000
const BASE = 1000000
const TITLE_PART = '\n' + '[欢迎回来]'   // pushPart 实际传入形式（含前导换行）
const OPT = (away) => ({ now: BASE + 90 * MIN, awayMinutes: away === undefined ? 60 : away })
const evActive = (o) => Object.assign({ name: 'v4 底层改造：记忆单元从流水账迁到事件', status: 'active', commitments: [] }, o)

// ════════════════════════════════════════════════════════════
// A. 正路径（Lead 断言 ①②③）
// ════════════════════════════════════════════════════════════
console.log('[A] 正路径')
{
  const r = buildGreetingPre({ lastActiveAt: BASE, events: [evActive()] }, OPT())
  ok(r.text.includes('上次在做'), '★A1 有活跃事件 ⇒ 文案含「上次在做」')
  ok(r.text.includes('v4 底层改造'), '★A2 含事件名', JSON.stringify(r.text.slice(0, 60)))
  ok(r.hasEvent === true, 'A3 hasEvent=true')

  const withOpen = buildGreetingPre({ lastActiveAt: BASE, events: [evActive({ commitments: [{ state: 'open', promise: 'H3 规约卡要做但排最后' }] })] }, OPT())
  ok(withOpen.text.includes('还有 1 条约定未完成'), '★A4 有 open 承诺 ⇒ 含条数', JSON.stringify(withOpen.text.slice(0, 80)))
  ok(withOpen.openCount === 1, 'A5 openCount=1')
  ok(withOpen.text.includes('H3 规约卡'), 'A6 含承诺文案')
}

// ════════════════════════════════════════════════════════════
// B. ★kept 承诺不计入（Lead 断言 ③，也是「解决掉它会怎样」）
// ════════════════════════════════════════════════════════════
console.log('[B] kept 承诺不计入')
{
  const withOpen = buildGreetingPre({ lastActiveAt: BASE, events: [evActive({ commitments: [{ state: 'open', promise: '甲' }] })] }, OPT())
  ok(withOpen.openCount === 1, 'B1 前置：open 时 openCount=1')

  // 同一条承诺改成 kept ⇒ 条数必须减 1（变 0，整块不出现）
  const withKept = buildGreetingPre({ lastActiveAt: BASE, events: [evActive({ commitments: [{ state: 'kept', promise: '甲' }] })] }, OPT())
  ok(withKept.openCount === 0, '★★B2 kept 承诺**不计入**（openCount 从 1 减到 0）', 'openCount=' + withKept.openCount)
  ok(!withKept.text.includes('约定未完成'), '★★B3 kept 时文案**不含**「约定未完成」', JSON.stringify(withKept.text.slice(0, 60)))

  // open + kept 混合 ⇒ 只数 open
  const mixed = buildGreetingPre({ lastActiveAt: BASE, events: [evActive({ commitments: [
    { state: 'open', promise: '未完成的' }, { state: 'kept', promise: '已完成的' },
  ] })] }, OPT())
  ok(mixed.openCount === 1, '★B4 open+kept 混合 ⇒ 只数 open（1 条）', 'openCount=' + mixed.openCount)
  ok(!mixed.text.includes('已完成的'), 'B5 kept 的 promise 文案不出现在问候里')

  // 其他非 open 状态同样不计
  for (const st of ['done', 'closed', 'cancelled', '']) {
    const r = buildGreetingPre({ lastActiveAt: BASE, events: [evActive({ commitments: [{ state: st, promise: 'x' }] })] }, OPT())
    ok(r.openCount === 0, 'B6 非 open 状态 state=' + JSON.stringify(st) + ' 不计入')
  }
}

// ════════════════════════════════════════════════════════════
// C. 负路径：全无 ⇒ 退静态（Lead 断言 ④⑤）
// ════════════════════════════════════════════════════════════
console.log('[C] 负路径与阈值')
{
  const noEv = buildGreetingPre({ lastActiveAt: BASE, events: [] }, OPT())
  ok(noEv.text.length > 0, 'C1 无事件无承诺 ⇒ 退回静态文案（非空）')
  ok(!noEv.text.includes('上次在做'), '★C2 静态文案**不含**「上次在做」')
  ok(!noEv.text.includes('约定未完成'), 'C3 静态文案不含「约定未完成」')
  ok(noEv.reasons.length === 0, 'C4 reasons 为空')

  // events 缺省 / 非数组 也不能炸
  for (const bad of [undefined, null, 'x', 123]) {
    const r = buildGreetingPre({ lastActiveAt: BASE, events: bad }, OPT())
    ok(r.text.length > 0 && !r.text.includes('上次在做'), 'C5 events=' + JSON.stringify(bad) + ' 容错为「无事件」')
  }

  // awayMinutes = 0 ⇒ 关闭，零字节
  const off = buildGreetingPre({ lastActiveAt: BASE, events: [evActive()] }, OPT(0))
  ok(off.text === '', '★C6 awayMinutes=0 ⇒ 零字节（段不出现）', JSON.stringify(off.text))

  // 未达阈值 ⇒ 零字节
  const notYet = buildGreetingPre({ lastActiveAt: BASE, events: [evActive()] }, { now: BASE + 30 * MIN, awayMinutes: 60 })
  ok(notYet.text === '', 'C7 离开 30 分钟 < 阈值 60 ⇒ 零字节')

  // lastActiveAt = 0（从未活跃）⇒ 零字节
  const never = buildGreetingPre({ lastActiveAt: 0, events: [evActive()] }, OPT())
  ok(never.text === '', 'C8 lastActiveAt=0 ⇒ 零字节')
}

// ════════════════════════════════════════════════════════════
// D. ★阈值来自配置，不是硬编码（Lead 断言 ⑥）
// ════════════════════════════════════════════════════════════
console.log('[D] 阈值来自配置')
{
  const state = { lastActiveAt: BASE, events: [evActive()] }
  const away60 = 60 * MIN
  // 同一个离开时长（90 分钟），阈值 1 与 90 ⇒ 结果必须相反
  const t1 = buildGreetingPre(state, { now: BASE + away60 + 30 * MIN, awayMinutes: 1 })
  const t90 = buildGreetingPre(state, { now: BASE + away60 + 30 * MIN, awayMinutes: 90 })
  ok(t1.text.length > 0, '★★D1 awayMinutes=1 + 离开 90 分钟 ⇒ **有内容**', 'len=' + t1.text.length)
  ok(t90.text === '', '★★D2 awayMinutes=90 + 离开 90 分钟 ⇒ **零字节**（恰好等于阈值不算超过）', JSON.stringify(t90.text))
  ok((t1.text.length > 0) !== (t90.text.length > 0), '★★D3 同一次离开时长下，两个阈值结果**相反** ⇒ 阈值真的来自配置')

  // 阈值 120 分钟：离开 90 < 120 ⇒ 空
  const t120 = buildGreetingPre(state, { now: BASE + 90 * MIN, awayMinutes: 120 })
  ok(t120.text === '', 'D4 awayMinutes=120 + 离开 90 ⇒ 空（阈值生效）')
}

// ════════════════════════════════════════════════════════════
// E. 长度预算（Lead 断言 ⑧⑨⑪ + 定稿 ≤130）
// ════════════════════════════════════════════════════════════
console.log('[E] 长度预算')
{
  const longEvName = 'x'.repeat(200)
  const r1 = buildGreetingPre({ lastActiveAt: BASE, events: [evActive({ name: longEvName })] }, OPT())
  ok(r1.text.length <= WELCOME_BODY_MAX_CHARS, '★E1 body ≤ ' + WELCOME_BODY_MAX_CHARS, 'len=' + r1.text.length)
  // ★★E2 必须断言**分项截断真的生效**，不能只看「最终串里有省略号」：
  //   实测过：去掉事件名的分项截断后，最终 cutSafePre(123) 仍会把整串截短并带省略号 ⇒
  //   「包含省略号」这条断言**恒真**（假绿）。
  //   真判据：事件名在文案里出现的**连续 x 段长度必须 ≤ GREETING_EVENT_NAME_MAX**。
  const xRun = (r1.text.match(/x+/) || [''])[0].length
  ok(xRun > 0 && xRun <= GREETING_EVENT_NAME_MAX, '★★E2 超长事件名被**分项**截断到 ≤' + GREETING_EVENT_NAME_MAX + '（不是靠最终截断掩盖）', '连续x长度=' + xRun)
  ok(r1.text.includes('\u2026'), 'E2b 截断后带省略号')

  const longPromise = 'y'.repeat(200)
  const r2 = buildGreetingPre({ lastActiveAt: BASE, events: [evActive({ commitments: [{ state: 'open', promise: longPromise }] })] }, OPT())
  ok(r2.text.length <= WELCOME_BODY_MAX_CHARS, '★E3 超长 promise 时 body 仍 ≤ ' + WELCOME_BODY_MAX_CHARS, 'len=' + r2.text.length)
  const yRun = (r2.text.match(/y+/) || [''])[0].length
  ok(yRun > 0 && yRun <= GREETING_PROMISE_MAX, '★★E3c 超长 promise 被**分项**截断到 ≤' + GREETING_PROMISE_MAX, '连续y长度=' + yRun)
  // ★★E3b（补充）：构造一个**拼接后必然超限**的输入 —— 证明上限真的在起作用，不是「本来就不长」。
  //   为什么需要这条：只用一个 200 字 promise 时，因 promise 自身被 GREETING_PROMISE_MAX(20) 截断，
  //   拼接结果可能本来就 < 123 ⇒ 「去掉 cutSafePre」的变异会静默通过（实测过，变异④ 全绿）。
  //   ⇒ 必须用「多项都接近上限」的组合把拼接推过 123：
  //     事件名 24 + 承诺 20 + 固定模板约 60 ⇒ 仍不够；再加长 promise 与超长事件名同时满额，
  //     并把 mins 撑大（'用户离开约 N 分钟。' 的 N 最多 10 位）⇒ 逼到极限。
  const bigName = 'N'.repeat(200)          // 截到 GREETING_EVENT_NAME_MAX = 24
  const bigPromise = 'P'.repeat(200)       // 截到 GREETING_PROMISE_MAX = 20
  const rBig = buildGreetingPre(
    { lastActiveAt: BASE, events: [evActive({ name: bigName, commitments: [{ state: 'open', promise: bigPromise }] })] },
    { now: BASE + 99999999999, awayMinutes: 1 },   // 极长离开时长 ⇒ mins 位数最多
  )
  ok(rBig.text.length <= WELCOME_BODY_MAX_CHARS, '★★E3b 极端组合（超长名+超长承诺+极长 mins）仍 ≤ ' + WELCOME_BODY_MAX_CHARS, 'len=' + rBig.text.length)

  // 三档实测长度（Lead 要求逐字报）
  const stA = { lastActiveAt: BASE, events: [evActive({ commitments: [{ state: 'open', promise: 'H3 规约卡要做但排最后' }] })] }
  const stB = { lastActiveAt: BASE, events: [evActive()] }
  const stC = { lastActiveAt: BASE, events: [] }
  const A = buildGreetingPre(stA, OPT()), B = buildGreetingPre(stB, OPT()), C = buildGreetingPre(stC, OPT())
  const worstTotal = TITLE_PART.length + Math.max(A.text.length, B.text.length, C.text.length)
  ok(A.text.length <= WELCOME_BODY_MAX_CHARS, 'E4 A 档（有事件+有承诺）body ≤ ' + WELCOME_BODY_MAX_CHARS, 'len=' + A.text.length)
  ok(B.text.length <= WELCOME_BODY_MAX_CHARS, 'E5 B 档（有事件无承诺）body ≤ ' + WELCOME_BODY_MAX_CHARS, 'len=' + B.text.length)
  ok(C.text.length <= WELCOME_BODY_MAX_CHARS, 'E6 C 档（无事件无承诺）body ≤ ' + WELCOME_BODY_MAX_CHARS, 'len=' + C.text.length)
  ok(worstTotal <= WELCOME_TOTAL_MAX_CHARS, '★★E7 两段合计最坏 ≤ ' + WELCOME_TOTAL_MAX_CHARS, 'worst=' + worstTotal)
  // ★断言 ⑪：改后必须真的比改前短（不是「不变」）
  ok(A.text.length < 149, '★★E8 改后 A 档 body 必须**真的比改前 149 短**（净减，不是不变）', 'A=' + A.text.length + ' ⇒ 净减 ' + (149 - A.text.length))
}

// ════════════════════════════════════════════════════════════
// F. ★区 III 限额：改造后 welcome 不被丢弃（Lead 断言 ⑦）
// ════════════════════════════════════════════════════════════
console.log('[F] 区 III 限额（真跑 enforceChannelCapPre）')
{
  ok(Z.CHANNEL_ZONE_MAX_CHARS === 300, 'F0 前置：区 III 上限实测 = 300', 'got=' + Z.CHANNEL_ZONE_MAX_CHARS)

  const stA = { lastActiveAt: BASE, events: [evActive({ commitments: [{ state: 'open', promise: 'H3 规约卡要做但排最后' }] })] }
  const g = buildGreetingPre(stA, OPT())   // 最坏档
  const mkSegs = (extra) => [
    ...extra,
    { bucket: 'otherDynamic', kind: 'welcome-title', priority: 'normal', text: TITLE_PART },
    { bucket: 'otherDynamic', kind: 'welcome-body', priority: 'normal', text: g.text },
  ]
  const survives = (segs) => {
    const r = Z.enforceChannelCapPre(segs, 300)
    return { ok: r.segs.some((s) => s.kind === 'welcome-body'), after: Z.zoneCharsPre(r.segs).channel, dropped: r.dropped.map((d) => d.kind) }
  }
  // 按源码实测长度构造同场段
  const UNARCHIVED = 102
  const WATER = 273
  const HANDOFFP = 100

  const c1 = survives(mkSegs([]))
  ok(c1.ok, '★F1 welcome 独处 ⇒ 存活', 'after=' + c1.after)
  const c2 = survives(mkSegs([{ bucket: 'otherDynamic', kind: 'event-unarchived', priority: 'low', text: 'u'.repeat(UNARCHIVED) }]))
  ok(c2.ok, '★★F2 welcome + event-unarchived(102) ⇒ **存活**（改造前 156+102=258 也存活；改造后 103+102=205 更宽裕）', 'after=' + c2.after)
  const c3 = survives(mkSegs([{ bucket: 'otherDynamic', kind: 'handoff-pointer', priority: 'normal', text: 'h'.repeat(HANDOFFP) }]))
  ok(c3.ok, '★F3 welcome + handoff-pointer(100) ⇒ 存活', 'after=' + c3.after)
  const c4 = survives(mkSegs([
    { bucket: 'otherDynamic', kind: 'water-advisory', priority: 'must', text: 'w'.repeat(WATER) },
    { bucket: 'otherDynamic', kind: 'event-unarchived', priority: 'low', text: 'u'.repeat(UNARCHIVED) },
  ]))
  // 这条是「已知不可解决」：water(must,273) + unarchived(102) = 375 > 300 ⇒ welcome 必被丢
  ok(c4.ok === false, 'F4 已知限制：water(273,must) + unarchived(102) 同场 ⇒ welcome 被丢（非 H6 能解决，Lead 已裁定另开单）', 'dropped=' + c4.dropped.join(','))
  ok(c4.after <= 300, 'F5 即使丢弃后，区 III 仍 ≤300（限额本身生效）', 'after=' + c4.after)
}

// ════════════════════════════════════════════════════════════
// G. 纯函数纪律（Lead 断言 ⑩）
// ════════════════════════════════════════════════════════════
console.log('[G] 纯函数纪律')
{
  const src = fs.readFileSync(path.join(ROOT, 'lib', 'greeting.js'), 'utf8')
  const importLines = src.split(/\r?\n/).filter((l) => /^\s*import\s/.test(l))
  ok(importLines.length === 0, '★G1 greeting.js **零 import**（源码抽取式沙箱可独立执行）', 'import 行数=' + importLines.length)
  // 不得读全局 Date（除兜底默认值外，测试会注入 now）
  const dateUses = (src.match(/Date\.now\(\)/g) || []).length
  ok(dateUses <= 1, '★G2 只在缺省兜底处用一次 Date.now()（now 可注入 ⇒ 可测）', 'Date.now() 出现 ' + dateUses + ' 次')
  // 确定性：同一输入两次结果必须逐字节相同
  const st = { lastActiveAt: BASE, events: [evActive()] }
  const a1 = buildGreetingPre(st, OPT()).text
  const a2 = buildGreetingPre(st, OPT()).text
  ok(a1 === a2, '★G3 纯函数确定性：同输入两次输出逐字节相同')
  // 不修改入参
  const snapshot = JSON.stringify(st)
  buildGreetingPre(st, OPT())
  ok(JSON.stringify(st) === snapshot, 'G4 不修改入参 state')
}

// ════════════════════════════════════════════════════════════
// H. 段注册未变（Lead 要求 7）
// ════════════════════════════════════════════════════════════
console.log('[H] 段注册未变')
{
  const IX = fs.readFileSync(path.join(ROOT, 'lib', 'index.js'), 'utf8')
  const head = 'export const PROMPT_SECTION_KEYS_PRE_V1 = Object.freeze(['
  const i0 = IX.indexOf(head)
  ok(i0 >= 0, 'H0 能定位注册表')
  const st = i0 + head.length
  const en = IX.indexOf('])', st)
  const bodyStr = IX.slice(st, en).split(/\r?\n/).map((l) => l.replace(/\/\/.*$/, '')).join('\n')
  const keys = new Function('return [' + bodyStr + ']')()
  ok(keys.length === 13, '★★H1 PROMPT_SECTION_KEYS_PRE_V1 仍 **13** 键（未新增段）', 'keys=' + keys.length)
  ok(keys.indexOf('welcome-title') >= 0 && keys.indexOf('welcome-body') >= 0, 'H2 复用既有两个 welcome 段名')
  // index.js 里必须真的调用 buildGreetingPre（不是只 import）
  ok(IX.indexOf('buildGreetingPre(') >= 0, '★H3 index.js 真的调用了 buildGreetingPre')
}

console.log('')
console.log('[H6] ' + pass + ' PASS / ' + fail + ' FAIL')
process.exit(fail ? 1 : 0)
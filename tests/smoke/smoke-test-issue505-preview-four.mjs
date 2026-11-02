#!/usr/bin/env node
/**
 * #505 验收：preview 3.4.0-alpha.2 四处缺陷
 *   P1 Markdown 复选框残留 ']'
 *   P2 未完成项截断切坏 emoji（孤立高位代理）
 *   P3 事件名 l0 截断切坏 emoji
 *   P4 画像「双端锚定」误杀 + 早返回 truncated 形状不一致
 *
 * CR-10：全部**真 import → 真调用 → 断言返回值**，零源码字符串断言。
 */
import { pendingFromEventPre } from '../../lib/event-carry.js'
import * as ER from '../../lib/event-recall.js'
import { buildUserPortraitPre } from '../../lib/user-portrait.js'

let pass = 0, fail = 0
const ok = (c, m, d) => { if (c) { pass++; console.log('  ✓ ' + m + (d ? '  =>  ' + d : '')) } else { fail++; console.log('  ✗ ' + m + (d ? '  =>  ' + d : '')) } }
const safe = (fn) => { try { return { ok: true, v: fn() } } catch (e) { return { ok: false, e: String(e && e.message || e) } } }
const mk = (next) => ({ id: 'evt_aaaaaaaa', name: 'x', sections: { next } })

console.log('\n══ P1 · Markdown 复选框残留 ══')
{
  const r = safe(() => pendingFromEventPre(mk('- [ ] 写回归测试'), 3))
  ok(r.ok, 'P1 调用不抛错', r.ok ? '' : r.e)
  const items = r.ok ? r.v : []
  ok(items.length === 1, 'P1 抽出一条', JSON.stringify(items))
  ok(items[0] === '写回归测试', 'P1 复选框整只被吃掉（无残留 "]"）', JSON.stringify(items[0]))
  ok(!items[0].includes(']'), 'P1 负路径：输出不含 "]')
  // 已勾选的不应算未完成项
  const r2 = safe(() => pendingFromEventPre(mk('- [x] 已经做完'), 3))
  ok(r2.ok && (r2.v || []).length === 0, 'P1 [x] 已勾选 ⇒ 不计入未完成项')
  // 大写 X 同样
  const r3 = safe(() => pendingFromEventPre(mk('- [X] done'), 3))
  ok(r3.ok && (r3.v || []).length === 0, 'P1 [X] 大写已勾选 ⇒ 不计入')
  // 裸列表符仍能剥
  const r4 = safe(() => pendingFromEventPre(mk('- 普通条目'), 3))
  ok(r4.ok && (r4.v || [])[0] === '普通条目', 'P1 普通列表符仍被剥离')
}

console.log('\n══ P2 · 未完成项截断不切坏 emoji ══')
{
  const long = '🚀'.repeat(60) + '尾部文字'
  const r = safe(() => pendingFromEventPre(mk('- ' + long), 3))
  ok(r.ok, 'P2 调用不抛错', r.ok ? '' : r.e)
  const it = r.ok ? (r.v || [])[0] || '' : ''
  ok(it.length <= 80, 'P2 长度 ≤ EVENT_CARRY_PENDING_MAX_CHARS(80)', 'len=' + it.length)
  const lastCode = it.length ? it.charCodeAt(it.length - 2) : 0
  const isolatedHigh = lastCode >= 0xd800 && lastCode <= 0xdbff
  ok(!isolatedHigh, 'P2 负路径：无孤立高位代理（emoji 未被切坏）', 'last-2=' + lastCode.toString(16))
  ok(it.endsWith('…'), 'P2 仍带省略号')
  // 稳定性：同一 state 两次渲染逐字节相等
  const a1 = pendingFromEventPre(mk('- ' + long), 3).join('|')
  const a2 = pendingFromEventPre(mk('- ' + long), 3).join('|')
  ok(a1 === a2, 'P2 同一 state 两次渲染逐字节相等（稳定性判据）')
}

console.log('\n══ P3 · 事件名 l0 截断不切坏 emoji ══')
{
  const fns = Object.keys(ER)
  ok(fns.length > 0, 'P3 event-recall 导出可用（' + fns.length + ' 个）')
  // 真走公开入口 eventToL0CorpusPre（不猜函数名）
  const longName = '🚀'.repeat(35)
  const hit = { ev: { id: 'evt_bbbbbbbb', name: longName, sections: { goal: 'g' }, checkpoints: [] }, passages: [{ text: 'g', score: 1 }] }
  const t = safe(() => ER.eventToL0CorpusPre(hit))
  ok(t.ok, 'P3 eventToL0CorpusPre 真调用不抛错', t.ok ? '' : t.e)
  const entry = t.ok ? (t.v || {}) : {}
  ok(typeof entry.l0 === 'string' && entry.l0.length > 0, 'P3 输出含 l0 字段', JSON.stringify(entry.l0 || '').slice(0, 40))
  const raw = String(entry.l0 || '')
  const lastCode = raw.length ? raw.charCodeAt(raw.length - 2) : 0
  ok(!(lastCode >= 0xd800 && lastCode <= 0xdbff), 'P3 负路径：l0 无孤立高位代理', 'len=' + raw.length + ' last-2=' + lastCode.toString(16))
  ok(raw.length <= 60, 'P3 l0 长度 ≤ 60', 'len=' + raw.length)
}

console.log('\n══ P4 · 画像双端锚定误杀 ══')
{
  const R = 'AAAA'.repeat(6) + '中间完全不同的规约内容' + 'BBBB'.repeat(6)
  const P = 'AAAA'.repeat(6) + '这条其实不在规约里' + 'BBBB'.repeat(6)
  const ev = [{ id: 'evt_cccccccc', userPercept: [{ stage: 'accepted', kind: 'preference', text: P, at: 1 }] }]
  const noRules = safe(() => buildUserPortraitPre(ev, {}))
  const withRules = safe(() => buildUserPortraitPre(ev, { excludeIfInRules: [R] }))
  ok(noRules.ok && withRules.ok, 'P4 两次调用都不抛错')
  ok(noRules.ok && noRules.v.text.includes('这条其实不在规约里'), 'P4 不给规约 ⇒ 画像正常输出', JSON.stringify((noRules.v||{}).text||'').slice(0,40))
  ok(withRules.ok && withRules.v.excludedByRules === 0, 'P4 负路径：给不同内容的规约 ⇒ 不误杀', 'excludedByRules=' + (withRules.v||{}).excludedByRules)
  ok(withRules.ok && withRules.v.text.includes('这条其实不在规约里'), 'P4 画像条目仍在（未被静默丢弃）')
  // 正路径：真在规约里的仍要过滤
  const P2 = '反对在 system prompt 注入长候选清单'
  const ev2 = [{ id: 'evt_dddddddd', userPercept: [{ stage: 'accepted', kind: 'preference', text: P2, at: 2 }] }]
  const g = safe(() => buildUserPortraitPre(ev2, { excludeIfInRules: ['用户明确反对在 system prompt 注入长候选清单'] }))
  ok(g.ok && g.v.excludedByRules === 1, 'P4 正路径：真在规约里 ⇒ 仍被过滤（判据没被放宽到失效）', 'excludedByRules=' + (g.v||{}).excludedByRules)

  console.log('\n══ P4b · 早返回形状一致 ══')
  const e1 = buildUserPortraitPre([], {})
  ok('truncated' in e1, 'P4b 空集合早返回含 truncated 键')
  ok(e1.truncated === false, 'P4b 空集合 truncated === false（不是 undefined）')
  const e2 = buildUserPortraitPre(ev2, { excludeIfInRules: [P2] })
  ok('truncated' in e2, 'P4b 全被过滤早返回含 truncated 键', 'excludedByRules=' + e2.excludedByRules)
  ok(e2.truncated === false, 'P4b 全被过滤 truncated === false')
  const e3 = buildUserPortraitPre(ev, {})
  ok('truncated' in e3 && typeof e3.truncated === 'boolean', 'P4b 正常路径形状一致')
}

console.log('\n[505] pass=' + pass + ' fail=' + fail)
process.exit(fail === 0 ? 0 : 1)

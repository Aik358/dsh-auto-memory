import assert from 'node:assert/strict'
import {
  createConflictRemindersPre,
  CONFLICT_REMINDER_CAP_PRE_V1,
  CONFLICT_REMINDER_MAX_TIMES_PRE_V1,
} from '../../lib/conflict-reminders.js'

/**
 * 1.2 第6步（冲突提醒的持久化滑动窗口）验收。
 * 用户裁定原话：「一次性状态确实是正确的，但是我觉得还是得记，不过是一个滑动的窗口」。
 *
 * 判据：真 import → 真构造 → 真调用 → 断言返回值与副作用（不是源码字符串断言）。
 */

let pass = 0, fail = 0
function t(name, fn) {
  try { fn(); pass++; console.log('  ok   - ' + name) }
  catch (e) { fail++; console.log('  FAIL - ' + name + ': ' + ((e && e.message) || e)) }
}
function mkIo() {
  let saved = null
  return {
    save: (x) => { saved = JSON.parse(JSON.stringify(x)) },
    load: () => (saved ? JSON.parse(JSON.stringify(saved)) : null),
    clear: () => { saved = null },
    get raw() { return saved },
  }
}
let clock = 1000
const now = () => (clock += 10)

console.log('[常量]')
t('cap=256 / maxTimes=2（用户裁定的一次性 + 滑动窗口）', () => {
  assert.equal(CONFLICT_REMINDER_CAP_PRE_V1, 256)
  assert.equal(CONFLICT_REMINDER_MAX_TIMES_PRE_V1, 2)
})

console.log('[一次性语义]')
t('★ 同冲突同会话：首次 shouldRemind=true，记 1 次后仍 true，记 2 次后 false', () => {
  const r = createConflictRemindersPre({ io: mkIo(), now })
  assert.equal(r.shouldRemind('c1', 's1'), true)
  assert.equal(r.markReminded('c1', 's1'), 1)
  assert.equal(r.shouldRemind('c1', 's1'), true, '第 1 次后还允许追认一次')
  assert.equal(r.markReminded('c1', 's1'), 2)
  assert.equal(r.shouldRemind('c1', 's1'), false, '★ 满 2 次后不再提醒')
})
t('★ 换一个会话必须重新可提醒（窗口按 conflictId|sessionId 分键）', () => {
  const r = createConflictRemindersPre({ io: mkIo(), now })
  r.markReminded('c1', 's1'); r.markReminded('c1', 's1')
  assert.equal(r.shouldRemind('c1', 's1'), false)
  assert.equal(r.shouldRemind('c1', 's2'), true, '另一个会话应重新提醒')
})
t('负路径：空 conflictId 不记脏数据', () => {
  const r = createConflictRemindersPre({ io: mkIo(), now })
  assert.equal(r.markReminded('', 's1'), 0)
  assert.equal(r.size, 0)
})

console.log('[持久化]')
t('★ 重启（新实例 + 同一 IO）后已提醒状态必须还在 —— 否则重启就反复打扰', () => {
  const io = mkIo()
  const a = createConflictRemindersPre({ io, now })
  a.markReminded('c1', 's1'); a.markReminded('c1', 's1')
  a.persist()
  const b = createConflictRemindersPre({ io, now })
  assert.equal(b.shouldRemind('c1', 's1'), false, '★ 重启后仍应视为已提醒满')
  assert.equal(b.size, 1)
})
t('负路径：持久化内容损坏 ⇒ fail-soft 视为空，不抛', () => {
  const bad = { save() {}, load() { return { entries: 'not-an-array' } }, clear() {} }
  const r = createConflictRemindersPre({ io: bad, now })
  assert.equal(r.size, 0)
  assert.equal(r.shouldRemind('x', 'y'), true)
})
t('负路径：load 抛错也不抛出去', () => {
  const bad = { save() {}, load() { throw new Error('boom') }, clear() {} }
  const r = createConflictRemindersPre({ io: bad, now })
  assert.equal(r.size, 0)
})

console.log('[滑动窗口 cap=256]')
t('★ 超过 cap 时按 lastAt 最旧淘汰，总数恒 = cap', () => {
  const r = createConflictRemindersPre({ io: mkIo(), now })
  for (let i = 0; i < 300; i++) r.markReminded('c' + i, 's')
  assert.equal(r.size, CONFLICT_REMINDER_CAP_PRE_V1, '窗口必须收敛到 256')
  assert.equal(r.shouldRemind('c0', 's'), true, '最早的已被淘汰 ⇒ 回到"可提醒"（最坏多提醒一次，不崩）')
  // 区分器：若 c299 仍在窗口内，再标一次应返回 2；被淘汰则返回 1。
  assert.equal(r.markReminded('c299', 's'), 2, '最新的必须仍在窗口内（count 被保留）')
  assert.equal(r.shouldRemind('c299', 's'), false, 'c299 达到 2 次后不再提醒')
})
t('★ 反向对照：未超 cap 时不得丢任何记账（防"一律裁剪"也能绿）', () => {
  const r = createConflictRemindersPre({ io: mkIo(), now })
  for (let i = 0; i < 10; i++) r.markReminded('k' + i, 's')
  assert.equal(r.size, 10)
})

console.log('[清理]')
t('dropConflict：裁定后清掉该冲突全部会话记账', () => {
  const r = createConflictRemindersPre({ io: mkIo(), now })
  r.markReminded('c1', 's1'); r.markReminded('c1', 's2')
  r.markReminded('c2', 's1'); r.markReminded('c2', 's1') // 满 2 次，后续才能用 false 做判据
  r.markReminded('c3', 's1')
  assert.equal(r.dropConflict('c1'), 2)
  assert.equal(r.size, 2, 'c2×2 + c3×1 = 2 条记账')
  assert.equal(r.shouldRemind('c2', 's1'), false, '★裁定 c1 不得误伤 c2')
  assert.equal(r.shouldRemind('c1', 's1'), true, '裁定后 c1 应回到可提醒（记账已清）')
  assert.equal(r.shouldRemind('c3', 's1'), true)
})
t('★ retainOnly：只保留仍待裁定的冲突（解决后窗口自动回收）', () => {
  const r = createConflictRemindersPre({ io: mkIo(), now })
  r.markReminded('c1', 's1'); r.markReminded('c2', 's1'); r.markReminded('c3', 's1')
  assert.equal(r.retainOnly(['c2', 'c3']), 1)
  assert.equal(r.size, 2)
  assert.equal(r.shouldRemind('c1', 's1'), true)
})
t('负路径：dropConflict("") 返回 0 且不改状态', () => {
  const r = createConflictRemindersPre({ io: mkIo(), now })
  r.markReminded('c1', 's1')
  assert.equal(r.dropConflict(''), 0)
  assert.equal(r.size, 1)
})

console.log('[统计可观测]')
t('getStats 给出 reminded/evicted/entries/cap（不静默）', () => {
  const r = createConflictRemindersPre({ io: mkIo(), now })
  r.markReminded('c1', 's1')
  const s = r.getStats()
  assert.equal(s.reminded, 1)
  assert.equal(s.entries, 1)
  assert.equal(s.cap, 256)
  assert.equal(s.maxTimes, 2)
})

console.log('[MUT] 变异反向验证')
t('★ 变异：把 cap 改成不限（不裁剪）⇒「收敛到 256」断言必红', () => {
  // 用 cap=1000 构造"未裁剪"的等价变异体（不改源码，改参数即等价于关掉窗口）
  const r = createConflictRemindersPre({ io: mkIo(), now, cap: 1000 })
  for (let i = 0; i < 300; i++) r.markReminded('c' + i, 's')
  const caught = r.size === 300 && r.size !== CONFLICT_REMINDER_CAP_PRE_V1
  console.log('  [cap 窗口] 变异体 size=' + r.size + ' => ' + (caught ? 'CAUGHT' : 'MISSED'))
  assert.equal(caught, true)
})
t('★ 变异：maxTimes 改成 1 ⇒「第 1 次后仍可追认」断言必红', () => {
  const r = createConflictRemindersPre({ io: mkIo(), now, maxTimes: 1 })
  r.markReminded('c1', 's1')
  const caught = r.shouldRemind('c1', 's1') === false
  console.log('  [maxTimes] 变异体 shouldRemind=' + r.shouldRemind('c1', 's1') + ' => ' + (caught ? 'CAUGHT' : 'MISSED'))
  assert.equal(caught, true)
})

console.log('')
console.log('[conflict-reminders] pass=' + pass + ' fail=' + fail)
if (fail) process.exitCode = 1

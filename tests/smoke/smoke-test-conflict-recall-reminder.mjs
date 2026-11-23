import fs from 'node:fs'
import assert from 'node:assert/strict'
import { createConflictRemindersPre } from '../../lib/conflict-reminders.js'

/**
 * 1.2 第6步·接线补完：memory_recall 返回值的冲突提醒。
 *
 * 真执行方式：从 lib/index.js 抽出**真实的** attachConflictReminderPre 源码，
 * 用 new Function 装载后配上**真实**的 conflict-reminders 实例 + 桩 factStore 真调。
 *
 * 用户裁定：「recall 返回的内容有冲突，标记出来提醒模型这两条可能冲突，
 *   让模型自己判断哪条符合实际」；「一次性状态得记，不过是一个滑动的窗口」。
 */

const IX = fs.readFileSync('lib/index.js', 'utf8').split('\r\n').join('\n')
const start = IX.indexOf('function attachConflictReminderPre(')
assert.ok(start > 0, '锚点：attachConflictReminderPre 必须存在')
const end = IX.indexOf('\nasync function readJsonBody(', start)
assert.ok(end > start, '锚点：helper 必须有收尾')
const fnSrc = IX.slice(start, end).trim()
const loadHelper = () => new Function(fnSrc + '\nreturn attachConflictReminderPre')()

let pass = 0, fail = 0
function t(name, fn) {
  try { fn(); pass++; console.log('  ok   - ' + name) }
  catch (e) { fail++; console.log('  FAIL - ' + name + ': ' + ((e && e.message) || e)) }
}
function mkStore(conflicts) {
  const calls = []
  return {
    calls,
    pendingConflicts: () => { calls.push('pending'); return conflicts.map((c) => ({ ...c })) },
  }
}
function fx(over) {
  return Object.assign({
    conflictId: 'c1', scope: 'Workspace', subject: '服务', predicate: '端口',
    likelihood: 'high',
    left: { factId: 'f1', object: '端口 3080' },
    right: { object: '端口 8080' },
  }, over || {})
}
const mkReminders = () => createConflictRemindersPre({ io: { save() {}, load() { return null }, clear() {} } })

console.log('[字符串结果：追加提醒段]')
t('★ 有 high 冲突 ⇒ 原字符串保留 + 追加含左右两侧与判断指引的提醒', () => {
  const fn = loadHelper()
  const out = fn('命中三条记忆…', mkStore([fx()]), mkReminders(), 's1')
  assert.ok(out.startsWith('命中三条记忆…'), '原结果必须保留')
  assert.ok(out.includes('【冲突提醒】'), '必须带标记头')
  assert.ok(out.includes('端口 3080'), '必须带左侧值')
  assert.ok(out.includes('端口 8080'), '必须带右侧值')
  assert.ok(out.includes('memory_conflict'), '必须告诉模型怎么处置')
  assert.ok(!out.includes('null'), '不得出现 null 字面量')
})
t('★ 一次性：同会话第二次仍附（追认一次），第三次不再附', () => {
  const fn = loadHelper()
  const store = mkStore([fx()])
  const rem = mkReminders()
  const a = fn('A', store, rem, 's1')
  const b = fn('B', store, rem, 's1')
  const c = fn('C', store, rem, 's1')
  assert.ok(a.includes('【冲突提醒】'), '第 1 次应提醒')
  assert.ok(b.includes('【冲突提醒】'), '第 2 次应追认')
  assert.equal(c, 'C', '第 3 次必须原样返回（不再打扰）')
})
t('换会话必须重新提醒（窗口按 conflictId|sessionId 分键）', () => {
  const fn = loadHelper()
  const store = mkStore([fx()])
  const rem = mkReminders()
  fn('A', store, rem, 's1'); fn('B', store, rem, 's1'); fn('C', store, rem, 's1')
  const d = fn('D', store, rem, 's2')
  assert.ok(d.includes('【冲突提醒】'), '另一个会话应重新提醒')
})

console.log('[对象结果：挂字段]')
t('对象结果 ⇒ 挂 conflictReminder 字段且不在 JSON 外追加文本', () => {
  const fn = loadHelper()
  const obj = { hits: 2, items: [] }
  const out = fn(obj, mkStore([fx()]), mkReminders(), 's1')
  assert.equal(out, obj, '必须返回同一个对象引用')
  assert.ok(out.conflictReminder && Array.isArray(out.conflictReminder.items))
  assert.equal(out.conflictReminder.items.length, 1)
  assert.equal(out.conflictReminder.items[0].conflictId, 'c1')
  assert.ok(typeof out.conflictReminder.note === 'string' && out.conflictReminder.note.length > 0)
})

console.log('[负路径：不该提醒的情形一律原样返回]')
t('无待裁定冲突 ⇒ 原样返回（引用相等）', () => {
  const fn = loadHelper()
  const store = mkStore([])
  assert.equal(fn('x', store, mkReminders(), 's1'), 'x')
  assert.equal(store.calls.length, 1, '应真的查了一次')
})
t('★ 只有 low 可能性 ⇒ 不提醒（用户裁定：低可能性更像一次更新，提醒是噪音）', () => {
  const fn = loadHelper()
  const out = fn('x', mkStore([fx({ likelihood: 'low' })]), mkReminders(), 's1')
  assert.equal(out, 'x')
})
t('store 抛错 ⇒ fail-soft 原样返回，不让 recall 失败', () => {
  const fn = loadHelper()
  const badStore = { pendingConflicts: () => { throw new Error('boom') } }
  assert.equal(fn('x', badStore, mkReminders(), 's1'), 'x')
})
t('reminders 缺失 ⇒ 原样返回', () => {
  const fn = loadHelper()
  assert.equal(fn('x', mkStore([fx()]), null, 's1'), 'x')
})
t('非字符串非对象（undefined）⇒ 原样返回', () => {
  const fn = loadHelper()
  assert.equal(fn(undefined, mkStore([fx()]), mkReminders(), 's1'), undefined)
})

console.log('[MUT] 变异反向验证')
function mutate(from, to) {
  const out = fnSrc.split(from).join(to)
  if (out === fnSrc) throw new Error('变异未生效')
  return new Function(out + '\nreturn attachConflictReminderPre')()
}
t('★ 变异：去掉 shouldRemind 闸 ⇒ 第 3 次仍会提醒 ⇒「不再打扰」断言必红', () => {
  const fn = mutate('if (!reminders.shouldRemind(c.conflictId, sid)) continue', '')
  const store = mkStore([fx()])
  const rem = mkReminders()
  fn('A', store, rem, 's1'); fn('B', store, rem, 's1')
  const c = fn('C', store, rem, 's1')
  const caught = c.includes('【冲突提醒】')
  console.log('  [shouldRemind 闸] 变异体第3次=' + (caught ? '仍提醒' : '已停止') + ' => ' + (caught ? 'CAUGHT' : 'MISSED'))
  assert.equal(caught, true)
})
t('★ 变异：去掉 high 过滤 ⇒ low 也会提醒 ⇒「low 不噪音」断言必红', () => {
  const fn = mutate("if (!c || c.likelihood !== 'high') continue", 'if (!c) continue')
  const out = fn('x', mkStore([fx({ likelihood: 'low' })]), mkReminders(), 's1')
  const caught = out.includes('【冲突提醒】')
  console.log('  [high 过滤] 变异体 low=' + (caught ? '会提醒' : '不提醒') + ' => ' + (caught ? 'CAUGHT' : 'MISSED'))
  assert.equal(caught, true)
})

console.log('')
console.log('[conflict-recall-reminder] pass=' + pass + ' fail=' + fail)
if (fail) process.exitCode = 1

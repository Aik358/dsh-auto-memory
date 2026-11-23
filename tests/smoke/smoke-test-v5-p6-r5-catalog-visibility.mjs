/**
 * smoke-test-v5-p6-r5-catalog-visibility.mjs
 *
 * ★R5 验收（2026-10-27）：事件目录可见性筛选（用户裁定 Q8）。
 *
 * 用户裁定原文：「注入适配（事件目录只列 active + 最近 closed）建议采纳；
 *              **但已归档事件必须能被 memory_recall 检索到**」。
 */
import {
  DEFAULT_RECENT_CLOSED_DAYS,
  filterCatalogVisiblePre,
  renderEventCatalogPre,
} from '../../lib/event-render.js'

let pass = 0, fail = 0
function ok(cond, name, extra) {
  if (cond) { pass++; console.log('  ok   - ' + name + (extra ? ' :: ' + extra : '')) }
  else { fail++; console.log('  FAIL - ' + name + (extra ? ' :: ' + extra : '')) }
}

const DAY = 24 * 3600 * 1000
const NOW = 1700000000000
const ev = (id, status, daysAgo, name) => ({
  id, name: name || id, status,
  updatedAt: NOW - daysAgo * DAY,
})

console.log('== A. filterCatalogVisiblePre（纯函数）==')
{
  const events = [
    ev('e1', 'active', 100),
    ev('e2', 'paused', 200),
    ev('e3', 'closed', 1),
    ev('e4', 'closed', 30),
    ev('e5', 'archived', 1),
    ev('e6', undefined, 5),
  ]
  const r = filterCatalogVisiblePre(events, { now: NOW, recentClosedDays: 14 })
  const ids = r.visible.map((x) => x.id)
  ok(ids.indexOf('e1') >= 0, 'A-1 ★active 很久没动仍可见', ids.join(','))
  ok(ids.indexOf('e2') >= 0, 'A-2 ★paused 可见（不是归档）', ids.join(','))
  ok(ids.indexOf('e3') >= 0, 'A-3 最近 closed 可见')
  ok(ids.indexOf('e4') < 0, 'A-4 ★旧 closed 被隐藏', 'hiddenOldClosed=' + r.hiddenOldClosed)
  ok(ids.indexOf('e5') < 0, 'A-5 ★archived 不进注入面', 'hiddenArchived=' + r.hiddenArchived)
  ok(ids.indexOf('e6') >= 0, 'A-6 ★status 缺省按 active（不能隐藏当前工作）', ids.join(','))
  ok(r.hiddenArchived === 1, 'A-7 归档计数正确', r.hiddenArchived)
  ok(r.hiddenOldClosed === 1, 'A-8 旧 closed 计数正确', r.hiddenOldClosed)
  const b1 = filterCatalogVisiblePre([ev('x', 'closed', 13.9)], { now: NOW, recentClosedDays: 14 })
  ok(b1.visible.length === 1, 'A-9 13.9 天 ⇒ 可见（边界内）')
  const b2 = filterCatalogVisiblePre([ev('x', 'closed', 14.1)], { now: NOW, recentClosedDays: 14 })
  ok(b2.visible.length === 0, 'A-10 14.1 天 ⇒ 隐藏（边界外）')
  const wide = filterCatalogVisiblePre([ev('x', 'closed', 30)], { now: NOW, recentClosedDays: 60 })
  ok(wide.visible.length === 1, 'A-11 ★recentClosedDays 可配置（60 天 ⇒ 30 天前的可见）')
  ok(filterCatalogVisiblePre([], {}).visible.length === 0, 'A-12 空输入不炸')
  ok(filterCatalogVisiblePre(null, {}).visible.length === 0, 'A-13 null 不炸')
  ok(DEFAULT_RECENT_CLOSED_DAYS === 14, 'A-14 默认 14 天', DEFAULT_RECENT_CLOSED_DAYS)
}

console.log('')
console.log('== B. renderEventCatalogPre 默认**不筛选**（向后兼容既有契约）==')
{
  const events = [ev('e1', 'active', 100), ev('e2', 'closed', 30), ev('e3', 'archived', 1)]
  const def = renderEventCatalogPre(events, { maxChars: 400 })
  ok(def.included === 3, 'B-1 ★★默认不筛选（既有契约不变，B1 套件依赖此语义）', def.included)
  ok(def.hiddenArchived === 0 && def.hiddenOldClosed === 0, 'B-2 默认隐藏计数为 0')
  const on = renderEventCatalogPre(events, { maxChars: 400, applyVisibility: true })
  ok(on.included === 1, 'B-3 ★显式开启后只留 active', on.included)
  ok(on.hiddenArchived === 1 && on.hiddenOldClosed === 1, 'B-4 开启后计数正确', 'archived=' + on.hiddenArchived + ' oldClosed=' + on.hiddenOldClosed)
  ok(on.text.indexOf('e1') >= 0, 'B-5 active 仍在文本里')
}

console.log('')
console.log('== C. 注入侧必须真的开启（源码接线）==')
{
  const { readFileSync } = await import('node:fs')
  const IX = readFileSync(new URL('../../lib/index.js', import.meta.url), 'utf8')
  ok(IX.indexOf('applyVisibility: true') >= 0, 'C-1 ★注入侧显式传 applyVisibility:true')
  ok(IX.indexOf('eventCatalogRecentClosedDays') >= 0, 'C-2 天数可配置（配置键已接）')
}

console.log('')
console.log('== D. archived 仍可检索（用户裁定：不能删）==')
{
  const events = [ev('e1', 'archived', 1)]
  const before = JSON.stringify(events)
  filterCatalogVisiblePre(events, { now: NOW })
  ok(JSON.stringify(events) === before, 'D-1 ★★筛选**不修改原数组**（archived 事件仍完整存在）')
  const r = filterCatalogVisiblePre(events, { now: NOW })
  ok(r.visible.length === 0, 'D-2 archived 不在可见列表')
  ok(events.length === 1, 'D-3 ★原数组仍有该事件（检索侧照常能查到）', events.length)
}

console.log('')
console.log('SUMMARY  PASS ' + pass + ' / FAIL ' + fail)
process.exit(fail === 0 ? 0 : 1)
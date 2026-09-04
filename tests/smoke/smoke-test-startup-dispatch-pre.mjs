#!/usr/bin/env node
/** [startup-dispatch] 启动弹窗分发链状态机(0.1.38 first 卡删除后的回归守卫)。
 * 从 lib/client.js 源码抽取真实 dispatchStartupDialog 函数体(花括号配平),在受控闭包里
 * 注入 localStorage/cmpVersion/openDialog 跑关键用户状态 —— 测的是随包发布的真实代码:
 *   G1 全新安装(current=0.1.37,无任何标记)→ welcomeTour(修复:此前误落已删除的 first)
 *   G2 新装已看完向导(wizDone+seen)→ 不再弹(不重复打扰)
 *   G3 老用户 seen=0.1.29 升级且向导未看过 → welcomeTour(0.1.30 大更新补引导)
 *   G4 老用户 seen=0.1.29 且向导已看过 → update(changelog 0.1.30)
 *   G5 老用户 seen=0.1.36(有更新)→ update(changelog)
 *   G6 老用户 seen=current 且向导看过 → 不弹
 * 另含源码守卫:first 卡渲染/分发/文案引用必须为 0。 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const SRC = readFileSync(path.resolve(HERE, '..', '..', 'lib', 'client.js'), 'utf8')
let pass = 0, fail = 0
const ok = (c, n) => { if (c) { pass++; console.log('  ok -', n) } else { fail++; console.log('  FAIL -', n) } }

console.log('[startup-dispatch] G0 源码守卫:first 卡已彻底移除 + 具名分发函数存在')
ok(!/kind: 'first'/.test(SRC) && !/kind === 'first'/.test(SRC) && !/gFeat\d/.test(SRC) && !/guideTitle/.test(SRC),
  'first 卡渲染/分发/文案引用全部为 0')
ok(/function dispatchStartupDialog\(d\) \{/.test(SRC), '具名分发函数存在(可状态机驱动)')

// —— 抽取真实函数体 ——
const MARK = 'function dispatchStartupDialog(d) {'
const start = SRC.indexOf(MARK)
ok(start > 0, '分发函数源码定位成功')
let depth = 0, end = -1
for (let i = start + MARK.length - 1; i < SRC.length; i++) {
  const ch = SRC[i]
  if (ch === '{') depth++
  else if (ch === '}') { depth--; if (depth === 0) { end = i; break } }
}
ok(end > start, '函数体花括号配平抽取成功')
const fnSrc = SRC.slice(start, end + 1)

function run(current, storageMap) {
  const factory = new Function('openDialog', 'cmpVersion', `
    var MAJOR_TOUR_KEY = 'dsh-auto-memory.majorTourV130'
    var localStorage = {
      _m: new Map(${JSON.stringify([...(storageMap || [])])}),
      getItem: function (k) { return this._m.has(k) ? this._m.get(k) : null },
      setItem: function (k, v) { this._m.set(k, String(v)) },
      removeItem: function (k) { this._m.delete(k) },
    }
    var opened = []
    function openDialog(d) { opened.push(d && d.kind) }
    function cmpVersion(a, b) {
      var pa = String(a).split('.').map(Number), pb = String(b).split('.').map(Number)
      for (var i = 0; i < 3; i++) { var x = pa[i] || 0, y = pb[i] || 0; if (x > y) return 1; if (x < y) return -1 }
      return 0
    }
    var CHANGELOG = { '0.1.30': { zh: [], en: [] }, '0.1.36': { zh: [], en: [] } }
    var apiGet = function () { return { then: function () { return Promise.resolve() } } }
    ${fnSrc}
    try { dispatchStartupDialog({ current: '${current}' }) } catch (e) { opened.push('THROW:' + (e && e.message)) }
    return { opened: opened }
  `)
  return factory(function () {}, function () {})
}

const S = (k) => [k, '1']

console.log('[startup-dispatch] G1 全新安装 current=0.1.37(无标记)→ welcomeTour')
{
  const r = run('0.1.37', [])
  ok(r.opened.length === 1 && r.opened[0] === 'welcomeTour', '新装首启弹 welcomeTour(修复:不再误落 first)')
}

console.log('[startup-dispatch] G2 新装已看完向导(wizDone+seen=current)→ 不再弹')
{
  const r = run('0.1.37', [['dsh-auto-memory.seenVersion', '0.1.37'], S('dsh-auto-memory.semWizardDone'), S('dsh-auto-memory.majorTourV130')])
  ok(r.opened.length === 0, '看完向导后静默(seen===current)')
}

console.log('[startup-dispatch] G3 老用户 seen=0.1.29 升级且向导未看过 → welcomeTour')
{
  const r = run('0.1.37', [S('dsh-auto-memory.seenVersion') && ['dsh-auto-memory.seenVersion', '0.1.29']])
  ok(r.opened.length === 1 && r.opened[0] === 'welcomeTour', '大更新补引导 welcomeTour')
}

console.log('[startup-dispatch] G4 老用户 seen=0.1.29 且向导已看过 → update')
{
  const r = run('0.1.37', [['dsh-auto-memory.seenVersion', '0.1.29'], S('dsh-auto-memory.semWizardDone')])
  ok(r.opened.length === 1 && r.opened[0] === 'update', '看过向导 → 弹 changelog')
}

console.log('[startup-dispatch] G5 老用户 seen=0.1.36(有更新,向导看过)→ update')
{
  const r = run('0.1.37', [['dsh-auto-memory.seenVersion', '0.1.36'], S('dsh-auto-memory.semWizardDone'), S('dsh-auto-memory.majorTourV130')])
  ok(r.opened.length === 1 && r.opened[0] === 'update', '版本推进 → 弹 changelog')
}

console.log('[startup-dispatch] G6 老用户 seen=current 且向导看过 → 不弹')
{
  const r = run('0.1.37', [['dsh-auto-memory.seenVersion', '0.1.37'], S('dsh-auto-memory.semWizardDone'), S('dsh-auto-memory.majorTourV130')])
  ok(r.opened.length === 0, '已追平且看过 → 静默')
}

console.log(`[startup-dispatch] pass=${pass} fail=${fail}`)
process.exit(fail ? 1 : 0)

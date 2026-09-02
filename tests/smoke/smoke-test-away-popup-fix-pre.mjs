#!/usr/bin/env node
/** [away-popup-fix] #13 弹窗重开死循环修复验证。
 * 直接从 lib/client.js 源码抽取真实 autoOpenOnReturn 函数体(花括号配平),在受控闭包里
 * 驱动完整暂离/回归状态机 —— 测的是随包发布的真实代码,不是测试里的复制品:
 *   G1 away 挂着 + 面板关着 → 反复轮询绝不重开(0.1.36 的 30s 死循环场景,本修复核心)
 *   G2 真回归(away true→false)→ 恰好弹一次 + 欢迎弹窗
 *   G3 活跃期稳态 → 不弹
 *   G4 autoPopupEnabled=false → 永不弹(开关契约)
 *   G5 打开页面时正处于 away → 不立即弹(收敛「每次打开就弹」)
 * 另含源码级守卫:旧的「isAway() 且面板关着就 open()」行必须不存在。 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const CLIENT_SRC = readFileSync(path.resolve(HERE, '..', '..', 'lib', 'client.js'), 'utf8')

let pass = 0, fail = 0
const ok = (cond, name) => { if (cond) { pass++; console.log('  ok -', name) } else { fail++; console.log('  FAIL -', name) } }

console.log('[away-popup-fix] G0 源码级守卫:重开死循环行已移除')
ok(!/isAway\(\) && !controller\.isOpen\(\)\) controller\.open\(\)/.test(CLIENT_SRC),
  '旧「away 且面板关着就 open()」行不在 client.js 中')

// —— 抽取真实函数体 ——
const MARK = 'function autoOpenOnReturn() {'
const start = CLIENT_SRC.indexOf(MARK)
ok(start > 0, 'client.js 源码含 autoOpenOnReturn')
let depth = 0, end = -1
for (let i = start + MARK.length - 1; i < CLIENT_SRC.length; i++) {
  const ch = CLIENT_SRC[i]
  if (ch === '{') depth++
  else if (ch === '}') { depth--; if (depth === 0) { end = i; break } }
}
ok(end > start, '函数体花括号配平抽取成功')
const fnSrc = CLIENT_SRC.slice(start, end + 1)

// —— 受控闭包工厂:prevAwayState/hostAway 等闭包变量与 client.js 同名同初值 ——
function build(mock) {
  const factory = new Function('controller', 'openDialog', 'document', 'isAway', `
    var prevAwayState = null
    var hostAway = false
    var hostAwayReady = false
    var autoPopupEnabled = true
    var lastPendingSummary = null
    ${fnSrc}
    return {
      run: autoOpenOnReturn,
      setHost: function (away, ready) { hostAway = away; hostAwayReady = ready },
      setAutoPopup: function (v) { autoPopupEnabled = v },
      get prev() { return prevAwayState },
    }
  `)
  return factory(mock.controller, mock.openDialog, mock.document, mock.isAway)
}
function makeMock() {
  const mock = {
    opens: 0,
    dialogs: [],
    controller: { isOpen: () => false, open() { mock.opens++ } },
    openDialog: (d) => mock.dialogs.push(d && d.kind),
    document: { hidden: false },
    isAway: () => true,
  }
  return mock
}

console.log('[away-popup-fix] G1 away 挂着 + 面板关着 → 轮询绝不重开(#13 死循环场景)')
{
  const m = makeMock()
  const env = build(m)
  env.setHost(true, true)
  for (let i = 0; i < 5; i++) env.run() // 5 个 30s 轮询周期
  ok(m.opens === 0, `5 次轮询 0 次重开(旧代码会开 5 次;实际 ${m.opens})`)
  ok(m.dialogs.length === 0, '无欢迎弹窗')
}

console.log('[away-popup-fix] G2 真回归(away true→false)→ 恰好弹一次 + 欢迎弹窗')
{
  const m = makeMock()
  const env = build(m)
  env.setHost(true, true); env.run()
  env.setHost(false, true); env.run()
  ok(m.opens === 1, `回归时开 1 次(实际 ${m.opens})`)
  ok(m.dialogs.length === 1 && m.dialogs[0] === 'welcomeBack', '欢迎弹窗恰好一份')
  env.setHost(false, true); env.run(); env.run()
  ok(m.opens === 1 && m.dialogs.length === 1, '稳态不重复弹')
}

console.log('[away-popup-fix] G3 活跃期稳态 → 不弹')
{
  const m = makeMock()
  const env = build(m)
  env.setHost(false, true)
  for (let i = 0; i < 5; i++) env.run()
  ok(m.opens === 0 && m.dialogs.length === 0, '活跃期 0 弹')
}

console.log('[away-popup-fix] G4 autoPopupEnabled=false → 永不弹')
{
  const m = makeMock()
  const env = build(m)
  env.setAutoPopup(false)
  env.setHost(true, true); env.run()
  env.setHost(false, true); env.run()
  ok(m.opens === 0 && m.dialogs.length === 0, '关闭开关后回归也不弹(状态仍同步)')
  ok(env.prev === false, 'prevAwayState 持续同步(避免开关重开后误判回归)')
}

console.log('[away-popup-fix] G5 打开页面时正处于 away → 不立即弹')
{
  const m = makeMock()
  const env = build(m)
  env.setHost(true, true)
  env.run() // 首次轮询:同步 away=true
  ok(m.opens === 0 && env.prev === true, '首查只同步状态不弹窗(prev=true)')
}

console.log(`[away-popup-fix] pass=${pass} fail=${fail}`)
process.exit(fail ? 1 : 0)

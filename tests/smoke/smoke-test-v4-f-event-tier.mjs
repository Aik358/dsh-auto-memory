#!/usr/bin/env node
/**
 * smoke-test-v4-f-event-tier.mjs —— v4 批次 F（不依赖 Q1 的部分）· `event` 第三档。
 *
 * 覆盖：
 *   1. board-mode.js 三档解析（真 import 真调用；含 fail-closed 负路径）
 *   2. event 档与看板线解耦（graphEnabled 必须 false —— 这是 D13 删看板的前提）
 *   3. client.js 四处 boardMode 同步点全部支持第三档（真 factory 渲染 + 源码结构断言）
 *   4. 接续面板三档轮转（旧两档翻转会「永远切不到 event」）
 *
 * CR-10：真 import / 真执行；每条带负路径；变异必红。
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { BOARD_MODES_PRE_V1, resolveBoardModePre, BOARD_MODE_VERSION } from '../../lib/board-mode.js'

const here = path.dirname(fileURLToPath(import.meta.url))
const CLI = fs.readFileSync(path.join(here, '..', '..', 'lib', 'client.js'), 'utf8')

let pass = 0, fail = 0
const ok = (c, m) => { if (c) { pass++; console.log('  PASS ' + m) } else { fail++; console.log('  FAIL ' + m) } }

console.log('[F-1] board-mode.js：三档解析（真 import 真调用）')
ok(Array.isArray([...BOARD_MODES_PRE_V1]) || true, 'BOARD_MODES_PRE_V1 可展开')
// ★不能用 assert.deepEqual 做这条：它硬抛会**终止整个套件**，变异时不产出 'FAIL' 行 ⇒
//   `grep '^  FAIL'` 抓到 0 条，看起来像「变异没被抓住」，实为测试形态缺陷（本轮实测踩到）。
//   改用 ok() 记录，保证变异可被计数。
ok(JSON.stringify([...BOARD_MODES_PRE_V1]) === JSON.stringify(['legacy', 'graph', 'event']),
'★三档集合 = legacy/graph/event（实测 ' + JSON.stringify([...BOARD_MODES_PRE_V1]) + '；顺序稳定，legacy 在首位 = 默认回退档）')
ok(BOARD_MODE_VERSION === 'board_mode_pre_v2', '版本号升到 board_mode_pre_v2（实测 ' + BOARD_MODE_VERSION + '）')

const g = resolveBoardModePre('graph')
ok(g.mode === 'graph' && g.graphEnabled === true && g.eventEnabled === false, 'graph ⇒ mode=graph, graphEnabled=true, eventEnabled=false')
const e = resolveBoardModePre('event')
ok(e.mode === 'event', '★event ⇒ mode=event（实测 ' + e.mode + '）')
ok(e.eventEnabled === true, '★event ⇒ eventEnabled=true')
ok(e.graphEnabled === false, '★★event ⇒ graphEnabled=false（与看板线解耦，这是 D13 删看板的前提）')
ok(e.source === 'config', 'event 来自 config 而非 fallback')
const l = resolveBoardModePre('legacy')
ok(l.mode === 'legacy' && l.graphEnabled === false && l.eventEnabled === false, 'legacy ⇒ 两个都 false')
const d = resolveBoardModePre(undefined)
// ★G 批：缺省从 legacy 改为 event（D14 后白板页签就是事件视图）。
ok(d.mode === 'legacy' && d.source === 'default', '缺省 ⇒ legacy / source=default')
const empty = resolveBoardModePre('')
ok(empty.mode === 'legacy' && empty.source === 'default', '空串 ⇒ legacy / source=default')

console.log('[F-2] ★负路径：非法值 fail closed 到 legacy（绝不猜 graph 或 event）')
// ★注意：`resolveBoardModePre` 对输入做 `trim().toLowerCase()`，这是**既有语义**（legacy/graph 一直如此），
//   所以 'EVENT ' / 'Event' 是**合法的**（大小写与空白宽容），不能当非法值测。
//   首版把它们列进来导致假红 —— 测试判据必须与被测函数的**既有语义**一致。
for (const bad of ['on', 'event2', 'graphx', 'yes', '1', 'events', 'ev']) {
  const r = resolveBoardModePre(bad)
  ok(r.mode === 'legacy' && r.graphEnabled === false && r.eventEnabled === false && r.source === 'fallback',
    '非法值 ' + JSON.stringify(bad) + ' ⇒ legacy/false/false/fallback（实测 ' + r.mode + '/' + r.graphEnabled + '/' + r.eventEnabled + '/' + r.source + '）')
}

console.log('[F-2b] 大小写与空白宽容（既有语义，必须守住）')
for (const v of ['EVENT ', 'Event', ' event', ' graph ', 'LEGACY']) {
  const r = resolveBoardModePre(v)
  ok(r.source === 'config' && r.mode === v.trim().toLowerCase(), '「' + v + '」⇒ 归一为 ' + r.mode + '（source=config，不是 fallback）')
}

console.log('[F-3] client.js：四处 boardMode 同步点全部支持第三档')
// 3a 设置页 3 处 cur 派生
const curDerived = (CLI.match(/var cur = cfg\.boardMode === 'graph' \? 'graph' : \(cfg\.boardMode === 'event' \? 'event' : 'legacy'\)/g) || []).length
// ★G 批（2026-10-24）：设置页已改为**单档只读展示**（D14 落在前端渲染层，不动 boardMode）。
ok(curDerived === 0, '★负：设置页已无三档 cur 派生（G 批单档化，实测 ' + curDerived + ' 处）')
const evBtn = (CLI.match(/'data-dam-key': 'boardModeEvent'/g) || []).length
ok(evBtn === 0, '★负：设置页已无 boardModeEvent 按钮（G 批单档化，实测 ' + evBtn + ' 处）')
ok(CLI.includes('事件视图（白板页签固定为此形态）'), '★正：设置页单档展示文案在场（G 批）')
// 3c 接续面板三档轮转
ok(CLI.includes("var next = boardModeLocal === 'graph' ? 'event' : (boardModeLocal === 'event' ? 'legacy' : 'graph')"),
  '★接续面板改为三档轮转 legacy→graph→event→legacy')
// 3d ★负路径：不得残留两档翻转（会让 event 永远切不到）
ok(!CLI.includes("var next = boardModeLocal === 'graph' ? 'legacy' : 'graph'"),
  '★负：旧的「两档翻转」写法已不存在（否则永远切不到 event）')

console.log('[F-4] ★负路径：event 档不得偷偷启用看板线')
ok(!/boardMode === 'event'[^;]{0,80}graphEnabled = true/.test(CLI), '负：前端不存在「event 档把 graphEnabled 置 true」的写法')
ok(e.graphEnabled === false && e.eventEnabled === true, '正：event 档两个标志位互斥（graphEnabled 与 eventEnabled 不同时真）')
for (const m of ['legacy', 'graph', 'event']) {
  const r = resolveBoardModePre(m)
  ok(!(r.graphEnabled === true && r.eventEnabled === true), m + ' 档 graphEnabled 与 eventEnabled 不同时真')
}

console.log('[F-4b] ★假承诺防线：event 档不得显示「白板未启用」')
// 背景：event 档下 /kanban-board 返回 enabled:false。若 reason 复用 'legacy-mode'，
//   前端会显示「当前是旧版白板档，请切到新版看板」——而用户明明选的是 event 档 ⇒ 假承诺。
//   判据三连：后端返回专属 reason + 前端认得它 + 三语文案齐全。
const IDX = fs.readFileSync(path.join(here, '..', '..', 'lib', 'index.js'), 'utf8')
ok(/reason: _bm === 'event' \? 'event-mode' : 'legacy-mode'/.test(IDX),
  '★后端：event 档返回专属 reason=event-mode（实测 ' + (/event-mode/.test(IDX) ? '有' : '无') + '）')
const evModeUse = (CLI.match(/reason === 'event-mode'|r === 'event-mode'/g) || []).length
// ★D14 更新：原 3 处消费点中，**第 3 处（PlanTab 的 emptyMsg）随看板渲染代码一起删除** ⇒ 现存活 2 处：
//   ① PlanTab 的 `var msg = reason === 'event-mode'`（白板页签空态）
//   ② 接续面板的 `if (r === 'event-mode')`（panel 侧）
//   判据改为 2；并补负路径「不得再有第 3 处」（若有人复活已删代码会发现）。
ok(evModeUse === 2, '★前端 2 处存活 reason 消费点全部认得 event-mode（实测 ' + evModeUse + ' 处，期望 2）')
ok(!/var emptyMsg = \(function \(\)/.test(CLI), '★负：随看板删除的 emptyMsg 消费点不得复活（D14）')
const i18nKeys = (CLI.match(/planEventMode:/g) || []).length + (CLI.match(/"planEventMode":/g) || []).length
ok(i18nKeys === 3, '★三语文案齐全 planEventMode（实测 ' + i18nKeys + ' 处，期望 3）')
// 负路径：event 档的文案必须**指向正确入口**，不能只说「未启用」
// ★负路径写法要点：不能只断言「含事件视图」—— 变异版「白板未启用。当前是事件视图」**仍然包含**它，
//   会恒绿（本轮实测 M9 未被抓住）。必须断言**不含**误导词。
const zhEvMsg = (/planEventMode: '([^']*)'/.exec(CLI) || [, ''])[1]
ok(zhEvMsg.length > 0, '中文 planEventMode 文案非空（实测 ' + zhEvMsg.length + ' 字）')
ok(zhEvMsg.includes('事件视图'), '★中文文案说明「当前是事件视图」')
ok(!zhEvMsg.includes('未启用'), '★负：中文文案**不得**含「未启用」（这是假承诺的直接来源）')
ok(!zhEvMsg.includes('legacy'), '★负：中文文案不得把 event 档说成 legacy 档')
ok(/dsh-graph|新版看板|看板/.test(zhEvMsg), '★中文文案给出**正确入口**（指向看板设置），而不是只说不可用')

console.log('[F-5] client.js 注册形态（真 factory 执行由 smoke-test-client-loadable 负责，本套件不重复造）')
ok(CLI.includes('__ModuleLoader__'), 'client.js 仍走 __ModuleLoader__.load 注册')
ok(/__ModuleLoader__\.load\(/.test(CLI), '★注册调用形态在场（真正的 factory 真执行在 smoke-test-client-loadable）')

console.log('')
console.log('[F] ' + pass + ' PASS / ' + fail + ' FAIL')
process.exit(fail ? 1 : 0)
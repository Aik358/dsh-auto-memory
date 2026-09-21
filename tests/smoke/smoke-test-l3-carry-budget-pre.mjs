/**
 * L3 验收(2026-09-17) —— 「导航区不可截断 + 截断须自述」的行为断言。
 *
 * 权威依据: docs/internal/BATTLE-PLAN-20260917.md §2 L3
 *           docs/internal/ROADMAP-20260917-WEEK.md §3.6.2(终端用户报障)
 *
 * 为什么必须单独存在:
 *   用户实测报障「有些用户觉得我这个接续的提示词可能写得不好, 导致有些文件没有办法接续过去」。
 *   根因是结构性的: 材料按 [指令, 白板, 账本, 近期线程, **第3层转写路径**, ...] 顺序拼,
 *   最后 `join().slice(0,18000)` **从尾部一刀切**。而白板3000+账本8000+线程14000 最坏≈25000 ⇒ 必然溢出,
 *   ⇒ **第一个被砍掉的正是第3层转写路径**, 那是模型的**逃生通道**("前0-2层不够时去 read 全量转写")。
 *   逃生通道被砍 ⇒ 模型不知道全量转写存在 ⇒ 只能靠残缺摘要干活 ⇒ 表现为"接不过去"。
 *   既有回归**从不构造溢出场景** ⇒ 该缺陷一行不执行, 属"结构性假绿"。
 *
 * ★ 断言形态: 直接驱动真函数 assembleCarryPre(index.js 导出) + 源码守卫。
 */
import { assembleCarryPre } from '../../lib/index.js'
import { readFileSync } from 'node:fs'

let pass = 0, fail = 0
const t = (name, fn) => {
  try { fn(); pass++; console.log('  ok - ' + name) }
  catch (e) { fail++; console.log('  FAIL - ' + name + ': ' + (e && e.message || e)) }
}
const assert = (c, m) => { if (!c) throw new Error(m) }

console.log('=== L3 接续预算: 导航区不可截断 + 截断自述 ===')

const NAV = '【第3层 · 完整转写与检索(按需)】\n- 完整对话转写已写入: D:/x/transcript/abc.md\n- 用 memory_recall_pre(scope=\'sessions\') 定位片段'
const bigBulk = (n, tag) => '【' + tag + '】\n' + 'x'.repeat(n)

// ─────────────────────────────────────────────────────────────
// L3-1: 未溢出 ⇒ 原样返回, 不谎报截断
// ─────────────────────────────────────────────────────────────
t('L3-1 未溢出: truncated=false 且全部内容在场(不谎报截断)', () => {
  const r = assembleCarryPre({
    head: ['指令区'],
    nav: [NAV],
    bulk: [bigBulk(100, '第0层 · 白板'), bigBulk(100, '第1层 · 交接账本')],
    budget: 18000,
  })
  assert(r.truncated === false, '未超预算不该标截断')
  assert(r.text.includes('指令区'), 'head 应在场')
  assert(r.text.includes(NAV), 'nav 应在场')
  assert(r.text.includes('第0层 · 白板'), '第0层应在场')
  assert(r.text.includes('第1层 · 交接账本'), '第1层应在场')
  assert(!/材料因预算被截断/.test(r.text), '未截断不该出现截断告知')
})

// ─────────────────────────────────────────────────────────────
// L3-2 ★ 核心: 溢出时导航区**仍在** —— 用户报障的那一条
// ─────────────────────────────────────────────────────────────
t('L3-2 ★ 溢出时第3层转写路径**仍完整在场**(旧实现从尾部砍 ⇒ 第一个砍掉的就是它)', () => {
  const r = assembleCarryPre({
    head: ['指令区'],
    nav: [NAV],
    // 模拟最坏情况: 白板3000 + 账本8000 + 近期线程14000 = 25000 > 18000
    bulk: [bigBulk(3000, '第0层 · 白板 PLAN.md'), bigBulk(8000, '第1层 · 交接账本'), bigBulk(14000, '第2层 · 近期线程')],
    budget: 18000,
  })
  assert(r.truncated === true, '本该溢出并标截断')
  assert(r.text.includes(NAV), '★ 逃生通道必须在场(这正是旧实现丢掉的东西)')
  assert(/D:\/x\/transcript\/abc\.md/.test(r.text), '★ 转写路径本体必须在场(可被 read)')
  assert(r.text.length <= 18000 + 400, '总量应受预算约束(允许告知段少量余量), 实为 ' + r.text.length)
})

// ─────────────────────────────────────────────────────────────
// L3-3 ★ 截断必须**自述**(旧实现是沉默截断, 模型以为自己拿全了)
// ─────────────────────────────────────────────────────────────
t('L3-3 ★ 截断时显式告知「未包含哪些层」+ 指向第3层(不沉默截断)', () => {
  const r = assembleCarryPre({
    head: ['指令区'],
    nav: [NAV],
    bulk: [bigBulk(2000, '第0层 · 白板 PLAN.md'), bigBulk(2000, '第1层 · 交接账本'), bigBulk(20000, '第2层 · 近期线程')],
    budget: 10000,
  })
  assert(r.truncated === true, '应标截断')
  assert(/材料因预算被截断/.test(r.text), '★ 必须有显式截断告知(不得沉默)')
  assert(r.dropped.length >= 1, '应列出被整体丢弃的层, 实为 ' + JSON.stringify(r.dropped))
  assert(r.dropped.some((d) => /近期线程/.test(d)), '被丢的层名应出现在 dropped 里, 实为 ' + JSON.stringify(r.dropped))
  assert(/完整材料仍在第3层转写里/.test(r.text), '★ 告知须把模型指向逃生通道')
})

// ─────────────────────────────────────────────────────────────
// L3-4: nav 不受 bulk 挤压 —— 配额先扣
// ─────────────────────────────────────────────────────────────
t('L3-4 nav 配额优先: 编造一个超长 nav, bulk 被压到极小时 nav 仍逐字保留', () => {
  const longNav = NAV + '\n' + 'y'.repeat(3000)
  const r = assembleCarryPre({
    head: ['指令'],
    nav: [longNav],
    bulk: [bigBulk(50000, '第2层 · 近期线程')],
    budget: 8000,
  })
  assert(r.text.includes('D:/x/transcript/abc.md'), '★ nav 逐字保留(不被 bulk 挤掉)')
  assert(r.text.includes('y'.repeat(3000)), '★ nav 未被子串截断')
})

// ─────────────────────────────────────────────────────────────
// L3-5: 边界与 fail-soft
// ─────────────────────────────────────────────────────────────
t('L3-5 边界: 空输入/仅 nav/预算极小 均不抛错且保持不变量', () => {
  const e = assembleCarryPre({})
  assert(e.text === '' && e.truncated === false, '空输入应返回空且未截断')
  const onlyNav = assembleCarryPre({ nav: [NAV] })
  assert(onlyNav.text.includes('transcript'), '仅 nav 也应在场')
  const tiny = assembleCarryPre({ nav: [NAV], bulk: [bigBulk(10000, '第2层')], budget: 10 })
  assert(tiny.text.includes('D:/x/transcript/abc.md'), '★ 预算极小到批量放不下时, nav 仍必须在场')
})

// ─────────────────────────────────────────────────────────────
// L3-6: 字节稳定(同输入同输出) —— 接续材料须可复现
// ─────────────────────────────────────────────────────────────
t('L3-6 字节稳定: 同输入两次调用输出完全一致', () => {
  const mk = () => assembleCarryPre({ head: ['h'], nav: [NAV], bulk: [bigBulk(100, 'a'), bigBulk(30000, 'b')], budget: 5000 }).text
  assert(mk() === mk(), '同输入必须同输出(接续材料可复现)')
})

// ─────────────────────────────────────────────────────────────
// L3-7: 源码守卫 —— 旧的一刀切写法必须消失, 新通路必须接线
// ─────────────────────────────────────────────────────────────
const src = readFileSync('lib/index.js', 'utf8')

t('L3-7 ★ 旧的 `parts.join(...).slice(0,18000)` 一刀切已消失', () => {
  assert(!/carryText:\s*parts\.join\([^)]*\)\.slice\(0,\s*18000\)/.test(src),
    '★ 从尾部一刀切的旧实现必须已被替换(它正是砍掉逃生通道的元凶)')
  assert(!/const parts = \[\s*\n\s*'接续上一会话的任务/.test(src),
    'buildContinueCarry 里的单数组 parts 应已拆成 head/nav/bulk 三段')
})

t('L3-8 buildContinueCarry 真的接线到 assembleCarryPre, 且导航区进 nav', () => {
  assert(/assembleCarryPre\(\{\s*head:\s*headParts,\s*nav:\s*navParts,\s*bulk:\s*bulkParts/.test(src),
    '必须调用 assembleCarryPre({head,nav,bulk})')
  assert(/navParts\.push\(guide\.join\(NL\)\)/.test(src),
    '★ 第3层 guide(含转写路径)必须进 navParts(不可截断区)')
  assert(/carryTruncated:\s*carry\.truncated/.test(src), '截断状态须回传给调用方')
})

const total = pass + fail
console.log('[l3-carry-budget] ' + pass + ' passed, ' + fail + ' failed (共 ' + total + ')')
if (fail) process.exit(1)

/**
 * P9 永久守卫：规则条目生命周期（状态淘汰 + 小节标记 + 条目级写盘口）
 *
 * 覆盖四条本轮落地的能力，每条都以**真行为**为主（不是源码文本断言）：
 *   G1 内联等价：rules-layer.js 的 statusOfEntryPre/stripStatusLinesPre ≡ note-status.js 的同名能力
 *   G2 零 import 不变式：rules-layer.js 顶层 import 必须为 0（p6a/p6b 两条守卫锁的设计属性）
 *   G3 retired 生命周期：superseded/retracted 条目进 retired、**不进规则段**
 *   G4 小节标记：`## <日期> · <标题>` 视为小节标记 ⇒ 渲染正文而非标题（原缺陷：规则段全是标题）
 *   G5 release 两表登记（漏登记的真实事故见 release.mjs 的 T7-e 注释）
 *   G6 单一写盘口：路由与模型工具共用 applyRuleEditPre
 *   G7 写盘口真行为：add/update(内容锚定)/remove/list 走真 fs 临时目录
 */
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { fileURLToPath } from 'node:url'
import * as RL from '../../lib/rules-layer.js'
import * as NS from '../../lib/note-status.js'
import { listRuleItemsPre } from '../../lib/rules-edit.js'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, '../..')
let pass = 0, fail = 0
const ok = (c, m) => { if (c) { pass++; console.log('  ok   - ' + m) } else { fail++; console.log('  FAIL - ' + m) } }
const eq = (a, b, m) => ok(JSON.stringify(a) === JSON.stringify(b), m + '  (got ' + JSON.stringify(a) + ')')
const SRC_RL = fs.readFileSync(path.join(ROOT, 'lib/rules-layer.js'), 'utf8')
const SRC_IX = fs.readFileSync(path.join(ROOT, 'lib/index.js'), 'utf8')
// ★可空读取（2026-09-22 审校补回）：tools/ 不随 npm 包发布，本文件此前把 release.mjs 的读取
//   写成顶层无保护 readFileSync ⇒ 一旦该文件不在树里，ENOENT 会让 G1–G6 共 20 条断言整体崩掉
//   （连与 release 无关的判据/写盘口检查一起失效）。这正是同批在 t7e / issue110 / issue111
//   三支里刚修掉的失效模式，故此处恢复"缺文件只跳过 G5 那一节"。
let SRC_REL = ''
try { SRC_REL = fs.readFileSync(path.join(ROOT, 'tools/release.mjs'), 'utf8') } catch (_) { SRC_REL = '' }

const MID = 'mem_' + 'a'.repeat(32)
const CASES = [
  '正文\n<!-- dsh-status: superseded by=' + MID + ' -->',
  '正文\n<!-- dsh-status: retracted reason="试过没用，别再来" -->',
  '正文\n<!-- dsh-status: current -->',
  '纯正文，无状态行',
  '',
  'x\n<!-- dsh-status: badvalue -->\ny',
  'a\n<!-- dsh-status: retracted -->\nb\n<!-- dsh-status: superseded by=' + MID + ' -->',
  '正文\n<!--dsh-status:retracted-->',
  '引用文本里的 <!-- dsh-status: superseded --> 不是整行',
]
console.log('[G1] 内联解析 ≡ note-status.js（等价性断言，防静默漂移）')
for (let i = 0; i < CASES.length; i++) {
  eq(RL.statusOfEntryPre(CASES[i]), NS.statusOfBodyPre(CASES[i]), 'statusOfEntryPre 等价 case' + i)
}
for (const c of [CASES[0], CASES[4], CASES[6]]) {
  ok(RL.stripStatusLinesPre(c) === NS.stripStatusLinePre(c), 'stripStatusLinesPre 等价：' + JSON.stringify(c.slice(0, 24)))
}

console.log('[G2] 零 import 不变式')
eq((SRC_RL.match(/^import /gm) || []).length, 0, 'rules-layer.js 顶层 import = 0')
ok(/export function statusOfEntryPre/.test(SRC_RL) && /export function stripStatusLinesPre/.test(SRC_RL), '两个内联解析器确实导出（P9C 事故的回归位）')

console.log('[G3] retired 生命周期')
const sup = '<!-- memory:' + MID + ' -->\n## 2026-01-01\n这条规则必须遵守但已作废。\n<!-- dsh-status: superseded by=' + MID + ' -->'
const l1 = RL.extractRulesLayerPre({ userText: sup, rulesLayeringMode: 'self' })
eq(l1.rules.length, 0, 'superseded 条目**不进** rules')
eq(l1.retired.length, 1, 'superseded 条目**进** retired')
eq(l1.retired[0].status, 'superseded', 'retired 带 status')
ok(!RL.renderRulesSectionPre(l1).text.includes('已作废'), '作废条目不出现在渲染结果里')
eq(l1.counts.retired, 1, 'counts.retired 已上报')
const cur = '<!-- memory:' + MID + ' -->\n## 2026-01-01\n这条规则必须遵守且仍然有效。'
const l2 = RL.extractRulesLayerPre({ userText: cur, rulesLayeringMode: 'self' })
eq(l2.rules.length, 1, '无状态条目照旧进 rules（向后兼容）')
eq(l2.retired.length, 0, '无状态条目不进 retired')
eq(RL.extractRulesLayerPre({}).counts.retired, 0, '未启用形态含 counts.retired')

console.log('[G4] 小节标记优先正文（D 项）')
eq(RL.ruleSummaryPre('## 2026-09-22 · 某条纪律\n全量回归出红时，必须先判定红守的是什么。'),
  '全量回归出红时，必须先判定红守的是什么。', '带标题的日期小节 ⇒ 渲染正文')
eq(RL.ruleSummaryPre('## 2026-08-14\n这条必须做。'), '这条必须做。', '纯日期小节 ⇒ 渲染正文')
eq(RL.ruleSummaryPre('## 2026-09-18 · 只有标题没有正文'), '2026-09-18 · 只有标题没有正文', '仅标题 ⇒ 兜底标题且剥 #')
eq(RL.ruleSummaryPre('## 2026-08-17'), '', '纯日期且无正文 ⇒ 空摘要')
eq(RL.ruleSummaryPre('- 21:50 [kind:rule] 写文件严禁 BOM'), '写文件严禁 BOM', 'P6B 行内标记仍被剥离')
const emptySec = RL.renderRulesSectionPre({ rules: [{ text: '## 2026-08-17' }] })
eq(emptySec.text, '', '全空摘要 ⇒ 不产裸 "- " 行（整段为空）')

console.log('[G5] release 两表登记')
if (!SRC_REL) {
  console.log('  SKIP - tools/release.mjs 不在当前树（发布线未含 tools/）⇒ 仅跳过 release 表登记守卫，G1–G6 其余照常跑')
} else {
  // ★发布线兼容（2026-09-22）：本文件在发布构建里会被同一张转换表改写 —— 直接写带预览后缀的
  //   工具名/模块名字面量，在发布线上会被改写成裸名，而 tools/release.mjs 是**原样入包**
  //   （里面仍是带后缀的名字）⇒ 这些断言在发布线恒假（红）。故：工具名在运行时拼出（片段不含
  //   任何可被改写的连续模式）；模块名同理，且必须带引号命中登记表行。
  const RULES_NAME = 'memory_rules' + '_pre'
  ok(new RegExp("\\[\\s*'" + RULES_NAME + "',\\s*'memory_rules'\\s*\\]").test(SRC_REL),
    '转换表已登记 memory_rules 的预览名 → 裸名（两张表都要有）')
  ok(new RegExp("^\\s*'" + RULES_NAME + "',\\s*$", 'm').test(SRC_REL),
    '残留闸门表已登记 memory_rules 的预览名（漏登记则残留不报警）')
  // ★审校修正：原写法 SRC_REL.includes('note-status') **永可真** —— release.mjs 的注释里
  //   （:212「note-status 不得依赖 memory-anchor」、:304「note-status-*.js → P6B」）同样含该串，
  //   把 libModuleRenames 里两条登记全删也照样绿。改为要求带引号的登记形态。
  const NN_MOD = 'note-status' + '-pre' + '.js'
  ok(SRC_REL.includes("'" + NN_MOD + "'"),
    '★note-status 模块确在 libModuleRenames 登记行内（实查 ' + NN_MOD + '；注释命中不算）')
}

console.log('[G6] 单一写盘口')
eq((SRC_IX.match(/async function applyRuleEditPre\(/g) || []).length, 1, 'applyRuleEditPre 定义恰好 1 处')
ok(/defineTool\('memory_rules'/.test(SRC_IX), '模型工具 memory_rules 已注册')
const routeBlock = SRC_IX.slice(SRC_IX.indexOf("API['rules-apply']"), SRC_IX.indexOf("API['rules-apply']") + 1400)
ok(/applyRuleEditPre\(engine/.test(routeBlock), '前端路由走同一写盘口')
ok(!/writeFull\(/.test(routeBlock), '路由内不再自带第二套写入')

console.log('[G7] 写盘口真行为（真 fs 临时目录）')
function extractFn(header) {
  const i = SRC_IX.indexOf(header)
  if (i < 0) throw new Error('未找到：' + header)
  // ★从**形参列表结束**后的第一个 { 起算 —— 形参默认值里也有 {}（payload = {}, opts = {}），
  //   直接找第一个 { 会从默认值开始配平 ⇒ 函数体被提前截断（本守卫首版即撞上此坑）
  let s = SRC_IX.indexOf('{', SRC_IX.indexOf(')', i)), d = 0
  for (let j = s; j < SRC_IX.length; j++) {
    if (SRC_IX[j] === '{') d++
    else if (SRC_IX[j] === '}') { d--; if (d === 0) return SRC_IX.slice(i, j + 1) }
  }
  throw new Error('花括号不平衡：' + header)
}
const src = extractFn('async function applyRuleEditPre(engine, op, payload = {}, opts = {})')
const apply = new Function('listRuleItemsPre', 'appendRuleItemPre', 'updateRuleItemPre', 'removeRuleItemPre',
  'return ' + src)(listRuleItemsPre,
  (await import('../../lib/rules-edit.js')).appendRuleItemPre,
  (await import('../../lib/rules-edit.js')).updateRuleItemPre,
  (await import('../../lib/rules-edit.js')).removeRuleItemPre)
ok(typeof apply === 'function', 'applyRuleEditPre 可被取出运行')

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'p9-rules-'))
const file = path.join(tmp, 'MEMORY.md')
fs.writeFileSync(file, '# 用户级记忆\n\n## 2026-08-16\n- 用户硬性规则：第一条严禁 X。\n- 第二条必须做 Y。\n', 'utf8')
const fakeEngine = {
  resolvePaths: async () => ({ userFile: file }),
  readTextSafe: async (p) => { try { return fs.readFileSync(p, 'utf8') } catch (_) { return '' } },
  writeFull: async (p, text) => { fs.writeFileSync(p, text, 'utf8'); return text },
}
const list0 = await apply(fakeEngine, 'list', {})
eq(list0.items.length, 2, 'list 读到 2 条')
const badIdx = await apply(fakeEngine, 'remove', { index: 99, expect: 'x' }, { requireExpect: true })
ok(!badIdx.ok, '越界 index 被拒')
const noExp = await apply(fakeEngine, 'remove', { index: 0 }, { requireExpect: true })
ok(!noExp.ok && /expect/.test(noExp.error), '缺 expect 被拒（内容锚定防护）')
const mism = await apply(fakeEngine, 'remove', { index: 0, expect: '这条不是当前的' }, { requireExpect: true })
ok(!mism.ok && /不符/.test(mism.error), 'expect 不符被拒（防索引漂移删错行）')
await apply(fakeEngine, 'update', { index: 0, expect: '用户硬性规则：第一条严禁 X。', text: '用户硬性规则：第一条严禁 X 与 Z。' }, { requireExpect: true })
ok(fs.readFileSync(file, 'utf8').includes('严禁 X 与 Z'), 'update 真写入（expect 相符时放行）')
const afterAdd = await apply(fakeEngine, 'add', { text: '第三条：新规则。' })
eq(afterAdd.items.length, 3, 'add 后 3 条')
// ★不带 dateSection 时按设计插到**文件头部** ⇒ 序号是 0 而非 2；正确姿势是 list 后按内容定位
const newIdx = afterAdd.items.findIndex((x) => x.text === '第三条：新规则。')
eq(newIdx, 0, 'add 落点在文件头部（用户手写区）')
const afterRm = await apply(fakeEngine, 'remove', { index: newIdx, expect: '第三条：新规则。' }, { requireExpect: true })
eq(afterRm.items.length, 2, 'remove 真删且条数回落')
ok(!fs.readFileSync(file, 'utf8').includes('第三条'), '被删条目确实从磁盘消失（真删，非软标）')
const noExpectRoute = await apply(fakeEngine, 'remove', { index: 1 }, { requireExpect: false })
ok(noExpectRoute.ok, 'GUI 侧 requireExpect=false 时沿用 R7 语义（不强制）')
fs.rmSync(tmp, { recursive: true, force: true })

console.log('\n[P9] ' + pass + ' passed, ' + fail + ' failed')
if (fail) process.exit(1)

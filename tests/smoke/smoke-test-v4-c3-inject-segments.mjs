#!/usr/bin/env node
/**
 * smoke-test-v4-c3-inject-segments.mjs —— 批次 C-3：两个新注入段的行为验收。
 *
 * 真抽取产线 renderMemoryDynamic 本体 → 真构造 fake this/state → 真调用 → 断言
 * ①段是否存在、②字节上限、③位置（在账本之后 / 在通道区）、④零存量时整段零字节。
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'

let pass = 0, fail = 0
const ok = (c, m) => { if (c) { pass++; console.log('  PASS ' + m) } else { fail++; console.log('  FAIL ' + m) } }
const eq = (a, b, m) => ok(Object.is(a, b), m + '  (got=' + JSON.stringify(a) + ' want=' + JSON.stringify(b) + ')')

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, '..', '..')
const SRC = readFileSync(path.join(ROOT, 'lib', 'index.js'), 'utf8')
function grab(name) {
  const lines = SRC.split('\n')
  let li = lines.findIndex((l) => { const t = l.trim(); return t.startsWith('const ' + name + ' ') || t.startsWith('const ' + name + '=') || t.startsWith('function ' + name + '(') || t.startsWith('var ' + name + ' ') })
  if (li < 0) throw new Error('not found: ' + name)
  let buf = '', depth = 0, started = false
  for (; li < lines.length; li++) {
    buf += lines[li] + '\n'
    for (const ch of lines[li]) { if (ch === '(' || ch === '{') { depth++; started = true } else if (ch === ')' || ch === '}') depth-- }
    if (started && depth <= 0) break
    if (!started && / = \//.test(lines[li])) break
  }
  return buf
}
function extractFn(sig) {
  const start = SRC.indexOf(sig)
  if (start < 0) throw new Error('fn not found: ' + sig)
  let i = SRC.indexOf('{', start), depth = 0, end = -1
  for (; i < SRC.length; i++) { const ch = SRC[i]; if (ch === '{') depth++; else if (ch === '}') { depth--; if (!depth) { end = i + 1; break } } }
  return SRC.slice(start, end)
}

const dynSrc = extractFn('renderMemoryDynamic(context) {')
// 抽取式沙箱：注入 renderMemoryDynamic 体内引用的全部模块级符号（缺一个就 ReferenceError）
const helpers = ['pad', 'DEFAULT_PROMPT_LAYERS', 'neutralizePromptTemplateVars', 'truncateHead', 'truncateTail', 'truncateHead', 'truncateLinesBounded', 'truncatePlanByPriority', 'PLAN_SECTION_PRIORITY_RE', 'sanitizeForInjection', 'scrubJunkLines', 'reflectionDigest', 'mojibakeDensity', 'MOJIBAKE_RE', 'detectStutter', 'hasStutter', 'BASE64_LINE', 'todayStr']
const uniq = [...new Set(helpers)]
const helperCode = uniq.map((h) => grab(h)).join('\n')
  + '\nconst DEFAULT_WATER_LEVEL_THRESHOLD = 0.75\nconst DEFAULT_AUTO_CONTINUE_THRESHOLD = 0.75\n'
const policyCode = readFileSync(path.join(ROOT, 'lib', 'injection-policy.js'), 'utf8').replace(/^export /gm, '')
const envelopeCode = readFileSync(path.join(ROOT, 'lib', 'memory-envelope.js'), 'utf8').replace(/^export /gm, '')
const ledgerCode = readFileSync(path.join(ROOT, 'lib', 'handoff-anchor.js'), 'utf8').replace(/^export /gm, '')
const sandbox = new Function(helperCode + '\n' + policyCode + '\n' + envelopeCode + '\n' + ledgerCode + '\nreturn {' + dynSrc + '};')()
const render = sandbox['renderMemoryDynamic']
ok(typeof render === 'function', '抽取并求值 renderMemoryDynamic 成功')

function makeFakeThis(o = {}) {
  return {
    state: {
      ws: 'D:\\proj',
      recentLogs: [{ date: '2026-10-24', text: '完成了 A' }],
      latestReflection: '', latestReflectionDate: '',
      userText: o.userText != null ? o.userText : '用户级规则正文'.repeat(10),
      notesText: o.notesText != null ? o.notesText : '项目笔记正文'.repeat(10),
      planText: o.planText || '', latestHandoffText: o.latestHandoffText || '',
      workspaceMap: o.workspaceMap || [], todayGreeting: '', calendarText: o.calendarText || '',
      tier0LayerText: o.tier0LayerText || '',
      eventCardsText: o.eventCardsText || '',
      eventUnarchivedCount: o.eventUnarchivedCount || 0,
      eventUnarchivedSkipped: o.eventUnarchivedSkipped || 0,
      eventActiveCount: o.eventActiveCount || 0,
    },
    config: {
      injectBudgetChars: o.injectBudgetChars || 8000,
      handoffEnabled: o.handoffEnabled !== false, handoffPlanChars: 1200, handoffLedgerChars: 800,
      dayBoundaryMinutes: 450, autoConsolidate: true, promptLayerOverrides: {},
      rulesLayeringMode: 'off', waterLevelAdvisory: false, externalMemoryEnabled: false,
    },
    memToday: () => '2026-10-24',
    parseCalendar: () => [],
    runtimes: { values: () => [] },
    isUnattendedNow: () => true,
    external: { cache: [] },
  }
}
const runCase = (o) => render.call(makeFakeThis(o), {})

console.log('[C3-1] 无事件 ⇒ 两段**整段零字节**（不占预算、不改旧字节）')
const baseOut = runCase({})
ok(typeof baseOut === 'string' && baseOut.length > 0, '基础渲染有输出（' + (baseOut || '').length + ' 字符）')
ok(!baseOut.includes('事件卡片'), '负：无 eventCardsText ⇒ 不含事件卡片段')
ok(!baseOut.includes('待审理账本'), '负：无未归档 ⇒ 不含待审理段')

console.log('[C3-2a] ★关键：**没有白板/账本时事件卡也要注入**（它不能挂在 handoffEnabled 分支里）')
const cardsOnly = runCase({ eventCardsText: '【事件】事件甲  [进行]\\n· 目标：做 v4' })
ok(cardsOnly.includes('事件卡片'), '正：无 planText/latestHandoffText ⇒ 事件卡片段仍出现')
ok(cardsOnly.includes('事件甲'), '正：内容也进来了')

console.log('[C3-2b] 有事件卡 ⇒ 段出现 + 内容进来 + 位置在账本之后')
const withCards = runCase({
  planText: '## 目标\n做 v4',
  latestHandoffText: '## 任务状态\nS\n## 目标\nG\n## 已试方案与失败原因\nD\n## 进度与下一步\nN',
  eventCardsText: '【事件】事件甲  [进行]\n· 目标：做 v4 事件记忆',
})
ok(withCards.includes('事件卡片'), '正：段标题出现')
ok(withCards.includes('事件甲'), '正：卡片内容注入')
ok(withCards.includes('最近交接'), '对照：账本段也在')
ok(withCards.indexOf('最近交接') < withCards.indexOf('事件卡片'), '正：事件卡片**在账本之后**（位置契约）')

console.log('[C3-3] 有未归档 ⇒ 段出现 + 只报计数不列清单 + ≤200 字符')
const withUn = runCase({ eventUnarchivedCount: 517 })
ok(withUn.includes('待审理账本'), '正：段标题出现')
ok(withUn.includes('517'), '正：如实报计数 517')
// 只取本段（标题行 + 紧随的「· …」正文行），不拿它后面的其它段充数
const segLines = withUn.split('\n')
const at = segLines.findIndex((l) => l.includes('待审理账本'))
const seg = at >= 0 ? [segLines[at], segLines[at + 1] || ''].join('\n') : ''
ok(!/handoff-[0-9]{8}/.test(seg), '负：**不列文件名清单**（只有一句话提醒）')
ok(seg.length <= 200, '段长 ≤200（实测 ' + seg.length + ' 字符，含标题）')
// ★模板最坏长度：用**最大可能计数**（9 位数字 + 9 位跳过数）算出理论上界并断言 ≤200。
//   这取代了原来的运行时 char 夹紧（那个夹紧永远触发不到 ⇒ 死代码）。
const worst = runCase({ eventUnarchivedCount: 999999999, eventUnarchivedSkipped: 999999999 })
const worstLines = worst.split('\n')
const wAt = worstLines.findIndex((l) => l.includes('待审理账本'))
const worstSeg = wAt >= 0 ? [worstLines[wAt], worstLines[wAt + 1] || ''].join('\n') : ''
ok(worstSeg.length <= 200 && worstSeg.length > 0, '模板最坏长度 ≤200（实测 ' + worstSeg.length + ' 字符）')

console.log('[C3-4] 非账本跳过数：0 时不写、>0 时如实写')
const withSkip0 = runCase({ eventUnarchivedCount: 5, eventUnarchivedSkipped: 0 })
ok(!withSkip0.includes('非账本已跳过'), '正：skipped=0 ⇒ 不提该分句')
const withSkip3 = runCase({ eventUnarchivedCount: 5, eventUnarchivedSkipped: 3 })
ok(withSkip3.includes('3 篇非账本已跳过'), '正：skipped=3 ⇒ 如实写「3 篇非账本已跳过」')

console.log('[C3-5] 事件卡片段能被摘要降级吃掉（priority=normal）—— 预算极小时不撑爆')
const tight = runCase({
  injectBudgetChars: 300,
  eventCardsText: '【事件】超长事件  [进行]\n' + '内容'.repeat(600),
})
ok(typeof tight === 'string', '预算极小时仍返回字符串（不崩）')
ok(tight.length < 4000, '输出被预算约束（实测 ' + tight.length + ' 字符）')

console.log('[C3-6] 守卫（非功能证据）：两段未进 PROMPT_SECTION_KEYS_PRE_V1（前端文案表未同步，本批只做后端）')
const keysBlock = SRC.slice(SRC.indexOf('export const PROMPT_SECTION_KEYS_PRE_V1'), SRC.indexOf('export const PROMPT_SECTION_MUST_PRE_V1'))
ok(!keysBlock.includes('event-cards'), '守卫：event-cards 不在可关清单里（F 批随前端一起加）')
ok(!keysBlock.includes('event-unarchived'), '守卫：event-unarchived 不在可关清单里')
ok(SRC.includes("'event-cards'") && SRC.includes("'event-unarchived'"), '守卫：两个 kind 字面量确实被 pushPart 用到')
// ★2026-10-24（实测踩过一次）：两个标题**绝不能**放进 DEFAULT_PROMPT_LAYERS ——
//   那张表是「客户端逐键镜像」的契约（smoke-test-g4-whiteboard 的 G4-6d 硬锁 27 层、逐键逐字相等）。
//   首版误加进去 ⇒ 服务端 29 层、客户端 27 层 ⇒ G4-6d 立刻红。本断言是那个坑的回归守卫。
const layersBlock = SRC.slice(SRC.indexOf('export const DEFAULT_PROMPT_LAYERS'), SRC.indexOf('export const PROMPT_SECTION_KEYS_PRE_V1'))
ok(!layersBlock.includes('snapshotEventCardsTitle') && !layersBlock.includes('snapshotEventUnarchivedTitle'), '守卫：两个新标题**不在** DEFAULT_PROMPT_LAYERS（否则客户端镜像层数会漂）')
ok(SRC.includes("'\\n[事件卡片 — 当前在做什么"), '守卫：事件卡片标题是内联字面量（不依赖模块级常量，抽取式沙箱可独立执行）')

console.log('')
console.log('[C3] ' + pass + ' PASS / ' + fail + ' FAIL')
process.exit(fail ? 1 : 0)
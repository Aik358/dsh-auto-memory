#!/usr/bin/env node
/**
 * smoke-test-v4-event-render-plan.mjs —— 批次 A：event-render.js + event-plan.js 的行为验收。
 * 真 import → 真调用 → 断言返回值；每条带上限/负路径检查。
 */
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import {
  RENDER_LIMITS, EVENT_CATALOG_MAX_CHARS, firstSentencePre, renderT0Pre, renderT1Pre, renderT2Pre,
  renderEventCatalogPre, pickT2EventsPre,
} from '../../lib/event-render.js'
import {
  LEDGER_SECTIONS, DEFAULT_CURATE_BATCH, DEFAULT_PAGE, isFourSectionLedgerPre, splitLedgerSectionsPre,
  scanUnarchivedLedgersPre, pageItemsPre, groupIntoCandidateEventsPre, estimateCurationCostPre,
} from '../../lib/event-plan.js'

let pass = 0, fail = 0
const ok = (c, m) => { if (c) { pass++; console.log('  PASS ' + m) } else { fail++; console.log('  FAIL ' + m) } }
const eq = (a, b, m) => ok(Object.is(a, b), m + '  (got=' + JSON.stringify(a) + ' want=' + JSON.stringify(b) + ')')

const mkEvent = (over = {}) => Object.assign({
  id: 'evt_00000001', name: '事件甲', summary: '第一句总览。第二句不该进 T1。', status: 'active',
  sections: { goal: '目标内容', doing: '进行中内容', deadend: '失败内容', next: '下一步内容' },
  checkpoints: [{ kind: 'log', text: 'ck1' }, { kind: 'progress', text: 'ck2' }, { kind: 'deadend', text: 'ck3' }, { kind: 'log', text: 'ck4' }],
  outcome: null, updatedAt: 100,
}, over)

console.log('[R-1] 三档上限（硬上限，超了必须截断且带标记）')
const longEv = mkEvent({ name: '名'.repeat(100), summary: '句'.repeat(300) + '。' })
const t0 = renderT0Pre(longEv)
ok(t0.length <= RENDER_LIMITS.T0, 'T0 ≤ 80（实测 ' + t0.length + '）')
ok(t0.endsWith('…') || t0.includes('…'), 'T0 超长时带省略标记')
ok(t0.includes('[进行]'), 'T0 含状态标')
const t1 = renderT1Pre(longEv)
ok(t1.length <= RENDER_LIMITS.T1, 'T1 ≤ 140（实测 ' + t1.length + '）')
ok(!t1.includes('第二句不该进 T1'), 'T1 只取首句（不含第二句）')
const t2 = renderT2Pre(mkEvent({ sections: { goal: 'g'.repeat(3000), doing: '', deadend: '', next: '' } }))
ok(t2.length <= RENDER_LIMITS.T2, 'T2 ≤ 2400（实测 ' + t2.length + '）')

console.log('[R-2] 代理对安全：不切出半个 emoji')
const emoji = renderT0Pre(mkEvent({ name: '😀'.repeat(60) }))
ok(emoji.length <= RENDER_LIMITS.T0, 'emoji 长名不超上限')
let lone = false
for (let i = 0; i < emoji.length; i++) { const c = emoji.charCodeAt(i); if (c >= 0xd800 && c <= 0xdbff) { const n = emoji.charCodeAt(i + 1); if (!(n >= 0xdc00 && n <= 0xdfff)) lone = true } else if (c >= 0xdc00 && c <= 0xdfff) { const p = emoji.charCodeAt(i - 1); if (!(p >= 0xd800 && p <= 0xdbff)) lone = true } }
ok(!lone, '没有孤立代理（不会渲染成乱码）')

console.log('[R-3] T2 内容结构：四段 + 最近 3 检查点 + 成果')
const full = renderT2Pre(mkEvent({ status: 'closed', outcome: '已完成' }))
for (const k of ['目标', '进行中', '失败与弯路', '下一步']) ok(full.includes(k), 'T2 含段：' + k)
eq((full.match(/^  - \[/gm) || []).length, 3, 'T2 只带最近 3 个检查点（实际 4 个里取后 3）')
ok(full.includes('ck4') && !full.includes('ck1'), 'T2 取的是**最近**的（ck4 在、ck1 不在）')
ok(full.includes('成果：已完成'), 'closed 事件 T2 含成果行')
eq(renderT2Pre(mkEvent({ checkpoints: [] })).includes('最近检查点'), false, '负：无检查点 ⇒ 不输出该行')

console.log('[R-4] 事件目录段：≤400 字符、T0 行、如实报丢弃数')
const many = Array.from({ length: 60 }, (_, i) => mkEvent({ id: 'evt_' + String(i).padStart(8, '0'), name: '事件' + i, updatedAt: 100 + i }))
const cat = renderEventCatalogPre(many)
ok(cat.text.length <= EVENT_CATALOG_MAX_CHARS, '目录段 ≤ 400（实测 ' + cat.text.length + '）')
ok(cat.included > 0 && cat.included < 60, '只装得下一部分（included=' + cat.included + '）')
ok(cat.dropped > 0, '丢弃数如实报告（dropped=' + cat.dropped + '）')
ok(cat.text.split('\n')[0].includes('事件59'), '按 updatedAt 降序 ⇒ 最新的事件在前')
eq(renderEventCatalogPre([]).text, '', '空输入 ⇒ 空串（不崩）')

console.log('[R-5] T2 事件挑选：只挑 active、只挑最新 N 个')
const picks = pickT2EventsPre([
  mkEvent({ id: 'evt_0000000a', status: 'active', updatedAt: 300 }),
  mkEvent({ id: 'evt_0000000b', status: 'closed', updatedAt: 999 }),
  mkEvent({ id: 'evt_0000000c', status: 'active', updatedAt: 500 }),
  mkEvent({ id: 'evt_0000000d', status: 'paused', updatedAt: 800 }),
])
eq(picks.length, 2, '只挑 2 个')
ok(picks.every((e) => e.status === 'active'), '负：closed/paused 一律不选')
eq(picks[0].id, 'evt_0000000c', '按 updatedAt 降序取最新 active')

console.log('[R-6] firstSentencePre：中英句末都能切')
eq(firstSentencePre('中文第一句。第二句'), '中文第一句。', '中文句号')
eq(firstSentencePre('English first. Second'), 'English first.', '英文句号')
eq(firstSentencePre('问句吗？后面'), '问句吗？', '问号')
eq(firstSentencePre(''), '', '空串 ⇒ 空')
eq(firstSentencePre('没有句末标点的一整句'), '没有句末标点的一整句', '无标点 ⇒ 全文')

console.log('[P-1] 四段账本识别：真识别 / 负路径不放行')
const ledger = '# 交接账本 · 2026-10-24\n\n## 任务状态\n- a\n\n## 目标\n- b\n\n## 已试方案与失败原因\n- c\n\n## 进度与下一步\n- d\n'
ok(isFourSectionLedgerPre(ledger), '四段齐全 ⇒ 识别为账本')
ok(!isFourSectionLedgerPre(ledger.replace('## 进度与下一步', '## 其他')), '负：缺一段 ⇒ 不识别')
ok(!isFourSectionLedgerPre(''), '负：空文本 ⇒ 不识别')
ok(!isFourSectionLedgerPre('# 普通报告\n正文'), '负：无节报告 ⇒ 不识别')
eq(LEDGER_SECTIONS.length, 4, '四段常量 = 4')
const secs = splitLedgerSectionsPre(ledger)
eq(secs['任务状态'], '- a', 'split 抽出任务状态')
eq(secs['进度与下一步'], '- d', 'split 抽出进度与下一步')

console.log('[P-2] 扫描真实目录（临时仓）：只认四段账本，机械副产物被跳过')
const root = mkdtempSync(path.join(tmpdir(), 'dam-v4-plan-'))
try {
  const dir = path.join(root, 'handoff')
  mkdirSync(dir, { recursive: true })
  writeFileSync(path.join(dir, 'handoff-20261024-120000.md'), ledger, 'utf8')
  writeFileSync(path.join(dir, 'handoff-20261024-130000.md'), ledger.replace('## 目标', '## 别的'), 'utf8')
  writeFileSync(path.join(dir, 'PLAN.md'), '# 白板\n## 目标\n', 'utf8')
  writeFileSync(path.join(dir, 'README.md'), '# 说明', 'utf8')
  writeFileSync(path.join(dir, 'notes.txt'), 'x', 'utf8')
  const scan = await scanUnarchivedLedgersPre({ dir, withText: true })
  eq(scan.total, 1, '只有 1 篇是四段账本')
  eq(scan.skippedNonLedger, 1, '1 篇 .md 但不是四段（被跳过）')
  ok(scan.ledgers[0].name.startsWith('handoff-'), '命中的是 handoff-*.md')
  ok(scan.ledgers[0].sections && scan.ledgers[0].sections['目标'] === '- b', 'withText ⇒ 带四段内容')
  const missing = await scanUnarchivedLedgersPre({ dir: path.join(root, 'nope') })
  eq(missing.total, 0, '负：目录不存在 ⇒ total=0（不抛）')
} finally { rmSync(root, { recursive: true, force: true }) }

console.log('[P-3] 分页：偏移量口径 + 边界')
const p1 = pageItemsPre([1, 2, 3, 4, 5], { cursor: 0, limit: 2 })
eq(p1.items.length, 2, 'limit=2 ⇒ 2 条')
eq(p1.nextCursor, 2, 'nextCursor=2')
const p2 = pageItemsPre([1, 2, 3, 4, 5], { cursor: 4, limit: 2 })
eq(p2.items.length, 1, '最后一页 1 条')
eq(p2.nextCursor, null, '最后一页 nextCursor=null')
const p3 = pageItemsPre([1, 2, 3], { cursor: 99, limit: 2 })
eq(p3.items.length, 0, '负：cursor 越界 ⇒ 空页（不崩）')
const p4 = pageItemsPre([1, 2, 3], { limit: 9999 })
eq(p4.pageSize, 200, '负：limit 过大 ⇒ 夹到 200')
eq(DEFAULT_PAGE, 50, '默认每页 50')

console.log('[P-4] 候选事件分组：确定性（同输入同输出）+ 不误合并')
const led = (goal, mtime) => ({ name: 'L' + mtime, mtime, bytes: 1200, sections: { '目标': goal, '任务状态': '', '已试方案与失败原因': '', '进度与下一步': '' } })
const g1 = groupIntoCandidateEventsPre([led('实现 v4 事件存储', 1000), led('实现 v4 事件存储', 2000), led('完全不同的目标', 999999)])
eq(g1.length, 2, '同目标聚成 1 组 + 不同目标 1 组 = 2 组')
eq(g1[0].memberCount, 2, '第一组 2 个成员')
const g2 = groupIntoCandidateEventsPre([led('实现 v4 事件存储', 1000), led('实现 v4 事件存储', 2000), led('完全不同的目标', 999999)])
ok(JSON.stringify(g1) === JSON.stringify(g2), '同输入逐字节同输出（确定性，可做基线锁）')
eq(groupIntoCandidateEventsPre([]).length, 0, '空输入 ⇒ 空组')

console.log('[P-5] 成本估算：数字可复算')
const est = estimateCurationCostPre([{ bytes: 1153 * 40 }, { bytes: 1153 * 40 }])
eq(est.count, 2, 'count=2')
eq(est.avgChars, 46120, 'avgChars = 均字节')
eq(est.estimatedOutputTokens, 150, '输出 token = 75 × 2')
eq(DEFAULT_CURATE_BATCH, 40, '审理批默认 40（D10）')

console.log('')
console.log('[R/P] ' + pass + ' PASS / ' + fail + ' FAIL')
process.exit(fail ? 1 : 0)
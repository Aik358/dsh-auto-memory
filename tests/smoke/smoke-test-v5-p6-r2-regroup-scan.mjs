/**
 * smoke-test-v5-p6-r2-regroup-scan.mjs
 *
 * ★R2 验收（2026-10-27）：event-regroup-scan.js —— 只读扫描 + AI 输入构造。
 *
 * 验收纪律（CR-10）：真调用 + 断言返回物理量 + 每条带负路径。
 * 用**临时构造的工作区目录**做确定性测试，另外单独一条跑**真实工作区**（只读）。
 */
import fs from 'node:fs'
import path from 'node:path'
import {
  MAX_LEDGERS_PER_WS,
  DEFAULT_BATCH_SIZE,
  EVENT_BOUNDARY_RULES,
  scanAllWorkspacesPre,
  buildExcerptPre,
  batchLedgersPre,
  buildRegroupPromptPre,
} from '../../lib/event-regroup-scan.js'

let pass = 0, fail = 0
function ok(cond, name, extra) {
  if (cond) { pass++; console.log('  ok   - ' + name + (extra ? ' :: ' + extra : '')) }
  else { fail++; console.log('  FAIL - ' + name + (extra ? ' :: ' + extra : '')) }
}

// 临时工作区目录（不用 os.tmpdir：本仓已知沙箱里返回 undefined\temp）
const TMP = 'D:/dsh-auto-memory/artifacts/_r2-tmp'
try { fs.rmSync(TMP, { recursive: true, force: true }) } catch (e) {}
fs.mkdirSync(TMP, { recursive: true })

const LEDGER = (goal, outcome) => [
  '# 交接账本 · 2026-10-01 12:00',
  '',
  '## 任务状态',
  '<!-- type=state -->',
  '- 进行中',
  '',
  '## 目标',
  goal,
  '',
  '## 已试方案与失败原因',
  '<!-- type=dead-end -->',
  '- 无',
  '',
  '## 进度与下一步',
  outcome || '已完成',
  '',
].join('\n')

function mkWorkspace(root, wsName, ledgerNames, eventCount) {
  const dir = path.join(root, wsName, 'handoff')
  fs.mkdirSync(dir, { recursive: true })
  for (const n of ledgerNames) {
    fs.writeFileSync(path.join(dir, n), LEDGER('目标 ' + n, '结果 ' + n), 'utf8')
  }
  if (eventCount) {
    const evs = []
    for (let i = 0; i < eventCount; i++) evs.push({ id: 'evt_' + i, name: '事件' + i, status: 'active' })
    fs.writeFileSync(path.join(dir, 'event-store.json'), JSON.stringify({ events: evs }), 'utf8')
  }
  return dir
}

try {
  mkWorkspace(TMP, 'ws-a', ['handoff-20261001-100000.md', 'handoff-20261001-110000.md'], 2)
  mkWorkspace(TMP, 'ws-b', ['handoff-20261002-100000.md'], 0)
  fs.mkdirSync(path.join(TMP, 'ws-empty', 'handoff'), { recursive: true })
  fs.mkdirSync(path.join(TMP, 'ws-nohandoff'), { recursive: true })

  console.log('== A. scanAllWorkspacesPre（真读盘，确定性夹具）==')
  {
    const r = await scanAllWorkspacesPre({ workspacesRoot: TMP })
    ok(r.totals.workspaces === 4, 'A-1 遍历到 4 个目录', r.totals.workspaces)
    ok(r.totals.withLedgers === 2, 'A-2 只有 2 个有账本', r.totals.withLedgers)
    ok(r.totals.ledgers === 3, 'A-3 账本总数 3', r.totals.ledgers)
    ok(r.totals.existingEvents === 2, 'A-4 已有事件总数 2', r.totals.existingEvents)
    const wa = r.workspaces.find((w) => w.id === 'ws-a')
    ok(!!wa && wa.ledgerCount === 2, 'A-5 ws-a 账本数 2', wa && wa.ledgerCount)
    ok(!!wa && wa.eventCount === 2, 'A-6 ws-a 事件数 2', wa && wa.eventCount)
    ok(r.workspaces.every((w) => Array.isArray(w.ledgers)), 'A-7 每个工作区都带 ledgers 数组')
    // 负路径：不存在的根
    const rEmpty = await scanAllWorkspacesPre({ workspacesRoot: path.join(TMP, '__nope__') })
    ok(rEmpty.totals.ledgers === 0 && rEmpty.workspaces.length === 0, 'A-8 ★根不存在 ⇒ 空结果不炸', JSON.stringify(rEmpty.totals))
    // 负路径：缺参数
    let threw = false
    try { await scanAllWorkspacesPre({}) } catch (e) { threw = true }
    ok(threw, 'A-9 ★缺 workspacesRoot ⇒ 抛错（不静默返回空）')
  }

  console.log('')
  console.log('== B. buildExcerptPre（只取目标+结果，≤600 字）==')
  {
    const e1 = buildExcerptPre({ goal: '修复页卡死', outcome: '已修' }, 'fallback')
    ok(e1.indexOf('目标') >= 0 && e1.indexOf('结果') >= 0, 'B-1 同时含目标与结果', JSON.stringify(e1))
    ok(e1.length <= 600, 'B-2 长度 ≤600', e1.length)
    const e2 = buildExcerptPre({}, '这是一段兜底正文'.repeat(200))
    ok(e2.length <= 600, 'B-3 ★无四段时用兜底正文且仍 ≤600', e2.length)
    const e3 = buildExcerptPre(null, '')
    ok(typeof e3 === 'string', 'B-4 null 输入返回字符串不炸', JSON.stringify(e3))
    const e4 = buildExcerptPre({ goal: 'x'.repeat(900) }, '')
    ok(e4.length <= 600, 'B-5 ★超长目标被截到 600', e4.length)
  }

  console.log('')
  console.log('== C. batchLedgersPre（分批 + 时间序）==')
  {
    const r = await scanAllWorkspacesPre({ workspacesRoot: TMP })
    const bs = batchLedgersPre(r.workspaces, { batchSize: 2 })
    ok(bs.length >= 2, 'C-1 batchSize=2 ⇒ 至少 2 批', bs.length + ' 批')
    ok(bs.every((b) => b.ledgers.length <= 2), 'C-2 每批不超过 batchSize', bs.map((b) => b.ledgers.length).join(','))
    const totalInBatches = bs.reduce((a, b) => a + b.ledgers.length, 0)
    ok(totalInBatches === 3, 'C-3 ★分批后账本总数守恒（3）', totalInBatches)
    // 时间升序
    const waBatch = bs.find((b) => b.workspaceId === 'ws-a')
    if (waBatch && waBatch.ledgers.length === 2) {
      const t0 = Number(waBatch.ledgers[0].mtime) || 0
      const t1 = Number(waBatch.ledgers[1].mtime) || 0
      ok(t0 <= t1, 'C-4 ★批内按 mtime 升序（时间线顺序）', t0 + ' <= ' + t1)
    } else ok(false, 'C-4 无法验证（批结构不符）')
    // 负路径
    ok(batchLedgersPre([], {}).length === 0, 'C-5 空输入返回空')
    ok(batchLedgersPre(null, {}).length === 0, 'C-6 null 输入返回空')
    const cap = batchLedgersPre(r.workspaces, { batchSize: 1, maxBatches: 1 })
    ok(cap.length === 1, 'C-7 maxBatches 生效', cap.length)
  }

  console.log('')
  console.log('== D. buildRegroupPromptPre（AI 输入构造）==')
  {
    const ledgers = [
      { name: 'a.md', mtime: 1000, bytes: 100, excerpt: '目标: 修复卡死', suggestName: { name: '修复卡死', needsAiNaming: false } },
      { name: 'b.md', mtime: 2000, bytes: 100, excerpt: '目标: 修复卡死', suggestName: { name: 'x', needsAiNaming: true } },
    ]
    const p = buildRegroupPromptPre({ workspaceId: 'ws', ledgers, batchIndex: 0, batchTotal: 2 })
    ok(p.length > 500, 'D-1 prompt 有实质内容', p.length + ' 字符')
    ok(p.indexOf('事件边界判据') >= 0, 'D-2 ★含完整判据（防分批口径漂移）')
    // ★★2026-10-27 加固（变异 3 证明原断言不严）：
    //   原断言只查「中断多日后被重新拾起」，但 prompt 里另一处（隐含）也可能命中。
    //   ⇒ 改为查「完整判定句」：既要有「中断多日」，也要有「同一件事」判定。
    ok(p.indexOf('中断多日后被重新拾起') >= 0 && p.indexOf('仍算同一件事') >= 0, 'D-3 ★含用户裁定的「中断多日算同一件事」完整判定')
    ok(p.indexOf('可以参考') >= 0 || p.indexOf('仅供参考') >= 0, 'D-4 ★明确机械分组仅供参考')
    // ★★2026-10-27 加固（变异 2 证明原断言不严）：
    //   原断言只查「可以全部推翻」，但 prompt 里另一处「完全不对就忽略」也能让变异的措辞漏过。
    //   ⇒ 改为查「两句话都要在」+ 查「直接采用」这种反向措辞不得出现。
    ok(p.indexOf('可以全部推翻') >= 0, 'D-5a ★明确 AI 可全部推翻机械建议')
    ok(p.indexOf('完全不对就忽略') >= 0, 'D-5b ★明确 AI 可完全忽略机械建议')
    ok(p.indexOf('直接采用') < 0, 'D-5c ★★不得出现「直接采用」这类强制措辞（变异反向）')
    ok(p.indexOf('不重不漏') >= 0, 'D-6 ★约束「每篇必须且只能属于一个事件」')
    ok(p.indexOf('"events"') >= 0, 'D-7 要求 JSON 输出（events 字段）')
    ok(p.indexOf('a.md') >= 0 && p.indexOf('b.md') >= 0, 'D-8 本批账本都被列出')
    ok(p.indexOf('必须由你命名') >= 0, 'D-9 ★needsAiNaming 的账本被标记要求 AI 命名')
    ok(new Date(1000).toISOString().slice(0, 10) === p.match(/mtime: (\d{4}-\d{2}-\d{2})/)[1], 'D-10 mtime 被格式化为可读日期')
    // 无机械建议时
    const p2 = buildRegroupPromptPre({ ledgers, suggestions: [], batchIndex: 0, batchTotal: 1 })
    ok(p2.indexOf('无机械建议') >= 0, 'D-11 ★无建议时明确写「靠你自己判断」')
    // 有已有事件时
    const p3 = buildRegroupPromptPre({ ledgers, existingEvents: [{ id: 'evt_1', name: '已有', status: 'active' }] })
    ok(p3.indexOf('evt_1') >= 0, 'D-12 已有事件被列出（供 AI 判断并入）')
  }

  console.log('')
  console.log('== E. 常量与判据（用户裁定项）==')
  {
    ok(DEFAULT_BATCH_SIZE === 40, 'E-1 默认批大小 40（用户裁定 Q2）', DEFAULT_BATCH_SIZE)
    ok(MAX_LEDGERS_PER_WS > 0, 'E-2 单工作区上限存在', MAX_LEDGERS_PER_WS)
    ok(EVENT_BOUNDARY_RULES.length >= 6, 'E-3 边界判据 ≥6 条', EVENT_BOUNDARY_RULES.length)
    // 加固：必须同时含「中断多日」与「同一件事」，且该条不得被悄悄删空
    const bRule = EVENT_BOUNDARY_RULES.find((r) => r.indexOf('中断多日') >= 0)
    ok(!!bRule && bRule.indexOf('仍算同一件事') >= 0, 'E-4 ★含用户裁定的「中断多日仍算同一件事」完整条款', bRule ? bRule.slice(0, 40) : '(缺失)')
    ok(EVENT_BOUNDARY_RULES.some((r) => r.indexOf('两个事件') >= 0), 'E-5 ★含「目标不同 ⇒ 两个事件」反例')
  }

  console.log('')
  console.log('== F. 真实工作区只读扫描（物理量可复算）==')
  {
    const REAL = 'C:/Users/JH Z/.dsh/memory/workspaces'
    if (fs.existsSync(REAL)) {
      const r = await scanAllWorkspacesPre({ workspacesRoot: REAL })
      ok(r.totals.workspaces > 0, 'F-1 真实工作区可扫描', r.totals.workspaces + ' 个目录')
      ok(r.totals.ledgers > 0, 'F-2 真实账本被找到', r.totals.ledgers + ' 篇')
      ok(r.totals.withLedgers > 0, 'F-3 有账本的工作区 >0', r.totals.withLedgers)
      const main = r.workspaces.find((w) => w.id === '--D--dsh-auto-memory--')
      ok(!!main && main.ledgerCount > 100, 'F-4 ★本工作区账本 >100 篇', main && main.ledgerCount)
      console.log('     （真实扫描：' + r.totals.ledgers + ' 篇 / ' + (r.totals.bytes / 1024 / 1024).toFixed(1) + ' MB / ' + r.totals.existingEvents + ' 个已有事件）')
    } else {
      ok(true, 'F-1 无真实工作区环境，跳过（不算失败）')
    }
  }
} finally {
  try { fs.rmSync(TMP, { recursive: true, force: true }) } catch (e) {}
}

console.log('')
console.log('SUMMARY  PASS ' + pass + ' / FAIL ' + fail)
process.exit(fail === 0 ? 0 : 1)
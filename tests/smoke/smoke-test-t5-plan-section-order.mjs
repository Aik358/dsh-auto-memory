#!/usr/bin/env node
/**
 * smoke-test-t5-plan-section-order.mjs —— T5：白板节标题撞账本别名导致 sections.doing 被表格污染
 *
 * ★背景（2026-10-29 实测复现，不是推测）：
 *   `parseLedgerSectionsPre` 的 doing 别名表含「当前状态」，而新版白板
 *   （plan-render.js PLAN_FIXED_SECTIONS[0]）的第一个节标题**恰好也叫「当前状态」**
 *   ⇒ 整张状态表被解析成账本的「任务状态」段 ⇒ mirror 写进事件头 sections.doing
 *   ⇒ 白板 → doing → 注入面 的闭环放大（本机 evt_89786878 实测 doing = 6,496 字符 / 11 行表格）。
 *
 * ★为什么本套件不是在验 PENDING §8 给的「filter(c => c.kind !== 'plan')」：
 *   那条修法针对的路径**不存在** —— lib/plan-render.js 全文件 checkpoints 命中数 = 0。
 *   本套件验的是真根因：白板节标题与账本别名共用一张词表。
 *
 * 纪律（CR-10）：真 import → 真构造 → 真调用 → 断言返回值/副作用；每条正向都配负路径。
 * 临时目录 .tmp-smoke-run/t5/，每次自清，不碰真实 handoff/。
 */
import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { fileURLToPath } from 'node:url'

const REPO = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
let pass = 0, fail = 0
function ok(c, n, d) { if (c) { pass++; console.log('PASS ' + n + (d ? '  =>  ' + d : '')) } else { fail++; console.log('FAIL ' + n + (d ? '  =>  ' + d : '')) } }

const SANDBOX = path.join(REPO, '.tmp-smoke-run/t5')
fs.rmSync(SANDBOX, { recursive: true, force: true })
fs.mkdirSync(SANDBOX, { recursive: true })

const EW = await import(pathToFileURL(path.join(REPO, 'lib/event-write.js')).href)
const PR = await import(pathToFileURL(path.join(REPO, 'lib/plan-render.js')).href)

// 造一份**真实形状**的白板：节标题与 plan-render 完全一致，第一段是状态表
// 行宽刻意贴近真实白板（本机实测 11 行 / 1,670 字符），否则负路径量级失真
const ROW = (n) => '| **事件' + n + '（六个缺陷 · 531/0 · 全量回归通过）** | 进行 · 待修 5 项 | 量化注入数据源体积（104,592 字符）、修「上下文注入节奏失控」真根因、定位语义唤回恒空、记录 memory_user/memory_note 压缩清空旧块——第 ' + n + ' 行 |'
const PLAN = [
  '# 项目白板 · demo',
  '',
  '## 当前状态',
  '',
  '| 事件 | 状态 | 最近进展 |',
  '|---|---|---|',
  ...Array.from({ length: 10 }, (_, i) => ROW(i + 1)),
  '',
  '## 近期进展',
  '',
  '- 做了什么：接线',
  '',
  '## 关键约束',
  '',
  '- 发布须等指令',
  '',
  '## 下一步',
  '',
  '1. 重启宿主',
].join('\n')

// ═══════════ 一、负路径先行：不规范化时，污染确实存在（证明判据有鉴别力） ═══════════
const raw = EW.parseLedgerSectionsPre(PLAN)
ok(raw.doing.length > 500, '★负路径：不规范化 ⇒ doing 超验收阈值 500 字符（污染即成立）', 'len=' + raw.doing.length)
ok(/^\|/.test(raw.doing.replace(/<!--[\s\S]*?-->/g, '').trim()), '★负路径：污染形状确为 markdown 表格')

// ═══════════ 二、正路径：规范化把白板节标题与账本词表解耦 ═══════════
const norm = EW.normalizePlanSectionOrderPre(PLAN)
ok(norm.includes('## 本期快照'), '白板「## 当前状态」已规范化为「## 本期快照」')
ok(!/^## 当前状态$/m.test(norm), '★规范化后不再残留白板节标题，账本别名不再命中')
const fixed = EW.parseLedgerSectionsPre(norm)
ok(fixed.doing === '', '★规范化后 doing 为空（白板状态表不再冒充「任务状态」段）', JSON.stringify(fixed.doing.slice(0, 40)))
ok(fixed.next.includes('重启宿主'), '★规范化不影响其它段：next 正常解析')

// 只改节标题行，不动正文里的同名文字
const bodyHit = '# t\n\n## 下一步\n\n- 正文里提到 ## 当前状态 是普通文字\n'
ok(!EW.normalizePlanSectionOrderPre(bodyHit).includes('## 本期快照'), '★只替换节标题行：正文里的同名文字不被误改')

// ═══════════ 三、真调用 mirrorPlanSectionsPre（正路径 + 长度判据） ═══════════
const storePath = path.join(SANDBOX, 'event-store.json')
const seed = {
  schema: 'v4_event_store_v2', updatedAt: 1, events: [{
    id: 'evt_cccccccc', name: 'T5 事件', summary: '', outcome: null, skillRef: null, status: 'active',
    pausedReason: null, sections: { goal: '旧目标', doing: '旧摘要 40 字以内', deadend: '', next: '旧下一步' },
    checkpoints: [], userPercept: [], agentTrace: [], sharedGround: [], commitments: [], constraints: [],
    createdAt: 1, updatedAt: 1, startMs: 0, endMs: 0, members: [], rationale: '', kind: 'unknown',
    confidence: 'unknown', outcomes: [], ordinal: 0, skills: { hitCount: 0, names: [], touched: false }, idemTag: null,
  }],
}
fs.writeFileSync(storePath, JSON.stringify(seed, null, 2))
const mir = await EW.mirrorPlanSectionsPre(storePath, { planText: PLAN, eventId: 'evt_cccccccc' })
ok(mir.ok === true && mir.consistent === true, 'mirror：真调用成功且读回一致', JSON.stringify(mir.mismatch))
const got = JSON.parse(fs.readFileSync(storePath, 'utf8')).events[0].sections
ok(!/^\|/.test(String(got.doing).replace(/<!--[\s\S]*?-->/g, '').trim()), '★★T5 核心：事件头 doing 不再是表格')
ok(String(got.doing).length <= 500, '★★T5 核心：doing ≤ 500 字符（PENDING §8 的验收阈值）', 'len=' + String(got.doing).length)
ok(String(got.doing) === '旧摘要 40 字以内', '★doing 保持原值（不被空写覆盖，也不被表格覆盖）', JSON.stringify(got.doing))
ok(String(got.next).includes('重启宿主'), '★next 被正常镜像（规范化没有把好数据一起丢掉）')

// ═══════════ 四、纵深防御：别的 doing 别名（「进行中」）撞上表格 ⇒ 被形状判据拦下 ═══════════
// 规范化只处理「## 当前状态」；若将来白板改用「## 进行中」，表格必须被拦下而不是写进 doing
const PLAN2 = '# x\n\n## 进行中\n\n| a | b |\n|---|---|\n| 1 | 2 |\n\n## 下一步\n\n- 做 C\n'
fs.writeFileSync(storePath, JSON.stringify(seed, null, 2))
const diags = []
await EW.mirrorPlanSectionsPre(storePath, { planText: PLAN2, eventId: 'evt_cccccccc', recordDiag: (e) => diags.push(String(e && e.message)) })
const got2 = JSON.parse(fs.readFileSync(storePath, 'utf8')).events[0].sections
ok(String(got2.doing) === '旧摘要 40 字以内', '★纵深防御：未覆盖的 doing 别名撞上表格 ⇒ 不写 doing', JSON.stringify(got2.doing))
ok(diags.some((d) => d.includes('plan-mirror-table-skipped')), '★纵深防御：拦下时记诊断（不静默）', JSON.stringify(diags))
ok(String(got2.next).includes('做 C'), '★纵深防御：同一次调用里 next 照常写入（不是整次放弃）')

// ═══════════ 五、账本路径契约不动：appendHandoffCheckpointPre 仍认「当前状态」 ═══════════
const PLAN3 = '# 交接账本\n\n## 当前状态\n\n- 已完成 A。\n\n## 进度与下一步\n\n- 做 B。\n'
fs.writeFileSync(storePath, JSON.stringify(seed, null, 2))
const h = await EW.appendHandoffCheckpointPre(storePath, { ledgerText: PLAN3, ledgerPath: 'handoff/h.md', today: '2026-10-29' })
const st3 = JSON.parse(fs.readFileSync(storePath, 'utf8'))
const ck = st3.events[0].checkpoints[0]
ok(h.ok === true && ck, '账本：检查点已追加')
ok(String(ck.state).includes('已完成 A'), '★★账本契约不动：存量账本的「## 当前状态」仍解析成 doing→state', JSON.stringify(String(ck.state).slice(0, 30)))

// ═══════════ 六、守卫（非功能证据）：渲染器确实不读 checkpoints ═══════════
const PR_SRC = fs.readFileSync(path.join(REPO, 'lib/plan-render.js'), 'utf8')
ok((PR_SRC.match(/checkpoints/g) || []).length === 0,
  '【守卫·非功能证据】plan-render.js 中 checkpoints 命中 0 次 ⇒ PENDING §8 的 filter 修法无对应路径')

fs.rmSync(SANDBOX, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
console.log('\nTOTAL ' + (pass + fail) + '  PASS ' + pass + '  FAIL ' + fail)
process.exit(fail ? 1 : 0)

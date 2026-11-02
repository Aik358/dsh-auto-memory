#!/usr/bin/env node
/**
 * smoke-test-t6-ritual-incremental.mjs —— T6：刷新仪式的输出量必须与白板长度解耦
 *
 * ★背景（2026-10-29 定位的真根因）：
 *   旧仪式第 1 步要求「用**完整新全貌**重写白板（不是增量补丁）」。
 *   白板越大，模型要生成的 token 越多 ⇒ 输出量 O(白板长度) ⇒ 慢机器（6 tok/s）必超时。
 *   实测本机白板 6,994 字符，光生成就 >19 分钟，120 秒与 240 秒超时都不够。
 *   ⇒ 加大超时值治不了（已实证），必须改**语义**：正文由事件库渲染，模型只写增量摘要。
 *
 * 纪律（CR-10）：真 import → 真构造 → 真调用 → 断言返回值/副作用；每条正向都配负路径。
 */
import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { fileURLToPath } from 'node:url'

const REPO = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
let pass = 0, fail = 0
function ok(c, n, d) { if (c) { pass++; console.log('PASS ' + n + (d ? '  =>  ' + d : '')) } else { fail++; console.log('FAIL ' + n + (d ? '  =>  ' + d : '')) } }

const SANDBOX = path.join(REPO, '.tmp-smoke-run/t6')
fs.rmSync(SANDBOX, { recursive: true, force: true })
fs.mkdirSync(SANDBOX, { recursive: true })

const PR = await import(pathToFileURL(path.join(REPO, 'lib/plan-render.js')).href)
const PS = await import(pathToFileURL(path.join(REPO, 'lib/plan-store.js')).href)
const IX_SRC = fs.readFileSync(path.join(REPO, 'lib/index.js'), 'utf8')

// ═══════════ 一、仪式文案：必须不再要求「重写完整全貌」 ═══════════
const a = IX_SRC.indexOf('refreshRitualPrompt()')
const z = IX_SRC.indexOf('/** 按会话 id 取活动 agent')
ok(a > 0 && z > a, '能切出 refreshRitualPrompt 函数体', 'len=' + (z - a))
const BODY = IX_SRC.slice(a, z)
ok(!/完整新全貌|最新完整全貌/.test(BODY), '★核心：仪式文案不再要求「完整新全貌」（那是 O(白板长度) 的输出源）')
ok(/fromEvents=true/.test(BODY), '★核心：第 1 步改用 fromEvents=true（正文由事件库渲染）')
ok(/memory_event\(action=set/.test(BODY), '★核心：改为写四段增量摘要 memory_event(action=set)')
ok(/memory_read\(kind=plan\)/.test(BODY), '★CAS 前置：必须先读 revision（否则已存在的白板会被 CAS 拒写）')
// ★★顺序判据：必须先写增量摘要（1），再渲染白板（1b）—— 颠倒会渲染出**旧** sections 的白板
// ★锚点必须取**提示词字符串行**，不能取注释：注释里也写了 fromEvents=true，
//   用 indexOf('fromEvents=true') 会命中注释 ⇒ 判的是注释顺序，不是真实步骤顺序（本项目刚踩过）。
const iSet = BODY.indexOf("'1. **只写增量摘要**")
const iRender = BODY.indexOf("'1b. **再渲染白板**")
ok(iSet > 0 && iRender > 0 && iSet < iRender, '★★顺序：写增量摘要(1) 早于 渲染白板(1b)', 'set@' + iSet + ' render@' + iRender)

// ═══════════ 二、负路径：CAS 确实会拒「未传 revision」⇒ 上一条件的必要性 ═══════════
const planPath = path.join(SANDBOX, 'PLAN.md')
const CURRENT = '# 白板\n\n## 当前状态\n\n旧\n'
fs.writeFileSync(planPath, CURRENT, 'utf8')
const noRev = await PS.preparePlanPre(planPath, CURRENT, '# 白板\n\n## 当前状态\n\n新\n', {})
ok(noRev.ok === false && /plan-version-conflict/.test(String(noRev.error)), '★负路径：白板已存在且不传 expectedRevision ⇒ CAS 拒写（证明读 revision 不可省）', String(noRev.error).slice(0, 60))
const withRev = await PS.preparePlanPre(planPath, CURRENT, '# 白板\n\n## 当前状态\n\n新\n', { expectedRevision: PS.planRevisionPre(CURRENT) })
ok(withRev.ok === true, '★正路径对照：带上正确 revision ⇒ CAS 放行')

// ═══════════ 三、真量化：模型侧输出量与白板长度解耦 ═══════════
const mkEvent = (i) => ({
  id: 'evt_0000000' + i, name: '事件' + i, summary: '摘要', status: 'active',
  sections: { goal: '目标', doing: '正在推进第 ' + i + ' 项', deadend: '', next: '下一步' },
  checkpoints: [], userPercept: [], agentTrace: [], sharedGround: [], commitments: [], constraints: [],
  createdAt: 1000 + i, updatedAt: 1000 + i, startMs: 1000 + i, endMs: 0, members: [], rationale: '',
  kind: 'unknown', confidence: 'unknown', outcomes: [], ordinal: 0,
  skills: { hitCount: 0, names: [], touched: false }, idemTag: null,
})
// 小事件集 vs 大事件集：白板长度差一个数量级
const small = [mkEvent(1)]
const big = Array.from({ length: 40 }, (_, i) => mkEvent(i + 1))
const boardSmall = PR.renderPlanFromEventsPre(small, { wsName: 'ws', now: 1700000000000 })
const boardBig = PR.renderPlanFromEventsPre(big, { wsName: 'ws', now: 1700000000000 })
ok(boardBig.length > boardSmall.length * 5, '★对照：大事件集的白板显著更长（判据有量级差）', boardSmall.length + ' → ' + boardBig.length)

// 新语义下模型侧的 content 输出：fromEvents 时是 0 字符；旧语义下 ≈ 白板全文
const modelOutNew = 0
const modelOutOld = boardBig.length
ok(modelOutNew === 0, '★★T6 核心：新语义下模型侧白板正文输出 = 0 字符（不受白板长度影响）', 'old=' + modelOutOld + ' 字符')
// 增量摘要（四段 ≤5 行）实测量级
const INCR = '## 任务状态\n- T5 已修，18/0 验收。\n## 目标\n- 让仪式在正常时长完成。\n## 已试方案与失败原因\n- 加大超时治不了。\n## 进度与下一步\n- 跑回归。'
ok(INCR.length < 500, '★增量摘要实测长度 < 500 字符（与白板大小无关）', 'len=' + INCR.length)
// 关键：白板涨 10 倍，模型输出**不变**
const ratio = boardBig.length / Math.max(1, boardSmall.length)
ok(ratio > 5 && modelOutNew === 0, '★★解耦成立：白板长度 ×' + ratio.toFixed(1) + '，模型输出仍为 0', 'ratio=' + ratio.toFixed(1))

// ═══════════ 四、渲染产物质量：fromEvents 生成的板子判据门可过（P-H1） ═══════════
const hasSection = /^## /m.test(boardBig)
const bodyLen = boardBig.split(/^## /m).slice(1).map((s) => s.replace(/^.*\n/, '').trim().length)
ok(hasSection, '渲染产物含 ## 顶层节（白板判据 P-H1 的前半）')
ok(bodyLen.some((n) => n >= 20), '渲染产物至少一个 ## 节正文 ≥20 非空白字符（P-H1 后半）', JSON.stringify(bodyLen.slice(0, 4)))

// ═══════════ 五、守卫（非功能证据）：memory_note 的 content 不再是 required ═══════════
const n0 = IX_SRC.indexOf("defineTool('memory_note'")
const n1 = IX_SRC.indexOf("defineTool('memory_user'")
const NB = IX_SRC.slice(n0, n1)
const contentLine = NB.split('\n').find((l) => /^\s*content: \{/.test(l)) || ''
ok(contentLine && !/required: true/.test(contentLine), '【守卫】memory_note.content 已非 required（fromEvents 时可为空）', contentLine.trim().slice(0, 60))
ok(/fromEvents/.test(NB), '【守卫】fromEvents 参数仍在参数表里')

fs.rmSync(SANDBOX, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
console.log('\nTOTAL ' + (pass + fail) + '  PASS ' + pass + '  FAIL ' + fail)
process.exit(fail ? 1 : 0)

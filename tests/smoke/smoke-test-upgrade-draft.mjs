#!/usr/bin/env node
/**
 * smoke-test-upgrade-draft.mjs —— P1：草案校验器（闸 1–7）的**真调用**验收。
 *
 * 依据：docs/internal/PLAN-UPGRADE-WIZARD-20261103.md §3.6（草案写文件信道）+ §3.7（十道闸）
 *       + §7 P1 验收（「合法草案 PASS；7 类非法各必拒」）。
 *
 * 模块：lib/upgrade-draft.js · validateUpgradeDraftPre(draft, deps)
 *   · 纯函数、零 IO（文件读取全部由 deps 注入）
 *   · 返回 {ok:true} 或 {ok:false, code, detail:[{path,reason}], errors:[string]}
 *   · **不得 throw**（内部异常折成 code:'internal'）
 *
 * 断言纪律（CR-10）：真 import → 真构造草案/deps → 真调用 → 断言**返回值**；
 *   不使用「源码里含某字符串」充当功能验收。7 类非法草案**各有至少一条负路径**（闸 1↔1 类）：
 *     闸1 schema=越界字段 / 闸2 required=空四段 / 闸3 provenance=幻觉 quoteRef /
 *     闸4 conservation=自检数字不符 / 闸5 shape=碎片率超限 / 闸6 dedupe=重名 / 闸7 hygiene=超长正文。
 */
import { createHarness } from './_harness.mjs'
import {
  validateUpgradeDraftPre,
  UPGRADE_DRAFT_VERSION,
  UPGRADE_DRAFT_LIMITS,
} from '../../lib/upgrade-draft.js'

const T = createHarness('upgrade-draft')

const WS = '--D--demo--'
/** 引擎侧已读好的真实文件内容表（形状 B：deps.files）。quoteRef 必须能在这里子串命中。 */
const FILES = {
  'handoff/PLAN.md': '# 项目白板\n白板：项目在做什么。\n下一步：接线。\n',
  '2026-10-24.md': '- 目标：做校验器\n- 进展：闸 1–7 落地\n- 卡点：无\n',
  '2026-10-25.md': '- 目标：跑验收\n- 进展：负路径七条\n- 卡点：无\n',
  '2026-10-26.md': '- 目标：集成\n- 进展：等 applier\n- 卡点：无\n',
  '2026-10-27.md': '- 目标：回归\n- 进展：全绿\n- 卡点：无\n',
}
/** 形状 A：函数式 deps（单测友好）。 */
const CTX_FN = {
  exists: (rel) => Object.prototype.hasOwnProperty.call(FILES, rel),
  readFile: (rel) => (Object.prototype.hasOwnProperty.call(FILES, rel) ? FILES[rel] : null),
  manifestWsKeys: [WS],
  logCount: 4,
}
/** 形状 B：P2 applier 的 ctx（内容前载 + ctx.wsKey + manifest）。 */
const CTX_MAP = {
  files: { ...FILES },
  wsKey: WS,
  logCount: 4,
  manifest: { wsKeys: [WS] },
}
const clone = (x) => JSON.parse(JSON.stringify(x))
const codesOf = (r) => (r && !r.ok ? r.code : 'ok')
const reasonsOf = (r) => (r && Array.isArray(r.detail) ? r.detail.map((d) => d.reason).join(' | ') : '')

/** 合法草案基线：2 事件 / 5 检查点 / 覆盖 4 篇日志（4/4=100%）、单检查点事件 0/2。 */
function makeDraft() {
  return {
    wsKey: WS,
    events: [
      {
        name: '事件 A', summary: '落地草案校验器', kind: 'ledger', confidence: 'high',
        sections: { goal: '落地闸 1–7', doing: '实现并自测', deadend: '无已知卡点', next: '接线 applier' },
        members: ['2026-10-24.md', '2026-10-25.md'],
        rationale: '同一目标：草案校验器',
        checkpoints: [
          { goal: '实现七闸', state: '已完成', dead: '', next: '自测', text: '实现闸 1–7', quoteRef: '- 目标：做校验器', rel: '2026-10-24.md', quoteLine: 1, idemKey: 'k-a1' },
          { goal: '自测', state: '已完成', dead: '', next: '验收', text: '负路径七条', quoteRef: '- 进展：闸 1–7 落地', rel: '2026-10-24.md', quoteLine: 2, idemKey: 'k-a2' },
        ],
      },
      {
        name: '事件 B', summary: '跑验收并准备集成', kind: 'ledger', confidence: 'high',
        sections: { goal: '验收七闸', doing: '跑负路径', deadend: '无', next: '集成' },
        members: ['2026-10-25.md', '2026-10-26.md', '2026-10-27.md'],
        rationale: '同一目标：验收与集成',
        checkpoints: [
          { goal: '验收', state: '已完成', dead: '', next: '集成', text: '负路径七条', quoteRef: '- 进展：负路径七条', rel: '2026-10-25.md', quoteLine: 2, idemKey: 'k-b1' },
          { goal: '集成', state: '待 applier', dead: '', next: '回归', text: '等 applier', quoteRef: '- 进展：等 applier', rel: '2026-10-26.md', quoteLine: 2, idemKey: 'k-b2' },
          { goal: '回归', state: '待跑', dead: '', next: '收尾', text: '全绿', quoteRef: '- 进展：全绿', rel: '2026-10-27.md', quoteLine: 2, idemKey: 'k-b3' },
        ],
      },
    ],
    selfCheck: { events: 2, checkpoints: 5, coveredLogs: 4 },
  }
}

/** 碎片化草案：4 事件 × 1 检查点（单检查点占比 100% > 30%），其余各闸均通过。 */
function makeFragmentDraft() {
  const logs = ['2026-10-24.md', '2026-10-25.md', '2026-10-26.md', '2026-10-27.md']
  return {
    wsKey: WS,
    events: logs.map((rel, i) => ({
      name: '碎片事件 ' + (i + 1), summary: '一件事被拆成碎片', kind: 'ledger', confidence: 'high',
      sections: { goal: '同一目标', doing: '同一进展', deadend: '无', next: '下一步' },
      members: [rel], rationale: '一个片段',
      checkpoints: [{ goal: '目标', state: '进展', dead: '', next: '下一步', text: '片段 ' + (i + 1), quoteRef: '- 目标：', rel, quoteLine: 1, idemKey: 'frag-' + i }],
    })),
    selfCheck: { events: 4, checkpoints: 4, coveredLogs: 4 },
  }
}

// ═══════════════ 0 · 模块契约面 ═══════════════
{
  T.eq(UPGRADE_DRAFT_VERSION, 'upgrade_draft_pre_v1', '★D-0 版本常量 = upgrade_draft_pre_v1')
  T.eq(UPGRADE_DRAFT_LIMITS.nameMax, 80, '★D-1 阈值 nameMax=80')
  T.eq(UPGRADE_DRAFT_LIMITS.summaryMax, 400, '★D-2 阈值 summaryMax=400')
  T.eq(UPGRADE_DRAFT_LIMITS.textMax, 2000, '★D-3 阈值 textMax=2000（单条）')
  T.eq(UPGRADE_DRAFT_LIMITS.singleCheckpointRatioMax, 0.3, '★D-4 阈值 单检查点占比 ≤30%')
  T.eq(UPGRADE_DRAFT_LIMITS.coveredLogsRatioMin, 0.8, '★D-5 阈值 coveredLogs ≥80%')
  T.ok(typeof validateUpgradeDraftPre === 'function', '★D-6 导出 validateUpgradeDraftPre 函数')
}

// ═══════════════ 1 · 合法草案 PASS（两种 deps 形状） ═══════════════
{
  T.eq(validateUpgradeDraftPre(makeDraft(), CTX_FN), { ok: true },
    '★★★D-7 合法草案 + 函数式 deps ⇒ 恰为 {ok:true}（无 error 字段）')

  const dNoWs = makeDraft()
  delete dNoWs.wsKey
  T.eq(validateUpgradeDraftPre(dNoWs, CTX_MAP), { ok: true },
    '★★★D-8 applier 形状（deps.files + ctx.wsKey + manifest）⇒ {ok:true}')

  const dManifestArr = makeDraft()
  T.eq(validateUpgradeDraftPre(dManifestArr, { ...CTX_FN, manifest: [WS] }).ok, true,
    '★D-9 manifest 为字符串数组形状也接受')

  const single = {
    wsKey: WS,
    events: [{
      name: '单事件', summary: '一个事件两个检查点', sections: { goal: 'g', doing: 'd', deadend: '无', next: 'n' },
      members: ['2026-10-24.md'], rationale: '同一目标',
      checkpoints: [
        { goal: 'g1', state: 's1', dead: '', next: 'n1', text: 't1', quoteRef: '白板', rel: 'handoff/PLAN.md', idemKey: 'one-1' },
        { goal: 'g2', state: 's2', dead: '', next: 'n2', text: 't2', quoteRef: '项目在做什么', rel: 'handoff/PLAN.md', idemKey: 'one-2' },
      ],
    }],
    selfCheck: { events: 1, checkpoints: 2, coveredLogs: 1 },
  }
  T.eq(validateUpgradeDraftPre(single, { ...CTX_FN, logCount: 1 }).ok, true,
    '★D-10 单事件草案（覆盖 1/1 篇日志、检查点声明覆盖成员的日志）⇒ 通过')
}

// ═══════════════ 2 · 闸 1 · Schema（越界字段/类型错） ═══════════════
{
  const d1 = makeDraft(); d1.bonus = 1
  const r1 = validateUpgradeDraftPre(d1, CTX_FN)
  T.eq(codesOf(r1), 'schema', '★★★D-11 闸1 负路径：顶层未知字段 ⇒ code=schema')
  T.ok(Array.isArray(r1.detail) && r1.detail.some((x) => x.path === 'bonus'), '★D-12 detail 指出越界字段路径 bonus')
  T.ok(Array.isArray(r1.errors) && r1.errors.some((s) => String(s).indexOf('bonus') >= 0), '★D-13 errors 扁平串也含字段名（applier 回执可用）')

  const d2 = makeDraft(); d2.events[1].checkpoints[0].evil = 'x'
  T.eq(codesOf(validateUpgradeDraftPre(d2, CTX_FN)), 'schema', '★★D-14 闸1 负路径：检查点未知字段 ⇒ schema')

  const d3 = makeDraft(); d3.selfCheck.extra = 1
  T.eq(codesOf(validateUpgradeDraftPre(d3, CTX_FN)), 'schema', '★★D-15 闸1 负路径：selfCheck 未知字段 ⇒ schema')

  const d4 = makeDraft(); d4.events = { not: 'array' }
  T.eq(codesOf(validateUpgradeDraftPre(d4, CTX_FN)), 'schema', '★★D-16 闸1 负路径：events 非数组 ⇒ schema')

  const d5 = makeDraft(); d5.events[0].startMs = '123'
  T.eq(codesOf(validateUpgradeDraftPre(d5, CTX_FN)), 'schema', '★★D-17 闸1 负路径：startMs 类型错 ⇒ schema')
}

// ═══════════════ 3 · 闸 2 · 必填（空四段 / 名过长 / summary 过长 / members 空 / 检查点四段） ═══════════════
{
  const d1 = makeDraft(); d1.events[0].sections.deadend = '   '
  const r1 = validateUpgradeDraftPre(d1, CTX_FN)
  T.eq(codesOf(r1), 'required', '★★★D-18 闸2 负路径：四段之一为空 ⇒ code=required（空四段必拒）')
  T.ok(r1.detail.some((x) => x.path === 'events[0].sections.deadend'), '★D-19 detail 指向具体空段')

  const d2 = makeDraft(); d2.events[0].name = '名'.repeat(81)
  T.eq(codesOf(validateUpgradeDraftPre(d2, CTX_FN)), 'required', '★★D-20 闸2 负路径：name 81 字 > 80 ⇒ required')

  const d3 = makeDraft(); d3.events[0].summary = '摘'.repeat(401)
  T.eq(codesOf(validateUpgradeDraftPre(d3, CTX_FN)), 'required', '★★D-21 闸2 负路径：summary 401 字 > 400 ⇒ required')

  const d4 = makeDraft(); d4.events[0].members = []
  T.eq(codesOf(validateUpgradeDraftPre(d4, CTX_FN)), 'required', '★★D-22 闸2 负路径：members 为空（<1）⇒ required')

  const d5 = makeDraft(); d5.events[0].rationale = '  '
  T.eq(codesOf(validateUpgradeDraftPre(d5, CTX_FN)), 'required', '★★D-23 闸2 负路径：rationale 空白 ⇒ required')

  const d6 = makeDraft(); d6.events[1].checkpoints[2].goal = ''
  T.eq(codesOf(validateUpgradeDraftPre(d6, CTX_FN)), 'required', '★★D-24 闸2 负路径：检查点 goal 为空（四段覆盖率 100%）⇒ required')

  const d7 = makeDraft(); delete d7.selfCheck
  T.eq(codesOf(validateUpgradeDraftPre(d7, CTX_FN)), 'schema', '★★D-25 闸1/2 负路径：缺 selfCheck ⇒ 拒（schema 先行，不静默补真值）')

  const d8 = makeDraft(); d8.wsKey = '--D--other--'
  const r8 = validateUpgradeDraftPre(d8, CTX_MAP)
  T.eq(codesOf(r8), 'required', '★★D-26 闸2 负路径：草案 wsKey 与 ctx.wsKey 不一致 ⇒ required')
  T.ok(reasonsOf(r8).indexOf('不一致') >= 0, '★D-27 拒因写明不一致')

  const d9 = makeDraft(); d9.wsKey = '--D--not-in-manifest--'
  T.eq(codesOf(validateUpgradeDraftPre(d9, CTX_FN)), 'required', '★★D-28 闸2 负路径：wsKey 不在 manifest 白名单 ⇒ required')
}

// ═══════════════ 4 · 闸 3 · 溯源真实性（幻觉 quoteRef / rel 不存在 / 白名单） ═══════════════
{
  const d1 = makeDraft(); d1.events[0].checkpoints[0].quoteRef = '这句原文根本不存在（幻觉引用）'
  const r1 = validateUpgradeDraftPre(d1, CTX_FN)
  T.eq(codesOf(r1), 'provenance', '★★★D-29 闸3 核心负路径：幻觉 quoteRef 子串未命中 ⇒ code=provenance')
  T.ok(reasonsOf(r1).indexOf('子串未命中') >= 0, '★D-30 拒因写明「子串未命中」（专挡幻觉引用）')

  const d2 = makeDraft(); d2.events[0].checkpoints[1].rel = '2026-10-30.md'
  T.eq(codesOf(validateUpgradeDraftPre(d2, CTX_FN)), 'provenance', '★★D-31 闸3 负路径：rel 指向不存在的文件 ⇒ provenance')

  const d3 = makeDraft(); d3.events[1].members[1] = '2026-10-28.md'
  T.eq(codesOf(validateUpgradeDraftPre(d3, { ...CTX_FN, manifestFiles: ['2026-10-24.md', '2026-10-25.md', '2026-10-26.md', '2026-10-27.md'] })), 'provenance',
    '★★D-32 闸3 负路径：members 引用不存在文件 ⇒ provenance')

  const d4 = makeDraft(); d4.events[0].members[0] = '2026-10-25.md'
  // 把成员换成白名单外但确实存在的文件，验证 manifestFiles 白名单生效（不是只看 exists）
  const r4 = validateUpgradeDraftPre(d4, { ...CTX_FN, manifestFiles: ['2026-10-24.md'] })
  T.eq(codesOf(r4), 'provenance', '★★D-33 闸3 负路径：文件存在但不在 manifest 文件白名单 ⇒ provenance')

  const d5 = makeDraft(); d5.events[0].checkpoints[0].quoteRef = ''
  T.eq(codesOf(validateUpgradeDraftPre(d5, CTX_FN)), 'provenance', '★★D-34 闸3 负路径：quoteRef 缺失（无法审计的传闻）⇒ provenance')

  const r6 = validateUpgradeDraftPre(makeDraft())
  T.eq(codesOf(r6), 'provenance', '★★D-35 闸3 fail-closed：未注入任何文件读取 ⇒ provenance（不静默放行）')
  T.ok(reasonsOf(r6).indexOf('fail closed') >= 0, '★D-36 拒因写明 fail closed')
}

// ═══════════════ 5 · 闸 4 · 守恒（自检数字与重算一致 + coveredLogs ≥80%） ═══════════════
{
  const d1 = makeDraft(); d1.selfCheck.events = 3
  const r1 = validateUpgradeDraftPre(d1, CTX_FN)
  T.eq(codesOf(r1), 'conservation', '★★★D-37 闸4 核心负路径：selfCheck.events 瞎报（3 vs 重算 2）⇒ code=conservation')
  T.ok(reasonsOf(r1).indexOf('重算不一致') >= 0, '★D-38 拒因给出草案值/重算值')

  const d2 = makeDraft(); d2.selfCheck.checkpoints = 4
  T.eq(codesOf(validateUpgradeDraftPre(d2, CTX_FN)), 'conservation', '★★D-39 闸4 负路径：selfCheck.checkpoints 少报（4 vs 5）⇒ conservation')

  const d3 = makeDraft(); d3.selfCheck.coveredLogs = 3
  T.eq(codesOf(validateUpgradeDraftPre(d3, CTX_FN)), 'conservation', '★★D-40 闸4 负路径：selfCheck.coveredLogs 错（3 vs 4）⇒ conservation')

  // 自检数字与重算一致，但引擎真值 logCount=8 ⇒ 覆盖率 4/8=50% < 80%
  const r4 = validateUpgradeDraftPre(makeDraft(), { ...CTX_FN, logCount: 8 })
  T.eq(codesOf(r4), 'conservation', '★★★D-41 闸4 负路径：coveredLogs 覆盖率 50% < 80% ⇒ conservation')
  T.ok(reasonsOf(r4).indexOf('覆盖率') >= 0, '★D-42 拒因写明覆盖率百分比')
}

// ═══════════════ 6 · 闸 5 · 形态（碎片率 / 事件数上界） ═══════════════
{
  const r1 = validateUpgradeDraftPre(makeFragmentDraft(), CTX_FN)
  T.eq(codesOf(r1), 'shape', '★★★D-43 闸5 负路径：单检查点事件占比 100% > 30% ⇒ code=shape（碎片化）')
  T.ok(reasonsOf(r1).indexOf('单检查点事件占比') >= 0, '★D-44 拒因给出碎片率')

  // 事件数上界：日志 0 篇 ⇒ 上界 0×1.5+5 = 5；构造 6 事件（每事件 2 检查点，避开碎片率）
  const many = {
    wsKey: WS,
    events: Array.from({ length: 6 }, (_, i) => ({
      name: '事件 ' + (i + 1), summary: '同一件事', kind: 'ledger', confidence: 'high',
      sections: { goal: 'g', doing: 'd', deadend: '无', next: 'n' },
      members: ['handoff/PLAN.md'], rationale: '同一目标',
      checkpoints: [
        { goal: 'g1', state: 's1', dead: '', next: 'n1', text: 't1', quoteRef: '白板', rel: 'handoff/PLAN.md', idemKey: 'many-' + i + '-1' },
        { goal: 'g2', state: 's2', dead: '', next: 'n2', text: 't2', quoteRef: '下一步', rel: 'handoff/PLAN.md', idemKey: 'many-' + i + '-2' },
      ],
    })),
    selfCheck: { events: 6, checkpoints: 12, coveredLogs: 0 },
  }
  const r2 = validateUpgradeDraftPre(many, { ...CTX_FN, logCount: 0 })
  T.eq(codesOf(r2), 'shape', '★★D-45 闸5 负路径：事件数 6 > 上界 5（0 日志×1.5+5）⇒ shape')
  T.ok(reasonsOf(r2).indexOf('上界') >= 0, '★D-46 拒因给出上界公式')
}

// ═══════════════ 7 · 闸 6 · 去重（草案内重名 / idemKey 重复 / 与既有事件重名） ═══════════════
{
  const d1 = makeDraft(); d1.events[1].name = '事件 A'
  const r1 = validateUpgradeDraftPre(d1, CTX_FN)
  T.eq(codesOf(r1), 'dedupe', '★★★D-47 闸6 负路径：草案内事件名重复 ⇒ code=dedupe')
  T.ok(reasonsOf(r1).indexOf('事件名重复') >= 0, '★D-48 拒因写明重名')

  const d2 = makeDraft(); d2.events[1].checkpoints[1].idemKey = 'k-a1'
  T.eq(codesOf(validateUpgradeDraftPre(d2, CTX_FN)), 'dedupe', '★★D-49 闸6 负路径：idemKey 重复 ⇒ dedupe')

  const r3 = validateUpgradeDraftPre(makeDraft(), { ...CTX_FN, existingEventNames: ['事件 a'] })
  T.eq(codesOf(r3), 'dedupe', '★★D-50 闸6 负路径：与既有事件重名（大小写/空白归一）⇒ dedupe')

  const r4 = validateUpgradeDraftPre(makeDraft(), { ...CTX_FN, existingIdemKeys: ['k-b2'] })
  T.eq(codesOf(r4), 'dedupe', '★★D-51 闸6 负路径：与既有检查点 idemKey 重复 ⇒ dedupe')
}

// ═══════════════ 8 · 闸 7 · 卫生（超长正文 / 乱码 / 复读 / base64 / HTML 注入） ═══════════════
{
  const longText = '这是一段很长的正文，用来触发单条上限判据。'.repeat(100) // 21×100 = 2100 字 > 2000
  T.eq(longText.length, 2100, '★D-52a 夹具自检：长正文实长 2100 > 2000（防夹具本身失效）')
  const d1 = makeDraft(); d1.events[0].sections.goal = longText
  const r1 = validateUpgradeDraftPre(d1, CTX_FN)
  T.eq(codesOf(r1), 'hygiene', '★★★D-52 闸7 负路径：单条正文 > 2000 字 ⇒ code=hygiene')
  T.ok(reasonsOf(r1).indexOf('单条') >= 0, '★D-53 拒因写明单条上限（实得 "' + reasonsOf(r1).slice(0, 80) + '"）')

  const d2 = makeDraft(); d2.events[0].summary = '<script>alert(1)</script>'
  T.eq(codesOf(validateUpgradeDraftPre(d2, CTX_FN)), 'hygiene', '★★D-54 闸7 负路径：HTML/脚本注入 ⇒ hygiene')

  const d3 = makeDraft(); d3.events[1].checkpoints[0].text = 'QUJD'.repeat(60)
  const r3 = validateUpgradeDraftPre(d3, CTX_FN)
  T.eq(codesOf(r3), 'hygiene', '★★D-55 闸7 负路径：base64 残骸行 ⇒ hygiene')
  T.ok(reasonsOf(r3).indexOf('base64') >= 0, '★D-56 拒因写明 base64')

  const d4 = makeDraft(); d4.events[0].sections.doing = '涓婁紶'
  const r4 = validateUpgradeDraftPre(d4, CTX_FN)
  T.eq(codesOf(r4), 'hygiene', '★★D-57 闸7 负路径：乱码（mojibake）⇒ hygiene')
  T.ok(reasonsOf(r4).indexOf('乱码') >= 0, '★D-58 拒因写明乱码')

  const d5 = makeDraft(); d5.events[0].sections.deadend = 'Run. Run. Run. Run.'
  const r5 = validateUpgradeDraftPre(d5, CTX_FN)
  T.eq(codesOf(r5), 'hygiene', '★★D-59 闸7 负路径：复读退化（stutter）⇒ hygiene')
}

// ═══════════════ 9 · 不得 throw + 异常折 internal + detail/errors 同源 ═══════════════
{
  let threw = false
  const cases = [null, undefined, [], 'x', 42, { events: 'no' }, { events: [], selfCheck: {} }]
  let allObjects = true
  try {
    for (const c of cases) {
      const r = validateUpgradeDraftPre(c, CTX_FN)
      if (!r || typeof r !== 'object') allObjects = false
      if (r.ok !== false) allObjects = false
      if (typeof r.code !== 'string' || !Array.isArray(r.detail)) allObjects = false
    }
  } catch (e) { threw = true }
  T.ok(threw === false, '★★★D-60 非法/异常入参 7 种一律不 throw')
  T.ok(allObjects, '★★D-61 全部返回 {ok:false, code:string, detail:[]}（fail closed 形状）')

  const rFn = validateUpgradeDraftPre(makeDraft(), {
    exists: () => true,
    readFile: () => { throw new Error('boom') },
    manifestWsKeys: [WS],
    logCount: 4,
  })
  T.eq(codesOf(rFn), 'provenance', '★★D-62 readFile 抛异常 ⇒ 折成 provenance（不冒泡）')

  const rBad = validateUpgradeDraftPre(makeDraft(), { ...CTX_FN, logCount: 8 })
  T.ok(rBad.detail.length > 0 && rBad.errors.length === rBad.detail.length, '★★D-63 errors 与 detail 一一对应（同一批错误）')
  T.ok(rBad.errors.every((s) => typeof s === 'string' && s.length > 0), '★D-64 errors 元素均为非空字符串')
}

// ═══════════════ 10 · 闸序：先结构后溯源（同一份烂草案给出最该修的那条） ═══════════════
{
  const d = makeDraft()
  d.events[0].sections.next = ''
  d.events[0].checkpoints[0].quoteRef = '幻觉'
  T.eq(codesOf(validateUpgradeDraftPre(d, CTX_FN)), 'required',
    '★★D-65 多闸同时不过 ⇒ 按闸序返回靠前的那条（required 先于 provenance）')
}

T.done()

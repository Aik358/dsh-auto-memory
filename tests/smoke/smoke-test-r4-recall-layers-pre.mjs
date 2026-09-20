#!/usr/bin/env node
/**
 * smoke-test-r4-recall-layers-pre —— R4 第 1 批（2026-09-18）
 *
 * 覆盖用户两个真实痛点：
 *   ① 「区分度有点问题，更加有含金量的结论和每一次都有的日志会混在一起」
 *      ⇒ R4-B 分层**呈现**：检索输出按层分组（结论层 / 流水层）。
 *   ② 「语音（语义）引擎的静默失效问题困扰我一些时间了……如果它会有回退或者不可用的状态，
 *      记得及时在日志里面报告」
 *      ⇒ R4-留痕补齐：`py → C2 → 词法` 三级降级链**每一跳**留痕。
 *
 * 本套件的**最高纪律**：R4-B 只改呈现、**绝不改排序**。因此断言分两层：
 *   · 行为层：分组不增删条目、层内保序、层序固定、单层时不打标题（逐字节兼容）
 *   · 源码层：确认 `sort` 调用点未被改动（防"顺手优化"改变排序）
 */

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  groupL0ByLayerPre, L0_LAYER_DISPLAY_ORDER_V1, L0_LAYER_LABELS_V1,
  L0_LAYER_UNKNOWN_LABEL_V1, classifyLayerPre,
} from '../../lib/l0-extract.js'
import { FUSION_LAYER_ORDER_V1 } from '../../lib/recall-fusion.js'
import { TIER_LAYER_ORDER_V1 } from '../../lib/tier-layer-inject.js'
import { createDegradeSinkPre } from '../../lib/degrade.js'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const SRC = readFileSync(path.resolve(HERE, '..', '..', 'lib', 'index.js'), 'utf8').replace(/\r\n/g, '\n')

let pass = 0, fail = 0
const ok = (c, n) => { if (c) { pass++; console.log('  ok -', n) } else { fail++; console.error('FAIL', n) } }
const eq = (a, b, n) => ok(a === b, n + (a === b ? '' : `  (期望 ${JSON.stringify(b)}，实得 ${JSON.stringify(a)})`))

// ══ 1. 常量与层序一致性 ═══════════════════════════════════════════
console.log('\n[1] 常量：层序与既有两处同序（跨模块不共享对象，靠断言锁相等）')
{
  eq(L0_LAYER_DISPLAY_ORDER_V1.length, 5, '层序 5 项')
  eq(L0_LAYER_DISPLAY_ORDER_V1[0], 'project', '首项 project（结论层最高优先）')
  eq(L0_LAYER_DISPLAY_ORDER_V1[4], 'log', '末项 log（流水层最低优先）')
  ok(Object.isFrozen(L0_LAYER_DISPLAY_ORDER_V1), '层序常量被冻结')
  ok(Object.isFrozen(L0_LAYER_LABELS_V1), '标题常量被冻结')

  // ★ 与融合侧 / 注入侧逐元素相同（三处必须同序，否则"分层"口径打架）
  const same = (a, b) => a.length === b.length && a.every((x, i) => x === b[i])
  ok(same([...L0_LAYER_DISPLAY_ORDER_V1], [...FUSION_LAYER_ORDER_V1]),
    '★ 与 FUSION_LAYER_ORDER_V1 逐元素相同')
  ok(same([...L0_LAYER_DISPLAY_ORDER_V1], [...TIER_LAYER_ORDER_V1]),
    '★ 与 TIER_LAYER_ORDER_V1 逐元素相同')

  // 五层标题齐全，且"结论"与"流水"措辞可分辨（这正是痛点的靶心）
  for (const l of L0_LAYER_DISPLAY_ORDER_V1) ok(!!L0_LAYER_LABELS_V1[l], `层 ${l} 有标题`)
  ok(L0_LAYER_LABELS_V1.project.includes('结论层'), 'project 标题含「结论层」')
  ok(L0_LAYER_LABELS_V1.user.includes('结论层'), 'user 标题含「结论层」')
  ok(L0_LAYER_LABELS_V1.whiteboard.includes('结论层'), 'whiteboard 标题含「结论层」')
  ok(L0_LAYER_LABELS_V1.log.includes('流水层'), 'log 标题含「流水层」')
  ok(L0_LAYER_UNKNOWN_LABEL_V1 === '未分层', '兜底标题 = 未分层（不猜层）')
}

// ══ 2. 分组：不增删、不改序、层序固定 ═════════════════════════════
console.log('\n[2] 分组语义：零信息损失（不增删条目、层内保序、层序固定）')
{
  const mk = (label, layer) => ({ label, layer })
  const items = [
    mk('a.log1', 'log'), mk('b.proj1', 'project'), mk('c.log2', 'log'),
    mk('d.user1', 'user'), mk('e.log3', 'log'),
  ]
  const g = groupL0ByLayerPre(items, (x) => x.layer)
  eq(g.length, 3, '三个层 → 三组')

  const flat = g.flatMap((x) => x.items)
  eq(flat.length, items.length, '★ 不增删条目（总数守恒）')
  eq(new Set(flat).size, items.length, '★ 无重复条目')
  // 层内保序：log 组内应为 log1,log2,log3（相对顺序 = 入参顺序）
  const logGroup = g.find((x) => x.layer === 'log')
  eq(logGroup.items.map((x) => x.label).join(','), 'a.log1,c.log2,e.log3', '★ 层内保持入参相对顺序')
  // 层序：project 在 user 前，user 在 log 前
  eq(g.map((x) => x.layer).join(','), 'project,user,log', '★ 组序 = 契约层序（非首次出现序）')
}

// ══ 3. 单层 / 空 / 异常：全部退化安全 ═══════════════════════════
console.log('\n[3] 退化安全：单层、空、非法入参、取层函数抛错')
{
  // 单层：只有一组 ⇒ 调用方不打标题 ⇒ 输出与旧版逐字节相同
  const one = groupL0ByLayerPre([{ l: 'log' }, { l: 'log' }], (x) => x.l)
  eq(one.length, 1, '★ 单层 → 恰 1 组（调用方据此不打标题 = 向后兼容）')
  eq(one[0].items.length, 2, '单层组内条目齐全')

  eq(groupL0ByLayerPre([], () => '').length, 0, '空数组 → 0 组')
  eq(groupL0ByLayerPre(null, () => '').length, 0, 'null → 0 组（不抛）')
  eq(groupL0ByLayerPre(undefined, () => '').length, 0, 'undefined → 0 组（不抛）')
  eq(groupL0ByLayerPre('notarray', () => '').length, 0, '非数组 → 0 组（不抛）')

  // 取层函数缺失 → 全部归"未分层"（不猜层）
  const noFn = groupL0ByLayerPre([{ l: 'x' }])
  eq(noFn.length, 1, '取层函数缺失 → 1 组')
  eq(noFn[0].layer, '', '归入空层键')
  eq(noFn[0].label, L0_LAYER_UNKNOWN_LABEL_V1, '★ 标题 = 未分层（不猜层，不给错误层次暗示）')

  // 取层函数抛错 → 该条归"未分层"，其余照常（绝不整批失败）
  let threw = false
  let g2
  try {
    g2 = groupL0ByLayerPre([{ l: 'log' }, { boom: true }, { l: 'log' }], (x) => { if (x.boom) throw new Error('bad'); return x.l })
  } catch (_) { threw = true }
  ok(!threw, '★ 取层函数抛错不冒泡（fail-soft：呈现层失败绝不打断检索）')
  eq(g2.flatMap((x) => x.items).length, 3, '抛错条目不丢失')

  // 判不出层的固定排最后
  const tail = groupL0ByLayerPre([{ l: 'weird-thing' }, { l: 'log' }], (x) => x.l)
  eq(tail[tail.length - 1].layer, '', '★ 判不出层的归末组（不给层次暗示）')
}

// ══ 4. 端到端：真实路径 → 层判定 → 分组 ═══════════════════════════
console.log('\n[4] 端到端：真实来源路径经 classifyLayerPre 后正确分层')
{
  const rows = [
    { p: '/ws/.dsh-memory/2026-09-18.md' },              // 流水
    { p: '/ws/.dsh-memory/MEMORY.md' },                  // 结论（项目笔记）
    { p: 'C:/Users/x/.dsh/memory/MEMORY.md' },           // 结论（用户级）
    { p: '/ws/.dsh-memory/handoff/PLAN.md' },            // 白板
    { p: '/ws/reflections/2026-09-17.md' },              // 反思
  ]
  const g = groupL0ByLayerPre(rows, (x) => x.p)
  const map = Object.fromEntries(g.map((x) => [x.layer, x.items.length]))
  eq(map.log, 1, '日志文件 → log 层')
  eq(map.project, 1, '工作区 MEMORY.md → project 层')
  eq(map.user, 1, '用户级 MEMORY.md → user 层')
  eq(map.whiteboard, 1, 'handoff/PLAN.md → whiteboard 层')
  eq(map.reflection, 1, 'reflections/ → reflection 层')

  // 组序：结论层（project/whiteboard/user）必须整体排在流水层（log）之前
  const order = g.map((x) => x.layer)
  ok(order.indexOf('project') < order.indexOf('log'), '★ 结论层排在流水层之前')
  ok(order.indexOf('whiteboard') < order.indexOf('log'), '★ 白板排在流水层之前')
  ok(order.indexOf('user') < order.indexOf('log'), '★ 用户级排在流水层之前')
  ok(order.indexOf('reflection') < order.indexOf('log'), '反思排在流水层之前')
}

// ══ 5. 源码守卫：呈现改动不得触碰排序 ═════════════════════════════
console.log('\n[5] 源码守卫：分层只改呈现，排序调用点必须原样保留')
{
  // ① L0 臂：遗留排序（legacy 路径）必须与改动前一字不差
  ok(SRC.includes('.sort((a, b) => b.lex - a.lex || (b.sem || 0) - (a.sem || 0) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))'),
    '★ legacy 排序表达式未改动（逐字符）')
  // ② 语义臂：纯分数倒序未改动（这是"结论被流水淹没"的既有事实，R4-B 不动它）
  ok(SRC.includes('.sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))'),
    '★ 语义臂分数排序未改动（R4-B 不改排序，只改呈现）')
  // ③ RRF 调用点未改动
  ok(SRC.includes('rankFusionRRFPre(l0Hits.map'), 'RRF 融合调用点未改动')

  // ④ 分组只出现在输出段，且就在 push 之前
  ok(SRC.includes('const groups0 = groupL0(l0Top, (c) => c.layer)'), 'L0 臂分组调用存在')
  ok(SRC.includes('const groupsS = groupSem(semHits, (s) => s.layer)'), '语义臂分组调用存在')
  const iSort = SRC.indexOf('const groups0 = groupL0(l0Top')
  const iSortSem = SRC.indexOf('const groupsS = groupSem(semHits')
  ok(iSort > SRC.indexOf('.sort((a, b) => b.lex - a.lex'), '★ L0 分组在排序之后（不介入排序）')
  ok(iSortSem > SRC.indexOf('.sort((a, b) => b[1] - a[1]'), '★ 语义分组在排序之后（不介入排序）')

  // ⑤ 单层不打标题的守卫（否则单层输出会多一行，破坏兼容）
  ok(SRC.includes('if (multi) out.push(') && SRC.includes('if (multiS) out.push('),
    '★ 两层各自有"仅多层才打标题"守卫')
  // ⑥ 行格式：★R4-A 落地（2026-09-19）后在**行尾追加可选标记**（`c.mark` / `s.mark`）。
  //    契约：无标记时 `mark === ''` ⇒ 拼接结果与旧版**逐字节相同**（向后兼容）；
  //          有标记时追加 ` ⚠已作废（已被 mem_… 取代）` / ` ⚠已撤回（…）`。
  ok(SRC.includes("out.push('· [' + c.id + '] ×' + sc + fr + ' ' + (c.reason || '语义') + ' ' + c.label + ' — ' + c.l0 + (c.mark || ''))"),
    '★ L0 行格式：前缀逐字符未变 + 行尾可选标记（R4-A）')
  ok(SRC.includes("out.push('· ' + s.label + ' [' + s.id8 + '] ×' + s.score.toFixed(2) + ' ' + s.l0 + (s.mark || ''))"),
    '★ 语义行格式：前缀逐字符未变 + 行尾可选标记（R4-A）')
  // 反向锁：无标记时必须为空串（否则会多出空格，破坏向后兼容）
  ok(SRC.includes("mark: markL0(it)") && SRC.includes("mark: rec.mark || ''"),
    '★ 标记来自 supersededMarkPre；缺省为空串（无标记 ⇒ 逐字节兼容）')
  // ⑦ p2 套件的字面量断言必须仍成立（防"顺手合并 import"造成假红）
  ok(SRC.includes("const { buildL0IndexPre } = await import('./l0-extract.js')"),
    '★ p2 锁定的 import 字面量仍在（未合并）')
}

// ══ 6. 留痕补齐：三级降级链每一跳可见 ═════════════════════════════
console.log('\n[6] 留痕补齐：py → C2 → 词法 每一跳留痕（源码级）')
{
  ok(SRC.includes("engine._rankPath = ''"), '★ 新增 _rankPath（本轮降级链快照）')
  ok(SRC.includes('engine._rankPath = hops.join(') , '★ 降级链被拼接成可读路径')
  ok(SRC.includes("engine._rankPath = 'c3(python)'"), '成功走 C3 时记录路径')
  // C2 成功时必须**带着前面 C3 那一跳的痕迹**一起记录（这正是"每一跳都可见"的实质）
  ok(SRC.includes("engine._rankPath = hops.join(' → ') + ' → c2(js)'"),
    '★ 成功走 C2 时保留 C3 跳的痕迹（hops 前缀未被丢弃）')
  ok(SRC.includes('词法(无语义臂)'), '落到词法时明确写出（不是静默）')
  ok(SRC.includes('c3 无结果') && SRC.includes('c2 无结果'), '★ 每一跳"无结果"都有痕迹')

  // 台账：只记预期外（抛错），不记合法回退（防噪音淹没信号）
  ok(SRC.includes("record('semantic-arm', 'c3(python) 跳抛错"), 'C3 跳抛错 → 记台账')
  ok(SRC.includes("record('semantic-arm', 'c2(js) 跳抛错"), 'C2 跳抛错 → 记台账')
  ok(!/record\('semantic-arm',[^)]*无结果/.test(SRC), '★ "无结果"不记台账（预期内分支，防刷屏）')

  // JS 语义引擎自身的静默 catch 必须已消除（**行为验证见 §7b**，此处只锁形态）
  ok(SRC.includes("engine._jsRankError = String((eJs && eJs.message) || eJs).slice(0, 140)"),
    '★ 捕获到的错误信息被留存（不是空串占位）')
  ok(SRC.includes("record('semantic-arm', 'js 语义引擎抛错"), '★ JS 引擎抛错 → 记台账')
  ok(!/return await engine\._jsSemantic\.rank\(corpusSnap, queryText\)\s*\}\s*catch \(_\) \{ return null \}/.test(SRC),
    '★ 原"catch(_){return null}"静默形态已不存在')
}

// ══ 7. 行为验证：台账真的收到记录（非仅源码接线） ═══════════════
console.log('\n[7] 行为验证：降级真的写进台账（避免"源码接线正确但功能不存在"）')
{
  const sink = createDegradeSinkPre({})
  eq(sink.countOf('semantic-arm'), 0, '初始台账为空')
  // 复刻生产判据：抛错记、无结果不记
  const recordOutcome = (s, { hop, threw, msg }) => {
    if (threw) s.record('semantic-arm', hop + ' 跳抛错 → 落下一级: ' + msg)
  }
  recordOutcome(sink, { hop: 'c3(python)', threw: false, msg: '' })   // 合法回退
  recordOutcome(sink, { hop: 'c2(js)', threw: true, msg: 'model corrupt' })
  eq(sink.countOf('semantic-arm'), 1, '★ 只有"抛错"进台账，"无结果"静默（判据正确）')
  const snap = sink.snapshot()
  ok(snap.counts['semantic-arm'] === 1, '快照 counts 可见')
  ok(snap.recent[0].reason.includes('c2(js)'), '快照 reason 指明是哪一跳')
  ok(snap.recent[0].reason.includes('model corrupt'), '快照 reason 保留原始错误（可诊断）')
}

// ══ 7b. 行为验证：抽源码真实执行降级链 ═══════════════════════════
console.log('\n[7b] 行为验证：抽源码执行 _semanticRankBest（证明留痕真的发生，非仅文本匹配）')
{
  // 从生产源码中抽出 `engine._semanticRankBest = async (...) => {...}` 的函数体，
  // 用 new Function 绑定假 engine 执行 —— 与 smoke-test-p2 抽 semanticArm 的手法同源。
  const marker = 'engine._semanticRankBest = async (corpusSnap, queryText) => {'
  const start = SRC.indexOf(marker)
  ok(start > 0, '找到 _semanticRankBest 定义')
  // 花括号配平求末尾
  let depth = 0, end = -1
  for (let i = start + marker.length - 1; i < SRC.length; i++) {
    if (SRC[i] === '{') depth++
    else if (SRC[i] === '}') { depth--; if (depth === 0) { end = i; break } }
  }
  ok(end > start, '函数体花括号配平')
  const body = SRC.slice(start + marker.length - 1, end + 1)   // 含首尾花括号

  function makeBest(engine) {
    return new Function('engine', 'return async (corpusSnap, queryText) => ' + body)(engine)
  }
  const mkEngine = (over = {}) => Object.assign({
    config: { semanticEngineMode: 'auto' },
    _rankPath: '',
    _degradeSink: createDegradeSinkPre({}),
    _pySemanticRank: async () => null,
    _jsSemanticRank: async () => null,
  }, over)

  // ① 全链落空 → 路径写明"落词法"，且**不**记台账（合法回退）
  {
    const e = mkEngine()
    const r = await makeBest(e)({}, 'q')
    eq(r, null, '全链落空返回 null')
    ok(e._rankPath.includes('c3 无结果') && e._rankPath.includes('c2 无结果') && e._rankPath.includes('词法(无语义臂)'),
      '★ 每一跳都有痕迹，末尾写明落到词法：' + e._rankPath)
    eq(e._degradeSink.countOf('semantic-arm'), 0, '★ 合法回退不记台账（不刷屏）')
  }
  // ② C3 抛错 → 落 C2 并成功；台账记 C3 抛错，路径保留 C3 痕迹
  {
    const e = mkEngine({
      _pySemanticRank: async () => { throw new Error('worker refused') },
      _jsSemanticRank: async () => ({ scores: new Map([['mem_a', 0.9]]) }),
    })
    const r = await makeBest(e)({}, 'q')
    ok(r && r.scores, 'C3 抛错后 C2 接手成功')
    eq(e._degradeSink.countOf('semantic-arm'), 1, '★ C3 抛错记台账一次')
    ok(e._degradeSink.snapshot().recent[0].reason.includes('worker refused'), '台账保留原始错误')
    ok(e._rankPath.includes('c3 抛错') && e._rankPath.includes('c2(js)'),
      '★ 路径同时含"C3 抛错"与 C2 成功：' + e._rankPath)
  }
  // ③ 全链抛错 → 台账两条（c3 一条、c2 一条），路径含两处抛错
  {
    const e = mkEngine({
      _pySemanticRank: async () => { throw new Error('py down') },
      _jsSemanticRank: async () => { throw new Error('js corrupt') },
    })
    const r = await makeBest(e)({}, 'q')
    eq(r, null, '两级都抛错 → null')
    eq(e._degradeSink.countOf('semantic-arm'), 2, '★ 两级抛错各记一条（每一跳都可见）')
    const reasons = e._degradeSink.snapshot().recent.map((x) => x.reason).join(' | ')
    ok(reasons.includes('py down') && reasons.includes('js corrupt'), '两条原因各自保留')
    ok(e._rankPath.includes('c3 抛错') && e._rankPath.includes('c2 抛错'), '路径含两处抛错')
  }
  // ④ lexical 档：不尝试任何语义臂，且如实写明
  {
    let pyCalled = 0
    const e = mkEngine({
      config: { semanticEngineMode: 'lexical' },
      _pySemanticRank: async () => { pyCalled++; return null },
    })
    const r = await makeBest(e)({}, 'q')
    eq(r, null, 'lexical 档返回 null')
    eq(pyCalled, 0, '★ lexical 档不调 python 臂')
    ok(e._rankPath.includes('lexical'), '路径写明"配置 lexical"')
    eq(e._degradeSink.countOf('semantic-arm'), 0, 'lexical 是配置选择，不是降级，不记台账')
  }
  // ⑤ C3 成功 → 路径 c3，无 hops 残留
  {
    const e = mkEngine({ _pySemanticRank: async () => ({ scores: new Map([['mem_x', 0.8]]) }) })
    const r = await makeBest(e)({}, 'q')
    ok(r && r.scores, 'C3 成功返回 scores')
    eq(e._rankPath, 'c3(python)', '路径 = c3(python)（干净，无多余前缀）')
    eq(e._degradeSink.countOf('semantic-arm'), 0, '成功不记台账')
  }
  // ⑥ ★关键回归：`_jsSemanticRank` 自身抛错时也要留痕（用户痛点的最核心一处）
  {
    const jsMarker = 'engine._jsSemanticRank = async (corpusSnap, queryText) => {'
    const jsStart = SRC.indexOf(jsMarker)
    ok(jsStart > 0, '找到 _jsSemanticRank 定义')
    // 该函数体里含 try/catch，取到第一个顶层配平即可
    let d2 = 0, e2 = -1
    for (let i = jsStart + jsMarker.length - 1; i < SRC.length; i++) {
      if (SRC[i] === '{') d2++
      else if (SRC[i] === '}') { d2--; if (d2 === 0) { e2 = i; break } }
    }
    const jsBody = SRC.slice(jsStart + jsMarker.length - 1, e2 + 1)
    const e = {
      _jsRankTier: '', _jsRankError: '',
      _degradeSink: createDegradeSinkPre({}),
      resolveSemanticTier: async () => 'c2',
      _jsSemantic: { rank: async () => { throw new Error('onnx session lost') } },
    }
    const jsRank = new Function('engine', 'return async (corpusSnap, queryText) => ' + jsBody)(e)
    const r = await jsRank({}, 'q')
    eq(r, null, 'JS 引擎抛错返回 null（fail-soft 保持）')
    eq(e._degradeSink.countOf('semantic-arm'), 1, '★ JS 引擎抛错记台账（用户痛点：静默失效已消除）')
    ok(e._degradeSink.snapshot().recent[0].reason.includes('onnx session lost'), '台账含原始错误')
    ok(e._jsRankError.includes('onnx session lost'), '★ 错误信息被留存到 _jsRankError')

    // 对照：tier 不是 c2（资产未就绪）是**预期内**，必须静默
    const e3 = {
      _jsRankTier: '', _jsRankError: '',
      _degradeSink: createDegradeSinkPre({}),
      resolveSemanticTier: async () => 'c1',
      _jsSemantic: { rank: async () => { throw new Error('不该被调用') } },
    }
    const r3 = await new Function('engine', 'return async (c, q) => ' + jsBody)(e3)({}, 'q')
    eq(r3, null, 'C1 档返回 null')
    eq(e3._degradeSink.countOf('semantic-arm'), 0, '★ 资产未就绪（c1）不记台账（预期内，防刷屏）')
    eq(e3._jsRankTier, 'c1', '档位被记录（诊断可见"为什么没有语义臂"）')
  }
}

console.log(`\n[r4-recall-layers] ${pass}/${pass + fail} assertions passed`)
if (fail) process.exit(1)
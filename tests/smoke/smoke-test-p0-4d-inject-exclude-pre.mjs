#!/usr/bin/env node
/**
 * 群反馈第 4 条 / P0-④d 回归:注入来源排除 + 注入上限。
 *
 * 要解决的问题(原文):「避免因为记忆问题导致结果一路走错」——
 * 记忆一旦被判定为错的(某条白板段、某天日志段),仍会**每轮**被重新灌进上下文。
 * `supersede` 只能覆盖"被新版本替代",覆盖不了"这条来源整个不可信、我不想再看到它"。
 *
 * 验收判据(卡片原文):
 *   ① 被排除的来源在后续注入中 **0 次出现**;
 *   ② 上限生效且超限时的取舍规则**写死在代码里(可测)**。
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  filterExcludedSourcesPre, composeTieredInjectionPre, TIER_BUDGET_PRE_V1,
} from '../../lib/tier-layer-inject-pre.js'

const ID = (c) => 'mem_' + c.repeat(32)
const hit = (over = {}) => ({ memoryId: ID('a'), score: 1, excerpt: '片段', layer: 'log', status: 'current', ...over })

// ---------- A. 排除匹配口径（写死、可测） ----------

test('A1 无排除项 → 原样放行,不产生排除账', () => {
  const hits = [hit(), hit({ memoryId: ID('b') })]
  const r = filterExcludedSourcesPre(hits, [])
  assert.equal(r.kept.length, 2)
  assert.equal(r.droppedCount, 0)
  assert.deepEqual(r.matchedPatterns, [])
})

test('A2 按记忆 id 精确排除(只挡那一条)', () => {
  const target = ID('d')
  const hits = [hit({ memoryId: target }), hit({ memoryId: ID('e') })]
  const r = filterExcludedSourcesPre(hits, [target])
  assert.equal(r.kept.length, 1)
  assert.equal(r.kept[0].memoryId, ID('e'))
  assert.deepEqual(r.matchedPatterns, [target])
})

test('A3 按整层排除(log 整层挡下,其它层保留)', () => {
  const hits = [hit({ layer: 'log' }), hit({ layer: 'whiteboard' }), hit({ layer: 'project' })]
  const r = filterExcludedSourcesPre(hits, ['log'])
  assert.equal(r.droppedCount, 1)
  assert.deepEqual(r.kept.map((h) => h.layer).sort(), ['project', 'whiteboard'])
})

test('A4 按目录前缀排除(以分隔符结尾)', () => {
  const hits = [hit({ path: 'D:\\ws\\.dsh-memory\\archive\\2026-09-01.md' }), hit({ path: 'D:\\ws\\.dsh-memory\\MEMORY.md' })]
  const r = filterExcludedSourcesPre(hits, ['D:\\ws\\.dsh-memory\\archive\\'])
  assert.equal(r.droppedCount, 1)
  assert.equal(r.kept.length, 1)
  assert.ok(r.kept[0].path.endsWith('MEMORY.md'))
})

test('A5 按精确文件路径排除', () => {
  const hits = [hit({ path: 'D:\\ws\\.dsh-memory\\MEMORY.md' }), hit({ path: 'D:\\ws\\.dsh-memory\\PLAN.md' })]
  const r = filterExcludedSourcesPre(hits, ['D:\\ws\\.dsh-memory\\MEMORY.md'])
  assert.equal(r.droppedCount, 1)
  assert.ok(r.kept[0].path.endsWith('PLAN.md'))
})

test('A6 Windows 路径大小写不敏感 + 分隔符统一(D:\\WS\\... 等价 d:/ws/...)', () => {
  const hits = [hit({ path: 'D:\\WS\\.dsh-memory\\MEMORY.md' })]
  const r = filterExcludedSourcesPre(hits, ['d:/ws/.dsh-memory/memory.md'])
  assert.equal(r.droppedCount, 1, '大小写/分隔符差异不得导致漏挡')
})

test('A7 不做模糊猜测:相似但不同的路径不得被误挡', () => {
  const hits = [hit({ path: 'D:\\ws\\.dsh-memory-other\\MEMORY.md' }), hit({ path: 'D:\\ws\\.dsh-memory\\MEMORY-2.md' })]
  const r = filterExcludedSourcesPre(hits, ['D:\\ws\\.dsh-memory\\MEMORY.md'])
  assert.equal(r.droppedCount, 0, '只允许精确/前缀匹配,不得前缀"软"命中')
})

test('A8 excerpt 文本里的路径不作为排除依据(防止误伤)', () => {
  // path 字段缺失、只有正文提到路径时,不得据此排除
  const hits = [hit({ path: '', excerpt: '见 D:\\ws\\.dsh-memory\\archive\\x.md 的说明' })]
  const r = filterExcludedSourcesPre(hits, ['D:\\ws\\.dsh-memory\\archive\\'])
  assert.equal(r.droppedCount, 0, '排除必须依据结构化路径字段,不能扫正文')
})

test('A9 空/空白/非字符串模式安全忽略,不抛异常', () => {
  const hits = [hit()]
  for (const pats of [[null], [undefined], [''], ['   '], [0], [{}], null, undefined]) {
    const r = filterExcludedSourcesPre(hits, pats)
    assert.equal(r.kept.length, 1, '无效模式不得挡下任何条目: ' + JSON.stringify(pats))
  }
})

// ---------- B. 与被排除项的组合语义 ----------

test('B1 多条排除项各自生效,matchedPatterns 只列真正命中的', () => {
  const hits = [hit({ memoryId: ID('a'), layer: 'log' }), hit({ memoryId: ID('b'), layer: 'user' })]
  const r = filterExcludedSourcesPre(hits, [ID('a'), 'reflection' /* 无人命中 */])
  assert.equal(r.droppedCount, 1)
  assert.deepEqual(r.matchedPatterns, [ID('a')], '未命中的模式不得进账')
})

test('B2 排除账透出到 compose 结果(可观测,不静默)', () => {
  const src = [{ layer: 'log', text: '日志正文', path: 'D:\\ws\\.dsh-memory\\logs\\2026-09-16.md' }]
  const hits = [hit({ layer: 'log', path: 'D:\\ws\\.dsh-memory\\logs\\2026-09-16.md' })]
  const res = composeTieredInjectionPre({ sources: src, hits, excludeSources: ['log'], question: '为什么' })
  assert.equal(res.excluded.count, 1, 'compose 必须透出被排除条数')
  assert.deepEqual(res.excluded.patterns, ['log'])
})

test('B3 被排除的来源**0 次出现**在注入正文里(卡片验收判据①)', () => {
  const src = [{ layer: 'log', text: '日志正文', path: 'p1' }]
  // 关键:被排除项的 excerpt 是独特串,若仍出现即证明"排除了却照样注入"
  const hits = [hit({ layer: 'log', path: 'p1', excerpt: '独特串_UNIQUE_EXCLUDED_XYZ', memoryId: ID('f') })]
  const res = composeTieredInjectionPre({ sources: src, hits, excludeSources: [ID('f')], question: '为什么要这样' })
  assert.equal(res.excluded.count, 1)
  assert.ok(!res.text.includes('独特串_UNIQUE_EXCLUDED_XYZ'), '被排除条目的正文不得出现在注入里')
  assert.equal(res.hits.kept.length, 0, '被排除项不得留在命中集合(不得影响下探决策与预算)')
})

test('B4 未配置排除时行为与修前完全一致(开关解耦:不配就不影响)', () => {
  const src = [{ layer: 'log', text: '日志正文', path: 'p1' }]
  const hits = [hit({ layer: 'log', path: 'p1' })]
  const a = composeTieredInjectionPre({ sources: src, hits, question: '为什么' })
  const b = composeTieredInjectionPre({ sources: src, hits, excludeSources: [], question: '为什么' })
  assert.equal(a.text, b.text, '空排除项不得改变注入文本')
  assert.equal(b.excluded.count, 0)
})

test('B5 被排除项与 I5 状态过滤各自独立成账(两类挡下可区分)', () => {
  const src = [{ layer: 'log', text: 'x', path: 'p1' }]
  const hits = [
    hit({ memoryId: ID('1'), status: 'current', layer: 'log' }),      // 保留
    hit({ memoryId: ID('2'), status: 'superseded', layer: 'log' }),   // I5 挡下
    hit({ memoryId: ID('3'), status: 'current', layer: 'log' }),      // 用户排除挡下
  ]
  const res = composeTieredInjectionPre({ sources: src, hits, excludeSources: [ID('3')], question: '为什么' })
  assert.equal(res.hits.droppedCount, 1, 'I5 账:1 条 superseded')
  assert.equal(res.excluded.count, 1, '排除账:1 条用户排除')
  assert.equal(res.hits.kept.length, 1, '两类挡下后只剩 1 条')
})

// ---------- C. 上限（卡片验收判据②：写死在代码里、可测） ----------

test('C1 注入上限写死在冻结常量里(可测,不靠约定)', () => {
  assert.ok(Object.isFrozen(TIER_BUDGET_PRE_V1), '预算常量必须冻结(改不动=写死)')
  for (const k of ['B0', 'L1', 'K', 'B2', 'maxTier2Blocks']) {
    assert.equal(typeof TIER_BUDGET_PRE_V1[k], 'number', '预算项必须可测: ' + k)
  }
})

test('C2 超预算时剪辑生效且**如实标注**超额(尽力门,不假装达标)', () => {
  const huge = 'x'.repeat(50)
  const src = [{ layer: 'log', text: huge, path: 'p1' }]
  const many = Array.from({ length: 30 }, (_, i) => hit({ memoryId: ID(((i % 16).toString(16))), excerpt: huge, layer: 'log', path: 'p1' }))
  const res = composeTieredInjectionPre({ sources: src, hits: many, question: '为什么这样做', maxTotalChars: 200 })
  assert.ok(res.text.length > 0, '不得裁成空')
  // 语义(既有设计):目录层与降级标注按 I7 不可裁 ⇒ 允许显式超额,但必须**如实标注**,
  // 且下探段必须被裁剪(trimmedLines>0)。绝不静默超限。
  assert.ok(res.trimmedLines > 0, '下探段必须被裁剪(实得 ' + res.trimmedLines + ')')
  assert.ok(res.textChars === res.claimedTotalChars, '声称长度必须等于实际长度(两本账合一)')
  if (res.textChars > 200) {
    assert.ok(res.headOverBudgetChars > 0, '超限时必须给出显式超额量,不得静默')
    assert.ok(/不可裁|超出|超额/.test(res.text), '超限须在正文里可见')
  }
})

test('C3 超限取舍规则写死:裁剪留下可见标注 + 进降级账(不静默)', () => {
  const src = [{ layer: 'log', text: 'x'.repeat(400), path: 'p1' }]
  const many = Array.from({ length: 40 }, (_, i) => hit({ memoryId: ID(((i % 16).toString(16))), excerpt: 'y'.repeat(60), layer: 'log', path: 'p1' }))
  const res = composeTieredInjectionPre({ sources: src, hits: many, question: '为什么这样做', maxTotalChars: 300 })
  assert.ok(res.trimmedLines > 0, '超限必须发生裁剪(取舍规则生效)')
  // 裁剪标注直接写在注入正文里(E7/I7:读者能看见"这里被裁过")
  assert.ok(/裁剪/.test(res.text), '裁剪必须留下可见标注')
  assert.ok(Array.isArray(res.degradations) && res.degradations.length > 0, '须有降级账,不得静默')
})

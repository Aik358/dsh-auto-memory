/**
 * A12 / #432 · Tier-0 目录来源绕过了用户排除项（2026-10-17）
 *
 * 缺陷：`composeTieredInjectionPre` 只对 **hits** 调 `filterExcludedSourcesPre`，
 * 而 Tier-0 目录是从**未过滤**的 `o.sources` 原文重建的 ⇒ 用户「不让 AI 使用的来源」
 * 仍以**每轮常驻**的方式进上下文（最贵的那条通道）。
 *
 * 修法要点（本套件同时锁住）：
 *   ① 新增 `filterExcludedCatalogSourcesPre(sources, patterns)`，与 hits 版**共用**
 *      `matchExcludePatternPre` + `filterByExcludePatternsPre`（禁止各写一份，复制即漂移源）；
 *   ② 排除作用在 `buildTier0CatalogFromTextPre` 的**入参**（items 已丢 path，建完再过滤反查不回去）；
 *   ③ 目录层挡下**不静默**（I7）：新增 `excluded-catalog-source` 降级行，只含来源数/模式，不含正文；
 *   ④ `o.catalog` 外部成品目录无法回溯来源 ⇒ 显式记 `excluded-catalog-unverifiable`（能力边界不静默）。
 *
 * 判据纪律（CR-10）：全部真 import → 真调用 → 断言返回值；不拿"源码含某字符串"当功能验收。
 *
 * 变异验证（施工记录报两次数值）：
 *   把 `buildTier0CatalogFromTextPre(catalogSources, ...)` 改回 `(Array.isArray(o.sources) ? o.sources : [])`
 *   ⇒ [1][2][3][6][9] 必红；还原 ⇒ 全绿。
 *
 * 纯 Node、零依赖、不联网、不启宿主。
 */
import {
  composeTieredInjectionPre,
  filterExcludedSourcesPre,
  filterExcludedCatalogSourcesPre,
} from '../../lib/tier-layer-inject.js'
import { buildTier0CatalogFromTextPre } from '../../lib/tier0-catalog.js'

let pass = 0, fail = 0
const ok = (cond, name) => { if (cond) { pass++; console.log('  ok   - ' + name) } else { fail++; console.error('  RED  - ' + name) } }
const eq = (got, want, name) => ok(JSON.stringify(got) === JSON.stringify(want),
  name + ' got=' + JSON.stringify(got) + ' want=' + JSON.stringify(want))

const WS = 'D:\\ws\\.dsh-memory'
const PROJ_PATH = WS + '\\MEMORY.md'
const LOG_PATH = WS + '\\2026-09-14.md'
const ARCHIVE_PATH = WS + '\\archive\\2026-09-01.md'
const PLAN_PATH = WS + '\\handoff\\PLAN.md'

const PROJ = '项目结论句_A12_PROJ_SENTINEL'
const LOG = '日志结论句_A12_LOG_SENTINEL'
const ARCH = '归档结论句_A12_ARCH_SENTINEL'
const PLAN = '白板结论句_A12_PLAN_SENTINEL'

const SOURCES = [
  { layer: 'project', text: '## 2026-09-01 项目段\n- ' + PROJ + '：项目正文足够长。补充句。', path: PROJ_PATH },
  { layer: 'log', text: '## 2026-09-02 日志段\n- ' + LOG + '：日志正文足够长。补充句。', path: LOG_PATH },
  { layer: 'whiteboard', text: '# 白板\n\n## 白板段\n' + PLAN + '：白板正文足够长。补充句。', path: PLAN_PATH },
]

// ─────────────────────────────────────────────────────────────
console.log('[A12-1] 正路径：按层名排除 ⇒ 该层来源不进目录（这是修前必红的场景）')
{
  const r = composeTieredInjectionPre({ sources: SOURCES, hits: [], excludeSources: ['project'], question: '' })
  ok(r.text.includes('[Tier-0 常驻目录'), '目录段仍在（不是把整段注入砍掉）')
  ok(!r.text.includes(PROJ), '★ 被排除层（project）的正文不进目录文本')
  ok(!r.text.includes('项目段'), '★ 被排除层的标题也不进目录')
  ok(r.text.includes(LOG) && r.text.includes(PLAN), '未排除的层照常进目录（对照项，防"整段吞掉"）')
  // ★账实一致：降级行声称"挡下 N 个来源"时，目录条目数**必须真的减少**（防"只记账不生效"）
  const all = composeTieredInjectionPre({ sources: SOURCES, hits: [], question: '' })
  ok(all.tier0.items.length > r.tier0.items.length,
    '★ 账实一致：声称挡下来源时目录条目数必须真的减少（全量 ' + all.tier0.items.length + ' → 过滤后 ' + r.tier0.items.length + '）')
  eq(r.excluded.catalog.count, 1, '★ 目录层排除账：挡下 1 个来源')
  eq(r.excluded.catalog.patterns, ['project'], '★ 目录层排除账：命中的模式可观测')
  eq(r.excluded.count, 0, '命中层排除账为 0（本轮 hits 为空，两本账分开）')
  ok(r.degradations.some((d) => d.code === 'excluded-catalog-source'), '★ 降级项 code=excluded-catalog-source（不静默）')
  const d = r.degradations.find((x) => x.code === 'excluded-catalog-source')
  ok(d.text.includes('挡下 1 个来源') && d.text.includes('project'), '降级行写明来源数与模式')
  ok(d.text.includes('目录层同步不注入'), '降级行说明目录层同步不注入')
  ok(!d.text.includes(PROJ), '★ 降级行不含被排除来源的正文')
}

// ─────────────────────────────────────────────────────────────
console.log('[A12-2] 正路径：按精确文件路径排除 ⇒ 该来源不进目录')
{
  const r = composeTieredInjectionPre({ sources: SOURCES, hits: [], excludeSources: [PROJ_PATH], question: '' })
  ok(!r.text.includes(PROJ), '★ 精确路径排除 ⇒ 该项目来源不进目录')
  ok(r.text.includes(LOG), '其它来源照常（对照项）')
  eq(r.excluded.catalog.count, 1, '目录层挡下 1 个来源')
  eq(r.excluded.catalog.patterns, [PROJ_PATH], '命中的是精确路径模式')

  // Windows 大小写/分隔符差异不得导致漏挡（与 hits 版同一归一化）
  const r2 = composeTieredInjectionPre({ sources: SOURCES, hits: [], excludeSources: ['d:/ws/.dsh-memory/memory.md'], question: '' })
  ok(!r2.text.includes(PROJ), '★ 大小写/分隔符不同仍挡住（同一归一化口径）')
  eq(r2.excluded.catalog.count, 1, '归一化后同样命中 1 个来源')
}

// ─────────────────────────────────────────────────────────────
console.log('[A12-3] 正路径：按目录前缀排除 ⇒ 前缀下的来源不进目录')
{
  const src = SOURCES.concat([{ layer: 'reflection', text: '## 2026-09-03 反思段\n- ' + ARCH + '：反思正文足够长。补充句。', path: ARCHIVE_PATH }])
  const r = composeTieredInjectionPre({ sources: src, hits: [], excludeSources: [WS + '\\archive\\'], question: '' })
  ok(!r.text.includes(ARCH), '★ 目录前缀排除 ⇒ archive 下的来源不进目录')
  ok(r.text.includes(PROJ), '其它来源照常（对照项）')
  eq(r.excluded.catalog.count, 1, '目录层挡下 1 个来源')
}

// ─────────────────────────────────────────────────────────────
console.log('[A12-4] 负路径①：不配排除 ⇒ 注入文本与"空排除项"逐字节相同（开关解耦）')
{
  const a = composeTieredInjectionPre({ sources: SOURCES, hits: [], question: '' })
  const b = composeTieredInjectionPre({ sources: SOURCES, hits: [], excludeSources: [], question: '' })
  eq(a.text, b.text, '★ 空排除项不改变注入文本（逐字节）')
  const c = composeTieredInjectionPre({ sources: SOURCES, hits: [], excludeSources: ['   '], question: '' })
  eq(a.text, c.text, '★ 空白排除项同样不改变文本')
  eq(b.excluded.catalog.count, 0, '空排除项 ⇒ 目录层挡下 0')
  ok(!a.degradations.some((d) => d.code === 'excluded-catalog-source'), '不配排除 ⇒ 不出现目录层排除降级行')

  // 与"手工按全部来源建目录"的结果一致（证明未配排除时真的走了全量来源）
  const manual = buildTier0CatalogFromTextPre(SOURCES, {
    maxTokens: 800, estimateMode: 'conservative',
    quota: { projectRatio: 0.6, floorRatio: 0.1 },
  })
  eq(a.tier0.items.map((i) => i.title), manual.items.map((i) => i.title), '★ 未配排除 ⇒ 目录条目与手工全量构建一致')
}

// ─────────────────────────────────────────────────────────────
console.log('[A12-5] 负路径②：模式只命中 hits、不命中任何来源 ⇒ 不误挡目录')
{
  const hits = [{ memoryId: 'mem_' + 'a'.repeat(32), score: 0.9, excerpt: '命中摘要_A12_HIT', layer: 'log', status: 'current', path: LOG_PATH }]
  const r = composeTieredInjectionPre({ sources: SOURCES, hits, excludeSources: ['mem_' + 'a'.repeat(32)], question: '再看看' })
  eq(r.excluded.count, 1, '命中层：挡下 1 条（模式是记忆 id）')
  eq(r.excluded.catalog.count, 0, '★ 目录层：记忆 id 对来源无意义 ⇒ 一个来源都不挡（不误伤）')
  ok(r.text.includes(PROJ) && r.text.includes(LOG) && r.text.includes(PLAN), '★ 三个来源全都仍在目录里')
  ok(!r.text.includes('命中摘要_A12_HIT'), '被排除的命中确实没进注入')
  ok(!r.degradations.some((d) => d.code === 'excluded-catalog-source'), '未误挡 ⇒ 不出现目录层排除降级行（判据有鉴别力）')
}

// ─────────────────────────────────────────────────────────────
console.log('[A12-6] 负路径③：目录层挡下的条数 == 被排除来源产生的条目数')
{
  // 单来源多条目：排除后目录条目数必须恰好减去该来源的条目数
  const multi = [
    { layer: 'project', text: '## 2026-09-01 甲段\n- 甲结论足够长。补充句。\n## 2026-09-02 乙段\n- 乙结论足够长。补充句。', path: PROJ_PATH },
    { layer: 'log', text: '## 2026-09-03 丙段\n- 丙结论足够长。补充句。', path: LOG_PATH },
  ]
  const all = composeTieredInjectionPre({ sources: multi, hits: [], question: '' })
  const filtered = composeTieredInjectionPre({ sources: multi, hits: [], excludeSources: ['project'], question: '' })
  eq(all.tier0.items.length, 3, '未排除：3 条（project 2 + log 1）')
  eq(filtered.tier0.items.length, 1, '★ 排除 project：只剩 1 条（log）')
  eq(all.tier0.items.length - filtered.tier0.items.length, 2, '★ 差值 == 被排除来源的条目数（2）')
  eq(filtered.excluded.catalog.count, 1, '被排除的是 1 个**来源**（不是 2 个条目 —— 两本账不同口径）')
}

// ─────────────────────────────────────────────────────────────
console.log('[A12-7] 负路径④：空/非法 pattern 安全忽略、不抛')
{
  for (const pats of [[null], [undefined], [''], ['   '], [0], [{}], null, undefined, [false]]) {
    let threw = null
    let r = null
    try {
      r = composeTieredInjectionPre({ sources: SOURCES, hits: [], excludeSources: pats, question: '' })
    } catch (e) { threw = e }
    ok(threw === null, '非法排除项不抛: ' + JSON.stringify(pats))
    ok(r && r.excluded.catalog.count === 0, '非法排除项不挡任何来源: ' + JSON.stringify(pats))
    ok(r && r.text.includes(PROJ), '非法排除项下来源仍在目录: ' + JSON.stringify(pats))
  }
  // 纯函数本身对非法入参也不抛
  let threw2 = null
  try {
    filterExcludedCatalogSourcesPre(null, null)
    filterExcludedCatalogSourcesPre('x', ['y'])
    filterExcludedCatalogSourcesPre([], undefined)
  } catch (e) { threw2 = e }
  ok(threw2 === null, 'filterExcludedCatalogSourcesPre 对非法入参 fail-soft')
  eq(filterExcludedCatalogSourcesPre(null, ['log']), { kept: [], dropped: [], total: 0, droppedCount: 0, matchedPatterns: [] },
    '非法入参返回空账（形状稳定）')
}

// ─────────────────────────────────────────────────────────────
console.log('[A12-8] 两个过滤器的形状与判定**同源**（禁止各写一份 ⇒ 防漂移）')
{
  const keys = (o) => Object.keys(o).sort()
  eq(keys(filterExcludedCatalogSourcesPre(SOURCES, ['log'])), keys(filterExcludedSourcesPre([], ['log'])),
    '★ 返回体键集与 hits 版逐字相同')

  // 同一 (layer, path) 组合下，两个过滤器的判定必须一致
  const cases = [
    { layer: 'log', path: LOG_PATH, patterns: ['log'] },
    { layer: 'project', path: PROJ_PATH, patterns: [PROJ_PATH] },
    { layer: 'project', path: PROJ_PATH, patterns: [WS + '\\'] },
    { layer: 'project', path: ARCHIVE_PATH, patterns: [WS + '\\archive\\'] },
    { layer: 'user', path: 'D:\\ws\\.dsh-memory-other\\MEMORY.md', patterns: [PROJ_PATH] },
    { layer: 'whiteboard', path: PLAN_PATH, patterns: ['MEMORY.md'] },
    { layer: 'log', path: LOG_PATH, patterns: ['mem_' + 'a'.repeat(32)] },
    { layer: 'log', path: LOG_PATH, patterns: ['LOG'] },
  ]
  let same = 0
  for (const c of cases) {
    const hitVerdict = filterExcludedSourcesPre([{ layer: c.layer, path: c.path }], c.patterns).droppedCount
    const srcVerdict = filterExcludedCatalogSourcesPre([{ layer: c.layer, path: c.path }], c.patterns).droppedCount
    if (hitVerdict === srcVerdict) same++
    else console.error('    差异: ' + JSON.stringify(c) + ' hits=' + hitVerdict + ' catalog=' + srcVerdict)
  }
  eq(same, cases.length, '★ 八个 (层,路径,模式) 组合上两过滤器判定逐个一致（共用 helper）')

  // 反向自检：两个模式在 hits 版里行为不同，catalog 版必须同样不同（证明上面不是恒真）
  const byId = filterExcludedSourcesPre([{ memoryId: 'mem_' + 'b'.repeat(32) }], ['mem_' + 'b'.repeat(32)]).droppedCount
  const byLayer = filterExcludedSourcesPre([{ layer: 'log' }], ['log']).droppedCount
  ok(byId === 1 && byLayer === 1, 'hits 版两种模式各自生效（对照项）')
  const cById = filterExcludedCatalogSourcesPre([{ layer: 'log', path: 'p' }], ['mem_' + 'b'.repeat(32)]).droppedCount
  ok(cById === 0, '★ 记忆 id 模式对来源不生效（有意的口径差异，已在 API 文档写明）')
}

// ─────────────────────────────────────────────────────────────
console.log('[A12-9] 与 I5 状态闸叠加：两条闸各自独立生效、各自成账')
{
  const mixed = [
    { layer: 'project', text: '## 2026-09-01 甲段\n- 甲结论_A12_MIXED 足够长。补充句。\n<!-- dsh-status: retracted -->', path: PROJ_PATH },
    { layer: 'log', text: '## 2026-09-02 乙段\n- 乙结论_A12_KEPT 足够长。补充句。', path: LOG_PATH },
  ]
  const r = composeTieredInjectionPre({ sources: mixed, hits: [], excludeSources: ['project'], question: '' })
  ok(!r.text.includes('甲结论_A12_MIXED'), '被排除 + 被状态挡的段不出现（两条闸都生效）')
  ok(r.text.includes('乙结论_A12_KEPT'), '未受影响段照常（对照项）')
  eq(r.excluded.catalog.count, 1, '排除账：1 个来源')
  // 注意：project 源先被排除 ⇒ 不会进入目录生成，因此状态账里没有它（来源整份没参与）
  eq(r.tier0.statusDropped, 0, '★ 先排除后建目录 ⇒ 被排除来源里的非 current 条目不再计入状态账（两闸不重复计账）')

  // 对照组：不排除时同一份文本的 retracted 会被状态闸挡下并计入状态账
  const r2 = composeTieredInjectionPre({ sources: mixed, hits: [], question: '' })
  eq(r2.tier0.statusDropped, 1, '★ 对照：不排除时 retracted 由状态闸挡下（statusDropped=1）')
  ok(r2.degradations.some((d) => d.code === 'tier0-status-filtered'), '对照：出现状态过滤降级行')
  ok(!r2.degradations.some((d) => d.code === 'excluded-catalog-source'), '对照：不出现目录层排除降级行')
}

// ─────────────────────────────────────────────────────────────
console.log('[A12-10] o.catalog 外部成品目录：排除不可回溯 ⇒ 显式降级（能力边界不静默）')
{
  const catalog = buildTier0CatalogFromTextPre(SOURCES, { maxTokens: 800 })
  const r = composeTieredInjectionPre({ catalog, hits: [], excludeSources: ['project'], question: '' })
  // 外部目录原样使用（不假装过滤成功）
  ok(r.text.includes(PROJ), '外部目录按原样使用（不谎称已按排除项过滤）')
  const d = r.degradations.find((x) => x.code === 'excluded-catalog-unverifiable')
  ok(!!d, '★ 存在 excluded-catalog-unverifiable 降级项（能力边界显式可见）')
  ok(d.text.includes('用户排除项只能作用于命中层'), '降级行说清"排除项只作用于命中层"')
  eq(r.excluded.catalog.count, 0, '外部目录：目录层挡下 0（不能凭空声称挡下了）')
  ok(r.excluded.catalog.unverifiable === true, '排除账上标 unverifiable（可编程判定）')

  // 反面：不配排除项时不得冒出该降级行
  const r2 = composeTieredInjectionPre({ catalog, hits: [], question: '' })
  ok(!r2.degradations.some((x) => x.code === 'excluded-catalog-unverifiable'), '反面：不配排除项 ⇒ 不出现该降级行')
}

// ─────────────────────────────────────────────────────────────
console.log('[A12-11] 既有 p0-4d B3 场景保持绿（口径与 hits 版一致，不得变红）')
{
  // 逐字复刻 smoke-test-p0-4d-inject-exclude.mjs:107-115 的夹具
  const src = [{ layer: 'log', text: '日志正文', path: 'p1' }]
  const hits = [{ memoryId: 'mem_' + 'f'.repeat(32), score: 1, excerpt: '独特串_UNIQUE_EXCLUDED_XYZ', layer: 'log', status: 'current', path: 'p1' }]
  const res = composeTieredInjectionPre({ sources: src, hits, excludeSources: ['mem_' + 'f'.repeat(32)], question: '为什么要这样' })
  eq(res.excluded.count, 1, 'B3：命中层挡下 1 条')
  ok(!res.text.includes('独特串_UNIQUE_EXCLUDED_XYZ'), 'B3：被排除条目的正文不得出现在注入里')
  eq(res.hits.kept.length, 0, 'B3：被排除项不留在命中集合')
  eq(res.excluded.catalog.count, 0, 'B3：记忆 id 模式不挡目录来源（口径一致，不误伤）')
  ok(res.text.includes('日志正文'), 'B3：该来源的目录条目仍在（id 排除不影响来源层）')
}

console.log('\n[a12-tier0-exclude] pass=' + pass + ' fail=' + fail)
process.exit(fail ? 1 : 0)

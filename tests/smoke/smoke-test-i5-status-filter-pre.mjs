/**
 * 冒烟套件：I5 状态过滤 —— 注入侧必须挡下非 current 条目（2026-09-14 · P0）。
 *
 * 由来：本套件原为 `tools/_redproof/red-proof-phase0-t01.mjs`（红证明）。它在**修复前**
 * 实测 0 通过 / 4 报红 —— 4 条候选（2 current + 1 superseded + 1 retracted）**全部**进了
 * Tier-1 注入与最终文本，Tier-1 条数 = 4。这证明契约不变式 I5
 * （`docs/internal/THREE-LAYER-CONTRACT.md:183`：「非 `current` 的条目在**检索结果与注入内容
 * 两处**都被过滤」）在注入侧从未实现：检索侧早已过滤（C2），注入侧只把 status 当展示字段。
 *
 * 红证明的纪律是「跑不红的断言等于没有断言」，故本套件保留了原 4 条判据，并补齐：
 *   ① 过滤函数本身的取值域（缺失/空=旧记录兼容放行；未知值 fail closed）
 *   ② **与检索侧同一判定**（import `isCurrentPre`，不复制 —— 复制会让两侧漂移）
 *   ③ 过滤发生在**闸门之前**（全非 current ⇒ 退化成 tier0，而不是渲染出空 Tier-1）
 *   ④ 接线可达性（源码级）：注入路径真的把 hits 交给装配器
 *   ⑤ 挡下必须可见（I7 精神：写 [降级] 行，但不回显被挡条目的 id 与正文）
 *
 * 只读、零依赖、不联网、不启宿主。
 */
import { readFileSync } from 'node:fs'
import {
  buildTier0CatalogFromTextPre,
} from '../../lib/tier0-catalog.js'
import {
  composeTieredInjectionPre,
  filterCurrentHitsPre,
} from '../../lib/tier-layer-inject.js'
import { isCurrentPre, L0_STATUSES } from '../../lib/l0-extract.js'

let pass = 0, fail = 0
const ok = (cond, name) => { if (cond) { pass++; console.log('  ok   - ' + name) } else { fail++; console.error('  RED  - ' + name) } }
const eq = (got, want, name) => ok(got === want, name + ' got=' + JSON.stringify(got) + ' want=' + JSON.stringify(want))

const ID = (ch) => 'mem_' + ch.repeat(32)
const catalog = buildTier0CatalogFromTextPre(
  { user: '- 用户偏好一\n- 用户偏好二', project: '- 项目结论一', log: '- 今日做了一件事' },
  { maxTokens: 800, quota: true },
)

// ─────────────────────────────────────────────────────────────
console.log('[I5-1] 取值域：只有 current（与旧记录的缺失/空）可入注入')
{
  const keep = (o) => filterCurrentHitsPre([o]).current === 1
  ok(keep({ status: 'current' }), 'status=current → 放行')
  ok(keep({}), 'status 缺失 → 放行（旧记录向后兼容）')
  ok(keep({ status: '' }), 'status 空串 → 放行（同上）')
  ok(keep({ status: null }), 'status=null → 放行（同上）')
  eq(keep(undefined), false, 'undefined 条目被剔除（不计入 kept）')
  eq(filterCurrentHitsPre(undefined).total, 0, 'hits=undefined → 空账,不抛')
  eq(filterCurrentHitsPre(null).total, 0, 'hits=null → 空账,不抛')
  for (const st of L0_STATUSES) {
    const want = st === 'current'
    eq(filterCurrentHitsPre([{ status: st }]).current, want ? 1 : 0, 'status=' + st + ' → ' + (want ? '放行' : '挡下'))
  }
  eq(filterCurrentHitsPre([{ status: 'bogus' }]).current, 0, '未知 status → 挡下（fail closed，不放行来路不明的状态）')
  eq(filterCurrentHitsPre([{ status: 'SUPERSEDED' }]).current, 0, '大小写不匹配 → 挡下（不做宽容归一,避免把未知当已知）')
}

// ─────────────────────────────────────────────────────────────
console.log('[I5-2] 同一判定：注入侧与检索侧用同一个函数（不复制 → 不会漂移）')
{
  const mod = readFileSync(new URL('../../lib/tier-layer-inject.js', import.meta.url), 'utf8')
  ok(/import \{ isCurrentPre \} from '\.\/l0-extract(?:-pre)?\.js'/.test(mod),
    '注入侧 import 检索侧的 isCurrentPre（唯一权威，不是各写一份）')
  ok(!/function isCurrentPre\(/.test(mod), '注入侧没有自己再定义一份 isCurrentPre（复制即漂移源）')
  // 逐值对照：两侧对同一输入必须给同一答案
  const cases = [{ status: 'current' }, { status: 'superseded' }, { status: 'retracted' }, { status: 'x' }, {}, { status: '' }]
  ok(cases.every((c) => filterCurrentHitsPre([c]).current === (isCurrentPre(c) ? 1 : 0)),
    '六个取值上「注入侧准入」== 「检索侧 isCurrentPre」逐值一致')
}

// ─────────────────────────────────────────────────────────────
console.log('[I5-3] 原红证明的 4 条判据（修复前全红 → 现在全绿）')
{
  // 这正是核实表 C8 指出的场景（同形于 tests/smoke/smoke-test-c5-tier-inject-pre.mjs 的混状态候选）
  const hits = [
    { memoryId: ID('a'), score: 0.91, excerpt: '命中摘要一', layer: 'project', status: 'current' },
    { memoryId: ID('b'), score: 0.72, excerpt: '命中摘要二', layer: 'log', status: 'current' },
    { memoryId: ID('c'), score: 0.55, excerpt: '命中摘要三', layer: 'user', status: 'superseded' },
    { memoryId: ID('d'), score: 0.51, excerpt: '命中摘要四', layer: 'reflection', status: 'retracted' },
  ]
  const r = composeTieredInjectionPre({ catalog, hits, question: '再看看' })
  const lines = (r && r.tier1 && r.tier1.lines) || []
  const ids = lines.map((l) => (/(mem_[0-9a-f]{32})/.exec(l) || [])[1]).filter(Boolean)

  ok(!ids.includes(ID('c')), 'superseded 条目不出现在 Tier-1 注入行')
  ok(!ids.includes(ID('d')), 'retracted 条目不出现在 Tier-1 注入行')
  ok(!r.text.includes('命中摘要三') && !r.text.includes('命中摘要四'), '非 current 正文不出现在最终文本')
  eq(ids.length, 2, 'Tier-1 条数 = current 命中数(2)')

  eq(r.hits.total, 4, '过滤账：候选总数=4')
  eq(r.hits.current, 2, '过滤账：kept=2')
  eq(r.hits.droppedCount, 2, '过滤账：dropped=2')
  ok(r.hits.droppedIds.length === 2, '过滤账：被挡 id 可枚举（供审计/测试，不进注入文本）')
}

// ─────────────────────────────────────────────────────────────
console.log('[I5-4] 过滤必须在**闸门之前**：全非 current ⇒ 退化成 tier0（不是渲染出空 Tier-1）')
{
  const onlyStale = [
    { memoryId: ID('e'), score: 0.9, excerpt: '旧结论甲', layer: 'project', status: 'superseded' },
    { memoryId: ID('f'), score: 0.8, excerpt: '被撤回乙', layer: 'log', status: 'retracted' },
  ]
  const r = composeTieredInjectionPre({ catalog, hits: onlyStale, question: '为什么' })
  eq(r.gate.level, 'tier0', '全部被挡 → 闸门停在 tier0（无可下探内容才是真实处境）')
  eq(r.tier1, null, '不渲染 Tier-1（否则会产出只有标题的空段，白烧预算）')
  ok(!r.text.includes('[Tier-1'), '文本里不出现 Tier-1 段')
  ok(r.text.includes('[闸门] 本轮无语义命中'), '闸门行如实写明"无命中"')
  ok(r.text.includes('已按 I5 挡下 2 条非 current 命中'), '同时说明有 2 条是被状态挡下的（不让人误以为真没命中）')

  // 反面：真的没有候选时不应冒出状态过滤行（证明该行不是恒真噪声）
  const none = composeTieredInjectionPre({ catalog, hits: [], question: '再看看' })
  ok(!none.text.includes('已按 I5 挡下'), '反面：本来就没候选时不出状态过滤行（判据有鉴别力）')
}

// ─────────────────────────────────────────────────────────────
console.log('[I5-5] 挡下不静默：降级项可被外部观测，且不回显被挡条目的正文与 id')
{
  const r = composeTieredInjectionPre({
    catalog,
    hits: [{ memoryId: ID('g'), score: 0.7, excerpt: '这段正文不该被人看见', layer: 'user', status: 'superseded' }],
    question: '再看看',
  })
  const d = r.degradations.find((x) => x.code === 'status-filtered')
  ok(!!d, '降级项 code=status-filtered 存在（外部可观测，不只在日志里）')
  ok(d && d.text.includes('superseded'), '降级行写明被挡的是哪种状态')
  ok(!r.text.includes('这段正文不该被人看见'), '降级行**不回显**被挡条目的正文（否则等于换个位置泄露）')
  ok(!r.text.includes(ID('g')), '降级行不回显被挡条目的 id')
  ok(r.degraded === true, 'degraded 标志为真（调用方可据此记账）')
}

// ─────────────────────────────────────────────────────────────
console.log('[I5-6] 接线可达性（源码级）：注入路径真的把 hits 交给装配器，且过滤不被开关绕过')
{
  const idx = readFileSync(new URL('../../lib/index.js', import.meta.url), 'utf8')
  // 断言方式说明（2026-09-14 P0 修正）：原断言写死了**单行**调用文本
  // `composeTieredInjectionPre({ sources, maxTokens, maxTotalChars, hits, question, indexNotReady, semanticArm })`。
  // T0-3 给这个调用补了 `extraDegradations` 并改成多行 ⇒ 原断言变红，但那**不是行为回归**
  // （接线还在），只是"把源码排版当断言"。改为断言**参数语义**（hits 确实被传入）。
  const inj = idx.slice(idx.indexOf('buildTierLayerInjection(agent) {'), idx.indexOf('renderMemoryDynamic(context) {'))
  const call = inj.slice(inj.indexOf('composeTieredInjectionPre({'))
  const callArgs = call.slice(0, call.indexOf('})') + 1)
  ok(/\bhits\b/.test(callArgs), 'index.js 的 buildTierLayerInjection 把 hits 交给装配器（I5 在真实注入路径上生效）')
  ok(/\bhits,/.test(callArgs) || /hits\s*:/.test(callArgs), 'hits 作为实参传入，不是仅在同名字段里出现')
  ok(inj.includes('const hits = ') && inj.includes('selectReusableTierHitsPre'),
    'hits 先过 T0-2 版本门（复用失败则为空 ⇒ 本轮不下探 Tier-1）')
  // 过滤是**无条件**的：不受 tier0CatalogEnabled / criteriaGate 这类开关影响 ——
  // 「新旧开关不能撤掉共同保护」（ROUND3 §3.7 第 4 条）。
  const mod = readFileSync(new URL('../../lib/tier-layer-inject.js', import.meta.url), 'utf8')
  const composeBody = mod.slice(mod.indexOf('export function composeTieredInjectionPre'))
  const filterAt = composeBody.indexOf('filterCurrentHitsPre(o.hits)')
  const disabledAt = composeBody.indexOf("if (o.enabled === false)")
  ok(filterAt > 0 && filterAt < disabledAt, '过滤在 enabled 开关之前执行（关闭注入不会让过滤消失）')
  ok(!/cfg\.|this\.config/.test(mod), '装配模块不读配置（过滤无条件，没有可绕过的开关路径）')
}

// ─────────────────────────────────────────────────────────────
console.log('[I5-7] 字节与模块卫生')
{
  for (const p of ['../../lib/tier-layer-inject.js', '../../lib/index.js', '../../lib/l0-extract.js']) {
    const raw = readFileSync(new URL(p, import.meta.url))
    ok(!(raw[0] === 0xEF && raw[1] === 0xBB && raw[2] === 0xBF), '无 BOM：' + p.split('/').pop())
  }
  const mod = readFileSync(new URL('../../lib/tier-layer-inject.js', import.meta.url), 'utf8')
  const code = mod.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
  ok(!/\bfetch\s*\(/.test(code) && !/openai|chat\/completions/i.test(code), 'S9 仍成立：无网络/无 LLM 调用面')
  ok(!/\bawait\b/.test(code), 'S9 仍成立：全同步纯函数（过滤没有引入异步窗口）')
  ok(/export function filterCurrentHitsPre/.test(mod), '过滤函数对外导出（可被独立测试与复用）')
}

console.log('\n[i5-status-filter-pre] pass=' + pass + ' fail=' + fail)
process.exit(fail ? 1 : 0)

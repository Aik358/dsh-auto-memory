/**
 * 冒烟套件：T0-3 预算单一口径 —— 分项账本（2026-09-14 · P0）。
 *
 * 立此存照的两处实测缺陷（读码确认，见 `docs/internal/RUN-P0-NIGHTLY.md`）：
 *   ① `lib/tier-layer-inject.js` 旧总长门只裁"下探段"、`headParts` 从不动，且降级说明在
 *      裁剪**之后**才追加 ⇒ 最终长度可**超** `maxTotalChars`。
 *   ② `lib/index.js:renderMemoryDynamic` 的 `catalogCost` 被 35% **封顶**，封顶的是"扣账成本"；
 *      实际注入用全文 `state.tier0LayerText`，**不参与 used 记账**；且 `used` 只累加从不被读（注水账本）。
 *
 * 本套件断言模块层三条不变式：
 *   E1 总计 = 最终序列化长度（逐字节）
 *   E2 无未计费尾巴（分项之和 = 总计）
 *   E3 分项上限是硬约束，且裁剪**永远可见**
 *
 * 只读、零依赖、不联网、不启宿主。
 */
import { readFileSync } from 'node:fs'
import {
  composeMemoryEnvelopePre,
  describeEnvelopeCharsPre,
  ENVELOPE_BUCKETS_V1,
  ENVELOPE_REASONS_V1,
  MEMORY_ENVELOPE_VERSION,
} from '../../lib/memory-envelope.js'

let pass = 0, fail = 0
const ok = (cond, name) => { if (cond) { pass++; console.log('  ok   - ' + name) } else { fail++; console.error('  RED  - ' + name) } }
const eq = (got, want, name) => ok(got === want, name + ' got=' + JSON.stringify(got) + ' want=' + JSON.stringify(want))

const seg = (bucket, text, kind) => ({ bucket, text, kind })
const T = (n, ch = 'x') => ch.repeat(n)

// ─────────────────────────────────────────────────────────────
console.log('[T0-3-1] E1+E2：总计 = 最终长度，分项之和 = 总计（无未计费尾巴）')
{
  const segs = [
    seg('rules', '\n[RULES]\n必须遵守甲。\n必须遵守乙。', 'rules-block'),
    seg('memoryReferences', '\n[笔记]\n摘要一\n摘要二', 'notes'),
    seg('otherDynamic', '\n[白板]\n全貌……', 'plan'),
  ]
  const e = composeMemoryEnvelopePre({ segments: segs })
  const sum = segs.reduce((a, s) => a + s.text.length, 0)
  eq(e.chars.total, e.text.length, 'E1：chars.total === text.length（逐字节，不是估算）')
  eq(e.chars.total, sum, 'E1：total === 各段文本长度之和')
  eq(e.chars.rules + e.chars.memoryReferences + e.chars.otherDynamic, e.chars.total, 'E2：分项之和 === 总计')
  eq(e.ok, true, 'E2 自证位 ok=true')
  ok(e.chars.rules > 0 && e.chars.memoryReferences > 0 && e.chars.otherDynamic > 0, '三个分项都真的计到了数')
  eq(e.text, segs.map((s) => s.text).join(''), '序列化 = 各段按给定顺序逐字节拼接（不补分隔符、不重排）')
}

// ─────────────────────────────────────────────────────────────
console.log('[T0-3-2] ★反面：不允许"未计费尾巴"—— 任何字符都必须归属某个分项')
{
  // 构造一个"看起来像有尾巴"的场景：分隔符与标题都必须由调用方写进段文本，
  // 从而必然被计入。本模块不提供任何"自动加标题/分隔符"的路径（那才是未计费尾巴的来源）。
  const e = composeMemoryEnvelopePre({
    segments: [seg('rules', '\n[RULES]\n甲'), seg('memoryReferences', '\n\n[笔记]\n乙\n\n')],
  })
  eq(e.chars.total, e.text.length, '含前导/尾随换行时仍逐字节相等')
  eq(e.chars.rules, '\n[RULES]\n甲'.length, '换行与标题被计入 rules（不是"免费"的）')
  eq(e.chars.memoryReferences, '\n\n[笔记]\n乙\n\n'.length, '空白分隔符被计入所属分项')
  // 模块源码里不得存在"拼接后再追加"的写法（那就是尾巴的入口）
  const src = readFileSync(new URL('../../lib/memory-envelope.js', import.meta.url), 'utf8')
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
  ok(!/text\s*\+=/.test(code), '模块内无"先拼后追加"（否则就会产生未计费尾巴）')
  ok(/\{ rules: 0, memoryReferences: 0, otherDynamic: 0, total: text\.length \}/.test(src),
    'total 直接取自最终字符串长度（唯一口径）')
}

// ─────────────────────────────────────────────────────────────
console.log('[T0-3-3] E3：分项上限是硬约束（memoryReferences / otherDynamic 可限，rules 不可）')
{
  const segs = [
    seg('rules', T(500, 'R'), 'rules-block'),
    seg('memoryReferences', T(400, 'A'), 'notes'),
    seg('memoryReferences', T(300, 'B'), 'user'),
    seg('otherDynamic', T(900, 'C'), 'plan'),
  ]
  const e = composeMemoryEnvelopePre({ segments: segs, limits: { memoryReferences: 500, otherDynamic: 600 } })
  ok(e.chars.memoryReferences <= 500, 'memoryReferences ≤ 上限（实 ' + e.chars.memoryReferences + '）')
  ok(e.chars.otherDynamic <= 600, 'otherDynamic ≤ 上限（实 ' + e.chars.otherDynamic + '）')
  eq(e.chars.rules, 500, '★rules 完整保留：即使分段超限也不被裁（规则不参与预算裁剪）')
  eq(e.chars.total, e.text.length, '裁剪后 E1 仍成立')
  eq(e.chars.rules + e.chars.memoryReferences + e.chars.otherDynamic, e.chars.total, '裁剪后 E2 仍成立')
  // 裁剪方式：整段丢弃（不腰斩半段）
  ok(e.dropped.length >= 1, '有整段丢弃记录（dropped ' + e.dropped.length + '）')
  ok(e.dropped.every((d) => d.reason === 'over-limit-dropped'), '丢弃原因码 over-limit-dropped')
  ok(e.segments.some((s) => s.kind === 'notes') && !e.segments.some((s) => s.kind === 'user'),
    '丢弃的是该分项**尾部**的段（notes 留下、user 被整段丢）')
}

// ─────────────────────────────────────────────────────────────
console.log('[T0-3-4] 裁剪永远可见（I7）：丢弃/截断/超额都必须留降级项')
{
  const e = composeMemoryEnvelopePre({
    segments: [seg('memoryReferences', T(400, 'A'), 'notes'), seg('memoryReferences', T(400, 'B'), 'user')],
    limits: { memoryReferences: 100 },
  })
  ok(e.degradations.some((d) => d.code === 'over-limit-dropped'), '整段丢弃 → 降级项 over-limit-dropped')
  ok(e.degradations.some((d) => d.text.includes('未静默')), '降级行写明"未静默"')
  ok(e.degradations.every((d) => d.text.startsWith('[降级]')), '降级行统一以 [降级] 开头（可 grep）')

  // 只剩一段仍超限 ⇒ 截断；上限必须仍是硬约束（标记本身也要计入）
  const e2 = composeMemoryEnvelopePre({
    segments: [seg('otherDynamic', T(1000, 'C'), 'plan')],
    limits: { otherDynamic: 120 },
  })
  ok(e2.chars.otherDynamic <= 120, '★截断后仍 ≤ 上限（实 ' + e2.chars.otherDynamic + '）—— 截断标记也占预算，不产生新的尾巴')
  ok(e2.text.includes('已按分项预算截断'), '截断可见（文本里有标记）')
  ok(e2.truncated.length === 1 && e2.truncated[0].charsBefore === 1000, '截断账记录了原文长度（1000）')
  eq(e2.chars.total, e2.text.length, '截断后 E1 仍成立')

  // 上限小到连标记都放不下 ⇒ 该分项为空，且同样留痕（不假装放得下）
  const e3 = composeMemoryEnvelopePre({
    segments: [seg('otherDynamic', T(500, 'D'), 'plan')],
    limits: { otherDynamic: 5 },
  })
  eq(e3.chars.otherDynamic, 0, '上限过小 → 该分项为空（而不是超限）')
  ok(e3.degradations.some((d) => d.code === 'over-limit-truncated' && d.text.includes('过小')), '如实写明"上限过小"')
}

// ─────────────────────────────────────────────────────────────
console.log('[T0-3-5] 明确代价：总额超额必须如实记录，不许用记账写法掩盖')
{
  const e = composeMemoryEnvelopePre({
    segments: [seg('rules', T(300, 'R'), 'rules-block'), seg('memoryReferences', T(200, 'A'), 'notes')],
    budgetChars: 100,
  })
  const d = e.degradations.find((x) => x.code === 'over-budget-total')
  ok(!!d, '合计超预算 → 降级项 over-budget-total')
  ok(d.text.includes('合计 500'), '降级行写出真实合计（500）')
  ok(d.text.includes('超出注入预算 100'), '降级行写出预算值（100）')
  ok(d.text.includes('规则类'), '降级行给出分项明细（不只是一句"超了"）')
  ok(d.text.includes('不会被掩盖'), '降级行明说"不掩盖"——这正是 v2 要求写清的代价')
  // 反面：不超预算时不得刷这条（判据有鉴别力）
  const e2 = composeMemoryEnvelopePre({ segments: [seg('rules', 'abc')], budgetChars: 1000 })
  ok(!e2.degradations.some((x) => x.code === 'over-budget-total'), '反面：未超预算不出 over-budget-total')
}

// ─────────────────────────────────────────────────────────────
console.log('[T0-3-6] 归位安全：分项名非法**不丢内容**，计入 otherDynamic 并留痕；rules 上限被忽略')
{
  const e = composeMemoryEnvelopePre({ segments: [seg('bogus', '不能丢的内容')] })
  eq(e.chars.otherDynamic, '不能丢的内容'.length, '非法分项名的段落计入 otherDynamic（不丢）')
  ok(e.degradations.some((d) => d.code === 'unknown-bucket' && d.text.includes('未丢弃')), '非法分项名留痕且写明未丢弃')
  eq(e.chars.total, e.text.length, '归位后 E1 仍成立')
  const e2 = composeMemoryEnvelopePre({
    segments: [seg('rules', T(100, 'R'))],
    limits: { rules: 10 },
  })
  eq(e2.chars.rules, 100, '★传了 rules 上限也被忽略：规则类不参与裁剪（实 ' + e2.chars.rules + '）')
  ok(e2.limits.rulesIgnored === true, 'limits.rulesIgnored 标志为真（忽略行为可观测）')
  ok(e2.degradations.some((d) => d.text.includes('已被忽略')), '忽略留痕')
}

// ─────────────────────────────────────────────────────────────
console.log('[T0-3-7] 确定性 / 边界 / 版本')
{
  const mk = () => composeMemoryEnvelopePre({
    segments: [seg('rules', '甲'), seg('memoryReferences', '乙'), seg('otherDynamic', '丙')],
    limits: { memoryReferences: 1, otherDynamic: 1 }, budgetChars: 1,
  })
  eq(JSON.stringify(mk()), JSON.stringify(mk()), '同输入同输出（确定性；S9 纯函数）')
  const empty = composeMemoryEnvelopePre({})
  eq(empty.chars.total, 0, '空输入 → total=0')
  eq(empty.text, '', '空输入 → 空文本')
  eq(empty.ok, true, '空输入 E2 自证为真')
  eq(composeMemoryEnvelopePre({ segments: [null, undefined, seg('rules', '')] }).chars.total, 0,
    '空段/空文本被剔除（不产生 0 字符分项噪声）')
  eq(MEMORY_ENVELOPE_VERSION, 'memory_envelope_v1', '模块版本标识')
  eq(ENVELOPE_BUCKETS_V1.length, 3, '分项取值域 = 3 个（与总纲 §0.5 的 chars 形状一致）')
  for (const k of Object.keys(ENVELOPE_REASONS_V1)) {
    ok(typeof ENVELOPE_REASONS_V1[k] === 'string' && ENVELOPE_REASONS_V1[k].length > 0,
      '原因码有可读中文：' + k)
  }
  ok(describeEnvelopeCharsPre(mk()).includes('合计'), 'describeEnvelopeCharsPre 给出单行账（口径唯一）')
}

// ─────────────────────────────────────────────────────────────
console.log('[T0-3-8] 接线可达性（源码级）：renderMemoryDynamic 用分项账本，不再有注水 used')
{
  const idx = readFileSync(new URL('../../lib/index.js', import.meta.url), 'utf8')
  ok(/import \{ composeMemoryEnvelopePre[^}]*\} from '\.\/memory-envelope-pre\.js'/.test(idx),
    'index.js 导入 composeMemoryEnvelopePre')
  ok(/composeMemoryEnvelopePre\(\{/.test(idx), 'renderMemoryDynamic 实际调用分项账本组装器')
  // 旧实现的 `used` 变量只累加、从不被读 —— 这是"注水账本"的指纹。
  const dyn = idx.slice(idx.indexOf('renderMemoryDynamic(context) {'), idx.indexOf('renderMemoryStatic() {'))
  ok(!/^\s*used \+= /m.test(dyn), '★旧的注水 used（只累加不读）已移除')
  ok(/chars: envelope\.chars/.test(dyn), '注入账本用 envelope.chars（唯一口径）')
  ok(/envelopeMeta/.test(idx), 'tier0Meta/state 暴露 envelopeMeta（面板与排障可观测）')
  // 目录层的扣账不再用 35% 封顶冒充实际注入量
  ok(!/const catalogCost = s\.tier0LayerText \? Math\.min\(/.test(dyn),
    '★旧的"扣账被 35% 封顶"写法已移除（封顶的是成本、注入的是全文 = 口径不一致）')
}

// ─────────────────────────────────────────────────────────────
console.log('[T0-3-9] 模块卫生：无 BOM / S9（零 IO、零依赖、无网络无 LLM 无 await）')
{
  const raw = readFileSync(new URL('../../lib/memory-envelope.js', import.meta.url))
  ok(!(raw[0] === 0xEF && raw[1] === 0xBB && raw[2] === 0xBF), '无 BOM')
  const src = raw.toString('utf8')
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
  ok(!/^import /m.test(code), '零依赖（无 import）')
  ok(!/\bfetch\s*\(|require\(|openai|chat\/completions/i.test(code), '无网络/无 LLM 调用面')
  ok(!/child_process|spawnSync|execSync/.test(code), '无子进程')
  ok(!/\bawait\b/.test(code), '全同步（无 await）')
  ok(!/fs\.|readFileSync|writeFileSync/.test(code), '零 IO（不读盘不写盘）')
}

// ═══════════════════════════════════════════════════════════════════
console.log('[T0-3-10] ★2026-09-15 回归锁：限额不得比既有预算更紧 + 丢弃必须优先级感知')
{
  // ① 事故复现（改前行为）：把一个"有独立预算的大块"塞进小上限 ⇒ 尾部整段丢
  const realistic = [
    seg('memoryReferences', 'A'.repeat(800), 'tier0-catalog'),
    seg('memoryReferences', 'B'.repeat(1200), 'whiteboard-plan'),
    seg('memoryReferences', 'C'.repeat(800), 'handoff-ledger'),
    seg('memoryReferences', 'D'.repeat(876), 'recent-logs'),
    seg('memoryReferences', 'U'.repeat(916), 'user-memory'),
    seg('memoryReferences', 'N'.repeat(916), 'project-notes'),
  ]
  const bad = composeMemoryEnvelopePre({ segments: realistic, limits: { memoryReferences: 4800 } })
  ok(bad.dropped.length > 0, '★改前上限（4800，本机 injectBudgetChars）下必然丢段（实测 ' + bad.dropped.length + ' 段）')
  ok(bad.dropped.some((d) => d.kind === 'project-notes' || d.kind === 'user-memory'),
    '★被丢的正是尾部两段（user-memory / project-notes）—— 位置式丢弃的病症（本次事故形态）')

  // ② 修复后：限额由既有分配推导 ⇒ 一段都不丢
  const sub = 876, catalogCost = 796, planCap = 1200, ledgerCap = 800
  const derived = sub * 4 + catalogCost + planCap + ledgerCap + 400
  const good = composeMemoryEnvelopePre({ segments: realistic, limits: { memoryReferences: derived } })
  eq(good.dropped.length, 0, '★修复后（限额由既有分配推导 ' + derived + '）→ 零丢弃')
  eq(good.truncated.length, 0, '★修复后 → 零截断')
  ok(good.text.includes('U'.repeat(20)) && good.text.includes('N'.repeat(20)), '★用户级记忆与项目笔记都在注入文本里')
  eq(good.chars.total, good.text.length, '修复后 E1 仍成立')
  ok(derived > 4800, '推导限额 ' + derived + ' > 旧 4800（账本不该当更紧的预算用）')

  // ③ 优先级：low 先丢，must 保留
  const prio = [
    { ...seg('memoryReferences', 'C'.repeat(800), 'tier0-catalog'), priority: 'normal' },
    { ...seg('memoryReferences', 'L'.repeat(876), 'recent-logs'), priority: 'low' },
    { ...seg('memoryReferences', 'U'.repeat(916), 'user-memory'), priority: 'must' },
    { ...seg('memoryReferences', 'N'.repeat(916), 'project-notes'), priority: 'must' },
  ]
  const p = composeMemoryEnvelopePre({ segments: prio, limits: { memoryReferences: 3000 } })
  eq(p.dropped.length, 1, '紧张额度（3508 → 3000）只丢 1 段')
  eq(p.dropped[0].kind, 'recent-logs', '★先丢 priority=low 的 recent-logs（旧的尾部式会丢 project-notes）')
  ok(p.text.includes('U'.repeat(20)) && p.text.includes('N'.repeat(20)), '★两段 must 完整保留')
  ok(p.text.includes('C'.repeat(20)), 'priority=normal 的目录层也保留（只丢 low 就够了）')

  // ④ must 不可丢：丢无可丢时如实报告超额
  const m = composeMemoryEnvelopePre({
    segments: [
      { ...seg('memoryReferences', 'U'.repeat(600), 'user-memory'), priority: 'must' },
      { ...seg('memoryReferences', 'N'.repeat(600), 'project-notes'), priority: 'must' },
    ],
    limits: { memoryReferences: 500 },
  })
  eq(m.dropped.length, 0, '★全是 must ⇒ 一段都不丢')
  eq(m.chars.memoryReferences, 1200, '两段 must 原样保留（1200 字符）')
  ok(m.degradations.some((d) => d.code === 'over-limit-must'), '★如实报告 over-limit-must（可见，不静默牺牲）')
  ok(m.degradations.find((d) => d.code === 'over-limit-must').text.includes('不可丢'), '报告写明"不可丢"并给出超额量')

  // ⑤ 诊断类降级不进注入文本，内容类必须进
  const diag = composeMemoryEnvelopePre({ segments: realistic, limits: { memoryReferences: derived }, budgetChars: 1000 })
  const ob = diag.degradations.find((d) => d.code === 'over-budget-total')
  ok(!!ob, '合计超预算仍被记录（诊断）')
  eq(ob.inject, false, '★诊断类降级 inject:false（不进注入文本，避免每轮噪声）')
}

// ═══════════════════════════════════════════════════════════════════
console.log('[T0-3-11] 接线守卫：index.js 的限额是推导的、优先级是分派的')
{
  const idx = readFileSync(new URL('../../lib/index.js', import.meta.url), 'utf8')
  const code = idx.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
  ok(!/const memRefLimit = Math\.max\(Number\(cfg\.injectBudgetChars\)/.test(code),
    '★旧的"分项限额 = injectBudgetChars"写法已移除（那正是事故成因）')
  ok(/const memRefLimit = sub \* 4 \+ catalogCost \+ planCap \+ ledgerCap \+ 400/.test(code),
    '★限额由既有分配推导（sub×4 + 目录 + 白板 + 账本 + 余量）')
  ok(/otherLimitN > 0 \? Math\.max\(200, Math\.floor\(otherLimitN\)\) : null/.test(code),
    'otherDynamic 未配置时**不设限**（不再拿无依据的默认值当上限）')
  ok(/priority: sg\.priority/.test(code), '段落优先级透传给账本')
  ok(/const injectedDegradations = envelope\.degradations\.filter\(\(x\) => x\.inject !== false\)/.test(code),
    '注入文本只带内容类降级（诊断类留 meta）')
  // 分派：最该保的两段必须是 must，日志必须是 low
  ok(/'user-memory'[\s\S]{0,120}'must'\)/.test(code), '★user-memory 标为 must（用户级跨项目规则）')
  ok(/'project-notes'[\s\S]{0,160}'must'\)/.test(code), '★project-notes 标为 must')
  ok(/'recent-logs'[\s\S]{0,120}'low'\)/.test(code), 'recent-logs 标为 low（先丢）')
  ok(/'frame-head'[\s\S]{0,80}'must'\)/.test(code) && /'frame-tail'[\s\S]{0,80}'must'\)/.test(code),
    '块首/块尾框架行标为 must（不可丢）')
}

console.log('\n[t0-3-budget-ledger-pre] pass=' + pass + ' fail=' + fail)
process.exit(fail ? 1 : 0)

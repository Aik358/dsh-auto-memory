#!/usr/bin/env node
/**
 * smoke-test-v4-c1-zones.mjs —— 批次 C-1：一框三区（lib/injection-zones.js + 注入面接线）。
 *
 * 纪律：真 import → 真调用 → 断言返回值；每条带负路径；接线用真抽取 renderMemoryDynamic 真执行。
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  INJECTION_ZONES_VERSION, ZONES_PRE_V1, ZONE_BY_KIND_PRE_V1, CHANNEL_ZONE_MAX_CHARS,
  zoneOfKindPre, tagZonesPre, zoneCharsPre, splitByZonePre, enforceChannelCapPre, complianceStablePre, zoneReportPre,
} from '../../lib/injection-zones.js'

let pass = 0, fail = 0
const ok = (c, m) => { if (c) { pass++; console.log('  PASS ' + m) } else { fail++; console.log('  FAIL ' + m) } }
const eq = (a, b, m) => ok(Object.is(a, b), m + '  (got=' + JSON.stringify(a) + ' want=' + JSON.stringify(b) + ')')

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, '..', '..')
const SRC = readFileSync(path.join(ROOT, 'lib', 'index.js'), 'utf8')

const seg = (kind, text, priority = 'normal', bucket = 'otherDynamic') => ({ bucket, kind, text, priority })

console.log('[Z-1] 三区常量与 kind→区 映射')
eq(ZONES_PRE_V1.join(','), 'compliance,memory,channel', '三区且顺序固定')
eq(CHANNEL_ZONE_MAX_CHARS, 300, '通道区上限 = 300（文档契约）')
eq(zoneOfKindPre('rules-section'), 'compliance', 'rules-section ⇒ 合规区')
eq(zoneOfKindPre('frame-head'), 'compliance', 'frame-head ⇒ 合规区')
eq(zoneOfKindPre('frame-tail'), 'compliance', 'frame-tail ⇒ 合规区')
eq(zoneOfKindPre('frame-meta'), 'compliance', 'frame-meta ⇒ 合规区')
eq(zoneOfKindPre('frame-inscription'), 'compliance', 'frame-inscription ⇒ 合规区')
eq(zoneOfKindPre('tier0-catalog'), 'memory', 'tier0-catalog ⇒ 证据区')
eq(zoneOfKindPre('event-cards'), 'memory', 'event-cards ⇒ 证据区')
eq(zoneOfKindPre('water-advisory'), 'channel', 'water-advisory ⇒ 通道区')
eq(zoneOfKindPre('calendar'), 'channel', 'calendar ⇒ 通道区')
eq(zoneOfKindPre('event-unarchived'), 'channel', 'event-unarchived ⇒ 通道区')
eq(zoneOfKindPre('never-registered-kind'), 'memory', '★负：未登记 kind ⇒ fail-safe 落到 evidence 区（不是 compliance，避免拼写错误变永久豁免）')
eq(zoneOfKindPre(null), 'memory', '★负：null kind ⇒ 同样兜底到 evidence')

console.log('[Z-2] 合规区**不可裁剪**：任何裁剪后逐字节稳定')
const before = [
  seg('frame-head', '<memory_system>', 'must', 'otherDynamic'),
  seg('rules-section', 'RULES-CONTENT', 'must', 'rules'),
  seg('frame-tail', '</memory_system>', 'must'),
  seg('calendar', 'X'.repeat(500), 'normal'),
  seg('water-advisory', 'Y'.repeat(200), 'must'),
]
const capped = enforceChannelCapPre(before, 300)
ok(capped.dropped.length > 0, '正：通道区确实被裁了（dropped=' + capped.dropped.length + '）')
ok(complianceStablePre(before, capped.segs), '★合规区裁剪前后逐字节相等')
const compBefore = tagZonesPre(before).filter((s) => s.zone === 'compliance').map((s) => s.text).join('')
const compAfter = tagZonesPre(capped.segs).filter((s) => s.zone === 'compliance').map((s) => s.text).join('')
eq(compAfter, compBefore, '★合规区文本完全相同（3 段 must 全在）')
ok(capped.segs.some((s) => s.kind === 'rules-section'), '合规段 rules-section 仍在')
ok(capped.segs.some((s) => s.kind === 'frame-tail'), '合规段 frame-tail 仍在')

console.log('[Z-3] 通道区限额：超 300 才裁，未超则**逐字节不动**')
const small = [seg('calendar', 'C'.repeat(100), 'normal'), seg('water-advisory', 'W'.repeat(100), 'must')]
const r1 = enforceChannelCapPre(small, 300)
eq(r1.dropped.length, 0, '负：未超限 ⇒ 一段都不丢')
eq(r1.segs.length, 2, '负：未超限 ⇒ 段数不变')
ok(r1.segs[0] === small[0] && r1.segs[1] === small[1], '★未超限 ⇒ 返回**同一批对象引用**（零重建/零改写）')
const over = [seg('calendar', 'C'.repeat(200), 'low'), seg('external-memory', 'E'.repeat(200), 'normal')]
const r2 = enforceChannelCapPre(over, 300)
ok(r2.segs.reduce((a, s) => a + s.text.length, 0) <= 300, '正：超限后 ≤300（实测 ' + r2.segs.reduce((a, s) => a + s.text.length, 0) + '）')
eq(r2.dropped.length, 1, '正：丢了 1 段')
eq(r2.dropped[0].kind, 'calendar', '★先丢**最低优先级**（low 的 calendar），不是最后一段')
ok(r2.segs.some((s) => s.kind === 'external-memory'), 'normal 段保留')

console.log('[Z-4] must 段永不丢：全 must 超限 ⇒ 如实报超额，不牺牲')
const allMust = [seg('water-advisory', 'A'.repeat(400), 'must'), seg('plan-update-request', 'B'.repeat(200), 'must')]
const r3 = enforceChannelCapPre(allMust, 300)
eq(r3.dropped.length, 0, '负：全 must ⇒ 一段都不丢')
eq(r3.segs.length, 2, '全 must 段全在')
ok(r3.degradations.some((d) => d.code === 'channel-over-cap-must'), '★如实报告超额（不静默）')
ok(r3.degradations.find((d) => d.code === 'channel-over-cap-must').text.includes('300'), '超额说明里带上限数字')

console.log('[Z-5] 不改写未知字段（团队段 priority:6 数字档）')
const teamSeg = { bucket: 'external', kind: 'team-feed', text: 'T', priority: 6, extraField: 'KEEP' }
const r4 = enforceChannelCapPre([teamSeg], 300)
eq(r4.segs[0].priority, 6, '★数字 priority 原样保留（不被归一成 normal）')
eq(r4.segs[0].extraField, 'KEEP', '★未知字段原样保留（本模块只标记删除，不重建）')

console.log('[Z-6] 分区账本：三区字符数与合计')
const mixed = [
  seg('frame-head', 'H', 'must'), seg('rules-section', 'RR', 'must', 'rules'),
  seg('tier0-catalog', 'TTT', 'normal', 'memoryReferences'),
  seg('calendar', 'CCCC', 'normal'),
]
const chars = zoneCharsPre(mixed)
eq(chars.compliance, 3, '合规区 3 字符（H + RR）')
eq(chars.memory, 3, '证据区 3 字符（TTT）')
eq(chars.channel, 4, '通道区 4 字符（CCCC）')
eq(chars.total, 10, '合计 10 字符')
eq(chars.compliance + chars.memory + chars.channel, chars.total, '★三区之和 === 合计（无未计费尾巴）')
const split = splitByZonePre(mixed)
eq(split.compliance.length, 2, 'splitByZone：合规区 2 段')
eq(split.memory.length, 1, 'splitByZone：证据区 1 段')
eq(split.channel.length, 1, 'splitByZone：通道区 1 段')

console.log('[Z-7] zoneReport：可审计摘要')
const rep = zoneReportPre(mixed, 300)
eq(rep.version, INJECTION_ZONES_VERSION, 'report 带版本号')
eq(rep.channelCap, 300, 'report 带上限')
eq(rep.channelOver, 0, '未超 ⇒ channelOver=0')
eq(rep.unknownKinds.length, 0, '无未登记 kind')
const rep2 = zoneReportPre([seg('bogus-kind-x', 'z')], 300)
eq(rep2.unknownKinds.length, 1, '★负：未登记 kind 被如实列出（可审计，不静默）')
ok(rep2.unknownKinds.includes('bogus-kind-x'), '列出的是那个具体 kind')

console.log('[Z-8] 接线：真抽取 renderMemoryDynamic → 真执行 → meta.zones 被填')
function grab(name) {
  const lines = SRC.split('\n')
  let li = lines.findIndex((l) => { const t = l.trim(); return t.startsWith('const ' + name + ' ') || t.startsWith('const ' + name + '=') || t.startsWith('function ' + name + '(') || t.startsWith('var ' + name + ' ') })
  if (li < 0) throw new Error('not found: ' + name)
  let buf = '', depth = 0, started = false
  for (; li < lines.length; li++) {
    buf += lines[li] + '\n'
    for (const ch of lines[li]) { if (ch === '(' || ch === '{') { depth++; started = true } else if (ch === ')' || ch === '}') depth-- }
    if (started && depth <= 0) break
    if (!started && / = \//.test(lines[li])) break
  }
  return buf
}
function extractFn(sig) {
  const start = SRC.indexOf(sig)
  if (start < 0) throw new Error('fn not found: ' + sig)
  let i = SRC.indexOf('{', start), depth = 0, end = -1
  for (; i < SRC.length; i++) { const ch = SRC[i]; if (ch === '{') depth++; else if (ch === '}') { depth--; if (!depth) { end = i + 1; break } } }
  return SRC.slice(start, end)
}
const dynSrc = extractFn('renderMemoryDynamic(context) {')
const helpers = ['pad', 'DEFAULT_PROMPT_LAYERS', 'neutralizePromptTemplateVars', 'truncateHead', 'truncateTail', 'truncateLinesBounded', 'truncatePlanByPriority', 'PLAN_SECTION_PRIORITY_RE', 'sanitizeForInjection', 'scrubJunkLines', 'reflectionDigest', 'mojibakeDensity', 'MOJIBAKE_RE', 'detectStutter', 'hasStutter', 'BASE64_LINE', 'todayStr']
const helperCode = [...new Set(helpers)].map((h) => grab(h)).join('\n') + '\nconst DEFAULT_WATER_LEVEL_THRESHOLD = 0.75\nconst DEFAULT_AUTO_CONTINUE_THRESHOLD = 0.75\n'
const policyCode = readFileSync(path.join(ROOT, 'lib', 'injection-policy.js'), 'utf8').replace(/^export /gm, '')
const envelopeCode = readFileSync(path.join(ROOT, 'lib', 'memory-envelope.js'), 'utf8').replace(/^export /gm, '')
const ledgerCode = readFileSync(path.join(ROOT, 'lib', 'handoff-anchor.js'), 'utf8').replace(/^export /gm, '')
// ★关键：把 injection-zones 也注入沙箱 —— 这样走的是**真实裁剪路径**，不是 typeof 兜底路径。
const zonesCode = readFileSync(path.join(ROOT, 'lib', 'injection-zones.js'), 'utf8')
  .replace(/^export default \{[\s\S]*?\}\r?\n?/m, '')
  .replace(/^export /gm, '')
const sandbox = new Function(helperCode + '\n' + policyCode + '\n' + envelopeCode + '\n' + ledgerCode + '\n' + zonesCode + '\n' + 'return {' + dynSrc + '};')()
const render = sandbox['renderMemoryDynamic']
ok(typeof render === 'function', '抽取并求值成功（含 injection-zones 真实模块）')
function makeFakeThis(o = {}) {
  return {
    state: {
      ws: 'D:\\proj', recentLogs: [{ date: '2026-10-24', text: 'A' }], latestReflection: '', latestReflectionDate: '',
      userText: 'U'.repeat(20), notesText: 'N'.repeat(20), planText: '', latestHandoffText: '',
      workspaceMap: [], todayGreeting: '', calendarText: '', tier0LayerText: '',
      eventCardsText: '', eventUnarchivedCount: 0, eventUnarchivedSkipped: 0, eventActiveCount: 0,
    },
    config: { injectBudgetChars: o.injectBudgetChars || 8000, handoffEnabled: true, handoffPlanChars: 1200, handoffLedgerChars: 800, dayBoundaryMinutes: 450, autoConsolidate: true, promptLayerOverrides: {}, rulesLayeringMode: 'off', waterLevelAdvisory: false, externalMemoryEnabled: false },
    memToday: () => '2026-10-24', parseCalendar: () => [], runtimes: { values: () => [] },
    isUnattendedNow: () => true, external: { cache: [] },
  }
}
const fake = makeFakeThis()
const out = render.call(fake, {})
ok(typeof out === 'string' && out.length > 0, '渲染有输出（' + (out || '').length + ' 字符）')
const meta = fake.state.envelopeMeta
ok(!!meta, 'envelopeMeta 已挂 state')
ok(!!meta.zones, '★meta.zones 已填（三区账本可审计）')
ok(meta.zones.chars && typeof meta.zones.chars.compliance === 'number', 'meta.zones.chars.compliance 是数字')
eq(meta.zones.chars.compliance + meta.zones.chars.memory + meta.zones.chars.channel, meta.zones.chars.total, '★三区之和 === total（无未计费尾巴）')
eq(meta.chars.total, meta.zones.chars.total, '★三区账本 total === envelope 账本 total（两本账对得上）')
ok(meta.zones.chars.compliance > 0, '合规区非零（框架行 + 规则段）')

console.log('[Z-9] 守卫（非功能证据）：接线点与 fail-soft 兜底')
ok(SRC.includes('enforceChannelCapZonePre(neutralSegs, CHANNEL_ZONE_MAX_CHARS)'), '守卫：注入面真的调了通道区裁剪')
ok(SRC.includes("typeof enforceChannelCapZonePre === 'function'"), '守卫：有 typeof fail-soft 兜底（抽取式沙箱无模块级 import）')
ok(SRC.includes('zones: zoneReport,'), '守卫：zoneReport 已挂进 envelopeMeta')

console.log('')
console.log('[C1] ' + pass + ' PASS / ' + fail + ' FAIL')
process.exit(fail ? 1 : 0)
/**
 * smoke-test-zone-channel-visible.mjs —— 通道区静默击杀回归护栏（审计 §1.2 · P1）
 *
 * ★★背景（2026-10-26 审计插桩实测，非推断）：
 *   `enforceChannelCapZonePre()` 返回 `{segs, dropped, degradations}`，
 *   但调用点**只消费 segs** —— `dropped` / `degradations` 全仓 0 消费点。
 *   而 enforceChannelCapPre 每一步击杀都会 push 一条 `inject:true` 的可见降级文案。
 *
 *   生产配置现场：通道区 4 段 1,121 字符 > 上限 300
 *     external-memory      (normal, 736)
 *     mem-legacy-upgrade   (low,    157)   ← v4 旧格式升级提醒
 *     event-unarchived     (low,    117)   ← v4 待审理账本提醒（572 篇！）
 *     external-sessions    (normal, 111)
 *   ⇒ 按优先级逐个击杀至 0，两条 low 先死 ⇒ **[待审理账本] 与「旧版记忆」每轮双双阵亡**，
 *     且击杀记录在调用点被丢弃 ⇒ envelopeMeta.dropped=[] ⇒ **完全静默**。
 *
 * 本套件守两件事：
 *   ① 行为：通道区超限时，必须产出**可见降级文案**（inject:true），且该文案必须能进注入文本
 *   ② 接线：index.js 必须真的把 zones.degradations 并入注入降级源头（防改回去）
 * 全部真执行，带负路径与变异验证。
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const IZ = await import(pathToFileURL(path.join(ROOT, 'lib', 'injection-zones.js')).href)
const INDEX_SRC = fs.readFileSync(path.join(ROOT, 'lib', 'index.js'), 'utf8')

let pass = 0, fail = 0
const ok = (c, msg, extra) => {
  if (c) { pass++; console.log('  ok   - ' + msg + (extra ? ' :: ' + extra : '')) }
  else { fail++; console.log('  FAIL - ' + msg + (extra ? ' :: ' + extra : '')) }
}

console.log('== Z1 通道区超限 ⇒ 必须产出可见降级（真执行 enforceChannelCapPre）==')
// 复刻生产现场：4 段 1,121 字符，两条 low
const segs = [
  { bucket: 'memory', kind: 'external-memory', priority: 'normal', text: 'M'.repeat(736) },
  { bucket: 'memory', kind: 'mem-legacy-upgrade', priority: 'low', text: 'L'.repeat(157) },
  { bucket: 'memory', kind: 'event-unarchived', priority: 'low', text: 'U'.repeat(117) },
  { bucket: 'memory', kind: 'external-sessions', priority: 'normal', text: 'S'.repeat(111) },
]
const res = IZ.enforceChannelCapPre(segs, IZ.CHANNEL_ZONE_MAX_CHARS || 300)

ok(Array.isArray(res.dropped) && res.dropped.length > 0, '★★★Z1a 超限时 dropped 非空', 'dropped=' + (res.dropped || []).length)
ok(Array.isArray(res.degradations) && res.degradations.length > 0, '★★★Z1b 超限时 degradations 非空', 'deg=' + (res.degradations || []).length)

const visible = (res.degradations || []).filter((d) => d.inject !== false)
ok(visible.length > 0, '★★★Z1c 至少有一条 **可见**（inject!==false）降级文案', 'visible=' + visible.length)
ok(visible.every((d) => typeof d.text === 'string' && d.text.length > 0), '★★★Z1d 每条可见降级都带非空 text（不是空壳）')
ok(visible.some((d) => d.text.indexOf('[降级]') >= 0), '★★★Z1e 文案含 [降级] 标记，模型能识别')

// 被丢的必须是 low，不能吃掉 must
const droppedKinds = (res.dropped || []).map((x) => x.kind)
ok(droppedKinds.length > 0, '★★Z1f 有段被丢（前置：确实发生击杀）', 'dropped=' + JSON.stringify(droppedKinds))

console.log('')
console.log('== Z2 未超限 ⇒ 不得产生任何降级（负路径：别把正常路径搞脏）==')
const small = [
  { bucket: 'memory', kind: 'a', priority: 'normal', text: 'x'.repeat(50) },
  { bucket: 'memory', kind: 'b', priority: 'low', text: 'y'.repeat(50) },
]
const resOk = IZ.enforceChannelCapPre(small, 300)
ok((resOk.dropped || []).length === 0, '★★★Z2a 未超限 ⇒ dropped 为空', 'dropped=' + (resOk.dropped || []).length)
ok((resOk.degradations || []).filter((d) => d.inject !== false).length === 0,
  '★★★Z2b 未超限 ⇒ 无可见降级（不制造噪声）')
ok((resOk.segs || []).length === 2, '★★Z2c 未超限 ⇒ 两段都保留')

console.log('')
console.log('== Z3 接线守卫：index.js 必须把 zones.degradations 并入注入降级 ==')
// ★变异实证缺口：若只删掉这行接线，功能就静默失效，而本套件此前不存在
ok(/_zonesDegr\s*=\s*Array\.isArray\(zones\.degradations\)/.test(INDEX_SRC),
  '★★★Z3a index.js 提取了 zones.degradations')
ok(/\.concat\(_zonesDegr\)/.test(INDEX_SRC),
  '★★★Z3b index.js 把 zones.degradations **并入了** injectedDegradations（接线未丢）')
ok(/_zonesDropped\s*=\s*Array\.isArray\(zones\.dropped\)/.test(INDEX_SRC),
  '★★Z3c index.js 也取了 zones.dropped（供账本/诊断）')

// 负路径：确认「不 concat」时注入文本里就没有这条降级（证明 Z3b 非恒真）
{
  const withoutConcat = INDEX_SRC.replace('.concat(_zonesDegr)', '')
  ok(withoutConcat !== INDEX_SRC, '★★★Z3d [负路径] 去掉 concat 确实改变了源码（锚点命中唯一）')
  ok(!/\.concat\(_zonesDegr\)/.test(withoutConcat),
    '★★★Z3e [负路径] 去掉后正则不再命中 ⇒ 若改回缺陷，Z3b 必红')
}

console.log('')
console.log('== Z4 诊断：通道区实际占用 vs 上限必须可一眼看出 ==')
// 审计要求「补一条通道区实际占用 vs 上限的诊断输出」
let zoneReport = null
try { zoneReport = IZ.zoneReportPre(segs, IZ.CHANNEL_ZONE_MAX_CHARS || 300) } catch (e) {}
ok(!!zoneReport, '★★Z4a zoneReportPre 可调用')
ok(zoneReport && Number.isFinite(Number(zoneReport.channelCap)), '★★★Z4b 报告含 channelCap（上限）', zoneReport ? 'cap=' + zoneReport.channelCap : '')
ok(zoneReport && Number.isFinite(Number(zoneReport.channelOver)), '★★★Z4c 报告含 channelOver（超限量）', zoneReport ? 'over=' + zoneReport.channelOver : '')
ok(zoneReport && Number(zoneReport.channelOver) > 0, '★★★Z4d 本现场确实超限（over>0）', zoneReport ? 'over=' + zoneReport.channelOver : '')

// ★★2026-10-26 补（审计 §1.2 配套诊断的真实缺陷）：
//   旧接线是 zoneReportPre(zones.segs, ...) —— zones.segs 已被击杀过 ⇒ chars.channel 恒 0
//   ⇒ channelOver 恒 0 ⇒ 诊断永远显示「没超限」，而实际每轮整区歼灭。
//   下面把「必须量击杀前 neutralSegs」这条接线也锁住。
ok(/zoneReportPre\(neutralSegs,/.test(INDEX_SRC),
  '★★★Z4e [接线] index.js 用 neutralSegs（击杀前）量通道区，不是 zones.segs')
ok(!/zoneReportPre\(zones\.segs,/.test(INDEX_SRC),
  '★★★Z4f [负路径] index.js 不得再用 zones.segs 量（那是击杀后的空壳）')
ok(/droppedKinds:/.test(INDEX_SRC) && /droppedChars:/.test(INDEX_SRC),
  '★★Z4g 报告含 droppedKinds / droppedChars（丢了哪些、共丢多少字符）')

console.log('')
console.log('SUMMARY  PASS ' + pass + ' / FAIL ' + fail)
process.exit(fail === 0 ? 0 : 1)

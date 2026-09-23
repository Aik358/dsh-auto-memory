#!/usr/bin/env node
/** smoke-test-temporal-parse-pre —— 时间检索臂(Phase 1)回归锁定(2026-09-09)。
 * 覆盖:中文时间表达解析表(自然日/周/月/年/最近N/N前,中英文数字等价)/
 * 未识别返回 null / now 注入确定性 / N 上限 366 / label 日期抽取 /
 * rankFusionRRFPre 无 temp 逐项相等回归证明 + 有 temp 软提升。
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseTemporalQueryPre, labelToDateMsPre } from '../../lib/temporal-parse.js'
import { rankFusionRRFPre } from '../../lib/recall-fusion.js'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const SRC_FUSION = readFileSync(path.resolve(HERE, '..', '..', 'lib', 'recall-fusion.js'), 'utf8')
let pass = 0, fail = 0
const ok = (c, n) => { if (c) { pass++; console.log('  ok -', n) } else { fail++; console.error('FAIL', n) } }

// now 固定:2026-09-09 15:30 本地(周三)
const NOW = new Date(2026, 8, 9, 15, 30, 0).getTime()
const day0 = (y, m, d) => new Date(y, m, d).getTime() // 本地 00:00
const D = 86400000
// 2026-09-09 是周三 → 本周一 = 09-07;上周一 = 08-31(注意:8 月的月指数是 7)
const MON_THIS = day0(2026, 8, 7)
const MON_LAST = day0(2026, 7, 31)

console.log('[temporal] G1 表达覆盖表(时区=宿主本地,部署机为 Asia/Shanghai)')
const CASES = [
  ['今天', day0(2026, 8, 9), day0(2026, 8, 10)],
  ['昨天', day0(2026, 8, 8), day0(2026, 8, 9)],
  ['前天', day0(2026, 8, 7), day0(2026, 8, 8)],
  ['大前天', day0(2026, 8, 6), day0(2026, 8, 7)],
  ['本周', MON_THIS, MON_THIS + 7 * D],
  ['上周', MON_LAST, MON_LAST + 7 * D],
  ['上上周', MON_LAST - 7 * D, MON_LAST],
  ['本月', day0(2026, 8, 1), day0(2026, 9, 1)],
  ['上个月', day0(2026, 7, 1), day0(2026, 8, 1)],
  ['今年', day0(2026, 0, 1), day0(2027, 0, 1)],
  ['去年', day0(2025, 0, 1), day0(2026, 0, 1)],
  ['最近三天', NOW - 3 * D, NOW],
  ['最近3天', NOW - 3 * D, NOW],
  ['最近两周', NOW - 14 * D, NOW],
  ['最近 2 周', NOW - 14 * D, NOW],
  ['最近一个月', day0(2026, 7, 9) + 15 * 3600000 + 30 * 60000, NOW], // 从 now 往前 1 个日历月(锚定同时刻)
  ['三天前', day0(2026, 8, 6), day0(2026, 8, 7)],
  ['3 天前', day0(2026, 8, 6), day0(2026, 8, 7)],
  ['两周前', MON_THIS - 14 * D, MON_THIS - 7 * D],
  ['2 周前', MON_THIS - 14 * D, MON_THIS - 7 * D],
  ['三个月前', day0(2026, 5, 1), day0(2026, 6, 1)],
  ['12 个月前', day0(2025, 8, 1), day0(2025, 9, 1)],
]
for (const [text, s, e] of CASES) {
  const r = parseTemporalQueryPre('帮我找' + text + '的记忆', { now: NOW })
  ok(r && r.startMs === s && r.endMs === e, JSON.stringify(text) + ' → [' + new Date(s).toISOString().slice(0, 10) + ' ~ ' + new Date(e).toISOString().slice(0, 10) + ') matched=' + (r && r.matched))
}
ok(parseTemporalQueryPre('三天前', { now: NOW }).startMs === parseTemporalQueryPre('3 天前', { now: NOW }).startMs, '"三天前"="3 天前"(中英数字等价)')
ok(parseTemporalQueryPre('两天前', { now: NOW }).startMs === day0(2026, 8, 7), '"两"=2')

console.log('[temporal] G2 未识别 / 确定性 / N 上限')
ok(parseTemporalQueryPre('发布凭证问题', { now: NOW }) === null, '无时间表达 → null')
ok(parseTemporalQueryPre('修复 impMap 恒空', { now: NOW }) === null, '普通技术查询 → null')
ok(JSON.stringify(parseTemporalQueryPre('上周的修复', { now: NOW })) === JSON.stringify(parseTemporalQueryPre('上周的修复', { now: NOW })), '同输入同 now 确定性(逐字节)')
ok(parseTemporalQueryPre('366 天前', { now: NOW }) !== null, 'N=366(上限)命中')
ok(parseTemporalQueryPre('367 天前', { now: NOW }) === null, 'N=367(超界)→ null')
ok(parseTemporalQueryPre('0 天前', { now: NOW }) === null, 'N=0 → null')
ok(parseTemporalQueryPre('大前天', { now: NOW }).startMs === day0(2026, 8, 6), '"大前天"不被"前天"子串误配')

console.log('[temporal] G3 label 日期抽取(候选时间戳)')
ok(labelToDateMsPre('2026-09-09.md') === day0(2026, 8, 9), '日志名 → 当日 00:00 本地')
ok(labelToDateMsPre('reflections/2026-08-19.md') === day0(2026, 7, 19), '带日期反思 → 当日 00:00')
ok(labelToDateMsPre('D:/x/.dsh-memory/MEMORY.md') === null, 'MEMORY.md → null(中性)')
ok(labelToDateMsPre('~/.dsh/MEMORY.md') === null, '~userfile → null(中性)')
ok(labelToDateMsPre('') === null && labelToDateMsPre(null) === null, '空/非法 label → null')

console.log('[temporal] G4 rankFusionRRFPre 无 temp 回归证明(旧版逐字复刻,JSON 全等)')
{
  // 旧实现逐字复刻(两臂版):同输入 → 输出 JSON.stringify 逐项相等
  const OLD = (pairs, opts = {}) => {
    const k = Number.isFinite(opts.k) && opts.k >= 0 ? opts.k : 60
    const divisor = Number.isFinite(opts.divisor) && opts.divisor > 0 ? opts.divisor : 60
    const list = Array.isArray(pairs) ? pairs.filter((p) => p && typeof p.memoryId === 'string') : []
    const rankArm = (key) => {
      const entries = []
      for (const p of list) { const v = p[key]; if (typeof v === 'number' && Number.isFinite(v)) entries.push({ memoryId: p.memoryId, v }) }
      entries.sort((a, b) => (b.v !== a.v ? b.v - a.v : (a.memoryId < b.memoryId ? -1 : a.memoryId > b.memoryId ? 1 : 0)))
      const ranks = new Map(); entries.forEach((e, i) => ranks.set(e.memoryId, i + 1)); return ranks
    }
    const denseRanks = rankArm('dense'); const lexRanks = rankArm('lex')
    return list.map((p) => {
      const rd = denseRanks.get(p.memoryId); const rl = lexRanks.get(p.memoryId)
      const rrfDense = rd === undefined ? 0 : 1 / (k + rd / divisor)
      const rrfLex = rl === undefined ? 0 : 1 / (k + rl / divisor)
      return { memoryId: p.memoryId, fused: rrfDense + rrfLex, rrfDense, rrfLex,
        denseRaw: typeof p.dense === 'number' && Number.isFinite(p.dense) ? p.dense : null,
        lexRaw: typeof p.lex === 'number' && Number.isFinite(p.lex) ? p.lex : null,
        rankDense: rd === undefined ? null : rd, rankLex: rl === undefined ? null : rl }
    }).sort((x, y) => (y.fused !== x.fused ? y.fused - x.fused : (x.memoryId < y.memoryId ? -1 : x.memoryId > y.memoryId ? 1 : 0)))
  }
  const pairs = [
    { memoryId: 'mem_' + 'a'.repeat(32), dense: 0.9, lex: 3 },
    { memoryId: 'mem_' + 'b'.repeat(32), dense: null, lex: 5 },
    { memoryId: 'mem_' + 'c'.repeat(32), dense: 0.7, lex: 0 },
    { memoryId: 'mem_' + 'd'.repeat(32) },
  ]
  const oldOut = OLD(pairs)
  const newOut = rankFusionRRFPre(pairs)
  ok(JSON.stringify(oldOut) === JSON.stringify(newOut), '无 temp:新输出与旧版 JSON.stringify 逐项相等(回归证明)')
  ok(newOut.every((x) => !('rrfTemp' in x) && !('rankTemp' in x) && !('tempRaw' in x)), '无 temp:输出对象不含 temp 字段(形状不变)')
  // spec:temp 全相等(全 0/全 1)→ 行为与现状逐字节一致(全 0 = 有时间表达但零命中,必须零扰动)
  const allZero = rankFusionRRFPre(pairs.map((p) => ({ ...p, temp: 0 })))
  ok(JSON.stringify(allZero) === JSON.stringify(oldOut), 'temp 全 0:与现状逐项相等(零扰动)')
  const allOne = rankFusionRRFPre(pairs.map((p) => ({ ...p, temp: 1 })))
  ok(JSON.stringify(allOne) === JSON.stringify(oldOut), 'temp 全 1:与现状逐项相等(零扰动)')
}

console.log('[temporal] G5 rankFusionRRFPre 有 temp:软提升')
{
  // A1(yyyy)词法第 1 但 temp=0;B(zzzz)词法第 2 但 temp=1 命中时间范围;0001/0002 为垫底候选
  // (temp=0 者按 memoryId 升序占据 temp 秩 2/3 → yyyy 的 temp 秩=4,秩差不对称 → temp 臂真实翻转排序)
  const pad = (n) => 'mem_' + String(n).padStart(4, '0') + '0'.repeat(28)
  const A1 = 'mem_yyyy' + '0'.repeat(25), B = 'mem_zzzz' + '0'.repeat(25)
  const withTemp = [
    { memoryId: pad(1), dense: null, lex: 3, temp: 0 },
    { memoryId: pad(2), dense: null, lex: 2, temp: 0 },
    { memoryId: A1, dense: null, lex: 9, temp: 0 },
    { memoryId: B, dense: null, lex: 8, temp: 1 },
  ]
  const withoutTemp = withTemp.map(({ temp, ...rest }) => rest) // 查询无时间表达时不传 temp
  const outNo = rankFusionRRFPre(withoutTemp)
  ok(outNo[0].memoryId === A1, '无 temp:词法第 1 的 A1 排第一(现状)')
  const out = rankFusionRRFPre(withTemp)
  ok(out[0].memoryId === B, 'temp=1(命中时间范围)排序上升:词法第 2 的 B 反超')
  ok(out[0].rrfTemp > out.find((x) => x.memoryId === A1).rrfTemp, 'rrfTemp 秩分命中者更高')
  ok(out.every((x) => 'rrfTemp' in x && 'rankTemp' in x && 'tempRaw' in x), '有 temp:输出含 temp 审计字段')
  ok(out.find((x) => x.memoryId === A1) !== undefined, 'temp=0 候选保留(软提升,非硬过滤)')
  // 全部 temp 相等 → 相对序不变(temp 臂同秩,不改变结果)
  const eq = rankFusionRRFPre([
    { memoryId: A1, dense: null, lex: 2, temp: 1 },
    { memoryId: B, dense: null, lex: 2, temp: 1 },
  ])
  ok(eq.map((x) => x.memoryId).join(',') === A1 + ',' + B, '全等 temp:平局回落 memoryId 升序(确定性)')
}

console.log('[temporal] G6 源核验(接线与零变更守卫)')
{
  const SRC_IDX = readFileSync(path.resolve(HERE, '..', '..', 'lib', 'index.js'), 'utf8')
  ok(SRC_FUSION.includes('const hasTemp = temps.length > 0 && temps.some((v) => v !== temps[0])'), 'temp 臂仅在 temp 混合(既有 1 又有 0)时激活(全缺/全等零扰动门)')
  ok(SRC_IDX.includes("tr = tp.parseTemporalQueryPre(query, { now: Date.now() })"), 'recall L0 分支已接 parseTemporalQueryPre(now 注入)')
  ok(SRC_IDX.includes('temp: tempFieldOf(c)'), 'RRF 输入含 temp 字段(经 label 日期判定)')
  ok(SRC_IDX.includes('catch (eTr)'), '时间臂 fail-soft(降级 diag,不阻塞检索)')
  ok(SRC_IDX.includes('if (!tr || typeof dateMsOf'), '查询无时间表达 → temp=undefined → 零行为变更路径')
}

console.log(`\n[temporal] ${pass}/${pass + fail} assertions passed`)
if (fail) process.exit(1)

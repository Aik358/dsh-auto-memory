/** smoke-test-upgrade-estimate.mjs —— 向导 P3：体量/费用估算纯函数的真调用验收（CR-10） */
import { createHarness } from './_harness.mjs'
import {
  estimateUpgradeCostPre, estimateUpgradeTotalsPre, estimateUpgradeSecondsPre,
  normalizeEffortPre, normalizeCharsPre, opencodeUsableCharsPre,
  CHARS_PER_TOKEN, EFFORT_OUT_RATIO, UPGRADE_PRICES, OPENCODE_CONTEXT_TOKENS, UPGRADE_EFFORT_CHOICES,
} from '../../lib/upgrade-estimate.js'

const T = createHarness('upgrade-estimate')

// ── 标定与常量自洽 ──
T.eq(CHARS_PER_TOKEN, 1.19, 'C1 字符/token 标定为 1.19')
// ★#558①（2026-11-08）判据更新：档位表已改为**与宿主白名单同源**（off|low|high|max），
// 并保留历史值 medium（旧配置/存量 run 记录仍是合法输入）。
// 旧断言锁的是「恰好三档」，那是**旧决策**；不变量是「向导可选项 ⊆ 宿主白名单」。
// ⇒ 改为两层断言：①表里必须有宿主四档；②向导可选项必须全部在表内（同源）。
T.eq(Object.keys(EFFORT_OUT_RATIO).slice().sort().join(','), 'high,low,max,medium,off', 'C2 表含宿主四档 + 历史 medium')
T.eq(UPGRADE_EFFORT_CHOICES.slice().sort().join(','), 'high,low,max,off', 'C2b ★向导可选项 = 宿主白名单四档（不含 medium）')
T.eq(UPGRADE_EFFORT_CHOICES.filter((x) => !Object.prototype.hasOwnProperty.call(EFFORT_OUT_RATIO, x)).length, 0, 'C2c ★★可选项必须全部有估算比例（同源，不许两处各写一份）')
T.eq(EFFORT_OUT_RATIO.off, 0, 'C2d off 比例 = 0（不产生推理 token，有依据）')
T.eq(EFFORT_OUT_RATIO.max, EFFORT_OUT_RATIO.high, 'C2e max 按 high 上界估算（无实测锚点，报高不报低）')
T.eq(UPGRADE_PRICES.relay.in, +(UPGRADE_PRICES.offPeak.in * 0.09).toFixed(4), 'C3 中转 = 谷价 × 0.09（in）')
T.eq(UPGRADE_PRICES.relay.out, +(UPGRADE_PRICES.offPeak.out * 0.09).toFixed(4), 'C4 中转 = 谷价 × 0.09（out）')
T.eq(opencodeUsableCharsPre(), Math.floor(OPENCODE_CONTEXT_TOKENS * CHARS_PER_TOKEN * 0.7), 'C5 免费渠道可用字符 = 256K×1.19×0.7 = 213,248')

// ── 正常估算：与文档表一致（20 万字符 / 中档）──
const r200 = estimateUpgradeCostPre({ chars: 200000 })
T.eq(r200.ok, true, 'E1 20 万字符估算成功')
T.eq(r200.effort, 'medium', 'E2 未传强度 ⇒ 默认 medium')
T.eq(r200.inTok, 168067, 'E3 输入 token = 200000/1.19（实算 168,067）')
T.eq(r200.outTok, 42017, 'E4 输出 token = 输入×0.25（实算 42,017）')
T.eq(Number(r200.cost.offPeak.toFixed(2)), 0.34, 'E5 官方谷时 ≈ ¥0.34')
T.eq(Number(r200.cost.peak.toFixed(2)), 0.67, 'E6 官方峰值 ≈ ¥0.67')
T.eq(Number(r200.cost.relay.toFixed(2)), 0.03, 'E7 中转 ≈ ¥0.03')
T.eq(r200.fitsOpencode, true, 'E8 20 万字符装得进免费渠道')

// ── 强度联动：high 必然比 medium 贵，low 更便宜 ──
const lo = estimateUpgradeCostPre({ chars: 200000, effort: 'low' })
const hi = estimateUpgradeCostPre({ chars: 200000, effort: 'high' })
T.eq(lo.cost.offPeak < r200.cost.offPeak && r200.cost.offPeak < hi.cost.offPeak, true, 'E9 low < medium < high 单调')

// ── 免费渠道容量边界（负路径：大区装不下）──
T.eq(estimateUpgradeCostPre({ chars: 213248 }).fitsOpencode, true, 'E10 恰在容量边界内 ⇒ 可装')
T.eq(estimateUpgradeCostPre({ chars: 213249 }).fitsOpencode, false, 'E11 超 1 字符 ⇒ 装不下（边界不可越）')
T.eq(estimateUpgradeCostPre({ chars: 1537296 }).fitsOpencode, false, 'E12 本机最大区 153.7 万字符 ⇒ 免费渠道装不下')

// ── 多区合计 ──
const tot = estimateUpgradeTotalsPre([{ wsKey: 'a', chars: 100000 }, { wsKey: 'b', chars: 200000 }])
T.eq(tot.ok, true, 'M1 合计成功')
T.eq(tot.count, 2, 'M2 区数 2')
T.eq(tot.chars, 300000, 'M3 字符合计 30 万')
T.eq(Number(tot.cost.peak.toFixed(2)) > Number(tot.cost.offPeak.toFixed(2)), true, 'M4 峰值 > 谷时')
T.eq(tot.perWorkspace.length, 2, 'M5 逐区明细 2 条')

// ── 负路径：非法入参一律明确拒绝，不静默当 0 ──
T.eq(estimateUpgradeCostPre({ chars: -1 }).code, 'bad-chars', 'N1 负字符 ⇒ bad-chars')
T.eq(estimateUpgradeCostPre({ chars: NaN }).code, 'bad-chars', 'N2 NaN ⇒ bad-chars')
T.eq(estimateUpgradeCostPre({ chars: 'abc' }).code, 'bad-chars', 'N3 非数字串 ⇒ bad-chars')
T.eq(estimateUpgradeCostPre({}).code, 'bad-chars', 'N4 缺 chars ⇒ bad-chars')
T.eq(estimateUpgradeCostPre(null).code, 'bad-chars', 'N5 null ⇒ bad-chars 不抛异常')
T.eq(estimateUpgradeCostPre({ chars: 1000, effort: 'turbo' }).code, 'bad-effort', 'N6 未知强度 ⇒ bad-effort（不猜）')
T.eq(normalizeEffortPre(' HIGH ').effort, 'high', 'N7 强度大小写/空白归一')
T.eq(normalizeCharsPre('12345').chars, 12345, 'N8 数字串被接受并转 number')
T.eq(estimateUpgradeTotalsPre([{ chars: 100 }, { chars: -5 }]).ok, false, 'N9 合计里一区非法 ⇒ 整体拒绝（不部分成功）')
T.eq(estimateUpgradeTotalsPre('not-array').count, 0, 'N10 非数组 ⇒ 空合计（不抛）')
T.eq(estimateUpgradeSecondsPre(-1).code, 'bad-chars', 'N11 耗时估算同样拒绝负值')

T.done()
